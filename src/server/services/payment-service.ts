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

export interface PaymentServiceDeps {
  paymentRepository: PaymentRepository;
  subledger: SubledgerService;
  audit: AuditTransactionHandle;
  idempotency: IdempotencyTransactionHandle;
  documentSequence: DocumentSequenceTransactionHandle;
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

    // Step 2: fetch payment
    const payment = await this.deps.paymentRepository.findPaymentById(user.tenantId, input.paymentId);
    if (!payment) throw new PaymentNotFoundError(input.paymentId);
    requireTenantMatch(user, payment.tenantId);

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
      const responseBody = claim.record.responseBody as Partial<PostPaymentResult> | null;
      if (responseBody?.paymentId) {
        return { ...responseBody, action: "replayed" } as PostPaymentResult;
      }
    }
    if (claim.action === "conflict") {
      throw new PaymentError("IDEMPOTENCY_CONFLICT", `Idempotency key '${input.idempotencyKey}' was used with a different request body.`);
    }
    if (claim.action === "in_progress") {
      throw new PaymentError("OPERATION_IN_PROGRESS", `Operation '${input.idempotencyKey}' is still in progress.`);
    }

    // Step 4: state check
    if (payment.status === "posted") {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 409, responseBody: { message: "Payment already posted." },
        lastErrorClass: "PaymentAlreadyPostedError",
      }, claim.record.ownerToken!, now);
      throw new PaymentAlreadyPostedError(payment.id);
    }
    if (payment.status !== "draft") {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 409, responseBody: { message: `Payment in status '${payment.status}'.` },
        lastErrorClass: "PaymentNotPostableError",
      }, claim.record.ownerToken!, now);
      throw new PaymentNotPostableError(payment.id, payment.status);
    }

    // Step 5: derive entry type + sign
    const ownerType = await this.deriveOwnerTypeFromAccount(payment.accountId, user.tenantId);
    const { entryType, signMultiplier } = deriveEntryTypeAndSign(ownerType, payment.paymentDirection);
    const amountSigned = signMultiplier === -1 ? negateMoney(payment.amount) : payment.amount;

    // Step 6: allocate entry number + create account entry via SubledgerService
    const year = now.getUTCFullYear();
    const entryDocNo = await allocateDocumentNumber(this.deps.documentSequence, {
      tenantId: user.tenantId, documentType: "account_entry", year, entityType: "account_entry",
    });

    // SubledgerService.postPaymentEntry is a new tx-scoped method we add.
    const entryResult = await this.deps.subledger.postPaymentEntry(user, effective, {
      ownerType,
      ownerId: ownerType, // not used — account already resolved via payment.accountId
      accountId: payment.accountId,
      amountSigned,
      entryDate: payment.paymentDate,
      entryType,
      paymentId: payment.id,
      docNo: entryDocNo.docNo,
      idempotencyKey: `${input.idempotencyKey}:entry`,
      notes: input.notes ?? undefined,
    });

    // Step 7: update payment status to posted + link postedEntryId
    const updatedPayment = await this.deps.paymentRepository.updatePaymentStatus(
      user.tenantId, payment.id,
      { status: "posted", postedEntryId: entryResult.entryId, isLocked: true, updatedBy: user.userId },
      ["draft"],
    );
    if (!updatedPayment) {
      throw new PaymentError("INTERNAL_TRANSACTION_FAILED", `Payment '${payment.id}' could not be transitioned to posted.`);
    }

    // Step 8: audit
    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: PAYMENT_ENTITY_TYPE,
      entityId: payment.id,
      actionType: "payment.post",
      newValuesJson: {
        paymentNo: payment.paymentNo,
        postedEntryId: entryResult.entryId,
        entryNo: entryResult.entryNo,
        amountSigned: entryResult.amountSigned,
        entryType,
        status: "posted",
      },
      idempotencyKey: input.idempotencyKey,
    });

    // Step 9: mark idempotency succeeded
    const result: PostPaymentResult = {
      action: "posted",
      paymentId: payment.id,
      paymentNo: payment.paymentNo,
      status: "posted",
      postedEntryId: entryResult.entryId,
      entryNo: entryResult.entryNo,
      amountSigned: entryResult.amountSigned,
      accountId: payment.accountId,
    };
    await markSucceeded(this.deps.idempotency, claim.record.id, {
      responseCode: 200,
      responseBody: result,
      entityType: PAYMENT_ENTITY_TYPE,
      entityId: payment.id,
    }, claim.record.ownerToken!, now);

    return result;
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
