/**
 * Sidebar — collapsible management navigation.
 *
 * Contract: docs/contracts/02_design_system_and_ux_contract.md §Management Navigation
 * Contract: docs/contracts/10_frontend_screen_contracts.md §5.2
 */
"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import type { ManagementNavCategory } from "./nav-config";

// --- Inline SVG icons ---

function ChevronRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
        {/* Collapse toggle */}
        <div className="flex items-center justify-center border-b border-border py-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "توسيع القائمة" : "طي القائمة"}
            aria-expanded={!collapsed}
            className="min-h-[44px] min-w-[44px] p-2 text-muted-foreground hover:text-foreground"
          >
            {collapsed ? <ChevronLeftIcon /> : <ChevronRightIcon />}
          </Button>
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
    return (
      <div
        className="flex min-h-[44px] items-center justify-center rounded-lg py-2 text-xs font-medium text-muted-foreground"
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
        className="flex min-h-[40px] w-full items-center justify-between rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
              <li key={item.id}>
                <Link
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex min-h-[44px] items-center rounded-lg px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-primary/10 font-medium text-primary"
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
