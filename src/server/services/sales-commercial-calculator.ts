/**
 * Sales Commercial Totals Calculator — WP-05-01.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §11.1
 * Contract: docs/contracts/07_subledger_and_costs_contract.md §10
 * Contract: docs/contracts/14_coding_agent_instructions.md §5
 * DEC-042: Precision scales (kg 18,3; posted money 18,2; precise 24,8; ratios ≥12).
 * DEC-047: ROUND_HALF_UP only at official posted boundaries.
 * DEC-048: Document total = sum of posted net lines; residual to largest gross, then lowest line_no.
 * DEC-049: Order-level discount allocated proportionally by line gross revenue.
 *
 * This is a PURE module — no side effects, no DB, no I/O. All functions take
 * plain decimal strings and return plain decimal strings. Safe to unit-test
 * without any service/repository wiring.
 */
import {
  calculateLineGrossRevenue,
  multiplyMoneyByRatio,
  roundHalfUpMoney,
  divideMoney,
  subtractPrecise,
  addMoney,
  normalizeMoney,
  compareMoney,
  isZeroMoney,
} from "./decimal-money";
import { normalizeKg, isPositiveKg } from "./decimal-kg";

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

export interface CalculatorLineInput {
  lineNo: number;
  quantityKg: string;
  pricePerTon: string;
}

export interface CalculatorLineResult {
  lineNo: number;
  quantityKg: string;
  pricePerTon: string;
  lineGrossRevenue: string;                       // NUMERIC(18,2), ROUND_HALF_UP
  lineAllocatedDiscountPrecise: string;            // NUMERIC(24,8), unrounded
  lineAllocatedDiscountPosted: string;             // NUMERIC(18,2), ROUND_HALF_UP + residual
  lineNetRevenuePrecise: string;                   // NUMERIC(24,8), unrounded
  lineNetRevenuePosted: string;                    // NUMERIC(18,2)
  roundingAdjustment: string;                      // NUMERIC(18,2), 0 on all but residual line
}

export interface CalculatorResult {
  lines: CalculatorLineResult[];
  totalGrossRevenue: string;     // NUMERIC(18,2) = sum(line_gross_revenue)
  orderDiscountTotal: string;    // NUMERIC(18,2) = input order_discount_total
  documentTotalPosted: string;   // NUMERIC(18,2) = sum(line_net_revenue_posted)
}

export class CommercialCalculatorError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CommercialCalculatorError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Calculator.
// ---------------------------------------------------------------------------

/**
 * Calculate commercial totals for a multi-line sale.
 *
 * Algorithm (Contract 03 §11.1 + DEC-048/049):
 *
 * 1. Per line: line_gross_revenue = ROUND_HALF_UP((qty / 1000) × price, scale=2)
 * 2. total_gross_revenue = sum(line_gross_revenue)
 * 3. Validate: 0 <= order_discount_total <= total_gross_revenue
 * 4. Per line (stable line_no order):
 *    share = line_gross_revenue / total_gross_revenue  (≥12 decimals)
 *    precise_discount = order_discount_total × share    (NUMERIC(24,8))
 *    posted_discount = ROUND_HALF_UP(precise_discount, scale=2)
 *    precise_net = line_gross_revenue - precise_discount (NUMERIC(24,8))
 *    posted_net = line_gross_revenue - posted_discount   (NUMERIC(18,2))
 *    rounding_adjustment = 0
 * 5. Residual = order_discount_total - sum(posted_discount)
 *    If residual != 0:
 *      selected_line = MAX(line_gross_revenue), tie-break MIN(line_no)
 *      selected_line.posted_discount += residual
 *      selected_line.rounding_adjustment = residual
 *      selected_line.posted_net = gross - posted_discount (recomputed)
 * 6. document_total_posted = sum(posted_net)
 * 7. Verify invariants.
 */
export function calculateCommercialTotals(
  lines: CalculatorLineInput[],
  orderDiscountTotal: string,
): CalculatorResult {
  if (lines.length === 0) {
    throw new CommercialCalculatorError("VALIDATION_FAILED", "At least one line is required.");
  }

  // Validate each line
  for (const line of lines) {
    if (!isPositiveKg(line.quantityKg)) {
      throw new CommercialCalculatorError("VALIDATION_FAILED", `Line ${line.lineNo}: quantity must be positive, got '${line.quantityKg}'.`);
    }
    const priceScaled = parseToScaledInt2(line.pricePerTon);
    if (priceScaled < 0n) {
      throw new CommercialCalculatorError("VALIDATION_FAILED", `Line ${line.lineNo}: price must be non-negative, got '${line.pricePerTon}'.`);
    }
  }

  const normalizedDiscount = normalizeMoney(orderDiscountTotal);

  // Step 1: Compute line gross revenues
  const lineResults: CalculatorLineResult[] = lines.map((line) => {
    const gross = calculateLineGrossRevenue(line.quantityKg, line.pricePerTon);
    return {
      lineNo: line.lineNo,
      quantityKg: normalizeKg(line.quantityKg),
      pricePerTon: normalizeMoney(line.pricePerTon),
      lineGrossRevenue: gross,
      lineAllocatedDiscountPrecise: "0.00000000",
      lineAllocatedDiscountPosted: "0.00",
      lineNetRevenuePrecise: "0.00000000",
      lineNetRevenuePosted: gross, // net = gross when discount = 0 (updated below)
      roundingAdjustment: "0.00",
    };
  });

  // Step 2: Sum gross revenues
  let totalGross = "0.00";
  for (const line of lineResults) {
    totalGross = addMoney(totalGross, line.lineGrossRevenue);
  }

  // Step 3: Validate discount bounds
  if (compareMoney(normalizedDiscount, "0.00") < 0) {
    throw new CommercialCalculatorError("VALIDATION_FAILED", `order_discount_total must be >= 0, got '${normalizedDiscount}'.`);
  }
  if (compareMoney(normalizedDiscount, totalGross) > 0) {
    throw new CommercialCalculatorError("VALIDATION_FAILED", `order_discount_total (${normalizedDiscount}) must be <= total_gross_revenue (${totalGross}).`);
  }
  if (isZeroMoney(totalGross) && !isZeroMoney(normalizedDiscount)) {
    throw new CommercialCalculatorError("VALIDATION_FAILED", "order_discount_total must be 0 when total_gross_revenue is 0.");
  }

  // Step 4: Allocate discount proportionally (stable line_no order)
  const sortedLines = [...lineResults].sort((a, b) => a.lineNo - b.lineNo);

  for (const line of sortedLines) {
    if (isZeroMoney(totalGross)) {
      // No gross → no discount allocation
      line.lineAllocatedDiscountPrecise = "0.00000000";
      line.lineAllocatedDiscountPosted = "0.00";
      line.lineNetRevenuePrecise = formatPrecise(line.lineGrossRevenue);
      line.lineNetRevenuePosted = line.lineGrossRevenue;
    } else {
      const share = divideMoney(line.lineGrossRevenue, totalGross);
      const preciseDiscount = multiplyMoneyByRatio(normalizedDiscount, share);
      const postedDiscount = roundHalfUpMoney(preciseDiscount);
      const preciseNet = subtractPrecise(formatPrecise(line.lineGrossRevenue), preciseDiscount);
      const postedNet = normalizeMoney(subtractMoneyString(line.lineGrossRevenue, postedDiscount));

      line.lineAllocatedDiscountPrecise = preciseDiscount;
      line.lineAllocatedDiscountPosted = postedDiscount;
      line.lineNetRevenuePrecise = preciseNet;
      line.lineNetRevenuePosted = postedNet;
    }
  }

  // Step 5: Residual allocation — distribute across multiple lines if needed.
  //
  // CONTRACT CONFLICT RESOLUTION:
  // Contract 03 §11.1 says "residual assigned to the largest gross-revenue
  // line; tie uses the lowest stable line_no; rounding_adjustment is zero on
  // other lines." However, the contract ALSO requires the invariants:
  //   sum(line_allocated_discount_posted) = order_discount_total
  //   (and implicitly: 0 <= posted_discount <= gross, 0 <= net <= gross)
  //
  // When the accumulated rounding error across many lines exceeds what a
  // single line can absorb (e.g., 100 lines × 0.01 gross + discount=0.50
  // produces a residual of -0.50, but a single 0.01-gross line can only
  // absorb -0.01 before going negative), the invariants take PRECEDENCE
  // over the "single line" rule.
  //
  // FIX: Distribute the residual iteratively across lines in priority order
  // (largest gross first, then lowest line_no), capping each adjustment so
  // posted_discount stays in [0, gross]. The schema's CHECK constraint
  // allows non-zero rounding_adjustment on multiple lines.
  let sumPostedDiscounts = "0.00";
  for (const line of sortedLines) {
    sumPostedDiscounts = addMoney(sumPostedDiscounts, line.lineAllocatedDiscountPosted);
  }

  let remainingResidual = subtractMoneyString(normalizedDiscount, sumPostedDiscounts);

  if (!isZeroMoney(remainingResidual)) {
    // Sort lines by priority: largest gross first, then lowest line_no
    const priorityLines = [...sortedLines].sort((a, b) => {
      const cmp = compareMoney(b.lineGrossRevenue, a.lineGrossRevenue); // descending gross
      if (cmp !== 0) return cmp;
      return a.lineNo - b.lineNo; // ascending line_no
    });

    for (const line of priorityLines) {
      if (isZeroMoney(remainingResidual)) break;

      const currentDiscount = parseFloat(line.lineAllocatedDiscountPosted);
      const gross = parseFloat(line.lineGrossRevenue);
      const residualVal = parseFloat(remainingResidual);

      // Calculate max adjustment this line can absorb:
      // - If residual is positive: can add at most (gross - currentDiscount) before exceeding gross
      // - If residual is negative: can subtract at most currentDiscount before going below 0
      let maxAbsorb: number;
      if (residualVal > 0) {
        maxAbsorb = gross - currentDiscount;
      } else {
        maxAbsorb = currentDiscount;
      }

      const adjustment = Math.max(-maxAbsorb, Math.min(residualVal, maxAbsorb));
      if (adjustment === 0) continue;

      const adjustmentStr = adjustment.toFixed(2);
      line.lineAllocatedDiscountPosted = addMoney(line.lineAllocatedDiscountPosted, adjustmentStr);
      line.roundingAdjustment = addMoney(line.roundingAdjustment, adjustmentStr);
      line.lineNetRevenuePosted = normalizeMoney(subtractMoneyString(line.lineGrossRevenue, line.lineAllocatedDiscountPosted));

      // Reduce remaining residual
      remainingResidual = normalizeMoney((residualVal - adjustment).toFixed(2));
    }
  }

  // Step 6: Compute document total
  let documentTotal = "0.00";
  for (const line of sortedLines) {
    documentTotal = addMoney(documentTotal, line.lineNetRevenuePosted);
  }

  // Step 7: Verify invariants
  let verifySumDiscounts = "0.00";
  for (const line of sortedLines) {
    verifySumDiscounts = addMoney(verifySumDiscounts, line.lineAllocatedDiscountPosted);
  }
  if (compareMoney(verifySumDiscounts, normalizedDiscount) !== 0) {
    throw new CommercialCalculatorError("INTERNAL_ERROR", `Invariant violation: sum(posted_discounts)=${verifySumDiscounts} != order_discount_total=${normalizedDiscount}`);
  }

  let verifyDocTotal = "0.00";
  for (const line of sortedLines) {
    verifyDocTotal = addMoney(verifyDocTotal, line.lineNetRevenuePosted);
  }
  if (compareMoney(verifyDocTotal, documentTotal) !== 0) {
    throw new CommercialCalculatorError("INTERNAL_ERROR", `Invariant violation: sum(posted_net)=${verifyDocTotal} != document_total=${documentTotal}`);
  }

  // Verify per-line bounds: 0 <= posted_discount <= gross, 0 <= posted_net <= gross
  // (These are the CRITICAL invariants that the multi-line residual distribution
  // preserves. The contract says "single line" but these invariants take
  // precedence when they conflict.)
  for (const line of sortedLines) {
    const discount = parseFloat(line.lineAllocatedDiscountPosted);
    const gross = parseFloat(line.lineGrossRevenue);
    const net = parseFloat(line.lineNetRevenuePosted);
    if (discount < 0) {
      throw new CommercialCalculatorError("INTERNAL_ERROR", `Invariant violation: line ${line.lineNo} has negative posted_discount=${line.lineAllocatedDiscountPosted}`);
    }
    if (discount > gross) {
      throw new CommercialCalculatorError("INTERNAL_ERROR", `Invariant violation: line ${line.lineNo} posted_discount=${line.lineAllocatedDiscountPosted} > gross=${line.lineGrossRevenue}`);
    }
    if (net < 0) {
      throw new CommercialCalculatorError("INTERNAL_ERROR", `Invariant violation: line ${line.lineNo} has negative posted_net=${line.lineNetRevenuePosted}`);
    }
    if (net > gross) {
      throw new CommercialCalculatorError("INTERNAL_ERROR", `Invariant violation: line ${line.lineNo} posted_net=${line.lineNetRevenuePosted} > gross=${line.lineGrossRevenue}`);
    }
  }

  return {
    lines: sortedLines,
    totalGrossRevenue: totalGross,
    orderDiscountTotal: normalizedDiscount,
    documentTotalPosted: documentTotal,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers.
// ---------------------------------------------------------------------------

function parseToScaledInt2(value: string): bigint {
  const normalized = normalizeMoney(value);
  const neg = normalized.startsWith("-");
  const abs = neg ? normalized.slice(1) : normalized;
  const [intPart, fracPart] = abs.split(".");
  const scaled = BigInt(intPart || "0") * 100n + BigInt(fracPart || "00");
  return neg ? -scaled : scaled;
}

function subtractMoneyString(a: string, b: string): string {
  const aScaled = parseToScaledInt2(a);
  const bScaled = parseToScaledInt2(b);
  const result = aScaled - bScaled;
  const isNeg = result < 0n;
  const absStr = (isNeg ? -result : result).toString().padStart(3, "0");
  const intPart = absStr.slice(0, -2) || "0";
  const fracPart = absStr.slice(-2);
  return `${isNeg ? "-" : ""}${intPart}.${fracPart}`;
}

function formatPrecise(money: string): string {
  // Convert NUMERIC(18,2) to NUMERIC(24,8) by padding with zeros
  const normalized = normalizeMoney(money);
  const [intPart, fracPart] = normalized.split(".");
  return `${intPart}.${(fracPart || "00").padEnd(8, "0")}`;
}
