/**
 * WP-08-01F — Authoritative migration lifecycle predicates.
 *
 * This module is the SINGLE SOURCE OF TRUTH for the migration action/state
 * matrix. It is imported by:
 *   - The UI (batch detail page) to show/hide controls.
 *   - The service-side guard module `migration-lifecycle-guard.ts`
 *     (which uses the SAME state sets — they cannot diverge).
 *
 * Contract 08 §9 — Authoritative state transition sequence:
 *
 *   draft
 *   → source_uploaded
 *   → normalized
 *   → staged
 *   → validation_in_progress
 *   → validation_complete
 *   → reconciliation_in_progress
 *   → review_required
 *   → pending_dual_approval
 *   → approved_for_commit
 *   → committing
 *   → committed
 *
 * Allowed branches (Contract 08 §9):
 *   source_uploaded → normalized | staged
 *   review_required → normalized | staged | validation_in_progress  (rework)
 *   pending_dual_approval → review_required (material change/rejected approval)
 *   approved_for_commit → review_required (stale version/new blocker)
 *   draft/source_uploaded/normalized/staged/review_required/pending_dual_approval → cancelled
 *   pending_dual_approval → rejected
 *
 * Terminal states: committed, rejected, cancelled.
 *
 * TASK 2: UI predicates must exactly match production service acceptance —
 *         both consume the SAME state sets exported below.
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
// Authoritative state sets — shared by UI predicates AND service guards.
// Tasks 1 & 2: ONE definition, used everywhere.
// ---------------------------------------------------------------------------

/** Terminal states — no further mutation except correction workflow. */
export const TERMINAL_STATES: ReadonlySet<MigrationBatchStatus> = new Set([
  "committed",
  "rejected",
  "cancelled",
]);

/**
 * Preparation states — file registration and staging-row insertion allowed.
 * Contract 08 §9: draft → source_uploaded → normalized → staged.
 */
export const PREPARATION_STATES: ReadonlySet<MigrationBatchStatus> = new Set([
  "draft",
  "source_uploaded",
  "normalized",
  "staged",
]);

/**
 * Validation-eligible states.
 * - staged: initial validation run.
 * - validation_complete: re-validation after staging data changes.
 *
 * NOT allowed: validation_in_progress (concurrent run),
 *              reconciliation_in_progress and later (post-reconciliation states).
 */
export const VALIDATION_ELIGIBLE_STATES: ReadonlySet<MigrationBatchStatus> = new Set([
  "staged",
  "validation_complete",
]);

/**
 * Reconciliation-eligible states — only states BEFORE dual-approval.
 *
 * Per TASK 1.2: must NOT mutate reconciliation evidence while batch is
 * pending_dual_approval, approved_for_commit, committing, committed,
 * rejected, or cancelled. A material change in those states requires
 * first transitioning back to review_required/validation, explicitly
 * invalidating bound approvals.
 */
export const RECONCILIATION_ELIGIBLE_STATES: ReadonlySet<MigrationBatchStatus> = new Set([
  "validation_complete",
  "reconciliation_in_progress",
  "review_required",
]);

/**
 * Review-eligible states — recordReviewDecision only in review_required.
 *
 * Per TASK 1.3: must require an existing unresolved review item, the exact
 * current reconciliation/report version, and an appropriate review state.
 * NOT allowed merely because the batch is staged or in post-review states.
 */
export const REVIEW_ELIGIBLE_STATES: ReadonlySet<MigrationBatchStatus> = new Set([
  "review_required",
]);

/**
 * Submission-eligible states — submitForApproval only in review_required.
 *
 * WP-08-01F DEFECT 1: explicit submission command transitions
 * review_required → pending_dual_approval. Without this, the first approval
 * can never be reached because recordApproval requires
 * pending_dual_approval or approved_for_commit.
 */
export const SUBMISSION_ELIGIBLE_STATES: ReadonlySet<MigrationBatchStatus> = new Set([
  "review_required",
]);

/**
 * Approval-eligible states — recordApproval only after validation,
 * reconciliation, and human review prerequisites are complete and the
 * batch has reached the contracted dual-approval state.
 *
 * Per TASK 1.1: must NOT accept validation_complete, reconciliation_in_progress,
 * unresolved review_required, preparation states, terminal/committing states.
 */
export const APPROVAL_ELIGIBLE_STATES: ReadonlySet<MigrationBatchStatus> = new Set([
  "pending_dual_approval",
  "approved_for_commit",
]);

/**
 * Backup-evidence-eligible states — recordBackupEvidence must follow its
 * exact contracted point before submission for approval and remain
 * immutable after commit.
 *
 * Allowed: review_required, pending_dual_approval, approved_for_commit.
 * NOT allowed: validation_complete, reconciliation_in_progress (too early —
 *              reconciliation report not final),
 *              committing, committed, rejected, cancelled (locked/terminal).
 */
export const BACKUP_ELIGIBLE_STATES: ReadonlySet<MigrationBatchStatus> = new Set([
  "review_required",
  "pending_dual_approval",
  "approved_for_commit",
]);

/**
 * Commit-eligible states — only approved_for_commit.
 *
 * Per TASK 1.6: commitBatch must revalidate both current approvals,
 * distinct identities, exact hashes/versions, validation/reconciliation
 * completion, accepted warnings, backup evidence, no blockers.
 */
export const COMMIT_ELIGIBLE_STATES: ReadonlySet<MigrationBatchStatus> = new Set([
  "approved_for_commit",
]);

/**
 * All possible batch statuses — used for full-matrix parity tests.
 */
export const ALL_BATCH_STATUSES: ReadonlyArray<MigrationBatchStatus> = [
  "draft",
  "source_uploaded",
  "normalized",
  "staged",
  "validation_in_progress",
  "validation_complete",
  "reconciliation_in_progress",
  "review_required",
  "pending_dual_approval",
  "approved_for_commit",
  "committing",
  "committed",
  "rejected",
  "cancelled",
];

// ---------------------------------------------------------------------------
// Predicates — each action's allowed states.
// These mirror the service-side guard functions exactly (TASK 2).
// ---------------------------------------------------------------------------

/** Can register a new file. Only in preparation states. */
export function canRegisterFile(state: MigrationBatchState): boolean {
  return PREPARATION_STATES.has(state.status);
}

/** Can insert a staging row. Only in preparation states. */
export function canInsertStagingRow(state: MigrationBatchState): boolean {
  return PREPARATION_STATES.has(state.status);
}

/**
 * Can run validation. Only in 'staged' state with at least one row,
 * or re-run from 'validation_complete' (after staging data change).
 */
export function canRunValidation(state: MigrationBatchState): boolean {
  if (!VALIDATION_ELIGIBLE_STATES.has(state.status)) return false;
  if (state.stagedRowCount === 0) return false;
  return true;
}

/**
 * Can run reconciliation. Only in validation_complete, reconciliation_in_progress,
 * or review_required (re-run after rework). NEVER after dual-approval states.
 */
export function canRunReconciliation(state: MigrationBatchState): boolean {
  return RECONCILIATION_ELIGIBLE_STATES.has(state.status);
}

/**
 * Can record a review decision. ONLY in review_required state.
 * (Existing review items also required — checked at service level.)
 */
export function canRecordReviewDecision(state: MigrationBatchState): boolean {
  return REVIEW_ELIGIBLE_STATES.has(state.status);
}

/**
 * Can submit for approval. ONLY in review_required state with:
 * - validation passed (validationStatus set, no blocking errors)
 * - reconciliation matched (no blocking results)
 * - all review items resolved (no pending items — checked at service level)
 * - staged data hash + cutover manifest hash present
 * - all warnings accepted (warningCount === acceptedWarningCount)
 * - backup evidence present (Contract 08 §8.9)
 *
 * WP-08-01F DEFECT 1: this is the explicit submission command that
 * transitions review_required → pending_dual_approval.
 */
export function canSubmitForApproval(state: MigrationBatchState): boolean {
  if (!SUBMISSION_ELIGIBLE_STATES.has(state.status)) return false;
  if (state.blockingErrorCount > 0) return false;
  if (state.warningCount > state.acceptedWarningCount) return false;
  if (!state.stagedDataHash) return false;
  if (!state.cutoverManifestHash) return false;
  if (!state.hasBackupEvidence) return false;
  return true;
}

/**
 * Can record Owner approval.
 * Requires: batch in pending_dual_approval or approved_for_commit,
 *           no blocking errors, all warnings accepted,
 *           staged data hash + cutover manifest hash present.
 *
 * Per TASK 1.1: validation, reconciliation, and human review prerequisites
 * must be complete and the batch must have reached the contracted
 * dual-approval state.
 */
export function canRecordOwnerApproval(state: MigrationBatchState): boolean {
  if (!APPROVAL_ELIGIBLE_STATES.has(state.status)) return false;
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

/**
 * Can register backup evidence.
 * Only in review_required, pending_dual_approval, or approved_for_commit.
 */
export function canRecordBackupEvidence(state: MigrationBatchState): boolean {
  return BACKUP_ELIGIBLE_STATES.has(state.status);
}

/**
 * Can commit batch. Must be approved_for_commit with:
 * - both current approvals
 * - backup evidence
 * - no blocking errors
 * - all warnings accepted
 */
export function canCommitBatch(state: MigrationBatchState): boolean {
  if (!COMMIT_ELIGIBLE_STATES.has(state.status)) return false;
  if (!state.hasOwnerApproval) return false;
  if (!state.hasAccountantApproval) return false;
  if (!state.hasBackupEvidence) return false;
  if (state.blockingErrorCount > 0) return false;
  if (state.warningCount > state.acceptedWarningCount) return false;
  return true;
}

/** Can create correction request. Only committed batches. */
export function canCreateCorrectionRequest(state: MigrationBatchState): boolean {
  return state.status === "committed";
}

/** Can approve correction. Only committed batch with pending_review correction. */
export function canApproveCorrection(state: MigrationBatchState): boolean {
  return state.status === "committed";
}

/**
 * Correction-level predicate: can approve with specific role.
 * Per DEC-070: renewed dual approval required.
 * Per DEC-069: distinct identities for the two slots.
 */
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

/**
 * Role-specific control visibility (TASK 3).
 *
 * Returns which approval controls the authenticated user may SEE.
 * - Owner-only user → only Owner control.
 * - Accountant-only user → only Accountant control.
 * - Unauthorized management/worker roles → neither.
 * - A legitimate multi-role identity may see both controls, but the service
 *   must still prevent the same identity satisfying both slots (DEC-069).
 */
export function visibleApprovalControls(
  userRoles: ReadonlyArray<"owner" | "accountant">,
  state: MigrationBatchState,
): { owner: boolean; accountant: boolean } {
  const batchAllows = canRecordOwnerApproval(state);
  const hasOwner = userRoles.includes("owner");
  const hasAccountant = userRoles.includes("accountant");
  return {
    owner: batchAllows && hasOwner,
    accountant: batchAllows && hasAccountant,
  };
}

/**
 * Role-specific correction control visibility (TASK 3).
 * Same logic as batch approvals but for correction requests.
 */
export function visibleCorrectionApprovalControls(
  userRoles: ReadonlyArray<"owner" | "accountant">,
  correctionStatus: string,
  existingOwnerApproval: boolean,
  existingAccountantApproval: boolean,
): { owner: boolean; accountant: boolean } {
  const ownerEligible = canApproveCorrectionWithRole(
    correctionStatus, existingOwnerApproval, existingAccountantApproval, "owner",
  );
  const accountantEligible = canApproveCorrectionWithRole(
    correctionStatus, existingOwnerApproval, existingAccountantApproval, "accountant",
  );
  return {
    owner: ownerEligible && userRoles.includes("owner"),
    accountant: accountantEligible && userRoles.includes("accountant"),
  };
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
// Full action/state matrix (for testing & UI display)
// ---------------------------------------------------------------------------

export interface ActionAllowedResult {
  registerFile: boolean;
  insertStagingRow: boolean;
  runValidation: boolean;
  runReconciliation: boolean;
  recordReviewDecision: boolean;
  submitForApproval: boolean;
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
    submitForApproval: canSubmitForApproval(state),
    recordOwnerApproval: canRecordOwnerApproval(state),
    recordAccountantApproval: canRecordAccountantApproval(state),
    recordBackupEvidence: canRecordBackupEvidence(state),
    commitBatch: canCommitBatch(state),
    createCorrectionRequest: canCreateCorrectionRequest(state),
    approveCorrection: canApproveCorrection(state),
  };
}
