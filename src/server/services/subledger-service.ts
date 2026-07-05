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
  normalizeMoney,
  isPositiveMoney,
  isZeroMoney,
  addMoney,
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
// Transaction handle — abstract persistence interface.
// ---------------------------------------------------------------------------

export interface SubledgerTransactionHandle {
  /** Find an account by (tenantId, ownerType, ownerId, currency). */
  findAccount(tenantId: string, ownerType: string, ownerId: string, currency: string): Promise<Account | null>;
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

    // Step 4: Duplicate source guard (service-layer, no DB unique constraint)
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
      }, now);
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
    }, now);

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
  private async getOrCreateAccount(
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
}
