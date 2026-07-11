/**
 * WP-03-04 Sales Failure Resolution Service tests.
 *
 * Contract: docs/contracts/13_work_packages.md WP-03-04
 *   Tests: Every reason mapping, duplicate resolution, human release,
 *   no sale posting.
 *   Acceptance: No general auto-release and all changes audited.
 *
 * Contract: docs/contracts/04_inventory_posting_contract.md §9.4
 *   "Approval-Failure Resolution"
 *
 * Contract: docs/contracts/06_approval_transaction_contract.md §7, §8
 */
import { describe, it, expect } from "vitest";
import {
  SalesFailureResolutionService,
  type SalesFailureResolutionTransactionRunner,
} from "../sales-failure-resolution-service";
import {
  SALE_FAILURE_REASONS,
  FAILURE_RESOLUTION_OUTCOMES,
  SaleNotFoundError,
  SaleAlreadyResolvedError,
  InvalidResolutionReasonError,
  SalesFailureResolutionError,
  type SaleFailureReason,
} from "../sales-failure-resolution-types";
import { InMemorySalesRepository } from "./in-memory-sales-repository";
import { InMemoryStockReservationRepository } from "./in-memory-stock-reservation-repository";
import { InMemoryOperationalAlertRepository } from "./in-memory-operational-alert-repository";
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
const TEST_ITEM_ID = "aaa30400-0000-4000-8000-000000000001";
const TEST_LOC_A = "bbb30400-0000-4000-8000-000000000001";
const TEST_CUSTOMER_ID = "ccc30400-0000-4000-8000-000000000001";

function makeDeps() {
  const salesRepository = new InMemorySalesRepository();
  const reservationRepository = new InMemoryStockReservationRepository();
  const alertRepository = new InMemoryOperationalAlertRepository();
  const ledgerRepo = new InMemoryInventoryLedgerRepository();
  const audit = new InProcessAuditStore();
  const idempotency = new InProcessIdempotencyStore();
  const documentSequence = new InProcessDocumentSequenceStore();
  const inventoryLedger = new InventoryLedgerService({ ledger: ledgerRepo, audit, idempotency, documentSequence });
  const service = new SalesFailureResolutionService({
    salesRepository, reservationRepository, alertRepository, inventoryLedger, audit, idempotency,
  });
  return { salesRepository, reservationRepository, alertRepository, ledgerRepo, audit, idempotency, documentSequence, inventoryLedger, service };
}

function makeDepsWithTxRunner() {
  const salesRepository = new InMemorySalesRepository();
  const reservationRepository = new InMemoryStockReservationRepository();
  const alertRepository = new InMemoryOperationalAlertRepository();
  const ledgerRepo = new InMemoryInventoryLedgerRepository();
  const audit = new InProcessAuditStore();
  const idempotency = new InProcessIdempotencyStore();
  const documentSequence = new InProcessDocumentSequenceStore();
  const inventoryLedger = new InventoryLedgerService({ ledger: ledgerRepo, audit, idempotency, documentSequence });

  let txChain: Promise<unknown> = Promise.resolve();
  const transactionRunner: SalesFailureResolutionTransactionRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
    const run = txChain.then(async () => {
      const salesSnapshot = salesRepository.snapshot();
      const resSnapshot = reservationRepository.snapshot();
      const alertSnapshot = alertRepository.snapshot();
      const ledgerSnapshot = ledgerRepo.snapshot();
      try {
        return await work({ /* mock tx */ });
      } catch (e) {
        salesRepository.restore(salesSnapshot);
        reservationRepository.restore(resSnapshot);
        alertRepository.restore(alertSnapshot);
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
    createAlertRepository: () => alertRepository,
  };

  const service = new SalesFailureResolutionService({
    salesRepository, reservationRepository, alertRepository, inventoryLedger, audit, idempotency,
    transactionRunner, txFactories,
  });
  return { salesRepository, reservationRepository, alertRepository, ledgerRepo, audit, idempotency, documentSequence, inventoryLedger, service, transactionRunner };
}

function makeUser(userId: string, tenantId: string = TEST_TENANT_ID) {
  return { authenticated: true as const, userId, tenantId, email: "t@e.com", name: "T", authId: "t" };
}

// Helper: seed stock at location A via raw receipt
async function seedStock(inventoryLedger: InventoryLedgerService, qty: string = "1000.000") {
  const ownerUser = makeUser(TEST_USERS.owner.userId);
  const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);
  return inventoryLedger.postRawReceipt(ownerUser as any, ownerEff as any, {
    itemId: TEST_ITEM_ID, toLocationId: TEST_LOC_A, quantityKg: qty,
    movementDate: "2026-07-06", sourceDocumentType: "test_seed", sourceDocumentId: "seed-001",
    idempotencyKey: "seed-key-001",
  });
}

// Helper: create a pending_approval sale with 1 line + 1 active reservation
async function createPendingSaleWithReservation(
  salesRepo: InMemorySalesRepository,
  resRepo: InMemoryStockReservationRepository,
  qty: string = "300.000",
) {
  const sale = await salesRepo.insertSale({
    tenantId: TEST_TENANT_ID,
    docNo: `SO-TEST-${Date.now()}`,
    customerId: TEST_CUSTOMER_ID,
    saleDate: "2026-07-08",
    saleStatus: "pending_approval",
    approvalStatus: "pending_approval",
  });
  const line = await salesRepo.insertSaleLine({
    tenantId: TEST_TENANT_ID, salesOrderId: sale.id, lineNo: 1,
    itemId: TEST_ITEM_ID, locationId: TEST_LOC_A, quantityKg: qty, pricePerTon: "80.00",
  });
  // Insert an active reservation for this line.
  const { randomUUID } = await import("node:crypto");
  const reservation = await resRepo.insertReservation({
    tenantId: TEST_TENANT_ID,
    reservationNo: "RES-TEST-001",
    itemId: TEST_ITEM_ID,
    locationId: TEST_LOC_A,
    quantityKg: qty,
    sourceType: "sales_order_line",
    sourceId: line.id,
    salesOrderId: sale.id,
    salesLineId: line.id,
    idempotencyKey: `res-${randomUUID()}`,
  });
  return { sale, line, reservation };
}

// ---------------------------------------------------------------------------
// 1. Failure reason taxonomy + outcome mapping.
// ---------------------------------------------------------------------------

describe("WP-03-04 failure reason taxonomy", () => {
  it("defines all 6 failure reasons", () => {
    expect(SALE_FAILURE_REASONS).toHaveLength(6);
    expect(SALE_FAILURE_REASONS).toContain("technical_system");
    expect(SALE_FAILURE_REASONS).toContain("missing_or_corrupted_reservation");
    expect(SALE_FAILURE_REASONS).toContain("stock_shortfall");
    expect(SALE_FAILURE_REASONS).toContain("quality_block");
    expect(SALE_FAILURE_REASONS).toContain("missing_commercial_data");
    expect(SALE_FAILURE_REASONS).toContain("human_rejection_cancellation");
  });

  it("technical_system: no business-state change", () => {
    const o = FAILURE_RESOLUTION_OUTCOMES.technical_system;
    expect(o.releaseReservation).toBe(false);
    expect(o.markReservationFailed).toBe(false);
    expect(o.createCriticalAlert).toBe(false);
    expect(o.saleStatus).toBe("pending_approval");
  });

  it("missing_or_corrupted_reservation: mark failed + critical alert + approval_failed", () => {
    const o = FAILURE_RESOLUTION_OUTCOMES.missing_or_corrupted_reservation;
    expect(o.releaseReservation).toBe(false);
    expect(o.markReservationFailed).toBe(true);
    expect(o.createCriticalAlert).toBe(true);
    expect(o.saleStatus).toBe("approval_failed");
  });

  it("stock_shortfall: retain reservation + needs_review", () => {
    const o = FAILURE_RESOLUTION_OUTCOMES.stock_shortfall;
    expect(o.releaseReservation).toBe(false);
    expect(o.markReservationFailed).toBe(false);
    expect(o.createCriticalAlert).toBe(false);
    expect(o.saleStatus).toBe("needs_review");
  });

  it("quality_block: retain reservation + needs_review", () => {
    const o = FAILURE_RESOLUTION_OUTCOMES.quality_block;
    expect(o.releaseReservation).toBe(false);
    expect(o.markReservationFailed).toBe(false);
    expect(o.createCriticalAlert).toBe(false);
    expect(o.saleStatus).toBe("needs_review");
  });

  it("missing_commercial_data: retain reservation + needs_review", () => {
    const o = FAILURE_RESOLUTION_OUTCOMES.missing_commercial_data;
    expect(o.releaseReservation).toBe(false);
    expect(o.markReservationFailed).toBe(false);
    expect(o.createCriticalAlert).toBe(false);
    expect(o.saleStatus).toBe("needs_review");
  });

  it("human_rejection_cancellation: release reservation + rejected", () => {
    const o = FAILURE_RESOLUTION_OUTCOMES.human_rejection_cancellation;
    expect(o.releaseReservation).toBe(true);
    expect(o.markReservationFailed).toBe(false);
    expect(o.createCriticalAlert).toBe(false);
    expect(o.saleStatus).toBe("rejected");
  });
});

// ---------------------------------------------------------------------------
// 2. Technical failure causes no business-state mutation.
// ---------------------------------------------------------------------------

describe("WP-03-04 technical_system failure", () => {
  it("technical failure changes no business state (sale stays pending, reservation stays active)", async () => {
    const { service, salesRepository, reservationRepository, ledgerRepo, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");

    // Manually set reserved_qty_kg to 300 (simulate a submitted sale).
    const balance = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    if (balance) {
      await ledgerRepo.updateReservedQty(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A, {
        reservedQtyKg: "300.000", version: balance.version + 1,
      });
    }

    const { sale } = await createPendingSaleWithReservation(salesRepository, reservationRepository, "300.000");

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    const result = await service.resolveSaleFailure(ownerUser as any, ownerEff as any, {
      saleId: sale.id,
      reason: "technical_system",
      resolutionReason: "Database timeout during approval",
      idempotencyKey: "tech-1",
    });

    expect(result.action).toBe("resolved");
    expect(result.saleStatus).toBe("pending_approval"); // unchanged
    expect(result.reservationReleased).toBe(false);
    expect(result.reservationMarkedFailed).toBe(false);
    expect(result.criticalAlertIds).toHaveLength(0);

    // Sale stays pending_approval.
    const saleAfter = await salesRepository.findSaleById(TEST_TENANT_ID, sale.id);
    expect(saleAfter!.saleStatus).toBe("pending_approval");

    // Reservation stays active.
    const reservations = await reservationRepository.listActiveReservationsForSale(TEST_TENANT_ID, sale.id);
    expect(reservations).toHaveLength(1);
    expect(reservations[0]!.status).toBe("active");

    // reserved_qty_kg unchanged (still 300).
    const balanceAfter = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    expect(balanceAfter!.reservedQtyKg).toBe("300.000");
  });
});

// ---------------------------------------------------------------------------
// 3. Corruption creates critical alert and does not auto-release.
// ---------------------------------------------------------------------------

describe("WP-03-04 missing_or_corrupted_reservation failure", () => {
  it("corruption marks reservation failed, reconciles reserved_qty, creates critical alert, sets approval_failed", async () => {
    const { service, salesRepository, reservationRepository, alertRepository, ledgerRepo, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");

    // Set reserved_qty_kg to 300.
    const balance = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    if (balance) {
      await ledgerRepo.updateReservedQty(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A, {
        reservedQtyKg: "300.000", version: balance.version + 1,
      });
    }

    const { sale, reservation } = await createPendingSaleWithReservation(salesRepository, reservationRepository, "300.000");

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    const result = await service.resolveSaleFailure(ownerUser as any, ownerEff as any, {
      saleId: sale.id,
      reason: "missing_or_corrupted_reservation",
      resolutionReason: "Reservation quantity mismatch detected",
      idempotencyKey: "corrupt-1",
    });

    expect(result.action).toBe("resolved");
    expect(result.saleStatus).toBe("approval_failed");
    expect(result.reservationReleased).toBe(false);
    expect(result.reservationMarkedFailed).toBe(true);
    expect(result.criticalAlertIds).toHaveLength(1);

    // Sale is now approval_failed.
    const saleAfter = await salesRepository.findSaleById(TEST_TENANT_ID, sale.id);
    expect(saleAfter!.saleStatus).toBe("approval_failed");

    // Reservation is now failed (not released, not active).
    const reservationAfter = await reservationRepository.findReservationById(TEST_TENANT_ID, reservation.id);
    expect(reservationAfter!.status).toBe("failed");
    expect(reservationAfter!.failureResolutionReason).toBe("Reservation quantity mismatch detected");

    // reserved_qty_kg reconciled (decreased to 0).
    const balanceAfter = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    expect(balanceAfter!.reservedQtyKg).toBe("0.000");

    // Critical alert created.
    const alerts = await alertRepository.findAlertsForSource(TEST_TENANT_ID, "sales_order", sale.id);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.severity).toBe("critical");
    expect(alerts[0]!.alertType).toBe("reservation_corruption");
    expect(alerts[0]!.state).toBe("open");
  });

  it("corruption does not auto-release (reservation marked failed, not released)", async () => {
    const { service, salesRepository, reservationRepository, ledgerRepo, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");

    const balance = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    if (balance) {
      await ledgerRepo.updateReservedQty(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A, {
        reservedQtyKg: "300.000", version: balance.version + 1,
      });
    }

    const { sale, reservation } = await createPendingSaleWithReservation(salesRepository, reservationRepository, "300.000");

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    await service.resolveSaleFailure(ownerUser as any, ownerEff as any, {
      saleId: sale.id,
      reason: "missing_or_corrupted_reservation",
      resolutionReason: "Corruption detected",
      idempotencyKey: "corrupt-norelease-1",
    });

    // Reservation is failed, NOT released.
    const reservationAfter = await reservationRepository.findReservationById(TEST_TENANT_ID, reservation.id);
    expect(reservationAfter!.status).toBe("failed");
    expect(reservationAfter!.status).not.toBe("released");
  });
});

// ---------------------------------------------------------------------------
// 4. Stock/quality/commercial failure retains reservation.
// ---------------------------------------------------------------------------

describe("WP-03-04 stock/quality/commercial failure retains reservation", () => {
  it("stock_shortfall retains reservation and sets needs_review", async () => {
    const { service, salesRepository, reservationRepository, ledgerRepo, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");

    const balance = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    if (balance) {
      await ledgerRepo.updateReservedQty(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A, {
        reservedQtyKg: "300.000", version: balance.version + 1,
      });
    }

    const { sale, reservation } = await createPendingSaleWithReservation(salesRepository, reservationRepository, "300.000");

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    const result = await service.resolveSaleFailure(ownerUser as any, ownerEff as any, {
      saleId: sale.id,
      reason: "stock_shortfall",
      resolutionReason: "Insufficient on-hand stock",
      idempotencyKey: "shortfall-1",
    });

    expect(result.saleStatus).toBe("needs_review");
    expect(result.reservationReleased).toBe(false);
    expect(result.reservationMarkedFailed).toBe(false);

    // Reservation stays active (retained for review).
    const reservationAfter = await reservationRepository.findReservationById(TEST_TENANT_ID, reservation.id);
    expect(reservationAfter!.status).toBe("active");

    // reserved_qty_kg unchanged (still 300).
    const balanceAfter = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    expect(balanceAfter!.reservedQtyKg).toBe("300.000");
  });

  it("quality_block retains reservation and sets needs_review", async () => {
    const { service, salesRepository, reservationRepository, ledgerRepo, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");

    const balance = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    if (balance) {
      await ledgerRepo.updateReservedQty(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A, {
        reservedQtyKg: "300.000", version: balance.version + 1,
      });
    }

    const { sale, reservation } = await createPendingSaleWithReservation(salesRepository, reservationRepository, "300.000");

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    const result = await service.resolveSaleFailure(ownerUser as any, ownerEff as any, {
      saleId: sale.id,
      reason: "quality_block",
      resolutionReason: "Item blocked due to quality issue",
      idempotencyKey: "quality-1",
    });

    expect(result.saleStatus).toBe("needs_review");
    expect(result.reservationReleased).toBe(false);

    const reservationAfter = await reservationRepository.findReservationById(TEST_TENANT_ID, reservation.id);
    expect(reservationAfter!.status).toBe("active");

    const balanceAfter = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    expect(balanceAfter!.reservedQtyKg).toBe("300.000");
  });

  it("missing_commercial_data retains reservation and sets needs_review", async () => {
    const { service, salesRepository, reservationRepository, ledgerRepo, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");

    const balance = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    if (balance) {
      await ledgerRepo.updateReservedQty(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A, {
        reservedQtyKg: "300.000", version: balance.version + 1,
      });
    }

    const { sale, reservation } = await createPendingSaleWithReservation(salesRepository, reservationRepository, "300.000");

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    const result = await service.resolveSaleFailure(ownerUser as any, ownerEff as any, {
      saleId: sale.id,
      reason: "missing_commercial_data",
      resolutionReason: "Price missing for line item",
      idempotencyKey: "commercial-1",
    });

    expect(result.saleStatus).toBe("needs_review");
    expect(result.reservationReleased).toBe(false);

    const reservationAfter = await reservationRepository.findReservationById(TEST_TENANT_ID, reservation.id);
    expect(reservationAfter!.status).toBe("active");

    const balanceAfter = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    expect(balanceAfter!.reservedQtyKg).toBe("300.000");
  });
});

// ---------------------------------------------------------------------------
// 5. Explicit human release decreases reserved_qty only when allowed.
// ---------------------------------------------------------------------------

describe("WP-03-04 human rejection/cancellation release", () => {
  it("human rejection releases reservation and decreases reserved_qty", async () => {
    const { service, salesRepository, reservationRepository, ledgerRepo, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");

    const balance = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    if (balance) {
      await ledgerRepo.updateReservedQty(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A, {
        reservedQtyKg: "300.000", version: balance.version + 1,
      });
    }

    const { sale, reservation } = await createPendingSaleWithReservation(salesRepository, reservationRepository, "300.000");

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    const result = await service.resolveSaleFailure(ownerUser as any, ownerEff as any, {
      saleId: sale.id,
      reason: "human_rejection_cancellation",
      humanResolutionType: "rejected",
      resolutionReason: "Customer cancelled the order",
      idempotencyKey: "reject-1",
    });

    expect(result.saleStatus).toBe("rejected");
    expect(result.reservationReleased).toBe(true);

    // Reservation is released.
    const reservationAfter = await reservationRepository.findReservationById(TEST_TENANT_ID, reservation.id);
    expect(reservationAfter!.status).toBe("released");

    // reserved_qty_kg decreased to 0.
    const balanceAfter = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    expect(balanceAfter!.reservedQtyKg).toBe("0.000");
  });

  it("human cancellation (vs rejection) sets sale to cancelled", async () => {
    const { service, salesRepository, reservationRepository, ledgerRepo, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");

    const balance = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    if (balance) {
      await ledgerRepo.updateReservedQty(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A, {
        reservedQtyKg: "300.000", version: balance.version + 1,
      });
    }

    const { sale } = await createPendingSaleWithReservation(salesRepository, reservationRepository, "300.000");

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    const result = await service.resolveSaleFailure(ownerUser as any, ownerEff as any, {
      saleId: sale.id,
      reason: "human_rejection_cancellation",
      humanResolutionType: "cancelled",
      resolutionReason: "Internal cancellation",
      idempotencyKey: "cancel-1",
    });

    expect(result.saleStatus).toBe("cancelled");
    expect(result.reservationReleased).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Release is audited.
// ---------------------------------------------------------------------------

describe("WP-03-04 release is audited", () => {
  it("human release writes an audit log entry", async () => {
    const { service, salesRepository, reservationRepository, audit, ledgerRepo, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");

    const balance = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    if (balance) {
      await ledgerRepo.updateReservedQty(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A, {
        reservedQtyKg: "300.000", version: balance.version + 1,
      });
    }

    const { sale } = await createPendingSaleWithReservation(salesRepository, reservationRepository, "300.000");

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    await service.resolveSaleFailure(ownerUser as any, ownerEff as any, {
      saleId: sale.id,
      reason: "human_rejection_cancellation",
      resolutionReason: "Customer cancelled",
      idempotencyKey: "audit-1",
    });

    const auditRows = audit.getRows();
    const resolutionAudit = auditRows.find((r) => r.actionType === "sales_failure_resolution.resolve");
    expect(resolutionAudit).toBeTruthy();
    expect(resolutionAudit!.entityType).toBe("sales_order");
    expect(resolutionAudit!.entityId).toBe(sale.id);
  });
});

// ---------------------------------------------------------------------------
// 7. Duplicate resolution does not double-release.
// ---------------------------------------------------------------------------

describe("WP-03-04 duplicate resolution rejected", () => {
  it("different idempotency key on already-resolved sale rejects", async () => {
    const { service, salesRepository, reservationRepository, ledgerRepo, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");

    const balance = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    if (balance) {
      await ledgerRepo.updateReservedQty(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A, {
        reservedQtyKg: "300.000", version: balance.version + 1,
      });
    }

    const { sale, reservation } = await createPendingSaleWithReservation(salesRepository, reservationRepository, "300.000");

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    // First resolution succeeds (human rejection → released).
    await service.resolveSaleFailure(ownerUser as any, ownerEff as any, {
      saleId: sale.id,
      reason: "human_rejection_cancellation",
      resolutionReason: "Cancelled",
      idempotencyKey: "dup-1",
    });

    // Second resolution with DIFFERENT key on already-rejected sale rejects.
    await expect(service.resolveSaleFailure(ownerUser as any, ownerEff as any, {
      saleId: sale.id,
      reason: "human_rejection_cancellation",
      resolutionReason: "Cancelled again",
      idempotencyKey: "dup-2",
    })).rejects.toThrow(SaleAlreadyResolvedError);

    // Reservation still released (not double-released).
    const reservationAfter = await reservationRepository.findReservationById(TEST_TENANT_ID, reservation.id);
    expect(reservationAfter!.status).toBe("released");

    // reserved_qty_kg still 0 (not double-decreased).
    const balanceAfter = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    expect(balanceAfter!.reservedQtyKg).toBe("0.000");
  });
});

// ---------------------------------------------------------------------------
// 8. Idempotency replay does not double-release.
// ---------------------------------------------------------------------------

describe("WP-03-04 idempotency replay", () => {
  it("same idempotency key replays without double-release", async () => {
    const { service, salesRepository, reservationRepository, ledgerRepo, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");

    const balance = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    if (balance) {
      await ledgerRepo.updateReservedQty(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A, {
        reservedQtyKg: "300.000", version: balance.version + 1,
      });
    }

    const { sale, reservation } = await createPendingSaleWithReservation(salesRepository, reservationRepository, "300.000");

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    // First resolution.
    const first = await service.resolveSaleFailure(ownerUser as any, ownerEff as any, {
      saleId: sale.id,
      reason: "human_rejection_cancellation",
      resolutionReason: "Cancelled",
      idempotencyKey: "idem-replay-1",
    });
    expect(first.action).toBe("resolved");

    // Replay with same key.
    const replay = await service.resolveSaleFailure(ownerUser as any, ownerEff as any, {
      saleId: sale.id,
      reason: "human_rejection_cancellation",
      resolutionReason: "Cancelled",
      idempotencyKey: "idem-replay-1",
    });
    expect(replay.action).toBe("replayed");

    // Reservation still released (not double-released).
    const reservationAfter = await reservationRepository.findReservationById(TEST_TENANT_ID, reservation.id);
    expect(reservationAfter!.status).toBe("released");

    // reserved_qty_kg still 0.
    const balanceAfter = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    expect(balanceAfter!.reservedQtyKg).toBe("0.000");
  });
});

// ---------------------------------------------------------------------------
// 9. Concurrent resolution cannot double-release.
// ---------------------------------------------------------------------------

describe("WP-03-04 concurrent resolution cannot double-release", () => {
  it("two concurrent resolutions for the same sale: exactly 1 succeeds, 1 rejects", async () => {
    const { service, salesRepository, reservationRepository, ledgerRepo, inventoryLedger } = makeDepsWithTxRunner();
    await seedStock(inventoryLedger, "1000.000");

    const balance = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    if (balance) {
      await ledgerRepo.updateReservedQty(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A, {
        reservedQtyKg: "300.000", version: balance.version + 1,
      });
    }

    const { sale, reservation } = await createPendingSaleWithReservation(salesRepository, reservationRepository, "300.000");

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    // Fire two concurrent resolutions with DIFFERENT idempotency keys.
    const results = await Promise.allSettled([
      service.resolveSaleFailure(ownerUser as any, ownerEff as any, {
        saleId: sale.id,
        reason: "human_rejection_cancellation",
        resolutionReason: "Cancel A",
        idempotencyKey: "conc-A",
      }),
      service.resolveSaleFailure(ownerUser as any, ownerEff as any, {
        saleId: sale.id,
        reason: "human_rejection_cancellation",
        resolutionReason: "Cancel B",
        idempotencyKey: "conc-B",
      }),
    ]);

    const fulfilled = results.filter(r => r.status === "fulfilled");
    const rejected = results.filter(r => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // Reservation is released (not double-released).
    const reservationAfter = await reservationRepository.findReservationById(TEST_TENANT_ID, reservation.id);
    expect(reservationAfter!.status).toBe("released");

    // reserved_qty_kg = 0 (decreased exactly once, not twice).
    const balanceAfter = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    expect(balanceAfter!.reservedQtyKg).toBe("0.000");
    expect(balanceAfter!.reservedQtyKg).not.toBe("-300.000");
  });
});

// ---------------------------------------------------------------------------
// 10. No sale posting / no stock issue movement.
// ---------------------------------------------------------------------------

describe("WP-03-04 no sale posting or stock movement", () => {
  it("resolution creates no stock movements (no sale_issue)", async () => {
    const { service, salesRepository, reservationRepository, ledgerRepo, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");

    const balance = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    if (balance) {
      await ledgerRepo.updateReservedQty(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A, {
        reservedQtyKg: "300.000", version: balance.version + 1,
      });
    }

    const { sale } = await createPendingSaleWithReservation(salesRepository, reservationRepository, "300.000");

    const movementsBefore = await ledgerRepo.listMovementsForBalance(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    const movementCountBefore = movementsBefore.length;

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    await service.resolveSaleFailure(ownerUser as any, ownerEff as any, {
      saleId: sale.id,
      reason: "human_rejection_cancellation",
      resolutionReason: "Cancelled",
      idempotencyKey: "nomove-1",
    });

    // No new stock movements created.
    const movementsAfter = await ledgerRepo.listMovementsForBalance(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    expect(movementsAfter.length).toBe(movementCountBefore);

    // Specifically no sale_issue movement.
    const saleIssueMovements = movementsAfter.filter((m) => m.movementType === "sale_issue");
    expect(saleIssueMovements).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 11. No financial side effects.
// ---------------------------------------------------------------------------

describe("WP-03-04 no financial side effects", () => {
  it("resolution creates no account entries, payments, or profitability snapshots", async () => {
    const { service, salesRepository, reservationRepository, audit, ledgerRepo, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");

    const balance = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    if (balance) {
      await ledgerRepo.updateReservedQty(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A, {
        reservedQtyKg: "300.000", version: balance.version + 1,
      });
    }

    const { sale } = await createPendingSaleWithReservation(salesRepository, reservationRepository, "300.000");

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    await service.resolveSaleFailure(ownerUser as any, ownerEff as any, {
      saleId: sale.id,
      reason: "human_rejection_cancellation",
      resolutionReason: "Cancelled",
      idempotencyKey: "nofin-1",
    });

    // Audit log should only contain sales_failure_resolution action.
    const auditRows = audit.getRows();
    for (const row of auditRows) {
      expect(row.actionType).not.toContain("payable");
      expect(row.actionType).not.toContain("payment");
      expect(row.actionType).not.toContain("account");
      expect(row.actionType).not.toContain("receivable");
      expect(row.actionType).not.toContain("customer_balance");
      expect(row.actionType).not.toContain("settlement");
      expect(row.actionType).not.toContain("profitability");
    }

    // The resolution audit row should exist.
    const resolutionAudit = auditRows.find((r) => r.actionType === "sales_failure_resolution.resolve");
    expect(resolutionAudit).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 12. Tenant isolation.
// ---------------------------------------------------------------------------

describe("WP-03-04 tenant isolation", () => {
  it("cross-tenant sale resolution is rejected", async () => {
    const { service, salesRepository, reservationRepository, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");

    const { sale } = await createPendingSaleWithReservation(salesRepository, reservationRepository, "300.000");

    // Try to resolve from a different tenant.
    const foreignUser = makeUser(TEST_USERS.owner.userId, "00000000-0000-0000-0000-ffffffffffff");
    const foreignEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    await expect(service.resolveSaleFailure(foreignUser as any, foreignEff as any, {
      saleId: sale.id,
      reason: "human_rejection_cancellation",
      resolutionReason: "Cross-tenant attempt",
      idempotencyKey: "ti-1",
    })).rejects.toThrow(SaleNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// 13. Permission denial.
// ---------------------------------------------------------------------------

describe("WP-03-04 permission denial", () => {
  it("warehouse employee cannot resolve sale failure (no sales.approve permission)", async () => {
    const { service, salesRepository, reservationRepository, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");

    const { sale } = await createPendingSaleWithReservation(salesRepository, reservationRepository, "300.000");

    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = getTestEffectivePermissions(TEST_USERS.warehouse.userId);

    // Warehouse has sales.create but NOT sales.approve.
    await expect(service.resolveSaleFailure(whUser as any, whEff as any, {
      saleId: sale.id,
      reason: "human_rejection_cancellation",
      resolutionReason: "Warehouse attempt",
      idempotencyKey: "perm-1",
    })).rejects.toThrow(PermissionDeniedError);
  });

  it("production employee cannot resolve sale failure", async () => {
    const { service, salesRepository, reservationRepository, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");

    const { sale } = await createPendingSaleWithReservation(salesRepository, reservationRepository, "300.000");

    const prodUser = makeUser(TEST_USERS.production.userId);
    const prodEff = getTestEffectivePermissions(TEST_USERS.production.userId);

    await expect(service.resolveSaleFailure(prodUser as any, prodEff as any, {
      saleId: sale.id,
      reason: "human_rejection_cancellation",
      resolutionReason: "Production attempt",
      idempotencyKey: "perm-2",
    })).rejects.toThrow(PermissionDeniedError);
  });
});

// ---------------------------------------------------------------------------
// 14. Invalid reason rejected.
// ---------------------------------------------------------------------------

describe("WP-03-04 invalid reason rejected", () => {
  it("invalid failure reason throws InvalidResolutionReasonError", async () => {
    const { service, salesRepository, reservationRepository, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");

    const { sale } = await createPendingSaleWithReservation(salesRepository, reservationRepository, "300.000");

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    await expect(service.resolveSaleFailure(ownerUser as any, ownerEff as any, {
      saleId: sale.id,
      reason: "invalid_reason" as any,
      resolutionReason: "Invalid",
      idempotencyKey: "invalid-1",
    })).rejects.toThrow(InvalidResolutionReasonError);
  });
});

// ---------------------------------------------------------------------------
// 15. Duplicate critical alert prevention.
// ---------------------------------------------------------------------------

describe("WP-03-04 duplicate critical alert prevention", () => {
  it("re-resolution of corruption does not create duplicate critical alert", async () => {
    const { service, salesRepository, reservationRepository, alertRepository, ledgerRepo, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");

    const balance = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    if (balance) {
      await ledgerRepo.updateReservedQty(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A, {
        reservedQtyKg: "300.000", version: balance.version + 1,
      });
    }

    const { sale } = await createPendingSaleWithReservation(salesRepository, reservationRepository, "300.000");

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    // First resolution creates a critical alert.
    await service.resolveSaleFailure(ownerUser as any, ownerEff as any, {
      saleId: sale.id,
      reason: "missing_or_corrupted_reservation",
      resolutionReason: "Corruption detected",
      idempotencyKey: "dup-alert-1",
    });

    // Re-resolve with same key (replay) — should not create duplicate alert.
    await service.resolveSaleFailure(ownerUser as any, ownerEff as any, {
      saleId: sale.id,
      reason: "missing_or_corrupted_reservation",
      resolutionReason: "Corruption detected",
      idempotencyKey: "dup-alert-1",
    });

    // Still exactly 1 critical alert.
    const alerts = await alertRepository.findAlertsForSource(TEST_TENANT_ID, "sales_order", sale.id);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.severity).toBe("critical");
  });
});

// ---------------------------------------------------------------------------
// 16. technical_system does not write business-visible audit.
// ---------------------------------------------------------------------------

describe("WP-03-04 technical_system no business audit", () => {
  it("technical_system failure does NOT write a business audit log entry", async () => {
    const { service, salesRepository, reservationRepository, audit, ledgerRepo, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");

    const balance = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    if (balance) {
      await ledgerRepo.updateReservedQty(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A, {
        reservedQtyKg: "300.000", version: balance.version + 1,
      });
    }

    const { sale } = await createPendingSaleWithReservation(salesRepository, reservationRepository, "300.000");

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    await service.resolveSaleFailure(ownerUser as any, ownerEff as any, {
      saleId: sale.id,
      reason: "technical_system",
      resolutionReason: "Database timeout",
      idempotencyKey: "tech-noaudit-1",
    });

    // NO business audit entry should exist for technical_system.
    const auditRows = audit.getRows();
    const resolutionAudit = auditRows.find((r) => r.actionType === "sales_failure_resolution.resolve");
    expect(resolutionAudit).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 17. Audit is inside transaction (audit failure rolls back).
// ---------------------------------------------------------------------------

describe("WP-03-04 audit inside transaction", () => {
  it("audit failure rolls back the entire transaction (sale stays pending, reservation stays active)", async () => {
    const { salesRepository, reservationRepository, alertRepository, ledgerRepo, idempotency, documentSequence, inventoryLedger, transactionRunner } = makeDepsWithTxRunner();
    await seedStock(inventoryLedger, "1000.000");

    const balance = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    if (balance) {
      await ledgerRepo.updateReservedQty(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A, {
        reservedQtyKg: "300.000", version: balance.version + 1,
      });
    }

    const { sale, reservation } = await createPendingSaleWithReservation(salesRepository, reservationRepository, "300.000");

    const failingAudit = new InProcessAuditStore();
    failingAudit.setShouldFail(true);

    const service = new SalesFailureResolutionService({
      salesRepository, reservationRepository, alertRepository, inventoryLedger,
      audit: failingAudit, idempotency,
      transactionRunner, txFactories: {
        createInventoryLedger: () => inventoryLedger,
        createReservationRepository: () => reservationRepository,
        createSalesRepository: () => salesRepository,
        createAlertRepository: () => alertRepository,
      },
    });

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    await expect(service.resolveSaleFailure(ownerUser as any, ownerEff as any, {
      saleId: sale.id,
      reason: "human_rejection_cancellation",
      resolutionReason: "Cancelled",
      idempotencyKey: "audit-rb-1",
    })).rejects.toThrow();

    const saleAfter = await salesRepository.findSaleById(TEST_TENANT_ID, sale.id);
    expect(saleAfter!.saleStatus).toBe("pending_approval");

    const reservationAfter = await reservationRepository.findReservationById(TEST_TENANT_ID, reservation.id);
    expect(reservationAfter!.status).toBe("active");

    const balanceAfter = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    expect(balanceAfter!.reservedQtyKg).toBe("300.000");
  });
});

// ---------------------------------------------------------------------------
// 18. Rollback after alert creation failure.
// ---------------------------------------------------------------------------

describe("WP-03-04 rollback after alert creation failure", () => {
  it("alert creation failure rolls back: sale stays pending, reservation stays active", async () => {
    const { salesRepository, reservationRepository, ledgerRepo, audit, idempotency, documentSequence, inventoryLedger, transactionRunner } = makeDepsWithTxRunner();
    await seedStock(inventoryLedger, "1000.000");

    const balance = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    if (balance) {
      await ledgerRepo.updateReservedQty(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A, {
        reservedQtyKg: "300.000", version: balance.version + 1,
      });
    }

    const { sale, reservation } = await createPendingSaleWithReservation(salesRepository, reservationRepository, "300.000");

    const realAlertRepo = new InMemoryOperationalAlertRepository();
    const failingAlertRepo = {
      insertAlert: async () => { throw new Error("SIMULATED_ALERT_INSERT_FAILURE"); },
      findAlertsForSource: (t: string, et: string, eid: string) => realAlertRepo.findAlertsForSource(t, et, eid),
      findAlertById: (t: string, id: string) => realAlertRepo.findAlertById(t, id),
      findCriticalAlertForSource: (t: string, et: string, eid: string, at: string) => realAlertRepo.findCriticalAlertForSource(t, et, eid, at),
    };

    const service = new SalesFailureResolutionService({
      salesRepository, reservationRepository, alertRepository: failingAlertRepo as any,
      inventoryLedger, audit, idempotency,
      transactionRunner, txFactories: {
        createInventoryLedger: () => inventoryLedger,
        createReservationRepository: () => reservationRepository,
        createSalesRepository: () => salesRepository,
        createAlertRepository: () => failingAlertRepo as any,
      },
    });

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    await expect(service.resolveSaleFailure(ownerUser as any, ownerEff as any, {
      saleId: sale.id,
      reason: "missing_or_corrupted_reservation",
      resolutionReason: "Corruption detected",
      idempotencyKey: "rb-alert-1",
    })).rejects.toThrow("SIMULATED_ALERT_INSERT_FAILURE");

    const saleAfter = await salesRepository.findSaleById(TEST_TENANT_ID, sale.id);
    expect(saleAfter!.saleStatus).toBe("pending_approval");

    const reservationAfter = await reservationRepository.findReservationById(TEST_TENANT_ID, reservation.id);
    expect(reservationAfter!.status).toBe("active");

    const balanceAfter = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    expect(balanceAfter!.reservedQtyKg).toBe("300.000");
  });
});

// ---------------------------------------------------------------------------
// 19. Rollback after reservation release failure.
// ---------------------------------------------------------------------------

describe("WP-03-04 rollback after reservation release failure", () => {
  it("reservation release failure rolls back: sale stays pending, reserved_qty unchanged", async () => {
    const { salesRepository, reservationRepository, ledgerRepo, audit, idempotency, documentSequence, inventoryLedger, transactionRunner } = makeDepsWithTxRunner();
    await seedStock(inventoryLedger, "1000.000");

    const balance = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    if (balance) {
      await ledgerRepo.updateReservedQty(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A, {
        reservedQtyKg: "300.000", version: balance.version + 1,
      });
    }

    const { sale } = await createPendingSaleWithReservation(salesRepository, reservationRepository, "300.000");

    const failingResRepo = {
      insertReservation: (row: any) => reservationRepository.insertReservation(row),
      findReservationByIdempotencyKey: (t: string, k: string) => reservationRepository.findReservationByIdempotencyKey(t, k),
      findActiveReservationBySource: (t: string, st: string, si: string, i: string, l: string) => reservationRepository.findActiveReservationBySource(t, st, si, i, l),
      findReservationById: (t: string, id: string) => reservationRepository.findReservationById(t, id),
      listActiveReservationsForSale: (t: string, s: string) => reservationRepository.listActiveReservationsForSale(t, s),
      markReservationFailed: (t: string, id: string, r: string, a: string) => reservationRepository.markReservationFailed(t, id, r, a),
      markReservationReleased: async () => { throw new Error("SIMULATED_RELEASE_FAILURE"); },
    };

    const service = new SalesFailureResolutionService({
      salesRepository, reservationRepository: failingResRepo as any,
      alertRepository: new InMemoryOperationalAlertRepository(),
      inventoryLedger, audit, idempotency,
      transactionRunner, txFactories: {
        createInventoryLedger: () => inventoryLedger,
        createReservationRepository: () => failingResRepo as any,
        createSalesRepository: () => salesRepository,
        createAlertRepository: () => new InMemoryOperationalAlertRepository(),
      },
    });

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    await expect(service.resolveSaleFailure(ownerUser as any, ownerEff as any, {
      saleId: sale.id,
      reason: "human_rejection_cancellation",
      resolutionReason: "Cancelled",
      idempotencyKey: "rb-release-1",
    })).rejects.toThrow("SIMULATED_RELEASE_FAILURE");

    const saleAfter = await salesRepository.findSaleById(TEST_TENANT_ID, sale.id);
    expect(saleAfter!.saleStatus).toBe("pending_approval");

    const balanceAfter = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    expect(balanceAfter!.reservedQtyKg).toBe("300.000");
  });
});

// ---------------------------------------------------------------------------
// 20. Rollback after sale status update failure.
// ---------------------------------------------------------------------------

describe("WP-03-04 rollback after sale status update failure", () => {
  it("sale status update failure rolls back: reservation stays active, reserved_qty unchanged", async () => {
    const { salesRepository, reservationRepository, ledgerRepo, audit, idempotency, documentSequence, inventoryLedger, transactionRunner } = makeDepsWithTxRunner();
    await seedStock(inventoryLedger, "1000.000");

    const balance = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    if (balance) {
      await ledgerRepo.updateReservedQty(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A, {
        reservedQtyKg: "300.000", version: balance.version + 1,
      });
    }

    const { sale, reservation } = await createPendingSaleWithReservation(salesRepository, reservationRepository, "300.000");

    const failingSalesRepo = {
      findSaleById: (t: string, id: string) => salesRepository.findSaleById(t, id),
      findSaleLines: (t: string, id: string) => salesRepository.findSaleLines(t, id),
      updateSaleStatus: (t: string, id: string, p: any) => salesRepository.updateSaleStatus(t, id, p),
      updateSaleStatusConditional: async () => { throw new Error("SIMULATED_STATUS_UPDATE_FAILURE"); },
    };

    const service = new SalesFailureResolutionService({
      salesRepository: failingSalesRepo as any, reservationRepository,
      alertRepository: new InMemoryOperationalAlertRepository(),
      inventoryLedger, audit, idempotency,
      transactionRunner, txFactories: {
        createInventoryLedger: () => inventoryLedger,
        createReservationRepository: () => reservationRepository,
        createSalesRepository: () => failingSalesRepo as any,
        createAlertRepository: () => new InMemoryOperationalAlertRepository(),
      },
    });

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    await expect(service.resolveSaleFailure(ownerUser as any, ownerEff as any, {
      saleId: sale.id,
      reason: "human_rejection_cancellation",
      resolutionReason: "Cancelled",
      idempotencyKey: "rb-status-1",
    })).rejects.toThrow("SIMULATED_STATUS_UPDATE_FAILURE");

    const reservationAfter = await reservationRepository.findReservationById(TEST_TENANT_ID, reservation.id);
    expect(reservationAfter!.status).toBe("active");

    const balanceAfter = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    expect(balanceAfter!.reservedQtyKg).toBe("300.000");

    const saleAfter = await salesRepository.findSaleById(TEST_TENANT_ID, sale.id);
    expect(saleAfter!.saleStatus).toBe("pending_approval");
  });
});

// ---------------------------------------------------------------------------
// 21. Concurrent release exact reserved_qty result.
// ---------------------------------------------------------------------------

describe("WP-03-04 concurrent release exact reserved_qty", () => {
  it("two concurrent human-rejection resolutions: exactly 1 releases, reserved_qty decreases exactly once", async () => {
    const { service, salesRepository, reservationRepository, ledgerRepo, inventoryLedger } = makeDepsWithTxRunner();
    await seedStock(inventoryLedger, "1000.000");

    const balance = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    if (balance) {
      await ledgerRepo.updateReservedQty(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A, {
        reservedQtyKg: "300.000", version: balance.version + 1,
      });
    }

    const { sale, reservation } = await createPendingSaleWithReservation(salesRepository, reservationRepository, "300.000");

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    const results = await Promise.allSettled([
      service.resolveSaleFailure(ownerUser as any, ownerEff as any, {
        saleId: sale.id, reason: "human_rejection_cancellation",
        resolutionReason: "Cancel A", idempotencyKey: "conc-exact-A",
      }),
      service.resolveSaleFailure(ownerUser as any, ownerEff as any, {
        saleId: sale.id, reason: "human_rejection_cancellation",
        resolutionReason: "Cancel B", idempotencyKey: "conc-exact-B",
      }),
    ]);

    const fulfilled = results.filter(r => r.status === "fulfilled");
    const rejected = results.filter(r => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const balanceAfter = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    expect(balanceAfter!.reservedQtyKg).toBe("0.000");
    expect(balanceAfter!.reservedQtyKg).not.toBe("-300.000");

    const reservationAfter = await reservationRepository.findReservationById(TEST_TENANT_ID, reservation.id);
    expect(reservationAfter!.status).toBe("released");
  });
});
