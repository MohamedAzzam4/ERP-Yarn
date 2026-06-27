/**
 * `cn` — class name utility for shadcn/ui component convention.
 *
 * Combines `clsx` (conditional class names) with `tailwind-merge`
 * (deduplicates conflicting Tailwind classes).
 *
 * Contract: docs/contracts/02_design_system_and_ux_contract.md
 *   shadcn/ui open-code components use this pattern.
 */

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
