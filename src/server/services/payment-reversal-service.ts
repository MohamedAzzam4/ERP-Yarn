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
import { addMoney, isZeroMoney, absMoney, compareMoney, subtractMoney, isValidCanonicalMoney } from "./decimal-money";

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
   * terminalization). When absent, high-risk command execution fails closed with CONFIGURATION_ERROR. Unit/in-memory tests MUST provide an explicit transaction adapter/factory.
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

    // r14 BLOCKER C: fail-closed transaction configuration check BEFORE
    // idempotency claim, DB locking, or business mutation.
    if (!this.deps.transactionRunner || !this.deps.txFactories) {
      throw new PaymentReversalError("CONFIGURATION_ERROR", "PaymentReversalService.reversePayment requires transactionRunner and txFactories for production high-risk command execution.");
    }

    // r17 BLOCKER B: idempotency claim BEFORE any mutable business-state check
    // (including PaymentNotFound). This ensures business failures are durable.
    // Step 2: claim idempotency
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
      // r19 BLOCKER B: Semantic replay validation using canonical money validator
      if (claim.record.state === "succeeded") {
        const r = claim.record.responseBody as Partial<ReversePaymentResult> | null;
        if (!r?.paymentId || !r?.reversalEntryId || !r?.reversalEntryNo
            || !r?.reversalAmountSigned || !r?.reversedSettlementIds
            || r.originalEntryImmutable !== true) {
          throw new PaymentReversalError("IDEMPOTENCY_INCONSISTENT", "Durable succeeded record is malformed — missing required fields.");
        }
        if (!Array.isArray(r.reversedSettlementIds)) {
          throw new PaymentReversalError("IDEMPOTENCY_INCONSISTENT", "Durable succeeded record: reversedSettlementIds is not an array.");
        }
        // r19: validate canonical money semantics
        if (!isValidCanonicalMoney(r.reversalAmountSigned)) {
          throw new PaymentReversalError("IDEMPOTENCY_INCONSISTENT", "Durable succeeded record: reversalAmountSigned is not valid canonical money.");
        }
        for (const sid of r.reversedSettlementIds) {
          if (typeof sid !== "string" || sid.trim() === "") {
            throw new PaymentReversalError("IDEMPOTENCY_INCONSISTENT", "Durable succeeded record: reversedSettlementId contains invalid entry.");
          }
        }
        return { ...r, action: "replayed" } as ReversePaymentResult;
      }
      if (claim.record.state === "business_failed") {
        const errorBody = claim.record.responseBody as { code?: string; message?: string } | null;
        if (!errorBody?.code || !errorBody?.message) {
          throw new PaymentReversalError("IDEMPOTENCY_INCONSISTENT", "Durable business failure record is malformed.");
        }
        throw new PaymentReversalError(errorBody.code, errorBody.message);
      }
      throw new PaymentReversalError("IDEMPOTENCY_INCONSISTENT", `Unexpected replay state '${claim.record.state}'.`);
    }
    if (claim.action === "conflict") {
      throw new PaymentReversalError("IDEMPOTENCY_CONFLICT", `Idempotency key '${input.idempotencyKey}' was used with a different request body.`);
    }
    if (claim.action === "in_progress") {
      throw new PaymentReversalError("OPERATION_IN_PROGRESS", `Operation '${input.idempotencyKey}' is still in progress.`);
    }

    // Step 4-16: ALL authoritative state handling inside ONE transaction.
    // r15 BLOCKER D: lock payment, re-read, validate, lock entry, lock
    // settlements, derive active state — ALL inside the transaction.
    const executeReversal = async (txScoped: {
      subledger: SubledgerService; paymentRepository: PaymentRepository;
      audit: AuditTransactionHandle; idempotency: IdempotencyTransactionHandle;
      documentSequence: DocumentSequenceTransactionHandle;
    }): Promise<ReversePaymentResult> => {
      const subledger = txScoped.subledger;
      const paymentRepo = txScoped.paymentRepository;
      const audit = txScoped.audit;
      const idempotency = txScoped.idempotency;
      const documentSequence = txScoped.documentSequence;

      // Step 4: lock payment via tx repo + re-read from locked row
      const lockedPayment = await paymentRepo.lockPayment(user.tenantId, input.paymentId);
      if (!lockedPayment) {
        throw new PaymentNotFoundForReversalError(input.paymentId);
      }
      requireTenantMatch(user, lockedPayment.tenantId);

      // Step 5: validate posted/not-reversed from locked row
      if (lockedPayment.status === "reversed") {
        const error = new PaymentAlreadyReversedError(lockedPayment.id);
        throw error;
      }
      if (lockedPayment.status !== "posted") {
        throw new PaymentNotReversibleError(lockedPayment.id, lockedPayment.status);
      }
      if (!lockedPayment.postedEntryId) {
        throw new PaymentReversalError("INTERNAL_TRANSACTION_FAILED", `Payment '${lockedPayment.id}' has no posted entry.`);
      }
      const postedEntryId: string = lockedPayment.postedEntryId;

      // Step 6: lock original payment entry + re-read
      await paymentRepo.lockPaymentEntry(user.tenantId, postedEntryId);
      const originalEntry = await subledger.findEntryById(user.tenantId, postedEntryId);
      if (!originalEntry) {
        throw new PaymentReversalError("INTERNAL_TRANSACTION_FAILED", `Original entry '${postedEntryId}' not found.`);
      }

      // Step 7: Read settlement rows (without lock) to discover target IDs.
      // r17 BLOCKER C: Lock order is payment → payment entry → targets (sorted)
      // → settlement rows. We need settlement data to discover targets, but
      // we lock targets BEFORE locking settlement rows for writes.
      const existingSettlements = await paymentRepo.listSettlementsForPaymentEntry(
        user.tenantId, postedEntryId,
      );
      // Step 8: derive active settlement state
      const activeSettlements = existingSettlements.filter(s => s.settlementStatus === "settled");

      // r16 BLOCKER 1 + r17 BLOCKER C: Lock ALL affected target entries in
      // deterministic sorted order BEFORE locking settlement rows.
      const uniqueTargetIds = [...new Set(activeSettlements.map(s => s.settledEntryId))].sort();
      for (const targetId of uniqueTargetIds) {
        await paymentRepo.lockSettledEntry(user.tenantId, targetId);
      }

      // Now lock settlement rows for writes (after target locks acquired)
      await paymentRepo.lockSettlementsForPaymentEntry(user.tenantId, postedEntryId);
      // Re-read under lock to get authoritative active settlement state
      const lockedSettlements = await paymentRepo.listSettlementsForPaymentEntry(
        user.tenantId, postedEntryId,
      );
      const activeSettlementsLocked = lockedSettlements.filter(s => s.settlementStatus === "settled");

      // Step 9: SHARED subledger cutover coordination (inside this tx)
      // postReversalEntry calls requireCutoverLock internally (SHARED mode).

      // Step 10: allocate reversal document number
      const year = now.getUTCFullYear();
      const reversalDocNo = await allocateDocumentNumber(documentSequence, {
        tenantId: user.tenantId, documentType: "account_entry", year, entityType: "account_entry",
      });

      // Step 11: insert immutable opposite entry
      const reversalEntry = await subledger.postReversalEntry(user, effective, {
        originalEntryId: originalEntry.id,
        accountId: originalEntry.accountId,
        originalAmountSigned: originalEntry.amountSigned,
        entryDate: lockedPayment.paymentDate,
        paymentId: lockedPayment.id,
        docNo: reversalDocNo.docNo,
        idempotencyKey: `${input.idempotencyKey}:reversal_entry`,
        notes: input.notes ?? undefined,
      });

      // Step 12: r16 BLOCKER 2 — reverse each active settlement row
      // (settled → reversed) so it no longer consumes capacity.
      // Also insert a reversal evidence row preserving history.
      // r17 BLOCKER A: reverseSettlement MUST fail closed — if the
      // transition returns null, the entire reversal must abort.
      const reversedSettlementIds: string[] = [];
      for (const s of activeSettlementsLocked) {
        // Transition the original settlement row: settled → reversed
        const reversed = await paymentRepo.reverseSettlement(user.tenantId, s.id, user.userId);
        if (!reversed) {
          throw new PaymentReversalError(
            "INTERNAL_TRANSACTION_FAILED",
            `Settlement '${s.id}' could not be transitioned to reversed — it was not in 'settled' state under lock. The entire reversal will roll back.`,
          );
        }
        // Insert reversal evidence row
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

      // Step 13: update entry settlement statuses
      // r16 BLOCKER 3: Recompute each target's status from CURRENT effective
      // active settlements. Do NOT preserve 'settled' from pre-reversal state.
      await subledger.updateEntrySettlementStatusPublic(
        user.tenantId, postedEntryId, "reversed",
      );
      for (const targetId of uniqueTargetIds) {
        const targetEntry = await subledger.findEntryById(user.tenantId, targetId);
        if (targetEntry) {
          // r19 BLOCKER A: A target entry already in terminal 'reversed' state
          // (from a separate entry reversal) must NOT be resurrected by
          // payment unallocation. Skip ALL reversed targets, not just the
          // payment's own entry.
          if (targetEntry.settlementStatus === "reversed") continue;
          // Re-read current effective active settlements
          const remainingSettlements = await paymentRepo.listSettlementsForSettledEntry(
            user.tenantId, targetId,
          );
          const activeOnTarget = remainingSettlements.filter(rs => rs.settlementStatus === "settled");
          if (activeOnTarget.length === 0) {
            await subledger.updateEntrySettlementStatusPublic(user.tenantId, targetId, "unsettled");
          } else {
            const totalActiveOnTarget = activeOnTarget.reduce((sum, rs) => addMoney(sum, rs.settledAmount), "0.00");
            const targetRemaining = subtractAbs(targetEntry.amountSigned, totalActiveOnTarget);
            const newStatus = isZeroMoney(targetRemaining) ? "settled" : "partially_settled";
            await subledger.updateEntrySettlementStatusPublic(user.tenantId, targetId, newStatus);
          }
        }
      }

      // Step 14: update payment state
      const updatedPayment = await paymentRepo.updatePaymentStatus(
        user.tenantId, lockedPayment.id,
        { status: "reversed", reversalOfPaymentId: lockedPayment.id, isLocked: true, updatedBy: user.userId },
        ["posted"],
      );
      if (!updatedPayment) {
        throw new PaymentReversalError("INTERNAL_TRANSACTION_FAILED", `Payment '${lockedPayment.id}' could not be transitioned to reversed.`);
      }

      // Step 15: audit
      await appendAuditLog(audit, user.tenantId, user.userId, {
        entityType: PAYMENT_ENTITY_TYPE,
        entityId: lockedPayment.id,
        actionType: "payment.reverse",
        newValuesJson: {
          paymentNo: lockedPayment.paymentNo,
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

      // Step 16: mark idempotency succeeded
      const result: ReversePaymentResult = {
        action: "reversed",
        paymentId: lockedPayment.id,
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
        entityId: lockedPayment.id,
      }, claim.record.ownerToken!, now);

      return result;
    };

    try {
      return await this.deps.transactionRunner!(async (tx: unknown) => {
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
    } catch (txError) {
      // r15 BLOCKER D: classify business vs technical failures.
      const isBusinessError =
        txError instanceof PaymentAlreadyReversedError ||
        txError instanceof PaymentNotReversibleError ||
        txError instanceof PaymentNotFoundForReversalError;
      try {
        if (isBusinessError) {
          const error = txError as PaymentReversalError;
          await markBusinessFailed(this.deps.idempotency, claim.record.id, {
            responseCode: 409,
            responseBody: { code: error.code, message: error.message },
            lastErrorClass: error.name,
          }, claim.record.ownerToken!, now);
        } else {
          await markRetryableFailed(this.deps.idempotency, claim.record.id, {
            responseCode: 500,
            responseBody: { message: "Payment reversal transaction failed and rolled back." },
            lastErrorClass: txError instanceof Error ? txError.name : "Unknown",
          }, claim.record.ownerToken!, now);
        }
      } catch {
        // If terminalization fails, record remains in_progress → lease expiry.
      }
      throw txError;
    }
  }
}

// Local helper using contracted decimal-money operations (no floating point)
function subtractAbs(a: string, b: string): string {
  const absA = absMoney(a);
  if (compareMoney(absA, b) >= 0) {
    return subtractMoney(absA, b);
  }
  return "0.00";
}
