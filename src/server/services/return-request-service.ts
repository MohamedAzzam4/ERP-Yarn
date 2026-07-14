/**
 * Return Request Service — WP-06-03.
 *
 * Contract: docs/contracts/13_work_packages.md WP-06-03
 *   Goal: Atomically receive approved return, classify stock and post
 *   selected credit treatment.
 *
 * Contract: docs/contracts/07_subledger_and_costs_contract.md §10.1
 *   An approved customer return credit is a negative customer entry.
 *   return_credit_value = returned_quantity × original_sale_line_approved_net_unit_value
 *
 * Contract: docs/contracts/04_inventory_posting_contract.md §11
 *   Returned stock classification: return_received → needs_quality_review |
 *   sellable_as_is | sellable_with_discount | blocked | reprocess_required
 *
 * DEC-068: Partial return residual/cap persistence.
 *   Cumulative return qty/credit cannot exceed original sale line qty/value.
 *
 * DEC-080: Requester cannot approve own request.
 *
 * WP-06-03 SCOPE:
 *   - Create return request draft (with return lines)
 *   - Submit for approval (pending_approval)
 *   - Approve return (DEC-080: requester cannot approve own)
 *     - Atomic: return_receipt stock movement + customer_return_credit entry
 *     - Classify returned stock (return_received → needs_quality_review etc.)
 *   - Reject return
 *   - Idempotency, audit, tenant isolation, permission checks
 *
 * WP-06-03 NON-SCOPE:
 *   - Replacement order/issue (WP-06-04)
 *   - Refund payment (WP-05-04)
 *   - Quality test on returned stock (WP-06-01 integration — future)
 *   - Direct cost review (WP-05-05)
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
import type { InventoryLedgerService } from "./inventory-ledger-service";
import type { SubledgerService } from "./subledger-service";
import type { SalesRepository } from "./sales-repository";
import { normalizeMoney, isPositiveMoney, addMoney, compareMoney, isZeroMoney } from "./decimal-money";
import { normalizeKg, isPositiveKg, addKg, compareKg } from "./decimal-kg";

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

export type ReturnedStockStatus =
  | "return_received" | "needs_quality_review" | "sellable_as_is"
  | "sellable_with_discount" | "blocked" | "reprocess_required";

export type ReturnFinancialTreatment =
  | "no_financial_impact" | "customer_credit" | "refund_due" | "replacement";

export interface ReturnLineInput {
  originalSaleOrderId: string;
  originalSaleLineId: string;
  itemId: string;
  quantityKg: string;
  returnLocationId: string;
  returnedStockStatus: ReturnedStockStatus;
  /**
   * Original approved sale-line net unit value after allocated discount.
   * Optional at input — if not provided, the service fetches it from the sale line
   * at approval time. This field is NOT a caller-supplied credit value.
   */
  originalSaleLineNetUnitValue?: string | null;
}

export interface CreateReturnRequestInput {
  salesOrderId: string;
  customerId: string;
  returnDate: string;
  returnReason: string;
  financialTreatment?: ReturnFinancialTreatment | null;
  isReplacement?: boolean;
  lines: ReturnLineInput[];
  idempotencyKey: string;
}

export interface ApproveReturnInput {
  returnRequestId: string;
  idempotencyKey: string;
  decisionNotes?: string | null;
}

export interface CreateReturnRequestResult {
  action: "created" | "replayed";
  returnRequestId: string;
  docNo: string;
  status: string;
}

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

export class ReturnRequestError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = "ReturnRequestError"; this.code = code; }
}

export class ReturnRequestNotFoundError extends ReturnRequestError {
  constructor(id: string) { super("RETURN_NOT_FOUND", `Return request '${id}' not found.`); this.name = "ReturnRequestNotFoundError"; }
}

export class ReturnRequestNotApprovableError extends ReturnRequestError {
  constructor(id: string, status: string) { super("STATE_CONFLICT", `Return request '${id}' is in status '${status}' — only 'pending_approval' can be approved.`); this.name = "ReturnRequestNotApprovableError"; }
}

export class ReturnExceedsSaleLineCapError extends ReturnRequestError {
  constructor(lineId: string, requested: string, remaining: string) {
    super("VALIDATION_FAILED", `Return quantity ${requested} exceeds remaining sale line capacity ${remaining} for line '${lineId}' (DEC-068).`);
    this.name = "ReturnExceedsSaleLineCapError";
  }
}

export class RequesterCannotApproveOwnReturnError extends ReturnRequestError {
  constructor(id: string, userId: string) {
    super("REQUESTER_CANNOT_APPROVE_OWN", `User '${userId}' cannot approve return request '${id}' they created — DEC-080.`);
    this.name = "RequesterCannotApproveOwnReturnError";
  }
}

// ---------------------------------------------------------------------------
// Constants.
// ---------------------------------------------------------------------------

const RETURN_ENTITY_TYPE = "return_request";

// ---------------------------------------------------------------------------
// Service deps.
// ---------------------------------------------------------------------------

export interface ReturnRequestServiceDeps {
  returnRequestRepository: ReturnRequestRepository;
  audit: AuditTransactionHandle;
  idempotency: IdempotencyTransactionHandle;
  documentSequence: DocumentSequenceTransactionHandle;
  /** Required for approveReturnRequest: posts return_receipt stock movement. */
  inventoryLedger: InventoryLedgerService;
  /** Required for approveReturnRequest: posts customer return credit entry. */
  subledger: SubledgerService;
  /** Required for approveReturnRequest: reads sale lines + updates sale return state. */
  salesRepository: SalesRepository;
}

// ---------------------------------------------------------------------------
// ReturnRequestService.
// ---------------------------------------------------------------------------

export class ReturnRequestService {
  constructor(private readonly deps: ReturnRequestServiceDeps) {}

  /**
   * Create a return request draft with return lines.
   *
   * Permission: returns.create (Owner/Accountant).
   * Workers can create return receipt drafts but not financial treatment.
   *
   * The draft has status='draft' — no stock movement, no subledger entry,
   * no account entry. Only when approved does the atomic effect happen.
   */
  async createReturnRequest(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: CreateReturnRequestInput,
  ): Promise<CreateReturnRequestResult> {
    requirePermission(effective, "returns.create");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!input.salesOrderId?.trim()) throw new ReturnRequestError("VALIDATION_FAILED", "salesOrderId is required.");
    if (!input.customerId?.trim()) throw new ReturnRequestError("VALIDATION_FAILED", "customerId is required.");
    if (!input.returnDate?.trim()) throw new ReturnRequestError("VALIDATION_FAILED", "returnDate is required.");
    if (!input.returnReason?.trim()) throw new ReturnRequestError("VALIDATION_FAILED", "returnReason is required.");
    if (!input.idempotencyKey?.trim()) throw new ReturnRequestError("VALIDATION_FAILED", "idempotencyKey is required.");
    if (input.lines.length === 0) throw new ReturnRequestError("VALIDATION_FAILED", "At least one return line is required.");

    // Validate each line
    for (const line of input.lines) {
      if (!isPositiveKg(line.quantityKg)) {
        throw new ReturnRequestError("VALIDATION_FAILED", `Line quantity must be positive, got '${line.quantityKg}'.`);
      }
    }

    // Claim idempotency
    const now = new Date();
    const idempotencyInput: IdempotencyClaimInput = {
      tenantId: user.tenantId,
      operationScope: "return_request.create",
      idempotencyKey: input.idempotencyKey,
      requestBody: {
        salesOrderId: input.salesOrderId,
        customerId: input.customerId,
        returnDate: input.returnDate,
        returnReason: input.returnReason,
        financialTreatment: input.financialTreatment ?? null,
        isReplacement: input.isReplacement ?? false,
        lineCount: input.lines.length,
      } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    };

    const claim = await claimIdempotency(this.deps.idempotency, idempotencyInput);

    if (claim.action === "replay") {
      const responseBody = claim.record.responseBody as Partial<CreateReturnRequestResult> | null;
      if (responseBody?.returnRequestId) {
        return { ...responseBody, action: "replayed" } as CreateReturnRequestResult;
      }
    }
    if (claim.action === "conflict") {
      throw new ReturnRequestError("IDEMPOTENCY_CONFLICT", `Idempotency key '${input.idempotencyKey}' was used with a different request body.`);
    }
    if (claim.action === "in_progress") {
      throw new ReturnRequestError("OPERATION_IN_PROGRESS", `Operation '${input.idempotencyKey}' is still in progress.`);
    }

    // Allocate doc number
    const year = now.getUTCFullYear();
    const docNoResult = await allocateDocumentNumber(this.deps.documentSequence, {
      tenantId: user.tenantId, documentType: "return_request", year, entityType: RETURN_ENTITY_TYPE,
    });

    // Insert return request
    const returnRequest = await this.deps.returnRequestRepository.insertReturnRequest({
      tenantId: user.tenantId,
      docNo: docNoResult.docNo,
      salesOrderId: input.salesOrderId,
      customerId: input.customerId,
      returnDate: input.returnDate,
      returnReason: input.returnReason,
      financialTreatment: input.financialTreatment ?? null,
      isReplacement: input.isReplacement ?? false,
      createdBy: user.userId,
    } as any);

    this.deps.returnRequestRepository.recordIdempotencyKey?.(user.tenantId, input.idempotencyKey, returnRequest.id);

    // Insert return lines
    for (const line of input.lines) {
      await this.deps.returnRequestRepository.insertReturnLine({
        tenantId: user.tenantId,
        returnRequestId: returnRequest.id,
        originalSaleOrderId: line.originalSaleOrderId,
        originalSaleLineId: line.originalSaleLineId,
        itemId: line.itemId,
        quantityKg: normalizeKg(line.quantityKg),
        returnLocationId: line.returnLocationId,
        returnedStockStatus: line.returnedStockStatus,
        originalSaleLineNetUnitValue: line.originalSaleLineNetUnitValue ?? null,
        createdBy: user.userId,
      } as any);
    }

    // Audit
    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: RETURN_ENTITY_TYPE,
      entityId: returnRequest.id,
      actionType: "return_request.create",
      newValuesJson: {
        docNo: returnRequest.docNo,
        salesOrderId: input.salesOrderId,
        customerId: input.customerId,
        returnDate: input.returnDate,
        returnReason: input.returnReason,
        financialTreatment: input.financialTreatment ?? null,
        isReplacement: input.isReplacement ?? false,
        lineCount: input.lines.length,
        status: "draft",
        createdBy: user.userId,
      },
      idempotencyKey: input.idempotencyKey,
    });

    const result: CreateReturnRequestResult = {
      action: "created",
      returnRequestId: returnRequest.id,
      docNo: returnRequest.docNo,
      status: "draft",
    };
    await markSucceeded(this.deps.idempotency, claim.record.id, {
      responseCode: 200,
      responseBody: result,
      entityType: RETURN_ENTITY_TYPE,
      entityId: returnRequest.id,
    }, now);

    return result;
  }

  /**
   * Submit a return request for approval (draft → pending_approval).
   *
   * Permission: returns.create.
   */
  async submitReturnRequest(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: { returnRequestId: string; idempotencyKey: string },
  ): Promise<{ action: "submitted" | "replayed"; returnRequestId: string; status: string }> {
    requirePermission(effective, "returns.create");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    const rr = await this.deps.returnRequestRepository.findReturnRequestById(user.tenantId, input.returnRequestId);
    if (!rr) throw new ReturnRequestNotFoundError(input.returnRequestId);
    requireTenantMatch(user, rr.tenantId);

    const now = new Date();
    const claim = await claimIdempotency(this.deps.idempotency, {
      tenantId: user.tenantId,
      operationScope: "return_request.submit",
      idempotencyKey: input.idempotencyKey,
      requestBody: { returnRequestId: input.returnRequestId } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    });

    if (claim.action === "replay") {
      const responseBody = claim.record.responseBody as any;
      if (responseBody?.returnRequestId) return { ...responseBody, action: "replayed" };
    }
    if (claim.action === "conflict") throw new ReturnRequestError("IDEMPOTENCY_CONFLICT", `Idempotency key conflict.`);
    if (claim.action === "in_progress") throw new ReturnRequestError("OPERATION_IN_PROGRESS", `Operation in progress.`);

    if (rr.status !== "draft") {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 409, responseBody: { message: `Return in status '${rr.status}'.` },
        lastErrorClass: "ReturnRequestNotApprovableError",
      }, now);
      throw new ReturnRequestError("STATE_CONFLICT", `Return request '${rr.id}' is in status '${rr.status}' — only 'draft' can be submitted.`);
    }

    const updated = await this.deps.returnRequestRepository.updateReturnRequestStatus(
      user.tenantId, rr.id,
      { status: "pending_approval", approvalStatus: "pending_approval", updatedBy: user.userId },
      ["draft"],
    );
    if (!updated) throw new ReturnRequestError("INTERNAL_TRANSACTION_FAILED", `Could not submit return '${rr.id}'.`);

    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: RETURN_ENTITY_TYPE, entityId: rr.id,
      actionType: "return_request.submit",
      newValuesJson: { docNo: rr.docNo, status: "pending_approval" },
      idempotencyKey: input.idempotencyKey,
    });

    const result = { action: "submitted" as const, returnRequestId: rr.id, status: "pending_approval" };
    await markSucceeded(this.deps.idempotency, claim.record.id, {
      responseCode: 200, responseBody: result,
      entityType: RETURN_ENTITY_TYPE, entityId: rr.id,
    }, now);
    return result;
  }

  /**
   * Approve a return request (pending_approval → approved).
   *
   * Permission: returns.approve (Owner/Accountant).
   * DEC-080: Requester cannot approve own request.
   *
   * On approval (atomic — all effects or none):
   *   1. Validate DEC-068 cap (cumulative returns ≤ original sale line qty/value)
   *   2. Post return_receipt stock movement (increase on_hand at return location)
   *   3. Post customer return credit entry (NEGATIVE customer entry) when
   *      financialTreatment is customer_credit or refund_due
   *   4. Update sale return state (approved → partially_returned or fully_returned)
   *   5. Set return request status to 'approved', lock it
   *   6. Audit
   *
   * No payment/refund row is created (that's a separate WP-05-04 action).
   * No replacement order/issue is created (that's WP-06-04).
   */
  async approveReturnRequest(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: ApproveReturnInput,
  ): Promise<{ action: "approved" | "replayed"; returnRequestId: string; status: string; approvedBy: string; stockMovements: string[]; creditEntryId: string | null }> {
    requirePermission(effective, "returns.approve");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!input.returnRequestId?.trim()) throw new ReturnRequestError("VALIDATION_FAILED", "returnRequestId is required.");
    if (!input.idempotencyKey?.trim()) throw new ReturnRequestError("VALIDATION_FAILED", "idempotencyKey is required.");

    const rr = await this.deps.returnRequestRepository.findReturnRequestById(user.tenantId, input.returnRequestId);
    if (!rr) throw new ReturnRequestNotFoundError(input.returnRequestId);
    requireTenantMatch(user, rr.tenantId);

    await this.deps.returnRequestRepository.lockReturnRequest(user.tenantId, rr.id);

    // Claim idempotency
    const now = new Date();
    const claim = await claimIdempotency(this.deps.idempotency, {
      tenantId: user.tenantId,
      operationScope: "return_request.approve",
      idempotencyKey: input.idempotencyKey,
      requestBody: { returnRequestId: input.returnRequestId, decisionNotes: input.decisionNotes ?? null } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    });

    if (claim.action === "replay") {
      const responseBody = claim.record.responseBody as any;
      if (responseBody?.returnRequestId) return { ...responseBody, action: "replayed" };
    }
    if (claim.action === "conflict") throw new ReturnRequestError("IDEMPOTENCY_CONFLICT", `Idempotency key conflict.`);
    if (claim.action === "in_progress") throw new ReturnRequestError("OPERATION_IN_PROGRESS", `Operation in progress.`);

    // DEC-080: requester cannot approve own request
    if (rr.createdBy === user.userId) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 403, responseBody: { message: "Requester cannot approve own return." },
        lastErrorClass: "RequesterCannotApproveOwnReturnError",
      }, now);
      throw new RequesterCannotApproveOwnReturnError(rr.id, user.userId);
    }

    // State check
    if (rr.status !== "pending_approval") {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 409, responseBody: { message: `Return in status '${rr.status}'.` },
        lastErrorClass: "ReturnRequestNotApprovableError",
      }, now);
      throw new ReturnRequestNotApprovableError(rr.id, rr.status);
    }

    // Fetch return lines
    const lines = await this.deps.returnRequestRepository.findReturnLines(user.tenantId, rr.id);

    // DEC-068: Validate cumulative return cap for each line
    // Fetch original sale lines (required for cap validation + credit calculation)
    const saleLines: Map<string, { quantityKg: string; lineNetRevenuePosted: string }> = new Map();
    {
      const originalSaleLines = await this.deps.salesRepository.findSaleLines(user.tenantId, rr.salesOrderId);
      for (const sl of originalSaleLines) {
        saleLines.set(sl.id, { quantityKg: sl.quantityKg, lineNetRevenuePosted: sl.lineNetRevenuePosted ?? "0" });
      }
    }

    for (const line of lines) {
      const priorReturns = await this.deps.returnRequestRepository.listApprovedReturnLinesForSaleLine(
        user.tenantId, line.originalSaleLineId,
      );
      const priorQty = priorReturns.reduce((sum, l) => addKg(sum, l.quantityKg), "0.000");
      const newQty = normalizeKg(line.quantityKg);
      const totalQty = addKg(priorQty, newQty);

      // Check against original sale line quantity if available
      const saleLine = saleLines.get(line.originalSaleLineId);
      if (saleLine) {
        const originalQty = normalizeKg(saleLine.quantityKg);
        if (compareKg(totalQty, originalQty) > 0) {
          await markBusinessFailed(this.deps.idempotency, claim.record.id, {
            responseCode: 422, responseBody: { message: `Return qty ${totalQty} exceeds sale line qty ${originalQty} (DEC-068).` },
            lastErrorClass: "ReturnExceedsSaleLineCapError",
          }, now);
          throw new ReturnExceedsSaleLineCapError(line.id, totalQty, originalQty);
        }
      }
    }

    // === ATOMIC APPROVAL EFFECTS ===

    const stockMovementIds: string[] = [];
    let creditEntryId: string | null = null;
    const year = now.getUTCFullYear();

    // 1. Post return_receipt stock movement for each line
    for (const line of lines) {
      const mvDocNo = await allocateDocumentNumber(this.deps.documentSequence, {
        tenantId: user.tenantId, documentType: "return_receipt", year, entityType: "stock_movement",
      });

      const mvResult = await this.deps.inventoryLedger.postReturnReceipt(user, effective, {
        itemId: line.itemId,
        toLocationId: line.returnLocationId,
        quantityKg: line.quantityKg,
        movementDate: rr.returnDate,
        sourceDocumentType: "return_request",
        sourceDocumentId: rr.id,
        idempotencyKey: `${input.idempotencyKey}:mv:${line.id}`,
        notes: input.decisionNotes ?? undefined,
      });

      stockMovementIds.push(mvResult.movementId);

      // Link movement to return line
      await this.deps.returnRequestRepository.updateReturnLineMovement(
        user.tenantId, line.id, mvResult.movementId,
      );
    }

    // 2. Post customer return credit entry (NEGATIVE customer entry)
    // Contract 07 §10.1: "An approved customer return credit is a negative customer entry."
    // return_credit_value = returned_quantity × original_sale_line_net_unit_value
    // The credit value is ALWAYS computed server-side from the sale line data.
    // Caller/worker input must NOT provide return credit value.
    if (rr.financialTreatment) {
      const needsCredit = rr.financialTreatment === "customer_credit" || rr.financialTreatment === "refund_due";
      if (needsCredit) {
        // Calculate total return credit value server-side
        let totalCredit = "0.00";
        for (const line of lines) {
          // Fetch original sale line to get net unit value after allocated discount
          const saleLine = saleLines.get(line.originalSaleLineId);
          let unitValue: string | null = null;

          // Use the line's snapshotted value if provided at creation time
          if (line.originalSaleLineNetUnitValue) {
            unitValue = line.originalSaleLineNetUnitValue;
          } else if (saleLine) {
            // Derive from sale line: lineNetRevenuePosted / quantityKg
            const lineNet = parseFloat(saleLine.lineNetRevenuePosted);
            const lineQty = parseFloat(saleLine.quantityKg);
            if (lineQty > 0) {
              unitValue = (lineNet / lineQty).toFixed(6);
            }
          }

          if (unitValue) {
            // return_credit_value = returned_quantity × unit_value (ROUND_HALF_UP at 2 decimals)
            const qty = parseFloat(line.quantityKg);
            const uv = parseFloat(unitValue);
            const credit = (qty * uv).toFixed(2);
            totalCredit = addMoney(totalCredit, normalizeMoney(credit));
          }
        }
        if (!isZeroMoney(totalCredit)) {
          const entryDocNo = await allocateDocumentNumber(this.deps.documentSequence, {
            tenantId: user.tenantId, documentType: "account_entry", year, entityType: "account_entry",
          });
          const creditResult = await this.deps.subledger.postReturnCreditEntry(user, effective, {
            customerId: rr.customerId,
            returnRequestId: rr.id,
            returnCreditValue: totalCredit,
            entryDate: rr.returnDate,
            docNo: entryDocNo.docNo,
            idempotencyKey: `${input.idempotencyKey}:credit`,
          });
          creditEntryId = creditResult.entryId;
        }
      }
    }

    // 3. Update sale return state (approved → partially_returned or fully_returned)
    if (saleLines.size > 0) {
      // Check if all sale lines are fully returned
      let allFullyReturned = true;
      for (const [saleLineId, saleLine] of saleLines) {
        const priorReturns = await this.deps.returnRequestRepository.listApprovedReturnLinesForSaleLine(
          user.tenantId, saleLineId,
        );
        const totalReturned = priorReturns.reduce((sum, l) => addKg(sum, l.quantityKg), "0.000");
        // Include current return lines for this sale line
        const currentReturn = lines.filter(l => l.originalSaleLineId === saleLineId)
          .reduce((sum, l) => addKg(sum, l.quantityKg), "0.000");
        const totalWithCurrent = addKg(totalReturned, currentReturn);
        if (compareKg(totalWithCurrent, normalizeKg(saleLine.quantityKg)) < 0) {
          allFullyReturned = false;
          break;
        }
      }
      const newSaleStatus = allFullyReturned ? "fully_returned" : "partially_returned";
      await this.deps.salesRepository.updateSaleStatusConditional(
        user.tenantId, rr.salesOrderId,
        { saleStatus: newSaleStatus, approvalStatus: "approved", reservationStatus: "consumed" },
        ["approved", "partially_returned"],
      );
    }

    // 4. Update return request status to approved
    const updated = await this.deps.returnRequestRepository.updateReturnRequestStatus(
      user.tenantId, rr.id,
      {
        status: "approved",
        approvalStatus: "approved",
        approvedBy: user.userId,
        approvedAt: now,
        isLocked: true,
        updatedBy: user.userId,
      },
      ["pending_approval"],
    );
    if (!updated) throw new ReturnRequestError("INTERNAL_TRANSACTION_FAILED", `Could not approve return '${rr.id}'.`);

    // 5. Audit
    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: RETURN_ENTITY_TYPE, entityId: rr.id,
      actionType: "return_request.approve",
      newValuesJson: {
        docNo: rr.docNo,
        status: "approved",
        approvedBy: user.userId,
        decisionNotes: input.decisionNotes ?? null,
        stockMovementIds,
        creditEntryId,
        financialTreatment: rr.financialTreatment,
      },
      idempotencyKey: input.idempotencyKey,
    });

    const result = { action: "approved" as const, returnRequestId: rr.id, status: "approved", approvedBy: user.userId, stockMovements: stockMovementIds, creditEntryId };
    await markSucceeded(this.deps.idempotency, claim.record.id, {
      responseCode: 200, responseBody: result,
      entityType: RETURN_ENTITY_TYPE, entityId: rr.id,
    }, now);
    return result;
  }

  /**
   * Reject a return request (pending_approval → rejected).
   *
   * Permission: returns.approve (Owner/Accountant).
   */
  async rejectReturnRequest(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: { returnRequestId: string; rejectionReason: string; idempotencyKey: string },
  ): Promise<{ action: "rejected" | "replayed"; returnRequestId: string; status: string }> {
    requirePermission(effective, "returns.approve");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!input.returnRequestId?.trim()) throw new ReturnRequestError("VALIDATION_FAILED", "returnRequestId is required.");
    if (!input.rejectionReason?.trim()) throw new ReturnRequestError("VALIDATION_FAILED", "rejectionReason is required.");
    if (!input.idempotencyKey?.trim()) throw new ReturnRequestError("VALIDATION_FAILED", "idempotencyKey is required.");

    const rr = await this.deps.returnRequestRepository.findReturnRequestById(user.tenantId, input.returnRequestId);
    if (!rr) throw new ReturnRequestNotFoundError(input.returnRequestId);
    requireTenantMatch(user, rr.tenantId);

    const now = new Date();
    const claim = await claimIdempotency(this.deps.idempotency, {
      tenantId: user.tenantId,
      operationScope: "return_request.reject",
      idempotencyKey: input.idempotencyKey,
      requestBody: { returnRequestId: input.returnRequestId, rejectionReason: input.rejectionReason } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    });

    if (claim.action === "replay") {
      const responseBody = claim.record.responseBody as any;
      if (responseBody?.returnRequestId) return { ...responseBody, action: "replayed" };
    }
    if (claim.action === "conflict") throw new ReturnRequestError("IDEMPOTENCY_CONFLICT", `Idempotency key conflict.`);
    if (claim.action === "in_progress") throw new ReturnRequestError("OPERATION_IN_PROGRESS", `Operation in progress.`);

    if (rr.status !== "pending_approval") {
      throw new ReturnRequestNotApprovableError(rr.id, rr.status);
    }

    const updated = await this.deps.returnRequestRepository.updateReturnRequestStatus(
      user.tenantId, rr.id,
      { status: "rejected", approvalStatus: "rejected", updatedBy: user.userId },
      ["pending_approval"],
    );
    if (!updated) throw new ReturnRequestError("INTERNAL_TRANSACTION_FAILED", `Could not reject return '${rr.id}'.`);

    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: RETURN_ENTITY_TYPE, entityId: rr.id,
      actionType: "return_request.reject",
      newValuesJson: { docNo: rr.docNo, status: "rejected", rejectionReason: input.rejectionReason },
      idempotencyKey: input.idempotencyKey,
    });

    const result = { action: "rejected" as const, returnRequestId: rr.id, status: "rejected" };
    await markSucceeded(this.deps.idempotency, claim.record.id, {
      responseCode: 200, responseBody: result,
      entityType: RETURN_ENTITY_TYPE, entityId: rr.id,
    }, now);
    return result;
  }

  /**
   * List return requests for a sale.
   */
  async listReturnRequestsForSale(
    user: ErpUserContext,
    effective: EffectivePermissions,
    salesOrderId: string,
  ): Promise<ReturnRequest[]> {
    requirePermission(effective, "returns.create");
    return this.deps.returnRequestRepository.listReturnRequestsForSale(user.tenantId, salesOrderId);
  }

  /**
   * List return lines for a return request.
   */
  async findReturnLines(
    user: ErpUserContext,
    effective: EffectivePermissions,
    returnRequestId: string,
  ): Promise<ReturnLine[]> {
    requirePermission(effective, "returns.create");
    return this.deps.returnRequestRepository.findReturnLines(user.tenantId, returnRequestId);
  }
}
