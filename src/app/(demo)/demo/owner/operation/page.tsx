/**
 * Demo Operation Input — إدخال التشغيل
 *
 * Route: /demo/owner/operation
 *
 * Grouped input page with segmented tabs:
 *   - تشغيل خيوط لدى الشركات   (Spinning Operation)
 *   - زوي خيوط لدى شركات       (Twisting Operation)
 *
 * Corrected 2026-07-06: removed pre-entry summary cards, narrow layout, review modal.
 *
 * Demo-only: no real submit, no API call, no DB write.
 */
"use client";

import * as React from "react";
import { DemoShell } from "@/components/demo/demo-shell";
import { DemoFooterNote } from "@/components/demo/demo-charts";
import {
  DemoSegmentedTabs,
  DemoFormSectionCard,
  DemoActionButtons,
  DemoFormLayout,
} from "@/components/demo/demo-form-shared";
import {
  OPERATION_SPINNING_SECTIONS,
  OPERATION_TWISTING_SECTIONS,
} from "@/lib/fixtures/demo-fixtures";

const TABS = [
  { id: "spinning", labelAr: "تشغيل خيوط لدى الشركات" },
  { id: "twisting", labelAr: "زوي خيوط لدى شركات" },
] as const;

export default function DemoOperationPage() {
  const [activeTab, setActiveTab] = React.useState<string>("spinning");
  const sections = activeTab === "spinning" ? OPERATION_SPINNING_SECTIONS : OPERATION_TWISTING_SECTIONS;

  return (
    <DemoShell
      userName="مسؤول تسجيل البيانات أو المدخلات"
      persona="data-entry"
      roleLabel="مسؤول متابعة تشغيل الخيوط"
      breadcrumbs={[{ label: "العمليات / مهام الإدخال" }, { label: "إدخال التشغيل" }]}
    >
      <DemoFormLayout>
        <div className="mb-4">
          <h1 className="text-heading-2 text-foreground mb-1">إدخال التشغيل</h1>
          <p className="text-sm text-muted-foreground">
            اختر نوع التشغيل ثم أدخل البيانات — شاشة تجريبية للعرض
          </p>
        </div>

        <div className="mb-6">
          <DemoSegmentedTabs
            tabs={TABS}
            activeTab={activeTab}
            onChange={setActiveTab}
            ariaLabel="نوع التشغيل"
          />
        </div>

        {sections.map((section, i) => (
          <DemoFormSectionCard key={i} section={section} />
        ))}

        <DemoActionButtons sections={sections} />

        <DemoFooterNote />
      </DemoFormLayout>
    </DemoShell>
  );
}
