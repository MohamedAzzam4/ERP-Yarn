/**
 * Transfer Workflow Service — WP-03-02.
 *
 * Contract: docs/contracts/13_work_packages.md WP-03-02
 *   Goal: Atomically transfer stock and preserve history through inverse reversal.
 *   Expected outputs: Transfer draft/approval/reversal services and role-safe screens.
 *   Implementation notes: Source/destination commit together; no in-transit workflow.
 *   Acceptance: Exact source decrease/destination increase and original retained.
 *
 * Contract 04 §8.2: "One-step transfer: source -qty, destination +qty atomically."
 * Contract 04 §22: "Reversal: approved exact inverse; original retained."
 * Contract 06 §17.2: Transfer approval requires Owner/Accountant permission,
 *   subject hash, idempotency.
 *
 * WP-03-01 already has the primitives: InventoryLedgerService.postTransfer + postReversal.
 * This service builds the workflow layer on top:
 *   1. createTransferRequest — creates an approval_requests row for a transfer
 *   2. approveTransfer — calls postTransfer via InventoryLedgerService
 *   3. reverseMovement — calls postReversal via InventoryLedgerService
 *
 * DEC-080: requester cannot approve own transfer request.
 *
 * ATOMICITY CONTRACT (Contract 06 §6 — Universal Approval Contract):
 *   `approveTransfer` MUST commit `markDecided + postTransfer + movementId update`
 *   as a single DB transaction. If `postTransfer` fails, the approval MUST NOT be
 *   left in `decided` state. The ordering is:
 *     1. (outside tx) claim workflow-level idempotency
 *     2. (outside tx) check approval state, DEC-080, fetch payload
 *     3. (inside tx) postTransfer → markDecided(movementId, ...) LAST
 *     4. (outside tx) audit + markSucceeded on idempotency
 *   If `markDecided` returns null (concurrent loser), the transaction rolls back —
 *   no movement, no balance change, no decided approval.
 *   If `postTransfer` throws, the transaction rolls back — no movement, no decided
 *   approval. The caller can retry with a NEW idempotency key after fixing the cause.
 */
import "server-only";

import type { ErpUserContext } from "@/server/auth/erp-context";
import { requirePermission, requireTenantMatch, rejectBodyClaimsAuthority } from "@/server/security/guards";
import type { EffectivePermissions } from "@/server/security/effective-permissions";
import { appendAuditLog, type AuditTransactionHandle } from "./audit-service";
import {
  claimIdempotency,
  markSucceeded,
  markBusinessFailed,
  type IdempotencyTransactionHandle,
  type IdempotencyClaimInput,
} from "./idempotency-service";
import type { InventoryLedgerService, PostTransferInput, PostTransferResult, PostReversalInput, PostReversalResult } from "./inventory-ledger-service";
import type { RawReceiptApprovalRepository } from "./raw-receipt-approval-service";
import type { TenantOwnershipValidator } from "./db-tenant-ownership-validator";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Domain types.
// ---------------------------------------------------------------------------

export interface TransferRequest {
  id: string;
  tenantId: string;
  itemId: string;
  fromLocationId: string;
  toLocationId: string;
  quantityKg: string;
  reason: string | null;
  state: string; // "active" | "decided"
  requestedBy: string;
  decidedBy: string | null;
  subjectHash: string;
  subjectVersion: number;
  movementId: string | null;
}

export interface CreateTransferRequestInput {
  itemId: string;
  fromLocationId: string;
  toLocationId: string;
  quantityKg: string;
  reason?: string | null;
}

export interface ApproveTransferInput {
  transferRequestId: string;
  decisionNotes?: string | null;
  idempotencyKey: string;
}

export interface ReverseMovementInput {
  movementId: string;
  reason: string;
  idempotencyKey: string;
}

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

export class TransferWorkflowError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = "TransferWorkflowError"; this.code = code; }
}

export class TransferRequestNotFoundError extends TransferWorkflowError {
  constructor(id: string) { super("TRANSFER_REQUEST_NOT_FOUND", `Transfer request '${id}' not found.`); this.name = "TransferRequestNotFoundError"; }
}

export class TransferAlreadyDecidedError extends TransferWorkflowError {
  constructor(id: string, state: string) { super("TRANSFER_ALREADY_DECIDED", `Transfer request '${id}' is already '${state}'.`); this.name = "TransferAlreadyDecidedError"; }
}

export class TransferSubjectHashMismatchError extends TransferWorkflowError {
  constructor(id: string) { super("SUBJECT_HASH_MISMATCH", `Subject hash mismatch for transfer '${id}'.`); this.name = "TransferSubjectHashMismatchError"; }
}

export class TransferRequesterCannotApproveError extends TransferWorkflowError {
  constructor(id: string, userId: string) { super("REQUESTER_CANNOT_APPROVE", `User '${userId}' cannot approve transfer '${id}' (DEC-080).`); this.name = "TransferRequesterCannotApproveError"; }
}

// ---------------------------------------------------------------------------
// Subject hash.
// ---------------------------------------------------------------------------

function computeTransferSubjectHash(input: CreateTransferRequestInput): string {
  const fields = [input.itemId, input.fromLocationId, input.toLocationId, input.quantityKg];
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}

// ---------------------------------------------------------------------------
// Transaction runner + factories (mirrors RawReceiptApprovalService pattern).
// ---------------------------------------------------------------------------

/**
 * A transaction runner that wraps work in a single DB transaction.
 *
 * When provided, `approveTransfer` wraps ALL DB writes (stock movement,
 * inventory balance update, approval_requests markDecided) in this
 * transaction. If any write fails, the entire transaction rolls back —
 * no partial effects (no "decided but no movement" state).
 *
 * The `work` callback receives a transaction-scoped `tx` object. The
 * factory functions use this `tx` to construct transaction-scoped
 * repositories + services.
 *
 * When NOT provided (unit tests with in-memory repos), the services run
 * without a DB transaction boundary — tests must simulate rollback in
 * their mock transactionRunner if they want to verify atomicity.
 */
export type TransferTransactionRunner = <T>(work: (tx: unknown) => Promise<T>) => Promise<T>;

/**
 * Factory functions for creating transaction-scoped services/repos.
 * These are called inside the transaction runner with the `tx` object.
 */
export interface TransferTransactionScopedFactories {
  /** Create an InventoryLedgerService that uses the transaction-scoped `tx`. */
  createInventoryLedger: (tx: unknown) => InventoryLedgerService;
  /** Create a RawReceiptApprovalRepository that uses the transaction-scoped `tx`. */
  createApprovalRepository: (tx: unknown) => RawReceiptApprovalRepository;
}

// ---------------------------------------------------------------------------
// Service deps.
// ---------------------------------------------------------------------------

export interface TransferWorkflowServiceDeps {
  approvalRepository: RawReceiptApprovalRepository; // Reuses approval_requests table
  inventoryLedger: InventoryLedgerService;
  audit: AuditTransactionHandle;
  idempotency: IdempotencyTransactionHandle;
  /**
   * REQUIRED (WP-08-01A): tenant ownership + relation validator.
   *
   * Validates BEFORE any write that item, source location, and destination
   * location all belong to the actor's tenant, and that source ≠ destination.
   * A valid Tenant-B row used by Tenant-A MUST be rejected here, before the
   * idempotency claim or any DB write.
   *
   * Production: pass `DbTenantOwnershipValidator`.
   * Tests: pass a mock implementing `TenantOwnershipValidator`.
   */
  tenantOwnershipValidator: TenantOwnershipValidator;
  /**
   * Optional transaction runner. When provided, all DB writes in
   * approveTransfer are wrapped in a single DB transaction.
   * When absent (unit tests with in-memory repos), services run without
   * a DB transaction boundary.
   */
  transactionRunner?: TransferTransactionRunner;
  /**
   * Factory functions for creating transaction-scoped services/repos.
   * Required when `transactionRunner` is provided.
   */
  txFactories?: TransferTransactionScopedFactories;
}

const TRANSFER_REQUEST_TYPE = "stock_transfer";
const TRANSFER_ENTITY_TYPE = "transfer_request";

// ---------------------------------------------------------------------------
// TransferWorkflowService.
// ---------------------------------------------------------------------------

export class TransferWorkflowService {
  constructor(private readonly deps: TransferWorkflowServiceDeps) {}

  /**
   * Create a transfer request (draft → pending approval).
   *
   * Permission: inventory.transfer.create (warehouse can create draft).
   * The transfer is NOT posted — it waits for approval.
   */
  async createTransferRequest(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: CreateTransferRequestInput,
  ): Promise<TransferRequest> {
    requirePermission(effective, "inventory.transfer.create");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!input.itemId || !input.fromLocationId || !input.toLocationId) {
      throw new TransferWorkflowError("VALIDATION_FAILED", "itemId, fromLocationId, toLocationId are required.");
    }
    if (input.fromLocationId === input.toLocationId) {
      throw new TransferWorkflowError("VALIDATION_FAILED", "Source and destination must differ.");
    }
    // Validate positive quantity (raw check — the actual normalization happens at posting)
    const qty = parseFloat(input.quantityKg);
    if (isNaN(qty) || qty <= 0) {
      throw new TransferWorkflowError("VALIDATION_FAILED", `Quantity must be positive, got '${input.quantityKg}'.`);
    }

    // =====================================================================
    // WP-08-01A: Tenant ownership + relation validation.
    // BEFORE any write (subjectHash dedup query, approval_requests insert,
    // audit). A valid Tenant-B item/location used by Tenant-A MUST be
    // rejected here. Cross-tenant rejection produces ZERO writes.
    // =====================================================================
    await this.deps.tenantOwnershipValidator.validateItemBelongsToTenant(user.tenantId, input.itemId);
    await this.deps.tenantOwnershipValidator.validateLocationBelongsToTenant(user.tenantId, input.fromLocationId);
    await this.deps.tenantOwnershipValidator.validateLocationBelongsToTenant(user.tenantId, input.toLocationId);
    this.deps.tenantOwnershipValidator.validateSourceAndDestinationDiffer(input.fromLocationId, input.toLocationId);

    const subjectHash = computeTransferSubjectHash(input);

    // Store transfer params in submittedChildVersionSummary (JSONB, Contract 03 §7.6).
    // The `reason` field is used for the human-readable reason only.
    // entityId is a UUID column, so we generate a random UUID for the entity
    // and store the composite key (itemId:fromLoc:toLoc) in the payload.
    const transferParams = {
      itemId: input.itemId,
      fromLocationId: input.fromLocationId,
      toLocationId: input.toLocationId,
      quantityKg: input.quantityKg,
    };

    // Generate a UUID for this transfer entity
    const { randomUUID } = await import("node:crypto");
    const entityId = randomUUID();

    // Idempotency: check if an active transfer request with the same subjectHash
    // already exists for this tenant. The subjectHash is deterministic from the
    // transfer params, so identical params produce the same hash.
    const existingApprovals = await this.deps.approvalRepository.listPendingApprovals(
      user.tenantId, TRANSFER_ENTITY_TYPE,
    );
    const existing = existingApprovals.find(a => a.subjectHash === subjectHash && a.state === "active");
    if (existing) {
      return this.mapApprovalToTransfer(existing);
    }

    const approval = await this.deps.approvalRepository.insertApprovalRequest({
      tenantId: user.tenantId,
      requestType: TRANSFER_REQUEST_TYPE,
      entityType: TRANSFER_ENTITY_TYPE,
      entityId,
      riskLevel: "standard",
      requestedBy: user.userId,
      reason: input.reason ?? null, // human-readable reason only
      subjectVersion: 1,
      subjectHash,
      createdBy: user.userId,
      submittedChildVersionSummary: transferParams, // structured payload in JSONB
    });

    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: TRANSFER_ENTITY_TYPE,
      entityId: approval.id,
      actionType: "transfer_request.create",
      newValuesJson: { itemId: input.itemId, fromLocationId: input.fromLocationId, toLocationId: input.toLocationId, quantityKg: input.quantityKg },
    });

    return this.mapApprovalToTransfer(approval);
  }

  /**
   * Approve a transfer request and post the transfer movement atomically.
   *
   * Permission: inventory.transfer.approve (Owner/Accountant only).
   * DEC-080: requester cannot approve own request.
   *
   * ATOMICITY CONTRACT (Contract 06 §6 — Universal Approval Contract):
   *   1. (outside tx) permission + validation + idempotency claim + state checks
   *   2. (inside tx) postTransfer → markDecided(movementId, ...) LAST
   *   3. (outside tx) audit + markSucceeded
   *
   * The `markDecided` is the LAST write inside the transaction, with conditional
   * `WHERE state='active'`. This means:
   *   - If `postTransfer` fails → tx rolls back, no movement, approval stays 'active'.
   *   - If `markDecided` returns null (concurrent loser already decided) → tx rolls
   *     back, no movement from this caller, the winner's movement persists.
   *   - If both succeed → tx commits atomically (movement + decided approval together).
   *
   * This closes the "decided but no movement" atomicity gap: it is impossible
   * for the approval to be `decided` without a corresponding posted movement
   * (assuming `markDecided` and `postTransfer` both succeed).
   */
  async approveTransfer(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: ApproveTransferInput,
  ): Promise<PostTransferResult> {
    // Step 1-2: permission + reject body authority.
    requirePermission(effective, "inventory.transfer.approve");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!input.transferRequestId || input.transferRequestId.trim() === "") {
      throw new TransferWorkflowError("VALIDATION_FAILED", "Transfer request ID is required.");
    }
    if (!input.idempotencyKey || input.idempotencyKey.trim() === "") {
      throw new TransferWorkflowError("VALIDATION_FAILED", "Idempotency key is required.");
    }

    // Step 3: fetch approval request (for state check + payload extraction).
    const approval = await this.deps.approvalRepository.findApprovalById(
      user.tenantId, input.transferRequestId,
    );
    if (!approval) throw new TransferRequestNotFoundError(input.transferRequestId);
    requireTenantMatch(user, approval.tenantId);

    // Step 4: claim workflow-level idempotency FIRST (before any state mutation).
    // This is the workflow-level idempotency (separate from the inventory-level
    // idempotency that postTransfer uses internally). Same key = replay; different
    // key on a decided approval = TransferAlreadyDecidedError.
    const now = new Date();
    const idempotencyInput: IdempotencyClaimInput = {
      tenantId: user.tenantId,
      operationScope: "transfer_workflow.approve",
      idempotencyKey: input.idempotencyKey,
      requestBody: {
        transferRequestId: input.transferRequestId,
        decisionNotes: input.decisionNotes ?? null,
      } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    };

    const claim = await claimIdempotency(this.deps.idempotency, idempotencyInput);

    if (claim.action === "replay") {
      // Prior call with same key succeeded — return the stored result.
      // The approval row should already be marked decided with a movementId.
      const refreshed = await this.deps.approvalRepository.findApprovalById(
        user.tenantId, input.transferRequestId,
      );
      if (refreshed && refreshed.state === "decided" && refreshed.movementId) {
        return {
          action: "replayed" as const,
          movementId: refreshed.movementId,
          docNo: "",
          fromBalanceVersion: 0,
          fromOnHandQtyKg: "0.000",
          toBalanceVersion: 0,
          toOnHandQtyKg: "0.000",
        };
      }
      // Idempotency says replay but approval not decided — fall through to execute
      // (this can happen if the prior call failed after claiming idempotency).
    }

    if (claim.action === "conflict") {
      throw new TransferWorkflowError(
        "IDEMPOTENCY_CONFLICT",
        `Idempotency key '${input.idempotencyKey}' was used with a different request body.`,
      );
    }

    if (claim.action === "in_progress") {
      throw new TransferWorkflowError(
        "OPERATION_IN_PROGRESS",
        `Operation '${input.idempotencyKey}' is still in progress.`,
      );
    }

    // claim.action === "execute" — fresh call. Now check approval state.
    if (approval.state !== "active") {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 409,
        responseBody: { message: `Transfer already in state '${approval.state}'.` },
        lastErrorClass: "TransferAlreadyDecidedError",
      }, now);
      throw new TransferAlreadyDecidedError(approval.id, approval.state);
    }

    // DEC-080: requester cannot approve own request.
    if (approval.requestedBy === user.userId) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 403,
        responseBody: { message: "Requester cannot approve own transfer request." },
        lastErrorClass: "TransferRequesterCannotApproveError",
      }, now);
      throw new TransferRequesterCannotApproveError(approval.id, user.userId);
    }

    // Extract all transfer params from the structured payload (submittedChildVersionSummary)
    const payload = (approval as any).submittedChildVersionSummary ?? {};
    const itemId = (payload as any).itemId ?? "";
    const fromLocationId = (payload as any).fromLocationId ?? "";
    const toLocationId = (payload as any).toLocationId ?? "";
    const quantityKg = (payload as any).quantityKg ?? "0.000";

    if (!itemId || !fromLocationId || !toLocationId) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 422,
        responseBody: { message: "Transfer payload missing required fields in submittedChildVersionSummary." },
        lastErrorClass: "TransferWorkflowError",
      }, now);
      throw new TransferWorkflowError("VALIDATION_FAILED", "Transfer payload missing required fields in submittedChildVersionSummary.");
    }

    const transferInput: PostTransferInput = {
      itemId,
      fromLocationId,
      toLocationId,
      quantityKg,
      movementDate: new Date().toISOString().slice(0, 10),
      sourceDocumentType: TRANSFER_ENTITY_TYPE,
      sourceDocumentId: approval.id,
      idempotencyKey: `${input.idempotencyKey}:transfer`,
      notes: input.decisionNotes ?? undefined,
    };

    // =====================================================================
    // ATOMIC POSTING TRANSACTION (Contract 06 §6, §17.2; DEC-015; WP-03-02)
    // =====================================================================
    // All DB writes (stock_movement, inventory_balance, approval_requests
    // markDecided) MUST commit or roll back together. If transactionRunner is
    // provided, we wrap all DB writes in a single db.transaction(). If any
    // write fails, the entire transaction rolls back — no partial stock post,
    // no decided approval, no movementId attached.
    //
    // ORDERING (critical for atomicity):
    //   1. postTransfer — creates movement + updates both balances
    //   2. markDecided(movementId, ...) — LAST, conditional WHERE state='active'
    //
    // If markDecided returns null (concurrent loser), we throw → tx rolls back
    // → postTransfer's movement + balance updates are discarded. The winner's
    // movement + decided approval persist.
    //
    // If postTransfer throws (e.g., insufficient stock), tx rolls back →
    // approval stays 'active', no movement, no movementId. Caller can retry
    // with a NEW idempotency key after fixing the cause.
    // =====================================================================

    const executePosting = async (
      txScoped: {
        inventoryLedger: InventoryLedgerService;
        approvalRepository: RawReceiptApprovalRepository;
      } | null,
    ): Promise<PostTransferResult> => {
      const invLedger = txScoped?.inventoryLedger ?? this.deps.inventoryLedger;
      const approvalRepo = txScoped?.approvalRepository ?? this.deps.approvalRepository;

      // Step 9: post the transfer movement (creates movement + updates balances).
      const transferResult: PostTransferResult = await invLedger.postTransfer(
        user, effective, transferInput,
      );

      // Step 10: mark approval decided (LAST, conditional WHERE state='active').
      // This is the atomicity gate: if a concurrent caller already decided this
      // approval, markDecided returns null and the transaction rolls back —
      // undoing the postTransfer writes.
      const decided = await approvalRepo.markDecided(
        user.tenantId,
        approval.id,
        user.userId,
        input.decisionNotes ?? null,
        transferResult.movementId, // attach movementId atomically with the decision
        null, // no payable for transfers
        false, // payableDeferred
      );

      if (!decided) {
        // markDecided returned null — another concurrent transaction already
        // decided this approval. The DB transaction will roll back (stock
        // movement + balance updates all rolled back). Throw so the caller
        // gets a clear conflict.
        throw new TransferAlreadyDecidedError(approval.id, "decided (concurrent)");
      }

      return transferResult;
    };

    let transferResult: PostTransferResult;
    try {
      if (this.deps.transactionRunner && this.deps.txFactories) {
        // Wrap all DB writes in a single outer transaction.
        transferResult = await this.deps.transactionRunner(async (tx: unknown) => {
          const txInvLedger = this.deps.txFactories!.createInventoryLedger(tx);
          const txApprovalRepo = this.deps.txFactories!.createApprovalRepository(tx);
          return executePosting({ inventoryLedger: txInvLedger, approvalRepository: txApprovalRepo });
        });
      } else {
        // No transaction runner (unit tests with in-memory repos).
        transferResult = await executePosting(null);
      }
    } catch (txError) {
      // The DB transaction rolled back. Mark idempotency as failed and re-throw.
      // No partial DB state persists — stock_movement, inventory_balance,
      // approval_requests are all rolled back.
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 500,
        responseBody: { message: "Transfer posting transaction failed and rolled back." },
        lastErrorClass: txError instanceof Error ? txError.name : "Unknown",
      }, now);
      throw txError;
    }

    // Step 11: audit (in-process — does not participate in DB transaction, but
    // records the outcome for observability).
    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: TRANSFER_ENTITY_TYPE, entityId: approval.id,
      actionType: "transfer_request.approve",
      newValuesJson: {
        movementId: transferResult.movementId,
        docNo: transferResult.docNo,
        fromOnHand: transferResult.fromOnHandQtyKg,
        toOnHand: transferResult.toOnHandQtyKg,
        fromBalanceVersion: transferResult.fromBalanceVersion,
        toBalanceVersion: transferResult.toBalanceVersion,
      },
      idempotencyKey: input.idempotencyKey,
    });

    // Step 12: mark idempotency succeeded (DB transaction already committed).
    await markSucceeded(this.deps.idempotency, claim.record.id, {
      responseCode: 200,
      responseBody: {
        movementId: transferResult.movementId,
        docNo: transferResult.docNo,
      },
    }, now);

    return transferResult;
  }

  /**
   * Reverse a posted movement by creating an inverse movement.
   *
   * Permission: inventory.reverse (Owner/Accountant only).
   *
   * This creates a NEW movement (append-only) — the original is never edited.
   * Contract 04 §22: "Reversal: approved exact inverse; original retained."
   *
   * For transfer movements, the reversal restores BOTH sides:
   *   source += qty (add back what was removed)
   *   destination -= qty (remove what was added)
   * This is handled by InventoryLedgerService.postReversal which detects the
   * transfer movement type (fromLocationId !== null && toLocationId !== null)
   * and applies the two-sided inverse.
   */
  async reverseMovement(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: ReverseMovementInput,
  ): Promise<PostReversalResult> {
    requirePermission(effective, "inventory.reverse");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    const reversalInput: PostReversalInput = {
      originalMovementId: input.movementId,
      reversalDate: new Date().toISOString().slice(0, 10),
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
    };

    return this.deps.inventoryLedger.postReversal(user, effective, reversalInput);
  }

  /**
   * List pending transfer requests for a tenant.
   */
  async listPendingTransfers(
    user: ErpUserContext,
    effective: EffectivePermissions,
  ): Promise<TransferRequest[]> {
    requirePermission(effective, "inventory.transfer.approve");
    const approvals = await this.deps.approvalRepository.listPendingApprovals(user.tenantId, TRANSFER_ENTITY_TYPE);
    return approvals.map(a => this.mapApprovalToTransfer(a));
  }

  private mapApprovalToTransfer(approval: any): TransferRequest {
    const payload = approval?.submittedChildVersionSummary ?? {};
    return {
      id: approval.id,
      tenantId: approval.tenantId,
      itemId: (payload as any).itemId ?? "",
      fromLocationId: (payload as any).fromLocationId ?? "",
      toLocationId: (payload as any).toLocationId ?? "",
      quantityKg: (payload as any).quantityKg ?? "0.000",
      reason: approval.reason, // human-readable reason (not JSON payload)
      state: approval.state,
      requestedBy: approval.requestedBy,
      decidedBy: approval.decidedBy,
      subjectHash: approval.subjectHash,
      subjectVersion: approval.subjectVersion,
      movementId: approval.movementId,
    };
  }
}
