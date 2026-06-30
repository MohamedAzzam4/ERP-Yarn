/**
 * WP-01-07 Owner Dashboard Reference Screen.
 *
 * Contract: docs/contracts/10_frontend_screen_contracts.md §6.1
 * Contract: docs/design/01_reference_screen_terms_and_fixtures.md §7
 * DEC-076: Restrained glass accents on management surfaces only.
 *
 * Fixture: reference-fixtures-v1
 * Route: /management/dashboard
 */
import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LtrValue } from "@/components/ui/ltr-value";
import { OWNER_DASHBOARD_FIXTURE } from "@/lib/fixtures/reference-fixtures";

const BAR_COLORS = ["bg-primary", "bg-accent", "bg-warning", "bg-info", "bg-success"];

function parseNumericValue(value: string): number {
  const match = value.match(/[\d,.]+/);
  if (!match) return 0;
  return parseFloat(match[0].replace(/,/g, ""));
}

// --- SVG mini trend line for review trend chart ---
function MiniTrendLine({ values, maxVal }: { values: number[]; maxVal: number }) {
  const w = 200;
  const h = 60;
  const step = w / (values.length - 1);
  const points = values.map((v, i) => {
    const x = i * step;
    const y = h - (v / maxVal) * (h - 10) - 5;
    return `${x},${y}`;
  });
  const pathD = `M ${points.join(" L ")}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.15" />
          <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${pathD} L ${w},${h} L 0,${h} Z`} fill="url(#trendGrad)" />
      <path d={pathD} fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {values.map((v, i) => (
        <circle key={i} cx={i * step} cy={h - (v / maxVal) * (h - 10) - 5} r="3" fill="var(--color-primary)" />
      ))}
    </svg>
  );
}

export function OwnerDashboardReference() {
  const fixture = OWNER_DASHBOARD_FIXTURE;

  return (
    <Container size="xl" className="py-6">
      {/* Title with subtle gradient accent (DEC-076: management surface) */}
      <div className="mb-6 rounded-xl border border-border bg-gradient-to-l from-primary/5 to-transparent p-4 backdrop-blur-sm">
        <h1 className="text-heading-2 text-foreground mb-1">{fixture.screenTitle}</h1>
        <p className="text-sm text-muted-foreground">نظرة عامة سريعة على أداء النظام</p>
      </div>

      {/* KPI Cards with richer styling */}
      <div className="grid grid-cols-1 gap-4 mb-6 sm:grid-cols-2 lg:grid-cols-4">
        {fixture.kpiCards.map((card) => (
          <Card
            key={card.labelAr}
            className="group relative overflow-hidden border-border transition-all duration-200 hover:border-primary/30 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            role="link"
            aria-label={`${card.labelAr}: ${card.value}`}
            tabIndex={0}
          >
            {/* Subtle top accent strip */}
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-l from-primary/20 to-transparent" />
            <CardContent className="p-4 pt-5">
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
        {/* Chart 1: Inventory by location — horizontal bars with legend */}
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
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <span className={`inline-block h-2 w-2 rounded-full ${BAR_COLORS[idx % BAR_COLORS.length]}`} />
                          {point.label}
                        </span>
                        <span className="font-medium text-foreground">
                          <LtrValue>{point.value}</LtrValue>
                        </span>
                      </div>
                      <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
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

        {/* Chart 2: Review trend — SVG trend line + bar overlay */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-heading-4">{fixture.charts[1]!.titleAr}</CardTitle>
          </CardHeader>
          <CardContent>
            <div role="img" aria-label={fixture.charts[1]!.titleAr}>
              {(() => {
                const data = fixture.charts[1]!.dataPoints;
                const values = data.map((d) => parseNumericValue(d.value));
                const maxVal = Math.max(...values);
                return (
                  <>
                    {/* SVG trend line */}
                    <div className="mb-3">
                      <MiniTrendLine values={values} maxVal={maxVal} />
                    </div>
                    {/* Bar labels */}
                    <div className="flex justify-between gap-1">
                      {data.map((point, idx) => (
                        <div key={point.label} className="flex flex-col items-center gap-0.5">
                          <span className="text-xs font-bold text-foreground" dir="ltr">{point.value}</span>
                          <span className="text-xs text-muted-foreground" dir="ltr">{point.label}</span>
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}
            </div>
          </CardContent>
        </Card>

        {/* Chart 3: Complaints — donut-style segmented bar with legend */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-heading-4">{fixture.charts[2]!.titleAr}</CardTitle>
          </CardHeader>
          <CardContent>
            <div role="img" aria-label={fixture.charts[2]!.titleAr}>
              {(() => {
                const data = fixture.charts[2]!.dataPoints;
                const total = data.reduce((sum, d) => sum + parseNumericValue(d.value), 0);
                return (
                  <>
                    {/* Stacked horizontal bar */}
                    <div className="mb-4 flex h-8 w-full overflow-hidden rounded-lg">
                      {data.map((point, idx) => {
                        const pct = total > 0 ? (parseNumericValue(point.value) / total) * 100 : 0;
                        return (
                          <div
                            key={point.label}
                            className={`${BAR_COLORS[idx % BAR_COLORS.length]} flex items-center justify-center text-xs font-bold text-white transition-all duration-300`}
                            style={{ width: `${pct}%` }}
                          >
                            {pct > 10 ? point.value : ""}
                          </div>
                        );
                      })}
                    </div>
                    {/* Legend */}
                    <div className="space-y-2">
                      {data.map((point, idx) => (
                        <div key={point.label} className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-1.5 text-muted-foreground">
                            <span className={`inline-block h-2 w-2 rounded-full ${BAR_COLORS[idx % BAR_COLORS.length]}`} />
                            {point.label}
                          </span>
                          <span className="font-medium text-foreground" dir="ltr">{point.value}</span>
                        </div>
                      ))}
                    </div>
                  </>
                );
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
                className="flex items-center gap-3 rounded-lg border border-border p-3 transition-all duration-200 hover:border-primary/20 hover:bg-muted/30"
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
