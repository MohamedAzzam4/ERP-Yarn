import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, CheckCircle2, FileWarning, RefreshCw, Wallet, XCircle } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { KpiCard } from "@/components/shared/KpiCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { BidiValue } from "@/components/shared/BidiValue";
import { ApprovalStatusBadge } from "@/components/shared/StatusBadge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useDemoStore } from "@/store/DemoStoreContext";
import { formatEgp, formatNumber } from "@/lib/utils";
import type { ApprovalItem } from "@/types";

/**
 * Accountant Review Queue — Reference Screen (per design contract §6.2 +
 * screen contracts §8.1). Demonstrates filters, tabs, counts, drawer, and
 * approve/reject/request-correction distinction.
 */
export default function AccountantDashboard() {
  const { state, dispatch } = useDemoStore();
  const [tab, setTab] = useState("sales");
  const [selected, setSelected] = useState<ApprovalItem | null>(null);
  const [confirm, setConfirm] = useState<{
    action: "approve" | "reject" | "correct";
    item: ApprovalItem;
  } | null>(null);
  const [reasonAr, setReasonAr] = useState("");

  const pending = state.approvals.filter((a) => a.status === "pending");

  const byCategory = (cat: ApprovalItem["category"]) => pending.filter((a) => a.category === cat);

  const salesApprovals = byCategory("sale").concat(byCategory("quality_risk_sale"));
  const productionApprovals = byCategory("production_issue").concat(
    byCategory("production_receipt"),
    byCategory("wip_return"),
  );
  const returnApprovals = byCategory("return");
  const paymentApprovals = byCategory("payment").concat(byCategory("payment_reversal"));
  const migrationApprovals = byCategory("migration");
  const adjustmentApprovals = byCategory("adjustment").concat(
    byCategory("raw_receipt"),
    byCategory("transfer"),
    byCategory("negative_stock"),
    byCategory("correction"),
  );

  const missingPriceReceipts = state.rawBatches.filter((b) => b.hasMissingPrice);
  const missingCostLots = state.yarnLots.filter((l) => l.hasMissingCost);
  const unsettledPayments = state.payments.filter((p) => p.status === "pending");

  const openConfirm = (action: "approve" | "reject" | "correct", item: ApprovalItem) => {
    setReasonAr("");
    setConfirm({ action, item });
  };

  const doConfirm = () => {
    if (!confirm) return;
    const { item, action } = confirm;
    dispatch({
      type: "UPDATE_APPROVAL",
      payload: {
        id: item.id,
        status: action === "approve" ? "approved" : action === "reject" ? "rejected" : "pending",
        reasonAr: action === "approve" ? undefined : reasonAr || "مطلوب تصحيح — راجع البيانات.",
      },
    });
    setConfirm(null);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="لوحة المحاسب"
        description="قوائم المراجعة، الأرصدة، المدفوعات، مراجعة التكاليف المباشرة، تحذيرات الترحيل."
      />

      {/* KPIs */}
      <section
        aria-label="مؤشرات المراجعة"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <KpiCard
          label="اعتمادات معلّقة"
          value={formatNumber(pending.length)}
          icon={<AlertCircle className="h-4 w-4" aria-hidden />}
          tone="warning"
        />
        <KpiCard
          label="رسائل خام بدون سعر"
          value={formatNumber(missingPriceReceipts.length)}
          icon={<FileWarning className="h-4 w-4" aria-hidden />}
          tone="warning"
          hint="بانتظار إثبات سعر التوريد"
        />
        <KpiCard
          label="أ لوت إنتاج بدون تكلفة"
          value={formatNumber(missingCostLots.length)}
          icon={<FileWarning className="h-4 w-4" aria-hidden />}
          tone="warning"
          hint="بانتظار إثبات معدل التشغيل"
        />
        <KpiCard
          label="مدفوعات معلّقة"
          value={formatNumber(unsettledPayments.length)}
          icon={<Wallet className="h-4 w-4" aria-hidden />}
          tone="info"
        />
      </section>

      {/* Warning banners */}
      {missingPriceReceipts.length > 0 ? (
        <Card className="border-warning/30 bg-warning/5">
          <CardContent className="flex items-start gap-3 p-4 text-sm">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
            <div className="flex-1 space-y-1">
              <p className="font-semibold text-warning-foreground">رسائل خام بانتظار إثبات السعر</p>
              <p className="text-xs text-muted-foreground" dir="rtl">
                {missingPriceReceipts.map((b) => b.code).join("، ")} — راجع المصدر وأدخل سعر
                التوريد.
              </p>
            </div>
            <Link to="/management/approvals">
              <Button variant="outline" size="sm">
                مراجعة
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : null}
      {missingCostLots.length > 0 ? (
        <Card className="border-warning/30 bg-warning/5">
          <CardContent className="flex items-start gap-3 p-4 text-sm">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
            <div className="flex-1 space-y-1">
              <p className="font-semibold text-warning-foreground">
                أ لوت إنتاج بانتظار مراجعة التكلفة
              </p>
              <p className="text-xs text-muted-foreground" dir="rtl">
                {missingCostLots.map((l) => l.code).join("، ")} — لا يمكن حساب التكلفة أو المستحق
                دون إثبات معدل التشغيل.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Review queue tabs */}
      <Card>
        <CardHeader>
          <CardTitle>قائمة المراجعة الموحّدة</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="flex-wrap">
              <TabsTrigger value="sales">
                مبيعات{" "}
                <Badge variant="muted" className="ms-1">
                  {salesApprovals.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="production">
                إنتاج{" "}
                <Badge variant="muted" className="ms-1">
                  {productionApprovals.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="returns">
                مرتجعات{" "}
                <Badge variant="muted" className="ms-1">
                  {returnApprovals.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="payments">
                مدفوعات{" "}
                <Badge variant="muted" className="ms-1">
                  {paymentApprovals.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="adjustments">
                تعديلات{" "}
                <Badge variant="muted" className="ms-1">
                  {adjustmentApprovals.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="migration">
                ترحيل{" "}
                <Badge variant="muted" className="ms-1">
                  {migrationApprovals.length}
                </Badge>
              </TabsTrigger>
            </TabsList>

            {(
              [
                ["sales", salesApprovals],
                ["production", productionApprovals],
                ["returns", returnApprovals],
                ["payments", paymentApprovals],
                ["adjustments", adjustmentApprovals],
                ["migration", migrationApprovals],
              ] as const
            ).map(([key, items]) => (
              <TabsContent key={key} value={key}>
                <QueueTable items={items} onSelect={setSelected} />
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>

      {/* Detail drawer (dialog) */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          {selected ? (
            <>
              <DialogHeader>
                <DialogTitle>{selected.titleAr}</DialogTitle>
                <DialogDescription>
                  المرجع: <BidiValue>{selected.reference}</BidiValue> — قدّمه{" "}
                  {selected.submittedByAr}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <Info label="التصنيف" value={categoryLabel(selected.category)} />
                  <Info
                    label="القيمة المالية"
                    value={
                      selected.amountEgp !== undefined ? (
                        <BidiValue numeric>{formatEgp(selected.amountEgp)}</BidiValue>
                      ) : (
                        "—"
                      )
                    }
                  />
                  <Info
                    label="الكمية"
                    value={
                      selected.quantityKg !== undefined ? (
                        <BidiValue numeric>{formatNumber(selected.quantityKg)} كجم</BidiValue>
                      ) : (
                        "—"
                      )
                    }
                  />
                  <Info label="الحالة" value={<ApprovalStatusBadge status={selected.status} />} />
                </div>
                {selected.warningAr ? (
                  <div className="rounded-md border border-warning/30 bg-warning/5 p-3 text-xs text-warning-foreground">
                    <p className="flex items-start gap-2" dir="rtl">
                      <AlertCircle className="h-4 w-4 shrink-0 text-warning" aria-hidden />
                      <span>{selected.warningAr}</span>
                    </p>
                  </div>
                ) : null}
                {selected.reasonAr ? (
                  <div className="rounded-md border border-border bg-muted/40 p-3 text-xs">
                    <p className="font-semibold">سبب القرار:</p>
                    <p className="mt-1 text-muted-foreground" dir="rtl">
                      {selected.reasonAr}
                    </p>
                  </div>
                ) : null}
              </div>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openConfirm("correct", selected)}
                >
                  <RefreshCw className="h-4 w-4" aria-hidden />
                  طلب تصحيح
                </Button>
                <Button variant="danger" size="sm" onClick={() => openConfirm("reject", selected)}>
                  <XCircle className="h-4 w-4" aria-hidden />
                  رفض
                </Button>
                <Button variant="accent" size="sm" onClick={() => openConfirm("approve", selected)}>
                  <CheckCircle2 className="h-4 w-4" aria-hidden />
                  اعتماد
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={
          confirm?.action === "approve"
            ? "تأكيد الاعتماد"
            : confirm?.action === "reject"
              ? "تأكيد الرفض"
              : "تأكيد طلب التصحيح"
        }
        description="هذا الإجراء يحدّث حالة الاعتماد في واجهة العرض فقط ولا يُعدّ ترحيلًا فعليًا للقيود."
        confirmLabel={
          confirm?.action === "approve"
            ? "اعتماد"
            : confirm?.action === "reject"
              ? "رفض"
              : "إرسال طلب التصحيح"
        }
        destructive={confirm?.action !== "approve"}
        reasonRequired={confirm?.action !== "approve"}
        reasonValue={reasonAr}
        onReasonChange={setReasonAr}
        onConfirm={doConfirm}
      />
    </div>
  );
}

function QueueTable({
  items,
  onSelect,
}: {
  items: ApprovalItem[];
  onSelect: (item: ApprovalItem) => void;
}) {
  if (items.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        لا توجد عناصر في هذه القائمة.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {items.map((a) => (
        <li
          key={a.id}
          className="flex flex-wrap items-center justify-between gap-3 p-3 hover:bg-muted/40"
        >
          <div className="space-y-1">
            <button
              type="button"
              className="block text-start font-medium text-foreground hover:text-accent hover:underline"
              onClick={() => onSelect(a)}
            >
              {a.titleAr}
            </button>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <BidiValue size="xs">{a.reference}</BidiValue>
              <span>—</span>
              <span dir="rtl">{a.submittedByAr}</span>
              <ApprovalStatusBadge status={a.status} />
              {a.amountEgp !== undefined ? (
                <Badge variant="info" className="font-variant-numeric tabular-nums">
                  <BidiValue numeric size="xs">
                    {formatEgp(a.amountEgp)}
                  </BidiValue>
                </Badge>
              ) : null}
              {a.quantityKg !== undefined ? (
                <Badge variant="muted">
                  <BidiValue numeric size="xs">
                    {formatNumber(a.quantityKg)} كجم
                  </BidiValue>
                </Badge>
              ) : null}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => onSelect(a)}>
            فتح
          </Button>
        </li>
      ))}
    </ul>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

function categoryLabel(cat: ApprovalItem["category"]): string {
  switch (cat) {
    case "sale":
      return "بيع";
    case "quality_risk_sale":
      return "بيع بمخاطرة جودة";
    case "production_issue":
      return "صرف إنتاج";
    case "production_receipt":
      return "استلام إنتاج";
    case "wip_return":
      return "مرتجع ودائع";
    case "return":
      return "مرتجع عميل";
    case "payment":
      return "دفعة";
    case "payment_reversal":
      return "عكس دفعة";
    case "migration":
      return "ترحيل تاريخي";
    case "adjustment":
      return "تسوية مخزون";
    case "raw_receipt":
      return "استلام خام";
    case "transfer":
      return "نقل مخزون";
    case "negative_stock":
      return "رصيد سالب";
    case "correction":
      return "تصحيح";
    default:
      return cat;
  }
}
