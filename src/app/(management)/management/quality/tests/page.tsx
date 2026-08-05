/**
 * Management Quality Tests page — WP-08-01E.
 *
 * Route: /management/quality/tests
 * Contract 10 §8.7: Management review of quality tests.
 *
 * Owner/Accountant can review quality tests, see risk classifications,
 * and clear quality holds. Workers are denied.
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

export default async function ManagementQualityTestsPage() {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const managementRole = authResult.roles.find((r) =>
    isManagementShellRole(r),
  ) as RoleCode | undefined;
  if (!managementRole) redirect("/worker");

  const navCategories = getManagementNavForRole(managementRole);

  let qualityTests: Awaited<
    ReturnType<
      QualityReturnScreenQueryService["listQualityTestsForManagement"]
    >
  > = [];
  let dbAvailable = false;

  if (db) {
    try {
      const queryService = new QualityReturnScreenQueryService(db);
      qualityTests = await queryService.listQualityTestsForManagement(
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
        <h1 className="text-2xl font-bold mb-6">اختبارات الجودة</h1>

        {!dbAvailable && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              قاعدة البيانات غير متاحة.
            </CardContent>
          </Card>
        )}

        {dbAvailable && qualityTests.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              لا توجد اختبارات جودة مسجلة.
            </CardContent>
          </Card>
        )}

        {dbAvailable && qualityTests.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>جميع اختبارات الجودة</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-right">
                      <th className="py-2 px-3">رقم الاختبار</th>
                      <th className="py-2 px-3">التاريخ</th>
                      <th className="py-2 px-3">الكيان المرتبط</th>
                      <th className="py-2 px-3">الحالة</th>
                      <th className="py-2 px-3">المخاطر</th>
                      <th className="py-2 px-3">المراجع</th>
                      <th className="py-2 px-3">ملاحظات المراجعة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {qualityTests.map((t) => (
                      <tr key={t.id} className="border-b">
                        <td className="py-2 px-3">
                          <LtrValue>{t.testNo}</LtrValue>
                        </td>
                        <td className="py-2 px-3">
                          <LtrValue>{t.testDate}</LtrValue>
                        </td>
                        <td className="py-2 px-3">
                          <LtrValue>{t.linkedEntityType}</LtrValue> /{" "}
                          <LtrValue>{t.linkedEntityId}</LtrValue>
                        </td>
                        <td className="py-2 px-3">{t.testStatus}</td>
                        <td className="py-2 px-3">{t.riskClassification}</td>
                        <td className="py-2 px-3">
                          {t.reviewedBy ? (
                            <LtrValue>{t.reviewedBy}</LtrValue>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-2 px-3">
                          {t.reviewNotes ?? "—"}
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
