/**
 * WP-01-07 Owner Dashboard Reference Screen.
 *
 * Contract: docs/contracts/10_frontend_screen_contracts.md §6.1
 * Contract: docs/design/01_reference_screen_terms_and_fixtures.md §7
 * DEC-076: Restrained glass accents on management surfaces only.
 * DEC-075: Final visual-interaction polish — Power BI-style chart
 *          hover/focus (highlight selected, de-emphasize others),
 *          blue/navy brand identity, 150–300ms transitions,
 *          prefers-reduced-motion respected via globals.css.
 *
 * Fixture: reference-fixtures-v1
 * Route: /management/dashboard
 *
 * Interaction model (no data changes, no API):
 *   - Each chart is a "client" component using React state for the
 *     hovered/focused index. Hovering or keyboard-focusing a segment
 *     highlights it and dims the others — inspired by Power BI focus mode.
 *   - No layout-shifting scale effects; emphasis is via opacity,
 *     stroke-width, and text weight transitions (150–300ms).
 */
"use client";

import * as React from "react";
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

// Shared transition utility for chart emphasis (150–300ms, reduced-motion safe
// via globals.css `prefers-reduced-motion` override).
const CHART_FOCUS_TRANSITION = "transition-all duration-200 ease-out";

function parseNumeric(value: string): number {
  const m = value.match(/[\d,.]+/);
  return m ? parseFloat(m[0].replace(/,/g, "")) : 0;
}

// ===========================================================================
// DonutChart — Power BI-style focus on hovered/focused segment.
// Each segment and its legend row are interactive (hover + keyboard focus).
// ===========================================================================

type DonutSegment = { value: number; color: string; label: string };

function DonutChart({ segments }: { segments: ReadonlyArray<DonutSegment> }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
  const radius = 60;
  const circ = 2 * Math.PI * radius;

  const segmentData = segments.reduce<
    { len: number; offset: number; color: string; label: string; value: number }[]
  >((acc, seg) => {
    const len = (seg.value / total) * circ;
    const offset = acc.length > 0 ? acc[acc.length - 1]!.offset + acc[acc.length - 1]!.len : 0;
    return [...acc, { ...seg, len, offset }];
  }, []);

  // -1 = nothing focused; otherwise index into segmentData.
  const [active, setActive] = React.useState<number>(-1);
  const isActive = (i: number) => active === i;
  const dimmed = (i: number) => active !== -1 && active !== i;

  const focusSegment = (i: number) => setActive(i);
  const clearFocus = () => setActive(-1);

  return (
    <div className="flex items-center gap-4">
      <svg
        width="140"
        height="140"
        viewBox="0 0 140 140"
        className="shrink-0"
        role="img"
        aria-label="توزيع المخزون"
      >
        <circle cx="70" cy="70" r={radius} fill="none" stroke="var(--color-muted)" strokeWidth="18" />
        {segmentData.map((seg, i) => {
          const isOn = isActive(i);
          const isDim = dimmed(i);
          return (
            <circle
              key={i}
              cx="70"
              cy="70"
              r={radius}
              fill="none"
              stroke={seg.color}
              strokeWidth={isOn ? 22 : 18}
              strokeDasharray={`${seg.len} ${circ - seg.len}`}
              strokeDashoffset={-seg.offset}
              transform="rotate(-90 70 70)"
              strokeLinecap="round"
              className={CHART_FOCUS_TRANSITION}
              style={{
                opacity: isDim ? 0.35 : 1,
                cursor: "pointer",
              }}
              tabIndex={0}
              role="button"
              aria-label={`${seg.label}: ${seg.value.toLocaleString("en-US", { minimumFractionDigits: 3 })} كجم`}
              onMouseEnter={() => focusSegment(i)}
              onMouseLeave={clearFocus}
              onFocus={() => focusSegment(i)}
              onBlur={clearFocus}
            />
          );
        })}
        <text
          x="70"
          y="65"
          textAnchor="middle"
          className="fill-foreground text-xs font-bold"
        >
          {active !== -1
            ? segmentData[active]!.value.toLocaleString("en-US", { maximumFractionDigits: 0 })
            : total.toLocaleString("en-US", { maximumFractionDigits: 0 })}
        </text>
        <text x="70" y="80" textAnchor="middle" className="fill-muted-foreground text-[8px]">
          {active !== -1 ? segmentData[active]!.label.slice(0, 12) : "كجم"}
        </text>
      </svg>
      <div className="space-y-2">
        {segmentData.map((seg, i) => {
          const isOn = isActive(i);
          const isDim = dimmed(i);
          return (
            <div
              key={i}
              className={`flex items-center gap-2 text-sm rounded-md px-1.5 py-0.5 ${CHART_FOCUS_TRANSITION} ${isOn ? "bg-primary/5" : ""}`}
              style={{
                opacity: isDim ? 0.5 : 1,
                cursor: "pointer",
              }}
              tabIndex={0}
              role="button"
              aria-label={`${seg.label}: ${seg.value.toLocaleString("en-US", { minimumFractionDigits: 3 })} كجم`}
              onMouseEnter={() => focusSegment(i)}
              onMouseLeave={clearFocus}
              onFocus={() => focusSegment(i)}
              onBlur={clearFocus}
            >
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: seg.color }}
              />
              <span
                className={`${CHART_FOCUS_TRANSITION} ${isOn ? "font-bold text-foreground" : "text-muted-foreground"}`}
              >
                {seg.label}
              </span>
              <span
                className={`${CHART_FOCUS_TRANSITION} ${isOn ? "font-bold text-primary" : "font-medium text-foreground"}`}
                dir="ltr"
              >
                {seg.value.toLocaleString("en-US", { minimumFractionDigits: 3 })}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ===========================================================================
// MiniTrendLine — SVG line with hoverable points.
// ===========================================================================

function MiniTrendLine({ values, maxVal }: { values: number[]; maxVal: number }) {
  const w = 200,
    h = 60;
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map((v, i) => `${i * step},${h - (v / maxVal) * (h - 10) - 5}`);
  const pathD = `M ${pts.join(" L ")}`;

  const [active, setActive] = React.useState(-1);
  const dimmed = (i: number) => active !== -1 && active !== i;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="w-full"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.15" />
          <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${pathD} L ${w},${h} L 0,${h} Z`} fill="url(#trendGrad)" />
      <path
        d={pathD}
        fill="none"
        stroke="var(--color-primary)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {values.map((v, i) => {
        const isOn = active === i;
        const isDim = dimmed(i);
        return (
          <circle
            key={i}
            cx={i * step}
            cy={h - (v / maxVal) * (h - 10) - 5}
            r={isOn ? 5 : 3}
            fill="var(--color-primary)"
            className={CHART_FOCUS_TRANSITION}
            style={{
              opacity: isDim ? 0.35 : 1,
              cursor: "pointer",
            }}
            tabIndex={0}
            role="button"
            aria-label={`النقطة ${i + 1}: ${v}`}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(-1)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(-1)}
          />
        );
      })}
    </svg>
  );
}

// ===========================================================================
// AttentionRanking — hover/focus highlights one row, dims others.
// ===========================================================================

function AttentionRanking({
  items,
  maxAttention,
}: {
  items: ReadonlyArray<{ labelAr: string; count: number; severity: "high" | "medium" | "low" }>;
  maxAttention: number;
}) {
  const [active, setActive] = React.useState(-1);
  const dimmed = (i: number) => active !== -1 && active !== i;

  return (
    <div className="space-y-3" data-chart="attention-ranking">
      {items.map((item, idx) => {
        const sev = SEVERITY_STYLES[item.severity]!;
        const widthPct = (item.count / maxAttention) * 100;
        const isOn = active === idx;
        const isDim = dimmed(idx);
        return (
          <div
            key={idx}
            className={`space-y-1 rounded-md px-1.5 py-1 ${CHART_FOCUS_TRANSITION} ${isOn ? "bg-primary/5" : ""}`}
            style={{ opacity: isDim ? 0.5 : 1, cursor: "pointer" }}
            tabIndex={0}
            role="button"
            aria-label={`${item.labelAr}: ${item.count}`}
            onMouseEnter={() => setActive(idx)}
            onMouseLeave={() => setActive(-1)}
            onFocus={() => setActive(idx)}
            onBlur={() => setActive(-1)}
          >
            <div className="flex items-center justify-between text-sm">
              <span
                className={`flex items-center gap-1.5 ${CHART_FOCUS_TRANSITION} ${isOn ? "font-bold text-foreground" : "text-foreground"}`}
              >
                <span className={`inline-block h-2 w-2 rounded-full ${sev.dot}`} />
                {item.labelAr}
              </span>
              <span
                className={`font-bold ${CHART_FOCUS_TRANSITION} ${isOn ? "text-primary" : sev.text}`}
                dir="ltr"
              >
                {item.count}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full ${sev.bar} ${CHART_FOCUS_TRANSITION}`}
                style={{ width: `${widthPct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ===========================================================================
// FactoryBalances — hoverable rows with stronger emphasis.
// ===========================================================================

function FactoryBalances({
  balances,
}: {
  balances: ReadonlyArray<{ factoryNameAr: string; stockKg: string; payableEgp: string }>;
}) {
  const [active, setActive] = React.useState(-1);
  const dimmed = (i: number) => active !== -1 && active !== i;
  return (
    <div className="space-y-3" data-chart="factory-balances">
      {balances.map((fac, idx) => {
        const isOn = active === idx;
        const isDim = dimmed(idx);
        return (
          <div
            key={idx}
            className={`flex items-center justify-between rounded-lg border p-2.5 ${CHART_FOCUS_TRANSITION} ${isOn ? "border-primary/40 bg-primary/5" : "border-border"}`}
            style={{ opacity: isDim ? 0.55 : 1, cursor: "pointer" }}
            tabIndex={0}
            role="button"
            aria-label={`${fac.factoryNameAr}: مخزون ${fac.stockKg} كجم، مستحقات ${fac.payableEgp} جنيه`}
            onMouseEnter={() => setActive(idx)}
            onMouseLeave={() => setActive(-1)}
            onFocus={() => setActive(idx)}
            onBlur={() => setActive(-1)}
          >
            <div>
              <p
                className={`text-sm ${CHART_FOCUS_TRANSITION} ${isOn ? "font-bold text-foreground" : "font-medium text-foreground"}`}
              >
                {fac.factoryNameAr}
              </p>
              <p className="text-xs text-muted-foreground">
                مخزون: <LtrValue>{fac.stockKg} كجم</LtrValue>
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">مستحقات</p>
              <p
                className={`text-sm ${CHART_FOCUS_TRANSITION} ${isOn ? "font-bold text-primary" : "font-bold text-foreground"}`}
              >
                <LtrValue>{fac.payableEgp} جنيه</LtrValue>
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ===========================================================================
// LocationBars — CSS bars with hover/focus emphasis.
// ===========================================================================

function LocationBars({
  data,
}: {
  data: ReadonlyArray<{ label: string; value: string }>;
}) {
  const maxVal = Math.max(...data.map((d) => parseNumeric(d.value)));
  const [active, setActive] = React.useState(-1);
  const dimmed = (i: number) => active !== -1 && active !== i;
  return (
    <div className="space-y-3" role="img" data-chart="location-bars">
      {data.map((point, idx) => {
        const widthPct = maxVal > 0 ? (parseNumeric(point.value) / maxVal) * 100 : 0;
        const isOn = active === idx;
        const isDim = dimmed(idx);
        return (
          <div
            key={point.label}
            className={`space-y-1 rounded-md px-1.5 py-0.5 ${CHART_FOCUS_TRANSITION} ${isOn ? "bg-primary/5" : ""}`}
            style={{ opacity: isDim ? 0.5 : 1, cursor: "pointer" }}
            tabIndex={0}
            role="button"
            aria-label={`${point.label}: ${point.value}`}
            onMouseEnter={() => setActive(idx)}
            onMouseLeave={() => setActive(-1)}
            onFocus={() => setActive(idx)}
            onBlur={() => setActive(-1)}
          >
            <div className="flex items-center justify-between text-sm">
              <span
                className={`flex items-center gap-1.5 ${CHART_FOCUS_TRANSITION} ${isOn ? "font-bold text-foreground" : "text-muted-foreground"}`}
              >
                <span
                  className={`inline-block h-2 w-2 rounded-full ${BAR_COLORS[idx % BAR_COLORS.length]}`}
                />
                {point.label}
              </span>
              <span
                className={`${CHART_FOCUS_TRANSITION} ${isOn ? "font-bold text-primary" : "font-medium text-foreground"}`}
              >
                <LtrValue>{point.value}</LtrValue>
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full ${BAR_COLORS[idx % BAR_COLORS.length]} ${CHART_FOCUS_TRANSITION}`}
                style={{ width: `${widthPct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ===========================================================================
// ReviewTrendChart — trend line + hoverable point/value list.
// ===========================================================================

function ReviewTrendChart({
  data,
}: {
  data: ReadonlyArray<{ label: string; value: string }>;
}) {
  const values = data.map((d) => parseNumeric(d.value));
  const maxVal = Math.max(...values);
  const [active, setActive] = React.useState(-1);
  const dimmed = (i: number) => active !== -1 && active !== i;
  return (
    <div role="img" data-chart="review-trend">
      <div className="mb-3">
        <MiniTrendLine values={values} maxVal={maxVal} />
      </div>
      <div className="flex justify-between gap-1">
        {data.map((point, idx) => {
          const isOn = active === idx;
          const isDim = dimmed(idx);
          return (
            <div
              key={point.label}
              className={`flex flex-col items-center gap-0.5 rounded-md px-1.5 py-0.5 ${CHART_FOCUS_TRANSITION} ${isOn ? "bg-primary/10" : ""}`}
              style={{ opacity: isDim ? 0.5 : 1, cursor: "pointer" }}
              tabIndex={0}
              role="button"
              aria-label={`${point.label}: ${point.value}`}
              onMouseEnter={() => setActive(idx)}
              onMouseLeave={() => setActive(-1)}
              onFocus={() => setActive(idx)}
              onBlur={() => setActive(-1)}
            >
              <span
                className={`text-xs ${CHART_FOCUS_TRANSITION} ${isOn ? "font-bold text-primary" : "font-bold text-foreground"}`}
                dir="ltr"
              >
                {point.value}
              </span>
              <span className="text-xs text-muted-foreground" dir="ltr">
                {point.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ===========================================================================
// ComplaintsChart — segmented stacked bar + legend, both hoverable.
// ===========================================================================

function ComplaintsChart({
  data,
}: {
  data: ReadonlyArray<{ label: string; value: string }>;
}) {
  const total = data.reduce((sum, d) => sum + parseNumeric(d.value), 0);
  const [active, setActive] = React.useState(-1);
  const dimmed = (i: number) => active !== -1 && active !== i;
  return (
    <div role="img" data-chart="complaints-stacked">
      <div className="mb-4 flex h-8 w-full overflow-hidden rounded-lg">
        {data.map((point, idx) => {
          const pct = total > 0 ? (parseNumeric(point.value) / total) * 100 : 0;
          const isOn = active === idx;
          const isDim = dimmed(idx);
          return (
            <div
              key={point.label}
              className={`${BAR_COLORS[idx % BAR_COLORS.length]} flex items-center justify-center text-xs font-bold text-white ${CHART_FOCUS_TRANSITION}`}
              style={{ width: `${pct}%`, opacity: isDim ? 0.45 : 1, cursor: "pointer", filter: isOn ? "brightness(1.08)" : "none" }}
              tabIndex={0}
              role="button"
              aria-label={`${point.label}: ${point.value}`}
              onMouseEnter={() => setActive(idx)}
              onMouseLeave={() => setActive(-1)}
              onFocus={() => setActive(idx)}
              onBlur={() => setActive(-1)}
            >
              {pct > 10 ? point.value : ""}
            </div>
          );
        })}
      </div>
      <div className="space-y-2">
        {data.map((point, idx) => {
          const isOn = active === idx;
          const isDim = dimmed(idx);
          return (
            <div
              key={point.label}
              className={`flex items-center justify-between text-sm rounded-md px-1.5 py-0.5 ${CHART_FOCUS_TRANSITION} ${isOn ? "bg-primary/5" : ""}`}
              style={{ opacity: isDim ? 0.5 : 1, cursor: "pointer" }}
              tabIndex={0}
              role="button"
              aria-label={`${point.label}: ${point.value}`}
              onMouseEnter={() => setActive(idx)}
              onMouseLeave={() => setActive(-1)}
              onFocus={() => setActive(idx)}
              onBlur={() => setActive(-1)}
            >
              <span
                className={`flex items-center gap-1.5 ${CHART_FOCUS_TRANSITION} ${isOn ? "font-bold text-foreground" : "text-muted-foreground"}`}
              >
                <span
                  className={`inline-block h-2 w-2 rounded-full ${BAR_COLORS[idx % BAR_COLORS.length]}`}
                />
                {point.label}
              </span>
              <span
                className={`${CHART_FOCUS_TRANSITION} ${isOn ? "font-bold text-primary" : "font-medium text-foreground"}`}
                dir="ltr"
              >
                {point.value}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ===========================================================================
// OwnerDashboardReference — main component.
// ===========================================================================

export function OwnerDashboardReference() {
  const f = OWNER_DASHBOARD_FIXTURE;

  const donutSegments = f.inventoryComposition.map((c) => ({
    value: parseNumeric(c.valueKg),
    color: c.color,
    label: c.labelAr,
  }));

  const maxAttention = Math.max(...f.attentionItems.map((a) => a.count), 1);

  return (
    <Container size="xl" className="py-6">
      {/* Title — stronger blue/navy brand gradient + visible glass accent (DEC-076) */}
      <div className="mb-6 rounded-2xl border border-primary/20 bg-gradient-to-l from-primary/12 via-primary/5 to-transparent p-5 backdrop-blur-md shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <span className="inline-block h-7 w-1.5 rounded-full bg-primary" aria-hidden="true" />
          <h1 className="text-heading-2 text-foreground">{f.screenTitle}</h1>
        </div>
        <p className="text-sm text-muted-foreground">نظرة عامة سريعة على أداء النظام</p>
      </div>

      {/* KPI Cards — branded with blue accent strip + stronger top gradient */}
      <div className="grid grid-cols-1 gap-4 mb-6 sm:grid-cols-2 lg:grid-cols-4">
        {f.kpiCards.map((card) => (
          <Card
            key={card.labelAr}
            className="group relative overflow-hidden border-border bg-surface transition-all duration-200 hover:border-primary/40 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            role="link"
            aria-label={`${card.labelAr}: ${card.value}`}
            tabIndex={0}
          >
            {/* Branded blue top accent — replaces subtle 1px strip */}
            <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-l from-primary via-primary/70 to-transparent" />
            <CardContent className="p-4 pt-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">{card.labelAr}</p>
                  <p className="text-2xl font-bold text-foreground">
                    <LtrValue>{card.value}</LtrValue>
                  </p>
                </div>
                {card.isFinancial && (
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
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

      {/* Insight Widgets Row — blue-tinted glass section (DEC-076: management surface) */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Widget A: Inventory Composition Donut */}
        <Card className="border-primary/15 bg-surface/80 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-heading-4 text-foreground">توزيع المخزون</CardTitle>
          </CardHeader>
          <CardContent>
            <DonutChart segments={donutSegments} />
          </CardContent>
        </Card>

        {/* Widget B: Attention Ranking */}
        <Card className="border-primary/15 bg-surface/80 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-heading-4 text-foreground">
              أهم البنود التي تحتاج انتباه
            </CardTitle>
          </CardHeader>
          <CardContent>
            <AttentionRanking items={f.attentionItems} maxAttention={maxAttention} />
          </CardContent>
        </Card>

        {/* Widget C: External Factory Balances */}
        <Card className="border-primary/15 bg-surface/80 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-heading-4 text-foreground">أرصدة مصانع التشغيل</CardTitle>
          </CardHeader>
          <CardContent>
            <FactoryBalances balances={f.factoryBalances} />
          </CardContent>
        </Card>
      </div>

      {/* Original Charts Row */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Chart 1: Inventory by location */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-heading-4 text-foreground">{f.charts[0]!.titleAr}</CardTitle>
          </CardHeader>
          <CardContent>
            <LocationBars data={f.charts[0]!.dataPoints} />
          </CardContent>
        </Card>

        {/* Chart 2: Review trend */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-heading-4 text-foreground">{f.charts[1]!.titleAr}</CardTitle>
          </CardHeader>
          <CardContent>
            <ReviewTrendChart data={f.charts[1]!.dataPoints} />
          </CardContent>
        </Card>

        {/* Chart 3: Complaints stacked bar */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-heading-4 text-foreground">{f.charts[2]!.titleAr}</CardTitle>
          </CardHeader>
          <CardContent>
            <ComplaintsChart data={f.charts[2]!.dataPoints} />
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-heading-4 text-foreground">آخر نشاطاتي</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {f.recentActivity.map((activity) => (
              <div
                key={activity.document}
                className="flex items-center gap-3 rounded-lg border border-border p-3 transition-all duration-200 hover:border-primary/30 hover:bg-primary/5"
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
