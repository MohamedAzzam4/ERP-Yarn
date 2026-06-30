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
const SEVERITY_STYLES: Record<string, { dot: string; bar: string; text: string }> = {
  high: { dot: "bg-danger", bar: "bg-danger/70", text: "text-danger" },
  medium: { dot: "bg-warning", bar: "bg-warning/70", text: "text-warning" },
  low: { dot: "bg-info", bar: "bg-info/70", text: "text-info" },
};

function parseNumeric(value: string): number {
  const m = value.match(/[\d,.]+/);
  return m ? parseFloat(m[0].replace(/,/g, "")) : 0;
}

// --- SVG donut chart ---
function DonutChart({ segments }: { segments: ReadonlyArray<{ value: number; color: string; label: string }> }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
  const radius = 60;
  const circ = 2 * Math.PI * radius;
  // Pre-compute offsets for each segment (pure, no mutation)
  const segmentData = segments.reduce<{ len: number; offset: number; color: string; label: string; value: number }[]>(
    (acc, seg) => {
      const len = (seg.value / total) * circ;
      const offset = acc.length > 0 ? acc[acc.length - 1]!.offset + acc[acc.length - 1]!.len : 0;
      return [...acc, { ...seg, len, offset }];
    },
    [],
  );

  return (
    <div className="flex items-center gap-4">
      <svg width="140" height="140" viewBox="0 0 140 140" className="shrink-0" role="img" aria-label="توزيع المخزون">
        <circle cx="70" cy="70" r={radius} fill="none" stroke="var(--color-muted)" strokeWidth="18" />
        {segmentData.map((seg, i) => (
          <circle
            key={i}
            cx="70"
            cy="70"
            r={radius}
            fill="none"
            stroke={seg.color}
            strokeWidth="18"
            strokeDasharray={`${seg.len} ${circ - seg.len}`}
            strokeDashoffset={-seg.offset}
            transform="rotate(-90 70 70)"
            strokeLinecap="round"
          />
        ))}
        <text x="70" y="65" textAnchor="middle" className="fill-foreground text-xs font-bold">
          {total.toLocaleString("en-US", { maximumFractionDigits: 0 })}
        </text>
        <text x="70" y="80" textAnchor="middle" className="fill-muted-foreground text-[8px]">
          كجم
        </text>
      </svg>
      <div className="space-y-2">
        {segmentData.map((seg, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: seg.color }} />
            <span className="text-muted-foreground">{seg.label}</span>
            <span className="font-medium text-foreground" dir="ltr">{seg.value.toLocaleString("en-US", { minimumFractionDigits: 3 })}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- SVG mini trend line ---
function MiniTrendLine({ values, maxVal }: { values: number[]; maxVal: number }) {
  const w = 200, h = 60;
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => `${i * step},${h - (v / maxVal) * (h - 10) - 5}`);
  const pathD = `M ${pts.join(" L ")}`;
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
  const f = OWNER_DASHBOARD_FIXTURE;

  // Donut segments from inventoryComposition
  const donutSegments = f.inventoryComposition.map((c) => ({
    value: parseNumeric(c.valueKg),
    color: c.color,
    label: c.labelAr,
  }));

  // Attention ranking max for bar width
  const maxAttention = Math.max(...f.attentionItems.map((a) => a.count), 1);

  return (
    <Container size="xl" className="py-6">
      {/* Title — visible glass accent (DEC-076: management surface) */}
      <div className="mb-6 rounded-2xl border border-primary/10 bg-gradient-to-l from-primary/8 via-primary/3 to-transparent p-5 backdrop-blur-md shadow-sm">
        <h1 className="text-heading-2 text-foreground mb-1">{f.screenTitle}</h1>
        <p className="text-sm text-muted-foreground">نظرة عامة سريعة على أداء النظام</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 mb-6 sm:grid-cols-2 lg:grid-cols-4">
        {f.kpiCards.map((card) => (
          <Card
            key={card.labelAr}
            className="group relative overflow-hidden border-border transition-all duration-200 hover:border-primary/30 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            role="link"
            aria-label={`${card.labelAr}: ${card.value}`}
            tabIndex={0}
          >
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
                  <span className="rounded bg-primary/5 px-1.5 py-0.5 text-[10px] font-medium text-primary/60">مالي</span>
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

      {/* Insight Widgets Row — glass-accented section (DEC-076: management surface) */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Widget A: Inventory Composition Donut */}
        <Card className="border-primary/10 bg-surface/80 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-heading-4">توزيع المخزون</CardTitle>
          </CardHeader>
          <CardContent>
            <DonutChart segments={donutSegments} />
          </CardContent>
        </Card>

        {/* Widget B: Attention Ranking */}
        <Card className="border-primary/10 bg-surface/80 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-heading-4">أهم البنود التي تحتاج انتباه</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {f.attentionItems.map((item, idx) => {
                const sev = SEVERITY_STYLES[item.severity]!;
                const widthPct = (item.count / maxAttention) * 100;
                return (
                  <div key={idx} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-1.5 text-foreground">
                        <span className={`inline-block h-2 w-2 rounded-full ${sev.dot}`} />
                        {item.labelAr}
                      </span>
                      <span className={`font-bold ${sev.text}`} dir="ltr">{item.count}</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div className={`h-full rounded-full ${sev.bar} transition-all duration-300`} style={{ width: `${widthPct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Widget C: External Factory Balances */}
        <Card className="border-primary/10 bg-surface/80 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-heading-4">أرصدة مصانع التشغيل</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {f.factoryBalances.map((fac, idx) => (
                <div key={idx} className="flex items-center justify-between rounded-lg border border-border p-2.5 transition-colors hover:bg-muted/20">
                  <div>
                    <p className="text-sm font-medium text-foreground">{fac.factoryNameAr}</p>
                    <p className="text-xs text-muted-foreground">
                      مخزون: <LtrValue>{fac.stockKg} كجم</LtrValue>
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">مستحقات</p>
                    <p className="text-sm font-bold text-foreground">
                      <LtrValue>{fac.payableEgp} جنيه</LtrValue>
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Original Charts Row */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Chart 1: Inventory by location */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-heading-4">{f.charts[0]!.titleAr}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3" role="img" aria-label={f.charts[0]!.titleAr}>
              {(() => {
                const data = f.charts[0]!.dataPoints;
                const maxVal = Math.max(...data.map((d) => parseNumeric(d.value)));
                return data.map((point, idx) => {
                  const widthPct = maxVal > 0 ? (parseNumeric(point.value) / maxVal) * 100 : 0;
                  return (
                    <div key={point.label} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <span className={`inline-block h-2 w-2 rounded-full ${BAR_COLORS[idx % BAR_COLORS.length]}`} />
                          {point.label}
                        </span>
                        <span className="font-medium text-foreground"><LtrValue>{point.value}</LtrValue></span>
                      </div>
                      <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                        <div className={`h-full rounded-full ${BAR_COLORS[idx % BAR_COLORS.length]} transition-all duration-300`} style={{ width: `${widthPct}%` }} />
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </CardContent>
        </Card>

        {/* Chart 2: Review trend */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-heading-4">{f.charts[1]!.titleAr}</CardTitle>
          </CardHeader>
          <CardContent>
            <div role="img" aria-label={f.charts[1]!.titleAr}>
              {(() => {
                const data = f.charts[1]!.dataPoints;
                const values = data.map((d) => parseNumeric(d.value));
                const maxVal = Math.max(...values);
                return (
                  <>
                    <div className="mb-3"><MiniTrendLine values={values} maxVal={maxVal} /></div>
                    <div className="flex justify-between gap-1">
                      {data.map((point) => (
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

        {/* Chart 3: Complaints stacked bar */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-heading-4">{f.charts[2]!.titleAr}</CardTitle>
          </CardHeader>
          <CardContent>
            <div role="img" aria-label={f.charts[2]!.titleAr}>
              {(() => {
                const data = f.charts[2]!.dataPoints;
                const total = data.reduce((sum, d) => sum + parseNumeric(d.value), 0);
                return (
                  <>
                    <div className="mb-4 flex h-8 w-full overflow-hidden rounded-lg">
                      {data.map((point, idx) => {
                        const pct = total > 0 ? (parseNumeric(point.value) / total) * 100 : 0;
                        return (
                          <div key={point.label} className={`${BAR_COLORS[idx % BAR_COLORS.length]} flex items-center justify-center text-xs font-bold text-white transition-all duration-300`} style={{ width: `${pct}%` }}>
                            {pct > 10 ? point.value : ""}
                          </div>
                        );
                      })}
                    </div>
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
            {f.recentActivity.map((activity) => (
              <div key={activity.document} className="flex items-center gap-3 rounded-lg border border-border p-3 transition-all duration-200 hover:border-primary/20 hover:bg-muted/30">
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
