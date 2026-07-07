/**
 * EgycotLogo — EGYCOT brand logo component using the real provided SVG asset.
 *
 * Uses the real `egycot-new-traced.svg` asset from `public/brand/egycot-logo.svg`.
 * The old generated/coded SVG has been replaced with this real asset.
 *
 * Brand identity:
 *   Arabic name:  إيجيكوت للتجارة الدولية
 *   English name: EGYCOT For International Trading
 *
 * The logo is rendered as an <img> tag pointing to the SVG asset.
 * Alt text: شعار إيجيكوت للتجارة الدولية
 */
"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

export const EGYCOT_NAME_AR = "إيجيكوت للتجارة الدولية";
export const EGYCOT_NAME_EN = "EGYCOT For International Trading";
export const EGYCOT_SHORT = "EGYCOT";

export interface EgycotLogoProps {
  /** Size of the logo mark in pixels (default 32). */
  size?: number;
  /** Show the EGYCOT text beside the logo mark. */
  showText?: boolean;
  /** Which text variant to show. */
  textVariant?: "ar" | "en" | "short" | "both";
  /** Additional className for the container. */
  className?: string;
  /** Compact mode — smaller text, single line (for topbar/sidebar). */
  compact?: boolean;
}

export function EgycotLogo({
  size = 32,
  showText = true,
  textVariant = "both",
  className,
  compact = false,
}: EgycotLogoProps) {
  return (
    <div className={cn("egycot-logo-container flex items-center gap-2", className)}>
      {/* Real EGYCOT logo — provided SVG asset */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/egycot-logo.svg"
        width={size}
        height={size}
        alt="شعار إيجيكوت للتجارة الدولية"
        className="shrink-0"
        aria-label="شعار إيجيكوت للتجارة الدولية"
      />

      {/* Text beside logo */}
      {showText && (
        <div className="flex flex-col min-w-0 leading-tight">
          {textVariant === "both" && (
            <>
              <span className={cn("font-heading font-bold text-navy truncate", compact ? "text-sm" : "text-sm")}>
                {EGYCOT_NAME_AR}
              </span>
              {!compact && (
                <span className="text-[10px] text-muted-foreground truncate" dir="ltr">
                  {EGYCOT_NAME_EN}
                </span>
              )}
            </>
          )}
          {textVariant === "ar" && (
            <span className={cn("font-heading font-bold text-navy truncate", compact ? "text-sm" : "text-sm")}>
              {EGYCOT_NAME_AR}
            </span>
          )}
          {textVariant === "en" && (
            <span className={cn("font-heading font-bold text-navy truncate", compact ? "text-xs" : "text-sm")} dir="ltr">
              {EGYCOT_NAME_EN}
            </span>
          )}
          {textVariant === "short" && (
            <span className={cn("font-heading font-bold text-navy", compact ? "text-sm" : "text-base")} dir="ltr">
              {EGYCOT_SHORT}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
