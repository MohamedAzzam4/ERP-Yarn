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
import { Badge } from "@/components/ui/badge";
import { useDemoStore } from "@/store/DemoStoreContext";
import { canManagePayments } from "@/lib/permissions";
import { formatEgp, formatDate } from "@/lib/utils";

export default function Payments() {
  const { state } = useDemoStore();
  const canManage = canManagePayments(state.currentRole);

  const { query, setQuery, filtered } = useSearchFilter(state.payments, (p, q) => {
    const party =
      p.partyType === "customer"
        ? state.customers.find((c) => c.id === p.partyId)?.nameAr
        : p.partyType === "supplier"
          ? state.suppliers.find((s) => s.id === p.partyId)?.nameAr
          : state.factories.find((f) => f.id === p.partyId)?.nameAr;
    return `${p.code} ${party} ${p.method}`.toLowerCase().includes(q.toLowerCase());
  });

  const inbound = filtered
    .filter((p) => p.direction === "inbound")
    .reduce((s, p) => s + p.amountEgp, 0);
  const outbound = filtered
    .filter((p) => p.direction === "outbound")
    .reduce((s, p) => s + p.amountEgp, 0);

  return (
    <ManagementListScreen
      title="المدفوعات"
      description="المدفوعات الواردة والصادرة وحالتها. كل دفعة تتطلب اعتمادًا قبل الترحيل."
      searchValue={query}
      onSearchChange={setQuery}
      searchPlaceholder="ابحث برمز الدفعة أو الطرف..."
      kpis={[
        { label: "إجمالي المدفوعات", value: filtered.length },
        { label: "وارد (جنيه)", value: formatEgp(inbound) },
        { label: "صادر (جنيه)", value: formatEgp(outbound) },
        {
          label: "معلّقة",
          value: filtered.filter((p) => p.status === "pending").length,
        },
      ]}
      totalLabel="عدد المدفوعات"
      total={filtered.length}
    >
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>المدفوعات ({filtered.length})</CardTitle>
          {canManage ? (
            <Button size="sm" variant="accent">
              <Plus className="h-4 w-4" aria-hidden /> دفعة جديدة (عرض)
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          <Table ariaLabel="قائمة المدفوعات">
            <TableHeader>
              <TableRow>
                <TableHead>الرمز</TableHead>
                <TableHead>التاريخ</TableHead>
                <TableHead>الاتجاه</TableHead>
                <TableHead>الطرف</TableHead>
                <TableHead>القيمة</TableHead>
                <TableHead>الطريقة</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>إجراء</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => {
                const party =
                  p.partyType === "customer"
                    ? state.customers.find((c) => c.id === p.partyId)
                    : p.partyType === "supplier"
                      ? state.suppliers.find((s) => s.id === p.partyId)
                      : state.factories.find((f) => f.id === p.partyId);
                return (
                  <TableRow key={p.id}>
                    <TableCell>
                      <BidiValue size="xs">{p.code}</BidiValue>
                    </TableCell>
                    <TableCell>
                      <BidiValue size="xs">{formatDate(p.date)}</BidiValue>
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.direction === "inbound" ? "success" : "info"}>
                        {p.direction === "inbound" ? "وارد" : "صادر"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{party?.nameAr ?? "—"}</TableCell>
                    <TableCell className="numeric-cell">
                      <BidiValue numeric size="xs">
                        {formatEgp(p.amountEgp)}
                      </BidiValue>
                    </TableCell>
                    <TableCell className="text-xs">
                      {p.method === "cash"
                        ? "نقدي"
                        : p.method === "bank_transfer"
                          ? "تحويل بنكي"
                          : "شيك"}
                    </TableCell>
                    <TableCell>
                      <ApprovalStatusBadge status={p.status} />
                    </TableCell>
                    <TableCell>
                      {p.partyType === "customer" ? (
                        <Button asChild variant="outline" size="sm">
                          <Link to={`/management/statements/customer/${p.partyId}`}>
                            كشف الحساب
                          </Link>
                        </Button>
                      ) : p.partyType === "supplier" ? (
                        <Button asChild variant="outline" size="sm">
                          <Link to={`/management/statements/supplier/${p.partyId}`}>
                            كشف الحساب
                          </Link>
                        </Button>
                      ) : (
                        <Button asChild variant="outline" size="sm">
                          <Link to={`/management/statements/factory/${p.partyId}`}>كشف الحساب</Link>
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                    لا توجد مدفوعات مطابقة.
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
