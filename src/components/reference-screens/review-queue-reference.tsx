/**
 * WP-01-06 Accountant Review Queue Reference Screen.
 *
 * Contract: docs/contracts/10_frontend_screen_contracts.md §8.1
 * Contract: docs/design/01_reference_screen_terms_and_fixtures.md §6
 *
 * Fixture: reference-fixtures-v1
 * Route: /management/reviews
 */
import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LtrValue } from "@/components/ui/ltr-value";
import { REVIEW_QUEUE_FIXTURE } from "@/lib/fixtures/reference-fixtures";

const severityConfig: Record<string, { label: string; classes: string; dot: string }> = {
  low: { label: "منخفض", classes: "bg-info/10 text-info border-info/20", dot: "bg-info" },
  medium: { label: "متوسط", classes: "bg-warning/10 text-warning border-warning/20", dot: "bg-warning" },
  high: { label: "عالي", classes: "bg-danger/10 text-danger border-danger/20", dot: "bg-danger" },
};

export function ReviewQueueReference() {
  const fixture = REVIEW_QUEUE_FIXTURE;

  return (
    <Container size="lg" className="py-6">
      <div className="mb-6">
        <h1 className="text-heading-2 text-foreground mb-1">{fixture.screenTitle}</h1>
        <p className="text-sm text-muted-foreground">مراجعات مطلوبة تتطلب اتخاذ إجراء</p>
      </div>

      {/* Summary count cards */}
      <div className="grid grid-cols-2 gap-3 mb-6 sm:grid-cols-3 lg:grid-cols-6">
        {fixture.summaryCounts.map((item, idx) => (
          <Card
            key={item.categoryAr}
            className={idx === 0 ? "border-primary/20 bg-primary/5" : ""}
          >
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
                    <tr key={row.document} className="border-b border-border transition-colors hover:bg-muted/20">
                      <td className="p-3">
                        <LtrValue className="font-medium text-foreground">{row.document}</LtrValue>
                      </td>
                      <td className="p-3 text-foreground">{row.typeAr}</td>
                      <td className="p-3 text-muted-foreground">{row.submittedByAr}</td>
                      <td className="p-3">
                        <LtrValue className="text-muted-foreground">{row.date}</LtrValue>
                      </td>
                      <td className="p-3">
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${sev.classes}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${sev.dot}`} />
                          {sev.label}
                        </span>
                      </td>
                      <td className="p-3">
                        <span className="inline-block rounded-md bg-muted px-2 py-0.5 text-xs text-foreground">
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
                            className="min-h-[44px] opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            اعتماد
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled
                            aria-label="رفض (غير متاح - شاشة مرجعية)"
                            className="min-h-[44px] opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
