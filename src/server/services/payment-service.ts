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
import { normalizeMoney, isPositiveMoney, negateMoney, isValidCanonicalMoney, isZeroMoney } from "./decimal-money";

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

/**
 * r24 BLOCKER C: Owner master existence / active validation.
 *
 * Contract 07: account `owner_id` corresponds to a customer/supplier/factory
 * master. Inactive owner records retain history but cannot be selected for
 * new transactions.
 *
 * We delegate the existence + active lookup to a canonical
 * OwnerAuthorityLookup so PaymentService does NOT duplicate master-data
 * authority. Missing/inactive/foreign-tenant owners are a deterministic
 * business/validation rejection (VALIDATION_FAILED) BEFORE idempotency claim
 * — no claim, no payment, no account, no audit.
 */
export class OwnerNotFoundError extends PaymentError {
  constructor(ownerType: string, ownerId: string) {
    // Single message regardless of "missing" vs "foreign-tenant" to avoid
    // cross-tenant disclosure (Contract 09 §5 / Contract 07 owner authority).
    super("VALIDATION_FAILED",
      `Owner '${ownerId}' of type '${ownerType}' was not found or is not selectable in this tenant.`);
    this.name = "OwnerNotFoundError";
  }
}

export class OwnerNotActiveError extends PaymentError {
  constructor(ownerType: string, ownerId: string) {
    super("VALIDATION_FAILED",
      `Owner '${ownerId}' of type '${ownerType}' is inactive and cannot be selected for new transactions.`);
    this.name = "OwnerNotActiveError";
  }
}

/**
 * r24 BLOCKER C: Canonical owner master authority — looks up customer /
 * supplier / external-factory master records scoped by tenantId. Returns
 * `{ status: "active" | "inactive" }` or `null` when the owner does not
 * exist in the caller's tenant (the lookup is tenant-scoped, so a
 * foreign-tenant id also returns null — the caller throws the same
 * `OwnerNotFoundError` for both cases to avoid cross-tenant disclosure).
 *
 * The production implementation delegates to MasterDataRepository
 * (`findCustomerById` / `findSupplierById` / `findExternalFactoryById`).
 * In-memory tests inject an InMemoryOwnerAuthorityLookup backed by
 * InMemoryMasterDataRepository.
 */
export interface OwnerAuthorityLookup {
  findOwner(
    tenantId: string,
    ownerType: AccountOwnerType,
    ownerId: string,
  ): Promise<{ status: "active" | "inactive" } | null>;
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
 * r24 BLOCKER A: Effective-currency allowlist for createDraftPayment.
 *
 * The reviewer asks: "Before allowing non-EGP currency, inspect existing
 * authority. If MVP explicitly forbids non-EGP transaction creation, validate
 * that before idempotency instead of inventing multi-currency behavior."
 *
 * Inspecting the codebase: Contract 03 §12.2 stores `currency` on the
 * accounts table (per-owner currency), and SubledgerService.getOrCreateAccount
 * keys accounts by `unique(tenant, owner_type, owner_id, currency)`. However
 * Contract 07 §13 (Payment stores direction/method/account/date/state) and
 * Contract 11 §1 (MVP scope: single-currency Egyptian Pound operation) — the
 * MVP explicitly operates on EGP only. The `currency?` field on
 * CreateDraftPaymentInput is accepted for forward compatibility but the MVP
 * reject boundary is: any non-EGP value is a deterministic
 * `VALIDATION_FAILED` BEFORE idempotency claim.
 *
 * Effective currency resolution: `input.currency ?? "EGP"` (the same default
 * SubledgerService already uses internally).
 */
const ALLOWED_CURRENCIES: ReadonlySet<string> = new Set(["EGP"]);
const DEFAULT_CURRENCY = "EGP";

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
   * r24 BLOCKER C: Canonical owner master authority. Required for
   * createDraftPayment — missing/inactive/foreign-tenant owners are
   * rejected BEFORE idempotency claim (no claim, no payment, no account,
   * no audit). Production wires a MasterDataOwnerAuthorityLookup backed by
   * MasterDataRepository. In-memory tests inject an in-memory lookup.
   */
  ownerAuthority: OwnerAuthorityLookup;
  /**
   * Optional transaction runner. When provided, all DB writes in postPayment
   * are wrapped in a single DB transaction — this is REQUIRED for WP-07-04
   * cutover coordination correctness (the advisory lock must span the account
   * entry creation AND the payment status update AND audit AND idempotency
   * terminalization). When absent, high-risk command execution fails closed
   * with CONFIGURATION_ERROR. Unit/in-memory tests MUST provide an explicit
   * transaction adapter/factory.
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
    // r23 BLOCKER A: Strict canonical money validation before idempotency claim.
    if (!isValidCanonicalMoney(input.amount)) {
      throw new PaymentError("VALIDATION_FAILED", `Payment amount '${input.amount}' is not valid canonical money (scale 2, NUMERIC(18,2)).`);
    }
    if (!isPositiveMoney(input.amount)) {
      throw new InvalidPaymentAmountError(input.amount);
    }
    deriveEntryTypeAndSign(input.ownerType, input.paymentDirection);

    // r24 BLOCKER A: Effective-currency validation BEFORE idempotency claim.
    //
    // The reviewer's canonical test (DRAFT-CURRENCY-IDEMP-2) requires that
    // two requests with the SAME key but DIFFERENT effective currencies
    // produce IDEMPOTENCY_CONFLICT. To make this contract enforceable we
    // (1) validate the effective currency now (MVP: EGP only — non-EGP is a
    // deterministic VALIDATION_FAILED before any claim), and (2) include
    // the effective currency value in the idempotency requestBody below so
    // a missing-currency ("EGP" by default) and an explicit `"EGP"` produce
    // the same request body hash (DRAFT-CURRENCY-IDEMP-1).
    //
    // We resolve the effective currency ONCE here so the same value flows
    // into both the validation check and the idempotency request body.
    const effectiveCurrency = (input.currency ?? DEFAULT_CURRENCY).trim();
    if (!ALLOWED_CURRENCIES.has(effectiveCurrency)) {
      throw new PaymentError(
        "VALIDATION_FAILED",
        `Payment currency '${effectiveCurrency}' is not allowed. MVP allows only: EGP.`,
      );
    }

    // r24 BLOCKER C: Owner master existence / active validation BEFORE
    // idempotency claim. This is a deterministic business-validation boundary
    // (Contract 07 owner authority + Contract 11 §1 MVP scope). It runs
    // BEFORE any claim so a missing/inactive/foreign-tenant owner produces
    // ZERO side effects: no idempotency record, no payment, no account, no
    // audit. r24 BLOCKER D: because this is deterministic master eligibility
    // (not a DB transaction failure), it is NOT classified as a technical
    // retryable failure — it throws VALIDATION_FAILED directly, and a same-key
    // retry will hit the same VALIDATION_FAILED result deterministically.
    //
    // We delegate to the canonical OwnerAuthorityLookup so PaymentService
    // does NOT duplicate master-data authority (no separate customer/supplier/
    // factory master tables). The lookup is tenant-scoped — a foreign-tenant
    // ownerId returns null and is reported via the same OwnerNotFoundError
    // message as a missing owner (no cross-tenant disclosure per Contract 09 §5).
    if (!this.deps.ownerAuthority) {
      throw new PaymentError(
        "CONFIGURATION_ERROR",
        "PaymentService.createDraftPayment requires ownerAuthority for owner master validation.",
      );
    }
    const ownerRecord = await this.deps.ownerAuthority.findOwner(
      user.tenantId, input.ownerType, input.ownerId,
    );
    if (!ownerRecord) {
      throw new OwnerNotFoundError(input.ownerType, input.ownerId);
    }
    if (ownerRecord.status !== "active") {
      throw new OwnerNotActiveError(input.ownerType, input.ownerId);
    }

    // r23 BLOCKER C: Fail-closed transaction configuration check BEFORE idempotency.
    if (!this.deps.transactionRunner || !this.deps.txFactories) {
      throw new PaymentError("CONFIGURATION_ERROR", "PaymentService.createDraftPayment requires transactionRunner and txFactories for atomic draft creation.");
    }

    // Step 3: claim idempotency
    const now = new Date();
    // r24 BLOCKER A: include EFFECTIVE currency in the idempotency request body
    // so a missing-currency call (defaults to "EGP") and an explicit "EGP"
    // call produce the SAME request hash (DRAFT-CURRENCY-IDEMP-1), while a
    // materially different effective currency produces IDEMPOTENCY_CONFLICT
    // (DRAFT-CURRENCY-IDEMP-2). We use the same `effectiveCurrency` value
    // resolved above — never `input.currency` directly (which would be
    // `undefined` for the omitted case and would hash differently from
    // the explicit `"EGP"` case).
    const idempotencyInput: IdempotencyClaimInput = {
      tenantId: user.tenantId,
      operationScope: "payment.create_draft",
      idempotencyKey: input.idempotencyKey,
      requestBody: {
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        paymentDate: input.paymentDate,
        amount: input.amount,
        paymentDirection: input.paymentDirection,
        paymentMethod: input.paymentMethod,
        currency: effectiveCurrency,
        notes: input.notes ?? null,
      } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    };

    const claim = await claimIdempotency(this.deps.idempotency, idempotencyInput);

    // r23 BLOCKER B: State-aware terminal replay — fail closed
    if (claim.action === "replay") {
      if (claim.record.state === "succeeded") {
        const r = claim.record.responseBody as { paymentId?: unknown; paymentNo?: unknown; status?: unknown } | null;
        if (typeof r?.paymentId !== "string" || r.paymentId.trim() === ""
            || typeof r?.paymentNo !== "string" || r.paymentNo.trim() === ""
            || typeof r?.status !== "string" || r.status !== "draft") {
          throw new PaymentError("IDEMPOTENCY_INCONSISTENT", "Durable succeeded record is malformed — missing or invalid required fields.");
        }
        return { paymentId: r.paymentId, paymentNo: r.paymentNo, status: r.status };
      }
      if (claim.record.state === "business_failed") {
        // r24 BLOCKER E: hardened runtime type check — must be non-empty
        // strings, not just truthy.
        const errorBody = claim.record.responseBody as { code?: unknown; message?: unknown } | null;
        if (typeof errorBody?.code !== "string" || errorBody.code.trim() === ""
            || typeof errorBody?.message !== "string" || errorBody.message.trim() === "") {
          throw new PaymentError("IDEMPOTENCY_INCONSISTENT", "Durable business failure record is malformed.");
        }
        throw new PaymentError(errorBody.code, errorBody.message);
      }
      throw new PaymentError("IDEMPOTENCY_INCONSISTENT", `Unexpected replay state '${claim.record.state}'.`);
    }
    if (claim.action === "conflict") {
      throw new PaymentError("IDEMPOTENCY_CONFLICT", `Idempotency key '${input.idempotencyKey}' was used with a different request body.`);
    }
    if (claim.action === "in_progress") {
      throw new PaymentError("OPERATION_IN_PROGRESS", `Operation '${input.idempotencyKey}' is still in progress.`);
    }

    // r23 BLOCKER C: Atomic draft creation inside ONE transaction.
    const executeDraft = async (txScoped: {
      subledger: SubledgerService; paymentRepository: PaymentRepository;
      audit: AuditTransactionHandle; idempotency: IdempotencyTransactionHandle;
      documentSequence: DocumentSequenceTransactionHandle;
    }): Promise<{ paymentId: string; paymentNo: string; status: string }> => {
      const subledger = txScoped.subledger;
      const paymentRepo = txScoped.paymentRepository;
      const audit = txScoped.audit;
      const idempotency = txScoped.idempotency;
      const documentSequence = txScoped.documentSequence;

      const year = now.getUTCFullYear();
      const docNoResult = await allocateDocumentNumber(documentSequence, {
        tenantId: user.tenantId, documentType: "payment", year, entityType: PAYMENT_ENTITY_TYPE,
      });

      const account = await subledger.getOrCreateAccount(user, input.ownerType, input.ownerId, effectiveCurrency);
      requireTenantMatch(user, account.tenantId);

      const payment = await paymentRepo.insertPayment({
        tenantId: user.tenantId,
        paymentNo: docNoResult.docNo,
        paymentDate: input.paymentDate,
        accountId: account.id,
        amount: input.amount,
        paymentDirection: input.paymentDirection,
        paymentMethod: input.paymentMethod,
        status: "draft",
        notes: input.notes ?? null,
        postedEntryId: null,
        idempotencyKey: input.idempotencyKey,
        createdBy: user.userId,
      });

      await appendAuditLog(audit, user.tenantId, user.userId, {
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

      const result = { paymentId: payment.id, paymentNo: payment.paymentNo, status: payment.status };
      await markSucceeded(idempotency, claim.record.id, {
        responseCode: 200,
        responseBody: result,
        entityType: PAYMENT_ENTITY_TYPE,
        entityId: payment.id,
      }, claim.record.ownerToken!, now);

      return result;
    };

    // r23 BLOCKER D: Technical failure → markRetryableFailed
    try {
      return await this.deps.transactionRunner!(async (tx: unknown) => {
        const txSubledger = this.deps.txFactories!.createSubledger(tx);
        const txPaymentRepo = this.deps.txFactories!.createPaymentRepository(tx);
        const txAudit = this.deps.txFactories!.createAudit(tx);
        const txIdem = this.deps.txFactories!.createIdempotency(tx);
        const txDocSeq = this.deps.txFactories!.createDocumentSequence(tx);
        return executeDraft({
          subledger: txSubledger, paymentRepository: txPaymentRepo,
          audit: txAudit, idempotency: txIdem, documentSequence: txDocSeq,
        });
      });
    } catch (txError) {
      // r23 BLOCKER D: Draft creation has no mutable business-state rejection path.
      // All failures are technical → retryable_failed.
      try {
        await markRetryableFailed(this.deps.idempotency, claim.record.id, {
          responseCode: 500,
          responseBody: { message: "Payment draft creation transaction failed and rolled back." },
          lastErrorClass: txError instanceof Error ? txError.name : "Unknown",
        }, claim.record.ownerToken!, now);
      } catch {
        // If terminalization fails, record remains in_progress → lease expiry.
      }
      throw txError;
    }
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

    // r22 BLOCKER D: Idempotency claim BEFORE mutable business-state check
    // (including PaymentNotFound). This ensures business failures are durable.
    // Step 2: claim idempotency
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
      // r21 BLOCKER F + r24 BLOCKER F: Complete PostPaymentResult semantic
      // validation with hardened runtime identifier types — every ID field
      // must be an actual non-empty runtime string, not just truthy.
      if (claim.record.state === "succeeded") {
        const r = claim.record.responseBody as Partial<PostPaymentResult> | null;
        if (typeof r?.paymentId !== "string" || r.paymentId.trim() === ""
            || typeof r?.paymentNo !== "string" || r.paymentNo.trim() === ""
            || typeof r?.status !== "string" || r.status.trim() === ""
            || typeof r?.postedEntryId !== "string" || r.postedEntryId.trim() === ""
            || typeof r?.entryNo !== "string" || r.entryNo.trim() === ""
            || typeof r?.amountSigned !== "string" || r.amountSigned.trim() === ""
            || typeof r?.accountId !== "string" || r.accountId.trim() === "") {
          throw new PaymentError("IDEMPOTENCY_INCONSISTENT", "Durable succeeded record is malformed — missing or invalid required fields.");
        }
        // r21: validate status exactly "posted"
        if (r.status !== "posted") {
          throw new PaymentError("IDEMPOTENCY_INCONSISTENT", "Durable succeeded record: status is not 'posted'.");
        }
        // r21: validate canonical money + non-zero
        if (!isValidCanonicalMoney(r.amountSigned)) {
          throw new PaymentError("IDEMPOTENCY_INCONSISTENT", "Durable succeeded record: amountSigned is not valid canonical money.");
        }
        if (isZeroMoney(r.amountSigned)) {
          throw new PaymentError("IDEMPOTENCY_INCONSISTENT", "Durable succeeded record: amountSigned is zero.");
        }
        return { ...r, action: "replayed" } as PostPaymentResult;
      }
      if (claim.record.state === "business_failed") {
        // r24 BLOCKER E: hardened runtime type check — must be non-empty
        // strings, not just truthy.
        const errorBody = claim.record.responseBody as { code?: unknown; message?: unknown } | null;
        if (typeof errorBody?.code !== "string" || errorBody.code.trim() === ""
            || typeof errorBody?.message !== "string" || errorBody.message.trim() === "") {
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

    // r22 BLOCKER E: ALL mutable business-state checks moved inside the tx.
    // Pre-tx state checks removed — they were not durable (occurred before
    // claim for PaymentNotFound, and were duplicated inside tx for others).
    // The tx-internal lockPayment + re-read + state validation is the
    // authoritative path. Business failures are classified in the catch block.

    // Step 5-9: allocate entry number, create account entry via SubledgerService,
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
    // in one transaction. When absent, high-risk command execution fails closed with CONFIGURATION_ERROR. Unit tests MUST provide an explicit transaction adapter/factory.
    const executePosting = async (txScoped: {
      subledger: SubledgerService; paymentRepository: PaymentRepository;
      audit: AuditTransactionHandle; idempotency: IdempotencyTransactionHandle;
      documentSequence: DocumentSequenceTransactionHandle;
    }): Promise<PostPaymentResult> => {
      const subledger = txScoped.subledger;
      const paymentRepo = txScoped.paymentRepository;
      const audit = txScoped.audit;
      const idempotency = txScoped.idempotency;
      const documentSequence = txScoped.documentSequence;

      // r22 BLOCKER D: lock payment by requested ID — if absent, PaymentNotFoundError
      // is thrown inside the tx and classified as business_failed by the catch block.
      const lockedPayment = await paymentRepo.lockPayment(user.tenantId, input.paymentId);
      if (!lockedPayment) {
        throw new PaymentNotFoundError(input.paymentId);
      }
      requireTenantMatch(user, lockedPayment.tenantId);
      // r22 BLOCKER E: validate mutable state from locked row
      if (lockedPayment.status === "posted") {
        throw new PaymentAlreadyPostedError(lockedPayment.id);
      }
      if (lockedPayment.status !== "draft") {
        throw new PaymentNotPostableError(lockedPayment.id, lockedPayment.status);
      }
      // Derive entry type from locked payment's account
      const lockedAccount = await subledger.findAccountById(user.tenantId, lockedPayment.accountId);
      if (!lockedAccount) {
        throw new PaymentError("INTERNAL_TRANSACTION_FAILED", `Account '${lockedPayment.accountId}' not found for payment.`);
      }
      const ownerType = lockedAccount.ownerType as AccountOwnerType;
      const { entryType, signMultiplier } = deriveEntryTypeAndSign(ownerType, lockedPayment.paymentDirection);
      const amountSigned = signMultiplier === -1 ? negateMoney(lockedPayment.amount) : lockedPayment.amount;
      const paymentNonNull = lockedPayment;

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
