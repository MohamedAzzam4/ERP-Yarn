/**
 * Topbar — management console top bar.
 *
 * Contract: docs/contracts/10_frontend_screen_contracts.md §5.2
 *   - Top bar with user/session area
 *   - Placeholder notification/refresh/search affordances only if contract-safe
 *   - Account menu
 *   - Current tenant label
 *
 * Contract: docs/contracts/02_design_system_and_ux_contract.md
 *   §Management Navigation (lines 405-407)
 *   - Quick search, notifications, refresh are navigation/read affordances only
 *   - Must never become client-side authorization shortcuts
 *
 * WP-01-04 scope: placeholder affordances only. Quick search, notifications,
 * and refresh are DISABLED (rendered as static placeholders) because the
 * contracted permission-filtered backends do not exist yet. Per Contract 10
 * §5.2 AI coding note: "If a current work package lacks the contracted
 * permission-filtered backend, show a disabled/static visual placeholder."
 */
"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";

export interface TopbarProps {
  userName: string;
  tenantLabel?: string;
  onSignOut?: () => void;
  onToggleSidebar?: () => void;
}

export function Topbar({ userName, tenantLabel, onSignOut, onToggleSidebar }: TopbarProps) {
  return (
    <header
      className="sticky top-0 z-20 border-b border-border bg-surface"
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
              className="min-h-[44px] min-w-[44px] lg:hidden"
            >
              ☰
            </Button>
          )}
          <div>
            <h1 className="text-heading-4 text-foreground">
              {tenantLabel ?? "ERP-Yarn"}
            </h1>
            <p className="text-sm text-muted-foreground">{userName}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Placeholder: Quick search — DISABLED (no backend yet) */}
          <button
            type="button"
            disabled
            aria-label="بحث سريع (غير متاح حالياً)"
            title="البحث السريع غير متاح حالياً"
            className="min-h-[44px] min-w-[44px] rounded p-2 text-muted-foreground opacity-50"
          >
            🔍
          </button>

          {/* Placeholder: Notifications — DISABLED (no backend yet) */}
          <button
            type="button"
            disabled
            aria-label="الإشعارات (غير متاح حالياً)"
            title="الإشعارات غير متاحة حالياً"
            className="min-h-[44px] min-w-[44px] rounded p-2 text-muted-foreground opacity-50"
          >
            🔔
          </button>

          {/* Placeholder: Manual refresh — DISABLED (no backend yet) */}
          <button
            type="button"
            disabled
            aria-label="تحديث (غير متاح حالياً)"
            title="التحديث اليدوي غير متاح حالياً"
            className="min-h-[44px] min-w-[44px] rounded p-2 text-muted-foreground opacity-50"
          >
            ↻
          </button>

          {onSignOut && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onSignOut}
              aria-label="تسجيل الخروج"
              className="min-h-[44px]"
            >
              خروج
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
