/**
 * Inventory transfer and reservation policy (DEC-064, DEC-065).
 *
 * Contract: docs/02_decision_log_and_scope.md
 *   DEC-064: Ordinary MVP transfers support only accepted/sellable
 *   unblocked stock. Blocked, needs-review, partially blocked, returned,
 *   discounted-return or otherwise risky classification stock cannot
 *   move through ordinary transfer. It must first receive approved
 *   disposition/correction that makes the transferable quantity
 *   explicitly sellable/unblocked or routes it through a later special
 *   workflow.
 *
 *   DEC-065: MVP sale reservation supports only accepted/sellable stock.
 *   Needs-review, blocked, discounted-return or other quality-risk stock
 *   must go through review/disposition before sale
 *   submission/reservation. No protected risk reservation flow is
 *   implemented in MVP.
 *
 * Contract: docs/contracts/04_inventory_posting_contract.md
 *   §8.2 Transfer: "Ordinary MVP transfer supports only accepted/sellable
 *   unblocked available stock under DEC-064."
 *   §9.1 Reservation Creation: "Reservation/submission is allowed only
 *   for accepted/sellable stock under DEC-065."
 *
 * This module is pure (no I/O, no DB). It is the single source of truth
 * for:
 *   1. Whether an inventory item + balance state is eligible for ordinary
 *      transfer (DEC-064).
 *   2. Whether an inventory item + balance state is eligible for sale
 *      reservation (DEC-065).
 *   3. The set of quality statuses and returned-stock classifications
 *      that are "sellable" for MVP purposes.
 *
 * Future services (InventoryLedgerService, ReservationService) will call
 * these functions before posting a transfer or creating a reservation.
 */

// ---------------------------------------------------------------------------
// Type definitions (mirror the Drizzle schema column types).
// ---------------------------------------------------------------------------

/**
 * Quality status values per Contract 03 §6 / DEC-006.
 * MVP: `accepted`, `needs_review`, `blocked`. No `rejected` (SUP-006).
 */
export type QualityStatus = "accepted" | "needs_review" | "blocked";

/**
 * Returned stock status values per Contract 03 §6 / Contract 04 §11.
 *
 * Only `sellable_as_is` is normally available for sale.
 * `sellable_with_discount` requires Owner/Accountant approval.
 * Other states are unavailable.
 */
export type ReturnedStockStatus =
  | "return_received"
  | "needs_quality_review"
  | "sellable_as_is"
  | "sellable_with_discount"
  | "blocked"
  | "reprocess_required";

/**
 * Summary of an inventory item's stock state at a location, used for
 * transfer/reservation eligibility checks.
 */
export interface StockStateSnapshot {
  /** Quality status from inventory_items.quality_status. */
  qualityStatus: QualityStatus;
  /** Block flag from inventory_items.is_blocked. */
  isBlocked: boolean;
  /** Returned stock classification, if the stock has a return dimension. */
  returnedStockStatus?: ReturnedStockStatus;
  /** On-hand quantity (NUMERIC(18,3) as string for decimal precision). */
  onHandQtyKg: string;
  /** Reserved quantity. */
  reservedQtyKg: string;
  /** Blocked quantity (dimension on inventory_balances). */
  blockedQtyKg: string;
  /** Returned quantity (dimension on inventory_balances). */
  returnedQtyKg: string;
}

// ---------------------------------------------------------------------------
// Sellability definitions.
// ---------------------------------------------------------------------------

/**
 * Quality statuses that are "accepted" for ordinary sale/transfer.
 *
 * Per DEC-065: only `accepted` quality status is eligible for sale
 * reservation without prior review/disposition.
 */
export const ACCEPTED_QUALITY_STATUSES: ReadonlySet<QualityStatus> = new Set([
  "accepted",
]);

/**
 * Returned-stock classifications that are "sellable" for ordinary
 * sale/transfer.
 *
 * Per Contract 04 §11: only `sellable_as_is` is normally available for
 * sale. `sellable_with_discount` requires Owner/Accountant approval.
 * Other states are unavailable.
 *
 * Per DEC-064/065: ordinary transfer/reservation supports only
 * accepted/sellable unblocked stock. `sellable_with_discount` is NOT
 * included in ordinary sellability — it requires a separate approved
 * quality-risk sale flow.
 */
export const SELLABLE_RETURNED_STATUSES: ReadonlySet<ReturnedStockStatus> =
  new Set(["sellable_as_is"]);

// ---------------------------------------------------------------------------
// DEC-064: Transfer eligibility.
// ---------------------------------------------------------------------------

export interface TransferEligibilityResult {
  /** True if the stock is eligible for ordinary transfer. */
  eligible: boolean;
  /** Reason for ineligibility (empty when eligible). */
  reason: string;
  /** The DEC decision that governs this check. */
  decision: "DEC-064";
}

/**
 * Check whether a stock state is eligible for ordinary transfer under
 * DEC-064.
 *
 * Ordinary MVP transfer supports ONLY accepted/sellable unblocked
 * available stock. A quantity that is partially/wholly blocked,
 * needs review, returned, discounted-return or otherwise risky is NOT
 * transferable through ordinary transfer.
 *
 * Returns `{ eligible: false, reason: ... }` when ANY of these
 * conditions are true:
 *   - quality_status is not `accepted`
 *   - is_blocked is true
 *   - returned_stock_status is present and not `sellable_as_is`
 *   - blocked_qty_kg > 0 (the blocked dimension is non-zero)
 *   - returned_qty_kg > 0 (the returned dimension is non-zero)
 *
 * Pure function. No I/O.
 */
export function checkTransferEligibility(
  state: StockStateSnapshot,
): TransferEligibilityResult {
  // 1. Quality status must be "accepted".
  if (!ACCEPTED_QUALITY_STATUSES.has(state.qualityStatus)) {
    return {
      eligible: false,
      reason: `Quality status '${state.qualityStatus}' is not accepted for ordinary transfer (DEC-064). Stock must be 'accepted' or receive approved disposition/correction first.`,
      decision: "DEC-064",
    };
  }

  // 2. Item must not be blocked.
  if (state.isBlocked) {
    return {
      eligible: false,
      reason: "Item is blocked (is_blocked=true) and cannot be transferred through ordinary transfer (DEC-064).",
      decision: "DEC-064",
    };
  }

  // 3. Returned stock classification must be sellable_as_is (if present).
  if (
    state.returnedStockStatus &&
    !SELLABLE_RETURNED_STATUSES.has(state.returnedStockStatus)
  ) {
    return {
      eligible: false,
      reason: `Returned stock classification '${state.returnedStockStatus}' is not sellable_as_is and cannot be transferred through ordinary transfer (DEC-064).`,
      decision: "DEC-064",
    };
  }

  // 4. Blocked dimension on balance must be zero.
  if (parseFloat(state.blockedQtyKg) > 0) {
    return {
      eligible: false,
      reason: `Blocked quantity (${state.blockedQtyKg} kg) is non-zero; blocked stock cannot be transferred through ordinary transfer (DEC-064).`,
      decision: "DEC-064",
    };
  }

  // 5. Returned dimension on balance must be zero (returned stock is not
  //    transferable through ordinary transfer unless classification is
  //    sellable_as_is, which is checked above).
  if (parseFloat(state.returnedQtyKg) > 0 && !state.returnedStockStatus) {
    return {
      eligible: false,
      reason: `Returned quantity (${state.returnedQtyKg} kg) is non-zero without a sellable classification; returned stock cannot be transferred through ordinary transfer (DEC-064).`,
      decision: "DEC-064",
    };
  }

  return { eligible: true, reason: "", decision: "DEC-064" };
}

// ---------------------------------------------------------------------------
// DEC-065: Reservation eligibility.
// ---------------------------------------------------------------------------

export interface ReservationEligibilityResult {
  /** True if the stock is eligible for sale reservation. */
  eligible: boolean;
  /** Reason for ineligibility (empty when eligible). */
  reason: string;
  /** The DEC decision that governs this check. */
  decision: "DEC-065";
}

/**
 * Check whether a stock state is eligible for sale reservation under
 * DEC-065.
 *
 * MVP sale reservation supports ONLY accepted/sellable stock.
 * Needs-review, blocked, discounted-return or other quality-risk stock
 * must go through review/disposition before reservation. No protected
 * risk reservation flow is implemented in MVP.
 *
 * Returns `{ eligible: false, reason: ... }` when ANY of these
 * conditions are true:
 *   - quality_status is not `accepted`
 *   - is_blocked is true
 *   - returned_stock_status is present and not `sellable_as_is`
 *   - blocked_qty_kg > 0
 *   - returned_qty_kg > 0 (unless classification is sellable_as_is)
 *
 * Pure function. No I/O.
 */
export function checkReservationEligibility(
  state: StockStateSnapshot,
): ReservationEligibilityResult {
  // 1. Quality status must be "accepted".
  if (!ACCEPTED_QUALITY_STATUSES.has(state.qualityStatus)) {
    return {
      eligible: false,
      reason: `Quality status '${state.qualityStatus}' is not accepted for sale reservation (DEC-065). Stock must go through review/disposition before reservation.`,
      decision: "DEC-065",
    };
  }

  // 2. Item must not be blocked.
  if (state.isBlocked) {
    return {
      eligible: false,
      reason: "Item is blocked (is_blocked=true) and cannot be reserved for sale (DEC-065).",
      decision: "DEC-065",
    };
  }

  // 3. Returned stock classification must be sellable_as_is (if present).
  if (
    state.returnedStockStatus &&
    !SELLABLE_RETURNED_STATUSES.has(state.returnedStockStatus)
  ) {
    return {
      eligible: false,
      reason: `Returned stock classification '${state.returnedStockStatus}' is not sellable_as_is and cannot be reserved for sale (DEC-065).`,
      decision: "DEC-065",
    };
  }

  // 4. Blocked dimension on balance must be zero.
  if (parseFloat(state.blockedQtyKg) > 0) {
    return {
      eligible: false,
      reason: `Blocked quantity (${state.blockedQtyKg} kg) is non-zero; blocked stock cannot be reserved for sale (DEC-065).`,
      decision: "DEC-065",
    };
  }

  // 5. Returned dimension on balance must be zero (unless sellable_as_is).
  if (parseFloat(state.returnedQtyKg) > 0 && !state.returnedStockStatus) {
    return {
      eligible: false,
      reason: `Returned quantity (${state.returnedQtyKg} kg) is non-zero without a sellable classification; returned stock cannot be reserved for sale (DEC-065).`,
      decision: "DEC-065",
    };
  }

  return { eligible: true, reason: "", decision: "DEC-065" };
}

/**
 * Compute available quantity from a stock state snapshot.
 *
 * available = on_hand - reserved - blocked
 * (returned is NOT subtracted — it is not extra physical stock, per
 * Contract 04 §6).
 */
export function computeAvailableQtyKg(state: StockStateSnapshot): string {
  const onHand = parseFloat(state.onHandQtyKg);
  const reserved = parseFloat(state.reservedQtyKg);
  const blocked = parseFloat(state.blockedQtyKg);
  const available = onHand - reserved - blocked;
  // Use toFixed(3) to match NUMERIC(18,3) scale; parse back to string.
  return available.toFixed(3);
}
