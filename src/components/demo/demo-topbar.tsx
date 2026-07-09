/**
 * Demo Topbar — management-console top bar for the stakeholder visual demo.
 *
 * Differences from the production Topbar (`src/components/shells/topbar.tsx`):
 *   - Quick global search is ENABLED (client-side filter over DEMO_SEARCH_ENTRIES).
 *   - Notifications button opens a panel (client-side, synthetic data).
 *   - Refresh button shows a brief "تم التحديث" pulse — no real network.
 *
 * The production Topbar stays untouched (its buttons remain DISABLED because
 * the contracted backends don't exist yet). This file is demo-only.
 *
 * Layout matches the production topbar exactly so the demo feels continuous:
 * sticky top, blue gradient, branded "E" mark, RTL right-padding reserves
 * space for the sidebar (collapsed = 64px, expanded = 256px) so the title
 * never slides under the sidebar.
 */
"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { LtrValue } from "@/components/ui/ltr-value";
import { EgycotLogo } from "@/components/demo/egycot-logo";
import {
  DEMO_NOTIFICATIONS,
  DEMO_SEARCH_ENTRIES,
  type DemoNotification,
} from "@/lib/fixtures/demo-fixtures";

// --- Inline SVG icons (no emoji, no Lucide dependency for SSR safety) ---

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

function ExitIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function severityDot(sev: DemoNotification["severity"]): string {
  switch (sev) {
    case "danger":
      return "bg-danger";
    case "warning":
      return "bg-warning";
    case "success":
      return "bg-success";
    case "info":
    default:
      return "bg-info";
  }
}

// ---------------------------------------------------------------------------
// DemoSearchBox — global quick-search.
//
// Behavior:
//   - Filters DEMO_SEARCH_ENTRIES by Arabic label or Latin keyword,
//     case-insensitive, with diacritics kept as-is.
//   - Keyboard: ArrowDown/ArrowUp to move highlight, Enter to navigate,
//     Escape to close. First result is auto-highlighted when results appear.
//   - Clicking a result navigates via next/router and clears the box.
//   - The input is LTR-isolated because it can hold Latin codes (e.g. "PO-")
//     mixed with Arabic text; <bdi dir="ltr"> keeps the cursor neutral.
//   - On blur we delay closing so a click on a result registers first.
// ---------------------------------------------------------------------------

interface SearchHit {
  labelAr: string;
  href: string;
  groupAr: string;
}

function DemoSearchBox() {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [highlight, setHighlight] = React.useState(0);
  const boxRef = React.useRef<HTMLDivElement | null>(null);

  const hits: SearchHit[] = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return DEMO_SEARCH_ENTRIES.filter((e) => {
      const inLabel = e.labelAr.toLowerCase().includes(q);
      const inGroup = e.groupAr.toLowerCase().includes(q);
      const inKw = e.keywords.some((k) => k.toLowerCase().includes(q));
      return inLabel || inGroup || inKw;
    }).slice(0, 8);
  }, [query]);

  // Keep highlight in range when hits shrink (e.g. user types more chars).
  // Derived from render state — no setState-in-effect.
  const safeHighlight = hits.length === 0 ? 0 : Math.min(highlight, hits.length - 1);

  // Close on outside click.
  React.useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!boxRef.current) return;
      if (!boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const go = (href: string) => {
    setQuery("");
    setHighlight(0);
    setOpen(false);
    router.push(href);
  };

  return (
    <div ref={boxRef} className="relative hidden md:block">
      <div className="relative">
        <span
          className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground"
          aria-hidden="true"
        >
          <SearchIcon />
        </span>
        <input
          type="text"
          dir="ltr"
          inputMode="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlight(0);
            setOpen(true);
          }}
          onFocus={() => query && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              if (hits.length > 0) {
                setOpen(true);
                setHighlight((h) => (h + 1) % hits.length);
              }
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              if (hits.length > 0) {
                setOpen(true);
                setHighlight((h) => (h - 1 + hits.length) % hits.length);
              }
            } else if (e.key === "Enter") {
              if (open && hits[safeHighlight]) {
                e.preventDefault();
                go(hits[safeHighlight]!.href);
              }
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder="بحث سريع... (مثال: مراجعات، PO-, مخزون)"
          aria-label="بحث سريع"
          aria-controls="demo-search-results"
          aria-autocomplete="list"
          className="w-72 min-h-[40px] rounded-lg border border-border bg-surface/90 px-3 py-1.5 pr-9 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {open && hits.length > 0 && (
        <ul
          id="demo-search-results"
          role="listbox"
          aria-label="نتائج البحث"
          className="absolute right-0 left-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
        >
          {hits.map((h, i) => (
            <li key={h.href} role="option" aria-selected={i === safeHighlight}>
              <button
                type="button"
                onMouseEnter={() => setHighlight(i)}
                onClick={() => go(h.href)}
                className={cn(
                  "flex w-full items-center justify-between gap-3 px-3 py-2 text-right text-sm transition-colors",
                  i === safeHighlight ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted",
                )}
              >
                <span className="font-medium">{h.labelAr}</span>
                <span className="text-[10px] text-muted-foreground">{h.groupAr}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DemoNotificationsButton — opens a panel with synthetic notifications.
// ---------------------------------------------------------------------------

function DemoNotificationsButton() {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const unread = DEMO_NOTIFICATIONS.filter((n) => !n.read).length;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "إغلاق الإشعارات" : "فتح الإشعارات"}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <BellIcon />
        {unread > 0 && (
          <span
            className="absolute left-1 top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-danger-foreground"
            aria-hidden="true"
          >
            <LtrValue>{unread}</LtrValue>
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="الإشعارات"
          className="absolute left-0 top-full z-50 mt-1 w-80 overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-border bg-muted/60 px-3 py-2">
            <span className="text-sm font-semibold text-foreground">الإشعارات</span>
            <span className="text-xs text-muted-foreground" dir="ltr">
              <LtrValue>{DEMO_NOTIFICATIONS.length}</LtrValue> إجمالي
            </span>
          </div>
          <ul className="max-h-80 overflow-y-auto">
            {DEMO_NOTIFICATIONS.map((n) => (
              <li
                key={n.id}
                className={cn(
                  "border-b border-border px-3 py-2.5 last:border-b-0",
                  n.read ? "bg-surface" : "bg-primary/5",
                )}
              >
                <div className="mb-0.5 flex items-center gap-2">
                  <span className={cn("inline-block h-2 w-2 rounded-full", severityDot(n.severity))} aria-hidden="true" />
                  <span className="text-sm font-medium text-foreground">{n.titleAr}</span>
                  {!n.read && (
                    <span className="mr-auto rounded-sm bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                      جديد
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{n.bodyAr}</p>
                <p className="mt-1 text-[10px] text-muted-foreground" dir="ltr">
                  <LtrValue>{n.date}</LtrValue>
                </p>
              </li>
            ))}
          </ul>
          <Link
            href="/demo/owner/activity"
            onClick={() => setOpen(false)}
            className="block border-t border-border bg-muted/40 px-3 py-2 text-center text-xs font-medium text-primary hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            عرض كل النشاطات
          </Link>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DemoRefreshButton — shows a brief "تم التحديث" pulse. No network call.
// ---------------------------------------------------------------------------

function DemoRefreshButton() {
  const [refreshing, setRefreshing] = React.useState(false);
  const [done, setDone] = React.useState(false);

  const onClick = () => {
    if (refreshing) return;
    setRefreshing(true);
    setDone(false);
    window.setTimeout(() => {
      setRefreshing(false);
      setDone(true);
      window.setTimeout(() => setDone(false), 1800);
    }, 700);
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={refreshing}
      aria-label={refreshing ? "جاري التحديث" : done ? "تم التحديث" : "تحديث البيانات"}
      className="relative flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
    >
      <span className={cn(refreshing ? "animate-spin" : "")}>
        <RefreshIcon />
      </span>
      {done && (
        <span
          className="pointer-events-none absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[10px] font-medium text-background shadow-md"
          role="status"
        >
          تم التحديث
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// DemoTopbar — main exported component.
// ---------------------------------------------------------------------------

export interface DemoTopbarProps {
  userName: string;
  tenantLabel?: string;
  onToggleSidebar?: () => void;
  sidebarCollapsed?: boolean;
  onExitDemo?: () => void;
  /** Role label shown under the title in the topbar (e.g. "المدير المالي"). */
  roleLabel?: string;
}

export function DemoTopbar({
  userName,
  tenantLabel,
  onToggleSidebar,
  sidebarCollapsed,
  onExitDemo,
  roleLabel,
}: DemoTopbarProps) {
  return (
    <header
      className={cn(
        "sticky top-0 z-20 border-b border-border bg-gradient-to-l from-primary/8 via-surface/95 to-surface/95 backdrop-blur-sm",
        sidebarCollapsed === undefined ? "" : sidebarCollapsed ? "lg:pr-16" : "lg:pr-64",
      )}
      role="banner"
    >
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        {/* Brand area: EGYCOT logo only (no company name text) */}
        <div className="flex min-w-0 items-center gap-3">
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
          <Link
            href="/demo"
            className="flex shrink-0 items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
            aria-label="الصفحة الرئيسية — إيجيكوت للتجارة الدولية"
          >
            <EgycotLogo size={32} showText={false} />
          </Link>
        </div>

        {/* Persona block: current user/persona name + role (with avatar icon) */}
        <div className="flex min-w-0 items-center gap-2">
          {/* Avatar/persona icon */}
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>
          {/* Persona name + role */}
          <div className="hidden flex-col text-left sm:flex">
            <span className="truncate text-xs font-medium text-foreground">
              {roleLabel ?? userName}
            </span>
            {roleLabel && (
              <span className="truncate text-[10px] text-muted-foreground">
                {roleLabel}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <DemoSearchBox />
          <DemoNotificationsButton />
          <DemoRefreshButton />
          {onExitDemo && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onExitDemo}
              aria-label="خروج من العرض التفاعلي"
              className="min-h-[44px] mr-1"
            >
              <ExitIcon />
              <span className="mr-1">خروج</span>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
