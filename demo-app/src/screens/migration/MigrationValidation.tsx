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
import { BidiValue } from "@/components/shared/BidiValue";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { useDemoStore } from "@/store/DemoStoreContext";
import { formatEgp, formatNumber } from "@/lib/utils";

export default function MigrationValidation() {
  const { state } = useDemoStore();
  const batch = state.migrationBatches[0];
  if (!batch) {
    return (
      <ManagementListScreen title="ترحيل تاريخي — تحقق ومطابقة">
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            لا توجد دفعات ترحيل.
          </CardContent>
        </Card>
      </ManagementListScreen>
    );
  }
  const rows = state.migrationStagingRows.filter((r) => r.batchId === batch.id);
  const totalSourceAmount = rows.reduce((s, r) => s + (r.amountEgp ?? 0), 0);
  const difference = batch.reconciliationDifferenceEgp ?? 0;
  const passed = batch.validationBlockers === 0 && difference === 0;

  return (
    <ManagementListScreen
      title="ترحيل تاريخي — تحقق ومطابقة"
      description="التحقق من تجانس الصفوف ومطابقة الإجمالي مع المصدر. الالتزام يتطلب اعتمادًا مزدوجًا من المالك والمحاسب."
      kpis={[
        { label: "إجمالي بنود الدفعة", value: batch.rowCount },
        { label: "تحذيرات", value: batch.validationWarnings },
        { label: "حاجبات", value: batch.validationBlockers },
        {
          label: "فرق المطابقة (جنيه)",
          value: formatEgp(difference),
        },
      ]}
      totalLabel="عدد البنود المعروضة"
      total={rows.length}
    >
      <Card
        className={passed ? "border-success/30 bg-success/5" : "border-warning/30 bg-warning/5"}
      >
        <CardContent className="flex items-start gap-3 p-4 text-sm">
          {passed ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />
          ) : (
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
          )}
          <div className="flex-1 space-y-1">
            <p className="font-semibold" dir="rtl">
              {passed
                ? "تم اجتياز التحقق والمطابقة"
                : "توجد حاجبات أو فروقات — لا يمكن الالتزام قبل حلها"}
            </p>
            <p className="text-xs text-muted-foreground" dir="rtl">
              إجمالي القيمة المصدر: <BidiValue numeric>{formatEgp(totalSourceAmount)}</BidiValue> —
              فرق المطابقة: <BidiValue numeric>{formatEgp(difference)}</BidiValue>
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>نتائج التحقق</CardTitle>
        </CardHeader>
        <CardContent>
          <Table ariaLabel="نتائج التحقق">
            <TableHeader>
              <TableRow>
                <TableHead>الصف</TableHead>
                <TableHead>الوصف</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead>القيمة</TableHead>
                <TableHead>الخطورة</TableHead>
                <TableHead>التحذير</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="numeric-cell">{r.rowNumber}</TableCell>
                  <TableCell className="text-xs">{r.sourceDescriptionAr}</TableCell>
                  <TableCell className="text-xs">{r.normalizedTypeAr}</TableCell>
                  <TableCell className="numeric-cell">
                    {r.amountEgp !== undefined ? formatEgp(r.amountEgp) : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        r.severity === "blocker"
                          ? "blocked"
                          : r.severity === "warning"
                            ? "needsReview"
                            : "approved"
                      }
                    >
                      {r.severity === "blocker"
                        ? "حاجب"
                        : r.severity === "warning"
                          ? "تحذير"
                          : "سليم"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.warningAr ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        إجمالي بنود الدفعة في الملف: <BidiValue numeric>{formatNumber(batch.rowCount)}</BidiValue> —
        المعروض هنا عيّنة تجريبية فقط.
      </p>
    </ManagementListScreen>
  );
}
