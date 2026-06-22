import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";
import { BidiValue } from "@/components/shared/BidiValue";
import { Badge } from "@/components/ui/badge";
import { useDemoStore } from "@/store/DemoStoreContext";
import { formatTimestamp } from "@/lib/utils";

export default function QualityActivity() {
  const { state } = useDemoStore();
  const items = state.activity.filter((a) => a.category === "quality");
  return (
    <div className="space-y-6">
      <PageHeader
        title="نشاط الجودة الأخير"
        description="آخر عمليات الجودة المسجّلة من دور عامل الجودة."
        breadcrumbs={[{ label: "نشاط الجودة" }]}
      />
      {items.length === 0 ? (
        <EmptyState title="لا توجد عمليات بعد" description="ابدأ بتسجيل اختبار جودة." />
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
                    <Badge variant="success">جودة</Badge>
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
