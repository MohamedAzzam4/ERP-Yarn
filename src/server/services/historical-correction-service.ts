/**
 * Historical Correction Service — WP-07-05.
 *
 * Contract: docs/contracts/08_historical_migration_contract.md §8.11
 *   "Historical Locking and Correction"
 *
 * DEC-070: Post-commit historical correction requires renewed dual approval.
 * DEC-069: Two distinct user identities required for dual approval.
 *
 * WP-07-05 SCOPE:
 *   - Create correction requests linked to committed historical batches/records
 *   - Renewed dual approval (Owner + Accountant, distinct identities)
 *   - Execute correction through domain services (not direct table writes)
 *   - Preserve original committed evidence (immutable)
 *   - Append-only audit trail
 *   - Idempotent/duplicate prevention
 *   - Tenant isolation
 *   - Atomic rollback on failure
 *
 * WP-07-05 NON-SCOPE:
 *   - No direct mutation of committed historical records
 *   - No reopening of committed batches
 *   - No bypass of dual approval
 *   - No raw table updates/deletes of operational effects
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
import type { HistoricalCorrectionRepository } from "./historical-correction-repository";
import type {
  HistoricalCorrectionRequest,
  ImportBatch,
} from "@/server/db/schema/migration";

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

export interface CreateCorrectionRequestInput {
  importBatchId: string;
  originalEntityType: string; // e.g. "stock_movement", "account_entry", "import_staging_row"
  originalEntityId: string;
  correctionType: "reversal" | "adjustment" | "new_corrected";
  reason: string;
  proposedCorrectionJson: Record<string, unknown> | null;
  impactAnalysisJson: Record<string, unknown> | null;
  idempotencyKey: string;
}

export interface CreateCorrectionRequestResult {
  action: "created" | "replayed";
  correctionRequestId: string;
  docNo: string;
  status: string;
}

export interface ApproveCorrectionInput {
  correctionRequestId: string;
  approverRole: "owner" | "accountant";
  idempotencyKey: string;
}

export interface ApproveCorrectionResult {
  action: "approved" | "replayed";
  correctionRequestId: string;
  status: string;
}

export interface ExecuteCorrectionInput {
  correctionRequestId: string;
  idempotencyKey: string;
  /**
   * Optional fault injection for rollback testing.
   * - 'after_domain_effect': fail after domain effect (rollback must undo it)
   * - null: normal execution
   */
  faultInjection?: "after_domain_effect" | null;
}

export interface ExecuteCorrectionResult {
  action: "executed" | "replayed";
  correctionRequestId: string;
  correctedEntityType: string;
  correctedEntityId: string;
}

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

export class HistoricalCorrectionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "HistoricalCorrectionError";
    this.code = code;
  }
}

export class CorrectionBatchNotFoundError extends HistoricalCorrectionError {
  constructor(id: string) {
    super("BATCH_NOT_FOUND", `Import batch '${id}' not found.`);
    this.name = "CorrectionBatchNotFoundError";
  }
}

export class BatchNotCommittedError extends HistoricalCorrectionError {
  constructor(batchId: string, status: string) {
    super(
      "BATCH_NOT_COMMITTED",
      `Cannot correct batch '${batchId}': status is '${status}' but must be 'committed'. Only committed historical records can be corrected.`,
    );
    this.name = "BatchNotCommittedError";
  }
}

export class CorrectionRequestNotFoundError extends HistoricalCorrectionError {
  constructor(id: string) {
    super("CORRECTION_REQUEST_NOT_FOUND", `Correction request '${id}' not found.`);
    this.name = "CorrectionRequestNotFoundError";
  }
}

export class SameUserDualApprovalError extends HistoricalCorrectionError {
  constructor(userId: string) {
    super(
      "SAME_USER_DUAL_APPROVAL",
      `User '${userId}' cannot provide both Owner and Accountant approvals. DEC-069 requires two distinct user identities.`,
    );
    this.name = "SameUserDualApprovalError";
  }
}

export class IncompleteDualApprovalError extends HistoricalCorrectionError {
  constructor(correctionRequestId: string) {
    super(
      "INCOMPLETE_DUAL_APPROVAL",
      `Correction request '${correctionRequestId}' requires both Owner and Accountant approvals (DEC-070) before execution.`,
    );
    this.name = "IncompleteDualApprovalError";
  }
}

export class CorrectionAlreadyExecutedError extends HistoricalCorrectionError {
  constructor(correctionRequestId: string) {
    super(
      "CORRECTION_ALREADY_EXECUTED",
      `Correction request '${correctionRequestId}' has already been executed.`,
    );
    this.name = "CorrectionAlreadyExecutedError";
  }
}

export class CorrectionAlreadyApprovedError extends HistoricalCorrectionError {
  constructor(correctionRequestId: string, role: string) {
    super(
      "CORRECTION_ALREADY_APPROVED",
      `Correction request '${correctionRequestId}' already has ${role} approval.`,
    );
    this.name = "CorrectionAlreadyApprovedError";
  }
}

export class CorrectionFaultInjectedError extends HistoricalCorrectionError {
  constructor() {
    super(
      "CORRECTION_FAULT_INJECTED",
      `Fault injected after domain effect for rollback testing. All operational effects must roll back.`,
    );
    this.name = "CorrectionFaultInjectedError";
  }
}

// ---------------------------------------------------------------------------
// Domain correction hook (for correction execution through domain services).
// ---------------------------------------------------------------------------

/**
 * Hook that performs the actual correction effect through domain services
 * (InventoryLedgerService.postReversal, SubledgerService.postReversalEntry, etc.)
 * within the correction transaction.
 *
 * This MUST NOT do direct table writes — it must call the domain posting
 * services which own inventory movements, account entries, etc.
 */
export interface CorrectionDomainHook {
  executeCorrection(
    tenantId: string,
    userId: string,
    correctionRequest: HistoricalCorrectionRequest,
    batch: ImportBatch,
    faultInjection?: "after_domain_effect" | null,
  ): Promise<{ correctedEntityType: string; correctedEntityId: string }>;
}

// ---------------------------------------------------------------------------
// Service deps.
// ---------------------------------------------------------------------------

export interface HistoricalCorrectionServiceDeps {
  repository: HistoricalCorrectionRepository;
  audit: AuditTransactionHandle;
  idempotency: IdempotencyTransactionHandle;
  documentSequence: DocumentSequenceTransactionHandle;
  /**
   * Optional domain correction hook for executing corrections.
   * When absent, executeCorrection throws (correction execution not configured).
   */
  correctionDomainHook?: CorrectionDomainHook;
  /**
   * WP-08-01F Production Correction Hook: Transaction runner for atomic
   * executeCorrection. The entire mutation phase (hook call +
   * updateCorrectionResult + audit + idempotency markSucceeded) commits
   * or rolls back together.
   */
  transactionRunner?: <T>(work: (tx: unknown) => Promise<T>) => Promise<T>;
}

// ---------------------------------------------------------------------------
// Constants.
// ---------------------------------------------------------------------------

const CORRECTION_ENTITY_TYPE = "historical_correction_request";
const CORRECTION_AUDIT_ACTION = "historical_correction";

// ---------------------------------------------------------------------------
// HistoricalCorrectionService.
// ---------------------------------------------------------------------------

export class HistoricalCorrectionService {
  constructor(private readonly deps: HistoricalCorrectionServiceDeps) {}

  // ===========================================================================
  // 1. Create correction request.
  // ===========================================================================

  /**
   * Create a correction request linked to a committed historical batch.
   *
   * Permission: migration.prepare (Owner/Accountant)
   *
   * Preconditions:
   *   - Batch exists + belongs to tenant
   *   - Batch status = "committed" (only committed history can be corrected)
   *   - Reason is provided
   *   - Idempotency key is valid
   *
   * The original committed records remain immutable. This creates a NEW
   * correction request record linked to the original.
   */
  async createCorrectionRequest(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: CreateCorrectionRequestInput,
  ): Promise<CreateCorrectionRequestResult> {
    requirePermission(effective, "migration.prepare");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!input.importBatchId?.trim()) {
      throw new HistoricalCorrectionError("VALIDATION_FAILED", "importBatchId is required.");
    }
    if (!input.reason?.trim()) {
      throw new HistoricalCorrectionError("VALIDATION_FAILED", "reason is required.");
    }
    if (!input.idempotencyKey?.trim()) {
      throw new HistoricalCorrectionError("VALIDATION_FAILED", "idempotencyKey is required.");
    }
    if (!input.originalEntityType?.trim()) {
      throw new HistoricalCorrectionError("VALIDATION_FAILED", "originalEntityType is required.");
    }
    if (!input.originalEntityId?.trim()) {
      throw new HistoricalCorrectionError("VALIDATION_FAILED", "originalEntityId is required.");
    }

    // Verify batch exists and is committed
    const batch = await this.deps.repository.findImportBatchById(user.tenantId, input.importBatchId);
    if (!batch) throw new CorrectionBatchNotFoundError(input.importBatchId);
    requireTenantMatch(user, batch.tenantId);

    if (batch.status !== "committed") {
      throw new BatchNotCommittedError(input.importBatchId, batch.status);
    }

    // Claim idempotency
    const now = new Date();
    const claim = await claimIdempotency(this.deps.idempotency, {
      tenantId: user.tenantId,
      operationScope: "historical_correction.create",
      idempotencyKey: input.idempotencyKey,
      requestBody: {
        importBatchId: input.importBatchId,
        originalEntityType: input.originalEntityType,
        originalEntityId: input.originalEntityId,
        correctionType: input.correctionType,
        reason: input.reason,
      } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    });

    if (claim.action === "replay") {
      const responseBody = claim.record.responseBody as Partial<CreateCorrectionRequestResult> | null;
      if (responseBody?.correctionRequestId) {
        return { ...responseBody, action: "replayed" } as CreateCorrectionRequestResult;
      }
    }
    if (claim.action === "conflict") {
      throw new HistoricalCorrectionError("IDEMPOTENCY_CONFLICT", "Idempotency key conflict.");
    }
    if (claim.action === "in_progress") {
      throw new HistoricalCorrectionError("OPERATION_IN_PROGRESS", "Operation in progress.");
    }

    // Allocate doc_no for the correction request
    const year = now.getUTCFullYear();
    const docNoResult = await allocateDocumentNumber(this.deps.documentSequence, {
      tenantId: user.tenantId,
      documentType: "correction_request",
      year,
      entityType: CORRECTION_ENTITY_TYPE,
    });

    // Insert the correction request
    const request = await this.deps.repository.insertCorrectionRequest({
      tenantId: user.tenantId,
      docNo: docNoResult.docNo,
      importBatchId: input.importBatchId,
      originalEntityType: input.originalEntityType,
      originalEntityId: input.originalEntityId,
      correctionType: input.correctionType,
      reason: input.reason,
      proposedCorrectionJson: input.proposedCorrectionJson,
      impactAnalysisJson: input.impactAnalysisJson,
      createdBy: user.userId,
    });

    // Update status to pending_review
    await this.deps.repository.updateCorrectionStatus(user.tenantId, request.id, {
      status: "pending_review",
      updatedBy: user.userId,
    });

    // Audit
    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: CORRECTION_ENTITY_TYPE,
      entityId: request.id,
      actionType: `${CORRECTION_AUDIT_ACTION}.create`,
      newValuesJson: {
        docNo: request.docNo,
        importBatchId: input.importBatchId,
        originalEntityType: input.originalEntityType,
        originalEntityId: input.originalEntityId,
        correctionType: input.correctionType,
        reason: input.reason,
        batchStatusAtCreation: batch.status,
      },
      idempotencyKey: input.idempotencyKey,
    });

    const result: CreateCorrectionRequestResult = {
      action: "created",
      correctionRequestId: request.id,
      docNo: request.docNo,
      status: "pending_review",
    };

    await markSucceeded(this.deps.idempotency, claim.record.id, {
      responseCode: 200, responseBody: result,
      entityType: CORRECTION_ENTITY_TYPE, entityId: request.id,
    }, claim.record.ownerToken!, now);

    return result;
  }

  // ===========================================================================
  // 2. Approve correction request (renewed dual approval — DEC-070).
  // ===========================================================================

  /**
   * Record one Owner or Accountant approval for a correction request.
   *
   * Permission: migration.approve
   * DEC-070: Renewed dual approval required for post-commit corrections.
   * DEC-069: Same user cannot provide both approvals.
   */
  async approveCorrection(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: ApproveCorrectionInput,
  ): Promise<ApproveCorrectionResult> {
    requirePermission(effective, "migration.approve");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!input.correctionRequestId?.trim()) {
      throw new HistoricalCorrectionError("VALIDATION_FAILED", "correctionRequestId is required.");
    }
    if (!input.idempotencyKey?.trim()) {
      throw new HistoricalCorrectionError("VALIDATION_FAILED", "idempotencyKey is required.");
    }
    if (input.approverRole !== "owner" && input.approverRole !== "accountant") {
      throw new HistoricalCorrectionError("VALIDATION_FAILED", "approverRole must be 'owner' or 'accountant'.");
    }

    const request = await this.deps.repository.findCorrectionRequestById(user.tenantId, input.correctionRequestId);
    if (!request) throw new CorrectionRequestNotFoundError(input.correctionRequestId);
    requireTenantMatch(user, request.tenantId);

    // Check status — must be pending_review or approved
    if (request.status === "rejected" || request.status === "cancelled") {
      throw new HistoricalCorrectionError(
        "INVALID_STATUS",
        `Correction request '${input.correctionRequestId}' has status '${request.status}' and cannot be approved.`,
      );
    }
    if (request.status === "approved") {
      // Already fully approved — check if this role already approved
      if (input.approverRole === "owner" && request.ownerApprovedBy) {
        throw new CorrectionAlreadyApprovedError(input.correctionRequestId, "owner");
      }
      if (input.approverRole === "accountant" && request.accountantApprovedBy) {
        throw new CorrectionAlreadyApprovedError(input.correctionRequestId, "accountant");
      }
    }

    // DEC-069: Check that this user has NOT already provided the OTHER role's approval
    const otherRole = input.approverRole === "owner" ? "accountant" : "owner";
    const otherApprovedBy = otherRole === "owner" ? request.ownerApprovedBy : request.accountantApprovedBy;
    if (otherApprovedBy && otherApprovedBy === user.userId) {
      throw new SameUserDualApprovalError(user.userId);
    }

    // Check if this role already approved (idempotent replay)
    const thisApprovedBy = input.approverRole === "owner" ? request.ownerApprovedBy : request.accountantApprovedBy;
    if (thisApprovedBy) {
      if (thisApprovedBy === user.userId) {
        // Replay
        return {
          action: "replayed",
          correctionRequestId: input.correctionRequestId,
          status: request.status,
        };
      } else {
        throw new CorrectionAlreadyApprovedError(input.correctionRequestId, input.approverRole);
      }
    }

    // Claim idempotency
    const now = new Date();
    const claim = await claimIdempotency(this.deps.idempotency, {
      tenantId: user.tenantId,
      operationScope: "historical_correction.approve",
      idempotencyKey: input.idempotencyKey,
      requestBody: {
        correctionRequestId: input.correctionRequestId,
        approverRole: input.approverRole,
      } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    });

    if (claim.action === "replay") {
      const responseBody = claim.record.responseBody as Partial<ApproveCorrectionResult> | null;
      if (responseBody?.correctionRequestId) {
        return { ...responseBody, action: "replayed" } as ApproveCorrectionResult;
      }
    }
    if (claim.action === "conflict") {
      throw new HistoricalCorrectionError("IDEMPOTENCY_CONFLICT", "Idempotency key conflict.");
    }
    if (claim.action === "in_progress") {
      throw new HistoricalCorrectionError("OPERATION_IN_PROGRESS", "Operation in progress.");
    }

    // Record the approval
    if (input.approverRole === "owner") {
      await this.deps.repository.updateCorrectionOwnerApproval(user.tenantId, input.correctionRequestId, {
        ownerApprovedBy: user.userId,
        ownerApprovedAt: now,
      });
    } else {
      await this.deps.repository.updateCorrectionAccountantApproval(user.tenantId, input.correctionRequestId, {
        accountantApprovedBy: user.userId,
        accountantApprovedAt: now,
      });
    }

    // Audit
    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: CORRECTION_ENTITY_TYPE,
      entityId: input.correctionRequestId,
      actionType: `${CORRECTION_AUDIT_ACTION}.approve_${input.approverRole}`,
      newValuesJson: {
        approverRole: input.approverRole,
        approverUserId: user.userId,
      },
      idempotencyKey: input.idempotencyKey,
    });

    // Check if both approvals now exist → update status to "approved"
    const updated = await this.deps.repository.findCorrectionRequestById(user.tenantId, input.correctionRequestId);
    let newStatus = updated?.status ?? "pending_review";
    if (updated?.ownerApprovedBy && updated?.accountantApprovedBy) {
      // Verify distinct users (DEC-069)
      if (updated.ownerApprovedBy === updated.accountantApprovedBy) {
        throw new SameUserDualApprovalError(updated.ownerApprovedBy);
      }
      newStatus = "approved";
      await this.deps.repository.updateCorrectionStatus(user.tenantId, input.correctionRequestId, {
        status: "approved",
        updatedBy: user.userId,
      });
    }

    const result: ApproveCorrectionResult = {
      action: "approved",
      correctionRequestId: input.correctionRequestId,
      status: newStatus,
    };

    await markSucceeded(this.deps.idempotency, claim.record.id, {
      responseCode: 200, responseBody: result,
      entityType: CORRECTION_ENTITY_TYPE, entityId: input.correctionRequestId,
    }, claim.record.ownerToken!, now);

    return result;
  }

  // ===========================================================================
  // 3. Execute correction (through domain services).
  // ===========================================================================

  /**
   * Execute an approved correction request through domain services.
   *
   * Permission: migration.commit
   *
   * Preconditions:
   *   - Correction request exists + belongs to tenant
   *   - Status = "approved" (both Owner + Accountant approved — DEC-070)
   *   - Not already executed
   *   - Domain correction hook is configured
   *   - Idempotency key is valid
   *
   * The correction hook calls domain services (InventoryLedgerService,
   * SubledgerService) to create compensating/reversal effects.
   * Original committed records remain immutable.
   */
  async executeCorrection(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: ExecuteCorrectionInput,
  ): Promise<ExecuteCorrectionResult> {
    requirePermission(effective, "migration.commit");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!input.correctionRequestId?.trim()) {
      throw new HistoricalCorrectionError("VALIDATION_FAILED", "correctionRequestId is required.");
    }
    if (!input.idempotencyKey?.trim()) {
      throw new HistoricalCorrectionError("VALIDATION_FAILED", "idempotencyKey is required.");
    }

    const request = await this.deps.repository.findCorrectionRequestById(user.tenantId, input.correctionRequestId);
    if (!request) throw new CorrectionRequestNotFoundError(input.correctionRequestId);
    requireTenantMatch(user, request.tenantId);

    // Check status — must be approved
    if (request.status === "approved" && request.correctedEntityId) {
      // Already executed — return replay
      const result: ExecuteCorrectionResult = {
        action: "replayed",
        correctionRequestId: input.correctionRequestId,
        correctedEntityType: request.correctedEntityType!,
        correctedEntityId: request.correctedEntityId!,
      };
      return result;
    }
    if (request.status !== "approved") {
      throw new IncompleteDualApprovalError(input.correctionRequestId);
    }

    // Check domain hook is configured
    if (!this.deps.correctionDomainHook) {
      throw new HistoricalCorrectionError(
        "NO_CORRECTION_HOOK",
        "Correction domain hook is not configured. Cannot execute correction.",
      );
    }

    // Claim idempotency
    const now = new Date();
    const claim = await claimIdempotency(this.deps.idempotency, {
      tenantId: user.tenantId,
      operationScope: "historical_correction.execute",
      idempotencyKey: input.idempotencyKey,
      requestBody: { correctionRequestId: input.correctionRequestId } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 300000, // 5 minutes
      now,
    });

    if (claim.action === "replay") {
      const responseBody = claim.record.responseBody as Partial<ExecuteCorrectionResult> | null;
      if (responseBody?.correctionRequestId) {
        return { ...responseBody, action: "replayed" } as ExecuteCorrectionResult;
      }
    }
    if (claim.action === "conflict") {
      throw new HistoricalCorrectionError("IDEMPOTENCY_CONFLICT", "Idempotency key conflict.");
    }
    if (claim.action === "in_progress") {
      throw new HistoricalCorrectionError("OPERATION_IN_PROGRESS", "Correction execution in progress.");
    }

    // Fetch the original batch
    const batch = await this.deps.repository.findImportBatchById(user.tenantId, request.importBatchId);
    if (!batch) throw new CorrectionBatchNotFoundError(request.importBatchId);

    // WP-08-01F Production Correction Hook: The entire mutation phase
    // (hook call + updateCorrectionResult + audit + idempotency markSucceeded)
    // is atomic — all commit or all roll back.
    const executeAtomically = async (): Promise<ExecuteCorrectionResult> => {
      const correctionResult = await this.deps.correctionDomainHook!.executeCorrection(
        user.tenantId,
        user.userId,
        request,
        batch,
        input.faultInjection,
      );

      // Update the correction request with the result
      await this.deps.repository.updateCorrectionResult(user.tenantId, input.correctionRequestId, {
        correctedEntityType: correctionResult.correctedEntityType,
        correctedEntityId: correctionResult.correctedEntityId,
        status: "approved", // Keep status as approved but with correctedEntityId set
        updatedBy: user.userId,
      });

      // Audit
      await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
        entityType: CORRECTION_ENTITY_TYPE,
        entityId: input.correctionRequestId,
        actionType: `${CORRECTION_AUDIT_ACTION}.execute`,
        newValuesJson: {
          correctedEntityType: correctionResult.correctedEntityType,
          correctedEntityId: correctionResult.correctedEntityId,
          importBatchId: request.importBatchId,
          originalEntityType: request.originalEntityType,
          originalEntityId: request.originalEntityId,
          correctionType: request.correctionType,
        },
        idempotencyKey: input.idempotencyKey,
      });

      const result: ExecuteCorrectionResult = {
        action: "executed",
        correctionRequestId: input.correctionRequestId,
        correctedEntityType: correctionResult.correctedEntityType,
        correctedEntityId: correctionResult.correctedEntityId,
      };

      // markSucceeded inside the transaction — owner-token-fenced
      await markSucceeded(this.deps.idempotency, claim.record.id, {
        responseCode: 200, responseBody: result,
        entityType: CORRECTION_ENTITY_TYPE, entityId: input.correctionRequestId,
      }, claim.record.ownerToken!, now);

      return result;
    };

    try {
      if (this.deps.transactionRunner) {
        return await this.deps.transactionRunner(executeAtomically);
      } else {
        return await executeAtomically();
      }
    } catch (e) {
      // Mark idempotency as business failed
      try {
        await markBusinessFailed(this.deps.idempotency, claim.record.id, {
          responseCode: 500,
          responseBody: { error: (e as Error).message, code: (e as any)?.code ?? "CORRECTION_FAILED" },
          lastErrorClass: (e as Error).name ?? "Error",
          entityType: CORRECTION_ENTITY_TYPE,
          entityId: input.correctionRequestId,
        }, claim.record.ownerToken!, now);
      } catch {
        // Best-effort
      }
      throw e;
    }
  }

  // ===========================================================================
  // 4. Query helpers (read-only).
  // ===========================================================================

  async listCorrectionRequests(
    user: ErpUserContext,
    effective: EffectivePermissions,
    batchId: string,
  ): Promise<HistoricalCorrectionRequest[]> {
    requirePermission(effective, "migration.review");
    return this.deps.repository.findCorrectionRequestsForBatch(user.tenantId, batchId);
  }

  async getCorrectionRequest(
    user: ErpUserContext,
    effective: EffectivePermissions,
    correctionRequestId: string,
  ): Promise<HistoricalCorrectionRequest | null> {
    requirePermission(effective, "migration.review");
    const request = await this.deps.repository.findCorrectionRequestById(user.tenantId, correctionRequestId);
    if (request) requireTenantMatch(user, request.tenantId);
    return request;
  }
}
