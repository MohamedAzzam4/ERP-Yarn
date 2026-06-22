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
import { canSeeFinancials } from "@/lib/permissions";
import { formatEgp, formatNumber } from "@/lib/utils";

const STATUS_LABEL_AR: Record<string, string> = {
  draft: "مسودة",
  in_progress: "قيد التنفيذ",
  completed: "مكتمل",
  wip_returned: "مُرجَّع ودائع",
};

export default function ProductionOrders() {
  const { state } = useDemoStore();
  const role = state.currentRole;
  const seeFinancials = canSeeFinancials(role);

  const { query, setQuery, filtered } = useSearchFilter(state.productionOrders, (p, q) => {
    const factory = state.factories.find((f) => f.id === p.factoryId);
    return `${p.code} ${factory?.nameAr} ${p.type}`.toLowerCase().includes(q.toLowerCase());
  });

  return (
    <ManagementListScreen
      title="أوامر الإنتاج وودائع العمل"
      description={
        seeFinancials
          ? "أوامر الإنتاج مع الودائع والتكلفة والالتزامات — مرئية للمالك والمحاسب فقط."
          : "أوامر الإنتاج والودائع — بلا بيانات مالية."
      }
      searchValue={query}
      onSearchChange={setQuery}
      searchPlaceholder="ابحث برمز الأمر أو المصنع..."
      kpis={[
        { label: "إجمالي الأوامر", value: filtered.length },
        {
          label: "قيد التنفيذ",
          value: filtered.filter((p) => p.status === "in_progress").length,
        },
        {
          label: "مكتملة",
          value: filtered.filter((p) => p.status === "completed").length,
        },
        {
          label: "بدون تكلفة",
          value: filtered.filter((p) => p.hasMissingCost).length,
        },
      ]}
      totalLabel="عدد الأوامر"
      total={filtered.length}
    >
      <Card>
        <CardHeader>
          <CardTitle>أوامر الإنتاج</CardTitle>
        </CardHeader>
        <CardContent>
          <Table ariaLabel="أوامر الإنتاج">
            <TableHeader>
              <TableRow>
                <TableHead>الرمز</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead>المصنع</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>مصروف</TableHead>
                <TableHead>مُنتَج</TableHead>
                <TableHead>متبقي ودائع</TableHead>
                {seeFinancials ? <TableHead>المستحق</TableHead> : null}
                <TableHead>إجراء</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => {
                const factory = state.factories.find((f) => f.id === p.factoryId);
                return (
                  <TableRow key={p.id}>
                    <TableCell>
                      <BidiValue size="xs">{p.code}</BidiValue>
                    </TableCell>
                    <TableCell>{p.type === "single_yarn" ? "فرد" : "زوى"}</TableCell>
                    <TableCell className="text-xs">{factory?.nameAr ?? "—"}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          p.status === "completed"
                            ? "approved"
                            : p.status === "in_progress"
                              ? "info"
                              : "muted"
                        }
                      >
                        {STATUS_LABEL_AR[p.status]}
                      </Badge>
                      {p.hasMissingCost ? (
                        <Badge variant="needsReview" className="ms-1">
                          تكلفة ناقصة
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="numeric-cell">{formatNumber(p.issuedKg)} كجم</TableCell>
                    <TableCell className="numeric-cell">{formatNumber(p.outputKg)} كجم</TableCell>
                    <TableCell className="numeric-cell">
                      {formatNumber(p.wipRemainingKg)} كجم
                    </TableCell>
                    {seeFinancials ? (
                      <TableCell className="numeric-cell">
                        {p.payableEgp !== undefined ? (
                          <BidiValue numeric size="xs">
                            {formatEgp(p.payableEgp)}
                          </BidiValue>
                        ) : (
                          <Badge variant="needsReview">بانتظار التكلفة</Badge>
                        )}
                      </TableCell>
                    ) : null}
                    <TableCell>
                      <Button asChild variant="outline" size="sm">
                        <Link to={`/management/production-orders/${p.id}`}>فتح</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </ManagementListScreen>
  );
}
