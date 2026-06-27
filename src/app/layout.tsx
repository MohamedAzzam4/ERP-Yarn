import type { Metadata } from "next";
import { tajawal, alexandria } from "@/lib/fonts";
import "./globals.css";

/**
 * Root layout for ERP-Yarn.
 *
 * Contract: docs/contracts/02_design_system_and_ux_contract.md
 *   - Root MUST be `<html lang="ar" dir="rtl">` (DEC-040, Contract 02).
 *   - Arabic-first; mixed-direction values are isolated locally as LTR in
 *     value components (added in WP-00-05).
 *
 * WP-00-04 scope: theme foundation. Fonts are loaded via next/font
 * (Tajawal for body, Alexandria for headings). The font CSS variables
 * (--font-tajawal, --font-alexandria) are applied on the <html> element
 * and consumed by the @theme block in globals.css.
 *
 * WP-00-05 will add RTL layout shell, sidebar, and LTR isolation primitives.
 */

export const metadata: Metadata = {
  title: "ERP-Yarn",
  description:
    "Specialized Yarn Trading & Outsourced Manufacturing ERP — foundation",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="ar"
      dir="rtl"
      className={`${tajawal.variable} ${alexandria.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
