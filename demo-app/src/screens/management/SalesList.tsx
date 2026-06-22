import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
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
import { useDemoStore } from "@/store/DemoStoreContext";
import { canSeeFinancials } from "@/lib/permissions";
import { formatEgp, formatDate } from "@/lib/utils";

export default function SalesList() {
  const { state, nextShowcaseCode } = useDemoStore();
  const role = state.currentRole;
  const seeFinancials = canSeeFinancials(role);

  const { query, setQuery, filtered } = useSearchFilter(state.sales, (s, q) => {
    const customer = state.customers.find((c) => c.id === s.customerId);
    return `${s.code} ${customer?.nameAr} ${customer?.code}`
      .toLowerCase()
      .includes(q.toLowerCase());
  });

  const nextCode = nextShowcaseCode("SAL");

  return (
    <ManagementListScreen
      title="المبيعات"
      description="قائمة المبيعات مع الفلاتر والبحث. كل بيع يتطلب اعتمادًا قبل التنفيذ."
      searchValue={query}
      onSearchChange={setQuery}
      searchPlaceholder="ابحث برمز البيع أو العميل..."
      kpis={[
        { label: "إجمالي المبيعات", value: filtered.length },
        {
          label: "معتمدة",
          value: filtered.filter((s) => s.status === "approved").length,
        },
        {
          label: "مسودة",
          value: filtered.filter((s) => s.status === "draft").length,
        },
        {
          label: "بانتظار الاعتماد",
          value: filtered.filter((s) => s.status === "pending").length,
        },
      ]}
      totalLabel="عدد المبيعات"
      total={filtered.length}
    >
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>المبيعات ({filtered.length})</CardTitle>
          <Button asChild size="sm" variant="accent">
            <Link to={`/management/sales/new?code=${nextCode}`}>
              <Plus className="h-4 w-4" aria-hidden /> مسودة بيع جديدة
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          <Table ariaLabel="قائمة المبيعات">
            <TableHeader>
              <TableRow>
                <TableHead>الرمز</TableHead>
                <TableHead>العميل</TableHead>
                <TableHead>التاريخ</TableHead>
                <TableHead>الحالة</TableHead>
                {seeFinancials ? <TableHead>الإيراد الصافي</TableHead> : null}
                {seeFinancials ? <TableHead>الربح التقريبي</TableHead> : null}
                <TableHead>إجراء</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((s) => {
                const customer = state.customers.find((c) => c.id === s.customerId);
                return (
                  <TableRow key={s.id}>
                    <TableCell>
                      <BidiValue size="xs">{s.code}</BidiValue>
                    </TableCell>
                    <TableCell className="text-xs">{customer?.nameAr ?? "—"}</TableCell>
                    <TableCell>
                      <BidiValue size="xs">{formatDate(s.date)}</BidiValue>
                    </TableCell>
                    <TableCell>
                      <ApprovalStatusBadge status={s.status} />
                    </TableCell>
                    {seeFinancials ? (
                      <TableCell className="numeric-cell">
                        <BidiValue numeric size="xs">
                          {formatEgp(s.netRevenueEgp)}
                        </BidiValue>
                      </TableCell>
                    ) : null}
                    {seeFinancials ? (
                      <TableCell className="numeric-cell">
                        {s.profitEgp !== undefined ? (
                          <BidiValue numeric size="xs">
                            {formatEgp(s.profitEgp)}
                          </BidiValue>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    ) : null}
                    <TableCell>
                      <Button asChild variant="outline" size="sm">
                        <Link to={`/management/sales/${s.id}`}>فتح</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={seeFinancials ? 7 : 5}
                    className="h-24 text-center text-muted-foreground"
                  >
                    لا توجد مبيعات مطابقة.
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
