/**
 * Stock Reservation Repository — WP-03-03.
 *
 * Contract: docs/contracts/04_inventory_posting_contract.md §9
 *   "Reservation Contract"
 *
 * Contract: docs/contracts/03_database_schema_contract.md §7.5
 *   stock_reservations table.
 *
 * WP-03-03 scope: reservation persistence only (insert, find by source,
 * find by idempotency key). Release/consume/fail transitions are deferred
 * to later packages (WP-03-04, WP-04-xx sale approval).
 */
import "server-only";

import type { StockReservation } from "@/server/db/schema/inventory-ledger";

// ---------------------------------------------------------------------------
// Input type for inserting a new reservation.
// ---------------------------------------------------------------------------

export interface NewStockReservationInput {
  tenantId: string;
  reservationNo: string;
  itemId: string;
  locationId: string;
  quantityKg: string;
  sourceType: string; // e.g. "sales_order_line"
  sourceId: string; // e.g. sales_order_line.id
  salesOrderId: string | null;
  salesLineId: string | null;
  idempotencyKey: string;
}

// ---------------------------------------------------------------------------
// Repository interface.
// ---------------------------------------------------------------------------

/**
 * Persistence interface for stock_reservations.
 *
 * Every method is tenant-scoped: it MUST filter by `tenantId` and never
 * return/mutate rows from another tenant.
 */
export interface StockReservationRepository {
  /** Insert a new reservation row. Returns the inserted row with id. */
  insertReservation(row: NewStockReservationInput): Promise<StockReservation>;

  /**
   * Find a reservation by idempotency key (for replay).
   * Returns null if no reservation exists for this key.
   */
  findReservationByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<StockReservation | null>;

  /**
   * Find an active reservation by source (duplicate-source guard).
   * Returns null if no active reservation exists for this source.
   *
   * The unique index `stock_reservations_active_source_scope_unique_idx`
   * ensures only one active reservation per (tenant, sourceType, sourceId,
   * itemId, locationId).
   */
  findActiveReservationBySource(
    tenantId: string,
    sourceType: string,
    sourceId: string,
    itemId: string,
    locationId: string,
  ): Promise<StockReservation | null>;

  /** Find a reservation by id. Returns null if not found. */
  findReservationById(tenantId: string, id: string): Promise<StockReservation | null>;

  /**
   * List all active reservations for a sale (for summary/reconciliation).
   * WP-03-03: used to return the reservation summary in the submit result.
   */
  listActiveReservationsForSale(
    tenantId: string,
    salesOrderId: string,
  ): Promise<StockReservation[]>;
}
