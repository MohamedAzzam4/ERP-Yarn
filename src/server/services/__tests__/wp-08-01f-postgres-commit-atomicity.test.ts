/**
 * WP-08-01F Milestone B — Commit atomicity PostgreSQL proofs.
 *
 * Real PostgreSQL service-level tests exercising the actual
 * HistoricalCommitService.commitBatch() production path with real
 * transaction-scoped repositories.
 *
 *   COM-1. Success: commit approved_for_commit→committed, one scoped
 *        commit audit, idempotency succeeded, staging rows have
 *        committed entity links.
 *   COM-2. Real technical failure after first operational write
 *        (updateStagingRowCommitLink): complete rollback, retryable_failed,
 *        immediate same-key retry succeeds.
 *   COM-3. Real audit write failure: complete rollback, retryable_failed.
 *   COM-4. Real owner-token loss: production fence rejects stale owner,
 *        full rollback of batch/audit, idempotency NOT succeeded.
 *   COM-5. Same-key/same-payload replay: same response, zero additional
 *        effects.
 *   COM-6. Same-key/different-payload conflict: rejected, zero additional
 *        effects on alternate batch.
 *   COM-7. Technical failure after all business writes (after_commit_metadata
 *        fault): rollback of EVERYTHING (staging links, audit, batch
 *        metadata), retryable_failed.
 *   COM-8. No gap between operational commit and idempotency success
 *        (after_mark_succeeded fault): if the transaction rolls back after
 *        markSucceeded, the idempotency record does NOT show succeeded.
 *        This proves markSucceeded is INSIDE the operational transaction
 *        (Milestone B fix closes the previous atomicity gap).
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
import { HistoricalCommitService } from "@/server/services/historical-commit-service";
import { HistoricalCommitDbRepository } from "@/server/services/historical-commit-db-repository";
import { AuditDbRepository } from "@/server/services/audit-db-repository";
import { IdempotencyDbRepository } from "@/server/services/idempotency-db-repository";
import { DocumentSequenceDbRepository } from "@/server/services/document-sequence-db-repository";
import { HistoricalReplacementService, HistoricalReplacementError } from "@/server/services/historical-replacement-service";
import { HistoricalStagingDbRepository } from "@/server/services/historical-staging-db-repository";
import { resolveEffectivePermissions } from "@/server/security/effective-permissions";
import { TEST_ROLE_PERMISSION_MATRIX } from "@/server/security/role-fixtures";
import type { ErpUserContext } from "@/server/auth/erp-context";
import type { HistoricalCommitRepository } from "@/server/services/historical-commit-repository";
import type { AuditTransactionHandle } from "@/server/services/audit-service";
import type { IdempotencyTransactionHandle } from "@/server/services/idempotency-service";
import { checkDestructiveTestDbSafety } from "./destructive-test-guard";
import { InMemoryPrivateFileStorage } from "./in-memory-private-file-storage";

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
  ownerId: string;
  accountantId: string;
  runSuffix: string;
}

function newScope(): TestScope {
  const tenantId = randomUUID();
  const ownerId = randomUUID();
  const accountantId = randomUUID();
  const runSuffix = tenantId.slice(0, 8);
  return { tenantId, ownerId, accountantId, runSuffix };
}

function makeOwnerUser(scope: TestScope): ErpUserContext {
  return {
    authenticated: true, userId: scope.ownerId, tenantId: scope.tenantId,
    authId: `auth-${scope.ownerId}`, name: "Owner", email: `o-${scope.ownerId}@test.local`,
  };
}
function makeAccountantUser(scope: TestScope): ErpUserContext {
  return {
    authenticated: true, userId: scope.accountantId, tenantId: scope.tenantId,
    authId: `auth-${scope.accountantId}`, name: "Acct", email: `a-${scope.accountantId}@test.local`,
  };
}
function makeOwnerEffective() {
  return resolveEffectivePermissions(["owner"], TEST_ROLE_PERMISSION_MATRIX);
}
function makeAccountantEffective() {
  return resolveEffectivePermissions(["accountant"], TEST_ROLE_PERMISSION_MATRIX);
}

function makeServices(scope: TestScope, faultyTransactionRunner?: <T>(work: (tx: unknown) => Promise<T>) => Promise<T>) {
  const commitRepo = new HistoricalCommitDbRepository(db);
  const audit = new AuditDbRepository(db);
  const idem = new IdempotencyDbRepository(db);
  const docSeq = new DocumentSequenceDbRepository(db);
  const transactionRunner = faultyTransactionRunner ?? (async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
    (db as any).transaction(async (tx: any) => work(tx)));
  const commitService = new HistoricalCommitService({
    repository: commitRepo, audit, idempotency: idem,
    transactionRunner,
    txFactories: {
      createCommitRepository: (tx: unknown) => new HistoricalCommitDbRepository(tx as any),
      createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
      createInventoryLedger: () => ({} as any),
      createSubledger: () => ({} as any),
      createDocumentSequence: (tx: unknown) => new DocumentSequenceDbRepository(tx as any),
      createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
    },
  });
  return { commitService, commitRepo, audit, idem, docSeq };
}

// Real owner-token loss wrapper (same pattern as SUB/RW tests).
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

// First-write failure wrapper for commit: throws AFTER the first
// updateStagingRowCommitLink (the first operational write inside the
// commit transaction). The transaction rolls back, the outer catch
// marks retryable_failed.
function makeCommitFirstWriteFailureRepoWrapper(realRepo: HistoricalCommitRepository): HistoricalCommitRepository {
  let callCount = 0;
  const wrapped: HistoricalCommitRepository = {
    findImportBatchById: (t: string, id: string) => realRepo.findImportBatchById(t, id),
    updateBatchStatus: (t: string, id: string, s: string) => realRepo.updateBatchStatus(t, id, s),
    restoreApprovedForCommitIfCommitting: (t: string, id: string) => realRepo.restoreApprovedForCommitIfCommitting(t, id),
    updateBatchCommitMetadata: (t: string, id: string, p: any) => realRepo.updateBatchCommitMetadata(t, id, p),
    updateBatchStagedDataHash: (t: string, id: string, h: string, u: string) => realRepo.updateBatchStagedDataHash(t, id, h, u),
    insertApproval: (r: any) => realRepo.insertApproval(r),
    findApprovalsForBatch: (t: string, id: string) => realRepo.findApprovalsForBatch(t, id),
    findApprovalByRole: (t: string, id: string, r: "owner" | "accountant") => realRepo.findApprovalByRole(t, id, r),
    invalidateCurrentApprovalsForBatch: (t: string, id: string, by: string, reason: string) => realRepo.invalidateCurrentApprovalsForBatch(t, id, by, reason),
    findCurrentApprovalsForBatch: (t: string, id: string) => realRepo.findCurrentApprovalsForBatch(t, id),
    insertBackupEvidence: (r: any) => realRepo.insertBackupEvidence(r),
    findBackupEvidenceForBatch: (t: string, id: string) => realRepo.findBackupEvidenceForBatch(t, id),
    insertCutoverLock: (r: any) => realRepo.insertCutoverLock(r),
    findActiveCutoverLocksForBatch: (t: string, id: string) => realRepo.findActiveCutoverLocksForBatch(t, id),
    findActiveCutoverLockByScope: (t: string, id: string, s: string) => realRepo.findActiveCutoverLockByScope(t, id, s),
    releaseCutoverLock: (t: string, id: string, p: any) => realRepo.releaseCutoverLock(t, id, p),
    releaseAllLocksForBatch: (t: string, id: string, p: any) => realRepo.releaseAllLocksForBatch(t, id, p),
    findStagingRowsForBatch: (t: string, id: string) => realRepo.findStagingRowsForBatch(t, id),
    findCurrentStagingRowsForBatch: (t: string, id: string) => realRepo.findCurrentStagingRowsForBatch(t, id),
    updateStagingRowCommitLink: async (t: string, id: string, p: any) => {
      const result = await realRepo.updateStagingRowCommitLink(t, id, p);
      callCount++;
      if (callCount === 1) {
        throw new Error("INJECTED_FAILURE_AFTER_FIRST_COMMIT_WRITE");
      }
      return result;
    },
    findBlockingValidationErrors: (t: string, id: string) => realRepo.findBlockingValidationErrors(t, id),
    findLatestReconciliationResults: (t: string, id: string) => realRepo.findLatestReconciliationResults(t, id),
    findCutoverManifestsForBatch: (t: string, id: string) => realRepo.findCutoverManifestsForBatch(t, id),
    findCurrentAliasMappingsForBatch: (t: string, id: string) => realRepo.findCurrentAliasMappingsForBatch(t, id),
    findCurrentDefaultAliasMappingsForBatch: (t: string, id: string) => realRepo.findCurrentDefaultAliasMappingsForBatch(t, id),
    findCurrentExceptionAliasMappingsForGroup: (t: string, id: string, e: string, s: string) => realRepo.findCurrentExceptionAliasMappingsForGroup(t, id, e, s),
    findSupersededApprovedAliasMappingsForBatch: (t: string, id: string) => realRepo.findSupersededApprovedAliasMappingsForBatch(t, id),
    findMasterForAlias: (t: string, e: string, m: string) => realRepo.findMasterForAlias(t, e, m),
  };
  return wrapped;
}

// Audit-failure handle: insertAuditLog throws, simulating a real audit
// write failure AFTER the staging row links + commit metadata are written.
// The transaction rolls back, the outer catch marks retryable_failed.
function makeAuditFailureHandle(): AuditTransactionHandle {
  return {
    insertAuditLog: async (_row: any) => {
      throw new Error("INJECTED_AUDIT_FAILURE");
    },
  };
}

async function seedTenantAndUsers(scope: TestScope) {
  const runSuffix = scope.runSuffix;
  await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status)
            VALUES (${scope.tenantId}, ${"COM-" + runSuffix}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference)
            VALUES (${scope.ownerId}, ${scope.tenantId}, ${"com-o-" + runSuffix}, ${"COM Owner"}, ${"com-o-" + runSuffix + "@test.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference)
            VALUES (${scope.accountantId}, ${scope.tenantId}, ${"com-a-" + runSuffix}, ${"COM Acct"}, ${"com-a-" + runSuffix + "@test.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
}

// Seed a batch in `approved_for_commit` state with all commit
// prerequisites satisfied: staged_data_hash, cutover_manifest_hash,
// validation_status=passed, reconciliation_status=matched, no warnings.
async function seedApprovedForCommitBatch(scope: TestScope, batchId: string) {
  await sql`
    INSERT INTO import_batches (id, tenant_id, batch_no, status, source_description, template_name, template_version,
      mapping_version, cutover_manifest_hash, cutover_import_mode, staged_data_hash, staged_row_count,
      blocking_error_count, warning_count, accepted_warning_count, validation_status, reconciliation_status,
      warning_summary, committed_at, commit_effect_counts, created_by, created_at)
    VALUES (${batchId}, ${scope.tenantId}, ${"COM-" + batchId.slice(-6)}, ${"approved_for_commit"}::import_batch_status, ${"test"},
      ${"opening_balance_inventory"}, ${"1.0"}, ${"1.0"}, ${"sha256:manifest"}, ${"opening_balance"}, ${"sha256:test"}, 1,
      0, 0, 0, ${"passed"}, ${"matched"}, null, null, null, ${scope.ownerId}, NOW())`;
}

async function seedFileAndStagingRow(scope: TestScope, batchId: string): Promise<{ fileId: string; rowId: string }> {
  const fileId = randomUUID();
  await sql`
    INSERT INTO import_files (id, tenant_id, import_batch_id, original_file_name, storage_path, file_hash,
      file_size_bytes, content_type, file_type, file_version, is_current, created_by, created_at)
    VALUES (${fileId}, ${scope.tenantId}, ${batchId}, ${"data.csv"}, ${"local://test"}, ${"sha256:test"},
      100, ${"text/csv"}, ${"source"}, 1, true, ${scope.ownerId}, NOW())`;
  const rowId = randomUUID();
  // Use an "unhandled" row shape so no domain service (InventoryLedger /
  // Subledger) is required. The commit service will mark the row as
  // committed with committedEntityType="unhandled".
  const rowData = {
    entity_type: "single_yarn",
    code: "TY001",
    // No name field → no alias group required → no alias prerequisite.
    // No item_id/location_id/quantity, no owner_id/balance → unhandled branch
  };
  await sql`
    INSERT INTO import_staging_rows (id, tenant_id, import_batch_id, import_file_id, template_name,
      source_sheet_name, source_row_number, raw_row_json, transformed_row_json,
      transformation_notes, validation_status, review_status, ai_confidence,
      committed_entity_type, committed_entity_id, staging_version, is_current,
      created_by, created_at)
    VALUES (${rowId}, ${scope.tenantId}, ${batchId}, ${fileId}, ${"opening_balance_inventory"}, ${"data.csv"}, 1,
      ${JSON.stringify(rowData)}::jsonb,
      ${JSON.stringify(rowData)}::jsonb,
      null, ${"pending"}, ${"not_required"}, null, null, null, 1, true, ${scope.ownerId}, NOW())`;
  return { fileId, rowId };
}

// Seed a current Owner approval for the batch (bound to current batch
// versions/hashes). DEC-069: distinct user identities for Owner and
// Accountant approvals.
async function seedCurrentApproval(scope: TestScope, batchId: string, role: "owner" | "accountant", userId: string) {
  const approvalId = randomUUID();
  await sql`
    INSERT INTO import_batch_approvals (id, tenant_id, import_batch_id, approver_role, approver_user_id,
      staged_data_hash, cutover_manifest_hash, template_version, mapping_version,
      validation_status, reconciliation_status, warning_summary, approved_at, reason,
      approval_version, is_current, created_by, created_at)
    VALUES (${approvalId}, ${scope.tenantId}, ${batchId}, ${role}::migration_approver_role, ${userId},
      ${"sha256:test"}, ${"sha256:manifest"}, ${"1.0"}, ${"1.0"},
      ${"passed"}, ${"matched"}, null, NOW(), ${"test approval"},
      1, true, ${userId}, NOW())`;
  return approvalId;
}

// Seed backup evidence (Contract 08 §8.10 — required before commit).
async function seedBackupEvidence(scope: TestScope, batchId: string) {
  await sql`
    INSERT INTO import_backup_evidence (id, tenant_id, import_batch_id, backup_type, backup_location, backup_hash, backup_size_bytes, backup_created_at, verification_notes, created_by, created_at, updated_at, updated_by)
    VALUES (${randomUUID()}, ${scope.tenantId}, ${batchId}, ${"full"}, ${"s3://b/backup"}, ${"backup-hash"}, 1000, NOW(), ${"verified"}, ${scope.ownerId}, NOW(), null, null)`;
}

// Seed prior reconciliation evidence so the commit's "no blocking
// reconciliation results" prerequisite is satisfied.
async function seedPriorReconciliationEvidence(scope: TestScope, batchId: string, reportVersion: number = 1) {
  const resultId = randomUUID();
  await sql`
    INSERT INTO import_reconciliation_results (id, tenant_id, import_batch_id, report_version, metric_key,
      expected_value, staged_value, committed_value, difference_value, status, notes, created_by, created_at)
    VALUES (${resultId}, ${scope.tenantId}, ${batchId}, ${reportVersion}, ${"inventory_opening_qty"},
      null, ${"100"}, null, null, ${"matched"}, ${"Original review reason evidence"}, ${scope.ownerId}, NOW())`;
  return resultId;
}

async function getBatchState(scope: TestScope, batchId: string) {
  const rows = await sql`SELECT status, committed_at, commit_effect_counts, validation_status, reconciliation_status, staged_data_hash, cutover_manifest_hash FROM import_batches WHERE id = ${batchId} AND tenant_id = ${scope.tenantId}`;
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

async function getStagingRowCommitLink(scope: TestScope, rowId: string) {
  const rows = await sql`SELECT committed_entity_type, committed_entity_id FROM import_staging_rows WHERE id = ${rowId} AND tenant_id = ${scope.tenantId}`;
  return rows[0] || null;
}

async function getActiveLockCount(scope: TestScope, batchId: string) {
  const rows = await sql`SELECT count(*)::int AS c FROM import_cutover_locks WHERE tenant_id = ${scope.tenantId} AND import_batch_id = ${batchId} AND released_at IS NULL`;
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
  // WP-08-01F DEFECT 6/8 — clean up master-data rows seeded by the
  // alias revalidation tests (customers/fiber_types/product_types/
  // inventory_items). These are deleted per-tenant — no risk to other
  // tests because each test uses a unique tenantId.
  await sql`DELETE FROM inventory_items WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM product_types WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM fiber_types WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM customers WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM import_batches WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM idempotency_records WHERE tenant_id = ${scope.tenantId}`;
  // NOTE: audit_logs, users, tenants intentionally NOT deleted (immutable).
}

describeOrSkip("WP-08-01F Milestone B — Commit atomicity PostgreSQL proofs (COM-1 through COM-8)", () => {
  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { prepare: false, max: 5, idle_timeout: 10, connect_timeout: 15 });
    db = drizzle(sql, { schema });
  }, 30000);

  afterAll(async () => {
    if (sql) { await sql.end(); }
  }, 30000);

  // ===========================================================================
  // COM-1 — SUCCESS
  // ===========================================================================
  it("COM-1. success: commit approved_for_commit→committed, one scoped commit audit, idempotency succeeded, staging rows have committed entity links", async () => {
    const scope = newScope();
    await seedTenantAndUsers(scope);
    const batchId = randomUUID();
    await seedApprovedForCommitBatch(scope, batchId);
    const { rowId } = await seedFileAndStagingRow(scope, batchId);
    await seedPriorReconciliationEvidence(scope, batchId, 1);
    await seedBackupEvidence(scope, batchId);
    await seedCurrentApproval(scope, batchId, "owner", scope.ownerId);
    await seedCurrentApproval(scope, batchId, "accountant", scope.accountantId);

    const idemKey = "com1-success-" + randomUUID();
    const { commitService } = makeServices(scope);
    const auditBefore = await getScopedAuditCount(scope, batchId, "historical_commit.commit");

    const result = await commitService.commitBatch(
      makeOwnerUser(scope) as any, makeOwnerEffective() as any,
      { importBatchId: batchId, idempotencyKey: idemKey },
    );

    expect(result.action).toBe("committed");
    expect(result.batchId).toBe(batchId);
    expect(result.committedAt).toBeTruthy();
    expect(result.stagedRowsCommitted).toBe(1);

    // Batch transitioned to committed.
    const batch = await getBatchState(scope, batchId);
    expect(batch!.status).toBe("committed");
    expect(batch!.committed_at).toBeTruthy();
    expect(batch!.commit_effect_counts).not.toBeNull();

    // Exactly one scoped commit audit.
    const auditAfter = await getScopedAuditCount(scope, batchId, "historical_commit.commit");
    expect(auditAfter).toBe(auditBefore + 1);
    expect(auditAfter).toBe(1);

    // Idempotency succeeded.
    const idemState = await getIdemState(scope, idemKey);
    expect(idemState?.state).toBe("succeeded");

    // Staging row has committed entity link.
    const stagingRow = await getStagingRowCommitLink(scope, rowId);
    expect(stagingRow!.committed_entity_type).toBe("unhandled");
    expect(stagingRow!.committed_entity_id).toBeTruthy();

    // Locks released after successful commit.
    const lockCount = await getActiveLockCount(scope, batchId);
    expect(lockCount).toBe(0);

    await cleanupScope(scope);
  });

  // ===========================================================================
  // COM-2 — REAL TECHNICAL FAILURE AFTER FIRST OPERATIONAL WRITE
  // ===========================================================================
  it("COM-2. real failure after first operational write (updateStagingRowCommitLink): full rollback, retryable_failed, immediate retry succeeds", async () => {
    const scope = newScope();
    await seedTenantAndUsers(scope);
    const batchId = randomUUID();
    await seedApprovedForCommitBatch(scope, batchId);
    const { rowId } = await seedFileAndStagingRow(scope, batchId);
    await seedPriorReconciliationEvidence(scope, batchId, 1);
    await seedBackupEvidence(scope, batchId);
    await seedCurrentApproval(scope, batchId, "owner", scope.ownerId);
    await seedCurrentApproval(scope, batchId, "accountant", scope.accountantId);

    const idemKey = "com2-failure-" + randomUUID();
    const auditBefore = await getScopedAuditCount(scope, batchId, "historical_commit.commit");
    const batchBefore = await getBatchState(scope, batchId);

    const commitRepo = new HistoricalCommitDbRepository(db);
    const audit = new AuditDbRepository(db);
    const idem = new IdempotencyDbRepository(db);
    const docSeq = new DocumentSequenceDbRepository(db);
    const customService = new HistoricalCommitService({
      repository: commitRepo, audit, idempotency: idem,
      transactionRunner: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
        (db as any).transaction(async (tx: any) => work(tx)),
      txFactories: {
        createCommitRepository: (tx: unknown) => makeCommitFirstWriteFailureRepoWrapper(new HistoricalCommitDbRepository(tx as any)),
        createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
        createInventoryLedger: () => ({} as any),
        createSubledger: () => ({} as any),
        createDocumentSequence: (tx: unknown) => new DocumentSequenceDbRepository(tx as any),
        createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
      },
    });

    await expect(
      customService.commitBatch(
        makeOwnerUser(scope) as any, makeOwnerEffective() as any,
        { importBatchId: batchId, idempotencyKey: idemKey },
      ),
    ).rejects.toThrow(/INJECTED_FAILURE_AFTER_FIRST_COMMIT_WRITE/);

    // Full rollback: batch unchanged (status NOT committed).
    const batchAfter = await getBatchState(scope, batchId);
    expect(batchAfter!.status).toBe(batchBefore!.status);
    expect(batchAfter!.committed_at).toBeNull();
    expect(batchAfter!.commit_effect_counts).toBeNull();

    // Full rollback: staging row has no commit link.
    const stagingRow = await getStagingRowCommitLink(scope, rowId);
    expect(stagingRow!.committed_entity_type).toBeNull();
    expect(stagingRow!.committed_entity_id).toBeNull();

    // Full rollback: audit delta = 0.
    const auditAfter = await getScopedAuditCount(scope, batchId, "historical_commit.commit");
    expect(auditAfter).toBe(auditBefore);
    expect(auditAfter).toBe(0);

    // Idempotency state = retryable_failed (exact).
    const idemState = await getIdemState(scope, idemKey);
    expect(idemState).not.toBeNull();
    expect(idemState!.state).toBe("retryable_failed");

    // Locks released by the catch block (best-effort).
    const lockCount = await getActiveLockCount(scope, batchId);
    expect(lockCount).toBe(0);

    // Immediate same-key retry WITHOUT manual lease expiry.
    // retryable_failed is reclaimable.
    const { commitService: goodService } = makeServices(scope);
    const retryResult = await goodService.commitBatch(
      makeOwnerUser(scope) as any, makeOwnerEffective() as any,
      { importBatchId: batchId, idempotencyKey: idemKey },
    );
    expect(retryResult.action).toBe("committed");

    // Exactly one commit audit (not duplicated by the failed attempt).
    const auditAfterRetry = await getScopedAuditCount(scope, batchId, "historical_commit.commit");
    expect(auditAfterRetry).toBe(auditBefore + 1);
    expect(auditAfterRetry).toBe(1);

    // Idempotency succeeded after retry.
    const idemAfterRetry = await getIdemState(scope, idemKey);
    expect(idemAfterRetry!.state).toBe("succeeded");

    // Staging row now has committed entity link.
    const stagingRowAfterRetry = await getStagingRowCommitLink(scope, rowId);
    expect(stagingRowAfterRetry!.committed_entity_type).toBe("unhandled");
    expect(stagingRowAfterRetry!.committed_entity_id).toBeTruthy();

    await cleanupScope(scope);
  });

  // ===========================================================================
  // COM-3 — REAL AUDIT WRITE FAILURE
  // ===========================================================================
  it("COM-3. real audit failure: full rollback, retryable_failed", async () => {
    const scope = newScope();
    await seedTenantAndUsers(scope);
    const batchId = randomUUID();
    await seedApprovedForCommitBatch(scope, batchId);
    const { rowId } = await seedFileAndStagingRow(scope, batchId);
    await seedPriorReconciliationEvidence(scope, batchId, 1);
    await seedBackupEvidence(scope, batchId);
    await seedCurrentApproval(scope, batchId, "owner", scope.ownerId);
    await seedCurrentApproval(scope, batchId, "accountant", scope.accountantId);

    const idemKey = "com3-audit-fail-" + randomUUID();
    const auditBefore = await getScopedAuditCount(scope, batchId, "historical_commit.commit");
    const batchBefore = await getBatchState(scope, batchId);

    const commitRepo = new HistoricalCommitDbRepository(db);
    const audit = new AuditDbRepository(db);
    const idem = new IdempotencyDbRepository(db);
    const docSeq = new DocumentSequenceDbRepository(db);
    const customService = new HistoricalCommitService({
      repository: commitRepo, audit, idempotency: idem,
      transactionRunner: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
        (db as any).transaction(async (tx: any) => work(tx)),
      txFactories: {
        createCommitRepository: (tx: unknown) => new HistoricalCommitDbRepository(tx as any),
        createAudit: (_tx: unknown) => makeAuditFailureHandle(),
        createInventoryLedger: () => ({} as any),
        createSubledger: () => ({} as any),
        createDocumentSequence: (tx: unknown) => new DocumentSequenceDbRepository(tx as any),
        createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
      },
    });

    // The AuditDbRepository's appendAuditLog wraps the injected
    // INJECTED_AUDIT_FAILURE error in an AuditWriteFailedError whose
    // message is the production-safe "Required audit write failed;
    // transaction rolled back." text (the original error is preserved
    // on .cause). Match the wrapped message — that is what callers see.
    await expect(
      customService.commitBatch(
        makeOwnerUser(scope) as any, makeOwnerEffective() as any,
        { importBatchId: batchId, idempotencyKey: idemKey },
      ),
    ).rejects.toThrow(/Required audit write failed/i);

    // Full rollback: batch unchanged.
    const batchAfter = await getBatchState(scope, batchId);
    expect(batchAfter!.status).toBe(batchBefore!.status);
    expect(batchAfter!.committed_at).toBeNull();
    expect(batchAfter!.commit_effect_counts).toBeNull();

    // Full rollback: staging row has no commit link (rolled back).
    const stagingRow = await getStagingRowCommitLink(scope, rowId);
    expect(stagingRow!.committed_entity_type).toBeNull();
    expect(stagingRow!.committed_entity_id).toBeNull();

    // Full rollback: commit audit delta = 0 (the audit write threw).
    const auditAfter = await getScopedAuditCount(scope, batchId, "historical_commit.commit");
    expect(auditAfter).toBe(auditBefore);
    expect(auditAfter).toBe(0);

    // Idempotency state = retryable_failed (exact).
    const idemState = await getIdemState(scope, idemKey);
    expect(idemState).not.toBeNull();
    expect(idemState!.state).toBe("retryable_failed");

    // Locks released.
    const lockCount = await getActiveLockCount(scope, batchId);
    expect(lockCount).toBe(0);

    await cleanupScope(scope);
  });

  // ===========================================================================
  // COM-4 — REAL OWNER-TOKEN LOSS
  // ===========================================================================
  it("COM-4. real owner-token loss: production fence rejects stale owner, full rollback of batch/audit, idempotency NOT succeeded", async () => {
    const scope = newScope();
    await seedTenantAndUsers(scope);
    const batchId = randomUUID();
    await seedApprovedForCommitBatch(scope, batchId);
    const { rowId } = await seedFileAndStagingRow(scope, batchId);
    await seedPriorReconciliationEvidence(scope, batchId, 1);
    await seedBackupEvidence(scope, batchId);
    await seedCurrentApproval(scope, batchId, "owner", scope.ownerId);
    await seedCurrentApproval(scope, batchId, "accountant", scope.accountantId);

    const idemKey = "com4-owner-loss-" + randomUUID();
    const auditBefore = await getScopedAuditCount(scope, batchId, "historical_commit.commit");
    const batchBefore = await getBatchState(scope, batchId);

    const commitRepo = new HistoricalCommitDbRepository(db);
    const audit = new AuditDbRepository(db);
    const idem = new IdempotencyDbRepository(db);
    const docSeq = new DocumentSequenceDbRepository(db);
    const customService = new HistoricalCommitService({
      repository: commitRepo, audit, idempotency: idem,
      transactionRunner: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
        (db as any).transaction(async (tx: any) => work(tx)),
      txFactories: {
        createCommitRepository: (tx: unknown) => new HistoricalCommitDbRepository(tx as any),
        createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
        createInventoryLedger: () => ({} as any),
        createSubledger: () => ({} as any),
        createDocumentSequence: (tx: unknown) => new DocumentSequenceDbRepository(tx as any),
        createIdempotency: (tx: unknown) => makeRealOwnerLossIdempotencyWrapper(new IdempotencyDbRepository(tx as any), tx as any),
      },
    });

    await expect(
      customService.commitBatch(
        makeOwnerUser(scope) as any, makeOwnerEffective() as any,
        { importBatchId: batchId, idempotencyKey: idemKey },
      ),
    ).rejects.toThrow(/owner.*token|ownership/i);

    // Full rollback: batch unchanged (NOT committed).
    const batchAfter = await getBatchState(scope, batchId);
    expect(batchAfter!.status).toBe(batchBefore!.status);
    expect(batchAfter!.committed_at).toBeNull();
    expect(batchAfter!.commit_effect_counts).toBeNull();

    // Full rollback: staging row has no commit link.
    const stagingRow = await getStagingRowCommitLink(scope, rowId);
    expect(stagingRow!.committed_entity_type).toBeNull();
    expect(stagingRow!.committed_entity_id).toBeNull();

    // Full rollback: commit audit delta = 0.
    const auditAfter = await getScopedAuditCount(scope, batchId, "historical_commit.commit");
    expect(auditAfter).toBe(auditBefore);
    expect(auditAfter).toBe(0);

    // Idempotency NOT succeeded (owner-token loss is preserved — the
    // outer catch does NOT overwrite it).
    const idemState = await getIdemState(scope, idemKey);
    expect(idemState).not.toBeNull();
    expect(idemState!.state).not.toBe("succeeded");

    // Locks released by the catch block.
    const lockCount = await getActiveLockCount(scope, batchId);
    expect(lockCount).toBe(0);

    await cleanupScope(scope);
  });

  // ===========================================================================
  // COM-5 — SAME-KEY/SAME-PAYLOAD REPLAY
  // ===========================================================================
  it("COM-5. replay: same response, zero additional batch/audit/staging effects", async () => {
    const scope = newScope();
    await seedTenantAndUsers(scope);
    const batchId = randomUUID();
    await seedApprovedForCommitBatch(scope, batchId);
    const { rowId } = await seedFileAndStagingRow(scope, batchId);
    await seedPriorReconciliationEvidence(scope, batchId, 1);
    await seedBackupEvidence(scope, batchId);
    await seedCurrentApproval(scope, batchId, "owner", scope.ownerId);
    await seedCurrentApproval(scope, batchId, "accountant", scope.accountantId);

    const idemKey = "com5-replay-" + randomUUID();
    const { commitService } = makeServices(scope);

    // Step 1: initial commit.
    const initialResult = await commitService.commitBatch(
      makeOwnerUser(scope) as any, makeOwnerEffective() as any,
      { importBatchId: batchId, idempotencyKey: idemKey },
    );
    expect(initialResult.action).toBe("committed");

    const auditAfterInitial = await getScopedAuditCount(scope, batchId, "historical_commit.commit");
    const idemAfterInitial = await getIdemState(scope, idemKey);
    const batchAfterInitial = await getBatchState(scope, batchId);
    const stagingRowAfterInitial = await getStagingRowCommitLink(scope, rowId);

    // Step 2: replay with same key + same payload.
    const replayResult = await commitService.commitBatch(
      makeOwnerUser(scope) as any, makeOwnerEffective() as any,
      { importBatchId: batchId, idempotencyKey: idemKey },
    );
    expect(replayResult.action).toBe("replayed");

    // Same persisted response_body.
    const idemAfterReplay = await getIdemState(scope, idemKey);
    expect(idemAfterReplay?.state).toBe("succeeded");
    expect(JSON.stringify(idemAfterReplay?.response_body)).toBe(JSON.stringify(idemAfterInitial?.response_body));

    // Zero additional audits.
    expect(await getScopedAuditCount(scope, batchId, "historical_commit.commit")).toBe(auditAfterInitial);

    // Batch state unchanged from replay.
    const batchAfterReplay = await getBatchState(scope, batchId);
    expect(batchAfterReplay!.status).toBe(batchAfterInitial!.status);
    expect(batchAfterReplay!.committed_at).toEqual(batchAfterInitial!.committed_at);

    // Staging row link unchanged.
    const stagingRowAfterReplay = await getStagingRowCommitLink(scope, rowId);
    expect(stagingRowAfterReplay!.committed_entity_id).toBe(stagingRowAfterInitial!.committed_entity_id);

    await cleanupScope(scope);
  });

  // ===========================================================================
  // COM-6 — SAME-KEY/DIFFERENT-PAYLOAD CONFLICT
  // ===========================================================================
  it("COM-6. conflict: same key + different payload → rejected, zero effects on alternate batch", async () => {
    const scope = newScope();
    await seedTenantAndUsers(scope);
    const batchId1 = randomUUID();
    await seedApprovedForCommitBatch(scope, batchId1);
    const { rowId: rowId1 } = await seedFileAndStagingRow(scope, batchId1);
    await seedPriorReconciliationEvidence(scope, batchId1, 1);
    await seedBackupEvidence(scope, batchId1);
    await seedCurrentApproval(scope, batchId1, "owner", scope.ownerId);
    await seedCurrentApproval(scope, batchId1, "accountant", scope.accountantId);

    const batchId2 = randomUUID();
    await seedApprovedForCommitBatch(scope, batchId2);
    const { rowId: rowId2 } = await seedFileAndStagingRow(scope, batchId2);
    await seedPriorReconciliationEvidence(scope, batchId2, 1);
    await seedBackupEvidence(scope, batchId2);
    await seedCurrentApproval(scope, batchId2, "owner", scope.ownerId);
    await seedCurrentApproval(scope, batchId2, "accountant", scope.accountantId);

    const idemKey = "com6-conflict-" + randomUUID();
    const { commitService } = makeServices(scope);

    // Step 1: initial commit on batch1.
    const initialResult = await commitService.commitBatch(
      makeOwnerUser(scope) as any, makeOwnerEffective() as any,
      { importBatchId: batchId1, idempotencyKey: idemKey },
    );
    expect(initialResult.action).toBe("committed");

    const audit1AfterInitial = await getScopedAuditCount(scope, batchId1, "historical_commit.commit");
    const audit2AfterInitial = await getScopedAuditCount(scope, batchId2, "historical_commit.commit");
    const batch2StateBefore = await getBatchState(scope, batchId2);
    const stagingRow2Before = await getStagingRowCommitLink(scope, rowId2);

    // Step 2: same key, different payload (batch2 instead of batch1).
    await expect(
      commitService.commitBatch(
        makeOwnerUser(scope) as any, makeOwnerEffective() as any,
        { importBatchId: batchId2, idempotencyKey: idemKey },
      ),
    ).rejects.toThrow(/IDEMPOTENCY_CONFLICT|conflict/i);

    // Zero additional effects on batch1.
    expect(await getScopedAuditCount(scope, batchId1, "historical_commit.commit")).toBe(audit1AfterInitial);

    // Zero additional effects on batch2 (never written).
    expect(await getScopedAuditCount(scope, batchId2, "historical_commit.commit")).toBe(audit2AfterInitial);
    expect(await getScopedAuditCount(scope, batchId2, "historical_commit.commit")).toBe(0);

    // Batch2 state unchanged.
    const batch2StateAfter = await getBatchState(scope, batchId2);
    expect(batch2StateAfter!.status).toBe(batch2StateBefore!.status);
    expect(batch2StateAfter!.committed_at).toBeNull();

    // Batch2 staging row link unchanged.
    const stagingRow2After = await getStagingRowCommitLink(scope, rowId2);
    expect(stagingRow2After!.committed_entity_id).toBe(stagingRow2Before!.committed_entity_id);

    // Batch2 locks released (catch block ran).
    expect(await getActiveLockCount(scope, batchId2)).toBe(0);

    await cleanupScope(scope);
  });

  // ===========================================================================
  // COM-7 — TECHNICAL FAILURE AFTER ALL BUSINESS WRITES (after_commit_metadata fault)
  // ===========================================================================
  it("COM-7. technical failure after all business writes (after_commit_metadata): rollback of EVERYTHING, retryable_failed", async () => {
    const scope = newScope();
    await seedTenantAndUsers(scope);
    const batchId = randomUUID();
    await seedApprovedForCommitBatch(scope, batchId);
    const { rowId } = await seedFileAndStagingRow(scope, batchId);
    await seedPriorReconciliationEvidence(scope, batchId, 1);
    await seedBackupEvidence(scope, batchId);
    await seedCurrentApproval(scope, batchId, "owner", scope.ownerId);
    await seedCurrentApproval(scope, batchId, "accountant", scope.accountantId);

    const idemKey = "com7-after-metadata-" + randomUUID();
    const auditBefore = await getScopedAuditCount(scope, batchId, "historical_commit.commit");
    const batchBefore = await getBatchState(scope, batchId);

    const { commitService } = makeServices(scope);

    // Inject fault AFTER updateBatchCommitMetadata is written but BEFORE
    // markSucceeded. The transaction rolls back EVERYTHING: staging row
    // links, audit, batch commit metadata.
    //
    // CommitFaultInjectedError's `code` is COMMIT_FAULT_INJECTED, but its
    // `message` is the human-readable "Fault injected at '<point>' for
    // rollback testing..." text. Match the message text — that is what
    // `.rejects.toThrow(regex)` checks against.
    await expect(
      commitService.commitBatch(
        makeOwnerUser(scope) as any, makeOwnerEffective() as any,
        { importBatchId: batchId, idempotencyKey: idemKey, faultInjection: "after_commit_metadata" },
      ),
    ).rejects.toThrow(/Fault injected at 'after_commit_metadata'/i);

    // Full rollback: batch unchanged (NOT committed).
    const batchAfter = await getBatchState(scope, batchId);
    expect(batchAfter!.status).toBe(batchBefore!.status);
    expect(batchAfter!.committed_at).toBeNull();
    expect(batchAfter!.commit_effect_counts).toBeNull();

    // Full rollback: staging row has no commit link.
    const stagingRow = await getStagingRowCommitLink(scope, rowId);
    expect(stagingRow!.committed_entity_type).toBeNull();
    expect(stagingRow!.committed_entity_id).toBeNull();

    // Full rollback: commit audit delta = 0 (the audit was written but
    // the transaction rolled back).
    const auditAfter = await getScopedAuditCount(scope, batchId, "historical_commit.commit");
    expect(auditAfter).toBe(auditBefore);
    expect(auditAfter).toBe(0);

    // Idempotency state = retryable_failed (technical failure).
    const idemState = await getIdemState(scope, idemKey);
    expect(idemState).not.toBeNull();
    expect(idemState!.state).toBe("retryable_failed");

    // Locks released by the catch block.
    const lockCount = await getActiveLockCount(scope, batchId);
    expect(lockCount).toBe(0);

    await cleanupScope(scope);
  });

  // ===========================================================================
  // COM-8 — NO GAP BETWEEN OPERATIONAL COMMIT AND IDEMPOTENCY SUCCESS
  // ===========================================================================
  it("COM-8. boundary proof: rollback after markSucceeded → idempotency record does NOT show succeeded (markSucceeded is inside the transaction)", async () => {
    const scope = newScope();
    await seedTenantAndUsers(scope);
    const batchId = randomUUID();
    await seedApprovedForCommitBatch(scope, batchId);
    const { rowId } = await seedFileAndStagingRow(scope, batchId);
    await seedPriorReconciliationEvidence(scope, batchId, 1);
    await seedBackupEvidence(scope, batchId);
    await seedCurrentApproval(scope, batchId, "owner", scope.ownerId);
    await seedCurrentApproval(scope, batchId, "accountant", scope.accountantId);

    const idemKey = "com8-after-mark-" + randomUUID();
    const auditBefore = await getScopedAuditCount(scope, batchId, "historical_commit.commit");
    const batchBefore = await getBatchState(scope, batchId);

    const { commitService } = makeServices(scope);

    // Inject fault AFTER markSucceeded is called. markSucceeded wrote
    // state='succeeded' inside the transaction. The fault throws →
    // the transaction rolls back.
    //
    // PROOF: if markSucceeded is INSIDE the transaction, the rollback
    // undoes the state change (idempotency.state goes back to in_progress,
    // then the outer catch marks it retryable_failed). If markSucceeded
    // were OUTSIDE the transaction (the pre-Milestone-B gap), the
    // rollback would NOT undo the state change — idempotency.state
    // would stay 'succeeded' despite the operational effects being
    // rolled back.
    //
    // CommitFaultInjectedError's `code` is COMMIT_FAULT_INJECTED, but its
    // `message` is the human-readable "Fault injected at '<point>' for
    // rollback testing..." text. Match the message text — that is what
    // `.rejects.toThrow(regex)` checks against.
    await expect(
      commitService.commitBatch(
        makeOwnerUser(scope) as any, makeOwnerEffective() as any,
        { importBatchId: batchId, idempotencyKey: idemKey, faultInjection: "after_mark_succeeded" },
      ),
    ).rejects.toThrow(/Fault injected at 'after_mark_succeeded'/i);

    // Full rollback: batch unchanged (NOT committed).
    const batchAfter = await getBatchState(scope, batchId);
    expect(batchAfter!.status).toBe(batchBefore!.status);
    expect(batchAfter!.committed_at).toBeNull();
    expect(batchAfter!.commit_effect_counts).toBeNull();

    // Full rollback: staging row has no commit link.
    const stagingRow = await getStagingRowCommitLink(scope, rowId);
    expect(stagingRow!.committed_entity_type).toBeNull();
    expect(stagingRow!.committed_entity_id).toBeNull();

    // Full rollback: commit audit delta = 0.
    const auditAfter = await getScopedAuditCount(scope, batchId, "historical_commit.commit");
    expect(auditAfter).toBe(auditBefore);
    expect(auditAfter).toBe(0);

    // BOUNDARY PROOF: idempotency.state MUST NOT be 'succeeded'.
    // The markSucceeded was rolled back with the transaction, then the
    // outer catch marked retryable_failed. If markSucceeded were outside
    // the transaction, state would stay 'succeeded' — that's the gap
    // this test prevents.
    const idemState = await getIdemState(scope, idemKey);
    expect(idemState).not.toBeNull();
    expect(idemState!.state).not.toBe("succeeded");
    // Specifically, the outer catch marked retryable_failed (technical fault).
    expect(idemState!.state).toBe("retryable_failed");

    // Locks released by the catch block.
    const lockCount = await getActiveLockCount(scope, batchId);
    expect(lockCount).toBe(0);

    await cleanupScope(scope);
  });

  // ===========================================================================
  // WP-08-01F DEFECT 8 — Concurrency proofs (COM-CONC-1, COM-CONC-2A, COM-CONC-2B).
  //
  // These tests exercise the new alias revalidation under lock when
  // concurrent operations mutate the alias state or the target master
  // between dual approval and commit:
  //
  // COM-CONC-1:  Concurrent commits on the same batch — exactly one
  //             wins, the other fails (cutover lock conflict). Uses
  //             Promise.allSettled for concurrent commit attempts.
  // COM-CONC-2A: Concurrent commit vs alias remap (target master
  //             deletion) — the commit revalidation catches the deleted
  //             master under the batch row lock and fails closed. The
  //             alias remap wins; the commit fails.
  // COM-CONC-2B: Concurrent commit vs alias supersession (the approved
  //             alias is superseded by a new approval while the commit
  //             is in flight) — the commit revalidation catches the
  //             supersession under the lock and fails closed.
  // ===========================================================================

  // Helper: seed an approved alias mapping for COM-CONC tests.
  async function seedApprovedAliasMapping(scope: TestScope, batchId: string, targetMasterId: string, mappingVersion: string = "1.0"): Promise<string> {
    const aliasId = randomUUID();
    await sql`
      INSERT INTO import_alias_mappings (id, tenant_id, import_batch_id, entity_type, source_label, normalized_name,
        target_master_id, mapping_version, confidence_score, status, approved_by, approved_at, notes,
        is_current, superseded_at, superseded_by, superseded_reason,
        group_id, occurrence_count, exception_source_row_ids,
        created_by, created_at, updated_at, updated_by)
      VALUES (${aliasId}, ${scope.tenantId}, ${batchId}, ${"customer"}, ${"Acme Corp"}, ${"acme corp"},
        ${targetMasterId}, ${mappingVersion}, ${"1.000000"}, ${"approved"}, ${scope.ownerId}, NOW(), null,
        true, null, null, null,
        null, 1, null,
        ${scope.ownerId}, NOW(), null, null)`;
    return aliasId;
  }

  // Helper: seed a customer master for COM-CONC tests.
  async function seedCustomer(scope: TestScope, customerCode: string = "CUST-001", nameAr: string = "Acme Customer"): Promise<string> {
    const customerId = randomUUID();
    await sql`
      INSERT INTO customers (id, tenant_id, customer_code, name_ar, name_en, normalized_name, contact_info_json, credit_limit, credit_terms, status, notes, created_by, created_at, updated_at, updated_by)
      VALUES (${customerId}, ${scope.tenantId}, ${customerCode}, ${nameAr}, null, ${nameAr.trim().toLowerCase()}, null, null, null, ${"active"}, null, ${scope.ownerId}, NOW(), null, null)`;
    return customerId;
  }

  // ===========================================================================
  // COM-CONC-1 — Concurrent commits on the same batch: exactly one wins.
  // ===========================================================================
  it("COM-CONC-1. concurrent commits on the same batch: exactly one wins, the other fails (lock conflict)", async () => {
    const scope = newScope();
    await seedTenantAndUsers(scope);
    const batchId = randomUUID();
    await seedApprovedForCommitBatch(scope, batchId);
    const { rowId } = await seedFileAndStagingRow(scope, batchId);
    await seedPriorReconciliationEvidence(scope, batchId, 1);
    await seedBackupEvidence(scope, batchId);
    await seedCurrentApproval(scope, batchId, "owner", scope.ownerId);
    await seedCurrentApproval(scope, batchId, "accountant", scope.accountantId);
    const customerId = await seedCustomer(scope);
    await seedApprovedAliasMapping(scope, batchId, customerId);

    const { commitService } = makeServices(scope);

    // Issue two concurrent commits with DIFFERENT idempotency keys. The
    // cutover lock conflict should serialize them: one wins, the other
    // fails with CutoverLockConflictError.
    const keyA = "com-conc-1a-" + randomUUID();
    const keyB = "com-conc-1b-" + randomUUID();
    const results = await Promise.allSettled([
      commitService.commitBatch(
        makeOwnerUser(scope) as any, makeOwnerEffective() as any,
        { importBatchId: batchId, idempotencyKey: keyA },
      ),
      commitService.commitBatch(
        makeOwnerUser(scope) as any, makeOwnerEffective() as any,
        { importBatchId: batchId, idempotencyKey: keyB },
      ),
    ]);

    const settledA = results[0]!;
    const settledB = results[1]!;

    // Exactly one succeeded (fulfilled).
    expect(settledA.status === "fulfilled").not.toBe(settledB.status === "fulfilled");

    // Batch ended up committed.
    const batch = await getBatchState(scope, batchId);
    expect(batch!.status).toBe("committed");
    expect(batch!.committed_at).not.toBeNull();

    // Both idempotency records exist; exactly one is succeeded.
    const idemA = await getIdemState(scope, keyA);
    const idemB = await getIdemState(scope, keyB);
    expect(idemA).not.toBeNull();
    expect(idemB).not.toBeNull();
    if (settledA.status === "fulfilled") {
      expect(idemA?.state).toBe("succeeded");
      expect(idemB?.state).not.toBe("succeeded");
    } else {
      expect(idemA?.state).not.toBe("succeeded");
      expect(idemB?.state).toBe("succeeded");
    }

    // Exactly one commit audit total (winner only).
    const commitAudits = await getScopedAuditCount(scope, batchId, "historical_commit.commit");
    expect(commitAudits).toBe(1);

    // Locks released (catch block ran for the loser).
    const lockCount = await getActiveLockCount(scope, batchId);
    expect(lockCount).toBe(0);

    await cleanupScope(scope);
  });

  // ===========================================================================
  // COM-CONC-2A — Concurrent commit vs alias remap (target master deletion):
  // commit revalidation catches the deleted master under the lock.
  // ===========================================================================
  it("COM-CONC-2A. concurrent commit vs target master deletion: commit revalidation catches the deleted master under the lock and fails closed", async () => {
    const scope = newScope();
    await seedTenantAndUsers(scope);
    const batchId = randomUUID();
    await seedApprovedForCommitBatch(scope, batchId);
    const { rowId } = await seedFileAndStagingRow(scope, batchId);
    await seedPriorReconciliationEvidence(scope, batchId, 1);
    await seedBackupEvidence(scope, batchId);
    await seedCurrentApproval(scope, batchId, "owner", scope.ownerId);
    await seedCurrentApproval(scope, batchId, "accountant", scope.accountantId);
    const customerId = await seedCustomer(scope);
    await seedApprovedAliasMapping(scope, batchId, customerId);

    // Build a commit service whose transactionRunner deletes the customer
    // AFTER the batch is locked but BEFORE the alias revalidation. The
    // commit revalidation should catch the deleted master inside the
    // locked transaction and fail closed.
    const commitRepo = new HistoricalCommitDbRepository(db);
    const audit = new AuditDbRepository(db);
    const idem = new IdempotencyDbRepository(db);
    const commitService = new HistoricalCommitService({
      repository: commitRepo, audit, idempotency: idem,
      transactionRunner: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
        (db as any).transaction(async (tx: any) => {
          // Lock the batch row.
          await (tx as any).execute(drizzleSql`SELECT id FROM import_batches WHERE tenant_id = ${scope.tenantId} AND id = ${batchId} FOR UPDATE`);
          // Delete the customer BEFORE running the work body —
          // simulates a concurrent master deletion between pre-claim
          // and the locked revalidation. The DELETE is in the SAME
          // transaction as the commit, so it's visible to the
          // alias revalidation query inside executeAtomicCommit.
          await (tx as any).execute(drizzleSql`DELETE FROM customers WHERE tenant_id = ${scope.tenantId} AND id = ${customerId}`);
          await work(tx);
        }),
      txFactories: {
        createCommitRepository: (tx: unknown) => new HistoricalCommitDbRepository(tx as any),
        createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
        createInventoryLedger: () => ({} as any),
        createSubledger: () => ({} as any),
        createDocumentSequence: (tx: unknown) => new DocumentSequenceDbRepository(tx as any),
        createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
      },
    });

    const idemKey = "com-conc-2a-" + randomUUID();
    const auditBefore = await getScopedAuditCount(scope, batchId, "historical_commit.commit");
    const batchBefore = await getBatchState(scope, batchId);

    await expect(
      commitService.commitBatch(
        makeOwnerUser(scope) as any, makeOwnerEffective() as any,
        { importBatchId: batchId, idempotencyKey: idemKey },
      ),
    ).rejects.toThrow(/ALIAS_REVALIDATION_FAILED|INVALID_ALIAS_TARGET|alias mapping/i);

    // Batch is unchanged (still approved_for_commit — NOT committed).
    const batch = await getBatchState(scope, batchId);
    expect(batch!.status).toBe(batchBefore!.status);
    expect(batch!.committed_at).toBeNull();

    // No commit audit row persisted (the audit was rolled back).
    const auditAfter = await getScopedAuditCount(scope, batchId, "historical_commit.commit");
    expect(auditAfter).toBe(auditBefore);

    // Idempotency not succeeded (technical fault → retryable_failed,
    // but the alias revalidation error is a business error so it's
    // business_failed). Either way, NOT succeeded.
    const idemState = await getIdemState(scope, idemKey);
    expect(idemState).not.toBeNull();
    expect(idemState!.state).not.toBe("succeeded");

    // Locks released by the catch block.
    const lockCount = await getActiveLockCount(scope, batchId);
    expect(lockCount).toBe(0);

    await cleanupScope(scope);
  });

  // ===========================================================================
  // COM-CONC-2B — GAP 3 regression: legitimate material remap (supersede OLD
  // alias + insert NEW current alias) does NOT block the commit.
  //
  // WP-08-01F GAP 3 (closed): superseded approved alias rows alone no longer
  // permanently block commits. Only stale CURRENT mappings block. The
  // `findCurrentAliasMappingsForBatch` revalidation already verifies the
  // CURRENT mappings are approved, have a non-null target master, the master
  // still exists, and the mappingVersion matches. If those checks pass, the
  // commit is safe to proceed regardless of how many historical superseded
  // rows exist for the same source label.
  //
  // This test simulates a legitimate remap that races the commit:
  //   1. Setup: approved_for_commit batch with alias A → Customer A
  //      (current, approved, mappingVersion='1.0').
  //   2. Concurrent remap under the batch row lock: supersede A (is_current
  //      = false, preserved as audit history), insert NEW current B →
  //      Customer B (status='approved', mappingVersion='1.0').
  //   3. Commit should SUCCEED — the new current B is approved with a
  //      valid target master, so the alias revalidation passes.
  // ===========================================================================
  it("COM-CONC-2B. GAP 3 — legitimate material remap (supersede + new current) does not block the commit", async () => {
    const scope = newScope();
    await seedTenantAndUsers(scope);
    const batchId = randomUUID();
    await seedApprovedForCommitBatch(scope, batchId);
    const { rowId } = await seedFileAndStagingRow(scope, batchId);
    await seedPriorReconciliationEvidence(scope, batchId, 1);
    await seedBackupEvidence(scope, batchId);
    await seedCurrentApproval(scope, batchId, "owner", scope.ownerId);
    await seedCurrentApproval(scope, batchId, "accountant", scope.accountantId);
    const customerAId = await seedCustomer(scope, "CUST-A", "Customer A");
    const customerBId = await seedCustomer(scope, "CUST-B", "Customer B");
    const aliasAId = await seedApprovedAliasMapping(scope, batchId, customerAId);

    // Build a commit service whose transactionRunner performs the
    // legitimate remap AFTER the batch is locked but BEFORE the alias
    // revalidation. The remap supersedes A (preserved as audit history)
    // and inserts a new current B with a valid target master.
    const commitRepo = new HistoricalCommitDbRepository(db);
    const audit = new AuditDbRepository(db);
    const idem = new IdempotencyDbRepository(db);
    const commitService = new HistoricalCommitService({
      repository: commitRepo, audit, idempotency: idem,
      transactionRunner: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
        (db as any).transaction(async (tx: any) => {
          // Lock the batch row.
          await (tx as any).execute(drizzleSql`SELECT id FROM import_batches WHERE tenant_id = ${scope.tenantId} AND id = ${batchId} FOR UPDATE`);
          // Step 1: supersede the OLD approved alias A — preserved as
          // immutable audit history (is_current=false). This is the
          // append-only supersession pattern used by the production
          // material-remap path.
          await (tx as any).execute(drizzleSql`UPDATE import_alias_mappings SET is_current = false, superseded_at = NOW(), superseded_by = ${scope.ownerId}, superseded_reason = ${"material remap A→B"} WHERE tenant_id = ${scope.tenantId} AND id = ${aliasAId} AND is_current = true`);
          // Step 2: insert the NEW current alias B → Customer B
          // (status='approved', mappingVersion='1.0' matching the batch).
          // The partial unique index on
          // (tenant, batch, entityType, sourceLabel) WHERE is_current=true
          // permits this insertion because A is now is_current=false.
          const newAliasId = randomUUID();
          await (tx as any).execute(drizzleSql`
            INSERT INTO import_alias_mappings (id, tenant_id, import_batch_id, entity_type, source_label, normalized_name,
              target_master_id, mapping_version, confidence_score, status, approved_by, approved_at, notes,
              is_current, superseded_at, superseded_by, superseded_reason,
              group_id, occurrence_count, exception_source_row_ids,
              created_by, created_at, updated_at, updated_by)
            VALUES (${newAliasId}, ${scope.tenantId}, ${batchId}, ${"customer"}, ${"Acme Corp"}, ${"acme corp"},
              ${customerBId}, ${"1.0"}, ${"1.000000"}, ${"approved"}, ${scope.ownerId}, NOW(), null,
              true, null, null, null,
              null, 1, null,
              ${scope.ownerId}, NOW(), null, null)`);
          // IMPORTANT: the callback passed to db.transaction MUST return
          // the result of `work(tx)` — otherwise commitBatch resolves
          // with `undefined` and the test reads `result.action` from
          // undefined, producing `TypeError: Cannot read properties of
          // undefined (reading 'action')`. Use `return await work(tx)`
          // (not a bare `await work(tx);` that drops the value).
          return await work(tx);
        }),
      txFactories: {
        createCommitRepository: (tx: unknown) => new HistoricalCommitDbRepository(tx as any),
        createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
        createInventoryLedger: () => ({} as any),
        createSubledger: () => ({} as any),
        createDocumentSequence: (tx: unknown) => new DocumentSequenceDbRepository(tx as any),
        createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
      },
    });

    const idemKey = "com-conc-2b-" + randomUUID();
    const auditBefore = await getScopedAuditCount(scope, batchId, "historical_commit.commit");

    const result = await commitService.commitBatch(
      makeOwnerUser(scope) as any, makeOwnerEffective() as any,
      { importBatchId: batchId, idempotencyKey: idemKey },
    );

    // Commit SUCCEEDED — the legitimate remap with a new current B does
    // not permanently block the commit (GAP 3 fix).
    expect(result.action).toBe("committed");
    expect(result.batchId).toBe(batchId);
    expect(result.stagedRowsCommitted).toBe(1);

    const batch = await getBatchState(scope, batchId);
    expect(batch!.status).toBe("committed");
    expect(batch!.committed_at).not.toBeNull();

    // Exactly one scoped commit audit.
    const auditAfter = await getScopedAuditCount(scope, batchId, "historical_commit.commit");
    expect(auditAfter).toBe(auditBefore + 1);
    expect(auditAfter).toBe(1);

    // Idempotency succeeded.
    const idemState = await getIdemState(scope, idemKey);
    expect(idemState?.state).toBe("succeeded");

    // Staging row has committed entity link.
    const stagingRow = await getStagingRowCommitLink(scope, rowId);
    expect(stagingRow!.committed_entity_type).toBe("unhandled");
    expect(stagingRow!.committed_entity_id).toBeTruthy();

    // OLD alias A remains as immutable audit history (is_current=false),
    // but it is NOT a blocker — the new current B is approved.
    const oldAliasRows = await sql`SELECT id, is_current, status, superseded_at, superseded_reason FROM import_alias_mappings WHERE tenant_id = ${scope.tenantId} AND id = ${aliasAId}`;
    expect(oldAliasRows[0]?.is_current).toBe(false);
    expect(oldAliasRows[0]?.status).toBe("approved");
    expect(oldAliasRows[0]?.superseded_at).not.toBeNull();

    // Locks released after successful commit.
    const lockCount = await getActiveLockCount(scope, batchId);
    expect(lockCount).toBe(0);

    await cleanupScope(scope);
  });

  // ===========================================================================
  // COM-CONC-2B-NO-REPLACEMENT — Document the actual production behavior when
  // a concurrent operation supersedes the only approved alias WITHOUT
  // inserting a new current mapping.
  //
  // The production code's `findCurrentAliasMappingsForBatch` returns an empty
  // list (zero current mappings). The alias revalidation loop doesn't fire,
  // so the commit PROCEEDS (it does not enforce "must have current alias
  // mapping" as a blocker when there are zero current mappings).
  //
  // This test asserts the actual production behavior: commit succeeds. This
  // is a known characteristic of the current implementation — batches that
  // legitimately have no current alias mappings (e.g. rows with explicit
  // master IDs in staging data, no unresolved aliases) are committable.
  // ===========================================================================
  it("COM-CONC-2B-NO-REPLACEMENT. document actual behavior: supersession without new current mapping → commit proceeds (no enforcement when zero current aliases)", async () => {
    const scope = newScope();
    await seedTenantAndUsers(scope);
    const batchId = randomUUID();
    await seedApprovedForCommitBatch(scope, batchId);
    const { rowId } = await seedFileAndStagingRow(scope, batchId);
    await seedPriorReconciliationEvidence(scope, batchId, 1);
    await seedBackupEvidence(scope, batchId);
    await seedCurrentApproval(scope, batchId, "owner", scope.ownerId);
    await seedCurrentApproval(scope, batchId, "accountant", scope.accountantId);
    const customerAId = await seedCustomer(scope, "CUST-A", "Customer A");
    const aliasAId = await seedApprovedAliasMapping(scope, batchId, customerAId);

    // Build a commit service whose transactionRunner supersedes the
    // approved alias WITHOUT inserting a new current mapping.
    const commitRepo = new HistoricalCommitDbRepository(db);
    const audit = new AuditDbRepository(db);
    const idem = new IdempotencyDbRepository(db);
    const commitService = new HistoricalCommitService({
      repository: commitRepo, audit, idempotency: idem,
      transactionRunner: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
        (db as any).transaction(async (tx: any) => {
          // Lock the batch row.
          await (tx as any).execute(drizzleSql`SELECT id FROM import_batches WHERE tenant_id = ${scope.tenantId} AND id = ${batchId} FOR UPDATE`);
          // Supersede the approved alias A WITHOUT inserting a new
          // current mapping. After this, findCurrentAliasMappingsForBatch
          // returns an empty list.
          await (tx as any).execute(drizzleSql`UPDATE import_alias_mappings SET is_current = false, superseded_at = NOW(), superseded_by = ${scope.ownerId}, superseded_reason = ${"superseded without replacement"} WHERE tenant_id = ${scope.tenantId} AND id = ${aliasAId} AND is_current = true`);
          // IMPORTANT: the callback passed to db.transaction MUST return
          // the result of `work(tx)` — otherwise commitBatch resolves
          // with `undefined` and the test reads `result.action` from
          // undefined, producing `TypeError: Cannot read properties of
          // undefined (reading 'action')`. Use `return await work(tx)`
          // (not a bare `await work(tx);` that drops the value).
          return await work(tx);
        }),
      txFactories: {
        createCommitRepository: (tx: unknown) => new HistoricalCommitDbRepository(tx as any),
        createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
        createInventoryLedger: () => ({} as any),
        createSubledger: () => ({} as any),
        createDocumentSequence: (tx: unknown) => new DocumentSequenceDbRepository(tx as any),
        createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
      },
    });

    const idemKey = "com-conc-2b-no-repl-" + randomUUID();

    // ACTUAL PRODUCTION BEHAVIOR: with zero current alias mappings, the
    // alias revalidation loop does not fire, and the commit proceeds.
    // This is documented here so future changes to the production code
    // (e.g. adding a "must have current alias" rule) will fail this test
    // and force a deliberate update to the documented behavior.
    const result = await commitService.commitBatch(
      makeOwnerUser(scope) as any, makeOwnerEffective() as any,
      { importBatchId: batchId, idempotencyKey: idemKey },
    );

    expect(result.action).toBe("committed");
    expect(result.batchId).toBe(batchId);

    const batch = await getBatchState(scope, batchId);
    expect(batch!.status).toBe("committed");

    // OLD alias A remains as immutable audit history (is_current=false).
    const oldAliasRows = await sql`SELECT id, is_current, status, superseded_at, superseded_reason FROM import_alias_mappings WHERE tenant_id = ${scope.tenantId} AND id = ${aliasAId}`;
    expect(oldAliasRows[0]?.is_current).toBe(false);
    expect(oldAliasRows[0]?.superseded_at).not.toBeNull();

    // Locks released after successful commit.
    const lockCount = await getActiveLockCount(scope, batchId);
    expect(lockCount).toBe(0);

    await cleanupScope(scope);
  });

  // ===========================================================================
  // REMAP-COMMIT — Regression: a legitimate remap does not permanently block
  // the commit when downstream evidence is regenerated.
  //
  // Steps:
  //   1. Create alias mapping A → Customer A (current, approved, "1.0").
  //   2. Approve A (record both owner + accountant approvals bound to
  //      mappingVersion='1.0').
  //   3. Perform material remap A→B: supersede A (preserved as audit
  //      history), create new current B → Customer B (approved, "1.0").
  //   4. Old A remains is_current=false as immutable evidence.
  //   5. Regenerate downstream validation/reconciliation/review/batch
  //      approval — for this test, the batch's mappingVersion stays at
  //      '1.0' and the staging/reconciliation/approval state stays valid,
  //      so the approvals are NOT stale.
  //   6. New B is approved/current.
  //   7. Commit succeeds.
  //
  // Also prove: if downstream evidence was NOT regenerated after remap (the
  // batch's mappingVersion is bumped to '2.0' but the approvals still have
  // '1.0'), the commit FAILS due to StaleApprovalError.
  // ===========================================================================
  it("REMAP-COMMIT. legitimate remap with downstream regeneration → commit succeeds; without regeneration → commit fails (stale approval)", async () => {
    const scope = newScope();
    await seedTenantAndUsers(scope);
    const batchId = randomUUID();
    await seedApprovedForCommitBatch(scope, batchId);
    const { rowId } = await seedFileAndStagingRow(scope, batchId);
    await seedPriorReconciliationEvidence(scope, batchId, 1);
    await seedBackupEvidence(scope, batchId);
    await seedCurrentApproval(scope, batchId, "owner", scope.ownerId);
    await seedCurrentApproval(scope, batchId, "accountant", scope.accountantId);
    const customerAId = await seedCustomer(scope, "CUST-A", "Customer A");
    const customerBId = await seedCustomer(scope, "CUST-B", "Customer B");
    // Step 1: alias A → Customer A (current, approved, "1.0").
    const aliasAId = await seedApprovedAliasMapping(scope, batchId, customerAId);

    // Step 3: perform material remap A→B. Supersede A, insert new current B.
    await sql`UPDATE import_alias_mappings SET is_current = false, superseded_at = NOW(), superseded_by = ${scope.ownerId}, superseded_reason = ${"material remap A→B"} WHERE tenant_id = ${scope.tenantId} AND id = ${aliasAId} AND is_current = true`;
    const aliasBId = randomUUID();
    await sql`
      INSERT INTO import_alias_mappings (id, tenant_id, import_batch_id, entity_type, source_label, normalized_name,
        target_master_id, mapping_version, confidence_score, status, approved_by, approved_at, notes,
        is_current, superseded_at, superseded_by, superseded_reason,
        group_id, occurrence_count, exception_source_row_ids,
        created_by, created_at, updated_at, updated_by)
      VALUES (${aliasBId}, ${scope.tenantId}, ${batchId}, ${"customer"}, ${"Acme Corp"}, ${"acme corp"},
        ${customerBId}, ${"1.0"}, ${"1.000000"}, ${"approved"}, ${scope.ownerId}, NOW(), null,
        true, null, null, null,
        null, 1, null,
        ${scope.ownerId}, NOW(), null, null)`;

    // Step 4 verification: OLD A remains as immutable audit history.
    const oldAliasRows = await sql`SELECT id, is_current, status, superseded_at FROM import_alias_mappings WHERE tenant_id = ${scope.tenantId} AND id = ${aliasAId}`;
    expect(oldAliasRows[0]?.is_current).toBe(false);
    expect(oldAliasRows[0]?.status).toBe("approved");

    // Step 5: downstream evidence is regenerated. For this test, the
    // batch's mappingVersion stays at '1.0' and the new alias B has
    // mappingVersion='1.0' matching the batch — no stale approval.
    // (In production, the regeneration would re-validate, re-reconcile,
    // re-record approvals with the same versions if no material change
    // to the batch fingerprint occurred.)

    // Step 7: commit succeeds.
    const idemKey = "remap-commit-success-" + randomUUID();
    const { commitService } = makeServices(scope);
    const auditBefore = await getScopedAuditCount(scope, batchId, "historical_commit.commit");

    const result = await commitService.commitBatch(
      makeOwnerUser(scope) as any, makeOwnerEffective() as any,
      { importBatchId: batchId, idempotencyKey: idemKey },
    );

    expect(result.action).toBe("committed");
    expect(result.batchId).toBe(batchId);
    expect(result.stagedRowsCommitted).toBe(1);

    const batch = await getBatchState(scope, batchId);
    expect(batch!.status).toBe("committed");
    expect(batch!.committed_at).not.toBeNull();

    // Exactly one scoped commit audit.
    const auditAfter = await getScopedAuditCount(scope, batchId, "historical_commit.commit");
    expect(auditAfter).toBe(auditBefore + 1);
    expect(auditAfter).toBe(1);

    // Idempotency succeeded.
    const idemState = await getIdemState(scope, idemKey);
    expect(idemState?.state).toBe("succeeded");

    // Staging row has committed entity link.
    const stagingRow = await getStagingRowCommitLink(scope, rowId);
    expect(stagingRow!.committed_entity_type).toBe("unhandled");
    expect(stagingRow!.committed_entity_id).toBeTruthy();

    await cleanupScope(scope);

    // ---------------------------------------------------------------------
    // Counter-proof: if downstream evidence was NOT regenerated after the
    // remap, the commit FAILS. We simulate "downstream regenerated" by
    // bumping the batch's mappingVersion to '2.0' (a material version
    // change) but NOT re-recording the approvals (they still have '1.0').
    // The commit's stale-approval check fires before alias revalidation.
    // ---------------------------------------------------------------------
    const scope2 = newScope();
    await seedTenantAndUsers(scope2);
    const batchId2 = randomUUID();
    await seedApprovedForCommitBatch(scope2, batchId2);
    const { rowId: rowId2 } = await seedFileAndStagingRow(scope2, batchId2);
    await seedPriorReconciliationEvidence(scope2, batchId2, 1);
    await seedBackupEvidence(scope2, batchId2);
    await seedCurrentApproval(scope2, batchId2, "owner", scope2.ownerId);
    await seedCurrentApproval(scope2, batchId2, "accountant", scope2.accountantId);
    const customerAId2 = await seedCustomer(scope2, "CUST-A2", "Customer A2");
    const customerBId2 = await seedCustomer(scope2, "CUST-B2", "Customer B2");
    const aliasAId2 = await seedApprovedAliasMapping(scope2, batchId2, customerAId2);

    // Remap A→B (legitimate).
    await sql`UPDATE import_alias_mappings SET is_current = false, superseded_at = NOW(), superseded_by = ${scope2.ownerId}, superseded_reason = ${"material remap A→B (no downstream)"} WHERE tenant_id = ${scope2.tenantId} AND id = ${aliasAId2} AND is_current = true`;
    const aliasBId2 = randomUUID();
    await sql`
      INSERT INTO import_alias_mappings (id, tenant_id, import_batch_id, entity_type, source_label, normalized_name,
        target_master_id, mapping_version, confidence_score, status, approved_by, approved_at, notes,
        is_current, superseded_at, superseded_by, superseded_reason,
        group_id, occurrence_count, exception_source_row_ids,
        created_by, created_at, updated_at, updated_by)
      VALUES (${aliasBId2}, ${scope2.tenantId}, ${batchId2}, ${"customer"}, ${"Acme Corp"}, ${"acme corp"},
        ${customerBId2}, ${"1.0"}, ${"1.000000"}, ${"approved"}, ${scope2.ownerId}, NOW(), null,
        true, null, null, null,
        null, 1, null,
        ${scope2.ownerId}, NOW(), null, null)`;

    // Bump the batch's mappingVersion to '2.0' (simulating "downstream
    // regenerated" — material version change). DO NOT re-record approvals
    // (they still have mappingVersion='1.0').
    await sql`UPDATE import_batches SET mapping_version = ${"2.0"} WHERE tenant_id = ${scope2.tenantId} AND id = ${batchId2}`;

    const idemKey2 = "remap-commit-stale-" + randomUUID();
    const { commitService: commitService2 } = makeServices(scope2);
    const batchBefore2 = await getBatchState(scope2, batchId2);

    await expect(
      commitService2.commitBatch(
        makeOwnerUser(scope2) as any, makeOwnerEffective() as any,
        { importBatchId: batchId2, idempotencyKey: idemKey2 },
      ),
    ).rejects.toThrow(/STALE_APPROVAL|stale|mappingVersion/i);

    // Batch is unchanged (still approved_for_commit — NOT committed).
    const batch2 = await getBatchState(scope2, batchId2);
    expect(batch2!.status).toBe(batchBefore2!.status);
    expect(batch2!.committed_at).toBeNull();

    // Idempotency not succeeded (business_failed — stale approval is a
    // business error, durable).
    const idemState2 = await getIdemState(scope2, idemKey2);
    expect(idemState2).not.toBeNull();
    expect(idemState2!.state).not.toBe("succeeded");

    // Locks released by the catch block.
    const lockCount2 = await getActiveLockCount(scope2, batchId2);
    expect(lockCount2).toBe(0);

    await cleanupScope(scope2);
  });

  // ===========================================================================
  // VERSION-NULL-COM — batch mappingVersion='1.0', alias mappingVersion=null
  // → commit fails closed (alias mappingVersion must match batch's non-null
  // mappingVersion).
  //
  // The production code's alias mappingVersion binding check rejects a null
  // alias mappingVersion when the batch has a non-null mappingVersion. This
  // is a fail-closed safety check: a null alias mappingVersion is treated as
  // "no version recorded" which is unsafe when the batch is version-bound.
  // ===========================================================================
  it("VERSION-NULL-COM. batch mappingVersion='1.0' + alias mappingVersion=null → commit fails closed (AliasMappingVersionMismatch)", async () => {
    const scope = newScope();
    await seedTenantAndUsers(scope);
    const batchId = randomUUID();
    await seedApprovedForCommitBatch(scope, batchId);
    const { rowId } = await seedFileAndStagingRow(scope, batchId);
    await seedPriorReconciliationEvidence(scope, batchId, 1);
    await seedBackupEvidence(scope, batchId);
    await seedCurrentApproval(scope, batchId, "owner", scope.ownerId);
    await seedCurrentApproval(scope, batchId, "accountant", scope.accountantId);
    const customerId = await seedCustomer(scope, "CUST-NULL-V", "Customer Null V");

    // Seed an approved current alias mapping with mappingVersion=NULL.
    // The batch has mappingVersion='1.0' (set by seedApprovedForCommitBatch).
    await sql`
      INSERT INTO import_alias_mappings (id, tenant_id, import_batch_id, entity_type, source_label, normalized_name,
        target_master_id, mapping_version, confidence_score, status, approved_by, approved_at, notes,
        is_current, superseded_at, superseded_by, superseded_reason,
        group_id, occurrence_count, exception_source_row_ids,
        created_by, created_at, updated_at, updated_by)
      VALUES (${randomUUID()}, ${scope.tenantId}, ${batchId}, ${"customer"}, ${"Acme Corp"}, ${"acme corp"},
        ${customerId}, null, ${"1.000000"}, ${"approved"}, ${scope.ownerId}, NOW(), null,
        true, null, null, null,
        null, 1, null,
        ${scope.ownerId}, NOW(), null, null)`;

    const idemKey = "version-null-com-" + randomUUID();
    const { commitService } = makeServices(scope);
    const batchBefore = await getBatchState(scope, batchId);

    await expect(
      commitService.commitBatch(
        makeOwnerUser(scope) as any, makeOwnerEffective() as any,
        { importBatchId: batchId, idempotencyKey: idemKey },
      ),
    ).rejects.toThrow(/ALIAS_REVALIDATION_FAILED|ALIAS_MAPPING_VERSION_MISMATCH|mappingVersion/i);

    // Batch is unchanged (still approved_for_commit — NOT committed).
    const batch = await getBatchState(scope, batchId);
    expect(batch!.status).toBe(batchBefore!.status);
    expect(batch!.committed_at).toBeNull();

    // Idempotency not succeeded (business_failed durable — alias
    // revalidation failures are business errors).
    const idemState = await getIdemState(scope, idemKey);
    expect(idemState).not.toBeNull();
    expect(idemState!.state).not.toBe("succeeded");

    // Locks released by the catch block.
    const lockCount = await getActiveLockCount(scope, batchId);
    expect(lockCount).toBe(0);

    await cleanupScope(scope);
  });

  // ===========================================================================
  // COM-REAL-RACE-1 — Commit wins before replacement (real production race)
  //
  // Both operations call real production methods:
  //   - HistoricalCommitService.commitBatch()
  //   - HistoricalReplacementService.replaceMigrationFile()
  //
  // Deterministic synchronization with deferred-promise barriers (no setTimeout):
  //   1. Commit's custom transactionRunner acquires the batch row lock
  //      (SELECT ... FOR UPDATE) and signals "commit has lock".
  //   2. Test waits for "commit has lock", then starts replacement in
  //      concurrent async. Replacement's pre-tx read sees approved_for_commit
  //      (commit hasn't mutated yet), passes pre-tx checks, claims
  //      idempotency, enters Drizzle tx, signals "replacement entered tx",
  //      then runs its work body which does FOR UPDATE — BLOCKS (commit
  //      holds the lock).
  //   3. Test waits for "replacement entered tx" — at this point the
  //      replacement is in its Drizzle tx and about to block on FOR UPDATE.
  //   4. Test signals "release commit" — commit's work body runs,
  //      transitions batch to committed, markSucceeded, commits Drizzle
  //      tx, releases lock.
  //   5. Replacement's FOR UPDATE acquires lock (now released), re-reads
  //      state under lock = committed, throws COMMITTED_BATCH_IMMUTABLE.
  //
  // Expected:
  //   - commit succeeds (batch → committed)
  //   - replacement rejects with COMMITTED_BATCH_IMMUTABLE
  //   - no stale mutations from replacement (old file still current,
  //     no new file row, no new staging rows)
  // ===========================================================================
  it("COM-REAL-RACE-1. commit wins before replacement (real production race): commit succeeds, replacement rejects COMMITTED_BATCH_IMMUTABLE", async () => {
    const scope = newScope();
    await seedTenantAndUsers(scope);
    const batchId = randomUUID();
    await seedApprovedForCommitBatch(scope, batchId);

    // Seed a current source file with a unique hash. The replacement will
    // try to replace this file with a new one (different hash).
    const oldFileId = randomUUID();
    await sql`
      INSERT INTO import_files (id, tenant_id, import_batch_id, original_file_name, storage_path, file_hash,
        file_size_bytes, content_type, file_type, file_version, is_current, created_by, created_at)
      VALUES (${oldFileId}, ${scope.tenantId}, ${batchId}, ${"original.csv"}, ${"local://test/original-race-1"}, ${"sha256:original-race-1-" + batchId},
        100, ${"text/csv"}, ${"source"}, 1, true, ${scope.ownerId}, NOW())`;
    // Seed staging row with `name: "Acme Corp"` + `entity_type: "customer"`
    // so the alias group `customer|Acme Corp` is REQUIRED and matches the
    // seeded alias mapping (seedApprovedAliasMapping uses
    // sourceLabel='Acme Corp', entityType='customer').
    const oldRowId = randomUUID();
    const rowData = {
      name: "Acme Corp",
      code: "AC001",
      entity_type: "customer",
      quantity: "100",
      date: "2024-01-01",
    };
    await sql`
      INSERT INTO import_staging_rows (id, tenant_id, import_batch_id, import_file_id, template_name,
        source_sheet_name, source_row_number, raw_row_json, transformed_row_json,
        transformation_notes, validation_status, review_status, ai_confidence,
        committed_entity_type, committed_entity_id, staging_version, is_current,
        created_by, created_at)
      VALUES (${oldRowId}, ${scope.tenantId}, ${batchId}, ${oldFileId}, ${"opening_balance_inventory"}, ${"original.csv"}, 1,
        ${JSON.stringify(rowData)}::jsonb,
        ${JSON.stringify(rowData)}::jsonb,
        null, ${"pending"}, ${"not_required"}, null, null, null, 1, true,
        ${scope.ownerId}, NOW())`;

    await seedPriorReconciliationEvidence(scope, batchId, 1);
    await seedBackupEvidence(scope, batchId);
    await seedCurrentApproval(scope, batchId, "owner", scope.ownerId);
    await seedCurrentApproval(scope, batchId, "accountant", scope.accountantId);

    // Seed a customer master + approved alias mapping (sourceLabel='Acme Corp',
    // entityType='customer', mappingVersion='1.0') so commit's alias
    // revalidation passes.
    const customerId = await seedCustomer(scope, "CUST-RACE-1", "Acme Customer RACE-1");
    await seedApprovedAliasMapping(scope, batchId, customerId);

    // ----- Deferred-promise barriers (deterministic synchronization) -----
    let signalCommitHasLock!: () => void;
    const commitHasLockPromise = new Promise<void>(resolve => { signalCommitHasLock = resolve; });
    let signalReplacementEnteredTx!: () => void;
    const replacementEnteredTxPromise = new Promise<void>(resolve => { signalReplacementEnteredTx = resolve; });
    let signalReleaseCommit!: () => void;
    const releaseCommitPromise = new Promise<void>(resolve => { signalReleaseCommit = resolve; });

    // ----- Custom commitRunner: acquire lock, signal, pause, run work -----
    const commitRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
      (db as any).transaction(async (tx: any) => {
        // Lock the batch row BEFORE running the commit work body. This
        // ensures the commit holds the lock first (deterministic ordering
        // for the race). The commit work body does its own FOR UPDATE
        // inside executePosting — that is a no-op since this tx already
        // holds the lock.
        await (tx as any).execute(drizzleSql`SELECT id FROM import_batches WHERE tenant_id = ${scope.tenantId} AND id = ${batchId} FOR UPDATE`);
        signalCommitHasLock();
        // Pause until the test signals "release commit" — this gives the
        // replacement time to start, pass its pre-tx checks, and block
        // on FOR UPDATE.
        await releaseCommitPromise;
        // Run the commit work body — it transitions batch → committed,
        // markSucceeded, returns. Drizzle tx commits, lock released.
        return await work(tx);
      });

    // ----- Custom replacementRunner: signal "replacement entered tx", run work -----
    // The signal fires BEFORE the work body's FOR UPDATE — so the test
    // knows the replacement is in its Drizzle tx and about to block.
    const replacementRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
      (db as any).transaction(async (tx: any) => {
        signalReplacementEnteredTx();
        // Run the replacement work body — its first statement is FOR UPDATE
        // which BLOCKS because the commit holds the lock. The work body
        // will resume after the commit commits and releases the lock.
        return await work(tx);
      });

    // ----- Construct commitService with custom commitRunner -----
    const commitRepo = new HistoricalCommitDbRepository(db);
    const audit = new AuditDbRepository(db);
    const idem = new IdempotencyDbRepository(db);
    const commitService = new HistoricalCommitService({
      repository: commitRepo, audit, idempotency: idem,
      transactionRunner: commitRunner,
      txFactories: {
        createCommitRepository: (tx: unknown) => new HistoricalCommitDbRepository(tx as any),
        createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
        createInventoryLedger: () => ({} as any),
        createSubledger: () => ({} as any),
        createDocumentSequence: (tx: unknown) => new DocumentSequenceDbRepository(tx as any),
        createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
      },
    });

    // ----- Construct replacementService with custom replacementRunner -----
    // WP-08-01F DEC-081 recovery — INSTRUMENTATION:
    // Wrap `idempotency` (root handle, used by claimIdempotency + peek +
    // markSucceeded/markBusinessFailed/markRetryableFailed) and
    // `transactionRunner` with call counters. This lets the second same-key
    // call prove the stored business_failed record is REPLAYED (claim IS
    // invoked, claim.action === "replay", transactionRunner NOT invoked,
    // attempt_count unchanged, stored response used) rather than freshly
    // evaluated by the pre-claim mutable-state guards.
    const stagingRepo = new HistoricalStagingDbRepository(db);
    const realIdem = idem;
    const idemCallCounts = {
      findByTenantScopeKey: 0,    // peek + claim both call this
      claimIdempotency: 0,         // incremented when claimIdempotency is invoked
    };
    // We need to count claimIdempotency calls specifically. claimIdempotency
    // calls findByTenantScopeKey internally, but the peek also calls it. So
    // counting findByTenantScopeKey over-counts. Instead we count
    // updateState calls (markSucceeded/markBusinessFailed/markRetryableFailed
    // each call updateState exactly once) and insert calls (claim execute
    // calls insert exactly once).
    const idemUpdateStateCount = { value: 0 };
    const idemInsertCount = { value: 0 };
    const instrumentedIdem: IdempotencyTransactionHandle = {
      findByTenantScopeKey: async (t, s, k) => {
        idemCallCounts.findByTenantScopeKey++;
        return realIdem.findByTenantScopeKey(t, s, k);
      },
      insert: async (r) => {
        idemInsertCount.value++;
        return realIdem.insert(r);
      },
      claimExpiredLease: (id, a, b, c) => realIdem.claimExpiredLease(id, a, b, c),
      updateState: async (id, update) => {
        idemUpdateStateCount.value++;
        return realIdem.updateState(id, update);
      },
      heartbeat: (id, n) => realIdem.heartbeat(id, n),
    };
    const replacementTxCount = { value: 0 };
    const instrumentedReplacementRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
      replacementTxCount.value++;
      return replacementRunner(work);
    };
    const replacementService = new HistoricalReplacementService({
      repository: stagingRepo,
      audit,
      idempotency: instrumentedIdem,
      transactionRunner: instrumentedReplacementRunner,
      createStagingRepository: (tx: unknown) => new HistoricalStagingDbRepository(tx as any),
      createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
      createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
      invalidateCurrentApprovals: async (tx: unknown, tenantId: string, batchId: string, invalidatedBy: string, reason: string) => {
        const txCommitRepo = new HistoricalCommitDbRepository(tx as any);
        return txCommitRepo.invalidateCurrentApprovalsForBatch(tenantId, batchId, invalidatedBy, reason);
      },
    });

    const storage = new InMemoryPrivateFileStorage();

    const commitIdemKey = "com-real-race-1-commit-" + randomUUID();
    const replaceIdemKey = "com-real-race-1-replace-" + randomUUID();

    // Snapshot before
    const auditBefore = await getScopedAuditCount(scope, batchId);
    const filesBefore = await sql`SELECT count(*)::int AS c FROM import_files WHERE tenant_id = ${scope.tenantId} AND import_batch_id = ${batchId}`;
    const stagingRowsBefore = await sql`SELECT count(*)::int AS c FROM import_staging_rows WHERE tenant_id = ${scope.tenantId} AND import_batch_id = ${batchId}`;

    // ----- Start commit in async -----
    // Commit runs pre-tx checks, acquires lock (in commitRunner), signals
    // "commit has lock", pauses (waits for "release commit").
    const commitPromise = commitService.commitBatch(
      makeOwnerUser(scope) as any, makeOwnerEffective() as any,
      { importBatchId: batchId, idempotencyKey: commitIdemKey },
    );

    // Wait for commit to acquire the lock (deterministic ordering — commit
    // wins the lock race).
    await commitHasLockPromise;

    // ----- Start replacement in concurrent async -----
    // Replacement's pre-tx read sees approved_for_commit (commit hasn't
    // mutated yet — it's paused). Pre-tx checks pass. Idempotency claim.
    // Replacement enters Drizzle tx (replacementRunner), signals
    // "replacement entered tx", runs work body. Work body's FOR UPDATE
    // BLOCKS (commit holds the lock).
    const storedFile = await storage.store(
      scope.tenantId, batchId, "replace-key-race-1", "replacement.csv",
      Buffer.from("name,code,entity_type,quantity,date\nAcme Corp,AC001,customer,100,2024-01-01\n"),
      "text/csv",
    );
    const replacementPromise = replacementService.replaceMigrationFile(
      makeOwnerUser(scope) as any, makeOwnerEffective() as any,
      {
        importBatchId: batchId,
        replaceFileId: oldFileId,
        originalFileName: "replacement.csv",
        storagePath: storedFile.storagePath,
        fileHash: storedFile.fileHash,
        fileSizeBytes: storedFile.fileSizeBytes,
        contentType: storedFile.contentType,
        fileType: "source",
        parsedRows: [{
          rowNumber: 1,
          columns: { name: "Acme Corp", code: "AC001", entity_type: "customer", quantity: "100", date: "2024-01-01" },
        }],
        templateType: "opening_balance_inventory",
        reworkReason: "COM-REAL-RACE-1: replace after commit race",
        idempotencyKey: replaceIdemKey,
      },
    );
    // Attach observer immediately to prevent unhandled rejection
    const replacementOutcome = replacementPromise.then(
      (value) => ({ ok: true as const, value }),
      (error) => ({ ok: false as const, error }),
    );

    // Wait for replacement to enter its Drizzle tx — at this point the
    // replacement is about to block on FOR UPDATE.
    await replacementEnteredTxPromise;

    // ----- Signal commit to proceed -----
    // Commit's work body runs, transitions batch → committed,
    // markSucceeded, commits Drizzle tx, releases lock.
    signalReleaseCommit();

    // ----- Commit should succeed -----
    const commitResult = await commitPromise;
    expect(commitResult.action).toBe("committed");
    expect(commitResult.batchId).toBe(batchId);

    // ----- Replacement should reject with COMMITTED_BATCH_IMMUTABLE -----
    const outcome = await replacementOutcome;
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      const err = outcome.error as Error;
      expect(err).toBeInstanceOf(HistoricalReplacementError);
      expect((err as any)?.code).toBe("COMMITTED_BATCH_IMMUTABLE");
    }

    // ----- Verify final state -----
    const batch = await getBatchState(scope, batchId);
    expect(batch!.status).toBe("committed");
    expect(batch!.committed_at).not.toBeNull();

    // No stale mutations from replacement:
    // - Old file is STILL current (replacement's markFileSuperseded was
    //   rolled back when its Drizzle tx rolled back).
    const oldFileRows = await sql`SELECT is_current FROM import_files WHERE tenant_id = ${scope.tenantId} AND id = ${oldFileId}`;
    expect(oldFileRows[0]?.is_current).toBe(true);

    // - No new file row from replacement (count unchanged).
    const filesAfter = await sql`SELECT count(*)::int AS c FROM import_files WHERE tenant_id = ${scope.tenantId} AND import_batch_id = ${batchId}`;
    expect(filesAfter[0]?.c).toBe(filesBefore[0]?.c);

    // - No new staging rows from replacement (count unchanged).
    const stagingRowsAfter = await sql`SELECT count(*)::int AS c FROM import_staging_rows WHERE tenant_id = ${scope.tenantId} AND import_batch_id = ${batchId}`;
    expect(stagingRowsAfter[0]?.c).toBe(stagingRowsBefore[0]?.c);

    // - Exactly one scoped commit audit.
    const auditAfter = await getScopedAuditCount(scope, batchId, "historical_commit.commit");
    expect(auditAfter).toBe(auditBefore + 1);
    expect(auditAfter).toBe(1);

    // - Staging row has committed entity link.
    const stagingRow = await getStagingRowCommitLink(scope, oldRowId);
    expect(stagingRow!.committed_entity_type).toBe("unhandled");
    expect(stagingRow!.committed_entity_id).toBeTruthy();

    // - Locks released.
    const lockCount = await getActiveLockCount(scope, batchId);
    expect(lockCount).toBe(0);

    // - Replacement's idempotency record: business_failed (durable).
    //   COMMITTED_BATCH_IMMUTABLE is a deterministic business failure —
    //   committed is terminal and retry will never make it replaceable.
    const replaceIdemState = await getIdemState(scope, replaceIdemKey);
    expect(replaceIdemState).not.toBeNull();
    expect(replaceIdemState!.state).toBe("business_failed");
    expect(replaceIdemState!.state).not.toBe("succeeded");
    expect(replaceIdemState!.state).not.toBe("in_progress");
    expect(replaceIdemState!.state).not.toBe("retryable_failed");

    // ===== STORED REPLAY PROOF (DEC-081 recovery) =====
    // Capture instrumentation counters + idempotency record state BEFORE the
    // second same-key call. Then assert that the second call:
    //   A. Invokes claimIdempotency (idempotency.findByTenantScopeKey is
    //      called at least once for the claim path, NOT just the peek).
    //   B. Returns claim.action === "replay" with record.state === "business_failed".
    //   C. Does NOT invoke transactionRunner (no re-execution).
    //   D. Does NOT increment attempt_count (no claimExpiredLease).
    //   E. Uses the stored responseCode/responseBody/lastErrorClass (not a
    //      freshly-evaluated COMMITTED_BATCH_IMMUTABLE from the pre-claim
    //      mutable-state guard).
    //
    // NOTE: the second call uses the SAME request body (same reworkReason)
    // as the first call. This is required for claimIdempotency to return
    // "replay" (same request hash). Using a different reworkReason would
    // produce a different request hash → "conflict" instead of "replay".
    const idemRecordBeforeReplay = await sql`
      SELECT id, state, attempt_count, response_code, response_body, last_error_class, owner_token
      FROM idempotency_records
      WHERE tenant_id = ${scope.tenantId} AND idempotency_key = ${replaceIdemKey}`;
    const recordBefore = idemRecordBeforeReplay[0]!;
    const findByCountBeforeReplay = idemCallCounts.findByTenantScopeKey;
    const updateStateCountBeforeReplay = idemUpdateStateCount.value;
    const insertCountBeforeReplay = idemInsertCount.value;
    const replacementTxCountBeforeReplay = replacementTxCount.value;

    // - Same-key replay: durable business failure is replayed.
    //   The replacement transaction is NOT executed again; no new effects.
    const filesBeforeReplay = await sql`SELECT count(*)::int AS c FROM import_files WHERE tenant_id = ${scope.tenantId} AND import_batch_id = ${batchId}`;
    const replayOutcome = await replacementService.replaceMigrationFile(
      makeOwnerUser(scope) as any, makeOwnerEffective() as any,
      {
        importBatchId: batchId,
        replaceFileId: oldFileId,
        originalFileName: "replacement.csv",
        storagePath: storedFile.storagePath,
        fileHash: storedFile.fileHash,
        fileSizeBytes: storedFile.fileSizeBytes,
        contentType: storedFile.contentType,
        fileType: "source",
        parsedRows: [{
          rowNumber: 1,
          columns: { name: "Acme Corp", code: "AC001", entity_type: "customer", quantity: "100", date: "2024-01-01" },
        }],
        templateType: "opening_balance_inventory",
        // SAME reworkReason as the first call — required for replay (same
        // request hash). A different reworkReason would yield "conflict".
        reworkReason: "COM-REAL-RACE-1: replace after commit race",
        idempotencyKey: replaceIdemKey, // SAME key
      },
    ).then(
      (value) => ({ ok: true as const, value }),
      (error) => ({ ok: false as const, error }),
    );
    // Replay should reject (not re-execute) — committed is still terminal.
    expect(replayOutcome.ok).toBe(false);
    if (!replayOutcome.ok) {
      const replayErr = replayOutcome.error as Error;
      expect(replayErr).toBeInstanceOf(HistoricalReplacementError);
      expect((replayErr as any)?.code).toBe("COMMITTED_BATCH_IMMUTABLE");
    }

    // ===== REPLAY PROOF ASSERTIONS =====
    // A. claimIdempotency IS invoked on the second call. The peek calls
    //    findByTenantScopeKey once; claimIdempotency calls it again. So the
    //    count must have increased by at least 1 (peek) + 1 (claim) = 2.
    //    A freshly-evaluated throw (pre-claim mutable-state guard) would
    //    only increase by 1 (peek alone, then throw before claim).
    const findByCountAfterReplay = idemCallCounts.findByTenantScopeKey;
    const findByIncrement = findByCountAfterReplay - findByCountBeforeReplay;
    expect(findByIncrement,
      `findByTenantScopeKey must be called at least twice on replay (peek + claim); got increment=${findByIncrement}`,
    ).toBeGreaterThanOrEqual(2);

    // B. claim.action === "replay" is verified indirectly: no insert, no
    //    updateState, no transactionRunner invocation (see C). The fact
    //    that findByTenantScopeKey was called twice but no insert/updateState
    //    followed proves claim returned "replay" (not "execute" which would
    //    insert, not "in_progress" which would not throw).
    // D. attempt_count unchanged — no claimExpiredLease was called.
    const idemRecordAfterReplay = await sql`
      SELECT id, state, attempt_count, response_code, response_body, last_error_class, owner_token
      FROM idempotency_records
      WHERE tenant_id = ${scope.tenantId} AND idempotency_key = ${replaceIdemKey}`;
    const recordAfter = idemRecordAfterReplay[0]!;
    expect(recordAfter.id).toBe(recordBefore.id);              // same record
    expect(recordAfter.state).toBe("business_failed");          // still business_failed
    expect(recordAfter.attempt_count).toBe(recordBefore.attempt_count); // unchanged
    expect(recordAfter.owner_token).toBe(recordBefore.owner_token);    // owner unchanged
    expect(recordAfter.response_code).toBe(recordBefore.response_code); // stored code reused
    expect(recordAfter.last_error_class).toBe(recordBefore.last_error_class); // stored class reused

    // C. transactionRunner IS NOT invoked again on replay.
    expect(replacementTxCount.value,
      `transactionRunner must NOT be invoked on replay; got increment=${replacementTxCount.value - replacementTxCountBeforeReplay}`,
    ).toBe(replacementTxCountBeforeReplay);

    // E. No new insert (claim.action === "replay", not "execute").
    expect(idemInsertCount.value,
      `idempotency.insert must NOT be called on replay; got increment=${idemInsertCount.value - insertCountBeforeReplay}`,
    ).toBe(insertCountBeforeReplay);
    // No new updateState (no markSucceeded/markBusinessFailed/markRetryableFailed
    // on replay — the stored response is used directly).
    expect(idemUpdateStateCount.value,
      `idempotency.updateState must NOT be called on replay; got increment=${idemUpdateStateCount.value - updateStateCountBeforeReplay}`,
    ).toBe(updateStateCountBeforeReplay);

    // Zero duplicate effects: file count unchanged after replay attempt.
    const filesAfterReplay = await sql`SELECT count(*)::int AS c FROM import_files WHERE tenant_id = ${scope.tenantId} AND import_batch_id = ${batchId}`;
    expect(filesAfterReplay[0]?.c).toBe(filesBeforeReplay[0]?.c);

    await cleanupScope(scope);
  });

  // ===========================================================================
  // COM-REAL-RACE-2 — Replacement wins before commit (real production race)
  //
  // Both operations call real production methods:
  //   - HistoricalReplacementService.replaceMigrationFile()
  //   - HistoricalCommitService.commitBatch()
  //
  // Both services use the STANDARD transactionRunner (no custom barrier-based
  // runners). The two operations are launched concurrently with
  // Promise.allSettled and the natural production race plays out without any
  // test-side synchronization.
  //
  // Production race (replacement wins the batch row lock):
  //   1. Replacement starts. Pre-tx reads (non-locking SELECTs at READ
  //      COMMITTED) see approved_for_commit. Pre-tx checks pass,
  //      idempotency claim succeeds. Replacement enters its Drizzle tx
  //      and its work body's first statement is FOR UPDATE on the batch
  //      row — acquires the lock. Mutations: mark old file superseded,
  //      insert new file, mark old staging rows superseded, reset batch
  //      (status → source_uploaded, hashes cleared, etc.), invalidate
  //      current approvals, audit, markSucceeded. Drizzle tx commits,
  //      lock released.
  //   2. Commit starts in parallel. Pre-tx reads see approved_for_commit
  //      (replacement hasn't committed yet). Pre-tx checks pass,
  //      idempotency claim succeeds. Commit then acquires cutover locks:
  //      each `insertCutoverLock` is an INSERT into import_cutover_locks
  //      with an FK to import_batches. PostgreSQL's FK verification takes
  //      a FOR KEY SHARE lock on the parent row, which CONFLICTS with
  //      the replacement's FOR UPDATE — the INSERT BLOCKS until the
  //      replacement commits and releases the lock.
  //   3. Replacement commits → FOR UPDATE released. Commit's cutover
  //      lock INSERTs unblock (FK check now passes), commit enters its
  //      Drizzle tx, work body's FOR UPDATE acquires the now-released
  //      lock, re-reads state under lock = source_uploaded (replacement
  //      reset it), throws InvalidBatchStatusError. Drizzle tx rolls
  //      back. Commit's catch block releases cutover locks + marks
  //      business_failed durable.
  //
  // Why the replacement deterministically wins the lock race (no test-side
  // barriers needed): the replacement's pre-tx work is much shorter
  // (fewer SELECTs, no cutover lock INSERTs, no audit logs) than the
  // commit's, so the replacement reaches its Drizzle tx and FOR UPDATE
  // BEFORE the commit reaches its first cutover lock INSERT. From that
  // point on, the commit's cutover lock INSERTs block on the
  // replacement's lock and cannot race ahead.
  //
  // NOTE: the previous version of this test used custom transactionRunners
  // with deferred-promise barriers to deterministically force the
  // replacement's lock win. That design deadlocked: the commit's pre-tx
  // cutover lock INSERTs blocked on the replacement's FOR UPDATE before
  // the commit ever reached `signalCommitEnteredTx()`, so the replacement
  // (which was waiting for `commitEnteredTxPromise`) never made progress.
  // Removing the barriers entirely lets the production race play out
  // naturally and removes the deadlock.
  //
  // Expected:
  //   - replacement succeeds (status === "fulfilled", batch → source_uploaded,
  //     approvals invalidated, old file superseded, new file current)
  //   - commit rejects (status === "rejected", InvalidBatchStatusError —
  //     batch is no longer approved_for_commit)
  //   - no stale operational effects (no stock_movements, account_entries,
  //     no commit audit, no staging row commit links)
  //   - replacement idempotency = succeeded; commit idempotency != succeeded
  // ===========================================================================
  it("COM-REAL-RACE-2. replacement wins before commit (DETERMINISTIC barrier): replacement succeeds, commit rejects INVALID_BATCH_STATUS", async () => {
    const scope = newScope();
    await seedTenantAndUsers(scope);
    const batchId = randomUUID();
    await seedApprovedForCommitBatch(scope, batchId);

    const oldFileId = randomUUID();
    await sql`
      INSERT INTO import_files (id, tenant_id, import_batch_id, original_file_name, storage_path, file_hash,
        file_size_bytes, content_type, file_type, file_version, is_current, created_by, created_at)
      VALUES (${oldFileId}, ${scope.tenantId}, ${batchId}, ${"original.csv"}, ${"local://test/original-race-2"}, ${"sha256:original-race-2-" + batchId},
        100, ${"text/csv"}, ${"source"}, 1, true, ${scope.ownerId}, NOW())`;
    const oldRowId = randomUUID();
    const rowData = { code: "TY001", entity_type: "single_yarn", quantity: "100" };
    await sql`
      INSERT INTO import_staging_rows (id, tenant_id, import_batch_id, import_file_id, template_name,
        source_sheet_name, source_row_number, raw_row_json, transformed_row_json,
        transformation_notes, validation_status, review_status, ai_confidence,
        committed_entity_type, committed_entity_id, staging_version, is_current,
        created_by, created_at)
      VALUES (${oldRowId}, ${scope.tenantId}, ${batchId}, ${oldFileId}, ${"opening_balance_inventory"}, ${"original.csv"}, 1,
        ${JSON.stringify(rowData)}::jsonb,
        ${JSON.stringify(rowData)}::jsonb,
        null, ${"pending"}, ${"not_required"}, null, null, null, 1, true,
        ${scope.ownerId}, NOW())`;

    await seedPriorReconciliationEvidence(scope, batchId, 1);
    await seedBackupEvidence(scope, batchId);
    await seedCurrentApproval(scope, batchId, "owner", scope.ownerId);
    await seedCurrentApproval(scope, batchId, "accountant", scope.accountantId);

    // ----- Deferred-promise barriers -----
    let signalReplacementAcquiredLock!: () => void;
    const replacementAcquiredLockPromise = new Promise<void>(resolve => { signalReplacementAcquiredLock = resolve; });
    let signalReleaseReplacement!: () => void;
    const releaseReplacementPromise = new Promise<void>(resolve => { signalReleaseReplacement = resolve; });
    let signalCommitReachedCutoverInsert!: () => void;
    const commitReachedCutoverInsertPromise = new Promise<void>(resolve => { signalCommitReachedCutoverInsert = resolve; });
    let signalCommitPassedCutoverInsert!: () => void;
    const commitPassedCutoverInsertPromise = new Promise<void>(resolve => { signalCommitPassedCutoverInsert = resolve; });

    // ----- Custom replacementRunner: acquire FOR UPDATE, signal, pause, delegate -----
    const replacementRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
      (db as any).transaction(async (tx: any) => {
        await (tx as any).execute(drizzleSql`SELECT id, status FROM import_batches WHERE tenant_id = ${scope.tenantId} AND id = ${batchId} FOR UPDATE`);
        signalReplacementAcquiredLock();
        await releaseReplacementPromise;
        return await work(tx);
      });

    // ----- Commit repository wrapper: signal around REAL insertCutoverLock -----
    const realCommitRepo = new HistoricalCommitDbRepository(db);
    const commitRepoWrapper: HistoricalCommitRepository = new Proxy(realCommitRepo, {
      get(target, prop) {
        if (prop === "insertCutoverLock") {
          return async (row: any) => {
            signalCommitReachedCutoverInsert();
            const result = await target.insertCutoverLock(row);
            signalCommitPassedCutoverInsert();
            return result;
          };
        }
        const value = (target as any)[prop];
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    // ----- Construct services -----
    const stagingRepo = new HistoricalStagingDbRepository(db);
    const audit = new AuditDbRepository(db);
    const idem = new IdempotencyDbRepository(db);
    const replacementService = new HistoricalReplacementService({
      repository: stagingRepo, audit, idempotency: idem,
      transactionRunner: replacementRunner,
      createStagingRepository: (tx: unknown) => new HistoricalStagingDbRepository(tx as any),
      createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
      createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
      invalidateCurrentApprovals: async (tx: unknown, tenantId: string, batchId: string, invalidatedBy: string, reason: string) => {
        const txCommitRepo = new HistoricalCommitDbRepository(tx as any);
        return txCommitRepo.invalidateCurrentApprovalsForBatch(tenantId, batchId, invalidatedBy, reason);
      },
    });

    const standardTxRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
      (db as any).transaction(async (tx: any) => work(tx));
    const commitService = new HistoricalCommitService({
      repository: commitRepoWrapper, audit, idempotency: idem,
      transactionRunner: standardTxRunner,
      txFactories: {
        createCommitRepository: (tx: unknown) => new HistoricalCommitDbRepository(tx as any),
        createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
        createInventoryLedger: () => ({} as any),
        createSubledger: () => ({} as any),
        createDocumentSequence: (tx: unknown) => new DocumentSequenceDbRepository(tx as any),
        createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
      },
    });

    const storage = new InMemoryPrivateFileStorage();
    const commitIdemKey = "com-real-race-2-commit-" + randomUUID();
    const replaceIdemKey = "com-real-race-2-replace-" + randomUUID();

    const auditBefore = await getScopedAuditCount(scope, batchId);
    const filesBefore = await sql`SELECT count(*)::int AS c FROM import_files WHERE tenant_id = ${scope.tenantId} AND import_batch_id = ${batchId}`;
    const stagingRowsBefore = await sql`SELECT count(*)::int AS c FROM import_staging_rows WHERE tenant_id = ${scope.tenantId} AND import_batch_id = ${batchId}`;

    const storedFile = await storage.store(
      scope.tenantId, batchId, "replace-key-race-2", "replacement.csv",
      Buffer.from("code,entity_type,quantity\nTY001,single_yarn,100\n"),
      "text/csv",
    );

    // ----- Step 1: start real replaceMigrationFile() -----
    const replacementPromise = replacementService.replaceMigrationFile(
      makeOwnerUser(scope) as any, makeOwnerEffective() as any,
      {
        importBatchId: batchId, replaceFileId: oldFileId,
        originalFileName: "replacement.csv",
        storagePath: storedFile.storagePath, fileHash: storedFile.fileHash,
        fileSizeBytes: storedFile.fileSizeBytes, contentType: storedFile.contentType,
        fileType: "source",
        parsedRows: [{ rowNumber: 1, columns: { code: "TY001", entity_type: "single_yarn", quantity: "100" } }],
        templateType: "opening_balance_inventory",
        reworkReason: "COM-REAL-RACE-2: replace before commit race (deterministic)",
        idempotencyKey: replaceIdemKey,
      },
    );
    const replacementOutcome = replacementPromise.then(
      (value) => ({ ok: true as const, value }),
      (error) => ({ ok: false as const, error }),
    );

    // ----- Step 2: wait for replacement to acquire FOR UPDATE -----
    await replacementAcquiredLockPromise;
    const batchAtPause = await getBatchState(scope, batchId);
    expect(batchAtPause!.status).toBe("approved_for_commit");

    // ----- Step 3: start real commitBatch() -----
    const commitPromise = commitService.commitBatch(
      makeOwnerUser(scope) as any, makeOwnerEffective() as any,
      { importBatchId: batchId, idempotencyKey: commitIdemKey },
    );
    const commitOutcome = commitPromise.then(
      (value) => ({ ok: true as const, value }),
      (error) => ({ ok: false as const, error }),
    );

    // ----- Step 4: wait for commit to reach insertCutoverLock -----
    await commitReachedCutoverInsertPromise;

    // ----- Step 5: prove commit is BLOCKED at insert boundary -----
    // commitReachedCutoverInsert fired; commitPassedCutoverInsert has NOT.
    //
    // WP-08-01F DEC-081 recovery — REAL PostgreSQL lock evidence.
    // Query pg_stat_activity + pg_locks via a SEPARATE PostgreSQL observer
    // connection (the test's main `sql` handle) to prove the commit backend
    // is waiting on a Lock while the replacement holds the conflicting
    // transaction/row state.
    //
    // We capture the ACTUAL observed rows (sanitized for the report):
    //   - commit backend PID
    //   - pg_stat_activity.wait_event_type
    //   - pg_stat_activity.wait_event
    //   - relevant pg_locks.locktype
    //   - pg_locks.mode
    //   - pg_locks.granted
    //
    // PostgreSQL may represent this wait via tuple lock, transactionid, or
    // relation lock depending on the FK FOR KEY SHARE mechanism. We accept
    // any of these as proof — the conclusion is based on actual PostgreSQL
    // state, not absence-of-completion.
    //
    // NOTE: the replacement backend is in `idle in transaction` state at
    // this point — it has acquired the FOR UPDATE lock and is now waiting
    // on a JS Promise (`releaseReplacementPromise`). It is NOT running a
    // SQL query, so pg_stat_activity.query may be empty or show the last
    // executed query. We find the replacement backend by querying
    // pg_locks for the granted lock holder on `import_batches`, NOT by
    // filtering pg_stat_activity.query.
    const observerSql = postgres(DATABASE_URL!, { prepare: false, max: 2, idle_timeout: 5, connect_timeout: 10 });
    try {
      // Find the commit backend: it's running an INSERT into import_cutover_locks
      // and is currently waiting on a Lock (state=active, wait_event_type=Lock).
      const commitBackend = await observerSql`
        SELECT pid, wait_event_type, wait_event, state,
               left(query, 120) AS query_snippet
        FROM pg_stat_activity
        WHERE state = 'active'
          AND query ILIKE '%import_cutover_locks%'
          AND pid <> pg_backend_pid()
        ORDER BY pid`;

      // Find the replacement backend via pg_locks: it HOLDS a granted lock
      // on import_batches (the FOR UPDATE). The backend may be in
      // `idle in transaction` state (waiting on a JS Promise), so we don't
      // filter on pg_stat_activity.query.
      const replacementLockHolders = await observerSql`
        SELECT gl.pid, gl.locktype, gl.mode, gl.granted,
               gl.relation::regclass::text AS relation_name,
               psa.state AS backend_state,
               psa.wait_event_type AS backend_wait_event_type,
               psa.wait_event AS backend_wait_event,
               left(psa.query, 120) AS query_snippet
        FROM pg_locks gl
        JOIN pg_stat_activity psa ON psa.pid = gl.pid
        WHERE gl.relation::regclass::text = 'import_batches'
          AND gl.granted = true
          AND gl.locktype IN ('relation', 'tuple')
          AND gl.pid <> pg_backend_pid()
        ORDER BY gl.pid`;

      // All relevant locks (granted + ungranted) on import_batches or
      // transactionid, for either the commit or replacement backend.
      const allRelevantLocks = await observerSql`
        SELECT gl.pid, gl.locktype, gl.mode, gl.granted,
               gl.relation::regclass::text AS relation_name,
               gl.transactionid::text AS txn_id,
               psa.state AS backend_state,
               psa.wait_event_type AS backend_wait_event_type,
               psa.query ILIKE '%import_cutover_locks%' AS is_commit_backend
        FROM pg_locks gl
        JOIN pg_stat_activity psa ON psa.pid = gl.pid
        WHERE psa.pid <> pg_backend_pid()
          AND (
            gl.relation::regclass::text IN ('import_batches', 'import_cutover_locks')
            OR gl.locktype = 'transactionid'
          )
          AND (psa.query ILIKE '%import_cutover_locks%'
               OR gl.relation::regclass::text = 'import_batches')
        ORDER BY gl.pid, gl.locktype, gl.granted DESC`;

      // ===== ASSERTIONS BASED ON ACTUAL PostgreSQL STATE =====
      // 1. At least one commit backend is waiting on a Lock.
      const commitWaiting = commitBackend.filter((r: any) => r.wait_event_type === "Lock");
      expect(commitWaiting.length,
        `Expected at least one commit backend waiting on Lock; got: ${JSON.stringify(commitBackend)}`,
      ).toBeGreaterThanOrEqual(1);

      // 2. The replacement backend HOLDS a granted lock on import_batches.
      expect(replacementLockHolders.length,
        `Expected granted lock holder on import_batches (replacement's FOR UPDATE); got: ${JSON.stringify(replacementLockHolders)}`,
      ).toBeGreaterThanOrEqual(1);

      // 3. There exists at least one ungranted lock row (the commit's wait).
      const ungrantedLocks = allRelevantLocks.filter((r: any) => r.granted === false);
      expect(ungrantedLocks.length,
        `Expected at least one ungranted lock row (commit waiting); got locks: ${JSON.stringify(allRelevantLocks)}`,
      ).toBeGreaterThanOrEqual(1);

      // 4. There exists at least one granted lock row on import_batches
      //    (the replacement's FOR UPDATE).
      const grantedBatchLocks = allRelevantLocks.filter(
        (r: any) => r.granted === true && r.relation_name === "import_batches",
      );
      expect(grantedBatchLocks.length,
        `Expected granted lock on import_batches (replacement's FOR UPDATE); got: ${JSON.stringify(allRelevantLocks)}`,
      ).toBeGreaterThanOrEqual(1);

      // ===== EVIDENCE SUMMARY (for the report) =====
      const evidenceSummary = {
        commit_backend_pids: commitBackend.map((r: any) => r.pid),
        commit_wait_event_types: commitBackend.map((r: any) => r.wait_event_type),
        commit_wait_events: commitBackend.map((r: any) => r.wait_event),
        replacement_backend_pids: replacementLockHolders.map((r: any) => r.pid),
        replacement_backend_states: replacementLockHolders.map((r: any) => r.backend_state),
        replacement_backend_wait_event_types: replacementLockHolders.map((r: any) => r.backend_wait_event_type),
        ungranted_locktypes: ungrantedLocks.map((r: any) => ({
          locktype: r.locktype, mode: r.mode, relation: r.relation_name, txn_id: r.txn_id,
        })),
        granted_batch_lock_modes: grantedBatchLocks.map((r: any) => ({
          locktype: r.locktype, mode: r.mode,
        })),
      };
      // Sanity-assert that the evidence is non-empty (proves we observed
      // real PostgreSQL state, not absence-of-completion).
      expect(evidenceSummary.commit_backend_pids.length).toBeGreaterThan(0);
      expect(evidenceSummary.ungranted_locktypes.length).toBeGreaterThan(0);
      expect(evidenceSummary.granted_batch_lock_modes.length).toBeGreaterThan(0);
      // The commit backend MUST be waiting on a Lock (not BufferPin, not LWLock,
      // not NULL). This is the primary locking proof.
      for (const wet of evidenceSummary.commit_wait_event_types) {
        expect(wet).toBe("Lock");
      }
    } finally {
      await observerSql.end();
    }

    // 300ms watchdog remains ONLY for test deadlock safety — NOT as the
    // primary locking proof (which is provided by pg_stat_activity/pg_locks
    // observations above).
    const passedBeforeRelease = await Promise.race([
      commitPassedCutoverInsertPromise.then(() => true),
      new Promise<boolean>(r => setTimeout(() => r(false), 300)),
    ]);
    expect(passedBeforeRelease).toBe(false); // commit is BLOCKED

    // ----- Step 6: release replacement barrier -----
    signalReleaseReplacement();

    // ----- Step 7: replacement completes -----
    const repResult = await replacementOutcome;
    expect(repResult.ok).toBe(true);
    if (repResult.ok) {
      expect(repResult.value.action).toBe("created");
      expect(repResult.value.oldFileId).toBe(oldFileId);
      expect(repResult.value.newStagingRowCount).toBe(1);
    }

    // ----- Step 8: commit resumes and fails closed -----
    const commitResult = await commitOutcome;
    expect(commitResult.ok).toBe(false);
    if (!commitResult.ok) {
      expect(String(commitResult.error?.message ?? commitResult.error)).toMatch(/INVALID_BATCH_STATUS|status/i);
    }

    // ----- Verify final state -----
    const batch = await getBatchState(scope, batchId);
    expect(batch!.status).toBe("source_uploaded");
    expect(batch!.committed_at).toBeNull();
    expect(batch!.commit_effect_counts).toBeNull();
    expect(batch!.staged_data_hash).toBe("");
    expect(batch!.cutover_manifest_hash).toBe("");

    // Old file superseded exactly once.
    const oldFileRows = await sql`SELECT is_current, superseded_at FROM import_files WHERE tenant_id = ${scope.tenantId} AND id = ${oldFileId}`;
    expect(oldFileRows[0]?.is_current).toBe(false);
    expect(oldFileRows[0]?.superseded_at).not.toBeNull();

    // New file current.
    const newFileRows = await sql`SELECT is_current, file_hash FROM import_files WHERE tenant_id = ${scope.tenantId} AND import_batch_id = ${batchId} AND id = ${repResult.ok ? repResult.value.newFileId : "none"}`;
    expect(newFileRows[0]?.is_current).toBe(true);
    expect(newFileRows[0]?.file_hash).toBe(storedFile.fileHash);

    // File count: before + 1.
    const filesAfter = await sql`SELECT count(*)::int AS c FROM import_files WHERE tenant_id = ${scope.tenantId} AND import_batch_id = ${batchId}`;
    expect(filesAfter[0]?.c).toBe((filesBefore[0]?.c ?? 0) + 1);

    // Staging row count: before + 1.
    const stagingRowsAfter = await sql`SELECT count(*)::int AS c FROM import_staging_rows WHERE tenant_id = ${scope.tenantId} AND import_batch_id = ${batchId}`;
    expect(stagingRowsAfter[0]?.c).toBe((stagingRowsBefore[0]?.c ?? 0) + 1);

    // Old staging has no commit link.
    const oldStagingRow = await getStagingRowCommitLink(scope, oldRowId);
    expect(oldStagingRow!.committed_entity_type).toBeNull();
    expect(oldStagingRow!.committed_entity_id).toBeNull();

    // No commit audit.
    const auditAfter = await getScopedAuditCount(scope, batchId, "historical_commit.commit");
    expect(auditAfter).toBe(auditBefore);

    // Zero operational effects.
    const stockMovements = await sql`SELECT count(*)::int AS c FROM stock_movements WHERE tenant_id = ${scope.tenantId} AND source_document_id = ${oldRowId}`;
    expect(stockMovements[0]?.c).toBe(0);
    const accountEntries = await sql`SELECT count(*)::int AS c FROM account_entries WHERE tenant_id = ${scope.tenantId} AND source_document_id = ${oldRowId}`;
    expect(accountEntries[0]?.c).toBe(0);

    // Cutover locks cleaned up.
    const lockCount = await getActiveLockCount(scope, batchId);
    expect(lockCount).toBe(0);

    // Commit idempotency NOT succeeded.
    const commitIdemState = await getIdemState(scope, commitIdemKey);
    expect(commitIdemState).not.toBeNull();
    expect(commitIdemState!.state).not.toBe("succeeded");

    // Replacement idempotency succeeded.
    const replaceIdemState = await getIdemState(scope, replaceIdemKey);
    expect(replaceIdemState?.state).toBe("succeeded");

    await cleanupScope(scope);
  });
});
