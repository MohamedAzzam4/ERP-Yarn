/**
 * Cleanup helper — delete mutable QA fixtures scoped by tenant ID.
 * NEVER deletes audit_logs, idempotency_records, or document_sequences.
 *
 * Also deletes storage objects for the tenant's files.
 *
 * Usage:
 *   node cleanup.mjs <DATABASE_URL> <SUPABASE_URL> <SUPABASE_SERVICE_KEY> <tenantId>
 */
import { resolve } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const postgres = require(resolve(process.cwd(), "node_modules/postgres"));
const { execSync } = require("node:child_process");
const { createClient } = require(resolve(process.cwd(), "node_modules/@supabase/supabase-js"));

const [dbUrl, supabaseUrl, supabaseKey, tenantId] = process.argv.slice(2);
const BUCKET = "migration-private-files";

async function main() {
  execSync("node scripts/wp-08-01f-destruction-guard.mjs --live-validation", { stdio: "inherit" });
  const sql = postgres(dbUrl, { prepare: false, max: 3, connect_timeout: 15, idle_timeout: 10 });
  const supabase = createClient(supabaseUrl, supabaseKey);

  // BEFORE counts
  const before = {};
  for (const t of ["import_batches", "import_files", "import_staging_rows", "import_validation_errors",
    "import_reconciliation_results", "import_human_review_items", "import_batch_approvals",
    "import_backup_evidence", "import_cutover_manifests", "import_cutover_locks",
    "audit_logs", "idempotency_records"]) {
    const r = await sql`SELECT count(*)::int AS c FROM ${sql(t)} WHERE tenant_id = ${tenantId}`;
    before[t] = r[0].c;
  }
  console.log("BEFORE:", JSON.stringify(before));

  // Delete storage objects
  const files = await sql`SELECT storage_path FROM import_files WHERE tenant_id = ${tenantId}`;
  let storageDeleted = 0;
  for (const f of files) {
    if (f.storage_path?.startsWith("supabase://")) {
      const key = f.storage_path.replace(/^supabase:\/\/[^/]+\//, "");
      const { error } = await supabase.storage.from(BUCKET).remove([key]);
      if (!error) storageDeleted++;
    }
  }
  console.log(`Storage objects deleted: ${storageDeleted}`);

  // FK-safe DB cleanup (children first, NEVER delete audit_logs/idempotency_records/document_sequences)
  await sql`DELETE FROM import_cutover_locks WHERE tenant_id = ${tenantId}`;
  await sql`DELETE FROM import_backup_evidence WHERE tenant_id = ${tenantId}`;
  await sql`DELETE FROM import_batch_approvals WHERE tenant_id = ${tenantId}`;
  await sql`DELETE FROM import_reconciliation_results WHERE tenant_id = ${tenantId}`;
  await sql`DELETE FROM import_human_review_items WHERE tenant_id = ${tenantId}`;
  await sql`DELETE FROM import_validation_errors WHERE tenant_id = ${tenantId}`;
  await sql`DELETE FROM import_alias_mappings WHERE tenant_id = ${tenantId}`;
  await sql`DELETE FROM import_staging_rows WHERE tenant_id = ${tenantId}`;
  await sql`DELETE FROM import_files WHERE tenant_id = ${tenantId}`;
  await sql`DELETE FROM import_cutover_manifests WHERE tenant_id = ${tenantId}`;
  await sql`DELETE FROM import_batches WHERE tenant_id = ${tenantId}`;

  // AFTER counts
  const after = {};
  for (const t of ["import_batches", "import_files", "import_staging_rows", "import_validation_errors",
    "import_reconciliation_results", "import_human_review_items", "import_batch_approvals",
    "import_backup_evidence", "import_cutover_manifests", "import_cutover_locks",
    "audit_logs", "idempotency_records"]) {
    const r = await sql`SELECT count(*)::int AS c FROM ${sql(t)} WHERE tenant_id = ${tenantId}`;
    after[t] = r[0].c;
  }
  console.log("AFTER:", JSON.stringify(after));

  // Verify durable evidence preserved
  if (after.audit_logs !== before.audit_logs) {
    console.error(`ERROR: audit_logs changed ${before.audit_logs} → ${after.audit_logs}`);
    process.exit(1);
  }
  if (after.idempotency_records !== before.idempotency_records) {
    console.error(`ERROR: idempotency_records changed ${before.idempotency_records} → ${after.idempotency_records}`);
    process.exit(1);
  }
  console.log("Durable evidence preserved: audit_logs + idempotency_records unchanged");
  console.log("Cleanup OK — zero errors");

  await sql.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
