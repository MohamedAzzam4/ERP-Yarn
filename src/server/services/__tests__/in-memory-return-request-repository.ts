/**
 * In-memory ReturnRequestRepository for unit tests.
 * TEST-ONLY helper. NOT for production use.
 */
import type { ReturnRequest, ReturnLine } from "@/server/db/schema/returns";
import type {
  ReturnRequestRepository,
  NewReturnRequestInput,
  NewReturnLineInput,
  UpdateReturnRequestStatusInput,
} from "../return-request-repository";

const NOW = () => new Date("2026-07-01T00:00:00Z");
const nid = (p: string, n: number) => `${p}-${n.toString().padStart(6, "0")}`;

export class InMemoryReturnRequestRepository implements ReturnRequestRepository {
  private returnRequests = new Map<string, ReturnRequest>();
  private returnLines = new Map<string, ReturnLine>();
  private idempotencyKeyMap = new Map<string, string>();
  private rrCounter = 0;
  private rlCounter = 0;

  snapshot() {
    return {
      returnRequests: new Map([...this.returnRequests].map(([k, v]) => [k, { ...v }])),
      returnLines: new Map([...this.returnLines].map(([k, v]) => [k, { ...v }])),
      idempotencyKeyMap: new Map(this.idempotencyKeyMap),
      rrCounter: this.rrCounter,
      rlCounter: this.rlCounter,
    };
  }

  restore(snap: any) {
    this.returnRequests = new Map([...snap.returnRequests].map(([k, v]) => [k, { ...v }]));
    this.returnLines = new Map([...snap.returnLines].map(([k, v]) => [k, { ...v }]));
    this.idempotencyKeyMap = new Map(snap.idempotencyKeyMap);
    this.rrCounter = snap.rrCounter;
    this.rlCounter = snap.rlCounter;
  }

  async insertReturnRequest(row: NewReturnRequestInput): Promise<ReturnRequest> {
    this.rrCounter++;
    const id = nid("rr", this.rrCounter);
    const rr: ReturnRequest = {
      id, tenantId: row.tenantId, docNo: row.docNo,
      salesOrderId: row.salesOrderId, customerId: row.customerId,
      returnDate: row.returnDate, status: "draft",
      approvalStatus: "draft",
      returnReason: row.returnReason,
      financialTreatment: row.financialTreatment ?? null,
      customerAdjustmentAmount: row.customerAdjustmentAmount ?? null,
      isReplacement: row.isReplacement,
      replacementOrderId: null,
      recordOrigin: "manual_live", recordPeriod: "live",
      isLocked: false, importBatchId: null,
      approvedBy: null, approvedAt: null,
      createdAt: NOW(), createdBy: row.createdBy,
      updatedAt: NOW(), updatedBy: row.createdBy,
    } as any;
    this.returnRequests.set(`${row.tenantId}:${id}`, rr);
    return rr;
  }

  async findReturnRequestById(tenantId: string, id: string): Promise<ReturnRequest | null> {
    return this.returnRequests.get(`${tenantId}:${id}`) ?? null;
  }

  async findReturnRequestByIdempotencyKey(tenantId: string, key: string): Promise<ReturnRequest | null> {
    const id = this.idempotencyKeyMap.get(`${tenantId}:${key}`);
    if (!id) return null;
    return this.returnRequests.get(`${tenantId}:${id}`) ?? null;
  }

  recordIdempotencyKey(tenantId: string, key: string, id: string) {
    this.idempotencyKeyMap.set(`${tenantId}:${key}`, id);
  }

  async updateReturnRequestStatus(
    tenantId: string, id: string,
    patch: UpdateReturnRequestStatusInput,
    expectedCurrentStatuses: string[],
  ): Promise<ReturnRequest | null> {
    const key = `${tenantId}:${id}`;
    const rr = this.returnRequests.get(key);
    if (!rr) return null;
    if (!expectedCurrentStatuses.includes(rr.status)) return null;
    const updated: ReturnRequest = {
      ...rr,
      status: patch.status,
      approvalStatus: patch.approvalStatus,
      financialTreatment: patch.financialTreatment ?? rr.financialTreatment,
      customerAdjustmentAmount: patch.customerAdjustmentAmount ?? rr.customerAdjustmentAmount,
      approvedBy: patch.approvedBy ?? rr.approvedBy,
      approvedAt: patch.approvedAt ?? rr.approvedAt,
      isLocked: patch.isLocked ?? rr.isLocked,
      updatedAt: NOW(), updatedBy: patch.updatedBy,
    } as any;
    this.returnRequests.set(key, updated);
    return updated;
  }

  async listReturnRequestsForSale(tenantId: string, salesOrderId: string): Promise<ReturnRequest[]> {
    return [...this.returnRequests.values()].filter(r => r.tenantId === tenantId && r.salesOrderId === salesOrderId);
  }

  async listReturnRequestsForCustomer(tenantId: string, customerId: string): Promise<ReturnRequest[]> {
    return [...this.returnRequests.values()].filter(r => r.tenantId === tenantId && r.customerId === customerId);
  }

  async insertReturnLine(row: NewReturnLineInput): Promise<ReturnLine> {
    this.rlCounter++;
    const id = nid("rl", this.rlCounter);
    const rl: ReturnLine = {
      id, tenantId: row.tenantId, returnRequestId: row.returnRequestId,
      originalSaleOrderId: row.originalSaleOrderId, originalSaleLineId: row.originalSaleLineId,
      itemId: row.itemId, quantityKg: row.quantityKg, returnLocationId: row.returnLocationId,
      returnedStockStatus: row.returnedStockStatus as any,
      qualityStatusAfterReturn: row.qualityStatusAfterReturn ?? null,
      originalSaleLineNetUnitValue: row.originalSaleLineNetUnitValue ?? null,
      returnCreditValue: row.returnCreditValue ?? null,
      residualAdjustment: row.residualAdjustment ?? "0",
      cumulativePriorReturnQty: row.cumulativePriorReturnQty ?? "0",
      cumulativePriorReturnCredit: row.cumulativePriorReturnCredit ?? "0",
      returnMovementId: row.returnMovementId ?? null,
      createdAt: NOW(), createdBy: row.createdBy,
      updatedAt: NOW(), updatedBy: row.createdBy,
    } as any;
    this.returnLines.set(`${row.tenantId}:${id}`, rl);
    return rl;
  }

  async findReturnLines(tenantId: string, returnRequestId: string): Promise<ReturnLine[]> {
    return [...this.returnLines.values()].filter(l => l.tenantId === tenantId && l.returnRequestId === returnRequestId);
  }

  async updateReturnLineMovement(tenantId: string, returnLineId: string, returnMovementId: string): Promise<ReturnLine | null> {
    const key = `${tenantId}:${returnLineId}`;
    const rl = this.returnLines.get(key);
    if (!rl) return null;
    const updated = { ...rl, returnMovementId, updatedAt: NOW() };
    this.returnLines.set(key, updated);
    return updated;
  }

  async updateReturnLineCreditAndResidual(
    tenantId: string, returnLineId: string,
    patch: { returnCreditValue: string; residualAdjustment: string; cumulativePriorReturnQty: string; cumulativePriorReturnCredit: string; updatedBy: string },
  ): Promise<ReturnLine | null> {
    const key = `${tenantId}:${returnLineId}`;
    const rl = this.returnLines.get(key);
    if (!rl) return null;
    const updated = {
      ...rl,
      returnCreditValue: patch.returnCreditValue,
      residualAdjustment: patch.residualAdjustment,
      cumulativePriorReturnQty: patch.cumulativePriorReturnQty,
      cumulativePriorReturnCredit: patch.cumulativePriorReturnCredit,
      updatedAt: NOW(),
      updatedBy: patch.updatedBy,
    } as any;
    this.returnLines.set(key, updated);
    return updated;
  }

  async listApprovedReturnLinesForSaleLine(tenantId: string, originalSaleLineId: string): Promise<ReturnLine[]> {
    // Get all return lines for this sale line, then filter by approved return requests
    const lines = [...this.returnLines.values()].filter(l => l.tenantId === tenantId && l.originalSaleLineId === originalSaleLineId);
    const approvedLines: ReturnLine[] = [];
    for (const line of lines) {
      const rr = this.returnRequests.get(`${tenantId}:${line.returnRequestId}`);
      if (rr && rr.status === "approved") {
        approvedLines.push(line);
      }
    }
    return approvedLines;
  }

  async lockReturnRequest(_tenantId: string, _id: string): Promise<void> {}
}
