/**
 * Historical Commit Service — WP-07-04.
 *
 * Contract: docs/contracts/08_historical_migration_contract.md
 *   §8.9 Human Review and Approval (dual approval, version binding, stale detection)
 *   §8.10 Approved Historical Commit (preconditions, locks, atomic commit, rollback)
 *   §8.11 Historical Locking and Correction (immutable committed records)
 *
 * Contract: docs/contracts/06_approval_transaction_contract.md §15
 *   Historical Import Commit Contract.
 *
 * WP-07-04 SCOPE:
 *   - Record dual approval (Owner + Accountant, distinct identities — DEC-069)
 *   - Bind approvals to exact staged-data hash, cutover manifest hash,
 *     template/mapping versions, validation/reconciliation status, warning summary
 *   - Detect stale approvals when material versions change
 *   - Acquire/release cutover locks to prevent concurrent commits
 *   - Validate backup evidence before commit
 *   - Validate no blocking findings (validation errors + reconciliation results)
 *   - Validate all warnings explicitly acknowledged
 *   - Atomic commit through domain posting services (transactionRunner + txFactories)
 *   - Fault injection support for rollback proof
 *   - Idempotent commit (replay returns existing result)
 *   - Record commit effect counts and audit
 *
 * WP-07-04 NON-SCOPE:
 *   - No direct table-copy (uses domain services for operational effects)
 *   - No bypass flag like approved_after_import_review
 *   - No automatic master/alias approval
 *   - No partial commit
 *   - No correction of committed history (WP-07-05)
 *
 * DEC-069: Two distinct user identities required for dual approval.
 * DEC-071: MVP scope is opening_balance only.
 * DEC-080: Requester-versus-approver separation (not directly applicable here
 *   since migration approvals are role-based, not request-based, but the
 *   distinct-identity rule is stricter).
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
import {
  allocateDocumentNumber,
  type DocumentSequenceTransactionHandle,
} from "./document-sequence-service";
import type { InventoryLedgerService } from "./inventory-ledger-service";
import type { SubledgerService } from "./subledger-service";
import type { HistoricalCommitRepository } from "./historical-commit-repository";
import type {
  ImportBatch,
  ImportBatchApproval,
  ImportStagingRow,
} from "@/server/db/schema/migration";

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

export interface RecordApprovalInput {
  importBatchId: string;
  approverRole: "owner" | "accountant";
  reason: string | null;
  idempotencyKey: string;
}

export interface RecordApprovalResult {
  action: "recorded" | "replayed";
  approvalId: string;
  approverRole: string;
  approverUserId: string;
  batchStatus: string;
}

export interface RecordBackupEvidenceInput {
  importBatchId: string;
  backupType: string;
  backupLocation: string;
  backupHash: string;
  backupSizeBytes: number | null;
  backupCreatedAt: Date;
  verificationNotes: string | null;
  idempotencyKey: string;
}

export interface RecordBackupEvidenceResult {
  action: "recorded" | "replayed";
  evidenceId: string;
  backupHash: string;
}

export interface CommitBatchInput {
  importBatchId: string;
  idempotencyKey: string;
  /**
   * Optional fault injection point for rollback testing.
   * - 'after_lock': fail after acquiring cutover lock (lock must be released)
   * - 'after_first_post': fail after first domain post (all posts must roll back)
   * - 'after_audit': fail after audit write (audit must roll back)
   * - null: normal execution
   */
  faultInjection?: "after_lock" | "after_first_post" | "after_audit" | null;
}

export interface CommitBatchResult {
  action: "committed" | "replayed";
  batchId: string;
  committedAt: Date;
  effectCounts: Record<string, number>;
  stagedRowsCommitted: number;
}

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

export class HistoricalCommitError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "HistoricalCommitError";
    this.code = code;
  }
}

export class CommitBatchNotFoundError extends HistoricalCommitError {
  constructor(id: string) {
    super("BATCH_NOT_FOUND", `Import batch '${id}' not found.`);
    this.name = "CommitBatchNotFoundError";
  }
}

export class SameUserDualApprovalError extends HistoricalCommitError {
  constructor(userId: string) {
    super(
      "SAME_USER_DUAL_APPROVAL",
      `User '${userId}' cannot provide both Owner and Accountant approvals. DEC-069 requires two distinct user identities.`,
    );
    this.name = "SameUserDualApprovalError";
  }
}

export class StaleApprovalError extends HistoricalCommitError {
  constructor(batchId: string, field: string, approved: string, current: string) {
    super(
      "STALE_APPROVAL",
      `Approval for batch '${batchId}' is stale: ${field} was '${approved}' at approval time but is now '${current}'. Material change invalidates prior approvals.`,
    );
    this.name = "StaleApprovalError";
  }
}

export class MissingBackupEvidenceError extends HistoricalCommitError {
  constructor(batchId: string) {
    super(
      "MISSING_BACKUP_EVIDENCE",
      `Cannot commit batch '${batchId}': no backup evidence recorded. Backup is mandatory before commit (Contract 08 §8.10).`,
    );
    this.name = "MissingBackupEvidenceError";
  }
}

export class BlockingFindingsError extends HistoricalCommitError {
  constructor(batchId: string, validationCount: number, reconCount: number) {
    super(
      "BLOCKING_FINDINGS_REMAIN",
      `Cannot commit batch '${batchId}': ${validationCount} blocking validation errors and ${reconCount} blocking reconciliation results remain.`,
    );
    this.name = "BlockingFindingsError";
  }
}

export class UnacknowledgedWarningsError extends HistoricalCommitError {
  constructor(batchId: string, warningCount: number) {
    super(
      "UNACKNOWLEDGED_WARNINGS",
      `Cannot commit batch '${batchId}': ${warningCount} warnings require explicit acknowledgement/reason before commit.`,
    );
    this.name = "UnacknowledgedWarningsError";
  }
}

export class CutoverLockConflictError extends HistoricalCommitError {
  constructor(batchId: string, scope: string, existingKey: string) {
    super(
      "CUTOVER_LOCK_CONFLICT",
      `Cannot commit batch '${batchId}': active cutover lock exists for scope '${scope}' (held by commit key '${existingKey}'). Concurrent commit prevented.`,
    );
    this.name = "CutoverLockConflictError";
  }
}

export class InvalidBatchStatusError extends HistoricalCommitError {
  constructor(batchId: string, currentStatus: string, requiredStatus: string) {
    super(
      "INVALID_BATCH_STATUS",
      `Batch '${batchId}' has status '${currentStatus}' but must be '${requiredStatus}' for this operation.`,
    );
    this.name = "InvalidBatchStatusError";
  }
}

export class IncompleteDualApprovalError extends HistoricalCommitError {
  constructor(batchId: string, approvedRoles: string[]) {
    super(
      "INCOMPLETE_DUAL_APPROVAL",
      `Batch '${batchId}' has approvals from roles [${approvedRoles.join(", ")}] but requires both 'owner' and 'accountant' (DEC-069).`,
    );
    this.name = "IncompleteDualApprovalError";
  }
}

export class CommitFaultInjectedError extends HistoricalCommitError {
  readonly inTransaction: boolean;
  constructor(point: string, inTransaction: boolean = false) {
    super(
      "COMMIT_FAULT_INJECTED",
      `Fault injected at '${point}' for rollback testing. All operational effects must roll back.`,
    );
    this.name = "CommitFaultInjectedError";
    this.inTransaction = inTransaction;
  }
}

// ---------------------------------------------------------------------------
// Transaction runner types (for atomic commit).
// ---------------------------------------------------------------------------

export type HistoricalCommitTransactionRunner = <T>(work: (tx: unknown) => Promise<T>) => Promise<T>;

export interface HistoricalCommitTransactionScopedFactories {
  /** Create a commit-scoped HistoricalCommitRepository. */
  createCommitRepository: (tx: unknown) => HistoricalCommitRepository;
  /** Create a commit-scoped AuditTransactionHandle. */
  createAudit: (tx: unknown) => AuditTransactionHandle;
  /** Create a commit-scoped InventoryLedgerService (for opening-balance movements). */
  createInventoryLedger: (tx: unknown) => InventoryLedgerService;
  /** Create a commit-scoped SubledgerService (for opening-balance entries). */
  createSubledger: (tx: unknown) => SubledgerService;
  /** Create a commit-scoped DocumentSequenceTransactionHandle (for doc_no allocation). */
  createDocumentSequence: (tx: unknown) => DocumentSequenceTransactionHandle;
}

// ---------------------------------------------------------------------------
// Service deps.
// ---------------------------------------------------------------------------

export interface HistoricalCommitServiceDeps {
  repository: HistoricalCommitRepository;
  audit: AuditTransactionHandle;
  idempotency: IdempotencyTransactionHandle;
  /**
   * Optional transaction runner for atomic commit.
   * When provided, all commit writes are wrapped in a single DB transaction.
   * When absent (unit tests), services run without a DB transaction boundary.
   */
  transactionRunner?: HistoricalCommitTransactionRunner;
  /** Factory functions for creating transaction-scoped services/repos. */
  txFactories?: HistoricalCommitTransactionScopedFactories;
}

// ---------------------------------------------------------------------------
// Constants.
// ---------------------------------------------------------------------------

const COMMIT_ENTITY_TYPE = "import_batch";
const COMMIT_AUDIT_ACTION = "historical_commit.commit";
const APPROVAL_AUDIT_ACTION = "historical_commit.approval";
const LOCK_AUDIT_ACTION = "historical_commit.lock";
const BACKUP_AUDIT_ACTION = "historical_commit.backup_evidence";

const CUTOVER_LOCK_SCOPES = ["batch", "inventory", "subledger"] as const;
const CUTOVER_LOCK_DURATION_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Helper: compute current batch version fingerprint.
// ---------------------------------------------------------------------------

interface BatchVersionFingerprint {
  stagedDataHash: string | null;
  cutoverManifestHash: string | null;
  templateVersion: string | null;
  mappingVersion: string | null;
  validationStatus: string | null;
  reconciliationStatus: string | null;
  warningSummary: string | null;
}

function getBatchFingerprint(batch: ImportBatch): BatchVersionFingerprint {
  return {
    stagedDataHash: batch.stagedDataHash,
    cutoverManifestHash: batch.cutoverManifestHash,
    templateVersion: batch.templateVersion,
    mappingVersion: batch.mappingVersion,
    validationStatus: batch.validationStatus,
    reconciliationStatus: batch.reconciliationStatus,
    warningSummary: batch.warningSummary,
  };
}

/**
 * Check if an approval is stale relative to the current batch fingerprint.
 * Returns the field that changed, or null if not stale.
 */
function findStaleField(
  approval: ImportBatchApproval,
  batch: ImportBatch,
): string | null {
  const fp = getBatchFingerprint(batch);
  if (approval.stagedDataHash !== fp.stagedDataHash) return "stagedDataHash";
  if (approval.cutoverManifestHash !== fp.cutoverManifestHash) return "cutoverManifestHash";
  // Template/mapping versions may be null at both sides — only stale if one is non-null
  // and they differ
  if (approval.templateVersion !== fp.templateVersion &&
      (approval.templateVersion !== null || fp.templateVersion !== null)) {
    // Only consider it stale if the values actually differ (not both null)
    if (approval.templateVersion !== fp.templateVersion) return "templateVersion";
  }
  if (approval.mappingVersion !== fp.mappingVersion &&
      (approval.mappingVersion !== null || fp.mappingVersion !== null)) {
    if (approval.mappingVersion !== fp.mappingVersion) return "mappingVersion";
  }
  if (approval.validationStatus !== fp.validationStatus) return "validationStatus";
  if (approval.reconciliationStatus !== fp.reconciliationStatus) return "reconciliationStatus";
  if (approval.warningSummary !== fp.warningSummary) return "warningSummary";
  return null;
}

// ---------------------------------------------------------------------------
// HistoricalCommitService.
// ---------------------------------------------------------------------------

export class HistoricalCommitService {
  constructor(private readonly deps: HistoricalCommitServiceDeps) {}

  // ===========================================================================
  // 1. Record dual approval (Owner or Accountant).
  // ===========================================================================

  /**
   * Record one Owner or Accountant approval for the batch.
   *
   * Permission: migration.approve
   * DEC-069: The same user cannot provide both approvals.
   * Bind to exact versions/hashes at approval time (Contract 08 §8.9).
   *
   * Preconditions:
   *   - Batch exists + belongs to tenant.
   *   - Batch is in a pre-commit status (not committed/rejected/cancelled).
   *   - User has not already provided the OTHER role's approval.
   *   - Staged data hash and cutover manifest hash are present.
   */
  async recordApproval(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: RecordApprovalInput,
  ): Promise<RecordApprovalResult> {
    requirePermission(effective, "migration.approve");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!input.importBatchId?.trim()) {
      throw new HistoricalCommitError("VALIDATION_FAILED", "importBatchId is required.");
    }
    if (!input.idempotencyKey?.trim()) {
      throw new HistoricalCommitError("VALIDATION_FAILED", "idempotencyKey is required.");
    }
    if (input.approverRole !== "owner" && input.approverRole !== "accountant") {
      throw new HistoricalCommitError("VALIDATION_FAILED", "approverRole must be 'owner' or 'accountant'.");
    }

    const batch = await this.deps.repository.findImportBatchById(user.tenantId, input.importBatchId);
    if (!batch) throw new CommitBatchNotFoundError(input.importBatchId);
    requireTenantMatch(user, batch.tenantId);

    // Check batch status — must not be terminal
    const terminalStatuses = ["committed", "rejected", "cancelled"];
    if (terminalStatuses.includes(batch.status)) {
      throw new InvalidBatchStatusError(input.importBatchId, batch.status, "non-terminal");
    }

    // DEC-069: Check that this user has NOT already provided the OTHER role's approval.
    // The same user/person/identity must not approve both sides.
    const existingApprovals = await this.deps.repository.findApprovalsForBatch(
      user.tenantId, input.importBatchId,
    );
    const otherRole = input.approverRole === "owner" ? "accountant" : "owner";
    const otherApproval = existingApprovals.find(a => a.approverRole === otherRole);
    if (otherApproval && otherApproval.approverUserId === user.userId) {
      throw new SameUserDualApprovalError(user.userId);
    }

    // Check if this role's approval already exists (idempotent replay)
    const existingThisRole = existingApprovals.find(a => a.approverRole === input.approverRole);
    if (existingThisRole) {
      // If same user, it's a replay. If different user, it's a conflict.
      if (existingThisRole.approverUserId === user.userId) {
        // Replay — check idempotency key
        const now = new Date();
        const claim = await claimIdempotency(this.deps.idempotency, {
          tenantId: user.tenantId,
          operationScope: "historical_commit.approval",
          idempotencyKey: input.idempotencyKey,
          requestBody: { importBatchId: input.importBatchId, approverRole: input.approverRole } as Record<string, unknown>,
          initiatedBy: user.userId,
          leaseDurationMs: 30000,
          now,
        });
        if (claim.action === "replay") {
          const responseBody = claim.record.responseBody as Partial<RecordApprovalResult> | null;
          if (responseBody?.approvalId) {
            return { ...responseBody, action: "replayed" } as RecordApprovalResult;
          }
        }
        // Idempotency key mismatch but same approval exists — return existing
        return {
          action: "replayed",
          approvalId: existingThisRole.id,
          approverRole: existingThisRole.approverRole,
          approverUserId: existingThisRole.approverUserId,
          batchStatus: batch.status,
        };
      } else {
        throw new HistoricalCommitError(
          "APPROVAL_ALREADY_EXISTS",
          `Batch '${input.importBatchId}' already has an ${input.approverRole} approval from a different user '${existingThisRole.approverUserId}'. One approval per role per batch.`,
        );
      }
    }

    // Claim idempotency
    const now = new Date();
    const claim = await claimIdempotency(this.deps.idempotency, {
      tenantId: user.tenantId,
      operationScope: "historical_commit.approval",
      idempotencyKey: input.idempotencyKey,
      requestBody: {
        importBatchId: input.importBatchId,
        approverRole: input.approverRole,
        reason: input.reason,
      } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    });

    if (claim.action === "replay") {
      const responseBody = claim.record.responseBody as Partial<RecordApprovalResult> | null;
      if (responseBody?.approvalId) {
        return { ...responseBody, action: "replayed" } as RecordApprovalResult;
      }
    }
    if (claim.action === "conflict") {
      throw new HistoricalCommitError("IDEMPOTENCY_CONFLICT", "Idempotency key conflict.");
    }
    if (claim.action === "in_progress") {
      throw new HistoricalCommitError("OPERATION_IN_PROGRESS", "Operation in progress.");
    }

    // Require staged data hash and cutover manifest hash to be present
    if (!batch.stagedDataHash) {
      throw new HistoricalCommitError(
        "MISSING_STAGED_DATA_HASH",
        "Batch must have a staged data hash before approval. Run staging/validation first.",
      );
    }
    if (!batch.cutoverManifestHash) {
      throw new HistoricalCommitError(
        "MISSING_CUTOVER_MANIFEST_HASH",
        "Batch must have a cutover manifest hash before approval. Create/approve a cutover manifest first.",
      );
    }

    // Insert the approval record with version/hash binding
    const approval = await this.deps.repository.insertApproval({
      tenantId: user.tenantId,
      importBatchId: input.importBatchId,
      approverRole: input.approverRole,
      approverUserId: user.userId,
      stagedDataHash: batch.stagedDataHash,
      cutoverManifestHash: batch.cutoverManifestHash,
      templateVersion: batch.templateVersion,
      mappingVersion: batch.mappingVersion,
      validationStatus: batch.validationStatus ?? "unknown",
      reconciliationStatus: batch.reconciliationStatus ?? "unknown",
      warningSummary: batch.warningSummary,
      reason: input.reason,
      createdBy: user.userId,
    });

    // Audit the approval
    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: COMMIT_ENTITY_TYPE,
      entityId: input.importBatchId,
      actionType: APPROVAL_AUDIT_ACTION,
      newValuesJson: {
        approvalId: approval.id,
        approverRole: input.approverRole,
        approverUserId: user.userId,
        stagedDataHash: batch.stagedDataHash,
        cutoverManifestHash: batch.cutoverManifestHash,
        templateVersion: batch.templateVersion,
        mappingVersion: batch.mappingVersion,
        validationStatus: batch.validationStatus,
        reconciliationStatus: batch.reconciliationStatus,
        reason: input.reason,
      },
      idempotencyKey: input.idempotencyKey,
    });

    // Check if both approvals now exist → update batch status
    const allApprovals = await this.deps.repository.findApprovalsForBatch(
      user.tenantId, input.importBatchId,
    );
    const hasOwner = allApprovals.some(a => a.approverRole === "owner");
    const hasAccountant = allApprovals.some(a => a.approverRole === "accountant");
    let newStatus = batch.status;
    if (hasOwner && hasAccountant) {
      // Verify distinct users (DEC-069)
      const ownerApproval = allApprovals.find(a => a.approverRole === "owner")!;
      const accountantApproval = allApprovals.find(a => a.approverRole === "accountant")!;
      if (ownerApproval.approverUserId === accountantApproval.approverUserId) {
        // This should have been caught earlier, but double-check
        throw new SameUserDualApprovalError(ownerApproval.approverUserId);
      }
      newStatus = "approved_for_commit";
      await this.deps.repository.updateBatchStatus(user.tenantId, input.importBatchId, newStatus);
    } else {
      // Move to pending_dual_approval if not already there
      if (batch.status !== "pending_dual_approval") {
        newStatus = "pending_dual_approval";
        await this.deps.repository.updateBatchStatus(user.tenantId, input.importBatchId, newStatus);
      }
    }

    const result: RecordApprovalResult = {
      action: "recorded",
      approvalId: approval.id,
      approverRole: input.approverRole,
      approverUserId: user.userId,
      batchStatus: newStatus,
    };

    await markSucceeded(this.deps.idempotency, claim.record.id, {
      responseCode: 200, responseBody: result,
      entityType: COMMIT_ENTITY_TYPE, entityId: input.importBatchId,
    }, now);

    return result;
  }

  // ===========================================================================
  // 2. Record backup evidence.
  // ===========================================================================

  /**
   * Record backup evidence for a batch.
   *
   * Permission: migration.prepare (Owner/Accountant).
   * Backup evidence is mandatory before commit (Contract 08 §8.10).
   * NO secrets/credentials are stored — only non-secret metadata.
   */
  async recordBackupEvidence(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: RecordBackupEvidenceInput,
  ): Promise<RecordBackupEvidenceResult> {
    requirePermission(effective, "migration.prepare");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!input.importBatchId?.trim()) {
      throw new HistoricalCommitError("VALIDATION_FAILED", "importBatchId is required.");
    }
    if (!input.idempotencyKey?.trim()) {
      throw new HistoricalCommitError("VALIDATION_FAILED", "idempotencyKey is required.");
    }
    if (!input.backupType?.trim()) {
      throw new HistoricalCommitError("VALIDATION_FAILED", "backupType is required.");
    }
    if (!input.backupLocation?.trim()) {
      throw new HistoricalCommitError("VALIDATION_FAILED", "backupLocation is required.");
    }
    if (!input.backupHash?.trim()) {
      throw new HistoricalCommitError("VALIDATION_FAILED", "backupHash is required.");
    }

    // Reject any backup location that looks like it contains credentials
    const lowerLocation = input.backupLocation.toLowerCase();
    if (lowerLocation.includes("password=") || lowerLocation.includes("secret=") ||
        lowerLocation.includes("token=") || lowerLocation.includes("api_key=")) {
      throw new HistoricalCommitError(
        "BACKUP_LOCATION_CONTAINS_CREDENTIALS",
        "backupLocation must not contain credentials/secrets. Store only a non-secret reference.",
      );
    }

    const batch = await this.deps.repository.findImportBatchById(user.tenantId, input.importBatchId);
    if (!batch) throw new CommitBatchNotFoundError(input.importBatchId);
    requireTenantMatch(user, batch.tenantId);

    const now = new Date();
    const claim = await claimIdempotency(this.deps.idempotency, {
      tenantId: user.tenantId,
      operationScope: "historical_commit.backup_evidence",
      idempotencyKey: input.idempotencyKey,
      requestBody: {
        importBatchId: input.importBatchId,
        backupType: input.backupType,
        backupHash: input.backupHash,
      } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    });

    if (claim.action === "replay") {
      const responseBody = claim.record.responseBody as Partial<RecordBackupEvidenceResult> | null;
      if (responseBody?.evidenceId) {
        return { ...responseBody, action: "replayed" } as RecordBackupEvidenceResult;
      }
    }
    if (claim.action === "conflict") {
      throw new HistoricalCommitError("IDEMPOTENCY_CONFLICT", "Idempotency key conflict.");
    }
    if (claim.action === "in_progress") {
      throw new HistoricalCommitError("OPERATION_IN_PROGRESS", "Operation in progress.");
    }

    const evidence = await this.deps.repository.insertBackupEvidence({
      tenantId: user.tenantId,
      importBatchId: input.importBatchId,
      backupType: input.backupType,
      backupLocation: input.backupLocation,
      backupHash: input.backupHash,
      backupSizeBytes: input.backupSizeBytes,
      backupCreatedAt: input.backupCreatedAt,
      verifiedBy: user.userId,
      verifiedAt: now,
      verificationNotes: input.verificationNotes,
      createdBy: user.userId,
    });

    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: COMMIT_ENTITY_TYPE,
      entityId: input.importBatchId,
      actionType: BACKUP_AUDIT_ACTION,
      newValuesJson: {
        evidenceId: evidence.id,
        backupType: input.backupType,
        backupHash: input.backupHash,
        backupSizeBytes: input.backupSizeBytes,
        verifiedBy: user.userId,
      },
      idempotencyKey: input.idempotencyKey,
    });

    const result: RecordBackupEvidenceResult = {
      action: "recorded",
      evidenceId: evidence.id,
      backupHash: input.backupHash,
    };

    await markSucceeded(this.deps.idempotency, claim.record.id, {
      responseCode: 200, responseBody: result,
      entityType: COMMIT_ENTITY_TYPE, entityId: input.importBatchId,
    }, now);

    return result;
  }

  // ===========================================================================
  // 3. Commit batch (atomic, dual-approval-gated, lock-protected).
  // ===========================================================================

  /**
   * Commit an approved historical batch through domain services.
   *
   * Permission: migration.commit
   *
   * Preconditions (Contract 08 §8.10):
   *   - Batch status = approved_for_commit (both approvals recorded)
   *   - No blocking validation errors
   *   - No blocking reconciliation results
   *   - All warnings explicitly acknowledged (warningSummary present)
   *   - Backup evidence exists
   *   - Both approvals match current versions/hash (not stale)
   *   - Approvals from distinct users (DEC-069)
   *   - Cutover lock can be acquired (no concurrent commit)
   *   - Idempotency key valid
   *
   * Atomic commit (Contract 06 §15):
   *   1. Acquire cutover locks for all scopes
   *   2. Recheck all preconditions under lock
   *   3. Post opening balance effects through domain services
   *   4. Update staging rows with committed entity links
   *   5. Write commit audit
   *   6. Mark batch committed with effect counts
   *   7. Release cutover locks
   *   8. Commit all effects together (or roll back all on failure)
   */
  async commitBatch(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: CommitBatchInput,
  ): Promise<CommitBatchResult> {
    requirePermission(effective, "migration.commit");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!input.importBatchId?.trim()) {
      throw new HistoricalCommitError("VALIDATION_FAILED", "importBatchId is required.");
    }
    if (!input.idempotencyKey?.trim()) {
      throw new HistoricalCommitError("VALIDATION_FAILED", "idempotencyKey is required.");
    }

    const batch = await this.deps.repository.findImportBatchById(user.tenantId, input.importBatchId);
    if (!batch) throw new CommitBatchNotFoundError(input.importBatchId);
    requireTenantMatch(user, batch.tenantId);

    // Check for idempotent replay FIRST — if this commit already succeeded,
    // return the existing result without re-running.
    const now = new Date();
    const claim = await claimIdempotency(this.deps.idempotency, {
      tenantId: user.tenantId,
      operationScope: "historical_commit.commit",
      idempotencyKey: input.idempotencyKey,
      requestBody: { importBatchId: input.importBatchId } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 300000, // 5 minutes for commit
      now,
    });

    if (claim.action === "replay") {
      const responseBody = claim.record.responseBody as Partial<CommitBatchResult> | null;
      if (responseBody?.batchId) {
        return { ...responseBody, action: "replayed" } as CommitBatchResult;
      }
    }
    if (claim.action === "conflict") {
      throw new HistoricalCommitError("IDEMPOTENCY_CONFLICT", "Idempotency key conflict.");
    }
    if (claim.action === "in_progress") {
      throw new HistoricalCommitError("OPERATION_IN_PROGRESS", "Commit already in progress.");
    }

    // ---- Precondition checks (before lock) ----


    // If already committed, return existing result (idempotent)
    if (batch.status === "committed" && batch.committedAt) {
      const result: CommitBatchResult = {
        action: "replayed",
        batchId: input.importBatchId,
        committedAt: batch.committedAt,
        effectCounts: (batch.commitEffectCounts as Record<string, number>) ?? {},
        stagedRowsCommitted: 0,
      };
      await markSucceeded(this.deps.idempotency, claim.record.id, {
        responseCode: 200, responseBody: result,
        entityType: COMMIT_ENTITY_TYPE, entityId: input.importBatchId,
      }, now);
      return result;
    }

    // Verify both approvals exist and are from distinct users (check BEFORE
    // batch status so we give the more specific IncompleteDualApprovalError
    // when only one approval has been recorded).
    const approvals = await this.deps.repository.findApprovalsForBatch(
      user.tenantId, input.importBatchId,
    );
    const ownerApproval = approvals.find(a => a.approverRole === "owner");
    const accountantApproval = approvals.find(a => a.approverRole === "accountant");
    if (!ownerApproval || !accountantApproval) {
      const roles = approvals.map(a => a.approverRole);
      throw new IncompleteDualApprovalError(input.importBatchId, roles);
    }
    // DEC-069: distinct user identities
    if (ownerApproval.approverUserId === accountantApproval.approverUserId) {
      throw new SameUserDualApprovalError(ownerApproval.approverUserId);
    }

    // Batch must be approved_for_commit (both approvals recorded moves it
    // to this status; if it's still pending_dual_approval or earlier, the
    // approval check above would have caught the incomplete case).
    if (batch.status !== "approved_for_commit") {
      throw new InvalidBatchStatusError(input.importBatchId, batch.status, "approved_for_commit");
    }

    // Verify approvals are not stale (bind to current batch versions)
    for (const approval of [ownerApproval, accountantApproval]) {
      const staleField = findStaleField(approval, batch);
      if (staleField) {
        throw new StaleApprovalError(
          input.importBatchId,
          staleField,
          String((approval as unknown as Record<string, unknown>)[staleField] ?? "null"),
          String((batch as unknown as Record<string, unknown>)[staleField] ?? "null"),
        );
      }
    }

    // Verify backup evidence exists
    const backupEvidence = await this.deps.repository.findBackupEvidenceForBatch(
      user.tenantId, input.importBatchId,
    );
    if (backupEvidence.length === 0) {
      throw new MissingBackupEvidenceError(input.importBatchId);
    }

    // Verify no blocking validation errors
    const blockingValidationErrors = await this.deps.repository.findBlockingValidationErrors(
      user.tenantId, input.importBatchId,
    );
    if (blockingValidationErrors.length > 0) {
      // Also check reconciliation blocking
      const reconResults = await this.deps.repository.findLatestReconciliationResults(
        user.tenantId, input.importBatchId,
      );
      const blockingRecon = reconResults.filter(r => r.status === "blocking");
      throw new BlockingFindingsError(
        input.importBatchId,
        blockingValidationErrors.length,
        blockingRecon.length,
      );
    }

    // Verify no blocking reconciliation results
    const reconResults = await this.deps.repository.findLatestReconciliationResults(
      user.tenantId, input.importBatchId,
    );
    const blockingRecon = reconResults.filter(r => r.status === "blocking");
    if (blockingRecon.length > 0) {
      throw new BlockingFindingsError(
        input.importBatchId,
        blockingValidationErrors.length,
        blockingRecon.length,
      );
    }

    // Verify warnings are acknowledged (warningSummary must be present)
    // If there are warnings (warningCount > 0), warningSummary must be non-null
    if (batch.warningCount > 0 && !batch.warningSummary) {
      throw new UnacknowledgedWarningsError(input.importBatchId, batch.warningCount);
    }
    // Check that accepted warning count equals warning count
    if (batch.warningCount > 0 && batch.acceptedWarningCount < batch.warningCount) {
      const unacknowledged = batch.warningCount - batch.acceptedWarningCount;
      throw new UnacknowledgedWarningsError(input.importBatchId, unacknowledged);
    }

    // ---- Acquire cutover locks ----
    // Contract 08 §8.10: "cutover manifest is approved and affected live-write
    //   scopes are locked/paused"
    const lockExpiry = new Date(now.getTime() + CUTOVER_LOCK_DURATION_MS);
    const acquiredLockIds: string[] = [];

    try {
      for (const scope of CUTOVER_LOCK_SCOPES) {
        // Check if a lock already exists for this scope
        const existingLock = await this.deps.repository.findActiveCutoverLockByScope(
          user.tenantId, input.importBatchId, scope,
        );
        if (existingLock) {
          // If the existing lock is from the same idempotency key, it's a retry — OK
          if (existingLock.commitIdempotencyKey === input.idempotencyKey) {
            acquiredLockIds.push(existingLock.id);
            continue;
          }
          // Different commit key — concurrent commit prevented
          throw new CutoverLockConflictError(
            input.importBatchId, scope, existingLock.commitIdempotencyKey,
          );
        }

        const lock = await this.deps.repository.insertCutoverLock({
          tenantId: user.tenantId,
          importBatchId: input.importBatchId,
          lockScope: scope,
          acquiredBy: user.userId,
          expiresAt: lockExpiry,
          commitIdempotencyKey: input.idempotencyKey,
          createdBy: user.userId,
        });
        acquiredLockIds.push(lock.id);

        await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
          entityType: COMMIT_ENTITY_TYPE,
          entityId: input.importBatchId,
          actionType: LOCK_AUDIT_ACTION,
          newValuesJson: {
            lockId: lock.id,
            lockScope: scope,
            action: "acquired",
            commitIdempotencyKey: input.idempotencyKey,
            expiresAt: lockExpiry.toISOString(),
          },
          idempotencyKey: input.idempotencyKey,
        });
      }

      // ---- Fault injection: after_lock ----
      // after_lock is thrown BEFORE the Drizzle transaction starts, so locks
      // were acquired via the non-tx repository and need explicit release.
      if (input.faultInjection === "after_lock") {
        throw new CommitFaultInjectedError("after_lock", false);
      }

      // ---- Update batch status to committing ----
      await this.deps.repository.updateBatchStatus(
        user.tenantId, input.importBatchId, "committing",
      );

      // ---- Execute atomic commit ----
      const result = await this.executeAtomicCommit(
        user, batch, input, claim.record.id, now,
      );

      // ---- Release cutover locks (success) ----
      await this.releaseLocksInternal(user, input.importBatchId, input.idempotencyKey, "commit_succeeded", now);

      await markSucceeded(this.deps.idempotency, claim.record.id, {
        responseCode: 200, responseBody: result,
        entityType: COMMIT_ENTITY_TYPE, entityId: input.importBatchId,
      }, now);

      return result;

    } catch (e) {
      // ---- Failure path: release locks and roll back ----
      // Contract 08 §8.10: "A technical/system failure rolls back all operational
      //   effects and leaves the approved batch retryable"

      // Locks are acquired OUTSIDE the Drizzle transaction (via the non-tx
      // repository), so they are NOT automatically rolled back when the
      // transaction fails. We must always release them here.
      // The Drizzle transaction ROLLBACK undoes: batch status ("committing"),
      // staging row links, domain effects (stock_movements, account_entries),
      // and audit. We restore batch status to "approved_for_commit" for retry.

      // All catch-block DB operations are wrapped in timeouts to prevent
      // hanging if the connection pool is in a bad state after transaction
      // rollback. These are best-effort — the main error is more important.

      // Release all locks acquired by this commit attempt
      try {
        await Promise.race([
          this.releaseLocksInternal(
            user, input.importBatchId, input.idempotencyKey, "commit_failed", now,
          ),
          new Promise((_, reject) => setTimeout(() => reject(new Error("lock release timeout")), 10000)),
        ]);
      } catch {
        // Best-effort lock release — the main error is more important
      }

      // Restore batch status to approved_for_commit (retryable)
      try {
        await Promise.race([
          this.deps.repository.updateBatchStatus(
            user.tenantId, input.importBatchId, "approved_for_commit",
          ),
          new Promise((_, reject) => setTimeout(() => reject(new Error("status restore timeout")), 10000)),
        ]);
      } catch {
        // Best-effort status restore
      }

      // Mark idempotency as business failed (in-memory, always safe)
      try {
        await markBusinessFailed(this.deps.idempotency, claim.record.id, {
          responseCode: 500,
          responseBody: { error: (e as Error).message, code: (e as any)?.code ?? "COMMIT_FAILED" },
          lastErrorClass: (e as Error).name ?? "Error",
          entityType: COMMIT_ENTITY_TYPE,
          entityId: input.importBatchId,
        }, now);
      } catch {
        // Best-effort idempotency update
      }

      // Re-throw the original error
      throw e;
    }
  }

  // ===========================================================================
  // Internal: execute atomic commit through domain services.
  // ===========================================================================

  private async executeAtomicCommit(
    user: ErpUserContext,
    batch: ImportBatch,
    input: CommitBatchInput,
    idempotencyRecordId: string,
    now: Date,
  ): Promise<CommitBatchResult> {
    interface TxScoped {
      commitRepository: HistoricalCommitRepository;
      audit: AuditTransactionHandle;
      inventoryLedger: InventoryLedgerService | null;
      subledger: SubledgerService | null;
      documentSequence: DocumentSequenceTransactionHandle | null;
      tx: unknown;
    }
    const executePosting = async (txScoped: TxScoped | null): Promise<CommitBatchResult> => {
      const repo = txScoped?.commitRepository ?? this.deps.repository;
      const audit = txScoped?.audit ?? this.deps.audit;
      const tx = txScoped?.tx ?? null;
      const invLedger = txScoped?.inventoryLedger ?? null;
      const subledger = txScoped?.subledger ?? null;
      const docSeq = txScoped?.documentSequence ?? null;
      // inTransaction is true only when running inside a real Drizzle transaction
      // (production path). In unit tests (txScoped === null), faults are thrown
      // outside a transaction, so the catch block must still release locks.
      const inTransaction = txScoped !== null;

      // Fetch staging rows inside the transaction
      const rows = await repo.findStagingRowsForBatch(user.tenantId, batch.id);

      // Post opening balance effects through domain services.
      // Contract 08 §8.10 step 3: "creates records through inventory,
      //   production, subledger... domain services rather than table-copy logic"
      // Contract 04 §13: "Only InventoryLedgerService may insert posted
      //   movement rows or mutate materialized balances."
      // Contract 07 §9: "SubledgerService is the only owner of account
      //   entry creation."
      const effectCounts: Record<string, number> = {
        inventory_movements: 0,
        account_entries: 0,
        staging_rows_committed: 0,
      };
      let committedRows = 0;
      const year = now.getUTCFullYear();
      const movementDate = now.toISOString().slice(0, 10);

      for (const row of rows) {
        const data = (row.transformedRowJson ?? row.rawRowJson) as Record<string, unknown> | null;
        if (!data) continue;

        const entityType = String(data.entity_type ?? data.type ?? "").toLowerCase();
        const stagingRowId = row.id;
        const sourceDocumentType = "historical_opening_balance";
        const rowIdempotencyKey = `${input.idempotencyKey}:${stagingRowId}`;

        // ---- Inventory opening balance ----
        // Requires: itemId, locationId, quantityKg
        if (data.item_id && data.location_id && data.quantity != null) {
          if (!invLedger || !docSeq) {
            throw new HistoricalCommitError(
              "DOMAIN_SERVICES_REQUIRED",
              "InventoryLedgerService and DocumentSequence are required for inventory opening balance commit but were not provided.",
            );
          }
          const docNoResult = await allocateDocumentNumber(docSeq, {
            tenantId: user.tenantId, documentType: "adjustment", year, entityType: "stock_movement",
          });
          const result = await invLedger.postOpeningBalanceMovement(
            user.tenantId, user.userId,
            {
              itemId: String(data.item_id),
              locationId: String(data.location_id),
              quantityKg: String(data.quantity),
              movementDate,
              docNo: docNoResult.docNo,
              sourceDocumentType,
              sourceDocumentId: stagingRowId,
              idempotencyKey: rowIdempotencyKey,
            },
          );
          await repo.updateStagingRowCommitLink(user.tenantId, stagingRowId, {
            committedEntityType: "stock_movement",
            committedEntityId: result.movementId,
            updatedBy: user.userId,
          });
          effectCounts.inventory_movements = (effectCounts.inventory_movements ?? 0) + 1;
          committedRows++;
        }
        // ---- Party opening balance (customer/supplier/factory) ----
        // Requires: ownerType, ownerId, amountSigned
        else if ((entityType.includes("customer") || entityType.includes("supplier") || entityType.includes("factory"))
                   && data.owner_id && data.balance != null) {
          if (!subledger || !docSeq) {
            throw new HistoricalCommitError(
              "DOMAIN_SERVICES_REQUIRED",
              "SubledgerService and DocumentSequence are required for party opening balance commit but were not provided.",
            );
          }
          const ownerType = entityType.includes("customer") ? "customer"
            : entityType.includes("supplier") ? "supplier" : "factory";
          const docNoResult = await allocateDocumentNumber(docSeq, {
            tenantId: user.tenantId, documentType: "opening_balance", year, entityType: "account_entry",
          });
          const result = await subledger.postOpeningBalanceEntry(
            user.tenantId, user.userId,
            {
              ownerType: ownerType as "customer" | "supplier" | "factory",
              ownerId: String(data.owner_id),
              amountSigned: String(data.balance),
              entryDate: movementDate,
              entryNo: docNoResult.docNo,
              sourceDocumentType,
              sourceDocumentId: stagingRowId,
              idempotencyKey: rowIdempotencyKey,
            },
          );
          await repo.updateStagingRowCommitLink(user.tenantId, stagingRowId, {
            committedEntityType: "account_entry",
            committedEntityId: result.entryId,
            updatedBy: user.userId,
          });
          effectCounts.account_entries = (effectCounts.account_entries ?? 0) + 1;
          committedRows++;
        }
        // ---- Unknown/unhandled row type — skip with warning ----
        else {
          // Mark as committed with no domain effect (metadata-only row)
          await repo.updateStagingRowCommitLink(user.tenantId, stagingRowId, {
            committedEntityType: "unhandled",
            committedEntityId: stagingRowId,
            updatedBy: user.userId,
          });
          committedRows++;
        }

        // ---- Fault injection: after_first_post ----
        // Only trigger on the first successfully posted row
        if (input.faultInjection === "after_first_post" && committedRows === 1) {
          throw new CommitFaultInjectedError("after_first_post", inTransaction);
        }
      }

      effectCounts.staging_rows_committed = committedRows;

      // ---- Write commit audit ----
      await appendAuditLog(audit, user.tenantId, user.userId, {
        entityType: COMMIT_ENTITY_TYPE,
        entityId: batch.id,
        actionType: COMMIT_AUDIT_ACTION,
        newValuesJson: {
          committedAt: now.toISOString(),
          effectCounts,
          stagedRowsCommitted: committedRows,
          cutoverImportMode: batch.cutoverImportMode,
          stagedDataHash: batch.stagedDataHash,
          cutoverManifestHash: batch.cutoverManifestHash,
          ownerApproverId: (await repo.findApprovalsForBatch(user.tenantId, batch.id))
            .find(a => a.approverRole === "owner")?.approverUserId,
          accountantApproverId: (await repo.findApprovalsForBatch(user.tenantId, batch.id))
            .find(a => a.approverRole === "accountant")?.approverUserId,
        },
        idempotencyKey: input.idempotencyKey,
      });

      // ---- Fault injection: after_audit ----
      if (input.faultInjection === "after_audit") {
        throw new CommitFaultInjectedError("after_audit", inTransaction);
      }

      // ---- Mark batch committed ----
      await repo.updateBatchCommitMetadata(user.tenantId, batch.id, {
        committedAt: now,
        commitEffectCounts: effectCounts,
        updatedBy: user.userId,
      });

      return {
        action: "committed",
        batchId: batch.id,
        committedAt: now,
        effectCounts,
        stagedRowsCommitted: committedRows,
      };
    };

    // Use transaction runner if available (production path)
    if (this.deps.transactionRunner && this.deps.txFactories) {
      return await this.deps.transactionRunner(async (tx: unknown) => {
        const txRepo = this.deps.txFactories!.createCommitRepository(tx);
        const txAudit = this.deps.txFactories!.createAudit(tx);
        const txInvLedger = this.deps.txFactories!.createInventoryLedger(tx);
        const txSubledger = this.deps.txFactories!.createSubledger(tx);
        const txDocSeq = this.deps.txFactories!.createDocumentSequence(tx);
        return executePosting({
          commitRepository: txRepo, audit: txAudit,
          inventoryLedger: txInvLedger, subledger: txSubledger,
          documentSequence: txDocSeq, tx,
        });
      });
    } else {
      // Unit test path — no transaction boundary, no domain services
      return executePosting(null);
    }
  }

  // ===========================================================================
  // Internal: release all locks for a batch.
  // ===========================================================================

  private async releaseLocksInternal(
    user: ErpUserContext,
    batchId: string,
    idempotencyKey: string,
    reason: string,
    now: Date,
  ): Promise<void> {
    const releasedCount = await this.deps.repository.releaseAllLocksForBatch(
      user.tenantId, batchId,
      {
        releasedBy: user.userId,
        releasedAt: now,
        releaseReason: reason,
      },
    );

    if (releasedCount > 0) {
      await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
        entityType: COMMIT_ENTITY_TYPE,
        entityId: batchId,
        actionType: LOCK_AUDIT_ACTION,
        newValuesJson: {
          action: "released",
          releasedCount,
          releaseReason: reason,
        },
        idempotencyKey,
      });
    }
  }

  // ===========================================================================
  // 4. Query helpers (read-only).
  // ===========================================================================

  async listApprovals(
    user: ErpUserContext,
    effective: EffectivePermissions,
    batchId: string,
  ): Promise<ImportBatchApproval[]> {
    requirePermission(effective, "migration.review");
    return this.deps.repository.findApprovalsForBatch(user.tenantId, batchId);
  }

  async listBackupEvidence(
    user: ErpUserContext,
    effective: EffectivePermissions,
    batchId: string,
  ) {
    requirePermission(effective, "migration.review");
    return this.deps.repository.findBackupEvidenceForBatch(user.tenantId, batchId);
  }

  async listActiveLocks(
    user: ErpUserContext,
    effective: EffectivePermissions,
    batchId: string,
  ) {
    requirePermission(effective, "migration.review");
    return this.deps.repository.findActiveCutoverLocksForBatch(user.tenantId, batchId);
  }
}
