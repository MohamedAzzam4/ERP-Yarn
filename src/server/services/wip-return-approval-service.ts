/**
 * WIP Return Approval Service — WP-04-04.
 *
 * Contract: docs/contracts/13_work_packages.md WP-04-04
 *   Goal: "Request and approve return of unprocessed WIP to stock."
 *   Acceptance: "WIP decreases/destination on-hand increases exactly."
 *
 * Contract: docs/contracts/05_production_wip_contract.md §20
 *   Approval: lock order/WIP/return location balance → reduce WIP →
 *   create return_from_wip movement → increase on-hand at selected location →
 *   update input/order/correction state → route financial impact to
 *   Accountant Review → audit/commit atomically.
 *
 * Contract: docs/contracts/06_approval_transaction_contract.md §6, §12
 *   11-step universal approval contract + dedicated Return-From-WIP Approval.
 *
 * Contract: docs/contracts/04_inventory_posting_contract.md §8, §10
 *   Movement matrix: return_from_wip → return location +qty, WIP -qty.
 *   InventoryLedgerService is the SOLE owner of posted movements.
 *
 * DEC-080: Requester cannot approve own request.
 * DEC-024: Audit write failure rolls back the entire transaction.
 *
 * WP-04-04 SCOPE:
 *   - Approve a WIP return request (created by WipReturnRequestService)
 *   - Atomically post:
 *     * return_from_wip movement (destination on-hand increase)
 *     * production_wip_balances conditional decrement (WIP -qty, version bump)
 *     * production_inputs.returned_from_wip_qty + remaining_wip_qty update
 *     * production_wip_returns state transition (status, approval_status, locked)
 *     * audit_logs row (inside the same transaction)
 *   - All effects in ONE Drizzle transaction; any failure rolls back ALL.
 *   - Idempotent: same key+request replays; same key+different-request = conflict;
 *     different key on already-approved = STATE_CONFLICT.
 *
 * WP-04-04 NON-SCOPE:
 *   - No payable/subledger/payment side effects (Contract 06 §12: "No worker-
 *     created payable/cost/profitability/account entry")
 *   - No order status auto-transition (WIP return is a correction, not completion)
 *   - No financial review clearance (financial_review_status stays at default)
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
import type { InventoryLedgerService, PostRawReceiptResult } from "./inventory-ledger-service";
import type { WipBalanceRepository } from "./wip-balance-repository";
import type { ProductionOrderRepository } from "./production-order-repository";
import type { WipReturnRequestRepository, WipReturnApprovalPatch } from "./wip-return-request-repository";
import { computeWipReturnSubjectHash } from "./wip-return-request-service";
import type { ProductionWipReturn } from "@/server/db/schema/production-receipts";
import type { ProductionOrder, ProductionInput } from "@/server/db/schema/production-orders";
import { addKg, compareKg, isPositiveKg, normalizeKg, subtractKg } from "./decimal-kg";

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

export interface ApproveWipReturnInput {
  requestId: string;
  decisionNotes?: string | null;
  idempotencyKey: string;
}

export interface ApproveWipReturnResult {
  action: "posted" | "replayed";
  requestId: string;
  docNo: string;
  requestStatus: string;
  returnMovementId: string;
  returnMovementDocNo: string;
  wipQtyAfter: string;
  onHandQtyAfter: string;
  returnedFromWipQtyKg: string;
  remainingWipQtyKg: string;
  financialReviewStatus: string;
}

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

export class WipReturnApprovalError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "WipReturnApprovalError";
    this.code = code;
  }
}

export class WipReturnNotFoundError extends WipReturnApprovalError {
  constructor(id: string) {
    super("WIP_RETURN_NOT_FOUND", `WIP return request '${id}' not found.`);
    this.name = "WipReturnNotFoundError";
  }
}

export class WipReturnAlreadyApprovedError extends WipReturnApprovalError {
  constructor(id: string, status: string) {
    super("STATE_CONFLICT", `WIP return request '${id}' is already in status '${status}' — cannot approve twice.`);
    this.name = "WipReturnAlreadyApprovedError";
  }
}

export class OrderNotReadyForReturnApprovalError extends WipReturnApprovalError {
  constructor(orderId: string, status: string) {
    super("ORDER_NOT_READY", `Order '${orderId}' is in status '${status}' — must be 'material_issued' or 'partially_received'.`);
    this.name = "OrderNotReadyForReturnApprovalError";
  }
}

export class WipReturnSubjectHashMismatchError extends WipReturnApprovalError {
  constructor(requestId: string) {
    super("SUBJECT_CHANGED", `Subject hash mismatch for WIP return request '${requestId}'. The request facts changed after creation.`);
    this.name = "WipReturnSubjectHashMismatchError";
  }
}

export class RequesterCannotApproveOwnWipReturnError extends WipReturnApprovalError {
  constructor(requestId: string, userId: string) {
    super("REQUESTER_CANNOT_APPROVE_OWN", `User '${userId}' cannot approve WIP return '${requestId}' because they are the requester. DEC-080.`);
    this.name = "RequesterCannotApproveOwnWipReturnError";
  }
}

export class WipInsufficientForReturnError extends WipReturnApprovalError {
  constructor(inputId: string, required: string, available: string) {
    super("WIP_INSUFFICIENT", `Insufficient WIP for input '${inputId}': required ${required} kg, available ${available} kg.`);
    this.name = "WipInsufficientForReturnError";
  }
}

// ---------------------------------------------------------------------------
// Transaction runner + factories.
// ---------------------------------------------------------------------------

export type WipReturnApprovalTransactionRunner = <T>(work: (tx: unknown) => Promise<T>) => Promise<T>;

export interface WipReturnApprovalTransactionScopedFactories {
  createInventoryLedger: (tx: unknown) => InventoryLedgerService;
  createWipBalanceRepository: (tx: unknown) => WipBalanceRepository;
  createProductionOrderRepository: (tx: unknown) => ProductionOrderRepository;
  createRequestRepository: (tx: unknown) => WipReturnRequestRepository;
}

// ---------------------------------------------------------------------------
// Service deps.
// ---------------------------------------------------------------------------

export interface WipReturnApprovalServiceDeps {
  requestRepository: WipReturnRequestRepository;
  productionOrderRepository: ProductionOrderRepository;
  wipBalanceRepository: WipBalanceRepository;
  inventoryLedger: InventoryLedgerService;
  audit: AuditTransactionHandle;
  idempotency: IdempotencyTransactionHandle;
  transactionRunner?: WipReturnApprovalTransactionRunner;
  txFactories?: WipReturnApprovalTransactionScopedFactories;
}

// ---------------------------------------------------------------------------
// Constants.
// ---------------------------------------------------------------------------

const RETURN_ENTITY_TYPE = "production_wip_return";
const SOURCE_DOC_TYPE_WIP_RETURN = "production_wip_return";
const APPROVABLE_RETURN_STATUSES = ["pending_approval"] as const;
const APPROVABLE_ORDER_STATUSES = ["material_issued", "partially_received"] as const;

// ---------------------------------------------------------------------------
// WipReturnApprovalService.
// ---------------------------------------------------------------------------

export class WipReturnApprovalService {
  constructor(private readonly deps: WipReturnApprovalServiceDeps) {}

  /**
   * Approve a WIP return: atomically decrease WIP + increase return-location
   * on-hand + update input quantities + transition state + audit.
   *
   * Universal Approval Contract (Contract 06 §6):
   *   1. derive tenant/user
   *   2. check permission (production.return_from_wip.approve)
   *   3. validate request
   *   4. check state + subject hash
   *   5. claim/replay idempotency
   *   6. start transaction
   *   7. lock entity + affected rows
   *   8. recheck preconditions under lock
   *   9. perform all writes
   *  10. record decision + audit in same transaction
   *  11. commit once
   *
   * DEC-080: requester cannot approve own request.
   */
  async approveWipReturn(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: ApproveWipReturnInput,
  ): Promise<ApproveWipReturnResult> {
    // Step 1-2: permission + reject body authority.
    requirePermission(effective, "production.return_from_wip.approve");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    // Step 3: validate input.
    if (!input.requestId || input.requestId.trim() === "") {
      throw new WipReturnApprovalError("VALIDATION_FAILED", "requestId is required.");
    }
    if (!input.idempotencyKey || input.idempotencyKey.trim() === "") {
      throw new WipReturnApprovalError("VALIDATION_FAILED", "idempotencyKey is required.");
    }

    // Step 4: fetch request.
    const request = await this.deps.requestRepository.findRequestById(user.tenantId, input.requestId);
    if (!request) throw new WipReturnNotFoundError(input.requestId);
    requireTenantMatch(user, request.tenantId);

    // Step 5: claim idempotency FIRST.
    const now = new Date();
    const idempotencyInput: IdempotencyClaimInput = {
      tenantId: user.tenantId,
      operationScope: "production_wip_return.approve",
      idempotencyKey: input.idempotencyKey,
      requestBody: {
        requestId: input.requestId,
        decisionNotes: input.decisionNotes ?? null,
      } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    };

    const claim = await claimIdempotency(this.deps.idempotency, idempotencyInput);

    if (claim.action === "replay") {
      const responseBody = claim.record.responseBody as Partial<ApproveWipReturnResult> | null;
      if (responseBody && responseBody.requestId) {
        return { ...responseBody, action: "replayed" } as ApproveWipReturnResult;
      }
    }

    if (claim.action === "conflict") {
      throw new WipReturnApprovalError("IDEMPOTENCY_CONFLICT", `Idempotency key '${input.idempotencyKey}' was used with a different request body.`);
    }

    if (claim.action === "in_progress") {
      throw new WipReturnApprovalError("OPERATION_IN_PROGRESS", `Operation '${input.idempotencyKey}' is still in progress.`);
    }

    // claim.action === "execute" — check business preconditions.

    // State check.
    if (!APPROVABLE_RETURN_STATUSES.includes(request.status as (typeof APPROVABLE_RETURN_STATUSES)[number])) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 409,
        responseBody: { message: `Request in status '${request.status}' cannot be approved.` },
        lastErrorClass: "WipReturnAlreadyApprovedError",
      }, claim.record.ownerToken!, now);
      throw new WipReturnAlreadyApprovedError(request.id, request.status);
    }
    if (request.isLocked) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 409,
        responseBody: { message: "Request is already locked." },
        lastErrorClass: "WipReturnAlreadyApprovedError",
      }, claim.record.ownerToken!, now);
      throw new WipReturnAlreadyApprovedError(request.id, request.status);
    }

    // DEC-080: requester cannot approve own request.
    if (request.createdBy && request.createdBy === user.userId) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 403,
        responseBody: { message: "Requester cannot approve own WIP return." },
        lastErrorClass: "RequesterCannotApproveOwnWipReturnError",
      }, claim.record.ownerToken!, now);
      throw new RequesterCannotApproveOwnWipReturnError(request.id, user.userId);
    }

    // Subject hash check.
    const currentSubjectHash = computeWipReturnSubjectHash(
      request.productionOrderId,
      request.productionInputId,
      request.returnQtyKg,
      request.returnLocationId,
      request.reason,
    );
    if (currentSubjectHash !== request.subjectHash) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 409,
        responseBody: { message: "Subject hash mismatch." },
        lastErrorClass: "WipReturnSubjectHashMismatchError",
      }, claim.record.ownerToken!, now);
      throw new WipReturnSubjectHashMismatchError(request.id);
    }

    // Fetch order.
    const order = await this.deps.productionOrderRepository.findOrderById(user.tenantId, request.productionOrderId);
    if (!order) throw new OrderNotReadyForReturnApprovalError(request.productionOrderId, "(not found)");
    requireTenantMatch(user, order.tenantId);

    if (!APPROVABLE_ORDER_STATUSES.includes(order.status as (typeof APPROVABLE_ORDER_STATUSES)[number])) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 409,
        responseBody: { message: `Order in status '${order.status}' cannot receive WIP returns.` },
        lastErrorClass: "OrderNotReadyForReturnApprovalError",
      }, claim.record.ownerToken!, now);
      throw new OrderNotReadyForReturnApprovalError(order.id, order.status);
    }

    // Fetch input.
    const prodInput = await this.deps.productionOrderRepository.findInputById(user.tenantId, request.productionInputId);
    if (!prodInput) throw new WipReturnApprovalError("VALIDATION_FAILED", `Production input '${request.productionInputId}' not found.`);
    requireTenantMatch(user, prodInput.tenantId);

    // =====================================================================
    // ATOMIC POSTING TRANSACTION (Contract 06 §6, §12; Contract 05 §20)
    // =====================================================================
    const executePosting = async (
      txScoped: {
        inventoryLedger: InventoryLedgerService;
        wipBalanceRepository: WipBalanceRepository;
        productionOrderRepository: ProductionOrderRepository;
        requestRepository: WipReturnRequestRepository;
      } | null,
    ): Promise<ApproveWipReturnResult> => {
      const invLedger = txScoped?.inventoryLedger ?? this.deps.inventoryLedger;
      const wipRepo = txScoped?.wipBalanceRepository ?? this.deps.wipBalanceRepository;
      const orderRepo = txScoped?.productionOrderRepository ?? this.deps.productionOrderRepository;
      const requestRepo = txScoped?.requestRepository ?? this.deps.requestRepository;

      const normalizedReturnQty = normalizeKg(request.returnQtyKg);

      // ----- Step 9a: Pre-validate WIP sufficiency (fail-fast, before any writes) -----
      const wipBalance = await wipRepo.findForUpdate(
        user.tenantId, order.id, prodInput.inputItemId, order.factoryLocationId,
      );
      if (!wipBalance) {
        throw new WipInsufficientForReturnError(prodInput.id, normalizedReturnQty, "0.000");
      }
      if (compareKg(wipBalance.wipQtyKg, normalizedReturnQty) < 0) {
        throw new WipInsufficientForReturnError(prodInput.id, normalizedReturnQty, wipBalance.wipQtyKg);
      }

      // ----- Step 9b: Post return_from_wip movement (destination on-hand +qty) -----
      const movementResult: PostRawReceiptResult = await invLedger.postReturnFromWip(
        user, effective, {
          itemId: prodInput.inputItemId,
          factoryLocationId: order.factoryLocationId,
          returnLocationId: request.returnLocationId,
          returnQtyKg: normalizedReturnQty,
          movementDate: new Date().toISOString().slice(0, 10),
          sourceDocumentType: SOURCE_DOC_TYPE_WIP_RETURN,
          sourceDocumentId: request.id,
          idempotencyKey: `${input.idempotencyKey}:return`,
          notes: input.decisionNotes ?? undefined,
        },
      );

      // ----- Step 9c: Conditionally decrement WIP -----
      const updatedWip = await wipRepo.decrementWipQtyConditional(
        user.tenantId, order.id, prodInput.inputItemId, order.factoryLocationId,
        { decrementQtyKg: normalizedReturnQty, expectedVersion: wipBalance.version },
      );
      if (!updatedWip) {
        // Either version mismatch (concurrent modification) or WIP insufficient.
        throw new WipInsufficientForReturnError(prodInput.id, normalizedReturnQty, wipBalance.wipQtyKg);
      }

      // ----- Step 9d: Update production_inputs (returned_from_wip_qty + remaining_wip_qty) -----
      // Waste is derived from production_waste_entries for this input.
      // For MVP simplicity, we pass the current consumed_qty as the waste basis
      // (the invariant is: remaining = issued - consumed - waste - returned).
      // Since production_inputs has no waste_qty column, we compute waste from
      // the difference: waste = issued - consumed - returned - remaining (before this return).
      // However, the simplest correct approach is to pass 0 waste and let the
      // WIP balance table be the authority. The invariant on production_inputs
      // is maintained as: remaining = issued - consumed - returned (waste tracked
      // separately in production_waste_entries).
      // For MVP, we use: remaining = issued - consumed - returned (waste not
      // double-counted here because it's already reflected in the WIP balance).
      const updatedInput = await orderRepo.applyReturnFromWipToInput(
        user.tenantId, prodInput.id,
        { returnQtyKg: normalizedReturnQty, cumulativeWasteQtyKg: "0.000" },
      );
      if (!updatedInput) {
        throw new WipReturnApprovalError("INTERNAL_TRANSACTION_FAILED", "Production input not found during update.");
      }

      // ----- Step 9e: Conditionally mark the return request approved/locked -----
      const approvalPatch: WipReturnApprovalPatch = {
        status: "approved",
        approvalStatus: "approved",
        isLocked: true,
        confirmedBy: user.userId,
        confirmedAt: now,
        returnMovementId: movementResult.movementId,
      };
      const updatedRequest = await requestRepo.markApprovedConditional(
        user.tenantId, request.id, approvalPatch,
        [...APPROVABLE_RETURN_STATUSES],
      );
      if (!updatedRequest) {
        throw new WipReturnAlreadyApprovedError(request.id, "(concurrent)");
      }

      // ----- Step 9f: Audit (inside the same transaction — DEC-024) -----
      await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
        entityType: RETURN_ENTITY_TYPE,
        entityId: request.id,
        actionType: "production_wip_return.approve",
        newValuesJson: {
          docNo: request.docNo,
          productionOrderId: order.id,
          productionInputId: prodInput.id,
          returnQtyKg: normalizedReturnQty,
          returnLocationId: request.returnLocationId,
          returnMovementId: movementResult.movementId,
          returnMovementDocNo: movementResult.docNo,
          wipQtyAfter: updatedWip.wipQtyKg,
          onHandQtyAfter: movementResult.onHandQtyKg,
          returnedFromWipQtyKg: updatedInput.returnedFromWipQtyKg,
          remainingWipQtyKg: updatedInput.remainingWipQtyKg,
          financialReviewStatus: request.financialReviewStatus ?? "needs_accountant_review",
        },
        idempotencyKey: input.idempotencyKey,
      });

      return {
        action: "posted",
        requestId: request.id,
        docNo: request.docNo,
        requestStatus: "approved",
        returnMovementId: movementResult.movementId,
        returnMovementDocNo: movementResult.docNo,
        wipQtyAfter: updatedWip.wipQtyKg,
        onHandQtyAfter: movementResult.onHandQtyKg,
        returnedFromWipQtyKg: updatedInput.returnedFromWipQtyKg,
        remainingWipQtyKg: updatedInput.remainingWipQtyKg,
        financialReviewStatus: request.financialReviewStatus ?? "needs_accountant_review",
      };
    };

    let result: ApproveWipReturnResult;
    try {
      if (this.deps.transactionRunner && this.deps.txFactories) {
        result = await this.deps.transactionRunner(async (tx: unknown) => {
          const txInvLedger = this.deps.txFactories!.createInventoryLedger(tx);
          const txWipRepo = this.deps.txFactories!.createWipBalanceRepository(tx);
          const txOrderRepo = this.deps.txFactories!.createProductionOrderRepository(tx);
          const txRequestRepo = this.deps.txFactories!.createRequestRepository(tx);
          return executePosting({
            inventoryLedger: txInvLedger,
            wipBalanceRepository: txWipRepo,
            productionOrderRepository: txOrderRepo,
            requestRepository: txRequestRepo,
          });
        });
      } else {
        result = await executePosting(null);
      }
    } catch (txError) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 500,
        responseBody: { message: "WIP return approval transaction failed and rolled back." },
        lastErrorClass: txError instanceof Error ? txError.name : "Unknown",
      }, claim.record.ownerToken!, now);
      throw txError;
    }

    // Step 11: mark idempotency succeeded.
    await markSucceeded(this.deps.idempotency, claim.record.id, {
      responseCode: 200,
      responseBody: result,
      entityType: RETURN_ENTITY_TYPE,
      entityId: request.id,
    }, claim.record.ownerToken!, now);

    return result;
  }
}
