/**
 * WP-07-04 Historical Commit — tests.
 * Contract 08 §8.9-8.11, DEC-069, DEC-071.
 */
import { describe, it, expect } from "vitest";
import {
  HistoricalCommitService,
  BatchNotFoundForCommitError,
  SameUserDualApprovalError,
  MissingApprovalError,
  StaleApprovalError,
  BlockingFindingsRemainError,
  UnresolvedReviewItemsError,
  MissingBackupEvidenceError,
  OverlappingDataError,
} from "../historical-commit-service";
import { InMemoryHistoricalCommitRepository } from "./in-memory-historical-commit-repository";
import { InProcessAuditStore } from "../audit-service";
import { InProcessIdempotencyStore } from "../idempotency-service";
import { InventoryLedgerService } from "../inventory-ledger-service";
import { SubledgerService } from "../subledger-service";
import { InMemoryInventoryLedgerRepository } from "./in-memory-inventory-ledger-repository";
import { InMemorySubledgerRepository } from "./in-memory-subledger-repository";
import { InProcessDocumentSequenceStore } from "../document-sequence-service";
import { PermissionDeniedError } from "@/server/security/guards";
import type { ImportBatch, ImportStagingRow } from "@/server/db/schema/migration";

const TEST_TENANT_ID = "00000000-0000-0000-0000-000000070004";
const TEST_USER_ID_OWNER = "00000000-0000-0000-0000-000000070004";
const TEST_USER_ID_ACCT = "00000000-0000-0000-0000-000000070005";
const TEST_ITEM_ID = "00000000-0000-4000-8000-000000070004";
const TEST_LOCATION_ID = "00000000-0000-4000-8000-000000070005";

function makeUser(userId: string, tenantId: string = TEST_TENANT_ID) {
  return { authenticated: true as const, userId, tenantId, email: "t@e.com", name: "T", authId: "t" };
}
function makeOwnerEff() {
  return { assignedRoleCodes: ["owner"], permissionKeys: new Set(["migration.prepare", "migration.review", "migration.approve", "migration.commit", "inventory.receive.approve", "inventory.receive.create"]), deniedFieldKeys: new Set(), workerFinancialDeny: false } as any;
}
function makeAcctEff() {
  return { assignedRoleCodes: ["accountant"], permissionKeys: new Set(["migration.prepare", "migration.review", "migration.approve", "migration.commit", "inventory.receive.approve", "inventory.receive.create"]), deniedFieldKeys: new Set(), workerFinancialDeny: false } as any;
}
function makeWorkerEff() {
  return { assignedRoleCodes: ["warehouse_employee"], permissionKeys: new Set(["inventory.receive.approve"]), deniedFieldKeys: new Set(), workerFinancialDeny: true } as any;
}

function makeDeps() {
  const repository = new InMemoryHistoricalCommitRepository();
  const audit = new InProcessAuditStore();
  const idempotency = new InProcessIdempotencyStore();
  const documentSequence = new InProcessDocumentSequenceStore();
  const ledgerRepo = new InMemoryInventoryLedgerRepository();
  const subledgerRepo = new InMemorySubledgerRepository();
  const inventoryLedger = new InventoryLedgerService({ ledger: ledgerRepo, audit, idempotency, documentSequence });
  const subledger = new SubledgerService({ subledger: subledgerRepo, audit, idempotency, documentSequence });
  const service = new HistoricalCommitService({ repository, audit, idempotency, inventoryLedger, subledger });
  return { repository, audit, idempotency, documentSequence, ledgerRepo, subledgerRepo, inventoryLedger, subledger, service };
}

function makeBatch(id: string = "batch-001", status: string = "review_required"): ImportBatch {
  return {
    id, tenantId: TEST_TENANT_ID, batchNo: "MIG-001", status: status as any,
    sourceDescription: "Test", templateName: null, templateVersion: null, mappingVersion: null,
    cutoverManifestHash: "manifest-hash-001", cutoverImportMode: "opening_balance" as any,
    stagedDataHash: null, stagedRowCount: 1, blockingErrorCount: 0, warningCount: 0, acceptedWarningCount: 0,
    validationStatus: "validation_complete", reconciliationStatus: "reconciliation_complete",
    warningSummary: null, committedAt: null, commitEffectCounts: null,
    createdBy: TEST_USER_ID_OWNER, createdAt: new Date(), updatedBy: null, updatedAt: null,
  };
}

function makeStagingRow(id: string, data: Record<string, unknown>, overrides: Partial<ImportStagingRow> = {}): ImportStagingRow {
  return {
    id, tenantId: TEST_TENANT_ID, importBatchId: "batch-001",
    importFileId: null, templateName: null, sourceSheetName: "Sheet1", sourceRowNumber: 1,
    rawRowJson: data, transformedRowJson: null, validationStatus: "pending", reviewStatus: "not_required",
    aiConfidence: null, transformationNotes: null, committedEntityType: null, committedEntityId: null,
    createdBy: TEST_USER_ID_OWNER, createdAt: new Date(), updatedBy: null, updatedAt: null, ...overrides,
  };
}

function setupBatchWithRows(deps: ReturnType<typeof makeDeps>, rows: ImportStagingRow[], batchId: string = "batch-001") {
  deps.repository.seedBatch(TEST_TENANT_ID, makeBatch(batchId));
  deps.repository.seedStagingRows(TEST_TENANT_ID, batchId, rows);
}

// ===========================================================================
// 1-4. Approval tests
// ===========================================================================

describe("WP-07-04 approval", () => {
  it("1. owner approval alone cannot commit", async () => {
    const deps = makeDeps();
    setupBatchWithRows(deps, [makeStagingRow("row-001", { name: "A", code: "C001", quantity: "100", date: "2026-01-01", item_id: TEST_ITEM_ID, location_id: TEST_LOCATION_ID })]);

    // Owner approves
    await deps.service.submitApproval(makeUser(TEST_USER_ID_OWNER), makeOwnerEff(), {
      importBatchId: "batch-001", approverRole: "owner", backupEvidenceRef: "backup-ref", reason: "ok", idempotencyKey: "appr-001",
    });

    // Commit fails — missing accountant approval
    await expect(deps.service.commitBatch(makeUser(TEST_USER_ID_OWNER), makeOwnerEff(), {
      importBatchId: "batch-001", backupEvidenceRef: "backup-ref", idempotencyKey: "commit-001",
    })).rejects.toBeInstanceOf(MissingApprovalError);
  });

  it("2. accountant approval alone cannot commit", async () => {
    const deps = makeDeps();
    setupBatchWithRows(deps, [makeStagingRow("row-001", { name: "A", code: "C001", quantity: "100", date: "2026-01-01", item_id: TEST_ITEM_ID, location_id: TEST_LOCATION_ID })]);

    await deps.service.submitApproval(makeUser(TEST_USER_ID_ACCT), makeAcctEff(), {
      importBatchId: "batch-001", approverRole: "accountant", backupEvidenceRef: "backup-ref", reason: "ok", idempotencyKey: "appr-002",
    });

    await expect(deps.service.commitBatch(makeUser(TEST_USER_ID_OWNER), makeOwnerEff(), {
      importBatchId: "batch-001", backupEvidenceRef: "backup-ref", idempotencyKey: "commit-002",
    })).rejects.toBeInstanceOf(MissingApprovalError);
  });

  it("3. same user with both roles cannot satisfy both approvals", async () => {
    const deps = makeDeps();
    setupBatchWithRows(deps, [makeStagingRow("row-001", { name: "A", code: "C001", quantity: "100", date: "2026-01-01", item_id: TEST_ITEM_ID, location_id: TEST_LOCATION_ID })]);

    // Owner approves
    await deps.service.submitApproval(makeUser(TEST_USER_ID_OWNER), makeOwnerEff(), {
      importBatchId: "batch-001", approverRole: "owner", backupEvidenceRef: "backup-ref", reason: "ok", idempotencyKey: "appr-003a",
    });

    // Same user tries accountant approval — fails (DEC-069)
    await expect(deps.service.submitApproval(makeUser(TEST_USER_ID_OWNER), makeAcctEff(), {
      importBatchId: "batch-001", approverRole: "accountant", backupEvidenceRef: "backup-ref", reason: "ok", idempotencyKey: "appr-003b",
    })).rejects.toBeInstanceOf(SameUserDualApprovalError);
  });

  it("4. two distinct users can approve and commit", async () => {
    const deps = makeDeps();
    setupBatchWithRows(deps, [makeStagingRow("row-001", { name: "A", code: "C001", quantity: "100", date: "2026-01-01", item_id: TEST_ITEM_ID, location_id: TEST_LOCATION_ID })]);

    await deps.service.submitApproval(makeUser(TEST_USER_ID_OWNER), makeOwnerEff(), {
      importBatchId: "batch-001", approverRole: "owner", backupEvidenceRef: "backup-ref", reason: "ok", idempotencyKey: "appr-004a",
    });
    await deps.service.submitApproval(makeUser(TEST_USER_ID_ACCT), makeAcctEff(), {
      importBatchId: "batch-001", approverRole: "accountant", backupEvidenceRef: "backup-ref", reason: "ok", idempotencyKey: "appr-004b",
    });

    const result = await deps.service.commitBatch(makeUser(TEST_USER_ID_OWNER), makeOwnerEff(), {
      importBatchId: "batch-001", backupEvidenceRef: "backup-ref", idempotencyKey: "commit-004",
    });
    expect(result.action).toBe("committed");
    expect(result.status).toBe("committed");
  });
});

// ===========================================================================
// 5-6. Version/hash binding + stale detection
// ===========================================================================

describe("WP-07-04 stale approval", () => {
  it("5. approval binds to exact staged_data_hash", async () => {
    const deps = makeDeps();
    setupBatchWithRows(deps, [makeStagingRow("row-001", { name: "A", code: "C001", quantity: "100", date: "2026-01-01", item_id: TEST_ITEM_ID, location_id: TEST_LOCATION_ID })]);

    await deps.service.submitApproval(makeUser(TEST_USER_ID_OWNER), makeOwnerEff(), {
      importBatchId: "batch-001", approverRole: "owner", backupEvidenceRef: "backup-ref", reason: "ok", idempotencyKey: "appr-005a",
    });
    await deps.service.submitApproval(makeUser(TEST_USER_ID_ACCT), makeAcctEff(), {
      importBatchId: "batch-001", approverRole: "accountant", backupEvidenceRef: "backup-ref", reason: "ok", idempotencyKey: "appr-005b",
    });

    // Change staged data — add a new row (simulates staged data change)
    deps.repository.seedStagingRows(TEST_TENANT_ID, "batch-001", [
      makeStagingRow("row-001", { name: "A", code: "C001", quantity: "100", date: "2026-01-01", item_id: TEST_ITEM_ID, location_id: TEST_LOCATION_ID }),
      makeStagingRow("row-002", { name: "B", code: "C002", quantity: "200", date: "2026-01-01", item_id: TEST_ITEM_ID, location_id: TEST_LOCATION_ID }, { sourceRowNumber: 2 }),
    ]);

    // Commit fails — stale approval
    await expect(deps.service.commitBatch(makeUser(TEST_USER_ID_OWNER), makeOwnerEff(), {
      importBatchId: "batch-001", backupEvidenceRef: "backup-ref", idempotencyKey: "commit-005",
    })).rejects.toBeInstanceOf(StaleApprovalError);
  });

  it("6. stale approval blocks commit after validation version change", async () => {
    const deps = makeDeps();
    setupBatchWithRows(deps, [makeStagingRow("row-001", { name: "A", code: "C001", quantity: "100", date: "2026-01-01", item_id: TEST_ITEM_ID, location_id: TEST_LOCATION_ID })]);

    await deps.service.submitApproval(makeUser(TEST_USER_ID_OWNER), makeOwnerEff(), {
      importBatchId: "batch-001", approverRole: "owner", backupEvidenceRef: "backup-ref", reason: "ok", idempotencyKey: "appr-006a",
    });
    await deps.service.submitApproval(makeUser(TEST_USER_ID_ACCT), makeAcctEff(), {
      importBatchId: "batch-001", approverRole: "accountant", backupEvidenceRef: "backup-ref", reason: "ok", idempotencyKey: "appr-006b",
    });

    // Simulate staged data change by re-seeding with different data
    deps.repository.seedStagingRows(TEST_TENANT_ID, "batch-001", [
      makeStagingRow("row-001", { name: "CHANGED", code: "C001", quantity: "100", date: "2026-01-01", item_id: TEST_ITEM_ID, location_id: TEST_LOCATION_ID }),
    ]);

    await expect(deps.service.commitBatch(makeUser(TEST_USER_ID_OWNER), makeOwnerEff(), {
      importBatchId: "batch-001", backupEvidenceRef: "backup-ref", idempotencyKey: "commit-006",
    })).rejects.toBeInstanceOf(StaleApprovalError);
  });
});

// ===========================================================================
// 7-9. Pre-commit checks
// ===========================================================================

describe("WP-07-04 pre-commit checks", () => {
  it("7. missing backup blocks commit", async () => {
    const deps = makeDeps();
    setupBatchWithRows(deps, [makeStagingRow("row-001", { name: "A", code: "C001", quantity: "100", date: "2026-01-01", item_id: TEST_ITEM_ID, location_id: TEST_LOCATION_ID })]);

    await deps.service.submitApproval(makeUser(TEST_USER_ID_OWNER), makeOwnerEff(), {
      importBatchId: "batch-001", approverRole: "owner", backupEvidenceRef: "backup-ref", reason: "ok", idempotencyKey: "appr-007a",
    });
    await deps.service.submitApproval(makeUser(TEST_USER_ID_ACCT), makeAcctEff(), {
      importBatchId: "batch-001", approverRole: "accountant", backupEvidenceRef: "backup-ref", reason: "ok", idempotencyKey: "appr-007b",
    });

    await expect(deps.service.commitBatch(makeUser(TEST_USER_ID_OWNER), makeOwnerEff(), {
      importBatchId: "batch-001", backupEvidenceRef: "", idempotencyKey: "commit-007",
    })).rejects.toBeInstanceOf(MissingBackupEvidenceError);
  });

  it("8. blocking finding prevents commit", async () => {
    const deps = makeDeps();
    setupBatchWithRows(deps, [makeStagingRow("row-001", { name: "A", code: "C001", quantity: "100", date: "2026-01-01", item_id: TEST_ITEM_ID, location_id: TEST_LOCATION_ID })]);

    // Seed a blocking validation error
    deps.repository.seedBlockingErrors([
      { id: "err-001", tenantId: TEST_TENANT_ID, importBatchId: "batch-001", stagingRowId: "row-001", severity: "blocking_error" as any, errorCode: "TEST", message: "Blocking", fieldName: null, isBlocking: true, resolutionStatus: "open", resolvedBy: null, resolvedAt: null, resolutionNotes: null, createdBy: TEST_USER_ID_OWNER, createdAt: new Date(), updatedBy: null, updatedAt: null },
    ]);

    await deps.service.submitApproval(makeUser(TEST_USER_ID_OWNER), makeOwnerEff(), {
      importBatchId: "batch-001", approverRole: "owner", backupEvidenceRef: "backup-ref", reason: "ok", idempotencyKey: "appr-008a",
    });
    await deps.service.submitApproval(makeUser(TEST_USER_ID_ACCT), makeAcctEff(), {
      importBatchId: "batch-001", approverRole: "accountant", backupEvidenceRef: "backup-ref", reason: "ok", idempotencyKey: "appr-008b",
    });

    await expect(deps.service.commitBatch(makeUser(TEST_USER_ID_OWNER), makeOwnerEff(), {
      importBatchId: "batch-001", backupEvidenceRef: "backup-ref", idempotencyKey: "commit-008",
    })).rejects.toBeInstanceOf(BlockingFindingsRemainError);
  });

  it("9. unresolved review item prevents commit", async () => {
    const deps = makeDeps();
    setupBatchWithRows(deps, [makeStagingRow("row-001", { name: "A", code: "C001", quantity: "100", date: "2026-01-01", item_id: TEST_ITEM_ID, location_id: TEST_LOCATION_ID })]);

    deps.repository.seedReviewItems([
      { id: "rev-001", tenantId: TEST_TENANT_ID, importBatchId: "batch-001", stagingRowId: "row-001", reviewReason: "Unresolved", assignedTo: null, status: "pending" as any, decision: null, decisionNotes: null, decidedBy: null, decidedAt: null, createdBy: TEST_USER_ID_OWNER, createdAt: new Date(), updatedBy: null, updatedAt: null },
    ]);

    await deps.service.submitApproval(makeUser(TEST_USER_ID_OWNER), makeOwnerEff(), {
      importBatchId: "batch-001", approverRole: "owner", backupEvidenceRef: "backup-ref", reason: "ok", idempotencyKey: "appr-009a",
    });
    await deps.service.submitApproval(makeUser(TEST_USER_ID_ACCT), makeAcctEff(), {
      importBatchId: "batch-001", approverRole: "accountant", backupEvidenceRef: "backup-ref", reason: "ok", idempotencyKey: "appr-009b",
    });

    await expect(deps.service.commitBatch(makeUser(TEST_USER_ID_OWNER), makeOwnerEff(), {
      importBatchId: "batch-001", backupEvidenceRef: "backup-ref", idempotencyKey: "commit-009",
    })).rejects.toBeInstanceOf(UnresolvedReviewItemsError);
  });
});

// ===========================================================================
// 10. Overlapping data (DEC-071)
// ===========================================================================

describe("WP-07-04 DEC-071 overlap", () => {
  it("10. overlapping opening + transaction data blocked", async () => {
    const deps = makeDeps();
    setupBatchWithRows(deps, [
      makeStagingRow("row-001", { name: "A", code: "C001", quantity: "100", date: "2026-01-01", item_id: TEST_ITEM_ID, location_id: TEST_LOCATION_ID, balance: "500", sale_amount: "200" }),
    ]);

    await deps.service.submitApproval(makeUser(TEST_USER_ID_OWNER), makeOwnerEff(), {
      importBatchId: "batch-001", approverRole: "owner", backupEvidenceRef: "backup-ref", reason: "ok", idempotencyKey: "appr-010a",
    });
    await deps.service.submitApproval(makeUser(TEST_USER_ID_ACCT), makeAcctEff(), {
      importBatchId: "batch-001", approverRole: "accountant", backupEvidenceRef: "backup-ref", reason: "ok", idempotencyKey: "appr-010b",
    });

    await expect(deps.service.commitBatch(makeUser(TEST_USER_ID_OWNER), makeOwnerEff(), {
      importBatchId: "batch-001", backupEvidenceRef: "backup-ref", idempotencyKey: "commit-010",
    })).rejects.toBeInstanceOf(OverlappingDataError);
  });
});

// ===========================================================================
// 11. Idempotency
// ===========================================================================

describe("WP-07-04 idempotency", () => {
  it("11. replay does not double commit", async () => {
    const deps = makeDeps();
    setupBatchWithRows(deps, [makeStagingRow("row-001", { name: "A", code: "C001", quantity: "100", date: "2026-01-01", item_id: TEST_ITEM_ID, location_id: TEST_LOCATION_ID })]);

    await deps.service.submitApproval(makeUser(TEST_USER_ID_OWNER), makeOwnerEff(), {
      importBatchId: "batch-001", approverRole: "owner", backupEvidenceRef: "backup-ref", reason: "ok", idempotencyKey: "appr-011a",
    });
    await deps.service.submitApproval(makeUser(TEST_USER_ID_ACCT), makeAcctEff(), {
      importBatchId: "batch-001", approverRole: "accountant", backupEvidenceRef: "backup-ref", reason: "ok", idempotencyKey: "appr-011b",
    });

    const result1 = await deps.service.commitBatch(makeUser(TEST_USER_ID_OWNER), makeOwnerEff(), {
      importBatchId: "batch-001", backupEvidenceRef: "backup-ref", idempotencyKey: "commit-011",
    });
    expect(result1.action).toBe("committed");

    const result2 = await deps.service.commitBatch(makeUser(TEST_USER_ID_OWNER), makeOwnerEff(), {
      importBatchId: "batch-001", backupEvidenceRef: "backup-ref", idempotencyKey: "commit-011",
    });
    expect(result2.action).toBe("replayed");
  });
});

// ===========================================================================
// 12. Audit
// ===========================================================================

describe("WP-07-04 audit", () => {
  it("12. audit rows created for approval and commit", async () => {
    const deps = makeDeps();
    setupBatchWithRows(deps, [makeStagingRow("row-001", { name: "A", code: "C001", quantity: "100", date: "2026-01-01", item_id: TEST_ITEM_ID, location_id: TEST_LOCATION_ID })]);

    await deps.service.submitApproval(makeUser(TEST_USER_ID_OWNER), makeOwnerEff(), {
      importBatchId: "batch-001", approverRole: "owner", backupEvidenceRef: "backup-ref", reason: "ok", idempotencyKey: "appr-012a",
    });
    await deps.service.submitApproval(makeUser(TEST_USER_ID_ACCT), makeAcctEff(), {
      importBatchId: "batch-001", approverRole: "accountant", backupEvidenceRef: "backup-ref", reason: "ok", idempotencyKey: "appr-012b",
    });
    await deps.service.commitBatch(makeUser(TEST_USER_ID_OWNER), makeOwnerEff(), {
      importBatchId: "batch-001", backupEvidenceRef: "backup-ref", idempotencyKey: "commit-012",
    });

    const approveAudit = deps.audit.getRows().filter(r => r.actionType === "historical_commit.approve");
    expect(approveAudit.length).toBe(2);

    const commitAudit = deps.audit.getRows().filter(r => r.actionType === "historical_commit.commit");
    expect(commitAudit.length).toBe(1);
    expect((commitAudit[0]?.newValuesJson?.effectCounts as any)?.staging_rows_committed).toBe(1);
  });
});

// ===========================================================================
// 13. Tenant isolation
// ===========================================================================

describe("WP-07-04 tenant isolation", () => {
  it("13. cannot access another tenant's batch", async () => {
    const deps = makeDeps();
    deps.repository.seedBatch(TEST_TENANT_ID, makeBatch("batch-001"));

    await expect(deps.service.submitApproval(
      makeUser("other-user", "other-tenant"), makeOwnerEff(),
      { importBatchId: "batch-001", approverRole: "owner", backupEvidenceRef: "ref", reason: "ok", idempotencyKey: "appr-013" },
    )).rejects.toBeInstanceOf(BatchNotFoundForCommitError);
  });
});

// ===========================================================================
// 14. Role denial
// ===========================================================================

describe("WP-07-04 role denial", () => {
  it("14. worker denied migration.approve", async () => {
    const deps = makeDeps();
    deps.repository.seedBatch(TEST_TENANT_ID, makeBatch("batch-001"));

    await expect(deps.service.submitApproval(
      makeUser(TEST_USER_ID_OWNER), makeWorkerEff(),
      { importBatchId: "batch-001", approverRole: "owner", backupEvidenceRef: "ref", reason: "ok", idempotencyKey: "appr-014" },
    )).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

// ===========================================================================
// 15. No partial commit (rollback)
// ===========================================================================

describe("WP-07-04 rollback", () => {
  it("15. batch not found — no partial commit", async () => {
    const deps = makeDeps();

    await expect(deps.service.commitBatch(makeUser(TEST_USER_ID_OWNER), makeOwnerEff(), {
      importBatchId: "nonexistent", backupEvidenceRef: "ref", idempotencyKey: "commit-015",
    })).rejects.toBeInstanceOf(BatchNotFoundForCommitError);

    const batch = await deps.repository.findImportBatchById(TEST_TENANT_ID, "nonexistent");
    expect(batch).toBeNull();
  });
});
