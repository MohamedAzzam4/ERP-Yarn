/**
 * WP-07-01 Live Supabase Validation — Historical Staging (production path).
 *
 * Production-path validation:
 *   - HistoricalStagingService
 *   - HistoricalStagingDbRepository
 *   - AuditDbRepository
 *
 * Staging is non-operational — no stock/account/sales/payment effects.
 *
 * Usage: DATABASE_URL=... npx tsx scripts/wp-07-01-live-validation.ts
 * TEST-ONLY. Not for production use.
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../src/server/db/schema/index";
import { randomUUID } from "node:crypto";
import { HistoricalStagingDbRepository } from "../src/server/services/historical-staging-db-repository";
import { HistoricalStagingService } from "../src/server/services/historical-staging-service";
import { AuditDbRepository } from "../src/server/services/audit-db-repository";
import { InProcessIdempotencyStore } from "../src/server/services/idempotency-service";
import { InProcessDocumentSequenceStore } from "../src/server/services/document-sequence-service";
import type { ErpUserContext } from "../src/server/auth/erp-context";
import type { EffectivePermissions } from "../src/server/security/effective-permissions";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("ERROR: DATABASE_URL required."); process.exit(2); }

const pgSql = postgres(DATABASE_URL, { prepare: false, max: 10, idle_timeout: 30, connect_timeout: 30, max_lifetime: 180 });
const db = drizzle(pgSql, { schema });

const TEST_TENANT_ID = "00000000-0000-0000-0000-000000070001";
const TEST_USER_ID = "00000000-0000-0000-0000-000000070001";

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
function check(name: string, ok: boolean, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const ownerUser: ErpUserContext = {
  authenticated: true, userId: TEST_USER_ID, tenantId: TEST_TENANT_ID,
  email: "wp0701@test.local", name: "WP-07-01 Owner", authId: "wp0701",
};
const ownerEff: EffectivePermissions = {
  assignedRoleCodes: ["owner"],
  permissionKeys: new Set(["migration.prepare", "migration.review", "migration.approve", "migration.commit"]),
  deniedFieldKeys: new Set(), workerFinancialDeny: false,
} as any;

function wireServices() {
  const repository = new HistoricalStagingDbRepository(db);
  const audit = new AuditDbRepository(db);
  const idempotency = new InProcessIdempotencyStore();
  const documentSequence = new InProcessDocumentSequenceStore();
  const service = new HistoricalStagingService({ repository, audit, idempotency, documentSequence });
  return { repository, audit, idempotency, documentSequence, service };
}

async function ensureMasterData() {
  const r = Date.now().toString(36).slice(-6);
  await pgSql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status) VALUES (${TEST_TENANT_ID}, 'WP-07-01 Live', 'ar', 'EGP', 'Africa/Cairo', 'active') ON CONFLICT (id) DO NOTHING`;
  await pgSql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${TEST_USER_ID}, ${TEST_TENANT_ID}, 'wp0701', 'WP-07-01 Owner', 'wp0701@test.local', 'active', 'ar') ON CONFLICT (id) DO NOTHING`;
}

async function cleanTestData() {
  await pgSql.begin(async (tx) => {
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
  console.log("=== WP-07-01 Live Supabase Validation (Production Path) ===");
  let exitCode = 0;

  try {
    await ensureMasterData();
    await cleanTestData();

    // ===== SECTION 1: Template versioning =====
    {
      const services = wireServices();

      // 1. Create template version
      const tmplResult = await services.service.createTemplateVersion(ownerUser as any, ownerEff as any, {
        templateName: "customers_v1",
        templateVersion: "1.0.0",
        schemaJson: { fields: ["name", "code", "status"] },
        idempotencyKey: "tmpl-live-001",
      });
      check("1. template version created", tmplResult.action === "created", `action=${tmplResult.action}`);

      // 2. Template persisted in DB
      const tmplRows = await pgSql`SELECT * FROM import_template_versions WHERE tenant_id = ${TEST_TENANT_ID} AND template_name = 'customers_v1' AND template_version = '1.0.0'`;
      check("2. template persisted in DB", tmplRows.length === 1, `count=${tmplRows.length}`);
      check("   template is_active=true", tmplRows[0]?.is_active === true, `is_active=${tmplRows[0]?.is_active}`);

      // 3. Cannot overwrite same version
      try {
        await services.service.createTemplateVersion(ownerUser as any, ownerEff as any, {
          templateName: "customers_v1",
          templateVersion: "1.0.0",
          schemaJson: { fields: ["different"] },
          idempotencyKey: "tmpl-live-002",
        });
        check("3. cannot overwrite same template version", false, "should have thrown");
      } catch (e) {
        check("3. cannot overwrite same template version", true, `error=${(e as Error).message.slice(0, 40)}`);
      }

      // 4. New version of same template allowed
      const tmpl2 = await services.service.createTemplateVersion(ownerUser as any, ownerEff as any, {
        templateName: "customers_v1",
        templateVersion: "2.0.0",
        schemaJson: { fields: ["name", "code", "status", "extra"] },
        idempotencyKey: "tmpl-live-003",
      });
      check("4. new template version allowed", tmpl2.action === "created" && tmpl2.templateVersion === "2.0.0", `version=${tmpl2.templateVersion}`);
    }

    // ===== SECTION 2: File registration =====
    await cleanTestData();
    {
      const services = wireServices();

      const batch = await services.service.createBatch(ownerUser as any, ownerEff as any, {
        sourceDescription: "File test batch",
        templateName: null, templateVersion: null,
        cutoverImportMode: "opening_balance",
        idempotencyKey: "batch-file-001",
      });

      // 5. Register file with checksum
      const fileResult = await services.service.registerFile(ownerUser as any, ownerEff as any, {
        importBatchId: batch.batchId,
        originalFileName: "customers.xlsx",
        storagePath: "private://tenant/batch/customers.xlsx",
        fileHash: "sha256:abc123def",
        fileSizeBytes: 1024,
        contentType: "application/vnd.openxmlformats",
        fileType: "source",
        idempotencyKey: "file-live-001",
      });
      check("5. file registered with checksum", fileResult.action === "created", `action=${fileResult.action}`);

      // 6. File persisted in DB
      const fileRows = await pgSql`SELECT * FROM import_files WHERE tenant_id = ${TEST_TENANT_ID} AND file_hash = 'sha256:abc123def'`;
      check("6. file persisted in DB", fileRows.length === 1, `count=${fileRows.length}`);
      check("   file has storage_path", fileRows[0]?.storage_path === "private://tenant/batch/customers.xlsx", `path=${fileRows[0]?.storage_path}`);
      check("   file has checksum", fileRows[0]?.file_hash === "sha256:abc123def", `hash=${fileRows[0]?.file_hash}`);

      // 7. Re-upload with different hash creates new file
      const file2 = await services.service.registerFile(ownerUser as any, ownerEff as any, {
        importBatchId: batch.batchId,
        originalFileName: "customers.xlsx",
        storagePath: "private://tenant/batch/customers-v2.xlsx",
        fileHash: "sha256:different",
        fileSizeBytes: 2048,
        contentType: null,
        fileType: "source",
        idempotencyKey: "file-live-002",
      });
      check("7. re-upload creates new file", file2.fileId !== fileResult.fileId, `different=${file2.fileId !== fileResult.fileId}`);

      // 8. Duplicate hash is idempotent
      const file3 = await services.service.registerFile(ownerUser as any, ownerEff as any, {
        importBatchId: batch.batchId,
        originalFileName: "renamed.xlsx",
        storagePath: "private://renamed.xlsx",
        fileHash: "sha256:abc123def",
        fileSizeBytes: 1024,
        contentType: null,
        fileType: "source",
        idempotencyKey: "file-live-003",
      });
      check("8. duplicate hash returns existing file", file3.fileId === fileResult.fileId, `same=${file3.fileId === fileResult.fileId}`);

      // Only 2 files (not 3)
      const allFiles = await pgSql`SELECT COUNT(*)::int AS n FROM import_files WHERE tenant_id = ${TEST_TENANT_ID} AND import_batch_id = ${batch.batchId}`;
      check("   only 2 files in DB (not 3)", allFiles[0].n === 2, `count=${allFiles[0].n}`);
    }

    // ===== SECTION 3: Staging batch + rows =====
    await cleanTestData();
    {
      const services = wireServices();

      // 9. Create batch
      const batch = await services.service.createBatch(ownerUser as any, ownerEff as any, {
        sourceDescription: "Staging test",
        templateName: "customers_v1",
        templateVersion: "1.0.0",
        cutoverImportMode: "opening_balance",
        idempotencyKey: "batch-staging-001",
      });
      check("9. batch created", batch.action === "created", `action=${batch.action}`);
      check("   batch status is draft", batch.status === "draft", `status=${batch.status}`);

      // 10. Batch persisted
      const batchRows = await pgSql`SELECT * FROM import_batches WHERE tenant_id = ${TEST_TENANT_ID} AND id = ${batch.batchId}`;
      check("10. batch persisted in DB", batchRows.length === 1, `count=${batchRows.length}`);
      check("   batch cutover mode", batchRows[0]?.cutover_import_mode === "opening_balance", `mode=${batchRows[0]?.cutover_import_mode}`);

      // 11. Insert staging rows
      const file = await services.service.registerFile(ownerUser as any, ownerEff as any, {
        importBatchId: batch.batchId,
        originalFileName: "data.xlsx",
        storagePath: "private://data.xlsx",
        fileHash: "sha256:staging",
        fileSizeBytes: 100,
        contentType: null,
        fileType: "source",
        idempotencyKey: "file-staging-001",
      });

      const row1 = await services.service.insertStagingRow(ownerUser as any, ownerEff as any, {
        importBatchId: batch.batchId,
        importFileId: file.fileId,
        templateName: "customers_v1",
        sourceSheetName: "Sheet1",
        sourceRowNumber: 2,
        rawRowJson: { name: "Customer A", code: "CUST001" },
        transformedRowJson: { name: "Customer A", code: "CUST001", status: "active" },
        transformationNotes: null,
        idempotencyKey: "row-staging-001",
      });
      check("11. staging row 1 inserted", row1.action === "created", `action=${row1.action}`);

      const row2 = await services.service.insertStagingRow(ownerUser as any, ownerEff as any, {
        importBatchId: batch.batchId,
        importFileId: file.fileId,
        templateName: "customers_v1",
        sourceSheetName: "Sheet1",
        sourceRowNumber: 3,
        rawRowJson: { name: "Customer B", code: "CUST002" },
        transformedRowJson: { name: "Customer B", code: "CUST002", status: "active" },
        transformationNotes: null,
        idempotencyKey: "row-staging-002",
      });
      check("   staging row 2 inserted", row2.action === "created", `action=${row2.action}`);

      // 12. Staging rows persisted
      const stagingRows = await pgSql`SELECT * FROM import_staging_rows WHERE tenant_id = ${TEST_TENANT_ID} AND import_batch_id = ${batch.batchId} ORDER BY source_row_number`;
      check("12. 2 staging rows persisted", stagingRows.length === 2, `count=${stagingRows.length}`);
      check("   row 1 has source_row_number=2", stagingRows[0]?.source_row_number === 2, `row=${stagingRows[0]?.source_row_number}`);
      check("   row 2 has source_row_number=3", stagingRows[1]?.source_row_number === 3, `row=${stagingRows[1]?.source_row_number}`);
      check("   rows have validation_status=pending", stagingRows[0]?.validation_status === "pending", `status=${stagingRows[0]?.validation_status}`);

      // 13. Batch staged row count updated
      const batchAfter = await pgSql`SELECT staged_row_count FROM import_batches WHERE id = ${batch.batchId}`;
      check("13. batch staged_row_count=2", batchAfter[0]?.staged_row_count === 2, `count=${batchAfter[0]?.staged_row_count}`);

      // 14. Idempotency replay
      const replay = await services.service.insertStagingRow(ownerUser as any, ownerEff as any, {
        importBatchId: batch.batchId,
        importFileId: file.fileId,
        templateName: "customers_v1",
        sourceSheetName: "Sheet1",
        sourceRowNumber: 2,
        rawRowJson: { name: "Customer A", code: "CUST001" },
        transformedRowJson: { name: "Customer A", code: "CUST001", status: "active" },
        transformationNotes: null,
        idempotencyKey: "row-staging-001",
      });
      check("14. idempotency replay returns same row", replay.action === "replayed" && replay.stagingRowId === row1.stagingRowId, `action=${replay.action}`);

      // Still only 2 rows (no duplicate)
      const stagingRowsAfter = await pgSql`SELECT COUNT(*)::int AS n FROM import_staging_rows WHERE tenant_id = ${TEST_TENANT_ID} AND import_batch_id = ${batch.batchId}`;
      check("   still 2 rows after replay", stagingRowsAfter[0].n === 2, `count=${stagingRowsAfter[0].n}`);
    }

    // ===== SECTION 4: No operational side effects =====
    await cleanTestData();
    {
      const services = wireServices();

      const batch = await services.service.createBatch(ownerUser as any, ownerEff as any, {
        sourceDescription: "No side effects",
        templateName: null, templateVersion: null,
        cutoverImportMode: "opening_balance",
        idempotencyKey: "batch-noside-001",
      });

      await services.service.registerFile(ownerUser as any, ownerEff as any, {
        importBatchId: batch.batchId,
        originalFileName: "data.xlsx",
        storagePath: "private://data.xlsx",
        fileHash: "sha256:noside",
        fileSizeBytes: 100,
        contentType: null,
        fileType: "source",
        idempotencyKey: "file-noside-001",
      });

      await services.service.insertStagingRow(ownerUser as any, ownerEff as any, {
        importBatchId: batch.batchId,
        importFileId: null,
        templateName: null,
        sourceSheetName: "Sheet1",
        sourceRowNumber: 1,
        rawRowJson: { qty: "100", price: "50" },
        transformedRowJson: null,
        transformationNotes: null,
        idempotencyKey: "row-noside-001",
      });

      // 15. No stock movements created
      const stockMv = await pgSql`SELECT COUNT(*)::int AS n FROM stock_movements WHERE tenant_id = ${TEST_TENANT_ID} AND source_document_type LIKE 'import%'`;
      check("15. no stock movements from staging", stockMv[0].n === 0, `count=${stockMv[0].n}`);

      // 16. No account entries created
      const acctEntries = await pgSql`SELECT COUNT(*)::int AS n FROM account_entries WHERE tenant_id = ${TEST_TENANT_ID} AND source_document_type LIKE 'import%'`;
      check("16. no account entries from staging", acctEntries[0].n === 0, `count=${acctEntries[0].n}`);

      // 17. No sales orders created
      const salesOrders = await pgSql`SELECT COUNT(*)::int AS n FROM sales_orders WHERE tenant_id = ${TEST_TENANT_ID} AND record_origin::text LIKE '%import%'`;
      check("17. no sales orders from staging", salesOrders[0].n === 0, `count=${salesOrders[0].n}`);

      // 18. Batch not committed
      const batchAfter = await pgSql`SELECT status, committed_at FROM import_batches WHERE id = ${batch.batchId}`;
      check("18. batch status is draft (not committed)", batchAfter[0]?.status === "draft", `status=${batchAfter[0]?.status}`);
      check("   batch committed_at is null", batchAfter[0]?.committed_at === null, `committed=${batchAfter[0]?.committed_at}`);
    }

    // ===== SECTION 5: Audit persistence =====
    await cleanTestData();
    {
      const services = wireServices();

      await services.service.createBatch(ownerUser as any, ownerEff as any, {
        sourceDescription: "Audit test",
        templateName: null, templateVersion: null,
        cutoverImportMode: "opening_balance",
        idempotencyKey: "batch-audit-live-001",
      });

      // 19. Audit rows persisted (append-only — count >= 1)
      const auditRows = await pgSql`SELECT * FROM audit_logs WHERE tenant_id = ${TEST_TENANT_ID} AND entity_type = 'import_batch' AND action_type = 'historical_batch.create' ORDER BY created_at DESC LIMIT 1`;
      check("19. audit row persisted for batch creation", auditRows.length >= 1, `count=${auditRows.length}`);
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
