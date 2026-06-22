import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BidiValue } from "@/components/shared/BidiValue";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDemoStore } from "@/store/DemoStoreContext";
import { ROLES } from "@/types";
import { formatDate } from "@/lib/utils";

const ROLE_LABEL_AR: Record<string, string> = Object.fromEntries(
  ROLES.map((r) => [r.id, r.labelAr]),
);

export default function UserManagement() {
  const { state } = useDemoStore();
  return (
    <div className="space-y-6">
      <PageHeader
        title="المستخدمون والصلاحيات"
        description="إدارة المستخدمين والصلاحيات — المالك فقط. لا يوجد دور Admin عام، ولا تسجيل عام، ولا صلاحية عامة للعامل."
      />

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>المستخدمون ({state.users.length})</CardTitle>
          <Button size="sm" variant="accent">
            إضافة مستخدم (عرض)
          </Button>
        </CardHeader>
        <CardContent>
          <Table ariaLabel="قائمة المستخدمين">
            <TableHeader>
              <TableRow>
                <TableHead>الاسم</TableHead>
                <TableHead>البريد</TableHead>
                <TableHead>الهاتف</TableHead>
                <TableHead>الدور</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>آخر نشاط</TableHead>
                <TableHead>إجراء</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="text-xs">{u.nameAr}</TableCell>
                  <TableCell>
                    <BidiValue size="xs">{u.email}</BidiValue>
                  </TableCell>
                  <TableCell>
                    <BidiValue size="xs">{u.phone}</BidiValue>
                  </TableCell>
                  <TableCell>
                    <Badge variant="info">{ROLE_LABEL_AR[u.role]}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.status === "active" ? "approved" : "muted"}>
                      {u.status === "active" ? "نشط" : "غير نشط"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <BidiValue size="xs">{formatDate(u.lastActiveAt)}</BidiValue>
                  </TableCell>
                  <TableCell>
                    <Button variant="outline" size="sm">
                      عرض (عرض)
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>قواعد الصلاحيات</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-muted-foreground">
          <p dir="rtl">• المالك وحده يدير المستخدمين والصلاحيات والإعدادات الأمنية.</p>
          <p dir="rtl">• المحاسب لا يمكنه منح صلاحيات أو إنشاء مستخدمين متميزين.</p>
          <p dir="rtl">• العامل يرى الحقائق التشغيلية فقط — لا أسعار، لا أرصدة، لا ربحية.</p>
          <p dir="rtl">
            • نطاق صفوف العامل (<span lang="en">PCD-SEC-001</span>) —{" "}
            <span lang="en">Unresolved / requires owner decision</span>.
          </p>
          <p dir="rtl">
            • آلية الدخول (<span lang="en">PCD-AUTH-003</span>) —{" "}
            <span lang="en">Unresolved / requires owner decision</span>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
