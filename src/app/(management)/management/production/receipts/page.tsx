/**
 * Management Production Receipts page — WP-08-01B.
 *
 * Contract 10 §8.3: Production/WIP Management Screens.
 *   Review/approve production issue, partial receipt, waste, WIP, rate snapshot,
 *   payable, lineage, and corrections.
 *
 * Shows receipts with financial snapshot fields (rate, cost basis, payable)
 * + input allocation review (consumed/waste/payable cost basis quantities).
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
  type ManagementReceiptDto,
  type ManagementReceiptAllocationDto,
} from "@/server/services/production-screen-query-service";

export default async function ManagementProductionReceiptsPage() {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const managementRole = authResult.roles.find((r) => isManagementShellRole(r)) as RoleCode | undefined;
  if (!managementRole) redirect("/worker");

  const navCategories = getManagementNavForRole(managementRole);

  let receipts: ManagementReceiptDto[] = [];
  let allocations: ManagementReceiptAllocationDto[] = [];
  let dbAvailable = false;

  if (db) {
    try {
      const queryService = new ProductionScreenQueryService(db);
      receipts = await queryService.listManagementReceipts(authResult.tenantId);
      // If there's at least one receipt, fetch its allocations for the allocation review section
      if (receipts.length > 0) {
        allocations = await queryService.listManagementReceiptAllocations(authResult.tenantId, receipts[0]!.id);
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
        <h1 className="text-2xl font-bold mb-6">سندات استلام الإنتاج</h1>

        {!dbAvailable && (
          <Card><CardContent className="py-8 text-center text-muted-foreground">قاعدة البيانات غير متاحة.</CardContent></Card>
        )}

        {dbAvailable && receipts.length === 0 && (
          <Card><CardContent className="py-8 text-center text-muted-foreground">لا توجد سندات استلام إنتاج مسجلة.</CardContent></Card>
        )}

        {dbAvailable && receipts.length > 0 && (
          <>
            {/* Receipts with financial snapshot fields */}
            <Card className="mb-6">
              <CardHeader><CardTitle>السندات الحالية</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-right">
                        <th className="py-2 px-3">رقم المستند</th>
                        <th className="py-2 px-3">أمر الإنتاج</th>
                        <th className="py-2 px-3">الصنف المُنتج</th>
                        <th className="py-2 px-3">الموقع</th>
                        <th className="py-2 px-3">الكمية (كجم)</th>
                        <th className="py-2 px-3">التاريخ</th>
                        <th className="py-2 px-3">الحالة</th>
                        <th className="py-2 px-3">أساس التكلفة</th>
                        <th className="py-2 px-3">السعر/طن</th>
                        <th className="py-2 px-3">التكلفة المحسوبة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {receipts.map((r) => (
                        <tr key={r.id} className="border-b">
                          <td className="py-2 px-3"><LtrValue>{r.docNo}</LtrValue></td>
                          <td className="py-2 px-3"><LtrValue>{r.productionOrderDocNo}</LtrValue></td>
                          <td className="py-2 px-3"><LtrValue>{r.outputItemCode}</LtrValue></td>
                          <td className="py-2 px-3"><LtrValue>{r.outputLocationCode}</LtrValue></td>
                          <td className="py-2 px-3"><LtrValue>{r.outputQtyKg}</LtrValue></td>
                          <td className="py-2 px-3"><LtrValue>{r.receiptDate}</LtrValue></td>
                          <td className="py-2 px-3">{r.status}</td>
                          <td className="py-2 px-3">{r.factoryCostBasisUsed ? <LtrValue>{r.factoryCostBasisUsed}</LtrValue> : "—"}</td>
                          <td className="py-2 px-3">{r.factoryRatePerInputTonUsed ? <LtrValue>{r.factoryRatePerInputTonUsed}</LtrValue> : "—"}</td>
                          <td className="py-2 px-3">{r.calculatedFactoryCost ? <LtrValue>{r.calculatedFactoryCost}</LtrValue> : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Allocation review — consumed/waste/payable cost basis per input */}
            {allocations.length > 0 && (
              <Card>
                <CardHeader><CardTitle>توزيع المدخلات (أول سند)</CardTitle></CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-right">
                          <th className="py-2 px-3">الصنف</th>
                          <th className="py-2 px-3">المستهلك (كجم)</th>
                          <th className="py-2 px-3">الهدر (كجم)</th>
                          <th className="py-2 px-3">أساس التكلفة (كجم)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allocations.map((a) => (
                          <tr key={a.id} className="border-b">
                            <td className="py-2 px-3"><LtrValue>{a.itemCode}</LtrValue></td>
                            <td className="py-2 px-3"><LtrValue>{a.consumedQtyKg}</LtrValue></td>
                            <td className="py-2 px-3"><LtrValue>{a.wasteQtyKg}</LtrValue></td>
                            <td className="py-2 px-3"><LtrValue>{a.payableCostBasisQtyKg}</LtrValue></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </Container>
    </ManagementShell>
  );
}
