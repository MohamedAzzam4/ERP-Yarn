/**
 * Demo Review Center — stakeholder visual demo.
 *
 * Route: /demo/owner/reviews
 *
 * Mirrors the approved ReviewQueueReference screen (DEC-076) but adds:
 *   - Working client-side search box (filters by document / type / submitter).
 *   - Working severity filter (All / High / Medium / Low).
 *   - Demo-only state badges that update on the disabled approve/reject
 *     buttons hover (purely visual — no actual mutation, buttons stay disabled).
 *
 * The approve/reject buttons are DISABLED and clearly marked as demo-only.
 * No real status change. No toast. No Supabase write.
 */
"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LtrValue } from "@/components/ui/ltr-value";
import { cn } from "@/lib/cn";
import { DemoShell } from "@/components/demo/demo-shell";
import { DemoPageHeader, DemoFooterNote } from "@/components/demo/demo-charts";
import { REVIEW_QUEUE_FIXTURE } from "@/lib/fixtures/reference-fixtures";

type Severity = "low" | "medium" | "high";

const severityConfig: Record<Severity, { label: string; classes: string; dot: string; border: string }> = {
  low: { label: "منخفض", classes: "bg-info/10 text-info", dot: "bg-info", border: "border-info/20" },
  medium: { label: "متوسط", classes: "bg-warning/10 text-warning", dot: "bg-warning", border: "border-warning/20" },
  high: { label: "عالي", classes: "bg-danger/10 text-danger", dot: "bg-danger", border: "border-danger/20" },
};

type FilterSeverity = "all" | Severity;

const FILTERS: { id: FilterSeverity; labelAr: string }[] = [
  { id: "all", labelAr: "الكل" },
  { id: "high", labelAr: "عالي" },
  { id: "medium", labelAr: "متوسط" },
  { id: "low", labelAr: "منخفض" },
];

export default function DemoReviewCenterPage() {
  const fixture = REVIEW_QUEUE_FIXTURE;

  const [query, setQuery] = React.useState("");
  const [severity, setSeverity] = React.useState<FilterSeverity>("all");

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return fixture.queueRows.filter((row) => {
      if (severity !== "all" && row.severity !== severity) return false;
      if (!q) return true;
      return (
        row.document.toLowerCase().includes(q) ||
        row.typeAr.toLowerCase().includes(q) ||
        row.submittedByAr.toLowerCase().includes(q) ||
        row.stateAr.toLowerCase().includes(q)
      );
    });
  }, [fixture.queueRows, query, severity]);

  return (
    <DemoShell
      userName="المدير المالي"
      breadcrumbs={[{ label: "لوحة المعلومات" }, { label: "مركز الاعتماد والمتابعة" }]}
    >
      <DemoPageHeader
        titleAr="مركز الاعتماد والمتابعة"
        subtitleAr="طلبات الاعتماد والمتابعة المعلقة تتطلب اتخاذ إجراء — استخدم البحث والفلتر لتضييق النتائج"
      />

      {/* Summary count cards */}
      <div className="grid grid-cols-2 gap-3 mb-6 sm:grid-cols-3 lg:grid-cols-6">
        {fixture.summaryCounts.map((item, idx) => (
          <Card
            key={item.categoryAr}
            className={cn(
              "relative overflow-hidden transition-all duration-200 hover:shadow-md hover:border-primary/30",
              idx === 0 ? "border-primary/30 bg-primary/5" : "",
            )}
          >
            {idx === 0 && <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-l from-primary to-primary/40" aria-hidden="true" />}
            <CardContent className="p-3">
              <p className={cn("text-2xl font-bold", idx === 0 ? "text-primary" : "text-foreground")} dir="ltr">
                {item.count}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-tight">{item.categoryAr}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Queue table with filters + search */}
      <Card>
        <CardHeader className="pb-3 border-b border-border">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-heading-4">قائمة طلبات الاعتماد والمتابعة</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              {/* Severity filter chips */}
              <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1" role="group" aria-label="فلتر الأولوية">
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setSeverity(f.id)}
                    aria-pressed={severity === f.id}
                    className={cn(
                      "min-h-[36px] rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      severity === f.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-surface",
                    )}
                  >
                    {f.labelAr}
                  </button>
                ))}
              </div>
              {/* Search box */}
              <div className="relative">
                <input
                  type="text"
                  dir="ltr"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="بحث بمستند / نوع / مُرسِل..."
                  aria-label="بحث في قائمة طلبات الاعتماد والمتابعة"
                  className="w-64 min-h-[40px] rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" role="table">
              <thead>
                <tr className="border-b border-border bg-primary/5">
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">المستند</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">النوع</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">مُرسِل</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">التاريخ</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">الأولوية</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">الحالة</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted-foreground">
                      لا توجد نتائج مطابقة للبحث الحالي
                    </td>
                  </tr>
                ) : (
                  filtered.map((row) => {
                    const sev = severityConfig[row.severity]!;
                    return (
                      <tr key={row.document} className="border-b border-border transition-colors duration-150 hover:bg-primary/5">
                        <td className="p-3">
                          <LtrValue className="font-medium text-foreground">{row.document}</LtrValue>
                        </td>
                        <td className="p-3 text-foreground">{row.typeAr}</td>
                        <td className="p-3 text-muted-foreground">{row.submittedByAr}</td>
                        <td className="p-3">
                          <LtrValue className="text-muted-foreground">{row.date}</LtrValue>
                        </td>
                        <td className="p-3">
                          <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium", sev.classes, sev.border)}>
                            <span className={cn("h-1.5 w-1.5 rounded-full", sev.dot)} aria-hidden="true" />
                            {sev.label}
                          </span>
                        </td>
                        <td className="p-3">
                          <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
                            {row.stateAr}
                          </span>
                        </td>
                        <td className="p-3">
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled
                              aria-label="اعتماد (غير متاح - عرض تفاعلي)"
                              title="اعتماد (غير متاح - عرض تفاعلي)"
                              className="min-h-[44px] border-success/30 text-success/50 opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              اعتماد
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled
                              aria-label="رفض (غير متاح - عرض تفاعلي)"
                              title="رفض (غير متاح - عرض تفاعلي)"
                              className="min-h-[44px] border-danger/30 text-danger/50 opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              رفض
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-3 text-xs text-muted-foreground border-t border-border">
            هذه شاشة عرض تفاعلي ببيانات تجريبية — أزرار الاعتماد/الرفض معطلة ولا تنفذ
            عمليات فعلية. البحث والفلتر يعملان محلياً على البيانات الثابتة فقط.
          </p>
        </CardContent>
      </Card>

      <DemoFooterNote />
    </DemoShell>
  );
}
