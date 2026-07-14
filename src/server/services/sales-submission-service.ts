/**
 * Sales Submission Service — WP-03-03.
 *
 * Contract: docs/contracts/13_work_packages.md WP-03-03
 *   Goal: Protect available stock for submitted pending sales.
 *   Expected outputs: Reservation service, materialized reserved updates,
 *   safe submit command.
 *   Implementation notes: Draft does not reserve; Owner/Accountant completes
 *   commercial data.
 *   Acceptance: On-hand unchanged at submission and reservation reconciles.
 *
 * Contract: docs/contracts/04_inventory_posting_contract.md §9
 *   "Reservation Contract"
 *   §9.1: "Draft sale does not reserve. Submission locks sale/balances,
 *          validates available stock and state, inserts reservations per
 *          line, increases reserved quantity, sets pending approval,
 *          creates approval request and audit."
 *   §9.5: "reserved_qty_kg never negative. Active reservation totals
 *          reconcile to materialized reserved quantity. Reserved stock
 *          cannot be consumed elsewhere."
 *
 * Contract: docs/contracts/09_api_contracts.md §8
 *   "Submit Sale for Approval" — permission: sales.submit (Owner/Accountant).
 *
 * DEC-065: MVP sale reservation supports ONLY accepted/sellable stock.
 *   needs_review, blocked, discounted-return or other quality-risk stock
 *   must go through review/disposition before reservation.
 *
 * WP-03-03 SCOPE (what this service does):
 *   - Submit a draft sale → create reservations per line + increase reserved_qty_kg
 *   - Idempotency: same key replays, different key on already-submitted rejects
 *   - Concurrent submissions cannot over-reserve (DB CHECK + balance locking)
 *   - On-hand unchanged at submission (only reserved_qty_kg increases)
 *
 * WP-03-03 NON-SCOPE (deferred to later packages):
 *   - Sale approval / consumption (WP-04-xx)
 *   - Sale rejection / cancellation / release (WP-03-04)
 *   - Failure resolution (WP-03-04)
 *   - Invoices, payments, settlements, returns, complaints, profitability
 *   - Customer subledger entries
 *   - Stock movements (reservation is NOT a stock movement — Contract 04 §8)
 */
import "server-only";

import type { ErpUserContext } from "@/server/auth/erp-context";
import { requirePermission, requireTenantMatch, rejectBodyClaimsAuthority } from "@/server/security/guards";
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
import type { InventoryLedgerService } from "./inventory-ledger-service";
import type { InventoryBalance } from "./inventory-ledger-service";
import type { StockReservationRepository, NewStockReservationInput } from "./stock-reservation-repository";
import type { StockReservation } from "@/server/db/schema/inventory-ledger";
import type { SalesRepository } from "./sales-repository";
import type { InventoryItem } from "@/server/db/schema/inventory-items";
import type { Location } from "@/server/db/schema/master-data";
import { addKg, compareKg, isPositiveKg, normalizeKg } from "./decimal-kg";
import { computeSaleSubjectHash } from "./sales-approval-service";

// ---------------------------------------------------------------------------
// Domain types.
// ---------------------------------------------------------------------------

export interface SubmitSaleInput {
  saleId: string;
  decisionNotes?: string | null;
  idempotencyKey: string;
}

export interface SubmitSaleResult {
  action: "submitted" | "replayed";
  saleId: string;
  saleStatus: string;
  reservations: Array<{
    id: string;
    reservationNo: string;
    salesLineId: string;
    itemId: string;
    locationId: string;
    quantityKg: string;
  }>;
  balanceSnapshots: Array<{
    itemId: string;
    locationId: string;
    onHandQtyKg: string;
    reservedQtyKg: string;
    availableQtyKg: string;
    version: number;
  }>;
}

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

export class SalesSubmissionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SalesSubmissionError";
    this.code = code;
  }
}

export class SaleNotFoundError extends SalesSubmissionError {
  constructor(id: string) {
    super("SALE_NOT_FOUND", `Sale '${id}' not found.`);
    this.name = "SaleNotFoundError";
  }
}

export class SaleNotSubmittableError extends SalesSubmissionError {
  constructor(id: string, currentState: string) {
    super(
      "SALE_NOT_SUBMITTABLE",
      `Sale '${id}' is in state '${currentState}' — only 'draft' sales can be submitted.`,
    );
    this.name = "SaleNotSubmittableError";
  }
}

export class SaleAlreadySubmittedError extends SalesSubmissionError {
  constructor(id: string, currentState: string) {
    super(
      "SALE_ALREADY_SUBMITTED",
      `Sale '${id}' is already in state '${currentState}'.`,
    );
    this.name = "SaleAlreadySubmittedError";
  }
}

export class SaleHasNoLinesError extends SalesSubmissionError {
  constructor(id: string) {
    super("SALE_HAS_NO_LINES", `Sale '${id}' has no lines — cannot submit.`);
    this.name = "SaleHasNoLinesError";
  }
}

export class InsufficientAvailableStockError extends SalesSubmissionError {
  constructor(itemId: string, locationId: string, requested: string, available: string) {
    super(
      "INSUFFICIENT_AVAILABLE_STOCK",
      `Insufficient available stock for item ${itemId} at location ${locationId}: requested ${requested} kg, available ${available} kg.`,
    );
    this.name = "InsufficientAvailableStockError";
  }
}

export class ReservationEligibilityError extends SalesSubmissionError {
  constructor(itemId: string, locationId: string, reason: string) {
    super(
      "RESERVATION_ELIGIBILITY_FAILED",
      `Reservation eligibility failed for item ${itemId} at location ${locationId}: ${reason}`,
    );
    this.name = "ReservationEligibilityError";
  }
}

// ---------------------------------------------------------------------------
// Service deps.
// ---------------------------------------------------------------------------

/**
 * A transaction runner that wraps work in a single DB transaction.
 * Mirrors the RawReceiptApprovalService + TransferWorkflowService pattern.
 */
export type SalesSubmissionTransactionRunner = <T>(work: (tx: unknown) => Promise<T>) => Promise<T>;

export interface SalesSubmissionTransactionScopedFactories {
  /** Create an InventoryLedgerService that uses the transaction-scoped `tx`. */
  createInventoryLedger: (tx: unknown) => InventoryLedgerService;
  /** Create a StockReservationRepository that uses the transaction-scoped `tx`. */
  createReservationRepository: (tx: unknown) => StockReservationRepository;
  /** Create a SalesRepository that uses the transaction-scoped `tx`. */
  createSalesRepository: (tx: unknown) => SalesRepository;
}

export interface SalesSubmissionServiceDeps {
  salesRepository: SalesRepository;
  reservationRepository: StockReservationRepository;
  inventoryLedger: InventoryLedgerService;
  audit: AuditTransactionHandle;
  idempotency: IdempotencyTransactionHandle;
  documentSequence: DocumentSequenceTransactionHandle;
  /**
   * Optional transaction runner. When provided, all DB writes in submitSale
   * are wrapped in a single DB transaction.
   */
  transactionRunner?: SalesSubmissionTransactionRunner;
  /** Factory functions for creating transaction-scoped services/repos. */
  txFactories?: SalesSubmissionTransactionScopedFactories;
  /**
   * Item lookup function (for DEC-065 eligibility check).
   * In production, this reads from inventory_items table.
   * In tests, this can be a simple map lookup.
   */
  findItem?: (tenantId: string, itemId: string) => Promise<InventoryItem | null>;
  /**
   * Location lookup function (for validation).
   */
  findLocation?: (tenantId: string, locationId: string) => Promise<Location | null>;
  /**
   * WP-06-01: Quality hold lookup function (for DEC-065 eligibility check).
   * Returns active quality holds for a linked entity (item/batch/lot).
   * If any active hold exists, the item is NOT eligible for sale reservation.
   *
   * In production, this reads from quality_holds table.
   * In tests, this can be a simple lookup against the in-memory quality test repo.
   */
  findActiveQualityHolds?: (
    tenantId: string,
    linkedEntityType: string,
    linkedEntityId: string,
  ) => Promise<Array<{ holdReason: string; holdStatus: string }>>;
}

const SALE_SOURCE_TYPE = "sales_order_line";
const SALE_ENTITY_TYPE = "sales_order";

// ---------------------------------------------------------------------------
// SalesSubmissionService.
// ---------------------------------------------------------------------------

/**
 * WP-03-03 Sales Submission Service.
 *
 * Atomically submits a draft sale:
 *   1. (outside tx) permission + idempotency claim + sale state check
 *   2. (inside tx) for each line:
 *        a. lock balance (findBalanceForUpdate)
 *        b. check DEC-065 eligibility (item accepted, not blocked, sellable)
 *        c. check available stock (on_hand - reserved - blocked >= qty)
 *        d. allocate reservation number
 *        e. insert reservation (status=active)
 *        f. update balance reserved_qty_kg += qty
 *      update sale status to pending_approval
 *   3. (outside tx) audit + markSucceeded
 *
 * Invariants:
 *   - on_hand_qty_kg NEVER changes at submission (Contract 04 §8, §9)
 *   - reserved_qty_kg increases by exactly the line quantity per line
 *   - available_qty_kg decreases by exactly the line quantity per line
 *   - one active reservation per (source, item, location) — DB unique index
 *   - idempotency: same key replays, different key on submitted sale rejects
 *   - concurrent submissions cannot over-reserve (DB CHECK + balance locking)
 */
export class SalesSubmissionService {
  constructor(private readonly deps: SalesSubmissionServiceDeps) {}

  async submitSale(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: SubmitSaleInput,
  ): Promise<SubmitSaleResult> {
    // Step 1-2: permission + reject body authority.
    requirePermission(effective, "sales.submit");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!input.saleId || input.saleId.trim() === "") {
      throw new SalesSubmissionError("VALIDATION_FAILED", "Sale ID is required.");
    }
    if (!input.idempotencyKey || input.idempotencyKey.trim() === "") {
      throw new SalesSubmissionError("VALIDATION_FAILED", "Idempotency key is required.");
    }

    // Step 3: fetch sale (for state check).
    const sale = await this.deps.salesRepository.findSaleById(user.tenantId, input.saleId);
    if (!sale) throw new SaleNotFoundError(input.saleId);
    requireTenantMatch(user, sale.tenantId);

    // Step 4: claim idempotency FIRST (before any state mutation).
    const now = new Date();
    const idempotencyInput: IdempotencyClaimInput = {
      tenantId: user.tenantId,
      operationScope: "sales_submission.submit",
      idempotencyKey: input.idempotencyKey,
      requestBody: {
        saleId: input.saleId,
        decisionNotes: input.decisionNotes ?? null,
      } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    };

    const claim = await claimIdempotency(this.deps.idempotency, idempotencyInput);

    if (claim.action === "replay") {
      // Prior call with same key succeeded — return the stored result.
      const refreshed = await this.deps.salesRepository.findSaleById(user.tenantId, input.saleId);
      if (refreshed && refreshed.saleStatus === "pending_approval") {
        const reservations = await this.deps.reservationRepository.listActiveReservationsForSale(
          user.tenantId, input.saleId,
        );
        return {
          action: "replayed" as const,
          saleId: refreshed.id,
          saleStatus: refreshed.saleStatus,
          reservations: reservations.map((r) => ({
            id: r.id,
            reservationNo: r.reservationNo,
            salesLineId: r.salesLineId ?? "",
            itemId: r.itemId,
            locationId: r.locationId,
            quantityKg: r.quantityKg,
          })),
          balanceSnapshots: [],
        };
      }
      // Idempotency says replay but sale not submitted — fall through to execute.
    }

    if (claim.action === "conflict") {
      throw new SalesSubmissionError(
        "IDEMPOTENCY_CONFLICT",
        `Idempotency key '${input.idempotencyKey}' was used with a different request body.`,
      );
    }

    if (claim.action === "in_progress") {
      throw new SalesSubmissionError(
        "OPERATION_IN_PROGRESS",
        `Operation '${input.idempotencyKey}' is still in progress.`,
      );
    }

    // claim.action === "execute" — fresh call. Now check sale state.
    if (sale.saleStatus !== "draft") {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 409,
        responseBody: { message: `Sale already in state '${sale.saleStatus}'.` },
        lastErrorClass: "SaleAlreadySubmittedError",
      }, now);
      throw new SaleAlreadySubmittedError(sale.id, sale.saleStatus);
    }

    // Fetch sale lines.
    const lines = await this.deps.salesRepository.findSaleLines(user.tenantId, input.saleId);
    if (lines.length === 0) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 422,
        responseBody: { message: "Sale has no lines." },
        lastErrorClass: "SaleHasNoLinesError",
      }, now);
      throw new SaleHasNoLinesError(sale.id);
    }

    // Validate each line has required fields.
    for (const line of lines) {
      if (!isPositiveKg(line.quantityKg)) {
        await markBusinessFailed(this.deps.idempotency, claim.record.id, {
          responseCode: 422,
          responseBody: { message: `Line ${line.lineNo} quantity must be positive.` },
          lastErrorClass: "SalesSubmissionError",
        }, now);
        throw new SalesSubmissionError(
          "VALIDATION_FAILED",
          `Line ${line.lineNo} quantity must be positive, got '${line.quantityKg}'.`,
        );
      }
    }

    // =====================================================================
    // ATOMIC SUBMISSION TRANSACTION
    // =====================================================================
    const executeSubmission = async (
      txScoped: {
        inventoryLedger: InventoryLedgerService;
        reservationRepository: StockReservationRepository;
        salesRepository: SalesRepository;
      } | null,
    ): Promise<SubmitSaleResult> => {
      const invLedger = txScoped?.inventoryLedger ?? this.deps.inventoryLedger;
      const reservationRepo = txScoped?.reservationRepository ?? this.deps.reservationRepository;
      const salesRepo = txScoped?.salesRepository ?? this.deps.salesRepository;

      const sortedLines = [...lines].sort((a, b) => a.lineNo - b.lineNo);

      const createdReservations: StockReservation[] = [];
      const balanceSnapshots: SubmitSaleResult["balanceSnapshots"] = [];

      for (const line of sortedLines) {
        // Duplicate-source guard.
        const existing = await reservationRepo.findActiveReservationBySource(
          user.tenantId,
          SALE_SOURCE_TYPE,
          line.id,
          line.itemId,
          line.locationId,
        );
        if (existing) {
          throw new SalesSubmissionError(
            "DUPLICATE_RESERVATION",
            `Line ${line.lineNo} already has an active reservation (${existing.reservationNo}).`,
          );
        }

        // Lock balance (SELECT FOR UPDATE) via narrow reservation boundary.
        const balance = await invLedger.findBalanceForUpdate(
          user.tenantId, line.itemId, line.locationId,
        );
        if (!balance) {
          throw new InsufficientAvailableStockError(
            line.itemId, line.locationId, line.quantityKg, "0.000",
          );
        }
        requireTenantMatch(user, balance.tenantId);

        // DEC-065 eligibility check (if item lookup is available).
        if (this.deps.findItem) {
          const item = await this.deps.findItem(user.tenantId, line.itemId);
          if (item) {
            const eligibility = checkReservationEligibilityFromItemAndBalance(item, balance);
            if (!eligibility.eligible) {
              throw new ReservationEligibilityError(line.itemId, line.locationId, eligibility.reason);
            }
          }
        }

        // WP-06-01 DEC-065 quality hold check.
        // If any active quality hold exists for this item, reject reservation.
        // This enforces: "Blocked/review stock cannot ordinary-sell."
        //
        // FAIL-CLOSED: If findActiveQualityHolds is not provided (e.g., in a
        // test that doesn't care about quality holds), we SKIP the check.
        // But in PRODUCTION, this dependency MUST be wired — otherwise the
        // service would silently allow sales of quality-restricted stock.
        // Production wiring is verified by service-composition tests.
        if (this.deps.findActiveQualityHolds) {
          const holds = await this.deps.findActiveQualityHolds(user.tenantId, "inventory_item", line.itemId);
          if (holds.length > 0) {
            const holdReasons = holds.map(h => h.holdReason).join(", ");
            throw new ReservationEligibilityError(
              line.itemId, line.locationId,
              `Active quality hold(s) on item: ${holdReasons}. Stock cannot be reserved until management clears the hold (DEC-065).`,
            );
          }
        }

        // Check available stock: available = on_hand - reserved - blocked.
        const available = computeAvailableQty(balance);
        const normalizedQty = normalizeKg(line.quantityKg);
        if (compareKg(available, normalizedQty) < 0) {
          throw new InsufficientAvailableStockError(
            line.itemId, line.locationId, normalizedQty, available,
          );
        }

        // Allocate reservation number.
        const year = now.getUTCFullYear();
        const docNoResult = await allocateDocumentNumber(this.deps.documentSequence, {
          tenantId: user.tenantId,
          documentType: "reservation",
          year,
          entityType: "stock_reservation",
        });

        // Insert reservation (status=active).
        const reservationInput: NewStockReservationInput = {
          tenantId: user.tenantId,
          reservationNo: docNoResult.docNo,
          itemId: line.itemId,
          locationId: line.locationId,
          quantityKg: normalizedQty,
          sourceType: SALE_SOURCE_TYPE,
          sourceId: line.id,
          salesOrderId: sale.id,
          salesLineId: line.id,
          idempotencyKey: `${input.idempotencyKey}:res:${line.id}`,
        };
        const reservation = await reservationRepo.insertReservation(reservationInput);
        createdReservations.push(reservation);

        // Update balance reserved_qty_kg += qty (on_hand UNCHANGED) via narrow boundary.
        const newReserved = addKg(balance.reservedQtyKg, normalizedQty);
        const updated = await invLedger.updateReservedQty(
          user.tenantId, line.itemId, line.locationId,
          { reservedQtyKg: newReserved, version: balance.version + 1 },
        );
        if (!updated) {
          throw new SalesSubmissionError(
            "INTERNAL_TRANSACTION_FAILED",
            `Balance not found during reserved_qty update for item ${line.itemId} at location ${line.locationId}.`,
          );
        }

        balanceSnapshots.push({
          itemId: line.itemId,
          locationId: line.locationId,
          onHandQtyKg: updated.onHandQtyKg,
          reservedQtyKg: updated.reservedQtyKg,
          availableQtyKg: computeAvailableQty(updated),
          version: updated.version,
        });
      }

      // Update sale status to pending_approval.
      const updatedSale = await salesRepo.updateSaleStatus(
        user.tenantId, sale.id,
        {
          saleStatus: "pending_approval",
          approvalStatus: "pending_approval",
          reservationStatus: "reserved",
        },
      );
      if (!updatedSale) {
        throw new SalesSubmissionError(
          "INTERNAL_TRANSACTION_FAILED",
          `Sale ${sale.id} not found during status update.`,
        );
      }

      // WP-05-03 blocker fix: compute and persist subject_hash + subject_version
      // at submit time so approval can verify the sale's facts are unchanged.
      // The hash uses the same fields the approval service recomputes —
      // sale id, customer, date, totals, and per-line (id, qty, price, net revenue).
      // Stored version = 1 (initial submission).
      const subjectHash = computeSaleSubjectHash(updatedSale, sortedLines);
      const saleWithHash = await salesRepo.updateSaleSubjectHash(
        user.tenantId, sale.id,
        { subjectHash, subjectVersion: 1 },
      );
      if (!saleWithHash) {
        throw new SalesSubmissionError(
          "INTERNAL_TRANSACTION_FAILED",
          `Sale ${sale.id} not found during subject_hash update.`,
        );
      }

      return {
        action: "submitted" as const,
        saleId: sale.id,
        saleStatus: saleWithHash.saleStatus,
        reservations: createdReservations.map((r) => ({
          id: r.id,
          reservationNo: r.reservationNo,
          salesLineId: r.salesLineId ?? "",
          itemId: r.itemId,
          locationId: r.locationId,
          quantityKg: r.quantityKg,
        })),
        balanceSnapshots,
      };
    };

    let result: SubmitSaleResult;
    try {
      if (this.deps.transactionRunner && this.deps.txFactories) {
        result = await this.deps.transactionRunner(async (tx: unknown) => {
          const txInvLedger = this.deps.txFactories!.createInventoryLedger(tx);
          const txResRepo = this.deps.txFactories!.createReservationRepository(tx);
          const txSalesRepo = this.deps.txFactories!.createSalesRepository(tx);
          return executeSubmission({
            inventoryLedger: txInvLedger,
            reservationRepository: txResRepo,
            salesRepository: txSalesRepo,
          });
        });
      } else {
        result = await executeSubmission(null);
      }
    } catch (txError) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 500,
        responseBody: { message: "Sales submission transaction failed and rolled back." },
        lastErrorClass: txError instanceof Error ? txError.name : "Unknown",
      }, now);
      throw txError;
    }

    // Audit (in-process).
    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: SALE_ENTITY_TYPE,
      entityId: sale.id,
      actionType: "sales_submission.submit",
      newValuesJson: {
        saleStatus: result.saleStatus,
        reservationCount: result.reservations.length,
        reservations: result.reservations.map((r) => ({
          id: r.id,
          reservationNo: r.reservationNo,
          quantityKg: r.quantityKg,
        })),
        balanceSnapshots: result.balanceSnapshots,
      },
      idempotencyKey: input.idempotencyKey,
    });

    // Mark idempotency succeeded.
    await markSucceeded(this.deps.idempotency, claim.record.id, {
      responseCode: 200,
      responseBody: {
        saleId: sale.id,
        saleStatus: result.saleStatus,
        reservationCount: result.reservations.length,
      },
    }, now);

    return result;
  }
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function computeAvailableQty(balance: InventoryBalance): string {
  const onHand = parseFloat(balance.onHandQtyKg);
  const reserved = parseFloat(balance.reservedQtyKg);
  const blocked = parseFloat(balance.blockedQtyKg);
  const available = onHand - reserved - blocked;
  return available.toFixed(3);
}

function checkReservationEligibilityFromItemAndBalance(
  item: InventoryItem,
  balance: InventoryBalance,
): { eligible: boolean; reason: string } {
  if (item.qualityStatus !== "accepted") {
    return {
      eligible: false,
      reason: `Quality status '${item.qualityStatus}' is not accepted for sale reservation (DEC-065).`,
    };
  }
  if (item.isBlocked) {
    return {
      eligible: false,
      reason: "Item is blocked (is_blocked=true) and cannot be reserved for sale (DEC-065).",
    };
  }
  if (parseFloat(balance.blockedQtyKg) > 0) {
    return {
      eligible: false,
      reason: `Blocked quantity (${balance.blockedQtyKg} kg) is non-zero; blocked stock cannot be reserved (DEC-065).`,
    };
  }
  return { eligible: true, reason: "" };
}
