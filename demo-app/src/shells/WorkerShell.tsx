import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { ArrowRight, Factory, RotateCcw } from "lucide-react";
import { DemoBanner } from "@/components/shared/DemoBanner";
import { RoleSwitcher } from "@/components/shared/RoleSwitcher";
import { Button } from "@/components/ui/button";
import { useDemoStore } from "@/store/DemoStoreContext";
import { ROUTES } from "@/routes";
import { ROLES } from "@/types";
import { cn } from "@/lib/utils";

/**
 * WorkerShell — task-first navigation for Warehouse/Production/Quality.
 * - No financial menu entries.
 * - Large touch targets.
 * - Clear "back to tasks" route.
 */
export function WorkerShell() {
  const { state, reset } = useDemoStore();
  const location = useLocation();
  const role = state.currentRole;
  const roleInfo = ROLES.find((r) => r.id === role)!;

  // Worker-only routes (no management roles) in this worker's domain.
  const workerRoutes = ROUTES.filter(
    (r) => r.roles.includes(role) && (r.group === role || r.group === "access"),
  );

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <DemoBanner />
      <header className="flex items-center justify-between gap-3 border-b border-border bg-sidebar px-4 py-3 text-sidebar-foreground">
        <div className="flex items-center gap-2">
          <Factory className="h-6 w-6" aria-hidden />
          <span className="font-heading text-base font-bold">عرض ERP التفاعلي</span>
        </div>
        <RoleSwitcher />
      </header>
      <div className="border-b border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
        <span>الدور الحالي: </span>
        <span className="font-medium text-foreground">{roleInfo.labelAr}</span>
        <span> — </span>
        <span dir="rtl">{roleInfo.descriptionAr}</span>
      </div>
      <div className="flex flex-1">
        <nav
          aria-label="مهام العامل"
          className="w-full border-e border-border bg-surface px-4 py-4 md:w-72"
        >
          <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">المهام</p>
          <ul className="space-y-1">
            <li>
              <NavLink
                to="/worker"
                end
                className={({ isActive }) =>
                  cn(
                    "flex min-h-12 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium",
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "text-foreground hover:bg-muted",
                  )
                }
              >
                العودة إلى المهام
              </NavLink>
            </li>
            {workerRoutes
              .filter((r) => r.path !== "/worker" && r.path !== "/login" && r.path !== "/recovery")
              .map((r) => (
                <li key={r.path}>
                  <NavLink
                    to={r.path}
                    className={({ isActive }) =>
                      cn(
                        "flex min-h-12 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium",
                        isActive
                          ? "bg-accent text-accent-foreground"
                          : "text-foreground hover:bg-muted",
                      )
                    }
                  >
                    {r.labelAr}
                  </NavLink>
                </li>
              ))}
          </ul>
          <div className="mt-6 space-y-2 border-t border-border pt-4">
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
              className="flex min-h-10 items-center gap-1 rounded-md px-3 py-2 text-xs text-muted-foreground hover:bg-muted"
            >
              <ArrowRight className="h-3 w-3" aria-hidden />
              تغيير الدور
            </Link>
          </div>
        </nav>
        <main className="flex-1 px-4 py-6 md:px-6">
          <div key={location.pathname} className="animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
