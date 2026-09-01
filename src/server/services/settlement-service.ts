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
  normalizeMoney, isPositiveMoney, addMoney, compareMoney, absMoney, isZeroMoney, subtractMoney,
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
   * When absent (unit tests), runs without a boundary.
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
    if (input.allocations.length === 0) throw new SettlementError("VALIDATION_FAILED", "At least one allocation is required.");
    for (const a of input.allocations) {
      if (!isPositiveMoney(a.settledAmount)) {
        throw new InvalidSettlementAmountError(a.settledAmount);
      }
    }

    // Step 2: fetch + lock payment
    const payment = await this.deps.paymentRepository.findPaymentById(user.tenantId, input.paymentId);
    if (!payment) throw new PaymentNotFoundError(input.paymentId);
    requireTenantMatch(user, payment.tenantId);
    if (payment.status === "reversed") throw new PaymentReversedException(payment.id);
    if (payment.status !== "posted") throw new PaymentNotPostedError(payment.id, payment.status);

    // Lock the payment row for the duration of the transaction
    await this.deps.paymentRepository.lockPayment(user.tenantId, payment.id);

    // Step 3: claim idempotency
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
      const responseBody = claim.record.responseBody as Partial<SettlePaymentResult> | null;
      if (responseBody?.paymentId) {
        return { ...responseBody, action: "replayed" } as SettlePaymentResult;
      }
    }
    if (claim.action === "conflict") {
      throw new SettlementError("IDEMPOTENCY_CONFLICT", `Idempotency key '${input.idempotencyKey}' was used with a different request body.`);
    }
    if (claim.action === "in_progress") {
      throw new SettlementError("OPERATION_IN_PROGRESS", `Operation '${input.idempotencyKey}' is still in progress.`);
    }

    // Step 4: fetch + lock the payment's posted entry
    if (!payment.postedEntryId) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 422, responseBody: { message: "Payment has no posted entry." },
        lastErrorClass: "PaymentNotPostedError",
      }, claim.record.ownerToken!, now);
      throw new PaymentNotPostedError(payment.id, payment.status);
    }
    // Capture the non-null postedEntryId so the closure below preserves
    // TypeScript's narrowing (closures don't preserve control-flow narrowing).
    const postedEntryId: string = payment.postedEntryId;
    await this.deps.paymentRepository.lockPaymentEntry(user.tenantId, postedEntryId);
    const paymentEntry = await this.deps.subledger.findEntryById(user.tenantId, payment.postedEntryId);
    if (!paymentEntry) {
      throw new SettlementError("INTERNAL_TRANSACTION_FAILED", `Payment entry '${payment.postedEntryId}' not found.`);
    }

    // Step 5: fetch + validate each target entry; lock each
    const targetEntries: AccountEntry[] = [];
    for (const a of input.allocations) {
      await this.deps.paymentRepository.lockSettledEntry(user.tenantId, a.settledEntryId);
      const target = await this.deps.subledger.findEntryById(user.tenantId, a.settledEntryId);
      if (!target) {
        await markBusinessFailed(this.deps.idempotency, claim.record.id, {
          responseCode: 422, responseBody: { message: `Target entry '${a.settledEntryId}' not found.` },
          lastErrorClass: "SettlementTargetNotFoundError",
        }, claim.record.ownerToken!, now);
        throw new SettlementTargetNotFoundError(a.settledEntryId);
      }
      // Same tenant
      requireTenantMatch(user, target.tenantId);
      // Same account
      if (target.accountId !== paymentEntry.accountId) {
        await markBusinessFailed(this.deps.idempotency, claim.record.id, {
          responseCode: 422, responseBody: { message: `Account mismatch: payment account ${paymentEntry.accountId} vs target account ${target.accountId}.` },
          lastErrorClass: "SettlementIncompatibleError",
        }, claim.record.ownerToken!, now);
        throw new SettlementIncompatibleError(`payment account ${paymentEntry.accountId} != target account ${target.accountId}`);
      }
      // Same currency
      if (target.currency !== paymentEntry.currency) {
        await markBusinessFailed(this.deps.idempotency, claim.record.id, {
          responseCode: 422, responseBody: { message: `Currency mismatch: ${paymentEntry.currency} vs ${target.currency}.` },
          lastErrorClass: "SettlementIncompatibleError",
        }, claim.record.ownerToken!, now);
        throw new SettlementIncompatibleError(`currency mismatch: ${paymentEntry.currency} vs ${target.currency}`);
      }
      // Compatible signs: payment entry and target entry must have OPPOSITE signs
      // (a customer payment is negative, a customer receivable is positive — they net to zero)
      // OR both are advances (same sign) — but for MVP we require opposite signs.
      const paymentSign = parseFloat(paymentEntry.amountSigned) > 0 ? 1 : -1;
      const targetSign = parseFloat(target.amountSigned) > 0 ? 1 : -1;
      if (paymentSign === targetSign) {
        await markBusinessFailed(this.deps.idempotency, claim.record.id, {
          responseCode: 422, responseBody: { message: `Incompatible signs: payment ${paymentEntry.amountSigned}, target ${target.amountSigned}.` },
          lastErrorClass: "SettlementIncompatibleError",
        }, claim.record.ownerToken!, now);
        throw new SettlementIncompatibleError(`incompatible signs: payment ${paymentEntry.amountSigned}, target ${target.amountSigned}`);
      }
      // Target must not be already fully settled or reversed
      if (target.settlementStatus === "settled") {
        await markBusinessFailed(this.deps.idempotency, claim.record.id, {
          responseCode: 422, responseBody: { message: `Target entry '${a.settledEntryId}' is already settled.` },
          lastErrorClass: "OverSettlementError",
        }, claim.record.ownerToken!, now);
        throw new OverSettlementError("target", a.settledAmount, "0.00");
      }
      if (target.settlementStatus === "reversed") {
        await markBusinessFailed(this.deps.idempotency, claim.record.id, {
          responseCode: 422, responseBody: { message: `Target entry '${a.settledEntryId}' is reversed.` },
          lastErrorClass: "SettlementIncompatibleError",
        }, claim.record.ownerToken!, now);
        throw new SettlementIncompatibleError(`target entry '${a.settledEntryId}' is reversed`);
      }
      targetEntries.push(target);
    }

    // Step 6: compute existing settlements + verify capacity
    const existingPaymentSettlements = await this.deps.paymentRepository.listSettlementsForPaymentEntry(
      user.tenantId, payment.postedEntryId,
    );
    // Only count non-reversed settlements toward capacity
    const activePaymentSettlements = existingPaymentSettlements.filter(s => s.settlementStatus === "settled");
    const alreadySettledOnPayment = activePaymentSettlements.reduce(
      (sum, s) => addMoney(sum, s.settledAmount), "0.00",
    );
    const paymentCapacity = subtractAbs(paymentEntry.amountSigned, alreadySettledOnPayment);
    const totalNewSettlement = input.allocations.reduce(
      (sum, a) => addMoney(sum, normalizeMoney(a.settledAmount)), "0.00",
    );
    if (compareMoney(totalNewSettlement, paymentCapacity) > 0) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 422, responseBody: { message: `Over-settlement on payment: requested ${totalNewSettlement}, available ${paymentCapacity}.` },
        lastErrorClass: "OverSettlementError",
      }, claim.record.ownerToken!, now);
      throw new OverSettlementError("payment", totalNewSettlement, paymentCapacity);
    }

    // For each target, compute existing settlements + verify capacity
    const targetCapacities: Map<string, string> = new Map();
    for (let i = 0; i < input.allocations.length; i++) {
      const a = input.allocations[i]!;
      const target = targetEntries[i]!;
      const existingTargetSettlements = await this.deps.paymentRepository.listSettlementsForSettledEntry(
        user.tenantId, a.settledEntryId,
      );
      const activeTargetSettlements = existingTargetSettlements.filter(s => s.settlementStatus === "settled");
      const alreadySettledOnTarget = activeTargetSettlements.reduce(
        (sum, s) => addMoney(sum, s.settledAmount), "0.00",
      );
      const targetCapacity = subtractAbs(target.amountSigned, alreadySettledOnTarget);
      if (compareMoney(normalizeMoney(a.settledAmount), targetCapacity) > 0) {
        await markBusinessFailed(this.deps.idempotency, claim.record.id, {
          responseCode: 422, responseBody: { message: `Over-settlement on target '${a.settledEntryId}': requested ${a.settledAmount}, available ${targetCapacity}.` },
          lastErrorClass: "OverSettlementError",
        }, claim.record.ownerToken!, now);
        throw new OverSettlementError("target", a.settledAmount, targetCapacity);
      }
      targetCapacities.set(a.settledEntryId, targetCapacity);
    }

    // Step 7-9: insert settlement rows, update entry settlement statuses,
    // audit, mark idempotency succeeded.
    //
    // WP-07-04 cutover coordination (r11): ALL of these writes MUST share the
    // SAME db.transaction() so the cutover advisory lock (acquired by
    // updateEntrySettlementStatusPublic) protects the FULL settlement flow.
    const executeSettlement = async (txScoped: {
      subledger: SubledgerService; paymentRepository: PaymentRepository;
      audit: AuditTransactionHandle; idempotency: IdempotencyTransactionHandle;
    } | null): Promise<SettlePaymentResult> => {
      const subledger = txScoped?.subledger ?? this.deps.subledger;
      const paymentRepo = txScoped?.paymentRepository ?? this.deps.paymentRepository;
      const audit = txScoped?.audit ?? this.deps.audit;
      const idempotency = txScoped?.idempotency ?? this.deps.idempotency;

      const settlementIds: string[] = [];
      const allocationResults: SettlePaymentResult["allocations"] = [];
      for (let i = 0; i < input.allocations.length; i++) {
        const a = input.allocations[i]!;
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

        const existingTargetSettlements = await paymentRepo.listSettlementsForSettledEntry(
          user.tenantId, a.settledEntryId,
        );
        const activeTargetSettlements = existingTargetSettlements.filter(s => s.settlementStatus === "settled");
        const totalSettledOnTarget = activeTargetSettlements.reduce(
          (sum, s) => addMoney(sum, s.settledAmount), "0.00",
        );
        const targetRemaining = subtractAbs(target.amountSigned, totalSettledOnTarget);
        const newTargetStatus = isZeroMoney(targetRemaining) ? "settled" : "partially_settled";
        await subledger.updateEntrySettlementStatusPublic(
          user.tenantId, a.settledEntryId, newTargetStatus,
        );

        allocationResults.push({
          settlementId: settlement.id,
          settledEntryId: a.settledEntryId,
          settledAmount,
          settledEntryRemaining: targetRemaining,
        });
      }

      const totalSettledOnPayment = addMoney(alreadySettledOnPayment, totalNewSettlement);
      const paymentRemaining = subtractAbs(paymentEntry.amountSigned, totalSettledOnPayment);
      const newPaymentStatus = isZeroMoney(paymentRemaining) ? "settled" : "partially_settled";
      await subledger.updateEntrySettlementStatusPublic(
        user.tenantId, postedEntryId, newPaymentStatus,
      );

      await appendAuditLog(audit, user.tenantId, user.userId, {
        entityType: SETTLEMENT_ENTITY_TYPE,
        entityId: settlementIds[0]!,
        actionType: "payment.settle",
        newValuesJson: {
          paymentId: payment.id,
          paymentEntryId: postedEntryId,
          settlementIds,
          allocations: allocationResults,
          totalSettled: totalNewSettlement,
          paymentEntryRemaining: paymentRemaining,
        },
        idempotencyKey: input.idempotencyKey,
      });

      const result: SettlePaymentResult = {
        action: "settled",
        paymentId: payment.id,
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
      if (this.deps.transactionRunner && this.deps.txFactories) {
        return await this.deps.transactionRunner(async (tx: unknown) => {
          const txSubledger = this.deps.txFactories!.createSubledger(tx);
          const txPaymentRepo = this.deps.txFactories!.createPaymentRepository(tx);
          const txAudit = this.deps.txFactories!.createAudit(tx);
          const txIdem = this.deps.txFactories!.createIdempotency(tx);
          return executeSettlement({
            subledger: txSubledger, paymentRepository: txPaymentRepo,
            audit: txAudit, idempotency: txIdem,
          });
        });
      } else {
        return executeSettlement(null);
      }
    } catch (txError) {
      // WP-07-04/BLOCKER 4: technical failure (including cutover lock wait
      // timeout) → terminalize as retryable_failed for immediate same-key retry.
      try {
        await markRetryableFailed(this.deps.idempotency, claim.record.id, {
          responseCode: 500,
          responseBody: { message: "Settlement transaction failed and rolled back." },
          lastErrorClass: txError instanceof Error ? txError.name : "Unknown",
        }, claim.record.ownerToken!, now);
      } catch {
        // If markRetryableFailed fails, record remains in_progress → lease expiry.
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
