import { AlertCircle, AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BidiValue } from "@/components/shared/BidiValue";
import { useDemoStore } from "@/store/DemoStoreContext";
import { formatTimestamp } from "@/lib/utils";

export default function BackupRestore() {
  const { state } = useDemoStore();
  return (
    <div className="space-y-6">
      <PageHeader
        title="حالة النسخ الاحتياطي والاستعادة"
        description="عرض حالة النسخ والاستعادة فقط. الطبقة المجانية ليست جاهزة للإنتاج. الاستعادة الإنتاجية تتطلب إذن المالك خارج الواجهة العادية."
      />

      <Card className="border-warning/30 bg-warning/5">
        <CardContent className="flex items-start gap-3 p-4 text-sm">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
          <p className="text-xs text-warning-foreground" dir="rtl">
            عرض فقط. لا توجد آلية نسخ احتياطي فعلية في العرض التفاعلي. التصدير الداخلي في شاشة
            التقارير ليس نسخة احتياطية ولا فاتورة قانونية.
          </p>
        </CardContent>
      </Card>

      {state.backups.map((b) => (
        <Card key={b.id}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>
                {b.environment === "demo_local" ? "البيئة المحلية للعرض" : "الطبقة المجانية"}
              </span>
              <Badge
                variant={
                  b.status === "ok"
                    ? "approved"
                    : b.status === "warning"
                      ? "needsReview"
                      : b.status === "failed"
                        ? "rejected"
                        : "muted"
                }
              >
                {b.status === "ok"
                  ? "سليم"
                  : b.status === "warning"
                    ? "تحذير"
                    : b.status === "failed"
                      ? "فاشل"
                      : "غير مُهيَّأ"}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="آخر نسخة">
              <BidiValue size="xs">{formatTimestamp(b.lastBackupAt)}</BidiValue>
            </Row>
            {b.lastRestoreTestAt ? (
              <Row label="آخر اختبار استعادة">
                <BidiValue size="xs">{formatTimestamp(b.lastRestoreTestAt)}</BidiValue>
              </Row>
            ) : null}
            <Row label="المُنفِّذ">{b.operatorAr}</Row>
            <Row label="بصمة المرجع">
              <BidiValue size="xs">{b.checksumRef}</BidiValue>
            </Row>
            <Row label="الدليل/الملاحظات">
              <p className="text-xs text-muted-foreground" dir="rtl">
                {b.evidenceAr}
              </p>
            </Row>
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardContent className="space-y-2 p-4 text-xs text-muted-foreground">
          <p className="flex items-start gap-2" dir="rtl">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              الاحتفاظ/RPO/RTO للطبقة الإنتاجية ومراقبة النسخ —{" "}
              <span lang="en">Unresolved / requires owner decision</span>.
            </span>
          </p>
          <p className="flex items-start gap-2" dir="rtl">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>الاستعادة الإنتاجية تتطلب إذن المالك خارج واجهة العرض.</span>
          </p>
          <p className="flex items-start gap-2" dir="rtl">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>اختبار الاستعادة على بيئة غير إنتاجية متاح للمحاسب عند الإذن فقط.</span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2 border-b border-border py-1.5 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{children}</span>
    </div>
  );
}
