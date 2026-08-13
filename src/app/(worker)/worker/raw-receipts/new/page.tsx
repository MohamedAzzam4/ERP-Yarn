/**
 * Worker Raw-Material Receipt Screen page (WP-02-04 wired).
 *
 * Route: /worker/raw-receipts/new
 *
 * WP-02-04: This page is now wired to real draft persistence via the
 * RawReceiptDraftService. The worker can create a draft and submit it
 * for review. No stock posting, no financial fields.
 *
 * Real master-data wiring (Risk #3 correction):
 *   - Suppliers, locations, and fiber types are fetched from the real
 *     MasterDataService (Drizzle-backed when DATABASE_URL is configured).
 *   - Workers have `master_data.view_names` permission, which is the
 *     minimum required by `requireAnyMasterDataViewPermission`.
 *   - When the DB is unavailable or no master data exists, the form
 *     shows an explicit empty state — it does NOT submit hardcoded
 *     placeholder IDs.
 */
import { redirect } from "next/navigation";
import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { isWorkerShellRole } from "@/components/shells/nav-config";
import { WorkerShell } from "@/components/shells/worker-shell";
import { WorkerReceiptForm } from "@/components/reference-screens/worker-receipt-form";
import { signOut } from "@/app/login/actions";
import type { RoleCode } from "@/server/security/role-codes";
import { db } from "@/server/db/client";
import { MasterDataDbRepository } from "@/server/services/master-data-db-repository";
import { MasterDataService } from "@/server/services/master-data-service";
import { AuditDbRepository } from "@/server/services/audit-db-repository";
import type { EffectivePermissions } from "@/server/security/effective-permissions";
import { resolveEffectivePermissions } from "@/server/security/effective-permissions";
import { loadRolePermissionMatrixForTenant } from "@/server/security/permission-loader";
import type { Supplier, Location, FiberType } from "@/server/db/schema/master-data";

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

  // Fetch real master-data options for the form.
  // Workers have `master_data.view_names` permission, which is the minimum
  // required by `requireAnyMasterDataViewPermission`. We do NOT render
  // hardcoded fixture/demo data as if it were live.
  let suppliers: Supplier[] = [];
  let locations: Location[] = [];
  let fiberTypes: FiberType[] = [];
  let dbAvailable = false;

  if (db) {
    const repository = new MasterDataDbRepository(db);
    const service = new MasterDataService({
      repository,
      // Audit store for persistent audit_logs (read-only page — use
      // AuditDbRepository for consistency with production wiring).
      audit: new AuditDbRepository(db),
    });
    const effective: EffectivePermissions = resolveEffectivePermissions(
      authResult.roles,
      (await loadRolePermissionMatrixForTenant(authResult.tenantId)),
    );
    try {
      const userContext = { ...authResult, tenantId: authResult.tenantId };
      [suppliers, locations, fiberTypes] = await Promise.all([
        service.listActiveSuppliers(userContext, effective),
        service.listActiveLocations(userContext, effective),
        service.listActiveFiberTypes(userContext, effective),
      ]);
      dbAvailable = true;
    } catch {
      // DB query failed — fall through to empty state.
      dbAvailable = false;
    }
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
      <WorkerReceiptForm
        suppliers={suppliers.map((s) => ({ id: s.id, nameAr: s.nameAr, code: s.supplierCode }))}
        locations={locations.map((l) => ({ id: l.id, nameAr: l.nameAr, code: l.locationCode }))}
        fiberTypes={fiberTypes.map((f) => ({ id: f.id, nameAr: f.nameAr, code: f.code }))}
        dbAvailable={dbAvailable}
      />
    </WorkerShell>
  );
}
