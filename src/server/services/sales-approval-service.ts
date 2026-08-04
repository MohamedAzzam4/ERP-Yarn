/**
 * Sales Approval Service — WP-05-03.
 *
 * Contract: docs/contracts/13_work_packages.md WP-05-03
 * Contract: docs/contracts/06_approval_transaction_contract.md §6 + §8
 * Contract: docs/contracts/07_subledger_and_costs_contract.md §8 + §10
 * Contract: docs/contracts/04_inventory_posting_contract.md §8 + §9
 *
 * DEC-080: Requester cannot approve own request.
 * DEC-065: Quality-risk stock re-check at approval time.
 * DEC-082: Residual allocation (from WP-05-01, used as-is).
 *
 * WP-05-03 SCOPE:
 *   - Approve a pending submitted sale atomically
 *   - On approval: issue stock, consume reservations, post receivable,
 *     create profitability snapshot v1, mark approved, audit — all in ONE tx
 *   - On failure: no partial business state; classify failure reason
 *   - Idempotency: same key replay returns original result; different key rejects
 *   - Subject hash/version: stale approval rejects before mutation
 *
 * WP-05-03 NON-SCOPE:
 *   - Payments/settlements (WP-05-04)
 *   - Direct cost review (WP-05-05)
 *   - Sale rejection/cancellation (wraps WP-03-04 SalesFailureResolutionService)
 */
import "server-only";

import type { ErpUserContext } from "@/server/auth/erp-context";
import { requirePermission, requireTenantMatch, rejectBodyClaimsAuthority } from "@/server/security/guards";
import type { EffectivePermissions } from "@/server/security/effective-permissions";
import { appendAuditLog, type AuditTransactionHandle } from "./audit-service";
import { claimIdempotency, markSucceeded, markBusinessFailed, type IdempotencyTransactionHandle, type IdempotencyClaimInput } from "./idempotency-service";
import { allocateDocumentNumber, type DocumentSequenceTransactionHandle } from "./document-sequence-service";
import type { InventoryLedgerService } from "./inventory-ledger-service";
import type { SubledgerService } from "./subledger-service";
import type { ProfitabilitySnapshotService } from "./profitability-snapshot-service";
import type { SalesRepository } from "./sales-repository";
import type { StockReservationRepository } from "./stock-reservation-repository";
import type { SalesOrder, SalesOrderLine } from "@/server/db/schema/sales";
import type { StockReservation } from "@/server/db/schema/inventory-ledger";
import { createHash } from "node:crypto";
import { normalizeKg, isPositiveKg, compareKg, subtractKg } from "./decimal-kg";
import { normalizeMoney, isZeroMoney } from "./decimal-money";

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

export interface ApproveSaleInput {
  saleId: string;
  idempotencyKey: string;
  decisionNotes?: string | null;
  /** Cost components for profitability snapshot (passed through to WP-05-02). */
  snapshotCosts?: {
    rawCost?: string | null;
    singleProductionCost?: string | null;
    twistingCost?: string | null;
    transportCost?: string | null;
    reviewedDirectCosts?: string | null;
  };
}

export interface ApproveSaleResult {
  action: "posted" | "replayed";
  saleId: string;
  saleStatus: string;
  movements: Array<{ lineId: string; movementId: string; docNo: string }>;
  receivableEntryId: string;
  receivableEntryNo: string;
  receivableAmountSigned: string;
  snapshotId: string;
  snapshotVersion: number;
}

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

export class SalesApprovalError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = "SalesApprovalError"; this.code = code; }
}

export class SaleNotFoundForApprovalError extends SalesApprovalError {
  constructor(id: string) { super("SALE_NOT_FOUND", `Sale '${id}' not found.`); this.name = "SaleNotFoundForApprovalError"; }
}

export class SaleNotPendingError extends SalesApprovalError {
  constructor(id: string, status: string) { super("STATE_CONFLICT", `Sale '${id}' is in status '${status}' — must be 'pending_approval'.`); this.name = "SaleNotPendingError"; }
}

export class SaleAlreadyApprovedError extends SalesApprovalError {
  constructor(id: string) { super("STATE_CONFLICT", `Sale '${id}' is already approved.`); this.name = "SaleAlreadyApprovedError"; }
}

export class SubjectHashMismatchError extends SalesApprovalError {
  constructor(id: string) { super("SUBJECT_CHANGED", `Subject hash mismatch for sale '${id}'. The sale facts changed after submission.`); this.name = "SubjectHashMismatchError"; }
}

export class MissingSubjectHashError extends SalesApprovalError {
  constructor(id: string) { super("MISSING_SUBJECT_HASH", `Sale '${id}' has no subject_hash. Newly submitted sales must have a subject_hash set by the submit flow.`); this.name = "MissingSubjectHashError"; }
}

export class RequesterCannotApproveOwnSaleError extends SalesApprovalError {
  constructor(id: string, userId: string) { super("REQUESTER_CANNOT_APPROVE_OWN", `User '${userId}' cannot approve sale '${id}' — DEC-080.`); this.name = "RequesterCannotApproveOwnSaleError"; }
}

export class ReservationMismatchError extends SalesApprovalError {
  constructor(id: string) { super("VALIDATION_FAILED", `Sale '${id}' has lines without active reservations.`); this.name = "ReservationMismatchError"; }
}

export class CommercialTotalsNotPostedError extends SalesApprovalError {
  constructor(id: string) { super("VALIDATION_FAILED", `Sale '${id}' commercial totals not completed.`); this.name = "CommercialTotalsNotPostedError"; }
}

// ---------------------------------------------------------------------------
// Transaction runner + factories.
// ---------------------------------------------------------------------------

export type SalesApprovalTransactionRunner = <T>(work: (tx: unknown) => Promise<T>) => Promise<T>;

export interface SalesApprovalTransactionScopedFactories {
  createInventoryLedger: (tx: unknown) => InventoryLedgerService;
  createSubledger: (tx: unknown) => SubledgerService;
  createSalesRepository: (tx: unknown) => SalesRepository;
  createReservationRepository: (tx: unknown) => StockReservationRepository;
  createSnapshotService: (tx: unknown) => ProfitabilitySnapshotService;
  createIdempotency?: (tx: unknown) => IdempotencyTransactionHandle;
  /** WP-08-01C: tx-scoped audit for atomic audit rollback. */
  createAudit?: (tx: unknown) => AuditTransactionHandle;
}

// ---------------------------------------------------------------------------
// Service deps.
// ---------------------------------------------------------------------------

export interface SalesApprovalServiceDeps {
  salesRepository: SalesRepository;
  reservationRepository: StockReservationRepository;
  inventoryLedger: InventoryLedgerService;
  subledger: SubledgerService;
  snapshotService: ProfitabilitySnapshotService;
  audit: AuditTransactionHandle;
  idempotency: IdempotencyTransactionHandle;
  documentSequence: DocumentSequenceTransactionHandle;
  transactionRunner?: SalesApprovalTransactionRunner;
  txFactories?: SalesApprovalTransactionScopedFactories;
}

const SALES_ENTITY_TYPE = "sales_order";
const SOURCE_DOC_TYPE_SALES_LINE = "sales_order_line";

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function computeSaleSubjectHash(sale: SalesOrder, lines: SalesOrderLine[]): string {
  const fields = [
    sale.id,
    sale.customerId,
    sale.saleDate,
    sale.documentTotalPosted,
    sale.orderDiscountTotal,
    ...lines.flatMap(l => [l.id, l.quantityKg, l.pricePerTon ?? "", l.lineNetRevenuePosted ?? ""]),
  ];
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}

/**
 * Exported for use by the submit flow (SalesSubmissionService) so the same
 * hash function is used at submit time (store) and at approval time (verify).
 * WP-05-03 blocker fix: subject_hash must be non-null for newly submitted sales.
 */
export { computeSaleSubjectHash };

// ---------------------------------------------------------------------------
// SalesApprovalService.
// ---------------------------------------------------------------------------

export class SalesApprovalService {
  constructor(private readonly deps: SalesApprovalServiceDeps) {}

  async approveSale(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: ApproveSaleInput,
  ): Promise<ApproveSaleResult> {
    // Step 1-2: permission + reject body authority
    requirePermission(effective, "sales.approve");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    // Step 3: validate input
    if (!input.saleId?.trim()) throw new SalesApprovalError("VALIDATION_FAILED", "saleId is required.");
    if (!input.idempotencyKey?.trim()) throw new SalesApprovalError("VALIDATION_FAILED", "idempotencyKey is required.");

    // Step 4: fetch sale
    const sale = await this.deps.salesRepository.findSaleById(user.tenantId, input.saleId);
    if (!sale) throw new SaleNotFoundForApprovalError(input.saleId);
    requireTenantMatch(user, sale.tenantId);

    // Step 5: claim idempotency FIRST
    const now = new Date();
    const idempotencyInput: IdempotencyClaimInput = {
      tenantId: user.tenantId,
      operationScope: "sales_approval.approve",
      idempotencyKey: input.idempotencyKey,
      requestBody: { saleId: input.saleId, decisionNotes: input.decisionNotes ?? null },
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    };

    const claim = await claimIdempotency(this.deps.idempotency, idempotencyInput);

    if (claim.action === "replay") {
      const responseBody = claim.record.responseBody as Partial<ApproveSaleResult> | null;
      if (responseBody?.saleId) {
        return { ...responseBody, action: "replayed" } as ApproveSaleResult;
      }
    }

    if (claim.action === "conflict") {
      throw new SalesApprovalError("IDEMPOTENCY_CONFLICT", `Idempotency key '${input.idempotencyKey}' was used with a different request body.`);
    }

    if (claim.action === "in_progress") {
      throw new SalesApprovalError("OPERATION_IN_PROGRESS", `Operation '${input.idempotencyKey}' is still in progress.`);
    }

    // claim.action === "execute" — check business preconditions

    // State check: must be pending_approval
    if (sale.saleStatus !== "pending_approval") {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 409, responseBody: { message: `Sale in status '${sale.saleStatus}' cannot be approved.` },
        lastErrorClass: "SaleNotPendingError",
      }, claim.record.ownerToken!, now);
      throw new SaleNotPendingError(sale.id, sale.saleStatus);
    }

    // DEC-080: requester cannot approve own request
    // The sale's createdBy is the requester; the approver must be different
    if (sale.createdBy && sale.createdBy === user.userId) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 403, responseBody: { message: "Requester cannot approve own sale." },
        lastErrorClass: "RequesterCannotApproveOwnSaleError",
      }, claim.record.ownerToken!, now);
      throw new RequesterCannotApproveOwnSaleError(sale.id, user.userId);
    }

    // Fetch lines
    const lines = await this.deps.salesRepository.findSaleLines(user.tenantId, sale.id);
    if (lines.length === 0) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 422, responseBody: { message: "Sale has no lines." },
        lastErrorClass: "SalesApprovalError",
      }, claim.record.ownerToken!, now);
      throw new SalesApprovalError("VALIDATION_FAILED", "Sale has no lines.");
    }

    // Verify commercial totals are completed
    for (const line of lines) {
      if (line.lineNetRevenuePosted === null || line.pricePerTon === null) {
        await markBusinessFailed(this.deps.idempotency, claim.record.id, {
          responseCode: 422, responseBody: { message: "Commercial totals not completed." },
          lastErrorClass: "CommercialTotalsNotPostedError",
        }, claim.record.ownerToken!, now);
        throw new CommercialTotalsNotPostedError(sale.id);
      }
    }

    // Subject hash verification (Contract 06 §6 step 4).
    // Newly submitted sales MUST have a non-null subject_hash set by the submit flow.
    // NULL subjectHash means the sale was never properly submitted — reject explicitly.
    if (!sale.subjectHash) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 409, responseBody: { message: "Missing subject_hash." },
        lastErrorClass: "MissingSubjectHashError",
      }, claim.record.ownerToken!, now);
      throw new MissingSubjectHashError(sale.id);
    }
    // Recompute and reject stale/mismatched subject hash before any mutation.
    const currentHash = computeSaleSubjectHash(sale, lines);
    if (currentHash !== sale.subjectHash) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 409, responseBody: { message: "Subject hash mismatch." },
        lastErrorClass: "SubjectHashMismatchError",
      }, claim.record.ownerToken!, now);
      throw new SubjectHashMismatchError(sale.id);
    }

    // Fetch reservations for all lines (Contract 04 §9).
    // For each line we verify: reservation exists, is active, matches item+location+tenant,
    // has quantity at least equal to the line quantity. This is defense-in-depth —
    // the submit flow already validated these, but the approval flow runs after
    // potentially long delays and concurrent access.
    const reservations: StockReservation[] = [];
    const seenReservationIds = new Set<string>();
    for (const line of lines) {
      const res = await this.deps.reservationRepository.findActiveReservationBySource(
        user.tenantId, SOURCE_DOC_TYPE_SALES_LINE, line.id, line.itemId, line.locationId,
      );
      if (!res) {
        // Covers: missing reservation, item mismatch, location mismatch,
        // tenant mismatch, status != active (findActiveReservationBySource
        // filters by tenantId + status=active + item + location).
        await markBusinessFailed(this.deps.idempotency, claim.record.id, {
          responseCode: 422, responseBody: { message: `Line '${line.id}' has no active reservation (missing/mismatch/inactive).` },
          lastErrorClass: "ReservationMismatchError",
        }, claim.record.ownerToken!, now);
        throw new ReservationMismatchError(sale.id);
      }
      // Duplicate-active-reservation guard: a line must not have multiple
      // active reservations. findActiveReservationBySource returns the first
      // match; if we see the same reservation ID twice, that's a corruption.
      if (seenReservationIds.has(res.id)) {
        await markBusinessFailed(this.deps.idempotency, claim.record.id, {
          responseCode: 422, responseBody: { message: `Reservation '${res.id}' is duplicated across lines.` },
          lastErrorClass: "ReservationMismatchError",
        }, claim.record.ownerToken!, now);
        throw new ReservationMismatchError(sale.id);
      }
      seenReservationIds.add(res.id);
      // Quantity sufficiency: reservation quantity must cover the line quantity.
      // The line.quantityKg is what we will issue from stock, so the reservation
      // must have reserved at least that amount.
      if (compareKg(res.quantityKg, normalizeKg(line.quantityKg)) < 0) {
        await markBusinessFailed(this.deps.idempotency, claim.record.id, {
          responseCode: 422, responseBody: { message: `Reservation '${res.id}' quantity ${res.quantityKg} < line quantity ${line.quantityKg}.` },
          lastErrorClass: "ReservationMismatchError",
        }, claim.record.ownerToken!, now);
        throw new ReservationMismatchError(sale.id);
      }
      reservations.push(res);
    }

    // =====================================================================
    // ATOMIC APPROVAL TRANSACTION (Contract 06 §6 + §8)
    // =====================================================================

    const executeApproval = async (
      txScoped: {
        inventoryLedger: InventoryLedgerService;
        subledger: SubledgerService;
        salesRepository: SalesRepository;
        reservationRepository: StockReservationRepository;
        snapshotService: ProfitabilitySnapshotService;
        idempotency?: IdempotencyTransactionHandle;
        audit?: AuditTransactionHandle;
      } | null,
    ): Promise<ApproveSaleResult> => {
      const invLedger = txScoped?.inventoryLedger ?? this.deps.inventoryLedger;
      const subledger = txScoped?.subledger ?? this.deps.subledger;
      const salesRepo = txScoped?.salesRepository ?? this.deps.salesRepository;
      const resRepo = txScoped?.reservationRepository ?? this.deps.reservationRepository;
      const snapSvc = txScoped?.snapshotService ?? this.deps.snapshotService;
      const idemHandle = txScoped?.idempotency ?? this.deps.idempotency;
      // WP-08-01C: Use tx-scoped audit if available (for atomic audit rollback).
      const auditHandle = txScoped?.audit ?? this.deps.audit;

      const year = now.getUTCFullYear();
      const movementResults: Array<{ lineId: string; movementId: string; docNo: string }> = [];

      // Step 9a: Post sale_issue movements + consume reservations
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const reservation = reservations[i]!;

        // Allocate movement doc_no
        const mvDocNo = await allocateDocumentNumber(this.deps.documentSequence, {
          tenantId: user.tenantId, documentType: "sales_order", year, entityType: "stock_movement",
        });

        // Post sale_issue movement (tx-scoped, no own idempotency)
        const mvResult = await invLedger.postSaleIssue(user, effective, {
          itemId: line.itemId,
          fromLocationId: line.locationId,
          quantityKg: line.quantityKg,
          movementDate: sale.saleDate,
          sourceDocumentType: SOURCE_DOC_TYPE_SALES_LINE,
          sourceDocumentId: line.id,
          docNo: mvDocNo.docNo,
          idempotencyKey: `${input.idempotencyKey}:issue:${line.id}`,
          notes: input.decisionNotes ?? undefined,
        });

        // Link movement to line
        await salesRepo.updateLineSaleIssueMovementId(user.tenantId, line.id, mvResult.movementId);

        // Consume reservation (active → approved_consumed)
        const consumed = await resRepo.markReservationConsumed(user.tenantId, reservation.id);
        if (!consumed) {
          throw new SalesApprovalError("INTERNAL_TRANSACTION_FAILED", `Reservation '${reservation.id}' could not be consumed.`);
        }

        movementResults.push({ lineId: line.id, movementId: mvResult.movementId, docNo: mvResult.docNo });
      }

      // Step 9b: Post customer receivable (POSITIVE = +document_total_posted)
      const receivableDocNo = await allocateDocumentNumber(this.deps.documentSequence, {
        tenantId: user.tenantId, documentType: "account_entry", year, entityType: "account_entry",
      });

      const receivableResult = await subledger.insertCustomerReceivableEntry(user, effective, {
        customerId: sale.customerId,
        saleId: sale.id,
        documentTotalPosted: sale.documentTotalPosted,
        entryDate: sale.saleDate,
        docNo: receivableDocNo.docNo,
        idempotencyKey: `${input.idempotencyKey}:receivable`,
      });

      // Step 9c: Create profitability snapshot v1 (inside same tx)
      const snapshotResult = await snapSvc.createVersion1Snapshot(user, {
        salesOrderId: sale.id,
        rawCost: input.snapshotCosts?.rawCost ?? null,
        singleProductionCost: input.snapshotCosts?.singleProductionCost ?? null,
        twistingCost: input.snapshotCosts?.twistingCost ?? null,
        transportCost: input.snapshotCosts?.transportCost ?? null,
        reviewedDirectCosts: input.snapshotCosts?.reviewedDirectCosts ?? null,
      });

      // Step 9d: Mark sale approved/locked (conditional on pending_approval)
      const approvedSale = await salesRepo.markSaleApproved(
        user.tenantId, sale.id,
        { approvedBy: user.userId, approvedAt: now },
        ["pending_approval"],
      );
      if (!approvedSale) {
        throw new SaleAlreadyApprovedError(sale.id);
      }

      // Step 10: Audit (inside same tx — DEC-024)
      await appendAuditLog(auditHandle, user.tenantId, user.userId, {
        entityType: SALES_ENTITY_TYPE,
        entityId: sale.id,
        actionType: "sales_approval.approve",
        newValuesJson: {
          saleId: sale.id,
          docNo: sale.docNo,
          movements: movementResults,
          receivableEntryId: receivableResult.entryId,
          receivableAmountSigned: receivableResult.amountSigned,
          snapshotId: snapshotResult.snapshotId,
          snapshotVersion: snapshotResult.version,
          saleStatus: "approved",
        },
        idempotencyKey: input.idempotencyKey,
      });

      const result: ApproveSaleResult = {
        action: "posted",
        saleId: sale.id,
        saleStatus: "approved",
        movements: movementResults,
        receivableEntryId: receivableResult.entryId,
        receivableEntryNo: receivableResult.entryNo,
        receivableAmountSigned: receivableResult.amountSigned,
        snapshotId: snapshotResult.snapshotId,
        snapshotVersion: snapshotResult.version,
      };
      await markSucceeded(idemHandle, claim.record.id, {
        responseCode: 200, responseBody: result,
        entityType: SALES_ENTITY_TYPE, entityId: sale.id,
      }, claim.record.ownerToken!, now);
      return result;
    };

    let result: ApproveSaleResult;
    try {
      if (this.deps.transactionRunner && this.deps.txFactories) {
        result = await this.deps.transactionRunner(async (tx: unknown) => {
          const txInv = this.deps.txFactories!.createInventoryLedger(tx);
          const txSub = this.deps.txFactories!.createSubledger(tx);
          const txSales = this.deps.txFactories!.createSalesRepository(tx);
          const txRes = this.deps.txFactories!.createReservationRepository(tx);
          const txSnap = this.deps.txFactories!.createSnapshotService(tx);
          const txIdem = this.deps.txFactories!.createIdempotency?.(tx);
          const txAudit = this.deps.txFactories!.createAudit?.(tx);
          return executeApproval({
            inventoryLedger: txInv, subledger: txSub, salesRepository: txSales,
            reservationRepository: txRes, snapshotService: txSnap,
            idempotency: txIdem, audit: txAudit,
          });
        });
      } else {
        result = await executeApproval(null);
      }
    } catch (txError) {
      try {
        await markBusinessFailed(this.deps.idempotency, claim.record.id, {
          responseCode: 500, responseBody: { message: "Approval transaction failed and rolled back." },
          lastErrorClass: txError instanceof Error ? txError.name : "Unknown",
        }, claim.record.ownerToken!, now);
      } catch (markError) {
        console.error("Failed to mark idempotency as business_failed after tx rollback:", markError);
      }
      throw txError;
    }

    return result;
  }
}
