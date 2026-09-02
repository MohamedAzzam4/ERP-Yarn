/**
 * WP-07-04 r24 — Focused non-PG tests for the r24 production blockers.
 *
 * Covers:
 *   DRAFT-CURRENCY-IDEMP-1 — same key, currency omitted vs explicit "EGP" → replay
 *   DRAFT-CURRENCY-IDEMP-2 — same key, materially different currency → IDEMPOTENCY_CONFLICT
 *   DRAFT-CURRENCY-REJECT  — non-EGP currency → VALIDATION_FAILED before idempotency
 *   DRAFT-OWNER-1 — existing active owner → allowed
 *   DRAFT-OWNER-2 — missing owner → rejected; zero effects
 *   DRAFT-OWNER-3 — inactive owner → rejected; zero effects
 *   DRAFT-OWNER-4 — foreign-tenant owner ID → rejected without disclosure
 *   DRAFT-MALFORMED-REPLAY — corrupted succeeded → IDEMPOTENCY_INCONSISTENT, zero effects
 *   DRAFT-FAILURE-CLASSIFICATION — owner validation is business, not technical retry
 *   PAY-NOTFOUND-r24 — first NotFound after claim; durable replay
 *   PAY-STATE-r24 — already-posted/non-draft locked state; durable replay
 *   MONEY-RANGE-r24 — isValidCanonicalMoney 18,2 range tests
 *   SETTLE-SHAPE-r24 — allocation shape validation before claim
 *   BUSINESS-FAILED-TYPES — hardened runtime type checks (Blocker E)
 *   SUCCEEDED-TYPES — hardened runtime identifier types (Blocker F)
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  PaymentService,
  PaymentError,
  OwnerNotFoundError,
  OwnerNotActiveError,
} from "@/server/services/payment-service";
import {
  PaymentReversalService,
  PaymentReversalError,
} from "@/server/services/payment-reversal-service";
import { SettlementService, SettlementError } from "@/server/services/settlement-service";
import { SubledgerService } from "@/server/services/subledger-service";
import { resolveEffectivePermissions } from "@/server/security/effective-permissions";
import { TEST_ROLE_PERMISSION_MATRIX } from "@/server/security/role-fixtures";
import type { ErpUserContext } from "@/server/auth/erp-context";
import { InMemoryPaymentRepository } from "./in-memory-payment-repository";
import { InMemorySubledgerRepository } from "./in-memory-subledger-repository";
import { InProcessAuditStore } from "@/server/services/audit-service";
import { InProcessIdempotencyStore } from "@/server/services/idempotency-service";
import { InProcessDocumentSequenceStore } from "@/server/services/document-sequence-service";
import { InMemoryOwnerAuthorityLookup } from "@/server/services/owner-authority-lookup";
import { isValidCanonicalMoney } from "@/server/services/decimal-money";
import { computeRequestHash } from "@/server/services/request-hash";

const TEST_TENANT = "tenant-r24-fixture-0000-0000-000000000001";
const TEST_CUSTOMER = "cust-r24-fixture-0000-0000-000000000001";
const TEST_SUPPLIER = "supp-r24-fixture-0000-0000-000000000001";
const TEST_FACTORY = "fact-r24-fixture-0000-0000-000000000001";

function makeUser(t: string = TEST_TENANT): ErpUserContext {
  return { authenticated: true, userId: randomUUID(), tenantId: t,
    authId: `auth-${t}`, name: "Test", email: `test-${t}@test.local` };
}
function makeEff() {
  return resolveEffectivePermissions(["owner"], TEST_ROLE_PERMISSION_MATRIX);
}

function makeDeps() {
  const paymentRepo = new InMemoryPaymentRepository();
  const subledgerRepo = new InMemorySubledgerRepository();
  const audit = new InProcessAuditStore();
  const idempotency = new InProcessIdempotencyStore();
  const documentSequence = new InProcessDocumentSequenceStore();
  const subledger = new SubledgerService({ subledger: subledgerRepo, audit, idempotency, documentSequence });
  const noopTxRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => work(null);
  const ownerAuthority = new InMemoryOwnerAuthorityLookup();
  ownerAuthority.seed({ tenantId: TEST_TENANT, ownerType: "customer", ownerId: TEST_CUSTOMER, status: "active" });
  ownerAuthority.seed({ tenantId: TEST_TENANT, ownerType: "supplier", ownerId: TEST_SUPPLIER, status: "active" });
  ownerAuthority.seed({ tenantId: TEST_TENANT, ownerType: "factory", ownerId: TEST_FACTORY, status: "active" });
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
      createSubledger: () => subledger, createPaymentRepository: () => paymentRepo,
      createAudit: () => audit, createIdempotency: () => idempotency,
      createDocumentSequence: () => documentSequence,
    },
  });
  const settlementService = new SettlementService({
    paymentRepository: paymentRepo, subledger, audit, idempotency,
    transactionRunner: noopTxRunner,
    txFactories: {
      createSubledger: () => subledger, createPaymentRepository: () => paymentRepo,
      createAudit: () => audit, createIdempotency: () => idempotency,
    },
  });
  return { paymentRepo, subledgerRepo, audit, idempotency, documentSequence, subledger,
    paymentService, reversalService, settlementService, ownerAuthority };
}

async function settleIdemCounts(deps: ReturnType<typeof makeDeps>): Promise<{ records: number }> {
  return { records: (deps.idempotency as unknown as { records: Map<string, unknown> }).records.size };
}

/**
 * Seed a record into the in-memory idempotency store with the CORRECT
 * requestHash for the supplied body. Without this, claimIdempotency would
 * detect a hash mismatch and return "conflict" instead of "replay".
 */
function seedIdempotencyRecord(
  deps: ReturnType<typeof makeDeps>,
  args: {
    operationScope: string;
    idempotencyKey: string;
    requestBody: Record<string, unknown>;
    state: "succeeded" | "business_failed";
    responseBody: unknown;
    initiatedBy: string;
  },
): string {
  const store = (deps.idempotency as unknown as {
    records: Map<string, any>;
    idCounter: { value: number };
  });
  const recordId = "manual-rec-" + Math.random().toString(36).slice(2);
  const requestHash = computeRequestHash(args.requestBody);
  store.records.set(recordId, {
    id: recordId,
    tenantId: TEST_TENANT,
    operationScope: args.operationScope,
    idempotencyKey: args.idempotencyKey,
    requestBody: args.requestBody,
    requestHash,
    state: args.state,
    responseBody: args.responseBody,
    ownerToken: "test-owner-token-" + recordId,
    attemptCount: 1,
    leaseExpiresAt: null,
    lastErrorClass: args.state === "business_failed" ? "TestError" : null,
    responseCode: args.state === "succeeded" ? 200 : 409,
    entityType: "payment",
    entityId: "seeded-entity",
    initiatedBy: args.initiatedBy,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: new Date(),
    leaseHeartbeatAt: new Date(),
  });
  return recordId;
}

describe("WP-07-04 r24 — Focused non-PG tests for production blockers", () => {

  // ===========================================================================
  // DRAFT-CURRENCY-IDEMP-1 — same key, currency omitted vs explicit "EGP" → replay
  // ===========================================================================
  it("DRAFT-CURRENCY-IDEMP-1. omitted currency and explicit 'EGP' produce the same request hash → replay", async () => {
    const deps = makeDeps();
    const user = makeUser();
    const eff = makeEff();
    const baseInput = {
      ownerType: "customer" as const,
      ownerId: TEST_CUSTOMER,
      paymentDate: "2026-09-03",
      amount: "100.00",
      paymentDirection: "received_from_party" as const,
      paymentMethod: "cash" as const,
      idempotencyKey: "draft-currency-idemp-1-" + randomUUID(),
    };

    // First call: currency omitted (defaults to "EGP")
    const r1 = await deps.paymentService.createDraftPayment(user as any, eff as any, baseInput);
    expect(r1.status).toBe("draft");

    // Second call: currency explicit "EGP" — MUST replay (same request hash)
    const r2 = await deps.paymentService.createDraftPayment(user as any, eff as any,
      { ...baseInput, currency: "EGP" });

    expect(r2.paymentId).toBe(r1.paymentId);
    expect(r2.paymentNo).toBe(r1.paymentNo);
    expect(r2.status).toBe("draft");
    // No second payment was created
    expect((deps.paymentRepo as any).payments.size).toBe(1);
  });

  // ===========================================================================
  // DRAFT-CURRENCY-IDEMP-2 — same key, materially different currency → CONFLICT
  // ===========================================================================
  it("DRAFT-CURRENCY-IDEMP-2. same key with materially different effective currency → IDEMPOTENCY_CONFLICT (proven via direct seed)", async () => {
    const deps = makeDeps();
    const user = makeUser();
    const eff = makeEff();
    const key = "draft-currency-idemp-2-" + randomUUID();
    const baseInput = {
      ownerType: "customer" as const,
      ownerId: TEST_CUSTOMER,
      paymentDate: "2026-09-03",
      amount: "100.00",
      paymentDirection: "received_from_party" as const,
      paymentMethod: "cash" as const,
      idempotencyKey: key,
      currency: "EGP" as const,
    };

    // Pre-seed a succeeded record under the same key but with currency="USD"
    // in the request body. The requestHash is computed for that USD body.
    // When createDraftPayment is called with currency="EGP", the request
    // hash differs → IDEMPOTENCY_CONFLICT.
    //
    // This proves the contract is enforceable: a missing-currency call
    // (defaults to "EGP") and an explicit "EGP" call produce the SAME hash
    // (covered by DRAFT-CURRENCY-IDEMP-1), while two calls with materially
    // different currencies produce CONFLICT.
    seedIdempotencyRecord(deps, {
      operationScope: "payment.create_draft",
      idempotencyKey: key,
      requestBody: {
        ownerType: "customer",
        ownerId: TEST_CUSTOMER,
        paymentDate: "2026-09-03",
        amount: "100.00",
        paymentDirection: "received_from_party",
        paymentMethod: "cash",
        currency: "USD",
        notes: null,
      },
      state: "succeeded",
      responseBody: { paymentId: "usd-payment-id", paymentNo: "PAY-USD-001", status: "draft" },
      initiatedBy: user.userId,
    });

    const outcome = await deps.paymentService.createDraftPayment(user as any, eff as any,
      { ...baseInput, currency: "EGP" }).then(v => ({ ok: true, v }), e => ({ ok: false, e }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      // The contract: same key + different body → IDEMPOTENCY_CONFLICT.
      expect(((outcome as any).e as PaymentError).code).toBe("IDEMPOTENCY_CONFLICT");
    }
    // No new payment inserted — only the seeded record exists
    expect((deps.paymentRepo as any).payments.size).toBe(0);
    // Only the seeded idempotency record exists (no new claim)
    const counts = await settleIdemCounts(deps);
    expect(counts.records).toBe(1);
  });

  // ===========================================================================
  // DRAFT-CURRENCY-REJECT — non-EGP currency → VALIDATION_FAILED before idempotency
  // ===========================================================================
  it("DRAFT-CURRENCY-REJECT. non-EGP currency → VALIDATION_FAILED before idempotency claim, zero effects", async () => {
    const deps = makeDeps();
    const user = makeUser();
    const eff = makeEff();
    const outcome = await deps.paymentService.createDraftPayment(user as any, eff as any, {
      ownerType: "customer",
      ownerId: TEST_CUSTOMER,
      paymentDate: "2026-09-03",
      amount: "100.00",
      paymentDirection: "received_from_party",
      paymentMethod: "cash",
      idempotencyKey: "draft-currency-reject-" + randomUUID(),
      currency: "USD",
    }).then(v => ({ ok: true, v }), e => ({ ok: false, e }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(((outcome as any).e as PaymentError).code).toBe("VALIDATION_FAILED");
      expect(((outcome as any).e as Error).message).toMatch(/EGP/);
    }
    // Zero idempotency records, zero payments, zero audit
    const counts = await settleIdemCounts(deps);
    expect(counts.records).toBe(0);
    expect((deps.paymentRepo as any).payments.size).toBe(0);
    expect((deps.audit as any).rows.length).toBe(0);
  });

  // ===========================================================================
  // DRAFT-OWNER-1 — existing active owner → allowed
  // ===========================================================================
  it("DRAFT-OWNER-1. existing active owner → draft created", async () => {
    const deps = makeDeps();
    const user = makeUser();
    const eff = makeEff();
    const r = await deps.paymentService.createDraftPayment(user as any, eff as any, {
      ownerType: "customer",
      ownerId: TEST_CUSTOMER,
      paymentDate: "2026-09-03",
      amount: "100.00",
      paymentDirection: "received_from_party",
      paymentMethod: "cash",
      idempotencyKey: "draft-owner-1-" + randomUUID(),
    });
    expect(r.status).toBe("draft");
    expect(r.paymentId).toBeTruthy();
    expect(r.paymentNo).toBeTruthy();
  });

  // ===========================================================================
  // DRAFT-OWNER-2 — missing owner → rejected; zero effects
  // ===========================================================================
  it("DRAFT-OWNER-2. missing owner → OwnerNotFoundError; zero idempotency/payment/account/audit", async () => {
    const deps = makeDeps();
    const user = makeUser();
    const eff = makeEff();
    const outcome = await deps.paymentService.createDraftPayment(user as any, eff as any, {
      ownerType: "customer",
      ownerId: "missing-customer-id-" + randomUUID(),
      paymentDate: "2026-09-03",
      amount: "100.00",
      paymentDirection: "received_from_party",
      paymentMethod: "cash",
      idempotencyKey: "draft-owner-2-" + randomUUID(),
    }).then(v => ({ ok: true, v }), e => ({ ok: false, e }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(((outcome as any).e) instanceof OwnerNotFoundError).toBe(true);
      expect(((outcome as any).e as PaymentError).code).toBe("VALIDATION_FAILED");
    }
    const counts = await settleIdemCounts(deps);
    expect(counts.records).toBe(0);
    expect((deps.paymentRepo as any).payments.size).toBe(0);
    expect((deps.audit as any).rows.length).toBe(0);
    // Document sequence not consumed
    expect((deps.documentSequence as any).rows.size).toBe(0);
  });

  // ===========================================================================
  // DRAFT-OWNER-3 — inactive owner → rejected; zero effects
  // ===========================================================================
  it("DRAFT-OWNER-3. inactive owner → OwnerNotActiveError; zero effects", async () => {
    const deps = makeDeps();
    const inactiveCustomer = "inactive-cust-" + randomUUID();
    deps.ownerAuthority.seed({
      tenantId: TEST_TENANT, ownerType: "customer",
      ownerId: inactiveCustomer, status: "inactive",
    });
    const user = makeUser();
    const eff = makeEff();
    const outcome = await deps.paymentService.createDraftPayment(user as any, eff as any, {
      ownerType: "customer",
      ownerId: inactiveCustomer,
      paymentDate: "2026-09-03",
      amount: "100.00",
      paymentDirection: "received_from_party",
      paymentMethod: "cash",
      idempotencyKey: "draft-owner-3-" + randomUUID(),
    }).then(v => ({ ok: true, v }), e => ({ ok: false, e }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(((outcome as any).e) instanceof OwnerNotActiveError).toBe(true);
      expect(((outcome as any).e as PaymentError).code).toBe("VALIDATION_FAILED");
    }
    const counts = await settleIdemCounts(deps);
    expect(counts.records).toBe(0);
    expect((deps.paymentRepo as any).payments.size).toBe(0);
    expect((deps.audit as any).rows.length).toBe(0);
  });

  // ===========================================================================
  // DRAFT-OWNER-4 — foreign-tenant owner ID → rejected without disclosure
  // ===========================================================================
  it("DRAFT-OWNER-4. foreign-tenant owner ID → OwnerNotFoundError (no cross-tenant disclosure)", async () => {
    const deps = makeDeps();
    const foreignTenant = "foreign-tenant-" + randomUUID();
    const foreignCustomerId = "foreign-cust-" + randomUUID();
    // Seed the foreign tenant's customer — but our lookup is scoped to the
    // caller's tenant, so this record is invisible to a caller in TEST_TENANT.
    deps.ownerAuthority.seed({
      tenantId: foreignTenant, ownerType: "customer",
      ownerId: foreignCustomerId, status: "active",
    });
    const user = makeUser(); // tenantId = TEST_TENANT
    const eff = makeEff();
    const outcome = await deps.paymentService.createDraftPayment(user as any, eff as any, {
      ownerType: "customer",
      ownerId: foreignCustomerId,
      paymentDate: "2026-09-03",
      amount: "100.00",
      paymentDirection: "received_from_party",
      paymentMethod: "cash",
      idempotencyKey: "draft-owner-4-" + randomUUID(),
    }).then(v => ({ ok: true, v }), e => ({ ok: false, e }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      // Same error class as a missing owner — no disclosure of cross-tenant existence.
      expect(((outcome as any).e) instanceof OwnerNotFoundError).toBe(true);
      expect(((outcome as any).e as PaymentError).code).toBe("VALIDATION_FAILED");
      // Message must NOT include the foreign tenant ID — only the ownerId + type.
      expect(((outcome as any).e as Error).message).not.toContain(foreignTenant);
    }
    const counts = await settleIdemCounts(deps);
    expect(counts.records).toBe(0);
    expect((deps.paymentRepo as any).payments.size).toBe(0);
  });

  // ===========================================================================
  // DRAFT-FAILURE-CLASSIFICATION — owner validation is business, not technical retry
  // ===========================================================================
  it("DRAFT-FAILURE-CLASSIFICATION. missing owner throws VALIDATION_FAILED directly, not retryable_failed", async () => {
    const deps = makeDeps();
    const user = makeUser();
    const eff = makeEff();
    const key = "draft-fail-class-" + randomUUID();
    // First call: missing owner — throws VALIDATION_FAILED directly.
    // Because owner validation runs BEFORE the idempotency claim, the
    // idempotency store has NO record of this key.
    const outcome1 = await deps.paymentService.createDraftPayment(user as any, eff as any, {
      ownerType: "customer",
      ownerId: "missing-" + randomUUID(),
      paymentDate: "2026-09-03",
      amount: "100.00",
      paymentDirection: "received_from_party",
      paymentMethod: "cash",
      idempotencyKey: key,
    }).then(v => ({ ok: true, v }), e => ({ ok: false, e }));
    expect(outcome1.ok).toBe(false);
    expect((outcome1 as any).e.code).toBe("VALIDATION_FAILED");
    // No idempotency record was created (Blocker D: deterministic business
    // rejection does NOT claim idempotency).
    const counts1 = await settleIdemCounts(deps);
    expect(counts1.records).toBe(0);

    // Second call with the SAME key but a valid owner — must succeed.
    // This proves the same key is immediately retryable because the first
    // call did NOT claim idempotency.
    const r2 = await deps.paymentService.createDraftPayment(user as any, eff as any, {
      ownerType: "customer",
      ownerId: TEST_CUSTOMER,
      paymentDate: "2026-09-03",
      amount: "100.00",
      paymentDirection: "received_from_party",
      paymentMethod: "cash",
      idempotencyKey: key,
    });
    expect(r2.status).toBe("draft");
    // Exactly one idempotency record was created (the successful one).
    const counts2 = await settleIdemCounts(deps);
    expect(counts2.records).toBe(1);
  });

  // ===========================================================================
  // DRAFT-MALFORMED-REPLAY — corrupted succeeded body → IDEMPOTENCY_INCONSISTENT
  // ===========================================================================
  it("DRAFT-MALFORMED-REPLAY. corrupted durable succeeded → IDEMPOTENCY_INCONSISTENT; no transactionRunner entry, zero effects", async () => {
    const deps = makeDeps();
    const user = makeUser();
    const eff = makeEff();
    const key = "draft-malformed-replay-" + randomUUID();

    // The request body that createDraftPayment will compute for our input.
    const draftRequestBody = {
      ownerType: "customer",
      ownerId: TEST_CUSTOMER,
      paymentDate: "2026-09-03",
      amount: "100.00",
      paymentDirection: "received_from_party",
      paymentMethod: "cash",
      currency: "EGP",
      notes: null,
    };

    // Pre-seed a succeeded idempotency record with malformed body fields.
    // The requestHash is computed correctly (so the claim returns "replay"),
    // but the responseBody is malformed (paymentId is a number, paymentNo is
    // empty, status is "posted" instead of "draft").
    seedIdempotencyRecord(deps, {
      operationScope: "payment.create_draft",
      idempotencyKey: key,
      requestBody: draftRequestBody,
      state: "succeeded",
      responseBody: { paymentId: 12345, paymentNo: "", status: "posted" },
      initiatedBy: user.userId,
    });

    const txRunCalls: number[] = [];
    const wrappedTxRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
      txRunCalls.push(1);
      return work(null);
    };
    const wrappedPaymentService = new PaymentService({
      paymentRepository: deps.paymentRepo,
      subledger: deps.subledger,
      audit: deps.audit,
      idempotency: deps.idempotency,
      documentSequence: deps.documentSequence,
      ownerAuthority: deps.ownerAuthority,
      transactionRunner: wrappedTxRunner,
      txFactories: {
        createSubledger: () => deps.subledger,
        createPaymentRepository: () => deps.paymentRepo,
        createAudit: () => deps.audit,
        createIdempotency: () => deps.idempotency,
        createDocumentSequence: () => deps.documentSequence,
      },
    });

    const outcome = await wrappedPaymentService.createDraftPayment(user as any, eff as any, {
      ownerType: "customer",
      ownerId: TEST_CUSTOMER,
      paymentDate: "2026-09-03",
      amount: "100.00",
      paymentDirection: "received_from_party",
      paymentMethod: "cash",
      idempotencyKey: key,
    }).then(v => ({ ok: true, v }), e => ({ ok: false, e }));

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(((outcome as any).e as PaymentError).code).toBe("IDEMPOTENCY_INCONSISTENT");
    }
    // Critical proof: transactionRunner was NOT entered
    expect(txRunCalls.length).toBe(0);
    // No new payment was inserted
    expect((deps.paymentRepo as any).payments.size).toBe(0);
    // No new audit was written
    expect((deps.audit as any).rows.length).toBe(0);
    // Document sequence not consumed
    expect((deps.documentSequence as any).rows.size).toBe(0);
    // attempt_count on the existing record is unchanged
    const store = (deps.idempotency as unknown as { records: Map<string, any> });
    const rec = [...store.records.values()][0];
    expect(rec.attemptCount).toBe(1);
  });

  // ===========================================================================
  // PAY-NOTFOUND-r24 — first NotFound after claim; durable replay
  // ===========================================================================
  it("PAY-NOTFOUND-r24. first locked NotFound → business_failed with exact code+message; durable replay after underlying state changes", async () => {
    const deps = makeDeps();
    const user = makeUser();
    const eff = makeEff();
    const missingPaymentId = "missing-payment-" + randomUUID();
    const key = "pay-notfound-r24-" + randomUUID();

    // First call: NotFound is thrown AFTER the idempotency claim (inside the
    // tx via lockPayment). The error is persisted as business_failed.
    const outcome1 = await deps.paymentService.postPayment(user as any, eff as any, {
      paymentId: missingPaymentId,
      idempotencyKey: key,
    }).then(v => ({ ok: true, v }), e => ({ ok: false, e }));
    expect(outcome1.ok).toBe(false);
    if (!outcome1.ok) {
      expect(((outcome1 as any).e as PaymentError).code).toBe("PAYMENT_NOT_FOUND");
      const msg1 = ((outcome1 as any).e as Error).message;
      expect(msg1).toContain(missingPaymentId);

      // Inspect the durable business_failed record
      const store = (deps.idempotency as unknown as { records: Map<string, any> });
      const rec = [...store.records.values()].find(
        (r) => r.tenantId === TEST_TENANT && r.operationScope === "payment.post" && r.idempotencyKey === key,
      );
      expect(rec).toBeTruthy();
      expect(rec.state).toBe("business_failed");
      expect(rec.responseBody.code).toBe("PAYMENT_NOT_FOUND");
      expect(rec.responseBody.message).toBe(msg1);

      // Now create a payment with the same ID (simulating the underlying
      // state changing). A naive retry would find it and post. But the
      // durable business_failed replay must throw the EXACT same error —
      // the retry MUST NOT re-execute.
      await deps.paymentRepo.insertPayment({
        tenantId: TEST_TENANT,
        paymentNo: "PAY-LATE-001",
        paymentDate: "2026-09-03",
        accountId: "acc-r24-fixture-0001",
        amount: "100.00",
        paymentDirection: "received_from_party",
        paymentMethod: "cash",
        status: "draft",
        notes: null,
        postedEntryId: null,
        idempotencyKey: "different-key",
        createdBy: user.userId,
      }).then((p: any) => {
        // Override the ID to match missingPaymentId so a naive re-execution
        // would find it.
        (deps.paymentRepo as any).payments.set(`${TEST_TENANT}:${missingPaymentId}`, { ...p, id: missingPaymentId });
      });

      // Second call: same key — MUST replay the exact same business_failed
      const outcome2 = await deps.paymentService.postPayment(user as any, eff as any, {
        paymentId: missingPaymentId,
        idempotencyKey: key,
      }).then(v => ({ ok: true, v }), e => ({ ok: false, e }));
      expect(outcome2.ok).toBe(false);
      if (!outcome2.ok) {
        expect(((outcome2 as any).e as PaymentError).code).toBe("PAYMENT_NOT_FOUND");
        expect(((outcome2 as any).e as Error).message).toBe(msg1); // exact same message
      }
      // attempt_count must be unchanged (replay does NOT increment)
      const rec2 = [...(deps.idempotency as unknown as { records: Map<string, any> })
        .records.values()].find(
          (r) => r.tenantId === TEST_TENANT && r.operationScope === "payment.post" && r.idempotencyKey === key,
        );
      expect(rec2.attemptCount).toBe(rec.attemptCount);
    }
  });

  // ===========================================================================
  // PAY-STATE-r24 — already-posted/non-draft locked state; durable replay
  // ===========================================================================
  it("PAY-STATE-r24. already-posted locked-state failure durably replays after underlying state changes", async () => {
    const deps = makeDeps();
    const user = makeUser();
    const eff = makeEff();
    const key = "pay-state-r24-" + randomUUID();

    // Seed a payment already in 'posted' state
    const postedPaymentId = "pay-state-r24-posted-" + randomUUID();
    (deps.paymentRepo as any).payments.set(`${TEST_TENANT}:${postedPaymentId}`, {
      id: postedPaymentId,
      tenantId: TEST_TENANT,
      paymentNo: "PAY-STATE-001",
      paymentDate: "2026-09-03",
      accountId: "acc-r24-state-001",
      amount: "100.00",
      paymentDirection: "received_from_party",
      paymentMethod: "cash",
      status: "posted",
      notes: null,
      postedEntryId: "entry-pre-existing-001",
      reversalOfPaymentId: null,
      idempotencyKey: "different-state-key",
      approvalRequestId: null,
      recordOrigin: "manual_live",
      recordPeriod: "live",
      isLocked: true,
      importBatchId: null,
      createdAt: new Date(),
      createdBy: user.userId,
      updatedAt: new Date(),
      updatedBy: user.userId,
    });

    const outcome1 = await deps.paymentService.postPayment(user as any, eff as any, {
      paymentId: postedPaymentId,
      idempotencyKey: key,
    }).then(v => ({ ok: true, v }), e => ({ ok: false, e }));
    expect(outcome1.ok).toBe(false);
    if (!outcome1.ok) {
      expect(((outcome1 as any).e as PaymentError).code).toBe("STATE_CONFLICT");
      const msg1 = ((outcome1 as any).e as Error).message;
      // Durable business_failed record exists with exact code+message
      const store = (deps.idempotency as unknown as { records: Map<string, any> });
      const rec = [...store.records.values()].find(
        (r) => r.tenantId === TEST_TENANT && r.operationScope === "payment.post" && r.idempotencyKey === key,
      );
      expect(rec.state).toBe("business_failed");
      expect(rec.responseBody.code).toBe("STATE_CONFLICT");
      expect(rec.responseBody.message).toBe(msg1);

      // Mutate the underlying payment back to draft — a naive retry would
      // now succeed. But the durable business_failed must replay exactly.
      const p = (deps.paymentRepo as any).payments.get(`${TEST_TENANT}:${postedPaymentId}`);
      (deps.paymentRepo as any).payments.set(`${TEST_TENANT}:${postedPaymentId}`, { ...p, status: "draft" });

      const outcome2 = await deps.paymentService.postPayment(user as any, eff as any, {
        paymentId: postedPaymentId,
        idempotencyKey: key,
      }).then(v => ({ ok: true, v }), e => ({ ok: false, e }));
      expect(outcome2.ok).toBe(false);
      if (!outcome2.ok) {
        expect(((outcome2 as any).e as PaymentError).code).toBe("STATE_CONFLICT");
        expect(((outcome2 as any).e as Error).message).toBe(msg1);
      }
    }
  });

  // ===========================================================================
  // MONEY-RANGE-r24 — isValidCanonicalMoney 18,2 range tests
  // ===========================================================================
  describe("MONEY-RANGE-r24", () => {
    // NUMERIC(18,2) means up to 18 total significant digits, so 16 integer
    // digits + 2 fractional digits. Max value = 9999999999999999.99.
    it("accepts max 18,2 value (9999999999999999.99)", () => {
      expect(isValidCanonicalMoney("9999999999999999.99")).toBe(true);
    });
    it("accepts max with leading zeros (09999999999999999.99)", () => {
      // Leading zeros allowed — numeric value is checked, not string length.
      // 09999999999999999.99 = 9999999999999999.99 numerically — within range.
      expect(isValidCanonicalMoney("09999999999999999.99")).toBe(true);
    });
    it("rejects above max (10000000000000000.00)", () => {
      // 17 integer digits → out of NUMERIC(18,2) range
      expect(isValidCanonicalMoney("10000000000000000.00")).toBe(false);
    });
    it("rejects huge integer (99999999999999999999.99)", () => {
      // 20 integer digits → out of NUMERIC(18,2) range
      expect(isValidCanonicalMoney("99999999999999999999.99")).toBe(false);
    });
    it("accepts max negative (-9999999999999999.99)", () => {
      expect(isValidCanonicalMoney("-9999999999999999.99")).toBe(true);
    });
    it("rejects malformed syntax ('10.999')", () => {
      expect(isValidCanonicalMoney("10.999")).toBe(false);
    });
    it("rejects malformed syntax ('10.0')", () => {
      expect(isValidCanonicalMoney("10.0")).toBe(false);
    });
    it("rejects malformed syntax ('abc')", () => {
      expect(isValidCanonicalMoney("abc")).toBe(false);
    });
  });

  // ===========================================================================
  // SETTLE-SHAPE-r24 — allocation shape validation before claim
  // ===========================================================================
  describe("SETTLE-SHAPE-r24", () => {
    async function settleExpectingError(allocations: any): Promise<{ code: string; records: number }> {
      const deps = makeDeps();
      const user = makeUser();
      const eff = makeEff();
      const outcome = await deps.settlementService.settlePayment(user as any, eff as any, {
        paymentId: "any-payment-" + randomUUID(),
        allocations,
        idempotencyKey: "settle-shape-" + randomUUID(),
      }).then(v => ({ ok: true, v }), e => ({ ok: false, e }));
      expect(outcome.ok).toBe(false);
      const records = (deps.idempotency as unknown as { records: Map<string, unknown> }).records.size;
      return { code: (outcome as any).e.code, records };
    }

    it("rejects allocations that is not an array (object)", async () => {
      const r = await settleExpectingError({ settledEntryId: "x", settledAmount: "1.00" });
      expect(r.code).toBe("VALIDATION_FAILED");
      expect(r.records).toBe(0);
    });
    it("rejects allocations that is a string", async () => {
      const r = await settleExpectingError("not-an-array");
      expect(r.code).toBe("VALIDATION_FAILED");
      expect(r.records).toBe(0);
    });
    it("rejects null member in allocations", async () => {
      const r = await settleExpectingError([null]);
      expect(r.code).toBe("VALIDATION_FAILED");
      expect(r.records).toBe(0);
    });
    it("rejects missing settledEntryId", async () => {
      const r = await settleExpectingError([{ settledAmount: "1.00" }]);
      expect(r.code).toBe("VALIDATION_FAILED");
      expect(r.records).toBe(0);
    });
    it("rejects whitespace settledEntryId", async () => {
      const r = await settleExpectingError([{ settledEntryId: "   ", settledAmount: "1.00" }]);
      expect(r.code).toBe("VALIDATION_FAILED");
      expect(r.records).toBe(0);
    });
    it("rejects non-string settledAmount (number)", async () => {
      const r = await settleExpectingError([{ settledEntryId: "e1", settledAmount: 1.00 }]);
      expect(r.code).toBe("VALIDATION_FAILED");
      expect(r.records).toBe(0);
    });
    it("rejects malformed settledAmount ('10.999')", async () => {
      const r = await settleExpectingError([{ settledEntryId: "e1", settledAmount: "10.999" }]);
      expect(r.code).toBe("VALIDATION_FAILED");
      expect(r.records).toBe(0);
    });
  });

  // ===========================================================================
  // BUSINESS-FAILED-TYPES — hardened runtime type checks (Blocker E)
  // ===========================================================================
  describe("BUSINESS-FAILED-TYPES (Blocker E)", () => {
    async function seedBusinessFailedAndReplay(
      operationScope: string,
      key: string,
      requestBody: Record<string, unknown>,
      responseBody: any,
      expectCode: string,
    ): Promise<void> {
      const deps = makeDeps();
      seedIdempotencyRecord(deps, {
        operationScope,
        idempotencyKey: key,
        requestBody,
        state: "business_failed",
        responseBody,
        initiatedBy: "test",
      });

      const user = makeUser();
      const eff = makeEff();
      let caught: any;
      if (operationScope === "payment.post") {
        try {
          await deps.paymentService.postPayment(user as any, eff as any,
            { paymentId: (requestBody.paymentId as string) ?? "any", idempotencyKey: key });
        } catch (e) { caught = e; }
      } else if (operationScope === "payment.reverse") {
        try {
          await deps.reversalService.reversePayment(user as any, eff as any,
            { paymentId: (requestBody.paymentId as string) ?? "any",
              reason: (requestBody.reason as string) ?? "any",
              idempotencyKey: key });
        } catch (e) { caught = e; }
      } else if (operationScope === "payment.settle") {
        try {
          await deps.settlementService.settlePayment(user as any, eff as any,
            { paymentId: (requestBody.paymentId as string) ?? "any",
              allocations: [{ settledEntryId: "e1", settledAmount: "1.00" }],
              idempotencyKey: key });
        } catch (e) { caught = e; }
      } else if (operationScope === "payment.create_draft") {
        try {
          await deps.paymentService.createDraftPayment(user as any, eff as any,
            { ownerType: "customer", ownerId: TEST_CUSTOMER, paymentDate: "2026-09-03",
              amount: "1.00", paymentDirection: "received_from_party", paymentMethod: "cash",
              idempotencyKey: key });
        } catch (e) { caught = e; }
      }
      expect(caught).toBeTruthy();
      expect((caught as PaymentError | PaymentReversalError | SettlementError).code).toBe(expectCode);
    }

    it("payment.post: code is a number → IDEMPOTENCY_INCONSISTENT", async () => {
      await seedBusinessFailedAndReplay("payment.post", "bf-num-" + randomUUID(),
        { paymentId: "any", notes: null },
        { code: 12345, message: "msg" }, "IDEMPOTENCY_INCONSISTENT");
    });
    it("payment.post: message is null → IDEMPOTENCY_INCONSISTENT", async () => {
      await seedBusinessFailedAndReplay("payment.post", "bf-null-" + randomUUID(),
        { paymentId: "any", notes: null },
        { code: "X", message: null }, "IDEMPOTENCY_INCONSISTENT");
    });
    it("payment.post: code is empty string → IDEMPOTENCY_INCONSISTENT", async () => {
      await seedBusinessFailedAndReplay("payment.post", "bf-empty-" + randomUUID(),
        { paymentId: "any", notes: null },
        { code: "   ", message: "msg" }, "IDEMPOTENCY_INCONSISTENT");
    });
    it("payment.post: message is whitespace → IDEMPOTENCY_INCONSISTENT", async () => {
      await seedBusinessFailedAndReplay("payment.post", "bf-ws-" + randomUUID(),
        { paymentId: "any", notes: null },
        { code: "X", message: "   " }, "IDEMPOTENCY_INCONSISTENT");
    });
    it("payment.reverse: code is an object → IDEMPOTENCY_INCONSISTENT", async () => {
      await seedBusinessFailedAndReplay("payment.reverse", "bf-obj-" + randomUUID(),
        { paymentId: "any", reason: "any", notes: null },
        { code: { x: 1 }, message: "msg" }, "IDEMPOTENCY_INCONSISTENT");
    });
    it("payment.settle: code is an array → IDEMPOTENCY_INCONSISTENT", async () => {
      // settlePayment computes requestBody.allocations via normalizeMoney,
      // so we must match what it produces for "1.00" — which is "1.00".
      await seedBusinessFailedAndReplay("payment.settle", "bf-arr-" + randomUUID(),
        { paymentId: "any",
          allocations: [{ settledEntryId: "e1", settledAmount: "1.00" }],
          notes: null },
        { code: ["X"], message: "msg" }, "IDEMPOTENCY_INCONSISTENT");
    });
    it("payment.create_draft: code is null → IDEMPOTENCY_INCONSISTENT", async () => {
      await seedBusinessFailedAndReplay("payment.create_draft", "bf-draft-" + randomUUID(),
        { ownerType: "customer", ownerId: TEST_CUSTOMER, paymentDate: "2026-09-03",
          amount: "1.00", paymentDirection: "received_from_party", paymentMethod: "cash",
          currency: "EGP", notes: null },
        { code: null, message: "msg" }, "IDEMPOTENCY_INCONSISTENT");
    });
    it("payment.post: well-formed code+message → exact replay", async () => {
      // Sanity: well-formed body still replays the exact code.
      await seedBusinessFailedAndReplay("payment.post", "bf-good-" + randomUUID(),
        { paymentId: "any", notes: null },
        { code: "VALIDATION_FAILED", message: "test message" }, "VALIDATION_FAILED");
    });
  });

  // ===========================================================================
  // SUCCEEDED-TYPES — hardened runtime identifier types (Blocker F)
  // ===========================================================================
  describe("SUCCEEDED-TYPES (Blocker F)", () => {
    async function seedSucceededAndReplayPaymentPost(
      key: string, responseBody: any, expectCode: string,
    ): Promise<void> {
      const deps = makeDeps();
      seedIdempotencyRecord(deps, {
        operationScope: "payment.post",
        idempotencyKey: key,
        requestBody: { paymentId: "any", notes: null },
        state: "succeeded",
        responseBody,
        initiatedBy: "test",
      });
      const user = makeUser();
      const eff = makeEff();
      let caught: any;
      try {
        await deps.paymentService.postPayment(user as any, eff as any,
          { paymentId: "any", idempotencyKey: key });
      } catch (e) { caught = e; }
      expect(caught).toBeTruthy();
      expect((caught as PaymentError).code).toBe(expectCode);
    }

    it("paymentId is a number → IDEMPOTENCY_INCONSISTENT", async () => {
      await seedSucceededAndReplayPaymentPost("suc-num-" + randomUUID(),
        { action: "posted", paymentId: 12345, paymentNo: "P-1", status: "posted",
          postedEntryId: "e1", entryNo: "E-1", amountSigned: "-100.00", accountId: "a1" },
        "IDEMPOTENCY_INCONSISTENT");
    });
    it("paymentNo is empty string → IDEMPOTENCY_INCONSISTENT", async () => {
      await seedSucceededAndReplayPaymentPost("suc-empty-" + randomUUID(),
        { action: "posted", paymentId: "p1", paymentNo: "", status: "posted",
          postedEntryId: "e1", entryNo: "E-1", amountSigned: "-100.00", accountId: "a1" },
        "IDEMPOTENCY_INCONSISTENT");
    });
    it("postedEntryId is null → IDEMPOTENCY_INCONSISTENT", async () => {
      await seedSucceededAndReplayPaymentPost("suc-null-" + randomUUID(),
        { action: "posted", paymentId: "p1", paymentNo: "P-1", status: "posted",
          postedEntryId: null, entryNo: "E-1", amountSigned: "-100.00", accountId: "a1" },
        "IDEMPOTENCY_INCONSISTENT");
    });
    it("entryNo is a number → IDEMPOTENCY_INCONSISTENT", async () => {
      await seedSucceededAndReplayPaymentPost("suc-entrynum-" + randomUUID(),
        { action: "posted", paymentId: "p1", paymentNo: "P-1", status: "posted",
          postedEntryId: "e1", entryNo: 42, amountSigned: "-100.00", accountId: "a1" },
        "IDEMPOTENCY_INCONSISTENT");
    });
    it("amountSigned is empty string → IDEMPOTENCY_INCONSISTENT", async () => {
      await seedSucceededAndReplayPaymentPost("suc-amt-" + randomUUID(),
        { action: "posted", paymentId: "p1", paymentNo: "P-1", status: "posted",
          postedEntryId: "e1", entryNo: "E-1", amountSigned: "", accountId: "a1" },
        "IDEMPOTENCY_INCONSISTENT");
    });
    it("accountId is undefined → IDEMPOTENCY_INCONSISTENT", async () => {
      await seedSucceededAndReplayPaymentPost("suc-acc-" + randomUUID(),
        { action: "posted", paymentId: "p1", paymentNo: "P-1", status: "posted",
          postedEntryId: "e1", entryNo: "E-1", amountSigned: "-100.00" },
        "IDEMPOTENCY_INCONSISTENT");
    });
  });
});
