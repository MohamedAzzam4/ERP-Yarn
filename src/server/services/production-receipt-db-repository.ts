/**
 * Drizzle-backed ProductionReceiptRepository — the production DB repository.
 *
 * WP-04-02: DB-backed implementation for production_receipts +
 * production_receipt_input_allocations.
 */
import "server-only";
import { eq, and } from "drizzle-orm";
import { productionReceipts, productionReceiptInputAllocations } from "@/server/db/schema";
import type { db as DbType } from "@/server/db/client";
import type {
  ProductionReceiptRepository,
  NewReceiptDraftInput,
  NewAllocationInput,
} from "./production-receipt-repository";
import type { ProductionReceipt, ProductionReceiptInputAllocation } from "@/server/db/schema/production-receipts";

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
}

export function createProductionReceiptDbRepository(db: Db): ProductionReceiptDbRepository {
  return new ProductionReceiptDbRepository(db);
}
