/**
 * Drizzle-backed ProductionReceiptRepository — the production DB repository.
 *
 * WP-04-02: DB-backed implementation for production_receipts +
 * production_receipt_input_allocations.
 * WP-04-03: approve/post methods + waste entry persistence + output row link.
 */
import "server-only";
import { eq, and, inArray } from "drizzle-orm";
import {
  productionReceipts,
  productionReceiptInputAllocations,
  productionWasteEntries,
} from "@/server/db/schema";
import { productionOutputs } from "@/server/db/schema/production-orders";
import type { db as DbType } from "@/server/db/client";
import type {
  ProductionReceiptRepository,
  NewReceiptDraftInput,
  NewAllocationInput,
  ReceiptApprovalPatch,
  NewWasteEntryInput,
  OutputReceiptLinkPatch,
} from "./production-receipt-repository";
import type { ProductionReceipt, ProductionReceiptInputAllocation, ProductionWasteEntry } from "@/server/db/schema/production-receipts";
import type { ProductionOutput } from "@/server/db/schema/production-orders";

type Db = NonNullable<typeof DbType>;

export class ProductionReceiptDbRepository implements ProductionReceiptRepository {
  constructor(private readonly db: Db) {}

  async insertReceipt(row: NewReceiptDraftInput): Promise<ProductionReceipt> {
    const [result] = await this.db
      .insert(productionReceipts)
      .values({
        tenantId: row.tenantId,
        docNo: row.docNo,
        productionOrderId: row.productionOrderId,
        outputItemId: row.outputItemId,
        outputLotId: row.outputLotId,
        outputLocationId: row.outputLocationId,
        outputQtyKg: row.outputQtyKg,
        receiptDate: row.receiptDate,
        status: "draft",
        approvalStatus: "draft",
        factoryCostBasisUsed: row.factoryCostBasisUsed,
        factoryRatePerInputTonUsed: row.factoryRatePerInputTonUsed,
        idempotencyKey: row.idempotencyKey,
        notes: row.notes,
        createdBy: row.createdBy,
        subjectHash: row.subjectHash,
        subjectVersion: row.subjectVersion,
      })
      .returning();
    return result!;
  }

  async insertAllocation(row: NewAllocationInput): Promise<ProductionReceiptInputAllocation> {
    const payableBasis = (
      parseFloat(row.consumedTowardOutputQtyKg) + parseFloat(row.allocatedWasteQtyKg)
    ).toFixed(3);
    const [result] = await this.db
      .insert(productionReceiptInputAllocations)
      .values({
        tenantId: row.tenantId,
        productionReceiptId: row.productionReceiptId,
        productionInputId: row.productionInputId,
        consumedTowardOutputQtyKg: row.consumedTowardOutputQtyKg,
        allocatedWasteQtyKg: row.allocatedWasteQtyKg,
        payableCostBasisQtyKg: payableBasis,
      })
      .returning();
    return result!;
  }

  async findReceiptById(tenantId: string, id: string): Promise<ProductionReceipt | null> {
    const [result] = await this.db
      .select()
      .from(productionReceipts)
      .where(and(eq(productionReceipts.tenantId, tenantId), eq(productionReceipts.id, id)))
      .limit(1);
    return result ?? null;
  }

  async findAllocationsByReceipt(tenantId: string, receiptId: string): Promise<ProductionReceiptInputAllocation[]> {
    const results = await this.db
      .select()
      .from(productionReceiptInputAllocations)
      .where(and(eq(productionReceiptInputAllocations.tenantId, tenantId), eq(productionReceiptInputAllocations.productionReceiptId, receiptId)));
    return results;
  }

  async findReceiptsByOrder(tenantId: string, orderId: string): Promise<ProductionReceipt[]> {
    const results = await this.db
      .select()
      .from(productionReceipts)
      .where(and(eq(productionReceipts.tenantId, tenantId), eq(productionReceipts.productionOrderId, orderId)));
    return results;
  }

  async findAllocationsByInput(tenantId: string, productionInputId: string): Promise<ProductionReceiptInputAllocation[]> {
    const results = await this.db
      .select()
      .from(productionReceiptInputAllocations)
      .where(and(eq(productionReceiptInputAllocations.tenantId, tenantId), eq(productionReceiptInputAllocations.productionInputId, productionInputId)));
    return results;
  }

  // -------------------------------------------------------------------------
  // WP-04-03 approval/posting methods.
  // -------------------------------------------------------------------------

  async markApprovedConditional(
    tenantId: string,
    receiptId: string,
    patch: ReceiptApprovalPatch,
    expectedCurrentStatuses: ReadonlyArray<string>,
  ): Promise<ProductionReceipt | null> {
    // Conditional UPDATE: WHERE tenant_id = ? AND id = ? AND status IN (?) AND is_locked = false.
    // Drizzle's inArray + eq combined with the .returning() pattern gives us
    // an atomic check-and-update. If 0 rows returned, the precondition did
    // not match (concurrent approval won or status changed).
    //
    // The status column is a PgEnumColumn; inArray requires the enum's
    // string-literal union type. We cast through unknown to satisfy TS
    // while preserving runtime behavior — the values in
    // expectedCurrentStatuses are valid enum literals by contract.
    const statusValues = [...expectedCurrentStatuses] as unknown as
      ("draft" | "material_issued" | "partially_received" | "completed" | "correction_requested" | "cancelled" | "reversed")[];
    const [result] = await this.db
      .update(productionReceipts)
      .set({
        status: patch.status,
        approvalStatus: patch.approvalStatus,
        isLocked: patch.isLocked,
        confirmedBy: patch.confirmedBy,
        confirmedAt: patch.confirmedAt,
        receiptMovementId: patch.receiptMovementId,
        accountEntryId: patch.accountEntryId,
        factoryPayable: patch.factoryPayable,
        calculatedFactoryCost: patch.calculatedFactoryCost,
        factoryCostBasisInputQtyKg: patch.factoryCostBasisInputQtyKg,
        calculationVersion: patch.calculationVersion,
        updatedBy: patch.confirmedBy,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(productionReceipts.tenantId, tenantId),
          eq(productionReceipts.id, receiptId),
          inArray(productionReceipts.status, statusValues),
          eq(productionReceipts.isLocked, false),
        ),
      )
      .returning();
    return result ?? null;
  }

  async insertWasteEntry(row: NewWasteEntryInput): Promise<ProductionWasteEntry> {
    const [result] = await this.db
      .insert(productionWasteEntries)
      .values({
        tenantId: row.tenantId,
        productionOrderId: row.productionOrderId,
        productionInputId: row.productionInputId,
        productionReceiptId: row.productionReceiptId,
        wasteQtyKg: row.wasteQtyKg,
        wastePercent: row.wastePercent,
        wasteReason: row.wasteReason,
        movementId: row.movementId,
      })
      .returning();
    return result!;
  }

  async findOutputForReceipt(
    tenantId: string,
    productionOrderId: string,
    outputItemId: string,
    outputLocationId: string,
  ): Promise<ProductionOutput | null> {
    const [result] = await this.db
      .select()
      .from(productionOutputs)
      .where(
        and(
          eq(productionOutputs.tenantId, tenantId),
          eq(productionOutputs.productionOrderId, productionOrderId),
          eq(productionOutputs.outputItemId, outputItemId),
          eq(productionOutputs.outputLocationId, outputLocationId),
        ),
      )
      .limit(1);
    return result ?? null;
  }

  async linkOutputToReceiptMovement(
    tenantId: string,
    outputId: string,
    patch: OutputReceiptLinkPatch,
  ): Promise<ProductionOutput | null> {
    const [result] = await this.db
      .update(productionOutputs)
      .set({ receiptMovementId: patch.receiptMovementId, updatedAt: new Date() })
      .where(
        and(
          eq(productionOutputs.tenantId, tenantId),
          eq(productionOutputs.id, outputId),
        ),
      )
      .returning();
    return result ?? null;
  }

  async insertOutputRow(row: {
    tenantId: string; productionOrderId: string; outputItemId: string;
    outputLotId: string | null; outputLocationId: string; outputQtyKg: string;
    receiptMovementId: string; createdBy: string;
  }): Promise<ProductionOutput> {
    const [result] = await this.db
      .insert(productionOutputs)
      .values({
        tenantId: row.tenantId,
        productionOrderId: row.productionOrderId,
        outputItemId: row.outputItemId,
        outputLotId: row.outputLotId,
        outputLocationId: row.outputLocationId,
        outputQtyKg: row.outputQtyKg,
        receiptMovementId: row.receiptMovementId,
        createdBy: row.createdBy,
      })
      .returning();
    return result!;
  }
}

export function createProductionReceiptDbRepository(db: Db): ProductionReceiptDbRepository {
  return new ProductionReceiptDbRepository(db);
}
