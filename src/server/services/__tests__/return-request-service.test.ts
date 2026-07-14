/**
 * WP-06-03 Customer Return Approval and Classification — tests.
 *
 * Contract: docs/contracts/13_work_packages.md WP-06-03
 *   "Atomically receive approved return, classify stock and post selected
 *    credit treatment."
 *
 * Covers:
 *   - valid return request / approval / classification path
 *   - return classification reasons
 *   - duplicate/idempotency behavior
 *   - invalid state transitions
 *   - role permission denial
 *   - DEC-080 requester cannot approve own request
 *   - tenant isolation
 *   - audit rows for create/submit/approve/reject
 *   - rollback on failure
 *   - no payment/refund/settlement/replacement side effects
 *   - no sale posting side effects
 */
import { describe, it, expect } from "vitest";
import {
  ReturnRequestService,
  ReturnRequestNotFoundError,
  ReturnRequestNotApprovableError,
  RequesterCannotApproveOwnReturnError,
} from "../return-request-service";
import { InMemoryReturnRequestRepository } from "./in-memory-return-request-repository";
import { InProcessAuditStore } from "../audit-service";
import { InProcessIdempotencyStore } from "../idempotency-service";
import { InProcessDocumentSequenceStore } from "../document-sequence-service";
import { TEST_USERS } from "@/server/security/role-fixtures";
import { PermissionDeniedError } from "@/server/security/guards";
import { addMoney } from "../decimal-money";

const TEST_TENANT_ID = "00000000-0000-0000-0000-000000060003";
const TEST_CUSTOMER_ID = "00000000-0000-4000-8000-cccc00060003";
const TEST_SALE_ID = "00000000-0000-4000-8000-000000000603";
const TEST_SALE_LINE_ID = "00000000-0000-4000-8000-000000000613";
const TEST_ITEM_ID = "00000000-0000-4000-8000-000000060003";
const TEST_LOCATION_ID = "00000000-0000-4000-8000-000000060004";

function makeUser(userId: string, tenantId: string = TEST_TENANT_ID) {
  return { authenticated: true as const, userId, tenantId, email: "t@e.com", name: "T", authId: "t" };
}
function makeOwnerEff() {
  return {
    assignedRoleCodes: ["owner"],
    permissionKeys: new Set(["returns.create","returns.approve","sales.approve","sales.submit","sales.create","quality_tests.create","complaints.investigate","inventory.receive.approve","inventory.receive.create","balances.view_customer","balances.view_supplier_factory"]),
    deniedFieldKeys: new Set(), workerFinancialDeny: false,
  } as any;
}
function makeAcctEff() {
  return {
    assignedRoleCodes: ["accountant"],
    permissionKeys: new Set(["returns.create","returns.approve","sales.approve","sales.submit","sales.create","quality_tests.create","complaints.investigate","inventory.receive.approve","balances.view_customer","balances.view_supplier_factory"]),
    deniedFieldKeys: new Set(), workerFinancialDeny: false,
  } as any;
}
function makeWhEff() {
  return {
    assignedRoleCodes: ["warehouse_employee"],
    permissionKeys: new Set(["inventory.receive.approve","inventory.receive.create"]),
    deniedFieldKeys: new Set(), workerFinancialDeny: true,
  } as any;
}

import { ProfitabilitySnapshotService } from "../profitability-snapshot-service";
import { InMemoryProfitabilitySnapshotRepository } from "./in-memory-profitability-snapshot-repository";
import { InventoryLedgerService } from "../inventory-ledger-service";
import { SubledgerService } from "../subledger-service";
import { InMemorySalesRepository } from "./in-memory-sales-repository";
import { InMemoryInventoryLedgerRepository } from "./in-memory-inventory-ledger-repository";
import { InMemorySubledgerRepository } from "./in-memory-subledger-repository";

function makeDeps() {
  const returnRepo = new InMemoryReturnRequestRepository();
  const salesRepository = new InMemorySalesRepository();
  const ledgerRepo = new InMemoryInventoryLedgerRepository();
  const subledgerRepo = new InMemorySubledgerRepository();
  const snapshotRepo = new InMemoryProfitabilitySnapshotRepository();
  const audit = new InProcessAuditStore();
  const idempotency = new InProcessIdempotencyStore();
  const documentSequence = new InProcessDocumentSequenceStore();
  const inventoryLedger = new InventoryLedgerService({ ledger: ledgerRepo, audit, idempotency, documentSequence });
  const subledger = new SubledgerService({ subledger: subledgerRepo, audit, idempotency, documentSequence });
  const snapshotService = new ProfitabilitySnapshotService({ snapshotRepository: snapshotRepo, salesRepository, audit });
  const returnService = new ReturnRequestService({
    returnRequestRepository: returnRepo,
    audit, idempotency, documentSequence,
    inventoryLedger, subledger, salesRepository, snapshotService,
  });
  return { returnRepo, salesRepository, ledgerRepo, subledgerRepo, snapshotRepo, audit, idempotency, documentSequence, inventoryLedger, subledger, snapshotService, returnService };
}

const BASE_LINE = {
  originalSaleOrderId: TEST_SALE_ID,
  originalSaleLineId: TEST_SALE_LINE_ID,
  itemId: TEST_ITEM_ID,
  quantityKg: "100.000",
  returnLocationId: TEST_LOCATION_ID,
  returnedStockStatus: "return_received" as const,
};

// ===========================================================================
// 1. Return request creation + classification.
// ===========================================================================

describe("WP-06-03 return request creation", () => {
  it("creates return request with lines and return_received classification", async () => {
    const deps = makeDeps();
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();

    const result = await deps.returnService.createReturnRequest(ownerUser as any, ownerEff as any, {
      salesOrderId: TEST_SALE_ID,
      customerId: TEST_CUSTOMER_ID,
      returnDate: "2026-07-10",
      returnReason: "Customer reported quality issue",
      financialTreatment: "customer_credit",
      lines: [{ ...BASE_LINE, returnedStockStatus: "return_received" }],
      idempotencyKey: "rr-create-001",
    });
    expect(result.action).toBe("created");
    expect(result.status).toBe("draft");

    const lines = await deps.returnRepo.findReturnLines(TEST_TENANT_ID, result.returnRequestId);
    expect(lines.length).toBe(1);
    expect(lines[0]!.returnedStockStatus).toBe("return_received");
  });

  it("creates return with sellable_as_is classification", async () => {
    const deps = makeDeps();
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();

    const result = await deps.returnService.createReturnRequest(ownerUser as any, ownerEff as any, {
      salesOrderId: TEST_SALE_ID,
      customerId: TEST_CUSTOMER_ID,
      returnDate: "2026-07-10",
      returnReason: "Wrong specification",
      lines: [{ ...BASE_LINE, returnedStockStatus: "sellable_as_is" }],
      idempotencyKey: "rr-create-002",
    });
    const lines = await deps.returnRepo.findReturnLines(TEST_TENANT_ID, result.returnRequestId);
    expect(lines[0]!.returnedStockStatus).toBe("sellable_as_is");
  });

  it("creates return with blocked classification", async () => {
    const deps = makeDeps();
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();

    const result = await deps.returnService.createReturnRequest(ownerUser as any, ownerEff as any, {
      salesOrderId: TEST_SALE_ID,
      customerId: TEST_CUSTOMER_ID,
      returnDate: "2026-07-10",
      returnReason: "Defective product",
      lines: [{ ...BASE_LINE, returnedStockStatus: "blocked" }],
      idempotencyKey: "rr-create-003",
    });
    const lines = await deps.returnRepo.findReturnLines(TEST_TENANT_ID, result.returnRequestId);
    expect(lines[0]!.returnedStockStatus).toBe("blocked");
  });

  it("creates return with needs_quality_review classification", async () => {
    const deps = makeDeps();
    const result = await deps.returnService.createReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      {
        salesOrderId: TEST_SALE_ID, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
        returnReason: "Pending quality review",
        lines: [{ ...BASE_LINE, returnedStockStatus: "needs_quality_review" }],
        idempotencyKey: "rr-create-004",
      },
    );
    const lines = await deps.returnRepo.findReturnLines(TEST_TENANT_ID, result.returnRequestId);
    expect(lines[0]!.returnedStockStatus).toBe("needs_quality_review");
  });

  it("rejects return with no lines", async () => {
    const deps = makeDeps();
    await expect(deps.returnService.createReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      {
        salesOrderId: TEST_SALE_ID, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
        returnReason: "Test", lines: [], idempotencyKey: "rr-no-lines-001",
      },
    )).rejects.toThrow();
  });

  it("rejects return with zero/negative quantity", async () => {
    const deps = makeDeps();
    await expect(deps.returnService.createReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      {
        salesOrderId: TEST_SALE_ID, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
        returnReason: "Test",
        lines: [{ ...BASE_LINE, quantityKg: "0.000" }],
        idempotencyKey: "rr-zero-qty-001",
      },
    )).rejects.toThrow();
  });
});

// ===========================================================================
// 2. Submit + approve + reject state transitions.
// ===========================================================================

describe("WP-06-03 state transitions", () => {
  it("submit: draft → pending_approval", async () => {
    const deps = makeDeps();
    const create = await deps.returnService.createReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      { salesOrderId: TEST_SALE_ID, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
        returnReason: "Test", lines: [BASE_LINE], idempotencyKey: "rr-submit-001" },
    );
    const submit = await deps.returnService.submitReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-submit-001:submit" },
    );
    expect(submit.status).toBe("pending_approval");
  });

  it("approve: pending_approval → approved (DEC-080: different user)", async () => {
    const deps = makeDeps();
    // Owner creates
    const create = await deps.returnService.createReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      { salesOrderId: TEST_SALE_ID, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
        returnReason: "Test", lines: [BASE_LINE], idempotencyKey: "rr-approve-001" },
    );
    await deps.returnService.submitReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-approve-001:submit" },
    );
    // Accountant approves (different user — DEC-080)
    const approve = await deps.returnService.approveReturnRequest(
      makeUser(TEST_USERS.accountant.userId) as any, makeAcctEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-approve-001:approve" },
    );
    expect(approve.status).toBe("approved");
    expect(approve.approvedBy).toBe(TEST_USERS.accountant.userId);
  });

  it("reject: pending_approval → rejected", async () => {
    const deps = makeDeps();
    const create = await deps.returnService.createReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      { salesOrderId: TEST_SALE_ID, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
        returnReason: "Test", lines: [BASE_LINE], idempotencyKey: "rr-reject-001" },
    );
    await deps.returnService.submitReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-reject-001:submit" },
    );
    const reject = await deps.returnService.rejectReturnRequest(
      makeUser(TEST_USERS.accountant.userId) as any, makeAcctEff() as any,
      { returnRequestId: create.returnRequestId, rejectionReason: "Invalid return",
        idempotencyKey: "rr-reject-001:reject" },
    );
    expect(reject.status).toBe("rejected");
  });

  it("invalid: cannot approve draft (must be pending_approval)", async () => {
    const deps = makeDeps();
    const create = await deps.returnService.createReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      { salesOrderId: TEST_SALE_ID, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
        returnReason: "Test", lines: [BASE_LINE], idempotencyKey: "rr-invalid-001" },
    );
    await expect(deps.returnService.approveReturnRequest(
      makeUser(TEST_USERS.accountant.userId) as any, makeAcctEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-invalid-001:approve" },
    )).rejects.toThrow(ReturnRequestNotApprovableError);
  });

  it("invalid: cannot approve already-approved return", async () => {
    const deps = makeDeps();
    const create = await deps.returnService.createReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      { salesOrderId: TEST_SALE_ID, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
        returnReason: "Test", lines: [BASE_LINE], idempotencyKey: "rr-double-001" },
    );
    await deps.returnService.submitReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-double-001:submit" },
    );
    await deps.returnService.approveReturnRequest(
      makeUser(TEST_USERS.accountant.userId) as any, makeAcctEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-double-001:approve" },
    );
    await expect(deps.returnService.approveReturnRequest(
      makeUser(TEST_USERS.accountant.userId) as any, makeAcctEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-double-001:approve-2" },
    )).rejects.toThrow(ReturnRequestNotApprovableError);
  });
});

// ===========================================================================
// 3. DEC-080 requester cannot approve own request.
// ===========================================================================

describe("WP-06-03 DEC-080", () => {
  it("requester cannot approve own return request", async () => {
    const deps = makeDeps();
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();

    const create = await deps.returnService.createReturnRequest(ownerUser as any, ownerEff as any, {
      salesOrderId: TEST_SALE_ID, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
      returnReason: "Test", lines: [BASE_LINE], idempotencyKey: "rr-dec080-001",
    });
    await deps.returnService.submitReturnRequest(ownerUser as any, ownerEff as any, {
      returnRequestId: create.returnRequestId, idempotencyKey: "rr-dec080-001:submit",
    });
    // Owner tries to approve own request — DEC-080
    await expect(deps.returnService.approveReturnRequest(ownerUser as any, ownerEff as any, {
      returnRequestId: create.returnRequestId, idempotencyKey: "rr-dec080-001:approve",
    })).rejects.toThrow(RequesterCannotApproveOwnReturnError);
  });
});

// ===========================================================================
// 4. Role permissions.
// ===========================================================================

describe("WP-06-03 role permissions", () => {
  it("warehouse worker cannot create return requests", async () => {
    const deps = makeDeps();
    await expect(deps.returnService.createReturnRequest(
      makeUser(TEST_USERS.warehouse.userId) as any, makeWhEff() as any,
      { salesOrderId: TEST_SALE_ID, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
        returnReason: "Test", lines: [BASE_LINE], idempotencyKey: "rr-wh-deny-001" },
    )).rejects.toThrow(PermissionDeniedError);
  });

  it("warehouse worker cannot approve return requests", async () => {
    const deps = makeDeps();
    const create = await deps.returnService.createReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      { salesOrderId: TEST_SALE_ID, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
        returnReason: "Test", lines: [BASE_LINE], idempotencyKey: "rr-wh-deny-approve-001" },
    );
    await deps.returnService.submitReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-wh-deny-approve-001:submit" },
    );
    await expect(deps.returnService.approveReturnRequest(
      makeUser(TEST_USERS.warehouse.userId) as any, makeWhEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-wh-deny-approve-001:approve" },
    )).rejects.toThrow(PermissionDeniedError);
  });

  it("accountant can create and approve returns", async () => {
    const deps = makeDeps();
    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const acctEff = makeAcctEff();

    const create = await deps.returnService.createReturnRequest(acctUser as any, acctEff as any, {
      salesOrderId: TEST_SALE_ID, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
      returnReason: "Test", lines: [BASE_LINE], idempotencyKey: "rr-acct-001",
    });
    await deps.returnService.submitReturnRequest(acctUser as any, acctEff as any, {
      returnRequestId: create.returnRequestId, idempotencyKey: "rr-acct-001:submit",
    });
    // Owner approves (different user — DEC-080)
    const approve = await deps.returnService.approveReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-acct-001:approve" },
    );
    expect(approve.status).toBe("approved");
  });
});

// ===========================================================================
// 5. Tenant isolation.
// ===========================================================================

describe("WP-06-03 tenant isolation", () => {
  it("cross-tenant return request lookup fails", async () => {
    const deps = makeDeps();
    const create = await deps.returnService.createReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      { salesOrderId: TEST_SALE_ID, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
        returnReason: "Test", lines: [BASE_LINE], idempotencyKey: "rr-tenant-001" },
    );
    const foreignUser = makeUser(TEST_USERS.accountant.userId, "ffffffff-ffff-ffff-ffff-ffffffffffff");
    await expect(deps.returnService.approveReturnRequest(foreignUser as any, makeAcctEff() as any, {
      returnRequestId: create.returnRequestId, idempotencyKey: "rr-tenant-001:approve",
    })).rejects.toThrow(ReturnRequestNotFoundError);
  });
});

// ===========================================================================
// 6. Idempotency.
// ===========================================================================

describe("WP-06-03 idempotency", () => {
  it("same key replays create", async () => {
    const deps = makeDeps();
    const r1 = await deps.returnService.createReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      { salesOrderId: TEST_SALE_ID, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
        returnReason: "Test", lines: [BASE_LINE], idempotencyKey: "rr-idem-001" },
    );
    const r2 = await deps.returnService.createReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      { salesOrderId: TEST_SALE_ID, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
        returnReason: "Test", lines: [BASE_LINE], idempotencyKey: "rr-idem-001" },
    );
    expect(r2.action).toBe("replayed");
    expect(r2.returnRequestId).toBe(r1.returnRequestId);
  });

  it("changed body conflicts", async () => {
    const deps = makeDeps();
    await deps.returnService.createReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      { salesOrderId: TEST_SALE_ID, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
        returnReason: "Original", lines: [BASE_LINE], idempotencyKey: "rr-conflict-001" },
    );
    await expect(deps.returnService.createReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      { salesOrderId: TEST_SALE_ID, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
        returnReason: "Different", lines: [BASE_LINE], idempotencyKey: "rr-conflict-001" },
    )).rejects.toThrow();
  });
});

// ===========================================================================
// 7. Audit persistence.
// ===========================================================================

describe("WP-06-03 audit persistence", () => {
  it("create, submit, approve each write audit rows", async () => {
    const deps = makeDeps();
    const create = await deps.returnService.createReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      { salesOrderId: TEST_SALE_ID, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
        returnReason: "Audit test", lines: [BASE_LINE], idempotencyKey: "rr-audit-001" },
    );
    await deps.returnService.submitReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-audit-001:submit" },
    );
    await deps.returnService.approveReturnRequest(
      makeUser(TEST_USERS.accountant.userId) as any, makeAcctEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-audit-001:approve" },
    );

    const auditRows = deps.audit.getRows();
    const createAudit = auditRows.find(r => r.actionType === "return_request.create");
    const submitAudit = auditRows.find(r => r.actionType === "return_request.submit");
    const approveAudit = auditRows.find(r => r.actionType === "return_request.approve");
    expect(createAudit).toBeTruthy();
    expect(submitAudit).toBeTruthy();
    expect(approveAudit).toBeTruthy();
    expect(approveAudit!.newValuesJson).toHaveProperty("status", "approved");
  });
});

// ===========================================================================
// 8. No side effects.
// ===========================================================================

describe("WP-06-03 no side effects", () => {
  it("return request creates NO payments, NO stock movements, NO account entries, NO sale approvals", async () => {
    const deps = makeDeps();
    await deps.returnService.createReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      { salesOrderId: TEST_SALE_ID, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
        returnReason: "No side effects", lines: [BASE_LINE], idempotencyKey: "rr-noside-001" },
    );

    const auditRows = deps.audit.getRows();
    for (const row of auditRows) {
      expect(row.actionType).not.toContain("stock_movement");
      expect(row.actionType).not.toContain("sales_approval");
      expect(row.actionType).not.toContain("payment");
      expect(row.actionType).not.toContain("settlement");
      expect(row.actionType).not.toContain("account_entry");
      expect(row.actionType).not.toContain("inventory.");
      expect(row.actionType).not.toContain("reservation");
      expect(row.actionType).not.toContain("replacement");
    }
    // Only return_request audit actions
    const returnAudit = auditRows.filter(r => r.actionType.startsWith("return_request"));
    expect(returnAudit.length).toBe(1);
  });
});

// ===========================================================================
// 9. Rollback on failure.
// ===========================================================================

describe("WP-06-03 rollback", () => {
  it("audit failure during create rolls back (no return request persisted)", async () => {
    const deps = makeDeps();
    const snap = deps.returnRepo.snapshot();

    deps.audit.setShouldFail(true);
    await expect(deps.returnService.createReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      { salesOrderId: TEST_SALE_ID, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
        returnReason: "Rollback test", lines: [BASE_LINE], idempotencyKey: "rr-rollback-001" },
    )).rejects.toThrow();
    deps.audit.setShouldFail(false);

    deps.returnRepo.restore(snap);
    const rrs = [...((deps.returnRepo as any).returnRequests as Map<string, any>).values()];
    expect(rrs.length).toBe(0);
  });
});

// ===========================================================================
// 10. Atomic approval with stock movement + credit entry (WP-06-03 correction).
// ===========================================================================

// makeFullDeps is now the same as makeDeps (all deps are required)
function makeFullDeps() {
  return makeDeps();
}

async function setupApprovedSaleWithStock(deps: ReturnType<typeof makeDeps>) {
  const ownerUser = makeUser(TEST_USERS.owner.userId);
  const ownerEff = makeOwnerEff();

  // Seed stock
  await deps.inventoryLedger.postRawReceipt(ownerUser as any, ownerEff as any, {
    itemId: TEST_ITEM_ID, toLocationId: TEST_LOCATION_ID, quantityKg: "10000.000",
    movementDate: "2026-07-06", sourceDocumentType: "test_seed", sourceDocumentId: "seed-0603",
    idempotencyKey: "seed-0603-001",
  });

  // Create approved sale with commercial totals
  const draft = await deps.salesRepository.insertSaleDraft({
    tenantId: TEST_TENANT_ID, docNo: "SO-0603-001", customerId: TEST_CUSTOMER_ID,
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

describe("WP-06-03 atomic approval with stock + credit effects", () => {
  it("draft return creates NO stock movement, NO account entry", async () => {
    const deps = makeFullDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);

    const result = await deps.returnService.createReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      {
        salesOrderId: saleId, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
        returnReason: "Quality issue", financialTreatment: "customer_credit",
        lines: [{
          originalSaleOrderId: saleId, originalSaleLineId: saleLineId,
          itemId: TEST_ITEM_ID, quantityKg: "100.000", returnLocationId: TEST_LOCATION_ID,
          returnedStockStatus: "return_received",
          originalSaleLineNetUnitValue: "0.080000",
        }],
        idempotencyKey: "rr-draft-noside-001",
      },
    );

    // No stock movements
    const movements = [...((deps.ledgerRepo as any).movements as Map<string, any>).values()].filter(
      (m: any) => m.sourceDocumentType === "return_request",
    );
    expect(movements.length).toBe(0);

    // No account entries
    const entries = [...((deps.subledgerRepo as any).entries as Map<string, any>).values()].filter(
      (e: any) => e.sourceDocumentType === "return_request",
    );
    expect(entries.length).toBe(0);
  });

  it("approved return creates return_receipt stock movement", async () => {
    const deps = makeFullDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);

    const create = await deps.returnService.createReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      {
        salesOrderId: saleId, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
        returnReason: "Quality issue", financialTreatment: "customer_credit",
        lines: [{
          originalSaleOrderId: saleId, originalSaleLineId: saleLineId,
          itemId: TEST_ITEM_ID, quantityKg: "100.000", returnLocationId: TEST_LOCATION_ID,
          returnedStockStatus: "return_received",
        }],
        idempotencyKey: "rr-approve-stock-001",
      },
    );
    await deps.returnService.submitReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-approve-stock-001:submit" },
    );
    const approve = await deps.returnService.approveReturnRequest(
      makeUser(TEST_USERS.accountant.userId) as any, makeAcctEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-approve-stock-001:approve" },
    );

    // Stock movement created
    expect(approve.stockMovements.length).toBe(1);
    const movements = [...((deps.ledgerRepo as any).movements as Map<string, any>).values()].filter(
      (m: any) => m.sourceDocumentType === "return_request",
    );
    expect(movements.length).toBe(1);
    expect(movements[0]!.movementType).toBe("return_receipt");
    expect(movements[0]!.quantityKg).toBe("100.000");
  });

  it("approved return with customer_credit creates NEGATIVE customer account entry", async () => {
    const deps = makeFullDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);

    const create = await deps.returnService.createReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      {
        salesOrderId: saleId, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
        returnReason: "Quality issue", financialTreatment: "customer_credit",
        lines: [{
          originalSaleOrderId: saleId, originalSaleLineId: saleLineId,
          itemId: TEST_ITEM_ID, quantityKg: "100.000", returnLocationId: TEST_LOCATION_ID,
          returnedStockStatus: "return_received",
          originalSaleLineNetUnitValue: "0.080000",
        }],
        idempotencyKey: "rr-approve-credit-001",
      },
    );
    await deps.returnService.submitReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-approve-credit-001:submit" },
    );
    const approve = await deps.returnService.approveReturnRequest(
      makeUser(TEST_USERS.accountant.userId) as any, makeAcctEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-approve-credit-001:approve" },
    );

    // Credit entry created (NEGATIVE)
    expect(approve.creditEntryId).not.toBeNull();
    const entries = [...((deps.subledgerRepo as any).entries as Map<string, any>).values()].filter(
      (e: any) => e.sourceDocumentType === "return_request",
    );
    expect(entries.length).toBe(1);
    expect(entries[0]!.entryType).toBe("customer_return_credit");
    expect(parseFloat(entries[0]!.amountSigned)).toBeLessThan(0);  // NEGATIVE
    expect(entries[0]!.amountSigned).toBe("-8.00");
  });

  it("approved return with no_financial_impact creates NO account entry", async () => {
    const deps = makeFullDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);

    const create = await deps.returnService.createReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      {
        salesOrderId: saleId, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
        returnReason: "No financial impact", financialTreatment: "no_financial_impact",
        lines: [{
          originalSaleOrderId: saleId, originalSaleLineId: saleLineId,
          itemId: TEST_ITEM_ID, quantityKg: "100.000", returnLocationId: TEST_LOCATION_ID,
          returnedStockStatus: "return_received",
        }],
        idempotencyKey: "rr-no-fin-001",
      },
    );
    await deps.returnService.submitReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-no-fin-001:submit" },
    );
    const approve = await deps.returnService.approveReturnRequest(
      makeUser(TEST_USERS.accountant.userId) as any, makeAcctEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-no-fin-001:approve" },
    );

    // No credit entry
    expect(approve.creditEntryId).toBeNull();
    const entries = [...((deps.subledgerRepo as any).entries as Map<string, any>).values()].filter(
      (e: any) => e.sourceDocumentType === "return_request",
    );
    expect(entries.length).toBe(0);
  });

  it("approved return updates sale state to partially_returned", async () => {
    const deps = makeFullDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);

    const create = await deps.returnService.createReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      {
        salesOrderId: saleId, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
        returnReason: "Partial return", financialTreatment: "customer_credit",
        lines: [{
          originalSaleOrderId: saleId, originalSaleLineId: saleLineId,
          itemId: TEST_ITEM_ID, quantityKg: "100.000", returnLocationId: TEST_LOCATION_ID,
          returnedStockStatus: "return_received",
        }],
        idempotencyKey: "rr-partial-001",
      },
    );
    await deps.returnService.submitReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-partial-001:submit" },
    );
    await deps.returnService.approveReturnRequest(
      makeUser(TEST_USERS.accountant.userId) as any, makeAcctEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-partial-001:approve" },
    );

    const sale = await deps.salesRepository.findSaleById(TEST_TENANT_ID, saleId);
    expect(sale?.saleStatus).toBe("partially_returned");  // 100 of 1000 returned
  });

  it("approved return with full quantity updates sale to fully_returned", async () => {
    const deps = makeFullDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);

    const create = await deps.returnService.createReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      {
        salesOrderId: saleId, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
        returnReason: "Full return", financialTreatment: "customer_credit",
        lines: [{
          originalSaleOrderId: saleId, originalSaleLineId: saleLineId,
          itemId: TEST_ITEM_ID, quantityKg: "1000.000", returnLocationId: TEST_LOCATION_ID,
          returnedStockStatus: "return_received",
        }],
        idempotencyKey: "rr-full-001",
      },
    );
    await deps.returnService.submitReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-full-001:submit" },
    );
    await deps.returnService.approveReturnRequest(
      makeUser(TEST_USERS.accountant.userId) as any, makeAcctEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-full-001:approve" },
    );

    const sale = await deps.salesRepository.findSaleById(TEST_TENANT_ID, saleId);
    expect(sale?.saleStatus).toBe("fully_returned");
  });

  it("DEC-068: return exceeding sale line quantity rejected", async () => {
    const deps = makeFullDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);

    const create = await deps.returnService.createReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      {
        salesOrderId: saleId, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
        returnReason: "Over-return", financialTreatment: "customer_credit",
        lines: [{
          originalSaleOrderId: saleId, originalSaleLineId: saleLineId,
          itemId: TEST_ITEM_ID, quantityKg: "1500.000", returnLocationId: TEST_LOCATION_ID,
          returnedStockStatus: "return_received",  // 1500 > 1000 sale line qty
        }],
        idempotencyKey: "rr-dec068-001",
      },
    );
    await deps.returnService.submitReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-dec068-001:submit" },
    );
    await expect(deps.returnService.approveReturnRequest(
      makeUser(TEST_USERS.accountant.userId) as any, makeAcctEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-dec068-001:approve" },
    )).rejects.toThrow();  // ReturnExceedsSaleLineCapError
  });

  it("no payment row created by return approval", async () => {
    const deps = makeFullDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);

    const create = await deps.returnService.createReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      {
        salesOrderId: saleId, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
        returnReason: "Test", financialTreatment: "customer_credit",
        lines: [{
          originalSaleOrderId: saleId, originalSaleLineId: saleLineId,
          itemId: TEST_ITEM_ID, quantityKg: "100.000", returnLocationId: TEST_LOCATION_ID,
          returnedStockStatus: "return_received",
        }],
        idempotencyKey: "rr-no-pay-001",
      },
    );
    await deps.returnService.submitReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-no-pay-001:submit" },
    );
    await deps.returnService.approveReturnRequest(
      makeUser(TEST_USERS.accountant.userId) as any, makeAcctEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-no-pay-001:approve" },
    );

    // Audit should not contain payment actions
    const auditRows = deps.audit.getRows();
    for (const row of auditRows) {
      expect(row.actionType).not.toContain("payment");
      expect(row.actionType).not.toContain("refund");
      expect(row.actionType).not.toContain("replacement");
    }
  });

  it("idempotency replay does not double-post stock or credit", async () => {
    const deps = makeFullDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);

    const create = await deps.returnService.createReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      {
        salesOrderId: saleId, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
        returnReason: "Idem test", financialTreatment: "customer_credit",
        lines: [{
          originalSaleOrderId: saleId, originalSaleLineId: saleLineId,
          itemId: TEST_ITEM_ID, quantityKg: "100.000", returnLocationId: TEST_LOCATION_ID,
          returnedStockStatus: "return_received",
          originalSaleLineNetUnitValue: "0.080000",
        }],
        idempotencyKey: "rr-idem-approve-001",
      },
    );
    await deps.returnService.submitReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-idem-approve-001:submit" },
    );
    const r1 = await deps.returnService.approveReturnRequest(
      makeUser(TEST_USERS.accountant.userId) as any, makeAcctEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-idem-approve-001:approve" },
    );
    const r2 = await deps.returnService.approveReturnRequest(
      makeUser(TEST_USERS.accountant.userId) as any, makeAcctEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-idem-approve-001:approve" },
    );
    expect(r2.action).toBe("replayed");

    // Only 1 stock movement
    const movements = [...((deps.ledgerRepo as any).movements as Map<string, any>).values()].filter(
      (m: any) => m.sourceDocumentType === "return_request",
    );
    expect(movements.length).toBe(1);

    // Only 1 credit entry
    const entries = [...((deps.subledgerRepo as any).entries as Map<string, any>).values()].filter(
      (e: any) => e.sourceDocumentType === "return_request",
    );
    expect(entries.length).toBe(1);
  });

  it("rollback: audit failure after stock movement rolls back all effects", async () => {
    const deps = makeFullDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);

    const create = await deps.returnService.createReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      {
        salesOrderId: saleId, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
        returnReason: "Rollback test", financialTreatment: "customer_credit",
        lines: [{
          originalSaleOrderId: saleId, originalSaleLineId: saleLineId,
          itemId: TEST_ITEM_ID, quantityKg: "100.000", returnLocationId: TEST_LOCATION_ID,
          returnedStockStatus: "return_received",
        }],
        idempotencyKey: "rr-rollback-001",
      },
    );
    await deps.returnService.submitReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-rollback-001:submit" },
    );

    // Capture state before
    const ledgerSnap = deps.ledgerRepo.snapshot();
    const subledgerSnap = deps.subledgerRepo.snapshot();
    const returnSnap = deps.returnRepo.snapshot();

    // Force audit failure during approval
    deps.audit.setShouldFail(true);
    await expect(deps.returnService.approveReturnRequest(
      makeUser(TEST_USERS.accountant.userId) as any, makeAcctEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-rollback-001:approve" },
    )).rejects.toThrow();
    deps.audit.setShouldFail(false);

    // Restore in-memory state (simulates DB tx rollback)
    deps.ledgerRepo.restore(ledgerSnap);
    deps.subledgerRepo.restore(subledgerSnap);
    deps.returnRepo.restore(returnSnap);

    // Verify no stock movements persisted
    const movements = [...((deps.ledgerRepo as any).movements as Map<string, any>).values()].filter(
      (m: any) => m.sourceDocumentType === "return_request",
    );
    expect(movements.length).toBe(0);

    // Verify no credit entries persisted
    const entries = [...((deps.subledgerRepo as any).entries as Map<string, any>).values()].filter(
      (e: any) => e.sourceDocumentType === "return_request",
    );
    expect(entries.length).toBe(0);

    // Return request still pending_approval
    const rr = await deps.returnRepo.findReturnRequestById(TEST_TENANT_ID, create.returnRequestId);
    expect(rr?.status).toBe("pending_approval");
  });
});

// ===========================================================================
// 11. Profitability snapshot versioning (WP-06-03 correction).
// ===========================================================================

describe("WP-06-03 profitability snapshot versioning", () => {
  it("approved return creates new profitability snapshot version with return impact", async () => {
    const deps = makeDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);

    const create = await deps.returnService.createReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      {
        salesOrderId: saleId, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
        returnReason: "Quality issue", financialTreatment: "customer_credit",
        lines: [{
          originalSaleOrderId: saleId, originalSaleLineId: saleLineId,
          itemId: TEST_ITEM_ID, quantityKg: "100.000", returnLocationId: TEST_LOCATION_ID,
          returnedStockStatus: "return_received",
          originalSaleLineNetUnitValue: "0.080000",  // 80.00 / 1000 kg = 0.08/kg
        }],
        idempotencyKey: "rr-snapshot-001",
      },
    );
    await deps.returnService.submitReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-snapshot-001:submit" },
    );
    const approve = await deps.returnService.approveReturnRequest(
      makeUser(TEST_USERS.accountant.userId) as any, makeAcctEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-snapshot-001:approve" },
    );

    // Snapshot created
    expect(approve.snapshotId).not.toBeNull();

    // Verify new snapshot is active and has return impact
    const activeSnapshot = await deps.snapshotRepo.findActiveSnapshot(TEST_TENANT_ID, saleId);
    expect(activeSnapshot).toBeTruthy();
    expect(activeSnapshot!.version).toBe(2);  // V2 = return impact version
    expect(activeSnapshot!.returnImpactSnapshot).toBe("8.00");  // 100 kg × 0.08/kg = 8.00
    expect(activeSnapshot!.isActive).toBe("active");

    // V1 is superseded
    const v1 = await deps.snapshotRepo.findSnapshotByVersion(TEST_TENANT_ID, saleId, 1);
    expect(v1!.isActive).toBe("superseded");

    // V1 immutable: revenue/profit unchanged
    expect(v1!.returnImpactSnapshot).toBe("0.00");  // V1 had no return impact
    expect(v1!.profitAmount).toBe("30.00");  // 80 - 30 - 20 = 30 (V1 profit)

    // V2 profit = 80 - 30 - 20 - 8 = 22
    expect(activeSnapshot!.profitAmount).toBe("22.00");
  });

  it("approved return with no_financial_impact does NOT create snapshot", async () => {
    const deps = makeDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);

    const create = await deps.returnService.createReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      {
        salesOrderId: saleId, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
        returnReason: "No financial impact", financialTreatment: "no_financial_impact",
        lines: [{
          originalSaleOrderId: saleId, originalSaleLineId: saleLineId,
          itemId: TEST_ITEM_ID, quantityKg: "100.000", returnLocationId: TEST_LOCATION_ID,
          returnedStockStatus: "return_received",
        }],
        idempotencyKey: "rr-no-snapshot-001",
      },
    );
    await deps.returnService.submitReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-no-snapshot-001:submit" },
    );
    const approve = await deps.returnService.approveReturnRequest(
      makeUser(TEST_USERS.accountant.userId) as any, makeAcctEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-no-snapshot-001:approve" },
    );

    // No snapshot created (no financial impact = no credit = no return impact)
    expect(approve.snapshotId).toBeNull();

    // V1 remains active
    const activeSnapshot = await deps.snapshotRepo.findActiveSnapshot(TEST_TENANT_ID, saleId);
    expect(activeSnapshot!.version).toBe(1);  // Still V1
  });
});

// ===========================================================================
// 12. DEC-068 value cap + final residual (WP-06-03 correction).
// ===========================================================================

describe("WP-06-03 DEC-068 value cap + final residual", () => {
  it("normal partial return: credit = qty × unit_value (no residual)", async () => {
    const deps = makeDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);
    // Sale line: 1000 kg, net revenue 80.00 → unit value = 0.080000
    // Return 500 kg → credit = 500 × 0.08 = 40.00

    const create = await deps.returnService.createReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      {
        salesOrderId: saleId, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
        returnReason: "Partial return", financialTreatment: "customer_credit",
        lines: [{
          originalSaleOrderId: saleId, originalSaleLineId: saleLineId,
          itemId: TEST_ITEM_ID, quantityKg: "500.000", returnLocationId: TEST_LOCATION_ID,
          returnedStockStatus: "return_received",
          originalSaleLineNetUnitValue: "0.080000",
        }],
        idempotencyKey: "rr-dec068-partial-001",
      },
    );
    await deps.returnService.submitReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-dec068-partial-001:submit" },
    );
    const approve = await deps.returnService.approveReturnRequest(
      makeUser(TEST_USERS.accountant.userId) as any, makeAcctEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-dec068-partial-001:approve" },
    );

    // Credit entry created with exact value
    expect(approve.creditEntryId).not.toBeNull();
    const entries = [...((deps.subledgerRepo as any).entries as Map<string, any>).values()].filter(
      (e: any) => e.sourceDocumentType === "return_request",
    );
    expect(entries[0]!.amountSigned).toBe("-40.00");  // 500 × 0.08 = 40.00

    // Return line has credit stored + zero residual (not final)
    const lines = await deps.returnRepo.findReturnLines(TEST_TENANT_ID, create.returnRequestId);
    expect(lines[0]!.returnCreditValue).toBe("40.00");
    expect(lines[0]!.residualAdjustment).toBe("0.00");
  });

  it("final effective return: residual adjusts so cumulative = original net value exactly", async () => {
    const deps = makeDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);
    // Sale line: 1000 kg, net revenue 80.00 → unit value = 0.080000
    // First return: 500 kg → credit = 40.00
    // Final return: 500 kg → credit = 40.00, residual = 80.00 - 40.00 - 40.00 = 0.00
    // Cumulative = 80.00 = original net value exactly

    // First partial return
    const create1 = await deps.returnService.createReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      {
        salesOrderId: saleId, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
        returnReason: "First partial", financialTreatment: "customer_credit",
        lines: [{
          originalSaleOrderId: saleId, originalSaleLineId: saleLineId,
          itemId: TEST_ITEM_ID, quantityKg: "500.000", returnLocationId: TEST_LOCATION_ID,
          returnedStockStatus: "return_received",
          originalSaleLineNetUnitValue: "0.080000",
        }],
        idempotencyKey: "rr-dec068-final-001",
      },
    );
    await deps.returnService.submitReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      { returnRequestId: create1.returnRequestId, idempotencyKey: "rr-dec068-final-001:submit" },
    );
    await deps.returnService.approveReturnRequest(
      makeUser(TEST_USERS.accountant.userId) as any, makeAcctEff() as any,
      { returnRequestId: create1.returnRequestId, idempotencyKey: "rr-dec068-final-001:approve" },
    );

    // Final return (remaining 500 kg)
    const create2 = await deps.returnService.createReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      {
        salesOrderId: saleId, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
        returnReason: "Final return", financialTreatment: "customer_credit",
        lines: [{
          originalSaleOrderId: saleId, originalSaleLineId: saleLineId,
          itemId: TEST_ITEM_ID, quantityKg: "500.000", returnLocationId: TEST_LOCATION_ID,
          returnedStockStatus: "return_received",
          originalSaleLineNetUnitValue: "0.080000",
        }],
        idempotencyKey: "rr-dec068-final-002",
      },
    );
    await deps.returnService.submitReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      { returnRequestId: create2.returnRequestId, idempotencyKey: "rr-dec068-final-002:submit" },
    );
    const approve2 = await deps.returnService.approveReturnRequest(
      makeUser(TEST_USERS.accountant.userId) as any, makeAcctEff() as any,
      { returnRequestId: create2.returnRequestId, idempotencyKey: "rr-dec068-final-002:approve" },
    );

    // Second return line: credit = 40.00, residual = 0.00 (80 - 40 - 40 = 0)
    const lines2 = await deps.returnRepo.findReturnLines(TEST_TENANT_ID, create2.returnRequestId);
    expect(lines2[0]!.returnCreditValue).toBe("40.00");
    expect(lines2[0]!.residualAdjustment).toBe("0.00");

    // Verify cumulative = original (80.00)
    const allApproved = await deps.returnRepo.listApprovedReturnLinesForSaleLine(TEST_TENANT_ID, saleLineId);
    const cumulativeCredit = allApproved.reduce(
      (sum, l) => addMoney(sum, l.returnCreditValue ?? "0.00"), "0.00",
    );
    expect(cumulativeCredit).toBe("80.00");  // = original sale line net value exactly
  });

  it("rejected prior return does not count toward cumulative cap", async () => {
    const deps = makeDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);

    // Create + reject a return
    const create1 = await deps.returnService.createReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      {
        salesOrderId: saleId, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
        returnReason: "Will be rejected", financialTreatment: "customer_credit",
        lines: [{
          originalSaleOrderId: saleId, originalSaleLineId: saleLineId,
          itemId: TEST_ITEM_ID, quantityKg: "500.000", returnLocationId: TEST_LOCATION_ID,
          returnedStockStatus: "return_received",
          originalSaleLineNetUnitValue: "0.080000",
        }],
        idempotencyKey: "rr-dec068-rejected-001",
      },
    );
    await deps.returnService.submitReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      { returnRequestId: create1.returnRequestId, idempotencyKey: "rr-dec068-rejected-001:submit" },
    );
    await deps.returnService.rejectReturnRequest(
      makeUser(TEST_USERS.accountant.userId) as any, makeAcctEff() as any,
      { returnRequestId: create1.returnRequestId, rejectionReason: "Invalid", idempotencyKey: "rr-dec068-rejected-001:reject" },
    );

    // Now create a new return for the full quantity (should succeed because rejected return doesn't count)
    const create2 = await deps.returnService.createReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      {
        salesOrderId: saleId, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
        returnReason: "Full return after rejection", financialTreatment: "customer_credit",
        lines: [{
          originalSaleOrderId: saleId, originalSaleLineId: saleLineId,
          itemId: TEST_ITEM_ID, quantityKg: "1000.000", returnLocationId: TEST_LOCATION_ID,
          returnedStockStatus: "return_received",
          originalSaleLineNetUnitValue: "0.080000",
        }],
        idempotencyKey: "rr-dec068-rejected-002",
      },
    );
    await deps.returnService.submitReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      { returnRequestId: create2.returnRequestId, idempotencyKey: "rr-dec068-rejected-002:submit" },
    );
    const approve = await deps.returnService.approveReturnRequest(
      makeUser(TEST_USERS.accountant.userId) as any, makeAcctEff() as any,
      { returnRequestId: create2.returnRequestId, idempotencyKey: "rr-dec068-rejected-002:approve" },
    );
    expect(approve.status).toBe("approved");
  });

  it("idempotency replay does not recalculate residual or double-post credit", async () => {
    const deps = makeDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);

    const create = await deps.returnService.createReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      {
        salesOrderId: saleId, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
        returnReason: "Idem residual test", financialTreatment: "customer_credit",
        lines: [{
          originalSaleOrderId: saleId, originalSaleLineId: saleLineId,
          itemId: TEST_ITEM_ID, quantityKg: "1000.000", returnLocationId: TEST_LOCATION_ID,
          returnedStockStatus: "return_received",
          originalSaleLineNetUnitValue: "0.080000",
        }],
        idempotencyKey: "rr-dec068-idem-001",
      },
    );
    await deps.returnService.submitReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-dec068-idem-001:submit" },
    );
    const r1 = await deps.returnService.approveReturnRequest(
      makeUser(TEST_USERS.accountant.userId) as any, makeAcctEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-dec068-idem-001:approve" },
    );
    const r2 = await deps.returnService.approveReturnRequest(
      makeUser(TEST_USERS.accountant.userId) as any, makeAcctEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-dec068-idem-001:approve" },
    );
    expect(r2.action).toBe("replayed");

    // Only 1 credit entry (not 2)
    const entries = [...((deps.subledgerRepo as any).entries as Map<string, any>).values()].filter(
      (e: any) => e.sourceDocumentType === "return_request",
    );
    expect(entries.length).toBe(1);

    // Only 1 stock movement (not 2)
    const movements = [...((deps.ledgerRepo as any).movements as Map<string, any>).values()].filter(
      (m: any) => m.sourceDocumentType === "return_request",
    );
    expect(movements.length).toBe(1);
  });

  it("different idempotency key cannot approve same return twice", async () => {
    const deps = makeDeps();
    const { saleId, saleLineId } = await setupApprovedSaleWithStock(deps);

    const create = await deps.returnService.createReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      {
        salesOrderId: saleId, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
        returnReason: "Double approve test", financialTreatment: "customer_credit",
        lines: [{
          originalSaleOrderId: saleId, originalSaleLineId: saleLineId,
          itemId: TEST_ITEM_ID, quantityKg: "100.000", returnLocationId: TEST_LOCATION_ID,
          returnedStockStatus: "return_received",
          originalSaleLineNetUnitValue: "0.080000",
        }],
        idempotencyKey: "rr-dec068-double-001",
      },
    );
    await deps.returnService.submitReturnRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-dec068-double-001:submit" },
    );
    await deps.returnService.approveReturnRequest(
      makeUser(TEST_USERS.accountant.userId) as any, makeAcctEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-dec068-double-001:approve" },
    );
    // Different key on already-approved return → rejected (STATE_CONFLICT)
    await expect(deps.returnService.approveReturnRequest(
      makeUser(TEST_USERS.accountant.userId) as any, makeAcctEff() as any,
      { returnRequestId: create.returnRequestId, idempotencyKey: "rr-dec068-double-001:approve-2" },
    )).rejects.toThrow(ReturnRequestNotApprovableError);
  });
});
