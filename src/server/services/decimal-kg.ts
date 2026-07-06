/**
 * Decimal arithmetic helpers for NUMERIC(18,3) kilogram quantities.
 *
 * Contract: docs/contracts/14_coding_agent_instructions.md §5
 *   "Use decimal arithmetic for all quantities... Never use JavaScript
 *    binary floating point as business authority."
 *   "kg 18,3"
 *
 * These helpers operate on decimal strings (e.g. "1000.000") to avoid
 * floating-point precision loss. All inventory quantities use
 * NUMERIC(18,3) — 3 decimal places for kilograms.
 *
 * The helpers are pure functions with no I/O. They are testable without
 * a database.
 */

/**
 * The scale (number of decimal places) for kilogram quantities.
 * Matches NUMERIC(18,3) in the database schema.
 */
export const KG_SCALE = 3;

/**
 * Normalize a decimal string to exactly KG_SCALE decimal places.
 *
 * "1000" → "1000.000"
 * "1000.5" → "1000.500"
 * "1000.123456" → "1000.123" (truncates to 3 places — caller should
 *   validate precision before calling if rounding is needed)
 * "" → "0.000"
 * null/undefined → "0.000"
 */
export function normalizeKg(value: string | null | undefined): string {
  if (!value || value.trim() === "") return "0.000";
  const trimmed = value.trim();
  const neg = trimmed.startsWith("-");
  const abs = neg ? trimmed.slice(1) : trimmed;
  const [intPart, fracPart = ""] = abs.split(".");
  const fracPadded = (fracPart + "000").slice(0, KG_SCALE);
  const result = `${intPart}.${fracPadded}`;
  return neg ? `-${result}` : result;
}

/**
 * Add two kg decimal strings. Returns a normalized 3-decimal string.
 *
 * "1000.000" + "500.000" → "1500.000"
 * "0.000" + "0.000" → "0.000"
 */
export function addKg(a: string, b: string): string {
  const aNorm = normalizeKg(a);
  const bNorm = normalizeKg(b);
  const aVal = toScaledInt(aNorm);
  const bVal = toScaledInt(bNorm);
  const sum = aVal + bVal;
  const sumStr = sum.toString();
  const isNeg = sumStr.startsWith("-");
  const absStr = isNeg ? sumStr.slice(1) : sumStr;
  const padded = absStr.padStart(4, "0");
  const intPart = padded.slice(0, -3) || "0";
  const fracPart = padded.slice(-3);
  return `${isNeg ? "-" : ""}${intPart}.${fracPart}`;
}

/**
 * Compare two kg decimal strings.
 * Returns negative if a < b, 0 if equal, positive if a > b.
 */
export function compareKg(a: string, b: string): number {
  const aNorm = normalizeKg(a);
  const bNorm = normalizeKg(b);
  const aSigned = toScaledInt(aNorm);
  const bSigned = toScaledInt(bNorm);
  if (aSigned < bSigned) return -1;
  if (aSigned > bSigned) return 1;
  return 0;
}

/**
 * Check if a kg value is positive (> 0).
 */
export function isPositiveKg(value: string): boolean {
  return compareKg(value, "0.000") > 0;
}

/**
 * Check if a string is a valid NUMERIC(18,3) kg value before passing it
 * to BigInt-based arithmetic (which would throw SyntaxError on non-numeric
 * input).
 *
 * Accepts optional leading sign, integer part, optional fractional part
 * (up to 3 digits). Examples:
 *   "1000" ✅, "1000.000" ✅, "1000.5" ✅, "0.001" ✅
 *   "abc" ❌, "" ❌, "1.2.3" ❌, "1e3" ❌
 */
export function isValidDecimalKg(value: string | null | undefined): boolean {
  if (!value || value.trim() === "") return false;
  const trimmed = value.trim();
  // Optional sign, digits, optional decimal point with up to 3 digits.
  return /^-?\d+(\.\d{1,3})?$/.test(trimmed);
}

/**
 * Check if a kg value is zero (== 0).
 */
export function isZeroKg(value: string): boolean {
  return compareKg(value, "0.000") === 0;
}

/**
 * Check if a kg value is negative (< 0).
 */
export function isNegativeKg(value: string): boolean {
  return compareKg(value, "0.000") < 0;
}

/**
 * Subtract b from a. Returns a normalized 3-decimal string.
 * "1500.000" - "500.000" → "1000.000"
 * "500.000" - "1500.000" → "-1000.000" (negative result allowed for reconciliation)
 */
export function subtractKg(a: string, b: string): string {
  const aNorm = normalizeKg(a);
  const bNorm = normalizeKg(b);
  const aVal = toScaledInt(aNorm);
  const bVal = toScaledInt(bNorm);
  const diff = aVal - bVal;
  const diffStr = diff.toString();
  const isNeg = diffStr.startsWith("-");
  const absStr = isNeg ? diffStr.slice(1) : diffStr;
  const padded = absStr.padStart(4, "0");
  const intPart = padded.slice(0, -3) || "0";
  const fracPart = padded.slice(-3);
  return `${isNeg ? "-" : ""}${intPart}.${fracPart}`;
}

// --- Internal helper: convert normalized string to scaled BigInt ---

function toScaledInt(normalized: string): bigint {
  const neg = normalized.startsWith("-");
  const abs = neg ? normalized.slice(1) : normalized;
  const [intPart, fracPart] = abs.split(".");
  const scaled = BigInt(intPart || "0") * 1000n + BigInt(fracPart || "000");
  return neg ? -scaled : scaled;
}
