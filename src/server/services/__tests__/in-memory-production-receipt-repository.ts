/**
 * In-memory ProductionReceiptRepository for unit tests.
 * TEST-ONLY helper. NOT for production use.
 */
import type { ProductionReceipt, ProductionReceiptInputAllocation } from "@/server/db/schema/production-receipts";
import type {
  ProductionReceiptRepository,
  NewReceiptDraftInput,
  NewAllocationInput,
} from "../production-receipt-repository";

const NOW = () => new Date("2026-07-01T00:00:00Z");
const nid = (p: string, n: number) => `${p}-${n.toString().padStart(6, "0")}`;

export class InMemoryProductionReceiptRepository implements ProductionReceiptRepository {
  private receipts = new Map<string, ProductionReceipt>();
  private allocations = new Map<string, ProductionReceiptInputAllocation>();
  private receiptCounter = 0;
  private allocCounter = 0;

  async insertReceipt(row: NewReceiptDraftInput): Promise<ProductionReceipt> {
    this.receiptCounter++;
    const id = nid("rcpt", this.receiptCounter);
    const receipt: ProductionReceipt = {
      id, tenantId: row.tenantId, docNo: row.docNo,
      productionOrderId: row.productionOrderId,
      outputItemId: row.outputItemId,
      outputLotId: row.outputLotId,
      outputLocationId: row.outputLocationId,
      outputQtyKg: row.outputQtyKg,
      receiptDate: row.receiptDate,
      status: "draft", approvalStatus: "draft",
      payableTriggerUsed: "production_receipt_approval",
      factoryCostBasisUsed: row.factoryCostBasisUsed,
      factoryRatePerInputTonUsed: row.factoryRatePerInputTonUsed,
      factoryCostBasisInputQtyKg: null,
      calculatedFactoryCost: null,
      calculationVersion: null,
      factoryPayable: null,
      accountEntryId: null,
      idempotencyKey: row.idempotencyKey,
      approvalRequestId: null,
      receiptMovementId: null,
      notes: row.notes,
      confirmedBy: null, confirmedAt: null,
      recordOrigin: "manual_live", recordPeriod: "live",
      isLocked: false, importBatchId: null,
      createdBy: row.createdBy, createdAt: NOW(),
      updatedBy: null, updatedAt: null,
    };
    this.receipts.set(`${row.tenantId}:${id}`, receipt);
    return receipt;
  }

  async insertAllocation(row: NewAllocationInput): Promise<ProductionReceiptInputAllocation> {
    this.allocCounter++;
    const id = nid("alloc", this.allocCounter);
    const alloc: ProductionReceiptInputAllocation = {
      id, tenantId: row.tenantId,
      productionReceiptId: row.productionReceiptId,
      productionInputId: row.productionInputId,
      consumedTowardOutputQtyKg: row.consumedTowardOutputQtyKg,
      allocatedWasteQtyKg: row.allocatedWasteQtyKg,
      payableCostBasisQtyKg: (
        parseFloat(row.consumedTowardOutputQtyKg) + parseFloat(row.allocatedWasteQtyKg)
      ).toFixed(3),
      createdBy: null, createdAt: NOW(),
      updatedBy: null, updatedAt: null,
    };
    this.allocations.set(`${row.tenantId}:${id}`, alloc);
    return alloc;
  }

  async findReceiptById(tenantId: string, id: string): Promise<ProductionReceipt | null> {
    return this.receipts.get(`${tenantId}:${id}`) ?? null;
  }

  async findAllocationsByReceipt(tenantId: string, receiptId: string): Promise<ProductionReceiptInputAllocation[]> {
    return [...this.allocations.values()].filter(
      (a) => a.tenantId === tenantId && a.productionReceiptId === receiptId,
    );
  }

  async findReceiptsByOrder(tenantId: string, orderId: string): Promise<ProductionReceipt[]> {
    return [...this.receipts.values()].filter(
      (r) => r.tenantId === tenantId && r.productionOrderId === orderId,
    );
  }

  async findAllocationsByInput(tenantId: string, productionInputId: string): Promise<ProductionReceiptInputAllocation[]> {
    return [...this.allocations.values()].filter(
      (a) => a.tenantId === tenantId && a.productionInputId === productionInputId,
    );
  }
}
