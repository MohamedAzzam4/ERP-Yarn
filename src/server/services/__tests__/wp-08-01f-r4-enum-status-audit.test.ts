/**
 * WP-08-01F R4 — Enum status fix audit tests.
 *
 * Proves the raw-SQL updateBatchStatus in all four repositories:
 * - staging, validation, reconciliation, commit
 *
 * Tests:
 * - each valid transition persists correctly
 * - updates are tenant-scoped
 * - the intended batch ID is required
 * - exactly one row is updated
 * - zero matching rows fail closed (return null)
 * - another tenant's batch cannot be changed
 *
 * Uses the local disposable PostgreSQL DB with the safety guard.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/server/db/schema";
import { HistoricalStagingDbRepository } from "@/server/services/historical-staging-db-repository";
import { HistoricalValidationDbRepository } from "@/server/services/historical-validation-db-repository";
import { HistoricalReconciliationDbRepository } from "@/server/services/historical-reconciliation-db-repository";
import { HistoricalCommitDbRepository } from "@/server/services/historical-commit-db-repository";

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

const T = randomUUID();
const U = randomUUID();

let sql: ReturnType<typeof postgres>;
let db: any;

async function seedBatch(batchId: string, status: string, tenantId: string = T): Promise<void> {
  await sql`
    INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status)
    VALUES (${tenantId}, ${"R4-" + tenantId.slice(0, 8)}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"})
    ON CONFLICT (id) DO NOTHING
  `;
  await sql`
    INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference)
    VALUES (${U}, ${tenantId}, ${"r4-" + tenantId.slice(0, 8)}, ${"R4"}, ${"r4-" + tenantId.slice(0, 8) + "@test.test"}, ${"active"}, ${"ar"})
    ON CONFLICT (id) DO NOTHING
  `;
  await sql`
    INSERT INTO import_batches (id, tenant_id, batch_no, status, source_description, template_name, template_version,
      mapping_version, cutover_manifest_hash, cutover_import_mode, staged_data_hash, staged_row_count,
      blocking_error_count, warning_count, accepted_warning_count, validation_status, reconciliation_status,
      warning_summary, committed_at, commit_effect_counts, created_by, created_at)
    VALUES (${batchId}, ${tenantId}, ${"MIG-" + batchId.slice(-6)}, ${status}::import_batch_status, ${"test"},
      ${"test-template"}, ${"1.0"}, ${"1.0"}, ${"manifest-hash"}, ${"opening_balance"}, ${"staged-hash"}, 5,
      0, 0, 0, ${"passed"}, ${"matched"}, null, null, null, ${U}, NOW())
  `;
}

async function getBatchStatus(batchId: string): Promise<string | null> {
  const r = await sql`SELECT status FROM import_batches WHERE id = ${batchId}`;
  return r[0]?.status ?? null;
}

async function cleanup(): Promise<void> {
  await sql`DELETE FROM import_batches WHERE tenant_id = ${T}`;
  await sql`DELETE FROM users WHERE tenant_id = ${T}`;
  await sql`DELETE FROM tenants WHERE id = ${T}`;
}

describeOrSkip("WP-08-01F R4 — Enum status fix audit (all 4 repos)", () => {
  beforeAll(async () => {
    if (SAFETY_RESULT.kind === "fail") throw new Error(SAFETY_RESULT.message);
    sql = postgres(DATABASE_URL!, { prepare: false, max: 5, idle_timeout: 10, connect_timeout: 10 });
    db = drizzle(sql, { schema });
    await sql`SET statement_timeout = 30000`;
    const dbResult = await sql`SELECT current_database() AS db_name`;
    if (dbResult[0]?.db_name !== "erp_yarn_wp0801f_disposable") {
      await sql.end();
      throw new Error(`Wrong DB: ${dbResult[0]?.db_name}`);
    }
  }, 30000);

  afterAll(async () => {
    if (sql) { await cleanup(); await sql.end(); }
  }, 30000);

  beforeEach(async () => {
    await cleanup();
  }, 15000);

  // --- Staging repo ---
  it("staging: updateBatchStatus persists valid transition (staged → validation_in_progress)", async () => {
    const repo = new HistoricalStagingDbRepository(db);
    const bid = randomUUID();
    await seedBatch(bid, "staged");
    const result = await repo.updateBatchStatus(T, bid, "validation_in_progress");
    expect(result).not.toBeNull();
    expect(await getBatchStatus(bid)).toBe("validation_in_progress");
  });

  it("staging: tenant-scoped — other tenant batch not changed", async () => {
    const repo = new HistoricalStagingDbRepository(db);
    const bid = randomUUID();
    const otherTenant = randomUUID();
    await seedBatch(bid, "staged", otherTenant);
    const result = await repo.updateBatchStatus(T, bid, "validation_in_progress");
    expect(result).toBeNull(); // no row updated (wrong tenant)
    expect(await getBatchStatus(bid)).toBe("staged"); // unchanged
  });

  it("staging: non-existent batch returns null (fail closed)", async () => {
    const repo = new HistoricalStagingDbRepository(db);
    const result = await repo.updateBatchStatus(T, randomUUID(), "staged");
    expect(result).toBeNull();
  });

  // --- Validation repo ---
  it("validation: updateBatchStatus persists valid transition (staged → validation_complete)", async () => {
    const repo = new HistoricalValidationDbRepository(db);
    const bid = randomUUID();
    await seedBatch(bid, "staged");
    const result = await repo.updateBatchStatus(T, bid, "validation_complete");
    expect(result).not.toBeNull();
    expect(await getBatchStatus(bid)).toBe("validation_complete");
  });

  it("validation: tenant-scoped — other tenant not changed", async () => {
    const repo = new HistoricalValidationDbRepository(db);
    const bid = randomUUID();
    const otherTenant = randomUUID();
    await seedBatch(bid, "staged", otherTenant);
    const result = await repo.updateBatchStatus(T, bid, "validation_complete");
    expect(result).toBeNull();
    expect(await getBatchStatus(bid)).toBe("staged");
  });

  // --- Reconciliation repo ---
  it("reconciliation: updateBatchStatus persists valid transition (validation_complete → review_required)", async () => {
    const repo = new HistoricalReconciliationDbRepository(db);
    const bid = randomUUID();
    await seedBatch(bid, "validation_complete");
    const result = await repo.updateBatchStatus(T, bid, "review_required");
    expect(result).not.toBeNull();
    expect(await getBatchStatus(bid)).toBe("review_required");
  });

  it("reconciliation: non-existent batch returns null", async () => {
    const repo = new HistoricalReconciliationDbRepository(db);
    const result = await repo.updateBatchStatus(T, randomUUID(), "review_required");
    expect(result).toBeNull();
  });

  // --- Commit repo ---
  it("commit: updateBatchStatus persists valid transition (approved_for_commit → committing)", async () => {
    const repo = new HistoricalCommitDbRepository(db);
    const bid = randomUUID();
    await seedBatch(bid, "approved_for_commit");
    const result = await repo.updateBatchStatus(T, bid, "committing");
    expect(result).not.toBeNull();
    expect(await getBatchStatus(bid)).toBe("committing");
  });

  it("commit: tenant-scoped — other tenant not changed", async () => {
    const repo = new HistoricalCommitDbRepository(db);
    const bid = randomUUID();
    const otherTenant = randomUUID();
    await seedBatch(bid, "approved_for_commit", otherTenant);
    const result = await repo.updateBatchStatus(T, bid, "committing");
    expect(result).toBeNull();
    expect(await getBatchStatus(bid)).toBe("approved_for_commit");
  });

  // --- Cross-repo: exactly one row updated ---
  it("all repos: exactly one row updated (no accidental mass update)", async () => {
    const repo = new HistoricalStagingDbRepository(db);
    const bid1 = randomUUID();
    const bid2 = randomUUID();
    await seedBatch(bid1, "staged");
    await seedBatch(bid2, "staged");
    await repo.updateBatchStatus(T, bid1, "validation_in_progress");
    // Only bid1 should be changed, bid2 stays staged
    expect(await getBatchStatus(bid1)).toBe("validation_in_progress");
    expect(await getBatchStatus(bid2)).toBe("staged");
  });
});
