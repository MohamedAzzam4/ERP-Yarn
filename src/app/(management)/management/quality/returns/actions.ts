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
import { loadRolePermissionMatrixForTenant } from "@/server/security/permission-loader";
import { ReturnRequestService } from "@/server/services/return-request-service";
import { ReplacementWorkflowService } from "@/server/services/replacement-workflow-service";
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
    (await loadRolePermissionMatrixForTenant(authResult.tenantId)),
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

  // WP-08-01E D-1 fix: wire transactionRunner + txFactories so all DB writes
  // in approveReturnRequest (stock movement, inventory balance, account
  // entry, return_lines credit, profitability snapshot, sales_orders state,
  // return_requests status, audit_logs) commit/rollback atomically.
  // Without this, a partial failure leaves inconsistent state.
  const transactionRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
    (dbInstance as any).transaction(async (tx: any) => work(tx));
  const txFactories = {
    createInventoryLedger: (tx: unknown) => new InventoryLedgerService({
      ledger: new InventoryLedgerDbRepository(tx as any),
      audit: new AuditDbRepository(tx as any),
      idempotency: new IdempotencyDbRepository(tx as any),
      documentSequence: new DocumentSequenceDbRepository(tx as any),
    }),
    createSubledger: (tx: unknown) => new SubledgerService({
      subledger: new SubledgerDbRepository(tx as any),
      audit: new AuditDbRepository(tx as any),
      idempotency: new IdempotencyDbRepository(tx as any),
      documentSequence: new DocumentSequenceDbRepository(tx as any),
    }),
    createSnapshotService: (tx: unknown) => new ProfitabilitySnapshotService({
      snapshotRepository: new ProfitabilitySnapshotDbRepository(tx as any),
      salesRepository: new SalesDbRepository(tx as any),
      audit: new AuditDbRepository(tx as any),
    }),
    createSalesRepository: (tx: unknown) => new SalesDbRepository(tx as any),
    createReturnRequestRepository: (tx: unknown) => new ReturnRequestDbRepository(tx as any),
    createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
    createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
  };

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
    transactionRunner,
    txFactories,
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
    (await loadRolePermissionMatrixForTenant(authResult.tenantId)),
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

  // WP-08-01E D-3 fix: wire transactionRunner + txFactories so reject's
  // status-update + audit commit/rollback atomically (same pattern as
  // approve, even though reject has fewer writes).
  const transactionRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
    (dbInstance as any).transaction(async (tx: any) => work(tx));
  const txFactories = {
    createInventoryLedger: (tx: unknown) => new InventoryLedgerService({
      ledger: new InventoryLedgerDbRepository(tx as any),
      audit: new AuditDbRepository(tx as any),
      idempotency: new IdempotencyDbRepository(tx as any),
      documentSequence: new DocumentSequenceDbRepository(tx as any),
    }),
    createSubledger: (tx: unknown) => new SubledgerService({
      subledger: new SubledgerDbRepository(tx as any),
      audit: new AuditDbRepository(tx as any),
      idempotency: new IdempotencyDbRepository(tx as any),
      documentSequence: new DocumentSequenceDbRepository(tx as any),
    }),
    createSnapshotService: (tx: unknown) => new ProfitabilitySnapshotService({
      snapshotRepository: new ProfitabilitySnapshotDbRepository(tx as any),
      salesRepository: new SalesDbRepository(tx as any),
      audit: new AuditDbRepository(tx as any),
    }),
    createSalesRepository: (tx: unknown) => new SalesDbRepository(tx as any),
    createReturnRequestRepository: (tx: unknown) => new ReturnRequestDbRepository(tx as any),
    createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
    createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
  };

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
    transactionRunner,
    txFactories,
  });

  await service.rejectReturnRequest(authResult as any, effective, {
    returnRequestId: returnId,
    rejectionReason: decisionReason,
    idempotencyKey,
  });

  revalidatePath("/management/quality/returns");
}

// ---------------------------------------------------------------------------
// Action 3: Create a linked replacement sales order (management only).
// ---------------------------------------------------------------------------

/**
 * Create a linked replacement sales order from an approved return request.
 *
 * Permission: returns.approve (Owner/Accountant ONLY).
 *
 * Contract 11 §7 (Role/Action Matrix):
 *   Return/replacement approval and financial treatment:
 *   Owner = A/R, Accountant = A/R, Warehouse = -, Quality = -.
 *
 * Warehouse and Quality users retain returns.create for physical
 * return-request facts only — they CANNOT create replacement orders
 * because replacement creation is a financially consequential action.
 * Denial occurs before any idempotency, stock, sales-order, account,
 * or audit side effects.
 *
 * Contract 10 §8.7: Linked replacement flow.
 * Contract 06 §9: Linked Replacement Issue/Sale.
 * Contract 09 §11: The linked replacement order is a normal sales order.
 *
 * Preconditions (enforced by ReplacementWorkflowService):
 *   - Return request exists + belongs to tenant.
 *   - Return request status = "approved".
 *   - Return request financialTreatment = "replacement".
 *   - No existing replacement order linked to this return request.
 *   - Return request has at least one return line.
 *
 * Writes (all inside idempotency claim):
 *   1. Allocate doc_no for the replacement sales order.
 *   2. Insert sales_orders row with is_replacement_order = true.
 *   3. Insert sales_order_lines mirroring the return lines.
 *   4. Link return_request.replacement_order_id.
 *   5. Audit.
 *
 * The replacement order uses the NORMAL SALES PIPELINE:
 *   - Reserves on submission
 *   - Uses /sales/:saleId/approve for issue, approved net receivable, profitability
 *   - No manual stock movement
 *   - No automatic refund (refund is a separate payment command)
 *   - No direct account-entry mutation
 *
 * Equal/higher/lower value outcomes are derived from the linked negative
 * return credit and positive replacement receivable. Refund uses a separate
 * payment command and is never an automatic side effect.
 */
export async function createReplacementOrderAction(
  formData: FormData,
): Promise<void> {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const effective = resolveAndRequirePermission(
    authResult.roles,
    (await loadRolePermissionMatrixForTenant(authResult.tenantId)),
    "returns.approve",
  );

  rejectForbiddenFields(formData, "replacement order create");

  const returnRequestId = String(formData.get("returnRequestId") ?? "").trim();
  const saleDate = formData.get("saleDate")
    ? String(formData.get("saleDate"))
    : undefined;
  const decisionNotes = formData.get("decisionNotes")
    ? String(formData.get("decisionNotes"))
    : null;
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();

  if (!returnRequestId || !idempotencyKey) {
    throw new Error(
      "VALIDATION_FAILED: returnRequestId and idempotencyKey are required.",
    );
  }

  const { db: dbInstance, audit, idempotency, documentSequence } =
    getSharedDeps();

  const returnRequestRepository = new ReturnRequestDbRepository(dbInstance);
  const salesRepository = new SalesDbRepository(dbInstance);

  // WP-08-01E D-2 fix: wire transactionRunner + txFactories so all DB writes
  // in createReplacementOrder (sales_orders insert + sales_order_lines
  // inserts + return_requests link + audit) commit/rollback atomically.
  // Without this, a partial line-insert failure could leave an orphaned
  // replacement order header with only a subset of lines.
  const transactionRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
    (dbInstance as any).transaction(async (tx: any) => work(tx));
  const txFactories = {
    createSalesRepository: (tx: unknown) => new SalesDbRepository(tx as any),
    createReturnRequestRepository: (tx: unknown) => new ReturnRequestDbRepository(tx as any),
    createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
    createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
  };

  const service = new ReplacementWorkflowService({
    returnRequestRepository,
    salesRepository,
    audit,
    idempotency,
    documentSequence,
    transactionRunner,
    txFactories,
  });

  await service.createReplacementOrder(authResult as any, effective, {
    returnRequestId,
    saleDate,
    decisionNotes,
    idempotencyKey,
  });

  revalidatePath("/management/quality/returns");
}
