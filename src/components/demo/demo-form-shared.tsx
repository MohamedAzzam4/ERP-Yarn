/**
 * Demo form shared components — reusable building blocks for the 4 grouped
 * input destinations (purchase, sales-entry, operation, yarn-movement).
 *
 * Corrected 2026-07-06:
 *   - Removed pre-entry summary/KPI cards from input pages (mobile-first forms)
 *   - Added DemoReviewModal — quick review confirmation step before save/submit
 *   - Input pages now use a narrow centered layout (max-w-2xl) for desktop,
 *     full-width on mobile
 *
 * All components are demo-only:
 *   - No real submit, no API call, no DB write.
 *   - Buttons are type="button" with simulated loading → success state.
 *   - 44px touch targets, LTR isolation on numeric/code/date fields.
 *   - Calm Enterprise style: blue/navy dominant, glass only on modal header.
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
  const [id] = React.useState(() => `demo-field-${++fieldIdCounter}`);

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
// DemoReviewModal — quick review confirmation before save/submit
//
// Opens when the user clicks حفظ كمسودة or إرسال للمراجعة.
// Shows the entered values grouped by section (important fields only).
// Actions: رجوع للتعديل / تأكيد حفظ المسودة / تأكيد الإرسال للمراجعة
// After confirmation: shows loading → success state, then closes.
// ---------------------------------------------------------------------------

type ReviewMode = "draft" | "submit";
type ConfirmState = "idle" | "processing" | "done";

export function DemoReviewModal({
  open,
  mode,
  sections,
  onClose,
  onConfirm,
}: {
  open: boolean;
  mode: ReviewMode;
  sections: ReadonlyArray<DemoFormSection>;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [confirmState, setConfirmState] = React.useState<ConfirmState>("idle");
  const [wasOpen, setWasOpen] = React.useState(false);

  // Reset confirm state when modal transitions from closed → open.
  // Derived from render state (no setState-in-effect): we track the previous
  // open value and reset when we detect the transition.
  if (open && !wasOpen) {
    setWasOpen(true);
    if (confirmState !== "idle") setConfirmState("idle");
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  // Close on Escape key
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && confirmState !== "processing") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, confirmState, onClose]);

  if (!open) return null;

  const titleAr = mode === "draft" ? "مراجعة سريعة قبل الحفظ" : "مراجعة سريعة قبل الإرسال";
  const confirmLabel = mode === "draft" ? "تأكيد حفظ المسودة" : "تأكيد الإرسال للمراجعة";

  const handleConfirm = () => {
    setConfirmState("processing");
    window.setTimeout(() => {
      setConfirmState("done");
      window.setTimeout(() => {
        onConfirm();
      }, 800);
    }, 900);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="demo-review-modal-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-overlay backdrop-blur-sm"
        onClick={() => confirmState !== "processing" && onClose()}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-2xl max-h-[85vh] overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
        {/* Header — branded gradient (glass accent allowed here per DEC-076 management surface) */}
        <div className="flex items-center justify-between gap-3 border-b border-border bg-gradient-to-l from-primary/10 via-primary/5 to-transparent px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="inline-block h-6 w-1.5 rounded-full bg-primary" aria-hidden="true" />
            <h2 id="demo-review-modal-title" className="text-heading-3 text-foreground">
              {titleAr}
            </h2>
          </div>
          {confirmState === "idle" && (
            <button
              type="button"
              onClick={onClose}
              aria-label="إغلاق"
              className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        {/* Body — review fields grouped by section (important fields only) */}
        <div className="max-h-[55vh] overflow-y-auto px-5 py-4">
          {confirmState === "done" ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-success/10">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-success" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <p className="mt-3 text-lg font-bold text-foreground">
                {mode === "draft" ? "تم حفظ المسودة" : "تم الإرسال للمراجعة"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                عرض تفاعلي — لم يتم تسجيل أو ترحيل أي بيانات فعلية
              </p>
            </div>
          ) : confirmState === "processing" ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <span className="inline-block h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium text-foreground">
                {mode === "draft" ? "جاري حفظ المسودة..." : "جاري الإرسال للمراجعة..."}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                راجع القيم المُدخلة قبل التأكيد. يمكنك العودة للتعديل إذا لزم الأمر.
              </p>
              {sections.map((section, idx) => (
                <div key={idx} className="rounded-lg border border-border overflow-hidden">
                  <div className="bg-muted/50 px-3 py-2">
                    <h3 className="text-sm font-semibold text-foreground">{section.titleAr}</h3>
                  </div>
                  <dl className="divide-y divide-border">
                    {section.fields.slice(0, 5).map((field, fidx) => (
                      <div key={fidx} className="flex items-start justify-between gap-3 px-3 py-2">
                        <dt className="text-xs text-muted-foreground shrink-0">{field.labelAr}</dt>
                        <dd className="text-sm font-medium text-foreground text-left" dir={field.ltr ? "ltr" : undefined}>
                          {field.ltr ? <LtrValue>{field.defaultValue}</LtrValue> : field.defaultValue}
                        </dd>
                      </div>
                    ))}
                    {section.fields.length > 5 && (
                      <div className="px-3 py-1.5 text-xs text-muted-foreground bg-muted/20">
                        + {section.fields.length - 5} حقول أخرى في هذا القسم
                      </div>
                    )}
                  </dl>
                </div>
              ))}
              <p className="text-xs text-center text-muted-foreground pt-2">
                شاشة تجريبية للعرض — لا يتم تسجيل أو ترحيل أي بيانات
              </p>
            </div>
          )}
        </div>

        {/* Footer — actions */}
        {confirmState !== "processing" && confirmState !== "done" && (
          <div className="flex flex-col gap-2 border-t border-border px-5 py-4 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="min-h-[44px] sm:min-w-[140px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              رجوع للتعديل
            </Button>
            <Button
              type="button"
              variant={mode === "draft" ? "outline" : "primary"}
              onClick={handleConfirm}
              className="min-h-[44px] sm:min-w-[180px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={confirmLabel + " (عرض تفاعلي)"}
            >
              {confirmLabel}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DemoActionButtons — حفظ كمسودة / إرسال للمراجعة
// Opens DemoReviewModal first, then shows loading → success after confirm.
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

export function DemoActionButtons({ sections }: { sections: ReadonlyArray<DemoFormSection> }) {
  const [state, setState] = React.useState<ActionState>("idle");
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const [reviewMode, setReviewMode] = React.useState<ReviewMode>("draft");

  const openReview = (mode: ReviewMode) => {
    setReviewMode(mode);
    setReviewOpen(true);
  };

  const handleConfirm = () => {
    setReviewOpen(false);
    const nextState: ActionState = reviewMode === "draft" ? "saving" : "submitting";
    const doneState: ActionState = reviewMode === "draft" ? "saved-draft" : "submitted";
    setState(nextState);
    window.setTimeout(() => setState(doneState), reviewMode === "draft" ? 900 : 1100);
  };

  return (
    <>
      <div className="mt-6 space-y-3">
        {/* Status banner — appears once an action has been confirmed */}
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
            onClick={() => openReview("draft")}
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
            onClick={() => openReview("submit")}
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

      {/* Review confirmation modal */}
      <DemoReviewModal
        open={reviewOpen}
        mode={reviewMode}
        sections={sections}
        onClose={() => setReviewOpen(false)}
        onConfirm={handleConfirm}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// DemoSegmentedTabs — tab switcher for grouped input pages
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
      className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-border bg-muted/40 p-1"
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
// DemoFormLayout — narrow centered layout for mobile-first input pages
// Wraps the form in a max-w-2xl container so it reads well on desktop too.
// ---------------------------------------------------------------------------

export function DemoFormLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-2xl">{children}</div>
  );
}
