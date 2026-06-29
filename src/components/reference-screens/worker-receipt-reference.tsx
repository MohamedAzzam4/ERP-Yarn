/**
 * WP-01-05 Worker Raw-Material Receipt Reference Screen.
 *
 * Contract: docs/contracts/10_frontend_screen_contracts.md §7.1
 * Contract: docs/design/01_reference_screen_terms_and_fixtures.md §5
 *
 * Fixture: reference-fixtures-v1
 * Route: /worker/raw-receipts/new
 *
 * Rules:
 * - Task-first worker screen (NOT mini management)
 * - Large touch targets (44×44px minimum)
 * - No financial/accounting terms or data
 * - No real posting — fixture/demo actions only
 * - Arabic-first RTL with LTR isolation for codes/quantities
 */
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LtrValue } from "@/components/ui/ltr-value";
import { WORKER_RECEIPT_FIXTURE } from "@/lib/fixtures/reference-fixtures";

export function WorkerReceiptReference() {
  const fixture = WORKER_RECEIPT_FIXTURE;

  return (
    <Container size="sm" className="py-6">
      <h1 className="text-heading-3 text-foreground mb-6">{fixture.screenTitle}</h1>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-heading-4">بيانات الاستلام</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-4">
            {fixture.fields.map((field) => (
              <div key={field.labelAr} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <dt className="text-sm font-medium text-muted-foreground">{field.labelAr}</dt>
                <dd className="text-body text-foreground">
                  {field.ltr ? (
                    <LtrValue>{field.value}</LtrValue>
                  ) : (
                    field.value
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">الإجراءات المتاحة:</p>
        <div className="flex flex-col gap-3 sm:flex-row">
          {fixture.allowedActions.map((action) => (
            <Button
              key={action}
              type="button"
              variant="outline"
              className="min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label={action}
            >
              {action}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          هذه شاشة مرجعية ببيانات تجريبية — لا يتم تسجيل أو ترحيل أي بيانات
        </p>
      </div>
    </Container>
  );
}
