/**
 * Historical Commit Repository — WP-07-04.
 *
 * Contract: docs/contracts/08_historical_migration_contract.md
 *   §8.9 Human Review and Approval (dual approval, version binding)
 *   §8.10 Approved Historical Commit (preconditions, locks, atomic commit)
 *   §8.11 Historical Locking and Correction
 *
 * Contract: docs/contracts/06_approval_transaction_contract.md §15
 *   Historical Import Commit Contract.
 *
 * Repository interface for:
 *   - import_batch_approvals (dual approval records with version/hash binding)
 *   - import_backup_evidence (backup evidence before commit)
 *   - import_cutover_locks (cutover lock for concurrent commit prevention)
 *   - import_batches (commit status transitions)
 *   - import_staging_rows (committed entity links)
 *
 * DEC-069: Approvals must come from two distinct user identities.
 * DEC-071: MVP scope is opening_balance only.
 * DEC-072: Accepted differences require explicit metadata.
 */
import "server-only";

import type {
  ImportBatch,
  ImportBatchApproval,
  ImportBackupEvidence,
  ImportCutoverLock,
  ImportStagingRow,
  ImportValidationError,
  ImportReconciliationResult,
  ImportCutoverManifest,
} from "@/server/db/schema/migration";

// ---------------------------------------------------------------------------
// Input types.
// ---------------------------------------------------------------------------

export interface NewApprovalInput {
  tenantId: string;
  importBatchId: string;
  approverRole: "owner" | "accountant";
  approverUserId: string;
  // Version/hash binding (Contract 08 §8.9)
  stagedDataHash: string;
  cutoverManifestHash: string;
  templateVersion: string | null;
  mappingVersion: string | null;
  validationStatus: string;
  reconciliationStatus: string;
  warningSummary: string | null;
  reason: string | null;
  createdBy: string;
}

export interface NewBackupEvidenceInput {
  tenantId: string;
  importBatchId: string;
  backupType: string;
  backupLocation: string;
  backupHash: string;
  backupSizeBytes: number | null;
  backupCreatedAt: Date;
  verifiedBy: string | null;
  verifiedAt: Date | null;
  verificationNotes: string | null;
  createdBy: string;
}

export interface NewCutoverLockInput {
  tenantId: string;
  importBatchId: string;
  lockScope: string;
  acquiredBy: string;
  expiresAt: Date;
  commitIdempotencyKey: string;
  createdBy: string;
}

export interface ReleaseLockInput {
  releasedBy: string;
  releasedAt: Date;
  releaseReason: string | null;
}

export interface UpdateStagingRowCommitLinkInput {
  committedEntityType: string;
  committedEntityId: string;
  updatedBy: string;
}

// ---------------------------------------------------------------------------
// Repository interface.
// ---------------------------------------------------------------------------

export interface HistoricalCommitRepository {
  // ---- Batch access ----
  findImportBatchById(tenantId: string, id: string): Promise<ImportBatch | null>;
  updateBatchStatus(tenantId: string, batchId: string, status: string): Promise<ImportBatch | null>;
  updateBatchCommitMetadata(
    tenantId: string,
    batchId: string,
    patch: {
      committedAt: Date;
      commitEffectCounts: Record<string, number>;
      updatedBy: string;
    },
  ): Promise<ImportBatch | null>;
  updateBatchStagedDataHash(
    tenantId: string,
    batchId: string,
    stagedDataHash: string,
    updatedBy: string,
  ): Promise<ImportBatch | null>;

  // ---- Approval records (DEC-069: dual distinct identity) ----
  insertApproval(row: NewApprovalInput): Promise<ImportBatchApproval>;
  findApprovalsForBatch(tenantId: string, importBatchId: string): Promise<ImportBatchApproval[]>;
  findApprovalByRole(
    tenantId: string,
    importBatchId: string,
    approverRole: "owner" | "accountant",
  ): Promise<ImportBatchApproval | null>;
  /**
   * WP-08-01F DEFECT 2: Invalidate (delete) all approval records for a batch.
   * Used by the rework command when transitioning back to a preparation state.
   * The original approval audit entries remain in audit_logs (immutable) —
   * only the approval rows themselves are removed so new approvals can be
   * recorded against the new hashes/versions. Returns the count of deleted rows.
   */
  invalidateApprovalsForBatch(tenantId: string, importBatchId: string): Promise<number>;

  // ---- Backup evidence ----
  insertBackupEvidence(row: NewBackupEvidenceInput): Promise<ImportBackupEvidence>;
  findBackupEvidenceForBatch(tenantId: string, importBatchId: string): Promise<ImportBackupEvidence[]>;

  // ---- Cutover locks ----
  insertCutoverLock(row: NewCutoverLockInput): Promise<ImportCutoverLock>;
  findActiveCutoverLocksForBatch(tenantId: string, importBatchId: string): Promise<ImportCutoverLock[]>;
  findActiveCutoverLockByScope(
    tenantId: string,
    importBatchId: string,
    lockScope: string,
  ): Promise<ImportCutoverLock | null>;
  releaseCutoverLock(
    tenantId: string,
    lockId: string,
    patch: ReleaseLockInput,
  ): Promise<ImportCutoverLock | null>;
  releaseAllLocksForBatch(
    tenantId: string,
    importBatchId: string,
    patch: ReleaseLockInput,
  ): Promise<number>;

  // ---- Staging rows (read + commit link update) ----
  findStagingRowsForBatch(tenantId: string, importBatchId: string): Promise<ImportStagingRow[]>;
  updateStagingRowCommitLink(
    tenantId: string,
    stagingRowId: string,
    patch: UpdateStagingRowCommitLinkInput,
  ): Promise<ImportStagingRow | null>;

  // ---- Validation errors (for blocking check) ----
  findBlockingValidationErrors(tenantId: string, importBatchId: string): Promise<ImportValidationError[]>;

  // ---- Reconciliation results (for blocking check) ----
  findLatestReconciliationResults(tenantId: string, importBatchId: string): Promise<ImportReconciliationResult[]>;

  // ---- Cutover manifests ----
  findCutoverManifestsForBatch(tenantId: string, importBatchId: string): Promise<ImportCutoverManifest[]>;
}

export type {
  ImportBatch,
  ImportBatchApproval,
  ImportBackupEvidence,
  ImportCutoverLock,
  ImportStagingRow,
  ImportValidationError,
  ImportReconciliationResult,
  ImportCutoverManifest,
} from "@/server/db/schema/migration";
