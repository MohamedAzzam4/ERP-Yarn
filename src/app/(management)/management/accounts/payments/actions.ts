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
import { loadRolePermissionMatrixForTenant } from "@/server/security/permission-loader";
import { PaymentService } from "@/server/services/payment-service";
import { SettlementService } from "@/server/services/settlement-service";
import { PaymentReversalService } from "@/server/services/payment-reversal-service";
import { SubledgerService } from "@/server/services/subledger-service";
import { SubledgerDbRepository } from "@/server/services/subledger-db-repository";
import { AuditDbRepository } from "@/server/services/audit-db-repository";
import { IdempotencyDbRepository } from "@/server/services/idempotency-db-repository";
import { PaymentDbRepository } from "@/server/services/payment-db-repository";
import { DocumentSequenceDbRepository } from "@/server/services/document-sequence-db-repository";
import { MasterDataDbRepository } from "@/server/services/master-data-db-repository";
import { MasterDataOwnerAuthorityLookup } from "@/server/services/owner-authority-lookup";
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
 *
 * r25 BLOCKER A: The shared forbidden-field list was previously applied to
 * ALL payment operations including createDraftPayment. That list contained
 * `ownerType` and `ownerId`, which are LEGITIMATE user-selected domain
 * references for draft creation (subsequently validated against canonical
 * master authority via OwnerAuthorityLookup). The old guard rejected every
 * legitimate draft form before the service executed.
 *
 * Fix: split into operation-specific forbidden-field sets. Draft creation
 * allows ownerType + ownerId (they are user input, not authority fields).
 * Post/settle/reverse continue rejecting all mutation-target authority
 * fields because those operations reference an existing payment by ID only.
 */

/** Truly authoritative fields forbidden in ALL payment operations. */
const FORBIDDEN_AUTHORITY_FIELDS = [
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
  "tenantId",
  "createdBy",
  "updatedBy",
  // Audit/idempotency authority fields
  "auditLogId",
  "idempotencyRecordId",
];

/**
 * Additional forbidden fields for post/settle/reverse operations.
 * These operations reference an existing payment by `paymentId` only —
 * the client must NOT submit ownerType/ownerId because the payment already
 * has an account, and mutating the owner would be an authority violation.
 */
const FORBIDDEN_EXISTING_PAYMENT_FIELDS = [
  "ownerType",
  "ownerId",
  "amount",
  "paymentDirection",
  "paymentMethod",
  "paymentDate",
];

/**
 * r25 BLOCKER A: Draft-create-specific forbidden-field guard.
 *
 * Draft creation legitimately accepts ownerType + ownerId (user-selected
 * domain references validated against canonical master authority), plus
 * amount, paymentDirection, paymentMethod, paymentDate. Only truly
 * authoritative fields (tenantId, paymentNo, status, accountId, etc.) are
 * rejected.
 */
function rejectForbiddenFieldsForDraftCreate(formData: FormData): void {
  for (const field of FORBIDDEN_AUTHORITY_FIELDS) {
    if (formData.has(field)) {
      throw new Error(
        `FORBIDDEN_FIELD: Field '${field}' is not allowed in payment draft create.`,
      );
    }
  }
}

/**
 * r25 BLOCKER A: Post/settle/reverse forbidden-field guard.
 *
 * These operations reference an existing payment by `paymentId` only. The
 * client must NOT submit ownerType/ownerId/amount/paymentDirection/
 * paymentMethod/paymentDate because the payment already has those fields
 * assigned from draft creation. Mutating them would be an authority
 * violation. Both the shared authority fields AND the existing-payment
 * mutation fields are rejected.
 */
function rejectForbiddenFieldsForExistingPayment(
  formData: FormData,
  operation: string,
): void {
  const allForbidden = [
    ...FORBIDDEN_AUTHORITY_FIELDS,
    ...FORBIDDEN_EXISTING_PAYMENT_FIELDS,
  ];
  for (const field of allForbidden) {
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
  // r24 BLOCKER C: wire the canonical MasterDataRepository as the owner
  // authority — PaymentService delegates owner existence/active checks to
  // this lookup, never duplicating master-data authority.
  const masterDataRepository = new MasterDataDbRepository(db);
  const ownerAuthority = new MasterDataOwnerAuthorityLookup(masterDataRepository);
  return { db, audit, idempotency, documentSequence, ownerAuthority };
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
  _audit: AuditDbRepository,
  _idempotency: IdempotencyDbRepository,
  _documentSequence: DocumentSequenceDbRepository,
) {
  return {
    createIdempotency: (tx: unknown) =>
      new IdempotencyDbRepository(tx as any),
    // r24 BLOCKER B: createAudit MUST be tx-scoped — using the root audit
    // repository here would let nested SubledgerService audit writes
    // (subledger.payment_entry.post, subledger.reversal_entry.post) commit
    // outside the outer Payment/Reversal/Settlement transaction, violating
    // Contract 03 important-audit-in-business-transaction and Contract 12
    // audit-rollback/no-partial-effects.
    createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
    // r24 BLOCKER B: createSubledger MUST construct its SubledgerService
    // with a tx-scoped AuditDbRepository. The nested SubledgerService writes
    // `subledger.payment_entry.post` and `subledger.reversal_entry.post`
    // audit rows — those MUST roll back with the outer transaction.
    createSubledger: (tx: unknown) =>
      new SubledgerService({
        subledger: new SubledgerDbRepository(tx as any),
        audit: new AuditDbRepository(tx as any),
        idempotency: new IdempotencyDbRepository(tx as any),
        documentSequence: new DocumentSequenceDbRepository(tx as any),
      }),
    createDocumentSequence: (tx: unknown) =>
      new DocumentSequenceDbRepository(tx as any),
    // PRODUCTION: tx-scoped PaymentDbRepository for service-internal
    // transactional composition (PaymentService/SettlementService/
    // PaymentReversalService all accept a transactionRunner).
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
    (await loadRolePermissionMatrixForTenant(authResult.tenantId)),
    "payments.approve",
  );

  // r25 BLOCKER A: post/settle/reverse reject both authority fields AND
  // existing-payment mutation fields (ownerType, ownerId, amount, etc.)
  // because these operations reference an existing payment by ID only.
  rejectForbiddenFieldsForExistingPayment(formData, "payment post");

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

  const { db: dbInstance, audit, idempotency, documentSequence, ownerAuthority } =
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

  // WP-07-04 cutover coordination (r11): wire the transaction runner + tx
  // factories so PaymentService.postPayment wraps its full posting flow
  // (account entry + payment status update + audit + idempotency) in a
  // single db.transaction(). This is REQUIRED for the cutover advisory
  // lock to protect the entire payment posting, not just the account entry.
  const transactionRunner = makeTransactionRunner();
  const txFactories = makeTxFactories(audit, idempotency, documentSequence);

  const service = new PaymentService({
    paymentRepository,
    subledger,
    audit,
    idempotency,
    documentSequence,
    // r24 BLOCKER C: production owner authority — PaymentService delegates
    // owner existence/active checks to the canonical MasterDataRepository.
    ownerAuthority,
    transactionRunner,
    txFactories: {
      createSubledger: txFactories.createSubledger,
      createPaymentRepository: txFactories.createPayment,
      createAudit: txFactories.createAudit,
      createIdempotency: txFactories.createIdempotency,
      createDocumentSequence: txFactories.createDocumentSequence,
    },
  });

  await service.postPayment(authResult as any, effective, {
    paymentId,
    idempotencyKey,
    notes,
  });

  revalidatePath("/management/accounts/payments");
}

// ---------------------------------------------------------------------------
// Action 1b: Create a draft payment.
// ---------------------------------------------------------------------------

/**
 * Create a draft payment — no account entry yet. Posting happens later via
 * postPaymentAction. Wires to PaymentService.createDraftPayment.
 *
 * r24: This action was added because r23 made createDraftPayment atomic
 * (transactionRunner + txFactories + fail-closed). The draft flow validates
 * owner master existence/active BEFORE idempotency claim (Blocker C) and
 * includes the effective currency in the idempotency body (Blocker A).
 *
 * Permission: payments.create (Owner/Accountant only — Workers denied per
 * Contract 11 §13).
 */
export async function createDraftPaymentAction(formData: FormData): Promise<void> {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const effective = resolveAndRequirePermission(
    authResult.roles,
    (await loadRolePermissionMatrixForTenant(authResult.tenantId)),
    "payments.create",
  );

  // r25 BLOCKER A: use the draft-create-specific guard that allows
  // ownerType/ownerId (legitimate user-selected domain references).
  rejectForbiddenFieldsForDraftCreate(formData);

  const ownerType = String(formData.get("ownerType") ?? "").trim();
  const ownerId = String(formData.get("ownerId") ?? "").trim();
  const paymentDate = String(formData.get("paymentDate") ?? "").trim();
  const amount = String(formData.get("amount") ?? "").trim();
  const paymentDirection = String(formData.get("paymentDirection") ?? "").trim();
  const paymentMethod = String(formData.get("paymentMethod") ?? "").trim();
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();
  const currency = formData.get("currency")
    ? String(formData.get("currency")).trim()
    : undefined;
  const notes = formData.get("notes")
    ? String(formData.get("notes"))
    : null;

  if (!ownerType || !ownerId || !paymentDate || !amount
      || !paymentDirection || !paymentMethod || !idempotencyKey) {
    throw new Error(
      "VALIDATION_FAILED: required fields missing.",
    );
  }

  const { db: dbInstance, audit, idempotency, documentSequence, ownerAuthority } =
    getSharedDeps();
  const paymentRepository = new PaymentDbRepository(dbInstance);
  const subledger = new SubledgerService({
    subledger: new SubledgerDbRepository(dbInstance),
    audit,
    idempotency,
    documentSequence,
  });

  const transactionRunner = makeTransactionRunner();
  const txFactories = makeTxFactories(audit, idempotency, documentSequence);

  const service = new PaymentService({
    paymentRepository,
    subledger,
    audit,
    idempotency,
    documentSequence,
    ownerAuthority,
    transactionRunner,
    txFactories: {
      createSubledger: txFactories.createSubledger,
      createPaymentRepository: txFactories.createPayment,
      createAudit: txFactories.createAudit,
      createIdempotency: txFactories.createIdempotency,
      createDocumentSequence: txFactories.createDocumentSequence,
    },
  });

  await service.createDraftPayment(authResult as any, effective, {
    ownerType: ownerType as any,
    ownerId,
    paymentDate,
    amount,
    paymentDirection: paymentDirection as any,
    paymentMethod: paymentMethod as any,
    notes,
    idempotencyKey,
    currency,
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
    (await loadRolePermissionMatrixForTenant(authResult.tenantId)),
    "payments.approve",
  );

  rejectForbiddenFieldsForExistingPayment(formData, "payment settlement");

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

  const { db: dbInstance, audit, idempotency, documentSequence, ownerAuthority: _ownerAuthority } =
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

  // WP-07-04 cutover coordination (r11): wire transaction runner + tx factories.
  const transactionRunner = makeTransactionRunner();
  const txFactories = makeTxFactories(audit, idempotency, documentSequence);

  const service = new SettlementService({
    paymentRepository,
    subledger,
    audit,
    idempotency,
    transactionRunner,
    txFactories: {
      createSubledger: txFactories.createSubledger,
      createPaymentRepository: txFactories.createPayment,
      createAudit: txFactories.createAudit,
      createIdempotency: txFactories.createIdempotency,
    },
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
    (await loadRolePermissionMatrixForTenant(authResult.tenantId)),
    "payments.reverse",
  );

  rejectForbiddenFieldsForExistingPayment(formData, "payment reversal");

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

  const { db: dbInstance, audit, idempotency, documentSequence, ownerAuthority: _ownerAuthority2 } =
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

  // WP-07-04 cutover coordination (r11): wire transaction runner + tx factories.
  const transactionRunner = makeTransactionRunner();
  const txFactories = makeTxFactories(audit, idempotency, documentSequence);

  const service = new PaymentReversalService({
    paymentRepository,
    subledger,
    audit,
    idempotency,
    documentSequence,
    transactionRunner,
    txFactories: {
      createSubledger: txFactories.createSubledger,
      createPaymentRepository: txFactories.createPayment,
      createAudit: txFactories.createAudit,
      createIdempotency: txFactories.createIdempotency,
      createDocumentSequence: txFactories.createDocumentSequence,
    },
  });

  await service.reversePayment(authResult as any, effective, {
    paymentId,
    reason,
    idempotencyKey,
    notes,
  });

  revalidatePath("/management/accounts/payments");
}
