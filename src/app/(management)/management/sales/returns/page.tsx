/**
 * Management Sales Returns page — WP-08-01C.
 *
 * Contract 10 §8.4: Sales returns management screen.
 */
import { redirect } from "next/navigation";
import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { ManagementShell } from "@/components/shells/management-shell";
import { isManagementShellRole, getManagementNavForRole } from "@/components/shells/nav-config";
import { signOut } from "@/app/login/actions";
import type { RoleCode } from "@/server/security/role-codes";
import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LtrValue } from "@/components/ui/ltr-value";
import { db } from "@/server/db/client";
import { SalesScreenQueryService, type ManagementReturnRequestDto } from "@/server/services/sales-screen-query-service";

export default async function ManagementSalesReturnsPage() {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const managementRole = authResult.roles.find((r) => isManagementShellRole(r)) as RoleCode | undefined;
  if (!managementRole) redirect("/worker");

  const navCategories = getManagementNavForRole(managementRole);

  let returns: ManagementReturnRequestDto[] = [];
  let dbAvailable = false;

  if (db) {
    try {
      const queryService = new SalesScreenQueryService(db);
      returns = await queryService.listManagementReturnRequests(authResult.tenantId);
      dbAvailable = true;
    } catch { dbAvailable = false; }
  }

  return (
    <ManagementShell
      userName={authResult.name || authResult.email}
      navCategories={navCategories}
      onSignOut={async () => { "use server"; await signOut(); }}
    >
      <Container>
        <h1 className="text-2xl font-bold mb-6">مرتجعات المبيعات</h1>

        {!dbAvailable && (
          <Card><CardContent className="py-8 text-center text-muted-foreground">قاعدة البيانات غير متاحة.</CardContent></Card>
        )}

        {dbAvailable && returns.length === 0 && (
          <Card><CardContent className="py-8 text-center text-muted-foreground">لا توجد مرتجعات مبيعات مسجلة.</CardContent></Card>
        )}

        {dbAvailable && returns.length > 0 && (
          <Card>
            <CardHeader><CardTitle>المرتجعات الحالية</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-right">
                      <th className="py-2 px-3">رقم المستند</th>
                      <th className="py-2 px-3">العميل</th>
                      <th className="py-2 px-3">تاريخ الإرجاع</th>
                      <th className="py-2 px-3">الحالة</th>
                      <th className="py-2 px-3">الموافقة</th>
                      <th className="py-2 px-3">المعالجة المالية</th>
                      <th className="py-2 px-3">استبدال</th>
                      <th className="py-2 px-3">السبب</th>
                    </tr>
                  </thead>
                  <tbody>
                    {returns.map((r) => (
                      <tr key={r.id} className="border-b">
                        <td className="py-2 px-3"><LtrValue>{r.docNo}</LtrValue></td>
                        <td className="py-2 px-3">{r.customerName} (<LtrValue>{r.customerCode}</LtrValue>)</td>
                        <td className="py-2 px-3"><LtrValue>{r.returnDate}</LtrValue></td>
                        <td className="py-2 px-3">{r.status}</td>
                        <td className="py-2 px-3">{r.approvalStatus}</td>
                        <td className="py-2 px-3">{r.financialTreatment ?? "—"}</td>
                        <td className="py-2 px-3">{r.isReplacement ? "نعم" : "لا"}</td>
                        <td className="py-2 px-3">{r.returnReason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </Container>
    </ManagementShell>
  );
}
