/**
 * Server actions for Management Return/Replacement — WP-08-01E.
 *
 * Contract 10 §8.7: Quality, Complaint, and Return Management.
 * Contract 09 §11: POST /api/v1/returns/:returnId/approve → returns.approve
 *
 * Actions:
 * 1. approveReturnAction → ReturnRequestService.approveReturnRequest
 *    (permission: returns.approve)
 * 2. rejectReturnAction → ReturnRequestService.rejectReturnRequest
 *    (permission: returns.approve)
 *
 * All persistence is DB-backed:
 *   - ReturnRequestDbRepository (Drizzle)
 *   - SubledgerDbRepository (Drizzle)
 *   - AuditDbRepository (Drizzle)
 *   - IdempotencyDbRepository (Drizzle)
 *   - DocumentSequenceDbRepository (Drizzle)
 *
 * NO in-memory test repositories are used in production actions.
 *
 * Forbidden (per Contract 10 §8.7):
 *   - Return above cap (service enforces DEC-068)
 *   - Unlinked replacement difference (service enforces linkage)
 *   - Automatic refund (refund is separate payment command)
 *   - Worker financial decision (workers denied via permission check)
 */
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { resolveAndRequirePermission } from "@/server/security/guards";
import { TEST_ROLE_PERMISSION_MATRIX } from "@/server/security/role-fixtures";
import { ReturnRequestService } from "@/server/services/return-request-service";
import { SubledgerService } from "@/server/services/subledger-service";
import { SubledgerDbRepository } from "@/server/services/subledger-db-repository";
import { ReturnRequestDbRepository } from "@/server/services/return-request-db-repository";
import { InventoryLedgerService } from "@/server/services/inventory-ledger-service";
import { InventoryLedgerDbRepository } from "@/server/services/inventory-ledger-db-repository";
import { ProfitabilitySnapshotService } from "@/server/services/profitability-snapshot-service";
import { ProfitabilitySnapshotDbRepository } from "@/server/services/profitability-snapshot-db-repository";
import { SalesDbRepository } from "@/server/services/sales-db-repository";
import { DbTenantOwnershipValidator } from "@/server/services/db-tenant-ownership-validator";
import { AuditDbRepository } from "@/server/services/audit-db-repository";
import { IdempotencyDbRepository } from "@/server/services/idempotency-db-repository";
import { DocumentSequenceDbRepository } from "@/server/services/document-sequence-db-repository";
import { db } from "@/server/db/client";

// ---------------------------------------------------------------------------
// Forbidden fields — client must NEVER submit these.
// ---------------------------------------------------------------------------

const FORBIDDEN_RETURN_FIELDS = [
  "returnNo",
  "docNo",
  "tenantId",
  "createdBy",
  "updatedBy",
  "approvedBy",
  "approvedAt",
  "auditLogId",
  "idempotencyRecordId",
  // Financial authority fields (server-computed per Contract 09 §11)
  "customerAdjustmentAmount",
  "returnCreditValue",
  "residualAdjustment",
  "cumulativePriorReturnQty",
  "cumulativePriorReturnCredit",
  "replacementOrderId",
];

function rejectForbiddenFields(
  formData: FormData,
  operation: string,
): void {
  for (const field of FORBIDDEN_RETURN_FIELDS) {
    if (formData.has(field)) {
      throw new Error(
        `FORBIDDEN_FIELD: Field '${field}' is not allowed in ${operation}.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Shared deps — DB-backed, no in-memory stores.
// ---------------------------------------------------------------------------

function getSharedDeps() {
  if (!db) throw new Error("Database not available.");
  const audit = new AuditDbRepository(db);
  const idempotency = new IdempotencyDbRepository(db);
  const documentSequence = new DocumentSequenceDbRepository(db);
  return { db, audit, idempotency, documentSequence };
}

// ---------------------------------------------------------------------------
// Action 1: Approve a return request.
// ---------------------------------------------------------------------------

export async function approveReturnAction(
  formData: FormData,
): Promise<void> {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const effective = resolveAndRequirePermission(
    authResult.roles,
    TEST_ROLE_PERMISSION_MATRIX,
    "returns.approve",
  );

  rejectForbiddenFields(formData, "return approve");

  const returnId = String(formData.get("returnId") ?? "").trim();
  const financialTreatment = String(
    formData.get("financialTreatment") ?? "",
  ).trim();
  const decisionReason = String(
    formData.get("decisionReason") ?? "",
  ).trim();
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();

  if (!returnId || !financialTreatment || !decisionReason || !idempotencyKey) {
    throw new Error(
      "VALIDATION_FAILED: returnId, financialTreatment, decisionReason, and idempotencyKey are required.",
    );
  }

  const { db: dbInstance, audit, idempotency, documentSequence } =
    getSharedDeps();

  const returnRequestRepository = new ReturnRequestDbRepository(dbInstance);
  const subledger = new SubledgerService({
    subledger: new SubledgerDbRepository(dbInstance),
    audit,
    idempotency,
    documentSequence,
  });
  const inventoryLedger = new InventoryLedgerService({
    ledger: new InventoryLedgerDbRepository(dbInstance),
    audit,
    idempotency,
    documentSequence,
  });
  const snapshotService = new ProfitabilitySnapshotService({
    snapshotRepository: new ProfitabilitySnapshotDbRepository(dbInstance),
    salesRepository: new SalesDbRepository(dbInstance),
    audit,
  });
  const salesRepository = new SalesDbRepository(dbInstance);
  const tenantOwnershipValidator = new DbTenantOwnershipValidator(dbInstance);

  const service = new ReturnRequestService({
    returnRequestRepository,
    subledger,
    inventoryLedger,
    salesRepository,
    snapshotService,
    tenantOwnershipValidator,
    audit,
    idempotency,
    documentSequence,
  });

  await service.approveReturnRequest(authResult as any, effective, {
    returnRequestId: returnId,
    idempotencyKey,
    decisionNotes: decisionReason,
  });

  revalidatePath("/management/quality/returns");
}

// ---------------------------------------------------------------------------
// Action 2: Reject a return request.
// ---------------------------------------------------------------------------

export async function rejectReturnAction(
  formData: FormData,
): Promise<void> {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const effective = resolveAndRequirePermission(
    authResult.roles,
    TEST_ROLE_PERMISSION_MATRIX,
    "returns.approve",
  );

  rejectForbiddenFields(formData, "return reject");

  const returnId = String(formData.get("returnId") ?? "").trim();
  const decisionReason = String(
    formData.get("decisionReason") ?? "",
  ).trim();
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();

  if (!returnId || !decisionReason || !idempotencyKey) {
    throw new Error(
      "VALIDATION_FAILED: returnId, decisionReason, and idempotencyKey are required.",
    );
  }

  const { db: dbInstance, audit, idempotency, documentSequence } =
    getSharedDeps();

  const returnRequestRepository = new ReturnRequestDbRepository(dbInstance);
  const subledger = new SubledgerService({
    subledger: new SubledgerDbRepository(dbInstance),
    audit,
    idempotency,
    documentSequence,
  });
  const inventoryLedger = new InventoryLedgerService({
    ledger: new InventoryLedgerDbRepository(dbInstance),
    audit,
    idempotency,
    documentSequence,
  });
  const snapshotService = new ProfitabilitySnapshotService({
    snapshotRepository: new ProfitabilitySnapshotDbRepository(dbInstance),
    salesRepository: new SalesDbRepository(dbInstance),
    audit,
  });
  const salesRepository = new SalesDbRepository(dbInstance);
  const tenantOwnershipValidator = new DbTenantOwnershipValidator(dbInstance);

  const service = new ReturnRequestService({
    returnRequestRepository,
    subledger,
    inventoryLedger,
    salesRepository,
    snapshotService,
    tenantOwnershipValidator,
    audit,
    idempotency,
    documentSequence,
  });

  await service.rejectReturnRequest(authResult as any, effective, {
    returnRequestId: returnId,
    rejectionReason: decisionReason,
    idempotencyKey,
  });

  revalidatePath("/management/quality/returns");
}
