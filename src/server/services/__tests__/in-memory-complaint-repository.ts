/**
 * In-memory ComplaintRepository for unit tests.
 * TEST-ONLY helper. NOT for production use.
 */
import type { Complaint } from "@/server/db/schema/quality";
import type {
  ComplaintRepository,
  NewComplaintInput,
  UpdateComplaintInput,
} from "../complaint-repository";

const NOW = () => new Date("2026-07-01T00:00:00Z");
const nid = (p: string, n: number) => `${p}-${n.toString().padStart(6, "0")}`;

export class InMemoryComplaintRepository implements ComplaintRepository {
  private complaints = new Map<string, Complaint>();
  private idempotencyKeyMap = new Map<string, string>();
  private counter = 0;

  snapshot(): {
    complaints: Map<string, Complaint>;
    idempotencyKeyMap: Map<string, string>;
    counter: number;
  } {
    return {
      complaints: new Map([...this.complaints].map(([k, v]) => [k, { ...v }])),
      idempotencyKeyMap: new Map(this.idempotencyKeyMap),
      counter: this.counter,
    };
  }

  restore(snap: {
    complaints: Map<string, Complaint>;
    idempotencyKeyMap: Map<string, string>;
    counter: number;
  }): void {
    this.complaints = new Map([...snap.complaints].map(([k, v]) => [k, { ...v }]));
    this.idempotencyKeyMap = new Map(snap.idempotencyKeyMap);
    this.counter = snap.counter;
  }

  async insertComplaint(row: NewComplaintInput): Promise<Complaint> {
    this.counter++;
    const id = nid("cmp", this.counter);
    const complaint: Complaint = {
      id,
      tenantId: row.tenantId,
      complaintNo: row.complaintNo,
      complaintDate: row.complaintDate,
      customerId: row.customerId ?? null,
      saleId: row.saleId ?? null,
      saleLineId: row.saleLineId ?? null,
      itemId: row.itemId ?? null,
      qualityTestId: row.qualityTestId ?? null,
      subject: row.subject,
      description: row.description ?? null,
      status: row.status,
      priority: row.priority,
      investigatedBy: null,
      investigatedAt: null,
      investigationNotes: null,
      resolvedBy: null,
      resolvedAt: null,
      resolutionNotes: null,
      resolutionType: null,
      notes: row.notes ?? null,
      createdAt: NOW(),
      createdBy: row.createdBy,
      updatedAt: NOW(),
      updatedBy: row.createdBy,
    };
    this.complaints.set(`${row.tenantId}:${id}`, complaint);
    return complaint;
  }

  async findComplaintById(tenantId: string, complaintId: string): Promise<Complaint | null> {
    return this.complaints.get(`${tenantId}:${complaintId}`) ?? null;
  }

  async findComplaintByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<Complaint | null> {
    const complaintId = this.idempotencyKeyMap.get(`${tenantId}:${idempotencyKey}`);
    if (!complaintId) return null;
    return this.complaints.get(`${tenantId}:${complaintId}`) ?? null;
  }

  recordIdempotencyKey(tenantId: string, idempotencyKey: string, complaintId: string): void {
    this.idempotencyKeyMap.set(`${tenantId}:${idempotencyKey}`, complaintId);
  }

  async updateComplaint(
    tenantId: string,
    complaintId: string,
    patch: UpdateComplaintInput,
  ): Promise<Complaint | null> {
    const key = `${tenantId}:${complaintId}`;
    const complaint = this.complaints.get(key);
    if (!complaint) return null;
    const updated: Complaint = {
      ...complaint,
      status: patch.status ?? complaint.status,
      priority: patch.priority ?? complaint.priority,
      investigatedBy: patch.investigatedBy ?? complaint.investigatedBy,
      investigatedAt: patch.investigatedAt ?? complaint.investigatedAt,
      investigationNotes: patch.investigationNotes ?? complaint.investigationNotes,
      resolvedBy: patch.resolvedBy ?? complaint.resolvedBy,
      resolvedAt: patch.resolvedAt ?? complaint.resolvedAt,
      resolutionNotes: patch.resolutionNotes ?? complaint.resolutionNotes,
      resolutionType: patch.resolutionType ?? complaint.resolutionType,
      notes: patch.notes ?? complaint.notes,
      updatedAt: NOW(),
      updatedBy: patch.updatedBy,
    };
    this.complaints.set(key, updated);
    return updated;
  }

  async listOpenComplaints(tenantId: string): Promise<Complaint[]> {
    return [...this.complaints.values()].filter(
      (c) => c.tenantId === tenantId && (c.status === "open" || c.status === "investigating"),
    );
  }

  async listComplaintsForCustomer(tenantId: string, customerId: string): Promise<Complaint[]> {
    return [...this.complaints.values()].filter(
      (c) => c.tenantId === tenantId && c.customerId === customerId,
    );
  }

  async listComplaintsForSale(tenantId: string, saleId: string): Promise<Complaint[]> {
    return [...this.complaints.values()].filter(
      (c) => c.tenantId === tenantId && c.saleId === saleId,
    );
  }

  async listComplaintsForItem(tenantId: string, itemId: string): Promise<Complaint[]> {
    return [...this.complaints.values()].filter(
      (c) => c.tenantId === tenantId && c.itemId === itemId,
    );
  }

  async listComplaintsForQualityTest(tenantId: string, qualityTestId: string): Promise<Complaint[]> {
    return [...this.complaints.values()].filter(
      (c) => c.tenantId === tenantId && c.qualityTestId === qualityTestId,
    );
  }

  async listComplaints(tenantId: string, status?: string | null): Promise<Complaint[]> {
    return [...this.complaints.values()].filter(
      (c) => c.tenantId === tenantId && (!status || c.status === status),
    );
  }
}
