/**
 * Worker Return Receipt page — WP-08-01A.
 *
 * Route: /worker/return-receipt
 * Task-first Worker Task Mode for warehouse employees.
 * Records physical return and classification facts only.
 * No financial treatment, refund, credit, or replacement.
 *
 * Contract 10 §7.1: Warehouse records physical return receipts.
 * Contract 06 §9: Financial treatment is management-approved.
 */
import { redirect } from "next/navigation";
import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { WorkerShell } from "@/components/shells/worker-shell";
import { getWorkerTasksForRole } from "@/components/shells/nav-config";
import { signOut } from "@/app/login/actions";
import { requireWarehouseTaskActor } from "@/server/security/inventory-guards";
import type { RoleCode } from "@/server/security/role-codes";
import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LtrValue } from "@/components/ui/ltr-value";
import { db } from "@/server/db/client";
import { inventoryItems, locations, customers, salesOrders, salesOrderLines } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { createReturnRequest } from "./actions";

export default async function WorkerReturnReceiptPage() {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const workerRole = authResult.roles.find((r) => r !== "owner" && r !== "accountant") as RoleCode | undefined;
  if (!workerRole) redirect("/management");

  // Explicit allowlist guard — quality/unknown denied before any query
  requireWarehouseTaskActor(authResult as any, authResult.roles);

  const tasks = getWorkerTasksForRole(workerRole);

  let items: { id: string; code: string; name: string }[] = [];
  let locs: { id: string; code: string; name: string }[] = [];
  let custs: { id: string; code: string; name: string }[] = [];
  let sales: { id: string; docNo: string }[] = [];
  let lines: { id: string; saleId: string; lineNo: number; itemId: string; itemCode: string; qty: string }[] = [];
  let dbAvailable = false;

  if (db) {
    try {
      const itemRows = await db.select().from(inventoryItems).where(eq(inventoryItems.tenantId, authResult.tenantId));
      items = itemRows.map((r) => ({ id: r.id, code: r.itemCode, name: r.displayNameEn || r.itemCode }));
      const locRows = await db.select().from(locations).where(eq(locations.tenantId, authResult.tenantId));
      locs = locRows.map((r) => ({ id: r.id, code: r.locationCode, name: r.nameEn || r.locationCode }));
      const custRows = await db.select().from(customers).where(eq(customers.tenantId, authResult.tenantId));
      custs = custRows.map((r) => ({ id: r.id, code: r.customerCode, name: r.nameEn || r.customerCode }));
      const saleRows = await db.select().from(salesOrders).where(eq(salesOrders.tenantId, authResult.tenantId));
      sales = saleRows.map((r) => ({ id: r.id, docNo: r.docNo }));
      // WP-08-01A: load sale lines so the worker can select the original line.
      const lineRows = await db.select().from(salesOrderLines).where(eq(salesOrderLines.tenantId, authResult.tenantId));
      lines = lineRows.map((r) => ({
        id: r.id, saleId: r.salesOrderId, lineNo: r.lineNo,
        itemId: r.itemId, itemCode: items.find((i) => i.id === r.itemId)?.code ?? "?",
        qty: r.quantityKg,
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
        <h1 className="text-xl font-bold mb-4">استلام مرتجع</h1>

        {!dbAvailable && (
          <Card><CardContent className="py-8 text-center text-muted-foreground">قاعدة البيانات غير متاحة.</CardContent></Card>
        )}

        {dbAvailable && (
          <Card>
            <CardHeader><CardTitle>تسجيل مرتجع عميل</CardTitle></CardHeader>
            <CardContent>
              <form action={createReturnRequest} className="space-y-4 max-w-md">
                {/* Customer — operational name only */}
                <div>
                  <label htmlFor="customerId" className="block text-sm font-medium mb-1">العميل</label>
                  <select id="customerId" name="customerId" required className="w-full p-2 border rounded" style={{ minHeight: "44px" }}>
                    <option value="">اختر العميل</option>
                    {custs.map((c) => (<option key={c.id} value={c.id}>{c.name} (<LtrValue>{c.code}</LtrValue>)</option>))}
                  </select>
                </div>

                {/* Original sale — document number LTR */}
                <div>
                  <label htmlFor="salesOrderId" className="block text-sm font-medium mb-1">أمر البيع الأصلي</label>
                  <select id="salesOrderId" name="salesOrderId" required className="w-full p-2 border rounded" style={{ minHeight: "44px" }}>
                    <option value="">اختر أمر البيع</option>
                    {sales.map((s) => (<option key={s.id} value={s.id}><LtrValue>{s.docNo}</LtrValue></option>))}
                  </select>
                </div>

                {/* WP-08-01A: Original sale line — required so the service can validate saleLineId -> saleOrderId -> customerId -> itemId */}
                <div>
                  <label htmlFor="saleLineId" className="block text-sm font-medium mb-1">بند البيع الأصلي</label>
                  <select id="saleLineId" name="saleLineId" required className="w-full p-2 border rounded" style={{ minHeight: "44px" }}>
                    <option value="">اختر بند البيع</option>
                  </select>
                  <p className="text-xs text-muted-foreground mt-1">يجب اختيار أمر البيع أولاً.</p>
                </div>

                {/* Item */}
                <div>
                  <label htmlFor="itemId" className="block text-sm font-medium mb-1">الصنف المرتجع</label>
                  <select id="itemId" name="itemId" required className="w-full p-2 border rounded" style={{ minHeight: "44px" }}>
                    <option value="">اختر الصنف</option>
                    {items.map((i) => (<option key={i.id} value={i.id}>{i.name} (<LtrValue>{i.code}</LtrValue>)</option>))}
                  </select>
                </div>

                {/* Return location */}
                <div>
                  <label htmlFor="returnLocationId" className="block text-sm font-medium mb-1">موقع الاستلام</label>
                  <select id="returnLocationId" name="returnLocationId" required className="w-full p-2 border rounded" style={{ minHeight: "44px" }}>
                    <option value="">اختر الموقع</option>
                    {locs.map((l) => (<option key={l.id} value={l.id}>{l.name} (<LtrValue>{l.code}</LtrValue>)</option>))}
                  </select>
                </div>

                {/* Quantity — LTR, decimal */}
                <div>
                  <label htmlFor="quantityKg" className="block text-sm font-medium mb-1">الكمية المرتجعة (كجم)</label>
                  <input id="quantityKg" name="quantityKg" type="text" required dir="ltr" inputMode="decimal" pattern="[0-9]+(\.[0-9]+)?" placeholder="0.000" className="w-full p-2 border rounded" style={{ minHeight: "44px" }} />
                </div>

                {/* Return date — LTR */}
                <div>
                  <label htmlFor="returnDate" className="block text-sm font-medium mb-1">تاريخ الإرجاع</label>
                  <input id="returnDate" name="returnDate" type="date" required dir="ltr" className="w-full p-2 border rounded" style={{ minHeight: "44px" }} />
                </div>

                {/* Stock status — worker can only set operational classification */}
                <div>
                  <label htmlFor="returnedStockStatus" className="block text-sm font-medium mb-1">حالة المخزون المرتجع</label>
                  <select id="returnedStockStatus" name="returnedStockStatus" required className="w-full p-2 border rounded" style={{ minHeight: "44px" }}>
                    <option value="return_received">تم الاستلام</option>
                    <option value="needs_quality_review">يحتاج فحص جودة</option>
                  </select>
                  <p className="text-xs text-muted-foreground mt-1">التصنيف المالي يحدده الإدارة لاحقاً.</p>
                </div>

                {/* Reason — operational notes */}
                <div>
                  <label htmlFor="returnReason" className="block text-sm font-medium mb-1">سبب الإرجاع</label>
                  <textarea id="returnReason" name="returnReason" rows={2} className="w-full p-2 border rounded" placeholder="وصف سبب الإرجاع" />
                </div>

                <input type="hidden" name="idempotencyKey"  />

                <button type="submit" className="w-full bg-primary text-primary-foreground rounded p-3 font-medium" style={{ minHeight: "44px" }}>تسجيل المرتجع</button>
              </form>

              <p className="mt-4 text-xs text-muted-foreground">
                يتم تسجيل المرتجع كطلب. المعالجة المالية والاستبدال يتطلبان موافقة الإدارة.
              </p>
            </CardContent>
          </Card>
        )}

        {/* WP-08-01A: client-side wiring so saleLineId dropdown is filtered by selected sale,
            and selecting a sale line auto-syncs the item dropdown. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function(){
                var lines = ${JSON.stringify(lines)};
                var saleSel = document.getElementById('salesOrderId');
                var lineSel = document.getElementById('saleLineId');
                var itemSel = document.getElementById('itemId');
                if (!saleSel || !lineSel) return;
                saleSel.addEventListener('change', function(){
                  var saleId = saleSel.value;
                  lineSel.innerHTML = '<option value="">اختر بند البيع</option>';
                  if (!saleId) return;
                  lines.filter(function(l){return l.saleId === saleId;}).forEach(function(l){
                    var opt = document.createElement('option');
                    opt.value = l.id;
                    opt.textContent = '#' + l.lineNo + ' (' + l.itemCode + ', ' + l.qty + 'kg)';
                    lineSel.appendChild(opt);
                  });
                });
                lineSel.addEventListener('change', function(){
                  var lineId = lineSel.value;
                  var ln = lines.find(function(l){return l.id === lineId;});
                  if (ln && itemSel) itemSel.value = ln.itemId;
                });
              })();
            `,
          }}
        />
      </Container>
    </WorkerShell>
  );
}
