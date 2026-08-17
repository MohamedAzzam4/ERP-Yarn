/**
 * Historical Reconciliation Repository — WP-07-03.
 *
 * Contract: docs/contracts/08_historical_migration_contract.md
 *   §8.7 Reconciliation Requirements, §8.8 Versioning, §8.9 Human Review.
 *
 * Repository interface for import_reconciliation_results and
 * import_human_review_items tables (reconciliation-specific methods).
 * Non-operational — no stock/account/sales effects.
 */
import "server-only";

import type {
  ImportReconciliationResult,
  ImportHumanReviewItem,
  ImportStagingRow,
  ImportBatch,
} from "@/server/db/schema/migration";

// ---------------------------------------------------------------------------
// Input types.
// ---------------------------------------------------------------------------

export interface NewReconciliationResultInput {
  tenantId: string;
  importBatchId: string;
  reportVersion: number;
  metricKey: string;
  expectedValue: string | null;
  stagedValue: string | null;
  committedValue: string | null;
  differenceValue: string | null;
  status: string; // 'pending' | 'matched' | 'difference' | 'accepted_difference' | 'blocking'
  notes: string | null;
  createdBy: string;
}

export interface NewReconciliationReviewItemInput {
  tenantId: string;
  importBatchId: string;
  stagingRowId: string | null;
  reviewReason: string;
  createdBy: string;
}

// ---------------------------------------------------------------------------
// Repository interface.
// ---------------------------------------------------------------------------

export interface HistoricalReconciliationRepository {
  // Reconciliation result methods
  insertReconciliationResult(row: NewReconciliationResultInput): Promise<ImportReconciliationResult>;
  findReconciliationResultsForBatch(tenantId: string, importBatchId: string): Promise<ImportReconciliationResult[]>;
  findReconciliationResultsForBatchVersion(tenantId: string, importBatchId: string, reportVersion: number): Promise<ImportReconciliationResult[]>;
  findLatestReportVersion(tenantId: string, importBatchId: string): Promise<number>;
  // WP-08-01F Milestone C Task 4: markVersionAsSuperseded has been REMOVED
  // from the interface. Old reconciliation-result rows are NEVER mutated.
  // The `report_version` column itself is the supersession mechanism —
  // the latest version is "current", older versions remain as immutable
  // audit history (Contract 08 §8.7, DEC-019 principle).

  // Review item methods
  insertReviewItem(row: NewReconciliationReviewItemInput): Promise<ImportHumanReviewItem>;
  findReviewItemsForBatch(tenantId: string, importBatchId: string): Promise<ImportHumanReviewItem[]>;
  findReviewItemsForBatchVersion(tenantId: string, importBatchId: string): Promise<ImportHumanReviewItem[]>;
  findReviewItemById(tenantId: string, id: string): Promise<ImportHumanReviewItem | null>;
  updateReviewItemDecision(tenantId: string, id: string, patch: {
    status: string; decision: string | null; decisionNotes: string | null;
    decidedBy: string;
  }): Promise<ImportHumanReviewItem | null>;
  /**
   * WP-08-01F DEFECT 2: Supersede (mark is_current=false) all CURRENT review
   * items for a batch. Used by the rework command — old review items are tied
   * to the old reconciliation report version and are superseded (not deleted).
   * Resolved items remain as historical evidence with is_current=false.
   * Returns the count of superseded items.
   */
  supersedeReviewItemsForBatch(
    tenantId: string,
    importBatchId: string,
    supersededBy: string,
    supersededReason: string,
  ): Promise<number>;

  /**
   * Find only CURRENT review items (is_current=true) for a batch.
   */
  findCurrentReviewItemsForBatch(tenantId: string, importBatchId: string): Promise<ImportHumanReviewItem[]>;

  // Staging row access (read-only)
  findStagingRowsForBatch(tenantId: string, importBatchId: string): Promise<ImportStagingRow[]>;

  // Batch access
  findImportBatchById(tenantId: string, id: string): Promise<ImportBatch | null>;
  updateBatchStatus(tenantId: string, batchId: string, status: string): Promise<ImportBatch | null>;
  /**
   * WP-08-01F DEFECT 2: Reset the batch's validationStatus and
   * reconciliationStatus to null (forces re-validation and re-reconciliation
   * after rework). Does NOT change the batch status itself — the caller
   * sets the target status via updateBatchStatus.
   */
  resetBatchValidationAndReconciliationStatuses(
    tenantId: string,
    batchId: string,
  ): Promise<ImportBatch | null>;
  /**
   * WP-08-01F DEFECT 1A: Set the reconciliationStatus on the batch.
   * Used by runReconciliation to set "matched" / "difference" / "blocking".
   */
  updateBatchReconciliationStatus(
    tenantId: string,
    batchId: string,
    reconciliationStatus: string,
    updatedBy: string,
  ): Promise<ImportBatch | null>;
}

export type {
  ImportReconciliationResult,
  ImportHumanReviewItem,
} from "@/server/db/schema/migration";
