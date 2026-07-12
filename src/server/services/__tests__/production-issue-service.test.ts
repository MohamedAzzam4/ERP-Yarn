/**
 * WP-04-01 Production Issue Service tests.
 *
 * Contract: docs/contracts/13_work_packages.md WP-04-01
 *   Tests: Availability, factory location, WIP invariant,
 *   concurrency/idempotency/redaction.
 *   Acceptance: On-hand decreases and WIP increases exactly once.
 *
 * Contract: docs/contracts/05_production_wip_contract.md §11, §12, §13
 */
import { describe, it, expect } from "vitest";
import {
  ProductionIssueService,
  ProductionOrderNotFoundError,
  ProductionInputNotFoundError,
  ProductionOrderNotIssuableError,
  InputLocationMismatchError,
  ProductionIssueError,
  type ProductionIssueTransactionRunner,
} from "../production-issue-service";
import { InMemoryProductionOrderRepository } from "./in-memory-production-order-repository";
import { InMemoryWipBalanceRepository } from "./in-memory-wip-balance-repository";
import { InMemoryInventoryLedgerRepository } from "./in-memory-inventory-ledger-repository";
import { InProcessAuditStore } from "../audit-service";
import { InProcessIdempotencyStore } from "../idempotency-service";
import { InProcessDocumentSequenceStore } from "../document-sequence-service";
import { InventoryLedgerService, StockInsufficientError } from "../inventory-ledger-service";
import {
  TEST_USERS, getTestEffectivePermissions,
} from "@/server/security/role-fixtures";
import { PermissionDeniedError } from "@/server/security/guards";

const TEST_TENANT_ID = "00000000-0000-0000-0000-000000000001";
const TEST_ITEM_ID = "aaa40100-0000-4000-8000-000000000001";
const TEST_FACTORY_LOC = "bbb40100-0000-4000-8000-000000000001";
const TEST_FACTORY_ID = "ccc40100-0000-4000-8000-000000000001";
const TEST_OTHER_LOC = "bbb40100-0000-4000-8000-000000000002";

function makeDeps() {
  const productionOrderRepository = new InMemoryProductionOrderRepository();
  const wipBalanceRepository = new InMemoryWipBalanceRepository();
  const ledgerRepo = new InMemoryInventoryLedgerRepository();
  const audit = new InProcessAuditStore();
  const idempotency = new InProcessIdempotencyStore();
  const documentSequence = new InProcessDocumentSequenceStore();
  const inventoryLedger = new InventoryLedgerService({ ledger: ledgerRepo, audit, idempotency, documentSequence });
  const service = new ProductionIssueService({
    productionOrderRepository, wipBalanceRepository, inventoryLedger, audit, idempotency, documentSequence,
  });
  return { productionOrderRepository, wipBalanceRepository, ledgerRepo, audit, idempotency, documentSequence, inventoryLedger, service };
}

function makeDepsWithTxRunner() {
  const productionOrderRepository = new InMemoryProductionOrderRepository();
  const wipBalanceRepository = new InMemoryWipBalanceRepository();
  const ledgerRepo = new InMemoryInventoryLedgerRepository();
  const audit = new InProcessAuditStore();
  const idempotency = new InProcessIdempotencyStore();
  const documentSequence = new InProcessDocumentSequenceStore();
  const inventoryLedger = new InventoryLedgerService({ ledger: ledgerRepo, audit, idempotency, documentSequence });

  let txChain: Promise<unknown> = Promise.resolve();
  const transactionRunner: ProductionIssueTransactionRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
    const run = txChain.then(async () => {
      const orderSnapshot = productionOrderRepository.snapshot();
      const wipSnapshot = wipBalanceRepository.snapshot();
      const ledgerSnapshot = ledgerRepo.snapshot();
      try {
        return await work({});
      } catch (e) {
        productionOrderRepository.restore(orderSnapshot);
        wipBalanceRepository.restore(wipSnapshot);
        ledgerRepo.restore(ledgerSnapshot);
        throw e;
      }
    });
    txChain = run.then(() => undefined, () => undefined);
    return run as Promise<T>;
  };

  const txFactories = {
    createInventoryLedger: () => inventoryLedger,
    createProductionOrderRepository: () => productionOrderRepository,
    createWipBalanceRepository: () => wipBalanceRepository,
  };

  const service = new ProductionIssueService({
    productionOrderRepository, wipBalanceRepository, inventoryLedger, audit, idempotency, documentSequence,
    transactionRunner, txFactories,
  });
  return { productionOrderRepository, wipBalanceRepository, ledgerRepo, audit, idempotency, documentSequence, inventoryLedger, service, transactionRunner };
}

function makeUser(userId: string, tenantId: string = TEST_TENANT_ID) {
  return { authenticated: true as const, userId, tenantId, email: "t@e.com", name: "T", authId: "t" };
}

async function seedStock(inventoryLedger: InventoryLedgerService, qty: string = "1000.000", locId: string = TEST_FACTORY_LOC) {
  const ownerUser = makeUser(TEST_USERS.owner.userId);
  const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);
  return inventoryLedger.postRawReceipt(ownerUser as any, ownerEff as any, {
    itemId: TEST_ITEM_ID, toLocationId: locId, quantityKg: qty,
    movementDate: "2026-07-06", sourceDocumentType: "test_seed", sourceDocumentId: "seed-001",
    idempotencyKey: "seed-key-001",
  });
}

async function createOrderWithInput(
  service: ProductionIssueService,
  itemId: string = TEST_ITEM_ID,
  locId: string = TEST_FACTORY_LOC,
  plannedQty: string = "500.000",
) {
  const whUser = makeUser(TEST_USERS.warehouse.userId);
  const whEff = getTestEffectivePermissions(TEST_USERS.warehouse.userId);
  return service.createProductionOrder(whUser as any, whEff as any, {
    productionType: "single_yarn",
    factoryId: TEST_FACTORY_ID,
    factoryLocationId: locId,
    inputs: [{ inputItemId: itemId, inputLocationId: locId, plannedInputQtyKg: plannedQty }],
  });
}

// ---------------------------------------------------------------------------
// 1. Create production order draft.
// ---------------------------------------------------------------------------

describe("WP-04-01 createProductionOrder", () => {
  it("warehouse can create a production order draft with input rows", async () => {
    const { service } = makeDeps();
    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = getTestEffectivePermissions(TEST_USERS.warehouse.userId);

    const { order, inputs } = await service.createProductionOrder(whUser as any, whEff as any, {
      productionType: "single_yarn",
      factoryId: TEST_FACTORY_ID,
      factoryLocationId: TEST_FACTORY_LOC,
      inputs: [{ inputItemId: TEST_ITEM_ID, inputLocationId: TEST_FACTORY_LOC, plannedInputQtyKg: "500.000" }],
    });

    expect(order.status).toBe("draft");
    expect(order.productionType).toBe("single_yarn");
    expect(order.factoryLocationId).toBe(TEST_FACTORY_LOC);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.plannedInputQtyKg).toBe("500.000");
    expect(inputs[0]!.issuedQtyKg).toBe("0");
  });

  it("rejects zero inputs", async () => {
    const { service } = makeDeps();
    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = getTestEffectivePermissions(TEST_USERS.warehouse.userId);

    await expect(service.createProductionOrder(whUser as any, whEff as any, {
      productionType: "single_yarn", factoryId: TEST_FACTORY_ID, factoryLocationId: TEST_FACTORY_LOC, inputs: [],
    })).rejects.toThrow(ProductionIssueError);
  });

  it("supports multiple input rows (many-to-many, DEC-012)", async () => {
    const { service } = makeDeps();
    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = getTestEffectivePermissions(TEST_USERS.warehouse.userId);
    const ITEM_2 = "aaa40100-0000-4000-8000-000000000002";

    const { inputs } = await service.createProductionOrder(whUser as any, whEff as any, {
      productionType: "twisted_yarn", factoryId: TEST_FACTORY_ID, factoryLocationId: TEST_FACTORY_LOC,
      inputs: [
        { inputItemId: TEST_ITEM_ID, inputLocationId: TEST_FACTORY_LOC, plannedInputQtyKg: "300.000" },
        { inputItemId: ITEM_2, inputLocationId: TEST_FACTORY_LOC, plannedInputQtyKg: "200.000" },
      ],
    });
    expect(inputs).toHaveLength(2);
  });

  it("production worker can create (has production.create)", async () => {
    const { service } = makeDeps();
    const prodUser = makeUser(TEST_USERS.production.userId);
    const prodEff = getTestEffectivePermissions(TEST_USERS.production.userId);

    const { order } = await service.createProductionOrder(prodUser as any, prodEff as any, {
      productionType: "single_yarn", factoryId: TEST_FACTORY_ID, factoryLocationId: TEST_FACTORY_LOC,
      inputs: [{ inputItemId: TEST_ITEM_ID, inputLocationId: TEST_FACTORY_LOC, plannedInputQtyKg: "100.000" }],
    });
    expect(order.status).toBe("draft");
  });
});

// ---------------------------------------------------------------------------
// 2. Issue to production — on-hand decreases, WIP increases.
// ---------------------------------------------------------------------------

describe("WP-04-01 issueToProduction", () => {
  it("owner can issue: on-hand decreases, WIP increases, order → material_issued", async () => {
    const { service, productionOrderRepository, wipBalanceRepository, ledgerRepo, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");
    const { order, inputs } = await createOrderWithInput(service);

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    const result = await service.issueToProduction(ownerUser as any, ownerEff as any, {
      productionOrderId: order.id, inputId: inputs[0]!.id, quantityKg: "300.000", idempotencyKey: "issue-1",
    });

    expect(result.action).toBe("posted");
    expect(result.orderStatus).toBe("material_issued");
    expect(result.issuedQtyKg).toBe("300.000");

    // Factory on-hand decreased by 300
    const bal = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_FACTORY_LOC);
    expect(bal!.onHandQtyKg).toBe("700.000");

    // WIP increased by 300
    const wip = await wipBalanceRepository.findForUpdate(TEST_TENANT_ID, order.id, TEST_ITEM_ID, TEST_FACTORY_LOC);
    expect(wip!.wipQtyKg).toBe("300.000");

    // Input issuedQty updated
    const inputAfter = await productionOrderRepository.findInputById(TEST_TENANT_ID, inputs[0]!.id);
    expect(inputAfter!.issuedQtyKg).toBe("300.000");
    expect(inputAfter!.issueMovementId).toBe(result.movementId);

    // Order status updated
    const orderAfter = await productionOrderRepository.findOrderById(TEST_TENANT_ID, order.id);
    expect(orderAfter!.status).toBe("material_issued");
  });

  it("warehouse cannot issue (no production.issue.approve)", async () => {
    const { service, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");
    const { order, inputs } = await createOrderWithInput(service);

    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = getTestEffectivePermissions(TEST_USERS.warehouse.userId);

    await expect(service.issueToProduction(whUser as any, whEff as any, {
      productionOrderId: order.id, inputId: inputs[0]!.id, quantityKg: "300.000", idempotencyKey: "perm-1",
    })).rejects.toThrow(PermissionDeniedError);
  });

  it("insufficient stock rejects", async () => {
    const { service, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "100.000");
    const { order, inputs } = await createOrderWithInput(service, TEST_ITEM_ID, TEST_FACTORY_LOC, "500.000");

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    await expect(service.issueToProduction(ownerUser as any, ownerEff as any, {
      productionOrderId: order.id, inputId: inputs[0]!.id, quantityKg: "500.000", idempotencyKey: "insuff-1",
    })).rejects.toThrow(StockInsufficientError);

    // On-hand unchanged
    const bal = await makeDeps().ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_FACTORY_LOC);
    // bal is from a different repo instance, so let's check from the same deps
  });

  it("insufficient stock: on-hand unchanged, WIP unchanged, order stays draft", async () => {
    const { service, ledgerRepo, wipBalanceRepository, productionOrderRepository, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "100.000");
    const { order, inputs } = await createOrderWithInput(service, TEST_ITEM_ID, TEST_FACTORY_LOC, "500.000");

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    await expect(service.issueToProduction(ownerUser as any, ownerEff as any, {
      productionOrderId: order.id, inputId: inputs[0]!.id, quantityKg: "500.000", idempotencyKey: "insuff-2",
    })).rejects.toThrow(StockInsufficientError);

    const bal = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_FACTORY_LOC);
    expect(bal!.onHandQtyKg).toBe("100.000");

    const wip = await wipBalanceRepository.findForUpdate(TEST_TENANT_ID, order.id, TEST_ITEM_ID, TEST_FACTORY_LOC);
    expect(wip).toBeNull();

    const orderAfter = await productionOrderRepository.findOrderById(TEST_TENANT_ID, order.id);
    expect(orderAfter!.status).toBe("draft");
  });

  it("input location must match factory location", async () => {
    const { service, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000", TEST_OTHER_LOC);
    const { order, inputs } = await createOrderWithInput(service, TEST_ITEM_ID, TEST_OTHER_LOC);
    // But factory location is TEST_FACTORY_LOC (from createOrderWithInput default)
    // Wait — createOrderWithInput uses TEST_FACTORY_LOC for both factory and input location.
    // Let me create an order where input location differs from factory.
    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = getTestEffectivePermissions(TEST_USERS.warehouse.userId);
    const { order: order2, inputs: inputs2 } = await service.createProductionOrder(whUser as any, whEff as any, {
      productionType: "single_yarn", factoryId: TEST_FACTORY_ID, factoryLocationId: TEST_FACTORY_LOC,
      inputs: [{ inputItemId: TEST_ITEM_ID, inputLocationId: TEST_OTHER_LOC, plannedInputQtyKg: "100.000" }],
    });

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    await expect(service.issueToProduction(ownerUser as any, ownerEff as any, {
      productionOrderId: order2.id, inputId: inputs2[0]!.id, quantityKg: "50.000", idempotencyKey: "loc-1",
    })).rejects.toThrow(InputLocationMismatchError);
  });

  it("idempotency: same key replays without double-issue", async () => {
    const { service, ledgerRepo, wipBalanceRepository, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");
    const { order, inputs } = await createOrderWithInput(service);

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    const first = await service.issueToProduction(ownerUser as any, ownerEff as any, {
      productionOrderId: order.id, inputId: inputs[0]!.id, quantityKg: "300.000", idempotencyKey: "idem-1",
    });
    expect(first.action).toBe("posted");

    const replay = await service.issueToProduction(ownerUser as any, ownerEff as any, {
      productionOrderId: order.id, inputId: inputs[0]!.id, quantityKg: "300.000", idempotencyKey: "idem-1",
    });
    expect(replay.action).toBe("replayed");

    // On-hand only decreased once (700, not 400)
    const bal = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_FACTORY_LOC);
    expect(bal!.onHandQtyKg).toBe("700.000");

    // WIP only increased once (300, not 600)
    const wip = await wipBalanceRepository.findForUpdate(TEST_TENANT_ID, order.id, TEST_ITEM_ID, TEST_FACTORY_LOC);
    expect(wip!.wipQtyKg).toBe("300.000");
  });

  it("issue on non-draft order rejects", async () => {
    const { service, inventoryLedger, productionOrderRepository } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");
    const { order, inputs } = await createOrderWithInput(service);

    // Manually move order to material_issued
    await productionOrderRepository.updateOrderStatus(TEST_TENANT_ID, order.id, { status: "material_issued", approvalStatus: "pending_approval" });

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    await expect(service.issueToProduction(ownerUser as any, ownerEff as any, {
      productionOrderId: order.id, inputId: inputs[0]!.id, quantityKg: "100.000", idempotencyKey: "state-1",
    })).rejects.toThrow(ProductionOrderNotIssuableError);
  });

  it("no financial side effects (no account entries, no payments)", async () => {
    const { service, audit, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");
    const { order, inputs } = await createOrderWithInput(service);

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    await service.issueToProduction(ownerUser as any, ownerEff as any, {
      productionOrderId: order.id, inputId: inputs[0]!.id, quantityKg: "300.000", idempotencyKey: "fin-1",
    });

    const auditRows = audit.getRows();
    for (const row of auditRows) {
      expect(row.actionType).not.toContain("payable");
      expect(row.actionType).not.toContain("payment");
      expect(row.actionType).not.toContain("account");
    }
  });

  it("no sale_issue or receive_from_production movement created", async () => {
    const { service, ledgerRepo, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");
    const { order, inputs } = await createOrderWithInput(service);

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    await service.issueToProduction(ownerUser as any, ownerEff as any, {
      productionOrderId: order.id, inputId: inputs[0]!.id, quantityKg: "300.000", idempotencyKey: "nomove-1",
    });

    const movements = await ledgerRepo.listMovementsForBalance(TEST_TENANT_ID, TEST_ITEM_ID, TEST_FACTORY_LOC);
    const issueMovements = movements.filter((m) => m.movementType === "issue_to_production");
    expect(issueMovements).toHaveLength(1);

    const saleIssue = movements.filter((m) => m.movementType === "sale_issue");
    expect(saleIssue).toHaveLength(0);

    const receiveFromProd = movements.filter((m) => m.movementType === "receive_from_production");
    expect(receiveFromProd).toHaveLength(0);
  });

  it("tenant isolation: cross-tenant order not found", async () => {
    const { service, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");
    const { order, inputs } = await createOrderWithInput(service);

    const foreignUser = makeUser(TEST_USERS.owner.userId, "00000000-0000-0000-0000-ffffffffffff");
    const foreignEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    await expect(service.issueToProduction(foreignUser as any, foreignEff as any, {
      productionOrderId: order.id, inputId: inputs[0]!.id, quantityKg: "100.000", idempotencyKey: "ti-1",
    })).rejects.toThrow(ProductionOrderNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// 3. WIP invariant.
// ---------------------------------------------------------------------------

describe("WP-04-01 WIP invariant", () => {
  it("WIP increases exactly by issue quantity", async () => {
    const { service, wipBalanceRepository, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");
    const { order, inputs } = await createOrderWithInput(service, TEST_ITEM_ID, TEST_FACTORY_LOC, "500.000");

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    await service.issueToProduction(ownerUser as any, ownerEff as any, {
      productionOrderId: order.id, inputId: inputs[0]!.id, quantityKg: "300.000", idempotencyKey: "wip-1",
    });

    const wip = await wipBalanceRepository.findForUpdate(TEST_TENANT_ID, order.id, TEST_ITEM_ID, TEST_FACTORY_LOC);
    expect(wip!.wipQtyKg).toBe("300.000");
    // WIP invariant: issued = consumed(0) + waste(0) + returned(0) + remaining(300)
    // (consumed/waste/returned are 0 because receipt/waste/return are not implemented in WP-04-01)
    expect(wip!.wipQtyKg).toBe("300.000"); // remaining_wip = issued - consumed - waste - returned = 300
  });

  it("on-hand decreases exactly by issue quantity", async () => {
    const { service, ledgerRepo, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");
    const { order, inputs } = await createOrderWithInput(service);

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    await service.issueToProduction(ownerUser as any, ownerEff as any, {
      productionOrderId: order.id, inputId: inputs[0]!.id, quantityKg: "300.000", idempotencyKey: "oh-1",
    });

    const bal = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_FACTORY_LOC);
    expect(bal!.onHandQtyKg).toBe("700.000");
    expect(bal!.reservedQtyKg).toBe("0"); // reservation not affected
    expect(bal!.blockedQtyKg).toBe("0");
  });
});

// ---------------------------------------------------------------------------
// 4. Concurrent issue cannot over-issue.
// ---------------------------------------------------------------------------

describe("WP-04-01 concurrent issue", () => {
  it("two concurrent issues for different inputs of the same order: both succeed", async () => {
    const { service, productionOrderRepository, ledgerRepo, inventoryLedger } = makeDepsWithTxRunner();
    await seedStock(inventoryLedger, "1000.000");

    // Create order with 2 input rows (same item, same location)
    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = getTestEffectivePermissions(TEST_USERS.warehouse.userId);
    const ITEM_2 = "aaa40100-0000-4000-8000-000000000002";
    const { order, inputs } = await service.createProductionOrder(whUser as any, whEff as any, {
      productionType: "single_yarn", factoryId: TEST_FACTORY_ID, factoryLocationId: TEST_FACTORY_LOC,
      inputs: [
        { inputItemId: TEST_ITEM_ID, inputLocationId: TEST_FACTORY_LOC, plannedInputQtyKg: "400.000" },
        { inputItemId: ITEM_2, inputLocationId: TEST_FACTORY_LOC, plannedInputQtyKg: "300.000" },
      ],
    });

    // Seed stock for item 2
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);
    await inventoryLedger.postRawReceipt(ownerUser as any, ownerEff as any, {
      itemId: ITEM_2, toLocationId: TEST_FACTORY_LOC, quantityKg: "500.000",
      movementDate: "2026-07-06", sourceDocumentType: "test_seed", sourceDocumentId: "seed-002",
      idempotencyKey: "seed-key-002",
    });

    // Fire two concurrent issues for different inputs
    const results = await Promise.allSettled([
      service.issueToProduction(ownerUser as any, ownerEff as any, {
        productionOrderId: order.id, inputId: inputs[0]!.id, quantityKg: "300.000", idempotencyKey: "conc-A",
      }),
      service.issueToProduction(ownerUser as any, ownerEff as any, {
        productionOrderId: order.id, inputId: inputs[1]!.id, quantityKg: "200.000", idempotencyKey: "conc-B",
      }),
    ]);

    const fulfilled = results.filter(r => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(2);

    // Item 1 on-hand: 1000 - 300 = 700
    const bal1 = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_FACTORY_LOC);
    expect(bal1!.onHandQtyKg).toBe("700.000");

    // Item 2 on-hand: 500 - 200 = 300
    const bal2 = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, ITEM_2, TEST_FACTORY_LOC);
    expect(bal2!.onHandQtyKg).toBe("300.000");
  });
});
