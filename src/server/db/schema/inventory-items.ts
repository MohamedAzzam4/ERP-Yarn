/**
 * Inventory identity tables: inventory_items, raw_material_batches,
 * yarn_lots.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §9.1–9.3
 *
 * One-to-one item identity (Contract 03 §9.2–9.3):
 *   - Each raw_material_batch owns one distinct inventory_items identity.
 *   - Each yarn_lot owns one distinct inventory_items identity.
 *   - This is enforced by a UNIQUE constraint on (tenant_id, item_id)
 *     within each batch/lot table, ensuring at most one batch/lot per
 *     inventory_items row.
 *   - Movements and balances reference inventory_items.id, not the
 *     batch/lot directly, so the one-to-one identity is the canonical
 *     stock-tracking key.
 */
import {
  text,
  uuid,
  numeric,
  date,
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
import { suppliers } from "./master-data";
import { fiberTypes } from "./master-data";
import { externalFactories } from "./master-data";
import {
  itemKind,
  qualityStatus,
  masterDataStatus,
} from "./inventory-enums";
import {
  recordOrigin,
  recordPeriod,
  approvalStatus,
} from "./enums";

const usersId = users.id!;

// ---------------------------------------------------------------------------
// inventory_items
// ---------------------------------------------------------------------------

/**
 * `inventory_items` table.
 *
 * Contract 03 §9.1: Canonical item with kind, code, Arabic display name,
 * quality status, block status and active state. Unique
 * (tenant_id, item_kind, item_code); index kind, quality, and block state.
 *
 * This is the canonical stock-tracking identity. Each raw_material_batch
 * and yarn_lot owns one distinct inventory_items row (one-to-one).
 * Movements, balances, and reservations reference inventory_items.id.
 */
export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    itemKind: itemKind("item_kind").notNull(),
    itemCode: text("item_code").notNull(),
    displayNameAr: text("display_name_ar").notNull(),
    displayNameEn: text("display_name_en"),
    qualityStatus: qualityStatus("quality_status").notNull().default("accepted"),
    isBlocked: boolean("is_blocked").notNull().default(false),
    status: masterDataStatus("status").notNull().default("active"),
    ...makeTenantOwnedRow(usersId),
  },
  (t) => [
    uniqueIndex("inventory_items_tenant_kind_code_unique_idx").on(
      t.tenantId,
      t.itemKind,
      t.itemCode,
    ),
    index("inventory_items_tenant_kind_idx").on(t.tenantId, t.itemKind),
    index("inventory_items_tenant_quality_idx").on(
      t.tenantId,
      t.qualityStatus,
    ),
    index("inventory_items_tenant_blocked_idx").on(t.tenantId, t.isBlocked),
    index("inventory_items_tenant_status_idx").on(t.tenantId, t.status),
  ],
);

export type InventoryItem = typeof inventoryItems.$inferSelect;
export type NewInventoryItem = typeof inventoryItems.$inferInsert;

// ---------------------------------------------------------------------------
// raw_material_batches
// ---------------------------------------------------------------------------

/**
 * `raw_material_batches` table.
 *
 * Contract 03 §9.2:
 *   - item_id is required and tenant-unique across raw batches: each raw
 *     batch owns one distinct inventory_items identity. Enforce a
 *     tenant-safe one-to-one relationship.
 *   - Unique (tenant_id, batch_no).
 *   - Weights use NUMERIC(18,3); price/cost use NUMERIC(18,2).
 *   - Gross cannot be below net when both exist.
 *   - Price may be null; stock can post while payable waits for
 *     Accountant Review.
 *
 * Approved business document baseline (Contract 03 §5.2):
 *   - status, approval_status, record_origin, record_period, is_locked,
 *     import_batch_id.
 *
 * DEC-067 (resolved): Raw purchase payable uses net accepted weight.
 *   - `net_weight_kg` is the accepted weight basis for payable calculation.
 *   - Price/payable fields are nullable (stock posts before price is known).
 *   - Workers cannot enter/see price/payable (enforced by field-level
 *     permission, not by this schema).
 */
export const rawMaterialBatches = pgTable(
  "raw_material_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    // One-to-one: each raw batch owns one distinct inventory_items identity.
    // The UNIQUE constraint on (tenant_id, item_id) enforces this.
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    batchNo: text("batch_no").notNull(),
    supplierId: uuid("supplier_id").references(() => suppliers.id),
    supplierReference: text("supplier_reference"),
    fiberTypeId: uuid("fiber_type_id").references(() => fiberTypes.id),
    originCountry: text("origin_country"),
    season: text("season"),
    balesCount: numeric("bales_count", { precision: 18, scale: 3 }),
    grossWeightKg: numeric("gross_weight_kg", { precision: 18, scale: 3 }),
    netWeightKg: numeric("net_weight_kg", { precision: 18, scale: 3 }).notNull(),
    purchasePricePerTon: numeric("purchase_price_per_ton", {
      precision: 18,
      scale: 2,
    }),
    totalPurchaseCost: numeric("total_purchase_cost", {
      precision: 18,
      scale: 2,
    }),
    receivedDate: date("received_date").notNull(),
    // WP-02-04: Draft-stage operational fields recorded by the worker.
    // These are nullable because the worker may save a partial draft.
    // storage_location_id is the intended to_location for the future stock
    // movement (posted at WP-02-05 approval time). It is NOT a stock
    // assignment — no inventory_balances row is created until approval.
    storageLocationId: uuid("storage_location_id"),
    purchaseOrderRef: text("purchase_order_ref"),
    notes: text("notes"),
    // Approved business document baseline
    status: text("status").notNull().default("draft"),
    approvalStatus: approvalStatus("approval_status").notNull().default("draft"),
    recordOrigin: recordOrigin("record_origin").notNull().default("manual_live"),
    recordPeriod: recordPeriod("record_period").notNull().default("live"),
    isLocked: boolean("is_locked").notNull().default(false),
    importBatchId: uuid("import_batch_id"),
    ...makeTenantOwnedRow(usersId),
  },
  (t) => [
    // One-to-one: one raw batch per inventory_items row per tenant.
    uniqueIndex("raw_material_batches_tenant_item_unique_idx").on(
      t.tenantId,
      t.itemId,
    ),
    uniqueIndex("raw_material_batches_tenant_batch_no_unique_idx").on(
      t.tenantId,
      t.batchNo,
    ),
    index("raw_material_batches_tenant_supplier_idx").on(
      t.tenantId,
      t.supplierId,
    ),
    index("raw_material_batches_tenant_status_idx").on(
      t.tenantId,
      t.approvalStatus,
    ),
    index("raw_material_batches_tenant_storage_location_idx").on(
      t.tenantId,
      t.storageLocationId,
    ),
    // Weights: NUMERIC(18,3), net required, gross >= net when both exist.
    check("raw_material_batches_net_weight_check", sql`net_weight_kg >= 0`),
    check(
      "raw_material_batches_gross_net_check",
      sql`gross_weight_kg IS NULL OR gross_weight_kg >= net_weight_kg`,
    ),
    // Price/cost: NUMERIC(18,2), non-negative when present.
    check(
      "raw_material_batches_price_check",
      sql`purchase_price_per_ton IS NULL OR purchase_price_per_ton >= 0`,
    ),
    check(
      "raw_material_batches_total_cost_check",
      sql`total_purchase_cost IS NULL OR total_purchase_cost >= 0`,
    ),
    check(
      "raw_material_batches_bales_check",
      sql`bales_count IS NULL OR bales_count >= 0`,
    ),
  ],
);

export type RawMaterialBatch = typeof rawMaterialBatches.$inferSelect;
export type NewRawMaterialBatch = typeof rawMaterialBatches.$inferInsert;

// ---------------------------------------------------------------------------
// yarn_lots
// ---------------------------------------------------------------------------

/**
 * `yarn_lots` table.
 *
 * Contract 03 §9.3:
 *   - item_id is required and tenant-unique across yarn lots: each
 *     single/twisted lot owns one distinct inventory-item identity.
 *     Enforce a tenant-safe one-to-one relationship.
 *   - Unique (tenant_id, lot_type, lot_no).
 *   - Quantities use NUMERIC(18,3).
 *
 * `production_order_id` is a plain uuid (no FK) because the
 * production_orders table does not exist yet (WP-00-03C). The FK will
 * be added by WP-00-03C when it creates the production_orders table.
 *
 * `factory_id` references external_factories.id (available in this
 * package via master-data.ts).
 */
export const yarnLots = pgTable(
  "yarn_lots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    // One-to-one: each yarn lot owns one distinct inventory_items identity.
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    lotNo: text("lot_no").notNull(),
    lotType: text("lot_type").notNull(), // 'single_yarn' or 'twisted_yarn'
    yarnCount: text("yarn_count"),
    twistFactor: numeric("twist_factor", { precision: 18, scale: 6 }),
    twistsPerMeter: numeric("twists_per_meter", { precision: 18, scale: 3 }),
    factoryId: uuid("factory_id").references(() => externalFactories.id),
    // Plain uuid — FK to production_orders.id will be added in WP-00-03C.
    productionOrderId: uuid("production_order_id"),
    productionDate: date("production_date"),
    inputQuantityKg: numeric("input_quantity_kg", { precision: 18, scale: 3 }),
    outputQuantityKg: numeric("output_quantity_kg", { precision: 18, scale: 3 }),
    wasteQuantityKg: numeric("waste_quantity_kg", { precision: 18, scale: 3 }),
    wastePercent: numeric("waste_percent", { precision: 18, scale: 6 }),
    qualityStatus: qualityStatus("quality_status").notNull().default("accepted"),
    // Approved business document baseline
    status: text("status").notNull().default("draft"),
    approvalStatus: approvalStatus("approval_status").notNull().default("draft"),
    recordOrigin: recordOrigin("record_origin").notNull().default("manual_live"),
    recordPeriod: recordPeriod("record_period").notNull().default("live"),
    isLocked: boolean("is_locked").notNull().default(false),
    importBatchId: uuid("import_batch_id"),
    ...makeTenantOwnedRow(usersId),
  },
  (t) => [
    // One-to-one: one yarn lot per inventory_items row per tenant.
    uniqueIndex("yarn_lots_tenant_item_unique_idx").on(t.tenantId, t.itemId),
    uniqueIndex("yarn_lots_tenant_lot_type_lot_no_unique_idx").on(
      t.tenantId,
      t.lotType,
      t.lotNo,
    ),
    index("yarn_lots_tenant_factory_idx").on(t.tenantId, t.factoryId),
    index("yarn_lots_tenant_quality_idx").on(t.tenantId, t.qualityStatus),
    index("yarn_lots_tenant_status_idx").on(t.tenantId, t.approvalStatus),
    // lot_type must be 'single_yarn' or 'twisted_yarn'
    check(
      "yarn_lots_lot_type_check",
      sql`lot_type IN ('single_yarn', 'twisted_yarn')`,
    ),
    // Quantities: NUMERIC(18,3), non-negative when present.
    check(
      "yarn_lots_output_qty_check",
      sql`output_quantity_kg IS NULL OR output_quantity_kg >= 0`,
    ),
    check(
      "yarn_lots_waste_qty_check",
      sql`waste_quantity_kg IS NULL OR waste_quantity_kg >= 0`,
    ),
    check(
      "yarn_lots_input_qty_check",
      sql`input_quantity_kg IS NULL OR input_quantity_kg >= 0`,
    ),
  ],
);

export type YarnLot = typeof yarnLots.$inferSelect;
export type NewYarnLot = typeof yarnLots.$inferInsert;
