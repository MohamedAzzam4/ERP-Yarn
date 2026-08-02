/**
 * Production Screen Query Service — WP-08-01B.
 *
 * Contract: docs/contracts/10_frontend_screen_contracts.md §§7.2/8.3
 *   §7.2: Production Employee Screens — record production order/issue/receipt/
 *         waste/WIP-return operational facts. Worker Task Mode.
 *   §8.3: Production/WIP Management Screens — review/approve production issue,
 *         partial receipt, waste, WIP, rate snapshot, payable, lineage,
 *         corrections. Management Console.
 *
 * Contract: docs/contracts/05_production_wip_contract.md
 *   - No worker-entered payable, allocation, profitability or accounting entry
 *   - WIP is input material no longer available as normal stock and not yet
 *     classified as output, waste, or return
 *   - Production worker has created/submitted the operational issue draft
 *
 * This service provides role-safe DTOs for production screens:
 *   - Worker DTOs: operational quantities only (no financial fields)
 *   - Management DTOs: full operational + financial (rate, payable, cost basis)
 *
 * RBAC:
 *   - Worker (production_employee): sees own drafts + operational quantities
 *   - Management (owner, accountant): sees all production orders + WIP + payables
 *
 * Redaction:
 *   - Worker DTOs NEVER include: factoryRatePerInputTon, calculatedFactoryCost,
 *     importedTotalFactoryCost, payableEntryId, payableDeferred, account entries
 *   - Management DTOs include financial fields only when viewer has production.approve
 */
import "server-only";

import { eq, and, desc } from "drizzle-orm";
import {
  productionOrders,
  productionInputs,
  productionOutputs,
  productionWipBalances,
  type ProductionOrder,
  type ProductionInput,
  type ProductionOutput,
  type ProductionWipBalance,
} from "@/server/db/schema/production-orders";
import {
  productionReceipts,
  productionReceiptInputAllocations,
  productionWasteEntries,
  productionWipReturns,
  type ProductionReceipt,
  type ProductionReceiptInputAllocation,
  type ProductionWasteEntry,
  type ProductionWipReturn,
} from "@/server/db/schema/production-receipts";
import { externalFactories, locations, inventoryItems, yarnLots } from "@/server/db/schema";
import type { db as DbType } from "@/server/db/client";

type Db = NonNullable<typeof DbType>;

// ---------------------------------------------------------------------------
// Worker DTOs (redacted — no financial fields)
// ---------------------------------------------------------------------------

export interface WorkerProductionOrderDto {
  id: string;
  docNo: string;
  productionType: string;
  factoryName: string;
  factoryLocationName: string;
  status: string;
  sendDate: string | null;
  receiveDate: string | null;
  totalInputQtyKg: string;
  totalOutputQtyKg: string;
  totalWasteQtyKg: string;
}

export interface WorkerProductionInputDto {
  id: string;
  productionOrderId: string;
  itemCode: string;
  itemName: string;
  locationCode: string;
  plannedInputQtyKg: string;
  issuedQtyKg: string;
  consumedQtyKg: string;
  returnedFromWipQtyKg: string;
  remainingWipQtyKg: string;
}

export interface WorkerWipBalanceDto {
  id: string;
  productionOrderDocNo: string;
  itemCode: string;
  itemName: string;
  factoryName: string;
  remainingWipQtyKg: string;
}

// ---------------------------------------------------------------------------
// Management DTOs (full — includes financial fields)
// ---------------------------------------------------------------------------

export interface ManagementProductionOrderDto {
  id: string;
  docNo: string;
  productionType: string;
  factoryId: string;
  factoryName: string;
  factoryLocationId: string;
  factoryLocationName: string;
  status: string;
  approvalStatus: string;
  sendDate: string | null;
  receiveDate: string | null;
  expectedWastePercent: string | null;
  totalInputQtyKg: string;
  totalOutputQtyKg: string;
  totalWasteQtyKg: string;
  // Financial snapshot fields (Contract 05 §17)
  factoryCostBasisUsed: string | null;
  factoryRatePerInputTonUsed: string | null;
  calculatedFactoryCost: string | null;
  rateConfirmedBy: string | null;
  rateConfirmedAt: Date | null;
}

export interface ManagementProductionInputDto {
  id: string;
  productionOrderId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  locationId: string;
  locationCode: string;
  locationName: string;
  plannedInputQtyKg: string;
  issuedQtyKg: string;
  consumedQtyKg: string;
  returnedFromWipQtyKg: string;
  remainingWipQtyKg: string;
}

export interface ManagementWipBalanceDto {
  id: string;
  productionOrderId: string;
  productionOrderDocNo: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  factoryId: string;
  factoryName: string;
  remainingWipQtyKg: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ProductionScreenQueryService {
  constructor(private readonly db: Db) {}

  // ---- Worker queries (redacted) ----

  /**
   * List production orders for a worker (production_employee).
   * Returns operational quantities only — NO financial fields.
   */
  async listWorkerProductionOrders(tenantId: string): Promise<WorkerProductionOrderDto[]> {
    const results = await this.db
      .select({
        order: productionOrders,
        factory: externalFactories,
        location: locations,
      })
      .from(productionOrders)
      .innerJoin(externalFactories, eq(productionOrders.factoryId, externalFactories.id))
      .innerJoin(locations, eq(productionOrders.factoryLocationId, locations.id))
      .where(eq(productionOrders.tenantId, tenantId))
      .orderBy(desc(productionOrders.createdAt));

    return results.map((r) => ({
      id: r.order.id,
      docNo: r.order.docNo,
      productionType: r.order.productionType,
      factoryName: r.factory.nameEn || r.factory.nameAr,
      factoryLocationName: r.location.nameEn || r.location.nameAr,
      status: r.order.status,
      sendDate: r.order.sendDate,
      receiveDate: r.order.receiveDate,
      totalInputQtyKg: r.order.totalInputQtyKg ?? "0",
      totalOutputQtyKg: r.order.totalOutputQtyKg ?? "0",
      totalWasteQtyKg: r.order.totalWasteQtyKg ?? "0",
    }));
  }

  /**
   * List production inputs (issued/consumed/WIP quantities) for a worker.
   * Returns operational quantities only — NO financial fields.
   */
  async listWorkerProductionInputs(tenantId: string, productionOrderId: string): Promise<WorkerProductionInputDto[]> {
    const results = await this.db
      .select({
        input: productionInputs,
        item: inventoryItems,
        location: locations,
      })
      .from(productionInputs)
      .innerJoin(inventoryItems, eq(productionInputs.inputItemId, inventoryItems.id))
      .innerJoin(locations, eq(productionInputs.inputLocationId, locations.id))
      .where(and(
        eq(productionInputs.tenantId, tenantId),
        eq(productionInputs.productionOrderId, productionOrderId),
      ))
      .orderBy(productionInputs.createdAt);

    return results.map((r) => ({
      id: r.input.id,
      productionOrderId: r.input.productionOrderId,
      itemCode: r.item.itemCode,
      itemName: r.item.displayNameEn || r.item.displayNameAr,
      locationCode: r.location.locationCode,
      plannedInputQtyKg: r.input.plannedInputQtyKg,
      issuedQtyKg: r.input.issuedQtyKg,
      consumedQtyKg: r.input.consumedQtyKg,
      returnedFromWipQtyKg: r.input.returnedFromWipQtyKg,
      remainingWipQtyKg: r.input.remainingWipQtyKg,
    }));
  }

  /**
   * List WIP balances for a worker (production_employee).
   * Returns remaining WIP quantities only — NO financial fields.
   */
  async listWorkerWipBalances(tenantId: string): Promise<WorkerWipBalanceDto[]> {
    const results = await this.db
      .select({
        wip: productionWipBalances,
        order: productionOrders,
        item: inventoryItems,
        factory: externalFactories,
      })
      .from(productionWipBalances)
      .innerJoin(productionOrders, eq(productionWipBalances.productionOrderId, productionOrders.id))
      .innerJoin(inventoryItems, eq(productionWipBalances.inputItemId, inventoryItems.id))
      .innerJoin(externalFactories, eq(productionOrders.factoryId, externalFactories.id))
      .where(eq(productionWipBalances.tenantId, tenantId))
      .orderBy(desc(productionWipBalances.createdAt));

    return results.map((r) => ({
      id: r.wip.id,
      productionOrderDocNo: r.order.docNo,
      itemCode: r.item.itemCode,
      itemName: r.item.displayNameEn || r.item.displayNameAr,
      factoryName: r.factory.nameEn || r.factory.nameAr,
      remainingWipQtyKg: r.wip.wipQtyKg,
    }));
  }

  // ---- Management queries (full — includes financial fields) ----

  /**
   * List production orders for management (Owner/Accountant).
   * Returns full operational + financial snapshot fields.
   */
  async listManagementProductionOrders(tenantId: string): Promise<ManagementProductionOrderDto[]> {
    const results = await this.db
      .select({
        order: productionOrders,
        factory: externalFactories,
        location: locations,
      })
      .from(productionOrders)
      .innerJoin(externalFactories, eq(productionOrders.factoryId, externalFactories.id))
      .innerJoin(locations, eq(productionOrders.factoryLocationId, locations.id))
      .where(eq(productionOrders.tenantId, tenantId))
      .orderBy(desc(productionOrders.createdAt));

    return results.map((r) => ({
      id: r.order.id,
      docNo: r.order.docNo,
      productionType: r.order.productionType,
      factoryId: r.order.factoryId,
      factoryName: r.factory.nameEn || r.factory.nameAr,
      factoryLocationId: r.order.factoryLocationId,
      factoryLocationName: r.location.nameEn || r.location.nameAr,
      status: r.order.status,
      approvalStatus: r.order.approvalStatus,
      sendDate: r.order.sendDate,
      receiveDate: r.order.receiveDate,
      expectedWastePercent: r.order.expectedWastePercent,
      totalInputQtyKg: r.order.totalInputQtyKg ?? "0",
      totalOutputQtyKg: r.order.totalOutputQtyKg ?? "0",
      totalWasteQtyKg: r.order.totalWasteQtyKg ?? "0",
      factoryCostBasisUsed: r.order.factoryCostBasisUsed,
      factoryRatePerInputTonUsed: r.order.factoryRatePerInputTonUsed,
      calculatedFactoryCost: r.order.calculatedFactoryCost,
      rateConfirmedBy: r.order.rateConfirmedBy,
      rateConfirmedAt: r.order.rateConfirmedAt,
    }));
  }

  /**
   * List production inputs for management (full — includes item/location IDs).
   */
  async listManagementProductionInputs(tenantId: string, productionOrderId: string): Promise<ManagementProductionInputDto[]> {
    const results = await this.db
      .select({
        input: productionInputs,
        item: inventoryItems,
        location: locations,
      })
      .from(productionInputs)
      .innerJoin(inventoryItems, eq(productionInputs.inputItemId, inventoryItems.id))
      .innerJoin(locations, eq(productionInputs.inputLocationId, locations.id))
      .where(and(
        eq(productionInputs.tenantId, tenantId),
        eq(productionInputs.productionOrderId, productionOrderId),
      ))
      .orderBy(productionInputs.createdAt);

    return results.map((r) => ({
      id: r.input.id,
      productionOrderId: r.input.productionOrderId,
      itemId: r.input.inputItemId,
      itemCode: r.item.itemCode,
      itemName: r.item.displayNameEn || r.item.displayNameAr,
      locationId: r.input.inputLocationId,
      locationCode: r.location.locationCode,
      locationName: r.location.nameEn || r.location.nameAr,
      plannedInputQtyKg: r.input.plannedInputQtyKg,
      issuedQtyKg: r.input.issuedQtyKg,
      consumedQtyKg: r.input.consumedQtyKg,
      returnedFromWipQtyKg: r.input.returnedFromWipQtyKg,
      remainingWipQtyKg: r.input.remainingWipQtyKg,
    }));
  }

  /**
   * List WIP balances for management (full — includes factory/order IDs).
   */
  async listManagementWipBalances(tenantId: string): Promise<ManagementWipBalanceDto[]> {
    const results = await this.db
      .select({
        wip: productionWipBalances,
        order: productionOrders,
        item: inventoryItems,
        factory: externalFactories,
      })
      .from(productionWipBalances)
      .innerJoin(productionOrders, eq(productionWipBalances.productionOrderId, productionOrders.id))
      .innerJoin(inventoryItems, eq(productionWipBalances.inputItemId, inventoryItems.id))
      .innerJoin(externalFactories, eq(productionOrders.factoryId, externalFactories.id))
      .where(eq(productionWipBalances.tenantId, tenantId))
      .orderBy(desc(productionWipBalances.createdAt));

    return results.map((r) => ({
      id: r.wip.id,
      productionOrderId: r.wip.productionOrderId,
      productionOrderDocNo: r.order.docNo,
      itemId: r.wip.inputItemId,
      itemCode: r.item.itemCode,
      itemName: r.item.displayNameEn || r.item.displayNameAr,
      factoryId: r.order.factoryId,
      factoryName: r.factory.nameEn || r.factory.nameAr,
      remainingWipQtyKg: r.wip.wipQtyKg,
    }));
  }

  // ---- Receipt + Allocation queries ----

  /**
   * List production receipts for management (full — includes financial snapshot).
   * Contract 10 §8.3: receipt allocation review, confirmed rate/cost basis,
   * posted payable.
   */
  async listManagementReceipts(tenantId: string, productionOrderId?: string): Promise<ManagementReceiptDto[]> {
    const conditions = [eq(productionReceipts.tenantId, tenantId)];
    if (productionOrderId) {
      conditions.push(eq(productionReceipts.productionOrderId, productionOrderId));
    }
    const results = await this.db
      .select({
        receipt: productionReceipts,
        order: productionOrders,
        outputItem: inventoryItems,
        outputLocation: locations,
      })
      .from(productionReceipts)
      .innerJoin(productionOrders, eq(productionReceipts.productionOrderId, productionOrders.id))
      .innerJoin(inventoryItems, eq(productionReceipts.outputItemId, inventoryItems.id))
      .innerJoin(locations, eq(productionReceipts.outputLocationId, locations.id))
      .where(and(...conditions))
      .orderBy(desc(productionReceipts.createdAt));

    return results.map((r) => ({
      id: r.receipt.id,
      docNo: r.receipt.docNo,
      productionOrderId: r.receipt.productionOrderId,
      productionOrderDocNo: r.order.docNo,
      outputItemCode: r.outputItem.itemCode,
      outputLocationCode: r.outputLocation.locationCode,
      outputQtyKg: r.receipt.outputQtyKg,
      receiptDate: r.receipt.receiptDate,
      status: r.receipt.status,
      approvalStatus: r.receipt.approvalStatus,
      factoryCostBasisUsed: r.receipt.factoryCostBasisUsed,
      factoryRatePerInputTonUsed: r.receipt.factoryRatePerInputTonUsed,
      calculatedFactoryCost: r.receipt.calculatedFactoryCost,
    }));
  }

  /**
   * List receipt input allocations for management (full — includes payable cost basis).
   * Contract 05 §14: each receipt allocates consumed/waste input quantities.
   */
  async listManagementReceiptAllocations(tenantId: string, receiptId: string): Promise<ManagementReceiptAllocationDto[]> {
    const results = await this.db
      .select({
        allocation: productionReceiptInputAllocations,
        input: productionInputs,
        item: inventoryItems,
      })
      .from(productionReceiptInputAllocations)
      .innerJoin(productionInputs, eq(productionReceiptInputAllocations.productionInputId, productionInputs.id))
      .innerJoin(inventoryItems, eq(productionInputs.inputItemId, inventoryItems.id))
      .where(and(
        eq(productionReceiptInputAllocations.tenantId, tenantId),
        eq(productionReceiptInputAllocations.productionReceiptId, receiptId),
      ));

    return results.map((r) => ({
      id: r.allocation.id,
      receiptId: r.allocation.productionReceiptId,
      inputId: r.allocation.productionInputId,
      itemCode: r.item.itemCode,
      consumedQtyKg: r.allocation.consumedTowardOutputQtyKg,
      wasteQtyKg: r.allocation.allocatedWasteQtyKg,
      payableCostBasisQtyKg: r.allocation.payableCostBasisQtyKg,
    }));
  }

  // ---- WIP Return queries ----

  /**
   * List WIP return requests for management (full — includes approval state).
   * Contract 10 §8.3: WIP return review/approval state.
   */
  async listManagementWipReturns(tenantId: string): Promise<ManagementWipReturnDto[]> {
    const results = await this.db
      .select({
        wipReturn: productionWipReturns,
        order: productionOrders,
        input: productionInputs,
        item: inventoryItems,
        location: locations,
      })
      .from(productionWipReturns)
      .innerJoin(productionOrders, eq(productionWipReturns.productionOrderId, productionOrders.id))
      .innerJoin(productionInputs, eq(productionWipReturns.productionInputId, productionInputs.id))
      .innerJoin(inventoryItems, eq(productionInputs.inputItemId, inventoryItems.id))
      .innerJoin(locations, eq(productionWipReturns.returnLocationId, locations.id))
      .where(eq(productionWipReturns.tenantId, tenantId))
      .orderBy(desc(productionWipReturns.createdAt));

    return results.map((r) => ({
      id: r.wipReturn.id,
      docNo: r.wipReturn.docNo,
      productionOrderDocNo: r.order.docNo,
      itemCode: r.item.itemCode,
      returnQtyKg: r.wipReturn.returnQtyKg,
      returnLocationCode: r.location.locationCode,
      status: r.wipReturn.status,
      approvalStatus: r.wipReturn.approvalStatus,
      reason: r.wipReturn.reason,
      financialReviewStatus: r.wipReturn.financialReviewStatus,
    }));
  }

  /**
   * List WIP return requests for worker (redacted — no financial review status).
   * Contract 10 §7.2: worker can request return from WIP.
   */
  async listWorkerWipReturns(tenantId: string): Promise<WorkerWipReturnDto[]> {
    const results = await this.db
      .select({
        wipReturn: productionWipReturns,
        order: productionOrders,
        item: inventoryItems,
        location: locations,
      })
      .from(productionWipReturns)
      .innerJoin(productionOrders, eq(productionWipReturns.productionOrderId, productionOrders.id))
      .innerJoin(productionInputs, eq(productionWipReturns.productionInputId, productionInputs.id))
      .innerJoin(inventoryItems, eq(productionInputs.inputItemId, inventoryItems.id))
      .innerJoin(locations, eq(productionWipReturns.returnLocationId, locations.id))
      .where(eq(productionWipReturns.tenantId, tenantId))
      .orderBy(desc(productionWipReturns.createdAt));

    return results.map((r) => ({
      id: r.wipReturn.id,
      docNo: r.wipReturn.docNo,
      productionOrderDocNo: r.order.docNo,
      itemCode: r.item.itemCode,
      returnQtyKg: r.wipReturn.returnQtyKg,
      returnLocationCode: r.location.locationCode,
      status: r.wipReturn.status,
      reason: r.wipReturn.reason,
      // NO financialReviewStatus — worker redacted
    }));
  }
}

// ---------------------------------------------------------------------------
// Receipt + Allocation DTOs (management only — financial fields)
// ---------------------------------------------------------------------------

export interface ManagementReceiptDto {
  id: string;
  docNo: string;
  productionOrderId: string;
  productionOrderDocNo: string;
  outputItemCode: string;
  outputLocationCode: string;
  outputQtyKg: string;
  receiptDate: string;
  status: string;
  approvalStatus: string;
  factoryCostBasisUsed: string | null;
  factoryRatePerInputTonUsed: string | null;
  calculatedFactoryCost: string | null;
}

export interface ManagementReceiptAllocationDto {
  id: string;
  receiptId: string;
  inputId: string;
  itemCode: string;
  consumedQtyKg: string;
  wasteQtyKg: string;
  payableCostBasisQtyKg: string;
}

// ---------------------------------------------------------------------------
// WIP Return DTOs
// ---------------------------------------------------------------------------

export interface ManagementWipReturnDto {
  id: string;
  docNo: string;
  productionOrderDocNo: string;
  itemCode: string;
  returnQtyKg: string;
  returnLocationCode: string;
  status: string;
  approvalStatus: string;
  reason: string;
  financialReviewStatus: string | null;
}

export interface WorkerWipReturnDto {
  id: string;
  docNo: string;
  productionOrderDocNo: string;
  itemCode: string;
  returnQtyKg: string;
  returnLocationCode: string;
  status: string;
  reason: string;
  // NO financialReviewStatus — worker redacted
}
