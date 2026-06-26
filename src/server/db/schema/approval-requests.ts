/**
 * `approval_requests` table.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §7.6
 *   Request type, entity, risk, requester/time/reason, state, decision
 *   actor/time/notes, idempotency key, `subject_version`, `subject_hash`,
 *   submitted child/line version summary, invalidated actor/time/reason,
 *   and optional superseding request.
 *   Allow only one active pending request per entity/request scope and
 *   require unique non-null `(tenant_id, idempotency_key)`.
 *
 * Contract 06 §6 Universal Approval Contract: every high-risk approval
 * derives tenant/user from authenticated server context, checks permission,
 * validates request and required reason, checks current entity/approval
 * state and verifies the server-computed subject version/hash matches the
 * pending request.
 *
 * WP-00-03A scope: foundation table + uniqueness/constraints only. The
 * actual ApprovalService coordination (locks, writes, audit, idempotency)
 * lands in WP-01-03. Domain-specific approval subject hashing lands in
 * later packages.
 *
 * DB-level FKs: requested_by -> users.id, decided_by -> users.id,
 * invalidated_by -> users.id, created_by/updated_by -> users.id.
 */
import { text, uuid, integer, timestamp, jsonb, pgTable, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenantIdColumn, makeTenantOwnedRow, userRefColumn } from "./_helpers";
import { users } from "./users";
import { approvalRiskLevel, approvalRequestState } from "./enums";

const usersId = users.id!;

export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    requestType: text("request_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    riskLevel: approvalRiskLevel("risk_level").notNull().default("standard"),
    requestedBy: userRefColumn("requested_by", usersId).notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    reason: text("reason"),
    state: approvalRequestState("state").notNull().default("active"),
    decidedBy: userRefColumn("decided_by", usersId),
    decidedAt: timestamp("decided_at", { withTimezone: true, mode: "date" }),
    decisionNotes: text("decision_notes"),
    idempotencyKey: text("idempotency_key"),
    subjectVersion: integer("subject_version").notNull().default(1),
    subjectHash: text("subject_hash").notNull(),
    submittedChildVersionSummary: jsonb("submitted_child_version_summary"),
    invalidatedBy: userRefColumn("invalidated_by", usersId),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true, mode: "date" }),
    invalidationReason: text("invalidation_reason"),
    supersedingRequestId: uuid("superseding_request_id"),
    ...makeTenantOwnedRow(usersId),
  },
  (t) => [
    // Unique non-null idempotency key per tenant.
    uniqueIndex("approval_requests_tenant_idempotency_unique_idx")
      .on(t.tenantId, t.idempotencyKey)
      .where(sql`idempotency_key IS NOT NULL`),
    // Only one active pending request per (tenant, entity_type, entity_id,
    // request_type). Other requests for the same entity must be
    // decided/invalidated/superseded before a new active one is created.
    uniqueIndex("approval_requests_active_entity_unique_idx")
      .on(t.tenantId, t.entityType, t.entityId, t.requestType)
      .where(sql`state = 'active'`),
    index("approval_requests_tenant_state_idx").on(t.tenantId, t.state),
    index("approval_requests_tenant_entity_idx").on(
      t.tenantId,
      t.entityType,
      t.entityId,
    ),
    index("approval_requests_tenant_requested_by_idx").on(
      t.tenantId,
      t.requestedBy,
    ),
    check(
      "approval_requests_subject_version_check",
      sql`subject_version >= 1`,
    ),
    check(
      "approval_requests_subject_hash_nonempty_check",
      sql`length(subject_hash) > 0`,
    ),
  ],
);

export type ApprovalRequest = typeof approvalRequests.$inferSelect;
export type NewApprovalRequest = typeof approvalRequests.$inferInsert;
