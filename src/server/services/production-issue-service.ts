/**
 * Production Issue Service — WP-04-01.
 *
 * Contract: docs/contracts/13_work_packages.md WP-04-01
 *   Goal: Create many-to-many-ready orders and atomically issue factory
 *   on-hand to WIP.
 *   Expected outputs: Draft/service/screen and approved issue transaction.
 *   Implementation notes: Issue creates no payable; worker facts only.
 *   Acceptance: On-hand decreases and WIP increases exactly once.
 *
 * Contract: docs/contracts/04_inventory_posting_contract.md §8, §10
 *   "Issue to production: factory -qty, issued stock must be available,
 *    WIP +qty."
 *
 * Contract: docs/contracts/05_production_wip_contract.md §11, §12, §13
 *   "Material at a factory remains on-hand until issued."
 *   "Issue decreases factory on-hand and increases WIP equally."
 *   WIP invariant: issued = consumed + waste + returned + remaining
 *
 * WP-04-01 SCOPE:
 *   - Create production order draft with many-to-many input rows
 *   - Submit issue to production (atomic: on-hand -qty, WIP +qty,
 *     input.issuedQty update, order status → material_issued)
 *   - No factory payable, no receipt, no waste, no WIP return
 *
 * WP-04-01 NON-SCOPE (deferred):
 *   - Production receipt (WP-04-02, WP-04-03)
 *   - Factory payable (WP-04-03)
 *   - WIP return (WP-04-04)
 *   - Rate confirmation / cost snapshot
 *   - Management UI screens
 */
import "server-only";

import type { ErpUserContext } from "@/server/auth/erp-context";
import { requirePermission, requireTenantMatch, rejectBodyClaimsAuthority } from "@/server/security/guards";
import type { EffectivePermissions } from "@/server/security/effective-permissions";
import { appendAuditLog, type AuditTransactionHandle } from "./audit-service";
import {
  claimIdempotency, markSucceeded, markBusinessFailed,
  type IdempotencyTransactionHandle, type IdempotencyClaimInput,
} from "./idempotency-service";
import {
  allocateDocumentNumber, type DocumentSequenceTransactionHandle,
} from "./document-sequence-service";
import type { InventoryLedgerService } from "./inventory-ledger-service";
import type { InventoryBalance } from "./inventory-ledger-service";
import type { ProductionOrderRepository } from "./production-order-repository";
import type { WipBalanceRepository } from "./wip-balance-repository";
import type { ProductionOrder, ProductionInput } from "@/server/db/schema/production-orders";
import { addKg, compareKg, isPositiveKg, normalizeKg } from "./decimal-kg";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

export interface CreateProductionOrderInput {
  productionType: "single_yarn" | "twisted_yarn";
  factoryId: string;
  factoryLocationId: string;
  inputs: Array<{
    inputItemId: string;
    inputLocationId: string;
    plannedInputQtyKg: string;
  }>;
}

export interface IssueToProductionInput {
  productionOrderId: string;
  inputId: string;
  quantityKg: string;
  idempotencyKey: string;
}

export interface IssueToProductionResult {
  action: "posted" | "replayed";
  productionOrderId: string;
  inputId: string;
  movementId: string;
  docNo: string;
  issuedQtyKg: string;
  factoryOnHandQtyKg: string;
  wipQtyKg: string;
  orderStatus: string;
}

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

export class ProductionIssueError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = "ProductionIssueError"; this.code = code; }
}

export class ProductionOrderNotFoundError extends ProductionIssueError {
  constructor(id: string) { super("PRODUCTION_ORDER_NOT_FOUND", `Production order '${id}' not found.`); this.name = "ProductionOrderNotFoundError"; }
}

export class ProductionInputNotFoundError extends ProductionIssueError {
  constructor(id: string) { super("PRODUCTION_INPUT_NOT_FOUND", `Production input '${id}' not found.`); this.name = "ProductionInputNotFoundError"; }
}

export class ProductionOrderNotIssuableError extends ProductionIssueError {
  constructor(id: string, status: string) { super("ORDER_NOT_ISSUABLE", `Order '${id}' is in status '${status}' — only 'draft' orders can be issued.`); this.name = "ProductionOrderNotIssuableError"; }
}

export class InputLocationMismatchError extends ProductionIssueError {
  constructor(inputId: string, expected: string, actual: string) {
    super("INPUT_LOCATION_MISMATCH", `Input '${inputId}' location '${actual}' does not match factory location '${expected}'.`);
    this.name = "InputLocationMismatchError";
  }
}

// ---------------------------------------------------------------------------
// Transaction runner + factories.
// ---------------------------------------------------------------------------

export type ProductionIssueTransactionRunner = <T>(work: (tx: unknown) => Promise<T>) => Promise<T>;

export interface ProductionIssueTransactionScopedFactories {
  createInventoryLedger: (tx: unknown) => InventoryLedgerService;
  createProductionOrderRepository: (tx: unknown) => ProductionOrderRepository;
  createWipBalanceRepository: (tx: unknown) => WipBalanceRepository;
}

// ---------------------------------------------------------------------------
// Service deps.
// ---------------------------------------------------------------------------

export interface ProductionIssueServiceDeps {
  productionOrderRepository: ProductionOrderRepository;
  wipBalanceRepository: WipBalanceRepository;
  inventoryLedger: InventoryLedgerService;
  audit: AuditTransactionHandle;
  idempotency: IdempotencyTransactionHandle;
  documentSequence: DocumentSequenceTransactionHandle;
  transactionRunner?: ProductionIssueTransactionRunner;
  txFactories?: ProductionIssueTransactionScopedFactories;
}

const PRODUCTION_ENTITY_TYPE = "production_order";
const PRODUCTION_INPUT_ENTITY_TYPE = "production_input";

// ---------------------------------------------------------------------------
// ProductionIssueService.
// ---------------------------------------------------------------------------

export class ProductionIssueService {
  constructor(private readonly deps: ProductionIssueServiceDeps) {}

  /**
   * Create a production order draft with many-to-many input rows.
   *
   * Permission: production.create (warehouse/management).
   * DEC-012: many-to-many capable — multiple input rows per item allowed.
   * No stock movement created. Order starts in 'draft' status.
   */
  async createProductionOrder(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: CreateProductionOrderInput,
  ): Promise<{ order: ProductionOrder; inputs: ProductionInput[] }> {
    requirePermission(effective, "production.create");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!input.factoryId || !input.factoryLocationId) {
      throw new ProductionIssueError("VALIDATION_FAILED", "factoryId and factoryLocationId are required.");
    }
    if (input.inputs.length === 0) {
      throw new ProductionIssueError("VALIDATION_FAILED", "At least one input row is required.");
    }
    for (const inp of input.inputs) {
      if (!isPositiveKg(inp.plannedInputQtyKg)) {
        throw new ProductionIssueError("VALIDATION_FAILED", `Planned input qty must be positive, got '${inp.plannedInputQtyKg}'.`);
      }
    }

    // Allocate doc number
    const year = new Date().getUTCFullYear();
    const docNoResult = await allocateDocumentNumber(this.deps.documentSequence, {
      tenantId: user.tenantId, documentType: "production_order", year, entityType: PRODUCTION_ENTITY_TYPE,
    });

    // Create order
    const order = await this.deps.productionOrderRepository.insertOrder({
      tenantId: user.tenantId,
      docNo: docNoResult.docNo,
      productionType: input.productionType,
      factoryId: input.factoryId,
      factoryLocationId: input.factoryLocationId,
      createdBy: user.userId,
    });

    // Create input rows
    const inputs: ProductionInput[] = [];
    for (const inp of input.inputs) {
      const inputRow = await this.deps.productionOrderRepository.insertInput({
        tenantId: user.tenantId,
        productionOrderId: order.id,
        inputItemId: inp.inputItemId,
        inputLocationId: inp.inputLocationId,
        plannedInputQtyKg: normalizeKg(inp.plannedInputQtyKg),
      });
      inputs.push(inputRow);
    }

    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: PRODUCTION_ENTITY_TYPE, entityId: order.id,
      actionType: "production_order.create",
      newValuesJson: { docNo: order.docNo, productionType: order.productionType, factoryId: order.factoryId, inputCount: inputs.length },
    });

    return { order, inputs };
  }

  /**
   * Issue material to production: atomically decrease factory on-hand,
   * increase WIP, update input.issuedQty, set order status to material_issued.
   *
   * Contract 05 §12: Issue to Production.
   *   1. lock order/input/balance/WIP rows
   *   2. recheck availability
   *   3. insert issue_to_production movement
   *   4. decrease factory on-hand
   *   5. increase WIP
   *   6. update issued quantity/order state
   *   7. write audit
   *   8. commit atomically
   *
   * Permission: production.issue.approve (Owner/Accountant).
   * Issue creates NO factory payable.
   */
  async issueToProduction(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: IssueToProductionInput,
  ): Promise<IssueToProductionResult> {
    requirePermission(effective, "production.issue.approve");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!input.productionOrderId || !input.inputId || !input.idempotencyKey) {
      throw new ProductionIssueError("VALIDATION_FAILED", "productionOrderId, inputId, and idempotencyKey are required.");
    }
    if (!isPositiveKg(input.quantityKg)) {
      throw new ProductionIssueError("VALIDATION_FAILED", `Quantity must be positive, got '${input.quantityKg}'.`);
    }

    // Fetch order for pre-checks
    const order = await this.deps.productionOrderRepository.findOrderById(user.tenantId, input.productionOrderId);
    if (!order) throw new ProductionOrderNotFoundError(input.productionOrderId);
    requireTenantMatch(user, order.tenantId);

    // Claim idempotency FIRST (before status check — replay must work even
    // if the order has already transitioned to material_issued).
    const now = new Date();
    const idempotencyInput: IdempotencyClaimInput = {
      tenantId: user.tenantId,
      operationScope: "production_issue.issue",
      idempotencyKey: input.idempotencyKey,
      requestBody: { productionOrderId: input.productionOrderId, inputId: input.inputId, quantityKg: normalizeKg(input.quantityKg) } as Record<string, unknown>,
      initiatedBy: user.userId, leaseDurationMs: 30000, now,
    };
    const claim = await claimIdempotency(this.deps.idempotency, idempotencyInput);

    if (claim.action === "replay") {
      // Return replay — the issue already happened
      const refreshedInput = await this.deps.productionOrderRepository.findInputById(user.tenantId, input.inputId);
      return {
        action: "replayed" as const,
        productionOrderId: input.productionOrderId,
        inputId: input.inputId,
        movementId: refreshedInput?.issueMovementId ?? "",
        docNo: "",
        issuedQtyKg: refreshedInput?.issuedQtyKg ?? "0.000",
        factoryOnHandQtyKg: "0.000",
        wipQtyKg: "0.000",
        orderStatus: order.status,
      };
    }
    if (claim.action === "conflict") {
      throw new ProductionIssueError("IDEMPOTENCY_CONFLICT", `Idempotency key '${input.idempotencyKey}' was used with a different request body.`);
    }
    if (claim.action === "in_progress") {
      throw new ProductionIssueError("OPERATION_IN_PROGRESS", `Operation '${input.idempotencyKey}' is still in progress.`);
    }

    // claim.action === "execute" — fresh call. Now check business preconditions.
    if (order.status !== "draft") {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 409,
        responseBody: { message: `Order in status '${order.status}' cannot be issued.` },
        lastErrorClass: "ProductionOrderNotIssuableError",
      }, claim.record.ownerToken!, now);
      throw new ProductionOrderNotIssuableError(order.id, order.status);
    }

    const prodInput = await this.deps.productionOrderRepository.findInputById(user.tenantId, input.inputId);
    if (!prodInput) throw new ProductionInputNotFoundError(input.inputId);
    requireTenantMatch(user, prodInput.tenantId);

    // Input location must match factory location (Contract 05 §11)
    if (prodInput.inputLocationId !== order.factoryLocationId) {
      throw new InputLocationMismatchError(prodInput.id, order.factoryLocationId, prodInput.inputLocationId);
    }

    // =====================================================================
    // ATOMIC ISSUE TRANSACTION (Contract 05 §12)
    // =====================================================================
    const executeIssue = async (
      txScoped: {
        inventoryLedger: InventoryLedgerService;
        productionOrderRepository: ProductionOrderRepository;
        wipBalanceRepository: WipBalanceRepository;
      } | null,
    ): Promise<IssueToProductionResult> => {
      const invLedger = txScoped?.inventoryLedger ?? this.deps.inventoryLedger;
      const orderRepo = txScoped?.productionOrderRepository ?? this.deps.productionOrderRepository;
      const wipRepo = txScoped?.wipBalanceRepository ?? this.deps.wipBalanceRepository;

      const normalizedQty = normalizeKg(input.quantityKg);

      // Step 1: Post issue_to_production movement (decreases factory on-hand)
      const movementResult = await invLedger.postIssueToProduction(user, effective, {
        itemId: prodInput.inputItemId,
        fromLocationId: prodInput.inputLocationId,
        quantityKg: normalizedQty,
        movementDate: new Date().toISOString().slice(0, 10),
        sourceDocumentType: PRODUCTION_INPUT_ENTITY_TYPE,
        sourceDocumentId: prodInput.id,
        idempotencyKey: `${input.idempotencyKey}:issue`,
      });

      // Step 2: Increase WIP balance
      let wipBalance = await wipRepo.findForUpdate(
        user.tenantId, order.id, prodInput.inputItemId, order.factoryLocationId,
      );
      if (!wipBalance) {
        wipBalance = await wipRepo.insertBalance({
          tenantId: user.tenantId,
          productionOrderId: order.id,
          inputItemId: prodInput.inputItemId,
          factoryLocationId: order.factoryLocationId,
          wipQtyKg: "0.000",
        });
      }
      const newWipQty = addKg(wipBalance.wipQtyKg, normalizedQty);
      const updatedWip = await wipRepo.updateWipQty(
        user.tenantId, order.id, prodInput.inputItemId, order.factoryLocationId,
        { wipQtyKg: newWipQty, version: wipBalance.version + 1 },
      );
      if (!updatedWip) {
        throw new ProductionIssueError("INTERNAL_TRANSACTION_FAILED", "WIP balance not found during update.");
      }

      // Step 3: Update input.issuedQty + link movement
      const newIssuedQty = addKg(prodInput.issuedQtyKg, normalizedQty);
      const updatedInput = await orderRepo.updateInputIssuedQty(
        user.tenantId, prodInput.id,
        { issuedQtyKg: newIssuedQty, issueMovementId: movementResult.movementId },
      );
      if (!updatedInput) {
        throw new ProductionIssueError("INTERNAL_TRANSACTION_FAILED", "Production input not found during update.");
      }

      // Step 4: Update order status to material_issued (conditional on draft)
      const updatedOrder = await orderRepo.updateOrderStatusConditional(
        user.tenantId, order.id,
        { status: "material_issued", approvalStatus: "pending_approval" },
        ["draft"],
      );
      // Note: if another concurrent issue already moved the order to material_issued,
      // that's fine — the order stays in material_issued (the conditional just prevents
      // moving from a non-draft state). We don't throw here because multiple inputs
      // can be issued to the same order.

      // Step 5: Audit
      await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
        entityType: PRODUCTION_ENTITY_TYPE, entityId: order.id,
        actionType: "production_issue.issue",
        newValuesJson: {
          inputId: prodInput.id,
          movementId: movementResult.movementId,
          docNo: movementResult.docNo,
          issuedQtyKg: newIssuedQty,
          factoryOnHandQtyKg: movementResult.onHandQtyKg,
          wipQtyKg: newWipQty,
          orderStatus: updatedOrder?.status ?? "material_issued",
        },
        idempotencyKey: input.idempotencyKey,
      });

      return {
        action: "posted" as const,
        productionOrderId: order.id,
        inputId: prodInput.id,
        movementId: movementResult.movementId,
        docNo: movementResult.docNo,
        issuedQtyKg: newIssuedQty,
        factoryOnHandQtyKg: movementResult.onHandQtyKg,
        wipQtyKg: newWipQty,
        orderStatus: updatedOrder?.status ?? "material_issued",
      };
    };

    let result: IssueToProductionResult;
    try {
      if (this.deps.transactionRunner && this.deps.txFactories) {
        result = await this.deps.transactionRunner(async (tx: unknown) => {
          const txInvLedger = this.deps.txFactories!.createInventoryLedger(tx);
          const txOrderRepo = this.deps.txFactories!.createProductionOrderRepository(tx);
          const txWipRepo = this.deps.txFactories!.createWipBalanceRepository(tx);
          return executeIssue({ inventoryLedger: txInvLedger, productionOrderRepository: txOrderRepo, wipBalanceRepository: txWipRepo });
        });
      } else {
        result = await executeIssue(null);
      }
    } catch (txError) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 500,
        responseBody: { message: "Production issue transaction failed and rolled back." },
        lastErrorClass: txError instanceof Error ? txError.name : "Unknown",
      }, claim.record.ownerToken!, now);
      throw txError;
    }

    await markSucceeded(this.deps.idempotency, claim.record.id, {
      responseCode: 200,
      responseBody: { productionOrderId: order.id, movementId: result.movementId },
    }, claim.record.ownerToken!, now);

    return result;
  }
}
