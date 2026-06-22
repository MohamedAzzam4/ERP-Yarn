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

const TEST_TYPES = [
  "اختبار المتانة",
  "اختبار الرقم (العددية)",
  "اختبار الرطوبة",
  "اختبار النقاوة",
  "اختبار اللون",
];

export default function QualityTestEntry() {
  const { state, dispatch } = useDemoStore();
  const [date, setDate] = useState(todayIso());
  const [batchId, setBatchId] = useState("");
  const [testType, setTestType] = useState("");
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<"accepted" | "needs_review" | "blocked">("accepted");
  const [notes, setNotes] = useState("");
  const [success, setSuccess] = useState<string | null>(null);

  const code = `QT-2026-${String(state.qualityTests.length + 3).padStart(4, "0")}`;
  const valid = Boolean(batchId && testType && value && status);

  const onSaveDraft = () => setSuccess(`حُفظت مسودة الاختبار ${code} محليًا.`);
  const onSubmitForReview = () => {
    dispatch({
      type: "ADD_ACTIVITY",
      payload: {
        id: `act-${Math.random().toString(36).slice(2, 9)}`,
        timestamp: `${date}T10:00:00`,
        actorAr: "عامل الجودة — خالد",
        actionAr: `تسجيل اختبار جودة ${code} (${testType}) على ${batchId}.`,
        category: "quality",
        reference: code,
      },
    });
    setSuccess(`أُرسل الاختبار ${code} للتسجيل.`);
  };

  return (
    <WorkerFormScreen
      title="تسجيل اختبار جودة"
      description="أدخل نتائج الاختبار على رسالة خام أو لوت. لا تظهر هنا أي معالجة مالية أو خصومات أو اعتماد بيع بمخاطرة."
      breadcrumbs={[{ label: "تسجيل اختبار جودة" }]}
      code={code}
      date={date}
      onDateChange={setDate}
      valid={valid}
      invalidMessage="يرجى اختيار الرسالة/اللوت ونوع الاختبار وإدخال النتيجة والحالة."
      onSaveDraft={onSaveDraft}
      onSubmitForReview={onSubmitForReview}
      success={success}
      prohibitedFields={[
        "قيمة الخصم/الائتمان للعميل",
        "اعتماد البيع بمخاطرة جودة",
        "معالجة الاستبدال/الاسترداد",
        "تأثير الربحية",
      ]}
    >
      <Field label="الرسالة/اللوت" htmlFor="batchId" required>
        <Select value={batchId} onValueChange={setBatchId}>
          <SelectTrigger id="batchId">
            <SelectValue placeholder="اختر الرسالة/اللوت" />
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
            {state.yarnLots.map((l) => {
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
      <Field label="نوع الاختبار" htmlFor="testType" required>
        <Select value={testType} onValueChange={setTestType}>
          <SelectTrigger id="testType">
            <SelectValue placeholder="اختر نوع الاختبار" />
          </SelectTrigger>
          <SelectContent>
            {TEST_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="النتيجة" htmlFor="value" required>
        <Input
          id="value"
          dir="ltr"
          className="text-left"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="مثال: 28.5 g/tex"
        />
      </Field>
      <Field label="الحالة" htmlFor="status" required>
        <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
          <SelectTrigger id="status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="accepted">مقبول</SelectItem>
            <SelectItem value="needs_review">يحتاج مراجعة</SelectItem>
            <SelectItem value="blocked">محجوز</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label="ملاحظات" htmlFor="notes">
        <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </WorkerFormScreen>
  );
}
