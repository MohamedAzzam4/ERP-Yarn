/**
 * Management Inventory Alerts page — WP-08-01A.
 * Route: /management/inventory/alerts
 * Contract 04 §12: Negative stock is a visible alert.
 * Contract 10 §8.2: Mismatch/negative persistent alerts.
 * Critical state is NOT communicated by color alone — includes text + icon.
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
import { InventoryScreenQueryService, type ManagementAlertDto } from "@/server/services/inventory-screen-query-service";

const SEVERITY_LABELS_AR: Record<string, string> = {
  critical: "حرج", warning: "تحذير", info: "معلومة",
};

const SEVERITY_ICONS: Record<string, string> = {
  critical: "⚠", warning: "△", info: "ℹ",
};

export default async function InventoryAlertsPage() {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");
  const managementRole = authResult.roles.find((r) => isManagementShellRole(r)) as RoleCode | undefined;
  if (!managementRole) redirect("/worker");
  const navCategories = getManagementNavForRole(managementRole);

  let alerts: ManagementAlertDto[] = [];
  let dbAvailable = false;
  if (db) {
    try {
      const queryService = new InventoryScreenQueryService(db);
      alerts = await queryService.listAlerts(authResult.tenantId);
      dbAvailable = true;
    } catch { dbAvailable = false; }
  }

  return (
    <ManagementShell userName={authResult.name || authResult.email} navCategories={navCategories} onSignOut={async () => { "use server"; await signOut(); }}>
      <Container>
        <h1 className="text-2xl font-bold mb-6">التنبيهات</h1>
        {!dbAvailable && (<Card><CardContent className="py-8 text-center text-muted-foreground">قاعدة البيانات غير متاحة.</CardContent></Card>)}
        {dbAvailable && alerts.length === 0 && (<Card><CardContent className="py-8 text-center text-muted-foreground">لا توجد تنبيهات نشطة.</CardContent></Card>)}
        {dbAvailable && alerts.length > 0 && (
          <div className="space-y-3">
            {alerts.map((a) => (
              <Card key={a.id} className={a.severity === "critical" ? "border-red-300 bg-red-50" : a.severity === "warning" ? "border-yellow-300 bg-yellow-50" : ""}>
                <CardContent className="py-4 flex items-start gap-3">
                  {/* Icon + text — NOT color alone (Contract 10 §8.2) */}
                  <span className="text-xl flex-shrink-0">{SEVERITY_ICONS[a.severity] || "ℹ"}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-sm font-bold ${a.severity === "critical" ? "text-red-700" : a.severity === "warning" ? "text-yellow-700" : "text-blue-700"}`}>
                        {SEVERITY_LABELS_AR[a.severity] || a.severity}
                      </span>
                      <span className="text-xs text-muted-foreground"><LtrValue>{a.alertType}</LtrValue></span>
                    </div>
                    <p className="text-sm">{a.message}</p>
                    <p className="text-xs text-muted-foreground mt-1"><LtrValue>{a.createdAt.slice(0, 19)}</LtrValue></p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Container>
    </ManagementShell>
  );
}
