/**
 * Worker Stock Balance page — WP-08-01A.
 * Uses InventoryScreenQueryService for role-safe worker DTOs.
 * Operational quantities ONLY — NO financial fields (DEC-063, Contract 11 §8).
 */
import { redirect } from "next/navigation";
import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { WorkerShell } from "@/components/shells/worker-shell";
import { getWorkerTasksForRole } from "@/components/shells/nav-config";
import { signOut } from "@/app/login/actions";
import { requireWorkerQuantityActor } from "@/server/security/inventory-guards";
import type { RoleCode } from "@/server/security/role-codes";
import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LtrValue } from "@/components/ui/ltr-value";
import { db } from "@/server/db/client";
import { InventoryScreenQueryService, type WorkerBalanceDto } from "@/server/services/inventory-screen-query-service";

export default async function WorkerStockBalancePage() {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const workerRole = authResult.roles.find((r) => r !== "owner" && r !== "accountant") as RoleCode | undefined;
  if (!workerRole) redirect("/management");

  // Explicit allowlist guard — quality/unknown denied before any query
  requireWorkerQuantityActor(authResult as any, authResult.roles);

  const tasks = getWorkerTasksForRole(workerRole);

  let balances: WorkerBalanceDto[] = [];
  let dbAvailable = false;

  if (db) {
    try {
      const queryService = new InventoryScreenQueryService(db);
      // Worker-safe DTO: operational quantities ONLY, no financial fields
      balances = await queryService.listWorkerBalances(authResult.tenantId);
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
          <Card><CardContent className="py-8 text-center text-muted-foreground">قاعدة البيانات غير متاحة.</CardContent></Card>
        )}

        {dbAvailable && balances.length === 0 && (
          <Card><CardContent className="py-8 text-center text-muted-foreground">لا توجد أرصدة مخزون.</CardContent></Card>
        )}

        {dbAvailable && balances.length > 0 && (
          <Card>
            <CardHeader><CardTitle>الأرصدة المتاحة</CardTitle></CardHeader>
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
                        <td className="py-2 px-3"><div className="font-medium">{b.itemName}</div><div className="text-xs text-muted-foreground"><LtrValue>{b.itemCode}</LtrValue></div></td>
                        <td className="py-2 px-3">{b.locationName}</td>
                        <td className="py-2 px-3"><LtrValue className="font-bold">{b.availableQtyKg}</LtrValue></td>
                        <td className="py-2 px-3"><LtrValue>{b.onHandQtyKg}</LtrValue></td>
                        <td className="py-2 px-3"><LtrValue>{b.reservedQtyKg}</LtrValue></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">تعرض هذه الشاشة الكميات التشغيلية فقط. للتفاصيل المالية، راجع الإدارة.</p>
            </CardContent>
          </Card>
        )}
      </Container>
    </WorkerShell>
  );
}
