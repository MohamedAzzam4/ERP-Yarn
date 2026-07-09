/**
 * WP-03-03 Sales Submission Service tests.
 *
 * Contract: docs/contracts/13_work_packages.md WP-03-03
 *   Tests: Fixture, concurrent oversell, cancellation/rejection/manual release,
 *   idempotency.
 *   Acceptance: On-hand unchanged at submission and reservation reconciles.
 */
import { describe, it, expect } from "vitest";
import {
  SalesSubmissionService,
  SaleNotFoundError,
  SaleAlreadySubmittedError,
  SaleHasNoLinesError,
  InsufficientAvailableStockError,
  SalesSubmissionError,
  type SalesSubmissionTransactionRunner,
} from "../sales-submission-service";
import { InMemorySalesRepository } from "./in-memory-sales-repository";
import { InMemoryStockReservationRepository } from "./in-memory-stock-reservation-repository";
import { InMemoryInventoryLedgerRepository } from "./in-memory-inventory-ledger-repository";
import { InProcessAuditStore } from "../audit-service";
import { InProcessIdempotencyStore } from "../idempotency-service";
import { InProcessDocumentSequenceStore } from "../document-sequence-service";
import { InventoryLedgerService } from "../inventory-ledger-service";
import {
  TEST_USERS, getTestEffectivePermissions,
} from "@/server/security/role-fixtures";
import { PermissionDeniedError } from "@/server/security/guards";

const TEST_TENANT_ID = "00000000-0000-0000-0000-000000000001";
const TEST_ITEM_ID = "aaa30300-0000-4000-8000-000000000001";
const TEST_LOC_A = "bbb30300-0000-4000-8000-000000000001";
const TEST_CUSTOMER_ID = "ccc30300-0000-4000-8000-000000000001";

function makeDeps() {
  const salesRepository = new InMemorySalesRepository();
  const reservationRepository = new InMemoryStockReservationRepository();
  const ledgerRepo = new InMemoryInventoryLedgerRepository();
  const audit = new InProcessAuditStore();
  const idempotency = new InProcessIdempotencyStore();
  const documentSequence = new InProcessDocumentSequenceStore();
  const inventoryLedger = new InventoryLedgerService({ ledger: ledgerRepo, audit, idempotency, documentSequence });
  const service = new SalesSubmissionService({
    salesRepository, reservationRepository, inventoryLedger, audit, idempotency, documentSequence,
  });
  return { salesRepository, reservationRepository, ledgerRepo, audit, idempotency, documentSequence, inventoryLedger, service };
}

function makeDepsWithTxRunner() {
  const salesRepository = new InMemorySalesRepository();
  const reservationRepository = new InMemoryStockReservationRepository();
  const ledgerRepo = new InMemoryInventoryLedgerRepository();
  const audit = new InProcessAuditStore();
  const idempotency = new InProcessIdempotencyStore();
  const documentSequence = new InProcessDocumentSequenceStore();
  const inventoryLedger = new InventoryLedgerService({ ledger: ledgerRepo, audit, idempotency, documentSequence });

  let txChain: Promise<unknown> = Promise.resolve();
  const transactionRunner: SalesSubmissionTransactionRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
    const run = txChain.then(async () => {
      const salesSnapshot = salesRepository.snapshot();
      const resSnapshot = reservationRepository.snapshot();
      const ledgerSnapshot = ledgerRepo.snapshot();
      try {
        return await work({ /* mock tx */ });
      } catch (e) {
        salesRepository.restore(salesSnapshot);
        reservationRepository.restore(resSnapshot);
        ledgerRepo.restore(ledgerSnapshot);
        throw e;
      }
    });
    txChain = run.then(() => undefined, () => undefined);
    return run as Promise<T>;
  };

  const txFactories = {
    createInventoryLedger: () => inventoryLedger,
    createReservationRepository: () => reservationRepository,
    createSalesRepository: () => salesRepository,
  };

  const service = new SalesSubmissionService({
    salesRepository, reservationRepository, inventoryLedger, audit, idempotency, documentSequence,
    transactionRunner, txFactories,
  });
  return { salesRepository, reservationRepository, ledgerRepo, audit, idempotency, documentSequence, inventoryLedger, service, transactionRunner };
}

function makeUser(userId: string, tenantId: string = TEST_TENANT_ID) {
  return { authenticated: true as const, userId, tenantId, email: "t@e.com", name: "T", authId: "t" };
}

async function seedStock(inventoryLedger: InventoryLedgerService, qty: string = "1000.000") {
  const ownerUser = makeUser(TEST_USERS.owner.userId);
  const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);
  return inventoryLedger.postRawReceipt(ownerUser as any, ownerEff, {
    itemId: TEST_ITEM_ID, toLocationId: TEST_LOC_A, quantityKg: qty,
    movementDate: "2026-07-06", sourceDocumentType: "test_seed", sourceDocumentId: "seed-001",
    idempotencyKey: "seed-key-001",
  });
}

async function createDraftSale(
  salesRepo: InMemorySalesRepository,
  qty: string = "300.000",
  itemId: string = TEST_ITEM_ID,
  locationId: string = TEST_LOC_A,
) {
  const sale = await salesRepo.insertSale({
    tenantId: TEST_TENANT_ID,
    docNo: `SO-TEST-${Date.now()}`,
    customerId: TEST_CUSTOMER_ID,
    saleDate: "2026-07-08",
  });
  await salesRepo.insertSaleLine({
    tenantId: TEST_TENANT_ID, salesOrderId: sale.id, lineNo: 1,
    itemId, locationId, quantityKg: qty, pricePerTon: "80.00",
  });
  return sale;
}

// ---------------------------------------------------------------------------
// 1. Draft does not reserve.
// ---------------------------------------------------------------------------

describe("WP-03-03 draft does not reserve", () => {
  it("creating a draft sale does NOT create any reservation or change reserved_qty", async () => {
    const { salesRepository, reservationRepository, ledgerRepo, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");
    await createDraftSale(salesRepository, "300.000");

    const reservationsForSale = await reservationRepository.listActiveReservationsForSale(TEST_TENANT_ID, "nonexistent");
    expect(reservationsForSale).toHaveLength(0);

    const balance = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    expect(balance!.reservedQtyKg).toBe("0");
    expect(balance!.onHandQtyKg).toBe("1000.000");
  });
});

// ---------------------------------------------------------------------------
// 2. Submit reserves exactly once.
// ---------------------------------------------------------------------------

describe("WP-03-03 submit reserves exactly once", () => {
  it("submitting a draft sale creates exactly one reservation per line and increases reserved_qty", async () => {
    const { service, salesRepository, reservationRepository, ledgerRepo, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");
    const sale = await createDraftSale(salesRepository, "300.000");

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    const result = await service.submitSale(ownerUser as any, ownerEff, {
      saleId: sale.id, idempotencyKey: "submit-1",
    });

    expect(result.action).toBe("submitted");
    expect(result.saleStatus).toBe("pending_approval");
    expect(result.reservations).toHaveLength(1);

    const reservations = await reservationRepository.listActiveReservationsForSale(TEST_TENANT_ID, sale.id);
    expect(reservations).toHaveLength(1);
    expect(reservations[0]!.quantityKg).toBe("300.000");
    expect(reservations[0]!.status).toBe("active");
    expect(reservations[0]!.salesOrderId).toBe(sale.id);

    const balance = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    expect(balance!.reservedQtyKg).toBe("300.000");
    expect(balance!.onHandQtyKg).toBe("1000.000");
  });
});

// ---------------------------------------------------------------------------
// 3. Idempotency replay does not double-reserve.
// ---------------------------------------------------------------------------

describe("WP-03-03 idempotency replay", () => {
  it("same idempotency key replays without creating duplicate reservations", async () => {
    const { service, salesRepository, reservationRepository, ledgerRepo, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");
    const sale = await createDraftSale(salesRepository, "300.000");

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    const first = await service.submitSale(ownerUser as any, ownerEff, {
      saleId: sale.id, idempotencyKey: "idem-1",
    });
    expect(first.action).toBe("submitted");

    const replay = await service.submitSale(ownerUser as any, ownerEff, {
      saleId: sale.id, idempotencyKey: "idem-1",
    });
    expect(replay.action).toBe("replayed");

    const reservations = await reservationRepository.listActiveReservationsForSale(TEST_TENANT_ID, sale.id);
    expect(reservations).toHaveLength(1);

    const balance = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    expect(balance!.reservedQtyKg).toBe("300.000");
  });

  it("different idempotency key on already-submitted sale rejects", async () => {
    const { service, salesRepository, reservationRepository, ledgerRepo, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");
    const sale = await createDraftSale(salesRepository, "300.000");

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    await service.submitSale(ownerUser as any, ownerEff, {
      saleId: sale.id, idempotencyKey: "idem-2a",
    });

    await expect(service.submitSale(ownerUser as any, ownerEff, {
      saleId: sale.id, idempotencyKey: "idem-2b",
    })).rejects.toThrow(SaleAlreadySubmittedError);

    const reservations = await reservationRepository.listActiveReservationsForSale(TEST_TENANT_ID, sale.id);
    expect(reservations).toHaveLength(1);
    const balance = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    expect(balance!.reservedQtyKg).toBe("300.000");
  });
});

// ---------------------------------------------------------------------------
// 4. Insufficient available stock rejects.
// ---------------------------------------------------------------------------

describe("WP-03-03 insufficient available stock", () => {
  it("submit rejects when available stock is insufficient", async () => {
    const { service, salesRepository, reservationRepository, ledgerRepo, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "100.000");
    const sale = await createDraftSale(salesRepository, "500.000");

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    await expect(service.submitSale(ownerUser as any, ownerEff, {
      saleId: sale.id, idempotencyKey: "insuff-1",
    })).rejects.toThrow(InsufficientAvailableStockError);

    const reservations = await reservationRepository.listActiveReservationsForSale(TEST_TENANT_ID, sale.id);
    expect(reservations).toHaveLength(0);

    const balance = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    expect(balance!.reservedQtyKg).toBe("0");

    const saleAfter = await salesRepository.findSaleById(TEST_TENANT_ID, sale.id);
    expect(saleAfter!.saleStatus).toBe("draft");
  });
});

// ---------------------------------------------------------------------------
// 5. Concurrent submissions cannot over-reserve.
// ---------------------------------------------------------------------------

describe("WP-03-03 concurrent submissions cannot over-reserve", () => {
  it("two concurrent submissions for different sales on the same item/location reserve exactly available qty", async () => {
    const { service, salesRepository, reservationRepository, ledgerRepo, inventoryLedger } = makeDepsWithTxRunner();
    await seedStock(inventoryLedger, "1000.000");

    const sale1 = await createDraftSale(salesRepository, "600.000");
    const sale2 = await createDraftSale(salesRepository, "600.000");

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    const results = await Promise.allSettled([
      service.submitSale(ownerUser as any, ownerEff, { saleId: sale1.id, idempotencyKey: "conc-A" }),
      service.submitSale(ownerUser as any, ownerEff, { saleId: sale2.id, idempotencyKey: "conc-B" }),
    ]);

    const fulfilled = results.filter(r => r.status === "fulfilled");
    const rejected = results.filter(r => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const loserError = (rejected[0] as PromiseRejectedResult).reason;
    expect(loserError).toBeInstanceOf(InsufficientAvailableStockError);

    const balance = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    expect(balance!.reservedQtyKg).toBe("600.000");
    expect(balance!.onHandQtyKg).toBe("1000.000");
  });
});

// ---------------------------------------------------------------------------
// 6. Reservation affects available stock but not on-hand.
// ---------------------------------------------------------------------------

describe("WP-03-03 reservation affects available but not on-hand", () => {
  it("submit increases reserved_qty and decreases available, but on_hand is unchanged", async () => {
    const { service, salesRepository, ledgerRepo, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");
    const sale = await createDraftSale(salesRepository, "300.000");

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    const balanceBefore = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    expect(balanceBefore!.onHandQtyKg).toBe("1000.000");
    expect(balanceBefore!.reservedQtyKg).toBe("0");

    await service.submitSale(ownerUser as any, ownerEff, {
      saleId: sale.id, idempotencyKey: "avail-1",
    });

    const balanceAfter = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    expect(balanceAfter!.onHandQtyKg).toBe("1000.000");
    expect(balanceAfter!.reservedQtyKg).toBe("300.000");
    const available = parseFloat(balanceAfter!.onHandQtyKg) - parseFloat(balanceAfter!.reservedQtyKg) - parseFloat(balanceAfter!.blockedQtyKg);
    expect(available.toFixed(3)).toBe("700.000");
  });
});

// ---------------------------------------------------------------------------
// 7. Tenant isolation.
// ---------------------------------------------------------------------------

describe("WP-03-03 tenant isolation", () => {
  it("cross-tenant sale submission is rejected", async () => {
    const { service, salesRepository, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");
    const sale = await createDraftSale(salesRepository, "300.000");

    const foreignUser = makeUser(TEST_USERS.owner.userId, "00000000-0000-0000-0000-ffffffffffff");
    const foreignEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    await expect(service.submitSale(foreignUser as any, foreignEff, {
      saleId: sale.id, idempotencyKey: "ti-1",
    })).rejects.toThrow(SaleNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// 8. Role/permission denial.
// ---------------------------------------------------------------------------

describe("WP-03-03 role/permission denial", () => {
  it("warehouse employee cannot submit sale (no sales.submit permission)", async () => {
    const { service, salesRepository, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");
    const sale = await createDraftSale(salesRepository, "300.000");

    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = getTestEffectivePermissions(TEST_USERS.warehouse.userId);

    await expect(service.submitSale(whUser as any, whEff, {
      saleId: sale.id, idempotencyKey: "perm-1",
    })).rejects.toThrow(PermissionDeniedError);
  });

  it("production employee cannot submit sale (no sales.submit permission)", async () => {
    const { service, salesRepository, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");
    const sale = await createDraftSale(salesRepository, "300.000");

    const prodUser = makeUser(TEST_USERS.production.userId);
    const prodEff = getTestEffectivePermissions(TEST_USERS.production.userId);

    await expect(service.submitSale(prodUser as any, prodEff, {
      saleId: sale.id, idempotencyKey: "perm-2",
    })).rejects.toThrow(PermissionDeniedError);
  });
});

// ---------------------------------------------------------------------------
// 9. No subledger/payment/account/customer balance side effects.
// ---------------------------------------------------------------------------

describe("WP-03-03 no financial side effects", () => {
  it("submit creates no account entries, payments, or customer balance changes", async () => {
    const { service, salesRepository, audit, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");
    const sale = await createDraftSale(salesRepository, "300.000");

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    await service.submitSale(ownerUser as any, ownerEff, {
      saleId: sale.id, idempotencyKey: "fin-1",
    });

    const auditRows = audit.getRows();
    for (const row of auditRows) {
      expect(row.actionType).not.toContain("payable");
      expect(row.actionType).not.toContain("payment");
      expect(row.actionType).not.toContain("account");
      expect(row.actionType).not.toContain("receivable");
      expect(row.actionType).not.toContain("customer_balance");
      expect(row.actionType).not.toContain("settlement");
    }

    const submitAudit = auditRows.find((r) => r.actionType === "sales_submission.submit");
    expect(submitAudit).toBeTruthy();
    expect(submitAudit!.entityType).toBe("sales_order");
  });
});

// ---------------------------------------------------------------------------
// 10. No stock movement issue/consumption on submit.
// ---------------------------------------------------------------------------

describe("WP-03-03 no stock movement on submit", () => {
  it("submit creates NO stock movements (reservation is not a movement)", async () => {
    const { service, salesRepository, ledgerRepo, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");
    const sale = await createDraftSale(salesRepository, "300.000");

    const movementsBefore = await ledgerRepo.listMovementsForBalance(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    const movementCountBefore = movementsBefore.length;

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    await service.submitSale(ownerUser as any, ownerEff, {
      saleId: sale.id, idempotencyKey: "nomove-1",
    });

    const movementsAfter = await ledgerRepo.listMovementsForBalance(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    expect(movementsAfter.length).toBe(movementCountBefore);

    const saleIssueMovements = movementsAfter.filter((m) => m.movementType === "sale_issue");
    expect(saleIssueMovements).toHaveLength(0);

    const balance = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    expect(balance!.onHandQtyKg).toBe("1000.000");
  });
});

// ---------------------------------------------------------------------------
// 11. Rollback on audit/posting failure.
// ---------------------------------------------------------------------------

describe("WP-03-03 rollback on failure", () => {
  it("insufficient stock rolls back: no reservation, no reserved_qty change, sale stays draft", async () => {
    const { service, salesRepository, reservationRepository, ledgerRepo, inventoryLedger } = makeDepsWithTxRunner();
    await seedStock(inventoryLedger, "100.000");
    const sale = await createDraftSale(salesRepository, "500.000");

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    await expect(service.submitSale(ownerUser as any, ownerEff, {
      saleId: sale.id, idempotencyKey: "rollback-1",
    })).rejects.toThrow(InsufficientAvailableStockError);

    const reservations = await reservationRepository.listActiveReservationsForSale(TEST_TENANT_ID, sale.id);
    expect(reservations).toHaveLength(0);

    const balance = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    expect(balance!.reservedQtyKg).toBe("0");
    expect(balance!.onHandQtyKg).toBe("100.000");

    const saleAfter = await salesRepository.findSaleById(TEST_TENANT_ID, sale.id);
    expect(saleAfter!.saleStatus).toBe("draft");
    expect(saleAfter!.reservationStatus).toBeNull();
  });

  it("sale with no lines rolls back: no reservation, sale stays draft", async () => {
    const { service, salesRepository, reservationRepository, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");

    const sale = await salesRepository.insertSale({
      tenantId: TEST_TENANT_ID,
      docNo: `SO-EMPTY-${Date.now()}`,
      customerId: TEST_CUSTOMER_ID,
      saleDate: "2026-07-08",
    });

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    await expect(service.submitSale(ownerUser as any, ownerEff, {
      saleId: sale.id, idempotencyKey: "rollback-2",
    })).rejects.toThrow(SaleHasNoLinesError);

    const reservations = await reservationRepository.listActiveReservationsForSale(TEST_TENANT_ID, sale.id);
    expect(reservations).toHaveLength(0);

    const saleAfter = await salesRepository.findSaleById(TEST_TENANT_ID, sale.id);
    expect(saleAfter!.saleStatus).toBe("draft");
  });
});

// ---------------------------------------------------------------------------
// 12. Multi-line sale: reservations per line.
// ---------------------------------------------------------------------------

describe("WP-03-03 multi-line sale", () => {
  it("submit creates one reservation per line and aggregates reserved_qty correctly", async () => {
    const { service, salesRepository, reservationRepository, ledgerRepo, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");

    const TEST_ITEM_2 = "aaa30300-0000-4000-8000-000000000002";

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);
    await inventoryLedger.postRawReceipt(ownerUser as any, ownerEff, {
      itemId: TEST_ITEM_2, toLocationId: TEST_LOC_A, quantityKg: "500.000",
      movementDate: "2026-07-06", sourceDocumentType: "test_seed", sourceDocumentId: "seed-002",
      idempotencyKey: "seed-key-002",
    });

    const sale = await salesRepository.insertSale({
      tenantId: TEST_TENANT_ID,
      docNo: `SO-MULTI-${Date.now()}`,
      customerId: TEST_CUSTOMER_ID,
      saleDate: "2026-07-08",
    });
    await salesRepository.insertSaleLine({
      tenantId: TEST_TENANT_ID, salesOrderId: sale.id, lineNo: 1,
      itemId: TEST_ITEM_ID, locationId: TEST_LOC_A, quantityKg: "300.000", pricePerTon: "80.00",
    });
    await salesRepository.insertSaleLine({
      tenantId: TEST_TENANT_ID, salesOrderId: sale.id, lineNo: 2,
      itemId: TEST_ITEM_2, locationId: TEST_LOC_A, quantityKg: "200.000", pricePerTon: "90.00",
    });

    const result = await service.submitSale(ownerUser as any, ownerEff, {
      saleId: sale.id, idempotencyKey: "multi-1",
    });

    expect(result.action).toBe("submitted");
    expect(result.reservations).toHaveLength(2);

    const reservations = await reservationRepository.listActiveReservationsForSale(TEST_TENANT_ID, sale.id);
    expect(reservations).toHaveLength(2);

    const bal1 = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    expect(bal1!.reservedQtyKg).toBe("300.000");
    expect(bal1!.onHandQtyKg).toBe("1000.000");

    const bal2 = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_2, TEST_LOC_A);
    expect(bal2!.reservedQtyKg).toBe("200.000");
    expect(bal2!.onHandQtyKg).toBe("500.000");
  });
});
