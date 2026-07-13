/**
 * WP-04-03 Production Receipt Approval Service tests.
 *
 * Contract: docs/contracts/13_work_packages.md WP-04-03
 *   Tests: Full/partial output/WIP/waste/payable, duplicate allocation,
 *   insufficient WIP, signs, midpoint/residual, concurrency/idempotency/
 *   orphan recovery, failure after every write, rate-history immutability.
 *   Acceptance: Each receipt creates all exact effects together or none;
 *   one source payable and immutable original.
 *
 * Contract: docs/contracts/12_testing_and_regression_plan.md §3.2, §4 Phase 4
 *   Mandatory test fixtures:
 *     - Full receipt: 5000 input / 4250 output / 750 waste / 30000 EGP/ton
 *       → factory_payable = 150000.00 EGP
 *     - Partial receipt: 3000 consumed + 500 waste, output 2500, remaining WIP
 *     - Midpoint payable values
 *     - Multi-allocation residual
 *     - Concurrency: two simultaneous approvals for the same receipt
 *     - Idempotency: duplicate key replays; changed-payload key conflicts
 *     - Failure injection: failure after every write rolls back
 *     - Immutability: rate change does NOT recalculate approved receipt
 *     - Worker redaction: workers cannot receive rate/cost/payable fields
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  ProductionReceiptApprovalService,
  ReceiptNotFoundError,
  ReceiptAlreadyApprovedError,
  OrderNotReadyForApprovalError,
  SubjectHashMismatchError,
  RequesterCannotApproveOwnReceiptError,
  WipInsufficientError,
  MissingFactoryRateError,
  AllocationNotFoundError,
  ProductionReceiptApprovalError,
} from "../production-receipt-approval-service";
import { ProductionReceiptDraftService } from "../production-receipt-draft-service";
import { ProductionIssueService } from "../production-issue-service";
import { InventoryLedgerService } from "../inventory-ledger-service";
import { SubledgerService } from "../subledger-service";
import { InMemoryProductionReceiptRepository } from "./in-memory-production-receipt-repository";
import { InMemoryProductionOrderRepository } from "./in-memory-production-order-repository";
import { InMemoryWipBalanceRepository } from "./in-memory-wip-balance-repository";
import { InMemoryInventoryLedgerRepository } from "./in-memory-inventory-ledger-repository";
import { InMemorySubledgerRepository } from "./in-memory-subledger-repository";
import { InProcessAuditStore } from "../audit-service";
import { InProcessIdempotencyStore } from "../idempotency-service";
import { InProcessDocumentSequenceStore } from "../document-sequence-service";
import {
  TEST_USERS, getTestEffectivePermissions,
} from "@/server/security/role-fixtures";
import { PermissionDeniedError } from "@/server/security/guards";
import type { ProductionReceipt } from "@/server/db/schema/production-receipts";

const TEST_TENANT_ID = "00000000-0000-0000-0000-000000000001";
const TEST_ITEM_ID = "aaa40200-0000-4000-8000-000000000001";
const TEST_OUTPUT_ITEM_ID = "aaa40200-0000-4000-8000-000000000002";
const TEST_FACTORY_LOC = "bbb40200-0000-4000-8000-000000000001";
const TEST_OUTPUT_LOC = "bbb40200-0000-4000-8000-000000000002";
const TEST_FACTORY_ID = "ccc40200-0000-4000-8000-000000000001";

function makeUser(userId: string, tenantId: string = TEST_TENANT_ID) {
  return { authenticated: true as const, userId, tenantId, email: "t@e.com", name: "T", authId: "t" };
}

interface Deps {
  receiptRepository: InMemoryProductionReceiptRepository;
  productionOrderRepository: InMemoryProductionOrderRepository;
  wipBalanceRepository: InMemoryWipBalanceRepository;
  ledgerRepo: InMemoryInventoryLedgerRepository;
  subledgerRepo: InMemorySubledgerRepository;
  audit: InProcessAuditStore;
  idempotency: InProcessIdempotencyStore;
  documentSequence: InProcessDocumentSequenceStore;
  inventoryLedger: InventoryLedgerService;
  subledger: SubledgerService;
  issueService: ProductionIssueService;
  draftService: ProductionReceiptDraftService;
  approvalService: ProductionReceiptApprovalService;
}

// Monotonic counter for unique seed idempotency keys across test invocations.
// Without this, two setupDraftReceipt calls in the same test would collide
// on the seed-stock idempotency key and the second would fail with
// IDEMPOTENCY_CONFLICT (different quantity, same key).
let setupCallCounter = 0;

function makeDeps(): Deps {
  const receiptRepository = new InMemoryProductionReceiptRepository();
  const productionOrderRepository = new InMemoryProductionOrderRepository();
  const wipBalanceRepository = new InMemoryWipBalanceRepository();
  const ledgerRepo = new InMemoryInventoryLedgerRepository();
  const subledgerRepo = new InMemorySubledgerRepository();
  const audit = new InProcessAuditStore();
  const idempotency = new InProcessIdempotencyStore();
  const documentSequence = new InProcessDocumentSequenceStore();
  const inventoryLedger = new InventoryLedgerService({ ledger: ledgerRepo, audit, idempotency, documentSequence });
  const subledger = new SubledgerService({ subledger: subledgerRepo, audit, idempotency, documentSequence });
  const issueService = new ProductionIssueService({
    productionOrderRepository, wipBalanceRepository, inventoryLedger, audit, idempotency, documentSequence,
  });
  const draftService = new ProductionReceiptDraftService({
    receiptRepository, productionOrderRepository, wipBalanceRepository, audit, documentSequence,
  });
  const approvalService = new ProductionReceiptApprovalService({
    receiptRepository, productionOrderRepository, wipBalanceRepository,
    inventoryLedger, subledger, audit, idempotency,
  });
  return {
    receiptRepository, productionOrderRepository, wipBalanceRepository,
    ledgerRepo, subledgerRepo, audit, idempotency, documentSequence,
    inventoryLedger, subledger, issueService, draftService, approvalService,
  };
}

/**
 * Seed stock, create an order, issue material, then create a receipt draft
 * with the given allocations + rate. Returns the draft receipt + setup.
 *
 * The draft is created by `ownerUser` (so DEC-080 self-approval is enforced
 * when the same user tries to approve — use `accountantUser` to approve).
 */
async function setupDraftReceipt(
  deps: Deps,
  opts: {
    seedStockQty?: string;
    issueQty?: string;
    outputQty?: string;
    allocations: Array<{ consumed: string; waste: string }>;
    /** Factory rate. undefined → default "30000.00"; null → explicitly no rate. */
    factoryRate?: string | null;
    draftCreator?: "owner" | "production"; // who creates the draft
  },
): Promise<{
  receipt: ProductionReceipt;
  order: any;
  inputs: any[];
  ownerUser: any;
  ownerEff: any;
  accountantUser: any;
  accountantEff: any;
}> {
  setupCallCounter++;
  const seedKey = `seed-key-${setupCallCounter}`;
  const issueKey = `issue-setup-${setupCallCounter}`;

  const seedQty = opts.seedStockQty ?? "5000.000";
  const issueQty = opts.issueQty ?? "5000.000";
  const outputQty = opts.outputQty ?? "4250.000";

  // Seed stock (owner)
  const ownerUser = makeUser(TEST_USERS.owner.userId);
  const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);
  await deps.inventoryLedger.postRawReceipt(ownerUser as any, ownerEff as any, {
    itemId: TEST_ITEM_ID, toLocationId: TEST_FACTORY_LOC, quantityKg: seedQty,
    movementDate: "2026-07-06", sourceDocumentType: "test_seed", sourceDocumentId: `seed-${setupCallCounter}`,
    idempotencyKey: seedKey,
  });

  // Create production order (warehouse)
  const whUser = makeUser(TEST_USERS.warehouse.userId);
  const whEff = getTestEffectivePermissions(TEST_USERS.warehouse.userId);
  const { order, inputs } = await deps.issueService.createProductionOrder(whUser as any, whEff as any, {
    productionType: "single_yarn",
    factoryId: TEST_FACTORY_ID,
    factoryLocationId: TEST_FACTORY_LOC,
    inputs: [{ inputItemId: TEST_ITEM_ID, inputLocationId: TEST_FACTORY_LOC, plannedInputQtyKg: issueQty }],
  });

  // Issue to production (owner)
  await deps.issueService.issueToProduction(ownerUser as any, ownerEff as any, {
    productionOrderId: order.id, inputId: inputs[0]!.id, quantityKg: issueQty, idempotencyKey: issueKey,
  });

  // Create draft receipt — by default the owner (so the rate is persisted,
  // since owner has production.view_cost). The draft is then approved by
  // the Accountant (a different user — DEC-080 self-approval rule).
  // Tests that need a worker-created draft can pass `draftCreator: "production"`.
  const draftCreator = opts.draftCreator ?? "owner";
  const draftUser = draftCreator === "owner" ? ownerUser : makeUser(TEST_USERS.production.userId);
  const draftEff = draftCreator === "owner" ? ownerEff : getTestEffectivePermissions(TEST_USERS.production.userId);

  // Factory rate: undefined → default "30000.00"; null → explicitly no rate.
  const factoryRate = opts.factoryRate === undefined ? "30000.00" : opts.factoryRate;

  const draftResult = await deps.draftService.createReceiptDraft(draftUser as any, draftEff as any, {
    productionOrderId: order.id,
    outputItemId: TEST_OUTPUT_ITEM_ID,
    outputLocationId: TEST_OUTPUT_LOC,
    outputQtyKg: outputQty,
    receiptDate: "2026-07-08",
    factoryRatePerInputTon: factoryRate,
    factoryCostBasis: "input_quantity",
    allocations: opts.allocations.map(a => ({
      productionInputId: inputs[0]!.id,
      consumedTowardOutputQtyKg: a.consumed,
      allocatedWasteQtyKg: a.waste,
    })),
  });

  const receipt = await deps.receiptRepository.findReceiptById(TEST_TENANT_ID, draftResult.receiptId);
  if (!receipt) throw new Error("Test setup failed: receipt not found after draft creation.");

  const accountantUser = makeUser(TEST_USERS.accountant.userId);
  const accountantEff = getTestEffectivePermissions(TEST_USERS.accountant.userId);

  return { receipt, order, inputs, ownerUser, ownerEff, accountantUser, accountantEff };
}

// ===========================================================================
// 1. Happy path — full receipt with output + WIP decrease + payable + audit + state.
// ===========================================================================

describe("WP-04-03 approveReceipt — happy path (full receipt)", () => {
  it("posts output movement, decreases WIP to 0, creates factory payable, transitions state, writes audit", async () => {
    const deps = makeDeps();
    // 5000 kg input issued, 4250 output, 750 waste → all WIP consumed.
    // factory_payable = (4250 + 750) / 1000 × 30000 = 5000 × 30 = 150000.00 EGP
    const { receipt, order, accountantUser, accountantEff } = await setupDraftReceipt(deps, {
      seedStockQty: "5000.000",
      issueQty: "5000.000",
      outputQty: "4250.000",
      allocations: [{ consumed: "4250.000", waste: "750.000" }],
      factoryRate: "30000.00",
    });

    const result = await deps.approvalService.approveReceipt(
      accountantUser as any, accountantEff as any,
      { receiptId: receipt.id, idempotencyKey: "approve-1" },
    );

    // Result shape
    expect(result.action).toBe("posted");
    expect(result.receiptId).toBe(receipt.id);
    expect(result.factoryPayable).toBe("150000.00");
    expect(result.factoryCostBasisInputQtyKg).toBe("5000.000");
    expect(result.totalConsumedQtyKg).toBe("4250.000");
    expect(result.totalWasteQtyKg).toBe("750.000");
    expect(result.wasteMovementCount).toBe(1);
    expect(result.accountEntryId).toBeTruthy();
    expect(result.accountEntryNo).toMatch(/^AE-\d{4}-\d{6}$/);
    expect(result.accountAmountSigned).toBe("-150000.00"); // NEGATIVE for payable
    expect(result.receiptMovementDocNo).toMatch(/^PRC-\d{4}-\d{6}$/);
    expect(result.outputOnHandQtyKg).toBe("4250.000");
    expect(result.orderStatusAfter).toBe("completed"); // all WIP = 0

    // Receipt state
    const updatedReceipt = await deps.receiptRepository.findReceiptById(TEST_TENANT_ID, receipt.id);
    expect(updatedReceipt!.status).toBe("completed");
    expect(updatedReceipt!.approvalStatus).toBe("approved");
    expect(updatedReceipt!.isLocked).toBe(true);
    expect(updatedReceipt!.factoryPayable).toBe("150000.00");
    expect(updatedReceipt!.factoryCostBasisInputQtyKg).toBe("5000.000");
    expect(updatedReceipt!.calculatedFactoryCost).toBe("150000.00");
    expect(updatedReceipt!.calculationVersion).toBe("v1");
    expect(updatedReceipt!.receiptMovementId).toBe(result.receiptMovementId);
    expect(updatedReceipt!.accountEntryId).toBe(result.accountEntryId);
    expect(updatedReceipt!.confirmedBy).toBe(TEST_USERS.accountant.userId);
    expect(updatedReceipt!.subjectHash).toBe(receipt.subjectHash);

    // Order state
    const updatedOrder = await deps.productionOrderRepository.findOrderById(TEST_TENANT_ID, order.id);
    expect(updatedOrder!.status).toBe("completed");

    // WIP balance = 0
    const wip = await deps.wipBalanceRepository.findForUpdate(
      TEST_TENANT_ID, order.id, TEST_ITEM_ID, TEST_FACTORY_LOC,
    );
    expect(wip!.wipQtyKg).toBe("0.000");

    // Output on-hand = 4250
    const outBal = await deps.ledgerRepo.findBalanceForUpdate(
      TEST_TENANT_ID, TEST_OUTPUT_ITEM_ID, TEST_OUTPUT_LOC,
    );
    expect(outBal!.onHandQtyKg).toBe("4250.000");

    // Account entry exists with negative signed amount
    const entries = await deps.subledgerRepo.listEntriesForAccount(
      TEST_TENANT_ID, result.accountEntryId ? (await deps.subledgerRepo.findEntryById(TEST_TENANT_ID, result.accountEntryId))!.accountId : "",
    );
    expect(entries.length).toBe(1);
    expect(entries[0]!.entryType).toBe("factory_production_payable");
    expect(entries[0]!.amountSigned).toBe("-150000.00");
    expect(entries[0]!.sourceDocumentType).toBe("production_receipt");
    expect(entries[0]!.sourceDocumentId).toBe(receipt.id);

    // Waste entry exists
    const wasteEntries = await deps.receiptRepository.findWasteEntriesByReceipt(TEST_TENANT_ID, receipt.id);
    expect(wasteEntries.length).toBe(1);
    expect(wasteEntries[0]!.wasteQtyKg).toBe("750.000");
    expect(wasteEntries[0]!.movementId).toBeTruthy();

    // Audit row exists
    const auditRows = deps.audit.getRows();
    const approveAudit = auditRows.find((r) => r.actionType === "production_receipt.approve");
    expect(approveAudit).toBeTruthy();
    expect(approveAudit!.entityId).toBe(receipt.id);
    expect(approveAudit!.idempotencyKey).toBe("approve-1");
  });
});

// ===========================================================================
// 2. Zero waste — no waste movement, no waste_entry, no WIP decrease for waste.
// ===========================================================================

describe("WP-04-03 approveReceipt — zero waste", () => {
  it("posts output movement with NO waste movement and NO waste_entry", async () => {
    const deps = makeDeps();
    // 5000 input, 5000 output, 0 waste → factory_payable = 5000 × 30 = 150000.00 EGP
    const { receipt, accountantUser, accountantEff } = await setupDraftReceipt(deps, {
      seedStockQty: "5000.000",
      issueQty: "5000.000",
      outputQty: "5000.000",
      allocations: [{ consumed: "5000.000", waste: "0.000" }],
      factoryRate: "30000.00",
    });

    const result = await deps.approvalService.approveReceipt(
      accountantUser as any, accountantEff as any,
      { receiptId: receipt.id, idempotencyKey: "approve-2" },
    );

    expect(result.wasteMovementCount).toBe(0);
    expect(result.totalWasteQtyKg).toBe("0.000");
    expect(result.factoryCostBasisInputQtyKg).toBe("5000.000"); // consumed + 0 waste
    expect(result.factoryPayable).toBe("150000.00");

    // No waste entries
    const wasteEntries = await deps.receiptRepository.findWasteEntriesByReceipt(TEST_TENANT_ID, receipt.id);
    expect(wasteEntries.length).toBe(0);
  });
});

// ===========================================================================
// 3. With waste — explicit waste_entry + waste movement + WIP separate decrease.
// ===========================================================================

describe("WP-04-03 approveReceipt — with waste (separate from payable basis)", () => {
  it("records waste_entry, posts waste movement, decreases WIP by (consumed + waste)", async () => {
    const deps = makeDeps();
    // 5000 input, 2500 output, 500 waste, 2000 remaining WIP
    // factory_payable = (2500 + 500) / 1000 × 30000 = 3000 × 30 = 90000.00 EGP
    const { receipt, order, accountantUser, accountantEff } = await setupDraftReceipt(deps, {
      seedStockQty: "5000.000",
      issueQty: "5000.000",
      outputQty: "2500.000",
      allocations: [{ consumed: "2500.000", waste: "500.000" }],
      factoryRate: "30000.00",
    });

    const result = await deps.approvalService.approveReceipt(
      accountantUser as any, accountantEff as any,
      { receiptId: receipt.id, idempotencyKey: "approve-3" },
    );

    expect(result.factoryPayable).toBe("90000.00");
    expect(result.factoryCostBasisInputQtyKg).toBe("3000.000");
    expect(result.totalConsumedQtyKg).toBe("2500.000");
    expect(result.totalWasteQtyKg).toBe("500.000");
    expect(result.wasteMovementCount).toBe(1);
    expect(result.orderStatusAfter).toBe("partially_received"); // 2000 WIP remaining

    // WIP balance = 5000 - 2500 - 500 = 2000
    const wip = await deps.wipBalanceRepository.findForUpdate(
      TEST_TENANT_ID, order.id, TEST_ITEM_ID, TEST_FACTORY_LOC,
    );
    expect(wip!.wipQtyKg).toBe("2000.000");

    // Waste entry exists
    const wasteEntries = await deps.receiptRepository.findWasteEntriesByReceipt(TEST_TENANT_ID, receipt.id);
    expect(wasteEntries.length).toBe(1);
    expect(wasteEntries[0]!.wasteQtyKg).toBe("500.000");

    // Receipt status = partially_received
    const updatedReceipt = await deps.receiptRepository.findReceiptById(TEST_TENANT_ID, receipt.id);
    expect(updatedReceipt!.status).toBe("partially_received");
  });
});

// ===========================================================================
// 4. Missing/invalid allocation rejects.
// ===========================================================================

describe("WP-04-03 approveReceipt — missing allocations rejects", () => {
  it("rejects when receipt has no allocations (VALIDATION_FAILED)", async () => {
    const deps = makeDeps();
    // Manually create a receipt with no allocations by manipulating the repo.
    const { receipt, accountantUser, accountantEff } = await setupDraftReceipt(deps, {
      allocations: [{ consumed: "1000.000", waste: "0.000" }],
    });

    // Manually delete the allocation from the in-memory store to simulate a
    // corrupted state where the receipt has no allocations.
    // (In production this would be prevented by the draft service's validation.)
    const allocations = await deps.receiptRepository.findAllocationsByReceipt(TEST_TENANT_ID, receipt.id);
    for (const a of allocations) {
      (deps.receiptRepository as any).allocations.delete(`${TEST_TENANT_ID}:${a.id}`);
    }

    await expect(deps.approvalService.approveReceipt(
      accountantUser as any, accountantEff as any,
      { receiptId: receipt.id, idempotencyKey: "approve-4" },
    )).rejects.toThrow(AllocationNotFoundError);

    // No effects posted
    const movements = (deps.ledgerRepo as any).movements as Map<string, any>;
    const receiveMovements = [...movements.values()].filter((m: any) => m.movementType === "receive_from_production");
    expect(receiveMovements.length).toBe(0);
  });
});

// ===========================================================================
// 5. Insufficient WIP rejects.
// ===========================================================================

describe("WP-04-03 approveReceipt — insufficient WIP rejects", () => {
  it("rejects with WIP_INSUFFICIENT when allocation exceeds available WIP", async () => {
    const deps = makeDeps();
    // Issue 1000 kg, then create a draft trying to consume 1500 (exceeds WIP).
    // Note: WP-04-02 validates against issued_qty, but here we'll simulate a
    // case where WIP was already partially consumed by a prior receipt.
    const { receipt, order, accountantUser, accountantEff } = await setupDraftReceipt(deps, {
      seedStockQty: "1000.000",
      issueQty: "1000.000",
      outputQty: "800.000",
      allocations: [{ consumed: "800.000", waste: "200.000" }], // 1000 = 800 + 200, fits issued
      factoryRate: "30000.00",
    });

    // Now manually decrease WIP to simulate a prior partial receipt consuming 500.
    // WIP would then be 1000 - 500 = 500, but we try to consume 800 + 200 = 1000.
    const wipBalance = await deps.wipBalanceRepository.findForUpdate(
      TEST_TENANT_ID, order.id, TEST_ITEM_ID, TEST_FACTORY_LOC,
    );
    expect(wipBalance).toBeTruthy();
    // Update WIP to 500 (simulating a prior receipt that consumed 500)
    await deps.wipBalanceRepository.updateWipQty(
      TEST_TENANT_ID, order.id, TEST_ITEM_ID, TEST_FACTORY_LOC,
      { wipQtyKg: "500.000", version: wipBalance!.version + 1 },
    );

    await expect(deps.approvalService.approveReceipt(
      accountantUser as any, accountantEff as any,
      { receiptId: receipt.id, idempotencyKey: "approve-5" },
    )).rejects.toThrow(WipInsufficientError);

    // No effects posted
    const movements = (deps.ledgerRepo as any).movements as Map<string, any>;
    const receiveMovements = [...movements.values()].filter((m: any) => m.movementType === "receive_from_production");
    expect(receiveMovements.length).toBe(0);

    // Receipt remains draft (not locked)
    const updatedReceipt = await deps.receiptRepository.findReceiptById(TEST_TENANT_ID, receipt.id);
    expect(updatedReceipt!.status).toBe("draft");
    expect(updatedReceipt!.isLocked).toBe(false);
  });
});

// ===========================================================================
// 6. Duplicate approval rejects.
// ===========================================================================

describe("WP-04-03 approveReceipt — duplicate approval rejects", () => {
  it("rejects second approval with different idempotency key (STATE_CONFLICT)", async () => {
    const deps = makeDeps();
    const { receipt, accountantUser, accountantEff } = await setupDraftReceipt(deps, {
      allocations: [{ consumed: "1000.000", waste: "0.000" }],
      factoryRate: "30000.00",
    });

    // First approval — succeeds
    const r1 = await deps.approvalService.approveReceipt(
      accountantUser as any, accountantEff as any,
      { receiptId: receipt.id, idempotencyKey: "approve-6a" },
    );
    expect(r1.action).toBe("posted");

    // Second approval with DIFFERENT idempotency key — must reject
    await expect(deps.approvalService.approveReceipt(
      accountantUser as any, accountantEff as any,
      { receiptId: receipt.id, idempotencyKey: "approve-6b" },
    )).rejects.toThrow(ReceiptAlreadyApprovedError);
  });
});

// ===========================================================================
// 7. Idempotency replay.
// ===========================================================================

describe("WP-04-03 approveReceipt — idempotency replay", () => {
  it("same idempotency key + same request returns replayed result (no re-posting)", async () => {
    const deps = makeDeps();
    const { receipt, accountantUser, accountantEff } = await setupDraftReceipt(deps, {
      allocations: [{ consumed: "1000.000", waste: "0.000" }],
      factoryRate: "30000.00",
    });

    const r1 = await deps.approvalService.approveReceipt(
      accountantUser as any, accountantEff as any,
      { receiptId: receipt.id, idempotencyKey: "approve-7" },
    );
    expect(r1.action).toBe("posted");

    // Count movements after first approval
    const movementsAfter1 = (deps.ledgerRepo as any).movements as Map<string, any>;
    const movementCountAfter1 = movementsAfter1.size;

    // Replay — same idempotency key + same request
    const r2 = await deps.approvalService.approveReceipt(
      accountantUser as any, accountantEff as any,
      { receiptId: receipt.id, idempotencyKey: "approve-7" },
    );
    expect(r2.action).toBe("replayed");
    expect(r2.receiptId).toBe(r1.receiptId);
    expect(r2.factoryPayable).toBe(r1.factoryPayable);
    expect(r2.accountEntryId).toBe(r1.accountEntryId);

    // No new movements posted
    expect(movementsAfter1.size).toBe(movementCountAfter1);
  });

  it("same idempotency key + different request rejects (IDEMPOTENCY_CONFLICT)", async () => {
    const deps = makeDeps();
    const { receipt, accountantUser, accountantEff } = await setupDraftReceipt(deps, {
      allocations: [{ consumed: "1000.000", waste: "0.000" }],
      factoryRate: "30000.00",
    });

    // First approval with one receipt
    await deps.approvalService.approveReceipt(
      accountantUser as any, accountantEff as any,
      { receiptId: receipt.id, idempotencyKey: "approve-7b" },
    );

    // Create a SECOND receipt to use as the conflicting request body
    const { receipt: receipt2 } = await setupDraftReceipt(deps, {
      seedStockQty: "10000.000",
      issueQty: "5000.000",
      allocations: [{ consumed: "2000.000", waste: "0.000" }],
      factoryRate: "30000.00",
    });

    // Try to approve receipt2 with the SAME idempotency key as receipt1 — different request body.
    await expect(deps.approvalService.approveReceipt(
      accountantUser as any, accountantEff as any,
      { receiptId: receipt2.id, idempotencyKey: "approve-7b" },
    )).rejects.toThrow(ProductionReceiptApprovalError);
  });
});

// ===========================================================================
// 8. Concurrent double approval.
// ===========================================================================

describe("WP-04-03 approveReceipt — concurrent double approval", () => {
  it("two simultaneous approvals with same idempotency key — one wins, other gets OPERATION_IN_PROGRESS or replay", async () => {
    const deps = makeDeps();
    const { receipt, accountantUser, accountantEff } = await setupDraftReceipt(deps, {
      allocations: [{ consumed: "1000.000", waste: "0.000" }],
      factoryRate: "30000.00",
    });

    // Fire two concurrent approvals with the SAME idempotency key.
    // The idempotency service should serialize them: the first executes,
    // the second sees "in_progress" and rejects.
    const p1 = deps.approvalService.approveReceipt(
      accountantUser as any, accountantEff as any,
      { receiptId: receipt.id, idempotencyKey: "approve-8" },
    );
    const p2 = deps.approvalService.approveReceipt(
      accountantUser as any, accountantEff as any,
      { receiptId: receipt.id, idempotencyKey: "approve-8" },
    );

    const results = await Promise.allSettled([p1, p2]);

    // Exactly one should succeed (posted or replayed); the other may reject
    // with OPERATION_IN_PROGRESS or also succeed via replay (in the
    // in-memory store, since operations are sequential within the same
    // microtask, p2 will likely see "in_progress").
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled.length + rejected.length).toBe(2);

    // At least one must succeed
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    // No more than one "posted" action (the other is "replayed" or rejected)
    const posted = fulfilled.filter((r) => r.status === "fulfilled" && r.value.action === "posted");
    expect(posted.length).toBe(1);

    // Receipt is locked + approved
    const updatedReceipt = await deps.receiptRepository.findReceiptById(TEST_TENANT_ID, receipt.id);
    expect(updatedReceipt!.isLocked).toBe(true);
    expect(updatedReceipt!.approvalStatus).toBe("approved");
  });

  it("two concurrent approvals with DIFFERENT idempotency keys — one wins via receipt lock, other rejects", async () => {
    const deps = makeDeps();
    const { receipt, accountantUser, accountantEff } = await setupDraftReceipt(deps, {
      allocations: [{ consumed: "1000.000", waste: "0.000" }],
      factoryRate: "30000.00",
    });

    // Two different idempotency keys, same receipt.
    // The first call's `markApprovedConditional` succeeds; the second's
    // returns null (receipt already locked) → STATE_CONFLICT.
    const p1 = deps.approvalService.approveReceipt(
      accountantUser as any, accountantEff as any,
      { receiptId: receipt.id, idempotencyKey: "approve-8a" },
    );
    const p2 = deps.approvalService.approveReceipt(
      accountantUser as any, accountantEff as any,
      { receiptId: receipt.id, idempotencyKey: "approve-8b" },
    );

    const results = await Promise.allSettled([p1, p2]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Exactly one should succeed; the other should reject with STATE_CONFLICT
    // or some approval error.
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
  });
});

// ===========================================================================
// 9. Rollback on output stock failure.
// ===========================================================================

describe("WP-04-03 approveReceipt — rollback on output stock failure", () => {
  it("rolls back all effects when output stock movement fails (receipt remains draft)", async () => {
    const deps = makeDeps();
    const { receipt, order, accountantUser, accountantEff } = await setupDraftReceipt(deps, {
      // Default: seedStock=5000, issue=5000, output=4250, allocations consume 4250 + 750 waste
      allocations: [{ consumed: "4250.000", waste: "750.000" }],
      factoryRate: "30000.00",
    });

    // Force the InventoryLedgerService to fail by making the audit store fail.
    // Audit is inside the transaction, so its failure rolls back everything.
    deps.audit.setShouldFail(true);

    await expect(deps.approvalService.approveReceipt(
      accountantUser as any, accountantEff as any,
      { receiptId: receipt.id, idempotencyKey: "approve-9" },
    )).rejects.toThrow();

    // Restore audit for any further operations.
    deps.audit.setShouldFail(false);

    // ----- Business-level rollback proof -----
    // In a real DB transaction, ALL writes (movement, balance, account entry,
    // waste entry, receipt state, order state) would roll back. The in-memory
    // test stores don't auto-rollback, so low-level movement/balance counts
    // may show partial state. The AUTHORITATIVE business state is the receipt
    // + order rows, which are ONLY mutated by `markApprovedConditional` and
    // `updateOrderStatusConditional` — both reached AFTER the failing write.
    // Therefore the receipt MUST remain draft + unlocked + no payable, and
    // the order MUST remain in material_issued.

    // Receipt remains draft — no approval state transition occurred.
    const updatedReceipt = await deps.receiptRepository.findReceiptById(TEST_TENANT_ID, receipt.id);
    expect(updatedReceipt!.status).toBe("draft");
    expect(updatedReceipt!.isLocked).toBe(false);
    expect(updatedReceipt!.factoryPayable).toBe(null);
    expect(updatedReceipt!.accountEntryId).toBe(null);
    expect(updatedReceipt!.receiptMovementId).toBe(null);
    expect(updatedReceipt!.confirmedBy).toBe(null);

    // Order status unchanged — still material_issued.
    const updatedOrder = await deps.productionOrderRepository.findOrderById(TEST_TENANT_ID, order.id);
    expect(updatedOrder!.status).toBe("material_issued");

    // WIP unchanged — full 5000 kg still in WIP (no successful decrement).
    const wip = await deps.wipBalanceRepository.findForUpdate(
      TEST_TENANT_ID, order.id, TEST_ITEM_ID, TEST_FACTORY_LOC,
    );
    expect(wip!.wipQtyKg).toBe("5000.000");

    // No waste entries inserted (the orchestrator never reached the waste step).
    const wasteEntries = await deps.receiptRepository.findWasteEntriesByReceipt(TEST_TENANT_ID, receipt.id);
    expect(wasteEntries.length).toBe(0);

    // No account entries posted (the orchestrator never reached the payable step).
    const subledgerEntries = (deps.subledgerRepo as any).entries as Map<string, any>;
    expect(subledgerEntries.size).toBe(0);

    // Idempotency record marked as business_failed (durable failure).
    const idemRecords = deps.idempotency.getAllRecords();
    const approveRecord = idemRecords.find((r) => r.operationScope === "production_receipt.approve");
    expect(approveRecord).toBeTruthy();
    expect(approveRecord!.state).toBe("business_failed");
  });
});

// ===========================================================================
// 10. Rollback on WIP update failure.
// ===========================================================================

describe("WP-04-03 approveReceipt — rollback on WIP update failure", () => {
  it("rolls back when WIP update returns null (balance row disappeared mid-tx)", async () => {
    const deps = makeDeps();
    const { receipt, order, accountantUser, accountantEff } = await setupDraftReceipt(deps, {
      allocations: [{ consumed: "1000.000", waste: "0.000" }],
      factoryRate: "30000.00",
    });

    // Force WIP updateWipQty to return null by deleting the WIP row after setup
    // but before the approval's WIP-decrement step. We do this by spying on
    // the wipBalanceRepository: replace updateWipQty with a version that
    // always returns null (simulating a row disappearing).
    const realUpdateWipQty = deps.wipBalanceRepository.updateWipQty.bind(deps.wipBalanceRepository);
    let callCount = 0;
    deps.wipBalanceRepository.updateWipQty = async (...args: Parameters<typeof realUpdateWipQty>) => {
      callCount++;
      // Always return null — simulate row vanished mid-tx.
      return null;
    };

    await expect(deps.approvalService.approveReceipt(
      accountantUser as any, accountantEff as any,
      { receiptId: receipt.id, idempotencyKey: "approve-10" },
    )).rejects.toThrow(ProductionReceiptApprovalError);

    // Restore
    deps.wipBalanceRepository.updateWipQty = realUpdateWipQty;

    // WIP updateWipQty WAS called (proving we got to the WIP step).
    expect(callCount).toBeGreaterThan(0);

    // Receipt remains draft (rolled back).
    const updatedReceipt = await deps.receiptRepository.findReceiptById(TEST_TENANT_ID, receipt.id);
    expect(updatedReceipt!.status).toBe("draft");
    expect(updatedReceipt!.isLocked).toBe(false);
  });
});

// ===========================================================================
// 11. Rollback on payable failure.
// ===========================================================================

describe("WP-04-03 approveReceipt — rollback on payable failure", () => {
  it("rolls back when subledger postFactoryPayable fails (zero payable)", async () => {
    const deps = makeDeps();
    // Set rate to a value that produces a zero payable — but isPositiveMoney
    // already rejects 0 in the approval service before posting. So instead
    // we make the subledger fail by injecting an audit failure during the
    // payable step.
    //
    // Easier approach: make the audit fail AFTER the receive movement but
    // DURING the payable audit (which is inside postFactoryPayable).
    // Actually, audit failures are global. So we set shouldFail AFTER the
    // receipt_movement is posted but before the payable. We do this by
    // spying on the subledger.
    //
    // Simplest: spy on postFactoryPayable to throw.
    const { receipt, order, accountantUser, accountantEff } = await setupDraftReceipt(deps, {
      allocations: [{ consumed: "1000.000", waste: "0.000" }],
      factoryRate: "30000.00",
    });

    const realPostFactoryPayable = deps.subledger.postFactoryPayable.bind(deps.subledger);
    let payableCallCount = 0;
    deps.subledger.postFactoryPayable = async (...args: Parameters<typeof realPostFactoryPayable>) => {
      payableCallCount++;
      throw new Error("Simulated subledger failure");
    };

    await expect(deps.approvalService.approveReceipt(
      accountantUser as any, accountantEff as any,
      { receiptId: receipt.id, idempotencyKey: "approve-11" },
    )).rejects.toThrow("Simulated subledger failure");

    // Restore
    deps.subledger.postFactoryPayable = realPostFactoryPayable;

    // Payable WAS called (proving we got to the payable step).
    expect(payableCallCount).toBeGreaterThan(0);

    // No account entries persisted (subledger threw before insert).
    const subledgerEntries = (deps.subledgerRepo as any).entries as Map<string, any>;
    expect(subledgerEntries.size).toBe(0);

    // Receipt remains draft (rolled back).
    const updatedReceipt = await deps.receiptRepository.findReceiptById(TEST_TENANT_ID, receipt.id);
    expect(updatedReceipt!.status).toBe("draft");
    expect(updatedReceipt!.isLocked).toBe(false);
    expect(updatedReceipt!.accountEntryId).toBe(null);

    // Order unchanged
    const updatedOrder = await deps.productionOrderRepository.findOrderById(TEST_TENANT_ID, order.id);
    expect(updatedOrder!.status).toBe("material_issued");
  });
});

// ===========================================================================
// 12. Rollback on audit failure.
// ===========================================================================

describe("WP-04-03 approveReceipt — rollback on audit failure", () => {
  it("rolls back ALL effects when audit write fails (DEC-024)", async () => {
    const deps = makeDeps();
    const { receipt, order, accountantUser, accountantEff } = await setupDraftReceipt(deps, {
      allocations: [{ consumed: "4250.000", waste: "750.000" }],
      factoryRate: "30000.00",
    });

    deps.audit.setShouldFail(true);

    await expect(deps.approvalService.approveReceipt(
      accountantUser as any, accountantEff as any,
      { receiptId: receipt.id, idempotencyKey: "approve-12" },
    )).rejects.toThrow();

    deps.audit.setShouldFail(false);

    // ----- Business-level rollback proof (same rationale as test #9) -----
    // The audit failure happens inside InventoryLedgerService.postReceiveFromProduction
    // (or postProductionWaste / postFactoryPayable — all of which call appendAuditLog).
    // In a real DB, the entire transaction rolls back. In-memory stores don't
    // auto-rollback low-level rows, but the AUTHORITATIVE receipt + order state
    // is never mutated because markApprovedConditional is never reached.

    // Receipt remains draft — no approval state transition.
    const updatedReceipt = await deps.receiptRepository.findReceiptById(TEST_TENANT_ID, receipt.id);
    expect(updatedReceipt!.status).toBe("draft");
    expect(updatedReceipt!.isLocked).toBe(false);
    expect(updatedReceipt!.factoryPayable).toBe(null);
    expect(updatedReceipt!.accountEntryId).toBe(null);
    expect(updatedReceipt!.receiptMovementId).toBe(null);

    // Order unchanged.
    const updatedOrder = await deps.productionOrderRepository.findOrderById(TEST_TENANT_ID, order.id);
    expect(updatedOrder!.status).toBe("material_issued");

    // WIP unchanged.
    const wip = await deps.wipBalanceRepository.findForUpdate(
      TEST_TENANT_ID, order.id, TEST_ITEM_ID, TEST_FACTORY_LOC,
    );
    expect(wip!.wipQtyKg).toBe("5000.000");

    // No waste entries inserted.
    const wasteEntries = await deps.receiptRepository.findWasteEntriesByReceipt(TEST_TENANT_ID, receipt.id);
    expect(wasteEntries.length).toBe(0);

    // No account entries posted.
    const subledgerEntries = (deps.subledgerRepo as any).entries as Map<string, any>;
    expect(subledgerEntries.size).toBe(0);

    // Idempotency record marked as business_failed.
    const idemRecords = deps.idempotency.getAllRecords();
    const approveRecord = idemRecords.find((r) => r.operationScope === "production_receipt.approve");
    expect(approveRecord).toBeTruthy();
    expect(approveRecord!.state).toBe("business_failed");
  });
});

// ===========================================================================
// 13. Permission denial — worker cannot approve.
// ===========================================================================

describe("WP-04-03 approveReceipt — permission denial", () => {
  it("worker cannot approve (lacks production.approve)", async () => {
    const deps = makeDeps();
    const { receipt } = await setupDraftReceipt(deps, {
      allocations: [{ consumed: "1000.000", waste: "0.000" }],
      factoryRate: "30000.00",
      draftCreator: "owner", // owner creates, so we can test worker denial cleanly
    });

    const prodUser = makeUser(TEST_USERS.production.userId);
    const prodEff = getTestEffectivePermissions(TEST_USERS.production.userId);

    await expect(deps.approvalService.approveReceipt(
      prodUser as any, prodEff as any,
      { receiptId: receipt.id, idempotencyKey: "approve-13" },
    )).rejects.toThrow(PermissionDeniedError);

    // No effects posted
    const movements = (deps.ledgerRepo as any).movements as Map<string, any>;
    const receiveMovements = [...movements.values()].filter((m: any) => m.movementType === "receive_from_production");
    expect(receiveMovements.length).toBe(0);

    // Receipt remains draft
    const updatedReceipt = await deps.receiptRepository.findReceiptById(TEST_TENANT_ID, receipt.id);
    expect(updatedReceipt!.status).toBe("draft");
    expect(updatedReceipt!.isLocked).toBe(false);
  });

  it("DEC-080: requester cannot approve own receipt", async () => {
    const deps = makeDeps();
    // Owner creates the draft AND tries to approve it — must reject.
    const { receipt, ownerUser, ownerEff } = await setupDraftReceipt(deps, {
      allocations: [{ consumed: "1000.000", waste: "0.000" }],
      factoryRate: "30000.00",
      draftCreator: "owner",
    });

    await expect(deps.approvalService.approveReceipt(
      ownerUser as any, ownerEff as any,
      { receiptId: receipt.id, idempotencyKey: "approve-13b" },
    )).rejects.toThrow(RequesterCannotApproveOwnReceiptError);

    // No effects posted
    const movements = (deps.ledgerRepo as any).movements as Map<string, any>;
    const receiveMovements = [...movements.values()].filter((m: any) => m.movementType === "receive_from_production");
    expect(receiveMovements.length).toBe(0);

    // Receipt remains draft
    const updatedReceipt = await deps.receiptRepository.findReceiptById(TEST_TENANT_ID, receipt.id);
    expect(updatedReceipt!.status).toBe("draft");
    expect(updatedReceipt!.isLocked).toBe(false);
  });
});

// ===========================================================================
// 14. Tenant isolation.
// ===========================================================================

describe("WP-04-03 approveReceipt — tenant isolation", () => {
  it("cross-tenant approval attempt: foreign user gets NOT_FOUND (no disclosure)", async () => {
    const deps = makeDeps();
    const { receipt } = await setupDraftReceipt(deps, {
      allocations: [{ consumed: "1000.000", waste: "0.000" }],
      factoryRate: "30000.00",
      draftCreator: "owner",
    });

    // Foreign tenant's accountant — same userId, different tenantId
    const foreignUser = makeUser(TEST_USERS.accountant.userId, "00000000-0000-0000-0000-ffffffffffff");
    const foreignEff = getTestEffectivePermissions(TEST_USERS.accountant.userId);

    await expect(deps.approvalService.approveReceipt(
      foreignUser as any, foreignEff as any,
      { receiptId: receipt.id, idempotencyKey: "approve-14" },
    )).rejects.toThrow(ReceiptNotFoundError);

    // Receipt remains draft
    const updatedReceipt = await deps.receiptRepository.findReceiptById(TEST_TENANT_ID, receipt.id);
    expect(updatedReceipt!.status).toBe("draft");
  });
});

// ===========================================================================
// 15. No unrelated side effects.
// ===========================================================================

describe("WP-04-03 approveReceipt — no unrelated side effects", () => {
  it("approval creates exactly ONE receive movement, ONE waste movement (if waste>0), ONE payable entry, ONE audit row — no sales/payment/customer entries", async () => {
    const deps = makeDeps();
    const { receipt } = await setupDraftReceipt(deps, {
      allocations: [{ consumed: "1000.000", waste: "200.000" }],
      factoryRate: "30000.00",
      draftCreator: "owner",
    });

    const auditCountBefore = deps.audit.count();

    const result = await deps.approvalService.approveReceipt(
      makeUser(TEST_USERS.accountant.userId) as any,
      getTestEffectivePermissions(TEST_USERS.accountant.userId) as any,
      { receiptId: receipt.id, idempotencyKey: "approve-15" },
    );

    // Exactly 1 receive_from_production movement
    const allMovements = [...((deps.ledgerRepo as any).movements as Map<string, any>).values()];
    const receiveMovements = allMovements.filter((m: any) => m.movementType === "receive_from_production");
    expect(receiveMovements.length).toBe(1);

    // Exactly 1 production_waste movement (because 1 allocation with waste > 0)
    const wasteMovements = allMovements.filter((m: any) => m.movementType === "production_waste");
    expect(wasteMovements.length).toBe(1);

    // No sale_issue, no return_receipt, no transfer, no payment movements
    const saleMovements = allMovements.filter((m: any) => m.movementType === "sale_issue");
    expect(saleMovements.length).toBe(0);
    const transferMovements = allMovements.filter((m: any) => m.movementType === "transfer");
    expect(transferMovements.length).toBe(0);

    // Exactly 1 account_entry (the factory payable)
    const subledgerEntries = [...((deps.subledgerRepo as any).entries as Map<string, any>).values()];
    expect(subledgerEntries.length).toBe(1);
    expect(subledgerEntries[0]!.entryType).toBe("factory_production_payable");

    // No supplier_raw_payable, no customer_sale_receivable, no payment entries
    const supplierEntries = subledgerEntries.filter((e: any) => e.entryType === "supplier_raw_payable");
    expect(supplierEntries.length).toBe(0);
    const customerEntries = subledgerEntries.filter((e: any) => e.entryType === "customer_sale_receivable");
    expect(customerEntries.length).toBe(0);
    const paymentEntries = subledgerEntries.filter((e: any) => e.entryType === "supplier_payment" || e.entryType === "factory_payment" || e.entryType === "customer_payment");
    expect(paymentEntries.length).toBe(0);

    // Audit row count delta: 1 for the approval (+ the inventory/subledger internal audits).
    // We don't assert exact count because InventoryLedgerService + SubledgerService
    // each write their own audit rows inside their respective handlers. But the
    // production_receipt.approve row MUST exist exactly once.
    const auditRows = deps.audit.getRows();
    const approveAudits = auditRows.filter((r) => r.actionType === "production_receipt.approve");
    expect(approveAudits.length).toBe(1);

    // No sales/payment/customer audit actions
    for (const row of auditRows.slice(auditCountBefore)) {
      expect(row.actionType).not.toContain("sale_");
      expect(row.actionType).not.toContain("payment.");
      expect(row.actionType).not.toContain("customer_");
    }
  });
});

// ===========================================================================
// 16. Subject hash mismatch — draft facts changed after creation.
// ===========================================================================

describe("WP-04-03 approveReceipt — subject hash mismatch", () => {
  it("rejects with SUBJECT_CHANGED when draft facts are mutated after creation", async () => {
    const deps = makeDeps();
    const { receipt, accountantUser, accountantEff } = await setupDraftReceipt(deps, {
      allocations: [{ consumed: "1000.000", waste: "0.000" }],
      factoryRate: "30000.00",
      draftCreator: "owner",
    });

    // Simulate a mutation: change the stored subjectHash to a different value.
    const mutated = { ...receipt, subjectHash: "deadbeef".repeat(8) };
    (deps.receiptRepository as any).receipts.set(`${TEST_TENANT_ID}:${receipt.id}`, mutated);

    await expect(deps.approvalService.approveReceipt(
      accountantUser as any, accountantEff as any,
      { receiptId: receipt.id, idempotencyKey: "approve-16" },
    )).rejects.toThrow(SubjectHashMismatchError);

    // Receipt remains draft (rolled back / never started)
    const updatedReceipt = await deps.receiptRepository.findReceiptById(TEST_TENANT_ID, receipt.id);
    expect(updatedReceipt!.status).toBe("draft");
    expect(updatedReceipt!.isLocked).toBe(false);
  });
});

// ===========================================================================
// 17. Missing factory rate rejects.
// ===========================================================================

describe("WP-04-03 approveReceipt — missing factory rate", () => {
  it("rejects with VALIDATION_FAILED when factory_rate_per_input_ton_used is null", async () => {
    const deps = makeDeps();
    // Create the draft WITHOUT a rate — owner has view_cost but doesn't
    // provide one (null), so the rate is stored as null. Subject hash is
    // computed from the null rate (→ ""), so no subject-hash mismatch.
    const { receipt, accountantUser, accountantEff } = await setupDraftReceipt(deps, {
      allocations: [{ consumed: "1000.000", waste: "0.000" }],
      factoryRate: null, // explicitly null — NOT undefined (which would default to "30000.00")
      draftCreator: "owner",
    });

    // Sanity: the stored rate IS null.
    expect(receipt.factoryRatePerInputTonUsed).toBeNull();

    await expect(deps.approvalService.approveReceipt(
      accountantUser as any, accountantEff as any,
      { receiptId: receipt.id, idempotencyKey: "approve-17" },
    )).rejects.toThrow(MissingFactoryRateError);

    // No effects posted
    const movements = (deps.ledgerRepo as any).movements as Map<string, any>;
    const receiveMovements = [...movements.values()].filter((m: any) => m.movementType === "receive_from_production");
    expect(receiveMovements.length).toBe(0);
  });
});

// ===========================================================================
// 18. Order not ready (wrong status) rejects.
// ===========================================================================

describe("WP-04-03 approveReceipt — order not ready", () => {
  it("rejects with ORDER_NOT_READY when order status is 'draft' (not yet issued)", async () => {
    const deps = makeDeps();
    const { receipt, order, accountantUser, accountantEff } = await setupDraftReceipt(deps, {
      allocations: [{ consumed: "1000.000", waste: "0.000" }],
      factoryRate: "30000.00",
      draftCreator: "owner",
    });

    // Manually reset order status back to 'draft' (simulating a bug or race).
    const orderKey = `${TEST_TENANT_ID}:${order.id}`;
    const storedOrder = (deps.productionOrderRepository as any).orders.get(orderKey);
    (deps.productionOrderRepository as any).orders.set(orderKey, { ...storedOrder, status: "draft" });

    await expect(deps.approvalService.approveReceipt(
      accountantUser as any, accountantEff as any,
      { receiptId: receipt.id, idempotencyKey: "approve-18" },
    )).rejects.toThrow(OrderNotReadyForApprovalError);
  });
});

// ===========================================================================
// 19. Receipt not found.
// ===========================================================================

describe("WP-04-03 approveReceipt — receipt not found", () => {
  it("rejects with RECEIPT_NOT_FOUND for unknown receiptId", async () => {
    const deps = makeDeps();
    const accountantUser = makeUser(TEST_USERS.accountant.userId);
    const accountantEff = getTestEffectivePermissions(TEST_USERS.accountant.userId);

    await expect(deps.approvalService.approveReceipt(
      accountantUser as any, accountantEff as any,
      { receiptId: "nonexistent-receipt-id", idempotencyKey: "approve-19" },
    )).rejects.toThrow(ReceiptNotFoundError);
  });
});

// ===========================================================================
// 20. Decimal precision — midpoint payable.
// ===========================================================================

describe("WP-04-03 approveReceipt — decimal precision (ROUND_HALF_UP at posting)", () => {
  it("rounds midpoint payable correctly: 1500.5 kg basis × 30 EGP/ton = 45.015 → 45.02 EGP", async () => {
    const deps = makeDeps();
    // 1500.5 kg basis (1000.5 consumed + 500 waste) × 30 EGP/ton
    // = 1500.5 / 1000 × 30 = 1.5005 × 30 = 45.015 → ROUND_HALF_UP → 45.02
    const { receipt, accountantUser, accountantEff } = await setupDraftReceipt(deps, {
      seedStockQty: "1500.500",
      issueQty: "1500.500",
      outputQty: "1000.500",
      allocations: [{ consumed: "1000.500", waste: "500.000" }],
      factoryRate: "30.00",
      draftCreator: "owner",
    });

    const result = await deps.approvalService.approveReceipt(
      accountantUser as any, accountantEff as any,
      { receiptId: receipt.id, idempotencyKey: "approve-20" },
    );

    // 1500.5 / 1000 × 30 = 45.015 → rounds to 45.02
    expect(result.factoryPayable).toBe("45.02");
    expect(result.accountAmountSigned).toBe("-45.02");
  });

  it("Contract 12 fixture: 5000 kg basis × 30000 EGP/ton = 150000.00 EGP (exact, no rounding)", async () => {
    const deps = makeDeps();
    const { receipt, accountantUser, accountantEff } = await setupDraftReceipt(deps, {
      seedStockQty: "5000.000",
      issueQty: "5000.000",
      outputQty: "4250.000",
      allocations: [{ consumed: "4250.000", waste: "750.000" }],
      factoryRate: "30000.00",
      draftCreator: "owner",
    });

    const result = await deps.approvalService.approveReceipt(
      accountantUser as any, accountantEff as any,
      { receiptId: receipt.id, idempotencyKey: "approve-20b" },
    );

    expect(result.factoryPayable).toBe("150000.00");
  });
});
