/**
 * Worker Task Mode Home page.
 *
 * Contract: docs/contracts/10_frontend_screen_contracts.md §5.1
 *   - Role-authorized task cards
 *   - No module tree, no financial widgets
 *   - Backend rejects unauthorized task even if URL is entered
 *
 * This page resolves the ERP auth context, checks the role is a worker
 * role, and renders the WorkerShell with role-filtered task cards.
 * If the user is not a worker, they are denied (should not reach this page).
 */
import { redirect } from "next/navigation";
import { getErpAuthContext } from "@/server/auth/erp-context";
import { getWorkerTasksForRole, isWorkerShellRole } from "@/components/shells/nav-config";
import { WorkerShell } from "@/components/shells/worker-shell";
import { signOut } from "@/app/login/actions";
import type { RoleCode } from "@/server/security/role-codes";

export default async function WorkerHomePage() {
  const authResult = await getErpAuthContext();

  if (!authResult.authenticated) {
    redirect("/login");
  }

  // Determine the user's role. In MVP, users have one active role (DEC-061).
  // For the shell, we use the first role. A proper role-resolution service
  // would use WP-01-02's effective-permissions, but for shell routing we
  // only need the role code.
  // NOTE: The ERP auth context does not currently include roles. For WP-01-04,
  // we use a placeholder: check the user's email pattern to determine the
  // role for demo purposes. In production, this would come from a
  // getUserRoles(userId) query against the user_roles table.
  // This is a KNOWN LIMITATION of WP-01-04 — the real role resolution
  // will be wired when the user management UI (WP-08-01H) is built.
  const role: RoleCode = inferRoleFromContext(authResult);

  if (!isWorkerShellRole(role)) {
    // Non-worker trying to access /worker → redirect to management
    redirect("/management");
  }

  const tasks = getWorkerTasksForRole(role);

  return (
    <WorkerShell
      userName={authResult.name}
      tasks={tasks}
      onSignOut={async () => {
        "use server";
        await signOut();
      }}
    >
      <p className="text-sm text-muted-foreground text-center">
        المرحلة 1 — WP-01-04: واجهة المهام (أساس)
      </p>
    </WorkerShell>
  );
}

/**
 * TEMPORARY role inference for WP-01-04.
 *
 * This is a placeholder until user_roles resolution is wired into the ERP
 * auth context. It infers the role from the user's email for demo/testing.
 * In production, this MUST be replaced with a real query to the
 * user_roles table joined with the roles table.
 *
 * Unresolved / requires owner decision: the ERP auth context (getErpAuthContext)
 * does not currently return the user's role(s). This is a gap that should
 * be addressed in a future package (WP-08-01H Settings/User UI or an
 * earlier auth-context enhancement).
 */
function inferRoleFromContext(ctx: { email: string; name: string }): RoleCode {
  const email = ctx.email.toLowerCase();
  if (email.includes("warehouse")) return "warehouse_employee";
  if (email.includes("production")) return "production_employee";
  if (email.includes("quality")) return "quality_employee";
  if (email.includes("owner") || email.includes("admin")) return "owner";
  if (email.includes("accountant")) return "accountant";
  // Default: warehouse worker (safest — most restricted)
  return "warehouse_employee";
}
