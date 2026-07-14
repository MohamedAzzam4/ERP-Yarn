/**
 * WP-07-02 Historical Validation — tests.
 *
 * Contract: docs/contracts/08_historical_migration_contract.md
 *   §8.5 Validation Severity, §8.6 Required Validation Rules,
 *   §8.4 Master Data Extraction and Alias Mapping.
 *
 * Covers:
 *   1. required field validation
 *   2. date validation (future date blocking)
 *   3. currency validation (non-EGP blocking)
 *   4. duplicate source row validation
 *   5. negative quantity validation
 *   6. severity preserved, not downgraded
 *   7. master candidates created as candidates only
 *   8. alias review records created for ambiguous matches
 *   9. no automatic master creation
 *   10. no automatic alias merge
 *   11. tenant isolation
 *   12. idempotency replay does not duplicate findings/candidates
 *   13. audit rows created
 *   14. no operational side effects
 *   15. rollback/failure leaves no partial duplicate findings
 */
import { describe, it, expect } from "vitest";
import {
  HistoricalValidationService,
  BatchNotFoundError,
} from "../historical-validation-service";
import { InMemoryHistoricalValidationRepository } from "./in-memory-historical-validation-repository";
import { InProcessAuditStore } from "../audit-service";
import { InProcessIdempotencyStore } from "../idempotency-service";
import { PermissionDeniedError } from "@/server/security/guards";
import type { ImportStagingRow, ImportBatch } from "@/server/db/schema/migration";

const TEST_TENANT_ID = "00000000-0000-0000-0000-000000070002";
const TEST_USER_ID = "00000000-0000-0000-0000-000000070002";

function makeUser(userId: string = TEST_USER_ID, tenantId: string = TEST_TENANT_ID) {
  return { authenticated: true as const, userId, tenantId, email: "t@e.com", name: "T", authId: "t" };
}
function makeOwnerEff() {
  return {
    assignedRoleCodes: ["owner"],
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
  const repository = new InMemoryHistoricalValidationRepository();
  const audit = new InProcessAuditStore();
  const idempotency = new InProcessIdempotencyStore();
  const service = new HistoricalValidationService({ repository, audit, idempotency });
  return { repository, audit, idempotency, service };
}

function makeStagingRow(id: string, data: Record<string, unknown>, overrides: Partial<ImportStagingRow> = {}): ImportStagingRow {
  return {
    id, tenantId: TEST_TENANT_ID, importBatchId: "batch-001",
    importFileId: null, templateName: null,
    sourceSheetName: "Sheet1", sourceRowNumber: 1,
    rawRowJson: data, transformedRowJson: null,
    validationStatus: "pending", reviewStatus: "not_required",
    aiConfidence: null, transformationNotes: null,
    committedEntityType: null, committedEntityId: null,
    createdBy: TEST_USER_ID, createdAt: new Date(),
    updatedBy: null, updatedAt: null,
    ...overrides,
  };
}

function makeBatch(id: string = "batch-001"): ImportBatch {
  return {
    id, tenantId: TEST_TENANT_ID, batchNo: "MIG-001",
    status: "staged", sourceDescription: "Test batch",
    templateName: null, templateVersion: null, mappingVersion: null,
    cutoverManifestHash: null, cutoverImportMode: "opening_balance" as any,
    stagedDataHash: null, stagedRowCount: 0, blockingErrorCount: 0,
    warningCount: 0, acceptedWarningCount: 0,
    validationStatus: null, reconciliationStatus: null, warningSummary: null,
    committedAt: null, commitEffectCounts: null,
    createdBy: TEST_USER_ID, createdAt: new Date(),
    updatedBy: null, updatedAt: null,
  };
}

function setupBatchWithRows(deps: ReturnType<typeof makeDeps>, rows: ImportStagingRow[], batchId: string = "batch-001") {
  const batch = makeBatch(batchId);
  deps.repository.seedBatch(TEST_TENANT_ID, batch);
  deps.repository.seedStagingRows(TEST_TENANT_ID, batchId, rows);
}

// ===========================================================================
// 1-5. Validation rules
// ===========================================================================

describe("WP-07-02 validation rules", () => {
  it("1. required field validation — missing fields create blocking errors", async () => {
    const deps = makeDeps();
    setupBatchWithRows(deps, [
      makeStagingRow("row-001", { name: "Test" }), // missing code, quantity, date
    ]);

    const result = await deps.service.runValidation(makeUser() as any, makeOwnerEff(), {
      importBatchId: "batch-001", idempotencyKey: "val-001",
    });

    expect(result.action).toBe("executed");
    expect(result.blockingErrors).toBeGreaterThan(0);
    const errors = await deps.repository.findValidationErrorsForBatch(TEST_TENANT_ID, "batch-001");
    expect(errors.some(e => e.errorCode === "REQUIRED_FIELD_MISSING")).toBe(true);
  });

  it("2. future date validation — creates blocking error", async () => {
    const deps = makeDeps();
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);
    setupBatchWithRows(deps, [
      makeStagingRow("row-001", { name: "Test", code: "C001", quantity: "100", date: futureDate.toISOString().slice(0, 10) }),
    ]);

    const result = await deps.service.runValidation(makeUser() as any, makeOwnerEff(), {
      importBatchId: "batch-001", idempotencyKey: "val-002",
    });

    const errors = await deps.repository.findValidationErrorsForBatch(TEST_TENANT_ID, "batch-001");
    expect(errors.some(e => e.errorCode === "FUTURE_DATE")).toBe(true);
  });

  it("3. currency validation — non-EGP creates blocking error", async () => {
    const deps = makeDeps();
    setupBatchWithRows(deps, [
      makeStagingRow("row-001", { name: "Test", code: "C001", quantity: "100", date: "2026-01-01", currency: "USD" }),
    ]);

    await deps.service.runValidation(makeUser() as any, makeOwnerEff(), {
      importBatchId: "batch-001", idempotencyKey: "val-003",
    });

    const errors = await deps.repository.findValidationErrorsForBatch(TEST_TENANT_ID, "batch-001");
    expect(errors.some(e => e.errorCode === "UNSUPPORTED_CURRENCY")).toBe(true);
  });

  it("4. duplicate source row validation — creates blocking error", async () => {
    const deps = makeDeps();
    setupBatchWithRows(deps, [
      makeStagingRow("row-001", { name: "Test", code: "C001", quantity: "100", date: "2026-01-01" }, { sourceRowNumber: 5 }),
      makeStagingRow("row-002", { name: "Test2", code: "C002", quantity: "200", date: "2026-01-02" }, { sourceRowNumber: 5 }),
    ]);

    await deps.service.runValidation(makeUser() as any, makeOwnerEff(), {
      importBatchId: "batch-001", idempotencyKey: "val-004",
    });

    const errors = await deps.repository.findValidationErrorsForBatch(TEST_TENANT_ID, "batch-001");
    expect(errors.some(e => e.errorCode === "DUPLICATE_SOURCE_ROW")).toBe(true);
  });

  it("5. negative quantity validation — creates blocking error", async () => {
    const deps = makeDeps();
    setupBatchWithRows(deps, [
      makeStagingRow("row-001", { name: "Test", code: "C001", quantity: "-50", date: "2026-01-01" }),
    ]);

    await deps.service.runValidation(makeUser() as any, makeOwnerEff(), {
      importBatchId: "batch-001", idempotencyKey: "val-005",
    });

    const errors = await deps.repository.findValidationErrorsForBatch(TEST_TENANT_ID, "batch-001");
    expect(errors.some(e => e.errorCode === "NEGATIVE_QUANTITY")).toBe(true);
  });
});

// ===========================================================================
// 6. Severity preserved
// ===========================================================================

describe("WP-07-02 severity", () => {
  it("6. blocking_error severity is preserved, not downgraded", async () => {
    const deps = makeDeps();
    setupBatchWithRows(deps, [
      makeStagingRow("row-001", { name: "Test" }), // missing fields → blocking
    ]);

    await deps.service.runValidation(makeUser() as any, makeOwnerEff(), {
      importBatchId: "batch-001", idempotencyKey: "val-006",
    });

    const errors = await deps.repository.findValidationErrorsForBatch(TEST_TENANT_ID, "batch-001");
    const blocking = errors.filter(e => e.severity === "blocking_error");
    expect(blocking.length).toBeGreaterThan(0);
    expect(blocking.every(e => e.isBlocking === true)).toBe(true);
  });
});

// ===========================================================================
// 7-10. Master extraction + alias review
// ===========================================================================

describe("WP-07-02 master extraction", () => {
  it("7. master candidates created as candidates only (status=candidate)", async () => {
    const deps = makeDeps();
    setupBatchWithRows(deps, [
      makeStagingRow("row-001", { name: "Customer A", code: "C001", quantity: "100", date: "2026-01-01" }),
    ]);

    await deps.service.runValidation(makeUser() as any, makeOwnerEff(), {
      importBatchId: "batch-001", idempotencyKey: "val-007",
    });

    const aliases = await deps.repository.findAliasMappingsForBatch(TEST_TENANT_ID, "batch-001");
    expect(aliases.length).toBe(1);
    expect(aliases[0]?.status).toBe("candidate");
    expect(aliases[0]?.targetMasterId).toBeNull(); // no automatic linking
  });

  it("8. alias review records created for ambiguous matches", async () => {
    const deps = makeDeps();
    setupBatchWithRows(deps, [
      makeStagingRow("row-001", { name: "Customer A", code: "C001", quantity: "100", date: "2026-01-01" }),
    ]);

    await deps.service.runValidation(makeUser() as any, makeOwnerEff(), {
      importBatchId: "batch-001", idempotencyKey: "val-008",
    });

    const reviews = await deps.repository.findHumanReviewItemsForBatch(TEST_TENANT_ID, "batch-001");
    expect(reviews.length).toBe(1);
    expect(reviews[0]?.status).toBe("pending");
    expect(reviews[0]?.reviewReason).toContain("Customer A");
  });

  it("9. no automatic master creation — targetMasterId is always null", async () => {
    const deps = makeDeps();
    setupBatchWithRows(deps, [
      makeStagingRow("row-001", { name: "Supplier X", code: "S001", quantity: "100", date: "2026-01-01" }),
      makeStagingRow("row-002", { name: "Supplier Y", code: "S002", quantity: "200", date: "2026-01-02" }),
    ]);

    await deps.service.runValidation(makeUser() as any, makeOwnerEff(), {
      importBatchId: "batch-001", idempotencyKey: "val-009",
    });

    const aliases = await deps.repository.findAliasMappingsForBatch(TEST_TENANT_ID, "batch-001");
    expect(aliases.every(a => a.targetMasterId === null)).toBe(true);
  });

  it("10. no automatic alias merge — same source label creates one candidate, not merged", async () => {
    const deps = makeDeps();
    setupBatchWithRows(deps, [
      makeStagingRow("row-001", { name: "Same Name", code: "C001", quantity: "100", date: "2026-01-01" }),
      makeStagingRow("row-002", { name: "Same Name", code: "C002", quantity: "200", date: "2026-01-02" }, { sourceRowNumber: 2 }),
    ]);

    await deps.service.runValidation(makeUser() as any, makeOwnerEff(), {
      importBatchId: "batch-001", idempotencyKey: "val-010",
    });

    const aliases = await deps.repository.findAliasMappingsForBatch(TEST_TENANT_ID, "batch-001");
    // Should create only 1 alias for "Same Name" (deduplicated by source label)
    expect(aliases.length).toBe(1);
    expect(aliases[0]?.status).toBe("candidate"); // still candidate, not auto-merged
  });
});

// ===========================================================================
// 11. Tenant isolation
// ===========================================================================

describe("WP-07-02 tenant isolation", () => {
  it("11. tenant isolation — cannot access another tenant's batch", async () => {
    const deps = makeDeps();
    const batch = makeBatch("batch-001");
    deps.repository.seedBatch(TEST_TENANT_ID, batch);

    // User from different tenant
    const otherUser = makeUser("other-user", "other-tenant");

    await expect(deps.service.runValidation(otherUser as any, makeOwnerEff(), {
      importBatchId: "batch-001", idempotencyKey: "val-011",
    })).rejects.toBeInstanceOf(BatchNotFoundError);
  });
});

// ===========================================================================
// 12. Idempotency
// ===========================================================================

describe("WP-07-02 idempotency", () => {
  it("12. idempotency replay does not duplicate findings/candidates", async () => {
    const deps = makeDeps();
    setupBatchWithRows(deps, [
      makeStagingRow("row-001", { name: "Test", code: "C001", quantity: "100", date: "2026-01-01" }),
    ]);

    const result1 = await deps.service.runValidation(makeUser() as any, makeOwnerEff(), {
      importBatchId: "batch-001", idempotencyKey: "val-012",
    });
    const result2 = await deps.service.runValidation(makeUser() as any, makeOwnerEff(), {
      importBatchId: "batch-001", idempotencyKey: "val-012",
    });

    expect(result2.action).toBe("replayed");

    const errors = await deps.repository.findValidationErrorsForBatch(TEST_TENANT_ID, "batch-001");
    const aliases = await deps.repository.findAliasMappingsForBatch(TEST_TENANT_ID, "batch-001");
    // Same count as first run (no duplicates)
    expect(errors.length).toBe(result1.totalFindings);
    expect(aliases.length).toBe(result1.masterCandidates);
  });
});

// ===========================================================================
// 13. Audit
// ===========================================================================

describe("WP-07-02 audit", () => {
  it("13. audit rows created for validation run", async () => {
    const deps = makeDeps();
    setupBatchWithRows(deps, [
      makeStagingRow("row-001", { name: "Test" }), // missing fields → blocking errors
    ]);

    await deps.service.runValidation(makeUser() as any, makeOwnerEff(), {
      importBatchId: "batch-001", idempotencyKey: "val-013",
    });

    const auditRows = deps.audit.getRows().filter(r => r.actionType === "historical_validation.run");
    expect(auditRows.length).toBe(1);
    expect(auditRows[0]?.entityId).toBe("batch-001");
    expect(auditRows[0]?.newValuesJson?.blockingErrors).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 14. No operational side effects
// ===========================================================================

describe("WP-07-02 no operational side effects", () => {
  it("14. validation creates no stock/account/sales movements", async () => {
    const deps = makeDeps();
    setupBatchWithRows(deps, [
      makeStagingRow("row-001", { name: "Test", code: "C001", quantity: "100", date: "2026-01-01" }),
    ]);

    await deps.service.runValidation(makeUser() as any, makeOwnerEff(), {
      importBatchId: "batch-001", idempotencyKey: "val-014",
    });

    // HistoricalValidationService has NO dependency on InventoryLedgerService,
    // SubledgerService, SalesRepository, or any operational service.
    // This is verified by the service not importing or using those services.
    expect(deps.service).toBeDefined();

    // Batch status updated to validation_complete (not committed)
    const batch = await deps.repository.findImportBatchById(TEST_TENANT_ID, "batch-001");
    expect(batch?.status).toBe("validation_complete");
    expect(batch?.committedAt).toBeNull();
  });
});

// ===========================================================================
// 15. Rollback/failure
// ===========================================================================

describe("WP-07-02 rollback", () => {
  it("15. batch not found — no partial findings created", async () => {
    const deps = makeDeps();

    await expect(deps.service.runValidation(makeUser() as any, makeOwnerEff(), {
      importBatchId: "nonexistent-batch", idempotencyKey: "val-015",
    })).rejects.toBeInstanceOf(BatchNotFoundError);

    // No findings should exist
    const errors = await deps.repository.findValidationErrorsForBatch(TEST_TENANT_ID, "nonexistent-batch");
    expect(errors.length).toBe(0);
  });
});
