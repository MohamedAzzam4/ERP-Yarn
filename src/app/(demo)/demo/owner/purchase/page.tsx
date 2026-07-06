/**
 * Demo Purchase Input — إدخال الشراء
 *
 * Route: /demo/owner/purchase
 *
 * Grouped input page with segmented tabs:
 *   - شراء خامات  (Purchase Raw Materials)
 *   - شراء خيوط   (Purchase Yarn)
 *
 * Corrected 2026-07-06:
 *   - Removed pre-entry summary/KPI cards (mobile-first form, no totals before input)
 *   - Narrow centered layout (max-w-2xl) for desktop, full-width on mobile
 *   - Buttons open DemoReviewModal first (مراجعة سريعة قبل الحفظ/الإرسال)
 *   - After confirmation: loading → success state (no real API/DB)
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
      userName="ERP-Yarn"
      persona="data-entry"
      roleLabel="مسؤول تسجيل البيانات أو المدخلات"
      breadcrumbs={[{ label: "العمليات / مهام الإدخال" }, { label: "إدخال الشراء" }]}
    >
      <DemoFormLayout>
        {/* Title + guidance — plain, no gradient/glass (mobile-first form) */}
        <div className="mb-4">
          <h1 className="text-heading-2 text-foreground mb-1">إدخال الشراء</h1>
          <p className="text-sm text-muted-foreground">
            اختر نوع الشراء ثم أدخل البيانات — شاشة تجريبية للعرض
          </p>
        </div>

        {/* Segmented tabs */}
        <div className="mb-6">
          <DemoSegmentedTabs
            tabs={TABS}
            activeTab={activeTab}
            onChange={setActiveTab}
            ariaLabel="نوع الشراء"
          />
        </div>

        {/* Form sections — no pre-entry summary cards */}
        {sections.map((section, i) => (
          <DemoFormSectionCard key={i} section={section} />
        ))}

        {/* Action buttons — open review modal first */}
        <DemoActionButtons sections={sections} />

        <DemoFooterNote />
      </DemoFormLayout>
    </DemoShell>
  );
}
