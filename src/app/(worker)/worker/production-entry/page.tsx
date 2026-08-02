/**
 * Worker Production Entry page — WP-08-01B.
 *
 * Contract 10 §7.2: Production Employee Screens.
 *   Records production order/issue/receipt/waste/WIP-return operational facts.
 *   Worker Task Mode. Operational quantities ONLY — NO financial fields.
 *
 * Contract 05: No worker-entered payable, allocation, profitability or accounting entry.
 * Contract 11 §8/§9: Worker financial-deny is absolute.
 *
 * Visible: production type, factory, input lot/item, planned/issued/input/output/
 *          waste/returned quantities, output lot facts, dates, WIP status, operational notes.
 * Hidden: factory rate/payable, cost basis, direct-cost allocation, payer, account entry, profitability.
 * Allowed: create/update/submit own drafts; request return from WIP.
 * Forbidden: issue/receipt financial posting, approve WIP return, change snapshots/rates.
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
import { inventoryItems, locations, externalFactories, productionOrders, productionInputs } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import {
  ProductionScreenQueryService,
  type WorkerProductionOrderDto,
  type WorkerWipBalanceDto,
  type WorkerWipReturnDto,
  type WorkerProductionInputDto,
} from "@/server/services/production-screen-query-service";
import { createWipReturnRequest } from "./actions";

export default async function WorkerProductionEntryPage() {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const workerRole = authResult.roles.find((r) => r !== "owner" && r !== "accountant") as RoleCode | undefined;
  if (!workerRole) redirect("/management");

  // Only production_employee can access this page
  if (workerRole !== "production_employee") redirect("/worker");

  const tasks = getWorkerTasksForRole(workerRole);

  let orders: WorkerProductionOrderDto[] = [];
  let wipBalances: WorkerWipBalanceDto[] = [];
  let wipReturns: WorkerWipReturnDto[] = [];
  let inputs: WorkerProductionInputDto[] = [];
  let dbAvailable = false;

  // Form data: items, locations for dropdowns
  let formItems: { id: string; code: string; name: string }[] = [];
  let formLocations: { id: string; code: string; name: string }[] = [];

  if (db) {
    try {
      const queryService = new ProductionScreenQueryService(db);
      orders = await queryService.listWorkerProductionOrders(authResult.tenantId);
      wipBalances = await queryService.listWorkerWipBalances(authResult.tenantId);
      wipReturns = await queryService.listWorkerWipReturns(authResult.tenantId);

      // Fetch production inputs for issued orders (for the WIP return form)
      if (orders.length > 0) {
        const issuedOrders = orders.filter((o) => o.status === "material_issued" || o.status === "partially_received");
        if (issuedOrders.length > 0) {
          inputs = await queryService.listWorkerProductionInputs(authResult.tenantId, issuedOrders[0]!.id);
        }
      }

      // Load items + locations for form dropdowns
      const itemRows = await db.select().from(inventoryItems).where(eq(inventoryItems.tenantId, authResult.tenantId));
      formItems = itemRows.map((r) => ({ id: r.id, code: r.itemCode, name: r.displayNameEn || r.displayNameAr }));
      const locRows = await db.select().from(locations).where(eq(locations.tenantId, authResult.tenantId));
      formLocations = locRows.map((r) => ({ id: r.id, code: r.locationCode, name: r.nameEn || r.locationCode }));

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
        <h1 className="text-xl font-bold mb-4">تسجيل الإنتاج</h1>

        {!dbAvailable && (
          <Card><CardContent className="py-8 text-center text-muted-foreground">قاعدة البيانات غير متاحة.</CardContent></Card>
        )}

        {dbAvailable && (
          <>
            {/* Production Orders — operational quantities only, NO financial */}
            <Card className="mb-6">
              <CardHeader><CardTitle>أوامر الإنتاج</CardTitle></CardHeader>
              <CardContent>
                {orders.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">لا توجد أوامر إنتاج مسجلة.</p>
                ) : (
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
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Production Inputs — issued/consumed/returned operational quantities */}
            {inputs.length > 0 && (
              <Card className="mb-6">
                <CardHeader><CardTitle>مدخلات الإنتاج (أول أمر مُصدر)</CardTitle></CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-right">
                          <th className="py-2 px-3">الصنف</th>
                          <th className="py-2 px-3">الموقع</th>
                          <th className="py-2 px-3">المخطط (كجم)</th>
                          <th className="py-2 px-3">المصروف (كجم)</th>
                          <th className="py-2 px-3">المستهلك (كجم)</th>
                          <th className="py-2 px-3">المرتجع (كجم)</th>
                          <th className="py-2 px-3">متبقي تحت التشغيل (كجم)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inputs.map((i) => (
                          <tr key={i.id} className="border-b">
                            <td className="py-2 px-3"><LtrValue>{i.itemCode}</LtrValue> {i.itemName}</td>
                            <td className="py-2 px-3"><LtrValue>{i.locationCode}</LtrValue></td>
                            <td className="py-2 px-3"><LtrValue>{i.plannedInputQtyKg}</LtrValue></td>
                            <td className="py-2 px-3"><LtrValue>{i.issuedQtyKg}</LtrValue></td>
                            <td className="py-2 px-3"><LtrValue>{i.consumedQtyKg}</LtrValue></td>
                            <td className="py-2 px-3"><LtrValue>{i.returnedFromWipQtyKg}</LtrValue></td>
                            <td className="py-2 px-3"><LtrValue>{i.remainingWipQtyKg}</LtrValue></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* WIP Balances — operational quantities only, NO financial */}
            <Card className="mb-6">
              <CardHeader><CardTitle>المخزون تحت التشغيل</CardTitle></CardHeader>
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

            {/* WIP Return Request Form — Contract 10 §7.2: "request return from WIP" */}
            <Card className="mb-6">
              <CardHeader><CardTitle>طلب مرتجع من تحت التشغيل</CardTitle></CardHeader>
              <CardContent>
                <form action={createWipReturnRequest} className="space-y-4 max-w-md">
                  {/* Production order selector */}
                  <div>
                    <label htmlFor="productionOrderId" className="block text-sm font-medium mb-1">أمر الإنتاج</label>
                    <select id="productionOrderId" name="productionOrderId" required className="w-full p-2 border rounded" style={{ minHeight: "44px" }}>
                      <option value="">اختر أمر الإنتاج</option>
                      {orders.filter((o) => o.status === "material_issued" || o.status === "partially_received").map((o) => (
                        <option key={o.id} value={o.id}><LtrValue>{o.docNo}</LtrValue></option>
                      ))}
                    </select>
                  </div>

                  {/* Production input selector (hidden — populated client-side from selected order) */}
                  <div>
                    <label htmlFor="productionInputId" className="block text-sm font-medium mb-1">المدخل</label>
                    <select id="productionInputId" name="productionInputId" required className="w-full p-2 border rounded" style={{ minHeight: "44px" }}>
                      <option value="">اختر المدخل</option>
                      {inputs.map((i) => (
                        <option key={i.id} value={i.id}><LtrValue>{i.itemCode}</LtrValue> ({i.remainingWipQtyKg}kg WIP)</option>
                      ))}
                    </select>
                  </div>

                  {/* Return quantity */}
                  <div>
                    <label htmlFor="returnQtyKg" className="block text-sm font-medium mb-1">الكمية المرتجعة (كجم)</label>
                    <input id="returnQtyKg" name="returnQtyKg" type="text" required dir="ltr" inputMode="decimal" pattern="[0-9]+(\.[0-9]+)?" placeholder="0.000" className="w-full p-2 border rounded" style={{ minHeight: "44px" }} />
                  </div>

                  {/* Return location */}
                  <div>
                    <label htmlFor="returnLocationId" className="block text-sm font-medium mb-1">موقع الاستلام</label>
                    <select id="returnLocationId" name="returnLocationId" required className="w-full p-2 border rounded" style={{ minHeight: "44px" }}>
                      <option value="">اختر الموقع</option>
                      {formLocations.map((l) => (
                        <option key={l.id} value={l.id}>{l.name} (<LtrValue>{l.code}</LtrValue>)</option>
                      ))}
                    </select>
                  </div>

                  {/* Reason */}
                  <div>
                    <label htmlFor="reason" className="block text-sm font-medium mb-1">السبب</label>
                    <textarea id="reason" name="reason" rows={2} required className="w-full p-2 border rounded" placeholder="وصف سبب الإرجاع" style={{ minHeight: "44px" }} />
                  </div>

                  {/* Notes (optional) */}
                  <div>
                    <label htmlFor="notes" className="block text-sm font-medium mb-1">ملاحظات (اختياري)</label>
                    <textarea id="notes" name="notes" rows={2} className="w-full p-2 border rounded" placeholder="ملاحظات إضافية" />
                  </div>

                  <p className="text-xs text-muted-foreground mt-1">المعالجة المالية والموافقة يتطلبها الإدارة.</p>

                  <button type="submit" className="w-full bg-primary text-primary-foreground rounded p-3 font-medium" style={{ minHeight: "44px" }}>طلب الإرجاع</button>
                </form>
              </CardContent>
            </Card>

            {/* WIP Return Requests — worker can view own requests, NO financial review status */}
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
    </WorkerShell>
  );
}
