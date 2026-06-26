/**
 * WP-00-03B package gate tests — DEC-064/065 inventory transfer/reservation policy.
 *
 * Contract: docs/02_decision_log_and_scope.md DEC-064, DEC-065
 * Contract: docs/contracts/04_inventory_posting_contract.md §8.2, §9.1
 *
 * These tests verify the pure policy module in
 * `src/server/security/inventory-policy.ts`. No DB, no I/O.
 */

import { describe, it, expect } from "vitest";
import {
  checkTransferEligibility,
  checkReservationEligibility,
  computeAvailableQtyKg,
  ACCEPTED_QUALITY_STATUSES,
  SELLABLE_RETURNED_STATUSES,
  type StockStateSnapshot,
} from "../inventory-policy";

// Helper: build a default accepted/sellable stock state.
function makeAcceptedStockState(overrides: Partial<StockStateSnapshot> = {}): StockStateSnapshot {
  return {
    qualityStatus: "accepted",
    isBlocked: false,
    onHandQtyKg: "1000.000",
    reservedQtyKg: "0",
    blockedQtyKg: "0",
    returnedQtyKg: "0",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// DEC-064: Transfer eligibility
// ---------------------------------------------------------------------------

describe("DEC-064: checkTransferEligibility", () => {
  it("returns eligible=true for accepted/sellable unblocked stock", () => {
    const state = makeAcceptedStockState();
    const result = checkTransferEligibility(state);
    expect(result.eligible).toBe(true);
    expect(result.reason).toBe("");
    expect(result.decision).toBe("DEC-064");
  });

  it("returns eligible=false for needs_review quality status", () => {
    const state = makeAcceptedStockState({ qualityStatus: "needs_review" });
    const result = checkTransferEligibility(state);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/needs_review/);
    expect(result.reason).toMatch(/DEC-064/);
  });

  it("returns eligible=false for blocked quality status", () => {
    const state = makeAcceptedStockState({ qualityStatus: "blocked" });
    const result = checkTransferEligibility(state);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/blocked/);
  });

  it("returns eligible=false when is_blocked=true", () => {
    const state = makeAcceptedStockState({ isBlocked: true });
    const result = checkTransferEligibility(state);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/is_blocked/);
  });

  it("returns eligible=false for returned stock with non-sellable classification", () => {
    const state = makeAcceptedStockState({
      returnedStockStatus: "needs_quality_review",
      returnedQtyKg: "50.000",
    });
    const result = checkTransferEligibility(state);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/needs_quality_review/);
  });

  it("returns eligible=false for returned stock with sellable_with_discount classification", () => {
    const state = makeAcceptedStockState({
      returnedStockStatus: "sellable_with_discount",
      returnedQtyKg: "50.000",
    });
    const result = checkTransferEligibility(state);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/sellable_with_discount/);
  });

  it("returns eligible=true for returned stock with sellable_as_is classification", () => {
    const state = makeAcceptedStockState({
      returnedStockStatus: "sellable_as_is",
      returnedQtyKg: "50.000",
    });
    const result = checkTransferEligibility(state);
    expect(result.eligible).toBe(true);
  });

  it("returns eligible=false when blocked_qty_kg > 0", () => {
    const state = makeAcceptedStockState({ blockedQtyKg: "100.000" });
    const result = checkTransferEligibility(state);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/Blocked quantity/);
  });
});

// ---------------------------------------------------------------------------
// DEC-065: Reservation eligibility
// ---------------------------------------------------------------------------

describe("DEC-065: checkReservationEligibility", () => {
  it("returns eligible=true for accepted/sellable unblocked stock", () => {
    const state = makeAcceptedStockState();
    const result = checkReservationEligibility(state);
    expect(result.eligible).toBe(true);
    expect(result.reason).toBe("");
    expect(result.decision).toBe("DEC-065");
  });

  it("returns eligible=false for needs_review quality status", () => {
    const state = makeAcceptedStockState({ qualityStatus: "needs_review" });
    const result = checkReservationEligibility(state);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/needs_review/);
    expect(result.reason).toMatch(/DEC-065/);
  });

  it("returns eligible=false for blocked quality status", () => {
    const state = makeAcceptedStockState({ qualityStatus: "blocked" });
    const result = checkReservationEligibility(state);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/blocked/);
  });

  it("returns eligible=false when is_blocked=true", () => {
    const state = makeAcceptedStockState({ isBlocked: true });
    const result = checkReservationEligibility(state);
    expect(result.eligible).toBe(false);
  });

  it("returns eligible=false for returned stock with non-sellable classification", () => {
    const state = makeAcceptedStockState({
      returnedStockStatus: "blocked",
      returnedQtyKg: "50.000",
    });
    const result = checkReservationEligibility(state);
    expect(result.eligible).toBe(false);
  });

  it("returns eligible=true for returned stock with sellable_as_is classification", () => {
    const state = makeAcceptedStockState({
      returnedStockStatus: "sellable_as_is",
      returnedQtyKg: "50.000",
    });
    const result = checkReservationEligibility(state);
    expect(result.eligible).toBe(true);
  });

  it("returns eligible=false when blocked_qty_kg > 0", () => {
    const state = makeAcceptedStockState({ blockedQtyKg: "100.000" });
    const result = checkReservationEligibility(state);
    expect(result.eligible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Sellability definitions
// ---------------------------------------------------------------------------

describe("ACCEPTED_QUALITY_STATUSES", () => {
  it("contains only 'accepted'", () => {
    expect([...ACCEPTED_QUALITY_STATUSES]).toEqual(["accepted"]);
  });

  it("does NOT contain 'needs_review' or 'blocked'", () => {
    expect(ACCEPTED_QUALITY_STATUSES.has("needs_review")).toBe(false);
    expect(ACCEPTED_QUALITY_STATUSES.has("blocked")).toBe(false);
  });
});

describe("SELLABLE_RETURNED_STATUSES", () => {
  it("contains only 'sellable_as_is'", () => {
    expect([...SELLABLE_RETURNED_STATUSES]).toEqual(["sellable_as_is"]);
  });

  it("does NOT contain 'sellable_with_discount' (requires approval)", () => {
    expect(SELLABLE_RETURNED_STATUSES.has("sellable_with_discount")).toBe(false);
  });

  it("does NOT contain 'return_received', 'needs_quality_review', 'blocked', 'reprocess_required'", () => {
    expect(SELLABLE_RETURNED_STATUSES.has("return_received")).toBe(false);
    expect(SELLABLE_RETURNED_STATUSES.has("needs_quality_review")).toBe(false);
    expect(SELLABLE_RETURNED_STATUSES.has("blocked")).toBe(false);
    expect(SELLABLE_RETURNED_STATUSES.has("reprocess_required")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Available quantity computation
// ---------------------------------------------------------------------------

describe("computeAvailableQtyKg", () => {
  it("returns on_hand - reserved - blocked", () => {
    const state = makeAcceptedStockState({
      onHandQtyKg: "1000.000",
      reservedQtyKg: "300.000",
      blockedQtyKg: "100.000",
    });
    expect(computeAvailableQtyKg(state)).toBe("600.000");
  });

  it("does NOT subtract returned from available (returned is not extra physical stock)", () => {
    const state = makeAcceptedStockState({
      onHandQtyKg: "1000.000",
      reservedQtyKg: "0",
      blockedQtyKg: "0",
      returnedQtyKg: "200.000",
    });
    // available = 1000 - 0 - 0 = 1000 (returned is NOT subtracted)
    expect(computeAvailableQtyKg(state)).toBe("1000.000");
  });

  it("handles zero stock", () => {
    const state = makeAcceptedStockState({
      onHandQtyKg: "0.000",
    });
    expect(computeAvailableQtyKg(state)).toBe("0.000");
  });

  it("produces 3 decimal places (NUMERIC(18,3) scale)", () => {
    const state = makeAcceptedStockState({
      onHandQtyKg: "100.500",
      reservedQtyKg: "10.250",
      blockedQtyKg: "5.000",
    });
    expect(computeAvailableQtyKg(state)).toBe("85.250");
  });
});
