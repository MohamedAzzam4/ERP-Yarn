/**
 * Drizzle-backed HistoricalStagingRepository — WP-07-01.
 *
 * Production DB repository for import_batches, import_files,
 * import_template_versions, and import_staging_rows tables.
 *
 * Contract 08 §8.1: Staging is non-operational — no stock/account/sales effects.
 */
import "server-only";
import { and, eq, isNull, sql as drizzleSql } from "drizzle-orm";
import {
  importBatches,
  importFiles,
  importTemplateVersions,
  importStagingRows,
  importCutoverManifests,
  importValidationErrors,
} from "@/server/db/schema";
import type { db as DbType } from "@/server/db/client";
import type {
  HistoricalStagingRepository,
  NewTemplateVersionInput,
  NewImportFileInput,
  NewImportBatchInput,
  NewStagingRowInput,
  NewCutoverManifestInput,
} from "./historical-staging-repository";
import type {
  ImportBatch,
  ImportFile,
  ImportTemplateVersion,
  ImportStagingRow,
  ImportCutoverManifest,
} from "@/server/db/schema/migration";

type Db = NonNullable<typeof DbType>;
/**
 * WP-08-01F R1 — The repository accepts either the root Db or a Drizzle
 * transaction. This lets the replacement service run all writes inside ONE
 * PostgreSQL transaction with tx-scoped idempotency/audit/sequence.
 */
type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export class HistoricalStagingDbRepository implements HistoricalStagingRepository {
  constructor(private readonly db: DbOrTx) {}

  // --- Template version methods ---

  async insertTemplateVersion(row: NewTemplateVersionInput): Promise<ImportTemplateVersion> {
    const [result] = await this.db.insert(importTemplateVersions).values({
      tenantId: row.tenantId,
      templateName: row.templateName,
      templateVersion: row.templateVersion,
      schemaJson: row.schemaJson,
      isActive: true,
      createdBy: row.createdBy,
    }).returning();
    return result!;
  }

  async findTemplateVersion(tenantId: string, templateName: string, templateVersion: string): Promise<ImportTemplateVersion | null> {
    const [result] = await this.db.select().from(importTemplateVersions)
      .where(and(
        eq(importTemplateVersions.tenantId, tenantId),
        eq(importTemplateVersions.templateName, templateName),
        eq(importTemplateVersions.templateVersion, templateVersion),
      ))
      .limit(1);
    return result ?? null;
  }

  async findActiveTemplateVersions(tenantId: string, templateName?: string): Promise<ImportTemplateVersion[]> {
    const conditions = [
      eq(importTemplateVersions.tenantId, tenantId),
      eq(importTemplateVersions.isActive, true),
    ];
    if (templateName) {
      conditions.push(eq(importTemplateVersions.templateName, templateName));
    }
    return this.db.select().from(importTemplateVersions)
      .where(and(...conditions));
  }

  async findTemplateVersionById(tenantId: string, id: string): Promise<ImportTemplateVersion | null> {
    const [result] = await this.db.select().from(importTemplateVersions)
      .where(and(
        eq(importTemplateVersions.tenantId, tenantId),
        eq(importTemplateVersions.id, id),
      ))
      .limit(1);
    return result ?? null;
  }

  // --- Import file methods ---

  async insertImportFile(row: NewImportFileInput): Promise<ImportFile> {
    const [result] = await this.db.insert(importFiles).values({
      tenantId: row.tenantId,
      importBatchId: row.importBatchId,
      originalFileName: row.originalFileName,
      storagePath: row.storagePath,
      fileHash: row.fileHash,
      fileSizeBytes: row.fileSizeBytes,
      contentType: row.contentType,
      fileType: row.fileType,
      createdBy: row.createdBy,
    }).returning();
    return result!;
  }

  async findImportFileByHash(tenantId: string, importBatchId: string, fileHash: string, fileType: string): Promise<ImportFile | null> {
    const [result] = await this.db.select().from(importFiles)
      .where(and(
        eq(importFiles.tenantId, tenantId),
        eq(importFiles.importBatchId, importBatchId),
        eq(importFiles.fileHash, fileHash),
        eq(importFiles.fileType, fileType),
      ))
      .limit(1);
    return result ?? null;
  }

  async findImportFilesForBatch(tenantId: string, importBatchId: string): Promise<ImportFile[]> {
    return this.db.select().from(importFiles)
      .where(and(
        eq(importFiles.tenantId, tenantId),
        eq(importFiles.importBatchId, importBatchId),
      ));
  }

  async findImportFileById(tenantId: string, id: string): Promise<ImportFile | null> {
    const [result] = await this.db.select().from(importFiles)
      .where(and(
        eq(importFiles.tenantId, tenantId),
        eq(importFiles.id, id),
      ))
      .limit(1);
    return result ?? null;
  }

  async updateFileSuperseded(tenantId: string, fileId: string, supersededById: string): Promise<ImportFile | null> {
    const [result] = await this.db.update(importFiles)
      .set({ supersededById, updatedAt: new Date() })
      .where(and(
        eq(importFiles.tenantId, tenantId),
        eq(importFiles.id, fileId),
      ))
      .returning();
    return result ?? null;
  }

  // WP-08-01F R1 — Replacement-supporting repository methods.

  async findCurrentImportFileForBatch(tenantId: string, importBatchId: string, fileType: string): Promise<ImportFile | null> {
    const [result] = await this.db.select().from(importFiles)
      .where(and(
        eq(importFiles.tenantId, tenantId),
        eq(importFiles.importBatchId, importBatchId),
        eq(importFiles.fileType, fileType),
        eq(importFiles.isCurrent, true),
      ))
      .limit(1);
    return result ?? null;
  }

  async markFileSuperseded(
    tenantId: string,
    fileId: string,
    supersededByFileId: string,
    reason: string,
    now: Date,
  ): Promise<ImportFile | null> {
    const [result] = await this.db.update(importFiles)
      .set({
        isCurrent: false,
        supersededAt: now,
        supersededBy: supersededByFileId,
        supersededById: supersededByFileId,
        supersededReason: reason,
        updatedAt: now,
      })
      .where(and(
        eq(importFiles.tenantId, tenantId),
        eq(importFiles.id, fileId),
        // Only update if currently current — defends against double-supersession.
        eq(importFiles.isCurrent, true),
      ))
      .returning();
    return result ?? null;
  }

  async markStagingRowsSupersededForFile(
    tenantId: string,
    importFileId: string,
    supersededByFileId: string,
    now: Date,
  ): Promise<number> {
    const result = await this.db.update(importStagingRows)
      .set({
        isCurrent: false,
        supersededAt: now,
        supersededByFileId,
        updatedAt: now,
      })
      .where(and(
        eq(importStagingRows.tenantId, tenantId),
        eq(importStagingRows.importFileId, importFileId),
        eq(importStagingRows.isCurrent, true),
      ))
      .returning();
    return result.length;
  }

  async markValidationFindingsSupersededForBatch(
    tenantId: string,
    importBatchId: string,
    now: Date,
  ): Promise<number> {
    const result = await this.db.update(importValidationErrors)
      .set({
        isCurrent: false,
        supersededAt: now,
      })
      .where(and(
        eq(importValidationErrors.tenantId, tenantId),
        eq(importValidationErrors.importBatchId, importBatchId),
        eq(importValidationErrors.isCurrent, true),
      ))
      .returning();
    return result.length;
  }

  // --- Import batch methods ---

  async insertImportBatch(row: NewImportBatchInput): Promise<ImportBatch> {
    const [result] = await this.db.insert(importBatches).values({
      tenantId: row.tenantId,
      batchNo: row.batchNo,
      status: "draft",
      sourceDescription: row.sourceDescription,
      templateName: row.templateName,
      templateVersion: row.templateVersion,
      cutoverImportMode: row.cutoverImportMode as any,
      stagedRowCount: 0,
      blockingErrorCount: 0,
      warningCount: 0,
      acceptedWarningCount: 0,
      createdBy: row.createdBy,
    }).returning();
    return result!;
  }

  async findImportBatchById(tenantId: string, id: string): Promise<ImportBatch | null> {
    const [result] = await this.db.select().from(importBatches)
      .where(and(
        eq(importBatches.tenantId, tenantId),
        eq(importBatches.id, id),
      ))
      .limit(1);
    return result ?? null;
  }

  async findImportBatchByNo(tenantId: string, batchNo: string): Promise<ImportBatch | null> {
    const [result] = await this.db.select().from(importBatches)
      .where(and(
        eq(importBatches.tenantId, tenantId),
        eq(importBatches.batchNo, batchNo),
      ))
      .limit(1);
    return result ?? null;
  }

  async listImportBatches(tenantId: string): Promise<ImportBatch[]> {
    return this.db.select().from(importBatches)
      .where(eq(importBatches.tenantId, tenantId));
  }

  async updateBatchStatus(tenantId: string, batchId: string, status: string): Promise<ImportBatch | null> {
    const [result] = await this.db.update(importBatches)
      .set({ status: status as any, updatedAt: new Date() })
      .where(and(
        eq(importBatches.tenantId, tenantId),
        eq(importBatches.id, batchId),
      ))
      .returning();
    return result ?? null;
  }

  async updateBatchStagedRowCount(tenantId: string, batchId: string, count: number): Promise<ImportBatch | null> {
    const [result] = await this.db.update(importBatches)
      .set({ stagedRowCount: count, updatedAt: new Date() })
      .where(and(
        eq(importBatches.tenantId, tenantId),
        eq(importBatches.id, batchId),
      ))
      .returning();
    return result ?? null;
  }

  // WP-08-01F DEFECT 1A: lifecycle transition support methods

  async updateBatchStagedDataHash(tenantId: string, batchId: string, stagedDataHash: string, updatedBy: string): Promise<ImportBatch | null> {
    const [result] = await this.db.update(importBatches)
      .set({ stagedDataHash, updatedBy, updatedAt: new Date() })
      .where(and(eq(importBatches.tenantId, tenantId), eq(importBatches.id, batchId)))
      .returning();
    return result ?? null;
  }

  async updateBatchCutoverManifestHash(tenantId: string, batchId: string, cutoverManifestHash: string, updatedBy: string): Promise<ImportBatch | null> {
    const [result] = await this.db.update(importBatches)
      .set({ cutoverManifestHash, updatedBy, updatedAt: new Date() })
      .where(and(eq(importBatches.tenantId, tenantId), eq(importBatches.id, batchId)))
      .returning();
    return result ?? null;
  }

  async updateBatchValidationStatus(tenantId: string, batchId: string, validationStatus: string, updatedBy: string): Promise<ImportBatch | null> {
    const [result] = await this.db.update(importBatches)
      .set({ validationStatus, updatedBy, updatedAt: new Date() })
      .where(and(eq(importBatches.tenantId, tenantId), eq(importBatches.id, batchId)))
      .returning();
    return result ?? null;
  }

  async updateBatchReconciliationStatus(tenantId: string, batchId: string, reconciliationStatus: string, updatedBy: string): Promise<ImportBatch | null> {
    const [result] = await this.db.update(importBatches)
      .set({ reconciliationStatus, updatedBy, updatedAt: new Date() })
      .where(and(eq(importBatches.tenantId, tenantId), eq(importBatches.id, batchId)))
      .returning();
    return result ?? null;
  }

  // --- Staging row methods ---

  async insertStagingRow(row: NewStagingRowInput): Promise<ImportStagingRow> {
    const [result] = await this.db.insert(importStagingRows).values({
      tenantId: row.tenantId,
      importBatchId: row.importBatchId,
      importFileId: row.importFileId,
      templateName: row.templateName,
      sourceSheetName: row.sourceSheetName,
      sourceRowNumber: row.sourceRowNumber,
      rawRowJson: row.rawRowJson,
      transformedRowJson: row.transformedRowJson,
      transformationNotes: row.transformationNotes,
      validationStatus: "pending",
      reviewStatus: "not_required",
      createdBy: row.createdBy,
    }).returning();
    return result!;
  }

  async findStagingRowsForBatch(tenantId: string, importBatchId: string): Promise<ImportStagingRow[]> {
    return this.db.select().from(importStagingRows)
      .where(and(
        eq(importStagingRows.tenantId, tenantId),
        eq(importStagingRows.importBatchId, importBatchId),
      ));
  }

  async findStagingRowById(tenantId: string, id: string): Promise<ImportStagingRow | null> {
    const [result] = await this.db.select().from(importStagingRows)
      .where(and(
        eq(importStagingRows.tenantId, tenantId),
        eq(importStagingRows.id, id),
      ))
      .limit(1);
    return result ?? null;
  }

  // WP-08-01F DEFECT 1A: Cutover manifest methods

  async insertCutoverManifest(row: NewCutoverManifestInput): Promise<ImportCutoverManifest> {
    const [result] = await this.db.insert(importCutoverManifests).values({
      tenantId: row.tenantId,
      importBatchId: row.importBatchId,
      domain: row.domain,
      importMode: row.importMode as any,
      cutoffDate: row.cutoffDate,
      sourceCoverage: row.sourceCoverage,
      openingBalanceBasis: row.openingBalanceBasis,
      liveSystemStartBoundary: row.liveSystemStartBoundary,
      manifestHash: row.manifestHash,
      isApproved: row.isApproved,
      createdBy: row.createdBy,
    }).returning();
    return result!;
  }

  async findCutoverManifestsForBatch(tenantId: string, importBatchId: string): Promise<ImportCutoverManifest[]> {
    return this.db.select().from(importCutoverManifests)
      .where(and(
        eq(importCutoverManifests.tenantId, tenantId),
        eq(importCutoverManifests.importBatchId, importBatchId),
      ));
  }

  async findCutoverManifestById(tenantId: string, id: string): Promise<ImportCutoverManifest | null> {
    const [result] = await this.db.select().from(importCutoverManifests)
      .where(and(
        eq(importCutoverManifests.tenantId, tenantId),
        eq(importCutoverManifests.id, id),
      ))
      .limit(1);
    return result ?? null;
  }
}

export function createHistoricalStagingDbRepository(db: Db): HistoricalStagingDbRepository {
  return new HistoricalStagingDbRepository(db);
}
