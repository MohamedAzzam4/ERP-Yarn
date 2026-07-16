/**
 * Management Inventory Reconciliation page — WP-08-01A.
 *
 * Route: /management/inventory/reconciliation
 *
 * Shows inventory reconciliation status — balance vs movement totals.
 * Owner/Accountant only. Negative stock and mismatches are visible.
 *
 * Contract 04 §17: Reconciliation compares movement totals vs on-hand.
 * Contract 04 §12: Negative stock is a visible alert, not normal behavior.
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
import { eq } from "drizzle-orm";

export default async function InventoryReconciliationPage() {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const managementRole = authResult.roles.find((r) => isManagementShellRole(r)) as RoleCode | undefined;
  if (!managementRole) redirect("/worker");

  const navCategories = getManagementNavForRole(managementRole);

  let reconResults: any[] = [];
  let dbAvailable = false;
  let negativeAlerts: any[] = [];

  if (db) {
    try {
      const ledgerRepo = new InventoryLedgerDbRepository(db);

      // Get all balances with item/location info
      const balanceRows = await db
        .select({
          balance: inventoryBalances,
          item: inventoryItems,
          location: locations,
        })
        .from(inventoryBalances)
        .innerJoin(inventoryItems, eq(inventoryBalances.itemId, inventoryItems.id))
        .innerJoin(locations, eq(inventoryBalances.locationId, locations.id))
        .where(eq(inventoryBalances.tenantId, authResult.tenantId));

      for (const row of balanceRows) {
        // Reconcile: compare on_hand vs sum of movements
        const movements = await ledgerRepo.listMovementsForBalance(
          authResult.tenantId,
          row.balance.itemId,
          row.balance.locationId,
        );

        // Calculate movement total (positive movements add, negative subtract)
        let movementTotal = 0;
        for (const m of movements) {
          const qty = parseFloat(m.quantityKg);
          if (m.toLocationId === row.balance.locationId) movementTotal += qty;
          if (m.fromLocationId === row.balance.locationId) movementTotal -= qty;
        }

        const onHand = parseFloat(row.balance.onHandQtyKg);
        const difference = onHand - movementTotal;
        const isMismatch = Math.abs(difference) > 0.001;
        const isNegative = onHand < 0 || movementTotal < 0;

        reconResults.push({
          itemCode: row.item.itemCode,
          itemName: row.item.displayNameEn,
          locationCode: row.location.locationCode,
          locationName: row.location.nameEn,
          onHandQtyKg: row.balance.onHandQtyKg,
          movementTotal: movementTotal.toFixed(3),
          difference: difference.toFixed(3),
          isMismatch,
          isNegative,
          movementCount: movements.length,
        });

        if (isNegative) {
          negativeAlerts.push({
            itemName: row.item.displayNameEn,
            locationName: row.location.nameEn,
            onHandQtyKg: row.balance.onHandQtyKg,
          });
        }
      }
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
        <h1 className="text-2xl font-bold mb-6">التسوية والمراجعة</h1>

        {/* Negative stock alerts — Contract 04 §12 */}
        {dbAvailable && negativeAlerts.length > 0 && (
          <Card className="mb-4 border-red-300 bg-red-50">
            <CardHeader>
              <CardTitle className="text-red-700">⚠ تنبيهات المخزون السالب</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-red-600 mb-2">
                يوجد مخزون سالب — يجب مراجعته. المخزون السالب ليس سلوكاً طبيعياً.
              </p>
              {negativeAlerts.map((a, i) => (
                <div key={i} className="text-sm">
                  {a.itemName} — {a.locationName}: <LtrValue className="font-bold text-red-700">{a.onHandQtyKg}</LtrValue> كجم
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {!dbAvailable && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              قاعدة البيانات غير متاحة.
            </CardContent>
          </Card>
        )}

        {dbAvailable && reconResults.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              لا توجد أرصدة للمراجعة.
            </CardContent>
          </Card>
        )}

        {dbAvailable && reconResults.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>مراجعة الأرصدة مقابل الحركات</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-right">
                      <th className="py-2 px-3">الصنف</th>
                      <th className="py-2 px-3">الموقع</th>
                      <th className="py-2 px-3">الرصيد الفعلي</th>
                      <th className="py-2 px-3">مجموع الحركات</th>
                      <th className="py-2 px-3">الفرق</th>
                      <th className="py-2 px-3">عدد الحركات</th>
                      <th className="py-2 px-3">الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reconResults.map((r, i) => (
                      <tr key={i} className={`border-b ${r.isMismatch ? "bg-yellow-50" : ""} ${r.isNegative ? "bg-red-50" : ""}`}>
                        <td className="py-2 px-3">
                          <div className="font-medium">{r.itemName}</div>
                          <div className="text-xs text-muted-foreground">
                            <LtrValue>{r.itemCode}</LtrValue>
                          </div>
                        </td>
                        <td className="py-2 px-3">{r.locationName}</td>
                        <td className="py-2 px-3">
                          <LtrValue className={r.isNegative ? "font-bold text-red-700" : ""}>{r.onHandQtyKg}</LtrValue>
                        </td>
                        <td className="py-2 px-3">
                          <LtrValue>{r.movementTotal}</LtrValue>
                        </td>
                        <td className="py-2 px-3">
                          <LtrValue className={r.isMismatch ? "font-bold text-yellow-700" : ""}>{r.difference}</LtrValue>
                        </td>
                        <td className="py-2 px-3">
                          <LtrValue>{r.movementCount}</LtrValue>
                        </td>
                        <td className="py-2 px-3">
                          {r.isNegative ? (
                            <span className="text-red-600 font-bold">سالب</span>
                          ) : r.isMismatch ? (
                            <span className="text-yellow-600 font-bold">اختلاف</span>
                          ) : (
                            <span className="text-green-600">متطابق</span>
                          )}
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
