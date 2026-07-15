/**
 * Historical Commit Repository — WP-07-04.
 *
 * Contract: docs/contracts/08_historical_migration_contract.md
 *   §8.9 Human Review, §8.10 Commit, §8.11 Cutover Lock.
 *   DEC-069: distinct approval identity.
 *   DEC-071: opening balances only for MVP.
 *
 * Repository interface for import_batch_approvals, import_cutover_manifests,
 * and commit-related batch/staging row operations.
 */
import "server-only";

import type {
  ImportBatchApproval,
  ImportCutoverManifest,
  ImportBatch,
  ImportStagingRow,
  ImportValidationError,
  ImportHumanReviewItem,
  ImportReconciliationResult,
} from "@/server/db/schema/migration";

// ---------------------------------------------------------------------------
// Input types.
// ---------------------------------------------------------------------------

export interface NewApprovalInput {
  tenantId: string;
  importBatchId: string;
  approverRole: string; // 'owner' | 'accountant'
  approverUserId: string;
  stagedDataHash: string;
  cutoverManifestHash: string;
  templateVersion: string | null;
  mappingVersion: string | null;
  validationStatus: string;
  reconciliationStatus: string;
  warningSummary: string | null;
  reason: string | null;
}

export interface NewCutoverLockInput {
  tenantId: string;
  importBatchId: string;
  domain: string;
  lockHolder: string;
}

// ---------------------------------------------------------------------------
// Repository interface.
// ---------------------------------------------------------------------------

export interface HistoricalCommitRepository {
  // Approval methods
  insertApproval(row: NewApprovalInput): Promise<ImportBatchApproval>;
  findApprovalsForBatch(tenantId: string, importBatchId: string): Promise<ImportBatchApproval[]>;
  findApprovalByRole(tenantId: string, importBatchId: string, role: string): Promise<ImportBatchApproval | null>;

  // Cutover lock methods
  insertCutoverLock(row: NewCutoverLockInput): Promise<ImportCutoverManifest>;
  findCutoverLocksForBatch(tenantId: string, importBatchId: string): Promise<ImportCutoverManifest[]>;
  deleteCutoverLocksForBatch(tenantId: string, importBatchId: string): Promise<void>;

  // Batch methods
  findImportBatchById(tenantId: string, id: string): Promise<ImportBatch | null>;
  updateBatchStatus(tenantId: string, batchId: string, status: string): Promise<ImportBatch | null>;
  updateBatchCommitInfo(tenantId: string, batchId: string, patch: {
    status: string;
    committedAt: Date;
    commitEffectCounts: Record<string, number> | null;
  }): Promise<ImportBatch | null>;

  // Staging row methods
  findStagingRowsForBatch(tenantId: string, importBatchId: string): Promise<ImportStagingRow[]>;
  updateStagingRowCommitted(tenantId: string, stagingRowId: string, entityType: string, entityId: string): Promise<void>;

  // Validation/reconciliation/review checks
  findBlockingErrorsForBatch(tenantId: string, importBatchId: string): Promise<ImportValidationError[]>;
  findUnresolvedReviewItemsForBatch(tenantId: string, importBatchId: string): Promise<ImportHumanReviewItem[]>;
  findBlockingReconciliationResultsForBatch(tenantId: string, importBatchId: string): Promise<ImportReconciliationResult[]>;

  // Cutover manifest methods
  findCutoverManifestsForBatch(tenantId: string, importBatchId: string): Promise<ImportCutoverManifest[]>;
}

export type {
  ImportBatchApproval,
  ImportCutoverManifest,
} from "@/server/db/schema/migration";
