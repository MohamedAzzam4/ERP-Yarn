/**
 * Demo Yarn Movement — حركة الخيوط
 *
 * Route: /demo/owner/yarn-movement
 *
 * Single form page for produced yarn movement (standalone — no tabs).
 *
 * Corrected 2026-07-06: removed pre-entry summary cards, narrow layout, review modal.
 *
 * Demo-only: no real submit, no API call, no DB write.
 */
import { DemoShell } from "@/components/demo/demo-shell";
import { DemoFooterNote } from "@/components/demo/demo-charts";
import {
  DemoFormSectionCard,
  DemoActionButtons,
  DemoFormLayout,
} from "@/components/demo/demo-form-shared";
import { YARN_MOVEMENT_SECTIONS } from "@/lib/fixtures/demo-fixtures";

export default function DemoYarnMovementPage() {
  return (
    <DemoShell
      userName="مسؤول تسجيل البيانات أو المدخلات"
      breadcrumbs={[{ label: "العمليات / مهام الإدخال" }, { label: "حركة الخيوط" }]}
    >
      <DemoFormLayout>
        <div className="mb-4">
          <h1 className="text-heading-2 text-foreground mb-1">حركة الخيوط</h1>
          <p className="text-sm text-muted-foreground">
            سجّل حركة خيوط منتجة بين المخازن أو للعملاء — شاشة تجريبية للعرض
          </p>
        </div>

        {YARN_MOVEMENT_SECTIONS.map((section, i) => (
          <DemoFormSectionCard key={i} section={section} />
        ))}

        <DemoActionButtons sections={YARN_MOVEMENT_SECTIONS} />

        <DemoFooterNote />
      </DemoFormLayout>
    </DemoShell>
  );
}
