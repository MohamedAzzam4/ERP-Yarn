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

export interface DemoShellProps {
  userName: string;
  tenantLabel?: string;
  children: React.ReactNode;
  breadcrumbs?: ReadonlyArray<{ label: string; href?: string }>;
}

export function DemoShell({
  userName,
  tenantLabel = "ERP-Yarn — عرض تفاعلي",
  children,
  breadcrumbs,
}: DemoShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = React.useState(false);
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div className="min-h-screen bg-background">
      <DemoBanner />
      <DemoTopbar
        userName={userName}
        tenantLabel={tenantLabel}
        onToggleSidebar={() => setMobileSidebarOpen((v) => !v)}
        sidebarCollapsed={sidebarCollapsed}
        onExitDemo={() => router.push("/login")}
      />

      <div className="flex">
        {/* Sidebar — existing component, already collapsible with clean dots.
            We cast DEMO_NAV_CATEGORIES to the Sidebar's prop type because
            DemoNavCategory is structurally identical to ManagementNavCategory
            (id, labelAr, items[]). This avoids touching the original
            nav-config.ts (which is server-only and test-pinned). */}
        <Sidebar
          categories={DEMO_NAV_CATEGORIES as unknown as React.ComponentProps<typeof Sidebar>["categories"]}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
          mobileOpen={mobileSidebarOpen}
          onCloseMobile={() => setMobileSidebarOpen(false)}
          currentPath={pathname}
        />

        <main
          role="main"
          className={cn(
            "flex-1 min-w-0",
            sidebarCollapsed ? "lg:mr-16" : "lg:mr-64",
          )}
        >
          <div className="p-4 sm:p-6">
            {breadcrumbs && breadcrumbs.length > 0 && (
              <nav aria-label="مسار التنقل" className="mb-4">
                <ol className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <Link
                      href="/demo"
                      className="hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      العرض التفاعلي
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
