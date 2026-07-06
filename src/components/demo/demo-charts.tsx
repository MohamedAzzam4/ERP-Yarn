/**
 * Demo chart primitives — Power BI-style hover/focus microinteractions.
 *
 * Mirrors the chart patterns from
 * `src/components/reference-screens/owner-dashboard-reference.tsx` so the demo
 * screens look continuous with the approved reference screens.
 *
 * All charts:
 *   - hover/focus highlights one element and dims the others (opacity
 *     0.35–0.55, never layout-shifting scale).
 *   - expose `tabIndex={0}` + `role="button"` so keyboard users get the same
 *     emphasis as mouse users.
 *   - use `transition-all duration-200` which `prefers-reduced-motion` (in
 *     globals.css) collapses to 0.01ms.
 *   - use semantic tokens only (no literal Tailwind colors).
 */
"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LtrValue } from "@/components/ui/ltr-value";

const CHART_FOCUS_TRANSITION = "transition-all duration-200 ease-out";

// Chart color palette — 7 distinct colors, no duplicates.
// Uses chart-N tokens (NOT semantic tokens like bg-primary/bg-success) because
// semantic tokens have collisions:
//   bg-primary === bg-info        (#2457c5 blue)
//   bg-accent === bg-success      (#2a9d8f teal)
// The chart-N tokens are guaranteed unique per globals.css @theme.
const BAR_COLORS = [
  "bg-chart-1", // blue/navy
  "bg-chart-2", // teal
  "bg-chart-3", // amber
  "bg-chart-5", // rose
  "bg-chart-4", // slate
  "bg-chart-6", // violet
  "bg-chart-7", // cyan
];

const SEVERITY_STYLES: Record<string, { dot: string; bar: string; text: string }> = {
  high: { dot: "bg-danger", bar: "bg-danger/70", text: "text-danger" },
  medium: { dot: "bg-warning", bar: "bg-warning/70", text: "text-warning" },
  low: { dot: "bg-info", bar: "bg-info/70", text: "text-info" },
};

function parseNumeric(value: string): number {
  const m = value.match(/-?[\d,.]+/);
  return m ? parseFloat(m[0].replace(/,/g, "")) : 0;
}

// ---------------------------------------------------------------------------
// DonutChart — Power BI-style focus on hovered/focused segment.
// ---------------------------------------------------------------------------

export type DonutSegment = { value: number; color: string; label: string; unitAr?: string };

export function DemoDonutChart({ segments, totalLabelAr = "كجم" }: { segments: ReadonlyArray<DonutSegment>; totalLabelAr?: string }) {
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

  const [active, setActive] = React.useState<number>(-1);
  const isActive = (i: number) => active === i;
  const dimmed = (i: number) => active !== -1 && active !== i;

  return (
    <div className="flex flex-wrap items-center gap-4">
      <svg width="140" height="140" viewBox="0 0 140 140" className="shrink-0" role="img" aria-label="توزيع دائري">
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
              style={{ opacity: isDim ? 0.35 : 1, cursor: "pointer" }}
              tabIndex={0}
              role="button"
              aria-label={`${seg.label}: ${seg.value.toLocaleString("en-US", { minimumFractionDigits: 3 })}`}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(-1)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(-1)}
            />
          );
        })}
        <text x="70" y="65" textAnchor="middle" className="fill-foreground text-xs font-bold">
          {active !== -1
            ? segmentData[active]!.value.toLocaleString("en-US", { maximumFractionDigits: 0 })
            : total.toLocaleString("en-US", { maximumFractionDigits: 0 })}
        </text>
        <text x="70" y="80" textAnchor="middle" className="fill-muted-foreground text-[8px]">
          {active !== -1 ? segmentData[active]!.label.slice(0, 12) : totalLabelAr}
        </text>
      </svg>
      <div className="space-y-2">
        {segmentData.map((seg, i) => {
          const isOn = isActive(i);
          const isDim = dimmed(i);
          return (
            <div
              key={i}
              className={cn("flex items-center gap-2 text-sm rounded-md px-1.5 py-0.5", CHART_FOCUS_TRANSITION, isOn ? "bg-primary/5" : "")}
              style={{ opacity: isDim ? 0.5 : 1, cursor: "pointer" }}
              tabIndex={0}
              role="button"
              aria-label={`${seg.label}: ${seg.value.toLocaleString("en-US", { minimumFractionDigits: 3 })}`}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(-1)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(-1)}
            >
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: seg.color }} />
              <span className={cn(CHART_FOCUS_TRANSITION, isOn ? "font-bold text-foreground" : "text-muted-foreground")}>{seg.label}</span>
              <span className={cn(CHART_FOCUS_TRANSITION, isOn ? "font-bold text-primary" : "font-medium text-foreground")} dir="ltr">
                {seg.value.toLocaleString("en-US", { minimumFractionDigits: 3 })}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MiniTrendLine — SVG line with hoverable points.
// ---------------------------------------------------------------------------

export function DemoMiniTrendLine({ values, maxVal }: { values: number[]; maxVal: number }) {
  const w = 200, h = 60;
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map((v, i) => `${i * step},${h - (v / maxVal) * (h - 10) - 5}`);
  const pathD = `M ${pts.join(" L ")}`;

  const [active, setActive] = React.useState(-1);
  const dimmed = (i: number) => active !== -1 && active !== i;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="demoTrendGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.15" />
          <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${pathD} L ${w},${h} L 0,${h} Z`} fill="url(#demoTrendGrad)" />
      <path d={pathD} fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
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
            style={{ opacity: isDim ? 0.35 : 1, cursor: "pointer" }}
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

// ---------------------------------------------------------------------------
// DemoLocationBars — horizontal CSS bars with hover/focus emphasis.
// ---------------------------------------------------------------------------

export function DemoLocationBars({ data }: { data: ReadonlyArray<{ label: string; value: string }> }) {
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
            className={cn("space-y-1 rounded-md px-1.5 py-0.5", CHART_FOCUS_TRANSITION, isOn ? "bg-primary/5" : "")}
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
              <span className={cn("flex items-center gap-1.5", CHART_FOCUS_TRANSITION, isOn ? "font-bold text-foreground" : "text-muted-foreground")}>
                <span className={cn("inline-block h-2 w-2 rounded-full", BAR_COLORS[idx % BAR_COLORS.length])} />
                {point.label}
              </span>
              <span className={cn(CHART_FOCUS_TRANSITION, isOn ? "font-bold text-primary" : "font-medium text-foreground")}>
                <LtrValue>{point.value}</LtrValue>
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
              <div className={cn("h-full rounded-full", BAR_COLORS[idx % BAR_COLORS.length], CHART_FOCUS_TRANSITION)} style={{ width: `${widthPct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DemoStackedBar — segmented stacked bar + legend (complaints style).
// ---------------------------------------------------------------------------

export function DemoStackedBar({ data }: { data: ReadonlyArray<{ label: string; value: string }> }) {
  const total = data.reduce((sum, d) => sum + parseNumeric(d.value), 0);
  const [active, setActive] = React.useState(-1);
  const dimmed = (i: number) => active !== -1 && active !== i;
  return (
    <div role="img" data-chart="stacked-bar">
      <div className="mb-4 flex h-8 w-full overflow-hidden rounded-lg">
        {data.map((point, idx) => {
          const pct = total > 0 ? (parseNumeric(point.value) / total) * 100 : 0;
          const isOn = active === idx;
          const isDim = dimmed(idx);
          return (
            <div
              key={point.label}
              className={cn(BAR_COLORS[idx % BAR_COLORS.length], "flex items-center justify-center text-xs font-bold text-white", CHART_FOCUS_TRANSITION)}
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
              className={cn("flex items-center justify-between text-sm rounded-md px-1.5 py-0.5", CHART_FOCUS_TRANSITION, isOn ? "bg-primary/5" : "")}
              style={{ opacity: isDim ? 0.5 : 1, cursor: "pointer" }}
              tabIndex={0}
              role="button"
              aria-label={`${point.label}: ${point.value}`}
              onMouseEnter={() => setActive(idx)}
              onMouseLeave={() => setActive(-1)}
              onFocus={() => setActive(idx)}
              onBlur={() => setActive(-1)}
            >
              <span className={cn("flex items-center gap-1.5", CHART_FOCUS_TRANSITION, isOn ? "font-bold text-foreground" : "text-muted-foreground")}>
                <span className={cn("inline-block h-2 w-2 rounded-full", BAR_COLORS[idx % BAR_COLORS.length])} />
                {point.label}
              </span>
              <span className={cn(CHART_FOCUS_TRANSITION, isOn ? "font-bold text-primary" : "font-medium text-foreground")} dir="ltr">
                {point.value}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DemoAttentionRanking — hover/focus highlights one row, dims others.
// ---------------------------------------------------------------------------

export function DemoAttentionRanking({
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
            className={cn("space-y-1 rounded-md px-1.5 py-1", CHART_FOCUS_TRANSITION, isOn ? "bg-primary/5" : "")}
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
              <span className={cn("flex items-center gap-1.5", CHART_FOCUS_TRANSITION, isOn ? "font-bold text-foreground" : "text-foreground")}>
                <span className={cn("inline-block h-2 w-2 rounded-full", sev.dot)} />
                {item.labelAr}
              </span>
              <span className={cn("font-bold", CHART_FOCUS_TRANSITION, isOn ? "text-primary" : sev.text)} dir="ltr">
                {item.count}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className={cn("h-full rounded-full", sev.bar, CHART_FOCUS_TRANSITION)} style={{ width: `${widthPct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DemoFactoryBalances — hoverable rows with stronger emphasis.
// ---------------------------------------------------------------------------

export function DemoFactoryBalances({
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
            className={cn("flex items-center justify-between rounded-lg border p-2.5", CHART_FOCUS_TRANSITION, isOn ? "border-primary/40 bg-primary/5" : "border-border")}
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
              <p className={cn("text-sm", CHART_FOCUS_TRANSITION, isOn ? "font-bold text-foreground" : "font-medium text-foreground")}>
                {fac.factoryNameAr}
              </p>
              <p className="text-xs text-muted-foreground">
                مخزون: <LtrValue>{fac.stockKg} كجم</LtrValue>
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">مستحقات</p>
              <p className={cn("text-sm", CHART_FOCUS_TRANSITION, isOn ? "font-bold text-primary" : "font-bold text-foreground")}>
                <LtrValue>{fac.payableEgp} جنيه</LtrValue>
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DemoReviewTrendChart — trend line + hoverable point/value list.
// ---------------------------------------------------------------------------

export function DemoReviewTrendChart({ data }: { data: ReadonlyArray<{ label: string; value: string }> }) {
  const values = data.map((d) => parseNumeric(d.value));
  const maxVal = Math.max(...values);
  const [active, setActive] = React.useState(-1);
  const dimmed = (i: number) => active !== -1 && active !== i;
  return (
    <div role="img" data-chart="review-trend">
      <div className="mb-3">
        <DemoMiniTrendLine values={values} maxVal={maxVal} />
      </div>
      <div className="flex justify-between gap-1">
        {data.map((point, idx) => {
          const isOn = active === idx;
          const isDim = dimmed(idx);
          return (
            <div
              key={point.label}
              className={cn("flex flex-col items-center gap-0.5 rounded-md px-1.5 py-0.5", CHART_FOCUS_TRANSITION, isOn ? "bg-primary/10" : "")}
              style={{ opacity: isDim ? 0.5 : 1, cursor: "pointer" }}
              tabIndex={0}
              role="button"
              aria-label={`${point.label}: ${point.value}`}
              onMouseEnter={() => setActive(idx)}
              onMouseLeave={() => setActive(-1)}
              onFocus={() => setActive(idx)}
              onBlur={() => setActive(-1)}
            >
              <span className={cn("text-xs", CHART_FOCUS_TRANSITION, isOn ? "font-bold text-primary" : "font-bold text-foreground")} dir="ltr">
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

// ---------------------------------------------------------------------------
// DemoKpiCard — clickable card with subtle RTL accent line + status chip.
// Mirrors the approved reference-screen KPI card exactly (DEC-075):
//   - clean white surface (bg-surface)
//   - 3px RTL vertical accent line, inset vertically (top-5 bottom-5)
//   - small tinted status chip per category
//   - NO thick top strip, NO corner glow blob, NO scale-on-hover
//   - hover: border-primary/40 + shadow-md
//   - keyboard focus: ring-2 ring-ring
//   - role="link" + tabIndex=0 → navigates to href on Enter
// ---------------------------------------------------------------------------

const ACCENT_MAP: Record<string, { line: string; chip: string; chipText: string }> = {
  primary: { line: "bg-primary", chip: "bg-primary/10 text-primary", chipText: "مخزون" },
  accent: { line: "bg-accent", chip: "bg-accent/10 text-accent", chipText: "تشغيل" },
  success: { line: "bg-success", chip: "bg-success/10 text-success", chipText: "مالي" },
  warning: { line: "bg-warning", chip: "bg-warning/10 text-warning", chipText: "مراجعة" },
  danger: { line: "bg-danger", chip: "bg-danger/10 text-danger", chipText: "تنبيه" },
};

export interface DemoKpiCardProps {
  labelAr: string;
  value: string;
  accent: keyof typeof ACCENT_MAP | string;
  chipText?: string;
  href: string;
  isApproximate?: boolean;
}

export function DemoKpiCard({ labelAr, value, accent, chipText, href, isApproximate }: DemoKpiCardProps) {
  const a = ACCENT_MAP[accent] ?? ACCENT_MAP.primary!;
  const chip = chipText ?? a.chipText;

  const onKeyDown = (e: React.KeyboardEvent<HTMLAnchorElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      (e.currentTarget as HTMLAnchorElement).click();
    }
  };

  return (
    <Card
      data-kpi-card
      data-kpi-accent={accent}
      className="group relative overflow-hidden border-border bg-surface transition-all duration-200 hover:border-primary/40 hover:shadow-md focus-within:outline-none focus-within:ring-2 focus-within:ring-ring"
    >
      <div className={cn("pointer-events-none absolute right-0 top-5 bottom-5 w-[3px] rounded-full", a.line)} aria-hidden="true" />
      <CardContent className="relative p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground mb-1.5 truncate">{labelAr}</p>
            <p className="text-2xl font-bold text-foreground tabular-nums">
              <LtrValue>{value}</LtrValue>
            </p>
          </div>
          <span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium", a.chip)}>{chip}</span>
        </div>
        {isApproximate && (
          <div className="mt-2 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-warning" />
            <p className="text-xs text-warning">تقريبي — قد يحتاج مراجعة التكلفة</p>
          </div>
        )}
        <Link
          href={href}
          onKeyDown={onKeyDown}
          aria-label={`عرض تفاصيل: ${labelAr}`}
          className="absolute inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="sr-only">عرض التفاصيل</span>
        </Link>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// DemoPageHeader — branded page header used at the top of every demo page.
// ---------------------------------------------------------------------------

export function DemoPageHeader({
  titleAr,
  subtitleAr,
  accent = true,
}: {
  titleAr: string;
  subtitleAr?: string;
  accent?: boolean;
}) {
  return (
    <div className="mb-6 rounded-2xl border border-primary/20 bg-gradient-to-l from-primary/12 via-primary/5 to-transparent p-5 backdrop-blur-md shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        {accent && <span className="inline-block h-7 w-1.5 rounded-full bg-primary" aria-hidden="true" />}
        <h1 className="text-heading-2 text-foreground">{titleAr}</h1>
      </div>
      {subtitleAr && <p className="text-sm text-muted-foreground">{subtitleAr}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DemoCard — same shape as the production Card but with optional glass accent
// for management surfaces. Use plain <Card> from "@/components/ui/card" for
// non-glass surfaces.
// ---------------------------------------------------------------------------

export function DemoGlassCard({ titleAr, children }: { titleAr: string; children: React.ReactNode }) {
  return (
    <Card className="border-primary/15 bg-surface/80 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-heading-4 text-foreground">{titleAr}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// DemoFooterNote — page-bottom reminder that this is a demo.
// ---------------------------------------------------------------------------

export function DemoFooterNote({ text }: { text?: string }) {
  return (
    <p className="mt-4 text-xs text-center text-muted-foreground">
      {text ?? "هذه شاشة عرض تفاعلي ببيانات تجريبية — لا يتم تنفيذ عمليات فعلية ولا كتابة إلى قاعدة البيانات"}
    </p>
  );
}
