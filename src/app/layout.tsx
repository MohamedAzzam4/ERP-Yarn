import type { Metadata } from "next";
import "./globals.css";

/**
 * Root layout for ERP-Yarn.
 *
 * Contract: docs/contracts/02_design_system_and_ux_contract.md
 *   - Root MUST be `<html lang="ar" dir="rtl">` (DEC-040, Contract 02).
 *   - Arabic-first; mixed-direction values are isolated locally as LTR in
 *     value components (added in WP-00-05).
 *
 * WP-00-02 scope: structural shell only. No theme provider, no sidebar,
 * no business navigation. Fonts are loaded via next/font in WP-00-04.
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
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
