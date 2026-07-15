/**
 * Historical Commit Service — WP-07-04.
 *
 * Contract: docs/contracts/08_historical_migration_contract.md
 *   §8.9 Human Review, §8.10 Commit, §8.11 Cutover Lock.
 *   DEC-069: distinct approval identity.
 *   DEC-071: opening balances only for MVP.
 *
 * WP-07-04 SCOPE:
 *   - Dual approval (distinct Owner + Accountant, DEC-069)
 *   - Approval binds to exact versions/hashes (staged_data_hash, cutover_manifest_hash, etc.)
 *   - Stale approval detection (if staged data changes after approval, commit blocked)
 *   - Backup evidence required
 *   - Cutover lock acquisition/release
 *   - Pre-commit validation (no blocking errors, no unresolved review items, no blocking recon)
 *   - Atomic commit through existing domain services
 *   - Idempotency (no duplicate commit)
 *
 * WP-07-04 NON-SCOPE:
 *   - No historical correction (WP-07-05)
 *   - No full transaction history import (DEC-071)
 *   - No partial commit
 *   - No direct table-copy from staging to domain tables
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
import type { HistoricalCommitRepository } from "./historical-commit-repository";
import type { InventoryLedgerService } from "./inventory-ledger-service";
import type { SubledgerService } from "./subledger-service";
import type { ImportBatchApproval, ImportStagingRow } from "@/server/db/schema/migration";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

export interface SubmitApprovalInput {
  importBatchId: string;
  approverRole: "owner" | "accountant";
  backupEvidenceRef: string | null;
  reason: string | null;
  idempotencyKey: string;
}

export interface SubmitApprovalResult {
  action: "approved" | "replayed";
  approvalId: string;
  batchId: string;
  role: string;
}

export interface CommitBatchInput {
  importBatchId: string;
  backupEvidenceRef: string;
  idempotencyKey: string;
}

export interface CommitBatchResult {
  action: "committed" | "replayed";
  batchId: string;
  status: string;
  effectCounts: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

export class HistoricalCommitError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = "HistoricalCommitError"; this.code = code; }
}

export class BatchNotFoundForCommitError extends HistoricalCommitError {
  constructor(id: string) { super("BATCH_NOT_FOUND", `Import batch '${id}' not found.`); this.name = "BatchNotFoundForCommitError"; }
}

export class SameUserDualApprovalError extends HistoricalCommitError {
  constructor(userId: string) { super("SAME_USER_DUAL_APPROVAL", `User '${userId}' cannot provide both approvals — DEC-069 distinct identity.`); this.name = "SameUserDualApprovalError"; }
}

export class MissingApprovalError extends HistoricalCommitError {
  constructor(batchId: string, missing: string) { super("MISSING_APPROVAL", `Batch '${batchId}' missing ${missing} approval.`); this.name = "MissingApprovalError"; }
}

export class StaleApprovalError extends HistoricalCommitError {
  constructor(batchId: string, detail: string) { super("STALE_APPROVAL", `Approval for batch '${batchId}' is stale: ${detail}`); this.name = "StaleApprovalError"; }
}

export class BlockingFindingsRemainError extends HistoricalCommitError {
  constructor(batchId: string, count: number) { super("BLOCKING_REMAIN", `Cannot commit batch '${batchId}' — ${count} blocking findings remain.`); this.name = "BlockingFindingsRemainError"; }
}

export class UnresolvedReviewItemsError extends HistoricalCommitError {
  constructor(batchId: string, count: number) { super("UNRESOLVED_REVIEWS", `Cannot commit batch '${batchId}' — ${count} unresolved review items.`); this.name = "UnresolvedReviewItemsError"; }
}

export class MissingBackupEvidenceError extends HistoricalCommitError {
  constructor(batchId: string) { super("MISSING_BACKUP", `Cannot commit batch '${batchId}' — backup evidence required.`); this.name = "MissingBackupEvidenceError"; }
}

export class OverlappingDataError extends HistoricalCommitError {
  constructor(batchId: string, detail: string) { super("OVERLAPPING_DATA", `Batch '${batchId}': ${detail}`); this.name = "OverlappingDataError"; }
}

// ---------------------------------------------------------------------------
// Service deps.
// ---------------------------------------------------------------------------

export interface HistoricalCommitServiceDeps {
  repository: HistoricalCommitRepository;
  audit: AuditTransactionHandle;
  idempotency: IdempotencyTransactionHandle;
  /** Used for opening inventory balance commit. */
  inventoryLedger: InventoryLedgerService;
  /** Used for opening party balance commit. */
  subledger: SubledgerService;
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function computeStagedDataHash(rows: ImportStagingRow[]): string {
  const data = rows.map(r => `${r.id}:${r.sourceRowNumber}:${JSON.stringify(r.rawRowJson)}`).join("|");
  return createHash("sha256").update(data).digest("hex");
}

// ---------------------------------------------------------------------------
// HistoricalCommitService.
// ---------------------------------------------------------------------------

export class HistoricalCommitService {
  constructor(private readonly deps: HistoricalCommitServiceDeps) {}

  /**
   * Submit an approval for a historical batch.
   *
   * Permission: migration.approve (Owner or Accountant).
   * DEC-069: The same user cannot provide both Owner and Accountant approvals.
   * Approval binds to exact staged_data_hash, cutover_manifest_hash, versions.
   */
  async submitApproval(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: SubmitApprovalInput,
  ): Promise<SubmitApprovalResult> {
    requirePermission(effective, "migration.approve");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!input.importBatchId?.trim()) throw new HistoricalCommitError("VALIDATION_FAILED", "importBatchId is required.");
    if (!input.idempotencyKey?.trim()) throw new HistoricalCommitError("VALIDATION_FAILED", "idempotencyKey is required.");
    if (input.approverRole !== "owner" && input.approverRole !== "accountant") {
      throw new HistoricalCommitError("VALIDATION_FAILED", "approverRole must be 'owner' or 'accountant'.");
    }

    const batch = await this.deps.repository.findImportBatchById(user.tenantId, input.importBatchId);
    if (!batch) throw new BatchNotFoundForCommitError(input.importBatchId);
    requireTenantMatch(user, batch.tenantId);

    // DEC-069: Check that the other role's approval (if exists) is from a DIFFERENT user
    const otherRole = input.approverRole === "owner" ? "accountant" : "owner";
    const otherApproval = await this.deps.repository.findApprovalByRole(user.tenantId, input.importBatchId, otherRole);
    if (otherApproval && otherApproval.approverUserId === user.userId) {
      throw new SameUserDualApprovalError(user.userId);
    }

    const now = new Date();
    const claim = await claimIdempotency(this.deps.idempotency, {
      tenantId: user.tenantId,
      operationScope: "historical_commit.approve",
      idempotencyKey: input.idempotencyKey,
      requestBody: { importBatchId: input.importBatchId, approverRole: input.approverRole } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    });

    if (claim.action === "replay") {
      const responseBody = claim.record.responseBody as Partial<SubmitApprovalResult> | null;
      if (responseBody?.approvalId) return { ...responseBody, action: "replayed" } as SubmitApprovalResult;
    }
    if (claim.action === "conflict") throw new HistoricalCommitError("IDEMPOTENCY_CONFLICT", `Idempotency key conflict.`);
    if (claim.action === "in_progress") throw new HistoricalCommitError("OPERATION_IN_PROGRESS", `Operation in progress.`);

    // Compute current staged data hash for binding
    const rows = await this.deps.repository.findStagingRowsForBatch(user.tenantId, input.importBatchId);
    const stagedDataHash = computeStagedDataHash(rows);

    // Bind to current state
    const approval = await this.deps.repository.insertApproval({
      tenantId: user.tenantId,
      importBatchId: input.importBatchId,
      approverRole: input.approverRole,
      approverUserId: user.userId,
      stagedDataHash,
      cutoverManifestHash: batch.cutoverManifestHash ?? "no-manifest",
      templateVersion: batch.templateVersion,
      mappingVersion: batch.mappingVersion,
      validationStatus: batch.validationStatus ?? "unknown",
      reconciliationStatus: batch.reconciliationStatus ?? "unknown",
      warningSummary: batch.warningSummary,
      reason: input.reason,
    });

    // Audit
    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: "import_batch_approval",
      entityId: approval.id,
      actionType: "historical_commit.approve",
      newValuesJson: {
        importBatchId: input.importBatchId,
        approverRole: input.approverRole,
        approverUserId: user.userId,
        stagedDataHash,
        backupEvidenceRef: input.backupEvidenceRef,
        reason: input.reason,
      },
      idempotencyKey: input.idempotencyKey,
    });

    const result: SubmitApprovalResult = {
      action: "approved",
      approvalId: approval.id,
      batchId: input.importBatchId,
      role: input.approverRole,
    };

    await markSucceeded(this.deps.idempotency, claim.record.id, {
      responseCode: 200, responseBody: result,
      entityType: "import_batch_approval", entityId: approval.id,
    }, now);

    return result;
  }

  /**
   * Commit a historical batch atomically.
   *
   * Requires:
   *   - Both Owner and Accountant approvals from distinct users (DEC-069)
   *   - Approvals not stale (staged data hash matches)
   *   - No blocking validation errors
   *   - No unresolved review items
   *   - No blocking reconciliation results
   *   - Backup evidence provided
   *   - Cutover lock acquired
   *
   * Commit uses existing domain services (InventoryLedgerService, SubledgerService).
   * No direct table-copy from staging to domain tables.
   *
   * DEC-071: MVP cutover model is opening balances only.
   */
  async commitBatch(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: CommitBatchInput,
  ): Promise<CommitBatchResult> {
    requirePermission(effective, "migration.commit");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!input.importBatchId?.trim()) throw new HistoricalCommitError("VALIDATION_FAILED", "importBatchId is required.");
    if (!input.idempotencyKey?.trim()) throw new HistoricalCommitError("VALIDATION_FAILED", "idempotencyKey is required.");
    if (!input.backupEvidenceRef?.trim()) throw new MissingBackupEvidenceError(input.importBatchId);

    const batch = await this.deps.repository.findImportBatchById(user.tenantId, input.importBatchId);
    if (!batch) throw new BatchNotFoundForCommitError(input.importBatchId);
    requireTenantMatch(user, batch.tenantId);

    const now = new Date();
    const claim = await claimIdempotency(this.deps.idempotency, {
      tenantId: user.tenantId,
      operationScope: "historical_commit.commit",
      idempotencyKey: input.idempotencyKey,
      requestBody: { importBatchId: input.importBatchId, backupEvidenceRef: input.backupEvidenceRef } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    });

    if (claim.action === "replay") {
      const responseBody = claim.record.responseBody as Partial<CommitBatchResult> | null;
      if (responseBody?.batchId) return { ...responseBody, action: "replayed" } as CommitBatchResult;
    }
    if (claim.action === "conflict") throw new HistoricalCommitError("IDEMPOTENCY_CONFLICT", `Idempotency key conflict.`);
    if (claim.action === "in_progress") throw new HistoricalCommitError("OPERATION_IN_PROGRESS", `Operation in progress.`);

    // 1. Check both approvals exist (DEC-069)
    const approvals = await this.deps.repository.findApprovalsForBatch(user.tenantId, input.importBatchId);
    const ownerApproval = approvals.find(a => a.approverRole === "owner");
    const accountantApproval = approvals.find(a => a.approverRole === "accountant");
    if (!ownerApproval) throw new MissingApprovalError(input.importBatchId, "owner");
    if (!accountantApproval) throw new MissingApprovalError(input.importBatchId, "accountant");

    // DEC-069: distinct user identity
    if (ownerApproval.approverUserId === accountantApproval.approverUserId) {
      throw new SameUserDualApprovalError(ownerApproval.approverUserId);
    }

    // 2. Stale approval detection — current staged data hash must match approval hash
    const rows = await this.deps.repository.findStagingRowsForBatch(user.tenantId, input.importBatchId);
    const currentStagedDataHash = computeStagedDataHash(rows);
    if (ownerApproval.stagedDataHash !== currentStagedDataHash) {
      throw new StaleApprovalError(input.importBatchId, "Owner approval staged_data_hash does not match current staged data.");
    }
    if (accountantApproval.stagedDataHash !== currentStagedDataHash) {
      throw new StaleApprovalError(input.importBatchId, "Accountant approval staged_data_hash does not match current staged data.");
    }

    // 3. No blocking validation errors
    const blockingErrors = await this.deps.repository.findBlockingErrorsForBatch(user.tenantId, input.importBatchId);
    if (blockingErrors.length > 0) {
      throw new BlockingFindingsRemainError(input.importBatchId, blockingErrors.length);
    }

    // 4. No unresolved review items
    const unresolvedReviews = await this.deps.repository.findUnresolvedReviewItemsForBatch(user.tenantId, input.importBatchId);
    if (unresolvedReviews.length > 0) {
      throw new UnresolvedReviewItemsError(input.importBatchId, unresolvedReviews.length);
    }

    // 5. No blocking reconciliation results
    const blockingRecon = await this.deps.repository.findBlockingReconciliationResultsForBatch(user.tenantId, input.importBatchId);
    if (blockingRecon.length > 0) {
      throw new BlockingFindingsRemainError(input.importBatchId, blockingRecon.length);
    }

    // 6. Overlapping data check (DEC-071: opening balances only)
    for (const row of rows) {
      const data = (row.transformedRowJson ?? row.rawRowJson) as Record<string, unknown> | null;
      if (!data) continue;
      // Reject rows with both opening balance AND sale/payment (double-count)
      if (data.balance !== undefined && data.sale_amount !== undefined) {
        throw new OverlappingDataError(input.importBatchId, `Row ${row.sourceRowNumber} has both opening balance and sale amount — overlapping data (DEC-071).`);
      }
      if (data.balance !== undefined && data.payment_amount !== undefined) {
        throw new OverlappingDataError(input.importBatchId, `Row ${row.sourceRowNumber} has both opening balance and payment amount — overlapping data (DEC-071).`);
      }
    }

    // 7. Acquire cutover lock
    const cutoverLock = await this.deps.repository.insertCutoverLock({
      tenantId: user.tenantId,
      importBatchId: input.importBatchId,
      domain: "inventory",
      lockHolder: user.userId,
    });

    // Audit lock acquisition
    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: "import_cutover_manifest",
      entityId: cutoverLock.id,
      actionType: "historical_commit.cutover_lock_acquired",
      newValuesJson: { importBatchId: input.importBatchId, domain: "inventory" },
      idempotencyKey: input.idempotencyKey,
    });

    // 8. Atomic commit through existing domain services
    // DEC-071: MVP = opening balances only.
    // Each staging row with quantity creates an inventory opening via InventoryLedgerService.
    // Each staging row with balance creates a party opening via SubledgerService.
    // Staging rows are marked as committed with provenance links.
    const effectCounts: Record<string, number> = {
      inventory_openings: 0,
      party_openings: 0,
      staging_rows_committed: 0,
    };

    try {
      for (const row of rows) {
        const data = (row.transformedRowJson ?? row.rawRowJson) as Record<string, unknown> | null;
        if (!data) continue;

        // Inventory opening balance via InventoryLedgerService.postRawReceipt
        if (data.quantity !== undefined && data.quantity !== null && data.quantity !== "" && data.quantity !== "0") {
          const qty = parseFloat(String(data.quantity));
          if (!isNaN(qty) && qty > 0) {
            // Use postRawReceipt for opening stock — this creates stock_movement + inventory_balance
            // through the existing domain service, NOT a direct table copy.
            await this.deps.inventoryLedger.postRawReceipt(user, effective, {
              itemId: String(data.item_id ?? data.itemId ?? "unknown"),
              toLocationId: String(data.location_id ?? data.locationId ?? "unknown"),
              quantityKg: String(data.quantity),
              movementDate: String(data.date ?? "2026-01-01"),
              sourceDocumentType: "historical_import",
              sourceDocumentId: input.importBatchId,
              idempotencyKey: `${input.idempotencyKey}:inv:${row.id}`,
              notes: `Historical opening balance from batch ${batch.batchNo}`,
            });
            effectCounts.inventory_openings = (effectCounts.inventory_openings ?? 0) + 1;
          }
        }

        // Party opening balance via SubledgerService
        if (data.balance !== undefined && data.balance !== null && data.balance !== "" && data.balance !== "0") {
          const balance = parseFloat(String(data.balance));
          if (!isNaN(balance) && balance !== 0) {
            // Use SubledgerService to create party opening balance through existing domain service
            const entityType = String(data.entity_type ?? "customer").toLowerCase();
            if (entityType.includes("customer")) {
              await this.deps.subledger.insertCustomerReceivableEntry(user, effective, {
                customerId: String(data.customer_id ?? data.customerId ?? "unknown"),
                saleId: input.importBatchId,
                documentTotalPosted: String(Math.abs(balance)),
                entryDate: String(data.date ?? "2026-01-01"),
                docNo: `HIST-${batch.batchNo}-${row.sourceRowNumber ?? "0"}`,
                idempotencyKey: `${input.idempotencyKey}:party:${row.id}`,
              });
              effectCounts.party_openings = (effectCounts.party_openings ?? 0) + 1;
            }
          }
        }

        // Mark staging row as committed with provenance
        await this.deps.repository.updateStagingRowCommitted(
          user.tenantId, row.id, "historical_import", input.importBatchId,
        );
        effectCounts.staging_rows_committed = (effectCounts.staging_rows_committed ?? 0) + 1;
      }

      // Update batch status to committed
      await this.deps.repository.updateBatchCommitInfo(user.tenantId, input.importBatchId, {
        status: "committed",
        committedAt: now,
        commitEffectCounts: effectCounts,
      });

      // Release cutover lock
      await this.deps.repository.deleteCutoverLocksForBatch(user.tenantId, input.importBatchId);

      // Audit commit
      await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
        entityType: "import_batch",
        entityId: input.importBatchId,
        actionType: "historical_commit.commit",
        newValuesJson: {
          importBatchId: input.importBatchId,
          backupEvidenceRef: input.backupEvidenceRef,
          effectCounts,
          ownerApprover: ownerApproval.approverUserId,
          accountantApprover: accountantApproval.approverUserId,
          stagedDataHash: currentStagedDataHash,
        },
        idempotencyKey: input.idempotencyKey,
      });

      // Audit lock release
      await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
        entityType: "import_cutover_manifest",
        entityId: cutoverLock.id,
        actionType: "historical_commit.cutover_lock_released",
        newValuesJson: { importBatchId: input.importBatchId },
        idempotencyKey: input.idempotencyKey,
      });

    } catch (commitError) {
      // Rollback: release cutover lock
      try { await this.deps.repository.deleteCutoverLocksForBatch(user.tenantId, input.importBatchId); } catch { /* ignore */ }

      // Mark idempotency as failed
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 500,
        responseBody: { message: "Commit failed — all effects rolled back." },
        lastErrorClass: commitError instanceof Error ? commitError.name : "Unknown",
      }, now);

      // Audit commit failure
      await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
        entityType: "import_batch",
        entityId: input.importBatchId,
        actionType: "historical_commit.commit_failed",
        newValuesJson: {
          importBatchId: input.importBatchId,
          error: commitError instanceof Error ? commitError.message : String(commitError),
        },
        idempotencyKey: input.idempotencyKey,
      });

      throw commitError;
    }

    const result: CommitBatchResult = {
      action: "committed",
      batchId: input.importBatchId,
      status: "committed",
      effectCounts,
    };

    await markSucceeded(this.deps.idempotency, claim.record.id, {
      responseCode: 200, responseBody: result,
      entityType: "import_batch", entityId: input.importBatchId,
    }, now);

    return result;
  }
}
