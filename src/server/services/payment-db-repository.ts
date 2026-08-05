/**
 * Drizzle-backed PaymentRepository — the production DB persistence boundary.
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
 * Contract: docs/contracts/03_database_schema_contract.md §12.2
 *   payments table with payment_status enum, payment_direction enum,
 *   payment_method enum (DEC-066). payment_settlements with settlement_status
 *   enum.
 *
 * This repository owns the `payments` and `payment_settlements` tables only.
 * Account entries are persisted via SubledgerService (sole owner of
 * account_entry creation per Contract 14 §4).
 *
 * Concurrency (Contract 07 §16):
 *   - lockPayment uses SELECT ... FOR UPDATE on the payment row inside the
 *     caller's transaction. Settlement and reversal MUST call this BEFORE
 *     reading/modifying payment state.
 *   - lockSettlementsForPaymentEntry uses SELECT ... FOR UPDATE on all
 *     settlement rows for a payment entry. Reversal uses this BEFORE
 *     unallocating.
 *   - lockSettledEntry / lockPaymentEntry use pg_advisory_xact_lock on the
 *     target entry id. This prevents two concurrent settlements from
 *     over-settling the same target.
 *
 * Tenant isolation: every query filters by tenantId. No query reads or writes
 * cross-tenant data.
 *
 * Conditional updates:
 *   updatePaymentStatus uses WHERE status IN (expectedCurrentStatuses) to
 *   enforce state-machine transitions atomically. Returns null if the
 *   condition fails (stale state).
 */
import "server-only";
import { eq, and, inArray, sql as drizzleSql } from "drizzle-orm";
import {
  payments,
  paymentSettlements,
} from "@/server/db/schema/subledger";
import type { db as DbType } from "@/server/db/client";
import type {
  PaymentRepository,
  NewPaymentInput,
  UpdatePaymentStatusInput,
  NewSettlementInput,
} from "./payment-repository";
import type { Payment, PaymentSettlement } from "@/server/db/schema/subledger";

type Db = NonNullable<typeof DbType>;
type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Drizzle-backed PaymentRepository.
 *
 * Accepts either the root `db` instance or a `tx` from a db.transaction()
 * callback. When constructed with a `tx`, all queries run on the same
 * transaction connection, so SELECT ... FOR UPDATE and advisory locks are
 * transaction-scoped.
 */
export class PaymentDbRepository implements PaymentRepository {
  constructor(private readonly db: DbOrTx) {}

  // -------------------------------------------------------------------------
  // payments
  // -------------------------------------------------------------------------

  async insertPayment(row: NewPaymentInput): Promise<Payment> {
    const [result] = await this.db
      .insert(payments)
      .values({
        tenantId: row.tenantId,
        paymentNo: row.paymentNo,
        paymentDate: row.paymentDate,
        accountId: row.accountId,
        amount: row.amount,
        paymentDirection: row.paymentDirection as Payment["paymentDirection"],
        paymentMethod: row.paymentMethod as Payment["paymentMethod"],
        status: row.status as Payment["status"],
        notes: row.notes ?? null,
        postedEntryId: row.postedEntryId ?? null,
        idempotencyKey: row.idempotencyKey,
        isLocked: false,
        createdBy: row.createdBy,
        updatedBy: row.createdBy,
      })
      .returning();
    if (!result) {
      throw new Error("Failed to insert payment row.");
    }
    return result;
  }

  async findPaymentById(
    tenantId: string,
    paymentId: string,
  ): Promise<Payment | null> {
    const [result] = await this.db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.tenantId, tenantId),
          eq(payments.id, paymentId),
        ),
      )
      .limit(1);
    return result ?? null;
  }

  async findPaymentByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<Payment | null> {
    const [result] = await this.db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.tenantId, tenantId),
          eq(payments.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    return result ?? null;
  }

  async findPaymentByPostedEntryId(
    tenantId: string,
    postedEntryId: string,
  ): Promise<Payment | null> {
    const [result] = await this.db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.tenantId, tenantId),
          eq(payments.postedEntryId, postedEntryId),
        ),
      )
      .limit(1);
    return result ?? null;
  }

  /**
   * Conditionally update payment status.
   *
   * WHERE clause enforces:
   *   - tenantId match (tenant isolation)
   *   - id match
   *   - status IN (expectedCurrentStatuses) (state-machine guard)
   *
   * Returns the updated row, or null if no row matched the conditions.
   *
   * The status column is a pgEnum, so the patch.status value is sent as the
   * enum string. Drizzle handles the cast.
   */
  async updatePaymentStatus(
    tenantId: string,
    paymentId: string,
    patch: UpdatePaymentStatusInput,
    expectedCurrentStatuses: string[],
  ): Promise<Payment | null> {
    if (expectedCurrentStatuses.length === 0) {
      // Defensive: no expected statuses means no row can match.
      return null;
    }
    const [result] = await this.db
      .update(payments)
      .set({
        status: patch.status as Payment["status"],
        postedEntryId: patch.postedEntryId ?? null,
        reversalOfPaymentId: patch.reversalOfPaymentId ?? null,
        isLocked: patch.isLocked ?? false,
        updatedBy: patch.updatedBy,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(payments.tenantId, tenantId),
          eq(payments.id, paymentId),
          inArray(
            payments.status,
            expectedCurrentStatuses as Payment["status"][],
          ),
        ),
      )
      .returning();
    return result ?? null;
  }

  /**
   * Lock a payment row for the duration of the transaction.
   * Uses SELECT ... FOR UPDATE. Caller MUST be inside a db.transaction().
   */
  async lockPayment(
    tenantId: string,
    paymentId: string,
  ): Promise<Payment | null> {
    const [result] = await this.db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.tenantId, tenantId),
          eq(payments.id, paymentId),
        ),
      )
      .for("update")
      .limit(1);
    return result ?? null;
  }

  // -------------------------------------------------------------------------
  // payment_settlements
  // -------------------------------------------------------------------------

  async insertSettlement(row: NewSettlementInput): Promise<PaymentSettlement> {
    const [result] = await this.db
      .insert(paymentSettlements)
      .values({
        tenantId: row.tenantId,
        paymentEntryId: row.paymentEntryId,
        settledEntryId: row.settledEntryId,
        settledAmount: row.settledAmount,
        settlementStatus: row.settlementStatus as PaymentSettlement["settlementStatus"],
        createdBy: row.createdBy,
        updatedBy: row.createdBy,
      })
      .returning();
    if (!result) {
      throw new Error("Failed to insert payment settlement row.");
    }
    return result;
  }

  async findSettlementById(
    tenantId: string,
    settlementId: string,
  ): Promise<PaymentSettlement | null> {
    const [result] = await this.db
      .select()
      .from(paymentSettlements)
      .where(
        and(
          eq(paymentSettlements.tenantId, tenantId),
          eq(paymentSettlements.id, settlementId),
        ),
      )
      .limit(1);
    return result ?? null;
  }

  async listSettlementsForPaymentEntry(
    tenantId: string,
    paymentEntryId: string,
  ): Promise<PaymentSettlement[]> {
    return this.db
      .select()
      .from(paymentSettlements)
      .where(
        and(
          eq(paymentSettlements.tenantId, tenantId),
          eq(paymentSettlements.paymentEntryId, paymentEntryId),
        ),
      );
  }

  async listSettlementsForSettledEntry(
    tenantId: string,
    settledEntryId: string,
  ): Promise<PaymentSettlement[]> {
    return this.db
      .select()
      .from(paymentSettlements)
      .where(
        and(
          eq(paymentSettlements.tenantId, tenantId),
          eq(paymentSettlements.settledEntryId, settledEntryId),
        ),
      );
  }

  /**
   * Lock all settlement rows linked to a payment entry for the duration of
   * the transaction. Uses SELECT ... FOR UPDATE. Caller MUST be inside a
   * db.transaction(). Reversal uses this BEFORE unallocating.
   */
  async lockSettlementsForPaymentEntry(
    tenantId: string,
    paymentEntryId: string,
  ): Promise<PaymentSettlement[]> {
    return this.db
      .select()
      .from(paymentSettlements)
      .where(
        and(
          eq(paymentSettlements.tenantId, tenantId),
          eq(paymentSettlements.paymentEntryId, paymentEntryId),
        ),
      )
      .for("update");
  }

  /**
   * Acquire a transaction-scoped advisory lock on a settled entry id.
   * Prevents two concurrent settlements from over-settling the same target.
   * Caller MUST be inside a db.transaction() for transaction-scoped semantics.
   *
   * Uses pg_advisory_xact_lock(hashtext(key)) — same pattern as
   * SubledgerDbRepository.lockSourceEntry. hashtext returns int4 which is
   * implicitly cast to int8 (bigint) for the single-key form of
   * pg_advisory_xact_lock.
   */
  async lockSettledEntry(_tenantId: string, entryId: string): Promise<void> {
    const key = `settled|${entryId}`;
    await this.db.execute(
      drizzleSql`SELECT pg_advisory_xact_lock(hashtext(${key}))`,
    );
  }

  /**
   * Acquire a transaction-scoped advisory lock on a payment entry id.
   * Prevents two concurrent settlements from over-settling the same payment.
   * Caller MUST be inside a db.transaction() for transaction-scoped semantics.
   *
   * Uses a different key namespace from lockSettledEntry (prefix `paymentEntry|`)
   * to avoid accidental collisions between the two lock namespaces.
   */
  async lockPaymentEntry(_tenantId: string, entryId: string): Promise<void> {
    const key = `paymentEntry|${entryId}`;
    await this.db.execute(
      drizzleSql`SELECT pg_advisory_xact_lock(hashtext(${key}))`,
    );
  }
}

/**
 * Factory: create a PaymentDbRepository bound to the root db or a tx.
 * Used by server actions and by tx-scoped factory closures.
 */
export function createPaymentDbRepository(db: DbOrTx): PaymentDbRepository {
  return new PaymentDbRepository(db);
}
