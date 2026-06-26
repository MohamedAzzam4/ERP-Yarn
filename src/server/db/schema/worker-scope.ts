/**
 * `worker_scope_assignments` table.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §7.2
 *   `worker_scope_assignments` or equivalent scope-foundation tables
 *   require tenant, user, scope type, target identifier/key, active state,
 *   optional effective window, assigned actor, reason and audit metadata.
 *   Domain-specific packages must add tenant-safe references or validation
 *   to the target entities when those tables exist. A scope grant never
 *   grants action permission by itself; role/permission checks and worker
 *   financial redaction still apply.
 *
 * DEC-062: Worker row access is assigned scope, not tenant-wide. Workers
 * default to no operational row access unless the user has active
 * user-specific scope assignments for locations, external factories and/or
 * task types. Owner maintains scope assignments in MVP; Accountant may
 * view or request only. No Worker role may receive unrestricted
 * tenant-wide write scope as a convenience.
 *
 * WP-00-03A scope: foundation table only. The `targetIdentifier` column
 * is a TEXT key, NOT a foreign key, because the target entities
 * (locations, external_factories) do not exist yet — they land in
 * WP-00-03B. Domain packages will add tenant-safe FK validation when
 * their target entities exist.
 *
 * DB-level FKs: user_id -> users.id, assigned_by -> users.id.
 */
import { text, uuid, boolean, timestamp, pgTable, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenantIdColumn, makeTenantOwnedRow, userRefColumn } from "./_helpers";
import { users } from "./users";
import { workerScopeType } from "./enums";

const usersId = users.id!;

export const workerScopeAssignments = pgTable(
  "worker_scope_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    scopeType: workerScopeType("scope_type").notNull(),
    /**
     * Target identifier. TEXT (not FK) per Contract 03 §7.2: "target
     * identifier/key". Domain packages add FK validation when their
     * target entities exist in WP-00-03B+.
     *
     * For `scope_type = 'location'`: the location's UUID (once locations
     * table exists).
     * For `scope_type = 'external_factory'`: the factory's UUID (once
     * external_factories table exists).
     * For `scope_type = 'task_type'`: a stable task-type key string.
     */
    targetIdentifier: text("target_identifier").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    effectiveFrom: timestamp("effective_from", { withTimezone: true, mode: "date" }),
    effectiveTo: timestamp("effective_to", { withTimezone: true, mode: "date" }),
    assignedBy: userRefColumn("assigned_by", usersId).notNull(),
    assignedAt: timestamp("assigned_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    reason: text("reason").notNull(),
    ...makeTenantOwnedRow(usersId),
  },
  (t) => [
    // One active assignment per (tenant, user, scope_type, target).
    // Inactive/historical assignments may coexist with an active one.
    uniqueIndex("worker_scope_active_unique_idx")
      .on(t.tenantId, t.userId, t.scopeType, t.targetIdentifier)
      .where(sql`is_active = true`),
    index("worker_scope_tenant_user_idx").on(t.tenantId, t.userId),
    index("worker_scope_tenant_type_target_idx").on(
      t.tenantId,
      t.scopeType,
      t.targetIdentifier,
    ),
    // Effective window sanity check.
    check(
      "worker_scope_effective_window_check",
      sql`(effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)`,
    ),
  ],
);

export type WorkerScopeAssignment = typeof workerScopeAssignments.$inferSelect;
export type NewWorkerScopeAssignment = typeof workerScopeAssignments.$inferInsert;
