/**
 * Data-entry task hub — landing page for the "دخول سريع لمسؤول إدخال البيانات"
 * quick-login choice.
 *
 * Route: /demo/data-entry
 *
 * Shows 4 large cards for the 4 input tasks. No sidebar (forcePersona="data-entry"
 * hides the sidebar in DemoShell). Mobile-first, touch-friendly.
 *
 * Demo-only: no real auth, no API, no DB write.
 */
import Link from "next/link";
import { DemoShell } from "@/components/demo/demo-shell";
import { DemoBanner } from "@/components/demo/demo-banner";
import { DemoFooterNote } from "@/components/demo/demo-charts";

interface TaskCard {
  href: string;
  labelAr: string;
  descAr: string;
  iconAr: string;
}

const TASKS: TaskCard[] = [
  {
    href: "/demo/data-entry/purchase",
    labelAr: "إدخال الشراء",
    descAr: "شراء خامات أو خيوط — أدخل بيانات الأمر والمورد والكميات والأسعار",
    iconAr: "🛒",
  },
  {
    href: "/demo/data-entry/sales",
    labelAr: "إدخال البيع",
    descAr: "بيع خامات أو خيوط — أدخل بيانات العميل والكمية والسعر والمدفوع",
    iconAr: "📦",
  },
  {
    href: "/demo/data-entry/operation",
    labelAr: "إدخال التشغيل",
    descAr: "تشغيل خيوط لدى الشركات أو زوي خيوط — أدخل بيانات الإنتاج والمراجعة الفنية",
    iconAr: "🏭",
  },
  {
    href: "/demo/data-entry/yarn-movement",
    labelAr: "حركة الخيوط",
    descAr: "تسجيل حركة خيوط منتجة بين المخازن أو للعملاء",
    iconAr: "🚚",
  },
];

export default function DemoDataEntryHubPage() {
  return (
    <DemoShell
      forcePersona="data-entry"
    >
      {/* Compact heading — no large glass/gradient container */}
      <div className="mb-6">
        <div className="flex items-center gap-2">
          <span className="inline-block h-5 w-1 rounded-full bg-primary" aria-hidden="true" />
          <h1 className="text-heading-2 text-foreground">مهام الإدخال</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          اختر المهمة المطلوبة لإدخال البيانات — شاشة تجريبية للعرض
        </p>
      </div>

      {/* 4 large task cards — mobile-first, touch-friendly */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {TASKS.map((task) => (
          <Link
            key={task.href}
            href={task.href}
            className="group flex min-h-[120px] flex-col gap-2 rounded-xl border border-border bg-surface p-5 transition-all duration-200 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xl" aria-hidden="true">
                {task.iconAr}
              </span>
              <span className="text-card-title text-foreground group-hover:text-primary">
                {task.labelAr}
              </span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {task.descAr}
            </p>
          </Link>
        ))}
      </div>

      <DemoFooterNote />
    </DemoShell>
  );
}
