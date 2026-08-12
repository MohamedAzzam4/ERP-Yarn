/**
 * WP-07-05 Historical Correction Service — tests.
 * Contract 08 §8.11, DEC-070, DEC-069.
 */
import { describe, it, expect } from "vitest";
import {
  HistoricalCorrectionService,
  CorrectionBatchNotFoundError,
  BatchNotCommittedError,
  CorrectionRequestNotFoundError,
  SameUserDualApprovalError,
  IncompleteDualApprovalError,
  CorrectionAlreadyExecutedError,
  type CorrectionDomainHook,
} from "../historical-correction-service";
import { InMemoryHistoricalCorrectionRepository } from "./in-memory-historical-correction-repository";
import { InProcessAuditStore } from "../audit-service";
import { InProcessIdempotencyStore } from "../idempotency-service";
import { InProcessDocumentSequenceStore } from "../document-sequence-service";
import { PermissionDeniedError } from "@/server/security/guards";
import type { ImportBatch, HistoricalCorrectionRequest } from "@/server/db/schema/migration";

const TEST_TENANT_ID = "00000000-0000-0000-0000-000000070005";
const OWNER_USER_ID = "00000000-0000-0000-0000-000000070005";
const ACCOUNTANT_USER_ID = "00000000-0000-0000-0000-000000070015";
const FOREIGN_TENANT_ID = "00000000-0000-0000-0000-000000070999";

function makeUser(userId: string = OWNER_USER_ID, tenantId: string = TEST_TENANT_ID) {
  return { authenticated: true as const, userId, tenantId, email: "t@e.com", name: "T", authId: "t" };
}
function makeOwnerEff() {
  return {
    assignedRoleCodes: ["owner"],
    permissionKeys: new Set(["migration.prepare", "migration.review", "migration.approve", "migration.commit"]),
    deniedFieldKeys: new Set(), workerFinancialDeny: false,
  } as any;
}
function makeAccountantEff() {
  return {
    assignedRoleCodes: ["accountant"],
    permissionKeys: new Set(["migration.prepare", "migration.review", "migration.approve", "migration.commit"]),
    deniedFieldKeys: new Set(), workerFinancialDeny: false,
  } as any;
}
function makeWorkerEff() {
  return {
    assignedRoleCodes: ["warehouse_employee"],
    permissionKeys: new Set(["inventory.receive.approve"]),
    deniedFieldKeys: new Set(), workerFinancialDeny: true,
  } as any;
}

function makeDeps() {
  const repository = new InMemoryHistoricalCorrectionRepository();
  const audit = new InProcessAuditStore();
  const idempotency = new InProcessIdempotencyStore();
  const documentSequence = new InProcessDocumentSequenceStore();
  const service = new HistoricalCorrectionService({ repository, audit, idempotency, documentSequence });
  return { repository, audit, idempotency, documentSequence, service };
}

function makeCommittedBatch(id: string = "batch-committed"): ImportBatch {
  return {
    id, tenantId: TEST_TENANT_ID, batchNo: "MIG-001",
    status: "committed",
    sourceDescription: "Test committed batch",
    templateName: "opening_balances", templateVersion: "v1.0", mappingVersion: "v1.0",
    cutoverManifestHash: "manifest-hash-001", cutoverImportMode: "opening_balance" as any,
    stagedDataHash: "staged-hash-001", stagedRowCount: 3,
    blockingErrorCount: 0, warningCount: 0, acceptedWarningCount: 0,
    validationStatus: "passed", reconciliationStatus: "matched", warningSummary: null,
    committedAt: new Date(), commitEffectCounts: { inventory_movements: 2, account_entries: 1 },
    createdBy: OWNER_USER_ID, createdAt: new Date(),
    updatedBy: null, updatedAt: null,
  };
}

function makeUncommittedBatch(id: string = "batch-uncommitted"): ImportBatch {
  return {
    ...makeCommittedBatch(id),
    status: "approved_for_commit",
    committedAt: null,
    commitEffectCounts: null,
  };
}

function setupCommittedBatch(deps: ReturnType<typeof makeDeps>, batchId: string = "batch-committed") {
  deps.repository.seedBatch(TEST_TENANT_ID, makeCommittedBatch(batchId));
}

// Helper: record both approvals
async function recordBothApprovals(
  deps: ReturnType<typeof makeDeps>,
  correctionRequestId: string,
) {
  await deps.service.approveCorrection(makeUser(OWNER_USER_ID) as any, makeOwnerEff() as any, {
    correctionRequestId, approverRole: "owner", idempotencyKey: `owner-${correctionRequestId}`,
  });
  await deps.service.approveCorrection(makeUser(ACCOUNTANT_USER_ID) as any, makeAccountantEff() as any, {
    correctionRequestId, approverRole: "accountant", idempotencyKey: `acct-${correctionRequestId}`,
  });
}

// ===========================================================================
// 1-3. Correction request creation
// ===========================================================================

describe("WP-07-05 correction request creation", () => {
  it("1. creates correction request with reason and requester", async () => {
    const deps = makeDeps();
    setupCommittedBatch(deps);

    const result = await deps.service.createCorrectionRequest(makeUser() as any, makeOwnerEff() as any, {
      importBatchId: "batch-committed",
      originalEntityType: "stock_movement",
      originalEntityId: "sm-001",
      correctionType: "reversal",
      reason: "Incorrect opening quantity",
      proposedCorrectionJson: { newQuantity: "50.000" },
      impactAnalysisJson: { affectedAccounts: 1 },
      idempotencyKey: "corr-001",
    });

    expect(result.action).toBe("created");
    expect(result.correctionRequestId).toBeTruthy();
    expect(result.docNo).toBeTruthy();
    expect(result.status).toBe("pending_review");

    // Verify the request was persisted
    const request = await deps.repository.findCorrectionRequestById(TEST_TENANT_ID, result.correctionRequestId);
    expect(request?.reason).toBe("Incorrect opening quantity");
    expect(request?.originalEntityType).toBe("stock_movement");
    expect(request?.originalEntityId).toBe("sm-001");
    expect(request?.correctionType).toBe("reversal");
    expect(request?.createdBy).toBe(OWNER_USER_ID);
    expect(request?.importBatchId).toBe("batch-committed");
  });

  it("2. cannot correct uncommitted batch", async () => {
    const deps = makeDeps();
    deps.repository.seedBatch(TEST_TENANT_ID, makeUncommittedBatch());

    await expect(deps.service.createCorrectionRequest(makeUser() as any, makeOwnerEff() as any, {
      importBatchId: "batch-uncommitted",
      originalEntityType: "stock_movement",
      originalEntityId: "sm-001",
      correctionType: "reversal",
      reason: "Test",
      proposedCorrectionJson: null,
      impactAnalysisJson: null,
      idempotencyKey: "corr-002",
    })).rejects.toThrow(BatchNotCommittedError);
  });

  it("3. cannot silently mutate original commit — correction creates separate record", async () => {
    const deps = makeDeps();
    setupCommittedBatch(deps);

    const result = await deps.service.createCorrectionRequest(makeUser() as any, makeOwnerEff() as any, {
      importBatchId: "batch-committed",
      originalEntityType: "stock_movement",
      originalEntityId: "sm-001",
      correctionType: "reversal",
      reason: "Test correction",
      proposedCorrectionJson: null,
      impactAnalysisJson: null,
      idempotencyKey: "corr-003",
    });

    // Verify the original batch is unchanged
    const batch = await deps.repository.findImportBatchById(TEST_TENANT_ID, "batch-committed");
    expect(batch?.status).toBe("committed");
    expect(batch?.committedAt).toBeTruthy();

    // Verify the correction request is a SEPARATE record linked to the original
    const request = await deps.repository.findCorrectionRequestById(TEST_TENANT_ID, result.correctionRequestId);
    expect(request?.id).not.toBe("batch-committed");
    expect(request?.importBatchId).toBe("batch-committed");
    expect(request?.originalEntityType).toBe("stock_movement");
    expect(request?.originalEntityId).toBe("sm-001");
  });

  it("4. duplicate correction request is replayed safely (idempotent)", async () => {
    const deps = makeDeps();
    setupCommittedBatch(deps);

    const result1 = await deps.service.createCorrectionRequest(makeUser() as any, makeOwnerEff() as any, {
      importBatchId: "batch-committed",
      originalEntityType: "stock_movement",
      originalEntityId: "sm-001",
      correctionType: "reversal",
      reason: "Test",
      proposedCorrectionJson: null,
      impactAnalysisJson: null,
      idempotencyKey: "corr-dup-001",
    });

    const result2 = await deps.service.createCorrectionRequest(makeUser() as any, makeOwnerEff() as any, {
      importBatchId: "batch-committed",
      originalEntityType: "stock_movement",
      originalEntityId: "sm-001",
      correctionType: "reversal",
      reason: "Test",
      proposedCorrectionJson: null,
      impactAnalysisJson: null,
      idempotencyKey: "corr-dup-001",
    });

    expect(result2.action).toBe("replayed");
    expect(result2.correctionRequestId).toBe(result1.correctionRequestId);
  });

  it("5. tenant isolation — foreign tenant cannot access", async () => {
    const deps = makeDeps();
    setupCommittedBatch(deps);

    await expect(deps.service.createCorrectionRequest(
      makeUser(OWNER_USER_ID, FOREIGN_TENANT_ID) as any, makeOwnerEff() as any,
      {
        importBatchId: "batch-committed",
        originalEntityType: "stock_movement",
        originalEntityId: "sm-001",
        correctionType: "reversal",
        reason: "Test",
        proposedCorrectionJson: null,
        impactAnalysisJson: null,
        idempotencyKey: "corr-foreign-001",
      },
    )).rejects.toThrow(CorrectionBatchNotFoundError);
  });

  it("6. role denial — worker cannot create correction", async () => {
    const deps = makeDeps();
    setupCommittedBatch(deps);

    await expect(deps.service.createCorrectionRequest(makeUser() as any, makeWorkerEff() as any, {
      importBatchId: "batch-committed",
      originalEntityType: "stock_movement",
      originalEntityId: "sm-001",
      correctionType: "reversal",
      reason: "Test",
      proposedCorrectionJson: null,
      impactAnalysisJson: null,
      idempotencyKey: "corr-worker-001",
    })).rejects.toThrow(PermissionDeniedError);
  });
});

// ===========================================================================
// 7-9. Dual approval (DEC-070)
// ===========================================================================

describe("WP-07-05 correction dual approval (DEC-070)", () => {
  it("7. reviewer/approver required — cannot execute without dual approval", async () => {
    const deps = makeDeps();
    setupCommittedBatch(deps);

    const createResult = await deps.service.createCorrectionRequest(makeUser() as any, makeOwnerEff() as any, {
      importBatchId: "batch-committed",
      originalEntityType: "stock_movement",
      originalEntityId: "sm-001",
      correctionType: "reversal",
      reason: "Test",
      proposedCorrectionJson: null,
      impactAnalysisJson: null,
      idempotencyKey: "corr-007",
    });

    // Try to execute without approval → must fail
    await expect(deps.service.executeCorrection(makeUser() as any, makeOwnerEff() as any, {
      correctionRequestId: createResult.correctionRequestId,
      idempotencyKey: "exec-007",
    })).rejects.toThrow(IncompleteDualApprovalError);
  });

  it("8. same user cannot approve both roles (DEC-069)", async () => {
    const deps = makeDeps();
    setupCommittedBatch(deps);

    const createResult = await deps.service.createCorrectionRequest(makeUser() as any, makeOwnerEff() as any, {
      importBatchId: "batch-committed",
      originalEntityType: "stock_movement",
      originalEntityId: "sm-001",
      correctionType: "reversal",
      reason: "Test",
      proposedCorrectionJson: null,
      impactAnalysisJson: null,
      idempotencyKey: "corr-008",
    });

    // Owner approves
    await deps.service.approveCorrection(makeUser(OWNER_USER_ID) as any, makeOwnerEff() as any, {
      correctionRequestId: createResult.correctionRequestId,
      approverRole: "owner",
      idempotencyKey: `owner-${createResult.correctionRequestId}`,
    });

    // Same user tries accountant approval → must fail
    await expect(deps.service.approveCorrection(makeUser(OWNER_USER_ID) as any, makeAccountantEff() as any, {
      correctionRequestId: createResult.correctionRequestId,
      approverRole: "accountant",
      idempotencyKey: `acct-${createResult.correctionRequestId}`,
    })).rejects.toThrow(SameUserDualApprovalError);
  });

  it("9. two distinct approvers can approve correction", async () => {
    const deps = makeDeps();
    setupCommittedBatch(deps);

    const createResult = await deps.service.createCorrectionRequest(makeUser() as any, makeOwnerEff() as any, {
      importBatchId: "batch-committed",
      originalEntityType: "stock_movement",
      originalEntityId: "sm-001",
      correctionType: "reversal",
      reason: "Test",
      proposedCorrectionJson: null,
      impactAnalysisJson: null,
      idempotencyKey: "corr-009",
    });

    await recordBothApprovals(deps, createResult.correctionRequestId);

    const request = await deps.repository.findCorrectionRequestById(TEST_TENANT_ID, createResult.correctionRequestId);
    expect(request?.status).toBe("approved");
    expect(request?.ownerApprovedBy).toBe(OWNER_USER_ID);
    expect(request?.accountantApprovedBy).toBe(ACCOUNTANT_USER_ID);
    expect(request?.ownerApprovedBy).not.toBe(request?.accountantApprovedBy);
  });
});

// ===========================================================================
// 10-12. Execution and immutability
// ===========================================================================

describe("WP-07-05 correction execution", () => {
  it("10. correction execution uses domain service path", async () => {
    const deps = makeDeps();
    setupCommittedBatch(deps);

    const createResult = await deps.service.createCorrectionRequest(makeUser() as any, makeOwnerEff() as any, {
      importBatchId: "batch-committed",
      originalEntityType: "stock_movement",
      originalEntityId: "sm-001",
      correctionType: "reversal",
      reason: "Test reversal",
      proposedCorrectionJson: null,
      impactAnalysisJson: null,
      idempotencyKey: "corr-010",
    });
    await recordBothApprovals(deps, createResult.correctionRequestId);

    // Add domain hook
    let hookCalled = false;
    const hook: CorrectionDomainHook = {
      executeCorrection: async (tenantId, userId, correctionRequest, batch) => {
        hookCalled = true;
        return {
          correctedEntityType: "stock_movement",
          correctedEntityId: "reversal-movement-001",
        };
      },
    };
    const serviceWithHook = new HistoricalCorrectionService({
      ...deps, correctionDomainHook: hook,
    });

    const result = await serviceWithHook.executeCorrection(makeUser() as any, makeOwnerEff() as any, {
      correctionRequestId: createResult.correctionRequestId,
      idempotencyKey: "exec-010",
    });

    expect(result.action).toBe("executed");
    expect(hookCalled).toBe(true);
    expect(result.correctedEntityType).toBe("stock_movement");
    expect(result.correctedEntityId).toBe("reversal-movement-001");

    // Verify correction request updated with result
    const request = await deps.repository.findCorrectionRequestById(TEST_TENANT_ID, createResult.correctionRequestId);
    expect(request?.correctedEntityType).toBe("stock_movement");
    expect(request?.correctedEntityId).toBe("reversal-movement-001");
  });

  it("11. original approval/backup/manifest evidence unchanged after correction", async () => {
    const deps = makeDeps();
    setupCommittedBatch(deps);

    const createResult = await deps.service.createCorrectionRequest(makeUser() as any, makeOwnerEff() as any, {
      importBatchId: "batch-committed",
      originalEntityType: "stock_movement",
      originalEntityId: "sm-001",
      correctionType: "adjustment",
      reason: "Test adjustment",
      proposedCorrectionJson: null,
      impactAnalysisJson: null,
      idempotencyKey: "corr-011",
    });
    await recordBothApprovals(deps, createResult.correctionRequestId);

    const hook: CorrectionDomainHook = {
      executeCorrection: async () => ({
        correctedEntityType: "stock_movement",
        correctedEntityId: "adj-movement-001",
      }),
    };
    const serviceWithHook = new HistoricalCorrectionService({ ...deps, correctionDomainHook: hook });

    await serviceWithHook.executeCorrection(makeUser() as any, makeOwnerEff() as any, {
      correctionRequestId: createResult.correctionRequestId,
      idempotencyKey: "exec-011",
    });

    // Verify original batch is unchanged
    const batch = await deps.repository.findImportBatchById(TEST_TENANT_ID, "batch-committed");
    expect(batch?.status).toBe("committed");
    expect(batch?.committedAt).toBeTruthy();
    expect(batch?.commitEffectCounts).toEqual({ inventory_movements: 2, account_entries: 1 });
    expect(batch?.stagedDataHash).toBe("staged-hash-001");
    expect(batch?.cutoverManifestHash).toBe("manifest-hash-001");
  });

  it("12. correction creates append-only/versioned record", async () => {
    const deps = makeDeps();
    setupCommittedBatch(deps);

    const createResult = await deps.service.createCorrectionRequest(makeUser() as any, makeOwnerEff() as any, {
      importBatchId: "batch-committed",
      originalEntityType: "stock_movement",
      originalEntityId: "sm-001",
      correctionType: "new_corrected",
      reason: "Test new corrected",
      proposedCorrectionJson: null,
      impactAnalysisJson: null,
      idempotencyKey: "corr-012",
    });
    await recordBothApprovals(deps, createResult.correctionRequestId);

    const hook: CorrectionDomainHook = {
      executeCorrection: async () => ({
        correctedEntityType: "stock_movement",
        correctedEntityId: "new-corrected-001",
      }),
    };
    const serviceWithHook = new HistoricalCorrectionService({ ...deps, correctionDomainHook: hook });

    await serviceWithHook.executeCorrection(makeUser() as any, makeOwnerEff() as any, {
      correctionRequestId: createResult.correctionRequestId,
      idempotencyKey: "exec-012",
    });

    // Verify correction request has trace link to original
    const request = await deps.repository.findCorrectionRequestById(TEST_TENANT_ID, createResult.correctionRequestId);
    expect(request?.originalEntityType).toBe("stock_movement");
    expect(request?.originalEntityId).toBe("sm-001");
    expect(request?.correctedEntityType).toBe("stock_movement");
    expect(request?.correctedEntityId).toBe("new-corrected-001");
    // The correction request itself is the append-only record
    expect(request?.id).not.toBe("sm-001");
  });

  it("13. rollback after partial correction effect", async () => {
    const deps = makeDeps();
    setupCommittedBatch(deps);

    const createResult = await deps.service.createCorrectionRequest(makeUser() as any, makeOwnerEff() as any, {
      importBatchId: "batch-committed",
      originalEntityType: "stock_movement",
      originalEntityId: "sm-001",
      correctionType: "reversal",
      reason: "Test rollback",
      proposedCorrectionJson: null,
      impactAnalysisJson: null,
      idempotencyKey: "corr-013",
    });
    await recordBothApprovals(deps, createResult.correctionRequestId);

    // Hook that throws after posting the domain effect
    // (simulating fault after domain effect — the in-memory test verifies
    // the correction request is NOT marked as executed because the hook
    // throws before updateCorrectionResult)
    const hook: CorrectionDomainHook = {
      executeCorrection: async () => {
        // Simulate: domain effect posted, then fault
        throw new Error("DELIBERATE_ROLLBACK_AFTER_DOMAIN_EFFECT");
      },
    };
    const serviceWithHook = new HistoricalCorrectionService({
      ...deps, correctionDomainHook: hook,
    });

    await expect(serviceWithHook.executeCorrection(makeUser() as any, makeOwnerEff() as any, {
      correctionRequestId: createResult.correctionRequestId,
      idempotencyKey: "exec-013",
    })).rejects.toThrow("DELIBERATE_ROLLBACK_AFTER_DOMAIN_EFFECT");

    // Verify correction request was NOT marked as executed
    const request = await deps.repository.findCorrectionRequestById(TEST_TENANT_ID, createResult.correctionRequestId);
    expect(request?.correctedEntityId).toBeNull();
    expect(request?.status).toBe("approved"); // Still approved, can retry
  });

  it("14. idempotent retry of execution returns existing result", async () => {
    const deps = makeDeps();
    setupCommittedBatch(deps);

    const createResult = await deps.service.createCorrectionRequest(makeUser() as any, makeOwnerEff() as any, {
      importBatchId: "batch-committed",
      originalEntityType: "stock_movement",
      originalEntityId: "sm-001",
      correctionType: "reversal",
      reason: "Test idempotent",
      proposedCorrectionJson: null,
      impactAnalysisJson: null,
      idempotencyKey: "corr-014",
    });
    await recordBothApprovals(deps, createResult.correctionRequestId);

    const hook: CorrectionDomainHook = {
      executeCorrection: async () => ({
        correctedEntityType: "stock_movement",
        correctedEntityId: "reversal-014",
      }),
    };
    const serviceWithHook = new HistoricalCorrectionService({ ...deps, correctionDomainHook: hook });

    // First execution
    const result1 = await serviceWithHook.executeCorrection(makeUser() as any, makeOwnerEff() as any, {
      correctionRequestId: createResult.correctionRequestId,
      idempotencyKey: "exec-014",
    });
    expect(result1.action).toBe("executed");

    // Retry with same idempotency key
    const result2 = await serviceWithHook.executeCorrection(makeUser() as any, makeOwnerEff() as any, {
      correctionRequestId: createResult.correctionRequestId,
      idempotencyKey: "exec-014",
    });
    expect(result2.action).toBe("replayed");
    expect(result2.correctedEntityId).toBe(result1.correctedEntityId);
  });
});
