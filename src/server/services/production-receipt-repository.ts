/**
 * Production Receipt Repository — WP-04-02 + WP-04-03.
 *
 * Repository interface for production_receipts + production_receipt_input_allocations.
 * WP-04-02 scope: draft creation + allocation validation only. No posting.
 * WP-04-03 scope: approve/post methods + waste entry persistence + output row update.
 */
import "server-only";

import type { ProductionReceipt, ProductionReceiptInputAllocation, ProductionWasteEntry } from "@/server/db/schema/production-receipts";
import type { ProductionOutput } from "@/server/db/schema/production-orders";

export interface NewReceiptDraftInput {
  tenantId: string;
  docNo: string;
  productionOrderId: string;
  outputItemId: string;
  outputLotId: string | null;
  outputLocationId: string;
  outputQtyKg: string;
  receiptDate: string;
  notes: string | null;
  createdBy: string;
  // Rate/basis snapshot (confirmed by Accountant/Owner, stored as draft facts)
  factoryRatePerInputTonUsed: string | null;
  factoryCostBasisUsed: string;
  // Subject hash for invalidation detection
  subjectHash: string;
  subjectVersion: number;
  idempotencyKey: string;
}

export interface NewAllocationInput {
  tenantId: string;
  productionReceiptId: string;
  productionInputId: string;
  consumedTowardOutputQtyKg: string;
  allocatedWasteQtyKg: string;
}

// ---------------------------------------------------------------------------
// WP-04-03: Approval/posting patch — applied inside the atomic transaction.
// ---------------------------------------------------------------------------

/**
 * Patch applied to production_receipts when the receipt is approved.
 * All financial/snapshot fields are server-computed; the orchestrator
 * populates them from the rate/basis snapshot stored at draft creation
 * (DEC-014) and from the calculated factory payable.
 */
export interface ReceiptApprovalPatch {
  /** New receipt status: 'partially_received' or 'completed'. */
  status: "partially_received" | "completed";
  /** approval_status: 'approved' (terminal for the receipt lifecycle). */
  approvalStatus: "approved";
  /** is_locked: true after approval — prevents re-approval. */
  isLocked: true;
  /** confirmed_by: the approver's user_id. */
  confirmedBy: string;
  /** confirmed_at: server-set timestamp. */
  confirmedAt: Date;
  /** receipt_movement_id: FK to the receive_from_production stock_movement. */
  receiptMovementId: string;
  /** account_entry_id: FK to the factory_production_payable account_entry. */
  accountEntryId: string | null;
  /** factory_payable: calculated payable amount (positive, NUMERIC(18,2)). */
  factoryPayable: string | null;
  /** calculated_factory_cost: same as factory_payable for input_quantity basis. */
  calculatedFactoryCost: string | null;
  /** factory_cost_basis_input_qty_kg: SUM(consumed + waste). */
  factoryCostBasisInputQtyKg: string | null;
  /** calculation_version: snapshot version tag (e.g., "v1"). */
  calculationVersion: string;
}

/**
 * New waste entry row — one per allocation with waste_qty > 0.
 * Contract 03 §10.4, Contract 05 §15.
 */
export interface NewWasteEntryInput {
  tenantId: string;
  productionOrderId: string;
  productionInputId: string;
  productionReceiptId: string;
  wasteQtyKg: string;
  wastePercent: string | null;
  wasteReason: string | null;
  movementId: string;
}

/**
 * Patch applied to production_outputs when the receipt is approved.
 * Links the output row to the receive_from_production movement.
 */
export interface OutputReceiptLinkPatch {
  receiptMovementId: string;
}

export interface ProductionReceiptRepository {
  // WP-04-02 draft methods
  insertReceipt(row: NewReceiptDraftInput): Promise<ProductionReceipt>;
  insertAllocation(row: NewAllocationInput): Promise<ProductionReceiptInputAllocation>;
  findReceiptById(tenantId: string, id: string): Promise<ProductionReceipt | null>;
  findAllocationsByReceipt(tenantId: string, receiptId: string): Promise<ProductionReceiptInputAllocation[]>;
  findReceiptsByOrder(tenantId: string, orderId: string): Promise<ProductionReceipt[]>;
  findAllocationsByInput(tenantId: string, productionInputId: string): Promise<ProductionReceiptInputAllocation[]>;

  // WP-04-03 approval/posting methods

  /**
   * Conditionally mark a receipt as approved/locked.
   *
   * Contract 06 §6 step 8: "recheck all business preconditions under lock."
   * The conditional WHERE clause ensures the receipt is still in an
   * approvable state (`status IN ('draft', 'pending_approval')` AND
   * `is_locked = false`). If a concurrent approval already locked it,
   * this returns null — the orchestrator throws STATE_CONFLICT.
   *
   * Returns the updated row, or null if the precondition did not match.
   */
  markApprovedConditional(
    tenantId: string,
    receiptId: string,
    patch: ReceiptApprovalPatch,
    expectedCurrentStatuses: ReadonlyArray<string>,
  ): Promise<ProductionReceipt | null>;

  /** Insert a production_waste_entries row. */
  insertWasteEntry(row: NewWasteEntryInput): Promise<ProductionWasteEntry>;

  /**
   * Find the production_outputs row for a (tenant, order, output_item, output_location)
   * tuple. The orchestrator uses this to link the receipt movement to the
   * output row. Returns null if no output row exists yet (the orchestrator
   * may create one — out of scope for WP-04-03 minimal path; the draft
   * service stores output_item_id on the receipt row directly).
   */
  findOutputForReceipt(
    tenantId: string,
    productionOrderId: string,
    outputItemId: string,
    outputLocationId: string,
  ): Promise<ProductionOutput | null>;

  /**
   * Update the production_outputs row with the receipt_movement_id link.
   * Conditional on the row existing.
   */
  linkOutputToReceiptMovement(
    tenantId: string,
    outputId: string,
    patch: OutputReceiptLinkPatch,
  ): Promise<ProductionOutput | null>;

  /** Insert a new production_outputs row (if one doesn't exist for this output). */
  insertOutputRow(row: {
    tenantId: string;
    productionOrderId: string;
    outputItemId: string;
    outputLotId: string | null;
    outputLocationId: string;
    outputQtyKg: string;
    receiptMovementId: string;
    createdBy: string;
  }): Promise<ProductionOutput>;
}
