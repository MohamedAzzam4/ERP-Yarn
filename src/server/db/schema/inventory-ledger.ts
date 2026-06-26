/**
 * Inventory ledger tables: stock_movements, inventory_balances,
 * stock_reservations, inventory_adjustments.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §9.4–9.7
 * Contract: docs/contracts/04_inventory_posting_contract.md §§6–18
 *
 * Canonical model (Contract 04 §6):
 *   stock_movements = immutable source of truth for posted on-hand changes
 *   inventory_balances = transactionally maintained materialized view
 *
 * Only InventoryLedgerService may insert posted movement rows or mutate
 * materialized balances (Contract 04 §13). This package defines the
 * SCHEMA only — no service implementation.
 */
import {
  text,
  uuid,
  numeric,
  timestamp,
  date,
  integer,
  boolean,
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
import { approvalRequests } from "./approval-requests";
import {
  movementType,
  movementStatus,
  reservationStatus,
  adjustmentDirection,
} from "./inventory-enums";
import { recordOrigin, recordPeriod } from "./enums";

const usersId = users.id!;

// ---------------------------------------------------------------------------
// stock_movements
// ---------------------------------------------------------------------------

/**
 * `stock_movements` table.
 *
 * Contract 03 §9.4: Immutable posted movement with document number,
 * type/state, item, from/to location, quantity/date, source, approval,
 * reversal, idempotency, origin/period/import, actors and posting
 * timestamps.
 *
 * Contract 04 §6: `stock_movements` is the immutable source of truth for
 * posted on-hand changes by item/location.
 *
 * Contract 04 §16: Posted movements are never edited/deleted. Reversal
 * checks dependencies/feasibility, locks original and balances, inserts
 * opposite linked movement, reverses materialized effects, retains
 * original history, and writes reason/approval/audit.
 *
 * Constraints:
 *   - Quantity is positive NUMERIC(18,3).
 *   - At least one location exists (from or to).
 *   - Normal transfer source/destination differ.
 *   - Unique (tenant_id, doc_no) and non-null idempotency key.
 *   - Unique (tenant_id, idempotency_key).
 *   - Posted business columns are immutable (enforced by application +
 *     audit; no updated_at on posted columns).
 *
 * `reversal_of_movement_id` is a self-referential FK (plain uuid with
 * manual ALTER TABLE in migration — same pattern as users.created_by).
 *
 * `source_document_id` is a polymorphic reference (plain uuid) — the
 * table it references depends on `source_document_type`.
 */
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    docNo: text("doc_no").notNull(),
    movementType: movementType("movement_type").notNull(),
    movementStatus: movementStatus("movement_status")
      .notNull()
      .default("draft"),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    fromLocationId: uuid("from_location_id").references(() => locations.id),
    toLocationId: uuid("to_location_id").references(() => locations.id),
    quantityKg: numeric("quantity_kg", { precision: 18, scale: 3 }).notNull(),
    movementDate: date("movement_date").notNull(),
    sourceDocumentType: text("source_document_type").notNull(),
    sourceDocumentId: uuid("source_document_id").notNull(),
    approvalRequestId: uuid("approval_request_id").references(
      () => approvalRequests.id,
    ),
    // Self-reference: plain uuid (no references()) — manual ALTER TABLE
    // in migration (same pattern as users.created_by in WP-00-03A).
    reversalOfMovementId: uuid("reversal_of_movement_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    recordOrigin: recordOrigin("record_origin").notNull().default("manual_live"),
    recordPeriod: recordPeriod("record_period").notNull().default("live"),
    importBatchId: uuid("import_batch_id"),
    notes: text("notes"),
    // Posting actors + timestamps (immutable once posted).
    createdBy: uuid("created_by").references(() => users.id),
    postedBy: uuid("posted_by").references(() => users.id),
    postedAt: timestamp("posted_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (t) => [
    uniqueIndex("stock_movements_tenant_doc_no_unique_idx").on(
      t.tenantId,
      t.docNo,
    ),
    uniqueIndex("stock_movements_tenant_idempotency_unique_idx").on(
      t.tenantId,
      t.idempotencyKey,
    ),
    index("stock_movements_tenant_item_date_idx").on(
      t.tenantId,
      t.itemId,
      t.movementDate,
    ),
    index("stock_movements_tenant_from_location_date_idx").on(
      t.tenantId,
      t.fromLocationId,
      t.movementDate,
    ),
    index("stock_movements_tenant_to_location_date_idx").on(
      t.tenantId,
      t.toLocationId,
      t.movementDate,
    ),
    index("stock_movements_tenant_source_idx").on(
      t.tenantId,
      t.sourceDocumentType,
      t.sourceDocumentId,
    ),
    index("stock_movements_tenant_import_batch_idx").on(
      t.tenantId,
      t.importBatchId,
    ),
    index("stock_movements_tenant_reversal_idx").on(
      t.tenantId,
      t.reversalOfMovementId,
    ),
    index("stock_movements_tenant_status_idx").on(
      t.tenantId,
      t.movementStatus,
    ),
    // Quantity is positive.
    check("stock_movements_quantity_check", sql`quantity_kg > 0`),
    // At least one location exists.
    check(
      "stock_movements_location_check",
      sql`from_location_id IS NOT NULL OR to_location_id IS NOT NULL`,
    ),
    // Normal transfer source/destination differ (when both present).
    check(
      "stock_movements_from_to_diff_check",
      sql`from_location_id IS NULL OR to_location_id IS NULL OR from_location_id <> to_location_id`,
    ),
  ],
);

export type StockMovement = typeof stockMovements.$inferSelect;
export type NewStockMovement = typeof stockMovements.$inferInsert;

// ---------------------------------------------------------------------------
// inventory_balances
// ---------------------------------------------------------------------------

/**
 * `inventory_balances` table.
 *
 * Contract 03 §9.5: Unique (tenant_id, item_id, location_id) with:
 *   on_hand_qty_kg NUMERIC(18,3)
 *   reserved_qty_kg NUMERIC(18,3) default 0
 *   blocked_qty_kg NUMERIC(18,3) default 0
 *   returned_qty_kg NUMERIC(18,3) default 0
 *   last_movement_id
 *   version
 *
 * Reserved, blocked and returned quantities cannot be negative. Reserved
 * cannot exceed positive on-hand available for reservation. Do NOT define
 * `allowed_negative_flag` (SUP-001). On-hand may be negative only through
 * approved correction/historical inconsistency and must alert; ordinary
 * services block it.
 *
 * Returned and blocked dimensions can overlap. Available quantity is
 * on-hand minus reserved minus blocked; returned is not extra physical
 * stock (Contract 04 §6).
 */
export const inventoryBalances = pgTable(
  "inventory_balances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    onHandQtyKg: numeric("on_hand_qty_kg", { precision: 18, scale: 3 }).notNull().default("0"),
    reservedQtyKg: numeric("reserved_qty_kg", { precision: 18, scale: 3 }).notNull().default("0"),
    blockedQtyKg: numeric("blocked_qty_kg", { precision: 18, scale: 3 }).notNull().default("0"),
    returnedQtyKg: numeric("returned_qty_kg", { precision: 18, scale: 3 }).notNull().default("0"),
    lastMovementId: uuid("last_movement_id"), // FK to stock_movements (manual ALTER TABLE to avoid forward ref)
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }),
    updatedBy: uuid("updated_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("inventory_balances_tenant_item_location_unique_idx").on(
      t.tenantId,
      t.itemId,
      t.locationId,
    ),
    index("inventory_balances_tenant_item_idx").on(t.tenantId, t.itemId),
    index("inventory_balances_tenant_location_idx").on(t.tenantId, t.locationId),
    // No allowed_negative_flag (SUP-001). On-hand MAY be negative only
    // through approved correction/historical inconsistency — no CHECK
    // prevents it; the service blocks ordinary negative posting.
    // Reserved, blocked, returned CANNOT be negative.
    check("inventory_balances_reserved_check", sql`reserved_qty_kg >= 0`),
    check("inventory_balances_blocked_check", sql`blocked_qty_kg >= 0`),
    check("inventory_balances_returned_check", sql`returned_qty_kg >= 0`),
    // Reserved cannot exceed on-hand available for reservation.
    // NOTE: This check allows on_hand to be negative (approved correction)
    // but prevents reserved from exceeding on_hand when on_hand is positive.
    // When on_hand is negative, reserved must be 0 (no stock to reserve).
    check(
      "inventory_balances_reserved_within_on_hand_check",
      sql`reserved_qty_kg <= GREATEST(on_hand_qty_kg, 0)`,
    ),
    check("inventory_balances_version_check", sql`version >= 1`),
  ],
);

export type InventoryBalance = typeof inventoryBalances.$inferSelect;
export type NewInventoryBalance = typeof inventoryBalances.$inferInsert;

// ---------------------------------------------------------------------------
// stock_reservations
// ---------------------------------------------------------------------------

/**
 * `stock_reservations` table.
 *
 * Contract 03 §9.6: Reservation number, item/location, quantity,
 * source/sale/line, state, timestamps, nullable future `expires_at`,
 * idempotency key, and nullable failure-resolution reason/actor/time
 * metadata.
 *
 * Contract 04 §9: Reservation Contract.
 *   - Draft sale does not reserve (§9.1).
 *   - Submission creates reservation, increases reserved qty (§9.1).
 *   - Approval consumes reservation (§9.2).
 *   - Release only through human rejection/cancellation or authorized
 *     failure-resolution (§9.3). No automatic expiry (DEC-031).
 *   - `expires_at` is nullable and has no MVP effect.
 *   - One active reservation per source/item/location scope.
 *   - A failed/corrupted reservation must remain traceable and reconcile
 *     through an audited resolution record and critical alert (§9.4).
 *
 * DEC-065: Sale reservation supports only accepted/sellable stock.
 * Quality-risk stock must go through review/disposition before
 * reservation. No protected risk reservation flow in MVP.
 *
 * `sales_order_id` and `sales_line_id` are plain uuid (no FK) because
 * the sales tables don't exist yet (WP-00-03D). FKs will be added by
 * WP-00-03D.
 */
export const stockReservations = pgTable(
  "stock_reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    reservationNo: text("reservation_no").notNull(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    quantityKg: numeric("quantity_kg", { precision: 18, scale: 3 }).notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    // Plain uuid — FK to sales_orders/sales_order_lines added in WP-00-03D.
    salesOrderId: uuid("sales_order_id"),
    salesLineId: uuid("sales_line_id"),
    status: reservationStatus("status").notNull().default("active"),
    reservedAt: timestamp("reserved_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    releasedAt: timestamp("released_at", { withTimezone: true, mode: "date" }),
    consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "date" }),
    idempotencyKey: text("idempotency_key").notNull(),
    // Failure-resolution metadata (Contract 04 §9.4).
    failureResolutionReason: text("failure_resolution_reason"),
    failureResolutionActor: uuid("failure_resolution_actor").references(
      () => users.id,
    ),
    failureResolutionAt: timestamp("failure_resolution_at", {
      withTimezone: true,
      mode: "date",
    }),
    ...makeTenantOwnedRow(usersId),
  },
  (t) => [
    uniqueIndex("stock_reservations_tenant_no_unique_idx").on(
      t.tenantId,
      t.reservationNo,
    ),
    // One active reservation per source/item/location scope.
    uniqueIndex("stock_reservations_active_source_scope_unique_idx")
      .on(t.tenantId, t.sourceType, t.sourceId, t.itemId, t.locationId)
      .where(sql`status = 'active'`),
    uniqueIndex("stock_reservations_tenant_idempotency_unique_idx").on(
      t.tenantId,
      t.idempotencyKey,
    ),
    index("stock_reservations_tenant_item_location_idx").on(
      t.tenantId,
      t.itemId,
      t.locationId,
    ),
    index("stock_reservations_tenant_status_idx").on(t.tenantId, t.status),
    index("stock_reservations_tenant_sales_order_idx").on(
      t.tenantId,
      t.salesOrderId,
    ),
    // Quantity is positive.
    check("stock_reservations_quantity_check", sql`quantity_kg > 0`),
  ],
);

export type StockReservation = typeof stockReservations.$inferSelect;
export type NewStockReservation = typeof stockReservations.$inferInsert;

// ---------------------------------------------------------------------------
// inventory_adjustments
// ---------------------------------------------------------------------------

/**
 * `inventory_adjustments` table.
 *
 * Contract 03 §9.7: Document, item/location, direction/type, positive
 * absolute quantity, reason, state, approval and posted movement.
 * Approved adjustment links to one posting/reversal chain.
 *
 * Contract 04 §8.3: Adjustment uses a positive absolute quantity plus
 * direction/type, reason, request and approval. Negative adjustment
 * validates available/protected dimensions. It is not a generic escape
 * hatch for production, return, sale, or migration corrections.
 */
export const inventoryAdjustments = pgTable(
  "inventory_adjustments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    docNo: text("doc_no").notNull(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    adjustmentDirection: adjustmentDirection("adjustment_direction").notNull(),
    quantityKg: numeric("quantity_kg", { precision: 18, scale: 3 }).notNull(),
    reason: text("reason").notNull(),
    status: movementStatus("status").notNull().default("draft"),
    approvalRequestId: uuid("approval_request_id").references(
      () => approvalRequests.id,
    ),
    postedMovementId: uuid("posted_movement_id").references(
      () => stockMovements.id,
    ),
    ...makeTenantOwnedRow(usersId),
  },
  (t) => [
    uniqueIndex("inventory_adjustments_tenant_doc_no_unique_idx").on(
      t.tenantId,
      t.docNo,
    ),
    index("inventory_adjustments_tenant_item_location_idx").on(
      t.tenantId,
      t.itemId,
      t.locationId,
    ),
    index("inventory_adjustments_tenant_status_idx").on(t.tenantId, t.status),
    // Quantity is positive absolute (direction determines increase/decrease).
    check("inventory_adjustments_quantity_check", sql`quantity_kg > 0`),
    check(
      "inventory_adjustments_direction_check",
      sql`adjustment_direction IN ('positive', 'negative')`,
    ),
  ],
);

export type InventoryAdjustment = typeof inventoryAdjustments.$inferSelect;
export type NewInventoryAdjustment = typeof inventoryAdjustments.$inferInsert;
