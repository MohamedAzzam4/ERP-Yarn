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
  /**
   * WP-08-01F (A1/A2) — Stable group identity for repeated occurrences of
   * the same source label across multiple staging rows. All staging rows
   * sharing the same (tenant, batch, entityType, normalizedName) get the
   * same groupId so the UI can group them. Re-validation reuses the same
   * groupId if the alias already exists.
   */
  groupId?: string | null;
  /**
   * WP-08-01F (A1/A2) — How many staging rows share this group. Updated
   * on re-validation. Defaults to 1 for the first occurrence.
   */
  occurrenceCount?: number;
  /**
   * WP-08-01F (A1/A2) — Array of source row numbers explicitly split from
   * the default group (e.g. one row in a group of "Same Name" rows was
   * remapped to a different master). Defaults to null.
   */
  exceptionSourceRowIds?: number[] | null;
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
  /**
   * WP-08-01F (A3) — Approve (or reject) a single alias mapping by setting
   * its status, targetMasterId, approvedBy, approvedAt, mappingVersion, and
   * notes. The alias must already exist as the CURRENT mapping for its
   * (tenant, batch, entityType, sourceLabel) key. This is the in-place
   * approval mutation — material remap (re-approval to a different target)
   * goes through supersedeAliasMapping + insertAliasMapping instead.
   *
   * Returns the updated alias mapping, or null if the alias mapping does
   * not exist or does not belong to the tenant.
   */
  updateAliasMappingStatus(
    tenantId: string,
    aliasMappingId: string,
    update: {
      status: string;
      targetMasterId: string | null;
      approvedBy: string;
      approvedAt: Date;
      mappingVersion: string | null;
      notes: string | null;
    },
  ): Promise<ImportAliasMapping | null>;
  /**
   * WP-08-01F (A3) — Find a single alias mapping by its primary key within
   * the caller's tenant. Used by approveAliasMapping to load the mapping
   * being approved (and to re-check its current status after the idempotency
   * claim is acquired).
   */
  findAliasMappingById(tenantId: string, aliasMappingId: string): Promise<ImportAliasMapping | null>;
  /**
   * WP-08-01F (A3) — Find only CURRENT alias mappings (is_current=true)
   * for a batch. Used by the submission prerequisite check to verify that
   * every required alias has status='approved' and targetMasterId IS NOT
   * NULL.
   */
  findCurrentAliasMappingsForBatch(tenantId: string, importBatchId: string): Promise<ImportAliasMapping[]>;
  /**
   * WP-08-01F (A3/A5) — Supersede (mark is_current=false) a single alias
   * mapping by id, preserving the row as audit history. Used by material
   * remap (re-approval to a different target): the old current row is
   * superseded before inserting the new current row with the new target.
   * Returns the superseded row (with is_current=false) or null if the
   * row was not found or was already superseded.
   */
  supersedeAliasMapping(
    tenantId: string,
    aliasMappingId: string,
    supersededBy: string,
    supersededReason: string,
  ): Promise<ImportAliasMapping | null>;
  /**
   * WP-08-01F DEFECT 2 — Update occurrenceCount on the CURRENT alias mapping
   * for a given (tenant, batch, entityType, sourceLabel). Called by
   * runValidation AFTER processing all staging rows to persist the final
   * occurrence count per group. The update ONLY touches occurrenceCount
   * — never status, targetMasterId, approvedBy, or approvedAt.
   *
   * Returns the updated alias mapping, or null if no current mapping
   * exists for the (entityType, sourceLabel) key. Idempotent: re-running
   * validation against the same source data produces the same final
   * count (it overwrites the column with the recomputed value rather
   * than incrementing).
   */
  updateAliasMappingOccurrenceCount(
    tenantId: string,
    importBatchId: string,
    entityType: string,
    sourceLabel: string,
    occurrenceCount: number,
  ): Promise<ImportAliasMapping | null>;

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
