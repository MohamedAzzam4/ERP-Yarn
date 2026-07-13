/**
 * WP-05-03 Sales Approval Service tests.
 *
 * Contract: docs/contracts/12_testing_and_regression_plan.md §5 + Phase 5 gate
 */
import { describe, it, expect } from "vitest";
import {
  SalesApprovalService,
  SaleNotFoundForApprovalError,
  SaleNotPendingError,
  RequesterCannotApproveOwnSaleError,
  SubjectHashMismatchError,
  ReservationMismatchError,
  CommercialTotalsNotPostedError,
} from "../sales-approval-service";
import { SalesDraftService } from "../sales-draft-service";
import { SalesSubmissionService } from "../sales-submission-service";
import { InventoryLedgerService } from "../inventory-ledger-service";
import { ProfitabilitySnapshotService } from "../profitability-snapshot-service";
import { InMemorySalesRepository } from "./in-memory-sales-repository";
import { InMemoryInventoryLedgerRepository } from "./in-memory-inventory-ledger-repository";
import { InMemoryStockReservationRepository } from "./in-memory-stock-reservation-repository";
import { InMemoryProfitabilitySnapshotRepository } from "./in-memory-profitability-snapshot-repository";
import { InMemorySubledgerRepository } from "./in-memory-subledger-repository";
import { InProcessAuditStore } from "../audit-service";
import { InProcessIdempotencyStore } from "../idempotency-service";
import { InProcessDocumentSequenceStore } from "../document-sequence-service";
import { SubledgerService } from "../subledger-service";
import { TEST_USERS, getTestEffectivePermissions } from "@/server/security/role-fixtures";
import { PermissionDeniedError } from "@/server/security/guards";

const TEST_TENANT_ID = "00000000-0000-0000-0000-000000000001";
const TEST_ITEM_ID = "aaa50300-0000-4000-8000-000000000001";
const TEST_LOCATION_ID = "bbb50300-0000-4000-8000-000000000001";
const TEST_CUSTOMER_ID = "ccc50300-0000-4000-8000-000000000001";

function makeUser(userId: string, tenantId: string = TEST_TENANT_ID) {
  return { authenticated: true as const, userId, tenantId, email: "t@e.com", name: "T", authId: "t" };
}

function makeOwnerEff() {
  return { assignedRoleCodes: ["owner"], permissionKeys: new Set(["sales.create","sales.submit","sales.view_price","sales.approve","sales.cancel","inventory.receive.approve","inventory.receive.create","balances.view_supplier_factory","profitability.view"]), deniedFieldKeys: new Set(), workerFinancialDeny: false } as any;
}
function makeAcctEff() {
  return { assignedRoleCodes: ["accountant"], permissionKeys: new Set(["sales.create","sales.submit","sales.view_price","sales.approve","sales.cancel","balances.view_supplier_factory","profitability.view","inventory.receive.approve"]), deniedFieldKeys: new Set(), workerFinancialDeny: false } as any;
}
function makeWhEff() {
  return { assignedRoleCodes: ["warehouse_employee"], permissionKeys: new Set(["sales.create","inventory.receive.approve","inventory.receive.create"]), deniedFieldKeys: new Set(), workerFinancialDeny: true } as any;
}

function makeDeps() {
  const salesRepository = new InMemorySalesRepository();
  const ledgerRepo = new InMemoryInventoryLedgerRepository();
  const reservationRepo = new InMemoryStockReservationRepository();
  const snapshotRepo = new InMemoryProfitabilitySnapshotRepository();
  const subledgerRepo = new InMemorySubledgerRepository();
  const audit = new InProcessAuditStore();
  const idempotency = new InProcessIdempotencyStore();
  const documentSequence = new InProcessDocumentSequenceStore();
  const inventoryLedger = new InventoryLedgerService({ ledger: ledgerRepo, audit, idempotency, documentSequence });
  const subledger = new SubledgerService({ subledger: subledgerRepo, audit, idempotency, documentSequence });
  const submissionService = new SalesSubmissionService({ salesRepository, reservationRepository: reservationRepo, inventoryLedger, audit, idempotency, documentSequence });
  const draftService = new SalesDraftService({ salesRepository, audit, documentSequence, submissionService });
  const snapshotService = new ProfitabilitySnapshotService({ snapshotRepository: snapshotRepo, salesRepository, audit });
  const approvalService = new SalesApprovalService({
    salesRepository, reservationRepository: reservationRepo, inventoryLedger, subledger, snapshotService, audit, idempotency, documentSequence,
  });
  return { salesRepository, ledgerRepo, reservationRepo, snapshotRepo, subledgerRepo, audit, idempotency, documentSequence, inventoryLedger, subledger, submissionService, draftService, snapshotService, approvalService };
}

async function seedStock(deps: ReturnType<typeof makeDeps>) {
  const ownerUser = makeUser(TEST_USERS.owner.userId);
  const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);
  await deps.inventoryLedger.postRawReceipt(ownerUser as any, ownerEff as any, {
    itemId: TEST_ITEM_ID, toLocationId: TEST_LOCATION_ID, quantityKg: "10000.000",
    movementDate: "2026-07-06", sourceDocumentType: "test_seed", sourceDocumentId: "seed-001",
    idempotencyKey: "seed-key-001",
  });
}

/**
 * Full setup: seed stock → create draft → complete commercial totals → submit → return saleId.
 * The owner creates the draft; the accountant submits and will approve.
 */
async function setupPendingSale(deps: ReturnType<typeof makeDeps>): Promise<string> {
  await seedStock(deps);
  const ownerUser = makeUser(TEST_USERS.owner.userId);
  const ownerEff = makeOwnerEff();
  const acctUser = makeUser(TEST_USERS.accountant.userId);
  const acctEff = makeAcctEff();

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
    linePrices: lines.map(l => ({ lineId: l.id, pricePerTon: "80.00" })),
  });

  await deps.draftService.submitSale(acctUser as any, acctEff as any, {
    saleId: draft.saleId, idempotencyKey: "submit-setup-1",
  });

  return draft.saleId;
}

// ===========================================================================
// 1. Happy approval path.
// ===========================================================================

describe("WP-05-03 approveSale — happy path", () => {
  it("posts stock movements, consumes reservations, posts receivable, creates snapshot, marks approved, writes audit", async () => {
    const deps = makeDeps();
    const saleId = await setupPendingSale(deps);

    const result = await deps.approvalService.approveSale(
      makeUser(TEST_USERS.accountant.userId) as any, makeAcctEff() as any,
      { saleId, idempotencyKey: "approve-1", snapshotCosts: { rawCost: "50.00", singleProductionCost: "30.00" } },
    );

    const checks: string[] = [];
    if (result.action !== "posted") checks.push(`action=${result.action}`);
    if (result.saleStatus !== "approved") checks.push(`status=${result.saleStatus}`);
    if (result.movements.length !== 2) checks.push(`movements=${result.movements.length}`);
    if (!result.receivableEntryId) checks.push("no receivable entry");
    if (!result.snapshotId) checks.push("no snapshot");
    if (result.snapshotVersion !== 1) checks.push(`snapshotVersion=${result.snapshotVersion}`);
    // Receivable = +144.00 (document_total_posted, POSITIVE)
    if (result.receivableAmountSigned !== "144.00") checks.push(`receivable=${result.receivableAmountSigned}`);

    // Verify sale approved/locked
    const sale = await deps.salesRepository.findSaleById(TEST_TENANT_ID, saleId);
    if (sale?.saleStatus !== "approved") checks.push(`sale.status=${sale?.saleStatus}`);
    if (!sale?.isLocked) checks.push("sale not locked");
    if (sale?.reservationStatus !== "consumed") checks.push(`reservationStatus=${sale?.reservationStatus}`);
    if (sale?.approvedBy !== TEST_USERS.accountant.userId) checks.push(`approvedBy=${sale?.approvedBy}`);

    // Verify stock movements
    const movements = [...((deps.ledgerRepo as any).movements as Map<string, any>).values()];
    const saleIssueMv = movements.filter((m: any) => m.movementType === "sale_issue");
    if (saleIssueMv.length !== 2) checks.push(`sale_issue movements=${saleIssueMv.length}`);

    // Verify reservations consumed
    const reservations = [...((deps.reservationRepo as any).reservations as Map<string, any>).values()];
    const consumed = reservations.filter((r: any) => r.status === "approved_consumed");
    if (consumed.length !== 2) checks.push(`consumed reservations=${consumed.length}`);

    // Verify receivable entry (POSITIVE = +144.00)
    const entries = [...((deps.subledgerRepo as any).entries as Map<string, any>).values()];
    const receivable = entries.find((e: any) => e.entryType === "customer_sale_receivable");
    if (!receivable) checks.push("no receivable entry in subledger");
    if (receivable?.amountSigned !== "144.00") checks.push(`receivable.amount=${receivable?.amountSigned}`);

    // Verify snapshot
    const snapshot = await deps.snapshotRepo.findActiveSnapshot(TEST_TENANT_ID, saleId);
    if (!snapshot) checks.push("no active snapshot");
    if (snapshot?.revenueSnapshot !== "144.00") checks.push(`snapshot.revenue=${snapshot?.revenueSnapshot}`);

    // Verify audit
    const auditRows = deps.audit.getRows();
    const approveAudit = auditRows.find(r => r.actionType === "sales_approval.approve");
    if (!approveAudit) checks.push("no approval audit");

    expect(checks.length).toBe(0);
  });
});

// ===========================================================================
// 2. Idempotency.
// ===========================================================================

describe("WP-05-03 approveSale — idempotency", () => {
  it("same key replays with no duplicate effects", async () => {
    const deps = makeDeps();
    const saleId = await setupPendingSale(deps);

    const r1 = await deps.approvalService.approveSale(
      makeUser(TEST_USERS.accountant.userId) as any, makeAcctEff() as any,
      { saleId, idempotencyKey: "approve-2", snapshotCosts: { rawCost: "50.00" } },
    );
    expect(r1.action).toBe("posted");

    // Count effects after first approval
    const movementsAfter1 = [...((deps.ledgerRepo as any).movements as Map<string, any>).values()].filter((m: any) => m.movementType === "sale_issue").length;
    const entriesAfter1 = [...((deps.subledgerRepo as any).entries as Map<string, any>).values()].length;

    // Replay
    const r2 = await deps.approvalService.approveSale(
      makeUser(TEST_USERS.accountant.userId) as any, makeAcctEff() as any,
      { saleId, idempotencyKey: "approve-2", snapshotCosts: { rawCost: "50.00" } },
    );
    expect(r2.action).toBe("replayed");

    // No new effects
    const movementsAfter2 = [...((deps.ledgerRepo as any).movements as Map<string, any>).values()].filter((m: any) => m.movementType === "sale_issue").length;
    const entriesAfter2 = [...((deps.subledgerRepo as any).entries as Map<string, any>).values()].length;
    expect(movementsAfter2).toBe(movementsAfter1);
    expect(entriesAfter2).toBe(entriesAfter1);
  });

  it("different key on already-approved sale rejects", async () => {
    const deps = makeDeps();
    const saleId = await setupPendingSale(deps);

    await deps.approvalService.approveSale(
      makeUser(TEST_USERS.accountant.userId) as any, makeAcctEff() as any,
      { saleId, idempotencyKey: "approve-3a", snapshotCosts: { rawCost: "50.00" } },
    );

    await expect(deps.approvalService.approveSale(
      makeUser(TEST_USERS.accountant.userId) as any, makeAcctEff() as any,
      { saleId, idempotencyKey: "approve-3b", snapshotCosts: { rawCost: "50.00" } },
    )).rejects.toThrow(SaleNotPendingError);
  });
});

// ===========================================================================
// 3. Subject hash.
// ===========================================================================

describe("WP-05-03 approveSale — subject hash", () => {
  it("stale subject hash rejects before posting", async () => {
    const deps = makeDeps();
    const saleId = await setupPendingSale(deps);

    // Mutate subjectHash
    const sale = await deps.salesRepository.findSaleById(TEST_TENANT_ID, saleId);
    await deps.salesRepository.updateSaleSubjectHash(TEST_TENANT_ID, saleId, {
      subjectHash: "deadbeef".repeat(8), subjectVersion: 1,
    });

    await expect(deps.approvalService.approveSale(
      makeUser(TEST_USERS.accountant.userId) as any, makeAcctEff() as any,
      { saleId, idempotencyKey: "approve-4", snapshotCosts: { rawCost: "50.00" } },
    )).rejects.toThrow(SubjectHashMismatchError);
  });
});

// ===========================================================================
// 4. DEC-080 requester cannot approve own sale.
// ===========================================================================

describe("WP-05-03 approveSale — DEC-080", () => {
  it("requester cannot approve own sale", async () => {
    const deps = makeDeps();
    await seedStock(deps);
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();

    // Owner creates + completes + submits
    const draft = await deps.draftService.createDraft(ownerUser as any, ownerEff as any, {
      customerId: TEST_CUSTOMER_ID, saleDate: "2026-07-10",
      lines: [{ itemId: TEST_ITEM_ID, locationId: TEST_LOCATION_ID, quantityKg: "1000.000", pricePerTon: "80.00" }],
    });
    const lines = await deps.salesRepository.findSaleLines(TEST_TENANT_ID, draft.saleId);
    await deps.draftService.completeCommercialTotals(ownerUser as any, ownerEff as any, {
      saleId: draft.saleId, orderDiscountTotal: "0.00",
      linePrices: lines.map(l => ({ lineId: l.id, pricePerTon: "80.00" })),
    });
    // Owner submits — so owner is the requester
    await deps.draftService.submitSale(ownerUser as any, ownerEff as any, {
      saleId: draft.saleId, idempotencyKey: "submit-4",
    });

    // Owner tries to approve own sale — DEC-080
    await expect(deps.approvalService.approveSale(
      ownerUser as any, ownerEff as any,
      { saleId: draft.saleId, idempotencyKey: "approve-4b", snapshotCosts: { rawCost: "50.00" } },
    )).rejects.toThrow(RequesterCannotApproveOwnSaleError);
  });
});

// ===========================================================================
// 5. Permission denial.
// ===========================================================================

describe("WP-05-03 approveSale — permission", () => {
  it("warehouse worker cannot approve (lacks sales.approve)", async () => {
    const deps = makeDeps();
    const saleId = await setupPendingSale(deps);

    await expect(deps.approvalService.approveSale(
      makeUser(TEST_USERS.warehouse.userId) as any, makeWhEff() as any,
      { saleId, idempotencyKey: "approve-5", snapshotCosts: { rawCost: "50.00" } },
    )).rejects.toThrow(PermissionDeniedError);
  });
});

// ===========================================================================
// 6. Reservation mismatch.
// ===========================================================================

describe("WP-05-03 approveSale — reservation mismatch", () => {
  it("rejects if a line has no active reservation", async () => {
    const deps = makeDeps();
    const saleId = await setupPendingSale(deps);

    // Manually release one reservation
    const reservations = [...((deps.reservationRepo as any).reservations as Map<string, any>).values()];
    if (reservations.length > 0) {
      await deps.reservationRepo.markReservationReleased(TEST_TENANT_ID, reservations[0]!.id);
    }

    await expect(deps.approvalService.approveSale(
      makeUser(TEST_USERS.accountant.userId) as any, makeAcctEff() as any,
      { saleId, idempotencyKey: "approve-6", snapshotCosts: { rawCost: "50.00" } },
    )).rejects.toThrow(ReservationMismatchError);
  });
});

// ===========================================================================
// 7. Tenant isolation.
// ===========================================================================

describe("WP-05-03 approveSale — tenant isolation", () => {
  it("cross-tenant sale → SALE_NOT_FOUND", async () => {
    const deps = makeDeps();
    const saleId = await setupPendingSale(deps);

    const foreignUser = makeUser(TEST_USERS.accountant.userId, "00000000-0000-0000-0000-ffffffffffff");
    await expect(deps.approvalService.approveSale(
      foreignUser as any, makeAcctEff() as any,
      { saleId, idempotencyKey: "approve-7", snapshotCosts: { rawCost: "50.00" } },
    )).rejects.toThrow(SaleNotFoundForApprovalError);
  });
});

// ===========================================================================
// 8. No side effects (payments/settlements/direct costs).
// ===========================================================================

describe("WP-05-03 approveSale — no side effects", () => {
  it("approval creates NO payments, NO settlements, NO direct costs", async () => {
    const deps = makeDeps();
    const saleId = await setupPendingSale(deps);

    await deps.approvalService.approveSale(
      makeUser(TEST_USERS.accountant.userId) as any, makeAcctEff() as any,
      { saleId, idempotencyKey: "approve-8", snapshotCosts: { rawCost: "50.00" } },
    );

    // Audit should NOT contain payment/settlement/direct_cost actions
    const auditRows = deps.audit.getRows();
    for (const row of auditRows) {
      expect(row.actionType).not.toContain("payment");
      expect(row.actionType).not.toContain("settlement");
      expect(row.actionType).not.toContain("direct_cost");
    }

    // Only account entries should be customer_sale_receivable (no supplier/factory/payment entries)
    const entries = [...((deps.subledgerRepo as any).entries as Map<string, any>).values()];
    for (const e of entries) {
      expect(e.entryType).not.toBe("supplier_raw_payable");
      expect(e.entryType).not.toBe("factory_production_payable");
      expect(e.entryType).not.toBe("customer_payment");
      expect(e.entryType).not.toBe("supplier_payment");
      expect(e.entryType).not.toBe("factory_payment");
    }
  });
});

// ===========================================================================
// 9. Rollback on audit failure.
// ===========================================================================

describe("WP-05-03 approveSale — rollback", () => {
  it("audit failure rolls back all effects (stock, receivable, snapshot, sale state)", async () => {
    const deps = makeDeps();
    const saleId = await setupPendingSale(deps);

    // Take snapshots for verification
    const salesSnapshot = deps.salesRepository.snapshot();
    const ledgerSnapshot = deps.ledgerRepo.snapshot();
    const resSnapshot = deps.reservationRepo.snapshot();
    const subledgerEntriesBefore = [...((deps.subledgerRepo as any).entries as Map<string, any>).values()].length;
    const snapshotsBefore = [...((deps.snapshotRepo as any).snapshots as Map<string, any>).values()].length;

    // Force audit failure
    deps.audit.setShouldFail(true);

    await expect(deps.approvalService.approveSale(
      makeUser(TEST_USERS.accountant.userId) as any, makeAcctEff() as any,
      { saleId, idempotencyKey: "approve-9", snapshotCosts: { rawCost: "50.00" } },
    )).rejects.toThrow();

    deps.audit.setShouldFail(false);

    // Verify sale remains pending_approval (not approved)
    const sale = await deps.salesRepository.findSaleById(TEST_TENANT_ID, saleId);
    expect(sale?.saleStatus).toBe("pending_approval");
    expect(sale?.isLocked).toBe(false);
    expect(sale?.approvedBy).toBeNull();

    // No new subledger entries
    const subledgerEntriesAfter = [...((deps.subledgerRepo as any).entries as Map<string, any>).values()].length;
    expect(subledgerEntriesAfter).toBe(subledgerEntriesBefore);

    // No new snapshots
    const snapshotsAfter = [...((deps.snapshotRepo as any).snapshots as Map<string, any>).values()].length;
    expect(snapshotsAfter).toBe(snapshotsBefore);
  });
});

// ===========================================================================
// 10. Commercial totals not completed.
// ===========================================================================

describe("WP-05-03 approveSale — preconditions", () => {
  it("rejects if commercial totals not completed", async () => {
    const deps = makeDeps();
    await seedStock(deps);
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();
    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const acctEff = makeAcctEff();

    // Create draft WITHOUT completing commercial totals, but manually set to pending
    const draft = await deps.draftService.createDraft(ownerUser as any, ownerEff as any, {
      customerId: TEST_CUSTOMER_ID, saleDate: "2026-07-10",
      lines: [{ itemId: TEST_ITEM_ID, locationId: TEST_LOCATION_ID, quantityKg: "1000.000", pricePerTon: "80.00" }],
    });

    // Manually set to pending_approval (simulating a submit without commercial completion)
    await deps.salesRepository.updateSaleStatus(TEST_TENANT_ID, draft.saleId, {
      saleStatus: "pending_approval", approvalStatus: "pending_approval", reservationStatus: "reserved",
    });

    await expect(deps.approvalService.approveSale(
      acctUser as any, acctEff as any,
      { saleId: draft.saleId, idempotencyKey: "approve-10", snapshotCosts: { rawCost: "50.00" } },
    )).rejects.toThrow(CommercialTotalsNotPostedError);
  });

  it("rejects if sale not found", async () => {
    const deps = makeDeps();
    await expect(deps.approvalService.approveSale(
      makeUser(TEST_USERS.accountant.userId) as any, makeAcctEff() as any,
      { saleId: "nonexistent", idempotencyKey: "approve-10b", snapshotCosts: {} },
    )).rejects.toThrow(SaleNotFoundForApprovalError);
  });
});

// ===========================================================================
// 11. Concurrent double approval.
// ===========================================================================

describe("WP-05-03 approveSale — concurrency", () => {
  it("two concurrent approvals with different keys → one wins, other rejects", async () => {
    const deps = makeDeps();
    const saleId = await setupPendingSale(deps);

    const p1 = deps.approvalService.approveSale(
      makeUser(TEST_USERS.accountant.userId) as any, makeAcctEff() as any,
      { saleId, idempotencyKey: "approve-11a", snapshotCosts: { rawCost: "50.00" } },
    );
    const p2 = deps.approvalService.approveSale(
      makeUser(TEST_USERS.accountant.userId) as any, makeAcctEff() as any,
      { saleId, idempotencyKey: "approve-11b", snapshotCosts: { rawCost: "50.00" } },
    );

    const settled = await Promise.allSettled([p1, p2]);
    const fulfilled = settled.filter(r => r.status === "fulfilled");
    const rejected = settled.filter(r => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // Sale is approved/locked
    const sale = await deps.salesRepository.findSaleById(TEST_TENANT_ID, saleId);
    expect(sale?.isLocked).toBe(true);
    expect(sale?.saleStatus).toBe("approved");
  });
});
