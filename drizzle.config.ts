/**
 * Drizzle Kit configuration stub for ERP-Yarn.
 *
 * WP-00-02 scope: CONFIG ONLY. No schema files are referenced because
 * WP-00-02 does NOT create database schema, migrations, or seeds. Schema
 * slices land in WP-00-03A through WP-00-03E per their PCD gates.
 *
 * The `schema` field is intentionally an empty array. Drizzle Kit will not
 * generate migrations until a real schema is provided by a later package.
 *
 * Contract: docs/contracts/01_technical_architecture_and_deployment_contract.md
 * §Migration Contract (migrations committed to repo; migration history
 * immutable after application to shared environment; no runtime schema push;
 * no migrations from application requests).
 *
 * NOTE: `DATABASE_MIGRATION_URL` is intentionally NOT used here. The
 * WP-00-02 addendum recorded the env-var scope ambiguity as
 * "Unresolved / requires owner decision"; the first migration package
 * (WP-00-03A) will resolve it before any `migrate` command runs.
 */
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: [],
  out: "drizzle/output",
  dialect: "postgresql",
  // No credentials here. Drizzle Kit migrations against a real database
  // are run only in authorized later packages via a server-only migration
  // connection — not from WP-00-02. `dbCredentials` is intentionally omitted;
  // `drizzle-kit generate` works without credentials, only `migrate`/`push`
  // require them, and those commands are NOT run in WP-00-02.
  verbose: true,
  strict: true,
});
