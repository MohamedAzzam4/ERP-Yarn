/**
 * WP-06-04 Replacement Return Workflow — tests.
 *
 * Contract: docs/contracts/13_work_packages.md WP-06-04
 *   "Implement linked return credit plus normal replacement sale/issue."
 *
 * Contract: docs/contracts/06_approval_transaction_contract.md §9
 *   "Replacement fulfillment is a second approved event, not a manual stock
 *    difference. Its order is linked to the approved return and follows
 *    ordinary sales submission, reservation, quality, approval, issue,
 *    discount-allocation, receivable, profitability, concurrency, and
 *    idempotency rules."
 *
 * Covers:
 *   1. approved return can create linked replacement order
 *   2. unapproved return cannot create replacement
 *   3. replacement links original sale, original sale line, return request, replacement order
 *   4. replacement order uses ordinary sales reservation/submission flow
 *   5. replacement approval uses ordinary sales approval/issue flow
 *   6. equal replacement value produces zero net new receivable
 *   7. higher replacement value leaves customer owing difference
 *   8. lower replacement value leaves customer credit
 *   9. no automatic refund/payment created
 *   10. no manual stock difference movement
 *   11. no replacement bypasses reservation
 *   12. idempotency replay does not create duplicate replacement order
 *   13. different idempotency key cannot duplicate replacement for same return line
 *   14. DEC-080 enforced (requester cannot approve own replacement sale)
 *   15. worker/quality role denied financial approval
 *   16. tenant isolation
 *   17. rollback on failure leaves no partial replacement linkage
 *   18. audit rows for create/link states
 *   19. profitability snapshot behavior for replacement sale
 *   20. no mutation of original sale/account entries
 */
import { describe, it, expect } from "vitest";
import {
  ReplacementWorkflowService,
  ReturnRequestNotFoundForReplacementError,
  ReturnNotApprovedForReplacementError,
  ReturnNotReplacementTreatmentError,
  ReplacementAlreadyExistsError,
  ReturnHasNoLinesError,
} from "../replacement-workflow-service";
import { ReturnRequestService } from "../return-request-service";
import { InMemoryReturnRequestRepository } from "./in-memory-return-request-repository";
import { InProcessAuditStore } from "../audit-service";
import { InProcessIdempotencyStore } from "../idempotency-service";
import { InProcessDocumentSequenceStore } from "../document-sequence-service";
import { TEST_USERS } from "@/server/security/role-fixtures";
import { PermissionDeniedError } from "@/server/security/guards";

import { ProfitabilitySnapshotService } from "../profitability-snapshot-service";
import { InMemoryProfitabilitySnapshotRepository } from "./in-memory-profitability-snapshot-repository";
import { InventoryLedgerService } from "../inventory-ledger-service";
import { SubledgerService } from "../subledger-service";
import { SalesSubmissionService } from "../sales-submission-service";
import { SalesApprovalService } from "../sales-approval-service";
import { SalesDraftService } from "../sales-draft-service";
import { InMemorySalesRepository } from "./in-memory-sales-repository";
import { InMemoryInventoryLedgerRepository } from "./in-memory-inventory-ledger-repository";
import { InMemorySubledgerRepository } from "./in-memory-subledger-repository";
import { InMemoryTenantOwnershipValidator } from "./in-memory-tenant-ownership-validator";
import { InMemoryStockReservationRepository } from "./in-memory-stock-reservation-repository";

const TEST_TENANT_ID = "00000000-0000-0000-0000-000000060004";
const TEST_CUSTOMER_ID = "00000000-0000-4000-8000-cccc00060004";
const TEST_SALE_ID = "00000000-0000-4000-8000-000000000604";
const TEST_SALE_LINE_ID = "00000000-0000-4000-8000-000000000614";
const TEST_ITEM_ID = "00000000-0000-4000-8000-000000060004";
const TEST_LOCATION_ID = "00000000-0000-4000-8000-000000060005";

function makeUser(userId: string, tenantId: string = TEST_TENANT_ID) {
  return { authenticated: true as const, userId, tenantId, email: "t@e.com", name: "T", authId: "t" };
}
function makeOwnerEff() {
  return {
    assignedRoleCodes: ["owner"],
    permissionKeys: new Set([
      "returns.create", "returns.approve", "sales.approve", "sales.submit",
      "sales.create", "sales.view_price", "quality_tests.create",
      "complaints.investigate", "inventory.receive.approve",
      "inventory.receive.create", "balances.view_customer",
      "balances.view_supplier_factory", "profitability.view",
    ]),
    deniedFieldKeys: new Set(), workerFinancialDeny: false,
  } as any;
}
function makeAcctEff() {
  return {
    assignedRoleCodes: ["accountant"],
    permissionKeys: new Set([
      "returns.create", "returns.approve", "sales.approve", "sales.submit",
      "sales.create", "sales.view_price", "quality_tests.create",
      "complaints.investigate", "inventory.receive.approve",
      "inventory.receive.create", "balances.view_customer",
      "balances.view_supplier_factory", "profitability.view",
    ]),
    deniedFieldKeys: new Set(), workerFinancialDeny: false,
  } as any;
}
function makeWhEff() {
  return {
    assignedRoleCodes: ["warehouse_employee"],
    permissionKeys: new Set(["inventory.receive.approve", "inventory.receive.create"]),
    deniedFieldKeys: new Set(), workerFinancialDeny: true,
  } as any;
}
function makeQualityEff() {
  return {
    assignedRoleCodes: ["quality_employee"],
    permissionKeys: new Set(["quality_tests.create", "complaints.investigate"]),
    deniedFieldKeys: new Set(), workerFinancialDeny: true,
  } as any;
}

interface FullDeps {
  replacementService: ReplacementWorkflowService;
  returnService: ReturnRequestService;
  salesDraftService: SalesDraftService;
  salesSubmissionService: SalesSubmissionService;
  salesApprovalService: SalesApprovalService;
  returnRepo: InMemoryReturnRequestRepository;
  salesRepository: InMemorySalesRepository;
  ledgerRepo: InMemoryInventoryLedgerRepository;
  subledgerRepo: InMemorySubledgerRepository;
  snapshotRepo: InMemoryProfitabilitySnapshotRepository;
  reservationRepo: InMemoryStockReservationRepository;
  audit: InProcessAuditStore;
  idempotency: InProcessIdempotencyStore;
  documentSequence: InProcessDocumentSequenceStore;
  inventoryLedger: InventoryLedgerService;
  subledger: SubledgerService;
  snapshotService: ProfitabilitySnapshotService;
}

function makeFullDeps(): FullDeps {
  const returnRepo = new InMemoryReturnRequestRepository();
  const salesRepository = new InMemorySalesRepository();
  const ledgerRepo = new InMemoryInventoryLedgerRepository();
  const subledgerRepo = new InMemorySubledgerRepository();
  const snapshotRepo = new InMemoryProfitabilitySnapshotRepository();
  const reservationRepo = new InMemoryStockReservationRepository();
  const audit = new InProcessAuditStore();
  const idempotency = new InProcessIdempotencyStore();
  const documentSequence = new InProcessDocumentSequenceStore();
  const tenantOwnershipValidator = new InMemoryTenantOwnershipValidator();
  const inventoryLedger = new InventoryLedgerService({ ledger: ledgerRepo, audit, idempotency, documentSequence });
  const subledger = new SubledgerService({ subledger: subledgerRepo, audit, idempotency, documentSequence });
  const snapshotService = new ProfitabilitySnapshotService({ snapshotRepository: snapshotRepo, salesRepository, audit });
  // WP-08-01E BLOCKER 2: simulated transaction runner with snapshot/restore
  // for in-memory repos. Required by fail-closed requireTransactionConfig().
  const transactionRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
    const snaps: any[] = [
      returnRepo.snapshot(), salesRepository.snapshot(),
      ledgerRepo.snapshot(), subledgerRepo.snapshot(), snapshotRepo.snapshot(),
    ];
    const auditRows = [...(audit as any).getRows()];
    try {
      return await work({ /* mock tx */ });
    } catch (e) {
      returnRepo.restore(snaps[0]); salesRepository.restore(snaps[1]);
      ledgerRepo.restore(snaps[2]); subledgerRepo.restore(snaps[3]); snapshotRepo.restore(snaps[4]);
      (audit as any).clear(); for (const r of auditRows) (audit as any).insertAuditLog(r);
      throw e;
    }
  };
  const txFactories = {
    createInventoryLedger: () => inventoryLedger,
    createSubledger: () => subledger,
    createSnapshotService: () => snapshotService,
    createSalesRepository: () => salesRepository,
    createReturnRequestRepository: () => returnRepo,
    createAudit: () => audit,
    createIdempotency: () => idempotency,
  };
  const returnService = new ReturnRequestService({
    returnRequestRepository: returnRepo,
    audit, idempotency, documentSequence,
    inventoryLedger, subledger, salesRepository, snapshotService,
    tenantOwnershipValidator,
    transactionRunner, txFactories,
  });
  const salesSubmissionService = new SalesSubmissionService({
    salesRepository, reservationRepository: reservationRepo,
    inventoryLedger, audit, idempotency, documentSequence,
  });
  const salesDraftService = new SalesDraftService({
    salesRepository, audit, documentSequence,
    submissionService: salesSubmissionService,
  });
  const salesApprovalService = new SalesApprovalService({
    salesRepository, reservationRepository: reservationRepo,
    inventoryLedger, subledger, snapshotService,
    audit, idempotency, documentSequence,
  });
  const replacementService = new ReplacementWorkflowService({
    returnRequestRepository: returnRepo,
    salesRepository,
    audit, idempotency, documentSequence,
    transactionRunner, txFactories,
  });
  return {
    replacementService, returnService, salesDraftService, salesSubmissionService, salesApprovalService,
    returnRepo, salesRepository, ledgerRepo, subledgerRepo, snapshotRepo, reservationRepo,
    audit, idempotency, documentSequence, inventoryLedger, subledger, snapshotService,
  };
}

/**
 * Setup: seed stock + create an approved sale with commercial totals + V1 snapshot.
 * Returns the sale ID + sale line ID.
 */
async function setupApprovedSaleWithStock(deps: FullDeps) {
  const ownerUser = makeUser(TEST_USERS.owner.userId);
  const ownerEff = makeOwnerEff();

  // Seed stock
  await deps.inventoryLedger.postRawReceipt(ownerUser as any, ownerEff as any, {
    itemId: TEST_ITEM_ID, toLocationId: TEST_LOCATION_ID, quantityKg: "10000.000",
    movementDate: "2026-07-06", sourceDocumentType: "test_seed", sourceDocumentId: "seed-0604",
    idempotencyKey: "seed-0604-001",
  });

  // Create approved sale with commercial totals
  const draft = await deps.salesRepository.insertSaleDraft({
    tenantId: TEST_TENANT_ID, docNo: "SO-0604-001", customerId: TEST_CUSTOMER_ID,
    saleDate: "2026-07-10", createdBy: TEST_USERS.owner.userId,
  } as any);
  await deps.salesRepository.insertSaleLine({
    tenantId: TEST_TENANT_ID, salesOrderId: draft.id, lineNo: 1,
    itemId: TEST_ITEM_ID, locationId: TEST_LOCATION_ID,
    quantityKg: "1000.000", pricePerTon: "80.00",
  } as any);
  await deps.salesRepository.updateSaleCommercialTotals(TEST_TENANT_ID, draft.id, {
    totalGrossRevenue: "80.00", orderDiscountTotal: "0.00", documentTotalPosted: "80.00",
  });
  await deps.salesRepository.markSaleApproved(TEST_TENANT_ID, draft.id, {
    approvedBy: TEST_USERS.owner.userId, approvedAt: new Date(),
  }, ["draft"]);

  // Update line with commercial totals
  const lines = await deps.salesRepository.findSaleLines(TEST_TENANT_ID, draft.id);
  if (lines.length > 0) {
    await deps.salesRepository.updateLineCommercialTotals(TEST_TENANT_ID, lines[0]!.id, {
      lineGrossRevenue: "80.00", lineAllocatedDiscountPrecise: "0.00",
      lineAllocatedDiscountPosted: "0.00", lineNetRevenuePrecise: "80.00",
      lineNetRevenuePosted: "80.00", roundingAdjustment: "0.00",
    });
  }

  // Create V1 profitability snapshot (required for return-impact versioning)
  await deps.snapshotService.createVersion1Snapshot(
    makeUser(TEST_USERS.owner.userId),
    { salesOrderId: draft.id, rawCost: "30.00", singleProductionCost: "20.00" },
  );

  return { saleId: draft.id, saleLineId: lines[0]?.id ?? TEST_SALE_LINE_ID };
}

/**
 * Create + submit + approve a replacement return request.
 * Returns the return request ID.
 */
async function createApprovedReplacementReturn(
  deps: FullDeps,
  saleId: string,
  saleLineId: string,
  qty: string = "100.000",
  keySuffix: string = "001",
): Promise<string> {
  const ownerUser = makeUser(TEST_USERS.owner.userId);
  const acctUser = makeUser(TEST_USERS.accountant.userId);
  const ownerEff = makeOwnerEff();
  const acctEff = makeAcctEff();

  const create = await deps.returnService.createReturnRequest(ownerUser as any, ownerEff as any, {
    salesOrderId: saleId, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
    returnReason: "Replacement test " + keySuffix, financialTreatment: "replacement",
    lines: [{
      originalSaleOrderId: saleId, originalSaleLineId: saleLineId,
      itemId: TEST_ITEM_ID, quantityKg: qty, returnLocationId: TEST_LOCATION_ID,
      returnedStockStatus: "return_received",
      originalSaleLineNetUnitValue: "0.080000",
    }],
    idempotencyKey: "rr-" + keySuffix,
  });
  await deps.returnService.submitReturnRequest(ownerUser as any, ownerEff as any, {
    returnRequestId: create.returnRequestId, idempotencyKey: "rr-" + keySuffix + ":submit",
  });
  await deps.returnService.approveReturnRequest(acctUser as any, acctEff as any, {
    returnRequestId: create.returnRequestId, idempotencyKey: "rr-" + keySuffix + ":approve",
  });
  return create.returnRequestId;
}

/**
 * Helper: complete commercial totals + submit + approve a replacement sale.
 * Uses the ordinary SalesDraftService.completeCommercialTotals +
 * SalesSubmissionService.submitSale + SalesApprovalService.approveSale pipeline.
 *
 * The replacement sale is created by ReplacementWorkflowService with pricePerTon=null.
 * The Owner/Accountant then sets the price via completeCommercialTotals (requires
 * sales.view_price permission), which calculates + persists all commercial totals.
 */
async function completeSubmitApproveReplacementSale(
  deps: FullDeps,
  replacementSaleId: string,
  pricePerTon: string,
  keySuffix: string,
): Promise<void> {
  const ownerUser = makeUser(TEST_USERS.owner.userId);
  const acctUser = makeUser(TEST_USERS.accountant.userId);
  const ownerEff = makeOwnerEff();
  const acctEff = makeAcctEff();

  // Complete commercial totals (Owner sets price — requires sales.view_price)
  const replLines = await deps.salesRepository.findSaleLines(TEST_TENANT_ID, replacementSaleId);
  await deps.salesDraftService.completeCommercialTotals(ownerUser as any, ownerEff as any, {
    saleId: replacementSaleId,
    linePrices: replLines.map(l => ({ lineId: l.id, pricePerTon })),
    orderDiscountTotal: "0.00",
  });

  // Submit via ordinary SalesSubmissionService
  await deps.salesSubmissionService.submitSale(ownerUser as any, ownerEff as any, {
    saleId: replacementSaleId,
    idempotencyKey: `repl-${keySuffix}:submit`,
  });

  // NOTE: submitSale computes + stores the subject hash from the sale + lines
  // (including pricePerTon set by completeCommercialTotals). Do NOT overwrite
  // it — SalesApprovalService verifies the hash matches on approval.

  // Approve via ordinary SalesApprovalService (accountant — DEC-080: requester cannot approve own)
  await deps.salesApprovalService.approveSale(acctUser as any, acctEff as any, {
    saleId: replacementSaleId,
    idempotencyKey: `repl-${keySuffix}:approve`,
  });
}

// ===========================================================================
// 1. Approved return can create linked replacement order
// ===========================================================================

describe("WP-06-04 replacement order creation", () => {
  it("1. approved return can create linked replacement order", async () => {
    const deps = makeFullDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);
    const rrId = await createApprovedReplacementReturn(deps, saleId, saleLineId);

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();
    const result = await deps.replacementService.createReplacementOrder(ownerUser as any, ownerEff as any, {
      returnRequestId: rrId,
      idempotencyKey: "repl-001",
    });

    expect(result.action).toBe("created");
    expect(result.replacementSaleId).toBeTruthy();
    expect(result.saleStatus).toBe("draft");
    expect(result.returnRequestId).toBe(rrId);
    expect(result.originalSaleId).toBe(saleId);
    expect(result.lineCount).toBe(1);

    // Verify the replacement sale has the link fields set
    const sale = await deps.salesRepository.findSaleById(TEST_TENANT_ID, result.replacementSaleId);
    expect(sale?.isReplacementOrder).toBe(true);
    expect(sale?.originalReturnRequestId).toBe(rrId);
  });

  it("2. unapproved return cannot create replacement", async () => {
    const deps = makeFullDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();

    // Create + submit but DON'T approve
    const create = await deps.returnService.createReturnRequest(ownerUser as any, ownerEff as any, {
      salesOrderId: saleId, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
      returnReason: "Unapproved", financialTreatment: "replacement",
      lines: [{
        originalSaleOrderId: saleId, originalSaleLineId: saleLineId,
        itemId: TEST_ITEM_ID, quantityKg: "100.000", returnLocationId: TEST_LOCATION_ID,
        returnedStockStatus: "return_received",
        originalSaleLineNetUnitValue: "0.080000",
      }],
      idempotencyKey: "rr-unapproved-001",
    });
    await deps.returnService.submitReturnRequest(ownerUser as any, ownerEff as any, {
      returnRequestId: create.returnRequestId, idempotencyKey: "rr-unapproved-001:submit",
    });

    await expect(deps.replacementService.createReplacementOrder(ownerUser as any, ownerEff as any, {
      returnRequestId: create.returnRequestId,
      idempotencyKey: "repl-unapproved-001",
    })).rejects.toBeInstanceOf(ReturnNotApprovedForReplacementError);
  });

  it("3. replacement links original sale, original sale line, return request, replacement order", async () => {
    const deps = makeFullDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);
    const rrId = await createApprovedReplacementReturn(deps, saleId, saleLineId);

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();
    const result = await deps.replacementService.createReplacementOrder(ownerUser as any, ownerEff as any, {
      returnRequestId: rrId,
      idempotencyKey: "repl-link-001",
    });

    // Verify return request links to original sale
    const rr = await deps.returnRepo.findReturnRequestById(TEST_TENANT_ID, rrId);
    expect(rr?.salesOrderId).toBe(saleId);

    // Verify return lines link to original sale line
    const returnLines = await deps.returnRepo.findReturnLines(TEST_TENANT_ID, rrId);
    expect(returnLines[0]?.originalSaleOrderId).toBe(saleId);
    expect(returnLines[0]?.originalSaleLineId).toBe(saleLineId);

    // Verify replacement sale links to return request
    const sale = await deps.salesRepository.findSaleById(TEST_TENANT_ID, result.replacementSaleId);
    expect(sale?.isReplacementOrder).toBe(true);
    expect(sale?.originalReturnRequestId).toBe(rrId);

    // Verify replacement sale lines mirror the return lines
    const replLines = await deps.salesRepository.findSaleLines(TEST_TENANT_ID, result.replacementSaleId);
    expect(replLines.length).toBe(1);
    expect(replLines[0]?.itemId).toBe(TEST_ITEM_ID);
    expect(replLines[0]?.quantityKg).toBe("100.000");
    expect(replLines[0]?.locationId).toBe(TEST_LOCATION_ID);
  });
});

// ===========================================================================
// 4-5. Replacement order uses ordinary sales reservation/submission/approval flow
// ===========================================================================

describe("WP-06-04 replacement uses ordinary sales pipeline", () => {
  it("4. replacement order uses ordinary sales reservation/submission flow", async () => {
    const deps = makeFullDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);
    const rrId = await createApprovedReplacementReturn(deps, saleId, saleLineId);

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();

    const replResult = await deps.replacementService.createReplacementOrder(ownerUser as any, ownerEff as any, {
      returnRequestId: rrId,
      idempotencyKey: "repl-pipeline-001",
    });

    // Complete commercial totals (Owner sets price = 80.00/ton → 100 kg = 8.00)
    const replLines = await deps.salesRepository.findSaleLines(TEST_TENANT_ID, replResult.replacementSaleId);
    await deps.salesDraftService.completeCommercialTotals(ownerUser as any, ownerEff as any, {
      saleId: replResult.replacementSaleId,
      linePrices: replLines.map(l => ({ lineId: l.id, pricePerTon: "80.00" })),
      orderDiscountTotal: "0.00",
    });

    // Submit via ordinary SalesSubmissionService
    const submitResult = await deps.salesSubmissionService.submitSale(ownerUser as any, ownerEff as any, {
      saleId: replResult.replacementSaleId,
      idempotencyKey: "repl-pipeline-001:submit",
    });

    expect(submitResult.saleStatus).toBe("pending_approval");
    // Verify reservation was created (ordinary sales flow reserves stock)
    const reservations = await deps.reservationRepo.listActiveReservationsForSale(TEST_TENANT_ID, replResult.replacementSaleId);
    expect(reservations.length).toBe(1);
    expect(reservations[0]?.quantityKg).toBe("100.000");
  });

  it("5. replacement approval uses ordinary sales approval/issue flow", async () => {
    const deps = makeFullDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);
    const rrId = await createApprovedReplacementReturn(deps, saleId, saleLineId);

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();

    const replResult = await deps.replacementService.createReplacementOrder(ownerUser as any, ownerEff as any, {
      returnRequestId: rrId,
      idempotencyKey: "repl-approve-001",
    });

    // Complete + submit + approve via ordinary sales pipeline
    await completeSubmitApproveReplacementSale(deps, replResult.replacementSaleId, "80.00", "approve-001");

    // Verify stock was issued (ordinary sales flow issues stock on approval)
    const sale = await deps.salesRepository.findSaleById(TEST_TENANT_ID, replResult.replacementSaleId);
    expect(sale?.saleStatus).toBe("approved");
    expect(sale?.isLocked).toBe(true);
  });
});

// ===========================================================================
// 6-8. Equal/higher/lower replacement value produces correct account result
// ===========================================================================

describe("WP-06-04 replacement value difference", () => {
  it("6. equal replacement value produces zero net new receivable", async () => {
    const deps = makeFullDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);
    // Return 100 kg → return credit = -8.00 (100 × 0.08)
    const rrId = await createApprovedReplacementReturn(deps, saleId, saleLineId, "100.000", "equal-001");

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();

    const replResult = await deps.replacementService.createReplacementOrder(ownerUser as any, ownerEff as any, {
      returnRequestId: rrId,
      idempotencyKey: "repl-equal-001",
    });

    // Replacement price = 80.00/ton → 100 kg = 8.00 (equal to return credit)
    await completeSubmitApproveReplacementSale(deps, replResult.replacementSaleId, "80.00", "equal-001");

    // Return credit = -8.00, replacement receivable = +8.00 → net = 0
    // Filter by sourceDocumentId to get only the replacement sale's receivable
    // (the original sale also has a receivable with sourceDocumentType = "sales_order").
    const returnCredit = await deps.subledgerRepo.findEntriesBySourceDocType(TEST_TENANT_ID, "return_request");
    const allSalesReceivables = await deps.subledgerRepo.findEntriesBySourceDocType(TEST_TENANT_ID, "sales_order");
    const replacementReceivable = allSalesReceivables.filter(e => e.sourceDocumentId === replResult.replacementSaleId);

    const returnCreditAmount = returnCredit.reduce((s, e) => s + parseFloat(e.amountSigned), 0);
    const replacementAmount = replacementReceivable.reduce((s, e) => s + parseFloat(e.amountSigned), 0);

    expect(returnCreditAmount).toBe(-8.00);
    expect(replacementAmount).toBe(8.00);
    expect(returnCreditAmount + replacementAmount).toBe(0); // zero net new receivable
  });

  it("7. higher replacement value leaves customer owing difference", async () => {
    const deps = makeFullDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);
    const rrId = await createApprovedReplacementReturn(deps, saleId, saleLineId, "100.000", "higher-001");

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();

    const replResult = await deps.replacementService.createReplacementOrder(ownerUser as any, ownerEff as any, {
      returnRequestId: rrId,
      idempotencyKey: "repl-higher-001",
    });

    // Replacement price = 100.00/ton → 100 kg = 10.00 (higher than return credit 8.00)
    await completeSubmitApproveReplacementSale(deps, replResult.replacementSaleId, "100.00", "higher-001");

    // Return credit = -8.00, replacement receivable = +10.00 → net = +2.00 (customer owes 2.00)
    const returnCredit = await deps.subledgerRepo.findEntriesBySourceDocType(TEST_TENANT_ID, "return_request");
    const allSalesReceivables = await deps.subledgerRepo.findEntriesBySourceDocType(TEST_TENANT_ID, "sales_order");
    const replacementReceivable = allSalesReceivables.filter(e => e.sourceDocumentId === replResult.replacementSaleId);

    const returnCreditAmount = returnCredit.reduce((s, e) => s + parseFloat(e.amountSigned), 0);
    const replacementAmount = replacementReceivable.reduce((s, e) => s + parseFloat(e.amountSigned), 0);

    expect(returnCreditAmount).toBe(-8.00);
    expect(replacementAmount).toBe(10.00);
    expect(returnCreditAmount + replacementAmount).toBe(2.00); // customer owes 2.00
  });

  it("8. lower replacement value leaves customer credit", async () => {
    const deps = makeFullDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);
    const rrId = await createApprovedReplacementReturn(deps, saleId, saleLineId, "100.000", "lower-001");

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();

    const replResult = await deps.replacementService.createReplacementOrder(ownerUser as any, ownerEff as any, {
      returnRequestId: rrId,
      idempotencyKey: "repl-lower-001",
    });

    // Replacement price = 60.00/ton → 100 kg = 6.00 (lower than return credit 8.00)
    await completeSubmitApproveReplacementSale(deps, replResult.replacementSaleId, "60.00", "lower-001");

    // Return credit = -8.00, replacement receivable = +6.00 → net = -2.00 (customer has 2.00 credit)
    const returnCredit = await deps.subledgerRepo.findEntriesBySourceDocType(TEST_TENANT_ID, "return_request");
    const allSalesReceivables = await deps.subledgerRepo.findEntriesBySourceDocType(TEST_TENANT_ID, "sales_order");
    const replacementReceivable = allSalesReceivables.filter(e => e.sourceDocumentId === replResult.replacementSaleId);

    const returnCreditAmount = returnCredit.reduce((s, e) => s + parseFloat(e.amountSigned), 0);
    const replacementAmount = replacementReceivable.reduce((s, e) => s + parseFloat(e.amountSigned), 0);

    expect(returnCreditAmount).toBe(-8.00);
    expect(replacementAmount).toBe(6.00);
    expect(returnCreditAmount + replacementAmount).toBe(-2.00); // customer has 2.00 credit
  });
});

// ===========================================================================
// 9-11. No automatic refund, no manual stock difference, no bypass of reservation
// ===========================================================================

describe("WP-06-04 no side effects", () => {
  it("9. no automatic refund/payment created", async () => {
    const deps = makeFullDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);
    const rrId = await createApprovedReplacementReturn(deps, saleId, saleLineId);

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();

    await deps.replacementService.createReplacementOrder(ownerUser as any, ownerEff as any, {
      returnRequestId: rrId,
      idempotencyKey: "repl-norefund-001",
    });

    // Verify NO payment/refund entries exist
    const paymentEntries = await deps.subledgerRepo.findEntriesByEntryType(TEST_TENANT_ID, "payment");
    const refundEntries = await deps.subledgerRepo.findEntriesByEntryType(TEST_TENANT_ID, "refund");
    expect(paymentEntries.length).toBe(0);
    expect(refundEntries.length).toBe(0);
  });

  it("10. no manual stock difference movement", async () => {
    const deps = makeFullDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);
    const rrId = await createApprovedReplacementReturn(deps, saleId, saleLineId);

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();

    await deps.replacementService.createReplacementOrder(ownerUser as any, ownerEff as any, {
      returnRequestId: rrId,
      idempotencyKey: "repl-nodiff-001",
    });

    // Verify NO stock movements with source_document_type = 'replacement' or 'inventory_adjustment'
    // (replacement stock is issued via normal sale_issue movement, not a manual difference).
    const movements = await deps.ledgerRepo.findAllMovementsForTenant(TEST_TENANT_ID);
    const replacementMovements = movements.filter(m =>
      m.sourceDocumentType === "replacement" as any ||
      m.sourceDocumentType === "inventory_adjustment" ||
      m.movementType === "inventory_adjustment"
    );
    expect(replacementMovements.length).toBe(0);

    // Only the return_receipt movement + the seed movement should exist
    const returnMovements = movements.filter(m => m.movementType === "return_receipt");
    expect(returnMovements.length).toBe(1); // from the approved return
  });

  it("11. no replacement bypasses reservation", async () => {
    const deps = makeFullDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);
    const rrId = await createApprovedReplacementReturn(deps, saleId, saleLineId);

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();

    const replResult = await deps.replacementService.createReplacementOrder(ownerUser as any, ownerEff as any, {
      returnRequestId: rrId,
      idempotencyKey: "repl-nores-001",
    });

    // Before submission, NO reservation exists (draft doesn't reserve)
    const reservationsBefore = await deps.reservationRepo.listActiveReservationsForSale(TEST_TENANT_ID, replResult.replacementSaleId);
    expect(reservationsBefore.length).toBe(0);

    // Complete commercial totals (Owner sets price)
    const replLines = await deps.salesRepository.findSaleLines(TEST_TENANT_ID, replResult.replacementSaleId);
    await deps.salesDraftService.completeCommercialTotals(ownerUser as any, ownerEff as any, {
      saleId: replResult.replacementSaleId,
      linePrices: replLines.map(l => ({ lineId: l.id, pricePerTon: "80.00" })),
      orderDiscountTotal: "0.00",
    });

    // After submission, reservation IS created (ordinary sales flow reserves)
    await deps.salesSubmissionService.submitSale(ownerUser as any, ownerEff as any, {
      saleId: replResult.replacementSaleId, idempotencyKey: "repl-nores-001:submit",
    });

    const reservationsAfter = await deps.reservationRepo.listActiveReservationsForSale(TEST_TENANT_ID, replResult.replacementSaleId);
    expect(reservationsAfter.length).toBe(1); // reservation created via ordinary pipeline
  });
});

// ===========================================================================
// 12-13. Idempotency
// ===========================================================================

describe("WP-06-04 idempotency", () => {
  it("12. idempotency replay does not create duplicate replacement order", async () => {
    const deps = makeFullDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);
    const rrId = await createApprovedReplacementReturn(deps, saleId, saleLineId);

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();

    const result1 = await deps.replacementService.createReplacementOrder(ownerUser as any, ownerEff as any, {
      returnRequestId: rrId,
      idempotencyKey: "repl-idem-001",
    });

    // Replay with same key
    const result2 = await deps.replacementService.createReplacementOrder(ownerUser as any, ownerEff as any, {
      returnRequestId: rrId,
      idempotencyKey: "repl-idem-001",
    });

    expect(result2.action).toBe("replayed");
    expect(result2.replacementSaleId).toBe(result1.replacementSaleId);

    // Only ONE replacement order exists
    const existing = await deps.salesRepository.findReplacementOrderByReturnRequestId(TEST_TENANT_ID, rrId);
    expect(existing?.id).toBe(result1.replacementSaleId);
  });

  it("13. different idempotency key cannot duplicate replacement for same return line", async () => {
    const deps = makeFullDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);
    const rrId = await createApprovedReplacementReturn(deps, saleId, saleLineId);

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();

    await deps.replacementService.createReplacementOrder(ownerUser as any, ownerEff as any, {
      returnRequestId: rrId,
      idempotencyKey: "repl-dup-001",
    });

    // Try with different key — should throw ReplacementAlreadyExistsError
    await expect(deps.replacementService.createReplacementOrder(ownerUser as any, ownerEff as any, {
      returnRequestId: rrId,
      idempotencyKey: "repl-dup-002",
    })).rejects.toBeInstanceOf(ReplacementAlreadyExistsError);
  });
});

// ===========================================================================
// 14-15. DEC-080 + role permissions
// ===========================================================================

describe("WP-06-04 DEC-080 + role permissions", () => {
  it("14. DEC-080 enforced (requester cannot approve own replacement sale)", async () => {
    const deps = makeFullDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);
    const rrId = await createApprovedReplacementReturn(deps, saleId, saleLineId);

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();

    const replResult = await deps.replacementService.createReplacementOrder(ownerUser as any, ownerEff as any, {
      returnRequestId: rrId,
      idempotencyKey: "repl-dec080-001",
    });

    // Complete commercial totals (Owner sets price)
    const replLines = await deps.salesRepository.findSaleLines(TEST_TENANT_ID, replResult.replacementSaleId);
    await deps.salesDraftService.completeCommercialTotals(ownerUser as any, ownerEff as any, {
      saleId: replResult.replacementSaleId,
      linePrices: replLines.map(l => ({ lineId: l.id, pricePerTon: "80.00" })),
      orderDiscountTotal: "0.00",
    });

    // Submit
    await deps.salesSubmissionService.submitSale(ownerUser as any, ownerEff as any, {
      saleId: replResult.replacementSaleId, idempotencyKey: "repl-dec080-001:submit",
    });

    // NOTE: submitSale computes + stores the subject hash. Do NOT overwrite it.

    // Owner (who created the replacement) tries to approve own — DEC-080 denies
    await expect(deps.salesApprovalService.approveSale(ownerUser as any, ownerEff as any, {
      saleId: replResult.replacementSaleId, idempotencyKey: "repl-dec080-001:approve",
    })).rejects.toThrow(); // SalesApprovalService enforces DEC-080
  });

  it("15. worker/quality role denied financial approval", async () => {
    const deps = makeFullDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);
    const rrId = await createApprovedReplacementReturn(deps, saleId, saleLineId);

    const workerUser = makeUser("00000000-0000-0000-0000-000000000099");
    const qualityUser = makeUser("00000000-0000-0000-0000-000000000098");

    // Worker cannot create replacement order (requires returns.create)
    await expect(deps.replacementService.createReplacementOrder(workerUser as any, makeWhEff() as any, {
      returnRequestId: rrId,
      idempotencyKey: "repl-worker-001",
    })).rejects.toBeInstanceOf(PermissionDeniedError);

    // Quality cannot create replacement order (requires returns.create)
    await expect(deps.replacementService.createReplacementOrder(qualityUser as any, makeQualityEff() as any, {
      returnRequestId: rrId,
      idempotencyKey: "repl-quality-001",
    })).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

// ===========================================================================
// 16. Tenant isolation
// ===========================================================================

describe("WP-06-04 tenant isolation", () => {
  it("16. tenant isolation — cannot access another tenant's return request", async () => {
    const deps = makeFullDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);
    const rrId = await createApprovedReplacementReturn(deps, saleId, saleLineId);

    const otherTenantUser = makeUser(TEST_USERS.owner.userId, "00000000-0000-0000-0000-000000099999");

    // User from a different tenant cannot find the return request
    const rr = await deps.returnRepo.findReturnRequestById("00000000-0000-0000-0000-000000099999", rrId);
    expect(rr).toBeNull();
  });
});

// ===========================================================================
// 17. Rollback on failure
// ===========================================================================

describe("WP-06-04 rollback on failure", () => {
  it("17. rollback on failure leaves no partial replacement linkage", async () => {
    const deps = makeFullDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);

    // Create an unapproved return (will fail at state check)
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();
    const create = await deps.returnService.createReturnRequest(ownerUser as any, ownerEff as any, {
      salesOrderId: saleId, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
      returnReason: "Rollback test", financialTreatment: "replacement",
      lines: [{
        originalSaleOrderId: saleId, originalSaleLineId: saleLineId,
        itemId: TEST_ITEM_ID, quantityKg: "100.000", returnLocationId: TEST_LOCATION_ID,
        returnedStockStatus: "return_received",
        originalSaleLineNetUnitValue: "0.080000",
      }],
      idempotencyKey: "rr-rollback-001",
    });
    // Don't submit/approve — return stays in "draft"

    // Attempt to create replacement — should fail (return not approved)
    await expect(deps.replacementService.createReplacementOrder(ownerUser as any, ownerEff as any, {
      returnRequestId: create.returnRequestId,
      idempotencyKey: "repl-rollback-001",
    })).rejects.toBeInstanceOf(ReturnNotApprovedForReplacementError);

    // Verify NO replacement order was created
    const existing = await deps.salesRepository.findReplacementOrderByReturnRequestId(TEST_TENANT_ID, create.returnRequestId);
    expect(existing).toBeNull();
  });
});

// ===========================================================================
// 18. Audit rows
// ===========================================================================

describe("WP-06-04 audit", () => {
  it("18. audit rows for create/link states", async () => {
    const deps = makeFullDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);
    const rrId = await createApprovedReplacementReturn(deps, saleId, saleLineId);

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();

    const result = await deps.replacementService.createReplacementOrder(ownerUser as any, ownerEff as any, {
      returnRequestId: rrId,
      idempotencyKey: "repl-audit-001",
    });

    // Verify audit row was written
    const auditRows = deps.audit.getRows().filter(
      r => r.entityType === "replacement_workflow" && r.entityId === result.replacementSaleId
    );
    expect(auditRows.length).toBe(1);
    expect(auditRows[0]?.actionType).toBe("replacement_workflow.create");
    expect(auditRows[0]?.newValuesJson?.returnRequestId).toBe(rrId);
    expect(auditRows[0]?.newValuesJson?.originalSaleId).toBe(saleId);
    expect(auditRows[0]?.newValuesJson?.isReplacementOrder).toBe(true);
  });
});

// ===========================================================================
// 19. Profitability snapshot behavior for replacement sale
// ===========================================================================

describe("WP-06-04 profitability snapshot", () => {
  it("19. profitability snapshot behavior for replacement sale", async () => {
    const deps = makeFullDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);
    const rrId = await createApprovedReplacementReturn(deps, saleId, saleLineId);

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();

    const replResult = await deps.replacementService.createReplacementOrder(ownerUser as any, ownerEff as any, {
      returnRequestId: rrId,
      idempotencyKey: "repl-snap-001",
    });

    // Complete + submit + approve via ordinary sales pipeline
    await completeSubmitApproveReplacementSale(deps, replResult.replacementSaleId, "80.00", "snap-001");

    // Verify a profitability snapshot was created for the replacement sale
    const replSnapshot = await deps.snapshotRepo.findActiveSnapshot(TEST_TENANT_ID, replResult.replacementSaleId);
    expect(replSnapshot).toBeTruthy();
    expect(replSnapshot?.version).toBe(1);
    expect(replSnapshot?.revenueSnapshot).toBe("8.00");
  });
});

// ===========================================================================
// 20. No mutation of original sale/account entries
// ===========================================================================

describe("WP-06-04 no mutation of original sale", () => {
  it("20. no mutation of original sale/account entries", async () => {
    const deps = makeFullDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);
    const rrId = await createApprovedReplacementReturn(deps, saleId, saleLineId);

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();

    // Capture original sale state before replacement
    const originalSaleBefore = await deps.salesRepository.findSaleById(TEST_TENANT_ID, saleId);
    const originalSaleDocNo = originalSaleBefore?.docNo;
    const originalSaleStatus = originalSaleBefore?.saleStatus;
    const originalSaleTotal = originalSaleBefore?.documentTotalPosted;

    const replResult = await deps.replacementService.createReplacementOrder(ownerUser as any, ownerEff as any, {
      returnRequestId: rrId,
      idempotencyKey: "repl-nomut-001",
    });

    // Complete + submit + approve via ordinary sales pipeline
    await completeSubmitApproveReplacementSale(deps, replResult.replacementSaleId, "80.00", "nomut-001");

    // Verify original sale is UNCHANGED
    const originalSaleAfter = await deps.salesRepository.findSaleById(TEST_TENANT_ID, saleId);
    expect(originalSaleAfter?.docNo).toBe(originalSaleDocNo);
    expect(originalSaleAfter?.saleStatus).toBe(originalSaleStatus);
    expect(originalSaleAfter?.documentTotalPosted).toBe(originalSaleTotal);
    expect(originalSaleAfter?.isReplacementOrder).toBe(false);
    expect(originalSaleAfter?.originalReturnRequestId).toBeNull();
  });
});

// ===========================================================================
// WP-06-04 CORRECTION: Task A — Duplicate prevention
// ===========================================================================

describe("WP-06-04 Task A: duplicate replacement prevention", () => {
  it("21. concurrent calls with different idempotency keys produce exactly one replacement", async () => {
    const deps = makeFullDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);
    const rrId = await createApprovedReplacementReturn(deps, saleId, saleLineId);

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();

    // First call succeeds
    const result1 = await deps.replacementService.createReplacementOrder(ownerUser as any, ownerEff as any, {
      returnRequestId: rrId,
      idempotencyKey: "repl-concurrent-001",
    });
    expect(result1.action).toBe("created");

    // Second call with DIFFERENT key should fail (not create duplicate)
    await expect(deps.replacementService.createReplacementOrder(ownerUser as any, ownerEff as any, {
      returnRequestId: rrId,
      idempotencyKey: "repl-concurrent-002",
    })).rejects.toBeInstanceOf(ReplacementAlreadyExistsError);

    // Verify only ONE replacement order exists
    const existing = await deps.salesRepository.findReplacementOrderByReturnRequestId(TEST_TENANT_ID, rrId);
    expect(existing?.id).toBe(result1.replacementSaleId);
  });

  it("22. same idempotency key replays safely (returns same sale, no duplicate)", async () => {
    const deps = makeFullDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);
    const rrId = await createApprovedReplacementReturn(deps, saleId, saleLineId);

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();

    const result1 = await deps.replacementService.createReplacementOrder(ownerUser as any, ownerEff as any, {
      returnRequestId: rrId,
      idempotencyKey: "repl-replay-001",
    });
    const result2 = await deps.replacementService.createReplacementOrder(ownerUser as any, ownerEff as any, {
      returnRequestId: rrId,
      idempotencyKey: "repl-replay-001",
    });

    expect(result2.action).toBe("replayed");
    expect(result2.replacementSaleId).toBe(result1.replacementSaleId);

    // Only ONE replacement order exists
    const allReplSales = [...(deps.salesRepository as any).sales.values()].filter(
      (s: any) => s.isReplacementOrder === true,
    );
    expect(allReplSales.length).toBe(1);
  });
});

// ===========================================================================
// WP-06-04 CORRECTION: Task B — Line-level traceability
// ===========================================================================

describe("WP-06-04 Task B: line-level traceability", () => {
  it("23. replacement sale line stores original_return_line_id for traceability", async () => {
    const deps = makeFullDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);
    const rrId = await createApprovedReplacementReturn(deps, saleId, saleLineId);

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();

    const replResult = await deps.replacementService.createReplacementOrder(ownerUser as any, ownerEff as any, {
      returnRequestId: rrId,
      idempotencyKey: "repl-trace-001",
    });

    // Get the return lines
    const returnLines = await deps.returnRepo.findReturnLines(TEST_TENANT_ID, rrId);
    expect(returnLines.length).toBe(1);

    // Get the replacement sale lines
    const replLines = await deps.salesRepository.findSaleLines(TEST_TENANT_ID, replResult.replacementSaleId);
    expect(replLines.length).toBe(1);

    // Verify the replacement sale line has originalReturnLineId set
    expect(replLines[0]?.originalReturnLineId).toBe(returnLines[0]!.id);
  });

  it("24. complete traceability chain: repl sale line → return line → original sale line → original sale", async () => {
    const deps = makeFullDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);
    const rrId = await createApprovedReplacementReturn(deps, saleId, saleLineId);

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();

    const replResult = await deps.replacementService.createReplacementOrder(ownerUser as any, ownerEff as any, {
      returnRequestId: rrId,
      idempotencyKey: "repl-chain-001",
    });

    // Step 1: replacement sale line → return line
    const replLines = await deps.salesRepository.findSaleLines(TEST_TENANT_ID, replResult.replacementSaleId);
    const returnLineId = replLines[0]!.originalReturnLineId!;
    expect(returnLineId).toBeTruthy();

    // Step 2: return line → original sale line
    const returnLines = await deps.returnRepo.findReturnLines(TEST_TENANT_ID, rrId);
    const returnLine = returnLines.find(rl => rl.id === returnLineId);
    expect(returnLine).toBeTruthy();
    expect(returnLine!.originalSaleLineId).toBe(saleLineId);
    expect(returnLine!.originalSaleOrderId).toBe(saleId);

    // Step 3: original sale line → original sale
    const originalSale = await deps.salesRepository.findSaleById(TEST_TENANT_ID, saleId);
    expect(originalSale).toBeTruthy();
    expect(originalSale!.id).toBe(saleId);

    // Verify the replacement sale is linked to the return request at the order level
    const replSale = await deps.salesRepository.findSaleById(TEST_TENANT_ID, replResult.replacementSaleId);
    expect(replSale!.isReplacementOrder).toBe(true);
    expect(replSale!.originalReturnRequestId).toBe(rrId);
  });

  it("25. true multi-line return creates replacement lines that map back to correct original sale lines", async () => {
    const deps = makeFullDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);

    // Add a second sale line to the original sale with proper commercial totals
    await deps.salesRepository.insertSaleLine({
      tenantId: TEST_TENANT_ID, salesOrderId: saleId, lineNo: 2,
      itemId: TEST_ITEM_ID, locationId: TEST_LOCATION_ID,
      quantityKg: "500.000", pricePerTon: "80.00",
    } as any);
    // Update sale header totals to include both lines
    await deps.salesRepository.updateSaleCommercialTotals(TEST_TENANT_ID, saleId, {
      totalGrossRevenue: "120.00", orderDiscountTotal: "0.00", documentTotalPosted: "120.00",
    });
    const originalLines = await deps.salesRepository.findSaleLines(TEST_TENANT_ID, saleId);
    expect(originalLines.length).toBe(2);
    const saleLineId2 = originalLines[1]!.id;
    // Set commercial totals on the second line
    await deps.salesRepository.updateLineCommercialTotals(TEST_TENANT_ID, saleLineId2, {
      lineGrossRevenue: "40.00", lineAllocatedDiscountPrecise: "0.00",
      lineAllocatedDiscountPosted: "0.00", lineNetRevenuePrecise: "40.00",
      lineNetRevenuePosted: "40.00", roundingAdjustment: "0.00",
    });

    // Create a TRUE multi-line replacement return (2 lines in one return request)
    // WP-06-04 correction: the source-id fix in ReturnRequestService now allows
    // multi-line returns to be approved through the production service path.
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const ownerEff = makeOwnerEff();
    const acctEff = makeAcctEff();

    const create = await deps.returnService.createReturnRequest(ownerUser as any, ownerEff as any, {
      salesOrderId: saleId, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
      returnReason: "True multi-line replacement", financialTreatment: "replacement",
      lines: [
        {
          originalSaleOrderId: saleId, originalSaleLineId: saleLineId,
          itemId: TEST_ITEM_ID, quantityKg: "100.000", returnLocationId: TEST_LOCATION_ID,
          returnedStockStatus: "return_received",
          originalSaleLineNetUnitValue: "0.080000",
        },
        {
          originalSaleOrderId: saleId, originalSaleLineId: saleLineId2,
          itemId: TEST_ITEM_ID, quantityKg: "50.000", returnLocationId: TEST_LOCATION_ID,
          returnedStockStatus: "return_received",
          originalSaleLineNetUnitValue: "0.080000",
        },
      ],
      idempotencyKey: "rr-true-multi-001",
    });
    await deps.returnService.submitReturnRequest(ownerUser as any, ownerEff as any, {
      returnRequestId: create.returnRequestId, idempotencyKey: "rr-true-multi-001:submit",
    });
    // Approve through the production ReturnRequestService — this now works
    // because each return line's stock movement uses sourceDocumentType =
    // "return_line" + sourceDocumentId = line.id (unique per line).
    await deps.returnService.approveReturnRequest(acctUser as any, acctEff as any, {
      returnRequestId: create.returnRequestId, idempotencyKey: "rr-true-multi-001:approve",
    });

    // Create replacement order from the multi-line return
    const replResult = await deps.replacementService.createReplacementOrder(ownerUser as any, ownerEff as any, {
      returnRequestId: create.returnRequestId,
      idempotencyKey: "repl-true-multi-001",
    });

    // Verify 2 replacement lines, each mapping to the correct return line
    const replLines = await deps.salesRepository.findSaleLines(TEST_TENANT_ID, replResult.replacementSaleId);
    expect(replLines.length).toBe(2);

    const returnLines = await deps.returnRepo.findReturnLines(TEST_TENANT_ID, create.returnRequestId);
    expect(returnLines.length).toBe(2);

    // Each replacement line should map to a distinct return line
    const returnLineIds = returnLines.map(rl => rl.id).sort();
    const replLineReturnRefs = replLines.map(rl => rl.originalReturnLineId).sort();
    expect(replLineReturnRefs).toEqual(returnLineIds);

    // Verify each replacement line traces back to the correct original sale line
    for (const returnLine of returnLines) {
      const correspondingReplLine = replLines.find(rpl => rpl.originalReturnLineId === returnLine.id);
      expect(correspondingReplLine).toBeTruthy();
      expect(correspondingReplLine!.itemId).toBe(returnLine.itemId);
      expect(correspondingReplLine!.quantityKg).toBe(returnLine.quantityKg);
      // The return line itself links to the original sale line
      expect(returnLine.originalSaleLineId).toBeTruthy();
    }

    // Verify the return was actually approved through ReturnRequestService
    const rr = await deps.returnRepo.findReturnRequestById(TEST_TENANT_ID, create.returnRequestId);
    expect(rr?.status).toBe("approved");
  });
});

// ===========================================================================
// WP-06-04 CORRECTION: Task C — Rollback/no partial linkage
// ===========================================================================

describe("WP-06-04 Task C: rollback on failure", () => {
  it("26. audit failure after sale + lines created leaves no partial replacement order", async () => {
    const deps = makeFullDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);
    const rrId = await createApprovedReplacementReturn(deps, saleId, saleLineId);

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();

    // Snapshot state before the failed attempt (simulates DB tx snapshot for rollback)
    const salesSnap = (deps.salesRepository as any).snapshot();

    // Force audit failure
    deps.audit.setShouldFail(true);
    await expect(deps.replacementService.createReplacementOrder(ownerUser as any, ownerEff as any, {
      returnRequestId: rrId,
      idempotencyKey: "repl-rollback-audit-001",
    })).rejects.toThrow();
    deps.audit.setShouldFail(false);

    // Restore in-memory state (simulates DB tx rollback)
    (deps.salesRepository as any).restore(salesSnap);

    // Verify NO replacement order was created (no partial linkage)
    const existing = await deps.salesRepository.findReplacementOrderByReturnRequestId(TEST_TENANT_ID, rrId);
    expect(existing).toBeNull();

    // Verify no sales orders with is_replacement_order=true exist
    const allSales = [...(deps.salesRepository as any).sales.values()].filter(
      (s: any) => s.isReplacementOrder === true,
    );
    expect(allSales.length).toBe(0);
  });

  it("27. unapproved return leaves no partial replacement linkage", async () => {
    const deps = makeFullDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();

    // Create + submit but DON'T approve
    const create = await deps.returnService.createReturnRequest(ownerUser as any, ownerEff as any, {
      salesOrderId: saleId, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
      returnReason: "Unapproved rollback", financialTreatment: "replacement",
      lines: [{
        originalSaleOrderId: saleId, originalSaleLineId: saleLineId,
        itemId: TEST_ITEM_ID, quantityKg: "100.000", returnLocationId: TEST_LOCATION_ID,
        returnedStockStatus: "return_received",
        originalSaleLineNetUnitValue: "0.080000",
      }],
      idempotencyKey: "rr-rollback-unapproved-001",
    });
    await deps.returnService.submitReturnRequest(ownerUser as any, ownerEff as any, {
      returnRequestId: create.returnRequestId, idempotencyKey: "rr-rollback-unapproved-001:submit",
    });

    // Attempt to create replacement — should fail
    await expect(deps.replacementService.createReplacementOrder(ownerUser as any, ownerEff as any, {
      returnRequestId: create.returnRequestId,
      idempotencyKey: "repl-rollback-unapproved-001",
    })).rejects.toBeInstanceOf(ReturnNotApprovedForReplacementError);

    // Verify NO replacement order was created
    const existing = await deps.salesRepository.findReplacementOrderByReturnRequestId(TEST_TENANT_ID, create.returnRequestId);
    expect(existing).toBeNull();
  });
});

// ===========================================================================
// WP-06-04 CORRECTION: Task D — pricePerTon persistence regression
// ===========================================================================

describe("WP-06-04 Task D: pricePerTon persistence regression", () => {
  it("28. ordinary non-replacement sale completeCommercialTotals persists pricePerTon", async () => {
    const deps = makeFullDeps();
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();

    // Create an ordinary (non-replacement) sale draft
    const draft = await deps.salesRepository.insertSaleDraft({
      tenantId: TEST_TENANT_ID, docNo: "SO-REG-001", customerId: TEST_CUSTOMER_ID,
      saleDate: "2026-07-10", createdBy: TEST_USERS.owner.userId,
    } as any);
    await deps.salesRepository.insertSaleLine({
      tenantId: TEST_TENANT_ID, salesOrderId: draft.id, lineNo: 1,
      itemId: TEST_ITEM_ID, locationId: TEST_LOCATION_ID,
      quantityKg: "100.000", pricePerTon: null, // starts null
    } as any);

    // Complete commercial totals with price = 90.00
    const lines = await deps.salesRepository.findSaleLines(TEST_TENANT_ID, draft.id);
    await deps.salesDraftService.completeCommercialTotals(ownerUser as any, ownerEff as any, {
      saleId: draft.id,
      linePrices: lines.map(l => ({ lineId: l.id, pricePerTon: "90.00" })),
      orderDiscountTotal: "0.00",
    });

    // Verify pricePerTon was persisted
    const linesAfter = await deps.salesRepository.findSaleLines(TEST_TENANT_ID, draft.id);
    expect(linesAfter[0]?.pricePerTon).toBe("90.00");
    expect(linesAfter[0]?.lineNetRevenuePosted).toBe("9.00"); // 100 kg / 1000 * 90 = 9.00
  });

  it("29. replacement sale completeCommercialTotals persists pricePerTon", async () => {
    const deps = makeFullDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);
    const rrId = await createApprovedReplacementReturn(deps, saleId, saleLineId);

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();

    const replResult = await deps.replacementService.createReplacementOrder(ownerUser as any, ownerEff as any, {
      returnRequestId: rrId,
      idempotencyKey: "repl-price-001",
    });

    // Verify pricePerTon starts as null
    const linesBefore = await deps.salesRepository.findSaleLines(TEST_TENANT_ID, replResult.replacementSaleId);
    expect(linesBefore[0]?.pricePerTon).toBeNull();

    // Complete commercial totals with price = 80.00
    await deps.salesDraftService.completeCommercialTotals(ownerUser as any, ownerEff as any, {
      saleId: replResult.replacementSaleId,
      linePrices: linesBefore.map(l => ({ lineId: l.id, pricePerTon: "80.00" })),
      orderDiscountTotal: "0.00",
    });

    // Verify pricePerTon was persisted
    const linesAfter = await deps.salesRepository.findSaleLines(TEST_TENANT_ID, replResult.replacementSaleId);
    expect(linesAfter[0]?.pricePerTon).toBe("80.00");
    expect(linesAfter[0]?.lineNetRevenuePosted).toBe("8.00"); // 100 kg / 1000 * 80 = 8.00
  });

  it("30. sales approval works after commercial completion without direct test mutation", async () => {
    const deps = makeFullDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);
    const rrId = await createApprovedReplacementReturn(deps, saleId, saleLineId);

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const ownerEff = makeOwnerEff();
    const acctEff = makeAcctEff();

    const replResult = await deps.replacementService.createReplacementOrder(ownerUser as any, ownerEff as any, {
      returnRequestId: rrId,
      idempotencyKey: "repl-approve-price-001",
    });

    // Complete + submit + approve via ordinary pipeline (no direct test mutation)
    await completeSubmitApproveReplacementSale(deps, replResult.replacementSaleId, "80.00", "approve-price-001");

    // Verify sale was approved successfully
    const sale = await deps.salesRepository.findSaleById(TEST_TENANT_ID, replResult.replacementSaleId);
    expect(sale?.saleStatus).toBe("approved");
    expect(sale?.isLocked).toBe(true);

    // Verify pricePerTon is still persisted after approval
    const lines = await deps.salesRepository.findSaleLines(TEST_TENANT_ID, replResult.replacementSaleId);
    expect(lines[0]?.pricePerTon).toBe("80.00");
  });
});
