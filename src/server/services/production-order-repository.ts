/**
 * Production Order Repository — WP-04-01.
 *
 * Minimal repository for production_orders + production_inputs.
 * WP-04-01 scope: create draft orders with input rows, read, update status.
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
}
