/**
 * Transactional in-memory store for InventoryLedgerService tests.
 *
 * Wraps all 4 service deps (ledger, audit, idempotency, documentSequence)
 * in a single snapshot/rollback boundary so tests can prove that a failure
 * at any point in the 10-step protocol rolls back ALL prior writes in the
 * same transaction.
 *
 * Usage:
 *   const txStore = new TransactionalTestStore();
 *   const service = new InventoryLedgerService({
 *     ledger: txStore.ledger,
 *     audit: txStore.audit,
 *     idempotency: txStore.idempotency,
 *     documentSequence: txStore.docSeq,
 *   });
 *   // ... call service.postRawReceipt(...)
 *   // If it throws, txStore has NOT committed any writes from that call.
 *   // If it succeeds, txStore has committed all writes.
 *
 * The store supports `beginSnapshot()` / `commitSnapshot()` / `rollbackSnapshot()`
 * which the service can call (or tests can drive manually) to enforce the
 * all-or-nothing boundary.
 *
 * TEST-ONLY helper. NOT for production use.
 */
import type {
  InventoryLedgerTransactionHandle,
  NewMovementInput,
  NewBalanceInput,
} from "../inventory-ledger-service";
import type { StockMovement, InventoryBalance } from "@/server/db/schema/inventory-ledger";
import type { AuditTransactionHandle, AuditLogRowInsert } from "../audit-service";
import type { IdempotencyTransactionHandle, IdempotencyRecordShape } from "../idempotency-service";
import type { DocumentSequenceTransactionHandle } from "../document-sequence-service";

const NOW = () => new Date("2026-07-01T00:00:00Z");
const nid = (p: string, n: number) => `${p}-${n.toString().padStart(6, "0")}`;

/**
 * Deep-clone a value for snapshotting. Handles Maps and plain objects.
 */
function deepClone<T>(value: T): T {
  if (value instanceof Map) {
    const m = new Map();
    for (const [k, v] of value) m.set(k, deepClone(v));
    return m as T;
  }
  if (value instanceof Array) {
    return value.map(deepClone) as T;
  }
  if (value instanceof Object) {
    const obj: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>)) {
      obj[k] = deepClone((value as Record<string, unknown>)[k]);
    }
    return obj as T;
  }
  return value;
}

/**
 * Transactional test store that coordinates all 4 service deps within a
 * single snapshot/rollback boundary.
 *
 * The store maintains a "staging area" for writes during a transaction.
 * If `rollback()` is called, staging is discarded. If `commit()` is called,
 * staging is merged into the committed state.
 *
 * For the service to use this correctly, it must call `begin()` before
 * the transaction body, `commit()` on success, or `rollback()` on failure.
 * However, the current service architecture doesn't explicitly call
 * begin/commit/rollback — it just calls individual handle methods.
 *
 * To bridge this gap WITHOUT changing the service's public API, this store
 * uses an "auto-snapshot" pattern: the test wraps the service call in a
 * `withTransaction()` helper that snapshots before, commits on success,
 * and rolls back on throw.
 */
export class TransactionalTestStore {
  // Committed state (visible after success)
  private committedMovements = new Map<string, StockMovement>();
  private committedBalances = new Map<string, InventoryBalance>();
  private committedAuditRows: AuditLogRowInsert[] = [];
  private committedIdempotencyRecords = new Map<string, unknown>();
  private committedDocSeqRows = new Map<string, { id: string; tenantId: string; documentType: string; year: number; prefix: string; lastNumber: number }>();

  // Staging state (visible during transaction, discarded on rollback)
  private stagingMovements = new Map<string, StockMovement>();
  private stagingBalances = new Map<string, InventoryBalance>();
  private stagingAuditRows: AuditLogRowInsert[] = [];
  private stagingIdempotencyRecords = new Map<string, unknown>();
  private stagingDocSeqRows = new Map<string, { id: string; tenantId: string; documentType: string; year: number; prefix: string; lastNumber: number }>();

  private movementCounter = 0;
  private balanceCounter = 0;
  private inTransaction = false;
  private auditShouldFail = false;

  // Snapshot of committed state at begin() time
  private snapshot: {
    movements: Map<string, StockMovement>;
    balances: Map<string, InventoryBalance>;
    auditRows: AuditLogRowInsert[];
    idempotencyRecords: Map<string, unknown>;
    docSeqRows: Map<string, { id: string; tenantId: string; documentType: string; year: number; prefix: string; lastNumber: number }>;
    movementCounter: number;
    balanceCounter: number;
  } | null = null;

  /**
   * Begin a transaction: snapshot the committed state.
   * All subsequent writes go to staging.
   */
  begin(): void {
    this.inTransaction = true;
    this.snapshot = {
      movements: deepClone(this.committedMovements),
      balances: deepClone(this.committedBalances),
      auditRows: deepClone(this.committedAuditRows),
      idempotencyRecords: deepClone(this.committedIdempotencyRecords),
      docSeqRows: deepClone(this.committedDocSeqRows),
      movementCounter: this.movementCounter,
      balanceCounter: this.balanceCounter,
    };
    // Copy committed → staging (so reads see committed + new writes)
    this.stagingMovements = deepClone(this.committedMovements);
    this.stagingBalances = deepClone(this.committedBalances);
    this.stagingAuditRows = [...this.committedAuditRows];
    this.stagingIdempotencyRecords = deepClone(this.committedIdempotencyRecords);
    this.stagingDocSeqRows = deepClone(this.committedDocSeqRows);
  }

  /**
   * Commit: merge staging into committed.
   */
  commit(): void {
    if (!this.inTransaction) return;
    this.committedMovements = deepClone(this.stagingMovements);
    this.committedBalances = deepClone(this.stagingBalances);
    this.committedAuditRows = [...this.stagingAuditRows];
    this.committedIdempotencyRecords = deepClone(this.stagingIdempotencyRecords);
    this.committedDocSeqRows = deepClone(this.stagingDocSeqRows);
    this.inTransaction = false;
    this.snapshot = null;
  }

  /**
   * Rollback: restore committed state from snapshot, discard staging.
   */
  rollback(): void {
    if (!this.snapshot) return;
    this.committedMovements = this.snapshot.movements;
    this.committedBalances = this.snapshot.balances;
    this.committedAuditRows = this.snapshot.auditRows;
    this.committedIdempotencyRecords = this.snapshot.idempotencyRecords;
    this.committedDocSeqRows = this.snapshot.docSeqRows;
    this.movementCounter = this.snapshot.movementCounter;
    this.balanceCounter = this.snapshot.balanceCounter;
    this.stagingMovements = new Map();
    this.stagingBalances = new Map();
    this.stagingAuditRows = [];
    this.stagingIdempotencyRecords = new Map();
    this.stagingDocSeqRows = new Map();
    this.inTransaction = false;
    this.snapshot = null;
  }

  /**
   * Set whether the next audit insert should fail (simulates audit failure).
   */
  setAuditShouldFail(should: boolean): void {
    this.auditShouldFail = should;
  }

  /**
   * Get the number of committed movements (for test assertions).
   */
  getCommittedMovementCount(): number {
    return this.committedMovements.size;
  }

  /**
   * Get a committed balance by key (for test assertions).
   */
  getCommittedBalance(tenantId: string, itemId: string, locationId: string): InventoryBalance | null {
    return this.committedBalances.get(`${tenantId}:${itemId}:${locationId}`) ?? null;
  }

  /**
   * Get committed audit row count.
   */
  getCommittedAuditCount(): number {
    return this.committedAuditRows.length;
  }

  // --- Read methods: read from staging (if in transaction) or committed ---

  private get activeMovements(): Map<string, StockMovement> {
    return this.inTransaction ? this.stagingMovements : this.committedMovements;
  }
  private get activeBalances(): Map<string, InventoryBalance> {
    return this.inTransaction ? this.stagingBalances : this.committedBalances;
  }
  private get activeDocSeqRows(): Map<string, { id: string; tenantId: string; documentType: string; year: number; prefix: string; lastNumber: number }> {
    return this.inTransaction ? this.stagingDocSeqRows : this.committedDocSeqRows;
  }

  // --- Ledger handle (InventoryLedgerTransactionHandle) ---

  ledger: InventoryLedgerTransactionHandle = {
    insertMovement: async (row: NewMovementInput): Promise<StockMovement> => {
      this.movementCounter++;
      const id = nid("mv", this.movementCounter);
      const movement: StockMovement = {
        id, tenantId: row.tenantId, docNo: row.docNo,
        movementType: row.movementType as StockMovement["movementType"],
        movementStatus: row.movementStatus as StockMovement["movementStatus"],
        itemId: row.itemId, fromLocationId: row.fromLocationId, toLocationId: row.toLocationId,
        quantityKg: row.quantityKg, movementDate: row.movementDate,
        sourceDocumentType: row.sourceDocumentType, sourceDocumentId: row.sourceDocumentId,
        approvalRequestId: null, reversalOfMovementId: null, idempotencyKey: row.idempotencyKey,
        recordOrigin: "manual_live", recordPeriod: "live", importBatchId: null, notes: null,
        createdBy: null, postedBy: row.postedBy, postedAt: row.postedAt,
        createdAt: NOW(), updatedAt: null, updatedBy: null,
      };
      this.activeMovements.set(`${row.tenantId}:${id}`, movement);
      return movement;
    },
    findMovementByIdempotencyKey: async (tenantId: string, idempotencyKey: string): Promise<StockMovement | null> => {
      for (const m of this.activeMovements.values()) {
        if (m.tenantId === tenantId && m.idempotencyKey === idempotencyKey) return m;
      }
      return null;
    },
    findMovementBySource: async (tenantId: string, sourceDocumentType: string, sourceDocumentId: string): Promise<StockMovement | null> => {
      for (const m of this.activeMovements.values()) {
        if (m.tenantId === tenantId && m.sourceDocumentType === sourceDocumentType && m.sourceDocumentId === sourceDocumentId) return m;
      }
      return null;
    },
    findMovementById: async (tenantId: string, id: string): Promise<StockMovement | null> => {
      return this.activeMovements.get(`${tenantId}:${id}`) ?? null;
    },
    findBalanceForUpdate: async (tenantId: string, itemId: string, locationId: string): Promise<InventoryBalance | null> => {
      return this.activeBalances.get(`${tenantId}:${itemId}:${locationId}`) ?? null;
    },
    insertBalance: async (row: NewBalanceInput): Promise<InventoryBalance> => {
      this.balanceCounter++;
      const id = nid("bal", this.balanceCounter);
      const balance: InventoryBalance = {
        id, tenantId: row.tenantId, itemId: row.itemId, locationId: row.locationId,
        onHandQtyKg: row.onHandQtyKg, reservedQtyKg: "0", blockedQtyKg: "0", returnedQtyKg: "0",
        lastMovementId: row.lastMovementId, version: 1, updatedAt: null, updatedBy: null, createdAt: NOW(),
      };
      this.activeBalances.set(`${row.tenantId}:${row.itemId}:${row.locationId}`, balance);
      return balance;
    },
    updateBalance: async (tenantId: string, itemId: string, locationId: string, patch: { onHandQtyKg: string; lastMovementId: string; version: number }): Promise<InventoryBalance | null> => {
      const key = `${tenantId}:${itemId}:${locationId}`;
      const balance = this.activeBalances.get(key);
      if (!balance) return null;
      const updated: InventoryBalance = { ...balance, onHandQtyKg: patch.onHandQtyKg, lastMovementId: patch.lastMovementId, version: patch.version, updatedAt: NOW() };
      this.activeBalances.set(key, updated);
      return updated;
    },
    updateReservedQty: async (tenantId: string, itemId: string, locationId: string, patch: { reservedQtyKg: string; version: number }): Promise<InventoryBalance | null> => {
      const key = `${tenantId}:${itemId}:${locationId}`;
      const balance = this.activeBalances.get(key);
      if (!balance) return null;
      const updated: InventoryBalance = { ...balance, reservedQtyKg: patch.reservedQtyKg, version: patch.version, updatedAt: NOW() };
      this.activeBalances.set(key, updated);
      return updated;
    },
    listMovementsForBalance: async (tenantId: string, itemId: string, locationId: string): Promise<StockMovement[]> => {
      return [...this.activeMovements.values()].filter(
        (m) => m.tenantId === tenantId && m.itemId === itemId && (m.toLocationId === locationId || m.fromLocationId === locationId),
      );
    },
    listAllBalances: async (tenantId: string): Promise<InventoryBalance[]> => {
      return [...this.activeBalances.values()].filter((b) => b.tenantId === tenantId);
    },
    lockCutoverScope: async (_tenantId: string, _domain: "inventory" | "subledger"): Promise<void> => {
      // No-op in-memory — single-threaded, no real DB advisory lock.
    },
  };

  // --- Audit handle (AuditTransactionHandle) ---

  audit: AuditTransactionHandle = {
    insertAuditLog: async (row: AuditLogRowInsert): Promise<void> => {
      if (this.auditShouldFail) {
        throw new Error("AuditWriteFailedError (simulated)");
      }
      this.stagingAuditRows.push(row);
      if (!this.inTransaction) {
        this.committedAuditRows.push(row);
      }
    },
  };

  // --- Idempotency handle (simplified — delegates to staging/committed maps) ---

  idempotency: IdempotencyTransactionHandle = {
    findByTenantScopeKey: async (tenantId: string, operationScope: string, idempotencyKey: string) => {
      const key = `${tenantId}:${operationScope}:${idempotencyKey}`;
      const map = this.inTransaction ? this.stagingIdempotencyRecords : this.committedIdempotencyRecords;
      return (map.get(key) as IdempotencyRecordShape | undefined) ?? null;
    },
    insert: async (record: any): Promise<IdempotencyRecordShape> => {
      const key = `${record.tenantId}:${record.operationScope}:${record.idempotencyKey}`;
      const ownerToken = record.ownerToken ?? `test-owner-${Date.now()}-${Math.random()}`;
      const fullRecord: IdempotencyRecordShape = {
        ...record,
        ownerToken,
        id: record.id ?? nid("idem", Date.now()),
        createdAt: new Date(),
      };
      this.stagingIdempotencyRecords.set(key, fullRecord);
      if (!this.inTransaction) {
        this.committedIdempotencyRecords.set(key, fullRecord);
      }
      return fullRecord;
    },
    claimExpiredLease: async (id: string, newLeaseExpiresAt: Date, newHeartbeatAt: Date, now: Date): Promise<boolean> => {
      for (const [, rec] of this.stagingIdempotencyRecords) {
        if ((rec as IdempotencyRecordShape).id === id) {
          (rec as IdempotencyRecordShape).leaseExpiresAt = newLeaseExpiresAt;
          (rec as IdempotencyRecordShape).leaseHeartbeatAt = newHeartbeatAt;
          (rec as IdempotencyRecordShape).ownerToken = `test-owner-${Date.now()}-${Math.random()}`;
          return true;
        }
      }
      return false;
    },
    updateState: async (id: string, update: any) => {
      for (const [key, rec] of this.stagingIdempotencyRecords) {
        if ((rec as IdempotencyRecordShape).id === id) {
          if ((rec as IdempotencyRecordShape).ownerToken !== update.expectedOwnerToken) {
            return 0;
          }
          const updated = { ...(rec as IdempotencyRecordShape), ...update };
          this.stagingIdempotencyRecords.set(key, updated);
          if (!this.inTransaction) {
            this.committedIdempotencyRecords.set(key, updated);
          }
          return 1;
        }
      }
      return 0;
    },
    heartbeat: async (id: string, now: Date): Promise<void> => {
      // No-op for tests
    },
  };

  // --- Document sequence handle (DocumentSequenceTransactionHandle) ---

  docSeq: DocumentSequenceTransactionHandle = {
    findForUpdate: async (tenantId: string, documentType: string, year: number) => {
      const key = `${tenantId}:${documentType}:${year}`;
      return this.activeDocSeqRows.get(key) ?? null;
    },
    insert: async (tenantId: string, documentType: string, year: number, prefix: string) => {
      const key = `${tenantId}:${documentType}:${year}`;
      const row = { id: nid("seq", this.activeDocSeqRows.size + 1), tenantId, documentType, year, prefix, lastNumber: 0 };
      this.activeDocSeqRows.set(key, row);
      return row;
    },
    updateLastNumber: async (id: string, newValue: number) => {
      for (const [key, row] of this.activeDocSeqRows) {
        if (row.id === id) {
          row.lastNumber = newValue;
          return;
        }
      }
    },
  };
}

/**
 * Execute a function within a transaction boundary.
 * Snapshots before, commits on success, rolls back on throw.
 *
 * Usage:
 *   const result = await withTransaction(txStore, async () => {
 *     return service.postRawReceipt(user, effective, input);
 *   });
 *
 * If the function throws, the store is rolled back (no committed writes).
 * If the function succeeds, the store is committed (all writes persisted).
 */
export async function withTransaction<T>(
  store: TransactionalTestStore,
  fn: () => Promise<T>,
): Promise<T> {
  store.begin();
  try {
    const result = await fn();
    store.commit();
    return result;
  } catch (error) {
    store.rollback();
    throw error;
  }
}
