import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";
import { BidiValue } from "@/components/shared/BidiValue";
import { Badge } from "@/components/ui/badge";
import { useDemoStore } from "@/store/DemoStoreContext";
import { formatTimestamp } from "@/lib/utils";

export default function WarehouseActivity() {
  const { state } = useDemoStore();
  const items = state.activity.filter((a) => a.category === "warehouse");

  return (
    <div className="space-y-6">
      <PageHeader
        title="نشاط المخزن الأخير"
        description="آخر العمليات المسجّلة من دور عامل المخزن. القيم تجريبية."
        breadcrumbs={[{ label: "نشاط المخزن" }]}
      />
      {items.length === 0 ? (
        <EmptyState
          title="لا توجد عمليات بعد"
          description="ابدأ بتسجيل استلام رسالة خام أو نقل مخزون."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>آخر العمليات</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {items.map((a) => (
                <li key={a.id} className="py-3">
                  <p className="text-sm font-medium text-foreground" dir="rtl">
                    {a.actionAr}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="muted">مخزن</Badge>
                    <BidiValue size="xs">{formatTimestamp(a.timestamp)}</BidiValue>
                    {a.reference ? <BidiValue size="xs">{a.reference}</BidiValue> : null}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
