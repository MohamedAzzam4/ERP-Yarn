/**
 * WP-01-05 Worker Raw-Material Receipt Reference Screen.
 *
 * Contract: docs/contracts/10_frontend_screen_contracts.md §7.1
 * Contract: docs/design/01_reference_screen_terms_and_fixtures.md §5
 *
 * Fixture: reference-fixtures-v1
 * Route: /worker/raw-receipts/new
 *
 * This is a DATA-ENTRY REFERENCE FORM (not a read-only details page).
 * It shows real form controls (input/select/textarea) pre-filled with
 * fixture data, grouped into clear sections. No real submit/mutation
 * occurs — buttons are type="button" with demo-only helper text.
 */
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WORKER_RECEIPT_FIXTURE, FIXTURE_LOCATIONS, FIXTURE_PARTIES } from "@/lib/fixtures/reference-fixtures";

// Form field input class (shared)
const inputClass = "w-full min-h-[44px] rounded-md border border-input bg-surface px-3 py-2 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

// Field label class
const labelClass = "text-sm font-medium text-muted-foreground mb-1 block";

// Fixture field values (for pre-filling)
const f = WORKER_RECEIPT_FIXTURE.fields;

// Supplier options from fixture
const supplierOptions = FIXTURE_PARTIES.filter((p) => p.type === "supplier");
// Location options from fixture
const locationOptions = FIXTURE_LOCATIONS.filter((l) => l.type === "warehouse");

export function WorkerReceiptReference() {
  const fixture = WORKER_RECEIPT_FIXTURE;

  return (
    <Container size="sm" className="py-6">
      {/* Title + guidance */}
      <div className="mb-6">
        <h1 className="text-heading-2 text-foreground mb-1">{fixture.screenTitle}</h1>
        <p className="text-sm text-muted-foreground">
          أدخل بيانات استلام الخام ثم احفظ كمسودة أو أرسل للمراجعة
        </p>
      </div>

      {/* Section 1: بيانات الاستلام */}
      <Card className="mb-4">
        <CardHeader className="pb-3">
          <CardTitle className="text-heading-4 text-muted-foreground">بيانات الاستلام</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* رقم عملية الشراء */}
            <div>
              <label htmlFor="purchase-no" className={labelClass}>{f[0]!.labelAr}</label>
              <input
                id="purchase-no"
                name="purchase_no"
                type="text"
                dir="ltr"
                defaultValue={f[0]!.value}
                className={inputClass}
                placeholder="PR-2026-0007"
              />
            </div>

            {/* تاريخ استلام الخامات */}
            <div>
              <label htmlFor="receipt-date" className={labelClass}>{f[1]!.labelAr}</label>
              <input
                id="receipt-date"
                name="receipt_date"
                type="text"
                dir="ltr"
                defaultValue={f[1]!.value}
                className={inputClass}
                placeholder="DD/MM/YYYY"
              />
            </div>

            {/* نوع الخام */}
            <div>
              <label htmlFor="raw-type" className={labelClass}>{f[2]!.labelAr}</label>
              <select id="raw-type" name="raw_type" defaultValue={f[2]!.value} className={inputClass}>
                <option value="قطن سودانى">قطن سودانى</option>
                <option value="قطن مصري">قطن مصري</option>
                <option value="قطن أمريكي">قطن أمريكي</option>
                <option value="other">غير موجود في القائمة</option>
              </select>
            </div>

            {/* صنف الخام */}
            <div>
              <label htmlFor="raw-grade" className={labelClass}>{f[3]!.labelAr}</label>
              <select id="raw-grade" name="raw_grade" defaultValue={f[3]!.value} className={inputClass}>
                <option value="السودان">السودان</option>
                <option value="مصر">مصر</option>
                <option value="أمريكا">أمريكا</option>
                <option value="other">غير موجود في القائمة</option>
              </select>
            </div>

            {/* مورد الخام */}
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
            {/* رسالة الخام */}
            <div>
              <label htmlFor="lot-code" className={labelClass}>{f[5]!.labelAr}</label>
              <input
                id="lot-code"
                name="lot_code"
                type="text"
                dir="ltr"
                defaultValue={f[5]!.value}
                className={inputClass}
                placeholder="1002"
              />
            </div>

            {/* موسم */}
            <div>
              <label htmlFor="season" className={labelClass}>{f[6]!.labelAr}</label>
              <input
                id="season"
                name="season"
                type="text"
                dir="ltr"
                defaultValue={f[6]!.value}
                className={inputClass}
                placeholder="2024/2025"
              />
            </div>

            {/* عدد بال الرسالة */}
            <div>
              <label htmlFor="bale-count" className={labelClass}>{f[7]!.labelAr}</label>
              <input
                id="bale-count"
                name="bale_count"
                type="number"
                dir="ltr"
                defaultValue={f[7]!.value}
                className={inputClass}
                min="0"
                placeholder="25"
              />
            </div>

            {/* وزن قائم الرسالة */}
            <div>
              <label htmlFor="gross-weight" className={labelClass}>{f[8]!.labelAr}</label>
              <input
                id="gross-weight"
                name="gross_weight_kg"
                type="number"
                dir="ltr"
                defaultValue="1,250.000"
                className={inputClass}
                min="0"
                step="0.001"
                placeholder="0.000"
              />
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
            {/* مكان التخزين */}
            <div>
              <label htmlFor="storage-location" className={labelClass}>{f[9]!.labelAr}</label>
              <select id="storage-location" name="storage_location" defaultValue={f[9]!.value} className={inputClass}>
                {locationOptions.map((l) => (
                  <option key={l.code} value={l.nameAr}>{l.nameAr}</option>
                ))}
                <option value="other">غير موجود في القائمة</option>
              </select>
            </div>

            {/* ملاحظات */}
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

      {/* Actions — demo only, no real submit */}
      <div className="mt-6 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row">
          {fixture.allowedActions.map((action, idx) => (
            <Button
              key={action}
              type="button"
              variant={idx === 1 ? "primary" : "outline"}
              className="min-h-[44px] flex-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label={action}
            >
              {action}
            </Button>
          ))}
        </div>
        <p className="text-xs text-center text-muted-foreground">
          هذه شاشة مرجعية ببيانات تجريبية — لا يتم تسجيل أو ترحيل أي بيانات
        </p>
      </div>
    </Container>
  );
}
