/**
 * Demo home — showcase index of all stakeholder demo screens.
 *
 * Route: /demo
 *
 * Corrected 2026-07-06:
 *   - Removed large header + role-selection section + 5 role cards
 *   - Quick role selection now lives on /login (3 choices only)
 *   - This page is now a compact screen index for the executive/accountant persona
 *
 * Has NO auth, NO server actions, NO Supabase, NO writes.
 */
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { LtrValue } from "@/components/ui/ltr-value";
import { DemoShell } from "@/components/demo/demo-shell";
import { DemoCompactHeading, DemoFooterNote } from "@/components/demo/demo-charts";

interface ScreenCard {
  href: string;
  labelAr: string;
  descAr: string;
}

const SCREENS: ScreenCard[] = [
  { href: "/demo/owner/dashboard", labelAr: "لوحة التحكم", descAr: "KPIs، توزيع المخزون (خامات/شعيرات/خيوط)، اتجاه طلبات الاعتماد والمتابعة، أرصدة مصانع التشغيل، آخر النشاطات." },
  { href: "/demo/owner/reviews", labelAr: "مركز الاعتماد والمتابعة", descAr: "بطاقات ملخصات، جدول الطلبات المعلقة، فلاتر وبحث، أزرار اعتماد/رفض معطلة." },
  { href: "/demo/owner/purchase", labelAr: "إدخال الشراء", descAr: "شراء خامات / شراء خيوط — تبويب متعدد، أقسام مجمعة، أزرار مسودة/مراجعة تجريبية." },
  { href: "/demo/owner/sales-entry", labelAr: "إدخال البيع", descAr: "بيع خامات / بيع خيوط — تبويب متعدد، أقسام مجمعة، أزرار مسودة/مراجعة تجريبية." },
  { href: "/demo/owner/operation", labelAr: "إدخال التشغيل", descAr: "تشغيل خيوط لدى الشركات / زوي خيوط لدى شركات — تبويب متعدد، أقسام مجمعة." },
  { href: "/demo/owner/yarn-movement", labelAr: "حركة الخيوط", descAr: "نموذج واحد لحركة الخيوط المنتجة بين المخازن أو للعملاء." },
  { href: "/demo/owner/inventory", labelAr: "نظرة عامة على المخزون", descAr: "إجمالي المخزون (خامات/شعيرات/خيوط)، أرصدة الخيوط بالمخازن، توزيع حسب الموقع، تنبيهات." },
  { href: "/demo/owner/sales", labelAr: "نظرة عامة على المبيعات", descAr: "أوامر البيع، حالة الحجز، أرصدة العملاء، مخططات مبسطة." },
  { href: "/demo/owner/parties", labelAr: "الموردون والعملاء والمصانع", descAr: "قوائم البيانات الأساسية، الأرصدة، ملخصات العلاقات، الحالة النشطة/غير النشطة." },
  { href: "/demo/owner/activity", labelAr: "النشاطات والإشعارات", descAr: "شرائط نشاط قابلة للطي، لوحة إشعارات، زر تحديث يدوي." },
];

export default function DemoHomePage() {
  return (
    <DemoShell
      userName="ERP-Yarn"
      persona="executive"
      breadcrumbs={[{ label: "الرئيسية" }]}
    >
      <DemoCompactHeading
        titleAr="شاشات العرض التفاعلي"
        subtitleAr="فهرس مختصر لجميع شاشات العرض — استخدم القائمة الجانبية أو البحث السريع للتنقل"
      />

      {/* Screen index */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SCREENS.map((s) => (
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

      {/* What's fake vs real */}
      <Card className="mt-6">
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
              <span>نماذج الإدخال: لا تُرسل أي طلبات فعلية، لكنها تعرض تغذية راجعة تحميل/حالة محاكاة + مراجعة سريعة قبل التأكيد.</span>
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

      <DemoFooterNote />
    </DemoShell>
  );
}
