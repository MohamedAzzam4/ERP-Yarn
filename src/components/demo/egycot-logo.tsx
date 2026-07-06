/**
 * EgycotLogo — EGYCOT-inspired coded emblem component.
 *
 * This is NOT the official EGYCOT logo. It is a coded SVG emblem inspired by
 * the EGYCOT brand identity (cotton outline, green stem, navy/blue corporate
 * colors). If a real vector logo is later provided, this component can be
 * replaced without touching the rest of the UI.
 *
 * Brand identity:
 *   Arabic name:  إيجيكوت للتجارة الدولية
 *   English name: EGYCOT For International Trading
 *   Primary navy:    #0b1f4d
 *   Primary blue:    #2f5ecb
 *   Cotton green:    #137a3f
 *   Soft cotton:     #dcefd8
 *
 * Animation:
 *   - Subtle stroke-dash movement on the fiber line (slow, hover-only)
 *   - Soft green glow pulse on the cotton boll (slow, hover-only)
 *   - All animation disabled under prefers-reduced-motion
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
    <div className={cn("flex items-center gap-2", className)}>
      {/* Logo mark — inline SVG cotton emblem */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="EGYCOT"
        className="egycot-logo-mark shrink-0"
      >
        {/* Cotton boll — rounded cloud-like shape (top of the cotton plant) */}
        <g className="egycot-cotton-boll">
          <circle cx="24" cy="16" r="6" fill="var(--color-cotton-soft)" stroke="var(--color-cotton-green)" strokeWidth="1.5" />
          <circle cx="18" cy="14" r="4.5" fill="var(--color-cotton-soft)" stroke="var(--color-cotton-green)" strokeWidth="1.5" />
          <circle cx="30" cy="14" r="4.5" fill="var(--color-cotton-soft)" stroke="var(--color-cotton-green)" strokeWidth="1.5" />
          <circle cx="15" cy="19" r="3.5" fill="var(--color-cotton-soft)" stroke="var(--color-cotton-green)" strokeWidth="1.5" />
          <circle cx="33" cy="19" r="3.5" fill="var(--color-cotton-soft)" stroke="var(--color-cotton-green)" strokeWidth="1.5" />
        </g>

        {/* Stem — green Y shape connecting boll to base */}
        <path
          d="M24 22 L24 30 M24 30 L20 36 M24 30 L28 36"
          stroke="var(--color-cotton-green)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />

        {/* Leaves — small green accents on the stem */}
        <path
          d="M24 26 Q20 25 18 27 Q20 28 24 27 Z"
          fill="var(--color-cotton-green)"
          opacity="0.8"
        />
        <path
          d="M24 26 Q28 25 30 27 Q28 28 24 27 Z"
          fill="var(--color-cotton-green)"
          opacity="0.8"
        />

        {/* Fiber line — subtle decorative curve at bottom (animated on hover) */}
        <path
          d="M10 40 Q24 36 38 40"
          stroke="var(--color-primary)"
          strokeWidth="1"
          strokeLinecap="round"
          fill="none"
          opacity="0.4"
          className="egycot-fiber-line"
        />
      </svg>

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
