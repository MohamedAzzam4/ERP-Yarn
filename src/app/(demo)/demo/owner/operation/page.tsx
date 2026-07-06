/**
 * Demo Operation Input — إدخال التشغيل
 *
 * Route: /demo/owner/operation
 *
 * Grouped input page with segmented tabs:
 *   - تشغيل خيوط لدى الشركات   (Spinning Operation)
 *   - زوي خيوط لدى شركات       (Twisting Operation)
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
      userName="مسؤول متابعة تشغيل الخيوط"
      breadcrumbs={[{ label: "العمليات" }, { label: "إدخال التشغيل" }]}
    >
      <DemoPageHeader
        titleAr="إدخال التشغيل"
        subtitleAr="اختر نوع التشغيل ثم أدخل البيانات — شاشة تجريبية للعرض"
      />

      {/* Segmented tabs */}
      <div className="mb-6">
        <DemoSegmentedTabs
          tabs={TABS}
          activeTab={activeTab}
          onChange={setActiveTab}
          ariaLabel="نوع التشغيل"
        />
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 mb-6 sm:grid-cols-2 lg:grid-cols-4">
        <DemoSummaryCard
          labelAr="نوع التشغيل"
          value={activeTab === "spinning" ? "تشغيل (فرد)" : "زوي (مزوي)"}
          accent="primary"
        />
        <DemoSummaryCard
          labelAr="وزن الخام"
          value={activeTab === "spinning" ? "5,000.000" : "2,800.000"}
          unitAr="كجم"
          accent="accent"
        />
        <DemoSummaryCard
          labelAr="الإنتاج الفعلي"
          value={activeTab === "spinning" ? "2,800.000" : "2,450.000"}
          unitAr="كجم"
          accent="success"
        />
        <DemoSummaryCard
          labelAr="نسبة العادم"
          value={activeTab === "spinning" ? "15.0" : "12.5"}
          unitAr="%"
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
