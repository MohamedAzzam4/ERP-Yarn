/**
 * Management Reconciliation page — inventory ledger reconciliation.
 *
 * Route: /management/reconciliation
 *
 * WP-03-01: Read-only materialized balance reconciliation.
 * Shows: matched/mismatched counts, mismatch details, negative alerts.
 * No silent repair — mismatches are reported, not auto-fixed.
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
import { InventoryLedgerDbRepository } from "@/server/services/inventory-ledger-db-repository";
import { FullReconciliationService } from "@/server/services/inventory-ledger-expansion";
import { resolveEffectivePermissions } from "@/server/security/effective-permissions";
import { TEST_ROLE_PERMISSION_MATRIX } from "@/server/security/role-fixtures";
import type { EffectivePermissions } from "@/server/security/effective-permissions";
import type { BatchReconciliationResult } from "@/server/services/inventory-ledger-expansion";

export default async function ReconciliationPage() {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const managementRole = authResult.roles.find((r) => isManagementShellRole(r)) as RoleCode | undefined;
  if (!managementRole) redirect("/worker");

  const navCategories = getManagementNavForRole(managementRole);

  let result: BatchReconciliationResult | null = null;
  let dbAvailable = false;

  if (db) {
    const ledger = new InventoryLedgerDbRepository(db);
    const reconciler = new FullReconciliationService({ ledger });
    const effective: EffectivePermissions = resolveEffectivePermissions(authResult.roles, TEST_ROLE_PERMISSION_MATRIX);
    try {
      result = await reconciler.reconcileAll({ ...authResult, tenantId: authResult.tenantId } as any, effective);
      dbAvailable = true;
    } catch {
      dbAvailable = false;
    }
  }

  return (
    <ManagementShell
      userName={authResult.name}
      tenantLabel="ERP-Yarn"
      navCategories={navCategories}
      onSignOut={async () => { "use server"; await signOut(); }}
      breadcrumbs={[{ label: "الرئيسية", href: "/management" }, { label: "مطابقة المخزون" }]}
    >
      <Container size="xl" className="py-6">
        <div className="mb-6 rounded-2xl border border-primary/20 bg-gradient-to-l from-primary/12 via-primary/5 to-transparent p-5 backdrop-blur-md shadow-sm">
          <div className="flex items-center gap-2">
            <span className="inline-block h-7 w-1.5 rounded-full bg-primary" aria-hidden="true" />
            <div>
              <h1 className="text-heading-2 text-foreground">مطابقة المخزون</h1>
              <p className="text-sm text-muted-foreground">عرض للقراءة فقط — مقارنة حركات المخزون بالأرصدة المسجلة</p>
            </div>
          </div>
        </div>

        {!dbAvailable ? (
          <Card><CardContent className="py-16 text-center"><p className="text-sm font-medium text-foreground">قاعدة البيانات غير متصلة</p></CardContent></Card>
        ) : result ? (
          <>
            {/* Summary */}
            <div className="grid grid-cols-2 gap-4 mb-6 sm:grid-cols-4">
              <StatCard label="إجمالي الفحص" value={String(result.totalChecked)} color="primary" />
              <StatCard label="مطابق" value={String(result.totalMatched)} color="success" />
              <StatCard label="غير مطابق" value={String(result.totalMismatched)} color={result.totalMismatched > 0 ? "destructive" : "muted"} />
              <StatCard label="أرصدة سالبة" value={String(result.totalNegative)} color={result.totalNegative > 0 ? "warning" : "muted"} />
            </div>

            {/* Mismatches */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-heading-4 text-foreground">
                  {result.totalMismatched > 0 ? `عدم تطابق (${result.totalMismatched})` : "جميع الأرصدة مطابقة"}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {result.mismatches.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm" role="table">
                      <thead>
                        <tr className="border-b border-border bg-destructive/5">
                          <th className="p-3 text-right text-xs font-semibold uppercase text-muted-foreground">الصنف</th>
                          <th className="p-3 text-right text-xs font-semibold uppercase text-muted-foreground">الموقع</th>
                          <th className="p-3 text-right text-xs font-semibold uppercase text-muted-foreground">مجموع الحركات</th>
                          <th className="p-3 text-right text-xs font-semibold uppercase text-muted-foreground">الرصيد المسجل</th>
                          <th className="p-3 text-right text-xs font-semibold uppercase text-muted-foreground">تنبيه</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.mismatches.map((m, idx) => (
                          <tr key={idx} className="border-b border-border">
                            <td className="p-3"><LtrValue className="font-medium text-foreground">{m.itemId.slice(0, 8)}…</LtrValue></td>
                            <td className="p-3"><LtrValue className="text-foreground">{m.locationId.slice(0, 8)}…</LtrValue></td>
                            <td className="p-3"><LtrValue className="text-foreground">{m.movementSumKg}</LtrValue></td>
                            <td className="p-3"><LtrValue className="text-destructive">{m.balanceOnHandKg}</LtrValue></td>
                            <td className="p-3">
                              {m.isNegative ? (
                                <span className="inline-flex items-center rounded-md bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">رصيد سالب</span>
                              ) : (
                                <span className="inline-flex items-center rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">عدم تطابق</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                    <p className="text-sm font-medium text-success">✓ جميع الأرصدة مطابقة لحركات المخزون</p>
                    <p className="text-xs text-muted-foreground mt-1">لا توجد اختلافات أو أرصدة سالبة</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* No-silent-repair notice */}
            <div className="mt-4 rounded-lg border border-info/30 bg-info/5 p-3 text-sm">
              <p className="text-info font-medium">عرض للقراءة فقط</p>
              <p className="text-muted-foreground mt-1">
                لا يتم إصلاح أي اختلافات تلقائياً. راجع الاختلافات واتخذ إجراءً يدوياً من خلال مسار التصحيح المعتمد.
              </p>
            </div>
          </>
        ) : (
          <Card><CardContent className="py-16 text-center"><p className="text-sm">حدث خطأ غير متوقع</p></CardContent></Card>
        )}
      </Container>
    </ManagementShell>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  const colorClasses: Record<string, string> = {
    primary: "border-primary/20 bg-primary/5 text-primary",
    success: "border-success/20 bg-success/5 text-success",
    destructive: "border-destructive/20 bg-destructive/5 text-destructive",
    warning: "border-warning/20 bg-warning/5 text-warning",
    muted: "border-border bg-muted/30 text-muted-foreground",
  };
  return (
    <div className={`rounded-lg border p-4 ${colorClasses[color] ?? colorClasses.muted}`}>
      <p className="text-xs font-medium opacity-70">{label}</p>
      <p className="text-heading-3 mt-1"><LtrValue>{value}</LtrValue></p>
    </div>
  );
}
