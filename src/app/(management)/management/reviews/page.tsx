/**
 * Accountant Review Queue Reference Screen page.
 *
 * Route: /management/reviews
 * Fixture: reference-fixtures-v1
 *
 * WP-01-06: This is a reference screen with fixture data only.
 * No real approvals, no database writes, no API calls.
 */
import { redirect } from "next/navigation";
import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { getManagementNavForRole, isManagementShellRole } from "@/components/shells/nav-config";
import { ManagementShell } from "@/components/shells/management-shell";
import { ReviewQueueReference } from "@/components/reference-screens/review-queue-reference";
import { signOut } from "@/app/login/actions";
import type { RoleCode } from "@/server/security/role-codes";

export default async function ReviewsPage() {
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

  return (
    <ManagementShell
      userName={authResult.name}
      tenantLabel="ERP-Yarn"
      navCategories={navCategories}
      onSignOut={async () => {
        "use server";
        await signOut();
      }}
      breadcrumbs={[{ label: "الرئيسية", href: "/management" }, { label: "مركز المراجعات" }]}
    >
      <ReviewQueueReference />
    </ManagementShell>
  );
}
