/**
 * WP-07-04 r27 — Deterministic service-vs-service PostgreSQL concurrency proofs.
 *
 * r26 used raw SQL "SELECT FOR UPDATE" as side A in several race tests — that
 * proved row-lock compliance but NOT real service-vs-service races. r27
 * replaces those with REAL SettlementService / PaymentReversalService on
 * BOTH sides, using test-dependency instrumentation around the tx-scoped
 * PaymentRepository to signal AFTER the real `lockPayment` acquires.
 *
 * Test identifiers:
 *   SETTLE-RACE-1-SVC             — two real SettlementService commands, deterministic barrier
 *   SETTLE-RACE-2A-SVC             — real Settlement A vs real Reversal B
 *   SETTLE-RACE-2B-SVC             — real Reversal A vs real Settlement B
 *   SETTLE-RACE-3-TARGET-SVC       — real target-lock contention (lockSettledEntry)
 *   LIVE-LIVE-SHARED-SUBLEDGER-SVC-DET — two real PaymentService posts, simultaneous SHARED
 *
 * Barrier pattern:
 *   A service starts → A acquires real lock → A barrier held
 *   → B service starts → B attempts same lock → B proven blocked OR B SHARED proven acquired
 *   → A released → final business state.
 *
 * No raw SQL transaction substitutes for a real service on side A.
 * No sleep is the sole proof of ordering.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/server/db/schema";
import { PaymentService } from "@/server/services/payment-service";
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
import type { PaymentRepository } from "@/server/services/payment-repository";
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
  await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status) VALUES (${T}, ${"R27-" + s}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${OWNER_ID}, ${T}, ${"r27-o-" + s}, ${"R27 Owner"}, ${"r27-o-" + s + "@test.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${ACCOUNTANT_ID}, ${T}, ${"r27-a-" + s}, ${"R27 Accountant"}, ${"r27-a-" + s + "@test.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO customers (id, tenant_id, customer_code, name_ar, normalized_name, status, created_by) VALUES (${CUSTOMER_ID}, ${T}, ${"CUST-" + s}, ${"R27 Customer"}, ${"r27-cust-" + s}, ${"active"}, ${OWNER_ID}) ON CONFLICT (id) DO NOTHING`;
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

/**
 * Barrier-wrapped PaymentDbRepository. After the real `lockPayment` acquires
 * the row lock (SELECT FOR UPDATE), the wrapper signals `lockAcquired` and
 * waits on `releaseBarrier` before returning. This lets the test verify B
 * is blocked while A genuinely holds the lock.
 *
 * For `lockSettledEntry`, the wrapper signals after the real advisory lock
 * acquires, enabling SETTLE-RACE-3-TARGET-SVC.
 */
class BarrierPaymentDbRepository extends PaymentDbRepository {
  constructor(
    txDb: any,
    private opts: {
      onLockPaymentAcquired?: () => void;
      waitForReleaseAfterLockPayment?: Promise<void>;
      onLockSettledEntryAcquired?: (entryId: string) => void;
      waitForReleaseAfterLockSettledEntry?: Promise<void>;
      onLockSettledEntryAttempted?: (entryId: string) => void;
    },
  ) {
    super(txDb);
  }

  override async lockPayment(tenantId: string, paymentId: string): Promise<any> {
    const result = await super.lockPayment(tenantId, paymentId);
    // Signal AFTER the real lock acquired (result returned means FOR UPDATE completed)
    if (result && this.opts.onLockPaymentAcquired) {
      this.opts.onLockPaymentAcquired();
    }
    // Wait for release barrier before returning (holds the lock)
    if (result && this.opts.waitForReleaseAfterLockPayment) {
      await this.opts.waitForReleaseAfterLockPayment;
    }
    return result;
  }

  override async lockSettledEntry(tenantId: string, entryId: string): Promise<void> {
    if (this.opts.onLockSettledEntryAttempted) {
      this.opts.onLockSettledEntryAttempted(entryId);
    }
    await super.lockSettledEntry(tenantId, entryId);
    // Signal AFTER the real advisory lock acquired
    if (this.opts.onLockSettledEntryAcquired) {
      this.opts.onLockSettledEntryAcquired(entryId);
    }
    // Wait for release barrier before returning (holds the lock)
    if (this.opts.waitForReleaseAfterLockSettledEntry) {
      await this.opts.waitForReleaseAfterLockSettledEntry;
    }
  }
}

/**
 * Build production-grade deps with optional barrier instrumentation on the
 * tx-scoped PaymentRepository. The barrier fires inside the REAL
 * SettlementService / PaymentReversalService transaction.
 */
function makeBarrierDeps(liveDb: any, barrierOpts?: {
  onLockPaymentAcquired?: () => void;
  waitForReleaseAfterLockPayment?: Promise<void>;
  onLockSettledEntryAcquired?: (entryId: string) => void;
  waitForReleaseAfterLockSettledEntry?: Promise<void>;
  onLockSettledEntryAttempted?: (entryId: string) => void;
}) {
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

  const createBarrierPaymentRepo = (tx: unknown) => {
    if (barrierOpts && (
      barrierOpts.onLockPaymentAcquired ||
      barrierOpts.waitForReleaseAfterLockPayment ||
      barrierOpts.onLockSettledEntryAcquired ||
      barrierOpts.waitForReleaseAfterLockSettledEntry ||
      barrierOpts.onLockSettledEntryAttempted
    )) {
      return new BarrierPaymentDbRepository(tx as any, barrierOpts);
    }
    return new PaymentDbRepository(tx as any);
  };

  const createSubledger = (tx: unknown) => new SubledgerService({
    subledger: new SubledgerDbRepository(tx as any),
    audit: new AuditDbRepository(tx as any),
    idempotency: new IdempotencyDbRepository(tx as any),
    documentSequence: new DocumentSequenceDbRepository(tx as any),
  });

  const paymentService = new PaymentService({
    paymentRepository: createBarrierPaymentRepo(liveDb) as PaymentRepository,
    subledger,
    audit, idempotency, documentSequence, ownerAuthority,
    transactionRunner,
    txFactories: {
      createSubledger,
      createPaymentRepository: createBarrierPaymentRepo,
      createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
      createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
      createDocumentSequence: (tx: unknown) => new DocumentSequenceDbRepository(tx as any),
    },
  });

  const reversalService = new PaymentReversalService({
    paymentRepository: createBarrierPaymentRepo(liveDb) as PaymentRepository,
    subledger,
    audit, idempotency, documentSequence,
    transactionRunner,
    txFactories: {
      createSubledger,
      createPaymentRepository: createBarrierPaymentRepo,
      createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
      createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
      createDocumentSequence: (tx: unknown) => new DocumentSequenceDbRepository(tx as any),
    },
  });

  const settlementService = new SettlementService({
    paymentRepository: createBarrierPaymentRepo(liveDb) as PaymentRepository,
    subledger,
    audit, idempotency,
    transactionRunner,
    txFactories: {
      createSubledger,
      createPaymentRepository: createBarrierPaymentRepo,
      createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
      createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
    },
  });

  return { paymentService, reversalService, settlementService, audit, idempotency, subledger };
}

function makeIndependentDb() {
  const indSql = postgres(DATABASE_URL!, { prepare: false, max: 1, idle_timeout: 30, connect_timeout: 15 });
  const indDb = drizzle(indSql, { schema });
  return { db: indDb, sql: indSql };
}

/**
 * Helper: setup a posted payment + target receivable for settlement tests.
 * Returns the paymentId, postedEntryId, and targetEntryId.
 */
async function setupPostedPaymentAndTarget(deps: ReturnType<typeof makeBarrierDeps>, user: any, eff: any, opts: {
  paymentAmount: string;
  targetAmount: string;
  idPrefix: string;
}): Promise<{ paymentId: string; postedEntryId: string; targetEntryId: string }> {
  const draft = await deps.paymentService.createDraftPayment(user as any, eff as any, {
    ownerType: "customer", ownerId: CUSTOMER_ID,
    paymentDate: "2026-09-03", amount: opts.paymentAmount,
    paymentDirection: "received_from_party", paymentMethod: "cash",
    idempotencyKey: `${opts.idPrefix}-draft-` + randomUUID(),
  });
  const postResult = await deps.paymentService.postPayment(user as any, eff as any, {
    paymentId: draft.paymentId, idempotencyKey: `${opts.idPrefix}-post-` + randomUUID(),
  });

  const recvResult = await deps.subledger.insertCustomerReceivableEntry(
    user as any, eff as any,
    {
      customerId: CUSTOMER_ID, saleId: randomUUID(),
      documentTotalPosted: opts.targetAmount, entryDate: "2026-09-03",
      docNo: `AE-${opts.idPrefix}-` + randomUUID().slice(0, 8),
      idempotencyKey: `${opts.idPrefix}-recv-` + randomUUID(),
    },
  );

  return { paymentId: draft.paymentId, postedEntryId: postResult.postedEntryId, targetEntryId: recvResult.entryId };
}

describeOrSkip("WP-07-04 r27 — Deterministic service-vs-service PG concurrency proofs", () => {
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
    // Set a statement_timeout so cleanup doesn't hang
    await sql`SET statement_timeout = 10000`;
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
    await sql`SET statement_timeout = 0`;
  }, 30000);

  // ===========================================================================
  // SETTLE-RACE-1-SVC — two real SettlementService commands, deterministic barrier
  // ===========================================================================
  it("SETTLE-RACE-1-SVC. A (real SettlementService) holds lockPayment; B (real SettlementService) blocked; release A; B business_fails", async () => {
    const deps = makeProductionDeps(db);
    const user = makeUser();
    const eff = makeEff();

    // Setup: posted payment P (capacity=100.00), target T (capacity=100.00)
    const { paymentId, targetEntryId } = await setupPostedPaymentAndTarget(deps, user, eff, {
      paymentAmount: "100.00", targetAmount: "100.00", idPrefix: "sr1-svc",
    });

    // Barrier for side A (real SettlementService)
    let aLockAcquired = false;
    let releaseA: () => void = () => {};
    const aReleasePromise = new Promise<void>(res => { releaseA = res; });

    const indA = makeIndependentDb();
    const depsA = makeBarrierDeps(indA.db, {
      onLockPaymentAcquired: () => { aLockAcquired = true; },
      waitForReleaseAfterLockPayment: aReleasePromise,
    });

    const keyA = "sr1-svc-a-" + randomUUID();

    // Start A: real SettlementService.settlePayment — will acquire lockPayment, signal, hold
    const aPromise = depsA.settlementService.settlePayment(user as any, eff as any, {
      paymentId,
      allocations: [{ settledEntryId: targetEntryId, settledAmount: "100.00" }],
      idempotencyKey: keyA,
    }).catch(e => e);

    // Wait for A to acquire the real lock
    for (let i = 0; i < 100; i++) {
      if (aLockAcquired) break;
      await new Promise(r => setTimeout(r, 30));
    }
    expect(aLockAcquired).toBe(true); // A genuinely holds the lock via real SettlementService

    // Start B: real SettlementService on independent connection
    const indB = makeIndependentDb();
    const depsB = makeBarrierDeps(indB.db);
    const keyB = "sr1-svc-b-" + randomUUID();

    let bLockAttempted = false;
    const bBarrierDeps = makeBarrierDeps(indB.db, {
      onLockPaymentAcquired: () => { bLockAttempted = true; },
    });
    // Replace depsB's settlementService with the barrier version
    const bPromise = bBarrierDeps.settlementService.settlePayment(user as any, eff as any, {
      paymentId,
      allocations: [{ settledEntryId: targetEntryId, settledAmount: "100.00" }],
      idempotencyKey: keyB,
    }).then(v => ({ ok: true, v }), e => ({ ok: false, e }));

    // B should be blocked on A's lock. Verify via timeout race.
    const bTimeout = new Promise<{ timedOut: true }>(res =>
      setTimeout(() => res({ timedOut: true }), 3000)
    );
    const bInitial = await Promise.race([bPromise, bTimeout]);
    expect((bInitial as any).timedOut).toBe(true); // B is genuinely blocked
    expect(bLockAttempted).toBe(false); // B has NOT passed lockPayment

    // Release A — A commits its settlement (consumes 100.00 of capacity)
    releaseA();
    const aResult = await aPromise;
    expect(aResult).toBeDefined();

    // B resumes — now target capacity is 0 (A consumed it). B must business_fail.
    const bFinal = await bPromise;
    expect(bFinal.ok).toBe(false);
    if (!bFinal.ok) {
      const code = ((bFinal as any).e as SettlementError).code;
      expect(code).toMatch(/OVER_SETTLEMENT|STATE_CONFLICT|VALIDATION_FAILED|incompatible|settled/i);
    }

    // Exactly one active settlement = "100.00" (A's settlement)
    const settlements = await sql`SELECT settlement_status, settled_amount FROM payment_settlements WHERE tenant_id = ${T} AND settlement_status = 'settled' AND settled_entry_id = ${targetEntryId}`;
    expect(settlements.length).toBe(1);
    expect((settlements as any)[0]!.settled_amount).toBe("100.00");

    // B has no settlement row
    const bSettlements = await sql`SELECT id FROM payment_settlements WHERE tenant_id = ${T} AND settlement_status = 'settled' AND payment_entry_id IN (SELECT posted_entry_id FROM payments WHERE id = ${paymentId})`;
    // Only A's settlement row exists (1, not 2)
    expect(bSettlements.length).toBe(1);

    // B has no success audit
    const bAudit = await sql`SELECT id FROM audit_logs WHERE tenant_id = ${T} AND action_type = 'payment.settle' AND new_values_json::text LIKE ${"%" + keyB + "%"}`;
    expect(bAudit.length).toBe(0);

    // B idempotency = business_failed
    const bIdem = await sql`SELECT state FROM idempotency_records WHERE tenant_id = ${T} AND idempotency_key = ${keyB}`;
    expect((bIdem as any)[0]!.state).toBe("business_failed");

    await indA.sql.end();
    await indB.sql.end();
  }, 30000);

  // ===========================================================================
  // SETTLE-RACE-2A-SVC — real Settlement A vs real Reversal B
  // ===========================================================================
  it("SETTLE-RACE-2A-SVC. Settlement A holds lockPayment; Reversal B blocked; release A; A commits; B reverses (unallocates A's settlement)", async () => {
    const deps = makeProductionDeps(db);
    const user = makeUser();
    const eff = makeEff();

    const { paymentId, targetEntryId } = await setupPostedPaymentAndTarget(deps, user, eff, {
      paymentAmount: "100.00", targetAmount: "100.00", idPrefix: "sr2a-svc",
    });

    // Barrier for side A (real SettlementService)
    let aLockAcquired = false;
    let releaseA: () => void = () => {};
    const aReleasePromise = new Promise<void>(res => { releaseA = res; });

    const indA = makeIndependentDb();
    const depsA = makeBarrierDeps(indA.db, {
      onLockPaymentAcquired: () => { aLockAcquired = true; },
      waitForReleaseAfterLockPayment: aReleasePromise,
    });

    const settleKey = "sr2a-svc-settle-" + randomUUID();

    // Start A: real SettlementService
    const aPromise = depsA.settlementService.settlePayment(user as any, eff as any, {
      paymentId,
      allocations: [{ settledEntryId: targetEntryId, settledAmount: "100.00" }],
      idempotencyKey: settleKey,
    }).catch(e => e);

    // Wait for A to acquire the real lock
    for (let i = 0; i < 100; i++) {
      if (aLockAcquired) break;
      await new Promise(r => setTimeout(r, 30));
    }
    expect(aLockAcquired).toBe(true);

    // Start B: real PaymentReversalService on independent connection
    const indB = makeIndependentDb();
    let bLockAttempted = false;
    const depsB = makeBarrierDeps(indB.db, {
      onLockPaymentAcquired: () => { bLockAttempted = true; },
    });
    const reverseKey = "sr2a-svc-reverse-" + randomUUID();

    const bPromise = depsB.reversalService.reversePayment(user as any, eff as any, {
      paymentId, reason: "SR2A-SVC reversal",
      idempotencyKey: reverseKey,
    }).then(v => ({ ok: true, v }), e => ({ ok: false, e }));

    // B should be blocked
    const bTimeout = new Promise<{ timedOut: true }>(res =>
      setTimeout(() => res({ timedOut: true }), 3000)
    );
    const bInitial = await Promise.race([bPromise, bTimeout]);
    expect((bInitial as any).timedOut).toBe(true); // Reversal B is blocked
    expect(bLockAttempted).toBe(false); // B has NOT passed lockPayment

    // Release A — A commits its settlement
    releaseA();
    await aPromise;

    // B resumes — sees authoritative state (payment posted, settlement active)
    // Reversal should succeed and unallocate A's settlement
    const bFinal = await bPromise;
    expect(bFinal.ok).toBe(true);
    if (bFinal.ok) {
      expect((bFinal as any).v.action).toBe("reversed");
    }

    // Final payment state: reversed
    const payment = await sql`SELECT status FROM payments WHERE id = ${paymentId}`;
    expect((payment as any)[0]!.status).toBe("reversed");

    // A's settlement should be reversed (unallocated) by B's reversal
    const activeSettlements = await sql`SELECT settlement_status FROM payment_settlements WHERE tenant_id = ${T} AND settlement_status = 'settled' AND settled_entry_id = ${targetEntryId}`;
    expect(activeSettlements.length).toBe(0); // A's settlement was reversed

    // Target capacity restored (settlement_status = unsettled)
    const target = await sql`SELECT settlement_status FROM account_entries WHERE id = ${targetEntryId}`;
    expect((target as any)[0]!.settlement_status).toBe("unsettled");

    await indA.sql.end();
    await indB.sql.end();
  }, 30000);

  // ===========================================================================
  // SETTLE-RACE-2B-SVC — real Reversal A vs real Settlement B
  // ===========================================================================
  it("SETTLE-RACE-2B-SVC. Reversal A holds lockPayment; Settlement B blocked; release A; A commits reversal; B business_fails", async () => {
    const deps = makeProductionDeps(db);
    const user = makeUser();
    const eff = makeEff();

    const { paymentId, targetEntryId } = await setupPostedPaymentAndTarget(deps, user, eff, {
      paymentAmount: "100.00", targetAmount: "100.00", idPrefix: "sr2b-svc",
    });

    // Barrier for side A (real PaymentReversalService)
    let aLockAcquired = false;
    let releaseA: () => void = () => {};
    const aReleasePromise = new Promise<void>(res => { releaseA = res; });

    const indA = makeIndependentDb();
    const depsA = makeBarrierDeps(indA.db, {
      onLockPaymentAcquired: () => { aLockAcquired = true; },
      waitForReleaseAfterLockPayment: aReleasePromise,
    });

    const reverseKey = "sr2b-svc-reverse-" + randomUUID();

    // Start A: real PaymentReversalService
    const aPromise = depsA.reversalService.reversePayment(user as any, eff as any, {
      paymentId, reason: "SR2B-SVC reversal first",
      idempotencyKey: reverseKey,
    }).catch(e => e);

    // Wait for A to acquire the real lock
    for (let i = 0; i < 100; i++) {
      if (aLockAcquired) break;
      await new Promise(r => setTimeout(r, 30));
    }
    expect(aLockAcquired).toBe(true);

    // Start B: real SettlementService on independent connection
    const indB = makeIndependentDb();
    let bLockAttempted = false;
    const depsB = makeBarrierDeps(indB.db, {
      onLockPaymentAcquired: () => { bLockAttempted = true; },
    });
    const settleKey = "sr2b-svc-settle-" + randomUUID();

    const bPromise = depsB.settlementService.settlePayment(user as any, eff as any, {
      paymentId,
      allocations: [{ settledEntryId: targetEntryId, settledAmount: "100.00" }],
      idempotencyKey: settleKey,
    }).then(v => ({ ok: true, v }), e => ({ ok: false, e }));

    // B should be blocked
    const bTimeout = new Promise<{ timedOut: true }>(res =>
      setTimeout(() => res({ timedOut: true }), 3000)
    );
    const bInitial = await Promise.race([bPromise, bTimeout]);
    expect((bInitial as any).timedOut).toBe(true); // Settlement B is blocked
    expect(bLockAttempted).toBe(false); // B has NOT passed lockPayment

    // Release A — A commits reversal
    releaseA();
    await aPromise;

    // B resumes — sees payment reversed → business_failed
    const bFinal = await bPromise;
    expect(bFinal.ok).toBe(false);
    if (!bFinal.ok) {
      const code = ((bFinal as any).e as SettlementError).code;
      expect(code).toMatch(/STATE_CONFLICT|VALIDATION_FAILED|reversed/i);
    }

    // No settlement row inserted by B
    const settlements = await sql`SELECT id FROM payment_settlements WHERE tenant_id = ${T} AND settlement_status = 'settled'`;
    expect(settlements.length).toBe(0);

    // No settlement success audit
    const settleAudit = await sql`SELECT id FROM audit_logs WHERE tenant_id = ${T} AND action_type = 'payment.settle'`;
    expect(settleAudit.length).toBe(0);

    // B idempotency = business_failed
    const bIdem = await sql`SELECT state FROM idempotency_records WHERE tenant_id = ${T} AND idempotency_key = ${settleKey}`;
    expect((bIdem as any)[0]!.state).toBe("business_failed");

    // Final payment state: reversed
    const payment = await sql`SELECT status FROM payments WHERE id = ${paymentId}`;
    expect((payment as any)[0]!.status).toBe("reversed");

    await indA.sql.end();
    await indB.sql.end();
  }, 30000);

  // ===========================================================================
  // SETTLE-RACE-3-TARGET-SVC — real target-lock contention
  // ===========================================================================
  it("SETTLE-RACE-3-TARGET-SVC. Reversal A holds lockSettledEntry(T); Settlement B blocked on T; release A; B settles freed capacity", async () => {
    const deps = makeProductionDeps(db);
    const user = makeUser();
    const eff = makeEff();

    // Setup P1 and P2 (both 100.00)
    const p1 = await setupPostedPaymentAndTarget(deps, user, eff, {
      paymentAmount: "100.00", targetAmount: "100.00", idPrefix: "sr3-p1",
    });
    const p2 = await setupPostedPaymentAndTarget(deps, user, eff, {
      paymentAmount: "100.00", targetAmount: "100.00", idPrefix: "sr3-p2",
    });
    // Note: p1 and p2 have DIFFERENT target entries. For this test we need
    // P1 and P2 to settle the SAME target T. So we create one target and
    // use it for both. Let's create a shared target:
    const sharedTarget = await deps.subledger.insertCustomerReceivableEntry(
      user as any, eff as any,
      {
        customerId: CUSTOMER_ID, saleId: randomUUID(),
        documentTotalPosted: "100.00", entryDate: "2026-09-03",
        docNo: "AE-SR3-SHARED-" + randomUUID().slice(0, 8),
        idempotencyKey: "sr3-shared-recv-" + randomUUID(),
      },
    );

    // P1 settles shared target T fully (100.00)
    await deps.settlementService.settlePayment(user as any, eff as any, {
      paymentId: p1.paymentId,
      allocations: [{ settledEntryId: sharedTarget.entryId, settledAmount: "100.00" }],
      idempotencyKey: "sr3-p1-settle-" + randomUUID(),
    });

    // Barrier for side A (real PaymentReversalService) on lockSettledEntry
    let aTargetLockAcquired = false;
    let releaseA: () => void = () => {};
    const aReleasePromise = new Promise<void>(res => { releaseA = res; });

    const indA = makeIndependentDb();
    const depsA = makeBarrierDeps(indA.db, {
      onLockSettledEntryAcquired: (_entryId: string) => { aTargetLockAcquired = true; },
      waitForReleaseAfterLockSettledEntry: aReleasePromise,
    });

    const reverseKey = "sr3-target-reverse-" + randomUUID();

    // Start A: real PaymentReversalService for P1 — will lock payment, then
    // lockSettledEntry(T), signal, hold.
    const aPromise = depsA.reversalService.reversePayment(user as any, eff as any, {
      paymentId: p1.paymentId, reason: "SR3-TARGET reversal",
      idempotencyKey: reverseKey,
    }).catch(e => e);

    // Wait for A to acquire the target lock
    for (let i = 0; i < 150; i++) {
      if (aTargetLockAcquired) break;
      await new Promise(r => setTimeout(r, 30));
    }
    expect(aTargetLockAcquired).toBe(true); // A genuinely holds lockSettledEntry(T)

    // Start B: real SettlementService for P2 against same target T
    const indB = makeIndependentDb();
    let bTargetLockAttempted = false;
    const depsB = makeBarrierDeps(indB.db, {
      onLockSettledEntryAttempted: (_entryId: string) => { bTargetLockAttempted = true; },
    });
    const settleKey = "sr3-target-settle-" + randomUUID();

    const bPromise = depsB.settlementService.settlePayment(user as any, eff as any, {
      paymentId: p2.paymentId,
      allocations: [{ settledEntryId: sharedTarget.entryId, settledAmount: "100.00" }],
      idempotencyKey: settleKey,
    }).then(v => ({ ok: true, v }), e => ({ ok: false, e }));

    // B should be blocked on the target lock
    const bTimeout = new Promise<{ timedOut: true }>(res =>
      setTimeout(() => res({ timedOut: true }), 5000)
    );
    const bInitial = await Promise.race([bPromise, bTimeout]);
    expect((bInitial as any).timedOut).toBe(true); // B is blocked on target lock
    expect(bTargetLockAttempted).toBe(true); // B attempted lockSettledEntry

    // Release A — A commits reversal, frees target capacity
    releaseA();
    await aPromise;

    // B resumes — target capacity is now 100.00 (P1's settlement reversed)
    const bFinal = await bPromise;
    expect(bFinal.ok).toBe(true);
    if (bFinal.ok) {
      expect((bFinal as any).v.action).toBe("settled");
      // Exact settled amount as decimal string
      expect((bFinal as any).v.totalSettled).toBe("100.00");
    }

    // Final active settlement rows for T = P2 only (P1's was reversed)
    const activeSettlements = await sql`SELECT settled_amount FROM payment_settlements WHERE tenant_id = ${T} AND settled_entry_id = ${sharedTarget.entryId} AND settlement_status = 'settled'`;
    expect(activeSettlements.length).toBe(1);
    expect((activeSettlements as any)[0]!.settled_amount).toBe("100.00");

    // Target settlementStatus = settled (P2 fully settled it)
    const target = await sql`SELECT settlement_status FROM account_entries WHERE id = ${sharedTarget.entryId}`;
    expect((target as any)[0]!.settlement_status).toBe("settled");

    // No over-settlement: exact total = "100.00" via BigInt cents
    let totalCents = 0n;
    for (const s of activeSettlements as any[]) {
      const [intPart, fracPart] = s.settled_amount.split(".");
      totalCents += BigInt(intPart) * 100n + BigInt(fracPart);
    }
    expect(totalCents).toBe(10000n); // exactly 100.00

    await indA.sql.end();
    await indB.sql.end();
  }, 45000);

  // ===========================================================================
  // LIVE-LIVE-SHARED-SUBLEDGER-SVC-DET — two real SubledgerService.postPaymentEntry, simultaneous SHARED
  // ===========================================================================
  it("LIVE-LIVE-SHARED-SUBLEDGER-SVC-DET. A (real SubledgerService.postPaymentEntry) holds SHARED cutover; B acquires SHARED while A holds; both succeed", async () => {
    const deps = makeProductionDeps(db);
    const user = makeUser();
    const eff = makeEff();

    // Create two draft payments (to get accounts + payment IDs for sourceDocumentId)
    const p1Draft = await deps.paymentService.createDraftPayment(user as any, eff as any, {
      ownerType: "customer", ownerId: CUSTOMER_ID,
      paymentDate: "2026-09-03", amount: "100.00",
      paymentDirection: "received_from_party", paymentMethod: "cash",
      idempotencyKey: "llss-det-draft-1-" + randomUUID(),
    });
    const p2Draft = await deps.paymentService.createDraftPayment(user as any, eff as any, {
      ownerType: "customer", ownerId: CUSTOMER_ID,
      paymentDate: "2026-09-03", amount: "100.00",
      paymentDirection: "received_from_party", paymentMethod: "cash",
      idempotencyKey: "llss-det-draft-2-" + randomUUID(),
    });

    // Get the account ID (shared between P1 and P2 since same owner+currency)
    const p1Row = await sql`SELECT account_id FROM payments WHERE id = ${p1Draft.paymentId}`;
    const accountId = (p1Row as any)[0]!.account_id;

    // Barrier for side A: wrap the tx-scoped SubledgerService.requireCutoverLock
    let aSharedAcquired = false;
    let releaseA: () => void = () => {};
    const aReleasePromise = new Promise<void>(res => { releaseA = res; });

    const indA = makeIndependentDb();
    let aBarrierFired = false;

    // A uses a real SubledgerService inside a real transaction
    const aTransactionRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
      (indA.db as any).transaction(async (tx: any) => {
        // Create tx-scoped subledger with barrier wrapper on requireCutoverLock
        const txSubledger = new SubledgerService({
          subledger: new SubledgerDbRepository(tx as any),
          audit: new AuditDbRepository(tx as any),
          idempotency: new IdempotencyDbRepository(tx as any),
          documentSequence: new DocumentSequenceDbRepository(tx as any),
        });
        const realRequireCutoverLock = txSubledger.requireCutoverLock.bind(txSubledger);
        (txSubledger as any).requireCutoverLock = async (tenantId: string) => {
          await realRequireCutoverLock(tenantId);
          if (!aBarrierFired) {
            aBarrierFired = true;
            aSharedAcquired = true;
            await aReleasePromise;
          }
        };
        return work(txSubledger);
      });

    // Start A: real SubledgerService.postPaymentEntry inside a real transaction.
    // This acquires SHARED cutover lock, signals, holds.
    const aPromise = aTransactionRunner(async (txSubledger: any) => {
      return txSubledger.postPaymentEntry(user as any, eff as any, {
        ownerType: "customer",
        ownerId: CUSTOMER_ID,
        accountId,
        amountSigned: "-100.00",
        entryDate: "2026-09-03",
        entryType: "customer_payment",
        paymentId: p1Draft.paymentId,
        docNo: "AE-LLSS-A-" + randomUUID().slice(0, 8),
        idempotencyKey: "llss-det-entry-1-" + randomUUID(),
      });
    }).then(v => ({ ok: true, v }), e => ({ ok: false, e }));

    // Wait for A to acquire the SHARED lock
    for (let i = 0; i < 200; i++) {
      if (aSharedAcquired) break;
      await new Promise(r => setTimeout(r, 50));
    }
    expect(aSharedAcquired).toBe(true); // A genuinely holds SHARED cutover lock

    // Start B: real SubledgerService.postPaymentEntry on independent connection.
    // B acquires SHARED — must NOT block on A's SHARED.
    const indB = makeIndependentDb();
    let bSharedAcquired = false;
    let bBarrierFired = false;

    const bTransactionRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
      (indB.db as any).transaction(async (tx: any) => {
        const txSubledger = new SubledgerService({
          subledger: new SubledgerDbRepository(tx as any),
          audit: new AuditDbRepository(tx as any),
          idempotency: new IdempotencyDbRepository(tx as any),
          documentSequence: new DocumentSequenceDbRepository(tx as any),
        });
        const realRequireCutoverLock = txSubledger.requireCutoverLock.bind(txSubledger);
        (txSubledger as any).requireCutoverLock = async (tenantId: string) => {
          await realRequireCutoverLock(tenantId);
          if (!bBarrierFired) {
            bBarrierFired = true;
            bSharedAcquired = true;
          }
        };
        return work(txSubledger);
      });

    const bPromise = bTransactionRunner(async (txSubledger: any) => {
      return txSubledger.postPaymentEntry(user as any, eff as any, {
        ownerType: "customer",
        ownerId: CUSTOMER_ID,
        accountId,
        amountSigned: "-100.00",
        entryDate: "2026-09-03",
        entryType: "customer_payment",
        paymentId: p2Draft.paymentId,
        docNo: "AE-LLSS-B-" + randomUUID().slice(0, 8),
        idempotencyKey: "llss-det-entry-2-" + randomUUID(),
      });
    }).then(v => ({ ok: true, v }), e => ({ ok: false, e }));

    // B should acquire SHARED quickly (SHARED coexists). 10s timeout.
    const bTimeout = new Promise<{ timedOut: true }>(res =>
      setTimeout(() => res({ timedOut: true }), 10000)
    );
    const bResult = await Promise.race([bPromise, bTimeout]);

    // B must have acquired SHARED while A still holds it
    expect(bSharedAcquired).toBe(true); // B acquired SHARED while A held it
    expect((bResult as any).timedOut).toBeUndefined();

    // Release A
    releaseA();
    const aFinal = await aPromise;
    expect(aFinal.ok).toBe(true);

    // Both entries succeed
    const bFinal = await bPromise;
    expect(bFinal.ok).toBe(true);

    // Exactly two account entries (one per payment)
    const entries = await sql`SELECT id FROM account_entries WHERE tenant_id = ${T} AND source_document_type = 'payment'`;
    expect(entries.length).toBe(2);

    await indA.sql.end();
    await indB.sql.end();
  }, 60000);
});

// Helper needed by setupPostedPaymentAndTarget — uses the main db's deps
function makeProductionDeps(liveDb: any) {
  return makeBarrierDeps(liveDb);
}
