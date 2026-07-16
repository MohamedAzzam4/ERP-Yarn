/**
 * Management Inventory Reservations page — WP-08-01A.
 * Route: /management/inventory/reservations
 * Contract 04 §9: Reservation state per sale.
 * Contract 10 §8.2: Reservation state visible in inventory screens.
 */
import { redirect } from "next/navigation";
import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { isManagementShellRole, getManagementNavForRole } from "@/components/shells/nav-config";
import { ManagementShell } from "@/components/shells/management-shell";
import { signOut } from "@/app/login/actions";
import { requireManagementInventoryActor } from "@/server/security/inventory-guards";
import type { RoleCode } from "@/server/security/role-codes";
import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LtrValue } from "@/components/ui/ltr-value";
import { db } from "@/server/db/client";
import { InventoryScreenQueryService, type ManagementReservationDto } from "@/server/services/inventory-screen-query-service";

export default async function InventoryReservationsPage() {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");
  const managementRole = authResult.roles.find((r) => isManagementShellRole(r)) as RoleCode | undefined;
  if (!managementRole) redirect("/worker");

  // Explicit allowlist guard — quality/unknown denied before any query
  requireManagementInventoryActor(authResult as any, authResult.roles);
  const navCategories = getManagementNavForRole(managementRole);

  let reservations: ManagementReservationDto[] = [];
  let dbAvailable = false;
  if (db) {
    try {
      const queryService = new InventoryScreenQueryService(db);
      reservations = await queryService.listReservations(authResult.tenantId);
      dbAvailable = true;
    } catch { dbAvailable = false; }
  }

  return (
    <ManagementShell userName={authResult.name || authResult.email} navCategories={navCategories} onSignOut={async () => { "use server"; await signOut(); }}>
      <Container>
        <h1 className="text-2xl font-bold mb-6">الحجوزات</h1>
        {!dbAvailable && (<Card><CardContent className="py-8 text-center text-muted-foreground">قاعدة البيانات غير متاحة.</CardContent></Card>)}
        {dbAvailable && reservations.length === 0 && (<Card><CardContent className="py-8 text-center text-muted-foreground">لا توجد حجوزات نشطة.</CardContent></Card>)}
        {dbAvailable && reservations.length > 0 && (
          <Card>
            <CardHeader><CardTitle>الحجوزات النشطة</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b text-right">
                    <th className="py-2 px-3">أمر البيع</th><th className="py-2 px-3">الصنف</th><th className="py-2 px-3">الموقع</th>
                    <th className="py-2 px-3">الكمية المحجوزة</th><th className="py-2 px-3">حالة الحجز</th><th className="py-2 px-3">حالة البيع</th><th className="py-2 px-3">التاريخ</th>
                  </tr></thead>
                  <tbody>
                    {reservations.map((r, i) => (
                      <tr key={i} className="border-b">
                        <td className="py-2 px-3"><LtrValue className="font-mono">{r.saleDocNo}</LtrValue></td>
                        <td className="py-2 px-3"><div className="font-medium">{r.itemName}</div><div className="text-xs text-muted-foreground"><LtrValue>{r.itemCode}</LtrValue></div></td>
                        <td className="py-2 px-3">{r.locationName}</td>
                        <td className="py-2 px-3"><LtrValue className="font-bold">{r.reservedQtyKg}</LtrValue></td>
                        <td className="py-2 px-3">{r.reservationStatus === "active" ? "نشط" : r.reservationStatus}</td>
                        <td className="py-2 px-3">{r.saleStatus}</td>
                        <td className="py-2 px-3"><LtrValue>{r.createdAt.slice(0, 10)}</LtrValue></td>
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
