/**
 * In-memory RawReceiptDraftRepository for unit tests.
 * TEST-ONLY helper. NOT for production use.
 */
import type {
  RawReceiptDraftRepository,
  NewDraftInput,
  UpdateDraftInput,
  RawReceiptDraft,
  RawReceiptDraftStatus,
} from "../raw-receipt-draft-service";

const NOW = () => new Date("2026-07-01T00:00:00Z");
const nid = (p: string, n: number) => `${p}-${n.toString().padStart(6, "0")}`;

export class InMemoryRawReceiptDraftRepository implements RawReceiptDraftRepository {
  private drafts = new Map<string, RawReceiptDraft>();
  private counter = 0;

  async insertDraft(row: NewDraftInput): Promise<RawReceiptDraft> {
    this.counter++;
    const id = nid("draft", this.counter);
    const draft: RawReceiptDraft = {
      id,
      tenantId: row.tenantId,
      batchNo: row.batchNo,
      supplierId: row.supplierId,
      supplierReference: row.supplierReference,
      fiberTypeId: row.fiberTypeId,
      fiberTypeAr: row.fiberTypeAr,
      rawGradeAr: row.rawGradeAr,
      originCountry: row.originCountry,
      season: row.season,
      balesCount: row.balesCount,
      grossWeightKg: row.grossWeightKg,
      netWeightKg: row.netWeightKg,
      receivedDate: row.receivedDate,
      storageLocationId: row.storageLocationId,
      storageLocationName: row.storageLocationName,
      purchaseOrderRef: row.purchaseOrderRef,
      notes: row.notes,
      status: "draft",
      approvalStatus: "draft",
      subjectVersion: 1,
      subjectHash: null,
      createdBy: row.createdBy,
      createdAt: NOW(),
      updatedBy: null,
      updatedAt: null,
    };
    this.drafts.set(`${row.tenantId}:${id}`, draft);
    return draft;
  }

  async updateDraft(tenantId: string, id: string, patch: UpdateDraftInput): Promise<RawReceiptDraft | null> {
    const key = `${tenantId}:${id}`;
    const existing = this.drafts.get(key);
    if (!existing) return null;
    const updated: RawReceiptDraft = {
      ...existing,
      ...patch,
      updatedAt: NOW(),
      updatedBy: patch.updatedBy,
    };
    this.drafts.set(key, updated);
    return updated;
  }

  async findDraftById(tenantId: string, id: string): Promise<RawReceiptDraft | null> {
    return this.drafts.get(`${tenantId}:${id}`) ?? null;
  }

  async findDraftByBatchNo(tenantId: string, batchNo: string): Promise<RawReceiptDraft | null> {
    for (const d of this.drafts.values()) {
      if (d.tenantId === tenantId && d.batchNo === batchNo) return d;
    }
    return null;
  }

  async listDraftsByTenant(tenantId: string, status?: RawReceiptDraftStatus): Promise<RawReceiptDraft[]> {
    return [...this.drafts.values()].filter(
      (d) => d.tenantId === tenantId && (!status || d.status === status),
    );
  }

  async updateDraftStatus(
    tenantId: string,
    id: string,
    status: RawReceiptDraftStatus,
    approvalStatus: string,
    subjectVersion: number,
    subjectHash: string,
  ): Promise<RawReceiptDraft | null> {
    const key = `${tenantId}:${id}`;
    const existing = this.drafts.get(key);
    if (!existing) return null;
    const updated: RawReceiptDraft = {
      ...existing,
      status,
      approvalStatus,
      subjectVersion,
      subjectHash,
      updatedAt: NOW(),
      updatedBy: existing.createdBy,
    };
    this.drafts.set(key, updated);
    return updated;
  }
}
