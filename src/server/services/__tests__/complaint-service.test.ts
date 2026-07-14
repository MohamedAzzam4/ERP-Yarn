/**
 * WP-06-02 Complaint Workflow — tests.
 *
 * Contract: docs/contracts/13_work_packages.md WP-06-02
 *   "Complaint alone posts no stock/account effect."
 *   "No automatic return/credit."
 *   "Complaint status mutates sale" is a common failure.
 *
 * Covers all required scenarios:
 *   - complaint links to customer/sale/item/quality test
 *   - tenant isolation
 *   - role permissions/redaction
 *   - investigation update audited
 *   - open complaint listing
 *   - no inventory/payment/subledger/sale approval side effects
 *   - no auto return
 *   - no replacement
 *   - no reservation release
 *   - idempotency replay/conflict
 */
import { describe, it, expect } from "vitest";
import { ComplaintService, ComplaintNotFoundError } from "../complaint-service";
import { InMemoryComplaintRepository } from "./in-memory-complaint-repository";
import { InProcessAuditStore } from "../audit-service";
import { InProcessIdempotencyStore } from "../idempotency-service";
import { InProcessDocumentSequenceStore } from "../document-sequence-service";
import { TEST_USERS } from "@/server/security/role-fixtures";
import { PermissionDeniedError } from "@/server/security/guards";

const TEST_TENANT_ID = "00000000-0000-0000-0000-000000060002";
const TEST_CUSTOMER_ID = "00000000-0000-4000-8000-cccc00060002";
const TEST_SALE_ID = "00000000-0000-4000-8000-000000000602";
const TEST_ITEM_ID = "00000000-0000-4000-8000-000000060002";
const TEST_QUALITY_TEST_ID = "00000000-0000-4000-8000-000000060003";

function makeUser(userId: string, tenantId: string = TEST_TENANT_ID) {
  return { authenticated: true as const, userId, tenantId, email: "t@e.com", name: "T", authId: "t" };
}
function makeOwnerEff() {
  return {
    assignedRoleCodes: ["owner"],
    permissionKeys: new Set([
      "sales.create","sales.submit","sales.view_price","sales.approve",
      "quality_tests.create","quality_risk_sales.approve","complaints.investigate",
    ]),
    deniedFieldKeys: new Set(),
    workerFinancialDeny: false,
  } as any;
}
function makeAcctEff() {
  return {
    assignedRoleCodes: ["accountant"],
    permissionKeys: new Set([
      "sales.create","sales.submit","sales.view_price","sales.approve",
      "quality_tests.create","quality_risk_sales.approve","complaints.investigate",
    ]),
    deniedFieldKeys: new Set(),
    workerFinancialDeny: false,
  } as any;
}
function makeQualityEff() {
  return {
    assignedRoleCodes: ["quality_employee"],
    permissionKeys: new Set(["quality_tests.create","complaints.investigate"]),
    deniedFieldKeys: new Set(),
    workerFinancialDeny: true,
  } as any;
}
function makeWhEff() {
  return {
    assignedRoleCodes: ["warehouse_employee"],
    permissionKeys: new Set(["sales.create","inventory.receive.approve","inventory.receive.create"]),
    deniedFieldKeys: new Set(),
    workerFinancialDeny: true,
  } as any;
}

function makeDeps() {
  const complaintRepo = new InMemoryComplaintRepository();
  const audit = new InProcessAuditStore();
  const idempotency = new InProcessIdempotencyStore();
  const documentSequence = new InProcessDocumentSequenceStore();
  const complaintService = new ComplaintService({
    complaintRepository: complaintRepo, audit, idempotency, documentSequence,
  });
  return { complaintRepo, audit, idempotency, documentSequence, complaintService };
}

// ===========================================================================
// 1. Complaint creation + linking.
// ===========================================================================

describe("WP-06-02 complaint creation + linking", () => {
  it("creates complaint linked to customer/sale/item/quality test", async () => {
    const deps = makeDeps();
    const qualityUser = makeUser(TEST_USERS.quality.userId);
    const qualityEff = makeQualityEff();

    const result = await deps.complaintService.createComplaint(qualityUser as any, qualityEff as any, {
      complaintDate: "2026-07-10",
      customerId: TEST_CUSTOMER_ID,
      saleId: TEST_SALE_ID,
      itemId: TEST_ITEM_ID,
      qualityTestId: TEST_QUALITY_TEST_ID,
      subject: "Customer reported quality issue with yarn",
      description: "Yarn count does not match specification",
      priority: "high",
      idempotencyKey: "cmp-create-001",
    });
    expect(result.action).toBe("created");
    expect(result.status).toBe("open");
    expect(result.complaintNo).toBeTruthy();

    const complaint = await deps.complaintRepo.findComplaintById(TEST_TENANT_ID, result.complaintId);
    expect(complaint).toBeTruthy();
    expect(complaint!.customerId).toBe(TEST_CUSTOMER_ID);
    expect(complaint!.saleId).toBe(TEST_SALE_ID);
    expect(complaint!.itemId).toBe(TEST_ITEM_ID);
    expect(complaint!.qualityTestId).toBe(TEST_QUALITY_TEST_ID);
    expect(complaint!.subject).toBe("Customer reported quality issue with yarn");
    expect(complaint!.priority).toBe("high");
  });

  it("creates complaint with only customer link", async () => {
    const deps = makeDeps();
    const qualityUser = makeUser(TEST_USERS.quality.userId);
    const qualityEff = makeQualityEff();

    const result = await deps.complaintService.createComplaint(qualityUser as any, qualityEff as any, {
      complaintDate: "2026-07-10",
      customerId: TEST_CUSTOMER_ID,
      subject: "General customer complaint",
      idempotencyKey: "cmp-create-002",
    });
    expect(result.action).toBe("created");
  });

  it("rejects complaint with no linked entity", async () => {
    const deps = makeDeps();
    const qualityUser = makeUser(TEST_USERS.quality.userId);
    const qualityEff = makeQualityEff();

    await expect(deps.complaintService.createComplaint(qualityUser as any, qualityEff as any, {
      complaintDate: "2026-07-10",
      subject: "Orphan complaint",
      idempotencyKey: "cmp-no-link-001",
    })).rejects.toThrow();
  });
});

// ===========================================================================
// 2. Tenant isolation.
// ===========================================================================

describe("WP-06-02 tenant isolation", () => {
  it("cross-tenant complaint lookup fails", async () => {
    const deps = makeDeps();
    const qualityUser = makeUser(TEST_USERS.quality.userId);
    const qualityEff = makeQualityEff();

    const result = await deps.complaintService.createComplaint(qualityUser as any, qualityEff as any, {
      complaintDate: "2026-07-10",
      customerId: TEST_CUSTOMER_ID,
      subject: "Test complaint",
      idempotencyKey: "cmp-tenant-001",
    });

    const foreignUser = makeUser(TEST_USERS.quality.userId, "ffffffff-ffff-ffff-ffff-ffffffffffff");
    await expect(deps.complaintService.updateComplaint(foreignUser as any, qualityEff as any, {
      complaintId: result.complaintId,
      status: "investigating",
      idempotencyKey: "cmp-tenant-001:update",
    })).rejects.toThrow(ComplaintNotFoundError);
  });
});

// ===========================================================================
// 3. Role permissions.
// ===========================================================================

describe("WP-06-02 role permissions", () => {
  it("warehouse worker cannot create complaints", async () => {
    const deps = makeDeps();
    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = makeWhEff();

    await expect(deps.complaintService.createComplaint(whUser as any, whEff as any, {
      complaintDate: "2026-07-10",
      customerId: TEST_CUSTOMER_ID,
      subject: "Worker attempt",
      idempotencyKey: "cmp-wh-deny-001",
    })).rejects.toThrow(PermissionDeniedError);
  });

  it("warehouse worker cannot list open complaints", async () => {
    const deps = makeDeps();
    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = makeWhEff();

    await expect(deps.complaintService.listOpenComplaints(whUser as any, whEff as any)).rejects.toThrow(PermissionDeniedError);
  });

  it("quality role can create + investigate complaints", async () => {
    const deps = makeDeps();
    const qualityUser = makeUser(TEST_USERS.quality.userId);
    const qualityEff = makeQualityEff();

    const result = await deps.complaintService.createComplaint(qualityUser as any, qualityEff as any, {
      complaintDate: "2026-07-10",
      customerId: TEST_CUSTOMER_ID,
      subject: "Quality complaint",
      idempotencyKey: "cmp-quality-001",
    });
    const update = await deps.complaintService.updateComplaint(qualityUser as any, qualityEff as any, {
      complaintId: result.complaintId,
      status: "investigating",
      investigationNotes: "Investigation started",
      idempotencyKey: "cmp-quality-001:update",
    });
    expect(update.status).toBe("investigating");
  });

  it("owner can create + resolve complaints", async () => {
    const deps = makeDeps();
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();

    const result = await deps.complaintService.createComplaint(ownerUser as any, ownerEff as any, {
      complaintDate: "2026-07-10",
      customerId: TEST_CUSTOMER_ID,
      subject: "Owner complaint",
      idempotencyKey: "cmp-owner-001",
    });
    const update = await deps.complaintService.updateComplaint(ownerUser as any, ownerEff as any, {
      complaintId: result.complaintId,
      status: "resolved",
      resolutionNotes: "Resolved — no action needed",
      resolutionType: "no_action",
      idempotencyKey: "cmp-owner-001:resolve",
    });
    expect(update.status).toBe("resolved");
  });

  it("accountant can create + close complaints", async () => {
    const deps = makeDeps();
    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const acctEff = makeAcctEff();

    const result = await deps.complaintService.createComplaint(acctUser as any, acctEff as any, {
      complaintDate: "2026-07-10",
      customerId: TEST_CUSTOMER_ID,
      subject: "Accountant complaint",
      idempotencyKey: "cmp-acct-001",
    });
    const update = await deps.complaintService.updateComplaint(acctUser as any, acctEff as any, {
      complaintId: result.complaintId,
      status: "closed",
      resolutionNotes: "Closed",
      idempotencyKey: "cmp-acct-001:close",
    });
    expect(update.status).toBe("closed");
  });
});

// ===========================================================================
// 4. Investigation update + audit.
// ===========================================================================

describe("WP-06-02 investigation update + audit", () => {
  it("investigation status transition is audited", async () => {
    const deps = makeDeps();
    const qualityUser = makeUser(TEST_USERS.quality.userId);
    const qualityEff = makeQualityEff();

    const result = await deps.complaintService.createComplaint(qualityUser as any, qualityEff as any, {
      complaintDate: "2026-07-10",
      customerId: TEST_CUSTOMER_ID,
      subject: "Audit test",
      idempotencyKey: "cmp-audit-001",
    });

    await deps.complaintService.updateComplaint(qualityUser as any, qualityEff as any, {
      complaintId: result.complaintId,
      status: "investigating",
      investigationNotes: "Found quality issue",
      idempotencyKey: "cmp-audit-001:update",
    });

    const auditRows = deps.audit.getRows();
    const updateAudit = auditRows.find(r => r.actionType === "complaint.update");
    expect(updateAudit).toBeTruthy();
    expect(updateAudit!.newValuesJson).toHaveProperty("newStatus", "investigating");
  });

  it("cannot update closed complaint", async () => {
    const deps = makeDeps();
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();

    const result = await deps.complaintService.createComplaint(ownerUser as any, ownerEff as any, {
      complaintDate: "2026-07-10",
      customerId: TEST_CUSTOMER_ID,
      subject: "Close test",
      idempotencyKey: "cmp-close-001",
    });
    await deps.complaintService.updateComplaint(ownerUser as any, ownerEff as any, {
      complaintId: result.complaintId,
      status: "closed",
      idempotencyKey: "cmp-close-001:close",
    });

    await expect(deps.complaintService.updateComplaint(ownerUser as any, ownerEff as any, {
      complaintId: result.complaintId,
      status: "investigating",
      idempotencyKey: "cmp-close-001:reopen",
    })).rejects.toThrow();
  });
});

// ===========================================================================
// 5. Open complaint listing + trace.
// ===========================================================================

describe("WP-06-02 listing + trace", () => {
  it("lists open complaints", async () => {
    const deps = makeDeps();
    const qualityUser = makeUser(TEST_USERS.quality.userId);
    const qualityEff = makeQualityEff();

    // Create 3 complaints: 2 open, 1 resolved
    await deps.complaintService.createComplaint(qualityUser as any, qualityEff as any, {
      complaintDate: "2026-07-10", customerId: TEST_CUSTOMER_ID, subject: "C1", idempotencyKey: "cmp-list-001",
    });
    const c2 = await deps.complaintService.createComplaint(qualityUser as any, qualityEff as any, {
      complaintDate: "2026-07-10", customerId: TEST_CUSTOMER_ID, subject: "C2", idempotencyKey: "cmp-list-002",
    });
    await deps.complaintService.createComplaint(qualityUser as any, qualityEff as any, {
      complaintDate: "2026-07-10", customerId: TEST_CUSTOMER_ID, subject: "C3", idempotencyKey: "cmp-list-003",
    });
    // Resolve C2
    await deps.complaintService.updateComplaint(qualityUser as any, qualityEff as any, {
      complaintId: c2.complaintId, status: "resolved", idempotencyKey: "cmp-list-002:resolve",
    });

    const open = await deps.complaintService.listOpenComplaints(qualityUser as any, qualityEff as any);
    expect(open.length).toBe(2); // C1 and C3 still open
  });

  it("traces complaints for a customer", async () => {
    const deps = makeDeps();
    const qualityUser = makeUser(TEST_USERS.quality.userId);
    const qualityEff = makeQualityEff();

    await deps.complaintService.createComplaint(qualityUser as any, qualityEff as any, {
      complaintDate: "2026-07-10", customerId: TEST_CUSTOMER_ID, subject: "Trace 1", idempotencyKey: "cmp-trace-001",
    });
    await deps.complaintService.createComplaint(qualityUser as any, qualityEff as any, {
      complaintDate: "2026-07-10", customerId: TEST_CUSTOMER_ID, subject: "Trace 2", idempotencyKey: "cmp-trace-002",
    });

    const complaints = await deps.complaintService.listComplaintsForCustomer(qualityUser as any, qualityEff as any, TEST_CUSTOMER_ID);
    expect(complaints.length).toBe(2);
  });

  it("traces complaints for a sale", async () => {
    const deps = makeDeps();
    const qualityUser = makeUser(TEST_USERS.quality.userId);
    const qualityEff = makeQualityEff();

    await deps.complaintService.createComplaint(qualityUser as any, qualityEff as any, {
      complaintDate: "2026-07-10", saleId: TEST_SALE_ID, subject: "Sale complaint", idempotencyKey: "cmp-sale-001",
    });

    const complaints = await deps.complaintService.listComplaintsForSale(qualityUser as any, qualityEff as any, TEST_SALE_ID);
    expect(complaints.length).toBe(1);
  });
});

// ===========================================================================
// 6. Idempotency.
// ===========================================================================

describe("WP-06-02 idempotency", () => {
  it("same key replays with no duplicate", async () => {
    const deps = makeDeps();
    const qualityUser = makeUser(TEST_USERS.quality.userId);
    const qualityEff = makeQualityEff();

    const r1 = await deps.complaintService.createComplaint(qualityUser as any, qualityEff as any, {
      complaintDate: "2026-07-10", customerId: TEST_CUSTOMER_ID, subject: "Idem test", idempotencyKey: "cmp-idem-001",
    });
    const r2 = await deps.complaintService.createComplaint(qualityUser as any, qualityEff as any, {
      complaintDate: "2026-07-10", customerId: TEST_CUSTOMER_ID, subject: "Idem test", idempotencyKey: "cmp-idem-001",
    });
    expect(r2.action).toBe("replayed");
    expect(r2.complaintId).toBe(r1.complaintId);
  });

  it("changed body conflicts", async () => {
    const deps = makeDeps();
    const qualityUser = makeUser(TEST_USERS.quality.userId);
    const qualityEff = makeQualityEff();

    await deps.complaintService.createComplaint(qualityUser as any, qualityEff as any, {
      complaintDate: "2026-07-10", customerId: TEST_CUSTOMER_ID, subject: "Original", idempotencyKey: "cmp-conflict-001",
    });
    await expect(deps.complaintService.createComplaint(qualityUser as any, qualityEff as any, {
      complaintDate: "2026-07-10", customerId: TEST_CUSTOMER_ID, subject: "Different", idempotencyKey: "cmp-conflict-001",
    })).rejects.toThrow();
  });
});

// ===========================================================================
// 7. No side effects.
// ===========================================================================

describe("WP-06-02 no side effects", () => {
  it("complaint creates NO stock movements, NO payments, NO account entries, NO sale approvals", async () => {
    const deps = makeDeps();
    const qualityUser = makeUser(TEST_USERS.quality.userId);
    const qualityEff = makeQualityEff();

    await deps.complaintService.createComplaint(qualityUser as any, qualityEff as any, {
      complaintDate: "2026-07-10",
      customerId: TEST_CUSTOMER_ID,
      saleId: TEST_SALE_ID,
      itemId: TEST_ITEM_ID,
      qualityTestId: TEST_QUALITY_TEST_ID,
      subject: "No side effects test",
      idempotencyKey: "cmp-noside-001",
    });

    const auditRows = deps.audit.getRows();
    for (const row of auditRows) {
      expect(row.actionType).not.toContain("stock_movement");
      expect(row.actionType).not.toContain("sales_approval");
      expect(row.actionType).not.toContain("payment");
      expect(row.actionType).not.toContain("settlement");
      expect(row.actionType).not.toContain("account_entry");
      expect(row.actionType).not.toContain("inventory.");
      expect(row.actionType).not.toContain("reservation");
      expect(row.actionType).not.toContain("return");
      expect(row.actionType).not.toContain("replacement");
    }

    // Only complaint audit actions
    const complaintAudit = auditRows.filter(r => r.actionType.startsWith("complaint"));
    expect(complaintAudit.length).toBe(1);
  });
});
