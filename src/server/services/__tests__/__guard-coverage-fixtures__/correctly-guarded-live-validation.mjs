/**
 * FIXTURE — correctly guarded live-validation script.
 *
 * Used by wp-08-01f-static-guard-coverage.test.ts to prove the validator
 * accepts a standalone Node script that invokes the centralized guard CLI
 * BEFORE any DELETE statement.
 *
 * This file is NOT executed; the static-guard-coverage test reads its
 * source as text.
 */
import { execSync } from "node:child_process";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
const TEST_TENANT_ID = "cccccccc-0000-4000-8000-000000000052"; // test-scoped, non-QA

async function main() {
  // Invoke the centralized guard CLI BEFORE connecting to the DB.
  execSync("node scripts/wp-08-01f-destruction-guard.mjs", { stdio: "inherit" });

  const sql = postgres(DATABASE_URL);
  await sql`DELETE FROM import_batches WHERE tenant_id = ${TEST_TENANT_ID}`;
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
