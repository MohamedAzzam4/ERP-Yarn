/**
 * WP-07-04 r28 — LIVE-LIVE-SHARED-INVENTORY-SVC-DET
 *
 * r27 closed the Payment/Reversal/Settlement concurrency tranche. The only
 * remaining WP-07-04/cutover proof is: two ACTUAL Inventory live commands
 * both pass the production SHARED cutover path simultaneously.
 *
 * Existing committed SVC-RACE tests prove migration EXCLUSIVE vs live SHARED
 * mutual exclusion. r25 raw lock tests prove PostgreSQL SHARED primitive
 * semantics. Neither proves two ACTUAL InventoryLedgerService live commands
 * both acquire SHARED concurrently.
 *
 * This test implements that proof.
 *
 * Barrier pattern (same as r27 LIVE-LIVE-SHARED-SUBLEDGER-SVC-DET):
 *   A: real InventoryLedgerService.postRawReceipt starts → real
 *      requireCutoverLock acquires SHARED → signal A_INVENTORY_SHARED_ACQUIRED
 *      → hold transaction at release barrier.
 *   B: independent connection/transaction → real
 *      InventoryLedgerService.postRawReceipt starts → real
 *      requireCutoverLock acquires SHARED → signal B_INVENTORY_SHARED_ACQUIRED
 *      WHILE A still holds SHARED.
 *
 * CRITICAL ASSERTION: B_INVENTORY_SHARED_ACQUIRED === true while A has NOT
 * been released. This proves SHARED/SHARED coexistence at the service level.
 *
 * Non-conflicting fixtures: different items, different locations, different
 * source documents — isolates cutover coordination, not business-row contention.
 *
 * Document-number allocation note: postRawReceipt allocates a "raw_receipt"
 * document number. If both A and B use the same tenant+year+documentType,
 * they serialize on the document_sequences row lock (by design — document
 * numbers must be sequential). To isolate the SHARED cutover lock proof,
 * we wrap requireCutoverLock on the service to signal AFTER the real SHARED
 * advisory lock acquires but BEFORE the document-number allocation runs.
 * The barrier holds A's transaction open after the SHARED lock but before
 * the document-sequence row lock, so B can independently acquire SHARED
 * without document-sequence serialization.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/server/db/schema";
import { InventoryLedgerService } from "@/server/services/inventory-ledger-service";
import { InventoryLedgerDbRepository } from "@/server/services/inventory-ledger-db-repository";
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
const OWNER_ID = randomUUID();
const ACCOUNTANT_ID = randomUUID();

function makeUser(t: string = T, uid: string = ACCOUNTANT_ID): ErpUserContext {
  return { authenticated: true, userId: uid, tenantId: t,
    authId: `auth-${uid}`, name: "Test", email: `test-${uid}@test.local` };
}
function makeEff() {
  return resolveEffectivePermissions(["owner"], TEST_ROLE_PERMISSION_MATRIX);
}

async function seedTenantAndUsers() {
  const s = RUN_ID.slice(0, 8);
  await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status) VALUES (${T}, ${"R28-" + s}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${OWNER_ID}, ${T}, ${"r28-o-" + s}, ${"R28 Owner"}, ${"r28-o-" + s + "@test.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${ACCOUNTANT_ID}, ${T}, ${"r28-a-" + s}, ${"R28 Accountant"}, ${"r28-a-" + s + "@test.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
}

async function cleanupData() {
  await sql`ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_delete`;
  await sql`ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_update`;
  await sql`DELETE FROM inventory_balances WHERE tenant_id = ${T}`;
  await sql`DELETE FROM stock_movements WHERE tenant_id = ${T}`;
  await sql`DELETE FROM audit_logs WHERE tenant_id = ${T}`;
  await sql`DELETE FROM idempotency_records WHERE tenant_id = ${T}`;
  await sql`DELETE FROM document_sequences WHERE tenant_id = ${T}`;
  await sql`DELETE FROM inventory_items WHERE tenant_id = ${T}`;
  await sql`DELETE FROM locations WHERE tenant_id = ${T}`;
  await sql`DELETE FROM users WHERE tenant_id = ${T}`;
  await sql`DELETE FROM tenants WHERE id = ${T}`;
  await sql`ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_delete`;
  await sql`ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_update`;
}

async function seedItem(): Promise<string> {
  const id = randomUUID();
  await sql`INSERT INTO inventory_items (id, tenant_id, item_kind, item_code, display_name_ar, display_name_en, quality_status, is_blocked, status, created_by, created_at) VALUES (${id}, ${T}, ${"raw_material"}, ${"R28-IT-" + id.slice(0, 8)}, ${"Test-" + id.slice(0, 8)}, ${"Test Item"}, ${"accepted"}, false, ${"active"}, ${OWNER_ID}, NOW()) ON CONFLICT (id) DO NOTHING`;
  return id;
}

async function seedLocation(): Promise<string> {
  const id = randomUUID();
  await sql`INSERT INTO locations (id, tenant_id, location_code, name_ar, name_en, location_type, status, created_by, created_at) VALUES (${id}, ${T}, ${"R28-LOC-" + id.slice(0, 8)}, ${"LOC-" + id.slice(0, 8)}, ${"Test Location"}, ${"internal_warehouse"}::location_type, ${"active"}::master_data_status, ${OWNER_ID}, NOW()) ON CONFLICT (id) DO NOTHING`;
  return id;
}

/**
 * Build a barrier-wrapped InventoryLedgerService. The wrapper delegates to
 * the real requireCutoverLock, signals AFTER the real SHARED advisory lock
 * acquires, and optionally holds at a release barrier.
 */
function makeBarrierInventoryLedgerService(liveDb: any, opts: {
  onSharedAcquired?: () => void;
  waitForRelease?: Promise<void>;
}) {
  const ledger = new InventoryLedgerDbRepository(liveDb);
  const audit = new AuditDbRepository(liveDb);
  const idem = new IdempotencyDbRepository(liveDb);
  const docSeq = new DocumentSequenceDbRepository(liveDb);
  const realService = new InventoryLedgerService({ ledger, audit, idempotency: idem, documentSequence: docSeq });

  if (!opts.onSharedAcquired && !opts.waitForRelease) {
    return realService;
  }

  // Wrap requireCutoverLock to signal after real SHARED acquisition
  const wrapped: InventoryLedgerService = Object.create(realService);
  let barrierFired = false;
  (wrapped as any).requireCutoverLock = async (tenantId: string) => {
    // Delegate to the REAL requireCutoverLock which calls
    // ledger.lockCutoverScope(tenantId, "inventory", "shared")
    await realService.requireCutoverLock(tenantId);
    if (!barrierFired) {
      barrierFired = true;
      if (opts.onSharedAcquired) {
        opts.onSharedAcquired();
      }
      if (opts.waitForRelease) {
        await opts.waitForRelease;
      }
    }
  };
  return wrapped;
}

function makeIndependentDb() {
  const indSql = postgres(DATABASE_URL!, { prepare: false, max: 1, idle_timeout: 30, connect_timeout: 15 });
  const indDb = drizzle(indSql, { schema });
  return { db: indDb, sql: indSql };
}

describeOrSkip("WP-07-04 r28 — LIVE-LIVE-SHARED-INVENTORY-SVC-DET", () => {
  beforeAll(async () => {
    if (SHARED_GUARD_RESULT.kind !== "ok") return;
    sql = postgres(DATABASE_URL!, { max: 10 });
    db = drizzle(sql, { schema }) as any;
    await cleanupData();
    await seedTenantAndUsers();
  }, 60000);

  afterAll(async () => {
    if (SHARED_GUARD_RESULT.kind !== "ok") return;
    await cleanupData();
    if (sql) await sql.end();
  }, 60000);

  beforeEach(async () => {
    if (SHARED_GUARD_RESULT.kind !== "ok") return;
    // Kill any orphaned idle-in-transaction sessions from previous test failures
    await sql`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'erp_yarn_wp0801f_disposable' AND pid != pg_backend_pid() AND state = 'idle in transaction'`;
    await sql`SET statement_timeout = 10000`;
    await sql`ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_delete`;
    await sql`ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_update`;
    await sql`DELETE FROM inventory_balances WHERE tenant_id = ${T}`;
    await sql`DELETE FROM stock_movements WHERE tenant_id = ${T}`;
    await sql`DELETE FROM audit_logs WHERE tenant_id = ${T}`;
    await sql`DELETE FROM idempotency_records WHERE tenant_id = ${T}`;
    await sql`DELETE FROM document_sequences WHERE tenant_id = ${T}`;
    await sql`DELETE FROM inventory_items WHERE tenant_id = ${T}`;
    await sql`DELETE FROM locations WHERE tenant_id = ${T}`;
    await sql`ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_delete`;
    await sql`ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_update`;
    await sql`SET statement_timeout = 0`;
  }, 30000);

  // ===========================================================================
  // LIVE-LIVE-SHARED-INVENTORY-SVC-DET
  // ===========================================================================
  it("LIVE-LIVE-SHARED-INVENTORY-SVC-DET. A (real InventoryLedgerService.postRawReceipt) holds SHARED cutover; B acquires SHARED while A holds; both succeed", async () => {
    const user = makeUser();
    const eff = makeEff();

    // Non-conflicting fixtures: different items, different locations, different sources
    const itemA = await seedItem();
    const locationA = await seedLocation();
    const itemB = await seedItem();
    const locationB = await seedLocation();
    const sourceA = randomUUID();
    const sourceB = randomUUID();

    // Barrier for side A: signal after real SHARED acquisition, then hold
    let aSharedAcquired = false;
    let releaseA: () => void = () => {};
    const aReleasePromise = new Promise<void>(res => { releaseA = res; });

    const indA = makeIndependentDb();
    const serviceA = makeBarrierInventoryLedgerService(indA.db, {
      onSharedAcquired: () => { aSharedAcquired = true; },
      waitForRelease: aReleasePromise,
    });

    const keyA = "llsi-a-" + randomUUID();

    // Start A: real InventoryLedgerService.postRawReceipt — will acquire SHARED,
    // signal, hold transaction open at the barrier.
    const aPromise = serviceA.postRawReceipt(
      user as any, eff as any,
      {
        itemId: itemA,
        toLocationId: locationA,
        quantityKg: "100.000",
        movementDate: "2026-09-03",
        sourceDocumentType: "raw_material_batch",
        sourceDocumentId: sourceA,
        idempotencyKey: keyA,
      },
    ).then(v => ({ ok: true, v }), e => ({ ok: false, e }));

    // Wait for A to acquire the SHARED cutover lock
    for (let i = 0; i < 200; i++) {
      if (aSharedAcquired) break;
      // Check if A already failed
      const aSettled = await Promise.race([
        aPromise.then(() => true),
        new Promise<boolean>(r => setTimeout(() => r(false), 50)),
      ]);
      if (aSettled) break;
    }
    if (!aSharedAcquired) {
      // A failed before acquiring the SHARED lock — get the error for debugging
      const aResult = await aPromise;
      if (!aResult.ok) {
        throw new Error(`A failed before acquiring SHARED lock: ${(aResult as any).e?.message ?? aResult}`);
      }
      throw new Error("A never acquired SHARED lock (timed out waiting for barrier signal)");
    }
    expect(aSharedAcquired).toBe(true); // A genuinely holds SHARED inventory cutover lock

    // Start B: real InventoryLedgerService.postRawReceipt on independent connection.
    // B acquires SHARED — must NOT block on A's SHARED.
    const indB = makeIndependentDb();
    let bSharedAcquired = false;
    const serviceB = makeBarrierInventoryLedgerService(indB.db, {
      onSharedAcquired: () => { bSharedAcquired = true; },
    });

    const keyB = "llsi-b-" + randomUUID();

    // B must acquire SHARED while A still holds it (SHARED doesn't block SHARED)
    const bPromise = serviceB.postRawReceipt(
      user as any, eff as any,
      {
        itemId: itemB,
        toLocationId: locationB,
        quantityKg: "200.000",
        movementDate: "2026-09-03",
        sourceDocumentType: "raw_material_batch",
        sourceDocumentId: sourceB,
        idempotencyKey: keyB,
      },
    ).then(v => ({ ok: true, v }), e => ({ ok: false, e }));

    // B should acquire SHARED quickly (SHARED coexists). Use a 10s timeout.
    const bTimeout = new Promise<{ timedOut: true }>(res =>
      setTimeout(() => res({ timedOut: true }), 10000)
    );
    const bResult = await Promise.race([bPromise, bTimeout]);

    // Debug: check if B failed before acquiring SHARED
    if (!bSharedAcquired && "ok" in bResult && (bResult as any).ok === false) {
      const bErr = (bResult as any).e as Error;
      throw new Error(`B failed before acquiring SHARED: ${bErr?.message ?? bErr}`);
    }
    if (!bSharedAcquired && (bResult as any).timedOut) {
      throw new Error("B timed out — B never acquired SHARED (blocked or failed before requireCutoverLock)");
    }

    // CRITICAL ASSERTION: B acquired SHARED while A still held it
    expect(bSharedAcquired).toBe(true); // B acquired SHARED while A held it
    expect((bResult as any).timedOut).toBeUndefined(); // B did not time out

    // Release A — A's transaction completes (movement + balance + audit + idempotency)
    releaseA();
    const aFinal = await aPromise;
    expect(aFinal.ok).toBe(true);
    if (aFinal.ok) {
      expect((aFinal as any).v.action).toBe("posted");
      // Exact decimal-kg string
      expect((aFinal as any).v.onHandQtyKg).toBe("100.000");
    }

    // B completes too
    const bFinal = await bPromise;
    expect(bFinal.ok).toBe(true);
    if (bFinal.ok) {
      expect((bFinal as any).v.action).toBe("posted");
      expect((bFinal as any).v.onHandQtyKg).toBe("200.000");
    }

    // Exactly one movement for A
    const movementsA = await sql`SELECT id, quantity_kg FROM stock_movements WHERE tenant_id = ${T} AND source_document_id = ${sourceA}`;
    expect(movementsA.length).toBe(1);
    expect((movementsA as any)[0]!.quantity_kg).toBe("100.000");

    // Exactly one movement for B
    const movementsB = await sql`SELECT id, quantity_kg FROM stock_movements WHERE tenant_id = ${T} AND source_document_id = ${sourceB}`;
    expect(movementsB.length).toBe(1);
    expect((movementsB as any)[0]!.quantity_kg).toBe("200.000");

    // A's balance is correct
    const balanceA = await sql`SELECT on_hand_qty_kg FROM inventory_balances WHERE tenant_id = ${T} AND item_id = ${itemA} AND location_id = ${locationA}`;
    expect((balanceA as any)[0]!.on_hand_qty_kg).toBe("100.000");

    // B's balance is correct
    const balanceB = await sql`SELECT on_hand_qty_kg FROM inventory_balances WHERE tenant_id = ${T} AND item_id = ${itemB} AND location_id = ${locationB}`;
    expect((balanceB as any)[0]!.on_hand_qty_kg).toBe("200.000");

    // Both idempotency records are succeeded
    const idemA = await sql`SELECT state FROM idempotency_records WHERE tenant_id = ${T} AND idempotency_key = ${keyA}`;
    expect((idemA as any)[0]!.state).toBe("succeeded");
    const idemB = await sql`SELECT state FROM idempotency_records WHERE tenant_id = ${T} AND idempotency_key = ${keyB}`;
    expect((idemB as any)[0]!.state).toBe("succeeded");

    // No duplicate movements
    const allMovements = await sql`SELECT id FROM stock_movements WHERE tenant_id = ${T}`;
    expect(allMovements.length).toBe(2); // exactly one per posting

    await indA.sql.end();
    await indB.sql.end();
  }, 60000);
});
