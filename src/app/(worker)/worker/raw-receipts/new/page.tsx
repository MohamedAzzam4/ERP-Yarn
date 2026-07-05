/**
 * Worker Raw-Material Receipt Screen page (WP-02-04 wired).
 *
 * Route: /worker/raw-receipts/new
 *
 * WP-02-04: This page is now wired to real draft persistence via the
 * RawReceiptDraftService. The worker can create a draft and submit it
 * for review. No stock posting, no financial fields.
 *
 * The form uses server actions (createRawReceiptDraftAction,
 * submitRawReceiptDraftAction) for persistence.
 */
import { redirect } from "next/navigation";
import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { isWorkerShellRole } from "@/components/shells/nav-config";
import { WorkerShell } from "@/components/shells/worker-shell";
import { WorkerReceiptForm } from "@/components/reference-screens/worker-receipt-form";
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
      <WorkerReceiptForm />
    </WorkerShell>
  );
}
