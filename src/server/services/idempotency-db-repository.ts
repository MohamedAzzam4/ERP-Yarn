/**
 * Drizzle-backed IdempotencyTransactionHandle — the production DB idempotency store.
 *
 * WP-08-01C: DB-backed persistent idempotency with mandatory owner-token fencing.
 */
import "server-only";
import { eq, and, sql as drizzleSql } from "drizzle-orm";
import { idempotencyRecords } from "@/server/db/schema";
import type { db as DbType } from "@/server/db/client";
import type {
  IdempotencyTransactionHandle,
  IdempotencyRecordShape,
  IdempotencyState,
} from "./idempotency-service";

type Db = NonNullable<typeof DbType>;
type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export class IdempotencyDbRepository implements IdempotencyTransactionHandle {
  constructor(private readonly db: DbOrTx) {}

  async findByTenantScopeKey(tenantId: string, operationScope: string, idempotencyKey: string): Promise<IdempotencyRecordShape | null> {
    const [row] = await this.db.select().from(idempotencyRecords).where(and(
      eq(idempotencyRecords.tenantId, tenantId),
      eq(idempotencyRecords.operationScope, operationScope),
      eq(idempotencyRecords.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (!row) return null;
    return this.mapRow(row);
  }

  async insert(record: Omit<IdempotencyRecordShape, "id" | "createdAt"> & { id?: string }): Promise<IdempotencyRecordShape> {
    const ownerToken = record.ownerToken ?? crypto.randomUUID();
    const [row] = await this.db.insert(idempotencyRecords).values({
      id: record.id ?? undefined, tenantId: record.tenantId,
      operationScope: record.operationScope, idempotencyKey: record.idempotencyKey,
      requestHash: record.requestHash, state: record.state as IdempotencyState,
      entityType: record.entityType, entityId: record.entityId,
      responseCode: record.responseCode, responseBody: record.responseBody,
      ownerToken, attemptCount: record.attemptCount,
      leaseHeartbeatAt: record.leaseHeartbeatAt, leaseExpiresAt: record.leaseExpiresAt,
      lastErrorClass: record.lastErrorClass, initiatedBy: record.initiatedBy,
      completedAt: record.completedAt,
    }).returning();
    if (!row) throw new Error("Failed to insert idempotency record");
    return this.mapRow(row);
  }

  async claimExpiredLease(id: string, newLeaseExpiresAt: Date, newHeartbeatAt: Date, now: Date): Promise<boolean> {
    const newOwnerToken = crypto.randomUUID();
    const [row] = await this.db.update(idempotencyRecords).set({
      state: "in_progress" as IdempotencyState,
      leaseHeartbeatAt: newHeartbeatAt, leaseExpiresAt: newLeaseExpiresAt,
      ownerToken: newOwnerToken, attemptCount: drizzleSql`attempt_count + 1`,
    }).where(and(
      eq(idempotencyRecords.id, id),
      drizzleSql`(state = 'retryable_failed' OR (state = 'in_progress' AND lease_expires_at IS NOT NULL AND lease_expires_at < ${now.toISOString()}))`,
    )).returning();
    return !!row;
  }

  async updateState(id: string, update: {
    state: IdempotencyState; responseCode?: number | null; responseBody?: unknown;
    lastErrorClass?: string | null; completedAt?: Date | null;
    entityType?: string | null; entityId?: string | null;
    expectedOwnerToken: string;
  }): Promise<number> {
    const result = await this.db.update(idempotencyRecords).set({
      state: update.state, responseCode: update.responseCode ?? null,
      responseBody: update.responseBody ?? null, lastErrorClass: update.lastErrorClass ?? null,
      completedAt: update.completedAt ?? null, entityType: update.entityType ?? null,
      entityId: update.entityId ?? null,
    }).where(and(
      eq(idempotencyRecords.id, id),
      eq(idempotencyRecords.state, "in_progress" as IdempotencyState),
      eq(idempotencyRecords.ownerToken, update.expectedOwnerToken),
    )).returning();
    return result.length;
  }

  async heartbeat(id: string, now: Date): Promise<void> {
    await this.db.update(idempotencyRecords).set({ leaseHeartbeatAt: now }).where(eq(idempotencyRecords.id, id));
  }

  private mapRow(row: typeof idempotencyRecords.$inferSelect): IdempotencyRecordShape {
    return {
      id: row.id, tenantId: row.tenantId, operationScope: row.operationScope,
      idempotencyKey: row.idempotencyKey, requestHash: row.requestHash,
      state: row.state as IdempotencyState, entityType: row.entityType, entityId: row.entityId,
      responseCode: row.responseCode, responseBody: row.responseBody, ownerToken: row.ownerToken,
      attemptCount: row.attemptCount, leaseHeartbeatAt: row.leaseHeartbeatAt,
      leaseExpiresAt: row.leaseExpiresAt, lastErrorClass: row.lastErrorClass,
      initiatedBy: row.initiatedBy, createdAt: row.createdAt, completedAt: row.completedAt,
    };
  }
}

export function createIdempotencyDbRepository(db: DbOrTx): IdempotencyDbRepository {
  return new IdempotencyDbRepository(db);
}
