/**
 * `operational_alerts` table.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §7.9
 *   Tenant, severity, alert type, source entity, message key/details,
 *   state, detected/resolved actor/time, and audit linkage.
 *   Missing/corrupted reservation resolution creates a critical alert.
 *   Alerts are official records but are not inventory, reservation, sale,
 *   or account postings. Resolution is explicit and audited; alerts are
 *   not silently deleted.
 *
 * DB-level FKs: detected_by -> users.id, resolved_by -> users.id,
 * created_by/updated_by -> users.id.
 */
import { text, uuid, timestamp, jsonb, pgTable, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenantIdColumn, makeTenantOwnedRow, userRefColumn } from "./_helpers";
import { users } from "./users";
import { alertSeverity, alertState } from "./enums";

const usersId = users.id!;

export const operationalAlerts = pgTable(
  "operational_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    severity: alertSeverity("severity").notNull(),
    alertType: text("alert_type").notNull(),
    sourceEntityType: text("source_entity_type"),
    sourceEntityId: uuid("source_entity_id"),
    messageKey: text("message_key").notNull(),
    messageDetails: jsonb("message_details"),
    state: alertState("state").notNull().default("open"),
    detectedBy: userRefColumn("detected_by", usersId),
    detectedAt: timestamp("detected_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    resolvedBy: userRefColumn("resolved_by", usersId),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),
    resolutionReason: text("resolution_reason"),
    auditLogId: uuid("audit_log_id"),
    ...makeTenantOwnedRow(usersId),
  },
  (t) => [
    index("operational_alerts_tenant_state_idx").on(t.tenantId, t.state),
    index("operational_alerts_tenant_severity_idx").on(t.tenantId, t.severity),
    index("operational_alerts_tenant_type_idx").on(t.tenantId, t.alertType),
    index("operational_alerts_tenant_source_idx").on(
      t.tenantId,
      t.sourceEntityType,
      t.sourceEntityId,
    ),
    check(
      "operational_alerts_resolved_window_check",
      sql`(state <> 'resolved' OR (resolved_by IS NOT NULL AND resolved_at IS NOT NULL))`,
    ),
  ],
);

export type OperationalAlert = typeof operationalAlerts.$inferSelect;
export type NewOperationalAlert = typeof operationalAlerts.$inferInsert;
