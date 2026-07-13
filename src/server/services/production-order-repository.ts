/**
 * Production Order Repository — WP-04-01 + WP-04-04.
 *
 * Minimal repository for production_orders + production_inputs.
 * WP-04-01 scope: create draft orders with input rows, read, update status.
 * WP-04-04 scope: apply return-from-WIP to input quantities.
 */
import "server-only";

import type { ProductionOrder, ProductionInput } from "@/server/db/schema/production-orders";

export interface NewProductionOrderInput {
  tenantId: string;
  docNo: string;
  productionType: "single_yarn" | "twisted_yarn";
  factoryId: string;
  factoryLocationId: string;
  createdBy: string;
}

export interface NewProductionInputRow {
  tenantId: string;
  productionOrderId: string;
  inputItemId: string;
  inputLocationId: string;
  plannedInputQtyKg: string;
}

export interface ProductionOrderRepository {
  insertOrder(row: NewProductionOrderInput): Promise<ProductionOrder>;
  insertInput(row: NewProductionInputRow): Promise<ProductionInput>;
  findOrderById(tenantId: string, id: string): Promise<ProductionOrder | null>;
  findInputsByOrder(tenantId: string, orderId: string): Promise<ProductionInput[]>;
  findInputById(tenantId: string, id: string): Promise<ProductionInput | null>;
  updateOrderStatus(
    tenantId: string,
    orderId: string,
    patch: { status: string; approvalStatus: string },
  ): Promise<ProductionOrder | null>;
  updateInputIssuedQty(
    tenantId: string,
    inputId: string,
    patch: { issuedQtyKg: string; issueMovementId: string | null },
  ): Promise<ProductionInput | null>;
  updateOrderStatusConditional(
    tenantId: string,
    orderId: string,
    patch: { status: string; approvalStatus: string },
    expectedCurrentStatuses: string[],
  ): Promise<ProductionOrder | null>;

  /**
   * WP-04-04: Apply a return-from-WIP correction to a production_input row.
   *
   * Atomically increments `returned_from_wip_qty_kg` by `returnQtyKg` and
   * recomputes `remaining_wip_qty_kg` = `issued_qty_kg - consumed_qty_kg -
   * returned_from_wip_qty_kg - waste_qty_kg`. Since `production_inputs` has
   * no `waste_qty_kg` column, waste is passed as a separate parameter
   * (derived from `production_waste_entries` for this input).
   *
   * Contract 05 §13 invariant: `issued = consumed + waste + returned + remaining`.
   *
   * This method does NOT use a version column (production_inputs has no
   * version column); concurrency is guarded by the outer transaction's
   * SELECT FOR UPDATE on the production_wip_balances row and the
   * production_wip_returns row, which serialize return-from-WIP approvals
   * for the same order+input.
   *
   * Returns the updated input row, or null if the input was not found.
   */
  applyReturnFromWipToInput(
    tenantId: string,
    inputId: string,
    patch: {
      returnQtyKg: string;
      cumulativeWasteQtyKg: string;
    },
  ): Promise<ProductionInput | null>;
}
