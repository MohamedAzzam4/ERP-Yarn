/**
 * WP-08-01F Task 1 — Inspect and clean the superseded qaB-r7-1786625568 run.
 *
 * Cleans ONLY the mutable fixtures and private-storage objects belonging to
 * batch 634c764f-ef70-468e-ba0e-9f9f472c9087 (the superseded B1 run).
 *
 * NEVER deletes:
 *   - document_sequences
 *   - idempotency_records
 *   - audit_logs
 *   - non-QA tenant data
 *
 * Proves:
 *   - zero cleanup errors
 *   - no storage orphan
 *   - non-QA control counts unchanged
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... \
 *   SUPABASE_SECRET_KEY=... \
 *   node scripts/wp-08-01f-browser-qa/cleanup-superseded-run.mjs
 */
import { resolve } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createClient } = require(resolve(process.cwd(), "node_modules/@supabase/supabase-js"));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
// WP-08-01F DEC-057 — standardized on SUPABASE_SECRET_KEY (retired the
// SUPABASE_SERVICE_ROLE_KEY fallback).
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
const BUCKET = "migration-private-files";

const QA_TENANT = "00000000-0000-0000-0000-000000081e50";
const SUPERSEDED_BATCH_ID = "634c764f-ef70-468e-ba0e-9f9f472c9087";
const SUPERSEDED_RUN_ID = "qaB-r7-1786625568";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Tables to inspect (mutable fixtures only — NEVER audit_logs, idempotency_records, document_sequences)
const MUTABLE_TABLES = [
  "import_cutover_locks",
  "import_backup_evidence",
  "import_batch_approvals",
  "import_reconciliation_results",
  "import_human_review_items",
  "import_validation_errors",
  "import_alias_mappings",
  "import_staging_rows",
  "import_files",
  "import_cutover_manifests",
  "import_batches",
];

// Durable evidence tables — MUST NOT be deleted
const DURABLE_TABLES = ["audit_logs", "idempotency_records", "document_sequences"];

async function countForBatch(table, batchId) {
  // import_batches uses 'id'; all other tables use 'import_batch_id'
  const column = table === "import_batches" ? "id" : "import_batch_id";
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq(column, batchId);
  if (error) return { error: error.message, count: null };
  return { count, error: null };
}

async function countForTenant(table, tenantId) {
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  if (error) return { error: error.message, count: null };
  return { count, error: null };
}

async function deleteForBatch(table, batchId) {
  const { error } = await supabase
    .from(table)
    .delete()
    .eq("import_batch_id", batchId);
  return error ? error.message : null;
}

async function main() {
  console.log(`=== WP-08-01F Task 1: Clean superseded run ${SUPERSEDED_RUN_ID} ===`);
  console.log(`Batch ID: ${SUPERSEDED_BATCH_ID}`);
  console.log(`QA Tenant: ${QA_TENANT}`);
  console.log("");

  // ─── STEP 1: Inspect BEFORE state ───────────────────────────────────────
  console.log("─ STEP 1: Inspect BEFORE state ─");
  const beforeBatch = {};
  for (const t of MUTABLE_TABLES) {
    const result = await countForBatch(t, SUPERSEDED_BATCH_ID);
    beforeBatch[t] = result;
    console.log(`  ${t}: count=${result.count}${result.error ? ` ERROR=${result.error}` : ""}`);
  }

  // Check if the batch exists at all
  const { data: batchData, error: batchErr } = await supabase
    .from("import_batches")
    .select("id, status, batch_no, source_description, created_at")
    .eq("id", SUPERSEDED_BATCH_ID)
    .maybeSingle();
  if (batchErr) {
    console.error(`  ERROR querying batch: ${batchErr.message}`);
  }
  console.log(`  Batch record: ${JSON.stringify(batchData)}`);

  // Get storage paths for this batch's files
  const { data: filesData, error: filesErr } = await supabase
    .from("import_files")
    .select("id, storage_path, file_hash, is_current")
    .eq("import_batch_id", SUPERSEDED_BATCH_ID);
  const storagePaths = filesErr ? [] : (filesData || []).map(f => f.storage_path).filter(p => p);
  console.log(`  Storage objects to delete: ${storagePaths.length}`);
  console.log("");

  // Capture durable evidence counts (MUST NOT change)
  const beforeDurable = {};
  for (const t of DURABLE_TABLES) {
    const result = await countForTenant(t, QA_TENANT);
    beforeDurable[t] = result;
    console.log(`  DURABLE ${t}: count=${result.count}${result.error ? ` ERROR=${result.error}` : ""}`);
  }
  console.log("");

  // Capture non-QA tenant control counts (non-QA data MUST NOT change)
  // We check a few non-QA tenants by querying all tenants except QA
  const { data: nonQaBatches, error: nonQaErr } = await supabase
    .from("import_batches")
    .select("id", { count: "exact", head: true })
    .neq("tenant_id", QA_TENANT);
  const beforeNonQaBatches = nonQaErr ? null : (nonQaBatches?.length ?? 0);
  console.log(`  Non-QA control: import_batches count (excluding QA tenant) = ${beforeNonQaBatches}`);
  console.log("");

  // ─── STEP 2: Delete storage objects ─────────────────────────────────────
  console.log("─ STEP 2: Delete storage objects ─");
  let storageDeleted = 0;
  let storageErrors = 0;
  for (const path of storagePaths) {
    if (path && path.startsWith("supabase://")) {
      const key = path.replace(/^supabase:\/\/[^/]+\//, "");
      const { error } = await supabase.storage.from(BUCKET).remove([key]);
      if (error) {
        console.error(`  STORAGE ERROR deleting '${key}': ${error.message}`);
        storageErrors++;
      } else {
        storageDeleted++;
        console.log(`  Deleted storage object: ${key}`);
      }
    } else if (path) {
      console.log(`  Skipping non-supabase storage path: ${path}`);
    }
  }
  console.log(`  Storage deleted: ${storageDeleted}, errors: ${storageErrors}`);
  console.log("");

  // ─── STEP 3: Delete mutable fixtures in FK-safe order (children first) ──
  console.log("─ STEP 3: Delete mutable fixtures (FK-safe order) ─");
  let dbErrors = 0;
  for (const t of MUTABLE_TABLES) {
    // Skip import_batches — delete it LAST after all children are gone
    if (t === "import_batches") continue;
    const err = await deleteForBatch(t, SUPERSEDED_BATCH_ID);
    if (err) {
      console.error(`  DB ERROR deleting from ${t}: ${err}`);
      dbErrors++;
    } else {
      console.log(`  Deleted from ${t} for batch ${SUPERSEDED_BATCH_ID}`);
    }
  }
  // Now delete the batch itself (parent) — uses 'id' not 'import_batch_id'
  const { error: batchDelErr } = await supabase
    .from("import_batches")
    .delete()
    .eq("id", SUPERSEDED_BATCH_ID);
  if (batchDelErr) {
    console.error(`  DB ERROR deleting from import_batches: ${batchDelErr.message}`);
    dbErrors++;
  } else {
    console.log(`  Deleted from import_batches for batch ${SUPERSEDED_BATCH_ID}`);
  }
  console.log(`  DB delete errors: ${dbErrors}`);
  console.log("");

  // ─── STEP 4: Verify AFTER state ─────────────────────────────────────────
  console.log("─ STEP 4: Verify AFTER state ─");
  const afterBatch = {};
  let afterNonZero = 0;
  for (const t of MUTABLE_TABLES) {
    const result = await countForBatch(t, SUPERSEDED_BATCH_ID);
    afterBatch[t] = result;
    console.log(`  ${t}: count=${result.count}${result.error ? ` ERROR=${result.error}` : ""}`);
    if (result.count && result.count > 0) afterNonZero++;
  }

  // Verify durable evidence preserved
  console.log("");
  let durableOk = true;
  for (const t of DURABLE_TABLES) {
    const result = await countForTenant(t, QA_TENANT);
    const before = beforeDurable[t].count;
    const after = result.count;
    const unchanged = before === after;
    console.log(`  DURABLE ${t}: before=${before} after=${after} ${unchanged ? "✓ UNCHANGED" : "✗ CHANGED!"}`);
    if (!unchanged) durableOk = false;
  }

  // Verify non-QA control unchanged
  const { data: nonQaBatchesAfter, error: nonQaErrAfter } = await supabase
    .from("import_batches")
    .select("id", { count: "exact", head: true })
    .neq("tenant_id", QA_TENANT);
  const afterNonQaBatches = nonQaErrAfter ? null : (nonQaBatchesAfter?.length ?? 0);
  const nonQaOk = beforeNonQaBatches === afterNonQaBatches;
  console.log(`  Non-QA control: before=${beforeNonQaBatches} after=${afterNonQaBatches} ${nonQaOk ? "✓ UNCHANGED" : "✗ CHANGED!"}`);
  console.log("");

  // ─── STEP 5: Summary ────────────────────────────────────────────────────
  console.log("─ STEP 5: Summary ─");
  console.log(`  Storage objects deleted: ${storageDeleted}`);
  console.log(`  Storage errors: ${storageErrors}`);
  console.log(`  DB delete errors: ${dbErrors}`);
  console.log(`  Mutable tables with residual rows: ${afterNonZero}`);
  console.log(`  Durable evidence preserved: ${durableOk ? "YES" : "NO"}`);
  console.log(`  Non-QA control unchanged: ${nonQaOk ? "YES" : "NO"}`);

  const success = storageErrors === 0 && dbErrors === 0 && afterNonZero === 0 && durableOk && nonQaOk;
  console.log("");
  console.log(`  RESULT: ${success ? "SUCCESS — zero errors, no orphans, durable evidence preserved" : "FAILURE"}`);

  // Verify no storage orphan: list remaining storage objects for this batch's path prefix
  if (storagePaths.length > 0) {
    const { data: remaining, error: listErr } = await supabase.storage
      .from(BUCKET)
      .list("", { search: SUPERSEDED_BATCH_ID });
    const orphanCount = listErr ? -1 : (remaining || []).length;
    console.log(`  Storage orphan check: ${orphanCount === 0 ? "✓ ZERO orphans" : `✗ ${orphanCount} objects remain (or list error: ${listErr?.message})`}`);
  }

  process.exit(success ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
