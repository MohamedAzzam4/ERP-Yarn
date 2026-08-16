/**
 * FIXTURE — connection before guard, DELETE after guard → FAIL.
 *
 * The DB connection is constructed BEFORE the guard is invoked.
 * This must be rejected even though the DELETE is after the guard.
 *
 * This file is excluded from vitest's test runner via vitest.config.ts.
 */
import { execSync } from "node:child_process";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
const TEST_TENANT_ID = "cccccccc-0000-4000-8000-000000000052";

async function main() {
  // Connection BEFORE guard — WRONG ordering.
  const sql = postgres(DATABASE_URL || "");

  // Guard AFTER connection — too late.
  execSync("node scripts/wp-08-01f-destruction-guard.mjs", { stdio: "inherit" });

  // DELETE after guard (but connection was already established).
  await sql`DELETE FROM import_batches WHERE tenant_id = ${TEST_TENANT_ID}`;
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
