/**
 * In-memory StockReservationRepository for unit tests.
 * TEST-ONLY helper. NOT for production use.
 */
import type { StockReservation } from "@/server/db/schema/inventory-ledger";
import type {
  StockReservationRepository,
  NewStockReservationInput,
} from "../stock-reservation-repository";

const NOW = () => new Date("2026-07-01T00:00:00Z");
const nid = (p: string, n: number) => `${p}-${n.toString().padStart(6, "0")}`;

export class InMemoryStockReservationRepository implements StockReservationRepository {
  private reservations = new Map<string, StockReservation>();
  private counter = 0;

  /**
   * Snapshot the current state for transactional test rollback.
   * Returns a deep-cloned copy of reservations + counter.
   * TEST-ONLY.
   */
  snapshot(): {
    reservations: Map<string, StockReservation>;
    counter: number;
  } {
    return {
      reservations: new Map([...this.reservations].map(([k, v]) => [k, { ...v }])),
      counter: this.counter,
    };
  }

  /**
   * Restore state from a snapshot. Used to simulate DB transaction
   * rollback in atomicity/concurrency tests. TEST-ONLY.
   */
  restore(snapshot: {
    reservations: Map<string, StockReservation>;
    counter: number;
  }): void {
    this.reservations = new Map([...snapshot.reservations].map(([k, v]) => [k, { ...v }]));
    this.counter = snapshot.counter;
  }

  async insertReservation(row: NewStockReservationInput): Promise<StockReservation> {
    this.counter++;
    const id = nid("res", this.counter);
    const reservation: StockReservation = {
      id,
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
      reservedAt: NOW(),
      expiresAt: null,
      releasedAt: null,
      consumedAt: null,
      idempotencyKey: row.idempotencyKey,
      failureResolutionReason: null,
      failureResolutionActor: null,
      failureResolutionAt: null,
      createdBy: null,
      createdAt: NOW(),
      updatedBy: null,
      updatedAt: null,
    };
    this.reservations.set(`${row.tenantId}:${id}`, reservation);
    return reservation;
  }

  async findReservationByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<StockReservation | null> {
    for (const r of this.reservations.values()) {
      if (r.tenantId === tenantId && r.idempotencyKey === idempotencyKey) {
        return r;
      }
    }
    return null;
  }

  async findActiveReservationBySource(
    tenantId: string,
    sourceType: string,
    sourceId: string,
    itemId: string,
    locationId: string,
  ): Promise<StockReservation | null> {
    for (const r of this.reservations.values()) {
      if (
        r.tenantId === tenantId &&
        r.sourceType === sourceType &&
        r.sourceId === sourceId &&
        r.itemId === itemId &&
        r.locationId === locationId &&
        r.status === "active"
      ) {
        return r;
      }
    }
    return null;
  }

  async findReservationById(tenantId: string, id: string): Promise<StockReservation | null> {
    return this.reservations.get(`${tenantId}:${id}`) ?? null;
  }

  async listActiveReservationsForSale(
    tenantId: string,
    salesOrderId: string,
  ): Promise<StockReservation[]> {
    return [...this.reservations.values()].filter(
      (r) =>
        r.tenantId === tenantId &&
        r.salesOrderId === salesOrderId &&
        r.status === "active",
    );
  }

  async markReservationFailed(
    tenantId: string,
    reservationId: string,
    failureResolutionReason: string,
    failureResolutionActor: string,
  ): Promise<StockReservation | null> {
    const key = `${tenantId}:${reservationId}`;
    const existing = this.reservations.get(key);
    if (!existing) return null;
    // Conditional: only succeed if current status is 'active'.
    if (existing.status !== "active") return null;
    const updated: StockReservation = {
      ...existing,
      status: "failed",
      failureResolutionReason,
      failureResolutionActor,
      failureResolutionAt: NOW(),
    };
    this.reservations.set(key, updated);
    return updated;
  }

  async markReservationReleased(
    tenantId: string,
    reservationId: string,
  ): Promise<StockReservation | null> {
    const key = `${tenantId}:${reservationId}`;
    const existing = this.reservations.get(key);
    if (!existing) return null;
    if (existing.status !== "active") return null;
    const updated: StockReservation = {
      ...existing,
      status: "released",
      releasedAt: NOW(),
    };
    this.reservations.set(key, updated);
    return updated;
  }

  async markReservationConsumed(
    tenantId: string,
    reservationId: string,
  ): Promise<StockReservation | null> {
    const key = `${tenantId}:${reservationId}`;
    const existing = this.reservations.get(key);
    if (!existing) return null;
    if (existing.status !== "active") return null;
    const updated: StockReservation = {
      ...existing,
      status: "approved_consumed",
      consumedAt: NOW(),
    };
    this.reservations.set(key, updated);
    return updated;
  }
}
