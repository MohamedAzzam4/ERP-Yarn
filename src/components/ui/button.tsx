/**
 * Button — shared primitive component.
 *
 * Contract: docs/contracts/02_design_system_and_ux_contract.md
 *   - Uses semantic Tailwind utilities only (no literal colors).
 *   - Calm Enterprise visual direction.
 *   - WCAG 2.2 AA: visible focus, 44px minimum touch target for worker
 *     contexts, sufficient contrast.
 *   - Light-only (no dark mode classes).
 *
 * This is a repository-owned shadcn-style component. It follows project
 * conventions and must not be blindly overwritten by CLI updates.
 *
 * PROVISIONAL: Visual values are provisional until the three reference
 * screens are owner-approved (Contract 02 §MVP Theme Scope).
 */

import * as React from "react";
import { cn } from "@/lib/cn";

type ButtonVariant =
  | "primary"
  | "secondary"
  | "outline"
  | "ghost"
  | "danger"
  | "success";

type ButtonSize = "sm" | "md" | "lg" | "icon";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-primary",
  secondary:
    "bg-surface text-foreground border border-border hover:bg-muted focus-visible:ring-ring",
  outline:
    "bg-transparent text-foreground border border-border hover:bg-muted focus-visible:ring-ring",
  ghost:
    "bg-transparent text-foreground hover:bg-muted focus-visible:ring-ring",
  danger:
    "bg-danger text-danger-foreground hover:bg-danger/90 focus-visible:ring-danger",
  success:
    "bg-success text-success-foreground hover:bg-success/90 focus-visible:ring-success",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-sm rounded-md",
  md: "h-11 px-4 text-sm rounded-md",
  lg: "h-12 px-6 text-base rounded-lg",
  icon: "h-11 w-11 rounded-md",
};

/**
 * ERP-Yarn Button component.
 *
 * All colors use semantic Tailwind utilities (bg-primary, text-foreground,
 * etc.) — no literal palette colors. The `md` and `lg` sizes meet the
 * 44px minimum touch target for worker contexts (WCAG 2.2 AA).
 *
 * The `font-heading` class applies the Alexandria font to button text
 * per Contract 02 §Typography ("Headings, sidebar, dashboard titles,
 * buttons: Alexandria").
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          // Base: inline-flex, items-center, justify-center, font-heading
          "inline-flex items-center justify-center font-heading font-medium",
          "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
          "disabled:pointer-events-none disabled:opacity-50",
          // Variant
          variantClasses[variant],
          // Size
          sizeClasses[size],
          className,
        )}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";
