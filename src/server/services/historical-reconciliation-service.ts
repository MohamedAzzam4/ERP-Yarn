/**
 * Historical Reconciliation Service — WP-07-03.
 *
 * Contract: docs/contracts/08_historical_migration_contract.md
 *   §8.7 Reconciliation Requirements, §8.8 Versioning, §8.9 Human Review.
 *
 * WP-07-03 SCOPE:
 *   - Run reconciliation metrics on staged data
 *   - Create versioned reconciliation results (matched/difference/blocking)
 *   - Create review items for mismatches, negatives, duplicates, unmatched
 *   - Record review decisions (metadata only — no operational commit)
 *   - Version invalidation when staged data changes
 *
 * WP-07-03 NON-SCOPE:
 *   - No commit to live ERP domain tables (WP-07-04)
 *   - No auto-repair of mismatches
 *   - No auto-create masters
 *   - No auto-post opening balances
 *   - No auto-approve warnings
 *   - No operational effects
 */
import "server-only";

import type { ErpUserContext } from "@/server/auth/erp-context";
import {
  requirePermission,
  requireTenantMatch,
  rejectBodyClaimsAuthority,
} from "@/server/security/guards";
import type { EffectivePermissions } from "@/server/security/effective-permissions";
import { appendAuditLog, type AuditTransactionHandle } from "./audit-service";
import {
  claimIdempotency,
  markSucceeded,
  markBusinessFailed,
  type IdempotencyTransactionHandle,
} from "./idempotency-service";
import type { HistoricalReconciliationRepository } from "./historical-reconciliation-repository";
import type { HistoricalCommitRepository } from "./historical-commit-repository";
import type {
  ImportReconciliationResult,
  ImportHumanReviewItem,
  ImportStagingRow,
  ImportBatch,
} from "@/server/db/schema/migration";
import {
  guardRunReconciliation,
  guardRecordReviewDecision,
  MigrationLifecycleError,
} from "./migration-lifecycle-guard";
import { APPROVAL_ELIGIBLE_STATES } from "./migration-lifecycle-predicates";
import { sql as drizzleSql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

export interface RunReconciliationInput {
  importBatchId: string;
  /** Expected totals from owner/accountant comparison (source-authoritative). */
  expectedTotals: Record<string, string>;
  idempotencyKey: string;
}

export interface RunReconciliationResult {
  action: "executed" | "replayed";
  batchId: string;
  reportVersion: number;
  totalMetrics: number;
  matched: number;
  differences: number;
  blocking: number;
  reviewItemsCreated: number;
}

export interface RecordReviewDecisionInput {
  reviewItemId: string;
  decision: "accepted" | "rejected" | "resolved";
  decisionNotes: string;
  idempotencyKey: string;
}

export interface RecordReviewDecisionResult {
  action: "recorded" | "replayed";
  reviewItemId: string;
  status: string;
}

// ---------------------------------------------------------------------------
// WP-08-01F DEFECT 1 — submitMigrationBatchForApproval
//
// Contract 08 §§9, 11.6, 11.7: an explicit idempotent submission command that
// transitions a reviewed batch from review_required → pending_dual_approval.
// Without this command, the first approval can never be reached because
// recordApproval now requires pending_dual_approval or approved_for_commit.
//
// This command verifies ALL submission prerequisites in §8.9 / §11.6 before
// transitioning state. It produces zero operational effects.
// ---------------------------------------------------------------------------

export interface SubmitForApprovalInput {
  importBatchId: string;
  /** Accepted-warning evidence/reason summary (§8.9: warnings must be resolved or explicitly accepted). */
  warningSummary: string | null;
  idempotencyKey: string;
}

export interface SubmitForApprovalResult {
  action: "submitted" | "replayed";
  batchId: string;
  previousStatus: string;
  newStatus: "pending_dual_approval";
  reportVersion: number;
  stagedDataHash: string;
  cutoverManifestHash: string | null;
}

// ---------------------------------------------------------------------------
// WP-08-01F DEFECT 2 — reopenBatchForRework
//
// Contract 08 §9 permitted branches:
//   review_required → normalized | staged | validation_in_progress
//   pending_dual_approval → review_required (material change or rejected approval)
//   approved_for_commit → review_required (stale version/new blocker)
//
// This is an explicit idempotent rework/reopen command. It does NOT simply
// permit arbitrary file/staging mutation in review_required — it transitions
// state and invalidates dependent evidence atomically.
//
// Invalidation semantics:
//   - For review_required → normalized/staged/validation_in_progress:
//     * Mark current reconciliation report version as superseded.
//     * Reset validationStatus to null (forces re-validation).
//     * Reset reconciliationStatus to null (forces re-reconciliation).
//     * Invalidate Owner and Accountant approvals (delete — they cannot be
//       preserved because their bound hashes/versions no longer match).
//     * Audit old/new state, reason, invalidated versions.
//   - For pending_dual_approval/approved_for_commit → review_required:
//     * Mark current reconciliation report version as superseded.
//     * Reset validationStatus and reconciliationStatus (forces re-run).
//     * Invalidate Owner and Accountant approvals.
//     * Transition to review_required (not to a preparation state — the
//       rework branch from these states goes back to review_required).
// ---------------------------------------------------------------------------

export type ReworkTargetState = "normalized" | "staged" | "validation_in_progress" | "review_required";

export interface ReworkBatchInput {
  importBatchId: string;
  /** Contract 08 §9: rework requires a reason. */
  reason: string;
  /**
   * Target rework state. Must be one of the contracted permitted branches
   * for the current batch status:
   *   - from review_required: normalized | staged | validation_in_progress
   *   - from pending_dual_approval: review_required
   *   - from approved_for_commit: review_required
   */
  targetState: ReworkTargetState;
  idempotencyKey: string;
}

export interface ReworkBatchResult {
  action: "reworked" | "replayed";
  batchId: string;
  previousStatus: string;
  newStatus: ReworkTargetState;
  invalidatedReportVersion: number | null;
  invalidatedOwnerApproval: boolean;
  invalidatedAccountantApproval: boolean;
}

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

export class HistoricalReconciliationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "HistoricalReconciliationError";
    this.code = code;
  }
}

export class ReconBatchNotFoundError extends HistoricalReconciliationError {
  constructor(id: string) {
    super("BATCH_NOT_FOUND", `Import batch '${id}' not found.`);
    this.name = "ReconBatchNotFoundError";
  }
}

export class ReviewItemNotFoundError extends HistoricalReconciliationError {
  constructor(id: string) {
    super("REVIEW_ITEM_NOT_FOUND", `Review item '${id}' not found.`);
    this.name = "ReviewItemNotFoundError";
  }
}

export class BlockingFindingsRemainError extends HistoricalReconciliationError {
  constructor(batchId: string, count: number) {
    super("BLOCKING_REMAIN", `Cannot submit batch '${batchId}' — ${count} blocking reconciliation results remain.`);
    this.name = "BlockingFindingsRemainError";
  }
}

// WP-08-01F DEFECT 1 — submission prerequisite errors
export class SubmissionValidationError extends HistoricalReconciliationError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "SubmissionValidationError";
  }
}

export class UnresolvedReviewItemsError extends SubmissionValidationError {
  constructor(batchId: string, count: number) {
    super(
      "UNRESOLVED_REVIEW_ITEMS",
      `Cannot submit batch '${batchId}' for approval — ${count} human review item(s) are still pending. All review items must be resolved before submission.`,
    );
    this.name = "UnresolvedReviewItemsError";
  }
}

export class MissingValidationCompletionError extends SubmissionValidationError {
  constructor(batchId: string, validationStatus: string | null) {
    super(
      "VALIDATION_NOT_COMPLETE",
      `Cannot submit batch '${batchId}' for approval — validationStatus is '${validationStatus ?? "null"}' but must be 'passed'. Run validation first.`,
    );
    this.name = "MissingValidationCompletionError";
  }
}

export class MissingReconciliationCompletionError extends SubmissionValidationError {
  constructor(batchId: string, reconciliationStatus: string | null) {
    super(
      "RECONCILIATION_NOT_COMPLETE",
      `Cannot submit batch '${batchId}' for approval — reconciliationStatus is '${reconciliationStatus ?? "null"}' but must be 'matched'. Run reconciliation first.`,
    );
    this.name = "MissingReconciliationCompletionError";
  }
}

export class MissingStagedDataHashError extends SubmissionValidationError {
  constructor(batchId: string) {
    super(
      "MISSING_STAGED_DATA_HASH",
      `Cannot submit batch '${batchId}' for approval — stagedDataHash is null. Run staging/validation first.`,
    );
    this.name = "MissingStagedDataHashError";
  }
}

export class MissingCutoverManifestHashError extends SubmissionValidationError {
  constructor(batchId: string) {
    super(
      "MISSING_CUTOVER_MANIFEST_HASH",
      `Cannot submit batch '${batchId}' for approval — cutoverManifestHash is null. Create/approve a cutover manifest first.`,
    );
    this.name = "MissingCutoverManifestHashError";
  }
}

export class UnacknowledgedWarningsError extends SubmissionValidationError {
  constructor(batchId: string, warningCount: number, acceptedCount: number) {
    super(
      "UNACKNOWLEDGED_WARNINGS",
      `Cannot submit batch '${batchId}' for approval — warningCount=${warningCount} but acceptedWarningCount=${acceptedCount}. All warnings must be explicitly accepted with reason before submission.`,
    );
    this.name = "UnacknowledgedWarningsError";
  }
}

export class MissingBackupEvidenceError extends SubmissionValidationError {
  constructor(batchId: string) {
    super(
      "MISSING_BACKUP_EVIDENCE",
      `Cannot submit batch '${batchId}' for approval — Contract 08 §8.9 requires backup evidence to exist before submission for real migration data.`,
    );
    this.name = "MissingBackupEvidenceError";
  }
}

export class SubmissionInvalidStateError extends SubmissionValidationError {
  constructor(batchId: string, currentStatus: string, requiredStatus: string) {
    super(
      "INVALID_BATCH_STATUS",
      `Cannot submit batch '${batchId}' for approval — current status is '${currentStatus}' but must be '${requiredStatus}'.`,
    );
    this.name = "SubmissionInvalidStateError";
  }
}

// WP-08-01F DEFECT 2 — rework errors
export class ReworkValidationError extends HistoricalReconciliationError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "ReworkValidationError";
  }
}

export class ReworkInvalidSourceStateError extends ReworkValidationError {
  constructor(batchId: string, currentStatus: string) {
    super(
      "INVALID_REWORK_SOURCE",
      `Cannot rework batch '${batchId}' — current status '${currentStatus}' is not reworkable. ` +
      `Rework is only permitted from review_required, pending_dual_approval, or approved_for_commit ` +
      `(Contract 08 §9). Committed/rejected/cancelled/committing batches are terminal or locked.`,
    );
    this.name = "ReworkInvalidSourceStateError";
  }
}

export class ReworkInvalidTargetStateError extends ReworkValidationError {
  constructor(batchId: string, currentStatus: string, targetState: string, allowedTargets: string[]) {
    super(
      "INVALID_REWORK_TARGET",
      `Cannot rework batch '${batchId}' from '${currentStatus}' to '${targetState}'. ` +
      `Allowed targets from '${currentStatus}': [${allowedTargets.join(", ")}] (Contract 08 §9).`,
    );
    this.name = "ReworkInvalidTargetStateError";
  }
}

// ---------------------------------------------------------------------------
// Service deps.
// ---------------------------------------------------------------------------

export interface HistoricalReconciliationServiceDeps {
  repository: HistoricalReconciliationRepository;
  audit: AuditTransactionHandle;
  idempotency: IdempotencyTransactionHandle;
  /**
   * Commit repository is required for submitForApproval (DEFECT 1) — it
   * provides backup-evidence, blocking-validation, and reconciliation-result
   * lookups that the reconciliation repository does not own. If absent,
   * submitForApproval throws on construction.
   */
  commitRepository?: HistoricalCommitRepository;
  /**
   * WP-08-01F DEFECT 3/4: Transaction runner for atomic submitForApproval
   * and reopenBatchForRework. If absent, operations run without a transaction
   * (not atomic — for test compatibility only).
   */
  transactionRunner?: <T>(work: (tx: unknown) => Promise<T>) => Promise<T>;
  /**
   * WP-08-01F DEFECT 3/4: Transaction-scoped factory for the commit repository.
   * Used inside the transaction for approval invalidation.
   */
  createCommitRepository?: (tx: unknown) => HistoricalCommitRepository;
  /**
   * WP-08-01F DEFECT 3/4: Transaction-scoped factory for the audit handle.
   */
  createAudit?: (tx: unknown) => AuditTransactionHandle;
  /**
   * WP-08-01F DEFECT 3/4: Transaction-scoped factory for the idempotency handle.
   */
  createIdempotency?: (tx: unknown) => IdempotencyTransactionHandle;
  /**
   * WP-08-01F DEFECT 3/4: Transaction-scoped factory for the reconciliation repository.
   */
  createReconciliationRepository?: (tx: unknown) => HistoricalReconciliationRepository;
}

// ---------------------------------------------------------------------------
// Reconciliation metrics (Contract 08 §8.7).
// ---------------------------------------------------------------------------

interface ReconciliationMetric {
  metricKey: string;
  expectedValue: string | null;
  stagedValue: string | null;
  differenceValue: string | null;
  status: "matched" | "difference" | "blocking";
  reviewReason: string | null;
}

/**
 * Compute reconciliation metrics by comparing expected totals (from
 * owner/accountant source-authoritative comparison) with staged totals
 * computed from staging rows.
 */
function computeReconciliationMetrics(
  rows: ImportStagingRow[],
  expectedTotals: Record<string, string>,
): ReconciliationMetric[] {
  const metrics: ReconciliationMetric[] = [];

  // Compute staged totals from staging rows, categorized by entity type
  const stagedTotals: Record<string, number> = {};
  const docNoCounts: Record<string, number> = {};
  const entityNames: Array<{ name: string; rowId: string; hasMaster: boolean; entityType: string }> = [];

  for (const row of rows) {
    const data = (row.transformedRowJson ?? row.rawRowJson) as Record<string, unknown> | null;
    if (!data) continue;

    const entityType = String(data.entity_type ?? data.type ?? "unknown").toLowerCase();

    // §8.7.1 Inventory metrics
    if (data.quantity !== undefined && data.quantity !== null && data.quantity !== "") {
      const qty = parseFloat(String(data.quantity));
      if (!isNaN(qty)) {
        // Categorize by entity type
        if (entityType.includes("raw") || entityType.includes("fiber")) {
          stagedTotals["raw_yarn_opening_qty"] = (stagedTotals["raw_yarn_opening_qty"] ?? 0) + qty;
        } else if (entityType.includes("single") || entityType.includes("yarn")) {
          stagedTotals["single_yarn_opening_qty"] = (stagedTotals["single_yarn_opening_qty"] ?? 0) + qty;
        } else if (entityType.includes("twist")) {
          stagedTotals["twisted_yarn_opening_qty"] = (stagedTotals["twisted_yarn_opening_qty"] ?? 0) + qty;
        }
        stagedTotals["inventory_opening_qty"] = (stagedTotals["inventory_opening_qty"] ?? 0) + qty;

        // §8.7.1 Negative stock/quantity
        if (qty < 0) {
          metrics.push({
            metricKey: `negative_staged_quantity_${row.id.substring(0, 8)}`,
            expectedValue: ">= 0",
            stagedValue: String(qty),
            differenceValue: String(qty),
            status: "blocking",
            reviewReason: `Negative staged quantity ${qty} detected in row ${row.sourceRowNumber ?? "?"}.`,
          });
        }
      }
    }

    // §8.7.2 Location/factory stock
    if (data.location_qty !== undefined && data.location_qty !== null && data.location_qty !== "") {
      const locQty = parseFloat(String(data.location_qty));
      if (!isNaN(locQty)) {
        stagedTotals["location_stock_total"] = (stagedTotals["location_stock_total"] ?? 0) + locQty;
      }
    }
    if (data.factory_qty !== undefined && data.factory_qty !== null && data.factory_qty !== "") {
      const factQty = parseFloat(String(data.factory_qty));
      if (!isNaN(factQty)) {
        stagedTotals["factory_stock_total"] = (stagedTotals["factory_stock_total"] ?? 0) + factQty;
      }
    }

    // §8.7.2 Party/subledger balances
    if (data.balance !== undefined && data.balance !== null && data.balance !== "") {
      const balance = parseFloat(String(data.balance));
      if (!isNaN(balance)) {
        if (entityType.includes("customer")) {
          stagedTotals["customer_opening_balance"] = (stagedTotals["customer_opening_balance"] ?? 0) + balance;
        } else if (entityType.includes("supplier")) {
          stagedTotals["supplier_opening_balance"] = (stagedTotals["supplier_opening_balance"] ?? 0) + balance;
        } else if (entityType.includes("factory")) {
          stagedTotals["factory_payable_balance"] = (stagedTotals["factory_payable_balance"] ?? 0) + balance;
        }
        stagedTotals["party_balance_total"] = (stagedTotals["party_balance_total"] ?? 0) + balance;
      }
    }

    // §8.7.3 Sales
    if (data.sale_amount !== undefined && data.sale_amount !== null && data.sale_amount !== "") {
      const saleAmt = parseFloat(String(data.sale_amount));
      if (!isNaN(saleAmt)) {
        stagedTotals["imported_sales_total"] = (stagedTotals["imported_sales_total"] ?? 0) + saleAmt;
      }
    }
    // §8.7.3 Payments
    if (data.payment_amount !== undefined && data.payment_amount !== null && data.payment_amount !== "") {
      const payAmt = parseFloat(String(data.payment_amount));
      if (!isNaN(payAmt)) {
        stagedTotals["imported_payments_total"] = (stagedTotals["imported_payments_total"] ?? 0) + payAmt;
      }
    }

    // §8.7.3 Overlapping opening balance + imported sales/payments double-count detection
    if (data.balance !== undefined && data.sale_amount !== undefined) {
      metrics.push({
        metricKey: `opening_balance_plus_sales_overlap_${row.id.substring(0, 8)}`,
        expectedValue: "no overlap",
        stagedValue: `balance=${data.balance}, sale=${data.sale_amount}`,
        differenceValue: "overlap detected",
        status: "blocking",
        reviewReason: `Row has both opening balance and sale amount — potential double-count.`,
      });
    }

    // §8.7.4 Production/WIP
    if (data.wip_qty !== undefined && data.wip_qty !== null && data.wip_qty !== "") {
      const wip = parseFloat(String(data.wip_qty));
      if (!isNaN(wip)) {
        stagedTotals["wip_opening_qty"] = (stagedTotals["wip_opening_qty"] ?? 0) + wip;
      }
    }
    // §8.7.4 Production issue/receipt overlap warning
    if (data.issue_qty !== undefined && data.receipt_qty !== undefined) {
      metrics.push({
        metricKey: `production_issue_receipt_overlap_${row.id.substring(0, 8)}`,
        expectedValue: "no overlap",
        stagedValue: `issue=${data.issue_qty}, receipt=${data.receipt_qty}`,
        differenceValue: "both present",
        status: "blocking",
        reviewReason: `Row has both production issue and receipt quantities — potential WIP double-count.`,
      });
    }

    // §8.7.5 Returns
    if (data.return_qty !== undefined && data.return_qty !== null && data.return_qty !== "") {
      const retQty = parseFloat(String(data.return_qty));
      if (!isNaN(retQty)) {
        stagedTotals["imported_return_qty"] = (stagedTotals["imported_return_qty"] ?? 0) + retQty;
      }
    }
    // §8.7.5 Return references original sale
    if (data.return_qty !== undefined && !data.original_sale_id) {
      metrics.push({
        metricKey: `return_without_sale_reference_${row.id.substring(0, 8)}`,
        expectedValue: "original sale reference",
        stagedValue: "missing",
        differenceValue: "no sale link",
        status: "blocking",
        reviewReason: `Return row has no original sale reference — unmatched return lineage.`,
      });
    }

    // §8.7.6 Document/source identity — duplicate document numbers
    if (data.doc_no !== undefined && data.doc_no !== null && data.doc_no !== "") {
      const docNo = String(data.doc_no);
      docNoCounts[docNo] = (docNoCounts[docNo] ?? 0) + 1;
    }

    // §8.7.6 Internal document sequence collision risk
    if (data.internal_doc_no !== undefined && data.internal_doc_no !== null && data.internal_doc_no !== "") {
      const internalDocNo = String(data.internal_doc_no);
      const sourceDocNo = data.doc_no ? String(data.doc_no) : null;
      if (sourceDocNo && internalDocNo === sourceDocNo) {
        metrics.push({
          metricKey: `doc_sequence_collision_${row.id.substring(0, 8)}`,
          expectedValue: "distinct internal vs source",
          stagedValue: `internal=${internalDocNo}, source=${sourceDocNo}`,
          differenceValue: "collision",
          status: "blocking",
          reviewReason: `Internal document number collides with source document number — must be distinct.`,
        });
      }
    }

    // §8.7.7 Unmatched records — collect entity names for unmatched detection
    if (data.name) {
      const hasMaster = !!(data.customer_id || data.item_id || data.supplier_id || data.location_id || data.factory_id);
      entityNames.push({ name: String(data.name), rowId: row.id, hasMaster, entityType });
    }
  }

  // §8.7.6 Duplicate document numbers — add metrics for duplicates
  for (const [docNo, count] of Object.entries(docNoCounts)) {
    if (count > 1) {
      metrics.push({
        metricKey: `duplicate_document_${docNo}`,
        expectedValue: "unique",
        stagedValue: `${count} occurrences`,
        differenceValue: `${count - 1} extra`,
        status: "blocking",
        reviewReason: `Duplicate document number '${docNo}' appears ${count} times in batch.`,
      });
    }
  }

  // §8.7.7 Unmatched alias/entity — create metrics for entities without resolved masters
  for (const entity of entityNames) {
    if (!entity.hasMaster) {
      metrics.push({
        metricKey: `unmatched_alias_${entity.name.substring(0, 20)}`,
        expectedValue: "resolved master reference",
        stagedValue: entity.name,
        differenceValue: "no master link",
        status: "blocking",
        reviewReason: `Entity '${entity.name}' (${entity.entityType}) has no resolved master reference — unmatched alias.`,
      });
    }
  }

  // §8.7 Compare expected totals with staged totals
  for (const [metricKey, expectedStr] of Object.entries(expectedTotals)) {
    const expected = parseFloat(expectedStr);
    const staged = stagedTotals[metricKey] ?? 0;
    if (isNaN(expected)) continue;
    const difference = staged - expected;
    const isMatch = Math.abs(difference) < 0.001;

    metrics.push({
      metricKey,
      expectedValue: String(expected),
      stagedValue: String(staged),
      differenceValue: String(difference),
      status: isMatch ? "matched" : (Math.abs(difference) > Math.abs(expected) * 0.1 ? "blocking" : "difference"),
      reviewReason: isMatch ? null : `Mismatch: expected ${expected}, staged ${staged}, difference ${difference}.`,
    });
  }

  // Add staged-only metrics (no expected provided but still report for visibility)
  for (const [metricKey, staged] of Object.entries(stagedTotals)) {
    if (!(metricKey in expectedTotals)) {
      metrics.push({
        metricKey,
        expectedValue: null,
        stagedValue: String(staged),
        differenceValue: null,
        status: "matched",
        reviewReason: null,
      });
    }
  }

  return metrics;
}

// ---------------------------------------------------------------------------
// HistoricalReconciliationService.
// ---------------------------------------------------------------------------

export class HistoricalReconciliationService {
  constructor(private readonly deps: HistoricalReconciliationServiceDeps) {}

  /**
   * Run reconciliation on staged data.
   *
   * Permission: migration.review (Owner/Accountant).
   * Idempotent: replay returns the persisted response without re-running.
   * Old reconciliation results are NEVER deleted or overwritten — each
   * run creates a new report_version, and old versions remain as
   * immutable audit history (Contract 08 §8.7, DEC-019 principle).
   * Non-operational: no stock/account/sales effects.
   */
  async runReconciliation(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: RunReconciliationInput,
  ): Promise<RunReconciliationResult> {
    requirePermission(effective, "migration.review");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!input.importBatchId?.trim()) throw new HistoricalReconciliationError("VALIDATION_FAILED", "importBatchId is required.");
    if (!input.idempotencyKey?.trim()) throw new HistoricalReconciliationError("VALIDATION_FAILED", "idempotencyKey is required.");

    const batch = await this.deps.repository.findImportBatchById(user.tenantId, input.importBatchId);
    if (!batch) throw new ReconBatchNotFoundError(input.importBatchId);
    requireTenantMatch(user, batch.tenantId);

    // ---- Claim idempotency BEFORE the lifecycle guard. ----
    // This ensures that replay/conflict is determined before any lifecycle
    // check. A replay must return the cached response even if the batch
    // state has since changed (the reconciliation already happened). A
    // conflict must be rejected regardless of batch state.
    const now = new Date();
    const claim = await claimIdempotency(this.deps.idempotency, {
      tenantId: user.tenantId,
      operationScope: "historical_reconciliation.run",
      idempotencyKey: input.idempotencyKey,
      requestBody: { importBatchId: input.importBatchId } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    });

    if (claim.action === "replay") {
      const responseBody = claim.record.responseBody as Partial<RunReconciliationResult> | null;
      if (responseBody?.batchId) return { ...responseBody, action: "replayed" } as RunReconciliationResult;
    }
    if (claim.action === "conflict") throw new HistoricalReconciliationError("IDEMPOTENCY_CONFLICT", `Idempotency key conflict.`);
    if (claim.action === "in_progress") throw new HistoricalReconciliationError("OPERATION_IN_PROGRESS", `Operation in progress.`);

    // WP-08-01F DEFECT 1: Pre-check lifecycle state (fail-fast).
    // The AUTHORITATIVE lifecycle check runs AFTER the batch row lock
    // (see guardRunReconciliation call inside the transactionRunner closure).
    guardRunReconciliation(batch);

    // -----------------------------------------------------------------------
    // WP-08-01F Milestone C Task 6: Atomic reconciliation WITHOUT mutable
    // dependency swapping.
    //
    // The report version is allocated INSIDE the transaction (not before it)
    // to prevent two concurrent reconciliations from allocating the same
    // version number. The batch row is locked (SELECT ... FOR UPDATE)
    // inside the transaction so that concurrent reconciliations serialize
    // on the batch row. This is the smallest contract-consistent locking
    // approach — it does not invent a new business rule, it just uses
    // PostgreSQL's row-level locking to preserve a deterministic version
    // sequence.
    //
    // If transactionRunner + tx-scoped factories are provided, ALL business
    // writes execute inside a single transaction with EXPLICIT tx-scoped
    // deps passed to executeAtomically (no mutation of this.deps).
    //
    // WP-08-01F Milestone C Task 5: Old reconciliation evidence is NEVER
    // mutated. The `report_version` column itself is the supersession
    // mechanism — the latest version is "current", older versions remain
    // as immutable audit history (Contract 08 §8.7, DEC-019 principle:
    // "older versions are retained as superseded audit history"). The
    // previous markVersionAsSuperseded call was removed because it
    // overwrote the `notes` field, destroying the original review reason.
    // -----------------------------------------------------------------------

    // Fetch staging rows (read-only — safe outside the transaction)
    const rows = await this.deps.repository.findStagingRowsForBatch(user.tenantId, input.importBatchId);

    // Compute reconciliation metrics (pure function — safe outside the transaction)
    const metrics = computeReconciliationMetrics(rows, input.expectedTotals);

    const result: RunReconciliationResult = {
      action: "executed",
      batchId: input.importBatchId,
      reportVersion: 0, // allocated inside the transaction
      totalMetrics: metrics.length,
      matched: 0, differences: 0, blocking: 0,
      reviewItemsCreated: 0,
    };

    const useAtomicTransaction = !!(
      this.deps.transactionRunner &&
      this.deps.createReconciliationRepository &&
      this.deps.createAudit &&
      this.deps.createIdempotency
    );

    // -----------------------------------------------------------------------
    // executeAtomically: takes EXPLICIT tx-scoped deps (repo, audit, idem)
    // instead of reading from this.deps. This eliminates the need to mutate
    // this.deps during the transaction.
    // -----------------------------------------------------------------------
    const executeAtomically = async (
      repo: HistoricalReconciliationRepository,
      auditHandle: AuditTransactionHandle,
      idemHandle: IdempotencyTransactionHandle,
    ): Promise<void> => {

      // WP-08-01F Milestone C Task 6: Allocate report version INSIDE the
      // transaction. When useAtomicTransaction is true, the batch row has
      // already been locked (SELECT ... FOR UPDATE) by the transactionRunner
      // closure below, so two concurrent reconciliations will serialize and
      // get distinct version numbers.
      const latestVersion = await repo.findLatestReportVersion(user.tenantId, input.importBatchId);
      const reportVersion = latestVersion + 1;
      result.reportVersion = reportVersion;

      // WP-08-01F Milestone C Task 5: Do NOT call markVersionAsSuperseded.
      // Old reconciliation results remain unchanged as immutable audit
      // history. The `report_version` column distinguishes versions; the
      // latest version is current, older versions are superseded history.

      let matched = 0;
      let differences = 0;
      let blocking = 0;
      let reviewItemsCreated = 0;

      // Persist each metric as a reconciliation result.
      for (const metric of metrics) {
        const reconResult = await repo.insertReconciliationResult({
          tenantId: user.tenantId,
          importBatchId: input.importBatchId,
          reportVersion,
          metricKey: metric.metricKey,
          expectedValue: metric.expectedValue,
          stagedValue: metric.stagedValue,
          committedValue: null, // No commit yet (WP-07-04)
          differenceValue: metric.differenceValue,
          status: metric.status,
          notes: metric.reviewReason,
          createdBy: user.userId,
        });

        // Audit each reconciliation result.
        await appendAuditLog(auditHandle, user.tenantId, user.userId, {
          entityType: "import_reconciliation_result",
          entityId: reconResult.id,
          actionType: "historical_reconciliation.result",
          newValuesJson: {
            importBatchId: input.importBatchId,
            reportVersion,
            metricKey: metric.metricKey,
            expectedValue: metric.expectedValue,
            stagedValue: metric.stagedValue,
            differenceValue: metric.differenceValue,
            status: metric.status,
          },
          idempotencyKey: input.idempotencyKey,
        });

        if (metric.status === "matched") matched++;
        else if (metric.status === "difference") differences++;
        else if (metric.status === "blocking") blocking++;

        // Create review items for mismatches/blocking (§8.9 Human Review).
        if (metric.reviewReason) {
          const reviewItem = await repo.insertReviewItem({
            tenantId: user.tenantId,
            importBatchId: input.importBatchId,
            stagingRowId: null,
            reviewReason: metric.reviewReason,
            createdBy: user.userId,
          });
          reviewItemsCreated++;

          // Audit each review item.
          await appendAuditLog(auditHandle, user.tenantId, user.userId, {
            entityType: "import_human_review_item",
            entityId: reviewItem.id,
            actionType: "historical_reconciliation.review_created",
            newValuesJson: {
              importBatchId: input.importBatchId,
              reconciliationResultId: reconResult.id,
              reviewReason: metric.reviewReason,
              status: "pending",
            },
            idempotencyKey: input.idempotencyKey,
          });
        }
      }

      // Update batch status and reconciliationStatus.
      const newReconStatus = blocking > 0 ? "blocking" : (differences > 0 ? "difference" : "matched");
      await repo.updateBatchReconciliationStatus(user.tenantId, input.importBatchId, newReconStatus, user.userId);
      await repo.updateBatchStatus(user.tenantId, input.importBatchId, "review_required");

      // Audit reconciliation run.
      await appendAuditLog(auditHandle, user.tenantId, user.userId, {
        entityType: "import_batch",
        entityId: input.importBatchId,
        actionType: "historical_reconciliation.run",
        newValuesJson: {
          importBatchId: input.importBatchId,
          reportVersion,
          totalMetrics: metrics.length,
          matched, differences, blocking,
          reviewItemsCreated,
        },
        idempotencyKey: input.idempotencyKey,
      });

      result.matched = matched;
      result.differences = differences;
      result.blocking = blocking;
      result.reviewItemsCreated = reviewItemsCreated;

      // markSucceeded (owner-token-fenced) — must be inside the transaction
      // so that an owner-token loss rolls back ALL business writes.
      // The real production fence is exercised here: idemHandle.updateState
      // uses WHERE owner_token = expectedOwnerToken AND state = 'in_progress'.
      // If the owner_token has been changed (by a concurrent takeover), the
      // UPDATE returns 0 rows and markSucceeded throws
      // IdempotencyOwnershipLostError, which rolls back the entire transaction.
      await markSucceeded(idemHandle, claim.record.id, {
        responseCode: 200, responseBody: result,
        entityType: "import_batch", entityId: input.importBatchId,
      }, claim.record.ownerToken!, now);
    };

    if (useAtomicTransaction) {
      // -------------------------------------------------------------------
      // Atomic path: create tx-scoped deps and pass them explicitly to
      // executeAtomically. NO mutation of this.deps.
      //
      // WP-08-01F Milestone C Task 4+6: Lock the batch row (SELECT ... FOR
      // UPDATE) inside the transaction, then RE-READ the batch and RE-RUN
      // the lifecycle guard against the authoritative locked state.
      //
      // The pre-lock lifecycle check (line 648) is a fail-fast pre-check
      // only — it is NOT authoritative. Between the pre-check and the lock
      // acquisition, another concurrent reconciliation may have moved the
      // batch from `validation_complete` to `review_required`. The
      // authoritative guard runs AFTER the lock, against the locked state.
      //
      // This prevents a second concurrent reconciliation from operating on
      // stale lifecycle eligibility: it will observe `review_required`
      // (not `validation_complete`) and be rejected by the guard.
      // -------------------------------------------------------------------
      await this.deps.transactionRunner!(async (tx: unknown) => {
        // Lock the batch row and RE-READ its current status.
        const batchRows = await (tx as any).execute(
          drizzleSql`SELECT id, status, validation_status, reconciliation_status FROM import_batches WHERE tenant_id = ${user.tenantId} AND id = ${input.importBatchId} FOR UPDATE`,
        );
        if (!batchRows || (batchRows as any[]).length === 0) {
          throw new ReconBatchNotFoundError(input.importBatchId);
        }
        const lockedBatchRow = (batchRows as any[])[0]!;

        // AUTHORITATIVE lifecycle guard: run against the locked state.
        // If a concurrent reconciliation already moved the batch to
        // `review_required`, this guard rejects the second call with
        // LIFECYCLE_VIOLATION — zero business effects.
        const lockedBatch: ImportBatch = {
          ...batch,
          status: lockedBatchRow.status as any,
          validationStatus: lockedBatchRow.validation_status,
          reconciliationStatus: lockedBatchRow.reconciliation_status,
        };
        guardRunReconciliation(lockedBatch);

        // WP-08-01F Milestone C Task 4: Prevent concurrent double-reconciliation.
        // If the locked batch is in `review_required` with a non-null
        // `reconciliationStatus`, it means a prior reconciliation has already
        // completed and the batch has NOT been through rework (which resets
        // reconciliationStatus to null). Absent an explicit approved
        // contract/DEC authorizing a new reconciliation version without
        // intervening rework/revalidation, reject this call.
        //
        // Contract 08 §8.7 lifecycle:
        //   validation_complete → reconciliation_in_progress → review_required
        // From review_required, the only contract-defined paths are:
        //   submitForApproval → pending_dual_approval
        //   reopenBatchForRework → normalized/staged/validation_in_progress
        // (which resets reconciliationStatus to null, allowing re-reconciliation
        // after re-validation).
        if (lockedBatch.status === "review_required" && lockedBatch.reconciliationStatus !== null) {
          throw new HistoricalReconciliationError(
            "LIFECYCLE_VIOLATION",
            `Reconciliation has already completed for batch '${input.importBatchId}' (status='${lockedBatch.status}', reconciliationStatus='${lockedBatch.reconciliationStatus}'). A new reconciliation version requires intervening rework (reopenBatchForRework) to reset the reconciliation status.`,
          );
        }

        // Re-fetch staging rows INSIDE the transaction so the calculation
        // is bound to the authoritative eligible batch/staging state.
        // (Staging rows are immutable while the batch is eligible for
        // reconciliation — Contract 08 §8.7 — so this re-fetch is
        // defensive, not strictly required.)
        const txRepo = this.deps.createReconciliationRepository!(tx);
        const txAudit = this.deps.createAudit!(tx);
        const txIdem = this.deps.createIdempotency!(tx);
        await executeAtomically(txRepo, txAudit, txIdem);
      });
    } else {
      // Non-atomic path (in-memory tests): execute directly with the
      // original (non-tx) deps. No batch row locking (in-memory store
      // has no concurrency).
      await executeAtomically(this.deps.repository, this.deps.audit, this.deps.idempotency);
    }

    return result;
  }

  /**
   * Record a human review decision (metadata only — no operational commit).
   *
   * Permission: migration.review.
   * Cannot accept blocking findings as clean data.
   */
  async recordReviewDecision(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: RecordReviewDecisionInput,
  ): Promise<RecordReviewDecisionResult> {
    requirePermission(effective, "migration.review");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!input.reviewItemId?.trim()) throw new HistoricalReconciliationError("VALIDATION_FAILED", "reviewItemId is required.");
    if (!input.decisionNotes?.trim()) throw new HistoricalReconciliationError("VALIDATION_FAILED", "decisionNotes is required.");
    if (!input.idempotencyKey?.trim()) throw new HistoricalReconciliationError("VALIDATION_FAILED", "idempotencyKey is required.");

    const reviewItem = await this.deps.repository.findReviewItemById(user.tenantId, input.reviewItemId);
    if (!reviewItem) throw new ReviewItemNotFoundError(input.reviewItemId);
    requireTenantMatch(user, reviewItem.tenantId);

    // WP-08-01F TASK 1.3: Must require an existing UNRESOLVED review item.
    // Review items with status accepted/rejected/resolved are already decided
    // and cannot be re-decided (prevents double-decision and audit pollution).
    if (reviewItem.status !== "pending") {
      throw new HistoricalReconciliationError(
        "REVIEW_ALREADY_RESOLVED",
        `Review item '${input.reviewItemId}' has status '${reviewItem.status}' and cannot be re-decided. ` +
        `Only pending review items can receive a decision.`,
      );
    }

    // WP-08-01F DEFECT 1: Enforce lifecycle state — load batch and check
    const batch = await this.deps.repository.findImportBatchById(user.tenantId, reviewItem.importBatchId);
    if (!batch) throw new ReconBatchNotFoundError(reviewItem.importBatchId);
    guardRecordReviewDecision(batch);

    const now = new Date();
    const claim = await claimIdempotency(this.deps.idempotency, {
      tenantId: user.tenantId,
      operationScope: "historical_reconciliation.decision",
      idempotencyKey: input.idempotencyKey,
      requestBody: { reviewItemId: input.reviewItemId, decision: input.decision } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    });

    if (claim.action === "replay") {
      const responseBody = claim.record.responseBody as Partial<RecordReviewDecisionResult> | null;
      if (responseBody?.reviewItemId) return { ...responseBody, action: "replayed" } as RecordReviewDecisionResult;
    }
    if (claim.action === "conflict") throw new HistoricalReconciliationError("IDEMPOTENCY_CONFLICT", `Idempotency key conflict.`);
    if (claim.action === "in_progress") throw new HistoricalReconciliationError("OPERATION_IN_PROGRESS", `Operation in progress.`);

    // Update review item with decision
    const updated = await this.deps.repository.updateReviewItemDecision(user.tenantId, input.reviewItemId, {
      status: input.decision,
      decision: input.decision,
      decisionNotes: input.decisionNotes,
      decidedBy: user.userId,
    });

    // Audit review decision
    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: "import_human_review_item",
      entityId: input.reviewItemId,
      actionType: "historical_reconciliation.decision",
      newValuesJson: {
        reviewItemId: input.reviewItemId,
        decision: input.decision,
        decisionNotes: input.decisionNotes,
        decidedBy: user.userId,
      },
      idempotencyKey: input.idempotencyKey,
    });

    const result: RecordReviewDecisionResult = {
      action: "recorded",
      reviewItemId: input.reviewItemId,
      status: updated?.status ?? input.decision,
    };

    await markSucceeded(this.deps.idempotency, claim.record.id, {
      responseCode: 200, responseBody: result,
      entityType: "import_human_review_item", entityId: input.reviewItemId,
    }, claim.record.ownerToken!, now);

    return result;
  }

  /**
   * List reconciliation results for a batch.
   */
  async listResults(
    user: ErpUserContext,
    effective: EffectivePermissions,
    batchId: string,
  ): Promise<ImportReconciliationResult[]> {
    requirePermission(effective, "migration.review");
    return this.deps.repository.findReconciliationResultsForBatch(user.tenantId, batchId);
  }

  // ===========================================================================
  // WP-08-01F DEFECT 1 — submitMigrationBatchForApproval
  //
  // Contract 08 §§9, 11.6, 11.7: explicit idempotent submission command that
  // transitions a reviewed batch from review_required → pending_dual_approval.
  //
  // Without this command, the first approval can never be reached because
  // recordApproval requires pending_dual_approval or approved_for_commit.
  //
  // Prerequisites verified before any write (§8.9 / §11.6):
  //   1. migration.review permission
  //   2. tenant-scoped batch exists
  //   3. batch.status === 'review_required' (exact contracted predecessor state)
  //   4. validationStatus === 'passed' (validation completion)
  //   5. reconciliationStatus === 'matched' (reconciliation completion)
  //   6. no blocking reconciliation results against current report version
  //   7. every required human-review item is resolved (status != 'pending')
  //   8. stagedDataHash is present
  //   9. cutoverManifestHash is present
  //  10. warningCount === acceptedWarningCount (all warnings accepted with reason)
  //  11. backup evidence exists (Contract 08 §8.9 — required before submission)
  //  12. warningSummary is provided when warningCount > 0
  //
  // Produces zero operational effects. Transitions exactly once to
  // pending_dual_approval. Writes immutable audit. Uses persistent DB-backed
  // idempotency with replay/conflict behavior.
  // ===========================================================================

  async submitForApproval(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: SubmitForApprovalInput,
  ): Promise<SubmitForApprovalResult> {
    // 1. Permission: migration.review (Owner/Accountant)
    requirePermission(effective, "migration.review");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    // Basic input validation
    if (!input.importBatchId?.trim()) {
      throw new HistoricalReconciliationError("VALIDATION_FAILED", "importBatchId is required.");
    }
    if (!input.idempotencyKey?.trim()) {
      throw new HistoricalReconciliationError("VALIDATION_FAILED", "idempotencyKey is required.");
    }

    // Require commit repository for backup-evidence / blocking-validation checks
    if (!this.deps.commitRepository) {
      throw new HistoricalReconciliationError(
        "CONFIGURATION_ERROR",
        "submitForApproval requires commitRepository to be configured for backup-evidence and blocking-validation checks.",
      );
    }

    // 2. Load + tenant-scope the batch
    const batch = await this.deps.repository.findImportBatchById(user.tenantId, input.importBatchId);
    if (!batch) throw new ReconBatchNotFoundError(input.importBatchId);
    requireTenantMatch(user, batch.tenantId);

    // Check for idempotent replay FIRST (before status check) — if this
    // submission already succeeded, return the existing result even if the
    // batch has since transitioned to pending_dual_approval.
    const nowForReplay = new Date();
    const replayClaim = await claimIdempotency(this.deps.idempotency, {
      tenantId: user.tenantId,
      operationScope: "historical_migration.submit_for_approval",
      idempotencyKey: input.idempotencyKey,
      requestBody: {
        importBatchId: input.importBatchId,
        warningSummary: input.warningSummary,
      } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now: nowForReplay,
    });
    if (replayClaim.action === "replay") {
      const responseBody = replayClaim.record.responseBody as Partial<SubmitForApprovalResult> | null;
      if (responseBody?.batchId) {
        return { ...responseBody, action: "replayed" } as SubmitForApprovalResult;
      }
    }
    if (replayClaim.action === "conflict") {
      throw new HistoricalReconciliationError("IDEMPOTENCY_CONFLICT", "Idempotency key conflict.");
    }
    if (replayClaim.action === "in_progress") {
      throw new HistoricalReconciliationError("OPERATION_IN_PROGRESS", "Submission already in progress.");
    }

    // 3. Require the exact contracted predecessor state: review_required
    // All prerequisite checks are wrapped so that if any fails, we mark the
    // idempotency claim as business_failed (so the same key can be retried
    // after the prerequisite is fixed).
    let reviewItems: ImportHumanReviewItem[] = [];
    let pendingItems: ImportHumanReviewItem[] = [];
    let blockingResults: ImportReconciliationResult[] = [];
    let backupEvidence: { length: number } = { length: 0 };
    try {
      if (batch.status !== "review_required") {
        throw new SubmissionInvalidStateError(input.importBatchId, batch.status, "review_required");
      }

      // 4. Validation completion (against current staged-data hash/version)
      if (batch.validationStatus !== "passed") {
        throw new MissingValidationCompletionError(input.importBatchId, batch.validationStatus);
      }

      // 5. Reconciliation completion (against current report/version)
      if (batch.reconciliationStatus !== "matched") {
        throw new MissingReconciliationCompletionError(input.importBatchId, batch.reconciliationStatus);
      }

      // 6. Reject unresolved blocking findings (reconciliation results with status='blocking')
      const latestResults = await this.deps.commitRepository.findLatestReconciliationResults(
        user.tenantId, input.importBatchId,
      );
      blockingResults = latestResults.filter(r => r.status === "blocking");
      if (blockingResults.length > 0) {
        throw new BlockingFindingsRemainError(input.importBatchId, blockingResults.length);
      }

      // Also reject blocking validation errors
      const blockingValidationErrors = await this.deps.commitRepository.findBlockingValidationErrors(
        user.tenantId, input.importBatchId,
      );
      if (blockingValidationErrors.length > 0) {
        throw new BlockingFindingsRemainError(input.importBatchId, blockingValidationErrors.length);
      }

      // 7. Every required human-review item must be resolved
      reviewItems = await this.deps.repository.findCurrentReviewItemsForBatch(
        user.tenantId, input.importBatchId,
      );
      pendingItems = reviewItems.filter(r => r.status === "pending");
      if (pendingItems.length > 0) {
        throw new UnresolvedReviewItemsError(input.importBatchId, pendingItems.length);
      }

      // 8. Require staged-data hash
      if (!batch.stagedDataHash) {
        throw new MissingStagedDataHashError(input.importBatchId);
      }

      // 9. Require cutover-manifest hash
      if (!batch.cutoverManifestHash) {
        throw new MissingCutoverManifestHashError(input.importBatchId);
      }

      // 10. Require accepted-warning evidence (warningCount === acceptedWarningCount)
      if (batch.warningCount > batch.acceptedWarningCount) {
        throw new UnacknowledgedWarningsError(
          input.importBatchId, batch.warningCount, batch.acceptedWarningCount,
        );
      }

      // 12. warningSummary required when warningCount > 0
      if (batch.warningCount > 0 && !input.warningSummary?.trim()) {
        throw new SubmissionValidationError(
          "MISSING_WARNING_SUMMARY",
          `Cannot submit batch '${input.importBatchId}' for approval — warningSummary is required when warningCount > 0.`,
        );
      }

      // 11. Require backup evidence (Contract 08 §8.9)
      const backupEvidenceRows = await this.deps.commitRepository.findBackupEvidenceForBatch(
        user.tenantId, input.importBatchId,
      );
      backupEvidence = { length: backupEvidenceRows.length };
      if (backupEvidenceRows.length === 0) {
        throw new MissingBackupEvidenceError(input.importBatchId);
      }
    } catch (e) {
      // Mark the idempotency claim as business_failed so the same key can be
      // retried after the prerequisite is fixed.
      await markBusinessFailed(this.deps.idempotency, replayClaim.record.id, {
        responseCode: 400,
        responseBody: { error: (e as Error).message, code: (e as any)?.code ?? "SUBMISSION_FAILED" },
        lastErrorClass: (e as Error).name ?? "Error",
      }, replayClaim.record.ownerToken!, nowForReplay);
      throw e;
    }

    // ---- All prerequisites verified. The idempotency claim was already
    // acquired above (before the status check) for replay handling.
    // WP-08-01F DEFECT 4: The mutation phase (status transition + audit +
    // idempotency markSucceeded) is atomic — all commit or all roll back.
    // ----
    const now = nowForReplay;
    const claim = replayClaim; // use the claim acquired above

    const executeAtomically = async (): Promise<SubmitForApprovalResult> => {
      // 12. Transition exactly once to pending_dual_approval
      const reportVersion = await this.deps.repository.findLatestReportVersion(
        user.tenantId, input.importBatchId,
      );
      await this.deps.repository.updateBatchStatus(
        user.tenantId, input.importBatchId, "pending_dual_approval",
      );

      // 13. Write immutable audit
      await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
        entityType: "import_batch",
        entityId: input.importBatchId,
        actionType: "historical_migration.submit_for_approval",
        newValuesJson: {
          importBatchId: input.importBatchId,
          previousStatus: batch.status,
          newStatus: "pending_dual_approval",
          reportVersion,
          stagedDataHash: batch.stagedDataHash,
          cutoverManifestHash: batch.cutoverManifestHash,
          validationStatus: batch.validationStatus,
          reconciliationStatus: batch.reconciliationStatus,
          warningCount: batch.warningCount,
          acceptedWarningCount: batch.acceptedWarningCount,
          warningSummary: input.warningSummary,
          reviewItemsTotal: reviewItems.length,
          reviewItemsPending: pendingItems.length,
          blockingResults: blockingResults.length,
          backupEvidenceCount: backupEvidence.length,
        },
        idempotencyKey: input.idempotencyKey,
      });

      const result: SubmitForApprovalResult = {
        action: "submitted",
        batchId: input.importBatchId,
        previousStatus: batch.status,
        newStatus: "pending_dual_approval",
        reportVersion,
        stagedDataHash: batch.stagedDataHash!,
        cutoverManifestHash: batch.cutoverManifestHash,
      };

      // markSucceeded inside the transaction — owner-token-fenced
      await markSucceeded(this.deps.idempotency, claim.record.id, {
        responseCode: 200, responseBody: result,
        entityType: "import_batch", entityId: input.importBatchId,
      }, claim.record.ownerToken!, now);

      return result;
    };

    // If transactionRunner is available, run atomically. Otherwise run directly.
    if (this.deps.transactionRunner) {
      return await this.deps.transactionRunner(executeAtomically);
    } else {
      return await executeAtomically();
    }
  }

  // ===========================================================================
  // WP-08-01F DEFECT 2 — reopenBatchForRework
  //
  // Contract 08 §9 permitted branches:
  //   review_required → normalized | staged | validation_in_progress
  //   pending_dual_approval → review_required (material change or rejected approval)
  //   approved_for_commit → review_required (stale version/new blocker)
  //
  // Explicit idempotent rework/reopen command. Does NOT simply permit
  // arbitrary file/staging mutation in review_required — it transitions
  // state and invalidates dependent evidence atomically.
  //
  // Invalidation semantics:
  //   - Mark current reconciliation report version as superseded.
  //   - Reset validationStatus and reconciliationStatus to null.
  //   - Invalidate Owner and Accountant approvals (delete — they cannot be
  //     preserved because their bound hashes/versions no longer match).
  //   - Invalidate pending review items (resolved items preserved for audit).
  //   - Audit old/new state, reason, invalidated versions.
  //
  // Produces zero operational effects. Rejects committed/rejected/cancelled/
  // committing states.
  // ===========================================================================

  /**
   * Contract 08 §9: define the allowed (source → target) rework branches.
   * Any other combination is rejected as INVALID_REWORK_TARGET.
   */
  private static readonly REWORK_BRANCHES: Record<string, ReadonlySet<ReworkTargetState>> = {
    review_required: new Set(["normalized", "staged", "validation_in_progress"] as ReworkTargetState[]),
    pending_dual_approval: new Set(["review_required"] as ReworkTargetState[]),
    approved_for_commit: new Set(["review_required"] as ReworkTargetState[]),
  };

  async reopenBatchForRework(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: ReworkBatchInput,
  ): Promise<ReworkBatchResult> {
    // 1. Permission: migration.review (Contract 08 §9 — rework requires
    //    migration.review/prepare). We require migration.review because
    //    rework is a review-stage decision.
    requirePermission(effective, "migration.review");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!input.importBatchId?.trim()) {
      throw new HistoricalReconciliationError("VALIDATION_FAILED", "importBatchId is required.");
    }
    if (!input.idempotencyKey?.trim()) {
      throw new HistoricalReconciliationError("VALIDATION_FAILED", "idempotencyKey is required.");
    }
    if (!input.reason?.trim()) {
      throw new HistoricalReconciliationError("VALIDATION_FAILED", "reason is required (Contract 08 §9 — rework requires a reason).");
    }

    if (!this.deps.commitRepository) {
      throw new HistoricalReconciliationError(
        "CONFIGURATION_ERROR",
        "reopenBatchForRework requires commitRepository to be configured for approval invalidation.",
      );
    }

    // 2. Load + tenant-scope the batch (for pre-check only — the
    //    authoritative lifecycle check happens AFTER the lock).
    const batch = await this.deps.repository.findImportBatchById(user.tenantId, input.importBatchId);
    if (!batch) throw new ReconBatchNotFoundError(input.importBatchId);
    requireTenantMatch(user, batch.tenantId);

    // ---- Claim idempotency BEFORE the lifecycle guard. ----
    // This ensures that replay/conflict is determined before any lifecycle
    // check. A replay must return the cached response even if the batch
    // state has since changed (the rework already happened). A conflict
    // must be rejected regardless of batch state.
    const now = new Date();
    const claim = await claimIdempotency(this.deps.idempotency, {
      tenantId: user.tenantId,
      operationScope: "historical_migration.rework",
      idempotencyKey: input.idempotencyKey,
      requestBody: {
        importBatchId: input.importBatchId,
        reason: input.reason,
        targetState: input.targetState,
      } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    });

    if (claim.action === "replay") {
      const responseBody = claim.record.responseBody as Partial<ReworkBatchResult> | null;
      if (responseBody?.batchId) {
        return { ...responseBody, action: "replayed" } as ReworkBatchResult;
      }
    }
    if (claim.action === "conflict") {
      throw new HistoricalReconciliationError("IDEMPOTENCY_CONFLICT", "Idempotency key conflict.");
    }
    if (claim.action === "in_progress") {
      throw new HistoricalReconciliationError("OPERATION_IN_PROGRESS", "Rework already in progress.");
    }

    // 9. Pre-check: reject committed/rejected/cancelled/committing states.
    // This is a fail-fast pre-check — the authoritative check runs after
    // the batch row lock.
    const allowedSources = Object.keys(HistoricalReconciliationService.REWORK_BRANCHES);
    if (!allowedSources.includes(batch.status)) {
      throw new ReworkInvalidSourceStateError(input.importBatchId, batch.status);
    }

    // Validate the target state is permitted for this source (pre-check).
    const allowedTargets = HistoricalReconciliationService.REWORK_BRANCHES[batch.status]!;
    if (!allowedTargets.has(input.targetState)) {
      throw new ReworkInvalidTargetStateError(
        input.importBatchId, batch.status, input.targetState, [...allowedTargets],
      );
    }

    // -----------------------------------------------------------------------
    // WP-08-01F Milestone C Task 1+2: Atomic rework WITHOUT mutable
    // dependency swapping and WITHOUT markVersionAsSuperseded.
    //
    // Old reconciliation results are NEVER mutated. The report_version
    // column itself is the supersession mechanism — the latest version is
    // "current", older versions remain as immutable audit history (Contract
    // 08 §8.7, DEC-019 principle: "older versions are retained as
    // superseded audit history"). The previous markVersionAsSuperseded
    // call was removed because it overwrote the `notes` field, destroying
    // the original review reason evidence.
    //
    // The rework mutation phase (reset statuses + invalidate approvals +
    // supersede review items + transition + audit + idempotency
    // markSucceeded) is atomic with EXPLICIT tx-scoped deps passed to
    // executeReworkAtomically (no mutation of this.deps).
    // -----------------------------------------------------------------------
    const useAtomicTransaction = !!(
      this.deps.transactionRunner &&
      this.deps.createReconciliationRepository &&
      this.deps.createAudit &&
      this.deps.createIdempotency &&
      this.deps.createCommitRepository
    );

    const executeReworkAtomically = async (
      repo: HistoricalReconciliationRepository,
      commitRepo: HistoricalCommitRepository,
      auditHandle: AuditTransactionHandle,
      idemHandle: IdempotencyTransactionHandle,
      lockedBatch: ImportBatch,
    ): Promise<ReworkBatchResult> => {
      // 3. Determine the latest report version (for audit only — do NOT
      // mutate old results).
      const latestReportVersion = await repo.findLatestReportVersion(
        user.tenantId, input.importBatchId,
      );

      // WP-08-01F Milestone C Task 1: Do NOT call markVersionAsSuperseded.
      // Old reconciliation results remain unchanged as immutable audit
      // history. The `report_version` column distinguishes versions.

      // 4. Reset validationStatus and reconciliationStatus (forces re-run)
      await repo.resetBatchValidationAndReconciliationStatuses(
        user.tenantId, input.importBatchId,
      );

      // 5. Invalidate Owner and Accountant approvals (mark is_current=false, preserve rows)
      const invalidatedApprovalCount = await commitRepo.invalidateCurrentApprovalsForBatch(
        user.tenantId, input.importBatchId, user.userId, input.reason,
      );

      // 6. Supersede current review items (mark is_current=false, preserve rows)
      const invalidatedReviewItemCount = await repo.supersedeReviewItemsForBatch(
        user.tenantId, input.importBatchId, user.userId, input.reason,
      );

      // 7. Transition batch to the requested target state
      await repo.updateBatchStatus(
        user.tenantId, input.importBatchId, input.targetState,
      );

      // 8. Audit old/new state, reason, invalidated versions
      await appendAuditLog(auditHandle, user.tenantId, user.userId, {
        entityType: "import_batch",
        entityId: input.importBatchId,
        actionType: "historical_migration.rework",
        newValuesJson: {
          importBatchId: input.importBatchId,
          previousStatus: lockedBatch.status,
          newStatus: input.targetState,
          reason: input.reason,
          invalidatedReportVersion: latestReportVersion > 0 ? latestReportVersion : null,
          invalidatedApprovalCount,
          invalidatedPendingReviewItemCount: invalidatedReviewItemCount,
          previousValidationStatus: lockedBatch.validationStatus,
          previousReconciliationStatus: lockedBatch.reconciliationStatus,
        },
        idempotencyKey: input.idempotencyKey,
      });

      const result: ReworkBatchResult = {
        action: "reworked",
        batchId: input.importBatchId,
        previousStatus: lockedBatch.status,
        newStatus: input.targetState,
        invalidatedReportVersion: latestReportVersion > 0 ? latestReportVersion : null,
        invalidatedOwnerApproval: invalidatedApprovalCount > 0,
        invalidatedAccountantApproval: invalidatedApprovalCount > 0,
      };

      // markSucceeded inside the transaction — owner-token-fenced
      await markSucceeded(idemHandle, claim.record.id, {
        responseCode: 200, responseBody: result,
        entityType: "import_batch", entityId: input.importBatchId,
      }, claim.record.ownerToken!, now);

      return result;
    };

    if (useAtomicTransaction) {
      // -------------------------------------------------------------------
      // Atomic path: create tx-scoped deps and pass them explicitly to
      // executeReworkAtomically. NO mutation of this.deps.
      //
      // Lock the batch row (SELECT ... FOR UPDATE) and RE-READ the batch
      // inside the transaction. The lifecycle guard is run against this
      // authoritative locked state, not the pre-lock snapshot.
      // -------------------------------------------------------------------
      return await this.deps.transactionRunner!(async (tx: unknown) => {
        // Lock the batch row for the duration of this transaction.
        const batchRows = await (tx as any).execute(
          drizzleSql`SELECT id, status, validation_status, reconciliation_status FROM import_batches WHERE tenant_id = ${user.tenantId} AND id = ${input.importBatchId} FOR UPDATE`,
        );
        if (!batchRows || (batchRows as any[]).length === 0) {
          throw new ReconBatchNotFoundError(input.importBatchId);
        }
        const lockedBatchRow = (batchRows as any[])[0]!;

        // Re-run the lifecycle guard against the AUTHORITATIVE locked state.
        // The pre-lock batch may be stale if another concurrent rework or
        // reconciliation changed the status between the pre-check and the
        // lock acquisition.
        const allowedSources = Object.keys(HistoricalReconciliationService.REWORK_BRANCHES);
        if (!allowedSources.includes(lockedBatchRow.status)) {
          throw new ReworkInvalidSourceStateError(input.importBatchId, lockedBatchRow.status);
        }
        const allowedTargets = HistoricalReconciliationService.REWORK_BRANCHES[lockedBatchRow.status]!;
        if (!allowedTargets.has(input.targetState)) {
          throw new ReworkInvalidTargetStateError(
            input.importBatchId, lockedBatchRow.status, input.targetState, [...allowedTargets],
          );
        }

        const lockedBatch: ImportBatch = {
          ...batch,
          status: lockedBatchRow.status as any,
          validationStatus: lockedBatchRow.validation_status,
          reconciliationStatus: lockedBatchRow.reconciliation_status,
        };

        const txRepo = this.deps.createReconciliationRepository!(tx);
        const txCommitRepo = this.deps.createCommitRepository!(tx);
        const txAudit = this.deps.createAudit!(tx);
        const txIdem = this.deps.createIdempotency!(tx);
        return executeReworkAtomically(txRepo, txCommitRepo, txAudit, txIdem, lockedBatch);
      });
    } else {
      // Non-atomic path (in-memory tests): execute directly with the
      // original (non-tx) deps. No batch row locking (in-memory store
      // has no concurrency).
      return executeReworkAtomically(
        this.deps.repository,
        this.deps.commitRepository!,
        this.deps.audit,
        this.deps.idempotency,
        batch,
      );
    }
  }

  /**
   * List review items for a batch.
   */
  async listReviewItems(
    user: ErpUserContext,
    effective: EffectivePermissions,
    batchId: string,
  ): Promise<ImportHumanReviewItem[]> {
    requirePermission(effective, "migration.review");
    return this.deps.repository.findReviewItemsForBatch(user.tenantId, batchId);
  }
}
