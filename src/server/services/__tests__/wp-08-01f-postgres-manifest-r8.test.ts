/**
 * WP-08-01F r8 — Reviewer correction pass for manifest idempotency evidence.
 *
 * Addresses three reviewer blockers on top of r7 (commit b42b4fa):
 *
 * BLOCKER 1 — MAN-TECH-ROLLBACK-1: Inject a technical failure AFTER real
 *   dependent business writes have happened inside the transaction
 *   (manifest insert, batch.cutover_manifest_hash mutation, optional
 *   per-domain supersession, audit append), then prove the transaction
 *   rolled ALL of them back. The r7 MAN-TECH-1 fault was injected before
 *   work(tx) executed, which proved outer catch classification but did
 *   not prove rollback of real mutations.
 *
 * BLOCKER 2 — Genuinely immediate retry: No `lease_expires_at`
 *   manipulation, no clock advance. The same-key same-request retry
 *   must reclaim a `retryable_failed` record immediately and succeed,
 *   with attempt_count incremented by exactly 1. The DB predicate
 *   `state = 'retryable_failed' OR (...)` allows immediate reclaim —
 *   this test must prove that through the real finalizeCutoverManifest
 *   service path.
 *
 * BLOCKER 3 — MAN-REPLAY-1 exact durable replay: After the first
 *   business failure, capture the EXACT stored response_body.code and
 *   response_body.message. Change the underlying batch state so a fresh
 *   execution would produce a different result. Retry with the same
 *   idempotency key + same request. Assert the returned error code AND
 *   message are EXACTLY equal to the stored first response (not a
 *   regex, not a generic BUSINESS_FAILED fallback).
 *
 * Strengthened MAN-IDEMP-2..5 zero-effect proofs (carried over from r7).
 *
 * DO NOT IMPLEMENT aggregate cutover-manifest-set hash. It remains
 * UNRESOLVED_CUTOVER_MANIFEST_SET_HASH — owner decision required.
 *
 * E2E / race gates remain OPEN (not addressed by this checkpoint).
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
  await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status) VALUES (${T}, ${"R8-" + s}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${U}, ${T}, ${"r8-" + s}, ${"R8 User"}, ${"r8-" + s + "@test.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
}

function makeUser(): ErpUserContext {
  return { authenticated: true, userId: U, tenantId: T, authId: `auth-${U}`, name: "Test", email: `test-${U}@test.local` };
}
function makeEffective() { return resolveEffectivePermissions(["owner"], TEST_ROLE_PERMISSION_MATRIX); }

/**
 * Build services with the standard real Postgres transaction runner.
 * Used by zero-effect and replay tests where no fault injection is needed.
 */
function makeServices() {
  const stagingRepo = new HistoricalStagingDbRepository(db);
  const audit = new AuditDbRepository(db);
  const idem = new IdempotencyDbRepository(db);
  const docSeq = new DocumentSequenceDbRepository(db);
  const transactionRunner = async <T2>(work: (tx: unknown) => Promise<T2>): Promise<T2> =>
    (db as any).transaction(async (tx: any) => work(tx));
  const stagingService = new HistoricalStagingService({
    repository: stagingRepo, audit, idempotency: idem, documentSequence: docSeq,
    transactionRunner,
    createStagingRepository: (tx: unknown) => new HistoricalStagingDbRepository(tx as any),
    createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
    createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
  });
  return { stagingService };
}

async function seedBatch(batchId: string, status: string, stagedRowCount: number = 1) {
  await sql`INSERT INTO import_batches (id, tenant_id, batch_no, status, source_description, template_name, template_version, mapping_version, cutover_manifest_hash, cutover_import_mode, staged_data_hash, staged_row_count, blocking_error_count, warning_count, accepted_warning_count, validation_status, reconciliation_status, warning_summary, committed_at, commit_effect_counts, created_by, created_at) VALUES (${batchId}, ${T}, ${"R8-" + batchId.slice(-6)}, ${status}::import_batch_status, ${"test"}, ${"opening_balance_inventory"}, ${"1.0"}, ${"1.0"}, null, ${"opening_balance"}, ${"sh"}, ${stagedRowCount}, 0, 0, 0, ${"passed"}, ${"matched"}, null, null, null, ${U}, NOW())`;
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

/**
 * Seed a prior "current" manifest for a domain so the rollback test can
 * prove supersession is also undone. Returns the manifest id.
 */
async function seedCurrentManifest(batchId: string, domain: string, version: number = 1): Promise<string> {
  const id = randomUUID();
  await sql`INSERT INTO import_cutover_manifests (id, tenant_id, import_batch_id, domain, import_mode, cutoff_date, source_coverage, opening_balance_basis, live_system_start_boundary, manifest_hash, is_approved, manifest_version, is_current, superseded_at, superseded_by, created_by, created_at, updated_at, updated_by) VALUES (${id}, ${T}, ${batchId}, ${domain}, ${"opening_balance"}::cutover_import_mode, ${"2024-01-01"}, ${"all"}, ${"audit"}, null, ${"sha256:seeded-" + id.slice(0, 8)}, true, ${version}, true, null, null, ${U}, NOW(), NOW(), ${U})`;
  return id;
}

async function cleanupData() {
  // NOTE: audit_logs is append-only at the DB level (trigger enforced).
  // We must NEVER DELETE from audit_logs. Each test uses a unique tenant
  // id, so audit residue from a rolled-back transaction is isolated to
  // this tenant and stays as honest evidence of the attempted call.
  // Other tables are safe to DELETE.
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

describeOrSkip("WP-08-01F r8 — Real mid-tx rollback + immediate retry + exact durable replay", () => {
  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { prepare: false, max: 5, idle_timeout: 10, connect_timeout: 15 });
    db = drizzle(sql, { schema });
    await sql`SET statement_timeout = 30000`;
    await seedTenantAndUser();
  }, 30000);

  afterAll(async () => { if (sql) { await cleanupData(); await sql.end(); } }, 15000);

  // ===========================================================================
  // BLOCKER 3 — MAN-REPLAY-1: EXACT durable replay of stored business failure
  // ===========================================================================
  //
  // Reviewer requirement: prove the EXACT stored durable response_body
  // is replayed — not a regex, not a generic BUSINESS_FAILED fallback.
  //
  // 1. First call on pending_dual_approval → INVALID_BATCH_STATUS →
  //    business_failed, with stored response_body = { code, message }.
  // 2. Capture the EXACT stored state, response_code, response_body.code,
  //    response_body.message, attempt_count.
  // 3. Save the exact stored code/message for assertion.
  // 4. Change the underlying batch state to "staged" so a fresh execution
  //    would now produce a DIFFERENT result (success, not failure).
  // 5. Retry with same idempotency key + same original request.
  // 6. Assert the thrown error's code AND message are EXACTLY EQUAL to the
  //    stored first response — no regex, no fallback.
  // 7. Prove: no transaction/business execution happened again:
  //    - manifest count unchanged (still 0)
  //    - batch cutover_manifest_hash unchanged (still null)
  //    - approval count unchanged (still 0)
  //    - idempotency state unchanged (business_failed)
  //    - attempt_count unchanged
  it("MAN-REPLAY-1. business_failed exact durable replay — stored code+message equal", async () => {
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
      // Sanity: it failed for the expected reason.
      const e = outcome1.e as any;
      expect(e?.code ?? String(e?.message ?? e)).toMatch(/INVALID_BATCH_STATUS/i);
    }

    // 3. Capture EXACT stored durable response.
    const storedRow = await sql`SELECT state, attempt_count, response_code, response_body, last_error_class FROM idempotency_records WHERE tenant_id = ${T} AND idempotency_key = ${idemKey}`;
    expect(storedRow.length).toBe(1);
    const stored = storedRow[0]!;
    expect(stored.state).toBe("business_failed");
    expect(stored.attempt_count).toBe(1);
    expect(stored.response_code).toBe(409);
    expect(stored.response_body).not.toBeNull();
    const storedCode = (stored.response_body as any).code;
    const storedMessage = (stored.response_body as any).message;
    // Sanity: stored code is the EXACT business failure code, not a generic fallback.
    expect(storedCode).toBe("INVALID_BATCH_STATUS");
    // Sanity: stored message contains the unique batch id (proves it was
    // generated against THIS batch's actual state, not a generic string).
    expect(storedMessage).toContain(batchId);
    expect(storedMessage).toContain("pending_dual_approval");

    // 4. Capture BEFORE state for "no re-execution" proof.
    const manifestCountBefore = await sql`SELECT count(*)::int AS c FROM import_cutover_manifests WHERE tenant_id = ${T} AND import_batch_id = ${batchId}`;
    const batchHashBefore = await sql`SELECT cutover_manifest_hash FROM import_batches WHERE id = ${batchId} AND tenant_id = ${T}`;
    const approvalsBefore = await sql`SELECT count(*)::int AS c FROM import_batch_approvals WHERE tenant_id = ${T} AND import_batch_id = ${batchId}`;

    // 5. Change the underlying business world so a fresh execution would
    //    now produce a DIFFERENT result (success path).
    await sql`UPDATE import_batches SET status = ${"staged"}::import_batch_status WHERE id = ${batchId} AND tenant_id = ${T}`;

    // 6. Retry with same key + same original request.
    const outcome2 = await stagingService.finalizeCutoverManifest(makeUser() as any, makeEffective() as any, {
      importBatchId: batchId, domain: "inventory", cutoffDate: "2024-01-01",
      sourceCoverage: "all", openingBalanceBasis: "audit", liveSystemStartBoundary: null,
      idempotencyKey: idemKey,
    }).then(v => ({ ok: true as const, v }), e => ({ ok: false as const, e }));

    // 7. Must fail with the EXACT ORIGINAL stored business failure.
    //    NOT succeed, NOT be a generic BUSINESS_FAILED fallback, NOT use a regex.
    expect(outcome2.ok).toBe(false);
    if (!outcome2.ok) {
      const e = outcome2.e as any;
      // EXACT equality — not a regex match.
      expect(e?.code).toBeDefined();
      expect(e.code).toBe(storedCode); // EXACT stored code
      expect(e.message).toBe(storedMessage); // EXACT stored message
      // Negative: must NOT be the generic fallback.
      expect(e.code).not.toBe("BUSINESS_FAILED");
      expect(e.message).not.toBe("Previous business failure (durable).");
    }

    // 8. Prove NO business re-execution happened.
    const manifestCountAfter = await sql`SELECT count(*)::int AS c FROM import_cutover_manifests WHERE tenant_id = ${T} AND import_batch_id = ${batchId}`;
    expect(manifestCountAfter[0]!.c).toBe(manifestCountBefore[0]!.c);
    expect(manifestCountAfter[0]!.c).toBe(0); // no manifest was created

    const batchHashAfter = await sql`SELECT cutover_manifest_hash FROM import_batches WHERE id = ${batchId} AND tenant_id = ${T}`;
    expect(batchHashAfter[0]!.cutover_manifest_hash).toBe(batchHashBefore[0]!.cutover_manifest_hash);
    expect(batchHashAfter[0]!.cutover_manifest_hash).toBeNull(); // hash never bound

    const approvalsAfter = await sql`SELECT count(*)::int AS c FROM import_batch_approvals WHERE tenant_id = ${T} AND import_batch_id = ${batchId}`;
    expect(approvalsAfter[0]!.c).toBe(approvalsBefore[0]!.c);
    expect(approvalsAfter[0]!.c).toBe(0);

    // 9. Idempotency state unchanged.
    const storedRowAfter = await sql`SELECT state, attempt_count, response_code, response_body FROM idempotency_records WHERE tenant_id = ${T} AND idempotency_key = ${idemKey}`;
    expect(storedRowAfter[0]!.state).toBe("business_failed");
    expect(storedRowAfter[0]!.attempt_count).toBe(stored.attempt_count); // unchanged
    expect(storedRowAfter[0]!.response_code).toBe(stored.response_code);
    expect((storedRowAfter[0]!.response_body as any).code).toBe(storedCode);
    expect((storedRowAfter[0]!.response_body as any).message).toBe(storedMessage);

    await cleanupData();
  }, 30000);

  // ===========================================================================
  // BLOCKER 2 — Genuinely immediate retry WITHOUT lease manipulation
  // ===========================================================================
  //
  // The r7 MAN-TECH-1 manually set `lease_expires_at = NOW() - 1 second`
  // before retrying. That is forbidden proof. The DB predicate for
  // `claimExpiredLease` is:
  //     state = 'retryable_failed'
  //     OR (state = 'in_progress' AND lease_expires_at < now)
  // so a `retryable_failed` record reclaims IMMEDIATELY without any
  // lease manipulation. This test proves that through the real
  // finalizeCutoverManifest path.
  //
  // For a `retryable_failed` record:
  //   1. Do NOT modify `lease_expires_at`.
  //   2. Do NOT advance the clock.
  //   3. Remove only the injected technical fault.
  //   4. Immediately call the same operation with same key + same request.
  //   5. Prove it reclaims/re-executes immediately and succeeds.
  //   6. Prove `attempt_count` increments by exactly 1.
  //   7. Prove exactly the expected successful business effects occur once.
  it("MAN-TECH-1. retryable_failed reclaimed immediately — no lease manipulation, attempt_count+1", async () => {
    const batchId = randomUUID();
    await seedBatch(batchId, "staged");
    const fileId = await seedFile(batchId);
    await seedStagingRow(batchId, fileId);
    const idemKey = "mt1-" + randomUUID();

    // Use a flag-controlled faulty transactionRunner that throws BEFORE
    // work(tx) executes — this is the catch-classification proof
    // (preserved from r7). The rollback proof is in MAN-TECH-ROLLBACK-1.
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

    const idemState1 = await sql`SELECT state, last_error_class, attempt_count, lease_expires_at FROM idempotency_records WHERE tenant_id = ${T} AND idempotency_key = ${idemKey}`;
    expect(idemState1[0]!.state).toBe("retryable_failed");
    expect(idemState1[0]!.last_error_class).toBe("Error");
    expect(idemState1[0]!.attempt_count).toBe(1);
    const leaseExpiresAtAfterFailure = idemState1[0]!.lease_expires_at;

    // === BLOCKER 2 FIX ===
    // Remove ONLY the injected fault. Do NOT touch lease_expires_at.
    // Do NOT advance the clock.
    injectFailure = false;

    // NEGATIVE proof: explicitly assert we did NOT manipulate the lease.
    // The lease_expires_at stored at failure time MUST be unchanged when
    // we read it again immediately before retry.
    const idemStateLeaseCheck = await sql`SELECT lease_expires_at FROM idempotency_records WHERE tenant_id = ${T} AND idempotency_key = ${idemKey}`;
    expect(idemStateLeaseCheck[0]!.lease_expires_at).toEqual(leaseExpiresAtAfterFailure);
    // Sanity: the lease is genuinely in the FUTURE (we never backdated it).
    expect(new Date(leaseExpiresAtAfterFailure).getTime()).toBeGreaterThan(Date.now() - 1000);

    // Second call: same key + same request — NO lease manipulation, NO clock advance.
    const outcome2 = await stagingService.finalizeCutoverManifest(makeUser() as any, makeEffective() as any, {
      importBatchId: batchId, domain: "inventory", cutoffDate: "2024-01-01",
      sourceCoverage: "all", openingBalanceBasis: "audit", liveSystemStartBoundary: null,
      idempotencyKey: idemKey,
    });

    // 5. Prove immediate reclaim succeeded.
    expect(outcome2.action).toBe("finalized");

    // 6. Exactly one manifest created (single business effect).
    const manifestCount2 = await sql`SELECT count(*)::int AS c FROM import_cutover_manifests WHERE tenant_id = ${T} AND import_batch_id = ${batchId}`;
    expect(manifestCount2[0]!.c).toBe(1);

    // 7. Idempotency = succeeded, attempt_count incremented by EXACTLY 1.
    const idemState2 = await sql`SELECT state, attempt_count FROM idempotency_records WHERE tenant_id = ${T} AND idempotency_key = ${idemKey}`;
    expect(idemState2[0]!.state).toBe("succeeded");
    expect(idemState2[0]!.attempt_count).toBe(idemState1[0]!.attempt_count + 1);
    expect(idemState2[0]!.attempt_count).toBe(2);

    // 8. Prove batch hash is now bound (single business effect).
    const batchHashAfter2 = await sql`SELECT cutover_manifest_hash FROM import_batches WHERE id = ${batchId} AND tenant_id = ${T}`;
    expect(batchHashAfter2[0]!.cutover_manifest_hash).not.toBeNull();
    expect(batchHashAfter2[0]!.cutover_manifest_hash).toBe(outcome2.cutoverManifestHash);

    await cleanupData();
  }, 30000);

  // ===========================================================================
  // BLOCKER 1 — MAN-TECH-ROLLBACK-1: Real mid-transaction rollback proof
  // ===========================================================================
  //
  // Inject a technical failure AFTER real dependent business writes have
  // happened inside the transaction. The injection point is
  // `txIdem.updateState` (called by markSucceeded), which is the LAST
  // write inside the transaction. By the time markSucceeded is called,
  // the transaction has already:
  //   - locked and re-read the batch row
  //   - computed the manifest hash
  //   - optionally superseded the existing current manifest
  //   - inserted the new cutover manifest row
  //   - mutated batch.cutover_manifest_hash
  //   - appended an audit log row
  //
  // When txIdem.updateState throws, the entire transaction rolls back,
  // proving every dependent write above is undone. The outer catch then
  // calls markRetryableFailed (on the non-tx idempotency repo) to
  // terminalize the failure.
  //
  // Reviewer proof shape:
  //   1. Enter the real transaction.
  //   2. Allow real work (manifest insert + batch hash mutation +
  //      supersession + audit append) to happen.
  //   3. Inject failure at a later dependent write (markSucceeded).
  //   4. Operation throws the injected technical error.
  //   5. After the failed call, prove rollback:
  //      - no new manifest survives;
  //      - batch cutover hash is unchanged;
  //      - if a current manifest was seeded, its is_current / supersession
  //        state is unchanged;
  //      - no success audit residue survives (audit_logs is append-only;
  //        a row may exist with this idempotency_key as honest evidence
  //        of the ATTEMPT, but it must NOT carry success semantics —
  //        i.e. it must not be linked to a surviving manifest id and
  //        no manifest row should reference it).
  //   6. Outside the rolled-back business transaction, the idempotency
  //      record becomes retryable_failed with the expected
  //      last_error_class, and owner-token fencing is preserved.
  //
  // We run the test twice — once WITHOUT a seeded prior manifest, and
  // once WITH one — to prove supersession is also rolled back.
  async function runRollbackTest(opts: { withSeededPriorManifest: boolean }) {
    const batchId = randomUUID();
    await seedBatch(batchId, "staged");
    const fileId = await seedFile(batchId);
    await seedStagingRow(batchId, fileId);
    const idemKey = "mtr-" + (opts.withSeededPriorManifest ? "seeded-" : "clean-") + randomUUID();

    // Optionally seed a prior current manifest for "inventory" so the
    // rollback test also proves supersession is undone.
    let seededManifestId: string | null = null;
    let seededManifestVersion = 0;
    if (opts.withSeededPriorManifest) {
      seededManifestId = await seedCurrentManifest(batchId, "inventory", 1);
      seededManifestVersion = 1;
    }

    // Capture BEFORE state.
    const batchHashBefore = await sql`SELECT cutover_manifest_hash FROM import_batches WHERE id = ${batchId} AND tenant_id = ${T}`;
    const manifestCountBefore = await sql`SELECT count(*)::int AS c FROM import_cutover_manifests WHERE tenant_id = ${T} AND import_batch_id = ${batchId}`;
    const seededManifestBefore = seededManifestId
      ? await sql`SELECT id, is_current, superseded_at, superseded_by, manifest_version FROM import_cutover_manifests WHERE id = ${seededManifestId}`
      : null;

    // === Injection: faulty createIdempotency(tx) factory ===
    // The factory returns a wrapper whose updateState() throws the
    // injected error. markSucceeded calls txIdem.updateState() — this
    // is the LAST write inside the transaction, AFTER manifest insert +
    // batch hash mutation + supersession + audit append.
    let injectFailure = true;
    const stagingRepo = new HistoricalStagingDbRepository(db);
    const audit = new AuditDbRepository(db);
    const idem = new IdempotencyDbRepository(db);
    const docSeq = new DocumentSequenceDbRepository(db);
    const realTxRunner = async <T2>(work: (tx: unknown) => Promise<T2>): Promise<T2> =>
      (db as any).transaction(async (tx: any) => work(tx));

    const createIdempotencyWithInjection = (tx: unknown) => {
      const real = new IdempotencyDbRepository(tx as any);
      const wrapped: IdempotencyDbRepository = Object.create(real);
      wrapped.updateState = async (id: string, update: any) => {
        if (injectFailure) {
          // Simulate a real technical failure (e.g. connection lost,
          // constraint violation on a downstream write, deadlock
          // detected by Postgres, etc.) at the LAST write inside the
          // transaction. This happens AFTER manifest insert, batch
          // hash mutation, supersession, and audit append have all
          // issued their SQL statements inside the same tx.
          throw new Error("INJECTED_MID_TX_FAILURE");
        }
        return real.updateState(id, update);
      };
      // Other methods (findByTenantScopeKey, insert, claimExpiredLease,
      // heartbeat) must delegate to real — only updateState is wrapped.
      wrapped.findByTenantScopeKey = real.findByTenantScopeKey.bind(real);
      wrapped.insert = real.insert.bind(real);
      wrapped.claimExpiredLease = real.claimExpiredLease.bind(real);
      wrapped.heartbeat = real.heartbeat.bind(real);
      return wrapped;
    };

    const stagingService = new HistoricalStagingService({
      repository: stagingRepo, audit, idempotency: idem, documentSequence: docSeq,
      transactionRunner: realTxRunner,
      createStagingRepository: (tx: unknown) => new HistoricalStagingDbRepository(tx as any),
      createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
      createIdempotency: createIdempotencyWithInjection,
    });

    // 3-4. First call → injected mid-tx technical failure.
    const outcome1 = await stagingService.finalizeCutoverManifest(makeUser() as any, makeEffective() as any, {
      importBatchId: batchId, domain: "inventory", cutoffDate: "2024-01-01",
      sourceCoverage: "all", openingBalanceBasis: "audit", liveSystemStartBoundary: null,
      idempotencyKey: idemKey,
    }).then(v => ({ ok: true as const, v }), e => ({ ok: false as const, e }));

    expect(outcome1.ok).toBe(false);
    if (!outcome1.ok) {
      expect(String(outcome1.e?.message ?? outcome1.e)).toMatch(/INJECTED_MID_TX_FAILURE/i);
    }

    // 5. Prove full rollback of every dependent write.
    //
    // 5a. No new manifest survives. If a prior manifest was seeded, the
    //     count must equal the BEFORE count; if not, count must be 0.
    const manifestCountAfter = await sql`SELECT count(*)::int AS c FROM import_cutover_manifests WHERE tenant_id = ${T} AND import_batch_id = ${batchId}`;
    expect(manifestCountAfter[0]!.c).toBe(manifestCountBefore[0]!.c);
    if (!opts.withSeededPriorManifest) {
      expect(manifestCountAfter[0]!.c).toBe(0); // zero manifests survived
    }

    // 5b. Batch cutover_manifest_hash is UNCHANGED.
    const batchHashAfter = await sql`SELECT cutover_manifest_hash FROM import_batches WHERE id = ${batchId} AND tenant_id = ${T}`;
    expect(batchHashAfter[0]!.cutover_manifest_hash).toBe(batchHashBefore[0]!.cutover_manifest_hash);
    // Sanity: if no manifest ever bound a hash, the hash is still null.
    if (!opts.withSeededPriorManifest) {
      expect(batchHashAfter[0]!.cutover_manifest_hash).toBeNull();
    }

    // 5c. If a current manifest was seeded, its is_current /
    //     supersession state is UNCHANGED. The supersession UPDATE
    //     inside the rolled-back tx must NOT survive.
    if (opts.withSeededPriorManifest && seededManifestBefore && seededManifestId) {
      const seededAfter = await sql`SELECT id, is_current, superseded_at, superseded_by, manifest_version FROM import_cutover_manifests WHERE id = ${seededManifestId}`;
      expect(seededAfter.length).toBe(1);
      expect(seededAfter[0]!.is_current).toBe(seededManifestBefore[0]!.is_current);
      expect(seededAfter[0]!.is_current).toBe(true); // still current — supersession rolled back
      expect(seededAfter[0]!.superseded_at).toEqual(seededManifestBefore[0]!.superseded_at);
      expect(seededAfter[0]!.superseded_by).toBe(seededManifestBefore[0]!.superseded_by);
      expect(seededAfter[0]!.manifest_version).toBe(seededManifestBefore[0]!.manifest_version);
      expect(seededAfter[0]!.manifest_version).toBe(seededManifestVersion);
    }

    // 5d. No success audit residue survives with success semantics.
    // audit_logs is append-only at the DB level (trigger enforced),
    // so we cannot DELETE rows. However, a SUCCESS audit row written
    // inside the rolled-back tx MUST NOT survive — Postgres rolls
    // back INSERTs as well as UPDATEs. So we expect ZERO audit rows
    // for this idempotency key.
    //
    // (A separate non-posting failure-outcome audit row could be
    // written by the catch block — Contract 06 §7 permits this — but
    // the current production code does not write one. We assert the
    // absence of any success audit row keyed to this idempotency key.)
    const auditRowsForIdemKey = await sql`SELECT id, entity_type, entity_id, action_type FROM audit_logs WHERE tenant_id = ${T} AND idempotency_key = ${idemKey}`;
    expect(auditRowsForIdemKey.length).toBe(0); // no audit row survived rollback

    // 6. Idempotency state outside the rolled-back business tx.
    const idemState = await sql`SELECT state, last_error_class, attempt_count, owner_token, response_code, response_body FROM idempotency_records WHERE tenant_id = ${T} AND idempotency_key = ${idemKey}`;
    expect(idemState.length).toBe(1);
    expect(idemState[0]!.state).toBe("retryable_failed");
    expect(idemState[0]!.last_error_class).toBe("Error"); // name of injected Error
    expect(idemState[0]!.attempt_count).toBe(1);
    expect(idemState[0]!.owner_token).not.toBeNull(); // owner-token fencing preserved
    const firstOwnerToken = idemState[0]!.owner_token;
    expect(idemState[0]!.response_code).toBe(500);

    // === BLOCKER 2 (combined): immediate retry WITHOUT lease manipulation ===
    // Remove the fault only. Do NOT touch lease_expires_at. Do NOT
    // advance the clock. Same key + same request must reclaim and
    // succeed.
    injectFailure = false;
    const leaseBeforeRetry = await sql`SELECT lease_expires_at FROM idempotency_records WHERE tenant_id = ${T} AND idempotency_key = ${idemKey}`;
    // Negative assertion: lease is genuinely in the future and we
    // did NOT backdate it.
    expect(new Date(leaseBeforeRetry[0]!.lease_expires_at).getTime()).toBeGreaterThan(Date.now() - 1000);

    const outcome2 = await stagingService.finalizeCutoverManifest(makeUser() as any, makeEffective() as any, {
      importBatchId: batchId, domain: "inventory", cutoffDate: "2024-01-01",
      sourceCoverage: "all", openingBalanceBasis: "audit", liveSystemStartBoundary: null,
      idempotencyKey: idemKey,
    });

    expect(outcome2.action).toBe("finalized");

    // Prove exactly ONE new manifest now exists. If a prior was seeded,
    // the seeded one must now be superseded (is_current=false) and the
    // new one is current. If not seeded, exactly one manifest exists.
    const manifestsFinal = await sql`SELECT id, is_current, superseded_by, manifest_version FROM import_cutover_manifests WHERE tenant_id = ${T} AND import_batch_id = ${batchId} ORDER BY manifest_version`;
    if (opts.withSeededPriorManifest) {
      expect(manifestsFinal.length).toBe(2);
      // Seeded manifest is now superseded.
      const seeded = manifestsFinal.find((m: any) => m.id === seededManifestId);
      expect(seeded!.is_current).toBe(false);
      expect(seeded!.superseded_by).not.toBeNull();
      expect(seeded!.superseded_by).toBe(outcome2.manifestId);
      // New manifest is current, version=2.
      const fresh = manifestsFinal.find((m: any) => m.id === outcome2.manifestId);
      expect(fresh!.is_current).toBe(true);
      expect(fresh!.manifest_version).toBe(2);
    } else {
      expect(manifestsFinal.length).toBe(1);
      expect(manifestsFinal[0]!.is_current).toBe(true);
      expect(manifestsFinal[0]!.manifest_version).toBe(1);
      expect(manifestsFinal[0]!.id).toBe(outcome2.manifestId);
    }

    // attempt_count incremented by exactly 1.
    const idemState2 = await sql`SELECT state, attempt_count, owner_token FROM idempotency_records WHERE tenant_id = ${T} AND idempotency_key = ${idemKey}`;
    expect(idemState2[0]!.state).toBe("succeeded");
    expect(idemState2[0]!.attempt_count).toBe(idemState[0]!.attempt_count + 1);
    expect(idemState2[0]!.attempt_count).toBe(2);
    // Owner-token fencing: the retry reclaimed with a NEW owner token
    // (claimExpiredLease assigns a new one). The original token is no
    // longer the active owner — proves fencing semantics.
    expect(idemState2[0]!.owner_token).not.toBeNull();
    expect(idemState2[0]!.owner_token).not.toBe(firstOwnerToken);

    // Batch hash is now bound to the new manifest hash.
    const batchHashFinal = await sql`SELECT cutover_manifest_hash FROM import_batches WHERE id = ${batchId} AND tenant_id = ${T}`;
    expect(batchHashFinal[0]!.cutover_manifest_hash).toBe(outcome2.cutoverManifestHash);

    await cleanupData();
  }

  it("MAN-TECH-ROLLBACK-1a. mid-tx failure AFTER manifest insert + batch hash + audit → full rollback + immediate retry", async () => {
    await runRollbackTest({ withSeededPriorManifest: false });
  }, 30000);

  it("MAN-TECH-ROLLBACK-1b. mid-tx failure AFTER supersession of prior current manifest → supersession rolled back + immediate retry", async () => {
    await runRollbackTest({ withSeededPriorManifest: true });
  }, 30000);

  // ===========================================================================
  // Strengthened MAN-IDEMP-2..5: zero-effect proof for each conflict case
  // (carried over from r7 — same BEFORE/AFTER assertions on manifest count,
  // batch hash, approval count, idempotency record count, terminal state).
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
