/**
 * In-memory WipReturnRequestRepository for unit tests.
 * TEST-ONLY helper. NOT for production use.
 */
import type { ProductionWipReturn } from "@/server/db/schema/production-receipts";
import type {
  WipReturnRequestRepository,
  NewWipReturnRequestInput,
  WipReturnApprovalPatch,
} from "../wip-return-request-repository";

const NOW = () => new Date("2026-07-01T00:00:00Z");
const nid = (p: string, n: number) => `${p}-${n.toString().padStart(6, "0")}`;

export class InMemoryWipReturnRequestRepository implements WipReturnRequestRepository {
  private requests = new Map<string, ProductionWipReturn>();
  private counter = 0;

  snapshot() {
    return {
      requests: new Map([...this.requests].map(([k, v]) => [k, { ...v }])),
      counter: this.counter,
    };
  }

  restore(s: { requests: Map<string, ProductionWipReturn>; counter: number }) {
    const restoreMap = <T>(src: Map<string, T>): Map<string, T> => {
      const dst = new Map<string, T>();
      for (const [k, v] of src) dst.set(k, { ...(v as object) } as T);
      return dst;
    };
    this.requests = restoreMap(s.requests);
    this.counter = s.counter;
  }

  async insertRequest(row: NewWipReturnRequestInput): Promise<ProductionWipReturn> {
    this.counter++;
    const id = nid("wret", this.counter);
    const request: ProductionWipReturn = {
      id,
      tenantId: row.tenantId,
      docNo: row.docNo,
      productionOrderId: row.productionOrderId,
      productionInputId: row.productionInputId,
      returnQtyKg: row.returnQtyKg,
      returnLocationId: row.returnLocationId,
      status: "pending_approval",
      approvalStatus: "pending_approval",
      reason: row.reason,
      notes: row.notes,
      idempotencyKey: row.idempotencyKey,
      approvalRequestId: null,
      returnMovementId: null,
      financialReviewStatus: "needs_accountant_review",
      subjectHash: row.subjectHash,
      subjectVersion: row.subjectVersion,
      confirmedBy: null,
      confirmedAt: null,
      recordOrigin: "manual_live",
      recordPeriod: "live",
      isLocked: false,
      createdBy: row.createdBy,
      createdAt: NOW(),
      updatedBy: null,
      updatedAt: null,
    };
    this.requests.set(`${row.tenantId}:${id}`, request);
    return { ...request };
  }

  async findRequestById(tenantId: string, id: string): Promise<ProductionWipReturn | null> {
    const r = this.requests.get(`${tenantId}:${id}`);
    return r ? { ...r } : null;
  }

  async markApprovedConditional(
    tenantId: string,
    requestId: string,
    patch: WipReturnApprovalPatch,
    expectedCurrentStatuses: ReadonlyArray<string>,
  ): Promise<ProductionWipReturn | null> {
    const key = `${tenantId}:${requestId}`;
    const request = this.requests.get(key);
    if (!request) return null;
    if (!expectedCurrentStatuses.includes(request.status)) return null;
    if (request.isLocked) return null;
    const updated: ProductionWipReturn = {
      ...request,
      status: patch.status,
      approvalStatus: patch.approvalStatus,
      isLocked: patch.isLocked,
      confirmedBy: patch.confirmedBy,
      confirmedAt: patch.confirmedAt,
      returnMovementId: patch.returnMovementId,
      updatedBy: patch.confirmedBy,
      updatedAt: NOW(),
    };
    this.requests.set(key, updated);
    return { ...updated };
  }
}
