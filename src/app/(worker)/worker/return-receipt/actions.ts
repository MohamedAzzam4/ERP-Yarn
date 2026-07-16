/**
 * Server actions for Worker Return Receipt task — WP-08-01A.
 *
 * Warehouse employees can create return requests with physical/classification facts.
 * No financial treatment, refund, credit, or replacement approval.
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
import { db } from "@/server/db/client";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

function getReturnService() {
  if (!db) throw new Error("Database not available.");
  const audit = new AuditDbRepository(db);
  const idempotency = new InProcessIdempotencyStore();
  const documentSequence = new InProcessDocumentSequenceStore();
  // ReturnRequestService requires inventoryLedger, subledger, snapshotService
  // for the APPROVAL path. For draft creation, we pass minimal stubs.
  // The service's createReturnRequest method only uses returnRequestRepository
  // and salesRepository — it does not post inventory or subledger.
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

  const service = getReturnService();
  await service.createReturnRequest(authResult as any, effective, {
    salesOrderId: String(formData.get("salesOrderId")),
    customerId: String(formData.get("customerId")),
    returnDate: String(formData.get("returnDate")),
    returnReason: String(formData.get("returnReason")),
    // Worker can only set "no_financial_impact" — financial treatment is management
    financialTreatment: "no_financial_impact",
    isReplacement: false,
    lines: [{
      originalSaleOrderId: String(formData.get("salesOrderId")),
      originalSaleLineId: String(formData.get("itemId")),
      itemId: String(formData.get("itemId")),
      quantityKg: String(formData.get("quantityKg")),
      returnLocationId: String(formData.get("returnLocationId")),
      returnedStockStatus: String(formData.get("returnedStockStatus")) as any,
    }],
    idempotencyKey: String(formData.get("idempotencyKey")),
  });

  revalidatePath("/worker/return-receipt");
}
