/**
 * Shared Drizzle column helpers for tenant-owned tables.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §5.1
 *   "Every tenant-owned table requires:
 *      id UUID PRIMARY KEY
 *      tenant_id UUID NOT NULL REFERENCES tenants(id)
 *      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
 *      created_by UUID NULL REFERENCES users(id)
 *      updated_at TIMESTAMPTZ NULL
 *      updated_by UUID NULL REFERENCES users(id)"
 *
 * IMPORTANT — DB-level FK enforcement:
 *   All user-reference columns (created_by, updated_by, approved_by,
 *   assigned_by, decided_by, invalidated_by, detected_by, resolved_by,
 *   changed_by, initiated_by, requested_by) reference `users(id)` at the
 *   DB level via Drizzle `references()`. Each table file imports `users`
 *   and references `users.id` directly. The `noUncheckedIndexedAccess`
 *   TS strictness makes `users.id` typed as `PgColumn | undefined`; we
 *   use the `!` non-null assertion at call sites to satisfy TS without
 *   runtime impact (the column is always defined at runtime).
 *
 *   Self-reference case: `users` itself uses `created_by`/`updated_by`
 *   that reference `users.id`. Drizzle supports this via the callback
 *   form of `pgTable` where the columns function receives the table's
 *   own column builders, allowing `references(() => t.id)`.
 *
 *   Do NOT use `as PgColumn` casts — they break Drizzle Kit's snapshot
 *   generation (the FK is not registered).
 */
import { sql } from "drizzle-orm";
import {
  uuid,
  timestamp,
  text,
  boolean,
  pgTable,
  primaryKey,
  check,
  type PgColumn,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

/**
 * Standard tenant-owned row columns.
 *
 * `usersId` is the `users.id` PgColumn. Callers pass it explicitly to
 * break the import cycle (this file does not import `users`). For the
 * `users` table itself, callers use the callback form of pgTable and
 * inline the columns (see users.ts).
 */
export function makeTenantOwnedRow(usersId: PgColumn) {
  return {
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by").references(() => usersId),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }),
    updatedBy: uuid("updated_by").references(() => usersId),
  };
}

/**
 * Convenience: the FK form of `tenant_id` for every tenant-owned table
 * OTHER than `tenants` itself.
 */
export const tenantIdColumn = () =>
  uuid("tenant_id")
    .notNull()
    .references(() => tenants.id);

/**
 * Convenience: a user-reference FK column targeting `users.id`.
 * Caller passes `usersId` (the `users.id` PgColumn) to break import cycles.
 */
export function userRefColumn(name: string, usersId: PgColumn) {
  return uuid(name).references(() => usersId);
}

/**
 * Approved business document baseline columns per Contract 03 §5.2.
 *
 * These are NOT applied to platform/security foundation tables in WP-00-03A.
 * They are exported here so later domain packages import them from one
 * place.
 */
export function makeApprovedDocumentRow(usersId: PgColumn) {
  return {
    docNo: text("doc_no").notNull(),
    isLocked: boolean("is_locked").notNull().default(false),
    importBatchId: uuid("import_batch_id"),
    reversalOfId: uuid("reversal_of_id"),
    correctionOfId: uuid("correction_of_id"),
    approvedBy: uuid("approved_by").references(() => usersId),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "date" }),
  };
}

// Re-export commonly used builders.
export { sql, uuid, timestamp, text, boolean, pgTable, primaryKey, check };
