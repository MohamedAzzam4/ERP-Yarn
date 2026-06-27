/**
 * Container — RTL-safe layout primitive.
 *
 * Contract: docs/contracts/02_design_system_and_ux_contract.md
 *   - Worker Task Mode supports 360px and above.
 *   - Management Console is desktop-first and tablet-supported.
 *   - Uses logical properties (no left/right assumptions).
 *
 * Provides responsive max-width container with RTL-safe padding.
 */

import * as React from "react";
import { cn } from "@/lib/cn";

export interface ContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Maximum width preset. */
  size?: "sm" | "md" | "lg" | "xl" | "full";
}

const sizeClasses = {
  sm: "max-w-2xl",
  md: "max-w-4xl",
  lg: "max-w-6xl",
  xl: "max-w-7xl",
  full: "max-w-full",
} as const;

/**
 * RTL-safe responsive container.
 *
 * Uses `px-4` (logical padding-inline) not `pl-4 pr-4`.
 * Responsive: works from 360px upward.
 */
export const Container = React.forwardRef<HTMLDivElement, ContainerProps>(
  ({ className, size = "lg", ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "mx-auto w-full px-4",
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  ),
);
Container.displayName = "Container";
