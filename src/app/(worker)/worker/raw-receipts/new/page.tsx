/**
 * Worker Raw-Material Receipt Reference Screen page.
 *
 * Route: /worker/raw-receipts/new
 * Fixture: reference-fixtures-v1
 *
 * WP-01-05: This is a reference screen with fixture data only.
 * No real posting, no database writes, no API calls.
 */
import { redirect } from "next/navigation";
import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { isWorkerShellRole } from "@/components/shells/nav-config";
import { WorkerShell } from "@/components/shells/worker-shell";
import { WorkerReceiptReference } from "@/components/reference-screens/worker-receipt-reference";
import { signOut } from "@/app/login/actions";
import type { RoleCode } from "@/server/security/role-codes";

export default async function WorkerReceiptPage() {
  const authResult = await getErpAuthContextWithRoles();

  if (!authResult.authenticated) {
    redirect("/login");
  }

  if (authResult.roles.length === 0) {
    redirect("/login?error=no_role");
  }

  const workerRole = authResult.roles.find((r) => isWorkerShellRole(r)) as RoleCode | undefined;
  if (!workerRole) {
    redirect("/management");
  }

  return (
    <WorkerShell
      userName={authResult.name}
      tasks={[]}
      onSignOut={async () => {
        "use server";
        await signOut();
      }}
    >
      <WorkerReceiptReference />
    </WorkerShell>
  );
}
