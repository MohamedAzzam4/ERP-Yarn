/**
 * WP-08-01F r6 — Manifest version persistence, supersession link,
 * idempotency conflicts, and business failure terminalization.
 *
 * BLOCKER A: manifestVersion persisted in real PostgreSQL
 * BLOCKER B: superseded_by provenance link
 * BLOCKER C: MAN-IDEMP-1..5 idempotency conflict tests
 * BLOCKER D: business failure terminalization (no orphaned in-progress)
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
  await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status) VALUES (${T}, ${"R6-" + s}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${U}, ${T}, ${"r6-" + s}, ${"R6 User"}, ${"r6-" + s + "@test.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
}

function makeUser(): ErpUserContext {
  return { authenticated: true, userId: U, tenantId: T, authId: `auth-${U}`, name: "Test", email: `test-${U}@test.local` };
}
function makeEffective() { return resolveEffectivePermissions(["owner"], TEST_ROLE_PERMISSION_MATRIX); }

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
  await sql`INSERT INTO import_batches (id, tenant_id, batch_no, status, source_description, template_name, template_version, mapping_version, cutover_manifest_hash, cutover_import_mode, staged_data_hash, staged_row_count, blocking_error_count, warning_count, accepted_warning_count, validation_status, reconciliation_status, warning_summary, committed_at, commit_effect_counts, created_by, created_at) VALUES (${batchId}, ${T}, ${"R6-" + batchId.slice(-6)}, ${status}::import_batch_status, ${"test"}, ${"opening_balance_inventory"}, ${"1.0"}, ${"1.0"}, ${"mh"}, ${"opening_balance"}, ${"sh"}, ${stagedRowCount}, 0, 0, 0, ${"passed"}, ${"matched"}, null, null, null, ${U}, NOW())`;
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

describeOrSkip("WP-08-01F r6 — Manifest version, supersession, idempotency, business failure", () => {
  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { prepare: false, max: 5, idle_timeout: 10, connect_timeout: 15 });
    db = drizzle(sql, { schema });
    await sql`SET statement_timeout = 30000`;
    await seedTenantAndUser();
  }, 30000);

  afterAll(async () => { if (sql) { await cleanupData(); await sql.end(); } }, 15000);

  // ===========================================================================
  // BLOCKER A + B: MAN-VERSION — Real PostgreSQL version persistence + supersession link
  // ===========================================================================
  it("MAN-VERSION-1. Real PostgreSQL manifest version V1→V2→V3 with supersession link", async () => {
    const { stagingService } = makeServices();
    const batchId = randomUUID();
    await seedBatch(batchId, "staged");
    const fileId = await seedFile(batchId);
    await seedStagingRow(batchId, fileId);

    // V1: finalize manifest
    const r1 = await stagingService.finalizeCutoverManifest(makeUser() as any, makeEffective() as any, {
      importBatchId: batchId, domain: "inventory", cutoffDate: "2024-01-01",
      sourceCoverage: "all", openingBalanceBasis: "audit", liveSystemStartBoundary: null,
      idempotencyKey: "mv-v1-" + randomUUID(),
    });
    expect(r1.action).toBe("finalized");
    const v1Id = r1.manifestId!;

    // Query V1 from PostgreSQL
    const v1 = await sql`SELECT id, manifest_version, is_current, superseded_by, superseded_at FROM import_cutover_manifests WHERE id = ${v1Id}`;
    expect(v1[0]!.manifest_version).toBe(1);
    expect(v1[0]!.is_current).toBe(true);
    expect(v1[0]!.superseded_by).toBeNull();

    // Simulate rework: batch back to staged
    await sql`UPDATE import_batches SET status = ${"staged"}::import_batch_status WHERE id = ${batchId} AND tenant_id = ${T}`;

    // V2: finalize same domain again
    const r2 = await stagingService.finalizeCutoverManifest(makeUser() as any, makeEffective() as any, {
      importBatchId: batchId, domain: "inventory", cutoffDate: "2024-01-02",
      sourceCoverage: "partial", openingBalanceBasis: "audit2", liveSystemStartBoundary: null,
      idempotencyKey: "mv-v2-" + randomUUID(),
    });
    expect(r2.action).toBe("finalized");
    const v2Id = r2.manifestId!;

    // Query V1 after V2
    const v1AfterV2 = await sql`SELECT manifest_version, is_current, superseded_by FROM import_cutover_manifests WHERE id = ${v1Id}`;
    expect(v1AfterV2[0]!.is_current).toBe(false);
    expect(v1AfterV2[0]!.superseded_by).toBe(v2Id);

    // Query V2
    const v2 = await sql`SELECT manifest_version, is_current, superseded_by FROM import_cutover_manifests WHERE id = ${v2Id}`;
    expect(v2[0]!.manifest_version).toBe(2);
    expect(v2[0]!.is_current).toBe(true);
    expect(v2[0]!.superseded_by).toBeNull();

    // Exactly one current for this domain
    const currentCount = await sql`SELECT count(*)::int AS c FROM import_cutover_manifests WHERE tenant_id = ${T} AND import_batch_id = ${batchId} AND domain = ${"inventory"} AND is_current = true`;
    expect(currentCount[0]!.c).toBe(1);

    // V3: another rework cycle
    await sql`UPDATE import_batches SET status = ${"staged"}::import_batch_status WHERE id = ${batchId} AND tenant_id = ${T}`;
    const r3 = await stagingService.finalizeCutoverManifest(makeUser() as any, makeEffective() as any, {
      importBatchId: batchId, domain: "inventory", cutoffDate: "2024-01-03",
      sourceCoverage: "all3", openingBalanceBasis: "audit3", liveSystemStartBoundary: null,
      idempotencyKey: "mv-v3-" + randomUUID(),
    });
    const v3Id = r3.manifestId!;

    const v3 = await sql`SELECT manifest_version, is_current FROM import_cutover_manifests WHERE id = ${v3Id}`;
    expect(v3[0]!.manifest_version).toBe(3);
    expect(v3[0]!.is_current).toBe(true);

    const v2AfterV3 = await sql`SELECT is_current, superseded_by FROM import_cutover_manifests WHERE id = ${v2Id}`;
    expect(v2AfterV3[0]!.is_current).toBe(false);
    expect(v2AfterV3[0]!.superseded_by).toBe(v3Id);

    // Still exactly one current
    const currentCount3 = await sql`SELECT count(*)::int AS c FROM import_cutover_manifests WHERE tenant_id = ${T} AND import_batch_id = ${batchId} AND domain = ${"inventory"} AND is_current = true`;
    expect(currentCount3[0]!.c).toBe(1);

    await cleanupData();
  }, 30000);

  // ===========================================================================
  // BLOCKER C: MAN-IDEMP-1..5
  // ===========================================================================
  it("MAN-IDEMP-1. same key + exact same full request → deterministic replay", async () => {
    const { stagingService } = makeServices();
    const batchId = randomUUID();
    await seedBatch(batchId, "staged");
    const fileId = await seedFile(batchId);
    await seedStagingRow(batchId, fileId);
    const idemKey = "mi1-" + randomUUID();

    const input = {
      importBatchId: batchId, domain: "inventory", cutoffDate: "2024-01-01",
      sourceCoverage: "all", openingBalanceBasis: "audit", liveSystemStartBoundary: null,
      idempotencyKey: idemKey,
    };

    const r1 = await stagingService.finalizeCutoverManifest(makeUser() as any, makeEffective() as any, input);
    expect(r1.action).toBe("finalized");
    const r2 = await stagingService.finalizeCutoverManifest(makeUser() as any, makeEffective() as any, input);
    expect(r2.action).toBe("replayed");
    expect(r2.manifestId).toBe(r1.manifestId);

    const manifestCount = await sql`SELECT count(*)::int AS c FROM import_cutover_manifests WHERE tenant_id = ${T} AND import_batch_id = ${batchId}`;
    expect(manifestCount[0]!.c).toBe(1);

    await cleanupData();
  }, 15000);

  it("MAN-IDEMP-2. same key + changed sourceCoverage → IDEMPOTENCY_CONFLICT", async () => {
    const { stagingService } = makeServices();
    const batchId = randomUUID();
    await seedBatch(batchId, "staged");
    const fileId = await seedFile(batchId);
    await seedStagingRow(batchId, fileId);
    const idemKey = "mi2-" + randomUUID();

    await stagingService.finalizeCutoverManifest(makeUser() as any, makeEffective() as any, {
      importBatchId: batchId, domain: "inventory", cutoffDate: "2024-01-01",
      sourceCoverage: "all", openingBalanceBasis: "audit", liveSystemStartBoundary: null,
      idempotencyKey: idemKey,
    });

    const manifestCountBefore = await sql`SELECT count(*)::int AS c FROM import_cutover_manifests WHERE tenant_id = ${T} AND import_batch_id = ${batchId}`;

    await expect(
      stagingService.finalizeCutoverManifest(makeUser() as any, makeEffective() as any, {
        importBatchId: batchId, domain: "inventory", cutoffDate: "2024-01-01",
        sourceCoverage: "CHANGED", openingBalanceBasis: "audit", liveSystemStartBoundary: null,
        idempotencyKey: idemKey,
      }),
    ).rejects.toThrow(/Idempotency key conflict/i);

    const manifestCountAfter = await sql`SELECT count(*)::int AS c FROM import_cutover_manifests WHERE tenant_id = ${T} AND import_batch_id = ${batchId}`;
    expect(manifestCountAfter[0]!.c).toBe(manifestCountBefore[0]!.c);

    await cleanupData();
  }, 15000);

  it("MAN-IDEMP-3. same key + changed openingBalanceBasis → IDEMPOTENCY_CONFLICT", async () => {
    const { stagingService } = makeServices();
    const batchId = randomUUID();
    await seedBatch(batchId, "staged");
    const fileId = await seedFile(batchId);
    await seedStagingRow(batchId, fileId);
    const idemKey = "mi3-" + randomUUID();

    await stagingService.finalizeCutoverManifest(makeUser() as any, makeEffective() as any, {
      importBatchId: batchId, domain: "inventory", cutoffDate: "2024-01-01",
      sourceCoverage: "all", openingBalanceBasis: "audit", liveSystemStartBoundary: null,
      idempotencyKey: idemKey,
    });

    await expect(
      stagingService.finalizeCutoverManifest(makeUser() as any, makeEffective() as any, {
        importBatchId: batchId, domain: "inventory", cutoffDate: "2024-01-01",
        sourceCoverage: "all", openingBalanceBasis: "CHANGED", liveSystemStartBoundary: null,
        idempotencyKey: idemKey,
      }),
    ).rejects.toThrow(/Idempotency key conflict/i);

    await cleanupData();
  }, 15000);

  it("MAN-IDEMP-4. same key + changed liveSystemStartBoundary → IDEMPOTENCY_CONFLICT", async () => {
    const { stagingService } = makeServices();
    const batchId = randomUUID();
    await seedBatch(batchId, "staged");
    const fileId = await seedFile(batchId);
    await seedStagingRow(batchId, fileId);
    const idemKey = "mi4-" + randomUUID();

    await stagingService.finalizeCutoverManifest(makeUser() as any, makeEffective() as any, {
      importBatchId: batchId, domain: "inventory", cutoffDate: "2024-01-01",
      sourceCoverage: "all", openingBalanceBasis: "audit", liveSystemStartBoundary: null,
      idempotencyKey: idemKey,
    });

    await expect(
      stagingService.finalizeCutoverManifest(makeUser() as any, makeEffective() as any, {
        importBatchId: batchId, domain: "inventory", cutoffDate: "2024-01-01",
        sourceCoverage: "all", openingBalanceBasis: "audit", liveSystemStartBoundary: "2024-06-01",
        idempotencyKey: idemKey,
      }),
    ).rejects.toThrow(/Idempotency key conflict/i);

    await cleanupData();
  }, 15000);

  it("MAN-IDEMP-5. same key + changed cutoffDate → IDEMPOTENCY_CONFLICT", async () => {
    const { stagingService } = makeServices();
    const batchId = randomUUID();
    await seedBatch(batchId, "staged");
    const fileId = await seedFile(batchId);
    await seedStagingRow(batchId, fileId);
    const idemKey = "mi5-" + randomUUID();

    await stagingService.finalizeCutoverManifest(makeUser() as any, makeEffective() as any, {
      importBatchId: batchId, domain: "inventory", cutoffDate: "2024-01-01",
      sourceCoverage: "all", openingBalanceBasis: "audit", liveSystemStartBoundary: null,
      idempotencyKey: idemKey,
    });

    await expect(
      stagingService.finalizeCutoverManifest(makeUser() as any, makeEffective() as any, {
        importBatchId: batchId, domain: "inventory", cutoffDate: "2024-12-31",
        sourceCoverage: "all", openingBalanceBasis: "audit", liveSystemStartBoundary: null,
        idempotencyKey: idemKey,
      }),
    ).rejects.toThrow(/Idempotency key conflict/i);

    await cleanupData();
  }, 15000);

  // ===========================================================================
  // BLOCKER D: Business failure terminalization
  // ===========================================================================
  it("MAN-FAIL-1. invalid lifecycle → business_failed → same-key replay → not OPERATION_IN_PROGRESS", async () => {
    const { stagingService } = makeServices();
    const batchId = randomUUID();
    // Seed batch at pending_dual_approval (not allowed for manifest finalization)
    await seedBatch(batchId, "pending_dual_approval");
    const fileId = await seedFile(batchId);
    await seedStagingRow(batchId, fileId);
    const idemKey = "mf1-" + randomUUID();

    // FIRST call: should fail with INVALID_BATCH_STATUS
    const outcome1 = await stagingService.finalizeCutoverManifest(makeUser() as any, makeEffective() as any, {
      importBatchId: batchId, domain: "inventory", cutoffDate: "2024-01-01",
      sourceCoverage: "all", openingBalanceBasis: "audit", liveSystemStartBoundary: null,
      idempotencyKey: idemKey,
    }).then(v => ({ ok: true as const, v }), e => ({ ok: false as const, e }));

    expect(outcome1.ok).toBe(false);
    if (!outcome1.ok) {
      expect(String(outcome1.e?.message ?? outcome1.e)).toMatch(/INVALID_BATCH_STATUS|Cannot finalize cutover manifest/i);
    }

    // Check idempotency record state — should be business_failed, NOT in_progress
    const idemState = await sql`SELECT state FROM idempotency_records WHERE tenant_id = ${T} AND idempotency_key = ${idemKey}`;
    expect(idemState[0]!.state).toBe("business_failed");

    // SECOND call: same key + same request → should replay business_failed
    // (NOT OPERATION_IN_PROGRESS)
    const outcome2 = await stagingService.finalizeCutoverManifest(makeUser() as any, makeEffective() as any, {
      importBatchId: batchId, domain: "inventory", cutoffDate: "2024-01-01",
      sourceCoverage: "all", openingBalanceBasis: "audit", liveSystemStartBoundary: null,
      idempotencyKey: idemKey,
    }).then(v => ({ ok: true as const, v }), e => ({ ok: false as const, e }));

    expect(outcome2.ok).toBe(false);
    if (!outcome2.ok) {
      // Must be the replayed business failure, NOT OPERATION_IN_PROGRESS
      const errMsg = String(outcome2.e?.message ?? outcome2.e);
      expect(errMsg).not.toMatch(/OPERATION_IN_PROGRESS/i);
      expect(errMsg).toMatch(/INVALID_BATCH_STATUS|Cannot finalize cutover manifest|BUSINESS_FAILED/i);
    }

    // THIRD call: same key + different request → IDEMPOTENCY_CONFLICT
    const outcome3 = await stagingService.finalizeCutoverManifest(makeUser() as any, makeEffective() as any, {
      importBatchId: batchId, domain: "inventory", cutoffDate: "2024-12-31",
      sourceCoverage: "all", openingBalanceBasis: "audit", liveSystemStartBoundary: null,
      idempotencyKey: idemKey,
    }).then(v => ({ ok: true as const, v }), e => ({ ok: false as const, e }));

    expect(outcome3.ok).toBe(false);
    if (!outcome3.ok) {
      expect(String(outcome3.e?.message ?? outcome3.e)).toMatch(/Idempotency key conflict|IDEMPOTENCY_CONFLICT/i);
    }

    await cleanupData();
  }, 15000);
});
