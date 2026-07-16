/**
 * Management Inventory Movements page — WP-08-01A.
 * Uses InventoryScreenQueryService for DTOs.
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
import { InventoryScreenQueryService, type ManagementMovementDto } from "@/server/services/inventory-screen-query-service";

export default async function InventoryMovementsPage() {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const managementRole = authResult.roles.find((r) => isManagementShellRole(r)) as RoleCode | undefined;
  if (!managementRole) redirect("/worker");

  // Explicit allowlist guard — quality/unknown denied before any query
  requireManagementInventoryActor(authResult as any, authResult.roles);

  const navCategories = getManagementNavForRole(managementRole);

  let movements: ManagementMovementDto[] = [];
  let dbAvailable = false;

  if (db) {
    try {
      const queryService = new InventoryScreenQueryService(db);
      movements = await queryService.listRecentMovements(authResult.tenantId);
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
        <h1 className="text-2xl font-bold mb-6">حركات المخزون</h1>

        {!dbAvailable && (
          <Card><CardContent className="py-8 text-center text-muted-foreground">قاعدة البيانات غير متاحة. لا يمكن عرض الحركات.</CardContent></Card>
        )}

        {dbAvailable && movements.length === 0 && (
          <Card><CardContent className="py-8 text-center text-muted-foreground">لا توجد حركات مخزون مسجلة.</CardContent></Card>
        )}

        {dbAvailable && movements.length > 0 && (
          <Card>
            <CardHeader><CardTitle>آخر ٥٠ حركة</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-right">
                      <th className="py-2 px-3">رقم المستند</th>
                      <th className="py-2 px-3">النوع</th>
                      <th className="py-2 px-3">الصنف</th>
                      <th className="py-2 px-3">الكمية (كجم)</th>
                      <th className="py-2 px-3">التاريخ</th>
                      <th className="py-2 px-3">الحالة</th>
                      <th className="py-2 px-3">المصدر</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map((m, i) => (
                      <tr key={i} className="border-b">
                        <td className="py-2 px-3"><LtrValue className="font-mono">{m.docNo}</LtrValue></td>
                        <td className="py-2 px-3">{m.movementTypeAr}</td>
                        <td className="py-2 px-3"><div className="font-medium">{m.itemName}</div><div className="text-xs text-muted-foreground"><LtrValue>{m.itemCode}</LtrValue></div></td>
                        <td className="py-2 px-3"><LtrValue className="font-bold">{m.quantityKg}</LtrValue></td>
                        <td className="py-2 px-3"><LtrValue>{m.movementDate}</LtrValue></td>
                        <td className="py-2 px-3">{m.movementStatus === "posted" ? "مرحّل" : m.movementStatus}</td>
                        <td className="py-2 px-3"><LtrValue className="text-xs">{m.sourceDocumentType || "—"}</LtrValue></td>
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
