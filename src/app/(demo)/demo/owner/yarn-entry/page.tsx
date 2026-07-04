/**
 * Demo Yarn Entry — stakeholder visual demo.
 *
 * Route: /demo/owner/yarn-entry
 *
 * Static/demo data-entry screen showing how a user enters yarn stock and
 * yarn technical-review results. Inspired by the stakeholder Excel
 * "ارصدة الخيوط بالمخازن محمد.xlsx" (sheet: "ارصدة الخيوط بالمخازن").
 *
 * Form is grouped into 3 sections per stakeholder request:
 *   1. بيانات الأمر والتخزين    — تاريخ التخزين، الشركة، رقم الأمر، نمرة الخيط،
 *                                 م. برم الفرد، م. برم الزوى، مكان التخزين
 *   2. الكميات والأرصدة         — كونز، إجمالي المنتج، الرصيد الحالي، عدد الشكاير
 *   3. نتائج المراجعة الفنية للخيط — م برم، RKM، Elongn، U%، Tin، Tick، Neps، Hairs
 *
 * Behavior:
 *   - All buttons are type="button" — NO real submit, NO API call, NO DB write.
 *   - "حفظ كمسودة" + "إرسال للمراجعة" show simulated loading → success state.
 *   - 44px minimum touch targets on all inputs/buttons (Contract 02 §Worker).
 *   - LTR isolation on all numeric/code/date fields via dir="ltr".
 *   - DEC-076 worker safety: no glass, no primary gradients on this entry
 *     form (it's a data-entry surface, not a management insight surface).
 *   - Western numerals, DD/MM/YYYY dates.
 *   - Demo banner + persistent footer note.
 */
"use client";

import * as React from "react";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LtrValue } from "@/components/ui/ltr-value";
import { cn } from "@/lib/cn";
import {
  DEMO_YARN_ENTRY_DEFAULTS,
  DEMO_YARN_ENTRY_SECTIONS,
} from "@/lib/fixtures/demo-fixtures";
import { DemoBanner } from "@/components/demo/demo-banner";

// Shared input styles — large touch-friendly inputs (Contract 02 §Worker).
const inputClass =
  "w-full min-h-[44px] rounded-md border border-input bg-surface px-3 py-2 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const labelClass = "text-sm font-medium text-muted-foreground mb-1 block";

// Build a quick lookup from label → field default value.
const DEFAULTS_BY_LABEL: Record<string, { value: string; ltr: boolean }> = Object.fromEntries(
  DEMO_YARN_ENTRY_DEFAULTS.map((f) => [f.labelAr, { value: f.value, ltr: f.ltr }]),
);

// Static select options for the dropdowns.
const COMPANY_OPTIONS = ["قمح دلتا", "نسر النيل", "غزل الشرق", "خيوط الواحة"];
const STORAGE_LOCATION_OPTIONS = ["مخازن", "مخزن مصر ايران", "31اسكندرية"];
const YARN_COUNT_OPTIONS = ["2/24", "1/24", "2/30", "2/20", "3/40"];

type ActionState = "idle" | "saving" | "saved-draft" | "submitting" | "submitted";

const STATE_LABEL: Record<ActionState, string> = {
  idle: "لم يتم الإجراء بعد",
  saving: "جاري حفظ المسودة...",
  "saved-draft": "تم حفظ المسودة محلياً (عرض تفاعلي)",
  submitting: "جاري الإرسال للمراجعة...",
  submitted: "تم الإرسال للمراجعة (عرض تفاعلي)",
};

const STATE_CHIP_CLASS: Record<ActionState, string> = {
  idle: "bg-muted text-muted-foreground",
  saving: "bg-info/10 text-info",
  "saved-draft": "bg-warning/10 text-warning",
  submitting: "bg-info/10 text-info",
  submitted: "bg-success/10 text-success",
};

export default function DemoYarnEntryPage() {
  const [state, setState] = React.useState<ActionState>("idle");

  // Helper to render a field by label. LTR fields get dir="ltr" on the input.
  // Date/code/number fields are LTR-isolated.
  const renderField = (labelAr: string, idx: number) => {
    const def = DEFAULTS_BY_LABEL[labelAr] ?? { value: "", ltr: true };
    const id = `yarn-field-${idx}`;

    // Select dropdowns for company / storage location / yarn count
    if (labelAr === "الشركة") {
      return (
        <div key={labelAr}>
          <label htmlFor={id} className={labelClass}>{labelAr}</label>
          <select id={id} name="company" defaultValue={def.value} className={inputClass}>
            {COMPANY_OPTIONS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
            <option value="other">غير موجود في القائمة</option>
          </select>
        </div>
      );
    }

    if (labelAr === "مكان التخزين") {
      return (
        <div key={labelAr}>
          <label htmlFor={id} className={labelClass}>{labelAr}</label>
          <select id={id} name="storage_location" defaultValue={def.value} className={inputClass}>
            {STORAGE_LOCATION_OPTIONS.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
            <option value="other">غير موجود في القائمة</option>
          </select>
        </div>
      );
    }

    if (labelAr === "نمرة الخيط" || labelAr === "م برم") {
      return (
        <div key={labelAr}>
          <label htmlFor={id} className={labelClass}>{labelAr}</label>
          <select id={id} name={`yarn_count_${idx}`} defaultValue={def.value} className={inputClass}>
            {YARN_COUNT_OPTIONS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
            <option value="other">غير موجود في القائمة</option>
          </select>
        </div>
      );
    }

    // Date field (تاريخ التخزين)
    if (labelAr === "تاريخ التخزين") {
      return (
        <div key={labelAr}>
          <label htmlFor={id} className={labelClass}>{labelAr}</label>
          <input
            id={id}
            name="storage_date"
            type="text"
            dir="ltr"
            defaultValue={def.value}
            className={inputClass}
            placeholder="DD/MM/YYYY"
          />
        </div>
      );
    }

    // Numeric/code fields — LTR isolated
    return (
      <div key={labelAr}>
        <label htmlFor={id} className={labelClass}>{labelAr}</label>
        <input
          id={id}
          name={labelAr}
          type="text"
          dir="ltr"
          defaultValue={def.value}
          className={inputClass}
          placeholder={def.value || "—"}
        />
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header — plain worker/data-entry chrome (no glass, no gradient per DEC-076) */}
      <DemoBanner />
      <header
        className="sticky top-0 z-10 border-b border-border bg-surface"
        role="banner"
      >
        <Container size="md">
          <div className="flex items-center justify-between gap-4 py-4">
            <div className="flex items-center gap-3">
              <a
                href="/demo"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface font-heading text-base font-bold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="العودة إلى العرض التفاعلي"
              >
                E
              </a>
              <div>
                <h1 className="text-heading-3 text-foreground">إدخال الخيوط</h1>
                <p className="text-sm text-muted-foreground">مسؤول تسجيل البيانات أو المدخلات · عرض تفاعلي</p>
              </div>
            </div>
            <a
              href="/demo"
              className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-border bg-surface px-4 text-sm font-heading font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              خروج
            </a>
          </div>
        </Container>
      </header>

      <main role="main" className="py-6">
        <Container size="md">
          {/* Plain title block — NO gradient, NO glass (DEC-076 worker/data-entry safety) */}
          <div className="mb-4">
            <h2 className="text-heading-2 text-foreground mb-1">إدخال الخيوط</h2>
            <p className="text-sm text-muted-foreground">
              أدخل بيانات الأمر والتخزين، ثم الكميات والأرصدة، ثم نتائج المراجعة الفنية للخيط.
              احفظ كمسودة أو أرسل للمراجعة.
            </p>
          </div>

          {/* Status banner — appears once an action has been taken */}
          {state !== "idle" && (
            <div
              role="status"
              aria-live="polite"
              className={cn(
                "mb-4 flex items-center gap-3 rounded-lg border p-3 text-sm",
                STATE_CHIP_CLASS[state],
                state === "saved-draft" && "border-warning/30",
                state === "submitted" && "border-success/30",
                (state === "saving" || state === "submitting") && "border-info/30",
              )}
            >
              {(state === "saving" || state === "submitting") && (
                <span
                  className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
                  aria-hidden="true"
                />
              )}
              <span className="font-medium">{STATE_LABEL[state]}</span>
              <span className="mr-auto text-xs">
                {state === "saved-draft" && "يمكنك المتابعة في الإدخال — لم يُرحَّل شيء."}
                {state === "submitted" && "بانتظار اعتماد مدير المراجعة — لم يُرحَّل شيء بعد."}
              </span>
            </div>
          )}

          {/* Section 1: بيانات الأمر والتخزين */}
          <Card className="mb-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-heading-4 text-muted-foreground">
                {DEMO_YARN_ENTRY_SECTIONS[0]!.titleAr}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {DEMO_YARN_ENTRY_SECTIONS[0]!.fieldLabelsAr.map((label, i) => renderField(label, i))}
              </div>
            </CardContent>
          </Card>

          {/* Section 2: الكميات والأرصدة */}
          <Card className="mb-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-heading-4 text-muted-foreground">
                {DEMO_YARN_ENTRY_SECTIONS[1]!.titleAr}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {DEMO_YARN_ENTRY_SECTIONS[1]!.fieldLabelsAr.map((label, i) =>
                  renderField(label, i + DEMO_YARN_ENTRY_SECTIONS[0]!.fieldLabelsAr.length),
                )}
              </div>
            </CardContent>
          </Card>

          {/* Section 3: نتائج المراجعة الفنية للخيط */}
          <Card className="mb-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-heading-4 text-muted-foreground">
                {DEMO_YARN_ENTRY_SECTIONS[2]!.titleAr}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {DEMO_YARN_ENTRY_SECTIONS[2]!.fieldLabelsAr.map((label, i) =>
                  renderField(label, i + DEMO_YARN_ENTRY_SECTIONS[0]!.fieldLabelsAr.length + DEMO_YARN_ENTRY_SECTIONS[1]!.fieldLabelsAr.length),
                )}
              </div>
              <p className="mt-4 text-xs text-muted-foreground leading-relaxed">
                ملاحظة: القيم في هذا القسم (RKM، Elongn، U%، Tin، Tick، Neps، Hairs) تمثل
                نتائج المراجعة الفنية للخيط وتؤثر على سعر البيع — تُراجَع من قبل مدير المراجعة.
              </p>
            </CardContent>
          </Card>

          {/* Actions — demo only, simulated pending → success transitions */}
          <div className="mt-6 space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                disabled={state === "saving" || state === "submitting"}
                onClick={() => {
                  setState("saving");
                  window.setTimeout(() => setState("saved-draft"), 900);
                }}
                className="min-h-[44px] flex-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                aria-label="حفظ كمسودة (عرض تفاعلي)"
              >
                {state === "saving" ? (
                  <>
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
                    <span className="mr-2">جاري الحفظ...</span>
                  </>
                ) : (
                  "حفظ كمسودة"
                )}
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={state === "saving" || state === "submitting"}
                onClick={() => {
                  setState("submitting");
                  window.setTimeout(() => setState("submitted"), 1100);
                }}
                className="min-h-[44px] flex-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                aria-label="إرسال للمراجعة (عرض تفاعلي)"
              >
                {state === "submitting" ? (
                  <>
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
                    <span className="mr-2">جاري الإرسال...</span>
                  </>
                ) : (
                  "إرسال للمراجعة"
                )}
              </Button>
            </div>
            <p className="text-xs text-center text-muted-foreground">
              هذه شاشة عرض تفاعلي ببيانات تجريبية — لا يتم حفظ أو ترحيل أي بيانات،
              ولا تتم أي كتابة إلى قاعدة البيانات. أزرار الحفظ/الإرسال تعرض تغذية راجعة
              محاكاة فقط.
            </p>
          </div>
        </Container>
      </main>
    </div>
  );
}
