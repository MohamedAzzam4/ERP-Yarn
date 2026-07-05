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
 * DEC-067: Calculate supplier payable from net accepted kg and price per ton.
 *
 * Formula: payable = (net_accepted_kg / 1000) × price_per_ton
 *
 * - netAcceptedKg: NUMERIC(18,3) string (e.g., "1000.000")
 * - pricePerTon: NUMERIC(18,2) string (e.g., "80.00")
 * - Result: NUMERIC(18,2) string with ROUND_HALF_UP
 *
 * Uses high-precision BigInt intermediate arithmetic.
 * ROUND_HALF_UP is applied only at the final posting boundary.
 *
 * Examples:
 *   "1000.000" kg @ "80.00" EGP/ton → "80.00" EGP
 *   "1250.000" kg @ "80.00" EGP/ton → "100.00" EGP
 *   "999.500" kg @ "150.00" EGP/ton → "149.93" EGP (149.925 rounds up)
 */
export function calculateSupplierPayable(
  netAcceptedKg: string,
  pricePerTon: string,
): string {
  // Parse kg as scaled integer (× 10^3)
  const kgScaled = parseToScaledInt(netAcceptedKg, 3);
  // Parse price as scaled integer (× 10^2)
  const priceScaled = parseToScaledInt(pricePerTon, 2);

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
