import { useNavigate } from "react-router-dom";
import { AlertCircle, LogIn } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RoleSwitcher } from "@/components/shared/RoleSwitcher";
import { useDemoStore } from "@/store/DemoStoreContext";
import { isWorker } from "@/lib/permissions";
import { ROLES } from "@/types";

export default function DemoLogin() {
  const { state } = useDemoStore();
  const navigate = useNavigate();
  const roleInfo = ROLES.find((r) => r.id === state.currentRole)!;

  const enter = () => {
    if (isWorker(state.currentRole)) navigate("/worker");
    else navigate("/dashboard/owner");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>تسجيل الدخول التفاعلي</CardTitle>
        <CardDescription>
          هذه شاشة عرض تفاعلية لتقييم واجهات النظام قبل إكمال العمل التشغيلي. آلية الدخول الفعلية
          بانتظار قرار المالك: <span lang="en">Unresolved / requires owner decision</span>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border border-warning/30 bg-warning/5 p-3 text-xs text-warning-foreground">
          <p className="flex items-start gap-2" dir="rtl">
            <AlertCircle className="h-4 w-4 shrink-0 text-warning" aria-hidden />
            <span>
              زر «تبديل الدور» أدناه هو أداة عرض تقديمي فقط وليس مصادقة فعلية. لا تُدخل أي بيانات
              حقيقية أو سرية.
            </span>
          </p>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">اختر دور العرض التفاعلي:</p>
          <RoleSwitcher />
          <p className="text-xs text-muted-foreground" dir="rtl">
            {roleInfo.descriptionAr}
          </p>
        </div>
        <Button onClick={enter} className="w-full" size="lg">
          <LogIn className="h-4 w-4" aria-hidden />
          دخول العرض التفاعلي بصفة «{roleInfo.labelAr}»
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          <a href="/recovery" className="hover:text-foreground hover:underline">
            استعادة الحساب — شاشة عرضية
          </a>
        </p>
      </CardContent>
    </Card>
  );
}
