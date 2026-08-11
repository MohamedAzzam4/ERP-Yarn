/**
 * WP-08-01F — Shared migration lifecycle guard.
 *
 * Enforces batch lifecycle states inside domain services before
 * any idempotency claim, sequence allocation, audit or write.
 *
 * Contract 08 §8: Historical Migration lifecycle.
 * Contract 10 §9: Historical Migration Screens.
 *
 * This module is called by the WP-07 services themselves —
 * UI predicates are NOT the only protection.
 */
import "server-only";
import type { ImportBatch } from "@/server/db/schema/migration";

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
// Lifecycle state sets
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES = new Set([
  "committed",
  "rejected",
  "cancelled",
]);

const PREPARATION_STATUSES = new Set([
  "draft",
  "source_uploaded",
  "normalized",
  "staged",
]);

const VALIDATION_ELIGIBLE_STATUSES = new Set([
  "staged",
  "validation_complete", // allow re-validation
]);

const RECONCILIATION_ELIGIBLE_STATUSES = new Set([
  "validation_complete",
  "reconciliation_in_progress",
  "review_required",
  "pending_dual_approval",
  "approved_for_commit",
]);

const REVIEW_ELIGIBLE_STATUSES = new Set([
  "staged",
  "validation_complete",
  "reconciliation_in_progress",
  "review_required",
  "pending_dual_approval",
  "approved_for_commit",
]);

const APPROVAL_ELIGIBLE_STATUSES = new Set([
  "validation_complete",
  "reconciliation_in_progress",
  "review_required",
  "pending_dual_approval",
  "approved_for_commit",
]);

const BACKUP_ELIGIBLE_STATUSES = new Set([
  "validation_complete",
  "reconciliation_in_progress",
  "review_required",
  "pending_dual_approval",
  "approved_for_commit",
]);

const COMMIT_ELIGIBLE_STATUSES = new Set([
  "approved_for_commit",
]);

// ---------------------------------------------------------------------------
// Guard functions — each checks batch status before any write
// ---------------------------------------------------------------------------

function enforceStatus(
  batch: ImportBatch,
  allowedStatuses: Set<string>,
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

/** Guard for registerFile — only in preparation states. */
export function guardRegisterFile(batch: ImportBatch): void {
  enforceStatus(batch, PREPARATION_STATUSES, "register file");
}

/** Guard for insertStagingRow — only in preparation states. */
export function guardInsertStagingRow(batch: ImportBatch): void {
  enforceStatus(batch, PREPARATION_STATUSES, "insert staging row");
}

/** Guard for runValidation — only in staged or validation_complete. */
export function guardRunValidation(batch: ImportBatch): void {
  enforceStatus(batch, VALIDATION_ELIGIBLE_STATUSES, "run validation");
}

/** Guard for runReconciliation — only after validation. */
export function guardRunReconciliation(batch: ImportBatch): void {
  enforceStatus(batch, RECONCILIATION_ELIGIBLE_STATUSES, "run reconciliation");
}

/** Guard for recordReviewDecision — in review-eligible states. */
export function guardRecordReviewDecision(batch: ImportBatch): void {
  enforceStatus(batch, REVIEW_ELIGIBLE_STATUSES, "record review decision");
}

/** Guard for recordApproval — in approval-eligible states (non-terminal, non-committing). */
export function guardRecordApproval(batch: ImportBatch): void {
  enforceStatus(batch, APPROVAL_ELIGIBLE_STATUSES, "record approval");
}

/** Guard for recordBackupEvidence — in pre-commit states. */
export function guardRecordBackupEvidence(batch: ImportBatch): void {
  enforceStatus(batch, BACKUP_ELIGIBLE_STATUSES, "record backup evidence");
}

/** Guard for commitBatch — only when approved_for_commit. */
export function guardCommitBatch(batch: ImportBatch): void {
  enforceStatus(batch, COMMIT_ELIGIBLE_STATUSES, "commit batch");
}

/** Check if batch is in a terminal state (committed/rejected/cancelled). */
export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}
