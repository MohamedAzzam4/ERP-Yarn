import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BidiValue } from "@/components/shared/BidiValue";
import { useDemoStore } from "@/store/DemoStoreContext";
import { canManageUsers } from "@/lib/permissions";

export default function Settings() {
  const { state } = useDemoStore();
  const canManage = canManageUsers(state.currentRole);
  const groups = ["company", "terminology", "operations", "deferred"] as const;

  return (
    <div className="space-y-6">
      <PageHeader
        title="الإعدادات"
        description="إعدادات الشركة والمصطلحات والقيم المؤجلة. لا يمكن تعديل القيم المؤجلة — تتطلب قرار المالك."
      />

      {groups.map((g) => {
        const items = state.settings.filter((s) => s.category === g);
        if (items.length === 0) return null;
        const titleAr =
          g === "company"
            ? "بيانات الشركة"
            : g === "terminology"
              ? "المصطلحات المعتمدة/المؤقتة"
              : g === "operations"
                ? "إعدادات التشغيل"
                : "قرارات مؤجلة";
        return (
          <Card key={g}>
            <CardHeader>
              <CardTitle>{titleAr}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {items.map((s) => (
                <div
                  key={s.key}
                  className="flex items-start justify-between gap-2 border-b border-border py-1.5 last:border-0"
                >
                  <div>
                    <p className="font-medium text-foreground">
                      <BidiValue size="xs">{s.key}</BidiValue>
                    </p>
                    <p className="text-xs text-muted-foreground" dir="rtl">
                      {s.valueAr}
                    </p>
                  </div>
                  <Badge variant={s.editable && canManage ? "info" : "muted"}>
                    {s.editable ? (canManage ? "قابل للتعديل" : "عرض فقط") : "مؤجل — قرار المالك"}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground">
          الإعدادات لا تُعيد كتابة السجل المعتمد. أي تغيير يؤثر على المستقبل فقط ويُسجَّل في سجل
          التدقيق في النسخة التشغيلية.
        </CardContent>
      </Card>
    </div>
  );
}
