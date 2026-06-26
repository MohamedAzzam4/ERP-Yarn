/**
 * Inventory-specific PostgreSQL enums.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §6
 * "Core Status and Classification Values" — implement as PostgreSQL enums
 * or check constraints.
 *
 * WP-00-03B scope: only the enums consumed by inventory/master-data tables.
 * Production, sales, returns, payment, migration, and account enums land
 * in their consuming packages (WP-00-03C–E).
 *
 * Enum values are the authoritative strings from Contract 03 §6. Do not
 * add, remove, or rename values without a contract update.
 */
import { pgEnum } from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Master data enums
// ---------------------------------------------------------------------------

/**
 * External factory type. Contract 03 §8: "factory type is `single_yarn`,
 * `twisting`, or `both`".
 */
export const factoryType = pgEnum("factory_type", [
  "single_yarn",
  "twisting",
  "both",
]);

// ---------------------------------------------------------------------------
// Inventory identity enums
// ---------------------------------------------------------------------------

/**
 * Item kind. Contract 03 §6.
 */
export const itemKind = pgEnum("item_kind", [
  "raw_material",
  "single_yarn",
  "twisted_yarn",
]);

/**
 * Location type. Contract 03 §6.
 *
 * `in_transit` remains schema-ready for a future two-step dispatch/receive
 * workflow but has no MVP workflow (DEC-030).
 */
export const locationType = pgEnum("location_type", [
  "internal_warehouse",
  "port_warehouse",
  "external_single_factory",
  "external_twisting_factory",
  "in_transit",
  "returned_stock",
  "temporary",
  "wip_virtual",
]);

/**
 * Quality status. Contract 03 §6 + DEC-006 (MVP statuses).
 *
 * MVP: `accepted`, `needs_review`, `blocked`. No `rejected` (SUP-006).
 */
export const qualityStatus = pgEnum("quality_status", [
  "accepted",
  "needs_review",
  "blocked",
]);

// ---------------------------------------------------------------------------
// Ledger enums
// ---------------------------------------------------------------------------

/**
 * Movement type. Contract 03 §6 + Contract 04 §7.
 *
 * All 13 contracted movement types including `return_from_wip` (SUP-007).
 * No generic "other" movement may avoid a defined posting contract
 * (Contract 04 §7).
 */
export const movementType = pgEnum("movement_type", [
  "raw_receipt",
  "transfer",
  "issue_to_production",
  "receive_from_production",
  "production_waste",
  "return_from_wip",
  "sale_issue",
  "return_receipt",
  "inventory_adjustment",
  "stock_block",
  "stock_unblock",
  "reversal",
  "correction",
]);

/**
 * Movement status. Contract 03 §6.
 */
export const movementStatus = pgEnum("movement_status", [
  "draft",
  "pending_approval",
  "posted",
  "cancelled",
  "reversed",
]);

/**
 * Reservation status. Contract 03 §6.
 *
 * No `expired` status (SUP-002 / DEC-031): `expires_at` is nullable and
 * has no MVP automatic expiry behavior. A failed/corrupted reservation
 * uses `failed` status and must be resolved through an audited resolution
 * record and critical alert.
 */
export const reservationStatus = pgEnum("reservation_status", [
  "active",
  "approved_consumed",
  "released",
  "failed",
]);

/**
 * Returned stock status. Contract 03 §6 + Contract 04 §11.
 *
 * Only `sellable_as_is` is normally available for sale.
 * `sellable_with_discount` requires Owner/Accountant approval.
 * Other states are unavailable for ordinary sale/transfer.
 */
export const returnedStockStatus = pgEnum("returned_stock_status", [
  "return_received",
  "needs_quality_review",
  "sellable_as_is",
  "sellable_with_discount",
  "blocked",
  "reprocess_required",
]);

/**
 * Inventory adjustment direction. Contract 04 §8.3: "Adjustment uses a
 * positive absolute quantity plus direction/type."
 *
 * `positive` increases on-hand; `negative` decreases on-hand (validated
 * against available/protected dimensions).
 */
export const adjustmentDirection = pgEnum("adjustment_direction", [
  "positive",
  "negative",
]);

/**
 * Master data status (suppliers, customers, locations, factories, etc.).
 * Contract 03 §8: "inactive records remain visible on old documents and
 * unavailable for new transactions."
 */
export const masterDataStatus = pgEnum("master_data_status", [
  "active",
  "inactive",
]);
