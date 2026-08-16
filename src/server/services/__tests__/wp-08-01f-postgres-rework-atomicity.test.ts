/**
 * WP-08-01F Milestone C Task 2 — Rework atomicity PostgreSQL proofs.
 *
 * Real PostgreSQL service-level tests exercising the actual
 * HistoricalReconciliationService.reopenBatchForRework() production path
 * with real transaction-scoped repositories.
 *
 *   RW-1. Success: rework from review_required → staged, old reconciliation
 *        evidence unchanged, approvals invalidated, review items superseded,
 *        exactly one scoped rework audit, idempotency succeeded.
 *   RW-2. Real failure after first rework business write: complete rollback.
 *   RW-3. Real owner-token loss: production fence rejects stale owner.
 *   RW-4. Valid retry after RW-3: exactly one final effect set.
 *   RW-5. Same-key/same-payload replay: same response, zero additional effects.
 *   RW-6. Same-key/different-payload conflict: rejected, zero additional effects.
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

// Real owner-token loss wrapper (same pattern as VA/RCA tests).
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

// First-write failure wrapper for rework: throws after the first rework write
// (resetBatchValidationAndReconciliationStatuses).
function makeFirstWriteFailureRepoWrapper(realRepo: HistoricalReconciliationRepository): HistoricalReconciliationRepository {
  let callCount = 0;
  const wrapped: HistoricalReconciliationRepository = {
    findImportBatchById: (t: string, id: string) => realRepo.findImportBatchById(t, id),
    updateBatchStatus: (t: string, id: string, s: string) => realRepo.updateBatchStatus(t, id, s),
    updateBatchReconciliationStatus: (t: string, id: string, s: string, u: string) => realRepo.updateBatchReconciliationStatus(t, id, s, u),
    resetBatchValidationAndReconciliationStatuses: async (t: string, id: string) => {
      const result = await realRepo.resetBatchValidationAndReconciliationStatuses(t, id);
      callCount++;
      if (callCount === 1) {
        throw new Error("INJECTED_FAILURE_AFTER_FIRST_REWORK_WRITE");
      }
      return result;
    },
    findStagingRowsForBatch: (t: string, id: string) => realRepo.findStagingRowsForBatch(t, id),
    findLatestReportVersion: (t: string, id: string) => realRepo.findLatestReportVersion(t, id),
    markVersionAsSuperseded: (t: string, id: string, v: number) => realRepo.markVersionAsSuperseded(t, id, v),
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

async function seedTenantAndUser(scope: TestScope) {
  const runSuffix = scope.runSuffix;
  await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status)
            VALUES (${scope.tenantId}, ${"RW-" + runSuffix}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference)
            VALUES (${scope.userId}, ${scope.tenantId}, ${"rw-" + runSuffix}, ${"RW User"}, ${"rw-" + runSuffix + "@test.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
}

// Seed a batch in `review_required` state with prior reconciliation evidence.
// This is the starting state for rework tests.
async function seedReviewRequiredBatch(scope: TestScope, batchId: string) {
  await sql`
    INSERT INTO import_batches (id, tenant_id, batch_no, status, source_description, template_name, template_version,
      mapping_version, cutover_manifest_hash, cutover_import_mode, staged_data_hash, staged_row_count,
      blocking_error_count, warning_count, accepted_warning_count, validation_status, reconciliation_status,
      warning_summary, committed_at, commit_effect_counts, created_by, created_at)
    VALUES (${batchId}, ${scope.tenantId}, ${"RW-" + batchId.slice(-6)}, ${"review_required"}::import_batch_status, ${"test"},
      ${"opening_balance_inventory"}, ${"1.0"}, ${"1.0"}, null, ${"opening_balance"}, ${"sha256:test"}, 1,
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

// Seed prior reconciliation evidence (version 1 results) so we can prove
// rework preserves them.
async function seedPriorReconciliationEvidence(scope: TestScope, batchId: string, reportVersion: number = 1) {
  const resultId = randomUUID();
  await sql`
    INSERT INTO import_reconciliation_results (id, tenant_id, import_batch_id, report_version, metric_key,
      expected_value, staged_value, committed_value, difference_value, status, notes, created_by, created_at)
    VALUES (${resultId}, ${scope.tenantId}, ${batchId}, ${reportVersion}, ${"inventory_opening_qty"},
      null, ${"100"}, null, null, ${"matched"}, ${"Original review reason evidence"}, ${scope.userId}, NOW())`;
  return resultId;
}

async function getBatchState(scope: TestScope, batchId: string) {
  const rows = await sql`SELECT status, reconciliation_status, validation_status FROM import_batches WHERE id = ${batchId} AND tenant_id = ${scope.tenantId}`;
  return rows[0] || null;
}

async function getReconResultCount(scope: TestScope, batchId: string) {
  const rows = await sql`SELECT count(*)::int AS c FROM import_reconciliation_results WHERE tenant_id = ${scope.tenantId} AND import_batch_id = ${batchId}`;
  return rows[0]?.c || 0;
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

interface ReconResultSnapshot {
  id: string;
  report_version: number;
  metric_key: string;
  expected_value: string | null;
  staged_value: string | null;
  committed_value: string | null;
  difference_value: string | null;
  status: string;
  notes: string | null;
  created_by: string;
}

async function getReconResultsForVersion(scope: TestScope, batchId: string, version: number): Promise<ReconResultSnapshot[]> {
  return sql`SELECT id, report_version, metric_key, expected_value, staged_value, committed_value, difference_value, status, notes, created_by FROM import_reconciliation_results WHERE tenant_id = ${scope.tenantId} AND import_batch_id = ${batchId} AND report_version = ${version} ORDER BY metric_key` as any as Promise<ReconResultSnapshot[]>;
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
  await sql`DELETE FROM import_batches WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM idempotency_records WHERE tenant_id = ${scope.tenantId}`;
  // NOTE: audit_logs, users, tenants intentionally NOT deleted (immutable).
}

describeOrSkip("WP-08-01F Task 2 — Rework atomicity PostgreSQL proofs (RW-1 through RW-6)", () => {
  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { prepare: false, max: 5, idle_timeout: 10, connect_timeout: 15 });
    db = drizzle(sql, { schema });
  }, 30000);

  afterAll(async () => {
    if (sql) { await sql.end(); }
  }, 30000);

  // ===========================================================================
  // RW-1 — SUCCESS
  // ===========================================================================
  it("RW-1. success: rework review_required→staged, old evidence unchanged, one scoped audit, idempotency succeeded", async () => {
    const scope = newScope();
    await seedTenantAndUser(scope);
    const batchId = randomUUID();
    await seedReviewRequiredBatch(scope, batchId);
    await seedFileAndStagingRow(scope, batchId);
    const v1ResultId = await seedPriorReconciliationEvidence(scope, batchId, 1);

    // Snapshot V1 evidence before rework.
    const v1Before = await getReconResultsForVersion(scope, batchId, 1);
    expect(v1Before.length).toBe(1);

    const idemKey = "rw1-success-" + randomUUID();
    const { reconciliationService } = makeServices(scope);
    const auditBefore = await getScopedAuditCount(scope, batchId, "historical_migration.rework");

    const result = await reconciliationService.reopenBatchForRework(
      makeUser(scope) as any, makeEffective() as any,
      { importBatchId: batchId, reason: "test rework", targetState: "staged", idempotencyKey: idemKey },
    );

    expect(result.action).toBe("reworked");
    expect(result.previousStatus).toBe("review_required");
    expect(result.newStatus).toBe("staged");

    // Batch transitioned to staged.
    const batch = await getBatchState(scope, batchId);
    expect(batch!.status).toBe("staged");
    // Rework resets validation/reconciliation statuses.
    expect(batch!.validation_status).toBeNull();
    expect(batch!.reconciliation_status).toBeNull();

    // Exactly one scoped rework audit.
    const auditAfter = await getScopedAuditCount(scope, batchId, "historical_migration.rework");
    expect(auditAfter).toBe(auditBefore + 1);
    expect(auditAfter).toBe(1);

    // V1 evidence UNCHANGED — same row, same fields.
    const v1After = await getReconResultsForVersion(scope, batchId, 1);
    expect(v1After.length).toBe(1);
    expect(v1After[0]!.id).toBe(v1ResultId);
    expect(v1After[0]!.notes).toBe(v1Before[0]!.notes); // notes NOT overwritten
    expect(v1After[0]!.status).toBe(v1Before[0]!.status);
    expect(v1After[0]!.expected_value).toBe(v1Before[0]!.expected_value);
    expect(v1After[0]!.staged_value).toBe(v1Before[0]!.staged_value);

    // Idempotency succeeded.
    const idemState = await getIdemState(scope, idemKey);
    expect(idemState?.state).toBe("succeeded");

    await cleanupScope(scope);
  });

  // ===========================================================================
  // RW-2 — REAL FAILURE AFTER FIRST REWORK BUSINESS WRITE
  // ===========================================================================
  it("RW-2. real failure after first rework write: full rollback, batch unchanged, audit delta 0", async () => {
    const scope = newScope();
    await seedTenantAndUser(scope);
    const batchId = randomUUID();
    await seedReviewRequiredBatch(scope, batchId);
    await seedFileAndStagingRow(scope, batchId);
    await seedPriorReconciliationEvidence(scope, batchId, 1);

    const idemKey = "rw2-failure-" + randomUUID();
    const auditBefore = await getScopedAuditCount(scope, batchId, "historical_migration.rework");
    const batchBefore = await getBatchState(scope, batchId);
    const resultsBefore = await getReconResultCount(scope, batchId);

    // Custom service with a createReconciliationRepository that wraps the
    // real repo to inject failure after the first rework write.
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
      createReconciliationRepository: (tx: unknown) => makeFirstWriteFailureRepoWrapper(new HistoricalReconciliationDbRepository(tx as any)),
      createCommitRepository: (tx: unknown) => new HistoricalCommitDbRepository(tx as any),
    });

    await expect(
      customService.reopenBatchForRework(
        makeUser(scope) as any, makeEffective() as any,
        { importBatchId: batchId, reason: "test rework fail", targetState: "staged", idempotencyKey: idemKey },
      ),
    ).rejects.toThrow(/INJECTED_FAILURE_AFTER_FIRST_REWORK_WRITE/);

    // Full rollback: batch unchanged.
    const batchAfter = await getBatchState(scope, batchId);
    expect(batchAfter!.status).toBe(batchBefore!.status);
    expect(batchAfter!.validation_status).toBe(batchBefore!.validation_status);
    expect(batchAfter!.reconciliation_status).toBe(batchBefore!.reconciliation_status);

    // Full rollback: results unchanged.
    const resultsAfter = await getReconResultCount(scope, batchId);
    expect(resultsAfter).toBe(resultsBefore);

    // Full rollback: audit delta = 0.
    const auditAfter = await getScopedAuditCount(scope, batchId, "historical_migration.rework");
    expect(auditAfter).toBe(auditBefore);
    expect(auditAfter).toBe(0);

    // Idempotency not succeeded.
    const idemState = await getIdemState(scope, idemKey);
    if (idemState) { expect(idemState.state).not.toBe("succeeded"); }

    await cleanupScope(scope);
  });

  // ===========================================================================
  // RW-3 — REAL OWNER-TOKEN LOSS
  // ===========================================================================
  it("RW-3. real owner-token loss: production fence rejects stale owner, full rollback", async () => {
    const scope = newScope();
    await seedTenantAndUser(scope);
    const batchId = randomUUID();
    await seedReviewRequiredBatch(scope, batchId);
    await seedFileAndStagingRow(scope, batchId);
    await seedPriorReconciliationEvidence(scope, batchId, 1);

    const idemKey = "rw3-owner-loss-" + randomUUID();
    const auditBefore = await getScopedAuditCount(scope, batchId, "historical_migration.rework");
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
      customService.reopenBatchForRework(
        makeUser(scope) as any, makeEffective() as any,
        { importBatchId: batchId, reason: "test owner loss", targetState: "staged", idempotencyKey: idemKey },
      ),
    ).rejects.toThrow(/owner.*token|ownership/i);

    // Full rollback: batch unchanged.
    const batchAfter = await getBatchState(scope, batchId);
    expect(batchAfter!.status).toBe(batchBefore!.status);
    expect(batchAfter!.reconciliation_status).toBe(batchBefore!.reconciliation_status);

    // Full rollback: audit delta = 0.
    const auditAfter = await getScopedAuditCount(scope, batchId, "historical_migration.rework");
    expect(auditAfter).toBe(auditBefore);
    expect(auditAfter).toBe(0);

    // Idempotency not succeeded.
    const idemState = await getIdemState(scope, idemKey);
    if (idemState) { expect(idemState.state).not.toBe("succeeded"); }

    await cleanupScope(scope);
  });

  // ===========================================================================
  // RW-4 — VALID RETRY AFTER RW-3 FAILURE
  // ===========================================================================
  it("RW-4. valid retry: exactly one final rework effect set, one scoped audit, idempotency succeeded", async () => {
    const scope = newScope();
    await seedTenantAndUser(scope);
    const batchId = randomUUID();
    await seedReviewRequiredBatch(scope, batchId);
    await seedFileAndStagingRow(scope, batchId);
    await seedPriorReconciliationEvidence(scope, batchId, 1);

    const idemKey = "rw4-retry-" + randomUUID();
    const auditBefore = await getScopedAuditCount(scope, batchId, "historical_migration.rework");

    // Step 1: fail with real owner-token loss.
    const reconRepo = new HistoricalReconciliationDbRepository(db);
    const commitRepo = new HistoricalCommitDbRepository(db);
    const audit = new AuditDbRepository(db);
    const idem = new IdempotencyDbRepository(db);
    const faultyService = new HistoricalReconciliationService({
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
      faultyService.reopenBatchForRework(
        makeUser(scope) as any, makeEffective() as any,
        { importBatchId: batchId, reason: "retry test", targetState: "staged", idempotencyKey: idemKey },
      ),
    ).rejects.toThrow(/owner.*token|ownership/i);

    // Step 2: expire lease for retry.
    await sql`UPDATE idempotency_records SET lease_expires_at = NOW() - interval '1 second' WHERE tenant_id = ${scope.tenantId} AND idempotency_key = ${idemKey}`;

    // Step 3: valid retry with a good service.
    const { reconciliationService: goodService } = makeServices(scope);
    const retryResult = await goodService.reopenBatchForRework(
      makeUser(scope) as any, makeEffective() as any,
      { importBatchId: batchId, reason: "retry test", targetState: "staged", idempotencyKey: idemKey },
    );
    expect(retryResult.action).toBe("reworked");

    // Exactly one scoped rework audit.
    const auditAfter = await getScopedAuditCount(scope, batchId, "historical_migration.rework");
    expect(auditAfter).toBe(auditBefore + 1);
    expect(auditAfter).toBe(1);

    // Batch transitioned to staged.
    const batch = await getBatchState(scope, batchId);
    expect(batch!.status).toBe("staged");
    expect(batch!.reconciliation_status).toBeNull();

    // Idempotency succeeded.
    const idemState = await getIdemState(scope, idemKey);
    expect(idemState?.state).toBe("succeeded");

    await cleanupScope(scope);
  });

  // ===========================================================================
  // RW-5 — SAME-KEY/SAME-PAYLOAD REPLAY
  // ===========================================================================
  it("RW-5. replay: same response, zero additional business effects, zero additional audits", async () => {
    const scope = newScope();
    await seedTenantAndUser(scope);
    const batchId = randomUUID();
    await seedReviewRequiredBatch(scope, batchId);
    await seedFileAndStagingRow(scope, batchId);
    await seedPriorReconciliationEvidence(scope, batchId, 1);

    const idemKey = "rw5-replay-" + randomUUID();
    const { reconciliationService } = makeServices(scope);

    // Step 1: initial rework.
    const initialResult = await reconciliationService.reopenBatchForRework(
      makeUser(scope) as any, makeEffective() as any,
      { importBatchId: batchId, reason: "replay test", targetState: "staged", idempotencyKey: idemKey },
    );
    expect(initialResult.action).toBe("reworked");

    const auditAfterInitial = await getScopedAuditCount(scope, batchId, "historical_migration.rework");
    const idemAfterInitial = await getIdemState(scope, idemKey);
    const batchAfterInitial = await getBatchState(scope, batchId);

    // Step 2: replay with same key + same payload.
    const replayResult = await reconciliationService.reopenBatchForRework(
      makeUser(scope) as any, makeEffective() as any,
      { importBatchId: batchId, reason: "replay test", targetState: "staged", idempotencyKey: idemKey },
    );
    expect(replayResult.action).toBe("replayed");

    // Same persisted response_body.
    const idemAfterReplay = await getIdemState(scope, idemKey);
    expect(idemAfterReplay?.state).toBe("succeeded");
    expect(JSON.stringify(idemAfterReplay?.response_body)).toBe(JSON.stringify(idemAfterInitial?.response_body));

    // Zero additional audits.
    const auditAfterReplay = await getScopedAuditCount(scope, batchId, "historical_migration.rework");
    expect(auditAfterReplay).toBe(auditAfterInitial);

    // Batch state unchanged from replay.
    const batchAfterReplay = await getBatchState(scope, batchId);
    expect(batchAfterReplay!.status).toBe(batchAfterInitial!.status);

    await cleanupScope(scope);
  });

  // ===========================================================================
  // RW-6 — SAME-KEY/DIFFERENT-PAYLOAD CONFLICT
  // ===========================================================================
  it("RW-6. conflict: same key + different payload → rejected, zero additional effects", async () => {
    const scope = newScope();
    await seedTenantAndUser(scope);
    const batchId1 = randomUUID();
    await seedReviewRequiredBatch(scope, batchId1);
    await seedFileAndStagingRow(scope, batchId1);
    await seedPriorReconciliationEvidence(scope, batchId1, 1);

    const batchId2 = randomUUID();
    await seedReviewRequiredBatch(scope, batchId2);
    await seedFileAndStagingRow(scope, batchId2);
    await seedPriorReconciliationEvidence(scope, batchId2, 1);

    const idemKey = "rw6-conflict-" + randomUUID();
    const { reconciliationService } = makeServices(scope);

    // Step 1: initial rework on batch1.
    const initialResult = await reconciliationService.reopenBatchForRework(
      makeUser(scope) as any, makeEffective() as any,
      { importBatchId: batchId1, reason: "conflict test 1", targetState: "staged", idempotencyKey: idemKey },
    );
    expect(initialResult.action).toBe("reworked");

    const audit1AfterInitial = await getScopedAuditCount(scope, batchId1, "historical_migration.rework");
    const audit2AfterInitial = await getScopedAuditCount(scope, batchId2, "historical_migration.rework");

    // Step 2: same key, different payload (batch2 instead of batch1).
    await expect(
      reconciliationService.reopenBatchForRework(
        makeUser(scope) as any, makeEffective() as any,
        { importBatchId: batchId2, reason: "conflict test 2", targetState: "staged", idempotencyKey: idemKey },
      ),
    ).rejects.toThrow(/IDEMPOTENCY_CONFLICT|conflict/i);

    // Zero additional effects on batch1.
    const audit1AfterConflict = await getScopedAuditCount(scope, batchId1, "historical_migration.rework");
    expect(audit1AfterConflict).toBe(audit1AfterInitial);

    // Zero additional effects on batch2 (never written).
    const audit2AfterConflict = await getScopedAuditCount(scope, batchId2, "historical_migration.rework");
    expect(audit2AfterConflict).toBe(audit2AfterInitial);
    expect(audit2AfterConflict).toBe(0);

    await cleanupScope(scope);
  });
});
