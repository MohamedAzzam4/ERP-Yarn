/**
 * Drizzle-backed InventoryLedgerTransactionHandle — the production DB
 * repository for InventoryLedgerService.
 *
 * Contract: docs/contracts/04_inventory_posting_contract.md §13
 *   "Only InventoryLedgerService may insert posted movement rows or
 *    mutate materialized balances."
 *
 * Contract: docs/contracts/04_inventory_posting_contract.md §14
 *   "Locks affected balance rows in deterministic item/location order."
 *
 * Locking strategy (Contract 04 §14):
 *   1. Existing balance rows: SELECT ... FOR UPDATE via Drizzle .for('update')
 *      Row-level lock prevents concurrent updates until the transaction
 *      commits or rolls back.
 *   2. Missing balance rows: INSERT ... ON CONFLICT DO NOTHING on the unique
 *      (tenant_id, item_id, location_id) index. If two concurrent transactions
 *      try to create the same balance, one succeeds and the other gets no
 *      row back. The caller retries findBalanceForUpdate to pick up the
 *      row created by the winner, then locks it with FOR UPDATE.
 *   3. Lock key order: deterministic (tenant_id, item_id, location_id).
 *      For raw receipt, only one balance row is involved. For future
 *      transfer support, both source and destination balances must be
 *      locked in lexicographic (tenant_id, item_id, location_id) order
 *      to prevent deadlocks.
 *
 * WP-02-02 scope: repository + transaction-scoped factory. Tests use
 * TransactionalTestStore instead (no DB needed).
 */
import "server-only";
import { eq, and, or } from "drizzle-orm";
import { sql as drizzleSql } from "drizzle-orm";
import { stockMovements, inventoryBalances } from "@/server/db/schema";
import type { db as DbType } from "@/server/db/client";
import type {
  InventoryLedgerTransactionHandle,
  NewMovementInput,
  NewBalanceInput,
} from "./inventory-ledger-service";
import { CUTOVER_LOCK_NAMESPACE, computeCutoverLockKey, assertCutoverDomain } from "./cutover-coordination";
import type {
  StockMovement,
  InventoryBalance,
} from "@/server/db/schema/inventory-ledger";

type Db = NonNullable<typeof DbType>;

// ---------------------------------------------------------------------------
// Lock key ordering helper (Contract 04 §14: deterministic item/location order).
// ---------------------------------------------------------------------------

/**
 * Compute a deterministic lock key for a balance row.
 *
 * Contract 04 §14 step 4: "locks affected balance rows in deterministic
 * item/location order."
 *
 * The lock key is a composite string `(tenantId, itemId, locationId)` that
 * can be sorted lexicographically. When multiple balance rows need locking
 * (e.g., future transfer with source + destination), sort by this key
 * before locking to prevent deadlocks.
 *
 * For raw receipt (WP-02-02), only one balance row is involved, but the
 * deterministic order is still enforced for consistency.
 */
export function balanceLockKey(
  tenantId: string,
  itemId: string,
  locationId: string,
): string {
  return `${tenantId}|${itemId}|${locationId}`;
}

/**
 * Sort balance lock keys in deterministic lexicographic order.
 *
 * When locking multiple balance rows (future transfer support), call this
 * to get the correct lock order that prevents deadlocks.
 */
export function sortBalanceLockKeys(keys: string[]): string[] {
  return [...keys].sort();
}

// ---------------------------------------------------------------------------
// Drizzle-backed repository.
// ---------------------------------------------------------------------------

/**
 * Drizzle-backed InventoryLedgerTransactionHandle.
 *
 * Constructed with a Drizzle `db` instance (or a transaction-scoped `tx`).
 * All methods are tenant-scoped.
 *
 * `findBalanceForUpdate` uses `.for('update')` for real SELECT ... FOR UPDATE.
 * `insertBalance` uses `.onConflictDoNothing()` for concurrent-insert safety.
 */
export class InventoryLedgerDbRepository implements InventoryLedgerTransactionHandle {
  constructor(private readonly db: Db) {}

  async insertMovement(row: NewMovementInput): Promise<StockMovement> {
    const [result] = await this.db
      .insert(stockMovements)
      .values({
        tenantId: row.tenantId,
        docNo: row.docNo,
        movementType: row.movementType as StockMovement["movementType"],
        movementStatus: row.movementStatus as StockMovement["movementStatus"],
        itemId: row.itemId,
        fromLocationId: row.fromLocationId,
        toLocationId: row.toLocationId,
        quantityKg: row.quantityKg,
        movementDate: row.movementDate,
        sourceDocumentType: row.sourceDocumentType,
        sourceDocumentId: row.sourceDocumentId,
        idempotencyKey: row.idempotencyKey,
        postedBy: row.postedBy,
        postedAt: row.postedAt,
      })
      .returning();
    return result!;
  }

  async findMovementByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<StockMovement | null> {
    const [result] = await this.db
      .select()
      .from(stockMovements)
      .where(and(eq(stockMovements.tenantId, tenantId), eq(stockMovements.idempotencyKey, idempotencyKey)))
      .limit(1);
    return result ?? null;
  }

  async findMovementBySource(tenantId: string, sourceDocumentType: string, sourceDocumentId: string): Promise<StockMovement | null> {
    const [result] = await this.db
      .select()
      .from(stockMovements)
      .where(and(
        eq(stockMovements.tenantId, tenantId),
        eq(stockMovements.sourceDocumentType, sourceDocumentType),
        eq(stockMovements.sourceDocumentId, sourceDocumentId),
      ))
      .limit(1);
    return result ?? null;
  }

  async findMovementById(tenantId: string, id: string): Promise<StockMovement | null> {
    const [result] = await this.db
      .select()
      .from(stockMovements)
      .where(and(eq(stockMovements.tenantId, tenantId), eq(stockMovements.id, id)))
      .limit(1);
    return result ?? null;
  }

  /**
   * Find a balance row for update (SELECT ... FOR UPDATE).
   *
   * Uses Drizzle's `.for('update')` which generates `SELECT ... FOR UPDATE`.
   * This acquires a row-level lock that prevents concurrent updates until
   * the transaction commits or rolls back.
   *
   * The caller MUST wrap this call in `db.transaction()` for the lock to
   * be effective. Outside a transaction, FOR UPDATE is a no-op.
   *
   * Contract 04 §14 step 4: "locks affected balance rows in deterministic
   * item/location order."
   */
  async findBalanceForUpdate(tenantId: string, itemId: string, locationId: string): Promise<InventoryBalance | null> {
    const [result] = await this.db
      .select()
      .from(inventoryBalances)
      .where(and(
        eq(inventoryBalances.tenantId, tenantId),
        eq(inventoryBalances.itemId, itemId),
        eq(inventoryBalances.locationId, locationId),
      ))
      .for("update")
      .limit(1);
    return result ?? null;
  }

  /**
   * Insert a new balance row with concurrent-insert safety.
   *
   * Uses `.onConflictDoNothing()` on the unique
   * `(tenant_id, item_id, location_id)` index. If two concurrent
   * transactions try to create the same balance row, one succeeds and
   * the other gets no row back (returns null).
   *
   * The caller MUST handle the null case by retrying `findBalanceForUpdate`
   * to pick up the row created by the winner, then lock it with FOR UPDATE.
   *
   * This prevents the "missing balance row" race condition without
   * requiring advisory locks.
   */
  async insertBalance(row: NewBalanceInput): Promise<InventoryBalance> {
    const [result] = await this.db
      .insert(inventoryBalances)
      .values({
        tenantId: row.tenantId,
        itemId: row.itemId,
        locationId: row.locationId,
        onHandQtyKg: row.onHandQtyKg,
        lastMovementId: row.lastMovementId,
      })
      .onConflictDoNothing({
        target: [
          inventoryBalances.tenantId,
          inventoryBalances.itemId,
          inventoryBalances.locationId,
        ],
      })
      .returning();

    if (!result) {
      // Concurrent insert won — caller must retry findBalanceForUpdate.
      // This is a controlled race-resolution path, not an error.
      // The unique constraint (tenant_id, item_id, location_id) prevented
      // a duplicate. The winner's row is now visible.
      throw new BalanceConcurrentInsertError(row.tenantId, row.itemId, row.locationId);
    }

    return result;
  }

  async updateBalance(
    tenantId: string,
    itemId: string,
    locationId: string,
    patch: { onHandQtyKg: string; lastMovementId: string; version: number },
  ): Promise<InventoryBalance | null> {
    const [result] = await this.db
      .update(inventoryBalances)
      .set({
        onHandQtyKg: patch.onHandQtyKg,
        lastMovementId: patch.lastMovementId,
        version: patch.version,
        updatedAt: new Date(),
      })
      .where(and(
        eq(inventoryBalances.tenantId, tenantId),
        eq(inventoryBalances.itemId, itemId),
        eq(inventoryBalances.locationId, locationId),
      ))
      .returning();
    return result ?? null;
  }

  /**
   * Update the reserved_qty_kg on a balance row (WP-03-03).
   *
   * Used by SalesSubmissionService to increase reserved quantity when a sale
   * is submitted. Does NOT change on_hand_qty_kg — reservation only affects
   * available-to-sell, not physical stock (Contract 04 §8, §9).
   *
   * The DB CHECK constraints enforce:
   *   - reserved_qty_kg >= 0
   *   - reserved_qty_kg <= GREATEST(on_hand_qty_kg, 0)
   * So an over-reserve attempt will fail at the DB level.
   */
  async updateReservedQty(
    tenantId: string,
    itemId: string,
    locationId: string,
    patch: { reservedQtyKg: string; version: number },
  ): Promise<InventoryBalance | null> {
    const [result] = await this.db
      .update(inventoryBalances)
      .set({
        reservedQtyKg: patch.reservedQtyKg,
        version: patch.version,
        updatedAt: new Date(),
      })
      .where(and(
        eq(inventoryBalances.tenantId, tenantId),
        eq(inventoryBalances.itemId, itemId),
        eq(inventoryBalances.locationId, locationId),
      ))
      .returning();
    return result ?? null;
  }

  async listMovementsForBalance(tenantId: string, itemId: string, locationId: string): Promise<StockMovement[]> {
    // List movements where this location is EITHER the source or destination.
    // This is needed for full reconciliation (WP-03-01) which must account
    // for transfers OUT of this location (-qty) as well as receipts IN (+qty).
    return this.db
      .select()
      .from(stockMovements)
      .where(and(
        eq(stockMovements.tenantId, tenantId),
        eq(stockMovements.itemId, itemId),
        or(
          eq(stockMovements.toLocationId, locationId),
          eq(stockMovements.fromLocationId, locationId),
        ),
      ));
  }

  /**
   * List all balance rows for a tenant (WP-03-01 batch reconciliation).
   * Bounded by tenant — no global search.
   */
  async listAllBalances(tenantId: string): Promise<InventoryBalance[]> {
    return this.db
      .select()
      .from(inventoryBalances)
      .where(eq(inventoryBalances.tenantId, tenantId));
  }

  /**
   * Acquire a transaction-scoped cutover coordination advisory lock for
   * this tenant + domain.
   *
   * Contract 08 §8.1.1/§8.10/§12.4 + Contract 12 §11.4: historical
   * migration cutover and live operational posting in the same
   * tenant/domain scope MUST be mutually exclusive at the DB level.
   *
   * Implementation: pg_advisory_xact_lock(namespace, hash(tenant, domain))
   *   - Transaction-scoped: auto-released on COMMIT or ROLLBACK.
   *   - Re-entrant in the same transaction: the migration's own
   *     opening-balance posting re-acquires without self-blocking.
   *   - Atomic: no check-then-write TOCTOU window — the lock acquisition
   *     IS the synchronization point.
   *   - Tenant/domain-scoped: independent tenants and unaffected domains
   *     remain independent.
   *
   * WP-07-04 dependency correction (r10): the prior implementation
   * relied solely on the `import_cutover_locks` table whose unique
   * partial index is (tenant_id, import_batch_id, lock_scope) — that
   * prevented only concurrent historical commits on the same batch
   * and did NOT block live operational posting in the same tenant/domain.
   * This advisory lock provides the missing mutual exclusion.
   */
  async lockCutoverScope(tenantId: string, domain: "inventory" | "subledger"): Promise<void> {
    assertCutoverDomain(domain);
    const key = computeCutoverLockKey(tenantId, domain);
    await this.db.execute(
      drizzleSql`SELECT pg_advisory_xact_lock(${CUTOVER_LOCK_NAMESPACE}, ${key})`,
    );
  }
}

// ---------------------------------------------------------------------------
// Error: concurrent insert race resolution.
// ---------------------------------------------------------------------------

/**
 * Thrown when insertBalance detects a concurrent insert race.
 *
 * The unique constraint (tenant_id, item_id, location_id) prevented a
 * duplicate. The caller MUST retry findBalanceForUpdate to pick up the
 * row created by the winning transaction, then lock it with FOR UPDATE.
 *
 * This is NOT a fatal error — it's a controlled race-resolution signal.
 * The service layer catches this and retries the findBalanceForUpdate →
 * updateBalance path.
 */
export class BalanceConcurrentInsertError extends Error {
  readonly code = "BALANCE_CONCURRENT_INSERT";
  constructor(
    readonly tenantId: string,
    readonly itemId: string,
    readonly locationId: string,
  ) {
    super(
      `Concurrent insert detected for balance (${tenantId}, ${itemId}, ${locationId}). ` +
      `Retry findBalanceForUpdate to pick up the existing row.`,
    );
    this.name = "BalanceConcurrentInsertError";
  }
}

// ---------------------------------------------------------------------------
// Factory: create from runtime db.
// ---------------------------------------------------------------------------

export function createInventoryLedgerDbRepository(db: Db): InventoryLedgerDbRepository {
  return new InventoryLedgerDbRepository(db);
}

// ---------------------------------------------------------------------------
// Transaction-scoped factory.
// ---------------------------------------------------------------------------

/**
 * Create an InventoryLedgerService with all handles scoped to a single
 * Drizzle transaction.
 *
 * Contract 06 §6 step 6: "starts database transaction."
 * Contract 04 §14: "commits all or nothing."
 *
 * Usage:
 * ```ts
 * import { db } from "@/server/db/client";
 * import { withInventoryLedgerTransaction } from "./inventory-ledger-db-repository";
 *
 * const result = await withInventoryLedgerTransaction(db, async (service) => {
 *   return service.postRawReceipt(user, effective, input);
 * });
 * ```
 *
 * This wraps `db.transaction(tx => ...)` and creates:
 *   - InventoryLedgerDbRepository (using `tx` — shares the transaction)
 *   - Audit handle (using `tx` — shares the transaction)
 *   - Idempotency handle (using `tx` — shares the transaction)
 *   - Document sequence handle (using `tx` — shares the transaction)
 *
 * All 4 handles share the same transaction. If any handle throws, the
 * entire transaction rolls back (movement + balance + audit + idempotency
 * + doc-seq).
 *
 * NOTE: The audit, idempotency, and document-sequence handles currently
 * use their respective InProcess*Store test helpers because their DB-backed
 * implementations haven't been built yet (they were built as pure
 * interfaces + test stores in WP-01-03). When DB-backed implementations
 * for audit/idempotency/doc-seq are added (future WP), this factory will
 * be updated to use `tx`-scoped DB handles for all 4. The architecture is
 * correct — only the plumbing needs to be swapped.
 *
 * For now, in production, the caller should wrap this in db.transaction()
 * and pass the tx-scoped ledger repository. The audit/idempotency/doc-seq
 * stores will be upgraded to DB-backed in a future package.
 */
export async function withInventoryLedgerTransaction<T>(
  db: Db,
  fn: (service: import("./inventory-ledger-service").InventoryLedgerService) => Promise<T>,
): Promise<T> {
  // Create the ledger repository with the top-level db.
  // In a real production deployment, this would be inside db.transaction(tx => ...)
  // and all 4 handles would use tx. For now, the ledger repository uses db
  // directly, and the other 3 handles use their existing service-level
  // interfaces. The service's TransactionalTestStore proves the coordination
  // pattern works; the production wiring will be completed when the
  // audit/idempotency/doc-seq DB-backed handles are implemented.
  const ledger = new InventoryLedgerDbRepository(db);

  // For production use, the caller should construct the service with
  // appropriate audit/idempotency/doc-seq handles. This factory is a
  // convenience for the common case where only the ledger handle needs
  // to be DB-backed.
  //
  // The full transaction-scoped wiring (all 4 handles sharing one tx)
  // requires DB-backed implementations of AuditTransactionHandle,
  // IdempotencyTransactionHandle, and DocumentSequenceTransactionHandle.
  // These were built as interfaces + in-memory test stores in WP-01-03.
  // Their DB-backed implementations are a future package concern.

  // This factory is intentionally minimal — it exists to document the
  // correct production wiring pattern. The actual transaction boundary
  // is established by the caller wrapping the service call in
  // db.transaction().

  throw new Error(
    "withInventoryLedgerTransaction is not yet fully wired. " +
    "The production path requires db.transaction() with all 4 handles " +
    "sharing the same tx. See the module comment for the correct pattern. " +
    "Use createInventoryLedgerDbRepository(db) directly and construct " +
    "InventoryLedgerService with appropriate handles.",
  );
}
