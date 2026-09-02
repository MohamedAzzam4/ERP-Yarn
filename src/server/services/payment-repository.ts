/**
 * Payment Repository — WP-05-04.
 *
 * Contract: docs/contracts/07_subledger_and_costs_contract.md §13-17
 *   §13: Payment stores positive absolute amount, direction, method, account,
 *        date, state, notes. Posting creates one signed account entry.
 *   §14: One payment entry may settle one or more receivable/payable entries.
 *        Settlement total cannot exceed available payment or unsettled source.
 *   §15: Advance is allowed without sale/payable source.
 *   §16: Settlement record links payment entry to target entry with positive
 *        amount and actor/time. Validate same tenant/account/currency.
 *   §17: Reversal creates opposite signed entry; reverse/unallocate settlement
 *        links; mark payment reversed; never delete/edit original.
 *
 * This is the persistence boundary for payments + payment_settlements.
 * Account entries themselves go through SubledgerService.insertEntry (immutable).
 */
import "server-only";

import type { Payment, PaymentSettlement, AccountEntry } from "@/server/db/schema/subledger";

// ---------------------------------------------------------------------------
// Input types.
// ---------------------------------------------------------------------------

export interface NewPaymentInput {
  tenantId: string;
  paymentNo: string;
  paymentDate: string;
  accountId: string;
  amount: string;  // POSITIVE absolute amount
  paymentDirection: "received_from_party" | "paid_to_party";
  paymentMethod: "cash" | "bank_transfer" | "check" | "wallet_instapay" | "other";
  status: "draft" | "posted";
  notes?: string | null;
  postedEntryId?: string | null;
  idempotencyKey: string;
  createdBy: string;
}

export interface UpdatePaymentStatusInput {
  status: "draft" | "posted" | "reversed" | "cancelled";
  postedEntryId?: string | null;
  reversalOfPaymentId?: string | null;
  isLocked?: boolean;
  updatedBy: string;
}

export interface NewSettlementInput {
  tenantId: string;
  paymentEntryId: string;
  settledEntryId: string;
  settledAmount: string;  // POSITIVE
  settlementStatus: "settled" | "reversed";
  createdBy: string;
}

// ---------------------------------------------------------------------------
// Repository interface.
// ---------------------------------------------------------------------------

/**
 * PaymentRepository — persistence boundary for payments + payment_settlements.
 *
 * Account entries are persisted via SubledgerService.insertEntry (the sole
 * owner of account_entry creation per Contract 14 §4). This repository owns
 * the `payments` and `payment_settlements` tables only.
 */
export interface PaymentRepository {
  // --- payments ---

  /** Insert a new payment row. */
  insertPayment(row: NewPaymentInput): Promise<Payment>;

  /** Find a payment by id. */
  findPaymentById(tenantId: string, paymentId: string): Promise<Payment | null>;

  /** Find a payment by idempotency key (for replay). */
  findPaymentByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<Payment | null>;

  /** Find a payment by its posted account entry id. */
  findPaymentByPostedEntryId(tenantId: string, postedEntryId: string): Promise<Payment | null>;

  /**
   * Conditionally update payment status. Only succeeds if current status
   * matches one of expectedCurrentStatuses. Returns null if condition fails.
   */
  updatePaymentStatus(
    tenantId: string,
    paymentId: string,
    patch: UpdatePaymentStatusInput,
    expectedCurrentStatuses: string[],
  ): Promise<Payment | null>;

  /**
   * Lock a payment row for the duration of the transaction (SELECT FOR UPDATE).
   * Required before settlement/reversal to prevent concurrent modifications.
   */
  lockPayment(tenantId: string, paymentId: string): Promise<Payment | null>;

  // --- payment_settlements ---

  /** Insert a new settlement row. */
  insertSettlement(row: NewSettlementInput): Promise<PaymentSettlement>;

  /** Find a settlement by id. */
  findSettlementById(tenantId: string, settlementId: string): Promise<PaymentSettlement | null>;

  /** List all settlements linked to a payment entry (both directions). */
  listSettlementsForPaymentEntry(tenantId: string, paymentEntryId: string): Promise<PaymentSettlement[]>;

  /** List all settlements where the entry is the settled target. */
  listSettlementsForSettledEntry(tenantId: string, settledEntryId: string): Promise<PaymentSettlement[]>;

  /**
   * Lock all settlement rows linked to a payment entry (SELECT FOR UPDATE).
   * Required before reversal unallocation.
   */
  lockSettlementsForPaymentEntry(tenantId: string, paymentEntryId: string): Promise<PaymentSettlement[]>;

  /**
   * Acquire a transaction-scoped advisory lock on a settled entry.
   * Prevents two concurrent settlements from over-settling the same target.
   */
  lockSettledEntry(tenantId: string, entryId: string): Promise<void>;

  /**
   * Acquire a transaction-scoped advisory lock on a payment entry.
   * Prevents two concurrent settlements from over-settling the same payment.
   */
  lockPaymentEntry(tenantId: string, entryId: string): Promise<void>;

  /**
   * Transition a settlement row's status from 'settled' to 'reversed'.
   * Called during payment reversal to unallocate the settlement.
   * The original row is preserved (immutable history) — only the
   * settlement_status changes, so future capacity queries no longer
   * count this allocation as active.
   *
   * Contract 07 §17: reversal unallocates settlements.
   * The original settlement row is NOT deleted — its amount/account/source
   * identity remain immutable. Only settlement_status transitions.
   *
   * Returns the updated row, or null if the row was not in 'settled' state
   * (already reversed or not found).
   */
  reverseSettlement(tenantId: string, settlementId: string, updatedBy: string): Promise<PaymentSettlement | null>;
}

// ---------------------------------------------------------------------------
// Re-export domain types for service consumers.
// ---------------------------------------------------------------------------

export type { Payment, PaymentSettlement, AccountEntry } from "@/server/db/schema/subledger";
