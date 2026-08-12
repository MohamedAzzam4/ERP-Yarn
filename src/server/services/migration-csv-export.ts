/**
 * WP-08-01F UX milestone — CSV export safety utilities.
 *
 * Shared between the validation-report route handler and the test suite.
 * The function is exported from a server-only module so it can be imported
 * by both the route handler and focused unit tests without tripping over
 * the special path characters in the route folder (parentheses, brackets).
 */
import "server-only";

/**
 * Formula-injection neutralization.
 *
 * Per Design System CSV export safety: trim leading whitespace/control chars
 * FIRST (attackers may prepend spaces, tabs, or newlines to evade naïve
 * prefix checks), then prefix a single quote to any value still starting
 * with =, +, -, @, tab, CR, or LF.
 *
 * This is the SAME algorithm used by the template CSV generator, but
 * applied to user-supplied finding values (messages, submitted values,
 * file names, etc.) which are MUCH more dangerous than template examples.
 */
export function neutralizeFormulaInjection(value: string): string {
  if (value === "") return "";
  // 1) Trim leading whitespace and control characters (space, tab, CR, LF, etc.)
  //    Per Contract: "after trimming leading whitespace/control characters".
  const trimmed = value.replace(/^[\s\u0000-\u001F\u0080-\u009F]+/, "");
  // 2) Prefix a single quote to any value still starting with a dangerous char.
  //    Covers =, +, -, @, tab (\t), CR (\r), LF (\n).
  if (/^[=+\-@\t\r\n]/.test(trimmed)) {
    return `'${trimmed}`;
  }
  return trimmed;
}

/**
 * Escape a CSV cell value: wrap in quotes if it contains comma, quote, or
 * newline; double any embedded quotes. Apply formula-injection neutralization
 * before escaping so the dangerous-character check sees the actual payload.
 */
export function csvEscape(value: string): string {
  const safe = neutralizeFormulaInjection(value);
  if (safe.includes(",") || safe.includes('"') || safe.includes("\n") || safe.includes("\r")) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}
