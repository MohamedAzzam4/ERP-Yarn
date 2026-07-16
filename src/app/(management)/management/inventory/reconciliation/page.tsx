/**
 * Management Inventory Reconciliation page — WP-08-01A.
 * Uses InventoryScreenQueryService for reconciliation DTOs.
 * Negative stock alerts are visible (Contract 04 §12).
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
import { InventoryScreenQueryService, type ManagementReconciliationDto, type NegativeStockAlertDto } from "@/server/services/inventory-screen-query-service";

export default async function InventoryReconciliationPage() {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const managementRole = authResult.roles.find((r) => isManagementShellRole(r)) as RoleCode | undefined;
  if (!managementRole) redirect("/worker");

  const navCategories = getManagementNavForRole(managementRole);

  let reconResults: ManagementReconciliationDto[] = [];
  let negativeAlerts: NegativeStockAlertDto[] = [];
  let dbAvailable = false;

  if (db) {
    try {
      const queryService = new InventoryScreenQueryService(db);
      const recon = await queryService.listReconciliation(authResult.tenantId);
      reconResults = recon.results;
      negativeAlerts = recon.negativeAlerts;
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

        {dbAvailable && negativeAlerts.length > 0 && (
          <Card className="mb-4 border-red-300 bg-red-50">
            <CardHeader><CardTitle className="text-red-700">⚠ تنبيهات المخزون السالب</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm text-red-600 mb-2">يوجد مخزون سالب — يجب مراجعته. المخزون السالب ليس سلوكاً طبيعياً.</p>
              {negativeAlerts.map((a, i) => (
                <div key={i} className="text-sm">{a.itemName} — {a.locationName}: <LtrValue className="font-bold text-red-700">{a.onHandQtyKg}</LtrValue> كجم</div>
              ))}
            </CardContent>
          </Card>
        )}

        {!dbAvailable && (
          <Card><CardContent className="py-8 text-center text-muted-foreground">قاعدة البيانات غير متاحة.</CardContent></Card>
        )}

        {dbAvailable && reconResults.length === 0 && (
          <Card><CardContent className="py-8 text-center text-muted-foreground">لا توجد أرصدة للمراجعة.</CardContent></Card>
        )}

        {dbAvailable && reconResults.length > 0 && (
          <Card>
            <CardHeader><CardTitle>مراجعة الأرصدة مقابل الحركات</CardTitle></CardHeader>
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
                        <td className="py-2 px-3"><div className="font-medium">{r.itemName}</div><div className="text-xs text-muted-foreground"><LtrValue>{r.itemCode}</LtrValue></div></td>
                        <td className="py-2 px-3">{r.locationName}</td>
                        <td className="py-2 px-3"><LtrValue className={r.isNegative ? "font-bold text-red-700" : ""}>{r.onHandQtyKg}</LtrValue></td>
                        <td className="py-2 px-3"><LtrValue>{r.movementTotal}</LtrValue></td>
                        <td className="py-2 px-3"><LtrValue className={r.isMismatch ? "font-bold text-yellow-700" : ""}>{r.difference}</LtrValue></td>
                        <td className="py-2 px-3"><LtrValue>{r.movementCount}</LtrValue></td>
                        <td className="py-2 px-3">{r.isNegative ? <span className="text-red-600 font-bold">سالب</span> : r.isMismatch ? <span className="text-yellow-600 font-bold">اختلاف</span> : <span className="text-green-600">متطابق</span>}</td>
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
