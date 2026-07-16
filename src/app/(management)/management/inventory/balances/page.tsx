/**
 * Management Inventory Balances page — WP-08-01A.
 *
 * Route: /management/inventory/balances
 * Uses InventoryScreenQueryService for role-safe DTOs.
 */
import { redirect } from "next/navigation";
import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { isManagementShellRole, getManagementNavForRole } from "@/components/shells/nav-config";
import { ManagementShell } from "@/components/shells/management-shell";
import { signOut } from "@/app/login/actions";
import { requireManagementInventoryActor } from "@/server/security/inventory-guards";
import type { RoleCode } from "@/server/security/role-codes";
import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LtrValue } from "@/components/ui/ltr-value";
import { db } from "@/server/db/client";
import { InventoryScreenQueryService, type ManagementBalanceDto } from "@/server/services/inventory-screen-query-service";

export default async function InventoryBalancesPage() {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const managementRole = authResult.roles.find((r) => isManagementShellRole(r)) as RoleCode | undefined;
  if (!managementRole) redirect("/worker");

  // Explicit allowlist guard — quality/unknown denied before any query
  requireManagementInventoryActor(authResult as any, authResult.roles);

  const navCategories = getManagementNavForRole(managementRole);

  let balances: ManagementBalanceDto[] = [];
  let dbAvailable = false;

  if (db) {
    try {
      const queryService = new InventoryScreenQueryService(db);
      balances = await queryService.listManagementBalances(authResult.tenantId);
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
        <h1 className="text-2xl font-bold mb-6">أرصدة المخزون</h1>

        {!dbAvailable && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              قاعدة البيانات غير متاحة. لا يمكن عرض الأرصدة.
            </CardContent>
          </Card>
        )}

        {dbAvailable && balances.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              لا توجد أرصدة مخزون مسجلة.
            </CardContent>
          </Card>
        )}

        {dbAvailable && balances.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>الأرصدة الحالية</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-right">
                      <th className="py-2 px-3">الصنف</th>
                      <th className="py-2 px-3">الموقع</th>
                      <th className="py-2 px-3">الكمية المتاحة</th>
                      <th className="py-2 px-3">الكمية الفعلية</th>
                      <th className="py-2 px-3">المحجوزة</th>
                      <th className="py-2 px-3">المحظورة</th>
                      <th className="py-2 px-3">المرتجعة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {balances.map((b, i) => (
                      <tr key={i} className="border-b">
                        <td className="py-2 px-3">
                          <div className="font-medium">{b.itemName}</div>
                          <div className="text-xs text-muted-foreground"><LtrValue>{b.itemCode}</LtrValue></div>
                        </td>
                        <td className="py-2 px-3">
                          <div className="font-medium">{b.locationName}</div>
                          <div className="text-xs text-muted-foreground"><LtrValue>{b.locationCode}</LtrValue></div>
                        </td>
                        <td className="py-2 px-3"><LtrValue className="font-bold">{b.availableQtyKg}</LtrValue></td>
                        <td className="py-2 px-3"><LtrValue>{b.onHandQtyKg}</LtrValue></td>
                        <td className="py-2 px-3"><LtrValue>{b.reservedQtyKg}</LtrValue></td>
                        <td className="py-2 px-3"><LtrValue>{b.blockedQtyKg}</LtrValue></td>
                        <td className="py-2 px-3"><LtrValue>{b.returnedQtyKg}</LtrValue></td>
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
