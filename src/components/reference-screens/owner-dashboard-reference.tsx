/**
 * WP-01-07 Owner Dashboard Reference Screen.
 *
 * Contract: docs/contracts/10_frontend_screen_contracts.md §6.1
 * Contract: docs/design/01_reference_screen_terms_and_fixtures.md §7
 *
 * Fixture: reference-fixtures-v1
 * Route: /management/dashboard
 *
 * Rules:
 * - Management console screen (Owner/Accountant)
 * - KPI cards are navigational (clickable/visually prepared)
 * - No internal factory-floor metrics (outsourced manufacturing only)
 * - Approximate profitability labeled as approximate with missing-cost flags
 * - Charts must be readable with accessible summary
 * - Arabic-first RTL with LTR isolation for values
 * - Restrained glass accents allowed on dashboard summary band (DEC-076)
 */
import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LtrValue } from "@/components/ui/ltr-value";
import { OWNER_DASHBOARD_FIXTURE } from "@/lib/fixtures/reference-fixtures";

export function OwnerDashboardReference() {
  const fixture = OWNER_DASHBOARD_FIXTURE;

  return (
    <Container size="xl" className="py-6">
      <h1 className="text-heading-3 text-foreground mb-6">{fixture.screenTitle}</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 mb-6 sm:grid-cols-2 lg:grid-cols-4">
        {fixture.kpiCards.map((card) => (
          <Card
            key={card.labelAr}
            className="cursor-pointer transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            role="link"
            aria-label={`${card.labelAr}: ${card.value}`}
            tabIndex={0}
          >
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-1">{card.labelAr}</p>
              <p className="text-2xl font-bold text-foreground">
                <LtrValue>{card.value}</LtrValue>
              </p>
              {card.labelAr === "ربحية تقريبية" && (
                <p className="text-xs text-warning mt-1">تقريبي — قد تحتاج مراجعة التكلفة</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 mb-6 lg:grid-cols-3">
        {fixture.charts.map((chart) => (
          <Card key={chart.titleAr}>
            <CardHeader>
              <CardTitle className="text-heading-4">{chart.titleAr}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2" role="img" aria-label={chart.titleAr}>
                {chart.dataPoints.map((point) => (
                  <div key={point.label} className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">{point.label}</span>
                    <span className="text-sm font-medium text-foreground">
                      <LtrValue>{point.value}</LtrValue>
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle className="text-heading-4">آخر نشاطاتي</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {fixture.recentActivity.map((activity) => (
              <div
                key={activity.document}
                className="flex items-center justify-between rounded-lg border border-border p-3"
              >
                <div className="flex items-center gap-3">
                  <LtrValue className="font-medium text-foreground">{activity.document}</LtrValue>
                  <span className="text-sm text-muted-foreground">{activity.summaryAr}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground mt-4">
        هذه شاشة مرجعية ببيانات تجريبية — لا يتم تنفيذ عمليات فعلية
      </p>
    </Container>
  );
}
