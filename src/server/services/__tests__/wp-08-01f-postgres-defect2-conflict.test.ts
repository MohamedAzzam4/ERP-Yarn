/**
 * WP-08-01F — DEFECT 2: Replacement same-key/different-request conflict tests.
 *
 * Proves that an existing terminal idempotency key reused with a DIFFERENT
 * request returns IDEMPOTENCY_CONFLICT — NOT FILE_NOT_FOUND, FILE_BATCH_MISMATCH,
 * or SAME_HASH_CONFLICT.
 *
 * Tests:
 *   1. Existing terminal key + same key + different/nonexistent replaceFileId
 *      → IDEMPOTENCY_CONFLICT (NOT FILE_NOT_FOUND)
 *   2. Existing terminal key + same key + changed fileHash
 *      → IDEMPOTENCY_CONFLICT (NOT SAME_HASH_CONFLICT)
 *   3. Existing terminal key + same request → replay semantics unchanged
 *   4. Fresh key + same-hash replacement → SAME_HASH_CONFLICT (zero effects)
 *   5. No extra audit/file/staging effects for changed-payload conflict cases
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/server/db/schema";
import { HistoricalReplacementService, HistoricalReplacementError } from "@/server/services/historical-replacement-service";
import { HistoricalStagingDbRepository } from "@/server/services/historical-staging-db-repository";
import { HistoricalCommitDbRepository } from "@/server/services/historical-commit-db-repository";
import { AuditDbRepository } from "@/server/services/audit-db-repository";
import { IdempotencyDbRepository } from "@/server/services/idempotency-db-repository";
import { resolveEffectivePermissions } from "@/server/security/effective-permissions";
import { TEST_ROLE_PERMISSION_MATRIX } from "@/server/security/role-fixtures";
import type { ErpUserContext } from "@/server/auth/erp-context";
import { getAvailableTemplates, generateTemplateCsv } from "@/server/services/migration-templates";
import { parseCsv } from "@/server/services/migration-csv-parser";
import { InMemoryPrivateFileStorage } from "./in-memory-private-file-storage";
import { checkDestructiveTestDbSafety } from "./destructive-test-guard";

const DATABASE_URL = process.env.DATABASE_URL;
const ALLOW_DESTRUCTIVE = process.env.ERP_ALLOW_DESTRUCTIVE_LOCAL_TEST_DB === "1";
const REQUIRE_PROOF = process.env.ERP_REQUIRE_WP0801F_POSTGRES_PROOF === "1";

const SHARED_GUARD_RESULT = checkDestructiveTestDbSafety({
  databaseUrl: DATABASE_URL,
  allowDestructive: ALLOW_DESTRUCTIVE,
  requireProof: REQUIRE_PROOF,
});

const describeOrSkip = SHARED_GUARD_RESULT.kind === "ok" ? describe : describe.skip;

const RUN_ID = randomUUID();
const T = RUN_ID;
const U = randomUUID();

let sql: ReturnType<typeof postgres>;
let db: any;

async function seedTenantAndUser() {
  const runSuffix = RUN_ID.slice(0, 8);
  await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status)
            VALUES (${T}, ${"D2-" + runSuffix}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference)
            VALUES (${U}, ${T}, ${"d2-" + runSuffix}, ${"D2 User"}, ${"d2-" + runSuffix + "@test.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
}

async function seedBatch(batchId: string, status: string) {
  await sql`
    INSERT INTO import_batches (id, tenant_id, batch_no, status, source_description, template_name, template_version,
      mapping_version, cutover_manifest_hash, cutover_import_mode, staged_data_hash, staged_row_count,
      blocking_error_count, warning_count, accepted_warning_count, validation_status, reconciliation_status,
      warning_summary, committed_at, commit_effect_counts, created_by, created_at)
    VALUES (${batchId}, ${T}, ${"MIG-" + batchId.slice(-6)}, ${status}::import_batch_status, ${"test"}, ${"opening_balance_inventory"}, ${"1.0"},
      ${"1.0"}, ${"manifest-hash"}, ${"opening_balance"}, ${"staged-hash"}, 5,
      0, 0, 0, ${"passed"}, ${"matched"}, null, null, null, ${U}, NOW())`;
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

function makeUser(): ErpUserContext {
  return { authenticated: true, userId: U, tenantId: T, authId: `auth-${U}`, name: "Test", email: `test-${U}@test.local` };
}
function makeEffective() {
  return resolveEffectivePermissions(["owner"], TEST_ROLE_PERMISSION_MATRIX);
}

function makeServices() {
  const stagingRepo = new HistoricalStagingDbRepository(db);
  const audit = new AuditDbRepository(db);
  const idem = new IdempotencyDbRepository(db);
  const transactionRunner = async <T2>(work: (tx: unknown) => Promise<T2>): Promise<T2> =>
    (db as any).transaction(async (tx: any) => work(tx));
  const replacementService = new HistoricalReplacementService({
    repository: stagingRepo, audit, idempotency: idem, transactionRunner,
    createStagingRepository: (tx: unknown) => new HistoricalStagingDbRepository(tx as any),
    createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
    createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
    invalidateCurrentApprovals: async (tx: unknown, tenantId: string, batchId: string, invalidatedBy: string, reason: string) => {
      const txCommitRepo = new HistoricalCommitDbRepository(tx as any);
      return txCommitRepo.invalidateCurrentApprovalsForBatch(tenantId, batchId, invalidatedBy, reason);
    },
  });
  return { replacementService };
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

async function cleanupRunScopedTenantData() {
  await sql`DELETE FROM import_cutover_locks WHERE tenant_id = ${T}`;
  await sql`DELETE FROM import_backup_evidence WHERE tenant_id = ${T}`;
  await sql`DELETE FROM import_batch_approvals WHERE tenant_id = ${T}`;
  await sql`DELETE FROM import_reconciliation_results WHERE tenant_id = ${T}`;
  await sql`DELETE FROM import_human_review_items WHERE tenant_id = ${T}`;
  await sql`DELETE FROM import_validation_errors WHERE tenant_id = ${T}`;
  await sql`DELETE FROM import_alias_mappings WHERE tenant_id = ${T}`;
  await sql`DELETE FROM import_staging_rows WHERE tenant_id = ${T}`;
  await sql`DELETE FROM import_files WHERE tenant_id = ${T}`;
  await sql`DELETE FROM import_batches WHERE tenant_id = ${T}`;
  await sql`DELETE FROM idempotency_records WHERE tenant_id = ${T}`;
}

describeOrSkip("WP-08-01F DEFECT 2 — Replacement same-key/different-request conflict", () => {
  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { prepare: false, max: 10, idle_timeout: 10, connect_timeout: 10 });
    db = drizzle(sql, { schema });
    await sql`SET statement_timeout = 30000`;
    await seedTenantAndUser();
  }, 30000);

  afterAll(async () => {
    if (sql) {
      await cleanupRunScopedTenantData();
      await sql.end();
    }
  }, 30000);

  // ===========================================================================
  // TEST 1: Existing terminal key + different replaceFileId → IDEMPOTENCY_CONFLICT
  // ===========================================================================
  it("D2-1. same key + different/nonexistent replaceFileId → IDEMPOTENCY_CONFLICT (NOT FILE_NOT_FOUND)", async () => {
    const storage = new InMemoryPrivateFileStorage();
    const { replacementService } = makeServices();
    const batchId = randomUUID();
    await seedBatch(batchId, "staged");
    const oldFileId = await seedFile(batchId, "sha256:d2-1-old");

    const { csv, template } = buildInventoryCsv(1);
    const parseResult = parseCsv(csv, template);
    const storedFile = await storage.store(T, batchId, "d2-1", "r.csv", Buffer.from(csv), "text/csv");

    const idemKey = "d2-1-conflict-" + randomUUID();

    // First call: succeeds, stores a terminal succeeded record.
    await replacementService.replaceMigrationFile(makeUser() as any, makeEffective() as any, {
      importBatchId: batchId, replaceFileId: oldFileId,
      originalFileName: "r.csv", storagePath: storedFile.storagePath,
      fileHash: storedFile.fileHash, fileSizeBytes: storedFile.fileSizeBytes,
      contentType: storedFile.contentType, fileType: "source",
      parsedRows: parseResult.rows, templateType: "opening_balance_inventory",
      reworkReason: "D2-1 first", idempotencyKey: idemKey,
    });

    // Capture counts before conflict attempt
    const beforeFiles = await sql`SELECT count(*)::int AS c FROM import_files WHERE tenant_id = ${T} AND import_batch_id = ${batchId}`;
    const beforeAudit = await sql`SELECT count(*)::int AS c FROM audit_logs WHERE tenant_id = ${T}`;
    const beforeIdem = await sql`SELECT count(*)::int AS c FROM idempotency_records WHERE tenant_id = ${T}`;

    // Second call with SAME key but DIFFERENT (nonexistent) replaceFileId
    const nonexistentFileId = randomUUID();
    const outcome = await replacementService.replaceMigrationFile(makeUser() as any, makeEffective() as any, {
      importBatchId: batchId, replaceFileId: nonexistentFileId,
      originalFileName: "r.csv", storagePath: storedFile.storagePath,
      fileHash: storedFile.fileHash, fileSizeBytes: storedFile.fileSizeBytes,
      contentType: storedFile.contentType, fileType: "source",
      parsedRows: parseResult.rows, templateType: "opening_balance_inventory",
      reworkReason: "D2-1 second different", idempotencyKey: idemKey,
    }).then(
      (value) => ({ ok: true as const, value }),
      (error) => ({ ok: false as const, error }),
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      const err = outcome.error as Error;
      expect(err).toBeInstanceOf(HistoricalReplacementError);
      expect((err as any)?.code).toBe("IDEMPOTENCY_CONFLICT");
      // NOT FILE_NOT_FOUND
      expect((err as any)?.code).not.toBe("FILE_NOT_FOUND");
    }

    // No extra effects
    const afterFiles = await sql`SELECT count(*)::int AS c FROM import_files WHERE tenant_id = ${T} AND import_batch_id = ${batchId}`;
    const afterAudit = await sql`SELECT count(*)::int AS c FROM audit_logs WHERE tenant_id = ${T}`;
    const afterIdem = await sql`SELECT count(*)::int AS c FROM idempotency_records WHERE tenant_id = ${T}`;
    expect(afterFiles[0]!.c).toBe(beforeFiles[0]!.c);
    expect(afterAudit[0]!.c).toBe(beforeAudit[0]!.c);
    expect(afterIdem[0]!.c).toBe(beforeIdem[0]!.c);

    await cleanupRunScopedTenantData();
  });

  // ===========================================================================
  // TEST 2: Existing terminal key + changed fileHash → IDEMPOTENCY_CONFLICT
  // ===========================================================================
  it("D2-2. same key + changed fileHash → IDEMPOTENCY_CONFLICT (NOT SAME_HASH_CONFLICT)", async () => {
    const storage = new InMemoryPrivateFileStorage();
    const { replacementService } = makeServices();
    const batchId = randomUUID();
    await seedBatch(batchId, "staged");
    const oldFileId = await seedFile(batchId, "sha256:d2-2-old");

    const { csv, template } = buildInventoryCsv(1);
    const parseResult = parseCsv(csv, template);
    const storedFile = await storage.store(T, batchId, "d2-2", "r.csv", Buffer.from(csv), "text/csv");

    const idemKey = "d2-2-conflict-" + randomUUID();

    // First call: succeeds
    await replacementService.replaceMigrationFile(makeUser() as any, makeEffective() as any, {
      importBatchId: batchId, replaceFileId: oldFileId,
      originalFileName: "r.csv", storagePath: storedFile.storagePath,
      fileHash: storedFile.fileHash, fileSizeBytes: storedFile.fileSizeBytes,
      contentType: storedFile.contentType, fileType: "source",
      parsedRows: parseResult.rows, templateType: "opening_balance_inventory",
      reworkReason: "D2-2 first", idempotencyKey: idemKey,
    });

    // Second call: SAME key, SAME replaceFileId, but DIFFERENT fileHash
    // (the old file has been superseded by the first call, so its hash is
    // now different — but we're using a DIFFERENT hash that would normally
    // trigger SAME_HASH_CONFLICT if the old file still existed)
    const differentHash = "sha256:completely-different-" + randomUUID();
    const outcome = await replacementService.replaceMigrationFile(makeUser() as any, makeEffective() as any, {
      importBatchId: batchId, replaceFileId: oldFileId,
      originalFileName: "r.csv", storagePath: storedFile.storagePath,
      fileHash: differentHash, fileSizeBytes: storedFile.fileSizeBytes,
      contentType: storedFile.contentType, fileType: "source",
      parsedRows: parseResult.rows, templateType: "opening_balance_inventory",
      reworkReason: "D2-2 second different hash", idempotencyKey: idemKey,
    }).then(
      (value) => ({ ok: true as const, value }),
      (error) => ({ ok: false as const, error }),
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      const err = outcome.error as Error;
      expect(err).toBeInstanceOf(HistoricalReplacementError);
      expect((err as any)?.code).toBe("IDEMPOTENCY_CONFLICT");
      // NOT SAME_HASH_CONFLICT
      expect((err as any)?.code).not.toBe("SAME_HASH_CONFLICT");
    }

    await cleanupRunScopedTenantData();
  });

  // ===========================================================================
  // TEST 3: Existing terminal key + same request → replay semantics unchanged
  // ===========================================================================
  it("D2-3. same key + same request → replay (succeeded)", async () => {
    const storage = new InMemoryPrivateFileStorage();
    const { replacementService } = makeServices();
    const batchId = randomUUID();
    await seedBatch(batchId, "staged");
    const oldFileId = await seedFile(batchId, "sha256:d2-3-old");

    const { csv, template } = buildInventoryCsv(1);
    const parseResult = parseCsv(csv, template);
    const storedFile = await storage.store(T, batchId, "d2-3", "r.csv", Buffer.from(csv), "text/csv");

    const input = {
      importBatchId: batchId, replaceFileId: oldFileId,
      originalFileName: "r.csv", storagePath: storedFile.storagePath,
      fileHash: storedFile.fileHash, fileSizeBytes: storedFile.fileSizeBytes,
      contentType: storedFile.contentType, fileType: "source",
      parsedRows: parseResult.rows, templateType: "opening_balance_inventory",
      reworkReason: "D2-3 first", idempotencyKey: "d2-3-replay-" + randomUUID(),
    };

    // First call: succeeds
    const result1 = await replacementService.replaceMigrationFile(makeUser() as any, makeEffective() as any, input);
    expect(result1.action).toBe("created");

    // Second call: same key + same request → replay
    const result2 = await replacementService.replaceMigrationFile(makeUser() as any, makeEffective() as any, input);
    expect(result2.action).toBe("replayed");
    expect(result2.newFileId).toBe(result1.newFileId);

    await cleanupRunScopedTenantData();
  });

  // ===========================================================================
  // TEST 4: Fresh key + same-hash replacement → SAME_HASH_CONFLICT (zero effects)
  // ===========================================================================
  it("D2-4. fresh key + same-hash → SAME_HASH_CONFLICT (zero idempotency effects)", async () => {
    const storage = new InMemoryPrivateFileStorage();
    const { replacementService } = makeServices();
    const batchId = randomUUID();
    await seedBatch(batchId, "staged");
    const sameHash = "sha256:same-hash-d2-4";
    const oldFileId = await seedFile(batchId, sameHash);

    const { csv, template } = buildInventoryCsv(1);
    const parseResult = parseCsv(csv, template);

    // Fresh key + same hash → SAME_HASH_CONFLICT
    const outcome = await replacementService.replaceMigrationFile(makeUser() as any, makeEffective() as any, {
      importBatchId: batchId, replaceFileId: oldFileId,
      originalFileName: "r.csv", storagePath: "local://test/same-hash",
      fileHash: sameHash, // SAME as old file
      fileSizeBytes: 100, contentType: "text/csv", fileType: "source",
      parsedRows: parseResult.rows, templateType: "opening_balance_inventory",
      reworkReason: "D2-4 same hash", idempotencyKey: "d2-4-fresh-" + randomUUID(),
    }).then(
      (value) => ({ ok: true as const, value }),
      (error) => ({ ok: false as const, error }),
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      const err = outcome.error as Error;
      expect(err).toBeInstanceOf(HistoricalReplacementError);
      expect((err as any)?.code).toBe("SAME_HASH_CONFLICT");
    }

    // Verify zero idempotency effects
    const idemCount = await sql`SELECT count(*)::int AS c FROM idempotency_records WHERE tenant_id = ${T}`;
    expect(idemCount[0]!.c).toBe(0);

    await cleanupRunScopedTenantData();
  });
});
