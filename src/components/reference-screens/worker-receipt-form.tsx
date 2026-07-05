"use client";
// Worker Receipt Form — wired to real draft persistence (WP-02-04).
// Contract 10 §7.1: Worker can create/update draft, save, submit.
// DEC-063: Worker financial-deny is absolute.
// DEC-067: Workers cannot enter/see price/payable.

import * as React from "react";
import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LtrValue } from "@/components/ui/ltr-value";
import { SubmitButton } from "@/components/ui/submit-button";
import { createRawReceiptDraftAction } from "@/app/(worker)/worker/raw-receipts/new/actions";

type ActionResult = { success: boolean; draftId: string; status: string } | null;

const inputClass = "w-full min-h-[44px] rounded-md border border-input bg-surface px-3 py-2 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const labelClass = "text-sm font-medium text-muted-foreground mb-1 block";

export function WorkerReceiptForm() {
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

      {result && (
        <div className="mb-4 rounded-lg border border-success/30 bg-success/5 p-3 text-sm">
          <p className="font-medium text-success">تم حفظ المسودة بنجاح</p>
          <p className="text-muted-foreground mt-1">الحالة: مسودة</p>
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
                <input id="purchase-no" name="purchase_no" type="text" dir="ltr" className={inputClass} placeholder="PR-2026-0007" />
              </div>
              <div>
                <label htmlFor="receipt-date" className={labelClass}>تاريخ استلام الخامات</label>
                <input id="receipt-date" name="received_date" type="text" dir="ltr" className={inputClass} placeholder="DD/MM/YYYY" required />
              </div>
              <div>
                <label htmlFor="batch-no" className={labelClass}>رسالة الخام</label>
                <input id="batch-no" name="batch_no" type="text" dir="ltr" className={inputClass} placeholder="1002" required />
              </div>
              <div>
                <label htmlFor="raw-type" className={labelClass}>نوع الخام</label>
                <select id="raw-type" name="raw_type" className={inputClass}>
                  <option value="قطن سودانى">قطن سودانى</option>
                  <option value="قطن مصري">قطن مصري</option>
                  <option value="قطن أمريكي">قطن أمريكي</option>
                  <option value="other">غير موجود في القائمة</option>
                </select>
              </div>
              <div>
                <label htmlFor="raw-grade" className={labelClass}>صنف الخام</label>
                <select id="raw-grade" name="raw_grade" className={inputClass}>
                  <option value="السودان">السودان</option>
                  <option value="مصر">مصر</option>
                  <option value="أمريكا">أمريكا</option>
                  <option value="other">غير موجود في القائمة</option>
                </select>
              </div>
              <div>
                <label htmlFor="supplier" className={labelClass}>مورد الخام</label>
                <select id="supplier" name="supplier" className={inputClass}>
                  <option value="">— اختر المورد —</option>
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
                <label htmlFor="season" className={labelClass}>موسم</label>
                <input id="season" name="season" type="text" dir="ltr" className={inputClass} placeholder="2024/2025" />
              </div>
              <div>
                <label htmlFor="bale-count" className={labelClass}>عدد بال الرسالة</label>
                <input id="bale-count" name="bale_count" type="number" dir="ltr" className={inputClass} min="0" placeholder="25" />
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
                <select id="storage-location" name="storage_location" className={inputClass}>
                  <option value="">— اختر الموقع —</option>
                  <option value="other">غير موجود في القائمة</option>
                </select>
              </div>
              <div>
                <label htmlFor="notes" className={labelClass}>ملاحظات</label>
                <textarea id="notes" name="notes" rows={3} className={inputClass} placeholder="أدخل ملاحظات الاستلام..." />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Actions — real form submit via server action */}
        <div className="mt-6 space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row">
            <SubmitButton variant="outline" className="flex-1" loadingText="جاري الحفظ...">
              حفظ كمسودة
            </SubmitButton>
            <SubmitButton variant="primary" className="flex-1" loadingText="جاري الإرسال...">
              إرسال للمراجعة
            </SubmitButton>
          </div>
          <p className="text-xs text-center text-muted-foreground">
            يتم حفظ بيانات الاستلام كمسودة — لا يتم ترحيل المخزون أو إنشاء قيود مالية
          </p>
        </div>
      </form>
    </Container>
  );
}
