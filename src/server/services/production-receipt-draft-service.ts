/**
 * Production Receipt Draft Service — WP-04-02.
 *
 * Contract: docs/contracts/13_work_packages.md WP-04-02
 *   Goal: Capture receipt/output/waste/input-allocation facts and validate a
 *   postable draft WITHOUT changing WIP, stock or accounts.
 *   Expected outputs: Receipt draft service, allocation lineage preview,
 *   confirmed rate/basis review state and server validation result;
 *   NO posted lot/movement/payable.
 *   Acceptance: Draft preview reconciles and database assertions prove
 *   WIP/on-hand/account entries unchanged.
 *
 * Contract: docs/contracts/05_production_wip_contract.md §14, §15, §16
 *   Receipt data, waste, partial production.
 *
 * WP-04-02 SCOPE:
 *   - Create receipt draft with output facts + input allocations
 *   - Store confirmed rate/basis snapshot (review state only, no payable calculation)
 *   - Compute subject hash for invalidation detection
 *   - Validate: cumulative consumed + waste <= issued_qty (no double allocation)
 *   - Preview allocation lineage (no posting)
 *   - Zero operational effects (no WIP/on-hand/account changes)
 *
 * WP-04-02 NON-SCOPE (deferred to WP-04-03):
 *   - Receipt approval/posting (movement, WIP decrease, output on-hand increase)
 *   - Factory payable calculation
 *   - Waste movement posting
 *   - Lot creation
 */
import "server-only";

import type { ErpUserContext } from "@/server/auth/erp-context";
import { requirePermission, requireTenantMatch, rejectBodyClaimsAuthority } from "@/server/security/guards";
import type { EffectivePermissions } from "@/server/security/effective-permissions";
import { appendAuditLog, type AuditTransactionHandle } from "./audit-service";
import {
  allocateDocumentNumber,
  type DocumentSequenceTransactionHandle,
} from "./document-sequence-service";
import type { ProductionOrderRepository } from "./production-order-repository";
import type { WipBalanceRepository } from "./wip-balance-repository";
import type { ProductionReceiptRepository, NewAllocationInput } from "./production-receipt-repository";
import type { ProductionReceipt, ProductionReceiptInputAllocation } from "@/server/db/schema/production-receipts";
import type { ProductionInput } from "@/server/db/schema/production-orders";
import { addKg, compareKg, isPositiveKg, normalizeKg } from "./decimal-kg";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

export interface CreateReceiptDraftInput {
  productionOrderId: string;
  outputItemId: string;
  outputLotId?: string | null;
  outputLocationId: string;
  outputQtyKg: string;
  receiptDate: string;
  notes?: string | null;
  // Rate/basis snapshot — only accepted if user has production.view_cost
  factoryRatePerInputTon?: string | null;
  factoryCostBasis?: string;
  // Input allocations
  allocations: Array<{
    productionInputId: string;
    consumedTowardOutputQtyKg: string;
    allocatedWasteQtyKg: string;
  }>;
}

export interface AllocationPreview {
  productionInputId: string;
  issuedQtyKg: string;
  cumulativeConsumedQtyKg: string;
  cumulativeWasteQtyKg: string;
  remainingWipQtyKg: string;
  thisReceiptConsumedQtyKg: string;
  thisReceiptWasteQtyKg: string;
  thisReceiptPayableBasisQtyKg: string;
  isValid: boolean;
  validationError: string | null;
}

export interface CreateReceiptDraftResult {
  receiptId: string;
  docNo: string;
  status: string;
  subjectHash: string;
  allocations: Array<{
    id: string;
    productionInputId: string;
    consumedTowardOutputQtyKg: string;
    allocatedWasteQtyKg: string;
    payableCostBasisQtyKg: string;
  }>;
  preview: AllocationPreview[];
}

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

export class ReceiptDraftError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = "ReceiptDraftError"; this.code = code; }
}

export class ProductionOrderNotFoundForReceiptError extends ReceiptDraftError {
  constructor(id: string) { super("PRODUCTION_ORDER_NOT_FOUND", `Production order '${id}' not found.`); this.name = "ProductionOrderNotFoundForReceiptError"; }
}

export class OrderNotReadyForReceiptError extends ReceiptDraftError {
  constructor(id: string, status: string) {
    super("ORDER_NOT_READY", `Order '${id}' is in status '${status}' — must be 'material_issued' or 'partially_received' to create a receipt draft.`);
    this.name = "OrderNotReadyForReceiptError";
  }
}

export class AllocationExceedsIssuedError extends ReceiptDraftError {
  constructor(inputId: string, cumulative: string, issued: string) {
    super("ALLOCATION_EXCEEDS_ISSUED", `Cumulative allocation (${cumulative} kg) for input '${inputId}' exceeds issued quantity (${issued} kg).`);
    this.name = "AllocationExceedsIssuedError";
  }
}

export class DuplicateAllocationError extends ReceiptDraftError {
  constructor(inputId: string) {
    super("DUPLICATE_ALLOCATION", `Input '${inputId}' is allocated more than once in the same receipt.`);
    this.name = "DuplicateAllocationError";
  }
}

// ---------------------------------------------------------------------------
// Service deps.
// ---------------------------------------------------------------------------

export interface ProductionReceiptDraftServiceDeps {
  receiptRepository: ProductionReceiptRepository;
  productionOrderRepository: ProductionOrderRepository;
  wipBalanceRepository: WipBalanceRepository;
  audit: AuditTransactionHandle;
  documentSequence: DocumentSequenceTransactionHandle;
}

const RECEIPT_ENTITY_TYPE = "production_receipt";

// ---------------------------------------------------------------------------
// ProductionReceiptDraftService.
// ---------------------------------------------------------------------------

export class ProductionReceiptDraftService {
  constructor(private readonly deps: ProductionReceiptDraftServiceDeps) {}

  /**
   * Create a production receipt draft with output facts + input allocations.
   *
   * Permission: production.receive_draft (worker can create drafts).
   * Rate/basis fields only accepted if user has production.view_cost.
   *
   * NO posting: no movement, no WIP change, no account entry, no payable.
   * Stores facts and subject hash only.
   */
  async createReceiptDraft(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: CreateReceiptDraftInput,
  ): Promise<CreateReceiptDraftResult> {
    requirePermission(effective, "production.receive_draft");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    // Validate basic input
    if (!input.productionOrderId) {
      throw new ReceiptDraftError("VALIDATION_FAILED", "productionOrderId is required.");
    }
    if (!isPositiveKg(input.outputQtyKg)) {
      throw new ReceiptDraftError("VALIDATION_FAILED", `Output quantity must be positive, got '${input.outputQtyKg}'.`);
    }
    if (input.allocations.length === 0) {
      throw new ReceiptDraftError("VALIDATION_FAILED", "At least one allocation is required.");
    }

    // Check for duplicate allocation (same input in same receipt)
    const inputIds = new Set<string>();
    for (const alloc of input.allocations) {
      if (inputIds.has(alloc.productionInputId)) {
        throw new DuplicateAllocationError(alloc.productionInputId);
      }
      inputIds.add(alloc.productionInputId);
      if (compareKg(alloc.consumedTowardOutputQtyKg, "0.000") < 0) {
        throw new ReceiptDraftError("VALIDATION_FAILED", `Consumed quantity must be non-negative for input '${alloc.productionInputId}'.`);
      }
      if (compareKg(alloc.allocatedWasteQtyKg, "0.000") < 0) {
        throw new ReceiptDraftError("VALIDATION_FAILED", `Waste quantity must be non-negative for input '${alloc.productionInputId}'.`);
      }
    }

    // Fetch production order
    const order = await this.deps.productionOrderRepository.findOrderById(user.tenantId, input.productionOrderId);
    if (!order) throw new ProductionOrderNotFoundForReceiptError(input.productionOrderId);
    requireTenantMatch(user, order.tenantId);

    // Order must be in material_issued or partially_received
    if (order.status !== "material_issued" && order.status !== "partially_received") {
      throw new OrderNotReadyForReceiptError(order.id, order.status);
    }

    // Fetch inputs for this order
    const orderInputs = await this.deps.productionOrderRepository.findInputsByOrder(user.tenantId, order.id);
    const inputMap = new Map<string, ProductionInput>();
    for (const inp of orderInputs) {
      inputMap.set(inp.id, inp);
    }

    // Validate each allocation against issued quantity
    const previews: AllocationPreview[] = [];
    for (const alloc of input.allocations) {
      const prodInput = inputMap.get(alloc.productionInputId);
      if (!prodInput) {
        throw new ReceiptDraftError("VALIDATION_FAILED", `Input '${alloc.productionInputId}' does not belong to order '${order.id}'.`);
      }

      // Get cumulative allocations across ALL receipts for this input
      const existingAllocations = await this.deps.receiptRepository.findAllocationsByInput(user.tenantId, alloc.productionInputId);
      let cumulativeConsumed = "0.000";
      let cumulativeWaste = "0.000";
      for (const ex of existingAllocations) {
        cumulativeConsumed = addKg(cumulativeConsumed, ex.consumedTowardOutputQtyKg);
        cumulativeWaste = addKg(cumulativeWaste, ex.allocatedWasteQtyKg);
      }

      // Add this receipt's allocation
      const thisConsumed = normalizeKg(alloc.consumedTowardOutputQtyKg);
      const thisWaste = normalizeKg(alloc.allocatedWasteQtyKg);
      const newCumulativeConsumed = addKg(cumulativeConsumed, thisConsumed);
      const newCumulativeWaste = addKg(cumulativeWaste, thisWaste);
      const totalAllocated = addKg(newCumulativeConsumed, newCumulativeWaste);

      // Check: cumulative consumed + waste <= issued_qty
      const isValid = compareKg(totalAllocated, prodInput.issuedQtyKg) <= 0;
      const validationError = isValid ? null : `Cumulative (${totalAllocated}) exceeds issued (${prodInput.issuedQtyKg})`;

      if (!isValid) {
        throw new AllocationExceedsIssuedError(alloc.productionInputId, totalAllocated, prodInput.issuedQtyKg);
      }

      const remainingWip = prodInput.issuedQtyKg; // WIP remaining = issued - consumed - waste - returned (returned=0 in WP-04-01)
      // Note: we compute remaining as issued - cumulative(consumed + waste) for preview
      // Actual WIP balance is in production_wip_balances, not computed here.

      previews.push({
        productionInputId: alloc.productionInputId,
        issuedQtyKg: prodInput.issuedQtyKg,
        cumulativeConsumedQtyKg: newCumulativeConsumed,
        cumulativeWasteQtyKg: newCumulativeWaste,
        remainingWipQtyKg: "0.000", // Computed in preview, not here
        thisReceiptConsumedQtyKg: thisConsumed,
        thisReceiptWasteQtyKg: thisWaste,
        thisReceiptPayableBasisQtyKg: addKg(thisConsumed, thisWaste),
        isValid,
        validationError,
      });
    }

    // Determine rate/basis — only accept if user has production.view_cost
    const hasCostPermission = effective.permissionKeys.has("production.view_cost");
    const factoryRate = hasCostPermission ? (input.factoryRatePerInputTon ?? null) : null;
    const costBasis = hasCostPermission ? (input.factoryCostBasis ?? "input_quantity") : "input_quantity";

    // Compute subject hash from receipt facts
    const subjectFields = [
      input.productionOrderId,
      input.outputItemId,
      input.outputLotId ?? "",
      input.outputLocationId,
      normalizeKg(input.outputQtyKg),
      input.receiptDate,
      ...input.allocations.flatMap(a => [a.productionInputId, normalizeKg(a.consumedTowardOutputQtyKg), normalizeKg(a.allocatedWasteQtyKg)]),
      factoryRate ?? "",
      costBasis,
    ];
    const subjectHash = createHash("sha256").update(JSON.stringify(subjectFields)).digest("hex");

    // Allocate doc number
    const year = new Date().getUTCFullYear();
    const docNoResult = await allocateDocumentNumber(this.deps.documentSequence, {
      tenantId: user.tenantId, documentType: "production_receipt", year, entityType: RECEIPT_ENTITY_TYPE,
    });

    // Create receipt draft
    const receipt = await this.deps.receiptRepository.insertReceipt({
      tenantId: user.tenantId,
      docNo: docNoResult.docNo,
      productionOrderId: order.id,
      outputItemId: input.outputItemId,
      outputLotId: input.outputLotId ?? null,
      outputLocationId: input.outputLocationId,
      outputQtyKg: normalizeKg(input.outputQtyKg),
      receiptDate: input.receiptDate,
      notes: input.notes ?? null,
      createdBy: user.userId,
      factoryRatePerInputTonUsed: factoryRate,
      factoryCostBasisUsed: costBasis,
      subjectHash,
      subjectVersion: 1,
      idempotencyKey: `receipt-draft-${user.userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });

    // Create allocations
    const allocationResults: CreateReceiptDraftResult["allocations"] = [];
    for (const alloc of input.allocations) {
      const created = await this.deps.receiptRepository.insertAllocation({
        tenantId: user.tenantId,
        productionReceiptId: receipt.id,
        productionInputId: alloc.productionInputId,
        consumedTowardOutputQtyKg: normalizeKg(alloc.consumedTowardOutputQtyKg),
        allocatedWasteQtyKg: normalizeKg(alloc.allocatedWasteQtyKg),
      });
      allocationResults.push({
        id: created.id,
        productionInputId: created.productionInputId,
        consumedTowardOutputQtyKg: created.consumedTowardOutputQtyKg,
        allocatedWasteQtyKg: created.allocatedWasteQtyKg,
        payableCostBasisQtyKg: created.payableCostBasisQtyKg,
      });
    }

    // Update preview with remaining WIP from WIP balance table
    for (const preview of previews) {
      const wipBalance = await this.deps.wipBalanceRepository.findForUpdate(
        user.tenantId, order.id, preview.productionInputId, order.factoryLocationId,
      );
      preview.remainingWipQtyKg = wipBalance?.wipQtyKg ?? "0.000";
    }

    // Audit (no business state change — just record the draft creation)
    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: RECEIPT_ENTITY_TYPE, entityId: receipt.id,
      actionType: "production_receipt_draft.create",
      newValuesJson: {
        docNo: receipt.docNo,
        productionOrderId: order.id,
        outputItemId: input.outputItemId,
        outputQtyKg: normalizeKg(input.outputQtyKg),
        allocationCount: allocationResults.length,
        subjectHash: subjectHash.slice(0, 16) + "...",
        hasRateSnapshot: factoryRate !== null,
      },
    });

    return {
      receiptId: receipt.id,
      docNo: receipt.docNo,
      status: receipt.status,
      subjectHash,
      allocations: allocationResults,
      preview: previews,
    };
  }

  /**
   * Preview allocation lineage for a receipt draft without creating it.
   *
   * Returns the cumulative consumed/waste/remaining WIP for each input
   * if the given allocations were applied. Does NOT create any rows.
   */
  async previewAllocation(
    user: ErpUserContext,
    effective: EffectivePermissions,
    productionOrderId: string,
    proposedAllocations: Array<{
      productionInputId: string;
      consumedTowardOutputQtyKg: string;
      allocatedWasteQtyKg: string;
    }>,
  ): Promise<AllocationPreview[]> {
    requirePermission(effective, "production.receive_draft");

    const order = await this.deps.productionOrderRepository.findOrderById(user.tenantId, productionOrderId);
    if (!order) throw new ProductionOrderNotFoundForReceiptError(productionOrderId);
    requireTenantMatch(user, order.tenantId);

    const orderInputs = await this.deps.productionOrderRepository.findInputsByOrder(user.tenantId, order.id);
    const inputMap = new Map<string, ProductionInput>();
    for (const inp of orderInputs) inputMap.set(inp.id, inp);

    const previews: AllocationPreview[] = [];
    for (const alloc of proposedAllocations) {
      const prodInput = inputMap.get(alloc.productionInputId);
      if (!prodInput) continue;

      const existingAllocations = await this.deps.receiptRepository.findAllocationsByInput(user.tenantId, alloc.productionInputId);
      let cumulativeConsumed = "0.000";
      let cumulativeWaste = "0.000";
      for (const ex of existingAllocations) {
        cumulativeConsumed = addKg(cumulativeConsumed, ex.consumedTowardOutputQtyKg);
        cumulativeWaste = addKg(cumulativeWaste, ex.allocatedWasteQtyKg);
      }

      const thisConsumed = normalizeKg(alloc.consumedTowardOutputQtyKg);
      const thisWaste = normalizeKg(alloc.allocatedWasteQtyKg);
      const newCumulativeConsumed = addKg(cumulativeConsumed, thisConsumed);
      const newCumulativeWaste = addKg(cumulativeWaste, thisWaste);
      const totalAllocated = addKg(newCumulativeConsumed, newCumulativeWaste);
      const isValid = compareKg(totalAllocated, prodInput.issuedQtyKg) <= 0;

      const wipBalance = await this.deps.wipBalanceRepository.findForUpdate(
        user.tenantId, order.id, alloc.productionInputId, order.factoryLocationId,
      );

      previews.push({
        productionInputId: alloc.productionInputId,
        issuedQtyKg: prodInput.issuedQtyKg,
        cumulativeConsumedQtyKg: newCumulativeConsumed,
        cumulativeWasteQtyKg: newCumulativeWaste,
        remainingWipQtyKg: wipBalance?.wipQtyKg ?? "0.000",
        thisReceiptConsumedQtyKg: thisConsumed,
        thisReceiptWasteQtyKg: thisWaste,
        thisReceiptPayableBasisQtyKg: addKg(thisConsumed, thisWaste),
        isValid,
        validationError: isValid ? null : `Cumulative (${totalAllocated}) exceeds issued (${prodInput.issuedQtyKg})`,
      });
    }

    return previews;
  }
}
