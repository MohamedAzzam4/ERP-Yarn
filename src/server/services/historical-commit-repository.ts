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
  ImportAliasMapping,
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
  /**
   * WP-08-01F Milestone B (COM-CONC-1) — Conditional status restore.
   *
   * Atomically set status='approved_for_commit' ONLY IF the current status
   * is 'committing'. This is the rollback-restore primitive used by the
   * commit-failure catch block.
   *
   * Rationale: an unconditional `updateBatchStatus('approved_for_commit')`
   * in the catch block would overwrite a concurrent winner's `committed`
   * status with `approved_for_commit`, undoing the winner's commit. By
   * gating the restore on `status = 'committing'`, the catch block:
   *   - Restores the in-memory path's "committing" status (no DB
   *     transaction rolled it back).
   *   - Is a no-op for the Postgres path when the transaction already
   *     rolled back (status restored to `approved_for_commit` by the
   *     ROLLBACK — does not match `committing`).
   *   - Is a no-op when another concurrent commit has already transitioned
   *     the batch to `committed` (the winner's commit must NOT be undone by
   *     the loser's catch block).
   *
   * The conditional UPDATE is atomic at the DB level (single statement),
   * so there is no read-then-write race window.
   */
  restoreApprovedForCommitIfCommitting(
    tenantId: string,
    batchId: string,
  ): Promise<void>;
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
   * WP-08-01F DEFECT 2: Invalidate (mark is_current=false) all CURRENT
   * approval records for a batch. Used by the rework command. Prior approval
   * rows are preserved (append-only) with is_current=false, invalidated_at,
   * invalidated_by, and invalidation_reason set. New approvals create new
   * rows with is_current=true. Returns the count of invalidated rows.
   */
  invalidateCurrentApprovalsForBatch(
    tenantId: string,
    importBatchId: string,
    invalidatedBy: string,
    invalidationReason: string,
  ): Promise<number>;

  /**
   * Find only CURRENT approvals (is_current=true) for a batch.
   * Used by submitForApproval and commitBatch to check the current approval state.
   */
  findCurrentApprovalsForBatch(tenantId: string, importBatchId: string): Promise<ImportBatchApproval[]>;

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

  // ---- Alias mappings (read-only cross-service lookup) ----
  /**
   * WP-08-01F (A7): Find only CURRENT alias mappings (is_current=true) for
   * a batch. Used by the submission prerequisite check in
   * submitForApproval to verify that every required alias has
   * status='approved' and targetMasterId IS NOT NULL before the batch
   * can transition to pending_dual_approval.
   *
   * This is a read-only cross-service lookup; the authoritative mutation
   * methods live on HistoricalValidationRepository. The commit repository
   * already exposes other cross-service lookups (blocking validation
   * errors, latest reconciliation results, backup evidence) — this is the
   * same pattern.
   */
  findCurrentAliasMappingsForBatch(tenantId: string, importBatchId: string): Promise<ImportAliasMapping[]>;
  /**
   * WP-08-01F DEC-081 — Find only CURRENT DEFAULT alias mappings
   * (is_current=true AND mapping_kind='default') for a batch. Used by
   * the commit-time required-alias-groups revalidation — EXCEPTION rows
   * are independently approved and do not satisfy the staging-derived
   * required-groups set.
   */
  findCurrentDefaultAliasMappingsForBatch(tenantId: string, importBatchId: string): Promise<ImportAliasMapping[]>;
  /**
   * WP-08-01F DEC-081 — Find only CURRENT EXCEPTION alias mappings
   * (is_current=true AND mapping_kind='exception') for a given
   * (entityType, sourceLabel) key within a batch. Used by the commit
   * revalidation to ensure exceptions remain approved/target-resolved
   * independently of the parent DEFAULT row.
   */
  findCurrentExceptionAliasMappingsForGroup(
    tenantId: string,
    importBatchId: string,
    entityType: string,
    sourceLabel: string,
  ): Promise<ImportAliasMapping[]>;
  /**
   * WP-08-01F Milestone B (COM-CONC-2B) — Detect alias supersession
   * under the commit row lock.
   *
   * `findCurrentAliasMappingsForBatch` filters `is_current=true`, so a
   * superseded approved mapping is silently filtered OUT of the result
   * (leaving an empty list when all approved mappings have been
   * superseded). That makes the existing `!a.isCurrent` filter dead code
   * for the supersession case — the commit cannot see that an approved
   * mapping was superseded since dual approval.
   *
   * This method returns approved alias mappings that have been
   * superseded (`is_current=false` AND `status='approved'`) for the
   * batch. If the result is non-empty, the commit revalidation throws
   * `CommitAliasNotCurrentError` — the commit must fail closed because
   * the approved alias is no longer the current mapping.
   *
   * Like `findCurrentAliasMappingsForBatch`, this is a read-only
   * cross-service lookup. It is called INSIDE the commit transaction
   * so it sees uncommitted supersessions from the same transaction
   * (which is exactly the COM-CONC-2B scenario).
   */
  findSupersededApprovedAliasMappingsForBatch(
    tenantId: string,
    importBatchId: string,
  ): Promise<ImportAliasMapping[]>;
  /**
   * WP-08-01F DEFECT 5/6/7/8 — Validate that the target master referenced by
   * an alias mapping still exists, belongs to the caller's tenant, and
   * matches the alias's entityType. Used by submitForApproval (DEFECT 6)
   * and commitBatch (DEFECT 8) to re-validate alias target masters under
   * the batch row lock so a master inactivated between approval and
   * submission/commit is caught and the batch fails closed.
   *
   * Supported entity types:
   *   - supplier, customer, location, factory (master-data tables)
   *   - fiber_type (fiber_types table)
   *   - product_type (product_types table)
   *   - quality_parameter (quality_parameters table)
   *   - item, batch, lot (inventory_items table — item_kind distinguishes
   *     raw_material_batch vs. yarn_lot; for 'batch'/'lot' we only verify
   *     existence + tenant scope)
   *
   * For unsupported entity types (e.g. 'unknown', 'party', custom
   * strings), returns false (fail-closed). Never throws.
   *
   * Returns true if the master is found and tenant-scoped; false otherwise.
   */
  findMasterForAlias(
    tenantId: string,
    entityType: string,
    targetMasterId: string,
  ): Promise<boolean>;
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
  ImportAliasMapping,
} from "@/server/db/schema/migration";
