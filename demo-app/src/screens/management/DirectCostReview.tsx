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
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useDemoStore } from "@/store/DemoStoreContext";
import { formatEgp } from "@/lib/utils";

export default function DirectCostReview() {
  const { state } = useDemoStore();
  const [confirm, setConfirm] = useState<{ action: "approve" | "reject"; id: string } | null>(null);

  const items = state.directCosts;
  const pending = items.filter((d) => d.status === "pending_review");

  return (
    <ManagementListScreen
      title="مراجعة التكاليف المباشرة"
      description="فصل المسؤولية والمُكلَّف الفعلي وتأثير الربحية والتخصيص. لا يجوز الخلط بين المسؤولية والمُكلَّف افتراضيًا."
      kpis={[
        { label: "إجمالي البنود", value: items.length },
        { label: "بانتظار المراجعة", value: pending.length },
        {
          label: "معتمدة",
          value: items.filter((d) => d.status === "approved").length,
        },
        {
          label: "مرفوضة",
          value: items.filter((d) => d.status === "rejected").length,
        },
      ]}
      totalLabel="عدد البنود"
      total={items.length}
    >
      <Card>
        <CardHeader>
          <CardTitle>التكاليف المباشرة</CardTitle>
        </CardHeader>
        <CardContent>
          <Table ariaLabel="التكاليف المباشرة">
            <TableHeader>
              <TableRow>
                <TableHead>الرمز</TableHead>
                <TableHead>العملية المرتبطة</TableHead>
                <TableHead>القيمة</TableHead>
                <TableHead>اقتراح العامل</TableHead>
                <TableHead>المسؤولية المؤكدة</TableHead>
                <TableHead>المُكلَّف</TableHead>
                <TableHead>التخصيص</TableHead>
                <TableHead>ضمن الربحية</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>إجراء</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    <BidiValue size="xs">{d.code}</BidiValue>
                  </TableCell>
                  <TableCell className="text-xs">{d.linkedOperationAr}</TableCell>
                  <TableCell className="numeric-cell">
                    <BidiValue numeric size="xs">
                      {formatEgp(d.amountEgp)}
                    </BidiValue>
                  </TableCell>
                  <TableCell className="text-xs">{d.workerSuggestionAr ?? "—"}</TableCell>
                  <TableCell className="text-xs">{d.confirmedResponsibilityAr ?? "—"}</TableCell>
                  <TableCell className="text-xs">{d.confirmedPayerType ?? "—"}</TableCell>
                  <TableCell className="text-xs">{d.allocationTarget ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={d.profitabilityIncluded ? "approved" : "muted"}>
                      {d.profitabilityIncluded ? "نعم" : "لا"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        d.status === "approved"
                          ? "approved"
                          : d.status === "rejected"
                            ? "rejected"
                            : "needsReview"
                      }
                    >
                      {d.status === "approved"
                        ? "معتمدة"
                        : d.status === "rejected"
                          ? "مرفوضة"
                          : "بانتظار المراجعة"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {d.status === "pending_review" ? (
                      <div className="flex gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setConfirm({ action: "approve", id: d.id });
                          }}
                        >
                          <CheckCircle2 className="h-3 w-3" aria-hidden /> اعتماد
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => setConfirm({ action: "reject", id: d.id })}
                        >
                          <XCircle className="h-3 w-3" aria-hidden /> رفض
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={
          confirm?.action === "approve" ? "تأكيد اعتماد التكلفة المباشرة" : "تأكيد رفض التكلفة"
        }
        description={
          confirm?.action === "approve"
            ? "أدخل المسؤولية والمُكلَّف والتخصيص قبل الاعتماد. لا يجوز افتراض تساوي المسؤولية والمُكلَّف."
            : "سيتم رفض التكلفة مع توضيح السبب."
        }
        confirmLabel={confirm?.action === "approve" ? "اعتماد" : "رفض"}
        destructive={confirm?.action === "reject"}
        reasonRequired={confirm?.action === "reject"}
        onConfirm={() => {
          if (!confirm) return;
          setConfirm(null);
        }}
      />
    </ManagementListScreen>
  );
}
