/**
 * Management Console Home page.
 *
 * Contract: docs/contracts/10_frontend_screen_contracts.md §5.2
 *   - Permission-filtered grouped RTL sidebar
 *   - Owner and Accountant share the shell
 *   - Accountant does NOT see Owner-only user/security controls (DEC-032)
 *
 * This page resolves the ERP auth context WITH roles (from the database),
 * checks the user has a management role (owner or accountant), and renders
 * the ManagementShell with role-filtered navigation.
 *
 * Role resolution: roles are fetched from the ERP database (user_roles +
 * roles tables) via getErpAuthContextWithRoles(). The Supabase Auth
 * identity is used ONLY for authentication — role context comes from
 * the ERP database, never from email inference (DEC-073).
 */
import { redirect } from "next/navigation";
import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import {
  getManagementNavForRole,
  isManagementShellRole,
} from "@/components/shells/nav-config";
import { ManagementShell } from "@/components/shells/management-shell";
import { signOut } from "@/app/login/actions";
import type { RoleCode } from "@/server/security/role-codes";

export default async function ManagementHomePage() {
  const authResult = await getErpAuthContextWithRoles();

  if (!authResult.authenticated) {
    redirect("/login");
  }

  // If the user has NO role assignments, deny access.
  if (authResult.roles.length === 0) {
    redirect("/login?error=no_role");
  }

  // Check if the user has ANY management role (owner or accountant).
  const managementRole = authResult.roles.find((r) =>
    isManagementShellRole(r),
  ) as RoleCode | undefined;

  if (!managementRole) {
    // Non-management trying to access /management → redirect to worker
    redirect("/worker");
  }

  const navCategories = getManagementNavForRole(managementRole);

  return (
    <ManagementShell
      userName={authResult.name}
      tenantLabel="ERP-Yarn"
      navCategories={navCategories}
      onSignOut={async () => {
        "use server";
        await signOut();
      }}
      breadcrumbs={[{ label: "الرئيسية" }]}
    >
      <div className="space-y-4">
        <h2 className="text-heading-3 text-foreground">لوحة المعلومات</h2>
        <p className="text-body text-muted-foreground">
          مرحباً، {authResult.name}
        </p>
        <p className="text-sm text-muted-foreground">
          المرحلة 1 — WP-01-04: واجهة الإدارة (أساس)
        </p>
        <p className="text-sm text-muted-foreground">
          الدور: {managementRole === "owner" ? "المالك" : "المحاسب"}
        </p>
      </div>
    </ManagementShell>
  );
}
