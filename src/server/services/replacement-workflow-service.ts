/**
 * Replacement Workflow Service — WP-06-04.
 *
 * Contract: docs/contracts/13_work_packages.md WP-06-04
 *   Goal: Implement linked return credit plus normal replacement sale/issue.
 *
 * Contract: docs/contracts/06_approval_transaction_contract.md §9
 *   "Linked Replacement Issue/Sale: Replacement fulfillment is a second
 *    approved event, not a manual stock difference. Its order is linked to
 *    the approved return and follows ordinary sales submission, reservation,
 *    quality, approval, issue, discount-allocation, receivable, profitability,
 *    concurrency, and idempotency rules."
 *
 * Contract: docs/contracts/07_subledger_and_costs_contract.md §10.1
 *   "Replacement is two linked events:
 *    1. approved return receipt and return credit;
 *    2. approved replacement order/issue using normal sales reservation and
 *       approval, creating a positive customer receivable equal to
 *       replacement_order_approved_net_value.
 *    The linked entries determine the result: equal values net to no new
 *    receivable; a higher replacement leaves the difference owed; a lower
 *    replacement leaves customer credit. Refund is a separate payment action
 *    against customer credit and requires explicit Owner/Accountant treatment."
 *
 * Contract: docs/contracts/09_api_contracts.md §11
 *   "The linked replacement order is a normal sales order: it stores
 *    return_request_id and original-sale links, reserves on submission, and
 *    uses /sales/:saleId/approve for issue, approved net receivable, and
 *    profitability."
 *
 * WP-06-04 SCOPE:
 *   - Create a linked replacement sales order from an approved return request
 *     (financialTreatment = "replacement").
 *   - The replacement order is a NORMAL sales order with
 *     is_replacement_order = true + original_return_request_id set.
 *   - The replacement order starts in "draft" status. The caller then uses
 *     the ordinary SalesDraftService.completeCommercialTotals +
 *     SalesSubmissionService.submitSale + SalesApprovalService.approveSale
 *     pipeline to move it through reservation, approval, issue, receivable,
 *     and profitability.
 *   - Idempotent: only one replacement order per return request.
 *   - DEC-080: the replacement creation does not require approval (it's a
 *     draft). The subsequent sale approval enforces DEC-080.
 *
 * WP-06-04 NON-SCOPE:
 *   - No manual stock difference movement (replacement stock is issued via
 *     normal sales approval, not a manual movement).
 *   - No automatic refund/payment (that's a separate WP-05-04 action).
 *   - No editing of original sale/account entries.
 *   - No bypass of SalesSubmissionService / SalesApprovalService.
 *   - No new DB migration (schema already has is_replacement_order +
 *     original_return_request_id columns on sales_orders).
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
  type IdempotencyClaimInput,
} from "./idempotency-service";
import {
  allocateDocumentNumber,
  type DocumentSequenceTransactionHandle,
} from "./document-sequence-service";
import type { ReturnRequestRepository } from "./return-request-repository";
import type { ReturnRequest, ReturnLine } from "@/server/db/schema/returns";
import type { SalesRepository } from "./sales-repository";
import type { SalesOrder } from "@/server/db/schema/sales";
import { normalizeKg, isPositiveKg } from "./decimal-kg";

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

export interface CreateReplacementOrderInput {
  returnRequestId: string;
  /**
   * Optional override for the replacement sale date. Defaults to today.
   * The replacement sale date may differ from the original return date.
   */
  saleDate?: string;
  /**
   * Optional decision notes for the audit trail.
   */
  decisionNotes?: string | null;
  idempotencyKey: string;
}

export interface CreateReplacementOrderResult {
  action: "created" | "replayed";
  replacementSaleId: string;
  docNo: string;
  saleStatus: string;
  returnRequestId: string;
  originalSaleId: string;
  lineCount: number;
}

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

export class ReplacementWorkflowError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ReplacementWorkflowError";
    this.code = code;
  }
}

export class ReturnRequestNotFoundForReplacementError extends ReplacementWorkflowError {
  constructor(id: string) {
    super("RETURN_NOT_FOUND", `Return request '${id}' not found.`);
    this.name = "ReturnRequestNotFoundForReplacementError";
  }
}

export class ReturnNotApprovedForReplacementError extends ReplacementWorkflowError {
  constructor(id: string, status: string) {
    super(
      "STATE_CONFLICT",
      `Return request '${id}' is in status '${status}' — only 'approved' returns can create a replacement order.`,
    );
    this.name = "ReturnNotApprovedForReplacementError";
  }
}

export class ReturnNotReplacementTreatmentError extends ReplacementWorkflowError {
  constructor(id: string, treatment: string | null) {
    super(
      "STATE_CONFLICT",
      `Return request '${id}' has financialTreatment '${treatment}' — only 'replacement' returns can create a replacement order.`,
    );
    this.name = "ReturnNotReplacementTreatmentError";
  }
}

export class ReplacementAlreadyExistsError extends ReplacementWorkflowError {
  constructor(returnRequestId: string, existingSaleId: string) {
    super(
      "REPLACEMENT_EXISTS",
      `A replacement order '${existingSaleId}' already exists for return request '${returnRequestId}'.`,
    );
    this.name = "ReplacementAlreadyExistsError";
  }
}

export class ReturnHasNoLinesError extends ReplacementWorkflowError {
  constructor(returnRequestId: string) {
    super("VALIDATION_FAILED", `Return request '${returnRequestId}' has no return lines.`);
    this.name = "ReturnHasNoLinesError";
  }
}

// ---------------------------------------------------------------------------
// Service deps.
// ---------------------------------------------------------------------------

/**
 * WP-06-04: Transaction runner for atomic replacement order creation.
 * When provided, all DB writes (sales_orders insert, sales_order_lines inserts,
 * audit_logs insert) are wrapped in a single DB transaction. If any write fails,
 * the entire transaction rolls back — no partial replacement order remains.
 *
 * The DB-level unique partial index (sales_orders_replacement_return_unique_idx)
 * provides the final concurrency safety net: even if two concurrent transactions
 * pass the application-level check, only one INSERT succeeds; the other gets a
 * unique constraint violation which the service catches and converts to
 * ReplacementAlreadyExistsError.
 */
export type ReplacementWorkflowTransactionRunner = <T>(work: (tx: unknown) => Promise<T>) => Promise<T>;

export interface ReplacementWorkflowTransactionScopedFactories {
  /** Create a SalesRepository that uses the transaction-scoped `tx`. */
  createSalesRepository: (tx: unknown) => SalesRepository;
  /** Create a ReturnRequestRepository that uses the transaction-scoped `tx`. */
  createReturnRequestRepository: (tx: unknown) => ReturnRequestRepository;
  /** Create an AuditTransactionHandle that uses the transaction-scoped `tx`. */
  createAudit: (tx: unknown) => AuditTransactionHandle;
}

export interface ReplacementWorkflowServiceDeps {
  returnRequestRepository: ReturnRequestRepository;
  salesRepository: SalesRepository;
  audit: AuditTransactionHandle;
  idempotency: IdempotencyTransactionHandle;
  documentSequence: DocumentSequenceTransactionHandle;
  /**
   * Optional transaction runner. When provided, all DB writes in
   * createReplacementOrder are wrapped in a single DB transaction.
   * When absent (unit tests), services run without a DB transaction boundary.
   */
  transactionRunner?: ReplacementWorkflowTransactionRunner;
  /** Factory functions for creating transaction-scoped services/repos. */
  txFactories?: ReplacementWorkflowTransactionScopedFactories;
}

// ---------------------------------------------------------------------------
// Constants.
// ---------------------------------------------------------------------------

const REPLACEMENT_ENTITY_TYPE = "sales_order";
const REPLACEMENT_AUDIT_ENTITY = "replacement_workflow";

// ---------------------------------------------------------------------------
// ReplacementWorkflowService.
// ---------------------------------------------------------------------------

export class ReplacementWorkflowService {
  constructor(private readonly deps: ReplacementWorkflowServiceDeps) {}

  /**
   * Create a linked replacement sales order from an approved return request.
   *
   * Permission: returns.create (Owner/Accountant — workers cannot create
   * replacement orders because they involve financial treatment decisions).
   *
   * Preconditions:
   *   - Return request exists + belongs to tenant.
   *   - Return request status = "approved".
   *   - Return request financialTreatment = "replacement".
   *   - No existing replacement order linked to this return request.
   *   - Return request has at least one return line.
   *
   * Writes (all inside the idempotency claim):
   *   1. Allocate doc_no for the replacement sales order.
   *   2. Insert sales_orders row with is_replacement_order = true +
   *      original_return_request_id = returnRequestId.
   *   3. Insert sales_order_lines mirroring the return lines (same items,
   *      quantities, locations — price is NULL, set later by
   *      completeCommercialTotals).
   *   4. Audit the linkage.
   *
   * The replacement order starts in "draft" status. The caller then uses
   * the ordinary SalesDraftService.completeCommercialTotals +
   * SalesSubmissionService.submitSale + SalesApprovalService.approveSale
   * pipeline to move it through reservation, approval, issue, receivable,
   * and profitability.
   *
   * DEC-080: The replacement creation does not require approval (it's a
   * draft). The subsequent sale approval enforces DEC-080 (requester cannot
   * approve own request).
   *
   * Idempotency: The same idempotency key returns the existing replacement
   * order. A different idempotency key for the same return request throws
   * ReplacementAlreadyExistsError (one replacement per return request).
   */
  async createReplacementOrder(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: CreateReplacementOrderInput,
  ): Promise<CreateReplacementOrderResult> {
    // Contract 11 §7: Return/replacement approval and financial treatment =
    // Owner/Accountant only (A/R). Warehouse and Quality have returns.create
    // for physical return-request facts only — they CANNOT create replacement
    // orders because replacement creation is a financially consequential action
    // (creates a linked sales order with receivable implications).
    // Contract 09 §11: The linked replacement order is a normal sales order,
    // but creation requires the same authorization as return approval.
    requirePermission(effective, "returns.approve");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!input.returnRequestId?.trim()) {
      throw new ReplacementWorkflowError("VALIDATION_FAILED", "returnRequestId is required.");
    }
    if (!input.idempotencyKey?.trim()) {
      throw new ReplacementWorkflowError("VALIDATION_FAILED", "idempotencyKey is required.");
    }

    // Fetch the return request
    const rr = await this.deps.returnRequestRepository.findReturnRequestById(
      user.tenantId,
      input.returnRequestId,
    );
    if (!rr) throw new ReturnRequestNotFoundForReplacementError(input.returnRequestId);
    requireTenantMatch(user, rr.tenantId);

    // Claim idempotency
    const now = new Date();
    const idempotencyInput: IdempotencyClaimInput = {
      tenantId: user.tenantId,
      operationScope: "replacement_workflow.create",
      idempotencyKey: input.idempotencyKey,
      requestBody: {
        returnRequestId: input.returnRequestId,
        saleDate: input.saleDate ?? null,
        decisionNotes: input.decisionNotes ?? null,
      } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    };

    const claim = await claimIdempotency(this.deps.idempotency, idempotencyInput);

    if (claim.action === "replay") {
      const responseBody = claim.record.responseBody as Partial<CreateReplacementOrderResult> | null;
      if (responseBody?.replacementSaleId) {
        return { ...responseBody, action: "replayed" } as CreateReplacementOrderResult;
      }
    }
    if (claim.action === "conflict") {
      throw new ReplacementWorkflowError(
        "IDEMPOTENCY_CONFLICT",
        `Idempotency key '${input.idempotencyKey}' was used with a different request body.`,
      );
    }
    if (claim.action === "in_progress") {
      throw new ReplacementWorkflowError(
        "OPERATION_IN_PROGRESS",
        `Operation '${input.idempotencyKey}' is still in progress.`,
      );
    }

    // State check: return must be approved
    if (rr.status !== "approved") {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 409,
        responseBody: { message: `Return in status '${rr.status}'.` },
        lastErrorClass: "ReturnNotApprovedForReplacementError",
      }, claim.record.ownerToken!, now);
      throw new ReturnNotApprovedForReplacementError(rr.id, rr.status);
    }

    // Treatment check: must be "replacement"
    if (rr.financialTreatment !== "replacement") {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 409,
        responseBody: { message: `Treatment '${rr.financialTreatment}' is not 'replacement'.` },
        lastErrorClass: "ReturnNotReplacementTreatmentError",
      }, claim.record.ownerToken!, now);
      throw new ReturnNotReplacementTreatmentError(rr.id, rr.financialTreatment);
    }

    // Idempotency guard: check if a replacement order already exists for this return request.
    // This prevents creating a second replacement order with a different idempotency key.
    const existing = await this.deps.salesRepository.findReplacementOrderByReturnRequestId(
      user.tenantId,
      rr.id,
    );
    if (existing) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 409,
        responseBody: { message: `Replacement order '${existing.id}' already exists.` },
        lastErrorClass: "ReplacementAlreadyExistsError",
      }, claim.record.ownerToken!, now);
      throw new ReplacementAlreadyExistsError(rr.id, existing.id);
    }

    // Fetch return lines
    const returnLines = await this.deps.returnRequestRepository.findReturnLines(user.tenantId, rr.id);
    if (returnLines.length === 0) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 422,
        responseBody: { message: "Return request has no lines." },
        lastErrorClass: "ReturnHasNoLinesError",
      }, claim.record.ownerToken!, now);
      throw new ReturnHasNoLinesError(rr.id);
    }

    // Allocate doc_no for the replacement sales order (outside transaction —
    // document sequence is in-process and doesn't need tx participation)
    const year = now.getUTCFullYear();
    const docNoResult = await allocateDocumentNumber(this.deps.documentSequence, {
      tenantId: user.tenantId,
      documentType: "sales_order",
      year,
      entityType: REPLACEMENT_ENTITY_TYPE,
    });

    // Determine sale date (default to today if not provided)
    const saleDate = input.saleDate ?? now.toISOString().slice(0, 10);

    // =====================================================================
    // ATOMIC REPLACEMENT ORDER CREATION (Contract 06 §6, §12; WP-06-04)
    // =====================================================================
    // All DB writes (sales_orders insert, sales_order_lines inserts, audit_logs
    // insert) MUST commit or roll back together. If transactionRunner is
    // provided, we wrap all writes in a single db.transaction(). If any write
    // fails, the entire transaction rolls back — no partial replacement order.
    //
    // The DB-level unique partial index (sales_orders_replacement_return_unique_idx)
    // provides the final concurrency safety net: if two concurrent transactions
    // pass the application-level check, only one INSERT succeeds; the other
    // gets a unique constraint violation which we catch and convert to
    // ReplacementAlreadyExistsError.
    // =====================================================================

    const executePosting = async (
      txScoped: {
        salesRepository: SalesRepository;
        returnRequestRepository: ReturnRequestRepository;
        audit: AuditTransactionHandle;
      } | null,
    ): Promise<{ replacementSaleId: string; docNo: string; saleStatus: string }> => {
      const salesRepo = txScoped?.salesRepository ?? this.deps.salesRepository;
      const returnRepo = txScoped?.returnRequestRepository ?? this.deps.returnRequestRepository;
      const audit = txScoped?.audit ?? this.deps.audit;

      // Re-check for existing replacement order INSIDE the transaction.
      // This narrows the race window: the unique index is the final arbiter,
      // but this check gives a cleaner error for the common case.
      const existingInTx = await salesRepo.findReplacementOrderByReturnRequestId(
        user.tenantId,
        rr.id,
      );
      if (existingInTx) {
        throw new ReplacementAlreadyExistsError(rr.id, existingInTx.id);
      }

      // Fetch return lines (inside tx for consistency)
      const returnLinesInTx = await returnRepo.findReturnLines(user.tenantId, rr.id);
      if (returnLinesInTx.length === 0) {
        throw new ReturnHasNoLinesError(rr.id);
      }

      // Create the replacement sales order (normal sales order with replacement link fields)
      const replacementSale = await salesRepo.insertSaleDraft({
        tenantId: user.tenantId,
        docNo: docNoResult.docNo,
        customerId: rr.customerId,
        saleDate,
        createdBy: user.userId,
        isReplacementOrder: true,
        originalReturnRequestId: rr.id,
      });

      // Create sale lines mirroring the return lines.
      // Price is NULL — set later by completeCommercialTotals (Owner/Accountant).
      // Quantity, item, and location come from the return lines (operational facts).
      // WP-06-04: Set originalReturnLineId for line-level traceability:
      //   replacement sale line → return line → original sale line → original sale
      let lineNo = 1;
      for (const rl of returnLinesInTx) {
        await salesRepo.insertSaleLine({
          tenantId: user.tenantId,
          salesOrderId: replacementSale.id,
          lineNo,
          itemId: rl.itemId,
          locationId: rl.returnLocationId,
          quantityKg: normalizeKg(rl.quantityKg),
          pricePerTon: null, // Set by Owner/Accountant via completeCommercialTotals
          originalReturnLineId: rl.id, // WP-06-04: line-level traceability
        });
        lineNo++;
      }

      // Audit the replacement order creation + linkage
      await appendAuditLog(audit, user.tenantId, user.userId, {
        entityType: REPLACEMENT_AUDIT_ENTITY,
        entityId: replacementSale.id,
        actionType: "replacement_workflow.create",
        newValuesJson: {
          docNo: replacementSale.docNo,
          replacementSaleId: replacementSale.id,
          returnRequestId: rr.id,
          originalSaleId: rr.salesOrderId,
          customerId: rr.customerId,
          lineCount: returnLinesInTx.length,
          saleDate,
          decisionNotes: input.decisionNotes ?? null,
          isReplacementOrder: true,
          // WP-06-04: include line-level links in audit for traceability
          replacementLineLinks: returnLinesInTx.map(rl => ({
            returnLineId: rl.id,
            originalSaleLineId: rl.originalSaleLineId,
          })),
        },
        idempotencyKey: input.idempotencyKey,
      });

      return {
        replacementSaleId: replacementSale.id,
        docNo: replacementSale.docNo,
        saleStatus: replacementSale.saleStatus,
      };
    };

    let postingResult: { replacementSaleId: string; docNo: string; saleStatus: string };
    try {
      if (this.deps.transactionRunner && this.deps.txFactories) {
        postingResult = await this.deps.transactionRunner(async (tx: unknown) => {
          const txSalesRepo = this.deps.txFactories!.createSalesRepository(tx);
          const txReturnRepo = this.deps.txFactories!.createReturnRequestRepository(tx);
          const txAudit = this.deps.txFactories!.createAudit(tx);
          return executePosting({
            salesRepository: txSalesRepo,
            returnRequestRepository: txReturnRepo,
            audit: txAudit,
          });
        });
      } else {
        postingResult = await executePosting(null);
      }
    } catch (txError) {
      // Check if this is a unique constraint violation (concurrent duplicate).
      // The DB-level unique partial index enforces one replacement per return request.
      const errMsg = txError instanceof Error ? txError.message : String(txError);
      const isUniqueViolation =
        errMsg.includes("sales_orders_replacement_return_unique_idx") ||
        errMsg.includes("unique constraint") ||
        errMsg.includes("duplicate key");
      if (isUniqueViolation) {
        // A concurrent transaction won — fetch the winning replacement order.
        const winner = await this.deps.salesRepository.findReplacementOrderByReturnRequestId(
          user.tenantId,
          rr.id,
        );
        await markBusinessFailed(this.deps.idempotency, claim.record.id, {
          responseCode: 409,
          responseBody: { message: `Concurrent replacement creation won by '${winner?.id ?? "unknown"}'.` },
          lastErrorClass: "ReplacementAlreadyExistsError",
        }, claim.record.ownerToken!, now);
        throw new ReplacementAlreadyExistsError(rr.id, winner?.id ?? "unknown");
      }
      // Other error — mark idempotency as failed and re-throw.
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 500,
        responseBody: { message: "Replacement order creation failed and rolled back." },
        lastErrorClass: txError instanceof Error ? txError.name : "Unknown",
      }, claim.record.ownerToken!, now);
      throw txError;
    }

    const result: CreateReplacementOrderResult = {
      action: "created",
      replacementSaleId: postingResult.replacementSaleId,
      docNo: postingResult.docNo,
      saleStatus: postingResult.saleStatus,
      returnRequestId: rr.id,
      originalSaleId: rr.salesOrderId,
      lineCount: returnLines.length,
    };

    await markSucceeded(this.deps.idempotency, claim.record.id, {
      responseCode: 200,
      responseBody: result,
      entityType: REPLACEMENT_ENTITY_TYPE,
      entityId: postingResult.replacementSaleId,
    }, claim.record.ownerToken!, now);

    return result;
  }

  /**
   * Find a replacement order linked to a return request.
   * Returns null if no replacement order exists.
   */
  async findReplacementOrder(
    user: ErpUserContext,
    effective: EffectivePermissions,
    returnRequestId: string,
  ): Promise<SalesOrder | null> {
    requirePermission(effective, "returns.create");
    return this.deps.salesRepository.findReplacementOrderByReturnRequestId(
      user.tenantId,
      returnRequestId,
    );
  }
}
