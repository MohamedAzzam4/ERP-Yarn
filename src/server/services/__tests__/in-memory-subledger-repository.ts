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

  async findAccount(tenantId: string, ownerType: string, ownerId: string, currency: string): Promise<Account | null> {
    const key = `${tenantId}:${ownerType}:${ownerId}:${currency}`;
    return this.accounts.get(key) ?? null;
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

  /** No-op in single-threaded in-memory store. Tracks calls for tests. */
  async lockSourceEntry(_tenantId: string, _sourceDocumentType: string, _sourceDocumentId: string): Promise<void> {
    this.lockCalls.push(`${_tenantId}|${_sourceDocumentType}|${_sourceDocumentId}`);
  }

  /** Test helper: list of lockSourceEntry call keys (in order). */
  lockCalls: string[] = [];

  // Side map for idempotency key → entry ID (test-only)
  private idempotencyKeyMap = new Map<string, string>();

  /** Test helper: associate an idempotency key with an entry ID. */
  recordIdempotencyKey(tenantId: string, idempotencyKey: string, entryId: string): void {
    this.idempotencyKeyMap.set(`${tenantId}:${idempotencyKey}`, entryId);
  }
}
