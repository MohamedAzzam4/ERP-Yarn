/**
 * Worker Task Mode Home page.
 *
 * Contract: docs/contracts/10_frontend_screen_contracts.md §5.1
 *   - Role-authorized task cards
 *   - No module tree, no financial widgets
 *   - Backend rejects unauthorized task even if URL is entered
 *
 * This page resolves the ERP auth context WITH roles (from the database),
 * checks the user has a worker role, and renders the WorkerShell with
 * role-filtered task cards. If the user is not a worker, they are
 * redirected to /management.
 *
 * Role resolution: roles are fetched from the ERP database (user_roles +
 * roles tables) via getErpAuthContextWithRoles(). The Supabase Auth
 * identity is used ONLY for authentication — role context comes from
 * the ERP database, never from email inference (DEC-073).
 */
import { redirect } from "next/navigation";
import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { getWorkerTasksForRole, isWorkerShellRole } from "@/components/shells/nav-config";
import { WorkerShell } from "@/components/shells/worker-shell";
import { signOut } from "@/app/login/actions";
import type { RoleCode } from "@/server/security/role-codes";

export default async function WorkerHomePage() {
  const authResult = await getErpAuthContextWithRoles();

  if (!authResult.authenticated) {
    redirect("/login");
  }

  // If the user has NO role assignments, deny access.
  if (authResult.roles.length === 0) {
    redirect("/login?error=no_role");
  }

  // Check if the user has ANY worker role.
  // DEC-061: MVP normally one role. If multiple roles exist, the user
  // sees the shell of their first worker role (if any). If they have
  // only management roles, redirect to management.
  const workerRole = authResult.roles.find((r) => isWorkerShellRole(r)) as RoleCode | undefined;

  if (!workerRole) {
    // Non-worker trying to access /worker → redirect to management
    redirect("/management");
  }

  const tasks = getWorkerTasksForRole(workerRole);

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
