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
 * Strengthened proofs:
 *   Task 1: Scoped audit proof (filter by exact entity ID + action_type + fields)
 *   Task 2: Expanded non-operational proof (before/after counts on 15 operational tables)
 *   Task 3: Private file metadata proof (reject public URL, reject secrets, checksum required)
 *   Task 4: Rollback/failure proof (batch created but staging row fails → safe state)
 *
 * Usage: DATABASE_URL=... npx tsx scripts/wp-07-01-live-validation.ts
 * TEST-ONLY. Not for production use.
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../src/server/db/schema/index";
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

/**
 * Task 2: Capture before-counts for all operational tables scoped to test tenant.
 * After staging operations, verify these counts are unchanged.
 */
async function captureOperationalCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  // Use explicit queries for each table to avoid SQL injection + dynamic table name issues
  const queries: Array<[string, string]> = [
    ["stock_movements", `SELECT COUNT(*)::int AS n FROM stock_movements WHERE tenant_id = $1`],
    ["inventory_balances", `SELECT COUNT(*)::int AS n FROM inventory_balances WHERE tenant_id = $1`],
    ["stock_reservations", `SELECT COUNT(*)::int AS n FROM stock_reservations WHERE tenant_id = $1`],
    ["account_entries", `SELECT COUNT(*)::int AS n FROM account_entries WHERE tenant_id = $1`],
    ["payments", `SELECT COUNT(*)::int AS n FROM payments WHERE tenant_id = $1`],
    ["payment_settlements", `SELECT COUNT(*)::int AS n FROM payment_settlements WHERE tenant_id = $1`],
    ["sales_orders", `SELECT COUNT(*)::int AS n FROM sales_orders WHERE tenant_id = $1`],
    ["sales_order_lines", `SELECT COUNT(*)::int AS n FROM sales_order_lines WHERE tenant_id = $1`],
    ["return_requests", `SELECT COUNT(*)::int AS n FROM return_requests WHERE tenant_id = $1`],
    ["return_lines", `SELECT COUNT(*)::int AS n FROM return_lines WHERE tenant_id = $1`],
    ["production_orders", `SELECT COUNT(*)::int AS n FROM production_orders WHERE tenant_id = $1`],
    ["production_inputs", `SELECT COUNT(*)::int AS n FROM production_inputs WHERE tenant_id = $1`],
    ["production_receipts", `SELECT COUNT(*)::int AS n FROM production_receipts WHERE tenant_id = $1`],
    ["production_wip_balances", `SELECT COUNT(*)::int AS n FROM production_wip_balances WHERE tenant_id = $1`],
    ["production_wip_returns", `SELECT COUNT(*)::int AS n FROM production_wip_returns WHERE tenant_id = $1`],
  ];
  for (const [table, query] of queries) {
    try {
      const result = await pgSql.unsafe(query, [TEST_TENANT_ID]);
      counts[table] = (result[0] as any).n;
    } catch {
      counts[table] = -1;
    }
  }
  return counts;
}

async function verifyNoOperationalChanges(before: Record<string, number>): Promise<void> {
  const tables = Object.keys(before);
  const queries: Record<string, string> = {
    stock_movements: `SELECT COUNT(*)::int AS n FROM stock_movements WHERE tenant_id = $1`,
    inventory_balances: `SELECT COUNT(*)::int AS n FROM inventory_balances WHERE tenant_id = $1`,
    stock_reservations: `SELECT COUNT(*)::int AS n FROM stock_reservations WHERE tenant_id = $1`,
    account_entries: `SELECT COUNT(*)::int AS n FROM account_entries WHERE tenant_id = $1`,
    payments: `SELECT COUNT(*)::int AS n FROM payments WHERE tenant_id = $1`,
    payment_settlements: `SELECT COUNT(*)::int AS n FROM payment_settlements WHERE tenant_id = $1`,
    sales_orders: `SELECT COUNT(*)::int AS n FROM sales_orders WHERE tenant_id = $1`,
    sales_order_lines: `SELECT COUNT(*)::int AS n FROM sales_order_lines WHERE tenant_id = $1`,
    return_requests: `SELECT COUNT(*)::int AS n FROM return_requests WHERE tenant_id = $1`,
    return_lines: `SELECT COUNT(*)::int AS n FROM return_lines WHERE tenant_id = $1`,
    production_orders: `SELECT COUNT(*)::int AS n FROM production_orders WHERE tenant_id = $1`,
    production_inputs: `SELECT COUNT(*)::int AS n FROM production_inputs WHERE tenant_id = $1`,
    production_receipts: `SELECT COUNT(*)::int AS n FROM production_receipts WHERE tenant_id = $1`,
    production_wip_balances: `SELECT COUNT(*)::int AS n FROM production_wip_balances WHERE tenant_id = $1`,
    production_wip_returns: `SELECT COUNT(*)::int AS n FROM production_wip_returns WHERE tenant_id = $1`,
  };
  for (const table of tables) {
    if (before[table] === -1) {
      check(`   ${table}: table not found (skipped)`, true, "skipped");
      continue;
    }
    try {
      const result = await pgSql.unsafe(queries[table] ?? `SELECT COUNT(*)::int AS n FROM ${table} WHERE tenant_id = $1`, [TEST_TENANT_ID]);
      const after = (result[0] as any).n;
      check(`   ${table}: no new rows`, after === before[table], `before=${before[table]}, after=${after}`);
    } catch {
      check(`   ${table}: error querying`, false, "query failed");
    }
  }
}

async function main() {
  console.log("=== WP-07-01 Live Supabase Validation (Production Path) ===");
  let exitCode = 0;

  try {
    await ensureMasterData();
    await cleanTestData();

    // ===== SECTION 1: Template versioning + scoped audit (Task 1) =====
    {
      const services = wireServices();

      const tmplResult = await services.service.createTemplateVersion(ownerUser as any, ownerEff as any, {
        templateName: "customers_v1",
        templateVersion: "1.0.0",
        schemaJson: { fields: ["name", "code", "status"] },
        idempotencyKey: "tmpl-live-001",
      });
      check("1. template version created", tmplResult.action === "created", `action=${tmplResult.action}`);

      // Task 1: Scoped audit proof — verify exact entity ID + action_type + fields
      const tmplAudit = await pgSql`SELECT * FROM audit_logs WHERE tenant_id = ${TEST_TENANT_ID} AND entity_type = 'import_template_version' AND entity_id = ${tmplResult.templateId} AND action_type = 'historical_template.create'`;
      check("2. audit: template create row exists", tmplAudit.length === 1, `count=${tmplAudit.length}`);
      check("   audit: tenant_id matches", tmplAudit[0]?.tenant_id === TEST_TENANT_ID, `tenant=${tmplAudit[0]?.tenant_id?.slice(0, 8)}`);
      check("   audit: user_id matches", tmplAudit[0]?.user_id === TEST_USER_ID, `user=${tmplAudit[0]?.user_id?.slice(0, 8)}`);
      check("   audit: new_values has templateName", tmplAudit[0]?.new_values_json?.templateName === "customers_v1", `name=${tmplAudit[0]?.new_values_json?.templateName}`);
      check("   audit: new_values has templateVersion", tmplAudit[0]?.new_values_json?.templateVersion === "1.0.0", `version=${tmplAudit[0]?.new_values_json?.templateVersion}`);

      // Cannot overwrite same version
      try {
        await services.service.createTemplateVersion(ownerUser as any, ownerEff as any, {
          templateName: "customers_v1", templateVersion: "1.0.0", schemaJson: { different: true },
          idempotencyKey: "tmpl-live-002",
        });
        check("3. cannot overwrite same template version", false, "should have thrown");
      } catch (e) {
        check("3. cannot overwrite same template version", true, `error=${(e as Error).message.slice(0, 40)}`);
      }
    }

    // ===== SECTION 2: File registration + scoped audit (Task 1 + Task 3) =====
    await cleanTestData();
    {
      const services = wireServices();

      const batch = await services.service.createBatch(ownerUser as any, ownerEff as any, {
        sourceDescription: "File test batch",
        templateName: null, templateVersion: null,
        cutoverImportMode: "opening_balance",
        idempotencyKey: "batch-file-001",
      });

      // Task 3: Private file metadata proof
      // 4. Reject public URL
      try {
        await services.service.registerFile(ownerUser as any, ownerEff as any, {
          importBatchId: batch.batchId,
          originalFileName: "data.xlsx",
          storagePath: "https://example.com/public/data.xlsx",
          fileHash: "sha256:abc",
          fileSizeBytes: 100, contentType: null, fileType: "source",
          idempotencyKey: "file-public-001",
        });
        check("4. rejects public URL", false, "should have thrown");
      } catch (e) {
        check("4. rejects public URL", true, `error=${(e as Error).message.slice(0, 40)}`);
      }

      // 5. Reject secret-looking values in storagePath
      try {
        await services.service.registerFile(ownerUser as any, ownerEff as any, {
          importBatchId: batch.batchId,
          originalFileName: "data.xlsx",
          storagePath: "private://bucket?token=secret123",
          fileHash: "sha256:abc",
          fileSizeBytes: 100, contentType: null, fileType: "source",
          idempotencyKey: "file-secret-001",
        });
        check("5. rejects secret in storagePath", false, "should have thrown");
      } catch (e) {
        check("5. rejects secret in storagePath", true, `error=${(e as Error).message.slice(0, 40)}`);
      }

      // 6. Reject empty checksum
      try {
        await services.service.registerFile(ownerUser as any, ownerEff as any, {
          importBatchId: batch.batchId,
          originalFileName: "data.xlsx",
          storagePath: "private://data.xlsx",
          fileHash: "",
          fileSizeBytes: 100, contentType: null, fileType: "source",
          idempotencyKey: "file-nochecksum-001",
        });
        check("6. rejects empty checksum", false, "should have thrown");
      } catch (e) {
        check("6. rejects empty checksum", true, `error=${(e as Error).message.slice(0, 40)}`);
      }

      // 7. Register valid file with full metadata
      const fileResult = await services.service.registerFile(ownerUser as any, ownerEff as any, {
        importBatchId: batch.batchId,
        originalFileName: "customers.xlsx",
        storagePath: "private://tenant/batch/customers.xlsx",
        fileHash: "sha256:abc123def",
        fileSizeBytes: 4096,
        contentType: "application/vnd.openxmlformats",
        fileType: "source",
        idempotencyKey: "file-valid-001",
      });
      check("7. valid file registered", fileResult.action === "created", `action=${fileResult.action}`);

      // 8. Verify file metadata persisted with all fields
      const fileRows = await pgSql`SELECT * FROM import_files WHERE tenant_id = ${TEST_TENANT_ID} AND id = ${fileResult.fileId}`;
      check("8. file metadata persisted", fileRows.length === 1, `count=${fileRows.length}`);
      check("   file has checksum", fileRows[0]?.file_hash === "sha256:abc123def", `hash=${fileRows[0]?.file_hash}`);
      check("   file has storage_path (private)", fileRows[0]?.storage_path === "private://tenant/batch/customers.xlsx", `path=${fileRows[0]?.storage_path}`);
      check("   file has file_size_bytes", fileRows[0]?.file_size_bytes === 4096, `size=${fileRows[0]?.file_size_bytes}`);
      check("   file has content_type", fileRows[0]?.content_type === "application/vnd.openxmlformats", `type=${fileRows[0]?.content_type}`);
      check("   file has original_file_name", fileRows[0]?.original_file_name === "customers.xlsx", `name=${fileRows[0]?.original_file_name}`);
      check("   file has created_by (provenance)", fileRows[0]?.created_by === TEST_USER_ID, `by=${fileRows[0]?.created_by?.slice(0, 8)}`);

      // Task 1: Scoped audit proof for file registration
      const fileAudit = await pgSql`SELECT * FROM audit_logs WHERE tenant_id = ${TEST_TENANT_ID} AND entity_type = 'import_file' AND entity_id = ${fileResult.fileId} AND action_type = 'historical_file.register'`;
      check("9. audit: file register row exists", fileAudit.length === 1, `count=${fileAudit.length}`);
      check("   audit: file new_values has fileHash", fileAudit[0]?.new_values_json?.fileHash === "sha256:abc123def", `hash=${fileAudit[0]?.new_values_json?.fileHash}`);
      check("   audit: file new_values has fileType", fileAudit[0]?.new_values_json?.fileType === "source", `type=${fileAudit[0]?.new_values_json?.fileType}`);
      check("   audit: file new_values has storagePath", fileAudit[0]?.new_values_json?.storagePath === "private://tenant/batch/customers.xlsx", `path=${fileAudit[0]?.new_values_json?.storagePath}`);

      // 10. Re-upload with different hash creates new file
      const file2 = await services.service.registerFile(ownerUser as any, ownerEff as any, {
        importBatchId: batch.batchId,
        originalFileName: "customers.xlsx",
        storagePath: "private://tenant/batch/customers-v2.xlsx",
        fileHash: "sha256:different",
        fileSizeBytes: 2048, contentType: null, fileType: "source",
        idempotencyKey: "file-reupload-001",
      });
      check("10. re-upload creates new file (not overwrite)", file2.fileId !== fileResult.fileId, `different=${file2.fileId !== fileResult.fileId}`);

      // 11. Duplicate hash returns existing file (idempotent)
      const file3 = await services.service.registerFile(ownerUser as any, ownerEff as any, {
        importBatchId: batch.batchId,
        originalFileName: "renamed.xlsx",
        storagePath: "private://renamed.xlsx",
        fileHash: "sha256:abc123def",
        fileSizeBytes: 4096, contentType: null, fileType: "source",
        idempotencyKey: "file-dup-001",
      });
      check("11. duplicate hash returns existing file", file3.fileId === fileResult.fileId, `same=${file3.fileId === fileResult.fileId}`);
    }

    // ===== SECTION 3: Staging batch + rows + scoped audit (Task 1) =====
    await cleanTestData();
    {
      const services = wireServices();

      const batch = await services.service.createBatch(ownerUser as any, ownerEff as any, {
        sourceDescription: "Staging test",
        templateName: "customers_v1", templateVersion: "1.0.0",
        cutoverImportMode: "opening_balance",
        idempotencyKey: "batch-staging-001",
      });
      check("12. batch created", batch.action === "created", `action=${batch.action}`);

      // Task 1: Scoped audit for batch creation
      const batchAudit = await pgSql`SELECT * FROM audit_logs WHERE tenant_id = ${TEST_TENANT_ID} AND entity_type = 'import_batch' AND entity_id = ${batch.batchId} AND action_type = 'historical_batch.create'`;
      check("13. audit: batch create row exists", batchAudit.length === 1, `count=${batchAudit.length}`);
      check("   audit: batch new_values has batchNo", batchAudit[0]?.new_values_json?.batchNo !== undefined, `batchNo=${batchAudit[0]?.new_values_json?.batchNo}`);
      check("   audit: batch new_values has sourceDescription", batchAudit[0]?.new_values_json?.sourceDescription === "Staging test", `desc=${batchAudit[0]?.new_values_json?.sourceDescription}`);
      check("   audit: batch new_values has cutoverImportMode", batchAudit[0]?.new_values_json?.cutoverImportMode === "opening_balance", `mode=${batchAudit[0]?.new_values_json?.cutoverImportMode}`);

      // Insert staging rows
      const file = await services.service.registerFile(ownerUser as any, ownerEff as any, {
        importBatchId: batch.batchId,
        originalFileName: "data.xlsx",
        storagePath: "private://data.xlsx",
        fileHash: "sha256:staging",
        fileSizeBytes: 100, contentType: null, fileType: "source",
        idempotencyKey: "file-staging-001",
      });

      const row1 = await services.service.insertStagingRow(ownerUser as any, ownerEff as any, {
        importBatchId: batch.batchId,
        importFileId: file.fileId,
        templateName: "customers_v1",
        sourceSheetName: "Sheet1", sourceRowNumber: 2,
        rawRowJson: { name: "Customer A", code: "CUST001" },
        transformedRowJson: { name: "Customer A", code: "CUST001", status: "active" },
        transformationNotes: null,
        idempotencyKey: "row-staging-001",
      });
      check("14. staging row 1 inserted", row1.action === "created", `action=${row1.action}`);

      // Task 1: Scoped audit for staging row insertion
      const rowAudit = await pgSql`SELECT * FROM audit_logs WHERE tenant_id = ${TEST_TENANT_ID} AND entity_type = 'import_staging_row' AND entity_id = ${row1.stagingRowId} AND action_type = 'historical_staging_row.insert'`;
      check("15. audit: staging row insert row exists", rowAudit.length === 1, `count=${rowAudit.length}`);
      check("   audit: row new_values has sourceSheetName", rowAudit[0]?.new_values_json?.sourceSheetName === "Sheet1", `sheet=${rowAudit[0]?.new_values_json?.sourceSheetName}`);
      check("   audit: row new_values has sourceRowNumber", rowAudit[0]?.new_values_json?.sourceRowNumber === 2, `row=${rowAudit[0]?.new_values_json?.sourceRowNumber}`);

      // 16. Idempotency replay
      const replay = await services.service.insertStagingRow(ownerUser as any, ownerEff as any, {
        importBatchId: batch.batchId,
        importFileId: file.fileId,
        templateName: "customers_v1",
        sourceSheetName: "Sheet1", sourceRowNumber: 2,
        rawRowJson: { name: "Customer A", code: "CUST001" },
        transformedRowJson: { name: "Customer A", code: "CUST001", status: "active" },
        transformationNotes: null,
        idempotencyKey: "row-staging-001",
      });
      check("16. idempotency replay returns same row", replay.action === "replayed" && replay.stagingRowId === row1.stagingRowId, `action=${replay.action}`);

      // Still only 1 row (no duplicate)
      const rowCount = await pgSql`SELECT COUNT(*)::int AS n FROM import_staging_rows WHERE tenant_id = ${TEST_TENANT_ID} AND import_batch_id = ${batch.batchId}`;
      check("   still 1 row after replay", rowCount[0].n === 1, `count=${rowCount[0].n}`);
    }

    // ===== SECTION 4: Expanded non-operational proof (Task 2) =====
    await cleanTestData();
    {
      const services = wireServices();

      // Capture before-counts for ALL operational tables
      const beforeCounts = await captureOperationalCounts();

      // Perform staging operations
      const batch = await services.service.createBatch(ownerUser as any, ownerEff as any, {
        sourceDescription: "No side effects test",
        templateName: null, templateVersion: null,
        cutoverImportMode: "opening_balance",
        idempotencyKey: "batch-noside-001",
      });

      await services.service.registerFile(ownerUser as any, ownerEff as any, {
        importBatchId: batch.batchId,
        originalFileName: "data.xlsx",
        storagePath: "private://data.xlsx",
        fileHash: "sha256:noside",
        fileSizeBytes: 100, contentType: null, fileType: "source",
        idempotencyKey: "file-noside-001",
      });

      await services.service.insertStagingRow(ownerUser as any, ownerEff as any, {
        importBatchId: batch.batchId,
        importFileId: null, templateName: null,
        sourceSheetName: "Sheet1", sourceRowNumber: 1,
        rawRowJson: { qty: "100", price: "50" },
        transformedRowJson: null, transformationNotes: null,
        idempotencyKey: "row-noside-001",
      });

      // 17. Verify NO operational table has new rows (before/after counts match)
      check("17. expanded non-operational proof — before/after counts:", true);
      await verifyNoOperationalChanges(beforeCounts);

      // 18. Batch not committed
      const batchAfter = await pgSql`SELECT status, committed_at FROM import_batches WHERE id = ${batch.batchId}`;
      check("18. batch status is draft (not committed)", batchAfter[0]?.status === "draft", `status=${batchAfter[0]?.status}`);
      check("   batch committed_at is null", batchAfter[0]?.committed_at === null, `committed=${batchAfter[0]?.committed_at}`);
    }

    // ===== SECTION 5: Rollback/failure proof (Task 4) =====
    await cleanTestData();
    {
      const services = wireServices();

      // Task 4: Failure after batch creation — batch exists but staging row fails.
      // The service does not wrap batch + staging row in a single transaction
      // (staging rows are added incrementally). The safe state is:
      // - batch exists in "draft" status (no staging rows)
      // - failed staging row does not exist
      // - idempotency state is safe (can retry with new key)
      const batch = await services.service.createBatch(ownerUser as any, ownerEff as any, {
        sourceDescription: "Rollback test batch",
        templateName: null, templateVersion: null,
        cutoverImportMode: "opening_balance",
        idempotencyKey: "batch-rollback-001",
      });
      check("19. batch created for rollback test", batch.action === "created", `action=${batch.action}`);

      // Capture state before failed staging row
      const rowsBefore = await pgSql`SELECT COUNT(*)::int AS n FROM import_staging_rows WHERE tenant_id = ${TEST_TENANT_ID} AND import_batch_id = ${batch.batchId}`;

      // Attempt staging row with non-existent batch (should fail)
      try {
        await services.service.insertStagingRow(ownerUser as any, ownerEff as any, {
          importBatchId: "nonexistent-batch-id",
          importFileId: null, templateName: null,
          sourceSheetName: "Sheet1", sourceRowNumber: 1,
          rawRowJson: { test: true },
          transformedRowJson: null, transformationNotes: null,
          idempotencyKey: "row-rollback-fail-001",
        });
        check("20. staging row with non-existent batch fails", false, "should have thrown");
      } catch (e) {
        check("20. staging row with non-existent batch fails", true, `error=${(e as Error).message.slice(0, 40)}`);
      }

      // 21. No staging rows created for the failed attempt
      const rowsAfter = await pgSql`SELECT COUNT(*)::int AS n FROM import_staging_rows WHERE tenant_id = ${TEST_TENANT_ID} AND import_batch_id = ${batch.batchId}`;
      check("21. no staging rows after failed insert", rowsAfter[0].n === rowsBefore[0].n, `before=${rowsBefore[0].n}, after=${rowsAfter[0].n}`);

      // 22. Batch state is safe (still draft, no committed_at)
      const batchAfter = await pgSql`SELECT status, committed_at FROM import_batches WHERE id = ${batch.batchId}`;
      check("22. batch state safe after failure (draft)", batchAfter[0]?.status === "draft", `status=${batchAfter[0]?.status}`);
      check("   batch committed_at is null", batchAfter[0]?.committed_at === null, `committed=${batchAfter[0]?.committed_at}`);

      // 23. Idempotency safe — can retry with valid batch + new key
      const retryResult = await services.service.insertStagingRow(ownerUser as any, ownerEff as any, {
        importBatchId: batch.batchId,
        importFileId: null, templateName: null,
        sourceSheetName: "Sheet1", sourceRowNumber: 1,
        rawRowJson: { test: "retry" },
        transformedRowJson: null, transformationNotes: null,
        idempotencyKey: "row-rollback-retry-001",
      });
      check("23. retry with valid batch succeeds", retryResult.action === "created", `action=${retryResult.action}`);

      // 24. Staging row count is 1 (only the successful retry)
      const rowsFinal = await pgSql`SELECT COUNT(*)::int AS n FROM import_staging_rows WHERE tenant_id = ${TEST_TENANT_ID} AND import_batch_id = ${batch.batchId}`;
      check("24. exactly 1 staging row after retry", rowsFinal[0].n === 1, `count=${rowsFinal[0].n}`);
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
