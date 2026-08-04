/**
 * Sales Failure Resolution Service — WP-03-04.
 *
 * Contract: docs/contracts/04_inventory_posting_contract.md §9.4
 *   "Approval-Failure Resolution"
 *
 * Contract: docs/contracts/06_approval_transaction_contract.md §7, §8
 *   "Idempotency and Failure Recording" + "Sales Approval Contract"
 *
 * WP-03-04 SCOPE (what this service does):
 *   - Resolve a failed sale by applying the reason → outcome mapping
 *     from Contract 04 §9.4 + Contract 06 §8.
 *   - Create critical alerts for missing/corrupted reservations.
 *   - Mark reservations as `failed` (corruption case) or `released` (human
 *     rejection/cancellation case).
 *   - Update sale status: pending_approval → approval_failed | needs_review |
 *     rejected | cancelled (depending on reason).
 *   - All in one atomic DB transaction (via transactionRunner + txFactories).
 *   - Idempotency: same key replays, different key on already-resolved sale
 *     rejects.
 *
 * WP-03-04 NON-SCOPE (deferred to later packages):
 *   - Sale approval / posting (WP-04-xx)
 *   - Stock issue movements
 *   - Invoices, payments, settlements, customer subledger
 *   - Profitability snapshots
 *   - Returns, complaints
 *   - Generic auto-release of reservations
 *   - Silent repair of negative stock or corrupted reservations
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
import type { InventoryLedgerService } from "./inventory-ledger-service";
import type { InventoryBalance } from "./inventory-ledger-service";
import type { StockReservationRepository } from "./stock-reservation-repository";
import type { OperationalAlertRepository } from "./operational-alert-repository";
import type { SalesRepository } from "./sales-repository";
import type { StockReservation } from "@/server/db/schema/inventory-ledger";
import { addKg, compareKg, subtractKg, normalizeKg } from "./decimal-kg";
import {
  SALE_FAILURE_REASONS,
  FAILURE_RESOLUTION_OUTCOMES,
  type SaleFailureReason,
  type ResolveSaleFailureInput,
  type ResolveSaleFailureResult,
  type FailureResolutionOutcome,
  SalesFailureResolutionError,
  SaleNotFoundError,
  SaleNotResolvableError,
  SaleAlreadyResolvedError,
  InvalidResolutionReasonError,
  ReservationNotFoundError,
} from "./sales-failure-resolution-types";

// ---------------------------------------------------------------------------
// Transaction runner + factories (mirrors SalesSubmissionService pattern).
// ---------------------------------------------------------------------------

export type SalesFailureResolutionTransactionRunner = <T>(work: (tx: unknown) => Promise<T>) => Promise<T>;

export interface SalesFailureResolutionTransactionScopedFactories {
  createInventoryLedger: (tx: unknown) => InventoryLedgerService;
  createReservationRepository: (tx: unknown) => StockReservationRepository;
  createSalesRepository: (tx: unknown) => SalesRepository;
  createAlertRepository: (tx: unknown) => OperationalAlertRepository;
  createIdempotency?: (tx: unknown) => IdempotencyTransactionHandle;
  /** WP-08-01C: tx-scoped audit for atomic audit rollback. */
  createAudit?: (tx: unknown) => AuditTransactionHandle;
}

// ---------------------------------------------------------------------------
// Service deps.
// ---------------------------------------------------------------------------

export interface SalesFailureResolutionServiceDeps {
  salesRepository: SalesRepository;
  reservationRepository: StockReservationRepository;
  alertRepository: OperationalAlertRepository;
  inventoryLedger: InventoryLedgerService;
  audit: AuditTransactionHandle;
  idempotency: IdempotencyTransactionHandle;
  transactionRunner?: SalesFailureResolutionTransactionRunner;
  txFactories?: SalesFailureResolutionTransactionScopedFactories;
}

const SALE_ENTITY_TYPE = "sales_order";
const RESERVATION_ENTITY_TYPE = "stock_reservation";

// ---------------------------------------------------------------------------
// SalesFailureResolutionService.
// ---------------------------------------------------------------------------

/**
 * WP-03-04 Sales Failure Resolution Service.
 *
 * Atomically resolves a failed sale by applying the reason → outcome mapping
 * from Contract 04 §9.4 + Contract 06 §8.
 *
 * The resolution transaction:
 *   1. (outside tx) permission + idempotency claim + sale state check
 *   2. (inside tx) apply reason-specific outcome:
 *      - technical_system: NO business-state change (sale stays pending_approval)
 *      - missing_or_corrupted_reservation: mark reservation failed, reconcile
 *        reserved_qty_kg, create critical alert, set sale to approval_failed
 *      - stock_shortfall / quality_block / missing_commercial_data: retain
 *        reservation, set sale to needs_review
 *      - human_rejection_cancellation: release reservation (decrease
 *        reserved_qty_kg), set sale to rejected/cancelled
 *   3. (outside tx) audit + markSucceeded
 *
 * Invariants:
 *   - Reserved_qty_kg never goes negative.
 *   - One resolution per sale (idempotency + conditional status transitions).
 *   - No sale_issue movements, no financial side effects.
 *   - Critical alerts created only for corruption cases.
 *   - Reservation release is explicit, audited, reason-specific.
 */
export class SalesFailureResolutionService {
  constructor(private readonly deps: SalesFailureResolutionServiceDeps) {}

  async resolveSaleFailure(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: ResolveSaleFailureInput,
  ): Promise<ResolveSaleFailureResult> {
    // Step 1-2: permission + reject body authority.
    // Permission: sales.approve for resolution (Owner/Accountant only).
    // This is NOT sales.cancel — resolution is a management action that
    // applies the contracted reason mapping.
    requirePermission(effective, "sales.approve");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!input.saleId || input.saleId.trim() === "") {
      throw new SalesFailureResolutionError("VALIDATION_FAILED", "Sale ID is required.");
    }
    if (!input.idempotencyKey || input.idempotencyKey.trim() === "") {
      throw new SalesFailureResolutionError("VALIDATION_FAILED", "Idempotency key is required.");
    }
    if (!input.resolutionReason || input.resolutionReason.trim() === "") {
      throw new SalesFailureResolutionError("VALIDATION_FAILED", "Resolution reason is required.");
    }
    if (!SALE_FAILURE_REASONS.includes(input.reason)) {
      throw new InvalidResolutionReasonError(input.reason);
    }

    // Step 3: fetch sale (for state check).
    const sale = await this.deps.salesRepository.findSaleById(user.tenantId, input.saleId);
    if (!sale) throw new SaleNotFoundError(input.saleId);
    requireTenantMatch(user, sale.tenantId);

    // Step 4: claim idempotency FIRST.
    const now = new Date();
    const idempotencyInput: IdempotencyClaimInput = {
      tenantId: user.tenantId,
      operationScope: "sales_failure_resolution.resolve",
      idempotencyKey: input.idempotencyKey,
      requestBody: {
        saleId: input.saleId,
        reason: input.reason,
        humanResolutionType: input.humanResolutionType ?? null,
      } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    };

    const claim = await claimIdempotency(this.deps.idempotency, idempotencyInput);

    if (claim.action === "replay") {
      // Prior call with same key succeeded — return the stored result.
      const refreshed = await this.deps.salesRepository.findSaleById(user.tenantId, input.saleId);
      if (refreshed && (refreshed.saleStatus === "approval_failed" || refreshed.saleStatus === "needs_review" || refreshed.saleStatus === "rejected" || refreshed.saleStatus === "cancelled" || refreshed.saleStatus === "pending_approval")) {
        // Return a replay result. We can't reconstruct the full result without
        // storing it, so we return a minimal replay.
        return {
          action: "replayed" as const,
          saleId: refreshed.id,
          saleStatus: refreshed.saleStatus,
          approvalStatus: refreshed.approvalStatus,
          reason: input.reason,
          reservationReleased: false,
          reservationMarkedFailed: false,
          criticalAlertIds: [],
          balanceSnapshots: [],
        };
      }
    }

    if (claim.action === "conflict") {
      throw new SalesFailureResolutionError(
        "IDEMPOTENCY_CONFLICT",
        `Idempotency key '${input.idempotencyKey}' was used with a different request body.`,
      );
    }

    if (claim.action === "in_progress") {
      throw new SalesFailureResolutionError(
        "OPERATION_IN_PROGRESS",
        `Operation '${input.idempotencyKey}' is still in progress.`,
      );
    }

    // claim.action === "execute" — fresh call. Check sale state.
    // Resolvable states: pending_approval (initial failure), approval_failed,
    // needs_review (re-resolution allowed if state permits).
    // NOT resolvable: draft, approved, rejected, cancelled, reversed, partially_returned, fully_returned.
    const resolvableStates = ["pending_approval", "approval_failed", "needs_review"];
    if (!resolvableStates.includes(sale.saleStatus)) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 409,
        responseBody: { message: `Sale in state '${sale.saleStatus}' cannot be resolved.` },
        lastErrorClass: "SaleAlreadyResolvedError",
      }, claim.record.ownerToken!, now);
      throw new SaleAlreadyResolvedError(sale.id, sale.saleStatus);
    }

    // Get the outcome for this reason.
    const outcome = FAILURE_RESOLUTION_OUTCOMES[input.reason];

    // For human_rejection_cancellation, determine if it's "rejected" or "cancelled".
    let finalSaleStatus = outcome.saleStatus;
    let finalApprovalStatus = outcome.approvalStatus;
    if (input.reason === "human_rejection_cancellation") {
      const humanType = input.humanResolutionType ?? "rejected";
      finalSaleStatus = humanType;
      finalApprovalStatus = humanType;
    }

    // =====================================================================
    // ATOMIC RESOLUTION TRANSACTION
    // =====================================================================
    const executeResolution = async (
      txScoped: {
        inventoryLedger: InventoryLedgerService;
        reservationRepository: StockReservationRepository;
        salesRepository: SalesRepository;
        alertRepository: OperationalAlertRepository;
        idempotency?: IdempotencyTransactionHandle;
        audit?: AuditTransactionHandle;
      } | null,
    ): Promise<ResolveSaleFailureResult> => {
      const invLedger = txScoped?.inventoryLedger ?? this.deps.inventoryLedger;
      const reservationRepo = txScoped?.reservationRepository ?? this.deps.reservationRepository;
      const salesRepo = txScoped?.salesRepository ?? this.deps.salesRepository;
      const alertRepo = txScoped?.alertRepository ?? this.deps.alertRepository;
      const idemHandle = txScoped?.idempotency ?? this.deps.idempotency;
      const auditHandle = txScoped?.audit ?? this.deps.audit;

      const criticalAlertIds: string[] = [];
      const balanceSnapshots: ResolveSaleFailureResult["balanceSnapshots"] = [];
      let reservationReleased = false;
      let reservationMarkedFailed = false;

      // Special case: technical_system → NO business-state change.
      if (input.reason === "technical_system") {
        // Per Contract 06 §7.1: leave sale and reservation unchanged.
        // Do NOT write a business audit log (it would imply resolution happened).
        // The idempotency record (markSucceeded/markBusinessFailed) is sufficient
        // for operational tracking of technical failure attempts.
        return {
          action: "resolved" as const,
          saleId: sale.id,
          saleStatus: sale.saleStatus, // unchanged
          approvalStatus: sale.approvalStatus, // unchanged
          reason: input.reason,
          reservationReleased: false,
          reservationMarkedFailed: false,
          criticalAlertIds: [],
          balanceSnapshots: [],
        };
      }

      // Fetch active reservations for this sale.
      const reservations = await reservationRepo.listActiveReservationsForSale(
        user.tenantId, sale.id,
      );

      // Handle each reservation according to the outcome.
      for (const reservation of reservations) {
        if (outcome.releaseReservation) {
          // Human rejection/cancellation: release the reservation.
          // 1. Mark reservation as released (conditional on status='active').
          const released = await reservationRepo.markReservationReleased(
            user.tenantId, reservation.id,
          );
          if (!released) {
            // Another concurrent caller already released/failed this reservation.
            // This is expected for concurrent resolution — the conditional
            // WHERE clause prevents double-release. Skip this reservation.
            continue;
          }
          reservationReleased = true;

          // 2. Decrease reserved_qty_kg by the reservation quantity.
          const balance = await invLedger.findBalanceForUpdate(
            user.tenantId, reservation.itemId, reservation.locationId,
          );
          if (balance) {
            const newReserved = subtractKg(balance.reservedQtyKg, normalizeKg(reservation.quantityKg));
            // reserved_qty_kg must never go negative (Contract 04 §9.5).
            if (compareKg(newReserved, "0.000") < 0) {
              throw new SalesFailureResolutionError(
                "RESERVED_QTY_WOULD_GO_NEGATIVE",
                `Releasing reservation ${reservation.id} would make reserved_qty_kg negative for item ${reservation.itemId} at location ${reservation.locationId}.`,
              );
            }
            const updated = await invLedger.updateReservedQty(
              user.tenantId, reservation.itemId, reservation.locationId,
              { reservedQtyKg: newReserved, version: balance.version + 1 },
            );
            if (updated) {
              balanceSnapshots.push({
                itemId: reservation.itemId,
                locationId: reservation.locationId,
                reservedQtyKg: updated.reservedQtyKg,
                version: updated.version,
              });
            }
          }
        } else if (outcome.markReservationFailed) {
          // Missing/corrupted reservation: mark as failed + reconcile reserved_qty_kg.
          const failed = await reservationRepo.markReservationFailed(
            user.tenantId, reservation.id,
            input.resolutionReason, user.userId,
          );
          if (!failed) {
            // Already failed/released by a concurrent caller — skip.
            continue;
          }
          reservationMarkedFailed = true;

          // Reconcile reserved_qty_kg: decrease by the reservation quantity.
          const balance = await invLedger.findBalanceForUpdate(
            user.tenantId, reservation.itemId, reservation.locationId,
          );
          if (balance) {
            const newReserved = subtractKg(balance.reservedQtyKg, normalizeKg(reservation.quantityKg));
            if (compareKg(newReserved, "0.000") < 0) {
              throw new SalesFailureResolutionError(
                "RESERVED_QTY_WOULD_GO_NEGATIVE",
                `Marking reservation ${reservation.id} as failed would make reserved_qty_kg negative for item ${reservation.itemId} at location ${reservation.locationId}.`,
              );
            }
            const updated = await invLedger.updateReservedQty(
              user.tenantId, reservation.itemId, reservation.locationId,
              { reservedQtyKg: newReserved, version: balance.version + 1 },
            );
            if (updated) {
              balanceSnapshots.push({
                itemId: reservation.itemId,
                locationId: reservation.locationId,
                reservedQtyKg: updated.reservedQtyKg,
                version: updated.version,
              });
            }
          }
        }
        // For stock_shortfall, quality_block, missing_commercial_data:
        // retain reservation (no change to reservation or reserved_qty_kg).
      }

      // Create critical alert for missing/corrupted reservation.
      if (outcome.createCriticalAlert) {
        // Check for existing critical alert to avoid duplicates.
        const existingAlert = await alertRepo.findCriticalAlertForSource(
          user.tenantId, SALE_ENTITY_TYPE, sale.id, "reservation_corruption",
        );
        if (!existingAlert) {
          const alert = await alertRepo.insertAlert({
            tenantId: user.tenantId,
            severity: "critical",
            alertType: "reservation_corruption",
            sourceEntityType: SALE_ENTITY_TYPE,
            sourceEntityId: sale.id,
            messageKey: "reservation.corruption_detected",
            messageDetails: {
              saleId: sale.id,
              reason: input.reason,
              resolutionReason: input.resolutionReason,
            },
            detectedBy: user.userId,
          });
          criticalAlertIds.push(alert.id);
        }
      }

      // Update sale status (unless technical_system, which doesn't change state).
      // Use CONDITIONAL update: only succeed if current sale_status is still
      // in the resolvable states. This is the atomicity gate for concurrent
      // resolution — if another concurrent caller already transitioned the
      // sale, this returns null and we throw SaleAlreadyResolvedError.
      const updatedSale = await salesRepo.updateSaleStatusConditional(
        user.tenantId, sale.id,
        {
          saleStatus: finalSaleStatus,
          approvalStatus: finalApprovalStatus,
          reservationStatus: outcome.releaseReservation ? "released"
            : outcome.markReservationFailed ? "failed"
            : "retained_for_review",
        },
        resolvableStates,
      );
      if (!updatedSale) {
        // Another concurrent caller already resolved this sale.
        // The transaction will roll back any reservation changes we made.
        throw new SaleAlreadyResolvedError(sale.id, "resolved (concurrent)");
      }

      // Audit INSIDE the transaction (Contract 06 §6: "Audit failure rolls
      // back the entire transaction"). This ensures the audit record commits
      // atomically with the business mutations — if audit fails, the sale
      // status change, reservation release, reserved_qty decrease, and alert
      // creation all roll back.
      await appendAuditLog(auditHandle, user.tenantId, user.userId, {
        entityType: SALE_ENTITY_TYPE,
        entityId: sale.id,
        actionType: "sales_failure_resolution.resolve",
        newValuesJson: {
          reason: input.reason,
          saleStatus: updatedSale.saleStatus,
          approvalStatus: updatedSale.approvalStatus,
          reservationReleased,
          reservationMarkedFailed,
          criticalAlertIds,
          balanceSnapshots,
          resolutionReason: input.resolutionReason,
        },
        idempotencyKey: input.idempotencyKey,
      });

      const result: ResolveSaleFailureResult = {
        action: "resolved" as const,
        saleId: sale.id,
        saleStatus: updatedSale.saleStatus,
        approvalStatus: updatedSale.approvalStatus,
        reason: input.reason,
        reservationReleased,
        reservationMarkedFailed,
        criticalAlertIds,
        balanceSnapshots,
      };
      await markSucceeded(idemHandle, claim.record.id, {
        responseCode: 200,
        responseBody: { saleId: sale.id, reason: input.reason, saleStatus: result.saleStatus },
      }, claim.record.ownerToken!, now);
      return result;
    };

    let result: ResolveSaleFailureResult;
    try {
      if (this.deps.transactionRunner && this.deps.txFactories) {
        result = await this.deps.transactionRunner(async (tx: unknown) => {
          const txInvLedger = this.deps.txFactories!.createInventoryLedger(tx);
          const txResRepo = this.deps.txFactories!.createReservationRepository(tx);
          const txSalesRepo = this.deps.txFactories!.createSalesRepository(tx);
          const txAlertRepo = this.deps.txFactories!.createAlertRepository(tx);
          const txIdem = this.deps.txFactories!.createIdempotency?.(tx);
          const txAudit = this.deps.txFactories!.createAudit?.(tx);
          return executeResolution({
            inventoryLedger: txInvLedger,
            reservationRepository: txResRepo,
            salesRepository: txSalesRepo,
            alertRepository: txAlertRepo,
            idempotency: txIdem,
            audit: txAudit,
          });
        });
      } else {
        result = await executeResolution(null);
      }
    } catch (txError) {
      try {
        await markBusinessFailed(this.deps.idempotency, claim.record.id, {
          responseCode: 500,
          responseBody: { message: "Sales failure resolution transaction failed and rolled back." },
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
