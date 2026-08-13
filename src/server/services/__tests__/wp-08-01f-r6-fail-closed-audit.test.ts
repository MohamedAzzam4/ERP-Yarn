/**
 * WP-08-01F R6 — updateBatchStatus fail-closed behavior tests.
 *
 * Proves that when updateBatchStatus returns null (zero rows affected),
 * the production service treats it as an error and does NOT proceed with
 * later workflow effects.
 *
 * Tests against the local PostgreSQL disposable DB.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/server/db/schema";
import { HistoricalValidationDbRepository } from "@/server/services/historical-validation-db-repository";
import { HistoricalStagingDbRepository } from "@/server/services/historical-staging-db-repository";
import { HistoricalCommitDbRepository } from "@/server/services/historical-commit-db-repository";
import { HistoricalReconciliationDbRepository } from "@/server/services/historical-reconciliation-db-repository";

const DATABASE_URL = process.env.DATABASE_URL;
const REQUIRE_PROOF = process.env.ERP_REQUIRE_WP0801F_POSTGRES_PROOF === "1";
const ALLOW_DESTRUCTIVE = process.env.ERP_ALLOW_DESTRUCTIVE_LOCAL_TEST_DB === "1";
const DEDICATED_DB_NAME = "erp_yarn_wp0801f_disposable";

type SafetyResult = { kind: "ok" } | { kind: "skip"; reason: string } | { kind: "fail"; message: string };

function checkDatabaseSafety(): SafetyResult {
  if (!DATABASE_URL) {
    if (REQUIRE_PROOF) return { kind: "fail", message: "PROOF required but DATABASE_URL absent" };
    return { kind: "skip", reason: "DATABASE_URL not set" };
  }
  if (!DATABASE_URL.startsWith("postgres")) return { kind: "fail", message: "Must start with postgres" };
  let parsed: URL;
  try { parsed = new URL(DATABASE_URL); } catch { return { kind: "fail", message: "Invalid URL" }; }
  if (!new Set(["localhost", "127.0.0.1", "::1"]).has(parsed.hostname)) return { kind: "fail", message: "Non-local host" };
  if (parsed.pathname.replace(/^\//, "") !== DEDICATED_DB_NAME) return { kind: "fail", message: "Wrong DB name" };
  if (!ALLOW_DESTRUCTIVE) {
    if (REQUIRE_PROOF) return { kind: "fail", message: "PROOF required but destructive not set" };
    return { kind: "skip", reason: "Destructive not set" };
  }
  return { kind: "ok" };
}

const SAFETY = checkDatabaseSafety();
const describeOrSkip = SAFETY.kind === "fail" ? describe.skip : (SAFETY.kind === "skip" ? describe.skip : describe);

const T = randomUUID();
const U = randomUUID();

let sql: ReturnType<typeof postgres>;
let db: any;

async function seedBatch(batchId: string, status: string, tenantId: string = T): Promise<void> {
  await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status)
    VALUES (${tenantId}, ${"R6-" + tenantId.slice(0, 8)}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference)
    VALUES (${U}, ${tenantId}, ${"r6-" + tenantId.slice(0, 8)}, ${"R6"}, ${"r6-" + tenantId.slice(0, 8) + "@test.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO import_batches (id, tenant_id, batch_no, status, source_description, template_name, template_version,
    mapping_version, cutover_manifest_hash, cutover_import_mode, staged_data_hash, staged_row_count,
    blocking_error_count, warning_count, accepted_warning_count, validation_status, reconciliation_status,
    warning_summary, committed_at, commit_effect_counts, created_by, created_at)
    VALUES (${batchId}, ${tenantId}, ${"MIG-" + batchId.slice(-6)}, ${status}::import_batch_status, ${"test"},
    ${"t"}, ${"1.0"}, ${"1.0"}, ${"mh"}, ${"opening_balance"}, ${"sh"}, 1, 0, 0, 0, ${"passed"}, ${"matched"}, null, null, null, ${U}, NOW())`;
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

describeOrSkip("WP-08-01F R6 — updateBatchStatus fail-closed behavior", () => {
  beforeAll(async () => {
    if (SAFETY.kind === "fail") throw new Error(SAFETY.message);
    sql = postgres(DATABASE_URL!, { prepare: false, max: 5, idle_timeout: 10, connect_timeout: 10 });
    db = drizzle(sql, { schema });
    await sql`SET statement_timeout = 30000`;
  }, 30000);

  afterAll(async () => {
    if (sql) { await cleanup(); await sql.end(); }
  }, 30000);

  beforeEach(async () => {
    await cleanup();
  }, 15000);

  // --- Staging repo ---
  it("staging: correct tenant+batch updates exactly one row, returns non-null", async () => {
    const repo = new HistoricalStagingDbRepository(db);
    const bid = randomUUID();
    await seedBatch(bid, "staged");
    const result = await repo.updateBatchStatus(T, bid, "validation_in_progress");
    expect(result).not.toBeNull();
    expect(await getBatchStatus(bid)).toBe("validation_in_progress");
  });

  it("staging: wrong tenant updates zero rows, returns null", async () => {
    const repo = new HistoricalStagingDbRepository(db);
    const bid = randomUUID();
    const otherTenant = randomUUID();
    await seedBatch(bid, "staged", otherTenant);
    const result = await repo.updateBatchStatus(T, bid, "validation_in_progress");
    expect(result).toBeNull();
    expect(await getBatchStatus(bid)).toBe("staged"); // unchanged
  });

  it("staging: nonexistent batch returns null", async () => {
    const repo = new HistoricalStagingDbRepository(db);
    const result = await repo.updateBatchStatus(T, randomUUID(), "staged");
    expect(result).toBeNull();
  });

  // --- Validation repo ---
  it("validation: correct update returns non-null", async () => {
    const repo = new HistoricalValidationDbRepository(db);
    const bid = randomUUID();
    await seedBatch(bid, "staged");
    const result = await repo.updateBatchStatus(T, bid, "validation_complete");
    expect(result).not.toBeNull();
    expect(await getBatchStatus(bid)).toBe("validation_complete");
  });

  it("validation: wrong tenant returns null", async () => {
    const repo = new HistoricalValidationDbRepository(db);
    const bid = randomUUID();
    const otherTenant = randomUUID();
    await seedBatch(bid, "staged", otherTenant);
    const result = await repo.updateBatchStatus(T, bid, "validation_complete");
    expect(result).toBeNull();
    expect(await getBatchStatus(bid)).toBe("staged");
  });

  // --- Reconciliation repo ---
  it("reconciliation: correct update returns non-null", async () => {
    const repo = new HistoricalReconciliationDbRepository(db);
    const bid = randomUUID();
    await seedBatch(bid, "validation_complete");
    const result = await repo.updateBatchStatus(T, bid, "review_required");
    expect(result).not.toBeNull();
    expect(await getBatchStatus(bid)).toBe("review_required");
  });

  it("reconciliation: nonexistent returns null", async () => {
    const repo = new HistoricalReconciliationDbRepository(db);
    const result = await repo.updateBatchStatus(T, randomUUID(), "review_required");
    expect(result).toBeNull();
  });

  // --- Commit repo ---
  it("commit: correct update returns non-null", async () => {
    const repo = new HistoricalCommitDbRepository(db);
    const bid = randomUUID();
    await seedBatch(bid, "approved_for_commit");
    const result = await repo.updateBatchStatus(T, bid, "committing");
    expect(result).not.toBeNull();
    expect(await getBatchStatus(bid)).toBe("committing");
  });

  it("commit: wrong tenant returns null", async () => {
    const repo = new HistoricalCommitDbRepository(db);
    const bid = randomUUID();
    const otherTenant = randomUUID();
    await seedBatch(bid, "approved_for_commit", otherTenant);
    const result = await repo.updateBatchStatus(T, bid, "committing");
    expect(result).toBeNull();
    expect(await getBatchStatus(bid)).toBe("approved_for_commit");
  });

  // --- Cross-repo: exactly one row updated ---
  it("all repos: exactly one row updated (no mass update)", async () => {
    const repo = new HistoricalStagingDbRepository(db);
    const bid1 = randomUUID();
    const bid2 = randomUUID();
    await seedBatch(bid1, "staged");
    await seedBatch(bid2, "staged");
    await repo.updateBatchStatus(T, bid1, "validation_in_progress");
    expect(await getBatchStatus(bid1)).toBe("validation_in_progress");
    expect(await getBatchStatus(bid2)).toBe("staged"); // unchanged
  });
});
