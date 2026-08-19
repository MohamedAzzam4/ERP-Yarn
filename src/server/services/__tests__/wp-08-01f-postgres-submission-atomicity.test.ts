/**
 * WP-08-01F Milestone C Task 4 — Submission atomicity PostgreSQL proofs.
 *
 * Real PostgreSQL service-level tests exercising the actual
 * HistoricalReconciliationService.submitForApproval() production path
 * with real transaction-scoped repositories.
 *
 *   SUB-1. Success: submit review_required → pending_dual_approval, one
 *        scoped submit audit, idempotency succeeded.
 *   SUB-2. Real technical failure after first submit business write
 *        (updateBatchStatus): complete rollback, retryable_failed,
 *        immediate same-key retry succeeds.
 *   SUB-3. Real audit write failure: complete rollback, retryable_failed.
 *   SUB-4. Real owner-token loss: production fence rejects stale owner,
 *        full rollback of batch/audit.
 *   SUB-5. Same-key/same-payload replay: same response, zero additional
 *        effects.
 *   SUB-6. Same-key/different-payload conflict: rejected, zero additional
 *        effects on alternate batch.
 *   SUB-7. Durable business failure replay: business_failed, same key
 *        returns same failure, new key succeeds after fix.
 *   SUB-8. Concurrent submit vs rework: serialized on batch row lock,
 *        one coherent outcome (exactly one transition succeeds).
 *
 * Audit queries are scoped by tenant, entity type, entity ID, and action.
 * Never deletes audit_logs. Uses unique test-scoped tenants/entities.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/server/db/schema";
import { sql as drizzleSql } from "drizzle-orm";
import { HistoricalReconciliationService } from "@/server/services/historical-reconciliation-service";
import { HistoricalReconciliationDbRepository } from "@/server/services/historical-reconciliation-db-repository";
import { HistoricalCommitDbRepository } from "@/server/services/historical-commit-db-repository";
import { AuditDbRepository } from "@/server/services/audit-db-repository";
import { IdempotencyDbRepository } from "@/server/services/idempotency-db-repository";
import { resolveEffectivePermissions } from "@/server/security/effective-permissions";
import { TEST_ROLE_PERMISSION_MATRIX } from "@/server/security/role-fixtures";
import type { ErpUserContext } from "@/server/auth/erp-context";
import type { HistoricalReconciliationRepository } from "@/server/services/historical-reconciliation-repository";
import type { HistoricalCommitRepository } from "@/server/services/historical-commit-repository";
import type { AuditTransactionHandle } from "@/server/services/audit-service";
import type { IdempotencyTransactionHandle } from "@/server/services/idempotency-service";
import { checkDestructiveTestDbSafety } from "./destructive-test-guard";

const DATABASE_URL = process.env.DATABASE_URL;
const ALLOW_DESTRUCTIVE = process.env.ERP_ALLOW_DESTRUCTIVE_LOCAL_TEST_DB === "1";
const REQUIRE_PROOF = process.env.ERP_REQUIRE_WP0801F_POSTGRES_PROOF === "1";

const SAFETY_RESULT = checkDestructiveTestDbSafety({
  databaseUrl: DATABASE_URL,
  allowDestructive: ALLOW_DESTRUCTIVE,
  requireProof: REQUIRE_PROOF,
});
const describeOrSkip = SAFETY_RESULT.kind === "ok" ? describe : describe.skip;

let sql: ReturnType<typeof postgres>;
let db: any;

interface TestScope {
  tenantId: string;
  userId: string;
  runSuffix: string;
}

function newScope(): TestScope {
  const tenantId = randomUUID();
  const userId = randomUUID();
  const runSuffix = tenantId.slice(0, 8);
  return { tenantId, userId, runSuffix };
}

function makeUser(scope: TestScope): ErpUserContext {
  return { authenticated: true, userId: scope.userId, tenantId: scope.tenantId, authId: `auth-${scope.userId}`, name: "T", email: `t-${scope.userId}@test.local` };
}
function makeEffective() {
  return resolveEffectivePermissions(["owner"], TEST_ROLE_PERMISSION_MATRIX);
}

function makeServices(scope: TestScope, faultyTransactionRunner?: <T>(work: (tx: unknown) => Promise<T>) => Promise<T>) {
  const reconRepo = new HistoricalReconciliationDbRepository(db);
  const commitRepo = new HistoricalCommitDbRepository(db);
  const audit = new AuditDbRepository(db);
  const idem = new IdempotencyDbRepository(db);
  const transactionRunner = faultyTransactionRunner ?? (async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
    (db as any).transaction(async (tx: any) => work(tx)));
  const reconciliationService = new HistoricalReconciliationService({
    repository: reconRepo, audit, idempotency: idem, commitRepository: commitRepo,
    transactionRunner,
    createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
    createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
    createReconciliationRepository: (tx: unknown) => new HistoricalReconciliationDbRepository(tx as any),
    createCommitRepository: (tx: unknown) => new HistoricalCommitDbRepository(tx as any),
  });
  return { reconciliationService, reconRepo, commitRepo, audit, idem };
}

// Real owner-token loss wrapper (same pattern as RW/VA/RCA tests).
// Overwrites owner_token in the tx BEFORE updateState runs, so the
// owner-fenced UPDATE in markSucceeded returns 0 rows and throws
// IdempotencyOwnershipLostError — which rolls back the entire transaction.
function makeRealOwnerLossIdempotencyWrapper(realIdem: IdempotencyDbRepository, tx: any): IdempotencyTransactionHandle {
  return {
    findByTenantScopeKey: (t: string, s: string, k: string) => realIdem.findByTenantScopeKey(t, s, k),
    insert: (r: any) => realIdem.insert(r),
    claimExpiredLease: (id: string, a: Date, b: Date, c: Date) => realIdem.claimExpiredLease(id, a, b, c),
    heartbeat: (id: string, n: Date) => realIdem.heartbeat(id, n),
    updateState: async (id: string, update: any) => {
      const newToken = 'stale-' + randomUUID();
      await (tx as any).execute(drizzleSql`UPDATE idempotency_records SET owner_token = ${newToken} WHERE id = ${id}`);
      return realIdem.updateState(id, update);
    },
  };
}

// First-write failure wrapper for submit: throws AFTER updateBatchStatus
// (the first business write in submitForApproval) completes. The
// transaction rolls back, the outer catch marks retryable_failed.
function makeSubmitFirstWriteFailureRepoWrapper(realRepo: HistoricalReconciliationRepository): HistoricalReconciliationRepository {
  let callCount = 0;
  const wrapped: HistoricalReconciliationRepository = {
    findImportBatchById: (t: string, id: string) => realRepo.findImportBatchById(t, id),
    updateBatchStatus: async (t: string, id: string, s: string) => {
      const result = await realRepo.updateBatchStatus(t, id, s);
      callCount++;
      if (callCount === 1) {
        throw new Error("INJECTED_FAILURE_AFTER_FIRST_SUBMIT_WRITE");
      }
      return result;
    },
    updateBatchReconciliationStatus: (t: string, id: string, s: string, u: string) => realRepo.updateBatchReconciliationStatus(t, id, s, u),
    resetBatchValidationAndReconciliationStatuses: (t: string, id: string) => realRepo.resetBatchValidationAndReconciliationStatuses(t, id),
    findStagingRowsForBatch: (t: string, id: string) => realRepo.findStagingRowsForBatch(t, id),
    findLatestReportVersion: (t: string, id: string) => realRepo.findLatestReportVersion(t, id),
    insertReconciliationResult: (row: any) => realRepo.insertReconciliationResult(row),
    insertReviewItem: (row: any) => realRepo.insertReviewItem(row),
    findReconciliationResultsForBatch: (t: string, id: string) => realRepo.findReconciliationResultsForBatch(t, id),
    findReconciliationResultsForBatchVersion: (t: string, id: string, v: number) => realRepo.findReconciliationResultsForBatchVersion(t, id, v),
    findReviewItemsForBatch: (t: string, id: string) => realRepo.findReviewItemsForBatch(t, id),
    findReviewItemsForBatchVersion: (t: string, id: string) => realRepo.findReviewItemsForBatchVersion(t, id),
    findReviewItemById: (t: string, id: string) => realRepo.findReviewItemById(t, id),
    updateReviewItemDecision: (t: string, id: string, p: any) => realRepo.updateReviewItemDecision(t, id, p),
    supersedeReviewItemsForBatch: (t: string, id: string, b: string, r: string) => realRepo.supersedeReviewItemsForBatch(t, id, b, r),
    findCurrentReviewItemsForBatch: (t: string, id: string) => realRepo.findCurrentReviewItemsForBatch(t, id),
  };
  return wrapped;
}

// Audit-failure handle: insertAuditLog throws, simulating a real audit
// write failure AFTER the batch status transition. The transaction rolls
// back, the outer catch marks retryable_failed.
function makeAuditFailureHandle(): AuditTransactionHandle {
  return {
    insertAuditLog: async (_row: any) => {
      throw new Error("INJECTED_AUDIT_FAILURE");
    },
  };
}

async function seedTenantAndUser(scope: TestScope) {
  const runSuffix = scope.runSuffix;
  await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status)
            VALUES (${scope.tenantId}, ${"SUB-" + runSuffix}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference)
            VALUES (${scope.userId}, ${scope.tenantId}, ${"sub-" + runSuffix}, ${"SUB User"}, ${"sub-" + runSuffix + "@test.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
}

// Seed a batch in `review_required` state with all submit prerequisites:
// validation_status=passed, reconciliation_status=matched,
// staged_data_hash present, cutover_manifest_hash present.
async function seedReviewRequiredBatch(scope: TestScope, batchId: string) {
  await sql`
    INSERT INTO import_batches (id, tenant_id, batch_no, status, source_description, template_name, template_version,
      mapping_version, cutover_manifest_hash, cutover_import_mode, staged_data_hash, staged_row_count,
      blocking_error_count, warning_count, accepted_warning_count, validation_status, reconciliation_status,
      warning_summary, committed_at, commit_effect_counts, created_by, created_at)
    VALUES (${batchId}, ${scope.tenantId}, ${"SUB-" + batchId.slice(-6)}, ${"review_required"}::import_batch_status, ${"test"},
      ${"opening_balance_inventory"}, ${"1.0"}, ${"1.0"}, ${"sha256:manifest"}, ${"opening_balance"}, ${"sha256:test"}, 1,
      0, 0, 0, ${"passed"}, ${"matched"}, null, null, null, ${scope.userId}, NOW())`;
}

async function seedFileAndStagingRow(scope: TestScope, batchId: string): Promise<string> {
  const fileId = randomUUID();
  await sql`
    INSERT INTO import_files (id, tenant_id, import_batch_id, original_file_name, storage_path, file_hash,
      file_size_bytes, content_type, file_type, file_version, is_current, created_by, created_at)
    VALUES (${fileId}, ${scope.tenantId}, ${batchId}, ${"data.csv"}, ${"local://test"}, ${"sha256:test"},
      100, ${"text/csv"}, ${"source"}, 1, true, ${scope.userId}, NOW())`;
  const rowId = randomUUID();
  const rowData = { name: "TestYarn", code: "TY001", quantity: "100", entity_type: "single_yarn", customer_id: "cust-001" };
  await sql`
    INSERT INTO import_staging_rows (id, tenant_id, import_batch_id, import_file_id, template_name,
      source_sheet_name, source_row_number, raw_row_json, transformed_row_json,
      transformation_notes, validation_status, review_status, ai_confidence,
      committed_entity_type, committed_entity_id, staging_version, is_current,
      created_by, created_at)
    VALUES (${rowId}, ${scope.tenantId}, ${batchId}, ${fileId}, ${"opening_balance_inventory"}, ${"data.csv"}, 1,
      ${JSON.stringify(rowData)}::jsonb,
      ${JSON.stringify(rowData)}::jsonb,
      null, ${"pending"}, ${"not_required"}, null, null, null, 1, true, ${scope.userId}, NOW())`;
  return fileId;
}

// Seed prior reconciliation evidence (version 1, status='matched') so the
// submit "no blocking results" prerequisite is satisfied.
async function seedPriorReconciliationEvidence(scope: TestScope, batchId: string, reportVersion: number = 1) {
  const resultId = randomUUID();
  await sql`
    INSERT INTO import_reconciliation_results (id, tenant_id, import_batch_id, report_version, metric_key,
      expected_value, staged_value, committed_value, difference_value, status, notes, created_by, created_at)
    VALUES (${resultId}, ${scope.tenantId}, ${batchId}, ${reportVersion}, ${"inventory_opening_qty"},
      null, ${"100"}, null, null, ${"matched"}, ${"Original review reason evidence"}, ${scope.userId}, NOW())`;
  return resultId;
}

// Seed a RESOLVED review item (status='resolved', is_current=true) so the
// submit "all review items resolved" prerequisite is satisfied.
async function seedResolvedReviewItem(scope: TestScope, batchId: string, reason: string = "resolved review item") {
  const reviewItemId = randomUUID();
  await sql`
    INSERT INTO import_human_review_items (id, tenant_id, import_batch_id, staging_row_id, review_reason,
      status, is_current, report_version, created_by, created_at)
    VALUES (${reviewItemId}, ${scope.tenantId}, ${batchId}, null, ${reason},
      ${"resolved"}::review_item_decision, true, 1, ${scope.userId}, NOW())`;
  return reviewItemId;
}

// Seed backup evidence (Contract 08 §8.9 — required before submission).
async function seedBackupEvidence(scope: TestScope, batchId: string) {
  await sql`
    INSERT INTO import_backup_evidence (id, tenant_id, import_batch_id, backup_type, backup_location, backup_hash, backup_size_bytes, backup_created_at, verification_notes, created_by, created_at, updated_at, updated_by)
    VALUES (${randomUUID()}, ${scope.tenantId}, ${batchId}, ${"full"}, ${"s3://b/backup"}, ${"backup-hash"}, 1000, NOW(), ${"verified"}, ${scope.userId}, NOW(), null, null)`;
}

async function getBatchState(scope: TestScope, batchId: string) {
  const rows = await sql`SELECT status, reconciliation_status, validation_status, staged_data_hash, cutover_manifest_hash, committed_at FROM import_batches WHERE id = ${batchId} AND tenant_id = ${scope.tenantId}`;
  return rows[0] || null;
}

async function getScopedAuditCount(scope: TestScope, batchId: string, actionType?: string) {
  if (actionType) {
    const rows = await sql`SELECT count(*)::int AS c FROM audit_logs WHERE tenant_id = ${scope.tenantId} AND entity_id = ${batchId} AND action_type = ${actionType}`;
    return rows[0]?.c || 0;
  }
  const rows = await sql`SELECT count(*)::int AS c FROM audit_logs WHERE tenant_id = ${scope.tenantId} AND entity_id = ${batchId}`;
  return rows[0]?.c || 0;
}

async function getIdemState(scope: TestScope, idemKey: string) {
  const rows = await sql`SELECT state, response_body FROM idempotency_records WHERE tenant_id = ${scope.tenantId} AND idempotency_key = ${idemKey}`;
  return rows[0] || null;
}

async function getReconResultCount(scope: TestScope, batchId: string) {
  const rows = await sql`SELECT count(*)::int AS c FROM import_reconciliation_results WHERE tenant_id = ${scope.tenantId} AND import_batch_id = ${batchId}`;
  return rows[0]?.c || 0;
}

async function cleanupScope(scope: TestScope) {
  await sql`DELETE FROM import_cutover_locks WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM import_backup_evidence WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM import_batch_approvals WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM import_human_review_items WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM import_reconciliation_results WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM import_validation_errors WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM import_alias_mappings WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM import_staging_cells WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM import_staging_rows WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM import_cutover_manifests WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM import_files WHERE tenant_id = ${scope.tenantId}`;
  // WP-08-01F DEFECT 6/7 — clean up master-data rows seeded by the
  // alias revalidation tests (customers). Deleted per-tenant — no risk
  // to other tests because each test uses a unique tenantId.
  await sql`DELETE FROM customers WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM import_batches WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM idempotency_records WHERE tenant_id = ${scope.tenantId}`;
  // NOTE: audit_logs, users, tenants intentionally NOT deleted (immutable).
}

describeOrSkip("WP-08-01F Task 4 — Submission atomicity PostgreSQL proofs (SUB-1 through SUB-8)", () => {
  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { prepare: false, max: 5, idle_timeout: 10, connect_timeout: 15 });
    db = drizzle(sql, { schema });
  }, 30000);

  afterAll(async () => {
    if (sql) { await sql.end(); }
  }, 30000);

  // ===========================================================================
  // SUB-1 — SUCCESS
  // ===========================================================================
  it("SUB-1. success: submit review_required→pending_dual_approval, one scoped submit audit, idempotency succeeded", async () => {
    const scope = newScope();
    await seedTenantAndUser(scope);
    const batchId = randomUUID();
    await seedReviewRequiredBatch(scope, batchId);
    await seedFileAndStagingRow(scope, batchId);
    await seedPriorReconciliationEvidence(scope, batchId, 1);
    await seedResolvedReviewItem(scope, batchId, "resolved review item");
    await seedBackupEvidence(scope, batchId);

    const idemKey = "sub1-success-" + randomUUID();
    const { reconciliationService } = makeServices(scope);
    const auditBefore = await getScopedAuditCount(scope, batchId, "historical_migration.submit_for_approval");

    const result = await reconciliationService.submitForApproval(
      makeUser(scope) as any, makeEffective() as any,
      { importBatchId: batchId, warningSummary: null, idempotencyKey: idemKey },
    );

    expect(result.action).toBe("submitted");
    expect(result.previousStatus).toBe("review_required");
    expect(result.newStatus).toBe("pending_dual_approval");

    // Batch transitioned to pending_dual_approval.
    const batch = await getBatchState(scope, batchId);
    expect(batch!.status).toBe("pending_dual_approval");

    // Exactly one scoped submit audit.
    const auditAfter = await getScopedAuditCount(scope, batchId, "historical_migration.submit_for_approval");
    expect(auditAfter).toBe(auditBefore + 1);
    expect(auditAfter).toBe(1);

    // Idempotency succeeded.
    const idemState = await getIdemState(scope, idemKey);
    expect(idemState?.state).toBe("succeeded");

    await cleanupScope(scope);
  });

  // ===========================================================================
  // SUB-2 — REAL TECHNICAL FAILURE AFTER FIRST SUBMIT BUSINESS WRITE
  // ===========================================================================
  it("SUB-2. real failure after first submit write (updateBatchStatus): full rollback, retryable_failed, immediate retry succeeds", async () => {
    const scope = newScope();
    await seedTenantAndUser(scope);
    const batchId = randomUUID();
    await seedReviewRequiredBatch(scope, batchId);
    await seedFileAndStagingRow(scope, batchId);
    await seedPriorReconciliationEvidence(scope, batchId, 1);
    await seedResolvedReviewItem(scope, batchId, "resolved review item");
    await seedBackupEvidence(scope, batchId);

    const idemKey = "sub2-failure-" + randomUUID();
    const auditBefore = await getScopedAuditCount(scope, batchId, "historical_migration.submit_for_approval");
    const batchBefore = await getBatchState(scope, batchId);
    const resultsBefore = await getReconResultCount(scope, batchId);

    const reconRepo = new HistoricalReconciliationDbRepository(db);
    const commitRepo = new HistoricalCommitDbRepository(db);
    const audit = new AuditDbRepository(db);
    const idem = new IdempotencyDbRepository(db);
    const customService = new HistoricalReconciliationService({
      repository: reconRepo, audit, idempotency: idem, commitRepository: commitRepo,
      transactionRunner: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
        (db as any).transaction(async (tx: any) => {
          await (tx as any).execute(drizzleSql`SELECT id FROM import_batches WHERE tenant_id = ${scope.tenantId} AND id = ${batchId} FOR UPDATE`);
          await work(tx);
        }),
      createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
      createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
      createReconciliationRepository: (tx: unknown) => makeSubmitFirstWriteFailureRepoWrapper(new HistoricalReconciliationDbRepository(tx as any)),
      createCommitRepository: (tx: unknown) => new HistoricalCommitDbRepository(tx as any),
    });

    await expect(
      customService.submitForApproval(
        makeUser(scope) as any, makeEffective() as any,
        { importBatchId: batchId, warningSummary: null, idempotencyKey: idemKey },
      ),
    ).rejects.toThrow(/INJECTED_FAILURE_AFTER_FIRST_SUBMIT_WRITE/);

    // Full rollback: batch unchanged.
    const batchAfter = await getBatchState(scope, batchId);
    expect(batchAfter!.status).toBe(batchBefore!.status);
    expect(batchAfter!.validation_status).toBe(batchBefore!.validation_status);
    expect(batchAfter!.reconciliation_status).toBe(batchBefore!.reconciliation_status);

    // Full rollback: results unchanged.
    const resultsAfter = await getReconResultCount(scope, batchId);
    expect(resultsAfter).toBe(resultsBefore);

    // Full rollback: audit delta = 0.
    const auditAfter = await getScopedAuditCount(scope, batchId, "historical_migration.submit_for_approval");
    expect(auditAfter).toBe(auditBefore);
    expect(auditAfter).toBe(0);

    // Idempotency state = retryable_failed (exact).
    const idemState = await getIdemState(scope, idemKey);
    expect(idemState).not.toBeNull();
    expect(idemState!.state).toBe("retryable_failed");

    // Immediate same-key retry WITHOUT manual lease expiry.
    // retryable_failed is reclaimable.
    const { reconciliationService: goodService } = makeServices(scope);
    const retryResult = await goodService.submitForApproval(
      makeUser(scope) as any, makeEffective() as any,
      { importBatchId: batchId, warningSummary: null, idempotencyKey: idemKey },
    );
    expect(retryResult.action).toBe("submitted");

    // Exactly one submit audit (not duplicated by the failed attempt).
    const auditAfterRetry = await getScopedAuditCount(scope, batchId, "historical_migration.submit_for_approval");
    expect(auditAfterRetry).toBe(auditBefore + 1);
    expect(auditAfterRetry).toBe(1);

    // Idempotency succeeded after retry.
    const idemAfterRetry = await getIdemState(scope, idemKey);
    expect(idemAfterRetry!.state).toBe("succeeded");

    await cleanupScope(scope);
  });

  // ===========================================================================
  // SUB-3 — REAL AUDIT WRITE FAILURE
  // ===========================================================================
  it("SUB-3. real audit failure: full rollback, retryable_failed", async () => {
    const scope = newScope();
    await seedTenantAndUser(scope);
    const batchId = randomUUID();
    await seedReviewRequiredBatch(scope, batchId);
    await seedFileAndStagingRow(scope, batchId);
    await seedPriorReconciliationEvidence(scope, batchId, 1);
    await seedResolvedReviewItem(scope, batchId, "resolved review item");
    await seedBackupEvidence(scope, batchId);

    const idemKey = "sub3-audit-fail-" + randomUUID();
    const auditBefore = await getScopedAuditCount(scope, batchId, "historical_migration.submit_for_approval");
    const batchBefore = await getBatchState(scope, batchId);
    const resultsBefore = await getReconResultCount(scope, batchId);

    const reconRepo = new HistoricalReconciliationDbRepository(db);
    const commitRepo = new HistoricalCommitDbRepository(db);
    const audit = new AuditDbRepository(db);
    const idem = new IdempotencyDbRepository(db);
    const customService = new HistoricalReconciliationService({
      repository: reconRepo, audit, idempotency: idem, commitRepository: commitRepo,
      transactionRunner: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
        (db as any).transaction(async (tx: any) => {
          await (tx as any).execute(drizzleSql`SELECT id FROM import_batches WHERE tenant_id = ${scope.tenantId} AND id = ${batchId} FOR UPDATE`);
          await work(tx);
        }),
      createAudit: (_tx: unknown) => makeAuditFailureHandle(),
      createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
      createReconciliationRepository: (tx: unknown) => new HistoricalReconciliationDbRepository(tx as any),
      createCommitRepository: (tx: unknown) => new HistoricalCommitDbRepository(tx as any),
    });

    await expect(
      customService.submitForApproval(
        makeUser(scope) as any, makeEffective() as any,
        { importBatchId: batchId, warningSummary: null, idempotencyKey: idemKey },
      ),
    ).rejects.toThrow(/INJECTED_AUDIT_FAILURE|Required audit write failed/i);

    // Full rollback: batch unchanged.
    const batchAfter = await getBatchState(scope, batchId);
    expect(batchAfter!.status).toBe(batchBefore!.status);
    expect(batchAfter!.validation_status).toBe(batchBefore!.validation_status);
    expect(batchAfter!.reconciliation_status).toBe(batchBefore!.reconciliation_status);

    // Full rollback: results unchanged.
    const resultsAfter = await getReconResultCount(scope, batchId);
    expect(resultsAfter).toBe(resultsBefore);

    // Full rollback: audit delta = 0.
    const auditAfter = await getScopedAuditCount(scope, batchId, "historical_migration.submit_for_approval");
    expect(auditAfter).toBe(auditBefore);
    expect(auditAfter).toBe(0);

    // Idempotency state = retryable_failed (exact).
    const idemState = await getIdemState(scope, idemKey);
    expect(idemState).not.toBeNull();
    expect(idemState!.state).toBe("retryable_failed");

    await cleanupScope(scope);
  });

  // ===========================================================================
  // SUB-4 — REAL OWNER-TOKEN LOSS
  // ===========================================================================
  it("SUB-4. real owner-token loss: production fence rejects stale owner, full rollback of batch/audit", async () => {
    const scope = newScope();
    await seedTenantAndUser(scope);
    const batchId = randomUUID();
    await seedReviewRequiredBatch(scope, batchId);
    await seedFileAndStagingRow(scope, batchId);
    await seedPriorReconciliationEvidence(scope, batchId, 1);
    await seedResolvedReviewItem(scope, batchId, "resolved review item");
    await seedBackupEvidence(scope, batchId);

    const idemKey = "sub4-owner-loss-" + randomUUID();
    const auditBefore = await getScopedAuditCount(scope, batchId, "historical_migration.submit_for_approval");
    const batchBefore = await getBatchState(scope, batchId);

    const reconRepo = new HistoricalReconciliationDbRepository(db);
    const commitRepo = new HistoricalCommitDbRepository(db);
    const audit = new AuditDbRepository(db);
    const idem = new IdempotencyDbRepository(db);
    const customService = new HistoricalReconciliationService({
      repository: reconRepo, audit, idempotency: idem, commitRepository: commitRepo,
      transactionRunner: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
        (db as any).transaction(async (tx: any) => {
          await (tx as any).execute(drizzleSql`SELECT id FROM import_batches WHERE tenant_id = ${scope.tenantId} AND id = ${batchId} FOR UPDATE`);
          await work(tx);
        }),
      createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
      createIdempotency: (tx: unknown) => makeRealOwnerLossIdempotencyWrapper(new IdempotencyDbRepository(tx as any), tx as any),
      createReconciliationRepository: (tx: unknown) => new HistoricalReconciliationDbRepository(tx as any),
      createCommitRepository: (tx: unknown) => new HistoricalCommitDbRepository(tx as any),
    });

    await expect(
      customService.submitForApproval(
        makeUser(scope) as any, makeEffective() as any,
        { importBatchId: batchId, warningSummary: null, idempotencyKey: idemKey },
      ),
    ).rejects.toThrow(/owner.*token|ownership/i);

    // Full rollback: batch unchanged.
    const batchAfter = await getBatchState(scope, batchId);
    expect(batchAfter!.status).toBe(batchBefore!.status);
    expect(batchAfter!.reconciliation_status).toBe(batchBefore!.reconciliation_status);

    // Full rollback: audit delta = 0.
    const auditAfter = await getScopedAuditCount(scope, batchId, "historical_migration.submit_for_approval");
    expect(auditAfter).toBe(auditBefore);
    expect(auditAfter).toBe(0);

    // Idempotency not succeeded.
    const idemState = await getIdemState(scope, idemKey);
    if (idemState) { expect(idemState.state).not.toBe("succeeded"); }

    await cleanupScope(scope);
  });

  // ===========================================================================
  // SUB-5 — SAME-KEY/SAME-PAYLOAD REPLAY
  // ===========================================================================
  it("SUB-5. replay: same response, zero additional batch/audit effects", async () => {
    const scope = newScope();
    await seedTenantAndUser(scope);
    const batchId = randomUUID();
    await seedReviewRequiredBatch(scope, batchId);
    await seedFileAndStagingRow(scope, batchId);
    await seedPriorReconciliationEvidence(scope, batchId, 1);
    await seedResolvedReviewItem(scope, batchId, "resolved review item");
    await seedBackupEvidence(scope, batchId);

    const idemKey = "sub5-replay-" + randomUUID();
    const { reconciliationService } = makeServices(scope);

    // Step 1: initial submit.
    const initialResult = await reconciliationService.submitForApproval(
      makeUser(scope) as any, makeEffective() as any,
      { importBatchId: batchId, warningSummary: null, idempotencyKey: idemKey },
    );
    expect(initialResult.action).toBe("submitted");

    const auditAfterInitial = await getScopedAuditCount(scope, batchId, "historical_migration.submit_for_approval");
    const idemAfterInitial = await getIdemState(scope, idemKey);
    const batchAfterInitial = await getBatchState(scope, batchId);

    // Step 2: replay with same key + same payload.
    const replayResult = await reconciliationService.submitForApproval(
      makeUser(scope) as any, makeEffective() as any,
      { importBatchId: batchId, warningSummary: null, idempotencyKey: idemKey },
    );
    expect(replayResult.action).toBe("replayed");

    // Same persisted response_body.
    const idemAfterReplay = await getIdemState(scope, idemKey);
    expect(idemAfterReplay?.state).toBe("succeeded");
    expect(JSON.stringify(idemAfterReplay?.response_body)).toBe(JSON.stringify(idemAfterInitial?.response_body));

    // Zero additional audits.
    expect(await getScopedAuditCount(scope, batchId, "historical_migration.submit_for_approval")).toBe(auditAfterInitial);

    // Batch state unchanged from replay.
    const batchAfterReplay = await getBatchState(scope, batchId);
    expect(batchAfterReplay!.status).toBe(batchAfterInitial!.status);

    await cleanupScope(scope);
  });

  // ===========================================================================
  // SUB-6 — SAME-KEY/DIFFERENT-PAYLOAD CONFLICT
  // ===========================================================================
  it("SUB-6. conflict: same key + different payload → rejected, zero effects on alternate batch", async () => {
    const scope = newScope();
    await seedTenantAndUser(scope);
    const batchId1 = randomUUID();
    await seedReviewRequiredBatch(scope, batchId1);
    await seedFileAndStagingRow(scope, batchId1);
    await seedPriorReconciliationEvidence(scope, batchId1, 1);
    await seedResolvedReviewItem(scope, batchId1, "batch1 resolved item");
    await seedBackupEvidence(scope, batchId1);

    const batchId2 = randomUUID();
    await seedReviewRequiredBatch(scope, batchId2);
    await seedFileAndStagingRow(scope, batchId2);
    await seedPriorReconciliationEvidence(scope, batchId2, 1);
    await seedResolvedReviewItem(scope, batchId2, "batch2 resolved item");
    await seedBackupEvidence(scope, batchId2);

    const idemKey = "sub6-conflict-" + randomUUID();
    const { reconciliationService } = makeServices(scope);

    // Step 1: initial submit on batch1.
    const initialResult = await reconciliationService.submitForApproval(
      makeUser(scope) as any, makeEffective() as any,
      { importBatchId: batchId1, warningSummary: null, idempotencyKey: idemKey },
    );
    expect(initialResult.action).toBe("submitted");

    const audit1AfterInitial = await getScopedAuditCount(scope, batchId1, "historical_migration.submit_for_approval");
    const audit2AfterInitial = await getScopedAuditCount(scope, batchId2, "historical_migration.submit_for_approval");
    const batch2StateBefore = await getBatchState(scope, batchId2);

    // Step 2: same key, different payload (batch2 instead of batch1).
    await expect(
      reconciliationService.submitForApproval(
        makeUser(scope) as any, makeEffective() as any,
        { importBatchId: batchId2, warningSummary: null, idempotencyKey: idemKey },
      ),
    ).rejects.toThrow(/IDEMPOTENCY_CONFLICT|conflict/i);

    // Zero additional effects on batch1.
    expect(await getScopedAuditCount(scope, batchId1, "historical_migration.submit_for_approval")).toBe(audit1AfterInitial);

    // Zero additional effects on batch2 (never written).
    expect(await getScopedAuditCount(scope, batchId2, "historical_migration.submit_for_approval")).toBe(audit2AfterInitial);
    expect(await getScopedAuditCount(scope, batchId2, "historical_migration.submit_for_approval")).toBe(0);

    // Batch2 state unchanged.
    const batch2StateAfter = await getBatchState(scope, batchId2);
    expect(batch2StateAfter!.status).toBe(batch2StateBefore!.status);

    await cleanupScope(scope);
  });

  // ===========================================================================
  // SUB-7 — DURABLE BUSINESS FAILURE REPLAY
  // ===========================================================================
  it("SUB-7. durable business failure replay: business_failed, same key returns same failure, new key succeeds after fix", async () => {
    const scope = newScope();
    await seedTenantAndUser(scope);
    const batchId = randomUUID();
    await seedReviewRequiredBatch(scope, batchId);
    await seedFileAndStagingRow(scope, batchId);
    await seedPriorReconciliationEvidence(scope, batchId, 1);
    await seedResolvedReviewItem(scope, batchId, "resolved review item");
    await seedBackupEvidence(scope, batchId);

    // Break the staged_data_hash prerequisite to trigger
    // MissingStagedDataHashError (a durable business failure).
    await sql`UPDATE import_batches SET staged_data_hash = null WHERE tenant_id = ${scope.tenantId} AND id = ${batchId}`;

    const idemKey = "sub7-business-fail-" + randomUUID();
    const auditBefore = await getScopedAuditCount(scope, batchId, "historical_migration.submit_for_approval");
    const batchBefore = await getBatchState(scope, batchId);

    const { reconciliationService } = makeServices(scope);

    // Step 1: initial submit fails with MissingStagedDataHashError.
    await expect(
      reconciliationService.submitForApproval(
        makeUser(scope) as any, makeEffective() as any,
        { importBatchId: batchId, warningSummary: null, idempotencyKey: idemKey },
      ),
    ).rejects.toThrow(/staged.*data.*hash|MissingStagedDataHash/i);

    // Batch unchanged (rolled back).
    const batchAfter = await getBatchState(scope, batchId);
    expect(batchAfter!.status).toBe(batchBefore!.status);
    expect(batchAfter!.staged_data_hash).toBeNull();

    // Audit delta = 0.
    const auditAfter = await getScopedAuditCount(scope, batchId, "historical_migration.submit_for_approval");
    expect(auditAfter).toBe(auditBefore);
    expect(auditAfter).toBe(0);

    // Idempotency state = business_failed (durable).
    const idemState = await getIdemState(scope, idemKey);
    expect(idemState).not.toBeNull();
    expect(idemState!.state).toBe("business_failed");

    // Step 2: same key + same payload → returns the SAME business failure
    // (durable replay, not a re-execution).
    await expect(
      reconciliationService.submitForApproval(
        makeUser(scope) as any, makeEffective() as any,
        { importBatchId: batchId, warningSummary: null, idempotencyKey: idemKey },
      ),
    ).rejects.toThrow(/staged.*data.*hash|MissingStagedDataHash/i);

    // Still business_failed (not re-executed).
    const idemStateAfterReplay = await getIdemState(scope, idemKey);
    expect(idemStateAfterReplay!.state).toBe("business_failed");

    // Still zero audits.
    expect(await getScopedAuditCount(scope, batchId, "historical_migration.submit_for_approval")).toBe(0);

    // Step 3: fix the batch (restore staged_data_hash), then call with a
    // NEW idempotency key. This must succeed because the operator used a
    // new key after fixing the prerequisite.
    await sql`UPDATE import_batches SET staged_data_hash = ${"sha256:test"} WHERE tenant_id = ${scope.tenantId} AND id = ${batchId}`;

    const newIdemKey = "sub7-retry-" + randomUUID();
    const retryResult = await reconciliationService.submitForApproval(
      makeUser(scope) as any, makeEffective() as any,
      { importBatchId: batchId, warningSummary: null, idempotencyKey: newIdemKey },
    );
    expect(retryResult.action).toBe("submitted");
    expect(retryResult.newStatus).toBe("pending_dual_approval");

    // Batch transitioned to pending_dual_approval.
    const batchAfterFix = await getBatchState(scope, batchId);
    expect(batchAfterFix!.status).toBe("pending_dual_approval");

    // Exactly one submit audit (from the successful new-key call).
    const auditAfterFix = await getScopedAuditCount(scope, batchId, "historical_migration.submit_for_approval");
    expect(auditAfterFix).toBe(1);

    // New key succeeded.
    const idemStateNewKey = await getIdemState(scope, newIdemKey);
    expect(idemStateNewKey?.state).toBe("succeeded");

    // Old key is still business_failed (durable).
    const idemStateOldKey = await getIdemState(scope, idemKey);
    expect(idemStateOldKey?.state).toBe("business_failed");

    await cleanupScope(scope);
  });

  // ===========================================================================
  // SUB-8 — CONCURRENT SUBMIT VS REWORK (SERIALIZED ON BATCH LOCK)
  // ===========================================================================
  it("SUB-8. concurrent submit vs rework: serialized on batch lock, one coherent outcome", async () => {
    const scope = newScope();
    await seedTenantAndUser(scope);
    const batchId = randomUUID();
    await seedReviewRequiredBatch(scope, batchId);
    await seedFileAndStagingRow(scope, batchId);
    await seedPriorReconciliationEvidence(scope, batchId, 1);
    await seedResolvedReviewItem(scope, batchId, "resolved review item");
    await seedBackupEvidence(scope, batchId);

    const submitKey = "sub8-submit-" + randomUUID();
    const reworkKey = "sub8-rework-" + randomUUID();
    const { reconciliationService } = makeServices(scope);

    const auditBeforeSubmit = await getScopedAuditCount(scope, batchId, "historical_migration.submit_for_approval");
    const auditBeforeRework = await getScopedAuditCount(scope, batchId, "historical_migration.rework");

    // Issue both concurrently. Both will attempt SELECT ... FOR UPDATE
    // on the batch row; the batch lock serializes them. The winner
    // transitions the batch; the loser re-reads the locked state and
    // rejects with a lifecycle violation (business failure).
    const results = await Promise.allSettled([
      reconciliationService.submitForApproval(
        makeUser(scope) as any, makeEffective() as any,
        { importBatchId: batchId, warningSummary: null, idempotencyKey: submitKey },
      ),
      reconciliationService.reopenBatchForRework(
        makeUser(scope) as any, makeEffective() as any,
        { importBatchId: batchId, reason: "concurrent rework", targetState: "staged", idempotencyKey: reworkKey },
      ),
    ]);

    const submitSettled = results[0]!;
    const reworkSettled = results[1]!;

    // Exactly one succeeded (fulfilled), one failed (rejected).
    const submitFulfilled = submitSettled.status === "fulfilled";
    const reworkFulfilled = reworkSettled.status === "fulfilled";
    expect(submitFulfilled).not.toBe(reworkFulfilled);

    // The final batch state is one of the two coherent outcomes:
    //   - pending_dual_approval (if submit won the lock)
    //   - staged (if rework won the lock)
    const batchAfter = await getBatchState(scope, batchId);
    expect(["pending_dual_approval", "staged"]).toContain(batchAfter!.status);

    // Exactly one transition audit total (either submit OR rework, not both).
    const auditAfterSubmit = await getScopedAuditCount(scope, batchId, "historical_migration.submit_for_approval");
    const auditAfterRework = await getScopedAuditCount(scope, batchId, "historical_migration.rework");
    const submitAudits = auditAfterSubmit - auditBeforeSubmit;
    const reworkAudits = auditAfterRework - auditBeforeRework;
    expect(submitAudits + reworkAudits).toBe(1);

    // The winner's audit was written; the loser's was not.
    if (submitFulfilled) {
      expect(submitAudits).toBe(1);
      expect(reworkAudits).toBe(0);
      expect(batchAfter!.status).toBe("pending_dual_approval");
    } else {
      expect(submitAudits).toBe(0);
      expect(reworkAudits).toBe(1);
      expect(batchAfter!.status).toBe("staged");
    }

    // Both idempotency records exist (one succeeded, one not-succeeded).
    const submitIdem = await getIdemState(scope, submitKey);
    const reworkIdem = await getIdemState(scope, reworkKey);
    expect(submitIdem).not.toBeNull();
    expect(reworkIdem).not.toBeNull();

    if (submitFulfilled) {
      expect(submitIdem!.state).toBe("succeeded");
      expect(reworkIdem!.state).not.toBe("succeeded");
    } else {
      expect(submitIdem!.state).not.toBe("succeeded");
      expect(reworkIdem!.state).toBe("succeeded");
    }

    await cleanupScope(scope);
  });

  // ===========================================================================
  // WP-08-01F DEFECT 6/7 — Alias revalidation proofs (SUB-9A through SUB-11).
  //
  // These tests exercise the new alias-mapping prerequisite checks added
  // to submitForApproval by DEFECTS 6 and 7:
  //   - DEFECT 6: re-validate that each target master still exists,
  //     belongs to the same tenant, and matches the correct entity type.
  //   - DEFECT 7: the alias mapping is is_current=true (not superseded)
  //     and the mappingVersion matches the batch's mappingVersion.
  //
  // SUB-9A: DEFECT 6 — submitForApproval rejects when an approved alias's
  //         target master was deleted since approval.
  // SUB-9B: DEFECT 7 — submitForApproval rejects when an alias mapping
  //         is not the current mapping (is_current=false, superseded
  //         since approval).
  // SUB-9C: DEFECT 7 — submitForApproval rejects when the alias
  //         mapping's mappingVersion does not match the batch's
  //         mappingVersion.
  // SUB-9D: DEFECT 7 — submitForApproval succeeds when the alias
  //         mapping's mappingVersion matches the batch's mappingVersion.
  // SUB-10: DEFECT 6/7 — submitForApproval re-validates target masters
  //         atomically under the batch row lock.
  // SUB-11: DEFECT 8 — commit revalidates alias mappings under lock;
  //         if any alias state changed since dual approval, the commit
  //         fails closed.
  // ===========================================================================

  // Seed a customer master in the tenant for the alias target.
  async function seedCustomer(scope: TestScope, customerCode: string = "CUST-001", nameAr: string = "Target Customer"): Promise<string> {
    const customerId = randomUUID();
    await sql`
      INSERT INTO customers (id, tenant_id, customer_code, name_ar, name_en, normalized_name, contact_info_json, credit_limit, credit_terms, status, notes, created_by, created_at, updated_at, updated_by)
      VALUES (${customerId}, ${scope.tenantId}, ${customerCode}, ${nameAr}, null, ${nameAr.trim().toLowerCase()}, null, null, null, ${"active"}, null, ${scope.userId}, NOW(), null, null)`;
    return customerId;
  }

  // Seed a candidate/approved alias mapping directly.
  async function seedAliasMapping(scope: TestScope, batchId: string, overrides: {
    sourceLabel?: string;
    entityType?: string;
    normalizedName?: string;
    targetMasterId?: string | null;
    status?: string;
    mappingVersion?: string | null;
    groupId?: string | null;
    occurrenceCount?: number;
    isCurrent?: boolean;
  } = {}): Promise<string> {
    const aliasId = randomUUID();
    const sourceLabel = overrides.sourceLabel ?? "Acme Corp";
    const normalizedName = overrides.normalizedName ?? sourceLabel.trim().toLowerCase();
    const entityType = overrides.entityType ?? "customer";
    await sql`
      INSERT INTO import_alias_mappings (id, tenant_id, import_batch_id, entity_type, source_label, normalized_name,
        target_master_id, mapping_version, confidence_score, status, approved_by, approved_at, notes,
        is_current, superseded_at, superseded_by, superseded_reason,
        group_id, occurrence_count, exception_source_row_ids,
        created_by, created_at, updated_at, updated_by)
      VALUES (${aliasId}, ${scope.tenantId}, ${batchId}, ${entityType}, ${sourceLabel}, ${normalizedName},
        ${overrides.targetMasterId ?? null}, ${overrides.mappingVersion ?? null}, ${"1.000000"}, ${overrides.status ?? "candidate"}, null, null, null,
        ${overrides.isCurrent ?? true}, null, null, null,
        ${overrides.groupId ?? null}, ${overrides.occurrenceCount ?? 1},
        null,
        ${scope.userId}, NOW(), null, null)`;
    return aliasId;
  }

  // ===========================================================================
  // SUB-9A — DEFECT 6: submitForApproval rejects when target master deleted since approval
  // ===========================================================================
  it("SUB-9A. DEFECT 6 — submitForApproval rejects when an approved alias's target master was deleted since approval", async () => {
    const scope = newScope();
    await seedTenantAndUser(scope);
    const batchId = randomUUID();
    await seedReviewRequiredBatch(scope, batchId);
    await seedFileAndStagingRow(scope, batchId);
    await seedPriorReconciliationEvidence(scope, batchId, 1);
    await seedResolvedReviewItem(scope, batchId, "resolved review item");
    await seedBackupEvidence(scope, batchId);
    const customerId = await seedCustomer(scope, "CUST-001", "Acme Customer");
    // Seed an approved alias mapping pointing at the customer.
    await seedAliasMapping(scope, batchId, {
      sourceLabel: "Acme Corp",
      status: "approved",
      targetMasterId: customerId,
      mappingVersion: "1.0",
    });

    // Delete the customer master AFTER approval but BEFORE submission.
    await sql`DELETE FROM customers WHERE tenant_id = ${scope.tenantId} AND id = ${customerId}`;

    const idemKey = "sub-9a-" + randomUUID();
    const { reconciliationService } = makeServices(scope);

    await expect(
      reconciliationService.submitForApproval(
        makeUser(scope) as any, makeEffective() as any,
        { importBatchId: batchId, warningSummary: null, idempotencyKey: idemKey },
      ),
    ).rejects.toThrow(/INVALID_ALIAS_TARGET|alias mapping/i);

    // Batch is unchanged (still review_required).
    const batch = await getBatchState(scope, batchId);
    expect(batch!.status).toBe("review_required");

    // Idempotency business_failed (durable).
    const idemState = await getIdemState(scope, idemKey);
    expect(idemState?.state).toBe("business_failed");

    await cleanupScope(scope);
  });

  // ===========================================================================
  // SUB-9B — DEFECT 7: submitForApproval rejects when alias mapping is not current (superseded)
  // ===========================================================================
  it("SUB-9B. DEFECT 7 — submitForApproval rejects when an alias mapping is not current (superseded since approval)", async () => {
    const scope = newScope();
    await seedTenantAndUser(scope);
    const batchId = randomUUID();
    await seedReviewRequiredBatch(scope, batchId);
    await seedFileAndStagingRow(scope, batchId);
    await seedPriorReconciliationEvidence(scope, batchId, 1);
    await seedResolvedReviewItem(scope, batchId, "resolved review item");
    await seedBackupEvidence(scope, batchId);
    const customerId = await seedCustomer(scope, "CUST-001", "Acme Customer");
    // Step 1: Seed an approved CURRENT alias mapping for "Acme Corp"
    // (target=customerId, mappingVersion='1.0' matching the batch).
    // This represents the original approval.
    const originalAliasId = await seedAliasMapping(scope, batchId, {
      sourceLabel: "Acme Corp",
      status: "approved",
      targetMasterId: customerId,
      mappingVersion: "1.0",
      // isCurrent defaults to true
    });

    // Step 2: Properly SUPERSEDE the original alias mapping — UPDATE
    // is_current=false (preserved as audit history, with superseded_at
    // and superseded_reason). This mirrors the production supersession
    // pattern used by approveAliasMapping's material-remap path: the
    // OLD approved row stays around (append-only) but is no longer the
    // authoritative mapping. Simply seeding with isCurrent=false from
    // the start does NOT trigger submitForApproval's is_current check,
    // because findCurrentAliasMappingsForBatch filters is_current=true
    // and would return zero rows (a degenerate "no current mapping"
    // case the production prerequisite check silently passes). By first
    // seeding a current approved mapping and then superseding it via
    // UPDATE, we reproduce the real-world supersession flow that
    // happens when a re-validation replaces an approved alias with a
    // new (not-yet-approved) candidate mapping.
    await sql`UPDATE import_alias_mappings SET is_current = false, superseded_at = NOW(), superseded_reason = 'Superseded by re-validation (not yet re-approved)' WHERE tenant_id = ${scope.tenantId} AND id = ${originalAliasId}`;

    // Step 3: Insert a NEW current alias mapping for the same key with
    // status='candidate' (NOT approved) and no target. This represents
    // the re-validation's new current candidate that the operator
    // hasn't yet re-approved. The partial unique index on
    // (tenant, batch, entityType, sourceLabel) WHERE is_current=true
    // permits this insertion because the OLD row is now is_current=false.
    await seedAliasMapping(scope, batchId, {
      sourceLabel: "Acme Corp",
      status: "candidate",
      targetMasterId: null,
      mappingVersion: "1.0",
      // isCurrent defaults to true — the NEW current mapping
    });

    const idemKey = "sub-9b-" + randomUUID();
    const { reconciliationService } = makeServices(scope);

    // submitForApproval should reject because the CURRENT alias mapping
    // (the new candidate that superseded the previously-approved one)
    // has status='candidate' (not 'approved') and targetMasterId=null.
    // The production findCurrentAliasMappingsForBatch returns ONLY the
    // new current candidate; the alias prerequisite check sees
    // status != 'approved' and throws UnresolvedAliasMappingError
    // (whose code/message both match the "alias mapping" regex).
    await expect(
      reconciliationService.submitForApproval(
        makeUser(scope) as any, makeEffective() as any,
        { importBatchId: batchId, warningSummary: null, idempotencyKey: idemKey },
      ),
    ).rejects.toThrow(/UNRESOLVED_ALIAS_MAPPING|alias mapping/i);

    const batch = await getBatchState(scope, batchId);
    expect(batch!.status).toBe("review_required");

    await cleanupScope(scope);
  });

  // ===========================================================================
  // SUB-9C — DEFECT 7: submitForApproval rejects on mappingVersion mismatch
  // ===========================================================================
  it("SUB-9C. DEFECT 7 — submitForApproval rejects when the alias mapping's mappingVersion does not match the batch's mappingVersion", async () => {
    const scope = newScope();
    await seedTenantAndUser(scope);
    const batchId = randomUUID();
    // Seed a review_required batch with mapping_version='2.0'.
    await sql`
      INSERT INTO import_batches (id, tenant_id, batch_no, status, source_description, template_name, template_version,
        mapping_version, cutover_manifest_hash, cutover_import_mode, staged_data_hash, staged_row_count,
        blocking_error_count, warning_count, accepted_warning_count, validation_status, reconciliation_status,
        warning_summary, committed_at, commit_effect_counts, created_by, created_at)
      VALUES (${batchId}, ${scope.tenantId}, ${"SUB9C-" + batchId.slice(-6)}, ${"review_required"}::import_batch_status, ${"test"},
        ${"opening_balance_inventory"}, ${"1.0"}, ${"2.0"}, ${"sha256:manifest"}, ${"opening_balance"}, ${"sha256:test"}, 1,
        0, 0, 0, ${"passed"}, ${"matched"}, null, null, null, ${scope.userId}, NOW())`;
    await seedFileAndStagingRow(scope, batchId);
    await seedPriorReconciliationEvidence(scope, batchId, 1);
    await seedResolvedReviewItem(scope, batchId, "resolved review item");
    await seedBackupEvidence(scope, batchId);
    const customerId = await seedCustomer(scope, "CUST-001", "Acme Customer");
    // Seed an approved alias mapping with mappingVersion='1.0' — stale
    // (batch is at 2.0).
    await seedAliasMapping(scope, batchId, {
      sourceLabel: "Acme Corp",
      status: "approved",
      targetMasterId: customerId,
      mappingVersion: "1.0", // stale — batch is at 2.0
    });

    const idemKey = "sub-9c-" + randomUUID();
    const { reconciliationService } = makeServices(scope);

    await expect(
      reconciliationService.submitForApproval(
        makeUser(scope) as any, makeEffective() as any,
        { importBatchId: batchId, warningSummary: null, idempotencyKey: idemKey },
      ),
    ).rejects.toThrow(/ALIAS_MAPPING_VERSION_MISMATCH|mappingVersion/i);

    const batch = await getBatchState(scope, batchId);
    expect(batch!.status).toBe("review_required");

    // Idempotency business_failed (durable).
    const idemState = await getIdemState(scope, idemKey);
    expect(idemState?.state).toBe("business_failed");

    await cleanupScope(scope);
  });

  // ===========================================================================
  // SUB-9D — DEFECT 7: submitForApproval succeeds when mappingVersion matches
  // ===========================================================================
  it("SUB-9D. DEFECT 7 — submitForApproval succeeds when the alias mapping's mappingVersion matches the batch's mappingVersion", async () => {
    const scope = newScope();
    await seedTenantAndUser(scope);
    const batchId = randomUUID();
    await seedReviewRequiredBatch(scope, batchId); // mapping_version='1.0'
    await seedFileAndStagingRow(scope, batchId);
    await seedPriorReconciliationEvidence(scope, batchId, 1);
    await seedResolvedReviewItem(scope, batchId, "resolved review item");
    await seedBackupEvidence(scope, batchId);
    const customerId = await seedCustomer(scope, "CUST-001", "Acme Customer");
    // Seed an approved alias mapping with mappingVersion='1.0' — matches
    // the batch's mappingVersion='1.0'.
    await seedAliasMapping(scope, batchId, {
      sourceLabel: "Acme Corp",
      status: "approved",
      targetMasterId: customerId,
      mappingVersion: "1.0",
    });

    const idemKey = "sub-9d-" + randomUUID();
    const { reconciliationService } = makeServices(scope);

    const result = await reconciliationService.submitForApproval(
      makeUser(scope) as any, makeEffective() as any,
      { importBatchId: batchId, warningSummary: null, idempotencyKey: idemKey },
    );
    expect(result.action).toBe("submitted");
    expect(result.newStatus).toBe("pending_dual_approval");

    const batch = await getBatchState(scope, batchId);
    expect(batch!.status).toBe("pending_dual_approval");

    await cleanupScope(scope);
  });

  // ===========================================================================
  // SUB-10 — DEFECT 6/7: submitForApproval re-validates target masters under the batch row lock
  // ===========================================================================
  it("SUB-10. DEFECT 6/7 — submitForApproval re-validates target masters atomically under the batch row lock", async () => {
    const scope = newScope();
    await seedTenantAndUser(scope);
    const batchId = randomUUID();
    await seedReviewRequiredBatch(scope, batchId);
    await seedFileAndStagingRow(scope, batchId);
    await seedPriorReconciliationEvidence(scope, batchId, 1);
    await seedResolvedReviewItem(scope, batchId, "resolved review item");
    await seedBackupEvidence(scope, batchId);
    const customerId = await seedCustomer(scope, "CUST-001", "Acme Customer");
    await seedAliasMapping(scope, batchId, {
      sourceLabel: "Acme Corp",
      status: "approved",
      targetMasterId: customerId,
      mappingVersion: "1.0",
    });

    const idemKey = "sub-10-" + randomUUID();
    const reconRepo = new HistoricalReconciliationDbRepository(db);
    const commitRepo = new HistoricalCommitDbRepository(db);
    const audit = new AuditDbRepository(db);
    const idem = new IdempotencyDbRepository(db);
    // Custom service whose transactionRunner deletes the customer
    // AFTER the batch is locked but BEFORE the alias revalidation check
    // runs. The alias revalidation should catch the deleted master
    // inside the locked transaction.
    const customService = new HistoricalReconciliationService({
      repository: reconRepo, audit, idempotency: idem, commitRepository: commitRepo,
      transactionRunner: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
        (db as any).transaction(async (tx: any) => {
          await (tx as any).execute(drizzleSql`SELECT id FROM import_batches WHERE tenant_id = ${scope.tenantId} AND id = ${batchId} FOR UPDATE`);
          // Delete the customer BEFORE running the work body —
          // simulates a concurrent master deletion between pre-claim and
          // the locked revalidation. The transaction's DELETE is in the
          // SAME transaction as the submit, so it's visible to the
          // alias revalidation query.
          await (tx as any).execute(drizzleSql`DELETE FROM customers WHERE tenant_id = ${scope.tenantId} AND id = ${customerId}`);
          await work(tx);
        }),
      createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
      createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
      createReconciliationRepository: (tx: unknown) => new HistoricalReconciliationDbRepository(tx as any),
      createCommitRepository: (tx: unknown) => new HistoricalCommitDbRepository(tx as any),
    });

    await expect(
      customService.submitForApproval(
        makeUser(scope) as any, makeEffective() as any,
        { importBatchId: batchId, warningSummary: null, idempotencyKey: idemKey },
      ),
    ).rejects.toThrow(/INVALID_ALIAS_TARGET|alias mapping/i);

    // Batch is unchanged (still review_required).
    const batch = await getBatchState(scope, batchId);
    expect(batch!.status).toBe("review_required");

    await cleanupScope(scope);
  });

  // ===========================================================================
  // SUB-11 — DEFECT 8: commit revalidates alias mappings under lock; fail-closed if alias state changed
  // ===========================================================================
  it("SUB-11. DEFECT 8 — commit revalidates alias mappings under lock; fails closed if an alias's target master was deleted since dual approval", async () => {
    const scope = newScope();
    await seedTenantAndUser(scope);
    const ownerId = scope.userId;
    const accountantId = randomUUID();
    // WP-08-01F SUB-11 fix: use a globally-unique auth_id (and email)
    // per test scope. The `users_auth_id_unique_idx` is a GLOBAL unique
    // index on `auth_id` (not tenant-scoped), so a hardcoded auth_id
    // like "sub-11-acct" would collide with leftover rows from a
    // previous test run. The cleanupScope helper intentionally does NOT
    // delete `users` (immutable audit history per Contract 03 §7.2),
    // so leftover accountant rows from prior runs accumulate. Suffix
    // with the per-scope accountantId (a fresh randomUUID per test
    // invocation) to guarantee uniqueness.
    const accountantAuthId = `sub-11-acct-${accountantId}`;
    const accountantEmail = `sub-11-acct-${accountantId}@test.test`;
    await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference)
              VALUES (${accountantId}, ${scope.tenantId}, ${accountantAuthId}, ${"Acct User"}, ${accountantEmail}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
    const batchId = randomUUID();
    // Seed an approved_for_commit batch.
    await sql`
      INSERT INTO import_batches (id, tenant_id, batch_no, status, source_description, template_name, template_version,
        mapping_version, cutover_manifest_hash, cutover_import_mode, staged_data_hash, staged_row_count,
        blocking_error_count, warning_count, accepted_warning_count, validation_status, reconciliation_status,
        warning_summary, committed_at, commit_effect_counts, created_by, created_at)
      VALUES (${batchId}, ${scope.tenantId}, ${"SUB11-" + batchId.slice(-6)}, ${"approved_for_commit"}::import_batch_status, ${"test"},
        ${"opening_balance_inventory"}, ${"1.0"}, ${"1.0"}, ${"sha256:manifest"}, ${"opening_balance"}, ${"sha256:test"}, 1,
        0, 0, 0, ${"passed"}, ${"matched"}, null, null, null, ${ownerId}, NOW())`;
    await seedFileAndStagingRow(scope, batchId);
    await seedPriorReconciliationEvidence(scope, batchId, 1);
    await seedBackupEvidence(scope, batchId);
    // Seed both owner + accountant approvals.
    await sql`
      INSERT INTO import_batch_approvals (id, tenant_id, import_batch_id, approver_role, approver_user_id,
        staged_data_hash, cutover_manifest_hash, template_version, mapping_version,
        validation_status, reconciliation_status, warning_summary, approved_at, reason,
        approval_version, is_current, created_by, created_at)
      VALUES (${randomUUID()}, ${scope.tenantId}, ${batchId}, ${"owner"}::migration_approver_role, ${ownerId},
        ${"sha256:test"}, ${"sha256:manifest"}, ${"1.0"}, ${"1.0"},
        ${"passed"}, ${"matched"}, null, NOW(), ${"test approval"},
        1, true, ${ownerId}, NOW())`;
    await sql`
      INSERT INTO import_batch_approvals (id, tenant_id, import_batch_id, approver_role, approver_user_id,
        staged_data_hash, cutover_manifest_hash, template_version, mapping_version,
        validation_status, reconciliation_status, warning_summary, approved_at, reason,
        approval_version, is_current, created_by, created_at)
      VALUES (${randomUUID()}, ${scope.tenantId}, ${batchId}, ${"accountant"}::migration_approver_role, ${accountantId},
        ${"sha256:test"}, ${"sha256:manifest"}, ${"1.0"}, ${"1.0"},
        ${"passed"}, ${"matched"}, null, NOW(), ${"test approval"},
        1, true, ${accountantId}, NOW())`;

    const customerId = await seedCustomer(scope, "CUST-001", "Acme Customer");
    await seedAliasMapping(scope, batchId, {
      sourceLabel: "Acme Corp",
      status: "approved",
      targetMasterId: customerId,
      mappingVersion: "1.0",
    });

    // Build commit service.
    const { HistoricalCommitService } = await import("@/server/services/historical-commit-service");
    const { DocumentSequenceDbRepository } = await import("@/server/services/document-sequence-db-repository");
    const commitRepo = new HistoricalCommitDbRepository(db);
    const audit = new AuditDbRepository(db);
    const idem = new IdempotencyDbRepository(db);
    const docSeq = new DocumentSequenceDbRepository(db);
    const commitService = new HistoricalCommitService({
      repository: commitRepo, audit, idempotency: idem,
      transactionRunner: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => (db as any).transaction(async (tx: any) => work(tx)),
      txFactories: {
        createCommitRepository: (tx: unknown) => new HistoricalCommitDbRepository(tx as any),
        createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
        createInventoryLedger: () => ({} as any),
        createSubledger: () => ({} as any),
        createDocumentSequence: (tx: unknown) => new DocumentSequenceDbRepository(tx as any),
        createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
      },
    });

    // DELETE the customer AFTER dual approval but BEFORE commit.
    await sql`DELETE FROM customers WHERE tenant_id = ${scope.tenantId} AND id = ${customerId}`;

    const idemKey = "sub-11-" + randomUUID();
    await expect(
      commitService.commitBatch(
        { authenticated: true, userId: ownerId, tenantId: scope.tenantId, authId: `auth-${ownerId}`, name: "Owner", email: `o-${ownerId}@test.local` } as any,
        resolveEffectivePermissions(["owner"], TEST_ROLE_PERMISSION_MATRIX) as any,
        { importBatchId: batchId, idempotencyKey: idemKey },
      ),
    ).rejects.toThrow(/ALIAS_REVALIDATION_FAILED|INVALID_ALIAS_TARGET|alias mapping/i);

    // Batch is unchanged (still approved_for_commit — NOT committed).
    const batch = await getBatchState(scope, batchId);
    expect(batch!.status).toBe("approved_for_commit");
    expect(batch!.committed_at).toBeNull();

    await cleanupScope(scope);
  });
});
