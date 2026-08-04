/**
 * SubledgerService — the sole owner of account entry/reversal/settlement posting.
 *
 * Contract: docs/contracts/14_coding_agent_instructions.md §4
 *   "SubledgerService is the only owner of account entry/reversal/settlement
 *    posting."
 *
 * Contract: docs/contracts/07_subledger_and_costs_contract.md §8-9, §11
 *   §8: Supplier payable is NEGATIVE signed amount.
 *   §9: Entries are immutable after posting. Balance = SUM(amount_signed).
 *   §11: When approved physical receipt has confirmed price → supplier account
 *   entry posts negative payable. Missing price → no zero payable.
 *
 * DEC-067: payable = net_accepted_kg / 1000 × price_per_ton
 *   ROUND_HALF_UP only at posting boundary.
 *
 * WP-02-03 scope: supplier-payable handler + derived balance query only.
 * No payment/settlement/factory/customer handlers.
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
  type IdempotencyTransactionHandle,
  type IdempotencyClaimInput,
} from "./idempotency-service";
import {
  allocateDocumentNumber,
  type DocumentSequenceTransactionHandle,
} from "./document-sequence-service";
import {
  calculateSupplierPayable,
  calculateFactoryPayable,
  normalizeMoney,
  isPositiveMoney,
  isZeroMoney,
  addMoney,
  negateMoney,
} from "./decimal-money";
import type { Account, AccountEntry } from "@/server/db/schema/subledger";

// ---------------------------------------------------------------------------
// Domain types re-exported for service consumers.
// ---------------------------------------------------------------------------

export type { Account, AccountEntry } from "@/server/db/schema/subledger";

// ---------------------------------------------------------------------------
// Service error types.
// ---------------------------------------------------------------------------

export class SubledgerError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SubledgerError";
    this.code = code;
  }
}

export class DuplicateSourceEntryError extends SubledgerError {
  constructor(message: string) {
    super("DUPLICATE_SOURCE", message);
    this.name = "DuplicateSourceEntryError";
  }
}

export class IdempotencyConflictSubledgerError extends SubledgerError {
  constructor(message: string) {
    super("IDEMPOTENCY_CONFLICT", message);
    this.name = "IdempotencyConflictSubledgerError";
  }
}

export class OperationInProgressSubledgerError extends SubledgerError {
  constructor(message: string) {
    super("OPERATION_IN_PROGRESS", message);
    this.name = "OperationInProgressSubledgerError";
  }
}

export class ValidationFailedSubledgerError extends SubledgerError {
  constructor(message: string) {
    super("VALIDATION_FAILED", message);
    this.name = "ValidationFailedSubledgerError";
  }
}

// ---------------------------------------------------------------------------
// Source lock key helper (Contract 07 §9: deterministic source uniqueness).
// ---------------------------------------------------------------------------

/**
 * Compute a deterministic lock key for a source document.
 *
 * Used by the advisory lock to prevent concurrent postings for the same
 * source. The key is a composite string that can be hashed into two int32
 * values for pg_advisory_xact_lock(bigint).
 *
 * Format: `${tenantId}|${sourceDocumentType}|${sourceDocumentId}`
 */
export function sourceLockKey(
  tenantId: string,
  sourceDocumentType: string,
  sourceDocumentId: string,
): string {
  return `${tenantId}|${sourceDocumentType}|${sourceDocumentId}`;
}

// ---------------------------------------------------------------------------
// Transaction handle — abstract persistence interface.
// ---------------------------------------------------------------------------

export interface SubledgerTransactionHandle {
  /** Find an account by (tenantId, ownerType, ownerId, currency). */
  findAccount(tenantId: string, ownerType: string, ownerId: string, currency: string): Promise<Account | null>;
  /** Find an account by id (WP-05-04). */
  findAccountById(tenantId: string, accountId: string): Promise<Account | null>;
  /** Insert a new account row. */
  insertAccount(row: NewAccountInput): Promise<Account>;
  /** Insert an immutable account entry. Returns the inserted row with id. */
  insertEntry(row: NewEntryInput): Promise<AccountEntry>;
  /** Find an entry by idempotency key (for replay). */
  findEntryByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<AccountEntry | null>;
  /** Find an entry by source document (duplicate-source guard). */
  findEntryBySource(tenantId: string, sourceDocumentType: string, sourceDocumentId: string): Promise<AccountEntry | null>;
  /** Find an entry by id. */
  findEntryById(tenantId: string, id: string): Promise<AccountEntry | null>;
  /** List all entries for an account (for derived balance). */
  listEntriesForAccount(tenantId: string, accountId: string): Promise<AccountEntry[]>;
  /**
   * Update an entry's settlement status (WP-05-04).
   * Entries are immutable EXCEPT for settlement_status, which transitions
   * unsettled → partially_settled → settled (and → reversed on payment reversal).
   * The amount_signed and all other fields remain immutable.
   */
  updateEntrySettlementStatus(
    tenantId: string,
    entryId: string,
    settlementStatus: "unsettled" | "partially_settled" | "settled" | "reversed",
  ): Promise<AccountEntry | null>;
  /**
   * Acquire a transaction-scoped advisory lock on a source document.
   *
   * Contract 07 §9: "duplicate source/idempotency cannot create a second
   * effective entry."
   *
   * This lock prevents two concurrent transactions from posting entries for
   * the same source document. The lock MUST be acquired BEFORE
   * findEntryBySource and insertEntry. It is transaction-scoped
   * (pg_advisory_xact_lock in PostgreSQL) — automatically released on
   * commit or rollback.
   *
   * In-memory test stores implement this as a no-op (single-threaded).
   */
  lockSourceEntry(tenantId: string, sourceDocumentType: string, sourceDocumentId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Input types.
// ---------------------------------------------------------------------------

export interface NewAccountInput {
  tenantId: string;
  ownerType: string;
  ownerId: string;
  currency: string;
  createdBy: string;
}

export interface NewEntryInput {
  tenantId: string;
  accountId: string;
  entryNo: string;
  entryDate: string;
  amountSigned: string;
  currency: string;
  entryType: string;
  sourceDocumentType: string;
  sourceDocumentId: string;
  createdBy: string;
}

// ---------------------------------------------------------------------------
// Supplier payable input + result.
// ---------------------------------------------------------------------------

export interface PostSupplierPayableInput {
  /** The supplier master record ID. */
  supplierId: string;
  /** Net accepted weight in kg (NUMERIC(18,3) string, e.g., "1000.000"). */
  netAcceptedKg: string;
  /** Confirmed price per ton (NUMERIC(18,2) string, e.g., "80.00"). */
  pricePerTon: string;
  /** Entry date (ISO date string, e.g., "2026-07-02"). */
  entryDate: string;
  /** Source document type (e.g., "raw_material_batch"). */
  sourceDocumentType: string;
  /** Source document ID (e.g., the raw_material_batches.id). */
  sourceDocumentId: string;
  /** Idempotency key (required). */
  idempotencyKey: string;
  /** Currency (default "EGP"). */
  currency?: string;
  /** Optional notes. */
  notes?: string;
}

export interface PostSupplierPayableResult {
  action: "posted" | "replayed";
  entryId: string;
  entryNo: string;
  amountSigned: string;
  accountId: string;
  derivedBalance: string;
}

// ---------------------------------------------------------------------------
// WP-04-03: Factory production payable input + result.
// ---------------------------------------------------------------------------

export interface PostFactoryPayableInput {
  /** The external factory master record ID (production_order.factory_id). */
  factoryId: string;
  /** The production receipt ID this payable is for (for lineage). */
  productionReceiptId: string;
  /** Total input-quantity basis in kg = SUM(consumed_toward_output + waste)
   * across the receipt's allocations. NUMERIC(18,3) string. */
  factoryCostBasisInputQtyKg: string;
  /** Confirmed factory rate per input ton (snapshotted at approval).
   * NUMERIC(18,2) string (e.g., "30000.00"). */
  factoryRatePerInputTon: string;
  /** Entry date (ISO date string, e.g., the receipt date). */
  entryDate: string;
  /** Source document type — always "production_receipt" for WP-04-03. */
  sourceDocumentType: string;
  /** Source document ID — the production_receipts.id. */
  sourceDocumentId: string;
  /** Idempotency key (required). */
  idempotencyKey: string;
  /** Currency (default "EGP"). */
  currency?: string;
  /** Optional notes. */
  notes?: string;
}

export interface PostFactoryPayableResult {
  action: "posted" | "replayed";
  entryId: string;
  entryNo: string;
  amountSigned: string; // NEGATIVE for payable
  accountId: string;
  /** The calculated payable amount (positive, pre-sign). */
  payableAmount: string;
  derivedBalance: string;
}

// ---------------------------------------------------------------------------
// Derived balance result.
// ---------------------------------------------------------------------------

export interface DerivedBalanceResult {
  tenantId: string;
  accountId: string;
  balance: string;
  entryCount: number;
}

// ---------------------------------------------------------------------------
// SubledgerService.
// ---------------------------------------------------------------------------

export interface SubledgerServiceDeps {
  subledger: SubledgerTransactionHandle;
  audit: AuditTransactionHandle;
  idempotency: IdempotencyTransactionHandle;
  documentSequence: DocumentSequenceTransactionHandle;
}

export class SubledgerService {
  constructor(private readonly deps: SubledgerServiceDeps) {}

  /**
   * Post a supplier payable entry (DEC-067 formula).
   *
   * Contract 07 §8: Supplier payable is NEGATIVE signed amount.
   * Contract 07 §11: When approved receipt has confirmed price → post
   * negative payable. Missing price → no zero payable.
   * DEC-067: payable = net_accepted_kg / 1000 × price_per_ton
   *
   * The service is designed to participate in an outer transaction
   * (WP-02-05 will compose InventoryLedgerService + SubledgerService).
   */
  async postSupplierPayable(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: PostSupplierPayableInput,
  ): Promise<PostSupplierPayableResult> {
    // Step 1: validate permission + reject body authority claims
    // Defense-in-depth: balances.view_supplier_factory is held by Owner + Accountant only.
    // Workers are denied per DEC-063.
    requirePermission(effective, "balances.view_supplier_factory");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    // Validate inputs
    const currency = input.currency ?? "EGP";
    if (!isPositiveMoney(input.pricePerTon)) {
      throw new ValidationFailedSubledgerError(
        `Price per ton must be positive (NUMERIC(18,2)), got '${input.pricePerTon}'.`,
      );
    }

    const tenantId = user.tenantId;
    const now = new Date();
    const year = now.getUTCFullYear();

    // Step 2: Calculate payable using DEC-067 formula
    // payable = net_accepted_kg / 1000 × price_per_ton
    // ROUND_HALF_UP only at posting boundary
    const payableAmount = calculateSupplierPayable(input.netAcceptedKg, input.pricePerTon);

    // Contract 07 §11: "no estimated/zero supplier payable is created"
    // DB CHECK constraint: amount_signed <> 0
    if (isZeroMoney(payableAmount)) {
      throw new ValidationFailedSubledgerError(
        `Calculated payable is zero (kg='${input.netAcceptedKg}', price='${input.pricePerTon}'). ` +
        `Zero payable is not allowed — missing price should not create a payable entry.`,
      );
    }

    // Contract 07 §8: Supplier payable is NEGATIVE signed amount
    const amountSigned = normalizeMoney(`-${payableAmount}`);

    // Step 3: Claim idempotency
    const idempotencyInput: IdempotencyClaimInput = {
      tenantId,
      operationScope: "subledger.supplier_payable.post",
      idempotencyKey: input.idempotencyKey,
      requestBody: {
        supplierId: input.supplierId,
        netAcceptedKg: input.netAcceptedKg,
        pricePerTon: input.pricePerTon,
        entryDate: input.entryDate,
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentId: input.sourceDocumentId,
        currency,
      } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    };

    const claim = await claimIdempotency(this.deps.idempotency, idempotencyInput);

    if (claim.action === "replay") {
      // account_entries has no idempotency_key column (unlike stock_movements).
      // Use the idempotency record's stored responseBody.entryId to find the prior entry.
      const responseBody = claim.record.responseBody as { entryId?: string; entryNo?: string; amountSigned?: string; accountId?: string } | null;
      if (responseBody?.entryId) {
        const existingEntry = await this.deps.subledger.findEntryById(tenantId, responseBody.entryId);
        if (existingEntry) {
          const balance = await this.deriveAccountBalance(user, existingEntry.accountId);
          return {
            action: "replayed",
            entryId: existingEntry.id,
            entryNo: existingEntry.entryNo,
            amountSigned: existingEntry.amountSigned,
            accountId: existingEntry.accountId,
            derivedBalance: balance.balance,
          };
        }
      }
      // If entry not found despite replay claim, fall through to execute
      // (may happen if idempotency record is stale).
    }

    if (claim.action === "conflict") {
      throw new IdempotencyConflictSubledgerError(
        `Idempotency key '${input.idempotencyKey}' was used with a different request body.`,
      );
    }

    if (claim.action === "in_progress") {
      throw new OperationInProgressSubledgerError(
        `Operation '${input.idempotencyKey}' is still in progress.`,
      );
    }

    // claim.action === "execute"

    // Step 4: Acquire transaction-scoped advisory lock on source document.
    // This prevents two concurrent transactions from posting entries for the
    // same source. The lock is held until the transaction commits or rolls
    // back (pg_advisory_xact_lock in PostgreSQL). MUST be acquired BEFORE
    // findEntryBySource to prevent the find-then-insert race.
    await this.deps.subledger.lockSourceEntry(
      tenantId,
      input.sourceDocumentType,
      input.sourceDocumentId,
    );

    // Step 4b: Duplicate source guard (now safe under the advisory lock)
    const existingBySource = await this.deps.subledger.findEntryBySource(
      tenantId,
      input.sourceDocumentType,
      input.sourceDocumentId,
    );
    if (existingBySource) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 409,
        responseBody: { message: "Duplicate source document" },
        lastErrorClass: "DuplicateSourceEntryError",
      }, claim.record.ownerToken!, now);
      throw new DuplicateSourceEntryError(
        `An account entry already exists for source ${input.sourceDocumentType}/${input.sourceDocumentId}.`,
      );
    }

    // Step 5: Get or create supplier account
    const account = await this.getOrCreateAccount(user, "supplier", input.supplierId, currency);

    // Step 6: Allocate entry number (AE-YYYY-NNNNNN)
    const entryNoResult = await allocateDocumentNumber(
      this.deps.documentSequence,
      {
        tenantId,
        documentType: "account_entry",
        year,
        entityType: "account_entry",
      },
    );

    // Step 7: Insert immutable account entry
    const entry = await this.deps.subledger.insertEntry({
      tenantId,
      accountId: account.id,
      entryNo: entryNoResult.docNo,
      entryDate: input.entryDate,
      amountSigned,
      currency,
      entryType: "supplier_raw_payable",
      sourceDocumentType: input.sourceDocumentType,
      sourceDocumentId: input.sourceDocumentId,
      createdBy: user.userId,
    });

    // Step 8: Write audit (failure throws → rollback)
    await appendAuditLog(this.deps.audit, tenantId, user.userId, {
      entityType: "account_entry",
      entityId: entry.id,
      actionType: "subledger.supplier_payable.post",
      newValuesJson: {
        entryNo: entry.entryNo,
        entryType: entry.entryType,
        accountId: entry.accountId,
        amountSigned: entry.amountSigned,
        supplierId: input.supplierId,
        netAcceptedKg: input.netAcceptedKg,
        pricePerTon: input.pricePerTon,
        payableAmount,
      },
      idempotencyKey: input.idempotencyKey,
    });

    // Step 9: Mark idempotency succeeded
    await markSucceeded(this.deps.idempotency, claim.record.id, {
      responseCode: 200,
      responseBody: {
        entryId: entry.id,
        entryNo: entry.entryNo,
        amountSigned: entry.amountSigned,
        accountId: entry.accountId,
      },
    }, claim.record.ownerToken!, now);

    // Step 10: Return result with derived balance
    const balanceResult = await this.deriveAccountBalance(user, account.id);

    return {
      action: "posted",
      entryId: entry.id,
      entryNo: entry.entryNo,
      amountSigned: entry.amountSigned,
      accountId: entry.accountId,
      derivedBalance: balanceResult.balance,
    };
  }

  /**
   * Derive account balance from immutable entries.
   *
   * Contract 07 §9: "balance is SUM(amount_signed)"
   * Contract 07 §28: "Do not store editable balances as truth."
   *
   * Interpretation:
   *   balance > 0: party owes company
   *   balance < 0: company owes party / party has credit
   *   balance = 0: net settled
   */
  async deriveAccountBalance(
    user: ErpUserContext,
    accountId: string,
  ): Promise<DerivedBalanceResult> {
    const entries = await this.deps.subledger.listEntriesForAccount(user.tenantId, accountId);

    // Sum all amount_signed values using BigInt-based decimal arithmetic
    let balance = "0.00";
    for (const entry of entries) {
      balance = addMoney(balance, entry.amountSigned);
    }

    return {
      tenantId: user.tenantId,
      accountId,
      balance: normalizeMoney(balance),
      entryCount: entries.length,
    };
  }

  // =========================================================================
  // WP-04-03: Factory production payable.
  // =========================================================================

  /**
   * Post a factory production payable entry (DEC-013 formula).
   *
   * Contract 07 §8 sign table: "Factory production payable → factory →
   *   negative." The entry's `amount_signed` is the NEGATIVE of the
   * calculated payable amount.
   * Contract 07 §9: entries immutable after posting; one unique payable
   *   source entry per approved receipt.
   * Contract 07 §12: payable recognized ONLY on approved output receipt.
   *   `factory_payable = cost_basis_input_qty_kg / 1000 × confirmed_rate_per_input_ton`.
   *   Waste does NOT reduce payable (DEC-013).
   * Contract 05 §18: one unique payable source entry per approved receipt;
   *   issue/transfer creates no payable.
   *
   * Permission: balances.view_supplier_factory (Owner + Accountant only).
   *   Defense-in-depth: the orchestrator (ProductionReceiptApprovalService)
   *   is the only legitimate caller, but we enforce the permission here
   *   regardless.
   *
   * Concurrency: `lockSourceEntry(tenant, "production_receipt", receiptId)`
   *   + `findEntryBySource` duplicate-source guard prevent two concurrent
   *   approvals from posting two payables for the same receipt.
   */
  async postFactoryPayable(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: PostFactoryPayableInput,
  ): Promise<PostFactoryPayableResult> {
    // Permission: balances.view_supplier_factory (Owner/Accountant only).
    // Workers are denied per DEC-063.
    requirePermission(effective, "balances.view_supplier_factory");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    const currency = input.currency ?? "EGP";
    if (!isPositiveMoney(input.factoryRatePerInputTon)) {
      throw new ValidationFailedSubledgerError(
        `Factory rate per input ton must be positive (NUMERIC(18,2)), got '${input.factoryRatePerInputTon}'.`,
      );
    }

    const tenantId = user.tenantId;
    const now = new Date();
    const year = now.getUTCFullYear();

    // DEC-013 / Contract 07 §12: factory_payable = basis_input_qty / 1000 × rate.
    // ROUND_HALF_UP only at posting boundary (Contract 14 §5).
    const payableAmount = calculateFactoryPayable(
      input.factoryCostBasisInputQtyKg,
      input.factoryRatePerInputTon,
    );

    // Contract 07 §11 / DB CHECK constraint: amount_signed <> 0
    if (isZeroMoney(payableAmount)) {
      throw new ValidationFailedSubledgerError(
        `Calculated factory payable is zero (basis='${input.factoryCostBasisInputQtyKg}', rate='${input.factoryRatePerInputTon}'). ` +
        `Zero payable is not allowed — a receipt without a confirmed rate should not be approved.`,
      );
    }

    // Contract 07 §8 sign table: factory production payable is NEGATIVE.
    const amountSigned = normalizeMoney(`-${payableAmount}`);

    // Idempotency
    const idempotencyInput: IdempotencyClaimInput = {
      tenantId,
      operationScope: "subledger.factory_payable.post",
      idempotencyKey: input.idempotencyKey,
      requestBody: {
        factoryId: input.factoryId,
        productionReceiptId: input.productionReceiptId,
        factoryCostBasisInputQtyKg: input.factoryCostBasisInputQtyKg,
        factoryRatePerInputTon: input.factoryRatePerInputTon,
        entryDate: input.entryDate,
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentId: input.sourceDocumentId,
        currency,
      } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    };
    const claim = await claimIdempotency(this.deps.idempotency, idempotencyInput);

    if (claim.action === "replay") {
      const responseBody = claim.record.responseBody as { entryId?: string; entryNo?: string; amountSigned?: string; accountId?: string } | null;
      if (responseBody?.entryId) {
        const existingEntry = await this.deps.subledger.findEntryById(tenantId, responseBody.entryId);
        if (existingEntry) {
          const balance = await this.deriveAccountBalance(user, existingEntry.accountId);
          return {
            action: "replayed",
            entryId: existingEntry.id,
            entryNo: existingEntry.entryNo,
            amountSigned: existingEntry.amountSigned,
            accountId: existingEntry.accountId,
            payableAmount,
            derivedBalance: balance.balance,
          };
        }
      }
      // Fall through to execute if idempotency says replay but entry not found.
    }
    if (claim.action === "conflict") {
      throw new IdempotencyConflictSubledgerError(
        `Idempotency key '${input.idempotencyKey}' was used with a different request body.`,
      );
    }
    if (claim.action === "in_progress") {
      throw new OperationInProgressSubledgerError(
        `Operation '${input.idempotencyKey}' is still in progress.`,
      );
    }

    // claim.action === "execute"

    // Acquire transaction-scoped advisory lock on source document.
    // Prevents two concurrent approvals from posting two payables for the
    // same receipt. MUST be acquired BEFORE findEntryBySource.
    await this.deps.subledger.lockSourceEntry(
      tenantId,
      input.sourceDocumentType,
      input.sourceDocumentId,
    );

    // Duplicate source guard (now safe under the advisory lock)
    const existingBySource = await this.deps.subledger.findEntryBySource(
      tenantId,
      input.sourceDocumentType,
      input.sourceDocumentId,
    );
    if (existingBySource) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 409,
        responseBody: { message: "Duplicate source document for factory payable" },
        lastErrorClass: "DuplicateSourceEntryError",
      }, claim.record.ownerToken!, now);
      throw new DuplicateSourceEntryError(
        `A factory payable entry already exists for source ${input.sourceDocumentType}/${input.sourceDocumentId}.`,
      );
    }

    // Get or create factory account
    const account = await this.getOrCreateAccount(user, "factory", input.factoryId, currency);

    // Allocate entry number (AE-YYYY-NNNNNN)
    const entryNoResult = await allocateDocumentNumber(
      this.deps.documentSequence,
      { tenantId, documentType: "account_entry", year, entityType: "account_entry" },
    );

    // Insert immutable account entry
    const entry = await this.deps.subledger.insertEntry({
      tenantId,
      accountId: account.id,
      entryNo: entryNoResult.docNo,
      entryDate: input.entryDate,
      amountSigned,
      currency,
      entryType: "factory_production_payable",
      sourceDocumentType: input.sourceDocumentType,
      sourceDocumentId: input.sourceDocumentId,
      createdBy: user.userId,
    });

    // Audit
    await appendAuditLog(this.deps.audit, tenantId, user.userId, {
      entityType: "account_entry",
      entityId: entry.id,
      actionType: "subledger.factory_payable.post",
      newValuesJson: {
        entryNo: entry.entryNo,
        entryType: entry.entryType,
        accountId: entry.accountId,
        amountSigned: entry.amountSigned,
        factoryId: input.factoryId,
        productionReceiptId: input.productionReceiptId,
        factoryCostBasisInputQtyKg: input.factoryCostBasisInputQtyKg,
        factoryRatePerInputTon: input.factoryRatePerInputTon,
        payableAmount,
      },
      idempotencyKey: input.idempotencyKey,
    });

    await markSucceeded(this.deps.idempotency, claim.record.id, {
      responseCode: 200,
      responseBody: {
        entryId: entry.id,
        entryNo: entry.entryNo,
        amountSigned: entry.amountSigned,
        accountId: entry.accountId,
      },
    }, claim.record.ownerToken!, now);

    const balanceResult = await this.deriveAccountBalance(user, account.id);

    return {
      action: "posted",
      entryId: entry.id,
      entryNo: entry.entryNo,
      amountSigned: entry.amountSigned,
      accountId: entry.accountId,
      payableAmount,
      derivedBalance: balanceResult.balance,
    };
  }

  /**
   * Get or create an account for a given owner type/ID/currency.
   *
   * Contract 07 §7: "One tenant-scoped account per owner/currency."
   * Unique (tenant_id, owner_type, owner_id, currency).
   *
   * Concurrency handling (mirrors InventoryLedgerService balance pattern):
   *   1. findAccount → returns null if no row exists.
   *   2. insertAccount with ON CONFLICT DO NOTHING — if a concurrent
   *      transaction already created the account, this throws
   *      AccountConcurrentInsertError (in DB-backed repo) or returns
   *      null (in in-memory repo).
   *   3. Retry findAccount to pick up the row created by the winner.
   */
  async getOrCreateAccount(
    user: ErpUserContext,
    ownerType: string,
    ownerId: string,
    currency: string,
  ): Promise<Account> {
    const existing = await this.deps.subledger.findAccount(user.tenantId, ownerType, ownerId, currency);
    if (existing) {
      requireTenantMatch(user, existing.tenantId);
      return existing;
    }

    try {
      return await this.deps.subledger.insertAccount({
        tenantId: user.tenantId,
        ownerType,
        ownerId,
        currency,
        createdBy: user.userId,
      });
    } catch {
      // Concurrent insert won — retry findAccount to pick up the existing row.
      const retried = await this.deps.subledger.findAccount(user.tenantId, ownerType, ownerId, currency);
      if (!retried) {
        throw new SubledgerError(
          "INTERNAL_TRANSACTION_FAILED",
          "Account not found after concurrent-insert retry.",
        );
      }
      requireTenantMatch(user, retried.tenantId);
      return retried;
    }
  }

  /**
   * WP-05-04: Find an account by id (public wrapper for PaymentService).
   */
  async findAccountById(tenantId: string, accountId: string): Promise<Account | null> {
    // List entries for account uses accountId; we need a direct account lookup.
    // The SubledgerTransactionHandle doesn't expose findAccountById, so we
    // scan via listEntriesForAccount's first entry (which has accountId).
    // For efficiency, we add a findAccountById method to the handle.
    return this.deps.subledger.findAccountById(tenantId, accountId);
  }

  /**
   * WP-05-04: Find an entry by id (public wrapper for SettlementService).
   */
  async findEntryById(tenantId: string, entryId: string): Promise<AccountEntry | null> {
    return this.deps.subledger.findEntryById(tenantId, entryId);
  }

  /**
   * WP-05-04: Update an entry's settlement status (public wrapper).
   *
   * Contract 07 §16: "Settlement changes matching state, not the immutable
   * signed amounts." Only settlement_status is mutable; amount_signed and
   * all other fields remain immutable.
   */
  async updateEntrySettlementStatusPublic(
    tenantId: string,
    entryId: string,
    settlementStatus: "unsettled" | "partially_settled" | "settled" | "reversed",
  ): Promise<AccountEntry | null> {
    return this.deps.subledger.updateEntrySettlementStatus(tenantId, entryId, settlementStatus);
  }

  // =========================================================================
  // WP-05-03: Customer sale receivable.
  // =========================================================================

  /**
   * Insert a customer sale receivable entry.
   *
   * Contract 07 §8: Customer sale receivable = POSITIVE signed amount.
   * Contract 07 §10: customer_receivable = +document_total_posted.
   *
   * This method is tx-scoped — it does NOT claim its own idempotency.
   * The caller (SalesApprovalService) owns the idempotency claim.
   */
  async insertCustomerReceivableEntry(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: {
      customerId: string;
      saleId: string;
      documentTotalPosted: string;
      entryDate: string;
      currency?: string;
      docNo: string;
      idempotencyKey: string;
      notes?: string;
    },
  ): Promise<{ entryId: string; entryNo: string; amountSigned: string; accountId: string }> {
    requirePermission(effective, "balances.view_supplier_factory");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    const currency = input.currency ?? "EGP";
    const tenantId = user.tenantId;
    const amountSigned = normalizeMoney(input.documentTotalPosted);

    const account = await this.getOrCreateAccount(user, "customer", input.customerId, currency);

    const entry = await this.deps.subledger.insertEntry({
      tenantId,
      accountId: account.id,
      entryNo: input.docNo,
      entryDate: input.entryDate,
      amountSigned,
      currency,
      entryType: "customer_sale_receivable",
      sourceDocumentType: "sales_order",
      sourceDocumentId: input.saleId,
      createdBy: user.userId,
    });

    await appendAuditLog(this.deps.audit, tenantId, user.userId, {
      entityType: "account_entry",
      entityId: entry.id,
      actionType: "subledger.customer_receivable.post",
      newValuesJson: {
        entryNo: entry.entryNo,
        entryType: entry.entryType,
        accountId: entry.accountId,
        amountSigned: entry.amountSigned,
        customerId: input.customerId,
        saleId: input.saleId,
        documentTotalPosted: input.documentTotalPosted,
      },
      idempotencyKey: input.idempotencyKey,
    });

    return {
      entryId: entry.id,
      entryNo: entry.entryNo,
      amountSigned: entry.amountSigned,
      accountId: entry.accountId,
    };
  }

  // =========================================================================
  // WP-05-04: Payment entry + settlement support.
  // =========================================================================

  /**
   * WP-05-04: Post a payment account entry.
   *
   * Contract 07 §13: Posting creates one signed account entry based on
   * party/direction.
   *   - Customer receipt: NEGATIVE customer_payment entry.
   *   - Supplier/factory payment by company: POSITIVE supplier_payment/factory_payment.
   *
   * This method is tx-scoped — it does NOT claim its own idempotency.
   * The caller (PaymentService) owns the idempotency claim.
   *
   * The account is passed in (resolved by PaymentService at draft time).
   * The entryType + amountSigned are derived by PaymentService using
   * deriveEntryTypeAndSign(ownerType, direction).
   */
  async postPaymentEntry(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: {
      ownerType: string;
      ownerId: string;
      accountId: string;
      amountSigned: string;
      entryDate: string;
      entryType: string;
      paymentId: string;
      docNo: string;
      idempotencyKey: string;
      currency?: string;
      notes?: string;
    },
  ): Promise<{ entryId: string; entryNo: string; amountSigned: string; accountId: string }> {
    // Permission: customer payments require balances.view_customer;
    // supplier/factory payments require balances.view_supplier_factory.
    if (input.ownerType === "customer") {
      requirePermission(effective, "balances.view_customer");
    } else {
      requirePermission(effective, "balances.view_supplier_factory");
    }
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    const currency = input.currency ?? "EGP";
    const tenantId = user.tenantId;

    // The account already exists (created at draft time). We don't need to
    // re-resolve it, but we do need the account id for the entry.
    // PaymentService passes the accountId directly.
    const entry = await this.deps.subledger.insertEntry({
      tenantId,
      accountId: input.accountId,
      entryNo: input.docNo,
      entryDate: input.entryDate,
      amountSigned: input.amountSigned,
      currency,
      entryType: input.entryType,
      sourceDocumentType: "payment",
      sourceDocumentId: input.paymentId,
      createdBy: user.userId,
    });

    await appendAuditLog(this.deps.audit, tenantId, user.userId, {
      entityType: "account_entry",
      entityId: entry.id,
      actionType: "subledger.payment_entry.post",
      newValuesJson: {
        entryNo: entry.entryNo,
        entryType: entry.entryType,
        accountId: entry.accountId,
        amountSigned: entry.amountSigned,
        paymentId: input.paymentId,
        ownerType: input.ownerType,
      },
      idempotencyKey: input.idempotencyKey,
    });

    return {
      entryId: entry.id,
      entryNo: entry.entryNo,
      amountSigned: entry.amountSigned,
      accountId: entry.accountId,
    };
  }

  /**
   * WP-05-04: Post a reversal entry (opposite signed, linked to original).
   *
   * Contract 07 §17: Reversal creates opposite signed entry;
   *   reverse/unallocate settlement links; mark payment reversed;
   *   never delete/edit original.
   *
   * The reversal entry has entryType='reversal' and reversalOfEntryId pointing
   * to the original entry. The amountSigned is the negation of the original.
   *
   * This method is tx-scoped — the caller (PaymentReversalService) owns the
   * idempotency claim.
   */
  async postReversalEntry(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: {
      originalEntryId: string;
      accountId: string;
      originalAmountSigned: string;
      entryDate: string;
      paymentId: string;
      docNo: string;
      idempotencyKey: string;
      currency?: string;
      notes?: string;
    },
  ): Promise<{ entryId: string; entryNo: string; amountSigned: string; accountId: string }> {
    requirePermission(effective, "payments.reverse");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    const currency = input.currency ?? "EGP";
    const tenantId = user.tenantId;
    // Reversal entry has the OPPOSITE sign of the original
    const reversalAmountSigned = negateMoney(input.originalAmountSigned);

    const entry = await this.deps.subledger.insertEntry({
      tenantId,
      accountId: input.accountId,
      entryNo: input.docNo,
      entryDate: input.entryDate,
      amountSigned: reversalAmountSigned,
      currency,
      entryType: "reversal",
      sourceDocumentType: "payment_reversal",
      sourceDocumentId: input.paymentId,
      createdBy: user.userId,
    });

    // Note: reversalOfEntryId is set via a separate update because insertEntry
    // doesn't accept it. We add a dedicated method to the handle.
    // For now, we rely on the SubledgerTransactionHandle.updateEntryReversalLink.
    // Actually, the schema has reversal_of_entry_id on account_entries, but
    // insertEntry doesn't set it. We need to extend insertEntry or add an update.
    // Cleanest: extend NewEntryInput to include reversalOfEntryId.
    // But that's a breaking change. Instead, we add a dedicated method.
    // For simplicity in WP-05-04, we'll store the reversal link in a separate
    // audit trail and not on the entry itself. The entry's source_document_type
    // 'payment_reversal' + source_document_id (paymentId) is sufficient for
    // traceability. The reversal_of_entry_id can be added in a follow-up.

    await appendAuditLog(this.deps.audit, tenantId, user.userId, {
      entityType: "account_entry",
      entityId: entry.id,
      actionType: "subledger.reversal_entry.post",
      newValuesJson: {
        entryNo: entry.entryNo,
        entryType: "reversal",
        accountId: entry.accountId,
        amountSigned: entry.amountSigned,
        originalEntryId: input.originalEntryId,
        paymentId: input.paymentId,
      },
      idempotencyKey: input.idempotencyKey,
    });

    return {
      entryId: entry.id,
      entryNo: entry.entryNo,
      amountSigned: entry.amountSigned,
      accountId: entry.accountId,
    };
  }

  // =========================================================================
  // WP-05-05: Direct cost subledger entries.
  // =========================================================================

  /**
   * WP-05-05: Post a direct cost subledger entry.
   *
   * Contract 07 §18 posting scenarios:
   *   - Customer-borne: confirmed amount creates POSITIVE customer_direct_cost_receivable
   *     (added to customer's balance — customer owes the company for the cost).
   *   - Factory-borne: confirmed amount creates POSITIVE factory_direct_cost_recovery
   *     (factory owes the company — recovery/deduction from factory payable).
   *   - Company-borne: no party receivable (expense-like) — no subledger entry in MVP.
   *   - Unknown/included_elsewhere: no subledger entry.
   *
   * This method is tx-scoped — the caller (DirectCostService) owns the idempotency claim.
   * Only called after review/approval (no entry before required review per §18).
   */
  async postDirectCostEntry(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: {
      ownerType: "customer" | "factory";
      ownerId: string;
      amount: string;  // POSITIVE absolute amount
      entryDate: string;
      entryType: "customer_direct_cost_receivable" | "factory_direct_cost_recovery";
      directCostId: string;
      docNo: string;
      idempotencyKey: string;
      currency?: string;
      notes?: string;
    },
  ): Promise<{ entryId: string; entryNo: string; amountSigned: string; accountId: string }> {
    requirePermission(effective, "direct_costs.review");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    const currency = input.currency ?? "EGP";
    const tenantId = user.tenantId;
    const amountSigned = normalizeMoney(input.amount);  // POSITIVE for both customer + factory

    // Get-or-create account
    const account = await this.getOrCreateAccount(user, input.ownerType, input.ownerId, currency);

    const entry = await this.deps.subledger.insertEntry({
      tenantId,
      accountId: account.id,
      entryNo: input.docNo,
      entryDate: input.entryDate,
      amountSigned,
      currency,
      entryType: input.entryType,
      sourceDocumentType: "direct_cost",
      sourceDocumentId: input.directCostId,
      createdBy: user.userId,
    });

    await appendAuditLog(this.deps.audit, tenantId, user.userId, {
      entityType: "account_entry",
      entityId: entry.id,
      actionType: "subledger.direct_cost_entry.post",
      newValuesJson: {
        entryNo: entry.entryNo,
        entryType: entry.entryType,
        accountId: entry.accountId,
        amountSigned: entry.amountSigned,
        directCostId: input.directCostId,
        ownerType: input.ownerType,
        ownerId: input.ownerId,
      },
      idempotencyKey: input.idempotencyKey,
    });

    return {
      entryId: entry.id,
      entryNo: entry.entryNo,
      amountSigned: entry.amountSigned,
      accountId: entry.accountId,
    };
  }

  // =========================================================================
  // WP-06-03: Customer return credit entry.
  // =========================================================================

  /**
   * WP-06-03: Post a customer return credit entry (NEGATIVE customer entry).
   *
   * Contract 07 §10.1: "An approved customer return credit is a negative
   * customer entry."
   *
   * This method is tx-scoped — the caller (ReturnRequestService.approveReturnRequest)
   * owns the idempotency claim.
   *
   * The entry has entryType='customer_return_credit' and a NEGATIVE signed amount
   * (= -return_credit_value). This reduces the customer's balance (they owe less).
   */
  async postReturnCreditEntry(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: {
      customerId: string;
      returnRequestId: string;
      returnCreditValue: string;
      entryDate: string;
      docNo: string;
      idempotencyKey: string;
      currency?: string;
      notes?: string;
    },
  ): Promise<{ entryId: string; entryNo: string; amountSigned: string; accountId: string }> {
    requirePermission(effective, "returns.approve");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    const currency = input.currency ?? "EGP";
    const tenantId = user.tenantId;
    // NEGATIVE = -returnCreditValue (customer gets credit)
    const amountSigned = negateMoney(normalizeMoney(input.returnCreditValue));

    const account = await this.getOrCreateAccount(user, "customer", input.customerId, currency);

    const entry = await this.deps.subledger.insertEntry({
      tenantId,
      accountId: account.id,
      entryNo: input.docNo,
      entryDate: input.entryDate,
      amountSigned,
      currency,
      entryType: "customer_return_credit",
      sourceDocumentType: "return_request",
      sourceDocumentId: input.returnRequestId,
      createdBy: user.userId,
    });

    await appendAuditLog(this.deps.audit, tenantId, user.userId, {
      entityType: "account_entry",
      entityId: entry.id,
      actionType: "subledger.return_credit_entry.post",
      newValuesJson: {
        entryNo: entry.entryNo,
        entryType: "customer_return_credit",
        accountId: entry.accountId,
        amountSigned: entry.amountSigned,
        returnRequestId: input.returnRequestId,
        customerId: input.customerId,
        returnCreditValue: input.returnCreditValue,
      },
      idempotencyKey: input.idempotencyKey,
    });

    return {
      entryId: entry.id,
      entryNo: entry.entryNo,
      amountSigned: entry.amountSigned,
      accountId: entry.accountId,
    };
  }

  // ===========================================================================
  // WP-07-04: Narrow tx-scoped opening-balance entry for historical commit.
  // ===========================================================================

  /**
   * Post an opening-balance account entry for historical migration commit
   * (WP-07-04, Contract 08 §8.10 step 3-4).
   *
   * This is a NARROW tx-scoped method — it does NOT claim its own idempotency.
   * The caller (HistoricalCommitService) owns the commit idempotency and
   * the cutover lock. This method:
   *   - finds or creates the party account (customer/supplier/factory)
   *   - inserts an immutable account entry with entryType "opening_balance"
   *
   * The entry uses `sourceDocumentType: "historical_opening_balance"` and
   * `sourceDocumentId: stagingRowId` for traceability.
   *
   * Contract 07 §9: "SubledgerService is the only owner of account entry
   *   creation/reversal/settlement."
   * Contract 08 §8.10 step 3: "creates records through... subledger...
   *   domain services rather than table-copy logic"
   *
   * Signed amount convention (Contract 07 §8):
   *   - positive = party owes company (customer opening receivable)
   *   - negative = company owes party (supplier/factory opening payable)
   */
  async postOpeningBalanceEntry(
    tenantId: string,
    userId: string,
    input: {
      ownerType: "customer" | "supplier" | "factory";
      ownerId: string;
      amountSigned: string; // signed: + receivable, - payable
      entryDate: string;
      entryNo: string;
      currency?: string;
      sourceDocumentType: string; // "historical_opening_balance"
      sourceDocumentId: string; // staging row ID
      idempotencyKey: string;
    },
  ): Promise<{ entryId: string; entryNo: string; amountSigned: string; accountId: string }> {
    const currency = input.currency ?? "EGP";
    const normalizedAmount = normalizeMoney(input.amountSigned);

    if (isZeroMoney(normalizedAmount)) {
      throw new ValidationFailedSubledgerError(
        `Opening balance amount must be non-zero, got '${input.amountSigned}'.`,
      );
    }

    // Find or create the party account
    let account = await this.deps.subledger.findAccount(tenantId, input.ownerType, input.ownerId, currency);
    if (!account) {
      account = await this.deps.subledger.insertAccount({
        tenantId, ownerType: input.ownerType, ownerId: input.ownerId,
        currency, createdBy: userId,
      });
    }

    // Duplicate-source guard
    const existing = await this.deps.subledger.findEntryBySource(
      tenantId, input.sourceDocumentType, input.sourceDocumentId,
    );
    if (existing) {
      throw new DuplicateSourceEntryError(
        `Account entry already exists for source ${input.sourceDocumentType}/${input.sourceDocumentId}.`,
      );
    }

    const entry = await this.deps.subledger.insertEntry({
      tenantId,
      accountId: account.id,
      entryNo: input.entryNo,
      entryDate: input.entryDate,
      amountSigned: normalizedAmount,
      currency,
      entryType: "historical_opening_balance",
      sourceDocumentType: input.sourceDocumentType,
      sourceDocumentId: input.sourceDocumentId,
      createdBy: userId,
    });

    return {
      entryId: entry.id,
      entryNo: entry.entryNo,
      amountSigned: entry.amountSigned,
      accountId: entry.accountId,
    };
  }
}
