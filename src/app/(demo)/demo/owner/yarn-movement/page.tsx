/**
 * Demo Yarn Movement — حركة الخيوط
 *
 * Route: /demo/owner/yarn-movement
 *
 * Single form page for produced yarn movement (standalone — no tabs).
 *
 * Demo-only: no real submit, no API call, no DB write.
 */
import { DemoShell } from "@/components/demo/demo-shell";
import { DemoPageHeader, DemoFooterNote } from "@/components/demo/demo-charts";
import {
  DemoFormSectionCard,
  DemoActionButtons,
  DemoSummaryCard,
} from "@/components/demo/demo-form-shared";
import { YARN_MOVEMENT_SECTIONS } from "@/lib/fixtures/demo-fixtures";

export default function DemoYarnMovementPage() {
  return (
    <DemoShell
      userName="مسؤول تسجيل البيانات أو المدخلات"
      breadcrumbs={[{ label: "العمليات" }, { label: "حركة الخيوط" }]}
    >
      <DemoPageHeader
        titleAr="حركة الخيوط"
        subtitleAr="تسجيل حركة خيوط منتجة بين المخازن أو للعملاء — شاشة تجريبية للعرض"
      />

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 mb-6 sm:grid-cols-2 lg:grid-cols-4">
        <DemoSummaryCard labelAr="نوع الحركة" value="نقل" accent="primary" />
        <DemoSummaryCard labelAr="الوزن القائم" value="1,820.000" unitAr="كجم" accent="accent" />
        <DemoSummaryCard labelAr="عدد الشكاير" value="36" unitAr="شيكارة" accent="success" />
        <DemoSummaryCard labelAr="الغرض" value="نقل للبيع" accent="warning" />
      </div>

      {/* Form sections */}
      {YARN_MOVEMENT_SECTIONS.map((section, i) => (
        <DemoFormSectionCard key={i} section={section} />
      ))}

      {/* Action buttons */}
      <DemoActionButtons />

      <DemoFooterNote />
    </DemoShell>
  );
}
