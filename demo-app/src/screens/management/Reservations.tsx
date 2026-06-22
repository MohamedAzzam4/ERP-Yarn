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
import { EmptyState } from "@/components/shared/EmptyState";
import { useDemoStore } from "@/store/DemoStoreContext";
import { formatNumber } from "@/lib/utils";

const STATUS_LABEL_AR: Record<string, string> = {
  active: "نشط",
  consumed: "مُستهلَك",
  released: "مُحرَّر",
};

export default function Reservations() {
  const { state } = useDemoStore();
  const reservations = state.reservations;

  return (
    <ManagementListScreen
      title="الحجوزات"
      description="حجوزات المخزون المرتبطة بالمبيعات قيد الاعتماد. الحجز النشط يحمي الكمية دون تخفيض الرصيد المتاح حتى الاعتماد."
      kpis={[
        { label: "إجمالي الحجوزات", value: reservations.length },
        {
          label: "نشطة",
          value: reservations.filter((r) => r.status === "active").length,
        },
        {
          label: "مُستهلَكة",
          value: reservations.filter((r) => r.status === "consumed").length,
        },
        {
          label: "مُحرَّرة",
          value: reservations.filter((r) => r.status === "released").length,
        },
      ]}
      totalLabel="عدد الحجوزات"
      total={reservations.length}
    >
      {reservations.length === 0 ? (
        <EmptyState
          title="لا توجد حجوزات بعد"
          description="أنشئ مسودة بيع مع حجز لرؤية الحجز يظهر هنا. الحجز لا يخفض الرصيد المتاح حتى اعتماد البيع."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>الحجوزات ({reservations.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table ariaLabel="الحجوزات">
              <TableHeader>
                <TableRow>
                  <TableHead>البيع</TableHead>
                  <TableHead>الصنف</TableHead>
                  <TableHead>الرسالة/اللوت</TableHead>
                  <TableHead>الموقع</TableHead>
                  <TableHead>الكمية المحجوزة</TableHead>
                  <TableHead>الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reservations.map((r) => {
                  const item = state.items.find((i) => i.id === r.itemId);
                  const loc = state.locations.find((l) => l.id === r.locationId);
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        <BidiValue size="xs">{r.saleId}</BidiValue>
                      </TableCell>
                      <TableCell>
                        <BidiValue size="xs">{item?.code}</BidiValue>
                        <span className="block text-xs text-muted-foreground">{item?.nameAr}</span>
                      </TableCell>
                      <TableCell>
                        <BidiValue size="xs">{r.batchOrLotId}</BidiValue>
                      </TableCell>
                      <TableCell className="text-xs">{loc?.nameAr ?? "—"}</TableCell>
                      <TableCell className="numeric-cell">
                        {formatNumber(r.quantityKg)} كجم
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            r.status === "active"
                              ? "info"
                              : r.status === "consumed"
                                ? "approved"
                                : "muted"
                          }
                        >
                          {STATUS_LABEL_AR[r.status]}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </ManagementListScreen>
  );
}
