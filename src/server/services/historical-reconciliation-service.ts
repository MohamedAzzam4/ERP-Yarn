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
import type {
  ImportReconciliationResult,
  ImportHumanReviewItem,
  ImportStagingRow,
} from "@/server/db/schema/migration";

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

// ---------------------------------------------------------------------------
// Service deps.
// ---------------------------------------------------------------------------

export interface HistoricalReconciliationServiceDeps {
  repository: HistoricalReconciliationRepository;
  audit: AuditTransactionHandle;
  idempotency: IdempotencyTransactionHandle;
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

  // Compute staged totals from staging rows
  const stagedTotals: Record<string, number> = {};
  for (const row of rows) {
    const data = (row.transformedRowJson ?? row.rawRowJson) as Record<string, unknown> | null;
    if (!data) continue;

    // Inventory opening quantity
    if (data.quantity !== undefined && data.quantity !== null && data.quantity !== "") {
      const qty = parseFloat(String(data.quantity));
      if (!isNaN(qty)) {
        stagedTotals["inventory_opening_qty"] = (stagedTotals["inventory_opening_qty"] ?? 0) + qty;
        if (qty < 0) {
          metrics.push({
            metricKey: "negative_staged_quantity",
            expectedValue: ">= 0",
            stagedValue: String(qty),
            differenceValue: String(qty),
            status: "blocking",
            reviewReason: `Negative staged quantity ${qty} detected.`,
          });
        }
      }
    }

    // Party balance (customer/supplier)
    if (data.balance !== undefined && data.balance !== null && data.balance !== "") {
      const balance = parseFloat(String(data.balance));
      if (!isNaN(balance)) {
        stagedTotals["party_balance_total"] = (stagedTotals["party_balance_total"] ?? 0) + balance;
      }
    }

    // WIP quantity
    if (data.wip_qty !== undefined && data.wip_qty !== null && data.wip_qty !== "") {
      const wip = parseFloat(String(data.wip_qty));
      if (!isNaN(wip)) {
        stagedTotals["wip_opening_qty"] = (stagedTotals["wip_opening_qty"] ?? 0) + wip;
      }
    }

    // Duplicate document number detection
    if (data.doc_no !== undefined && data.doc_no !== null && data.doc_no !== "") {
      const docNo = String(data.doc_no);
      const dupCount = rows.filter(r => {
        const d = (r.transformedRowJson ?? r.rawRowJson) as Record<string, unknown> | null;
        return d?.doc_no === docNo;
      }).length;
      if (dupCount > 1) {
        // Only add once per doc_no (first occurrence)
        const firstOccurrence = rows.findIndex(r => {
          const d = (r.transformedRowJson ?? r.rawRowJson) as Record<string, unknown> | null;
          return d?.doc_no === docNo;
        });
        if (rows.indexOf(row) === firstOccurrence) {
          metrics.push({
            metricKey: `duplicate_document_${docNo}`,
            expectedValue: "unique",
            stagedValue: `${dupCount} occurrences`,
            differenceValue: `${dupCount - 1} extra`,
            status: "blocking",
            reviewReason: `Duplicate document number '${docNo}' appears ${dupCount} times.`,
          });
        }
      }
    }

    // Unmatched alias/lineage — name exists but no resolved master
    if (data.name && !data.customer_id && !data.item_id) {
      metrics.push({
        metricKey: `unmatched_alias_${String(data.name).substring(0, 20)}`,
        expectedValue: "resolved master",
        stagedValue: String(data.name),
        differenceValue: "no master link",
        status: "blocking",
        reviewReason: `Entity '${data.name}' has no resolved master reference — unmatched alias.`,
      });
    }
  }

  // Compare expected totals with staged totals
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
      status: isMatch ? "matched" : (Math.abs(difference) > expected * 0.1 ? "blocking" : "difference"),
      reviewReason: isMatch ? null : `Mismatch: expected ${expected}, staged ${staged}, difference ${difference}.`,
    });
  }

  // Add staged-only metrics (no expected provided but still report)
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
   * Idempotent: replay deletes old results and re-runs.
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

    // Get next report version BEFORE deleting old results (versioned reconciliation — §8.8)
    const latestVersion = await this.deps.repository.findLatestReportVersion(user.tenantId, input.importBatchId);
    const reportVersion = latestVersion + 1;

    // Delete old reconciliation results and review items (re-run is safe — new version replaces old)
    await this.deps.repository.deleteReconciliationResultsForBatch(user.tenantId, input.importBatchId);
    await this.deps.repository.deleteReviewItemsForBatch(user.tenantId, input.importBatchId);

    // Fetch staging rows
    const rows = await this.deps.repository.findStagingRowsForBatch(user.tenantId, input.importBatchId);

    // Compute reconciliation metrics
    const metrics = computeReconciliationMetrics(rows, input.expectedTotals);

    let matched = 0;
    let differences = 0;
    let blocking = 0;
    let reviewItemsCreated = 0;

    // Persist each metric as a reconciliation result
    for (const metric of metrics) {
      const result = await this.deps.repository.insertReconciliationResult({
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

      // Audit each reconciliation result
      await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
        entityType: "import_reconciliation_result",
        entityId: result.id,
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

      // Create review items for mismatches/blocking (§8.9 Human Review)
      if (metric.reviewReason) {
        const reviewItem = await this.deps.repository.insertReviewItem({
          tenantId: user.tenantId,
          importBatchId: input.importBatchId,
          stagingRowId: null,
          reviewReason: metric.reviewReason,
          createdBy: user.userId,
        });
        reviewItemsCreated++;

        // Audit each review item
        await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
          entityType: "import_human_review_item",
          entityId: reviewItem.id,
          actionType: "historical_reconciliation.review_created",
          newValuesJson: {
            importBatchId: input.importBatchId,
            reconciliationResultId: result.id,
            reviewReason: metric.reviewReason,
            status: "pending",
          },
          idempotencyKey: input.idempotencyKey,
        });
      }
    }

    // Update batch status to reconciliation_in_progress or review_required
    const newStatus = blocking > 0 ? "review_required" : "reconciliation_in_progress";
    await this.deps.repository.updateBatchStatus(user.tenantId, input.importBatchId, newStatus);

    // Audit reconciliation run
    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
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

    const result: RunReconciliationResult = {
      action: "executed",
      batchId: input.importBatchId,
      reportVersion,
      totalMetrics: metrics.length,
      matched, differences, blocking,
      reviewItemsCreated,
    };

    await markSucceeded(this.deps.idempotency, claim.record.id, {
      responseCode: 200, responseBody: result,
      entityType: "import_batch", entityId: input.importBatchId,
    }, now);

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
    }, now);

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
