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
import { QualityStatusBadge } from "@/components/shared/StatusBadge";
import { useDemoStore } from "@/store/DemoStoreContext";
import { formatDate } from "@/lib/utils";

export default function QualityReview() {
  const { state } = useDemoStore();
  const tests = state.qualityTests;
  const needsReview = tests.filter((t) => t.status !== "accepted");
  const blocked = tests.filter((t) => t.status === "blocked");

  return (
    <ManagementListScreen
      title="مراجعة الجودة"
      description="مراجعة اختبارات الجودة والمخزون المحتاج لمراجعة. البيع بمخاطرة جودة يتطلب اعتماد المالك/المحاسب."
      kpis={[
        { label: "إجمالي الاختبارات", value: tests.length },
        { label: "محتاج مراجعة", value: needsReview.length },
        { label: "محجوز", value: blocked.length },
        {
          label: "مقبول",
          value: tests.filter((t) => t.status === "accepted").length,
        },
      ]}
      totalLabel="عدد الاختبارات"
      total={tests.length}
    >
      <Card>
        <CardHeader>
          <CardTitle>اختبارات الجودة</CardTitle>
        </CardHeader>
        <CardContent>
          <Table ariaLabel="اختبارات الجودة">
            <TableHeader>
              <TableRow>
                <TableHead>الرمز</TableHead>
                <TableHead>الرسالة/اللوت</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead>النتيجة</TableHead>
                <TableHead>التاريخ</TableHead>
                <TableHead>الفني</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>ملاحظات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tests.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <BidiValue size="xs">{t.code}</BidiValue>
                  </TableCell>
                  <TableCell>
                    <BidiValue size="xs">{t.batchOrLotId}</BidiValue>
                  </TableCell>
                  <TableCell className="text-xs">{t.testTypeAr}</TableCell>
                  <TableCell>
                    <BidiValue size="xs">{t.value}</BidiValue>
                  </TableCell>
                  <TableCell>
                    <BidiValue size="xs">{formatDate(t.testDate)}</BidiValue>
                  </TableCell>
                  <TableCell className="text-xs">{t.technicianAr}</TableCell>
                  <TableCell>
                    <QualityStatusBadge status={t.status} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{t.notes ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </ManagementListScreen>
  );
}
