/**
 * Historical Validation Repository — WP-07-02.
 *
 * Contract: docs/contracts/08_historical_migration_contract.md
 *   §8.5 Validation Severity, §8.6 Required Validation Rules,
 *   §8.4 Master Data Extraction and Alias Mapping.
 *
 * Repository interface for import_validation_errors, import_alias_mappings,
 * and import_human_review_items tables.
 * These are non-operational — no stock/account/sales effects.
 */
import "server-only";

import type {
  ImportValidationError,
  ImportAliasMapping,
  ImportHumanReviewItem,
  ImportStagingRow,
  ImportBatch,
} from "@/server/db/schema/migration";

// ---------------------------------------------------------------------------
// Input types.
// ---------------------------------------------------------------------------

export interface NewValidationErrorInput {
  tenantId: string;
  importBatchId: string;
  stagingRowId: string | null;
  severity: string; // 'blocking_error' | 'review_required_warning' | 'informational'
  errorCode: string;
  message: string;
  fieldName: string | null;
  isBlocking: boolean;
  createdBy: string;
}

export interface NewAliasMappingInput {
  tenantId: string;
  importBatchId: string;
  entityType: string; // 'supplier' | 'customer' | 'factory' | 'location' | 'item' | 'batch' | 'lot'
  sourceLabel: string;
  normalizedName: string;
  targetMasterId: string | null;
  mappingVersion: string | null;
  confidenceScore: string | null;
  status: string; // 'candidate' | 'needs_review' | 'approved' | 'rejected'
  notes: string | null;
  createdBy: string;
}

export interface NewHumanReviewItemInput {
  tenantId: string;
  importBatchId: string;
  stagingRowId: string | null;
  reviewReason: string;
  createdBy: string;
}

// ---------------------------------------------------------------------------
// Repository interface.
// ---------------------------------------------------------------------------

export interface HistoricalValidationRepository {
  // Validation error methods
  insertValidationError(row: NewValidationErrorInput): Promise<ImportValidationError>;
  findValidationErrorsForBatch(tenantId: string, importBatchId: string): Promise<ImportValidationError[]>;
  findBlockingErrorsForBatch(tenantId: string, importBatchId: string): Promise<ImportValidationError[]>;
  deleteValidationErrorsForBatch(tenantId: string, importBatchId: string): Promise<void>;

  // Alias mapping methods
  insertAliasMapping(row: NewAliasMappingInput): Promise<ImportAliasMapping>;
  findAliasMappingsForBatch(tenantId: string, importBatchId: string): Promise<ImportAliasMapping[]>;
  findAliasMappingBySourceLabel(tenantId: string, importBatchId: string, entityType: string, sourceLabel: string): Promise<ImportAliasMapping | null>;
  deleteAliasMappingsForBatch(tenantId: string, importBatchId: string): Promise<void>;

  // Human review item methods
  insertHumanReviewItem(row: NewHumanReviewItemInput): Promise<ImportHumanReviewItem>;
  findHumanReviewItemsForBatch(tenantId: string, importBatchId: string): Promise<ImportHumanReviewItem[]>;
  deleteHumanReviewItemsForBatch(tenantId: string, importBatchId: string): Promise<void>;

  // Staging row access (read-only — for validation to iterate rows)
  findStagingRowsForBatch(tenantId: string, importBatchId: string): Promise<ImportStagingRow[]>;

  // Batch access (read-only — for status update after validation)
  findImportBatchById(tenantId: string, id: string): Promise<ImportBatch | null>;
  updateBatchStatus(tenantId: string, batchId: string, status: string): Promise<ImportBatch | null>;
  /**
   * WP-08-01F DEFECT 1A: Update validation status on the batch.
   * Sets validationStatus = "passed" (no blocking errors) or "failed" (blocking errors).
   */
  updateBatchValidationStatus(tenantId: string, batchId: string, validationStatus: string, updatedBy: string): Promise<ImportBatch | null>;
  /**
   * WP-08-01F DEFECT 1A: Update blocking error count and warning count on the batch.
   */
  updateBatchErrorCounts(tenantId: string, batchId: string, blockingErrorCount: number, warningCount: number, updatedBy: string): Promise<ImportBatch | null>;
}

export type {
  ImportValidationError,
  ImportAliasMapping,
  ImportHumanReviewItem,
} from "@/server/db/schema/migration";
