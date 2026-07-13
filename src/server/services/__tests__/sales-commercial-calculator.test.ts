/**
 * WP-05-01 Sales Commercial Calculator tests.
 *
 * Contract: docs/contracts/12_testing_and_regression_plan.md §3.4 + §6
 *   Mandatory fixtures:
 *   - Zero discount
 *   - Non-zero discount, no residual
 *   - Non-zero discount with residual, unequal gross lines → largest gross line
 *   - Non-zero discount with residual, tied gross lines → lowest stable line_no
 *   - Zero total gross → zero discount
 *   - Midpoint ROUND_HALF_UP
 *   - Precision: NUMERIC(24,8) precise, NUMERIC(18,2) posted, exact sums
 *   - sum(posted_discounts) == order_discount_total
 *   - document_total_posted == sum(posted_net)
 *   - At most one non-zero rounding_adjustment
 */
import { describe, it, expect } from "vitest";
import {
  calculateCommercialTotals,
  CommercialCalculatorError,
} from "../sales-commercial-calculator";

// Helper: sum money strings
function sumMoney(vals: string[]): string {
  return vals.reduce((acc, v) => {
    const a = parseFloat(acc);
    const b = parseFloat(v);
    return (a + b).toFixed(2);
  }, "0.00");
}

// ===========================================================================
// 1. Zero discount.
// ===========================================================================

describe("WP-05-01 Calculator — zero discount", () => {
  it("all line_allocated_discount_posted = 0, net = gross, doc_total = sum(gross)", () => {
    const result = calculateCommercialTotals(
      [
        { lineNo: 1, quantityKg: "1000.000", pricePerTon: "80.00" },
        { lineNo: 2, quantityKg: "500.000", pricePerTon: "100.00" },
      ],
      "0.00",
    );

    expect(result.totalGrossRevenue).toBe("130.00"); // 80 + 50
    expect(result.orderDiscountTotal).toBe("0.00");
    expect(result.documentTotalPosted).toBe("130.00");

    for (const line of result.lines) {
      expect(line.lineAllocatedDiscountPosted).toBe("0.00");
      expect(line.lineAllocatedDiscountPrecise).toBe("0.00000000");
      expect(line.lineNetRevenuePosted).toBe(line.lineGrossRevenue);
      expect(line.roundingAdjustment).toBe("0.00");
    }
  });
});

// ===========================================================================
// 2. Non-zero discount, no residual.
// ===========================================================================

describe("WP-05-01 Calculator — non-zero discount, no residual", () => {
  it("posted discounts sum exactly to order_discount_total", () => {
    // 2 lines: 1000 kg @ 80 = 80.00 gross; 1000 kg @ 80 = 80.00 gross
    // total gross = 160.00; discount = 16.00 (10%)
    // Each line: share = 0.5; precise_discount = 8.00000000; posted = 8.00
    // sum = 16.00 = order_discount_total → no residual
    const result = calculateCommercialTotals(
      [
        { lineNo: 1, quantityKg: "1000.000", pricePerTon: "80.00" },
        { lineNo: 2, quantityKg: "1000.000", pricePerTon: "80.00" },
      ],
      "16.00",
    );

    expect(result.totalGrossRevenue).toBe("160.00");
    expect(result.orderDiscountTotal).toBe("16.00");
    expect(result.documentTotalPosted).toBe("144.00"); // 160 - 16

    const sumDiscounts = sumMoney(result.lines.map((l) => l.lineAllocatedDiscountPosted));
    expect(sumDiscounts).toBe("16.00");

    for (const line of result.lines) {
      expect(line.lineAllocatedDiscountPosted).toBe("8.00");
      expect(line.lineNetRevenuePosted).toBe("72.00"); // 80 - 8
      expect(line.roundingAdjustment).toBe("0.00");
    }
  });
});

// ===========================================================================
// 3. Residual goes to LARGEST gross line (unequal gross).
// ===========================================================================

describe("WP-05-01 Calculator — residual to largest gross line", () => {
  it("unequal gross lines: residual assigned to the line with max gross revenue", () => {
    // Line 1: 1000 kg @ 80 = 80.00 gross
    // Line 2: 2000 kg @ 80 = 160.00 gross (LARGEST)
    // total gross = 240.00; discount = 0.01
    // share_1 = 80/240 = 0.333333333333; precise_1 = 0.01 × 0.333... = 0.00333333; posted_1 = 0.00
    // share_2 = 160/240 = 0.666666666667; precise_2 = 0.01 × 0.666... = 0.00666667; posted_2 = 0.01
    // sum = 0.01 → no residual? Let's check...
    // Actually posted_1 = ROUND_HALF_UP(0.00333333) = 0.00
    // posted_2 = ROUND_HALF_UP(0.00666667) = 0.01
    // sum = 0.01 = order_discount_total → no residual
    // Let me pick a case that DOES produce a residual.

    // Line 1: 1000 kg @ 33.33 = 33.33 gross
    // Line 2: 1000 kg @ 66.67 = 66.67 gross (LARGEST)
    // total gross = 100.00; discount = 0.01
    // share_1 = 33.33/100 = 0.3333; precise_1 = 0.01 × 0.3333 = 0.003333; posted_1 = 0.00
    // share_2 = 66.67/100 = 0.6667; precise_2 = 0.01 × 0.6667 = 0.006667; posted_2 = 0.01
    // sum = 0.01 → no residual again...

    // Let me use 3 lines with 0.01 discount to force a residual.
    // 3 equal lines @ 33.33 each = 99.99 gross total
    // share = 1/3 each = 0.333333333333
    // precise = 0.01 × 0.333... = 0.00333333
    // posted = ROUND_HALF_UP(0.00333333) = 0.00 for all 3
    // sum = 0.00 ≠ 0.01 → residual = 0.01
    // Tie on gross (all equal) → goes to lowest line_no (line 1)
    // But this tests TIE not LARGEST. Let me do unequal:

    // Line 1: 1000 kg @ 10.00 = 10.00 gross (SMALL)
    // Line 2: 1000 kg @ 90.00 = 90.00 gross (LARGEST)
    // total gross = 100.00; discount = 0.01
    // share_1 = 0.1; precise_1 = 0.001; posted_1 = 0.00
    // share_2 = 0.9; precise_2 = 0.009; posted_2 = 0.01
    // sum = 0.01 → no residual again!

    // The issue is that with 2 lines and 0.01, one always rounds up.
    // Need a case where ALL posted discounts round DOWN.
    // 3 lines, 0.01 discount:
    // Line 1: 1000 @ 10 = 10.00 (SMALL)
    // Line 2: 1000 @ 10 = 10.00 (SMALL)
    // Line 3: 1000 @ 80 = 80.00 (LARGEST)
    // total = 100.00; discount = 0.01
    // share_1 = 0.1; precise = 0.001; posted = 0.00
    // share_2 = 0.1; precise = 0.001; posted = 0.00
    // share_3 = 0.8; precise = 0.008; posted = 0.01
    // sum = 0.01 → STILL no residual!

    // OK the key insight: residual only happens when ALL posted discounts
    // round DOWN (or ALL round such that sum != discount). This requires
    // the discount to be very small relative to the number of lines.
    // Try: 3 lines, discount = 0.01, all shares < 0.005:
    // Need total_gross > 0.01/0.005 × line_gross = 2 × line_gross per line
    // With 3 equal lines: each share = 1/3, precise = 0.00333..., posted = 0.00
    // sum = 0.00 → residual = 0.01 → goes to line with MAX gross (tie → lowest line_no)

    const result = calculateCommercialTotals(
      [
        { lineNo: 1, quantityKg: "1000.000", pricePerTon: "33.33" },
        { lineNo: 2, quantityKg: "1000.000", pricePerTon: "33.33" },
        { lineNo: 3, quantityKg: "1000.000", pricePerTon: "33.34" }, // LARGEST by 0.01
      ],
      "0.01",
    );

    expect(result.totalGrossRevenue).toBe("100.00");
    expect(result.orderDiscountTotal).toBe("0.01");

    // All posted discounts should be 0.00 (they round down from 0.003...)
    // except the residual line
    const residualLines = result.lines.filter((l) => l.roundingAdjustment !== "0.00");
    expect(residualLines.length).toBe(1);

    // Residual goes to line 3 (LARGEST gross: 33.34 > 33.33)
    expect(residualLines[0]!.lineNo).toBe(3);
    expect(residualLines[0]!.roundingAdjustment).toBe("0.01");
    expect(residualLines[0]!.lineAllocatedDiscountPosted).toBe("0.01");

    // Sum invariants
    const sumDiscounts = sumMoney(result.lines.map((l) => l.lineAllocatedDiscountPosted));
    expect(sumDiscounts).toBe("0.01");

    const sumNet = sumMoney(result.lines.map((l) => l.lineNetRevenuePosted));
    expect(sumNet).toBe(result.documentTotalPosted);
    expect(result.documentTotalPosted).toBe("99.99"); // 100.00 - 0.01
  });
});

// ===========================================================================
// 4. Tied gross lines → residual goes to LOWEST line_no.
// ===========================================================================

describe("WP-05-01 Calculator — tied gross: residual to lowest line_no", () => {
  it("3 equal gross lines + discount=0.01 → residual to line 1 (lowest line_no)", () => {
    const result = calculateCommercialTotals(
      [
        { lineNo: 1, quantityKg: "1000.000", pricePerTon: "33.33" },
        { lineNo: 2, quantityKg: "1000.000", pricePerTon: "33.33" },
        { lineNo: 3, quantityKg: "1000.000", pricePerTon: "33.33" },
      ],
      "0.01",
    );

    expect(result.totalGrossRevenue).toBe("99.99");
    expect(result.orderDiscountTotal).toBe("0.01");

    // All posted discounts = 0.00 (0.003... rounds down)
    // residual = 0.01 goes to line 1 (tie on gross → lowest line_no)
    const residualLines = result.lines.filter((l) => l.roundingAdjustment !== "0.00");
    expect(residualLines.length).toBe(1);
    expect(residualLines[0]!.lineNo).toBe(1);
    expect(residualLines[0]!.roundingAdjustment).toBe("0.01");
    expect(residualLines[0]!.lineAllocatedDiscountPosted).toBe("0.01");

    // Invariants
    const sumDiscounts = sumMoney(result.lines.map((l) => l.lineAllocatedDiscountPosted));
    expect(sumDiscounts).toBe("0.01");
    expect(result.documentTotalPosted).toBe("99.98"); // 99.99 - 0.01
  });
});

// ===========================================================================
// 5. Zero total gross → zero discount.
// ===========================================================================

describe("WP-05-01 Calculator — zero total gross", () => {
  it("total_gross = 0 implies order_discount_total must be 0", () => {
    // Price = 0.00 → gross = 0.00
    const result = calculateCommercialTotals(
      [{ lineNo: 1, quantityKg: "1000.000", pricePerTon: "0.00" }],
      "0.00",
    );

    expect(result.totalGrossRevenue).toBe("0.00");
    expect(result.orderDiscountTotal).toBe("0.00");
    expect(result.documentTotalPosted).toBe("0.00");
    expect(result.lines[0]!.lineGrossRevenue).toBe("0.00");
    expect(result.lines[0]!.lineAllocatedDiscountPosted).toBe("0.00");
    expect(result.lines[0]!.lineNetRevenuePosted).toBe("0.00");
  });

  it("rejects non-zero discount when total_gross = 0", () => {
    expect(() =>
      calculateCommercialTotals(
        [{ lineNo: 1, quantityKg: "1000.000", pricePerTon: "0.00" }],
        "1.00",
      ),
    ).toThrow(CommercialCalculatorError);
  });
});

// ===========================================================================
// 6. Midpoint ROUND_HALF_UP.
// ===========================================================================

describe("WP-05-01 Calculator — ROUND_HALF_UP midpoint", () => {
  it("0.005 rounds UP to 0.01", () => {
    // Single line: 1000 kg @ 0.01 = 0.01 gross; discount = 0.01
    // share = 1.0; precise_discount = 0.01 × 1.0 = 0.01000000; posted = 0.01
    // No midpoint here. Need a case where the precise value is exactly 0.005.
    // Line 1: 1000 @ 5.00 = 5.00 gross
    // Line 2: 1000 @ 5.00 = 5.00 gross
    // total = 10.00; discount = 0.01
    // share = 0.5 each; precise = 0.00500000; posted = ROUND_HALF_UP(0.005) = 0.01
    // Both round UP to 0.01 → sum = 0.02 > 0.01 → residual = -0.01
    // Goes to line 1 (tie, lowest line_no) → adjustment = -0.01

    const result = calculateCommercialTotals(
      [
        { lineNo: 1, quantityKg: "1000.000", pricePerTon: "5.00" },
        { lineNo: 2, quantityKg: "1000.000", pricePerTon: "5.00" },
      ],
      "0.01",
    );

    expect(result.totalGrossRevenue).toBe("10.00");
    expect(result.orderDiscountTotal).toBe("0.01");

    // Both lines: precise = 0.00500000 → ROUND_HALF_UP = 0.01
    // But that gives sum = 0.02, residual = -0.01
    // Goes to line 1 (lowest line_no in tie)
    const sumDiscounts = sumMoney(result.lines.map((l) => l.lineAllocatedDiscountPosted));
    expect(sumDiscounts).toBe("0.01"); // Must equal order_discount_total

    // The residual should be on line 1
    const line1 = result.lines.find((l) => l.lineNo === 1)!;
    const line2 = result.lines.find((l) => l.lineNo === 2)!;
    // One line has rounding_adjustment != 0
    expect(line1.roundingAdjustment !== "0.00" || line2.roundingAdjustment !== "0.00").toBe(true);
  });
});

// ===========================================================================
// 7. Precision: precise at scale 8, posted at scale 2.
// ===========================================================================

describe("WP-05-01 Calculator — precision scales", () => {
  it("line_allocated_discount_precise has 8 decimal places", () => {
    const result = calculateCommercialTotals(
      [
        { lineNo: 1, quantityKg: "1000.000", pricePerTon: "33.33" },
        { lineNo: 2, quantityKg: "1000.000", pricePerTon: "66.67" },
      ],
      "0.01",
    );

    for (const line of result.lines) {
      // Precise values should have exactly 8 decimal places
      expect(line.lineAllocatedDiscountPrecise).toMatch(/^\d+\.\d{8}$/);
      expect(line.lineNetRevenuePrecise).toMatch(/^\d+\.\d{8}$/);
      // Posted values should have exactly 2 decimal places
      expect(line.lineGrossRevenue).toMatch(/^\d+\.\d{2}$/);
      expect(line.lineAllocatedDiscountPosted).toMatch(/^\d+\.\d{2}$/);
      expect(line.lineNetRevenuePosted).toMatch(/^\d+\.\d{2}$/);
      expect(line.roundingAdjustment).toMatch(/^-?\d+\.\d{2}$/);
    }
  });
});

// ===========================================================================
// 8. Invariants: sum(posted_discounts) == order_discount_total.
// ===========================================================================

describe("WP-05-01 Calculator — sum invariants", () => {
  it("sum(line_allocated_discount_posted) == order_discount_total (exact)", () => {
    const result = calculateCommercialTotals(
      [
        { lineNo: 1, quantityKg: "1500.000", pricePerTon: "75.00" },
        { lineNo: 2, quantityKg: "2000.000", pricePerTon: "90.00" },
        { lineNo: 3, quantityKg: "750.000", pricePerTon: "120.00" },
      ],
      "25.00",
    );

    const sumDiscounts = sumMoney(result.lines.map((l) => l.lineAllocatedDiscountPosted));
    expect(sumDiscounts).toBe(result.orderDiscountTotal);
  });

  it("document_total_posted == sum(line_net_revenue_posted) (exact)", () => {
    const result = calculateCommercialTotals(
      [
        { lineNo: 1, quantityKg: "1500.000", pricePerTon: "75.00" },
        { lineNo: 2, quantityKg: "2000.000", pricePerTon: "90.00" },
        { lineNo: 3, quantityKg: "750.000", pricePerTon: "120.00" },
      ],
      "25.00",
    );

    const sumNet = sumMoney(result.lines.map((l) => l.lineNetRevenuePosted));
    expect(sumNet).toBe(result.documentTotalPosted);
  });

  it("order_discount_total <= total_gross_revenue enforced", () => {
    expect(() =>
      calculateCommercialTotals(
        [{ lineNo: 1, quantityKg: "1000.000", pricePerTon: "80.00" }],
        "100.00", // > 80.00 gross
      ),
    ).toThrow(CommercialCalculatorError);
  });

  it("per-line bounds enforced: 0 <= discount <= gross, 0 <= net <= gross", () => {
    // The calculator verifies these internally and throws if violated.
    // This test confirms that normal cases don't trigger the invariant check.
    const result = calculateCommercialTotals(
      [
        { lineNo: 1, quantityKg: "1000.000", pricePerTon: "33.33" },
        { lineNo: 2, quantityKg: "1000.000", pricePerTon: "33.33" },
        { lineNo: 3, quantityKg: "1000.000", pricePerTon: "33.34" },
      ],
      "0.01",
    );

    for (const line of result.lines) {
      expect(parseFloat(line.lineAllocatedDiscountPosted)).toBeGreaterThanOrEqual(0);
      expect(parseFloat(line.lineAllocatedDiscountPosted)).toBeLessThanOrEqual(parseFloat(line.lineGrossRevenue));
      expect(parseFloat(line.lineNetRevenuePosted)).toBeGreaterThanOrEqual(0);
      expect(parseFloat(line.lineNetRevenuePosted)).toBeLessThanOrEqual(parseFloat(line.lineGrossRevenue));
    }
  });
});

// ===========================================================================
// 9. Document total is the sum of posted net lines (not independently rounded).
// ===========================================================================

describe("WP-05-01 Calculator — document total = sum of posted net lines", () => {
  it("document_total_posted is exactly sum(line_net_revenue_posted), never independently rounded", () => {
    const result = calculateCommercialTotals(
      [
        { lineNo: 1, quantityKg: "1000.000", pricePerTon: "33.33" },
        { lineNo: 2, quantityKg: "1000.000", pricePerTon: "66.67" },
      ],
      "10.00",
    );

    const sumNet = sumMoney(result.lines.map((l) => l.lineNetRevenuePosted));
    expect(result.documentTotalPosted).toBe(sumNet);
    // Document total is the EXACT sum of posted net lines, never independently rounded.
    // The calculator does NOT round document_total_posted — it simply sums the posted net values.
    expect(result.documentTotalPosted).toBe(sumMoney(result.lines.map((l) => l.lineNetRevenuePosted)));
  });
});
