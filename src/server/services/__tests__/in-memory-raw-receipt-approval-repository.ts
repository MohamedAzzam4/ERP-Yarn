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

  /**
   * Snapshot the current state for transactional test rollback.
   * Returns a deep-cloned copy of approvals + counter.
   * Used by the mock transactionRunner in atomicity/concurrency tests
   * to simulate DB transaction rollback. TEST-ONLY.
   */
  snapshot(): {
    approvals: Map<string, RawReceiptApprovalRequest>;
    counter: number;
  } {
    return {
      approvals: new Map([...this.approvals].map(([k, v]) => [k, { ...v, submittedChildVersionSummary: v.submittedChildVersionSummary ? { ...v.submittedChildVersionSummary } : null }])),
      counter: this.counter,
    };
  }

  /**
   * Restore state from a snapshot. Used to simulate DB transaction
   * rollback in atomicity/concurrency tests. TEST-ONLY.
   */
  restore(snapshot: {
    approvals: Map<string, RawReceiptApprovalRequest>;
    counter: number;
  }): void {
    this.approvals = new Map([...snapshot.approvals].map(([k, v]) => [k, { ...v, submittedChildVersionSummary: v.submittedChildVersionSummary ? { ...v.submittedChildVersionSummary } : null }]));
    this.counter = snapshot.counter;
  }

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
      idempotencyKey: row.idempotencyKey ?? null,
      subjectVersion: row.subjectVersion,
      subjectHash: row.subjectHash,
      movementId: null,
      payableEntryId: null,
      payableDeferred: false,
      submittedChildVersionSummary: row.submittedChildVersionSummary ?? null,
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
    // Conditional: only succeed if current state is 'active'.
    // Matches the DB-backed repository's conditional WHERE state = 'active'.
    if (existing.state !== "active") return null;
    // JSONB MERGE (WP-03-02 fix): mirror the DB-backed `||` jsonb_concat
    // behavior. Merge the new keys (movementId, payableEntryId,
    // payableDeferred) into the existing submittedChildVersionSummary
    // instead of overwriting it. This preserves workflow-specific payload
    // (e.g., transfer params: itemId, fromLocationId, toLocationId,
    // quantityKg stored at creation time by TransferWorkflowService).
    const existingSummary = (existing.submittedChildVersionSummary ?? {}) as Record<string, unknown>;
    const mergedSummary: Record<string, unknown> = {
      ...existingSummary,
      movementId,
      payableEntryId,
      payableDeferred,
    };
    const updated: RawReceiptApprovalRequest = {
      ...existing,
      state: "decided",
      decidedBy,
      decidedAt: NOW(),
      decisionNotes,
      movementId,
      payableEntryId,
      payableDeferred,
      submittedChildVersionSummary: mergedSummary,
      updatedAt: NOW(),
      updatedBy: decidedBy,
    };
    this.approvals.set(key, updated);
    return updated;
  }

  async updatePayableInfo(
    tenantId: string,
    id: string,
    payableEntryId: string,
  ): Promise<RawReceiptApprovalRequest | null> {
    const key = `${tenantId}:${id}`;
    const existing = this.approvals.get(key);
    if (!existing) return null;
    // Conditional: only succeed if current state is 'decided'.
    if (existing.state !== "decided") return null;
    // JSONB MERGE: mirror DB-backed `||` jsonb_concat. Merge the new
    // payableEntryId + payableDeferred=false into the existing summary,
    // preserving any existing keys (e.g., movementId, transfer params).
    const existingSummary = (existing.submittedChildVersionSummary ?? {}) as Record<string, unknown>;
    const mergedSummary: Record<string, unknown> = {
      ...existingSummary,
      payableEntryId,
      payableDeferred: false,
    };
    const updated: RawReceiptApprovalRequest = {
      ...existing,
      payableEntryId,
      payableDeferred: false,
      submittedChildVersionSummary: mergedSummary,
      updatedAt: NOW(),
    };
    this.approvals.set(key, updated);
    return updated;
  }
}
