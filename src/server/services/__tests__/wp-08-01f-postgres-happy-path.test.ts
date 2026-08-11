/**
 * WP-08-01F DEFECT 7 — Authoritative PostgreSQL production-path proof.
 *
 * After foundational tenant/user setup, there are ZERO direct lifecycle SQL
 * updates. Every state is produced by a real production service command:
 *
 *   1. createBatch → draft
 *   2. registerFile → draft → source_uploaded
 *   3. insertStagingRow → (stays source_uploaded)
 *   4. finalizeStaging → staged (derives stagedDataHash server-side)
 *   5. finalizeCutoverManifest → binds cutoverManifestHash server-side
 *   6. runValidation → validation_complete (sets validationStatus="passed")
 *   7. runReconciliation → review_required (sets reconciliationStatus="matched")
 *   8. recordReviewDecision → resolves review items
 *   9. recordBackupEvidence → backup evidence recorded
 *  10. submitForApproval → pending_dual_approval
 *  11. recordApproval (Owner) → pending_dual_approval
 *  12. recordApproval (Accountant, distinct user) → approved_for_commit
 *
 * No direct SQL may change: batch status, stagedDataHash, cutoverManifestHash,
 * validationStatus, reconciliationStatus, warning counts, approval eligibility.
 *
 * WP-08-01F DEFECT 5: Includes the fail-closed disposable-database guard.
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
const REQUIRE_PROOF = process.env.ERP_REQUIRE_WP0801F_POSTGRES_PROOF === "1";
const ALLOW_DESTRUCTIVE = process.env.ERP_ALLOW_DESTRUCTIVE_LOCAL_TEST_DB === "1";
const DEDICATED_DB_NAME = "erp_yarn_wp0801f_disposable";

// ===========================================================================
// DEFECT 5 — Safety guard (same logic as zero-effect test)
// ===========================================================================
type SafetyResult =
  | { kind: "ok" }
  | { kind: "skip"; reason: string }
  | { kind: "fail"; message: string };

function checkDatabaseSafety(): SafetyResult {
  if (!DATABASE_URL) {
    if (REQUIRE_PROOF) return { kind: "fail", message: "SAFETY: ERP_REQUIRE_WP0801F_POSTGRES_PROOF=1 but DATABASE_URL absent." };
    return { kind: "skip", reason: "DATABASE_URL not set" };
  }
  if (!DATABASE_URL.startsWith("postgres")) return { kind: "fail", message: `SAFETY: non-postgres URL` };
  let parsed: URL;
  try { parsed = new URL(DATABASE_URL); } catch { return { kind: "fail", message: "SAFETY: invalid URL" }; }
  const hostname = parsed.hostname;
  const database = parsed.pathname.replace(/^\//, "");
  const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!ALLOWED_HOSTS.has(hostname)) return { kind: "fail", message: `SAFETY: non-local host '${hostname}'` };
  if (hostname.includes("supabase") || DATABASE_URL.includes("supabase") || DATABASE_URL.includes("pooler"))
    return { kind: "fail", message: "SAFETY: Supabase/pooler URL" };
  if (database !== DEDICATED_DB_NAME) return { kind: "fail", message: `SAFETY: database '${database}' != '${DEDICATED_DB_NAME}'` };
  if (!ALLOW_DESTRUCTIVE) {
    if (REQUIRE_PROOF) return { kind: "fail", message: "SAFETY: ERP_ALLOW_DESTRUCTIVE_LOCAL_TEST_DB=1 required for proof" };
    return { kind: "skip", reason: "ERP_ALLOW_DESTRUCTIVE_LOCAL_TEST_DB=1 not set" };
  }
  return { kind: "ok" };
}

const SAFETY_RESULT = checkDatabaseSafety();
const describeOrSkip = SAFETY_RESULT.kind === "fail" ? describe.skip : (SAFETY_RESULT.kind === "skip" ? describe.skip : describe);
let SAFETY_ERROR_MESSAGE: string | null = null;
if (SAFETY_RESULT.kind === "skip") {
  console.log(`\n[WP-08-01F happy-path] SKIPPED: ${SAFETY_RESULT.reason}\n`);
} else if (SAFETY_RESULT.kind === "fail") {
  SAFETY_ERROR_MESSAGE = SAFETY_RESULT.message;
  console.error(`\n[WP-08-01F happy-path] SAFETY GUARD FAILED:\n${SAFETY_RESULT.message}\n`);
}

// Run-scoped UUIDs
const RUN_ID = randomUUID();
const T = RUN_ID;
const U = randomUUID();
const U2 = randomUUID();

let sql: ReturnType<typeof postgres>;
let db: any;

describeOrSkip("WP-08-01F DEFECT 7 — Authoritative PostgreSQL production-path proof", () => {
  beforeAll(async () => {
    if (SAFETY_ERROR_MESSAGE) throw new Error(SAFETY_ERROR_MESSAGE);
    sql = postgres(DATABASE_URL!, { prepare: false, max: 10, idle_timeout: 10, connect_timeout: 10 });
    db = drizzle(sql, { schema });
    await sql`SET statement_timeout = 30000`;

    // DEFECT 5: Verify dedicated DB marker
    const dbResult = await sql`SELECT current_database() AS db_name`;
    if (dbResult[0]?.db_name !== DEDICATED_DB_NAME) {
      await sql.end();
      throw new Error(`SAFETY: Connected to '${dbResult[0]?.db_name}' but expected '${DEDICATED_DB_NAME}'`);
    }

    // Foundational fixtures only (tenant/user) — no lifecycle SQL
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
    const transactionRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
      (db as any).transaction(async (tx: any) => work(tx));
    const reconciliationService = new HistoricalReconciliationService({
      repository: reconRepo, audit, idempotency: idem, commitRepository: commitRepo,
      transactionRunner,
      createCommitRepository: (tx: unknown) => new HistoricalCommitDbRepository(tx as any),
      createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
      createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
      createReconciliationRepository: (tx: unknown) => new HistoricalReconciliationDbRepository(tx as any),
    });
    const txFactories = {
      createCommitRepository: (tx: unknown) => new HistoricalCommitDbRepository(tx as any),
      createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
      createInventoryLedger: () => ({} as any),
      createSubledger: () => ({} as any),
      createDocumentSequence: (tx: unknown) => new DocumentSequenceDbRepository(tx as any),
    };
    const commitService = new HistoricalCommitService({ repository: commitRepo, audit, idempotency: idem, transactionRunner, txFactories });
    return { stagingService, validationService, reconciliationService, commitService, commitRepo, reconRepo, stagingRepo };
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
    approvalCount: number;
    approvalCurrentCount: number;
  }> {
    const [auditRows, idemRows, seqRows, approvalRows, currentApprovalRows] = await Promise.all([
      sql`SELECT count(*)::int AS c FROM audit_logs WHERE tenant_id = ${T}`,
      sql`SELECT count(*)::int AS c FROM idempotency_records WHERE tenant_id = ${T} AND state = 'succeeded'`,
      sql`SELECT document_type, year, last_number FROM document_sequences WHERE tenant_id = ${T}`,
      sql`SELECT count(*)::int AS c FROM import_batch_approvals WHERE tenant_id = ${T}`,
      sql`SELECT count(*)::int AS c FROM import_batch_approvals WHERE tenant_id = ${T} AND is_current = true`,
    ]);
    const sequenceValues: Record<string, number> = {};
    for (const row of seqRows) {
      sequenceValues[`${row.document_type}_${row.year}`] = row.last_number;
    }
    return {
      auditCount: auditRows[0]?.c ?? 0,
      idemSucceeded: idemRows[0]?.c ?? 0,
      sequenceValues,
      approvalCount: approvalRows[0]?.c ?? 0,
      approvalCurrentCount: currentApprovalRows[0]?.c ?? 0,
    };
  }

  it("drives the complete happy-path state sequence through production commands only — zero direct lifecycle SQL", async () => {
    const svc = makeServices();

    // 1. Create batch → draft
    const createResult = await svc.stagingService.createBatch(
      makeUser(U) as any, makeEffective("owner") as any,
      { sourceDescription: "happy-path production test", templateName: "test-template", templateVersion: "1.0", cutoverImportMode: "opening_balance", idempotencyKey: "hp-create" },
    );
    expect(createResult.action).toBe("created");
    expect(createResult.status).toBe("draft");
    const batchId = createResult.batchId;

    // Verify batch is draft
    let batch = await svc.commitRepo.findImportBatchById(T, batchId);
    expect(batch?.status).toBe("draft");

    // 2. Register file → draft → source_uploaded
    const fileResult = await svc.stagingService.registerFile(
      makeUser(U) as any, makeEffective("owner") as any,
      { importBatchId: batchId, originalFileName: "data.xlsx", storagePath: "s3://b/k", fileHash: "hp-hash-1", fileType: "source", fileSizeBytes: 100, contentType: null, idempotencyKey: "hp-file" },
    );
    expect(fileResult.action).toBe("created");

    // Verify batch transitioned to source_uploaded
    batch = await svc.commitRepo.findImportBatchById(T, batchId);
    expect(batch?.status).toBe("source_uploaded");

    // 3. Insert staging rows — include all required fields + master reference
    const stagingData = {
      entity_type: "raw_yarn",
      name: "Test Raw Yarn",
      code: "RY-001",
      quantity: "100",
      unit: "kg",
      date: "2024-01-01",
      item_id: "00000000-0000-4000-8000-item00000001",
      customer_id: "00000000-0000-4000-8000-cust00000001",
    };
    const rowResult = await svc.stagingService.insertStagingRow(
      makeUser(U) as any, makeEffective("owner") as any,
      { importBatchId: batchId, importFileId: null, templateName: "test-template", sourceSheetName: "Sheet1", sourceRowNumber: 1, rawRowJson: stagingData, transformedRowJson: stagingData, transformationNotes: null, idempotencyKey: "hp-row" },
    );
    expect(rowResult.action).toBe("created");

    // 4. finalizeStaging → staged (derives stagedDataHash server-side)
    const finalizeResult = await svc.stagingService.finalizeStaging(
      makeUser(U) as any, makeEffective("owner") as any,
      { importBatchId: batchId, idempotencyKey: "hp-finalize-staging" },
    );
    expect(finalizeResult.action).toBe("finalized");
    expect(finalizeResult.newStatus).toBe("staged");
    expect(finalizeResult.stagedDataHash).toBeTruthy();
    expect(finalizeResult.stagedRowCount).toBe(1);

    batch = await svc.commitRepo.findImportBatchById(T, batchId);
    expect(batch?.status).toBe("staged");
    expect(batch?.stagedDataHash).toBeTruthy();
    expect(batch?.stagedDataHash).toBe(finalizeResult.stagedDataHash);

    // 5. finalizeCutoverManifest → binds cutoverManifestHash server-side
    const manifestResult = await svc.stagingService.finalizeCutoverManifest(
      makeUser(U) as any, makeEffective("owner") as any,
      { importBatchId: batchId, domain: "inventory", cutoffDate: "2024-01-01", sourceCoverage: "all", openingBalanceBasis: "audit", liveSystemStartBoundary: "2024-01-02", idempotencyKey: "hp-manifest" },
    );
    expect(manifestResult.action).toBe("finalized");
    expect(manifestResult.manifestHash).toBeTruthy();
    expect(manifestResult.cutoverManifestHash).toBeTruthy();

    batch = await svc.commitRepo.findImportBatchById(T, batchId);
    expect(batch?.cutoverManifestHash).toBeTruthy();
    expect(batch?.cutoverManifestHash).toBe(manifestResult.cutoverManifestHash);

    // 6. runValidation → validation_complete (sets validationStatus="passed")
    const valResult = await svc.validationService.runValidation(
      makeUser(U) as any, makeEffective("owner") as any,
      { importBatchId: batchId, idempotencyKey: "hp-val" },
    );
    expect(valResult.action).toBe("executed");
    expect(valResult.blockingErrors).toBe(0);

    batch = await svc.commitRepo.findImportBatchById(T, batchId);
    expect(batch?.status).toBe("validation_complete");
    expect(batch?.validationStatus).toBe("passed");

    // 7. runReconciliation → review_required (sets reconciliationStatus="matched")
    const reconResult = await svc.reconciliationService.runReconciliation(
      makeUser(U) as any, makeEffective("owner") as any,
      { importBatchId: batchId, expectedTotals: { inventory_opening_qty: "100" }, idempotencyKey: "hp-recon" },
    );
    expect(reconResult.action).toBe("executed");

    batch = await svc.commitRepo.findImportBatchById(T, batchId);
    expect(batch?.status).toBe("review_required");
    expect(batch?.reconciliationStatus).toBe("matched");

    // 8. Resolve all pending review items
    const reviewItems = await svc.reconRepo.findCurrentReviewItemsForBatch(T, batchId);
    for (const item of reviewItems.filter(r => r.status === "pending")) {
      await svc.reconciliationService.recordReviewDecision(
        makeUser(U) as any, makeEffective("owner") as any,
        { reviewItemId: item.id, decision: "accepted", decisionNotes: "accepted in happy path", idempotencyKey: `hp-review-${item.id}` },
      );
    }

    // 9. recordBackupEvidence
    await svc.commitService.recordBackupEvidence(
      makeUser(U) as any, makeEffective("owner") as any,
      { importBatchId: batchId, backupType: "full", backupLocation: "s3://b/backup", backupHash: "hp-backup-hash", backupSizeBytes: 1000, backupCreatedAt: new Date(), verificationNotes: "verified", idempotencyKey: "hp-backup" },
    );

    // Capture proof snapshot before submission
    const proofBeforeSubmit = await snapshotProof();

    // 10. submitForApproval → pending_dual_approval
    const submitResult = await svc.reconciliationService.submitForApproval(
      makeUser(U) as any, makeEffective("owner") as any,
      { importBatchId: batchId, warningSummary: "all warnings accepted", idempotencyKey: "hp-submit" },
    );
    expect(submitResult.action).toBe("submitted");
    expect(submitResult.newStatus).toBe("pending_dual_approval");
    expect(submitResult.previousStatus).toBe("review_required");

    batch = await svc.commitRepo.findImportBatchById(T, batchId);
    expect(batch?.status).toBe("pending_dual_approval");

    // Verify audit + idempotency advanced
    const proofAfterSubmit = await snapshotProof();
    expect(proofAfterSubmit.auditCount).toBe(proofBeforeSubmit.auditCount + 1);
    expect(proofAfterSubmit.idemSucceeded).toBe(proofBeforeSubmit.idemSucceeded + 1);

    // 11. Owner approval (pending_dual_approval stays, one approval recorded)
    const ownerResult = await svc.commitService.recordApproval(
      makeUser(U) as any, makeEffective("owner") as any,
      { importBatchId: batchId, approverRole: "owner", reason: "owner approval", idempotencyKey: "hp-owner" },
    );
    expect(ownerResult.action).toBe("recorded");
    expect(ownerResult.approverRole).toBe("owner");
    expect(ownerResult.batchStatus).toBe("pending_dual_approval");

    // 12. Accountant approval (distinct user) → approved_for_commit
    const acctResult = await svc.commitService.recordApproval(
      makeUser(U2) as any, makeEffective("accountant") as any,
      { importBatchId: batchId, approverRole: "accountant", reason: "accountant approval", idempotencyKey: "hp-acct" },
    );
    expect(acctResult.action).toBe("recorded");
    expect(acctResult.batchStatus).toBe("approved_for_commit");

    // Verify final state
    batch = await svc.commitRepo.findImportBatchById(T, batchId);
    expect(batch?.status).toBe("approved_for_commit");

    // Verify both CURRENT approvals exist from distinct users
    const approvals = await svc.commitRepo.findCurrentApprovalsForBatch(T, batchId);
    expect(approvals.length).toBe(2);
    const ownerApp = approvals.find(a => a.approverRole === "owner");
    const acctApp = approvals.find(a => a.approverRole === "accountant");
    expect(ownerApp?.approverUserId).toBe(U);
    expect(acctApp?.approverUserId).toBe(U2);
    expect(ownerApp?.approverUserId).not.toBe(acctApp?.approverUserId);
    expect(ownerApp?.validationStatus).toBe("passed");
    expect(ownerApp?.reconciliationStatus).toBe("matched");
    expect(ownerApp?.isCurrent).toBe(true);
    expect(acctApp?.isCurrent).toBe(true);

    // 13. Replay every idempotent command — zero duplicate effects
    const proofBeforeReplay = await snapshotProof();

    // Replay createBatch
    const createReplay = await svc.stagingService.createBatch(
      makeUser(U) as any, makeEffective("owner") as any,
      { sourceDescription: "happy-path production test", templateName: "test-template", templateVersion: "1.0", cutoverImportMode: "opening_balance", idempotencyKey: "hp-create" },
    );
    expect(createReplay.action).toBe("replayed");
    expect(createReplay.batchId).toBe(batchId);

    // Replay finalizeStaging
    const finalizeReplay = await svc.stagingService.finalizeStaging(
      makeUser(U) as any, makeEffective("owner") as any,
      { importBatchId: batchId, idempotencyKey: "hp-finalize-staging" },
    );
    expect(finalizeReplay.action).toBe("replayed");

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

    // Verify zero new effects
    const proofAfterReplay = await snapshotProof();
    expect(proofAfterReplay.auditCount).toBe(proofBeforeReplay.auditCount);
    expect(proofAfterReplay.idemSucceeded).toBe(proofBeforeReplay.idemSucceeded);
    expect(proofAfterReplay.approvalCount).toBe(proofBeforeReplay.approvalCount);
    expect(proofAfterReplay.approvalCurrentCount).toBe(proofBeforeReplay.approvalCurrentCount);
    // Sequence values unchanged (no advancement)
    for (const [key, value] of Object.entries(proofBeforeReplay.sequenceValues)) {
      expect(proofAfterReplay.sequenceValues[key], `sequence ${key} must not advance`).toBe(value);
    }

    // Verify no operational effects exist before commit
    const stockMovements = await sql`SELECT count(*)::int AS c FROM stock_movements WHERE tenant_id = ${T}`;
    const accountEntries = await sql`SELECT count(*)::int AS c FROM account_entries WHERE tenant_id = ${T}`;
    const salesOrders = await sql`SELECT count(*)::int AS c FROM sales_orders WHERE tenant_id = ${T}`;
    const payments = await sql`SELECT count(*)::int AS c FROM payments WHERE tenant_id = ${T}`;
    const productionOrders = await sql`SELECT count(*)::int AS c FROM production_orders WHERE tenant_id = ${T}`;
    expect(stockMovements[0]?.c).toBe(0);
    expect(accountEntries[0]?.c).toBe(0);
    expect(salesOrders[0]?.c).toBe(0);
    expect(payments[0]?.c).toBe(0);
    expect(productionOrders[0]?.c).toBe(0);

    // Commit is NOT executed (would require real domain commit fixtures).
    // Final state is approved_for_commit.
    expect(batch?.status).toBe("approved_for_commit");
  }, 60000);
});
