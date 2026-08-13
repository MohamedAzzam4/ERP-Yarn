/**
 * Server actions for raw receipt draft creation and submission.
 *
 * WP-02-04: Wire the approved worker reference screen to real draft
 * persistence/query safely.
 *
 * Server-side auth/tenant/role proof (Risk #4):
 *   - `getErpAuthContextWithRoles()` resolves the user from the Supabase
 *     session cookie server-side. The form/FormData is NEVER trusted for
 *     identity.
 *   - `tenantId` comes from `authResult.tenantId` (server-resolved), never
 *     from `formData`. `rejectBodyClaimsAuthority` inside the service
 *     rejects any body field that claims tenant_id/userId/role/etc.
 *   - `resolveAndRequirePermission(roles, matrix, "inventory.receive.create")`
 *     enforces the worker permission server-side. Production/quality
 *     workers (no inventory.receive.create) are denied.
 *   - `rejectForbiddenWorkerFields` is called for defense-in-depth: even
 *     if a malicious client smuggles a financial field (price, cost,
 *     payable) into FormData, it is rejected, not silently accepted.
 *
 * Draft persistence (Risk #1):
 *   - Uses RawReceiptDraftDbRepository (Drizzle-backed) when DATABASE_URL
 *     is configured. Falls back to InMemoryRawReceiptDraftRepository when
 *     DB is unavailable (dev/CI) so the action is testable.
 *   - No stock movement, no balance update, no account entry.
 *
 * Submit behavior (Risk #2):
 *   - `submit_action=save` → createDraft only (status=draft).
 *   - `submit_action=submit` → createDraft + submitDraft (status=submitted,
 *     approval_status=pending_approval, is_locked=true, subject_hash set).
 *   - Does NOT create approval_requests (out of WP-02-04 scope).
 *   - Does NOT call InventoryLedgerService or SubledgerService.
 */
"use server";

import { redirect } from "next/navigation";
import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import {
  resolveAndRequirePermission,
  rejectForbiddenWorkerFields,
  type GuardError,
} from "@/server/security/guards";
import { isWorkerRole } from "@/server/security/role-codes";
import { getTestRoleAssignments } from "@/server/security/role-fixtures";
import { loadRolePermissionMatrixForTenant } from "@/server/security/permission-loader";
import { InProcessAuditStore } from "@/server/services/audit-service";
import { AuditDbRepository } from "@/server/services/audit-db-repository";
import {
  RawReceiptDraftService,
  type CreateDraftInput,
  type RawReceiptDraftError,
} from "@/server/services/raw-receipt-draft-service";
import { RawReceiptDraftDbRepository } from "@/server/services/raw-receipt-draft-db-repository";
import { InMemoryRawReceiptDraftRepository } from "@/server/services/__tests__/in-memory-raw-receipt-draft-repository";
import { db } from "@/server/db/client";

function getService() {
  // Use the real Drizzle-backed repository when DATABASE_URL is configured.
  // Fall back to the in-memory repository for dev/CI without Supabase.
  // Either way, the service logic is identical — only the persistence
  // layer changes. No stock/payable logic runs in either path.
  if (db) {
    const repository = new RawReceiptDraftDbRepository(db);
    const audit = new AuditDbRepository(db);
    return new RawReceiptDraftService({ repository, audit });
  }
  // Dev/CI fallback without DATABASE_URL — in-memory repos, test-only audit.
  // This path is explicitly non-production.
  const repository = new InMemoryRawReceiptDraftRepository();
  const audit = new InProcessAuditStore();
  return new RawReceiptDraftService({ repository, audit });
}

export async function createRawReceiptDraftAction(
  _prevState: { success: boolean; draftId: string; status: string; error?: string } | null,
  formData: FormData,
) {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const roles = authResult.roles;
  const effective = resolveAndRequirePermission(roles, (await loadRolePermissionMatrixForTenant(authResult.tenantId)), "inventory.receive.create");

  // Build the input from FormData. Only operational fields — NO financial
  // fields are read. Worker financial-deny is enforced by
  // rejectForbiddenWorkerFields below + by CreateDraftInput not having
  // financial fields + by rejectBodyClaimsAuthority inside the service.
  const input: CreateDraftInput = {
    batchNo: (formData.get("batch_no") as string) || "",
    netWeightKg: (formData.get("net_weight_kg") as string) || "0",
    receivedDate: (formData.get("received_date") as string) || "",
    supplierId: (formData.get("supplier_id") as string) || null,
    fiberTypeId: (formData.get("fiber_type_id") as string) || null,
    originCountry: (formData.get("origin_country") as string) || null,
    season: (formData.get("season") as string) || null,
    balesCount: (formData.get("bales_count") as string) || null,
    grossWeightKg: (formData.get("gross_weight_kg") as string) || null,
    storageLocationId: (formData.get("storage_location_id") as string) || null,
    purchaseOrderRef: (formData.get("purchase_order_ref") as string) || null,
    notes: (formData.get("notes") as string) || null,
  };

  // Defense-in-depth: reject forbidden Worker financial fields in the body.
  // This catches any smuggled price/cost/payable field even if the form
  // doesn't render them.
  const bodyForCheck: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    bodyForCheck[key] = value;
  }
  rejectForbiddenWorkerFields(roles, bodyForCheck);

  const submitAction = (formData.get("submit_action") as string) || "save";

  try {
    const service = getService();
    const draft = await service.createDraft(authResult, effective, input);

    if (submitAction === "submit") {
      const submitResult = await service.submitDraft(authResult, effective, draft.id);
      return {
        success: true,
        draftId: submitResult.draftId,
        status: submitResult.status,
      };
    }

    return { success: true, draftId: draft.id, status: draft.status };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return {
      success: false,
      draftId: "",
      status: "error",
      error: message,
    };
  }
}
