/**
 * Sales orders, sales order lines, profitability snapshots.
 * Contract 03 §11.1–11.2 + Contract 07 §10.
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
import { inventoryItems } from "./inventory-items";
import { locations } from "./master-data";
import { stockReservations } from "./inventory-ledger";
import { stockMovements } from "./inventory-ledger";
import { approvalRequests } from "./approval-requests";
import {
  saleStatus, snapshotActiveState,
} from "./financial-enums";
import { recordOrigin, recordPeriod, approvalStatus } from "./enums";

const usersId = users.id!;

// ---------------------------------------------------------------------------
// sales_orders
// ---------------------------------------------------------------------------

export const salesOrders = pgTable("sales_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantIdColumn(),
  docNo: text("doc_no").notNull(),
  customerId: uuid("customer_id").notNull().references(() => customers.id),
  saleStatus: saleStatus("sale_status").notNull().default("draft"),
  approvalStatus: approvalStatus("approval_status").notNull().default("draft"),
  saleDate: date("sale_date").notNull(),
  totalGrossRevenue: numeric("total_gross_revenue", { precision: 18, scale: 2 }).notNull().default("0"),
  orderDiscountTotal: numeric("order_discount_total", { precision: 18, scale: 2 }).notNull().default("0"),
  documentTotalPosted: numeric("document_total_posted", { precision: 18, scale: 2 }).notNull().default("0"),
  qualityWarningStatus: text("quality_warning_status"),
  reservationStatus: text("reservation_status"),
  paymentStatus: text("payment_status"),
  deliveryStatus: text("delivery_status"),
  // Replacement link (DEC-050)
  isReplacementOrder: boolean("is_replacement_order").notNull().default(false),
  originalReturnRequestId: uuid("original_return_request_id"),
  recordOrigin: recordOrigin("record_origin").notNull().default("manual_live"),
  recordPeriod: recordPeriod("record_period").notNull().default("live"),
  isLocked: boolean("is_locked").notNull().default(false),
  importBatchId: uuid("import_batch_id"),
  reversalOfId: uuid("reversal_of_id"),
  correctionOfId: uuid("correction_of_id"),
  approvedBy: uuid("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at", { withTimezone: true, mode: "date" }),
  // WP-05-03: Subject hash + version for invalidation detection (Contract 06 §6 step 4).
  subjectHash: text("subject_hash"),
  subjectVersion: integer("subject_version").default(1),
  ...makeTenantOwnedRow(usersId),
}, (t) => [
  uniqueIndex("sales_orders_tenant_doc_no_unique_idx").on(t.tenantId, t.docNo),
  index("sales_orders_tenant_customer_idx").on(t.tenantId, t.customerId),
  index("sales_orders_tenant_status_idx").on(t.tenantId, t.saleStatus),
  index("sales_orders_tenant_date_idx").on(t.tenantId, t.saleDate),
  // WP-06-04: Only one replacement order per return request.
  // DB-level enforcement prevents duplicate replacement orders even under
  // concurrent requests with different idempotency keys. The partial index
  // only applies when is_replacement_order = true AND original_return_request_id
  // IS NOT NULL, so ordinary sales orders are unaffected.
  uniqueIndex("sales_orders_replacement_return_unique_idx")
    .on(t.tenantId, t.originalReturnRequestId)
    .where(sql`is_replacement_order = true AND original_return_request_id IS NOT NULL`),
  check("sales_orders_total_gross_check", sql`total_gross_revenue >= 0`),
  check("sales_orders_discount_check", sql`order_discount_total >= 0`),
  check("sales_orders_doc_total_check", sql`document_total_posted >= 0`),
  check("sales_orders_discount_within_gross_check",
    sql`order_discount_total <= total_gross_revenue`),
]);

export type SalesOrder = typeof salesOrders.$inferSelect;
export type NewSalesOrder = typeof salesOrders.$inferInsert;

// ---------------------------------------------------------------------------
// sales_order_lines
// ---------------------------------------------------------------------------

export const salesOrderLines = pgTable("sales_order_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantIdColumn(),
  salesOrderId: uuid("sales_order_id").notNull().references(() => salesOrders.id),
  lineNo: integer("line_no").notNull(),
  itemId: uuid("item_id").notNull().references(() => inventoryItems.id),
  locationId: uuid("location_id").notNull().references(() => locations.id),
  quantityKg: numeric("quantity_kg", { precision: 18, scale: 3 }).notNull(),
  pricePerTon: numeric("price_per_ton", { precision: 18, scale: 2 }),
  // Revenue fields — nullable for warehouse-created operational drafts
  lineGrossRevenue: numeric("line_gross_revenue", { precision: 18, scale: 2 }),
  lineAllocatedDiscountPrecise: numeric("line_allocated_discount_precise", { precision: 24, scale: 8 }),
  lineAllocatedDiscountPosted: numeric("line_allocated_discount_posted", { precision: 18, scale: 2 }),
  lineNetRevenuePrecise: numeric("line_net_revenue_precise", { precision: 24, scale: 8 }),
  lineNetRevenuePosted: numeric("line_net_revenue_posted", { precision: 18, scale: 2 }),
  roundingAdjustment: numeric("rounding_adjustment", { precision: 18, scale: 2 }).notNull().default("0"),
  // Links
  reservationId: uuid("reservation_id").references(() => stockReservations.id),
  saleIssueMovementId: uuid("sale_issue_movement_id").references(() => stockMovements.id),
  qualityWarningSnapshotJson: text("quality_warning_snapshot_json"),
  // WP-06-04: Line-level traceability for replacement orders.
  // When this sale line is part of a replacement order, this column stores
  // the ID of the return line that triggered the replacement. This allows
  // the complete chain: replacement sale line → return line → original sale
  // line → original sale. NULL for ordinary (non-replacement) sale lines.
  originalReturnLineId: uuid("original_return_line_id"),
  ...makeTenantOwnedRow(usersId),
}, (t) => [
  uniqueIndex("sales_order_lines_tenant_order_line_unique_idx").on(t.tenantId, t.salesOrderId, t.lineNo),
  index("sales_order_lines_tenant_order_idx").on(t.tenantId, t.salesOrderId),
  index("sales_order_lines_tenant_item_idx").on(t.tenantId, t.itemId),
  // WP-06-04: Index for line-level traceability queries.
  index("sales_order_lines_tenant_return_line_idx").on(t.tenantId, t.originalReturnLineId),
  check("sales_order_lines_qty_check", sql`quantity_kg > 0`),
  check("sales_order_lines_price_check", sql`price_per_ton IS NULL OR price_per_ton >= 0`),
  check("sales_order_lines_rounding_check", sql`rounding_adjustment = 0 OR (line_gross_revenue IS NOT NULL AND line_allocated_discount_posted IS NOT NULL)`),
]);

export type SalesOrderLine = typeof salesOrderLines.$inferSelect;
export type NewSalesOrderLine = typeof salesOrderLines.$inferInsert;

// ---------------------------------------------------------------------------
// sales_profitability_snapshots
// ---------------------------------------------------------------------------

export const salesProfitabilitySnapshots = pgTable("sales_profitability_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantIdColumn(),
  salesOrderId: uuid("sales_order_id").notNull().references(() => salesOrders.id),
  version: integer("version").notNull(),
  isActive: snapshotActiveState("is_active").notNull().default("active"),
  supersededBySnapshotId: uuid("superseded_by_snapshot_id"),
  profileVersion: text("profile_version"),
  rawCostSnapshot: numeric("raw_cost_snapshot", { precision: 18, scale: 2 }),
  singleProductionCostSnapshot: numeric("single_production_cost_snapshot", { precision: 18, scale: 2 }),
  twistingCostSnapshot: numeric("twisting_cost_snapshot", { precision: 18, scale: 2 }),
  transportCostSnapshot: numeric("transport_cost_snapshot", { precision: 18, scale: 2 }),
  discountSnapshot: numeric("discount_snapshot", { precision: 18, scale: 2 }),
  returnImpactSnapshot: numeric("return_impact_snapshot", { precision: 18, scale: 2 }),
  revenueSnapshot: numeric("revenue_snapshot", { precision: 18, scale: 2 }),
  profitAmount: numeric("profit_amount", { precision: 18, scale: 2 }),
  profitMarginPercent: numeric("profit_margin_percent", { precision: 18, scale: 6 }),
  missingCostFlagsJson: text("missing_cost_flags_json"),
  calculationNotes: text("calculation_notes"),
  calculatedAt: timestamp("calculated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  calculatedBy: uuid("calculated_by").references(() => users.id),
  ...makeTenantOwnedRow(usersId),
}, (t) => [
  uniqueIndex("profitability_snapshots_tenant_order_version_unique_idx").on(t.tenantId, t.salesOrderId, t.version),
  index("profitability_snapshots_tenant_active_idx").on(t.tenantId, t.salesOrderId, t.isActive),
  check("profitability_snapshots_version_check", sql`version >= 1`),
]);

export type SalesProfitabilitySnapshot = typeof salesProfitabilitySnapshots.$inferSelect;
export type NewSalesProfitabilitySnapshot = typeof salesProfitabilitySnapshots.$inferInsert;
