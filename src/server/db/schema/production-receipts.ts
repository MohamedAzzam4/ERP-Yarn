/**
 * Production receipt, allocation, waste, and WIP-return schema.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §10.4
 * Contract: docs/contracts/05_production_wip_contract.md §§14–16, 20
 *
 * DEC-013: Factory payable is created only on approved production output
 *   receipt — not on material transfer or issue.
 * DEC-014: Rate/rule values used by approved transactions are snapshotted.
 */
import {
  text,
  uuid,
  numeric,
  date,
  timestamp,
  boolean,
  integer,
  pgTable,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { tenantIdColumn, makeTenantOwnedRow } from "./_helpers";
import { users } from "./users";
import { locations } from "./master-data";
import { inventoryItems } from "./inventory-items";
import { yarnLots } from "./inventory-items";
import { stockMovements } from "./inventory-ledger";
import { productionOrders } from "./production-orders";
import { productionInputs } from "./production-orders";
import { approvalRequests } from "./approval-requests";
import {
  productionStatus,
  wipReturnStatus,
} from "./production-enums";
import {
  recordOrigin,
  recordPeriod,
  approvalStatus,
} from "./enums";

const usersId = users.id!;

// ---------------------------------------------------------------------------
// production_receipts
// ---------------------------------------------------------------------------

/**
 * `production_receipts` table.
 *
 * Contract 03 §10.4 + Contract 05 §14.
 *
 * DEC-013: Payable is created only on approved production output receipt.
 * Each receipt has its own rate snapshot, payable, approval, and idempotency.
 *
 * The receipt stores the confirmed rate/cost snapshot at approval time
 * (DEC-014). Changing factory defaults never recalculates approved receipts.
 *
 * `account_entry_id` is a plain uuid — FK to account_entries will be added
 * in WP-00-03D when the subledger tables exist.
 */
export const productionReceipts = pgTable(
  "production_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    docNo: text("doc_no").notNull(),
    productionOrderId: uuid("production_order_id")
      .notNull()
      .references(() => productionOrders.id),
    outputItemId: uuid("output_item_id")
      .notNull()
      .references(() => inventoryItems.id),
    outputLotId: uuid("output_lot_id").references(() => yarnLots.id),
    outputLocationId: uuid("output_location_id")
      .notNull()
      .references(() => locations.id),
    outputQtyKg: numeric("output_qty_kg", { precision: 18, scale: 3 }).notNull(),
    receiptDate: date("receipt_date").notNull(),
    status: productionStatus("status").notNull().default("draft"),
    approvalStatus: approvalStatus("approval_status").notNull().default("draft"),

    // DEC-013/014: Rate/cost snapshot at receipt approval time
    payableTriggerUsed: text("payable_trigger_used").default("production_receipt_approval"),
    factoryCostBasisUsed: text("factory_cost_basis_used").default("input_quantity"),
    factoryRatePerInputTonUsed: numeric("factory_rate_per_input_ton_used", {
      precision: 18,
      scale: 2,
    }),
    factoryCostBasisInputQtyKg: numeric("factory_cost_basis_input_qty_kg", {
      precision: 18,
      scale: 3,
    }),
    calculatedFactoryCost: numeric("calculated_factory_cost", {
      precision: 18,
      scale: 2,
    }),
    calculationVersion: text("calculation_version"),

    // Factory payable (posted at approval — DEC-013)
    factoryPayable: numeric("factory_payable", { precision: 18, scale: 2 }),

    // Plain uuid — FK to account_entries added in WP-00-03D
    accountEntryId: uuid("account_entry_id"),

    // Idempotency
    idempotencyKey: text("idempotency_key").notNull(),
    approvalRequestId: uuid("approval_request_id").references(() => approvalRequests.id),

    // Receipt movement (receive_from_production)
    receiptMovementId: uuid("receipt_movement_id").references(() => stockMovements.id),

    notes: text("notes"),
    confirmedBy: uuid("confirmed_by").references(() => users.id),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: "date" }),

    // Origin/import metadata
    recordOrigin: recordOrigin("record_origin").notNull().default("manual_live"),
    recordPeriod: recordPeriod("record_period").notNull().default("live"),
    isLocked: boolean("is_locked").notNull().default(false),
    importBatchId: uuid("import_batch_id"),
    ...makeTenantOwnedRow(usersId),
  },
  (t) => [
    uniqueIndex("production_receipts_tenant_doc_no_unique_idx").on(t.tenantId, t.docNo),
    uniqueIndex("production_receipts_tenant_idempotency_unique_idx").on(t.tenantId, t.idempotencyKey),
    index("production_receipts_tenant_order_idx").on(t.tenantId, t.productionOrderId),
    index("production_receipts_tenant_status_idx").on(t.tenantId, t.status),
    index("production_receipts_tenant_lot_idx").on(t.tenantId, t.outputLotId),
    // Quantities positive
    check("production_receipts_output_qty_check", sql`output_qty_kg > 0`),
    // Rate/payable non-negative when present
    check(
      "production_receipts_rate_check",
      sql`factory_rate_per_input_ton_used IS NULL OR factory_rate_per_input_ton_used >= 0`,
    ),
    check(
      "production_receipts_payable_check",
      sql`factory_payable IS NULL OR factory_payable >= 0`,
    ),
    check(
      "production_receipts_basis_input_qty_check",
      sql`factory_cost_basis_input_qty_kg IS NULL OR factory_cost_basis_input_qty_kg >= 0`,
    ),
  ],
);

export type ProductionReceipt = typeof productionReceipts.$inferSelect;
export type NewProductionReceipt = typeof productionReceipts.$inferInsert;

// ---------------------------------------------------------------------------
// production_receipt_input_allocations
// ---------------------------------------------------------------------------

/**
 * `production_receipt_input_allocations` table.
 *
 * Contract 03 §10.4 + Contract 05 §§14, 16.
 *
 * Each receipt allocates its consumed/waste input quantities to input rows
 * so partial payables and lineage cannot be duplicated.
 *
 * Key invariant (Contract 05 §16): "The system must prevent the same input
 * quantity or waste from being allocated/payable twice across partial
 * receipts." This is enforced by:
 *   1. Unique (tenant_id, production_input_id, receipt_id) — one allocation
 *      row per (input, receipt) pair.
 *   2. Service-layer validation that cumulative consumed + waste across all
 *      receipts for an input does not exceed issued_qty.
 *
 * `factory_cost_basis_input_qty_kg` = consumed_toward_output_qty + waste_qty
 * (Contract 05 §16: waste does not reduce payable).
 */
export const productionReceiptInputAllocations = pgTable(
  "production_receipt_input_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    productionReceiptId: uuid("production_receipt_id")
      .notNull()
      .references(() => productionReceipts.id),
    productionInputId: uuid("production_input_id")
      .notNull()
      .references(() => productionInputs.id),
    consumedTowardOutputQtyKg: numeric("consumed_toward_output_qty_kg", {
      precision: 18,
      scale: 3,
    }).notNull().default("0"),
    allocatedWasteQtyKg: numeric("allocated_waste_qty_kg", {
      precision: 18,
      scale: 3,
    }).notNull().default("0"),
    payableCostBasisQtyKg: numeric("payable_cost_basis_qty_kg", {
      precision: 18,
      scale: 3,
    }).notNull().default("0"),
    ...makeTenantOwnedRow(usersId),
  },
  (t) => [
    // One allocation row per (receipt, input) pair — prevents duplicate
    // allocation of the same input to the same receipt.
    uniqueIndex("receipt_allocations_receipt_input_unique_idx").on(
      t.tenantId,
      t.productionReceiptId,
      t.productionInputId,
    ),
    index("receipt_allocations_tenant_input_idx").on(t.tenantId, t.productionInputId),
    // Quantities non-negative
    check("receipt_allocations_consumed_check", sql`consumed_toward_output_qty_kg >= 0`),
    check("receipt_allocations_waste_check", sql`allocated_waste_qty_kg >= 0`),
    check("receipt_allocations_basis_check", sql`payable_cost_basis_qty_kg >= 0`),
  ],
);

export type ProductionReceiptInputAllocation =
  typeof productionReceiptInputAllocations.$inferSelect;
export type NewProductionReceiptInputAllocation =
  typeof productionReceiptInputAllocations.$inferInsert;

// ---------------------------------------------------------------------------
// production_waste_entries
// ---------------------------------------------------------------------------

/**
 * `production_waste_entries` table.
 *
 * Contract 03 §10.4 + Contract 05 §15.
 *
 * Waste is explicit, linked to order/receipt/input, visible in reporting,
 * and removed from WIP. It is NOT hidden yield loss.
 *
 * For current client, waste does NOT reduce factory payable (DEC-013).
 * It increases effective output cost per kg because less output carries
 * the input/factory cost.
 */
export const productionWasteEntries = pgTable(
  "production_waste_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    productionOrderId: uuid("production_order_id")
      .notNull()
      .references(() => productionOrders.id),
    productionInputId: uuid("production_input_id")
      .notNull()
      .references(() => productionInputs.id),
    productionReceiptId: uuid("production_receipt_id").references(
      () => productionReceipts.id,
    ),
    wasteQtyKg: numeric("waste_qty_kg", { precision: 18, scale: 3 }).notNull(),
    wastePercent: numeric("waste_percent", { precision: 18, scale: 6 }),
    wasteReason: text("waste_reason"),
    // FK to stock_movements.id — the production_waste movement
    movementId: uuid("movement_id").references(() => stockMovements.id),
    ...makeTenantOwnedRow(usersId),
  },
  (t) => [
    index("production_waste_tenant_order_idx").on(t.tenantId, t.productionOrderId),
    index("production_waste_tenant_input_idx").on(t.tenantId, t.productionInputId),
    index("production_waste_tenant_receipt_idx").on(t.tenantId, t.productionReceiptId),
    check("production_waste_qty_check", sql`waste_qty_kg > 0`),
    check(
      "production_waste_percent_check",
      sql`waste_percent IS NULL OR (waste_percent >= 0 AND waste_percent <= 100)`,
    ),
  ],
);

export type ProductionWasteEntry = typeof productionWasteEntries.$inferSelect;
export type NewProductionWasteEntry = typeof productionWasteEntries.$inferInsert;

// ---------------------------------------------------------------------------
// production_wip_returns
// ---------------------------------------------------------------------------

/**
 * `production_wip_returns` table.
 *
 * Contract 03 §10.4 + Contract 05 §20.
 *
 * Return-from-WIP is a controlled production correction. Worker requests;
 * Owner/Accountant approves. Approval atomically reduces WIP, increases
 * on-hand at the return location, and writes audit.
 *
 * The request itself has no quantity/account effect — only the approval
 * posts the `return_from_wip` movement.
 */
export const productionWipReturns = pgTable(
  "production_wip_returns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    docNo: text("doc_no").notNull(),
    productionOrderId: uuid("production_order_id")
      .notNull()
      .references(() => productionOrders.id),
    productionInputId: uuid("production_input_id")
      .notNull()
      .references(() => productionInputs.id),
    returnQtyKg: numeric("return_qty_kg", { precision: 18, scale: 3 }).notNull(),
    returnLocationId: uuid("return_location_id")
      .notNull()
      .references(() => locations.id),
    status: wipReturnStatus("status").notNull().default("draft"),
    approvalStatus: approvalStatus("approval_status").notNull().default("draft"),
    reason: text("reason").notNull(),
    notes: text("notes"),

    // Idempotency
    idempotencyKey: text("idempotency_key").notNull(),
    approvalRequestId: uuid("approval_request_id").references(() => approvalRequests.id),

    // Return movement (return_from_wip) — set at approval
    returnMovementId: uuid("return_movement_id").references(() => stockMovements.id),

    // Financial review routing (Contract 05 §20)
    financialReviewStatus: text("financial_review_status").default("needs_accountant_review"),

    // Origin/import metadata
    recordOrigin: recordOrigin("record_origin").notNull().default("manual_live"),
    recordPeriod: recordPeriod("record_period").notNull().default("live"),
    isLocked: boolean("is_locked").notNull().default(false),
    ...makeTenantOwnedRow(usersId),
  },
  (t) => [
    uniqueIndex("production_wip_returns_tenant_doc_no_unique_idx").on(t.tenantId, t.docNo),
    uniqueIndex("production_wip_returns_tenant_idempotency_unique_idx").on(t.tenantId, t.idempotencyKey),
    index("production_wip_returns_tenant_order_idx").on(t.tenantId, t.productionOrderId),
    index("production_wip_returns_tenant_input_idx").on(t.tenantId, t.productionInputId),
    index("production_wip_returns_tenant_status_idx").on(t.tenantId, t.status),
    check("production_wip_returns_qty_check", sql`return_qty_kg > 0`),
  ],
);

export type ProductionWipReturn = typeof productionWipReturns.$inferSelect;
export type NewProductionWipReturn = typeof productionWipReturns.$inferInsert;
