/**
 * WP-07-04 Live Supabase Validation — Dual Approval, Atomic Commit and Locking.
 *
 * Production-path validation:
 *   - HistoricalCommitService
 *   - HistoricalCommitDbRepository
 *   - AuditDbRepository
 *   - InventoryLedgerService + InventoryLedgerDbRepository (for commit effects)
 *   - SubledgerService + SubledgerDbRepository (for commit effects)
 *
 * Usage: DATABASE_URL=... npx tsx scripts/wp-07-04-live-validation.ts
 * TEST-ONLY. Not for production use.
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../src/server/db/schema/index";
import { randomUUID } from "node:crypto";
import { HistoricalStagingDbRepository } from "../src/server/services/historical-staging-db-repository";
import { HistoricalStagingService } from "../src/server/services/historical-staging-service";
import { HistoricalCommitDbRepository } from "../src/server/services/historical-commit-db-repository";
import { HistoricalCommitService } from "../src/server/services/historical-commit-service";
import { AuditDbRepository } from "../src/server/services/audit-db-repository";
import { InventoryLedgerDbRepository } from "../src/server/services/inventory-ledger-db-repository";
import { InventoryLedgerService } from "../src/server/services/inventory-ledger-service";
import { SubledgerDbRepository } from "../src/server/services/subledger-db-repository";
import { SubledgerService } from "../src/server/services/subledger-service";
import { StockReservationDbRepository } from "../src/server/services/stock-reservation-db-repository";
import { InProcessIdempotencyStore } from "../src/server/services/idempotency-service";
import { InProcessDocumentSequenceStore } from "../src/server/services/document-sequence-service";
import type { ErpUserContext } from "../src/server/auth/erp-context";
import type { EffectivePermissions } from "../src/server/security/effective-permissions";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("ERROR: DATABASE_URL required."); process.exit(2); }

const pgSql = postgres(DATABASE_URL, { prepare: false, max: 10, idle_timeout: 30, connect_timeout: 30, max_lifetime: 180 });
const db = drizzle(pgSql, { schema });

const TEST_TENANT_ID = "00000000-0000-0000-0000-000000070004";
const TEST_USER_ID_OWNER = "00000000-0000-0000-0000-000000070004";
const TEST_USER_ID_ACCT = "00000000-0000-0000-0000-000000070005";
const TEST_CUSTOMER_ID = "00000000-0000-4000-8000-cccc00070004";
const TEST_ITEM_ID = "00000000-0000-4000-8000-000000070004";
const TEST_LOCATION_ID = "00000000-0000-4000-8000-000000070005";

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
function check(name: string, ok: boolean, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const ownerUser: ErpUserContext = { authenticated: true, userId: TEST_USER_ID_OWNER, tenantId: TEST_TENANT_ID, email: "wp0704@test.local", name: "WP-07-04 Owner", authId: "wp0704" };
const acctUser: ErpUserContext = { authenticated: true, userId: TEST_USER_ID_ACCT, tenantId: TEST_TENANT_ID, email: "wp0704-2@test.local", name: "WP-07-04 Accountant", authId: "wp0704-2" };
const ownerEff: EffectivePermissions = { assignedRoleCodes: ["owner"], permissionKeys: new Set(["migration.prepare", "migration.review", "migration.approve", "migration.commit", "inventory.receive.approve", "inventory.receive.create", "sales.approve"]), deniedFieldKeys: new Set(), workerFinancialDeny: false } as any;
const acctEff: EffectivePermissions = { assignedRoleCodes: ["accountant"], permissionKeys: new Set(["migration.prepare", "migration.review", "migration.approve", "migration.commit", "inventory.receive.approve", "inventory.receive.create", "sales.approve"]), deniedFieldKeys: new Set(), workerFinancialDeny: false } as any;

// Shared stores — must persist across wireServices() calls to avoid document
// number collisions and idempotency key conflicts.
const sharedIdempotency = new InProcessIdempotencyStore();
const sharedDocumentSequence = new InProcessDocumentSequenceStore();

function wireServices() {
  const stagingRepo = new HistoricalStagingDbRepository(db);
  const commitRepo = new HistoricalCommitDbRepository(db);
  const audit = new AuditDbRepository(db);
  const idempotency = sharedIdempotency;
  const documentSequence = sharedDocumentSequence;
  const ledgerRepo = new InventoryLedgerDbRepository(db);
  const subledgerRepo = new SubledgerDbRepository(db);
  const reservationRepo = new StockReservationDbRepository(db);
  const inventoryLedger = new InventoryLedgerService({ ledger: ledgerRepo, audit, idempotency, documentSequence });
  const subledger = new SubledgerService({ subledger: subledgerRepo, audit, idempotency, documentSequence });
  const stagingService = new HistoricalStagingService({ repository: stagingRepo, audit, idempotency, documentSequence });
  const commitService = new HistoricalCommitService({ repository: commitRepo, audit, idempotency, inventoryLedger, subledger });
  return { stagingRepo, commitRepo, audit, idempotency, documentSequence, ledgerRepo, subledgerRepo, reservationRepo, inventoryLedger, subledger, stagingService, commitService };
}

async function ensureMasterData() {
  const r = Date.now().toString(36).slice(-6);
  await pgSql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status) VALUES (${TEST_TENANT_ID}, 'WP-07-04 Live', 'ar', 'EGP', 'Africa/Cairo', 'active') ON CONFLICT (id) DO NOTHING`;
  await pgSql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${TEST_USER_ID_OWNER}, ${TEST_TENANT_ID}, 'wp0704', 'WP-07-04 Owner', 'wp0704@test.local', 'active', 'ar') ON CONFLICT (id) DO NOTHING`;
  await pgSql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${TEST_USER_ID_ACCT}, ${TEST_TENANT_ID}, 'wp0704-2', 'WP-07-04 Accountant', 'wp0704-2@test.local', 'active', 'ar') ON CONFLICT (id) DO NOTHING`;
  await pgSql`INSERT INTO customers (id, tenant_id, customer_code, name_ar, name_en, normalized_name, status, created_by) VALUES (${TEST_CUSTOMER_ID}, ${TEST_TENANT_ID}, ${'CUST-' + r}, 'عميل 0704', 'Customer 0704', ${'customer ' + r}, 'active', ${TEST_USER_ID_OWNER}) ON CONFLICT (id) DO NOTHING`;
  await pgSql`INSERT INTO inventory_items (id, tenant_id, item_kind, item_code, display_name_ar, display_name_en, quality_status, is_blocked, status, created_by) VALUES (${TEST_ITEM_ID}, ${TEST_TENANT_ID}, 'single_yarn', ${'ITEM-' + r}, 'صنف 0704', 'Item 0704', 'accepted', false, 'active', ${TEST_USER_ID_OWNER}) ON CONFLICT (id) DO NOTHING`;
  await pgSql`INSERT INTO locations (id, tenant_id, location_code, name_ar, name_en, location_type, status, created_by) VALUES (${TEST_LOCATION_ID}, ${TEST_TENANT_ID}, ${'LOC-' + r}, 'موقع 0704', 'Location 0704', 'internal_warehouse', 'active', ${TEST_USER_ID_OWNER}) ON CONFLICT (id) DO NOTHING`;
}

async function cleanTestData() {
  await pgSql.begin(async (tx) => {
    await tx`DELETE FROM import_human_review_items WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM import_reconciliation_results WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM import_batch_approvals WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM import_cutover_manifests WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM import_validation_errors WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM import_alias_mappings WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM import_staging_cells WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM import_staging_rows WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM import_files WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM import_batches WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM import_template_versions WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM sales_profitability_snapshots WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM account_entries WHERE tenant_id = ${TEST_TENANT_ID} AND source_document_type IN ('historical_import', 'import_batch')`;
    await tx`DELETE FROM accounts WHERE tenant_id = ${TEST_TENANT_ID} AND owner_type = 'customer'`;
    await tx`DELETE FROM stock_reservations WHERE tenant_id = ${TEST_TENANT_ID} AND item_id = ${TEST_ITEM_ID}`;
    await tx`DELETE FROM inventory_balances WHERE tenant_id = ${TEST_TENANT_ID} AND item_id = ${TEST_ITEM_ID}`;
    await tx`DELETE FROM stock_movements WHERE tenant_id = ${TEST_TENANT_ID} AND source_document_type IN ('historical_import', 'test_seed')`;
    await tx`DELETE FROM idempotency_records WHERE tenant_id = ${TEST_TENANT_ID} AND (operation_scope LIKE 'historical_%' OR operation_scope LIKE 'import_%')`;
    await tx`DELETE FROM document_sequences WHERE tenant_id = ${TEST_TENANT_ID} AND document_type IN ('migration_batch', 'raw_receipt', 'account_entry', 'return_receipt')`;
  });
}

async function main() {
  console.log("=== WP-07-04 Live Supabase Validation (Production Path) ===");
  let exitCode = 0;

  try {
    await ensureMasterData();
    await cleanTestData();

    // ===== SECTION 1: Create batch + staging rows =====
    let batchId: string;
    {
      const services = wireServices();
      // Seed stock for the item/location
      await services.inventoryLedger.postRawReceipt(ownerUser as any, ownerEff as any, {
        itemId: TEST_ITEM_ID, toLocationId: TEST_LOCATION_ID, quantityKg: "10000.000",
        movementDate: "2026-07-01", sourceDocumentType: "test_seed", sourceDocumentId: randomUUID(),
        idempotencyKey: "seed-0704-" + Date.now(),
      });

      const batch = await services.stagingService.createBatch(ownerUser as any, ownerEff as any, {
        sourceDescription: "Commit test batch",
        templateName: null, templateVersion: null,
        cutoverImportMode: "opening_balance",
        idempotencyKey: "batch-commit-001",
      });
      batchId = batch.batchId;
      check("1. batch created", batch.action === "created", `action=${batch.action}`);

      // Staging row with inventory opening (qty=100)
      await services.stagingService.insertStagingRow(ownerUser as any, ownerEff as any, {
        importBatchId: batchId, importFileId: null, templateName: null,
        sourceSheetName: "Sheet1", sourceRowNumber: 1,
        rawRowJson: { name: "Item A", code: "I001", quantity: "100", date: "2026-01-01", item_id: TEST_ITEM_ID, location_id: TEST_LOCATION_ID },
        transformedRowJson: null, transformationNotes: null, idempotencyKey: "row-commit-001",
      });

      // Set batch to review_required (simulate validation + reconciliation complete)
      await pgSql`UPDATE import_batches SET status = 'review_required', validation_status = 'validation_complete', reconciliation_status = 'reconciliation_complete' WHERE id = ${batchId}`;
      check("2. batch set to review_required", true, `batchId=${batchId}`);
    }

    // ===== SECTION 2: Approval tests =====
    {
      const services = wireServices();

      // 3. Owner approval
      const ownerAppr = await services.commitService.submitApproval(ownerUser as any, ownerEff as any, {
        importBatchId: batchId, approverRole: "owner", backupEvidenceRef: "backup-ref-001", reason: "Owner approves", idempotencyKey: "appr-owner-001",
      });
      check("3. owner approval submitted", ownerAppr.action === "approved", `action=${ownerAppr.action}`);

      // 4. Same user cannot provide accountant approval (DEC-069)
      try {
        await services.commitService.submitApproval(ownerUser as any, acctEff as any, {
          importBatchId: batchId, approverRole: "accountant", backupEvidenceRef: "backup-ref-001", reason: "Same user", idempotencyKey: "appr-same-001",
        });
        check("4. same user dual-role rejected (DEC-069)", false, "should have thrown");
      } catch (e) {
        check("4. same user dual-role rejected (DEC-069)", true, `error=${(e as Error).message.slice(0, 50)}`);
      }

      // 5. Distinct accountant approval
      const acctAppr = await services.commitService.submitApproval(acctUser as any, acctEff as any, {
        importBatchId: batchId, approverRole: "accountant", backupEvidenceRef: "backup-ref-001", reason: "Accountant approves", idempotencyKey: "appr-acct-001",
      });
      check("5. accountant approval submitted (distinct user)", acctAppr.action === "approved", `action=${acctAppr.action}`);

      // 6. Approvals persisted with hash binding
      const approvals = await pgSql`SELECT * FROM import_batch_approvals WHERE tenant_id = ${TEST_TENANT_ID} AND import_batch_id = ${batchId}`;
      check("6. 2 approvals persisted", approvals.length === 2, `count=${approvals.length}`);
      check("   approvals have staged_data_hash", approvals.every((a: any) => a.staged_data_hash !== null && a.staged_data_hash !== ""), "");
      check("   approvals have distinct approver_user_id", approvals[0]?.approver_user_id !== approvals[1]?.approver_user_id, "");
      check("   owner and accountant roles present", approvals.some((a: any) => a.approver_role === "owner") && approvals.some((a: any) => a.approver_role === "accountant"), "");

      // 7. Audit rows for approvals (append-only — use before/after count)
      const apprAuditBefore = await pgSql`SELECT COUNT(*)::int AS n FROM audit_logs WHERE tenant_id = ${TEST_TENANT_ID} AND entity_type = 'import_batch_approval' AND action_type = 'historical_commit.approve'`;
      // The 2 approvals above already wrote audit rows, so check >= 2 new ones
      check("7. audit: approval rows exist (>= 2)", apprAuditBefore[0].n >= 2, `count=${apprAuditBefore[0].n}`);
    }

    // ===== SECTION 3: Missing backup blocks commit =====
    {
      const services = wireServices();
      try {
        await services.commitService.commitBatch(ownerUser as any, ownerEff as any, {
          importBatchId: batchId, backupEvidenceRef: "", idempotencyKey: "commit-nobackup-001",
        });
        check("8. missing backup blocks commit", false, "should have thrown");
      } catch (e) {
        check("8. missing backup blocks commit", true, `error=${(e as Error).message.slice(0, 40)}`);
      }
    }

    // ===== SECTION 4: Atomic commit =====
    {
      const services = wireServices();

      // Capture before counts
      const stockBefore = await pgSql`SELECT COUNT(*)::int AS n FROM stock_movements WHERE tenant_id = ${TEST_TENANT_ID} AND source_document_type = 'historical_import'`;
      const balBefore = await pgSql`SELECT on_hand_qty_kg FROM inventory_balances WHERE tenant_id = ${TEST_TENANT_ID} AND item_id = ${TEST_ITEM_ID} AND location_id = ${TEST_LOCATION_ID}`;
      const balBeforeKg = parseFloat(balBefore[0]?.on_hand_qty_kg ?? "0");

      // 9. Commit
      const result = await services.commitService.commitBatch(ownerUser as any, ownerEff as any, {
        importBatchId: batchId, backupEvidenceRef: "backup-evidence-ref-001", idempotencyKey: "commit-001",
      });
      check("9. commit succeeded", result.action === "committed", `action=${result.action}`);
      check("   status is committed", result.status === "committed", `status=${result.status}`);
      check("   effect counts recorded", result.effectCounts.staging_rows_committed > 0, `rows=${result.effectCounts.staging_rows_committed}`);

      // 10. Stock movement created through InventoryLedgerService (not direct table copy)
      const stockAfter = await pgSql`SELECT COUNT(*)::int AS n FROM stock_movements WHERE tenant_id = ${TEST_TENANT_ID} AND source_document_type = 'historical_import'`;
      check("10. stock movement created via domain service", stockAfter[0].n === stockBefore[0].n + 1, `before=${stockBefore[0].n}, after=${stockAfter[0].n}`);

      // 11. Inventory balance updated
      const balAfter = await pgSql`SELECT on_hand_qty_kg FROM inventory_balances WHERE tenant_id = ${TEST_TENANT_ID} AND item_id = ${TEST_ITEM_ID} AND location_id = ${TEST_LOCATION_ID}`;
      check("11. inventory balance updated", parseFloat(balAfter[0].on_hand_qty_kg) === balBeforeKg + 100, `before=${balBeforeKg}, after=${balAfter[0]?.on_hand_qty_kg}`);

      // 12. Staging row marked as committed
      const stagingRows = await pgSql`SELECT * FROM import_staging_rows WHERE tenant_id = ${TEST_TENANT_ID} AND import_batch_id = ${batchId}`;
      check("12. staging rows marked committed", stagingRows.every((r: any) => r.committed_entity_type === 'historical_import' && r.committed_entity_id !== null), "");

      // 13. Batch committed
      const batchAfter = await pgSql`SELECT status, committed_at, commit_effect_counts FROM import_batches WHERE id = ${batchId}`;
      check("13. batch status is committed", batchAfter[0]?.status === "committed", `status=${batchAfter[0]?.status}`);
      check("   batch committed_at is set", batchAfter[0]?.committed_at !== null, "");
      check("   batch commit_effect_counts recorded", batchAfter[0]?.commit_effect_counts !== null, "");

      // 14. Cutover lock acquired and released
      const locks = await pgSql`SELECT COUNT(*)::int AS n FROM import_cutover_manifests WHERE tenant_id = ${TEST_TENANT_ID} AND import_batch_id = ${batchId}`;
      check("14. cutover locks released after commit (0 remaining)", locks[0].n === 0, `count=${locks[0].n}`);

      // 15. Audit rows for commit
      const commitAudit = await pgSql`SELECT * FROM audit_logs WHERE tenant_id = ${TEST_TENANT_ID} AND entity_type = 'import_batch' AND action_type = 'historical_commit.commit' AND entity_id = ${batchId}`;
      check("15. audit: commit row exists", commitAudit.length === 1, `count=${commitAudit.length}`);
      check("   audit: has backupEvidenceRef", commitAudit[0]?.new_values_json?.backupEvidenceRef === "backup-evidence-ref-001", "");
      check("   audit: has effectCounts", commitAudit[0]?.new_values_json?.effectCounts?.staging_rows_committed > 0, "");

      const lockAudit = await pgSql`SELECT * FROM audit_logs WHERE tenant_id = ${TEST_TENANT_ID} AND action_type LIKE 'historical_commit.cutover_lock%'`;
      check("16. audit: cutover lock acquire+release rows exist", lockAudit.length >= 2, `count=${lockAudit.length}`);
    }

    // ===== SECTION 5: Idempotency replay =====
    {
      const services = wireServices();
      const replay = await services.commitService.commitBatch(ownerUser as any, ownerEff as any, {
        importBatchId: batchId, backupEvidenceRef: "backup-evidence-ref-001", idempotencyKey: "commit-001",
      });
      check("17. idempotency replay returns same result", replay.action === "replayed", `action=${replay.action}`);

      // No duplicate stock movements
      const stockCount = await pgSql`SELECT COUNT(*)::int AS n FROM stock_movements WHERE tenant_id = ${TEST_TENANT_ID} AND source_document_type = 'historical_import' AND source_document_id = ${batchId}`;
      check("   no duplicate stock movements", stockCount[0].n === 1, `count=${stockCount[0].n}`);
    }

    // ===== SECTION 6: No operational side effects on master tables =====
    {
      const suppliers = await pgSql`SELECT COUNT(*)::int AS n FROM suppliers WHERE tenant_id = ${TEST_TENANT_ID}`;
      check("18. no new suppliers created", suppliers[0].n === 0, `count=${suppliers[0].n}`);

      const customers = await pgSql`SELECT COUNT(*)::int AS n FROM customers WHERE tenant_id = ${TEST_TENANT_ID}`;
      check("   no new customers created (only seed)", customers[0].n === 1, `count=${customers[0].n}`);

      const items = await pgSql`SELECT COUNT(*)::int AS n FROM inventory_items WHERE tenant_id = ${TEST_TENANT_ID}`;
      check("   no new inventory_items created (only seed)", items[0].n === 1, `count=${items[0].n}`);
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
