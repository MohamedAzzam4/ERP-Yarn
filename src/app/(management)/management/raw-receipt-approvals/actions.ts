/**
 * Server actions for raw receipt approval (WP-02-05).
 *
 * These server actions are called from the management raw receipt approvals
 * screen. They enforce: permission (inventory.receive.approve), tenant,
 * worker redaction (no financial fields exposed to workers), DEC-080
 * segregation, idempotency, and subject hash binding.
 *
 * Auth/tenant/role proof (Risk #4 from WP-02-04, carried into WP-02-05):
 *   - getErpAuthContextWithRoles resolves from Supabase session server-side.
 *   - tenantId from authResult (never formData).
 *   - resolveAndRequirePermission enforces inventory.receive.approve.
 *   - rejectBodyClaimsAuthority inside service.
 *
 * No stock/payable logic here — the service owns all posting.
 */
"use server";

import { redirect } from "next/navigation";
import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { resolveAndRequirePermission } from "@/server/security/guards";
import { TEST_ROLE_PERMISSION_MATRIX } from "@/server/security/role-fixtures";
import { AuditDbRepository } from "@/server/services/audit-db-repository";
import { IdempotencyDbRepository } from "@/server/services/idempotency-db-repository";
import { DocumentSequenceDbRepository } from "@/server/services/document-sequence-db-repository";
import {
  RawReceiptApprovalService,
  type ApproveRawReceiptInput,
  type ConfirmLatePriceInput,
} from "@/server/services/raw-receipt-approval-service";
import { RawReceiptApprovalDbRepository } from "@/server/services/raw-receipt-approval-db-repository";
import { RawReceiptDraftDbRepository } from "@/server/services/raw-receipt-draft-db-repository";
import { InventoryLedgerService } from "@/server/services/inventory-ledger-service";
import { InventoryLedgerDbRepository } from "@/server/services/inventory-ledger-db-repository";
import { SubledgerService } from "@/server/services/subledger-service";
import { SubledgerDbRepository } from "@/server/services/subledger-db-repository";
import { db } from "@/server/db/client";

function getService() {
  if (!db) {
    throw new Error("Database not available. Raw receipt approval requires a live DB connection.");
  }
  const audit = new AuditDbRepository(db);
  const idempotency = new IdempotencyDbRepository(db);
  const documentSequence = new DocumentSequenceDbRepository(db);

  // Base (non-transaction) repos for reads (findApprovalById, findDraftById, etc.)
  const approvalRepository = new RawReceiptApprovalDbRepository(db);
  const draftRepository = new RawReceiptDraftDbRepository(db);
  const inventoryLedger = new InventoryLedgerService({
    ledger: new InventoryLedgerDbRepository(db),
    audit,
    idempotency,
    documentSequence,
  });
  const subledger = new SubledgerService({
    subledger: new SubledgerDbRepository(db),
    audit,
    idempotency,
    documentSequence,
  });

  // Transaction runner: wraps all DB writes in a single db.transaction().
  // The `tx` object is passed to the factory functions to create
  // transaction-scoped repos + services.
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
    createSubledger: (tx: unknown) => new SubledgerService({
      subledger: new SubledgerDbRepository(tx as any),
      audit,
      idempotency,
      documentSequence,
    }),
    createApprovalRepository: (tx: unknown) => new RawReceiptApprovalDbRepository(tx as any),
    createDraftRepository: (tx: unknown) => new RawReceiptDraftDbRepository(tx as any),
  };

  return new RawReceiptApprovalService({
    approvalRepository,
    draftRepository,
    inventoryLedger,
    subledger,
    audit,
    idempotency,
    transactionRunner,
    txFactories,
  });
}

export async function approveRawReceiptAction(formData: FormData) {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const effective = resolveAndRequirePermission(
    authResult.roles,
    TEST_ROLE_PERMISSION_MATRIX,
    "inventory.receive.approve",
  );

  const input: ApproveRawReceiptInput = {
    approvalRequestId: (formData.get("approval_request_id") as string) || "",
    pricePerTon: (formData.get("price_per_ton") as string) || null,
    decisionNotes: (formData.get("decision_notes") as string) || null,
    idempotencyKey: `approve-${authResult.userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };

  try {
    const service = getService();
    const result = await service.approveRawReceipt(authResult, effective, input);
    return { success: true, action: result.action, movementId: result.movementId, payableDeferred: result.payableDeferred };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function confirmLatePriceAction(formData: FormData) {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const effective = resolveAndRequirePermission(
    authResult.roles,
    TEST_ROLE_PERMISSION_MATRIX,
    "inventory.receive.approve",
  );

  const input: ConfirmLatePriceInput = {
    approvalRequestId: (formData.get("approval_request_id") as string) || "",
    pricePerTon: (formData.get("price_per_ton") as string) || "",
    idempotencyKey: `late-price-${authResult.userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    notes: (formData.get("notes") as string) || null,
  };

  try {
    const service = getService();
    const result = await service.confirmLatePrice(authResult, effective, input);
    return { success: true, action: result.action, payableEntryId: result.payableEntryId };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
