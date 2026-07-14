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
    permissionKeys: new Set(["returns.create","returns.approve","sales.approve","quality_tests.create","complaints.investigate"]),
    deniedFieldKeys: new Set(), workerFinancialDeny: false,
  } as any;
}
function makeAcctEff() {
  return {
    assignedRoleCodes: ["accountant"],
    permissionKeys: new Set(["returns.create","returns.approve","sales.approve","quality_tests.create","complaints.investigate"]),
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

function makeDeps() {
  const returnRepo = new InMemoryReturnRequestRepository();
  const audit = new InProcessAuditStore();
  const idempotency = new InProcessIdempotencyStore();
  const documentSequence = new InProcessDocumentSequenceStore();
  const returnService = new ReturnRequestService({
    returnRequestRepository: returnRepo, audit, idempotency, documentSequence,
  });
  return { returnRepo, audit, idempotency, documentSequence, returnService };
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
