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

export default function ReturnReceipt() {
  const { state, dispatch } = useDemoStore();
  const [date, setDate] = useState(todayIso());
  const [customerId, setCustomerId] = useState("");
  const [saleId, setSaleId] = useState("");
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState(0);
  const [returnLocationId, setReturnLocationId] = useState("");
  const [notes, setNotes] = useState("");
  const [success, setSuccess] = useState<string | null>(null);

  const code = `RET-2026-${String(state.returns.length + 4).padStart(4, "0")}`;
  const valid = Boolean(customerId && itemId && qty > 0 && returnLocationId);

  const onSaveDraft = () => setSuccess(`حُفظت مسودة استلام المرتجع ${code} محليًا.`);
  const onSubmitForReview = () => {
    dispatch({
      type: "ADD_APPROVAL",
      payload: {
        id: `ap-${Math.random().toString(36).slice(2, 9)}`,
        category: "return",
        titleAr: `اعتماد استلام مرتجع ${code} (${qty} كجم)`,
        reference: code,
        submittedAt: date,
        submittedByAr: "عامل المخزن — أحمد",
        quantityKg: qty,
        status: "pending",
        warningAr: "بانتظار اعتماد المحاسب وتحديد التصنيف والمعالجة المالية.",
      },
    });
    setSuccess(`أُرسلت مسودة المرتجع ${code} للمراجعة.`);
  };

  return (
    <WorkerFormScreen
      title="استلام مرتجع عميل"
      description="سجّل الاستلام الفعلي للمرتجع في مخزن المرتجعات. لا تظهر هنا أي قيم مالية أو معالجة ائتمان — يقررها المالك/المحاسب."
      breadcrumbs={[{ label: "استلام مرتجع" }]}
      code={code}
      date={date}
      onDateChange={setDate}
      valid={valid}
      invalidMessage="يرجى اختيار العميل والصنف وموقع الاستلام وإدخال كمية موجبة."
      onSaveDraft={onSaveDraft}
      onSubmitForReview={onSubmitForReview}
      success={success}
      prohibitedFields={[
        "قيمة الائتمان للعميل",
        "معالجة الاستبدال/الاسترداد",
        "تأثير الرصيد المالي",
        "تصنيف إعادة البيع",
      ]}
    >
      <Field label="العميل" htmlFor="customerId" required>
        <Select value={customerId} onValueChange={setCustomerId}>
          <SelectTrigger id="customerId">
            <SelectValue placeholder="اختر العميل" />
          </SelectTrigger>
          <SelectContent>
            {state.customers.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                <BidiValue>{c.code}</BidiValue> — {c.nameAr}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="البيع المرتبط (اختياري)" htmlFor="saleId">
        <Select value={saleId} onValueChange={setSaleId}>
          <SelectTrigger id="saleId">
            <SelectValue placeholder="اختر البيع" />
          </SelectTrigger>
          <SelectContent>
            {state.sales.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                <BidiValue>{s.code}</BidiValue>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="الصنف" htmlFor="itemId" required>
        <Select value={itemId} onValueChange={setItemId}>
          <SelectTrigger id="itemId">
            <SelectValue placeholder="اختر الصنف" />
          </SelectTrigger>
          <SelectContent>
            {state.items.map((i) => (
              <SelectItem key={i.id} value={i.id}>
                <BidiValue>{i.code}</BidiValue> — {i.nameAr}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="الكمية (كجم)" htmlFor="qty" required>
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
      <Field label="موقع استلام المرتجع" htmlFor="returnLocationId" required>
        <Select value={returnLocationId} onValueChange={setReturnLocationId}>
          <SelectTrigger id="returnLocationId">
            <SelectValue placeholder="اختر الموقع" />
          </SelectTrigger>
          <SelectContent>
            {state.locations
              .filter((l) => l.type === "return")
              .map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  <BidiValue>{l.code}</BidiValue> — {l.nameAr}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="ملاحظات" htmlFor="notes">
        <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </WorkerFormScreen>
  );
}
