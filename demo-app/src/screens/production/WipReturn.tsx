import { useState } from "react";
import { WorkerFormScreen } from "@/screen-utils/WorkerFormScreen";
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
import { useDemoStore } from "@/store/DemoStoreContext";
import { todayIso } from "@/lib/utils";

export default function WipReturn() {
  const { state, dispatch } = useDemoStore();
  const [date, setDate] = useState(todayIso());
  const [orderId, setOrderId] = useState("");
  const [returnLocationId, setReturnLocationId] = useState("");
  const [qty, setQty] = useState(0);
  const [notes, setNotes] = useState("");
  const [success, setSuccess] = useState<string | null>(null);

  const code = `WIPR-2026-${String(state.movements.filter((m) => m.type === "wip_return").length + 1).padStart(4, "0")}`;
  const valid = Boolean(orderId && returnLocationId && qty > 0);

  const onSaveDraft = () => setSuccess(`حُفظت مسودة طلب إرجاع الودائع ${code} محليًا.`);
  const onSubmitForReview = () => {
    dispatch({
      type: "ADD_APPROVAL",
      payload: {
        id: `ap-${Math.random().toString(36).slice(2, 9)}`,
        category: "wip_return",
        titleAr: `طلب إرجاع ودائع ${code} (${qty} كجم)`,
        reference: code,
        submittedAt: date,
        submittedByAr: "عامل الإنتاج — سامي",
        quantityKg: qty,
        status: "pending",
        warningAr: "إرجاع الودائع تحكمه موافقة المالك/المحاسب ولا يتم تلقائيًا.",
      },
    });
    setSuccess(`أُرسل طلب إرجاع الودائع ${code} للمراجعة.`);
  };

  return (
    <WorkerFormScreen
      title="مرتجع/متبقي ودائع الإنتاج"
      description="طلب إرجاع ما تبقى من مدخلات غير معالَجة من ودائع الإنتاج إلى مخزون الشركة. يتطلب اعتماد المالك/المحاسب."
      breadcrumbs={[{ label: "مرتجع ودائع" }]}
      code={code}
      date={date}
      onDateChange={setDate}
      valid={valid}
      invalidMessage="يرجى اختيار أمر الإنتاج وموقع الإرجاع وإدخال كمية موجبة."
      onSaveDraft={onSaveDraft}
      onSubmitForReview={onSubmitForReview}
      success={success}
      prohibitedFields={[
        "تأثير التكلفة على الربحية",
        "إعادة حساب المستحق على المصنع",
        "تعديل اللقطة المعتمدة لمعدل التشغيل",
      ]}
    >
      <Field label="أمر الإنتاج" htmlFor="orderId" required>
        <Select value={orderId} onValueChange={setOrderId}>
          <SelectTrigger id="orderId">
            <SelectValue placeholder="اختر أمر الإنتاج" />
          </SelectTrigger>
          <SelectContent>
            {state.productionOrders.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                <BidiValue>{p.code}</BidiValue> — متبقي{" "}
                <BidiValue numeric>{p.wipRemainingKg.toLocaleString("en-US")}</BidiValue> كجم
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="موقع الإرجاع" htmlFor="returnLocationId" required>
        <Select value={returnLocationId} onValueChange={setReturnLocationId}>
          <SelectTrigger id="returnLocationId">
            <SelectValue placeholder="اختر الموقع" />
          </SelectTrigger>
          <SelectContent>
            {state.locations
              .filter((l) => l.type === "internal" || l.type === "factory")
              .map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  <BidiValue>{l.code}</BidiValue> — {l.nameAr}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="الكمية المرتجعة (كجم)" htmlFor="qty" required>
        <Input
          id="qty"
          type="number"
          step="0.001"
          min="0"
          dir="ltr"
          className="text-left"
          value={qty || ""}
          onChange={(e) => setQty(Number(e.target.value))}
        />
      </Field>
      <Field label="ملاحظات" htmlFor="notes">
        <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </WorkerFormScreen>
  );
}
