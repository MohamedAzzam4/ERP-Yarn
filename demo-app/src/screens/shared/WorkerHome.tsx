import { Link } from "react-router-dom";
import {
  ClipboardCheck,
  FileCheck2,
  Factory,
  PackageCheck,
  RotateCcw,
  ShieldAlert,
  Truck,
  Undo2,
  Warehouse,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { useDemoStore } from "@/store/DemoStoreContext";
import { ROUTES } from "@/routes";
import { cn } from "@/lib/utils";
import type { Role } from "@/types";

const taskIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  "/warehouse/raw-receipt": PackageCheck,
  "/warehouse/transfer": Truck,
  "/warehouse/return-receipt": Undo2,
  "/warehouse/activity": ClipboardCheck,
  "/production/material-issue": RotateCcw,
  "/production/single-yarn-receipt": FileCheck2,
  "/production/twisted-yarn-receipt": FileCheck2,
  "/production/wip-return": Undo2,
  "/production/activity": ClipboardCheck,
  "/quality/test-entry": ShieldAlert,
  "/quality/hold-release": ShieldAlert,
  "/quality/activity": ClipboardCheck,
};

export default function WorkerHome() {
  const { state } = useDemoStore();
  const role = state.currentRole;
  const roleLabel = labelForRole(role);

  const tasks = ROUTES.filter((r) => r.roles.includes(role) && r.group === role);

  const recent = state.activity.filter((a) => taskCategoryForRole(role, a.category)).slice(0, 4);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`أهلًا — ${roleLabel}`}
        description="اختر المهمة لبدء تسجيلها. كل الإدخالات هنا بيانات تجريبية غير حقيقية."
      />

      <section aria-labelledby="tasks-heading">
        <h2 id="tasks-heading" className="sr-only">
          المهام المتاحة
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tasks.map((task) => {
            const Icon = taskIcons[task.path] ?? ClipboardCheck;
            return (
              <Link
                key={task.path}
                to={task.path}
                className="group block rounded-lg border border-border bg-surface p-5 shadow-card transition-all hover:border-accent hover:shadow-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent group-hover:bg-accent group-hover:text-accent-foreground">
                    <Icon className="h-6 w-6" aria-hidden />
                  </div>
                  <div className="space-y-1">
                    <p className="font-heading text-lg font-semibold text-foreground">
                      {task.labelAr}
                    </p>
                    {task.descriptionAr ? (
                      <p className="text-sm text-muted-foreground" dir="rtl">
                        {task.descriptionAr}
                      </p>
                    ) : null}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="recent-heading" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 id="recent-heading" className="font-heading text-lg font-semibold">
            عملياتك الأخيرة
          </h2>
          <Link to={`/${role}/activity`} className="text-xs text-accent hover:underline">
            عرض الكل
          </Link>
        </div>
        {recent.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              لا توجد عمليات مسجّلة بعد في العرض التفاعلي.
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {recent.map((act) => (
              <li
                key={act.id}
                className={cn("rounded-md border border-border bg-surface p-3 text-sm")}
              >
                <p className="font-medium text-foreground" dir="rtl">
                  {act.actionAr}
                </p>
                <p className="mt-1 text-xs text-muted-foreground" dir="rtl">
                  <bdi dir="ltr">{act.timestamp.replace("T", " ")}</bdi>
                  {act.reference ? ` — ${act.reference}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Card>
        <CardContent className="flex items-start gap-3 p-4 text-xs text-muted-foreground">
          <Warehouse className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <p dir="rtl">
            وضع العامل يخفي كل البيانات المالية (أسعار، تكاليف، أرصدة، مدفوعات، ربحية). هذه قاعدة
            مطلقة في النظام التشغيلي ولا يمكن تجاوزها من واجهة العرض.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function labelForRole(role: Role): string {
  switch (role) {
    case "warehouse":
      return "عامل المخزن";
    case "production":
      return "عامل الإنتاج";
    case "quality":
      return "عامل الجودة";
    default:
      return "العامل";
  }
}

function taskCategoryForRole(role: Role, cat: string): boolean {
  if (role === "warehouse") return cat === "warehouse";
  if (role === "production") return cat === "production";
  if (role === "quality") return cat === "quality";
  return false;
}

// Avoid unused-import warning for `Factory` (kept for future task icons).
void Factory;
