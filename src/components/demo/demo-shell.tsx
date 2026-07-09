/**
 * DemoShell — management-console-style shell for the stakeholder visual demo.
 *
 * Updated 2026-07-07:
 *   - Wraps content in DemoPersonaProvider for centralized persona state
 *   - Removed breadcrumbs (cleaner, less clutter)
 *   - Persona read from context (no hardcoded roleLabel per page)
 *   - Data-entry persona hides sidebar entirely (task-hub mode)
 */
"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { Sidebar } from "@/components/shells/sidebar";
import { DemoTopbar } from "@/components/demo/demo-topbar";
import { DemoBanner } from "@/components/demo/demo-banner";
import { DEMO_NAV_CATEGORIES } from "@/components/demo/demo-nav-config";
import {
  DemoPersonaProvider,
  useDemoPersona,
} from "@/components/demo/demo-persona-context";

export interface DemoShellProps {
  children: React.ReactNode;
  /** Override the persona for this page (rarely needed — context is the default). */
  forcePersona?: "executive" | "accountant" | "data-entry";
}

function DemoShellInner({ children, forcePersona }: DemoShellProps) {
  const { persona: contextPersona, roleLabel } = useDemoPersona();
  const persona = forcePersona ?? contextPersona;

  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = React.useState(false);
  const router = useRouter();

  const hideSidebar = persona === "data-entry";

  return (
    <div className="min-h-screen bg-background">
      <DemoBanner />
      <DemoTopbar
        userName="إيجيكوت للتجارة الدولية"
        roleLabel={roleLabel}
        onToggleSidebar={hideSidebar ? undefined : () => setMobileSidebarOpen((v) => !v)}
        sidebarCollapsed={hideSidebar ? true : sidebarCollapsed}
        onExitDemo={() => router.push("/login")}
      />

      <div className="flex">
        {!hideSidebar && (
          <Sidebar
            categories={DEMO_NAV_CATEGORIES as unknown as React.ComponentProps<typeof Sidebar>["categories"]}
            collapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
            mobileOpen={mobileSidebarOpen}
            onCloseMobile={() => setMobileSidebarOpen(false)}
            currentPath={typeof window !== "undefined" ? window.location.pathname : ""}
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
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

export function DemoShell({ children, forcePersona }: DemoShellProps) {
  return (
    <DemoPersonaProvider>
      <DemoShellInner forcePersona={forcePersona}>{children}</DemoShellInner>
    </DemoPersonaProvider>
  );
}
