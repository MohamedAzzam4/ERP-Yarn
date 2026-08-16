/**
 * FIXTURE — guard before connection AND DELETE → PASS.
 *
 * Used by wp-08-01f-static-guard-coverage.test.ts to prove the validator
 * accepts a file where the guard is invoked BEFORE both the DB connection
 * and the DELETE statement.
 *
 * This file is excluded from vitest's test runner via vitest.config.ts.
 */
import { execSync } from "node:child_process";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
const TEST_TENANT_ID = "cccccccc-0000-4000-8000-000000000052";

async function main() {
  // Guard BEFORE connection — correct ordering.
  execSync("node scripts/wp-08-01f-destruction-guard.mjs", { stdio: "inherit" });

  // Connection AFTER guard.
  const sql = postgres(DATABASE_URL || "");

  // DELETE AFTER both guard and connection.
  await sql`DELETE FROM import_batches WHERE tenant_id = ${TEST_TENANT_ID}`;
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
