/**
 * Sidebar — collapsible management navigation.
 *
 * Contract: docs/contracts/02_design_system_and_ux_contract.md §Management Navigation
 * Contract: docs/contracts/10_frontend_screen_contracts.md §5.2
 *
 * DEC-075 polish:
 *   - Polished collapse toggle button (no longer a floating arrow).
 *     It sits inside the sidebar header rail, branded with primary color,
 *     has a clear 44x44 touch target, visible hover/focus state, and
 *     correct RTL chevron direction for collapsed/expanded states.
 *   - Active sidebar item is now strongly branded (blue left border,
 *     primary-tinted background, primary text) instead of a faint tint.
 *   - Sidebar header gets a subtle blue gradient strip so it reads as a
 *     branded surface rather than a plain white panel.
 */
"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import type { ManagementNavCategory } from "./nav-config";

// --- Inline SVG icons ---

/**
 * PanelCollapseIcon — a polished "collapse sidebar" icon (two chevrons
 * pointing toward the sidebar edge). In RTL the sidebar is on the right,
 * so "collapse" points right (>>) and "expand" points left (<<).
 */
function PanelCollapseIcon() {
  // In RTL, sidebar is on the right. Collapsed state (expand action)
  // shows chevrons pointing LEFT (toward screen center = open up space).
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="11 17 6 12 11 7" />
      <polyline points="18 17 13 12 18 7" />
    </svg>
  );
}

function PanelExpandIcon() {
  // Expanded state (collapse action) shows chevrons pointing RIGHT
  // (toward the right edge where the sidebar lives in RTL).
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="13 17 18 12 13 7" />
      <polyline points="6 17 11 12 6 7" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export interface SidebarProps {
  categories: ReadonlyArray<ManagementNavCategory>;
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  currentPath: string;
}

export function Sidebar({
  categories,
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onCloseMobile,
  currentPath,
}: SidebarProps) {
  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-overlay lg:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 right-0 z-40 flex flex-col border-l border-border bg-surface transition-all duration-200",
          collapsed ? "w-16" : "w-64",
          mobileOpen ? "translate-x-0" : "translate-x-full lg:translate-x-0",
        )}
        aria-label="التنقل الجانبي"
      >
        {/* Branded sidebar header — a single compact row that pairs the brand
            title with the collapse toggle, so there is no empty/awkward band.
            When expanded: shows brand mark + title + toggle. When collapsed:
            shows just the toggle (centered) so the rail stays tight. */}
        <div className="relative flex h-14 items-center gap-2 border-b border-border bg-gradient-to-l from-primary/8 to-transparent px-2">
          {/* Brand accent line on the leading edge of the sidebar header */}
          <span
            className="pointer-events-none absolute inset-y-0 right-0 w-1 bg-primary/40"
            aria-hidden="true"
          />
          {collapsed ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onToggleCollapse}
              aria-label={collapsed ? "توسيع القائمة الجانبية" : "طي القائمة الجانبية"}
              aria-expanded={!collapsed}
              title={collapsed ? "توسيع القائمة الجانبية" : "طي القائمة الجانبية"}
              data-sidebar-collapse-toggle
              className="mx-auto min-h-[44px] min-w-[44px] rounded-lg bg-transparent p-2 text-primary/70 transition-colors duration-200 hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
            >
              <PanelCollapseIcon />
            </Button>
          ) : (
            <>
              <div className="flex min-w-0 flex-1 items-center gap-2 pr-1">
                <div
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-primary to-primary/70 font-heading text-xs font-bold text-primary-foreground"
                  aria-hidden="true"
                >
                  E
                </div>
                <span className="truncate text-sm font-bold text-primary font-heading">القائمة</span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onToggleCollapse}
                aria-label={collapsed ? "توسيع القائمة الجانبية" : "طي القائمة الجانبية"}
                aria-expanded={!collapsed}
                title={collapsed ? "توسيع القائمة الجانبية" : "طي القائمة الجانبية"}
                data-sidebar-collapse-toggle
                className="min-h-[44px] min-w-[44px] shrink-0 rounded-lg bg-transparent p-2 text-primary/70 transition-colors duration-200 hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
              >
                <PanelExpandIcon />
              </Button>
            </>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="التنقل الرئيسي">
          <ul className="space-y-1">
            {categories.map((category) => (
              <li key={category.id}>
                <SidebarCategory
                  category={category}
                  collapsed={collapsed}
                  currentPath={currentPath}
                />
              </li>
            ))}
          </ul>
        </nav>
      </aside>
    </>
  );
}

interface SidebarCategoryProps {
  category: ManagementNavCategory;
  collapsed: boolean;
  currentPath: string;
}

function SidebarCategory({ category, collapsed, currentPath }: SidebarCategoryProps) {
  const [expanded, setExpanded] = React.useState(true);

  if (collapsed) {
    // Collapsed mode: render nav items as compact dot marks with accessible
    // labels. No visible text labels (no stray single Arabic letters).
    // Each item is a tappable dot; the active item gets a filled primary dot,
    // inactive items get a muted outline dot. aria-label + title preserve
    // accessibility for screen readers and hover tooltips.
    return (
      <ul className="space-y-1 py-1" aria-label={category.labelAr}>
        {category.items.map((item) => {
          const isActive = currentPath === item.href;
          return (
            <li key={item.id} className="relative">
              <Link
                href={item.href}
                aria-label={item.labelAr}
                title={item.labelAr}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isActive
                    ? "bg-primary/10"
                    : "hover:bg-muted",
                )}
              >
                <span
                  className={cn(
                    "block h-2 w-2 rounded-full transition-colors duration-200",
                    isActive ? "bg-primary" : "bg-muted-foreground/40",
                  )}
                  aria-hidden="true"
                />
              </Link>
              {/* Branded active indicator: right-edge accent bar (RTL). */}
              {isActive && (
                <span
                  className="pointer-events-none absolute right-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-full bg-primary"
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex min-h-[44px] w-full items-center justify-between rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span>{category.labelAr}</span>
        <span className={cn("transition-transform", expanded ? "rotate-0" : "-rotate-90")}>
          <ChevronDownIcon />
        </span>
      </button>
      {expanded && (
        <ul className="space-y-0.5 py-1">
          {category.items.map((item) => {
            const isActive = currentPath === item.href;
            return (
              <li key={item.id} className="relative">
                <Link
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex min-h-[44px] items-center rounded-lg px-3 py-2 text-sm transition-colors duration-200",
                    isActive
                      ? "bg-primary/10 font-bold text-primary ring-1 ring-inset ring-primary/20"
                      : "text-foreground hover:bg-muted",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                >
                  <span className="relative">{item.labelAr}</span>
                </Link>
                {/* Branded active indicator: a right-edge accent bar (RTL:
                    sidebar is on the right, so the accent sits on the
                    right/leading edge of the active item). */}
                {isActive && (
                  <span
                    className="pointer-events-none absolute right-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-full bg-primary"
                    aria-hidden="true"
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
