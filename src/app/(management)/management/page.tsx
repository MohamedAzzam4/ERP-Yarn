/**
 * Management Console Home page.
 *
 * Redirects to /management/dashboard after auth/role verification.
 * The dashboard is the primary management landing page.
 */
import { redirect } from "next/navigation";
import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { isManagementShellRole } from "@/components/shells/nav-config";
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

  // Redirect to dashboard (preferred: make /management land on dashboard)
  redirect("/management/dashboard");
}
