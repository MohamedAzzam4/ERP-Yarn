/**
 * WP-08-01F r7 — Manifest idempotency replay, technical failure, strengthened zero-effect.
 *
 * BLOCKER 1: MAN-REPLAY-1 — business_failed is replayed, not re-executed
 * BLOCKER 2: MAN-TECH-1 — technical failure → retryable_failed → immediate retry succeeds
 * Strengthened: MAN-IDEMP-2..5 — zero-effect proof for all conflict cases
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/server/db/schema";
import { HistoricalStagingService } from "@/server/services/historical-staging-service";
import { HistoricalStagingDbRepository } from "@/server/services/historical-staging-db-repository";
import { AuditDbRepository } from "@/server/services/audit-db-repository";
import { IdempotencyDbRepository } from "@/server/services/idempotency-db-repository";
import { DocumentSequenceDbRepository } from "@/server/services/document-sequence-db-repository";
import { resolveEffectivePermissions } from "@/server/security/effective-permissions";
import { TEST_ROLE_PERMISSION_MATRIX } from "@/server/security/role-fixtures";
import type { ErpUserContext } from "@/server/auth/erp-context";
import { checkDestructiveTestDbSafety } from "./destructive-test-guard";

const DATABASE_URL = process.env.DATABASE_URL;
const ALLOW_DESTRUCTIVE = process.env.ERP_ALLOW_DESTRUCTIVE_LOCAL_TEST_DB === "1";
const REQUIRE_PROOF = process.env.ERP_REQUIRE_WP0801F_POSTGRES_PROOF === "1";
const SHARED_GUARD_RESULT = checkDestructiveTestDbSafety({ databaseUrl: DATABASE_URL, allowDestructive: ALLOW_DESTRUCTIVE, requireProof: REQUIRE_PROOF });
const describeOrSkip = SHARED_GUARD_RESULT.kind === "ok" ? describe : describe.skip;

let sql: ReturnType<typeof postgres>;
let db: any;

const RUN_ID = randomUUID();
const T = RUN_ID;
const U = randomUUID();

async function seedTenantAndUser() {
  const s = RUN_ID.slice(0, 8);
  await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status) VALUES (${T}, ${"R7-" + s}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${U}, ${T}, ${"r7-" + s}, ${"R7 User"}, ${"r7-" + s + "@test.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
}

function makeUser(): ErpUserContext {
  return { authenticated: true, userId: U, tenantId: T, authId: `auth-${U}`, name: "Test", email: `test-${U}@test.local` };
}
function makeEffective() { return resolveEffectivePermissions(["owner"], TEST_ROLE_PERMISSION_MATRIX); }

function makeServices(faultyRepo?: any) {
  const stagingRepo = faultyRepo ?? new HistoricalStagingDbRepository(db);
  const audit = new AuditDbRepository(db);
  const idem = new IdempotencyDbRepository(db);
  const docSeq = new DocumentSequenceDbRepository(db);
  const transactionRunner = async <T2>(work: (tx: unknown) => Promise<T2>): Promise<T2> =>
    (db as any).transaction(async (tx: any) => work(tx));
  const stagingService = new HistoricalStagingService({
    repository: stagingRepo, audit, idempotency: idem, documentSequence: docSeq,
    transactionRunner,
    createStagingRepository: (tx: unknown) => faultyRepo ? faultyRepo : new HistoricalStagingDbRepository(tx as any),
    createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
    createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
  });
  return { stagingService };
}

async function seedBatch(batchId: string, status: string, stagedRowCount: number = 1) {
  await sql`INSERT INTO import_batches (id, tenant_id, batch_no, status, source_description, template_name, template_version, mapping_version, cutover_manifest_hash, cutover_import_mode, staged_data_hash, staged_row_count, blocking_error_count, warning_count, accepted_warning_count, validation_status, reconciliation_status, warning_summary, committed_at, commit_effect_counts, created_by, created_at) VALUES (${batchId}, ${T}, ${"R7-" + batchId.slice(-6)}, ${status}::import_batch_status, ${"test"}, ${"opening_balance_inventory"}, ${"1.0"}, ${"1.0"}, null, ${"opening_balance"}, ${"sh"}, ${stagedRowCount}, 0, 0, 0, ${"passed"}, ${"matched"}, null, null, null, ${U}, NOW())`;
}

async function seedFile(batchId: string): Promise<string> {
  const id = randomUUID();
  await sql`INSERT INTO import_files (id, tenant_id, import_batch_id, original_file_name, storage_path, file_hash, file_size_bytes, content_type, file_type, file_version, is_current, created_by, created_at) VALUES (${id}, ${T}, ${batchId}, ${"data.csv"}, ${"local://test"}, ${"sha256:test"}, 100, ${"text/csv"}, ${"source"}, 1, true, ${U}, NOW())`;
  return id;
}

async function seedStagingRow(batchId: string, fileId: string): Promise<string> {
  const id = randomUUID();
  await sql`INSERT INTO import_staging_rows (id, tenant_id, import_batch_id, import_file_id, template_name, source_sheet_name, source_row_number, raw_row_json, transformed_row_json, transformation_notes, validation_status, review_status, ai_confidence, committed_entity_type, committed_entity_id, staging_version, is_current, created_by, created_at) VALUES (${id}, ${T}, ${batchId}, ${fileId}, ${"opening_balance_inventory"}, ${"data.csv"}, 1, ${JSON.stringify({ code: "TEST", quantity: "100" })}::jsonb, ${JSON.stringify({ code: "TEST", quantity: "100" })}::jsonb, null, ${"pending"}, ${"not_required"}, null, null, null, 1, true, ${U}, NOW())`;
  return id;
}

async function cleanupData() {
  await sql`DELETE FROM import_cutover_manifests WHERE tenant_id = ${T}`;
  await sql`DELETE FROM import_staging_rows WHERE tenant_id = ${T}`;
  await sql`DELETE FROM import_files WHERE tenant_id = ${T}`;
  await sql`DELETE FROM import_batches WHERE tenant_id = ${T}`;
  await sql`DELETE FROM idempotency_records WHERE tenant_id = ${T}`;
  await sql`DELETE FROM document_sequences WHERE tenant_id = ${T}`;
}

async function captureCounts(batchId: string) {
  const manifests = await sql`SELECT count(*)::int AS c FROM import_cutover_manifests WHERE tenant_id = ${T} AND import_batch_id = ${batchId}`;
  const batch = await sql`SELECT cutover_manifest_hash FROM import_batches WHERE id = ${batchId} AND tenant_id = ${T}`;
  const approvals = await sql`SELECT count(*)::int AS c FROM import_batch_approvals WHERE tenant_id = ${T} AND import_batch_id = ${batchId}`;
  const idem = await sql`SELECT count(*)::int AS c FROM idempotency_records WHERE tenant_id = ${T}`;
  return {
    manifests: manifests[0]!.c,
    batchHash: batch[0]?.cutover_manifest_hash ?? null,
    approvals: approvals[0]!.c,
    idemCount: idem[0]!.c,
  };
}

describeOrSkip("WP-08-01F r7 — Manifest replay + technical failure + strengthened zero-effect", () => {
  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { prepare: false, max: 5, idle_timeout: 10, connect_timeout: 15 });
    db = drizzle(sql, { schema });
    await sql`SET statement_timeout = 30000`;
    await seedTenantAndUser();
  }, 30000);

  afterAll(async () => { if (sql) { await cleanupData(); await sql.end(); } }, 15000);

  // ===========================================================================
  // MAN-REPLAY-1: business_failed is replayed, not re-executed
  // ===========================================================================
  it("MAN-REPLAY-1. business_failed replay — same key after business state change → stored failure", async () => {
    const { stagingService } = makeServices();
    const batchId = randomUUID();

    // 1. Seed batch as pending_dual_approval (invalid for manifest finalization)
    await seedBatch(batchId, "pending_dual_approval");
    const fileId = await seedFile(batchId);
    await seedStagingRow(batchId, fileId);
    const idemKey = "mr1-" + randomUUID();

    // 2. First call → INVALID_BATCH_STATUS
    const outcome1 = await stagingService.finalizeCutoverManifest(makeUser() as any, makeEffective() as any, {
      importBatchId: batchId, domain: "inventory", cutoffDate: "2024-01-01",
      sourceCoverage: "all", openingBalanceBasis: "audit", liveSystemStartBoundary: null,
      idempotencyKey: idemKey,
    }).then(v => ({ ok: true as const, v }), e => ({ ok: false as const, e }));

    expect(outcome1.ok).toBe(false);
    if (!outcome1.ok) {
      expect(String(outcome1.e?.message ?? outcome1.e)).toMatch(/INVALID_BATCH_STATUS|Cannot finalize/i);
    }

    // 3. Record state
    const idemState = await sql`SELECT state, attempt_count, response_code, response_body FROM idempotency_records WHERE tenant_id = ${T} AND idempotency_key = ${idemKey}`;
    expect(idemState[0]!.state).toBe("business_failed");
    const attemptCountBefore = idemState[0]!.attempt_count;
    const manifestCountBefore = await sql`SELECT count(*)::int AS c FROM import_cutover_manifests WHERE tenant_id = ${T} AND import_batch_id = ${batchId}`;
    const batchBefore = await sql`SELECT cutover_manifest_hash FROM import_batches WHERE id = ${batchId} AND tenant_id = ${T}`;

    // 4. Change business world — reopen batch to staged
    await sql`UPDATE import_batches SET status = ${"staged"}::import_batch_status WHERE id = ${batchId} AND tenant_id = ${T}`;

    // 5. Retry with same key + same request
    const outcome2 = await stagingService.finalizeCutoverManifest(makeUser() as any, makeEffective() as any, {
      importBatchId: batchId, domain: "inventory", cutoffDate: "2024-01-01",
      sourceCoverage: "all", openingBalanceBasis: "audit", liveSystemStartBoundary: null,
      idempotencyKey: idemKey,
    }).then(v => ({ ok: true as const, v }), e => ({ ok: false as const, e }));

    // Must fail with the ORIGINAL stored business failure, NOT succeed
    expect(outcome2.ok).toBe(false);
    if (!outcome2.ok) {
      const msg = String(outcome2.e?.message ?? outcome2.e);
      expect(msg).not.toMatch(/OPERATION_IN_PROGRESS/i);
      expect(msg).toMatch(/INVALID_BATCH_STATUS|Cannot finalize|BUSINESS_FAILED|Previous business failure/i);
    }

    // 6. Assert no new manifest, hash unchanged, attempt_count unchanged
    const manifestCountAfter = await sql`SELECT count(*)::int AS c FROM import_cutover_manifests WHERE tenant_id = ${T} AND import_batch_id = ${batchId}`;
    expect(manifestCountAfter[0]!.c).toBe(manifestCountBefore[0]!.c);
    expect(manifestCountAfter[0]!.c).toBe(0); // no manifest was created

    const batchAfter = await sql`SELECT cutover_manifest_hash FROM import_batches WHERE id = ${batchId} AND tenant_id = ${T}`;
    expect(batchAfter[0]!.cutover_manifest_hash).toBe(batchBefore[0]!.cutover_manifest_hash);

    const idemStateAfter = await sql`SELECT state, attempt_count FROM idempotency_records WHERE tenant_id = ${T} AND idempotency_key = ${idemKey}`;
    expect(idemStateAfter[0]!.state).toBe("business_failed");
    expect(idemStateAfter[0]!.attempt_count).toBe(attemptCountBefore);

    await cleanupData();
  }, 30000);

  // ===========================================================================
  // MAN-TECH-1: Technical failure → retryable_failed → immediate retry succeeds
  // ===========================================================================
  it("MAN-TECH-1. Technical failure → retryable_failed → immediate same-key retry succeeds", async () => {
    const batchId = randomUUID();
    await seedBatch(batchId, "staged");
    const fileId = await seedFile(batchId);
    await seedStagingRow(batchId, fileId);
    const idemKey = "mt1-" + randomUUID();

    // Use a flag-controlled faulty transactionRunner that throws AFTER
    // the idempotency claim but inside the transaction body.
    let injectFailure = true;
    const stagingRepo = new HistoricalStagingDbRepository(db);
    const audit = new AuditDbRepository(db);
    const idem = new IdempotencyDbRepository(db);
    const docSeq = new DocumentSequenceDbRepository(db);
    const faultyTxRunner = async <T2>(work: (tx: unknown) => Promise<T2>): Promise<T2> => {
      if (injectFailure) {
        // Start a real transaction, then throw inside it to trigger rollback.
        // This simulates a technical failure AFTER the idempotency claim.
        return (db as any).transaction(async (tx: any) => {
          // Run just enough to enter the tx, then throw.
          throw new Error("INJECTED_DB_FAILURE");
        });
      }
      return (db as any).transaction(async (tx: any) => work(tx));
    };
    const stagingService = new HistoricalStagingService({
      repository: stagingRepo, audit, idempotency: idem, documentSequence: docSeq,
      transactionRunner: faultyTxRunner,
      createStagingRepository: (tx: unknown) => new HistoricalStagingDbRepository(tx as any),
      createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
      createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
    });

    const batchHashBefore = await sql`SELECT cutover_manifest_hash FROM import_batches WHERE id = ${batchId} AND tenant_id = ${T}`;

    // First call: technical failure
    const outcome1 = await stagingService.finalizeCutoverManifest(makeUser() as any, makeEffective() as any, {
      importBatchId: batchId, domain: "inventory", cutoffDate: "2024-01-01",
      sourceCoverage: "all", openingBalanceBasis: "audit", liveSystemStartBoundary: null,
      idempotencyKey: idemKey,
    }).then(v => ({ ok: true as const, v }), e => ({ ok: false as const, e }));

    expect(outcome1.ok).toBe(false);
    if (!outcome1.ok) {
      expect(String(outcome1.e?.message ?? outcome1.e)).toMatch(/INJECTED_DB_FAILURE/i);
    }

    // Verify: zero manifests, batch hash unchanged, idempotency = retryable_failed
    const manifestCount1 = await sql`SELECT count(*)::int AS c FROM import_cutover_manifests WHERE tenant_id = ${T} AND import_batch_id = ${batchId}`;
    expect(manifestCount1[0]!.c).toBe(0);

    const batchHashAfter1 = await sql`SELECT cutover_manifest_hash FROM import_batches WHERE id = ${batchId} AND tenant_id = ${T}`;
    expect(batchHashAfter1[0]!.cutover_manifest_hash).toBe(batchHashBefore[0]!.cutover_manifest_hash);

    const idemState1 = await sql`SELECT state, last_error_class FROM idempotency_records WHERE tenant_id = ${T} AND idempotency_key = ${idemKey}`;
    expect(idemState1[0]!.state).toBe("retryable_failed");
    expect(idemState1[0]!.last_error_class).toBe("Error");
    const attemptCount1 = await sql`SELECT attempt_count FROM idempotency_records WHERE tenant_id = ${T} AND idempotency_key = ${idemKey}`;

    // Remove the fault
    injectFailure = false;

    // Force lease expiry for retryable_failed reclaim
    await sql`UPDATE idempotency_records SET lease_expires_at = NOW() - INTERVAL '1 second' WHERE tenant_id = ${T} AND idempotency_key = ${idemKey}`;

    // Second call: same key + same request → re-executes and succeeds
    const outcome2 = await stagingService.finalizeCutoverManifest(makeUser() as any, makeEffective() as any, {
      importBatchId: batchId, domain: "inventory", cutoffDate: "2024-01-01",
      sourceCoverage: "all", openingBalanceBasis: "audit", liveSystemStartBoundary: null,
      idempotencyKey: idemKey,
    });

    expect(outcome2.action).toBe("finalized");

    // Verify: exactly one manifest, idempotency = succeeded, attempt_count incremented
    const manifestCount2 = await sql`SELECT count(*)::int AS c FROM import_cutover_manifests WHERE tenant_id = ${T} AND import_batch_id = ${batchId}`;
    expect(manifestCount2[0]!.c).toBe(1);

    const idemState2 = await sql`SELECT state, attempt_count FROM idempotency_records WHERE tenant_id = ${T} AND idempotency_key = ${idemKey}`;
    expect(idemState2[0]!.state).toBe("succeeded");
    expect(idemState2[0]!.attempt_count).toBe(attemptCount1[0]!.attempt_count + 1);

    await cleanupData();
  }, 30000);

  // ===========================================================================
  // Strengthened MAN-IDEMP-2..5: zero-effect proof for each conflict case
  // ===========================================================================
  for (const { name, field, changedValue } of [
    { name: "MAN-IDEMP-2", field: "sourceCoverage", changedValue: "CHANGED" },
    { name: "MAN-IDEMP-3", field: "openingBalanceBasis", changedValue: "CHANGED" },
    { name: "MAN-IDEMP-4", field: "liveSystemStartBoundary", changedValue: "2024-06-01" },
    { name: "MAN-IDEMP-5", field: "cutoffDate", changedValue: "2024-12-31" },
  ]) {
    it(`${name}. same key + changed ${field} → IDEMPOTENCY_CONFLICT with zero effects`, async () => {
      const { stagingService } = makeServices();
      const batchId = randomUUID();
      await seedBatch(batchId, "staged");
      const fileId = await seedFile(batchId);
      await seedStagingRow(batchId, fileId);
      const idemKey = `${name.toLowerCase()}-` + randomUUID();

      const baseInput = {
        importBatchId: batchId, domain: "inventory", cutoffDate: "2024-01-01",
        sourceCoverage: "all", openingBalanceBasis: "audit", liveSystemStartBoundary: null,
        idempotencyKey: idemKey,
      };

      // First call: succeeds
      await stagingService.finalizeCutoverManifest(makeUser() as any, makeEffective() as any, baseInput);

      // Capture BEFORE state
      const before = await captureCounts(batchId);

      // Second call: same key + changed field
      const changedInput = { ...baseInput, [field]: changedValue };
      await expect(
        stagingService.finalizeCutoverManifest(makeUser() as any, makeEffective() as any, changedInput as any),
      ).rejects.toThrow(/Idempotency key conflict/i);

      // Capture AFTER state
      const after = await captureCounts(batchId);

      // Assert zero effects
      expect(after.manifests).toBe(before.manifests); // no new manifest
      expect(after.batchHash).toBe(before.batchHash); // no batch hash mutation
      expect(after.approvals).toBe(before.approvals); // no approval mutation
      expect(after.idemCount).toBe(before.idemCount); // no new idempotency record

      // Original idempotency terminal result unchanged
      const idemState = await sql`SELECT state FROM idempotency_records WHERE tenant_id = ${T} AND idempotency_key = ${idemKey}`;
      expect(idemState[0]!.state).toBe("succeeded");

      await cleanupData();
    }, 15000);
  }
});
