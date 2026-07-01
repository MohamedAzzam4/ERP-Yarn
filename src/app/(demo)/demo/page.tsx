/**
 * Demo home — showcase index of all stakeholder demo screens.
 *
 * Route: /demo
 *
 * This is the landing page for the stakeholder visual demo. It:
 *   - Re-iterates that this is synthetic data (banner + page header).
 *   - Lists every demo screen grouped by role with a one-line description.
 *   - Has NO auth, NO server actions, NO Supabase, NO writes.
 *   - Wraps everything in the DemoShell so the visitor sees the same chrome
 *     (sidebar + topbar with working search) they'll see on every demo page.
 */
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { LtrValue } from "@/components/ui/ltr-value";
import { DemoShell } from "@/components/demo/demo-shell";
import { DEMO_USERS } from "@/lib/fixtures/demo-fixtures";

interface ScreenCard {
  href: string;
  labelAr: string;
  descAr: string;
  groupAr: string;
}

const SCREENS: ScreenCard[] = [
  { href: "/demo/owner/dashboard", labelAr: "لوحة التحكم", descAr: "KPIs، توزيع المخزون، اتجاه المراجعات، أرصدة مصانع التشغيل، آخر النشاطات.", groupAr: "مالك النظام" },
  { href: "/demo/owner/reviews", labelAr: "مركز المراجعات", descAr: "بطاقات ملخصات، جدول المراجعات المعلقة، فلاتر وبحث، أزرار اعتماد/رفض معطلة.", groupAr: "مالك النظام" },
  { href: "/demo/owner/inventory", labelAr: "نظرة عامة على المخزون", descAr: "إجمالي المخزون، توزيع حسب الموقع، خام/تحت التشغيل/جاهز، تنبيهات السالب والمنخفض.", groupAr: "مالك النظام" },
  { href: "/demo/owner/production", labelAr: "الإنتاج لدى مصانع التشغيل", descAr: "أوامر الإنتاج، المخزون تحت التشغيل لدى المصانع، المدخلات والمخرجات، أرصدة المصانع.", groupAr: "مالك النظام" },
  { href: "/demo/owner/sales", labelAr: "نظرة عامة على المبيعات", descAr: "أوامر البيع، حالة الحجز، أرصدة العملاء، مخططات مبسطة.", groupAr: "مالك النظام" },
  { href: "/demo/owner/parties", labelAr: "الموردون والعملاء والمصانع", descAr: "قوائم البيانات الأساسية، الأرصدة، ملخصات العلاقات، الحالة النشطة/غير النشطة.", groupAr: "مالك النظام" },
  { href: "/demo/owner/activity", labelAr: "النشاطات والإشعارات", descAr: "شرائط نشاط قابلة للطي، لوحة إشعارات، زر تحديث يدوي.", groupAr: "مالك النظام" },
  { href: "/demo/worker/raw-receipt", labelAr: "استلام خام جديد (عامل)", descAr: "نموذج لمسي كبير، 11 حقلاً مرئياً، أزرار مسودة/مراجعة، تغذية راجعة للتحميل.", groupAr: "العامل" },
];

const ROLE_LABELS: Record<string, string> = {
  owner: "مالك النظام",
  accountant: "محاسب المراجعة",
  warehouse_employee: "عامل مخزن",
  production_employee: "عامل إنتاج",
  quality_employee: "مسؤول جودة",
};

export default function DemoHomePage() {
  const ownerScreens = SCREENS.filter((s) => s.groupAr === "مالك النظام");
  const workerScreens = SCREENS.filter((s) => s.groupAr === "العامل");

  return (
    <DemoShell
      userName="زائر العرض التفاعلي"
      breadcrumbs={[{ label: "الرئيسية" }]}
    >
      <div className="mb-6 rounded-2xl border border-primary/20 bg-gradient-to-l from-primary/12 via-primary/5 to-transparent p-6 backdrop-blur-md shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-block h-7 w-1.5 rounded-full bg-primary" aria-hidden="true" />
          <h1 className="text-heading-2 text-foreground">العرض التفاعلي لأصحاب المصلحة</h1>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">
          هذه نسخة عرض تفاعلي تعرض رؤية منتج ERP-Yarn — نظام تخطيط موارد مؤسسي متخصص في
          تجارة الخامات والتصنيع لدى الغير. جميع البيانات تجريبية وثابتة، ولا يتم تنفيذ
          أي عمليات فعلية أو كتابة إلى قاعدة البيانات. استخدم القائمة الجانبية أو
          البحث السريع في الشريط العلوي للتنقل بين الشاشات.
        </p>
      </div>

      {/* Role switcher (presentation aid only — NOT authentication) */}
      <section className="mb-6">
        <h2 className="text-section-title text-foreground mb-3">دخول سريع حسب الدور</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {DEMO_USERS.map((u) => (
            <Link
              key={u.role}
              href={u.landingRoute}
              className="group flex flex-col gap-1 rounded-lg border border-border bg-surface p-3 transition-all duration-200 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="text-xs text-muted-foreground">{ROLE_LABELS[u.role]}</span>
              <span className="text-sm font-bold text-foreground group-hover:text-primary">{u.displayNameAr}</span>
              <span className="text-[10px] text-muted-foreground" dir="ltr">
                <LtrValue>{u.landingRoute}</LtrValue>
              </span>
            </Link>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          ملاحظة: هذا التبديل عرض تقديمي فقط وليس مصادقة فعلية. النظام الفعلي يستخدم
          مصادقة Supabase وتطبيق صلاحيات قائمة على الأدوار.
        </p>
      </section>

      {/* Owner screens */}
      <section className="mb-6">
        <h2 className="text-section-title text-foreground mb-3">شاشات المالك والمحاسب</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ownerScreens.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="group flex flex-col gap-2 rounded-xl border border-border bg-surface p-5 transition-all duration-200 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-card-title text-foreground group-hover:text-primary">{s.labelAr}</span>
                <span className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  شاشة
                </span>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">{s.descAr}</p>
              <span className="mt-auto text-[10px] text-muted-foreground" dir="ltr">
                <LtrValue>{s.href}</LtrValue>
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Worker screens */}
      <section className="mb-6">
        <h2 className="text-section-title text-foreground mb-3">شاشات العامل</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {workerScreens.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="group flex flex-col gap-2 rounded-xl border border-border bg-surface p-5 transition-all duration-200 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-card-title text-foreground group-hover:text-primary">{s.labelAr}</span>
                <span className="shrink-0 rounded-md bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                  عامل
                </span>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">{s.descAr}</p>
              <span className="mt-auto text-[10px] text-muted-foreground" dir="ltr">
                <LtrValue>{s.href}</LtrValue>
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* What's fake vs real */}
      <Card>
        <CardContent className="p-5">
          <h2 className="text-section-title text-foreground mb-3">ما الذي هو تجريبي؟</h2>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-success" aria-hidden="true" />
              <span>كل البيانات المعروضة تأتي من ملفات fixtures ثابتة — لا استدعاءات API، لا قاعدة بيانات، لا Supabase.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true" />
              <span>أزرار الاعتماد/الرفض معطلة وموسومة بوضوح كأزرار تجريبية.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true" />
              <span>نموذج استلام خام العامل: لا يُرسل أي طلب، لكنه يعرض تغذية راجعة تحميل/حالة محاكاة.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-info" aria-hidden="true" />
              <span>البحث السريع في الشريط العلوي يعمل — لكنه يبحث فقط بين صفحات العرض التفاعلي.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-danger" aria-hidden="true" />
              <span>لا تتم كتابة أي بيانات إلى Supabase ولا إنشاء أي معاملات حقيقية. الفرع main لم يُمَس.</span>
            </li>
          </ul>
        </CardContent>
      </Card>
    </DemoShell>
  );
}
