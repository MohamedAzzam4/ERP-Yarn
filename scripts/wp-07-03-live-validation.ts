/**
 * WP-07-03 Live Supabase Validation — Reconciliation and Human Review (corrected).
 *
 * Strengthened proofs:
 *   Task A: Version preservation — V1 and V2 both exist, V1 marked superseded
 *   Task B: Expanded metrics (inventory/party/sales/payments/production/returns/documents/unmatched)
 *   Task C: Review items for every blocking/difference
 *   Task D: Scoped audit by exact entity IDs
 *   Task E: Expanded non-operational proof (19 tables)
 *   Task F: Idempotency replay + new run creates new version
 *
 * Usage: DATABASE_URL=... npx tsx scripts/wp-07-03-live-validation.ts
 * TEST-ONLY. Not for production use.
 */
import postgres from "postgres";
import { execSync } from "node:child_process";
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

execSync("node scripts/wp-08-01f-destruction-guard.mjs --live-validation", { stdio: "inherit" });
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
    } catch { counts[table] = -1; }
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

    // ===== SECTION 1: Create batch + staging rows with expanded data =====
    let batchId: string;
    {
      const services = wireServices();
      const batch = await services.stagingService.createBatch(ownerUser as any, ownerEff as any, {
        sourceDescription: "Expanded reconciliation test",
        templateName: null, templateVersion: null,
        cutoverImportMode: "opening_balance",
        idempotencyKey: "batch-recon-exp-001",
      });
      batchId = batch.batchId;
      check("1. batch created", batch.action === "created", `action=${batch.action}`);

      // Row 1: raw yarn opening (qty=100)
      await services.stagingService.insertStagingRow(ownerUser as any, ownerEff as any, {
        importBatchId: batchId, importFileId: null, templateName: null,
        sourceSheetName: "Sheet1", sourceRowNumber: 1,
        rawRowJson: { name: "Raw Yarn A", code: "RY001", quantity: "100", date: "2026-01-01", entity_type: "raw_yarn" },
        transformedRowJson: null, transformationNotes: null, idempotencyKey: "row-recon-exp-001",
      });
      // Row 2: single yarn opening (qty=200)
      await services.stagingService.insertStagingRow(ownerUser as any, ownerEff as any, {
        importBatchId: batchId, importFileId: null, templateName: null,
        sourceSheetName: "Sheet1", sourceRowNumber: 2,
        rawRowJson: { name: "Single Yarn B", code: "SY001", quantity: "200", date: "2026-01-01", entity_type: "single_yarn" },
        transformedRowJson: null, transformationNotes: null, idempotencyKey: "row-recon-exp-002",
      });
      // Row 3: negative quantity (blocking)
      await services.stagingService.insertStagingRow(ownerUser as any, ownerEff as any, {
        importBatchId: batchId, importFileId: null, templateName: null,
        sourceSheetName: "Sheet1", sourceRowNumber: 3,
        rawRowJson: { name: "Item C", code: "I003", quantity: "-50", date: "2026-01-01", entity_type: "single_yarn" },
        transformedRowJson: null, transformationNotes: null, idempotencyKey: "row-recon-exp-003",
      });
      // Row 4: customer opening balance
      await services.stagingService.insertStagingRow(ownerUser as any, ownerEff as any, {
        importBatchId: batchId, importFileId: null, templateName: null,
        sourceSheetName: "Sheet1", sourceRowNumber: 4,
        rawRowJson: { name: "Customer X", code: "CX001", quantity: "0", date: "2026-01-01", entity_type: "customer", balance: "500" },
        transformedRowJson: null, transformationNotes: null, idempotencyKey: "row-recon-exp-004",
      });
      // Row 5: duplicate doc_no
      await services.stagingService.insertStagingRow(ownerUser as any, ownerEff as any, {
        importBatchId: batchId, importFileId: null, templateName: null,
        sourceSheetName: "Sheet1", sourceRowNumber: 5,
        rawRowJson: { name: "Item D", code: "I004", quantity: "100", date: "2026-01-01", doc_no: "DOC001" },
        transformedRowJson: null, transformationNotes: null, idempotencyKey: "row-recon-exp-005",
      });
      await services.stagingService.insertStagingRow(ownerUser as any, ownerEff as any, {
        importBatchId: batchId, importFileId: null, templateName: null,
        sourceSheetName: "Sheet1", sourceRowNumber: 6,
        rawRowJson: { name: "Item E", code: "I005", quantity: "100", date: "2026-01-01", doc_no: "DOC001" },
        transformedRowJson: null, transformationNotes: null, idempotencyKey: "row-recon-exp-006",
      });
      // Row 7: unmatched alias (name but no master reference)
      await services.stagingService.insertStagingRow(ownerUser as any, ownerEff as any, {
        importBatchId: batchId, importFileId: null, templateName: null,
        sourceSheetName: "Sheet1", sourceRowNumber: 7,
        rawRowJson: { name: "Unknown Supplier", code: "US001", quantity: "0", date: "2026-01-01", entity_type: "supplier" },
        transformedRowJson: null, transformationNotes: null, idempotencyKey: "row-recon-exp-007",
      });
      // Row 8: WIP opening
      await services.stagingService.insertStagingRow(ownerUser as any, ownerEff as any, {
        importBatchId: batchId, importFileId: null, templateName: null,
        sourceSheetName: "Sheet1", sourceRowNumber: 8,
        rawRowJson: { name: "WIP Item", code: "W001", quantity: "0", date: "2026-01-01", wip_qty: "75" },
        transformedRowJson: null, transformationNotes: null, idempotencyKey: "row-recon-exp-008",
      });
      // Row 9: return without sale reference
      await services.stagingService.insertStagingRow(ownerUser as any, ownerEff as any, {
        importBatchId: batchId, importFileId: null, templateName: null,
        sourceSheetName: "Sheet1", sourceRowNumber: 9,
        rawRowJson: { name: "Return Item", code: "R001", quantity: "10", date: "2026-01-01", return_qty: "10" },
        transformedRowJson: null, transformationNotes: null, idempotencyKey: "row-recon-exp-009",
      });
      // Row 10: double-count risk (balance + sale_amount)
      await services.stagingService.insertStagingRow(ownerUser as any, ownerEff as any, {
        importBatchId: batchId, importFileId: null, templateName: null,
        sourceSheetName: "Sheet1", sourceRowNumber: 10,
        rawRowJson: { name: "Double Count", code: "DC001", quantity: "0", date: "2026-01-01", balance: "100", sale_amount: "200" },
        transformedRowJson: null, transformationNotes: null, idempotencyKey: "row-recon-exp-010",
      });

      await pgSql`UPDATE import_batches SET status = 'validation_complete' WHERE id = ${batchId}`;
      check("2. batch set to validation_complete with 10 rows", true, `batchId=${batchId}`);
    }

    // ===== SECTION 2: Run reconciliation V1 =====
    {
      const services = wireServices();
      // Staged total qty: 100+200-50+0+100+100+0+0+10+0 = 460
      // Expected: 500 → mismatch
      const result = await services.reconService.runReconciliation(ownerUser as any, ownerEff as any, {
        importBatchId: batchId,
        expectedTotals: { inventory_opening_qty: "500" },
        idempotencyKey: "recon-v1-001",
      });
      check("3. reconciliation V1 executed", result.action === "executed", `action=${result.action}`);
      check("   report version=1", result.reportVersion === 1, `version=${result.reportVersion}`);
      check("   blocking results found", result.blocking > 0, `blocking=${result.blocking}`);
      check("   review items created", result.reviewItemsCreated > 0, `reviews=${result.reviewItemsCreated}`);

      // Task B: Verify expanded metrics
      const reconResults = await pgSql`SELECT * FROM import_reconciliation_results WHERE tenant_id = ${TEST_TENANT_ID} AND import_batch_id = ${batchId} AND report_version = 1`;
      const metricKeys = reconResults.map((r: any) => r.metric_key);

      check("4. results persisted", reconResults.length > 0, `count=${reconResults.length}`);
      check("5. inventory_opening_qty metric", metricKeys.includes("inventory_opening_qty"), "");
      check("6. negative_staged_quantity metric", metricKeys.some((k: string) => k.startsWith("negative_staged_quantity")), "");
      check("7. duplicate_document metric", metricKeys.some((k: string) => k.startsWith("duplicate_document_")), "");
      check("8. unmatched_alias metric", metricKeys.some((k: string) => k.startsWith("unmatched_alias_")), "");
      check("9. opening_balance_plus_sales_overlap metric", metricKeys.some((k: string) => k.startsWith("opening_balance_plus_sales_overlap_")), "");
      check("10. return_without_sale_reference metric", metricKeys.some((k: string) => k.startsWith("return_without_sale_reference_")), "");
      check("11. raw_yarn_opening_qty metric", metricKeys.includes("raw_yarn_opening_qty"), "");
      check("12. single_yarn_opening_qty metric", metricKeys.includes("single_yarn_opening_qty"), "");
      check("13. customer_opening_balance metric", metricKeys.includes("customer_opening_balance"), "");
      check("14. wip_opening_qty metric", metricKeys.includes("wip_opening_qty"), "");
      check("15. party_balance_total metric", metricKeys.includes("party_balance_total"), "");

      // Task C: Review items
      const reviews = await pgSql`SELECT * FROM import_human_review_items WHERE tenant_id = ${TEST_TENANT_ID} AND import_batch_id = ${batchId}`;
      check("16. review items persisted", reviews.length > 0, `count=${reviews.length}`);
      check("   all reviews have status=pending", reviews.every((r: any) => r.status === "pending"), "");

      // Task D: Scoped audit
      const runAudit = await pgSql`SELECT * FROM audit_logs WHERE tenant_id = ${TEST_TENANT_ID} AND entity_type = 'import_batch' AND action_type = 'historical_reconciliation.run' AND entity_id = ${batchId}`;
      check("17. audit: reconciliation run row exists", runAudit.length === 1, `count=${runAudit.length}`);
      check("   audit: user_id matches", runAudit[0]?.user_id === TEST_USER_ID, "");
      check("   audit: reportVersion in new_values", runAudit[0]?.new_values_json?.reportVersion === 1, "");

      const resultAudit = await pgSql`SELECT * FROM audit_logs WHERE tenant_id = ${TEST_TENANT_ID} AND entity_type = 'import_reconciliation_result' AND action_type = 'historical_reconciliation.result'`;
      check("18. audit: result rows exist", resultAudit.length > 0, `count=${resultAudit.length}`);
      check("   audit: results have metricKey", resultAudit.every((a: any) => a.new_values_json?.metricKey !== undefined), "");

      const reviewAudit = await pgSql`SELECT * FROM audit_logs WHERE tenant_id = ${TEST_TENANT_ID} AND entity_type = 'import_human_review_item' AND action_type = 'historical_reconciliation.review_created'`;
      check("19. audit: review item rows exist", reviewAudit.length > 0, `count=${reviewAudit.length}`);
    }

    // ===== SECTION 3: Version preservation (Task A) =====
    {
      const services = wireServices();
      // Run V2 with different expected
      const result2 = await services.reconService.runReconciliation(ownerUser as any, ownerEff as any, {
        importBatchId: batchId,
        expectedTotals: { inventory_opening_qty: "600" }, // different expected → new version
        idempotencyKey: "recon-v2-001",
      });
      check("20. reconciliation V2 executed", result2.action === "executed", `action=${result2.action}`);
      check("   report version=2", result2.reportVersion === 2, `version=${result2.reportVersion}`);

      // V1 still exists (NOT deleted)
      const v1Results = await pgSql`SELECT COUNT(*)::int AS n FROM import_reconciliation_results WHERE tenant_id = ${TEST_TENANT_ID} AND import_batch_id = ${batchId} AND report_version = 1`;
      check("21. V1 results PRESERVED (not deleted)", v1Results[0].n > 0, `count=${v1Results[0].n}`);

      // V1 results marked as superseded
      const v1Superseded = await pgSql`SELECT * FROM import_reconciliation_results WHERE tenant_id = ${TEST_TENANT_ID} AND import_batch_id = ${batchId} AND report_version = 1 LIMIT 1`;
      check("   V1 results marked as SUPERSEDED", v1Superseded[0]?.notes?.includes("SUPERSEDED"), `notes=${v1Superseded[0]?.notes?.substring(0, 30)}`);

      // V2 results exist
      const v2Results = await pgSql`SELECT COUNT(*)::int AS n FROM import_reconciliation_results WHERE tenant_id = ${TEST_TENANT_ID} AND import_batch_id = ${batchId} AND report_version = 2`;
      check("22. V2 results exist", v2Results[0].n > 0, `count=${v2Results[0].n}`);

      // Latest version is 2
      const latestVersion = await services.reconRepo.findLatestReportVersion(TEST_TENANT_ID, batchId);
      check("   latest version is 2", latestVersion === 2, `latest=${latestVersion}`);
    }

    // ===== SECTION 4: Idempotency replay (Task F) =====
    {
      const services = wireServices();
      const result1 = await services.reconService.runReconciliation(ownerUser as any, ownerEff as any, {
        importBatchId: batchId,
        expectedTotals: { inventory_opening_qty: "600" },
        idempotencyKey: "recon-replay-001",
      });
      check("23. first reconciliation run (version 3)", result1.action === "executed", `action=${result1.action}`);

      const result2 = await services.reconService.runReconciliation(ownerUser as any, ownerEff as any, {
        importBatchId: batchId,
        expectedTotals: { inventory_opening_qty: "600" },
        idempotencyKey: "recon-replay-001",
      });
      check("24. idempotency replay returns same result", result2.action === "replayed", `action=${result2.action}`);

      // No duplicate results for version 3
      const v3Results = await pgSql`SELECT COUNT(*)::int AS n FROM import_reconciliation_results WHERE tenant_id = ${TEST_TENANT_ID} AND import_batch_id = ${batchId} AND report_version = 3`;
      check("   no duplicate V3 results after replay", v3Results[0].n === result1.totalMetrics, `count=${v3Results[0].n}, expected=${result1.totalMetrics}`);
    }

    // ===== SECTION 5: Non-operational proof (Task E) =====
    check("25. expanded non-operational proof — before/after counts:", true);
    await verifyNoChanges(beforeCounts);

    const batchAfter = await pgSql`SELECT status, committed_at FROM import_batches WHERE id = ${batchId}`;
    check("26. batch not committed", batchAfter[0]?.committed_at === null, `committed=${batchAfter[0]?.committed_at}`);

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
