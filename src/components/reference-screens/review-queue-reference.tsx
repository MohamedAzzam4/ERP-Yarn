/**
 * WP-01-06 Accountant Review Queue Reference Screen.
 *
 * Contract: docs/contracts/10_frontend_screen_contracts.md §8.1
 * Contract: docs/design/01_reference_screen_terms_and_fixtures.md §6
 * DEC-076: Restrained glass accents on management surfaces.
 *
 * Fixture: reference-fixtures-v1
 * Route: /management/reviews
 */
import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LtrValue } from "@/components/ui/ltr-value";
import { REVIEW_QUEUE_FIXTURE } from "@/lib/fixtures/reference-fixtures";

const severityConfig: Record<string, { label: string; classes: string; dot: string; border: string }> = {
  low: { label: "منخفض", classes: "bg-info/10 text-info", dot: "bg-info", border: "border-info/20" },
  medium: { label: "متوسط", classes: "bg-warning/10 text-warning", dot: "bg-warning", border: "border-warning/20" },
  high: { label: "عالي", classes: "bg-danger/10 text-danger", dot: "bg-danger", border: "border-danger/20" },
};

export function ReviewQueueReference() {
  const fixture = REVIEW_QUEUE_FIXTURE;

  return (
    <Container size="lg" className="py-6">
      <div className="mb-6 rounded-xl border border-border bg-gradient-to-l from-primary/5 to-transparent p-4 backdrop-blur-sm">
        <h1 className="text-heading-2 text-foreground mb-1">{fixture.screenTitle}</h1>
        <p className="text-sm text-muted-foreground">مراجعات مطلوبة تتطلب اتخاذ إجراء</p>
      </div>

      {/* Summary count cards */}
      <div className="grid grid-cols-2 gap-3 mb-6 sm:grid-cols-3 lg:grid-cols-6">
        {fixture.summaryCounts.map((item, idx) => (
          <Card
            key={item.categoryAr}
            className={`relative overflow-hidden transition-all duration-200 hover:shadow-md ${idx === 0 ? "border-primary/20 bg-primary/5" : ""}`}
          >
            {idx === 0 && <div className="absolute inset-x-0 top-0 h-0.5 bg-primary/30" />}
            <CardContent className="p-3">
              <p className="text-2xl font-bold text-foreground" dir="ltr">{item.count}</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-tight">{item.categoryAr}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Queue table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-heading-4">قائمة المراجعات</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" role="table">
              <thead>
                <tr className="border-b border-border bg-muted/30">
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
                {fixture.queueRows.map((row) => {
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
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${sev.classes} ${sev.border}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${sev.dot}`} />
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
                            aria-label="اعتماد (غير متاح - شاشة مرجعية)"
                            className="min-h-[44px] border-success/30 text-success/50 opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            اعتماد
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled
                            aria-label="رفض (غير متاح - شاشة مرجعية)"
                            className="min-h-[44px] border-danger/30 text-danger/50 opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            رفض
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-3 text-xs text-muted-foreground border-t border-border">
            هذه شاشة مرجعية ببيانات تجريبية — أزرار الاعتماد/الرفض معطلة ولا تنفذ عمليات فعلية
          </p>
        </CardContent>
      </Card>
    </Container>
  );
}
