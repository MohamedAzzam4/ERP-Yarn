/**
 * Sidebar — collapsible management navigation.
 *
 * Contract: docs/contracts/02_design_system_and_ux_contract.md
 *   §Management Navigation (lines 389-407)
 *   - Consistent sidebar using approved Arabic terminology
 *   - Two separate collapse behaviors:
 *     1. Whole-sidebar collapse/expand via always-visible toggle
 *     2. Independent expand/collapse for grouped navigation categories
 *   - Permission-hidden destinations must not render or be discoverable
 *
 * Contract: docs/contracts/10_frontend_screen_contracts.md §5.2
 *   - Permission-filtered grouped RTL sidebar
 *   - Always-visible sidebar collapse toggle
 *   - Independently collapsible sidebar categories
 */
"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import type { ManagementNavCategory } from "./nav-config";

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
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-overlay lg:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 right-0 z-40 flex flex-col border-l border-border bg-surface transition-transform",
          collapsed ? "w-16" : "w-64",
          mobileOpen ? "translate-x-0" : "translate-x-full lg:translate-x-0",
        )}
        aria-label="التنقل الجانبي"
      >
        {/* Always-visible whole-sidebar collapse toggle */}
        <div className="flex items-center justify-center border-b border-border p-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "توسيع القائمة" : "طي القائمة"}
            aria-expanded={!collapsed}
            className="min-h-[44px] min-w-[44px]"
          >
            {collapsed ? "◀" : "▶"}
          </Button>
        </div>

        <nav className="flex-1 overflow-y-auto p-2" aria-label="التنقل الرئيسي">
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

// --- Sidebar category with independent collapse ---

interface SidebarCategoryProps {
  category: ManagementNavCategory;
  collapsed: boolean;
  currentPath: string;
}

function SidebarCategory({ category, collapsed, currentPath }: SidebarCategoryProps) {
  const [expanded, setExpanded] = React.useState(true);

  if (collapsed) {
    // When the whole sidebar is collapsed, show only the first letter of
    // the category as a placeholder. Clicking does nothing (the user must
    // expand the sidebar first to see items).
    return (
      <div
        className="flex min-h-[44px] items-center justify-center rounded p-2 text-sm font-medium text-muted-foreground"
        title={category.labelAr}
        aria-label={category.labelAr}
      >
        {category.labelAr.charAt(0)}
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex min-h-[44px] w-full items-center justify-between rounded px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span>{category.labelAr}</span>
        <span aria-hidden="true">{expanded ? "▼" : "◀"}</span>
      </button>
      {expanded && (
        <ul className="space-y-1 py-1">
          {category.items.map((item) => {
            const isActive = currentPath === item.href;
            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex min-h-[44px] items-center rounded px-3 py-2 text-sm",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground hover:bg-muted",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                >
                  {item.labelAr}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
