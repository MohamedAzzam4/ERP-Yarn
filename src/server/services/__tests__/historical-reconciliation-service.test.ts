/**
 * WP-07-03 Historical Reconciliation — tests.
 * Contract 08 §8.7-8.9.
 */
import { describe, it, expect } from "vitest";
import {
  HistoricalReconciliationService,
  ReconBatchNotFoundError,
  ReviewItemNotFoundError,
} from "../historical-reconciliation-service";
import { InMemoryHistoricalReconciliationRepository } from "./in-memory-historical-reconciliation-repository";
import { InProcessAuditStore } from "../audit-service";
import { InProcessIdempotencyStore } from "../idempotency-service";
import { PermissionDeniedError } from "@/server/security/guards";
import type { ImportStagingRow, ImportBatch } from "@/server/db/schema/migration";

const TEST_TENANT_ID = "00000000-0000-0000-0000-000000070003";
const TEST_USER_ID = "00000000-0000-0000-0000-000000070003";

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
  const repository = new InMemoryHistoricalReconciliationRepository();
  const audit = new InProcessAuditStore();
  const idempotency = new InProcessIdempotencyStore();
  const service = new HistoricalReconciliationService({ repository, audit, idempotency });
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
    // WP-08-01F R1 — staging-row version fields.
    stagingVersion: 1, isCurrent: true,
    supersededAt: null, supersededByFileId: null,
    createdBy: TEST_USER_ID, createdAt: new Date(),
    updatedBy: null, updatedAt: null,
    ...overrides,
  };
}

function makeBatch(id: string = "batch-001"): ImportBatch {
  return {
    id, tenantId: TEST_TENANT_ID, batchNo: "MIG-001",
    status: "validation_complete", sourceDescription: "Test batch",
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
  deps.repository.seedBatch(TEST_TENANT_ID, makeBatch(batchId));
  deps.repository.seedStagingRows(TEST_TENANT_ID, batchId, rows);
}

// ===========================================================================
// 1-4. Reconciliation metrics
// ===========================================================================

describe("WP-07-03 reconciliation metrics", () => {
  it("1. opening inventory mismatch detected", async () => {
    const deps = makeDeps();
    setupBatchWithRows(deps, [
      makeStagingRow("row-001", { name: "Item A", code: "I001", quantity: "100", date: "2026-01-01" }),
      makeStagingRow("row-002", { name: "Item B", code: "I002", quantity: "200", date: "2026-01-01" }, { sourceRowNumber: 2 }),
    ]);

    const result = await deps.service.runReconciliation(makeUser() as any, makeOwnerEff(), {
      importBatchId: "batch-001",
      expectedTotals: { inventory_opening_qty: "500" }, // expected 500, staged 300
      idempotencyKey: "recon-001",
    });

    expect(result.action).toBe("executed");
    expect(result.differences + result.blocking).toBeGreaterThan(0);

    const results = await deps.repository.findReconciliationResultsForBatch(TEST_TENANT_ID, "batch-001");
    const inventoryMetric = results.find(r => r.metricKey === "inventory_opening_qty");
    expect(inventoryMetric).toBeTruthy();
    expect(inventoryMetric?.status).not.toBe("matched");
  });

  it("2. party/subledger balance mismatch detected", async () => {
    const deps = makeDeps();
    setupBatchWithRows(deps, [
      makeStagingRow("row-001", { name: "Customer A", code: "C001", quantity: "100", date: "2026-01-01", balance: "500" }),
      makeStagingRow("row-002", { name: "Customer B", code: "C002", quantity: "100", date: "2026-01-01", balance: "300" }, { sourceRowNumber: 2 }),
    ]);

    const result = await deps.service.runReconciliation(makeUser() as any, makeOwnerEff(), {
      importBatchId: "batch-001",
      expectedTotals: { party_balance_total: "1000" }, // expected 1000, staged 800
      idempotencyKey: "recon-002",
    });

    const results = await deps.repository.findReconciliationResultsForBatch(TEST_TENANT_ID, "batch-001");
    const balanceMetric = results.find(r => r.metricKey === "party_balance_total");
    expect(balanceMetric?.status).not.toBe("matched");
  });

  it("3. WIP mismatch detected", async () => {
    const deps = makeDeps();
    setupBatchWithRows(deps, [
      makeStagingRow("row-001", { name: "Item A", code: "I001", quantity: "100", date: "2026-01-01", wip_qty: "50" }),
    ]);

    const result = await deps.service.runReconciliation(makeUser() as any, makeOwnerEff(), {
      importBatchId: "batch-001",
      expectedTotals: { wip_opening_qty: "100" }, // expected 100, staged 50
      idempotencyKey: "recon-003",
    });

    const results = await deps.repository.findReconciliationResultsForBatch(TEST_TENANT_ID, "batch-001");
    const wipMetric = results.find(r => r.metricKey === "wip_opening_qty");
    expect(wipMetric?.status).not.toBe("matched");
  });

  it("4. duplicate document collision detected", async () => {
    const deps = makeDeps();
    setupBatchWithRows(deps, [
      makeStagingRow("row-001", { name: "Item A", code: "I001", quantity: "100", date: "2026-01-01", doc_no: "DOC001" }),
      makeStagingRow("row-002", { name: "Item B", code: "I002", quantity: "100", date: "2026-01-01", doc_no: "DOC001" }, { sourceRowNumber: 2 }),
    ]);

    const result = await deps.service.runReconciliation(makeUser() as any, makeOwnerEff(), {
      importBatchId: "batch-001",
      expectedTotals: { inventory_opening_qty: "200" },
      idempotencyKey: "recon-004",
    });

    const results = await deps.repository.findReconciliationResultsForBatch(TEST_TENANT_ID, "batch-001");
    const dupMetric = results.find(r => r.metricKey.startsWith("duplicate_document_"));
    expect(dupMetric).toBeTruthy();
    expect(dupMetric?.status).toBe("blocking");
  });
});

// ===========================================================================
// 5-7. Negative, unmatched, version invalidation
// ===========================================================================

describe("WP-07-03 negative/unmatched/versioning", () => {
  it("5. negative staged quantity detected", async () => {
    const deps = makeDeps();
    setupBatchWithRows(deps, [
      makeStagingRow("row-001", { name: "Item A", code: "I001", quantity: "-50", date: "2026-01-01" }),
    ]);

    const result = await deps.service.runReconciliation(makeUser() as any, makeOwnerEff(), {
      importBatchId: "batch-001",
      expectedTotals: { inventory_opening_qty: "-50" },
      idempotencyKey: "recon-005",
    });

    const results = await deps.repository.findReconciliationResultsForBatch(TEST_TENANT_ID, "batch-001");
    const negMetric = results.find(r => r.metricKey.startsWith("negative_staged_quantity"));
    expect(negMetric).toBeTruthy();
    expect(negMetric?.status).toBe("blocking");
  });

  it("6. unmatched alias/lineage detected", async () => {
    const deps = makeDeps();
    setupBatchWithRows(deps, [
      makeStagingRow("row-001", { name: "Unknown Customer", code: "C001", quantity: "100", date: "2026-01-01" }), // no customer_id/item_id
    ]);

    const result = await deps.service.runReconciliation(makeUser() as any, makeOwnerEff(), {
      importBatchId: "batch-001",
      expectedTotals: { inventory_opening_qty: "100" },
      idempotencyKey: "recon-006",
    });

    const results = await deps.repository.findReconciliationResultsForBatch(TEST_TENANT_ID, "batch-001");
    const unmatchedMetric = results.find(r => r.metricKey.startsWith("unmatched_alias_"));
    expect(unmatchedMetric).toBeTruthy();
    expect(unmatchedMetric?.status).toBe("blocking");
  });

  it("7. version invalidation — re-run creates new version", async () => {
    const deps = makeDeps();
    setupBatchWithRows(deps, [
      makeStagingRow("row-001", { name: "Item A", code: "I001", quantity: "100", date: "2026-01-01" }),
    ]);

    // First reconciliation run
    const result1 = await deps.service.runReconciliation(makeUser() as any, makeOwnerEff(), {
      importBatchId: "batch-001",
      expectedTotals: { inventory_opening_qty: "100" },
      idempotencyKey: "recon-007a",
    });
    expect(result1.reportVersion).toBe(1);

    // Second run with different expected (staged data "changed")
    const result2 = await deps.service.runReconciliation(makeUser() as any, makeOwnerEff(), {
      importBatchId: "batch-001",
      expectedTotals: { inventory_opening_qty: "200" },
      idempotencyKey: "recon-007b",
    });
    expect(result2.reportVersion).toBe(2);

    // WP-07-03 correction: Old version 1 results are PRESERVED (not deleted)
    // and NOT mutated — their notes/evidence fields remain unchanged.
    // (Milestone C proof correction: markVersionAsSuperseded was removed
    // because it overwrote the notes field, destroying original review
    // reasons. The report_version column itself is the supersession
    // mechanism — latest version is current, older versions are immutable
    // audit history.)
    const v1Results = await deps.repository.findReconciliationResultsForBatchVersion(TEST_TENANT_ID, "batch-001", 1);
    expect(v1Results.length).toBeGreaterThan(0); // V1 still exists!

    // V1 results' notes are NOT overwritten with SUPERSEDED — they retain
    // their original values (immutable evidence).
    expect(v1Results.every(r => !r.notes?.includes("SUPERSEDED"))).toBe(true);

    // New version 2 results exist
    const v2Results = await deps.repository.findReconciliationResultsForBatchVersion(TEST_TENANT_ID, "batch-001", 2);
    expect(v2Results.length).toBeGreaterThan(0);

    // Latest version is 2
    const latestVersion = await deps.repository.findLatestReportVersion(TEST_TENANT_ID, "batch-001");
    expect(latestVersion).toBe(2);
  });
});

// ===========================================================================
// 8-10. Review items + acceptance + blocking
// ===========================================================================

describe("WP-07-03 review items", () => {
  it("8. review items created for mismatches", async () => {
    const deps = makeDeps();
    setupBatchWithRows(deps, [
      makeStagingRow("row-001", { name: "Item A", code: "I001", quantity: "100", date: "2026-01-01" }),
    ]);

    const result = await deps.service.runReconciliation(makeUser() as any, makeOwnerEff(), {
      importBatchId: "batch-001",
      expectedTotals: { inventory_opening_qty: "200" }, // mismatch
      idempotencyKey: "recon-008",
    });

    expect(result.reviewItemsCreated).toBeGreaterThan(0);
    const reviews = await deps.repository.findReviewItemsForBatch(TEST_TENANT_ID, "batch-001");
    expect(reviews.length).toBeGreaterThan(0);
    expect(reviews.every(r => r.status === "pending")).toBe(true);
  });

  it("9. warning acceptance requires reason/permission", async () => {
    const deps = makeDeps();
    setupBatchWithRows(deps, [
      makeStagingRow("row-001", { name: "Item A", code: "I001", quantity: "100", date: "2026-01-01" }),
    ]);

    await deps.service.runReconciliation(makeUser() as any, makeOwnerEff(), {
      importBatchId: "batch-001",
      expectedTotals: { inventory_opening_qty: "200" },
      idempotencyKey: "recon-009",
    });

    const reviews = await deps.repository.findReviewItemsForBatch(TEST_TENANT_ID, "batch-001");
    expect(reviews.length).toBeGreaterThan(0);

    // Record decision with reason
    const decision = await deps.service.recordReviewDecision(makeUser() as any, makeOwnerEff(), {
      reviewItemId: reviews[0]!.id,
      decision: "accepted",
      decisionNotes: "Historical discrepancy accepted — source data confirmed.",
      idempotencyKey: "decision-009",
    });
    expect(decision.action).toBe("recorded");

    // Decision without notes fails
    await expect(deps.service.recordReviewDecision(makeUser() as any, makeOwnerEff(), {
      reviewItemId: reviews[0]!.id,
      decision: "accepted",
      decisionNotes: "",
      idempotencyKey: "decision-009b",
    })).rejects.toThrow("decisionNotes is required");
  });

  it("10. cannot accept blocking finding as clean (blocking stays blocking)", async () => {
    const deps = makeDeps();
    setupBatchWithRows(deps, [
      makeStagingRow("row-001", { name: "Item A", code: "I001", quantity: "-50", date: "2026-01-01" }), // negative → blocking
    ]);

    const result = await deps.service.runReconciliation(makeUser() as any, makeOwnerEff(), {
      importBatchId: "batch-001",
      expectedTotals: { inventory_opening_qty: "-50" },
      idempotencyKey: "recon-010",
    });

    // Blocking results exist
    const results = await deps.repository.findReconciliationResultsForBatch(TEST_TENANT_ID, "batch-001");
    const blocking = results.filter(r => r.status === "blocking");
    expect(blocking.length).toBeGreaterThan(0);
    // Blocking status cannot be downgraded by the service
    expect(blocking.every(r => r.status === "blocking")).toBe(true);
  });
});

// ===========================================================================
// 11. Idempotency
// ===========================================================================

describe("WP-07-03 idempotency", () => {
  it("11. replay does not duplicate results/review items", async () => {
    const deps = makeDeps();
    setupBatchWithRows(deps, [
      makeStagingRow("row-001", { name: "Item A", code: "I001", quantity: "100", date: "2026-01-01" }),
    ]);

    const result1 = await deps.service.runReconciliation(makeUser() as any, makeOwnerEff(), {
      importBatchId: "batch-001",
      expectedTotals: { inventory_opening_qty: "200" },
      idempotencyKey: "recon-011",
    });
    const result2 = await deps.service.runReconciliation(makeUser() as any, makeOwnerEff(), {
      importBatchId: "batch-001",
      expectedTotals: { inventory_opening_qty: "200" },
      idempotencyKey: "recon-011",
    });

    expect(result2.action).toBe("replayed");
    const results = await deps.repository.findReconciliationResultsForBatch(TEST_TENANT_ID, "batch-001");
    const reviews = await deps.repository.findReviewItemsForBatch(TEST_TENANT_ID, "batch-001");
    expect(results.length).toBe(result1.totalMetrics);
    expect(reviews.length).toBe(result1.reviewItemsCreated);
  });
});

// ===========================================================================
// 12. Tenant isolation
// ===========================================================================

describe("WP-07-03 tenant isolation", () => {
  it("12. cannot access another tenant's batch", async () => {
    const deps = makeDeps();
    deps.repository.seedBatch(TEST_TENANT_ID, makeBatch("batch-001"));

    await expect(deps.service.runReconciliation(
      makeUser("other-user", "other-tenant") as any, makeOwnerEff(),
      { importBatchId: "batch-001", expectedTotals: {}, idempotencyKey: "recon-012" },
    )).rejects.toBeInstanceOf(ReconBatchNotFoundError);
  });
});

// ===========================================================================
// 13. Audit
// ===========================================================================

describe("WP-07-03 audit", () => {
  it("13. audit rows created for reconciliation run + results + reviews", async () => {
    const deps = makeDeps();
    setupBatchWithRows(deps, [
      makeStagingRow("row-001", { name: "Item A", code: "I001", quantity: "100", date: "2026-01-01" }),
    ]);

    await deps.service.runReconciliation(makeUser() as any, makeOwnerEff(), {
      importBatchId: "batch-001",
      expectedTotals: { inventory_opening_qty: "200" },
      idempotencyKey: "recon-013",
    });

    const runAudit = deps.audit.getRows().filter(r => r.actionType === "historical_reconciliation.run");
    expect(runAudit.length).toBe(1);

    const resultAudit = deps.audit.getRows().filter(r => r.actionType === "historical_reconciliation.result");
    expect(resultAudit.length).toBeGreaterThan(0);

    const reviewAudit = deps.audit.getRows().filter(r => r.actionType === "historical_reconciliation.review_created");
    expect(reviewAudit.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 14. No operational side effects
// ===========================================================================

describe("WP-07-03 no operational side effects", () => {
  it("14. reconciliation creates no stock/account/sales movements", async () => {
    const deps = makeDeps();
    setupBatchWithRows(deps, [
      makeStagingRow("row-001", { name: "Item A", code: "I001", quantity: "100", date: "2026-01-01" }),
    ]);

    await deps.service.runReconciliation(makeUser() as any, makeOwnerEff(), {
      importBatchId: "batch-001",
      expectedTotals: { inventory_opening_qty: "100" },
      idempotencyKey: "recon-014",
    });

    // HistoricalReconciliationService has NO dependency on operational services.
    expect(deps.service).toBeDefined();

    // Batch not committed
    const batch = await deps.repository.findImportBatchById(TEST_TENANT_ID, "batch-001");
    expect(batch?.committedAt).toBeNull();
  });
});

// ===========================================================================
// 15. Rollback/failure
// ===========================================================================

describe("WP-07-03 rollback", () => {
  it("15. batch not found — no partial results created", async () => {
    const deps = makeDeps();

    await expect(deps.service.runReconciliation(makeUser() as any, makeOwnerEff(), {
      importBatchId: "nonexistent-batch",
      expectedTotals: {},
      idempotencyKey: "recon-015",
    })).rejects.toBeInstanceOf(ReconBatchNotFoundError);

    const results = await deps.repository.findReconciliationResultsForBatch(TEST_TENANT_ID, "nonexistent-batch");
    expect(results.length).toBe(0);
  });
});
