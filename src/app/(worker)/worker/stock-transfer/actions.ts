/**
 * Server actions for Worker Stock Transfer task — WP-08-01A.
 *
 * Warehouse employees can create transfer DRAFTS.
 * No posting, approval, reversal, or balance editing.
 *
 * WP-08-01A CORRECTION:
 *   DbTenantOwnershipValidator is REQUIRED — the service validates item,
 *   source location, and destination location all belong to the actor's
 *   tenant BEFORE any write (idempotency claim, approval_requests insert,
 *   audit). A valid Tenant-B item/location used by Tenant-A is rejected
 *   with ZERO writes.
 */
"use server";

import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { resolveAndRequirePermission } from "@/server/security/guards";
import { requireWarehouseTaskActor } from "@/server/security/inventory-guards";
import { TEST_ROLE_PERMISSION_MATRIX } from "@/server/security/role-fixtures";
import { TransferWorkflowService } from "@/server/services/transfer-workflow-service";
import { RawReceiptApprovalDbRepository } from "@/server/services/raw-receipt-approval-db-repository";
import { InventoryLedgerService } from "@/server/services/inventory-ledger-service";
import { InventoryLedgerDbRepository } from "@/server/services/inventory-ledger-db-repository";
import { AuditDbRepository } from "@/server/services/audit-db-repository";
import { InProcessIdempotencyStore } from "@/server/services/idempotency-service";
import { InProcessDocumentSequenceStore } from "@/server/services/document-sequence-service";
import { DbTenantOwnershipValidator } from "@/server/services/db-tenant-ownership-validator";
import { db } from "@/server/db/client";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

function getTransferService() {
  if (!db) throw new Error("Database not available.");
  const audit = new AuditDbRepository(db);
  const idempotency = new InProcessIdempotencyStore();
  const documentSequence = new InProcessDocumentSequenceStore();
  const tenantOwnershipValidator = new DbTenantOwnershipValidator(db);
  const inventoryLedger = new InventoryLedgerService({
    ledger: new InventoryLedgerDbRepository(db), audit, idempotency, documentSequence,
  });
  return new TransferWorkflowService({
    approvalRepository: new RawReceiptApprovalDbRepository(db),
    inventoryLedger, audit, idempotency,
    tenantOwnershipValidator,
  });
}

// Forbidden fields that workers must NEVER submit
const FORBIDDEN_TRANSFER_FIELDS = [
  "price", "pricePerTon", "cost", "value", "totalCost",
  "payable", "receivable", "account", "settlement",
  "refund", "credit", "financialTreatment",
  "approvalStatus", "movementStatus", "docNo",
  "approve", "post", "reverse", "cancel",
];

export async function createTransferDraft(formData: FormData): Promise<void> {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  requireWarehouseTaskActor(authResult as any, authResult.roles);

  const effective = resolveAndRequirePermission(
    authResult.roles, TEST_ROLE_PERMISSION_MATRIX, "inventory.transfer.create",
  );

  // Reject forbidden fields in payload
  for (const field of FORBIDDEN_TRANSFER_FIELDS) {
    if (formData.has(field)) {
      throw new Error(`FORBIDDEN_FIELD: Field '${field}' is not allowed in worker transfer request.`);
    }
  }

  const service = getTransferService();
  await service.createTransferRequest(authResult as any, effective, {
    itemId: String(formData.get("itemId")),
    fromLocationId: String(formData.get("fromLocationId")),
    toLocationId: String(formData.get("toLocationId")),
    quantityKg: String(formData.get("quantityKg")),
    reason: formData.get("reason") ? String(formData.get("reason")) : null,
    idempotencyKey: String(formData.get("idempotencyKey")),
  });

  revalidatePath("/worker/stock-transfer");
}
