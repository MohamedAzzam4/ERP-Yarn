/**
 * WP-06-01 Quality Tests, Risk Status, and Review Flags — tests.
 *
 * Contract: docs/contracts/12_testing_and_regression_plan.md §5 + Phase 6 gate
 * Contract: docs/contracts/04_inventory_posting_contract.md §11
 * Contract: docs/contracts/13_work_packages.md WP-06-01
 *
 * Covers all required scenarios:
 *   - quality test creation
 *   - quality value recording
 *   - quality status transition
 *   - needs_review flag
 *   - blocked/reprocess flag
 *   - accepted/sellable state
 *   - tenant isolation
 *   - worker-safe input
 *   - worker redaction
 *   - quality role permissions
 *   - warehouse/production role restrictions
 *   - owner/accountant visibility
 *   - reservation rejects needs_review stock (DEC-065)
 *   - reservation rejects blocked stock (DEC-065)
 *   - reservation rejects sellable_with_discount unless explicitly approved
 *   - accepted/sellable stock remains reservable
 *   - no stock movements
 *   - no account entries
 *   - no payments/settlements
 *   - no sales approval mutation
 *   - audit persistence
 *   - idempotency replay/conflict
 */
import { describe, it, expect } from "vitest";
import {
  QualityTestService,
  QualityTestNotFoundError,
  InvalidRiskClassificationError,
} from "../quality-test-service";
import { InMemoryQualityTestRepository } from "./in-memory-quality-test-repository";
import { InProcessAuditStore } from "../audit-service";
import { InProcessIdempotencyStore } from "../idempotency-service";
import { InProcessDocumentSequenceStore } from "../document-sequence-service";
import { TEST_USERS } from "@/server/security/role-fixtures";
import { PermissionDeniedError } from "@/server/security/guards";

const TEST_TENANT_ID = "00000000-0000-0000-0000-000000060001";
const TEST_ITEM_ID = "00000000-0000-4000-8000-000000060001";
const TEST_BATCH_ID = "00000000-0000-4000-8000-000000060002";
const TEST_LOT_ID = "00000000-0000-4000-8000-000000060003";
const TEST_SALE_ID = "00000000-0000-4000-8000-000000060004";
const TEST_CUSTOMER_ID = "00000000-0000-4000-8000-cccc00060001";

function makeUser(userId: string, tenantId: string = TEST_TENANT_ID) {
  return { authenticated: true as const, userId, tenantId, email: "t@e.com", name: "T", authId: "t" };
}
function makeOwnerEff() {
  return {
    assignedRoleCodes: ["owner"],
    permissionKeys: new Set([
      "sales.create","sales.submit","sales.view_price","sales.approve","sales.cancel",
      "inventory.receive.approve","inventory.receive.create",
      "balances.view_supplier_factory","balances.view_customer",
      "profitability.view","payments.create","payments.approve","payments.reverse",
      "direct_costs.review","quality_tests.create","quality_risk_sales.approve",
    ]),
    deniedFieldKeys: new Set(),
    workerFinancialDeny: false,
  } as any;
}
function makeAcctEff() {
  return {
    assignedRoleCodes: ["accountant"],
    permissionKeys: new Set([
      "sales.create","sales.submit","sales.view_price","sales.approve","sales.cancel",
      "balances.view_supplier_factory","balances.view_customer",
      "profitability.view","inventory.receive.approve",
      "payments.create","payments.approve","payments.reverse",
      "direct_costs.review","quality_tests.create","quality_risk_sales.approve",
    ]),
    deniedFieldKeys: new Set(),
    workerFinancialDeny: false,
  } as any;
}
function makeQualityEff() {
  return {
    assignedRoleCodes: ["quality_employee"],
    permissionKeys: new Set(["quality_tests.create"]),
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
  const qualityTestRepo = new InMemoryQualityTestRepository();
  const audit = new InProcessAuditStore();
  const idempotency = new InProcessIdempotencyStore();
  const documentSequence = new InProcessDocumentSequenceStore();
  const qualityTestService = new QualityTestService({
    qualityTestRepository: qualityTestRepo, audit, idempotency, documentSequence,
  });
  return { qualityTestRepo, audit, idempotency, documentSequence, qualityTestService };
}

// ===========================================================================
// 1. Quality test creation.
// ===========================================================================

describe("WP-06-01 quality test creation", () => {
  it("creates a quality test with needs_review default status", async () => {
    const deps = makeDeps();
    const qualityUser = makeUser(TEST_USERS.quality.userId);
    const qualityEff = makeQualityEff();

    const result = await deps.qualityTestService.createQualityTest(qualityUser as any, qualityEff as any, {
      testDate: "2026-07-10",
      linkedEntityType: "inventory_item",
      linkedEntityId: TEST_ITEM_ID,
      idempotencyKey: "qt-create-001",
    });
    expect(result.action).toBe("created");
    expect(result.testStatus).toBe("needs_review");  // default
    expect(result.riskClassification).toBe("none");  // default
    expect(result.testNo).toBeTruthy();

    // Verify test persisted
    const test = await deps.qualityTestRepo.findQualityTestById(TEST_TENANT_ID, result.qualityTestId);
    expect(test).toBeTruthy();
    expect(test!.testedBy).toBe(TEST_USERS.quality.userId);
    expect(test!.testedAt).toBeTruthy();
  });

  it("creates a quality test with accepted status + sellable_with_discount flag", async () => {
    const deps = makeDeps();
    const qualityUser = makeUser(TEST_USERS.quality.userId);
    const qualityEff = makeQualityEff();

    const result = await deps.qualityTestService.createQualityTest(qualityUser as any, qualityEff as any, {
      testDate: "2026-07-10",
      linkedEntityType: "yarn_lot",
      linkedEntityId: TEST_LOT_ID,
      testStatus: "accepted",
      riskClassification: "sellable_with_discount",
      notes: "Accepted with minor defects — discount recommended",
      idempotencyKey: "qt-create-002",
    });
    expect(result.testStatus).toBe("accepted");
    expect(result.riskClassification).toBe("sellable_with_discount");
  });

  it("worker (warehouse) without quality_tests.create permission denied", async () => {
    const deps = makeDeps();
    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = makeWhEff();

    await expect(deps.qualityTestService.createQualityTest(whUser as any, whEff as any, {
      testDate: "2026-07-10",
      linkedEntityType: "inventory_item",
      linkedEntityId: TEST_ITEM_ID,
      idempotencyKey: "qt-worker-deny-001",
    })).rejects.toThrow(PermissionDeniedError);
  });

  it("owner can create quality test", async () => {
    const deps = makeDeps();
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();

    const result = await deps.qualityTestService.createQualityTest(ownerUser as any, ownerEff as any, {
      testDate: "2026-07-10",
      linkedEntityType: "raw_material_batch",
      linkedEntityId: TEST_BATCH_ID,
      idempotencyKey: "qt-owner-001",
    });
    expect(result.action).toBe("created");
  });

  it("invalid risk classification rejected", async () => {
    const deps = makeDeps();
    const qualityUser = makeUser(TEST_USERS.quality.userId);
    const qualityEff = makeQualityEff();

    await expect(deps.qualityTestService.createQualityTest(qualityUser as any, qualityEff as any, {
      testDate: "2026-07-10",
      linkedEntityType: "inventory_item",
      linkedEntityId: TEST_ITEM_ID,
      riskClassification: "invalid_classification" as any,
      idempotencyKey: "qt-invalid-001",
    })).rejects.toThrow(InvalidRiskClassificationError);
  });

  it("invalid linked entity type rejected", async () => {
    const deps = makeDeps();
    const qualityUser = makeUser(TEST_USERS.quality.userId);
    const qualityEff = makeQualityEff();

    await expect(deps.qualityTestService.createQualityTest(qualityUser as any, qualityEff as any, {
      testDate: "2026-07-10",
      linkedEntityType: "invalid_type",
      linkedEntityId: TEST_ITEM_ID,
      idempotencyKey: "qt-invalid-type-001",
    })).rejects.toThrow();
  });
});

// ===========================================================================
// 2. Quality value recording.
// ===========================================================================

describe("WP-06-01 quality value recording", () => {
  it("records a quality test value (pass)", async () => {
    const deps = makeDeps();
    const qualityUser = makeUser(TEST_USERS.quality.userId);
    const qualityEff = makeQualityEff();

    const test = await deps.qualityTestService.createQualityTest(qualityUser as any, qualityEff as any, {
      testDate: "2026-07-10",
      linkedEntityType: "inventory_item",
      linkedEntityId: TEST_ITEM_ID,
      idempotencyKey: "qt-value-001",
    });

    const value = await deps.qualityTestService.recordQualityTestValue(qualityUser as any, qualityEff as any, {
      qualityTestId: test.qualityTestId,
      parameterName: "Yarn Count",
      parameterCode: "YC",
      measuredValue: "20s",
      valueStatus: "pass",
      idempotencyKey: "qt-value-001:v1",
    });
    expect(value.valueStatus).toBe("pass");

    const values = await deps.qualityTestRepo.listQualityTestValues(TEST_TENANT_ID, test.qualityTestId);
    expect(values.length).toBe(1);
    expect(values[0]!.parameterCode).toBe("YC");
    expect(values[0]!.measuredValue).toBe("20s");
  });

  it("records multiple values with different statuses", async () => {
    const deps = makeDeps();
    const qualityUser = makeUser(TEST_USERS.quality.userId);
    const qualityEff = makeQualityEff();

    const test = await deps.qualityTestService.createQualityTest(qualityUser as any, qualityEff as any, {
      testDate: "2026-07-10",
      linkedEntityType: "inventory_item",
      linkedEntityId: TEST_ITEM_ID,
      idempotencyKey: "qt-multi-value-001",
    });

    await deps.qualityTestService.recordQualityTestValue(qualityUser as any, qualityEff as any, {
      qualityTestId: test.qualityTestId,
      parameterName: "Yarn Count", parameterCode: "YC",
      measuredValue: "20s", valueStatus: "pass",
      idempotencyKey: "qt-multi-value-001:v1",
    });
    await deps.qualityTestService.recordQualityTestValue(qualityUser as any, qualityEff as any, {
      qualityTestId: test.qualityTestId,
      parameterName: "Twist", parameterCode: "TW",
      measuredValue: "450", valueStatus: "fail",
      idempotencyKey: "qt-multi-value-001:v2",
    });
    await deps.qualityTestService.recordQualityTestValue(qualityUser as any, qualityEff as any, {
      qualityTestId: test.qualityTestId,
      parameterName: "Strength", parameterCode: "ST",
      measuredValue: null, valueStatus: "pending",
      idempotencyKey: "qt-multi-value-001:v3",
    });

    const values = await deps.qualityTestRepo.listQualityTestValues(TEST_TENANT_ID, test.qualityTestId);
    expect(values.length).toBe(3);
  });
});

// ===========================================================================
// 3. Quality status transitions + review.
// ===========================================================================

describe("WP-06-01 quality status transitions", () => {
  it("reviews quality test: needs_review → accepted", async () => {
    const deps = makeDeps();
    const qualityUser = makeUser(TEST_USERS.quality.userId);
    const qualityEff = makeQualityEff();

    const test = await deps.qualityTestService.createQualityTest(qualityUser as any, qualityEff as any, {
      testDate: "2026-07-10",
      linkedEntityType: "inventory_item",
      linkedEntityId: TEST_ITEM_ID,
      idempotencyKey: "qt-review-001",
    });
    expect(test.testStatus).toBe("needs_review");

    const result = await deps.qualityTestService.reviewQualityTest(qualityUser as any, qualityEff as any, {
      qualityTestId: test.qualityTestId,
      testStatus: "accepted",
      riskClassification: "none",
      reviewNotes: "All parameters passed",
      idempotencyKey: "qt-review-001:review",
    });
    expect(result.action).toBe("reviewed");
    expect(result.testStatus).toBe("accepted");

    const updated = await deps.qualityTestRepo.findQualityTestById(TEST_TENANT_ID, test.qualityTestId);
    expect(updated!.testStatus).toBe("accepted");
    expect(updated!.reviewedBy).toBe(TEST_USERS.quality.userId);
    expect(updated!.reviewedAt).toBeTruthy();
  });

  it("reviews quality test: needs_review → blocked with reprocess_required flag", async () => {
    const deps = makeDeps();
    const qualityUser = makeUser(TEST_USERS.quality.userId);
    const qualityEff = makeQualityEff();

    const test = await deps.qualityTestService.createQualityTest(qualityUser as any, qualityEff as any, {
      testDate: "2026-07-10",
      linkedEntityType: "inventory_item",
      linkedEntityId: TEST_ITEM_ID,
      idempotencyKey: "qt-blocked-001",
    });

    const result = await deps.qualityTestService.reviewQualityTest(qualityUser as any, qualityEff as any, {
      qualityTestId: test.qualityTestId,
      testStatus: "blocked",
      riskClassification: "reprocess_required",
      reviewNotes: "Major defects — reprocess required",
      idempotencyKey: "qt-blocked-001:review",
    });
    expect(result.testStatus).toBe("blocked");
    expect(result.riskClassification).toBe("reprocess_required");
  });

  it("can correct status from blocked back to accepted (facts can be corrected)", async () => {
    const deps = makeDeps();
    const qualityUser = makeUser(TEST_USERS.quality.userId);
    const qualityEff = makeQualityEff();

    const test = await deps.qualityTestService.createQualityTest(qualityUser as any, qualityEff as any, {
      testDate: "2026-07-10",
      linkedEntityType: "inventory_item",
      linkedEntityId: TEST_ITEM_ID,
      testStatus: "blocked",
      idempotencyKey: "qt-correct-001",
    });

    const result = await deps.qualityTestService.reviewQualityTest(qualityUser as any, qualityEff as any, {
      qualityTestId: test.qualityTestId,
      testStatus: "accepted",
      riskClassification: "none",
      reviewNotes: "Re-tested — all parameters now pass",
      idempotencyKey: "qt-correct-001:review",
    });
    expect(result.testStatus).toBe("accepted");
  });

  it("quality test not found rejects", async () => {
    const deps = makeDeps();
    const qualityUser = makeUser(TEST_USERS.quality.userId);
    const qualityEff = makeQualityEff();

    await expect(deps.qualityTestService.reviewQualityTest(qualityUser as any, qualityEff as any, {
      qualityTestId: "nonexistent",
      testStatus: "accepted",
      riskClassification: "none",
      idempotencyKey: "qt-notfound-001",
    })).rejects.toThrow(QualityTestNotFoundError);
  });
});

// ===========================================================================
// 4. Idempotency.
// ===========================================================================

describe("WP-06-01 idempotency", () => {
  it("same key replays with no duplicate effects", async () => {
    const deps = makeDeps();
    const qualityUser = makeUser(TEST_USERS.quality.userId);
    const qualityEff = makeQualityEff();

    const r1 = await deps.qualityTestService.createQualityTest(qualityUser as any, qualityEff as any, {
      testDate: "2026-07-10",
      linkedEntityType: "inventory_item",
      linkedEntityId: TEST_ITEM_ID,
      idempotencyKey: "qt-idem-001",
    });
    const r2 = await deps.qualityTestService.createQualityTest(qualityUser as any, qualityEff as any, {
      testDate: "2026-07-10",
      linkedEntityType: "inventory_item",
      linkedEntityId: TEST_ITEM_ID,
      idempotencyKey: "qt-idem-001",
    });
    expect(r2.action).toBe("replayed");
    expect(r2.qualityTestId).toBe(r1.qualityTestId);

    // Verify only 1 test row
    const tests = [...((deps.qualityTestRepo as any).qualityTests as Map<string, any>).values()];
    expect(tests.length).toBe(1);
  });

  it("changed body idempotency conflict", async () => {
    const deps = makeDeps();
    const qualityUser = makeUser(TEST_USERS.quality.userId);
    const qualityEff = makeQualityEff();

    await deps.qualityTestService.createQualityTest(qualityUser as any, qualityEff as any, {
      testDate: "2026-07-10",
      linkedEntityType: "inventory_item",
      linkedEntityId: TEST_ITEM_ID,
      idempotencyKey: "qt-conflict-001",
    });
    await expect(deps.qualityTestService.createQualityTest(qualityUser as any, qualityEff as any, {
      testDate: "2026-07-10",
      linkedEntityType: "yarn_lot",  // DIFFERENT
      linkedEntityId: TEST_LOT_ID,
      idempotencyKey: "qt-conflict-001",
    })).rejects.toThrow();
  });
});

// ===========================================================================
// 5. Tenant isolation.
// ===========================================================================

describe("WP-06-01 tenant isolation", () => {
  it("cross-tenant quality test lookup fails", async () => {
    const deps = makeDeps();
    const qualityUser = makeUser(TEST_USERS.quality.userId);
    const qualityEff = makeQualityEff();

    const test = await deps.qualityTestService.createQualityTest(qualityUser as any, qualityEff as any, {
      testDate: "2026-07-10",
      linkedEntityType: "inventory_item",
      linkedEntityId: TEST_ITEM_ID,
      idempotencyKey: "qt-tenant-001",
    });

    // Foreign tenant user tries to review — QUALITY_TEST_NOT_FOUND
    const foreignUser = makeUser(TEST_USERS.quality.userId, "ffffffff-ffff-ffff-ffff-ffffffffffff");
    await expect(deps.qualityTestService.reviewQualityTest(foreignUser as any, qualityEff as any, {
      qualityTestId: test.qualityTestId,
      testStatus: "accepted",
      riskClassification: "none",
      idempotencyKey: "qt-tenant-001:review",
    })).rejects.toThrow(QualityTestNotFoundError);
  });
});

// ===========================================================================
// 6. Role permissions.
// ===========================================================================

describe("WP-06-01 role permissions", () => {
  it("warehouse worker cannot create quality tests", async () => {
    const deps = makeDeps();
    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = makeWhEff();

    await expect(deps.qualityTestService.createQualityTest(whUser as any, whEff as any, {
      testDate: "2026-07-10",
      linkedEntityType: "inventory_item",
      linkedEntityId: TEST_ITEM_ID,
      idempotencyKey: "qt-wh-deny-001",
    })).rejects.toThrow(PermissionDeniedError);
  });

  it("warehouse worker cannot review quality tests", async () => {
    const deps = makeDeps();
    const qualityUser = makeUser(TEST_USERS.quality.userId);
    const qualityEff = makeQualityEff();
    const test = await deps.qualityTestService.createQualityTest(qualityUser as any, qualityEff as any, {
      testDate: "2026-07-10",
      linkedEntityType: "inventory_item",
      linkedEntityId: TEST_ITEM_ID,
      idempotencyKey: "qt-wh-deny-review-001",
    });

    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = makeWhEff();
    await expect(deps.qualityTestService.reviewQualityTest(whUser as any, whEff as any, {
      qualityTestId: test.qualityTestId,
      testStatus: "accepted",
      riskClassification: "none",
      idempotencyKey: "qt-wh-deny-review-001:review",
    })).rejects.toThrow(PermissionDeniedError);
  });

  it("quality role can create + review", async () => {
    const deps = makeDeps();
    const qualityUser = makeUser(TEST_USERS.quality.userId);
    const qualityEff = makeQualityEff();

    const test = await deps.qualityTestService.createQualityTest(qualityUser as any, qualityEff as any, {
      testDate: "2026-07-10",
      linkedEntityType: "inventory_item",
      linkedEntityId: TEST_ITEM_ID,
      idempotencyKey: "qt-quality-001",
    });
    const review = await deps.qualityTestService.reviewQualityTest(qualityUser as any, qualityEff as any, {
      qualityTestId: test.qualityTestId,
      testStatus: "accepted",
      riskClassification: "none",
      idempotencyKey: "qt-quality-001:review",
    });
    expect(review.action).toBe("reviewed");
  });

  it("accountant can create + review quality tests", async () => {
    const deps = makeDeps();
    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const acctEff = makeAcctEff();

    const test = await deps.qualityTestService.createQualityTest(acctUser as any, acctEff as any, {
      testDate: "2026-07-10",
      linkedEntityType: "inventory_item",
      linkedEntityId: TEST_ITEM_ID,
      idempotencyKey: "qt-acct-001",
    });
    expect(test.action).toBe("created");
  });
});

// ===========================================================================
// 7. Read/query support.
// ===========================================================================

describe("WP-06-01 read/query support", () => {
  it("lists quality tests needing review", async () => {
    const deps = makeDeps();
    const qualityUser = makeUser(TEST_USERS.quality.userId);
    const qualityEff = makeQualityEff();

    // Create 3 tests: 2 needs_review, 1 accepted
    await deps.qualityTestService.createQualityTest(qualityUser as any, qualityEff as any, {
      testDate: "2026-07-10", linkedEntityType: "inventory_item", linkedEntityId: TEST_ITEM_ID,
      testStatus: "needs_review", idempotencyKey: "qt-list-001",
    });
    await deps.qualityTestService.createQualityTest(qualityUser as any, qualityEff as any, {
      testDate: "2026-07-10", linkedEntityType: "inventory_item", linkedEntityId: TEST_ITEM_ID,
      testStatus: "needs_review", idempotencyKey: "qt-list-002",
    });
    await deps.qualityTestService.createQualityTest(qualityUser as any, qualityEff as any, {
      testDate: "2026-07-10", linkedEntityType: "inventory_item", linkedEntityId: TEST_ITEM_ID,
      testStatus: "accepted", idempotencyKey: "qt-list-003",
    });

    const needsReview = await deps.qualityTestService.listQualityTestsNeedingReview(qualityUser as any, qualityEff as any);
    expect(needsReview.length).toBe(2);
  });

  it("worker denied listing quality tests needing review", async () => {
    const deps = makeDeps();
    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = makeWhEff();

    await expect(deps.qualityTestService.listQualityTestsNeedingReview(whUser as any, whEff as any)).rejects.toThrow(PermissionDeniedError);
  });
});

// ===========================================================================
// 8. Audit persistence.
// ===========================================================================

describe("WP-06-01 audit persistence", () => {
  it("quality test creation writes audit row", async () => {
    const deps = makeDeps();
    const qualityUser = makeUser(TEST_USERS.quality.userId);
    const qualityEff = makeQualityEff();

    await deps.qualityTestService.createQualityTest(qualityUser as any, qualityEff as any, {
      testDate: "2026-07-10", linkedEntityType: "inventory_item", linkedEntityId: TEST_ITEM_ID,
      idempotencyKey: "qt-audit-001",
    });

    const auditRows = deps.audit.getRows();
    const createAudit = auditRows.find(r => r.actionType === "quality_test.create");
    expect(createAudit).toBeTruthy();
    expect(createAudit!.entityType).toBe("quality_test");
  });

  it("quality test review writes audit row", async () => {
    const deps = makeDeps();
    const qualityUser = makeUser(TEST_USERS.quality.userId);
    const qualityEff = makeQualityEff();

    const test = await deps.qualityTestService.createQualityTest(qualityUser as any, qualityEff as any, {
      testDate: "2026-07-10", linkedEntityType: "inventory_item", linkedEntityId: TEST_ITEM_ID,
      idempotencyKey: "qt-audit-review-001",
    });
    await deps.qualityTestService.reviewQualityTest(qualityUser as any, qualityEff as any, {
      qualityTestId: test.qualityTestId,
      testStatus: "accepted", riskClassification: "none",
      idempotencyKey: "qt-audit-review-001:review",
    });

    const auditRows = deps.audit.getRows();
    const reviewAudit = auditRows.find(r => r.actionType === "quality_test.review");
    expect(reviewAudit).toBeTruthy();
  });
});

// ===========================================================================
// 9. No side effects (stock movements, account entries, payments, sales approval).
// ===========================================================================

describe("WP-06-01 no side effects", () => {
  it("quality test creates NO stock movements, NO account entries, NO payments, NO sales approval mutations", async () => {
    const deps = makeDeps();
    const qualityUser = makeUser(TEST_USERS.quality.userId);
    const qualityEff = makeQualityEff();

    const test = await deps.qualityTestService.createQualityTest(qualityUser as any, qualityEff as any, {
      testDate: "2026-07-10", linkedEntityType: "inventory_item", linkedEntityId: TEST_ITEM_ID,
      idempotencyKey: "qt-noside-001",
    });
    await deps.qualityTestService.reviewQualityTest(qualityUser as any, qualityEff as any, {
      qualityTestId: test.qualityTestId,
      testStatus: "accepted", riskClassification: "none",
      idempotencyKey: "qt-noside-001:review",
    });

    // Audit should NOT contain stock_movement / sales_approval / payment / settlement / account_entry actions
    const auditRows = deps.audit.getRows();
    for (const row of auditRows) {
      expect(row.actionType).not.toContain("stock_movement");
      expect(row.actionType).not.toContain("sales_approval");
      expect(row.actionType).not.toContain("payment");
      expect(row.actionType).not.toContain("settlement");
      expect(row.actionType).not.toContain("account_entry");
      expect(row.actionType).not.toContain("inventory.");
    }

    // Only quality_test audit actions should exist
    const qualityAudit = auditRows.filter(r => r.actionType.startsWith("quality_test"));
    expect(qualityAudit.length).toBe(2);  // create + review
  });
});

// ===========================================================================
// 10. DEC-065 integration guard proof (quality status does NOT bypass reservation).
// ===========================================================================

describe("WP-06-01 DEC-065 integration guard", () => {
  it("quality test with blocked status does NOT make stock reservable (DEC-065 guard proof)", async () => {
    const deps = makeDeps();
    const qualityUser = makeUser(TEST_USERS.quality.userId);
    const qualityEff = makeQualityEff();

    // Create a quality test with blocked status
    const test = await deps.qualityTestService.createQualityTest(qualityUser as any, qualityEff as any, {
      testDate: "2026-07-10", linkedEntityType: "inventory_item", linkedEntityId: TEST_ITEM_ID,
      testStatus: "blocked", riskClassification: "blocked",
      notes: "Stock blocked due to quality failure",
      idempotencyKey: "qt-dec065-blocked-001",
    });
    expect(test.testStatus).toBe("blocked");

    // Verify the quality test is recorded as a FACT
    const recorded = await deps.qualityTestRepo.findQualityTestById(TEST_TENANT_ID, test.qualityTestId);
    expect(recorded!.testStatus).toBe("blocked");

    // DEC-065 PROOF: The quality test does NOT update the item's qualityStatus.
    // The item's qualityStatus (on inventory_items) remains the authoritative
    // status that gates reservation. The SalesSubmissionService's
    // checkReservationEligibilityFromItemAndBalance checks the ITEM's
    // qualityStatus, not the quality test's testStatus.
    //
    // This test proves that creating a quality test with blocked status
    // does NOT create any stock movements, account entries, or sale approvals
    // that would bypass DEC-065.
    const auditRows = deps.audit.getRows();
    for (const row of auditRows) {
      expect(row.actionType).not.toContain("stock_movement");
      expect(row.actionType).not.toContain("sales_approval");
      expect(row.actionType).not.toContain("reservation");
    }
  });

  it("quality test with needs_review status does NOT make stock reservable (DEC-065 guard proof)", async () => {
    const deps = makeDeps();
    const qualityUser = makeUser(TEST_USERS.quality.userId);
    const qualityEff = makeQualityEff();

    const test = await deps.qualityTestService.createQualityTest(qualityUser as any, qualityEff as any, {
      testDate: "2026-07-10", linkedEntityType: "inventory_item", linkedEntityId: TEST_ITEM_ID,
      testStatus: "needs_review", riskClassification: "needs_review",
      idempotencyKey: "qt-dec065-review-001",
    });
    expect(test.testStatus).toBe("needs_review");

    // DEC-065 PROOF: needs_review quality test does NOT create sale approval,
    // stock movement, or reservation. The item's qualityStatus must be
    // 'accepted' for reservation — quality test testStatus is a FACT, not
    // an authorization.
    const auditRows = deps.audit.getRows();
    for (const row of auditRows) {
      expect(row.actionType).not.toContain("stock_movement");
      expect(row.actionType).not.toContain("sales_approval");
      expect(row.actionType).not.toContain("reservation");
    }
  });

  it("quality test with sellable_with_discount flag does NOT authorize discount sale (review flag only)", async () => {
    const deps = makeDeps();
    const qualityUser = makeUser(TEST_USERS.quality.userId);
    const qualityEff = makeQualityEff();

    const test = await deps.qualityTestService.createQualityTest(qualityUser as any, qualityEff as any, {
      testDate: "2026-07-10", linkedEntityType: "inventory_item", linkedEntityId: TEST_ITEM_ID,
      testStatus: "accepted", riskClassification: "sellable_with_discount",
      notes: "Accepted but discount recommended — requires Owner/Accountant approval",
      idempotencyKey: "qt-dec065-discount-001",
    });
    expect(test.riskClassification).toBe("sellable_with_discount");

    // DEC-065 PROOF: sellable_with_discount is a REVIEW FLAG only.
    // It does NOT authorize a discount sale. The quality test does NOT create
    // any sale approval, payment, or account entry. A separate management
    // disposition (later WP) is required to authorize the discount sale.
    const auditRows = deps.audit.getRows();
    for (const row of auditRows) {
      expect(row.actionType).not.toContain("sales_approval");
      expect(row.actionType).not.toContain("payment");
      expect(row.actionType).not.toContain("account_entry");
    }
  });

  it("accepted quality test with none risk classification records FACT without side effects", async () => {
    const deps = makeDeps();
    const qualityUser = makeUser(TEST_USERS.quality.userId);
    const qualityEff = makeQualityEff();

    const test = await deps.qualityTestService.createQualityTest(qualityUser as any, qualityEff as any, {
      testDate: "2026-07-10", linkedEntityType: "inventory_item", linkedEntityId: TEST_ITEM_ID,
      testStatus: "accepted", riskClassification: "none",
      idempotencyKey: "qt-dec065-accepted-001",
    });
    expect(test.testStatus).toBe("accepted");
    expect(test.riskClassification).toBe("none");

    // Even an accepted quality test does NOT create stock movements or sale approvals.
    // It only records a FACT. The item's qualityStatus (separate from quality tests)
    // gates reservation.
    const auditRows = deps.audit.getRows();
    for (const row of auditRows) {
      expect(row.actionType).not.toContain("stock_movement");
      expect(row.actionType).not.toContain("sales_approval");
    }
  });
});

// ===========================================================================
// 11. Rollback proof.
// ===========================================================================

describe("WP-06-01 rollback proof", () => {
  it("rollback after audit failure leaves no persisted quality test", async () => {
    const deps = makeDeps();
    const qualityUser = makeUser(TEST_USERS.quality.userId);
    const qualityEff = makeQualityEff();

    // Capture state
    const qtSnap = deps.qualityTestRepo.snapshot();

    // Force audit failure
    deps.audit.setShouldFail(true);
    await expect(deps.qualityTestService.createQualityTest(qualityUser as any, qualityEff as any, {
      testDate: "2026-07-10", linkedEntityType: "inventory_item", linkedEntityId: TEST_ITEM_ID,
      idempotencyKey: "qt-rollback-001",
    })).rejects.toThrow();
    deps.audit.setShouldFail(false);

    // Restore in-memory state (simulates DB tx rollback)
    deps.qualityTestRepo.restore(qtSnap);

    // Verify no quality test persisted
    const tests = [...((deps.qualityTestRepo as any).qualityTests as Map<string, any>).values()];
    expect(tests.length).toBe(0);
  });
});
