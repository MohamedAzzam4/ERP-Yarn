/**
 * Drizzle Kit configuration for ERP-Yarn.
 *
 * WP-00-03A scope: platform/security schema slices only (tenants, users,
 * roles, permissions, user_roles, role_permissions, worker_scope_assignments,
 * tenant_settings, terminology_labels, document_sequences, approval_requests,
 * audit_logs, idempotency_records, operational_alerts). Domain tables
 * (inventory, production, sales, returns, migration) land in WP-00-03B–E.
 *
 * Contract: docs/contracts/01_technical_architecture_and_deployment_contract.md
 * §Migration Contract (migrations committed to repo; migration history
 * immutable after application to shared environment; no runtime schema push;
 * no migrations from application requests).
 *
 * NOTE: `DATABASE_MIGRATION_URL` is intentionally NOT used here. The
 * WP-00-02 addendum recorded the env-var scope ambiguity as
 * "Unresolved / requires owner decision". The first migration package
 * that actually runs `drizzle-kit migrate` against a live database must
 * resolve it. WP-00-03A generates migration SQL via `drizzle-kit generate`
 * only (no live DB connection). SQL files are committed for review; they
 * are NOT applied to any database in this package.
 */
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/server/db/schema/index.ts",
  out: "./drizzle/output",
  dialect: "postgresql",
  // No credentials here. `drizzle-kit generate` works without credentials;
  // `migrate`/`push` require them and are NOT run in WP-00-03A.
  verbose: true,
  strict: true,
});
