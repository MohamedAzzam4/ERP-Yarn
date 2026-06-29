/**
 * Management Console Shell.
 *
 * Contract: docs/contracts/02_design_system_and_ux_contract.md
 *   §Management Console Mode (lines 335-354)
 *   §Management Navigation (lines 389-407)
 *   - Owner and Accountant share the shell, sidebar, page hierarchy
 *   - Differences come from backend-enforced permissions
 *   - Sidebar supports whole-sidebar collapse + independent category collapse
 *
 * Contract: docs/contracts/10_frontend_screen_contracts.md §5.2
 *   - Permission-filtered grouped RTL sidebar
 *   - Always-visible sidebar collapse toggle
 *   - Independently collapsible sidebar categories
 *   - Top bar with user/session, notifications, refresh, account menu
 *   - Breadcrumb/context
 *
 * Contract: docs/contracts/14_coding_agent_instructions.md
 *   "permission-hidden destinations must not render or be discoverable"
 */
"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import type { ManagementNavCategory } from "./nav-config";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

// ---------------------------------------------------------------------------
// ManagementShell — the management console layout.
// ---------------------------------------------------------------------------

export interface ManagementShellProps {
  /** Authenticated user's display name. */
  userName: string;
  /** Tenant label for display. */
  tenantLabel?: string;
  /** Role-filtered navigation categories. */
  navCategories: ReadonlyArray<ManagementNavCategory>;
  /** Sign-out action. */
  onSignOut?: () => void;
  /** Page content. */
  children: React.ReactNode;
  /** Breadcrumb items (optional). */
  breadcrumbs?: ReadonlyArray<{ label: string; href?: string }>;
}

/**
 * Management Console Shell.
 *
 * Layout (RTL):
 *   ┌──────────────────────────────────────────┐
 *   │  Topbar (user, tenant, refresh, notif)   │
 *   ├──────────┬───────────────────────────────┤
 *   │ Sidebar  │  Main content                 │
 *   │ (collap- │  (breadcrumb + children)      │
 *   │  sible)  │                               │
 *   │          │                               │
 *   └──────────┴───────────────────────────────┘
 *
 * Responsive:
 *   - Desktop: sidebar visible, main content fills remaining width
 *   - Tablet: sidebar collapsible (toggle), main content adapts
 *   - Phone: sidebar hidden by default, toggle opens overlay
 *
 * The sidebar supports two collapse behaviors (Contract 02 line 398-401):
 *   1. Whole-sidebar collapse/expand via always-visible toggle
 *   2. Independent expand/collapse for grouped navigation categories
 */
export function ManagementShell({
  userName,
  tenantLabel,
  navCategories,
  onSignOut,
  children,
  breadcrumbs,
}: ManagementShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = React.useState(false);
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-background">
      <Topbar
        userName={userName}
        tenantLabel={tenantLabel}
        onSignOut={onSignOut}
        onToggleSidebar={() => setMobileSidebarOpen((v) => !v)}
      />

      <div className="flex">
        {/* Sidebar — desktop: persistent, tablet/phone: overlay */}
        <Sidebar
          categories={navCategories}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
          mobileOpen={mobileSidebarOpen}
          onCloseMobile={() => setMobileSidebarOpen(false)}
          currentPath={pathname}
        />

        {/* Main content area */}
        <main
          role="main"
          className={cn(
            "flex-1 min-w-0",
            sidebarCollapsed ? "lg:mr-16" : "lg:mr-64",
          )}
        >
          <div className="p-6">
            {breadcrumbs && breadcrumbs.length > 0 && (
              <nav aria-label="مسار التنقل" className="mb-4">
                <ol className="flex items-center gap-2 text-sm text-muted-foreground">
                  {breadcrumbs.map((crumb, idx) => (
                    <li key={idx} className="flex items-center gap-2">
                      {crumb.href ? (
                        <Link
                          href={crumb.href}
                          className="hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {crumb.label}
                        </Link>
                      ) : (
                        <span className="text-foreground" aria-current="page">
                          {crumb.label}
                        </span>
                      )}
                      {idx < breadcrumbs.length - 1 && (
                        <span className="text-muted-foreground" aria-hidden="true">
                          /
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              </nav>
            )}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
