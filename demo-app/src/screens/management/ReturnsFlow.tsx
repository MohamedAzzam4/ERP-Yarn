import { useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { ManagementListScreen } from "@/screen-utils/ManagementListScreen";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { BidiValue } from "@/components/shared/BidiValue";
import { Badge } from "@/components/ui/badge";
import { ApprovalStatusBadge } from "@/components/shared/StatusBadge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useDemoStore } from "@/store/DemoStoreContext";
import { canSeeFinancials } from "@/lib/permissions";
import { formatEgp, formatDate, formatNumber } from "@/lib/utils";

const CLASSIFICATION_LABEL_AR: Record<string, string> = {
  return_received: "تم الاستلام",
  needs_quality_review: "يحتاج مراجعة جودة",
  sellable_as_is: "صالح للبيع كما هو",
  sellable_with_discount: "صالح بخصم",
  blocked: "محظور",
  reprocess_required: "يلزم إعادة تشغيل",
};

const TREATMENT_LABEL_AR: Record<string, string> = {
  no_financial_impact: "بلا أثر مالي",
  customer_credit: "ائتمان عميل",
  refund_due: "استرداد مستحق",
  replacement: "استبدال",
};

export default function ReturnsFlow() {
  const { state, dispatch, advanceStory } = useDemoStore();
  const role = state.currentRole;
  const seeFinancials = canSeeFinancials(role);
  const [confirm, setConfirm] = useState<{ action: "approve" | "reject"; id: string } | null>(null);
  const [classification, setClassification] = useState<string>("");
  const [treatment, setTreatment] = useState<string>("");

  // Include seed returns + any added during demo story.
  const allReturns = state.returns;
  // For the demo story, also show pending approval items of type 'return' as potential returns to act on.
  const pendingReturnApprovals = state.approvals.filter(
    (a) => a.category === "return" && a.status === "pending",
  );

  return (
    <ManagementListScreen
      title="المرتجعات والاستبدال"
      description="اعتماد المرتجعات وتحديد التصنيف والمعالجة المالية والاستبدال. لا يجوز اعتماد مرتجع يتجاوز الكمية القابلة للإرجاع."
      kpis={[
        { label: "إجمالي المرتجعات", value: allReturns.length },
        { label: "بانتظار الاعتماد", value: pendingReturnApprovals.length },
        {
          label: "معتمدة",
          value: allReturns.filter((r) => r.status === "approved").length,
        },
        {
          label: "مرفوضة",
          value: allReturns.filter((r) => r.status === "rejected").length,
        },
      ]}
      totalLabel="عدد المرتجعات"
      total={allReturns.length + pendingReturnApprovals.length}
    >
      <Card>
        <CardHeader>
          <CardTitle>المرتجعات الحالية</CardTitle>
        </CardHeader>
        <CardContent>
          {allReturns.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              لا توجد مرتجعات معتمدة بعد. استخدم الشاشة أدناه لاعتماد مرتجع معلّق.
            </p>
          ) : (
            <Table ariaLabel="المرتجعات المعتمدة">
              <TableHeader>
                <TableRow>
                  <TableHead>الرمز</TableHead>
                  <TableHead>العميل</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>الكمية</TableHead>
                  <TableHead>التصنيف</TableHead>
                  <TableHead>المعالجة</TableHead>
                  {seeFinancials ? <TableHead>قيمة الائتمان</TableHead> : null}
                  <TableHead>الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allReturns.map((r) => {
                  const customer = state.customers.find((c) => c.id === r.customerId);
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        <BidiValue size="xs">{r.code}</BidiValue>
                      </TableCell>
                      <TableCell className="text-xs">{customer?.nameAr ?? "—"}</TableCell>
                      <TableCell>
                        <BidiValue size="xs">{formatDate(r.date)}</BidiValue>
                      </TableCell>
                      <TableCell className="numeric-cell">
                        {formatNumber(r.quantityKg)} كجم
                      </TableCell>
                      <TableCell>
                        <Badge variant="muted">{CLASSIFICATION_LABEL_AR[r.classification]}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.treatment ? TREATMENT_LABEL_AR[r.treatment] : "—"}
                      </TableCell>
                      {seeFinancials ? (
                        <TableCell className="numeric-cell">
                          {r.creditValueEgp !== undefined ? (
                            <BidiValue numeric size="xs">
                              {formatEgp(r.creditValueEgp)}
                            </BidiValue>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                      ) : null}
                      <TableCell>
                        <ApprovalStatusBadge status={r.status} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {pendingReturnApprovals.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>بانتظار الاعتماد</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {pendingReturnApprovals.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">{a.titleAr}</p>
                    <p className="text-xs text-muted-foreground" dir="rtl">
                      الكمية:{" "}
                      <BidiValue numeric size="xs">
                        {a.quantityKg ?? 0} كجم
                      </BidiValue>{" "}
                      — قدّمه {a.submittedByAr}
                    </p>
                    {a.warningAr ? (
                      <p className="text-xs text-warning" dir="rtl">
                        {a.warningAr}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label="التصنيف"
                      value={classification}
                      onChange={(e) => setClassification(e.target.value)}
                      className="h-9 rounded-md border border-input bg-surface px-2 text-xs"
                    >
                      <option value="">اختر التصنيف...</option>
                      {Object.entries(CLASSIFICATION_LABEL_AR).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="المعالجة"
                      value={treatment}
                      onChange={(e) => setTreatment(e.target.value)}
                      className="h-9 rounded-md border border-input bg-surface px-2 text-xs"
                    >
                      <option value="">اختر المعالجة...</option>
                      {Object.entries(TREATMENT_LABEL_AR).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                    <Button
                      variant="default"
                      size="sm"
                      disabled={!classification || !treatment}
                      onClick={() => {
                        // Add a new return + approve the item locally (demo only).
                        dispatch({
                          type: "ADD_RETURN",
                          payload: {
                            id: `ret-${Math.random().toString(36).slice(2, 9)}`,
                            code: `RET-2026-${String(state.returns.length + 4).padStart(4, "0")}`,
                            customerId: "cus-001",
                            saleId: a.reference,
                            itemId: "item-cotton-single",
                            date: "2026-06-22",
                            quantityKg: a.quantityKg ?? 0,
                            classification: classification as never,
                            returnLocationId: "loc-ret-01",
                            status: "approved",
                            treatment: treatment as never,
                            creditValueEgp: seeFinancials ? 25000 : undefined,
                          },
                        });
                        dispatch({
                          type: "UPDATE_APPROVAL",
                          payload: {
                            id: a.id,
                            status: "approved",
                            reasonAr: `تصنيف: ${CLASSIFICATION_LABEL_AR[classification]}; معالجة: ${TREATMENT_LABEL_AR[treatment]}`,
                          },
                        });
                        if (!state.storyProgress.step8_complaintReturn)
                          advanceStory("step8_complaintReturn");
                        setClassification("");
                        setTreatment("");
                      }}
                    >
                      <CheckCircle2 className="h-3 w-3" aria-hidden /> اعتماد
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => setConfirm({ action: "reject", id: a.id })}
                    >
                      <XCircle className="h-3 w-3" aria-hidden /> رفض
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="تأكيد رفض المرتجع"
        description="سيتم رفض المرتجع. يُفضَّل توضيح السبب بالعربية."
        confirmLabel="رفض"
        destructive
        reasonRequired
        onConfirm={() => {
          if (!confirm) return;
          dispatch({
            type: "UPDATE_APPROVAL",
            payload: { id: confirm.id, status: "rejected", reasonAr: "مرفوض — راجع البيانات." },
          });
          setConfirm(null);
        }}
      />
    </ManagementListScreen>
  );
}
