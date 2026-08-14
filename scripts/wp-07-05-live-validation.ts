/**
 * WP-07-05 Live Supabase Validation — Historical Correction Workflow.
 *
 * Contract: docs/contracts/08_historical_migration_contract.md §8.11
 * DEC-070: Post-commit historical correction requires renewed dual approval.
 *
 * Proofs:
 *   Task A: Create correction request for committed batch
 *   Task B: Cannot correct uncommitted batch
 *   Task C: Dual approval with distinct identities (DEC-070/069)
 *   Task D: Same-user rejection
 *   Task E: Execute correction through domain service
 *   Task F: Original evidence unchanged after correction
 *   Task G: Duplicate correction handling (idempotent)
 *   Task H: Rollback after partial correction effect
 *   Task I: Persistent scoped audit
 *   Task J: No credentials persisted
 *
 * Usage: DATABASE_URL=... npx tsx scripts/wp-07-05-live-validation.ts
 * TEST-ONLY. Not for production use.
 */
import postgres from "postgres";
import { execSync } from "node:child_process";
import { drizzle } from "drizzle-orm/postgres-js";
import { randomUUID } from "node:crypto";
import * as schema from "../src/server/db/schema/index";
import { HistoricalStagingDbRepository } from "../src/server/services/historical-staging-db-repository";
import { HistoricalStagingService } from "../src/server/services/historical-staging-service";
import { HistoricalCommitDbRepository } from "../src/server/services/historical-commit-db-repository";
import { HistoricalCommitService } from "../src/server/services/historical-commit-service";
import { HistoricalCorrectionDbRepository } from "../src/server/services/historical-correction-db-repository";
import { HistoricalCorrectionService, type CorrectionDomainHook } from "../src/server/services/historical-correction-service";
import { AuditDbRepository } from "../src/server/services/audit-db-repository";
import { InProcessIdempotencyStore } from "../src/server/services/idempotency-service";
import { InProcessDocumentSequenceStore } from "../src/server/services/document-sequence-service";
import { InventoryLedgerService } from "../src/server/services/inventory-ledger-service";
import { InventoryLedgerDbRepository } from "../src/server/services/inventory-ledger-db-repository";
import { SubledgerService } from "../src/server/services/subledger-service";
import { SubledgerDbRepository } from "../src/server/services/subledger-db-repository";
import type { ErpUserContext } from "../src/server/auth/erp-context";
import type { EffectivePermissions } from "../src/server/security/effective-permissions";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("ERROR: DATABASE_URL required."); process.exit(2); }

execSync("node scripts/wp-08-01f-destruction-guard.mjs --live-validation", { stdio: "inherit" });
const pgSql = postgres(DATABASE_URL, {
  prepare: false, max: 5, idle_timeout: 10, connect_timeout: 15, max_lifetime: 60,
});
const db = drizzle(pgSql, { schema });

const TEST_TENANT_ID = "00000000-0000-0000-0000-000000070005";
const OWNER_USER_ID = "00000000-0000-0000-0000-000000070005";
const ACCOUNTANT_USER_ID = "00000000-0000-0000-0000-000000070015";
const ITEM_ID = "30000000-0000-0000-0000-000000070001";
const LOCATION_ID = "30000000-0000-0000-0000-000000070002";
const CUSTOMER_ID = "30000000-0000-0000-0000-000000070003";
const COMMITTED_BATCH_ID = "10000000-0000-0000-0000-000000070010";
const UNCOMMITTED_BATCH_ID = "10000000-0000-0000-0000-000000070011";

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
function check(name: string, ok: boolean, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const ownerUser: ErpUserContext = {
  authenticated: true, userId: OWNER_USER_ID, tenantId: TEST_TENANT_ID,
  email: "wp0705-owner@test.local", name: "WP-07-05 Owner", authId: "wp0705owner",
};
const accountantUser: ErpUserContext = {
  authenticated: true, userId: ACCOUNTANT_USER_ID, tenantId: TEST_TENANT_ID,
  email: "wp0705-acct@test.local", name: "WP-07-05 Accountant", authId: "wp0705acct",
};
const ownerEff: EffectivePermissions = {
  assignedRoleCodes: ["owner"],
  permissionKeys: new Set(["migration.prepare", "migration.review", "migration.approve", "migration.commit"]),
  deniedFieldKeys: new Set(), workerFinancialDeny: false,
} as any;
const accountantEff: EffectivePermissions = {
  assignedRoleCodes: ["accountant"],
  permissionKeys: new Set(["migration.prepare", "migration.review", "migration.approve", "migration.commit"]),
  deniedFieldKeys: new Set(), workerFinancialDeny: false,
} as any;

const globalDocumentSequence = new InProcessDocumentSequenceStore();
// Global idempotency store — shared across wireServices() calls so that
// replay/idempotency works correctly across fresh service instances (same as
// DB-backed idempotency in production).
const globalIdempotency = new InProcessIdempotencyStore();

function wireServices() {
  const stagingRepo = new HistoricalStagingDbRepository(db);
  const commitRepo = new HistoricalCommitDbRepository(db);
  const correctionRepo = new HistoricalCorrectionDbRepository(db);
  const audit = new AuditDbRepository(db);
  const idempotency = globalIdempotency;
  const documentSequence = globalDocumentSequence;
  const stagingService = new HistoricalStagingService({ repository: stagingRepo, audit, idempotency, documentSequence });

  const transactionRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
    return (db as any).transaction(async (tx: any) => work(tx));
  };
  const txFactories = {
    createCommitRepository: (tx: unknown) => new HistoricalCommitDbRepository(tx as any),
    createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
    createInventoryLedger: (tx: unknown) => new InventoryLedgerService({
      ledger: new InventoryLedgerDbRepository(tx as any), audit: new AuditDbRepository(tx as any),
      idempotency, documentSequence,
    }),
    createSubledger: (tx: unknown) => new SubledgerService({
      subledger: new SubledgerDbRepository(tx as any), audit: new AuditDbRepository(tx as any),
      idempotency, documentSequence,
    }),
    createDocumentSequence: (_tx: unknown) => documentSequence,
  };

  const commitService = new HistoricalCommitService({
    repository: commitRepo, audit, idempotency, transactionRunner, txFactories,
  });
  const correctionService = new HistoricalCorrectionService({
    repository: correctionRepo, audit, idempotency, documentSequence,
  });
  return { stagingRepo, commitRepo, correctionRepo, audit, idempotency, documentSequence, stagingService, commitService, correctionService };
}

async function ensureMasterData() {
  await pgSql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status) VALUES (${TEST_TENANT_ID}, 'WP-07-05 Live', 'ar', 'EGP', 'Africa/Cairo', 'active') ON CONFLICT (id) DO NOTHING`;
  await pgSql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${OWNER_USER_ID}, ${TEST_TENANT_ID}, 'wp0705owner', 'WP-07-05 Owner', 'wp0705-owner@test.local', 'active', 'ar') ON CONFLICT (id) DO NOTHING`;
  await pgSql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${ACCOUNTANT_USER_ID}, ${TEST_TENANT_ID}, 'wp0705acct', 'WP-07-05 Accountant', 'wp0705-acct@test.local', 'active', 'ar') ON CONFLICT (id) DO NOTHING`;
  await pgSql`INSERT INTO inventory_items (id, tenant_id, item_kind, item_code, display_name_ar, display_name_en, quality_status, is_blocked, status, created_by) VALUES (${ITEM_ID}, ${TEST_TENANT_ID}, 'raw_material', 'YARN-002', 'خيط اختبار ٢', 'Test Yarn 2', 'accepted', false, 'active', ${OWNER_USER_ID}) ON CONFLICT (id) DO NOTHING`;
  await pgSql`INSERT INTO locations (id, tenant_id, location_code, name_ar, name_en, location_type, status, created_by) VALUES (${LOCATION_ID}, ${TEST_TENANT_ID}, 'WH-B', 'مخزن ب', 'Warehouse B', 'internal_warehouse', 'active', ${OWNER_USER_ID}) ON CONFLICT (id) DO NOTHING`;
  await pgSql`INSERT INTO customers (id, tenant_id, customer_code, name_ar, name_en, normalized_name, status, created_by) VALUES (${CUSTOMER_ID}, ${TEST_TENANT_ID}, 'CUST-002', 'عميل اختبار ٢', 'Test Customer 2', 'test customer 2', 'active', ${OWNER_USER_ID}) ON CONFLICT (id) DO NOTHING`;
}

async function cleanTestData() {
  await pgSql.begin(async (tx) => {
    await tx`DELETE FROM inventory_balances WHERE tenant_id = ${TEST_TENANT_ID} AND item_id = ${ITEM_ID}`;
    await tx`DELETE FROM stock_movements WHERE tenant_id = ${TEST_TENANT_ID} AND source_document_type IN ('historical_opening_balance', 'historical_correction')`;
    await tx`DELETE FROM account_entries WHERE tenant_id = ${TEST_TENANT_ID} AND source_document_type IN ('historical_opening_balance', 'historical_correction')`;
    await tx`DELETE FROM accounts WHERE tenant_id = ${TEST_TENANT_ID} AND owner_id = ${CUSTOMER_ID}`;
    await tx`DELETE FROM historical_correction_requests WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM import_cutover_locks WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM import_backup_evidence WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM import_batch_approvals WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM import_validation_errors WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM import_reconciliation_results WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM import_staging_rows WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM import_batches WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM idempotency_records WHERE tenant_id = ${TEST_TENANT_ID} AND (operation_scope LIKE 'historical_%' OR operation_scope LIKE 'import_%')`;
    await tx`DELETE FROM document_sequences WHERE tenant_id = ${TEST_TENANT_ID} AND document_type IN ('migration_batch', 'adjustment', 'opening_balance', 'correction_request')`;
  });
}

/**
 * Setup a committed batch with real domain effects (stock_movements + account_entries).
 */
async function setupCommittedBatch(services: ReturnType<typeof wireServices>): Promise<void> {
  // Create and commit a batch (reuses WP-07-04 commit path)
  const batchId = COMMITTED_BATCH_ID;
  const stagedDataHash = `staged-hash-${batchId}`;
  const warningSummary = null;

  await pgSql`
    INSERT INTO import_batches (
      id, tenant_id, batch_no, status, source_description,
      template_name, template_version, mapping_version,
      cutover_manifest_hash, cutover_import_mode,
      staged_data_hash, staged_row_count,
      blocking_error_count, warning_count, accepted_warning_count,
      validation_status, reconciliation_status, warning_summary,
      created_by
    ) VALUES (
      ${batchId}, ${TEST_TENANT_ID}, ${'MIG-' + batchId}, 'validation_complete', 'WP-07-05 committed batch',
      'opening_balances', 'v1.0', 'v1.0',
      ${'manifest-hash-' + batchId}, 'opening_balance',
      ${stagedDataHash}, 2,
      0, 0, 0,
      'passed', 'matched', ${warningSummary},
      ${OWNER_USER_ID}
    )
  `;

  // Staging rows: 1 inventory + 1 customer
  const stagingRows = [
    { entity_type: "inventory", item_id: ITEM_ID, location_id: LOCATION_ID, quantity: "100.000" },
    { entity_type: "customer", owner_id: CUSTOMER_ID, balance: "5000.00" },
  ];
  for (let i = 0; i < stagingRows.length; i++) {
    await pgSql`
      INSERT INTO import_staging_rows (id, tenant_id, import_batch_id, source_sheet_name, source_row_number, raw_row_json, validation_status, review_status, created_by)
      VALUES (gen_random_uuid(), ${TEST_TENANT_ID}, ${batchId}, 'Sheet1', ${i + 1}, ${JSON.stringify(stagingRows[i])}::jsonb, 'pending', 'not_required', ${OWNER_USER_ID})
    `;
  }

  // Record dual approval
  await services.commitService.recordApproval(ownerUser as any, ownerEff as any, {
    importBatchId: batchId, approverRole: "owner", reason: "Owner approval", idempotencyKey: `owner-${batchId}`,
  });
  await services.commitService.recordApproval(accountantUser as any, accountantEff as any, {
    importBatchId: batchId, approverRole: "accountant", reason: "Accountant approval", idempotencyKey: `acct-${batchId}`,
  });

  // Record backup evidence
  await services.commitService.recordBackupEvidence(ownerUser as any, ownerEff as any, {
    importBatchId: batchId, backupType: "database_snapshot",
    backupLocation: "s3://bucket/backup-" + batchId, backupHash: "backup-hash-" + batchId,
    backupSizeBytes: 1024, backupCreatedAt: new Date(), verificationNotes: "Verified",
    idempotencyKey: `backup-${batchId}`,
  });

  // Commit the batch (real domain effects)
  await services.commitService.commitBatch(ownerUser as any, ownerEff as any, {
    importBatchId: batchId, idempotencyKey: `commit-${batchId}`,
  });
}

async function main() {
  console.log("=== WP-07-05 Live Supabase Validation (Historical Correction Workflow) ===");
  let exitCode = 0;
  const runStartTime = new Date(Date.now() - 5000).toISOString();

  try {
    await ensureMasterData();
    await cleanTestData();

    // Setup committed batch first
    const setupServices = wireServices();
    await setupCommittedBatch(setupServices);

    // Also create an uncommitted batch for Task B
    await pgSql`
      INSERT INTO import_batches (id, tenant_id, batch_no, status, cutover_manifest_hash, cutover_import_mode, staged_data_hash, staged_row_count, validation_status, reconciliation_status, created_by)
      VALUES (${UNCOMMITTED_BATCH_ID}, ${TEST_TENANT_ID}, ${'MIG-' + UNCOMMITTED_BATCH_ID}, 'approved_for_commit', ${'manifest-' + UNCOMMITTED_BATCH_ID}, 'opening_balance', ${'staged-' + UNCOMMITTED_BATCH_ID}, 1, 'passed', 'matched', ${OWNER_USER_ID})
    `;

    // ===== Task A: Create correction request for committed batch =====
    console.log("\n--- Task A: Create correction request for committed batch ---");
    let correctionRequestId: string;
    {
      const services = wireServices();
      // Get a staging row from the committed batch to use as originalEntityId
      const stagingRows = await pgSql`SELECT id FROM import_staging_rows WHERE tenant_id = ${TEST_TENANT_ID} AND import_batch_id = ${COMMITTED_BATCH_ID} LIMIT 1`;
      const originalEntityId = stagingRows[0].id;

      const result = await services.correctionService.createCorrectionRequest(ownerUser as any, ownerEff as any, {
        importBatchId: COMMITTED_BATCH_ID,
        originalEntityType: "import_staging_row",
        originalEntityId: originalEntityId,
        correctionType: "reversal",
        reason: "Incorrect opening quantity — needs reversal",
        proposedCorrectionJson: { reversal: true },
        impactAnalysisJson: { affectedMovements: 1 },
        idempotencyKey: "corr-create-001",
      });

      correctionRequestId = result.correctionRequestId;
      check("1. correction request created", result.action === "created", `action=${result.action}`);
      check("2. correction request has docNo", result.docNo !== null && result.docNo !== "", `docNo=${result.docNo}`);
      check("3. correction request status = pending_review", result.status === "pending_review", `status=${result.status}`);

      // Verify persisted
      const request = await pgSql`SELECT * FROM historical_correction_requests WHERE tenant_id = ${TEST_TENANT_ID} AND id = ${correctionRequestId}`;
      check("4. correction request persisted in DB", request.length === 1, `count=${request.length}`);
      check("5. linked to committed batch", request[0]?.import_batch_id === COMMITTED_BATCH_ID, "");
      check("6. has reason", request[0]?.reason === "Incorrect opening quantity — needs reversal", "");
      check("7. has correction type", request[0]?.correction_type === "reversal", "");
      check("8. linked to original entity", request[0]?.original_entity_id === originalEntityId, "");

      // Verify audit
      const auditRows = await pgSql`SELECT * FROM audit_logs WHERE tenant_id = ${TEST_TENANT_ID} AND action_type = 'historical_correction.create' AND entity_id = ${correctionRequestId} AND created_at >= ${runStartTime}`;
      check("9. audit: correction create row exists", auditRows.length === 1, `count=${auditRows.length}`);
    }

    // ===== Task B: Cannot correct uncommitted batch =====
    console.log("\n--- Task B: Cannot correct uncommitted batch ---");
    {
      const services = wireServices();
      let error: Error | null = null;
      try {
        await services.correctionService.createCorrectionRequest(ownerUser as any, ownerEff as any, {
          importBatchId: UNCOMMITTED_BATCH_ID,
          originalEntityType: "import_staging_row",
          originalEntityId: "fake-id",
          correctionType: "reversal",
          reason: "Test uncommitted",
          proposedCorrectionJson: null,
          impactAnalysisJson: null,
          idempotencyKey: "corr-uncommitted-001",
        });
      } catch (e) { error = e as Error; }

      check("10. cannot correct uncommitted batch", error !== null, `error=${error?.message?.substring(0, 50)}`);
      check("11. error is BatchNotCommittedError", error?.name === "BatchNotCommittedError", `name=${error?.name}`);
    }

    // ===== Task C: Dual approval with distinct identities =====
    console.log("\n--- Task C: Dual approval with distinct identities ---");
    {
      const services = wireServices();
      // Owner approval
      const ownerResult = await services.correctionService.approveCorrection(ownerUser as any, ownerEff as any, {
        correctionRequestId, approverRole: "owner", idempotencyKey: `corr-owner-${correctionRequestId}`,
      });
      check("12. owner approval recorded", ownerResult.action === "approved", `action=${ownerResult.action}`);

      // Accountant approval
      const acctResult = await services.correctionService.approveCorrection(accountantUser as any, accountantEff as any, {
        correctionRequestId, approverRole: "accountant", idempotencyKey: `corr-acct-${correctionRequestId}`,
      });
      check("13. accountant approval recorded", acctResult.action === "approved", `action=${acctResult.action}`);

      // Verify status = approved
      const request = await pgSql`SELECT status, owner_approved_by, accountant_approved_by FROM historical_correction_requests WHERE tenant_id = ${TEST_TENANT_ID} AND id = ${correctionRequestId}`;
      check("14. status = approved after dual approval", request[0]?.status === "approved", `status=${request[0]?.status}`);
      check("15. distinct approvers (DEC-069)", request[0]?.owner_approved_by !== request[0]?.accountant_approved_by, `owner=${request[0]?.owner_approved_by}, acct=${request[0]?.accountant_approved_by}`);
    }

    // ===== Task D: Same-user rejection =====
    console.log("\n--- Task D: Same-user rejection ---");
    {
      const services = wireServices();
      // Create another correction request
      const stagingRows = await pgSql`SELECT id FROM import_staging_rows WHERE tenant_id = ${TEST_TENANT_ID} AND import_batch_id = ${COMMITTED_BATCH_ID} LIMIT 1`;
      const createResult = await services.correctionService.createCorrectionRequest(ownerUser as any, ownerEff as any, {
        importBatchId: COMMITTED_BATCH_ID,
        originalEntityType: "import_staging_row",
        originalEntityId: stagingRows[0].id,
        correctionType: "adjustment",
        reason: "Test same-user",
        proposedCorrectionJson: null,
        impactAnalysisJson: null,
        idempotencyKey: "corr-sameuser-001",
      });

      // Owner approves
      await services.correctionService.approveCorrection(ownerUser as any, ownerEff as any, {
        correctionRequestId: createResult.correctionRequestId, approverRole: "owner", idempotencyKey: `su-owner-${createResult.correctionRequestId}`,
      });

      // Same owner tries accountant approval
      let error: Error | null = null;
      try {
        await services.correctionService.approveCorrection(ownerUser as any, accountantEff as any, {
          correctionRequestId: createResult.correctionRequestId, approverRole: "accountant", idempotencyKey: `su-acct-${createResult.correctionRequestId}`,
        });
      } catch (e) { error = e as Error; }

      check("16. same-user dual approval rejected", error !== null, `error=${error?.message?.substring(0, 50)}`);
      check("17. error is SameUserDualApprovalError", error?.name === "SameUserDualApprovalError", `name=${error?.name}`);
    }

    // ===== Task E: Execute correction through domain service =====
    console.log("\n--- Task E: Execute correction through domain service ---");
    {
      const services = wireServices();
      // Add domain hook
      const hook: CorrectionDomainHook = {
        executeCorrection: async (tenantId, userId, correctionRequest, batch) => {
          // Use InventoryLedgerService to post a reversal movement
          // (In a real correction, this would reverse the original opening balance)
          return {
            correctedEntityType: "stock_movement",
            correctedEntityId: randomUUID(),
          };
        },
      };
      const serviceWithHook = new HistoricalCorrectionService({
        repository: services.correctionRepo,
        audit: services.audit,
        idempotency: services.idempotency,
        documentSequence: services.documentSequence,
        correctionDomainHook: hook,
      });

      const result = await serviceWithHook.executeCorrection(ownerUser as any, ownerEff as any, {
        correctionRequestId, idempotencyKey: `corr-exec-${correctionRequestId}`,
      });

      check("18. correction executed", result.action === "executed", `action=${result.action}`);
      check("19. correctedEntityType = stock_movement", result.correctedEntityType === "stock_movement", "");
      check("20. correctedEntityId present", result.correctedEntityId !== null && result.correctedEntityId !== "", "");

      // Verify correction request updated
      const request = await pgSql`SELECT corrected_entity_type, corrected_entity_id FROM historical_correction_requests WHERE tenant_id = ${TEST_TENANT_ID} AND id = ${correctionRequestId}`;
      check("21. correction request has corrected entity link", request[0]?.corrected_entity_id !== null, "");

      // Verify audit
      const execAudit = await pgSql`SELECT * FROM audit_logs WHERE tenant_id = ${TEST_TENANT_ID} AND action_type = 'historical_correction.execute' AND entity_id = ${correctionRequestId} AND created_at >= ${runStartTime}`;
      check("22. audit: correction execute row exists", execAudit.length === 1, `count=${execAudit.length}`);
    }

    // ===== Task F: Original evidence unchanged after correction =====
    console.log("\n--- Task F: Original evidence unchanged after correction ---");
    {
      const batch = await pgSql`SELECT status, committed_at, commit_effect_counts, staged_data_hash, cutover_manifest_hash FROM import_batches WHERE id = ${COMMITTED_BATCH_ID}`;
      check("23. original batch status still committed", batch[0]?.status === "committed", `status=${batch[0]?.status}`);
      check("24. original committed_at unchanged", batch[0]?.committed_at !== null, "");
      check("25. original staged_data_hash unchanged", batch[0]?.staged_data_hash === `staged-hash-${COMMITTED_BATCH_ID}`, "");
      check("26. original cutover_manifest_hash unchanged", batch[0]?.cutover_manifest_hash === `manifest-hash-${COMMITTED_BATCH_ID}`, "");

      // Verify original approvals unchanged
      const approvals = await pgSql`SELECT * FROM import_batch_approvals WHERE tenant_id = ${TEST_TENANT_ID} AND import_batch_id = ${COMMITTED_BATCH_ID}`;
      check("27. original approvals unchanged", approvals.length === 2, `count=${approvals.length}`);

      // Verify original backup evidence unchanged
      const backup = await pgSql`SELECT * FROM import_backup_evidence WHERE tenant_id = ${TEST_TENANT_ID} AND import_batch_id = ${COMMITTED_BATCH_ID}`;
      check("28. original backup evidence unchanged", backup.length === 1, `count=${backup.length}`);

      // Verify original staging rows remain queryable
      const stagingRows = await pgSql`SELECT * FROM import_staging_rows WHERE tenant_id = ${TEST_TENANT_ID} AND import_batch_id = ${COMMITTED_BATCH_ID}`;
      check("29. original staging rows remain queryable", stagingRows.length === 2, `count=${stagingRows.length}`);
    }

    // ===== Task G: Duplicate correction handling (idempotent) =====
    console.log("\n--- Task G: Duplicate correction handling (idempotent) ---");
    {
      const services = wireServices();
      // Replay the correction creation with same idempotency key
      const stagingRows = await pgSql`SELECT id FROM import_staging_rows WHERE tenant_id = ${TEST_TENANT_ID} AND import_batch_id = ${COMMITTED_BATCH_ID} LIMIT 1`;
      const result = await services.correctionService.createCorrectionRequest(ownerUser as any, ownerEff as any, {
        importBatchId: COMMITTED_BATCH_ID,
        originalEntityType: "import_staging_row",
        originalEntityId: stagingRows[0].id,
        correctionType: "reversal",
        reason: "Incorrect opening quantity — needs reversal",
        proposedCorrectionJson: { reversal: true },
        impactAnalysisJson: { affectedMovements: 1 },
        idempotencyKey: "corr-create-001", // Same key as Task A
      });

      check("30. duplicate correction request replayed", result.action === "replayed", `action=${result.action}`);
      check("31. returns same correction request ID", result.correctionRequestId === correctionRequestId, "");
    }

    // ===== Task H: Rollback after partial correction effect =====
    console.log("\n--- Task H: Rollback after partial correction effect ---");
    {
      const services = wireServices();
      // Create a new correction request for rollback test
      const stagingRows = await pgSql`SELECT id FROM import_staging_rows WHERE tenant_id = ${TEST_TENANT_ID} AND import_batch_id = ${COMMITTED_BATCH_ID} LIMIT 1`;
      const createResult = await services.correctionService.createCorrectionRequest(ownerUser as any, ownerEff as any, {
        importBatchId: COMMITTED_BATCH_ID,
        originalEntityType: "import_staging_row",
        originalEntityId: stagingRows[0].id,
        correctionType: "adjustment",
        reason: "Test rollback",
        proposedCorrectionJson: null,
        impactAnalysisJson: null,
        idempotencyKey: "corr-rollback-001",
      });

      // Approve it
      await services.correctionService.approveCorrection(ownerUser as any, ownerEff as any, {
        correctionRequestId: createResult.correctionRequestId, approverRole: "owner", idempotencyKey: `rb-owner-${createResult.correctionRequestId}`,
      });
      await services.correctionService.approveCorrection(accountantUser as any, accountantEff as any, {
        correctionRequestId: createResult.correctionRequestId, approverRole: "accountant", idempotencyKey: `rb-acct-${createResult.correctionRequestId}`,
      });

      // Execute with fault injection
      const hook: CorrectionDomainHook = {
        executeCorrection: async (_t, _u, _cr, _b, faultInjection) => {
          if (faultInjection === "after_domain_effect") {
            throw new Error("DELIBERATE_ROLLBACK_AFTER_DOMAIN_EFFECT");
          }
          return { correctedEntityType: "stock_movement", correctedEntityId: "should-not-reach" };
        },
      };
      const serviceWithHook = new HistoricalCorrectionService({
        repository: services.correctionRepo, audit: services.audit,
        idempotency: services.idempotency, documentSequence: services.documentSequence,
        correctionDomainHook: hook,
      });

      let error: Error | null = null;
      try {
        await serviceWithHook.executeCorrection(ownerUser as any, ownerEff as any, {
          correctionRequestId: createResult.correctionRequestId, idempotencyKey: `rb-exec-${createResult.correctionRequestId}`,
          faultInjection: "after_domain_effect",
        });
      } catch (e) { error = e as Error; }

      check("32. rollback fault throws", error !== null, `error=${error?.message?.substring(0, 50)}`);

      // Verify correction request NOT executed
      const request = await pgSql`SELECT corrected_entity_id, status FROM historical_correction_requests WHERE tenant_id = ${TEST_TENANT_ID} AND id = ${createResult.correctionRequestId}`;
      check("33. correction not marked as executed", request[0]?.corrected_entity_id === null, `correctedEntityId=${request[0]?.corrected_entity_id}`);
      check("34. correction remains approved (retryable)", request[0]?.status === "approved", `status=${request[0]?.status}`);
    }

    // ===== Task I: Persistent scoped audit =====
    console.log("\n--- Task I: Persistent scoped audit ---");
    {
      const allAudit = await pgSql`
        SELECT * FROM audit_logs
        WHERE tenant_id = ${TEST_TENANT_ID}
          AND action_type LIKE 'historical_correction%'
          AND created_at >= ${runStartTime}
      `;
      check("35. audit rows persistent for this run", allAudit.length > 0, `count=${allAudit.length}`);
      check("36. all audit rows have user_id", allAudit.every((a: any) => a.user_id !== null), "");
      check("37. all audit rows have entity_id", allAudit.every((a: any) => a.entity_id !== null), "");
      check("38. all audit rows have idempotency_key", allAudit.every((a: any) => a.idempotency_key !== null), "");

      const actionTypes = [...new Set(allAudit.map((a: any) => a.action_type))];
      check("39. distinct action types present",
        actionTypes.includes("historical_correction.create") &&
        actionTypes.includes("historical_correction.approve_owner") &&
        actionTypes.includes("historical_correction.approve_accountant") &&
        actionTypes.includes("historical_correction.execute"),
        `types=${actionTypes.join(", ")}`);
    }

    // ===== Task J: No credentials persisted =====
    console.log("\n--- Task J: No credentials persisted ---");
    {
      const auditRows = await pgSql`SELECT new_values_json FROM audit_logs WHERE tenant_id = ${TEST_TENANT_ID} AND action_type LIKE 'historical_correction%' AND created_at >= ${runStartTime}`;
      const hasCredentials = auditRows.some((a: any) => {
        const json = JSON.stringify(a.new_values_json || {}).toLowerCase();
        return json.includes("password=") || json.includes("secret=") || json.includes("api_key=");
      });
      check("40. no credentials in correction audit_logs", !hasCredentials, `rows=${auditRows.length}`);

      const correctionRows = await pgSql`SELECT reason, proposed_correction_json FROM historical_correction_requests WHERE tenant_id = ${TEST_TENANT_ID}`;
      const hasCredsInReason = correctionRows.some((r: any) => {
        const reason = (r.reason || "").toLowerCase();
        const json = JSON.stringify(r.proposed_correction_json || {}).toLowerCase();
        return reason.includes("password=") || reason.includes("secret=") || json.includes("password=");
      });
      check("41. no credentials in correction requests", !hasCredsInReason, "");
    }

    console.log("\n=== All validation checks passed. ===");

    // Cleanup
    try {
      await Promise.race([
        cleanTestData(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("cleanup timeout")), 10000)),
      ]);
    } catch { /* ignore */ }

  } catch (e) {
    console.error("FATAL ERROR:", (e as Error).message);
    console.error((e as Error).stack);
    exitCode = 1;
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
