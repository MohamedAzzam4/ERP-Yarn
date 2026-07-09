/**
 * Drizzle-backed StockReservationRepository — the production DB repository.
 *
 * Contract: docs/contracts/04_inventory_posting_contract.md §9
 *   Reservation Contract.
 *
 * This module implements the StockReservationRepository interface using
 * Drizzle ORM against the stock_reservations table. All methods are
 * tenant-scoped.
 *
 * WP-03-03 scope: reservation persistence only (insert + reads).
 */
import "server-only";
import { eq, and } from "drizzle-orm";
import { stockReservations } from "@/server/db/schema";
import type { db as DbType } from "@/server/db/client";
import type {
  StockReservationRepository,
  NewStockReservationInput,
} from "./stock-reservation-repository";
import type { StockReservation } from "@/server/db/schema/inventory-ledger";

type Db = NonNullable<typeof DbType>;

export class StockReservationDbRepository implements StockReservationRepository {
  constructor(private readonly db: Db) {}

  async insertReservation(row: NewStockReservationInput): Promise<StockReservation> {
    const [result] = await this.db
      .insert(stockReservations)
      .values({
        tenantId: row.tenantId,
        reservationNo: row.reservationNo,
        itemId: row.itemId,
        locationId: row.locationId,
        quantityKg: row.quantityKg,
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        salesOrderId: row.salesOrderId,
        salesLineId: row.salesLineId,
        status: "active",
        idempotencyKey: row.idempotencyKey,
      })
      .returning();
    return result!;
  }

  async findReservationByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<StockReservation | null> {
    const [result] = await this.db
      .select()
      .from(stockReservations)
      .where(
        and(
          eq(stockReservations.tenantId, tenantId),
          eq(stockReservations.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    return result ?? null;
  }

  async findActiveReservationBySource(
    tenantId: string,
    sourceType: string,
    sourceId: string,
    itemId: string,
    locationId: string,
  ): Promise<StockReservation | null> {
    const [result] = await this.db
      .select()
      .from(stockReservations)
      .where(
        and(
          eq(stockReservations.tenantId, tenantId),
          eq(stockReservations.sourceType, sourceType),
          eq(stockReservations.sourceId, sourceId),
          eq(stockReservations.itemId, itemId),
          eq(stockReservations.locationId, locationId),
          eq(stockReservations.status, "active"),
        ),
      )
      .limit(1);
    return result ?? null;
  }

  async findReservationById(
    tenantId: string,
    id: string,
  ): Promise<StockReservation | null> {
    const [result] = await this.db
      .select()
      .from(stockReservations)
      .where(
        and(
          eq(stockReservations.tenantId, tenantId),
          eq(stockReservations.id, id),
        ),
      )
      .limit(1);
    return result ?? null;
  }

  async listActiveReservationsForSale(
    tenantId: string,
    salesOrderId: string,
  ): Promise<StockReservation[]> {
    const results = await this.db
      .select()
      .from(stockReservations)
      .where(
        and(
          eq(stockReservations.tenantId, tenantId),
          eq(stockReservations.salesOrderId, salesOrderId),
          eq(stockReservations.status, "active"),
        ),
      );
    return results;
  }
}

export function createStockReservationDbRepository(db: Db): StockReservationDbRepository {
  return new StockReservationDbRepository(db);
}
