/**
 * WP-08-01F Phase 0 — Closing proofs for the three remaining gaps.
 *
 * This file proves three contracts against a real local PostgreSQL disposable
 * database. It NEVER skips when ERP_REQUIRE_WP0801F_POSTGRES_PROOF=1 +
 * ERP_ALLOW_DESTRUCTIVE_LOCAL_TEST_DB=1 are set.
 *
 * PROOF 1 — Superseded cutoverManifestHash cannot satisfy COMMIT.
 *   The existing R6-M7 test proves the superseded hash differs from the
 *   current hash after replacement+re-finalize. This test goes further:
 *   it actually calls commitBatch with an approval bound to the OLD
 *   (superseded) hash and proves commitBatch throws StaleApprovalError.
 *
 * PROOF 2 — Cross-tenant manifest isolation (read / finalize / supersede).
 *   R6-M8 only proves that a same-tenant replacement does not AFFECT another
 *   tenant's manifest. This test proves that a cross-tenant identity CANNOT:
 *     (a) READ another tenant's manifest (findCutoverManifestsForBatch
 *         returns empty when scoped by the wrong tenantId);
 *     (b) FINALIZE another tenant's manifest (finalizeCutoverManifest
 *         throws BatchNotFoundError because findImportBatchById is
 *         tenant-scoped);
 *     (c) SUPERSEDE another tenant's manifest (replaceMigrationFile throws
 *         BatchNotFoundError, zero effects on the other tenant's manifest).
 *
 * PROOF 3 — Injected failure during replacement rolls back ALL effects, then
 *   retry succeeds exactly once, then replay creates zero new effects.
 *   The existing R1-#7 test verifies file/staging rollback. This test
 *   verifies the FULL rollback contract across all 7 effect categories:
 *     (a) manifest superseding — old manifest still is_current=true
 *     (b) file-version creation — no new file row
 *     (c) staging superseding — old staging rows still is_current=true
 *     (d) findings superseding — old findings still is_current=true
 *     (e) batch hash/status resets — staged_data_hash, cutover_manifest_hash,
 *         validation_status, reconciliation_status, staged_row_count, status
 *         all UNCHANGED
 *     (f) success audit — no historical_file.replace audit row
 *     (g) succeeded idempotency — record NOT in 'succeeded' state
 *   Then:
 *     (h) retry with SAME key succeeds exactly once
 *     (i) replay with same key creates zero new effects
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/server/db/schema";
import { HistoricalStagingService } from "@/server/services/historical-staging-service";
import { HistoricalReplacementService } from "@/server/services/historical-replacement-service";
import { HistoricalCommitService } from "@/server/services/historical-commit-service";
import { HistoricalStagingDbRepository } from "@/server/services/historical-staging-db-repository";
import { HistoricalCommitDbRepository } from "@/server/services/historical-commit-db-repository";
import { HistoricalValidationDbRepository } from "@/server/services/historical-validation-db-repository";
import { AuditDbRepository } from "@/server/services/audit-db-repository";
import { IdempotencyDbRepository } from "@/server/services/idempotency-db-repository";
import { DocumentSequenceDbRepository } from "@/server/services/document-sequence-db-repository";
import { resolveEffectivePermissions } from "@/server/security/effective-permissions";
import { TEST_ROLE_PERMISSION_MATRIX } from "@/server/security/role-fixtures";
import type { RoleCode } from "@/server/security/role-codes";
import type { ErpUserContext } from "@/server/auth/erp-context";
import { getAvailableTemplates, generateTemplateCsv } from "@/server/services/migration-templates";
import { parseCsv } from "@/server/services/migration-csv-parser";
import { InMemoryPrivateFileStorage } from "./in-memory-private-file-storage";
import { StaleApprovalError } from "@/server/services/historical-commit-service";
import { BatchNotFoundError, HistoricalStagingError } from "@/server/services/historical-staging-service";

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
  console.log(`\n[WP-08-01F Phase 0 closing proofs] SKIPPED: ${SAFETY_RESULT.reason}\n`);
} else if (SAFETY_RESULT.kind === "fail") {
  SAFETY_ERROR_MESSAGE = SAFETY_RESULT.message;
  console.error(`\n[WP-08-01F Phase 0 closing proofs] SAFETY GUARD FAILED:\n${SAFETY_RESULT.message}\n`);
}

// Run-scoped tenant/user IDs
const RUN_ID = randomUUID();
const T = RUN_ID;
const T_B = randomUUID();
const U = randomUUID();
const U2 = randomUUID();

let sql: ReturnType<typeof postgres>;
let db: any;

async function cleanupRunScopedTenantData(): Promise<void> {
  await sql`DELETE FROM import_cutover_locks WHERE tenant_id = ${T} OR tenant_id = ${T_B}`;
  await sql`DELETE FROM import_backup_evidence WHERE tenant_id = ${T} OR tenant_id = ${T_B}`;
  await sql`DELETE FROM import_batch_approvals WHERE tenant_id = ${T} OR tenant_id = ${T_B}`;
  await sql`DELETE FROM import_reconciliation_results WHERE tenant_id = ${T} OR tenant_id = ${T_B}`;
  await sql`DELETE FROM import_human_review_items WHERE tenant_id = ${T} OR tenant_id = ${T_B}`;
  await sql`DELETE FROM import_validation_errors WHERE tenant_id = ${T} OR tenant_id = ${T_B}`;
  await sql`DELETE FROM import_alias_mappings WHERE tenant_id = ${T} OR tenant_id = ${T_B}`;
  await sql`DELETE FROM import_staging_cells WHERE tenant_id = ${T} OR tenant_id = ${T_B}`;
  await sql`DELETE FROM import_staging_rows WHERE tenant_id = ${T} OR tenant_id = ${T_B}`;
  await sql`DELETE FROM import_files WHERE tenant_id = ${T} OR tenant_id = ${T_B}`;
  await sql`DELETE FROM historical_correction_requests WHERE tenant_id = ${T} OR tenant_id = ${T_B}`;
  await sql`DELETE FROM import_cutover_manifests WHERE tenant_id = ${T} OR tenant_id = ${T_B}`;
  await sql`DELETE FROM import_batches WHERE tenant_id = ${T} OR tenant_id = ${T_B}`;
  await sql`DELETE FROM stock_movements WHERE tenant_id = ${T} OR tenant_id = ${T_B}`;
  await sql`DELETE FROM account_entries WHERE tenant_id = ${T} OR tenant_id = ${T_B}`;
  await sql`DELETE FROM sales_order_lines WHERE tenant_id = ${T} OR tenant_id = ${T_B}`;
  await sql`DELETE FROM sales_orders WHERE tenant_id = ${T} OR tenant_id = ${T_B}`;
  await sql`DELETE FROM payments WHERE tenant_id = ${T} OR tenant_id = ${T_B}`;
  await sql`DELETE FROM production_orders WHERE tenant_id = ${T} OR tenant_id = ${T_B}`;
  await sql`DELETE FROM operational_alerts WHERE tenant_id = ${T} OR tenant_id = ${T_B}`;
}

async function seedTenantAndUser(): Promise<void> {
  const runSuffix = RUN_ID.slice(0, 8);
  await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status)
            VALUES (${T}, ${"P0-" + runSuffix}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status)
            VALUES (${T_B}, ${"P0-B-" + runSuffix}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference)
            VALUES (${U}, ${T}, ${"p0-o-" + runSuffix}, ${"P0 Owner"}, ${"p0-o-" + runSuffix + "@test.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference)
            VALUES (${U2}, ${T}, ${"p0-a-" + runSuffix}, ${"P0 Acct"}, ${"p0-a-" + runSuffix + "@test.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
}

async function seedBatch(batchId: string, tenantId: string, userId: string, status: string, overrides: {
  stagedDataHash?: string | null;
  cutoverManifestHash?: string | null;
  validationStatus?: string | null;
  reconciliationStatus?: string | null;
  templateName?: string | null;
  stagedRowCount?: number;
} = {}): Promise<void> {
  const stagedDataHash = overrides.stagedDataHash === undefined ? "staged-hash" : overrides.stagedDataHash;
  const cutoverManifestHash = overrides.cutoverManifestHash === undefined ? "manifest-hash" : overrides.cutoverManifestHash;
  const validationStatus = overrides.validationStatus === undefined ? "passed" : overrides.validationStatus;
  const reconciliationStatus = overrides.reconciliationStatus === undefined ? "matched" : overrides.reconciliationStatus;
  const templateName = overrides.templateName ?? "opening_balance_inventory";
  const stagedRowCount = overrides.stagedRowCount ?? 5;
  await sql`
    INSERT INTO import_batches (
      id, tenant_id, batch_no, status, source_description, template_name, template_version,
      mapping_version, cutover_manifest_hash, cutover_import_mode, staged_data_hash, staged_row_count,
      blocking_error_count, warning_count, accepted_warning_count, validation_status, reconciliation_status,
      warning_summary, committed_at, commit_effect_counts, created_by, created_at
    ) VALUES (
      ${batchId}, ${tenantId}, ${"MIG-" + batchId.slice(-6)}, ${status}::import_batch_status, ${"test"}, ${templateName}, ${"1.0"},
      ${"1.0"}, ${cutoverManifestHash}, ${"opening_balance"}, ${stagedDataHash}, ${stagedRowCount},
      0, 0, 0, ${validationStatus}, ${reconciliationStatus},
      null, null, null, ${userId}, NOW()
    )`;
}

async function seedFile(batchId: string, tenantId: string, userId: string, fileHash: string, fileType: string = "source"): Promise<string> {
  const id = randomUUID();
  await sql`
    INSERT INTO import_files (id, tenant_id, import_batch_id, original_file_name, storage_path, file_hash,
      file_size_bytes, content_type, file_type, file_version, is_current, created_by, created_at, updated_at, updated_by)
    VALUES (${id}, ${tenantId}, ${batchId}, ${"original.csv"}, ${"local://test/" + fileHash}, ${fileHash},
      100, ${"text/csv"}, ${fileType}, 1, true, ${userId}, NOW(), null, null)`;
  return id;
}

async function seedStagingRow(batchId: string, tenantId: string, userId: string, fileId: string, rowNum: number): Promise<string> {
  const id = randomUUID();
  await sql`
    INSERT INTO import_staging_rows (id, tenant_id, import_batch_id, import_file_id, template_name,
      source_sheet_name, source_row_number, raw_row_json, transformed_row_json,
      transformation_notes, validation_status, review_status, ai_confidence,
      committed_entity_type, committed_entity_id, staging_version, is_current,
      created_by, created_at, updated_at, updated_by)
    VALUES (${id}, ${tenantId}, ${batchId}, ${fileId}, ${"opening_balance_inventory"}, ${"original.csv"}, ${rowNum},
      ${JSON.stringify({ code: "TEST-" + rowNum, quantity: "100" })}::jsonb,
      ${JSON.stringify({ code: "TEST-" + rowNum, quantity: "100" })}::jsonb,
      null, ${"pending"}, ${"not_required"}, null, null, null, 1, true,
      ${userId}, NOW(), null, null)`;
  return id;
}

async function seedFinding(batchId: string, tenantId: string, userId: string, rowId: string, errorCode: string): Promise<string> {
  const id = randomUUID();
  await sql`
    INSERT INTO import_validation_errors (id, tenant_id, import_batch_id, staging_row_id, severity, error_code, message, field_name, is_blocking, resolution_status, finding_version, is_current, created_by, created_at, updated_at, updated_by)
    VALUES (${id}, ${tenantId}, ${batchId}, ${rowId}, ${"blocking_error"}::validation_severity, ${errorCode}, ${"test"}, ${"quantity"}, true, ${"open"}, 1, true, ${userId}, NOW(), null, null)`;
  return id;
}

async function seedManifest(batchId: string, tenantId: string, userId: string, manifestHash: string): Promise<string> {
  const id = randomUUID();
  await sql`
    INSERT INTO import_cutover_manifests (id, tenant_id, import_batch_id, domain, import_mode,
      cutoff_date, source_coverage, opening_balance_basis, live_system_start_boundary,
      reconciliation_owner, manifest_hash, is_approved, manifest_version, is_current, created_by, created_at, updated_at, updated_by)
    VALUES (${id}, ${tenantId}, ${batchId}, ${"inventory"}, ${"opening_balance"},
      ${"2024-01-01"}, ${"all"}, ${"audit"}, null, null, ${manifestHash}, false, 1, true, ${userId}, NOW(), null, null)`;
  return id;
}

async function seedApproval(batchId: string, tenantId: string, userId: string, role: string, stagedHash: string, manifestHash: string): Promise<string> {
  const id = randomUUID();
  await sql`
    INSERT INTO import_batch_approvals (id, tenant_id, import_batch_id, approver_role, approver_user_id,
      staged_data_hash, cutover_manifest_hash, template_version, mapping_version,
      validation_status, reconciliation_status, warning_summary, approved_at, reason,
      approval_version, is_current, created_by, created_at, updated_at, updated_by)
    VALUES (${id}, ${tenantId}, ${batchId}, ${role}::migration_approver_role, ${userId},
      ${stagedHash}, ${manifestHash}, ${"1.0"}, ${"1.0"},
      ${"passed"}, ${"matched"}, null, NOW(), ${"test"},
      1, true, ${userId}, NOW(), null, null)`;
  return id;
}

async function seedBackupEvidence(batchId: string, tenantId: string, userId: string): Promise<void> {
  await sql`
    INSERT INTO import_backup_evidence (id, tenant_id, import_batch_id, backup_type, backup_location, backup_hash, backup_size_bytes, backup_created_at, verification_notes, created_by, created_at, updated_at, updated_by)
    VALUES (${randomUUID()}, ${tenantId}, ${batchId}, ${"full"}, ${"s3://b/backup"}, ${"backup-hash"}, 1000, NOW(), ${"verified"}, ${userId}, NOW(), null, null)`;
}

function makeUser(userId: string = U, tenantId: string = T): ErpUserContext {
  return { authenticated: true, userId, tenantId, authId: `auth-${userId}`, name: "Test", email: `test-${userId}@test.local` };
}
function makeEffective(role: RoleCode = "owner") {
  return resolveEffectivePermissions([role], TEST_ROLE_PERMISSION_MATRIX);
}

function makeServices(storage: InMemoryPrivateFileStorage) {
  const stagingRepo = new HistoricalStagingDbRepository(db);
  const commitRepo = new HistoricalCommitDbRepository(db);
  const audit = new AuditDbRepository(db);
  const idem = new IdempotencyDbRepository(db);
  const docSeq = new DocumentSequenceDbRepository(db);
  const stagingService = new HistoricalStagingService({ repository: stagingRepo, audit, idempotency: idem, documentSequence: docSeq, transactionRunner: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => (db as any).transaction(async (tx: any) => work(tx)), createStagingRepository: (tx: unknown) => new HistoricalStagingDbRepository(tx as any), createAudit: (tx: unknown) => new AuditDbRepository(tx as any), createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any) });
  const transactionRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
    (db as any).transaction(async (tx: any) => work(tx));
  const replacementService = new HistoricalReplacementService({
    repository: stagingRepo,
    audit,
    idempotency: idem,
    transactionRunner,
    createStagingRepository: (tx: unknown) => new HistoricalStagingDbRepository(tx as any),
    createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
    createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
    invalidateCurrentApprovals: async (tx: unknown, tenantId: string, batchId: string, invalidatedBy: string, reason: string) => {
      const txCommitRepo = new HistoricalCommitDbRepository(tx as any);
      return txCommitRepo.invalidateCurrentApprovalsForBatch(tenantId, batchId, invalidatedBy, reason);
    },
  });
  const txFactories = {
    createCommitRepository: (tx: unknown) => new HistoricalCommitDbRepository(tx as any),
    createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
    createInventoryLedger: () => ({ requireCutoverLock: async () => {} } as any),
    createSubledger: () => ({ requireCutoverLock: async () => {} } as any),
    createDocumentSequence: (tx: unknown) => new DocumentSequenceDbRepository(tx as any),
  };
  const commitService = new HistoricalCommitService({ repository: commitRepo, audit, idempotency: idem, transactionRunner, txFactories });
  return { stagingService, replacementService, commitService, commitRepo, stagingRepo };
}

function buildInventoryCsv(rowCount: number): { csv: string; template: any } {
  const template = getAvailableTemplates()[0]!;
  const csv = generateTemplateCsv(template);
  const lines = csv.trim().split("\n");
  const header = lines[0]!;
  const dataRows: string[] = [];
  for (let i = 1; i <= rowCount; i++) {
    dataRows.push(`raw_yarn,Yarn ${i},RY-${String(i).padStart(3, "0")},100,kg,2024-01-01,00000000-0000-4000-8000-item${String(i).padStart(11, "0")}`);
  }
  return { csv: header + "\n" + dataRows.join("\n") + "\n", template };
}

describeOrSkip("WP-08-01F Phase 0 — Closing proofs", () => {
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
  // PROOF 1 — Superseded cutoverManifestHash cannot satisfy COMMIT
  // ===========================================================================
  describe("PROOF 1 — superseded manifest hash blocks commit", () => {
    it("P1. commitBatch throws StaleApprovalError when approval bound to superseded manifest hash", async () => {
      const { stagingService, commitService, commitRepo } = makeServices(new InMemoryPrivateFileStorage());
      const batchId = randomUUID();
      const oldManifestHash = "old-manifest-hash-p1";
      const newManifestHash = "new-manifest-hash-p1-direct";
      const oldStagedHash = "old-staged-hash-p1";

      // Seed batch at approved_for_commit with old hash H1 (inventory domain)
      await seedBatch(batchId, T, U, "approved_for_commit", {
        stagedDataHash: oldStagedHash,
        cutoverManifestHash: oldManifestHash,
        validationStatus: "passed",
        reconciliationStatus: "matched",
        stagedRowCount: 1,
      });
      const oldFileId = await seedFile(batchId, T, U, "sha256:p1-old");
      await seedStagingRow(batchId, T, U, oldFileId, 1);
      await seedManifest(batchId, T, U, oldManifestHash);

      // Seed BOTH approvals bound to the OLD manifest hash H1
      await seedApproval(batchId, T, U, "owner", oldStagedHash, oldManifestHash);
      await seedApproval(batchId, T, U2, "accountant", oldStagedHash, oldManifestHash);
      await seedBackupEvidence(batchId, T, U);

      // Verify batch is at approved_for_commit before manifest change
      let batch = await commitRepo.findImportBatchById(T, batchId);
      expect(batch?.status).toBe("approved_for_commit");
      expect(batch?.cutoverManifestHash).toBe(oldManifestHash);

      // BLOCKER 2: finalizeCutoverManifest now rejects approved_for_commit.
      // To simulate a stale manifest hash (the property this test proves),
      // we directly update the batch's cutoverManifestHash via SQL, as if
      // a material change had occurred through a different lifecycle path.
      // The OLD approvals remain bound to H1 → they are now stale.
      await sql`UPDATE import_batches SET cutover_manifest_hash = ${newManifestHash} WHERE id = ${batchId} AND tenant_id = ${T}`;

      // Verify the batch's current cutoverManifestHash now differs from oldManifestHash
      batch = await commitRepo.findImportBatchById(T, batchId);
      expect(batch?.cutoverManifestHash).toBe(newManifestHash);
      expect(batch?.cutoverManifestHash).not.toBe(oldManifestHash);

      // Attempt COMMIT — approvals are bound to the OLD (superseded) hash H1,
      // but the batch now has H2. The commit service must detect the stale
      // approval and throw StaleApprovalError.
      await expect(
        commitService.commitBatch(makeUser() as any, makeEffective("owner") as any, {
          importBatchId: batchId, idempotencyKey: "p1-commit-attempt",
        }),
      ).rejects.toBeInstanceOf(StaleApprovalError);

      // Verify batch was NOT committed
      const batchAfter = await commitRepo.findImportBatchById(T, batchId);
      expect(batchAfter?.status).not.toBe("committed");
      expect(batchAfter?.committedAt).toBeNull();
    });
  });

  // ===========================================================================
  // PROOF 2 — Cross-tenant manifest isolation (read / finalize / supersede)
  // ===========================================================================
  describe("PROOF 2 — cross-tenant manifest isolation", () => {
    it("P2a. cross-tenant READ returns empty (tenant B cannot read tenant A manifests)", async () => {
      const batchA = randomUUID();
      await seedBatch(batchA, T, U, "validation_complete", {
        stagedDataHash: "h", cutoverManifestHash: "mh-a",
      });
      await seedManifest(batchA, T, U, "manifest-hash-a");

      // Tenant A can read its own manifest
      const stagingRepoA = new HistoricalStagingDbRepository(db);
      const manifestsA = await stagingRepoA.findCutoverManifestsForBatch(T, batchA);
      expect(manifestsA.length).toBe(1);
      expect(manifestsA[0]!.manifestHash).toBe("manifest-hash-a");

      // Tenant B attempting to read tenant A's manifest → empty (tenant-scoped query)
      const manifestsB = await stagingRepoA.findCutoverManifestsForBatch(T_B, batchA);
      expect(manifestsB.length).toBe(0);
    });

    it("P2b. cross-tenant FINALIZE throws BatchNotFoundError (tenant B cannot finalize tenant A manifest)", async () => {
      const { stagingService } = makeServices(new InMemoryPrivateFileStorage());
      const batchA = randomUUID();
      await seedBatch(batchA, T, U, "staged", {
        stagedDataHash: "h", cutoverManifestHash: null, validationStatus: null, reconciliationStatus: null,
      });
      const oldFileId = await seedFile(batchA, T, U, "sha256:p2b");
      await seedStagingRow(batchA, T, U, oldFileId, 1);

      // Tenant B user attempts to finalize a manifest on tenant A's batch
      const userB = makeUser(U, T_B); // same userId but tenant B
      await expect(
        stagingService.finalizeCutoverManifest(userB as any, makeEffective() as any, {
          importBatchId: batchA, domain: "inventory", cutoffDate: "2024-01-01",
          sourceCoverage: "all", openingBalanceBasis: "audit", liveSystemStartBoundary: null,
          idempotencyKey: "p2b-finalize-cross-tenant",
        }),
      ).rejects.toBeInstanceOf(BatchNotFoundError);

      // Verify NO manifest was created for tenant A or tenant B
      const manifestsA = await sql`SELECT count(*)::int AS c FROM import_cutover_manifests WHERE import_batch_id = ${batchA}`;
      expect(manifestsA[0]!.c).toBe(0);
      const manifestsB = await sql`SELECT count(*)::int AS c FROM import_cutover_manifests WHERE tenant_id = ${T_B}`;
      expect(manifestsB[0]!.c).toBe(0);
    });

    it("P2c. cross-tenant SUPERSEDE throws BatchNotFoundError + zero effects on tenant A manifest", async () => {
      const storage = new InMemoryPrivateFileStorage();
      const { replacementService } = makeServices(storage);
      const batchA = randomUUID();
      const manifestHashA = "manifest-hash-p2c";
      await seedBatch(batchA, T, U, "validation_complete", {
        stagedDataHash: "h", cutoverManifestHash: manifestHashA,
      });
      const oldFileId = await seedFile(batchA, T, U, "sha256:p2c-old");
      await seedManifest(batchA, T, U, manifestHashA);

      // Tenant B user attempts to replace tenant A's file → supersede tenant A's manifest
      const userB = makeUser(U, T_B);
      const { csv, template } = buildInventoryCsv(1);
      const parseResult = parseCsv(csv, template);
      const storedFile = await storage.store(T_B, batchA, "p2c-replace", "r.csv", Buffer.from(csv), "text/csv");

      // The replacement service is tenant-scoped: findImportBatchById(T_B, batchA)
      // returns null (batch belongs to T, not T_B). The service throws
      // HistoricalReplacementError with code BATCH_NOT_FOUND.
      await expect(
        replacementService.replaceMigrationFile(userB as any, makeEffective() as any, {
          importBatchId: batchA, replaceFileId: oldFileId,
          originalFileName: "r.csv", storagePath: storedFile.storagePath,
          fileHash: storedFile.fileHash, fileSizeBytes: storedFile.fileSizeBytes,
          contentType: storedFile.contentType, fileType: "source",
          parsedRows: parseResult.rows, templateType: "opening_balance_inventory",
          reworkReason: "P2c: cross-tenant supersede", idempotencyKey: "p2c-cross-tenant",
        }),
      ).rejects.toThrow(/BATCH_NOT_FOUND|not found/);

      // Verify tenant A's manifest is UNCHANGED — still is_current=true, same hash
      const manifestA = await sql`SELECT is_current, manifest_hash, superseded_at FROM import_cutover_manifests WHERE tenant_id = ${T} AND import_batch_id = ${batchA}`;
      expect(manifestA[0]!.is_current).toBe(true);
      expect(manifestA[0]!.manifest_hash).toBe(manifestHashA);
      expect(manifestA[0]!.superseded_at).toBeNull();

      // Verify tenant A's file is UNCHANGED — still is_current=true
      const fileA = await sql`SELECT is_current FROM import_files WHERE id = ${oldFileId}`;
      expect(fileA[0]!.is_current).toBe(true);

      // Verify NO new file/staging/manifest rows were created for either tenant
      const newFiles = await sql`SELECT count(*)::int AS c FROM import_files WHERE tenant_id = ${T} AND import_batch_id = ${batchA} AND id != ${oldFileId}`;
      expect(newFiles[0]!.c).toBe(0);
      const newManifests = await sql`SELECT count(*)::int AS c FROM import_cutover_manifests WHERE tenant_id = ${T_B}`;
      expect(newManifests[0]!.c).toBe(0);
    });
  });

  // ===========================================================================
  // PROOF 3 — Injected failure during replacement rolls back ALL effects
  //           + retry succeeds exactly once + replay creates zero new effects
  // ===========================================================================
  describe("PROOF 3 — comprehensive rollback + retry + replay", () => {
    it("P3. injected failure rolls back ALL 7 effect categories, retry succeeds exactly once, replay creates zero new effects", async () => {
      const storage = new InMemoryPrivateFileStorage();
      const batchId = randomUUID();
      const originalStagedHash = "original-staged-p3";
      const originalManifestHash = "original-manifest-p3";
      const originalValidationStatus = "passed";
      const originalReconciliationStatus = "matched";
      const originalStagedRowCount = 1;

      // Seed batch at validation_complete with ALL artifacts
      await seedBatch(batchId, T, U, "validation_complete", {
        stagedDataHash: originalStagedHash,
        cutoverManifestHash: originalManifestHash,
        validationStatus: originalValidationStatus,
        reconciliationStatus: originalReconciliationStatus,
        stagedRowCount: originalStagedRowCount,
      });
      const oldFileId = await seedFile(batchId, T, U, "sha256:p3-old");
      const oldRowId = await seedStagingRow(batchId, T, U, oldFileId, 1);
      const oldFindingId = await seedFinding(batchId, T, U, oldRowId, "P3_OLD_FINDING");
      await seedManifest(batchId, T, U, originalManifestHash);

      // Build the replacement CSV + storage object
      const { csv, template } = buildInventoryCsv(1);
      const parseResult = parseCsv(csv, template);
      const storedFile = await storage.store(T, batchId, "p3-replace", "r.csv", Buffer.from(csv), "text/csv");

      // Capture BEFORE state
      const beforeAuditCount = (await sql`SELECT count(*)::int AS c FROM audit_logs WHERE tenant_id = ${T}`)[0]!.c;
      const beforeReplaceAuditCount = (await sql`SELECT count(*)::int AS c FROM audit_logs WHERE tenant_id = ${T} AND action_type = 'historical_file.replace'`)[0]!.c;
      const beforeIdemCount = (await sql`SELECT count(*)::int AS c FROM idempotency_records WHERE tenant_id = ${T}`)[0]!.c;

      // Build a FAULTY service that throws AFTER the transaction work completes.
      // This forces a full rollback of every write inside the transaction.
      const stagingRepo = new HistoricalStagingDbRepository(db);
      const commitRepo = new HistoricalCommitDbRepository(db);
      const audit = new AuditDbRepository(db);
      const idem = new IdempotencyDbRepository(db);
      const faultyTransactionRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
        return (db as any).transaction(async (tx: any) => {
          await work(tx);
          throw new Error("INJECTED_P3_FAILURE");
        });
      };
      const faultyService = new HistoricalReplacementService({
        repository: stagingRepo, audit, idempotency: idem,
        transactionRunner: faultyTransactionRunner,
        createStagingRepository: (tx: unknown) => new HistoricalStagingDbRepository(tx as any),
        createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
        createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
        invalidateCurrentApprovals: async (tx: unknown, tenantId: string, batchId: string, invalidatedBy: string, reason: string) => {
          const txCommitRepo = new HistoricalCommitDbRepository(tx as any);
          return txCommitRepo.invalidateCurrentApprovalsForBatch(tenantId, batchId, invalidatedBy, reason);
        },
      });

      // Construct the IDENTICAL input object for all three attempts (failure, retry, replay).
      // The request body MUST be byte-identical for idempotency replay/conflict semantics.
      const replaceInput = {
        importBatchId: batchId, replaceFileId: oldFileId,
        originalFileName: "r.csv", storagePath: storedFile.storagePath,
        fileHash: storedFile.fileHash, fileSizeBytes: storedFile.fileSizeBytes,
        contentType: storedFile.contentType, fileType: "source",
        parsedRows: parseResult.rows, templateType: "opening_balance_inventory",
        reworkReason: "P3: identical retry", idempotencyKey: "p3-retry-key",
      };

      // --- ATTEMPT 1: Failure ---
      await expect(
        faultyService.replaceMigrationFile(makeUser() as any, makeEffective() as any, replaceInput),
      ).rejects.toThrow(/INJECTED_P3_FAILURE/);

      // --- VERIFY ALL 7 ROLLBACK CATEGORIES ---
      // (a) manifest superseding rolled back — old manifest still is_current=true
      const manifestAfter = await sql`SELECT is_current, manifest_hash, superseded_at FROM import_cutover_manifests WHERE tenant_id = ${T} AND import_batch_id = ${batchId}`;
      expect(manifestAfter.length).toBe(1);
      expect(manifestAfter[0]!.is_current).toBe(true);
      expect(manifestAfter[0]!.manifest_hash).toBe(originalManifestHash);
      expect(manifestAfter[0]!.superseded_at).toBeNull();

      // (b) file-version creation rolled back — no new file row
      const newFiles = await sql`SELECT count(*)::int AS c FROM import_files WHERE tenant_id = ${T} AND import_batch_id = ${batchId} AND id != ${oldFileId}`;
      expect(newFiles[0]!.c).toBe(0);

      // (c) staging superseding rolled back — old staging rows still is_current=true
      const oldStagingRows = await sql`SELECT is_current, superseded_by_file_id FROM import_staging_rows WHERE id = ${oldRowId}`;
      expect(oldStagingRows[0]!.is_current).toBe(true);
      expect(oldStagingRows[0]!.superseded_by_file_id).toBeNull();

      // (d) findings superseding rolled back — old findings still is_current=true
      const oldFindings = await sql`SELECT is_current, superseded_at FROM import_validation_errors WHERE id = ${oldFindingId}`;
      expect(oldFindings[0]!.is_current).toBe(true);
      expect(oldFindings[0]!.superseded_at).toBeNull();

      // (e) batch hash/status resets rolled back — all original values preserved
      const batchAfter = await sql`SELECT status, staged_data_hash, cutover_manifest_hash, validation_status, reconciliation_status, staged_row_count FROM import_batches WHERE id = ${batchId}`;
      expect(batchAfter[0]!.status).toBe("validation_complete");
      expect(batchAfter[0]!.staged_data_hash).toBe(originalStagedHash);
      expect(batchAfter[0]!.cutover_manifest_hash).toBe(originalManifestHash);
      expect(batchAfter[0]!.validation_status).toBe(originalValidationStatus);
      expect(batchAfter[0]!.reconciliation_status).toBe(originalReconciliationStatus);
      expect(batchAfter[0]!.staged_row_count).toBe(originalStagedRowCount);

      // (f) success audit rolled back — the historical_file.replace audit row
      // that was inserted inside the transaction must NOT exist after rollback.
      // Compare the total audit count before vs after (must be unchanged).
      const afterAuditCount = (await sql`SELECT count(*)::int AS c FROM audit_logs WHERE tenant_id = ${T}`)[0]!.c;
      expect(afterAuditCount).toBe(beforeAuditCount);
      // Also verify no NEW historical_file.replace audit row was created
      const afterReplaceAuditCount = (await sql`SELECT count(*)::int AS c FROM audit_logs WHERE tenant_id = ${T} AND action_type = 'historical_file.replace'`)[0]!.c;
      expect(afterReplaceAuditCount).toBe(beforeReplaceAuditCount);

      // (g) succeeded idempotency rolled back — record NOT in 'succeeded' state
      const idemRecord = await sql`SELECT state FROM idempotency_records WHERE tenant_id = ${T} AND idempotency_key = 'p3-retry-key'`;
      expect(idemRecord.length).toBe(1);
      expect(idemRecord[0]!.state).not.toBe("succeeded");
      // WP-08-01F Phase 0 fix: transient failure marks as retryable_failed (not business_failed)
      expect(idemRecord[0]!.state).toBe("retryable_failed");

      // --- ATTEMPT 2: Retry with SAME key → succeeds exactly once ---
      // The replacement service now uses markRetryableFailed, so claimExpiredLease
      // reclaims the record immediately on the next call with the same key.
      const goodService = makeServices(storage).replacementService;
      const retryResult = await goodService.replaceMigrationFile(makeUser() as any, makeEffective() as any, replaceInput);
      expect(retryResult.action).toBe("created");
      expect(retryResult.newFileId).toBeTruthy();
      const retryNewFileId = retryResult.newFileId!;

      // Verify the retry actually created the effects (exactly one new file, one new audit, etc.)
      const filesAfterRetry = await sql`SELECT count(*)::int AS c FROM import_files WHERE tenant_id = ${T} AND import_batch_id = ${batchId} AND id != ${oldFileId}`;
      expect(filesAfterRetry[0]!.c).toBe(1); // exactly one new file

      const replaceAuditsAfterRetry = await sql`SELECT count(*)::int AS c FROM audit_logs WHERE tenant_id = ${T} AND action_type = 'historical_file.replace'`;
      expect(replaceAuditsAfterRetry[0]!.c).toBe(1); // exactly one audit

      const idemAfterRetry = await sql`SELECT state, attempt_count FROM idempotency_records WHERE tenant_id = ${T} AND idempotency_key = 'p3-retry-key'`;
      expect(idemAfterRetry[0]!.state).toBe("succeeded");
      expect(idemAfterRetry[0]!.attempt_count).toBe(2); // first attempt (failed) + retry (succeeded)

      // --- ATTEMPT 3: Replay with SAME key → zero new effects ---
      const beforeReplayFiles = (await sql`SELECT count(*)::int AS c FROM import_files WHERE tenant_id = ${T}`)[0]!.c;
      const beforeReplayAudits = (await sql`SELECT count(*)::int AS c FROM audit_logs WHERE tenant_id = ${T}`)[0]!.c;
      const beforeReplayIdem = (await sql`SELECT count(*)::int AS c FROM idempotency_records WHERE tenant_id = ${T}`)[0]!.c;

      const replayResult = await goodService.replaceMigrationFile(makeUser() as any, makeEffective() as any, replaceInput);
      expect(replayResult.action).toBe("replayed");
      expect(replayResult.newFileId).toBe(retryNewFileId);

      const afterReplayFiles = (await sql`SELECT count(*)::int AS c FROM import_files WHERE tenant_id = ${T}`)[0]!.c;
      const afterReplayAudits = (await sql`SELECT count(*)::int AS c FROM audit_logs WHERE tenant_id = ${T}`)[0]!.c;
      const afterReplayIdem = (await sql`SELECT count(*)::int AS c FROM idempotency_records WHERE tenant_id = ${T}`)[0]!.c;

      expect(afterReplayFiles).toBe(beforeReplayFiles);
      expect(afterReplayAudits).toBe(beforeReplayAudits);
      expect(afterReplayIdem).toBe(beforeReplayIdem);
    });
  });
});
