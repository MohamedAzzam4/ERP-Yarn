/**
 * Factories management page.
 * Route: /management/master-data/factories
 * WP-02-01: Admin screen for factories master data. WP-01-08 approved UI.
 * Shows an explicit empty state — does NOT render fixture/demo data.
 */
import { redirect } from "next/navigation";
import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { getManagementNavForRole, isManagementShellRole } from "@/components/shells/nav-config";
import { ManagementShell } from "@/components/shells/management-shell";
import { signOut } from "@/app/login/actions";
import type { RoleCode } from "@/server/security/role-codes";
import { MasterDataListPage } from "@/components/master-data/master-data-list-page";

export default async function FactoriesPage() {
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
      breadcrumbs={[
        { label: "الرئيسية", href: "/management" },
        { label: "البيانات الأساسية", href: "/management/master-data" },
        { label: "مصانع التشغيل" },
      ]}
    >
      <MasterDataListPage
        titleAr="مصانع التشغيل"
        descriptionAr="إدارة مصانع التشغيل الخارجية"
        addLabelAr="إضافة مصنع"
        emptyTitleAr="لا يوجد مصانع نشطة"
        emptyDescriptionAr="استخدم زر «إضافة مصنع» لإنشاء أول مصنع."
      />
    </ManagementShell>
  );
}
