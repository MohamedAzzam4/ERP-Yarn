/**
 * In-memory ProductionOrderRepository for unit tests.
 * TEST-ONLY helper. NOT for production use.
 */
import type { ProductionOrder, ProductionInput } from "@/server/db/schema/production-orders";
import type {
  ProductionOrderRepository,
  NewProductionOrderInput,
  NewProductionInputRow,
} from "../production-order-repository";

const NOW = () => new Date("2026-07-01T00:00:00Z");
const nid = (p: string, n: number) => `${p}-${n.toString().padStart(6, "0")}`;

export class InMemoryProductionOrderRepository implements ProductionOrderRepository {
  private orders = new Map<string, ProductionOrder>();
  private inputs = new Map<string, ProductionInput>();
  private orderCounter = 0;
  private inputCounter = 0;

  snapshot() {
    return {
      orders: new Map([...this.orders].map(([k, v]) => [k, { ...v }])),
      inputs: new Map([...this.inputs].map(([k, v]) => [k, { ...v }])),
      orderCounter: this.orderCounter,
      inputCounter: this.inputCounter,
    };
  }

  restore(s: any) {
    this.orders = new Map([...s.orders].map(([k, v]: any) => [k, { ...v }]));
    this.inputs = new Map([...s.inputs].map(([k, v]: any) => [k, { ...v }]));
    this.orderCounter = s.orderCounter;
    this.inputCounter = s.inputCounter;
  }

  async insertOrder(row: NewProductionOrderInput): Promise<ProductionOrder> {
    this.orderCounter++;
    const id = nid("prod", this.orderCounter);
    const order: ProductionOrder = {
      id, tenantId: row.tenantId, docNo: row.docNo,
      productionType: row.productionType, factoryId: row.factoryId,
      factoryLocationId: row.factoryLocationId, status: "draft",
      approvalStatus: "draft", sendDate: null, receiveDate: null,
      expectedWastePercent: null,
      totalInputQtyKg: "0", totalOutputQtyKg: "0", totalWasteQtyKg: "0",
      payableTriggerUsed: "production_receipt_approval",
      factoryCostBasisUsed: "input_quantity",
      factoryRatePerInputTonUsed: null, calculationVersion: null,
      calculatedFactoryCost: null, rateConfirmedBy: null, rateConfirmedAt: null,
      importedTotalFactoryCost: null, erpCalculatedFactoryCost: null,
      historicalCostBasisSource: null, sourceFormulaText: null,
      sourceCalculatedValue: null, costDifferenceAmount: null,
      costDifferencePercent: null, migrationWarning: null,
      recordOrigin: "manual_live", recordPeriod: "live",
      isLocked: false, importBatchId: null, reversalOfId: null,
      correctionOfId: null, approvedBy: null, approvedAt: null,
      createdBy: row.createdBy, createdAt: NOW(),
      updatedBy: null, updatedAt: null,
    };
    this.orders.set(`${row.tenantId}:${id}`, order);
    return order;
  }

  async insertInput(row: NewProductionInputRow): Promise<ProductionInput> {
    this.inputCounter++;
    const id = nid("pinput", this.inputCounter);
    const input: ProductionInput = {
      id, tenantId: row.tenantId,
      productionOrderId: row.productionOrderId,
      inputItemId: row.inputItemId,
      inputLocationId: row.inputLocationId,
      plannedInputQtyKg: row.plannedInputQtyKg,
      issuedQtyKg: "0", consumedQtyKg: "0",
      returnedFromWipQtyKg: "0", remainingWipQtyKg: "0",
      issueMovementId: null,
      createdBy: null, createdAt: NOW(),
      updatedBy: null, updatedAt: null,
    };
    this.inputs.set(`${row.tenantId}:${id}`, input);
    return input;
  }

  async findOrderById(tenantId: string, id: string): Promise<ProductionOrder | null> {
    return this.orders.get(`${tenantId}:${id}`) ?? null;
  }

  async findInputsByOrder(tenantId: string, orderId: string): Promise<ProductionInput[]> {
    return [...this.inputs.values()].filter(
      (i) => i.tenantId === tenantId && i.productionOrderId === orderId,
    );
  }

  async findInputById(tenantId: string, id: string): Promise<ProductionInput | null> {
    return this.inputs.get(`${tenantId}:${id}`) ?? null;
  }

  async updateOrderStatus(
    tenantId: string, orderId: string,
    patch: { status: string; approvalStatus: string },
  ): Promise<ProductionOrder | null> {
    const key = `${tenantId}:${orderId}`;
    const order = this.orders.get(key);
    if (!order) return null;
    const updated = { ...order, status: patch.status as any, approvalStatus: patch.approvalStatus as any, updatedAt: NOW() };
    this.orders.set(key, updated);
    return updated;
  }

  async updateInputIssuedQty(
    tenantId: string, inputId: string,
    patch: { issuedQtyKg: string; issueMovementId: string | null },
  ): Promise<ProductionInput | null> {
    const key = `${tenantId}:${inputId}`;
    const input = this.inputs.get(key);
    if (!input) return null;
    const updated = { ...input, issuedQtyKg: patch.issuedQtyKg, issueMovementId: patch.issueMovementId, updatedAt: NOW() };
    this.inputs.set(key, updated);
    return updated;
  }

  async updateOrderStatusConditional(
    tenantId: string, orderId: string,
    patch: { status: string; approvalStatus: string },
    expectedCurrentStatuses: string[],
  ): Promise<ProductionOrder | null> {
    const key = `${tenantId}:${orderId}`;
    const order = this.orders.get(key);
    if (!order) return null;
    if (!expectedCurrentStatuses.includes(order.status)) return null;
    const updated = { ...order, status: patch.status as any, approvalStatus: patch.approvalStatus as any, updatedAt: NOW() };
    this.orders.set(key, updated);
    return updated;
  }
}
