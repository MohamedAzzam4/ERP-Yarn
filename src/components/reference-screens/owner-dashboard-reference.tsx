/**
 * WP-01-07 Owner Dashboard Reference Screen.
 *
 * Contract: docs/contracts/10_frontend_screen_contracts.md §6.1
 * Contract: docs/design/01_reference_screen_terms_and_fixtures.md §7
 *
 * Fixture: reference-fixtures-v1
 * Route: /management/dashboard
 */
import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LtrValue } from "@/components/ui/ltr-value";
import { OWNER_DASHBOARD_FIXTURE } from "@/lib/fixtures/reference-fixtures";

// --- Chart bar color palette (using semantic tokens) ---
const BAR_COLORS = [
  "bg-primary",
  "bg-accent",
  "bg-warning",
  "bg-info",
  "bg-success",
];

// Helper: parse numeric value from fixture string for bar width
function parseNumericValue(value: string): number {
  const match = value.match(/[\d,.]+/);
  if (!match) return 0;
  return parseFloat(match[0].replace(/,/g, ""));
}

export function OwnerDashboardReference() {
  const fixture = OWNER_DASHBOARD_FIXTURE;

  return (
    <Container size="xl" className="py-6">
      {/* Title */}
      <div className="mb-6">
        <h1 className="text-heading-2 text-foreground mb-1">{fixture.screenTitle}</h1>
        <p className="text-sm text-muted-foreground">نظرة عامة سريعة على أداء النظام</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 mb-6 sm:grid-cols-2 lg:grid-cols-4">
        {fixture.kpiCards.map((card) => (
          <Card
            key={card.labelAr}
            className="group cursor-pointer border-border transition-all hover:border-primary/30 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            role="link"
            aria-label={`${card.labelAr}: ${card.value}`}
            tabIndex={0}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">{card.labelAr}</p>
                  <p className="text-2xl font-bold text-foreground">
                    <LtrValue>{card.value}</LtrValue>
                  </p>
                </div>
                {card.isFinancial && (
                  <span className="rounded bg-primary/5 px-1.5 py-0.5 text-[10px] font-medium text-primary/60">
                    مالي
                  </span>
                )}
              </div>
              {card.labelAr === "ربحية تقريبية" && (
                <div className="mt-2 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-warning" />
                  <p className="text-xs text-warning">تقريبي — قد تحتاج مراجعة التكلفة</p>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 mb-6 lg:grid-cols-3">
        {/* Chart 1: Inventory by location — horizontal bar chart */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-heading-4">{fixture.charts[0]!.titleAr}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3" role="img" aria-label={fixture.charts[0]!.titleAr}>
              {(() => {
                const data = fixture.charts[0]!.dataPoints;
                const maxVal = Math.max(...data.map((d) => parseNumericValue(d.value)));
                return data.map((point, idx) => {
                  const widthPct = maxVal > 0 ? (parseNumericValue(point.value) / maxVal) * 100 : 0;
                  return (
                    <div key={point.label} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{point.label}</span>
                        <span className="font-medium text-foreground">
                          <LtrValue>{point.value}</LtrValue>
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full ${BAR_COLORS[idx % BAR_COLORS.length]} transition-all duration-300`}
                          style={{ width: `${widthPct}%` }}
                        />
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </CardContent>
        </Card>

        {/* Chart 2: Review trend — vertical bar chart */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-heading-4">{fixture.charts[1]!.titleAr}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex h-32 items-end justify-between gap-2" role="img" aria-label={fixture.charts[1]!.titleAr}>
              {(() => {
                const data = fixture.charts[1]!.dataPoints;
                const maxVal = Math.max(...data.map((d) => parseNumericValue(d.value)));
                return data.map((point, idx) => {
                  const heightPct = maxVal > 0 ? (parseNumericValue(point.value) / maxVal) * 100 : 0;
                  return (
                    <div key={point.label} className="flex flex-1 flex-col items-center gap-1.5">
                      <span className="text-xs font-medium text-foreground" dir="ltr">{point.value}</span>
                      <div className="flex w-full flex-1 items-end">
                        <div
                          className={`w-full rounded-t-md ${BAR_COLORS[idx % BAR_COLORS.length]} transition-all duration-300`}
                          style={{ height: `${heightPct}%`, minHeight: "4px" }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground" dir="ltr">{point.label}</span>
                    </div>
                  );
                });
              })()}
            </div>
          </CardContent>
        </Card>

        {/* Chart 3: Complaints by status — segmented progress bars */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-heading-4">{fixture.charts[2]!.titleAr}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3" role="img" aria-label={fixture.charts[2]!.titleAr}>
              {(() => {
                const data = fixture.charts[2]!.dataPoints;
                const total = data.reduce((sum, d) => sum + parseNumericValue(d.value), 0);
                return data.map((point, idx) => {
                  const pct = total > 0 ? (parseNumericValue(point.value) / total) * 100 : 0;
                  return (
                    <div key={point.label} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{point.label}</span>
                        <span className="font-medium text-foreground" dir="ltr">{point.value}</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full ${BAR_COLORS[idx % BAR_COLORS.length]} transition-all duration-300`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-heading-4">آخر نشاطاتي</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {fixture.recentActivity.map((activity) => (
              <div
                key={activity.document}
                className="flex items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted/20"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/5">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary/60" aria-hidden="true">
                    <polyline points="9 11 12 14 22 4" />
                    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                  </svg>
                </div>
                <LtrValue className="font-medium text-foreground">{activity.document}</LtrValue>
                <span className="text-sm text-muted-foreground">{activity.summaryAr}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <p className="mt-4 text-xs text-center text-muted-foreground">
        هذه شاشة مرجعية ببيانات تجريبية — لا يتم تنفيذ عمليات فعلية
      </p>
    </Container>
  );
}
