/**
 * Worker Production Entry page — WP-08-01B.
 *
 * Contract 10 §7.2: Production Employee Screens.
 *   Records production order/issue/receipt/waste/WIP-return operational facts.
 *   Worker Task Mode. Operational quantities ONLY — NO financial fields.
 *
 * Three worker actions (all wire to existing domain services):
 * 1. createProductionDraft → ProductionIssueService.createProductionOrder
 * 2. createReceiptDraft → ProductionReceiptDraftService.createReceiptDraft
 * 3. createWipReturnRequest → WipReturnRequestService.createRequest
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
import { inventoryItems, locations, externalFactories } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import {
  ProductionScreenQueryService,
  type WorkerProductionOrderDto,
  type WorkerWipBalanceDto,
  type WorkerWipReturnDto,
  type WorkerProductionInputDto,
} from "@/server/services/production-screen-query-service";
import { createProductionDraft, createReceiptDraft, createWipReturnRequest } from "./actions";

export default async function WorkerProductionEntryPage() {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const workerRole = authResult.roles.find((r) => r !== "owner" && r !== "accountant") as RoleCode | undefined;
  if (!workerRole) redirect("/management");
  if (workerRole !== "production_employee") redirect("/worker");

  const tasks = getWorkerTasksForRole(workerRole);

  let orders: WorkerProductionOrderDto[] = [];
  let wipBalances: WorkerWipBalanceDto[] = [];
  let wipReturns: WorkerWipReturnDto[] = [];
  let inputs: WorkerProductionInputDto[] = [];
  let dbAvailable = false;

  let formItems: { id: string; code: string; name: string }[] = [];
  let formLocations: { id: string; code: string; name: string }[] = [];
  let formFactories: { id: string; name: string }[] = [];

  if (db) {
    try {
      const queryService = new ProductionScreenQueryService(db);
      orders = await queryService.listWorkerProductionOrders(authResult.tenantId);
      wipBalances = await queryService.listWorkerWipBalances(authResult.tenantId);
      wipReturns = await queryService.listWorkerWipReturns(authResult.tenantId);

      const issuedOrders = orders.filter((o) => o.status === "material_issued" || o.status === "partially_received");
      if (issuedOrders.length > 0) {
        inputs = await queryService.listWorkerProductionInputs(authResult.tenantId, issuedOrders[0]!.id);
      }

      const itemRows = await db.select().from(inventoryItems).where(eq(inventoryItems.tenantId, authResult.tenantId));
      formItems = itemRows.map((r) => ({ id: r.id, code: r.itemCode, name: r.displayNameEn || r.displayNameAr }));
      const locRows = await db.select().from(locations).where(eq(locations.tenantId, authResult.tenantId));
      formLocations = locRows.map((r) => ({ id: r.id, code: r.locationCode, name: r.nameEn || r.locationCode }));
      const facRows = await db.select().from(externalFactories).where(eq(externalFactories.tenantId, authResult.tenantId));
      formFactories = facRows.map((r) => ({ id: r.id, name: r.nameEn || r.nameAr }));

      dbAvailable = true;
    } catch { dbAvailable = false; }
  }

  const issuedOrders = orders.filter((o) => o.status === "material_issued" || o.status === "partially_received");

  return (
    <WorkerShell userName={authResult.name || authResult.email} tasks={tasks} onSignOut={async () => { "use server"; await signOut(); }}>
      <Container>
        <h1 className="text-xl font-bold mb-4">تسجيل الإنتاج</h1>

        {!dbAvailable && (
          <Card><CardContent className="py-8 text-center text-muted-foreground">قاعدة البيانات غير متاحة.</CardContent></Card>
        )}

        {dbAvailable && (
          <>
            {/* Production Orders table */}
            <Card className="mb-6">
              <CardHeader><CardTitle>أوامر الإنتاج</CardTitle></CardHeader>
              <CardContent>
                {orders.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">لا توجد أوامر إنتاج مسجلة.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b text-right">
                        <th className="py-2 px-3">رقم المستند</th><th className="py-2 px-3">المصنع</th>
                        <th className="py-2 px-3">النوع</th><th className="py-2 px-3">الحالة</th>
                        <th className="py-2 px-3">المدخلات (كجم)</th><th className="py-2 px-3">المخرجات (كجم)</th>
                        <th className="py-2 px-3">الهدر (كجم)</th>
                      </tr></thead>
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

            {/* Form 1: Create Production Order Draft */}
            <Card className="mb-6">
              <CardHeader><CardTitle>إنشاء أمر إنتاج جديد</CardTitle></CardHeader>
              <CardContent>
                <form action={createProductionDraft} className="space-y-4 max-w-md">
                  <div>
                    <label htmlFor="productionType" className="block text-sm font-medium mb-1">نوع الإنتاج</label>
                    <select id="productionType" name="productionType" required className="w-full p-2 border rounded" style={{ minHeight: "44px" }}>
                      <option value="single_yarn">خيط مفرد</option>
                      <option value="twisted_yarn">خيط مبروم</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="factoryId" className="block text-sm font-medium mb-1">المصنع</label>
                    <select id="factoryId" name="factoryId" required className="w-full p-2 border rounded" style={{ minHeight: "44px" }}>
                      <option value="">اختر المصنع</option>
                      {formFactories.map((f) => (<option key={f.id} value={f.id}>{f.name}</option>))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="factoryLocationId" className="block text-sm font-medium mb-1">موقع المصنع</label>
                    <select id="factoryLocationId" name="factoryLocationId" required className="w-full p-2 border rounded" style={{ minHeight: "44px" }}>
                      <option value="">اختر الموقع</option>
                      {formLocations.map((l) => (<option key={l.id} value={l.id}>{l.name} (<LtrValue>{l.code}</LtrValue>)</option>))}
                    </select>
                  </div>
                  {/* Input row 0 */}
                  <div className="border-t pt-4">
                    <p className="text-sm font-medium mb-2">المدخل الأول</p>
                    <div className="space-y-2">
                      <select name="inputItemId_0" required className="w-full p-2 border rounded" style={{ minHeight: "44px" }}>
                        <option value="">اختر الصنف</option>
                        {formItems.map((i) => (<option key={i.id} value={i.id}>{i.name} (<LtrValue>{i.code}</LtrValue>)</option>))}
                      </select>
                      <select name="inputLocationId_0" required className="w-full p-2 border rounded" style={{ minHeight: "44px" }}>
                        <option value="">اختر موقع المدخل</option>
                        {formLocations.map((l) => (<option key={l.id} value={l.id}>{l.name} (<LtrValue>{l.code}</LtrValue>)</option>))}
                      </select>
                      <input name="plannedInputQtyKg_0" type="text" required dir="ltr" inputMode="decimal" pattern="[0-9]+(\.[0-9]+)?" placeholder="0.000" className="w-full p-2 border rounded" style={{ minHeight: "44px" }} />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">المعالجة المالية والموافقة يتطلبها الإدارة.</p>
                  <button type="submit" className="w-full bg-primary text-primary-foreground rounded p-3 font-medium" style={{ minHeight: "44px" }}>إنشاء المسودة</button>
                </form>
              </CardContent>
            </Card>

            {/* Production Inputs table (for issued orders) */}
            {inputs.length > 0 && (
              <Card className="mb-6">
                <CardHeader><CardTitle>مدخلات الإنتاج (أول أمر مُصدر)</CardTitle></CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b text-right">
                        <th className="py-2 px-3">الصنف</th><th className="py-2 px-3">الموقع</th>
                        <th className="py-2 px-3">المخطط (كجم)</th><th className="py-2 px-3">المصروف (كجم)</th>
                        <th className="py-2 px-3">المستهلك (كجم)</th><th className="py-2 px-3">المرتجع (كجم)</th>
                        <th className="py-2 px-3">متبقي تحت التشغيل (كجم)</th>
                      </tr></thead>
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

            {/* Form 2: Create Production Receipt Draft */}
            {issuedOrders.length > 0 && (
              <Card className="mb-6">
                <CardHeader><CardTitle>إنشاء سند استلام إنتاج</CardTitle></CardHeader>
                <CardContent>
                  <form action={createReceiptDraft} className="space-y-4 max-w-md">
                    <div>
                      <label htmlFor="receiptOrderId" className="block text-sm font-medium mb-1">أمر الإنتاج</label>
                      <select id="receiptOrderId" name="productionOrderId" required className="w-full p-2 border rounded" style={{ minHeight: "44px" }}>
                        <option value="">اختر أمر الإنتاج</option>
                        {issuedOrders.map((o) => (<option key={o.id} value={o.id}><LtrValue>{o.docNo}</LtrValue></option>))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="outputItemId" className="block text-sm font-medium mb-1">الصنف المُنتج</label>
                      <select id="outputItemId" name="outputItemId" required className="w-full p-2 border rounded" style={{ minHeight: "44px" }}>
                        <option value="">اختر الصنف</option>
                        {formItems.map((i) => (<option key={i.id} value={i.id}>{i.name} (<LtrValue>{i.code}</LtrValue>)</option>))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="outputLocationId" className="block text-sm font-medium mb-1">موقع الإخراج</label>
                      <select id="outputLocationId" name="outputLocationId" required className="w-full p-2 border rounded" style={{ minHeight: "44px" }}>
                        <option value="">اختر الموقع</option>
                        {formLocations.map((l) => (<option key={l.id} value={l.id}>{l.name} (<LtrValue>{l.code}</LtrValue>)</option>))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="outputQtyKg" className="block text-sm font-medium mb-1">كمية الإخراج (كجم)</label>
                      <input id="outputQtyKg" name="outputQtyKg" type="text" required dir="ltr" inputMode="decimal" pattern="[0-9]+(\.[0-9]+)?" placeholder="0.000" className="w-full p-2 border rounded" style={{ minHeight: "44px" }} />
                    </div>
                    <div>
                      <label htmlFor="receiptDate" className="block text-sm font-medium mb-1">تاريخ الاستلام</label>
                      <input id="receiptDate" name="receiptDate" type="date" required dir="ltr" className="w-full p-2 border rounded" style={{ minHeight: "44px" }} />
                    </div>
                    {/* Input allocation row 0 */}
                    <div className="border-t pt-4">
                      <p className="text-sm font-medium mb-2">توزيع المدخل الأول</p>
                      <div className="space-y-2">
                        <select name="allocInputId_0" required className="w-full p-2 border rounded" style={{ minHeight: "44px" }}>
                          <option value="">اختر المدخل</option>
                          {inputs.map((i) => (<option key={i.id} value={i.id}><LtrValue>{i.itemCode}</LtrValue> (WIP: {i.remainingWipQtyKg})</option>))}
                        </select>
                        <input name="allocConsumed_0" type="text" required dir="ltr" inputMode="decimal" placeholder="المستهلك (كجم)" className="w-full p-2 border rounded" style={{ minHeight: "44px" }} />
                        <input name="allocWaste_0" type="text" dir="ltr" inputMode="decimal" placeholder="الهدر (كجم)" defaultValue="0" className="w-full p-2 border rounded" style={{ minHeight: "44px" }} />
                      </div>
                    </div>
                    <div>
                      <label htmlFor="receiptNotes" className="block text-sm font-medium mb-1">ملاحظات (اختياري)</label>
                      <textarea id="receiptNotes" name="notes" rows={2} className="w-full p-2 border rounded" placeholder="ملاحظات إضافية" />
                    </div>
                    <p className="text-xs text-muted-foreground">المعالجة المالية والموافقة يتطلبها الإدارة.</p>
                    <button type="submit" className="w-full bg-primary text-primary-foreground rounded p-3 font-medium" style={{ minHeight: "44px" }}>إنشاء المسودة</button>
                  </form>
                </CardContent>
              </Card>
            )}

            {/* WIP Balances table */}
            <Card className="mb-6">
              <CardHeader><CardTitle>المخزون تحت التشغيل</CardTitle></CardHeader>
              <CardContent>
                {wipBalances.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">لا يوجد مخزون تحت التشغيل.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b text-right">
                        <th className="py-2 px-3">أمر الإنتاج</th><th className="py-2 px-3">الصنف</th>
                        <th className="py-2 px-3">المصنع</th><th className="py-2 px-3">الكمية المتبقية (كجم)</th>
                      </tr></thead>
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

            {/* Form 3: WIP Return Request */}
            <Card className="mb-6">
              <CardHeader><CardTitle>طلب مرتجع من تحت التشغيل</CardTitle></CardHeader>
              <CardContent>
                <form action={createWipReturnRequest} className="space-y-4 max-w-md">
                  <div>
                    <label htmlFor="wipOrderId" className="block text-sm font-medium mb-1">أمر الإنتاج</label>
                    <select id="wipOrderId" name="productionOrderId" required className="w-full p-2 border rounded" style={{ minHeight: "44px" }}>
                      <option value="">اختر أمر الإنتاج</option>
                      {issuedOrders.map((o) => (<option key={o.id} value={o.id}><LtrValue>{o.docNo}</LtrValue></option>))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="wipInputId" className="block text-sm font-medium mb-1">المدخل</label>
                    <select id="wipInputId" name="productionInputId" required className="w-full p-2 border rounded" style={{ minHeight: "44px" }}>
                      <option value="">اختر المدخل</option>
                      {inputs.map((i) => (<option key={i.id} value={i.id}><LtrValue>{i.itemCode}</LtrValue> ({i.remainingWipQtyKg}kg WIP)</option>))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="returnQtyKg" className="block text-sm font-medium mb-1">الكمية المرتجعة (كجم)</label>
                    <input id="returnQtyKg" name="returnQtyKg" type="text" required dir="ltr" inputMode="decimal" pattern="[0-9]+(\.[0-9]+)?" placeholder="0.000" className="w-full p-2 border rounded" style={{ minHeight: "44px" }} />
                  </div>
                  <div>
                    <label htmlFor="returnLocationId" className="block text-sm font-medium mb-1">موقع الاستلام</label>
                    <select id="returnLocationId" name="returnLocationId" required className="w-full p-2 border rounded" style={{ minHeight: "44px" }}>
                      <option value="">اختر الموقع</option>
                      {formLocations.map((l) => (<option key={l.id} value={l.id}>{l.name} (<LtrValue>{l.code}</LtrValue>)</option>))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="reason" className="block text-sm font-medium mb-1">السبب</label>
                    <textarea id="reason" name="reason" rows={2} required className="w-full p-2 border rounded" placeholder="وصف سبب الإرجاع" style={{ minHeight: "44px" }} />
                  </div>
                  <div>
                    <label htmlFor="wipNotes" className="block text-sm font-medium mb-1">ملاحظات (اختياري)</label>
                    <textarea id="wipNotes" name="notes" rows={2} className="w-full p-2 border rounded" placeholder="ملاحظات إضافية" />
                  </div>
                  <p className="text-xs text-muted-foreground">المعالجة المالية والموافقة يتطلبها الإدارة.</p>
                  <button type="submit" className="w-full bg-primary text-primary-foreground rounded p-3 font-medium" style={{ minHeight: "44px" }}>طلب الإرجاع</button>
                </form>
              </CardContent>
            </Card>

            {/* WIP Return Requests table */}
            <Card>
              <CardHeader><CardTitle>طلبات مرتجع تحت التشغيل</CardTitle></CardHeader>
              <CardContent>
                {wipReturns.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">لا توجد طلبات مرتجع من تحت التشغيل.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b text-right">
                        <th className="py-2 px-3">رقم المستند</th><th className="py-2 px-3">أمر الإنتاج</th>
                        <th className="py-2 px-3">الصنف</th><th className="py-2 px-3">الكمية (كجم)</th>
                        <th className="py-2 px-3">الموقع</th><th className="py-2 px-3">الحالة</th>
                        <th className="py-2 px-3">السبب</th>
                      </tr></thead>
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
