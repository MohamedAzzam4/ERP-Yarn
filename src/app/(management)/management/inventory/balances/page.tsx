/**
 * Management Inventory Balances page — WP-08-01A.
 *
 * Route: /management/inventory/balances
 *
 * Shows all inventory balances for the tenant. Owner/Accountant only.
 * Financial fields (stock value) visible only to Owner/Accountant.
 * No financial fields exposed to workers (this is a management-only page).
 *
 * Contract 04 §17: Reconciliation compares movement totals vs on-hand.
 * Contract 11 §8: Worker financial-deny is absolute.
 */
import { redirect } from "next/navigation";
import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { isManagementShellRole, getManagementNavForRole } from "@/components/shells/nav-config";
import { ManagementShell } from "@/components/shells/management-shell";
import { signOut } from "@/app/login/actions";
import type { RoleCode } from "@/server/security/role-codes";
import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LtrValue } from "@/components/ui/ltr-value";
import { db } from "@/server/db/client";
import { InventoryLedgerDbRepository } from "@/server/services/inventory-ledger-db-repository";
import { inventoryBalances, inventoryItems, locations } from "@/server/db/schema";
import { eq, and } from "drizzle-orm";

export default async function InventoryBalancesPage() {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const managementRole = authResult.roles.find((r) => isManagementShellRole(r)) as RoleCode | undefined;
  if (!managementRole) redirect("/worker");

  const navCategories = getManagementNavForRole(managementRole);

  let balances: any[] = [];
  let dbAvailable = false;

  if (db) {
    try {
      // Join balances with items and locations for display
      const results = await db
        .select({
          balance: inventoryBalances,
          item: inventoryItems,
          location: locations,
        })
        .from(inventoryBalances)
        .innerJoin(inventoryItems, eq(inventoryBalances.itemId, inventoryItems.id))
        .innerJoin(locations, eq(inventoryBalances.locationId, locations.id))
        .where(eq(inventoryBalances.tenantId, authResult.tenantId));

      balances = results.map((r) => ({
        itemId: r.balance.itemId,
        itemCode: r.item.itemCode,
        itemName: r.item.displayNameEn,
        locationId: r.balance.locationId,
        locationCode: r.location.locationCode,
        locationName: r.location.nameEn,
        onHandQtyKg: r.balance.onHandQtyKg,
        reservedQtyKg: r.balance.reservedQtyKg,
        blockedQtyKg: r.balance.blockedQtyKg,
        returnedQtyKg: r.balance.returnedQtyKg,
        availableQtyKg: (parseFloat(r.balance.onHandQtyKg) - parseFloat(r.balance.reservedQtyKg) - parseFloat(r.balance.blockedQtyKg)).toFixed(3),
        version: r.balance.version,
      }));
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
                          <div className="text-xs text-muted-foreground">
                            <LtrValue>{b.itemCode}</LtrValue>
                          </div>
                        </td>
                        <td className="py-2 px-3">
                          <div className="font-medium">{b.locationName}</div>
                          <div className="text-xs text-muted-foreground">
                            <LtrValue>{b.locationCode}</LtrValue>
                          </div>
                        </td>
                        <td className="py-2 px-3">
                          <LtrValue className="font-bold">{b.availableQtyKg}</LtrValue>
                        </td>
                        <td className="py-2 px-3">
                          <LtrValue>{b.onHandQtyKg}</LtrValue>
                        </td>
                        <td className="py-2 px-3">
                          <LtrValue>{b.reservedQtyKg}</LtrValue>
                        </td>
                        <td className="py-2 px-3">
                          <LtrValue>{b.blockedQtyKg}</LtrValue>
                        </td>
                        <td className="py-2 px-3">
                          <LtrValue>{b.returnedQtyKg}</LtrValue>
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
