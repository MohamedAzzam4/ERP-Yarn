/**
 * In-memory SubledgerTransactionHandle for unit tests.
 * TEST-ONLY helper. NOT for production use.
 */
import type { Account, AccountEntry } from "@/server/db/schema/subledger";
import type {
  SubledgerTransactionHandle,
  NewAccountInput,
  NewEntryInput,
} from "../subledger-service";

const NOW = () => new Date("2026-07-01T00:00:00Z");
const nid = (p: string, n: number) => `${p}-${n.toString().padStart(6, "0")}`;

export class InMemorySubledgerRepository implements SubledgerTransactionHandle {
  private accounts = new Map<string, Account>();
  private entries = new Map<string, AccountEntry>();
  private accountCounter = 0;
  private entryCounter = 0;

  // -------------------------------------------------------------------------
  // Snapshot/restore for transactional test rollback.
  // -------------------------------------------------------------------------

  snapshot(): {
    accounts: Map<string, Account>;
    entries: Map<string, AccountEntry>;
    accountCounter: number;
    entryCounter: number;
  } {
    return {
      accounts: new Map([...this.accounts].map(([k, v]) => [k, { ...v }])),
      entries: new Map([...this.entries].map(([k, v]) => [k, { ...v }])),
      accountCounter: this.accountCounter,
      entryCounter: this.entryCounter,
    };
  }

  restore(snap: {
    accounts: Map<string, Account>;
    entries: Map<string, AccountEntry>;
    accountCounter: number;
    entryCounter: number;
  }): void {
    this.accounts = new Map([...snap.accounts].map(([k, v]) => [k, { ...v }]));
    this.entries = new Map([...snap.entries].map(([k, v]) => [k, { ...v }]));
    this.accountCounter = snap.accountCounter;
    this.entryCounter = snap.entryCounter;
  }

  async findAccount(tenantId: string, ownerType: string, ownerId: string, currency: string): Promise<Account | null> {
    const key = `${tenantId}:${ownerType}:${ownerId}:${currency}`;
    return this.accounts.get(key) ?? null;
  }

  async findAccountById(tenantId: string, accountId: string): Promise<Account | null> {
    for (const a of this.accounts.values()) {
      if (a.tenantId === tenantId && a.id === accountId) return a;
    }
    return null;
  }

  async insertAccount(row: NewAccountInput): Promise<Account> {
    this.accountCounter++;
    const id = nid("acc", this.accountCounter);
    const account: Account = {
      id,
      tenantId: row.tenantId,
      ownerType: row.ownerType as Account["ownerType"],
      ownerId: row.ownerId,
      currency: row.currency,
      status: "active",
      createdAt: NOW(),
      createdBy: row.createdBy,
      updatedAt: null,
      updatedBy: null,
    };
    this.accounts.set(`${row.tenantId}:${row.ownerType}:${row.ownerId}:${row.currency}`, account);
    return account;
  }

  async insertEntry(row: NewEntryInput): Promise<AccountEntry> {
    this.entryCounter++;
    const id = nid("ent", this.entryCounter);
    const entry: AccountEntry = {
      id,
      tenantId: row.tenantId,
      accountId: row.accountId,
      entryNo: row.entryNo,
      entryDate: row.entryDate,
      amountSigned: row.amountSigned,
      currency: row.currency,
      entryType: row.entryType as AccountEntry["entryType"],
      sourceDocumentType: row.sourceDocumentType,
      sourceDocumentId: row.sourceDocumentId,
      settlementStatus: "unsettled",
      reversalOfEntryId: null,
      notes: null,
      recordOrigin: "manual_live",
      recordPeriod: "live",
      importBatchId: null,
      createdAt: NOW(),
      createdBy: row.createdBy,
    };
    this.entries.set(`${row.tenantId}:${id}`, entry);
    return entry;
  }

  async findEntryByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<AccountEntry | null> {
    for (const e of this.entries.values()) {
      if (e.tenantId === tenantId) {
        // Check if this entry was created with this idempotency key
        // (stored in audit or derivable from source — for test simplicity,
        // we store it in a side map)
        const key = `${tenantId}:${idempotencyKey}`;
        if (this.idempotencyKeyMap.get(key) === e.id) return e;
      }
    }
    return null;
  }

  async findEntryBySource(tenantId: string, sourceDocumentType: string, sourceDocumentId: string): Promise<AccountEntry | null> {
    for (const e of this.entries.values()) {
      if (e.tenantId === tenantId && e.sourceDocumentType === sourceDocumentType && e.sourceDocumentId === sourceDocumentId) {
        return e;
      }
    }
    return null;
  }

  async findEntryById(tenantId: string, id: string): Promise<AccountEntry | null> {
    return this.entries.get(`${tenantId}:${id}`) ?? null;
  }

  async listEntriesForAccount(tenantId: string, accountId: string): Promise<AccountEntry[]> {
    return [...this.entries.values()].filter(
      (e) => e.tenantId === tenantId && e.accountId === accountId,
    );
  }

  async updateEntrySettlementStatus(
    tenantId: string,
    entryId: string,
    settlementStatus: "unsettled" | "partially_settled" | "settled" | "reversed",
  ): Promise<AccountEntry | null> {
    const key = `${tenantId}:${entryId}`;
    const entry = this.entries.get(key);
    if (!entry) return null;
    // Only settlement_status is mutable; amount_signed and all other fields immutable.
    const updated: AccountEntry = { ...entry, settlementStatus };
    this.entries.set(key, updated);
    return updated;
  }

  /** No-op in single-threaded in-memory store. Tracks calls for tests. */
  async lockSourceEntry(_tenantId: string, _sourceDocumentType: string, _sourceDocumentId: string): Promise<void> {
    this.lockCalls.push(`${_tenantId}|${_sourceDocumentType}|${_sourceDocumentId}`);
  }

  /** Test helper: list of lockSourceEntry call keys (in order). */
  lockCalls: string[] = [];

  /**
   * No-op in-memory implementation of cutover coordination lock.
   *
   * In production this acquires pg_advisory_xact_lock(namespace, hash(tenant, domain))
   * for real DB-level mutual exclusion between historical migration cutover
   * and live operational posting (Contract 08 §8.1.1/§8.10/§12.4).
   * In-memory tests are single-threaded, so no real lock is needed.
   */
  async lockCutoverScope(_tenantId: string, _domain: "inventory" | "subledger"): Promise<void> {
    // no-op
  }

  // Side map for idempotency key → entry ID (test-only)
  private idempotencyKeyMap = new Map<string, string>();

  /** Test helper: associate an idempotency key with an entry ID. */
  recordIdempotencyKey(tenantId: string, idempotencyKey: string, entryId: string): void {
    this.idempotencyKeyMap.set(`${tenantId}:${idempotencyKey}`, entryId);
  }

  /**
   * WP-06-04 test helper: find all entries for a tenant matching a source document type.
   * Used by replacement workflow tests to verify return credit + replacement receivable.
   */
  async findEntriesBySourceDocType(tenantId: string, sourceDocumentType: string): Promise<AccountEntry[]> {
    return [...this.entries.values()].filter(
      (e) => e.tenantId === tenantId && e.sourceDocumentType === sourceDocumentType,
    );
  }

  /**
   * WP-06-04 test helper: find all entries for a tenant matching an entry type.
   * Used by replacement workflow tests to verify no payment/refund entries exist.
   */
  async findEntriesByEntryType(tenantId: string, entryType: string): Promise<AccountEntry[]> {
    return [...this.entries.values()].filter(
      (e) => e.tenantId === tenantId && e.entryType === entryType,
    );
  }
}
