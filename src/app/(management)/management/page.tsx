/**
 * Management Console Home page.
 *
 * Contract: docs/contracts/10_frontend_screen_contracts.md §5.2
 *   - Permission-filtered grouped RTL sidebar
 *   - Owner and Accountant share the shell
 *   - Accountant does NOT see Owner-only user/security controls (DEC-032)
 *
 * This page resolves the ERP auth context, checks the role is a management
 * role, and renders the ManagementShell with role-filtered navigation.
 */
import { redirect } from "next/navigation";
import { getErpAuthContext } from "@/server/auth/erp-context";
import {
  getManagementNavForRole,
  isManagementShellRole,
} from "@/components/shells/nav-config";
import { ManagementShell } from "@/components/shells/management-shell";
import { signOut } from "@/app/login/actions";
import type { RoleCode } from "@/server/security/role-codes";

export default async function ManagementHomePage() {
  const authResult = await getErpAuthContext();

  if (!authResult.authenticated) {
    redirect("/login");
  }

  const role: RoleCode = inferRoleFromContext(authResult);

  if (!isManagementShellRole(role)) {
    // Non-management trying to access /management → redirect to worker
    redirect("/worker");
  }

  const navCategories = getManagementNavForRole(role);

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
          الدور: {role === "owner" ? "المالك" : "المحاسب"}
        </p>
      </div>
    </ManagementShell>
  );
}

/**
 * TEMPORARY role inference for WP-01-04.
 * Same as worker page — see that file for the unresolved note.
 */
function inferRoleFromContext(ctx: { email: string; name: string }): RoleCode {
  const email = ctx.email.toLowerCase();
  if (email.includes("owner") || email.includes("admin")) return "owner";
  if (email.includes("accountant")) return "accountant";
  if (email.includes("warehouse")) return "warehouse_employee";
  if (email.includes("production")) return "production_employee";
  if (email.includes("quality")) return "quality_employee";
  // Default: accountant (management shell is safer default for testing)
  return "accountant";
}
