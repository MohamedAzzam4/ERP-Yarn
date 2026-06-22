import { useState } from "react";
import { AlertTriangle, CheckCircle2, Lock } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BidiValue } from "@/components/shared/BidiValue";
import { useDemoStore } from "@/store/DemoStoreContext";
import { formatTimestamp } from "@/lib/utils";

/**
 * Migration Approval — dual approval (Owner + Accountant). Per permission
 * matrix §10 + §15: commit requires both approvals. Whether one multi-role
 * user can satisfy both is Unresolved / requires owner decision (PCD-MIG-001).
 */
export default function MigrationApproval() {
  const { state } = useDemoStore();
  const batch = state.migrationBatches[0];
  const [pendingAction, setPendingAction] = useState<"owner" | "accountant" | null>(null);

  if (!batch) {
    return (
      <div className="space-y-6">
        <PageHeader title="ترحيل تاريخي — اعتماد" />
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            لا توجد دفعات ترحيل.
          </CardContent>
        </Card>
      </div>
    );
  }

  const bothApproved = batch.ownerApproved && batch.accountantApproved;

  return (
    <div className="space-y-6">
      <PageHeader
        title="ترحيل تاريخي — اعتماد مزدوج"
        description="يلتزم السجل التاريخي فقط بعد اعتماد كل من المالك والمحاسب. السجلات الملتزمة مقفلة ضد التعديل المباشر."
      />

      <Card
        className={
          bothApproved ? "border-success/30 bg-success/5" : "border-warning/30 bg-warning/5"
        }
      >
        <CardContent className="flex items-start gap-3 p-4 text-sm">
          {bothApproved ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />
          ) : (
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
          )}
          <div className="flex-1 space-y-1">
            <p className="font-semibold" dir="rtl">
              {bothApproved ? "جاهز للالتزام" : "بانتظار الاعتماد المزدوج"}
            </p>
            <p className="text-xs text-muted-foreground" dir="rtl">
              المالك: {batch.ownerApproved ? "معتمد" : "بانتظار"} — المحاسب:{" "}
              {batch.accountantApproved ? "معتمد" : "بانتظار"}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>بيانات الدفعة</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row label="الرمز">
            <BidiValue>{batch.code}</BidiValue>
          </Row>
          <Row label="الملف">
            <BidiValue>{batch.fileName}</BidiValue>
          </Row>
          <Row label="بصمة الملف">
            <BidiValue size="xs">{batch.fileHash}</BidiValue>
          </Row>
          <Row label="الفترة المصدر">
            <BidiValue>{batch.sourcePeriod}</BidiValue>
          </Row>
          <Row label="تاريخ الرفع">
            <BidiValue size="xs">{formatTimestamp(batch.uploadedAt)}</BidiValue>
          </Row>
          <Row label="الحالة">
            <Badge variant="info">{batch.status}</Badge>
          </Row>
          <Row label="مقفل؟">
            {batch.isLocked ? (
              <Badge variant="muted">
                <Lock className="h-3 w-3" aria-hidden /> مقفل
              </Badge>
            ) : (
              <span className="text-xs text-muted-foreground">لا</span>
            )}
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>اعتمادات الأدوار</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-2 rounded-md border border-border p-3">
            <div>
              <p className="text-sm font-medium">اعتماد المالك</p>
              <p className="text-xs text-muted-foreground">
                {batch.ownerApproved ? "تم الاعتماد" : "بانتظار اعتماد المالك"}
              </p>
            </div>
            <Button
              variant={batch.ownerApproved ? "outline" : "default"}
              size="sm"
              onClick={() => setPendingAction("owner")}
              disabled={batch.ownerApproved}
            >
              {batch.ownerApproved ? "معتمد" : "اعتماد المالك (عرض)"}
            </Button>
          </div>
          <div className="flex items-center justify-between gap-2 rounded-md border border-border p-3">
            <div>
              <p className="text-sm font-medium">اعتماد المحاسب</p>
              <p className="text-xs text-muted-foreground">
                {batch.accountantApproved ? "تم الاعتماد" : "بانتظار اعتماد المحاسب"}
              </p>
            </div>
            <Button
              variant={batch.accountantApproved ? "outline" : "default"}
              size="sm"
              onClick={() => setPendingAction("accountant")}
              disabled={batch.accountantApproved}
            >
              {batch.accountantApproved ? "معتمد" : "اعتماد المحاسب (عرض)"}
            </Button>
          </div>
          <p className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground" dir="rtl">
            ملاحظة: ما إذا كان يجب أن يتم الاعتمادان من هويّتي مستخدم مختلفتين هو قرار غير محسوم (
            <span lang="en">PCD-MIG-001</span>) —{" "}
            <span lang="en">Unresolved / requires owner decision</span>.
          </p>
        </CardContent>
      </Card>

      {pendingAction ? (
        <Card className="border-info/30 bg-info/5">
          <CardContent className="p-3 text-xs text-info-foreground">
            <p dir="rtl">
              سيُسجَّل الاعتماد محليًا في واجهة العرض فقط. الالتزام الفعلي يتطلب آلية منفصلة في
              النسخة التشغيلية لاحقًا. اضغط «اعتماد» مرة أخرى للتأكيد.
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                variant="default"
                onClick={() => {
                  setPendingAction(null);
                }}
              >
                تأكيد الاعتماد (عرض)
              </Button>
              <Button size="sm" variant="outline" onClick={() => setPendingAction(null)}>
                إلغاء
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border py-1.5 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{children}</span>
    </div>
  );
}
