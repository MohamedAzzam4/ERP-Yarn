/**
 * Server actions for Worker Production Entry — WP-08-01B.
 *
 * Contract 10 §7.2: Production Employee Screens.
 *   Allowed actions: Create/update/submit own drafts; request return from WIP.
 *   Forbidden actions: Issue/receipt financial posting, approve WIP return,
 *   change snapshots/rates, close unexplained WIP.
 *
 * Contract 05: No worker-entered payable, allocation, profitability or accounting entry.
 * Contract 11 §8/§9: Worker financial-deny is absolute.
 *
 * Three worker actions:
 * 1. createProductionDraft → ProductionIssueService.createProductionOrder
 * 2. createReceiptDraft → ProductionReceiptDraftService.createReceiptDraft
 * 3. createWipReturnRequest → WipReturnRequestService.createRequest
 *
 * All actions delegate to existing domain services which handle:
 * permission check, input validation, tenant isolation, order/input state
 * validation, subject hash, idempotency, audit, and persistence.
 */
"use server";

import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { resolveAndRequirePermission } from "@/server/security/guards";
import { requireProductionTaskActor } from "@/server/security/inventory-guards";
import { TEST_ROLE_PERMISSION_MATRIX } from "@/server/security/role-fixtures";
import { ProductionIssueService } from "@/server/services/production-issue-service";
import { ProductionReceiptDraftService } from "@/server/services/production-receipt-draft-service";
import { WipReturnRequestService } from "@/server/services/wip-return-request-service";
import { ProductionOrderDbRepository } from "@/server/services/production-order-db-repository";
import { ProductionReceiptDbRepository } from "@/server/services/production-receipt-db-repository";
import { WipReturnRequestDbRepository } from "@/server/services/wip-return-request-db-repository";
import { WipBalanceDbRepository } from "@/server/services/wip-balance-db-repository";
import { InventoryLedgerService } from "@/server/services/inventory-ledger-service";
import { InventoryLedgerDbRepository } from "@/server/services/inventory-ledger-db-repository";
import { AuditDbRepository } from "@/server/services/audit-db-repository";
import { InProcessIdempotencyStore } from "@/server/services/idempotency-service";
import { InProcessDocumentSequenceStore } from "@/server/services/document-sequence-service";
import { db } from "@/server/db/client";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { FORBIDDEN_PRODUCTION_FIELDS } from "@/server/services/__tests__/__helpers__/production-forbidden-fields";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function checkForbiddenFields(formData: FormData): void {
  for (const field of FORBIDDEN_PRODUCTION_FIELDS) {
    if (formData.has(field)) {
      throw new Error(`FORBIDDEN_FIELD: Field '${field}' is not allowed in worker production action.`);
    }
  }
}

function getSharedDeps() {
  if (!db) throw new Error("Database not available.");
  const audit = new AuditDbRepository(db);
  const documentSequence = new InProcessDocumentSequenceStore();
  const idempotency = new InProcessIdempotencyStore();
  return { db, audit, documentSequence, idempotency };
}

// ---------------------------------------------------------------------------
// Action 1: Create Production Order Draft
// ---------------------------------------------------------------------------

/**
 * Create a production order draft with input rows.
 *
 * Wires to ProductionIssueService.createProductionOrder.
 * Permission: production.create (production_employee has this).
 * No stock movement, no WIP change, no financial effect — draft only.
 * Worker must NOT submit: factory rate, payable, cost basis, or any financial field.
 */
export async function createProductionDraft(formData: FormData): Promise<void> {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  requireProductionTaskActor(authResult as any, authResult.roles);

  const effective = resolveAndRequirePermission(
    authResult.roles, TEST_ROLE_PERMISSION_MATRIX, "production.create",
  );

  checkForbiddenFields(formData);

  const productionType = String(formData.get("productionType") ?? "").trim();
  const factoryId = String(formData.get("factoryId") ?? "").trim();
  const factoryLocationId = String(formData.get("factoryLocationId") ?? "").trim();

  if (!productionType || !factoryId || !factoryLocationId) {
    throw new Error("VALIDATION_FAILED: productionType, factoryId, and factoryLocationId are required.");
  }

  if (productionType !== "single_yarn" && productionType !== "twisted_yarn") {
    throw new Error("VALIDATION_FAILED: productionType must be 'single_yarn' or 'twisted_yarn'.");
  }

  // Parse input rows from form data (dynamic fields)
  const inputs: Array<{ inputItemId: string; inputLocationId: string; plannedInputQtyKg: string }> = [];
  let inputIndex = 0;
  while (formData.has(`inputItemId_${inputIndex}`)) {
    const inputItemId = String(formData.get(`inputItemId_${inputIndex}`) ?? "").trim();
    const inputLocationId = String(formData.get(`inputLocationId_${inputIndex}`) ?? "").trim();
    const plannedInputQtyKg = String(formData.get(`plannedInputQtyKg_${inputIndex}`) ?? "").trim();
    if (inputItemId && inputLocationId && plannedInputQtyKg) {
      inputs.push({ inputItemId, inputLocationId, plannedInputQtyKg });
    }
    inputIndex++;
  }

  if (inputs.length === 0) {
    throw new Error("VALIDATION_FAILED: At least one input row is required.");
  }

  const { db: dbInstance, audit, documentSequence, idempotency } = getSharedDeps();
  const inventoryLedger = new InventoryLedgerService({
    ledger: new InventoryLedgerDbRepository(dbInstance), audit, idempotency, documentSequence,
  });

  const service = new ProductionIssueService({
    productionOrderRepository: new ProductionOrderDbRepository(dbInstance),
    wipBalanceRepository: new WipBalanceDbRepository(dbInstance),
    inventoryLedger,
    audit,
    idempotency,
    documentSequence,
  });

  await service.createProductionOrder(authResult as any, effective, {
    productionType: productionType as "single_yarn" | "twisted_yarn",
    factoryId,
    factoryLocationId,
    inputs,
  });

  revalidatePath("/worker/production-entry");
}

// ---------------------------------------------------------------------------
// Action 2: Create Production Receipt Draft
// ---------------------------------------------------------------------------

/**
 * Create a production receipt draft with output facts + input allocations.
 *
 * Wires to ProductionReceiptDraftService.createReceiptDraft.
 * Permission: production.receive_draft (production_employee has this).
 * NO posting: no movement, no WIP change, no account entry, no payable.
 * Worker must NOT submit: factory rate, payable, cost basis, or any financial field.
 * The service auto-generates idempotency key internally.
 */
export async function createReceiptDraft(formData: FormData): Promise<void> {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  requireProductionTaskActor(authResult as any, authResult.roles);

  const effective = resolveAndRequirePermission(
    authResult.roles, TEST_ROLE_PERMISSION_MATRIX, "production.receive_draft",
  );

  checkForbiddenFields(formData);

  const productionOrderId = String(formData.get("productionOrderId") ?? "").trim();
  const outputItemId = String(formData.get("outputItemId") ?? "").trim();
  const outputLocationId = String(formData.get("outputLocationId") ?? "").trim();
  const outputQtyKg = String(formData.get("outputQtyKg") ?? "").trim();
  const receiptDate = String(formData.get("receiptDate") ?? "").trim();
  const notes = formData.get("notes") ? String(formData.get("notes")) : null;

  if (!productionOrderId || !outputItemId || !outputLocationId || !outputQtyKg || !receiptDate) {
    throw new Error("VALIDATION_FAILED: productionOrderId, outputItemId, outputLocationId, outputQtyKg, and receiptDate are required.");
  }

  // Parse allocations from form data (dynamic fields)
  const allocations: Array<{
    productionInputId: string;
    consumedTowardOutputQtyKg: string;
    allocatedWasteQtyKg: string;
  }> = [];
  let allocIndex = 0;
  while (formData.has(`allocInputId_${allocIndex}`)) {
    const productionInputId = String(formData.get(`allocInputId_${allocIndex}`) ?? "").trim();
    const consumedTowardOutputQtyKg = String(formData.get(`allocConsumed_${allocIndex}`) ?? "0").trim();
    const allocatedWasteQtyKg = String(formData.get(`allocWaste_${allocIndex}`) ?? "0").trim();
    if (productionInputId) {
      allocations.push({ productionInputId, consumedTowardOutputQtyKg, allocatedWasteQtyKg });
    }
    allocIndex++;
  }

  if (allocations.length === 0) {
    throw new Error("VALIDATION_FAILED: At least one input allocation is required.");
  }

  const { db: dbInstance, audit, documentSequence } = getSharedDeps();

  const service = new ProductionReceiptDraftService({
    receiptRepository: new ProductionReceiptDbRepository(dbInstance),
    productionOrderRepository: new ProductionOrderDbRepository(dbInstance),
    wipBalanceRepository: new WipBalanceDbRepository(dbInstance),
    audit,
    documentSequence,
  });

  await service.createReceiptDraft(authResult as any, effective, {
    productionOrderId,
    outputItemId,
    outputLocationId,
    outputQtyKg,
    receiptDate,
    notes,
    // Worker must NOT submit rate/basis fields — service checks permission
    // for production.view_cost (production_employee does NOT have this)
    factoryRatePerInputTon: undefined,
    factoryCostBasis: undefined,
    allocations,
  });

  revalidatePath("/worker/production-entry");
}

// ---------------------------------------------------------------------------
// Action 3: Create WIP Return Request
// ---------------------------------------------------------------------------

/**
 * Create a WIP return request.
 *
 * Wires to WipReturnRequestService.createRequest.
 * Permission: production.return_from_wip.request (production_employee has this).
 * Worker CANNOT submit: factory rate, payable, cost basis, or any financial field.
 */
export async function createWipReturnRequest(formData: FormData): Promise<void> {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  requireProductionTaskActor(authResult as any, authResult.roles);

  const effective = resolveAndRequirePermission(
    authResult.roles, TEST_ROLE_PERMISSION_MATRIX, "production.return_from_wip.request",
  );

  checkForbiddenFields(formData);

  const productionOrderId = String(formData.get("productionOrderId") ?? "").trim();
  const productionInputId = String(formData.get("productionInputId") ?? "").trim();
  const returnQtyKg = String(formData.get("returnQtyKg") ?? "").trim();
  const returnLocationId = String(formData.get("returnLocationId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const notes = formData.get("notes") ? String(formData.get("notes")) : null;

  if (!productionOrderId || !productionInputId || !returnQtyKg || !returnLocationId || !reason) {
    throw new Error("VALIDATION_FAILED: All fields are required (order, input, quantity, location, reason).");
  }

  const { db: dbInstance, audit, documentSequence } = getSharedDeps();

  const service = new WipReturnRequestService({
    requestRepository: new WipReturnRequestDbRepository(dbInstance),
    productionOrderRepository: new ProductionOrderDbRepository(dbInstance),
    wipBalanceRepository: new WipBalanceDbRepository(dbInstance),
    audit,
    documentSequence,
  });

  await service.createRequest(authResult as any, effective, {
    productionOrderId,
    productionInputId,
    returnQtyKg,
    returnLocationId,
    reason,
    notes,
  });

  revalidatePath("/worker/production-entry");
}
