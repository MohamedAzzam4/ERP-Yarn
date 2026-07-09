/**
 * Demo Sales Overview — stakeholder visual demo.
 *
 * Route: /demo/owner/sales
 *
 * Shows:
 *   - Sales orders table with reservation status
 *   - Customer balances summary
 *   - Simple charts: monthly sales trend + reservation status distribution
 *
 * All data is synthetic (DEMO_SALES_ORDERS, DEMO_CUSTOMER_BALANCES).
 * No Supabase. No real transaction logic.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LtrValue } from "@/components/ui/ltr-value";
import { cn } from "@/lib/cn";
import { DemoShell } from "@/components/demo/demo-shell";
import {
  DemoMiniTrendLine,
  DemoStackedBar,
  DemoCompactHeading,
  DemoFooterNote,
} from "@/components/demo/demo-charts";
import {
  DEMO_SALES_ORDERS,
  DEMO_CUSTOMER_BALANCES,
} from "@/lib/fixtures/demo-fixtures";

function parseNumeric(value: string): number {
  const m = value.match(/-?[\d,.]+/);
  return m ? parseFloat(m[0].replace(/,/g, "")) : 0;
}

const RESERVATION_CHIP: Record<string, string> = {
  "محجوز بالكامل": "bg-success/10 text-success border-success/20",
  "محجوز جزئياً": "bg-warning/10 text-warning border-warning/20",
  "بانتظار التحقق": "bg-info/10 text-info border-info/20",
};

const STATE_CHIP: Record<string, string> = {
  "معتمد": "bg-success/10 text-success border-success/20",
  "مرسل للمراجعة": "bg-info/10 text-info border-info/20",
};

// Synthetic monthly sales trend (last 6 months)
const SALES_TREND = [
  { label: "يناير", value: "210,000" },
  { label: "فبراير", value: "245,000" },
  { label: "مارس", value: "198,000" },
  { label: "أبريل", value: "287,000" },
  { label: "مايو", value: "262,000" },
  { label: "يونيو", value: "320,000" },
];

const RESERVATION_DISTRIBUTION = [
  { label: "محجوز بالكامل", value: String(DEMO_SALES_ORDERS.filter((o) => o.reservationStatusAr === "محجوز بالكامل").length) },
  { label: "محجوز جزئياً", value: String(DEMO_SALES_ORDERS.filter((o) => o.reservationStatusAr === "محجوز جزئياً").length) },
  { label: "بانتظار التحقق", value: String(DEMO_SALES_ORDERS.filter((o) => o.reservationStatusAr === "بانتظار التحقق").length) },
];

export default function DemoSalesPage() {
  const totalMonthSales = DEMO_SALES_ORDERS.reduce((s, o) => s + parseNumeric(o.amountEgp), 0);
  const totalOutstanding = DEMO_CUSTOMER_BALANCES.reduce((s, c) => s + parseNumeric(c.outstandingEgp), 0);
  const totalPaid = DEMO_CUSTOMER_BALANCES.reduce((s, c) => s + parseNumeric(c.paidEgp), 0);

  const trendValues = SALES_TREND.map((d) => parseNumeric(d.value));
  const trendMax = Math.max(...trendValues);

  return (
    <DemoShell
    >
      <DemoCompactHeading
        titleAr="نظرة عامة على المبيعات"
        subtitleAr="أوامر البيع، حالة الحجز، أرصدة العملاء، اتجاه المبيعات"
      />

      {/* KPI strip */}
      <div className="grid grid-cols-1 gap-4 mb-6 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="relative overflow-hidden border-border bg-surface">
          <div className="pointer-events-none absolute right-0 top-5 bottom-5 w-[3px] rounded-full bg-success" aria-hidden="true" />
          <CardContent className="relative p-4">
            <p className="text-xs font-medium text-muted-foreground mb-1.5">مبيعات الشهر الحالي</p>
            <p className="text-2xl font-bold text-foreground tabular-nums">
              <LtrValue>{totalMonthSales.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} جنيه</LtrValue>
            </p>
            <span className="mt-2 inline-block rounded-md bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-success">مالي</span>
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden border-border bg-surface">
          <div className="pointer-events-none absolute right-0 top-5 bottom-5 w-[3px] rounded-full bg-primary" aria-hidden="true" />
          <CardContent className="relative p-4">
            <p className="text-xs font-medium text-muted-foreground mb-1.5">عدد أوامر البيع</p>
            <p className="text-2xl font-bold text-foreground tabular-nums">
              <LtrValue>{DEMO_SALES_ORDERS.length}</LtrValue>
            </p>
            <span className="mt-2 inline-block rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">مبيعات</span>
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden border-border bg-surface">
          <div className="pointer-events-none absolute right-0 top-5 bottom-5 w-[3px] rounded-full bg-warning" aria-hidden="true" />
          <CardContent className="relative p-4">
            <p className="text-xs font-medium text-muted-foreground mb-1.5">إجمالي المستحقات</p>
            <p className="text-2xl font-bold text-foreground tabular-nums">
              <LtrValue>{totalOutstanding.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} جنيه</LtrValue>
            </p>
            <span className="mt-2 inline-block rounded-md bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">مستحق</span>
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden border-border bg-surface">
          <div className="pointer-events-none absolute right-0 top-5 bottom-5 w-[3px] rounded-full bg-accent" aria-hidden="true" />
          <CardContent className="relative p-4">
            <p className="text-xs font-medium text-muted-foreground mb-1.5">إجمالي المُحصَّل</p>
            <p className="text-2xl font-bold text-foreground tabular-nums">
              <LtrValue>{totalPaid.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} جنيه</LtrValue>
            </p>
            <span className="mt-2 inline-block rounded-md bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">مُحصَّل</span>
          </CardContent>
        </Card>
      </div>

      {/* Charts row */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-heading-4 text-foreground">اتجاه المبيعات (آخر 6 أشهر)</CardTitle>
          </CardHeader>
          <CardContent>
            <div role="img" data-chart="sales-trend">
              <div className="mb-3">
                <DemoMiniTrendLine values={trendValues} maxVal={trendMax} />
              </div>
              <div className="flex justify-between gap-1">
                {SALES_TREND.map((point, idx) => (
                  <div
                    key={point.label}
                    className="flex flex-col items-center gap-0.5 rounded-md px-1.5 py-0.5 transition-all duration-200 hover:bg-primary/10"
                    tabIndex={0}
                    role="button"
                    aria-label={`${point.label}: ${point.value}`}
                  >
                    <span className="text-xs font-bold text-foreground" dir="ltr">{point.value}</span>
                    <span className="text-xs text-muted-foreground">{point.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-heading-4 text-foreground">توزيع حالة الحجز</CardTitle>
          </CardHeader>
          <CardContent>
            <DemoStackedBar data={RESERVATION_DISTRIBUTION} />
          </CardContent>
        </Card>
      </div>

      {/* Sales orders table */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-heading-4 text-foreground">أوامر البيع</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" role="table">
              <thead>
                <tr className="border-b border-border bg-primary/5">
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">الأمر</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">العميل</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">التاريخ</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">الكمية (كجم)</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">القيمة (جنيه)</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">حالة الحجز</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {DEMO_SALES_ORDERS.map((o) => (
                  <tr key={o.order} className="border-b border-border transition-colors duration-150 hover:bg-primary/5">
                    <td className="p-3"><LtrValue className="font-medium text-foreground">{o.order}</LtrValue></td>
                    <td className="p-3 text-foreground">{o.customerNameAr}</td>
                    <td className="p-3"><LtrValue className="text-muted-foreground">{o.date}</LtrValue></td>
                    <td className="p-3"><LtrValue className="text-foreground">{o.quantityKg}</LtrValue></td>
                    <td className="p-3"><LtrValue className="font-bold text-foreground">{o.amountEgp}</LtrValue></td>
                    <td className="p-3">
                      <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium", RESERVATION_CHIP[o.reservationStatusAr] ?? "bg-muted text-foreground border-border")}>
                        <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                        {o.reservationStatusAr}
                      </span>
                    </td>
                    <td className="p-3">
                      <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium", STATE_CHIP[o.stateAr] ?? "bg-muted text-foreground border-border")}>
                        <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                        {o.stateAr}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Customer balances summary */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-heading-4 text-foreground">أرصدة العملاء</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" role="table">
              <thead>
                <tr className="border-b border-border bg-primary/5">
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">الكود</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">العميل</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">إجمالي المبيعات (جنيه)</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">المُحصَّل (جنيه)</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">المستحق (جنيه)</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {DEMO_CUSTOMER_BALANCES.map((c) => (
                  <tr key={c.customerCode} className="border-b border-border transition-colors duration-150 hover:bg-primary/5">
                    <td className="p-3"><LtrValue className="text-muted-foreground">{c.customerCode}</LtrValue></td>
                    <td className="p-3 text-foreground">{c.customerNameAr}</td>
                    <td className="p-3"><LtrValue className="text-foreground">{c.totalSalesEgp}</LtrValue></td>
                    <td className="p-3"><LtrValue className="text-foreground">{c.paidEgp}</LtrValue></td>
                    <td className="p-3">
                      <LtrValue className={cn(parseNumeric(c.outstandingEgp) > 0 ? "font-bold text-warning" : "text-muted-foreground")}>
                        {c.outstandingEgp}
                      </LtrValue>
                    </td>
                    <td className="p-3">
                      <span className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
                        c.statusAr === "مستحق"
                          ? "bg-warning/10 text-warning border-warning/20"
                          : "bg-muted text-muted-foreground border-border",
                      )}>
                        <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                        {c.statusAr}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <DemoFooterNote />
    </DemoShell>
  );
}
