/**
 * In-memory RawReceiptApprovalRepository for unit tests.
 * TEST-ONLY helper. NOT for production use.
 */
import type {
  RawReceiptApprovalRepository,
  NewApprovalRequestInput,
  RawReceiptApprovalRequest,
} from "../raw-receipt-approval-service";

const NOW = () => new Date("2026-07-01T00:00:00Z");
const nid = (p: string, n: number) => `${p}-${n.toString().padStart(6, "0")}`;

export class InMemoryRawReceiptApprovalRepository implements RawReceiptApprovalRepository {
  private approvals = new Map<string, RawReceiptApprovalRequest>();
  private counter = 0;

  async insertApprovalRequest(row: NewApprovalRequestInput): Promise<RawReceiptApprovalRequest> {
    this.counter++;
    const id = nid("approval", this.counter);
    const approval: RawReceiptApprovalRequest = {
      id,
      tenantId: row.tenantId,
      requestType: row.requestType,
      entityType: row.entityType,
      entityId: row.entityId,
      riskLevel: row.riskLevel,
      requestedBy: row.requestedBy,
      requestedAt: NOW(),
      reason: row.reason,
      state: "active",
      decidedBy: null,
      decidedAt: null,
      decisionNotes: null,
      idempotencyKey: null,
      subjectVersion: row.subjectVersion,
      subjectHash: row.subjectHash,
      movementId: null,
      payableEntryId: null,
      payableDeferred: false,
      createdBy: row.createdBy,
      createdAt: NOW(),
      updatedBy: null,
      updatedAt: null,
    };
    this.approvals.set(`${row.tenantId}:${id}`, approval);
    return approval;
  }

  async findActiveApprovalByEntity(
    tenantId: string,
    entityType: string,
    entityId: string,
    requestType: string,
  ): Promise<RawReceiptApprovalRequest | null> {
    for (const a of this.approvals.values()) {
      if (
        a.tenantId === tenantId &&
        a.entityType === entityType &&
        a.entityId === entityId &&
        a.requestType === requestType &&
        a.state === "active"
      ) {
        return a;
      }
    }
    return null;
  }

  async findApprovalById(tenantId: string, id: string): Promise<RawReceiptApprovalRequest | null> {
    return this.approvals.get(`${tenantId}:${id}`) ?? null;
  }

  async listPendingApprovals(tenantId: string, entityType: string): Promise<RawReceiptApprovalRequest[]> {
    return [...this.approvals.values()].filter(
      (a) => a.tenantId === tenantId && a.entityType === entityType && a.state === "active",
    );
  }

  async markDecided(
    tenantId: string,
    id: string,
    decidedBy: string,
    decisionNotes: string | null,
    movementId: string | null,
    payableEntryId: string | null,
    payableDeferred: boolean,
  ): Promise<RawReceiptApprovalRequest | null> {
    const key = `${tenantId}:${id}`;
    const existing = this.approvals.get(key);
    if (!existing) return null;
    const updated: RawReceiptApprovalRequest = {
      ...existing,
      state: "decided",
      decidedBy,
      decidedAt: NOW(),
      decisionNotes,
      movementId,
      payableEntryId,
      payableDeferred,
      updatedAt: NOW(),
      updatedBy: decidedBy,
    };
    this.approvals.set(key, updated);
    return updated;
  }
}
