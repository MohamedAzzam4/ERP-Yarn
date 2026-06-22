import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Factory,
  FileWarning,
  PackageCheck,
  Receipt,
  ShieldAlert,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PageHeader } from "@/components/shared/PageHeader";
import { KpiCard } from "@/components/shared/KpiCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BidiValue } from "@/components/shared/BidiValue";
import { Timeline } from "@/components/shared/Timeline";
import { ApprovalStatusBadge } from "@/components/shared/StatusBadge";
import { useDemoStore } from "@/store/DemoStoreContext";
import { formatEgp, formatNumber, formatTimestamp } from "@/lib/utils";

/**
 * Owner Dashboard — Reference Screen (per design contract §6.1).
 * Shows high-level cards, alerts, approximate profitability, traceability drill-down.
 */
export default function OwnerDashboard() {
  const { state } = useDemoStore();

  const totalStockKg = useMemo(
    () => state.balances.reduce((sum, b) => sum + b.onHandKg, 0),
    [state.balances],
  );
  const factoryStockKg = useMemo(() => {
    const factoryLocIds = state.locations.filter((l) => l.type === "factory").map((l) => l.id);
    return state.balances
      .filter((b) => factoryLocIds.includes(b.locationId))
      .reduce((sum, b) => sum + b.onHandKg, 0);
  }, [state.balances, state.locations]);
  const pendingApprovals = state.approvals.filter((a) => a.status === "pending");
  const openComplaints = state.complaints.filter(
    (c) => c.status !== "closed" && c.status !== "resolved",
  );
  const totalApprovedRevenue = state.sales
    .filter((s) => s.status === "approved")
    .reduce((sum, s) => sum + (s.netRevenueEgp ?? 0), 0);
  const totalApprovedProfit = state.sales
    .filter((s) => s.status === "approved")
    .reduce((sum, s) => sum + (s.profitEgp ?? 0), 0);
  const profitMarginPct =
    totalApprovedRevenue > 0 ? (totalApprovedProfit / totalApprovedRevenue) * 100 : 0;

  // Customer balances
  const customerBalances = state.customers.map((c) => ({
    code: c.code,
    nameAr: c.nameAr,
    balanceEgp: c.balanceEgp ?? 0,
  }));
  const factoryBalances = state.factories.map((f) => ({
    code: f.code,
    nameAr: f.nameAr,
    balanceEgp: f.balanceEgp ?? 0,
  }));

  // Chart data — stock by location type
  const stockByLocationType = useMemo(() => {
    const groups: Record<string, number> = { internal: 0, port: 0, factory: 0, return: 0 };
    for (const b of state.balances) {
      const loc = state.locations.find((l) => l.id === b.locationId);
      if (loc) groups[loc.type] += b.onHandKg;
    }
    return [
      { name: "مخزن داخلي", kg: Math.round(groups.internal) },
      { name: "مخزن ميناء", kg: Math.round(groups.port) },
      { name: "مصنع خارجي", kg: Math.round(groups.factory) },
      { name: "مرتجعات", kg: Math.round(groups.return) },
    ];
  }, [state.balances, state.locations]);

  const recentActivity = state.activity.slice(0, 6).map((a) => ({
    id: a.id,
    date: formatTimestamp(a.timestamp),
    titleAr: a.actionAr,
    descriptionAr: a.category ? `تصنيف: ${categoryLabel(a.category)}` : "",
    reference: a.reference,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="لوحة المالك"
        description="مؤشرات شاملة: مخزون، اعتمادات، أرصدة، ربحية تقريبية، تنبيهات. القيم تجريبية."
        actions={
          <Link to="/all-screens">
            <Button variant="outline" size="sm">
              عرض جميع الشاشات
            </Button>
          </Link>
        }
      />

      {/* Alerts row */}
      {pendingApprovals.length > 0 ? (
        <Card className="border-warning/30 bg-warning/5">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
            <div className="flex-1 space-y-1">
              <p className="font-heading text-sm font-semibold text-warning-foreground">
                اعتمادات معلّقة بانتظار مراجعتك
              </p>
              <p className="text-xs text-muted-foreground" dir="rtl">
                يوجد <BidiValue numeric>{pendingApprovals.length}</BidiValue> اعتماد معلّق.{" "}
                <Link to="/management/approvals" className="text-accent hover:underline">
                  فتح مركز الاعتمادات
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* KPI cards */}
      <section
        aria-label="مؤشرات الأداء الرئيسية"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <KpiCard
          label="إجمالي المخزون (كجم)"
          value={formatNumber(totalStockKg)}
          icon={<Boxes className="h-4 w-4" aria-hidden />}
          tone="primary"
          hint="كل المواقع بما فيها المصانع الخارجية"
        />
        <KpiCard
          label="مخزون المصانع الخارجية (كجم)"
          value={formatNumber(factoryStockKg)}
          icon={<Factory className="h-4 w-4" aria-hidden />}
          tone="info"
          hint="مخزون مملوك للشركة قائم في مصانع التشغيل"
        />
        <KpiCard
          label="اعتمادات معلّقة"
          value={formatNumber(pendingApprovals.length)}
          icon={<ShieldAlert className="h-4 w-4" aria-hidden />}
          tone="warning"
          hint="مراجعة مركز الاعتمادات"
        />
        <KpiCard
          label="شكاوى مفتوحة"
          value={formatNumber(openComplaints.length)}
          icon={<FileWarning className="h-4 w-4" aria-hidden />}
          tone="danger"
        />
        <KpiCard
          label="إجمالي الإيرادات المعتمدة"
          value={formatEgp(totalApprovedRevenue)}
          icon={<Receipt className="h-4 w-4" aria-hidden />}
          tone="success"
        />
        <KpiCard
          label="الربح التقريبي المعتمد"
          value={formatEgp(totalApprovedProfit)}
          icon={<TrendingUp className="h-4 w-4" aria-hidden />}
          tone="accent"
          hint="تقديري — راجع قيود التكاليف المفقودة قبل اتخاذ قرار"
        />
        <KpiCard
          label="هامش الربح التقريبي"
          value={`${formatNumber(profitMarginPct, 2)}%`}
          icon={<TrendingUp className="h-4 w-4" aria-hidden />}
          tone="info"
          isolateValue
        />
        <KpiCard
          label="تنبيهات سلبية"
          value="0"
          icon={<AlertTriangle className="h-4 w-4" aria-hidden />}
          tone="success"
          hint="لا توجد أصناف برصيد سالب في العرض"
        />
      </section>

      {/* Stock by location type + balances */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>توزيع المخزون حسب نوع الموقع</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={stockByLocationType}
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
                    fill="rgb(var(--color-chart-2))"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              <ShieldAlert className="me-1 inline h-3 w-3" aria-hidden />
              لا تعتمد على الرسم وحده — راجع{" "}
              <Link to="/management/inventory/balances" className="text-accent hover:underline">
                أرصدة المخزون
              </Link>
              .
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>أرصدة الأطراف</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                أرصدة العملاء
              </p>
              <ul className="space-y-1 text-sm">
                {customerBalances.map((c) => (
                  <li key={c.code} className="flex items-center justify-between gap-2">
                    <span dir="rtl">{c.nameAr}</span>
                    <BidiValue numeric>{formatEgp(c.balanceEgp)}</BidiValue>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                أرصدة المصانع
              </p>
              <ul className="space-y-1 text-sm">
                {factoryBalances.map((f) => (
                  <li key={f.code} className="flex items-center justify-between gap-2">
                    <span dir="rtl">{f.nameAr}</span>
                    <BidiValue numeric>{formatEgp(f.balanceEgp)}</BidiValue>
                  </li>
                ))}
              </ul>
            </div>
            <div className="border-t border-border pt-2">
              <Link
                to="/management/payments"
                className="inline-flex items-center gap-1 text-sm text-accent hover:underline"
              >
                <Wallet className="h-4 w-4" aria-hidden />
                إدارة المدفوعات والأرصدة
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent activity + pending approvals */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>آخر العمليات المهمة</CardTitle>
          </CardHeader>
          <CardContent>
            <Timeline events={recentActivity} emptyMessage="لا توجد عمليات حديثة." />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>اعتمادات بانتظار قرار المالك</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingApprovals.length === 0 ? (
              <p className="text-sm text-muted-foreground">لا توجد اعتمادات معلّقة.</p>
            ) : (
              pendingApprovals.slice(0, 5).map((a) => (
                <div
                  key={a.id}
                  className="flex items-start justify-between gap-3 rounded-md border border-border p-3"
                >
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground" dir="rtl">
                      {a.titleAr}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <BidiValue size="xs">{a.reference}</BidiValue>
                      <span>—</span>
                      <span dir="rtl">{a.submittedByAr}</span>
                      <ApprovalStatusBadge status={a.status} />
                    </div>
                  </div>
                </div>
              ))
            )}
            <div className="border-t border-border pt-2">
              <Link to="/management/approvals" className="text-sm text-accent hover:underline">
                فتح مركز الاعتمادات الكامل
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Traceability entry */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-3">
            <PackageCheck className="h-5 w-5 text-primary" aria-hidden />
            <p className="text-sm text-foreground" dir="rtl">
              تتبّع سلسلة الدفعة/اللوت من الرسالة الخام حتى البيع/المرتجع.
            </p>
          </div>
          <Link
            to="/traceability"
            className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            فتح شاشة التتبّع
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

function categoryLabel(cat: string): string {
  switch (cat) {
    case "warehouse":
      return "مخزن";
    case "production":
      return "إنتاج";
    case "quality":
      return "جودة";
    case "sales":
      return "مبيعات";
    case "payment":
      return "مدفوعات";
    case "approval":
      return "اعتمادات";
    case "migration":
      return "ترحيل";
    default:
      return cat;
  }
}
