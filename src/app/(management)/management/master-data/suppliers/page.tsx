/**
 * Suppliers management page.
 *
 * Route: /management/master-data/suppliers
 *
 * WP-02-01: Admin screen for supplier master data. Uses the approved
 * WP-01-08 UI baseline (Arabic RTL, Calm Enterprise, 44px touch targets,
 * no glass on data tables, accessible focus states).
 *
 * This page reads supplier data from the real MasterDataService (backed by
 * the Drizzle DB repository when DATABASE_URL is configured). When the DB
 * is not available (e.g., local dev without Supabase), it shows an explicit
 * empty state — it does NOT render fixture/demo data as if it were live.
 *
 * Workers are redirected to /worker (management-only route).
 */
import { redirect } from "next/navigation";
import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { getManagementNavForRole, isManagementShellRole } from "@/components/shells/nav-config";
import { ManagementShell } from "@/components/shells/management-shell";
import { signOut } from "@/app/login/actions";
import type { RoleCode } from "@/server/security/role-codes";
import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LtrValue } from "@/components/ui/ltr-value";
import { db } from "@/server/db/client";
import { MasterDataDbRepository } from "@/server/services/master-data-db-repository";
import { MasterDataService } from "@/server/services/master-data-service";
import { InProcessAuditStore } from "@/server/services/audit-service";
import type { Supplier } from "@/server/db/schema/master-data";
import type { EffectivePermissions } from "@/server/security/effective-permissions";
import { resolveEffectivePermissions } from "@/server/security/effective-permissions";
import { TEST_ROLE_PERMISSION_MATRIX } from "@/server/security/role-fixtures";

export default async function SuppliersPage() {
  const authResult = await getErpAuthContextWithRoles();

  if (!authResult.authenticated) {
    redirect("/login");
  }

  if (authResult.roles.length === 0) {
    redirect("/login?error=no_role");
  }

  const managementRole = authResult.roles.find((r) => isManagementShellRole(r)) as RoleCode | undefined;
  if (!managementRole) {
    redirect("/worker");
  }

  const navCategories = getManagementNavForRole(managementRole);

  // Read suppliers from the real DB when available. When DATABASE_URL is
  // not set (local dev / CI without Supabase), show an explicit empty
  // state. We do NOT render fixture/demo data as if it were live.
  let suppliers: Supplier[] = [];
  let dbAvailable = false;

  if (db) {
    const repository = new MasterDataDbRepository(db);
    const service = new MasterDataService({
      repository,
      // Audit store for read-only operations — no mutations happen on a
      // list page, so the audit store is a no-op placeholder.
      audit: new InProcessAuditStore(),
    });
    const effective: EffectivePermissions = resolveEffectivePermissions(
      authResult.roles,
      TEST_ROLE_PERMISSION_MATRIX,
    );
    try {
      suppliers = await service.listActiveSuppliers(
        { ...authResult, tenantId: authResult.tenantId },
        effective,
      );
      dbAvailable = true;
    } catch {
      // DB query failed — fall through to empty state.
      dbAvailable = false;
    }
  }

  return (
    <ManagementShell
      userName={authResult.name}
      tenantLabel="ERP-Yarn"
      navCategories={navCategories}
      onSignOut={async () => {
        "use server";
        await signOut();
      }}
      breadcrumbs={[
        { label: "الرئيسية", href: "/management" },
        { label: "البيانات الأساسية", href: "/management/master-data" },
        { label: "الموردون" },
      ]}
    >
      <Container size="xl" className="py-6">
        <div className="mb-6 rounded-2xl border border-primary/20 bg-gradient-to-l from-primary/12 via-primary/5 to-transparent p-5 backdrop-blur-md shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="inline-block h-7 w-1.5 rounded-full bg-primary" aria-hidden="true" />
              <div>
                <h1 className="text-heading-2 text-foreground">الموردون</h1>
                <p className="text-sm text-muted-foreground">إدارة بيانات موردي المواد الخام</p>
              </div>
            </div>
            <Button
              type="button"
              variant="primary"
              className="min-h-[44px]"
              aria-label="إضافة مورد جديد"
            >
              إضافة مورد
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-heading-4 text-foreground">قائمة الموردين</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {suppliers.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" role="table">
                  <thead>
                    <tr className="border-b border-border bg-primary/5">
                      <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">الكود</th>
                      <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">الاسم</th>
                      <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">الحالة</th>
                      <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suppliers.map((supplier) => (
                      <tr key={supplier.id} className="border-b border-border transition-colors duration-150 hover:bg-primary/5">
                        <td className="p-3">
                          <LtrValue className="font-medium text-foreground">{supplier.supplierCode}</LtrValue>
                        </td>
                        <td className="p-3 text-foreground">{supplier.nameAr}</td>
                        <td className="p-3">
                          <span className="inline-flex items-center rounded-md bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                            <span className="h-1.5 w-1.5 rounded-full bg-success mr-1.5" />
                            نشط
                          </span>
                        </td>
                        <td className="p-3">
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled
                              aria-label="تعديل (غير متاح حالياً)"
                              className="min-h-[44px] opacity-50"
                            >
                              تعديل
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled
                              aria-label="إلغاء التنشيط (غير متاح حالياً)"
                              className="min-h-[44px] border-warning/30 text-warning/50 opacity-50"
                            >
                              تعطيل
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground" aria-hidden="true">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="8.5" cy="7" r="4" />
                    <line x1="20" y1="8" x2="20" y2="14" />
                    <line x1="23" y1="11" x2="17" y2="11" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-foreground">
                  {dbAvailable ? "لا يوجد موردون نشطون" : "قاعدة البيانات غير متصلة"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {dbAvailable
                    ? "استخدم زر «إضافة مورد» لإنشاء أول مورد."
                    : "تظهر البيانات عند اتصال قاعدة البيانات. لا يتم عرض بيانات تجريبية."}
                </p>
              </div>
            )}
            <p className="px-4 py-3 text-xs text-muted-foreground border-t border-border">
              هذه شاشة إدارية — يتم تطبيق صلاحيات المالك/المحاسب فقط
            </p>
          </CardContent>
        </Card>
      </Container>
    </ManagementShell>
  );
}
