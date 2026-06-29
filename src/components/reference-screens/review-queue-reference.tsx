/**
 * WP-01-06 Accountant Review Queue Reference Screen.
 *
 * Contract: docs/contracts/10_frontend_screen_contracts.md §8.1
 * Contract: docs/design/01_reference_screen_terms_and_fixtures.md §6
 *
 * Fixture: reference-fixtures-v1
 * Route: /management/reviews
 *
 * Rules:
 * - Management console screen (Owner/Accountant only)
 * - Show review counts, queue rows, warnings, submitter, document type, status, date
 * - Approve/reject buttons are DISABLED placeholders (no real commands)
 * - No fake approvals or notification implying real status change
 * - Arabic-first RTL with LTR isolation for document numbers/dates
 */
import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LtrValue } from "@/components/ui/ltr-value";
import { REVIEW_QUEUE_FIXTURE } from "@/lib/fixtures/reference-fixtures";

const severityStyles: Record<string, string> = {
  low: "bg-info text-info-foreground",
  medium: "bg-warning text-warning-foreground",
  high: "bg-danger text-danger-foreground",
};

const severityLabels: Record<string, string> = {
  low: "منخفض",
  medium: "متوسط",
  high: "عالي",
};

export function ReviewQueueReference() {
  const fixture = REVIEW_QUEUE_FIXTURE;

  return (
    <Container size="lg" className="py-6">
      <h1 className="text-heading-3 text-foreground mb-6">{fixture.screenTitle}</h1>

      {/* Summary counts */}
      <div className="grid grid-cols-2 gap-3 mb-6 sm:grid-cols-3 lg:grid-cols-6">
        {fixture.summaryCounts.map((item) => (
          <Card key={item.categoryAr}>
            <CardContent className="p-4">
              <p className="text-2xl font-bold text-foreground" dir="ltr">
                {item.count}
              </p>
              <p className="text-xs text-muted-foreground mt-1">{item.categoryAr}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Queue table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-heading-4">قائمة المراجعات</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" role="table">
              <thead>
                <tr className="border-b border-border">
                  <th className="p-3 text-right font-medium text-muted-foreground">المستند</th>
                  <th className="p-3 text-right font-medium text-muted-foreground">النوع</th>
                  <th className="p-3 text-right font-medium text-muted-foreground">مُرسِل</th>
                  <th className="p-3 text-right font-medium text-muted-foreground">التاريخ</th>
                  <th className="p-3 text-right font-medium text-muted-foreground">الأولوية</th>
                  <th className="p-3 text-right font-medium text-muted-foreground">الحالة</th>
                  <th className="p-3 text-right font-medium text-muted-foreground">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {fixture.queueRows.map((row) => (
                  <tr key={row.document} className="border-b border-border">
                    <td className="p-3">
                      <LtrValue className="font-medium text-foreground">{row.document}</LtrValue>
                    </td>
                    <td className="p-3 text-foreground">{row.typeAr}</td>
                    <td className="p-3 text-muted-foreground">{row.submittedByAr}</td>
                    <td className="p-3">
                      <LtrValue className="text-muted-foreground">{row.date}</LtrValue>
                    </td>
                    <td className="p-3">
                      <span
                        className={`inline-block rounded px-2 py-1 text-xs ${severityStyles[row.severity]}`}
                      >
                        {severityLabels[row.severity]}
                      </span>
                    </td>
                    <td className="p-3 text-foreground">{row.stateAr}</td>
                    <td className="p-3">
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled
                          aria-label="اعتماد (غير متاح - شاشة مرجعية)"
                          className="min-h-[44px] opacity-50"
                        >
                          اعتماد
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled
                          aria-label="رفض (غير متاح - شاشة مرجعية)"
                          className="min-h-[44px] opacity-50"
                        >
                          رفض
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            هذه شاشة مرجعية ببيانات تجريبية — أزرار الاعتماد/الرفض معطلة ولا تنفذ عمليات فعلية
          </p>
        </CardContent>
      </Card>
    </Container>
  );
}
