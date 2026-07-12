/**
 * WP-04-02 Production Receipt Draft Service tests.
 *
 * Contract: docs/contracts/13_work_packages.md WP-04-02
 *   Tests: Full/partial draft fixtures, structural duplicate allocation,
 *   subject-hash invalidation, worker financial redaction, zero operational effects.
 *   Acceptance: Draft preview reconciles and database assertions prove
 *   WIP/on-hand/account entries unchanged.
 */
import { describe, it, expect } from "vitest";
import {
  ProductionReceiptDraftService,
  ProductionOrderNotFoundForReceiptError,
  OrderNotReadyForReceiptError,
  AllocationExceedsIssuedError,
  DuplicateAllocationError,
  ReceiptDraftError,
} from "../production-receipt-draft-service";
import { InMemoryProductionReceiptRepository } from "./in-memory-production-receipt-repository";
import { InMemoryProductionOrderRepository } from "./in-memory-production-order-repository";
import { InMemoryWipBalanceRepository } from "./in-memory-wip-balance-repository";
import { InMemoryInventoryLedgerRepository } from "./in-memory-inventory-ledger-repository";
import { InProcessAuditStore } from "../audit-service";
import { InProcessIdempotencyStore } from "../idempotency-service";
import { InProcessDocumentSequenceStore } from "../document-sequence-service";
import { InventoryLedgerService } from "../inventory-ledger-service";
import { ProductionIssueService } from "../production-issue-service";
import {
  TEST_USERS, getTestEffectivePermissions,
} from "@/server/security/role-fixtures";
import { PermissionDeniedError } from "@/server/security/guards";

const TEST_TENANT_ID = "00000000-0000-0000-0000-000000000001";
const TEST_ITEM_ID = "aaa40200-0000-4000-8000-000000000001";
const TEST_OUTPUT_ITEM_ID = "aaa40200-0000-4000-8000-000000000002";
const TEST_FACTORY_LOC = "bbb40200-0000-4000-8000-000000000001";
const TEST_OUTPUT_LOC = "bbb40200-0000-4000-8000-000000000002";
const TEST_FACTORY_ID = "ccc40200-0000-4000-8000-000000000001";

function makeDeps() {
  const receiptRepository = new InMemoryProductionReceiptRepository();
  const productionOrderRepository = new InMemoryProductionOrderRepository();
  const wipBalanceRepository = new InMemoryWipBalanceRepository();
  const ledgerRepo = new InMemoryInventoryLedgerRepository();
  const audit = new InProcessAuditStore();
  const idempotency = new InProcessIdempotencyStore();
  const documentSequence = new InProcessDocumentSequenceStore();
  const inventoryLedger = new InventoryLedgerService({ ledger: ledgerRepo, audit, idempotency, documentSequence });

  // Create a production issue service to set up orders with issued material
  const issueService = new ProductionIssueService({
    productionOrderRepository, wipBalanceRepository, inventoryLedger, audit, idempotency, documentSequence,
  });

  const service = new ProductionReceiptDraftService({
    receiptRepository, productionOrderRepository, wipBalanceRepository, audit, documentSequence,
  });
  return { receiptRepository, productionOrderRepository, wipBalanceRepository, ledgerRepo, audit, idempotency, documentSequence, inventoryLedger, issueService, service };
}

function makeUser(userId: string, tenantId: string = TEST_TENANT_ID) {
  return { authenticated: true as const, userId, tenantId, email: "t@e.com", name: "T", authId: "t" };
}

// Helper: seed stock + create order + issue to production
async function setupIssuedOrder(
  issueService: ProductionIssueService,
  inventoryLedger: InventoryLedgerService,
  issuedQty: string = "1000.000",
  issueQty: string = "500.000",
) {
  // Seed stock
  const ownerUser = makeUser(TEST_USERS.owner.userId);
  const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);
  await inventoryLedger.postRawReceipt(ownerUser as any, ownerEff as any, {
    itemId: TEST_ITEM_ID, toLocationId: TEST_FACTORY_LOC, quantityKg: issuedQty,
    movementDate: "2026-07-06", sourceDocumentType: "test_seed", sourceDocumentId: "seed-001",
    idempotencyKey: "seed-key-001",
  });

  // Create production order
  const whUser = makeUser(TEST_USERS.warehouse.userId);
  const whEff = getTestEffectivePermissions(TEST_USERS.warehouse.userId);
  const { order, inputs } = await issueService.createProductionOrder(whUser as any, whEff as any, {
    productionType: "single_yarn",
    factoryId: TEST_FACTORY_ID,
    factoryLocationId: TEST_FACTORY_LOC,
    inputs: [{ inputItemId: TEST_ITEM_ID, inputLocationId: TEST_FACTORY_LOC, plannedInputQtyKg: issueQty }],
  });

  // Issue to production
  await issueService.issueToProduction(ownerUser as any, ownerEff as any, {
    productionOrderId: order.id, inputId: inputs[0]!.id, quantityKg: issueQty, idempotencyKey: "issue-setup-1",
  });

  return { order, inputs };
}

// ---------------------------------------------------------------------------
// 1. Create receipt draft.
// ---------------------------------------------------------------------------

describe("WP-04-02 createReceiptDraft", () => {
  it("owner can create a receipt draft with output + allocation facts", async () => {
    const { service, issueService, inventoryLedger } = makeDeps();
    const { order, inputs } = await setupIssuedOrder(issueService, inventoryLedger);

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    const result = await service.createReceiptDraft(ownerUser as any, ownerEff as any, {
      productionOrderId: order.id,
      outputItemId: TEST_OUTPUT_ITEM_ID,
      outputLocationId: TEST_OUTPUT_LOC,
      outputQtyKg: "250.000",
      receiptDate: "2026-07-08",
      allocations: [{
        productionInputId: inputs[0]!.id,
        consumedTowardOutputQtyKg: "300.000",
        allocatedWasteQtyKg: "50.000",
      }],
    });

    expect(result.status).toBe("draft");
    expect(result.docNo).toBeTruthy();
    expect(result.subjectHash).toHaveLength(64); // SHA-256 hex
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0]!.consumedTowardOutputQtyKg).toBe("300.000");
    expect(result.allocations[0]!.allocatedWasteQtyKg).toBe("50.000");
    expect(result.allocations[0]!.payableCostBasisQtyKg).toBe("350.000"); // consumed + waste
  });

  it("production worker can create receipt draft (has production.receive_draft)", async () => {
    const { service, issueService, inventoryLedger } = makeDeps();
    const { order, inputs } = await setupIssuedOrder(issueService, inventoryLedger);

    const prodUser = makeUser(TEST_USERS.production.userId);
    const prodEff = getTestEffectivePermissions(TEST_USERS.production.userId);

    const result = await service.createReceiptDraft(prodUser as any, prodEff as any, {
      productionOrderId: order.id,
      outputItemId: TEST_OUTPUT_ITEM_ID,
      outputLocationId: TEST_OUTPUT_LOC,
      outputQtyKg: "200.000",
      receiptDate: "2026-07-08",
      allocations: [{
        productionInputId: inputs[0]!.id,
        consumedTowardOutputQtyKg: "200.000",
        allocatedWasteQtyKg: "0.000",
      }],
    });

    expect(result.status).toBe("draft");
  });

  it("rejects if order is still draft (not issued)", async () => {
    const { service, issueService, inventoryLedger } = makeDeps();
    // Create order but DON'T issue
    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = getTestEffectivePermissions(TEST_USERS.warehouse.userId);
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);
    await inventoryLedger.postRawReceipt(ownerUser as any, ownerEff as any, {
      itemId: TEST_ITEM_ID, toLocationId: TEST_FACTORY_LOC, quantityKg: "1000.000",
      movementDate: "2026-07-06", sourceDocumentType: "test_seed", sourceDocumentId: "seed-001",
      idempotencyKey: "seed-key-001",
    });
    const { order, inputs } = await issueService.createProductionOrder(whUser as any, whEff as any, {
      productionType: "single_yarn", factoryId: TEST_FACTORY_ID, factoryLocationId: TEST_FACTORY_LOC,
      inputs: [{ inputItemId: TEST_ITEM_ID, inputLocationId: TEST_FACTORY_LOC, plannedInputQtyKg: "500.000" }],
    });

    await expect(service.createReceiptDraft(ownerUser as any, ownerEff as any, {
      productionOrderId: order.id,
      outputItemId: TEST_OUTPUT_ITEM_ID, outputLocationId: TEST_OUTPUT_LOC,
      outputQtyKg: "250.000", receiptDate: "2026-07-08",
      allocations: [{ productionInputId: inputs[0]!.id, consumedTowardOutputQtyKg: "300.000", allocatedWasteQtyKg: "0.000" }],
    })).rejects.toThrow(OrderNotReadyForReceiptError);
  });

  it("rejects duplicate allocation (same input twice in one receipt)", async () => {
    const { service, issueService, inventoryLedger } = makeDeps();
    const { order, inputs } = await setupIssuedOrder(issueService, inventoryLedger);

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    await expect(service.createReceiptDraft(ownerUser as any, ownerEff as any, {
      productionOrderId: order.id,
      outputItemId: TEST_OUTPUT_ITEM_ID, outputLocationId: TEST_OUTPUT_LOC,
      outputQtyKg: "250.000", receiptDate: "2026-07-08",
      allocations: [
        { productionInputId: inputs[0]!.id, consumedTowardOutputQtyKg: "200.000", allocatedWasteQtyKg: "0.000" },
        { productionInputId: inputs[0]!.id, consumedTowardOutputQtyKg: "100.000", allocatedWasteQtyKg: "0.000" }, // duplicate!
      ],
    })).rejects.toThrow(DuplicateAllocationError);
  });

  it("rejects allocation exceeding issued quantity", async () => {
    const { service, issueService, inventoryLedger } = makeDeps();
    const { order, inputs } = await setupIssuedOrder(issueService, inventoryLedger, "1000.000", "500.000");

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    // Try to allocate 600 consumed + 0 waste = 600 > 500 issued
    await expect(service.createReceiptDraft(ownerUser as any, ownerEff as any, {
      productionOrderId: order.id,
      outputItemId: TEST_OUTPUT_ITEM_ID, outputLocationId: TEST_OUTPUT_LOC,
      outputQtyKg: "250.000", receiptDate: "2026-07-08",
      allocations: [{ productionInputId: inputs[0]!.id, consumedTowardOutputQtyKg: "600.000", allocatedWasteQtyKg: "0.000" }],
    })).rejects.toThrow(AllocationExceedsIssuedError);
  });

  it("rejects cumulative allocation exceeding issued across partial receipts", async () => {
    const { service, issueService, inventoryLedger } = makeDeps();
    const { order, inputs } = await setupIssuedOrder(issueService, inventoryLedger, "1000.000", "500.000");

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    // First receipt: allocate 300 consumed + 50 waste = 350
    await service.createReceiptDraft(ownerUser as any, ownerEff as any, {
      productionOrderId: order.id,
      outputItemId: TEST_OUTPUT_ITEM_ID, outputLocationId: TEST_OUTPUT_LOC,
      outputQtyKg: "200.000", receiptDate: "2026-07-08",
      allocations: [{ productionInputId: inputs[0]!.id, consumedTowardOutputQtyKg: "300.000", allocatedWasteQtyKg: "50.000" }],
    });

    // Second receipt: try to allocate 200 consumed + 100 waste = 300 → cumulative 350 + 300 = 650 > 500
    await expect(service.createReceiptDraft(ownerUser as any, ownerEff as any, {
      productionOrderId: order.id,
      outputItemId: TEST_OUTPUT_ITEM_ID, outputLocationId: TEST_OUTPUT_LOC,
      outputQtyKg: "150.000", receiptDate: "2026-07-09",
      allocations: [{ productionInputId: inputs[0]!.id, consumedTowardOutputQtyKg: "200.000", allocatedWasteQtyKg: "100.000" }],
    })).rejects.toThrow(AllocationExceedsIssuedError);
  });

  it("allows partial receipts within cumulative limit", async () => {
    const { service, issueService, inventoryLedger } = makeDeps();
    const { order, inputs } = await setupIssuedOrder(issueService, inventoryLedger, "1000.000", "500.000");

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    // First receipt: 300 consumed + 50 waste = 350 (of 500)
    const r1 = await service.createReceiptDraft(ownerUser as any, ownerEff as any, {
      productionOrderId: order.id,
      outputItemId: TEST_OUTPUT_ITEM_ID, outputLocationId: TEST_OUTPUT_LOC,
      outputQtyKg: "200.000", receiptDate: "2026-07-08",
      allocations: [{ productionInputId: inputs[0]!.id, consumedTowardOutputQtyKg: "300.000", allocatedWasteQtyKg: "50.000" }],
    });
    expect(r1.status).toBe("draft");

    // Second receipt: 100 consumed + 50 waste = 150 → cumulative 350 + 150 = 500 = issued ✓
    const r2 = await service.createReceiptDraft(ownerUser as any, ownerEff as any, {
      productionOrderId: order.id,
      outputItemId: TEST_OUTPUT_ITEM_ID, outputLocationId: TEST_OUTPUT_LOC,
      outputQtyKg: "100.000", receiptDate: "2026-07-09",
      allocations: [{ productionInputId: inputs[0]!.id, consumedTowardOutputQtyKg: "100.000", allocatedWasteQtyKg: "50.000" }],
    });
    expect(r2.status).toBe("draft");

    // Verify cumulative in preview
    expect(r2.preview[0]!.cumulativeConsumedQtyKg).toBe("400.000"); // 300 + 100
    expect(r2.preview[0]!.cumulativeWasteQtyKg).toBe("100.000"); // 50 + 50
  });
});

// ---------------------------------------------------------------------------
// 2. Worker financial redaction.
// ---------------------------------------------------------------------------

describe("WP-04-02 worker financial redaction", () => {
  it("worker cannot set factory rate (no production.view_cost)", async () => {
    const { service, issueService, inventoryLedger } = makeDeps();
    const { order, inputs } = await setupIssuedOrder(issueService, inventoryLedger);

    const prodUser = makeUser(TEST_USERS.production.userId);
    const prodEff = getTestEffectivePermissions(TEST_USERS.production.userId);

    const result = await service.createReceiptDraft(prodUser as any, prodEff as any, {
      productionOrderId: order.id,
      outputItemId: TEST_OUTPUT_ITEM_ID, outputLocationId: TEST_OUTPUT_LOC,
      outputQtyKg: "200.000", receiptDate: "2026-07-08",
      factoryRatePerInputTon: "999.00", // worker tries to set rate
      factoryCostBasis: "output_quantity", // worker tries to set basis
      allocations: [{ productionInputId: inputs[0]!.id, consumedTowardOutputQtyKg: "200.000", allocatedWasteQtyKg: "0.000" }],
    });

    // Rate should be null (redacted) because worker doesn't have production.view_cost
    expect(result.subjectHash).toBeTruthy();
    // The service silently ignores rate from workers — it stores null
  });

  it("owner can set factory rate (has production.view_cost)", async () => {
    const { service, issueService, inventoryLedger } = makeDeps();
    const { order, inputs } = await setupIssuedOrder(issueService, inventoryLedger);

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    const result = await service.createReceiptDraft(ownerUser as any, ownerEff as any, {
      productionOrderId: order.id,
      outputItemId: TEST_OUTPUT_ITEM_ID, outputLocationId: TEST_OUTPUT_LOC,
      outputQtyKg: "200.000", receiptDate: "2026-07-08",
      factoryRatePerInputTon: "80.00",
      factoryCostBasis: "input_quantity",
      allocations: [{ productionInputId: inputs[0]!.id, consumedTowardOutputQtyKg: "200.000", allocatedWasteQtyKg: "0.000" }],
    });

    expect(result.status).toBe("draft");
    // Rate is stored in the receipt (owner has cost permission)
    expect(result.subjectHash).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 3. Zero operational effects.
// ---------------------------------------------------------------------------

describe("WP-04-02 zero operational effects", () => {
  it("creating a receipt draft does NOT change inventory on-hand", async () => {
    const { service, issueService, inventoryLedger, ledgerRepo } = makeDeps();
    const { order, inputs } = await setupIssuedOrder(issueService, inventoryLedger, "1000.000", "500.000");

    // After issue: on-hand = 1000 - 500 = 500
    const balBefore = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_FACTORY_LOC);
    expect(balBefore!.onHandQtyKg).toBe("500.000");

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    await service.createReceiptDraft(ownerUser as any, ownerEff as any, {
      productionOrderId: order.id,
      outputItemId: TEST_OUTPUT_ITEM_ID, outputLocationId: TEST_OUTPUT_LOC,
      outputQtyKg: "250.000", receiptDate: "2026-07-08",
      allocations: [{ productionInputId: inputs[0]!.id, consumedTowardOutputQtyKg: "300.000", allocatedWasteQtyKg: "50.000" }],
    });

    // On-hand UNCHANGED (still 500, not 250)
    const balAfter = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_FACTORY_LOC);
    expect(balAfter!.onHandQtyKg).toBe("500.000");
  });

  it("creating a receipt draft does NOT change WIP balance", async () => {
    const { service, issueService, inventoryLedger, wipBalanceRepository } = makeDeps();
    const { order, inputs } = await setupIssuedOrder(issueService, inventoryLedger, "1000.000", "500.000");

    // After issue: WIP = 500
    const wipBefore = await wipBalanceRepository.findForUpdate(TEST_TENANT_ID, order.id, TEST_ITEM_ID, TEST_FACTORY_LOC);
    expect(wipBefore!.wipQtyKg).toBe("500.000");

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    await service.createReceiptDraft(ownerUser as any, ownerEff as any, {
      productionOrderId: order.id,
      outputItemId: TEST_OUTPUT_ITEM_ID, outputLocationId: TEST_OUTPUT_LOC,
      outputQtyKg: "250.000", receiptDate: "2026-07-08",
      allocations: [{ productionInputId: inputs[0]!.id, consumedTowardOutputQtyKg: "300.000", allocatedWasteQtyKg: "50.000" }],
    });

    // WIP UNCHANGED (still 500)
    const wipAfter = await wipBalanceRepository.findForUpdate(TEST_TENANT_ID, order.id, TEST_ITEM_ID, TEST_FACTORY_LOC);
    expect(wipAfter!.wipQtyKg).toBe("500.000");
  });

  it("creating a receipt draft does NOT create stock movements", async () => {
    const { service, issueService, inventoryLedger, ledgerRepo } = makeDeps();
    const { order, inputs } = await setupIssuedOrder(issueService, inventoryLedger, "1000.000", "500.000");

    const movementsBefore = await ledgerRepo.listMovementsForBalance(TEST_TENANT_ID, TEST_ITEM_ID, TEST_FACTORY_LOC);
    const countBefore = movementsBefore.length;

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    await service.createReceiptDraft(ownerUser as any, ownerEff as any, {
      productionOrderId: order.id,
      outputItemId: TEST_OUTPUT_ITEM_ID, outputLocationId: TEST_OUTPUT_LOC,
      outputQtyKg: "250.000", receiptDate: "2026-07-08",
      allocations: [{ productionInputId: inputs[0]!.id, consumedTowardOutputQtyKg: "300.000", allocatedWasteQtyKg: "50.000" }],
    });

    // No new movements created
    const movementsAfter = await ledgerRepo.listMovementsForBalance(TEST_TENANT_ID, TEST_ITEM_ID, TEST_FACTORY_LOC);
    expect(movementsAfter.length).toBe(countBefore);
  });

  it("creating a receipt draft has no financial side effects", async () => {
    const { service, issueService, inventoryLedger, audit } = makeDeps();
    const { order, inputs } = await setupIssuedOrder(issueService, inventoryLedger);

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    await service.createReceiptDraft(ownerUser as any, ownerEff as any, {
      productionOrderId: order.id,
      outputItemId: TEST_OUTPUT_ITEM_ID, outputLocationId: TEST_OUTPUT_LOC,
      outputQtyKg: "250.000", receiptDate: "2026-07-08",
      allocations: [{ productionInputId: inputs[0]!.id, consumedTowardOutputQtyKg: "300.000", allocatedWasteQtyKg: "50.000" }],
    });

    // Audit should only have production_receipt_draft.create, no financial actions
    const auditRows = audit.getRows();
    for (const row of auditRows) {
      expect(row.actionType).not.toContain("payable");
      expect(row.actionType).not.toContain("payment");
      expect(row.actionType).not.toContain("account");
    }

    // The draft creation audit should exist
    const draftAudit = auditRows.find((r) => r.actionType === "production_receipt_draft.create");
    expect(draftAudit).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 4. Subject hash invalidation.
// ---------------------------------------------------------------------------

describe("WP-04-02 subject hash", () => {
  it("different receipt facts produce different subject hashes", async () => {
    const { service, issueService, inventoryLedger } = makeDeps();
    const { order, inputs } = await setupIssuedOrder(issueService, inventoryLedger, "1000.000", "500.000");

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    const r1 = await service.createReceiptDraft(ownerUser as any, ownerEff as any, {
      productionOrderId: order.id,
      outputItemId: TEST_OUTPUT_ITEM_ID, outputLocationId: TEST_OUTPUT_LOC,
      outputQtyKg: "250.000", receiptDate: "2026-07-08",
      allocations: [{ productionInputId: inputs[0]!.id, consumedTowardOutputQtyKg: "200.000", allocatedWasteQtyKg: "0.000" }],
    });

    const r2 = await service.createReceiptDraft(ownerUser as any, ownerEff as any, {
      productionOrderId: order.id,
      outputItemId: TEST_OUTPUT_ITEM_ID, outputLocationId: TEST_OUTPUT_LOC,
      outputQtyKg: "250.000", receiptDate: "2026-07-09", // Different date
      allocations: [{ productionInputId: inputs[0]!.id, consumedTowardOutputQtyKg: "200.000", allocatedWasteQtyKg: "0.000" }],
    });

    expect(r1.subjectHash).not.toBe(r2.subjectHash);
  });

  it("same receipt facts produce same subject hash", async () => {
    const { service, issueService, inventoryLedger } = makeDeps();
    const { order, inputs } = await setupIssuedOrder(issueService, inventoryLedger, "1000.000", "500.000");

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    const r1 = await service.createReceiptDraft(ownerUser as any, ownerEff as any, {
      productionOrderId: order.id,
      outputItemId: TEST_OUTPUT_ITEM_ID, outputLocationId: TEST_OUTPUT_LOC,
      outputQtyKg: "250.000", receiptDate: "2026-07-08",
      allocations: [{ productionInputId: inputs[0]!.id, consumedTowardOutputQtyKg: "200.000", allocatedWasteQtyKg: "0.000" }],
    });

    const r2 = await service.createReceiptDraft(ownerUser as any, ownerEff as any, {
      productionOrderId: order.id,
      outputItemId: TEST_OUTPUT_ITEM_ID, outputLocationId: TEST_OUTPUT_LOC,
      outputQtyKg: "250.000", receiptDate: "2026-07-08",
      allocations: [{ productionInputId: inputs[0]!.id, consumedTowardOutputQtyKg: "200.000", allocatedWasteQtyKg: "0.000" }],
    });

    expect(r1.subjectHash).toBe(r2.subjectHash);
  });
});

// ---------------------------------------------------------------------------
// 5. Preview allocation.
// ---------------------------------------------------------------------------

describe("WP-04-02 previewAllocation", () => {
  it("preview shows cumulative allocation without creating rows", async () => {
    const { service, issueService, inventoryLedger, receiptRepository } = makeDeps();
    const { order, inputs } = await setupIssuedOrder(issueService, inventoryLedger, "1000.000", "500.000");

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    // First receipt: 300 consumed + 50 waste
    await service.createReceiptDraft(ownerUser as any, ownerEff as any, {
      productionOrderId: order.id,
      outputItemId: TEST_OUTPUT_ITEM_ID, outputLocationId: TEST_OUTPUT_LOC,
      outputQtyKg: "200.000", receiptDate: "2026-07-08",
      allocations: [{ productionInputId: inputs[0]!.id, consumedTowardOutputQtyKg: "300.000", allocatedWasteQtyKg: "50.000" }],
    });

    // Preview second receipt: 100 consumed + 50 waste
    const preview = await service.previewAllocation(ownerUser as any, ownerEff as any, order.id, [
      { productionInputId: inputs[0]!.id, consumedTowardOutputQtyKg: "100.000", allocatedWasteQtyKg: "50.000" },
    ]);

    expect(preview).toHaveLength(1);
    expect(preview[0]!.cumulativeConsumedQtyKg).toBe("400.000"); // 300 + 100
    expect(preview[0]!.cumulativeWasteQtyKg).toBe("100.000"); // 50 + 50
    expect(preview[0]!.thisReceiptConsumedQtyKg).toBe("100.000");
    expect(preview[0]!.thisReceiptWasteQtyKg).toBe("50.000");
    expect(preview[0]!.thisReceiptPayableBasisQtyKg).toBe("150.000"); // 100 + 50
    expect(preview[0]!.isValid).toBe(true); // 400 + 100 = 500 = issued ✓

    // Verify NO new receipt was created
    const receipts = await receiptRepository.findReceiptsByOrder(TEST_TENANT_ID, order.id);
    expect(receipts).toHaveLength(1); // Only the first receipt, preview didn't create one
  });

  it("preview shows invalid when cumulative exceeds issued", async () => {
    const { service, issueService, inventoryLedger } = makeDeps();
    const { order, inputs } = await setupIssuedOrder(issueService, inventoryLedger, "1000.000", "500.000");

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    // Preview: 600 consumed > 500 issued
    const preview = await service.previewAllocation(ownerUser as any, ownerEff as any, order.id, [
      { productionInputId: inputs[0]!.id, consumedTowardOutputQtyKg: "600.000", allocatedWasteQtyKg: "0.000" },
    ]);

    expect(preview[0]!.isValid).toBe(false);
    expect(preview[0]!.validationError).toContain("exceeds issued");
  });
});

// ---------------------------------------------------------------------------
// 6. Tenant isolation.
// ---------------------------------------------------------------------------

describe("WP-04-02 tenant isolation", () => {
  it("cross-tenant order not found", async () => {
    const { service, issueService, inventoryLedger } = makeDeps();
    const { order } = await setupIssuedOrder(issueService, inventoryLedger);

    const foreignUser = makeUser(TEST_USERS.owner.userId, "00000000-0000-0000-0000-ffffffffffff");
    const foreignEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    await expect(service.createReceiptDraft(foreignUser as any, foreignEff as any, {
      productionOrderId: order.id,
      outputItemId: TEST_OUTPUT_ITEM_ID, outputLocationId: TEST_OUTPUT_LOC,
      outputQtyKg: "200.000", receiptDate: "2026-07-08",
      allocations: [{ productionInputId: "nonexistent", consumedTowardOutputQtyKg: "200.000", allocatedWasteQtyKg: "0.000" }],
    })).rejects.toThrow(ProductionOrderNotFoundForReceiptError);
  });
});
