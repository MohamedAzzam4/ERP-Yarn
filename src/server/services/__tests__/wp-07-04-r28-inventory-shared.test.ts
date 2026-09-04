/**
 * WP-07-04 r28→r29 — LIVE-LIVE-SHARED-INVENTORY-SVC-DET (CORRECTED)
 *
 * r28 proof was INVALID: it created InventoryLedgerService with TOP-LEVEL
 * Drizzle DB handles (auto-commit). `pg_advisory_xact_lock_shared(...)` is
 * transaction-scoped — with auto-commit repos, the implicit transaction ends
 * when the lock query returns, releasing the lock BEFORE the JS barrier.
 *
 * r29 CORRECTION: Both A and B run `postRawReceipt` INSIDE explicit
 * `db.transaction()` with ALL repos (ledger, audit, idempotency, documentSeq)
 * constructed from `tx`. The advisory lock persists for the duration of the
 * enclosing transaction.
 *
 * Pattern follows `wp-07-04-service-race.test.ts` which explicitly documents
 * this exact issue.
 *
 * Barrier sequence:
 *   1. A enters indA.db.transaction(txA)
 *   2. A constructs ALL repos from txA
 *   3. A's real requireCutoverLock acquires real pg_advisory_xact_lock_shared
 *      INSIDE txA (lock persists while txA is open)
 *   4. A signals A_SHARED_ACQUIRED
 *   5. A holds at release barrier (txA remains open, SHARED held)
 *   6. B enters indB.db.transaction(txB)
 *   7. B's real requireCutoverLock acquires SHARED INSIDE txB
 *   8. B signals B_SHARED_ACQUIRED WHILE A has NOT been released
 *   9. Release A → txA commits → A's postRawReceipt completes
 *  10. B completes independently → txB commits
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
  await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status) VALUES (${T}, ${"R29-" + s}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${OWNER_ID}, ${T}, ${"r29-o-" + s}, ${"R29 Owner"}, ${"r29-o-" + s + "@test.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${ACCOUNTANT_ID}, ${T}, ${"r29-a-" + s}, ${"R29 Accountant"}, ${"r29-a-" + s + "@test.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
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
  await sql`INSERT INTO inventory_items (id, tenant_id, item_kind, item_code, display_name_ar, display_name_en, quality_status, is_blocked, status, created_by, created_at) VALUES (${id}, ${T}, ${"raw_material"}, ${"R29-IT-" + id.slice(0, 8)}, ${"Test-" + id.slice(0, 8)}, ${"Test Item"}, ${"accepted"}, false, ${"active"}, ${OWNER_ID}, NOW()) ON CONFLICT (id) DO NOTHING`;
  return id;
}

async function seedLocation(): Promise<string> {
  const id = randomUUID();
  await sql`INSERT INTO locations (id, tenant_id, location_code, name_ar, name_en, location_type, status, created_by, created_at) VALUES (${id}, ${T}, ${"R29-LOC-" + id.slice(0, 8)}, ${"LOC-" + id.slice(0, 8)}, ${"Test Location"}, ${"internal_warehouse"}::location_type, ${"active"}::master_data_status, ${OWNER_ID}, NOW()) ON CONFLICT (id) DO NOTHING`;
  return id;
}

/**
 * Create an independent connection + drizzle instance.
 */
function makeIndependentDb() {
  const indSql = postgres(DATABASE_URL!, { prepare: false, max: 1, idle_timeout: 30, connect_timeout: 15 });
  const indDb = drizzle(indSql, { schema });
  return { db: indDb, sql: indSql };
}

describeOrSkip("WP-07-04 r29 — LIVE-LIVE-SHARED-INVENTORY-SVC-DET (corrected with explicit transactions)", () => {
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

  it("LIVE-LIVE-SHARED-INVENTORY-SVC-DET. A (real postRawReceipt in explicit tx) holds SHARED; B acquires SHARED while A holds; both succeed", async () => {
    const user = makeUser();
    const eff = makeEff();

    // Non-conflicting fixtures
    const itemA = await seedItem();
    const locationA = await seedLocation();
    const itemB = await seedItem();
    const locationB = await seedLocation();
    const sourceA = randomUUID();
    const sourceB = randomUUID();

    // Barrier for side A
    let aSharedAcquired = false;
    let releaseA: () => void = () => {};
    const aReleasePromise = new Promise<void>(res => { releaseA = res; });

    const indA = makeIndependentDb();
    const keyA = "llsi-r29-a-" + randomUUID();

    // A: run postRawReceipt INSIDE indA.db.transaction() with ALL repos from tx.
    // The advisory lock persists for the duration of the enclosing transaction.
    const aPromise = (async () => {
      return (indA.db as any).transaction(async (txA: any) => {
        // Construct ALL repos from txA — NOT from the top-level indA.db
        const txLedger = new InventoryLedgerDbRepository(txA);
        const txAudit = new AuditDbRepository(txA);
        const txIdem = new IdempotencyDbRepository(txA);
        const txDocSeq = new DocumentSequenceDbRepository(txA);
        const realService = new InventoryLedgerService({
          ledger: txLedger, audit: txAudit, idempotency: txIdem, documentSequence: txDocSeq,
        });

        // Wrap requireCutoverLock to signal AFTER real SHARED acquisition
        let aBarrierFired = false;
        const realRequireCutoverLock = realService.requireCutoverLock.bind(realService);
        (realService as any).requireCutoverLock = async (tenantId: string) => {
          await realRequireCutoverLock(tenantId); // real pg_advisory_xact_lock_shared INSIDE txA
          if (!aBarrierFired) {
            aBarrierFired = true;
            aSharedAcquired = true;
            await aReleasePromise; // hold txA open (SHARED lock persists)
          }
        };

        return realService.postRawReceipt(user as any, eff as any, {
          itemId: itemA,
          toLocationId: locationA,
          quantityKg: "100.000",
          movementDate: "2026-09-03",
          sourceDocumentType: "raw_material_batch",
          sourceDocumentId: sourceA,
          idempotencyKey: keyA,
        });
      });
    })().then(v => ({ ok: true, v }), e => ({ ok: false, e }));

    // Wait for A to acquire the SHARED cutover lock (inside txA)
    for (let i = 0; i < 200; i++) {
      if (aSharedAcquired) break;
      await new Promise(r => setTimeout(r, 50));
    }
    if (!aSharedAcquired) {
      const aResult = await Promise.race([aPromise, new Promise<any>(r => setTimeout(() => r({ timedOut: true }), 1000))]);
      if (aResult && !aResult.timedOut && !aResult.ok) {
        throw new Error(`A failed before acquiring SHARED lock: ${(aResult as any).e?.message ?? aResult}`);
      }
      throw new Error("A never acquired SHARED lock (timed out waiting for barrier signal)");
    }
    expect(aSharedAcquired).toBe(true); // A genuinely holds SHARED inside txA

    // Start B: run postRawReceipt INSIDE indB.db.transaction() with ALL repos from tx.
    const indB = makeIndependentDb();
    let bSharedAcquired = false;
    const keyB = "llsi-r29-b-" + randomUUID();

    const bPromise = (async () => {
      return (indB.db as any).transaction(async (txB: any) => {
        const txLedger = new InventoryLedgerDbRepository(txB);
        const txAudit = new AuditDbRepository(txB);
        const txIdem = new IdempotencyDbRepository(txB);
        const txDocSeq = new DocumentSequenceDbRepository(txB);
        const realService = new InventoryLedgerService({
          ledger: txLedger, audit: txAudit, idempotency: txIdem, documentSequence: txDocSeq,
        });

        // Wrap requireCutoverLock to signal AFTER real SHARED acquisition
        let bBarrierFired = false;
        const realRequireCutoverLock = realService.requireCutoverLock.bind(realService);
        (realService as any).requireCutoverLock = async (tenantId: string) => {
          await realRequireCutoverLock(tenantId); // real pg_advisory_xact_lock_shared INSIDE txB
          if (!bBarrierFired) {
            bBarrierFired = true;
            bSharedAcquired = true;
            // B does NOT hold — signals and continues
          }
        };

        return realService.postRawReceipt(user as any, eff as any, {
          itemId: itemB,
          toLocationId: locationB,
          quantityKg: "200.000",
          movementDate: "2026-09-03",
          sourceDocumentType: "raw_material_batch",
          sourceDocumentId: sourceB,
          idempotencyKey: keyB,
        });
      });
    })().then(v => ({ ok: true, v }), e => ({ ok: false, e }));

    // B should acquire SHARED quickly (SHARED coexists). 10s timeout.
    const bTimeout = new Promise<{ timedOut: true }>(res =>
      setTimeout(() => res({ timedOut: true }), 10000)
    );
    const bResult = await Promise.race([bPromise, bTimeout]);

    // CRITICAL ASSERTION: B acquired SHARED while A still held it
    expect(bSharedAcquired).toBe(true); // B acquired SHARED while A held it
    expect((bResult as any).timedOut).toBeUndefined();

    // Release A — txA commits, A's postRawReceipt completes
    releaseA();
    const aFinal = await aPromise;
    expect(aFinal.ok).toBe(true);
    if (aFinal.ok) {
      expect((aFinal as any).v.action).toBe("posted");
      expect((aFinal as any).v.onHandQtyKg).toBe("100.000");
    }

    // B completes too
    const bFinal = await bPromise;
    expect(bFinal.ok).toBe(true);
    if (bFinal.ok) {
      expect((bFinal as any).v.action).toBe("posted");
      expect((bFinal as any).v.onHandQtyKg).toBe("200.000");
    }

    // Exactly one movement each (exact decimal-kg strings)
    const movementsA = await sql`SELECT id, quantity_kg FROM stock_movements WHERE tenant_id = ${T} AND source_document_id = ${sourceA}`;
    expect(movementsA.length).toBe(1);
    expect((movementsA as any)[0]!.quantity_kg).toBe("100.000");

    const movementsB = await sql`SELECT id, quantity_kg FROM stock_movements WHERE tenant_id = ${T} AND source_document_id = ${sourceB}`;
    expect(movementsB.length).toBe(1);
    expect((movementsB as any)[0]!.quantity_kg).toBe("200.000");

    // Balances correct
    const balanceA = await sql`SELECT on_hand_qty_kg FROM inventory_balances WHERE tenant_id = ${T} AND item_id = ${itemA} AND location_id = ${locationA}`;
    expect((balanceA as any)[0]!.on_hand_qty_kg).toBe("100.000");
    const balanceB = await sql`SELECT on_hand_qty_kg FROM inventory_balances WHERE tenant_id = ${T} AND item_id = ${itemB} AND location_id = ${locationB}`;
    expect((balanceB as any)[0]!.on_hand_qty_kg).toBe("200.000");

    // Both idempotency records succeeded
    const idemA = await sql`SELECT state FROM idempotency_records WHERE tenant_id = ${T} AND idempotency_key = ${keyA}`;
    expect((idemA as any)[0]!.state).toBe("succeeded");
    const idemB = await sql`SELECT state FROM idempotency_records WHERE tenant_id = ${T} AND idempotency_key = ${keyB}`;
    expect((idemB as any)[0]!.state).toBe("succeeded");

    // No duplicate movements
    const allMovements = await sql`SELECT id FROM stock_movements WHERE tenant_id = ${T}`;
    expect(allMovements.length).toBe(2);

    await indA.sql.end();
    await indB.sql.end();
  }, 60000);
});
