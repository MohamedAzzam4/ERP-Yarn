/**
 * Payment Reversal Service — WP-05-04.
 *
 * Contract: docs/contracts/07_subledger_and_costs_contract.md §17
 *   Owner/Accountant only, reason required, idempotent and atomic.
 *   - lock payment/entry/settlements/account;
 *   - create opposite signed entry;
 *   - reverse/unallocate settlement links through new records/status;
 *   - mark payment reversed/link;
 *   - audit;
 *   - never delete/edit original.
 *
 * WP-05-04 SCOPE:
 *   - Reverse a posted payment
 *   - Create opposite-signed reversal entry (entryType='reversal')
 *   - For each settlement on the original payment entry, insert a NEW settlement
 *     row with status='reversed' (the original settlement row remains immutable;
 *     only its settlement_status transitions to 'reversed')
 *   - Mark payment status='reversed' + reversalOfPaymentId link
 *   - Cannot reverse twice (state check)
 *   - Cannot leave orphan settlements (all settlements are reversed atomically)
 *
 * WP-05-04 NON-SCOPE:
 *   - Payment posting (PaymentService)
 *   - Settlement allocation (SettlementService)
 *   - Direct cost review (WP-05-05)
 */
import "server-only";

import type { ErpUserContext } from "@/server/auth/erp-context";
import {
  requirePermission,
  requireTenantMatch,
  rejectBodyClaimsAuthority,
} from "@/server/security/guards";
import type { EffectivePermissions } from "@/server/security/effective-permissions";
import { appendAuditLog, type AuditTransactionHandle } from "./audit-service";
import {
  claimIdempotency,
  markSucceeded,
  markBusinessFailed,
  markRetryableFailed,
  type IdempotencyTransactionHandle,
  type IdempotencyClaimInput,
} from "./idempotency-service";
import {
  allocateDocumentNumber,
  type DocumentSequenceTransactionHandle,
} from "./document-sequence-service";
import type { SubledgerService } from "./subledger-service";
import type { PaymentRepository } from "./payment-repository";
import type { PaymentSettlement } from "@/server/db/schema/subledger";

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

export interface ReversePaymentInput {
  paymentId: string;
  reason: string;
  idempotencyKey: string;
  notes?: string | null;
}

export interface ReversePaymentResult {
  action: "reversed" | "replayed";
  paymentId: string;
  reversalEntryId: string;
  reversalEntryNo: string;
  reversalAmountSigned: string;
  reversedSettlementIds: string[];
  originalEntryImmutable: true;
}

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

export class PaymentReversalError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = "PaymentReversalError"; this.code = code; }
}

export class PaymentNotFoundForReversalError extends PaymentReversalError {
  constructor(id: string) { super("PAYMENT_NOT_FOUND", `Payment '${id}' not found.`); this.name = "PaymentNotFoundForReversalError"; }
}

export class PaymentNotReversibleError extends PaymentReversalError {
  constructor(id: string, status: string) { super("STATE_CONFLICT", `Payment '${id}' is in status '${status}' — only 'posted' payments can be reversed.`); this.name = "PaymentNotReversibleError"; }
}

export class PaymentAlreadyReversedError extends PaymentReversalError {
  constructor(id: string) { super("STATE_CONFLICT", `Payment '${id}' is already reversed.`); this.name = "PaymentAlreadyReversedError"; }
}

export class ReversalReasonRequiredError extends PaymentReversalError {
  constructor() { super("VALIDATION_FAILED", "Reversal reason is required."); this.name = "ReversalReasonRequiredError"; }
}

// ---------------------------------------------------------------------------
// Service deps.
// ---------------------------------------------------------------------------

export interface PaymentReversalServiceDeps {
  paymentRepository: PaymentRepository;
  subledger: SubledgerService;
  audit: AuditTransactionHandle;
  idempotency: IdempotencyTransactionHandle;
  documentSequence: DocumentSequenceTransactionHandle;
  /**
   * Optional transaction runner. When provided, all DB writes in reversePayment
   * are wrapped in a single DB transaction — REQUIRED for WP-07-04 cutover
   * coordination correctness (the advisory lock must span the reversal entry
   * creation AND the payment status update AND audit AND idempotency
   * terminalization). When absent (unit tests), runs without a boundary.
   */
  transactionRunner?: PaymentReversalTransactionRunner;
  txFactories?: PaymentReversalTransactionScopedFactories;
}

export type PaymentReversalTransactionRunner = <T>(work: (tx: unknown) => Promise<T>) => Promise<T>;

export interface PaymentReversalTransactionScopedFactories {
  createSubledger: (tx: unknown) => SubledgerService;
  createPaymentRepository: (tx: unknown) => PaymentRepository;
  createAudit: (tx: unknown) => AuditTransactionHandle;
  createIdempotency: (tx: unknown) => IdempotencyTransactionHandle;
  createDocumentSequence: (tx: unknown) => DocumentSequenceTransactionHandle;
}

// ---------------------------------------------------------------------------
// PaymentReversalService.
// ---------------------------------------------------------------------------

const PAYMENT_ENTITY_TYPE = "payment";

export class PaymentReversalService {
  constructor(private readonly deps: PaymentReversalServiceDeps) {}

  /**
   * Reverse a posted payment.
   *
   * Contract 07 §17: Owner/Accountant only, reason required, idempotent, atomic.
   *   - lock payment/entry/settlements/account
   *   - create opposite signed entry (entryType='reversal')
   *   - reverse/unallocate settlement links through new records/status
   *   - mark payment reversed/link
   *   - audit
   *   - never delete/edit original
   *
   * Permission: payments.reverse (Owner/Accountant only — Workers denied per
   * Contract 11 §13).
   */
  async reversePayment(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: ReversePaymentInput,
  ): Promise<ReversePaymentResult> {
    // Step 1: permission + reject body authority
    requirePermission(effective, "payments.reverse");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!input.paymentId?.trim()) throw new PaymentReversalError("VALIDATION_FAILED", "paymentId is required.");
    if (!input.idempotencyKey?.trim()) throw new PaymentReversalError("VALIDATION_FAILED", "idempotencyKey is required.");
    if (!input.reason?.trim()) throw new ReversalReasonRequiredError();

    // Step 2: fetch + lock payment
    const payment = await this.deps.paymentRepository.findPaymentById(user.tenantId, input.paymentId);
    if (!payment) throw new PaymentNotFoundForReversalError(input.paymentId);
    requireTenantMatch(user, payment.tenantId);

    await this.deps.paymentRepository.lockPayment(user.tenantId, payment.id);

    // Step 3: claim idempotency
    const now = new Date();
    const idempotencyInput: IdempotencyClaimInput = {
      tenantId: user.tenantId,
      operationScope: "payment.reverse",
      idempotencyKey: input.idempotencyKey,
      requestBody: {
        paymentId: input.paymentId,
        reason: input.reason,
        notes: input.notes ?? null,
      } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    };
    const claim = await claimIdempotency(this.deps.idempotency, idempotencyInput);

    if (claim.action === "replay") {
      const responseBody = claim.record.responseBody as Partial<ReversePaymentResult> | null;
      if (responseBody?.paymentId) {
        return { ...responseBody, action: "replayed" } as ReversePaymentResult;
      }
    }
    if (claim.action === "conflict") {
      throw new PaymentReversalError("IDEMPOTENCY_CONFLICT", `Idempotency key '${input.idempotencyKey}' was used with a different request body.`);
    }
    if (claim.action === "in_progress") {
      throw new PaymentReversalError("OPERATION_IN_PROGRESS", `Operation '${input.idempotencyKey}' is still in progress.`);
    }

    // Step 4: state check — must be posted, not already reversed
    if (payment.status === "reversed") {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 409, responseBody: { message: "Payment already reversed." },
        lastErrorClass: "PaymentAlreadyReversedError",
      }, claim.record.ownerToken!, now);
      throw new PaymentAlreadyReversedError(payment.id);
    }
    if (payment.status !== "posted") {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 409, responseBody: { message: `Payment in status '${payment.status}'.` },
        lastErrorClass: "PaymentNotReversibleError",
      }, claim.record.ownerToken!, now);
      throw new PaymentNotReversibleError(payment.id, payment.status);
    }

    if (!payment.postedEntryId) {
      throw new PaymentReversalError("INTERNAL_TRANSACTION_FAILED", `Payment '${payment.id}' has no posted entry.`);
    }
    // Capture the non-null postedEntryId so the closure below preserves
    // TypeScript's narrowing (closures don't preserve control-flow narrowing).
    const postedEntryId: string = payment.postedEntryId;

    // Step 5: fetch original entry + lock it + lock all settlements
    const originalEntry = await this.deps.subledger.findEntryById(user.tenantId, payment.postedEntryId);
    if (!originalEntry) {
      throw new PaymentReversalError("INTERNAL_TRANSACTION_FAILED", `Original entry '${payment.postedEntryId}' not found.`);
    }
    await this.deps.paymentRepository.lockPaymentEntry(user.tenantId, payment.postedEntryId);

    const existingSettlements = await this.deps.paymentRepository.lockSettlementsForPaymentEntry(
      user.tenantId, payment.postedEntryId,
    );
    // Only reverse settlements that are currently 'settled' (not already reversed)
    const activeSettlements = existingSettlements.filter(s => s.settlementStatus === "settled");

    // Step 6-11: create reversal entry, reverse settlements, update entry
    // settlement statuses, mark payment reversed, audit, mark idempotency.
    //
    // WP-07-04 cutover coordination (r11): ALL of these writes MUST share the
    // SAME db.transaction() so the cutover advisory lock (acquired inside
    // SubledgerService.postReversalEntry) protects the FULL reversal flow.
    const executeReversal = async (txScoped: {
      subledger: SubledgerService; paymentRepository: PaymentRepository;
      audit: AuditTransactionHandle; idempotency: IdempotencyTransactionHandle;
      documentSequence: DocumentSequenceTransactionHandle;
    } | null): Promise<ReversePaymentResult> => {
      const subledger = txScoped?.subledger ?? this.deps.subledger;
      const paymentRepo = txScoped?.paymentRepository ?? this.deps.paymentRepository;
      const audit = txScoped?.audit ?? this.deps.audit;
      const idempotency = txScoped?.idempotency ?? this.deps.idempotency;
      const documentSequence = txScoped?.documentSequence ?? this.deps.documentSequence;

      const year = now.getUTCFullYear();
      const reversalDocNo = await allocateDocumentNumber(documentSequence, {
        tenantId: user.tenantId, documentType: "account_entry", year, entityType: "account_entry",
      });

      const reversalEntry = await subledger.postReversalEntry(user, effective, {
        originalEntryId: originalEntry.id,
        accountId: originalEntry.accountId,
        originalAmountSigned: originalEntry.amountSigned,
        entryDate: payment.paymentDate,
        paymentId: payment.id,
        docNo: reversalDocNo.docNo,
        idempotencyKey: `${input.idempotencyKey}:reversal_entry`,
        notes: input.notes ?? undefined,
      });

      const reversedSettlementIds: string[] = [];
      for (const s of activeSettlements) {
        const reversalSettlement = await paymentRepo.insertSettlement({
          tenantId: user.tenantId,
          paymentEntryId: reversalEntry.entryId,
          settledEntryId: s.settledEntryId,
          settledAmount: s.settledAmount,
          settlementStatus: "reversed",
          createdBy: user.userId,
        });
        reversedSettlementIds.push(reversalSettlement.id);
      }

      await subledger.updateEntrySettlementStatusPublic(
        user.tenantId, postedEntryId, "reversed",
      );
      for (const s of activeSettlements) {
        const remainingSettlements = await paymentRepo.listSettlementsForSettledEntry(
          user.tenantId, s.settledEntryId,
        );
        const stillActive = remainingSettlements.filter(rs => rs.settlementStatus === "settled" && rs.id !== s.id);
        const targetEntry = await subledger.findEntryById(user.tenantId, s.settledEntryId);
        if (targetEntry) {
          const newStatus = stillActive.length > 0 ? "partially_settled" : "unsettled";
          if (targetEntry.settlementStatus !== "reversed" && targetEntry.settlementStatus !== "settled") {
            await subledger.updateEntrySettlementStatusPublic(
              user.tenantId, s.settledEntryId, newStatus,
            );
          }
        }
      }

      const updatedPayment = await paymentRepo.updatePaymentStatus(
        user.tenantId, payment.id,
        { status: "reversed", reversalOfPaymentId: payment.id, isLocked: true, updatedBy: user.userId },
        ["posted"],
      );
      if (!updatedPayment) {
        throw new PaymentReversalError("INTERNAL_TRANSACTION_FAILED", `Payment '${payment.id}' could not be transitioned to reversed.`);
      }

      await appendAuditLog(audit, user.tenantId, user.userId, {
        entityType: PAYMENT_ENTITY_TYPE,
        entityId: payment.id,
        actionType: "payment.reverse",
        newValuesJson: {
          paymentNo: payment.paymentNo,
          reversalEntryId: reversalEntry.entryId,
          reversalEntryNo: reversalEntry.entryNo,
          reversalAmountSigned: reversalEntry.amountSigned,
          originalEntryId: originalEntry.id,
          originalAmountSigned: originalEntry.amountSigned,
          reversedSettlementIds,
          reason: input.reason,
          status: "reversed",
        },
        idempotencyKey: input.idempotencyKey,
      });

      const result: ReversePaymentResult = {
        action: "reversed",
        paymentId: payment.id,
        reversalEntryId: reversalEntry.entryId,
        reversalEntryNo: reversalEntry.entryNo,
        reversalAmountSigned: reversalEntry.amountSigned,
        reversedSettlementIds,
        originalEntryImmutable: true,
      };
      await markSucceeded(idempotency, claim.record.id, {
        responseCode: 200,
        responseBody: result,
        entityType: PAYMENT_ENTITY_TYPE,
        entityId: payment.id,
      }, claim.record.ownerToken!, now);

      return result;
    };

    try {
      // BLOCKER 7 (r13): fail closed — high-risk production commands MUST
      // have transactionRunner + txFactories. No silent non-transactional fallback.
      if (!this.deps.transactionRunner || !this.deps.txFactories) {
        throw new Error("CONFIGURATION_ERROR: transactionRunner and txFactories are required for this high-risk command.");
      }
      if (true) {
        return await this.deps.transactionRunner(async (tx: unknown) => {
          const txSubledger = this.deps.txFactories!.createSubledger(tx);
          const txPaymentRepo = this.deps.txFactories!.createPaymentRepository(tx);
          const txAudit = this.deps.txFactories!.createAudit(tx);
          const txIdem = this.deps.txFactories!.createIdempotency(tx);
          const txDocSeq = this.deps.txFactories!.createDocumentSequence(tx);
          return executeReversal({
            subledger: txSubledger, paymentRepository: txPaymentRepo,
            audit: txAudit, idempotency: txIdem, documentSequence: txDocSeq,
          });
        });
      } else {
        return executeReversal(null);
      }
    } catch (txError) {
      // WP-07-04/BLOCKER 4: technical failure (including cutover lock wait
      // timeout) → terminalize as retryable_failed for immediate same-key retry.
      try {
        await markRetryableFailed(this.deps.idempotency, claim.record.id, {
          responseCode: 500,
          responseBody: { message: "Payment reversal transaction failed and rolled back." },
          lastErrorClass: txError instanceof Error ? txError.name : "Unknown",
        }, claim.record.ownerToken!, now);
      } catch {
        // If markRetryableFailed fails, record remains in_progress → lease expiry.
      }
      throw txError;
    }
  }
}
