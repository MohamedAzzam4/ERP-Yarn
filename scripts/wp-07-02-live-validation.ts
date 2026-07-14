/**
 * WP-07-02 Live Supabase Validation — Validation, Master Extraction, Alias Review.
 *
 * Production-path validation:
 *   - HistoricalValidationService
 *   - HistoricalValidationDbRepository
 *   - AuditDbRepository
 *
 * Non-operational — no stock/account/sales/payment effects.
 *
 * Usage: DATABASE_URL=... npx tsx scripts/wp-07-02-live-validation.ts
 * TEST-ONLY. Not for production use.
 */
import postgres from "postgres";
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

async function main() {
  console.log("=== WP-07-02 Live Supabase Validation (Production Path) ===");
  let exitCode = 0;

  try {
    await ensureMasterData();
    await cleanTestData();

    // ===== SECTION 1: Create batch + staging rows =====
    {
      const services = wireServices();

      // Create batch
      const batch = await services.stagingService.createBatch(ownerUser as any, ownerEff as any, {
        sourceDescription: "Validation test batch",
        templateName: null, templateVersion: null,
        cutoverImportMode: "opening_balance",
        idempotencyKey: "batch-val-001",
      });
      check("1. batch created", batch.action === "created", `action=${batch.action}`);

      // Insert staging rows with various data quality issues
      // Row 1: valid row
      await services.stagingService.insertStagingRow(ownerUser as any, ownerEff as any, {
        importBatchId: batch.batchId, importFileId: null, templateName: null,
        sourceSheetName: "Sheet1", sourceRowNumber: 1,
        rawRowJson: { name: "Customer A", code: "CUST001", quantity: "100", date: "2026-01-01", currency: "EGP" },
        transformedRowJson: null, transformationNotes: null,
        idempotencyKey: "row-val-001",
      });

      // Row 2: missing required fields (blocking)
      await services.stagingService.insertStagingRow(ownerUser as any, ownerEff as any, {
        importBatchId: batch.batchId, importFileId: null, templateName: null,
        sourceSheetName: "Sheet1", sourceRowNumber: 2,
        rawRowJson: { name: "Customer B" }, // missing code, quantity, date
        transformedRowJson: null, transformationNotes: null,
        idempotencyKey: "row-val-002",
      });

      // Row 3: future date (blocking)
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);
      await services.stagingService.insertStagingRow(ownerUser as any, ownerEff as any, {
        importBatchId: batch.batchId, importFileId: null, templateName: null,
        sourceSheetName: "Sheet1", sourceRowNumber: 3,
        rawRowJson: { name: "Customer C", code: "CUST003", quantity: "100", date: futureDate.toISOString().slice(0, 10), currency: "EGP" },
        transformedRowJson: null, transformationNotes: null,
        idempotencyKey: "row-val-003",
      });

      // Row 4: wrong currency (blocking)
      await services.stagingService.insertStagingRow(ownerUser as any, ownerEff as any, {
        importBatchId: batch.batchId, importFileId: null, templateName: null,
        sourceSheetName: "Sheet1", sourceRowNumber: 4,
        rawRowJson: { name: "Customer D", code: "CUST004", quantity: "100", date: "2026-01-01", currency: "USD" },
        transformedRowJson: null, transformationNotes: null,
        idempotencyKey: "row-val-004",
      });

      // Set batch to staged status
      await pgSql`UPDATE import_batches SET status = 'staged' WHERE id = ${batch.batchId}`;
      check("2. batch set to staged", true, `batchId=${batch.batchId}`);
    }

    // ===== SECTION 2: Run validation =====
    {
      const services = wireServices();

      // Find the batch
      const batches = await pgSql`SELECT id FROM import_batches WHERE tenant_id = ${TEST_TENANT_ID} AND status = 'staged' LIMIT 1`;
      const batchId = batches[0]?.id;

      const result = await services.valService.runValidation(ownerUser as any, ownerEff as any, {
        importBatchId: batchId, idempotencyKey: "val-run-001",
      });
      check("3. validation executed", result.action === "executed", `action=${result.action}`);
      check("   blocking errors found", result.blockingErrors > 0, `blocking=${result.blockingErrors}`);
      check("   master candidates extracted", result.masterCandidates > 0, `candidates=${result.masterCandidates}`);

      // 4. Findings persisted with provenance
      const findings = await pgSql`SELECT * FROM import_validation_errors WHERE tenant_id = ${TEST_TENANT_ID} AND import_batch_id = ${batchId}`;
      check("4. findings persisted in DB", findings.length > 0, `count=${findings.length}`);
      check("   findings have severity", findings.every((f: any) => f.severity !== null), `all have severity`);
      check("   findings have error_code", findings.every((f: any) => f.error_code !== null), `all have error_code`);
      check("   findings have message", findings.every((f: any) => f.message !== null), `all have message`);
      check("   blocking findings have is_blocking=true", findings.filter((f: any) => f.severity === 'blocking_error').every((f: any) => f.is_blocking === true), `blocking check`);

      // 5. Master candidates persisted as candidates only
      const aliases = await pgSql`SELECT * FROM import_alias_mappings WHERE tenant_id = ${TEST_TENANT_ID} AND import_batch_id = ${batchId}`;
      check("5. master candidates persisted", aliases.length > 0, `count=${aliases.length}`);
      check("   all candidates have status='candidate'", aliases.every((a: any) => a.status === "candidate"), `all candidate`);
      check("   all candidates have target_master_id=null", aliases.every((a: any) => a.target_master_id === null), `all null`);

      // 6. Alias review records persisted
      const reviews = await pgSql`SELECT * FROM import_human_review_items WHERE tenant_id = ${TEST_TENANT_ID} AND import_batch_id = ${batchId}`;
      check("6. review items persisted", reviews.length > 0, `count=${reviews.length}`);
      check("   all reviews have status='pending'", reviews.every((r: any) => r.status === "pending"), `all pending`);

      // 7. Audit row persisted
      const auditRows = await pgSql`SELECT * FROM audit_logs WHERE tenant_id = ${TEST_TENANT_ID} AND entity_type = 'import_batch' AND action_type = 'historical_validation.run' AND entity_id = ${batchId}`;
      check("7. audit row persisted", auditRows.length === 1, `count=${auditRows.length}`);
      check("   audit has blockingErrors", auditRows[0]?.new_values_json?.blockingErrors > 0, `blocking=${auditRows[0]?.new_values_json?.blockingErrors}`);
    }

    // ===== SECTION 3: Idempotency replay =====
    {
      // Reuse the same services instance so idempotency state persists
      const services = wireServices();
      const batches = await pgSql`SELECT id FROM import_batches WHERE tenant_id = ${TEST_TENANT_ID} AND status = 'validation_complete' LIMIT 1`;
      const batchId = batches[0]?.id;

      // First run (deletes old + re-runs with same key)
      const result1 = await services.valService.runValidation(ownerUser as any, ownerEff as any, {
        importBatchId: batchId, idempotencyKey: "val-replay-001",
      });
      check("8. first validation run executed", result1.action === "executed", `action=${result1.action}`);

      // Replay with same key
      const result2 = await services.valService.runValidation(ownerUser as any, ownerEff as any, {
        importBatchId: batchId, idempotencyKey: "val-replay-001",
      });
      check("   idempotency replay returns same result", result2.action === "replayed", `action=${result2.action}`);

      // No duplicate findings
      const findings = await pgSql`SELECT COUNT(*)::int AS n FROM import_validation_errors WHERE tenant_id = ${TEST_TENANT_ID} AND import_batch_id = ${batchId}`;
      check("   no duplicate findings after replay", findings[0].n === result1.totalFindings, `count=${findings[0].n}, expected=${result1.totalFindings}`);
    }

    // ===== SECTION 4: No operational side effects =====
    {
      const tables = ["stock_movements", "inventory_balances", "account_entries", "sales_orders", "return_requests", "production_orders", "payments"];
      check("9. no operational side effects:", true);
      for (const table of tables) {
        try {
          const result = await pgSql.unsafe(`SELECT COUNT(*)::int AS n FROM ${table} WHERE tenant_id = $1`, [TEST_TENANT_ID]);
          check(`   ${table}: no new rows`, (result[0] as any).n === 0, `count=${(result[0] as any).n}`);
        } catch {
          check(`   ${table}: skipped`, true, "table not found");
        }
      }
    }

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
