/**
 * Demo Owner Dashboard — stakeholder visual demo.
 *
 * Route: /demo/owner/dashboard
 *
 * Mirrors the approved OwnerDashboardReference screen (DEC-075 / DEC-076)
 * but with clickable KPI cards that route to related demo pages, and the
 * demo chrome (DemoShell with working global search + persistent banner).
 *
 * Revised 2026-07-05:
 *   - Inventory composition now shows 3 layers: خامات / شعيرات / خيوط
 *   - Added yarn KPI strip (رصيد الخيوط، إجمالي المنتج، عدد الشكاير)
 *   - Added yarn balance by company bar chart
 *   - Added yarn distribution by count donut
 *   - Added "بنود تحتاج مراجعة فنية" ranking
 *   - Renamed "اتجاه المراجعات" → "اتجاه طلبات الاعتماد والمتابعة"
 *   - Updated userName from "مالك النظام" → "رئيس مجلس الإدارة / العضو المنتدب التنفيذي"
 *
 * All data is synthetic. No Supabase. No real transaction logic.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LtrValue } from "@/components/ui/ltr-value";
import { cn } from "@/lib/cn";
import { DemoShell } from "@/components/demo/demo-shell";
import {
  DemoDonutChart,
  DemoAttentionRanking,
  DemoFactoryBalances,
  DemoLocationBars,
  DemoReviewTrendChart,
  DemoStackedBar,
  DemoKpiCard,
  DemoPageHeader,
  DemoFooterNote,
} from "@/components/demo/demo-charts";
import {
  DEMO_OWNER_KPI_CARDS,
  DEMO_DASHBOARD_INVENTORY_COMPOSITION,
  DEMO_DASHBOARD_ATTENTION_ITEMS,
  DEMO_DASHBOARD_FACTORY_BALANCES,
  DEMO_DASHBOARD_INVENTORY_BY_LOCATION,
  DEMO_DASHBOARD_APPROVAL_TREND,
  DEMO_DASHBOARD_COMPLAINTS,
  DEMO_ACTIVITY_STRIPS,
  DEMO_YARN_KPIS,
  DEMO_YARN_BY_COMPANY,
  DEMO_YARN_BY_COUNT,
  DEMO_YARN_STOCK,
  DEMO_CHART_COLORS,
} from "@/lib/fixtures/demo-fixtures";

function parseNumeric(value: string): number {
  const m = value.match(/-?[\d,.]+/);
  return m ? parseFloat(m[0].replace(/,/g, "")) : 0;
}

export default function DemoOwnerDashboardPage() {
  const donutSegments = DEMO_DASHBOARD_INVENTORY_COMPOSITION.map((c) => ({
    value: parseNumeric(c.valueKg),
    color: c.color,
    label: c.labelAr,
  }));
  const maxAttention = Math.max(...DEMO_DASHBOARD_ATTENTION_ITEMS.map((a) => a.count), 1);

  // Yarn distribution by company — bar chart data
  const yarnByCompanyBars = DEMO_YARN_BY_COMPANY.map((c) => ({
    label: c.companyAr,
    value: c.currentBalanceKg + " كجم",
  }));

  // Yarn distribution by count — donut segments.
  // Uses DEMO_CHART_COLORS to guarantee distinct colors per segment.
  const yarnByCountSegments = DEMO_YARN_BY_COUNT.map((c, i) => ({
    value: parseNumeric(c.currentBalanceKg),
    color: [DEMO_CHART_COLORS.blue, DEMO_CHART_COLORS.amber, DEMO_CHART_COLORS.cyan][i % 3]!,
    label: "نمرة " + c.yarnCount,
  }));

  // Items needing technical review — derived from yarn stock rows + a few generic items
  const technicalReviewItems = [
    ...DEMO_YARN_STOCK.filter((r) => r.needsTechnicalReview).map((r) => ({
      labelAr: `خيط نمرة ${r.yarnCount} — أمر ${r.orderNumber} (${r.companyAr})`,
      count: 1,
      severity: "high" as const,
    })),
    ...DEMO_DASHBOARD_ATTENTION_ITEMS.slice(0, 2).map((a) => ({
      labelAr: a.labelAr,
      count: a.count,
      severity: a.severity,
    })),
  ];
  const maxTechnicalReview = Math.max(...technicalReviewItems.map((a) => a.count), 1);

  return (
    <DemoShell
      userName="رئيس مجلس الإدارة / العضو المنتدب التنفيذي"
      breadcrumbs={[{ label: "لوحة المعلومات" }, { label: "لوحة التحكم" }]}
    >
      <DemoPageHeader
        titleAr="لوحة التحكم"
        subtitleAr="نظرة عامة سريعة على أداء النظام — اضغط على أي بطاقة KPI للانتقال إلى التفاصيل"
      />

      {/* KPI grid — clickable cards */}
      <div className="grid grid-cols-1 gap-4 mb-6 sm:grid-cols-2 lg:grid-cols-4">
        {DEMO_OWNER_KPI_CARDS.map((kpi) => (
          <DemoKpiCard
            key={kpi.labelAr}
            labelAr={kpi.labelAr}
            value={kpi.value}
            accent={kpi.accent}
            chipText={kpi.chipText}
            href={kpi.href}
            isApproximate={kpi.isApproximate}
          />
        ))}
      </div>

      {/* Yarn KPI strip — رصيد الخيوط، إجمالي المنتج، عدد الشكاير، الشركات، بنود تحتاج مراجعة فنية */}
      <Card className="mb-6 border-primary/15 bg-surface/80 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-heading-4 text-foreground flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-success" aria-hidden="true" />
            أرصدة الخيوط بالمخازن — نظرة سريعة
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <div className="rounded-lg border border-border bg-surface p-3">
              <p className="text-xs text-muted-foreground mb-1">رصيد الخيوط الحالي</p>
              <p className="text-xl font-bold text-foreground tabular-nums">
                <LtrValue>{DEMO_YARN_KPIS.totalCurrentBalanceKg}</LtrValue>
                <span className="mr-1 text-xs text-muted-foreground">كجم</span>
              </p>
            </div>
            <div className="rounded-lg border border-border bg-surface p-3">
              <p className="text-xs text-muted-foreground mb-1">إجمالي المنتج من الخيوط</p>
              <p className="text-xl font-bold text-foreground tabular-nums">
                <LtrValue>{DEMO_YARN_KPIS.totalProducedKg}</LtrValue>
                <span className="mr-1 text-xs text-muted-foreground">كجم</span>
              </p>
            </div>
            <div className="rounded-lg border border-border bg-surface p-3">
              <p className="text-xs text-muted-foreground mb-1">عدد الشكاير</p>
              <p className="text-xl font-bold text-foreground tabular-nums">
                <LtrValue>{DEMO_YARN_KPIS.totalBales}</LtrValue>
                <span className="mr-1 text-xs text-muted-foreground">شيكارة</span>
              </p>
            </div>
            <div className="rounded-lg border border-border bg-surface p-3">
              <p className="text-xs text-muted-foreground mb-1">عدد الشركات</p>
              <p className="text-xl font-bold text-foreground tabular-nums">
                <LtrValue>{DEMO_YARN_KPIS.companiesCount}</LtrValue>
                <span className="mr-1 text-xs text-muted-foreground">شركة</span>
              </p>
            </div>
            <div className="rounded-lg border border-warning/30 bg-warning/5 p-3">
              <p className="text-xs text-muted-foreground mb-1">بنود تحتاج مراجعة فنية</p>
              <p className="text-xl font-bold text-warning tabular-nums">
                <LtrValue>{DEMO_YARN_KPIS.itemsNeedingTechnicalReview}</LtrValue>
                <span className="mr-1 text-xs text-muted-foreground">بند</span>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Insight widgets row — glass-accented management surfaces (DEC-076) */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="border-primary/15 bg-surface/80 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-heading-4 text-foreground">توزيع المخزون</CardTitle>
          </CardHeader>
          <CardContent>
            <DemoDonutChart segments={donutSegments} />
          </CardContent>
        </Card>

        <Card className="border-primary/15 bg-surface/80 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-heading-4 text-foreground">أهم البنود التي تحتاج انتباه</CardTitle>
          </CardHeader>
          <CardContent>
            <DemoAttentionRanking items={DEMO_DASHBOARD_ATTENTION_ITEMS} maxAttention={maxAttention} />
          </CardContent>
        </Card>

        <Card className="border-primary/15 bg-surface/80 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-heading-4 text-foreground">أرصدة مصانع التشغيل</CardTitle>
          </CardHeader>
          <CardContent>
            <DemoFactoryBalances balances={DEMO_DASHBOARD_FACTORY_BALANCES} />
          </CardContent>
        </Card>
      </div>

      {/* Yarn-specific charts row — yarn by company + yarn by count + items needing technical review */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-heading-4 text-foreground">توزيع الخيوط حسب الشركة</CardTitle>
          </CardHeader>
          <CardContent>
            <DemoLocationBars data={yarnByCompanyBars} />
          </CardContent>
        </Card>

        <Card className="border-primary/15 bg-surface/80 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-heading-4 text-foreground">توزيع الخيوط حسب النمرة</CardTitle>
          </CardHeader>
          <CardContent>
            <DemoDonutChart segments={yarnByCountSegments} totalLabelAr="كجم" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-heading-4 text-foreground">بنود تحتاج مراجعة فنية</CardTitle>
          </CardHeader>
          <CardContent>
            <DemoAttentionRanking
              items={technicalReviewItems}
              maxAttention={maxTechnicalReview}
            />
          </CardContent>
        </Card>
      </div>

      {/* Charts row */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-heading-4 text-foreground">المخزون حسب الموقع</CardTitle>
          </CardHeader>
          <CardContent>
            <DemoLocationBars data={DEMO_DASHBOARD_INVENTORY_BY_LOCATION} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            {/* Renamed 2026-07-05: was "اتجاه المراجعات" → "اتجاه طلبات الاعتماد والمتابعة" */}
            <CardTitle className="text-heading-4 text-foreground">اتجاه طلبات الاعتماد والمتابعة</CardTitle>
          </CardHeader>
          <CardContent>
            <DemoReviewTrendChart data={DEMO_DASHBOARD_APPROVAL_TREND} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-heading-4 text-foreground">الشكاوى حسب الحالة</CardTitle>
          </CardHeader>
          <CardContent>
            <DemoStackedBar data={DEMO_DASHBOARD_COMPLAINTS} />
          </CardContent>
        </Card>
      </div>

      {/* Latest activity timeline — clickable rows */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-heading-4 text-foreground">آخر النشاطات</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {DEMO_ACTIVITY_STRIPS.slice(0, 5).map((act) => (
              <div
                key={act.id}
                className={cn(
                  "flex flex-wrap items-center gap-3 rounded-lg border border-border p-3 transition-all duration-200 hover:border-primary/30 hover:bg-primary/5",
                )}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-primary"
                    aria-hidden="true"
                  >
                    <polyline points="9 11 12 14 22 4" />
                    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                  </svg>
                </div>
                <LtrValue className="font-medium text-foreground">{act.document}</LtrValue>
                <span className="text-sm text-muted-foreground">{act.summaryAr}</span>
                <span className="mr-auto text-xs text-muted-foreground" dir="ltr">
                  <LtrValue>{act.date}</LtrValue>
                  {" · "}
                  <LtrValue>{act.timeAr}</LtrValue>
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <DemoFooterNote />
    </DemoShell>
  );
}
