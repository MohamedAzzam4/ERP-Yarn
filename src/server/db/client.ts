/**
 * Drizzle ORM database client for runtime database access.
 *
 * Contract: docs/contracts/01_technical_architecture_and_deployment_contract.md
 *   §Database Access Contract:
 *   "Runtime database access uses the Supabase transaction-pool connection
 *    string and configures: prepare = false."
 *
 * This module creates the Drizzle ORM instance backed by postgres.js using
 * the Supabase transaction pooler connection string. It enforces
 * `prepare: false` via POSTGRES_CLIENT_OPTIONS (from postgres-config.ts).
 *
 * WP-02-01: This is the first runtime DB client module. Later packages
 * (WP-02-02, WP-02-03, etc.) will import `db` from here for their
 * repository implementations.
 *
 * The connection is lazy — postgres.js opens the pool on first query.
 * If DATABASE_URL is not set (e.g., in test/CI without Supabase), the
 * module still loads but any query will throw. Tests use in-memory
 * repositories instead.
 */
import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { POSTGRES_CLIENT_OPTIONS, assertPrepareFalse } from "./postgres-config";
import * as schema from "./schema";

/**
 * The Supabase transaction-pooler connection string.
 *
 * Must be set in the runtime environment (Vercel Preview/Production env
 * vars). Not required for unit tests (which use in-memory repositories).
 */
const DATABASE_URL = process.env.DATABASE_URL;

/**
 * The postgres.js connection instance.
 *
 * Created lazily only if DATABASE_URL is available. In test environments
 * without a database, this is null and the Drizzle instance is not created.
 */
const sql = DATABASE_URL
  ? postgres(DATABASE_URL, POSTGRES_CLIENT_OPTIONS)
  : null;

// Static self-check: verify prepare: false is enforced.
assertPrepareFalse(POSTGRES_CLIENT_OPTIONS);

/**
 * The Drizzle ORM database instance.
 *
 * Null when DATABASE_URL is not set (test/CI without Supabase). Runtime
 * code that uses `db` MUST check for null and fall back to an in-memory
 * repository or throw a clear error.
 *
 * In production (Vercel with Supabase env vars), this is always non-null.
 */
export const db = sql
  ? drizzle(sql, { schema })
  : null;

/**
 * The raw postgres.js connection (for transactions, etc.).
 *
 * Null when DATABASE_URL is not set.
 */
export { sql };
