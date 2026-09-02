/**
 * Decimal arithmetic helpers for NUMERIC(18,2) monetary quantities.
 *
 * Contract: docs/contracts/14_coding_agent_instructions.md §5
 *   "posted money/rates 18,2"
 *   "Never use JavaScript binary floating point as business authority."
 *   "ROUND_HALF_UP only at official posted monetary boundaries."
 *
 * DEC-067: payable = net_accepted_kg / 1000 × price_per_ton
 *   - kg is NUMERIC(18,3) (3 decimal places)
 *   - price_per_ton is NUMERIC(18,2) (2 decimal places)
 *   - payable is NUMERIC(18,2) with ROUND_HALF_UP
 *
 * All helpers operate on decimal strings to avoid floating-point precision
 * loss. BigInt is used internally for exact integer arithmetic.
 */

/** The scale (number of decimal places) for posted money. */
export const MONEY_SCALE = 2;

/**
 * Normalize a decimal string to exactly MONEY_SCALE decimal places.
 * "1000" → "1000.00"
 * "1000.5" → "1000.50"
 * "" → "0.00"
 * null/undefined → "0.00"
 */
export function normalizeMoney(value: string | null | undefined): string {
  if (!value || value.trim() === "") return "0.00";
  const trimmed = value.trim();
  const neg = trimmed.startsWith("-");
  const abs = neg ? trimmed.slice(1) : trimmed;
  const [intPart, fracPart = ""] = abs.split(".");
  const fracPadded = (fracPart + "00").slice(0, MONEY_SCALE);
  const result = `${intPart}.${fracPadded}`;
  return neg ? `-${result}` : result;
}

/**
 * Add two money decimal strings. Returns a normalized 2-decimal string.
 */
export function addMoney(a: string, b: string): string {
  const aScaled = toScaledInt(a);
  const bScaled = toScaledInt(b);
  const sum = aScaled + bScaled;
  return fromScaledInt(sum);
}

/**
 * Subtract money: a - b. Returns a normalized 2-decimal string.
 */
export function subtractMoney(a: string, b: string): string {
  return addMoney(a, negateMoney(b));
}

/** Negate a money string: "80.00" → "-80.00", "-50.00" → "50.00" */
export function negateMoney(value: string): string {
  const normalized = normalizeMoney(value);
  if (normalized.startsWith("-")) return normalized.slice(1);
  if (normalized === "0.00") return "0.00";
  return `-${normalized}`;
}

/** Get the absolute value of a money string. */
export function absMoney(value: string): string {
  const normalized = normalizeMoney(value);
  return normalized.startsWith("-") ? normalized.slice(1) : normalized;
}

/**
 * Compare two money decimal strings.
 * Returns negative if a < b, 0 if equal, positive if a > b.
 */
export function compareMoney(a: string, b: string): number {
  const aScaled = toScaledInt(a);
  const bScaled = toScaledInt(b);
  if (aScaled < bScaled) return -1;
  if (aScaled > bScaled) return 1;
  return 0;
}

/** Check if a money value is positive (> 0). */
export function isPositiveMoney(value: string): boolean {
  return compareMoney(value, "0.00") > 0;
}

/** Check if a money value is zero (== 0). */
export function isZeroMoney(value: string): boolean {
  return compareMoney(value, "0.00") === 0;
}

/** Check if a money value is negative (< 0). */
export function isNegativeMoney(value: string): boolean {
  return compareMoney(value, "0.00") < 0;
}

/**
 * Validate that a string is STRICTLY canonical posted money at scale 2,
 * conforming to the contracted NUMERIC(18,2) range.
 *
 * r21 BLOCKER A: Extended from r20 strict syntax validator to also
 * enforce NUMERIC(18,2) precision bounds using BigInt arithmetic.
 * No JavaScript Number / parseFloat.
 *
 * Syntax:
 *   - optional leading "-"
 *   - one or more digits (integer part; leading zeros allowed)
 *   - "."
 *   - EXACTLY two digits (fraction part)
 *   - no leading/trailing whitespace, no "+", no NaN/Infinity
 *
 * Range (after parsing):
 *   The absolute value must fit NUMERIC(18,2):
 *   max integer digits = 16 (because 2 are fractional)
 *   max absolute value = 9999999999999999.99
 *   (16 integer digits + 2 fractional = 18 total significant digits)
 *
 * ACCEPT: "0.00", "1.20", "100.00", "-50.00", "9999999999999999.99"
 * REJECT: "", "1", "1.2", "1.234", "1.2.3", "abc", "NaN", "+1.00",
 *         " 1.00 ", "10.0", "10.000",
 *         "10000000000000000.00" (17 integer digits — exceeds 18,2)
 *         "-10000000000000000.00"
 */
export function isValidCanonicalMoney(value: unknown): value is string {
  if (typeof value !== "string") return false;
  // Strict pattern: optional "-", digits, ".", exactly 2 digits, no whitespace
  const match = /^(-?)(\d+)\.(\d{2})$/.exec(value);
  if (!match) return false;
  // r22 BLOCKER A: Enforce NUMERIC(18,2) range using BigInt.
  // Parse the full scaled absolute value (integer * 100 + fraction).
  // Leading zeros are allowed per DB convention — they do not enlarge the
  // numeric value. We check the numeric VALUE, not the string length.
  // max NUMERIC(18,2) = 9999999999999999.99 → scaled = 999999999999999999
  const intPart = BigInt(match[2]!);
  const fracPart = BigInt(match[3]!);
  const absScaled = intPart * 100n + fracPart;
  const MAX_SCALED = 999999999999999999n; // 9999999999999999.99
  return absScaled <= MAX_SCALED;
}

/**
 * DEC-067 / DEC-013: Calculate payable from net/input kg and price/rate per ton.
 *
 * Supplier payable (DEC-067):
 *   payable = net_accepted_kg / 1000 × price_per_ton
 *
 * Factory production payable (DEC-013, Contract 05 §17, Contract 07 §12):
 *   factory_payable = factory_cost_basis_input_qty_kg / 1000 × factory_rate_per_input_ton
 *   where factory_cost_basis_input_qty_kg = consumed_toward_output_qty + waste_qty
 *   (waste does NOT reduce payable — DEC-013).
 *
 * Both formulas share the same shape: kg-quantity / 1000 × rate-per-ton, with
 * ROUND_HALF_UP only at the final posting boundary (NUMERIC(18,2)).
 *
 * - kgOrBasis: NUMERIC(18,3) string (e.g., "1000.000")
 * - ratePerTon: NUMERIC(18,2) string (e.g., "30000.00")
 * - Result: NUMERIC(18,2) string with ROUND_HALF_UP
 *
 * Uses high-precision BigInt intermediate arithmetic.
 *
 * Examples:
 *   "1000.000" kg @ "80.00" EGP/ton → "80.00" EGP
 *   "1250.000" kg @ "80.00" EGP/ton → "100.00" EGP
 *   "999.500" kg @ "150.00" EGP/ton → "149.93" EGP (149.925 rounds up)
 *   "5000.000" kg @ "30000.00" EGP/ton → "150000.00" EGP (factory full receipt, Contract 12 fixture)
 *   "3500.000" kg @ "30000.00" EGP/ton → "105000.00" EGP (factory partial receipt)
 */
export function calculateSupplierPayable(
  kgOrBasis: string,
  ratePerTon: string,
): string {
  // Parse kg/basis as scaled integer (× 10^3)
  const kgScaled = parseToScaledInt(kgOrBasis, 3);
  // Parse rate/price as scaled integer (× 10^2)
  const priceScaled = parseToScaledInt(ratePerTon, 2);

  // product = kg × price, in scale 10^(3+2) = 10^5
  const product = kgScaled * priceScaled;

  // payable = product / 1000 (convert kg to tons), then round to scale 10^2
  // payable_scaled_2 = round_half_up(product / 10^6)
  // (because: product is in 10^5, dividing by 1000 gives 10^2, but we need
  //  to round the intermediate division by 1000 which may have a remainder)

  // Actually: payable = (kg / 1000) × price
  // = (kg_scaled / 10^3 / 1000) × (price_scaled / 10^2)
  // = (kg_scaled × price_scaled) / (10^3 × 10^3 × 10^2)
  // = product / 10^8
  //
  // To get payable in scale 10^2: payable_scaled = round_half_up(product / 10^6)
  // (because 10^8 / 10^2 = 10^6)

  const divisor = 1000000n; // 10^6
  const quotient = product / divisor;
  const remainder = product % divisor;

  // ROUND_HALF_UP: if remainder × 2 >= divisor, round up
  let payableScaled = quotient;
  if (remainder * 2n >= divisor) {
    payableScaled = quotient + 1n;
  }

  // Handle negative results (shouldn't happen for supplier payable, but be safe)
  const isNegative = payableScaled < 0n;
  const absScaled = isNegative ? -payableScaled : payableScaled;
  const absStr = absScaled.toString().padStart(3, "0"); // at least 1 int + 2 frac
  const intPart = absStr.slice(0, -2) || "0";
  const fracPart = absStr.slice(-2);
  const result = `${intPart}.${fracPart}`;
  return isNegative ? `-${result}` : result;
}

/**
 * DEC-013 / Contract 05 §17 / Contract 07 §12: Calculate factory production
 * payable from input-quantity basis and confirmed factory rate per input ton.
 *
 * Formula: factory_payable = factory_cost_basis_input_qty_kg / 1000 × factory_rate_per_input_ton
 *   where factory_cost_basis_input_qty_kg = SUM(consumed_toward_output_qty + waste_qty)
 *   across the receipt's allocations (waste does NOT reduce payable — DEC-013).
 *
 * This is a semantic alias of `calculateSupplierPayable` — both share the same
 * (kg / 1000 × rate-per-ton) shape with ROUND_HALF_UP at posting boundary.
 * Kept as a separate export for contract-readable call sites in the
 * production-receipt-approval-service.
 *
 * - basisInputQtyKg: NUMERIC(18,3) string (e.g., "5000.000")
 * - factoryRatePerInputTon: NUMERIC(18,2) string (e.g., "30000.00")
 * - Result: NUMERIC(18,2) string with ROUND_HALF_UP
 *
 * Example (Contract 12 §3.2 fixture):
 *   "5000.000" kg basis @ "30000.00" EGP/ton → "150000.00" EGP
 */
export function calculateFactoryPayable(
  basisInputQtyKg: string,
  factoryRatePerInputTon: string,
): string {
  return calculateSupplierPayable(basisInputQtyKg, factoryRatePerInputTon);
}

// =========================================================================
// WP-05-01: Sales commercial-totals helpers.
// =========================================================================

/**
 * Multiply a money value (NUMERIC(18,2)) by a ratio string (≥12 decimals)
 * at high precision, returning a NUMERIC(24,8) result WITHOUT rounding.
 *
 * Contract 03 §11.1 + DEC-049:
 *   line_allocated_discount_precise = order_discount_total × line_discount_share
 *
 * - money: NUMERIC(18,2) string (e.g., "150.00")
 * - ratio: a decimal string with ≥12 decimal places (e.g., "0.333333333333")
 * - Result: NUMERIC(24,8) string (e.g., "49.99999999")
 *
 * Uses BigInt internally: money is scaled to 10^2, ratio to 10^12,
 * product is at scale 10^14, then divided to 10^8 (truncated, not rounded).
 */
export function multiplyMoneyByRatio(money: string, ratio: string): string {
  const moneyScaled = parseToScaledInt(money, 2);       // × 10^2
  const ratioScaled = parseToScaledInt(ratio, 12);       // × 10^12
  // Product is at scale 10^14; we want 10^8, so divide by 10^6
  const product = moneyScaled * ratioScaled;
  const divisor = 1000000n; // 10^6
  const result = product / divisor; // truncate to scale 8

  const isNeg = result < 0n;
  const absStr = (isNeg ? -result : result).toString().padStart(9, "0");
  const intPart = absStr.slice(0, -8) || "0";
  const fracPart = absStr.slice(-8);
  return `${isNeg ? "-" : ""}${intPart}.${fracPart}`;
}

/**
 * Round a high-precision decimal string to scale 2 using ROUND_HALF_UP.
 *
 * Contract 03 §11.1 + DEC-047:
 *   line_gross_revenue = ROUND_HALF_UP(line_gross_revenue_precise, scale=2)
 *   line_allocated_discount_posted = ROUND_HALF_UP(line_allocated_discount_precise, scale=2)
 *
 * - precise: a decimal string at any scale (e.g., "49.99999999" at scale 8)
 * - Result: NUMERIC(18,2) string (e.g., "50.00")
 */
export function roundHalfUpMoney(precise: string): string {
  const scaled = parseToScaledInt(precise, 8); // parse at scale 8
  // We want scale 2; the difference is 10^6
  const divisor = 1000000n; // 10^6
  const quotient = scaled / divisor;
  const remainder = scaled % divisor;
  // ROUND_HALF_UP: if 2 * |remainder| >= divisor, round away from zero
  const absRemainder = remainder < 0n ? -remainder : remainder;
  let result = quotient;
  if (absRemainder * 2n >= divisor) {
    result = quotient + (quotient < 0n ? -1n : 1n);
  }
  return fromScaledInt(result);
}

/**
 * Calculate line gross revenue: (quantity_kg / 1000) × price_per_ton,
 * rounded to scale 2 with ROUND_HALF_UP.
 *
 * Same formula as calculateSupplierPayable but semantically named for sales.
 * Contract 03 §11.1: line_gross_revenue = ROUND_HALF_UP((qty / 1000) × price, 2)
 */
export function calculateLineGrossRevenue(
  quantityKg: string,
  pricePerTon: string,
): string {
  return calculateSupplierPayable(quantityKg, pricePerTon);
}

/**
 * Divide money by money, returning a ratio string at ≥12 decimal precision.
 *
 * Contract 03 §11.1: line_discount_share = line_gross_revenue / total_gross_revenue
 *
 * - numerator: NUMERIC(18,2) string
 * - denominator: NUMERIC(18,2) string (must be non-zero)
 * - Result: a string with ≥12 decimal places (e.g., "0.333333333333")
 */
export function divideMoney(numerator: string, denominator: string): string {
  const numScaled = parseToScaledInt(numerator, 2);       // × 10^2
  const denScaled = parseToScaledInt(denominator, 2);     // × 10^2
  if (denScaled === 0n) return "0.000000000000";
  // We want 12 decimal places: (num × 10^12) / den
  const scaledUp = numScaled * 1000000000000n; // × 10^12
  const ratio = scaledUp / denScaled;
  const isNeg = ratio < 0n;
  const absStr = (isNeg ? -ratio : ratio).toString().padStart(13, "0");
  const intPart = absStr.slice(0, -12) || "0";
  const fracPart = absStr.slice(-12);
  return `${isNeg ? "-" : ""}${intPart}.${fracPart}`;
}

/**
 * Subtract two high-precision (NUMERIC(24,8)) values.
 * Returns a NUMERIC(24,8) string.
 */
export function subtractPrecise(a: string, b: string): string {
  const aScaled = parseToScaledInt(a, 8);
  const bScaled = parseToScaledInt(b, 8);
  const result = aScaled - bScaled;
  const isNeg = result < 0n;
  const absStr = (isNeg ? -result : result).toString().padStart(9, "0");
  const intPart = absStr.slice(0, -8) || "0";
  const fracPart = absStr.slice(-8);
  return `${isNeg ? "-" : ""}${intPart}.${fracPart}`;
}

// --- Internal helpers ---

function toScaledInt(normalized: string): bigint {
  const neg = normalized.startsWith("-");
  const abs = neg ? normalized.slice(1) : normalized;
  const [intPart, fracPart] = abs.split(".");
  const scaled = BigInt(intPart || "0") * 100n + BigInt(fracPart || "00");
  return neg ? -scaled : scaled;
}

function fromScaledInt(scaled: bigint): string {
  const isNeg = scaled < 0n;
  const absStr = (isNeg ? -scaled : scaled).toString().padStart(3, "0");
  const intPart = absStr.slice(0, -2) || "0";
  const fracPart = absStr.slice(-2);
  return `${isNeg ? "-" : ""}${intPart}.${fracPart}`;
}

function parseToScaledInt(value: string, scale: number): bigint {
  const normalized = value.trim();
  const neg = normalized.startsWith("-");
  const abs = neg ? normalized.slice(1) : normalized;
  const [intPart, fracPart = ""] = abs.split(".");
  const fracPadded = (fracPart + "0".repeat(scale)).slice(0, scale);
  const scaled = BigInt(intPart || "0") * BigInt(10 ** scale) + BigInt(fracPadded);
  return neg ? -scaled : scaled;
}
