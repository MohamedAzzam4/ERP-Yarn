/**
 * Demo form shared components — reusable building blocks for the 4 grouped
 * input destinations (purchase, sales-entry, operation, yarn-movement).
 *
 * All components are demo-only:
 *   - No real submit, no API call, no DB write.
 *   - Buttons are type="button" with simulated loading → success state.
 *   - 44px touch targets, LTR isolation on numeric/code/date fields.
 *   - Calm Enterprise style: blue/navy dominant, glass only on summary panels.
 */
"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LtrValue } from "@/components/ui/ltr-value";

// ---------------------------------------------------------------------------
// Shared input styles
// ---------------------------------------------------------------------------

export const inputClass =
  "w-full min-h-[44px] rounded-md border border-input bg-surface px-3 py-2 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
export const labelClass = "text-sm font-medium text-muted-foreground mb-1 block";

// ---------------------------------------------------------------------------
// DemoFormField — single field definition
// ---------------------------------------------------------------------------

export interface DemoFormField {
  labelAr: string;
  defaultValue: string;
  ltr: boolean;
  type?: "text" | "number" | "select" | "textarea";
  options?: string[];
  placeholder?: string;
}

export interface DemoFormSection {
  titleAr: string;
  fields: ReadonlyArray<DemoFormField>;
}

// ---------------------------------------------------------------------------
// DemoFieldRenderer — renders a single field (input/select/textarea)
// ---------------------------------------------------------------------------

let fieldIdCounter = 0;

export function DemoField({ field }: { field: DemoFormField }) {
  // Stable unique ID per field (incremented counter avoids collisions)
  const [id] = React.useState(() => `demo-field-${++fieldIdCounter}`);

  // Select dropdown
  if (field.type === "select" && field.options) {
    return (
      <div>
        <label htmlFor={id} className={labelClass}>{field.labelAr}</label>
        <select id={id} defaultValue={field.defaultValue} className={inputClass}>
          {field.options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
          <option value="other">غير موجود في القائمة</option>
        </select>
      </div>
    );
  }

  // Textarea
  if (field.type === "textarea") {
    return (
      <div>
        <label htmlFor={id} className={labelClass}>{field.labelAr}</label>
        <textarea
          id={id}
          rows={3}
          defaultValue={field.defaultValue}
          className={inputClass}
          placeholder={field.placeholder ?? ""}
        />
      </div>
    );
  }

  // Text or number input
  return (
    <div>
      <label htmlFor={id} className={labelClass}>{field.labelAr}</label>
      <input
        id={id}
        type={field.type === "number" ? "number" : "text"}
        dir={field.ltr ? "ltr" : undefined}
        defaultValue={field.defaultValue}
        className={inputClass}
        placeholder={field.placeholder ?? field.defaultValue}
        min={field.type === "number" ? "0" : undefined}
        step={field.type === "number" ? "0.001" : undefined}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// DemoFormSectionCard — renders a section with its fields in a card
// ---------------------------------------------------------------------------

export function DemoFormSectionCard({ section }: { section: DemoFormSection }) {
  return (
    <Card className="mb-4">
      <CardHeader className="pb-3">
        <CardTitle className="text-heading-4 text-muted-foreground">{section.titleAr}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {section.fields.map((field, i) => (
            <DemoField key={i} field={field} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// DemoActionButtons — حفظ كمسودة / إرسال للمراجعة with simulated loading
// ---------------------------------------------------------------------------

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

export function DemoActionButtons() {
  const [state, setState] = React.useState<ActionState>("idle");

  return (
    <div className="mt-6 space-y-3">
      {/* Status banner — appears once an action has been taken */}
      {state !== "idle" && (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            "flex items-center gap-3 rounded-lg border p-3 text-sm",
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
            {state === "submitted" && "بانتظار الاعتماد — لم يُرحَّل شيء بعد."}
          </span>
        </div>
      )}

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
        شاشة تجريبية للعرض — لا يتم تسجيل أو ترحيل أي بيانات
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DemoSegmentedTabs — tab switcher for grouped input pages
// (purchase: شراء خامات / شراء خيوط, etc.)
// ---------------------------------------------------------------------------

export interface DemoTab {
  id: string;
  labelAr: string;
}

export function DemoSegmentedTabs({
  tabs,
  activeTab,
  onChange,
  ariaLabel,
}: {
  tabs: ReadonlyArray<DemoTab>;
  activeTab: string;
  onChange: (tabId: string) => void;
  ariaLabel: string;
}) {
  return (
    <div
      className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1"
      role="tablist"
      aria-label={ariaLabel}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            "min-h-[40px] rounded-md px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            activeTab === tab.id
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-surface",
          )}
        >
          {tab.labelAr}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DemoSummaryCard — top summary card on input pages (glass accent allowed here)
// ---------------------------------------------------------------------------

export function DemoSummaryCard({
  labelAr,
  value,
  unitAr,
  accent = "primary",
}: {
  labelAr: string;
  value: string;
  unitAr?: string;
  accent?: "primary" | "accent" | "success" | "warning" | "danger";
}) {
  const accentLine: Record<string, string> = {
    primary: "bg-primary",
    accent: "bg-chart-2",
    success: "bg-chart-2",
    warning: "bg-warning",
    danger: "bg-danger",
  };
  return (
    <Card className="relative overflow-hidden border-border bg-surface">
      <div className={cn("pointer-events-none absolute right-0 top-5 bottom-5 w-[3px] rounded-full", accentLine[accent])} aria-hidden="true" />
      <CardContent className="relative p-4">
        <p className="text-xs font-medium text-muted-foreground mb-1.5">{labelAr}</p>
        <p className="text-xl font-bold text-foreground tabular-nums">
          <LtrValue>{value}</LtrValue>
          {unitAr && <span className="mr-1 text-xs text-muted-foreground">{unitAr}</span>}
        </p>
      </CardContent>
    </Card>
  );
}
