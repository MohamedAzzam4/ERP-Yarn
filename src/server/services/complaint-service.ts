/**
 * Complaint Service — WP-06-02.
 *
 * Contract: docs/contracts/13_work_packages.md WP-06-02
 *   Goal: Link complaint investigation to customer/sale/item/quality history.
 *   Implementation notes: "Complaint alone posts no stock/account effect."
 *   What not to change: "No automatic return/credit."
 *   Common failures: "Complaint status mutates sale."
 *
 * Contract: docs/contracts/03_database_schema_contract.md §13
 *   complaints reference item/batch/lot/customer/sale and store dates,
 *   statuses, investigation and actors.
 *
 * Contract: docs/contracts/11_permission_matrix.md
 *   complaints.investigate — view-with-comment action (Owner, Accountant, Quality).
 *   Warehouse/Production: no financial leak, no complaint visibility.
 *
 * WP-06-02 SCOPE:
 *   - Create complaint/investigation draft
 *   - Link complaint to customer/sale/sale line/item/quality test
 *   - Update investigation status/notes
 *   - List open complaints
 *   - Trace complaint history (list by customer/sale/item/quality test)
 *
 * WP-06-02 NON-SCOPE:
 *   - Stock movements (Contract 04)
 *   - Account entries / payments / settlements (Contract 07)
 *   - Sale approval (WP-05-03)
 *   - Return approval (WP-06-03)
 *   - Replacement flow (WP-06-04)
 *   - Auto-return stock
 *   - Release reservations
 *   - Clear quality holds
 *   - Financial treatment
 *
 * CORE RULE:
 *   Complaint alone creates NO side effects. It does NOT mutate sale_status,
 *   create stock movements, account entries, payments, or reservations.
 *   A complaint is a trace/investigation record only.
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
  markRetryableFailed,
  IdempotencyOwnershipLostError,
  type IdempotencyTransactionHandle,
  type IdempotencyClaimInput,
} from "./idempotency-service";
import {
  allocateDocumentNumber,
  type DocumentSequenceTransactionHandle,
} from "./document-sequence-service";
import type { ComplaintRepository } from "./complaint-repository";
import type { Complaint } from "@/server/db/schema/quality";

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

export type ComplaintStatus = "open" | "investigating" | "resolved" | "closed";
export type ComplaintPriority = "low" | "normal" | "high" | "urgent";

export interface CreateComplaintInput {
  complaintDate: string;
  customerId?: string | null;
  saleId?: string | null;
  saleLineId?: string | null;
  itemId?: string | null;
  qualityTestId?: string | null;
  rawMaterialBatchId?: string | null;
  yarnLotId?: string | null;
  subject: string;
  description?: string | null;
  priority?: ComplaintPriority;
  notes?: string | null;
  idempotencyKey: string;
}

export interface UpdateComplaintInput {
  complaintId: string;
  status?: ComplaintStatus;
  priority?: ComplaintPriority;
  investigationNotes?: string | null;
  resolutionNotes?: string | null;
  resolutionType?: string | null;
  notes?: string | null;
  idempotencyKey: string;
}

export interface CreateComplaintResult {
  action: "created" | "replayed";
  complaintId: string;
  complaintNo: string;
  status: ComplaintStatus;
}

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

export class ComplaintError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = "ComplaintError"; this.code = code; }
}

export class ComplaintNotFoundError extends ComplaintError {
  constructor(id: string) { super("COMPLAINT_NOT_FOUND", `Complaint '${id}' not found.`); this.name = "ComplaintNotFoundError"; }
}

// ---------------------------------------------------------------------------
// Constants.
// ---------------------------------------------------------------------------

const COMPLAINT_ENTITY_TYPE = "complaint";

const ALLOWED_STATUSES: ReadonlySet<ComplaintStatus> = new Set([
  "open", "investigating", "resolved", "closed",
]);

const ALLOWED_PRIORITIES: ReadonlySet<ComplaintPriority> = new Set([
  "low", "normal", "high", "urgent",
]);

// ---------------------------------------------------------------------------
// Service deps.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Transaction composition types (WP-08-01E Milestone A transaction correction).
// ---------------------------------------------------------------------------

export type ComplaintTransactionRunner = <T>(work: (tx: unknown) => Promise<T>) => Promise<T>;

export interface ComplaintTransactionScopedFactories {
  createComplaintRepository: (tx: unknown) => ComplaintRepository;
  createIdempotency: (tx: unknown) => IdempotencyTransactionHandle;
  createAudit: (tx: unknown) => AuditTransactionHandle;
  createDocumentSequence: (tx: unknown) => DocumentSequenceTransactionHandle;
}

export interface ComplaintServiceDeps {
  complaintRepository: ComplaintRepository;
  audit: AuditTransactionHandle;
  idempotency: IdempotencyTransactionHandle;
  documentSequence: DocumentSequenceTransactionHandle;
  /** Optional transaction runner for atomic business writes + markSucceeded. */
  transactionRunner?: ComplaintTransactionRunner;
  /** Optional tx-scoped factories. */
  txFactories?: ComplaintTransactionScopedFactories;
}

// ---------------------------------------------------------------------------
// ComplaintService.
// ---------------------------------------------------------------------------

export class ComplaintService {
  constructor(private readonly deps: ComplaintServiceDeps) {
    // WP-08-01E Task A: fail-closed validation
    if (!!this.deps.transactionRunner !== !!this.deps.txFactories) {
      throw new Error(
        "CONFIGURATION_ERROR: transactionRunner and txFactories must both be provided or both be absent.",
      );
    }
  }

  private requireTransactionConfig(): {
    transactionRunner: ComplaintTransactionRunner;
    txFactories: ComplaintTransactionScopedFactories;
  } {
    if (!this.deps.transactionRunner || !this.deps.txFactories) {
      throw new Error(
        "CONFIGURATION_ERROR: transactionRunner and txFactories are required for production mutation commands. " +
        "Unit tests must explicitly provide a simulated transaction runner.",
      );
    }
    return {
      transactionRunner: this.deps.transactionRunner,
      txFactories: this.deps.txFactories,
    };
  }

  /**
   * Create a complaint/investigation draft.
   *
   * Permission: complaints.investigate (Owner, Accountant, Quality).
   * Warehouse/Production denied.
   *
   * The complaint is a trace/investigation record only. It does NOT:
   *   - Create stock movements
   *   - Create account entries / payments / settlements
   *   - Approve sales or returns
   *   - Auto-return stock
   *   - Release reservations
   *   - Clear quality holds
   *   - Mutate sale_status or any domain entity's state
   */
  async createComplaint(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: CreateComplaintInput,
  ): Promise<CreateComplaintResult> {
    requirePermission(effective, "complaints.investigate");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!input.subject?.trim()) throw new ComplaintError("VALIDATION_FAILED", "subject is required.");
    if (!input.complaintDate?.trim()) throw new ComplaintError("VALIDATION_FAILED", "complaintDate is required.");
    if (!input.idempotencyKey?.trim()) throw new ComplaintError("VALIDATION_FAILED", "idempotencyKey is required.");
    // At least one linked entity should be provided
    if (
      !input.customerId &&
      !input.saleId &&
      !input.itemId &&
      !input.qualityTestId &&
      !input.yarnLotId &&
      !input.rawMaterialBatchId
    ) {
      throw new ComplaintError("VALIDATION_FAILED", "At least one linked entity (customer/sale/item/quality test/yarn lot/raw material batch) is required.");
    }

    const priority: ComplaintPriority = input.priority ?? "normal";
    if (!ALLOWED_PRIORITIES.has(priority)) {
      throw new ComplaintError("VALIDATION_FAILED", `Invalid priority '${priority}'.`);
    }

    // Claim idempotency
    const now = new Date();
    const idempotencyInput: IdempotencyClaimInput = {
      tenantId: user.tenantId,
      operationScope: "complaint.create",
      idempotencyKey: input.idempotencyKey,
      requestBody: {
        complaintDate: input.complaintDate,
        customerId: input.customerId ?? null,
        saleId: input.saleId ?? null,
        saleLineId: input.saleLineId ?? null,
        itemId: input.itemId ?? null,
        qualityTestId: input.qualityTestId ?? null,
        subject: input.subject,
        description: input.description ?? null,
        priority,
        notes: input.notes ?? null,
      } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    };

    const claim = await claimIdempotency(this.deps.idempotency, idempotencyInput);

    if (claim.action === "replay") {
      const responseBody = claim.record.responseBody as Partial<CreateComplaintResult> | null;
      if (responseBody?.complaintId) {
        return { ...responseBody, action: "replayed" } as CreateComplaintResult;
      }
      throw new ComplaintError(
        "IDEMPOTENCY_REPLAY_OF_FAILURE",
        `Idempotency key '${input.idempotencyKey}' was previously used and failed (${claim.record.lastErrorClass ?? "unknown"}). The same key cannot be reused.`,
      );
    }
    if (claim.action === "conflict") {
      throw new ComplaintError("IDEMPOTENCY_CONFLICT", `Idempotency key '${input.idempotencyKey}' was used with a different request body.`);
    }
    if (claim.action === "in_progress") {
      throw new ComplaintError("OPERATION_IN_PROGRESS", `Operation '${input.idempotencyKey}' is still in progress.`);
    }

    // Execute business writes + markSucceeded inside a single transaction
    // (WP-08-01E Milestone A transaction correction).
    const executeCreate = async (
      txScoped: {
        complaintRepository: ComplaintRepository;
        idempotency: IdempotencyTransactionHandle;
        audit: AuditTransactionHandle;
        documentSequence: DocumentSequenceTransactionHandle;
      } | null,
    ): Promise<CreateComplaintResult> => {
      const repo = txScoped?.complaintRepository ?? this.deps.complaintRepository;
      const idemHandle = txScoped?.idempotency ?? this.deps.idempotency;
      const auditHandle = txScoped?.audit ?? this.deps.audit;
      const docSeqHandle = txScoped?.documentSequence ?? this.deps.documentSequence;

      const year = now.getUTCFullYear();
      const docNoResult = await allocateDocumentNumber(docSeqHandle, {
        tenantId: user.tenantId, documentType: "complaint", year, entityType: COMPLAINT_ENTITY_TYPE,
      });

      const complaint = await repo.insertComplaint({
        tenantId: user.tenantId,
        complaintNo: docNoResult.docNo,
        complaintDate: input.complaintDate,
        customerId: input.customerId ?? null,
        saleId: input.saleId ?? null,
        saleLineId: input.saleLineId ?? null,
        itemId: input.itemId ?? null,
        qualityTestId: input.qualityTestId ?? null,
        rawMaterialBatchId: input.rawMaterialBatchId ?? null,
        yarnLotId: input.yarnLotId ?? null,
        subject: input.subject,
        description: input.description ?? null,
        status: "open",
        priority,
        notes: input.notes ?? null,
        createdBy: user.userId,
      });

      repo.recordIdempotencyKey?.(user.tenantId, input.idempotencyKey, complaint.id);

      // Audit (tx-scoped)
      await appendAuditLog(auditHandle, user.tenantId, user.userId, {
        entityType: COMPLAINT_ENTITY_TYPE,
        entityId: complaint.id,
        actionType: "complaint.create",
        newValuesJson: {
          complaintNo: complaint.complaintNo,
          complaintDate: complaint.complaintDate,
          customerId: complaint.customerId,
          saleId: complaint.saleId,
          saleLineId: complaint.saleLineId,
          itemId: complaint.itemId,
          qualityTestId: complaint.qualityTestId,
          subject: complaint.subject,
          priority: complaint.priority,
          status: "open",
          createdBy: user.userId,
        },
        idempotencyKey: input.idempotencyKey,
      });

      const result: CreateComplaintResult = {
        action: "created",
        complaintId: complaint.id,
        complaintNo: complaint.complaintNo,
        status: "open",
      };
      await markSucceeded(idemHandle, claim.record.id, {
        responseCode: 200,
        responseBody: result,
        entityType: COMPLAINT_ENTITY_TYPE,
        entityId: complaint.id,
      }, claim.record.ownerToken!, now);

      return result;
    };

    let result: CreateComplaintResult;
    try {
      const { transactionRunner, txFactories } = this.requireTransactionConfig();
      result = await transactionRunner(async (tx: unknown) => {
        const txRepo = txFactories.createComplaintRepository(tx);
        const txIdem = txFactories.createIdempotency(tx);
        const txAudit = txFactories.createAudit(tx);
        const txDocSeq = txFactories.createDocumentSequence(tx);
        return executeCreate({
          complaintRepository: txRepo,
          idempotency: txIdem,
          audit: txAudit,
          documentSequence: txDocSeq,
        });
      });
    } catch (txError) {
      // WP-08-01E CORRECTION: After transaction rollback, classify the failure.
      //
      // Ownership loss (IdempotencyOwnershipLostError) means this caller no
      // longer owns the record — another claimant has taken over the lease.
      // The stale caller MUST NOT call markBusinessFailed (the affected-row
      // count would be zero, and even if non-zero it would be wrong to
      // poison the reclaimed record with a durable-failure state). The
      // stale caller must propagate the ownership error after rollback.
      //
      // Other transaction failures (audit/infrastructure/transient) are
      // classified as retryable_failed: same-key retry will re-execute.
      // Durable business/domain failures are NOT handled here — they are
      // raised explicitly from the transaction body via markBusinessFailed
      // inside the transaction (so the durable failure is atomic with the
      // business write rollback).
      try {
        if (txError instanceof IdempotencyOwnershipLostError) {
          // Defensive stale update: attempt markRetryableFailed with the
          // stale expectedOwnerToken. This MUST affect zero rows because
          // the owner_token has been replaced by the reclaiming caller.
          // We never describe this as durable business_failed.
          const staleAffected = await markRetryableFailed(
            this.deps.idempotency, claim.record.id,
            {
              responseBody: { message: "Ownership lost; stale caller cannot mark." },
              lastErrorClass: "IdempotencyOwnershipLostError",
            },
            claim.record.ownerToken!, now,
          );
          if (staleAffected !== 0) {
            console.error(
              "INVARIANT VIOLATION: stale markRetryableFailed affected rows =",
              staleAffected,
              "for record", claim.record.id,
              "— expected 0 because IdempotencyOwnershipLostError was thrown.",
            );
          }
        } else {
          await markRetryableFailed(this.deps.idempotency, claim.record.id, {
            responseBody: { message: "Transaction failed and rolled back." },
            lastErrorClass: txError instanceof Error ? txError.name : "Unknown",
          }, claim.record.ownerToken!, now);
        }
      } catch (markError) {
        console.error("Failed to mark idempotency after tx rollback:", markError);
      }
      throw txError;
    }

    return result;
  }

  /**
   * Update a complaint's investigation status/notes/resolution.
   *
   * Permission: complaints.investigate (Owner, Accountant, Quality).
   */
  async updateComplaint(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: UpdateComplaintInput,
  ): Promise<{ action: "updated" | "replayed"; complaintId: string; status: ComplaintStatus }> {
    requirePermission(effective, "complaints.investigate");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!input.complaintId?.trim()) throw new ComplaintError("VALIDATION_FAILED", "complaintId is required.");
    if (!input.idempotencyKey?.trim()) throw new ComplaintError("VALIDATION_FAILED", "idempotencyKey is required.");

    const complaint = await this.deps.complaintRepository.findComplaintById(user.tenantId, input.complaintId);
    if (!complaint) throw new ComplaintNotFoundError(input.complaintId);
    requireTenantMatch(user, complaint.tenantId);

    // Don't allow updating closed complaints
    if (complaint.status === "closed" && input.status !== "closed") {
      throw new ComplaintError("STATE_CONFLICT", `Complaint '${complaint.id}' is closed and cannot be updated.`);
    }

    const now = new Date();
    const newStatus: ComplaintStatus = input.status ?? (complaint.status as ComplaintStatus);
    if (!ALLOWED_STATUSES.has(newStatus)) {
      throw new ComplaintError("VALIDATION_FAILED", `Invalid status '${newStatus}'.`);
    }

    // Claim idempotency
    const idempotencyInput: IdempotencyClaimInput = {
      tenantId: user.tenantId,
      operationScope: "complaint.update",
      idempotencyKey: input.idempotencyKey,
      requestBody: {
        complaintId: input.complaintId,
        status: newStatus,
        investigationNotes: input.investigationNotes ?? null,
        resolutionNotes: input.resolutionNotes ?? null,
        resolutionType: input.resolutionType ?? null,
        notes: input.notes ?? null,
      } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    };

    const claim = await claimIdempotency(this.deps.idempotency, idempotencyInput);

    if (claim.action === "replay") {
      const responseBody = claim.record.responseBody as { complaintId?: string; status?: ComplaintStatus } | null;
      if (responseBody?.complaintId) {
        return { action: "replayed", complaintId: responseBody.complaintId, status: responseBody.status! };
      }
      throw new ComplaintError(
        "IDEMPOTENCY_REPLAY_OF_FAILURE",
        `Idempotency key '${input.idempotencyKey}' was previously used and failed (${claim.record.lastErrorClass ?? "unknown"}). The same key cannot be reused.`,
      );
    }
    if (claim.action === "conflict") {
      throw new ComplaintError("IDEMPOTENCY_CONFLICT", `Idempotency key '${input.idempotencyKey}' was used with a different request body.`);
    }
    if (claim.action === "in_progress") {
      throw new ComplaintError("OPERATION_IN_PROGRESS", `Operation '${input.idempotencyKey}' is still in progress.`);
    }

    // Determine investigation/resolution fields based on status transition
    const patch: import("./complaint-repository").UpdateComplaintInput = {
      status: newStatus,
      investigationNotes: input.investigationNotes ?? complaint.investigationNotes,
      resolutionNotes: input.resolutionNotes ?? complaint.resolutionNotes,
      resolutionType: input.resolutionType ?? complaint.resolutionType,
      notes: input.notes ?? complaint.notes,
      updatedBy: user.userId,
    };

    // If transitioning to investigating, set investigatedBy/At
    if (newStatus === "investigating" && complaint.status !== "investigating") {
      patch.investigatedBy = user.userId;
      patch.investigatedAt = now;
    }

    // If transitioning to resolved or closed, set resolvedBy/At
    if ((newStatus === "resolved" || newStatus === "closed") && complaint.status !== "resolved" && complaint.status !== "closed") {
      patch.resolvedBy = user.userId;
      patch.resolvedAt = now;
    }

    // Execute business writes + markSucceeded inside a single transaction
    // (WP-08-01E Milestone A transaction correction).
    const executeUpdate = async (
      txScoped: {
        complaintRepository: ComplaintRepository;
        idempotency: IdempotencyTransactionHandle;
        audit: AuditTransactionHandle;
      } | null,
    ): Promise<{ action: "updated"; complaintId: string; status: ComplaintStatus }> => {
      const repo = txScoped?.complaintRepository ?? this.deps.complaintRepository;
      const idemHandle = txScoped?.idempotency ?? this.deps.idempotency;
      const auditHandle = txScoped?.audit ?? this.deps.audit;

      const updated = await repo.updateComplaint(
        user.tenantId, input.complaintId, patch,
      );
      if (!updated) {
        throw new ComplaintError("INTERNAL_TRANSACTION_FAILED", `Complaint '${input.complaintId}' could not be updated.`);
      }

      // Audit (tx-scoped)
      await appendAuditLog(auditHandle, user.tenantId, user.userId, {
        entityType: COMPLAINT_ENTITY_TYPE,
        entityId: complaint.id,
        actionType: "complaint.update",
        newValuesJson: {
          complaintNo: complaint.complaintNo,
          previousStatus: complaint.status,
          newStatus,
          investigationNotes: patch.investigationNotes,
          resolutionNotes: patch.resolutionNotes,
          resolutionType: patch.resolutionType,
          updatedBy: user.userId,
        },
        idempotencyKey: input.idempotencyKey,
      });

      const result = { action: "updated" as const, complaintId: complaint.id, status: newStatus };
      await markSucceeded(idemHandle, claim.record.id, {
        responseCode: 200,
        responseBody: result,
        entityType: COMPLAINT_ENTITY_TYPE,
        entityId: complaint.id,
      }, claim.record.ownerToken!, now);

      return result;
    };

    let result: { action: "updated" | "replayed"; complaintId: string; status: ComplaintStatus };
    try {
      const { transactionRunner, txFactories } = this.requireTransactionConfig();
      result = await transactionRunner(async (tx: unknown) => {
        const txRepo = txFactories.createComplaintRepository(tx);
        const txIdem = txFactories.createIdempotency(tx);
        const txAudit = txFactories.createAudit(tx);
        return executeUpdate({
          complaintRepository: txRepo,
          idempotency: txIdem,
          audit: txAudit,
        });
      });
    } catch (txError) {
      // WP-08-01E CORRECTION: After transaction rollback, classify the failure.
      //
      // Ownership loss (IdempotencyOwnershipLostError) means this caller no
      // longer owns the record — another claimant has taken over the lease.
      // The stale caller MUST NOT call markBusinessFailed. Defensive stale
      // markRetryableFailed must affect zero rows.
      //
      // Other transaction failures (audit/infrastructure/transient) are
      // retryable_failed: same-key retry will re-execute.
      try {
        if (txError instanceof IdempotencyOwnershipLostError) {
          const staleAffected = await markRetryableFailed(
            this.deps.idempotency, claim.record.id,
            {
              responseBody: { message: "Ownership lost; stale caller cannot mark." },
              lastErrorClass: "IdempotencyOwnershipLostError",
            },
            claim.record.ownerToken!, now,
          );
          if (staleAffected !== 0) {
            console.error(
              "INVARIANT VIOLATION: stale markRetryableFailed affected rows =",
              staleAffected,
              "for record", claim.record.id,
              "— expected 0 because IdempotencyOwnershipLostError was thrown.",
            );
          }
        } else {
          await markRetryableFailed(this.deps.idempotency, claim.record.id, {
            responseBody: { message: "Transaction failed and rolled back." },
            lastErrorClass: txError instanceof Error ? txError.name : "Unknown",
          }, claim.record.ownerToken!, now);
        }
      } catch (markError) {
        console.error("Failed to mark idempotency after tx rollback:", markError);
      }
      throw txError;
    }

    return result;
  }

  /**
   * List open complaints (status = open or investigating).
   *
   * Permission: complaints.investigate (Owner, Accountant, Quality).
   */
  async listOpenComplaints(
    user: ErpUserContext,
    effective: EffectivePermissions,
  ): Promise<Complaint[]> {
    requirePermission(effective, "complaints.investigate");
    return this.deps.complaintRepository.listOpenComplaints(user.tenantId);
  }

  /**
   * Trace complaint history for a customer.
   */
  async listComplaintsForCustomer(
    user: ErpUserContext,
    effective: EffectivePermissions,
    customerId: string,
  ): Promise<Complaint[]> {
    requirePermission(effective, "complaints.investigate");
    return this.deps.complaintRepository.listComplaintsForCustomer(user.tenantId, customerId);
  }

  /**
   * Trace complaint history for a sale.
   */
  async listComplaintsForSale(
    user: ErpUserContext,
    effective: EffectivePermissions,
    saleId: string,
  ): Promise<Complaint[]> {
    requirePermission(effective, "complaints.investigate");
    return this.deps.complaintRepository.listComplaintsForSale(user.tenantId, saleId);
  }

  /**
   * Trace complaint history for an item.
   */
  async listComplaintsForItem(
    user: ErpUserContext,
    effective: EffectivePermissions,
    itemId: string,
  ): Promise<Complaint[]> {
    requirePermission(effective, "complaints.investigate");
    return this.deps.complaintRepository.listComplaintsForItem(user.tenantId, itemId);
  }

  /**
   * Trace complaint history for a quality test.
   */
  async listComplaintsForQualityTest(
    user: ErpUserContext,
    effective: EffectivePermissions,
    qualityTestId: string,
  ): Promise<Complaint[]> {
    requirePermission(effective, "complaints.investigate");
    return this.deps.complaintRepository.listComplaintsForQualityTest(user.tenantId, qualityTestId);
  }
}
