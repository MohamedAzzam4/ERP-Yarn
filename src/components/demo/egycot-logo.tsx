/**
 * EgycotLogo — EGYCOT-inspired coded emblem component.
 *
 * This is NOT the official EGYCOT logo. It is a coded SVG emblem inspired by
 * the EGYCOT brand identity (cotton boll with rounded lobes, "EGYCOT" text
 * inside, green Y stem). If a real vector logo is later provided, this
 * component can be replaced without touching the rest of the UI.
 *
 * Brand identity:
 *   Arabic name:  إيجيكوت للتجارة الدولية
 *   English name: EGYCOT For International Trading
 *   Primary navy:    #0b1f4d
 *   Primary blue:    #2f5ecb
 *   Cotton green:    #137a3f
 *   Soft cotton:     #dcefd8
 *
 * Animation (hover/focus only, reduced-motion respected):
 *   - Soft green glow halo around the cotton boll
 *   - Stroke highlight on the cotton outline
 *   - Very slight lift (scale 1.03) — not bouncy
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
      {/* Logo mark — inline SVG cotton emblem with EGYCOT text inside */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="EGYCOT — إيجيكوت للتجارة الدولية"
        className="egycot-logo-mark shrink-0"
        tabIndex={0}
      >
        {/* Cotton boll — 3 rounded lobes arranged in a circular cluster */}
        <g className="egycot-cotton-boll">
          {/* Top lobe */}
          <ellipse cx="50" cy="30" rx="16" ry="18" fill="var(--color-cotton-soft)" stroke="var(--color-cotton-green)" strokeWidth="2" />
          {/* Left lobe */}
          <ellipse cx="32" cy="44" rx="14" ry="16" fill="var(--color-cotton-soft)" stroke="var(--color-cotton-green)" strokeWidth="2" />
          {/* Right lobe */}
          <ellipse cx="68" cy="44" rx="14" ry="16" fill="var(--color-cotton-soft)" stroke="var(--color-cotton-green)" strokeWidth="2" />
          {/* Center lobe (slightly behind, fills the gap) */}
          <ellipse cx="50" cy="44" rx="15" ry="17" fill="var(--color-cotton-soft)" stroke="var(--color-cotton-green)" strokeWidth="2" />
        </g>

        {/* EGYCOT text — centered inside the cotton boll */}
        <text
          x="50"
          y="48"
          textAnchor="middle"
          fontFamily="var(--font-heading), Arial, sans-serif"
          fontSize="9"
          fontWeight="700"
          fill="var(--color-cotton-green)"
          className="egycot-logo-text"
        >
          EGYCOT
        </text>

        {/* Green Y stem — below the cotton boll */}
        <path
          d="M50 58 L50 72 M50 72 L42 82 M50 72 L58 82"
          stroke="var(--color-cotton-green)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />

        {/* Small leaves on the stem */}
        <path
          d="M50 66 Q44 64 42 68 Q45 70 50 68 Z"
          fill="var(--color-cotton-green)"
          opacity="0.85"
        />
        <path
          d="M50 66 Q56 64 58 68 Q55 70 50 68 Z"
          fill="var(--color-cotton-green)"
          opacity="0.85"
        />

        {/* Subtle fiber line at bottom (animated on hover) */}
        <path
          d="M30 88 Q50 84 70 88"
          stroke="var(--color-primary)"
          strokeWidth="1"
          strokeLinecap="round"
          fill="none"
          opacity="0.3"
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
