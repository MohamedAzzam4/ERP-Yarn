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

export default function MaterialIssue() {
  const { state, dispatch, advanceStory } = useDemoStore();
  const [date, setDate] = useState(todayIso());
  const [factoryId, setFactoryId] = useState("");
  const [orderId, setOrderId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [qty, setQty] = useState(0);
  const [notes, setNotes] = useState("");
  const [success, setSuccess] = useState<string | null>(null);

  const code = `ISS-2026-${String(state.movements.filter((m) => m.type === "issue_to_production").length + 5).padStart(4, "0")}`;
  const valid = Boolean(factoryId && orderId && batchId && qty > 0);
  const factory = state.factories.find((f) => f.id === factoryId);

  const onSaveDraft = () => setSuccess(`حُفظت مسودة الصرف ${code} محليًا.`);
  const onSubmitForReview = () => {
    dispatch({
      type: "ISSUE_DEMO",
      payload: { code, quantityKg: qty, factory: factory?.nameAr ?? "—" },
    });
    dispatch({
      type: "ADD_APPROVAL",
      payload: {
        id: `ap-${Math.random().toString(36).slice(2, 9)}`,
        category: "production_issue",
        titleAr: `اعتماد صرف للإنتاج ${code} (${qty} كجم)`,
        reference: code,
        submittedAt: date,
        submittedByAr: "عامل الإنتاج — سامي",
        quantityKg: qty,
        status: "pending",
        warningAr: "بانتظار اعتماد المحاسب قبل ترحيل الصرف على ودائع الإنتاج.",
      },
    });
    if (!state.storyProgress.step3_issue) advanceStory("step3_issue");
    setSuccess(`أُرسل الصرف ${code} (${qty} كجم) للمراجعة.`);
  };

  return (
    <WorkerFormScreen
      title="صرف للإنتاج"
      description="صرف مدخلات من مخزون المصنع إلى أمر إنتاج. لا تظهر هنا معدلات التشغيل أو المستحقات أو التكاليف."
      breadcrumbs={[{ label: "صرف للإنتاج" }]}
      code={code}
      date={date}
      onDateChange={setDate}
      valid={valid}
      invalidMessage="يرجى اختيار المصنع وأمر الإنتاج والرسالة وإدخال كمية موجبة."
      onSaveDraft={onSaveDraft}
      onSubmitForReview={onSubmitForReview}
      success={success}
      prohibitedFields={[
        "معدل تشغيل المصنع per ton",
        "المستحق على المصنع",
        "أساس التكلفة المباشرة",
        "تخصيص التكلفة والربحية",
      ]}
    >
      <Field label="المصنع" htmlFor="factoryId" required>
        <Select value={factoryId} onValueChange={setFactoryId}>
          <SelectTrigger id="factoryId">
            <SelectValue placeholder="اختر المصنع" />
          </SelectTrigger>
          <SelectContent>
            {state.factories.map((f) => (
              <SelectItem key={f.id} value={f.id}>
                <BidiValue>{f.code}</BidiValue> — {f.nameAr}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="أمر الإنتاج" htmlFor="orderId" required>
        <Select value={orderId} onValueChange={setOrderId}>
          <SelectTrigger id="orderId">
            <SelectValue placeholder="اختر أمر الإنتاج" />
          </SelectTrigger>
          <SelectContent>
            {state.productionOrders.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                <BidiValue>{p.code}</BidiValue> — {p.type === "single_yarn" ? "فرد" : "زوى"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="الرسالة/اللوت (مدخل)" htmlFor="batchId" required>
        <Select value={batchId} onValueChange={setBatchId}>
          <SelectTrigger id="batchId">
            <SelectValue placeholder="اختر المدخل" />
          </SelectTrigger>
          <SelectContent>
            {state.rawBatches.map((b) => {
              const item = state.items.find((i) => i.id === b.itemId);
              return (
                <SelectItem key={b.id} value={b.id}>
                  <BidiValue>{b.code}</BidiValue> — {item?.nameAr ?? "—"}
                </SelectItem>
              );
            })}
            {state.yarnLots
              .filter((l) => l.category === "single_yarn")
              .map((l) => {
                const item = state.items.find((i) => i.id === l.itemId);
                return (
                  <SelectItem key={l.id} value={l.id}>
                    <BidiValue>{l.code}</BidiValue> — {item?.nameAr ?? "—"}
                  </SelectItem>
                );
              })}
          </SelectContent>
        </Select>
      </Field>
      <Field label="الكمية المصروفة (كجم)" htmlFor="qty" required>
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
