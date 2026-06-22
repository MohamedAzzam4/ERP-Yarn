import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { ChevronLeft, Factory, LayoutGrid, RotateCcw } from "lucide-react";
import { DemoBanner } from "@/components/shared/DemoBanner";
import { RoleSwitcher } from "@/components/shared/RoleSwitcher";
import { Button } from "@/components/ui/button";
import { useDemoStore } from "@/store/DemoStoreContext";
import { ROUTES, ROUTE_GROUPS } from "@/routes";
import { ROLES } from "@/types";
import { canManageUsers } from "@/lib/permissions";
import { cn } from "@/lib/utils";

/**
 * ManagementShell — shared shell for Owner + Accountant. Differences come
 * from route visibility and field redaction, not a separate visual system.
 */
export function ManagementShell() {
  const { state, reset } = useDemoStore();
  const location = useLocation();
  const role = state.currentRole;
  const roleInfo = ROLES.find((r) => r.id === role)!;

  // Group routes by section, filtered by role.
  const visibleRoutes = ROUTES.filter(
    (r) => r.roles.includes(role) && r.group !== "access" && !r.path.includes(":"),
  );

  // For Owner-only screens, hide Users from Accountant.
  const visibleRoutesFiltered = visibleRoutes.filter((r) => {
    if (r.path === "/admin/users") return canManageUsers(role);
    return true;
  });

  const groupsFiltered = Array.from(
    new Set(visibleRoutesFiltered.map((r) => r.group)),
  ) as (keyof typeof ROUTE_GROUPS)[];

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <DemoBanner />
      <header className="flex items-center justify-between gap-3 border-b border-border bg-sidebar px-4 py-3 text-sidebar-foreground">
        <div className="flex items-center gap-2">
          <Factory className="h-6 w-6" aria-hidden />
          <span className="font-heading text-base font-bold">عرض ERP التفاعلي</span>
          <span className="ms-2 hidden text-xs text-sidebar-foreground/70 sm:inline">
            Quick Interactive ERP Showcase
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/all-screens"
            className="hidden items-center gap-1 rounded-md border border-sidebar-foreground/30 px-3 py-1.5 text-xs font-medium text-sidebar-foreground hover:bg-sidebar-foreground/10 sm:inline-flex"
          >
            <LayoutGrid className="h-3 w-3" aria-hidden />
            عرض جميع الشاشات
          </Link>
          <RoleSwitcher />
        </div>
      </header>
      <div className="border-b border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
        <span>الدور الحالي: </span>
        <span className="font-medium text-foreground">{roleInfo.labelAr}</span>
        <span> — </span>
        <span dir="rtl">{roleInfo.descriptionAr}</span>
      </div>
      <div className="flex flex-1">
        <nav
          aria-label="التنقل الإداري"
          className="hidden w-60 shrink-0 overflow-y-auto border-e border-border bg-surface px-3 py-4 md:block"
        >
          {groupsFiltered.map((groupKey) => (
            <div key={groupKey} className="mb-4">
              <p className="mb-1 px-2 text-xs font-semibold uppercase text-muted-foreground">
                {ROUTE_GROUPS[groupKey]}
              </p>
              <ul className="space-y-0.5">
                {visibleRoutesFiltered
                  .filter((r) => r.group === groupKey)
                  .map((r) => (
                    <li key={r.path}>
                      <NavLink
                        to={r.path}
                        end
                        className={({ isActive }) =>
                          cn(
                            "block rounded-md px-3 py-1.5 text-sm",
                            isActive
                              ? "bg-accent/10 font-medium text-accent"
                              : "text-foreground hover:bg-muted",
                          )
                        }
                      >
                        {r.labelAr}
                      </NavLink>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
          <div className="mt-4 space-y-2 border-t border-border pt-4">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                if (window.confirm("سيتم استعادة البيانات التجريبية الأصلية. متابعة؟")) {
                  reset();
                }
              }}
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
              إعادة ضبط بيانات العرض
            </Button>
            <Link
              to="/login"
              className="block rounded-md px-3 py-2 text-xs text-muted-foreground hover:bg-muted"
            >
              تغيير الدور
            </Link>
          </div>
        </nav>
        <main className="flex-1 px-4 py-6 md:px-6">
          <div className="mb-3 md:hidden">
            <MobileNav />
          </div>
          <div key={location.pathname} className="animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

function MobileNav() {
  const { state } = useDemoStore();
  const role = state.currentRole;
  const visibleRoutes = ROUTES.filter(
    (r) =>
      r.roles.includes(role) &&
      r.group !== "access" &&
      !r.path.includes(":") &&
      (r.path !== "/admin/users" || canManageUsers(role)),
  );
  return (
    <details className="rounded-md border border-border bg-surface">
      <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-sm font-medium">
        القائمة
        <ChevronLeft className="h-4 w-4" aria-hidden />
      </summary>
      <ul className="border-t border-border p-2">
        {visibleRoutes.map((r) => (
          <li key={r.path}>
            <NavLink
              to={r.path}
              end
              className={({ isActive }) =>
                cn(
                  "block rounded-md px-3 py-2 text-sm",
                  isActive ? "bg-accent/10 text-accent" : "hover:bg-muted",
                )
              }
            >
              {r.labelAr}
            </NavLink>
          </li>
        ))}
      </ul>
    </details>
  );
}
