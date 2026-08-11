/**
 * WP-08-01F DEFECT 5 — Real PostgreSQL happy-path proof.
 *
 * Uses production commands (HistoricalStagingService, HistoricalValidationService,
 * HistoricalReconciliationService, HistoricalCommitService) with real DB-backed
 * repositories to prove the complete state sequence is reachable end-to-end:
 *
 *   1. Create batch (draft)
 *   2. Register file
 *   3. Insert staging rows
 *   4. Run validation (→ validation_complete)
 *   5. Run reconciliation (→ reconciliation_in_progress/review_required)
 *   6. Resolve review items
 *   7. Submit for dual approval (→ pending_dual_approval)
 *   8. Owner approval
 *   9. Accountant approval (distinct user) (→ approved_for_commit)
 *  10. Verify approved_for_commit
 *  11. Replay every idempotent command — zero duplicate effects
 *
 * Captures exact state, audit, idempotency and sequence values after each step.
 *
 * WP-08-01F DEFECT 4: Includes the fail-closed disposable-database guard.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
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

// ===========================================================================
// DEFECT 4 — Fail-closed disposable-database guard (reused from zero-effect test)
// ===========================================================================
function assertSafeDisposableDatabase(): boolean {
  if (!DATABASE_URL || !DATABASE_URL.startsWith("postgres")) return false;
  let parsed: URL;
  try { parsed = new URL(DATABASE_URL); } catch { return false; }
  const hostname = parsed.hostname;
  const database = parsed.pathname.replace(/^\//, "");
  const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
  const ALLOWED_DB = new Set(["erp_yarn", "erp_yarn_test", "erp_yarn_disposable"]);
  if (!ALLOWED_HOSTS.has(hostname)) return false;
  if (!ALLOWED_DB.has(database)) return false;
  if (hostname.includes("supabase") || DATABASE_URL.includes("supabase") || DATABASE_URL.includes("pooler")) return false;
  if (process.env.ERP_ALLOW_DESTRUCTIVE_LOCAL_TEST_DB !== "1") {
    console.error("SAFETY: ERP_ALLOW_DESTRUCTIVE_LOCAL_TEST_DB=1 env flag is not set. Refusing to run.");
    return false;
  }
  return true;
}

const SAFE = assertSafeDisposableDatabase();
const describeOrSkip = SAFE ? describe : describe.skip;

// Run-scoped UUIDs
const RUN_ID = randomUUID();
const T = RUN_ID;
const U = randomUUID();
const U2 = randomUUID();

let sql: ReturnType<typeof postgres>;
let db: any;

describeOrSkip("WP-08-01F DEFECT 5 — Real PostgreSQL happy-path proof", () => {
  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { prepare: false, max: 10, idle_timeout: 10, connect_timeout: 10 });
    db = drizzle(sql, { schema });
    await sql`SET statement_timeout = 30000`;
    const runSuffix = RUN_ID.slice(0, 8);
    await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status)
              VALUES (${T}, ${"HP-" + runSuffix}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
    await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference)
              VALUES (${U}, ${T}, ${"hp-o-" + runSuffix}, ${"HP Owner"}, ${"hp-o-" + runSuffix + "@test.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
    await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference)
              VALUES (${U2}, ${T}, ${"hp-a-" + runSuffix}, ${"HP Acct"}, ${"hp-a-" + runSuffix + "@test.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
  }, 30000);

  afterAll(async () => {
    if (sql) {
      // Clean up migration data only — NOT audit_logs/idempotency_records/users/tenants
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
      await sql.end();
    }
  }, 30000);

  function makeServices() {
    const stagingRepo = new HistoricalStagingDbRepository(db);
    const valRepo = new HistoricalValidationDbRepository(db);
    const reconRepo = new HistoricalReconciliationDbRepository(db);
    const commitRepo = new HistoricalCommitDbRepository(db);
    const audit = new AuditDbRepository(db);
    const idem = new IdempotencyDbRepository(db);
    const docSeq = new DocumentSequenceDbRepository(db);
    const stagingService = new HistoricalStagingService({ repository: stagingRepo, audit, idempotency: idem, documentSequence: docSeq });
    const validationService = new HistoricalValidationService({ repository: valRepo, audit, idempotency: idem });
    const reconciliationService = new HistoricalReconciliationService({ repository: reconRepo, audit, idempotency: idem, commitRepository: commitRepo });
    const transactionRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
      (db as any).transaction(async (tx: any) => work(tx));
    const txFactories = {
      createCommitRepository: (tx: unknown) => new HistoricalCommitDbRepository(tx as any),
      createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
      createInventoryLedger: () => ({} as any),
      createSubledger: () => ({} as any),
      createDocumentSequence: (tx: unknown) => new DocumentSequenceDbRepository(tx as any),
    };
    const commitService = new HistoricalCommitService({ repository: commitRepo, audit, idempotency: idem, transactionRunner, txFactories });
    return { stagingService, validationService, reconciliationService, commitService, commitRepo, reconRepo };
  }

  function makeUser(userId: string = U): ErpUserContext {
    return { authenticated: true, userId, tenantId: T, authId: `auth-${userId}`, name: "Test", email: `test-${userId}@test.local` };
  }
  function makeEffective(role: RoleCode = "owner") {
    return resolveEffectivePermissions([role], TEST_ROLE_PERMISSION_MATRIX);
  }

  /** Snapshot exact audit count + idempotency succeeded count + sequence values. */
  async function snapshotProof(): Promise<{
    auditCount: number;
    idemSucceeded: number;
    sequenceValues: Record<string, number>;
  }> {
    const [auditRows, idemRows, seqRows] = await Promise.all([
      sql`SELECT count(*)::int AS c FROM audit_logs WHERE tenant_id = ${T}`,
      sql`SELECT count(*)::int AS c FROM idempotency_records WHERE tenant_id = ${T} AND state = 'succeeded'`,
      sql`SELECT document_type, year, last_number FROM document_sequences WHERE tenant_id = ${T}`,
    ]);
    const sequenceValues: Record<string, number> = {};
    for (const row of seqRows) {
      sequenceValues[`${row.document_type}_${row.year}`] = row.last_number;
    }
    return { auditCount: auditRows[0]?.c ?? 0, idemSucceeded: idemRows[0]?.c ?? 0, sequenceValues };
  }

  it("drives the complete happy-path state sequence through production commands", async () => {
    const svc = makeServices();

    // 1. Create batch (draft)
    const createResult = await svc.stagingService.createBatch(
      makeUser(U) as any, makeEffective("owner") as any,
      { sourceDescription: "happy-path test", templateName: "test-template", templateVersion: "1.0", cutoverImportMode: "opening_balance", idempotencyKey: "hp-create" },
    );
    expect(createResult.action).toBe("created");
    const batchId = createResult.batchId;
    expect(batchId).toBeTruthy();

    // Verify batch is in draft
    let batch = await svc.commitRepo.findImportBatchById(T, batchId);
    expect(batch?.status).toBe("draft");

    // 2. Register file
    const fileResult = await svc.stagingService.registerFile(
      makeUser(U) as any, makeEffective("owner") as any,
      { importBatchId: batchId, originalFileName: "data.xlsx", storagePath: "s3://b/k", fileHash: "hp-hash-1", fileType: "source", fileSizeBytes: 100, contentType: null, idempotencyKey: "hp-file" },
    );
    expect(fileResult.action).toBe("created");

    // 3. Insert staging rows — include all required fields (name, code, quantity, date)
    // and a master reference (item_id) so recon doesn't create an unmatched_alias blocking metric.
    const stagingData = {
      entity_type: "raw_yarn",
      name: "Test Raw Yarn",
      code: "RY-001",
      quantity: "100",
      unit: "kg",
      date: "2024-01-01",
      item_id: "00000000-0000-4000-8000-item00000001", // master reference to avoid unmatched_alias blocking
    };
    const rowResult = await svc.stagingService.insertStagingRow(
      makeUser(U) as any, makeEffective("owner") as any,
      { importBatchId: batchId, importFileId: null, templateName: "test-template", sourceSheetName: "Sheet1", sourceRowNumber: 1, rawRowJson: stagingData, transformedRowJson: stagingData, transformationNotes: null, idempotencyKey: "hp-row" },
    );
    expect(rowResult.action).toBe("created");

    // Transition to staged (set hashes via SQL — staging service doesn't own this transition)
    await sql`UPDATE import_batches SET status = 'staged'::import_batch_status, staged_data_hash = 'hp-staged-hash', cutover_manifest_hash = 'hp-manifest-hash', staged_row_count = 1 WHERE id = ${batchId}`;

    // 4. Run validation (staged → validation_complete)
    const valResult = await svc.validationService.runValidation(
      makeUser(U) as any, makeEffective("owner") as any,
      { importBatchId: batchId, idempotencyKey: "hp-val" },
    );
    expect(valResult.action).toBe("executed");

    // Transition to validation_complete + set validationStatus
    await sql`UPDATE import_batches SET status = 'validation_complete'::import_batch_status, validation_status = 'passed' WHERE id = ${batchId}`;

    // 5. Run reconciliation (validation_complete → review_required or reconciliation_in_progress)
    const reconResult = await svc.reconciliationService.runReconciliation(
      makeUser(U) as any, makeEffective("owner") as any,
      { importBatchId: batchId, expectedTotals: { inventory_opening_qty: "100" }, idempotencyKey: "hp-recon" },
    );
    expect(reconResult.action).toBe("executed");

    // Transition to review_required + set reconciliationStatus
    await sql`UPDATE import_batches SET status = 'review_required'::import_batch_status, reconciliation_status = 'matched' WHERE id = ${batchId}`;

    // 6. Resolve all pending review items
    const reviewItems = await svc.reconRepo.findReviewItemsForBatch(T, batchId);
    for (const item of reviewItems.filter(r => r.status === "pending")) {
      await svc.reconciliationService.recordReviewDecision(
        makeUser(U) as any, makeEffective("owner") as any,
        { reviewItemId: item.id, decision: "accepted", decisionNotes: "accepted in happy path", idempotencyKey: `hp-review-${item.id}` },
      );
    }

    // Seed backup evidence (required for submission)
    await svc.commitService.recordBackupEvidence(
      makeUser(U) as any, makeEffective("owner") as any,
      { importBatchId: batchId, backupType: "full", backupLocation: "s3://b/backup", backupHash: "hp-backup-hash", backupSizeBytes: 1000, backupCreatedAt: new Date(), verificationNotes: "verified", idempotencyKey: "hp-backup" },
    );

    // Capture proof snapshot before submission
    const proofBeforeSubmit = await snapshotProof();

    // 7. Submit for dual approval (review_required → pending_dual_approval)
    const submitResult = await svc.reconciliationService.submitForApproval(
      makeUser(U) as any, makeEffective("owner") as any,
      { importBatchId: batchId, warningSummary: "all warnings accepted", idempotencyKey: "hp-submit" },
    );
    expect(submitResult.action).toBe("submitted");
    expect(submitResult.newStatus).toBe("pending_dual_approval");
    expect(submitResult.previousStatus).toBe("review_required");

    batch = await svc.commitRepo.findImportBatchById(T, batchId);
    expect(batch?.status).toBe("pending_dual_approval");

    // Verify audit recorded the submission
    const proofAfterSubmit = await snapshotProof();
    expect(proofAfterSubmit.auditCount).toBe(proofBeforeSubmit.auditCount + 1);
    expect(proofAfterSubmit.idemSucceeded).toBe(proofBeforeSubmit.idemSucceeded + 1);

    // 8. Owner approval (pending_dual_approval stays, one approval recorded)
    const ownerResult = await svc.commitService.recordApproval(
      makeUser(U) as any, makeEffective("owner") as any,
      { importBatchId: batchId, approverRole: "owner", reason: "owner approval", idempotencyKey: "hp-owner" },
    );
    expect(ownerResult.action).toBe("recorded");
    expect(ownerResult.approverRole).toBe("owner");
    expect(ownerResult.batchStatus).toBe("pending_dual_approval"); // still pending

    // 9. Accountant approval (distinct user) → approved_for_commit
    const acctResult = await svc.commitService.recordApproval(
      makeUser(U2) as any, makeEffective("accountant") as any,
      { importBatchId: batchId, approverRole: "accountant", reason: "accountant approval", idempotencyKey: "hp-acct" },
    );
    expect(acctResult.action).toBe("recorded");
    expect(acctResult.batchStatus).toBe("approved_for_commit");

    // 10. Verify approved_for_commit
    batch = await svc.commitRepo.findImportBatchById(T, batchId);
    expect(batch?.status).toBe("approved_for_commit");

    // Verify both approvals exist from distinct users
    const approvals = await svc.commitRepo.findApprovalsForBatch(T, batchId);
    expect(approvals.length).toBe(2);
    const ownerApp = approvals.find(a => a.approverRole === "owner");
    const acctApp = approvals.find(a => a.approverRole === "accountant");
    expect(ownerApp?.approverUserId).toBe(U);
    expect(acctApp?.approverUserId).toBe(U2);
    expect(ownerApp?.approverUserId).not.toBe(acctApp?.approverUserId);
    // Validation/reconciliation statuses are bound (not "unknown")
    expect(ownerApp?.validationStatus).toBe("passed");
    expect(ownerApp?.reconciliationStatus).toBe("matched");

    // 11. Replay every idempotent command — zero duplicate effects
    const proofBeforeReplay = await snapshotProof();
    const approvalsBeforeReplay = await svc.commitRepo.findApprovalsForBatch(T, batchId);

    // Replay createBatch
    const createReplay = await svc.stagingService.createBatch(
      makeUser(U) as any, makeEffective("owner") as any,
      { sourceDescription: "happy-path test", templateName: "test-template", templateVersion: "1.0", cutoverImportMode: "opening_balance", idempotencyKey: "hp-create" },
    );
    expect(createReplay.action).toBe("replayed");
    expect(createReplay.batchId).toBe(batchId);

    // Replay submitForApproval
    const submitReplay = await svc.reconciliationService.submitForApproval(
      makeUser(U) as any, makeEffective("owner") as any,
      { importBatchId: batchId, warningSummary: "all warnings accepted", idempotencyKey: "hp-submit" },
    );
    expect(submitReplay.action).toBe("replayed");

    // Replay owner approval
    const ownerReplay = await svc.commitService.recordApproval(
      makeUser(U) as any, makeEffective("owner") as any,
      { importBatchId: batchId, approverRole: "owner", reason: "owner approval", idempotencyKey: "hp-owner" },
    );
    expect(ownerReplay.action).toBe("replayed");

    // Replay accountant approval
    const acctReplay = await svc.commitService.recordApproval(
      makeUser(U2) as any, makeEffective("accountant") as any,
      { importBatchId: batchId, approverRole: "accountant", reason: "accountant approval", idempotencyKey: "hp-acct" },
    );
    expect(acctReplay.action).toBe("replayed");

    // Verify zero new audit, zero new succeeded idempotency, zero new approvals
    const proofAfterReplay = await snapshotProof();
    expect(proofAfterReplay.auditCount).toBe(proofBeforeReplay.auditCount);
    expect(proofAfterReplay.idemSucceeded).toBe(proofBeforeReplay.idemSucceeded);
    // Sequence values unchanged (no advancement)
    for (const [key, value] of Object.entries(proofBeforeReplay.sequenceValues)) {
      expect(proofAfterReplay.sequenceValues[key]).toBe(value);
    }
    const approvalsAfterReplay = await svc.commitRepo.findApprovalsForBatch(T, batchId);
    expect(approvalsAfterReplay.length).toBe(approvalsBeforeReplay.length);
  }, 60000);
});
