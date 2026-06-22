import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertCircle, CheckCircle2, Save, Send } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form";
import { Input, Textarea } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BidiValue } from "@/components/shared/BidiValue";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useDemoStore } from "@/store/DemoStoreContext";
import { todayIso, uid } from "@/lib/utils";

const schema = z.object({
  batchCode: z
    .string()
    .min(3, "رقم الرسالة قصير جدًا.")
    .regex(/^[A-Z0-9-]+$/, "استخدم أحرفًا لاتينية وأرقامًا وشرطات فقط."),
  supplierId: z.string().min(1, "اختر المورد."),
  itemId: z.string().min(1, "اختر الصنف."),
  quantityKg: z.coerce
    .number({ invalid_type_error: "أدخل كمية رقمية." })
    .positive("الكمية يجب أن تكون أكبر من صفر.")
    .max(1_000_000, "الكمية غير معقولة."),
  baleCount: z.coerce
    .number({ invalid_type_error: "أدخل عددًا صحيحًا." })
    .int("عدد البالات يجب أن يكون صحيحًا.")
    .min(0, "لا يمكن أن يكون سالبًا.")
    .optional(),
  receiptLocationId: z.string().min(1, "اختر موقع الاستلام."),
  receiptDate: z.string().min(1, "أدخل تاريخ الاستلام."),
  notes: z.string().max(500, "ملاحظات طويلة جدًا.").optional(),
});

type FormValues = z.infer<typeof schema>;

/**
 * Worker Raw-Material Receipt — Reference Screen (per design contract §7.1
 * + screen contracts §7.1).
 *
 * Prohibited fields (per contract): price per ton, total cost, supplier
 * balance, profitability. Workers see no financial data.
 */
export default function RawMaterialReceipt() {
  const { state, dispatch, advanceStory, nextShowcaseCode } = useDemoStore();
  const [submitForReview, setSubmitForReview] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const today = todayIso();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    watch,
    setValue,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      batchCode: nextShowcaseCode("RB"),
      receiptDate: today,
      quantityKg: 0,
      baleCount: undefined,
      notes: "",
    },
    mode: "onBlur",
  });

  const supplierId = watch("supplierId");
  const itemId = watch("itemId");
  const receiptLocationId = watch("receiptLocationId");

  const onSubmit = (values: FormValues) => {
    // Save a local demo activity entry — no backend, no accounting.
    const supplier = state.suppliers.find((s) => s.id === supplierId);
    const location = state.locations.find((l) => l.id === receiptLocationId);

    if (submitForReview) {
      dispatch({
        type: "ADD_APPROVAL",
        payload: {
          id: uid("ap"),
          category: "raw_receipt",
          titleAr: `اعتماد استلام خام ${values.batchCode} (${values.quantityKg} كجم)`,
          reference: values.batchCode,
          submittedAt: values.receiptDate,
          submittedByAr: "عامل المخزن — أحمد",
          quantityKg: values.quantityKg,
          status: "pending",
          warningAr: "بانتظار اعتماد المحاسب قبل الترحيل الفعلي.",
        },
      });
      setSuccessMsg(`أُرسلت مسودة استلام الرسالة ${values.batchCode} للمراجعة.`);
    } else {
      dispatch({
        type: "RAW_RECEIPT_DEMO",
        payload: {
          code: values.batchCode,
          supplierName: supplier?.nameAr ?? "مورد غير معروف",
          quantityKg: values.quantityKg,
          location: location?.nameAr ?? "موقع غير معروف",
        },
      });
      setSuccessMsg(`حُفظت مسودة استلام الرسالة ${values.batchCode} محليًا.`);
    }

    // Advance the coherent demo story on first submission.
    if (!state.storyProgress.step1_rawReceipt) {
      advanceStory("step1_rawReceipt");
    }

    reset({
      batchCode: nextShowcaseCode("RB"),
      receiptDate: today,
      quantityKg: 0,
      baleCount: undefined,
      notes: "",
    });
    setConfirmOpen(false);
  };

  const watchQuantity = watch("quantityKg");

  return (
    <div className="space-y-6">
      <PageHeader
        title="استلام رسالة خام"
        description="سجّل البيانات التشغيلية فقط. لا تظهر هنا أي أسعار أو تكاليف أو أرصدة — يحتفظ النظام التشغيلي بإخفاء البيانات المالية عن دور العامل."
        breadcrumbs={[{ label: "وضع مهام العامل" }, { label: "استلام خام" }]}
      />

      <Card className="border-warning/30 bg-warning/5">
        <CardContent className="flex items-start gap-3 p-4 text-sm">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
          <p className="text-xs text-warning-foreground" dir="rtl">
            ملخص الإدخال: رقم الرسالة <BidiValue>{watch("batchCode") || "—"}</BidiValue>، الكمية{" "}
            <BidiValue numeric>{watchQuantity || 0}</BidiValue> كجم. بعد الإرسال للمراجعة يصبح السجل
            للقراءة فقط ولا يمكن تعديله إلا عبر طلب تصحيح.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>بيانات الاستلام</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field
                label="رقم الرسالة الخام"
                required
                htmlFor="batchCode"
                error={errors.batchCode?.message}
              >
                <Input
                  id="batchCode"
                  dir="ltr"
                  className="text-left"
                  {...register("batchCode")}
                  aria-invalid={!!errors.batchCode}
                />
              </Field>

              <Field
                label="تاريخ الاستلام"
                required
                htmlFor="receiptDate"
                error={errors.receiptDate?.message}
              >
                <Input id="receiptDate" type="date" dir="ltr" {...register("receiptDate")} />
              </Field>

              <Field
                label="المورد"
                required
                htmlFor="supplierId"
                error={errors.supplierId?.message}
              >
                <Select
                  value={supplierId ?? ""}
                  onValueChange={(v) => setValue("supplierId", v, { shouldValidate: true })}
                >
                  <SelectTrigger id="supplierId">
                    <SelectValue placeholder="اختر المورد" />
                  </SelectTrigger>
                  <SelectContent>
                    {state.suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        <BidiValue>{s.code}</BidiValue> — {s.nameAr}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="الصنف" required htmlFor="itemId" error={errors.itemId?.message}>
                <Select
                  value={itemId ?? ""}
                  onValueChange={(v) => setValue("itemId", v, { shouldValidate: true })}
                >
                  <SelectTrigger id="itemId">
                    <SelectValue placeholder="اختر الصنف" />
                  </SelectTrigger>
                  <SelectContent>
                    {state.items
                      .filter((i) => i.category === "raw")
                      .map((i) => (
                        <SelectItem key={i.id} value={i.id}>
                          <BidiValue>{i.code}</BidiValue> — {i.nameAr}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field
                label="الكمية (كجم)"
                required
                htmlFor="quantityKg"
                error={errors.quantityKg?.message}
              >
                <Input
                  id="quantityKg"
                  type="number"
                  step="0.001"
                  min="0"
                  dir="ltr"
                  className="text-left"
                  {...register("quantityKg")}
                />
              </Field>

              <Field label="عدد البالات" htmlFor="baleCount" error={errors.baleCount?.message}>
                <Input
                  id="baleCount"
                  type="number"
                  step="1"
                  min="0"
                  dir="ltr"
                  className="text-left"
                  {...register("baleCount")}
                />
              </Field>

              <Field
                label="موقع الاستلام"
                required
                htmlFor="receiptLocationId"
                error={errors.receiptLocationId?.message}
              >
                <Select
                  value={receiptLocationId ?? ""}
                  onValueChange={(v) => setValue("receiptLocationId", v, { shouldValidate: true })}
                >
                  <SelectTrigger id="receiptLocationId">
                    <SelectValue placeholder="اختر موقع الاستلام" />
                  </SelectTrigger>
                  <SelectContent>
                    {state.locations
                      .filter((l) => l.type === "internal" || l.type === "port")
                      .map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          <BidiValue>{l.code}</BidiValue> — {l.nameAr}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="ملاحظات" htmlFor="notes" error={errors.notes?.message}>
                <Textarea id="notes" rows={2} {...register("notes")} />
              </Field>
            </div>

            {Object.keys(errors).length > 0 ? (
              <div
                role="alert"
                className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger"
              >
                <p className="font-semibold" dir="rtl">
                  يرجى تصحيح الأخطاء التالية قبل الإرسال:
                </p>
                <ul className="mt-1 list-disc ps-5 text-xs">
                  {Object.entries(errors).map(([k, v]) => (
                    <li key={k} dir="rtl">
                      {v.message as string}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="worker"
                onClick={() => {
                  setSubmitForReview(false);
                  setConfirmOpen(true);
                }}
              >
                <Save className="h-4 w-4" aria-hidden />
                حفظ كمسودة
              </Button>
              <Button
                type="button"
                variant="accent"
                size="worker"
                onClick={() => {
                  setSubmitForReview(true);
                  setConfirmOpen(true);
                }}
              >
                <Send className="h-4 w-4" aria-hidden />
                إرسال للمراجعة
              </Button>
              <span className="text-xs text-muted-foreground">
                {isSubmitting ? "جاري الحفظ..." : null}
              </span>
            </div>
          </form>
        </CardContent>
      </Card>

      {successMsg ? (
        <Card className="border-success/30 bg-success/5">
          <CardContent className="flex items-start gap-3 p-4 text-sm">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />
            <p className="text-success-foreground" dir="rtl">
              {successMsg}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>حقول محظورة على هذه الشاشة</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-2 text-xs text-muted-foreground sm:grid-cols-2">
          <p>• سعر الطن — مخفي على العامل.</p>
          <p>• إجمالي التكلفة — مخفي على العامل.</p>
          <p>• رصيد المورد — مخفي على العامل.</p>
          <p>• أي بيانات ربحية — مخفية على العامل.</p>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={submitForReview ? "تأكيد إرسال للمراجعة" : "تأكيد حفظ المسودة"}
        description={
          submitForReview
            ? "سيصبح السجل للقراءة فقط بعد الإرسال، ولا يمكن تعديله إلا بطلب تصحيح من المحاسب."
            : "ستبقى المسودة قابلة للتعديل حتى الإرسال للمراجعة."
        }
        confirmLabel={submitForReview ? "إرسال" : "حفظ"}
        onConfirm={handleSubmit(onSubmit)}
      />
    </div>
  );
}
