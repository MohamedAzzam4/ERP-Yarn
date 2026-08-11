/**
 * WP-08-01F — Migration lifecycle predicates.
 *
 * Reusable typed module that determines which actions are allowed
 * in each batch lifecycle state. Used by both the UI (to show/hide
 * controls) and tests (to verify state matrix).
 *
 * Contract 08 §8: Historical Migration lifecycle.
 * Contract 10 §9: Historical Migration Screens.
 */
import "server-only";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MigrationBatchStatus =
  | "draft"
  | "source_uploaded"
  | "normalized"
  | "staged"
  | "validation_in_progress"
  | "validation_complete"
  | "reconciliation_in_progress"
  | "review_required"
  | "pending_dual_approval"
  | "approved_for_commit"
  | "committing"
  | "committed"
  | "rejected"
  | "cancelled";

export interface MigrationBatchState {
  status: MigrationBatchStatus;
  stagedRowCount: number;
  blockingErrorCount: number;
  warningCount: number;
  acceptedWarningCount: number;
  stagedDataHash: string | null;
  cutoverManifestHash: string | null;
  hasOwnerApproval: boolean;
  hasAccountantApproval: boolean;
  hasBackupEvidence: boolean;
}

// ---------------------------------------------------------------------------
// Predicates — each action's allowed states
// ---------------------------------------------------------------------------

const TERMINAL_STATES: ReadonlySet<MigrationBatchStatus> = new Set([
  "committed",
  "rejected",
  "cancelled",
]);

const PREPARATION_STATES: ReadonlySet<MigrationBatchStatus> = new Set([
  "draft",
  "source_uploaded",
  "normalized",
  "staged",
]);

const POST_STAGING_STATES: ReadonlySet<MigrationBatchStatus> = new Set([
  "staged",
  "validation_in_progress",
  "validation_complete",
  "reconciliation_in_progress",
  "review_required",
  "pending_dual_approval",
  "approved_for_commit",
]);

const PRE_COMMIT_STATES: ReadonlySet<MigrationBatchStatus> = new Set([
  "review_required",
  "pending_dual_approval",
  "approved_for_commit",
]);

/** Can register a new file. */
export function canRegisterFile(state: MigrationBatchState): boolean {
  return PREPARATION_STATES.has(state.status);
}

/** Can insert a staging row. */
export function canInsertStagingRow(state: MigrationBatchState): boolean {
  return PREPARATION_STATES.has(state.status);
}

/** Can run validation. Only in 'staged' state with at least one row, or re-run from 'validation_complete'. */
export function canRunValidation(state: MigrationBatchState): boolean {
  return (state.status === "staged" || state.status === "validation_complete")
    && state.stagedRowCount > 0;
}

/** Can run reconciliation. Only after validation is complete. */
export function canRunReconciliation(state: MigrationBatchState): boolean {
  return state.status === "validation_complete"
    || state.status === "reconciliation_in_progress"
    || state.status === "review_required"
    || state.status === "pending_dual_approval"
    || state.status === "approved_for_commit";
}

/** Can record a review decision. Only in review-eligible states with pending items. */
export function canRecordReviewDecision(state: MigrationBatchState): boolean {
  return POST_STAGING_STATES.has(state.status);
}

/** Can record Owner approval. Requires validation + reconciliation completion + no blocking errors + hashes. */
export function canRecordOwnerApproval(state: MigrationBatchState): boolean {
  if (TERMINAL_STATES.has(state.status)) return false;
  if (state.status === "committing") return false;
  if (state.status === "draft" || state.status === "source_uploaded" || state.status === "normalized" || state.status === "staged") return false;
  if (state.blockingErrorCount > 0) return false;
  if (state.warningCount > state.acceptedWarningCount) return false;
  if (!state.stagedDataHash) return false;
  if (!state.cutoverManifestHash) return false;
  return true;
}

/** Can record Accountant approval. Same requirements as Owner. */
export function canRecordAccountantApproval(state: MigrationBatchState): boolean {
  return canRecordOwnerApproval(state);
}

/** Can register backup evidence. Pre-commit states only. */
export function canRecordBackupEvidence(state: MigrationBatchState): boolean {
  return PRE_COMMIT_STATES.has(state.status)
    || state.status === "validation_complete"
    || state.status === "reconciliation_in_progress";
}

/** Can commit batch. Must be fully approved with backup evidence. */
export function canCommitBatch(state: MigrationBatchState): boolean {
  return state.status === "approved_for_commit"
    && state.hasOwnerApproval
    && state.hasAccountantApproval
    && state.hasBackupEvidence
    && state.blockingErrorCount === 0
    && state.warningCount === state.acceptedWarningCount;
}

/** Can create correction request. Only committed batches. */
export function canCreateCorrectionRequest(state: MigrationBatchState): boolean {
  return state.status === "committed";
}

/** Can approve correction. Only committed batch with pending_review correction. */
export function canApproveCorrection(state: MigrationBatchState): boolean {
  return state.status === "committed";
}

/** Correction-level predicate: can approve with specific role. */
export function canApproveCorrectionWithRole(
  correctionStatus: string,
  existingOwnerApproval: boolean,
  existingAccountantApproval: boolean,
  role: "owner" | "accountant",
): boolean {
  if (correctionStatus !== "pending_review") return false;
  if (role === "owner" && existingOwnerApproval) return false;
  if (role === "accountant" && existingAccountantApproval) return false;
  return true;
}

/** Batch is read-only (no mutations except correction workflow). */
export function isReadOnly(state: MigrationBatchState): boolean {
  return TERMINAL_STATES.has(state.status) || state.status === "committing";
}

/** Batch is committed and locked. */
export function isCommitted(state: MigrationBatchState): boolean {
  return state.status === "committed";
}

// ---------------------------------------------------------------------------
// Full action/state matrix (for testing)
// ---------------------------------------------------------------------------

export interface ActionAllowedResult {
  registerFile: boolean;
  insertStagingRow: boolean;
  runValidation: boolean;
  runReconciliation: boolean;
  recordReviewDecision: boolean;
  recordOwnerApproval: boolean;
  recordAccountantApproval: boolean;
  recordBackupEvidence: boolean;
  commitBatch: boolean;
  createCorrectionRequest: boolean;
  approveCorrection: boolean;
}

export function getActionMatrix(state: MigrationBatchState): ActionAllowedResult {
  return {
    registerFile: canRegisterFile(state),
    insertStagingRow: canInsertStagingRow(state),
    runValidation: canRunValidation(state),
    runReconciliation: canRunReconciliation(state),
    recordReviewDecision: canRecordReviewDecision(state),
    recordOwnerApproval: canRecordOwnerApproval(state),
    recordAccountantApproval: canRecordAccountantApproval(state),
    recordBackupEvidence: canRecordBackupEvidence(state),
    commitBatch: canCommitBatch(state),
    createCorrectionRequest: canCreateCorrectionRequest(state),
    approveCorrection: canApproveCorrection(state),
  };
}
