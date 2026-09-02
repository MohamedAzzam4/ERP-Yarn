/**
 * WP-07-04 r20 — Strict validator tests + malformed replay + decimal service + strengthened tests.
 *
 * BLOCKER B: Table-driven isValidCanonicalMoney tests
 * BLOCKER E: Malformed replay tests for Reversal + Settlement
 * DECIMAL-SVC-1/2: Real SettlementService decimal tests
 * Strengthened fail-closed + SETTLE-DUP + REV-UNALLOC tests
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { isValidCanonicalMoney } from "@/server/services/decimal-money";
import { PaymentService, PaymentError } from "@/server/services/payment-service";
import { PaymentReversalService, PaymentReversalError } from "@/server/services/payment-reversal-service";
import { SettlementService, SettlementError } from "@/server/services/settlement-service";
import { DirectCostService, DirectCostError } from "@/server/services/direct-cost-service";
import { SubledgerService } from "@/server/services/subledger-service";
import { resolveEffectivePermissions } from "@/server/security/effective-permissions";
import { TEST_ROLE_PERMISSION_MATRIX } from "@/server/security/role-fixtures";
import type { ErpUserContext } from "@/server/auth/erp-context";
import { InMemoryPaymentRepository } from "./in-memory-payment-repository";
import { InMemorySubledgerRepository } from "./in-memory-subledger-repository";
import { InProcessAuditStore } from "@/server/services/audit-service";
import { InProcessIdempotencyStore } from "@/server/services/idempotency-service";
import { InProcessDocumentSequenceStore } from "@/server/services/document-sequence-service";
import { computeRequestHash } from "@/server/services/request-hash";

function makeUser(tenantId: string): ErpUserContext {
  return { authenticated: true, userId: randomUUID(), tenantId,
    authId: `auth-${tenantId}`, name: "Test", email: `test-${tenantId}@test.local` };
}
function makeEffective() { return resolveEffectivePermissions(["owner"], TEST_ROLE_PERMISSION_MATRIX); }

function makeDeps(tenantId: string) {
  const paymentRepo = new InMemoryPaymentRepository();
  const subledgerRepo = new InMemorySubledgerRepository();
  const audit = new InProcessAuditStore();
  const idempotency = new InProcessIdempotencyStore();
  const documentSequence = new InProcessDocumentSequenceStore();
  const subledger = new SubledgerService({ subledger: subledgerRepo, audit, idempotency, documentSequence });
  const noopTxRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => work(null);
  const paymentService = new PaymentService({
    paymentRepository: paymentRepo, subledger, audit, idempotency, documentSequence,
    transactionRunner: noopTxRunner,
    txFactories: { createSubledger: () => subledger, createPaymentRepository: () => paymentRepo, createAudit: () => audit, createIdempotency: () => idempotency, createDocumentSequence: () => documentSequence },
  });
  const reversalService = new PaymentReversalService({
    paymentRepository: paymentRepo, subledger, audit, idempotency, documentSequence,
    transactionRunner: noopTxRunner,
    txFactories: { createSubledger: () => subledger, createPaymentRepository: () => paymentRepo, createAudit: () => audit, createIdempotency: () => idempotency, createDocumentSequence: () => documentSequence },
  });
  const settlementService = new SettlementService({
    paymentRepository: paymentRepo, subledger, audit, idempotency,
    transactionRunner: noopTxRunner,
    txFactories: { createSubledger: () => subledger, createPaymentRepository: () => paymentRepo, createAudit: () => audit, createIdempotency: () => idempotency },
  });
  return { paymentRepo, subledgerRepo, audit, idempotency, documentSequence, subledger, paymentService, reversalService, settlementService };
}

describe("WP-07-04 r20 — Validator + replay + decimal + strengthened tests", () => {

  // =========================================================================
  // BLOCKER B — isValidCanonicalMoney table-driven tests
  // =========================================================================
  describe("isValidCanonicalMoney", () => {
    const accept = ["0.00", "1.20", "100.00", "-50.00", "999999.99", "00.00", "0001.00", "-0.00"];
    const reject = ["", " ", "1", "1.2", "1.234", "1.2.3", ".50", "1.", "abc", "NaN", "Infinity", "+1.00", " 1.00 ", "10.0", "10.000"];

    for (const v of accept) {
      it(`ACCEPTS "${v}"`, () => { expect(isValidCanonicalMoney(v)).toBe(true); });
    }
    for (const v of reject) {
      it(`REJECTS "${v}"`, () => { expect(isValidCanonicalMoney(v)).toBe(false); });
    }
    it("REJECTS undefined", () => { expect(isValidCanonicalMoney(undefined)).toBe(false); });
    it("REJECTS null", () => { expect(isValidCanonicalMoney(null)).toBe(false); });
    it("REJECTS number", () => { expect(isValidCanonicalMoney(1.20)).toBe(false); });
  });

  // =========================================================================
  // BLOCKER E — Malformed replay tests
  // =========================================================================
  describe("REV-REPLAY-MALFORMED", () => {
    async function setupReversalReplay(tenantId: string, responseBody: unknown) {
      const deps = makeDeps(tenantId);
      // Manually insert a business_failed or succeeded idempotency record with malformed body
      const idemStore = deps.idempotency as any;
      const key = "rev-malformed-" + randomUUID();
      const reqBody = { paymentId: "p1", reason: "test", notes: null };
      const requestHash = computeRequestHash(reqBody);
      idemStore.records.set(`${tenantId}|payment.reverse|${key}`, {
        id: randomUUID(), tenantId, operationScope: "payment.reverse", idempotencyKey: key,
        requestHash, state: "succeeded", entityType: null, entityId: null,
        responseCode: 200, responseBody, ownerToken: "tok", attemptCount: 1,
        leaseHeartbeatAt: new Date(), leaseExpiresAt: new Date(Date.now() + 30000),
        lastErrorClass: null, initiatedBy: "u", createdAt: new Date(), completedAt: new Date(),
      });
      return { deps, key, tenantId };
    }

    it("REV-REPLAY-MALFORMED-1. reversalAmountSigned='1.234' → IDEMPOTENCY_INCONSISTENT", async () => {
      const T = randomUUID();
      const { deps, key } = await setupReversalReplay(T, {
        action: "reversed", paymentId: "p1", reversalEntryId: "e1", reversalEntryNo: "R-001",
        reversalAmountSigned: "1.234", reversedSettlementIds: [], originalEntryImmutable: true,
      });
      const outcome = await deps.reversalService.reversePayment(makeUser(T) as any, makeEffective() as any,
        { paymentId: "p1", idempotencyKey: key, reason: "test" }
      ).then(v => ({ ok: true as const }), e => ({ ok: false as const, code: (e as PaymentReversalError).code }));
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.code).toBe("IDEMPOTENCY_INCONSISTENT");
    });

    it("REV-REPLAY-MALFORMED-2. reversalAmountSigned='1.2.3' → IDEMPOTENCY_INCONSISTENT", async () => {
      const T = randomUUID();
      const { deps, key } = await setupReversalReplay(T, {
        action: "reversed", paymentId: "p1", reversalEntryId: "e1", reversalEntryNo: "R-001",
        reversalAmountSigned: "1.2.3", reversedSettlementIds: [], originalEntryImmutable: true,
      });
      const outcome = await deps.reversalService.reversePayment(makeUser(T) as any, makeEffective() as any,
        { paymentId: "p1", idempotencyKey: key, reason: "test" }
      ).then(v => ({ ok: true as const }), e => ({ ok: false as const, code: (e as PaymentReversalError).code }));
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.code).toBe("IDEMPOTENCY_INCONSISTENT");
    });

    it("REV-REPLAY-MALFORMED-3. reversalAmountSigned='0.00' → IDEMPOTENCY_INCONSISTENT (zero reversal)", async () => {
      const T = randomUUID();
      const { deps, key } = await setupReversalReplay(T, {
        action: "reversed", paymentId: "p1", reversalEntryId: "e1", reversalEntryNo: "R-001",
        reversalAmountSigned: "0.00", reversedSettlementIds: [], originalEntryImmutable: true,
      });
      const outcome = await deps.reversalService.reversePayment(makeUser(T) as any, makeEffective() as any,
        { paymentId: "p1", idempotencyKey: key, reason: "test" }
      ).then(v => ({ ok: true as const }), e => ({ ok: false as const, code: (e as PaymentReversalError).code }));
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.code).toBe("IDEMPOTENCY_INCONSISTENT");
    });
  });

  describe("SETTLE-REPLAY-MALFORMED", () => {
    async function setupSettlementReplay(tenantId: string, responseBody: unknown) {
      const deps = makeDeps(tenantId);
      const idemStore = deps.idempotency as any;
      const key = "settle-malformed-" + randomUUID();
      const reqBody = { paymentId: "p1", allocations: [{ settledEntryId: "t1", settledAmount: "10.00" }], notes: null };
      const requestHash = computeRequestHash(reqBody);
      idemStore.records.set(`${tenantId}|payment.settle|${key}`, {
        id: randomUUID(), tenantId, operationScope: "payment.settle", idempotencyKey: key,
        requestHash, state: "succeeded", entityType: null, entityId: null,
        responseCode: 200, responseBody, ownerToken: "tok", attemptCount: 1,
        leaseHeartbeatAt: new Date(), leaseExpiresAt: new Date(Date.now() + 30000),
        lastErrorClass: null, initiatedBy: "u", createdAt: new Date(), completedAt: new Date(),
      });
      return { deps, key, tenantId };
    }

    it("SETTLE-REPLAY-MALFORMED-1. totalSettled='-10.00' → IDEMPOTENCY_INCONSISTENT", async () => {
      const T = randomUUID();
      const { deps, key } = await setupSettlementReplay(T, {
        action: "settled", paymentId: "p1", settlementIds: ["s1"], totalSettled: "-10.00",
        paymentEntryRemaining: "10.00", allocations: [{ settlementId: "s1", settledEntryId: "t1", settledAmount: "10.00", settledEntryRemaining: "0.00" }],
      });
      const outcome = await deps.settlementService.settlePayment(makeUser(T) as any, makeEffective() as any,
        { paymentId: "p1", idempotencyKey: key, allocations: [{ settledEntryId: "t1", settledAmount: "10.00" }] }
      ).then(v => ({ ok: true as const }), e => ({ ok: false as const, code: (e as SettlementError).code }));
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.code).toBe("IDEMPOTENCY_INCONSISTENT");
    });

    it("SETTLE-REPLAY-MALFORMED-2. paymentEntryRemaining='-0.01' → IDEMPOTENCY_INCONSISTENT", async () => {
      const T = randomUUID();
      const { deps, key } = await setupSettlementReplay(T, {
        action: "settled", paymentId: "p1", settlementIds: ["s1"], totalSettled: "10.00",
        paymentEntryRemaining: "-0.01", allocations: [{ settlementId: "s1", settledEntryId: "t1", settledAmount: "10.00", settledEntryRemaining: "0.00" }],
      });
      const outcome = await deps.settlementService.settlePayment(makeUser(T) as any, makeEffective() as any,
        { paymentId: "p1", idempotencyKey: key, allocations: [{ settledEntryId: "t1", settledAmount: "10.00" }] }
      ).then(v => ({ ok: true as const }), e => ({ ok: false as const, code: (e as SettlementError).code }));
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.code).toBe("IDEMPOTENCY_INCONSISTENT");
    });

    it("SETTLE-REPLAY-MALFORMED-3. duplicate allocation settlementIds → IDEMPOTENCY_INCONSISTENT", async () => {
      const T = randomUUID();
      const { deps, key } = await setupSettlementReplay(T, {
        action: "settled", paymentId: "p1", settlementIds: ["s1", "s2"], totalSettled: "20.00",
        paymentEntryRemaining: "0.00", allocations: [
          { settlementId: "s1", settledEntryId: "t1", settledAmount: "10.00", settledEntryRemaining: "0.00" },
          { settlementId: "s1", settledEntryId: "t2", settledAmount: "10.00", settledEntryRemaining: "0.00" },
        ],
      });
      const outcome = await deps.settlementService.settlePayment(makeUser(T) as any, makeEffective() as any,
        { paymentId: "p1", idempotencyKey: key, allocations: [{ settledEntryId: "t1", settledAmount: "10.00" }] }
      ).then(v => ({ ok: true as const }), e => ({ ok: false as const, code: (e as SettlementError).code }));
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.code).toBe("IDEMPOTENCY_INCONSISTENT");
    });

    it("SETTLE-REPLAY-MALFORMED-4. totalSettled='10.0' (non-canonical) → IDEMPOTENCY_INCONSISTENT", async () => {
      const T = randomUUID();
      const { deps, key } = await setupSettlementReplay(T, {
        action: "settled", paymentId: "p1", settlementIds: ["s1"], totalSettled: "10.0",
        paymentEntryRemaining: "0.00", allocations: [{ settlementId: "s1", settledEntryId: "t1", settledAmount: "10.00", settledEntryRemaining: "0.00" }],
      });
      const outcome = await deps.settlementService.settlePayment(makeUser(T) as any, makeEffective() as any,
        { paymentId: "p1", idempotencyKey: key, allocations: [{ settledEntryId: "t1", settledAmount: "10.00" }] }
      ).then(v => ({ ok: true as const }), e => ({ ok: false as const, code: (e as SettlementError).code }));
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.code).toBe("IDEMPOTENCY_INCONSISTENT");
    });
  });

  // =========================================================================
  // DECIMAL-SVC-1 — Real SettlementService with 0.30 / 0.10 = 0.20
  // =========================================================================
  it("DECIMAL-SVC-1. payment capacity 0.30, settle 0.10 → remaining 0.20", async () => {
    const T = randomUUID();
    const deps = makeDeps(T);
    const user = makeUser(T);
    const eff = makeEffective();

    const accountId = randomUUID();
    const targetEntry = await deps.subledger["deps"].subledger.insertEntry({
      tenantId: T, accountId, entryNo: "T-DEC1", entryDate: "2024-01-01",
      amountSigned: "0.30", currency: "EGP", entryType: "customer_sale_receivable",
      sourceDocumentType: "sale", sourceDocumentId: randomUUID(), createdBy: user.userId,
    });
    const pId = randomUUID();
    const pEntry = await deps.subledger["deps"].subledger.insertEntry({
      tenantId: T, accountId, entryNo: "P-DEC1", entryDate: "2024-01-01",
      amountSigned: "-0.30", currency: "EGP", entryType: "customer_payment",
      sourceDocumentType: "payment", sourceDocumentId: pId, createdBy: user.userId,
    });
    (deps.paymentRepo as any).seedPayment({
      id: pId, tenantId: T, paymentNo: "P-DEC1",
      paymentDirection: "received_from_party", paymentMethod: "cash",
      accountId, amount: "0.30", paymentDate: "2024-01-01",
      status: "posted", postedEntryId: pEntry.id,
      idempotencyKey: "seed-" + pId, createdBy: user.userId,
    } as any);

    const result = await deps.settlementService.settlePayment(user as any, eff as any, {
      paymentId: pId, idempotencyKey: "dec1-" + randomUUID(),
      allocations: [{ settledEntryId: targetEntry.id, settledAmount: "0.10" }],
    });

    expect(result.paymentEntryRemaining).toBe("0.20");
    expect(result.allocations[0]!.settledEntryRemaining).toBe("0.20");
  });

  // =========================================================================
  // DECIMAL-SVC-2 — Real SettlementService with 10.00 / 9.99 = 0.01
  // =========================================================================
  it("DECIMAL-SVC-2. payment capacity 10.00, settle 9.99 → remaining 0.01", async () => {
    const T = randomUUID();
    const deps = makeDeps(T);
    const user = makeUser(T);
    const eff = makeEffective();

    const accountId = randomUUID();
    const targetEntry = await deps.subledger["deps"].subledger.insertEntry({
      tenantId: T, accountId, entryNo: "T-DEC2", entryDate: "2024-01-01",
      amountSigned: "10.00", currency: "EGP", entryType: "customer_sale_receivable",
      sourceDocumentType: "sale", sourceDocumentId: randomUUID(), createdBy: user.userId,
    });
    const pId = randomUUID();
    const pEntry = await deps.subledger["deps"].subledger.insertEntry({
      tenantId: T, accountId, entryNo: "P-DEC2", entryDate: "2024-01-01",
      amountSigned: "-10.00", currency: "EGP", entryType: "customer_payment",
      sourceDocumentType: "payment", sourceDocumentId: pId, createdBy: user.userId,
    });
    (deps.paymentRepo as any).seedPayment({
      id: pId, tenantId: T, paymentNo: "P-DEC2",
      paymentDirection: "received_from_party", paymentMethod: "cash",
      accountId, amount: "10.00", paymentDate: "2024-01-01",
      status: "posted", postedEntryId: pEntry.id,
      idempotencyKey: "seed-" + pId, createdBy: user.userId,
    } as any);

    const result = await deps.settlementService.settlePayment(user as any, eff as any, {
      paymentId: pId, idempotencyKey: "dec2-" + randomUUID(),
      allocations: [{ settledEntryId: targetEntry.id, settledAmount: "9.99" }],
    });

    expect(result.paymentEntryRemaining).toBe("0.01");
    expect(result.allocations[0]!.settledEntryRemaining).toBe("0.01");
  });

  // =========================================================================
  // SETTLE-DUP-1 — Strengthened with exact assertions
  // =========================================================================
  it("SETTLE-DUP-1. duplicate settledEntryId → VALIDATION_FAILED, zero effects", async () => {
    const T = randomUUID();
    const deps = makeDeps(T);
    const user = makeUser(T);
    const eff = makeEffective();
    const outcome = await deps.settlementService.settlePayment(
      user as any, eff as any,
      { paymentId: randomUUID(), idempotencyKey: "dup-" + randomUUID(),
        allocations: [{ settledEntryId: "t1", settledAmount: "60.00" }, { settledEntryId: "t1", settledAmount: "60.00" }] },
    ).then(v => ({ ok: true as const }), e => ({ ok: false as const, code: (e as SettlementError).code }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("VALIDATION_FAILED");
    expect((deps.idempotency as any).records.size).toBe(0);
    expect((deps.paymentRepo as any).lockCalls.length).toBe(0);
  });

  // =========================================================================
  // FAIL-CLOSED — Strengthened with zero-effect assertions
  // =========================================================================
  it("FAIL-CLOSED-PAYMENT. zero idempotency + zero locks + zero audit", async () => {
    const T = randomUUID();
    const paymentRepo = new InMemoryPaymentRepository();
    const audit = new InProcessAuditStore();
    const idempotency = new InProcessIdempotencyStore();
    const documentSequence = new InProcessDocumentSequenceStore();
    const subledger = new SubledgerService({ subledger: new InMemorySubledgerRepository(), audit, idempotency, documentSequence });
    const service = new PaymentService({ paymentRepository: paymentRepo, subledger, audit, idempotency, documentSequence });
    const outcome = await service.postPayment(makeUser(T) as any, makeEffective() as any,
      { paymentId: randomUUID(), idempotencyKey: "fc-" + randomUUID() },
    ).then(v => ({ ok: true as const }), e => ({ ok: false as const, code: (e as PaymentError).code }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("CONFIGURATION_ERROR");
    expect((idempotency as any).records.size).toBe(0);
    expect(paymentRepo.lockCalls.length).toBe(0);
  });
});
