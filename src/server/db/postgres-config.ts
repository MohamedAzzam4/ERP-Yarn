/**
 * Server-only postgres.js client configuration for Supabase transaction pooler.
 *
 * Contract: docs/contracts/01_technical_architecture_and_deployment_contract.md
 * §Database Access Contract:
 *   "Runtime database access uses the Supabase transaction-pool connection
 *    string and configures: prepare = false. This is required for
 *    compatibility with Supabase transaction-pool mode."
 *
 * WP-00-02 scope: this module exposes the configuration object only. It
 * does NOT create a live database connection and does NOT perform any
 * network I/O. Hosted Supabase is NOT connected in WP-00-02.
 *
 * The actual `postgres(...)` call that opens a connection will live in a
 * later package's runtime module. Here we only export:
 *   - `POSTGRES_CLIENT_OPTIONS` — the options object that MUST be passed
 *     to `postgres(url, options)` so that `prepare: false` is enforced
 *     statically and is testable.
 *   - `assertPrepareFalse(options)` — a helper for tests and runtime
 *     self-check that verifies `prepare: false` is set.
 */

import "server-only";

/**
 * Static postgres.js options for the Supabase transaction pooler.
 *
 * `prepare: false` is MANDATORY for Supabase transaction pooler
 * compatibility. This is a binding contract requirement, not a tunable.
 *
 * Other options are set to safe defaults; they may be refined in later
 * packages when the actual connection is wired.
 */
export const POSTGRES_CLIENT_OPTIONS = {
  prepare: false,
  // Supabase transaction pooler is PgBouncer-based; keep idle lifetime low.
  idle_timeout: 20,
  // Allow up to the typical Supabase free-tier pooler link lifetime.
  connect_timeout: 30,
  // Keep max connections conservative; Vercel function instances should not
  // fan out. Final tuning happens in later packages.
  max: 10,
  // Disable transform for column name shape; Drizzle handles mapping.
  transform: undefined,
} as const;

/**
 * Assert that a given postgres.js options object has `prepare: false`.
 *
 * Used by tests and by the runtime self-check on startup (in later packages).
 * Throws if the assertion fails.
 */
export function assertPrepareFalse(
  options: { prepare?: boolean } | undefined,
): void {
  if (!options || options.prepare !== false) {
    throw new Error(
      "postgres.js client options must set prepare: false for Supabase transaction pooler compatibility (Contract 01 §Database Access Contract).",
    );
  }
}

/**
 * Static self-check at module load: verify the exported options satisfy the
 * contract. This makes the `prepare: false` assertion executable in WP-00-02
 * without creating a connection.
 */
assertPrepareFalse(POSTGRES_CLIENT_OPTIONS);
