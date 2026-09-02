/**
 * Settlement Service — WP-05-04.
 *
 * Contract: docs/contracts/07_subledger_and_costs_contract.md §14-16
 *   §14: One payment entry may settle one or more receivable/payable entries.
 *        Partial settlement leaves source entry partially settled. Settlement
 *        total cannot exceed available payment or unsettled source amount.
 *   §15: Advance is allowed without sale/payable source; later settlement
 *        allocates advance to approved entries.
 *   §16: Settlement record links payment entry to target entry with positive
 *        amount and actor/time. Validate same tenant/account/currency and
 *        compatible signs/directions. Settlement changes matching state, not
 *        the immutable signed amounts.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §12.2
 *   payment_settlements: payment_entry_id, settled_entry_id, settled_amount
 *   (positive), settlement_status.
 *
 * WP-05-04 SCOPE:
 *   - Settle a payment entry against one or more compatible open entries
 *   - Partial settlement support
 *   - Prevent over-settlement (both payment-side and target-side)
 *   - Deterministic locks (payment entry + settled entry)
 *   - Settlement records are immutable (reversal creates new rows, not edits)
 *   - Update entry settlement_status (unsettled → partially_settled → settled)
 *
 * WP-05-04 NON-SCOPE:
 *   - Payment posting (PaymentService)
 *   - Payment reversal / settlement unallocation (PaymentReversalService)
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
import type { SubledgerService } from "./subledger-service";
import type { PaymentRepository } from "./payment-repository";
import type { AccountEntry, Payment, PaymentSettlement } from "@/server/db/schema/subledger";
import {
  normalizeMoney, isPositiveMoney, addMoney, compareMoney, absMoney, isZeroMoney, subtractMoney, isValidCanonicalMoney, isNegativeMoney,
} from "./decimal-money";

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

export interface SettlementAllocation {
  /** The target receivable/payable entry to settle. */
  settledEntryId: string;
  /** POSITIVE amount to settle (NUMERIC(18,2) string). */
  settledAmount: string;
}

export interface SettlePaymentInput {
  paymentId: string;
  allocations: SettlementAllocation[];
  idempotencyKey: string;
  notes?: string | null;
}

export interface SettlePaymentResult {
  action: "settled" | "replayed";
  paymentId: string;
  settlementIds: string[];
  totalSettled: string;
  paymentEntryRemaining: string;
  allocations: Array<{
    settlementId: string;
    settledEntryId: string;
    settledAmount: string;
    settledEntryRemaining: string;
  }>;
}

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

export class SettlementError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = "SettlementError"; this.code = code; }
}

export class PaymentNotFoundError extends SettlementError {
  constructor(id: string) { super("PAYMENT_NOT_FOUND", `Payment '${id}' not found.`); this.name = "PaymentNotFoundError"; }
}

export class PaymentNotPostedError extends SettlementError {
  constructor(id: string, status: string) { super("STATE_CONFLICT", `Payment '${id}' is in status '${status}' — only 'posted' payments can be settled.`); this.name = "PaymentNotPostedError"; }
}

export class PaymentReversedException extends SettlementError {
  constructor(id: string) { super("STATE_CONFLICT", `Payment '${id}' is reversed — cannot settle.`); this.name = "PaymentReversedException"; }
}

export class SettlementTargetNotFoundError extends SettlementError {
  constructor(entryId: string) { super("VALIDATION_FAILED", `Settlement target entry '${entryId}' not found.`); this.name = "SettlementTargetNotFoundError"; }
}

export class SettlementIncompatibleError extends SettlementError {
  constructor(reason: string) { super("VALIDATION_FAILED", `Settlement incompatible: ${reason}`); this.name = "SettlementIncompatibleError"; }
}

export class OverSettlementError extends SettlementError {
  constructor(side: "payment" | "target", requested: string, available: string) {
    super("OVER_SETTLEMENT", `Over-settlement on ${side} side: requested ${requested}, available ${available}.`);
    this.name = "OverSettlementError";
  }
}

export class InvalidSettlementAmountError extends SettlementError {
  constructor(amount: string) { super("VALIDATION_FAILED", `Settlement amount must be positive, got '${amount}'.`); this.name = "InvalidSettlementAmountError"; }
}

// ---------------------------------------------------------------------------
// Service deps.
// ---------------------------------------------------------------------------

export interface SettlementServiceDeps {
  paymentRepository: PaymentRepository;
  subledger: SubledgerService;
  audit: AuditTransactionHandle;
  idempotency: IdempotencyTransactionHandle;
  /**
   * Optional transaction runner. When provided, all DB writes in settlePayment
   * are wrapped in a single DB transaction — REQUIRED for WP-07-04 cutover
   * coordination correctness (the advisory lock acquired by
   * updateEntrySettlementStatusPublic must span the settlement inserts AND
   * the entry status updates AND audit AND idempotency terminalization).
   * When absent, high-risk command execution fails closed with CONFIGURATION_ERROR. Unit/in-memory tests MUST provide an explicit transaction adapter/factory.
   */
  transactionRunner?: SettlementTransactionRunner;
  txFactories?: SettlementTransactionScopedFactories;
}

export type SettlementTransactionRunner = <T>(work: (tx: unknown) => Promise<T>) => Promise<T>;

export interface SettlementTransactionScopedFactories {
  createSubledger: (tx: unknown) => SubledgerService;
  createPaymentRepository: (tx: unknown) => PaymentRepository;
  createAudit: (tx: unknown) => AuditTransactionHandle;
  createIdempotency: (tx: unknown) => IdempotencyTransactionHandle;
}

// ---------------------------------------------------------------------------
// SettlementService.
// ---------------------------------------------------------------------------

const SETTLEMENT_ENTITY_TYPE = "payment_settlement";

export class SettlementService {
  constructor(private readonly deps: SettlementServiceDeps) {}

  /**
   * Settle a posted payment entry against one or more compatible open
   * receivable/payable entries.
   *
   * Contract 07 §14-16:
   *   - One payment entry may settle one or more receivable/payable entries.
   *   - Settlement total cannot exceed available payment or unsettled source.
   *   - Validate same tenant/account/currency and compatible signs.
   *
   * Permission: payments.create (Owner/Accountant). Customer settlements also
   * require balances.view_customer; supplier/factory settlements also require
   * balances.view_supplier_factory.
   *
   * Concurrency: locks the payment entry + each settled entry to prevent
   * over-settlement. In-memory tests are single-threaded; production uses
   * pg_advisory_xact_lock.
   */
  async settlePayment(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: SettlePaymentInput,
  ): Promise<SettlePaymentResult> {
    // Step 1: permission
    requirePermission(effective, "payments.create");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!input.paymentId?.trim()) throw new SettlementError("VALIDATION_FAILED", "paymentId is required.");
    if (!input.idempotencyKey?.trim()) throw new SettlementError("VALIDATION_FAILED", "idempotencyKey is required.");
    // r22 BLOCKER B: Immutable request-shape validation BEFORE idempotency claim
    if (!Array.isArray(input.allocations)) {
      throw new SettlementError("VALIDATION_FAILED", "allocations must be an array.");
    }
    if (input.allocations.length === 0) throw new SettlementError("VALIDATION_FAILED", "At least one allocation is required.");
    for (const a of input.allocations) {
      if (!a || typeof a !== "object") {
        throw new SettlementError("VALIDATION_FAILED", "Each allocation must be an object.");
      }
      if (typeof a.settledEntryId !== "string" || a.settledEntryId.trim() === "") {
        throw new SettlementError("VALIDATION_FAILED", "Each allocation settledEntryId must be a non-empty string.");
      }
      if (typeof a.settledAmount !== "string") {
        throw new SettlementError("VALIDATION_FAILED", "Each allocation settledAmount must be a string.");
      }
    }
    // r21 BLOCKER D: Strict input money validation — require canonical 18,2
    // before idempotency claim. No silent normalization of malformed input.
    for (const a of input.allocations) {
      if (!isValidCanonicalMoney(a.settledAmount)) {
        throw new SettlementError("VALIDATION_FAILED", `Settlement allocation settledAmount '${a.settledAmount}' is not valid canonical money (scale 2, NUMERIC(18,2)).`);
      }
      if (!isPositiveMoney(a.settledAmount)) {
        throw new InvalidSettlementAmountError(a.settledAmount);
      }
    }

    // r18 NEW BLOCKER: Reject duplicate settledEntryId in one settlement request.
    // Contract 07 §14: settlement total cannot exceed available source amount.
    // Duplicate target IDs would bypass per-target capacity checks.
    // This is immutable request-shape validation — happens BEFORE idempotency claim.
    const seenTargetIds = new Set<string>();
    for (const a of input.allocations) {
      if (seenTargetIds.has(a.settledEntryId)) {
        throw new SettlementError("VALIDATION_FAILED", `Duplicate settledEntryId '${a.settledEntryId}' in settlement allocations. Each target entry may appear at most once per settlement request.`);
      }
      seenTargetIds.add(a.settledEntryId);
    }

    // r14 BLOCKER C: fail-closed transaction configuration check BEFORE
    // idempotency claim, DB locking, or business mutation.
    if (!this.deps.transactionRunner || !this.deps.txFactories) {
      throw new SettlementError("CONFIGURATION_ERROR", "SettlementService.settlePayment requires transactionRunner and txFactories for production high-risk command execution.");
    }

    // r17 BLOCKER B: idempotency claim BEFORE any mutable business-state check
    // (including PaymentNotFound). This ensures business failures are durable.
    // Step 2: claim idempotency
    const now = new Date();
    const idempotencyInput: IdempotencyClaimInput = {
      tenantId: user.tenantId,
      operationScope: "payment.settle",
      idempotencyKey: input.idempotencyKey,
      requestBody: {
        paymentId: input.paymentId,
        allocations: input.allocations.map(a => ({ settledEntryId: a.settledEntryId, settledAmount: normalizeMoney(a.settledAmount) })),
        notes: input.notes ?? null,
      } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    };
    const claim = await claimIdempotency(this.deps.idempotency, idempotencyInput);

    if (claim.action === "replay") {
      // r21 BLOCKER B: Array shape fail-closed before .length/.map usage
      if (claim.record.state === "succeeded") {
        const r = claim.record.responseBody as Partial<SettlePaymentResult> | null;
        if (!r?.paymentId || !r?.totalSettled || !r?.paymentEntryRemaining) {
          throw new SettlementError("IDEMPOTENCY_INCONSISTENT", "Durable succeeded record is malformed — missing required fields.");
        }
        // r21 BLOCKER B: require arrays before using .length
        if (!Array.isArray(r.settlementIds) || !Array.isArray(r.allocations)) {
          throw new SettlementError("IDEMPOTENCY_INCONSISTENT", "Durable succeeded record: settlementIds or allocations is not an array.");
        }
        if (r.settlementIds.length === 0 || r.allocations.length === 0) {
          throw new SettlementError("IDEMPOTENCY_INCONSISTENT", "Durable succeeded record: settlementIds or allocations is empty.");
        }
        // Validate cardinality consistency
        if (r.settlementIds.length !== r.allocations.length) {
          throw new SettlementError("IDEMPOTENCY_INCONSISTENT", "Durable succeeded record: settlementIds.length !== allocations.length.");
        }
        // r20 BLOCKER B: strict canonical money validation
        if (!isValidCanonicalMoney(r.totalSettled) || !isValidCanonicalMoney(r.paymentEntryRemaining)) {
          throw new SettlementError("IDEMPOTENCY_INCONSISTENT", "Durable succeeded record: money field is not valid canonical money.");
        }
        // r20 BLOCKER C: sign/range semantics
        // totalSettled must be > 0
        if (!isPositiveMoney(r.totalSettled)) {
          throw new SettlementError("IDEMPOTENCY_INCONSISTENT", "Durable succeeded record: totalSettled is not positive.");
        }
        // paymentEntryRemaining must be >= 0 (not negative)
        if (isNegativeMoney(r.paymentEntryRemaining)) {
          throw new SettlementError("IDEMPOTENCY_INCONSISTENT", "Durable succeeded record: paymentEntryRemaining is negative.");
        }
        // Validate each allocation has required fields + canonical money + sign/range
        for (const a of r.allocations) {
          if (!a?.settlementId || !a?.settledEntryId || !a?.settledAmount || !a?.settledEntryRemaining) {
            throw new SettlementError("IDEMPOTENCY_INCONSISTENT", "Durable succeeded record: allocation missing required fields.");
          }
          if (!isValidCanonicalMoney(a.settledAmount) || !isValidCanonicalMoney(a.settledEntryRemaining)) {
            throw new SettlementError("IDEMPOTENCY_INCONSISTENT", "Durable succeeded record: allocation money field is not valid canonical money.");
          }
          // settledAmount must be > 0
          if (!isPositiveMoney(a.settledAmount)) {
            throw new SettlementError("IDEMPOTENCY_INCONSISTENT", "Durable succeeded record: allocation settledAmount is not positive.");
          }
          // settledEntryRemaining must be >= 0
          if (isNegativeMoney(a.settledEntryRemaining)) {
            throw new SettlementError("IDEMPOTENCY_INCONSISTENT", "Durable succeeded record: allocation settledEntryRemaining is negative.");
          }
        }
        // r20 BLOCKER D: settlement ID bijection
        // Every settlementId must be non-empty
        for (const sid of r.settlementIds) {
          if (typeof sid !== "string" || sid.trim() === "") {
            throw new SettlementError("IDEMPOTENCY_INCONSISTENT", "Durable succeeded record: settlementId contains invalid entry.");
          }
        }
        // No duplicates in settlementIds
        const settlementIdSet = new Set(r.settlementIds);
        if (settlementIdSet.size !== r.settlementIds.length) {
          throw new SettlementError("IDEMPOTENCY_INCONSISTENT", "Durable succeeded record: settlementIds contains duplicates.");
        }
        // No duplicates in allocation settlementIds
        const allocSettlementIds = r.allocations.map(a => a.settlementId);
        const allocSet = new Set(allocSettlementIds);
        if (allocSet.size !== allocSettlementIds.length) {
          throw new SettlementError("IDEMPOTENCY_INCONSISTENT", "Durable succeeded record: allocation settlementIds contain duplicates.");
        }
        // Exact set equality: settlementIds and allocation settlementIds must be the same set
        if (settlementIdSet.size !== allocSet.size) {
          throw new SettlementError("IDEMPOTENCY_INCONSISTENT", "Durable succeeded record: settlementIds and allocation settlementIds sets differ.");
        }
        for (const sid of allocSettlementIds) {
          if (!settlementIdSet.has(sid)) {
            throw new SettlementError("IDEMPOTENCY_INCONSISTENT", "Durable succeeded record: allocation settlementId not in settlementIds.");
          }
        }
        // r21 BLOCKER C: totalSettled must equal sum of allocations.settledAmount
        const allocSum = r.allocations.reduce((sum, a) => addMoney(sum, a.settledAmount), "0.00");
        if (compareMoney(r.totalSettled, allocSum) !== 0) {
          throw new SettlementError("IDEMPOTENCY_INCONSISTENT", "Durable succeeded record: totalSettled does not equal sum of allocation settledAmounts.");
        }
        return { ...r, action: "replayed" } as SettlePaymentResult;
      }
      if (claim.record.state === "business_failed") {
        const errorBody = claim.record.responseBody as { code?: string; message?: string } | null;
        if (!errorBody?.code || !errorBody?.message) {
          throw new SettlementError("IDEMPOTENCY_INCONSISTENT", "Durable business failure record is malformed.");
        }
        throw new SettlementError(errorBody.code, errorBody.message);
      }
      throw new SettlementError("IDEMPOTENCY_INCONSISTENT", `Unexpected replay state '${claim.record.state}'.`);
    }
    if (claim.action === "conflict") {
      throw new SettlementError("IDEMPOTENCY_CONFLICT", `Idempotency key '${input.idempotencyKey}' was used with a different request body.`);
    }
    if (claim.action === "in_progress") {
      throw new SettlementError("OPERATION_IN_PROGRESS", `Operation '${input.idempotencyKey}' is still in progress.`);
    }

    // Step 4-18: ALL authoritative state handling inside ONE transaction.
    // r15 BLOCKER E: lock payment, re-read, validate, lock payment entry,
    // lock targets, recompute capacity — ALL inside the transaction.
    const executeSettlement = async (txScoped: {
      subledger: SubledgerService; paymentRepository: PaymentRepository;
      audit: AuditTransactionHandle; idempotency: IdempotencyTransactionHandle;
    }): Promise<SettlePaymentResult> => {
      const subledger = txScoped.subledger;
      const paymentRepo = txScoped.paymentRepository;
      const audit = txScoped.audit;
      const idempotency = txScoped.idempotency;

      // Step 4: lock payment + re-read
      const lockedPayment = await paymentRepo.lockPayment(user.tenantId, input.paymentId);
      if (!lockedPayment) throw new PaymentNotFoundError(input.paymentId);
      requireTenantMatch(user, lockedPayment.tenantId);
      // Validate posted/not reversed from locked row
      if (lockedPayment.status === "reversed") throw new PaymentReversedException(lockedPayment.id);
      if (lockedPayment.status !== "posted") throw new PaymentNotPostedError(lockedPayment.id, lockedPayment.status);
      if (!lockedPayment.postedEntryId) {
        throw new PaymentNotPostedError(lockedPayment.id, lockedPayment.status);
      }
      const postedEntryId: string = lockedPayment.postedEntryId;

      // Step 5: lock payment account entry + re-read
      await paymentRepo.lockPaymentEntry(user.tenantId, postedEntryId);
      const paymentEntry = await subledger.findEntryById(user.tenantId, postedEntryId);
      if (!paymentEntry) throw new SettlementError("INTERNAL_TRANSACTION_FAILED", `Payment entry '${postedEntryId}' not found.`);

      // Step 6: stable-sort target entry IDs for deterministic lock order
      const sortedAllocations = [...input.allocations].sort((a, b) =>
        a.settledEntryId.localeCompare(b.settledEntryId));

      // Step 7: lock targets in deterministic order + re-read
      const targetEntries: AccountEntry[] = [];
      for (const a of sortedAllocations) {
        await paymentRepo.lockSettledEntry(user.tenantId, a.settledEntryId);
        const target = await subledger.findEntryById(user.tenantId, a.settledEntryId);
        if (!target) throw new SettlementTargetNotFoundError(a.settledEntryId);
        requireTenantMatch(user, target.tenantId);
        if (target.accountId !== paymentEntry.accountId) throw new SettlementIncompatibleError(`payment account ${paymentEntry.accountId} != target account ${target.accountId}`);
        if (target.currency !== paymentEntry.currency) throw new SettlementIncompatibleError(`currency mismatch: ${paymentEntry.currency} vs ${target.currency}`);
        if (target.settlementStatus === "settled") throw new OverSettlementError("target", a.settledAmount, "0.00");
        if (target.settlementStatus === "reversed") throw new SettlementIncompatibleError(`target entry '${a.settledEntryId}' is reversed`);
        targetEntries.push(target);
      }

      // Step 8: lock/read settlement rows for capacity
      const existingPaymentSettlements = await paymentRepo.listSettlementsForPaymentEntry(user.tenantId, postedEntryId);
      const activePaymentSettlements = existingPaymentSettlements.filter(s => s.settlementStatus === "settled");

      // Step 9: recompute payment remaining capacity from locked state
      const alreadySettledOnPayment = activePaymentSettlements.reduce((sum, s) => addMoney(sum, s.settledAmount), "0.00");
      const paymentCapacity = subtractAbs(paymentEntry.amountSigned, alreadySettledOnPayment);
      const totalNewSettlement = sortedAllocations.reduce((sum, a) => addMoney(sum, normalizeMoney(a.settledAmount)), "0.00");
      if (compareMoney(totalNewSettlement, paymentCapacity) > 0) {
        throw new OverSettlementError("payment", totalNewSettlement, paymentCapacity);
      }

      // Step 10: recompute each target remaining capacity from locked state
      for (let i = 0; i < sortedAllocations.length; i++) {
        const a = sortedAllocations[i]!;
        const target = targetEntries[i]!;
        const existingTargetSettlements = await paymentRepo.listSettlementsForSettledEntry(user.tenantId, a.settledEntryId);
        const activeTargetSettlements = existingTargetSettlements.filter(s => s.settlementStatus === "settled");
        const alreadySettledOnTarget = activeTargetSettlements.reduce((sum, s) => addMoney(sum, s.settledAmount), "0.00");
        const targetCapacity = subtractAbs(target.amountSigned, alreadySettledOnTarget);
        if (compareMoney(normalizeMoney(a.settledAmount), targetCapacity) > 0) {
          throw new OverSettlementError("target", a.settledAmount, targetCapacity);
        }
      }

      // Step 11: SHARED subledger cutover coordination
      // updateEntrySettlementStatusPublic calls requireCutoverLock internally.

      // Step 12: insert settlement records
      const settlementIds: string[] = [];
      const allocationResults: SettlePaymentResult["allocations"] = [];
      for (let i = 0; i < sortedAllocations.length; i++) {
        const a = sortedAllocations[i]!;
        const target = targetEntries[i]!;
        const settledAmount = normalizeMoney(a.settledAmount);
        const settlement = await paymentRepo.insertSettlement({
          tenantId: user.tenantId,
          paymentEntryId: postedEntryId,
          settledEntryId: a.settledEntryId,
          settledAmount,
          settlementStatus: "settled",
          createdBy: user.userId,
        });
        settlementIds.push(settlement.id);

        // Step 13: update settlement statuses
        const existingTargetSettlements = await paymentRepo.listSettlementsForSettledEntry(user.tenantId, a.settledEntryId);
        const activeTargetSettlements = existingTargetSettlements.filter(s => s.settlementStatus === "settled");
        const totalSettledOnTarget = activeTargetSettlements.reduce((sum, s) => addMoney(sum, s.settledAmount), "0.00");
        const targetRemaining = subtractAbs(target.amountSigned, totalSettledOnTarget);
        const newTargetStatus = isZeroMoney(targetRemaining) ? "settled" : "partially_settled";
        await subledger.updateEntrySettlementStatusPublic(user.tenantId, a.settledEntryId, newTargetStatus);
        allocationResults.push({ settlementId: settlement.id, settledEntryId: a.settledEntryId, settledAmount, settledEntryRemaining: targetRemaining });
      }

      // Update payment entry settlement status
      const totalSettledOnPayment = addMoney(alreadySettledOnPayment, totalNewSettlement);
      const paymentRemaining = subtractAbs(paymentEntry.amountSigned, totalSettledOnPayment);
      const newPaymentStatus = isZeroMoney(paymentRemaining) ? "settled" : "partially_settled";
      await subledger.updateEntrySettlementStatusPublic(user.tenantId, postedEntryId, newPaymentStatus);

      // Step 14: audit
      await appendAuditLog(audit, user.tenantId, user.userId, {
        entityType: SETTLEMENT_ENTITY_TYPE,
        entityId: settlementIds[0]!,
        actionType: "payment.settle",
        newValuesJson: {
          paymentId: lockedPayment.id,
          paymentEntryId: postedEntryId,
          settlementIds,
          allocations: allocationResults,
          totalSettled: totalNewSettlement,
          paymentEntryRemaining: paymentRemaining,
        },
        idempotencyKey: input.idempotencyKey,
      });

      // Step 15: mark idempotency succeeded
      const result: SettlePaymentResult = {
        action: "settled",
        paymentId: lockedPayment.id,
        settlementIds,
        totalSettled: totalNewSettlement,
        paymentEntryRemaining: paymentRemaining,
        allocations: allocationResults,
      };
      await markSucceeded(idempotency, claim.record.id, {
        responseCode: 200,
        responseBody: result,
        entityType: SETTLEMENT_ENTITY_TYPE,
        entityId: settlementIds[0]!,
      }, claim.record.ownerToken!, now);

      return result;
    };

    try {
      return await this.deps.transactionRunner!(async (tx: unknown) => {
          const txSubledger = this.deps.txFactories!.createSubledger(tx);
          const txPaymentRepo = this.deps.txFactories!.createPaymentRepository(tx);
          const txAudit = this.deps.txFactories!.createAudit(tx);
          const txIdem = this.deps.txFactories!.createIdempotency(tx);
          return executeSettlement({
            subledger: txSubledger, paymentRepository: txPaymentRepo,
            audit: txAudit, idempotency: txIdem,
          });
        });
    } catch (txError) {
      // r15 BLOCKER E: classify business vs technical failures.
      const isBusinessError =
        txError instanceof OverSettlementError ||
        txError instanceof SettlementTargetNotFoundError ||
        txError instanceof SettlementIncompatibleError ||
        txError instanceof PaymentNotPostedError ||
        txError instanceof PaymentReversedException ||
        txError instanceof PaymentNotFoundError;
      try {
        if (isBusinessError) {
          const error = txError as Error & { code?: string };
          await markBusinessFailed(this.deps.idempotency, claim.record.id, {
            responseCode: 422,
            responseBody: { code: (error as any).code ?? "SETTLEMENT_FAILED", message: error.message },
            lastErrorClass: error.name,
          }, claim.record.ownerToken!, now);
        } else {
          await markRetryableFailed(this.deps.idempotency, claim.record.id, {
            responseCode: 500,
            responseBody: { message: "Settlement transaction failed and rolled back." },
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

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/**
 * Subtract the absolute value of `b` from the absolute value of `a`.
 * Used to compute remaining capacity: |a| - |b|, where a is the entry's
 * signed amount and b is the sum of settlements (positive).
 *
 * Returns a POSITIVE string (or "0.00" if b >= |a|).
 */
function subtractAbs(a: string, b: string): string {
  // r12 BLOCKER 6: use contracted decimal-money operations instead of
  // JavaScript floating point. Contract 07 prohibits parseFloat for money.
  const absA = absMoney(a);
  if (compareMoney(absA, b) >= 0) {
    return subtractMoney(absA, b);
  }
  return "0.00";
}
