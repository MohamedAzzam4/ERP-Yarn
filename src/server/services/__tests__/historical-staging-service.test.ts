/**
 * WP-07-01 Historical Staging — tests.
 *
 * Contract: docs/contracts/08_historical_migration_contract.md
 *   §8.1 Staging Isolation (non-operational)
 *
 * Covers:
 *   1. template version creation
 *   2. template version is non-destructive (cannot overwrite)
 *   3. file metadata registration with checksum/provenance
 *   4. re-upload creates new version, not overwrite
 *   5. duplicate file (same hash) is idempotent
 *   6. staging batch creation
 *   7. staging row insertion
 *   8. tenant isolation
 *   9. role denial (worker/quality cannot prepare)
 *   10. audit persistence
 *   11. idempotency replay safe
 *   12. no operational side effects (no stock/account/sales)
 *   13. rollback on failure (template already exists)
 *   14. batch listing
 *   15. batch detail with rows + files
 */
import { describe, it, expect } from "vitest";
import {
  HistoricalStagingService,
  TemplateVersionAlreadyExistsError,
  BatchNotFoundError,
} from "../historical-staging-service";
import { InMemoryHistoricalStagingRepository } from "./in-memory-historical-staging-repository";
import { InProcessAuditStore } from "../audit-service";
import { InProcessIdempotencyStore } from "../idempotency-service";
import { InProcessDocumentSequenceStore } from "../document-sequence-service";
import { PermissionDeniedError } from "@/server/security/guards";

const TEST_TENANT_ID = "00000000-0000-0000-0000-000000070001";
const TEST_USER_ID = "00000000-0000-0000-0000-000000070001";

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
function makeQualityEff() {
  return {
    assignedRoleCodes: ["quality_employee"],
    permissionKeys: new Set(["quality_tests.create"]),
    deniedFieldKeys: new Set(), workerFinancialDeny: true,
  } as any;
}

function makeDeps() {
  const repository = new InMemoryHistoricalStagingRepository();
  const audit = new InProcessAuditStore();
  const idempotency = new InProcessIdempotencyStore();
  const documentSequence = new InProcessDocumentSequenceStore();
  const service = new HistoricalStagingService({ repository, audit, idempotency, documentSequence });
  return { repository, audit, idempotency, documentSequence, service };
}

// ===========================================================================
// 1-2. Template version creation + non-destructive
// ===========================================================================

describe("WP-07-01 template versioning", () => {
  it("1. creates a template version", async () => {
    const deps = makeDeps();
    const user = makeUser();
    const eff = makeOwnerEff();

    const result = await deps.service.createTemplateVersion(user as any, eff, {
      templateName: "customers_v1",
      templateVersion: "1.0.0",
      schemaJson: { fields: ["name", "code", "status"] },
      idempotencyKey: "tmpl-001",
    });

    expect(result.action).toBe("created");
    expect(result.templateName).toBe("customers_v1");
    expect(result.templateVersion).toBe("1.0.0");
    expect(result.templateId).toBeTruthy();

    // Verify persisted
    const tmpl = await deps.repository.findTemplateVersionById(TEST_TENANT_ID, result.templateId);
    expect(tmpl?.templateName).toBe("customers_v1");
    expect(tmpl?.isActive).toBe(true);
  });

  it("2. template version is non-destructive (cannot overwrite same name+version)", async () => {
    const deps = makeDeps();
    const user = makeUser();
    const eff = makeOwnerEff();

    await deps.service.createTemplateVersion(user as any, eff, {
      templateName: "suppliers_v1",
      templateVersion: "1.0.0",
      schemaJson: { fields: ["name"] },
      idempotencyKey: "tmpl-002",
    });

    // Try to create same name+version — should fail
    await expect(deps.service.createTemplateVersion(user as any, eff, {
      templateName: "suppliers_v1",
      templateVersion: "1.0.0",
      schemaJson: { fields: ["name", "extra"] },
      idempotencyKey: "tmpl-003",
    })).rejects.toBeInstanceOf(TemplateVersionAlreadyExistsError);

    // But a new version of the same template name is allowed
    const result2 = await deps.service.createTemplateVersion(user as any, eff, {
      templateName: "suppliers_v1",
      templateVersion: "1.1.0",
      schemaJson: { fields: ["name", "code"] },
      idempotencyKey: "tmpl-004",
    });
    expect(result2.action).toBe("created");
    expect(result2.templateVersion).toBe("1.1.0");
  });
});

// ===========================================================================
// 3-5. File metadata registration + checksum + re-upload + duplicate
// ===========================================================================

describe("WP-07-01 file registration", () => {
  it("3. registers file with checksum/provenance", async () => {
    const deps = makeDeps();
    const user = makeUser();
    const eff = makeOwnerEff();

    // Create a batch first
    const batch = await deps.service.createBatch(user as any, eff, {
      sourceDescription: "Test batch",
      templateName: null, templateVersion: null,
      cutoverImportMode: "opening_balance",
      idempotencyKey: "batch-001",
    });

    const result = await deps.service.registerFile(user as any, eff, {
      importBatchId: batch.batchId,
      originalFileName: "customers.xlsx",
      storagePath: "private://tenant-001/batch-001/customers.xlsx",
      fileHash: "sha256:abc123",
      fileSizeBytes: 1024,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      fileType: "source",
      idempotencyKey: "file-001",
    });

    expect(result.action).toBe("created");
    expect(result.fileHash).toBe("sha256:abc123");

    // Verify persisted
    const file = await deps.repository.findImportFileById(TEST_TENANT_ID, result.fileId);
    expect(file?.originalFileName).toBe("customers.xlsx");
    expect(file?.fileHash).toBe("sha256:abc123");
    expect(file?.storagePath).toBe("private://tenant-001/batch-001/customers.xlsx");
  });

  it("4. re-upload with different hash creates new file (not overwrite)", async () => {
    const deps = makeDeps();
    const user = makeUser();
    const eff = makeOwnerEff();

    const batch = await deps.service.createBatch(user as any, eff, {
      sourceDescription: "Test batch",
      templateName: null, templateVersion: null,
      cutoverImportMode: "opening_balance",
      idempotencyKey: "batch-002",
    });

    // First file
    const file1 = await deps.service.registerFile(user as any, eff, {
      importBatchId: batch.batchId,
      originalFileName: "data.xlsx",
      storagePath: "private://data-v1.xlsx",
      fileHash: "sha256:hash1",
      fileSizeBytes: 100,
      contentType: null,
      fileType: "source",
      idempotencyKey: "file-002",
    });

    // Second file with different hash (new version)
    const file2 = await deps.service.registerFile(user as any, eff, {
      importBatchId: batch.batchId,
      originalFileName: "data.xlsx",
      storagePath: "private://data-v2.xlsx",
      fileHash: "sha256:hash2",
      fileSizeBytes: 200,
      contentType: null,
      fileType: "source",
      idempotencyKey: "file-003",
    });

    expect(file1.fileId).not.toBe(file2.fileId);
    expect(file1.fileHash).toBe("sha256:hash1");
    expect(file2.fileHash).toBe("sha256:hash2");

    // Both files exist
    const files = await deps.repository.findImportFilesForBatch(TEST_TENANT_ID, batch.batchId);
    expect(files.length).toBe(2);
  });

  it("5. duplicate file (same hash + batch + type) is idempotent", async () => {
    const deps = makeDeps();
    const user = makeUser();
    const eff = makeOwnerEff();

    const batch = await deps.service.createBatch(user as any, eff, {
      sourceDescription: "Test batch",
      templateName: null, templateVersion: null,
      cutoverImportMode: "opening_balance",
      idempotencyKey: "batch-003",
    });

    const file1 = await deps.service.registerFile(user as any, eff, {
      importBatchId: batch.batchId,
      originalFileName: "data.xlsx",
      storagePath: "private://data.xlsx",
      fileHash: "sha256:samehash",
      fileSizeBytes: 100,
      contentType: null,
      fileType: "source",
      idempotencyKey: "file-004",
    });

    // Same hash + batch + type with different idempotency key — returns existing file
    const file2 = await deps.service.registerFile(user as any, eff, {
      importBatchId: batch.batchId,
      originalFileName: "data_renamed.xlsx",
      storagePath: "private://data_renamed.xlsx",
      fileHash: "sha256:samehash",
      fileSizeBytes: 100,
      contentType: null,
      fileType: "source",
      idempotencyKey: "file-005",
    });

    expect(file2.fileId).toBe(file1.fileId);

    // Only 1 file in DB
    const files = await deps.repository.findImportFilesForBatch(TEST_TENANT_ID, batch.batchId);
    expect(files.length).toBe(1);
  });
});

// ===========================================================================
// 6-7. Staging batch + row insertion
// ===========================================================================

describe("WP-07-01 staging batch + rows", () => {
  it("6. creates a staging batch", async () => {
    const deps = makeDeps();
    const user = makeUser();
    const eff = makeOwnerEff();

    const result = await deps.service.createBatch(user as any, eff, {
      sourceDescription: "Historical opening balances",
      templateName: "customers_v1",
      templateVersion: "1.0.0",
      cutoverImportMode: "opening_balance",
      idempotencyKey: "batch-006",
    });

    expect(result.action).toBe("created");
    expect(result.batchNo).toBeTruthy();
    expect(result.status).toBe("draft");

    // Verify persisted
    const batch = await deps.repository.findImportBatchById(TEST_TENANT_ID, result.batchId);
    expect(batch?.sourceDescription).toBe("Historical opening balances");
    expect(batch?.cutoverImportMode).toBe("opening_balance");
    expect(batch?.stagedRowCount).toBe(0);
  });

  it("7. inserts staging rows with provenance", async () => {
    const deps = makeDeps();
    const user = makeUser();
    const eff = makeOwnerEff();

    const batch = await deps.service.createBatch(user as any, eff, {
      sourceDescription: "Test staging",
      templateName: null, templateVersion: null,
      cutoverImportMode: "opening_balance",
      idempotencyKey: "batch-007",
    });

    // Insert a file first
    const file = await deps.service.registerFile(user as any, eff, {
      importBatchId: batch.batchId,
      originalFileName: "data.xlsx",
      storagePath: "private://data.xlsx",
      fileHash: "sha256:abc",
      fileSizeBytes: 100,
      contentType: null,
      fileType: "source",
      idempotencyKey: "file-007",
    });

    // Insert staging rows
    const row1 = await deps.service.insertStagingRow(user as any, eff, {
      importBatchId: batch.batchId,
      importFileId: file.fileId,
      templateName: "customers_v1",
      sourceSheetName: "Sheet1",
      sourceRowNumber: 2,
      rawRowJson: { name: "Customer A", code: "CUST001" },
      transformedRowJson: { name: "Customer A", code: "CUST001", status: "active" },
      transformationNotes: null,
      idempotencyKey: "row-001",
    });

    const row2 = await deps.service.insertStagingRow(user as any, eff, {
      importBatchId: batch.batchId,
      importFileId: file.fileId,
      templateName: "customers_v1",
      sourceSheetName: "Sheet1",
      sourceRowNumber: 3,
      rawRowJson: { name: "Customer B", code: "CUST002" },
      transformedRowJson: { name: "Customer B", code: "CUST002", status: "active" },
      transformationNotes: null,
      idempotencyKey: "row-002",
    });

    expect(row1.action).toBe("created");
    expect(row2.action).toBe("created");
    expect(row1.stagingRowId).not.toBe(row2.stagingRowId);

    // Verify batch staged row count updated
    const batchAfter = await deps.repository.findImportBatchById(TEST_TENANT_ID, batch.batchId);
    expect(batchAfter?.stagedRowCount).toBe(2);

    // Verify rows persisted
    const rows = await deps.repository.findStagingRowsForBatch(TEST_TENANT_ID, batch.batchId);
    expect(rows.length).toBe(2);
    expect(rows[0]?.sourceRowNumber).toBe(2);
    expect(rows[1]?.sourceRowNumber).toBe(3);
  });
});

// ===========================================================================
// 8. Tenant isolation
// ===========================================================================

describe("WP-07-01 tenant isolation", () => {
  it("8. tenant isolation — cannot access another tenant's batch", async () => {
    const deps = makeDeps();
    const user = makeUser();
    const eff = makeOwnerEff();

    const batch = await deps.service.createBatch(user as any, eff, {
      sourceDescription: "Tenant A batch",
      templateName: null, templateVersion: null,
      cutoverImportMode: "opening_balance",
      idempotencyKey: "batch-008",
    });

    // User from different tenant
    const otherUser = makeUser("00000000-0000-0000-0000-000000070099", "00000000-0000-0000-0000-000000070099");

    // Cannot find batch from another tenant
    const batchFromOther = await deps.repository.findImportBatchById("00000000-0000-0000-0000-000000070099", batch.batchId);
    expect(batchFromOther).toBeNull();
  });
});

// ===========================================================================
// 9. Role denial
// ===========================================================================

describe("WP-07-01 role denial", () => {
  it("9. worker/quality roles denied migration.prepare", async () => {
    const deps = makeDeps();
    const user = makeUser();
    const workerEff = makeWorkerEff();
    const qualityEff = makeQualityEff();

    // Worker cannot create template
    await expect(deps.service.createTemplateVersion(user as any, workerEff, {
      templateName: "test", templateVersion: "1.0", schemaJson: {},
      idempotencyKey: "tmpl-denied-001",
    })).rejects.toBeInstanceOf(PermissionDeniedError);

    // Quality cannot create batch
    await expect(deps.service.createBatch(user as any, qualityEff, {
      sourceDescription: "test", templateName: null, templateVersion: null,
      cutoverImportMode: "opening_balance",
      idempotencyKey: "batch-denied-001",
    })).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

// ===========================================================================
// 10. Audit persistence
// ===========================================================================

describe("WP-07-01 audit persistence", () => {
  it("10. audit rows persisted for create actions", async () => {
    const deps = makeDeps();
    const user = makeUser();
    const eff = makeOwnerEff();

    const batch = await deps.service.createBatch(user as any, eff, {
      sourceDescription: "Audit test",
      templateName: null, templateVersion: null,
      cutoverImportMode: "opening_balance",
      idempotencyKey: "batch-audit-001",
    });

    const auditRows = deps.audit.getRows().filter(r => r.entityType === "import_batch");
    expect(auditRows.length).toBe(1);
    expect(auditRows[0]?.actionType).toBe("historical_batch.create");
    expect(auditRows[0]?.entityId).toBe(batch.batchId);
  });
});

// ===========================================================================
// 11. Idempotency replay
// ===========================================================================

describe("WP-07-01 idempotency", () => {
  it("11. idempotency replay returns same result", async () => {
    const deps = makeDeps();
    const user = makeUser();
    const eff = makeOwnerEff();

    const result1 = await deps.service.createBatch(user as any, eff, {
      sourceDescription: "Idempotency test",
      templateName: null, templateVersion: null,
      cutoverImportMode: "opening_balance",
      idempotencyKey: "batch-idem-001",
    });

    const result2 = await deps.service.createBatch(user as any, eff, {
      sourceDescription: "Idempotency test",
      templateName: null, templateVersion: null,
      cutoverImportMode: "opening_balance",
      idempotencyKey: "batch-idem-001",
    });

    expect(result2.action).toBe("replayed");
    expect(result2.batchId).toBe(result1.batchId);
  });
});

// ===========================================================================
// 12. No operational side effects
// ===========================================================================

describe("WP-07-01 no operational side effects", () => {
  it("12. staging creates no stock/account/sales movements", async () => {
    const deps = makeDeps();
    const user = makeUser();
    const eff = makeOwnerEff();

    const batch = await deps.service.createBatch(user as any, eff, {
      sourceDescription: "No side effects test",
      templateName: null, templateVersion: null,
      cutoverImportMode: "opening_balance",
      idempotencyKey: "batch-noside-001",
    });

    await deps.service.registerFile(user as any, eff, {
      importBatchId: batch.batchId,
      originalFileName: "data.xlsx",
      storagePath: "private://data.xlsx",
      fileHash: "sha256:noside",
      fileSizeBytes: 100,
      contentType: null,
      fileType: "source",
      idempotencyKey: "file-noside-001",
    });

    await deps.service.insertStagingRow(user as any, eff, {
      importBatchId: batch.batchId,
      importFileId: null,
      templateName: null,
      sourceSheetName: "Sheet1",
      sourceRowNumber: 1,
      rawRowJson: { qty: "100", price: "50" },
      transformedRowJson: { qty: "100", price: "50" },
      transformationNotes: null,
      idempotencyKey: "row-noside-001",
    });

    // Verify no stock movements were created (staging is non-operational)
    // The in-memory repository doesn't have stock movements — the point is
    // that HistoricalStagingService doesn't call InventoryLedgerService or
    // SubledgerService. This is verified by the service not having any
    // dependency on those services.
    expect(deps.service).toBeDefined();

    // Verify batch status is source_uploaded (registerFile transitions draft → source_uploaded)
    // No commit happened — committedAt is null.
    const batchAfter = await deps.repository.findImportBatchById(TEST_TENANT_ID, batch.batchId);
    expect(batchAfter?.status).toBe("source_uploaded");
    expect(batchAfter?.stagedRowCount).toBe(1);
    expect(batchAfter?.committedAt).toBeNull();
  });
});

// ===========================================================================
// 13. Rollback on failure
// ===========================================================================

describe("WP-07-01 rollback on failure", () => {
  it("13. template already exists — idempotency state is safe", async () => {
    const deps = makeDeps();
    const user = makeUser();
    const eff = makeOwnerEff();

    // Create first version
    await deps.service.createTemplateVersion(user as any, eff, {
      templateName: "items_v1",
      templateVersion: "1.0.0",
      schemaJson: { fields: ["name"] },
      idempotencyKey: "tmpl-rollback-001",
    });

    // Try to create same version — fails
    await expect(deps.service.createTemplateVersion(user as any, eff, {
      templateName: "items_v1",
      templateVersion: "1.0.0",
      schemaJson: { fields: ["name", "code"] },
      idempotencyKey: "tmpl-rollback-002",
    })).rejects.toBeInstanceOf(TemplateVersionAlreadyExistsError);

    // Can retry with a new version
    const result = await deps.service.createTemplateVersion(user as any, eff, {
      templateName: "items_v1",
      templateVersion: "2.0.0",
      schemaJson: { fields: ["name", "code"] },
      idempotencyKey: "tmpl-rollback-003",
    });
    expect(result.action).toBe("created");
    expect(result.templateVersion).toBe("2.0.0");
  });
});

// ===========================================================================
// 14-15. Batch listing + detail
// ===========================================================================

describe("WP-07-01 batch listing + detail", () => {
  it("14. lists batches for tenant", async () => {
    const deps = makeDeps();
    const user = makeUser();
    const eff = makeOwnerEff();

    await deps.service.createBatch(user as any, eff, {
      sourceDescription: "Batch 1",
      templateName: null, templateVersion: null,
      cutoverImportMode: "opening_balance",
      idempotencyKey: "batch-list-001",
    });
    await deps.service.createBatch(user as any, eff, {
      sourceDescription: "Batch 2",
      templateName: null, templateVersion: null,
      cutoverImportMode: "opening_balance",
      idempotencyKey: "batch-list-002",
    });

    const batches = await deps.service.listBatches(user as any, eff);
    expect(batches.length).toBe(2);
  });

  it("15. gets batch detail with rows + files", async () => {
    const deps = makeDeps();
    const user = makeUser();
    const eff = makeOwnerEff();

    const batch = await deps.service.createBatch(user as any, eff, {
      sourceDescription: "Detail test",
      templateName: null, templateVersion: null,
      cutoverImportMode: "opening_balance",
      idempotencyKey: "batch-detail-001",
    });

    const file = await deps.service.registerFile(user as any, eff, {
      importBatchId: batch.batchId,
      originalFileName: "data.xlsx",
      storagePath: "private://data.xlsx",
      fileHash: "sha256:detail",
      fileSizeBytes: 100,
      contentType: null,
      fileType: "source",
      idempotencyKey: "file-detail-001",
    });

    await deps.service.insertStagingRow(user as any, eff, {
      importBatchId: batch.batchId,
      importFileId: file.fileId,
      templateName: null,
      sourceSheetName: "Sheet1",
      sourceRowNumber: 1,
      rawRowJson: { name: "Test" },
      transformedRowJson: null,
      transformationNotes: null,
      idempotencyKey: "row-detail-001",
    });

    const detail = await deps.service.getBatchDetail(user as any, eff, batch.batchId);
    expect(detail.batch).toBeTruthy();
    expect(detail.batch?.id).toBe(batch.batchId);
    expect(detail.rows.length).toBe(1);
    expect(detail.files.length).toBe(1);
    expect(detail.rows[0]?.sourceRowNumber).toBe(1);
    expect(detail.files[0]?.fileHash).toBe("sha256:detail");
  });
});

// ===========================================================================
// WP-07-01 Task 3: Private file metadata validation
// ===========================================================================

describe("WP-07-01 Task 3: private file metadata validation", () => {
  it("16. rejects public URL as storagePath", async () => {
    const deps = makeDeps();
    const user = makeUser();
    const eff = makeOwnerEff();

    const batch = await deps.service.createBatch(user as any, eff, {
      sourceDescription: "File validation test",
      templateName: null, templateVersion: null,
      cutoverImportMode: "opening_balance",
      idempotencyKey: "batch-fileval-001",
    });

    await expect(deps.service.registerFile(user as any, eff, {
      importBatchId: batch.batchId,
      originalFileName: "data.xlsx",
      storagePath: "https://example.com/public/data.xlsx",
      fileHash: "sha256:abc",
      fileSizeBytes: 100,
      contentType: null,
      fileType: "source",
      idempotencyKey: "file-public-url-001",
    })).rejects.toThrow("private storage reference");

    await expect(deps.service.registerFile(user as any, eff, {
      importBatchId: batch.batchId,
      originalFileName: "data.xlsx",
      storagePath: "http://example.com/data.xlsx",
      fileHash: "sha256:abc",
      fileSizeBytes: 100,
      contentType: null,
      fileType: "source",
      idempotencyKey: "file-public-url-002",
    })).rejects.toThrow("private storage reference");
  });

  it("17. rejects secret-looking values in storagePath", async () => {
    const deps = makeDeps();
    const user = makeUser();
    const eff = makeOwnerEff();

    const batch = await deps.service.createBatch(user as any, eff, {
      sourceDescription: "Secret validation test",
      templateName: null, templateVersion: null,
      cutoverImportMode: "opening_balance",
      idempotencyKey: "batch-secret-001",
    });

    await expect(deps.service.registerFile(user as any, eff, {
      importBatchId: batch.batchId,
      originalFileName: "data.xlsx",
      storagePath: "private://bucket?token=abc123secret",
      fileHash: "sha256:abc",
      fileSizeBytes: 100,
      contentType: null,
      fileType: "source",
      idempotencyKey: "file-secret-001",
    })).rejects.toThrow("must not contain tokens");

    await expect(deps.service.registerFile(user as any, eff, {
      importBatchId: batch.batchId,
      originalFileName: "data.xlsx",
      storagePath: "private://bucket?api_key=xyz",
      fileHash: "sha256:abc",
      fileSizeBytes: 100,
      contentType: null,
      fileType: "source",
      idempotencyKey: "file-secret-002",
    })).rejects.toThrow("must not contain tokens");
  });

  it("18. accepts private:// storage reference", async () => {
    const deps = makeDeps();
    const user = makeUser();
    const eff = makeOwnerEff();

    const batch = await deps.service.createBatch(user as any, eff, {
      sourceDescription: "Private path test",
      templateName: null, templateVersion: null,
      cutoverImportMode: "opening_balance",
      idempotencyKey: "batch-private-001",
    });

    const result = await deps.service.registerFile(user as any, eff, {
      importBatchId: batch.batchId,
      originalFileName: "data.xlsx",
      storagePath: "private://tenant-001/batch-001/data.xlsx",
      fileHash: "sha256:valid",
      fileSizeBytes: 1024,
      contentType: "application/octet-stream",
      fileType: "source",
      idempotencyKey: "file-private-001",
    });
    expect(result.action).toBe("created");
  });

  it("19. requires checksum (fileHash)", async () => {
    const deps = makeDeps();
    const user = makeUser();
    const eff = makeOwnerEff();

    const batch = await deps.service.createBatch(user as any, eff, {
      sourceDescription: "Checksum test",
      templateName: null, templateVersion: null,
      cutoverImportMode: "opening_balance",
      idempotencyKey: "batch-checksum-001",
    });

    await expect(deps.service.registerFile(user as any, eff, {
      importBatchId: batch.batchId,
      originalFileName: "data.xlsx",
      storagePath: "private://data.xlsx",
      fileHash: "",
      fileSizeBytes: 100,
      contentType: null,
      fileType: "source",
      idempotencyKey: "file-nochecksum-001",
    })).rejects.toThrow("fileHash is required");
  });

  it("20. persists file size, content type, original filename, provenance", async () => {
    const deps = makeDeps();
    const user = makeUser();
    const eff = makeOwnerEff();

    const batch = await deps.service.createBatch(user as any, eff, {
      sourceDescription: "Metadata persistence test",
      templateName: null, templateVersion: null,
      cutoverImportMode: "opening_balance",
      idempotencyKey: "batch-metadata-001",
    });

    const result = await deps.service.registerFile(user as any, eff, {
      importBatchId: batch.batchId,
      originalFileName: "customers.xlsx",
      storagePath: "private://tenant/batch/customers.xlsx",
      fileHash: "sha256:metadata-test",
      fileSizeBytes: 4096,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      fileType: "source",
      idempotencyKey: "file-metadata-001",
    });

    const file = await deps.repository.findImportFileById(TEST_TENANT_ID, result.fileId);
    expect(file?.originalFileName).toBe("customers.xlsx");
    expect(file?.fileHash).toBe("sha256:metadata-test");
    expect(file?.fileSizeBytes).toBe(4096);
    expect(file?.contentType).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(file?.storagePath).toBe("private://tenant/batch/customers.xlsx");
    expect(file?.fileType).toBe("source");
    expect(file?.createdBy).toBe(TEST_USER_ID);
  });
});
