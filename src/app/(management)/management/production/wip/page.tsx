/**
 * Management WIP (Work-In-Progress) page — WP-08-01B.
 *
 * Contract 10 §8.3: Production/WIP Management Screens.
 *   Review WIP reconciliation, output/waste, confirmed rate and cost basis,
 *   posted payable, review/correction state. WIP return review/approval state.
 *   Management Console. Full operational + financial fields.
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
import {
  ProductionScreenQueryService,
  type ManagementWipBalanceDto,
  type ManagementWipReturnDto,
} from "@/server/services/production-screen-query-service";

export default async function ManagementWipPage() {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const managementRole = authResult.roles.find((r) => isManagementShellRole(r)) as RoleCode | undefined;
  if (!managementRole) redirect("/worker");

  const navCategories = getManagementNavForRole(managementRole);

  let wipBalances: ManagementWipBalanceDto[] = [];
  let wipReturns: ManagementWipReturnDto[] = [];
  let dbAvailable = false;

  if (db) {
    try {
      const queryService = new ProductionScreenQueryService(db);
      wipBalances = await queryService.listManagementWipBalances(authResult.tenantId);
      wipReturns = await queryService.listManagementWipReturns(authResult.tenantId);
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
        <h1 className="text-2xl font-bold mb-6">المخزون تحت التشغيل</h1>

        {!dbAvailable && (
          <Card><CardContent className="py-8 text-center text-muted-foreground">قاعدة البيانات غير متاحة.</CardContent></Card>
        )}

        {dbAvailable && (
          <>
            {/* WIP Balances — full operational + financial (includes factory/order IDs) */}
            <Card className="mb-6">
              <CardHeader><CardTitle>أرصدة تحت التشغيل</CardTitle></CardHeader>
              <CardContent>
                {wipBalances.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">لا يوجد مخزون تحت التشغيل.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-right">
                          <th className="py-2 px-3">أمر الإنتاج</th>
                          <th className="py-2 px-3">الصنف</th>
                          <th className="py-2 px-3">المصنع</th>
                          <th className="py-2 px-3">الكمية المتبقية (كجم)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {wipBalances.map((w) => (
                          <tr key={w.id} className="border-b">
                            <td className="py-2 px-3"><LtrValue>{w.productionOrderDocNo}</LtrValue></td>
                            <td className="py-2 px-3"><LtrValue>{w.itemCode}</LtrValue> {w.itemName}</td>
                            <td className="py-2 px-3">{w.factoryName}</td>
                            <td className="py-2 px-3"><LtrValue>{w.remainingWipQtyKg}</LtrValue></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* WIP Return Requests — review/approval state + financial review status */}
            <Card>
              <CardHeader><CardTitle>طلبات مرتجع تحت التشغيل</CardTitle></CardHeader>
              <CardContent>
                {wipReturns.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">لا توجد طلبات مرتجع من تحت التشغيل.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-right">
                          <th className="py-2 px-3">رقم المستند</th>
                          <th className="py-2 px-3">أمر الإنتاج</th>
                          <th className="py-2 px-3">الصنف</th>
                          <th className="py-2 px-3">الكمية (كجم)</th>
                          <th className="py-2 px-3">الموقع</th>
                          <th className="py-2 px-3">الحالة</th>
                          <th className="py-2 px-3">حالة المراجعة المالية</th>
                          <th className="py-2 px-3">السبب</th>
                        </tr>
                      </thead>
                      <tbody>
                        {wipReturns.map((wr) => (
                          <tr key={wr.id} className="border-b">
                            <td className="py-2 px-3"><LtrValue>{wr.docNo}</LtrValue></td>
                            <td className="py-2 px-3"><LtrValue>{wr.productionOrderDocNo}</LtrValue></td>
                            <td className="py-2 px-3"><LtrValue>{wr.itemCode}</LtrValue></td>
                            <td className="py-2 px-3"><LtrValue>{wr.returnQtyKg}</LtrValue></td>
                            <td className="py-2 px-3"><LtrValue>{wr.returnLocationCode}</LtrValue></td>
                            <td className="py-2 px-3">{wr.status}</td>
                            <td className="py-2 px-3">{wr.financialReviewStatus ?? "—"}</td>
                            <td className="py-2 px-3">{wr.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </Container>
    </ManagementShell>
  );
}
