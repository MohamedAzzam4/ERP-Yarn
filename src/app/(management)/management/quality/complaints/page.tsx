/**
 * Management Complaints page — WP-08-01E.
 *
 * Route: /management/quality/complaints
 * Contract 10 §8.7: Management review of complaints.
 *
 * Owner/Accountant can view complaints with full resolution fields.
 * Workers are denied.
 */
import { redirect } from "next/navigation";
import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { ManagementShell } from "@/components/shells/management-shell";
import {
  isManagementShellRole,
  getManagementNavForRole,
} from "@/components/shells/nav-config";
import { signOut } from "@/app/login/actions";
import type { RoleCode } from "@/server/security/role-codes";
import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LtrValue } from "@/components/ui/ltr-value";
import { db } from "@/server/db/client";
import { QualityReturnScreenQueryService } from "@/server/services/quality-return-screen-query-service";

export default async function ManagementComplaintsPage() {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const managementRole = authResult.roles.find((r) =>
    isManagementShellRole(r),
  ) as RoleCode | undefined;
  if (!managementRole) redirect("/worker");

  const navCategories = getManagementNavForRole(managementRole);

  let complaints: Awaited<
    ReturnType<QualityReturnScreenQueryService["listComplaintsForManagement"]>
  > = [];
  let dbAvailable = false;

  if (db) {
    try {
      const queryService = new QualityReturnScreenQueryService(db);
      complaints = await queryService.listComplaintsForManagement(
        authResult.tenantId,
      );
      dbAvailable = true;
    } catch {
      dbAvailable = false;
    }
  }

  return (
    <ManagementShell
      userName={authResult.name || authResult.email}
      navCategories={navCategories}
      onSignOut={async () => {
        "use server";
        await signOut();
      }}
    >
      <Container>
        <h1 className="text-2xl font-bold mb-6">الشكاوى</h1>

        {!dbAvailable && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              قاعدة البيانات غير متاحة.
            </CardContent>
          </Card>
        )}

        {dbAvailable && complaints.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              لا توجد شكاوى مسجلة.
            </CardContent>
          </Card>
        )}

        {dbAvailable && complaints.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>جميع الشكاوى</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-right">
                      <th className="py-2 px-3">رقم الشكوى</th>
                      <th className="py-2 px-3">التاريخ</th>
                      <th className="py-2 px-3">الموضوع</th>
                      <th className="py-2 px-3">الحالة</th>
                      <th className="py-2 px-3">الأولوية</th>
                      <th className="py-2 px-3">نوع الحل</th>
                      <th className="py-2 px-3">ملاحظات الحل</th>
                    </tr>
                  </thead>
                  <tbody>
                    {complaints.map((c) => (
                      <tr key={c.id} className="border-b">
                        <td className="py-2 px-3">
                          <LtrValue>{c.complaintNo}</LtrValue>
                        </td>
                        <td className="py-2 px-3">
                          <LtrValue>{c.complaintDate}</LtrValue>
                        </td>
                        <td className="py-2 px-3">{c.subject}</td>
                        <td className="py-2 px-3">{c.status}</td>
                        <td className="py-2 px-3">{c.priority}</td>
                        <td className="py-2 px-3">
                          {c.resolutionType ?? "—"}
                        </td>
                        <td className="py-2 px-3">
                          {c.resolutionNotes ?? "—"}
                        </td>
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
