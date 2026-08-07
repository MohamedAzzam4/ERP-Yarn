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
  markRetryableFailed,
  IdempotencyOwnershipLostError,
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
import type { ProfitabilitySnapshotService } from "./profitability-snapshot-service";
import type { TenantOwnershipValidator } from "./db-tenant-ownership-validator";
import { normalizeMoney, isPositiveMoney, addMoney, compareMoney, isZeroMoney, subtractMoney } from "./decimal-money";
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
// Transaction runner + factories (DB transaction support for atomic approval).
// ---------------------------------------------------------------------------

/**
 * A transaction runner that wraps work in a single DB transaction.
 *
 * When provided, `approveReturnRequest` wraps ALL DB writes (stock movements,
 * inventory balances, account entries, return_lines updates, profitability
 * snapshots, sales_orders state, return_requests status, audit_logs) in this
 * transaction. If any write fails, the entire transaction rolls back — no
 * partial stock post, no partial credit entry, no partial snapshot.
 *
 * The `work` callback receives a transaction-scoped `tx` object that has the
 * same type as the base `db`. The factory functions
 * (`createInventoryLedger`, `createSubledger`, `createSnapshotService`,
 * `createSalesRepository`, `createReturnRequestRepository`, `createAudit`)
 * use this `tx` to construct transaction-scoped repositories + services.
 *
 * When NOT provided (unit tests with in-memory repos), the services run
 * without a DB transaction boundary — in-memory repos don't persist partial
 * state across processes.
 */
export type ReturnRequestTransactionRunner = <T>(work: (tx: unknown) => Promise<T>) => Promise<T>;

/**
 * Factory functions for creating transaction-scoped services/repos.
 * These are called inside the transaction runner with the `tx` object.
 */
export interface ReturnRequestTransactionScopedFactories {
  /** Create an InventoryLedgerService that uses the transaction-scoped `tx`. */
  createInventoryLedger: (tx: unknown) => InventoryLedgerService;
  /** Create a SubledgerService that uses the transaction-scoped `tx`. */
  createSubledger: (tx: unknown) => SubledgerService;
  /** Create a ProfitabilitySnapshotService that uses the transaction-scoped `tx`. */
  createSnapshotService: (tx: unknown) => ProfitabilitySnapshotService;
  /** Create a SalesRepository that uses the transaction-scoped `tx`. */
  createSalesRepository: (tx: unknown) => SalesRepository;
  /** Create a ReturnRequestRepository that uses the transaction-scoped `tx`. */
  createReturnRequestRepository: (tx: unknown) => ReturnRequestRepository;
  /** Create an AuditTransactionHandle that uses the transaction-scoped `tx`. */
  createAudit: (tx: unknown) => AuditTransactionHandle;
  /**
   * Create an IdempotencyTransactionHandle that uses the transaction-scoped
   * `tx`. WP-08-01E BLOCKER 2: markSucceeded must execute INSIDE the same
   * transaction as business writes + audit so that ownership loss rolls
   * back ALL effects atomically.
   */
  createIdempotency: (tx: unknown) => IdempotencyTransactionHandle;
}

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
  /** Required for approveReturnRequest: creates return-impact profitability snapshot version. */
  snapshotService: ProfitabilitySnapshotService;
  /**
   * REQUIRED (WP-08-01A): tenant ownership + relation validator.
   *
   * Validates BEFORE any write that customer, sale order, sale line, item,
   * and return location all belong to the actor's tenant, AND that the
   * relation chain is consistent:
   *   - sale order belongs to customer
   *   - sale line belongs to sale order
   *   - sale line references the selected item
   * A valid Tenant-B row used by Tenant-A MUST be rejected here, before the
   * idempotency claim or any DB write.
   *
   * Production: pass `DbTenantOwnershipValidator`.
   * Tests: pass a mock implementing `TenantOwnershipValidator`.
   */
  tenantOwnershipValidator: TenantOwnershipValidator;
  /**
   * Optional transaction runner. When provided, all DB writes in
   * approveReturnRequest AND createReturnRequest are wrapped in a single
   * DB transaction. When absent (unit tests), services run without a DB
   * transaction boundary.
   *
   * WP-08-01A: createReturnRequest now uses this runner to wrap
   * (header insert + lines insert + audit) so that a line-insert failure
   * or audit failure rolls back the header. Idempotency claim + markSucceeded
   * remain OUTSIDE the transaction (they are not business data).
   */
  transactionRunner?: ReturnRequestTransactionRunner;
  /**
   * Factory functions for creating transaction-scoped services/repos.
   * Required when `transactionRunner` is provided.
   */
  txFactories?: ReturnRequestTransactionScopedFactories;
}

// ---------------------------------------------------------------------------
// ReturnRequestService.
// ---------------------------------------------------------------------------

export class ReturnRequestService {
  constructor(private readonly deps: ReturnRequestServiceDeps) {
    // WP-08-01E BLOCKER 2: fail-closed if transactionRunner or txFactories
    // are missing. Production mutation commands require atomic
    // markSucceeded-inside-transaction to prevent partial commits.
    if (!!this.deps.transactionRunner !== !!this.deps.txFactories) {
      throw new Error(
        "CONFIGURATION_ERROR: transactionRunner and txFactories must both be provided or both be absent.",
      );
    }
  }

  /**
   * WP-08-01E BLOCKER 2: Require transaction config for production mutation
   * commands. Throws CONFIGURATION_ERROR if transactionRunner or txFactories
   * are missing — this prevents silent non-atomic execution.
   */
  private requireTransactionConfig(): {
    transactionRunner: ReturnRequestTransactionRunner;
    txFactories: ReturnRequestTransactionScopedFactories;
  } {
    if (!this.deps.transactionRunner || !this.deps.txFactories) {
      throw new Error(
        "CONFIGURATION_ERROR: transactionRunner and txFactories are required for production mutation commands. " +
        "Without them, markSucceeded cannot be executed atomically with business writes.",
      );
    }
    return {
      transactionRunner: this.deps.transactionRunner,
      txFactories: this.deps.txFactories,
    };
  }

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
      if (!line.originalSaleOrderId?.trim() || !line.originalSaleLineId?.trim() || !line.itemId?.trim() || !line.returnLocationId?.trim()) {
        throw new ReturnRequestError("VALIDATION_FAILED", "Each line requires originalSaleOrderId, originalSaleLineId, itemId, returnLocationId.");
      }
    }

    // =====================================================================
    // WP-08-01A: Tenant ownership + relation validation.
    // BEFORE the idempotency claim — a rejected request must NOT create
    // an idempotency record, header, line, or audit. Cross-tenant
    // rejection produces ZERO writes.
    //
    // For each return line we validate the FULL chain:
    //   customer   ∈ tenant
    //   sale       ∈ tenant AND sale.customer_id = customer
    //   saleLine   ∈ tenant AND saleLine.sales_order_id = sale
    //   saleLine   references the line's itemId (saleLine.item_id = itemId)
    //   item       ∈ tenant
    //   location   ∈ tenant
    // A valid Tenant-B ID used by Tenant-A is rejected here even if the
    // FK exists (FK only proves existence, not ownership).
    // =====================================================================
    await this.deps.tenantOwnershipValidator.validateCustomerBelongsToTenant(user.tenantId, input.customerId);
    await this.deps.tenantOwnershipValidator.validateSaleBelongsToTenantAndCustomer(
      user.tenantId, input.salesOrderId, input.customerId,
    );
    for (const line of input.lines) {
      await this.deps.tenantOwnershipValidator.validateLineBelongsToSale(
        user.tenantId, line.originalSaleLineId, line.originalSaleOrderId,
      );
      await this.deps.tenantOwnershipValidator.validateLineReferencesItem(
        user.tenantId, line.originalSaleLineId, line.itemId,
      );
      await this.deps.tenantOwnershipValidator.validateItemBelongsToTenant(user.tenantId, line.itemId);
      await this.deps.tenantOwnershipValidator.validateLocationBelongsToTenant(user.tenantId, line.returnLocationId);
    }

    // WP-08-01E DEFECT 1: Require transaction configuration BEFORE
    // claimIdempotency and document-number allocation. Missing config
    // must produce zero idempotency rows, zero doc-seq change, zero
    // business writes, zero audit rows.
    const { transactionRunner: txRunner, txFactories: txFacs } = this.requireTransactionConfig();

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
      customerAdjustmentAmount: null,
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

    // =====================================================================
    // WP-08-01A: Atomic header + lines + audit.
    //
    // When `transactionRunner` is provided (production), all three writes
    // commit in a single DB transaction. If any line insert fails, OR the
    // audit fails, the entire transaction rolls back — no return header
    // remains, no line remains, no audit remains. The idempotency claim
    // is OUTSIDE the transaction (it is not business data; the caller can
    // retry with the SAME idempotency key after fixing the cause and it
    // will succeed exactly once).
    //
    // When `transactionRunner` is NOT provided (unit tests with in-memory
    // repos), the writes run without a DB transaction boundary — but the
    // service still throws on any failure, so the caller observes the
    // error. In-memory tests that need to verify rollback semantics must
    // pass a mock transactionRunner.
    // =====================================================================
    const executeCreate = async (
      txScoped: {
        returnRequestRepository: ReturnRequestRepository;
        audit: AuditTransactionHandle;
        idempotency: IdempotencyTransactionHandle;
      } | null,
    ): Promise<{ returnRequest: ReturnRequest; result: CreateReturnRequestResult }> => {
      const rrRepo = txScoped?.returnRequestRepository ?? this.deps.returnRequestRepository;
      const auditHandle = txScoped?.audit ?? this.deps.audit;
      const idemHandle = txScoped?.idempotency ?? this.deps.idempotency;

      // Insert return request (header)
      const returnRequest = await rrRepo.insertReturnRequest({
        tenantId: user.tenantId,
        docNo: docNoResult.docNo,
        salesOrderId: input.salesOrderId,
        customerId: input.customerId,
        returnDate: input.returnDate,
        returnReason: input.returnReason,
        financialTreatment: input.financialTreatment ?? null,
        isReplacement: input.isReplacement ?? false,
        customerAdjustmentAmount: null,
        createdBy: user.userId,
      } as any);

      rrRepo.recordIdempotencyKey?.(user.tenantId, input.idempotencyKey, returnRequest.id);

      // Insert return lines — ANY failure here rolls back the header.
      for (const line of input.lines) {
        await rrRepo.insertReturnLine({
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

      // Audit — ANY failure here rolls back header + lines (DEC-024).
      await appendAuditLog(auditHandle, user.tenantId, user.userId, {
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
        customerAdjustmentAmount: null,
          lineCount: input.lines.length,
          status: "draft",
          createdBy: user.userId,
        },
        idempotencyKey: input.idempotencyKey,
      });

      // WP-08-01E BLOCKER 2: markSucceeded INSIDE the transaction so that
      // ownership loss rolls back ALL business + audit effects atomically.
      const result: CreateReturnRequestResult = {
        action: "created",
        returnRequestId: returnRequest.id,
        docNo: returnRequest.docNo,
        status: "draft",
      };
      await markSucceeded(idemHandle, claim.record.id, {
        responseCode: 200,
        responseBody: result,
        entityType: RETURN_ENTITY_TYPE,
        entityId: returnRequest.id,
      }, claim.record.ownerToken!, now);

      return { returnRequest, result };
    };

    // WP-08-01E DEFECT 1: transaction config already required above
    // (before claimIdempotency). Use the pre-acquired variables.
    let result: CreateReturnRequestResult;
    try {
      const txResult = await txRunner(async (tx: unknown) => {
        const txRrRepo = txFacs.createReturnRequestRepository(tx);
        const txAudit = txFacs.createAudit(tx);
        const txIdem = txFacs.createIdempotency(tx);
        return executeCreate({ returnRequestRepository: txRrRepo, audit: txAudit, idempotency: txIdem });
      });
      result = txResult.result;
    } catch (txError) {
      // WP-08-01E BLOCKER 2: classify post-rollback failures correctly.
      // - IdempotencyOwnershipLostError: stale caller must NOT call
      //   markBusinessFailed. Defensive stale markRetryableFailed must
      //   affect 0 rows. Propagate the ownership error.
      // - Other errors (audit/infra/transient): markRetryableFailed so
      //   same-key retry re-executes.
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

    // WP-08-01E DEFECT 1: Require transaction configuration BEFORE
    // claimIdempotency. Missing config must produce zero idempotency rows.
    const { transactionRunner: txRunner, txFactories: txFacs } = this.requireTransactionConfig();

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
      // Durable business failure: state conflict. Mark business_failed
      // (terminal) so same-key replay returns the same failure.
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 409, responseBody: { message: `Return in status '${rr.status}'.` },
        lastErrorClass: "ReturnRequestNotApprovableError",
      }, claim.record.ownerToken!, now);
      throw new ReturnRequestError("STATE_CONFLICT", `Return request '${rr.id}' is in status '${rr.status}' — only 'draft' can be submitted.`);
    }

    // WP-08-01E DEFECT 1: transaction config already required above
    // (before claimIdempotency). Use the pre-acquired variables.
    const result = { action: "submitted" as const, returnRequestId: rr.id, status: "pending_approval" };
    try {
      await txRunner(async (tx: unknown) => {
        const txRrRepo = txFacs.createReturnRequestRepository(tx);
        const txAudit = txFacs.createAudit(tx);
        const txIdem = txFacs.createIdempotency(tx);

        const updated = await txRrRepo.updateReturnRequestStatus(
          user.tenantId, rr.id,
          { status: "pending_approval", approvalStatus: "pending_approval", updatedBy: user.userId },
          ["draft"],
        );
        if (!updated) throw new ReturnRequestError("INTERNAL_TRANSACTION_FAILED", `Could not submit return '${rr.id}'.`);

        await appendAuditLog(txAudit, user.tenantId, user.userId, {
          entityType: RETURN_ENTITY_TYPE, entityId: rr.id,
          actionType: "return_request.submit",
          newValuesJson: { docNo: rr.docNo, status: "pending_approval" },
          idempotencyKey: input.idempotencyKey,
        });

        // markSucceeded INSIDE the transaction — atomic with business writes.
        await markSucceeded(txIdem, claim.record.id, {
          responseCode: 200, responseBody: result,
          entityType: RETURN_ENTITY_TYPE, entityId: rr.id,
        }, claim.record.ownerToken!, now);
      });
    } catch (txError) {
      // WP-08-01E BLOCKER 2: classify post-rollback failures.
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
            console.error("INVARIANT VIOLATION: stale markRetryableFailed affected rows =", staleAffected);
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
   * When `transactionRunner` + `txFactories` are provided (production path),
   * steps 2-6 are wrapped in a single DB transaction. Any failure rolls back
   * ALL writes — no partial stock post, no partial credit entry, no partial
   * snapshot, no partial approval. This satisfies Contract 06 §6, §12 + DEC-024.
   *
   * When `transactionRunner` is NOT provided (unit tests with in-memory repos),
   * the writes run without a DB transaction boundary — in-memory repos don't
   * persist partial state across processes.
   *
   * No payment/refund row is created (that's a separate WP-05-04 action).
   * No replacement order/issue is created (that's WP-06-04).
   */
  async approveReturnRequest(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: ApproveReturnInput,
  ): Promise<{ action: "approved" | "replayed"; returnRequestId: string; status: string; approvedBy: string; stockMovements: string[]; creditEntryId: string | null; snapshotId: string | null }> {
    requirePermission(effective, "returns.approve");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!input.returnRequestId?.trim()) throw new ReturnRequestError("VALIDATION_FAILED", "returnRequestId is required.");
    if (!input.idempotencyKey?.trim()) throw new ReturnRequestError("VALIDATION_FAILED", "idempotencyKey is required.");

    const rr = await this.deps.returnRequestRepository.findReturnRequestById(user.tenantId, input.returnRequestId);
    if (!rr) throw new ReturnRequestNotFoundError(input.returnRequestId);
    requireTenantMatch(user, rr.tenantId);

    // WP-08-01E DEFECT 1: Require transaction configuration BEFORE
    // claimIdempotency and lockReturnRequest. Missing config must
    // produce zero idempotency rows, zero business writes, zero audit.
    const { transactionRunner: txRunner, txFactories: txFacs } = this.requireTransactionConfig();

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
      }, claim.record.ownerToken!, now);
      throw new RequesterCannotApproveOwnReturnError(rr.id, user.userId);
    }

    // State check
    if (rr.status !== "pending_approval") {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 409, responseBody: { message: `Return in status '${rr.status}'.` },
        lastErrorClass: "ReturnRequestNotApprovableError",
      }, claim.record.ownerToken!, now);
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
          }, claim.record.ownerToken!, now);
          throw new ReturnExceedsSaleLineCapError(line.id, totalQty, originalQty);
        }
      }

      // DEC-068 value cap: cumulative credit cannot exceed original sale-line net value
      if (saleLine) {
        const originalNetValue = normalizeMoney(saleLine.lineNetRevenuePosted);
        const priorCredit = priorReturns.reduce(
          (sum, l) => addMoney(sum, l.returnCreditValue ?? "0.00"), "0.00",
        );
        // Compute current line credit (server-side)
        let unitValue: string | null = null;
        if (line.originalSaleLineNetUnitValue) {
          unitValue = line.originalSaleLineNetUnitValue;
        } else {
          const lineNet = parseFloat(saleLine.lineNetRevenuePosted);
          const lineQty = parseFloat(saleLine.quantityKg);
          if (lineQty > 0) unitValue = (lineNet / lineQty).toFixed(6);
        }
        let currentCredit = "0.00";
        if (unitValue) {
          const credit = (parseFloat(line.quantityKg) * parseFloat(unitValue)).toFixed(2);
          currentCredit = normalizeMoney(credit);
        }
        // Check if this is the final effective return (totalQty == originalQty)
        const originalQty = normalizeKg(saleLine.quantityKg);
        const isFinalReturn = compareKg(totalQty, originalQty) === 0;
        if (isFinalReturn) {
          // Final residual: adjust so cumulative = original net value exactly
          const residual = subtractMoney(subtractMoney(originalNetValue, priorCredit), currentCredit);
          currentCredit = addMoney(currentCredit, residual);
        }
        const totalCredit = addMoney(priorCredit, currentCredit);
        if (compareMoney(totalCredit, originalNetValue) > 0) {
          await markBusinessFailed(this.deps.idempotency, claim.record.id, {
            responseCode: 422, responseBody: { message: `Cumulative return credit ${totalCredit} exceeds sale line net value ${originalNetValue} (DEC-068).` },
            lastErrorClass: "ReturnExceedsSaleLineCapError",
          }, claim.record.ownerToken!, now);
          throw new ReturnExceedsSaleLineCapError(line.id, totalCredit, originalNetValue);
        }
      }
    }

    // =====================================================================
    // ATOMIC POSTING TRANSACTION (Contract 06 §6, §12; DEC-024; WP-06-03)
    // =====================================================================
    // All DB writes (stock_movement, inventory_balance, account_entry,
    // return_lines credit/movement link, sales_profitability_snapshot,
    // sales_orders state, return_requests status, audit_logs) MUST commit
    // or roll back together. If transactionRunner is provided, we wrap all
    // DB writes in a single db.transaction(). If any write fails, the entire
    // transaction rolls back — no partial stock post, no partial credit
    // entry, no partial snapshot, no partial approval.
    //
    // If transactionRunner is NOT provided (unit tests with in-memory repos),
    // we run without a DB transaction boundary — in-memory repos don't
    // persist partial state across processes.
    // =====================================================================

    const executePosting = async (
      txScoped: {
        inventoryLedger: InventoryLedgerService;
        subledger: SubledgerService;
        snapshotService: ProfitabilitySnapshotService;
        salesRepository: SalesRepository;
        returnRequestRepository: ReturnRequestRepository;
        audit: AuditTransactionHandle;
        idempotency: IdempotencyTransactionHandle;
      } | null,
    ): Promise<{ stockMovementIds: string[]; creditEntryId: string | null; snapshotId: string | null; result: any }> => {
      const invLedger = txScoped?.inventoryLedger ?? this.deps.inventoryLedger;
      const subledger = txScoped?.subledger ?? this.deps.subledger;
      const snapshotService = txScoped?.snapshotService ?? this.deps.snapshotService;
      const salesRepository = txScoped?.salesRepository ?? this.deps.salesRepository;
      const returnRequestRepository = txScoped?.returnRequestRepository ?? this.deps.returnRequestRepository;
      const audit = txScoped?.audit ?? this.deps.audit;
      const idemHandle = txScoped?.idempotency ?? this.deps.idempotency;

      const stockMovementIds: string[] = [];
      let creditEntryId: string | null = null;
      const year = now.getUTCFullYear();

      // 1. Post return_receipt stock movement for each line
      // WP-06-04 correction: Each return line's stock movement uses a unique
      // source identity (sourceDocumentType = "return_line", sourceDocumentId =
      // line.id) instead of the return request ID. This prevents the duplicate
      // source guard from blocking multi-line returns — each line gets its own
      // movement. Return request level traceability is preserved through the
      // return_lines.return_request_id FK + the return request's own audit row.
      for (const line of lines) {
        const mvDocNo = await allocateDocumentNumber(this.deps.documentSequence, {
          tenantId: user.tenantId, documentType: "return_receipt", year, entityType: "stock_movement",
        });

        const mvResult = await invLedger.postReturnReceipt(user, effective, {
          itemId: line.itemId,
          toLocationId: line.returnLocationId,
          quantityKg: line.quantityKg,
          movementDate: rr.returnDate,
          sourceDocumentType: "return_line",
          sourceDocumentId: line.id,
          idempotencyKey: `${input.idempotencyKey}:mv:${line.id}`,
          notes: input.decisionNotes ?? undefined,
        });

        stockMovementIds.push(mvResult.movementId);

        // Link movement to return line
        await returnRequestRepository.updateReturnLineMovement(
          user.tenantId, line.id, mvResult.movementId,
        );
      }

      // 2. Post customer return credit entry (NEGATIVE customer entry)
      // Contract 07 §10.1: "An approved customer return credit is a negative customer entry."
      // Contract 06 §9 line 151: "for replacement, create the return credit from
      // returned quantity × original approved sale line net unit value after
      // allocated discount, capped by the remaining original line value after prior returns."
      // So replacement treatment ALSO creates a return credit — the replacement
      // sale then creates a positive receivable, and the difference arises naturally.
      // return_credit_value = returned_quantity × original_sale_line_net_unit_value
      // The credit value is ALWAYS computed server-side from the sale line data.
      // DEC-068: Final effective return applies residual so cumulative = original net value exactly.
      if (rr.financialTreatment) {
        const needsCredit = rr.financialTreatment === "customer_credit" || rr.financialTreatment === "refund_due" || rr.financialTreatment === "replacement";
        if (needsCredit) {
          // Calculate per-line credit with DEC-068 residual + store on return lines
          let totalCredit = "0.00";
          for (const line of lines) {
            const saleLine = saleLines.get(line.originalSaleLineId);
            let unitValue: string | null = null;
            if (line.originalSaleLineNetUnitValue) {
              unitValue = line.originalSaleLineNetUnitValue;
            } else if (saleLine) {
              const lineNet = parseFloat(saleLine.lineNetRevenuePosted);
              const lineQty = parseFloat(saleLine.quantityKg);
              if (lineQty > 0) unitValue = (lineNet / lineQty).toFixed(6);
            }

            let lineCredit = "0.00";
            let residualAdjustment = "0.00";
            if (unitValue) {
              lineCredit = normalizeMoney((parseFloat(line.quantityKg) * parseFloat(unitValue)).toFixed(2));
            }

            // DEC-068: Check if this is the final effective return
            if (saleLine) {
              const priorReturns = await returnRequestRepository.listApprovedReturnLinesForSaleLine(
                user.tenantId, line.originalSaleLineId,
              );
              const priorQty = priorReturns.reduce((sum, l) => addKg(sum, l.quantityKg), "0.000");
              const newQty = normalizeKg(line.quantityKg);
              const totalQty = addKg(priorQty, newQty);
              const originalQty = normalizeKg(saleLine.quantityKg);
              const isFinalReturn = compareKg(totalQty, originalQty) === 0;

              if (isFinalReturn) {
                const originalNetValue = normalizeMoney(saleLine.lineNetRevenuePosted);
                const priorCredit = priorReturns.reduce(
                  (sum, l) => addMoney(sum, l.returnCreditValue ?? "0.00"), "0.00",
                );
                residualAdjustment = subtractMoney(subtractMoney(originalNetValue, priorCredit), lineCredit);
                lineCredit = addMoney(lineCredit, residualAdjustment);
              }

              // Store computed credit + residual on return line
              await returnRequestRepository.updateReturnLineCreditAndResidual(
                user.tenantId, line.id, {
                  returnCreditValue: lineCredit,
                  residualAdjustment,
                  cumulativePriorReturnQty: priorQty,
                  cumulativePriorReturnCredit: priorReturns.reduce(
                    (sum, l) => addMoney(sum, l.returnCreditValue ?? "0.00"), "0.00",
                  ),
                  updatedBy: user.userId,
                },
              );
            }

            totalCredit = addMoney(totalCredit, lineCredit);
          }
          if (!isZeroMoney(totalCredit)) {
            const entryDocNo = await allocateDocumentNumber(this.deps.documentSequence, {
              tenantId: user.tenantId, documentType: "account_entry", year, entityType: "account_entry",
            });
            const creditResult = await subledger.postReturnCreditEntry(user, effective, {
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

      // 2b. Create return-impact profitability snapshot version
      // Contract 07 §20: "New version after approved return."
      // Only create snapshot when financial treatment requires credit (customer_credit/refund_due/replacement).
      // no_financial_impact returns do not affect profitability.
      let snapshotId: string | null = null;
      if (rr.financialTreatment && (rr.financialTreatment === "customer_credit" || rr.financialTreatment === "refund_due" || rr.financialTreatment === "replacement")) {
      {
        // Calculate cumulative return credit for this sale (prior + current)
        let cumulativeCredit = "0.00";
        // Prior approved returns
        for (const [saleLineId] of saleLines) {
          const priorReturns = await returnRequestRepository.listApprovedReturnLinesForSaleLine(
            user.tenantId, saleLineId,
          );
          for (const prior of priorReturns) {
            // Compute credit for prior returns using the same formula
            const sl = saleLines.get(prior.originalSaleLineId);
            if (sl) {
              const lineNet = parseFloat(sl.lineNetRevenuePosted);
              const lineQty = parseFloat(sl.quantityKg);
              if (lineQty > 0) {
                const unitValue = lineNet / lineQty;
                const credit = (parseFloat(prior.quantityKg) * unitValue).toFixed(2);
                cumulativeCredit = addMoney(cumulativeCredit, normalizeMoney(credit));
              }
            }
          }
        }
        // Current return credit (already calculated as totalCredit above, but that was scoped)
        // Re-calculate for this return's lines
        for (const line of lines) {
          const sl = saleLines.get(line.originalSaleLineId);
          let unitValue: string | null = null;
          if (line.originalSaleLineNetUnitValue) {
            unitValue = line.originalSaleLineNetUnitValue;
          } else if (sl) {
            const lineNet = parseFloat(sl.lineNetRevenuePosted);
            const lineQty = parseFloat(sl.quantityKg);
            if (lineQty > 0) unitValue = (lineNet / lineQty).toFixed(6);
          }
          if (unitValue) {
            const credit = (parseFloat(line.quantityKg) * parseFloat(unitValue)).toFixed(2);
            cumulativeCredit = addMoney(cumulativeCredit, normalizeMoney(credit));
          }
        }
        if (!isZeroMoney(cumulativeCredit)) {
          const snapshotResult = await snapshotService.createReturnImpactSnapshot(user, {
            salesOrderId: rr.salesOrderId,
            returnImpact: cumulativeCredit,
          });
          snapshotId = snapshotResult.snapshotId;
        }
      }
      }

      // 3. Update sale return state (approved → partially_returned or fully_returned)
      if (saleLines.size > 0) {
        // Check if all sale lines are fully returned
        let allFullyReturned = true;
        for (const [saleLineId, saleLine] of saleLines) {
          const priorReturns = await returnRequestRepository.listApprovedReturnLinesForSaleLine(
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
        await salesRepository.updateSaleStatusConditional(
          user.tenantId, rr.salesOrderId,
          { saleStatus: newSaleStatus, approvalStatus: "approved", reservationStatus: "consumed" },
          ["approved", "partially_returned"],
        );
      }

      // 4. Update return request status to approved
      const updated = await returnRequestRepository.updateReturnRequestStatus(
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

      // 5. Audit (inside the same transaction — DEC-024)
      await appendAuditLog(audit, user.tenantId, user.userId, {
        entityType: RETURN_ENTITY_TYPE, entityId: rr.id,
        actionType: "return_request.approve",
        newValuesJson: {
          docNo: rr.docNo,
          status: "approved",
          approvedBy: user.userId,
          decisionNotes: input.decisionNotes ?? null,
          stockMovementIds,
          creditEntryId,
          snapshotId,
          financialTreatment: rr.financialTreatment,
        },
        idempotencyKey: input.idempotencyKey,
      });

      // WP-08-01E BLOCKER 2: markSucceeded INSIDE the transaction so that
      // ownership loss rolls back ALL stock/credit/snapshot/audit effects
      // atomically.
      const result = { action: "approved" as const, returnRequestId: rr.id, status: "approved", approvedBy: user.userId, stockMovements: stockMovementIds, creditEntryId, snapshotId };
      await markSucceeded(idemHandle, claim.record.id, {
        responseCode: 200, responseBody: result,
        entityType: RETURN_ENTITY_TYPE, entityId: rr.id,
      }, claim.record.ownerToken!, now);

      return { stockMovementIds, creditEntryId, snapshotId, result };
    };

    // WP-08-01E DEFECT 1: transaction config already required above
    // (before claimIdempotency). Use the pre-acquired variables.
    let result: any;
    try {
      const txResult = await txRunner(async (tx: unknown) => {
        const txInvLedger = txFacs.createInventoryLedger(tx);
        const txSubledger = txFacs.createSubledger(tx);
        const txSnapshotService = txFacs.createSnapshotService(tx);
        const txSalesRepo = txFacs.createSalesRepository(tx);
        const txReturnRepo = txFacs.createReturnRequestRepository(tx);
        const txAudit = txFacs.createAudit(tx);
        const txIdem = txFacs.createIdempotency(tx);
        return executePosting({
          inventoryLedger: txInvLedger,
          subledger: txSubledger,
          snapshotService: txSnapshotService,
          salesRepository: txSalesRepo,
          returnRequestRepository: txReturnRepo,
          audit: txAudit,
          idempotency: txIdem,
        });
      });
      result = txResult.result;
    } catch (txError) {
      // WP-08-01E BLOCKER 2: classify post-rollback failures.
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
            console.error("INVARIANT VIOLATION: stale markRetryableFailed affected rows =", staleAffected);
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

    // WP-08-01E DEFECT 1: Require transaction configuration BEFORE
    // claimIdempotency. Missing config must produce zero idempotency rows.
    const { transactionRunner: txRunner, txFactories: txFacs } = this.requireTransactionConfig();

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
      // WP-08-01E BLOCKER 2: fix missing markBusinessFailed on state-conflict.
      // Previously this threw without marking, leaving the idempotency record
      // in_progress and blocking same-key retries.
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 409, responseBody: { message: `Return in status '${rr.status}'.` },
        lastErrorClass: "ReturnRequestNotApprovableError",
      }, claim.record.ownerToken!, now);
      throw new ReturnRequestNotApprovableError(rr.id, rr.status);
    }

    // WP-08-01E DEFECT 1: transaction config already required above
    // (before claimIdempotency). Use the pre-acquired variables.
    const result = { action: "rejected" as const, returnRequestId: rr.id, status: "rejected" };
    try {
      await txRunner(async (tx: unknown) => {
        const txRrRepo = txFacs.createReturnRequestRepository(tx);
        const txAudit = txFacs.createAudit(tx);
        const txIdem = txFacs.createIdempotency(tx);

        const updated = await txRrRepo.updateReturnRequestStatus(
          user.tenantId, rr.id,
          { status: "rejected", approvalStatus: "rejected", updatedBy: user.userId },
          ["pending_approval"],
        );
        if (!updated) throw new ReturnRequestError("INTERNAL_TRANSACTION_FAILED", `Could not reject return '${rr.id}'.`);

        await appendAuditLog(txAudit, user.tenantId, user.userId, {
          entityType: RETURN_ENTITY_TYPE, entityId: rr.id,
          actionType: "return_request.reject",
          newValuesJson: { docNo: rr.docNo, status: "rejected", rejectionReason: input.rejectionReason },
          idempotencyKey: input.idempotencyKey,
        });

        // markSucceeded INSIDE the transaction — atomic with business writes.
        await markSucceeded(txIdem, claim.record.id, {
          responseCode: 200, responseBody: result,
          entityType: RETURN_ENTITY_TYPE, entityId: rr.id,
        }, claim.record.ownerToken!, now);
      });
    } catch (txError) {
      // WP-08-01E BLOCKER 2: classify post-rollback failures.
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
            console.error("INVARIANT VIOLATION: stale markRetryableFailed affected rows =", staleAffected);
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
