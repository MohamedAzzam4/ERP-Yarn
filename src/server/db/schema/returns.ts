/**
 * Returns: return_requests, return_lines.
 * Contract 03 §11.3 + Contract 07 §10.1.
 * DEC-068: partial-return residual/cap persistence.
 */
import {
  text, uuid, numeric, date, timestamp, boolean, integer,
  pgTable, uniqueIndex, index, check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { tenantIdColumn, makeTenantOwnedRow } from "./_helpers";
import { users } from "./users";
import { customers } from "./master-data";
import { salesOrders } from "./sales";
import { salesOrderLines } from "./sales";
import { inventoryItems } from "./inventory-items";
import { locations } from "./master-data";
import { stockMovements } from "./inventory-ledger";
import { approvalRequests } from "./approval-requests";
import {
  returnStatus, returnFinancialTreatment,
} from "./financial-enums";
import { returnedStockStatus } from "./inventory-enums";
import { recordOrigin, recordPeriod, approvalStatus } from "./enums";

const usersId = users.id!;

// ---------------------------------------------------------------------------
// return_requests
// ---------------------------------------------------------------------------

export const returnRequests = pgTable("return_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantIdColumn(),
  docNo: text("doc_no").notNull(),
  salesOrderId: uuid("sales_order_id").notNull().references(() => salesOrders.id),
  customerId: uuid("customer_id").notNull().references(() => customers.id),
  returnDate: date("return_date").notNull(),
  status: returnStatus("status").notNull().default("draft"),
  approvalStatus: approvalStatus("approval_status").notNull().default("draft"),
  returnReason: text("return_reason").notNull(),
  financialTreatment: returnFinancialTreatment("financial_treatment"),
  customerAdjustmentAmount: numeric("customer_adjustment_amount", { precision: 18, scale: 2 }),
  // Replacement links (DEC-050)
  isReplacement: boolean("is_replacement").notNull().default(false),
  replacementOrderId: uuid("replacement_order_id"),
  // Origin/import metadata
  recordOrigin: recordOrigin("record_origin").notNull().default("manual_live"),
  recordPeriod: recordPeriod("record_period").notNull().default("live"),
  isLocked: boolean("is_locked").notNull().default(false),
  importBatchId: uuid("import_batch_id"),
  approvedBy: uuid("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at", { withTimezone: true, mode: "date" }),
  ...makeTenantOwnedRow(usersId),
}, (t) => [
  uniqueIndex("return_requests_tenant_doc_no_unique_idx").on(t.tenantId, t.docNo),
  index("return_requests_tenant_sale_idx").on(t.tenantId, t.salesOrderId),
  index("return_requests_tenant_customer_idx").on(t.tenantId, t.customerId),
  index("return_requests_tenant_status_idx").on(t.tenantId, t.status),
  check("return_requests_adjustment_check",
    sql`customer_adjustment_amount IS NULL OR customer_adjustment_amount >= 0`),
]);

export type ReturnRequest = typeof returnRequests.$inferSelect;
export type NewReturnRequest = typeof returnRequests.$inferInsert;

// ---------------------------------------------------------------------------
// return_lines
// ---------------------------------------------------------------------------

export const returnLines = pgTable("return_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantIdColumn(),
  returnRequestId: uuid("return_request_id").notNull().references(() => returnRequests.id),
  // Original sale line link (DEC-050/068)
  originalSaleOrderId: uuid("original_sale_order_id").notNull().references(() => salesOrders.id),
  originalSaleLineId: uuid("original_sale_line_id").notNull().references(() => salesOrderLines.id),
  itemId: uuid("item_id").notNull().references(() => inventoryItems.id),
  quantityKg: numeric("quantity_kg", { precision: 18, scale: 3 }).notNull(),
  returnLocationId: uuid("return_location_id").notNull().references(() => locations.id),
  // Returned stock classification (Contract 04 §11)
  returnedStockStatus: returnedStockStatus("returned_stock_status").notNull(),
  qualityStatusAfterReturn: text("quality_status_after_return"),
  // DEC-068: return credit value persistence
  // Original approved sale-line net unit value snapshotted at DECIMAL(18,6)
  originalSaleLineNetUnitValue: numeric("original_sale_line_net_unit_value", { precision: 18, scale: 6 }),
  // Posted return credit value at DECIMAL(18,2)
  returnCreditValue: numeric("return_credit_value", { precision: 18, scale: 2 }),
  // DEC-068: residual adjustment on the final partial return
  residualAdjustment: numeric("residual_adjustment", { precision: 18, scale: 2 }).notNull().default("0"),
  // Cumulative prior returns for this sale line (snapshotted at return approval)
  cumulativePriorReturnQty: numeric("cumulative_prior_return_qty", { precision: 18, scale: 3 }).notNull().default("0"),
  cumulativePriorReturnCredit: numeric("cumulative_prior_return_credit", { precision: 18, scale: 2 }).notNull().default("0"),
  // Movement link
  returnMovementId: uuid("return_movement_id").references(() => stockMovements.id),
  ...makeTenantOwnedRow(usersId),
}, (t) => [
  index("return_lines_tenant_request_idx").on(t.tenantId, t.returnRequestId),
  index("return_lines_tenant_sale_line_idx").on(t.tenantId, t.originalSaleLineId),
  check("return_lines_qty_check", sql`quantity_kg > 0`),
  check("return_lines_credit_check",
    sql`return_credit_value IS NULL OR return_credit_value >= 0`),
  check("return_lines_cumulative_qty_check", sql`cumulative_prior_return_qty >= 0`),
  check("return_lines_cumulative_credit_check", sql`cumulative_prior_return_credit >= 0`),
]);

export type ReturnLine = typeof returnLines.$inferSelect;
export type NewReturnLine = typeof returnLines.$inferInsert;
