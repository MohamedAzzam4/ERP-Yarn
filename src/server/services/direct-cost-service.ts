/**
 * Direct Cost Service — WP-05-05.
 *
 * Contract: docs/contracts/07_subledger_and_costs_contract.md §18
 *   §18 Worker Input: Only amount if known, simple responsibility
 *     (company, customer, factory, shared, unknown, included_elsewhere,
 *     needs_accountant_review) and notes. No actual payer, allocation,
 *     receivable/payable, settlement or profitability controls.
 *   §18 Accountant/Owner Review: Confirms amount, actual payer,
 *     responsibility/allocations, subledger effect, profitability inclusion,
 *     settlement and correction/reversal.
 *   §18 Posting Scenarios:
 *     - Company-borne: expense-like; no party receivable unless explicitly
 *       contracted; include in profitability only when reviewed/enabled.
 *     - Customer-borne: confirmed amount may create positive customer receivable.
 *     - Factory-borne: may create positive factory recovery/deduction after review.
 *     - Shared: allocations must total confirmed amount or 100%; review required.
 *     - Unknown/included elsewhere: no financial posting; review/not-required state.
 *   §18: "No direct-cost subledger entry before required review, except a
 *     specifically approved simple company-borne configuration."
 *
 * Contract: docs/contracts/07_subledger_and_costs_contract.md §20
 *   Version 1 at sale approval; new version after approved return, correction
 *   or reviewed cost completion. Old active → superseded (row immutable);
 *   at most one active; historical snapshots never silently recalculate.
 *
 * DEC-080: Requester cannot approve own request (if approval-style flow).
 *
 * WP-05-05 SCOPE:
 *   - Create direct cost draft (worker-safe: amount + responsibility + notes only)
 *   - Review direct cost (accountant/owner confirms amount, payer, allocations,
 *     profitability inclusion)
 *   - Approve/reject direct cost (DEC-080: requester cannot approve own)
 *   - On approval: post subledger entry (customer/factory-borne only) +
 *     insert allocations (shared) + create later profitability snapshot version
 *   - Idempotency, audit, permission checks
 *
 * WP-05-05 NON-SCOPE:
 *   - Payments/settlements (WP-05-04)
 *   - Sale approval (WP-05-03)
 *   - Stock movements
 *   - Direct cost reversal/correction (deferred)
 */
import "server-only";

import type { ErpUserContext } from "@/server/auth/erp-context";
import {
  requirePermission,
  requireTenantMatch,
  rejectBodyClaimsAuthority,
  PermissionDeniedError,
} from "@/server/security/guards";
import type { EffectivePermissions } from "@/server/security/effective-permissions";
import { appendAuditLog, type AuditTransactionHandle } from "./audit-service";
import {
  claimIdempotency,
  markSucceeded,
  markBusinessFailed,
  markRetryableFailed,
  type IdempotencyTransactionHandle,
  type IdempotencyClaimInput,
} from "./idempotency-service";
import {
  allocateDocumentNumber,
  type DocumentSequenceTransactionHandle,
} from "./document-sequence-service";
import type { SubledgerService } from "./subledger-service";
import type { ProfitabilitySnapshotService } from "./profitability-snapshot-service";
import type { DirectCostRepository } from "./direct-cost-repository";
import type { DirectCost } from "@/server/db/schema/subledger";
import {
  normalizeMoney, isPositiveMoney, isZeroMoney, addMoney, compareMoney,
} from "./decimal-money";

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

export type CostType = "transport" | "loading" | "unloading" | "customs" | "other";
export type CostResponsibilityType =
  | "company" | "customer" | "factory" | "shared"
  | "unknown" | "included_elsewhere" | "needs_accountant_review";
export type ActualPayerType =
  | "company" | "customer" | "factory" | "other" | "unknown" | "not_recorded";

export interface CreateDraftDirectCostInput {
  costType: CostType;
  linkedEntityType: string;  // sales_order, raw_material_batch, production_receipt
  linkedEntityId: string;
  /** Nullable — may be unknown at draft. */
  amount?: string | null;
  /** Worker-safe: only simple responsibility allowed at draft. */
  costResponsibilityType: CostResponsibilityType;
  notes?: string | null;
  idempotencyKey: string;
  currency?: string;
}

export interface ReviewDirectCostInput {
  directCostId: string;
  /** Confirmed amount (accountant/owner may correct). */
  amount: string;
  /** Confirmed responsibility (accountant/owner may change). */
  costResponsibilityType: CostResponsibilityType;
  /** Confirmed actual payer. */
  actualPayerType: ActualPayerType;
  /** Whether to include in profitability. */
  includedInProfitability: boolean;
  /** For shared: allocations must sum to amount. */
  allocations?: Array<{
    responsiblePartyType: "customer" | "supplier" | "factory";
    responsiblePartyId: string;
    shareAmount: string;
  }>;
  /** Linked entity owner (for subledger entry creation). */
  linkedOwnerType?: "customer" | "factory";
  linkedOwnerId?: string;
  notes?: string | null;
  idempotencyKey: string;
}

export interface ReviewDirectCostResult {
  action: "reviewed" | "replayed";
  directCostId: string;
  reviewStatus: string;
  subledgerEntryId: string | null;
  snapshotId: string | null;
  snapshotVersion: number | null;
}

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

export class DirectCostError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = "DirectCostError"; this.code = code; }
}

export class DirectCostNotFoundError extends DirectCostError {
  constructor(id: string) { super("DIRECT_COST_NOT_FOUND", `Direct cost '${id}' not found.`); this.name = "DirectCostNotFoundError"; }
}

export class DirectCostNotReviewableError extends DirectCostError {
  constructor(id: string, status: string) { super("STATE_CONFLICT", `Direct cost '${id}' is in status '${status}' — only 'needs_accountant_review' can be reviewed.`); this.name = "DirectCostNotReviewableError"; }
}

export class DirectCostAlreadyReviewedError extends DirectCostError {
  constructor(id: string) { super("STATE_CONFLICT", `Direct cost '${id}' is already reviewed/approved.`); this.name = "DirectCostAlreadyReviewedError"; }
}

export class InvalidAllocationTotalError extends DirectCostError {
  constructor(expected: string, actual: string) {
    super("VALIDATION_FAILED", `Shared allocation total ${actual} does not match confirmed amount ${expected}.`);
    this.name = "InvalidAllocationTotalError";
  }
}

export class RequesterCannotApproveOwnDirectCostError extends DirectCostError {
  constructor(id: string, userId: string) {
    super("REQUESTER_CANNOT_APPROVE_OWN", `User '${userId}' cannot review/approve direct cost '${id}' they created — DEC-080.`);
    this.name = "RequesterCannotApproveOwnDirectCostError";
  }
}

export class WorkerCannotSetFinancialFieldsError extends DirectCostError {
  constructor(field: string) {
    super("VALIDATION_FAILED", `Worker cannot set financial field '${field}'. Only amount, responsibility, and notes are allowed for worker input.`);
    this.name = "WorkerCannotSetFinancialFieldsError";
  }
}

// ---------------------------------------------------------------------------
// Constants.
// ---------------------------------------------------------------------------

const DIRECT_COST_ENTITY_TYPE = "direct_cost";

const WORKER_SAFE_RESPONSIBILITY_TYPES: ReadonlySet<CostResponsibilityType> = new Set([
  "company", "customer", "factory", "shared", "unknown", "included_elsewhere", "needs_accountant_review",
]);

// ---------------------------------------------------------------------------
// Service deps.
// ---------------------------------------------------------------------------

export interface DirectCostServiceDeps {
  directCostRepository: DirectCostRepository;
  subledger: SubledgerService;
  snapshotService: ProfitabilitySnapshotService;
  audit: AuditTransactionHandle;
  idempotency: IdempotencyTransactionHandle;
  documentSequence: DocumentSequenceTransactionHandle;
  /**
   * Optional transaction runner. When provided, all DB writes in approveDirectCost
   * are wrapped in a single DB transaction — REQUIRED for WP-07-04 cutover
   * coordination correctness (the advisory lock acquired by
   * SubledgerService.postDirectCostEntry must span the account entry creation
   * AND the direct cost allocation AND the direct cost status update AND audit
   * AND idempotency terminalization). When absent, high-risk command execution
   * fails closed with CONFIGURATION_ERROR. Unit/in-memory tests MUST provide
   * an explicit transaction adapter/factory.
   */
  transactionRunner?: DirectCostTransactionRunner;
  txFactories?: DirectCostTransactionScopedFactories;
}

export type DirectCostTransactionRunner = <T>(work: (tx: unknown) => Promise<T>) => Promise<T>;

export interface DirectCostTransactionScopedFactories {
  createSubledger: (tx: unknown) => SubledgerService;
  createDirectCostRepository: (tx: unknown) => DirectCostRepository;
  createAudit: (tx: unknown) => AuditTransactionHandle;
  createIdempotency: (tx: unknown) => IdempotencyTransactionHandle;
  createDocumentSequence: (tx: unknown) => DocumentSequenceTransactionHandle;
}

// ---------------------------------------------------------------------------
// DirectCostService.
// ---------------------------------------------------------------------------

export class DirectCostService {
  constructor(private readonly deps: DirectCostServiceDeps) {}

  /**
   * Create a direct cost draft.
   *
   * Worker-safe input (Contract 07 §18 Worker Input):
   *   - amount (nullable — may be unknown)
   *   - costResponsibilityType (simple responsibility only)
   *   - notes
   *
   * Workers CANNOT set: actualPayerType, includedInProfitability, allocations,
   * or any subledger/receivable/payable/settlement fields.
   *
   * Permission: any authenticated user can create a draft (workers, accountants,
   * owners). The draft starts in 'needs_accountant_review' status — no subledger
   * entry is created until an accountant/owner reviews+approves.
   */
  async createDraftDirectCost(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: CreateDraftDirectCostInput,
  ): Promise<{ directCostId: string; costNo: string; reviewStatus: string }> {
    // Step 1: permission — any authenticated user can create a draft
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    // Step 2: validate inputs
    if (!input.linkedEntityId?.trim()) throw new DirectCostError("VALIDATION_FAILED", "linkedEntityId is required.");
    if (!input.idempotencyKey?.trim()) throw new DirectCostError("VALIDATION_FAILED", "idempotencyKey is required.");
    if (!WORKER_SAFE_RESPONSIBILITY_TYPES.has(input.costResponsibilityType)) {
      throw new DirectCostError("VALIDATION_FAILED", `Invalid costResponsibilityType '${input.costResponsibilityType}'.`);
    }
    if (input.amount !== null && input.amount !== undefined && !isPositiveMoney(input.amount)) {
      throw new DirectCostError("VALIDATION_FAILED", `Amount must be positive or null (unknown), got '${input.amount}'.`);
    }

    // Step 3: claim idempotency
    const now = new Date();
    const currency = input.currency ?? "EGP";
    const idempotencyInput: IdempotencyClaimInput = {
      tenantId: user.tenantId,
      operationScope: "direct_cost.create_draft",
      idempotencyKey: input.idempotencyKey,
      requestBody: {
        costType: input.costType,
        linkedEntityType: input.linkedEntityType,
        linkedEntityId: input.linkedEntityId,
        amount: input.amount ?? null,
        costResponsibilityType: input.costResponsibilityType,
        notes: input.notes ?? null,
      } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    };

    const claim = await claimIdempotency(this.deps.idempotency, idempotencyInput);

    if (claim.action === "replay") {
      const responseBody = claim.record.responseBody as { directCostId?: string; costNo?: string; reviewStatus?: string } | null;
      if (responseBody?.directCostId) {
        return { directCostId: responseBody.directCostId, costNo: responseBody.costNo!, reviewStatus: responseBody.reviewStatus! };
      }
    }
    if (claim.action === "conflict") {
      throw new DirectCostError("IDEMPOTENCY_CONFLICT", `Idempotency key '${input.idempotencyKey}' was used with a different request body.`);
    }
    if (claim.action === "in_progress") {
      throw new DirectCostError("OPERATION_IN_PROGRESS", `Operation '${input.idempotencyKey}' is still in progress.`);
    }

    // Step 4: allocate cost number + insert direct cost row
    const year = now.getUTCFullYear();
    const docNoResult = await allocateDocumentNumber(this.deps.documentSequence, {
      tenantId: user.tenantId, documentType: "direct_cost", year, entityType: DIRECT_COST_ENTITY_TYPE,
    });

    const directCost = await this.deps.directCostRepository.insertDirectCost({
      tenantId: user.tenantId,
      costNo: docNoResult.docNo,
      costType: input.costType,
      linkedEntityType: input.linkedEntityType,
      linkedEntityId: input.linkedEntityId,
      amount: input.amount ?? null,
      currency,
      costResponsibilityType: input.costResponsibilityType,
      // Worker-safe defaults — payer/profitability set at review
      actualPayerType: "not_recorded",
      includedInProfitability: false,
      reviewStatus: "needs_accountant_review",
      notes: input.notes ?? null,
      createdBy: user.userId,
    });

    // Record idempotency key for replay
    this.deps.directCostRepository.recordIdempotencyKey?.(user.tenantId, input.idempotencyKey, directCost.id);

    // Step 5: audit
    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: DIRECT_COST_ENTITY_TYPE,
      entityId: directCost.id,
      actionType: "direct_cost.draft.create",
      newValuesJson: {
        costNo: directCost.costNo,
        costType: directCost.costType,
        linkedEntityType: directCost.linkedEntityType,
        linkedEntityId: directCost.linkedEntityId,
        amount: directCost.amount,
        costResponsibilityType: directCost.costResponsibilityType,
        reviewStatus: "needs_accountant_review",
        createdBy: user.userId,
      },
      idempotencyKey: input.idempotencyKey,
    });

    // Step 6: mark idempotency succeeded
    await markSucceeded(this.deps.idempotency, claim.record.id, {
      responseCode: 200,
      responseBody: {
        directCostId: directCost.id,
        costNo: directCost.costNo,
        reviewStatus: directCost.reviewStatus,
      },
      entityType: DIRECT_COST_ENTITY_TYPE,
      entityId: directCost.id,
    }, claim.record.ownerToken!, now);

    return { directCostId: directCost.id, costNo: directCost.costNo, reviewStatus: directCost.reviewStatus };
  }

  /**
   * Review + approve a direct cost.
   *
   * Permission: direct_costs.review (Owner/Accountant only — Workers denied).
   *
   * DEC-080: The user who created the draft cannot review/approve it.
   *
   * On approval:
   *   1. Validate shared allocations sum to confirmed amount (if shared).
   *   2. Post subledger entry (customer-borne → positive customer_direct_cost_receivable;
   *      factory-borne → positive factory_direct_cost_recovery; company/unknown/included_elsewhere → no entry).
   *   3. Insert allocation rows (if shared).
   *   4. If includedInProfitability: create later profitability snapshot version (V2+)
   *      via ProfitabilitySnapshotService.createLaterSnapshot.
   *   5. Update direct cost review status to 'approved'.
   *   6. Audit.
   *
   * No subledger entry is created before review (Contract 07 §18).
   */
  async reviewDirectCost(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: ReviewDirectCostInput,
  ): Promise<ReviewDirectCostResult> {
    // Step 1: permission — direct_costs.review (Owner/Accountant only)
    requirePermission(effective, "direct_costs.review");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!input.directCostId?.trim()) throw new DirectCostError("VALIDATION_FAILED", "directCostId is required.");
    if (!input.idempotencyKey?.trim()) throw new DirectCostError("VALIDATION_FAILED", "idempotencyKey is required.");
    if (!isPositiveMoney(input.amount)) {
      throw new DirectCostError("VALIDATION_FAILED", `Confirmed amount must be positive, got '${input.amount}'.`);
    }

    // r14 BLOCKER C: fail-closed transaction configuration check BEFORE
    // idempotency claim, DB locking, or business mutation.
    if (!this.deps.transactionRunner || !this.deps.txFactories) {
      throw new DirectCostError("CONFIGURATION_ERROR", "DirectCostService.reviewDirectCost requires transactionRunner and txFactories for production high-risk command execution.");
    }

    // Step 2: fetch + lock direct cost
    const directCost = await this.deps.directCostRepository.findDirectCostById(user.tenantId, input.directCostId);
    if (!directCost) throw new DirectCostNotFoundError(input.directCostId);
    requireTenantMatch(user, directCost.tenantId);

    await this.deps.directCostRepository.lockDirectCost(user.tenantId, directCost.id);

    // Step 3: claim idempotency
    const now = new Date();
    const idempotencyInput: IdempotencyClaimInput = {
      tenantId: user.tenantId,
      operationScope: "direct_cost.review",
      idempotencyKey: input.idempotencyKey,
      requestBody: {
        directCostId: input.directCostId,
        amount: normalizeMoney(input.amount),
        costResponsibilityType: input.costResponsibilityType,
        actualPayerType: input.actualPayerType,
        includedInProfitability: input.includedInProfitability,
        allocations: input.allocations ?? [],
        notes: input.notes ?? null,
      } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    };
    const claim = await claimIdempotency(this.deps.idempotency, idempotencyInput);

    if (claim.action === "replay") {
      const responseBody = claim.record.responseBody as Partial<ReviewDirectCostResult> | null;
      if (responseBody?.directCostId) {
        return { ...responseBody, action: "replayed" } as ReviewDirectCostResult;
      }
    }
    if (claim.action === "conflict") {
      throw new DirectCostError("IDEMPOTENCY_CONFLICT", `Idempotency key '${input.idempotencyKey}' was used with a different request body.`);
    }
    if (claim.action === "in_progress") {
      throw new DirectCostError("OPERATION_IN_PROGRESS", `Operation '${input.idempotencyKey}' is still in progress.`);
    }

    // Step 4: DEC-080 — requester cannot approve own direct cost
    if (directCost.createdBy === user.userId) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 403, responseBody: { message: "Requester cannot approve own direct cost." },
        lastErrorClass: "RequesterCannotApproveOwnDirectCostError",
      }, claim.record.ownerToken!, now);
      throw new RequesterCannotApproveOwnDirectCostError(directCost.id, user.userId);
    }

    // Step 5: state check — must be needs_accountant_review
    if (directCost.reviewStatus !== "needs_accountant_review") {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 409, responseBody: { message: `Direct cost in status '${directCost.reviewStatus}'.` },
        lastErrorClass: "DirectCostAlreadyReviewedError",
      }, claim.record.ownerToken!, now);
      throw new DirectCostAlreadyReviewedError(directCost.id);
    }

    // Step 6: validate shared allocations sum to confirmed amount
    if (input.costResponsibilityType === "shared") {
      if (!input.allocations || input.allocations.length === 0) {
        await markBusinessFailed(this.deps.idempotency, claim.record.id, {
          responseCode: 422, responseBody: { message: "Shared responsibility requires allocations." },
          lastErrorClass: "InvalidAllocationTotalError",
        }, claim.record.ownerToken!, now);
        throw new InvalidAllocationTotalError(input.amount, "0.00");
      }
      const totalAllocated = input.allocations.reduce(
        (sum, a) => addMoney(sum, normalizeMoney(a.shareAmount)), "0.00",
      );
      if (compareMoney(totalAllocated, normalizeMoney(input.amount)) !== 0) {
        await markBusinessFailed(this.deps.idempotency, claim.record.id, {
          responseCode: 422, responseBody: { message: `Allocation total ${totalAllocated} != amount ${input.amount}.` },
          lastErrorClass: "InvalidAllocationTotalError",
        }, claim.record.ownerToken!, now);
        throw new InvalidAllocationTotalError(input.amount, totalAllocated);
      }
    }

    // Step 7-12: post subledger entry, insert allocations, update direct cost
    // review status, create profitability snapshot, audit, mark idempotency.
    //
    // WP-07-04 cutover coordination (r11): ALL of these writes MUST share the
    // SAME db.transaction() so the cutover advisory lock (acquired by
    // SubledgerService.postDirectCostEntry) protects the FULL review flow.
    const executeReview = async (txScoped: {
      subledger: SubledgerService; directCostRepository: DirectCostRepository;
      audit: AuditTransactionHandle; idempotency: IdempotencyTransactionHandle;
      documentSequence: DocumentSequenceTransactionHandle;
    } | null): Promise<ReviewDirectCostResult> => {
      const subledger = txScoped?.subledger ?? this.deps.subledger;
      const directCostRepo = txScoped?.directCostRepository ?? this.deps.directCostRepository;
      const audit = txScoped?.audit ?? this.deps.audit;
      const idempotency = txScoped?.idempotency ?? this.deps.idempotency;
      const documentSequence = txScoped?.documentSequence ?? this.deps.documentSequence;

      let subledgerEntryId: string | null = null;
      const confirmedAmount = normalizeMoney(input.amount);

      if (input.costResponsibilityType === "customer" && input.linkedOwnerType === "customer" && input.linkedOwnerId) {
        const year = now.getUTCFullYear();
        const entryDocNo = await allocateDocumentNumber(documentSequence, {
          tenantId: user.tenantId, documentType: "account_entry", year, entityType: "account_entry",
        });
        const entryResult = await subledger.postDirectCostEntry(user, effective, {
          ownerType: "customer",
          ownerId: input.linkedOwnerId,
          amount: confirmedAmount,
          entryDate: now.toISOString().slice(0, 10),
          entryType: "customer_direct_cost_receivable",
          directCostId: directCost.id,
          docNo: entryDocNo.docNo,
          idempotencyKey: `${input.idempotencyKey}:entry`,
        });
        subledgerEntryId = entryResult.entryId;
      } else if (input.costResponsibilityType === "factory" && input.linkedOwnerType === "factory" && input.linkedOwnerId) {
        const year = now.getUTCFullYear();
        const entryDocNo = await allocateDocumentNumber(documentSequence, {
          tenantId: user.tenantId, documentType: "account_entry", year, entityType: "account_entry",
        });
        const entryResult = await subledger.postDirectCostEntry(user, effective, {
          ownerType: "factory",
          ownerId: input.linkedOwnerId,
          amount: confirmedAmount,
          entryDate: now.toISOString().slice(0, 10),
          entryType: "factory_direct_cost_recovery",
          directCostId: directCost.id,
          docNo: entryDocNo.docNo,
          idempotencyKey: `${input.idempotencyKey}:entry`,
        });
        subledgerEntryId = entryResult.entryId;
      }

      if (input.costResponsibilityType === "shared" && input.allocations) {
        for (const a of input.allocations) {
          await directCostRepo.insertAllocation({
            tenantId: user.tenantId,
            directCostId: directCost.id,
            responsiblePartyType: a.responsiblePartyType,
            responsiblePartyId: a.responsiblePartyId,
            shareAmount: normalizeMoney(a.shareAmount),
            sharePercent: null,
            subledgerEntryId: null,
            createdBy: user.userId,
          });
        }
      }

      const updatedDirectCost = await directCostRepo.updateDirectCostReview(
        user.tenantId, directCost.id,
        {
          amount: confirmedAmount,
          costResponsibilityType: input.costResponsibilityType,
          actualPayerType: input.actualPayerType,
          includedInProfitability: input.includedInProfitability,
          reviewStatus: "approved",
          reviewedBy: user.userId,
          reviewedAt: now,
          notes: input.notes ?? directCost.notes,
          updatedBy: user.userId,
        },
        ["needs_accountant_review"],
      );
      if (!updatedDirectCost) {
        throw new DirectCostError("INTERNAL_TRANSACTION_FAILED", `Direct cost '${directCost.id}' could not be transitioned to approved.`);
      }

      let snapshotId: string | null = null;
      let snapshotVersion: number | null = null;
      if (input.includedInProfitability) {
        const allApprovedIncluded = await directCostRepo.listApprovedIncludedDirectCosts(
          user.tenantId, directCost.linkedEntityType, directCost.linkedEntityId,
        );
        const totalDirectCosts = allApprovedIncluded.reduce(
          (sum, dc) => addMoney(sum, normalizeMoney(dc.amount!)), "0.00",
        );
        if (directCost.linkedEntityType === "sales_order") {
          const snapshotResult = await this.deps.snapshotService.createLaterSnapshot(user, {
            salesOrderId: directCost.linkedEntityId,
            reviewedDirectCosts: totalDirectCosts,
            calculationNotes: `Version includes ${allApprovedIncluded.length} approved direct cost(s) totaling ${totalDirectCosts}.`,
          });
          snapshotId = snapshotResult.snapshotId;
          snapshotVersion = snapshotResult.version;
        }
      }

      await appendAuditLog(audit, user.tenantId, user.userId, {
        entityType: DIRECT_COST_ENTITY_TYPE,
        entityId: directCost.id,
        actionType: "direct_cost.review.approve",
        newValuesJson: {
          costNo: directCost.costNo,
          confirmedAmount,
          costResponsibilityType: input.costResponsibilityType,
          actualPayerType: input.actualPayerType,
          includedInProfitability: input.includedInProfitability,
          subledgerEntryId,
          snapshotId,
          snapshotVersion,
          reviewStatus: "approved",
          reviewedBy: user.userId,
        },
        idempotencyKey: input.idempotencyKey,
      });

      const result: ReviewDirectCostResult = {
        action: "reviewed",
        directCostId: directCost.id,
        reviewStatus: "approved",
        subledgerEntryId,
        snapshotId,
        snapshotVersion,
      };
      await markSucceeded(idempotency, claim.record.id, {
        responseCode: 200,
        responseBody: result,
        entityType: DIRECT_COST_ENTITY_TYPE,
        entityId: directCost.id,
      }, claim.record.ownerToken!, now);

      return result;
    };

    try {
      // r15 BLOCKER C: transactionRunner + txFactories already verified
      // at the top of this method. No dead non-transactional fallback.
      return await this.deps.transactionRunner!(async (tx: unknown) => {
          const txSubledger = this.deps.txFactories!.createSubledger(tx);
          const txDirectCostRepo = this.deps.txFactories!.createDirectCostRepository(tx);
          const txAudit = this.deps.txFactories!.createAudit(tx);
          const txIdem = this.deps.txFactories!.createIdempotency(tx);
          const txDocSeq = this.deps.txFactories!.createDocumentSequence(tx);
          return executeReview({
            subledger: txSubledger, directCostRepository: txDirectCostRepo,
            audit: txAudit, idempotency: txIdem, documentSequence: txDocSeq,
          });
        });
    } catch (txError) {
      // WP-07-04/BLOCKER 4: technical failure (including cutover lock wait
      // timeout) → terminalize as retryable_failed for immediate same-key retry.
      try {
        await markRetryableFailed(this.deps.idempotency, claim.record.id, {
          responseCode: 500,
          responseBody: { message: "Direct cost review transaction failed and rolled back." },
          lastErrorClass: txError instanceof Error ? txError.name : "Unknown",
        }, claim.record.ownerToken!, now);
      } catch {
        // If markRetryableFailed fails, record remains in_progress → lease expiry.
      }
      throw txError;
    }
  }
}
