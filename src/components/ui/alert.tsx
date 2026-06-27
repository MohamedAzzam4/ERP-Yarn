/**
 * Alert — accessible state/feedback primitive.
 *
 * Contract: docs/contracts/02_design_system_and_ux_contract.md
 *   - "Color must never be the only carrier of status or severity. Every
 *      critical state uses visible Arabic text and, where helpful, a
 *      consistent icon."
 *   - Uses semantic Tailwind utilities only (no literal colors).
 *   - RTL-safe: uses logical properties.
 *
 * Contract: docs/contracts/14_coding_agent_instructions.md §8
 *   - "Critical state cannot be color-only or toast-only."
 *
 * PROVISIONAL: Visual values are provisional until reference-screen
 * owner approval.
 */

import * as React from "react";
import { cn } from "@/lib/cn";

type AlertVariant = "info" | "success" | "warning" | "danger";

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant;
}

const variantClasses: Record<AlertVariant, string> = {
  info: "border-info/50 text-info bg-info/5",
  success: "border-success/50 text-success bg-success/5",
  warning: "border-warning/50 text-warning bg-warning/5",
  danger: "border-danger/50 text-danger bg-danger/5",
};

/**
 * Accessible alert component.
 *
 * Renders a visible, non-dismissible alert with semantic color + text.
 * Color is NEVER the only carrier of status — the variant determines
 * both the color and the expected text content.
 *
 * For critical states (danger, warning), the text content MUST include
 * an Arabic status word (e.g., "تحذير", "خطأ") — not just color.
 *
 * RTL-safe: uses `border` (logical) not `border-l`/`border-r`.
 */
export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant = "info", ...props }, ref) => (
    <div
      ref={ref}
      role="alert"
      className={cn(
        "relative w-full rounded-lg border p-4 text-body",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  ),
);
Alert.displayName = "Alert";

export const AlertTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn("mb-1 font-heading font-semibold leading-none", className)}
    {...props}
  />
));
AlertTitle.displayName = "AlertTitle";

export const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm [&_p]:leading-relaxed", className)}
    {...props}
  />
));
AlertDescription.displayName = "AlertDescription";
