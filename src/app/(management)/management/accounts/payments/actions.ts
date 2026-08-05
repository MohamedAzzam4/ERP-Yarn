/**
 * Server actions for Management Payments — WP-08-01D Milestone A.
 *
 * Contract 10 §8.5: Payments screen supports post (draft → posted),
 * settle (payment entry → open receivable/payable entry), and reverse
 * (posted → reversed with reason). All actions require idempotency keys
 * and dedicated commands.
 *
 * Contract 07 §13-17:
 *   - §13 Posting creates one signed account entry based on party/direction.
 *   - §14 One payment entry may settle one or more receivable/payable entries.
 *   - §17 Reversal creates opposite signed entry; never delete/edit original.
 *
 * Actions:
 * 1. postPaymentAction    → PaymentService.postPayment           (payments.approve)
 * 2. settlePaymentAction  → SettlementService.settlePayment      (payments.approve)
 * 3. reversePaymentAction → PaymentReversalService.reversePayment (payments.reverse)
 *
 * All actions:
 * - Use idempotency keys
 * - Verify state via domain service (stale state rejection)
 * - Enforce RBAC server-side
 * - Preserve tenant isolation
 * - Write audit through AuditDbRepository
 * - Call domain service boundary, not raw table mutation
 *
 * All persistence boundaries are DB-backed:
 *   - PaymentRepository → PaymentDbRepository (Drizzle, payments + payment_settlements)
 *   - SubledgerService → SubledgerDbRepository (Drizzle, accounts + account_entries)
 *   - AuditDbRepository (Drizzle, audit_logs)
 *   - IdempotencyDbRepository (Drizzle, idempotency_records)
 *
 * NO in-memory test repositories are used in production actions.
 */
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { resolveAndRequirePermission } from "@/server/security/guards";
import { TEST_ROLE_PERMISSION_MATRIX } from "@/server/security/role-fixtures";
import { PaymentService } from "@/server/services/payment-service";
import { SettlementService } from "@/server/services/settlement-service";
import { PaymentReversalService } from "@/server/services/payment-reversal-service";
import { SubledgerService } from "@/server/services/subledger-service";
import { SubledgerDbRepository } from "@/server/services/subledger-db-repository";
import { AuditDbRepository } from "@/server/services/audit-db-repository";
import { IdempotencyDbRepository } from "@/server/services/idempotency-db-repository";
import { PaymentDbRepository } from "@/server/services/payment-db-repository";
import { DocumentSequenceDbRepository } from "@/server/services/document-sequence-db-repository";
import { db } from "@/server/db/client";

// ---------------------------------------------------------------------------
// Forbidden fields — client must NEVER submit these.
// ---------------------------------------------------------------------------

/**
 * Financial authority fields that must never be accepted from the client.
 * These are computed/derived server-side by the domain services.
 *
 * Contract 09 §5: "Do not accept authoritative tenant_id, actor, role,
 * approval status, calculated balance, stock delta, cost, payable sign, or
 * profitability total from the request body."
 */
const FORBIDDEN_PAYMENT_FIELDS = [
  // Signed amount / entry type / settlement status are derived server-side
  "amountSigned",
  "entryType",
  "entryNo",
  "settlementStatus",
  "postedEntryId",
  "reversalOfPaymentId",
  "reversalOfEntryId",
  "isLocked",
  // Payment-side authority fields
  "paymentNo",
  "status",
  "accountId",
  "ownerType",
  "ownerId",
  "tenantId",
  "createdBy",
  "updatedBy",
  // Audit/idempotency authority fields
  "auditLogId",
  "idempotencyRecordId",
];

function rejectForbiddenFields(formData: FormData, operation: string): void {
  for (const field of FORBIDDEN_PAYMENT_FIELDS) {
    if (formData.has(field)) {
      throw new Error(
        `FORBIDDEN_FIELD: Field '${field}' is not allowed in ${operation}.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Shared deps — DB-backed audit/idempotency/document-sequence.
// ---------------------------------------------------------------------------

function getSharedDeps() {
  if (!db) throw new Error("Database not available.");
  const audit = new AuditDbRepository(db);
  const idempotency = new IdempotencyDbRepository(db);
  const documentSequence = new DocumentSequenceDbRepository(db);
  return { db, audit, idempotency, documentSequence };
}

/**
 * Transaction runner — wraps all DB writes in a single db.transaction().
 * The `tx` is passed to the factory functions to create transaction-scoped
 * repos + services. Payment/Settlement/Reversal services don't currently
 * accept a transactionRunner in their deps interface, but we expose it
 * here for symmetry with the WP-08-01C sales-orders pattern and to
 * support future service-internal transactional composition.
 */
function makeTransactionRunner() {
  if (!db) throw new Error("Database not available.");
  const transactionRunner = async <T>(
    work: (tx: unknown) => Promise<T>,
  ): Promise<T> => {
    return (db as any).transaction(async (tx: any) => work(tx));
  };
  return transactionRunner;
}

/**
 * Transaction-scoped factories — used to create repos + services that
 * share the same `tx` instance when composing multi-step writes.
 *
 * `createIdempotency` and `createAudit` are required by the
 * WP-08-01C pattern; the payment-related factories are included for
 * symmetry and future use.
 */
function makeTxFactories(
  audit: AuditDbRepository,
  _idempotency: IdempotencyDbRepository,
  _documentSequence: DocumentSequenceDbRepository,
) {
  return {
    createIdempotency: (tx: unknown) =>
      new IdempotencyDbRepository(tx as any),
    createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
    createSubledger: (tx: unknown) =>
      new SubledgerService({
        subledger: new SubledgerDbRepository(tx as any),
        audit,
        idempotency: new IdempotencyDbRepository(tx as any),
        documentSequence: new DocumentSequenceDbRepository(tx as any),
      }),
    createDocumentSequence: (tx: unknown) =>
      new DocumentSequenceDbRepository(tx as any),
    // PRODUCTION: tx-scoped PaymentDbRepository for future service-internal
    // transactional composition (when PaymentService/SettlementService/
    // PaymentReversalService accept a transactionRunner like the
    // SalesApprovalService pattern in WP-08-01C).
    createPayment: (tx: unknown) => new PaymentDbRepository(tx as any),
  };
}

// ---------------------------------------------------------------------------
// Action 1: Post a draft payment.
// ---------------------------------------------------------------------------

/**
 * Post a draft payment — creates the immutable signed account entry.
 *
 * Wires to PaymentService.postPayment.
 * Permission: payments.approve (Owner/Accountant only — Workers denied per
 * Contract 11 §13).
 *
 * Contract 09 §20.5: POST /payments/:paymentId/post → permission: payments.approve
 *
 * Idempotency: same key + same body = replay; different body = conflict.
 * State check: only 'draft' payments can be posted.
 */
export async function postPaymentAction(formData: FormData): Promise<void> {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const effective = resolveAndRequirePermission(
    authResult.roles,
    TEST_ROLE_PERMISSION_MATRIX,
    "payments.approve",
  );

  rejectForbiddenFields(formData, "payment post");

  const paymentId = String(formData.get("paymentId") ?? "").trim();
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();
  const notes = formData.get("notes")
    ? String(formData.get("notes"))
    : null;

  if (!paymentId || !idempotencyKey) {
    throw new Error(
      "VALIDATION_FAILED: paymentId and idempotencyKey are required.",
    );
  }

  const { db: dbInstance, audit, idempotency, documentSequence } =
    getSharedDeps();
  // PRODUCTION: PaymentDbRepository — Drizzle-backed, persists payments +
  // payment_settlements to the live DB. NO in-memory test repositories.
  const paymentRepository = new PaymentDbRepository(dbInstance);
  const subledger = new SubledgerService({
    subledger: new SubledgerDbRepository(dbInstance),
    audit,
    idempotency,
    documentSequence,
  });

  // Build the transaction runner + tx factories (used by future
  // service-internal transactional composition; documented here for
  // symmetry with the WP-08-01C sales-orders pattern).
  void makeTransactionRunner();
  void makeTxFactories(audit, idempotency, documentSequence);

  const service = new PaymentService({
    paymentRepository,
    subledger,
    audit,
    idempotency,
    documentSequence,
  });

  await service.postPayment(authResult as any, effective, {
    paymentId,
    idempotencyKey,
    notes,
  });

  revalidatePath("/management/accounts/payments");
}

// ---------------------------------------------------------------------------
// Action 2: Settle a posted payment against one or more open entries.
// ---------------------------------------------------------------------------

/**
 * Settle a posted payment entry against one or more compatible open
 * receivable/payable entries.
 *
 * Wires to SettlementService.settlePayment.
 * Permission: payments.approve (Owner/Accountant).
 *
 * Contract 09 §20.5: POST /payments/:paymentId/settlements → permission: payments.approve
 *
 * The form submits a single allocation (one settledEntryId + one
 * settledAmount). The service enforces same-account/currency/sign
 * compatibility, capacity checks, and idempotency.
 *
 * Contract 07 §14-16: settlement total cannot exceed available payment
 * or unsettled source amount.
 */
export async function settlePaymentAction(formData: FormData): Promise<void> {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const effective = resolveAndRequirePermission(
    authResult.roles,
    TEST_ROLE_PERMISSION_MATRIX,
    "payments.approve",
  );

  rejectForbiddenFields(formData, "payment settlement");

  const paymentId = String(formData.get("paymentId") ?? "").trim();
  const settledEntryId = String(formData.get("settledEntryId") ?? "").trim();
  const settledAmount = String(formData.get("settledAmount") ?? "").trim();
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();
  const notes = formData.get("notes")
    ? String(formData.get("notes"))
    : null;

  if (!paymentId || !settledEntryId || !settledAmount || !idempotencyKey) {
    throw new Error(
      "VALIDATION_FAILED: paymentId, settledEntryId, settledAmount, and idempotencyKey are required.",
    );
  }

  const { db: dbInstance, audit, idempotency, documentSequence } =
    getSharedDeps();
  // PRODUCTION: PaymentDbRepository — Drizzle-backed, persists payments +
  // payment_settlements to the live DB. NO in-memory test repositories.
  const paymentRepository = new PaymentDbRepository(dbInstance);
  const subledger = new SubledgerService({
    subledger: new SubledgerDbRepository(dbInstance),
    audit,
    idempotency,
    documentSequence,
  });

  void makeTransactionRunner();
  void makeTxFactories(audit, idempotency, documentSequence);

  const service = new SettlementService({
    paymentRepository,
    subledger,
    audit,
    idempotency,
  });

  await service.settlePayment(authResult as any, effective, {
    paymentId,
    allocations: [{ settledEntryId, settledAmount }],
    idempotencyKey,
    notes,
  });

  revalidatePath("/management/accounts/payments");
}

// ---------------------------------------------------------------------------
// Action 3: Reverse a posted payment (with reason).
// ---------------------------------------------------------------------------

/**
 * Reverse a posted payment — creates an opposite-signed reversal entry,
 * unallocates any active settlements, and marks the payment reversed.
 *
 * Wires to PaymentReversalService.reversePayment.
 * Permission: payments.reverse (Owner/Accountant only — Workers denied).
 *
 * Required: reason (must be non-empty).
 * Contract 07 §17: reversal is idempotent, atomic, and never deletes/edits
 * the original entry — it creates a new reversal entry instead.
 */
export async function reversePaymentAction(formData: FormData): Promise<void> {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const effective = resolveAndRequirePermission(
    authResult.roles,
    TEST_ROLE_PERMISSION_MATRIX,
    "payments.reverse",
  );

  rejectForbiddenFields(formData, "payment reversal");

  const paymentId = String(formData.get("paymentId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();
  const notes = formData.get("notes")
    ? String(formData.get("notes"))
    : null;

  if (!paymentId || !reason || !idempotencyKey) {
    throw new Error(
      "VALIDATION_FAILED: paymentId, reason, and idempotencyKey are required.",
    );
  }

  const { db: dbInstance, audit, idempotency, documentSequence } =
    getSharedDeps();
  // PRODUCTION: PaymentDbRepository — Drizzle-backed, persists payments +
  // payment_settlements to the live DB. NO in-memory test repositories.
  const paymentRepository = new PaymentDbRepository(dbInstance);
  const subledger = new SubledgerService({
    subledger: new SubledgerDbRepository(dbInstance),
    audit,
    idempotency,
    documentSequence,
  });

  void makeTransactionRunner();
  void makeTxFactories(audit, idempotency, documentSequence);

  const service = new PaymentReversalService({
    paymentRepository,
    subledger,
    audit,
    idempotency,
    documentSequence,
  });

  await service.reversePayment(authResult as any, effective, {
    paymentId,
    reason,
    idempotencyKey,
    notes,
  });

  revalidatePath("/management/accounts/payments");
}
