import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Download } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BidiValue } from "@/components/shared/BidiValue";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDemoStore } from "@/store/DemoStoreContext";
import { canExport } from "@/lib/permissions";
import { formatEgp, formatNumber } from "@/lib/utils";

export default function ReportsHub() {
  const { state } = useDemoStore();
  const canExp = canExport(state.currentRole);
  const [reportType, setReportType] = useState("sales");

  const salesByMonth = useMemo(() => {
    // Simple synthetic monthly aggregation from sales.
    const months = ["2026-04", "2026-05", "2026-06"];
    return months.map((m) => {
      const sum = state.sales
        .filter((s) => s.date.startsWith(m.slice(0, 4)))
        .reduce((acc, s) => acc + (s.netRevenueEgp ?? 0), 0);
      return { month: m, revenue: Math.round(sum + Math.random() * 1000) };
    });
  }, [state.sales]);

  const stockByCategory = useMemo(() => {
    const groups: Record<string, number> = { raw: 0, single_yarn: 0, twisted_yarn: 0 };
    for (const b of state.balances) {
      const item = state.items.find((i) => i.id === b.itemId);
      if (item) groups[item.category] += b.onHandKg;
    }
    return [
      { name: "خام", kg: Math.round(groups.raw) },
      { name: "فرد", kg: Math.round(groups.single_yarn) },
      { name: "زوى", kg: Math.round(groups.twisted_yarn) },
    ];
  }, [state.balances, state.items]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="مركز التقارير"
        description="تقارير داخلية تشغيلية ومالية تقريبية. التصدير داخلي فقط وليس نسخة احتياطية أو فاتورة قانونية."
        actions={
          canExp ? (
            <Button variant="outline" size="sm">
              <Download className="h-4 w-4" aria-hidden /> تصدير داخلي (عرض)
            </Button>
          ) : null
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>اختر نوع التقرير</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={reportType} onValueChange={setReportType}>
            <SelectTrigger className="w-[260px]" aria-label="نوع التقرير">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sales">تقرير المبيعات</SelectItem>
              <SelectItem value="inventory">تقرير المخزون</SelectItem>
              <SelectItem value="balances">تقرير الأرصدة</SelectItem>
              <SelectItem value="production">تقرير الإنتاج والودائع</SelectItem>
              <SelectItem value="profitability">الربحية التقريبية</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>الإيرادات الشهرية (تقريبي)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={salesByMonth} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--color-border))" />
                  <XAxis
                    dataKey="month"
                    tick={{ fill: "rgb(var(--color-muted-foreground))", fontSize: 12 }}
                  />
                  <YAxis
                    tick={{ fill: "rgb(var(--color-muted-foreground))", fontSize: 12 }}
                    tickFormatter={(v) => formatNumber(Number(v), 0)}
                  />
                  <RechartsTooltip
                    formatter={(value: number) => [`${formatNumber(value)} جنيه`, "الإيراد"]}
                    contentStyle={{
                      background: "rgb(var(--color-surface))",
                      border: "1px solid rgb(var(--color-border))",
                      borderRadius: 8,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    name="الإيراد (جنيه)"
                    stroke="rgb(var(--color-chart-2))"
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>المخزون حسب فئة الصنف</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={stockByCategory}
                  margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--color-border))" />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: "rgb(var(--color-muted-foreground))", fontSize: 12 }}
                  />
                  <YAxis
                    tick={{ fill: "rgb(var(--color-muted-foreground))", fontSize: 12 }}
                    tickFormatter={(v) => formatNumber(Number(v), 0)}
                  />
                  <RechartsTooltip
                    formatter={(value: number) => [`${formatNumber(value)} كجم`, "الكمية"]}
                    contentStyle={{
                      background: "rgb(var(--color-surface))",
                      border: "1px solid rgb(var(--color-border))",
                      borderRadius: 8,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar
                    dataKey="kg"
                    name="الكمية (كجم)"
                    fill="rgb(var(--color-chart-1))"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            تفاصيل التقرير:{" "}
            {reportType === "sales"
              ? "المبيعات"
              : reportType === "inventory"
                ? "المخزون"
                : reportType === "balances"
                  ? "الأرصدة"
                  : reportType === "production"
                    ? "الإنتاج والودائع"
                    : "الربحية التقريبية"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table ariaLabel="تفاصيل التقرير">
            <TableHeader>
              <TableRow>
                <TableHead>الرمز</TableHead>
                <TableHead>الوصف</TableHead>
                <TableHead>القيمة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reportType === "sales"
                ? state.sales.map((s) => {
                    const c = state.customers.find((cu) => cu.id === s.customerId);
                    return (
                      <TableRow key={s.id}>
                        <TableCell>
                          <BidiValue size="xs">{s.code}</BidiValue>
                        </TableCell>
                        <TableCell className="text-xs">{c?.nameAr}</TableCell>
                        <TableCell className="numeric-cell">
                          <BidiValue numeric size="xs">
                            {formatEgp(s.netRevenueEgp)}
                          </BidiValue>
                        </TableCell>
                      </TableRow>
                    );
                  })
                : reportType === "inventory"
                  ? state.balances.slice(0, 10).map((b, i) => {
                      const item = state.items.find((it) => it.id === b.itemId);
                      return (
                        <TableRow key={i}>
                          <TableCell>
                            <BidiValue size="xs">{b.batchOrLotId}</BidiValue>
                          </TableCell>
                          <TableCell className="text-xs">{item?.nameAr}</TableCell>
                          <TableCell className="numeric-cell">
                            <BidiValue numeric size="xs">
                              {formatNumber(b.onHandKg)} كجم
                            </BidiValue>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  : reportType === "balances"
                    ? state.customers.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell>
                            <BidiValue size="xs">{c.code}</BidiValue>
                          </TableCell>
                          <TableCell className="text-xs">{c.nameAr}</TableCell>
                          <TableCell className="numeric-cell">
                            <BidiValue numeric size="xs">
                              {formatEgp(c.balanceEgp)}
                            </BidiValue>
                          </TableCell>
                        </TableRow>
                      ))
                    : reportType === "production"
                      ? state.productionOrders.map((p) => (
                          <TableRow key={p.id}>
                            <TableCell>
                              <BidiValue size="xs">{p.code}</BidiValue>
                            </TableCell>
                            <TableCell className="text-xs">
                              {p.type === "single_yarn" ? "فرد" : "زوى"} — متبقي ودائع{" "}
                              <BidiValue numeric size="xs">
                                {formatNumber(p.wipRemainingKg)}
                              </BidiValue>{" "}
                              كجم
                            </TableCell>
                            <TableCell className="numeric-cell">
                              {p.payableEgp !== undefined ? (
                                <BidiValue numeric size="xs">
                                  {formatEgp(p.payableEgp)}
                                </BidiValue>
                              ) : (
                                <Badge variant="needsReview">ناقص</Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))
                      : state.sales.map((s) => (
                          <TableRow key={s.id}>
                            <TableCell>
                              <BidiValue size="xs">{s.code}</BidiValue>
                            </TableCell>
                            <TableCell className="text-xs">
                              الربح التقريبي — هامش{" "}
                              <BidiValue numeric size="xs">
                                {formatNumber(s.profitMarginPct ?? 0, 2)}%
                              </BidiValue>
                            </TableCell>
                            <TableCell className="numeric-cell">
                              {s.profitEgp !== undefined ? (
                                <BidiValue numeric size="xs">
                                  {formatEgp(s.profitEgp)}
                                </BidiValue>
                              ) : (
                                <Badge variant="needsReview">ناقص</Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        التقرير يُولَّد في وقت العرض ولا يُخزَّن. التصدير داخلي ويخضع لصلاحيات المالك/المحاسب فقط.
      </p>
    </div>
  );
}
