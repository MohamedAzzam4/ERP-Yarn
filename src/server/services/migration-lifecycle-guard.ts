/**
 * WP-08-01F — Shared migration lifecycle guard (SERVICE-SIDE).
 *
 * Enforces batch lifecycle states inside domain services before
 * any idempotency claim, sequence allocation, audit or write.
 *
 * TASK 2: This module imports the SAME state sets from
 * `migration-lifecycle-predicates.ts` so UI and services CANNOT diverge.
 *
 * Contract 08 §9: Historical Migration lifecycle (state transitions).
 * Contract 10 §9: Historical Migration Screens.
 *
 * This module is called by the WP-07 services themselves —
 * UI predicates are NOT the only protection.
 */
import "server-only";
import type { ImportBatch } from "@/server/db/schema/migration";
import {
  APPROVAL_ELIGIBLE_STATES,
  BACKUP_ELIGIBLE_STATES,
  COMMIT_ELIGIBLE_STATES,
  PREPARATION_STATES,
  RECONCILIATION_ELIGIBLE_STATES,
  REVIEW_ELIGIBLE_STATES,
  VALIDATION_ELIGIBLE_STATES,
} from "./migration-lifecycle-predicates";

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class MigrationLifecycleError extends Error {
  readonly code: string;
  readonly batchId: string;
  readonly currentStatus: string;
  readonly allowedStatuses: string[];

  constructor(
    batchId: string,
    currentStatus: string,
    allowedStatuses: string[],
    operation: string,
  ) {
    super(
      `LIFECYCLE_VIOLATION: Cannot ${operation} on batch '${batchId}' ` +
      `in status '${currentStatus}'. Allowed statuses: [${allowedStatuses.join(", ")}].`,
    );
    this.name = "MigrationLifecycleError";
    this.code = "LIFECYCLE_VIOLATION";
    this.batchId = batchId;
    this.currentStatus = currentStatus;
    this.allowedStatuses = allowedStatuses;
  }
}

// ---------------------------------------------------------------------------
// Guard functions — each checks batch status before any write.
// State sets come from migration-lifecycle-predicates.ts (TASK 2 — single source).
// ---------------------------------------------------------------------------

function enforceStatus(
  batch: ImportBatch,
  allowedStatuses: ReadonlySet<string>,
  operation: string,
): void {
  if (!allowedStatuses.has(batch.status)) {
    throw new MigrationLifecycleError(
      batch.id,
      batch.status,
      [...allowedStatuses],
      operation,
    );
  }
}

/**
 * Guard for registerFile — only in preparation states.
 * Contract 08 §9: draft | source_uploaded | normalized | staged.
 */
export function guardRegisterFile(batch: ImportBatch): void {
  enforceStatus(batch, PREPARATION_STATES, "register file");
}

/**
 * Guard for insertStagingRow — only in preparation states.
 * Contract 08 §9: draft | source_uploaded | normalized | staged.
 */
export function guardInsertStagingRow(batch: ImportBatch): void {
  enforceStatus(batch, PREPARATION_STATES, "insert staging row");
}

/**
 * Guard for runValidation — only in staged or validation_complete.
 * Per TASK 1: validation_in_progress is NOT allowed (concurrent run),
 * post-reconciliation states are NOT allowed.
 */
export function guardRunValidation(batch: ImportBatch): void {
  enforceStatus(batch, VALIDATION_ELIGIBLE_STATES, "run validation");
}

/**
 * Guard for runReconciliation — only in validation_complete,
 * reconciliation_in_progress, or review_required.
 *
 * Per TASK 1.2: must NOT mutate reconciliation evidence while batch is
 * pending_dual_approval, approved_for_commit, committing, committed,
 * rejected, or cancelled. A material change requires first transitioning
 * back to review_required/validation, explicitly invalidating bound approvals.
 */
export function guardRunReconciliation(batch: ImportBatch): void {
  enforceStatus(batch, RECONCILIATION_ELIGIBLE_STATES, "run reconciliation");
}

/**
 * Guard for recordReviewDecision — only in review_required.
 *
 * Per TASK 1.3: must require an existing unresolved review item,
 * the exact current reconciliation/report version, and an appropriate
 * review state. NOT allowed merely because the batch is staged.
 * (Review item existence is checked at the service level.)
 */
export function guardRecordReviewDecision(batch: ImportBatch): void {
  enforceStatus(batch, REVIEW_ELIGIBLE_STATES, "record review decision");
}

/**
 * Guard for recordApproval — only in pending_dual_approval or approved_for_commit.
 *
 * Per TASK 1.1: must NOT accept validation_complete, reconciliation_in_progress,
 * unresolved review_required, preparation states, terminal/committing states.
 * The service must also refuse to store approvals with
 * validationStatus or reconciliationStatus = "unknown".
 */
export function guardRecordApproval(batch: ImportBatch): void {
  enforceStatus(batch, APPROVAL_ELIGIBLE_STATES, "record approval");
}

/**
 * Guard for recordBackupEvidence — only in review_required,
 * pending_dual_approval, or approved_for_commit.
 *
 * Per TASK 1.5: must follow its exact contracted point before submission
 * for approval and remain immutable after commit.
 */
export function guardRecordBackupEvidence(batch: ImportBatch): void {
  enforceStatus(batch, BACKUP_ELIGIBLE_STATES, "record backup evidence");
}

/**
 * Guard for commitBatch — only when approved_for_commit.
 *
 * Per TASK 1.6: must revalidate both current approvals, distinct identities,
 * exact hashes/versions, validation/reconciliation completion, accepted
 * warnings, backup evidence, no blockers. (These additional checks live
 * in the commit service itself.)
 */
export function guardCommitBatch(batch: ImportBatch): void {
  enforceStatus(batch, COMMIT_ELIGIBLE_STATES, "commit batch");
}

/**
 * Check that an approval record's validation/reconciliation status is NOT
 * "unknown". Per TASK 1.1: do not store approvals with validationStatus or
 * reconciliationStatus = "unknown".
 */
export function assertApprovalStatusesBound(
  validationStatus: string | null,
  reconciliationStatus: string | null,
): void {
  if (validationStatus === "unknown" || validationStatus === null) {
    throw new MigrationLifecycleError(
      "<approval>",
      validationStatus ?? "null",
      ["validation_status != 'unknown'"],
      "store approval (validationStatus must be bound)",
    );
  }
  if (reconciliationStatus === "unknown" || reconciliationStatus === null) {
    throw new MigrationLifecycleError(
      "<approval>",
      reconciliationStatus ?? "null",
      ["reconciliation_status != 'unknown'"],
      "store approval (reconciliationStatus must be bound)",
    );
  }
}

/** Re-export predicates' terminal check for service convenience. */
import { TERMINAL_STATES } from "./migration-lifecycle-predicates";

/** Check if batch is in a terminal state (committed/rejected/cancelled). */
export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATES.has(status as never);
}
