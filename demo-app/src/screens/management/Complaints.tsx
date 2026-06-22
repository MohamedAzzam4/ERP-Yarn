import { Link } from "react-router-dom";
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
import { Badge } from "@/components/ui/badge";
import { useDemoStore } from "@/store/DemoStoreContext";
import { formatDate, formatNumber } from "@/lib/utils";

const STATUS_LABEL_AR: Record<string, string> = {
  open: "مفتوح",
  investigating: "تحقيق",
  return_proposed: "مرتجع مقترح",
  resolved: "محلول",
  closed: "مغلق",
};

export default function Complaints() {
  const { state } = useDemoStore();
  const { query, setQuery, filtered } = useSearchFilter(state.complaints, (c, q) => {
    const customer = state.customers.find((cus) => cus.id === c.customerId);
    return `${c.code} ${customer?.nameAr} ${c.saleId}`.toLowerCase().includes(q.toLowerCase());
  });

  return (
    <ManagementListScreen
      title="الشكاوى"
      description="إدارة الشكاوى وتحقيقات الجودة. العامل يُسجِّل الحقائق فقط؛ المعالجة المالية يقررها المالك/المحاسب."
      searchValue={query}
      onSearchChange={setQuery}
      searchPlaceholder="ابحث برمز الشكوى أو العميل..."
      kpis={[
        { label: "إجمالي الشكاوى", value: filtered.length },
        {
          label: "مفتوحة",
          value: filtered.filter((c) => c.status === "open" || c.status === "investigating").length,
        },
        {
          label: "محلولة",
          value: filtered.filter((c) => c.status === "resolved" || c.status === "closed").length,
        },
        {
          label: "بانتظار مرتجع",
          value: filtered.filter((c) => c.status === "return_proposed").length,
        },
      ]}
      totalLabel="عدد الشكاوى"
      total={filtered.length}
    >
      <Card>
        <CardHeader>
          <CardTitle>الشكاوى ({filtered.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table ariaLabel="الشكاوى">
            <TableHeader>
              <TableRow>
                <TableHead>الرمز</TableHead>
                <TableHead>العميل</TableHead>
                <TableHead>البيع</TableHead>
                <TableHead>الصنف</TableHead>
                <TableHead>تاريخ الفتح</TableHead>
                <TableHead>الكمية المتأثرة</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>إجراء</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => {
                const customer = state.customers.find((cus) => cus.id === c.customerId);
                const item = state.items.find((i) => i.id === c.itemId);
                return (
                  <TableRow key={c.id}>
                    <TableCell>
                      <BidiValue size="xs">{c.code}</BidiValue>
                    </TableCell>
                    <TableCell className="text-xs">{customer?.nameAr ?? "—"}</TableCell>
                    <TableCell>
                      <BidiValue size="xs">{c.saleId}</BidiValue>
                    </TableCell>
                    <TableCell className="text-xs">{item?.nameAr ?? "—"}</TableCell>
                    <TableCell>
                      <BidiValue size="xs">{formatDate(c.openedDate)}</BidiValue>
                    </TableCell>
                    <TableCell className="numeric-cell">
                      {formatNumber(c.affectedQuantityKg)} كجم
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          c.status === "closed" || c.status === "resolved"
                            ? "approved"
                            : c.status === "investigating"
                              ? "info"
                              : "warning"
                        }
                      >
                        {STATUS_LABEL_AR[c.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button asChild variant="outline" size="sm">
                        <Link to="/management/returns">ربط بمرتجع</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                    لا توجد شكاوى مطابقة.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </ManagementListScreen>
  );
}
