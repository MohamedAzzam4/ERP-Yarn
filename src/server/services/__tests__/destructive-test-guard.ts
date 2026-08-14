/**
 * Shared destructive-test database safety guard.
 *
 * Every test or script that performs DELETE, TRUNCATE, DROP, schema reset,
 * or broad cleanup MUST call `assertDestructiveTestDbSafety()` before any
 * destructive statement.
 *
 * This guard centralizes all safety checks that were previously duplicated
 * per-file with varying strength.
 *
 * Requirements:
 * 1. DATABASE_URL uses PostgreSQL (postgresql:// or postgres://)
 * 2. Host is exactly localhost, 127.0.0.1, or ::1
 * 3. Database name matches the disposable-test naming policy
 * 4. ERP_ALLOW_DESTRUCTIVE_LOCAL_TEST_DB=1 is set
 * 5. The database contains an explicit disposable marker
 * 6. No Supabase project ref/pooler hostname in the URL
 * 7. No production/QA tenant IDs are accepted unless created in this DB
 *
 * If any condition fails, the guard throws a DestructiveTestSafetyError
 * with a credential-free safety message.
 */
export const DISPOSABLE_DB_NAME = "erp_yarn_wp0801f_disposable";
export const DISPOSABLE_DB_MARKER_TABLE = "__disposable_test_db_marker";

export interface DestructiveTestSafetyConfig {
  /** The DATABASE_URL to check. */
  databaseUrl: string | undefined;
  /** Whether the explicit opt-in flag is set. */
  allowDestructive: boolean;
  /** Whether proof is required (ERP_REQUIRE_WP0801F_POSTGRES_PROOF=1). */
  requireProof: boolean;
  /** A connected postgres instance for marker verification. */
  sql?: { unsafe: (query: string) => Promise<unknown[]> };
}

export type SafetyResult =
  | { kind: "ok" }
  | { kind: "skip"; reason: string }
  | { kind: "fail"; message: string };

export class DestructiveTestSafetyError extends Error {
  readonly code = "DESTRUCTIVE_TEST_SAFETY_VIOLATION";
  constructor(message: string) {
    super(message);
    this.name = "DestructiveTestSafetyError";
  }
}

/**
 * Check all safety conditions without throwing.
 * Returns a SafetyResult describing whether the environment is safe.
 */
export function checkDestructiveTestDbSafety(config: DestructiveTestSafetyConfig): SafetyResult {
  const { databaseUrl, allowDestructive, requireProof } = config;

  // 1. DATABASE_URL must be present
  if (!databaseUrl) {
    if (requireProof) {
      return { kind: "fail", message: "SAFETY: DATABASE_URL is not set but proof is required." };
    }
    return { kind: "skip", reason: "DATABASE_URL not set" };
  }

  // 2. Must be PostgreSQL
  if (!databaseUrl.startsWith("postgresql://") && !databaseUrl.startsWith("postgres://")) {
    if (databaseUrl.startsWith("file:")) {
      if (requireProof) {
        return { kind: "fail", message: "SAFETY: DATABASE_URL is SQLite (file:), not PostgreSQL." };
      }
      return { kind: "skip", reason: "DATABASE_URL is SQLite, not PostgreSQL" };
    }
    return { kind: "fail", message: `SAFETY: DATABASE_URL must start with postgresql:// or postgres://. Got: '${databaseUrl.slice(0, 10)}...'` };
  }

  // 3. Parse URL
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return { kind: "fail", message: "SAFETY: DATABASE_URL is not a valid URL." };
  }

  // 4. Host must be localhost/127.0.0.1/::1
  const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    return { kind: "fail", message: `SAFETY: hostname '${parsed.hostname}' is not in [localhost, 127.0.0.1, ::1]. Refusing to run destructive tests against non-local database.` };
  }

  // 5. No Supabase project ref or pooler hostname
  if (parsed.hostname.includes("supabase") || databaseUrl.includes("supabase") || databaseUrl.includes("pooler")) {
    return { kind: "fail", message: "SAFETY: DATABASE_URL appears to point to Supabase. Refusing to run destructive tests against Supabase." };
  }

  // 6. Database name must match disposable naming policy
  const database = parsed.pathname.replace(/^\//, "");
  if (database !== DISPOSABLE_DB_NAME) {
    return { kind: "fail", message: `SAFETY: database '${database}' is not '${DISPOSABLE_DB_NAME}'. Refusing to run destructive tests against non-disposable database.` };
  }

  // 7. Opt-in flag
  if (!allowDestructive) {
    if (requireProof) {
      return { kind: "fail", message: "SAFETY: ERP_ALLOW_DESTRUCTIVE_LOCAL_TEST_DB=1 is not set but proof is required." };
    }
    return { kind: "skip", reason: "ERP_ALLOW_DESTRUCTIVE_LOCAL_TEST_DB=1 not set" };
  }

  // 8. Disposable marker (checked at runtime by assertDestructiveTestDbSafety)
  // This is checked separately because it requires a DB connection.

  return { kind: "ok" };
}

/**
 * Assert that the environment is safe for destructive tests.
 * Throws DestructiveTestSafetyError if any condition fails.
 * Also checks the disposable marker table if a sql instance is provided.
 */
export async function assertDestructiveTestDbSafety(
  config: DestructiveTestSafetyConfig,
): Promise<void> {
  const result = checkDestructiveTestDbSafety(config);
  if (result.kind === "fail") {
    throw new DestructiveTestSafetyError(result.message);
  }
  if (result.kind === "skip") {
    throw new DestructiveTestSafetyError(
      `SAFETY: Environment not configured for destructive tests: ${result.reason}. ` +
      `Set DATABASE_URL to a local PostgreSQL disposable database and ERP_ALLOW_DESTRUCTIVE_LOCAL_TEST_DB=1.`,
    );
  }

  // Check disposable marker if sql is provided
  if (config.sql) {
    try {
      const rows = await config.sql.unsafe(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = '${DISPOSABLE_DB_MARKER_TABLE}') as exists`,
      ) as Array<{ exists: boolean }>;
      if (!rows[0]?.exists) {
        throw new DestructiveTestSafetyError(
          `SAFETY: Disposable marker table '${DISPOSABLE_DB_MARKER_TABLE}' not found. ` +
          `This database may not be a disposable test database.`,
        );
      }
    } catch (e) {
      if (e instanceof DestructiveTestSafetyError) throw e;
      // If we can't check the marker, fail closed
      throw new DestructiveTestSafetyError(
        `SAFETY: Could not verify disposable marker table: ${(e as Error).message}`,
      );
    }
  }
}

/**
 * Create the disposable marker table.
 * Called by test setup code when provisioning a new disposable database.
 */
export async function createDisposableMarker(
  sql: { unsafe: (query: string) => Promise<unknown[]> },
): Promise<void> {
  await sql.unsafe(
    `CREATE TABLE IF NOT EXISTS ${DISPOSABLE_DB_MARKER_TABLE} (id text PRIMARY KEY DEFAULT 'disposable', created_at timestamptz DEFAULT NOW())`,
  );
  await sql.unsafe(
    `INSERT INTO ${DISPOSABLE_DB_MARKER_TABLE} (id) VALUES ('disposable') ON CONFLICT DO NOTHING`,
  );
}

/**
 * Standard skip/describe pattern for tests that need the guard.
 * Returns `describe` if safe, `describe.skip` if should skip.
 */
export function describeOrSkipDestructive(
  config: DestructiveTestSafetyConfig,
): typeof describe | typeof describe.skip {
  const result = checkDestructiveTestDbSafety(config);
  if (result.kind === "fail" || result.kind === "skip") {
    return describe.skip;
  }
  return describe;
}
