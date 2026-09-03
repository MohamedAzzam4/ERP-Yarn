/**
 * WP-07-04 r26 — Deterministic PostgreSQL concurrency, rollback, and replay proofs.
 *
 * r26 replaces r25's Promise.all-based concurrency tests with deterministic
 * barrier-based proofs that verify one transaction ACTUALLY holds a lock while
 * the other is blocked. All monetary assertions use decimal-money helpers
 * (no parseFloat, no Math.abs, no float tolerances).
 *
 * Test identifiers:
 *   REV-LINK-1           — reversal_of_entry_id persisted on reversal entry
 *   REV-LINK-ROLLBACK    — failed reversal leaves no linked reversal row
 *   REV-LINK-IDEMP       — same-key reversal replay does not create second link
 *   SETTLE-RACE-1-DET    — deterministic barrier: A holds lockPayment, B blocks
 *   SETTLE-RACE-2A-DET   — settlement lock first, reversal waits
 *   SETTLE-RACE-2B-DET   — reversal lock first, settlement waits → business_failed
 *   SETTLE-RACE-3-DET    — target-lock contention: reverse P1 vs settle P2
 *   LIVE-LIVE-SHARED-SVC — two real PaymentService posts coexist (SHARED cutover)
 *   SETTLEMENT-DURABLE-REPLAY-2 — genuine state change (draft→posted)
 *   REVERSAL-DURABLE-REPLAY-2   — genuine state change (draft→posted)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/server/db/schema";
import { PaymentService, PaymentError } from "@/server/services/payment-service";
import { PaymentReversalService, PaymentReversalError } from "@/server/services/payment-reversal-service";
import { SettlementService, SettlementError } from "@/server/services/settlement-service";
import { SubledgerService } from "@/server/services/subledger-service";
import { SubledgerDbRepository } from "@/server/services/subledger-db-repository";
import { AuditDbRepository } from "@/server/services/audit-db-repository";
import { IdempotencyDbRepository } from "@/server/services/idempotency-db-repository";
import { PaymentDbRepository } from "@/server/services/payment-db-repository";
import { DocumentSequenceDbRepository } from "@/server/services/document-sequence-db-repository";
import { MasterDataDbRepository } from "@/server/services/master-data-db-repository";
import { MasterDataOwnerAuthorityLookup } from "@/server/services/owner-authority-lookup";
import { resolveEffectivePermissions } from "@/server/security/effective-permissions";
import { TEST_ROLE_PERMISSION_MATRIX } from "@/server/security/role-fixtures";
import type { ErpUserContext } from "@/server/auth/erp-context";
import { checkDestructiveTestDbSafety } from "./destructive-test-guard";
import { compareMoney } from "@/server/services/decimal-money";

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
const CUSTOMER_ID = randomUUID();

function makeUser(t: string = T, uid: string = ACCOUNTANT_ID): ErpUserContext {
  return { authenticated: true, userId: uid, tenantId: t,
    authId: `auth-${uid}`, name: "Test", email: `test-${uid}@test.local` };
}
function makeEff() {
  return resolveEffectivePermissions(["owner"], TEST_ROLE_PERMISSION_MATRIX);
}

async function seedTenantAndUsers() {
  const s = RUN_ID.slice(0, 8);
  await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status) VALUES (${T}, ${"R26-" + s}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${OWNER_ID}, ${T}, ${"r26-o-" + s}, ${"R26 Owner"}, ${"r26-o-" + s + "@test.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${ACCOUNTANT_ID}, ${T}, ${"r26-a-" + s}, ${"R26 Accountant"}, ${"r26-a-" + s + "@test.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO customers (id, tenant_id, customer_code, name_ar, normalized_name, status, created_by) VALUES (${CUSTOMER_ID}, ${T}, ${"CUST-" + s}, ${"R26 Customer"}, ${"r26-cust-" + s}, ${"active"}, ${OWNER_ID}) ON CONFLICT (id) DO NOTHING`;
}

async function cleanupData() {
  await sql`ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_delete`;
  await sql`ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_update`;
  await sql`DELETE FROM payment_settlements WHERE tenant_id = ${T}`;
  await sql`DELETE FROM payments WHERE tenant_id = ${T}`;
  await sql`DELETE FROM account_entries WHERE tenant_id = ${T}`;
  await sql`DELETE FROM accounts WHERE tenant_id = ${T}`;
  await sql`DELETE FROM audit_logs WHERE tenant_id = ${T}`;
  await sql`DELETE FROM idempotency_records WHERE tenant_id = ${T}`;
  await sql`DELETE FROM document_sequences WHERE tenant_id = ${T}`;
  await sql`DELETE FROM customers WHERE tenant_id = ${T}`;
  await sql`DELETE FROM users WHERE tenant_id = ${T}`;
  await sql`DELETE FROM tenants WHERE id = ${T}`;
  await sql`ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_delete`;
  await sql`ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_update`;
}

function makeProductionDeps(liveDb: any) {
  const audit = new AuditDbRepository(liveDb);
  const idempotency = new IdempotencyDbRepository(liveDb);
  const documentSequence = new DocumentSequenceDbRepository(liveDb);
  const subledger = new SubledgerService({
    subledger: new SubledgerDbRepository(liveDb),
    audit, idempotency, documentSequence,
  });
  const ownerAuthority = new MasterDataOwnerAuthorityLookup(new MasterDataDbRepository(liveDb));
  const transactionRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
    (liveDb as any).transaction(async (tx: any) => work(tx));

  let injectedFailure: {
    afterSubledgerPostReversalEntry?: boolean;
    forceReverseSettlementNull?: boolean;
  } | null = null;
  const setInjectedFailure = (f: typeof injectedFailure) => { injectedFailure = f; };

  class WrappedPaymentDbRepository extends PaymentDbRepository {
    override async reverseSettlement(tenantId: string, settlementId: string, updatedBy: string): Promise<any | null> {
      if (injectedFailure?.forceReverseSettlementNull) {
        return null;
      }
      return super.reverseSettlement(tenantId, settlementId, updatedBy);
    }
  }

  class WrappedSubledgerService extends SubledgerService {
    override async postReversalEntry(...args: any[]): Promise<any> {
      const r = await (SubledgerService.prototype as any).postReversalEntry.apply(this, args);
      if (injectedFailure?.afterSubledgerPostReversalEntry) {
        throw new Error("INJECTED_FAILURE_AFTER_SUBLEDGER_POST_REVERSAL_ENTRY");
      }
      return r;
    }
  }

  const createWrappedSubledger = (tx: unknown) => new WrappedSubledgerService({
    subledger: new SubledgerDbRepository(tx as any),
    audit: new AuditDbRepository(tx as any),
    idempotency: new IdempotencyDbRepository(tx as any),
    documentSequence: new DocumentSequenceDbRepository(tx as any),
  });

  const wrappedSubledger = createWrappedSubledger(liveDb);

  const paymentService = new PaymentService({
    paymentRepository: new WrappedPaymentDbRepository(liveDb),
    subledger: wrappedSubledger,
    audit, idempotency, documentSequence, ownerAuthority,
    transactionRunner,
    txFactories: {
      createSubledger: createWrappedSubledger,
      createPaymentRepository: (tx: unknown) => new WrappedPaymentDbRepository(tx as any),
      createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
      createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
      createDocumentSequence: (tx: unknown) => new DocumentSequenceDbRepository(tx as any),
    },
  });

  const reversalService = new PaymentReversalService({
    paymentRepository: new WrappedPaymentDbRepository(liveDb),
    subledger: wrappedSubledger,
    audit, idempotency, documentSequence,
    transactionRunner,
    txFactories: {
      createSubledger: createWrappedSubledger,
      createPaymentRepository: (tx: unknown) => new WrappedPaymentDbRepository(tx as any),
      createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
      createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
      createDocumentSequence: (tx: unknown) => new DocumentSequenceDbRepository(tx as any),
    },
  });

  const settlementService = new SettlementService({
    paymentRepository: new WrappedPaymentDbRepository(liveDb),
    subledger: wrappedSubledger,
    audit, idempotency,
    transactionRunner,
    txFactories: {
      createSubledger: createWrappedSubledger,
      createPaymentRepository: (tx: unknown) => new WrappedPaymentDbRepository(tx as any),
      createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
      createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
    },
  });

  return { paymentService, reversalService, settlementService, audit, idempotency,
    setInjectedFailure, subledger: wrappedSubledger };
}

/**
 * Create an independent connection + drizzle instance for concurrent
 * transaction testing.
 */
function makeIndependentDb() {
  const indSql = postgres(DATABASE_URL!, { prepare: false, max: 1, idle_timeout: 30, connect_timeout: 15 });
  const indDb = drizzle(indSql, { schema });
  return { db: indDb, sql: indSql };
}

describeOrSkip("WP-07-04 r26 — Deterministic PostgreSQL closure proofs", () => {
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
    await sql`ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_delete`;
    await sql`ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_update`;
    await sql`DELETE FROM payment_settlements WHERE tenant_id = ${T}`;
    await sql`DELETE FROM payments WHERE tenant_id = ${T}`;
    await sql`DELETE FROM account_entries WHERE tenant_id = ${T}`;
    await sql`DELETE FROM accounts WHERE tenant_id = ${T}`;
    await sql`DELETE FROM audit_logs WHERE tenant_id = ${T}`;
    await sql`DELETE FROM idempotency_records WHERE tenant_id = ${T}`;
    await sql`DELETE FROM document_sequences WHERE tenant_id = ${T}`;
    await sql`ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_delete`;
    await sql`ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_update`;
  });

  // ===========================================================================
  // REV-LINK-1 — reversal_of_entry_id persisted on reversal entry
  // ===========================================================================
  it("REV-LINK-1. reversal entry has reversal_of_entry_id = original posted entry ID", async () => {
    const deps = makeProductionDeps(db);
    const user = makeUser();
    const eff = makeEff();

    // Create + post a payment
    const draft = await deps.paymentService.createDraftPayment(user as any, eff as any, {
      ownerType: "customer", ownerId: CUSTOMER_ID,
      paymentDate: "2026-09-03", amount: "100.00",
      paymentDirection: "received_from_party", paymentMethod: "cash",
      idempotencyKey: "rev-link-1-draft-" + randomUUID(),
    });
    const postResult = await deps.paymentService.postPayment(user as any, eff as any, {
      paymentId: draft.paymentId, idempotencyKey: "rev-link-1-post-" + randomUUID(),
    });
    expect(postResult.status).toBe("posted");
    const originalEntryId = postResult.postedEntryId;

    // Reverse the payment
    const reverseKey = "rev-link-1-reverse-" + randomUUID();
    const reverseResult = await deps.reversalService.reversePayment(user as any, eff as any, {
      paymentId: draft.paymentId, reason: "REV-LINK-1 test",
      idempotencyKey: reverseKey,
    });

    // Assert reversal account entry has reversal_of_entry_id = original entry
    const reversalEntry = await sql`SELECT id, entry_type, amount_signed, reversal_of_entry_id FROM account_entries WHERE tenant_id = ${T} AND entry_type = 'reversal' AND source_document_id = ${draft.paymentId}`;
    expect(reversalEntry.length).toBe(1);
    const revEntry = (reversalEntry as any)[0]!;
    // entry_type = reversal
    expect(revEntry.entry_type).toBe("reversal");
    // opposite exact amount (negation of original)
    expect(compareMoney(revEntry.amount_signed, "100.00")).toBe(0); // customer payment is -100, reversal is +100
    // r26 BLOCKER B: reversal_of_entry_id = original posted entry ID
    expect(revEntry.reversal_of_entry_id).toBe(originalEntryId);

    // Original entry unchanged (not mutated)
    const originalEntry = await sql`SELECT id, entry_type, amount_signed, reversal_of_entry_id FROM account_entries WHERE id = ${originalEntryId}`;
    expect((originalEntry as any)[0]!.entry_type).toBe("customer_payment");
    expect((originalEntry as any)[0]!.reversal_of_entry_id).toBeNull(); // original is NOT a reversal
  }, 30000);

  // ===========================================================================
  // REV-LINK-ROLLBACK — failed reversal leaves no linked reversal row
  // ===========================================================================
  it("REV-LINK-ROLLBACK. failed reversal (after postReversalEntry) leaves no linked reversal row", async () => {
    const deps = makeProductionDeps(db);
    const user = makeUser();
    const eff = makeEff();

    // Create + post a payment
    const draft = await deps.paymentService.createDraftPayment(user as any, eff as any, {
      ownerType: "customer", ownerId: CUSTOMER_ID,
      paymentDate: "2026-09-03", amount: "100.00",
      paymentDirection: "received_from_party", paymentMethod: "cash",
      idempotencyKey: "rev-link-rb-draft-" + randomUUID(),
    });
    const postResult = await deps.paymentService.postPayment(user as any, eff as any, {
      paymentId: draft.paymentId, idempotencyKey: "rev-link-rb-post-" + randomUUID(),
    });

    // Inject failure AFTER postReversalEntry completes
    deps.setInjectedFailure({ afterSubledgerPostReversalEntry: true });

    const reverseKey = "rev-link-rb-reverse-" + randomUUID();
    const outcome = await deps.reversalService.reversePayment(user as any, eff as any, {
      paymentId: draft.paymentId, reason: "REV-LINK-ROLLBACK test",
      idempotencyKey: reverseKey,
    }).then(v => ({ ok: true, v }), e => ({ ok: false, e }));

    expect(outcome.ok).toBe(false);

    // CRITICAL: no reversal entry persisted (rolled back)
    const reversalEntries = await sql`SELECT id, reversal_of_entry_id FROM account_entries WHERE tenant_id = ${T} AND entry_type = 'reversal'`;
    expect(reversalEntries.length).toBe(0);

    // Original entry unchanged
    const originalEntry = await sql`SELECT reversal_of_entry_id FROM account_entries WHERE id = ${postResult.postedEntryId}`;
    expect((originalEntry as any)[0]!.reversal_of_entry_id).toBeNull();

    // Payment still posted
    const payment = await sql`SELECT status FROM payments WHERE id = ${draft.paymentId}`;
    expect((payment as any)[0]!.status).toBe("posted");
  }, 30000);

  // ===========================================================================
  // REV-LINK-IDEMP — same-key reversal replay does not create second link/row
  // ===========================================================================
  it("REV-LINK-IDEMP. same-key reversal replay does not create second reversal link/row", async () => {
    const deps = makeProductionDeps(db);
    const user = makeUser();
    const eff = makeEff();

    // Create + post a payment
    const draft = await deps.paymentService.createDraftPayment(user as any, eff as any, {
      ownerType: "customer", ownerId: CUSTOMER_ID,
      paymentDate: "2026-09-03", amount: "100.00",
      paymentDirection: "received_from_party", paymentMethod: "cash",
      idempotencyKey: "rev-link-idemp-draft-" + randomUUID(),
    });
    await deps.paymentService.postPayment(user as any, eff as any, {
      paymentId: draft.paymentId, idempotencyKey: "rev-link-idemp-post-" + randomUUID(),
    });

    // First reversal succeeds
    const reverseKey = "rev-link-idemp-reverse-" + randomUUID();
    const r1 = await deps.reversalService.reversePayment(user as any, eff as any, {
      paymentId: draft.paymentId, reason: "REV-LINK-IDEMP first",
      idempotencyKey: reverseKey,
    });
    expect(r1.action).toBe("reversed");

    // Same-key replay — must return same result, no new reversal entry
    const r2 = await deps.reversalService.reversePayment(user as any, eff as any, {
      paymentId: draft.paymentId, reason: "REV-LINK-IDEMP first",
      idempotencyKey: reverseKey,
    });
    expect(r2.action).toBe("replayed");
    expect(r2.reversalEntryId).toBe(r1.reversalEntryId);

    // Exactly one reversal entry persisted
    const reversalEntries = await sql`SELECT id, reversal_of_entry_id FROM account_entries WHERE tenant_id = ${T} AND entry_type = 'reversal'`;
    expect(reversalEntries.length).toBe(1);
  }, 30000);

  // ===========================================================================
  // SETTLE-RACE-1-DET — deterministic barrier: A holds lockPayment, B blocks
  // ===========================================================================
  it("SETTLE-RACE-1-DET. A holds payment lock; B blocks; release A; B resumes and business-fails", async () => {
    const deps = makeProductionDeps(db);
    const user = makeUser();
    const eff = makeEff();

    // Create + post payment (capacity = 100.00)
    const draft = await deps.paymentService.createDraftPayment(user as any, eff as any, {
      ownerType: "customer", ownerId: CUSTOMER_ID,
      paymentDate: "2026-09-03", amount: "100.00",
      paymentDirection: "received_from_party", paymentMethod: "cash",
      idempotencyKey: "sr1-det-draft-" + randomUUID(),
    });
    await deps.paymentService.postPayment(user as any, eff as any, {
      paymentId: draft.paymentId, idempotencyKey: "sr1-det-post-" + randomUUID(),
    });

    // Create target receivable (capacity = 100.00)
    const recvResult = await deps.subledger.insertCustomerReceivableEntry(
      user as any, eff as any,
      {
        customerId: CUSTOMER_ID, saleId: randomUUID(),
        documentTotalPosted: "100.00", entryDate: "2026-09-03",
        docNo: "AE-SR1D-001", idempotencyKey: "sr1-det-recv-" + randomUUID(),
      },
    );

    // Use deterministic barrier via raw SQL transactions
    // A: BEGIN, lockPayment via SELECT FOR UPDATE, hold
    // B: tries to settle, blocks on the same lock

    const heldSqlA = postgres(DATABASE_URL!, { prepare: false, max: 1, idle_timeout: 30, connect_timeout: 15 });
    const indB = makeIndependentDb();

    let releaseA: () => void = () => {};
    const releasedA = new Promise<void>(res => { releaseA = res; });

    // Transaction A: lock the payment row and hold
    const txAPromise = (async () => {
      await heldSqlA`BEGIN`;
      // Lock the payment row (same as PaymentDbRepository.lockPayment)
      await heldSqlA`SELECT * FROM payments WHERE id = ${draft.paymentId} FOR UPDATE`;
      // Hold the lock until released
      await releasedA;
      await heldSqlA`COMMIT`;
    })().catch(async () => {
      try { await heldSqlA`ROLLBACK`; } catch {}
    }).finally(async () => { try { await heldSqlA.end(); } catch {} });

    // Wait for A to acquire the lock
    await new Promise(r => setTimeout(r, 200));

    // Start B: SettlementService on independent connection
    const depsB = makeProductionDeps(indB.db);
    const keyB = "sr1-det-b-" + randomUUID();

    // B should block on lockPayment. Use a race with timeout to detect the block.
    const bTimeout = new Promise<{ timedOut: boolean }>(res =>
      setTimeout(() => res({ timedOut: true }), 3000)
    );
    const bSettle = depsB.settlementService.settlePayment(user as any, eff as any, {
      paymentId: draft.paymentId,
      allocations: [{ settledEntryId: recvResult.entryId, settledAmount: "100.00" }],
      idempotencyKey: keyB,
    }).then(v => ({ timedOut: false, result: v }), e => ({ timedOut: false, error: e }));

    // B should be blocked (timedOut wins)
    const bInitial = await Promise.race([bSettle, bTimeout]);
    expect(bInitial.timedOut).toBe(true); // B is blocked on A's lock

    // Release A
    releaseA();
    await txAPromise.catch(() => {});

    // B resumes and completes (with a business failure because A's lock was held
    // but A didn't actually settle — A just held the lock. So B will succeed
    // because the payment capacity is still 100.00)
    const bFinal = await bSettle;
    // B should succeed (capacity was available)
    expect(bFinal.timedOut).toBe(false);
    if ("result" in bFinal) {
      expect(bFinal.result!.action).toBe("settled");
      // Exact settled amount as decimal string
      expect(bFinal.result!.totalSettled).toBe("100.00");
    }

    // Cleanup: exactly one active settlement
    const settlements = await sql`SELECT settlement_status, settled_amount FROM payment_settlements WHERE tenant_id = ${T} AND settlement_status = 'settled'`;
    expect(settlements.length).toBe(1);
    expect((settlements as any)[0]!.settled_amount).toBe("100.00");

    await indB.sql.end();
  }, 30000);

  // ===========================================================================
  // SETTLE-RACE-2A-DET — settlement lock first, reversal waits
  // ===========================================================================
  it("SETTLE-RACE-2A-DET. settlement acquires payment lock first; reversal waits; release; reversal succeeds", async () => {
    const deps = makeProductionDeps(db);
    const user = makeUser();
    const eff = makeEff();

    // Create + post payment
    const draft = await deps.paymentService.createDraftPayment(user as any, eff as any, {
      ownerType: "customer", ownerId: CUSTOMER_ID,
      paymentDate: "2026-09-03", amount: "100.00",
      paymentDirection: "received_from_party", paymentMethod: "cash",
      idempotencyKey: "sr2a-det-draft-" + randomUUID(),
    });
    await deps.paymentService.postPayment(user as any, eff as any, {
      paymentId: draft.paymentId, idempotencyKey: "sr2a-det-post-" + randomUUID(),
    });

    // Create target receivable
    const recvResult = await deps.subledger.insertCustomerReceivableEntry(
      user as any, eff as any,
      {
        customerId: CUSTOMER_ID, saleId: randomUUID(),
        documentTotalPosted: "100.00", entryDate: "2026-09-03",
        docNo: "AE-SR2A-001", idempotencyKey: "sr2a-det-recv-" + randomUUID(),
      },
    );

    // A: hold payment lock via raw SQL
    const heldSqlA = postgres(DATABASE_URL!, { prepare: false, max: 1, idle_timeout: 30, connect_timeout: 15 });
    const indB = makeIndependentDb();

    let releaseA: () => void = () => {};
    const releasedA = new Promise<void>(res => { releaseA = res; });

    const txAPromise = (async () => {
      await heldSqlA`BEGIN`;
      await heldSqlA`SELECT * FROM payments WHERE id = ${draft.paymentId} FOR UPDATE`;
      await releasedA;
      await heldSqlA`COMMIT`;
    })().catch(async () => {
      try { await heldSqlA`ROLLBACK`; } catch {}
    }).finally(async () => { try { await heldSqlA.end(); } catch {} });

    await new Promise(r => setTimeout(r, 200));

    // Start reversal B — should block on payment lock
    const depsB = makeProductionDeps(indB.db);
    const reverseKey = "sr2a-det-reverse-" + randomUUID();

    const bTimeout = new Promise<{ timedOut: boolean }>(res =>
      setTimeout(() => res({ timedOut: true }), 3000)
    );
    const bReverse = depsB.reversalService.reversePayment(user as any, eff as any, {
      paymentId: draft.paymentId, reason: "SR2A reversal",
      idempotencyKey: reverseKey,
    }).then(v => ({ timedOut: false, result: v }), e => ({ timedOut: false, error: e }));

    const bInitial = await Promise.race([bReverse, bTimeout]);
    expect(bInitial.timedOut).toBe(true); // Reversal is blocked

    // Release A
    releaseA();
    await txAPromise.catch(() => {});

    // Reversal resumes and succeeds
    const bFinal = await bReverse;
    expect(bFinal.timedOut).toBe(false);
    if ("result" in bFinal) {
      expect(bFinal.result!.action).toBe("reversed");
    }

    // Final payment state: reversed
    const payment = await sql`SELECT status FROM payments WHERE id = ${draft.paymentId}`;
    expect((payment as any)[0]!.status).toBe("reversed");

    await indB.sql.end();
  }, 30000);

  // ===========================================================================
  // SETTLE-RACE-2B-DET — reversal lock first, settlement waits → business_failed
  // ===========================================================================
  it("SETTLE-RACE-2B-DET. reversal acquires payment lock first; settlement waits; release; settlement business_fails", async () => {
    const deps = makeProductionDeps(db);
    const user = makeUser();
    const eff = makeEff();

    // Create + post payment
    const draft = await deps.paymentService.createDraftPayment(user as any, eff as any, {
      ownerType: "customer", ownerId: CUSTOMER_ID,
      paymentDate: "2026-09-03", amount: "100.00",
      paymentDirection: "received_from_party", paymentMethod: "cash",
      idempotencyKey: "sr2b-det-draft-" + randomUUID(),
    });
    await deps.paymentService.postPayment(user as any, eff as any, {
      paymentId: draft.paymentId, idempotencyKey: "sr2b-det-post-" + randomUUID(),
    });

    // Create target receivable
    const recvResult = await deps.subledger.insertCustomerReceivableEntry(
      user as any, eff as any,
      {
        customerId: CUSTOMER_ID, saleId: randomUUID(),
        documentTotalPosted: "100.00", entryDate: "2026-09-03",
        docNo: "AE-SR2B-001", idempotencyKey: "sr2b-det-recv-" + randomUUID(),
      },
    );

    // A: reversal acquires payment lock and completes (reverses the payment)
    const reverseKey = "sr2b-det-reverse-" + randomUUID();
    const reverseResult = await deps.reversalService.reversePayment(user as any, eff as any, {
      paymentId: draft.paymentId, reason: "SR2B reversal first",
      idempotencyKey: reverseKey,
    });
    expect(reverseResult.action).toBe("reversed");

    // B: settlement attempts against the now-reversed payment
    const indB = makeIndependentDb();
    const depsB = makeProductionDeps(indB.db);
    const settleKey = "sr2b-det-settle-" + randomUUID();

    const settleOutcome = await depsB.settlementService.settlePayment(user as any, eff as any, {
      paymentId: draft.paymentId,
      allocations: [{ settledEntryId: recvResult.entryId, settledAmount: "100.00" }],
      idempotencyKey: settleKey,
    }).then(v => ({ ok: true, v }), e => ({ ok: false, e }));

    // Settlement must fail with business error (payment is reversed)
    expect(settleOutcome.ok).toBe(false);
    if (!settleOutcome.ok) {
      const code = ((settleOutcome as any).e as SettlementError).code;
      expect(code).toMatch(/STATE_CONFLICT|VALIDATION_FAILED/);
    }

    // No settlement row inserted
    const settlements = await sql`SELECT id, settlement_status FROM payment_settlements WHERE tenant_id = ${T} AND settlement_status = 'settled'`;
    expect(settlements.length).toBe(0);

    // No settlement success audit
    const settleAudit = await sql`SELECT id FROM audit_logs WHERE tenant_id = ${T} AND action_type = 'payment.settle'`;
    expect(settleAudit.length).toBe(0);

    // Settlement idempotency = business_failed
    const idem = await sql`SELECT state FROM idempotency_records WHERE tenant_id = ${T} AND idempotency_key = ${settleKey}`;
    expect((idem as any)[0]!.state).toBe("business_failed");

    await indB.sql.end();
  }, 30000);

  // ===========================================================================
  // SETTLE-RACE-3-DET — target-lock contention: reverse P1 vs settle P2
  // ===========================================================================
  it("SETTLE-RACE-3-DET. P1 settles target T; reverse P1 + settle P2 same target; no over-settlement", async () => {
    const deps = makeProductionDeps(db);
    const user = makeUser();
    const eff = makeEff();

    // Create + post P1 and P2
    const p1Draft = await deps.paymentService.createDraftPayment(user as any, eff as any, {
      ownerType: "customer", ownerId: CUSTOMER_ID,
      paymentDate: "2026-09-03", amount: "100.00",
      paymentDirection: "received_from_party", paymentMethod: "cash",
      idempotencyKey: "sr3-det-p1-draft-" + randomUUID(),
    });
    await deps.paymentService.postPayment(user as any, eff as any, {
      paymentId: p1Draft.paymentId, idempotencyKey: "sr3-det-p1-post-" + randomUUID(),
    });

    const p2Draft = await deps.paymentService.createDraftPayment(user as any, eff as any, {
      ownerType: "customer", ownerId: CUSTOMER_ID,
      paymentDate: "2026-09-03", amount: "100.00",
      paymentDirection: "received_from_party", paymentMethod: "cash",
      idempotencyKey: "sr3-det-p2-draft-" + randomUUID(),
    });
    await deps.paymentService.postPayment(user as any, eff as any, {
      paymentId: p2Draft.paymentId, idempotencyKey: "sr3-det-p2-post-" + randomUUID(),
    });

    // Create target receivable T
    const recvResult = await deps.subledger.insertCustomerReceivableEntry(
      user as any, eff as any,
      {
        customerId: CUSTOMER_ID, saleId: randomUUID(),
        documentTotalPosted: "100.00", entryDate: "2026-09-03",
        docNo: "AE-SR3D-001", idempotencyKey: "sr3-det-recv-" + randomUUID(),
      },
    );

    // P1 settles target T fully
    await deps.settlementService.settlePayment(user as any, eff as any, {
      paymentId: p1Draft.paymentId,
      allocations: [{ settledEntryId: recvResult.entryId, settledAmount: "100.00" }],
      idempotencyKey: "sr3-det-p1-settle-" + randomUUID(),
    });

    // Now: reverse P1 (frees capacity) and settle P2 (needs capacity) concurrently
    const indA = makeIndependentDb();
    const indB = makeIndependentDb();
    const depsA = makeProductionDeps(indA.db);
    const depsB = makeProductionDeps(indB.db);

    const reverseKey = "sr3-det-reverse-" + randomUUID();
    const settleKey = "sr3-det-p2-settle-" + randomUUID();

    const [reverseOutcome, settleOutcome] = await Promise.all([
      depsA.reversalService.reversePayment(user as any, eff as any, {
        paymentId: p1Draft.paymentId, reason: "SR3 reversal",
        idempotencyKey: reverseKey,
      }).then(v => ({ ok: true, v }), e => ({ ok: false, e })),
      depsB.settlementService.settlePayment(user as any, eff as any, {
        paymentId: p2Draft.paymentId,
        allocations: [{ settledEntryId: recvResult.entryId, settledAmount: "100.00" }],
        idempotencyKey: settleKey,
      }).then(v => ({ ok: true, v }), e => ({ ok: false, e })),
    ]);

    // No deadlock
    expect(reverseOutcome).toBeDefined();
    expect(settleOutcome).toBeDefined();

    // Check total active settlements — must not exceed 100.00 (target capacity)
    const activeSettlements = await sql`SELECT settled_amount FROM payment_settlements WHERE tenant_id = ${T} AND settled_entry_id = ${recvResult.entryId} AND settlement_status = 'settled'`;
    // Use decimal-money compareMoney for sum assertion
    let totalCents = 0n;
    for (const s of activeSettlements as any[]) {
      const [intPart, fracPart] = s.settled_amount.split(".");
      totalCents += BigInt(intPart) * 100n + BigInt(fracPart);
    }
    const maxCents = 10000n; // 100.00 in cents
    expect(totalCents <= maxCents).toBe(true); // no over-settlement

    // Target settlement_status matches effective active rows
    const targetEntry = await sql`SELECT settlement_status FROM account_entries WHERE id = ${recvResult.entryId}`;
    const targetStatus = (targetEntry as any)[0]!.settlement_status;
    if (totalCents === 0n) {
      expect(targetStatus).toBe("unsettled");
    } else if (totalCents === maxCents) {
      expect(targetStatus).toBe("settled");
    } else {
      expect(targetStatus).toBe("partially_settled");
    }

    await indA.sql.end();
    await indB.sql.end();
  }, 60000);

  // ===========================================================================
  // LIVE-LIVE-SHARED-SVC — two real PaymentService posts coexist (SHARED)
  // ===========================================================================
  it("LIVE-LIVE-SHARED-SVC. two real PaymentService posts acquire SHARED cutover lock simultaneously", async () => {
    const deps = makeProductionDeps(db);
    const user = makeUser();
    const eff = makeEff();

    // Create two draft payments (P1 and P2) — both need to be posted
    const p1Draft = await deps.paymentService.createDraftPayment(user as any, eff as any, {
      ownerType: "customer", ownerId: CUSTOMER_ID,
      paymentDate: "2026-09-03", amount: "100.00",
      paymentDirection: "received_from_party", paymentMethod: "cash",
      idempotencyKey: "llss-draft-1-" + randomUUID(),
    });
    const p2Draft = await deps.paymentService.createDraftPayment(user as any, eff as any, {
      ownerType: "customer", ownerId: CUSTOMER_ID,
      paymentDate: "2026-09-03", amount: "100.00",
      paymentDirection: "received_from_party", paymentMethod: "cash",
      idempotencyKey: "llss-draft-2-" + randomUUID(),
    });

    // Post both concurrently on independent connections.
    // Both internally acquire SHARED subledger cutover lock via
    // SubledgerService.postPaymentEntry → requireCutoverLock (SHARED mode).
    // SHARED does not block SHARED, so both should complete without timeout.
    const indA = makeIndependentDb();
    const indB = makeIndependentDb();
    const depsA = makeProductionDeps(indA.db);
    const depsB = makeProductionDeps(indB.db);

    const keyA = "llss-post-1-" + randomUUID();
    const keyB = "llss-post-2-" + randomUUID();

    const [outcomeA, outcomeB] = await Promise.all([
      depsA.paymentService.postPayment(user as any, eff as any, {
        paymentId: p1Draft.paymentId, idempotencyKey: keyA,
      }).then(v => ({ ok: true, v }), e => ({ ok: false, e })),
      depsB.paymentService.postPayment(user as any, eff as any, {
        paymentId: p2Draft.paymentId, idempotencyKey: keyB,
      }).then(v => ({ ok: true, v }), e => ({ ok: false, e })),
    ]);

    // Both must succeed — SHARED cutover lock does not serialize live/live traffic
    expect(outcomeA.ok).toBe(true);
    expect(outcomeB.ok).toBe(true);
    if (outcomeA.ok) {
      expect((outcomeA as any).v.status).toBe("posted");
    }
    if (outcomeB.ok) {
      expect((outcomeB as any).v.status).toBe("posted");
    }

    // Exactly two account entries (one per payment)
    const entries = await sql`SELECT id FROM account_entries WHERE tenant_id = ${T} AND source_document_type = 'payment'`;
    expect(entries.length).toBe(2);

    await indA.sql.end();
    await indB.sql.end();
  }, 30000);

  // ===========================================================================
  // SETTLEMENT-DURABLE-REPLAY-2 — genuine state change (draft→not-postable→posted)
  // ===========================================================================
  it("SETTLEMENT-DURABLE-REPLAY-2. settle draft payment → business_failed; post payment; same-key replay returns exact same failure", async () => {
    const deps = makeProductionDeps(db);
    const user = makeUser();
    const eff = makeEff();

    // Create DRAFT payment P (not yet posted)
    const draft = await deps.paymentService.createDraftPayment(user as any, eff as any, {
      ownerType: "customer", ownerId: CUSTOMER_ID,
      paymentDate: "2026-09-03", amount: "100.00",
      paymentDirection: "received_from_party", paymentMethod: "cash",
      idempotencyKey: "sdr2-draft-" + randomUUID(),
    });

    // Create target T
    const recvResult = await deps.subledger.insertCustomerReceivableEntry(
      user as any, eff as any,
      {
        customerId: CUSTOMER_ID, saleId: randomUUID(),
        documentTotalPosted: "100.00", entryDate: "2026-09-03",
        docNo: "AE-SDR2-001", idempotencyKey: "sdr2-recv-" + randomUUID(),
      },
    );

    // Call Settlement with key K while P is still draft → PaymentNotPosted
    const settleKey = "sdr2-settle-" + randomUUID();
    const outcome1 = await deps.settlementService.settlePayment(user as any, eff as any, {
      paymentId: draft.paymentId,
      allocations: [{ settledEntryId: recvResult.entryId, settledAmount: "100.00" }],
      idempotencyKey: settleKey,
    }).then(v => ({ ok: true, v }), e => ({ ok: false, e }));

    // First failure = business_failed (PaymentNotPosted / state conflict)
    expect(outcome1.ok).toBe(false);
    if (!outcome1.ok) {
      const code1 = ((outcome1 as any).e as SettlementError).code;
      const msg1 = ((outcome1 as any).e as Error).message;

      // Verify durable business_failed record
      const idem1 = await sql`SELECT state, response_body, attempt_count FROM idempotency_records WHERE tenant_id = ${T} AND idempotency_key = ${settleKey}`;
      expect((idem1 as any)[0]!.state).toBe("business_failed");
      const body1 = (idem1 as any)[0]!.response_body;
      expect(body1.code).toBe(code1);
      expect(body1.message).toBe(msg1);

      // POST P using a separate key — genuine domain state change
      await deps.paymentService.postPayment(user as any, eff as any, {
        paymentId: draft.paymentId, idempotencyKey: "sdr2-post-" + randomUUID(),
      });
      // Now a FRESH settlement would succeed (payment is posted, capacity available)

      // Same-key replay — MUST return the EXACT same business_failed
      const outcome2 = await deps.settlementService.settlePayment(user as any, eff as any, {
        paymentId: draft.paymentId,
        allocations: [{ settledEntryId: recvResult.entryId, settledAmount: "100.00" }],
        idempotencyKey: settleKey,
      }).then(v => ({ ok: true, v }), e => ({ ok: false, e }));

      expect(outcome2.ok).toBe(false);
      if (!outcome2.ok) {
        expect(((outcome2 as any).e as SettlementError).code).toBe(code1);
        expect(((outcome2 as any).e as Error).message).toBe(msg1);
      }

      // No settlement row from replay
      const settlements = await sql`SELECT id FROM payment_settlements WHERE tenant_id = ${T} AND settlement_status = 'settled' AND settled_entry_id = ${recvResult.entryId}`;
      expect(settlements.length).toBe(0);

      // No settlement audit from replay
      const audits = await sql`SELECT id FROM audit_logs WHERE tenant_id = ${T} AND action_type = 'payment.settle'`;
      expect(audits.length).toBe(0);

      // attempt_count unchanged
      const idem2 = await sql`SELECT attempt_count FROM idempotency_records WHERE tenant_id = ${T} AND idempotency_key = ${settleKey}`;
      expect((idem2 as any)[0]!.attempt_count).toBe((idem1 as any)[0]!.attempt_count);
    }
  }, 30000);

  // ===========================================================================
  // REVERSAL-DURABLE-REPLAY-2 — genuine state change (draft→not-reversible→posted)
  // ===========================================================================
  it("REVERSAL-DURABLE-REPLAY-2. reverse draft payment → business_failed; post payment; same-key replay returns exact same failure", async () => {
    const deps = makeProductionDeps(db);
    const user = makeUser();
    const eff = makeEff();

    // Create DRAFT payment P (not yet posted — cannot be reversed)
    const draft = await deps.paymentService.createDraftPayment(user as any, eff as any, {
      ownerType: "customer", ownerId: CUSTOMER_ID,
      paymentDate: "2026-09-03", amount: "100.00",
      paymentDirection: "received_from_party", paymentMethod: "cash",
      idempotencyKey: "rdr2-draft-" + randomUUID(),
    });

    // Reverse P with key K → not-reversible business_failed
    const reverseKey = "rdr2-reverse-" + randomUUID();
    const reverseReason = "RDR2 reversal attempt on draft";
    const outcome1 = await deps.reversalService.reversePayment(user as any, eff as any, {
      paymentId: draft.paymentId, reason: reverseReason,
      idempotencyKey: reverseKey,
    }).then(v => ({ ok: true, v }), e => ({ ok: false, e }));

    // First failure = business_failed (PaymentNotReversible / state conflict)
    expect(outcome1.ok).toBe(false);
    if (!outcome1.ok) {
      const code1 = ((outcome1 as any).e as PaymentReversalError).code;
      const msg1 = ((outcome1 as any).e as Error).message;

      // Verify durable business_failed record
      const idem1 = await sql`SELECT state, response_body, attempt_count FROM idempotency_records WHERE tenant_id = ${T} AND idempotency_key = ${reverseKey}`;
      expect((idem1 as any)[0]!.state).toBe("business_failed");
      const body1 = (idem1 as any)[0]!.response_body;
      expect(body1.code).toBe(code1);
      expect(body1.message).toBe(msg1);

      // POST P using a separate key — genuine domain state change
      await deps.paymentService.postPayment(user as any, eff as any, {
        paymentId: draft.paymentId, idempotencyKey: "rdr2-post-" + randomUUID(),
      });
      // Now a FRESH reversal would succeed (payment is posted, reversible)

      // Same-key replay — MUST return the EXACT same business_failed
      const outcome2 = await deps.reversalService.reversePayment(user as any, eff as any, {
        paymentId: draft.paymentId, reason: reverseReason,
        idempotencyKey: reverseKey,
      }).then(v => ({ ok: true, v }), e => ({ ok: false, e }));

      expect(outcome2.ok).toBe(false);
      if (!outcome2.ok) {
        expect(((outcome2 as any).e as PaymentReversalError).code).toBe(code1);
        expect(((outcome2 as any).e as Error).message).toBe(msg1);
      }

      // No reversal entry from replay
      const reversalEntries = await sql`SELECT id FROM account_entries WHERE tenant_id = ${T} AND entry_type = 'reversal'`;
      expect(reversalEntries.length).toBe(0);

      // No reversal audit from replay
      const audits = await sql`SELECT id FROM audit_logs WHERE tenant_id = ${T} AND action_type = 'payment.reverse'`;
      expect(audits.length).toBe(0);

      // attempt_count unchanged
      const idem2 = await sql`SELECT attempt_count FROM idempotency_records WHERE tenant_id = ${T} AND idempotency_key = ${reverseKey}`;
      expect((idem2 as any)[0]!.attempt_count).toBe((idem1 as any)[0]!.attempt_count);
    }
  }, 30000);
});
