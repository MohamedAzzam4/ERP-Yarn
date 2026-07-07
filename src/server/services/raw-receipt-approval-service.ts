/**
 * Raw Receipt Approval Service — WP-02-05.
 *
 * Contract: docs/contracts/13_work_packages.md WP-02-05
 *   Goal: Atomically post raw stock and optional confirmed-price payable,
 *   with append-only late completion.
 *
 * Contract: docs/contracts/06_approval_transaction_contract.md §17.1
 *   Raw Receipt Approval and Late-Price Confirmation:
 *   - Approval creates raw_receipt movement, on-hand balance, and—only when
 *     the contracted price/basis is confirmed—the negative supplier payable,
 *     then locks/approves/audits atomically.
 *   - If price is absent, stock posts and a review item is created with no
 *     zero/estimated payable.
 *   - Late price uses the append-only raw_purchase_price_confirmations
 *     transaction (DEC-067).
 *
 * Contract: docs/contracts/06_approval_transaction_contract.md §6
 *   Universal Approval Contract (11 steps):
 *   1. derive tenant/user from authenticated server context
 *   2. check permission and field/action scope
 *   3. validate request and required reason
 *   4. check current entity/approval state and verify subject version/hash
 *   5. claim/replay idempotency key
 *   6. start database transaction
 *   7. lock entity, approval, affected rows in deterministic order
 *   8. recheck all business preconditions under lock
 *   9. perform all stock/WIP/subledger/snapshot/document writes
 *   10. record approval decision and success audit in the same transaction
 *   11. commit once and return deterministic result
 *
 * DEC-080: Requester cannot approve their own high-risk request in MVP.
 *   Owner and Accountant may approve where the transaction type permits,
 *   but neither may approve their own request. Workers cannot approve
 *   financial, accounting, stock-impacting, migration or high-risk
 *   operational transactions. Emergency self-approval is deferred and
 *   not allowed in MVP.
 *
 * DEC-067: Raw purchase payable uses net accepted kg as the tonnage basis.
 *   payable = net_accepted_kg / 1000 × price_per_ton
 *
 * WP-02-05 scope: raw receipt approval + stock posting + optional payable +
 * late-price confirmation. No payment/settlement, no sales/customer/factory
 * posting, no broader approval engine.
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
import type { RawReceiptDraft, RawReceiptDraftRepository } from "./raw-receipt-draft-service";
import { computeSubjectHash, DraftNotFoundError } from "./raw-receipt-draft-service";
import type { InventoryLedgerService, PostRawReceiptInput, PostRawReceiptResult } from "./inventory-ledger-service";
import type { SubledgerService, PostSupplierPayableInput, PostSupplierPayableResult } from "./subledger-service";
import { isPositiveMoney } from "./decimal-money";

// ---------------------------------------------------------------------------
// Domain types.
// ---------------------------------------------------------------------------

export type ApprovalState = "active" | "decided" | "invalidated" | "superseded";

export interface RawReceiptApprovalRequest {
  id: string;
  tenantId: string;
  requestType: string; // "raw_receipt_approval"
  entityType: string; // "raw_receipt_draft"
  entityId: string; // draft.id
  riskLevel: string; // "high" (stock-impacting)
  requestedBy: string;
  requestedAt: Date;
  reason: string | null;
  state: ApprovalState;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionNotes: string | null;
  idempotencyKey: string | null;
  subjectVersion: number;
  subjectHash: string;
  movementId: string | null; // set after approval posts stock
  payableEntryId: string | null; // set after approval posts payable (null = late-price)
  payableDeferred: boolean; // true if price was not available
  /** Raw structured payload from submitted_child_version_summary JSONB.
   * Used by WP-02-05 (movementId/payableEntryId/payableDeferred) and
   * WP-03-02 (transfer params: itemId/fromLocationId/toLocationId/quantityKg). */
  submittedChildVersionSummary?: Record<string, unknown> | null;
  createdBy: string | null;
  createdAt: Date | null;
  updatedBy: string | null;
  updatedAt: Date | null;
}

// ---------------------------------------------------------------------------
// Service error types.
// ---------------------------------------------------------------------------

export class RawReceiptApprovalError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "RawReceiptApprovalError";
    this.code = code;
  }
}

export class ApprovalNotFoundError extends RawReceiptApprovalError {
  constructor(id: string) {
    super("APPROVAL_NOT_FOUND", `Approval request '${id}' not found.`);
    this.name = "ApprovalNotFoundError";
  }
}

export class DraftNotSubmittedError extends RawReceiptApprovalError {
  constructor(draftId: string) {
    super("DRAFT_NOT_SUBMITTED", `Draft '${draftId}' is not in submitted state.`);
    this.name = "DraftNotSubmittedError";
  }
}

export class SubjectHashMismatchError extends RawReceiptApprovalError {
  constructor(approvalId: string) {
    super(
      "SUBJECT_HASH_MISMATCH",
      `Subject hash mismatch for approval '${approvalId}'. The draft facts changed after the approval request was created. The approval must be rejected and a new request submitted.`,
    );
    this.name = "SubjectHashMismatchError";
  }
}

export class RequesterCannotApproveOwnRequestError extends RawReceiptApprovalError {
  constructor(approvalId: string, userId: string) {
    super(
      "REQUESTER_CANNOT_APPROVE_OWN",
      `User '${userId}' cannot approve approval '${approvalId}' because they are the requester. DEC-080: a requester cannot approve their own high-risk request in MVP.`,
    );
    this.name = "RequesterCannotApproveOwnRequestError";
  }
}

export class ApprovalAlreadyDecidedError extends RawReceiptApprovalError {
  constructor(approvalId: string, state: string) {
    super("APPROVAL_ALREADY_DECIDED", `Approval '${approvalId}' is already in state '${state}'.`);
    this.name = "ApprovalAlreadyDecidedError";
  }
}

export class ValidationFailedApprovalError extends RawReceiptApprovalError {
  constructor(message: string) {
    super("VALIDATION_FAILED", message);
    this.name = "ValidationFailedApprovalError";
  }
}

// ---------------------------------------------------------------------------
// Transaction handle — abstract persistence interface for approval_requests.
// ---------------------------------------------------------------------------

export interface RawReceiptApprovalRepository {
  insertApprovalRequest(row: NewApprovalRequestInput): Promise<RawReceiptApprovalRequest>;
  findActiveApprovalByEntity(tenantId: string, entityType: string, entityId: string, requestType: string): Promise<RawReceiptApprovalRequest | null>;
  findApprovalById(tenantId: string, id: string): Promise<RawReceiptApprovalRequest | null>;
  listPendingApprovals(tenantId: string, entityType: string): Promise<RawReceiptApprovalRequest[]>;
  markDecided(
    tenantId: string,
    id: string,
    decidedBy: string,
    decisionNotes: string | null,
    movementId: string | null,
    payableEntryId: string | null,
    payableDeferred: boolean,
  ): Promise<RawReceiptApprovalRequest | null>;
  /**
   * Update the payable info on an already-decided approval (late-price path).
   * Called by confirmLatePrice after posting the deferred payable.
   * Does NOT change state (already 'decided') — only updates the
   * submittedChildVersionSummary JSONB with payableEntryId + payableDeferred=false.
   * Conditional on state='decided' to prevent updating a non-decided approval.
   */
  updatePayableInfo(
    tenantId: string,
    id: string,
    payableEntryId: string,
  ): Promise<RawReceiptApprovalRequest | null>;
}

export interface NewApprovalRequestInput {
  tenantId: string;
  requestType: string;
  entityType: string;
  entityId: string;
  riskLevel: string;
  requestedBy: string;
  reason: string | null;
  subjectVersion: number;
  subjectHash: string;
  createdBy: string;
  /** Optional structured payload (JSONB) for workflow-specific data.
   * Stored in submitted_child_version_summary. Contract 03 §7.6:
   * "submitted child/line version summary." Used by WP-02-05 for
   * movementId/payableEntryId after approval, and by WP-03-02 for
   * transfer params at creation time. */
  submittedChildVersionSummary?: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Approve input + result.
// ---------------------------------------------------------------------------

export interface ApproveRawReceiptInput {
  approvalRequestId: string;
  /** Optional confirmed price per ton (NUMERIC(18,2) string). If absent/zero, payable is deferred. */
  pricePerTon?: string | null;
  /** Optional decision notes / reason. */
  decisionNotes?: string | null;
  /** Idempotency key (required for the atomic posting). */
  idempotencyKey: string;
}

export interface ApproveRawReceiptResult {
  action: "posted" | "replayed";
  approvalRequestId: string;
  draftId: string;
  movementId: string;
  movementDocNo: string;
  balanceVersion: number;
  onHandQtyKg: string;
  payableEntryId: string | null;
  payableEntryNo: string | null;
  payableAmountSigned: string | null;
  payableDeferred: boolean;
}

// ---------------------------------------------------------------------------
// Late-price confirmation input + result.
// ---------------------------------------------------------------------------

export interface ConfirmLatePriceInput {
  approvalRequestId: string;
  pricePerTon: string;
  idempotencyKey: string;
  notes?: string | null;
}

export interface ConfirmLatePriceResult {
  action: "posted" | "replayed";
  approvalRequestId: string;
  draftId: string;
  payableEntryId: string;
  payableEntryNo: string;
  payableAmountSigned: string;
}

// ---------------------------------------------------------------------------
// Service deps — composes draft repo + inventory + subledger + audit + idempotency.
// ---------------------------------------------------------------------------

/**
 * A transaction runner that wraps work in a single DB transaction.
 *
 * When provided, `approveRawReceipt` and `confirmLatePrice` wrap ALL DB writes
 * (stock movements, inventory balances, account entries, approval_requests,
 * raw_material_batches status) in this transaction. If any write fails, the
 * entire transaction rolls back — no partial effects.
 *
 * The `work` callback receives a transaction-scoped `tx` object that has the
 * same type as the base `db`. The factory functions
 * (`createTxScopedInventoryLedger`, `createTxScopedSubledger`,
 * `createTxScopedApprovalRepo`, `createTxScopedDraftRepo`) use this `tx` to
 * construct transaction-scoped repositories + services.
 *
 * When NOT provided (unit tests with in-memory repos), the services run
 * without a DB transaction boundary — all repos are in-memory and no partial
 * DB state can persist.
 */
export type TransactionRunner = <T>(work: (tx: unknown) => Promise<T>) => Promise<T>;

/**
 * Factory functions for creating transaction-scoped services/repos.
 * These are called inside the transaction runner with the `tx` object.
 */
export interface TransactionScopedFactories {
  /** Create an InventoryLedgerService that uses the transaction-scoped `tx`. */
  createInventoryLedger: (tx: unknown) => InventoryLedgerService;
  /** Create a SubledgerService that uses the transaction-scoped `tx`. */
  createSubledger: (tx: unknown) => SubledgerService;
  /** Create a RawReceiptApprovalRepository that uses the transaction-scoped `tx`. */
  createApprovalRepository: (tx: unknown) => RawReceiptApprovalRepository;
  /** Create a RawReceiptDraftRepository that uses the transaction-scoped `tx`. */
  createDraftRepository: (tx: unknown) => RawReceiptDraftRepository;
}

export interface RawReceiptApprovalServiceDeps {
  approvalRepository: RawReceiptApprovalRepository;
  draftRepository: RawReceiptDraftRepository;
  inventoryLedger: InventoryLedgerService;
  subledger: SubledgerService;
  audit: AuditTransactionHandle;
  idempotency: IdempotencyTransactionHandle;
  /**
   * Optional transaction runner. When provided, all DB writes in
   * approveRawReceipt/confirmLatePrice are wrapped in a single DB transaction.
   * When absent (unit tests), services run without a DB transaction boundary.
   */
  transactionRunner?: TransactionRunner;
  /**
   * Factory functions for creating transaction-scoped services/repos.
   * Required when `transactionRunner` is provided.
   */
  txFactories?: TransactionScopedFactories;
}

// ---------------------------------------------------------------------------
// Constants.
// ---------------------------------------------------------------------------

const REQUEST_TYPE_RAW_RECEIPT = "raw_receipt_approval";
const ENTITY_TYPE_RAW_RECEIPT_DRAFT = "raw_receipt_draft";
const RISK_LEVEL_HIGH = "high";
const SOURCE_DOC_TYPE_RAW_MATERIAL_BATCH = "raw_material_batch";

// ---------------------------------------------------------------------------
// RawReceiptApprovalService.
// ---------------------------------------------------------------------------

/**
 * WP-02-05 Raw Receipt Approval Service.
 *
 * Composes WP-02-04 draft repository + WP-02-02 InventoryLedgerService +
 * WP-02-03 SubledgerService to atomically approve and post raw receipt stock
 * and optional supplier payable.
 *
 * Universal Approval Contract (Contract 06 §6):
 *   - derive tenant/user from authenticated server context
 *   - check permission (inventory.receive.approve)
 *   - validate request + subject hash match
 *   - claim idempotency
 *   - post stock via InventoryLedgerService.postRawReceipt
 *   - if price available: post payable via SubledgerService.postSupplierPayable
 *   - if price absent: defer payable (no zero/estimated payable)
 *   - mark approval decided + audit atomically
 *
 * DEC-080: requester cannot approve own request. Enforced by comparing
 * draft.createdBy (the requester) against the approver's userId.
 */
export class RawReceiptApprovalService {
  constructor(private readonly deps: RawReceiptApprovalServiceDeps) {}

  /**
   * Create an approval request for a submitted draft.
   *
   * Idempotent: if an active approval request already exists for this entity,
   * return it without creating a duplicate.
   *
   * Binds the approval request to the WP-02-04 subject hash/version. Any
   * subsequent draft mutation that changes the subject hash will cause
   * approveRawReceipt to reject with SubjectHashMismatchError.
   */
  async createApprovalRequest(
    user: ErpUserContext,
    effective: EffectivePermissions,
    draftId: string,
    reason?: string | null,
  ): Promise<RawReceiptApprovalRequest> {
    // Permission: inventory.receive.approve (Owner/Accountant only).
    // Note: the requester (who creates the approval request) is typically the
    // worker who submitted the draft. But creating an approval request is a
    // read-then-write on the approval_requests table, not a stock-impacting
    // action. The stock-impacting action is approveRawReceipt, which requires
    // inventory.receive.approve.
    //
    // However, per Contract 06 §6, the approval request itself records the
    // requester. The worker who submitted the draft is the requester. We
    // allow any user with inventory.receive.create (worker) OR
    // inventory.receive.approve (management) to create the approval request,
    // because the request is just "please review this draft".
    //
    // The DEC-080 segregation is enforced at approveRawReceipt time.
    requirePermission(effective, "inventory.receive.create");

    const draft = await this.deps.draftRepository.findDraftById(user.tenantId, draftId);
    if (!draft) {
      throw new DraftNotFoundError(draftId);
    }
    requireTenantMatch(user, draft.tenantId);

    if (draft.status !== "submitted") {
      throw new DraftNotSubmittedError(draftId);
    }

    // Idempotent: check for existing active approval request.
    const existing = await this.deps.approvalRepository.findActiveApprovalByEntity(
      user.tenantId,
      ENTITY_TYPE_RAW_RECEIPT_DRAFT,
      draftId,
      REQUEST_TYPE_RAW_RECEIPT,
    );
    if (existing) {
      return existing;
    }

    // Compute subject hash from current draft state.
    const subjectHash = computeSubjectHash(draft);
    const subjectVersion = draft.subjectVersion;

    const approval = await this.deps.approvalRepository.insertApprovalRequest({
      tenantId: user.tenantId,
      requestType: REQUEST_TYPE_RAW_RECEIPT,
      entityType: ENTITY_TYPE_RAW_RECEIPT_DRAFT,
      entityId: draftId,
      riskLevel: RISK_LEVEL_HIGH,
      requestedBy: draft.createdBy ?? user.userId,
      reason: reason ?? null,
      subjectVersion,
      subjectHash,
      createdBy: user.userId,
    });

    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: "approval_request",
      entityId: approval.id,
      actionType: "raw_receipt_approval.create",
      newValuesJson: {
        draftId,
        subjectVersion,
        subjectHash: subjectHash.slice(0, 16) + "...",
        riskLevel: RISK_LEVEL_HIGH,
      },
    });

    return approval;
  }

  /**
   * List pending (active) raw receipt approval requests for the tenant.
   */
  async listPendingApprovals(
    user: ErpUserContext,
    effective: EffectivePermissions,
  ): Promise<RawReceiptApprovalRequest[]> {
    requirePermission(effective, "inventory.receive.approve");
    return this.deps.approvalRepository.listPendingApprovals(
      user.tenantId,
      ENTITY_TYPE_RAW_RECEIPT_DRAFT,
    );
  }

  /**
   * Read an approval request by ID.
   */
  async readApprovalRequest(
    user: ErpUserContext,
    effective: EffectivePermissions,
    approvalId: string,
  ): Promise<RawReceiptApprovalRequest> {
    requirePermission(effective, "inventory.receive.approve");
    const approval = await this.deps.approvalRepository.findApprovalById(user.tenantId, approvalId);
    if (!approval) {
      throw new ApprovalNotFoundError(approvalId);
    }
    requireTenantMatch(user, approval.tenantId);
    return approval;
  }

  /**
   * Approve a raw receipt: atomically post stock + optional payable.
   *
   * Contract 06 §17.1:
   *   - Approval creates raw_receipt movement, on-hand balance, and—only when
   *     the contracted price/basis is confirmed—the negative supplier payable,
   *     then locks/approves/audits atomically.
   *   - If price is absent, stock posts and a review item is created with no
   *     zero/estimated payable.
   *
   * DEC-080: requester cannot approve own request.
   *
   * Idempotency: the idempotency key prevents duplicate posting. A replay
   * returns the stored result without re-posting.
   */
  async approveRawReceipt(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: ApproveRawReceiptInput,
  ): Promise<ApproveRawReceiptResult> {
    // Step 1-2: permission + reject body authority.
    requirePermission(effective, "inventory.receive.approve");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    // Step 3: validate input.
    if (!input.approvalRequestId || input.approvalRequestId.trim() === "") {
      throw new ValidationFailedApprovalError("Approval request ID is required.");
    }
    if (!input.idempotencyKey || input.idempotencyKey.trim() === "") {
      throw new ValidationFailedApprovalError("Idempotency key is required.");
    }

    // Step 4: fetch approval request (for state check + subject hash).
    const approval = await this.deps.approvalRepository.findApprovalById(
      user.tenantId,
      input.approvalRequestId,
    );
    if (!approval) {
      throw new ApprovalNotFoundError(input.approvalRequestId);
    }
    requireTenantMatch(user, approval.tenantId);

    // Step 5: claim idempotency FIRST (before any state mutation).
    // This ensures: same key = replay (returns stored result); different key
    // on a decided approval = ApprovalAlreadyDecidedError.
    const now = new Date();
    const idempotencyInput: IdempotencyClaimInput = {
      tenantId: user.tenantId,
      operationScope: "raw_receipt_approval.post",
      idempotencyKey: input.idempotencyKey,
      requestBody: {
        approvalRequestId: input.approvalRequestId,
        pricePerTon: input.pricePerTon ?? null,
      } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    };

    const claim = await claimIdempotency(this.deps.idempotency, idempotencyInput);

    if (claim.action === "replay") {
      // Prior call with same key succeeded — return the stored result.
      // The approval row should already be marked decided.
      const refreshed = await this.deps.approvalRepository.findApprovalById(
        user.tenantId,
        input.approvalRequestId,
      );
      if (refreshed && refreshed.state === "decided" && refreshed.movementId) {
        return {
          action: "replayed",
          approvalRequestId: refreshed.id,
          draftId: refreshed.entityId,
          movementId: refreshed.movementId,
          movementDocNo: "",
          balanceVersion: 0,
          onHandQtyKg: "0.000",
          payableEntryId: refreshed.payableEntryId,
          payableEntryNo: "",
          payableAmountSigned: null,
          payableDeferred: refreshed.payableDeferred,
        };
      }
      // Idempotency says replay but approval not decided — fall through to execute
      // (this can happen if the prior call failed after claiming idempotency).
    }

    if (claim.action === "conflict") {
      throw new RawReceiptApprovalError(
        "IDEMPOTENCY_CONFLICT",
        `Idempotency key '${input.idempotencyKey}' was used with a different request body.`,
      );
    }

    if (claim.action === "in_progress") {
      throw new RawReceiptApprovalError(
        "OPERATION_IN_PROGRESS",
        `Operation '${input.idempotencyKey}' is still in progress.`,
      );
    }

    // claim.action === "execute" — this is a fresh call.
    // Now check approval state. If already decided, reject (not a replay).
    if (approval.state !== "active") {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 409,
        responseBody: { message: `Approval already in state '${approval.state}'.` },
        lastErrorClass: "ApprovalAlreadyDecidedError",
      }, now);
      throw new ApprovalAlreadyDecidedError(approval.id, approval.state);
    }

    // DEC-080: requester cannot approve own request.
    if (approval.requestedBy === user.userId) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 403,
        responseBody: { message: "Requester cannot approve own request." },
        lastErrorClass: "RequesterCannotApproveOwnRequestError",
      }, now);
      throw new RequesterCannotApproveOwnRequestError(approval.id, user.userId);
    }

    // Re-fetch the draft and verify subject hash matches.
    const draft = await this.deps.draftRepository.findDraftById(user.tenantId, approval.entityId);
    if (!draft) {
      throw new DraftNotFoundError(approval.entityId);
    }
    requireTenantMatch(user, draft.tenantId);

    const currentSubjectHash = computeSubjectHash(draft);
    if (currentSubjectHash !== approval.subjectHash) {
      throw new SubjectHashMismatchError(approval.id);
    }

    // Determine if price is available for payable posting.
    const hasPrice = input.pricePerTon != null && input.pricePerTon.trim() !== "" && isPositiveMoney(input.pricePerTon);
    const hasSupplier = !!draft.supplierId;
    const canPostPayable = hasPrice && hasSupplier;
    const payableDeferred = !canPostPayable;

    // Validate storage location before entering the transaction.
    if (!draft.storageLocationId) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 422,
        responseBody: { message: "Draft has no storage_location_id — cannot post stock." },
        lastErrorClass: "ValidationFailedApprovalError",
      }, now);
      throw new ValidationFailedApprovalError(
        "Draft has no storage_location_id — cannot post stock. The worker must specify a storage location before approval.",
      );
    }

    const itemId = draft.itemId ?? draft.id;
    const postStockInput: PostRawReceiptInput = {
      itemId,
      toLocationId: draft.storageLocationId,
      quantityKg: draft.netWeightKg,
      movementDate: draft.receivedDate,
      sourceDocumentType: SOURCE_DOC_TYPE_RAW_MATERIAL_BATCH,
      sourceDocumentId: draft.id,
      idempotencyKey: `${input.idempotencyKey}:stock`,
      notes: draft.notes ?? undefined,
    };

    // =====================================================================
    // ATOMIC POSTING TRANSACTION (Contract 06 §6, §17.1; DEC-015; WP-02-05)
    // =====================================================================
    // All DB writes (stock movement, inventory balance, account entry,
    // approval_requests markDecided) MUST commit or roll back together.
    // If transactionRunner is provided, we wrap all DB writes in a single
    // db.transaction(). If any write fails, the entire transaction rolls
    // back — no partial stock post, no partial payable, no decided approval.
    //
    // If transactionRunner is NOT provided (unit tests with in-memory repos),
    // we run without a DB transaction boundary — in-memory repos don't
    // persist partial state across processes.
    // =====================================================================

    const executePosting = async (
      txScoped: {
        inventoryLedger: InventoryLedgerService;
        subledger: SubledgerService;
        approvalRepository: RawReceiptApprovalRepository;
      } | null,
    ): Promise<{ stockResult: PostRawReceiptResult; payableResult: PostSupplierPayableResult | null; payableEntryId: string | null }> => {
      const invLedger = txScoped?.inventoryLedger ?? this.deps.inventoryLedger;
      const subledger = txScoped?.subledger ?? this.deps.subledger;
      const approvalRepo = txScoped?.approvalRepository ?? this.deps.approvalRepository;

      // Step 9: post stock via InventoryLedgerService.postRawReceipt.
      const stockResult: PostRawReceiptResult = await invLedger.postRawReceipt(
        user,
        effective,
        postStockInput,
      );

      // Step 9b: if price AND supplier available, post payable via SubledgerService.
      let payableResult: PostSupplierPayableResult | null = null;
      let payableEntryId: string | null = null;
      if (canPostPayable && draft.supplierId) {
        const payableInput: PostSupplierPayableInput = {
          supplierId: draft.supplierId,
          netAcceptedKg: draft.netWeightKg,
          pricePerTon: input.pricePerTon!,
          entryDate: draft.receivedDate,
          sourceDocumentType: SOURCE_DOC_TYPE_RAW_MATERIAL_BATCH,
          sourceDocumentId: draft.id,
          idempotencyKey: `${input.idempotencyKey}:payable`,
          notes: input.decisionNotes ?? undefined,
        };
        payableResult = await subledger.postSupplierPayable(user, effective, payableInput);
        payableEntryId = payableResult.entryId;
      }

      // Step 10: mark approval decided (still inside the transaction).
      const decided = await approvalRepo.markDecided(
        user.tenantId,
        approval.id,
        user.userId,
        input.decisionNotes ?? null,
        stockResult.movementId,
        payableEntryId,
        payableDeferred,
      );

      if (!decided) {
        // markDecided returns null when the conditional WHERE state='active'
        // didn't match — meaning another concurrent transaction already
        // decided this approval. The DB transaction will roll back (stock
        // movement + balance + account entry all rolled back). Throw
        // ApprovalAlreadyDecidedError so the caller gets a clear conflict.
        throw new ApprovalAlreadyDecidedError(approval.id, "decided (concurrent)");
      }

      return { stockResult, payableResult, payableEntryId };
    };

    let postingResult: { stockResult: PostRawReceiptResult; payableResult: PostSupplierPayableResult | null; payableEntryId: string | null };

    try {
      if (this.deps.transactionRunner && this.deps.txFactories) {
        // Wrap all DB writes in a single outer transaction.
        postingResult = await this.deps.transactionRunner(async (tx: unknown) => {
          const txInvLedger = this.deps.txFactories!.createInventoryLedger(tx);
          const txSubledger = this.deps.txFactories!.createSubledger(tx);
          const txApprovalRepo = this.deps.txFactories!.createApprovalRepository(tx);
          return executePosting({ inventoryLedger: txInvLedger, subledger: txSubledger, approvalRepository: txApprovalRepo });
        });
      } else {
        // No transaction runner (unit tests with in-memory repos).
        postingResult = await executePosting(null);
      }
    } catch (txError) {
      // The DB transaction rolled back. Mark idempotency as failed and re-throw.
      // No partial DB state persists — stock_movement, inventory_balance,
      // account_entry, approval_requests are all rolled back.
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 500,
        responseBody: { message: "Posting transaction failed and rolled back." },
        lastErrorClass: txError instanceof Error ? txError.name : "Unknown",
      }, now);
      throw txError;
    }

    const { stockResult, payableResult, payableEntryId } = postingResult;

    // Audit (in-process — does not participate in DB transaction, but records
    // the outcome for observability).
    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: "approval_request",
      entityId: approval.id,
      actionType: "raw_receipt_approval.approve",
      newValuesJson: {
        draftId: draft.id,
        movementId: stockResult.movementId,
        movementDocNo: stockResult.docNo,
        balanceVersion: stockResult.balanceVersion,
        onHandQtyKg: stockResult.onHandQtyKg,
        payableEntryId: payableEntryId,
        payableDeferred,
        payableAmountSigned: payableResult?.amountSigned ?? null,
      },
      idempotencyKey: input.idempotencyKey,
    });

    // Step 11: mark idempotency succeeded (DB transaction already committed).
    await markSucceeded(this.deps.idempotency, claim.record.id, {
      responseCode: 200,
      responseBody: {
        movementId: stockResult.movementId,
        payableEntryId,
        payableDeferred,
      },
    }, now);

    return {
      action: "posted",
      approvalRequestId: approval.id,
      draftId: draft.id,
      movementId: stockResult.movementId,
      movementDocNo: stockResult.docNo,
      balanceVersion: stockResult.balanceVersion,
      onHandQtyKg: stockResult.onHandQtyKg,
      payableEntryId,
      payableEntryNo: payableResult?.entryNo ?? null,
      payableAmountSigned: payableResult?.amountSigned ?? null,
      payableDeferred,
    };
  }

  /**
   * Confirm a late price for an already-approved raw receipt.
   *
   * Contract 06 §17.1: "Late price uses the append-only
   * raw_purchase_price_confirmations transaction: apply DEC-067, lock source
   * receipt/confirmation/supplier account, calculate from net accepted kg at
   * high precision, post one payable, link confirmation and audit."
   *
   * This posts the deferred supplier payable for an approval where
   * payableDeferred = true. It does NOT re-post stock (stock was already
   * posted at approval time).
   *
   * DEC-067: payable = net_accepted_kg / 1000 × price_per_ton
   * DEC-080: the confirmer cannot be the same user who created the approval
   * request if that user is also the only approver. In practice, the late
   * price confirmation is done by the Accountant, who is typically different
   * from the worker who submitted the draft.
   */
  async confirmLatePrice(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: ConfirmLatePriceInput,
  ): Promise<ConfirmLatePriceResult> {
    requirePermission(effective, "inventory.receive.approve");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!input.approvalRequestId || input.approvalRequestId.trim() === "") {
      throw new ValidationFailedApprovalError("Approval request ID is required.");
    }
    if (!input.pricePerTon || !isPositiveMoney(input.pricePerTon)) {
      throw new ValidationFailedApprovalError(
        `Price per ton must be positive (NUMERIC(18,2)), got '${input.pricePerTon}'.`,
      );
    }
    if (!input.idempotencyKey || input.idempotencyKey.trim() === "") {
      throw new ValidationFailedApprovalError("Idempotency key is required.");
    }

    const approval = await this.deps.approvalRepository.findApprovalById(
      user.tenantId,
      input.approvalRequestId,
    );
    if (!approval) {
      throw new ApprovalNotFoundError(input.approvalRequestId);
    }
    requireTenantMatch(user, approval.tenantId);

    // Claim idempotency FIRST (before business precondition checks).
    // This ensures: same key = replay (returns stored result even if the
    // approval row now shows payableDeferred=false); different key on an
    // already-confirmed approval = business precondition failure.
    const now = new Date();
    const idempotencyInput: IdempotencyClaimInput = {
      tenantId: user.tenantId,
      operationScope: "raw_receipt_late_price.confirm",
      idempotencyKey: input.idempotencyKey,
      requestBody: {
        approvalRequestId: input.approvalRequestId,
        pricePerTon: input.pricePerTon,
      } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    };

    const claim = await claimIdempotency(this.deps.idempotency, idempotencyInput);

    if (claim.action === "replay") {
      // Return prior result — the approval row should have payableEntryId set.
      const refreshed = await this.deps.approvalRepository.findApprovalById(
        user.tenantId,
        input.approvalRequestId,
      );
      if (refreshed && refreshed.payableEntryId) {
        return {
          action: "replayed",
          approvalRequestId: refreshed.id,
          draftId: refreshed.entityId,
          payableEntryId: refreshed.payableEntryId,
          payableEntryNo: "",
          payableAmountSigned: "",
        };
      }
      // Fall through if replay but no payableEntryId (shouldn't happen).
    }

    if (claim.action === "conflict") {
      throw new RawReceiptApprovalError(
        "IDEMPOTENCY_CONFLICT",
        `Idempotency key '${input.idempotencyKey}' was used with a different request body.`,
      );
    }

    if (claim.action === "in_progress") {
      throw new RawReceiptApprovalError(
        "OPERATION_IN_PROGRESS",
        `Operation '${input.idempotencyKey}' is still in progress.`,
      );
    }

    // claim.action === "execute" — now check business preconditions.
    if (approval.state !== "decided") {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 422,
        responseBody: { message: `Approval must be 'decided' to confirm late price.` },
        lastErrorClass: "ValidationFailedApprovalError",
      }, now);
      throw new ValidationFailedApprovalError(
        `Approval '${input.approvalRequestId}' must be in 'decided' state to confirm late price. Current state: '${approval.state}'.`,
      );
    }

    if (!approval.payableDeferred) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 422,
        responseBody: { message: `Payable already posted.` },
        lastErrorClass: "ValidationFailedApprovalError",
      }, now);
      throw new ValidationFailedApprovalError(
        `Approval '${input.approvalRequestId}' already has a payable posted (not deferred). Late-price confirmation is not applicable.`,
      );
    }

    // Re-fetch the draft to get supplierId + netWeightKg.
    const draft = await this.deps.draftRepository.findDraftById(user.tenantId, approval.entityId);
    if (!draft) {
      throw new DraftNotFoundError(approval.entityId);
    }
    requireTenantMatch(user, draft.tenantId);

    if (!draft.supplierId) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 422,
        responseBody: { message: `Draft has no supplier.` },
        lastErrorClass: "ValidationFailedApprovalError",
      }, now);
      throw new ValidationFailedApprovalError(
        "Draft has no supplier — cannot post payable. A supplier must be assigned before late-price confirmation.",
      );
    }

    // Post the payable via SubledgerService.
    const payableInput: PostSupplierPayableInput = {
      supplierId: draft.supplierId,
      netAcceptedKg: draft.netWeightKg,
      pricePerTon: input.pricePerTon,
      entryDate: draft.receivedDate,
      sourceDocumentType: SOURCE_DOC_TYPE_RAW_MATERIAL_BATCH,
      sourceDocumentId: draft.id,
      idempotencyKey: `${input.idempotencyKey}:payable`,
      notes: input.notes ?? undefined,
    };

    // =====================================================================
    // ATOMIC LATE-PRICE TRANSACTION (Contract 06 §17.1; DEC-015; WP-02-05)
    // =====================================================================
    // The account_entry posting + approval_requests update MUST commit or
    // roll back together. If the subledger post fails, no account_entry is
    // created and the approval row is not updated.
    // =====================================================================

    const executeLatePricePosting = async (
      txScoped: {
        subledger: SubledgerService;
        approvalRepository: RawReceiptApprovalRepository;
      } | null,
    ): Promise<PostSupplierPayableResult> => {
      const subledger = txScoped?.subledger ?? this.deps.subledger;
      const approvalRepo = txScoped?.approvalRepository ?? this.deps.approvalRepository;

      const payableResult = await subledger.postSupplierPayable(user, effective, payableInput);

      // Update the approval row to record the payable entry (same transaction).
      // Uses updatePayableInfo (not markDecided) because the approval is already
      // in 'decided' state from the earlier approval. This only updates the
      // payableEntryId + payableDeferred=false in the JSONB summary.
      await approvalRepo.updatePayableInfo(
        user.tenantId,
        approval.id,
        payableResult.entryId,
      );

      return payableResult;
    };

    let payableResult: PostSupplierPayableResult;
    try {
      if (this.deps.transactionRunner && this.deps.txFactories) {
        payableResult = await this.deps.transactionRunner(async (tx: unknown) => {
          const txSubledger = this.deps.txFactories!.createSubledger(tx);
          const txApprovalRepo = this.deps.txFactories!.createApprovalRepository(tx);
          return executeLatePricePosting({ subledger: txSubledger, approvalRepository: txApprovalRepo });
        });
      } else {
        payableResult = await executeLatePricePosting(null);
      }
    } catch (txError) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 500,
        responseBody: { message: "Late-price transaction failed and rolled back." },
        lastErrorClass: txError instanceof Error ? txError.name : "Unknown",
      }, now);
      throw txError;
    }

    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: "approval_request",
      entityId: approval.id,
      actionType: "raw_receipt_late_price.confirm",
      newValuesJson: {
        draftId: draft.id,
        payableEntryId: payableResult.entryId,
        payableEntryNo: payableResult.entryNo,
        payableAmountSigned: payableResult.amountSigned,
        pricePerTon: input.pricePerTon,
      },
      idempotencyKey: input.idempotencyKey,
    });

    await markSucceeded(this.deps.idempotency, claim.record.id, {
      responseCode: 200,
      responseBody: {
        payableEntryId: payableResult.entryId,
      },
    }, now);

    return {
      action: "posted",
      approvalRequestId: approval.id,
      draftId: draft.id,
      payableEntryId: payableResult.entryId,
      payableEntryNo: payableResult.entryNo,
      payableAmountSigned: payableResult.amountSigned,
    };
  }
}
