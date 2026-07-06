/**
 * Demo Purchase Input — إدخال الشراء
 *
 * Route: /demo/owner/purchase
 *
 * Grouped input page with segmented tabs:
 *   - شراء خامات  (Purchase Raw Materials)
 *   - شراء خيوط   (Purchase Yarn)
 *
 * Replaces the old /demo/owner/yarn-entry and /demo/worker/raw-receipt pages
 * (both redirect here).
 *
 * Demo-only: no real submit, no API call, no DB write. Buttons show simulated
 * loading → success state. All data is synthetic fixtures.
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
  PURCHASE_RAW_SECTIONS,
  PURCHASE_YARN_SECTIONS,
} from "@/lib/fixtures/demo-fixtures";

const TABS = [
  { id: "raw", labelAr: "شراء خامات" },
  { id: "yarn", labelAr: "شراء خيوط" },
] as const;

export default function DemoPurchasePage() {
  const [activeTab, setActiveTab] = React.useState<string>("raw");
  const sections = activeTab === "raw" ? PURCHASE_RAW_SECTIONS : PURCHASE_YARN_SECTIONS;

  return (
    <DemoShell
      userName="مسؤول تسجيل البيانات أو المدخلات"
      breadcrumbs={[{ label: "العمليات" }, { label: "إدخال الشراء" }]}
    >
      <DemoPageHeader
        titleAr="إدخال الشراء"
        subtitleAr="اختر نوع الشراء ثم أدخل البيانات — شاشة تجريبية للعرض"
      />

      {/* Segmented tabs */}
      <div className="mb-6">
        <DemoSegmentedTabs
          tabs={TABS}
          activeTab={activeTab}
          onChange={setActiveTab}
          ariaLabel="نوع الشراء"
        />
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 mb-6 sm:grid-cols-2 lg:grid-cols-4">
        <DemoSummaryCard labelAr="نوع الشراء" value={activeTab === "raw" ? "خامات" : "خيوط"} accent="primary" />
        <DemoSummaryCard
          labelAr={activeTab === "raw" ? "الكمية الإجمالية" : "الوزن القائم"}
          value={activeTab === "raw" ? "1,250.000" : "5,400.000"}
          unitAr="كجم"
          accent="accent"
        />
        <DemoSummaryCard
          labelAr="إجمالي السعر"
          value={activeTab === "raw" ? "65,000.00" : "421,200.00"}
          unitAr="جنيه"
          accent="success"
        />
        <DemoSummaryCard
          labelAr="الحالة"
          value="مسودة"
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
