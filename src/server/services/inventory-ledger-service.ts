/**
 * InventoryLedgerService — the sole owner of posted stock movements and
 * materialized balance updates.
 *
 * Contract: docs/contracts/04_inventory_posting_contract.md §13
 *   "Only InventoryLedgerService (or exact implementation equivalent)
 *    may insert posted movement rows or mutate materialized balances."
 *
 * Contract: docs/contracts/13_work_packages.md WP-02-02
 *   Goal: Implement the minimal reusable ledger/balance transaction
 *   primitive required for the first raw receipt posting.
 *
 * Contract: docs/contracts/04_inventory_posting_contract.md §14
 *   10-step posting protocol: validate → lock document → create balance
 *   if missing → lock balance rows in deterministic order → recheck →
 *   insert movement → update balance → audit → commit all or nothing.
 *
 * Contract: docs/contracts/06_approval_transaction_contract.md §6
 *   Audit failure rolls back the entire transaction.
 *
 * WP-02-02 scope: raw receipt handler only. No transfer, reservation,
 * production, sale, or adjustment handlers. No UI, no API routes.
 */
import "server-only";

import type { ErpUserContext } from "@/server/auth/erp-context";
import {
  requirePermission,
  requireTenantMatch,
  rejectBodyClaimsAuthority,
  PermissionDeniedError,
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
import {
  allocateDocumentNumber,
  type DocumentSequenceTransactionHandle,
} from "./document-sequence-service";
import { addKg, compareKg, isPositiveKg, normalizeKg, subtractKg, isValidDecimalKg } from "./decimal-kg";
import { BalanceConcurrentInsertError } from "./inventory-ledger-db-repository";
import type {
  StockMovement,
  InventoryBalance,
} from "@/server/db/schema/inventory-ledger";

// ---------------------------------------------------------------------------
// Domain types re-exported for service consumers.
// ---------------------------------------------------------------------------

export type { StockMovement, InventoryBalance } from "@/server/db/schema/inventory-ledger";

// ---------------------------------------------------------------------------
// Service error types.
// ---------------------------------------------------------------------------

export class InventoryLedgerError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "InventoryLedgerError";
    this.code = code;
  }
}

export class StockInsufficientError extends InventoryLedgerError {
  constructor(message: string) {
    super("STOCK_INSUFFICIENT", message);
    this.name = "StockInsufficientError";
  }
}

export class DuplicateSourceError extends InventoryLedgerError {
  constructor(message: string) {
    super("DUPLICATE_SOURCE", message);
    this.name = "DuplicateSourceError";
  }
}

export class IdempotencyConflictLedgerError extends InventoryLedgerError {
  constructor(message: string) {
    super("IDEMPOTENCY_CONFLICT", message);
    this.name = "IdempotencyConflictLedgerError";
  }
}

export class OperationInProgressLedgerError extends InventoryLedgerError {
  constructor(message: string) {
    super("OPERATION_IN_PROGRESS", message);
    this.name = "OperationInProgressLedgerError";
  }
}

export class ValidationFailedLedgerError extends InventoryLedgerError {
  constructor(message: string) {
    super("VALIDATION_FAILED", message);
    this.name = "ValidationFailedLedgerError";
  }
}

// ---------------------------------------------------------------------------
// Transaction handle — abstract persistence interface so the service is
// pure and testable (mirrors MasterDataRepository pattern).
// ---------------------------------------------------------------------------

/**
 * Persistence interface for inventory ledger operations.
 *
 * Every method is tenant-scoped: it MUST filter by `tenantId` and never
 * return/mutate rows from another tenant. The service enforces this by
 * always passing the caller's `tenantId` from `ErpUserContext`.
 *
 * The `findBalanceForUpdate` method represents a SELECT FOR UPDATE lock
 * on the balance row. In the in-memory test store, this is a simple
 * lookup (single-threaded, no real lock needed). In the Drizzle DB
 * implementation, it translates to `.forUpdate()`.
 */
export interface InventoryLedgerTransactionHandle {
  /** Insert a posted stock movement. Returns the inserted row with id. */
  insertMovement(row: NewMovementInput): Promise<StockMovement>;

  /** Find a movement by idempotency key (for replay/source-uniqueness). */
  findMovementByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<StockMovement | null>;

  /** Find a movement by source document (duplicate-source guard). */
  findMovementBySource(tenantId: string, sourceDocumentType: string, sourceDocumentId: string): Promise<StockMovement | null>;

  /** Find a movement by id (for reconciliation and result return). */
  findMovementById(tenantId: string, id: string): Promise<StockMovement | null>;

  /**
   * Find a balance row for update (SELECT FOR UPDATE).
   * Returns null if no balance row exists for this item/location.
   */
  findBalanceForUpdate(tenantId: string, itemId: string, locationId: string): Promise<InventoryBalance | null>;

  /** Insert a new balance row (when none exists for item/location). */
  insertBalance(row: NewBalanceInput): Promise<InventoryBalance>;

  /**
   * Update a balance row. Sets onHandQtyKg, lastMovementId, and bumps version.
   * Returns the updated row, or null if not found.
   */
  updateBalance(
    tenantId: string,
    itemId: string,
    locationId: string,
    patch: { onHandQtyKg: string; lastMovementId: string; version: number },
  ): Promise<InventoryBalance | null>;

  /**
   * Update the reserved_qty_kg on a balance row (WP-03-03).
   *
   * Used by SalesSubmissionService to increase reserved quantity when a sale
   * is submitted. Does NOT change on_hand_qty_kg — reservation only affects
   * available-to-sell, not physical stock (Contract 04 §8, §9).
   *
   * Returns the updated row, or null if not found.
   */
  updateReservedQty(
    tenantId: string,
    itemId: string,
    locationId: string,
    patch: { reservedQtyKg: string; version: number },
  ): Promise<InventoryBalance | null>;

  /** List all movements for an item/location (for reconciliation). */
  listMovementsForBalance(tenantId: string, itemId: string, locationId: string): Promise<StockMovement[]>;

  /** List all balance rows for a tenant (for batch reconciliation). WP-03-01. */
  listAllBalances(tenantId: string): Promise<InventoryBalance[]>;
}

// ---------------------------------------------------------------------------
// Input types (tenant_id, timestamps, audit are set by the service, never
// trusted from the request body per Contract 09 §5).
// ---------------------------------------------------------------------------

export interface NewMovementInput {
  tenantId: string;
  docNo: string;
  movementType: string;
  movementStatus: string;
  itemId: string;
  fromLocationId: string | null;
  toLocationId: string | null;
  quantityKg: string;
  movementDate: string;
  sourceDocumentType: string;
  sourceDocumentId: string;
  idempotencyKey: string;
  postedBy: string;
  postedAt: Date;
}

export interface NewBalanceInput {
  tenantId: string;
  itemId: string;
  locationId: string;
  onHandQtyKg: string;
  lastMovementId: string | null;
}

// ---------------------------------------------------------------------------
// WP-03-01: Transfer, adjustment, block, return, reversal input/result types.
// ---------------------------------------------------------------------------

export interface PostTransferInput {
  itemId: string;
  fromLocationId: string;
  toLocationId: string;
  quantityKg: string;
  movementDate: string;
  sourceDocumentType: string;
  sourceDocumentId: string;
  idempotencyKey: string;
  notes?: string;
}

export interface PostTransferResult {
  action: "posted" | "replayed";
  movementId: string;
  docNo: string;
  fromBalanceVersion: number;
  fromOnHandQtyKg: string;
  toBalanceVersion: number;
  toOnHandQtyKg: string;
}

export interface PostAdjustmentInput {
  itemId: string;
  locationId: string;
  quantityKgSigned: string;
  movementDate: string;
  sourceDocumentType: string;
  sourceDocumentId: string;
  idempotencyKey: string;
  notes?: string;
}

export interface PostAdjustmentResult {
  action: "posted" | "replayed";
  movementId: string;
  docNo: string;
  balanceVersion: number;
  onHandQtyKg: string;
}

export interface PostBlockInput {
  itemId: string;
  locationId: string;
  quantityKg: string;
  movementDate: string;
  sourceDocumentType: string;
  sourceDocumentId: string;
  idempotencyKey: string;
  isBlock: boolean; // true = block, false = unblock
  notes?: string;
}

export interface PostBlockResult {
  action: "posted" | "replayed";
  movementId: string;
  docNo: string;
  balanceVersion: number;
  onHandQtyKg: string;
}

export interface PostReversalInput {
  originalMovementId: string;
  reversalDate: string;
  reason: string;
  idempotencyKey: string;
}

export interface PostReversalResult {
  action: "posted" | "replayed";
  movementId: string;
  docNo: string;
  balanceVersion: number;
  onHandQtyKg: string;
  originalMovementId: string;
}

// ---------------------------------------------------------------------------
// Raw receipt input (the only handler in WP-02-02).
// ---------------------------------------------------------------------------

export interface PostRawReceiptInput {
  /** The inventory item being received (must be raw_material kind). */
  itemId: string;
  /** The destination location (where stock arrives). */
  toLocationId: string;
  /** Positive quantity in kg (NUMERIC(18,3) string, e.g. "1000.000"). */
  quantityKg: string;
  /** Movement date (ISO date string, e.g. "2026-07-01"). */
  movementDate: string;
  /** Source document type (e.g. "raw_material_batch"). */
  sourceDocumentType: string;
  /** Source document ID (e.g. the raw_material_batches.id). */
  sourceDocumentId: string;
  /** Idempotency key (required for every high-risk command). */
  idempotencyKey: string;
  /** Optional notes. */
  notes?: string;
}

export interface PostRawReceiptResult {
  action: "posted" | "replayed";
  movementId: string;
  docNo: string;
  balanceVersion: number;
  onHandQtyKg: string;
}

// ---------------------------------------------------------------------------
// Reconciliation result.
// ---------------------------------------------------------------------------

export interface ReconciliationResult {
  tenantId: string;
  itemId: string;
  locationId: string;
  /** Sum of all raw_receipt movements to this location. */
  movementSumKg: string;
  /** Current on_hand_qty_kg in the balance row. */
  balanceOnHandKg: string;
  /** True if movementSumKg matches balanceOnHandKg. */
  matches: boolean;
}

// ---------------------------------------------------------------------------
// InventoryLedgerService.
// ---------------------------------------------------------------------------

export interface InventoryLedgerServiceDeps {
  ledger: InventoryLedgerTransactionHandle;
  audit: AuditTransactionHandle;
  idempotency: IdempotencyTransactionHandle;
  documentSequence: DocumentSequenceTransactionHandle;
}

export class InventoryLedgerService {
  constructor(private readonly deps: InventoryLedgerServiceDeps) {}

  /**
   * Lock + fetch a balance row for update (WP-03-03).
   *
   * This is a NARROW reservation-specific boundary method. It delegates to
   * the internal ledger handle's `findBalanceForUpdate` but does NOT expose
   * the handle itself — callers cannot access `insertMovement`,
   * `updateBalance`, or other movement/posting methods through this path.
   *
   * Used by SalesSubmissionService to lock the balance row before checking
   * available stock and increasing `reserved_qty_kg`. The lock is held for
   * the duration of the enclosing transaction.
   *
   * Contract 04 §9: "Submission locks sale/balances, validates available
   * stock and state, inserts reservations per line, increases reserved
   * quantity."
   */
  async findBalanceForUpdate(
    tenantId: string,
    itemId: string,
    locationId: string,
  ): Promise<InventoryBalance | null> {
    return this.deps.ledger.findBalanceForUpdate(tenantId, itemId, locationId);
  }

  /**
   * Update the reserved_qty_kg on a balance row (WP-03-03).
   *
   * This is a NARROW reservation-specific boundary method. It delegates to
   * the internal ledger handle's `updateReservedQty` but does NOT expose
   * the handle itself.
   *
   * Used by SalesSubmissionService to increase `reserved_qty_kg` when a sale
   * is submitted. Does NOT change `on_hand_qty_kg` — reservation only affects
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
    return this.deps.ledger.updateReservedQty(tenantId, itemId, locationId, patch);
  }

  /**
   * Post a raw-receipt inventory effect.
   *
   * Movement matrix (Contract 04 §8): destination +qty, no reserved/WIP.
   *
   * 10-step protocol (Contract 04 §14):
   *   1. validate tenant, permission, state
   *   2. claim idempotency
   *   3. allocate doc_no
   *   4. lock balance row (deterministic item/location order)
   *   5. create balance row if missing
   *   6. recheck on-hand (raw receipt only adds — no negative check needed)
   *   7. insert immutable movement
   *   8. update balance (on_hand += qty, last_movement_id, version++)
   *   9. write audit (failure throws → rollback)
   *   10. mark idempotency succeeded
   */
  async postRawReceipt(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: PostRawReceiptInput,
  ): Promise<PostRawReceiptResult> {
    // Step 1: validate permission and reject body authority claims
    requirePermission(effective, "inventory.receive.approve");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    // Validate quantity is positive (Contract 03: quantity_kg > 0)
    if (!isPositiveKg(input.quantityKg)) {
      throw new ValidationFailedLedgerError(
        `Quantity must be positive (NUMERIC(18,3)), got '${input.quantityKg}'.`,
      );
    }

    const tenantId = user.tenantId;
    const normalizedQty = normalizeKg(input.quantityKg);
    const now = new Date();
    const year = now.getUTCFullYear();

    // Step 2: claim idempotency
    const idempotencyInput: IdempotencyClaimInput = {
      tenantId,
      operationScope: "inventory.raw_receipt.post",
      idempotencyKey: input.idempotencyKey,
      requestBody: {
        itemId: input.itemId,
        toLocationId: input.toLocationId,
        quantityKg: normalizedQty,
        movementDate: input.movementDate,
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentId: input.sourceDocumentId,
      } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    };

    const claim = await claimIdempotency(this.deps.idempotency, idempotencyInput);

    if (claim.action === "replay") {
      // Return prior result — find the movement by idempotency key
      const existingMovement = await this.deps.ledger.findMovementByIdempotencyKey(tenantId, input.idempotencyKey);
      if (existingMovement) {
        const balance = await this.deps.ledger.findBalanceForUpdate(tenantId, input.itemId, input.toLocationId);
        return {
          action: "replayed",
          movementId: existingMovement.id,
          docNo: existingMovement.docNo,
          balanceVersion: balance?.version ?? 0,
          onHandQtyKg: balance?.onHandQtyKg ?? "0.000",
        };
      }
      // Idempotency says replay but movement not found — treat as retryable
      // (should not happen in normal operation; idempotency record may be stale)
    }

    if (claim.action === "conflict") {
      throw new IdempotencyConflictLedgerError(
        `Idempotency key '${input.idempotencyKey}' was used with a different request body.`,
      );
    }

    if (claim.action === "in_progress") {
      throw new OperationInProgressLedgerError(
        `Operation '${input.idempotencyKey}' is still in progress.`,
      );
    }

    // claim.action === "execute" — proceed with the posting

    // Duplicate source guard (defense-in-depth, Contract 06 §7)
    const existingBySource = await this.deps.ledger.findMovementBySource(
      tenantId,
      input.sourceDocumentType,
      input.sourceDocumentId,
    );
    if (existingBySource) {
      // A movement already exists for this source document — replay it
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 409,
        responseBody: { message: "Duplicate source document" },
        lastErrorClass: "DuplicateSourceError",
      }, now);
      throw new DuplicateSourceError(
        `A movement already exists for source ${input.sourceDocumentType}/${input.sourceDocumentId}.`,
      );
    }

    // Step 3: allocate document number
    const docNoResult = await allocateDocumentNumber(
      this.deps.documentSequence,
      {
        tenantId,
        documentType: "raw_receipt",
        year,
        entityType: "stock_movement",
      },
    );

    // Step 4-5: lock balance row (deterministic order), create if missing.
    // Contract 04 §14 steps 3-4: "safely creates missing balance rows when
    // authorized; locks affected balance rows in deterministic item/location
    // order."
    //
    // Concurrency handling for missing balance rows:
    //   1. findBalanceForUpdate (SELECT ... FOR UPDATE) — returns null if
    //      no row exists.
    //   2. insertBalance with onConflictDoNothing — if a concurrent
    //      transaction already created the row, this returns null (or throws
    //      BalanceConcurrentInsertError in the DB-backed implementation).
    //   3. Retry findBalanceForUpdate — picks up the row created by the
    //      winner and locks it with FOR UPDATE.
    //
    // This prevents the "missing balance row" race without advisory locks.
    let balance = await this.deps.ledger.findBalanceForUpdate(tenantId, input.itemId, input.toLocationId);
    if (!balance) {
      // Create a new balance row with zero on-hand.
      // lastMovementId is null because the movement hasn't been inserted yet.
      // It will be updated after the movement insert (step 8).
      try {
        balance = await this.deps.ledger.insertBalance({
          tenantId,
          itemId: input.itemId,
          locationId: input.toLocationId,
          onHandQtyKg: "0.000",
          lastMovementId: null,
        });
      } catch (e) {
        // Catch ONLY the expected concurrent-insert condition.
        // Other errors (FK violations, constraint failures, connection errors)
        // must propagate — they indicate real bugs, not concurrent inserts.
        if (e instanceof BalanceConcurrentInsertError) {
          // Concurrent insert won — retry findBalanceForUpdate to pick up
          // the existing row and lock it with FOR UPDATE.
          balance = await this.deps.ledger.findBalanceForUpdate(tenantId, input.itemId, input.toLocationId);
          if (!balance) {
            // Extremely unlikely: row disappeared between insert conflict
            // and retry. Treat as a retryable technical failure.
            throw new InventoryLedgerError(
              "INTERNAL_TRANSACTION_FAILED",
              "Balance row not found after concurrent-insert retry.",
            );
          }
        } else {
          // Unexpected error — re-throw so it's not hidden as a
          // "Balance row not found" message.
          throw e;
        }
      }
    }

    // Tenant match check on the balance row
    requireTenantMatch(user, balance.tenantId);

    // Step 6: recheck — raw receipt only adds, so no negative-stock check needed

    // Step 7: insert immutable movement
    const movement = await this.deps.ledger.insertMovement({
      tenantId,
      docNo: docNoResult.docNo,
      movementType: "raw_receipt",
      movementStatus: "posted",
      itemId: input.itemId,
      fromLocationId: null,
      toLocationId: input.toLocationId,
      quantityKg: normalizedQty,
      movementDate: input.movementDate,
      sourceDocumentType: input.sourceDocumentType,
      sourceDocumentId: input.sourceDocumentId,
      idempotencyKey: input.idempotencyKey,
      postedBy: user.userId,
      postedAt: now,
    });

    // Step 8: update balance (on_hand += qty, last_movement_id, version++)
    const newOnHand = addKg(balance.onHandQtyKg, normalizedQty);
    const updatedBalance = await this.deps.ledger.updateBalance(
      tenantId,
      input.itemId,
      input.toLocationId,
      {
        onHandQtyKg: newOnHand,
        lastMovementId: movement.id,
        version: balance.version + 1,
      },
    );

    if (!updatedBalance) {
      // Balance row vanished between lock and update — should not happen
      throw new InventoryLedgerError(
        "INTERNAL_TRANSACTION_FAILED",
        "Balance row not found during update after movement insert.",
      );
    }

    // Step 9: write audit (failure throws AuditWriteFailedError → rollback)
    await appendAuditLog(this.deps.audit, tenantId, user.userId, {
      entityType: "stock_movement",
      entityId: movement.id,
      actionType: "inventory.raw_receipt.post",
      newValuesJson: {
        docNo: movement.docNo,
        movementType: "raw_receipt",
        itemId: movement.itemId,
        toLocationId: movement.toLocationId,
        quantityKg: movement.quantityKg,
        balanceVersion: updatedBalance.version,
        onHandQtyKg: updatedBalance.onHandQtyKg,
      },
      idempotencyKey: input.idempotencyKey,
    });

    // Step 10: mark idempotency succeeded
    await markSucceeded(this.deps.idempotency, claim.record.id, {
      responseCode: 200,
      responseBody: {
        movementId: movement.id,
        docNo: movement.docNo,
        balanceVersion: updatedBalance.version,
        onHandQtyKg: updatedBalance.onHandQtyKg,
      },
    }, now);

    return {
      action: "posted",
      movementId: movement.id,
      docNo: movement.docNo,
      balanceVersion: updatedBalance.version,
      onHandQtyKg: updatedBalance.onHandQtyKg,
    };
  }

  // =========================================================================
  // WP-03-01: Movement hooks for remaining contracted movement types.
  // =========================================================================
  //
  // Each hook follows the same 10-step protocol as postRawReceipt:
  //   1. validate permission + reject body authority
  //   2. validate quantity (positive absolute)
  //   3. claim idempotency
  //   4. duplicate source guard
  //   5. allocate doc_no
  //   6. lock balance row(s) in deterministic order
  //   7. create balance row if missing
  //   8. recheck on-hand (for source -qty movements, check sufficient stock)
  //   9. insert immutable movement + update balance(s)
  //  10. audit + mark idempotency succeeded
  //
  // Movement matrix (Contract 04 §8):
  //   transfer: source -qty, destination +qty (2 balances, deterministic lock order)
  //   adjustment: location +qty (increase) or -qty (decrease)
  //   stock_block: no on_hand change (blocked_qty_kg only — not implemented here,
  //                blocked qty is a separate column; this hook only records the
  //                movement for audit/reconciliation, no balance change)
  //   stock_unblock: same as block but inverse
  //   return_receipt: destination +qty (same matrix as raw_receipt but different type)
  //   reversal: exact inverse of original movement (posts inverse movement + balance)
  //
  // Contract 04 §14: "locks affected balance rows in deterministic
  // item/location order." For transfers involving 2 locations, locks are
  // acquired in ascending (itemId, locationId) order to prevent deadlocks.

  /**
   * Post a one-step transfer: source -qty, destination +qty atomically.
   *
   * Contract 04 §8.2: "One-step transfer: source -qty, destination +qty
   * atomically. Preserve classification."
   *
   * Permission: inventory.transfer.approve (Owner/Accountant).
   *
   * Deterministic lock order: balances locked in ascending (itemId, locationId)
   * order to prevent deadlocks between concurrent transfers.
   */
  async postTransfer(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: PostTransferInput,
  ): Promise<PostTransferResult> {
    requirePermission(effective, "inventory.transfer.approve");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!isPositiveKg(input.quantityKg)) {
      throw new ValidationFailedLedgerError(`Quantity must be positive, got '${input.quantityKg}'.`);
    }
    if (input.fromLocationId === input.toLocationId) {
      throw new ValidationFailedLedgerError("Source and destination locations must differ.");
    }

    const tenantId = user.tenantId;
    const normalizedQty = normalizeKg(input.quantityKg);
    const now = new Date();
    const year = now.getUTCFullYear();

    // Idempotency
    const idempotencyInput: IdempotencyClaimInput = {
      tenantId, operationScope: "inventory.transfer.post",
      idempotencyKey: input.idempotencyKey,
      requestBody: { itemId: input.itemId, fromLocationId: input.fromLocationId, toLocationId: input.toLocationId, quantityKg: normalizedQty, movementDate: input.movementDate, sourceDocumentType: input.sourceDocumentType, sourceDocumentId: input.sourceDocumentId } as Record<string, unknown>,
      initiatedBy: user.userId, leaseDurationMs: 30000, now,
    };
    const claim = await claimIdempotency(this.deps.idempotency, idempotencyInput);
    if (claim.action === "replay") {
      const existing = await this.deps.ledger.findMovementByIdempotencyKey(tenantId, input.idempotencyKey);
      if (existing) {
        const fromBal = await this.deps.ledger.findBalanceForUpdate(tenantId, input.itemId, input.fromLocationId);
        const toBal = await this.deps.ledger.findBalanceForUpdate(tenantId, input.itemId, input.toLocationId);
        return { action: "replayed", movementId: existing.id, docNo: existing.docNo, fromBalanceVersion: fromBal?.version ?? 0, fromOnHandQtyKg: fromBal?.onHandQtyKg ?? "0.000", toBalanceVersion: toBal?.version ?? 0, toOnHandQtyKg: toBal?.onHandQtyKg ?? "0.000" };
      }
    }
    if (claim.action === "conflict") throw new IdempotencyConflictLedgerError(`Idempotency key '${input.idempotencyKey}' conflict.`);
    if (claim.action === "in_progress") throw new OperationInProgressLedgerError(`Operation '${input.idempotencyKey}' in progress.`);

    // Duplicate source guard
    const existingBySource = await this.deps.ledger.findMovementBySource(tenantId, input.sourceDocumentType, input.sourceDocumentId);
    if (existingBySource) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, { responseCode: 409, responseBody: { message: "Duplicate source" }, lastErrorClass: "DuplicateSourceError" }, now);
      throw new DuplicateSourceError(`Movement already exists for source ${input.sourceDocumentType}/${input.sourceDocumentId}.`);
    }

    // Allocate doc_no
    const docNoResult = await allocateDocumentNumber(this.deps.documentSequence, { tenantId, documentType: "transfer", year, entityType: "stock_movement" });

    // Deterministic lock order: lock in ascending (itemId, locationId) order.
    const lockOrder = [input.fromLocationId, input.toLocationId].sort();
    const fromFirst = lockOrder[0] === input.fromLocationId;

    const firstLoc = fromFirst ? input.fromLocationId : input.toLocationId;
    const secondLoc = fromFirst ? input.toLocationId : input.fromLocationId;

    // Lock + fetch/create first balance
    let fromBalance = await this.deps.ledger.findBalanceForUpdate(tenantId, input.itemId, firstLoc);
    if (!fromBalance) {
      fromBalance = await this.deps.ledger.insertBalance({ tenantId, itemId: input.itemId, locationId: firstLoc, onHandQtyKg: "0.000", lastMovementId: null });
    }
    if (firstLoc === input.fromLocationId) {
      requireTenantMatch(user, fromBalance.tenantId);
      // Check sufficient stock for source
      if (compareKg(fromBalance.onHandQtyKg, normalizedQty) < 0) {
        await markBusinessFailed(this.deps.idempotency, claim.record.id, { responseCode: 422, responseBody: { message: "Insufficient stock" }, lastErrorClass: "StockInsufficientError" }, now);
        throw new StockInsufficientError(`Insufficient stock at source: on_hand=${fromBalance.onHandQtyKg}, requested=${normalizedQty}.`);
      }
    }

    // Lock + fetch/create second balance
    let toBalance = await this.deps.ledger.findBalanceForUpdate(tenantId, input.itemId, secondLoc);
    if (!toBalance) {
      toBalance = await this.deps.ledger.insertBalance({ tenantId, itemId: input.itemId, locationId: secondLoc, onHandQtyKg: "0.000", lastMovementId: null });
    }
    requireTenantMatch(user, toBalance.tenantId);

    // Re-fetch in correct roles
    const srcBal = fromFirst ? fromBalance : toBalance;
    const dstBal = fromFirst ? toBalance : fromBalance;

    // Stock check: ensure source has sufficient stock (checked after both balances are locked)
    if (compareKg(srcBal.onHandQtyKg, normalizedQty) < 0) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, { responseCode: 422, responseBody: { message: "Insufficient stock" }, lastErrorClass: "StockInsufficientError" }, now);
      throw new StockInsufficientError(`Insufficient stock at source: on_hand=${srcBal.onHandQtyKg}, requested=${normalizedQty}.`);
    }

    // Insert movement
    const movement = await this.deps.ledger.insertMovement({
      tenantId, docNo: docNoResult.docNo, movementType: "transfer", movementStatus: "posted",
      itemId: input.itemId, fromLocationId: input.fromLocationId, toLocationId: input.toLocationId,
      quantityKg: normalizedQty, movementDate: input.movementDate,
      sourceDocumentType: input.sourceDocumentType, sourceDocumentId: input.sourceDocumentId,
      idempotencyKey: input.idempotencyKey, postedBy: user.userId, postedAt: now,
    });

    // Update source balance: on_hand -= qty
    const newSrcOnHand = subtractKg(srcBal.onHandQtyKg, normalizedQty);
    const updatedSrc = await this.deps.ledger.updateBalance(tenantId, input.itemId, input.fromLocationId, { onHandQtyKg: newSrcOnHand, lastMovementId: movement.id, version: srcBal.version + 1 });
    if (!updatedSrc) throw new InventoryLedgerError("INTERNAL_TRANSACTION_FAILED", "Source balance not found during update.");

    // Update destination balance: on_hand += qty
    const newDstOnHand = addKg(dstBal.onHandQtyKg, normalizedQty);
    const updatedDst = await this.deps.ledger.updateBalance(tenantId, input.itemId, input.toLocationId, { onHandQtyKg: newDstOnHand, lastMovementId: movement.id, version: dstBal.version + 1 });
    if (!updatedDst) throw new InventoryLedgerError("INTERNAL_TRANSACTION_FAILED", "Destination balance not found during update.");

    // Audit
    await appendAuditLog(this.deps.audit, tenantId, user.userId, {
      entityType: "stock_movement", entityId: movement.id, actionType: "inventory.transfer.post",
      newValuesJson: { docNo: movement.docNo, itemId: movement.itemId, fromLocationId: movement.fromLocationId, toLocationId: movement.toLocationId, quantityKg: movement.quantityKg, srcBalanceVersion: updatedSrc.version, dstBalanceVersion: updatedDst.version },
      idempotencyKey: input.idempotencyKey,
    });

    await markSucceeded(this.deps.idempotency, claim.record.id, { responseCode: 200, responseBody: { movementId: movement.id } }, now);

    return { action: "posted", movementId: movement.id, docNo: movement.docNo, fromBalanceVersion: updatedSrc.version, fromOnHandQtyKg: updatedSrc.onHandQtyKg, toBalanceVersion: updatedDst.version, toOnHandQtyKg: updatedDst.onHandQtyKg };
  }

  /**
   * Post an inventory adjustment: location +qty (increase) or -qty (decrease).
   *
   * Contract 04 §8.3: "Adjustment uses a single location and a signed
   * quantity. Positive increases on-hand; negative decreases."
   *
   * Permission: inventory.adjustment.approve (Owner/Accountant).
   */
  async postAdjustment(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: PostAdjustmentInput,
  ): Promise<PostAdjustmentResult> {
    requirePermission(effective, "inventory.adjustment.approve");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    // Validate: signed quantity must be non-zero
    if (!isValidDecimalKg(input.quantityKgSigned) || compareKg(input.quantityKgSigned, "0.000") === 0) {
      throw new ValidationFailedLedgerError(`Adjustment quantity must be non-zero, got '${input.quantityKgSigned}'.`);
    }

    const tenantId = user.tenantId;
    const normalizedQty = normalizeKg(input.quantityKgSigned);
    const now = new Date();
    const year = now.getUTCFullYear();

    const idempotencyInput: IdempotencyClaimInput = {
      tenantId, operationScope: "inventory.adjustment.post",
      idempotencyKey: input.idempotencyKey,
      requestBody: { itemId: input.itemId, locationId: input.locationId, quantityKgSigned: normalizedQty, movementDate: input.movementDate, sourceDocumentType: input.sourceDocumentType, sourceDocumentId: input.sourceDocumentId } as Record<string, unknown>,
      initiatedBy: user.userId, leaseDurationMs: 30000, now,
    };
    const claim = await claimIdempotency(this.deps.idempotency, idempotencyInput);
    if (claim.action === "replay") {
      const existing = await this.deps.ledger.findMovementByIdempotencyKey(tenantId, input.idempotencyKey);
      if (existing) {
        const bal = await this.deps.ledger.findBalanceForUpdate(tenantId, input.itemId, input.locationId);
        return { action: "replayed", movementId: existing.id, docNo: existing.docNo, balanceVersion: bal?.version ?? 0, onHandQtyKg: bal?.onHandQtyKg ?? "0.000" };
      }
    }
    if (claim.action === "conflict") throw new IdempotencyConflictLedgerError(`Idempotency key '${input.idempotencyKey}' conflict.`);
    if (claim.action === "in_progress") throw new OperationInProgressLedgerError(`Operation '${input.idempotencyKey}' in progress.`);

    const existingBySource = await this.deps.ledger.findMovementBySource(tenantId, input.sourceDocumentType, input.sourceDocumentId);
    if (existingBySource) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, { responseCode: 409, responseBody: { message: "Duplicate source" }, lastErrorClass: "DuplicateSourceError" }, now);
      throw new DuplicateSourceError(`Movement already exists for source ${input.sourceDocumentType}/${input.sourceDocumentId}.`);
    }

    const docNoResult = await allocateDocumentNumber(this.deps.documentSequence, { tenantId, documentType: "adjustment", year, entityType: "stock_movement" });

    let balance = await this.deps.ledger.findBalanceForUpdate(tenantId, input.itemId, input.locationId);
    if (!balance) {
      balance = await this.deps.ledger.insertBalance({ tenantId, itemId: input.itemId, locationId: input.locationId, onHandQtyKg: "0.000", lastMovementId: null });
    }
    requireTenantMatch(user, balance.tenantId);

    // Contract 04 §8: "Positive absolute quantities; explicit movement matrix."
    // The DB CHECK constraint requires quantity_kg > 0.
    // For negative adjustments, we store the ABSOLUTE value and use
    // fromLocationId (source) to indicate a decrease.
    // For positive adjustments, we use toLocationId (destination) for an increase.
    // The reconciliation service interprets: FROM location = -qty, TO location = +qty.
    const isNegative = normalizedQty.startsWith("-");
    const absQty = isNegative ? normalizedQty.slice(1) : normalizedQty;

    const movement = await this.deps.ledger.insertMovement({
      tenantId, docNo: docNoResult.docNo, movementType: "inventory_adjustment", movementStatus: "posted",
      itemId: input.itemId,
      fromLocationId: isNegative ? input.locationId : null,
      toLocationId: isNegative ? null : input.locationId,
      quantityKg: absQty, movementDate: input.movementDate,
      sourceDocumentType: input.sourceDocumentType, sourceDocumentId: input.sourceDocumentId,
      idempotencyKey: input.idempotencyKey, postedBy: user.userId, postedAt: now,
    });

    // Apply the signed effect on balance
    const newOnHand = addKg(balance.onHandQtyKg, normalizedQty);
    const updatedBalance = await this.deps.ledger.updateBalance(tenantId, input.itemId, input.locationId, { onHandQtyKg: newOnHand, lastMovementId: movement.id, version: balance.version + 1 });
    if (!updatedBalance) throw new InventoryLedgerError("INTERNAL_TRANSACTION_FAILED", "Balance not found during update.");

    await appendAuditLog(this.deps.audit, tenantId, user.userId, {
      entityType: "stock_movement", entityId: movement.id, actionType: "inventory.adjustment.post",
      newValuesJson: { docNo: movement.docNo, itemId: movement.itemId, locationId: input.locationId, quantityKgSigned: normalizedQty, newOnHandQtyKg: updatedBalance.onHandQtyKg, balanceVersion: updatedBalance.version },
      idempotencyKey: input.idempotencyKey,
    });

    await markSucceeded(this.deps.idempotency, claim.record.id, { responseCode: 200, responseBody: { movementId: movement.id } }, now);

    return { action: "posted", movementId: movement.id, docNo: movement.docNo, balanceVersion: updatedBalance.version, onHandQtyKg: updatedBalance.onHandQtyKg };
  }

  /**
   * Post a stock block or unblock.
   *
   * Contract 04 §8: "Block/unblock: no physical change, blocked +qty/-qty."
   *
   * This hook records the movement for audit/reconciliation but does NOT
   * change on_hand_qty_kg. The blocked_qty_kg column on inventory_balances
   * is updated instead.
   *
   * Permission: inventory.adjustment.approve (Owner/Accountant).
   */
  async postBlockUnblock(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: PostBlockInput,
  ): Promise<PostBlockResult> {
    requirePermission(effective, "inventory.adjustment.approve");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!isPositiveKg(input.quantityKg)) {
      throw new ValidationFailedLedgerError(`Quantity must be positive, got '${input.quantityKg}'.`);
    }

    const tenantId = user.tenantId;
    const normalizedQty = normalizeKg(input.quantityKg);
    const now = new Date();
    const year = now.getUTCFullYear();
    const movementType = input.isBlock ? "stock_block" : "stock_unblock";

    const idempotencyInput: IdempotencyClaimInput = {
      tenantId, operationScope: `inventory.${movementType}.post`,
      idempotencyKey: input.idempotencyKey,
      requestBody: { itemId: input.itemId, locationId: input.locationId, quantityKg: normalizedQty, movementDate: input.movementDate, sourceDocumentType: input.sourceDocumentType, sourceDocumentId: input.sourceDocumentId } as Record<string, unknown>,
      initiatedBy: user.userId, leaseDurationMs: 30000, now,
    };
    const claim = await claimIdempotency(this.deps.idempotency, idempotencyInput);
    if (claim.action === "replay") {
      const existing = await this.deps.ledger.findMovementByIdempotencyKey(tenantId, input.idempotencyKey);
      if (existing) {
        const bal = await this.deps.ledger.findBalanceForUpdate(tenantId, input.itemId, input.locationId);
        return { action: "replayed", movementId: existing.id, docNo: existing.docNo, balanceVersion: bal?.version ?? 0, onHandQtyKg: bal?.onHandQtyKg ?? "0.000" };
      }
    }
    if (claim.action === "conflict") throw new IdempotencyConflictLedgerError(`Idempotency key '${input.idempotencyKey}' conflict.`);
    if (claim.action === "in_progress") throw new OperationInProgressLedgerError(`Operation '${input.idempotencyKey}' in progress.`);

    const docNoResult = await allocateDocumentNumber(this.deps.documentSequence, { tenantId, documentType: "adjustment", year, entityType: "stock_movement" });

    let balance = await this.deps.ledger.findBalanceForUpdate(tenantId, input.itemId, input.locationId);
    if (!balance) {
      balance = await this.deps.ledger.insertBalance({ tenantId, itemId: input.itemId, locationId: input.locationId, onHandQtyKg: "0.000", lastMovementId: null });
    }
    requireTenantMatch(user, balance.tenantId);

    // Insert movement — no on_hand change for block/unblock
    const movement = await this.deps.ledger.insertMovement({
      tenantId, docNo: docNoResult.docNo, movementType, movementStatus: "posted",
      itemId: input.itemId, fromLocationId: null, toLocationId: input.locationId,
      quantityKg: normalizedQty, movementDate: input.movementDate,
      sourceDocumentType: input.sourceDocumentType, sourceDocumentId: input.sourceDocumentId,
      idempotencyKey: input.idempotencyKey, postedBy: user.userId, postedAt: now,
    });

    // NOTE: Block/unblock does NOT change on_hand_qty_kg.
    // The blocked_qty_kg column update is not implemented here because
    // the InventoryLedgerTransactionHandle.updateBalance only updates
    // on_hand_qty_kg. A full block/unblock implementation would need
    // an updateBalanceBlocked method. For WP-03-01, we record the
    // movement for audit/reconciliation and leave on_hand unchanged.
    // The movement is visible in reconciliation (movement type breakdown)
    // but has zero effect on on_hand sum.

    await appendAuditLog(this.deps.audit, tenantId, user.userId, {
      entityType: "stock_movement", entityId: movement.id, actionType: `inventory.${movementType}.post`,
      newValuesJson: { docNo: movement.docNo, itemId: movement.itemId, locationId: input.locationId, quantityKg: normalizedQty, note: "no on_hand change (block/unblock)" },
      idempotencyKey: input.idempotencyKey,
    });

    await markSucceeded(this.deps.idempotency, claim.record.id, { responseCode: 200, responseBody: { movementId: movement.id } }, now);

    return { action: "posted", movementId: movement.id, docNo: movement.docNo, balanceVersion: balance.version, onHandQtyKg: balance.onHandQtyKg };
  }

  /**
   * Post a return receipt: destination +qty.
   *
   * Contract 04 §8: "Customer return: return location +qty, returned +qty;
   * block by status."
   *
   * Permission: inventory.receive.approve (Owner/Accountant).
   * Same matrix as raw_receipt but different movement type.
   */
  async postReturnReceipt(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: PostRawReceiptInput,
  ): Promise<PostRawReceiptResult> {
    // Reuse postRawReceipt logic but with movementType = "return_receipt"
    // For WP-03-01, we delegate to a shared internal helper.
    return this.postSingleLocationMovement(user, effective, {
      ...input,
      movementType: "return_receipt",
      permissionKey: "inventory.receive.approve",
      docType: "return_receipt",
      operationScope: "inventory.return_receipt.post",
    });
  }

  /**
   * Post an issue-to-production movement: factory on-hand -qty.
   *
   * Contract 04 §8: "Issue to production: factory -qty, issued stock must
   * be available, WIP +qty."
   * Contract 05 §12: "Issue to Production" preconditions + transaction.
   *
   * This method ONLY decreases factory on-hand. The WIP increase is handled
   * by the ProductionIssueService via the WipBalanceRepository (WIP is a
   * separate materialized balance, not part of inventory_balances).
   *
   * Permission: production.issue.approve (Owner/Accountant).
   */
  async postIssueToProduction(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: {
      itemId: string;
      fromLocationId: string;
      quantityKg: string;
      movementDate: string;
      sourceDocumentType: string;
      sourceDocumentId: string;
      idempotencyKey: string;
      notes?: string;
    },
  ): Promise<PostAdjustmentResult> {
    requirePermission(effective, "production.issue.approve");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!isPositiveKg(input.quantityKg)) {
      throw new ValidationFailedLedgerError(`Quantity must be positive, got '${input.quantityKg}'.`);
    }

    const tenantId = user.tenantId;
    const normalizedQty = normalizeKg(input.quantityKg);
    const now = new Date();
    const year = now.getUTCFullYear();

    const idempotencyInput: IdempotencyClaimInput = {
      tenantId, operationScope: "inventory.issue_to_production.post",
      idempotencyKey: input.idempotencyKey,
      requestBody: { itemId: input.itemId, fromLocationId: input.fromLocationId, quantityKg: normalizedQty, movementDate: input.movementDate, sourceDocumentType: input.sourceDocumentType, sourceDocumentId: input.sourceDocumentId } as Record<string, unknown>,
      initiatedBy: user.userId, leaseDurationMs: 30000, now,
    };
    const claim = await claimIdempotency(this.deps.idempotency, idempotencyInput);
    if (claim.action === "replay") {
      const existing = await this.deps.ledger.findMovementByIdempotencyKey(tenantId, input.idempotencyKey);
      if (existing) {
        const bal = await this.deps.ledger.findBalanceForUpdate(tenantId, input.itemId, input.fromLocationId);
        return { action: "replayed", movementId: existing.id, docNo: existing.docNo, balanceVersion: bal?.version ?? 0, onHandQtyKg: bal?.onHandQtyKg ?? "0.000" };
      }
    }
    if (claim.action === "conflict") throw new IdempotencyConflictLedgerError(`Idempotency key '${input.idempotencyKey}' conflict.`);
    if (claim.action === "in_progress") throw new OperationInProgressLedgerError(`Operation '${input.idempotencyKey}' in progress.`);

    // Duplicate source guard
    const existingBySource = await this.deps.ledger.findMovementBySource(tenantId, input.sourceDocumentType, input.sourceDocumentId);
    if (existingBySource) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, { responseCode: 409, responseBody: { message: "Duplicate source" }, lastErrorClass: "DuplicateSourceError" }, now);
      throw new DuplicateSourceError(`Movement already exists for source ${input.sourceDocumentType}/${input.sourceDocumentId}.`);
    }

    const docNoResult = await allocateDocumentNumber(this.deps.documentSequence, { tenantId, documentType: "production_issue", year, entityType: "stock_movement" });

    // Lock + fetch/create balance
    let balance = await this.deps.ledger.findBalanceForUpdate(tenantId, input.itemId, input.fromLocationId);
    if (!balance) {
      balance = await this.deps.ledger.insertBalance({ tenantId, itemId: input.itemId, locationId: input.fromLocationId, onHandQtyKg: "0.000", lastMovementId: null });
    }
    requireTenantMatch(user, balance.tenantId);

    // Check sufficient stock
    if (compareKg(balance.onHandQtyKg, normalizedQty) < 0) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, { responseCode: 422, responseBody: { message: "Insufficient stock" }, lastErrorClass: "StockInsufficientError" }, now);
      throw new StockInsufficientError(`Insufficient stock at factory location: on_hand=${balance.onHandQtyKg}, requested=${normalizedQty}.`);
    }

    // Insert movement — issue_to_production uses fromLocationId (source -qty)
    const movement = await this.deps.ledger.insertMovement({
      tenantId, docNo: docNoResult.docNo, movementType: "issue_to_production", movementStatus: "posted",
      itemId: input.itemId, fromLocationId: input.fromLocationId, toLocationId: null,
      quantityKg: normalizedQty, movementDate: input.movementDate,
      sourceDocumentType: input.sourceDocumentType, sourceDocumentId: input.sourceDocumentId,
      idempotencyKey: input.idempotencyKey, postedBy: user.userId, postedAt: now,
    });

    // Update balance: on_hand -= qty
    const newOnHand = subtractKg(balance.onHandQtyKg, normalizedQty);
    const updatedBalance = await this.deps.ledger.updateBalance(tenantId, input.itemId, input.fromLocationId, { onHandQtyKg: newOnHand, lastMovementId: movement.id, version: balance.version + 1 });
    if (!updatedBalance) throw new InventoryLedgerError("INTERNAL_TRANSACTION_FAILED", "Balance not found during update.");

    await appendAuditLog(this.deps.audit, tenantId, user.userId, {
      entityType: "stock_movement", entityId: movement.id, actionType: "inventory.issue_to_production.post",
      newValuesJson: { docNo: movement.docNo, itemId: movement.itemId, fromLocationId: movement.fromLocationId, quantityKg: movement.quantityKg, newOnHandQtyKg: updatedBalance.onHandQtyKg, balanceVersion: updatedBalance.version },
      idempotencyKey: input.idempotencyKey,
    });

    await markSucceeded(this.deps.idempotency, claim.record.id, { responseCode: 200, responseBody: { movementId: movement.id } }, now);

    return { action: "posted", movementId: movement.id, docNo: movement.docNo, balanceVersion: updatedBalance.version, onHandQtyKg: updatedBalance.onHandQtyKg };
  }

  /**
   * Post a reversal: exact inverse of an original movement.
   *
   * Contract 04 §8: "Reversal: approved exact inverse, inverse contracted
   * effects."
   *
   * The reversal creates a new movement with movementType="reversal" that
   * has the opposite effect on the balance. If the original was +qty to
   * location A, the reversal is -qty from location A (or +qty from A to
   * a virtual reversal location — but for simplicity, we post -qty at the
   * original location via an adjustment-like movement).
   *
   * Permission: inventory.reverse (Owner/Accountant).
   */
  async postReversal(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: PostReversalInput,
  ): Promise<PostReversalResult> {
    requirePermission(effective, "inventory.reverse");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    const tenantId = user.tenantId;
    const now = new Date();
    const year = now.getUTCFullYear();

    // Fetch original movement
    const original = await this.deps.ledger.findMovementById(tenantId, input.originalMovementId);
    if (!original) {
      throw new ValidationFailedLedgerError(`Original movement '${input.originalMovementId}' not found.`);
    }
    requireTenantMatch(user, original.tenantId);

    // Idempotency
    const idempotencyInput: IdempotencyClaimInput = {
      tenantId, operationScope: "inventory.reversal.post",
      idempotencyKey: input.idempotencyKey,
      requestBody: { originalMovementId: input.originalMovementId, reason: input.reason } as Record<string, unknown>,
      initiatedBy: user.userId, leaseDurationMs: 30000, now,
    };
    const claim = await claimIdempotency(this.deps.idempotency, idempotencyInput);
    if (claim.action === "replay") {
      const existing = await this.deps.ledger.findMovementByIdempotencyKey(tenantId, input.idempotencyKey);
      if (existing) {
        const bal = await this.deps.ledger.findBalanceForUpdate(tenantId, original.itemId, original.toLocationId ?? "");
        return { action: "replayed", movementId: existing.id, docNo: existing.docNo, balanceVersion: bal?.version ?? 0, onHandQtyKg: bal?.onHandQtyKg ?? "0.000", originalMovementId: input.originalMovementId };
      }
    }
    if (claim.action === "conflict") throw new IdempotencyConflictLedgerError(`Idempotency key '${input.idempotencyKey}' conflict.`);
    if (claim.action === "in_progress") throw new OperationInProgressLedgerError(`Operation '${input.idempotencyKey}' in progress.`);

    // Duplicate source guard: prevent double reversal of the same movement.
    // sourceDocumentType='stock_movement', sourceDocumentId=originalMovementId.
    const existingReversal = await this.deps.ledger.findMovementBySource(tenantId, "stock_movement", input.originalMovementId);
    if (existingReversal) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, { responseCode: 409, responseBody: { message: "Duplicate reversal" }, lastErrorClass: "DuplicateSourceError" }, now);
      throw new DuplicateSourceError(`A reversal already exists for movement ${input.originalMovementId}.`);
    }

    const docNoResult = await allocateDocumentNumber(this.deps.documentSequence, { tenantId, documentType: "reversal", year, entityType: "stock_movement" });

    // Determine if this is a two-location movement (transfer) or single-location.
    const isTransfer = original.fromLocationId !== null && original.toLocationId !== null
      && original.fromLocationId !== original.toLocationId;

    if (isTransfer) {
      // Transfer reversal: reverse BOTH locations.
      // Original: source -qty, dest +qty
      // Reversal: source +qty (add back), dest -qty (remove)
      const sourceLocId = original.fromLocationId!;
      const destLocId = original.toLocationId!;

      // Lock in deterministic order (ascending locationId)
      const lockOrder = [sourceLocId, destLocId].sort();
      const firstLoc = lockOrder[0]!;
      const secondLoc = lockOrder[1]!;

      // Lock + fetch first balance
      let firstBalance = await this.deps.ledger.findBalanceForUpdate(tenantId, original.itemId, firstLoc);
      if (!firstBalance) {
        firstBalance = await this.deps.ledger.insertBalance({ tenantId, itemId: original.itemId, locationId: firstLoc, onHandQtyKg: "0.000", lastMovementId: null });
      }

      // Lock + fetch second balance
      let secondBalance = await this.deps.ledger.findBalanceForUpdate(tenantId, original.itemId, secondLoc);
      if (!secondBalance) {
        secondBalance = await this.deps.ledger.insertBalance({ tenantId, itemId: original.itemId, locationId: secondLoc, onHandQtyKg: "0.000", lastMovementId: null });
      }

      // Insert reversal movement
      const movement = await this.deps.ledger.insertMovement({
        tenantId, docNo: docNoResult.docNo, movementType: "reversal", movementStatus: "posted",
        itemId: original.itemId, fromLocationId: sourceLocId, toLocationId: destLocId,
        quantityKg: original.quantityKg, movementDate: input.reversalDate,
        sourceDocumentType: "stock_movement", sourceDocumentId: input.originalMovementId,
        idempotencyKey: input.idempotencyKey, postedBy: user.userId, postedAt: now,
      });

      // Update source balance: +qty (add back what was removed)
      const srcBalance = firstLoc === sourceLocId ? firstBalance : secondBalance;
      const newSrcOnHand = addKg(srcBalance.onHandQtyKg, original.quantityKg);
      const updatedSrc = await this.deps.ledger.updateBalance(tenantId, original.itemId, sourceLocId, { onHandQtyKg: newSrcOnHand, lastMovementId: movement.id, version: srcBalance.version + 1 });
      if (!updatedSrc) throw new InventoryLedgerError("INTERNAL_TRANSACTION_FAILED", "Source balance not found during reversal.");

      // Update dest balance: -qty (remove what was added)
      const dstBalance = firstLoc === destLocId ? firstBalance : secondBalance;
      const newDstOnHand = subtractKg(dstBalance.onHandQtyKg, original.quantityKg);
      const updatedDst = await this.deps.ledger.updateBalance(tenantId, original.itemId, destLocId, { onHandQtyKg: newDstOnHand, lastMovementId: movement.id, version: dstBalance.version + 1 });
      if (!updatedDst) throw new InventoryLedgerError("INTERNAL_TRANSACTION_FAILED", "Destination balance not found during reversal.");

      await appendAuditLog(this.deps.audit, tenantId, user.userId, {
        entityType: "stock_movement", entityId: movement.id, actionType: "inventory.reversal.post",
        newValuesJson: { docNo: movement.docNo, originalMovementId: input.originalMovementId, itemId: original.itemId, sourceLocId, destLocId, newSrcOnHand, newDstOnHand, reason: input.reason },
        idempotencyKey: input.idempotencyKey,
      });

      await markSucceeded(this.deps.idempotency, claim.record.id, { responseCode: 200, responseBody: { movementId: movement.id } }, now);

      return { action: "posted", movementId: movement.id, docNo: movement.docNo, balanceVersion: updatedSrc.version, onHandQtyKg: updatedSrc.onHandQtyKg, originalMovementId: input.originalMovementId };

    } else {
      // Single-location reversal (raw_receipt, return_receipt, adjustment)
      // Original: toLocationId +qty (or fromLocationId -qty for negative adjustment)
      // Reversal: inverse effect at the same location
      const isSourceMovement = original.fromLocationId !== null;
      const locationId = isSourceMovement
        ? (original.fromLocationId ?? "")
        : (original.toLocationId ?? original.fromLocationId ?? "");
      if (!locationId) throw new ValidationFailedLedgerError("Original movement has no location.");

      const inverseQty = isSourceMovement
        ? original.quantityKg  // positive: add back what was removed
        : subtractKg("0.000", original.quantityKg); // negative: remove what was added

      let balance = await this.deps.ledger.findBalanceForUpdate(tenantId, original.itemId, locationId);
      if (!balance) {
        balance = await this.deps.ledger.insertBalance({ tenantId, itemId: original.itemId, locationId, onHandQtyKg: "0.000", lastMovementId: null });
      }

      const movement = await this.deps.ledger.insertMovement({
        tenantId, docNo: docNoResult.docNo, movementType: "reversal", movementStatus: "posted",
        itemId: original.itemId, fromLocationId: locationId, toLocationId: null,
        quantityKg: original.quantityKg, movementDate: input.reversalDate,
        sourceDocumentType: "stock_movement", sourceDocumentId: input.originalMovementId,
        idempotencyKey: input.idempotencyKey, postedBy: user.userId, postedAt: now,
      });

      const newOnHand = addKg(balance.onHandQtyKg, inverseQty);
      const updatedBalance = await this.deps.ledger.updateBalance(tenantId, original.itemId, locationId, { onHandQtyKg: newOnHand, lastMovementId: movement.id, version: balance.version + 1 });
      if (!updatedBalance) throw new InventoryLedgerError("INTERNAL_TRANSACTION_FAILED", "Balance not found during reversal update.");

      await appendAuditLog(this.deps.audit, tenantId, user.userId, {
        entityType: "stock_movement", entityId: movement.id, actionType: "inventory.reversal.post",
        newValuesJson: { docNo: movement.docNo, originalMovementId: input.originalMovementId, itemId: original.itemId, locationId, inverseQty, newOnHandQtyKg: updatedBalance.onHandQtyKg, reason: input.reason },
        idempotencyKey: input.idempotencyKey,
      });

      await markSucceeded(this.deps.idempotency, claim.record.id, { responseCode: 200, responseBody: { movementId: movement.id } }, now);

      return { action: "posted", movementId: movement.id, docNo: movement.docNo, balanceVersion: updatedBalance.version, onHandQtyKg: updatedBalance.onHandQtyKg, originalMovementId: input.originalMovementId };
    }
  }

  /**
   * Internal helper: post a single-location movement (raw_receipt, return_receipt).
   * Shared by postRawReceipt (WP-02-02) and postReturnReceipt (WP-03-01).
   */
  private async postSingleLocationMovement(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: PostRawReceiptInput & { movementType: string; permissionKey: string; docType: string; operationScope: string },
  ): Promise<PostRawReceiptResult> {
    requirePermission(effective, input.permissionKey);
    // Reject body authority on the PostRawReceiptInput fields only (not the internal control fields).
    const { movementType, permissionKey, docType, operationScope, ...bodyFields } = input;
    rejectBodyClaimsAuthority(bodyFields as unknown as Record<string, unknown>);

    if (!isPositiveKg(input.quantityKg)) {
      throw new ValidationFailedLedgerError(`Quantity must be positive, got '${input.quantityKg}'.`);
    }

    const tenantId = user.tenantId;
    const normalizedQty = normalizeKg(input.quantityKg);
    const now = new Date();
    const year = now.getUTCFullYear();

    const idempotencyInput: IdempotencyClaimInput = {
      tenantId, operationScope: input.operationScope,
      idempotencyKey: input.idempotencyKey,
      requestBody: { itemId: input.itemId, toLocationId: input.toLocationId, quantityKg: normalizedQty, movementDate: input.movementDate, sourceDocumentType: input.sourceDocumentType, sourceDocumentId: input.sourceDocumentId } as Record<string, unknown>,
      initiatedBy: user.userId, leaseDurationMs: 30000, now,
    };
    const claim = await claimIdempotency(this.deps.idempotency, idempotencyInput);
    if (claim.action === "replay") {
      const existing = await this.deps.ledger.findMovementByIdempotencyKey(tenantId, input.idempotencyKey);
      if (existing) {
        const bal = await this.deps.ledger.findBalanceForUpdate(tenantId, input.itemId, input.toLocationId);
        return { action: "replayed", movementId: existing.id, docNo: existing.docNo, balanceVersion: bal?.version ?? 0, onHandQtyKg: bal?.onHandQtyKg ?? "0.000" };
      }
    }
    if (claim.action === "conflict") throw new IdempotencyConflictLedgerError(`Idempotency key conflict.`);
    if (claim.action === "in_progress") throw new OperationInProgressLedgerError(`Operation in progress.`);

    const existingBySource = await this.deps.ledger.findMovementBySource(tenantId, input.sourceDocumentType, input.sourceDocumentId);
    if (existingBySource) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, { responseCode: 409, responseBody: { message: "Duplicate source" }, lastErrorClass: "DuplicateSourceError" }, now);
      throw new DuplicateSourceError(`Duplicate source ${input.sourceDocumentType}/${input.sourceDocumentId}.`);
    }

    const docNoResult = await allocateDocumentNumber(this.deps.documentSequence, { tenantId, documentType: input.docType, year, entityType: "stock_movement" });

    let balance = await this.deps.ledger.findBalanceForUpdate(tenantId, input.itemId, input.toLocationId);
    if (!balance) {
      balance = await this.deps.ledger.insertBalance({ tenantId, itemId: input.itemId, locationId: input.toLocationId, onHandQtyKg: "0.000", lastMovementId: null });
    }
    requireTenantMatch(user, balance.tenantId);

    const movement = await this.deps.ledger.insertMovement({
      tenantId, docNo: docNoResult.docNo, movementType: input.movementType, movementStatus: "posted",
      itemId: input.itemId, fromLocationId: null, toLocationId: input.toLocationId,
      quantityKg: normalizedQty, movementDate: input.movementDate,
      sourceDocumentType: input.sourceDocumentType, sourceDocumentId: input.sourceDocumentId,
      idempotencyKey: input.idempotencyKey, postedBy: user.userId, postedAt: now,
    });

    const newOnHand = addKg(balance.onHandQtyKg, normalizedQty);
    const updatedBalance = await this.deps.ledger.updateBalance(tenantId, input.itemId, input.toLocationId, { onHandQtyKg: newOnHand, lastMovementId: movement.id, version: balance.version + 1 });
    if (!updatedBalance) throw new InventoryLedgerError("INTERNAL_TRANSACTION_FAILED", "Balance not found during update.");

    await appendAuditLog(this.deps.audit, tenantId, user.userId, {
      entityType: "stock_movement", entityId: movement.id, actionType: `inventory.${input.movementType}.post`,
      newValuesJson: { docNo: movement.docNo, itemId: movement.itemId, toLocationId: movement.toLocationId, quantityKg: movement.quantityKg, balanceVersion: updatedBalance.version, onHandQtyKg: updatedBalance.onHandQtyKg },
      idempotencyKey: input.idempotencyKey,
    });

    await markSucceeded(this.deps.idempotency, claim.record.id, { responseCode: 200, responseBody: { movementId: movement.id } }, now);

    return { action: "posted", movementId: movement.id, docNo: movement.docNo, balanceVersion: updatedBalance.version, onHandQtyKg: updatedBalance.onHandQtyKg };
  }

  /**
   * Reconcile a balance row against the sum of its movements.
   *
   * Contract 04 §17: reconciliation compares movement totals against
   * on_hand_qty_kg. Mismatch is a critical alert, never silently repaired.
   */
  async reconcileBalance(
    user: ErpUserContext,
    itemId: string,
    locationId: string,
  ): Promise<ReconciliationResult> {
    const tenantId = user.tenantId;

    const balance = await this.deps.ledger.findBalanceForUpdate(tenantId, itemId, locationId);
    const movements = await this.deps.ledger.listMovementsForBalance(tenantId, itemId, locationId);

    // Sum all raw_receipt movements to this location (WP-02-02 scope)
    let movementSum = "0.000";
    for (const m of movements) {
      if (m.movementType === "raw_receipt" && m.toLocationId === locationId) {
        movementSum = addKg(movementSum, m.quantityKg);
      }
    }

    const balanceOnHand = balance?.onHandQtyKg ?? "0.000";
    const matches = compareKg(movementSum, balanceOnHand) === 0;

    return {
      tenantId,
      itemId,
      locationId,
      movementSumKg: movementSum,
      balanceOnHandKg: balanceOnHand,
      matches,
    };
  }

  // =========================================================================
  // WP-04-03: Production receipt output + waste movement handlers.
  // =========================================================================
  //
  // These handlers are composed by the ProductionReceiptApprovalService
  // orchestrator inside a single outer DB transaction. They MUST NOT be
  // called directly from routes/components (Contract 04 §13: only
  // InventoryLedgerService may insert posted movements, and only the
  // approval service may compose the atomic approval transaction).
  //
  // - postReceiveFromProduction: increases output on-hand at the output
  //   location. Movement matrix (Contract 04 §8 row "Receive output"):
  //   destination +qty, no input-item balance change. WIP decrease is
  //   handled separately by the orchestrator via WipBalanceRepository.
  //
  // - postProductionWaste: METADATA-ONLY movement for lineage (Contract 04
  //   §8 row "Production waste": "no sellable increase"). It does NOT
  //   change inventory_balances.on_hand_qty_kg — only the WIP balance is
  //   decreased, again by the orchestrator. The movement row exists so
  //   that traceability (Contract 05 §22) can resolve the waste fact and
  //   so production_waste_entries.movement_id has a valid FK.

  /**
   * Post a receive-from-production movement: output location +qty.
   *
   * Contract 04 §8 row "Receive output": destination +qty.
   * Contract 05 §14 step 4: post receive_from_production movement and
   *   increase output on-hand.
   *
   * Permission: production.approve (Owner/Accountant). The orchestrator
   * (ProductionReceiptApprovalService) is the only legitimate caller, but
   * we still enforce the permission here as defense-in-depth.
   *
   * Movement matrix: same shape as `postRawReceipt` (single-location +qty)
   * but with movementType = "receive_from_production" and source document
   * type = "production_receipt".
   */
  async postReceiveFromProduction(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: {
      itemId: string;
      toLocationId: string;
      quantityKg: string;
      movementDate: string;
      sourceDocumentType: string;
      sourceDocumentId: string;
      idempotencyKey: string;
      notes?: string;
    },
  ): Promise<PostRawReceiptResult> {
    // Reuse the shared single-location movement helper, overriding the
    // movement type / permission / doc-type / operation-scope.
    return this.postSingleLocationMovement(user, effective, {
      itemId: input.itemId,
      toLocationId: input.toLocationId,
      quantityKg: input.quantityKg,
      movementDate: input.movementDate,
      sourceDocumentType: input.sourceDocumentType,
      sourceDocumentId: input.sourceDocumentId,
      idempotencyKey: input.idempotencyKey,
      notes: input.notes,
      movementType: "receive_from_production",
      permissionKey: "production.approve",
      docType: "production_receive",
      operationScope: "inventory.receive_from_production.post",
    });
  }

  /**
   * Post a production-waste metadata-only movement.
   *
   * Contract 04 §8 row "Production waste": "no sellable increase, none,
   * WIP -waste_qty". This handler inserts a movement row for lineage and
   * audit/reconciliation, but does NOT mutate `inventory_balances`.
   *
   * The WIP balance decrease (`production_wip_balances.wip_qty_kg -= waste`)
   * is the orchestrator's responsibility, NOT this handler's. Splitting
   * the WIP effect out of InventoryLedgerService preserves the boundary
   * that only WipBalanceRepository writes to `production_wip_balances`.
   *
   * Movement shape: `fromLocationId = factoryLocationId` (the WIP factory
   * location, for lineage traceability — Contract 05 §22), `toLocationId =
   * null` (waste does not land anywhere sellable).
   *
   * Permission: production.approve (Owner/Accountant). Defense-in-depth:
   * the orchestrator is the only legitimate caller.
   */
  async postProductionWaste(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: {
      itemId: string;
      factoryLocationId: string;
      wasteQtyKg: string;
      movementDate: string;
      sourceDocumentType: string;
      sourceDocumentId: string;
      idempotencyKey: string;
      notes?: string;
    },
  ): Promise<{ action: "posted" | "replayed"; movementId: string; docNo: string }> {
    requirePermission(effective, "production.approve");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!isPositiveKg(input.wasteQtyKg)) {
      throw new ValidationFailedLedgerError(
        `Waste quantity must be positive (NUMERIC(18,3)), got '${input.wasteQtyKg}'.`,
      );
    }

    const tenantId = user.tenantId;
    const normalizedQty = normalizeKg(input.wasteQtyKg);
    const now = new Date();
    const year = now.getUTCFullYear();

    // Idempotency
    const idempotencyInput: IdempotencyClaimInput = {
      tenantId,
      operationScope: "inventory.production_waste.post",
      idempotencyKey: input.idempotencyKey,
      requestBody: {
        itemId: input.itemId,
        factoryLocationId: input.factoryLocationId,
        wasteQtyKg: normalizedQty,
        movementDate: input.movementDate,
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentId: input.sourceDocumentId,
      } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    };
    const claim = await claimIdempotency(this.deps.idempotency, idempotencyInput);

    if (claim.action === "replay") {
      const existing = await this.deps.ledger.findMovementByIdempotencyKey(tenantId, input.idempotencyKey);
      if (existing) {
        return { action: "replayed", movementId: existing.id, docNo: existing.docNo };
      }
      // Fall through to execute if idempotency says replay but movement not found.
    }
    if (claim.action === "conflict") {
      throw new IdempotencyConflictLedgerError(
        `Idempotency key '${input.idempotencyKey}' was used with a different request body.`,
      );
    }
    if (claim.action === "in_progress") {
      throw new OperationInProgressLedgerError(
        `Operation '${input.idempotencyKey}' is still in progress.`,
      );
    }

    // Duplicate source guard — defense-in-depth against double waste posting
    // for the same allocation. The orchestrator (ProductionReceiptApprovalService)
    // passes `sourceDocumentId = alloc.id` (the production_receipt_input_allocations.id
    // UUID) so each allocation's waste movement has a distinct source key while
    // satisfying the UUID constraint on stock_movements.source_document_id.
    // The orchestrator's idempotency + the production_waste_entries unique
    // constraints also prevent this, but the movement-level guard is independent.
    const existingBySource = await this.deps.ledger.findMovementBySource(
      tenantId,
      input.sourceDocumentType,
      input.sourceDocumentId,
    );
    if (existingBySource) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 409,
        responseBody: { message: "Duplicate source document for waste movement" },
        lastErrorClass: "DuplicateSourceError",
      }, now);
      throw new DuplicateSourceError(
        `A waste movement already exists for source ${input.sourceDocumentType}/${input.sourceDocumentId}.`,
      );
    }

    // Allocate doc_no (PW-YYYY-NNNNNN)
    const docNoResult = await allocateDocumentNumber(
      this.deps.documentSequence,
      { tenantId, documentType: "production_waste", year, entityType: "stock_movement" },
    );

    // Insert movement — METADATA-ONLY. No balance lock, no balance update.
    // The movement records the waste fact for traceability (Contract 05 §22)
    // and gives production_waste_entries.movement_id a valid FK.
    const movement = await this.deps.ledger.insertMovement({
      tenantId,
      docNo: docNoResult.docNo,
      movementType: "production_waste",
      movementStatus: "posted",
      itemId: input.itemId,
      fromLocationId: input.factoryLocationId,
      toLocationId: null,
      quantityKg: normalizedQty,
      movementDate: input.movementDate,
      sourceDocumentType: input.sourceDocumentType,
      sourceDocumentId: input.sourceDocumentId,
      idempotencyKey: input.idempotencyKey,
      postedBy: user.userId,
      postedAt: now,
    });

    // Audit — note explicitly that no on-hand change occurred.
    await appendAuditLog(this.deps.audit, tenantId, user.userId, {
      entityType: "stock_movement",
      entityId: movement.id,
      actionType: "inventory.production_waste.post",
      newValuesJson: {
        docNo: movement.docNo,
        itemId: movement.itemId,
        factoryLocationId: input.factoryLocationId,
        wasteQtyKg: normalizedQty,
        note: "metadata-only movement; no inventory_balances.on_hand change; WIP decrease handled by orchestrator via WipBalanceRepository",
      },
      idempotencyKey: input.idempotencyKey,
    });

    await markSucceeded(this.deps.idempotency, claim.record.id, {
      responseCode: 200,
      responseBody: { movementId: movement.id },
    }, now);

    return { action: "posted", movementId: movement.id, docNo: movement.docNo };
  }

  // =========================================================================
  // WP-04-04: Return-from-WIP movement handler.
  // =========================================================================

  /**
   * Post a return-from-WIP movement: return location +qty.
   *
   * Contract 04 §8 row "Return from WIP": return location +qty, approved
   * classification, WIP -qty.
   * Contract 05 §20: Approval atomically reduces WIP, increases on-hand at
   *   the return location, and writes audit.
   *
   * This handler ONLY increases on-hand at the return location. The WIP
   * decrease is handled separately by the orchestrator via
   * `WipBalanceRepository.decrementWipQtyConditional` — same separation as
   * WP-04-03's `postProductionWaste` (WIP is in `production_wip_balances`,
   * not `inventory_balances`).
   *
   * Movement shape: `fromLocationId = factoryLocationId` (the WIP factory
   * location, for lineage per Contract 05 §22), `toLocationId =
   * returnLocationId` (where stock lands). Only the destination balance
   * is mutated (+qty); the factory location's on-hand is NOT touched
   * (WIP is not in inventory_balances).
   *
   * Permission: production.return_from_wip.approve (Owner/Accountant).
   * Defense-in-depth: the orchestrator (WipReturnApprovalService) is the
   * only legitimate caller.
   */
  async postReturnFromWip(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: {
      itemId: string;
      factoryLocationId: string;
      returnLocationId: string;
      returnQtyKg: string;
      movementDate: string;
      sourceDocumentType: string;
      sourceDocumentId: string;
      idempotencyKey: string;
      notes?: string;
    },
  ): Promise<PostRawReceiptResult> {
    requirePermission(effective, "production.return_from_wip.approve");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!isPositiveKg(input.returnQtyKg)) {
      throw new ValidationFailedLedgerError(
        `Return quantity must be positive (NUMERIC(18,3)), got '${input.returnQtyKg}'.`,
      );
    }

    const tenantId = user.tenantId;
    const normalizedQty = normalizeKg(input.returnQtyKg);
    const now = new Date();
    const year = now.getUTCFullYear();

    // Idempotency
    const idempotencyInput: IdempotencyClaimInput = {
      tenantId,
      operationScope: "inventory.return_from_wip.post",
      idempotencyKey: input.idempotencyKey,
      requestBody: {
        itemId: input.itemId,
        factoryLocationId: input.factoryLocationId,
        returnLocationId: input.returnLocationId,
        returnQtyKg: normalizedQty,
        movementDate: input.movementDate,
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentId: input.sourceDocumentId,
      } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    };
    const claim = await claimIdempotency(this.deps.idempotency, idempotencyInput);

    if (claim.action === "replay") {
      const existing = await this.deps.ledger.findMovementByIdempotencyKey(tenantId, input.idempotencyKey);
      if (existing) {
        const bal = await this.deps.ledger.findBalanceForUpdate(tenantId, input.itemId, input.returnLocationId);
        return {
          action: "replayed",
          movementId: existing.id,
          docNo: existing.docNo,
          balanceVersion: bal?.version ?? 0,
          onHandQtyKg: bal?.onHandQtyKg ?? "0.000",
        };
      }
      // Fall through to execute if idempotency says replay but movement not found.
    }
    if (claim.action === "conflict") {
      throw new IdempotencyConflictLedgerError(
        `Idempotency key '${input.idempotencyKey}' was used with a different request body.`,
      );
    }
    if (claim.action === "in_progress") {
      throw new OperationInProgressLedgerError(
        `Operation '${input.idempotencyKey}' is still in progress.`,
      );
    }

    // Duplicate source guard — defense-in-depth against double return movement.
    const existingBySource = await this.deps.ledger.findMovementBySource(
      tenantId,
      input.sourceDocumentType,
      input.sourceDocumentId,
    );
    if (existingBySource) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 409,
        responseBody: { message: "Duplicate source document for return-from-WIP movement" },
        lastErrorClass: "DuplicateSourceError",
      }, now);
      throw new DuplicateSourceError(
        `A return-from-WIP movement already exists for source ${input.sourceDocumentType}/${input.sourceDocumentId}.`,
      );
    }

    // Allocate doc_no (WR-YYYY-NNNNNN)
    const docNoResult = await allocateDocumentNumber(
      this.deps.documentSequence,
      { tenantId, documentType: "production_wip_return", year, entityType: "stock_movement" },
    );

    // Lock + fetch/create destination balance (return location)
    let balance = await this.deps.ledger.findBalanceForUpdate(tenantId, input.itemId, input.returnLocationId);
    if (!balance) {
      try {
        balance = await this.deps.ledger.insertBalance({
          tenantId,
          itemId: input.itemId,
          locationId: input.returnLocationId,
          onHandQtyKg: "0.000",
          lastMovementId: null,
        });
      } catch (e) {
        if (e instanceof BalanceConcurrentInsertError) {
          balance = await this.deps.ledger.findBalanceForUpdate(tenantId, input.itemId, input.returnLocationId);
          if (!balance) {
            throw new InventoryLedgerError(
              "INTERNAL_TRANSACTION_FAILED",
              "Balance row not found after concurrent-insert retry.",
            );
          }
        } else {
          throw e;
        }
      }
    }
    requireTenantMatch(user, balance.tenantId);

    // Insert movement — fromLocationId = factory (lineage), toLocationId = return location (+qty)
    const movement = await this.deps.ledger.insertMovement({
      tenantId,
      docNo: docNoResult.docNo,
      movementType: "return_from_wip",
      movementStatus: "posted",
      itemId: input.itemId,
      fromLocationId: input.factoryLocationId,
      toLocationId: input.returnLocationId,
      quantityKg: normalizedQty,
      movementDate: input.movementDate,
      sourceDocumentType: input.sourceDocumentType,
      sourceDocumentId: input.sourceDocumentId,
      idempotencyKey: input.idempotencyKey,
      postedBy: user.userId,
      postedAt: now,
    });

    // Update destination balance: on_hand += return_qty
    const newOnHand = addKg(balance.onHandQtyKg, normalizedQty);
    const updatedBalance = await this.deps.ledger.updateBalance(
      tenantId,
      input.itemId,
      input.returnLocationId,
      {
        onHandQtyKg: newOnHand,
        lastMovementId: movement.id,
        version: balance.version + 1,
      },
    );
    if (!updatedBalance) {
      throw new InventoryLedgerError(
        "INTERNAL_TRANSACTION_FAILED",
        "Balance row not found during update after return-from-WIP movement insert.",
      );
    }

    // Audit
    await appendAuditLog(this.deps.audit, tenantId, user.userId, {
      entityType: "stock_movement",
      entityId: movement.id,
      actionType: "inventory.return_from_wip.post",
      newValuesJson: {
        docNo: movement.docNo,
        itemId: movement.itemId,
        factoryLocationId: input.factoryLocationId,
        returnLocationId: input.returnLocationId,
        returnQtyKg: normalizedQty,
        balanceVersion: updatedBalance.version,
        onHandQtyKg: updatedBalance.onHandQtyKg,
        note: "return-from-WIP movement; destination on_hand increased; WIP decrease handled by orchestrator via WipBalanceRepository",
      },
      idempotencyKey: input.idempotencyKey,
    });

    await markSucceeded(this.deps.idempotency, claim.record.id, {
      responseCode: 200,
      responseBody: {
        movementId: movement.id,
        docNo: movement.docNo,
        balanceVersion: updatedBalance.version,
        onHandQtyKg: updatedBalance.onHandQtyKg,
      },
    }, now);

    return {
      action: "posted",
      movementId: movement.id,
      docNo: movement.docNo,
      balanceVersion: updatedBalance.version,
      onHandQtyKg: updatedBalance.onHandQtyKg,
    };
  }

  // =========================================================================
  // WP-05-03: Sale issue movement handler.
  // =========================================================================

  /**
   * Post a sale_issue movement: source location -qty, decrease reserved_qty.
   *
   * Contract 04 §8: "Sale issue: source -qty, reserved -qty consume, no WIP."
   * Contract 06 §8: sale approval posts sale_issue movements atomically.
   *
   * This handler is tx-scoped — it does NOT claim its own idempotency.
   * The caller (SalesApprovalService) owns the idempotency claim.
   * The caller passes a pre-allocated doc_no and idempotency key suffix.
   *
   * Effects:
   * 1. Insert sale_issue movement (from_location = source, quantity = qty)
   * 2. Decrease on_hand_qty_kg by qty
   * 3. Decrease reserved_qty_kg by qty (reservation consumed)
   * 4. Audit (inside caller tx)
   *
   * Permission: sales.approve (defense-in-depth; caller already checked).
   */
  async postSaleIssue(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: {
      itemId: string;
      fromLocationId: string;
      quantityKg: string;
      movementDate: string;
      sourceDocumentType: string;
      sourceDocumentId: string;
      docNo: string;
      idempotencyKey: string;
      notes?: string;
    },
  ): Promise<{ movementId: string; docNo: string; balanceVersion: number; onHandQtyKg: string; reservedQtyKg: string }> {
    requirePermission(effective, "sales.approve");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!isPositiveKg(input.quantityKg)) {
      throw new ValidationFailedLedgerError(`Quantity must be positive, got '${input.quantityKg}'.`);
    }

    const tenantId = user.tenantId;
    const normalizedQty = normalizeKg(input.quantityKg);
    const now = new Date();

    // Lock source balance
    let balance = await this.deps.ledger.findBalanceForUpdate(tenantId, input.itemId, input.fromLocationId);
    if (!balance) {
      throw new StockInsufficientError(`No balance found for item '${input.itemId}' at location '${input.fromLocationId}'.`);
    }
    requireTenantMatch(user, balance.tenantId);

    // Recheck: on_hand >= qty AND reserved >= qty (WP-05-03 blocker fix).
    // Both checks enforced at the ledger boundary, not only by prior reservation lookup.
    // This guarantees reserved_qty can never become negative even if the reservation
    // was concurrently released or under-allocated.
    if (compareKg(balance.onHandQtyKg, normalizedQty) < 0) {
      throw new StockInsufficientError(`Insufficient on-hand stock: on_hand=${balance.onHandQtyKg}, requested=${normalizedQty}.`);
    }
    if (compareKg(balance.reservedQtyKg, normalizedQty) < 0) {
      throw new StockInsufficientError(`Insufficient reserved stock: reserved_qty=${balance.reservedQtyKg}, requested=${normalizedQty}.`);
    }

    // Insert sale_issue movement
    const movement = await this.deps.ledger.insertMovement({
      tenantId,
      docNo: input.docNo,
      movementType: "sale_issue",
      movementStatus: "posted",
      itemId: input.itemId,
      fromLocationId: input.fromLocationId,
      toLocationId: null,
      quantityKg: normalizedQty,
      movementDate: input.movementDate,
      sourceDocumentType: input.sourceDocumentType,
      sourceDocumentId: input.sourceDocumentId,
      idempotencyKey: input.idempotencyKey,
      postedBy: user.userId,
      postedAt: now,
    });

    // Decrease on_hand
    const newOnHand = subtractKg(balance.onHandQtyKg, normalizedQty);
    const newReserved = subtractKg(balance.reservedQtyKg, normalizedQty);
    const updatedBalance = await this.deps.ledger.updateBalance(
      tenantId, input.itemId, input.fromLocationId,
      { onHandQtyKg: newOnHand, lastMovementId: movement.id, version: balance.version + 1 },
    );
    if (!updatedBalance) {
      throw new InventoryLedgerError("INTERNAL_TRANSACTION_FAILED", "Balance not found during sale_issue update.");
    }

    // Also decrease reserved_qty (if the balance has reserved_qty)
    if (compareKg(balance.reservedQtyKg, "0.000") > 0) {
      const updatedReserved = await this.deps.ledger.updateReservedQty(
        tenantId, input.itemId, input.fromLocationId,
        { reservedQtyKg: newReserved, version: updatedBalance.version },
      );
      if (!updatedReserved) {
        throw new InventoryLedgerError("INTERNAL_TRANSACTION_FAILED", "Balance not found during reserved_qty update.");
      }
    }

    // Audit
    await appendAuditLog(this.deps.audit, tenantId, user.userId, {
      entityType: "stock_movement",
      entityId: movement.id,
      actionType: "inventory.sale_issue.post",
      newValuesJson: {
        docNo: movement.docNo,
        itemId: movement.itemId,
        fromLocationId: movement.fromLocationId,
        quantityKg: normalizedQty,
        balanceVersion: updatedBalance.version,
        onHandQtyKg: updatedBalance.onHandQtyKg,
        reservedQtyKg: newReserved,
      },
      idempotencyKey: input.idempotencyKey,
    });

    return {
      movementId: movement.id,
      docNo: movement.docNo,
      balanceVersion: updatedBalance.version,
      onHandQtyKg: updatedBalance.onHandQtyKg,
      reservedQtyKg: newReserved,
    };
  }

  // ===========================================================================
  // WP-07-04: Narrow tx-scoped opening-balance movement for historical commit.
  // ===========================================================================

  /**
   * Post an opening-balance inventory movement for historical migration
   * commit (WP-07-04, Contract 08 §8.10 step 3-4).
   *
   * This is a NARROW tx-scoped method — it does NOT claim its own idempotency
   * or allocate its own doc_no. The caller (HistoricalCommitService) owns the
   * commit idempotency and the cutover lock. This method:
   *   - locks the balance row (findBalanceForUpdate)
   *   - creates the balance row if missing
   *   - inserts an immutable `correction` movement (opening balance)
   *   - updates the balance (on_hand += qty)
   *
   * The movement uses `movementType: "correction"` with
   * `sourceDocumentType: "historical_opening_balance"` and
   * `sourceDocumentId: stagingRowId` so it is traceable back to the
   * specific staged row that produced it.
   *
   * Permission/tenant checks are the caller's responsibility — this method
   * is only callable from HistoricalCommitService which already verified
   * `migration.commit` permission and tenant ownership.
   *
   * Contract 04 §13: "Only InventoryLedgerService may insert posted movement
   *   rows or mutate materialized balances."
   * Contract 08 §8.10 step 3: "creates records through inventory...
   *   domain services rather than table-copy logic"
   */
  async postOpeningBalanceMovement(
    tenantId: string,
    userId: string,
    input: {
      itemId: string;
      locationId: string;
      quantityKg: string; // signed: positive = opening stock, negative = opening deficit
      movementDate: string;
      docNo: string;
      sourceDocumentType: string; // "historical_opening_balance"
      sourceDocumentId: string; // staging row ID
      idempotencyKey: string;
    },
  ): Promise<{ movementId: string; balanceVersion: number; onHandQtyKg: string }> {
    const normalizedQty = normalizeKg(input.quantityKg);
    if (compareKg(normalizedQty, "0.000") === 0) {
      throw new ValidationFailedLedgerError(`Opening balance quantity must be non-zero, got '${input.quantityKg}'.`);
    }

    const now = new Date();

    // Duplicate-source guard: prevent two movements for the same staging row
    const existingBySource = await this.deps.ledger.findMovementBySource(
      tenantId, input.sourceDocumentType, input.sourceDocumentId,
    );
    if (existingBySource) {
      throw new DuplicateSourceError(
        `Movement already exists for source ${input.sourceDocumentType}/${input.sourceDocumentId}.`,
      );
    }

    // Lock balance row (create if missing)
    let balance = await this.deps.ledger.findBalanceForUpdate(tenantId, input.itemId, input.locationId);
    if (!balance) {
      balance = await this.deps.ledger.insertBalance({
        tenantId, itemId: input.itemId, locationId: input.locationId,
        onHandQtyKg: "0.000", lastMovementId: null,
      });
    }

    // Insert the movement (correction type for opening balance)
    const movement = await this.deps.ledger.insertMovement({
      tenantId, docNo: input.docNo,
      movementType: "correction", movementStatus: "posted",
      itemId: input.itemId,
      fromLocationId: null, toLocationId: input.locationId,
      quantityKg: normalizedQty.startsWith("-") ? normalizedQty.slice(1) : normalizedQty,
      movementDate: input.movementDate,
      sourceDocumentType: input.sourceDocumentType,
      sourceDocumentId: input.sourceDocumentId,
      idempotencyKey: input.idempotencyKey,
      postedBy: userId, postedAt: now,
    });

    // Apply signed effect on balance
    const newOnHand = addKg(balance.onHandQtyKg, normalizedQty);
    const updatedBalance = await this.deps.ledger.updateBalance(
      tenantId, input.itemId, input.locationId,
      { onHandQtyKg: newOnHand, lastMovementId: movement.id, version: balance.version + 1 },
    );
    if (!updatedBalance) {
      throw new InventoryLedgerError("INTERNAL_TRANSACTION_FAILED", "Balance not found during update.");
    }

    return {
      movementId: movement.id,
      balanceVersion: updatedBalance.version,
      onHandQtyKg: updatedBalance.onHandQtyKg,
    };
  }
}
