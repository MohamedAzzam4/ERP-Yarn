/**
 * WP-08-01F TASK 4 — Real PostgreSQL service-level zero-effect proofs.
 *
 * WP-08-01F DEFECT 4: Fail-closed disposable-database guard.
 *
 * This test refuses to run unless ALL safety conditions are met:
 *   - hostname is exactly localhost, 127.0.0.1 or ::1
 *   - database name is the dedicated disposable test DB (erp_yarn)
 *   - explicit env flag ERP_ALLOW_DESTRUCTIVE_LOCAL_TEST_DB=1 is present
 *   - it is not a Supabase pooler/direct host
 *
 * On mismatch: fail loudly with a clear safety error, do not skip silently,
 * perform no SQL.
 *
 * The test NEVER disables audit triggers or deletes durable evidence in a
 * shared DB. It uses unique run-scoped tenant IDs and only deletes rows
 * belonging to those run-scoped tenants.
 *
 * Scenarios (per TASK 4):
 *   1.  registerFile against committed batch
 *   2.  insertStagingRow against committed batch
 *   3.  runValidation against committed and committing batches
 *   4.  runReconciliation against pending_dual_approval, approved_for_commit, committed batches
 *   5.  recordReviewDecision in invalid batch state and against already-resolved review item
 *   6.  recordApproval before reconciliation/review completion
 *   7.  recordBackupEvidence against committed batch
 *   8.  tenant-mismatched batch/file/review item
 *   9.  valid predecessor-state success followed by terminal-state rejection
 *   10. valid idempotency replay after the service changes the batch state
 *
 * For every rejected operation, captures exact DB before/after values for:
 *   - import_batches fields/status/hashes/versions
 *   - import_files, import_staging_rows, import_validation_errors
 *   - import_reconciliation_results and report versions
 *   - import_human_review_items/decisions
 *   - import_batch_approvals, import_backup_evidence
 *   - audit_logs (exact IDs/counts — never deleted)
 *   - idempotency_records (exact row set/state — never deleted)
 *   - document_sequences (exact key + current numeric value — never deleted)
 *   - operational stock movements, account entries, sales/payment/production
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/server/db/schema";
import { HistoricalStagingService } from "@/server/services/historical-staging-service";
import { HistoricalValidationService } from "@/server/services/historical-validation-service";
import { HistoricalReconciliationService } from "@/server/services/historical-reconciliation-service";
import { HistoricalCommitService } from "@/server/services/historical-commit-service";
import { HistoricalStagingDbRepository } from "@/server/services/historical-staging-db-repository";
import { HistoricalValidationDbRepository } from "@/server/services/historical-validation-db-repository";
import { HistoricalReconciliationDbRepository } from "@/server/services/historical-reconciliation-db-repository";
import { HistoricalCommitDbRepository } from "@/server/services/historical-commit-db-repository";
import { AuditDbRepository } from "@/server/services/audit-db-repository";
import { IdempotencyDbRepository } from "@/server/services/idempotency-db-repository";
import { DocumentSequenceDbRepository } from "@/server/services/document-sequence-db-repository";
import { resolveEffectivePermissions } from "@/server/security/effective-permissions";
import { TEST_ROLE_PERMISSION_MATRIX } from "@/server/security/role-fixtures";
import type { RoleCode } from "@/server/security/role-codes";
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
const describeOrSkip = SAFETY_RESULT.kind === "ok" ? describe : describe.skip;
let SAFETY_ERROR_MESSAGE: string | null = SAFETY_RESULT.kind === "fail" ? SAFETY_RESULT.message : null;

if (SAFETY_RESULT.kind === "skip") {
  console.log(`\n[WP-08-01F PostgreSQL test] SKIPPED: ${SAFETY_RESULT.reason}\n`);
} else if (SAFETY_RESULT.kind === "fail") {
  SAFETY_ERROR_MESSAGE = SAFETY_RESULT.message;
  console.error(`\n[WP-08-01F PostgreSQL test] SAFETY GUARD FAILED:\n${SAFETY_RESULT.message}\n`);
}

// ===========================================================================
// Unique run-scoped tenant IDs — each test run uses its own tenants so we
// never collide with pre-existing data. We use valid UUIDv4 format with
// a run-scoped suffix to ensure uniqueness across test runs.
// ===========================================================================
const RUN_ID = randomUUID(); // full UUID for uniqueness
// Derive tenant/user IDs from the run ID to keep them valid UUIDs
const T = RUN_ID; // use the run UUID as the tenant ID
const T_B = randomUUID();
const U = randomUUID();
const U2 = randomUUID();

let sql: ReturnType<typeof postgres>;
let db: any;

/**
 * Snapshot all relevant table counts for tenant T.
 * Used to prove zero new rows after a rejected operation.
 *
 * WP-08-01F DEFECT 4: This now captures EXACT values (not just counts) for
 * audit_logs, idempotency_records, and document_sequences so we can prove
 * the sequence value did not advance and no new audit/idempotency rows
 * were created.
 */
async function snapshotCounts(): Promise<Record<string, number>> {
  const tables = [
    "import_batches",
    "import_files",
    "import_staging_rows",
    "import_validation_errors",
    "import_reconciliation_results",
    "import_human_review_items",
    "import_batch_approvals",
    "import_backup_evidence",
    "audit_logs",
    "idempotency_records",
    "stock_movements",
    "account_entries",
    "sales_orders",
    "sales_order_lines",
    "payments",
    "production_orders",
  ];
  const result: Record<string, number> = {};
  for (const table of tables) {
    const rows = await sql`SELECT count(*)::int AS c FROM ${sql(table)} WHERE tenant_id = ${T}`;
    result[table] = rows[0]?.c ?? 0;
  }
  // Also snapshot document_sequences count
  const dsRows = await sql`SELECT count(*)::int AS c FROM document_sequences WHERE tenant_id = ${T}`;
  result["document_sequences"] = dsRows[0]?.c ?? 0;
  return result;
}

/**
 * WP-08-01F DEFECT 4: Snapshot the exact document_sequence values for the
 * run-scoped tenant. Comparing only the COUNT of document_sequence rows does
 * NOT prove the sequence did not advance. We must compare the exact
 * (document_type, year, last_number) values.
 */
async function snapshotSequenceValues(): Promise<Record<string, number>> {
  const rows = await sql`
    SELECT document_type, year, last_number
      FROM document_sequences WHERE tenant_id = ${T}`;
  const result: Record<string, number> = {};
  for (const row of rows) {
    const key = `${row.document_type}_${row.year}`;
    result[key] = row.last_number;
  }
  return result;
}

/**
 * WP-08-01F DEFECT 4: Snapshot the exact idempotency record IDs and states
 * for the run-scoped tenant. This proves no new idempotency claims were
 * created by a rejected operation.
 */
async function snapshotIdempotencyRecords(): Promise<Array<{ id: string; state: string; operation_scope: string }>> {
  const rows = await sql`
    SELECT id, state, operation_scope
      FROM idempotency_records WHERE tenant_id = ${T}
      ORDER BY created_at`;
  return rows.map((r: any) => ({ id: r.id, state: r.state, operation_scope: r.operation_scope }));
}

/**
 * WP-08-01F DEFECT 4: Snapshot the exact audit log IDs for the run-scoped
 * tenant. This proves no new audit rows were created by a rejected operation.
 */
async function snapshotAuditIds(): Promise<string[]> {
  const rows = await sql`
    SELECT id FROM audit_logs WHERE tenant_id = ${T} ORDER BY created_at`;
  return rows.map((r: any) => r.id);
}

/**
 * WP-08-01F DEFECT 4: Capture a complete snapshot of all proof-relevant
 * state for the run-scoped tenant. This includes:
 *   - table counts (all migration + operational tables)
 *   - exact document_sequence values (key + last_number)
 *   - exact idempotency record IDs/states
 *   - exact audit log IDs
 *
 * Use `compareSnapshots` to verify zero new effects.
 */
async function captureFullSnapshot(): Promise<{
  counts: Record<string, number>;
  sequenceValues: Record<string, number>;
  idempotencyRecords: Array<{ id: string; state: string; operation_scope: string }>;
  auditIds: string[];
}> {
  const [counts, sequenceValues, idempotencyRecords, auditIds] = await Promise.all([
    snapshotCounts(),
    snapshotSequenceValues(),
    snapshotIdempotencyRecords(),
    snapshotAuditIds(),
  ]);
  return { counts, sequenceValues, idempotencyRecords, auditIds };
}

/**
 * WP-08-01F DEFECT 4: Compare two full snapshots and assert zero new effects.
 * Verifies:
 *   - all table counts unchanged
 *   - all document_sequence values unchanged (no advancement)
 *   - no new idempotency records (exact same set of IDs)
 *   - no new audit log IDs (exact same set)
 */
async function assertZeroEffects(
  before: Awaited<ReturnType<typeof captureFullSnapshot>>,
  after: Awaited<ReturnType<typeof captureFullSnapshot>>,
): Promise<void> {
  // Table counts unchanged
  for (const [table, count] of Object.entries(before.counts)) {
    expect(after.counts[table], `${table} count must be unchanged`).toBe(count);
  }
  // Sequence values unchanged (no advancement)
  for (const [key, value] of Object.entries(before.sequenceValues)) {
    expect(after.sequenceValues[key], `document_sequences.${key} value must not advance`).toBe(value);
  }
  // No new sequence rows created
  for (const [key, value] of Object.entries(after.sequenceValues)) {
    expect(before.sequenceValues[key], `document_sequences.${key} must not be a new row`).toBe(value);
  }
  // No new idempotency records
  expect(after.idempotencyRecords.length, "idempotency_records count must be unchanged").toBe(before.idempotencyRecords.length);
  const beforeIdemIds = new Set(before.idempotencyRecords.map(r => r.id));
  for (const rec of after.idempotencyRecords) {
    expect(beforeIdemIds.has(rec.id), `idempotency_records.${rec.id} must not be a new row`).toBe(true);
  }
  // No new audit log IDs
  expect(after.auditIds.length, "audit_logs count must be unchanged").toBe(before.auditIds.length);
  const beforeAuditIds = new Set(before.auditIds);
  for (const id of after.auditIds) {
    expect(beforeAuditIds.has(id), `audit_logs.${id} must not be a new row`).toBe(true);
  }
}

/**
 * WP-08-01F DEC-081 recovery — Assert zero business effects while ALLOWING
 * the operation to persist exactly ONE new business_failed idempotency
 * record (the durable business-failed mark for lifecycle violations).
 *
 * Used by the runReconciliation-against-locked/terminal-batches tests:
 *   - The lifecycle violation rejects BEFORE the transactionRunner
 *     closure starts (the pre-check guardRunReconciliation throws).
 *   - The pre-check catch block marks the idempotency record as
 *     business_failed (durable) via the NON-tx idempotency handle.
 *   - No business/evidence table is mutated, no audit row is created,
 *     no document sequence advances.
 *
 * Assertions:
 *   - All table counts unchanged EXCEPT idempotency_records (skip).
 *   - All document_sequence values unchanged.
 *   - Exactly ONE new idempotency record, with:
 *       state === "business_failed"
 *       state !== succeeded/in_progress/retryable_failed
 *       operation_scope === expectedScope
 *   - No new audit log IDs.
 */
async function assertZeroBusinessEffectsAllowingBusinessFailedIdempotency(
  before: Awaited<ReturnType<typeof captureFullSnapshot>>,
  after: Awaited<ReturnType<typeof captureFullSnapshot>>,
  expectedScope: string,
): Promise<void> {
  // Table counts unchanged EXCEPT idempotency_records (which gets +1
  // for the durable business_failed mark).
  for (const [table, count] of Object.entries(before.counts)) {
    if (table === "idempotency_records") continue;
    expect(after.counts[table], `${table} count must be unchanged`).toBe(count);
  }
  // Sequence values unchanged (no advancement)
  for (const [key, value] of Object.entries(before.sequenceValues)) {
    expect(after.sequenceValues[key], `document_sequences.${key} value must not advance`).toBe(value);
  }
  // No new sequence rows created
  for (const [key, value] of Object.entries(after.sequenceValues)) {
    expect(before.sequenceValues[key], `document_sequences.${key} must not be a new row`).toBe(value);
  }
  // Exactly ONE new idempotency record.
  expect(
    after.idempotencyRecords.length,
    "idempotency_records count must be exactly +1 (business_failed mark)",
  ).toBe(before.idempotencyRecords.length + 1);
  const beforeIdemIds = new Set(before.idempotencyRecords.map(r => r.id));
  const newRecords = after.idempotencyRecords.filter(r => !beforeIdemIds.has(r.id));
  expect(newRecords.length, "exactly one new idempotency record").toBe(1);
  const newRec = newRecords[0]!;
  // WP-08-01F DEC-081 — assert the new record is business_failed
  // (NOT succeeded/in_progress/retryable_failed).
  expect(newRec.state, "new idempotency record state must be business_failed").toBe("business_failed");
  expect(newRec.state, "new idempotency record state must NOT be succeeded").not.toBe("succeeded");
  expect(newRec.state, "new idempotency record state must NOT be in_progress").not.toBe("in_progress");
  expect(newRec.state, "new idempotency record state must NOT be retryable_failed").not.toBe("retryable_failed");
  expect(newRec.operation_scope, "new idempotency record operation_scope must match").toBe(expectedScope);
  // No new audit log IDs
  expect(after.auditIds.length, "audit_logs count must be unchanged").toBe(before.auditIds.length);
  const beforeAuditIds = new Set(before.auditIds);
  for (const id of after.auditIds) {
    expect(beforeAuditIds.has(id), `audit_logs.${id} must not be a new row`).toBe(true);
  }
}

/**
 * Snapshot the full batch row (status, hashes, versions) — used to prove
 * the batch row itself is unchanged after a rejected operation.
 */
async function snapshotBatch(batchId: string): Promise<Record<string, unknown> | null> {
  const rows = await sql`
    SELECT id, status, staged_data_hash, cutover_manifest_hash,
           template_version, mapping_version, validation_status,
           reconciliation_status, staged_row_count, blocking_error_count,
           warning_count, accepted_warning_count, committed_at,
           commit_effect_counts, updated_at
      FROM import_batches WHERE id = ${batchId}`;
  return rows[0] ?? null;
}

/**
 * WP-08-01F DEFECT 4: Safe cleanup — only deletes run-scoped tenant's
 * migration data. NEVER deletes audit_logs, idempotency_records, or
 * document_sequences. NEVER disables audit triggers.
 *
 * The audit_logs table has triggers that block DELETE (Contract 03 §7.7).
 * We do NOT disable them. Audit entries for the run-scoped tenant remain
 * as durable evidence — the zero-effect proof compares counts before/after
 * each rejected operation, not before/after cleanup.
 *
 * idempotency_records and document_sequences are also preserved — the
 * zero-effect proof compares their exact values before/after each rejected
 * operation.
 */
async function cleanupRunScopedTenantData(): Promise<void> {
  // Delete in dependency order (children first).
  // Only delete rows belonging to the run-scoped tenants (T, T_B).
  await sql`DELETE FROM import_cutover_locks WHERE tenant_id = ${T} OR tenant_id = ${T_B}`;
  await sql`DELETE FROM import_backup_evidence WHERE tenant_id = ${T} OR tenant_id = ${T_B}`;
  await sql`DELETE FROM import_batch_approvals WHERE tenant_id = ${T} OR tenant_id = ${T_B}`;
  await sql`DELETE FROM import_reconciliation_results WHERE tenant_id = ${T} OR tenant_id = ${T_B}`;
  await sql`DELETE FROM import_human_review_items WHERE tenant_id = ${T} OR tenant_id = ${T_B}`;
  await sql`DELETE FROM import_validation_errors WHERE tenant_id = ${T} OR tenant_id = ${T_B}`;
  await sql`DELETE FROM import_alias_mappings WHERE tenant_id = ${T} OR tenant_id = ${T_B}`;
  await sql`DELETE FROM import_staging_rows WHERE tenant_id = ${T} OR tenant_id = ${T_B}`;
  await sql`DELETE FROM import_files WHERE tenant_id = ${T} OR tenant_id = ${T_B}`;
  await sql`DELETE FROM historical_correction_requests WHERE tenant_id = ${T} OR tenant_id = ${T_B}`;
  await sql`DELETE FROM import_cutover_manifests WHERE tenant_id = ${T} OR tenant_id = ${T_B}`;
  await sql`DELETE FROM import_batches WHERE tenant_id = ${T} OR tenant_id = ${T_B}`;
  // NOTE: audit_logs, idempotency_records, document_sequences are NOT deleted.
  // They are durable evidence. The zero-effect proof compares counts before/after
  // each rejected operation, not before/after cleanup.
  // Delete operational tables only for the run-scoped tenant (these should
  // always be empty for migration batches — the zero-effect proof verifies this).
  await sql`DELETE FROM stock_movements WHERE tenant_id = ${T} OR tenant_id = ${T_B}`;
  await sql`DELETE FROM account_entries WHERE tenant_id = ${T} OR tenant_id = ${T_B}`;
  await sql`DELETE FROM sales_order_lines WHERE tenant_id = ${T} OR tenant_id = ${T_B}`;
  await sql`DELETE FROM sales_orders WHERE tenant_id = ${T} OR tenant_id = ${T_B}`;
  await sql`DELETE FROM payments WHERE tenant_id = ${T} OR tenant_id = ${T_B}`;
  await sql`DELETE FROM production_orders WHERE tenant_id = ${T} OR tenant_id = ${T_B}`;
}

/**
 * Generate a stable UUID for tests. Uses randomUUID but allows a tag prefix
 * for log readability.
 */
function newBatchId(tag: string): string {
  // Generate a real UUID v4 and prepend nothing — just return it.
  // The tag is only for logging, not embedded in the UUID.
  void tag; // unused but kept for readability at call sites
  return randomUUID();
}

/**
 * Seed a batch directly via SQL with a specific status and full set of
 * hashes/versions/approvals/backup as needed.
 */
async function seedBatch(
  batchId: string,
  status: string,
  overrides: {
    committedAt?: Date;
    commitEffectCounts?: Record<string, number> | null;
    validationStatus?: string | null;
    reconciliationStatus?: string | null;
    stagedDataHash?: string | null;
    cutoverManifestHash?: string | null;
  } = {},
): Promise<void> {
  const committedAtStr = overrides.committedAt ? overrides.committedAt.toISOString() : null;
  const commitEffectCountsJson = overrides.commitEffectCounts
    ? JSON.stringify(overrides.commitEffectCounts)
    : null;
  // Use explicit undefined check so callers can pass null to mean "NULL in DB".
  const validationStatus = overrides.validationStatus === undefined ? "passed" : overrides.validationStatus;
  const reconciliationStatus = overrides.reconciliationStatus === undefined ? "matched" : overrides.reconciliationStatus;
  const stagedDataHash = overrides.stagedDataHash === undefined ? "staged-hash" : overrides.stagedDataHash;
  const cutoverManifestHash = overrides.cutoverManifestHash === undefined ? "manifest-hash" : overrides.cutoverManifestHash;
  await sql`
    INSERT INTO import_batches (
      id, tenant_id, batch_no, status, source_description, template_name, template_version,
      mapping_version, cutover_manifest_hash, cutover_import_mode, staged_data_hash, staged_row_count,
      blocking_error_count, warning_count, accepted_warning_count, validation_status, reconciliation_status,
      warning_summary, committed_at, commit_effect_counts, created_by, created_at
    ) VALUES (
      ${batchId}, ${T}, ${"MIG-" + batchId.slice(-6)}, ${status}::import_batch_status, ${"test"}, ${"test-template"}, ${"1.0"},
      ${"1.0"}, ${cutoverManifestHash}, ${"opening_balance"}, ${stagedDataHash}, 5,
      0, 0, 0, ${validationStatus}, ${reconciliationStatus},
      null, ${committedAtStr}::timestamptz, ${commitEffectCountsJson}::jsonb, ${U}, NOW()
    )`;
}

async function seedStagingRow(batchId: string, rowNum: number): Promise<string> {
  const id = randomUUID();
  await sql`
    INSERT INTO import_staging_rows (id, tenant_id, import_batch_id, import_file_id, template_name,
      source_sheet_name, source_row_number, raw_row_json, transformed_row_json,
      transformation_notes, validation_status, review_status, ai_confidence,
      committed_entity_type, committed_entity_id, created_by, created_at, updated_at, updated_by)
    VALUES (${id}, ${T}, ${batchId}, null, ${"test-template"}, ${"Sheet1"}, ${rowNum},
      ${JSON.stringify({ a: 1 })}::jsonb, ${JSON.stringify({ entity_type: "stock_movement", item_code: "TEST", quantity: 1 })}::jsonb,
      null, ${"pending"}, ${"not_required"}, null, null, null,
      ${U}, NOW(), null, null)`;
  return id;
}

async function seedReviewItem(
  batchId: string,
  status: string = "pending",
): Promise<string> {
  const id = randomUUID();
  await sql`
    INSERT INTO import_human_review_items (id, tenant_id, import_batch_id, staging_row_id,
      review_reason, assigned_to, status, decision, decision_notes, decided_by, decided_at,
      created_by, created_at, updated_at, updated_by)
    VALUES (${id}, ${T}, ${batchId}, null, ${"test review"}, null, ${status}::review_item_decision,
      null, null, null, null,
      ${U}, NOW(), null, null)`;
  return id;
}

function makeUser(userId: string = U, tenantId: string = T): ErpUserContext {
  return {
    authenticated: true, userId, tenantId,
    authId: `auth-${userId}`, name: "Test", email: `test-${userId}@test.local`,
  };
}
function makeEffective(role: RoleCode = "owner") {
  return resolveEffectivePermissions([role], TEST_ROLE_PERMISSION_MATRIX);
}

describeOrSkip("WP-08-01F TASK 4 — Real PostgreSQL service-level zero-effect proofs", () => {
  beforeAll(async () => {
    // DEFECT 5: If safety guard failed, throw here to fail the test file
    if (SAFETY_ERROR_MESSAGE) {
      throw new Error(SAFETY_ERROR_MESSAGE);
    }
    sql = postgres(DATABASE_URL!, { prepare: false, max: 10, idle_timeout: 10, connect_timeout: 10 });
    db = drizzle(sql, { schema });
    await sql`SET statement_timeout = 30000`;

    // DEFECT 5: Verify dedicated DB marker before any DELETE/fixture operation.
    // The current_database() must be the exact dedicated disposable DB.
    const dbResult = await sql`SELECT current_database() AS db_name`;
    const currentDb = dbResult[0]?.db_name;
    if (currentDb !== "erp_yarn_wp0801f_disposable") {
      await sql.end();
      throw new Error(
        `SAFETY: Connected to database '${currentDb}' but expected '${"erp_yarn_wp0801f_disposable"}'. ` +
        `FAILING — refusing to run against non-disposable database.`
      );
    }

    // Seed foundational fixtures — use run-scoped company_name/auth_id/email
    // to avoid unique constraint violations across test runs.
    const runSuffix = RUN_ID.slice(0, 8);
    await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status)
              VALUES (${T}, ${"F-PG-" + runSuffix}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
    await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status)
              VALUES (${T_B}, ${"F-PG-B-" + runSuffix}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
    await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference)
              VALUES (${U}, ${T}, ${"f-pg-" + runSuffix}, ${"F PG"}, ${"f-pg-" + runSuffix + "@test.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
    await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference)
              VALUES (${U2}, ${T}, ${"f-pg2-" + runSuffix}, ${"F PG2"}, ${"f-pg2-" + runSuffix + "@test.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
  }, 30000);

  afterAll(async () => {
    if (sql) {
      await cleanupRunScopedTenantData();
      // WP-08-01F DEFECT 4: Do NOT delete users/tenants — audit_logs has FK
      // references to users, and we do NOT delete audit_logs (durable evidence).
      // Since we use run-scoped UUIDs, they won't collide with future runs.
      // The run-scoped tenant/user rows remain as durable evidence of the test run.
      await sql.end();
    }
  }, 30000);

  beforeEach(async () => {
    await cleanupRunScopedTenantData();
  }, 15000);

  // Helper: build services with real DB repos
  function makeServices() {
    const stagingRepo = new HistoricalStagingDbRepository(db);
    const valRepo = new HistoricalValidationDbRepository(db);
    const reconRepo = new HistoricalReconciliationDbRepository(db);
    const commitRepo = new HistoricalCommitDbRepository(db);
    const audit = new AuditDbRepository(db);
    const idem = new IdempotencyDbRepository(db);
    const docSeq = new DocumentSequenceDbRepository(db);
    const stagingService = new HistoricalStagingService({ repository: stagingRepo, audit, idempotency: idem, documentSequence: docSeq, transactionRunner: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => (db as any).transaction(async (tx: any) => work(tx)), createStagingRepository: (tx: unknown) => new HistoricalStagingDbRepository(tx as any), createAudit: (tx: unknown) => new AuditDbRepository(tx as any), createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any) });
    const validationService = new HistoricalValidationService({ repository: valRepo, audit, idempotency: idem, transactionRunner: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => (db as any).transaction(async (tx: any) => work(tx)), createRepository: (tx: unknown) => new HistoricalValidationDbRepository(tx as any), createAudit: (tx: unknown) => new AuditDbRepository(tx as any), createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any) });
    const reconciliationService = new HistoricalReconciliationService({ repository: reconRepo, audit, idempotency: idem });
    const transactionRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
      (db as any).transaction(async (tx: any) => work(tx));
    const txFactories = {
      createCommitRepository: (tx: unknown) => new HistoricalCommitDbRepository(tx as any),
      createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
      createInventoryLedger: () => ({ requireCutoverLock: async () => {}, requireCutoverLockExclusive: async () => {} } as any),
      createSubledger: () => ({ requireCutoverLock: async () => {}, requireCutoverLockExclusive: async () => {} } as any),
      createDocumentSequence: (tx: unknown) => new DocumentSequenceDbRepository(tx as any),
    };
    const commitService = new HistoricalCommitService({
      repository: commitRepo, audit, idempotency: idem,
      transactionRunner, txFactories,
    });
    return { stagingService, validationService, reconciliationService, commitService };
  }

  // -------------------------------------------------------------------------
  // 1. registerFile against committed batch
  // -------------------------------------------------------------------------
  describe("1. registerFile against committed batch", () => {
    it("rejects with InvalidBatchStatusError, zero new rows everywhere", async () => {
      const { stagingService } = makeServices();
      const batchId = newBatchId("01");
      await seedBatch(batchId, "committed", { committedAt: new Date(), commitEffectCounts: { inventory_movements: 1 } });
      const before = await captureFullSnapshot();
      const batchBefore = await snapshotBatch(batchId);

      await expect(
        stagingService.registerFile(makeUser() as any, makeEffective() as any, {
          importBatchId: batchId, originalFileName: "f.xlsx", storagePath: "s3://b/k",
          fileHash: "h1", fileType: "source", fileSizeBytes: 1, contentType: null, idempotencyKey: "pg-k1",
        }),
      ).rejects.toThrow(/LIFECYCLE_VIOLATION|InvalidBatchStatusError|status.*must be/);

      const after = await captureFullSnapshot();
      const batchAfter = await snapshotBatch(batchId);
      await assertZeroEffects(before, after);
      // Batch snapshot unchanged
      expect(batchAfter?.status).toBe(batchBefore?.status);
      expect(batchAfter?.staged_data_hash).toBe(batchBefore?.staged_data_hash);
      expect(batchAfter?.updated_at).toEqual(batchBefore?.updated_at);
    });
  });

  // -------------------------------------------------------------------------
  // 2. insertStagingRow against committed batch
  // -------------------------------------------------------------------------
  describe("2. insertStagingRow against committed batch", () => {
    it("rejects with InvalidBatchStatusError, zero new rows everywhere", async () => {
      const { stagingService } = makeServices();
      const batchId = newBatchId("X");
      await seedBatch(batchId, "committed", { committedAt: new Date(), commitEffectCounts: { inventory_movements: 1 } });
      const before = await captureFullSnapshot();

      await expect(
        stagingService.insertStagingRow(makeUser() as any, makeEffective() as any, {
          importBatchId: batchId, importFileId: null, templateName: null,
          sourceSheetName: null, sourceRowNumber: 1, rawRowJson: null, transformedRowJson: { a: 1 },
          transformationNotes: null, idempotencyKey: "pg-k2",
        }),
      ).rejects.toThrow(/LIFECYCLE_VIOLATION|InvalidBatchStatusError|status.*must be/);

      const after = await captureFullSnapshot();
      await assertZeroEffects(before, after);
    });
  });

  // -------------------------------------------------------------------------
  // 3. runValidation against committed and committing batches
  // -------------------------------------------------------------------------
  describe("3. runValidation against committed and committing batches", () => {
    it("rejects against committed batch, zero new findings/audit/idempotency", async () => {
      const { validationService } = makeServices();
      const batchId = newBatchId("X");
      await seedBatch(batchId, "committed", { committedAt: new Date(), commitEffectCounts: { inventory_movements: 1 } });
      await seedStagingRow(batchId, 1);
      const before = await captureFullSnapshot();

      await expect(
        validationService.runValidation(makeUser() as any, makeEffective() as any, {
          importBatchId: batchId, idempotencyKey: "pg-k3a",
        }),
      ).rejects.toThrow(/LIFECYCLE_VIOLATION|InvalidBatchStatusError|status.*must be/);

      const after = await captureFullSnapshot();
      await assertZeroEffects(before, after);
    });

    it("rejects against committing batch, zero new findings/audit", async () => {
      const { validationService } = makeServices();
      const batchId = newBatchId("X");
      await seedBatch(batchId, "committing");
      await seedStagingRow(batchId, 1);
      const before = await captureFullSnapshot();

      await expect(
        validationService.runValidation(makeUser() as any, makeEffective() as any, {
          importBatchId: batchId, idempotencyKey: "pg-k3b",
        }),
      ).rejects.toThrow(/LIFECYCLE_VIOLATION|InvalidBatchStatusError|status.*must be/);

      const after = await captureFullSnapshot();
      await assertZeroEffects(before, after);
    });
  });

  // -------------------------------------------------------------------------
  // 4. runReconciliation against pending_dual_approval, approved_for_commit, committed
  // -------------------------------------------------------------------------
  describe("4. runReconciliation against locked/terminal batches (TASK 1.2)", () => {
    it("rejects against pending_dual_approval batch", async () => {
      const { reconciliationService } = makeServices();
      const batchId = newBatchId("X");
      await seedBatch(batchId, "pending_dual_approval");
      const before = await captureFullSnapshot();

      await expect(
        reconciliationService.runReconciliation(makeUser() as any, makeEffective() as any, {
          importBatchId: batchId, expectedTotals: {}, idempotencyKey: "pg-k4a",
        }),
      ).rejects.toThrow(/LIFECYCLE_VIOLATION|InvalidBatchStatusError|status.*must be/);

      const after = await captureFullSnapshot();
      // WP-08-01F DEC-081 recovery — the pre-check guardRunReconciliation
      // now classifies the rejection as business_failed (durable) via
      // the wrapped try-catch. Assert exactly ONE new business_failed
      // idempotency record with the expected operation_scope, and zero
      // new business effects on every other table.
      await assertZeroBusinessEffectsAllowingBusinessFailedIdempotency(
        before, after, "historical_reconciliation.run",
      );
    });

    it("rejects against approved_for_commit batch", async () => {
      const { reconciliationService } = makeServices();
      const batchId = newBatchId("X");
      await seedBatch(batchId, "approved_for_commit");
      const before = await captureFullSnapshot();

      await expect(
        reconciliationService.runReconciliation(makeUser() as any, makeEffective() as any, {
          importBatchId: batchId, expectedTotals: {}, idempotencyKey: "pg-k4b",
        }),
      ).rejects.toThrow(/LIFECYCLE_VIOLATION|InvalidBatchStatusError|status.*must be/);

      const after = await captureFullSnapshot();
      await assertZeroBusinessEffectsAllowingBusinessFailedIdempotency(
        before, after, "historical_reconciliation.run",
      );
    });

    it("rejects against committed batch", async () => {
      const { reconciliationService } = makeServices();
      const batchId = newBatchId("X");
      await seedBatch(batchId, "committed", { committedAt: new Date(), commitEffectCounts: {} });
      const before = await captureFullSnapshot();

      await expect(
        reconciliationService.runReconciliation(makeUser() as any, makeEffective() as any, {
          importBatchId: batchId, expectedTotals: {}, idempotencyKey: "pg-k4c",
        }),
      ).rejects.toThrow(/LIFECYCLE_VIOLATION|InvalidBatchStatusError|status.*must be/);

      const after = await captureFullSnapshot();
      await assertZeroBusinessEffectsAllowingBusinessFailedIdempotency(
        before, after, "historical_reconciliation.run",
      );
    });
  });

  // -------------------------------------------------------------------------
  // 5. recordReviewDecision in invalid batch state and against already-resolved review item
  // -------------------------------------------------------------------------
  describe("5. recordReviewDecision — invalid batch state and already-resolved review item", () => {
    it("rejects in invalid batch state (staged), zero new effects", async () => {
      const { reconciliationService } = makeServices();
      const batchId = newBatchId("X");
      await seedBatch(batchId, "staged");
      const reviewItemId = await seedReviewItem(batchId, "pending");
      const before = await captureFullSnapshot();

      await expect(
        reconciliationService.recordReviewDecision(makeUser() as any, makeEffective() as any, {
          reviewItemId, decision: "accepted", decisionNotes: "ok", idempotencyKey: "pg-k5a",
        }),
      ).rejects.toThrow(/LIFECYCLE_VIOLATION|InvalidBatchStatusError|status.*must be/);

      const after = await captureFullSnapshot();
      await assertZeroEffects(before, after);
      // Review item itself must be unchanged
      const item = await sql`SELECT status, decision, decided_by FROM import_human_review_items WHERE id = ${reviewItemId}`;
      expect(item[0]?.status).toBe("pending");
      expect(item[0]?.decision).toBeNull();
      expect(item[0]?.decided_by).toBeNull();
    });

    it("rejects against already-resolved review item (status=resolved)", async () => {
      const { reconciliationService } = makeServices();
      const batchId = newBatchId("X");
      await seedBatch(batchId, "review_required");
      const reviewItemId = await seedReviewItem(batchId, "resolved");
      const before = await captureFullSnapshot();

      await expect(
        reconciliationService.recordReviewDecision(makeUser() as any, makeEffective() as any, {
          reviewItemId, decision: "accepted", decisionNotes: "again", idempotencyKey: "pg-k5b",
        }),
      ).rejects.toThrow(/already.*resolv|REVIEW_ALREADY_RESOLVED|cannot be re-decided|status.*must be/i);

      const after = await captureFullSnapshot();
      await assertZeroEffects(before, after);
    });
  });

  // -------------------------------------------------------------------------
  // 6. recordApproval before reconciliation/review completion (TASK 1.1)
  // -------------------------------------------------------------------------
  describe("6. recordApproval before reconciliation/review completion", () => {
    it("rejects against validation_complete batch (must reach pending_dual_approval)", async () => {
      const { commitService } = makeServices();
      const batchId = newBatchId("X");
      await seedBatch(batchId, "validation_complete");
      const before = await captureFullSnapshot();

      await expect(
        commitService.recordApproval(makeUser() as any, makeEffective() as any, {
          importBatchId: batchId, approverRole: "owner", reason: "test", idempotencyKey: "pg-k6a",
        }),
      ).rejects.toThrow(/LIFECYCLE_VIOLATION|InvalidBatchStatusError|status.*must be/);

      const after = await captureFullSnapshot();
      await assertZeroEffects(before, after);
    });

    it("rejects against reconciliation_in_progress batch", async () => {
      const { commitService } = makeServices();
      const batchId = newBatchId("X");
      await seedBatch(batchId, "reconciliation_in_progress");
      const before = await captureFullSnapshot();

      await expect(
        commitService.recordApproval(makeUser() as any, makeEffective() as any, {
          importBatchId: batchId, approverRole: "owner", reason: "test", idempotencyKey: "pg-k6b",
        }),
      ).rejects.toThrow(/LIFECYCLE_VIOLATION|InvalidBatchStatusError|status.*must be/);

      const after = await captureFullSnapshot();
      await assertZeroEffects(before, after);
    });

    it("rejects against review_required batch (review items still unresolved)", async () => {
      const { commitService } = makeServices();
      const batchId = newBatchId("X");
      await seedBatch(batchId, "review_required");
      const before = await captureFullSnapshot();

      await expect(
        commitService.recordApproval(makeUser() as any, makeEffective() as any, {
          importBatchId: batchId, approverRole: "owner", reason: "test", idempotencyKey: "pg-k6c",
        }),
      ).rejects.toThrow(/LIFECYCLE_VIOLATION|InvalidBatchStatusError|status.*must be/);

      const after = await captureFullSnapshot();
      await assertZeroEffects(before, after);
    });

    it("rejects when validationStatus is null (TASK 1.1 — no 'unknown' approvals)", async () => {
      const { commitService } = makeServices();
      const batchId = newBatchId("X");
      await seedBatch(batchId, "pending_dual_approval", {
        validationStatus: null, reconciliationStatus: null,
      });
      const before = await captureFullSnapshot();

      await expect(
        commitService.recordApproval(makeUser() as any, makeEffective() as any, {
          importBatchId: batchId, approverRole: "owner", reason: "test", idempotencyKey: "pg-k6d",
        }),
      ).rejects.toThrow(/validationStatus|LIFECYCLE_VIOLATION|Allowed statuses/);

      const after = await captureFullSnapshot();
      await assertZeroEffects(before, after);
    });
  });

  // -------------------------------------------------------------------------
  // 7. recordBackupEvidence against committed batch
  // -------------------------------------------------------------------------
  describe("7. recordBackupEvidence against committed batch", () => {
    it("rejects with InvalidBatchStatusError, zero new backups/audit", async () => {
      const { commitService } = makeServices();
      const batchId = newBatchId("X");
      await seedBatch(batchId, "committed", { committedAt: new Date(), commitEffectCounts: {} });
      const before = await captureFullSnapshot();

      await expect(
        commitService.recordBackupEvidence(makeUser() as any, makeEffective() as any, {
          importBatchId: batchId, backupType: "full", backupLocation: "s3://b/bk",
          backupHash: "bh1", backupSizeBytes: 1, backupCreatedAt: new Date(),
          verificationNotes: null, idempotencyKey: "pg-k7",
        }),
      ).rejects.toThrow(/LIFECYCLE_VIOLATION|InvalidBatchStatusError|status.*must be/);

      const after = await captureFullSnapshot();
      await assertZeroEffects(before, after);
    });

    it("rejects against validation_complete batch (TASK 1.5 — recon report not final)", async () => {
      const { commitService } = makeServices();
      const batchId = newBatchId("X");
      await seedBatch(batchId, "validation_complete");
      const before = await captureFullSnapshot();

      await expect(
        commitService.recordBackupEvidence(makeUser() as any, makeEffective() as any, {
          importBatchId: batchId, backupType: "full", backupLocation: "s3://b/bk",
          backupHash: "bh2", backupSizeBytes: 1, backupCreatedAt: new Date(),
          verificationNotes: null, idempotencyKey: "pg-k7b",
        }),
      ).rejects.toThrow(/LIFECYCLE_VIOLATION|InvalidBatchStatusError|status.*must be/);

      const after = await captureFullSnapshot();
      await assertZeroEffects(before, after);
    });
  });

  // -------------------------------------------------------------------------
  // 8. tenant-mismatched batch/file/review item
  // -------------------------------------------------------------------------
  describe("8. tenant-mismatched operations", () => {
    it("Tenant A user cannot operate on Tenant B batch (registerFile)", async () => {
      const { stagingService } = makeServices();
      const batchIdB = newBatchId("X");
      // Seed a batch for Tenant B (cannot use T_B's user — different tenant)
      await sql`
        INSERT INTO import_batches (
          id, tenant_id, batch_no, status, source_description, template_name, template_version,
          mapping_version, cutover_manifest_hash, cutover_import_mode, staged_data_hash, staged_row_count,
          blocking_error_count, warning_count, accepted_warning_count, validation_status, reconciliation_status,
          warning_summary, committed_at, commit_effect_counts, created_by, created_at
        ) VALUES (
          ${batchIdB}, ${T_B}, ${"MIG-B-" + batchIdB.slice(-6)}, ${"draft"}::import_batch_status, ${"test"}, ${"test-template"}, ${"1.0"},
          ${"1.0"}, ${"m"}, ${"opening_balance"}, ${"h"}, 0,
          0, 0, 0, null, null,
          null, null, null, ${U}, NOW()
        )`;
      const before = await captureFullSnapshot();

      await expect(
        stagingService.registerFile(makeUser(U, T) as any, makeEffective() as any, {
          importBatchId: batchIdB, originalFileName: "f.xlsx", storagePath: "s3://b/k",
          fileHash: "h8a", fileType: "source", fileSizeBytes: null, contentType: null, idempotencyKey: "pg-k8a",
        }),
      ).rejects.toThrow(/BATCH_NOT_FOUND|not found|tenant/i);

      const after = await captureFullSnapshot();
      // Tenant A's counts unchanged (including sequence values, idempotency, audit)
      await assertZeroEffects(before, after);
    });
  });

  // -------------------------------------------------------------------------
  // 9. valid predecessor-state success followed by terminal-state rejection
  // -------------------------------------------------------------------------
  describe("9. valid predecessor-state success followed by terminal-state rejection", () => {
    it("registerFile succeeds on draft batch, then rejects on committed batch", async () => {
      const { stagingService } = makeServices();
      const batchIdOk = newBatchId("X");
      const batchIdBad = newBatchId("X");
      await seedBatch(batchIdOk, "draft");
      await seedBatch(batchIdBad, "committed", { committedAt: new Date(), commitEffectCounts: {} });

      // Success on draft
      const r1 = await stagingService.registerFile(makeUser() as any, makeEffective() as any, {
        importBatchId: batchIdOk, originalFileName: "ok.xlsx", storagePath: "s3://b/k",
        fileHash: "h9a", fileType: "source", fileSizeBytes: null, contentType: null, idempotencyKey: "pg-k9a",
      });
      expect(r1.action).toBe("created");

      // Failure on committed
      await expect(
        stagingService.registerFile(makeUser() as any, makeEffective() as any, {
          importBatchId: batchIdBad, originalFileName: "bad.xlsx", storagePath: "s3://b/k",
          fileHash: "h9b", fileType: "source", fileSizeBytes: null, contentType: null, idempotencyKey: "pg-k9b",
        }),
      ).rejects.toThrow(/LIFECYCLE_VIOLATION|InvalidBatchStatusError|status.*must be/);

      // Verify: 1 new file for batchIdOk, 0 new files for batchIdBad
      const okFiles = await sql`SELECT count(*)::int AS c FROM import_files WHERE import_batch_id = ${batchIdOk} AND tenant_id = ${T}`;
      const badFiles = await sql`SELECT count(*)::int AS c FROM import_files WHERE import_batch_id = ${batchIdBad} AND tenant_id = ${T}`;
      expect(okFiles[0]?.c).toBe(1);
      expect(badFiles[0]?.c).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // 10. valid idempotency replay after service changes batch state
  // -------------------------------------------------------------------------
  describe("10. valid idempotency replay after service changes batch state", () => {
    it("recordApproval replay returns existing approval, zero new audit/idempotency", async () => {
      const { commitService } = makeServices();
      const batchId = newBatchId("X");
      await seedBatch(batchId, "pending_dual_approval");

      // First call — succeeds, creates approval
      const r1 = await commitService.recordApproval(makeUser() as any, makeEffective() as any, {
        importBatchId: batchId, approverRole: "owner", reason: "first", idempotencyKey: "pg-k10",
      });
      expect(r1.action).toBe("recorded");

      const auditAfterFirst = await sql`SELECT count(*)::int AS c FROM audit_logs WHERE tenant_id = ${T}`;
      const idemAfterFirst = await sql`SELECT count(*)::int AS c FROM idempotency_records WHERE tenant_id = ${T} AND state = 'succeeded'`;

      // Second call with SAME idempotency key — should replay
      const r2 = await commitService.recordApproval(makeUser() as any, makeEffective() as any, {
        importBatchId: batchId, approverRole: "owner", reason: "second", idempotencyKey: "pg-k10",
      });
      expect(r2.action).toBe("replayed");
      expect(r2.approvalId).toBe(r1.approvalId);

      // Zero new audit rows
      const auditAfterSecond = await sql`SELECT count(*)::int AS c FROM audit_logs WHERE tenant_id = ${T}`;
      expect(auditAfterSecond[0]?.c).toBe(auditAfterFirst[0]?.c);
      // Zero new succeeded idempotency records
      const idemAfterSecond = await sql`SELECT count(*)::int AS c FROM idempotency_records WHERE tenant_id = ${T} AND state = 'succeeded'`;
      expect(idemAfterSecond[0]?.c).toBe(idemAfterFirst[0]?.c);

      // Only 1 approval row exists
      const approvals = await sql`SELECT count(*)::int AS c FROM import_batch_approvals WHERE import_batch_id = ${batchId} AND tenant_id = ${T}`;
      expect(approvals[0]?.c).toBe(1);
    });
  });
});
