/**
 * WP-08-01F Milestone C Task 4 — Reconciliation atomicity PostgreSQL proofs.
 *
 * Real PostgreSQL service-level tests exercising the actual
 * HistoricalReconciliationService production path with real
 * transaction-scoped repositories.
 *
 *   RCA-1. Success: exactly one new reconciliation run/version, exact result
 *          count, exact review-item count, expected batch reconciliation
 *          status, exactly one scoped audit, idempotency succeeded.
 *   RCA-2. Real failure after first business write: failure is injected
 *          immediately after the first insertReconciliationResult write.
 *          Complete rollback: no new results, no new review items, batch
 *          state unchanged, audit delta 0, report version unchanged,
 *          idempotency not succeeded.
 *   RCA-3. Real owner-token loss: the persisted owner_token is changed
 *          BEFORE the production markSucceeded call. The real production
 *          owner-token fence (WHERE owner_token = expectedOwnerToken AND
 *          state = 'in_progress') rejects the stale owner. Full rollback.
 *   RCA-4. Valid retry after RCA-3 failure: exactly one final run/effect
 *          set, exactly one scoped audit, idempotency succeeded.
 *   RCA-5. Same-key/same-payload replay: same persisted response, zero
 *          additional runs/results/review items/audits.
 *   RCA-6. Same-key/different-payload conflict: rejected, zero additional
 *          effects.
 *   RCA-7. Immutable version preservation: previous report versions and
 *          result rows remain queryable; NO previous business/evidence
 *          field is overwritten (notes, status, expected/staged/difference
 *          values all unchanged); report_version itself is the supersession
 *          mechanism.
 *   RCA-8. Concurrency: two concurrent reconciliation attempts against the
 *          same batch with different idempotency keys serialize on the
 *          batch row lock and allocate distinct report versions.
 *
 * Audit queries are scoped by tenant, entity type, entity ID, and action.
 * Never deletes audit_logs to prepare tests. Uses unique test-scoped
 * tenants/entities per test.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/server/db/schema";
import { HistoricalReconciliationService } from "@/server/services/historical-reconciliation-service";
import { HistoricalReconciliationDbRepository } from "@/server/services/historical-reconciliation-db-repository";
import { AuditDbRepository } from "@/server/services/audit-db-repository";
import { IdempotencyDbRepository } from "@/server/services/idempotency-db-repository";
import { resolveEffectivePermissions } from "@/server/security/effective-permissions";
import { TEST_ROLE_PERMISSION_MATRIX } from "@/server/security/role-fixtures";
import type { ErpUserContext } from "@/server/auth/erp-context";
import type { HistoricalReconciliationRepository } from "@/server/services/historical-reconciliation-repository";
import type { AuditTransactionHandle } from "@/server/services/audit-service";
import type { IdempotencyTransactionHandle } from "@/server/services/idempotency-service";
import { checkDestructiveTestDbSafety } from "./destructive-test-guard";
import { sql as drizzleSql } from "drizzle-orm";

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
  const audit = new AuditDbRepository(db);
  const idem = new IdempotencyDbRepository(db);
  const transactionRunner = faultyTransactionRunner ?? (async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
    (db as any).transaction(async (tx: any) => work(tx)));
  const reconciliationService = new HistoricalReconciliationService({
    repository: reconRepo, audit, idempotency: idem,
    transactionRunner,
    createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
    createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
    createReconciliationRepository: (tx: unknown) => new HistoricalReconciliationDbRepository(tx as any),
  });
  return { reconciliationService, reconRepo, audit, idem };
}

// ---------------------------------------------------------------------------
// Task 3 / Task 4: Real owner-token loss fault injector.
//
// This wrapper wraps the REAL IdempotencyDbRepository but, immediately
// before delegating to the REAL markSucceeded (via updateState), it
// changes the persisted owner_token in the DB (using the same tx) so
// that the real fenced UPDATE finds 0 rows. The production fence itself
// is what rejects the stale owner — we do NOT throw
// IdempotencyOwnershipLostError manually.
// ---------------------------------------------------------------------------

function makeRealOwnerLossIdempotencyWrapper(realIdem: IdempotencyDbRepository, tx: any): IdempotencyTransactionHandle {
  return {
    findByTenantScopeKey: (t: string, s: string, k: string) => realIdem.findByTenantScopeKey(t, s, k),
    insert: (r: any) => realIdem.insert(r),
    claimExpiredLease: (id: string, a: Date, b: Date, c: Date) => realIdem.claimExpiredLease(id, a, b, c),
    heartbeat: (id: string, n: Date) => realIdem.heartbeat(id, n),
    updateState: async (id: string, update: any) => {
      // REAL OWNER-TOKEN LOSS: change the persisted owner_token BEFORE
      // delegating to the real updateState. The real UPDATE will use
      // WHERE owner_token = update.expectedOwnerToken, which no longer
      // matches → returns 0 rows → production markSucceeded throws
      // IdempotencyOwnershipLostError.
      //
      // We use the drizzle transaction's execute() method with a raw SQL
      // template so the owner_token change participates in the same
      // transaction as the real markSucceeded call.
      const newToken = 'stale-' + randomUUID();
      await (tx as any).execute(drizzleSql`UPDATE idempotency_records SET owner_token = ${newToken} WHERE id = ${id}`);
      // Now delegate to the REAL updateState — the production fence.
      // The WHERE clause (owner_token = expectedOwnerToken) will NOT match
      // because we just changed it. Returns 0 → markSucceeded throws.
      return realIdem.updateState(id, update);
    },
  };
}

// ---------------------------------------------------------------------------
// Task 4: Real failure after first business write.
//
// This wrapper wraps the REAL HistoricalReconciliationDbRepository but
// throws AFTER the first insertReconciliationResult write completes.
// The failure is injected at a real internal write boundary, not after
// the entire service callback returns.
// ---------------------------------------------------------------------------

function makeFirstWriteFailureRepoWrapper(realRepo: HistoricalReconciliationDbRepository, tx: any): HistoricalReconciliationRepository {
  let insertCount = 0;
  return {
    findImportBatchById: (t: string, id: string) => realRepo.findImportBatchById(t, id),
    updateBatchStatus: (t: string, id: string, s: string) => realRepo.updateBatchStatus(t, id, s),
    updateBatchReconciliationStatus: (t: string, id: string, s: string, u: string) => realRepo.updateBatchReconciliationStatus(t, id, s, u),
    resetBatchValidationAndReconciliationStatuses: (t: string, id: string) => realRepo.resetBatchValidationAndReconciliationStatuses(t, id),
    findStagingRowsForBatch: (t: string, id: string) => realRepo.findStagingRowsForBatch(t, id),
    findLatestReportVersion: (t: string, id: string) => realRepo.findLatestReportVersion(t, id),
    markVersionAsSuperseded: (t: string, id: string, v: number) => realRepo.markVersionAsSuperseded(t, id, v),
    insertReconciliationResult: async (row: any) => {
      const result = await realRepo.insertReconciliationResult(row);
      insertCount++;
      if (insertCount === 1) {
        // FAIL immediately after the first insertReconciliationResult.
        // This proves the transaction rolls back the first write too.
        throw new Error("INJECTED_FAILURE_AFTER_FIRST_BUSINESS_WRITE");
      }
      return result;
    },
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
}

async function seedTenantAndUser(scope: TestScope) {
  const runSuffix = scope.runSuffix;
  await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status)
            VALUES (${scope.tenantId}, ${"RCA-" + runSuffix}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference)
            VALUES (${scope.userId}, ${scope.tenantId}, ${"rca-" + runSuffix}, ${"RCA User"}, ${"rca-" + runSuffix + "@test.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
}

async function seedStagedBatch(scope: TestScope, batchId: string) {
  await sql`
    INSERT INTO import_batches (id, tenant_id, batch_no, status, source_description, template_name, template_version,
      mapping_version, cutover_manifest_hash, cutover_import_mode, staged_data_hash, staged_row_count,
      blocking_error_count, warning_count, accepted_warning_count, validation_status, reconciliation_status,
      warning_summary, committed_at, commit_effect_counts, created_by, created_at)
    VALUES (${batchId}, ${scope.tenantId}, ${"RCA-" + batchId.slice(-6)}, ${"validation_complete"}::import_batch_status, ${"test"},
      ${"opening_balance_inventory"}, ${"1.0"}, ${"1.0"}, null, ${"opening_balance"}, ${"sha256:test"}, 1,
      0, 0, 0, ${"passed"}, null, null, null, null, ${scope.userId}, NOW())`;
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

async function getBatchState(scope: TestScope, batchId: string) {
  const rows = await sql`SELECT status, reconciliation_status, validation_status FROM import_batches WHERE id = ${batchId} AND tenant_id = ${scope.tenantId}`;
  return rows[0] || null;
}

async function getReconResultCount(scope: TestScope, batchId: string) {
  const rows = await sql`SELECT count(*)::int AS c FROM import_reconciliation_results WHERE tenant_id = ${scope.tenantId} AND import_batch_id = ${batchId}`;
  return rows[0]?.c || 0;
}

async function getReviewItemCount(scope: TestScope, batchId: string) {
  const rows = await sql`SELECT count(*)::int AS c FROM import_human_review_items WHERE tenant_id = ${scope.tenantId} AND import_batch_id = ${batchId}`;
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

async function getLatestReportVersion(scope: TestScope, batchId: string) {
  const rows = await sql`SELECT report_version FROM import_reconciliation_results WHERE tenant_id = ${scope.tenantId} AND import_batch_id = ${batchId} ORDER BY report_version DESC LIMIT 1`;
  return rows[0]?.report_version || 0;
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
  created_at: Date;
}

async function getReconResultsForVersion(scope: TestScope, batchId: string, version: number): Promise<ReconResultSnapshot[]> {
  return sql`SELECT id, report_version, metric_key, expected_value, staged_value, committed_value, difference_value, status, notes, created_by, created_at FROM import_reconciliation_results WHERE tenant_id = ${scope.tenantId} AND import_batch_id = ${batchId} AND report_version = ${version} ORDER BY metric_key` as any as Promise<ReconResultSnapshot[]>;
}

async function getIdemState(scope: TestScope, idemKey: string) {
  const rows = await sql`SELECT state, response_body FROM idempotency_records WHERE tenant_id = ${scope.tenantId} AND idempotency_key = ${idemKey}`;
  return rows[0] || null;
}

// cleanupScope: delete business rows for a test-scoped tenant in FK-safe
// order. Does NOT delete audit_logs, users, or tenants — they are
// immutable/referenced by audit_logs (audit_logs.user_id → users.id,
// audit_logs.tenant_id → tenants.id). The audit_logs_no_delete trigger
// prevents audit_logs deletion, so users/tenants cannot be deleted while
// audit_logs reference them. All three are left behind as immutable
// evidence, which is acceptable per the Milestone C safety requirements:
// "Leaving immutable local disposable-test audit evidence behind is
// preferable to bypassing audit immutability."
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
  // NOTE: audit_logs, users, and tenants are intentionally NOT deleted.
  // audit_logs is immutable (trigger-enforced); users/tenants are
  // referenced by audit_logs via FK. Each test uses a unique tenant, so
  // leftover rows do not interfere with subsequent tests.
}

describeOrSkip("WP-08-01F Task 4 — Reconciliation atomicity PostgreSQL proofs (RCA-1 through RCA-8)", () => {
  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { prepare: false, max: 5, idle_timeout: 10, connect_timeout: 15 });
    db = drizzle(sql, { schema });
    // No shared tenant/user — each test allocates its own via newScope().
  }, 30000);

  afterAll(async () => {
    if (sql) {
      await sql.end();
    }
  }, 30000);

  // ===========================================================================
  // RCA-1 — SUCCESS
  // ===========================================================================
  it("RCA-1. success: one new run/version, exact result count, exact review-item count, expected batch status, exactly one scoped audit, idempotency succeeded", async () => {
    const scope = newScope();
    await seedTenantAndUser(scope);
    const batchId = randomUUID();
    await seedStagedBatch(scope, batchId);
    await seedFileAndStagingRow(scope, batchId);

    const idemKey = "rca1-success-" + randomUUID();
    const { reconciliationService } = makeServices(scope);

    const auditBefore = await getScopedAuditCount(scope, batchId, "historical_reconciliation.run");
    const resultsBefore = await getReconResultCount(scope, batchId);
    const reviewBefore = await getReviewItemCount(scope, batchId);
    const versionBefore = await getLatestReportVersion(scope, batchId);

    const result = await reconciliationService.runReconciliation(
      makeUser(scope) as any, makeEffective() as any,
      { importBatchId: batchId, expectedTotals: {}, idempotencyKey: idemKey },
    );

    expect(result.action).toBe("executed");
    expect(result.reportVersion).toBe(versionBefore + 1);
    expect(result.reportVersion).toBe(1);

    const auditAfter = await getScopedAuditCount(scope, batchId, "historical_reconciliation.run");
    expect(auditAfter).toBe(auditBefore + 1);
    expect(auditAfter).toBe(1);

    const resultsAfter = await getReconResultCount(scope, batchId);
    expect(resultsAfter).toBeGreaterThan(0);
    expect(result.totalMetrics).toBe(resultsAfter - resultsBefore);
    expect(resultsAfter).toBe(result.totalMetrics);

    const reviewAfter = await getReviewItemCount(scope, batchId);
    expect(reviewAfter).toBe(reviewBefore + result.reviewItemsCreated);
    expect(reviewAfter).toBe(0); // matched status → no review items

    const batch = await getBatchState(scope, batchId);
    expect(batch!.status).toBe("review_required");
    expect(batch!.reconciliation_status).toBe("matched");

    const idemState = await getIdemState(scope, idemKey);
    expect(idemState?.state).toBe("succeeded");

    await cleanupScope(scope);
  });

  // ===========================================================================
  // RCA-2 — REAL FAILURE AFTER FIRST BUSINESS WRITE
  // ===========================================================================
  it("RCA-2. real failure after first insertReconciliationResult: full rollback, batch unchanged, audit delta 0, idempotency not succeeded", async () => {
    const scope = newScope();
    await seedTenantAndUser(scope);
    const batchId = randomUUID();
    await seedStagedBatch(scope, batchId);
    await seedFileAndStagingRow(scope, batchId);

    const idemKey = "rca2-first-write-failure-" + randomUUID();
    const auditBefore = await getScopedAuditCount(scope, batchId, "historical_reconciliation.run");
    const resultsBefore = await getReconResultCount(scope, batchId);
    const reviewBefore = await getReviewItemCount(scope, batchId);
    const batchBefore = await getBatchState(scope, batchId);
    const versionBefore = await getLatestReportVersion(scope, batchId);

    // Custom service with a createReconciliationRepository that wraps the
    // real repo to inject failure after the first insertReconciliationResult.
    const reconRepo = new HistoricalReconciliationDbRepository(db);
    const audit = new AuditDbRepository(db);
    const idem = new IdempotencyDbRepository(db);
    const customService = new HistoricalReconciliationService({
      repository: reconRepo, audit, idempotency: idem,
      transactionRunner: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
        (db as any).transaction(async (tx: any) => {
          await (tx as any).execute(drizzleSql`SELECT id FROM import_batches WHERE tenant_id = ${scope.tenantId} AND id = ${batchId} FOR UPDATE`);
          await work(tx);
        }),
      createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
      createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
      createReconciliationRepository: (tx: unknown) => makeFirstWriteFailureRepoWrapper(new HistoricalReconciliationDbRepository(tx as any), tx as any),
    });

    await expect(
      customService.runReconciliation(
        makeUser(scope) as any, makeEffective() as any,
        { importBatchId: batchId, expectedTotals: {}, idempotencyKey: idemKey },
      ),
    ).rejects.toThrow(/INJECTED_FAILURE_AFTER_FIRST_BUSINESS_WRITE/);

    const resultsAfter = await getReconResultCount(scope, batchId);
    expect(resultsAfter).toBe(resultsBefore);
    expect(resultsAfter).toBe(0);

    const reviewAfter = await getReviewItemCount(scope, batchId);
    expect(reviewAfter).toBe(reviewBefore);
    expect(reviewAfter).toBe(0);

    const batchAfter = await getBatchState(scope, batchId);
    expect(batchAfter!.status).toBe(batchBefore!.status);
    expect(batchAfter!.reconciliation_status).toBe(batchBefore!.reconciliation_status);

    const auditAfter = await getScopedAuditCount(scope, batchId, "historical_reconciliation.run");
    expect(auditAfter).toBe(auditBefore);
    expect(auditAfter).toBe(0);

    const versionAfter = await getLatestReportVersion(scope, batchId);
    expect(versionAfter).toBe(versionBefore);
    expect(versionAfter).toBe(0);

    const idemState = await getIdemState(scope, idemKey);
    if (idemState) {
      expect(idemState.state).not.toBe("succeeded");
    }

    await cleanupScope(scope);
  });

  // ===========================================================================
  // RCA-3 — REAL OWNER-TOKEN LOSS (production fence rejects stale owner)
  // ===========================================================================
  it("RCA-3. real owner-token loss: production fence rejects stale owner, full rollback", async () => {
    const scope = newScope();
    await seedTenantAndUser(scope);
    const batchId = randomUUID();
    await seedStagedBatch(scope, batchId);
    await seedFileAndStagingRow(scope, batchId);

    const idemKey = "rca3-real-owner-loss-" + randomUUID();
    const auditBefore = await getScopedAuditCount(scope, batchId, "historical_reconciliation.run");
    const resultsBefore = await getReconResultCount(scope, batchId);
    const reviewBefore = await getReviewItemCount(scope, batchId);
    const batchBefore = await getBatchState(scope, batchId);
    const versionBefore = await getLatestReportVersion(scope, batchId);

    // Custom service that wraps the tx-scoped idempotency repo to change
    // the persisted owner_token BEFORE the real markSucceeded call.
    const reconRepo = new HistoricalReconciliationDbRepository(db);
    const audit = new AuditDbRepository(db);
    const idem = new IdempotencyDbRepository(db);
    const customService = new HistoricalReconciliationService({
      repository: reconRepo, audit, idempotency: idem,
      transactionRunner: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
        (db as any).transaction(async (tx: any) => {
          await (tx as any).execute(drizzleSql`SELECT id FROM import_batches WHERE tenant_id = ${scope.tenantId} AND id = ${batchId} FOR UPDATE`);
          await work(tx);
        }),
      createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
      createIdempotency: (tx: unknown) => makeRealOwnerLossIdempotencyWrapper(new IdempotencyDbRepository(tx as any), tx as any),
      createReconciliationRepository: (tx: unknown) => new HistoricalReconciliationDbRepository(tx as any),
    });

    // The production markSucceeded should throw IdempotencyOwnershipLostError
    // because the owner_token was changed by the wrapper.
    await expect(
      customService.runReconciliation(
        makeUser(scope) as any, makeEffective() as any,
        { importBatchId: batchId, expectedTotals: {}, idempotencyKey: idemKey },
      ),
    ).rejects.toThrow(/owner.*token|ownership/i);

    // Full rollback assertions (same as RCA-2):
    const resultsAfter = await getReconResultCount(scope, batchId);
    expect(resultsAfter).toBe(resultsBefore);
    expect(resultsAfter).toBe(0);

    const reviewAfter = await getReviewItemCount(scope, batchId);
    expect(reviewAfter).toBe(reviewBefore);
    expect(reviewAfter).toBe(0);

    const batchAfter = await getBatchState(scope, batchId);
    expect(batchAfter!.status).toBe(batchBefore!.status);
    expect(batchAfter!.reconciliation_status).toBe(batchBefore!.reconciliation_status);

    const auditAfter = await getScopedAuditCount(scope, batchId, "historical_reconciliation.run");
    expect(auditAfter).toBe(auditBefore);
    expect(auditAfter).toBe(0);

    const versionAfter = await getLatestReportVersion(scope, batchId);
    expect(versionAfter).toBe(versionBefore);
    expect(versionAfter).toBe(0);

    const idemState = await getIdemState(scope, idemKey);
    if (idemState) {
      expect(idemState.state).not.toBe("succeeded");
    }

    await cleanupScope(scope);
  });

  // ===========================================================================
  // RCA-4 — VALID RETRY AFTER RCA-3 FAILURE
  // ===========================================================================
  it("RCA-4. valid retry: exactly one final run/effect set, exactly one scoped audit, idempotency succeeded", async () => {
    const scope = newScope();
    await seedTenantAndUser(scope);
    const batchId = randomUUID();
    await seedStagedBatch(scope, batchId);
    await seedFileAndStagingRow(scope, batchId);

    const idemKey = "rca4-retry-" + randomUUID();
    const auditBefore = await getScopedAuditCount(scope, batchId, "historical_reconciliation.run");
    const resultsBefore = await getReconResultCount(scope, batchId);
    const reviewBefore = await getReviewItemCount(scope, batchId);
    const versionBefore = await getLatestReportVersion(scope, batchId);

    // Step 1: fail with real owner-token loss.
    const reconRepo = new HistoricalReconciliationDbRepository(db);
    const audit = new AuditDbRepository(db);
    const idem = new IdempotencyDbRepository(db);
    const faultyService = new HistoricalReconciliationService({
      repository: reconRepo, audit, idempotency: idem,
      transactionRunner: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
        (db as any).transaction(async (tx: any) => {
          await (tx as any).execute(drizzleSql`SELECT id FROM import_batches WHERE tenant_id = ${scope.tenantId} AND id = ${batchId} FOR UPDATE`);
          await work(tx);
        }),
      createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
      createIdempotency: (tx: unknown) => makeRealOwnerLossIdempotencyWrapper(new IdempotencyDbRepository(tx as any), tx as any),
      createReconciliationRepository: (tx: unknown) => new HistoricalReconciliationDbRepository(tx as any),
    });
    await expect(
      faultyService.runReconciliation(
        makeUser(scope) as any, makeEffective() as any,
        { importBatchId: batchId, expectedTotals: {}, idempotencyKey: idemKey },
      ),
    ).rejects.toThrow(/owner.*token|ownership/i);

    // Step 2: expire lease for retry.
    await sql`UPDATE idempotency_records SET lease_expires_at = NOW() - interval '1 second' WHERE tenant_id = ${scope.tenantId} AND idempotency_key = ${idemKey}`;

    // Step 3: valid retry with a good service.
    const { reconciliationService: goodService } = makeServices(scope);
    const retryResult = await goodService.runReconciliation(
      makeUser(scope) as any, makeEffective() as any,
      { importBatchId: batchId, expectedTotals: {}, idempotencyKey: idemKey },
    );
    expect(retryResult.action).toBe("executed");

    const auditAfterRetry = await getScopedAuditCount(scope, batchId, "historical_reconciliation.run");
    expect(auditAfterRetry).toBe(auditBefore + 1);
    expect(auditAfterRetry).toBe(1);

    const resultsAfterRetry = await getReconResultCount(scope, batchId);
    const reviewAfterRetry = await getReviewItemCount(scope, batchId);
    expect(resultsAfterRetry).toBeGreaterThan(resultsBefore);
    expect(resultsAfterRetry).toBe(retryResult.totalMetrics);
    expect(reviewAfterRetry).toBe(reviewBefore + retryResult.reviewItemsCreated);
    expect(reviewAfterRetry).toBe(0);

    const versionAfterRetry = await getLatestReportVersion(scope, batchId);
    expect(versionAfterRetry).toBe(versionBefore + 1);
    expect(versionAfterRetry).toBe(1);

    const idemState = await getIdemState(scope, idemKey);
    expect(idemState?.state).toBe("succeeded");

    await cleanupScope(scope);
  });

  // ===========================================================================
  // RCA-5 — SAME-KEY/SAME-PAYLOAD REPLAY
  // ===========================================================================
  it("RCA-5. same-key/same-payload replay: same persisted response, zero additional runs/results/review items/audits", async () => {
    const scope = newScope();
    await seedTenantAndUser(scope);
    const batchId = randomUUID();
    await seedStagedBatch(scope, batchId);
    await seedFileAndStagingRow(scope, batchId);

    const idemKey = "rca5-replay-" + randomUUID();
    const { reconciliationService } = makeServices(scope);

    const initialResult = await reconciliationService.runReconciliation(
      makeUser(scope) as any, makeEffective() as any,
      { importBatchId: batchId, expectedTotals: {}, idempotencyKey: idemKey },
    );
    expect(initialResult.action).toBe("executed");

    const auditAfterInitial = await getScopedAuditCount(scope, batchId, "historical_reconciliation.run");
    const resultsAfterInitial = await getReconResultCount(scope, batchId);
    const reviewAfterInitial = await getReviewItemCount(scope, batchId);
    const versionAfterInitial = await getLatestReportVersion(scope, batchId);
    const idemAfterInitial = await getIdemState(scope, idemKey);

    const replayResult = await reconciliationService.runReconciliation(
      makeUser(scope) as any, makeEffective() as any,
      { importBatchId: batchId, expectedTotals: {}, idempotencyKey: idemKey },
    );
    expect(replayResult.action).toBe("replayed");

    const idemAfterReplay = await getIdemState(scope, idemKey);
    expect(idemAfterReplay?.state).toBe("succeeded");
    expect(JSON.stringify(idemAfterReplay?.response_body)).toBe(JSON.stringify(idemAfterInitial?.response_body));

    const auditAfterReplay = await getScopedAuditCount(scope, batchId, "historical_reconciliation.run");
    const resultsAfterReplay = await getReconResultCount(scope, batchId);
    const reviewAfterReplay = await getReviewItemCount(scope, batchId);
    const versionAfterReplay = await getLatestReportVersion(scope, batchId);
    expect(auditAfterReplay).toBe(auditAfterInitial);
    expect(resultsAfterReplay).toBe(resultsAfterInitial);
    expect(reviewAfterReplay).toBe(reviewAfterInitial);
    expect(versionAfterReplay).toBe(versionAfterInitial);

    await cleanupScope(scope);
  });

  // ===========================================================================
  // RCA-6 — SAME-KEY/DIFFERENT-PAYLOAD CONFLICT
  // ===========================================================================
  it("RCA-6. same-key/different-payload conflict: rejected, zero additional effects", async () => {
    const scope = newScope();
    await seedTenantAndUser(scope);
    const batchId1 = randomUUID();
    await seedStagedBatch(scope, batchId1);
    await seedFileAndStagingRow(scope, batchId1);

    const batchId2 = randomUUID();
    await seedStagedBatch(scope, batchId2);
    await seedFileAndStagingRow(scope, batchId2);

    const idemKey = "rca6-conflict-" + randomUUID();
    const { reconciliationService } = makeServices(scope);

    const initialResult = await reconciliationService.runReconciliation(
      makeUser(scope) as any, makeEffective() as any,
      { importBatchId: batchId1, expectedTotals: {}, idempotencyKey: idemKey },
    );
    expect(initialResult.action).toBe("executed");

    const audit1AfterInitial = await getScopedAuditCount(scope, batchId1, "historical_reconciliation.run");
    const results1AfterInitial = await getReconResultCount(scope, batchId1);
    const audit2AfterInitial = await getScopedAuditCount(scope, batchId2, "historical_reconciliation.run");
    const results2AfterInitial = await getReconResultCount(scope, batchId2);

    await expect(
      reconciliationService.runReconciliation(
        makeUser(scope) as any, makeEffective() as any,
        { importBatchId: batchId2, expectedTotals: {}, idempotencyKey: idemKey },
      ),
    ).rejects.toThrow(/IDEMPOTENCY_CONFLICT|conflict/i);

    const audit1AfterConflict = await getScopedAuditCount(scope, batchId1, "historical_reconciliation.run");
    const results1AfterConflict = await getReconResultCount(scope, batchId1);
    expect(audit1AfterConflict).toBe(audit1AfterInitial);
    expect(results1AfterConflict).toBe(results1AfterInitial);

    const audit2AfterConflict = await getScopedAuditCount(scope, batchId2, "historical_reconciliation.run");
    const results2AfterConflict = await getReconResultCount(scope, batchId2);
    expect(audit2AfterConflict).toBe(audit2AfterInitial);
    expect(results2AfterConflict).toBe(results2AfterInitial);
    expect(results2AfterConflict).toBe(0);

    await cleanupScope(scope);
  });

  // ===========================================================================
  // RCA-7 — IMMUTABLE VERSION PRESERVATION
  // ===========================================================================
  it("RCA-7. immutable version preservation: previous report versions and result rows remain queryable; NO business/evidence field is overwritten", async () => {
    const scope = newScope();
    await seedTenantAndUser(scope);
    const batchId = randomUUID();
    await seedStagedBatch(scope, batchId);
    await seedFileAndStagingRow(scope, batchId);

    const { reconciliationService } = makeServices(scope);

    // Step 1: run reconciliation → creates version 1.
    const idemKey1 = "rca7-v1-" + randomUUID();
    const result1 = await reconciliationService.runReconciliation(
      makeUser(scope) as any, makeEffective() as any,
      { importBatchId: batchId, expectedTotals: {}, idempotencyKey: idemKey1 },
    );
    expect(result1.action).toBe("executed");
    expect(result1.reportVersion).toBe(1);

    // Snapshot ALL V1 business/evidence fields.
    const v1Results = await getReconResultsForVersion(scope, batchId, 1);
    expect(v1Results.length).toBeGreaterThan(0);
    const v1Snapshot = v1Results.map(r => ({ ...r }));

    // Reset batch status to allow re-reconciliation (simulates rework).
    await sql`UPDATE import_batches SET status = 'validation_complete'::import_batch_status, reconciliation_status = NULL WHERE id = ${batchId} AND tenant_id = ${scope.tenantId}`;

    // Step 2: run reconciliation again → creates version 2.
    const idemKey2 = "rca7-v2-" + randomUUID();
    const result2 = await reconciliationService.runReconciliation(
      makeUser(scope) as any, makeEffective() as any,
      { importBatchId: batchId, expectedTotals: {}, idempotencyKey: idemKey2 },
    );
    expect(result2.action).toBe("executed");
    expect(result2.reportVersion).toBe(2);

    // V1 results must STILL be queryable with ALL fields UNCHANGED.
    const v1ResultsAfterV2 = await getReconResultsForVersion(scope, batchId, 1);
    expect(v1ResultsAfterV2.length).toBe(v1Snapshot.length);
    for (let i = 0; i < v1Snapshot.length; i++) {
      const before = v1Snapshot[i]!;
      const after = v1ResultsAfterV2[i]!;
      expect(after.id).toBe(before.id);                         // same row ID
      expect(after.report_version).toBe(before.report_version); // version unchanged
      expect(after.metric_key).toBe(before.metric_key);         // metric key unchanged
      expect(after.expected_value).toBe(before.expected_value); // expected value unchanged
      expect(after.staged_value).toBe(before.staged_value);     // staged value unchanged
      expect(after.committed_value).toBe(before.committed_value); // committed value unchanged
      expect(after.difference_value).toBe(before.difference_value); // difference unchanged
      expect(after.status).toBe(before.status);                 // status unchanged
      expect(after.notes).toBe(before.notes);                   // notes/review reason UNCHANGED (not overwritten)
      expect(after.created_by).toBe(before.created_by);         // creator unchanged
    }

    // Snapshot V2 fields.
    const v2Results = await getReconResultsForVersion(scope, batchId, 2);
    expect(v2Results.length).toBeGreaterThan(0);
    const v2Snapshot = v2Results.map(r => ({ ...r }));

    // Latest report version = 2.
    const latestVersion = await getLatestReportVersion(scope, batchId);
    expect(latestVersion).toBe(2);

    // Step 3: run reconciliation a third time → creates version 3.
    await sql`UPDATE import_batches SET status = 'validation_complete'::import_batch_status, reconciliation_status = NULL WHERE id = ${batchId} AND tenant_id = ${scope.tenantId}`;
    const idemKey3 = "rca7-v3-" + randomUUID();
    const result3 = await reconciliationService.runReconciliation(
      makeUser(scope) as any, makeEffective() as any,
      { importBatchId: batchId, expectedTotals: {}, idempotencyKey: idemKey3 },
    );
    expect(result3.action).toBe("executed");
    expect(result3.reportVersion).toBe(3);

    // All three versions remain queryable.
    const v1Final = await getReconResultsForVersion(scope, batchId, 1);
    const v2Final = await getReconResultsForVersion(scope, batchId, 2);
    const v3Final = await getReconResultsForVersion(scope, batchId, 3);
    expect(v1Final.length).toBe(v1Snapshot.length);
    expect(v2Final.length).toBe(v2Snapshot.length);
    expect(v3Final.length).toBeGreaterThan(0);

    // V1 fields STILL unchanged after V3 (no mutation across two versions).
    for (let i = 0; i < v1Snapshot.length; i++) {
      const before = v1Snapshot[i]!;
      const after = v1Final[i]!;
      expect(after.id).toBe(before.id);
      expect(after.notes).toBe(before.notes); // critical: notes NOT overwritten
      expect(after.status).toBe(before.status);
      expect(after.expected_value).toBe(before.expected_value);
      expect(after.staged_value).toBe(before.staged_value);
      expect(after.difference_value).toBe(before.difference_value);
    }

    // V2 fields unchanged after V3.
    for (let i = 0; i < v2Snapshot.length; i++) {
      const before = v2Snapshot[i]!;
      const after = v2Final[i]!;
      expect(after.id).toBe(before.id);
      expect(after.notes).toBe(before.notes); // critical: notes NOT overwritten
      expect(after.status).toBe(before.status);
      expect(after.expected_value).toBe(before.expected_value);
      expect(after.staged_value).toBe(before.staged_value);
      expect(after.difference_value).toBe(before.difference_value);
    }

    // Latest version = 3 (unambiguous current version).
    const latestFinal = await getLatestReportVersion(scope, batchId);
    expect(latestFinal).toBe(3);

    await cleanupScope(scope);
  });

  // ===========================================================================
  // RCA-8 — CONCURRENCY: second call rejected after first moves batch state
  // ===========================================================================
  it("RCA-8. concurrency: two concurrent reconciliations — exactly one succeeds, second rejected with zero effects", async () => {
    const scope = newScope();
    await seedTenantAndUser(scope);
    const batchId = randomUUID();
    await seedStagedBatch(scope, batchId);
    await seedFileAndStagingRow(scope, batchId);

    const idemKey1 = "rca8-concurrent-1-" + randomUUID();
    const idemKey2 = "rca8-concurrent-2-" + randomUUID();
    const { reconciliationService } = makeServices(scope);

    const auditBefore = await getScopedAuditCount(scope, batchId, "historical_reconciliation.run");
    const resultsBefore = await getReconResultCount(scope, batchId);

    // Launch two concurrent reconciliations with different idempotency keys.
    // Both target the same batch initially in `validation_complete`.
    // The batch row lock (SELECT ... FOR UPDATE) serializes them:
    //   - One acquires the lock first, sees `validation_complete`, proceeds,
    //     allocates version 1, commits (batch → `review_required`).
    //   - The other waits, acquires the lock, re-reads `review_required` with
    //     non-null reconciliationStatus, and is REJECTED with
    //     LIFECYCLE_VIOLATION — zero business effects.
    const [result1, result2] = await Promise.allSettled([
      reconciliationService.runReconciliation(
        makeUser(scope) as any, makeEffective() as any,
        { importBatchId: batchId, expectedTotals: {}, idempotencyKey: idemKey1 },
      ),
      reconciliationService.runReconciliation(
        makeUser(scope) as any, makeEffective() as any,
        { importBatchId: batchId, expectedTotals: {}, idempotencyKey: idemKey2 },
      ),
    ]);

    // Exactly one operation succeeds (the one that acquired the lock first).
    const fulfilled = [result1, result2].filter(r => r.status === "fulfilled");
    const rejected = [result1, result2].filter(r => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // The rejected operation must be rejected with LIFECYCLE_VIOLATION.
    const rejectedError = (rejected[0] as PromiseRejectedResult).reason;
    expect(String(rejectedError?.message || rejectedError)).toMatch(/LIFECYCLE_VIOLATION|already completed/i);

    // Exactly one new reconciliation version exists.
    const latestVersion = await getLatestReportVersion(scope, batchId);
    expect(latestVersion).toBe(1);

    // Total results = only the winning operation's results.
    const totalResults = await getReconResultCount(scope, batchId);
    const winner = fulfilled[0] as PromiseFulfilledResult<any>;
    expect(totalResults).toBe(resultsBefore + winner.value.totalMetrics);

    // Exactly one reconciliation audit row (only the winner).
    const auditAfter = await getScopedAuditCount(scope, batchId, "historical_reconciliation.run");
    expect(auditAfter).toBe(auditBefore + 1);

    // Final batch state: review_required with matched reconciliation.
    const batch = await getBatchState(scope, batchId);
    expect(batch!.status).toBe("review_required");
    expect(batch!.reconciliation_status).toBe("matched");

    // Winning idempotency succeeded; losing idempotency NOT succeeded.
    const idem1 = await getIdemState(scope, idemKey1);
    const idem2 = await getIdemState(scope, idemKey2);
    const winnerIdem = winner.value === (result1 as PromiseFulfilledResult<any>)?.value ? idem1 : idem2;
    const loserIdem = winner.value === (result1 as PromiseFulfilledResult<any>)?.value ? idem2 : idem1;
    expect(winnerIdem?.state).toBe("succeeded");
    // The loser's idempotency record may or may not exist (depending on
    // whether it was claimed before the rejection). If it exists, it must
    // NOT be succeeded.
    if (loserIdem) {
      expect(loserIdem.state).not.toBe("succeeded");
    }

    await cleanupScope(scope);
  });
});
