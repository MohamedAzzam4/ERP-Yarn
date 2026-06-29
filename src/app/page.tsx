import { redirect } from "next/navigation";
import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { getDefaultShellRouteForRoles } from "@/components/shells/nav-config";

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
 * Deterministic routing: uses getDefaultShellRouteForRoles() which applies
 * a fixed priority (management > worker > no role) so the result does NOT
 * depend on the order of the roles array returned by the database.
 */

export default async function HomePage() {
  const authResult = await getErpAuthContextWithRoles();

  if (!authResult.authenticated) {
    redirect("/login");
  }

  // Deterministic shell routing based on role priority (not array order).
  // Management roles take precedence over worker roles.
  const shellRoute = getDefaultShellRouteForRoles(authResult.roles);
  redirect(shellRoute);
}
