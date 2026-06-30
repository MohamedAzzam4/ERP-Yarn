/**
 * Topbar — management console top bar.
 *
 * Contract: docs/contracts/10_frontend_screen_contracts.md §5.2
 * Contract: docs/contracts/02_design_system_and_ux_contract.md
 *   §Management Navigation (lines 405-407)
 *
 * WP-01-04/05-07: placeholder affordances only (DISABLED). Quick search,
 * notifications, and refresh are disabled because the contracted
 * permission-filtered backends do not exist yet. Per Contract 10 §5.2
 * AI coding note: show a disabled/static visual placeholder.
 */
"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";

// --- Inline SVG icons (no emoji dependency) ---

function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

export interface TopbarProps {
  userName: string;
  tenantLabel?: string;
  onSignOut?: () => void;
  onToggleSidebar?: () => void;
}

export function Topbar({ userName, tenantLabel, onSignOut, onToggleSidebar }: TopbarProps) {
  return (
    <header
      className="sticky top-0 z-20 border-b border-border bg-gradient-to-l from-primary/5 via-surface/95 to-surface/95 backdrop-blur-sm"
      role="banner"
    >
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-3">
          {onToggleSidebar && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onToggleSidebar}
              aria-label="فتح القائمة الجانبية"
              className="min-h-[44px] min-w-[44px] p-2 lg:hidden"
            >
              <MenuIcon />
            </Button>
          )}
          {/* Branded logo mark — small blue gradient square with "E" glyph */}
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/70 font-heading text-base font-bold text-primary-foreground shadow-sm"
            aria-hidden="true"
          >
            E
          </div>
          <div className="flex flex-col">
            <h1 className="text-heading-4 font-bold text-primary leading-tight">
              {tenantLabel ?? "ERP-Yarn"}
            </h1>
            <p className="text-xs text-muted-foreground">{userName}</p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {/* Placeholder: Quick search — DISABLED */}
          <button
            type="button"
            disabled
            aria-label="بحث سريع (غير متاح حالياً)"
            title="البحث السريع غير متاح حالياً"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-2 text-muted-foreground opacity-40 transition-colors hover:bg-muted"
          >
            <SearchIcon />
          </button>

          {/* Placeholder: Notifications — DISABLED */}
          <button
            type="button"
            disabled
            aria-label="الإشعارات (غير متاح حالياً)"
            title="الإشعارات غير متاحة حالياً"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-2 text-muted-foreground opacity-40 transition-colors hover:bg-muted"
          >
            <BellIcon />
          </button>

          {/* Placeholder: Manual refresh — DISABLED */}
          <button
            type="button"
            disabled
            aria-label="تحديث (غير متاح حالياً)"
            title="التحديث اليدوي غير متاح حالياً"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-2 text-muted-foreground opacity-40 transition-colors hover:bg-muted"
          >
            <RefreshIcon />
          </button>

          {onSignOut && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onSignOut}
              aria-label="تسجيل الخروج"
              className="min-h-[44px] mr-2"
            >
              خروج
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
