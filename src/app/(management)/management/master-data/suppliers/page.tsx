/**
 * Suppliers management page.
 * Route: /management/master-data/suppliers
 * WP-02-01: Admin screen for supplier master data. WP-01-08 approved UI.
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
import { FIXTURE_PARTIES } from "@/lib/fixtures/reference-fixtures";

const SUPPLIERS = FIXTURE_PARTIES.filter((p) => p.type === "supplier");

export default async function SuppliersPage() {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");
  const managementRole = authResult.roles.find((r) => isManagementShellRole(r)) as RoleCode | undefined;
  if (!managementRole) redirect("/worker");
  const navCategories = getManagementNavForRole(managementRole);

  return (
    <ManagementShell
      userName={authResult.name}
      tenantLabel="ERP-Yarn"
      navCategories={navCategories}
      onSignOut={async () => { "use server"; await signOut(); }}
      breadcrumbs={[{ label: "الرئيسية", href: "/management" }, { label: "البيانات الأساسية", href: "/management/master-data" }, { label: "الموردون" }]}
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
            <Button type="button" variant="primary" className="min-h-[44px]" aria-label="إضافة مورد جديد">إضافة مورد</Button>
          </div>
        </div>
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-heading-4 text-foreground">قائمة الموردين</CardTitle></CardHeader>
          <CardContent className="p-0">
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
                  {SUPPLIERS.map((supplier) => (
                    <tr key={supplier.code} className="border-b border-border transition-colors duration-150 hover:bg-primary/5">
                      <td className="p-3"><LtrValue className="font-medium text-foreground">{supplier.code}</LtrValue></td>
                      <td className="p-3 text-foreground">{supplier.nameAr}</td>
                      <td className="p-3"><span className="inline-flex items-center rounded-md bg-success/10 px-2 py-0.5 text-xs font-medium text-success"><span className="h-1.5 w-1.5 rounded-full bg-success mr-1.5" />نشط</span></td>
                      <td className="p-3"><div className="flex gap-2"><Button type="button" variant="outline" size="sm" disabled aria-label="تعديل (غير متاح - عرض فقط)" className="min-h-[44px] opacity-50">تعديل</Button><Button type="button" variant="outline" size="sm" disabled aria-label="إلغاء التنشيط (غير متاح - عرض فقط)" className="min-h-[44px] border-warning/30 text-warning/50 opacity-50">تعطيل</Button></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-4 py-3 text-xs text-muted-foreground border-t border-border">هذه شاشة إدارية — البيانات المعروضة تجريبية. يتم تطبيق صلاحيات المالك/المحاسب فقط.</p>
          </CardContent>
        </Card>
      </Container>
    </ManagementShell>
  );
}
