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
  /**
   * WP-07-03 correction: Mark old version results as superseded (NOT deleted).
   * Old reconciliation evidence must be preserved for audit/approval binding.
   */
  markVersionAsSuperseded(tenantId: string, importBatchId: string, reportVersion: number): Promise<void>;

  // Review item methods
  insertReviewItem(row: NewReconciliationReviewItemInput): Promise<ImportHumanReviewItem>;
  findReviewItemsForBatch(tenantId: string, importBatchId: string): Promise<ImportHumanReviewItem[]>;
  findReviewItemsForBatchVersion(tenantId: string, importBatchId: string): Promise<ImportHumanReviewItem[]>;
  findReviewItemById(tenantId: string, id: string): Promise<ImportHumanReviewItem | null>;
  updateReviewItemDecision(tenantId: string, id: string, patch: {
    status: string; decision: string | null; decisionNotes: string | null;
    decidedBy: string;
  }): Promise<ImportHumanReviewItem | null>;

  // Staging row access (read-only)
  findStagingRowsForBatch(tenantId: string, importBatchId: string): Promise<ImportStagingRow[]>;

  // Batch access
  findImportBatchById(tenantId: string, id: string): Promise<ImportBatch | null>;
  updateBatchStatus(tenantId: string, batchId: string, status: string): Promise<ImportBatch | null>;
}

export type {
  ImportReconciliationResult,
  ImportHumanReviewItem,
} from "@/server/db/schema/migration";
