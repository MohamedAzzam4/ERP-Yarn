/**
 * WP-07-04 r18 — Payment/Reversal/Settlement non-PG functional tests.
 *
 * Tests:
 *   SETTLE-DUP-1 — duplicate settledEntryId rejected before idempotency
 *   REV-UNALLOC-1 — fully settled by one payment → reverse → target unsettled
 *   REV-UNALLOC-2 — multiple payments → reverse one → partial remains
 *   REV-UNALLOC-3 — multiple targets → reverse → all recomputed
 *   REV-TRANSITION-FAIL — reverseSettlement returns null → entire reversal aborts
 *   DECIMAL-1 — 0.30 minus 0.10 = exactly "0.20"
 *   DECIMAL-2 — 10.00 minus 9.99 = exactly "0.01"
 *   FAIL-CLOSED-PAYMENT — no tx composition → CONFIGURATION_ERROR, zero effects
 *   FAIL-CLOSED-REVERSAL — same
 *   FAIL-CLOSED-SETTLEMENT — same
 *   FAIL-CLOSED-DIRECTCOST — same
 */
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { PaymentService, PaymentError } from "@/server/services/payment-service";
import { PaymentReversalService, PaymentReversalError } from "@/server/services/payment-reversal-service";
import { SettlementService } from "@/server/services/settlement-service";
import { DirectCostService, DirectCostError } from "@/server/services/direct-cost-service";
import { SubledgerService } from "@/server/services/subledger-service";
import { resolveEffectivePermissions } from "@/server/security/effective-permissions";
import { TEST_ROLE_PERMISSION_MATRIX } from "@/server/security/role-fixtures";
import type { ErpUserContext } from "@/server/auth/erp-context";
import {
  InMemoryPaymentRepository,
} from "./in-memory-payment-repository";
import { InMemorySubledgerRepository } from "./in-memory-subledger-repository";
import { InProcessAuditStore } from "@/server/services/audit-service";
import { InProcessIdempotencyStore } from "@/server/services/idempotency-service";
import { InProcessDocumentSequenceStore } from "@/server/services/document-sequence-service";
import { InMemoryOwnerAuthorityLookup } from "@/server/services/owner-authority-lookup";
import { SettlementError } from "@/server/services/settlement-service";
import { normalizeMoney, subtractMoney, absMoney, compareMoney } from "@/server/services/decimal-money";

function makeUser(tenantId: string): ErpUserContext {
  return {
    authenticated: true, userId: randomUUID(), tenantId,
    authId: `auth-${tenantId}`, name: "Test", email: `test-${tenantId}@test.local`,
  };
}
function makeEffective() {
  return resolveEffectivePermissions(["owner"], TEST_ROLE_PERMISSION_MATRIX);
}

// In-memory subledger repo that also tracks calls
class TrackingSubledgerRepo extends InMemorySubledgerRepository {
  findEntryByIdCalls: string[] = [];
  updateEntrySettlementStatusCalls: { entryId: string; status: string }[] = [];
  override async findEntryById(tenantId: string, entryId: string) {
    this.findEntryByIdCalls.push(entryId);
    return super.findEntryById(tenantId, entryId);
  }
}

// Local copy of subtractAbs (same as settlement-service)
function localSubtractAbs(a: string, b: string): string {
  const absA = absMoney(a);
  if (compareMoney(absA, b) >= 0) {
    return subtractMoney(absA, b);
  }
  return "0.00";
}

function makeDeps(tenantId: string) {
  const paymentRepo = new InMemoryPaymentRepository();
  const subledgerRepo = new TrackingSubledgerRepo();
  const audit = new InProcessAuditStore();
  const idempotency = new InProcessIdempotencyStore();
  const documentSequence = new InProcessDocumentSequenceStore();
  const subledger = new SubledgerService({ subledger: subledgerRepo, audit, idempotency, documentSequence });
  const noopTxRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => work(null);
  // r24 BLOCKER C: in-memory owner authority seeded per-test on demand.
  const ownerAuthority = new InMemoryOwnerAuthorityLookup();

  const paymentService = new PaymentService({
    paymentRepository: paymentRepo, subledger, audit, idempotency, documentSequence,
    ownerAuthority,
    transactionRunner: noopTxRunner,
    txFactories: {
      createSubledger: () => subledger,
      createPaymentRepository: () => paymentRepo,
      createAudit: () => audit,
      createIdempotency: () => idempotency,
      createDocumentSequence: () => documentSequence,
    },
  });
  const reversalService = new PaymentReversalService({
    paymentRepository: paymentRepo, subledger, audit, idempotency, documentSequence,
    transactionRunner: noopTxRunner,
    txFactories: {
      createSubledger: () => subledger,
      createPaymentRepository: () => paymentRepo,
      createAudit: () => audit,
      createIdempotency: () => idempotency,
      createDocumentSequence: () => documentSequence,
    },
  });
  const settlementService = new SettlementService({
    paymentRepository: paymentRepo, subledger, audit, idempotency,
    transactionRunner: noopTxRunner,
    txFactories: {
      createSubledger: () => subledger,
      createPaymentRepository: () => paymentRepo,
      createAudit: () => audit,
      createIdempotency: () => idempotency,
    },
  });
  return { paymentRepo, subledgerRepo, audit, idempotency, documentSequence, subledger,
    paymentService, reversalService, settlementService, ownerAuthority };
}

describe("WP-07-04 r18 — Payment/Reversal/Settlement non-PG tests", () => {

  // =========================================================================
  // SETTLE-DUP-1 — duplicate settledEntryId rejected
  // =========================================================================
  it("SETTLE-DUP-1. duplicate settledEntryId in one request → VALIDATION_FAILED before idempotency", async () => {
    const T = randomUUID();
    const deps = makeDeps(T);
    const user = makeUser(T);
    const eff = makeEffective();

    const outcome = await deps.settlementService.settlePayment(
      user as any, eff as any,
      {
        paymentId: randomUUID(),
        idempotencyKey: "dup-" + randomUUID(),
        allocations: [
          { settledEntryId: "target-1", settledAmount: "60.00" },
          { settledEntryId: "target-1", settledAmount: "60.00" },
        ],
      },
    ).then(v => ({ ok: true, v }), e => ({ ok: false, e }));

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(((outcome as any).e as Error).message).toMatch(/Duplicate settledEntryId/i);
    }
    // Verify idempotency was NOT claimed (input-shape validation before claim)
    expect(deps.idempotency["records"].size).toBe(0);
  });

  // =========================================================================
  // DECIMAL-1 — 0.30 minus 0.10 = exactly "0.20"
  // =========================================================================
  it("DECIMAL-1. localSubtractAbs(0.30, 0.10) === '0.20'", () => {
    const result = localSubtractAbs("0.30", "0.10");
    expect(result).toBe("0.20");
  });

  // =========================================================================
  // DECIMAL-2 — 10.00 minus 9.99 = exactly "0.01"
  // =========================================================================
  it("DECIMAL-2. localSubtractAbs(10.00, 9.99) === '0.01'", () => {
    const result = localSubtractAbs("10.00", "9.99");
    expect(result).toBe("0.01");
  });

  // =========================================================================
  // FAIL-CLOSED tests — no tx composition → CONFIGURATION_ERROR
  // =========================================================================
  it("FAIL-CLOSED-PAYMENT. PaymentService without tx → CONFIGURATION_ERROR, zero effects", async () => {
    const T = randomUUID();
    const paymentRepo = new InMemoryPaymentRepository();
    const audit = new InProcessAuditStore();
    const idempotency = new InProcessIdempotencyStore();
    const documentSequence = new InProcessDocumentSequenceStore();
    const subledger = new SubledgerService({
      subledger: new InMemorySubledgerRepository(), audit, idempotency, documentSequence,
    });
    const service = new PaymentService({
      paymentRepository: paymentRepo, subledger, audit, idempotency, documentSequence,
      ownerAuthority: new InMemoryOwnerAuthorityLookup(),
      // NO transactionRunner, NO txFactories
    });

    const outcome = await service.postPayment(
      makeUser(T) as any, makeEffective() as any,
      { paymentId: randomUUID(), idempotencyKey: "fc-" + randomUUID() },
    ).then(v => ({ ok: true, v }), e => ({ ok: false, e }));

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(((outcome as any).e as PaymentError).code).toBe("CONFIGURATION_ERROR");
    }
    expect(idempotency["records"].size).toBe(0);
    expect(paymentRepo.lockCalls.length).toBe(0);
  });

  it("FAIL-CLOSED-REVERSAL. PaymentReversalService without tx → CONFIGURATION_ERROR, zero effects", async () => {
    const T = randomUUID();
    const paymentRepo = new InMemoryPaymentRepository();
    const audit = new InProcessAuditStore();
    const idempotency = new InProcessIdempotencyStore();
    const documentSequence = new InProcessDocumentSequenceStore();
    const subledger = new SubledgerService({
      subledger: new InMemorySubledgerRepository(), audit, idempotency, documentSequence,
    });
    const service = new PaymentReversalService({
      paymentRepository: paymentRepo, subledger, audit, idempotency, documentSequence,
    });

    const outcome = await service.reversePayment(
      makeUser(T) as any, makeEffective() as any,
      { paymentId: randomUUID(), idempotencyKey: "fc-" + randomUUID(), reason: "test" },
    ).then(v => ({ ok: true, v }), e => ({ ok: false, e }));

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(((outcome as any).e as PaymentReversalError).code).toBe("CONFIGURATION_ERROR");
    }
    expect(idempotency["records"].size).toBe(0);
    expect(paymentRepo.lockCalls.length).toBe(0);
  });

  it("FAIL-CLOSED-SETTLEMENT. SettlementService without tx → CONFIGURATION_ERROR, zero effects", async () => {
    const T = randomUUID();
    const paymentRepo = new InMemoryPaymentRepository();
    const audit = new InProcessAuditStore();
    const idempotency = new InProcessIdempotencyStore();
    const subledger = new SubledgerService({
      subledger: new InMemorySubledgerRepository(), audit, idempotency,
      documentSequence: new InProcessDocumentSequenceStore(),
    });
    const service = new SettlementService({
      paymentRepository: paymentRepo, subledger, audit, idempotency,
    });

    const outcome = await service.settlePayment(
      makeUser(T) as any, makeEffective() as any,
      {
        paymentId: randomUUID(),
        idempotencyKey: "fc-" + randomUUID(),
        allocations: [{ settledEntryId: "target-1", settledAmount: "10.00" }],
      },
    ).then(v => ({ ok: true, v }), e => ({ ok: false, e }));

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(((outcome as any).e as SettlementError).code).toBe("CONFIGURATION_ERROR");
    }
    expect(idempotency["records"].size).toBe(0);
    expect(paymentRepo.lockCalls.length).toBe(0);
  });

  it("FAIL-CLOSED-DIRECTCOST. DirectCostService without tx → CONFIGURATION_ERROR, zero effects", async () => {
    // DirectCostService needs ProfitabilitySnapshotService — use minimal mock
    const T = randomUUID();
    const audit = new InProcessAuditStore();
    const idempotency = new InProcessIdempotencyStore();
    const documentSequence = new InProcessDocumentSequenceStore();
    const subledger = new SubledgerService({
      subledger: new InMemorySubledgerRepository(), audit, idempotency, documentSequence,
    });

    // Minimal direct cost repo mock
    const directCostRepo = {
      findDirectCostById: async () => null,
      lockDirectCost: async () => {},
      insertDirectCost: async () => ({}),
      updateDirectCostReview: async () => null,
      insertAllocation: async () => ({}),
      listApprovedIncludedDirectCosts: async () => [],
    } as any;

    const snapshotService = { createLaterSnapshot: async () => ({ snapshotId: "x", version: 1 }) } as any;

    const service = new DirectCostService({
      directCostRepository: directCostRepo, subledger, snapshotService, audit, idempotency, documentSequence,
    });

    const outcome = await service.reviewDirectCost(
      makeUser(T) as any, makeEffective() as any,
      {
        directCostId: randomUUID(),
        amount: "100.00",
        costResponsibilityType: "company",
        actualPayerType: "company",
        includedInProfitability: false,
        idempotencyKey: "fc-" + randomUUID(),
      },
    ).then(v => ({ ok: true, v }), e => ({ ok: false, e }));

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(((outcome as any).e as DirectCostError).code).toBe("CONFIGURATION_ERROR");
    }
    expect(idempotency["records"].size).toBe(0);
  });

  // =========================================================================
  // REV-UNALLOC-1 — fully settled by one payment → reverse → unsettled
  // =========================================================================
  it("REV-UNALLOC-1. fully settled by P1 → reverse P1 → target unsettled", async () => {
    const T = randomUUID();
    const deps = makeDeps(T);
    const user = makeUser(T);
    const eff = makeEffective();

    // Create accounts + entries
    const accountId = randomUUID();
    const targetEntry = await deps.subledger["deps"].subledger.insertEntry({
      tenantId: T, accountId, entryNo: "T-001", entryDate: "2024-01-01",
      amountSigned: "100.00", currency: "EGP", entryType: "customer_sale_receivable",
      sourceDocumentType: "sale", sourceDocumentId: randomUUID(), createdBy: user.userId,
    });

    // Create posted payment — with a SEPARATE payment entry (not the target entry)
    const paymentId = randomUUID();
    const paymentEntry = await deps.subledger["deps"].subledger.insertEntry({
      tenantId: T, accountId, entryNo: "P-E-001", entryDate: "2024-01-01",
      amountSigned: "-100.00", currency: "EGP", entryType: "customer_payment",
      sourceDocumentType: "payment", sourceDocumentId: paymentId, createdBy: user.userId,
    });
    (deps.paymentRepo as any).seedPayment({
      id: paymentId, tenantId: T, paymentNo: "P-001",
      paymentDirection: "received_from_party", paymentMethod: "cash",
      accountId, amount: "100.00", paymentDate: "2024-01-01",
      status: "posted", postedEntryId: paymentEntry.id,
      idempotencyKey: "seed-" + paymentId, createdBy: user.userId,
    });

    // Settle
    await deps.settlementService.settlePayment(user as any, eff as any, {
      paymentId, idempotencyKey: "settle-" + randomUUID(),
      allocations: [{ settledEntryId: targetEntry.id, settledAmount: "100.00" }],
    });

    // Verify target settled
    const targetAfterSettle = await deps.subledger["deps"].subledger.findEntryById(T, targetEntry.id);
    expect(targetAfterSettle!.settlementStatus).toBe("settled");

    // Reverse
    await deps.reversalService.reversePayment(user as any, eff as any, {
      paymentId, idempotencyKey: "reverse-" + randomUUID(), reason: "test reversal",
    });

    // Verify original settlement row still exists but status=reversed
    const settlements = await deps.paymentRepo.listSettlementsForSettledEntry(T, targetEntry.id);
    expect(settlements.length).toBeGreaterThanOrEqual(1);
    const originalSettlement = settlements.find(s => s.settlementStatus === "reversed" && s.settledEntryId === targetEntry.id);
    expect(originalSettlement).toBeDefined();
    expect(originalSettlement!.settledAmount).toBe("100.00"); // financial fields unchanged

    // Verify target is unsettled
    const targetAfterReverse = await deps.subledger["deps"].subledger.findEntryById(T, targetEntry.id);
    expect(targetAfterReverse!.settlementStatus).toBe("unsettled");

    // Verify payment entry is reversed
    const payment = await deps.paymentRepo.findPaymentById(T, paymentId);
    expect(payment!.status).toBe("reversed");
  });

  // =========================================================================
  // REV-UNALLOC-2 — multiple payments → reverse one → partial remains
  // =========================================================================
  it("REV-UNALLOC-2. P1=40, P2=60 → reverse P1 → partial_settled, remaining=60", async () => {
    const T = randomUUID();
    const deps = makeDeps(T);
    const user = makeUser(T);
    const eff = makeEffective();

    const accountId = randomUUID();
    const targetEntry = await deps.subledger["deps"].subledger.insertEntry({
      tenantId: T, accountId, entryNo: "T-002", entryDate: "2024-01-01",
      amountSigned: "100.00", currency: "EGP", entryType: "customer_sale_receivable",
      sourceDocumentType: "sale", sourceDocumentId: randomUUID(), createdBy: user.userId,
    });

    // Create two posted payments
    const p1Id = randomUUID();
    const p1Entry = await deps.subledger["deps"].subledger.insertEntry({
      tenantId: T, accountId, entryNo: "P1-E", entryDate: "2024-01-01",
      amountSigned: "-40.00", currency: "EGP", entryType: "customer_payment",
      sourceDocumentType: "payment", sourceDocumentId: p1Id, createdBy: user.userId,
    });
    (deps.paymentRepo as any).seedPayment({
      id: p1Id, tenantId: T, paymentNo: "P1",
      paymentDirection: "received_from_party", paymentMethod: "cash",
      accountId, amount: "40.00", paymentDate: "2024-01-01",
      status: "posted", postedEntryId: p1Entry.id,
      idempotencyKey: "seed-" + p1Id, createdBy: user.userId,
    });
    const p2Id = randomUUID();
    const p2Entry = await deps.subledger["deps"].subledger.insertEntry({
      tenantId: T, accountId, entryNo: "P2-E", entryDate: "2024-01-01",
      amountSigned: "-60.00", currency: "EGP", entryType: "customer_payment",
      sourceDocumentType: "payment", sourceDocumentId: p2Id, createdBy: user.userId,
    });
    (deps.paymentRepo as any).seedPayment({
      id: p2Id, tenantId: T, paymentNo: "P2",
      paymentDirection: "received_from_party", paymentMethod: "cash",
      accountId, amount: "60.00", paymentDate: "2024-01-01",
      status: "posted", postedEntryId: p2Entry.id,
      idempotencyKey: "seed-" + p2Id, createdBy: user.userId,
    });

    // Settle both
    await deps.settlementService.settlePayment(user as any, eff as any, {
      paymentId: p1Id, idempotencyKey: "s1-" + randomUUID(),
      allocations: [{ settledEntryId: targetEntry.id, settledAmount: "40.00" }],
    });
    await deps.settlementService.settlePayment(user as any, eff as any, {
      paymentId: p2Id, idempotencyKey: "s2-" + randomUUID(),
      allocations: [{ settledEntryId: targetEntry.id, settledAmount: "60.00" }],
    });

    // Target should be settled
    const targetSettled = await deps.subledger["deps"].subledger.findEntryById(T, targetEntry.id);
    expect(targetSettled!.settlementStatus).toBe("settled");

    // Reverse P1
    await deps.reversalService.reversePayment(user as any, eff as any, {
      paymentId: p1Id, idempotencyKey: "rev1-" + randomUUID(), reason: "test",
    });

    // Target should be partially_settled (P2=60 still active, P1 reversed)
    const targetAfterReverse = await deps.subledger["deps"].subledger.findEntryById(T, targetEntry.id);
    expect(targetAfterReverse!.settlementStatus).toBe("partially_settled");

    // P1's settlement should be reversed
    const p1Settlements = await deps.paymentRepo.listSettlementsForPaymentEntry(T, p1Entry.id);
    const p1Original = p1Settlements.find(s => s.paymentEntryId === p1Entry.id && s.settledEntryId === targetEntry.id);
    expect(p1Original).toBeDefined();
    expect(p1Original!.settlementStatus).toBe("reversed");

    // P2's settlement should still be settled (active)
    const p2Settlements = await deps.paymentRepo.listSettlementsForPaymentEntry(T, p2Entry.id);
    const p2Original = p2Settlements.find(s => s.paymentEntryId === p2Entry.id && s.settledEntryId === targetEntry.id);
    expect(p2Original).toBeDefined();
    expect(p2Original!.settlementStatus).toBe("settled");
  });

  // =========================================================================
  // REV-UNALLOC-3 — multiple targets → reverse → all recomputed
  // =========================================================================
  it("REV-UNALLOC-3. P1 settles T1 and T2 → reverse P1 → both unsettled", async () => {
    const T = randomUUID();
    const deps = makeDeps(T);
    const user = makeUser(T);
    const eff = makeEffective();

    const accountId = randomUUID();
    const t1 = await deps.subledger["deps"].subledger.insertEntry({
      tenantId: T, accountId, entryNo: "T1-003", entryDate: "2024-01-01",
      amountSigned: "50.00", currency: "EGP", entryType: "customer_sale_receivable",
      sourceDocumentType: "sale", sourceDocumentId: randomUUID(), createdBy: user.userId,
    });
    const t2 = await deps.subledger["deps"].subledger.insertEntry({
      tenantId: T, accountId, entryNo: "T2-003", entryDate: "2024-01-01",
      amountSigned: "50.00", currency: "EGP", entryType: "customer_sale_receivable",
      sourceDocumentType: "sale", sourceDocumentId: randomUUID(), createdBy: user.userId,
    });

    const pId = randomUUID();
    const pEntry = await deps.subledger["deps"].subledger.insertEntry({
      tenantId: T, accountId, entryNo: "P-003", entryDate: "2024-01-01",
      amountSigned: "-100.00", currency: "EGP", entryType: "customer_payment",
      sourceDocumentType: "payment", sourceDocumentId: pId, createdBy: user.userId,
    });
    (deps.paymentRepo as any).seedPayment({
      id: pId, tenantId: T, paymentNo: "P-003",
      paymentDirection: "received_from_party", paymentMethod: "cash",
      accountId, amount: "100.00", paymentDate: "2024-01-01",
      status: "posted", postedEntryId: pEntry.id,
      idempotencyKey: "seed-" + pId, createdBy: user.userId,
    });

    // Settle both targets in one request
    await deps.settlementService.settlePayment(user as any, eff as any, {
      paymentId: pId, idempotencyKey: "s3-" + randomUUID(),
      allocations: [
        { settledEntryId: t1.id, settledAmount: "50.00" },
        { settledEntryId: t2.id, settledAmount: "50.00" },
      ],
    });

    expect((await deps.subledger["deps"].subledger.findEntryById(T, t1.id))!.settlementStatus).toBe("settled");
    expect((await deps.subledger["deps"].subledger.findEntryById(T, t2.id))!.settlementStatus).toBe("settled");

    // Reverse
    await deps.reversalService.reversePayment(user as any, eff as any, {
      paymentId: pId, idempotencyKey: "rev3-" + randomUUID(), reason: "test",
    });

    // Both targets should be unsettled
    expect((await deps.subledger["deps"].subledger.findEntryById(T, t1.id))!.settlementStatus).toBe("unsettled");
    expect((await deps.subledger["deps"].subledger.findEntryById(T, t2.id))!.settlementStatus).toBe("unsettled");
  });

  // =========================================================================
  // REV-TRANSITION-FAIL — reverseSettlement returns null → abort
  // =========================================================================
  it("REV-TRANSITION-FAIL. reverseSettlement returns null → INTERNAL_TRANSACTION_FAILED, no side effects", async () => {
    const T = randomUUID();
    const deps = makeDeps(T);
    const user = makeUser(T);
    const eff = makeEffective();

    const accountId = randomUUID();
    const targetEntry = await deps.subledger["deps"].subledger.insertEntry({
      tenantId: T, accountId, entryNo: "T-FAIL", entryDate: "2024-01-01",
      amountSigned: "100.00", currency: "EGP", entryType: "customer_sale_receivable",
      sourceDocumentType: "sale", sourceDocumentId: randomUUID(), createdBy: user.userId,
    });

    const pId = randomUUID();
    const pEntry = await deps.subledger["deps"].subledger.insertEntry({
      tenantId: T, accountId, entryNo: "P-FAIL", entryDate: "2024-01-01",
      amountSigned: "-100.00", currency: "EGP", entryType: "customer_payment",
      sourceDocumentType: "payment", sourceDocumentId: pId, createdBy: user.userId,
    });
    (deps.paymentRepo as any).seedPayment({
      id: pId, tenantId: T, paymentNo: "P-FAIL",
      paymentDirection: "received_from_party", paymentMethod: "cash",
      accountId, amount: "100.00", paymentDate: "2024-01-01",
      status: "posted", postedEntryId: pEntry.id,
      idempotencyKey: "seed-" + pId, createdBy: user.userId,
    });

    // Settle
    await deps.settlementService.settlePayment(user as any, eff as any, {
      paymentId: pId, idempotencyKey: "sf-" + randomUUID(),
      allocations: [{ settledEntryId: targetEntry.id, settledAmount: "100.00" }],
    });

    // Inject fault: override reverseSettlement to return null
    const originalReverse = deps.paymentRepo.reverseSettlement.bind(deps.paymentRepo);
    deps.paymentRepo.reverseSettlement = async () => null;

    // Attempt reversal — must fail
    const outcome = await deps.reversalService.reversePayment(
      user as any, eff as any,
      { paymentId: pId, idempotencyKey: "rev-fail-" + randomUUID(), reason: "test" },
    ).then(v => ({ ok: true, v }), e => ({ ok: false, e }));

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(((outcome as any).e as Error).message).toMatch(/could not be transitioned to reversed/i);
    }

    // Restore
    deps.paymentRepo.reverseSettlement = originalReverse;

    // Verify no side effects survived (in-memory adapter: since the noopTxRunner
    // doesn't actually roll back, we verify the payment is still posted)
    const payment = await deps.paymentRepo.findPaymentById(T, pId);
    // With in-memory repos and noopTxRunner, the reverseSettlement returning null
    // throws BEFORE updatePaymentStatus, so payment should still be posted.
    expect(payment!.status).toBe("posted");
  });
});
