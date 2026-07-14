/**
 * Transactional test store for SubledgerService tests.
 * Wraps all 4 handles (subledger, audit, idempotency, docSeq) in a
 * snapshot/rollback boundary — mirrors TransactionalTestStore from WP-02-02.
 * TEST-ONLY helper. NOT for production use.
 */
import type {
  SubledgerTransactionHandle,
  NewAccountInput,
  NewEntryInput,
} from "../subledger-service";
import type { Account, AccountEntry } from "@/server/db/schema/subledger";
import type { AuditTransactionHandle, AuditLogRowInsert } from "../audit-service";
import type { IdempotencyTransactionHandle, IdempotencyRecordShape } from "../idempotency-service";
import type { DocumentSequenceTransactionHandle } from "../document-sequence-service";

const NOW = () => new Date("2026-07-01T00:00:00Z");
const nid = (p: string, n: number) => `${p}-${n.toString().padStart(6, "0")}`;

function deepClone<T>(v: T): T {
  if (v instanceof Map) { const m = new Map(); for (const [k, val] of v) m.set(k, deepClone(val)); return m as T; }
  if (v instanceof Array) return v.map(deepClone) as T;
  if (v instanceof Object) { const o: Record<string, unknown> = {}; for (const k of Object.keys(v as Record<string, unknown>)) o[k] = deepClone((v as Record<string, unknown>)[k]); return o as T; }
  return v;
}

export class TransactionalSubledgerTestStore {
  private committedAccounts = new Map<string, Account>();
  private committedEntries = new Map<string, AccountEntry>();
  private committedAuditRows: AuditLogRowInsert[] = [];
  private committedIdemRecords = new Map<string, IdempotencyRecordShape>();
  private committedDocSeq = new Map<string, { id: string; tenantId: string; documentType: string; year: number; prefix: string; lastNumber: number }>();

  private stagingAccounts = new Map<string, Account>();
  private stagingEntries = new Map<string, AccountEntry>();
  private stagingAuditRows: AuditLogRowInsert[] = [];
  private stagingIdemRecords = new Map<string, IdempotencyRecordShape>();
  private stagingDocSeq = new Map<string, { id: string; tenantId: string; documentType: string; year: number; prefix: string; lastNumber: number }>();

  private idemKeyMap = new Map<string, string>(); // (tenant:key) → entryId
  private accountCounter = 0;
  private entryCounter = 0;
  private inTx = false;
  private auditFail = false;
  private snapshot: Record<string, unknown> | null = null;

  begin(): void {
    this.inTx = true;
    this.snapshot = {
      accounts: deepClone(this.committedAccounts),
      entries: deepClone(this.committedEntries),
      auditRows: [...this.committedAuditRows],
      idemRecords: deepClone(this.committedIdemRecords),
      docSeq: deepClone(this.committedDocSeq),
      accountCounter: this.accountCounter,
      entryCounter: this.entryCounter,
    } as never;
    this.stagingAccounts = deepClone(this.committedAccounts);
    this.stagingEntries = deepClone(this.committedEntries);
    this.stagingAuditRows = [...this.committedAuditRows];
    this.stagingIdemRecords = deepClone(this.committedIdemRecords);
    this.stagingDocSeq = deepClone(this.committedDocSeq);
  }

  commit(): void {
    if (!this.inTx) return;
    this.committedAccounts = deepClone(this.stagingAccounts);
    this.committedEntries = deepClone(this.stagingEntries);
    this.committedAuditRows = [...this.stagingAuditRows];
    this.committedIdemRecords = deepClone(this.stagingIdemRecords);
    this.committedDocSeq = deepClone(this.stagingDocSeq);
    this.inTx = false;
    this.snapshot = null;
  }

  rollback(): void {
    if (!this.snapshot) return;
    const s = this.snapshot as Record<string, unknown>;
    this.committedAccounts = s.accounts as typeof this.committedAccounts;
    this.committedEntries = s.entries as typeof this.committedEntries;
    this.committedAuditRows = s.auditRows as typeof this.committedAuditRows;
    this.committedIdemRecords = s.idemRecords as typeof this.committedIdemRecords;
    this.committedDocSeq = s.docSeq as typeof this.committedDocSeq;
    this.accountCounter = s.accountCounter as number;
    this.entryCounter = s.entryCounter as number;
    this.stagingAccounts = new Map();
    this.stagingEntries = new Map();
    this.stagingAuditRows = [];
    this.stagingIdemRecords = new Map();
    this.stagingDocSeq = new Map();
    this.inTx = false;
    this.snapshot = null;
  }

  setAuditShouldFail(v: boolean): void { this.auditFail = v; }
  getCommittedEntryCount(): number { return this.committedEntries.size; }
  getCommittedAuditCount(): number { return this.committedAuditRows.length; }
  getCommittedEntriesForAccount(tenantId: string, accountId: string): AccountEntry[] {
    return [...this.committedEntries.values()].filter(e => e.tenantId === tenantId && e.accountId === accountId);
  }

  private get activeAccounts() { return this.inTx ? this.stagingAccounts : this.committedAccounts; }
  private get activeEntries() { return this.inTx ? this.stagingEntries : this.committedEntries; }
  private get activeDocSeq() { return this.inTx ? this.stagingDocSeq : this.committedDocSeq; }

  subledger: SubledgerTransactionHandle = {
    findAccount: async (tenantId, ownerType, ownerId, currency) => {
      return this.activeAccounts.get(`${tenantId}:${ownerType}:${ownerId}:${currency}`) ?? null;
    },
    findAccountById: async (tenantId, accountId) => {
      for (const a of this.activeAccounts.values()) {
        if (a.tenantId === tenantId && a.id === accountId) return a;
      }
      return null;
    },
    insertAccount: async (row) => {
      this.accountCounter++;
      const id = nid("acc", this.accountCounter);
      const acc: Account = { id, tenantId: row.tenantId, ownerType: row.ownerType as Account["ownerType"], ownerId: row.ownerId, currency: row.currency, status: "active", createdAt: NOW(), createdBy: row.createdBy, updatedAt: null, updatedBy: null };
      this.activeAccounts.set(`${row.tenantId}:${row.ownerType}:${row.ownerId}:${row.currency}`, acc);
      return acc;
    },
    insertEntry: async (row) => {
      this.entryCounter++;
      const id = nid("ent", this.entryCounter);
      const entry: AccountEntry = { id, tenantId: row.tenantId, accountId: row.accountId, entryNo: row.entryNo, entryDate: row.entryDate, amountSigned: row.amountSigned, currency: row.currency, entryType: row.entryType as AccountEntry["entryType"], sourceDocumentType: row.sourceDocumentType, sourceDocumentId: row.sourceDocumentId, settlementStatus: "unsettled", reversalOfEntryId: null, notes: null, recordOrigin: "manual_live", recordPeriod: "live", importBatchId: null, createdAt: NOW(), createdBy: row.createdBy };
      this.activeEntries.set(`${row.tenantId}:${id}`, entry);
      this.idemKeyMap.set(`${row.tenantId}:${row.entryNo}`, id); // side map for idempotency lookup
      return entry;
    },
    findEntryByIdempotencyKey: async (tenantId, idempotencyKey) => {
      // Look up entry by idempotency key via the idem records
      for (const [, rec] of (this.inTx ? this.stagingIdemRecords : this.committedIdemRecords)) {
        if (rec.tenantId === tenantId && rec.idempotencyKey === idempotencyKey && rec.state === "succeeded") {
          const responseBody = rec.responseBody as { entryId?: string };
          if (responseBody?.entryId) {
            return this.activeEntries.get(`${tenantId}:${responseBody.entryId}`) ?? null;
          }
        }
      }
      return null;
    },
    findEntryBySource: async (tenantId, sourceDocumentType, sourceDocumentId) => {
      for (const e of this.activeEntries.values()) {
        if (e.tenantId === tenantId && e.sourceDocumentType === sourceDocumentType && e.sourceDocumentId === sourceDocumentId) return e;
      }
      return null;
    },
    findEntryById: async (tenantId, id) => {
      return this.activeEntries.get(`${tenantId}:${id}`) ?? null;
    },
    listEntriesForAccount: async (tenantId, accountId) => {
      return [...this.activeEntries.values()].filter(e => e.tenantId === tenantId && e.accountId === accountId);
    },
    updateEntrySettlementStatus: async (tenantId, entryId, settlementStatus) => {
      const key = `${tenantId}:${entryId}`;
      const entry = this.activeEntries.get(key);
      if (!entry) return null;
      const updated: AccountEntry = { ...entry, settlementStatus };
      this.activeEntries.set(key, updated);
      return updated;
    },
    lockSourceEntry: async (_tenantId, _sourceDocumentType, _sourceDocumentId) => {
      // No-op in single-threaded test store
    },
  };

  audit: AuditTransactionHandle = {
    insertAuditLog: async (row) => {
      if (this.auditFail) throw new Error("AuditWriteFailedError (simulated)");
      this.stagingAuditRows.push(row);
      if (!this.inTx) this.committedAuditRows.push(row);
    },
  };

  idempotency: IdempotencyTransactionHandle = {
    findByTenantScopeKey: async (tenantId, operationScope, idempotencyKey) => {
      const key = `${tenantId}:${operationScope}:${idempotencyKey}`;
      const map = this.inTx ? this.stagingIdemRecords : this.committedIdemRecords;
      return (map.get(key) as IdempotencyRecordShape | undefined) ?? null;
    },
    insert: async (record) => {
      const key = `${record.tenantId}:${record.operationScope}:${record.idempotencyKey}`;
      const full: IdempotencyRecordShape = { ...record, id: record.id ?? nid("idem", Date.now()), createdAt: new Date() };
      this.stagingIdemRecords.set(key, full);
      if (!this.inTx) this.committedIdemRecords.set(key, full);
      return full;
    },
    claimExpiredLease: async (id, newLeaseExpiresAt, newHeartbeatAt, now) => {
      for (const [, rec] of this.stagingIdemRecords) { if (rec.id === id) { rec.leaseExpiresAt = newLeaseExpiresAt; rec.leaseHeartbeatAt = newHeartbeatAt; return true; } }
      return false;
    },
    updateState: async (id, update) => {
      for (const [key, rec] of this.stagingIdemRecords) {
        if (rec.id === id) {
          const updated = { ...rec, ...update };
          this.stagingIdemRecords.set(key, updated);
          if (!this.inTx) this.committedIdemRecords.set(key, updated);
          return;
        }
      }
    },
    heartbeat: async () => {},
  };

  docSeq: DocumentSequenceTransactionHandle = {
    findForUpdate: async (tenantId, documentType, year) => {
      return this.activeDocSeq.get(`${tenantId}:${documentType}:${year}`) ?? null;
    },
    insert: async (tenantId, documentType, year, prefix) => {
      const key = `${tenantId}:${documentType}:${year}`;
      const row = { id: nid("seq", this.activeDocSeq.size + 1), tenantId, documentType, year, prefix, lastNumber: 0 };
      this.activeDocSeq.set(key, row);
      return row;
    },
    updateLastNumber: async (id, newValue) => {
      for (const [, row] of this.activeDocSeq) { if (row.id === id) { row.lastNumber = newValue; return; } }
    },
  };
}

export async function withSubledgerTransaction<T>(
  store: TransactionalSubledgerTestStore,
  fn: () => Promise<T>,
): Promise<T> {
  store.begin();
  try { const r = await fn(); store.commit(); return r; }
  catch (e) { store.rollback(); throw e; }
}
