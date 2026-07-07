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
 */
import "server-only";

import type { ErpUserContext } from "@/server/auth/erp-context";
import { requirePermission, requireTenantMatch, rejectBodyClaimsAuthority } from "@/server/security/guards";
import type { EffectivePermissions } from "@/server/security/effective-permissions";
import { appendAuditLog, type AuditTransactionHandle } from "./audit-service";
import { claimIdempotency, markSucceeded, markBusinessFailed, type IdempotencyTransactionHandle, type IdempotencyClaimInput } from "./idempotency-service";
import type { InventoryLedgerService, PostTransferInput, PostTransferResult, PostReversalInput, PostReversalResult } from "./inventory-ledger-service";
import type { RawReceiptApprovalRepository } from "./raw-receipt-approval-service";
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
// Service deps.
// ---------------------------------------------------------------------------

export interface TransferWorkflowServiceDeps {
  approvalRepository: RawReceiptApprovalRepository; // Reuses approval_requests table
  inventoryLedger: InventoryLedgerService;
  audit: AuditTransactionHandle;
  idempotency: IdempotencyTransactionHandle;
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

    const subjectHash = computeTransferSubjectHash(input);

    // Store transfer params in submittedChildVersionSummary (JSONB, Contract 03 §7.6).
    // The `reason` field is used for the human-readable reason only.
    const transferParams = {
      itemId: input.itemId,
      fromLocationId: input.fromLocationId,
      toLocationId: input.toLocationId,
      quantityKg: input.quantityKg,
    };

    // Check for existing active request for same entity (idempotent create).
    const existing = await this.deps.approvalRepository.findActiveApprovalByEntity(
      user.tenantId, TRANSFER_ENTITY_TYPE, `${input.itemId}:${input.fromLocationId}:${input.toLocationId}`, TRANSFER_REQUEST_TYPE,
    );
    if (existing) {
      return this.mapApprovalToTransfer(existing);
    }

    const approval = await this.deps.approvalRepository.insertApprovalRequest({
      tenantId: user.tenantId,
      requestType: TRANSFER_REQUEST_TYPE,
      entityType: TRANSFER_ENTITY_TYPE,
      entityId: `${input.itemId}:${input.fromLocationId}:${input.toLocationId}`,
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
   * Calls InventoryLedgerService.postTransfer which handles:
   * - idempotency
   * - deterministic lock order
   * - stock_movements + inventory_balances atomic update
   * - audit
   */
  async approveTransfer(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: ApproveTransferInput,
  ): Promise<PostTransferResult> {
    requirePermission(effective, "inventory.transfer.approve");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    // Fetch approval request
    const approval = await this.deps.approvalRepository.findApprovalById(user.tenantId, input.transferRequestId);
    if (!approval) throw new TransferRequestNotFoundError(input.transferRequestId);
    requireTenantMatch(user, approval.tenantId);

    if (approval.state !== "active") {
      // Check if already decided — replay if movementId exists
      if (approval.state === "decided" && approval.movementId) {
        return { action: "replayed", movementId: approval.movementId, docNo: "", fromBalanceVersion: 0, fromOnHandQtyKg: "0.000", toBalanceVersion: 0, toOnHandQtyKg: "0.000" };
      }
      // If decided but no movementId (shouldn't happen), or other state
      throw new TransferAlreadyDecidedError(approval.id, approval.state);
    }

    // DEC-080: requester cannot approve
    if (approval.requestedBy === user.userId) {
      throw new TransferRequesterCannotApproveError(approval.id, user.userId);
    }

    // Parse the entity ID back to transfer params
    const parts = approval.entityId.split(":");
    const itemId = parts[0] ?? "";
    const fromLocationId = parts[1] ?? "";
    const toLocationId = parts[2] ?? "";

    // Extract quantity from the structured payload (submittedChildVersionSummary)
    const payload = (approval as any).submittedChildVersionSummary ?? {};
    const quantityKg = (payload as any).quantityKg ?? "0.000";

    // Post the transfer via InventoryLedgerService
    const transferInput: PostTransferInput = {
      itemId,
      fromLocationId,
      toLocationId,
      quantityKg,
      movementDate: new Date().toISOString().slice(0, 10),
      sourceDocumentType: TRANSFER_ENTITY_TYPE,
      sourceDocumentId: approval.id,
      idempotencyKey: input.idempotencyKey,
      notes: input.decisionNotes ?? undefined,
    };

    try {
      const result = await this.deps.inventoryLedger.postTransfer(user, effective, transferInput);

      // Mark approval as decided
      await this.deps.approvalRepository.markDecided(
        user.tenantId, approval.id, user.userId, input.decisionNotes ?? null,
        result.movementId, null, false,
      );

      await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
        entityType: TRANSFER_ENTITY_TYPE, entityId: approval.id,
        actionType: "transfer_request.approve",
        newValuesJson: { movementId: result.movementId, docNo: result.docNo, fromOnHand: result.fromOnHandQtyKg, toOnHand: result.toOnHandQtyKg },
        idempotencyKey: input.idempotencyKey,
      });

      return result;
    } catch (e) {
      // The transfer failed — don't mark as decided. Let the caller retry.
      throw e;
    }
  }

  /**
   * Reverse a posted movement by creating an inverse movement.
   *
   * Permission: inventory.reverse (Owner/Accountant only).
   *
   * This creates a NEW movement (append-only) — the original is never edited.
   * Contract 04 §22: "Reversal: approved exact inverse; original retained."
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

  private extractQuantityFromPayload(approval: any): string {
    // Read quantity from the structured payload (submittedChildVersionSummary).
    const payload = approval?.submittedChildVersionSummary ?? {};
    return (payload as any).quantityKg ?? "0.000";
  }

  private mapApprovalToTransfer(approval: any): TransferRequest {
    const parts = approval.entityId?.split(":") ?? [];
    return {
      id: approval.id,
      tenantId: approval.tenantId,
      itemId: parts[0] ?? "",
      fromLocationId: parts[1] ?? "",
      toLocationId: parts[2] ?? "",
      quantityKg: this.extractQuantityFromPayload(approval),
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
