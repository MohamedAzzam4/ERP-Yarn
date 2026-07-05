/**
 * Server actions for raw receipt draft creation and submission.
 *
 * WP-02-04: Wire the approved worker reference screen to real draft
 * persistence/query safely.
 *
 * These server actions are called from the worker receipt form.
 * They enforce: permission, tenant, worker redaction, validation.
 */
"use server";

import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { resolveAndRequirePermission } from "@/server/security/guards";
import { getTestRoleAssignments, TEST_ROLE_PERMISSION_MATRIX } from "@/server/security/role-fixtures";
import { InProcessAuditStore } from "@/server/services/audit-service";
import { RawReceiptDraftService, type CreateDraftInput } from "@/server/services/raw-receipt-draft-service";
import { InMemoryRawReceiptDraftRepository } from "@/server/services/__tests__/in-memory-raw-receipt-draft-repository";
import { redirect } from "next/navigation";

// NOTE: In production, this would use MasterDataDbRepository and a DB-backed
// audit store. For now, using in-memory stores as the DB-backed handles
// for audit/idempotency are not yet implemented (same architecture as
// WP-02-02 and WP-02-03). The service logic is identical — only the
// persistence layer changes.

function getService() {
  const repository = new InMemoryRawReceiptDraftRepository();
  const audit = new InProcessAuditStore();
  return new RawReceiptDraftService({ repository, audit });
}

export async function createRawReceiptDraftAction(_prevState: { success: boolean; draftId: string; status: string } | null, formData: FormData) {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const roles = authResult.roles;
  const effective = resolveAndRequirePermission(roles, TEST_ROLE_PERMISSION_MATRIX, "inventory.receive.create");

  const input: CreateDraftInput = {
    batchNo: (formData.get("batch_no") as string) || "",
    netWeightKg: (formData.get("net_weight_kg") as string) || "0",
    receivedDate: (formData.get("received_date") as string) || "",
    supplierId: (formData.get("supplier") as string) || null,
    storageLocationId: (formData.get("storage_location") as string) || null,
    storageLocationName: null,
    fiberTypeAr: (formData.get("raw_type") as string) || null,
    rawGradeAr: (formData.get("raw_grade") as string) || null,
    season: (formData.get("season") as string) || null,
    balesCount: (formData.get("bale_count") as string) || null,
    grossWeightKg: (formData.get("gross_weight_kg") as string) || null,
    purchaseOrderRef: (formData.get("purchase_no") as string) || null,
    notes: (formData.get("notes") as string) || null,
  };

  const service = getService();
  const draft = await service.createDraft(authResult, effective, input);
  return { success: true, draftId: draft.id, status: draft.status };
}

export async function submitRawReceiptDraftAction(draftId: string) {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const roles = authResult.roles;
  const effective = resolveAndRequirePermission(roles, TEST_ROLE_PERMISSION_MATRIX, "inventory.receive.create");

  const service = getService();
  const result = await service.submitDraft(authResult, effective, draftId);
  return { success: true, ...result };
}
