/**
 * Drizzle-backed SubledgerTransactionHandle — the production DB repository.
 *
 * Contract: docs/contracts/07_subledger_and_costs_contract.md §9, §24
 *   "SubledgerService owns entry creation/reversal/settlement."
 *
 * Contract: docs/contracts/03_database_schema_contract.md §12
 *   accounts + account_entries tables with unique constraints.
 *
 * Account get-or-create concurrency (Contract 07 §7):
 *   The DB has a unique index on (tenant_id, owner_type, owner_id, currency).
 *   insertAccount uses ON CONFLICT DO NOTHING. If concurrent insert wins,
 *   the service retries findAccount to pick up the existing row.
 *
 * Source uniqueness (Contract 07 §9):
 *   account_entries has a non-unique index on (tenant_id, source_document_type,
 *   source_document_id). Source uniqueness is enforced at the service layer
 *   via findEntryBySource BEFORE insertEntry. The service-layer check runs
 *   inside the transaction under a transaction-scoped advisory lock
 *   (pg_advisory_xact_lock) on the source document, preventing concurrent
 *   postings for the same source. Defense-in-depth: the unique
 *   (tenant_id, entry_no) constraint prevents duplicate entry numbers;
 *   the idempotency unique constraint prevents duplicate idempotency keys.
 */
import "server-only";
import { eq, and, sql } from "drizzle-orm";
import { accounts, accountEntries } from "@/server/db/schema";
import type { db as DbType } from "@/server/db/client";
import { sourceLockKey } from "./subledger-service";
import type {
  SubledgerTransactionHandle,
  NewAccountInput,
  NewEntryInput,
} from "./subledger-service";
import type { Account, AccountEntry } from "@/server/db/schema/subledger";

type Db = NonNullable<typeof DbType>;

/**
 * Drizzle-backed SubledgerTransactionHandle.
 */
export class SubledgerDbRepository implements SubledgerTransactionHandle {
  constructor(private readonly db: Db) {}

  async findAccount(tenantId: string, ownerType: string, ownerId: string, currency: string): Promise<Account | null> {
    const [result] = await this.db
      .select()
      .from(accounts)
      .where(and(
        eq(accounts.tenantId, tenantId),
        eq(accounts.ownerType, ownerType as Account["ownerType"]),
        eq(accounts.ownerId, ownerId),
        eq(accounts.currency, currency),
      ))
      .limit(1);
    return result ?? null;
  }

  /**
   * Insert a new account with concurrent-insert safety.
   * Uses ON CONFLICT DO NOTHING on the unique
   * (tenant_id, owner_type, owner_id, currency) index.
   * Returns null if a concurrent insert won — caller retries findAccount.
   */
  async insertAccount(row: NewAccountInput): Promise<Account> {
    const [result] = await this.db
      .insert(accounts)
      .values({
        tenantId: row.tenantId,
        ownerType: row.ownerType as Account["ownerType"],
        ownerId: row.ownerId,
        currency: row.currency,
        createdBy: row.createdBy,
      })
      .onConflictDoNothing({
        target: [
          accounts.tenantId,
          accounts.ownerType,
          accounts.ownerId,
          accounts.currency,
        ],
      })
      .returning();

    if (!result) {
      throw new AccountConcurrentInsertError(row.tenantId, row.ownerType, row.ownerId, row.currency);
    }
    return result;
  }

  async insertEntry(row: NewEntryInput): Promise<AccountEntry> {
    const [result] = await this.db
      .insert(accountEntries)
      .values({
        tenantId: row.tenantId,
        accountId: row.accountId,
        entryNo: row.entryNo,
        entryDate: row.entryDate,
        amountSigned: row.amountSigned,
        currency: row.currency,
        entryType: row.entryType as AccountEntry["entryType"],
        sourceDocumentType: row.sourceDocumentType,
        sourceDocumentId: row.sourceDocumentId,
        createdBy: row.createdBy,
      })
      .returning();
    return result!;
  }

  async findEntryByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<AccountEntry | null> {
    // account_entries has no idempotency_key column — this method is not
    // used in production (the service uses the idempotency record's
    // responseBody.entryId instead). Kept for interface compatibility.
    return null;
  }

  async findEntryBySource(tenantId: string, sourceDocumentType: string, sourceDocumentId: string): Promise<AccountEntry | null> {
    const [result] = await this.db
      .select()
      .from(accountEntries)
      .where(and(
        eq(accountEntries.tenantId, tenantId),
        eq(accountEntries.sourceDocumentType, sourceDocumentType),
        eq(accountEntries.sourceDocumentId, sourceDocumentId),
      ))
      .limit(1);
    return result ?? null;
  }

  async findEntryById(tenantId: string, id: string): Promise<AccountEntry | null> {
    const [result] = await this.db
      .select()
      .from(accountEntries)
      .where(and(eq(accountEntries.tenantId, tenantId), eq(accountEntries.id, id)))
      .limit(1);
    return result ?? null;
  }

  async listEntriesForAccount(tenantId: string, accountId: string): Promise<AccountEntry[]> {
    return this.db
      .select()
      .from(accountEntries)
      .where(and(eq(accountEntries.tenantId, tenantId), eq(accountEntries.accountId, accountId)));
  }

  /**
   * Acquire a transaction-scoped advisory lock on a source document.
   *
   * Uses pg_advisory_xact_lock(hash), which is automatically released when
   * the transaction commits or rolls back. The hash is derived from the
   * deterministic sourceLockKey string.
   *
   * This prevents two concurrent transactions from both passing the
   * findEntryBySource check and inserting duplicate entries for the same
   * source document.
   *
   * The caller MUST be inside a db.transaction() for the lock to be
   * transaction-scoped.
   */
  async lockSourceEntry(tenantId: string, sourceDocumentType: string, sourceDocumentId: string): Promise<void> {
    const key = sourceLockKey(tenantId, sourceDocumentType, sourceDocumentId);
    // Hash the string key into a bigint for pg_advisory_xact_lock.
    // Use PostgreSQL's hashtext function for a stable hash.
    await this.db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
  }
}

/**
 * Thrown when insertAccount detects a concurrent insert race.
 * The caller retries findAccount to pick up the existing row.
 */
export class AccountConcurrentInsertError extends Error {
  readonly code = "ACCOUNT_CONCURRENT_INSERT";
  constructor(
    readonly tenantId: string,
    readonly ownerType: string,
    readonly ownerId: string,
    readonly currency: string,
  ) {
    super(`Concurrent insert for account (${tenantId}, ${ownerType}, ${ownerId}, ${currency}). Retry findAccount.`);
    this.name = "AccountConcurrentInsertError";
  }
}

export function createSubledgerDbRepository(db: Db): SubledgerDbRepository {
  return new SubledgerDbRepository(db);
}
