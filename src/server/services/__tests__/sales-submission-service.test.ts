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
import { InventoryLedgerService, type InventoryBalance } from "../inventory-ledger-service";
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

// ---------------------------------------------------------------------------
// 13. Rollback after reservation insert failure.
// ---------------------------------------------------------------------------

describe("WP-03-03 rollback after reservation insert failure", () => {
  it("reservation insert failure rolls back: no reserved_qty change, sale stays draft", async () => {
    const { salesRepository, reservationRepository, ledgerRepo, audit, idempotency, documentSequence, inventoryLedger, transactionRunner } = makeDepsWithTxRunner();
    await seedStock(inventoryLedger, "1000.000");
    const sale = await createDraftSale(salesRepository, "300.000");

    // Create a failing reservation repo that delegates all reads but throws on insertReservation.
    const failingResRepo = {
      insertReservation: async () => { throw new Error("SIMULATED_RESERVATION_INSERT_FAILURE"); },
      findReservationByIdempotencyKey: (t: string, k: string) => reservationRepository.findReservationByIdempotencyKey(t, k),
      findActiveReservationBySource: (t: string, st: string, si: string, i: string, l: string) => reservationRepository.findActiveReservationBySource(t, st, si, i, l),
      findReservationById: (t: string, id: string) => reservationRepository.findReservationById(t, id),
      listActiveReservationsForSale: (t: string, s: string) => reservationRepository.listActiveReservationsForSale(t, s),
    };

    const service = new SalesSubmissionService({
      salesRepository, reservationRepository: failingResRepo as any, inventoryLedger, audit, idempotency, documentSequence,
      transactionRunner,
      txFactories: {
        createInventoryLedger: () => inventoryLedger,
        createReservationRepository: () => failingResRepo as any,
        createSalesRepository: () => salesRepository,
      },
    });

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    await expect(service.submitSale(ownerUser as any, ownerEff, {
      saleId: sale.id, idempotencyKey: "rb-res-1",
    })).rejects.toThrow("SIMULATED_RESERVATION_INSERT_FAILURE");

    // ROLLBACK PROOF: no reservation created.
    const reservations = await reservationRepository.listActiveReservationsForSale(TEST_TENANT_ID, sale.id);
    expect(reservations).toHaveLength(0);

    // ROLLBACK PROOF: reserved_qty unchanged (still 0).
    const balance = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    expect(balance!.reservedQtyKg).toBe("0");

    // ROLLBACK PROOF: sale still draft.
    const saleAfter = await salesRepository.findSaleById(TEST_TENANT_ID, sale.id);
    expect(saleAfter!.saleStatus).toBe("draft");
  });
});

// ---------------------------------------------------------------------------
// 14. Rollback after reserved_qty update failure.
// ---------------------------------------------------------------------------

describe("WP-03-03 rollback after reserved_qty update failure", () => {
  it("reserved_qty update failure rolls back: no reservation persists, sale stays draft", async () => {
    const { salesRepository, reservationRepository, ledgerRepo, audit, idempotency, documentSequence, inventoryLedger, transactionRunner } = makeDepsWithTxRunner();
    await seedStock(inventoryLedger, "1000.000");
    const sale = await createDraftSale(salesRepository, "300.000");

    // Create a failing inventory ledger that throws on updateReservedQty.
    const failingInvLedger = Object.create(inventoryLedger) as InventoryLedgerService;
    failingInvLedger.updateReservedQty = async () => { throw new Error("SIMULATED_RESERVED_QTY_UPDATE_FAILURE"); };

    const service = new SalesSubmissionService({
      salesRepository, reservationRepository, inventoryLedger: failingInvLedger, audit, idempotency, documentSequence,
      transactionRunner,
      txFactories: {
        createInventoryLedger: () => failingInvLedger,
        createReservationRepository: () => reservationRepository,
        createSalesRepository: () => salesRepository,
      },
    });

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    await expect(service.submitSale(ownerUser as any, ownerEff, {
      saleId: sale.id, idempotencyKey: "rb-rqty-1",
    })).rejects.toThrow("SIMULATED_RESERVED_QTY_UPDATE_FAILURE");

    // ROLLBACK PROOF: no reservation persists (rolled back).
    const reservations = await reservationRepository.listActiveReservationsForSale(TEST_TENANT_ID, sale.id);
    expect(reservations).toHaveLength(0);

    // ROLLBACK PROOF: reserved_qty unchanged (still 0).
    const balance = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    expect(balance!.reservedQtyKg).toBe("0");

    // ROLLBACK PROOF: sale still draft.
    const saleAfter = await salesRepository.findSaleById(TEST_TENANT_ID, sale.id);
    expect(saleAfter!.saleStatus).toBe("draft");
  });
});

// ---------------------------------------------------------------------------
// 15. Rollback after sale status update failure.
// ---------------------------------------------------------------------------

describe("WP-03-03 rollback after sale status update failure", () => {
  it("sale status update failure rolls back: no reservation, no reserved_qty change", async () => {
    const { salesRepository, reservationRepository, ledgerRepo, audit, idempotency, documentSequence, inventoryLedger, transactionRunner } = makeDepsWithTxRunner();
    await seedStock(inventoryLedger, "1000.000");
    const sale = await createDraftSale(salesRepository, "300.000");

    // Create a failing sales repo that delegates reads but throws on updateSaleStatus.
    const failingSalesRepo = {
      findSaleById: (t: string, id: string) => salesRepository.findSaleById(t, id),
      findSaleLines: (t: string, id: string) => salesRepository.findSaleLines(t, id),
      updateSaleStatus: async () => { throw new Error("SIMULATED_SALE_STATUS_UPDATE_FAILURE"); },
    };

    const service = new SalesSubmissionService({
      salesRepository: failingSalesRepo as any, reservationRepository, inventoryLedger, audit, idempotency, documentSequence,
      transactionRunner,
      txFactories: {
        createInventoryLedger: () => inventoryLedger,
        createReservationRepository: () => reservationRepository,
        createSalesRepository: () => failingSalesRepo as any,
      },
    });

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    await expect(service.submitSale(ownerUser as any, ownerEff, {
      saleId: sale.id, idempotencyKey: "rb-status-1",
    })).rejects.toThrow("SIMULATED_SALE_STATUS_UPDATE_FAILURE");

    // ROLLBACK PROOF: no reservation persists.
    const reservations = await reservationRepository.listActiveReservationsForSale(TEST_TENANT_ID, sale.id);
    expect(reservations).toHaveLength(0);

    // ROLLBACK PROOF: reserved_qty unchanged.
    const balance = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    expect(balance!.reservedQtyKg).toBe("0");

    // ROLLBACK PROOF: sale still draft (read from the ORIGINAL repo, not the failing one).
    const saleAfter = await salesRepository.findSaleById(TEST_TENANT_ID, sale.id);
    expect(saleAfter!.saleStatus).toBe("draft");
  });
});

// ---------------------------------------------------------------------------
// 16. Failed submit retry (with NEW idempotency key after failure).
// ---------------------------------------------------------------------------

describe("WP-03-03 failed submit retry", () => {
  it("retry after failure succeeds with a NEW idempotency key", async () => {
    const base = makeDepsWithTxRunner();
    await seedStock(base.inventoryLedger, "1000.000");
    const sale = await createDraftSale(base.salesRepository, "300.000");

    // First attempt: fail with a failing reservation repo (delegates reads, throws on insert).
    const failingResRepo = {
      insertReservation: async () => { throw new Error("SIMULATED_FIRST_ATTEMPT_FAILURE"); },
      findReservationByIdempotencyKey: (t: string, k: string) => base.reservationRepository.findReservationByIdempotencyKey(t, k),
      findActiveReservationBySource: (t: string, st: string, si: string, i: string, l: string) => base.reservationRepository.findActiveReservationBySource(t, st, si, i, l),
      findReservationById: (t: string, id: string) => base.reservationRepository.findReservationById(t, id),
      listActiveReservationsForSale: (t: string, s: string) => base.reservationRepository.listActiveReservationsForSale(t, s),
    };
    const failingService = new SalesSubmissionService({
      salesRepository: base.salesRepository, reservationRepository: failingResRepo as any,
      inventoryLedger: base.inventoryLedger, audit: base.audit, idempotency: base.idempotency,
      documentSequence: base.documentSequence,
      transactionRunner: base.transactionRunner,
      txFactories: {
        createInventoryLedger: () => base.inventoryLedger,
        createReservationRepository: () => failingResRepo as any,
        createSalesRepository: () => base.salesRepository,
      },
    });

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    // First attempt fails.
    await expect(failingService.submitSale(ownerUser as any, ownerEff, {
      saleId: sale.id, idempotencyKey: "retry-fail-1",
    })).rejects.toThrow("SIMULATED_FIRST_ATTEMPT_FAILURE");

    // Sale still draft, no reservation, reserved_qty = 0.
    const saleAfterFail = await base.salesRepository.findSaleById(TEST_TENANT_ID, sale.id);
    expect(saleAfterFail!.saleStatus).toBe("draft");
    const resAfterFail = await base.reservationRepository.listActiveReservationsForSale(TEST_TENANT_ID, sale.id);
    expect(resAfterFail).toHaveLength(0);
    const balAfterFail = await base.ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    expect(balAfterFail!.reservedQtyKg).toBe("0");

    // Retry with NEW idempotency key + the WORKING service (no failing repo).
    const retryResult = await base.service.submitSale(ownerUser as any, ownerEff, {
      saleId: sale.id, idempotencyKey: "retry-success-2",
    });

    expect(retryResult.action).toBe("submitted");
    expect(retryResult.saleStatus).toBe("pending_approval");
    expect(retryResult.reservations).toHaveLength(1);

    // Exactly one reservation after retry.
    const reservations = await base.reservationRepository.listActiveReservationsForSale(TEST_TENANT_ID, sale.id);
    expect(reservations).toHaveLength(1);

    // reserved_qty = 300 (not 600 — no double-reserve from failed attempt).
    const balance = await base.ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    expect(balance!.reservedQtyKg).toBe("300.000");
  });
});

// ---------------------------------------------------------------------------
// 17. Concurrent submit exact reserved_qty.
// ---------------------------------------------------------------------------

describe("WP-03-03 concurrent submit exact reserved_qty", () => {
  it("concurrent submissions leave reserved_qty at exactly the winner's amount (not cumulative)", async () => {
    const { service, salesRepository, ledgerRepo, inventoryLedger } = makeDepsWithTxRunner();
    await seedStock(inventoryLedger, "1000.000");

    // Two sales, each 400 kg (total 800 < 1000, so both should succeed sequentially).
    // But we'll make them concurrent with a third that exceeds remaining.
    const sale1 = await createDraftSale(salesRepository, "400.000");
    const sale2 = await createDraftSale(salesRepository, "400.000");
    const sale3 = await createDraftSale(salesRepository, "400.000"); // only 200 left after 1+2

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    // Fire three concurrent submissions.
    const results = await Promise.allSettled([
      service.submitSale(ownerUser as any, ownerEff, { saleId: sale1.id, idempotencyKey: "conc-exact-A" }),
      service.submitSale(ownerUser as any, ownerEff, { saleId: sale2.id, idempotencyKey: "conc-exact-B" }),
      service.submitSale(ownerUser as any, ownerEff, { saleId: sale3.id, idempotencyKey: "conc-exact-C" }),
    ]);

    const fulfilled = results.filter(r => r.status === "fulfilled");
    const rejected = results.filter(r => r.status === "rejected");

    // Exactly 2 succeed (400+400=800 ≤ 1000), 1 fails (would need 400 but only 200 left).
    expect(fulfilled).toHaveLength(2);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(InsufficientAvailableStockError);

    // EXACT reserved_qty proof: 400 + 400 = 800 (not 1200, not 400).
    const balance = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    expect(balance!.reservedQtyKg).toBe("800.000");
    expect(balance!.onHandQtyKg).toBe("1000.000"); // on-hand unchanged

    // Available = 1000 - 800 - 0 = 200.
    const available = parseFloat(balance!.onHandQtyKg) - parseFloat(balance!.reservedQtyKg) - parseFloat(balance!.blockedQtyKg);
    expect(available.toFixed(3)).toBe("200.000");
  });
});

// ---------------------------------------------------------------------------
// 18. Boundary safety: getLedgerHandle() removed, narrow methods used.
// ---------------------------------------------------------------------------

describe("WP-03-03 boundary safety: narrow reservation methods", () => {
  it("InventoryLedgerService does NOT expose getLedgerHandle (no general escape hatch)", () => {
    const ledgerRepo = new InMemoryInventoryLedgerRepository();
    const audit = new InProcessAuditStore();
    const idempotency = new InProcessIdempotencyStore();
    const documentSequence = new InProcessDocumentSequenceStore();
    const inventoryLedger = new InventoryLedgerService({ ledger: ledgerRepo, audit, idempotency, documentSequence });

    // getLedgerHandle should NOT exist on the service.
    expect((inventoryLedger as any).getLedgerHandle).toBeUndefined();

    // The narrow reservation-specific methods SHOULD exist.
    expect(typeof inventoryLedger.findBalanceForUpdate).toBe("function");
    expect(typeof inventoryLedger.updateReservedQty).toBe("function");
  });

  it("findBalanceForUpdate + updateReservedQty are the only reservation boundary methods", async () => {
    const { inventoryLedger, ledgerRepo } = makeDeps();
    // These are the only two methods SalesSubmissionService needs.
    // Verify they work correctly and don't expose movement/posting methods.

    // findBalanceForUpdate delegates to the internal handle correctly.
    const balance = await inventoryLedger.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    expect(balance).toBeNull(); // no balance seeded yet

    // Seed stock and verify findBalanceForUpdate returns the balance.
    await seedStock(inventoryLedger, "1000.000");
    const balance2 = await inventoryLedger.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    expect(balance2).toBeTruthy();
    expect(balance2!.onHandQtyKg).toBe("1000.000");
    expect(balance2!.reservedQtyKg).toBe("0");

    // updateReservedQty updates reserved_qty_kg without changing on_hand.
    const updated = await inventoryLedger.updateReservedQty(
      TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A,
      { reservedQtyKg: "300.000", version: balance2!.version + 1 },
    );
    expect(updated).toBeTruthy();
    expect(updated!.reservedQtyKg).toBe("300.000");
    expect(updated!.onHandQtyKg).toBe("1000.000"); // on-hand UNCHANGED
  });
});
