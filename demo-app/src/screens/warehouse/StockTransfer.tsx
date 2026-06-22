import { useState } from "react";
import { ArrowRight, Save, Send } from "lucide-react";
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
import { todayIso } from "@/lib/utils";

/**
 * Worker Stock Transfer — one-step transfer draft. No financial fields.
 * Per project context: one-step transfers in MVP.
 */
export default function StockTransfer() {
  const { state, dispatch, advanceStory, nextShowcaseCode } = useDemoStore();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submit, setSubmit] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const [fromLoc, setFromLoc] = useState("");
  const [toLoc, setToLoc] = useState("");
  const [batchId, setBatchId] = useState("");
  const [qty, setQty] = useState(0);
  const [date, setDate] = useState(todayIso());
  const [notes, setNotes] = useState("");

  const transferCode = nextShowcaseCode("TR");
  const fromLocObj = state.locations.find((l) => l.id === fromLoc);
  const toLocObj = state.locations.find((l) => l.id === toLoc);

  const valid = Boolean(fromLoc && toLoc && batchId && qty > 0 && fromLoc !== toLoc);

  const onConfirm = () => {
    if (!valid) return;
    dispatch({
      type: "TRANSFER_DEMO",
      payload: {
        code: transferCode,
        quantityKg: qty,
        fromLoc: fromLocObj?.nameAr ?? fromLoc,
        toLoc: toLocObj?.nameAr ?? toLoc,
      },
    });
    if (submit) {
      dispatch({
        type: "ADD_APPROVAL",
        payload: {
          id: `ap-${Math.random().toString(36).slice(2, 9)}`,
          category: "transfer",
          titleAr: `اعتماد نقل مخزون ${transferCode} (${qty} كجم)`,
          reference: transferCode,
          submittedAt: date,
          submittedByAr: "عامل المخزن — أحمد",
          quantityKg: qty,
          status: "pending",
          warningAr: "بانتظار اعتماد المحاسب قبل الترحيل.",
        },
      });
    }
    if (!state.storyProgress.step2_transfer) advanceStory("step2_transfer");
    setSuccess(
      `سُجّل النقل ${transferCode} (${qty} كجم) من ${fromLocObj?.nameAr} إلى ${toLocObj?.nameAr}.`,
    );
    setConfirmOpen(false);
    setFromLoc("");
    setToLoc("");
    setBatchId("");
    setQty(0);
    setNotes("");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="نقل مخزون"
        description="نقل خطوة واحدة من موقع إلى آخر. يتطلب الاعتماد قبل التأثير على الأرصدة في النظام التشغيلي."
        breadcrumbs={[{ label: "وضع مهام العامل" }, { label: "نقل مخزون" }]}
      />

      <Card>
        <CardHeader>
          <CardTitle>بيانات النقل</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="رقم إذن النقل" htmlFor="code">
              <Input
                id="code"
                dir="ltr"
                value={transferCode}
                readOnly
                className="bg-muted/40 text-left"
              />
            </Field>
            <Field label="التاريخ" htmlFor="date" required>
              <Input
                id="date"
                type="date"
                dir="ltr"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            <Field label="من موقع" htmlFor="fromLoc" required>
              <Select value={fromLoc} onValueChange={setFromLoc}>
                <SelectTrigger id="fromLoc">
                  <SelectValue placeholder="اختر الموقع المصدر" />
                </SelectTrigger>
                <SelectContent>
                  {state.locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      <BidiValue>{l.code}</BidiValue> — {l.nameAr}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="إلى موقع" htmlFor="toLoc" required>
              <Select value={toLoc} onValueChange={setToLoc}>
                <SelectTrigger id="toLoc">
                  <SelectValue placeholder="اختر الموقع الوجهة" />
                </SelectTrigger>
                <SelectContent>
                  {state.locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      <BidiValue>{l.code}</BidiValue> — {l.nameAr}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
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
            <Field label="ملاحظات" htmlFor="notes">
              <Textarea
                id="notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
          </div>

          {!valid && (fromLoc || toLoc || batchId || qty) ? (
            <p role="alert" className="text-xs text-danger" dir="rtl">
              يرجى إكمال كل الحقول المطلوبة والتأكد أن الموقعين مختلفان والكمية موجبة.
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="worker"
              disabled={!valid}
              onClick={() => {
                setSubmit(false);
                setConfirmOpen(true);
              }}
            >
              <Save className="h-4 w-4" aria-hidden /> حفظ كمسودة
            </Button>
            <Button
              type="button"
              variant="accent"
              size="worker"
              disabled={!valid}
              onClick={() => {
                setSubmit(true);
                setConfirmOpen(true);
              }}
            >
              <Send className="h-4 w-4" aria-hidden /> إرسال للمراجعة
            </Button>
          </div>
        </CardContent>
      </Card>

      {success ? (
        <Card className="border-success/30 bg-success/5">
          <CardContent className="flex items-start gap-3 p-4 text-sm">
            <ArrowRight className="mt-0.5 h-5 w-5 shrink-0 rotate-180 text-success" aria-hidden />
            <p className="text-success-foreground" dir="rtl">
              {success}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={submit ? "تأكيد إرسال للمراجعة" : "تأكيد حفظ المسودة"}
        description={`نقل ${qty} كجم من ${fromLocObj?.nameAr ?? "—"} إلى ${toLocObj?.nameAr ?? "—"}.`}
        confirmLabel={submit ? "إرسال" : "حفظ"}
        onConfirm={onConfirm}
      />
    </div>
  );
}
