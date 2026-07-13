/**
 * WIP Return Request Service — WP-04-04.
 *
 * Contract: docs/contracts/13_work_packages.md WP-04-04
 *   Goal: "Request and approve return of unprocessed WIP to stock."
 *   Implementation notes: "Request has no quantity/account effect; approval atomic."
 *
 * Contract: docs/contracts/05_production_wip_contract.md §20
 *   Return From WIP — preconditions, approval, audit.
 *
 * Contract: docs/contracts/09_api_contracts.md §15
 *   POST /api/v1/production/orders/:orderId/return-from-wip-requests
 *   "Creates pending correction request only—no WIP/on-hand/account effect."
 *
 * WP-04-04 SCOPE (request creation):
 *   - Create a production_wip_returns row with status=pending_approval
 *   - Allocate WR-YYYY-NNNNNN doc_no
 *   - Compute subject hash for invalidation detection
 *   - Write audit (production_wip_return.request)
 *   - ZERO operational effect: no movement, no WIP change, no account entry
 *
 * WP-04-04 NON-SCOPE (deferred to WipReturnApprovalService):
 *   - Approval (atomic WIP decrease + movement + on-hand increase + audit)
 */
import "server-only";

import type { ErpUserContext } from "@/server/auth/erp-context";
import { requirePermission, requireTenantMatch, rejectBodyClaimsAuthority } from "@/server/security/guards";
import type { EffectivePermissions } from "@/server/security/effective-permissions";
import { appendAuditLog, type AuditTransactionHandle } from "./audit-service";
import { allocateDocumentNumber, type DocumentSequenceTransactionHandle } from "./document-sequence-service";
import type { ProductionOrderRepository } from "./production-order-repository";
import type { WipBalanceRepository } from "./wip-balance-repository";
import type { WipReturnRequestRepository } from "./wip-return-request-repository";
import type { ProductionWipReturn } from "@/server/db/schema/production-receipts";
import type { ProductionInput } from "@/server/db/schema/production-orders";
import { isPositiveKg, normalizeKg } from "./decimal-kg";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

export interface CreateWipReturnRequestInput {
  productionOrderId: string;
  productionInputId: string;
  returnQtyKg: string;
  returnLocationId: string;
  reason: string;
  notes?: string | null;
}

export interface CreateWipReturnRequestResult {
  requestId: string;
  docNo: string;
  status: string;
  approvalStatus: string;
  subjectHash: string;
}

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

export class WipReturnRequestError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "WipReturnRequestError";
    this.code = code;
  }
}

export class ProductionOrderNotFoundForReturnError extends WipReturnRequestError {
  constructor(id: string) {
    super("PRODUCTION_ORDER_NOT_FOUND", `Production order '${id}' not found.`);
    this.name = "ProductionOrderNotFoundForReturnError";
  }
}

export class ProductionInputNotFoundForReturnError extends WipReturnRequestError {
  constructor(id: string) {
    super("PRODUCTION_INPUT_NOT_FOUND", `Production input '${id}' not found.`);
    this.name = "ProductionInputNotFoundForReturnError";
  }
}

export class OrderNotReadyForReturnError extends WipReturnRequestError {
  constructor(id: string, status: string) {
    super(
      "ORDER_NOT_READY",
      `Order '${id}' is in status '${status}' — must be 'material_issued' or 'partially_received' to request a WIP return.`,
    );
    this.name = "OrderNotReadyForReturnError";
  }
}

export class InputLocationMismatchError extends WipReturnRequestError {
  constructor(inputId: string, expected: string, actual: string) {
    super("INPUT_LOCATION_MISMATCH", `Input '${inputId}' location '${actual}' does not match factory location '${expected}'.`);
    this.name = "InputLocationMismatchError";
  }
}

// ---------------------------------------------------------------------------
// Service deps.
// ---------------------------------------------------------------------------

export interface WipReturnRequestServiceDeps {
  requestRepository: WipReturnRequestRepository;
  productionOrderRepository: ProductionOrderRepository;
  wipBalanceRepository: WipBalanceRepository;
  audit: AuditTransactionHandle;
  documentSequence: DocumentSequenceTransactionHandle;
}

const RETURN_ENTITY_TYPE = "production_wip_return";

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/**
 * Compute the subject hash for a WIP return request.
 *
 * Contract 06 §6 step 4: subject version/hash verification.
 * The hash covers the approval-relevant facts: order, input, qty, location, reason.
 * Any mutation after submission invalidates the pending approval (SUBJECT_CHANGED).
 */
export function computeWipReturnSubjectHash(
  productionOrderId: string,
  productionInputId: string,
  returnQtyKg: string,
  returnLocationId: string,
  reason: string,
): string {
  const subjectFields = [
    productionOrderId,
    productionInputId,
    normalizeKg(returnQtyKg),
    returnLocationId,
    reason,
  ];
  return createHash("sha256").update(JSON.stringify(subjectFields)).digest("hex");
}

// ---------------------------------------------------------------------------
// WipReturnRequestService.
// ---------------------------------------------------------------------------

export class WipReturnRequestService {
  constructor(private readonly deps: WipReturnRequestServiceDeps) {}

  /**
   * Create a WIP return request.
   *
   * Permission: production.return_from_wip.request (Owner/Accountant/Production).
   * DEC-063: Worker response has no financial fields (the table has none anyway).
   *
   * ZERO operational effect: no movement, no WIP change, no account entry.
   * Creates a durable request/review record with subject hash for invalidation.
   */
  async createRequest(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: CreateWipReturnRequestInput,
  ): Promise<CreateWipReturnRequestResult> {
    requirePermission(effective, "production.return_from_wip.request");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    // Validate input
    if (!input.productionOrderId) {
      throw new WipReturnRequestError("VALIDATION_FAILED", "productionOrderId is required.");
    }
    if (!input.productionInputId) {
      throw new WipReturnRequestError("VALIDATION_FAILED", "productionInputId is required.");
    }
    if (!input.returnLocationId) {
      throw new WipReturnRequestError("VALIDATION_FAILED", "returnLocationId is required.");
    }
    if (!input.reason || input.reason.trim() === "") {
      throw new WipReturnRequestError("VALIDATION_FAILED", "reason is required.");
    }
    if (!isPositiveKg(input.returnQtyKg)) {
      throw new WipReturnRequestError("VALIDATION_FAILED", `Return quantity must be positive, got '${input.returnQtyKg}'.`);
    }

    // Fetch production order
    const order = await this.deps.productionOrderRepository.findOrderById(user.tenantId, input.productionOrderId);
    if (!order) throw new ProductionOrderNotFoundForReturnError(input.productionOrderId);
    requireTenantMatch(user, order.tenantId);

    // Order must be in material_issued or partially_received
    if (order.status !== "material_issued" && order.status !== "partially_received") {
      throw new OrderNotReadyForReturnError(order.id, order.status);
    }

    // Fetch production input
    const prodInput = await this.deps.productionOrderRepository.findInputById(user.tenantId, input.productionInputId);
    if (!prodInput) throw new ProductionInputNotFoundForReturnError(input.productionInputId);
    requireTenantMatch(user, prodInput.tenantId);

    // Input must belong to the order
    if (prodInput.productionOrderId !== order.id) {
      throw new WipReturnRequestError(
        "VALIDATION_FAILED",
        `Input '${input.productionInputId}' does not belong to order '${order.id}'.`,
      );
    }

    // Compute subject hash
    const normalizedQty = normalizeKg(input.returnQtyKg);
    const subjectHash = computeWipReturnSubjectHash(
      input.productionOrderId,
      input.productionInputId,
      normalizedQty,
      input.returnLocationId,
      input.reason,
    );

    // Allocate doc number (WR-YYYY-NNNNNN)
    const year = new Date().getUTCFullYear();
    const docNoResult = await allocateDocumentNumber(this.deps.documentSequence, {
      tenantId: user.tenantId,
      documentType: "production_wip_return",
      year,
      entityType: RETURN_ENTITY_TYPE,
    });

    // Create the request row (status=pending_approval, zero effect)
    const request = await this.deps.requestRepository.insertRequest({
      tenantId: user.tenantId,
      docNo: docNoResult.docNo,
      productionOrderId: order.id,
      productionInputId: prodInput.id,
      returnQtyKg: normalizedQty,
      returnLocationId: input.returnLocationId,
      reason: input.reason,
      notes: input.notes ?? null,
      idempotencyKey: `wip-return-request-${user.userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdBy: user.userId,
      subjectHash,
      subjectVersion: 1,
    });

    // Audit (no business state change — just record the request creation)
    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: RETURN_ENTITY_TYPE,
      entityId: request.id,
      actionType: "production_wip_return.request",
      newValuesJson: {
        docNo: request.docNo,
        productionOrderId: order.id,
        productionInputId: prodInput.id,
        returnQtyKg: normalizedQty,
        returnLocationId: input.returnLocationId,
        subjectHash: subjectHash.slice(0, 16) + "...",
      },
    });

    return {
      requestId: request.id,
      docNo: request.docNo,
      status: request.status,
      approvalStatus: request.approvalStatus,
      subjectHash,
    };
  }
}
