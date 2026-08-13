/**
 * Management Account Statements (Balances) page — WP-08-01D Milestone A.
 *
 * Contract 10 §8.5: Account Statements screen — Owner/Accountant review
 * account-level balances for customer / supplier / factory accounts.
 *
 * Contract 07 §5-7: Each account has a derived balance = SUM(amount_signed).
 *   - Customer accounts: positive = receivable (customer owes)
 *   - Supplier accounts: negative = payable (company owes)
 *   - Factory accounts: negative = payable (company owes)
 *
 * Contract 11 §8: All balances are management-only (Owner/Accountant).
 * Workers are denied at the permission ceiling (DEC-063).
 *
 * The balance is ALWAYS server-derived via AccountingScreenQueryService.
 * The client never recomputes a balance from a list of entries.
 *
 * Permission: balances.view_customer OR balances.view_supplier_factory
 * (the sidebar entry uses balances.view_customer as the gating key, but
 * the page itself accepts either because both Owner and Accountant hold
 * at least one of them — Contract 11 §5).
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
import { resolveEffectivePermissions } from "@/server/security/effective-permissions";
import { requireAnyPermission } from "@/server/security/guards";
import { loadRolePermissionMatrixForTenant } from "@/server/security/permission-loader";
import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LtrValue } from "@/components/ui/ltr-value";
import { db } from "@/server/db/client";
import {
  AccountingScreenQueryService,
  type ManagementAccountStatementDto,
} from "@/server/services/accounting-screen-query-service";

export default async function ManagementAccountBalancesPage() {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const managementRole = authResult.roles.find((r) =>
    isManagementShellRole(r),
  ) as RoleCode | undefined;
  if (!managementRole) redirect("/worker");

  // Permission: balances.view_customer OR balances.view_supplier_factory.
  // Owner/Accountant hold at least one of these; Workers are denied by the
  // financial-deny ceiling (DEC-063) before this check even runs.
  const effective = resolveEffectivePermissions(
    authResult.roles,
    (await loadRolePermissionMatrixForTenant(authResult.tenantId)),
  );
  requireAnyPermission(effective, [
    "balances.view_customer",
    "balances.view_supplier_factory",
  ]);

  const navCategories = getManagementNavForRole(managementRole);

  let statements: ManagementAccountStatementDto[] = [];
  let dbAvailable = false;

  if (db) {
    try {
      const queryService = new AccountingScreenQueryService(db);
      statements = await queryService.listAccountStatements(
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
        <h1 className="text-2xl font-bold mb-6">كشف الحسابات</h1>

        {!dbAvailable && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              قاعدة البيانات غير متاحة. لا يمكن عرض كشوف الحسابات.
            </CardContent>
          </Card>
        )}

        {dbAvailable && statements.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              لا توجد حسابات مسجلة.
            </CardContent>
          </Card>
        )}

        {dbAvailable && statements.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>جميع الحسابات</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-right">
                      <th className="py-2 px-3">نوع المالك</th>
                      <th className="py-2 px-3">اسم المالك</th>
                      <th className="py-2 px-3">الرمز</th>
                      <th className="py-2 px-3">العملة</th>
                      <th className="py-2 px-3">عدد القيود</th>
                      <th className="py-2 px-3">إجمالي المدين</th>
                      <th className="py-2 px-3">إجمالي الدائن</th>
                      <th className="py-2 px-3">الرصيد الجاري</th>
                      <th className="py-2 px-3">الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statements.map((s) => (
                      <tr key={s.id} className="border-b">
                        <td className="py-2 px-3">{s.ownerType}</td>
                        <td className="py-2 px-3">{s.ownerName}</td>
                        <td className="py-2 px-3">
                          <LtrValue>{s.ownerCode}</LtrValue>
                        </td>
                        <td className="py-2 px-3">
                          <LtrValue>{s.currency}</LtrValue>
                        </td>
                        <td className="py-2 px-3">
                          <LtrValue>{s.entryCount}</LtrValue>
                        </td>
                        <td className="py-2 px-3">
                          <LtrValue>{s.totalDebit}</LtrValue>
                        </td>
                        <td className="py-2 px-3">
                          <LtrValue>{s.totalCredit}</LtrValue>
                        </td>
                        <td className="py-2 px-3 font-medium">
                          <LtrValue>{s.runningBalance}</LtrValue>
                        </td>
                        <td className="py-2 px-3">{s.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                الرصيد محتسب من جانب الخادم فقط (مجموع القيود الموقعة) ولا
                يعاد احتسابه على العميل.
              </p>
            </CardContent>
          </Card>
        )}
      </Container>
    </ManagementShell>
  );
}
