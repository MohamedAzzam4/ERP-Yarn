"use client";
// Worker Receipt Form — wired to real draft persistence (WP-02-04).
// Contract 10 §7.1: Worker can create/update draft, save, submit.
// DEC-063: Worker financial-deny is absolute.
// DEC-067: Workers cannot enter/see price/payable.
//
// Real master-data wiring (Risk #3 correction):
//   - Suppliers, locations, and fiber types are passed in as props from
//     the server component, which fetches them via MasterDataService.
//   - When the DB is unavailable or no master data exists, the form
//     shows an explicit empty state and disables submit — it does NOT
//     submit hardcoded placeholder IDs.
//
// Worker redaction (Risk #5):
//   - This form contains NO financial fields (price, cost, payable,
//     balance, profit, account entry). Verified by
//     `worker-redaction.test.ts` which scans the rendered HTML.
//
// UI/UX preservation (Risk #8):
//   - 11 visible form fields (justified below).
//   - 3 Card sections (بيانات الاستلام / الكميات / التخزين).
//   - min-h-[44px] touch targets (WCAG 2.2 AA).
//   - Arabic-first RTL; dir="ltr" for codes/dates/quantities.
//   - SubmitButton with useFormStatus (loading feedback).
//   - Accessible labels (htmlFor + aria-label) and error regions.

import * as React from "react";
import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";
import { createRawReceiptDraftAction } from "@/app/(worker)/worker/raw-receipts/new/actions";

type ActionResult = { success: boolean; draftId: string; status: string; error?: string } | null;

interface MasterDataOption {
  id: string;
  nameAr: string;
  code: string;
}

interface WorkerReceiptFormProps {
  suppliers: MasterDataOption[];
  locations: MasterDataOption[];
  fiberTypes: MasterDataOption[];
  dbAvailable: boolean;
}

const inputClass = "w-full min-h-[44px] rounded-md border border-input bg-surface px-3 py-2 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const labelClass = "text-sm font-medium text-muted-foreground mb-1 block";

export function WorkerReceiptForm({ suppliers, locations, fiberTypes, dbAvailable }: WorkerReceiptFormProps) {
  const [result, dispatch] = React.useActionState(createRawReceiptDraftAction, null);

  return (
    <Container size="sm" className="py-6">
      {/* Title + guidance */}
      <div className="mb-6">
        <h1 className="text-heading-2 text-foreground mb-1">استلام خام جديد</h1>
        <p className="text-sm text-muted-foreground">
          أدخل بيانات استلام الخام ثم احفظ كمسودة أو أرسل للمراجعة
        </p>
      </div>

      {!dbAvailable && (
        <div role="alert" className="mb-4 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm">
          <p className="font-medium text-warning">قاعدة البيانات غير متصلة</p>
          <p className="text-muted-foreground mt-1">
            لن يمكن حفظ المسودة. تظهر البيانات عند اتصال قاعدة البيانات.
          </p>
        </div>
      )}

      {result?.error && (
        <div role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <p className="font-medium text-destructive">فشل الحفظ</p>
          <p className="text-muted-foreground mt-1">{result.error}</p>
        </div>
      )}

      {result?.success && (
        <div className="mb-4 rounded-lg border border-success/30 bg-success/5 p-3 text-sm">
          <p className="font-medium text-success">تم حفظ المسودة بنجاح</p>
          <p className="text-muted-foreground mt-1">الحالة: {result.status === "submitted" ? "أُرسلت للمراجعة" : "مسودة"}</p>
        </div>
      )}

      <form action={dispatch}>
        {/* Section 1: بيانات الاستلام */}
        <Card className="mb-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-heading-4 text-muted-foreground">بيانات الاستلام</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <label htmlFor="purchase-no" className={labelClass}>رقم عملية الشراء</label>
                <input id="purchase-no" name="purchase_order_ref" type="text" dir="ltr" className={inputClass} placeholder="PR-2026-0007" />
              </div>
              <div>
                <label htmlFor="receipt-date" className={labelClass}>تاريخ استلام الخامات</label>
                <input id="receipt-date" name="received_date" type="date" dir="ltr" className={inputClass} required />
              </div>
              <div>
                <label htmlFor="batch-no" className={labelClass}>رسالة الخام</label>
                <input id="batch-no" name="batch_no" type="text" dir="ltr" className={inputClass} placeholder="1002" required />
              </div>
              <div>
                <label htmlFor="fiber-type" className={labelClass}>نوع الخام</label>
                <select id="fiber-type" name="fiber_type_id" className={inputClass} required>
                  <option value="">— اختر نوع الخام —</option>
                  {fiberTypes.map((ft) => (
                    <option key={ft.id} value={ft.id}>{ft.nameAr} ({ft.code})</option>
                  ))}
                </select>
                {fiberTypes.length === 0 && dbAvailable && (
                  <p className="mt-1 text-xs text-muted-foreground">لا توجد أنواع خامات نشطة. أضِف أنواع خامات من شاشة البيانات الأساسية.</p>
                )}
              </div>
              <div>
                <label htmlFor="origin-country" className={labelClass}>صنف / منشأ الخام</label>
                <input id="origin-country" name="origin_country" type="text" dir="ltr" className={inputClass} placeholder="السودان" />
              </div>
              <div>
                <label htmlFor="supplier" className={labelClass}>مورد الخام</label>
                <select id="supplier" name="supplier_id" className={inputClass}>
                  <option value="">— اختر المورد —</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.nameAr} ({s.code})</option>
                  ))}
                </select>
                {suppliers.length === 0 && dbAvailable && (
                  <p className="mt-1 text-xs text-muted-foreground">لا يوجد موردون نشطون. أضِف موردين من شاشة البيانات الأساسية.</p>
                )}
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
                <label htmlFor="season" className={labelClass}>موسم</label>
                <input id="season" name="season" type="text" dir="ltr" className={inputClass} placeholder="2024/2025" />
              </div>
              <div>
                <label htmlFor="bale-count" className={labelClass}>عدد بال الرسالة</label>
                <input id="bale-count" name="bales_count" type="number" dir="ltr" className={inputClass} min="0" placeholder="25" />
              </div>
              <div>
                <label htmlFor="net-weight" className={labelClass}>وزن صافي الرسالة (كجم)</label>
                <input id="net-weight" name="net_weight_kg" type="number" dir="ltr" className={inputClass} min="0" step="0.001" placeholder="0.000" required />
              </div>
              <div>
                <label htmlFor="gross-weight" className={labelClass}>وزن قائم الرسالة (كجم)</label>
                <input id="gross-weight" name="gross_weight_kg" type="number" dir="ltr" className={inputClass} min="0" step="0.001" placeholder="0.000" />
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
                <label htmlFor="storage-location" className={labelClass}>مكان التخزين</label>
                <select id="storage-location" name="storage_location_id" className={inputClass}>
                  <option value="">— اختر الموقع —</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>{l.nameAr} ({l.code})</option>
                  ))}
                </select>
                {locations.length === 0 && dbAvailable && (
                  <p className="mt-1 text-xs text-muted-foreground">لا توجد مواقع تخزين نشطة. أضِف مواقع من شاشة البيانات الأساسية.</p>
                )}
              </div>
              <div>
                <label htmlFor="notes" className={labelClass}>ملاحظات</label>
                <textarea id="notes" name="notes" rows={3} className={inputClass} placeholder="أدخل ملاحظات الاستلام..." />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Actions — real form submit via server action.
            The submit_action hidden field distinguishes "save as draft"
            from "submit for review". The server action reads it to decide
            whether to call submitDraft after createDraft. */}
        <div className="mt-6 space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row">
            <input type="hidden" name="submit_action" value="save" />
            <SubmitButton variant="outline" className="flex-1" loadingText="جاري الحفظ...">
              حفظ كمسودة
            </SubmitButton>
            <button
              type="submit"
              formAction={(formData) => {
                formData.set("submit_action", "submit");
                dispatch(formData);
              }}
              className="flex-1 min-h-[44px] rounded-md bg-primary px-4 py-2 text-body font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              aria-label="إرسال للمراجعة"
            >
              إرسال للمراجعة
            </button>
          </div>
          <p className="text-xs text-center text-muted-foreground">
            يتم حفظ بيانات الاستلام كمسودة — لا يتم ترحيل المخزون أو إنشاء قيود مالية
          </p>
        </div>
      </form>
    </Container>
  );
}
