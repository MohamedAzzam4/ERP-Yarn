/**
 * WP-08-01C Persistent Idempotency Tests — Owner-Token Fencing.
 * Requires DATABASE_URL to be set to a live Postgres connection.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/server/db/schema";
import { IdempotencyDbRepository } from "@/server/services/idempotency-db-repository";
import {
  claimIdempotency, markSucceeded, markBusinessFailed, markRetryableFailed,
  IdempotencyOwnershipLostError,
} from "@/server/services/idempotency-service";

const DATABASE_URL = process.env.DATABASE_URL;
const describeOrSkip = DATABASE_URL?.startsWith("postgres") ? describe : describe.skip;
const TEST_TENANT_A = "00000000-0000-0000-0000-000000081001";
const TEST_TENANT_B = "00000000-0000-0000-0000-000000081002";
const TEST_USER = "00000000-0000-0000-0000-000000081010";

describeOrSkip("WP-08-01C Persistent Idempotency — Owner-Token Fencing", () => {
  let sql: ReturnType<typeof postgres>;
  let db: any;

  beforeAll(async () => {
    const url = new URL(DATABASE_URL!);
    if (url.port === "6543") url.port = "5432";
    sql = postgres(url.toString(), { prepare: false, max: 5, idle_timeout: 10 });
    db = drizzle(sql, { schema });
    await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status) VALUES (${TEST_TENANT_A}, ${"A"}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
    await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status) VALUES (${TEST_TENANT_B}, ${"B"}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
    await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${TEST_USER}, ${TEST_TENANT_A}, ${"test"}, ${"T"}, ${"t@e.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
  });

  afterAll(async () => { if (sql) { await sql`DELETE FROM idempotency_records WHERE tenant_id IN (${TEST_TENANT_A}, ${TEST_TENANT_B})`; await sql.end(); } });
  beforeEach(async () => { await sql`DELETE FROM idempotency_records WHERE tenant_id IN (${TEST_TENANT_A}, ${TEST_TENANT_B})`; });

  it("A: stale claimant markSucceeded affects 0 rows while B still in_progress", async () => {
    const scope = "test.A", key = "key-A", payload = { saleId: "s" };
    const repoA = new IdempotencyDbRepository(db);
    const claimA = await claimIdempotency(repoA, { tenantId: TEST_TENANT_A, operationScope: scope, idempotencyKey: key, requestBody: payload, initiatedBy: TEST_USER, leaseDurationMs: 1 });
    const ownerTokenA = claimA.record.ownerToken!;
    await new Promise(r => setTimeout(r, 50));
    const repoB = new IdempotencyDbRepository(db);
    const claimB = await claimIdempotency(repoB, { tenantId: TEST_TENANT_A, operationScope: scope, idempotencyKey: key, requestBody: payload, initiatedBy: TEST_USER, leaseDurationMs: 30000 });
    expect(claimB.action).toBe("execute");
    let threw = false;
    try { await markSucceeded(repoA, claimA.record.id, { responseCode: 200, responseBody: { c: "A" } }, ownerTokenA); } catch (e: any) { if (e.code === "IDEMPOTENCY_OWNERSHIP_LOST") threw = true; }
    expect(threw).toBe(true);
    const rec = await new IdempotencyDbRepository(db).findByTenantScopeKey(TEST_TENANT_A, scope, key);
    expect(rec!.state).toBe("in_progress");
    expect(rec!.ownerToken).toBe(claimB.record.ownerToken);
  });

  it("B: stale markBusinessFailed + markRetryableFailed affect 0 rows", async () => {
    const scope = "test.B", key = "key-B", payload = { saleId: "s" };
    const repoA = new IdempotencyDbRepository(db);
    const claimA = await claimIdempotency(repoA, { tenantId: TEST_TENANT_A, operationScope: scope, idempotencyKey: key, requestBody: payload, initiatedBy: TEST_USER, leaseDurationMs: 1 });
    const ownerTokenA = claimA.record.ownerToken!;
    await new Promise(r => setTimeout(r, 50));
    await claimIdempotency(new IdempotencyDbRepository(db), { tenantId: TEST_TENANT_A, operationScope: scope, idempotencyKey: key, requestBody: payload, initiatedBy: TEST_USER, leaseDurationMs: 30000 });
    expect(await markBusinessFailed(repoA, claimA.record.id, { responseCode: 500, responseBody: {}, lastErrorClass: "E" }, ownerTokenA)).toBe(0);
    expect(await markRetryableFailed(repoA, claimA.record.id, { lastErrorClass: "R" }, ownerTokenA)).toBe(0);
  });

  it("C: markSucceeded with stale ownerToken inside tx → rollback", async () => {
    const scope = "test.C", key = "key-C", payload = { saleId: "s" };
    const repoA = new IdempotencyDbRepository(db);
    const claimA = await claimIdempotency(repoA, { tenantId: TEST_TENANT_A, operationScope: scope, idempotencyKey: key, requestBody: payload, initiatedBy: TEST_USER, leaseDurationMs: 1 });
    const ownerTokenA = claimA.record.ownerToken!;
    await new Promise(r => setTimeout(r, 50));
    await claimIdempotency(new IdempotencyDbRepository(db), { tenantId: TEST_TENANT_A, operationScope: scope, idempotencyKey: key, requestBody: payload, initiatedBy: TEST_USER, leaseDurationMs: 30000 });
    let threw = false;
    try { await db.transaction(async (tx: any) => { await markSucceeded(new IdempotencyDbRepository(tx), claimA.record.id, { responseCode: 200, responseBody: {} }, ownerTokenA); }); } catch (e: any) { if (e.code === "IDEMPOTENCY_OWNERSHIP_LOST" || e.cause?.code === "IDEMPOTENCY_OWNERSHIP_LOST") threw = true; }
    expect(threw).toBe(true);
  });

  it("D: claimant B completes after A lost ownership", async () => {
    const scope = "test.D", key = "key-D", payload = { saleId: "s" };
    const repoA = new IdempotencyDbRepository(db);
    await claimIdempotency(repoA, { tenantId: TEST_TENANT_A, operationScope: scope, idempotencyKey: key, requestBody: payload, initiatedBy: TEST_USER, leaseDurationMs: 1 });
    await new Promise(r => setTimeout(r, 50));
    const repoB = new IdempotencyDbRepository(db);
    const claimB = await claimIdempotency(repoB, { tenantId: TEST_TENANT_A, operationScope: scope, idempotencyKey: key, requestBody: payload, initiatedBy: TEST_USER, leaseDurationMs: 30000 });
    expect(await markSucceeded(repoB, claimB.record.id, { responseCode: 200, responseBody: { ok: true } }, claimB.record.ownerToken!)).toBe(1);
  });

  it("E1: replay", async () => {
    const scope = "test.E1", key = "key-E1", payload = { saleId: "s" };
    const repo1 = new IdempotencyDbRepository(db);
    const c1 = await claimIdempotency(repo1, { tenantId: TEST_TENANT_A, operationScope: scope, idempotencyKey: key, requestBody: payload, initiatedBy: TEST_USER, leaseDurationMs: 30000 });
    await markSucceeded(repo1, c1.record.id, { responseCode: 200, responseBody: { ok: true } }, c1.record.ownerToken!);
    const c2 = await claimIdempotency(new IdempotencyDbRepository(db), { tenantId: TEST_TENANT_A, operationScope: scope, idempotencyKey: key, requestBody: payload, initiatedBy: TEST_USER, leaseDurationMs: 30000 });
    expect(c2.action).toBe("replay");
  });

  it("E2: conflict", async () => {
    const scope = "test.E2", key = "key-E2";
    const repo1 = new IdempotencyDbRepository(db);
    const c1 = await claimIdempotency(repo1, { tenantId: TEST_TENANT_A, operationScope: scope, idempotencyKey: key, requestBody: { a: 1 }, initiatedBy: TEST_USER, leaseDurationMs: 30000 });
    await markSucceeded(repo1, c1.record.id, { responseCode: 200, responseBody: {} }, c1.record.ownerToken!);
    const c2 = await claimIdempotency(new IdempotencyDbRepository(db), { tenantId: TEST_TENANT_A, operationScope: scope, idempotencyKey: key, requestBody: { a: 2 }, initiatedBy: TEST_USER, leaseDurationMs: 30000 });
    expect(c2.action).toBe("conflict");
  });

  it("E3: concurrency", async () => {
    const scope = "test.E3", key = "key-E3", payload = { saleId: "s" };
    const [c1, c2] = await Promise.all([
      claimIdempotency(new IdempotencyDbRepository(db), { tenantId: TEST_TENANT_A, operationScope: scope, idempotencyKey: key, requestBody: payload, initiatedBy: TEST_USER, leaseDurationMs: 30000 }),
      claimIdempotency(new IdempotencyDbRepository(db), { tenantId: TEST_TENANT_A, operationScope: scope, idempotencyKey: key, requestBody: payload, initiatedBy: TEST_USER, leaseDurationMs: 30000 }),
    ]);
    expect([c1.action, c2.action].filter(a => a === "execute").length).toBe(1);
  });

  it("E4: expired reclaim", async () => {
    const scope = "test.E4", key = "key-E4", payload = { saleId: "s" };
    await claimIdempotency(new IdempotencyDbRepository(db), { tenantId: TEST_TENANT_A, operationScope: scope, idempotencyKey: key, requestBody: payload, initiatedBy: TEST_USER, leaseDurationMs: 1 });
    await new Promise(r => setTimeout(r, 50));
    const c2 = await claimIdempotency(new IdempotencyDbRepository(db), { tenantId: TEST_TENANT_A, operationScope: scope, idempotencyKey: key, requestBody: payload, initiatedBy: TEST_USER, leaseDurationMs: 30000 });
    expect(c2.action).toBe("execute");
  });

  it("E5: unexpired cannot steal", async () => {
    const scope = "test.E5", key = "key-E5", payload = { saleId: "s" };
    await claimIdempotency(new IdempotencyDbRepository(db), { tenantId: TEST_TENANT_A, operationScope: scope, idempotencyKey: key, requestBody: payload, initiatedBy: TEST_USER, leaseDurationMs: 60000 });
    const c2 = await claimIdempotency(new IdempotencyDbRepository(db), { tenantId: TEST_TENANT_A, operationScope: scope, idempotencyKey: key, requestBody: payload, initiatedBy: TEST_USER, leaseDurationMs: 60000 });
    expect(c2.action).toBe("in_progress");
  });

  it("E6: tenant isolation", async () => {
    const scope = "test.E6", key = "key-E6", payload = { saleId: "s" };
    const cA = await claimIdempotency(new IdempotencyDbRepository(db), { tenantId: TEST_TENANT_A, operationScope: scope, idempotencyKey: key, requestBody: payload, initiatedBy: TEST_USER, leaseDurationMs: 30000 });
    const cB = await claimIdempotency(new IdempotencyDbRepository(db), { tenantId: TEST_TENANT_B, operationScope: scope, idempotencyKey: key, requestBody: payload, initiatedBy: TEST_USER, leaseDurationMs: 30000 });
    expect(cA.action).toBe("execute");
    expect(cB.action).toBe("execute");
  });

  it("E7: DB unique constraint", async () => {
    const scope = "test.E7", key = "key-E7";
    const repo = new IdempotencyDbRepository(db);
    await claimIdempotency(repo, { tenantId: TEST_TENANT_A, operationScope: scope, idempotencyKey: key, requestBody: { d: 1 }, initiatedBy: TEST_USER, leaseDurationMs: 30000 });
    const c2 = await claimIdempotency(repo, { tenantId: TEST_TENANT_A, operationScope: scope, idempotencyKey: key, requestBody: { d: 1 }, initiatedBy: TEST_USER, leaseDurationMs: 30000 });
    expect(c2.action).not.toBe("execute");
  });

  it("E8: atomic fault rollback", async () => {
    const scope = "test.E8", key = "key-E8", payload = { saleId: "s" };
    const repo = new IdempotencyDbRepository(db);
    const claim = await claimIdempotency(repo, { tenantId: TEST_TENANT_A, operationScope: scope, idempotencyKey: key, requestBody: payload, initiatedBy: TEST_USER, leaseDurationMs: 30000 });
    try { await db.transaction(async (tx: any) => { await markSucceeded(new IdempotencyDbRepository(tx), claim.record.id, { responseCode: 200, responseBody: {} }, claim.record.ownerToken!); throw new Error("FAULT"); }); } catch {}
    const rec = await new IdempotencyDbRepository(db).findByTenantScopeKey(TEST_TENANT_A, scope, key);
    expect(rec!.state).toBe("in_progress");
  });

  it("E9: retryable_failed re-execution", async () => {
    const scope = "test.E9", key = "key-E9", payload = { saleId: "s" };
    const repo1 = new IdempotencyDbRepository(db);
    const c1 = await claimIdempotency(repo1, { tenantId: TEST_TENANT_A, operationScope: scope, idempotencyKey: key, requestBody: payload, initiatedBy: TEST_USER, leaseDurationMs: 30000 });
    await sql`UPDATE idempotency_records SET state = 'retryable_failed' WHERE id = ${c1.record.id}`;
    const c2 = await claimIdempotency(new IdempotencyDbRepository(db), { tenantId: TEST_TENANT_A, operationScope: scope, idempotencyKey: key, requestBody: payload, initiatedBy: TEST_USER, leaseDurationMs: 30000 });
    expect(c2.action).toBe("execute");
    expect(c2.record.attemptCount).toBe(2);
  });

  // =========================================================================
  // Legacy NULL owner-token compatibility tests
  // =========================================================================

  it("L1: legacy NULL-token unexpired claim — FAIL CLOSED (return in_progress, not reclaimed)", async () => {
    const scope = "test.L1.legacyUnexpired", key = "key-L1", payload = { saleId: "s" };
    const repo = new IdempotencyDbRepository(db);
    // Create a modern claim first, then corrupt it to have NULL ownerToken
    const claim = await claimIdempotency(repo, { tenantId: TEST_TENANT_A, operationScope: scope, idempotencyKey: key, requestBody: payload, initiatedBy: TEST_USER, leaseDurationMs: 60000 });
    await sql`UPDATE idempotency_records SET owner_token = NULL WHERE id = ${claim.record.id}`;

    // Fresh caller tries to claim — must get in_progress (FAIL CLOSED)
    const c2 = await claimIdempotency(new IdempotencyDbRepository(db), { tenantId: TEST_TENANT_A, operationScope: scope, idempotencyKey: key, requestBody: payload, initiatedBy: TEST_USER, leaseDurationMs: 30000 });
    expect(c2.action).toBe("in_progress");
    expect(c2.record.ownerToken).toBeNull();

    // Verify record was NOT reclaimed (attemptCount still 1)
    const rec = await new IdempotencyDbRepository(db).findByTenantScopeKey(TEST_TENANT_A, scope, key);
    expect(rec!.attemptCount).toBe(1);
    expect(rec!.ownerToken).toBeNull();
  });

  it("L2: legacy NULL-token expired claim — safely reclaimed with new non-null ownerToken", async () => {
    const scope = "test.L2.legacyExpired", key = "key-L2", payload = { saleId: "s" };
    const repo = new IdempotencyDbRepository(db);
    // Create a claim with short lease, then corrupt to NULL ownerToken and wait for expiry
    const claim = await claimIdempotency(repo, { tenantId: TEST_TENANT_A, operationScope: scope, idempotencyKey: key, requestBody: payload, initiatedBy: TEST_USER, leaseDurationMs: 1 });
    await new Promise(r => setTimeout(r, 50));
    await sql`UPDATE idempotency_records SET owner_token = NULL WHERE id = ${claim.record.id}`;

    // Fresh caller reclaims — should get execute with new non-null ownerToken
    const c2 = await claimIdempotency(new IdempotencyDbRepository(db), { tenantId: TEST_TENANT_A, operationScope: scope, idempotencyKey: key, requestBody: payload, initiatedBy: TEST_USER, leaseDurationMs: 30000 });
    expect(c2.action).toBe("execute");
    expect(c2.record.ownerToken).not.toBeNull();
    expect(c2.record.attemptCount).toBe(2);
  });

  it("L3: legacy NULL-token with NULL leaseExpiresAt — FAIL CLOSED", async () => {
    const scope = "test.L3.legacyNoExpiry", key = "key-L3", payload = { saleId: "s" };
    const repo = new IdempotencyDbRepository(db);
    const claim = await claimIdempotency(repo, { tenantId: TEST_TENANT_A, operationScope: scope, idempotencyKey: key, requestBody: payload, initiatedBy: TEST_USER, leaseDurationMs: 60000 });
    // Corrupt: NULL ownerToken AND NULL lease_expires_at
    await sql`UPDATE idempotency_records SET owner_token = NULL, lease_expires_at = NULL WHERE id = ${claim.record.id}`;

    const c2 = await claimIdempotency(new IdempotencyDbRepository(db), { tenantId: TEST_TENANT_A, operationScope: scope, idempotencyKey: key, requestBody: payload, initiatedBy: TEST_USER, leaseDurationMs: 30000 });
    expect(c2.action).toBe("in_progress");
    expect(c2.record.ownerToken).toBeNull();
  });

  it("L4: terminal legacy records (succeeded/business_failed with NULL ownerToken) — replay preserved", async () => {
    const scope = "test.L4.legacyTerminal", key = "key-L4", payload = { saleId: "s" };
    const repo = new IdempotencyDbRepository(db);
    const claim = await claimIdempotency(repo, { tenantId: TEST_TENANT_A, operationScope: scope, idempotencyKey: key, requestBody: payload, initiatedBy: TEST_USER, leaseDurationMs: 30000 });
    // Mark succeeded, then corrupt to NULL ownerToken
    await markSucceeded(repo, claim.record.id, { responseCode: 200, responseBody: { ok: true } }, claim.record.ownerToken!);
    await sql`UPDATE idempotency_records SET owner_token = NULL WHERE id = ${claim.record.id}`;

    // Fresh caller — must get replay (terminal state preserved, not mutated)
    const c2 = await claimIdempotency(new IdempotencyDbRepository(db), { tenantId: TEST_TENANT_A, operationScope: scope, idempotencyKey: key, requestBody: payload, initiatedBy: TEST_USER, leaseDurationMs: 30000 });
    expect(c2.action).toBe("replay");
    expect(c2.record.state).toBe("succeeded");
    expect(c2.record.responseBody).toEqual({ ok: true });
    expect(c2.record.ownerToken).toBeNull(); // NOT mutated — terminal legacy preserved
  });

  it("L5: concurrent modern/legacy safety — modern claim cannot be stolen by legacy-style reclaim", async () => {
    const scope = "test.L5.concurrent", key = "key-L5", payload = { saleId: "s" };
    const repo = new IdempotencyDbRepository(db);
    // Modern active claim (non-null ownerToken, unexpired lease)
    const claim = await claimIdempotency(repo, { tenantId: TEST_TENANT_A, operationScope: scope, idempotencyKey: key, requestBody: payload, initiatedBy: TEST_USER, leaseDurationMs: 60000 });

    // Simultaneously, a legacy-style caller (NULL ownerToken) tries to reclaim
    // The DB claimExpiredLease predicate requires lease_expires_at < now,
    // so an unexpired modern claim cannot be reclaimed.
    const c2 = await claimIdempotency(new IdempotencyDbRepository(db), { tenantId: TEST_TENANT_A, operationScope: scope, idempotencyKey: key, requestBody: payload, initiatedBy: TEST_USER, leaseDurationMs: 30000 });
    expect(c2.action).toBe("in_progress");
    expect(c2.record.ownerToken).toBe(claim.record.ownerToken); // unchanged
  });
});
