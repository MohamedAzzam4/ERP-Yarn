/**
 * Arabic typography foundation using next/font.
 *
 * Contract: docs/contracts/02_design_system_and_ux_contract.md §Typography
 *   Body, tables, forms, worker screens: Tajawal (400, 500, 700)
 *   Headings, sidebar, dashboard titles, buttons: Alexandria (500, 600, 700)
 *   Fallback: Noto Sans Arabic, then suitable system sans-serif
 *
 * Fonts are loaded through the Next.js font pipeline (self-hosted, no
 * third-party runtime request). Only required weights are loaded.
 *
 * DEC-039: Calm Enterprise design system.
 */

import { Tajawal, Alexandria } from "next/font/google";

/**
 * Tajawal — body, tables, forms, worker screens.
 * Weights: 400 (regular), 500 (medium), 700 (bold).
 */
export const tajawal = Tajawal({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "700"],
  variable: "--font-tajawal",
  display: "swap",
});

/**
 * Alexandria — headings, sidebar, dashboard titles, buttons.
 * Weights: 500 (medium), 600 (semibold), 700 (bold).
 */
export const alexandria = Alexandria({
  subsets: ["arabic", "latin"],
  weight: ["500", "600", "700"],
  variable: "--font-alexandria",
  display: "swap",
});
