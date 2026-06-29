import { redirect } from "next/navigation";
import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { getDefaultShellRoute } from "@/components/shells/nav-config";
import type { RoleCode } from "@/server/security/role-codes";

/**
 * Home page — role-aware redirect to the appropriate shell.
 *
 * If authenticated, redirects to /worker (for worker roles) or /management
 * (for management roles). If not authenticated, the proxy will have already
 * redirected to /login.
 *
 * WP-01-04 scope: role-aware routing. The actual shell content is in
 * /worker/page.tsx and /management/page.tsx.
 *
 * Role resolution: roles are fetched from the ERP database (user_roles +
 * roles tables) via getErpAuthContextWithRoles(). The Supabase Auth
 * identity is used ONLY for authentication — role/tenant/permission
 * context comes from the ERP database, never from email inference or
 * request body (DEC-073).
 *
 * If the user has multiple roles (exceptional Owner-managed case per
 * DEC-061), the FIRST role determines the shell. This is safe because:
 *   - Worker financial-deny ceiling (DEC-063) is enforced at the
 *     permission/field level, not at the shell-routing level.
 *   - A user with both Owner + Worker roles will see the management shell
 *     but financial field redaction still applies (WP-01-02 redaction).
 */

export default async function HomePage() {
  const authResult = await getErpAuthContextWithRoles();

  if (!authResult.authenticated) {
    redirect("/login");
  }

  // If the user has NO role assignments, they cannot access any shell.
  // Redirect to a "no assigned role" page (or back to login with a message).
  if (authResult.roles.length === 0) {
    redirect("/login?error=no_role");
  }

  // Use the first role for shell routing (DEC-061: MVP normally one role).
  const primaryRole = authResult.roles[0] as RoleCode;
  const shellRoute = getDefaultShellRoute(primaryRole);
  redirect(shellRoute);
}
