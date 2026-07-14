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

  // Staging row methods
  insertStagingRow(row: NewStagingRowInput): Promise<ImportStagingRow>;
  findStagingRowsForBatch(tenantId: string, importBatchId: string): Promise<ImportStagingRow[]>;
  findStagingRowById(tenantId: string, id: string): Promise<ImportStagingRow | null>;
}

export type {
  ImportBatch,
  ImportFile,
  ImportTemplateVersion,
  ImportStagingRow,
} from "@/server/db/schema/migration";
