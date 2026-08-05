/**
 * Server actions for Sales Orders — WP-08-01C.
 *
 * Contract 10 §8.4: Sales screens support draft, complete price, submit,
 * approve, reject/cancel, correction/reversal by permission.
 * Contract 10 §8.1: approve/reject only through dedicated commands with
 * reason/idempotency.
 *
 * Actions:
 * 1. approveSaleAction → SalesApprovalService.approveSale
 * 2. rejectSaleAction → SalesFailureResolutionService.resolveSaleFailure
 *    (human_rejection_cancellation)
 *
 * All actions:
 * - Require sales.approve permission (Owner/Accountant only)
 * - Use idempotency keys
 * - Verify subject hash / stale state (via domain service)
 * - Enforce RBAC server-side
 * - Preserve tenant isolation
 * - Write audit through AuditDbRepository
 * - Call domain service boundary, not raw table mutation
 */
"use server";

import { redirect } from "next/navigation";
import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { resolveAndRequirePermission } from "@/server/security/guards";
import { TEST_ROLE_PERMISSION_MATRIX } from "@/server/security/role-fixtures";
import { SalesApprovalService } from "@/server/services/sales-approval-service";
import { SalesFailureResolutionService } from "@/server/services/sales-failure-resolution-service";
import type { ResolveSaleFailureInput } from "@/server/services/sales-failure-resolution-types";
import { SalesDbRepository } from "@/server/services/sales-db-repository";
import { StockReservationDbRepository } from "@/server/services/stock-reservation-db-repository";
import { OperationalAlertDbRepository } from "@/server/services/operational-alert-db-repository";
import { SubledgerService } from "@/server/services/subledger-service";
import { SubledgerDbRepository } from "@/server/services/subledger-db-repository";
import { ProfitabilitySnapshotService } from "@/server/services/profitability-snapshot-service";
import { ProfitabilitySnapshotDbRepository } from "@/server/services/profitability-snapshot-db-repository";
import { InventoryLedgerService } from "@/server/services/inventory-ledger-service";
import { InventoryLedgerDbRepository } from "@/server/services/inventory-ledger-db-repository";
import { AuditDbRepository } from "@/server/services/audit-db-repository";
import { IdempotencyDbRepository } from "@/server/services/idempotency-db-repository";
import { DocumentSequenceDbRepository } from "@/server/services/document-sequence-db-repository";
import { db } from "@/server/db/client";
import { revalidatePath } from "next/cache";

// Forbidden fields that must NEVER be submitted from the client
const FORBIDDEN_SALES_FIELDS = [
  "totalGrossRevenue", "orderDiscountTotal", "documentTotalPosted",
  "lineGrossRevenue", "lineNetRevenuePrecise", "lineNetRevenuePosted",
  "lineAllocatedDiscountPrecise", "lineAllocatedDiscountPosted",
  "roundingAdjustment", "saleStatus", "approvalStatus",
  "subjectHash", "subjectVersion", "reservationStatus",
  "paymentStatus", "deliveryStatus",
];

function getSharedDeps() {
  if (!db) throw new Error("Database not available.");
  const audit = new AuditDbRepository(db);
  const idempotency = new IdempotencyDbRepository(db);
  const documentSequence = new DocumentSequenceDbRepository(db);
  return { db, audit, idempotency, documentSequence };
}

/**
 * Approve a sale — wires to SalesApprovalService.approveSale.
 *
 * Permission: sales.approve (Owner/Accountant only).
 * DEC-080: requester cannot approve own sale (enforced by service).
 * Subject hash verified by service (stale state rejection).
 * Idempotency: same key + same body = replay; different body = conflict.
 */
export async function approveSaleAction(formData: FormData): Promise<void> {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const effective = resolveAndRequirePermission(
    authResult.roles, TEST_ROLE_PERMISSION_MATRIX, "sales.approve",
  );

  // Reject forbidden fields (client must not set totals/status)
  for (const field of FORBIDDEN_SALES_FIELDS) {
    if (formData.has(field)) {
      throw new Error(`FORBIDDEN_FIELD: Field '${field}' is not allowed in sales approval.`);
    }
  }

  const saleId = String(formData.get("saleId") ?? "").trim();
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();
  const decisionNotes = formData.get("decisionNotes") ? String(formData.get("decisionNotes")) : null;

  if (!saleId || !idempotencyKey) {
    throw new Error("VALIDATION_FAILED: saleId and idempotencyKey are required.");
  }

  const { db: dbInstance, audit, idempotency, documentSequence } = getSharedDeps();
  const inventoryLedger = new InventoryLedgerService({
    ledger: new InventoryLedgerDbRepository(dbInstance), audit, idempotency, documentSequence,
  });
  const subledger = new SubledgerService({
    subledger: new SubledgerDbRepository(dbInstance), audit, idempotency, documentSequence,
  });
  const snapshotService = new ProfitabilitySnapshotService({
    snapshotRepository: new ProfitabilitySnapshotDbRepository(dbInstance),
    salesRepository: new SalesDbRepository(dbInstance), audit,
  });

  const transactionRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
    return (dbInstance as any).transaction(async (tx: any) => work(tx));
  };

  const txFactories = {
    createInventoryLedger: (tx: unknown) => new InventoryLedgerService({
      ledger: new InventoryLedgerDbRepository(tx as any),
      audit,
      idempotency: new IdempotencyDbRepository(tx as any),
      documentSequence: new DocumentSequenceDbRepository(tx as any),
    }),
    createSubledger: (tx: unknown) => new SubledgerService({
      subledger: new SubledgerDbRepository(tx as any),
      audit,
      idempotency: new IdempotencyDbRepository(tx as any),
      documentSequence: new DocumentSequenceDbRepository(tx as any),
    }),
    createSalesRepository: (tx: unknown) => new SalesDbRepository(tx as any),
    createReservationRepository: (tx: unknown) => new StockReservationDbRepository(tx as any),
    createSnapshotService: (tx: unknown) => new ProfitabilitySnapshotService({
      snapshotRepository: new ProfitabilitySnapshotDbRepository(tx as any),
      salesRepository: new SalesDbRepository(tx as any), audit,
    }),
    createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
    createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
    createDocumentSequence: (tx: unknown) => new DocumentSequenceDbRepository(tx as any),
  };

  const service = new SalesApprovalService({
    salesRepository: new SalesDbRepository(dbInstance),
    reservationRepository: new StockReservationDbRepository(dbInstance),
    inventoryLedger,
    subledger,
    snapshotService,
    audit,
    idempotency,
    documentSequence,
    transactionRunner,
    txFactories,
  });

  await service.approveSale(authResult as any, effective, {
    saleId,
    idempotencyKey,
    decisionNotes,
    // No snapshotCosts from client — service calculates from approved data
  });

  revalidatePath("/management/sales/orders");
  revalidatePath("/management/sales/failure-resolution");
}

/**
 * Reject/cancel a sale — wires to SalesFailureResolutionService.resolveSaleFailure
 * with human_rejection_cancellation reason.
 *
 * Permission: sales.approve (Owner/Accountant only).
 * Required: resolutionReason (must be non-empty).
 * Idempotency: same key + same body = replay; different body = conflict.
 */
export async function rejectSaleAction(formData: FormData): Promise<void> {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const effective = resolveAndRequirePermission(
    authResult.roles, TEST_ROLE_PERMISSION_MATRIX, "sales.approve",
  );

  for (const field of FORBIDDEN_SALES_FIELDS) {
    if (formData.has(field)) {
      throw new Error(`FORBIDDEN_FIELD: Field '${field}' is not allowed in sales rejection.`);
    }
  }

  const saleId = String(formData.get("saleId") ?? "").trim();
  const resolutionReason = String(formData.get("resolutionReason") ?? "").trim();
  const humanResolutionType = (String(formData.get("humanResolutionType") ?? "rejected") as "rejected" | "cancelled") || "rejected";
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();

  if (!saleId || !resolutionReason || !idempotencyKey) {
    throw new Error("VALIDATION_FAILED: saleId, resolutionReason, and idempotencyKey are required.");
  }

  const { db: dbInstance, audit, idempotency, documentSequence } = getSharedDeps();
  const inventoryLedger = new InventoryLedgerService({
    ledger: new InventoryLedgerDbRepository(dbInstance), audit, idempotency, documentSequence,
  });

  const transactionRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
    return (dbInstance as any).transaction(async (tx: any) => work(tx));
  };

  const txFactories = {
    createInventoryLedger: (tx: unknown) => new InventoryLedgerService({
      ledger: new InventoryLedgerDbRepository(tx as any), audit, idempotency, documentSequence,
    }),
    createReservationRepository: (tx: unknown) => new StockReservationDbRepository(tx as any),
    createSalesRepository: (tx: unknown) => new SalesDbRepository(tx as any),
    createAlertRepository: (tx: unknown) => new OperationalAlertDbRepository(tx as any),
    createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
    createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
  };

  const service = new SalesFailureResolutionService({
    salesRepository: new SalesDbRepository(dbInstance),
    reservationRepository: new StockReservationDbRepository(dbInstance),
    alertRepository: new OperationalAlertDbRepository(dbInstance),
    inventoryLedger,
    audit,
    idempotency,
    transactionRunner,
    txFactories,
  });

  const input: ResolveSaleFailureInput = {
    saleId,
    reason: "human_rejection_cancellation",
    humanResolutionType,
    resolutionReason,
    idempotencyKey,
  };

  await service.resolveSaleFailure(authResult as any, effective, input);

  revalidatePath("/management/sales/orders");
  revalidatePath("/management/sales/failure-resolution");
}
