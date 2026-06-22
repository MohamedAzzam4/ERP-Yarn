import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowRight, CheckCircle2, Save, Send, XCircle } from "lucide-react";
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
import { ApprovalStatusBadge } from "@/components/shared/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useDemoStore } from "@/store/DemoStoreContext";
import { canSeeFinancials, canSubmitSale } from "@/lib/permissions";
import { formatEgp, formatDate, formatNumber, todayIso } from "@/lib/utils";

export default function SalesDraft() {
  const { saleId } = useParams<{ saleId: string }>();
  const [params] = useSearchParams();
  const { state, dispatch, advanceStory } = useDemoStore();
  const role = state.currentRole;
  const seeFinancials = canSeeFinancials(role);
  const canSubmit = canSubmitSale(role);

  const existing = saleId && saleId !== "new" ? state.sales.find((s) => s.id === saleId) : null;
  const code = existing?.code ?? params.get("code") ?? `SAL-2026-0008`;
  const [customerId, setCustomerId] = useState(existing?.customerId ?? "");
  const [date, setDate] = useState(existing?.date ?? todayIso());
  const [itemId, setItemId] = useState(existing?.lines[0]?.itemId ?? "");
  const [batchId, setBatchId] = useState(existing?.lines[0]?.batchOrLotId ?? "");
  const [qty, setQty] = useState(existing?.lines[0]?.quantityKg ?? 0);
  const [unitPrice, setUnitPrice] = useState(existing?.lines[0]?.unitPriceEgp ?? 0);
  const [discountPct, setDiscountPct] = useState(existing?.lines[0]?.discountPct ?? 0);
  const [notes, setNotes] = useState("");
  const [success, setSuccess] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | {
    action: "save" | "submit" | "approve" | "reject";
  }>(null);
  const [reasonAr, setReasonAr] = useState("");

  const lineNet = qty * unitPrice * (1 - (discountPct ?? 0) / 100);

  const handleConfirm = () => {
    if (!confirm) return;
    const customer = state.customers.find((c) => c.id === customerId);
    if (confirm.action === "save") {
      dispatch({
        type: "SALE_DRAFT_DEMO",
        payload: { code, customer: customer?.nameAr ?? "—", quantityKg: qty },
      });
      if (!state.storyProgress.step5_saleDraft) advanceStory("step5_saleDraft");
      setSuccess(`حُفظت مسودة البيع ${code} مع حجز المخزون محليًا.`);
    } else if (confirm.action === "submit") {
      dispatch({
        type: "SALE_DRAFT_DEMO",
        payload: { code, customer: customer?.nameAr ?? "—", quantityKg: qty },
      });
      dispatch({
        type: "ADD_APPROVAL",
        payload: {
          id: `ap-${Math.random().toString(36).slice(2, 9)}`,
          category: "sale",
          titleAr: `اعتماد بيع ${code} للعميل ${customer?.nameAr ?? "—"}`,
          reference: code,
          submittedAt: date,
          submittedByAr: "المحاسب — منى",
          amountEgp: seeFinancials ? lineNet : undefined,
          quantityKg: qty,
          status: "pending",
          warningAr: seeFinancials && unitPrice === 0 ? "السعر صفر — يلزم مراجعة." : undefined,
        },
      });
      setSuccess(`أُرسل البيع ${code} للاعتماد.`);
    } else if (confirm.action === "approve") {
      dispatch({
        type: "SALE_APPROVE_DEMO",
        payload: { code, approve: true },
      });
      if (!state.storyProgress.step6_saleApproved) advanceStory("step6_saleApproved");
      setSuccess(`اعتمد البيع ${code} — استُهلك الحجز وترحّلت الكمية (في واجهة العرض فقط).`);
    } else if (confirm.action === "reject") {
      dispatch({
        type: "SALE_APPROVE_DEMO",
        payload: { code, approve: false, reasonAr: reasonAr || "مرفوض — راجع البيانات." },
      });
      setSuccess(`رُفض البيع ${code}.`);
    }
    setConfirm(null);
  };

  const valid =
    customerId && itemId && batchId && qty > 0 && (seeFinancials ? unitPrice > 0 : true);

  return (
    <div className="space-y-6">
      <PageHeader
        title={existing ? `بيع ${existing.code}` : `مسودة بيع ${code}`}
        description="كل بيع يتطلب اعتمادًا قبل التنفيذ. الحجز النشط يحمي الكمية دون تخفيض الرصيد المتاح حتى الاعتماد."
        breadcrumbs={[{ label: "المبيعات", href: "/management/sales" }, { label: code }]}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/management/sales">
              <ArrowRight className="h-4 w-4" aria-hidden /> رجوع
            </Link>
          </Button>
        }
      />

      {existing ? (
        <Card>
          <CardContent className="flex items-center justify-between gap-3 p-4 text-sm">
            <div>
              <p className="font-medium text-foreground" dir="rtl">
                حالة البيع: <ApprovalStatusBadge status={existing.status} />
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                التاريخ: <BidiValue>{formatDate(existing.date)}</BidiValue>
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>بيانات البيع</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="رقم البيع" htmlFor="code">
              <Input id="code" dir="ltr" readOnly value={code} className="bg-muted/40 text-left" />
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
            <Field label="الرسالة/اللوت" htmlFor="batchId" required>
              <Select value={batchId} onValueChange={setBatchId}>
                <SelectTrigger id="batchId">
                  <SelectValue placeholder="اختر الرسالة/اللوت" />
                </SelectTrigger>
                <SelectContent>
                  {state.rawBatches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      <BidiValue>{b.code}</BidiValue>
                    </SelectItem>
                  ))}
                  {state.yarnLots.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      <BidiValue>{l.code}</BidiValue>
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
            {seeFinancials ? (
              <>
                <Field label="سعر الوحدة (جنيه)" htmlFor="price" required>
                  <Input
                    id="price"
                    type="number"
                    step="0.01"
                    min="0"
                    dir="ltr"
                    className="text-left"
                    value={unitPrice || ""}
                    onChange={(e) => setUnitPrice(Number(e.target.value))}
                  />
                </Field>
                <Field label="نسبة الخصم %" htmlFor="discount">
                  <Input
                    id="discount"
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    dir="ltr"
                    className="text-left"
                    value={discountPct || ""}
                    onChange={(e) => setDiscountPct(Number(e.target.value))}
                  />
                </Field>
              </>
            ) : null}
            <Field label="ملاحظات" htmlFor="notes">
              <Textarea
                id="notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
          </div>

          {seeFinancials ? (
            <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
              <p className="text-muted-foreground">صافي البند (تقديري):</p>
              <p className="font-heading text-lg font-bold text-foreground">
                <BidiValue numeric>{formatEgp(lineNet)}</BidiValue>
              </p>
            </div>
          ) : null}

          {seeFinancials && unitPrice === 0 && qty > 0 ? (
            <p role="alert" className="text-xs text-danger" dir="rtl">
              السعر صفر — لا يمكن اعتماد البيع دون سعر. أصلِح السعر قبل الإرسال.
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!valid}
              onClick={() => setConfirm({ action: "save" })}
            >
              <Save className="h-4 w-4" aria-hidden /> حفظ كمسودة
            </Button>
            {canSubmit ? (
              <Button
                type="button"
                variant="accent"
                disabled={!valid}
                onClick={() => setConfirm({ action: "submit" })}
              >
                <Send className="h-4 w-4" aria-hidden /> إرسال للاعتماد
              </Button>
            ) : null}
            {canSubmit && existing?.status === "pending" ? (
              <>
                <Button
                  type="button"
                  variant="default"
                  onClick={() => setConfirm({ action: "approve" })}
                >
                  <CheckCircle2 className="h-4 w-4" aria-hidden /> اعتماد
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => {
                    setReasonAr("");
                    setConfirm({ action: "reject" });
                  }}
                >
                  <XCircle className="h-4 w-4" aria-hidden /> رفض
                </Button>
              </>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {success ? (
        <Card className="border-success/30 bg-success/5">
          <CardContent className="p-4 text-sm text-success-foreground">{success}</CardContent>
        </Card>
      ) : null}

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={
          confirm?.action === "approve"
            ? "تأكيد الاعتماد"
            : confirm?.action === "reject"
              ? "تأكيد الرفض"
              : confirm?.action === "submit"
                ? "تأكيد الإرسال للاعتماد"
                : "تأكيد حفظ المسودة"
        }
        description={
          confirm?.action === "approve"
            ? "سيتم استهلاك الحجز وترحيل الكمية في واجهة العرض فقط."
            : "القيم تجريبية ولا تُعدّ ترحيلًا فعليًا للقيود."
        }
        confirmLabel={
          confirm?.action === "approve"
            ? "اعتماد"
            : confirm?.action === "reject"
              ? "رفض"
              : confirm?.action === "submit"
                ? "إرسال"
                : "حفظ"
        }
        destructive={confirm?.action === "reject"}
        reasonRequired={confirm?.action === "reject"}
        reasonValue={reasonAr}
        onReasonChange={setReasonAr}
        onConfirm={handleConfirm}
      />

      <Card>
        <CardContent className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
          <Badge variant="info">عرض فقط</Badge>
          الإجمالي الحالي للبند: <BidiValue numeric>{formatNumber(qty)}</BidiValue> كجم
          {seeFinancials ? (
            <>
              {" "}
              × <BidiValue numeric>{formatEgp(unitPrice)}</BidiValue>
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
