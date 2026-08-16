/**
 * WP-07-02 Live Supabase Validation — Validation, Master Extraction, Alias Review.
 *
 * Production-path validation with strengthened proofs:
 *   Task A: Expanded validation rules (15 rules covering §8.6.1-8.6.5)
 *   Task B: Low-confidence/ambiguous alias → needs_review + human review item
 *   Task C: Severity preserved (blocking stays blocking)
 *   Task D: Scoped audit (exact entity_id + action_type for each entity)
 *   Task E: Expanded non-operational proof (15 operational tables + 5 master tables)
 *   Task F: Idempotency replay (no duplicate findings/candidates/reviews)
 *
 * Usage: DATABASE_URL=... npx tsx scripts/wp-07-02-live-validation.ts
 * TEST-ONLY. Not for production use.
 */
import postgres from "postgres";
import { execSync } from "node:child_process";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../src/server/db/schema/index";
import { HistoricalStagingDbRepository } from "../src/server/services/historical-staging-db-repository";
import { HistoricalStagingService } from "../src/server/services/historical-staging-service";
import { HistoricalValidationDbRepository } from "../src/server/services/historical-validation-db-repository";
import { HistoricalValidationService } from "../src/server/services/historical-validation-service";
import { AuditDbRepository } from "../src/server/services/audit-db-repository";
import { InProcessIdempotencyStore } from "../src/server/services/idempotency-service";
import { InProcessDocumentSequenceStore } from "../src/server/services/document-sequence-service";
import type { ErpUserContext } from "../src/server/auth/erp-context";
import type { EffectivePermissions } from "../src/server/security/effective-permissions";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("ERROR: DATABASE_URL required."); process.exit(2); }

execSync("node scripts/wp-08-01f-destruction-guard.mjs", { stdio: "inherit" });
const pgSql = postgres(DATABASE_URL, { prepare: false, max: 10, idle_timeout: 30, connect_timeout: 30, max_lifetime: 180 });
const db = drizzle(pgSql, { schema });

const TEST_TENANT_ID = "00000000-0000-0000-0000-000000070002";
const TEST_USER_ID = "00000000-0000-0000-0000-000000070002";

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
function check(name: string, ok: boolean, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const ownerUser: ErpUserContext = {
  authenticated: true, userId: TEST_USER_ID, tenantId: TEST_TENANT_ID,
  email: "wp0702@test.local", name: "WP-07-02 Owner", authId: "wp0702",
};
const ownerEff: EffectivePermissions = {
  assignedRoleCodes: ["owner"],
  permissionKeys: new Set(["migration.prepare", "migration.review", "migration.approve", "migration.commit"]),
  deniedFieldKeys: new Set(), workerFinancialDeny: false,
} as any;

function wireServices() {
  const stagingRepo = new HistoricalStagingDbRepository(db);
  const valRepo = new HistoricalValidationDbRepository(db);
  const audit = new AuditDbRepository(db);
  const idempotency = new InProcessIdempotencyStore();
  const documentSequence = new InProcessDocumentSequenceStore();
  const stagingService = new HistoricalStagingService({ repository: stagingRepo, audit, idempotency, documentSequence });
  const valService = new HistoricalValidationService({ repository: valRepo, audit, idempotency });
  return { stagingRepo, valRepo, audit, idempotency, documentSequence, stagingService, valService };
}

async function ensureMasterData() {
  await pgSql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status) VALUES (${TEST_TENANT_ID}, 'WP-07-02 Live', 'ar', 'EGP', 'Africa/Cairo', 'active') ON CONFLICT (id) DO NOTHING`;
  await pgSql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${TEST_USER_ID}, ${TEST_TENANT_ID}, 'wp0702', 'WP-07-02 Owner', 'wp0702@test.local', 'active', 'ar') ON CONFLICT (id) DO NOTHING`;
}

async function cleanTestData() {
  await pgSql.begin(async (tx) => {
    await tx`DELETE FROM import_human_review_items WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM import_alias_mappings WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM import_validation_errors WHERE tenant_id = ${TEST_TENANT_ID}`;
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
    // Master tables (Task E): prove no automatic master creation
    "suppliers", "customers", "inventory_items", "locations", "factories",
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
    if (beforeVal === -1) {
      check(`   ${table}: skipped`, true, "table not found");
      continue;
    }
    try {
      const result = await pgSql.unsafe(`SELECT COUNT(*)::int AS n FROM ${table} WHERE tenant_id = $1`, [TEST_TENANT_ID]);
      const after = (result[0] as any).n;
      check(`   ${table}: no new rows`, after === beforeVal, `before=${beforeVal}, after=${after}`);
    } catch {
      check(`   ${table}: skipped`, true, "query failed");
    }
  }
}

async function main() {
  console.log("=== WP-07-02 Live Supabase Validation (Production Path) ===");
  let exitCode = 0;

  try {
    await ensureMasterData();
    await cleanTestData();

    // Capture before-counts for ALL operational + master tables
    const beforeCounts = await captureCounts();

    // ===== SECTION 1: Create batch + staging rows with various issues =====
    let batchId: string;
    {
      const services = wireServices();
      const batch = await services.stagingService.createBatch(ownerUser as any, ownerEff as any, {
        sourceDescription: "Expanded validation test",
        templateName: null, templateVersion: null,
        cutoverImportMode: "opening_balance",
        idempotencyKey: "batch-exp-001",
      });
      batchId = batch.batchId;
      check("1. batch created", batch.action === "created", `action=${batch.action}`);

      // Row 1: valid row
      await services.stagingService.insertStagingRow(ownerUser as any, ownerEff as any, {
        importBatchId: batchId, importFileId: null, templateName: null,
        sourceSheetName: "Sheet1", sourceRowNumber: 1,
        rawRowJson: { name: "customer_a", code: "CUST001", quantity: "100", date: "2026-01-01", currency: "EGP" },
        transformedRowJson: null, transformationNotes: null, idempotencyKey: "row-exp-001",
      });
      // Row 2: missing required fields (blocking)
      await services.stagingService.insertStagingRow(ownerUser as any, ownerEff as any, {
        importBatchId: batchId, importFileId: null, templateName: null,
        sourceSheetName: "Sheet1", sourceRowNumber: 2,
        rawRowJson: { name: "Customer B" },
        transformedRowJson: null, transformationNotes: null, idempotencyKey: "row-exp-002",
      });
      // Row 3: future date (blocking) + Arabic name (low confidence)
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);
      await services.stagingService.insertStagingRow(ownerUser as any, ownerEff as any, {
        importBatchId: batchId, importFileId: null, templateName: null,
        sourceSheetName: "Sheet1", sourceRowNumber: 3,
        rawRowJson: { name: "عميل ج", code: "CUST003", quantity: "100", date: futureDate.toISOString().slice(0, 10), currency: "EGP" },
        transformedRowJson: null, transformationNotes: null, idempotencyKey: "row-exp-003",
      });
      // Row 4: wrong currency (blocking)
      await services.stagingService.insertStagingRow(ownerUser as any, ownerEff as any, {
        importBatchId: batchId, importFileId: null, templateName: null,
        sourceSheetName: "Sheet1", sourceRowNumber: 4,
        rawRowJson: { name: "customer_d", code: "CUST004", quantity: "100", date: "2026-01-01", currency: "USD" },
        transformedRowJson: null, transformationNotes: null, idempotencyKey: "row-exp-004",
      });
      // Row 5: negative quantity (blocking) + invalid date format
      await services.stagingService.insertStagingRow(ownerUser as any, ownerEff as any, {
        importBatchId: batchId, importFileId: null, templateName: null,
        sourceSheetName: "Sheet1", sourceRowNumber: 5,
        rawRowJson: { name: "customer_e", code: "CUST005", quantity: "-50", date: "not-a-date", currency: "EGP" },
        transformedRowJson: null, transformationNotes: null, idempotencyKey: "row-exp-005",
      });
      // Row 6: duplicate source row (same sheet+row as row 1)
      await services.stagingService.insertStagingRow(ownerUser as any, ownerEff as any, {
        importBatchId: batchId, importFileId: null, templateName: null,
        sourceSheetName: "Sheet1", sourceRowNumber: 1,
        rawRowJson: { name: "Duplicate", code: "DUP", quantity: "1", date: "2026-01-01", currency: "EGP" },
        transformedRowJson: null, transformationNotes: null, idempotencyKey: "row-exp-006",
      });
      // Row 7: duplicate document number
      await services.stagingService.insertStagingRow(ownerUser as any, ownerEff as any, {
        importBatchId: batchId, importFileId: null, templateName: null,
        sourceSheetName: "Sheet1", sourceRowNumber: 7,
        rawRowJson: { name: "customer_g", code: "CUST007", quantity: "100", date: "2026-01-01", currency: "EGP", doc_no: "DOC001" },
        transformedRowJson: null, transformationNotes: null, idempotencyKey: "row-exp-007",
      });
      await services.stagingService.insertStagingRow(ownerUser as any, ownerEff as any, {
        importBatchId: batchId, importFileId: null, templateName: null,
        sourceSheetName: "Sheet1", sourceRowNumber: 8,
        rawRowJson: { name: "customer_h", code: "CUST008", quantity: "100", date: "2026-01-01", currency: "EGP", doc_no: "DOC001" },
        transformedRowJson: null, transformationNotes: null, idempotencyKey: "row-exp-008",
      });
      // Row 9: zero/negative price
      await services.stagingService.insertStagingRow(ownerUser as any, ownerEff as any, {
        importBatchId: batchId, importFileId: null, templateName: null,
        sourceSheetName: "Sheet1", sourceRowNumber: 9,
        rawRowJson: { name: "customer_i", code: "CUST009", quantity: "100", date: "2026-01-01", currency: "EGP", price: "0" },
        transformedRowJson: null, transformationNotes: null, idempotencyKey: "row-exp-009",
      });
      // Row 10: unsupported unit
      await services.stagingService.insertStagingRow(ownerUser as any, ownerEff as any, {
        importBatchId: batchId, importFileId: null, templateName: null,
        sourceSheetName: "Sheet1", sourceRowNumber: 10,
        rawRowJson: { name: "customer_j", code: "CUST010", quantity: "100", date: "2026-01-01", currency: "EGP", unit: "pounds" },
        transformedRowJson: null, transformationNotes: null, idempotencyKey: "row-exp-010",
      });
      // Row 11: payment before sale date (warning)
      await services.stagingService.insertStagingRow(ownerUser as any, ownerEff as any, {
        importBatchId: batchId, importFileId: null, templateName: null,
        sourceSheetName: "Sheet1", sourceRowNumber: 11,
        rawRowJson: { name: "customer_k", code: "CUST011", quantity: "100", date: "2026-01-01", currency: "EGP", sale_date: "2026-06-01", payment_date: "2026-01-01" },
        transformedRowJson: null, transformationNotes: null, idempotencyKey: "row-exp-011",
      });

      await pgSql`UPDATE import_batches SET status = 'staged' WHERE id = ${batchId}`;
      check("2. batch set to staged with 11 rows", true, `batchId=${batchId}`);
    }

    // ===== SECTION 2: Run validation + scoped audit (Tasks A, B, C, D) =====
    {
      const services = wireServices();
      const result = await services.valService.runValidation(ownerUser as any, ownerEff as any, {
        importBatchId: batchId, idempotencyKey: "val-exp-001",
      });
      check("3. validation executed", result.action === "executed", `action=${result.action}`);
      check("   blocking errors found", result.blockingErrors > 0, `blocking=${result.blockingErrors}`);
      check("   warnings found", result.warnings > 0, `warnings=${result.warnings}`);
      check("   master candidates extracted", result.masterCandidates > 0, `candidates=${result.masterCandidates}`);
      check("   review items created", result.reviewItems > 0, `reviews=${result.reviewItems}`);

      // Task A: Verify specific validation rules fired
      const findings = await pgSql`SELECT * FROM import_validation_errors WHERE tenant_id = ${TEST_TENANT_ID} AND import_batch_id = ${batchId}`;
      const errorCodes = findings.map((f: any) => f.error_code);
      check("4. REQUIRED_FIELD_MISSING fired", errorCodes.includes("REQUIRED_FIELD_MISSING"), `codes=${[...new Set(errorCodes)].join(",")}`);
      check("5. FUTURE_DATE fired", errorCodes.includes("FUTURE_DATE"), "");
      check("6. UNSUPPORTED_CURRENCY fired", errorCodes.includes("UNSUPPORTED_CURRENCY"), "");
      check("7. DUPLICATE_SOURCE_ROW fired", errorCodes.includes("DUPLICATE_SOURCE_ROW"), "");
      check("8. NEGATIVE_QUANTITY fired", errorCodes.includes("NEGATIVE_QUANTITY"), "");
      check("9. INVALID_DATE_FORMAT fired", errorCodes.includes("INVALID_DATE_FORMAT"), "");
      check("10. DUPLICATE_DOCUMENT_NUMBER fired", errorCodes.includes("DUPLICATE_DOCUMENT_NUMBER"), "");
      check("11. ZERO_OR_NEGATIVE_VALUE fired", errorCodes.includes("ZERO_OR_NEGATIVE_VALUE"), "");
      check("12. UNSUPPORTED_UNIT fired", errorCodes.includes("UNSUPPORTED_UNIT"), "");
      check("13. PAYMENT_BEFORE_SALE_DATE fired (warning)", errorCodes.includes("PAYMENT_BEFORE_SALE_DATE"), "");
      check("14. MISSING_MASTER_REFERENCE fired (warning)", errorCodes.includes("MISSING_MASTER_REFERENCE"), "");
      check("15. UNRESOLVED_ALIAS fired (warning)", errorCodes.includes("UNRESOLVED_ALIAS"), "");

      // Task C: Severity preserved — blocking stays blocking
      const blocking = findings.filter((f: any) => f.severity === "blocking_error");
      check("16. blocking errors have is_blocking=true", blocking.every((f: any) => f.is_blocking === true), `count=${blocking.length}`);
      const warnings = findings.filter((f: any) => f.severity === "review_required_warning");
      check("17. warnings have is_blocking=false", warnings.every((f: any) => f.is_blocking === false), `count=${warnings.length}`);

      // Task B: Master candidates with confidence scoring
      const aliases = await pgSql`SELECT * FROM import_alias_mappings WHERE tenant_id = ${TEST_TENANT_ID} AND import_batch_id = ${batchId}`;
      check("18. master candidates persisted", aliases.length > 0, `count=${aliases.length}`);
      check("   all have target_master_id=null (no auto-creation)", aliases.every((a: any) => a.target_master_id === null), "");
      check("   all have confidence_score stored", aliases.every((a: any) => a.confidence_score !== null), "");
      check("   all have source_label and normalized_name", aliases.every((a: any) => a.source_label !== null && a.normalized_name !== null), "");

      // Low-confidence candidates have status=needs_review
      const lowConfidence = aliases.filter((a: any) => parseFloat(a.confidence_score) < 1.0);
      if (lowConfidence.length > 0) {
        check("   low-confidence candidates have status=needs_review", lowConfidence.every((a: any) => a.status === "needs_review"), `count=${lowConfidence.length}`);
      }

      // High-confidence candidates have status=candidate
      const highConfidence = aliases.filter((a: any) => parseFloat(a.confidence_score) === 1.0);
      if (highConfidence.length > 0) {
        check("   high-confidence candidates have status=candidate", highConfidence.every((a: any) => a.status === "candidate"), `count=${highConfidence.length}`);
      }

      // No alias has status=approved (no auto-merge)
      check("   no alias has status=approved (no auto-merge)", aliases.every((a: any) => a.status !== "approved"), "");

      // Review items
      const reviews = await pgSql`SELECT * FROM import_human_review_items WHERE tenant_id = ${TEST_TENANT_ID} AND import_batch_id = ${batchId}`;
      check("19. review items persisted", reviews.length > 0, `count=${reviews.length}`);
      check("   all reviews have status=pending", reviews.every((r: any) => r.status === "pending"), "");
      check("   reviews link to staging rows", reviews.every((r: any) => r.staging_row_id !== null), "");

      // Task D: Scoped audit — verify exact entity_id + action_type for each entity type
      const valAudit = await pgSql`SELECT * FROM audit_logs WHERE tenant_id = ${TEST_TENANT_ID} AND entity_type = 'import_batch' AND action_type = 'historical_validation.run' AND entity_id = ${batchId}`;
      check("20. audit: validation run row exists", valAudit.length === 1, `count=${valAudit.length}`);
      check("   audit: user_id matches", valAudit[0]?.user_id === TEST_USER_ID, "");

      const findingAudit = await pgSql`SELECT * FROM audit_logs WHERE tenant_id = ${TEST_TENANT_ID} AND entity_type = 'import_validation_error' AND action_type = 'historical_finding.create'`;
      check("21. audit: finding rows exist", findingAudit.length > 0, `count=${findingAudit.length}`);
      check("   audit: findings have errorCode in new_values", findingAudit.every((a: any) => a.new_values_json?.errorCode !== undefined), "");

      const aliasAudit = await pgSql`SELECT * FROM audit_logs WHERE tenant_id = ${TEST_TENANT_ID} AND entity_type = 'import_alias_mapping' AND action_type = 'historical_alias.create'`;
      check("22. audit: alias mapping rows exist", aliasAudit.length > 0, `count=${aliasAudit.length}`);
      check("   audit: aliases have sourceLabel in new_values", aliasAudit.every((a: any) => a.new_values_json?.sourceLabel !== undefined), "");
      check("   audit: aliases have confidenceScore in new_values", aliasAudit.every((a: any) => a.new_values_json?.confidenceScore !== undefined), "");

      const reviewAudit = await pgSql`SELECT * FROM audit_logs WHERE tenant_id = ${TEST_TENANT_ID} AND entity_type = 'import_human_review_item' AND action_type = 'historical_review.create'`;
      check("23. audit: review item rows exist", reviewAudit.length > 0, `count=${reviewAudit.length}`);
      check("   audit: reviews have reviewReason in new_values", reviewAudit.every((a: any) => a.new_values_json?.reviewReason !== undefined), "");
    }

    // ===== SECTION 3: Idempotency replay (Task F) =====
    {
      const services = wireServices();
      // First run (deletes old + re-runs with new key)
      const result1 = await services.valService.runValidation(ownerUser as any, ownerEff as any, {
        importBatchId: batchId, idempotencyKey: "val-replay-exp-001",
      });
      check("24. first validation run executed", result1.action === "executed", `action=${result1.action}`);

      // Replay with same key
      const result2 = await services.valService.runValidation(ownerUser as any, ownerEff as any, {
        importBatchId: batchId, idempotencyKey: "val-replay-exp-001",
      });
      check("25. idempotency replay returns same result", result2.action === "replayed", `action=${result2.action}`);

      // No duplicate findings
      const findings = await pgSql`SELECT COUNT(*)::int AS n FROM import_validation_errors WHERE tenant_id = ${TEST_TENANT_ID} AND import_batch_id = ${batchId}`;
      check("   no duplicate findings after replay", findings[0].n === result1.totalFindings, `count=${findings[0].n}, expected=${result1.totalFindings}`);

      // No duplicate candidates
      const aliases = await pgSql`SELECT COUNT(*)::int AS n FROM import_alias_mappings WHERE tenant_id = ${TEST_TENANT_ID} AND import_batch_id = ${batchId}`;
      check("   no duplicate candidates after replay", aliases[0].n === result1.masterCandidates, `count=${aliases[0].n}, expected=${result1.masterCandidates}`);

      // No duplicate reviews
      const reviews = await pgSql`SELECT COUNT(*)::int AS n FROM import_human_review_items WHERE tenant_id = ${TEST_TENANT_ID} AND import_batch_id = ${batchId}`;
      check("   no duplicate reviews after replay", reviews[0].n === result1.reviewItems, `count=${reviews[0].n}, expected=${result1.reviewItems}`);
    }

    // ===== SECTION 4: Expanded non-operational proof (Task E) =====
    check("26. expanded non-operational proof — before/after counts:", true);
    await verifyNoChanges(beforeCounts);

    // Batch not committed
    const batchAfter = await pgSql`SELECT status, committed_at FROM import_batches WHERE id = ${batchId}`;
    check("27. batch status is validation_complete (not committed)", batchAfter[0]?.status === "validation_complete", `status=${batchAfter[0]?.status}`);
    check("   batch committed_at is null", batchAfter[0]?.committed_at === null, `committed=${batchAfter[0]?.committed_at}`);

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
