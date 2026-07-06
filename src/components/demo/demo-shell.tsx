/**
 * DemoShell — management-console-style shell for the stakeholder visual demo.
 *
 * Mirrors the layout of `src/components/shells/management-shell.tsx` exactly
 * (so the demo feels continuous with the approved reference screens), but:
 *   - Uses the demo topbar (with WORKING global search + notifications panel).
 *   - Uses the existing Sidebar component (already collapsible: clean dots
 *     when collapsed, no stray Arabic letters, RTL accent bar on active).
 *   - Renders the persistent DemoBanner above the topbar.
 *   - Has NO server-only imports, NO auth coupling, NO onSignOut server action.
 *
 * Updated 2026-07-06:
 *   - Added `persona` prop ("executive" | "accountant" | "data-entry").
 *   - Topbar now shows persona role label under the EGYCOT company branding.
 *   - Data-entry persona hides the sidebar entirely (task-hub mode).
 *
 * Layout (RTL):
 *   ┌────────────────────────────────────────────┐
 *   │  DemoBanner (sticky warning)               │
 *   ├────────────────────────────────────────────┤
 *   │  DemoTopbar (search, notifications, exit)  │
 *   ├──────────┬─────────────────────────────────┤
 *   │ Sidebar  │  Main content                   │
 *   │ (right,  │  (breadcrumb + children)        │
 *   │ collap-  │                                 │
 *   │  sible)  │                                 │
 *   └──────────┴─────────────────────────────────┘
 *
 * No Supabase writes. No real transaction logic. Synthetic fixtures only.
 */
"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { Sidebar } from "@/components/shells/sidebar";
import { DemoTopbar } from "@/components/demo/demo-topbar";
import { DemoBanner } from "@/components/demo/demo-banner";
import { DEMO_NAV_CATEGORIES } from "@/components/demo/demo-nav-config";
import {
  personaRoleLabel,
  type DemoPersona,
} from "@/lib/fixtures/demo-fixtures";

export interface DemoShellProps {
  /** Display name shown in topbar (e.g. "ERP-Yarn"). */
  userName: string;
  tenantLabel?: string;
  children: React.ReactNode;
  breadcrumbs?: ReadonlyArray<{ label: string; href?: string }>;
  /** Demo persona for topbar role display. Data-entry persona hides sidebar. */
  persona?: DemoPersona;
  /** Override the role label shown in topbar (defaults to persona label). */
  roleLabel?: string;
}

export function DemoShell({
  userName,
  tenantLabel = "إيجيكوت للتجارة الدولية",
  children,
  breadcrumbs,
  persona,
  roleLabel,
}: DemoShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = React.useState(false);
  const pathname = usePathname();
  const router = useRouter();

  // Data-entry persona: hide sidebar entirely (task-hub mode)
  const hideSidebar = persona === "data-entry";

  // Compute the role label to display in topbar
  const topbarRoleLabel = roleLabel ?? (persona ? personaRoleLabel(persona) : undefined);

  return (
    <div className="min-h-screen bg-background">
      <DemoBanner />
      <DemoTopbar
        userName={userName}
        tenantLabel={tenantLabel}
        roleLabel={topbarRoleLabel}
        onToggleSidebar={hideSidebar ? undefined : () => setMobileSidebarOpen((v) => !v)}
        sidebarCollapsed={hideSidebar ? true : sidebarCollapsed}
        onExitDemo={() => router.push("/login")}
      />

      <div className="flex">
        {/* Sidebar — hidden for data-entry persona */}
        {!hideSidebar && (
          <Sidebar
            categories={DEMO_NAV_CATEGORIES as unknown as React.ComponentProps<typeof Sidebar>["categories"]}
            collapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
            mobileOpen={mobileSidebarOpen}
            onCloseMobile={() => setMobileSidebarOpen(false)}
            currentPath={pathname}
          />
        )}

        <main
          role="main"
          className={cn(
            "flex-1 min-w-0",
            hideSidebar ? "" : sidebarCollapsed ? "lg:mr-16" : "lg:mr-64",
          )}
        >
          <div className="p-4 sm:p-6">
            {breadcrumbs && breadcrumbs.length > 0 && (
              <nav aria-label="مسار التنقل" className="mb-4">
                <ol className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <Link
                      href={persona === "data-entry" ? "/demo/data-entry" : "/demo"}
                      className="hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {persona === "data-entry" ? "مهام الإدخال" : "العرض التفاعلي"}
                    </Link>
                    <span aria-hidden="true">/</span>
                  </li>
                  {breadcrumbs.map((crumb, idx) => {
                    const last = idx === breadcrumbs.length - 1;
                    return (
                      <li key={idx} className="flex items-center gap-2">
                        {crumb.href && !last ? (
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
                        {!last && <span aria-hidden="true">/</span>}
                      </li>
                    );
                  })}
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
