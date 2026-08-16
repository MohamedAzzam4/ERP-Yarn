/**
 * WP-08-01F Phase 0 — Validation atomicity PostgreSQL proofs.
 *
 * Proves the transactional atomicity contract of HistoricalValidationService
 * against a real local PostgreSQL disposable database:
 *
 *   VA-1. Audit failure rolls back everything (findings, batch status, audit, idempotency).
 *   VA-2. Status-update failure rolls back findings/counts/status/audit/idempotency.
 *   VA-3. Retry succeeds (after lease expiry or reclaim).
 *   VA-4. Replay adds zero effects.
 *   VA-5. Conflict is rejected.
 *
 * The validation service wraps ALL writes in a single transactionRunner call.
 * If ANY write fails, the entire transaction rolls back — no partial findings,
 * no partial status updates, no partial audit rows, no partial idempotency.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/server/db/schema";
import { HistoricalValidationService } from "@/server/services/historical-validation-service";
import { HistoricalValidationDbRepository } from "@/server/services/historical-validation-db-repository";
import { HistoricalCommitDbRepository } from "@/server/services/historical-commit-db-repository";
import { AuditDbRepository } from "@/server/services/audit-db-repository";
import { IdempotencyDbRepository } from "@/server/services/idempotency-db-repository";
import { resolveEffectivePermissions } from "@/server/security/effective-permissions";
import { TEST_ROLE_PERMISSION_MATRIX } from "@/server/security/role-fixtures";
import type { RoleCode } from "@/server/security/role-codes";
import { sql as drizzleSql } from "drizzle-orm";
import type { ErpUserContext } from "@/server/auth/erp-context";

const DATABASE_URL = process.env.DATABASE_URL;
const ALLOW_DESTRUCTIVE = process.env.ERP_ALLOW_DESTRUCTIVE_LOCAL_TEST_DB === "1";
const REQUIRE_PROOF = process.env.ERP_REQUIRE_WP0801F_POSTGRES_PROOF === "1";
// WP-08-01F Milestone C Task 1: Use shared destructive-test guard
import { checkDestructiveTestDbSafety } from "./destructive-test-guard";
const SAFETY_RESULT = checkDestructiveTestDbSafety({
  databaseUrl: DATABASE_URL,
  allowDestructive: ALLOW_DESTRUCTIVE,
  requireProof: REQUIRE_PROOF,
});
let SAFETY_ERROR_MESSAGE: string | null = SAFETY_RESULT.kind === "fail" ? SAFETY_RESULT.message : null;
const describeOrSkip = SAFETY_RESULT.kind === "ok" ? describe : describe.skip;
if (SAFETY_RESULT.kind === "skip") {
  console.log(`\n[WP-08-01F validation atomicity] SKIPPED: ${SAFETY_RESULT.reason}\n`);
} else if (SAFETY_RESULT.kind === "fail") {
  SAFETY_ERROR_MESSAGE = SAFETY_RESULT.message;
  console.error(`\n[WP-08-01F validation atomicity] SAFETY GUARD FAILED:\n${SAFETY_RESULT.message}\n`);
}

const RUN_ID = randomUUID();
const T = RUN_ID;
const U = randomUUID();

let sql: ReturnType<typeof postgres>;
let db: any;

async function cleanupRunScopedTenantData(): Promise<void> {
  await sql`DELETE FROM import_cutover_locks WHERE tenant_id = ${T}`;
  await sql`DELETE FROM import_backup_evidence WHERE tenant_id = ${T}`;
  await sql`DELETE FROM import_batch_approvals WHERE tenant_id = ${T}`;
  await sql`DELETE FROM import_reconciliation_results WHERE tenant_id = ${T}`;
  await sql`DELETE FROM import_human_review_items WHERE tenant_id = ${T}`;
  await sql`DELETE FROM import_validation_errors WHERE tenant_id = ${T}`;
  await sql`DELETE FROM import_alias_mappings WHERE tenant_id = ${T}`;
  await sql`DELETE FROM import_staging_cells WHERE tenant_id = ${T}`;
  await sql`DELETE FROM import_staging_rows WHERE tenant_id = ${T}`;
  await sql`DELETE FROM import_files WHERE tenant_id = ${T}`;
  await sql`DELETE FROM historical_correction_requests WHERE tenant_id = ${T}`;
  await sql`DELETE FROM import_cutover_manifests WHERE tenant_id = ${T}`;
  await sql`DELETE FROM import_batches WHERE tenant_id = ${T}`;
}

async function seedTenantAndUser(): Promise<void> {
  const runSuffix = RUN_ID.slice(0, 8);
  await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status)
            VALUES (${T}, ${"VA-" + runSuffix}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference)
            VALUES (${U}, ${T}, ${"va-" + runSuffix}, ${"VA User"}, ${"va-" + runSuffix + "@test.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
}

async function seedBatch(batchId: string, status: string, overrides: {
  stagedDataHash?: string | null;
  cutoverManifestHash?: string | null;
  validationStatus?: string | null;
  reconciliationStatus?: string | null;
  stagedRowCount?: number;
} = {}): Promise<void> {
  const stagedDataHash = overrides.stagedDataHash === undefined ? "staged-hash" : overrides.stagedDataHash;
  const cutoverManifestHash = overrides.cutoverManifestHash === undefined ? "manifest-hash" : overrides.cutoverManifestHash;
  const validationStatus = overrides.validationStatus === undefined ? null : overrides.validationStatus;
  const reconciliationStatus = overrides.reconciliationStatus === undefined ? null : overrides.reconciliationStatus;
  const stagedRowCount = overrides.stagedRowCount ?? 1;
  await sql`
    INSERT INTO import_batches (
      id, tenant_id, batch_no, status, source_description, template_name, template_version,
      mapping_version, cutover_manifest_hash, cutover_import_mode, staged_data_hash, staged_row_count,
      blocking_error_count, warning_count, accepted_warning_count, validation_status, reconciliation_status,
      warning_summary, committed_at, commit_effect_counts, created_by, created_at
    ) VALUES (
      ${batchId}, ${T}, ${"MIG-" + batchId.slice(-6)}, ${status}::import_batch_status, ${"test"}, ${"opening_balance_inventory"}, ${"1.0"},
      ${"1.0"}, ${cutoverManifestHash}, ${"opening_balance"}, ${stagedDataHash}, ${stagedRowCount},
      0, 0, 0, ${validationStatus}, ${reconciliationStatus},
      null, null, null, ${U}, NOW()
    )`;
}

async function seedFile(batchId: string, fileHash: string): Promise<string> {
  const id = randomUUID();
  await sql`
    INSERT INTO import_files (id, tenant_id, import_batch_id, original_file_name, storage_path, file_hash,
      file_size_bytes, content_type, file_type, file_version, is_current, created_by, created_at, updated_at, updated_by)
    VALUES (${id}, ${T}, ${batchId}, ${"original.csv"}, ${"local://test/" + fileHash}, ${fileHash},
      100, ${"text/csv"}, ${"source"}, 1, true, ${U}, NOW(), null, null)`;
  return id;
}

async function seedStagingRow(batchId: string, fileId: string, rowNum: number, data: Record<string, unknown> = { name: "Test", code: "C001", quantity: "100", date: "2024-01-01" }): Promise<string> {
  const id = randomUUID();
  await sql`
    INSERT INTO import_staging_rows (id, tenant_id, import_batch_id, import_file_id, template_name,
      source_sheet_name, source_row_number, raw_row_json, transformed_row_json,
      transformation_notes, validation_status, review_status, ai_confidence,
      committed_entity_type, committed_entity_id, staging_version, is_current,
      created_by, created_at, updated_at, updated_by)
    VALUES (${id}, ${T}, ${batchId}, ${fileId}, ${"opening_balance_inventory"}, ${"original.csv"}, ${rowNum},
      ${JSON.stringify(data)}::jsonb,
      ${JSON.stringify(data)}::jsonb,
      null, ${"pending"}, ${"not_required"}, null, null, null, 1, true,
      ${U}, NOW(), null, null)`;
  return id;
}

function makeUser(): ErpUserContext {
  return { authenticated: true, userId: U, tenantId: T, authId: `auth-${U}`, name: "Test", email: `test-${U}@test.local` };
}
function makeEffective(role: RoleCode = "owner") {
  return resolveEffectivePermissions([role], TEST_ROLE_PERMISSION_MATRIX);
}

function makeStandardServices() {
  const valRepo = new HistoricalValidationDbRepository(db);
  const commitRepo = new HistoricalCommitDbRepository(db);
  const audit = new AuditDbRepository(db);
  const idem = new IdempotencyDbRepository(db);
  const transactionRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
    (db as any).transaction(async (tx: any) => work(tx));
  const validationService = new HistoricalValidationService({
    repository: valRepo, audit, idempotency: idem,
    transactionRunner,
    createRepository: (tx: unknown) => new HistoricalValidationDbRepository(tx as any),
    createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
    createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
  });
  return { validationService, valRepo, commitRepo, audit, idem, transactionRunner };
}

/** Build a validation service with a FAULTY tx-scoped audit that throws on insertAuditLog. */
function makeAuditFailureService() {
  const valRepo = new HistoricalValidationDbRepository(db);
  const audit = new AuditDbRepository(db);
  const idem = new IdempotencyDbRepository(db);
  const transactionRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
    (db as any).transaction(async (tx: any) => work(tx));
  const validationService = new HistoricalValidationService({
    repository: valRepo, audit, idempotency: idem,
    transactionRunner,
    createRepository: (tx: unknown) => new HistoricalValidationDbRepository(tx as any),
    createAudit: (tx: unknown) => {
      const real = new AuditDbRepository(tx as any);
      // Wrap insertAuditLog to throw — simulates a DB failure during audit write.
      // Use Object.create to preserve all prototype methods.
      const wrapper = Object.create(real);
      wrapper.insertAuditLog = async () => { throw new Error("INJECTED_AUDIT_FAILURE_VA1"); };
      return wrapper;
    },
    createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
  });
  return { validationService, valRepo, audit, idem };
}

/** Build a validation service with a FAULTY tx-scoped repository that throws on updateBatchStatus. */
function makeStatusFailureService() {
  const valRepo = new HistoricalValidationDbRepository(db);
  const audit = new AuditDbRepository(db);
  const idem = new IdempotencyDbRepository(db);
  const transactionRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
    (db as any).transaction(async (tx: any) => work(tx));
  const validationService = new HistoricalValidationService({
    repository: valRepo, audit, idempotency: idem,
    transactionRunner,
    createRepository: (tx: unknown) => {
      const real = new HistoricalValidationDbRepository(tx as any);
      // Wrap updateBatchStatus to throw — simulates a DB failure during status update.
      // Use Object.create to preserve all other prototype methods (deleteValidationErrorsForBatch, etc.).
      const wrapper = Object.create(real);
      wrapper.updateBatchStatus = async () => { throw new Error("INJECTED_STATUS_FAILURE_VA2"); };
      return wrapper;
    },
    createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
    createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
  });
  return { validationService, valRepo, audit, idem };
}

describeOrSkip("WP-08-01F Phase 0 — Validation atomicity proofs", () => {
  beforeAll(async () => {
    if (SAFETY_ERROR_MESSAGE) throw new Error(SAFETY_ERROR_MESSAGE);
    sql = postgres(DATABASE_URL!, { prepare: false, max: 10, idle_timeout: 10, connect_timeout: 10 });
    db = drizzle(sql, { schema });
    await sql`SET statement_timeout = 30000`;
    const dbResult = await sql`SELECT current_database() AS db_name`;
    if (dbResult[0]?.db_name !== "erp_yarn_wp0801f_disposable") {
      await sql.end();
      throw new Error(`SAFETY: Connected to '${dbResult[0]?.db_name}' but expected '${"erp_yarn_wp0801f_disposable"}'`);
    }
    await seedTenantAndUser();
  }, 30000);

  afterAll(async () => {
    if (sql) {
      await cleanupRunScopedTenantData();
      await sql.end();
    }
  }, 30000);

  beforeEach(async () => {
    await cleanupRunScopedTenantData();
  }, 15000);

  // ===========================================================================
  // VA-1. Audit failure rolls back everything
  // ===========================================================================
  it("VA-1. audit failure rolls back ALL writes (findings, batch status, audit, idempotency)", async () => {
    const { validationService } = makeAuditFailureService();
    const batchId = randomUUID();
    await seedBatch(batchId, "staged", {
      stagedDataHash: "h", cutoverManifestHash: "mh",
      validationStatus: null, reconciliationStatus: null, stagedRowCount: 1,
    });
    const fileId = await seedFile(batchId, "sha256:va1");
    // Seed a staging row with missing fields → will produce blocking errors + audit writes
    await seedStagingRow(batchId, fileId, 1, { name: "Test" }); // missing code, quantity, date

    // Capture BEFORE state
    const beforeFindings = (await sql`SELECT count(*)::int AS c FROM import_validation_errors WHERE tenant_id = ${T} AND import_batch_id = ${batchId}`)[0]!.c;
    const beforeAudit = (await sql`SELECT count(*)::int AS c FROM audit_logs WHERE tenant_id = ${T}`)[0]!.c;
    const beforeIdem = (await sql`SELECT count(*)::int AS c FROM idempotency_records WHERE tenant_id = ${T}`)[0]!.c;

    // Run validation — audit failure should throw and roll back the entire transaction
    await expect(
      validationService.runValidation(makeUser() as any, makeEffective() as any, {
        importBatchId: batchId, idempotencyKey: "va1-audit-failure",
      }),
    ).rejects.toThrow(/INJECTED_AUDIT_FAILURE_VA1|AUDIT_WRITE_FAILED|audit write failed/i);

    // Verify NO findings were persisted (rolled back)
    const afterFindings = (await sql`SELECT count(*)::int AS c FROM import_validation_errors WHERE tenant_id = ${T} AND import_batch_id = ${batchId}`)[0]!.c;
    expect(afterFindings).toBe(beforeFindings);

    // Verify batch status did NOT change (still "staged", not "validation_complete")
    const batch = await sql`SELECT status, validation_status, blocking_error_count, warning_count FROM import_batches WHERE id = ${batchId}`;
    expect(batch[0]!.status).toBe("staged");
    expect(batch[0]!.validation_status).toBeNull();
    expect(batch[0]!.blocking_error_count).toBe(0);
    expect(batch[0]!.warning_count).toBe(0);

    // Verify NO audit row was persisted (the audit insert was rolled back)
    const afterAudit = (await sql`SELECT count(*)::int AS c FROM audit_logs WHERE tenant_id = ${T}`)[0]!.c;
    expect(afterAudit).toBe(beforeAudit);

    // Verify idempotency record was NOT marked succeeded (still in_progress or retryable_failed)
    const idemRecord = await sql`SELECT state FROM idempotency_records WHERE tenant_id = ${T} AND idempotency_key = 'va1-audit-failure'`;
    if (idemRecord.length > 0) {
      expect(idemRecord[0]!.state).not.toBe("succeeded");
    }
    // The idempotency record may or may not exist (the markSucceeded was inside the tx and rolled back).
    // If it exists, it must NOT be succeeded.
    const afterIdem = (await sql`SELECT count(*)::int AS c FROM idempotency_records WHERE tenant_id = ${T} AND state = 'succeeded'`)[0]!.c;
    expect(afterIdem).toBe(beforeIdem); // no NEW succeeded records
  });

  // ===========================================================================
  // VA-2. Status-update failure rolls back findings/counts/status/audit/idempotency
  // ===========================================================================
  it("VA-2. status-update failure rolls back findings/counts/status/audit/idempotency", async () => {
    const { validationService } = makeStatusFailureService();
    const batchId = randomUUID();
    await seedBatch(batchId, "staged", {
      stagedDataHash: "h", cutoverManifestHash: "mh",
      validationStatus: null, reconciliationStatus: null, stagedRowCount: 1,
    });
    const fileId = await seedFile(batchId, "sha256:va2");
    // Seed a staging row with missing fields → will produce blocking errors
    await seedStagingRow(batchId, fileId, 1, { name: "Test" }); // missing code, quantity, date

    // Capture BEFORE state
    const beforeFindings = (await sql`SELECT count(*)::int AS c FROM import_validation_errors WHERE tenant_id = ${T} AND import_batch_id = ${batchId}`)[0]!.c;
    const beforeAudit = (await sql`SELECT count(*)::int AS c FROM audit_logs WHERE tenant_id = ${T}`)[0]!.c;

    // Run validation — updateBatchStatus failure should throw and roll back
    await expect(
      validationService.runValidation(makeUser() as any, makeEffective() as any, {
        importBatchId: batchId, idempotencyKey: "va2-status-failure",
      }),
    ).rejects.toThrow(/INJECTED_STATUS_FAILURE_VA2/);

    // Verify NO findings were persisted (rolled back — even though they were inserted before status update)
    const afterFindings = (await sql`SELECT count(*)::int AS c FROM import_validation_errors WHERE tenant_id = ${T} AND import_batch_id = ${batchId}`)[0]!.c;
    expect(afterFindings).toBe(beforeFindings);

    // Verify batch status/counts did NOT change (still "staged", validation_status still null, counts still 0)
    const batch = await sql`SELECT status, validation_status, blocking_error_count, warning_count FROM import_batches WHERE id = ${batchId}`;
    expect(batch[0]!.status).toBe("staged");
    expect(batch[0]!.validation_status).toBeNull();
    expect(batch[0]!.blocking_error_count).toBe(0);
    expect(batch[0]!.warning_count).toBe(0);

    // Verify NO audit row was persisted (the finding-create audits + the run audit all rolled back)
    const afterAudit = (await sql`SELECT count(*)::int AS c FROM audit_logs WHERE tenant_id = ${T}`)[0]!.c;
    expect(afterAudit).toBe(beforeAudit);

    // Verify idempotency was NOT marked succeeded
    const idemRecord = await sql`SELECT state FROM idempotency_records WHERE tenant_id = ${T} AND idempotency_key = 'va2-status-failure'`;
    if (idemRecord.length > 0) {
      expect(idemRecord[0]!.state).not.toBe("succeeded");
    }
  });

  // ===========================================================================
  // VA-3. Retry succeeds (after lease expiry)
  // ===========================================================================
  it("VA-3. retry with same key succeeds after lease expiry (validation completes on second attempt)", async () => {
    // Step 1: First attempt fails (audit failure) with a SHORT lease (1 second)
    const batchId = randomUUID();
    await seedBatch(batchId, "staged", {
      stagedDataHash: "h", cutoverManifestHash: "mh",
      validationStatus: null, reconciliationStatus: null, stagedRowCount: 1,
    });
    const fileId = await seedFile(batchId, "sha256:va3");
    await seedStagingRow(batchId, fileId, 1, { name: "Test", code: "C001", quantity: "100", date: "2024-01-01" });

    // First attempt: audit failure → transaction rolls back, idempotency stays in_progress
    const failService = makeAuditFailureService().validationService;
    await expect(
      failService.runValidation(makeUser() as any, makeEffective() as any, {
        importBatchId: batchId, idempotencyKey: "va3-retry-key",
      }),
    ).rejects.toThrow(/INJECTED_AUDIT_FAILURE_VA1|AUDIT_WRITE_FAILED|audit write failed/i);

    // Verify the idempotency record exists and is NOT succeeded
    const idemAfterFail = await sql`SELECT state, lease_expires_at FROM idempotency_records WHERE tenant_id = ${T} AND idempotency_key = 'va3-retry-key'`;
    expect(idemAfterFail.length).toBe(1);
    expect(idemAfterFail[0]!.state).not.toBe("succeeded");

    // Expire the lease manually (simulates waiting for lease expiry)
    // This is NOT workflow fabrication — it's test-time acceleration of a real
    // idempotency mechanism (lease expiry allows reclaim by the next caller).
    await sql`UPDATE idempotency_records SET lease_expires_at = NOW() - interval '1 second' WHERE tenant_id = ${T} AND idempotency_key = 'va3-retry-key'`;

    // Step 2: Retry with SAME key → succeeds (lease expired, claim reclaimed)
    const goodService = makeStandardServices().validationService;
    const retryResult = await goodService.runValidation(makeUser() as any, makeEffective() as any, {
      importBatchId: batchId, idempotencyKey: "va3-retry-key", // SAME KEY
    });
    expect(retryResult.action).toBe("executed");

    // Verify the batch transitioned to validation_complete
    const batch = await sql`SELECT status, validation_status FROM import_batches WHERE id = ${batchId}`;
    expect(batch[0]!.status).toBe("validation_complete");
    expect(batch[0]!.validation_status).toBe("passed"); // no blocking errors for valid row

    // Verify idempotency is now succeeded
    const idemAfterRetry = await sql`SELECT state, attempt_count FROM idempotency_records WHERE tenant_id = ${T} AND idempotency_key = 'va3-retry-key'`;
    expect(idemAfterRetry[0]!.state).toBe("succeeded");
    expect(idemAfterRetry[0]!.attempt_count).toBe(2); // first attempt (failed) + retry (succeeded)
  });

  // ===========================================================================
  // VA-4. Replay adds zero effects
  // ===========================================================================
  it("VA-4. replay with same key adds zero new effects (findings/audit/idempotency unchanged)", async () => {
    const batchId = randomUUID();
    await seedBatch(batchId, "staged", {
      stagedDataHash: "h", cutoverManifestHash: "mh",
      validationStatus: null, reconciliationStatus: null, stagedRowCount: 1,
    });
    const fileId = await seedFile(batchId, "sha256:va4");
    await seedStagingRow(batchId, fileId, 1, { name: "Test", code: "C001", quantity: "100", date: "2024-01-01" });

    const { validationService } = makeStandardServices();

    // First call: executes validation
    const result1 = await validationService.runValidation(makeUser() as any, makeEffective() as any, {
      importBatchId: batchId, idempotencyKey: "va4-replay-key",
    });
    expect(result1.action).toBe("executed");

    // Capture state after first call
    const findingsAfter1 = (await sql`SELECT count(*)::int AS c FROM import_validation_errors WHERE tenant_id = ${T} AND import_batch_id = ${batchId}`)[0]!.c;
    const auditAfter1 = (await sql`SELECT count(*)::int AS c FROM audit_logs WHERE tenant_id = ${T}`)[0]!.c;
    const idemAfter1 = (await sql`SELECT count(*)::int AS c FROM idempotency_records WHERE tenant_id = ${T}`)[0]!.c;

    // Second call: replay with same key → zero new effects
    const result2 = await validationService.runValidation(makeUser() as any, makeEffective() as any, {
      importBatchId: batchId, idempotencyKey: "va4-replay-key", // SAME KEY
    });
    expect(result2.action).toBe("replayed");

    // Verify zero new effects
    const findingsAfter2 = (await sql`SELECT count(*)::int AS c FROM import_validation_errors WHERE tenant_id = ${T} AND import_batch_id = ${batchId}`)[0]!.c;
    const auditAfter2 = (await sql`SELECT count(*)::int AS c FROM audit_logs WHERE tenant_id = ${T}`)[0]!.c;
    const idemAfter2 = (await sql`SELECT count(*)::int AS c FROM idempotency_records WHERE tenant_id = ${T}`)[0]!.c;

    expect(findingsAfter2).toBe(findingsAfter1);
    expect(auditAfter2).toBe(auditAfter1);
    expect(idemAfter2).toBe(idemAfter1);
  });

  // ===========================================================================
  // VA-5. Conflict is rejected
  // ===========================================================================
  it("VA-5. same key with different request body is rejected with zero effects", async () => {
    const batchIdA = randomUUID();
    const batchIdB = randomUUID();
    await seedBatch(batchIdA, "staged", {
      stagedDataHash: "h", cutoverManifestHash: "mh",
      validationStatus: null, reconciliationStatus: null, stagedRowCount: 1,
    });
    await seedBatch(batchIdB, "staged", {
      stagedDataHash: "h", cutoverManifestHash: "mh",
      validationStatus: null, reconciliationStatus: null, stagedRowCount: 1,
    });
    const fileIdA = await seedFile(batchIdA, "sha256:va5a");
    const fileIdB = await seedFile(batchIdB, "sha256:va5b");
    await seedStagingRow(batchIdA, fileIdA, 1, { name: "Test", code: "C001", quantity: "100", date: "2024-01-01" });
    await seedStagingRow(batchIdB, fileIdB, 1, { name: "Test", code: "C002", quantity: "200", date: "2024-01-02" });

    const { validationService } = makeStandardServices();

    // First call: validates batchIdA with key K
    const result1 = await validationService.runValidation(makeUser() as any, makeEffective() as any, {
      importBatchId: batchIdA, idempotencyKey: "va5-conflict-key",
    });
    expect(result1.action).toBe("executed");

    // Capture state after first call
    const findingsAfter1 = (await sql`SELECT count(*)::int AS c FROM import_validation_errors WHERE tenant_id = ${T}`)[0]!.c;
    const auditAfter1 = (await sql`SELECT count(*)::int AS c FROM audit_logs WHERE tenant_id = ${T}`)[0]!.c;
    const idemAfter1 = (await sql`SELECT count(*)::int AS c FROM idempotency_records WHERE tenant_id = ${T}`)[0]!.c;

    // Second call: same key K but different batchIdB → conflict (different request body)
    await expect(
      validationService.runValidation(makeUser() as any, makeEffective() as any, {
        importBatchId: batchIdB, idempotencyKey: "va5-conflict-key", // SAME KEY, DIFFERENT BODY
      }),
    ).rejects.toThrow(/IDEMPOTENCY_CONFLICT|Idempotency key conflict/);

    // Verify zero new effects (no new findings, no new audit, no new idempotency)
    const findingsAfter2 = (await sql`SELECT count(*)::int AS c FROM import_validation_errors WHERE tenant_id = ${T}`)[0]!.c;
    const auditAfter2 = (await sql`SELECT count(*)::int AS c FROM audit_logs WHERE tenant_id = ${T}`)[0]!.c;
    const idemAfter2 = (await sql`SELECT count(*)::int AS c FROM idempotency_records WHERE tenant_id = ${T}`)[0]!.c;

    expect(findingsAfter2).toBe(findingsAfter1);
    expect(auditAfter2).toBe(auditAfter1);
    expect(idemAfter2).toBe(idemAfter1);

    // Verify batchIdB was NOT validated (still staged, no findings)
    const batchB = await sql`SELECT status, validation_status FROM import_batches WHERE id = ${batchIdB}`;
    expect(batchB[0]!.status).toBe("staged");
    expect(batchB[0]!.validation_status).toBeNull();
    const findingsB = (await sql`SELECT count(*)::int AS c FROM import_validation_errors WHERE tenant_id = ${T} AND import_batch_id = ${batchIdB}`)[0]!.c;
    expect(findingsB).toBe(0);
  });

  // ===========================================================================
  // VA-6: Owner-token loss before markSucceeded → full rollback, zero effects
  //
  // Required sequence (per WP-08-01F Milestone C Task 3):
  //   1. owner loss: every business value unchanged, audit delta 0, idempotency not succeeded
  //   2. retry: exactly one final effect set and one scoped audit
  //   3. replay: zero additional effects
  //   4. payload conflict: zero additional effects
  //
  // Asserts exact counts for:
  //   - batch validation_status (before / failure / retry / replay / conflict)
  //   - validation error / finding count
  //   - alias-mapping count
  //   - human-review-item count
  //   - scoped audit count (entity_id + action_type scoped)
  //   - idempotency state
  // ===========================================================================
  it("VA-6. owner-token loss before markSucceeded: full rollback, zero effects", async () => {
    const batchId = randomUUID();
    await seedBatch(batchId, "staged");
    const fileId = randomUUID();
    await sql`INSERT INTO import_files (id, tenant_id, import_batch_id, original_file_name, storage_path, file_hash, file_size_bytes, content_type, file_type, file_version, is_current, created_by, created_at) VALUES (${fileId}, ${T}, ${batchId}, ${"d.csv"}, ${"local://t"}, ${"h"}, 100, ${"text/csv"}, ${"source"}, 1, true, ${U}, NOW())`;
    const rowId = randomUUID();
    await sql`INSERT INTO import_staging_rows (id, tenant_id, import_batch_id, import_file_id, template_name, source_sheet_name, source_row_number, raw_row_json, transformed_row_json, transformation_notes, validation_status, review_status, ai_confidence, committed_entity_type, committed_entity_id, staging_version, is_current, created_by, created_at) VALUES (${rowId}, ${T}, ${batchId}, ${fileId}, ${"t"}, ${"s"}, 1, ${JSON.stringify({ name: "Test", code: "C001", quantity: "100", date: "2024-01-01" })}::jsonb, ${JSON.stringify({ name: "Test", code: "C001", quantity: "100", date: "2024-01-01" })}::jsonb, null, ${"pending"}, ${"not_required"}, null, null, null, 1, true, ${U}, NOW())`;

    // --- BEFORE: capture baseline counts for every business value. ---
    const batchBefore = (await sql`SELECT status, validation_status FROM import_batches WHERE id = ${batchId}`)[0];
    const findingsBefore = (await sql`SELECT count(*)::int AS c FROM import_validation_errors WHERE tenant_id = ${T} AND import_batch_id = ${batchId}`)[0]!.c;
    const aliasBefore = (await sql`SELECT count(*)::int AS c FROM import_alias_mappings WHERE tenant_id = ${T} AND import_batch_id = ${batchId}`)[0]!.c;
    const reviewBefore = (await sql`SELECT count(*)::int AS c FROM import_human_review_items WHERE tenant_id = ${T} AND import_batch_id = ${batchId}`)[0]!.c;
    const auditBefore = (await sql`SELECT count(*)::int AS c FROM audit_logs WHERE tenant_id = ${T} AND entity_id = ${batchId} AND action_type = 'historical_validation.run'`)[0]!.c;
    const idemKey = "va6-owner-loss-" + randomUUID();

    // --- Build a faulty service with REAL owner-token loss at markSucceeded. ---
    // The owner_token is changed in the DB BEFORE the real markSucceeded
    // call. The production fence (WHERE owner_token = expectedOwnerToken
    // AND state = 'in_progress') rejects the stale owner → returns 0 rows
    // → markSucceeded throws IdempotencyOwnershipLostError.
    // We do NOT throw the error manually.
    const valRepo = new HistoricalValidationDbRepository(db);
    const audit = new AuditDbRepository(db);
    const idem = new IdempotencyDbRepository(db);
    const faultyService = new HistoricalValidationService({
      repository: valRepo, audit, idempotency: idem,
      transactionRunner: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
        (db as any).transaction(async (tx: any) => work(tx)),
      createRepository: (tx: unknown) => new HistoricalValidationDbRepository(tx as any),
      createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
      createIdempotency: (tx: unknown) => {
        // Wrap the real idempotency repo to change owner_token before
        // the real updateState call.
        const realIdem = new IdempotencyDbRepository(tx as any);
        return {
          findByTenantScopeKey: (t: string, s: string, k: string) => realIdem.findByTenantScopeKey(t, s, k),
          insert: (r: any) => realIdem.insert(r),
          claimExpiredLease: (id: string, a: Date, b: Date, c: Date) => realIdem.claimExpiredLease(id, a, b, c),
          heartbeat: (id: string, n: Date) => realIdem.heartbeat(id, n),
          updateState: async (id: string, update: any) => {
            // Change owner_token BEFORE the real fenced UPDATE.
            const newToken = 'stale-' + randomUUID();
            await (tx as any).execute(drizzleSql`UPDATE idempotency_records SET owner_token = ${newToken} WHERE id = ${id}`);
            // Delegate to the REAL updateState — the production fence.
            return realIdem.updateState(id, update);
          },
        } as any;
      },
    });

    // --- (1) OWNER LOSS: every business value unchanged, audit delta 0, idempotency not succeeded. ---
    await expect(
      faultyService.runValidation(makeUser() as any, makeEffective() as any, {
        importBatchId: batchId, idempotencyKey: idemKey,
      }),
    ).rejects.toThrow();

    // Verify rollback: batch status unchanged.
    const batchAfter = (await sql`SELECT status, validation_status FROM import_batches WHERE id = ${batchId}`)[0];
    expect(batchAfter!.status).toBe(batchBefore!.status);                       // L519-520
    expect(batchAfter!.validation_status).toBe(batchBefore!.validation_status);

    // Verify rollback: findings count unchanged.
    const findingsAfter = (await sql`SELECT count(*)::int AS c FROM import_validation_errors WHERE tenant_id = ${T} AND import_batch_id = ${batchId}`)[0]!.c;
    expect(findingsAfter).toBe(findingsBefore);                                  // L523

    // Verify rollback: alias-mapping count unchanged (delta = 0).
    const aliasAfter = (await sql`SELECT count(*)::int AS c FROM import_alias_mappings WHERE tenant_id = ${T} AND import_batch_id = ${batchId}`)[0]!.c;
    expect(aliasAfter).toBe(aliasBefore);

    // Verify rollback: human-review-item count unchanged (delta = 0).
    const reviewAfter = (await sql`SELECT count(*)::int AS c FROM import_human_review_items WHERE tenant_id = ${T} AND import_batch_id = ${batchId}`)[0]!.c;
    expect(reviewAfter).toBe(reviewBefore);

    // Verify rollback: scoped audit count unchanged (delta = 0).
    const auditAfter = (await sql`SELECT count(*)::int AS c FROM audit_logs WHERE tenant_id = ${T} AND entity_id = ${batchId} AND action_type = 'historical_validation.run'`)[0]!.c;
    expect(auditAfter).toBe(auditBefore);                                        // L526

    // Idempotency state: not succeeded (in_progress or failed).
    const idemRecord = await sql`SELECT state FROM idempotency_records WHERE tenant_id = ${T} AND idempotency_key = ${idemKey}`;
    if (idemRecord.length > 0) {
      expect(idemRecord[0]!.state).not.toBe("succeeded");                       // L531
    }

    // --- Expire lease for retry. ---
    await sql`UPDATE idempotency_records SET lease_expires_at = NOW() - interval '1 second' WHERE tenant_id = ${T} AND idempotency_key = ${idemKey}`;

    // --- (2) RETRY: exactly one final effect set and one scoped audit. ---
    const goodService = new HistoricalValidationService({
      repository: valRepo, audit, idempotency: idem,
      transactionRunner: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => (db as any).transaction(async (tx: any) => work(tx)),
      createRepository: (tx: unknown) => new HistoricalValidationDbRepository(tx as any),
      createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
      createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
    });
    const retryResult = await goodService.runValidation(makeUser() as any, makeEffective() as any, {
      importBatchId: batchId, idempotencyKey: idemKey,
    });
    expect(retryResult.action).toBe("executed");                                 // L548

    // Retry: exactly one new scoped audit row.
    const auditAfterRetry = (await sql`SELECT count(*)::int AS c FROM audit_logs WHERE tenant_id = ${T} AND entity_id = ${batchId} AND action_type = 'historical_validation.run'`)[0]!.c;
    expect(auditAfterRetry).toBe(auditBefore + 1);                               // L551

    // Retry: idempotency state = succeeded.
    const idemAfterRetry = await sql`SELECT state FROM idempotency_records WHERE tenant_id = ${T} AND idempotency_key = ${idemKey}`;
    expect(idemAfterRetry[0]!.state).toBe("succeeded");

    // Retry: exactly one final effect set — findings, aliases, review items
    // are exact integers (validation completed and persisted findings/aliases/review items).
    const findingsAfterRetry = (await sql`SELECT count(*)::int AS c FROM import_validation_errors WHERE tenant_id = ${T} AND import_batch_id = ${batchId}`)[0]!.c;
    const aliasAfterRetry = (await sql`SELECT count(*)::int AS c FROM import_alias_mappings WHERE tenant_id = ${T} AND import_batch_id = ${batchId}`)[0]!.c;
    const reviewAfterRetry = (await sql`SELECT count(*)::int AS c FROM import_human_review_items WHERE tenant_id = ${T} AND import_batch_id = ${batchId}`)[0]!.c;
    // The seeded staging row { name: "Test", code: "C001", quantity: "100", date: "2024-01-01" }
    // produces deterministic validation outputs:
    //   - 3 findings (validation rules produce 3 findings for this row's field set)
    //   - 1 alias mapping (the row has a `name` field → customer master candidate)
    //   - 1 human review item (all candidates require human review per Contract 08 §8.4)
    expect(findingsAfterRetry).toBe(3);
    expect(aliasAfterRetry).toBe(1);
    expect(reviewAfterRetry).toBe(1);

    // --- (3) REPLAY: zero additional effects. ---
    const replayResult = await goodService.runValidation(makeUser() as any, makeEffective() as any, {
      importBatchId: batchId, idempotencyKey: idemKey,
    });
    expect(replayResult.action).toBe("replayed");                               // L557

    // Replay: zero new audit rows.
    const auditAfterReplay = (await sql`SELECT count(*)::int AS c FROM audit_logs WHERE tenant_id = ${T} AND entity_id = ${batchId} AND action_type = 'historical_validation.run'`)[0]!.c;
    expect(auditAfterReplay).toBe(auditAfterRetry);                             // L560

    // Replay: zero new findings, alias mappings, or review items.
    const findingsAfterReplay = (await sql`SELECT count(*)::int AS c FROM import_validation_errors WHERE tenant_id = ${T} AND import_batch_id = ${batchId}`)[0]!.c;
    const aliasAfterReplay = (await sql`SELECT count(*)::int AS c FROM import_alias_mappings WHERE tenant_id = ${T} AND import_batch_id = ${batchId}`)[0]!.c;
    const reviewAfterReplay = (await sql`SELECT count(*)::int AS c FROM import_human_review_items WHERE tenant_id = ${T} AND import_batch_id = ${batchId}`)[0]!.c;
    expect(findingsAfterReplay).toBe(findingsAfterRetry);
    expect(aliasAfterReplay).toBe(aliasAfterRetry);
    expect(reviewAfterReplay).toBe(reviewAfterRetry);

    // --- (4) PAYLOAD CONFLICT: zero additional effects. ---
    // Same idempotency key, DIFFERENT request body (different importBatchId).
    // The service should reject this as IDEMPOTENCY_CONFLICT, and no new
    // business effects (findings, aliases, review items, audits) should appear.
    const otherBatchId = randomUUID();
    await seedBatch(otherBatchId, "staged");
    const otherFileId = randomUUID();
    await sql`INSERT INTO import_files (id, tenant_id, import_batch_id, original_file_name, storage_path, file_hash, file_size_bytes, content_type, file_type, file_version, is_current, created_by, created_at) VALUES (${otherFileId}, ${T}, ${otherBatchId}, ${"d2.csv"}, ${"local://t"}, ${"h"}, 100, ${"text/csv"}, ${"source"}, 1, true, ${U}, NOW())`;
    const otherRowId = randomUUID();
    await sql`INSERT INTO import_staging_rows (id, tenant_id, import_batch_id, import_file_id, template_name, source_sheet_name, source_row_number, raw_row_json, transformed_row_json, transformation_notes, validation_status, review_status, ai_confidence, committed_entity_type, committed_entity_id, staging_version, is_current, created_by, created_at) VALUES (${otherRowId}, ${T}, ${otherBatchId}, ${otherFileId}, ${"t"}, ${"s"}, 1, ${JSON.stringify({ name: "OtherTest", code: "C002", quantity: "200", date: "2024-01-02" })}::jsonb, ${JSON.stringify({ name: "OtherTest", code: "C002", quantity: "200", date: "2024-01-02" })}::jsonb, null, ${"pending"}, ${"not_required"}, null, null, null, 1, true, ${U}, NOW())`;

    await expect(
      goodService.runValidation(makeUser() as any, makeEffective() as any, {
        importBatchId: otherBatchId, idempotencyKey: idemKey,
      }),
    ).rejects.toThrow(/IDEMPOTENCY_CONFLICT|conflict/i);

    // Conflict: zero additional effects on the ORIGINAL batch.
    const findingsAfterConflict = (await sql`SELECT count(*)::int AS c FROM import_validation_errors WHERE tenant_id = ${T} AND import_batch_id = ${batchId}`)[0]!.c;
    const aliasAfterConflict = (await sql`SELECT count(*)::int AS c FROM import_alias_mappings WHERE tenant_id = ${T} AND import_batch_id = ${batchId}`)[0]!.c;
    const reviewAfterConflict = (await sql`SELECT count(*)::int AS c FROM import_human_review_items WHERE tenant_id = ${T} AND import_batch_id = ${batchId}`)[0]!.c;
    const auditAfterConflict = (await sql`SELECT count(*)::int AS c FROM audit_logs WHERE tenant_id = ${T} AND entity_id = ${batchId} AND action_type = 'historical_validation.run'`)[0]!.c;
    expect(findingsAfterConflict).toBe(findingsAfterReplay);
    expect(aliasAfterConflict).toBe(aliasAfterReplay);
    expect(reviewAfterConflict).toBe(reviewAfterReplay);
    expect(auditAfterConflict).toBe(auditAfterReplay);

    // Conflict: zero additional effects on the OTHER batch too — the conflict
    // is rejected before any business write is committed.
    const otherFindings = (await sql`SELECT count(*)::int AS c FROM import_validation_errors WHERE tenant_id = ${T} AND import_batch_id = ${otherBatchId}`)[0]!.c;
    const otherAlias = (await sql`SELECT count(*)::int AS c FROM import_alias_mappings WHERE tenant_id = ${T} AND import_batch_id = ${otherBatchId}`)[0]!.c;
    const otherReview = (await sql`SELECT count(*)::int AS c FROM import_human_review_items WHERE tenant_id = ${T} AND import_batch_id = ${otherBatchId}`)[0]!.c;
    const otherAudit = (await sql`SELECT count(*)::int AS c FROM audit_logs WHERE tenant_id = ${T} AND entity_id = ${otherBatchId} AND action_type = 'historical_validation.run'`)[0]!.c;
    expect(otherFindings).toBe(0);
    expect(otherAlias).toBe(0);
    expect(otherReview).toBe(0);
    expect(otherAudit).toBe(0);
  });
});
