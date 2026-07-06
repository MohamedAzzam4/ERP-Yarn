/**
 * Demo Sales Input — إدخال البيع
 *
 * Route: /demo/owner/sales-entry
 *
 * Grouped input page with segmented tabs:
 *   - بيع خامات  (Sales Raw Materials)
 *   - بيع خيوط   (Sales Yarn)
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
  SALES_RAW_SECTIONS,
  SALES_YARN_SECTIONS,
} from "@/lib/fixtures/demo-fixtures";

const TABS = [
  { id: "raw", labelAr: "بيع خامات" },
  { id: "yarn", labelAr: "بيع خيوط" },
] as const;

export default function DemoSalesEntryPage() {
  const [activeTab, setActiveTab] = React.useState<string>("raw");
  const sections = activeTab === "raw" ? SALES_RAW_SECTIONS : SALES_YARN_SECTIONS;

  return (
    <DemoShell
      userName="مسؤول تسجيل البيانات أو المدخلات"
      persona="data-entry"
      roleLabel="مسؤول تسجيل البيانات أو المدخلات"
      breadcrumbs={[{ label: "العمليات / مهام الإدخال" }, { label: "إدخال البيع" }]}
    >
      <DemoFormLayout>
        <div className="mb-4">
          <h1 className="text-heading-2 text-foreground mb-1">إدخال البيع</h1>
          <p className="text-sm text-muted-foreground">
            اختر نوع البيع ثم أدخل البيانات — شاشة تجريبية للعرض
          </p>
        </div>

        <div className="mb-6">
          <DemoSegmentedTabs
            tabs={TABS}
            activeTab={activeTab}
            onChange={setActiveTab}
            ariaLabel="نوع البيع"
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
