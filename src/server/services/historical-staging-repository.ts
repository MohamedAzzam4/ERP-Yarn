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

// WP-08-01F R1 — Replacement input. The replacement file is registered as a
// NEW immutable file row; the previous current file is marked superseded.
// Staging rows linked to the previous file are marked is_current=false
// (NOT deleted) and new staging rows are inserted for the new file.
export interface ReplaceMigrationFileInput {
  tenantId: string;
  importBatchId: string;
  /** ID of the current file being superseded. */
  replaceFileId: string;
  /** New file metadata (from private storage). */
  originalFileName: string;
  storagePath: string;
  fileHash: string;
  fileSizeBytes: number | null;
  contentType: string | null;
  fileType: string;
  /** Parsed replacement rows to insert as new staging rows. */
  parsedRows: Array<{
    rowNumber: number;
    columns: Record<string, string>;
  }>;
  templateType: string;
  /** Mandatory rework reason — recorded in audit + supersession fields. */
  reworkReason: string;
  idempotencyKey: string;
  createdBy: string;
}

export interface ReplaceMigrationFileResult {
  action: "created" | "replayed";
  newFileId: string;
  oldFileId: string;
  importBatchId: string;
  newFileHash: string;
  newStagingRowCount: number;
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
  /**
   * WP-08-01F R1 — Find the current (non-superseded) file of a given type
   * for a batch. Returns null if no current file exists for that type.
   */
  findCurrentImportFileForBatch(tenantId: string, importBatchId: string, fileType: string): Promise<ImportFile | null>;
  /**
   * WP-08-01F R1 — Mark a file as superseded by a new file. Sets
   * is_current=false, superseded_at=now, superseded_by=newFileId,
   * superseded_by_id=newFileId, superseded_reason=reason. Does NOT delete
   * the file row or its storage object — immutable preservation.
   */
  markFileSuperseded(
    tenantId: string,
    fileId: string,
    supersededByFileId: string,
    reason: string,
    now: Date,
  ): Promise<ImportFile | null>;
  /**
   * WP-08-01F R1 — Mark all staging rows linked to a file as superseded.
   * Sets is_current=false, superseded_at=now, superseded_by_file_id=newFileId.
   * Does NOT delete the staging rows — immutable preservation.
   */
  markStagingRowsSupersededForFile(
    tenantId: string,
    importFileId: string,
    supersededByFileId: string,
    now: Date,
  ): Promise<number>;
  /**
   * WP-08-01F R1 — Mark all current validation findings for a batch as
   * superseded. Sets is_current=false, superseded_at=now. Does NOT delete
   * the findings — immutable preservation.
   */
  markValidationFindingsSupersededForBatch(
    tenantId: string,
    importBatchId: string,
    now: Date,
  ): Promise<number>;

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
