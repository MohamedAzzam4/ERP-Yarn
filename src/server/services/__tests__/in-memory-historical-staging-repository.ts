/**
 * In-memory HistoricalStagingRepository — WP-07-01 tests.
 *
 * TEST-ONLY. Non-persistent in-memory store for unit tests.
 */
import { randomUUID } from "node:crypto";
import type {
  HistoricalStagingRepository,
  NewTemplateVersionInput,
  NewImportFileInput,
  NewImportBatchInput,
  NewStagingRowInput,
  NewCutoverManifestInput,
} from "../historical-staging-repository";
import type {
  ImportBatch,
  ImportFile,
  ImportTemplateVersion,
  ImportStagingRow,
  ImportCutoverManifest,
} from "@/server/db/schema/migration";

const NOW = () => new Date();

function nid(prefix: string, counter: number): string {
  return `${prefix}-${String(counter).padStart(6, "0")}-${randomUUID().slice(0, 8)}`;
}

export class InMemoryHistoricalStagingRepository implements HistoricalStagingRepository {
  private templates = new Map<string, ImportTemplateVersion>();
  private files = new Map<string, ImportFile>();
  private batches = new Map<string, ImportBatch>();
  private stagingRows = new Map<string, ImportStagingRow>();
  private cutoverManifests = new Map<string, ImportCutoverManifest>();
  private templateCounter = 0;
  private fileCounter = 0;
  private batchCounter = 0;
  private rowCounter = 0;

  // Test helper: seed a batch directly
  seedBatch(tenantId: string, batch: ImportBatch): void {
    this.batches.set(`${tenantId}:${batch.id}`, batch);
  }

  // --- Template version methods ---

  async insertTemplateVersion(row: NewTemplateVersionInput): Promise<ImportTemplateVersion> {
    this.templateCounter++;
    const id = nid("tmpl", this.templateCounter);
    const template: ImportTemplateVersion = {
      id,
      tenantId: row.tenantId,
      templateName: row.templateName,
      templateVersion: row.templateVersion,
      schemaJson: row.schemaJson,
      isActive: true,
      createdBy: row.createdBy,
      createdAt: NOW(),
      updatedBy: null,
      updatedAt: null,
    };
    this.templates.set(`${row.tenantId}:${id}`, template);
    return template;
  }

  async findTemplateVersion(tenantId: string, templateName: string, templateVersion: string): Promise<ImportTemplateVersion | null> {
    for (const t of this.templates.values()) {
      if (t.tenantId === tenantId && t.templateName === templateName && t.templateVersion === templateVersion) {
        return t;
      }
    }
    return null;
  }

  async findActiveTemplateVersions(tenantId: string, templateName?: string): Promise<ImportTemplateVersion[]> {
    return [...this.templates.values()].filter(
      (t) => t.tenantId === tenantId && t.isActive && (!templateName || t.templateName === templateName),
    );
  }

  async findTemplateVersionById(tenantId: string, id: string): Promise<ImportTemplateVersion | null> {
    return this.templates.get(`${tenantId}:${id}`) ?? null;
  }

  // --- Import file methods ---

  async insertImportFile(row: NewImportFileInput): Promise<ImportFile> {
    this.fileCounter++;
    const id = nid("file", this.fileCounter);
    const file: ImportFile = {
      id,
      tenantId: row.tenantId,
      importBatchId: row.importBatchId,
      originalFileName: row.originalFileName,
      storagePath: row.storagePath,
      fileHash: row.fileHash,
      fileSizeBytes: row.fileSizeBytes,
      contentType: row.contentType,
      fileType: row.fileType,
      supersededById: null,
      // WP-08-01F R1 — new files start as current version 1.
      fileVersion: 1,
      isCurrent: true,
      supersededAt: null,
      supersededBy: null,
      supersededReason: null,
      createdBy: row.createdBy,
      createdAt: NOW(),
      updatedBy: null,
      updatedAt: null,
    } as ImportFile;
    this.files.set(`${row.tenantId}:${id}`, file);
    return file;
  }

  async findImportFileByHash(tenantId: string, importBatchId: string, fileHash: string, fileType: string): Promise<ImportFile | null> {
    for (const f of this.files.values()) {
      if (f.tenantId === tenantId && f.importBatchId === importBatchId && f.fileHash === fileHash && f.fileType === fileType) {
        return f;
      }
    }
    return null;
  }

  async findImportFilesForBatch(tenantId: string, importBatchId: string): Promise<ImportFile[]> {
    return [...this.files.values()].filter(
      (f) => f.tenantId === tenantId && f.importBatchId === importBatchId,
    );
  }

  async findImportFileById(tenantId: string, id: string): Promise<ImportFile | null> {
    return this.files.get(`${tenantId}:${id}`) ?? null;
  }

  async updateFileSuperseded(tenantId: string, fileId: string, supersededById: string): Promise<ImportFile | null> {
    const key = `${tenantId}:${fileId}`;
    const file = this.files.get(key);
    if (!file) return null;
    // WP-08-01F R2: update BOTH superseded_by_id and superseded_by.
    const updated = { ...file, supersededById, supersededBy: supersededById, updatedAt: NOW() } as ImportFile;
    this.files.set(key, updated);
    return updated;
  }

  // WP-08-01F R1 — Replacement-supporting methods (in-memory implementations).

  async findCurrentImportFileForBatch(tenantId: string, importBatchId: string, fileType: string): Promise<ImportFile | null> {
    for (const f of this.files.values()) {
      if (
        f.tenantId === tenantId &&
        f.importBatchId === importBatchId &&
        f.fileType === fileType &&
        (f as any).isCurrent !== false
      ) {
        return f;
      }
    }
    return null;
  }

  async markFileSuperseded(
    tenantId: string,
    fileId: string,
    supersededByFileId: string,
    reason: string,
    now: Date,
  ): Promise<ImportFile | null> {
    const key = `${tenantId}:${fileId}`;
    const file = this.files.get(key);
    if (!file) return null;
    if ((file as any).isCurrent === false) return null;
    const updated: ImportFile = {
      ...file,
      isCurrent: false,
      supersededAt: now,
      supersededBy: supersededByFileId,
      supersededById: supersededByFileId,
      supersededReason: reason,
      updatedAt: now,
    } as ImportFile;
    this.files.set(key, updated);
    return updated;
  }

  async markStagingRowsSupersededForFile(
    tenantId: string,
    importFileId: string,
    supersededByFileId: string,
    now: Date,
  ): Promise<number> {
    let count = 0;
    for (const [key, row] of this.stagingRows.entries()) {
      if (
        row.tenantId === tenantId &&
        row.importFileId === importFileId &&
        (row as any).isCurrent !== false
      ) {
        const updated = {
          ...row,
          isCurrent: false,
          supersededAt: now,
          supersededByFileId,
          updatedAt: now,
        } as ImportStagingRow;
        this.stagingRows.set(key, updated);
        count++;
      }
    }
    return count;
  }

  async markValidationFindingsSupersededForBatch(
    tenantId: string,
    importBatchId: string,
    now: Date,
  ): Promise<number> {
    // In-memory repo doesn't track validation errors — return 0.
    // (Production uses HistoricalValidationDbRepository which has its own table.)
    void tenantId; void importBatchId; void now;
    return 0;
  }

  // --- Import batch methods ---

  async insertImportBatch(row: NewImportBatchInput): Promise<ImportBatch> {
    this.batchCounter++;
    const id = nid("batch", this.batchCounter);
    const batch: ImportBatch = {
      id,
      tenantId: row.tenantId,
      batchNo: row.batchNo,
      status: "draft",
      sourceDescription: row.sourceDescription,
      templateName: row.templateName,
      templateVersion: row.templateVersion,
      mappingVersion: null,
      cutoverManifestHash: null,
      cutoverImportMode: row.cutoverImportMode as any,
      stagedDataHash: null,
      stagedRowCount: 0,
      blockingErrorCount: 0,
      warningCount: 0,
      acceptedWarningCount: 0,
      validationStatus: null,
      reconciliationStatus: null,
      warningSummary: null,
      committedAt: null,
      commitEffectCounts: null,
      createdBy: row.createdBy,
      createdAt: NOW(),
      updatedBy: null,
      updatedAt: null,
    };
    this.batches.set(`${row.tenantId}:${id}`, batch);
    return batch;
  }

  async findImportBatchById(tenantId: string, id: string): Promise<ImportBatch | null> {
    return this.batches.get(`${tenantId}:${id}`) ?? null;
  }

  async findImportBatchByNo(tenantId: string, batchNo: string): Promise<ImportBatch | null> {
    for (const b of this.batches.values()) {
      if (b.tenantId === tenantId && b.batchNo === batchNo) {
        return b;
      }
    }
    return null;
  }

  async listImportBatches(tenantId: string): Promise<ImportBatch[]> {
    return [...this.batches.values()].filter((b) => b.tenantId === tenantId);
  }

  async updateBatchStatus(tenantId: string, batchId: string, status: string): Promise<ImportBatch | null> {
    const key = `${tenantId}:${batchId}`;
    const batch = this.batches.get(key);
    if (!batch) return null;
    const updated = { ...batch, status: status as any, updatedAt: NOW() };
    this.batches.set(key, updated);
    return updated;
  }

  async updateBatchStagedRowCount(tenantId: string, batchId: string, count: number): Promise<ImportBatch | null> {
    const key = `${tenantId}:${batchId}`;
    const batch = this.batches.get(key);
    if (!batch) return null;
    const updated = { ...batch, stagedRowCount: count, updatedAt: NOW() };
    this.batches.set(key, updated);
    return updated;
  }

  // WP-08-01F DEFECT 1A: lifecycle transition support methods

  async updateBatchStagedDataHash(tenantId: string, batchId: string, stagedDataHash: string, updatedBy: string): Promise<ImportBatch | null> {
    const key = `${tenantId}:${batchId}`;
    const batch = this.batches.get(key);
    if (!batch) return null;
    const updated = { ...batch, stagedDataHash, updatedBy, updatedAt: NOW() };
    this.batches.set(key, updated);
    return updated;
  }

  async updateBatchCutoverManifestHash(tenantId: string, batchId: string, cutoverManifestHash: string, updatedBy: string): Promise<ImportBatch | null> {
    const key = `${tenantId}:${batchId}`;
    const batch = this.batches.get(key);
    if (!batch) return null;
    const updated = { ...batch, cutoverManifestHash, updatedBy, updatedAt: NOW() };
    this.batches.set(key, updated);
    return updated;
  }

  async updateBatchValidationStatus(tenantId: string, batchId: string, validationStatus: string, updatedBy: string): Promise<ImportBatch | null> {
    const key = `${tenantId}:${batchId}`;
    const batch = this.batches.get(key);
    if (!batch) return null;
    const updated = { ...batch, validationStatus, updatedBy, updatedAt: NOW() };
    this.batches.set(key, updated);
    return updated;
  }

  async updateBatchReconciliationStatus(tenantId: string, batchId: string, reconciliationStatus: string, updatedBy: string): Promise<ImportBatch | null> {
    const key = `${tenantId}:${batchId}`;
    const batch = this.batches.get(key);
    if (!batch) return null;
    const updated = { ...batch, reconciliationStatus, updatedBy, updatedAt: NOW() };
    this.batches.set(key, updated);
    return updated;
  }

  // --- Staging row methods ---

  async insertStagingRow(row: NewStagingRowInput): Promise<ImportStagingRow> {
    this.rowCounter++;
    const id = nid("row", this.rowCounter);
    const stagingRow: ImportStagingRow = {
      id,
      tenantId: row.tenantId,
      importBatchId: row.importBatchId,
      importFileId: row.importFileId,
      templateName: row.templateName,
      sourceSheetName: row.sourceSheetName,
      sourceRowNumber: row.sourceRowNumber,
      rawRowJson: row.rawRowJson,
      transformedRowJson: row.transformedRowJson,
      validationStatus: "pending",
      reviewStatus: "not_required",
      aiConfidence: null,
      transformationNotes: row.transformationNotes,
      committedEntityType: null,
      committedEntityId: null,
      // WP-08-01F R1 — new staging rows start as current version 1.
      stagingVersion: 1,
      isCurrent: true,
      supersededAt: null,
      supersededByFileId: null,
      createdBy: row.createdBy,
      createdAt: NOW(),
      updatedBy: null,
      updatedAt: null,
    } as ImportStagingRow;
    this.stagingRows.set(`${row.tenantId}:${id}`, stagingRow);
    return stagingRow;
  }

  async findStagingRowsForBatch(tenantId: string, importBatchId: string): Promise<ImportStagingRow[]> {
    return [...this.stagingRows.values()].filter(
      (r) => r.tenantId === tenantId && r.importBatchId === importBatchId,
    );
  }

  async findStagingRowById(tenantId: string, id: string): Promise<ImportStagingRow | null> {
    return this.stagingRows.get(`${tenantId}:${id}`) ?? null;
  }

  // WP-08-01F DEFECT 1A: Cutover manifest methods (in-memory)

  async insertCutoverManifest(row: NewCutoverManifestInput): Promise<ImportCutoverManifest> {
    const id = `cm-${randomUUID().slice(0, 8)}`;
    const manifest: ImportCutoverManifest = {
      id,
      tenantId: row.tenantId,
      importBatchId: row.importBatchId,
      domain: row.domain,
      importMode: row.importMode as any,
      cutoffDate: row.cutoffDate,
      sourceCoverage: row.sourceCoverage,
      openingBalanceBasis: row.openingBalanceBasis,
      liveSystemStartBoundary: row.liveSystemStartBoundary,
      reconciliationOwner: null,
      manifestHash: row.manifestHash,
      isApproved: row.isApproved,
      manifestVersion: 1,
      isCurrent: true,
      supersededAt: null,
      supersededBy: null,
      createdBy: row.createdBy,
      createdAt: NOW(),
      updatedBy: null,
      updatedAt: null,
    };
    this.cutoverManifests.set(`${row.tenantId}:${id}`, manifest);
    return manifest;
  }

  async findCutoverManifestsForBatch(tenantId: string, importBatchId: string): Promise<ImportCutoverManifest[]> {
    return [...this.cutoverManifests.values()].filter(
      m => m.tenantId === tenantId && m.importBatchId === importBatchId,
    );
  }

  async findCutoverManifestById(tenantId: string, id: string): Promise<ImportCutoverManifest | null> {
    return this.cutoverManifests.get(`${tenantId}:${id}`) ?? null;
  }

  async markCutoverManifestsSupersededForBatch(
    tenantId: string,
    importBatchId: string,
    supersededBy: string | null,
    now: Date,
  ): Promise<number> {
    let count = 0;
    for (const [key, m] of this.cutoverManifests.entries()) {
      if (m.tenantId === tenantId && m.importBatchId === importBatchId && (m as any).isCurrent !== false) {
        const updated = {
          ...m,
          isCurrent: false,
          supersededAt: now,
          supersededBy: supersededBy as any,
          updatedAt: now,
        } as ImportCutoverManifest;
        this.cutoverManifests.set(key, updated);
        count++;
      }
    }
    return count;
  }
}
