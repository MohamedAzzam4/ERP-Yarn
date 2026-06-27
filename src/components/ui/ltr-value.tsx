/**
 * LtrValue — isolated LTR value component for mixed-direction content.
 *
 * Contract: docs/contracts/02_design_system_and_ux_contract.md
 *   §Local LTR Isolation:
 *     "Dynamic mixed-direction values use:
 *        <bdi dir="ltr">...</bdi>
 *      or one equivalent shared BidiValue component that applies LTR
 *      direction and Unicode bidirectional isolation."
 *
 *   §Arabic-First Root Direction:
 *     "Do not allow an English word or code at the beginning of a sentence
 *      to flip the entire message to LTR. Rewrite the surrounding
 *      label/message as Arabic RTL and isolate only the English/code/value
 *      segment."
 *
 * Local LTR isolation is required for:
 *   - document codes
 *   - batch codes
 *   - lot codes
 *   - emails
 *   - phone numbers
 *   - URLs
 *   - dates
 *   - quantities
 *   - monetary values
 *   - factory rates and unit costs
 *   - numeric table cells
 *   - technical identifiers
 *
 * DEC-040: The application root is Arabic RTL and mixed-direction dynamic
 * values are isolated locally as LTR.
 */

import * as React from "react";
import { cn } from "@/lib/cn";

export interface LtrValueProps extends React.HTMLAttributes<HTMLElement> {
  /** The value to display in isolated LTR. */
  children: React.ReactNode;
  /** Render as a specific HTML element (default: bdi). */
  as?: React.ElementType;
}

/**
 * Isolates a mixed-direction value (code, number, date, email, etc.)
 * in a `<bdi dir="ltr">` wrapper so it renders LTR within an RTL page
 * without flipping surrounding Arabic text.
 *
 * Example usage:
 *   <p>رقم المستند: <LtrValue>INV-2026-001</LtrValue></p>
 *   <p>الكمية: <LtrValue>4,250.000 kg</LtrValue></p>
 *   <p>التاريخ: <LtrValue>20/06/2026</LtrValue></p>
 *
 * The component uses `unicode-bidi: isolate` (via the `bdi` element's
 * default behavior) and `direction: ltr` to ensure the value renders
 * left-to-right regardless of the page's RTL direction.
 */
export const LtrValue = React.forwardRef<HTMLElement, LtrValueProps>(
  ({ children, as: Component = "bdi", className, ...props }, ref) => {
    return (
      <Component
        ref={ref}
        dir="ltr"
        className={cn("inline-block", className)}
        {...props}
      >
        {children}
      </Component>
    );
  },
);

LtrValue.displayName = "LtrValue";
