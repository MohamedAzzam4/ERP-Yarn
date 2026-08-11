/**
 * Historical Staging Repository — WP-07-01.
 *
 * Contract: docs/contracts/08_historical_migration_contract.md
 *   §6 Key Entities, §8.1 Staging Isolation.
 *
 * Repository interface for import_batches, import_files,
 * import_template_versions, and import_staging_rows tables.
 * These tables are non-operational — no stock/account/sales/payment effects.
 */
import "server-only";

import type {
  ImportBatch,
  ImportFile,
  ImportTemplateVersion,
  ImportStagingRow,
  ImportCutoverManifest,
} from "@/server/db/schema/migration";

// ---------------------------------------------------------------------------
// Input types.
// ---------------------------------------------------------------------------

export interface NewTemplateVersionInput {
  tenantId: string;
  templateName: string;
  templateVersion: string;
  schemaJson: Record<string, unknown>;
  createdBy: string;
}

export interface NewImportFileInput {
  tenantId: string;
  importBatchId: string;
  originalFileName: string;
  storagePath: string;
  fileHash: string;
  fileSizeBytes: number | null;
  contentType: string | null;
  fileType: string; // 'source' | 'normalized' | 'mapping' | 'report'
  createdBy: string;
}

export interface NewImportBatchInput {
  tenantId: string;
  batchNo: string;
  sourceDescription: string | null;
  templateName: string | null;
  templateVersion: string | null;
  cutoverImportMode: string;
  createdBy: string;
}

export interface NewStagingRowInput {
  tenantId: string;
  importBatchId: string;
  importFileId: string | null;
  templateName: string | null;
  sourceSheetName: string | null;
  sourceRowNumber: number | null;
  rawRowJson: Record<string, unknown> | null;
  transformedRowJson: Record<string, unknown> | null;
  transformationNotes: string | null;
  createdBy: string;
}

// WP-08-01F DEFECT 1A: Cutover manifest input
export interface NewCutoverManifestInput {
  tenantId: string;
  importBatchId: string;
  domain: string;
  importMode: string;
  cutoffDate: string | null;
  sourceCoverage: string | null;
  openingBalanceBasis: string | null;
  liveSystemStartBoundary: string | null;
  manifestHash: string;
  isApproved: boolean;
  createdBy: string;
}

// ---------------------------------------------------------------------------
// Repository interface.
// ---------------------------------------------------------------------------

export interface HistoricalStagingRepository {
  // Template version methods
  insertTemplateVersion(row: NewTemplateVersionInput): Promise<ImportTemplateVersion>;
  findTemplateVersion(tenantId: string, templateName: string, templateVersion: string): Promise<ImportTemplateVersion | null>;
  findActiveTemplateVersions(tenantId: string, templateName?: string): Promise<ImportTemplateVersion[]>;
  findTemplateVersionById(tenantId: string, id: string): Promise<ImportTemplateVersion | null>;

  // Import file methods
  insertImportFile(row: NewImportFileInput): Promise<ImportFile>;
  findImportFileByHash(tenantId: string, importBatchId: string, fileHash: string, fileType: string): Promise<ImportFile | null>;
  findImportFilesForBatch(tenantId: string, importBatchId: string): Promise<ImportFile[]>;
  findImportFileById(tenantId: string, id: string): Promise<ImportFile | null>;
  updateFileSuperseded(tenantId: string, fileId: string, supersededById: string): Promise<ImportFile | null>;

  // Import batch methods
  insertImportBatch(row: NewImportBatchInput): Promise<ImportBatch>;
  findImportBatchById(tenantId: string, id: string): Promise<ImportBatch | null>;
  findImportBatchByNo(tenantId: string, batchNo: string): Promise<ImportBatch | null>;
  listImportBatches(tenantId: string): Promise<ImportBatch[]>;
  updateBatchStatus(tenantId: string, batchId: string, status: string): Promise<ImportBatch | null>;
  updateBatchStagedRowCount(tenantId: string, batchId: string, count: number): Promise<ImportBatch | null>;
  /**
   * WP-08-01F DEFECT 1A: Update the staged-data hash on a batch.
   * Used by finalizeStaging to lock the staged-data snapshot.
   */
  updateBatchStagedDataHash(tenantId: string, batchId: string, stagedDataHash: string, updatedBy: string): Promise<ImportBatch | null>;
  /**
   * WP-08-01F DEFECT 1A: Update the cutover-manifest hash on a batch.
   * Used by finalizeCutoverManifest to bind the manifest hash to the batch.
   */
  updateBatchCutoverManifestHash(tenantId: string, batchId: string, cutoverManifestHash: string, updatedBy: string): Promise<ImportBatch | null>;
  /**
   * WP-08-01F DEFECT 1A: Update the validation status on a batch.
   * Used by runValidation to set validationStatus = "passed" or "failed".
   */
  updateBatchValidationStatus(tenantId: string, batchId: string, validationStatus: string, updatedBy: string): Promise<ImportBatch | null>;
  /**
   * WP-08-01F DEFECT 1A: Update the reconciliation status on a batch.
   * Used by runReconciliation to set reconciliationStatus = "matched" etc.
   */
  updateBatchReconciliationStatus(tenantId: string, batchId: string, reconciliationStatus: string, updatedBy: string): Promise<ImportBatch | null>;

  // Staging row methods
  insertStagingRow(row: NewStagingRowInput): Promise<ImportStagingRow>;
  findStagingRowsForBatch(tenantId: string, importBatchId: string): Promise<ImportStagingRow[]>;
  findStagingRowById(tenantId: string, id: string): Promise<ImportStagingRow | null>;

  // WP-08-01F DEFECT 1A: Cutover manifest methods
  insertCutoverManifest(row: NewCutoverManifestInput): Promise<ImportCutoverManifest>;
  findCutoverManifestsForBatch(tenantId: string, importBatchId: string): Promise<ImportCutoverManifest[]>;
  findCutoverManifestById(tenantId: string, id: string): Promise<ImportCutoverManifest | null>;
}

export type {
  ImportBatch,
  ImportFile,
  ImportTemplateVersion,
  ImportStagingRow,
  ImportCutoverManifest,
} from "@/server/db/schema/migration";
