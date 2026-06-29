/**
 * WP-01-05 Worker Raw-Material Receipt Reference Screen.
 *
 * Contract: docs/contracts/10_frontend_screen_contracts.md §7.1
 * Contract: docs/design/01_reference_screen_terms_and_fixtures.md §5
 *
 * Fixture: reference-fixtures-v1
 * Route: /worker/raw-receipts/new
 */
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LtrValue } from "@/components/ui/ltr-value";
import { WORKER_RECEIPT_FIXTURE } from "@/lib/fixtures/reference-fixtures";

// Split fields into logical groups for better scanning
const GROUP_SIZES = [5, 4, 2]; // first 5 = receipt info, next 4 = quantity/weight, last 2 = location/notes
const GROUP_LABELS = ["بيانات الاستلام", "الكميات والأوزان", "التخزين والملاحظات"];

export function WorkerReceiptReference() {
  const fixture = WORKER_RECEIPT_FIXTURE;
  const groups: { label: string; fields: typeof fixture.fields }[] = [];
  let offset = 0;
  for (let i = 0; i < GROUP_SIZES.length; i++) {
    groups.push({
      label: GROUP_LABELS[i]!,
      fields: fixture.fields.slice(offset, offset + GROUP_SIZES[i]!),
    });
    offset += GROUP_SIZES[i]!;
  }

  return (
    <Container size="sm" className="py-6">
      {/* Title + guidance */}
      <div className="mb-6">
        <h1 className="text-heading-2 text-foreground mb-1">{fixture.screenTitle}</h1>
        <p className="text-sm text-muted-foreground">
          أدخل بيانات استلام الخام ثم احفظ كمسودة أو أرسل للمراجعة
        </p>
      </div>

      {/* Field groups */}
      <div className="space-y-4">
        {groups.map((group) => (
          <Card key={group.label}>
            <CardHeader className="pb-3">
              <CardTitle className="text-heading-4 text-muted-foreground">{group.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3">
                {group.fields.map((field) => (
                  <div key={field.labelAr} className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between">
                    <dt className="text-sm text-muted-foreground">{field.labelAr}</dt>
                    <dd className="text-body font-medium text-foreground">
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
        ))}
      </div>

      {/* Actions */}
      <div className="mt-6 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row">
          {fixture.allowedActions.map((action, idx) => (
            <Button
              key={action}
              type="button"
              variant={idx === 1 ? "primary" : "outline"}
              className="min-h-[44px] flex-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label={action}
            >
              {action}
            </Button>
          ))}
        </div>
        <p className="text-xs text-center text-muted-foreground">
          هذه شاشة مرجعية ببيانات تجريبية — لا يتم تسجيل أو ترحيل أي بيانات
        </p>
      </div>
    </Container>
  );
}
