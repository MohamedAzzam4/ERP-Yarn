/**
 * DB proof helper using Supabase REST API (no DATABASE_URL needed).
 * Queries batch status + counts by exact batch ID.
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SECRET_KEY=... \
 *   node db-proof-rest.mjs <batchId>                     → JSON status + counts
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SECRET_KEY=... \
 *   node db-proof-rest.mjs <batchId> status              → status string only
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SECRET_KEY=... \
 *   node db-proof-rest.mjs <tenantId> counts             → tenant-level counts
 */
import { resolve } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createClient } = require(resolve(process.cwd(), "node_modules/@supabase/supabase-js"));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
// WP-08-01F DEC-057 — standardized on SUPABASE_SECRET_KEY. The fallback
// to SUPABASE_SERVICE_ROLE_KEY has been retired (DEC-057 documentation
// explains the exclusion).
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;

const [id, mode] = process.argv.slice(2);

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  if (mode === "status") {
    const { data, error } = await supabase
      .from("import_batches")
      .select("status, staged_row_count, staged_data_hash, cutover_manifest_hash, validation_status, reconciliation_status")
      .eq("id", id)
      .maybeSingle();
    if (error) { console.error(error.message); process.exit(1); }
    console.log(data?.status ?? "NOT_FOUND");
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
      const { count, error } = await supabase
        .from(t)
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", id);
      result[t] = error ? -1 : (count ?? 0);
    }
    console.log(JSON.stringify(result));
  } else {
    // Default: full status + counts for a batch
    const { data, error } = await supabase
      .from("import_batches")
      .select("status, staged_row_count, staged_data_hash, cutover_manifest_hash, validation_status, reconciliation_status, blocking_error_count, warning_count")
      .eq("id", id)
      .maybeSingle();
    if (error) { console.error(error.message); process.exit(1); }
    console.log(JSON.stringify(data ?? {}));

    const tables = [
      { table: "import_files", col: "import_batch_id" },
      { table: "import_staging_rows", col: "import_batch_id" },
      { table: "import_validation_errors", col: "import_batch_id" },
      { table: "import_cutover_manifests", col: "import_batch_id" },
      { table: "import_reconciliation_results", col: "import_batch_id" },
      { table: "import_human_review_items", col: "import_batch_id" },
      { table: "import_batch_approvals", col: "import_batch_id" },
    ];
    const counts = {};
    for (const { table, col } of tables) {
      const { count, error: e } = await supabase
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq(col, id);
      counts[table] = e ? -1 : (count ?? 0);
    }
    console.log(JSON.stringify(counts));
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
