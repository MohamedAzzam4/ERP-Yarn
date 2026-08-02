/**
 * Server actions for Worker Return Receipt task — WP-08-01A.
 *
 * Warehouse employees can create return requests with physical/classification facts.
 * No financial treatment, refund, credit, or replacement approval.
 *
 * WP-08-01A CORRECTION:
 *   The worker MUST submit `saleLineId` (the original sale's line ID). The
 *   service validates `saleLineId -> saleOrderId -> customerId` and
 *   `saleLineId -> itemId` via DbTenantOwnershipValidator BEFORE any write.
 *   `itemId` alone is NEVER used as `originalSaleLineId` — that would
 *   bypass the sale-line/order/item relation chain and allow referencing
 *   a line from a different sale.
 */
"use server";

import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { resolveAndRequirePermission } from "@/server/security/guards";
import { requireWarehouseTaskActor } from "@/server/security/inventory-guards";
import { TEST_ROLE_PERMISSION_MATRIX } from "@/server/security/role-fixtures";
import { ReturnRequestService } from "@/server/services/return-request-service";
import { ReturnRequestDbRepository } from "@/server/services/return-request-db-repository";
import { SalesDbRepository } from "@/server/services/sales-db-repository";
import { AuditDbRepository } from "@/server/services/audit-db-repository";
import { InProcessIdempotencyStore } from "@/server/services/idempotency-service";
import { InProcessDocumentSequenceStore } from "@/server/services/document-sequence-service";
import { DbTenantOwnershipValidator } from "@/server/services/db-tenant-ownership-validator";
import { db } from "@/server/db/client";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

function getReturnService() {
  if (!db) throw new Error("Database not available.");
  const audit = new AuditDbRepository(db);
  const idempotency = new InProcessIdempotencyStore();
  const documentSequence = new InProcessDocumentSequenceStore();
  const tenantOwnershipValidator = new DbTenantOwnershipValidator(db);
  // ReturnRequestService requires inventoryLedger, subledger, snapshotService
  // for the APPROVAL path. For draft creation, we pass minimal stubs.
  // The service's createReturnRequest method only uses returnRequestRepository,
  // salesRepository, and tenantOwnershipValidator — it does not post inventory
  // or subledger until approval.
  const { InventoryLedgerService } = require("@/server/services/inventory-ledger-service");
  const { InventoryLedgerDbRepository } = require("@/server/services/inventory-ledger-db-repository");
  const { SubledgerService } = require("@/server/services/subledger-service");
  const { SubledgerDbRepository } = require("@/server/services/subledger-db-repository");
  const { ProfitabilitySnapshotService } = require("@/server/services/profitability-snapshot-service");
  const { ProfitabilitySnapshotDbRepository } = require("@/server/services/profitability-snapshot-db-repository");
  const inventoryLedger = new InventoryLedgerService({
    ledger: new InventoryLedgerDbRepository(db), audit, idempotency, documentSequence,
  });
  const subledger = new SubledgerService({
    subledger: new SubledgerDbRepository(db), audit, idempotency, documentSequence,
  });
  const snapshotService = new ProfitabilitySnapshotService({
    snapshotRepository: new ProfitabilitySnapshotDbRepository(db),
    salesRepository: new SalesDbRepository(db), audit,
  });
  return new ReturnRequestService({
    returnRequestRepository: new ReturnRequestDbRepository(db),
    salesRepository: new SalesDbRepository(db),
    inventoryLedger, subledger, snapshotService,
    audit, idempotency, documentSequence,
    tenantOwnershipValidator,
  });
}

// Forbidden fields that workers must NEVER submit
const FORBIDDEN_RETURN_FIELDS = [
  "price", "pricePerTon", "cost", "value", "totalCost",
  "payable", "receivable", "account", "settlement",
  "refund", "creditAmount", "creditValue",
  "financialTreatment", "isReplacement",
  "approvalStatus", "approve", "post", "reverse", "cancel",
];

export async function createReturnRequest(formData: FormData): Promise<void> {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  requireWarehouseTaskActor(authResult as any, authResult.roles);

  const effective = resolveAndRequirePermission(
    authResult.roles, TEST_ROLE_PERMISSION_MATRIX, "returns.create",
  );

  // Reject forbidden fields in payload
  for (const field of FORBIDDEN_RETURN_FIELDS) {
    if (formData.has(field)) {
      throw new Error(`FORBIDDEN_FIELD: Field '${field}' is not allowed in worker return request.`);
    }
  }

  // WP-08-01A: saleLineId is REQUIRED. Never substitute itemId for saleLineId.
  const saleLineId = String(formData.get("saleLineId") ?? "").trim();
  if (!saleLineId) {
    throw new Error("VALIDATION_FAILED: saleLineId is required. Worker must select the original sale line.");
  }

  const service = getReturnService();
  await service.createReturnRequest(authResult as any, effective, {
    salesOrderId: String(formData.get("salesOrderId")),
    customerId: String(formData.get("customerId")),
    returnDate: String(formData.get("returnDate")),
    returnReason: String(formData.get("returnReason")),
    // Worker does NOT set financialTreatment or isReplacement.
    // These default to null/false (undecided) at the domain layer.
    // Management decides financial treatment at approval time (Contract 06 §9).
    lines: [{
      originalSaleOrderId: String(formData.get("salesOrderId")),
      originalSaleLineId: saleLineId,
      itemId: String(formData.get("itemId")),
      quantityKg: String(formData.get("quantityKg")),
      returnLocationId: String(formData.get("returnLocationId")),
      returnedStockStatus: String(formData.get("returnedStockStatus")) as any,
    }],
    idempotencyKey: String(formData.get("idempotencyKey")),
  });

  revalidatePath("/worker/return-receipt");
}
