/**
 * FIXTURE — intentionally UNGUARDED live-validation script.
 *
 * Used by wp-08-01f-static-guard-coverage.test.ts to prove the validator
 * rejects a standalone script that contains a DELETE statement but does
 * NOT invoke the centralized guard CLI.
 *
 * This file is NOT executed; the static-guard-coverage test reads its
 * source as text.
 */
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
const TEST_TENANT_ID = "00000000-0000-0000-0000-000000081e50"; // INTENTIONALLY UNGUARDED

async function main() {
  const sql = postgres(DATABASE_URL);
  await sql`DELETE FROM import_batches WHERE tenant_id = ${TEST_TENANT_ID}`;
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
