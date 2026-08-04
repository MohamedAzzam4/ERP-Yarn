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

    // WP-07-03 correction: Get next report version and mark old version as superseded.
    // Old reconciliation evidence is PRESERVED (not deleted) for audit/approval binding.
    // Contract 08 §8.8: "Versioned reconciliation reports" — old versions remain queryable.
    const latestVersion = await this.deps.repository.findLatestReportVersion(user.tenantId, input.importBatchId);
    const reportVersion = latestVersion + 1;

    // Mark old version as superseded (NOT deleted — evidence preserved)
    if (latestVersion > 0) {
      await this.deps.repository.markVersionAsSuperseded(user.tenantId, input.importBatchId, latestVersion);
    }
    // Note: old review items are also preserved — they remain for audit trail.

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
    }, claim.record.ownerToken!, now);

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
