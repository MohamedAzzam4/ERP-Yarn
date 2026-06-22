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
import { Lock, AlertCircle } from "lucide-react";
import { useDemoStore } from "@/store/DemoStoreContext";
import { formatNumber, formatTimestamp } from "@/lib/utils";

const STATUS_LABEL_AR: Record<string, string> = {
  uploaded: "مرفوع",
  processing: "قيد المعالجة",
  staged: "في التجميع",
  validated: "تم التحقق",
  reconciled: "تمت المطابقة",
  review: "للمراجعة",
  approved: "معتمد",
  committed: "ملتزم (مقفل)",
  rejected: "مرفوض",
  cancelled: "ملغي",
};

export default function MigrationStaging() {
  const { state } = useDemoStore();
  const batches = state.migrationBatches;
  const stagingRows = state.migrationStagingRows;

  return (
    <ManagementListScreen
      title="ترحيل تاريخي — تجميع"
      description="عرض دفعات الترحيل التاريخي في مرحلة التجميع. السجلات للقراءة فقط. الإخراج المحوّل آليًا يظهر فقط هنا ولا يُكتب في البيانات التشغيلية."
      kpis={[
        { label: "إجمالي الدفعات", value: batches.length },
        { label: "بنود التجميع", value: stagingRows.length },
        {
          label: "تحذيرات",
          value: stagingRows.filter((r) => r.severity === "warning").length,
        },
        {
          label: "حاجبات",
          value: stagingRows.filter((r) => r.severity === "blocker").length,
        },
      ]}
      totalLabel="عدد بنود التجميع"
      total={stagingRows.length}
    >
      <Card>
        <CardHeader>
          <CardTitle>الدفعات</CardTitle>
        </CardHeader>
        <CardContent>
          <Table ariaLabel="دفعات الترحيل">
            <TableHeader>
              <TableRow>
                <TableHead>الرمز</TableHead>
                <TableHead>الملف</TableHead>
                <TableHead>الفترة</TableHead>
                <TableHead>الرفع</TableHead>
                <TableHead>البنود</TableHead>
                <TableHead>التحذيرات</TableHead>
                <TableHead>الحاجبات</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>مقفل؟</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.map((b) => (
                <TableRow key={b.id}>
                  <TableCell>
                    <BidiValue size="xs">{b.code}</BidiValue>
                  </TableCell>
                  <TableCell className="text-xs">
                    <BidiValue size="xs">{b.fileName}</BidiValue>
                  </TableCell>
                  <TableCell>
                    <BidiValue size="xs">{b.sourcePeriod}</BidiValue>
                  </TableCell>
                  <TableCell>
                    <BidiValue size="xs">{formatTimestamp(b.uploadedAt)}</BidiValue>
                  </TableCell>
                  <TableCell className="numeric-cell">{formatNumber(b.rowCount)}</TableCell>
                  <TableCell className="numeric-cell">
                    {formatNumber(b.validationWarnings)}
                  </TableCell>
                  <TableCell className="numeric-cell">
                    {formatNumber(b.validationBlockers)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        b.status === "committed"
                          ? "approved"
                          : b.status === "rejected"
                            ? "rejected"
                            : "info"
                      }
                    >
                      {STATUS_LABEL_AR[b.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {b.isLocked ? (
                      <Badge variant="muted">
                        <Lock className="h-3 w-3" aria-hidden /> مقفل
                      </Badge>
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

      <Card>
        <CardHeader>
          <CardTitle>بنود التجميع — تجريبي للقراءة فقط</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-3 rounded-md border border-info/30 bg-info/5 p-3 text-xs text-info-foreground">
            <p className="flex items-start gap-2" dir="rtl">
              <AlertCircle className="h-4 w-4 shrink-0 text-info" aria-hidden />
              <span>
                الصفوف أدناه هي إخراج محوّل آليًا في مرحلة التجميع فقط — لا تُكتب في البيانات
                التشغيلية. أي صف يحمل علامة «تحويل آلي» يلزم مراجعة بشرية قبل الالتزام.
              </span>
            </p>
          </div>
          <Table ariaLabel="بنود التجميع">
            <TableHeader>
              <TableRow>
                <TableHead>الصف</TableHead>
                <TableHead>الوصف المصدر</TableHead>
                <TableHead>النوع المُطبَّع</TableHead>
                <TableHead>القيمة</TableHead>
                <TableHead>الكمية</TableHead>
                <TableHead>الخطورة</TableHead>
                <TableHead>تحويل آلي؟</TableHead>
                <TableHead>تحذير</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stagingRows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="numeric-cell">{r.rowNumber}</TableCell>
                  <TableCell className="text-xs">{r.sourceDescriptionAr}</TableCell>
                  <TableCell className="text-xs">{r.normalizedTypeAr}</TableCell>
                  <TableCell className="numeric-cell">
                    {r.amountEgp !== undefined ? r.amountEgp.toLocaleString("en-US") : "—"}
                  </TableCell>
                  <TableCell className="numeric-cell">
                    {r.quantityKg !== undefined ? `${formatNumber(r.quantityKg)} كجم` : "—"}
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
                  <TableCell>
                    <Badge variant={r.aiTransformed ? "info" : "muted"}>
                      {r.aiTransformed ? "آلي" : "يدوي"}
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
    </ManagementListScreen>
  );
}
