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

interface ReceiptProps {
  lotType: "single" | "twisted";
}

export function ProductionReceipt({ lotType }: ReceiptProps) {
  const { state, dispatch, advanceStory } = useDemoStore();
  const [date, setDate] = useState(todayIso());
  const [factoryId, setFactoryId] = useState("");
  const [orderId, setOrderId] = useState("");
  const [outputItemId, setOutputItemId] = useState("");
  const [qty, setQty] = useState(0);
  const [waste, setWaste] = useState(0);
  const [notes, setNotes] = useState("");
  const [success, setSuccess] = useState<string | null>(null);

  const prefix = lotType === "single" ? "LOT-S" : "LOT-T";
  const existingCount = state.yarnLots.filter((l) =>
    lotType === "single" ? l.category === "single_yarn" : l.category === "twisted_yarn",
  ).length;
  const code = `${prefix}-2026-${String(existingCount + 2).padStart(4, "0")}`;
  const valid = Boolean(factoryId && orderId && outputItemId && qty > 0);
  const factory = state.factories.find((f) => f.id === factoryId);
  const title = lotType === "single" ? "استلام إنتاج فرد" : "استلام إنتاج زوى";
  const description =
    lotType === "single"
      ? "سجّل لوط فرد ناتج من مصنع الفرد. الكمية والهالك فقط — لا أسعار ولا معدلات."
      : "سجّل لوط زوى ناتج من مصنع الزوى. الكمية والهالك فقط — لا أسعار ولا معدلات.";

  const onSaveDraft = () => setSuccess(`حُفظت مسونة استلام ${code} محليًا.`);
  const onSubmitForReview = () => {
    dispatch({
      type: "OUTPUT_DEMO",
      payload: { code, quantityKg: qty, factory: factory?.nameAr ?? "—", lotType },
    });
    dispatch({
      type: "ADD_APPROVAL",
      payload: {
        id: `ap-${Math.random().toString(36).slice(2, 9)}`,
        category: "production_receipt",
        titleAr: `اعتماد استلام إنتاج ${code} (${qty} كجم)`,
        reference: code,
        submittedAt: date,
        submittedByAr: "عامل الإنتاج — سامي",
        quantityKg: qty,
        status: "pending",
        warningAr: "بانتظار اعتماد المحاسب وإثبات معدل التشغيل وحساب التكلفة.",
      },
    });
    if (!state.storyProgress.step4_output) advanceStory("step4_output");
    setSuccess(`أُرسل استلام ${code} (${qty} كجم) للمراجعة.`);
  };

  return (
    <WorkerFormScreen
      title={title}
      description={description}
      breadcrumbs={[{ label: title }]}
      code={code}
      date={date}
      onDateChange={setDate}
      valid={valid}
      invalidMessage="يرجى اختيار المصنع وأمر الإنتاج والصنف الناتج وإدخال كمية موجبة."
      onSaveDraft={onSaveDraft}
      onSubmitForReview={onSubmitForReview}
      success={success}
      prohibitedFields={[
        "معدل تشغيل المصنع per ton",
        "التكلفة المحسوبة",
        "المستحق على المصنع",
        "تأثير الربحية",
      ]}
    >
      <Field label="المصنع" htmlFor="factoryId" required>
        <Select value={factoryId} onValueChange={setFactoryId}>
          <SelectTrigger id="factoryId">
            <SelectValue placeholder="اختر المصنع" />
          </SelectTrigger>
          <SelectContent>
            {state.factories
              .filter((f) =>
                lotType === "single" ? f.type === "single_yarn" : f.type === "twisting",
              )
              .map((f) => (
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
            {state.productionOrders
              .filter((p) =>
                lotType === "single" ? p.type === "single_yarn" : p.type === "twisted_yarn",
              )
              .map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  <BidiValue>{p.code}</BidiValue>
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="الصنف الناتج" htmlFor="outputItemId" required>
        <Select value={outputItemId} onValueChange={setOutputItemId}>
          <SelectTrigger id="outputItemId">
            <SelectValue placeholder="اختر الصنف" />
          </SelectTrigger>
          <SelectContent>
            {state.items
              .filter((i) =>
                lotType === "single" ? i.category === "single_yarn" : i.category === "twisted_yarn",
              )
              .map((i) => (
                <SelectItem key={i.id} value={i.id}>
                  <BidiValue>{i.code}</BidiValue> — {i.nameAr}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="الكمية الناتجة (كجم)" htmlFor="qty" required>
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
      <Field label="الهالك (كجم)" htmlFor="waste">
        <Input
          id="waste"
          type="number"
          step="0.001"
          min="0"
          dir="ltr"
          className="text-left"
          value={waste || ""}
          onChange={(e) => setWaste(Number(e.target.value))}
        />
      </Field>
      <Field label="ملاحظات" htmlFor="notes">
        <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </WorkerFormScreen>
  );
}

export default function SingleYarnReceipt() {
  return <ProductionReceipt lotType="single" />;
}
