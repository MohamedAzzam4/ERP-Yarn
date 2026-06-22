import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * BidiValue — shared LTR-isolation component for codes, batch/lot codes,
 * emails, phone numbers, URLs, dates, quantities, money, numeric cells,
 * and technical identifiers. Mirrors the contract requirement in
 * /docs/contracts/02_design_system_and_ux_contract.md#local-ltr-isolation.
 */
export interface BidiValueProps extends React.HTMLAttributes<HTMLSpanElement> {
  children: React.ReactNode;
  /** Visual size of the isolated value. */
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  /** When true, render as a tabular numeric cell (right-aligned, tabular-nums). */
  numeric?: boolean;
}

const sizeClasses: Record<NonNullable<BidiValueProps["size"]>, string> = {
  xs: "text-xs",
  sm: "text-sm",
  md: "text-base",
  lg: "text-lg",
  xl: "text-2xl",
};

export function BidiValue({
  children,
  className,
  size = "sm",
  numeric = false,
  ...rest
}: BidiValueProps) {
  return (
    <bdi
      dir="ltr"
      className={cn(
        "inline-block unicode-bidi-isolate align-middle",
        sizeClasses[size],
        numeric && "font-variant-numeric tabular-nums",
        className,
      )}
      {...(rest as React.HTMLAttributes<HTMLElement>)}
    >
      {children}
    </bdi>
  );
}
