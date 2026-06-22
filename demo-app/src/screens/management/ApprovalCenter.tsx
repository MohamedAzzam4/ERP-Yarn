import { useState } from "react";
import { CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { ManagementListScreen, useSearchFilter } from "@/screen-utils/ManagementListScreen";
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
import { ApprovalStatusBadge } from "@/components/shared/StatusBadge";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useDemoStore } from "@/store/DemoStoreContext";
import { formatEgp, formatNumber } from "@/lib/utils";
import type { ApprovalItem } from "@/types";

export default function ApprovalCenter() {
  const { state, dispatch } = useDemoStore();
  const [selected, setSelected] = useState<ApprovalItem | null>(null);
  const [confirm, setConfirm] = useState<{
    action: "approve" | "reject" | "correct";
    item: ApprovalItem;
  } | null>(null);
  const [reasonAr, setReasonAr] = useState("");

  const { query, setQuery, filtered } = useSearchFilter(state.approvals, (a, q) =>
    `${a.titleAr} ${a.reference} ${a.submittedByAr}`.toLowerCase().includes(q.toLowerCase()),
  );

  const pending = filtered.filter((a) => a.status === "pending");

  const doConfirm = () => {
    if (!confirm) return;
    dispatch({
      type: "UPDATE_APPROVAL",
      payload: {
        id: confirm.item.id,
        status:
          confirm.action === "approve"
            ? "approved"
            : confirm.action === "reject"
              ? "rejected"
              : "pending",
        reasonAr:
          confirm.action === "approve" ? undefined : reasonAr || "مطلوب تصحيح — راجع البيانات.",
      },
    });
    setConfirm(null);
    setSelected(null);
  };

  return (
    <ManagementListScreen
      title="مركز الاعتمادات"
      description="قائمة مراجعة موحدة لكل الاعتمادات عالية المخاطر. كل قرار يُسجَّل سببه ولا يُعتمد شيء بضغطة واحدة فقط."
      searchValue={query}
      onSearchChange={setQuery}
      searchPlaceholder="ابحث بالمرجع أو المُقدِّم أو العنوان..."
      kpis={[
        { label: "إجمالي العناصر", value: state.approvals.length },
        { label: "معلّق", value: pending.length },
        {
          label: "معتمد",
          value: state.approvals.filter((a) => a.status === "approved").length,
        },
        {
          label: "مرفوض",
          value: state.approvals.filter((a) => a.status === "rejected").length,
        },
      ]}
      totalLabel="إجمالي المعروض"
      total={filtered.length}
    >
      <Card>
        <CardHeader>
          <CardTitle>الاعتمادات ({filtered.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table ariaLabel="قائمة الاعتمادات">
            <TableHeader>
              <TableRow>
                <TableHead>العنوان</TableHead>
                <TableHead>المرجع</TableHead>
                <TableHead>التصنيف</TableHead>
                <TableHead>المُقدِّم</TableHead>
                <TableHead>القيمة</TableHead>
                <TableHead>الكمية</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>إجراء</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium text-foreground">{a.titleAr}</TableCell>
                  <TableCell>
                    <BidiValue size="xs">{a.reference}</BidiValue>
                  </TableCell>
                  <TableCell>
                    <Badge variant="muted">{a.category}</Badge>
                  </TableCell>
                  <TableCell className="text-xs">{a.submittedByAr}</TableCell>
                  <TableCell className="numeric-cell">
                    {a.amountEgp !== undefined ? formatEgp(a.amountEgp) : "—"}
                  </TableCell>
                  <TableCell className="numeric-cell">
                    {a.quantityKg !== undefined ? `${formatNumber(a.quantityKg)} كجم` : "—"}
                  </TableCell>
                  <TableCell>
                    <ApprovalStatusBadge status={a.status} />
                  </TableCell>
                  <TableCell>
                    <Button variant="outline" size="sm" onClick={() => setSelected(a)}>
                      فتح
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                    لا توجد اعتمادات مطابقة.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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
                {selected.warningAr ? (
                  <div className="rounded-md border border-warning/30 bg-warning/5 p-3 text-xs">
                    <p dir="rtl">{selected.warningAr}</p>
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
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setReasonAr("");
                      setConfirm({ action: "correct", item: selected });
                    }}
                  >
                    <RefreshCw className="h-4 w-4" aria-hidden /> طلب تصحيح
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => {
                      setReasonAr("");
                      setConfirm({ action: "reject", item: selected });
                    }}
                  >
                    <XCircle className="h-4 w-4" aria-hidden /> رفض
                  </Button>
                  <Button
                    variant="accent"
                    size="sm"
                    onClick={() => setConfirm({ action: "approve", item: selected })}
                  >
                    <CheckCircle2 className="h-4 w-4" aria-hidden /> اعتماد
                  </Button>
                </div>
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
    </ManagementListScreen>
  );
}
