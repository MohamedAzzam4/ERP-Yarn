/**
 * In-memory HistoricalReconciliationRepository — WP-07-03 tests.
 * TEST-ONLY. Non-persistent in-memory store for unit tests.
 */
import { randomUUID } from "node:crypto";
import type {
  HistoricalReconciliationRepository,
  NewReconciliationResultInput,
  NewReconciliationReviewItemInput,
} from "../historical-reconciliation-repository";
import type {
  ImportReconciliationResult,
  ImportHumanReviewItem,
  ImportStagingRow,
  ImportBatch,
} from "@/server/db/schema/migration";

const NOW = () => new Date();
function nid(prefix: string, counter: number): string {
  return `${prefix}-${String(counter).padStart(6, "0")}-${randomUUID().slice(0, 8)}`;
}

export class InMemoryHistoricalReconciliationRepository implements HistoricalReconciliationRepository {
  private results = new Map<string, ImportReconciliationResult>();
  private reviews = new Map<string, ImportHumanReviewItem>();
  private stagingRows = new Map<string, ImportStagingRow[]>();
  private batches = new Map<string, ImportBatch>();
  private resultCounter = 0;
  private reviewCounter = 0;

  seedStagingRows(tenantId: string, batchId: string, rows: ImportStagingRow[]): void {
    this.stagingRows.set(`${tenantId}:${batchId}`, rows);
  }
  seedBatch(tenantId: string, batch: ImportBatch): void {
    this.batches.set(`${tenantId}:${batch.id}`, batch);
  }
  /** Seed a review item directly (bypasses service for test setup). */
  seedReviewItem(
    tenantId: string,
    item: {
      importBatchId: string;
      reviewReason: string;
      status?: string;
      stagingRowId?: string | null;
      createdBy?: string;
    },
  ): ImportHumanReviewItem {
    this.reviewCounter++;
    const id = nid("rev-seed", this.reviewCounter);
    const record: ImportHumanReviewItem = {
      id, tenantId, importBatchId: item.importBatchId,
      stagingRowId: item.stagingRowId ?? null,
      reviewReason: item.reviewReason,
      assignedTo: null,
      status: (item.status ?? "pending") as any,
      decision: null, decisionNotes: null, decidedBy: null, decidedAt: null,
      reportVersion: null, isCurrent: true, supersededAt: null, supersededBy: null, supersededReason: null,
      createdBy: item.createdBy ?? "test-user",
      createdAt: NOW(), updatedBy: null, updatedAt: null,
    };
    this.reviews.set(`${tenantId}:${id}`, record);
    return record;
  }

  async insertReconciliationResult(row: NewReconciliationResultInput): Promise<ImportReconciliationResult> {
    this.resultCounter++;
    const id = nid("recon", this.resultCounter);
    const result: ImportReconciliationResult = {
      id, tenantId: row.tenantId, importBatchId: row.importBatchId,
      reportVersion: row.reportVersion, metricKey: row.metricKey,
      expectedValue: row.expectedValue, stagedValue: row.stagedValue,
      committedValue: row.committedValue, differenceValue: row.differenceValue,
      status: row.status as any,
      acceptedByOwner: null, acceptedByAccountant: null, acceptedAt: null,
      acceptanceReason: null, notes: row.notes,
      createdBy: row.createdBy, createdAt: NOW(), updatedBy: null, updatedAt: null,
    };
    this.results.set(`${row.tenantId}:${id}`, result);
    return result;
  }

  async findReconciliationResultsForBatch(tenantId: string, importBatchId: string): Promise<ImportReconciliationResult[]> {
    return [...this.results.values()].filter(r => r.tenantId === tenantId && r.importBatchId === importBatchId);
  }

  async findReconciliationResultsForBatchVersion(tenantId: string, importBatchId: string, reportVersion: number): Promise<ImportReconciliationResult[]> {
    return [...this.results.values()].filter(r => r.tenantId === tenantId && r.importBatchId === importBatchId && r.reportVersion === reportVersion);
  }

  async findLatestReportVersion(tenantId: string, importBatchId: string): Promise<number> {
    const results = [...this.results.values()].filter(r => r.tenantId === tenantId && r.importBatchId === importBatchId);
    if (results.length === 0) return 0;
    return Math.max(...results.map(r => r.reportVersion));
  }

  // WP-08-01F Milestone C Task 4: markVersionAsSuperseded has been REMOVED.
  // Old reconciliation-result rows are NEVER mutated.

  async insertReviewItem(row: NewReconciliationReviewItemInput): Promise<ImportHumanReviewItem> {
    this.reviewCounter++;
    const id = nid("rev", this.reviewCounter);
    const item: ImportHumanReviewItem = {
      id, tenantId: row.tenantId, importBatchId: row.importBatchId,
      stagingRowId: row.stagingRowId, reviewReason: row.reviewReason,
      assignedTo: null, status: "pending" as any, decision: null,
      decisionNotes: null, decidedBy: null, decidedAt: null,
      reportVersion: null, isCurrent: true, supersededAt: null, supersededBy: null, supersededReason: null,
      createdBy: row.createdBy, createdAt: NOW(), updatedBy: null, updatedAt: null,
    };
    this.reviews.set(`${row.tenantId}:${id}`, item);
    return item;
  }

  async findReviewItemsForBatch(tenantId: string, importBatchId: string): Promise<ImportHumanReviewItem[]> {
    return [...this.reviews.values()].filter(r => r.tenantId === tenantId && r.importBatchId === importBatchId);
  }

  async findReviewItemsForBatchVersion(tenantId: string, importBatchId: string): Promise<ImportHumanReviewItem[]> {
    return [...this.reviews.values()].filter(r => r.tenantId === tenantId && r.importBatchId === importBatchId);
  }

  async findReviewItemById(tenantId: string, id: string): Promise<ImportHumanReviewItem | null> {
    return this.reviews.get(`${tenantId}:${id}`) ?? null;
  }

  async updateReviewItemDecision(tenantId: string, id: string, patch: {
    status: string; decision: string | null; decisionNotes: string | null; decidedBy: string;
  }): Promise<ImportHumanReviewItem | null> {
    const key = `${tenantId}:${id}`;
    const item = this.reviews.get(key);
    if (!item) return null;
    const updated = { ...item, status: patch.status as any, decision: patch.decision as any, decisionNotes: patch.decisionNotes, decidedBy: patch.decidedBy, decidedAt: NOW(), updatedAt: NOW() };
    this.reviews.set(key, updated);
    return updated;
  }

  async invalidatePendingReviewItemsForBatch(tenantId: string, importBatchId: string): Promise<number> {
    // WP-08-01F DEFECT 2: delegate to supersedeReviewItemsForBatch
    return this.supersedeReviewItemsForBatch(tenantId, importBatchId, "system", "rework invalidation");
  }

  async supersedeReviewItemsForBatch(
    tenantId: string,
    importBatchId: string,
    supersededBy: string,
    supersededReason: string,
  ): Promise<number> {
    let superseded = 0;
    for (const [key, item] of this.reviews.entries()) {
      if (item.tenantId === tenantId && item.importBatchId === importBatchId && item.isCurrent) {
        const updated: ImportHumanReviewItem = {
          ...item,
          isCurrent: false,
          supersededAt: NOW(),
          supersededBy,
          supersededReason,
          updatedAt: NOW(),
        };
        this.reviews.set(key, updated);
        superseded++;
      }
    }
    return superseded;
  }

  async findCurrentReviewItemsForBatch(tenantId: string, importBatchId: string): Promise<ImportHumanReviewItem[]> {
    return [...this.reviews.values()].filter(
      r => r.tenantId === tenantId && r.importBatchId === importBatchId && r.isCurrent,
    );
  }

  async resetBatchValidationAndReconciliationStatuses(
    tenantId: string,
    batchId: string,
  ): Promise<ImportBatch | null> {
    const key = `${tenantId}:${batchId}`;
    const batch = this.batches.get(key);
    if (!batch) return null;
    const updated = { ...batch, validationStatus: null, reconciliationStatus: null, updatedAt: NOW() };
    this.batches.set(key, updated);
    return updated;
  }

  async updateBatchReconciliationStatus(
    tenantId: string,
    batchId: string,
    reconciliationStatus: string,
    updatedBy: string,
  ): Promise<ImportBatch | null> {
    const key = `${tenantId}:${batchId}`;
    const batch = this.batches.get(key);
    if (!batch) return null;
    const updated = { ...batch, reconciliationStatus, updatedBy, updatedAt: NOW() };
    this.batches.set(key, updated);
    return updated;
  }

  async findStagingRowsForBatch(tenantId: string, importBatchId: string): Promise<ImportStagingRow[]> {
    return this.stagingRows.get(`${tenantId}:${importBatchId}`) ?? [];
  }

  async findImportBatchById(tenantId: string, id: string): Promise<ImportBatch | null> {
    return this.batches.get(`${tenantId}:${id}`) ?? null;
  }

  async updateBatchStatus(tenantId: string, batchId: string, status: string): Promise<ImportBatch | null> {
    const key = `${tenantId}:${batchId}`;
    const batch = this.batches.get(key);
    if (!batch) return null;
    const updated = { ...batch, status: status as any, updatedAt: NOW() };
    this.batches.set(key, updated);
    return updated;
  }
}
