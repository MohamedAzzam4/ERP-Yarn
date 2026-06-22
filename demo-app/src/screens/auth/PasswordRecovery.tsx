import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * Password / Account Recovery — marker/wireframe screen until the auth
 * decision is approved (per /docs/contracts/10_frontend_screen_contracts.md §4.2).
 */
export default function PasswordRecovery() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>استعادة الحساب</CardTitle>
        <CardDescription>
          شاشة عرضية فقط. آلية الاستعادة الفعلية بانتظار قرار المالك:{" "}
          <span lang="en">Unresolved / requires owner decision</span>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-muted-foreground">
        <p dir="rtl">
          لا يمكن لهذه الشاشة أن تنشئ أو تفعّل مستخدم ERP أو تغيّر الصلاحيات. أي طلب استعادة سيمرّ
          عبر آلية يحددها المالك لاحقًا.
        </p>
        <p dir="rtl">
          في النسخة التشغيلية لاحقًا، ستظهر هنا خطوات التحقق المملوكة لخدمة المصادقة، مع التزام بعدم
          الكشف عن وجود الحساب.
        </p>
        <div className="rounded-md border border-border bg-muted/40 p-3 text-xs">
          <p className="font-semibold text-foreground">عرض فقط — لا توجد آلية فعلية</p>
          <p className="mt-1">
            <span lang="en">Unresolved / requires owner decision</span>
          </p>
        </div>
        <Link to="/login">
          <Button variant="outline">
            <ArrowRight className="h-4 w-4" aria-hidden />
            العودة لتسجيل الدخول
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
