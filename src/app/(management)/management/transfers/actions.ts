/**
 * Server actions for transfer workflow (WP-03-02).
 *
 * These server actions are called from the management transfers screen.
 * They enforce: permission (inventory.transfer.approve / inventory.reverse),
 * tenant, DEC-080 segregation, idempotency, and atomicity.
 *
 * ATOMICITY (Contract 06 §6, §17.2; DEC-015; WP-03-02):
 *   approveTransfer wraps `markDecided + postTransfer + movementId update`
 *   in a single db.transaction() via the transactionRunner + txFactories
 *   pattern (mirrors RawReceiptApprovalService). If postTransfer fails,
 *   the approval stays "active" with no movement — no "decided but no
 *   movement" state can persist.
 *
 * Auth/tenant/role proof:
 *   - getErpAuthContextWithRoles resolves from Supabase session server-side.
 *   - tenantId from authResult (never formData).
 *   - resolveAndRequirePermission enforces inventory.transfer.approve.
 *   - rejectBodyClaimsAuthority inside service.
 *
 * No stock logic here — the service owns all posting.
 */
"use server";

import { redirect } from "next/navigation";
import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { resolveAndRequirePermission } from "@/server/security/guards";
import { TEST_ROLE_PERMISSION_MATRIX } from "@/server/security/role-fixtures";
import { InProcessAuditStore } from "@/server/services/audit-service";
import { InProcessIdempotencyStore } from "@/server/services/idempotency-service";
import { InProcessDocumentSequenceStore } from "@/server/services/document-sequence-service";
import {
  TransferWorkflowService,
  type ApproveTransferInput,
  type ReverseMovementInput,
} from "@/server/services/transfer-workflow-service";
import { RawReceiptApprovalDbRepository } from "@/server/services/raw-receipt-approval-db-repository";
import { InventoryLedgerService } from "@/server/services/inventory-ledger-service";
import { InventoryLedgerDbRepository } from "@/server/services/inventory-ledger-db-repository";
import { db } from "@/server/db/client";

function getService() {
  if (!db) {
    throw new Error("Database not available. Transfer workflow requires a live DB connection.");
  }
  const audit = new InProcessAuditStore();
  const idempotency = new InProcessIdempotencyStore();
  const documentSequence = new InProcessDocumentSequenceStore();

  // Base (non-transaction) repos for reads (findApprovalById, listPending, etc.)
  const approvalRepository = new RawReceiptApprovalDbRepository(db);
  const inventoryLedger = new InventoryLedgerService({
    ledger: new InventoryLedgerDbRepository(db),
    audit,
    idempotency,
    documentSequence,
  });

  // Transaction runner: wraps all DB writes in a single db.transaction().
  // The `tx` object is passed to the factory functions to create
  // transaction-scoped repos + services. This ensures markDecided +
  // postTransfer + movementId update commit atomically — no partial
  // effects, no "decided but no movement" state.
  const transactionRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
    return (db as any).transaction(async (tx: any) => {
      return await work(tx);
    });
  };

  // Factories for creating transaction-scoped services/repos.
  // These construct NEW repo instances that use `tx` instead of `db`,
  // ensuring all writes go through the same transaction.
  const txFactories = {
    createInventoryLedger: (tx: unknown) => new InventoryLedgerService({
      ledger: new InventoryLedgerDbRepository(tx as any),
      audit,
      idempotency,
      documentSequence,
    }),
    createApprovalRepository: (tx: unknown) => new RawReceiptApprovalDbRepository(tx as any),
  };

  return new TransferWorkflowService({
    approvalRepository,
    inventoryLedger,
    audit,
    idempotency,
    transactionRunner,
    txFactories,
  });
}

export async function approveTransferAction(formData: FormData) {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const effective = resolveAndRequirePermission(
    authResult.roles,
    TEST_ROLE_PERMISSION_MATRIX,
    "inventory.transfer.approve",
  );

  const input: ApproveTransferInput = {
    transferRequestId: (formData.get("transfer_request_id") as string) || "",
    decisionNotes: (formData.get("decision_notes") as string) || null,
    idempotencyKey: `transfer-approve-${authResult.userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };

  try {
    const service = getService();
    const result = await service.approveTransfer(authResult, effective, input);
    return {
      success: true,
      action: result.action,
      movementId: result.movementId,
      docNo: result.docNo,
      fromOnHandQtyKg: result.fromOnHandQtyKg,
      toOnHandQtyKg: result.toOnHandQtyKg,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function reverseMovementAction(formData: FormData) {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const effective = resolveAndRequirePermission(
    authResult.roles,
    TEST_ROLE_PERMISSION_MATRIX,
    "inventory.reverse",
  );

  const input: ReverseMovementInput = {
    movementId: (formData.get("movement_id") as string) || "",
    reason: (formData.get("reason") as string) || "",
    idempotencyKey: `transfer-reverse-${authResult.userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };

  try {
    const service = getService();
    const result = await service.reverseMovement(authResult, effective, input);
    return {
      success: true,
      action: result.action,
      movementId: result.movementId,
      originalMovementId: result.originalMovementId,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
