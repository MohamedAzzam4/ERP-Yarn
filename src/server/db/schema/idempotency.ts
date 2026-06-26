/**
 * `idempotency_records` table.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §7.8
 *   A central `idempotency_records` table or equivalent per-command
 *   persistence requires tenant, operation scope, key, request hash,
 *   state (`in_progress`, `succeeded`, `business_failed`,
 *   `retryable_failed`), optional entity, response code/body, owner
 *   token, attempt count, lease/heartbeat timestamps, lease expiry,
 *   last error class, and timestamps. Unique
 *   `(tenant_id, operation_scope, idempotency_key)`.
 *
 * WP-00-03A scope: foundation table + indexes + uniqueness only. The
 * actual idempotency service (lease claim, expired-lease recovery,
 * source/effect constraint check) lands in WP-01-03.
 *
 * DB-level FK: initiated_by -> users.id.
 */
import { text, uuid, integer, timestamp, jsonb, pgTable, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenantIdColumn, userRefColumn } from "./_helpers";
import { users } from "./users";
import { idempotencyState } from "./enums";

const usersId = users.id!;

export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    operationScope: text("operation_scope").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    state: idempotencyState("state").notNull().default("in_progress"),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    responseCode: integer("response_code"),
    responseBody: jsonb("response_body"),
    ownerToken: text("owner_token"),
    attemptCount: integer("attempt_count").notNull().default(1),
    leaseHeartbeatAt: timestamp("lease_heartbeat_at", {
      withTimezone: true,
      mode: "date",
    }),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    lastErrorClass: text("last_error_class"),
    initiatedBy: userRefColumn("initiated_by", usersId),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    uniqueIndex("idempotency_records_tenant_scope_key_unique_idx").on(
      t.tenantId,
      t.operationScope,
      t.idempotencyKey,
    ),
    index("idempotency_records_tenant_state_idx").on(t.tenantId, t.state),
    index("idempotency_records_tenant_entity_idx").on(
      t.tenantId,
      t.entityType,
      t.entityId,
    ),
    index("idempotency_records_lease_expires_idx").on(t.leaseExpiresAt),
    check(
      "idempotency_records_attempt_count_check",
      sql`attempt_count >= 1`,
    ),
    check(
      "idempotency_records_state_check",
      sql`state IN ('in_progress', 'succeeded', 'business_failed', 'retryable_failed')`,
    ),
  ],
);

export type IdempotencyRecord = typeof idempotencyRecords.$inferSelect;
export type NewIdempotencyRecord = typeof idempotencyRecords.$inferInsert;
