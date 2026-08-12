/**
 * WP-08-01F Production Correction Domain Hook.
 *
 * Contract 08 §8.11: "creates linked reversal, correction, or inventory/account
 * adjustment through domain services rather than table-copy logic."
 *
 * This hook dispatches on correctionType + originalEntityType to call the
 * appropriate domain service:
 *
 *   reversal + stock_movement → InventoryLedgerService.postReversal
 *   reversal + account_entry  → SubledgerService.postReversalEntry
 *   adjustment + stock_movement → InventoryLedgerService.postAdjustment
 *
 * All corrections are append-only compensating effects. Original committed
 * records are NEVER updated or deleted — only new reversal/adjustment rows
 * are created through the domain services.
 *
 * The hook receives tx-scoped domain services so all effects commit or
 * roll back together with the correction request status, audit, and
 * idempotency markSucceeded inside the executeCorrection transaction.
 */
import "server-only";

import type { InventoryLedgerService } from "./inventory-ledger-service";
import type { SubledgerService } from "./subledger-service";
import type { HistoricalCorrectionRequest, ImportBatch } from "@/server/db/schema/migration";
import type { CorrectionDomainHook } from "./historical-correction-service";

/**
 * Factory that creates tx-scoped domain services for the correction hook.
 * Each factory receives the transaction handle and returns a service bound
 * to that transaction — all domain effects commit/rollback with the
 * correction execution transaction.
 */
export interface CorrectionDomainHookFactories {
  createInventoryLedger: (tx: unknown) => InventoryLedgerService;
  createSubledger: (tx: unknown) => SubledgerService;
  /** The current transaction handle (passed from executeCorrection's transactionRunner). */
  tx: unknown;
}

/**
 * Production CorrectionDomainHook implementation.
 *
 * Dispatches on correctionType + originalEntityType to call the appropriate
 * domain service method. All effects are append-only compensating movements/
 * entries — original committed records remain immutable.
 */
export class ProductionCorrectionDomainHook implements CorrectionDomainHook {
  constructor(private readonly factories: CorrectionDomainHookFactories) {}

  async executeCorrection(
    tenantId: string,
    userId: string,
    correctionRequest: HistoricalCorrectionRequest,
    batch: ImportBatch,
    faultInjection?: "after_domain_effect" | null,
  ): Promise<{ correctedEntityType: string; correctedEntityId: string }> {
    const { correctionType, originalEntityType, originalEntityId } = correctionRequest;

    // Build a minimal user context for the domain service calls
    const userContext = {
      authenticated: true,
      tenantId,
      userId,
      authId: `correction-${userId}`,
      name: "Correction Execution",
      email: `correction-${userId}@system.local`,
    } as any;

    // Build a minimal effective permissions context with the needed permissions
    const effective = {
      assignedRoleCodes: ["owner"],
      permissionKeys: new Set([
        "inventory.adjust", "inventory.reverse",
        "payments.reverse",
      ]),
      deniedFieldKeys: new Set(),
      workerFinancialDeny: false,
    } as any;

    // Dispatch based on correctionType + originalEntityType
    let result: { correctedEntityType: string; correctedEntityId: string };

    if (correctionType === "reversal" && originalEntityType === "stock_movement") {
      result = await this.executeStockMovementReversal(
        userContext, effective, correctionRequest, originalEntityId,
      );
    } else if (correctionType === "reversal" && originalEntityType === "account_entry") {
      result = await this.executeAccountEntryReversal(
        userContext, effective, correctionRequest, originalEntityId,
      );
    } else if (correctionType === "adjustment" && originalEntityType === "stock_movement") {
      result = await this.executeStockMovementAdjustment(
        userContext, effective, correctionRequest, originalEntityId,
      );
    } else {
      // unsupported combination
      throw new Error(
        `CORRECTION_TYPE_NOT_SUPPORTED: correctionType='${correctionType}' with ` +
        `originalEntityType='${originalEntityType}' is not supported by the production ` +
        `correction hook. Supported combinations: ` +
        `(reversal, stock_movement), (reversal, account_entry), (adjustment, stock_movement).`,
      );
    }

    // WP-08-01F fault injection: throw AFTER the domain effect has been posted
    // but BEFORE the correction request status is updated. This tests that the
    // transaction rolls back the domain effect.
    if (faultInjection === "after_domain_effect") {
      throw new Error("FAULT_INJECTED: after_domain_effect — domain effect posted but transaction will roll back");
    }

    return result;
  }

  /**
   * Execute a stock movement reversal through InventoryLedgerService.postReversal.
   * Creates a new reversal movement with inverse quantity — original movement
   * is never modified.
   */
  private async executeStockMovementReversal(
    user: any, effective: any,
    request: HistoricalCorrectionRequest,
    originalMovementId: string,
  ): Promise<{ correctedEntityType: string; correctedEntityId: string }> {
    const inventoryLedger = this.factories.createInventoryLedger(this.factories.tx);

    const reversalDate = new Date().toISOString().slice(0, 10);
    const result = await inventoryLedger.postReversal(user, effective, {
      originalMovementId,
      reversalDate,
      reason: `Historical correction: ${request.reason}`,
      idempotencyKey: `correction-reversal-${request.id}`,
    });

    return {
      correctedEntityType: "stock_movement",
      correctedEntityId: result.movementId,
    };
  }

  /**
   * Execute an account entry reversal through SubledgerService.postReversalEntry.
   * Creates a new reversal entry with opposite signed amount — original entry
   * is never modified.
   */
  private async executeAccountEntryReversal(
    user: any, effective: any,
    request: HistoricalCorrectionRequest,
    originalEntryId: string,
  ): Promise<{ correctedEntityType: string; correctedEntityId: string }> {
    const subledger = this.factories.createSubledger(this.factories.tx);

    // For account entry reversal, we need additional metadata from the
    // proposedCorrectionJson. The correction request should contain
    // accountId, originalAmountSigned, entryDate, paymentId, docNo.
    const proposed = (request.proposedCorrectionJson ?? {}) as Record<string, unknown>;
    const accountId = String(proposed.accountId ?? "");
    const originalAmountSigned = String(proposed.originalAmountSigned ?? "0");
    const entryDate = String(proposed.entryDate ?? new Date().toISOString().slice(0, 10));
    const paymentId = String(proposed.paymentId ?? originalEntryId);
    const docNo = String(proposed.docNo ?? `CORR-${request.docNo}`);

    if (!accountId) {
      throw new Error(
        "CORRECTION_VALIDATION_FAILED: proposedCorrectionJson must contain 'accountId' " +
        "for account_entry reversal corrections.",
      );
    }

    const result = await subledger.postReversalEntry(user, effective, {
      originalEntryId,
      accountId,
      originalAmountSigned,
      entryDate,
      paymentId,
      docNo,
      idempotencyKey: `correction-reversal-entry-${request.id}`,
      notes: `Historical correction: ${request.reason}`,
    });

    return {
      correctedEntityType: "account_entry",
      correctedEntityId: result.entryId,
    };
  }

  /**
   * Execute a stock movement adjustment through InventoryLedgerService.postAdjustment.
   * Creates a new adjustment movement — original movement is never modified.
   */
  private async executeStockMovementAdjustment(
    user: any, effective: any,
    request: HistoricalCorrectionRequest,
    originalMovementId: string,
  ): Promise<{ correctedEntityType: string; correctedEntityId: string }> {
    const inventoryLedger = this.factories.createInventoryLedger(this.factories.tx);

    // For adjustment, we need itemId, locationId, quantityKgSigned from proposedCorrectionJson
    const proposed = (request.proposedCorrectionJson ?? {}) as Record<string, unknown>;
    const itemId = String(proposed.itemId ?? "");
    const locationId = String(proposed.locationId ?? "");
    const quantityKgSigned = String(proposed.quantityKgSigned ?? "0");
    const movementDate = String(proposed.movementDate ?? new Date().toISOString().slice(0, 10));

    if (!itemId || !locationId) {
      throw new Error(
        "CORRECTION_VALIDATION_FAILED: proposedCorrectionJson must contain 'itemId' and 'locationId' " +
        "for stock_movement adjustment corrections.",
      );
    }

    const result = await inventoryLedger.postAdjustment(user, effective, {
      itemId,
      locationId,
      quantityKgSigned,
      movementDate,
      sourceDocumentType: "historical_correction",
      sourceDocumentId: request.id,
      idempotencyKey: `correction-adjustment-${request.id}`,
      notes: `Historical correction: ${request.reason}`,
    });

    return {
      correctedEntityType: "stock_movement",
      correctedEntityId: result.movementId,
    };
  }
}
