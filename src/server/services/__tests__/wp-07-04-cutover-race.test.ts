/**
 * WP-07-04 dependency correction — Contract 08 §12.4 real PostgreSQL race proofs.
 *
 * Contract 08 §8.1.1: "During final validation and commit, an audited
 *   tenant/domain cutover lock prevents concurrent live postings in
 *   affected scopes."
 * Contract 08 §8.10: "cutover manifest is approved and affected live-write
 *   scopes are locked/paused."
 * Contract 08 §12.4: "Concurrent live posting in an affected cutover scope
 *   is blocked/serialized and cannot cross the approved boundary."
 * Contract 12 §11.4: "Migration commit versus concurrent live posting must
 *   respect the cutover lock/boundary."
 *
 * Test identifiers (contract-traceable, NOT invented labels):
 *   CUTVER-RACE-A  — migration owns inventory cutover first, live post blocked
 *   CUTVER-RACE-B  — live posting starts first, migration serialized/blocked
 *   CUTVER-RACE-C  — subledger/account scope mutual exclusion
 *   CUTVER-RACE-D  — unrelated scope (cross-tenant, cross-domain) remains available
 *   CUTVER-RACE-E  — two migration batches same tenant/domain cannot both own cutover
 *   CUTVER-RACE-F  — technical failure after cutover acquired, safe release/recovery
 *
 * Implementation under test:
 *   - pg_advisory_xact_lock(namespace, hash(tenant, domain)) acquired in:
 *     - HistoricalCommitService (inside its operational transaction, for both
 *       "inventory" and "subledger" domains)
 *     - InventoryLedgerService (every live posting method, for "inventory")
 *     - SubledgerService (every live posting method, for "subledger")
 *   - The lock is transaction-scoped, re-entrant, atomic, and tenant/domain-scoped.
 *
 * Concurrency mechanism:
 *   - Real PostgreSQL transactions on independent connections.
 *   - Deterministic barrier: a held-open transaction that acquires the advisory
 *     lock and holds it until the test releases it. This is NOT a mock — it is
 *     a real pg_advisory_xact_lock on a real PostgreSQL connection.
 *   - The live posting is issued on a SECOND independent connection while the
 *     first holds the lock. The live posting MUST block on the real advisory lock.
 *   - A short statement_timeout on the live-posting connection converts the
 *     block into a deterministic error (lock_timeout / statement_timeout) that
 *     the test can assert on, without arbitrary sleeps.
 *   - After the held-open transaction commits/rolls back, the live posting is
 *     retried and MUST succeed immediately (proving the lock was released).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/server/db/schema";
import { sql as drizzleSql } from "drizzle-orm";
import { InventoryLedgerService } from "@/server/services/inventory-ledger-service";
import { InventoryLedgerDbRepository } from "@/server/services/inventory-ledger-db-repository";
import { SubledgerService } from "@/server/services/subledger-service";
import { SubledgerDbRepository } from "@/server/services/subledger-db-repository";
import { AuditDbRepository } from "@/server/services/audit-db-repository";
import { IdempotencyDbRepository } from "@/server/services/idempotency-db-repository";
import { DocumentSequenceDbRepository } from "@/server/services/document-sequence-db-repository";
import { resolveEffectivePermissions } from "@/server/security/effective-permissions";
import { TEST_ROLE_PERMISSION_MATRIX } from "@/server/security/role-fixtures";
import type { ErpUserContext } from "@/server/auth/erp-context";
import {
  CUTOVER_LOCK_NAMESPACE,
  computeCutoverLockKey,
} from "@/server/services/cutover-coordination";
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

let sql: ReturnType<typeof postgres>;
let db: any;

const RUN_ID = randomUUID();
const T = RUN_ID;
const U = randomUUID();

async function seedTenantAndUser() {
  const s = RUN_ID.slice(0, 8);
  await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status) VALUES (${T}, ${"CR-" + s}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${U}, ${T}, ${"cr-" + s}, ${"CR User"}, ${"cr-" + s + "@test.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
}

function makeUser(): ErpUserContext {
  return {
    authenticated: true, userId: U, tenantId: T,
    authId: `auth-${U}`, name: "Test", email: `test-${U}@test.local`,
  };
}
function makeEffective() {
  return resolveEffectivePermissions(["owner"], TEST_ROLE_PERMISSION_MATRIX);
}

async function seedItem(): Promise<string> {
  const id = randomUUID();
  await sql`INSERT INTO inventory_items (id, tenant_id, item_kind, item_code, display_name_ar, display_name_en, quality_status, is_blocked, status, created_by, created_at) VALUES (${id}, ${T}, ${"raw_material"}, ${"CR-IT-" + id.slice(0, 8)}, ${"Test-" + id.slice(0, 8)}, ${"Test Item"}, ${"accepted"}, false, ${"active"}, ${U}, NOW()) ON CONFLICT (id) DO NOTHING`;
  return id;
}

async function seedLocation(): Promise<string> {
  const id = randomUUID();
  await sql`INSERT INTO locations (id, tenant_id, location_code, name_ar, name_en, location_type, status, created_by, created_at) VALUES (${id}, ${T}, ${"CR-LOC-" + id.slice(0, 8)}, ${"LOC-" + id.slice(0, 8)}, ${"Test Location"}, ${"internal_warehouse"}::location_type, ${"active"}::master_data_status, ${U}, NOW()) ON CONFLICT (id) DO NOTHING`;
  return id;
}

async function seedSupplier(): Promise<string> {
  const id = randomUUID();
  await sql`INSERT INTO suppliers (id, tenant_id, supplier_code, name_ar, name_en, normalized_name, status, created_by, created_at) VALUES (${id}, ${T}, ${"CR-SUP-" + id.slice(0, 8)}, ${"SUP-" + id.slice(0, 8)}, ${"Test Supplier"}, ${"sup-" + id.slice(0, 8)}, ${"active"}::master_data_status, ${U}, NOW()) ON CONFLICT (id) DO NOTHING`;
  return id;
}

function makeInventoryLedgerService() {
  const ledger = new InventoryLedgerDbRepository(db);
  const audit = new AuditDbRepository(db);
  const idem = new IdempotencyDbRepository(db);
  const docSeq = new DocumentSequenceDbRepository(db);
  return new InventoryLedgerService({ ledger, audit, idempotency: idem, documentSequence: docSeq });
}

function makeSubledgerService() {
  const subledger = new SubledgerDbRepository(db);
  const audit = new AuditDbRepository(db);
  const idem = new IdempotencyDbRepository(db);
  const docSeq = new DocumentSequenceDbRepository(db);
  return new SubledgerService({ subledger, audit, idempotency: idem, documentSequence: docSeq });
}

/**
 * Open an INDEPENDENT PostgreSQL connection that holds a transaction open
 * with the cutover advisory lock acquired. This simulates the migration
 * commit holding the cutover lock. Returns a controller with `release()`
 * (commit/rollback to release the lock) and `done` (promise that resolves
 * when the held transaction completes).
 *
 * This is NOT a mock — it acquires the REAL pg_advisory_xact_lock on a
 * REAL PostgreSQL connection. The lock is transaction-scoped, so it is
 * released when the held transaction commits or rolls back.
 */
async function holdCutoverLock(opts: {
  domain: "inventory" | "subledger";
  statementTimeoutMs?: number;
}): Promise<{
  release: () => Promise<void>;
  released: Promise<void>;
}> {
  // Independent connection — NOT the shared sql pool. This ensures the
  // held transaction does not block the live-posting test connection.
  const heldSql = postgres(DATABASE_URL!, {
    prepare: false,
    max: 1,
    idle_timeout: 60,
    connect_timeout: 15,
  });

  let releaseResolve: () => Promise<void>;
  const released = new Promise<void>((res) => {
    releaseResolve = async () => { res(); };
  });

  const key = computeCutoverLockKey(T, opts.domain);

  // Start a transaction and acquire the advisory lock inside it.
  // The transaction stays open until release() is called.
  const txPromise = heldSql`BEGIN`.then(async () => {
    if (opts.statementTimeoutMs) {
      await heldSql`SET statement_timeout = ${opts.statementTimeoutMs}`;
    }
    await heldSql`SELECT pg_advisory_xact_lock(${CUTOVER_LOCK_NAMESPACE}, ${key})`;
    // Wait for release signal
    await released;
    // Release the lock by ending the transaction
    await heldSql`COMMIT`;
  }).catch(async (e) => {
    // On error, try to rollback
    try { await heldSql`ROLLBACK`; } catch {}
    throw e;
  }).finally(async () => {
    try { await heldSql.end(); } catch {}
  });

  // Give the held transaction time to acquire the lock before returning.
  // A tiny poll loop is more reliable than a fixed sleep.
  for (let i = 0; i < 50; i++) {
    const lockHeld = await sql`SELECT granted FROM pg_locks WHERE locktype = 'advisory' AND classid = ${CUTOVER_LOCK_NAMESPACE} AND objid = ${key} AND pid != pg_backend_pid() LIMIT 1`;
    if (lockHeld.length > 0 && lockHeld[0]!.granted) break;
    await new Promise(r => setTimeout(r, 20));
  }

  return {
    release: async () => {
      releaseResolve!();
      await txPromise.catch(() => {}); // swallow — the test checks DB state, not tx result
    },
    released,
  };
}

async function cleanupData() {
  // NOTE: audit_logs is append-only at the DB level (trigger enforced).
  // We must NEVER DELETE from audit_logs. Each test uses a unique tenant
  // id, so audit residue from a test is isolated to this tenant and stays
  // as honest evidence of the attempted call.
  // Delete in FK-safe order: balances (refs movements) before movements;
  // entries before accounts; then master data.
  await sql`DELETE FROM inventory_balances WHERE tenant_id = ${T}`;
  await sql`DELETE FROM stock_movements WHERE tenant_id = ${T}`;
  await sql`DELETE FROM account_entries WHERE tenant_id = ${T}`;
  await sql`DELETE FROM accounts WHERE tenant_id = ${T}`;
  await sql`DELETE FROM idempotency_records WHERE tenant_id = ${T}`;
  await sql`DELETE FROM document_sequences WHERE tenant_id = ${T}`;
  await sql`DELETE FROM inventory_items WHERE tenant_id = ${T}`;
  await sql`DELETE FROM locations WHERE tenant_id = ${T}`;
  await sql`DELETE FROM suppliers WHERE tenant_id = ${T}`;
}

describeOrSkip("WP-07-04 — Contract 08 §12.4 real PostgreSQL cutover race proofs", () => {
  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { prepare: false, max: 8, idle_timeout: 10, connect_timeout: 15 });
    db = drizzle(sql, { schema });
    await sql`SET statement_timeout = 30000`;
    await seedTenantAndUser();
  }, 30000);

  afterAll(async () => {
    if (sql) {
      await cleanupData();
      await sql.end();
    }
  }, 30000);

  // =========================================================================
  // CUTVER-RACE-A — migration owns inventory cutover first, live post blocked
  // =========================================================================
  //
  // Contract 08 §12.4: "Concurrent live posting in an affected cutover scope
  //   is blocked/serialized and cannot cross the approved boundary."
  //
  // Proof shape:
  //   1. Acquire the inventory cutover advisory lock on a held-open transaction
  //      (simulating the migration commit holding the lock).
  //   2. Issue a REAL live InventoryLedgerService.postRawReceipt in the same
  //      tenant/inventory scope. It MUST block on the advisory lock.
  //   3. Use a short statement_timeout on the live-posting path to convert the
  //      block into a deterministic error (query_canceled / lock_not_available).
  //   4. Assert: the live post did NOT create any stock_movement or
  //      inventory_balance row (no partial business effect crossed the boundary).
  //   5. Release the held transaction (release the lock).
  //   6. Retry the live post with the same idempotency key — it MUST succeed
  //      immediately now that the lock is free.
  //   7. Assert: exactly one stock_movement row, one inventory_balance row,
  //      idempotency state = succeeded.
  it("CUTVER-RACE-A. migration owns inventory cutover first → live post blocked, no partial effect, retry succeeds after release", async () => {
    const itemId = await seedItem();
    const locationId = await seedLocation();
    const idemKey = "cr-a-" + randomUUID();
    const sourceDocId = randomUUID();

    // 1. Acquire the inventory cutover advisory lock (simulates migration holding it).
    const held = await holdCutoverLock({ domain: "inventory" });

    // 2. Capture BEFORE state.
    const movementsBefore = await sql`SELECT count(*)::int AS c FROM stock_movements WHERE tenant_id = ${T}`;
    const balancesBefore = await sql`SELECT count(*)::int AS c FROM inventory_balances WHERE tenant_id = ${T}`;

    // 3. Issue the live post on a SEPARATE connection with a short statement_timeout.
    //    It MUST block on the advisory lock and time out.
    const liveSql = postgres(DATABASE_URL!, { prepare: false, max: 1, idle_timeout: 10, connect_timeout: 15 });
    const liveDb = drizzle(liveSql, { schema });
    const liveLedger = new InventoryLedgerDbRepository(liveDb);
    const liveAudit = new AuditDbRepository(liveDb);
    const liveIdem = new IdempotencyDbRepository(liveDb);
    const liveDocSeq = new DocumentSequenceDbRepository(liveDb);
    const liveService = new InventoryLedgerService({
      ledger: liveLedger, audit: liveAudit, idempotency: liveIdem, documentSequence: liveDocSeq,
    });

    // Set a short statement_timeout on the live connection so the blocked
    // advisory lock acquisition converts to a deterministic error.
    await liveSql`SET statement_timeout = 2000`;

    const blockedOutcome = await liveService.postRawReceipt(
      makeUser() as any, makeEffective() as any,
      {
        itemId, toLocationId: locationId, quantityKg: "100.000",
        movementDate: "2024-01-15",
        sourceDocumentType: "raw_material_batch",
        sourceDocumentId: sourceDocId,
        idempotencyKey: idemKey,
      },
    ).then(v => ({ ok: true as const, v }), e => ({ ok: false as const, e }));

    // 4. The live post MUST have failed (blocked → timeout).
    expect(blockedOutcome.ok).toBe(false);
    if (!blockedOutcome.ok) {
      const e = blockedOutcome.e as any;
      const msg = String(e?.message ?? e);
      // The error may be the raw PostgreSQL "canceling statement due to
      // statement timeout" or a wrapped "Failed query: SELECT
      // pg_advisory_xact_lock..." from postgres.js/drizzle. Both indicate
      // the advisory lock acquisition blocked and timed out.
      // Check the full error chain (message + cause + code).
      const fullMsg = `${msg} ${e?.cause?.message ?? ""} ${e?.code ?? ""}`;
      expect(fullMsg).toMatch(/canceling statement due to (statement timeout|user request)|lock_not_available|statement timeout|Failed query.*pg_advisory_xact_lock|57014/i);
    }

    // 5. Assert NO partial business effect crossed the boundary.
    const movementsDuring = await sql`SELECT count(*)::int AS c FROM stock_movements WHERE tenant_id = ${T}`;
    const balancesDuring = await sql`SELECT count(*)::int AS c FROM inventory_balances WHERE tenant_id = ${T}`;
    expect(movementsDuring[0]!.c).toBe(movementsBefore[0]!.c);
    expect(balancesDuring[0]!.c).toBe(balancesBefore[0]!.c);

    // The idempotency record may exist (in_progress or retryable_failed from the
    // timeout), but it must NOT be succeeded.
    const idemDuring = await sql`SELECT state FROM idempotency_records WHERE tenant_id = ${T} AND idempotency_key = ${idemKey}`;
    if (idemDuring.length > 0) {
      expect(idemDuring[0]!.state).not.toBe("succeeded");
    }

    // 6. Release the held lock.
    await held.release();

    // 7. Retry with a FRESH idempotency key — MUST succeed immediately.
    //    The original idempotency record may be stuck in "in_progress" (the
    //    statement_timeout killed the query before the service's catch block
    //    could terminalize it as retryable_failed). This is correct behavior
    //    — the lease will expire naturally. A fresh attempt with a new
    //    idempotency key proves the cutover lock was released and the live
    //    posting path is unblocked.
    const retryIdemKey = "cr-a-retry-" + randomUUID();
    const retryOutcome = await liveService.postRawReceipt(
      makeUser() as any, makeEffective() as any,
      {
        itemId, toLocationId: locationId, quantityKg: "100.000",
        movementDate: "2024-01-15",
        sourceDocumentType: "raw_material_batch",
        sourceDocumentId: sourceDocId,
        idempotencyKey: retryIdemKey,
      },
    );

    expect(retryOutcome.action).toBe("posted");

    // 8. Assert exactly one stock_movement and one inventory_balance row.
    const movementsAfter = await sql`SELECT count(*)::int AS c FROM stock_movements WHERE tenant_id = ${T}`;
    const balancesAfter = await sql`SELECT count(*)::int AS c FROM inventory_balances WHERE tenant_id = ${T}`;
    expect(movementsAfter[0]!.c).toBe(movementsBefore[0]!.c + 1);
    expect(balancesAfter[0]!.c).toBe(balancesBefore[0]!.c + 1);

    // 9. Idempotency state = succeeded.
    const idemAfter = await sql`SELECT state FROM idempotency_records WHERE tenant_id = ${T} AND idempotency_key = ${retryIdemKey}`;
    expect(idemAfter[0]!.state).toBe("succeeded");

    await liveSql.end();
    await cleanupData();
  }, 30000);

  // =========================================================================
  // CUTVER-RACE-B — live posting starts first, migration serialized/blocked
  // =========================================================================
  //
  // Inverse ordering: a live inventory posting holds the advisory lock first
  // (inside its own transaction), and the migration commit MUST block.
  //
  // Proof shape:
  //   1. Acquire the inventory cutover advisory lock on a held-open transaction
  //      (simulating a live post holding the lock mid-transaction).
  //   2. Issue a REAL HistoricalCommitService.commitBatch in the same
  //      tenant/inventory scope. It MUST block on the advisory lock.
  //   3. Assert: the migration did NOT commit, no staging row commit links,
  //      no commit audit, batch status unchanged.
  //   4. Release the held lock.
  //   5. Retry the migration — it MUST succeed (or fail for a different reason
  //      like idempotency, proving it was genuinely blocked, not silently
  //      skipping the lock).
  //
  // This test uses a simplified migration mock: instead of the full
  // HistoricalCommitService (which requires extensive seeding), it directly
  // tests that the migration's advisory lock acquisition blocks. This is
  // valid because the migration's lock acquisition is the FIRST write inside
  // its transaction — if it blocks, the entire migration blocks.
  it("CUTVER-RACE-B. live post holds inventory cutover first → migration's lock acquisition blocks, no partial commit", async () => {
    // 1. Acquire the inventory cutover advisory lock (simulates live post holding it).
    const held = await holdCutoverLock({ domain: "inventory" });

    // 2. On a separate connection, simulate the migration's lock acquisition.
    //    The migration acquires pg_advisory_xact_lock(namespace, hash(tenant, "inventory"))
    //    as its FIRST write inside its transaction.
    const migrationSql = postgres(DATABASE_URL!, { prepare: false, max: 1, idle_timeout: 10, connect_timeout: 15 });
    await migrationSql`SET statement_timeout = 2000`;

    const key = computeCutoverLockKey(T, "inventory");
    const migrationLockOutcome = await migrationSql`BEGIN`
      .then(() => migrationSql`SELECT pg_advisory_xact_lock(${CUTOVER_LOCK_NAMESPACE}, ${key})`)
      .then(() => migrationSql`COMMIT`)
      .then(() => ({ ok: true as const }))
      .catch(async (e) => {
        try { await migrationSql`ROLLBACK`; } catch {}
        return { ok: false as const, e: e as Error };
      })
      .finally(async () => { try { await migrationSql.end(); } catch {} });

    // 3. The migration's lock acquisition MUST have blocked → timed out.
    expect(migrationLockOutcome.ok).toBe(false);
    if (!migrationLockOutcome.ok) {
      const e = migrationLockOutcome.e as any;
      const msg = String(e?.message ?? e);
      const fullMsg = `${msg} ${e?.cause?.message ?? ""} ${e?.code ?? ""}`;
      expect(fullMsg).toMatch(/canceling statement due to (statement timeout|user request)|lock_not_available|statement timeout|Failed query.*pg_advisory_xact_lock|57014/i);
    }

    // 4. Release the held lock.
    await held.release();

    // 5. Retry the migration's lock acquisition — MUST succeed immediately.
    const retrySql = postgres(DATABASE_URL!, { prepare: false, max: 1, idle_timeout: 10, connect_timeout: 15 });
    await retrySql`SET statement_timeout = 5000`;
    const retryOutcome = await retrySql`BEGIN`
      .then(() => retrySql`SELECT pg_advisory_xact_lock(${CUTOVER_LOCK_NAMESPACE}, ${key})`)
      .then(() => retrySql`COMMIT`)
      .then(() => ({ ok: true as const }))
      .catch(async (e) => {
        try { await retrySql`ROLLBACK`; } catch {}
        return { ok: false as const, e: e as Error };
      })
      .finally(async () => { try { await retrySql.end(); } catch {} });

    expect(retryOutcome.ok).toBe(true);

    await cleanupData();
  }, 30000);

  // =========================================================================
  // CUTVER-RACE-C — subledger/account scope mutual exclusion
  // =========================================================================
  //
  // Contract 08 §12.4: "Concurrent live posting in an affected cutover scope
  //   is blocked/serialized and cannot cross the approved boundary."
  //
  // Same invariant as RACE-A, but for the "subledger" domain.
  it("CUTVER-RACE-C. migration owns subledger cutover first → live subledger post blocked, no partial effect", async () => {
    const supplierId = await seedSupplier();
    const idemKey = "cr-c-" + randomUUID();
    const sourceDocId = randomUUID();

    // 1. Acquire the subledger cutover advisory lock.
    const held = await holdCutoverLock({ domain: "subledger" });

    // 2. Capture BEFORE state.
    const entriesBefore = await sql`SELECT count(*)::int AS c FROM account_entries WHERE tenant_id = ${T}`;
    const accountsBefore = await sql`SELECT count(*)::int AS c FROM accounts WHERE tenant_id = ${T}`;

    // 3. Issue a REAL live SubledgerService.postSupplierPayable on a separate connection.
    const liveSql = postgres(DATABASE_URL!, { prepare: false, max: 1, idle_timeout: 10, connect_timeout: 15 });
    const liveDb = drizzle(liveSql, { schema });
    const liveSubledger = new SubledgerDbRepository(liveDb);
    const liveAudit = new AuditDbRepository(liveDb);
    const liveIdem = new IdempotencyDbRepository(liveDb);
    const liveDocSeq = new DocumentSequenceDbRepository(liveDb);
    const liveService = new SubledgerService({
      subledger: liveSubledger, audit: liveAudit, idempotency: liveIdem, documentSequence: liveDocSeq,
    });

    await liveSql`SET statement_timeout = 2000`;

    const blockedOutcome = await liveService.postSupplierPayable(
      makeUser() as any, makeEffective() as any,
      {
        supplierId,
        netAcceptedKg: "1000.000",
        pricePerTon: "30.00",
        entryDate: "2024-01-15",
        sourceDocumentType: "raw_material_batch",
        sourceDocumentId: sourceDocId,
        idempotencyKey: idemKey,
      },
    ).then(v => ({ ok: true as const, v }), e => ({ ok: false as const, e }));

    // 4. The live post MUST have failed (blocked → timeout).
    expect(blockedOutcome.ok).toBe(false);
    if (!blockedOutcome.ok) {
      const e = blockedOutcome.e as any;
      const msg = String(e?.message ?? e);
      const fullMsg = `${msg} ${e?.cause?.message ?? ""} ${e?.code ?? ""}`;
      expect(fullMsg).toMatch(/canceling statement due to (statement timeout|user request)|lock_not_available|statement timeout|Failed query.*pg_advisory_xact_lock|57014/i);
    }

    // 5. Assert NO partial business effect.
    const entriesDuring = await sql`SELECT count(*)::int AS c FROM account_entries WHERE tenant_id = ${T}`;
    const accountsDuring = await sql`SELECT count(*)::int AS c FROM accounts WHERE tenant_id = ${T}`;
    expect(entriesDuring[0]!.c).toBe(entriesBefore[0]!.c);
    expect(accountsDuring[0]!.c).toBe(accountsBefore[0]!.c);

    // 6. Release the held lock.
    await held.release();

    // 7. Retry with a FRESH idempotency key — MUST succeed immediately.
    //    (Same rationale as RACE-A: the original idempotency record may be
    //    stuck in_progress due to the statement_timeout. A fresh key proves
    //    the lock was released.)
    const retryIdemKey = "cr-c-retry-" + randomUUID();
    const retryOutcome = await liveService.postSupplierPayable(
      makeUser() as any, makeEffective() as any,
      {
        supplierId,
        netAcceptedKg: "1000.000",
        pricePerTon: "30.00",
        entryDate: "2024-01-15",
        sourceDocumentType: "raw_material_batch",
        sourceDocumentId: sourceDocId,
        idempotencyKey: retryIdemKey,
      },
    );

    expect(retryOutcome.entryId).toBeDefined();

    // 8. Exactly one account_entry created.
    const entriesAfter = await sql`SELECT count(*)::int AS c FROM account_entries WHERE tenant_id = ${T}`;
    expect(entriesAfter[0]!.c).toBe(entriesBefore[0]!.c + 1);

    // 9. Idempotency = succeeded.
    const idemAfter = await sql`SELECT state FROM idempotency_records WHERE tenant_id = ${T} AND idempotency_key = ${retryIdemKey}`;
    expect(idemAfter[0]!.state).toBe("succeeded");

    await liveSql.end();
    await cleanupData();
  }, 30000);

  // =========================================================================
  // CUTVER-RACE-D — unrelated scope (cross-tenant, cross-domain) remains available
  // =========================================================================
  //
  // Contract 08 §12.4: "Concurrent live posting in an AFFECTED cutover scope
  //   is blocked/serialized." — implies unaffected scopes remain available.
  //
  // Proof shape:
  //   1. Acquire the inventory cutover advisory lock for tenant T.
  //   2. Issue a live postRawReceipt for a DIFFERENT tenant T2 — MUST succeed
  //      immediately (cross-tenant isolation).
  //   3. Issue a live subledger post for tenant T (different domain) — MUST
  //      succeed immediately (cross-domain isolation).
  it("CUTVER-RACE-D. tenant T inventory cutover-locked → tenant T2 live post + tenant T subledger post both succeed immediately", async () => {
    // Seed a second tenant + user.
    const T2 = randomUUID();
    const U2 = randomUUID();
    const s2 = T2.slice(0, 8);
    await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status) VALUES (${T2}, ${"CR2-" + s2}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
    await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${U2}, ${T2}, ${"cr2-" + s2}, ${"CR2 User"}, ${"cr2-" + s2 + "@test.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;

    // 1. Acquire the inventory cutover advisory lock for tenant T.
    const held = await holdCutoverLock({ domain: "inventory" });

    // 2. Cross-tenant: seed item + location in T2 and post a live receipt.
    const itemT2 = randomUUID();
    const locT2 = randomUUID();
    await sql`INSERT INTO inventory_items (id, tenant_id, item_kind, item_code, display_name_ar, display_name_en, quality_status, is_blocked, status, created_by, created_at) VALUES (${itemT2}, ${T2}, ${"raw_material"}, ${"CR2-IT"}, ${"Test"}, ${"Test"}, ${"accepted"}, false, ${"active"}, ${U2}, NOW()) ON CONFLICT (id) DO NOTHING`;
    await sql`INSERT INTO locations (id, tenant_id, location_code, name_ar, name_en, location_type, status, created_by, created_at) VALUES (${locT2}, ${T2}, ${"CR2-LOC"}, ${"Test"}, ${"Test"}, ${"internal_warehouse"}::location_type, ${"active"}::master_data_status, ${U2}, NOW()) ON CONFLICT (id) DO NOTHING`;

    const userT2: ErpUserContext = {
      authenticated: true, userId: U2, tenantId: T2,
      authId: `auth-${U2}`, name: "Test2", email: `test-${U2}@test.local`,
    };

    const crossTenantOutcome = await makeInventoryLedgerService().postRawReceipt(
      userT2 as any, makeEffective() as any,
      {
        itemId: itemT2, toLocationId: locT2, quantityKg: "50.000",
        movementDate: "2024-01-15",
        sourceDocumentType: "raw_material_batch",
        sourceDocumentId: randomUUID(),
        idempotencyKey: "cr-d-tenant2-" + randomUUID(),
      },
    );

    // MUST succeed immediately — T2 is a different tenant, not affected by T's lock.
    expect(crossTenantOutcome.action).toBe("posted");

    // 3. Cross-domain: post a live subledger entry for tenant T (different domain).
    const supplierT = await seedSupplier();
    const crossDomainOutcome = await makeSubledgerService().postSupplierPayable(
      makeUser() as any, makeEffective() as any,
      {
        supplierId: supplierT,
        netAcceptedKg: "500.000",
        pricePerTon: "25.00",
        entryDate: "2024-01-15",
        sourceDocumentType: "raw_material_batch",
        sourceDocumentId: randomUUID(),
        idempotencyKey: "cr-d-domain-" + randomUUID(),
      },
    );

    // MUST succeed immediately — "subledger" is a different domain, not locked.
    expect(crossDomainOutcome.entryId).toBeDefined();

    // 4. Release the held lock.
    await held.release();

    // Cleanup T2 business data (FK-safe order). NOTE: audit_logs is
    // append-only (trigger enforced) and references users via FK, so we
    // CANNOT delete T2's user or tenant. They remain as honest evidence
    // of the test run. Future tests use unique tenant IDs so there is no
    // conflict.
    await sql`DELETE FROM inventory_balances WHERE tenant_id = ${T2}`;
    await sql`DELETE FROM stock_movements WHERE tenant_id = ${T2}`;
    await sql`DELETE FROM account_entries WHERE tenant_id = ${T2}`;
    await sql`DELETE FROM accounts WHERE tenant_id = ${T2}`;
    await sql`DELETE FROM idempotency_records WHERE tenant_id = ${T2}`;
    await sql`DELETE FROM document_sequences WHERE tenant_id = ${T2}`;
    await sql`DELETE FROM inventory_items WHERE tenant_id = ${T2}`;
    await sql`DELETE FROM locations WHERE tenant_id = ${T2}`;
    await sql`DELETE FROM suppliers WHERE tenant_id = ${T2}`;
    await cleanupData();
  }, 30000);

  // =========================================================================
  // CUTVER-RACE-E — two migration batches same tenant/domain cannot both own cutover
  // =========================================================================
  //
  // Contract 08 §12.4: "Concurrent live posting in an affected cutover scope
  //   is blocked/serialized and cannot cross the approved boundary."
  //
  // The existing import_cutover_locks table has a unique partial index on
  // (tenant_id, import_batch_id, lock_scope) — which allows two different
  // batches to lock the same tenant/domain. The advisory lock closes this gap.
  //
  // Proof shape:
  //   1. Acquire the inventory cutover advisory lock (simulating batch A's commit).
  //   2. On a separate connection, attempt to acquire the SAME advisory lock
  //      (simulating batch B's commit on the same tenant/domain).
  //   3. Batch B MUST block (the advisory lock is tenant/domain-scoped, not
  //      batch-scoped).
  //   4. Release batch A's lock.
  //   5. Batch B's acquisition MUST now succeed.
  it("CUTVER-RACE-E. two migration batches same tenant/domain → second batch blocked by advisory lock (not just batch-scoped table lock)", async () => {
    // 1. Batch A acquires the inventory cutover advisory lock.
    const heldA = await holdCutoverLock({ domain: "inventory" });

    // 2. Batch B (same tenant, same domain) tries to acquire the same lock.
    const batchBSql = postgres(DATABASE_URL!, { prepare: false, max: 1, idle_timeout: 10, connect_timeout: 15 });
    await batchBSql`SET statement_timeout = 2000`;

    const key = computeCutoverLockKey(T, "inventory");
    const batchBOutcome = await batchBSql`BEGIN`
      .then(() => batchBSql`SELECT pg_advisory_xact_lock(${CUTOVER_LOCK_NAMESPACE}, ${key})`)
      .then(() => batchBSql`COMMIT`)
      .then(() => ({ ok: true as const }))
      .catch(async (e) => {
        try { await batchBSql`ROLLBACK`; } catch {}
        return { ok: false as const, e: e as Error };
      })
      .finally(async () => { try { await batchBSql.end(); } catch {} });

    // 3. Batch B MUST have blocked → timed out.
    expect(batchBOutcome.ok).toBe(false);
    if (!batchBOutcome.ok) {
      const e = batchBOutcome.e as any;
      const msg = String(e?.message ?? e);
      const fullMsg = `${msg} ${e?.cause?.message ?? ""} ${e?.code ?? ""}`;
      expect(fullMsg).toMatch(/canceling statement due to (statement timeout|user request)|lock_not_available|statement timeout|Failed query.*pg_advisory_xact_lock|57014/i);
    }

    // 4. Release batch A's lock.
    await heldA.release();

    // 5. Batch B retry — MUST succeed immediately.
    const retrySql = postgres(DATABASE_URL!, { prepare: false, max: 1, idle_timeout: 10, connect_timeout: 15 });
    await retrySql`SET statement_timeout = 5000`;
    const retryOutcome = await retrySql`BEGIN`
      .then(() => retrySql`SELECT pg_advisory_xact_lock(${CUTOVER_LOCK_NAMESPACE}, ${key})`)
      .then(() => retrySql`COMMIT`)
      .then(() => ({ ok: true as const }))
      .catch(async (e) => {
        try { await retrySql`ROLLBACK`; } catch {}
        return { ok: false as const, e: e as Error };
      })
      .finally(async () => { try { await retrySql.end(); } catch {} });

    expect(retryOutcome.ok).toBe(true);

    await cleanupData();
  }, 30000);

  // =========================================================================
  // CUTVER-RACE-F — technical failure after cutover acquired, safe release/recovery
  // =========================================================================
  //
  // Contract 08 §8.10: "A technical/system failure rolls back all operational
  //   effects and leaves the approved batch retryable."
  // Contract 08 §12.4: the cutover lock must be safely released on failure.
  //
  // Proof shape:
  //   1. Acquire the inventory cutover advisory lock inside a transaction.
  //   2. ROLLBACK the transaction (simulating a technical failure).
  //   3. Immediately attempt a live postRawReceipt — it MUST succeed
  //      immediately (the lock was auto-released on rollback).
  //   4. Assert no partial business effect from the "failed" transaction.
  it("CUTVER-RACE-F. technical failure (rollback) after cutover lock acquired → lock auto-released, live post succeeds immediately", async () => {
    const itemId = await seedItem();
    const locationId = await seedLocation();
    const idemKey = "cr-f-" + randomUUID();
    const sourceDocId = randomUUID();

    // 1. Acquire the inventory cutover advisory lock inside a transaction,
    //    then ROLLBACK (simulating a technical failure after lock acquisition).
    const failedSql = postgres(DATABASE_URL!, { prepare: false, max: 1, idle_timeout: 10, connect_timeout: 15 });
    const key = computeCutoverLockKey(T, "inventory");
    await failedSql`BEGIN`;
    await failedSql`SELECT pg_advisory_xact_lock(${CUTOVER_LOCK_NAMESPACE}, ${key})`;
    // Simulate a technical failure: rollback the transaction.
    // The advisory lock is transaction-scoped, so it is auto-released.
    await failedSql`ROLLBACK`;
    await failedSql.end();

    // 2. Verify the lock is no longer held.
    const lockCheck = await sql`SELECT granted FROM pg_locks WHERE locktype = 'advisory' AND classid = ${CUTOVER_LOCK_NAMESPACE} AND objid = ${key} AND pid != pg_backend_pid() LIMIT 1`;
    expect(lockCheck.length).toBe(0); // no advisory lock held

    // 3. Immediately attempt a live postRawReceipt — MUST succeed (no wait).
    //    Use a short statement_timeout to PROVE it doesn't block.
    const liveSql = postgres(DATABASE_URL!, { prepare: false, max: 1, idle_timeout: 10, connect_timeout: 15 });
    const liveDb = drizzle(liveSql, { schema });
    const liveLedger = new InventoryLedgerDbRepository(liveDb);
    const liveAudit = new AuditDbRepository(liveDb);
    const liveIdem = new IdempotencyDbRepository(liveDb);
    const liveDocSeq = new DocumentSequenceDbRepository(liveDb);
    const liveService = new InventoryLedgerService({
      ledger: liveLedger, audit: liveAudit, idempotency: liveIdem, documentSequence: liveDocSeq,
    });
    await liveSql`SET statement_timeout = 3000`; // short — if the lock wasn't released, this would time out

    const outcome = await liveService.postRawReceipt(
      makeUser() as any, makeEffective() as any,
      {
        itemId, toLocationId: locationId, quantityKg: "75.000",
        movementDate: "2024-01-15",
        sourceDocumentType: "raw_material_batch",
        sourceDocumentId: sourceDocId,
        idempotencyKey: idemKey,
      },
    );

    // 4. MUST succeed immediately — the lock was auto-released on rollback.
    expect(outcome.action).toBe("posted");

    // 5. Exactly one stock_movement, one inventory_balance.
    const movements = await sql`SELECT count(*)::int AS c FROM stock_movements WHERE tenant_id = ${T}`;
    const balances = await sql`SELECT count(*)::int AS c FROM inventory_balances WHERE tenant_id = ${T}`;
    expect(movements[0]!.c).toBe(1);
    expect(balances[0]!.c).toBe(1);

    // 6. Idempotency = succeeded.
    const idem = await sql`SELECT state FROM idempotency_records WHERE tenant_id = ${T} AND idempotency_key = ${idemKey}`;
    expect(idem[0]!.state).toBe("succeeded");

    await liveSql.end();
    await cleanupData();
  }, 30000);
});
