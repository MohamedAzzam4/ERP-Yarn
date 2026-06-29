import { redirect } from "next/navigation";
import { getErpAuthContext } from "@/server/auth/erp-context";
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
 */

export default async function HomePage() {
  const authResult = await getErpAuthContext();

  if (!authResult.authenticated) {
    redirect("/login");
  }

  const role = inferRoleFromContext(authResult);
  const shellRoute = getDefaultShellRoute(role);
  redirect(shellRoute);
}

/**
 * TEMPORARY role inference for WP-01-04.
 * Same as worker/management pages — see worker/page.tsx for the unresolved note.
 */
function inferRoleFromContext(ctx: { email: string; name: string }): RoleCode {
  const email = ctx.email.toLowerCase();
  if (email.includes("warehouse")) return "warehouse_employee";
  if (email.includes("production")) return "production_employee";
  if (email.includes("quality")) return "quality_employee";
  if (email.includes("owner") || email.includes("admin")) return "owner";
  if (email.includes("accountant")) return "accountant";
  return "warehouse_employee";
}
