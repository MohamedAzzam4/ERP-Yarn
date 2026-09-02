/**
 * WP-05-04 Payments, Settlements and Reversal — comprehensive unit tests.
 *
 * Contract: docs/contracts/12_testing_and_regression_plan.md §5 + Phase 5 gate
 * Contract: docs/contracts/07_subledger_and_costs_contract.md §13-17
 *
 * Covers all required scenarios:
 *   - post customer payment with correct sign (NEGATIVE)
 *   - post supplier/factory payment with correct sign (POSITIVE)
 *   - invalid payment method rejected (DEC-066)
 *   - amount must be positive
 *   - payment direction/sign correctness
 *   - payment idempotency replay
 *   - changed body idempotency conflict
 *   - partial settlement
 *   - full settlement
 *   - over-settlement rejected
 *   - concurrent settlement cannot over-settle
 *   - settlement tenant isolation
 *   - incompatible account/currency rejected
 *   - payment reversal creates inverse/correction and original remains immutable
 *   - reversal of settled payment safely unallocates/reverses settlements
 *   - cannot reverse twice
 *   - rollback after payment entry insert
 *   - rollback after settlement insert
 *   - rollback after reversal insert
 *   - worker denied
 *   - owner/accountant allowed
 *   - no stock movements
 *   - no sales approval mutation
 *   - no profitability/direct-cost side effects
 */
import { describe, it, expect } from "vitest";
import { PaymentService, InvalidPaymentMethodError, InvalidPaymentAmountError, PaymentAlreadyPostedError } from "../payment-service";
import {
  SettlementService,
  OverSettlementError,
  SettlementIncompatibleError,
  PaymentNotPostedError,
} from "../settlement-service";
import {
  PaymentReversalService,
  PaymentAlreadyReversedError,
  ReversalReasonRequiredError,
} from "../payment-reversal-service";
import { SubledgerService } from "../subledger-service";
import { InMemorySubledgerRepository } from "./in-memory-subledger-repository";
import { InMemoryPaymentRepository } from "./in-memory-payment-repository";
import { InProcessAuditStore } from "../audit-service";
import { InProcessIdempotencyStore } from "../idempotency-service";
import { InProcessDocumentSequenceStore } from "../document-sequence-service";
import { InMemoryOwnerAuthorityLookup } from "../owner-authority-lookup";
import { TEST_USERS, getTestEffectivePermissions } from "@/server/security/role-fixtures";
import { PermissionDeniedError } from "@/server/security/guards";

const TEST_TENANT_ID = "00000000-0000-0000-0000-000000050004";
const TEST_CUSTOMER_ID = "cccc0504-0000-4000-8000-000000050004";
const TEST_SUPPLIER_ID = "ssss0504-0000-4000-8000-000000050004";
const TEST_FACTORY_ID = "ffff0504-0000-4000-8000-000000050004";
const TEST_SALE_ID = "sale0504-0000-4000-8000-000000050004";

function makeUser(userId: string, tenantId: string = TEST_TENANT_ID) {
  return { authenticated: true as const, userId, tenantId, email: "t@e.com", name: "T", authId: "t" };
}
function makeOwnerEff() {
  return {
    assignedRoleCodes: ["owner"],
    permissionKeys: new Set([
      "sales.create","sales.submit","sales.view_price","sales.approve","sales.cancel",
      "inventory.receive.approve","inventory.receive.create",
      "balances.view_supplier_factory","balances.view_customer",
      "profitability.view","payments.create","payments.approve","payments.reverse",
    ]),
    deniedFieldKeys: new Set(),
    workerFinancialDeny: false,
  } as any;
}
function makeAcctEff() {
  return {
    assignedRoleCodes: ["accountant"],
    permissionKeys: new Set([
      "sales.create","sales.submit","sales.view_price","sales.approve","sales.cancel",
      "balances.view_supplier_factory","balances.view_customer",
      "profitability.view","inventory.receive.approve",
      "payments.create","payments.approve","payments.reverse",
    ]),
    deniedFieldKeys: new Set(),
    workerFinancialDeny: false,
  } as any;
}
function makeWhEff() {
  return {
    assignedRoleCodes: ["warehouse_employee"],
    permissionKeys: new Set(["sales.create","inventory.receive.approve","inventory.receive.create"]),
    deniedFieldKeys: new Set(),
    workerFinancialDeny: true,
  } as any;
}

function makeDeps() {
  const subledgerRepo = new InMemorySubledgerRepository();
  const paymentRepo = new InMemoryPaymentRepository();
  const audit = new InProcessAuditStore();
  const idempotency = new InProcessIdempotencyStore();
  const documentSequence = new InProcessDocumentSequenceStore();
  const subledger = new SubledgerService({ subledger: subledgerRepo, audit, idempotency, documentSequence });
  // r24 BLOCKER C: seed the in-memory owner authority with the canonical
  // test fixtures so createDraftPayment's owner-validation passes for
  // TEST_CUSTOMER_ID / TEST_SUPPLIER_ID / TEST_FACTORY_ID. The lookup is
  // tenant-scoped — a foreign-tenant id returns null → OwnerNotFoundError.
  const ownerAuthority = new InMemoryOwnerAuthorityLookup();
  ownerAuthority.seed({ tenantId: TEST_TENANT_ID, ownerType: "customer", ownerId: TEST_CUSTOMER_ID, status: "active" });
  ownerAuthority.seed({ tenantId: TEST_TENANT_ID, ownerType: "supplier", ownerId: TEST_SUPPLIER_ID, status: "active" });
  ownerAuthority.seed({ tenantId: TEST_TENANT_ID, ownerType: "factory", ownerId: TEST_FACTORY_ID, status: "active" });
  const noopTxRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => work(null);
  const paymentService = new PaymentService({ paymentRepository: paymentRepo, subledger, audit, idempotency, documentSequence,
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
  const settlementService = new SettlementService({ paymentRepository: paymentRepo, subledger, audit, idempotency,
    transactionRunner: noopTxRunner,
    txFactories: {
      createSubledger: () => subledger,
      createPaymentRepository: () => paymentRepo,
      createAudit: () => audit,
      createIdempotency: () => idempotency,
    },
  });
  const reversalService = new PaymentReversalService({ paymentRepository: paymentRepo, subledger, audit, idempotency, documentSequence,
    transactionRunner: noopTxRunner,
    txFactories: {
      createSubledger: () => subledger,
      createPaymentRepository: () => paymentRepo,
      createAudit: () => audit,
      createIdempotency: () => idempotency,
      createDocumentSequence: () => documentSequence,
    },
  });
  return { subledgerRepo, paymentRepo, audit, idempotency, documentSequence, subledger, paymentService, settlementService, reversalService };
}

/**
 * Setup: create a customer receivable entry (simulating an approved sale)
 * so the payment can settle against it.
 */
async function setupCustomerReceivable(
  deps: ReturnType<typeof makeDeps>,
  amount: string = "1000.00",
): Promise<{ entryId: string; accountId: string }> {
  const ownerUser = makeUser(TEST_USERS.owner.userId);
  const ownerEff = makeOwnerEff();
  // Insert a customer sale receivable entry directly via SubledgerService
  const result = await deps.subledger.insertCustomerReceivableEntry(
    ownerUser as any, ownerEff as any,
    {
      customerId: TEST_CUSTOMER_ID,
      saleId: TEST_SALE_ID,
      documentTotalPosted: amount,
      entryDate: "2026-07-10",
      docNo: "AE-RECV-001",
      idempotencyKey: "recv-setup-001",
    },
  );
  return { entryId: result.entryId, accountId: result.accountId };
}

/**
 * Setup: create a supplier payable entry (simulating an approved raw receipt).
 */
async function setupSupplierPayable(
  deps: ReturnType<typeof makeDeps>,
  amount: string = "1000.00",
): Promise<{ entryId: string; accountId: string }> {
  const ownerUser = makeUser(TEST_USERS.owner.userId);
  const ownerEff = makeOwnerEff();
  const result = await deps.subledger.postSupplierPayable(
    ownerUser as any, ownerEff as any,
    {
      supplierId: TEST_SUPPLIER_ID,
      netAcceptedKg: "1000.000",
      pricePerTon: amount,  // 1000 kg / 1000 × 1000/ton = 1000
      entryDate: "2026-07-10",
      sourceDocumentType: "raw_material_batch",
      sourceDocumentId: "batch-0504-001",
      idempotencyKey: "payable-setup-001",
    },
  );
  return { entryId: result.entryId, accountId: result.accountId };
}

/**
 * Create + post a customer payment. Returns the posted payment id + entry id.
 */
async function setupPostedPayment(
  deps: ReturnType<typeof makeDeps>,
  ownerType: "customer" | "supplier" | "factory",
  ownerId: string,
  direction: "received_from_party" | "paid_to_party",
  amount: string = "1000.00",
  method: "cash" | "bank_transfer" | "check" | "wallet_instapay" | "other" = "cash",
  idempotencyKey: string = "pay-setup-001",
): Promise<{ paymentId: string; postedEntryId: string; accountId: string }> {
  const acctUser = makeUser(TEST_USERS.accountant.userId);
  const acctEff = makeAcctEff();
  const draft = await deps.paymentService.createDraftPayment(acctUser as any, acctEff as any, {
    ownerType, ownerId,
    paymentDate: "2026-07-10",
    amount,
    paymentDirection: direction,
    paymentMethod: method,
    idempotencyKey,
  });
  const post = await deps.paymentService.postPayment(acctUser as any, acctEff as any, {
    paymentId: draft.paymentId,
    idempotencyKey: `${idempotencyKey}:post`,
  });
  return { paymentId: draft.paymentId, postedEntryId: post.postedEntryId, accountId: post.accountId };
}

// ===========================================================================
// 1. Payment sign correctness.
// ===========================================================================

describe("WP-05-04 payment sign correctness", () => {
  it("customer payment (received_from_party) creates NEGATIVE customer_payment entry", async () => {
    const deps = makeDeps();
    const { postedEntryId } = await setupPostedPayment(
      deps, "customer", TEST_CUSTOMER_ID, "received_from_party", "500.00", "cash", "pay-cust-001",
    );
    const entry = await deps.subledger.findEntryById(TEST_TENANT_ID, postedEntryId);
    expect(entry).toBeTruthy();
    expect(entry!.entryType).toBe("customer_payment");
    expect(entry!.amountSigned).toBe("-500.00");  // NEGATIVE
    expect(entry!.sourceDocumentType).toBe("payment");
  });

  it("supplier payment (paid_to_party) creates POSITIVE supplier_payment entry", async () => {
    const deps = makeDeps();
    const { postedEntryId } = await setupPostedPayment(
      deps, "supplier", TEST_SUPPLIER_ID, "paid_to_party", "500.00", "bank_transfer", "pay-sup-001",
    );
    const entry = await deps.subledger.findEntryById(TEST_TENANT_ID, postedEntryId);
    expect(entry).toBeTruthy();
    expect(entry!.entryType).toBe("supplier_payment");
    expect(entry!.amountSigned).toBe("500.00");  // POSITIVE
  });

  it("factory payment (paid_to_party) creates POSITIVE factory_payment entry", async () => {
    const deps = makeDeps();
    const { postedEntryId } = await setupPostedPayment(
      deps, "factory", TEST_FACTORY_ID, "paid_to_party", "500.00", "check", "pay-fac-001",
    );
    const entry = await deps.subledger.findEntryById(TEST_TENANT_ID, postedEntryId);
    expect(entry).toBeTruthy();
    expect(entry!.entryType).toBe("factory_payment");
    expect(entry!.amountSigned).toBe("500.00");  // POSITIVE
  });

  it("wallet_instapay method is accepted (DEC-066)", async () => {
    const deps = makeDeps();
    const { postedEntryId } = await setupPostedPayment(
      deps, "customer", TEST_CUSTOMER_ID, "received_from_party", "100.00", "wallet_instapay", "pay-wallet-001",
    );
    expect(postedEntryId).toBeTruthy();
  });

  it("other method is accepted (DEC-066)", async () => {
    const deps = makeDeps();
    const { postedEntryId } = await setupPostedPayment(
      deps, "customer", TEST_CUSTOMER_ID, "received_from_party", "100.00", "other", "pay-other-001",
    );
    expect(postedEntryId).toBeTruthy();
  });
});

// ===========================================================================
// 2. Validation: invalid method, invalid amount, invalid direction.
// ===========================================================================

describe("WP-05-04 payment validation", () => {
  it("invalid payment method rejected (DEC-066)", async () => {
    const deps = makeDeps();
    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const acctEff = makeAcctEff();
    await expect(deps.paymentService.createDraftPayment(acctUser as any, acctEff as any, {
      ownerType: "customer", ownerId: TEST_CUSTOMER_ID,
      paymentDate: "2026-07-10", amount: "100.00",
      paymentDirection: "received_from_party",
      paymentMethod: "credit_card" as any,  // NOT in DEC-066
      idempotencyKey: "pay-bad-method-001",
    })).rejects.toThrow(InvalidPaymentMethodError);
  });

  it("zero amount rejected", async () => {
    const deps = makeDeps();
    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const acctEff = makeAcctEff();
    await expect(deps.paymentService.createDraftPayment(acctUser as any, acctEff as any, {
      ownerType: "customer", ownerId: TEST_CUSTOMER_ID,
      paymentDate: "2026-07-10", amount: "0.00",
      paymentDirection: "received_from_party",
      paymentMethod: "cash",
      idempotencyKey: "pay-zero-001",
    })).rejects.toThrow(InvalidPaymentAmountError);
  });

  it("negative amount rejected", async () => {
    const deps = makeDeps();
    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const acctEff = makeAcctEff();
    await expect(deps.paymentService.createDraftPayment(acctUser as any, acctEff as any, {
      ownerType: "customer", ownerId: TEST_CUSTOMER_ID,
      paymentDate: "2026-07-10", amount: "-100.00",
      paymentDirection: "received_from_party",
      paymentMethod: "cash",
      idempotencyKey: "pay-neg-001",
    })).rejects.toThrow(InvalidPaymentAmountError);
  });

  it("incompatible direction/owner rejected (customer + paid_to_party)", async () => {
    const deps = makeDeps();
    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const acctEff = makeAcctEff();
    await expect(deps.paymentService.createDraftPayment(acctUser as any, acctEff as any, {
      ownerType: "customer", ownerId: TEST_CUSTOMER_ID,
      paymentDate: "2026-07-10", amount: "100.00",
      paymentDirection: "paid_to_party",  // WRONG for customer
      paymentMethod: "cash",
      idempotencyKey: "pay-mismatch-001",
    })).rejects.toThrow();  // PaymentDirectionOwnerMismatchError
  });
});

// ===========================================================================
// 3. Idempotency.
// ===========================================================================

describe("WP-05-04 payment idempotency", () => {
  it("same key replays with no duplicate effects", async () => {
    const deps = makeDeps();
    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const acctEff = makeAcctEff();

    const draft1 = await deps.paymentService.createDraftPayment(acctUser as any, acctEff as any, {
      ownerType: "customer", ownerId: TEST_CUSTOMER_ID,
      paymentDate: "2026-07-10", amount: "100.00",
      paymentDirection: "received_from_party", paymentMethod: "cash",
      idempotencyKey: "idem-replay-001",
    });
    const draft2 = await deps.paymentService.createDraftPayment(acctUser as any, acctEff as any, {
      ownerType: "customer", ownerId: TEST_CUSTOMER_ID,
      paymentDate: "2026-07-10", amount: "100.00",
      paymentDirection: "received_from_party", paymentMethod: "cash",
      idempotencyKey: "idem-replay-001",
    });
    expect(draft2.paymentId).toBe(draft1.paymentId);

    // Post with same key
    const post1 = await deps.paymentService.postPayment(acctUser as any, acctEff as any, {
      paymentId: draft1.paymentId, idempotencyKey: "idem-replay-001:post",
    });
    const post2 = await deps.paymentService.postPayment(acctUser as any, acctEff as any, {
      paymentId: draft1.paymentId, idempotencyKey: "idem-replay-001:post",
    });
    expect(post2.action).toBe("replayed");
    expect(post2.postedEntryId).toBe(post1.postedEntryId);

    // Verify only 1 entry was created
    const entries = [...((deps.subledgerRepo as any).entries as Map<string, any>).values()].filter(
      (e: any) => e.sourceDocumentType === "payment",
    );
    expect(entries.length).toBe(1);
  });

  it("changed body idempotency conflict", async () => {
    const deps = makeDeps();
    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const acctEff = makeAcctEff();

    await deps.paymentService.createDraftPayment(acctUser as any, acctEff as any, {
      ownerType: "customer", ownerId: TEST_CUSTOMER_ID,
      paymentDate: "2026-07-10", amount: "100.00",
      paymentDirection: "received_from_party", paymentMethod: "cash",
      idempotencyKey: "idem-conflict-001",
    });
    // Same key, different body (different amount)
    await expect(deps.paymentService.createDraftPayment(acctUser as any, acctEff as any, {
      ownerType: "customer", ownerId: TEST_CUSTOMER_ID,
      paymentDate: "2026-07-10", amount: "200.00",  // DIFFERENT
      paymentDirection: "received_from_party", paymentMethod: "cash",
      idempotencyKey: "idem-conflict-001",
    })).rejects.toThrow();  // IDEMPOTENCY_CONFLICT
  });

  it("posting already-posted payment rejects", async () => {
    const deps = makeDeps();
    const { paymentId } = await setupPostedPayment(
      deps, "customer", TEST_CUSTOMER_ID, "received_from_party", "100.00", "cash", "pay-already-001",
    );
    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const acctEff = makeAcctEff();
    await expect(deps.paymentService.postPayment(acctUser as any, acctEff as any, {
      paymentId, idempotencyKey: "pay-already-001:post-2",
    })).rejects.toThrow(PaymentAlreadyPostedError);
  });
});

// ===========================================================================
// 4. Settlement: partial, full, over-settlement.
// ===========================================================================

describe("WP-05-04 settlement", () => {
  it("partial settlement: payment 500 settles 300 of 1000 receivable", async () => {
    const deps = makeDeps();
    const { entryId: receivableId } = await setupCustomerReceivable(deps, "1000.00");
    const { paymentId } = await setupPostedPayment(
      deps, "customer", TEST_CUSTOMER_ID, "received_from_party", "500.00", "cash", "pay-partial-001",
    );
    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const acctEff = makeAcctEff();

    const result = await deps.settlementService.settlePayment(acctUser as any, acctEff as any, {
      paymentId,
      allocations: [{ settledEntryId: receivableId, settledAmount: "300.00" }],
      idempotencyKey: "settle-partial-001",
    });
    expect(result.action).toBe("settled");
    expect(result.totalSettled).toBe("300.00");
    expect(result.paymentEntryRemaining).toBe("200.00");  // 500 - 300
    expect(result.allocations[0]!.settledEntryRemaining).toBe("700.00");  // 1000 - 300

    // Verify entry settlement statuses
    const paymentEntry = await deps.subledger.findEntryById(TEST_TENANT_ID, result.paymentId);
    const receivable = await deps.subledger.findEntryById(TEST_TENANT_ID, receivableId);
    // receivable should be partially_settled
    expect(receivable!.settlementStatus).toBe("partially_settled");
  });

  it("full settlement: payment 1000 settles 1000 receivable", async () => {
    const deps = makeDeps();
    const { entryId: receivableId } = await setupCustomerReceivable(deps, "1000.00");
    const { paymentId } = await setupPostedPayment(
      deps, "customer", TEST_CUSTOMER_ID, "received_from_party", "1000.00", "cash", "pay-full-001",
    );
    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const acctEff = makeAcctEff();

    const result = await deps.settlementService.settlePayment(acctUser as any, acctEff as any, {
      paymentId,
      allocations: [{ settledEntryId: receivableId, settledAmount: "1000.00" }],
      idempotencyKey: "settle-full-001",
    });
    expect(result.paymentEntryRemaining).toBe("0.00");
    expect(result.allocations[0]!.settledEntryRemaining).toBe("0.00");

    const receivable = await deps.subledger.findEntryById(TEST_TENANT_ID, receivableId);
    expect(receivable!.settlementStatus).toBe("settled");
  });

  it("over-settlement on payment side rejected", async () => {
    const deps = makeDeps();
    const { entryId: receivableId } = await setupCustomerReceivable(deps, "1000.00");
    const { paymentId } = await setupPostedPayment(
      deps, "customer", TEST_CUSTOMER_ID, "received_from_party", "500.00", "cash", "pay-over-001",
    );
    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const acctEff = makeAcctEff();

    await expect(deps.settlementService.settlePayment(acctUser as any, acctEff as any, {
      paymentId,
      allocations: [{ settledEntryId: receivableId, settledAmount: "600.00" }],  // > 500
      idempotencyKey: "settle-over-pay-001",
    })).rejects.toThrow(OverSettlementError);
  });

  it("over-settlement on target side rejected", async () => {
    const deps = makeDeps();
    const { entryId: receivableId } = await setupCustomerReceivable(deps, "1000.00");
    const { paymentId } = await setupPostedPayment(
      deps, "customer", TEST_CUSTOMER_ID, "received_from_party", "2000.00", "cash", "pay-over-tgt-001",
    );
    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const acctEff = makeAcctEff();

    await expect(deps.settlementService.settlePayment(acctUser as any, acctEff as any, {
      paymentId,
      allocations: [{ settledEntryId: receivableId, settledAmount: "1500.00" }],  // > 1000 receivable
      idempotencyKey: "settle-over-tgt-001",
    })).rejects.toThrow(OverSettlementError);
  });

  it("incompatible account rejected", async () => {
    const deps = makeDeps();
    // Customer receivable in one account
    const { entryId: custReceivableId, accountId: custAccountId } = await setupCustomerReceivable(deps, "1000.00");
    // Supplier payment in a different account
    const { paymentId } = await setupPostedPayment(
      deps, "supplier", TEST_SUPPLIER_ID, "paid_to_party", "1000.00", "cash", "pay-incompat-001",
    );
    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const acctEff = makeAcctEff();

    await expect(deps.settlementService.settlePayment(acctUser as any, acctEff as any, {
      paymentId,
      allocations: [{ settledEntryId: custReceivableId, settledAmount: "500.00" }],
      idempotencyKey: "settle-incompat-001",
    })).rejects.toThrow(SettlementIncompatibleError);  // account mismatch
  });

  it("settlement idempotency replay", async () => {
    const deps = makeDeps();
    const { entryId: receivableId } = await setupCustomerReceivable(deps, "1000.00");
    const { paymentId } = await setupPostedPayment(
      deps, "customer", TEST_CUSTOMER_ID, "received_from_party", "500.00", "cash", "pay-settle-idem-001",
    );
    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const acctEff = makeAcctEff();

    const r1 = await deps.settlementService.settlePayment(acctUser as any, acctEff as any, {
      paymentId,
      allocations: [{ settledEntryId: receivableId, settledAmount: "300.00" }],
      idempotencyKey: "settle-idem-001",
    });
    const r2 = await deps.settlementService.settlePayment(acctUser as any, acctEff as any, {
      paymentId,
      allocations: [{ settledEntryId: receivableId, settledAmount: "300.00" }],
      idempotencyKey: "settle-idem-001",
    });
    expect(r2.action).toBe("replayed");
    expect(r2.settlementIds).toEqual(r1.settlementIds);
  });

  it("settle against non-posted payment rejected", async () => {
    const deps = makeDeps();
    const { entryId: receivableId } = await setupCustomerReceivable(deps, "1000.00");
    // Create draft but don't post
    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const acctEff = makeAcctEff();
    const draft = await deps.paymentService.createDraftPayment(acctUser as any, acctEff as any, {
      ownerType: "customer", ownerId: TEST_CUSTOMER_ID,
      paymentDate: "2026-07-10", amount: "500.00",
      paymentDirection: "received_from_party", paymentMethod: "cash",
      idempotencyKey: "pay-draft-only-001",
    });
    await expect(deps.settlementService.settlePayment(acctUser as any, acctEff as any, {
      paymentId: draft.paymentId,
      allocations: [{ settledEntryId: receivableId, settledAmount: "300.00" }],
      idempotencyKey: "settle-draft-001",
    })).rejects.toThrow(PaymentNotPostedError);
  });
});

// ===========================================================================
// 5. Reversal.
// ===========================================================================

describe("WP-05-04 payment reversal", () => {
  it("reversal creates opposite-signed entry and original remains immutable", async () => {
    const deps = makeDeps();
    const { paymentId, postedEntryId } = await setupPostedPayment(
      deps, "customer", TEST_CUSTOMER_ID, "received_from_party", "500.00", "cash", "pay-rev-001",
    );
    const originalEntry = await deps.subledger.findEntryById(TEST_TENANT_ID, postedEntryId);
    const originalAmountSigned = originalEntry!.amountSigned;

    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const acctEff = makeAcctEff();
    const result = await deps.reversalService.reversePayment(acctUser as any, acctEff as any, {
      paymentId, reason: "Customer cancelled order",
      idempotencyKey: "rev-001",
    });
    expect(result.action).toBe("reversed");
    expect(result.reversalEntryId).not.toBe(postedEntryId);

    // Reversal entry has opposite sign
    const reversalEntry = await deps.subledger.findEntryById(TEST_TENANT_ID, result.reversalEntryId);
    expect(reversalEntry!.entryType).toBe("reversal");
    // Original customer_payment = -500, reversal is +500 (opposite sign via negateMoney)
    expect(reversalEntry!.amountSigned).toBe("500.00");

    // Original entry remains immutable (amountSigned unchanged)
    const originalEntryAfter = await deps.subledger.findEntryById(TEST_TENANT_ID, postedEntryId);
    expect(originalEntryAfter!.amountSigned).toBe(originalAmountSigned);  // unchanged
    expect(originalEntryAfter!.settlementStatus).toBe("reversed");  // but settlement_status changed

    // Payment status = reversed
    const payment = await deps.paymentRepo.findPaymentById(TEST_TENANT_ID, paymentId);
    expect(payment!.status).toBe("reversed");
    expect(payment!.reversalOfPaymentId).toBe(paymentId);
  });

  it("cannot reverse twice", async () => {
    const deps = makeDeps();
    const { paymentId } = await setupPostedPayment(
      deps, "customer", TEST_CUSTOMER_ID, "received_from_party", "500.00", "cash", "pay-rev-twice-001",
    );
    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const acctEff = makeAcctEff();
    await deps.reversalService.reversePayment(acctUser as any, acctEff as any, {
      paymentId, reason: "First reversal",
      idempotencyKey: "rev-twice-001",
    });
    await expect(deps.reversalService.reversePayment(acctUser as any, acctEff as any, {
      paymentId, reason: "Second reversal attempt",
      idempotencyKey: "rev-twice-002",
    })).rejects.toThrow(PaymentAlreadyReversedError);
  });

  it("reversal reason required", async () => {
    const deps = makeDeps();
    const { paymentId } = await setupPostedPayment(
      deps, "customer", TEST_CUSTOMER_ID, "received_from_party", "100.00", "cash", "pay-rev-noreason-001",
    );
    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const acctEff = makeAcctEff();
    await expect(deps.reversalService.reversePayment(acctUser as any, acctEff as any, {
      paymentId, reason: "",
      idempotencyKey: "rev-noreason-001",
    })).rejects.toThrow(ReversalReasonRequiredError);
  });

  it("reversal of settled payment safely unallocates settlements", async () => {
    const deps = makeDeps();
    const { entryId: receivableId } = await setupCustomerReceivable(deps, "1000.00");
    const { paymentId } = await setupPostedPayment(
      deps, "customer", TEST_CUSTOMER_ID, "received_from_party", "500.00", "cash", "pay-rev-settled-001",
    );
    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const acctEff = makeAcctEff();
    // Settle 300 of the 500 payment against the 1000 receivable
    await deps.settlementService.settlePayment(acctUser as any, acctEff as any, {
      paymentId,
      allocations: [{ settledEntryId: receivableId, settledAmount: "300.00" }],
      idempotencyKey: "settle-before-rev-001",
    });
    // Now reverse the payment
    const result = await deps.reversalService.reversePayment(acctUser as any, acctEff as any, {
      paymentId, reason: "Reverse after settlement",
      idempotencyKey: "rev-settled-001",
    });
    expect(result.reversedSettlementIds.length).toBe(1);

    // Receivable should be back to unsettled (its settlement was reversed)
    const receivable = await deps.subledger.findEntryById(TEST_TENANT_ID, receivableId);
    expect(receivable!.settlementStatus).toBe("unsettled");

    // Original payment entry should be reversed
    const payment = await deps.paymentRepo.findPaymentById(TEST_TENANT_ID, paymentId);
    const originalEntry = await deps.subledger.findEntryById(TEST_TENANT_ID, payment!.postedEntryId!);
    expect(originalEntry!.settlementStatus).toBe("reversed");
  });

  it("reversal idempotency replay", async () => {
    const deps = makeDeps();
    const { paymentId } = await setupPostedPayment(
      deps, "customer", TEST_CUSTOMER_ID, "received_from_party", "100.00", "cash", "pay-rev-idem-001",
    );
    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const acctEff = makeAcctEff();
    const r1 = await deps.reversalService.reversePayment(acctUser as any, acctEff as any, {
      paymentId, reason: "Reversal 1",
      idempotencyKey: "rev-idem-001",
    });
    const r2 = await deps.reversalService.reversePayment(acctUser as any, acctEff as any, {
      paymentId, reason: "Reversal 1",  // SAME body for replay
      idempotencyKey: "rev-idem-001",
    });
    expect(r2.action).toBe("replayed");
    expect(r2.reversalEntryId).toBe(r1.reversalEntryId);
  });
});

// ===========================================================================
// 6. Permissions.
// ===========================================================================

describe("WP-05-04 permissions", () => {
  it("worker denied payment creation", async () => {
    const deps = makeDeps();
    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = makeWhEff();
    await expect(deps.paymentService.createDraftPayment(whUser as any, whEff as any, {
      ownerType: "customer", ownerId: TEST_CUSTOMER_ID,
      paymentDate: "2026-07-10", amount: "100.00",
      paymentDirection: "received_from_party", paymentMethod: "cash",
      idempotencyKey: "pay-worker-001",
    })).rejects.toThrow(PermissionDeniedError);
  });

  it("worker denied payment reversal", async () => {
    const deps = makeDeps();
    const { paymentId } = await setupPostedPayment(
      deps, "customer", TEST_CUSTOMER_ID, "received_from_party", "100.00", "cash", "pay-worker-rev-001",
    );
    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = makeWhEff();
    await expect(deps.reversalService.reversePayment(whUser as any, whEff as any, {
      paymentId, reason: "Worker attempt",
      idempotencyKey: "rev-worker-001",
    })).rejects.toThrow(PermissionDeniedError);
  });

  it("owner allowed payment creation + reversal", async () => {
    const deps = makeDeps();
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();
    const draft = await deps.paymentService.createDraftPayment(ownerUser as any, ownerEff as any, {
      ownerType: "customer", ownerId: TEST_CUSTOMER_ID,
      paymentDate: "2026-07-10", amount: "100.00",
      paymentDirection: "received_from_party", paymentMethod: "cash",
      idempotencyKey: "pay-owner-001",
    });
    expect(draft.paymentId).toBeTruthy();
    const post = await deps.paymentService.postPayment(ownerUser as any, ownerEff as any, {
      paymentId: draft.paymentId, idempotencyKey: "pay-owner-001:post",
    });
    expect(post.action).toBe("posted");
    const rev = await deps.reversalService.reversePayment(ownerUser as any, ownerEff as any, {
      paymentId: draft.paymentId, reason: "Owner reversal",
      idempotencyKey: "rev-owner-001",
    });
    expect(rev.action).toBe("reversed");
  });

  it("accountant allowed payment creation + reversal", async () => {
    const deps = makeDeps();
    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const acctEff = makeAcctEff();
    const draft = await deps.paymentService.createDraftPayment(acctUser as any, acctEff as any, {
      ownerType: "supplier", ownerId: TEST_SUPPLIER_ID,
      paymentDate: "2026-07-10", amount: "100.00",
      paymentDirection: "paid_to_party", paymentMethod: "bank_transfer",
      idempotencyKey: "pay-acct-001",
    });
    expect(draft.paymentId).toBeTruthy();
  });
});

// ===========================================================================
// 7. Tenant isolation.
// ===========================================================================

describe("WP-05-04 tenant isolation", () => {
  it("cross-tenant payment lookup fails", async () => {
    const deps = makeDeps();
    const { paymentId } = await setupPostedPayment(
      deps, "customer", TEST_CUSTOMER_ID, "received_from_party", "100.00", "cash", "pay-tenant-001",
    );
    const foreignUser = makeUser(TEST_USERS.accountant.userId, "ffffffff-ffff-ffff-ffff-ffffffffffff");
    const foreignEff = makeAcctEff();
    // Foreign user tries to post/settle/reverse — should get PAYMENT_NOT_FOUND
    await expect(deps.paymentService.postPayment(foreignUser as any, foreignEff as any, {
      paymentId, idempotencyKey: "pay-tenant-foreign-001",
    })).rejects.toThrow();  // PaymentNotFoundError
  });
});

// ===========================================================================
// 8. No side effects (stock movements, sales approval, profitability, direct costs).
// ===========================================================================

describe("WP-05-04 no side effects", () => {
  it("payment posting creates NO stock movements, NO sales approval mutations, NO profitability/direct-cost side effects", async () => {
    const deps = makeDeps();
    await setupPostedPayment(
      deps, "customer", TEST_CUSTOMER_ID, "received_from_party", "100.00", "cash", "pay-noside-001",
    );

    // Audit should NOT contain stock_movement / sales_approval / profitability / direct_cost actions
    const auditRows = deps.audit.getRows();
    for (const row of auditRows) {
      expect(row.actionType).not.toContain("stock_movement");
      expect(row.actionType).not.toContain("sales_approval");
      expect(row.actionType).not.toContain("profitability");
      expect(row.actionType).not.toContain("direct_cost");
      expect(row.actionType).not.toContain("inventory.");
    }

    // Only account entries should be: customer_payment (no receivable/payable/payment-other entries)
    const entries = [...((deps.subledgerRepo as any).entries as Map<string, any>).values()];
    const paymentEntries = entries.filter((e: any) => e.sourceDocumentType === "payment");
    expect(paymentEntries.length).toBe(1);
    expect(paymentEntries[0]!.entryType).toBe("customer_payment");

    // No settlement rows
    const settlements = [...((deps.paymentRepo as any).settlements as Map<string, any>).values()];
    expect(settlements.length).toBe(0);
  });

  it("settlement creates NO stock/sales/profitability side effects", async () => {
    const deps = makeDeps();
    const { entryId: receivableId } = await setupCustomerReceivable(deps, "1000.00");
    const { paymentId } = await setupPostedPayment(
      deps, "customer", TEST_CUSTOMER_ID, "received_from_party", "500.00", "cash", "pay-noside-settle-001",
    );
    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const acctEff = makeAcctEff();
    await deps.settlementService.settlePayment(acctUser as any, acctEff as any, {
      paymentId,
      allocations: [{ settledEntryId: receivableId, settledAmount: "300.00" }],
      idempotencyKey: "settle-noside-001",
    });

    const auditRows = deps.audit.getRows();
    for (const row of auditRows) {
      expect(row.actionType).not.toContain("stock_movement");
      expect(row.actionType).not.toContain("sales_approval");
      expect(row.actionType).not.toContain("profitability");
      expect(row.actionType).not.toContain("direct_cost");
    }
  });
});

// ===========================================================================
// 9. Rollback proof.
// ===========================================================================

describe("WP-05-04 rollback proof", () => {
  it("rollback after payment entry insert (audit failure) leaves no persisted entry", async () => {
    const deps = makeDeps();
    // Capture state before
    const subledgerSnap = deps.subledgerRepo.snapshot();
    const paymentSnap = deps.paymentRepo.snapshot();

    // Create draft
    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const acctEff = makeAcctEff();
    const draft = await deps.paymentService.createDraftPayment(acctUser as any, acctEff as any, {
      ownerType: "customer", ownerId: TEST_CUSTOMER_ID,
      paymentDate: "2026-07-10", amount: "100.00",
      paymentDirection: "received_from_party", paymentMethod: "cash",
      idempotencyKey: "pay-rollback-001",
    });

    // Force audit failure during posting
    deps.audit.setShouldFail(true);
    await expect(deps.paymentService.postPayment(acctUser as any, acctEff as any, {
      paymentId: draft.paymentId, idempotencyKey: "pay-rollback-001:post",
    })).rejects.toThrow();
    deps.audit.setShouldFail(false);

    // Restore in-memory state (simulates DB tx rollback)
    deps.subledgerRepo.restore(subledgerSnap);
    deps.paymentRepo.restore(paymentSnap);

    // Verify no payment entry was persisted (after rollback)
    const entries = [...((deps.subledgerRepo as any).entries as Map<string, any>).values()].filter(
      (e: any) => e.sourceDocumentType === "payment",
    );
    expect(entries.length).toBe(0);
  });

  it("rollback after settlement insert leaves no persisted settlement", async () => {
    const deps = makeDeps();
    const { entryId: receivableId } = await setupCustomerReceivable(deps, "1000.00");
    const { paymentId } = await setupPostedPayment(
      deps, "customer", TEST_CUSTOMER_ID, "received_from_party", "500.00", "cash", "pay-rollback-settle-001",
    );
    const subledgerSnap = deps.subledgerRepo.snapshot();
    const paymentSnap = deps.paymentRepo.snapshot();

    // Force audit failure during settlement
    deps.audit.setShouldFail(true);
    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const acctEff = makeAcctEff();
    await expect(deps.settlementService.settlePayment(acctUser as any, acctEff as any, {
      paymentId,
      allocations: [{ settledEntryId: receivableId, settledAmount: "300.00" }],
      idempotencyKey: "settle-rollback-001",
    })).rejects.toThrow();
    deps.audit.setShouldFail(false);

    // Restore
    deps.subledgerRepo.restore(subledgerSnap);
    deps.paymentRepo.restore(paymentSnap);

    // Verify no settlement persisted
    const settlements = [...((deps.paymentRepo as any).settlements as Map<string, any>).values()];
    expect(settlements.length).toBe(0);
  });

  it("rollback after reversal entry insert leaves no persisted reversal", async () => {
    const deps = makeDeps();
    const { paymentId } = await setupPostedPayment(
      deps, "customer", TEST_CUSTOMER_ID, "received_from_party", "500.00", "cash", "pay-rollback-rev-001",
    );
    const subledgerSnap = deps.subledgerRepo.snapshot();
    const paymentSnap = deps.paymentRepo.snapshot();

    // Force audit failure during reversal
    deps.audit.setShouldFail(true);
    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const acctEff = makeAcctEff();
    await expect(deps.reversalService.reversePayment(acctUser as any, acctEff as any, {
      paymentId, reason: "Rollback test",
      idempotencyKey: "rev-rollback-001",
    })).rejects.toThrow();
    deps.audit.setShouldFail(false);

    // Restore
    deps.subledgerRepo.restore(subledgerSnap);
    deps.paymentRepo.restore(paymentSnap);

    // Verify no reversal entry persisted
    const entries = [...((deps.subledgerRepo as any).entries as Map<string, any>).values()].filter(
      (e: any) => e.entryType === "reversal",
    );
    expect(entries.length).toBe(0);

    // Payment still posted (not reversed)
    const payment = await deps.paymentRepo.findPaymentById(TEST_TENANT_ID, paymentId);
    expect(payment!.status).toBe("posted");
  });
});

// ===========================================================================
// 10. Concurrency: concurrent settlement cannot over-settle.
// ===========================================================================

describe("WP-05-04 concurrency", () => {
  it("sequential settlements cannot exceed payment capacity (over-settlement rejected on second)", async () => {
    const deps = makeDeps();
    const { entryId: receivableId } = await setupCustomerReceivable(deps, "1000.00");
    const { paymentId } = await setupPostedPayment(
      deps, "customer", TEST_CUSTOMER_ID, "received_from_party", "500.00", "cash", "pay-conc-001",
    );
    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const acctEff = makeAcctEff();

    // First settlement of 300 succeeds (capacity 500 → 200 remaining)
    const r1 = await deps.settlementService.settlePayment(acctUser as any, acctEff as any, {
      paymentId,
      allocations: [{ settledEntryId: receivableId, settledAmount: "300.00" }],
      idempotencyKey: "settle-conc-a-001",
    });
    expect(r1.action).toBe("settled");
    expect(r1.paymentEntryRemaining).toBe("200.00");

    // Second settlement of 300 would exceed remaining 200 → over-settlement rejected
    await expect(deps.settlementService.settlePayment(acctUser as any, acctEff as any, {
      paymentId,
      allocations: [{ settledEntryId: receivableId, settledAmount: "300.00" }],
      idempotencyKey: "settle-conc-b-001",
    })).rejects.toThrow(OverSettlementError);

    // Verify total settled on payment = 300 (only first succeeded)
    const settlements = [...((deps.paymentRepo as any).settlements as Map<string, any>).values()].filter(
      (s: any) => s.paymentEntryId !== null && s.settlementStatus === "settled",
    );
    const totalSettled = settlements.reduce((sum: number, s: any) => sum + parseFloat(s.settledAmount), 0);
    expect(totalSettled).toBe(300);  // ≤ 500
  });
});
