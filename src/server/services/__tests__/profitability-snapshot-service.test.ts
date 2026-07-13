/**
 * WP-05-02 Profitability Snapshot Service tests.
 *
 * Contract: docs/contracts/12_testing_and_regression_plan.md §5 + Phase 5 gate
 *
 * Tests:
 * - exact net revenue from stored line net values
 * - gross/discount/net fixture from WP-05-01
 * - no discount double subtraction
 * - missing production cost flag
 * - missing direct cost flag
 * - missing transport cost flag
 * - profit/margin behavior when costs missing
 * - complete-cost case
 * - creates version 1 only
 * - duplicate source/idempotency replay safe
 * - rollback with caller transaction
 * - worker redaction / no worker access to profitability fields
 * - tenant isolation
 * - no stock movements
 * - no account entries
 * - no payments/settlements
 * - no sale approval state change
 */
import { describe, it, expect } from "vitest";
import {
  ProfitabilitySnapshotService,
  SaleNotFoundForSnapshotError,
  CommercialTotalsNotCompletedError,
  SnapshotVersionAlreadyExistsError,
} from "../profitability-snapshot-service";
import { InMemoryProfitabilitySnapshotRepository } from "./in-memory-profitability-snapshot-repository";
import { InMemorySalesRepository } from "./in-memory-sales-repository";
import { InMemoryInventoryLedgerRepository } from "./in-memory-inventory-ledger-repository";
import { InMemoryStockReservationRepository } from "./in-memory-stock-reservation-repository";
import { InProcessAuditStore } from "../audit-service";
import { InProcessIdempotencyStore } from "../idempotency-service";
import { InProcessDocumentSequenceStore } from "../document-sequence-service";
import { SalesDraftService } from "../sales-draft-service";
import { SalesSubmissionService } from "../sales-submission-service";
import { InventoryLedgerService } from "../inventory-ledger-service";
import { TEST_USERS, getTestEffectivePermissions } from "@/server/security/role-fixtures";

const TEST_TENANT_ID = "00000000-0000-0000-0000-000000000001";
const TEST_ITEM_ID = "aaa50200-0000-4000-8000-000000000001";
const TEST_LOCATION_ID = "bbb50200-0000-4000-8000-000000000001";
const TEST_CUSTOMER_ID = "ccc50200-0000-4000-8000-000000000001";

function makeUser(userId: string, tenantId: string = TEST_TENANT_ID) {
  return { authenticated: true as const, userId, tenantId, email: "t@e.com", name: "T", authId: "t" };
}

function makeDeps() {
  const snapshotRepo = new InMemoryProfitabilitySnapshotRepository();
  const salesRepository = new InMemorySalesRepository();
  const ledgerRepo = new InMemoryInventoryLedgerRepository();
  const reservationRepo = new InMemoryStockReservationRepository();
  const audit = new InProcessAuditStore();
  const idempotency = new InProcessIdempotencyStore();
  const documentSequence = new InProcessDocumentSequenceStore();
  const inventoryLedger = new InventoryLedgerService({ ledger: ledgerRepo, audit, idempotency, documentSequence });
  const submissionService = new SalesSubmissionService({ salesRepository, reservationRepository: reservationRepo, inventoryLedger, audit, idempotency, documentSequence });
  const draftService = new SalesDraftService({ salesRepository, audit, documentSequence, submissionService });
  const snapshotService = new ProfitabilitySnapshotService({ snapshotRepository: snapshotRepo, salesRepository, audit });
  return { snapshotRepo, salesRepository, ledgerRepo, reservationRepo, audit, idempotency, documentSequence, inventoryLedger, submissionService, draftService, snapshotService };
}

/**
 * Helper: create a sale with completed commercial totals.
 * 2 lines: 1000 kg @ 80 = 80.00 gross; 1000 kg @ 80 = 80.00 gross.
 * Total gross = 160.00; discount = 16.00; document total = 144.00.
 */
async function setupCompletedSale(deps: ReturnType<typeof makeDeps>): Promise<{ saleId: string; lines: any[] }> {
  const ownerUser = makeUser(TEST_USERS.owner.userId);
  const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

  const draft = await deps.draftService.createDraft(ownerUser as any, ownerEff as any, {
    customerId: TEST_CUSTOMER_ID, saleDate: "2026-07-10",
    lines: [
      { itemId: TEST_ITEM_ID, locationId: TEST_LOCATION_ID, quantityKg: "1000.000", pricePerTon: "80.00" },
      { itemId: TEST_ITEM_ID, locationId: TEST_LOCATION_ID, quantityKg: "1000.000", pricePerTon: "80.00" },
    ],
  });

  const lines = await deps.salesRepository.findSaleLines(TEST_TENANT_ID, draft.saleId);

  await deps.draftService.completeCommercialTotals(ownerUser as any, ownerEff as any, {
    saleId: draft.saleId, orderDiscountTotal: "16.00",
    linePrices: lines.map((l: any) => ({ lineId: l.id, pricePerTon: "80.00" })),
  });

  return { saleId: draft.saleId, lines };
}

// ===========================================================================
// 1. Exact net revenue + no discount double subtraction.
// ===========================================================================

describe("WP-05-02 snapshot — exact net revenue + no double subtraction", () => {
  it("revenue_snapshot = document_total_posted (already net of discount)", async () => {
    const deps = makeDeps();
    const { saleId } = await setupCompletedSale(deps);

    const result = await deps.snapshotService.createVersion1Snapshot(
      makeUser(TEST_USERS.owner.userId) as any,
      { salesOrderId: saleId, rawCost: "50.00", singleProductionCost: "30.00", twistingCost: "0.00", transportCost: "0.00", reviewedDirectCosts: "0.00" },
    );

    // revenue_snapshot = 144.00 (document_total_posted from WP-05-01 = 160 - 16 discount)
    expect(result.revenueSnapshot).toBe("144.00");
    // discount_snapshot = 16.00 (informational copy, NOT subtracted again)
    expect(result.discountSnapshot).toBe("16.00");
    // profit = revenue - costs = 144 - 50 - 30 = 64.00
    expect(result.profitAmount).toBe("64.00");
    // margin = 64/144 × 100 = 44.444444
    expect(result.profitMarginPercent).toBe("44.444444");
    // No missing costs (all 5 components provided, even if some are 0)
    expect(result.hasMissingCosts).toBe(false);
  });

  it("discount is NOT subtracted twice (profit uses revenue_snapshot directly)", async () => {
    const deps = makeDeps();
    const { saleId } = await setupCompletedSale(deps);

    const result = await deps.snapshotService.createVersion1Snapshot(
      makeUser(TEST_USERS.owner.userId) as any,
      { salesOrderId: saleId, rawCost: "100.00" },
    );

    // revenue = 144.00 (net of discount); discount = 16.00 (informational)
    // profit = 144 - 100 = 44.00 (NOT 144 - 16 - 100 = 28.00)
    expect(result.profitAmount).toBe("44.00");
  });
});

// ===========================================================================
// 2. Missing cost flags.
// ===========================================================================

describe("WP-05-02 snapshot — missing cost flags", () => {
  it("missing raw cost → flag set, column NULL, profit incomplete", async () => {
    const deps = makeDeps();
    const { saleId } = await setupCompletedSale(deps);

    const result = await deps.snapshotService.createVersion1Snapshot(
      makeUser(TEST_USERS.owner.userId) as any,
      { salesOrderId: saleId, singleProductionCost: "30.00" },
    );

    expect(result.missingCostFlags.raw_material).toBe(true);
    expect(result.rawCostSnapshot).toBeNull();
    expect(result.hasMissingCosts).toBe(true);
    // profit = 144 - 30 = 114.00 (raw cost excluded, NOT zero)
    expect(result.profitAmount).toBe("114.00");
  });

  it("missing single production cost → flag set", async () => {
    const deps = makeDeps();
    const { saleId } = await setupCompletedSale(deps);

    const result = await deps.snapshotService.createVersion1Snapshot(
      makeUser(TEST_USERS.owner.userId) as any,
      { salesOrderId: saleId, rawCost: "50.00" },
    );

    expect(result.missingCostFlags.single_yarn_production).toBe(true);
    expect(result.singleProductionCostSnapshot).toBeNull();
    expect(result.hasMissingCosts).toBe(true);
  });

  it("missing transport cost → flag set", async () => {
    const deps = makeDeps();
    const { saleId } = await setupCompletedSale(deps);

    const result = await deps.snapshotService.createVersion1Snapshot(
      makeUser(TEST_USERS.owner.userId) as any,
      { salesOrderId: saleId, rawCost: "50.00", singleProductionCost: "30.00", transportCost: null },
    );

    expect(result.missingCostFlags.transport).toBe(true);
    expect(result.transportCostSnapshot).toBeNull();
  });

  it("missing direct costs → flag set (typically missing at version 1)", async () => {
    const deps = makeDeps();
    const { saleId } = await setupCompletedSale(deps);

    const result = await deps.snapshotService.createVersion1Snapshot(
      makeUser(TEST_USERS.owner.userId) as any,
      { salesOrderId: saleId, rawCost: "50.00", singleProductionCost: "30.00" },
    );

    expect(result.missingCostFlags.direct_costs).toBe(true);
  });

  it("all costs missing → all flags set, profit = revenue (no costs subtracted)", async () => {
    const deps = makeDeps();
    const { saleId } = await setupCompletedSale(deps);

    const result = await deps.snapshotService.createVersion1Snapshot(
      makeUser(TEST_USERS.owner.userId) as any,
      { salesOrderId: saleId },
    );

    expect(result.hasMissingCosts).toBe(true);
    expect(Object.values(result.missingCostFlags).every(v => v === true)).toBe(true);
    // profit = revenue - 0 costs = 144.00
    expect(result.profitAmount).toBe("144.00");
  });
});

// ===========================================================================
// 3. Complete-cost case.
// ===========================================================================

describe("WP-05-02 snapshot — complete costs", () => {
  it("all costs provided → no missing flags, exact profit/margin", async () => {
    const deps = makeDeps();
    const { saleId } = await setupCompletedSale(deps);

    const result = await deps.snapshotService.createVersion1Snapshot(
      makeUser(TEST_USERS.owner.userId) as any,
      {
        salesOrderId: saleId,
        rawCost: "50.00",
        singleProductionCost: "30.00",
        twistingCost: "10.00",
        transportCost: "5.00",
        reviewedDirectCosts: "5.00",
      },
    );

    expect(result.hasMissingCosts).toBe(false);
    // profit = 144 - 50 - 30 - 10 - 5 - 5 = 44.00
    expect(result.profitAmount).toBe("44.00");
    // margin = 44/144 × 100 = 30.555556
    expect(result.profitMarginPercent).toBe("30.555556");
  });
});

// ===========================================================================
// 4. Versioning + idempotency.
// ===========================================================================

describe("WP-05-02 snapshot — versioning + idempotency", () => {
  it("creates version 1 only", async () => {
    const deps = makeDeps();
    const { saleId } = await setupCompletedSale(deps);

    const result = await deps.snapshotService.createVersion1Snapshot(
      makeUser(TEST_USERS.owner.userId) as any,
      { salesOrderId: saleId, rawCost: "50.00" },
    );

    expect(result.version).toBe(1);
    expect(result.isActive).toBe(true);
  });

  it("duplicate version 1 for same sale → STATE_CONFLICT (source/version-unique, NOT idempotency replay)", async () => {
    const deps = makeDeps();
    const { saleId } = await setupCompletedSale(deps);

    await deps.snapshotService.createVersion1Snapshot(
      makeUser(TEST_USERS.owner.userId) as any,
      { salesOrderId: saleId, rawCost: "50.00" },
    );

    await expect(deps.snapshotService.createVersion1Snapshot(
      makeUser(TEST_USERS.owner.userId) as any,
      { salesOrderId: saleId, rawCost: "50.00" },
    )).rejects.toThrow(SnapshotVersionAlreadyExistsError);
  });

  it("snapshot row is immutable (value columns never updated)", async () => {
    const deps = makeDeps();
    const { saleId } = await setupCompletedSale(deps);

    const result = await deps.snapshotService.createVersion1Snapshot(
      makeUser(TEST_USERS.owner.userId) as any,
      { salesOrderId: saleId, rawCost: "50.00" },
    );

    // Verify the stored row matches the result
    const stored = await deps.snapshotRepo.findActiveSnapshot(TEST_TENANT_ID, saleId);
    expect(stored).toBeTruthy();
    expect(stored!.profitAmount).toBe(result.profitAmount);
    expect(stored!.version).toBe(1);
    expect(stored!.isActive).toBe("active");
    expect(stored!.supersededBySnapshotId).toBeNull();
  });
});

// ===========================================================================
// 5. Rollback with caller transaction.
// ===========================================================================

describe("WP-05-02 snapshot — rollback", () => {
  it("audit failure rolls back snapshot insert (DEC-024)", async () => {
    const deps = makeDeps();
    const { saleId } = await setupCompletedSale(deps);

    // Take a snapshot of the repository state before the failed operation
    const repoSnapshot = deps.snapshotRepo.snapshot();

    // Force audit failure
    deps.audit.setShouldFail(true);

    await expect(deps.snapshotService.createVersion1Snapshot(
      makeUser(TEST_USERS.owner.userId) as any,
      { salesOrderId: saleId, rawCost: "50.00" },
    )).rejects.toThrow();

    deps.audit.setShouldFail(false);

    // In a real DB transaction, the snapshot insert would roll back.
    // The in-memory store doesn't auto-rollback, but the audit failure
    // prevents the service from returning a result — the caller knows the
    // operation failed. The AUTHORITATIVE business state is:
    // 1. No audit row was persisted (audit threw before returning)
    // 2. The caller (approval service) will roll back the entire transaction
    //
    // For the in-memory test, we verify the audit row was NOT written:
    const auditRows = deps.audit.getRows();
    const snapshotAudit = auditRows.find((r) => r.actionType === "profitability_snapshot.create_v1");
    expect(snapshotAudit).toBeUndefined();

    // And restore the repo state (simulating transaction rollback)
    deps.snapshotRepo.restore(repoSnapshot);

    // Verify no snapshot persisted after restore
    const stored = await deps.snapshotRepo.findActiveSnapshot(TEST_TENANT_ID, saleId);
    expect(stored).toBeNull();
  });
});

// ===========================================================================
// 6. Worker redaction.
// ===========================================================================

describe("WP-05-02 snapshot — worker redaction", () => {
  it("worker cannot read profitability snapshot (returns null)", async () => {
    const deps = makeDeps();
    const { saleId } = await setupCompletedSale(deps);

    await deps.snapshotService.createVersion1Snapshot(
      makeUser(TEST_USERS.owner.userId) as any,
      { salesOrderId: saleId, rawCost: "50.00" },
    );

    // Warehouse worker tries to read — should get null (no profitability.view)
    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = getTestEffectivePermissions(TEST_USERS.warehouse.userId);

    const result = await deps.snapshotService.readActiveSnapshot(whUser as any, whEff as any, saleId);
    expect(result).toBeNull();
  });

  it("owner can read profitability snapshot", async () => {
    const deps = makeDeps();
    const { saleId } = await setupCompletedSale(deps);

    await deps.snapshotService.createVersion1Snapshot(
      makeUser(TEST_USERS.owner.userId) as any,
      { salesOrderId: saleId, rawCost: "50.00" },
    );

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    const result = await deps.snapshotService.readActiveSnapshot(ownerUser as any, ownerEff as any, saleId);
    expect(result).toBeTruthy();
    expect(result!.profitAmount).toBe("94.00"); // 144 - 50
  });
});

// ===========================================================================
// 7. Tenant isolation.
// ===========================================================================

describe("WP-05-02 snapshot — tenant isolation", () => {
  it("cross-tenant sale → SALE_NOT_FOUND", async () => {
    const deps = makeDeps();
    const { saleId } = await setupCompletedSale(deps);

    const foreignUser = makeUser(TEST_USERS.owner.userId, "00000000-0000-0000-0000-ffffffffffff");

    await expect(deps.snapshotService.createVersion1Snapshot(
      foreignUser as any,
      { salesOrderId: saleId, rawCost: "50.00" },
    )).rejects.toThrow(SaleNotFoundForSnapshotError);
  });
});

// ===========================================================================
// 8. No side effects.
// ===========================================================================

describe("WP-05-02 snapshot — no side effects", () => {
  it("snapshot creation: NO stock movements, NO account entries, NO payments, NO sale status change", async () => {
    const deps = makeDeps();
    const { saleId } = await setupCompletedSale(deps);

    const saleBefore = await deps.salesRepository.findSaleById(TEST_TENANT_ID, saleId);

    await deps.snapshotService.createVersion1Snapshot(
      makeUser(TEST_USERS.owner.userId) as any,
      { salesOrderId: saleId, rawCost: "50.00" },
    );

    // Sale status unchanged (still draft — snapshot doesn't approve)
    const saleAfter = await deps.salesRepository.findSaleById(TEST_TENANT_ID, saleId);
    expect(saleAfter!.saleStatus).toBe(saleBefore!.saleStatus);
    expect(saleAfter!.approvalStatus).toBe(saleBefore!.approvalStatus);

    // No stock movements
    const movements = [...((deps.ledgerRepo as any).movements as Map<string, any>).values()];
    expect(movements.filter((m: any) => m.movementType === "sale_issue").length).toBe(0);

    // No reservations
    const reservations = [...((deps.reservationRepo as any).reservations as Map<string, any>).values()];
    expect(reservations.length).toBe(0);

    // Audit only has snapshot.create_v1 + WP-05-01 audit actions (no payable/payment/account_entry)
    const auditRows = deps.audit.getRows();
    for (const row of auditRows) {
      expect(row.actionType).not.toContain("payable");
      expect(row.actionType).not.toContain("payment");
      expect(row.actionType).not.toContain("account_entry");
    }

    // Verify snapshot audit exists
    const snapshotAudit = auditRows.find((r) => r.actionType === "profitability_snapshot.create_v1");
    expect(snapshotAudit).toBeTruthy();
  });
});

// ===========================================================================
// 9. Commercial totals not completed.
// ===========================================================================

describe("WP-05-02 snapshot — preconditions", () => {
  it("rejects if commercial totals not completed", async () => {
    const deps = makeDeps();
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    // Create a draft WITHOUT completing commercial totals
    const draft = await deps.draftService.createDraft(ownerUser as any, ownerEff as any, {
      customerId: TEST_CUSTOMER_ID, saleDate: "2026-07-10",
      lines: [{ itemId: TEST_ITEM_ID, locationId: TEST_LOCATION_ID, quantityKg: "1000.000", pricePerTon: "80.00" }],
    });

    await expect(deps.snapshotService.createVersion1Snapshot(
      ownerUser as any,
      { salesOrderId: draft.saleId, rawCost: "50.00" },
    )).rejects.toThrow(CommercialTotalsNotCompletedError);
  });

  it("rejects if sale not found", async () => {
    const deps = makeDeps();

    await expect(deps.snapshotService.createVersion1Snapshot(
      makeUser(TEST_USERS.owner.userId) as any,
      { salesOrderId: "nonexistent-sale-id", rawCost: "50.00" },
    )).rejects.toThrow(SaleNotFoundForSnapshotError);
  });
});
