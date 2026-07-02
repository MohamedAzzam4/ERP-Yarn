/**
 * Master Data overview page.
 * Route: /management/master-data
 * WP-02-01: Admin screen for master-data foundation. WP-01-08 approved UI.
 */
import { redirect } from "next/navigation";
import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { getManagementNavForRole, isManagementShellRole } from "@/components/shells/nav-config";
import { ManagementShell } from "@/components/shells/management-shell";
import { signOut } from "@/app/login/actions";
import type { RoleCode } from "@/server/security/role-codes";
import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { LtrValue } from "@/components/ui/ltr-value";

const CATEGORIES = [
  { id: "suppliers", labelAr: "الموردون", href: "/management/master-data/suppliers", description: "إدارة بيانات الموردين" },
  { id: "customers", labelAr: "العملاء", href: "/management/master-data/customers", description: "إدارة بيانات العملاء" },
  { id: "locations", labelAr: "المواقع", href: "/management/master-data/locations", description: "إدارة المخازن والمواقع" },
  { id: "factories", labelAr: "مصانع التشغيل", href: "/management/master-data/factories", description: "إدارة مصانع التشغيل الخارجية" },
  { id: "fiber-types", labelAr: "أنواع الخيوط", href: "/management/master-data/fiber-types", description: "إدارة أنواع الخيوط الخام" },
  { id: "product-types", labelAr: "أنواع المنتجات", href: "/management/master-data/product-types", description: "إدارة أنواع المنتجات النهائية" },
  { id: "quality-parameters", labelAr: "معايير الجودة", href: "/management/master-data/quality-parameters", description: "إدارة معايير واختبارات الجودة" },
] as const;

export default async function MasterDataOverviewPage() {
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
      breadcrumbs={[{ label: "الرئيسية", href: "/management" }, { label: "البيانات الأساسية" }]}
    >
      <Container size="xl" className="py-6">
        <div className="mb-6 rounded-2xl border border-primary/20 bg-gradient-to-l from-primary/12 via-primary/5 to-transparent p-5 backdrop-blur-md shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-block h-7 w-1.5 rounded-full bg-primary" aria-hidden="true" />
            <h1 className="text-heading-2 text-foreground">البيانات الأساسية</h1>
          </div>
          <p className="text-sm text-muted-foreground">إدارة الموردين والعملاء والمواقع والمصانع والأنواع والمعايير</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CATEGORIES.map((cat) => (
            <Card key={cat.id} className="group relative overflow-hidden border-border bg-surface transition-all duration-200 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" role="link" aria-label={cat.labelAr} tabIndex={0}>
              <div className="pointer-events-none absolute right-0 top-5 bottom-5 w-[3px] rounded-full bg-primary" aria-hidden="true" />
              <CardContent className="relative p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground mb-1.5"><LtrValue>{cat.id}</LtrValue></p>
                    <p className="text-lg font-bold text-foreground">{cat.labelAr}</p>
                    <p className="text-sm text-muted-foreground mt-1">{cat.description}</p>
                  </div>
                  <span className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">إدارة</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <p className="mt-4 text-xs text-center text-muted-foreground">هذه شاشة إدارية — يتم تطبيق صلاحيات المالك/المحاسب فقط</p>
      </Container>
    </ManagementShell>
  );
}
