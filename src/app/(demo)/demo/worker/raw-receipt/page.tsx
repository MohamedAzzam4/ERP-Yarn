/**
 * Demo Worker Raw-Material Receipt — stakeholder visual demo.
 *
 * Route: /demo/worker/raw-receipt
 *
 * Mirrors the approved WorkerReceiptReference screen (DEC-076 worker safety:
 * no glass, no primary gradients, no financial terminology) but adds:
 *   - Clickable "حفظ كمسودة" and "إرسال للمراجعة" buttons that simulate a
 *     pending → success state transition (no real submit, no API).
 *   - Visible loading spinner + status chip during the simulated action.
 *   - Status banner that appears after action (مسودة محفوظة / مرسل للمراجعة).
 *
 * Per Contract 02 §Worker Task Mode:
 *   - All inputs are min-h-[44px] (touch targets).
 *   - Form is grouped into clear sections with visible labels.
 *   - NO financial fields (no price, cost, balance, payable).
 *   - "غير موجود في القائمة" option routes to review (no master data is
 *     silently created) — represented here by the "other" option.
 *   - type="button" everywhere — no actual form submit.
 */
"use client";

import * as React from "react";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LtrValue } from "@/components/ui/ltr-value";
import { cn } from "@/lib/cn";
import {
  WORKER_RECEIPT_FIXTURE,
  FIXTURE_LOCATIONS,
  FIXTURE_PARTIES,
} from "@/lib/fixtures/reference-fixtures";

const inputClass =
  "w-full min-h-[44px] rounded-md border border-input bg-surface px-3 py-2 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const labelClass = "text-sm font-medium text-muted-foreground mb-1 block";

const supplierOptions = FIXTURE_PARTIES.filter((p) => p.type === "supplier");
const locationOptions = FIXTURE_LOCATIONS.filter((l) => l.type === "warehouse");

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

export default function DemoWorkerRawReceiptPage() {
  const fixture = WORKER_RECEIPT_FIXTURE;
  const f = fixture.fields;
  const [state, setState] = React.useState<ActionState>("idle");

  // Standalone worker screen — render plain chrome (NO management sidebar).
  // Worker Task Mode (Contract 02): no glass, no heavy brand gradients.
  return (
    <div className="min-h-screen bg-background">
      {/* Header — sticky, plain (no glass, no gradient). */}
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
                <h1 className="text-heading-3 text-foreground">المهام</h1>
                <p className="text-sm text-muted-foreground">عامل مخزن 1 · عرض تفاعلي</p>
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
        <Container size="sm">
          {/* Plain title block — NO gradient, NO glass (DEC-076 worker safety) */}
          <div className="mb-4">
            <h2 className="text-heading-2 text-foreground mb-1">{fixture.screenTitle}</h2>
            <p className="text-sm text-muted-foreground">
              أدخل بيانات استلام الخام ثم احفظ كمسودة أو أرسل للمراجعة
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
                {state === "submitted" && "بانتظار اعتماد المحاسب — لم يُرحَّل شيء بعد."}
              </span>
            </div>
          )}

          {/* Section 1: بيانات الاستلام */}
          <Card className="mb-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-heading-4 text-muted-foreground">بيانات الاستلام</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <label htmlFor="purchase-no" className={labelClass}>{f[0]!.labelAr}</label>
                  <input id="purchase-no" name="purchase_no" type="text" dir="ltr" defaultValue={f[0]!.value} className={inputClass} placeholder="PR-2026-0007" />
                </div>
                <div>
                  <label htmlFor="receipt-date" className={labelClass}>{f[1]!.labelAr}</label>
                  <input id="receipt-date" name="receipt_date" type="text" dir="ltr" defaultValue={f[1]!.value} className={inputClass} placeholder="DD/MM/YYYY" />
                </div>
                <div>
                  <label htmlFor="raw-type" className={labelClass}>{f[2]!.labelAr}</label>
                  <select id="raw-type" name="raw_type" defaultValue={f[2]!.value} className={inputClass}>
                    <option value="قطن سودانى">قطن سودانى</option>
                    <option value="قطن مصري">قطن مصري</option>
                    <option value="قطن أمريكي">قطن أمريكي</option>
                    <option value="other">غير موجود في القائمة</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="raw-grade" className={labelClass}>{f[3]!.labelAr}</label>
                  <select id="raw-grade" name="raw_grade" defaultValue={f[3]!.value} className={inputClass}>
                    <option value="السودان">السودان</option>
                    <option value="مصر">مصر</option>
                    <option value="أمريكا">أمريكا</option>
                    <option value="other">غير موجود في القائمة</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="supplier" className={labelClass}>{f[4]!.labelAr}</label>
                  <select id="supplier" name="supplier" defaultValue={f[4]!.value} className={inputClass}>
                    {supplierOptions.map((s) => (
                      <option key={s.code} value={s.nameAr}>{s.nameAr}</option>
                    ))}
                    <option value="other">غير موجود في القائمة</option>
                  </select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Section 2: الكميات والأوزان */}
          <Card className="mb-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-heading-4 text-muted-foreground">الكميات والأوزان</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <label htmlFor="lot-code" className={labelClass}>{f[5]!.labelAr}</label>
                  <input id="lot-code" name="lot_code" type="text" dir="ltr" defaultValue={f[5]!.value} className={inputClass} placeholder="1002" />
                </div>
                <div>
                  <label htmlFor="season" className={labelClass}>{f[6]!.labelAr}</label>
                  <input id="season" name="season" type="text" dir="ltr" defaultValue={f[6]!.value} className={inputClass} placeholder="2024/2025" />
                </div>
                <div>
                  <label htmlFor="bale-count" className={labelClass}>{f[7]!.labelAr}</label>
                  <input id="bale-count" name="bale_count" type="number" dir="ltr" defaultValue={f[7]!.value} className={inputClass} min="0" placeholder="25" />
                </div>
                <div>
                  <label htmlFor="gross-weight" className={labelClass}>{f[8]!.labelAr}</label>
                  <input id="gross-weight" name="gross_weight_kg" type="number" dir="ltr" defaultValue="1,250.000" className={inputClass} min="0" step="0.001" placeholder="0.000" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Section 3: التخزين والملاحظات */}
          <Card className="mb-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-heading-4 text-muted-foreground">التخزين والملاحظات</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <label htmlFor="storage-location" className={labelClass}>{f[9]!.labelAr}</label>
                  <select id="storage-location" name="storage_location" defaultValue={f[9]!.value} className={inputClass}>
                    {locationOptions.map((l) => (
                      <option key={l.code} value={l.nameAr}>{l.nameAr}</option>
                    ))}
                    <option value="other">غير موجود في القائمة</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="notes" className={labelClass}>{f[10]!.labelAr}</label>
                  <textarea
                    id="notes"
                    name="notes"
                    rows={3}
                    defaultValue={f[10]!.value}
                    className={inputClass}
                    placeholder="أدخل ملاحظات الاستلام..."
                  />
                </div>
              </div>
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
              <Button
                type="button"
                variant="ghost"
                disabled={state === "saving" || state === "submitting"}
                className="min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                إضافة ملاحظة
              </Button>
            </div>
            <p className="text-xs text-center text-muted-foreground">
              هذه شاشة عرض تفاعلي ببيانات تجريبية — لا يتم تسجيل أو ترحيل أي بيانات،
              ولا تتم أي كتابة إلى قاعدة البيانات. أزرار الحفظ/الإرسال تعرض تغذية راجعة
              محاكاة فقط.
            </p>
          </div>
        </Container>
      </main>
    </div>
  );
}
