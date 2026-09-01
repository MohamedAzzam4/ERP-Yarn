/**
 * Payment Service — WP-05-04.
 *
 * Contract: docs/contracts/07_subledger_and_costs_contract.md §13-15
 *   §13: Payment stores positive absolute amount, direction, method, account,
 *        date, state, notes. Posting creates one signed account entry based
 *        on party/direction.
 *        - Customer receipt (received_from_party + customer account):
 *          NEGATIVE customer_payment entry.
 *        - Supplier/factory payment by company (paid_to_party + supplier/factory
 *          account): POSITIVE supplier_payment/factory_payment entry.
 *   §14: One payment entry may settle one or more receivable/payable entries
 *        (handled by SettlementService).
 *   §15: Advance is allowed without sale/payable source.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §12.2
 *   payments table: positive amount, constrained payment_direction, method key,
 *   state, notes, posted_entry_id, reversal_of_payment_id, idempotency_key.
 *
 * DEC-066: MVP payment methods are cash, bank_transfer, check, wallet_instapay,
 *   other. No arbitrary methods.
 *
 * DEC-080: Not applicable to draft/post — there is no approval-style flow for
 *   basic payment posting (Owner/Accountant post directly). Reversal requires
 *   payments.reverse permission.
 *
 * WP-05-04 SCOPE:
 *   - Create draft payment (no account entry)
 *   - Post payment (creates immutable signed account entry via SubledgerService)
 *   - Idempotency: caller-owned claim; replay returns same result
 *   - Permission: payments.create for draft/post; balances.view_customer for
 *     customer payments; balances.view_supplier_factory for supplier/factory.
 *
 * WP-05-04 NON-SCOPE:
 *   - Settlement allocation (SettlementService)
 *   - Payment reversal (PaymentReversalService)
 *   - Direct cost review (WP-05-05)
 *   - Profitability recalculation
 */
import "server-only";

import type { ErpUserContext } from "@/server/auth/erp-context";
import {
  requirePermission,
  requireTenantMatch,
  rejectBodyClaimsAuthority,
} from "@/server/security/guards";
import type { EffectivePermissions } from "@/server/security/effective-permissions";
import { appendAuditLog, type AuditTransactionHandle } from "./audit-service";
import {
  claimIdempotency,
  markSucceeded,
  markBusinessFailed,
  markRetryableFailed,
  type IdempotencyTransactionHandle,
  type IdempotencyClaimInput,
} from "./idempotency-service";
import {
  allocateDocumentNumber,
  type DocumentSequenceTransactionHandle,
} from "./document-sequence-service";
import type { SubledgerService } from "./subledger-service";
import type { PaymentRepository } from "./payment-repository";
import type { Payment, AccountEntry } from "@/server/db/schema/subledger";
import { normalizeMoney, isPositiveMoney, negateMoney } from "./decimal-money";

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

export type PaymentDirection = "received_from_party" | "paid_to_party";
export type PaymentMethod = "cash" | "bank_transfer" | "check" | "wallet_instapay" | "other";
export type AccountOwnerType = "customer" | "supplier" | "factory";

export interface CreateDraftPaymentInput {
  /** Owner type: customer, supplier, or factory. */
  ownerType: AccountOwnerType;
  /** Owner master record ID (customer/supplier/factory id). */
  ownerId: string;
  paymentDate: string;
  /** POSITIVE absolute amount (NUMERIC(18,2) string). */
  amount: string;
  paymentDirection: PaymentDirection;
  paymentMethod: PaymentMethod;
  notes?: string | null;
  idempotencyKey: string;
  currency?: string;
}

export interface PostPaymentInput {
  paymentId: string;
  idempotencyKey: string;
  notes?: string | null;
}

export interface PostPaymentResult {
  action: "posted" | "replayed";
  paymentId: string;
  paymentNo: string;
  status: string;
  postedEntryId: string;
  entryNo: string;
  amountSigned: string;
  accountId: string;
}

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

export class PaymentError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = "PaymentError"; this.code = code; }
}

export class PaymentNotFoundError extends PaymentError {
  constructor(id: string) { super("PAYMENT_NOT_FOUND", `Payment '${id}' not found.`); this.name = "PaymentNotFoundError"; }
}

export class PaymentNotPostableError extends PaymentError {
  constructor(id: string, status: string) { super("STATE_CONFLICT", `Payment '${id}' is in status '${status}' — only 'draft' payments can be posted.`); this.name = "PaymentNotPostableError"; }
}

export class PaymentAlreadyPostedError extends PaymentError {
  constructor(id: string) { super("STATE_CONFLICT", `Payment '${id}' is already posted.`); this.name = "PaymentAlreadyPostedError"; }
}

export class InvalidPaymentMethodError extends PaymentError {
  constructor(method: string) { super("VALIDATION_FAILED", `Invalid payment method '${method}'. DEC-066 allows only: cash, bank_transfer, check, wallet_instapay, other.`); this.name = "InvalidPaymentMethodError"; }
}

export class InvalidPaymentDirectionError extends PaymentError {
  constructor(direction: string) { super("VALIDATION_FAILED", `Invalid payment direction '${direction}'. Allowed: received_from_party, paid_to_party.`); this.name = "InvalidPaymentDirectionError"; }
}

export class InvalidPaymentAmountError extends PaymentError {
  constructor(amount: string) { super("VALIDATION_FAILED", `Payment amount must be positive (NUMERIC(18,2)), got '${amount}'.`); this.name = "InvalidPaymentAmountError"; }
}

export class PaymentDirectionOwnerMismatchError extends PaymentError {
  constructor(ownerType: string, direction: string) {
    super("VALIDATION_FAILED",
      `Payment direction '${direction}' is incompatible with owner type '${ownerType}'. ` +
      `Customer accounts use 'received_from_party'; supplier/factory accounts use 'paid_to_party'.`);
    this.name = "PaymentDirectionOwnerMismatchError";
  }
}

// ---------------------------------------------------------------------------
// Constants.
// ---------------------------------------------------------------------------

const PAYMENT_ENTITY_TYPE = "payment";

const ALLOWED_METHODS: ReadonlySet<PaymentMethod> = new Set([
  "cash", "bank_transfer", "check", "wallet_instapay", "other",
]);

const ALLOWED_DIRECTIONS: ReadonlySet<PaymentDirection> = new Set([
  "received_from_party", "paid_to_party",
]);

/**
 * Mapping from (ownerType, direction) → entry type + sign.
 *
 * Contract 07 §13:
 *   - Customer receipt (received_from_party + customer): NEGATIVE customer_payment
 *   - Supplier/factory payment by company (paid_to_party + supplier/factory):
 *     POSITIVE supplier_payment/factory_payment
 *
 * Advance payments (Contract 07 §15) follow the same sign convention based
 * on money direction — there is no special entry type for advances.
 */
function deriveEntryTypeAndSign(
  ownerType: AccountOwnerType,
  direction: PaymentDirection,
): { entryType: string; signMultiplier: 1 | -1 } {
  if (ownerType === "customer" && direction === "received_from_party") {
    // Customer pays the company → reduces customer receivable → NEGATIVE
    return { entryType: "customer_payment", signMultiplier: -1 };
  }
  if (ownerType === "supplier" && direction === "paid_to_party") {
    // Company pays supplier → reduces supplier payable → POSITIVE
    return { entryType: "supplier_payment", signMultiplier: +1 };
  }
  if (ownerType === "factory" && direction === "paid_to_party") {
    // Company pays factory → reduces factory payable → POSITIVE
    return { entryType: "factory_payment", signMultiplier: +1 };
  }
  throw new PaymentDirectionOwnerMismatchError(ownerType, direction);
}

// ---------------------------------------------------------------------------
// Service deps.
// ---------------------------------------------------------------------------

/**
 * Transaction-scoped factory functions for PaymentService.
 *
 * WP-07-04 cutover coordination (r11): the cutover advisory lock acquired
 * inside SubledgerService.postPaymentEntry is transaction-scoped. For the
 * lock to protect the FULL payment posting (account entry + payment status
 * update + audit + idempotency terminalization), ALL writes must share the
 * SAME db.transaction(). These factories create tx-scoped handles so the
 * entire payment posting is atomic with the cutover lock.
 */
export type PaymentTransactionRunner = <T>(work: (tx: unknown) => Promise<T>) => Promise<T>;

export interface PaymentTransactionScopedFactories {
  /** Create a SubledgerService bound to the transaction-scoped `tx`. */
  createSubledger: (tx: unknown) => SubledgerService;
  /** Create a PaymentRepository bound to the transaction-scoped `tx`. */
  createPaymentRepository: (tx: unknown) => PaymentRepository;
  /** Create an AuditTransactionHandle bound to the transaction-scoped `tx`. */
  createAudit: (tx: unknown) => AuditTransactionHandle;
  /** Create an IdempotencyTransactionHandle bound to the transaction-scoped `tx`. */
  createIdempotency: (tx: unknown) => IdempotencyTransactionHandle;
  /** Create a DocumentSequenceTransactionHandle bound to the transaction-scoped `tx`. */
  createDocumentSequence: (tx: unknown) => DocumentSequenceTransactionHandle;
}

export interface PaymentServiceDeps {
  paymentRepository: PaymentRepository;
  subledger: SubledgerService;
  audit: AuditTransactionHandle;
  idempotency: IdempotencyTransactionHandle;
  documentSequence: DocumentSequenceTransactionHandle;
  /**
   * Optional transaction runner. When provided, all DB writes in postPayment
   * are wrapped in a single DB transaction — this is REQUIRED for WP-07-04
   * cutover coordination correctness (the advisory lock must span the account
   * entry creation AND the payment status update AND audit AND idempotency
   * terminalization). When absent (unit tests with in-memory repos), the
   * service runs without a DB transaction boundary.
   */
  transactionRunner?: PaymentTransactionRunner;
  /**
   * Factory functions for creating transaction-scoped services/repos.
   * Required when `transactionRunner` is provided.
   */
  txFactories?: PaymentTransactionScopedFactories;
}

// ---------------------------------------------------------------------------
// PaymentService.
// ---------------------------------------------------------------------------

export class PaymentService {
  constructor(private readonly deps: PaymentServiceDeps) {}

  /**
   * Create a draft payment (no account entry yet).
   *
   * Permission: payments.create (Owner/Accountant only — Workers denied per
   * Contract 11 §13).
   *
   * The draft payment has status='draft' and postedEntryId=null. Posting
   * (postPayment) creates the immutable account entry.
   */
  async createDraftPayment(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: CreateDraftPaymentInput,
  ): Promise<{ paymentId: string; paymentNo: string; status: string }> {
    // Step 1: permission + reject body authority
    requirePermission(effective, "payments.create");
    // Customer payments require balances.view_customer; supplier/factory require balances.view_supplier_factory
    if (input.ownerType === "customer") {
      requirePermission(effective, "balances.view_customer");
    } else {
      requirePermission(effective, "balances.view_supplier_factory");
    }
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    // Step 2: validate inputs
    if (!input.ownerId?.trim()) throw new PaymentError("VALIDATION_FAILED", "ownerId is required.");
    if (!input.paymentDate?.trim()) throw new PaymentError("VALIDATION_FAILED", "paymentDate is required.");
    if (!input.idempotencyKey?.trim()) throw new PaymentError("VALIDATION_FAILED", "idempotencyKey is required.");
    if (!ALLOWED_METHODS.has(input.paymentMethod)) {
      throw new InvalidPaymentMethodError(input.paymentMethod);
    }
    if (!ALLOWED_DIRECTIONS.has(input.paymentDirection)) {
      throw new InvalidPaymentDirectionError(input.paymentDirection);
    }
    if (!isPositiveMoney(input.amount)) {
      throw new InvalidPaymentAmountError(input.amount);
    }
    // Direction/owner compatibility check (throws on mismatch)
    deriveEntryTypeAndSign(input.ownerType, input.paymentDirection);

    // Step 3: claim idempotency
    const now = new Date();
    const currency = input.currency ?? "EGP";
    const idempotencyInput: IdempotencyClaimInput = {
      tenantId: user.tenantId,
      operationScope: "payment.create_draft",
      idempotencyKey: input.idempotencyKey,
      requestBody: {
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        paymentDate: input.paymentDate,
        amount: normalizeMoney(input.amount),
        paymentDirection: input.paymentDirection,
        paymentMethod: input.paymentMethod,
        notes: input.notes ?? null,
      } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    };

    const claim = await claimIdempotency(this.deps.idempotency, idempotencyInput);

    if (claim.action === "replay") {
      const responseBody = claim.record.responseBody as { paymentId?: string; paymentNo?: string; status?: string } | null;
      if (responseBody?.paymentId) {
        return { paymentId: responseBody.paymentId, paymentNo: responseBody.paymentNo!, status: responseBody.status! };
      }
    }
    if (claim.action === "conflict") {
      throw new PaymentError("IDEMPOTENCY_CONFLICT", `Idempotency key '${input.idempotencyKey}' was used with a different request body.`);
    }
    if (claim.action === "in_progress") {
      throw new PaymentError("OPERATION_IN_PROGRESS", `Operation '${input.idempotencyKey}' is still in progress.`);
    }

    // Step 4: allocate payment number + insert payment row
    const year = now.getUTCFullYear();
    const docNoResult = await allocateDocumentNumber(this.deps.documentSequence, {
      tenantId: user.tenantId, documentType: "payment", year, entityType: PAYMENT_ENTITY_TYPE,
    });

    // Get-or-create the account for this owner
    // We use SubledgerService's internal getOrCreateAccount via a public wrapper
    // — but SubledgerService doesn't expose getOrCreateAccount publicly.
    // Instead, we look up the account via the subledger handle and create if missing.
    // For WP-05-04, we delegate account creation to SubledgerService by posting
    // the entry through it (which get-or-creates the account internally).
    // For a draft payment, we don't post an entry yet, so we need the account id.
    // We resolve the account id at POST time, not at draft time.
    // Draft payment stores accountId = null-equivalent... but the schema requires accountId NOT NULL.
    // Solution: resolve the account at draft time via SubledgerService.getOrCreateAccount.
    // Since that's not public, we add a public method on SubledgerService:
    // `getOrCreateAccount(user, ownerType, ownerId, currency)`.
    // For now, we use a workaround: insert a placeholder account via the
    // payment repository's underlying subledger handle. But PaymentRepository
    // doesn't have account methods.
    //
    // Correct solution: add getOrCreateAccount as a public method on SubledgerService.
    // That's a small additive change. We'll do it in subledger-service.ts.
    const account = await this.deps.subledger.getOrCreateAccount(
      user, input.ownerType, input.ownerId, currency,
    );
    requireTenantMatch(user, account.tenantId);

    const payment = await this.deps.paymentRepository.insertPayment({
      tenantId: user.tenantId,
      paymentNo: docNoResult.docNo,
      paymentDate: input.paymentDate,
      accountId: account.id,
      amount: normalizeMoney(input.amount),
      paymentDirection: input.paymentDirection,
      paymentMethod: input.paymentMethod,
      status: "draft",
      notes: input.notes ?? null,
      postedEntryId: null,
      idempotencyKey: input.idempotencyKey,
      createdBy: user.userId,
    });

    // Step 5: audit
    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: PAYMENT_ENTITY_TYPE,
      entityId: payment.id,
      actionType: "payment.draft.create",
      newValuesJson: {
        paymentNo: payment.paymentNo,
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        amount: payment.amount,
        paymentDirection: payment.paymentDirection,
        paymentMethod: payment.paymentMethod,
        paymentDate: payment.paymentDate,
        accountId: payment.accountId,
        status: "draft",
      },
      idempotencyKey: input.idempotencyKey,
    });

    // Step 6: mark idempotency succeeded
    await markSucceeded(this.deps.idempotency, claim.record.id, {
      responseCode: 200,
      responseBody: {
        paymentId: payment.id,
        paymentNo: payment.paymentNo,
        status: payment.status,
      },
      entityType: PAYMENT_ENTITY_TYPE,
      entityId: payment.id,
    }, claim.record.ownerToken!, now);

    return { paymentId: payment.id, paymentNo: payment.paymentNo, status: payment.status };
  }

  /**
   * Post a draft payment — creates the immutable signed account entry.
   *
   * Permission: payments.create (same as draft — posting is the second half
   * of the create flow). Reversal requires payments.reverse (separate service).
   *
   * The account entry is created via SubledgerService (sole owner of account
   * entry creation per Contract 14 §4). The entry's source_document_type is
   * 'payment' and source_document_id is the payment id.
   */
  async postPayment(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: PostPaymentInput,
  ): Promise<PostPaymentResult> {
    // Step 1: permission
    requirePermission(effective, "payments.create");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!input.paymentId?.trim()) throw new PaymentError("VALIDATION_FAILED", "paymentId is required.");
    if (!input.idempotencyKey?.trim()) throw new PaymentError("VALIDATION_FAILED", "idempotencyKey is required.");

    // r14 BLOCKER C: fail-closed transaction configuration check BEFORE
    // idempotency claim, DB locking, document allocation, or business mutation.
    // A missing transactionRunner/txFactories is an internal configuration error
    // that must NOT claim idempotency, consume attempt_count, create audit,
    // or acquire row locks.
    if (!this.deps.transactionRunner || !this.deps.txFactories) {
      throw new PaymentError("CONFIGURATION_ERROR", "PaymentService.postPayment requires transactionRunner and txFactories for production high-risk command execution.");
    }

    // Step 2: fetch payment (pre-tx — will be re-locked/re-read inside tx)
    let payment = await this.deps.paymentRepository.findPaymentById(user.tenantId, input.paymentId);
    if (!payment) throw new PaymentNotFoundError(input.paymentId);
    requireTenantMatch(user, payment.tenantId);
    // Capture non-null for closure narrowing (let variables can't be narrowed)
    let paymentNonNull: Payment = payment;

    // Step 3: claim idempotency
    const now = new Date();
    const idempotencyInput: IdempotencyClaimInput = {
      tenantId: user.tenantId,
      operationScope: "payment.post",
      idempotencyKey: input.idempotencyKey,
      requestBody: { paymentId: input.paymentId, notes: input.notes ?? null } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    };
    const claim = await claimIdempotency(this.deps.idempotency, idempotencyInput);

    if (claim.action === "replay") {
      // r14 BLOCKER B: ALL terminal replay states must fail closed.
      // No replay branch may silently fall through to business execution.
      if (claim.record.state === "succeeded") {
        const responseBody = claim.record.responseBody as Partial<PostPaymentResult> | null;
        // Validate complete PostPaymentResult — not just paymentId.
        if (!responseBody?.paymentId || !responseBody?.paymentNo || !responseBody?.status
            || !responseBody?.postedEntryId || !responseBody?.entryNo
            || !responseBody?.amountSigned || !responseBody?.accountId) {
          throw new PaymentError("IDEMPOTENCY_INCONSISTENT", "Durable succeeded record is malformed — missing required fields.");
        }
        return { ...responseBody, action: "replayed" } as PostPaymentResult;
      }
      if (claim.record.state === "business_failed") {
        const errorBody = claim.record.responseBody as { code?: string; message?: string } | null;
        if (!errorBody?.code || !errorBody?.message) {
          throw new PaymentError("IDEMPOTENCY_INCONSISTENT", "Durable business failure record is malformed.");
        }
        // Throw the exact stored business failure — do NOT re-execute.
        throw new PaymentError(errorBody.code, errorBody.message);
      }
      // Unexpected replay state — fail closed.
      throw new PaymentError("IDEMPOTENCY_INCONSISTENT", `Unexpected replay state '${claim.record.state}'.`);
    }
    if (claim.action === "conflict") {
      throw new PaymentError("IDEMPOTENCY_CONFLICT", `Idempotency key '${input.idempotencyKey}' was used with a different request body.`);
    }
    if (claim.action === "in_progress") {
      throw new PaymentError("OPERATION_IN_PROGRESS", `Operation '${input.idempotencyKey}' is still in progress.`);
    }

    // Step 4: state check (pre-tx business failures — persist EXACT error.code + error.message)
    if (payment.status === "posted") {
      const error = new PaymentAlreadyPostedError(payment.id);
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 409, responseBody: { code: error.code, message: error.message },
        lastErrorClass: error.name,
      }, claim.record.ownerToken!, now);
      throw error;
    }
    if (payment.status !== "draft") {
      const error = new PaymentNotPostableError(payment.id, payment.status);
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 409, responseBody: { code: error.code, message: error.message },
        lastErrorClass: error.name,
      }, claim.record.ownerToken!, now);
      throw error;
    }

    // Step 5: derive entry type + sign (pre-tx — may be overridden by
    // locked re-read inside the transaction for TOCTOU safety)
    let ownerType = await this.deriveOwnerTypeFromAccount(payment.accountId, user.tenantId);
    let { entryType, signMultiplier } = deriveEntryTypeAndSign(ownerType, payment.paymentDirection);
    let amountSigned = signMultiplier === -1 ? negateMoney(payment.amount) : payment.amount;

    // Step 6-9: allocate entry number, create account entry via SubledgerService,
    // update payment status, audit, mark idempotency succeeded.
    //
    // WP-07-04 cutover coordination (r11): ALL of these writes MUST share the
    // SAME db.transaction() so the cutover advisory lock (acquired inside
    // SubledgerService.postPaymentEntry) protects the FULL payment posting —
    // not just the account entry creation. Without this, a concurrent
    // historical migration cutover could cross the boundary between the
    // account entry creation and the payment status update.
    //
    // When transactionRunner is provided (production), the entire block runs
    // in one transaction. When absent (unit tests), it runs without a boundary.
    const executePosting = async (txScoped: {
      subledger: SubledgerService; paymentRepository: PaymentRepository;
      audit: AuditTransactionHandle; idempotency: IdempotencyTransactionHandle;
      documentSequence: DocumentSequenceTransactionHandle;
    } | null): Promise<PostPaymentResult> => {
      const subledger = txScoped?.subledger ?? this.deps.subledger;
      const paymentRepo = txScoped?.paymentRepository ?? this.deps.paymentRepository;
      const audit = txScoped?.audit ?? this.deps.audit;
      const idempotency = txScoped?.idempotency ?? this.deps.idempotency;
      const documentSequence = txScoped?.documentSequence ?? this.deps.documentSequence;

      // BLOCKER 5 (r12): lock the payment row INSIDE the transaction and
      // re-read it from the tx-scoped repository. This prevents a TOCTOU
      // race where another concurrent postPayment changes the payment
      // status between the pre-tx check and the tx-internal write.
      // The lockPayment method uses SELECT ... FOR UPDATE.
      if (txScoped) {
        const lockedPayment = await paymentRepo.lockPayment(user.tenantId, paymentNonNull.id);
        if (!lockedPayment) {
          throw new PaymentNotFoundError(paymentNonNull.id);
        }
        // Re-validate from the locked row. A concurrent post may have
        // changed the status to "posted" between the pre-tx check and now.
        if (lockedPayment.status === "posted") {
          throw new PaymentAlreadyPostedError(lockedPayment.id);
        }
        if (lockedPayment.status !== "draft") {
          throw new PaymentNotPostableError(lockedPayment.id, lockedPayment.status);
        }
        // Use the locked row's authoritative data for all subsequent writes.
        // This prevents stale `payment` object from driving financial mutation.
        paymentNonNull = lockedPayment;
        // Re-derive entry type from the locked payment's account.
        // Use the tx-scoped subledger (not the root one) to avoid self-deadlock
        // when the connection pool has max: 1.
        const lockedAccount = await subledger.findAccountById(user.tenantId, paymentNonNull.accountId);
        if (!lockedAccount) {
          throw new PaymentError("INTERNAL_TRANSACTION_FAILED", `Account '${paymentNonNull.accountId}' not found for payment.`);
        }
        const lockedOwnerType = lockedAccount.ownerType as AccountOwnerType;
        const lockedDerived = deriveEntryTypeAndSign(lockedOwnerType, paymentNonNull.paymentDirection);
        ownerType = lockedOwnerType;
        entryType = lockedDerived.entryType;
        signMultiplier = lockedDerived.signMultiplier;
        amountSigned = signMultiplier === -1 ? negateMoney(paymentNonNull.amount) : paymentNonNull.amount;
      }

      const year = now.getUTCFullYear();
      const entryDocNo = await allocateDocumentNumber(documentSequence, {
        tenantId: user.tenantId, documentType: "account_entry", year, entityType: "account_entry",
      });

      const entryResult = await subledger.postPaymentEntry(user, effective, {
        ownerType,
        ownerId: ownerType, // not used — account already resolved via paymentNonNull.accountId
        accountId: paymentNonNull.accountId,
        amountSigned,
        entryDate: paymentNonNull.paymentDate,
        entryType,
        paymentId: paymentNonNull.id,
        docNo: entryDocNo.docNo,
        idempotencyKey: `${input.idempotencyKey}:entry`,
        notes: input.notes ?? undefined,
      });

      const updatedPayment = await paymentRepo.updatePaymentStatus(
        user.tenantId, paymentNonNull.id,
        { status: "posted", postedEntryId: entryResult.entryId, isLocked: true, updatedBy: user.userId },
        ["draft"],
      );
      if (!updatedPayment) {
        throw new PaymentError("INTERNAL_TRANSACTION_FAILED", `Payment '${paymentNonNull.id}' could not be transitioned to posted.`);
      }

      await appendAuditLog(audit, user.tenantId, user.userId, {
        entityType: PAYMENT_ENTITY_TYPE,
        entityId: paymentNonNull.id,
        actionType: "payment.post",
        newValuesJson: {
          paymentNo: paymentNonNull.paymentNo,
          postedEntryId: entryResult.entryId,
          entryNo: entryResult.entryNo,
          amountSigned: entryResult.amountSigned,
          entryType,
          status: "posted",
        },
        idempotencyKey: input.idempotencyKey,
      });

      const result: PostPaymentResult = {
        action: "posted",
        paymentId: paymentNonNull.id,
        paymentNo: paymentNonNull.paymentNo,
        status: "posted",
        postedEntryId: entryResult.entryId,
        entryNo: entryResult.entryNo,
        amountSigned: entryResult.amountSigned,
        accountId: paymentNonNull.accountId,
      };
      await markSucceeded(idempotency, claim.record.id, {
        responseCode: 200,
        responseBody: result,
        entityType: PAYMENT_ENTITY_TYPE,
        entityId: paymentNonNull.id,
      }, claim.record.ownerToken!, now);

      return result;
    };

    try {
      // r14 BLOCKER C: transactionRunner + txFactories are already verified
      // at the top of this method. No dead non-transactional fallback.
      return await this.deps.transactionRunner!(async (tx: unknown) => {
        const txSubledger = this.deps.txFactories!.createSubledger(tx);
        const txPaymentRepo = this.deps.txFactories!.createPaymentRepository(tx);
        const txAudit = this.deps.txFactories!.createAudit(tx);
        const txIdem = this.deps.txFactories!.createIdempotency(tx);
        const txDocSeq = this.deps.txFactories!.createDocumentSequence(tx);
        return executePosting({
          subledger: txSubledger, paymentRepository: txPaymentRepo,
          audit: txAudit, idempotency: txIdem, documentSequence: txDocSeq,
        });
      });
    } catch (txError) {
      // r14 BLOCKER A: classify business vs technical failures.
      // Persist EXACT error.code + error.message — no remapping.
      const isBusinessError =
        txError instanceof PaymentAlreadyPostedError ||
        txError instanceof PaymentNotPostableError ||
        txError instanceof PaymentNotFoundError;
      try {
        if (isBusinessError) {
          // Persist the exact error.code and error.message from the thrown error.
          const error = txError as PaymentError;
          await markBusinessFailed(this.deps.idempotency, claim.record.id, {
            responseCode: 409,
            responseBody: { code: error.code, message: error.message },
            lastErrorClass: error.name,
          }, claim.record.ownerToken!, now);
        } else {
          // Technical failure → retryable_failed for immediate same-key retry.
          await markRetryableFailed(this.deps.idempotency, claim.record.id, {
            responseCode: 500,
            responseBody: { message: "Payment posting transaction failed and rolled back." },
            lastErrorClass: txError instanceof Error ? txError.name : "Unknown",
          }, claim.record.ownerToken!, now);
        }
      } catch {
        // If terminalization fails, the record remains in_progress
        // and will expire via lease.
      }
      throw txError;
    }
  }

  /**
   * Look up the account owner type from the account id.
   * Used at post time to derive the entry type + sign.
   */
  private async deriveOwnerTypeFromAccount(accountId: string, _tenantId: string): Promise<AccountOwnerType> {
    // We need to read the account to get its ownerType.
    // SubledgerService doesn't expose findAccount publicly, but the account
    // was created at draft time via getOrCreateAccount. We add a public
    // findAccount method to SubledgerService.
    const account = await this.deps.subledger.findAccountById(_tenantId, accountId);
    if (!account) {
      throw new PaymentError("INTERNAL_TRANSACTION_FAILED", `Account '${accountId}' not found for payment.`);
    }
    return account.ownerType as AccountOwnerType;
  }
}
