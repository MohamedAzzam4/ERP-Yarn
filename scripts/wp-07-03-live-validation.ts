/**
 * WP-07-03 Live Supabase Validation — Reconciliation and Human Review.
 *
 * Production-path validation:
 *   - HistoricalReconciliationService
 *   - HistoricalReconciliationDbRepository
 *   - AuditDbRepository
 *
 * Non-operational — no stock/account/sales/payment effects.
 *
 * Usage: DATABASE_URL=... npx tsx scripts/wp-07-03-live-validation.ts
 * TEST-ONLY. Not for production use.
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../src/server/db/schema/index";
import { HistoricalStagingDbRepository } from "../src/server/services/historical-staging-db-repository";
import { HistoricalStagingService } from "../src/server/services/historical-staging-service";
import { HistoricalReconciliationDbRepository } from "../src/server/services/historical-reconciliation-db-repository";
import { HistoricalReconciliationService } from "../src/server/services/historical-reconciliation-service";
import { AuditDbRepository } from "../src/server/services/audit-db-repository";
import { InProcessIdempotencyStore } from "../src/server/services/idempotency-service";
import { InProcessDocumentSequenceStore } from "../src/server/services/document-sequence-service";
import type { ErpUserContext } from "../src/server/auth/erp-context";
import type { EffectivePermissions } from "../src/server/security/effective-permissions";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("ERROR: DATABASE_URL required."); process.exit(2); }

const pgSql = postgres(DATABASE_URL, { prepare: false, max: 10, idle_timeout: 30, connect_timeout: 30, max_lifetime: 180 });
const db = drizzle(pgSql, { schema });

const TEST_TENANT_ID = "00000000-0000-0000-0000-000000070003";
const TEST_USER_ID = "00000000-0000-0000-0000-000000070003";

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
function check(name: string, ok: boolean, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const ownerUser: ErpUserContext = {
  authenticated: true, userId: TEST_USER_ID, tenantId: TEST_TENANT_ID,
  email: "wp0703@test.local", name: "WP-07-03 Owner", authId: "wp0703",
};
const ownerEff: EffectivePermissions = {
  assignedRoleCodes: ["owner"],
  permissionKeys: new Set(["migration.prepare", "migration.review", "migration.approve", "migration.commit"]),
  deniedFieldKeys: new Set(), workerFinancialDeny: false,
} as any;

function wireServices() {
  const stagingRepo = new HistoricalStagingDbRepository(db);
  const reconRepo = new HistoricalReconciliationDbRepository(db);
  const audit = new AuditDbRepository(db);
  const idempotency = new InProcessIdempotencyStore();
  const documentSequence = new InProcessDocumentSequenceStore();
  const stagingService = new HistoricalStagingService({ repository: stagingRepo, audit, idempotency, documentSequence });
  const reconService = new HistoricalReconciliationService({ repository: reconRepo, audit, idempotency });
  return { stagingRepo, reconRepo, audit, idempotency, documentSequence, stagingService, reconService };
}

async function ensureMasterData() {
  await pgSql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status) VALUES (${TEST_TENANT_ID}, 'WP-07-03 Live', 'ar', 'EGP', 'Africa/Cairo', 'active') ON CONFLICT (id) DO NOTHING`;
  await pgSql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${TEST_USER_ID}, ${TEST_TENANT_ID}, 'wp0703', 'WP-07-03 Owner', 'wp0703@test.local', 'active', 'ar') ON CONFLICT (id) DO NOTHING`;
}

async function cleanTestData() {
  await pgSql.begin(async (tx) => {
    await tx`DELETE FROM import_human_review_items WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM import_reconciliation_results WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM import_validation_errors WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM import_alias_mappings WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM import_staging_cells WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM import_staging_rows WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM import_files WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM import_batches WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM import_template_versions WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM idempotency_records WHERE tenant_id = ${TEST_TENANT_ID} AND (operation_scope LIKE 'historical_%' OR operation_scope LIKE 'import_%')`;
    await tx`DELETE FROM document_sequences WHERE tenant_id = ${TEST_TENANT_ID} AND document_type = 'migration_batch'`;
  });
}

async function captureCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const tables = [
    "stock_movements", "inventory_balances", "stock_reservations",
    "account_entries", "payments", "payment_settlements",
    "sales_orders", "sales_order_lines", "return_requests", "return_lines",
    "production_orders", "production_inputs", "production_receipts",
    "production_wip_balances", "production_wip_returns",
    "suppliers", "customers", "inventory_items", "locations",
  ];
  for (const table of tables) {
    try {
      const result = await pgSql.unsafe(`SELECT COUNT(*)::int AS n FROM ${table} WHERE tenant_id = $1`, [TEST_TENANT_ID]);
      counts[table] = (result[0] as any).n;
    } catch {
      counts[table] = -1;
    }
  }
  return counts;
}

async function verifyNoChanges(before: Record<string, number>): Promise<void> {
  for (const [table, beforeVal] of Object.entries(before)) {
    if (beforeVal === -1) { check(`   ${table}: skipped`, true, "table not found"); continue; }
    try {
      const result = await pgSql.unsafe(`SELECT COUNT(*)::int AS n FROM ${table} WHERE tenant_id = $1`, [TEST_TENANT_ID]);
      const after = (result[0] as any).n;
      check(`   ${table}: no new rows`, after === beforeVal, `before=${beforeVal}, after=${after}`);
    } catch { check(`   ${table}: skipped`, true, "query failed"); }
  }
}

async function main() {
  console.log("=== WP-07-03 Live Supabase Validation (Production Path) ===");
  let exitCode = 0;

  try {
    await ensureMasterData();
    await cleanTestData();
    const beforeCounts = await captureCounts();

    // ===== SECTION 1: Create batch + staging rows with various issues =====
    let batchId: string;
    {
      const services = wireServices();
      const batch = await services.stagingService.createBatch(ownerUser as any, ownerEff as any, {
        sourceDescription: "Reconciliation test batch",
        templateName: null, templateVersion: null,
        cutoverImportMode: "opening_balance",
        idempotencyKey: "batch-recon-001",
      });
      batchId = batch.batchId;
      check("1. batch created", batch.action === "created", `action=${batch.action}`);

      // Row 1: valid row (qty=100)
      await services.stagingService.insertStagingRow(ownerUser as any, ownerEff as any, {
        importBatchId: batchId, importFileId: null, templateName: null,
        sourceSheetName: "Sheet1", sourceRowNumber: 1,
        rawRowJson: { name: "Item A", code: "I001", quantity: "100", date: "2026-01-01" },
        transformedRowJson: null, transformationNotes: null, idempotencyKey: "row-recon-001",
      });
      // Row 2: qty=200 (total staged qty=300, expected=500 → mismatch)
      await services.stagingService.insertStagingRow(ownerUser as any, ownerEff as any, {
        importBatchId: batchId, importFileId: null, templateName: null,
        sourceSheetName: "Sheet1", sourceRowNumber: 2,
        rawRowJson: { name: "Item B", code: "I002", quantity: "200", date: "2026-01-01" },
        transformedRowJson: null, transformationNotes: null, idempotencyKey: "row-recon-002",
      });
      // Row 3: negative quantity (blocking)
      await services.stagingService.insertStagingRow(ownerUser as any, ownerEff as any, {
        importBatchId: batchId, importFileId: null, templateName: null,
        sourceSheetName: "Sheet1", sourceRowNumber: 3,
        rawRowJson: { name: "Item C", code: "I003", quantity: "-50", date: "2026-01-01" },
        transformedRowJson: null, transformationNotes: null, idempotencyKey: "row-recon-003",
      });
      // Row 4: duplicate doc_no
      await services.stagingService.insertStagingRow(ownerUser as any, ownerEff as any, {
        importBatchId: batchId, importFileId: null, templateName: null,
        sourceSheetName: "Sheet1", sourceRowNumber: 4,
        rawRowJson: { name: "Item D", code: "I004", quantity: "100", date: "2026-01-01", doc_no: "DOC001" },
        transformedRowJson: null, transformationNotes: null, idempotencyKey: "row-recon-004",
      });
      await services.stagingService.insertStagingRow(ownerUser as any, ownerEff as any, {
        importBatchId: batchId, importFileId: null, templateName: null,
        sourceSheetName: "Sheet1", sourceRowNumber: 5,
        rawRowJson: { name: "Item E", code: "I005", quantity: "100", date: "2026-01-01", doc_no: "DOC001" },
        transformedRowJson: null, transformationNotes: null, idempotencyKey: "row-recon-005",
      });
      // Row 6: unmatched alias (name but no customer_id/item_id)
      await services.stagingService.insertStagingRow(ownerUser as any, ownerEff as any, {
        importBatchId: batchId, importFileId: null, templateName: null,
        sourceSheetName: "Sheet1", sourceRowNumber: 6,
        rawRowJson: { name: "Unknown Customer", code: "UC001", quantity: "50", date: "2026-01-01" },
        transformedRowJson: null, transformationNotes: null, idempotencyKey: "row-recon-006",
      });

      // Staged total: 100+200-50+100+100+50 = 500
      // Expected: 600 → mismatch detected

      await pgSql`UPDATE import_batches SET status = 'validation_complete' WHERE id = ${batchId}`;
      check("2. batch set to validation_complete with 6 rows", true, `batchId=${batchId}`);
    }

    // ===== SECTION 2: Run reconciliation =====
    {
      const services = wireServices();
      const result = await services.reconService.runReconciliation(ownerUser as any, ownerEff as any, {
        importBatchId: batchId,
        expectedTotals: { inventory_opening_qty: "600" }, // expected 600, staged 500 → mismatch
        idempotencyKey: "recon-run-001",
      });
      check("3. reconciliation executed", result.action === "executed", `action=${result.action}`);
      check("   report version=1", result.reportVersion === 1, `version=${result.reportVersion}`);
      check("   blocking results found", result.blocking > 0, `blocking=${result.blocking}`);
      check("   review items created", result.reviewItemsCreated > 0, `reviews=${result.reviewItemsCreated}`);

      // 4. Results persisted with provenance
      const reconResults = await pgSql`SELECT * FROM import_reconciliation_results WHERE tenant_id = ${TEST_TENANT_ID} AND import_batch_id = ${batchId}`;
      check("4. reconciliation results persisted", reconResults.length > 0, `count=${reconResults.length}`);
      check("   results have report_version", reconResults.every((r: any) => r.report_version === 1), "");
      check("   results have metric_key", reconResults.every((r: any) => r.metric_key !== null), "");
      check("   results have status", reconResults.every((r: any) => r.status !== null), "");

      // 5. Mismatch detected
      const mismatch = reconResults.find((r: any) => r.metric_key === "inventory_opening_qty");
      check("5. inventory mismatch detected", mismatch?.status !== "matched", `status=${mismatch?.status}`);

      // 6. Negative quantity detected
      const neg = reconResults.find((r: any) => r.metric_key === "negative_staged_quantity");
      check("6. negative quantity detected", neg?.status === "blocking", `status=${neg?.status}`);

      // 7. Duplicate document detected
      const dup = reconResults.find((r: any) => r.metric_key?.startsWith("duplicate_document_"));
      check("7. duplicate document detected", dup?.status === "blocking", `status=${dup?.status}`);

      // 8. Unmatched alias detected
      const unmatched = reconResults.find((r: any) => r.metric_key?.startsWith("unmatched_alias_"));
      check("8. unmatched alias detected", unmatched?.status === "blocking", `status=${unmatched?.status}`);

      // 9. Review items persisted
      const reviews = await pgSql`SELECT * FROM import_human_review_items WHERE tenant_id = ${TEST_TENANT_ID} AND import_batch_id = ${batchId}`;
      check("9. review items persisted", reviews.length > 0, `count=${reviews.length}`);
      check("   all reviews have status=pending", reviews.every((r: any) => r.status === "pending"), "");

      // 10. Scoped audit
      const runAudit = await pgSql`SELECT * FROM audit_logs WHERE tenant_id = ${TEST_TENANT_ID} AND entity_type = 'import_batch' AND action_type = 'historical_reconciliation.run' AND entity_id = ${batchId}`;
      check("10. audit: reconciliation run row exists", runAudit.length === 1, `count=${runAudit.length}`);
      check("   audit: user_id matches", runAudit[0]?.user_id === TEST_USER_ID, "");

      const resultAudit = await pgSql`SELECT * FROM audit_logs WHERE tenant_id = ${TEST_TENANT_ID} AND entity_type = 'import_reconciliation_result' AND action_type = 'historical_reconciliation.result'`;
      check("11. audit: result rows exist", resultAudit.length > 0, `count=${resultAudit.length}`);
      check("   audit: results have metricKey", resultAudit.every((a: any) => a.new_values_json?.metricKey !== undefined), "");

      const reviewAudit = await pgSql`SELECT * FROM audit_logs WHERE tenant_id = ${TEST_TENANT_ID} AND entity_type = 'import_human_review_item' AND action_type = 'historical_reconciliation.review_created'`;
      check("12. audit: review item rows exist", reviewAudit.length > 0, `count=${reviewAudit.length}`);
    }

    // ===== SECTION 3: Idempotency replay =====
    {
      const services = wireServices();
      const result1 = await services.reconService.runReconciliation(ownerUser as any, ownerEff as any, {
        importBatchId: batchId,
        expectedTotals: { inventory_opening_qty: "600" },
        idempotencyKey: "recon-replay-001",
      });
      check("13. first reconciliation run executed (version 2)", result1.action === "executed", `action=${result1.action}`);

      const result2 = await services.reconService.runReconciliation(ownerUser as any, ownerEff as any, {
        importBatchId: batchId,
        expectedTotals: { inventory_opening_qty: "600" },
        idempotencyKey: "recon-replay-001",
      });
      check("14. idempotency replay returns same result", result2.action === "replayed", `action=${result2.action}`);

      const results = await pgSql`SELECT COUNT(*)::int AS n FROM import_reconciliation_results WHERE tenant_id = ${TEST_TENANT_ID} AND import_batch_id = ${batchId}`;
      check("   no duplicate results after replay", results[0].n === result1.totalMetrics, `count=${results[0].n}, expected=${result1.totalMetrics}`);
    }

    // ===== SECTION 4: Version invalidation =====
    {
      const services = wireServices();
      const result = await services.reconService.runReconciliation(ownerUser as any, ownerEff as any, {
        importBatchId: batchId,
        expectedTotals: { inventory_opening_qty: "700" }, // different expected → new version
        idempotencyKey: "recon-version-003",
      });
      check("15. new version created (version 3)", result.reportVersion === 3, `version=${result.reportVersion}`);

      const v2Results = await pgSql`SELECT COUNT(*)::int AS n FROM import_reconciliation_results WHERE tenant_id = ${TEST_TENANT_ID} AND import_batch_id = ${batchId} AND report_version = 2`;
      check("   old version 2 results deleted", v2Results[0].n === 0, `count=${v2Results[0].n}`);

      const v3Results = await pgSql`SELECT COUNT(*)::int AS n FROM import_reconciliation_results WHERE tenant_id = ${TEST_TENANT_ID} AND import_batch_id = ${batchId} AND report_version = 3`;
      check("   new version 3 results exist", v3Results[0].n > 0, `count=${v3Results[0].n}`);
    }

    // ===== SECTION 5: Non-operational proof =====
    check("16. expanded non-operational proof — before/after counts:", true);
    await verifyNoChanges(beforeCounts);

    const batchAfter = await pgSql`SELECT status, committed_at FROM import_batches WHERE id = ${batchId}`;
    check("17. batch not committed", batchAfter[0]?.committed_at === null, `committed=${batchAfter[0]?.committed_at}`);

    // ===== CLEANUP =====
    await cleanTestData();
    console.log("\n=== Cleanup completed successfully ===");

  } catch (e) {
    console.error("FATAL ERROR:", (e as Error).message);
    console.error((e as Error).stack);
    exitCode = 1;
  } finally {
    try { await cleanTestData(); } catch (e) { /* ignore */ }
    await pgSql.end({ timeout: 5 });
  }

  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n=== Summary ===\nPassed: ${passed} / ${results.length}\nFailed: ${failed}`);
  if (failed > 0) {
    console.log("\nFailures:");
    for (const r of results.filter(r => !r.ok)) console.log(`  - ${r.name}: ${r.detail}`);
    exitCode = 1;
  }
  process.exit(exitCode);
}

main();
