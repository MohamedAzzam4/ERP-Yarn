/**
 * Demo Sales Input — إدخال البيع
 *
 * Route: /demo/owner/sales-entry
 *
 * Grouped input page with segmented tabs:
 *   - بيع خامات  (Sales Raw Materials)
 *   - بيع خيوط   (Sales Yarn)
 *
 * Demo-only: no real submit, no API call, no DB write.
 */
"use client";

import * as React from "react";
import { DemoShell } from "@/components/demo/demo-shell";
import { DemoPageHeader, DemoFooterNote } from "@/components/demo/demo-charts";
import {
  DemoSegmentedTabs,
  DemoFormSectionCard,
  DemoActionButtons,
  DemoSummaryCard,
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
      breadcrumbs={[{ label: "العمليات" }, { label: "إدخال البيع" }]}
    >
      <DemoPageHeader
        titleAr="إدخال البيع"
        subtitleAr="اختر نوع البيع ثم أدخل البيانات — شاشة تجريبية للعرض"
      />

      {/* Segmented tabs */}
      <div className="mb-6">
        <DemoSegmentedTabs
          tabs={TABS}
          activeTab={activeTab}
          onChange={setActiveTab}
          ariaLabel="نوع البيع"
        />
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 mb-6 sm:grid-cols-2 lg:grid-cols-4">
        <DemoSummaryCard labelAr="نوع البيع" value={activeTab === "raw" ? "خامات" : "خيوط"} accent="primary" />
        <DemoSummaryCard
          labelAr="الكمية"
          value={activeTab === "raw" ? "410.000" : "1,820.000"}
          unitAr="كجم"
          accent="accent"
        />
        <DemoSummaryCard
          labelAr="إجمالي السعر"
          value={activeTab === "raw" ? "22,550.00" : "149,240.00"}
          unitAr="جنيه"
          accent="success"
        />
        <DemoSummaryCard
          labelAr="المتبقي"
          value={activeTab === "raw" ? "12,550.00" : "99,240.00"}
          unitAr="جنيه"
          accent="warning"
        />
      </div>

      {/* Form sections */}
      {sections.map((section, i) => (
        <DemoFormSectionCard key={i} section={section} />
      ))}

      {/* Action buttons */}
      <DemoActionButtons />

      <DemoFooterNote />
    </DemoShell>
  );
}
