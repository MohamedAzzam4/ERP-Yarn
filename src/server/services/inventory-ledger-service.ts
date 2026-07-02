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
import { addKg, compareKg, isPositiveKg, normalizeKg } from "./decimal-kg";
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

  /** List all movements for an item/location (for reconciliation). */
  listMovementsForBalance(tenantId: string, itemId: string, locationId: string): Promise<StockMovement[]>;
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
  toLocationId: string;
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
  lastMovementId: string;
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

    // Step 4-5: lock balance row (deterministic order), create if missing
    let balance = await this.deps.ledger.findBalanceForUpdate(tenantId, input.itemId, input.toLocationId);
    if (!balance) {
      // Create a new balance row with zero on-hand
      balance = await this.deps.ledger.insertBalance({
        tenantId,
        itemId: input.itemId,
        locationId: input.toLocationId,
        onHandQtyKg: "0.000",
        lastMovementId: "00000000-0000-0000-0000-000000000000", // placeholder; updated after movement insert
      });
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

  /**
   * Reconcile a balance row against the sum of its movements.
   *
   * Contract 04 §17: reconciliation compares movement totals against
   * on_hand_qty_kg. Mismatch is a critical alert, never silently repaired.
   *
   * For raw receipt (WP-02-02 scope), the movement sum is the sum of all
   * raw_receipt movements to this location for this item. Later packages
   * will extend this to handle transfers (source -qty), adjustments, etc.
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
}
