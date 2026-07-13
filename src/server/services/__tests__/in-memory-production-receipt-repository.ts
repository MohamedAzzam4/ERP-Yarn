/**
 * In-memory ProductionReceiptRepository for unit tests.
 * TEST-ONLY helper. NOT for production use.
 */
import type { ProductionReceipt, ProductionReceiptInputAllocation, ProductionWasteEntry } from "@/server/db/schema/production-receipts";
import type { ProductionOutput } from "@/server/db/schema/production-orders";
import type {
  ProductionReceiptRepository,
  NewReceiptDraftInput,
  NewAllocationInput,
  ReceiptApprovalPatch,
  NewWasteEntryInput,
  OutputReceiptLinkPatch,
} from "../production-receipt-repository";

const NOW = () => new Date("2026-07-01T00:00:00Z");
const nid = (p: string, n: number) => `${p}-${n.toString().padStart(6, "0")}`;

export class InMemoryProductionReceiptRepository implements ProductionReceiptRepository {
  private receipts = new Map<string, ProductionReceipt>();
  private allocations = new Map<string, ProductionReceiptInputAllocation>();
  private wasteEntries = new Map<string, ProductionWasteEntry>();
  private outputs = new Map<string, ProductionOutput>();
  private receiptCounter = 0;
  private allocCounter = 0;
  private wasteCounter = 0;
  private outputCounter = 0;

  /**
   * Snapshot for transactional test rollback.
   * TEST-ONLY.
   */
  snapshot() {
    return {
      receipts: new Map([...this.receipts].map(([k, v]) => [k, { ...v }])),
      allocations: new Map([...this.allocations].map(([k, v]) => [k, { ...v }])),
      wasteEntries: new Map([...this.wasteEntries].map(([k, v]) => [k, { ...v }])),
      outputs: new Map([...this.outputs].map(([k, v]) => [k, { ...v }])),
      receiptCounter: this.receiptCounter,
      allocCounter: this.allocCounter,
      wasteCounter: this.wasteCounter,
      outputCounter: this.outputCounter,
    };
  }

  /**
   * Restore from snapshot. TEST-ONLY.
   */
  restore(s: {
    receipts: Map<string, ProductionReceipt>;
    allocations: Map<string, ProductionReceiptInputAllocation>;
    wasteEntries: Map<string, ProductionWasteEntry>;
    outputs: Map<string, ProductionOutput>;
    receiptCounter: number;
    allocCounter: number;
    wasteCounter: number;
    outputCounter: number;
  }): void {
    const restoreMap = <T>(src: Map<string, T>): Map<string, T> => {
      const dst = new Map<string, T>();
      for (const [k, v] of src) dst.set(k, { ...(v as object) } as T);
      return dst;
    };
    this.receipts = restoreMap(s.receipts);
    this.allocations = restoreMap(s.allocations);
    this.wasteEntries = restoreMap(s.wasteEntries);
    this.outputs = restoreMap(s.outputs);
    this.receiptCounter = s.receiptCounter;
    this.allocCounter = s.allocCounter;
    this.wasteCounter = s.wasteCounter;
    this.outputCounter = s.outputCounter;
  }

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
      subjectHash: row.subjectHash,
      subjectVersion: row.subjectVersion,
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
    const r = this.receipts.get(`${tenantId}:${id}`);
    return r ? { ...r } : null;
  }

  async findAllocationsByReceipt(tenantId: string, receiptId: string): Promise<ProductionReceiptInputAllocation[]> {
    return [...this.allocations.values()].filter(
      (a) => a.tenantId === tenantId && a.productionReceiptId === receiptId,
    ).map(a => ({ ...a }));
  }

  async findReceiptsByOrder(tenantId: string, orderId: string): Promise<ProductionReceipt[]> {
    return [...this.receipts.values()].filter(
      (r) => r.tenantId === tenantId && r.productionOrderId === orderId,
    ).map(r => ({ ...r }));
  }

  async findAllocationsByInput(tenantId: string, productionInputId: string): Promise<ProductionReceiptInputAllocation[]> {
    return [...this.allocations.values()].filter(
      (a) => a.tenantId === tenantId && a.productionInputId === productionInputId,
    ).map(a => ({ ...a }));
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
    const key = `${tenantId}:${receiptId}`;
    const receipt = this.receipts.get(key);
    if (!receipt) return null;
    // Conditional WHERE: status must be in expectedCurrentStatuses AND is_locked = false.
    if (!expectedCurrentStatuses.includes(receipt.status)) return null;
    if (receipt.isLocked) return null;
    const updated: ProductionReceipt = {
      ...receipt,
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
      updatedAt: NOW(),
    };
    this.receipts.set(key, updated);
    return { ...updated };
  }

  async insertWasteEntry(row: NewWasteEntryInput): Promise<ProductionWasteEntry> {
    this.wasteCounter++;
    const id = nid("waste", this.wasteCounter);
    const entry: ProductionWasteEntry = {
      id, tenantId: row.tenantId,
      productionOrderId: row.productionOrderId,
      productionInputId: row.productionInputId,
      productionReceiptId: row.productionReceiptId,
      wasteQtyKg: row.wasteQtyKg,
      wastePercent: row.wastePercent,
      wasteReason: row.wasteReason,
      movementId: row.movementId,
      createdBy: null, createdAt: NOW(),
      updatedBy: null, updatedAt: null,
    };
    this.wasteEntries.set(`${row.tenantId}:${id}`, entry);
    return { ...entry };
  }

  /** Test helper: list waste entries for a receipt. */
  async findWasteEntriesByReceipt(tenantId: string, receiptId: string): Promise<ProductionWasteEntry[]> {
    return [...this.wasteEntries.values()].filter(
      (w) => w.tenantId === tenantId && w.productionReceiptId === receiptId,
    ).map(w => ({ ...w }));
  }

  async findOutputForReceipt(
    tenantId: string,
    productionOrderId: string,
    outputItemId: string,
    outputLocationId: string,
  ): Promise<ProductionOutput | null> {
    for (const o of this.outputs.values()) {
      if (o.tenantId === tenantId && o.productionOrderId === productionOrderId
          && o.outputItemId === outputItemId && o.outputLocationId === outputLocationId) {
        return { ...o };
      }
    }
    return null;
  }

  async linkOutputToReceiptMovement(
    tenantId: string,
    outputId: string,
    patch: OutputReceiptLinkPatch,
  ): Promise<ProductionOutput | null> {
    const key = `${tenantId}:${outputId}`;
    const output = this.outputs.get(key);
    if (!output) return null;
    const updated = { ...output, receiptMovementId: patch.receiptMovementId, updatedAt: NOW() };
    this.outputs.set(key, updated);
    return { ...updated };
  }

  async insertOutputRow(row: {
    tenantId: string; productionOrderId: string; outputItemId: string;
    outputLotId: string | null; outputLocationId: string; outputQtyKg: string;
    receiptMovementId: string; createdBy: string;
  }): Promise<ProductionOutput> {
    this.outputCounter++;
    const id = nid("pout", this.outputCounter);
    const output: ProductionOutput = {
      id, tenantId: row.tenantId,
      productionOrderId: row.productionOrderId,
      outputItemId: row.outputItemId,
      outputLotId: row.outputLotId,
      outputLocationId: row.outputLocationId,
      outputQtyKg: row.outputQtyKg,
      receiptMovementId: row.receiptMovementId,
      createdBy: row.createdBy, createdAt: NOW(),
      updatedBy: null, updatedAt: null,
    };
    this.outputs.set(`${row.tenantId}:${id}`, output);
    return { ...output };
  }

  /** Test helper: list all outputs for an order. */
  async findOutputsByOrder(tenantId: string, orderId: string): Promise<ProductionOutput[]> {
    return [...this.outputs.values()].filter(
      (o) => o.tenantId === tenantId && o.productionOrderId === orderId,
    ).map(o => ({ ...o }));
  }
}
