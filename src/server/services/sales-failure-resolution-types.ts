/**
 * Sales Failure Resolution — WP-03-04.
 *
 * Contract: docs/contracts/04_inventory_posting_contract.md §9.4
 *   "Approval-Failure Resolution"
 *
 * Contract: docs/contracts/06_approval_transaction_contract.md §7, §8
 *   "Idempotency and Failure Recording" + "Sales Approval Contract"
 *
 * Failure reason taxonomy (from Contract 04 §9.4 + Contract 06 §8):
 *
 *   technical_system:
 *     Database timeout, deadlock, network failure, server crash, or
 *     unexpected exception. Roll back the whole transaction. Create no
 *     stock movement, reservation change, or business state change.
 *     Leave sale/reservation retryable. (Contract 06 §7.1)
 *
 *   missing_or_corrupted_reservation:
 *     Reservation row is missing or its quantity doesn't match the sale line.
 *     Mark the reservation `failed`, reconcile `reserved_qty_kg`, create a
 *     critical alert, and set sale to `approval_failed` or `needs_review`.
 *     (Contract 04 §9.4, Contract 06 §8)
 *
 *   stock_shortfall:
 *     Insufficient on-hand stock to fulfill the sale. Retain reservation
 *     for review; do NOT release automatically. Set sale to `needs_review`.
 *     (Contract 04 §9.4, Contract 06 §8)
 *
 *   quality_block:
 *     Item is blocked or quality status is not accepted. Retain reservation
 *     for review; do NOT release automatically. Set sale to `needs_review`.
 *     (Contract 04 §9.4, Contract 06 §8)
 *
 *   missing_commercial_data:
 *     Missing price/commercial data discovered after submission. Retain
 *     reservation for review; do NOT release automatically. Set sale to
 *     `needs_review`. (Contract 04 §9.4, Contract 06 §8)
 *
 *   human_rejection_cancellation:
 *     Human reject/cancel. Explicitly release the active reservation once
 *     and audit. Set sale to `rejected` or `cancelled`. (Contract 04 §9.4,
 *     Contract 06 §8, §17)
 *
 * WP-03-04 scope: failure resolution transaction only.
 *   - Does NOT implement sale approval/posting (that's a later WP).
 *   - Does NOT issue stock, create invoices/payments/settlements, or
 *     customer subledger entries.
 *   - Does NOT create profitability snapshots.
 *   - Does NOT silently repair negative stock or corrupted reservations.
 *   - Does NOT implement a generic auto-release.
 */
import "server-only";

// ---------------------------------------------------------------------------
// Failure reason taxonomy.
// ---------------------------------------------------------------------------

export const SALE_FAILURE_REASONS = [
  "technical_system",
  "missing_or_corrupted_reservation",
  "stock_shortfall",
  "quality_block",
  "missing_commercial_data",
  "human_rejection_cancellation",
] as const;

export type SaleFailureReason = (typeof SALE_FAILURE_REASONS)[number];

// ---------------------------------------------------------------------------
// Resolution outcome types.
// ---------------------------------------------------------------------------

/**
 * The outcome of applying a failure resolution for a specific reason.
 *
 * This is a pure mapping from failure reason → business state change.
 * The service uses this to decide what to do:
 *   - Should the reservation be released?
 *   - Should reserved_qty_kg be reconciled?
 *   - Should a critical alert be created?
 *   - What sale status should be set?
 */
export interface FailureResolutionOutcome {
  /** The failure reason being resolved. */
  reason: SaleFailureReason;
  /**
   * Whether to release the active reservation (decrease reserved_qty_kg).
   * Only `human_rejection_cancellation` releases in MVP.
   * `missing_or_corrupted_reservation` marks the reservation `failed` and
   * reconciles reserved_qty_kg (a different operation — see `markReservationFailed`).
   * All other reasons retain the reservation.
   */
  releaseReservation: boolean;
  /**
   * Whether to mark the reservation as `failed` (status transition active → failed)
   * and reconcile reserved_qty_kg. Only `missing_or_corrupted_reservation` does this.
   */
  markReservationFailed: boolean;
  /**
   * Whether to create a critical alert. `missing_or_corrupted_reservation`
   * creates a critical alert. `technical_system` creates no alert (it's a
   * transient retryable failure, not a corruption).
   */
  createCriticalAlert: boolean;
  /**
   * The sale status to set. Contract 06 §8:
   *   - technical_system: no business-state change (sale stays pending_approval)
   *   - missing_or_corrupted_reservation: approval_failed
   *   - stock_shortfall: needs_review
   *   - quality_block: needs_review
   *   - missing_commercial_data: needs_review
   *   - human_rejection_cancellation: rejected or cancelled (caller specifies)
   */
  saleStatus: "pending_approval" | "approval_failed" | "needs_review" | "rejected" | "cancelled";
  /**
   * The approval status to set.
   */
  approvalStatus: "pending_approval" | "approval_failed" | "needs_review" | "rejected" | "cancelled";
}

/**
 * The canonical reason → outcome mapping (Contract 04 §9.4 + Contract 06 §8).
 *
 * This is the single source of truth for how each failure reason affects
 * business state. The service MUST NOT deviate from this mapping.
 */
export const FAILURE_RESOLUTION_OUTCOMES: Record<SaleFailureReason, FailureResolutionOutcome> = {
  technical_system: {
    reason: "technical_system",
    releaseReservation: false,
    markReservationFailed: false,
    createCriticalAlert: false,
    saleStatus: "pending_approval", // NO business-state change
    approvalStatus: "pending_approval",
  },
  missing_or_corrupted_reservation: {
    reason: "missing_or_corrupted_reservation",
    releaseReservation: false, // markReservationFailed handles the reserved_qty reconciliation
    markReservationFailed: true,
    createCriticalAlert: true,
    saleStatus: "approval_failed",
    approvalStatus: "approval_failed",
  },
  stock_shortfall: {
    reason: "stock_shortfall",
    releaseReservation: false, // retain for review
    markReservationFailed: false,
    createCriticalAlert: false,
    saleStatus: "needs_review",
    approvalStatus: "needs_review",
  },
  quality_block: {
    reason: "quality_block",
    releaseReservation: false, // retain for review
    markReservationFailed: false,
    createCriticalAlert: false,
    saleStatus: "needs_review",
    approvalStatus: "needs_review",
  },
  missing_commercial_data: {
    reason: "missing_commercial_data",
    releaseReservation: false, // retain for review
    markReservationFailed: false,
    createCriticalAlert: false,
    saleStatus: "needs_review",
    approvalStatus: "needs_review",
  },
  human_rejection_cancellation: {
    reason: "human_rejection_cancellation",
    releaseReservation: true, // explicit release
    markReservationFailed: false,
    createCriticalAlert: false,
    saleStatus: "rejected", // or "cancelled" — caller specifies via input
    approvalStatus: "rejected",
  },
};

// ---------------------------------------------------------------------------
// Input/result types for the resolution service.
// ---------------------------------------------------------------------------

export interface ResolveSaleFailureInput {
  saleId: string;
  reason: SaleFailureReason;
  /** For human_rejection_cancellation: "rejected" or "cancelled". Defaults to "rejected". */
  humanResolutionType?: "rejected" | "cancelled";
  /** Required reason/notes for the resolution. */
  resolutionReason: string;
  idempotencyKey: string;
}

export interface ResolveSaleFailureResult {
  action: "resolved" | "replayed";
  saleId: string;
  saleStatus: string;
  approvalStatus: string;
  reason: SaleFailureReason;
  /** Whether the reservation was released (reserved_qty_kg decreased). */
  reservationReleased: boolean;
  /** Whether the reservation was marked failed (corruption case). */
  reservationMarkedFailed: boolean;
  /** IDs of critical alerts created (empty if none). */
  criticalAlertIds: string[];
  /** Balance snapshots after resolution (for audit/verification). */
  balanceSnapshots: Array<{
    itemId: string;
    locationId: string;
    reservedQtyKg: string;
    version: number;
  }>;
}

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

export class SalesFailureResolutionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SalesFailureResolutionError";
    this.code = code;
  }
}

export class SaleNotFoundError extends SalesFailureResolutionError {
  constructor(id: string) {
    super("SALE_NOT_FOUND", `Sale '${id}' not found.`);
    this.name = "SaleNotFoundError";
  }
}

export class SaleNotResolvableError extends SalesFailureResolutionError {
  constructor(id: string, currentState: string) {
    super(
      "SALE_NOT_RESOLVABLE",
      `Sale '${id}' is in state '${currentState}' — only 'pending_approval' or 'approval_failed' or 'needs_review' sales can be resolved.`,
    );
    this.name = "SaleNotResolvableError";
  }
}

export class SaleAlreadyResolvedError extends SalesFailureResolutionError {
  constructor(id: string, currentState: string) {
    super(
      "SALE_ALREADY_RESOLVED",
      `Sale '${id}' is already in state '${currentState}' and cannot be resolved again with a different idempotency key.`,
    );
    this.name = "SaleAlreadyResolvedError";
  }
}

export class InvalidResolutionReasonError extends SalesFailureResolutionError {
  constructor(reason: string) {
    super(
      "INVALID_RESOLUTION_REASON",
      `Invalid failure reason '${reason}'. Must be one of: ${SALE_FAILURE_REASONS.join(", ")}.`,
    );
    this.name = "InvalidResolutionReasonError";
  }
}

export class ReservationNotFoundError extends SalesFailureResolutionError {
  constructor(saleId: string) {
    super(
      "RESERVATION_NOT_FOUND",
      `No active reservation found for sale '${saleId}'.`,
    );
    this.name = "ReservationNotFoundError";
  }
}
