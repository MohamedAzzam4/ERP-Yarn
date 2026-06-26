/**
 * `users` table.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §7.2
 *   `users` maps one Supabase Auth identity to an ERP tenant user and
 *   stores name, email, phone, status, language and last login.
 *   Require unique `(tenant_id, email)` and unique auth identity mapping.
 *
 * WP-00-03A scope: ERP-side user mapping only. Supabase Auth identity is
 * referenced by `authId` (the Supabase Auth user UUID). No login UI,
 * no Supabase client integration, no session management — those land in
 * WP-01-01 (Private Auth) under PCD-AUTH-001/002.
 *
 * Self-reference FKs: `created_by` and `updated_by` reference
 * `users(id)`. Drizzle's `references(() => users.id)` inside the `users`
 * table definition creates a TypeScript self-reference cycle that TS
 * cannot resolve under strict mode. Per the WP-00-03A correction pass,
 * these two FKs are added as explicit manual `ALTER TABLE` constraints
 * in the migration SQL file (see
 * `drizzle/output/0000_*.sql` → "Manual FK constraints" section at the
 * end). All other user-reference FKs (on tables that import `users`)
 * are modeled via Drizzle `references()` normally.
 */
import {
  text,
  uuid,
  timestamp,
  pgTable,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { userStatus } from "./enums";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    authId: text("auth_id").notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    status: userStatus("status").notNull().default("active"),
    languagePreference: text("language_preference").notNull().default("ar"),
    lastLoginAt: timestamp("last_login_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    // Self-reference FK added manually in migration SQL (see file header).
    createdBy: uuid("created_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }),
    updatedBy: uuid("updated_by"),
  },
  (t) => [
    uniqueIndex("users_tenant_email_unique_idx").on(t.tenantId, t.email),
    uniqueIndex("users_auth_id_unique_idx").on(t.authId),
    index("users_tenant_status_idx").on(t.tenantId, t.status),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
