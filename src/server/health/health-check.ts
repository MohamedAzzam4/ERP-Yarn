/**
 * Server-only health check service.
 * Contract 01 §Observability Baseline + Contract 13 WP-00-06.
 * Non-sensitive health status: DB reachable, table count, migration status,
 * Auth/Storage health (safe booleans only). No secrets exposed.
 */
import "server-only";

export interface HealthCheckResult {
  status: "ok" | "degraded" | "error";
  service: string;
  package: string;
  environment: string;
  timestamp: string;
  checks: {
    database?: { reachable: boolean; tableCount?: number; migrationApplied?: boolean };
    auth?: { reachable: boolean; method?: string };
    storage?: { reachable: boolean; method?: string };
  };
}

export async function checkDatabaseHealth(): Promise<{
  reachable: boolean; tableCount?: number; migrationApplied?: boolean;
}> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return { reachable: false };
  try {
    const { default: postgres } = await import("postgres");
    const sql = postgres(dbUrl, { prepare: false, connect_timeout: 10, idle_timeout: 5, max: 1 });
    try {
      const result = await sql`SELECT count(*)::int as cnt FROM pg_tables WHERE schemaname = 'public'`;
      const tableCount = result[0]?.cnt ?? 0;
      const journalExists = await sql`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '__drizzle_migrations') as exists`;
      return { reachable: true, tableCount, migrationApplied: journalExists[0]?.exists ?? false };
    } finally { await sql.end(); }
  } catch { return { reachable: false }; }
}

export async function checkAuthHealth(): Promise<{ reachable: boolean; method?: string }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) return { reachable: false };
  try {
    // Non-invasive Auth health: use the Supabase Auth admin API to get
    // a simple health/status response. We use fetch directly (not the
    // Supabase client) to avoid importing client-side code server-only.
    // The Auth /health endpoint returns 200 if the Auth service is up.
    const response = await fetch(`${supabaseUrl}/auth/v1/health`, {
      headers: { "apikey": secretKey },
      signal: AbortSignal.timeout(10000),
    });
    return { reachable: response.ok, method: "auth-v1-health" };
  } catch {
    return { reachable: false };
  }
}

export async function checkStorageHealth(): Promise<{ reachable: boolean; method?: string }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) return { reachable: false };
  try {
    // Non-invasive Storage health: list buckets (admin API).
    // We only check reachability, not bucket contents.
    const response = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
      headers: { "apikey": secretKey, "Authorization": `Bearer ${secretKey}` },
      signal: AbortSignal.timeout(10000),
    });
    return { reachable: response.ok, method: "storage-v1-bucket-list" };
  } catch {
    return { reachable: false };
  }
}

export function getEnvironmentLabel(): string {
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv === "production") return "demo (vercel-production)";
  if (vercelEnv === "preview") return "preview";
  return "development";
}

export async function performHealthCheck(): Promise<HealthCheckResult> {
  const [dbCheck, authCheck, storageCheck] = await Promise.all([
    checkDatabaseHealth(),
    checkAuthHealth(),
    checkStorageHealth(),
  ]);
  const allOk = dbCheck.reachable && authCheck.reachable && storageCheck.reachable;
  return {
    status: allOk ? "ok" : "degraded",
    service: "erp-yarn",
    package: "WP-00-06",
    environment: getEnvironmentLabel(),
    timestamp: new Date().toISOString(),
    checks: { database: dbCheck, auth: authCheck, storage: storageCheck },
  };
}
