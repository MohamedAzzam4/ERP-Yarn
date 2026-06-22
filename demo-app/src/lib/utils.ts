import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind-aware className combiner used by every component. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a number using Western digits with up to 3 decimals for quantities
 * and 2 decimals for money. Trailing zeros are omitted in summary display.
 */
export function formatNumber(value: number, maxFractionDigits = 3): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: maxFractionDigits,
    minimumFractionDigits: 0,
  }).format(value);
}

/** Format an Egyptian-pound amount with the جنيه suffix. */
export function formatEgp(value: number | undefined, opts: { redact?: boolean } = {}): string {
  if (opts.redact) return "—";
  if (value === undefined || !Number.isFinite(value)) return "—";
  return `${formatNumber(value, 2)} جنيه`;
}

/**
 * Convert an ISO-8601 date-only string (YYYY-MM-DD) to the contracted
 * display format DD/MM/YYYY without timezone shifting.
 */
export function formatDate(iso: string | undefined): string {
  if (!iso) return "—";
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  const [y, m, d] = parts;
  return `${d}/${m}/${y}`;
}

/** Format an ISO timestamp for display as DD/MM/YYYY HH:MM. */
export function formatTimestamp(iso: string | undefined): string {
  if (!iso) return "—";
  const [date, time] = iso.split("T");
  const timeShort = time ? time.slice(0, 5) : "";
  return timeShort ? `${formatDate(date)} ${timeShort}` : formatDate(date);
}

/** Generate a synthetic code like SAL-2026-0007. */
export function nextCode(prefix: string, year: number, existing: string[]): string {
  let max = 0;
  for (const code of existing) {
    const m = new RegExp(`^${prefix}-${year}-(\\d+)$`).exec(code);
    if (m) {
      const n = parseInt(m[1]!, 10);
      if (n > max) max = n;
    }
  }
  return `${prefix}-${year}-${String(max + 1).padStart(4, "0")}`;
}

export function todayIso(): string {
  // Use a fixed "today" so tests are deterministic. The showcase is
  // initialized from seed data dated June 2026.
  return "2026-06-22";
}

export function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}
