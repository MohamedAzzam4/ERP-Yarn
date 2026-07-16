/**
 * Worker Stock Balance page — WP-08-01A.
 *
 * Route: /worker/stock-balance
 *
 * Shows inventory balances for warehouse/production workers.
 * Operational quantities only — NO financial fields (price, cost, value).
 * Contract 11 §8: Worker financial-deny is absolute (DEC-063).
 * Contract 11 §9: Workers enter/receive operational facts only.
 *
 * Role-safe: only on_hand, reserved, available shown.
 * blocked/returned/financial fields are NOT shown to workers.
 */
import { redirect } from "next/navigation";
import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { WorkerShell } from "@/components/shells/worker-shell";
import { getWorkerTasksForRole } from "@/components/shells/nav-config";
import { signOut } from "@/app/login/actions";
import type { RoleCode } from "@/server/security/role-codes";
import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LtrValue } from "@/components/ui/ltr-value";
import { db } from "@/server/db/client";
import { inventoryBalances, inventoryItems, locations } from "@/server/db/schema";
import { eq } from "drizzle-orm";

export default async function WorkerStockBalancePage() {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const workerRole = authResult.roles.find((r) => !r.match(/^(owner|accountant)$/)) as RoleCode | undefined;
  if (!workerRole) redirect("/management");

  const tasks = getWorkerTasksForRole(workerRole);

  let balances: any[] = [];
  let dbAvailable = false;

  if (db) {
    try {
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

      // Worker-safe DTO: operational quantities ONLY, no financial fields
      balances = results.map((r) => ({
        itemCode: r.item.itemCode,
        itemName: r.item.displayNameEn,
        locationCode: r.location.locationCode,
        locationName: r.location.nameEn,
        onHandQtyKg: r.balance.onHandQtyKg,
        reservedQtyKg: r.balance.reservedQtyKg,
        availableQtyKg: (parseFloat(r.balance.onHandQtyKg) - parseFloat(r.balance.reservedQtyKg) - parseFloat(r.balance.blockedQtyKg)).toFixed(3),
        // NOTE: blocked_qty_kg, returned_qty_kg, and all financial fields
        // are deliberately excluded for worker roles (DEC-063, Contract 11 §8).
      }));
      dbAvailable = true;
    } catch { dbAvailable = false; }
  }

  return (
    <WorkerShell
      userName={authResult.name || authResult.email}
      tasks={tasks}
      onSignOut={async () => { "use server"; await signOut(); }}
    >
      <Container>
        <h1 className="text-xl font-bold mb-4">أرصدة المخزون</h1>

        {!dbAvailable && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              قاعدة البيانات غير متاحة.
            </CardContent>
          </Card>
        )}

        {dbAvailable && balances.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              لا توجد أرصدة مخزون.
            </CardContent>
          </Card>
        )}

        {dbAvailable && balances.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>الأرصدة المتاحة</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-right">
                      <th className="py-2 px-3">الصنف</th>
                      <th className="py-2 px-3">الموقع</th>
                      <th className="py-2 px-3">المتاح</th>
                      <th className="py-2 px-3">الفعلي</th>
                      <th className="py-2 px-3">المحجوز</th>
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
                        <td className="py-2 px-3">{b.locationName}</td>
                        <td className="py-2 px-3">
                          <LtrValue className="font-bold">{b.availableQtyKg}</LtrValue>
                        </td>
                        <td className="py-2 px-3">
                          <LtrValue>{b.onHandQtyKg}</LtrValue>
                        </td>
                        <td className="py-2 px-3">
                          <LtrValue>{b.reservedQtyKg}</LtrValue>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Worker note: financial fields deliberately hidden */}
              <p className="mt-4 text-xs text-muted-foreground">
                تعرض هذه الشاشة الكميات التشغيلية فقط. للتفاصيل المالية، راجع الإدارة.
              </p>
            </CardContent>
          </Card>
        )}
      </Container>
    </WorkerShell>
  );
}
