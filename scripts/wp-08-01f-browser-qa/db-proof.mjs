/**
 * DB proof helper — query batch status + counts by exact batch ID.
 * Resolves `postgres` from the ERP-Yarn node_modules.
 *
 * Usage:
 *   node db-proof.js <DATABASE_URL> <batchId>                     → JSON status + counts
 *   node db-proof.js <DATABASE_URL> <batchId> status              → status string only
 *   node db-proof.js <DATABASE_URL> <tenantId> counts             → tenant-level counts
 */
import { resolve } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const postgres = require(resolve(process.cwd(), "node_modules/postgres"));

const [url, id, mode] = process.argv.slice(2);

async function main() {
  const sql = postgres(url, { prepare: false, max: 3, connect_timeout: 15, idle_timeout: 10 });

  if (mode === "status") {
    const r = await sql`SELECT status, staged_row_count, staged_data_hash, cutover_manifest_hash,
                               validation_status, reconciliation_status
                        FROM import_batches WHERE id = ${id}`;
    console.log(r[0]?.status ?? "NOT_FOUND");
  } else if (mode === "counts") {
    // id is tenantId here
    const tables = [
      "import_batches", "import_files", "import_staging_rows",
      "import_validation_errors", "import_reconciliation_results",
      "import_human_review_items", "import_batch_approvals",
      "import_backup_evidence", "audit_logs", "idempotency_records",
      "stock_movements", "account_entries",
    ];
    const result = {};
    for (const t of tables) {
      const r = await sql`SELECT count(*)::int AS c FROM ${sql(t)} WHERE tenant_id = ${id}`;
      result[t] = r[0].c;
    }
    console.log(JSON.stringify(result));
  } else {
    // Default: full status + counts for a batch
    const r = await sql`SELECT status, staged_row_count, staged_data_hash, cutover_manifest_hash,
                               validation_status, reconciliation_status
                        FROM import_batches WHERE id = ${id}`;
    console.log(JSON.stringify(r[0] ?? {}));
    const f = await sql`SELECT count(*)::int AS c FROM import_files WHERE import_batch_id = ${id}`;
    const s = await sql`SELECT count(*)::int AS c FROM import_staging_rows WHERE import_batch_id = ${id}`;
    const v = await sql`SELECT count(*)::int AS c FROM import_validation_errors WHERE import_batch_id = ${id}`;
    console.log(JSON.stringify({ files: f[0].c, staging_rows: s[0].c, findings: v[0].c }));
  }

  await sql.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
