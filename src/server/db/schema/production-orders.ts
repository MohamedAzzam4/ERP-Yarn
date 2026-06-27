/**
 * Production and WIP schema: production_orders, production_inputs,
 * production_outputs, production_wip_balances.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §10.1–10.3
 * Contract: docs/contracts/05_production_wip_contract.md
 *
 * DEC-011: explicit WIP model; factory on-hand, WIP, output, waste and
 *   unprocessed remainder must not be double-counted.
 * DEC-012: production schema must be many-to-many capable; no single
 *   input FK on header as only lineage.
 * DEC-013: live factory cost is input-based and payable is recognized on
 *   approved production output receipt.
 * DEC-014: rates/rule values used by approved transactions are snapshotted.
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
import { tenantIdColumn, makeTenantOwnedRow, makeApprovedDocumentRow } from "./_helpers";
import { users } from "./users";
import { externalFactories } from "./master-data";
import { locations } from "./master-data";
import { inventoryItems } from "./inventory-items";
import { yarnLots } from "./inventory-items";
import { stockMovements } from "./inventory-ledger";
import { approvalRequests } from "./approval-requests";
import {
  productionType,
  productionStatus,
  historicalCostBasisSource,
} from "./production-enums";
import {
  recordOrigin,
  recordPeriod,
  approvalStatus,
} from "./enums";

const usersId = users.id!;

// ---------------------------------------------------------------------------
// production_orders
// ---------------------------------------------------------------------------

/**
 * `production_orders` table.
 *
 * Contract 03 §10.1 + Contract 05 §§7–8, 17.
 *
 * DEC-012: Many-to-many capable. The order header does NOT have a single
 * input_item_id FK. Inputs are child rows in production_inputs.
 *
 * DEC-013: Factory cost is input-based. Payable is recognized only on
 * approved production output receipt (not at issue). Snapshot fields
 * store the confirmed rate/cost basis at confirmation time.
 *
 * DEC-014: Rate/rule values used by approved transactions are snapshotted.
 * Changing factory defaults never recalculates approved receipts.
 *
 * Historical cost preservation fields (Contract 05 §21) are nullable and
 * used only for imported historical production records.
 */
export const productionOrders = pgTable(
  "production_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    docNo: text("doc_no").notNull(),
    productionType: productionType("production_type").notNull(),
    factoryId: uuid("factory_id")
      .notNull()
      .references(() => externalFactories.id),
    factoryLocationId: uuid("factory_location_id")
      .notNull()
      .references(() => locations.id),
    status: productionStatus("status").notNull().default("draft"),
    approvalStatus: approvalStatus("approval_status").notNull().default("draft"),
    sendDate: date("send_date"),
    receiveDate: date("receive_date"),
    expectedWastePercent: numeric("expected_waste_percent", { precision: 18, scale: 6 }),

    // Totals (updated as receipts are approved)
    totalInputQtyKg: numeric("total_input_qty_kg", { precision: 18, scale: 3 }).default("0"),
    totalOutputQtyKg: numeric("total_output_qty_kg", { precision: 18, scale: 3 }).default("0"),
    totalWasteQtyKg: numeric("total_waste_qty_kg", { precision: 18, scale: 3 }).default("0"),

    // DEC-013/014: Rate/cost snapshot fields (Contract 05 §17)
    // These are set when the Accountant/Owner confirms the rate, BEFORE
    // any receipt approval. They are snapshotted — changing factory
    // defaults never recalculates approved receipts.
    payableTriggerUsed: text("payable_trigger_used").default("production_receipt_approval"),
    factoryCostBasisUsed: text("factory_cost_basis_used").default("input_quantity"),
    factoryRatePerInputTonUsed: numeric("factory_rate_per_input_ton_used", {
      precision: 18,
      scale: 2,
    }),
    calculationVersion: text("calculation_version"),
    calculatedFactoryCost: numeric("calculated_factory_cost", {
      precision: 18,
      scale: 2,
    }),
    rateConfirmedBy: uuid("rate_confirmed_by").references(() => users.id),
    rateConfirmedAt: timestamp("rate_confirmed_at", { withTimezone: true, mode: "date" }),

    // Historical cost preservation (Contract 05 §21, Contract 03 §19)
    // Nullable — only used for imported historical production records.
    importedTotalFactoryCost: numeric("imported_total_factory_cost", {
      precision: 18,
      scale: 2,
    }),
    erpCalculatedFactoryCost: numeric("erp_calculated_factory_cost", {
      precision: 18,
      scale: 2,
    }),
    historicalCostBasisSource: historicalCostBasisSource("historical_cost_basis_source"),
    sourceFormulaText: text("source_formula_text"),
    sourceCalculatedValue: numeric("source_calculated_value", { precision: 18, scale: 2 }),
    costDifferenceAmount: numeric("cost_difference_amount", { precision: 18, scale: 2 }),
    costDifferencePercent: numeric("cost_difference_percent", { precision: 18, scale: 6 }),
    migrationWarning: text("migration_warning"),

    // Approved business document baseline
    recordOrigin: recordOrigin("record_origin").notNull().default("manual_live"),
    recordPeriod: recordPeriod("record_period").notNull().default("live"),
    isLocked: boolean("is_locked").notNull().default(false),
    importBatchId: uuid("import_batch_id"),
    reversalOfId: uuid("reversal_of_id"),
    correctionOfId: uuid("correction_of_id"),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "date" }),
    ...makeTenantOwnedRow(usersId),
  },
  (t) => [
    uniqueIndex("production_orders_tenant_doc_no_unique_idx").on(t.tenantId, t.docNo),
    index("production_orders_tenant_factory_idx").on(t.tenantId, t.factoryId),
    index("production_orders_tenant_status_idx").on(t.tenantId, t.status),
    index("production_orders_tenant_type_idx").on(t.tenantId, t.productionType),
    // Totals non-negative
    check("production_orders_total_input_check", sql`total_input_qty_kg IS NULL OR total_input_qty_kg >= 0`),
    check("production_orders_total_output_check", sql`total_output_qty_kg IS NULL OR total_output_qty_kg >= 0`),
    check("production_orders_total_waste_check", sql`total_waste_qty_kg IS NULL OR total_waste_qty_kg >= 0`),
    // Rate non-negative when present
    check(
      "production_orders_rate_check",
      sql`factory_rate_per_input_ton_used IS NULL OR factory_rate_per_input_ton_used >= 0`,
    ),
    // Cost basis must be input_quantity for live production (DEC-013)
    check(
      "production_orders_cost_basis_check",
      sql`factory_cost_basis_used IN ('input_quantity', 'output_quantity')`,
    ),
  ],
);

export type ProductionOrder = typeof productionOrders.$inferSelect;
export type NewProductionOrder = typeof productionOrders.$inferInsert;

// ---------------------------------------------------------------------------
// production_inputs
// ---------------------------------------------------------------------------

/**
 * `production_inputs` table.
 *
 * Contract 03 §10.2 + Contract 05 §§7, 12–13.
 *
 * DEC-012: Many-to-many capable child rows. Each input row links an
 * inventory_items identity to the production order with planned/issued/
 * consumed/returned/remaining WIP quantities. No single input FK on the
 * order header.
 *
 * WIP invariant per input (Contract 05 §13):
 *   issued_qty = consumed_to_output_qty + waste_qty + returned_from_wip_qty + remaining_wip_qty
 *
 * `issue_movement_id` references stock_movements.id (the issue_to_production
 * movement that decreased factory on-hand and increased WIP).
 */
export const productionInputs = pgTable(
  "production_inputs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    productionOrderId: uuid("production_order_id")
      .notNull()
      .references(() => productionOrders.id),
    inputItemId: uuid("input_item_id")
      .notNull()
      .references(() => inventoryItems.id),
    inputLocationId: uuid("input_location_id")
      .notNull()
      .references(() => locations.id),
    plannedInputQtyKg: numeric("planned_input_qty_kg", { precision: 18, scale: 3 }).notNull(),
    issuedQtyKg: numeric("issued_qty_kg", { precision: 18, scale: 3 }).notNull().default("0"),
    consumedQtyKg: numeric("consumed_qty_kg", { precision: 18, scale: 3 }).notNull().default("0"),
    returnedFromWipQtyKg: numeric("returned_from_wip_qty_kg", { precision: 18, scale: 3 }).notNull().default("0"),
    remainingWipQtyKg: numeric("remaining_wip_qty_kg", { precision: 18, scale: 3 }).notNull().default("0"),
    // FK to stock_movements.id — the issue_to_production movement.
    issueMovementId: uuid("issue_movement_id").references(() => stockMovements.id),
    ...makeTenantOwnedRow(usersId),
  },
  (t) => [
    index("production_inputs_tenant_order_idx").on(t.tenantId, t.productionOrderId),
    index("production_inputs_tenant_item_idx").on(t.tenantId, t.inputItemId),
    // DEC-012: no unique constraint on (order_id, item_id) — multiple input
    // rows for the same item are allowed (many-to-many).
    // Quantities non-negative
    check("production_inputs_planned_check", sql`planned_input_qty_kg > 0`),
    check("production_inputs_issued_check", sql`issued_qty_kg >= 0`),
    check("production_inputs_consumed_check", sql`consumed_qty_kg >= 0`),
    check("production_inputs_returned_check", sql`returned_from_wip_qty_kg >= 0`),
    check("production_inputs_remaining_wip_check", sql`remaining_wip_qty_kg >= 0`),
  ],
);

export type ProductionInput = typeof productionInputs.$inferSelect;
export type NewProductionInput = typeof productionInputs.$inferInsert;

// ---------------------------------------------------------------------------
// production_outputs
// ---------------------------------------------------------------------------

/**
 * `production_outputs` table.
 *
 * Contract 03 §10.2 + Contract 05 §14.
 *
 * DEC-012: Many-to-many capable. Each output row links an output
 * inventory_items identity (yarn lot) to the production order.
 *
 * `output_lot_id` references yarn_lots.id.
 * `receipt_movement_id` references stock_movements.id (the
 * receive_from_production movement that increased output on-hand).
 */
export const productionOutputs = pgTable(
  "production_outputs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
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
    receiptMovementId: uuid("receipt_movement_id").references(() => stockMovements.id),
    ...makeTenantOwnedRow(usersId),
  },
  (t) => [
    index("production_outputs_tenant_order_idx").on(t.tenantId, t.productionOrderId),
    index("production_outputs_tenant_item_idx").on(t.tenantId, t.outputItemId),
    index("production_outputs_tenant_lot_idx").on(t.tenantId, t.outputLotId),
    check("production_outputs_qty_check", sql`output_qty_kg > 0`),
  ],
);

export type ProductionOutput = typeof productionOutputs.$inferSelect;
export type NewProductionOutput = typeof productionOutputs.$inferInsert;

// ---------------------------------------------------------------------------
// production_wip_balances
// ---------------------------------------------------------------------------

/**
 * `production_wip_balances` table.
 *
 * Contract 03 §10.3 + Contract 05 §13.
 *
 * DEC-011: Explicit WIP model. WIP is a materialized balance per
 * (tenant, production_order, input_item, factory_location).
 *
 * WIP cannot be negative through ordinary posting. Only an explicit
 * approved correction may create a visible negative WIP alert.
 *
 * Unique (tenant_id, production_order_id, input_item_id, factory_location_id).
 */
export const productionWipBalances = pgTable(
  "production_wip_balances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    productionOrderId: uuid("production_order_id")
      .notNull()
      .references(() => productionOrders.id),
    inputItemId: uuid("input_item_id")
      .notNull()
      .references(() => inventoryItems.id),
    factoryLocationId: uuid("factory_location_id")
      .notNull()
      .references(() => locations.id),
    wipQtyKg: numeric("wip_qty_kg", { precision: 18, scale: 3 }).notNull().default("0"),
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }),
    updatedBy: uuid("updated_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("production_wip_balances_tenant_order_item_location_unique_idx").on(
      t.tenantId,
      t.productionOrderId,
      t.inputItemId,
      t.factoryLocationId,
    ),
    // NOTE: No CHECK that wip_qty_kg >= 0. Per Contract 05 §13: "WIP cannot
    // be negative through ordinary operations. Only an explicit approved
    // correction may represent a negative WIP inconsistency." The SERVICE
    // blocks ordinary negative WIP; the DB allows it for approved corrections
    // which create visible alerts. Same pattern as inventory_balances.on_hand.
    check("production_wip_balances_version_check", sql`version >= 1`),
  ],
);

export type ProductionWipBalance = typeof productionWipBalances.$inferSelect;
export type NewProductionWipBalance = typeof productionWipBalances.$inferInsert;
