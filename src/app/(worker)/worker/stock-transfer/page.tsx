/**
 * Worker Stock Transfer page — WP-08-01A.
 *
 * Route: /worker/stock-transfer
 * Task-first Worker Task Mode for warehouse employees.
 * One-column narrow layout, Arabic operational labels, LTR-isolated codes.
 *
 * Contract 10 §7.1: Warehouse records transfer drafts.
 * No approval, posting, or financial fields.
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
import { inventoryItems, locations } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { createTransferDraft } from "./actions";

export default async function WorkerStockTransferPage() {
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
  let dbAvailable = false;

  if (db) {
    try {
      const itemRows = await db.select().from(inventoryItems).where(eq(inventoryItems.tenantId, authResult.tenantId));
      items = itemRows.map((r) => ({ id: r.id, code: r.itemCode, name: r.displayNameEn || r.displayNameAr || r.itemCode }));
      const locRows = await db.select().from(locations).where(eq(locations.tenantId, authResult.tenantId));
      locs = locRows.map((r) => ({ id: r.id, code: r.locationCode, name: r.nameEn || r.nameAr || r.locationCode }));
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
        <h1 className="text-xl font-bold mb-4">نقل مخزون</h1>

        {!dbAvailable && (
          <Card><CardContent className="py-8 text-center text-muted-foreground">قاعدة البيانات غير متاحة.</CardContent></Card>
        )}

        {dbAvailable && (
          <Card>
            <CardHeader><CardTitle>تسجيل طلب نقل</CardTitle></CardHeader>
            <CardContent>
              <form action={createTransferDraft} className="space-y-4 max-w-md">
                {/* Item selection — operational only, no price/cost */}
                <div>
                  <label htmlFor="itemId" className="block text-sm font-medium mb-1">الصنف</label>
                  <select id="itemId" name="itemId" required className="w-full p-2 border rounded text-base" style={{ minHeight: "44px" }}>
                    <option value="">اختر الصنف</option>
                    {items.map((i) => (
                      <option key={i.id} value={i.id}>{i.name} (<LtrValue>{i.code}</LtrValue>)</option>
                    ))}
                  </select>
                </div>

                {/* From location */}
                <div>
                  <label htmlFor="fromLocationId" className="block text-sm font-medium mb-1">من موقع</label>
                  <select id="fromLocationId" name="fromLocationId" required className="w-full p-2 border rounded text-base" style={{ minHeight: "44px" }}>
                    <option value="">اختر الموقع المصدر</option>
                    {locs.map((l) => (
                      <option key={l.id} value={l.id}>{l.name} (<LtrValue>{l.code}</LtrValue>)</option>
                    ))}
                  </select>
                </div>

                {/* To location */}
                <div>
                  <label htmlFor="toLocationId" className="block text-sm font-medium mb-1">إلى موقع</label>
                  <select id="toLocationId" name="toLocationId" required className="w-full p-2 border rounded text-base" style={{ minHeight: "44px" }}>
                    <option value="">اختر الموقع الوجهة</option>
                    {locs.map((l) => (
                      <option key={l.id} value={l.id}>{l.name} (<LtrValue>{l.code}</LtrValue>)</option>
                    ))}
                  </select>
                </div>

                {/* Quantity — LTR isolated, decimal string */}
                <div>
                  <label htmlFor="quantityKg" className="block text-sm font-medium mb-1">الكمية (كجم)</label>
                  <input
                    id="quantityKg" name="quantityKg" type="text" required
                    dir="ltr" inputMode="decimal" pattern="[0-9]+(\.[0-9]+)?"
                    placeholder="0.000"
                    className="w-full p-2 border rounded text-base"
                    style={{ minHeight: "44px" }}
                  />
                </div>

                {/* Reason — optional, operational notes only */}
                <div>
                  <label htmlFor="reason" className="block text-sm font-medium mb-1">ملاحظات (اختياري)</label>
                  <textarea
                    id="reason" name="reason" rows={2}
                    className="w-full p-2 border rounded text-base"
                    placeholder="سبب النقل أو ملاحظات تشغيلية"
                  />
                </div>

                {/* Idempotency key — auto-generated */}
                <input type="hidden" name="idempotencyKey"  />

                {/* Submit — 44px touch target */}
                <button
                  type="submit"
                  className="w-full bg-primary text-primary-foreground rounded p-3 font-medium"
                  style={{ minHeight: "44px" }}
                >
                  حفظ المسودة
                </button>
              </form>

              <p className="mt-4 text-xs text-muted-foreground">
                يتم تسجيل الطلب كمسودة. يتم النشر الفعلي بعد موافقة الإدارة.
              </p>
            </CardContent>
          </Card>
        )}
      </Container>
    </WorkerShell>
  );
}
