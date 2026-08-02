/**
 * Management Production Orders page — WP-08-01B.
 *
 * Contract 10 §8.3: Production/WIP Management Screens.
 *   Review/approve production issue, partial receipt, waste, WIP, rate snapshot,
 *   payable, lineage, and corrections. Management Console.
 *
 * Full operational + financial snapshot fields (rate, cost basis, payable).
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
import { ProductionScreenQueryService, type ManagementProductionOrderDto } from "@/server/services/production-screen-query-service";

export default async function ManagementProductionOrdersPage() {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const managementRole = authResult.roles.find((r) => isManagementShellRole(r)) as RoleCode | undefined;
  if (!managementRole) redirect("/worker");

  const navCategories = getManagementNavForRole(managementRole);

  let orders: ManagementProductionOrderDto[] = [];
  let dbAvailable = false;

  if (db) {
    try {
      const queryService = new ProductionScreenQueryService(db);
      orders = await queryService.listManagementProductionOrders(authResult.tenantId);
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
        <h1 className="text-2xl font-bold mb-6">أوامر الإنتاج</h1>

        {!dbAvailable && (
          <Card><CardContent className="py-8 text-center text-muted-foreground">قاعدة البيانات غير متاحة.</CardContent></Card>
        )}

        {dbAvailable && orders.length === 0 && (
          <Card><CardContent className="py-8 text-center text-muted-foreground">لا توجد أوامر إنتاج مسجلة.</CardContent></Card>
        )}

        {dbAvailable && orders.length > 0 && (
          <Card>
            <CardHeader><CardTitle>الأوامر الحالية</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-right">
                      <th className="py-2 px-3">رقم المستند</th>
                      <th className="py-2 px-3">المصنع</th>
                      <th className="py-2 px-3">النوع</th>
                      <th className="py-2 px-3">الحالة</th>
                      <th className="py-2 px-3">المدخلات (كجم)</th>
                      <th className="py-2 px-3">المخرجات (كجم)</th>
                      <th className="py-2 px-3">الهدر (كجم)</th>
                      <th className="py-2 px-3">أساس التكلفة</th>
                      <th className="py-2 px-3">السعر/طن</th>
                      <th className="py-2 px-3">التكلفة المحسوبة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.id} className="border-b">
                        <td className="py-2 px-3"><LtrValue>{o.docNo}</LtrValue></td>
                        <td className="py-2 px-3">{o.factoryName}</td>
                        <td className="py-2 px-3">{o.productionType}</td>
                        <td className="py-2 px-3">{o.status}</td>
                        <td className="py-2 px-3"><LtrValue>{o.totalInputQtyKg}</LtrValue></td>
                        <td className="py-2 px-3"><LtrValue>{o.totalOutputQtyKg}</LtrValue></td>
                        <td className="py-2 px-3"><LtrValue>{o.totalWasteQtyKg}</LtrValue></td>
                        <td className="py-2 px-3">{o.factoryCostBasisUsed ? <LtrValue>{o.factoryCostBasisUsed}</LtrValue> : "—"}</td>
                        <td className="py-2 px-3">{o.factoryRatePerInputTonUsed ? <LtrValue>{o.factoryRatePerInputTonUsed}</LtrValue> : "—"}</td>
                        <td className="py-2 px-3">{o.calculatedFactoryCost ? <LtrValue>{o.calculatedFactoryCost}</LtrValue> : "—"}</td>
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
