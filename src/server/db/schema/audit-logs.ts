/**
 * `audit_logs` table.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §7.7
 *   Append-only tenant/user/entity/action, old/new JSON, reason, approval
 *   request, idempotency key, IP/device and timestamp. Application roles
 *   cannot update/delete. Important audit rows are written in the business
 *   transaction.
 *
 * Contract 06 §6: success audit and business effects share a transaction.
 * Contract 06 §7: a failed attempt may be recorded after rollback in a
 * separate non-posting audit/idempotency outcome transaction; that failure
 * record must not imply approval or mutate business ledgers.
 *
 * Append-only enforcement: this table has NO `updated_at`, NO `deleted_at`,
 * NO `updated_by`, NO `deleted_by` columns. A DB-level trigger rejects
 * any UPDATE or DELETE on this table (see migration SQL). Application
 * roles cannot bypass this trigger; only a DB superuser could, and that
 * is not an application path.
 *
 * WP-00-03A scope: foundation table + indexes + append-only trigger
 * (in the migration SQL). The audit SERVICE that writes within the
 * business transaction lands in WP-01-03.
 *
 * DB-level FK: user_id -> users.id.
 */
import { text, uuid, timestamp, jsonb, pgTable, index } from "drizzle-orm/pg-core";
import { tenantIdColumn, userRefColumn } from "./_helpers";
import { users } from "./users";

const usersId = users.id!;

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    userId: userRefColumn("user_id", usersId),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    actionType: text("action_type").notNull(),
    oldValuesJson: jsonb("old_values_json"),
    newValuesJson: jsonb("new_values_json"),
    reason: text("reason"),
    approvalRequestId: uuid("approval_request_id"),
    idempotencyKey: text("idempotency_key"),
    ipAddress: text("ip_address"),
    deviceInfo: text("device_info"),
    // NOTE: created_at is the only lifecycle column. No updated_at,
    // no deleted_at — this table is append-only. DB-level trigger
    // enforces this (see migration SQL).
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("audit_logs_tenant_entity_idx").on(
      t.tenantId,
      t.entityType,
      t.entityId,
    ),
    index("audit_logs_tenant_user_idx").on(t.tenantId, t.userId),
    index("audit_logs_tenant_action_idx").on(t.tenantId, t.actionType),
    index("audit_logs_tenant_created_at_idx").on(t.tenantId, t.createdAt),
    index("audit_logs_tenant_approval_request_idx").on(
      t.tenantId,
      t.approvalRequestId,
    ),
  ],
);

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
