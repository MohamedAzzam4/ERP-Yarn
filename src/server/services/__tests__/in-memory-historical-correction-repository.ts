/**
 * In-memory HistoricalCorrectionRepository — WP-07-05 tests.
 * TEST-ONLY. Non-persistent in-memory store for unit tests.
 */
import { randomUUID } from "node:crypto";
import type {
  HistoricalCorrectionRepository,
  NewCorrectionRequestInput,
  UpdateCorrectionApprovalInput,
  UpdateCorrectionAccountantApprovalInput,
  UpdateCorrectionStatusInput,
  UpdateCorrectionResultInput,
} from "../historical-correction-repository";
import type {
  HistoricalCorrectionRequest,
  ImportBatch,
} from "@/server/db/schema/migration";

const NOW = () => new Date();

export class InMemoryHistoricalCorrectionRepository implements HistoricalCorrectionRepository {
  private requests = new Map<string, HistoricalCorrectionRequest>();
  private batches = new Map<string, ImportBatch>();
  private counter = 0;

  seedBatch(tenantId: string, batch: ImportBatch): void {
    this.batches.set(`${tenantId}:${batch.id}`, batch);
  }

  async insertCorrectionRequest(row: NewCorrectionRequestInput): Promise<HistoricalCorrectionRequest> {
    this.counter++;
    const id = `corr-${String(this.counter).padStart(6, "0")}-${randomUUID().slice(0, 8)}`;
    const request: HistoricalCorrectionRequest = {
      id,
      tenantId: row.tenantId,
      docNo: row.docNo,
      importBatchId: row.importBatchId,
      originalEntityType: row.originalEntityType,
      originalEntityId: row.originalEntityId,
      correctionType: row.correctionType as any,
      reason: row.reason,
      proposedCorrectionJson: row.proposedCorrectionJson,
      impactAnalysisJson: row.impactAnalysisJson,
      status: "draft" as any,
      ownerApprovedBy: null,
      ownerApprovedAt: null,
      accountantApprovedBy: null,
      accountantApprovedAt: null,
      correctedEntityType: null,
      correctedEntityId: null,
      createdBy: row.createdBy,
      createdAt: NOW(),
      updatedBy: null,
      updatedAt: null,
    };
    this.requests.set(`${row.tenantId}:${id}`, request);
    return request;
  }

  async findCorrectionRequestById(tenantId: string, id: string): Promise<HistoricalCorrectionRequest | null> {
    return this.requests.get(`${tenantId}:${id}`) ?? null;
  }

  async findCorrectionRequestByDocNo(tenantId: string, docNo: string): Promise<HistoricalCorrectionRequest | null> {
    return [...this.requests.values()].find(
      r => r.tenantId === tenantId && r.docNo === docNo,
    ) ?? null;
  }

  async findCorrectionRequestsForBatch(tenantId: string, importBatchId: string): Promise<HistoricalCorrectionRequest[]> {
    return [...this.requests.values()].filter(
      r => r.tenantId === tenantId && r.importBatchId === importBatchId,
    );
  }

  async findCorrectionRequestsForOriginal(
    tenantId: string,
    originalEntityType: string,
    originalEntityId: string,
  ): Promise<HistoricalCorrectionRequest[]> {
    return [...this.requests.values()].filter(
      r => r.tenantId === tenantId && r.originalEntityType === originalEntityType && r.originalEntityId === originalEntityId,
    );
  }

  async updateCorrectionOwnerApproval(
    tenantId: string,
    id: string,
    patch: UpdateCorrectionApprovalInput,
  ): Promise<HistoricalCorrectionRequest | null> {
    const key = `${tenantId}:${id}`;
    const req = this.requests.get(key);
    if (!req) return null;
    const updated = { ...req, ownerApprovedBy: patch.ownerApprovedBy, ownerApprovedAt: patch.ownerApprovedAt, updatedAt: NOW() };
    this.requests.set(key, updated);
    return updated;
  }

  async updateCorrectionAccountantApproval(
    tenantId: string,
    id: string,
    patch: UpdateCorrectionAccountantApprovalInput,
  ): Promise<HistoricalCorrectionRequest | null> {
    const key = `${tenantId}:${id}`;
    const req = this.requests.get(key);
    if (!req) return null;
    const updated = { ...req, accountantApprovedBy: patch.accountantApprovedBy, accountantApprovedAt: patch.accountantApprovedAt, updatedAt: NOW() };
    this.requests.set(key, updated);
    return updated;
  }

  async updateCorrectionStatus(
    tenantId: string,
    id: string,
    patch: UpdateCorrectionStatusInput,
  ): Promise<HistoricalCorrectionRequest | null> {
    const key = `${tenantId}:${id}`;
    const req = this.requests.get(key);
    if (!req) return null;
    const updated: HistoricalCorrectionRequest = {
      ...req,
      status: patch.status as any,
      updatedBy: patch.updatedBy,
      updatedAt: NOW(),
    };
    this.requests.set(key, updated);
    return updated;
  }

  async updateCorrectionResult(
    tenantId: string,
    id: string,
    patch: UpdateCorrectionResultInput,
  ): Promise<HistoricalCorrectionRequest | null> {
    const key = `${tenantId}:${id}`;
    const req = this.requests.get(key);
    if (!req) return null;
    const updated: HistoricalCorrectionRequest = {
      ...req,
      correctedEntityType: patch.correctedEntityType,
      correctedEntityId: patch.correctedEntityId,
      status: patch.status as any,
      updatedBy: patch.updatedBy,
      updatedAt: NOW(),
    };
    this.requests.set(key, updated);
    return updated;
  }

  async findImportBatchById(tenantId: string, id: string): Promise<ImportBatch | null> {
    return this.batches.get(`${tenantId}:${id}`) ?? null;
  }
}
