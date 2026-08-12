/**
 * In-memory HistoricalValidationRepository — WP-07-02 tests.
 * TEST-ONLY. Non-persistent in-memory store for unit tests.
 */
import { randomUUID } from "node:crypto";
import type {
  HistoricalValidationRepository,
  NewValidationErrorInput,
  NewAliasMappingInput,
  NewHumanReviewItemInput,
} from "../historical-validation-repository";
import type {
  ImportValidationError,
  ImportAliasMapping,
  ImportHumanReviewItem,
  ImportStagingRow,
  ImportBatch,
} from "@/server/db/schema/migration";

const NOW = () => new Date();
function nid(prefix: string, counter: number): string {
  return `${prefix}-${String(counter).padStart(6, "0")}-${randomUUID().slice(0, 8)}`;
}

export class InMemoryHistoricalValidationRepository implements HistoricalValidationRepository {
  private errors = new Map<string, ImportValidationError>();
  private aliases = new Map<string, ImportAliasMapping>();
  private reviews = new Map<string, ImportHumanReviewItem>();
  private stagingRows = new Map<string, ImportStagingRow[]>();
  private batches = new Map<string, ImportBatch>();
  private errorCounter = 0;
  private aliasCounter = 0;
  private reviewCounter = 0;

  // Helper to seed staging rows + batches for tests
  seedStagingRows(tenantId: string, batchId: string, rows: ImportStagingRow[]): void {
    this.stagingRows.set(`${tenantId}:${batchId}`, rows);
  }
  seedBatch(tenantId: string, batch: ImportBatch): void {
    this.batches.set(`${tenantId}:${batch.id}`, batch);
  }

  async insertValidationError(row: NewValidationErrorInput): Promise<ImportValidationError> {
    this.errorCounter++;
    const id = nid("verr", this.errorCounter);
    const error: ImportValidationError = {
      id, tenantId: row.tenantId, importBatchId: row.importBatchId,
      stagingRowId: row.stagingRowId, severity: row.severity as any,
      errorCode: row.errorCode, message: row.message, fieldName: row.fieldName,
      isBlocking: row.isBlocking, resolutionStatus: "open",
      resolvedBy: null, resolvedAt: null, resolutionNotes: null,
      // WP-08-01F R1 — new findings start as current version 1.
      findingVersion: 1, isCurrent: true, supersededAt: null,
      createdBy: row.createdBy, createdAt: NOW(), updatedBy: null, updatedAt: null,
    } as ImportValidationError;
    this.errors.set(`${row.tenantId}:${id}`, error);
    return error;
  }

  async findValidationErrorsForBatch(tenantId: string, importBatchId: string): Promise<ImportValidationError[]> {
    return [...this.errors.values()].filter(e => e.tenantId === tenantId && e.importBatchId === importBatchId);
  }

  async findBlockingErrorsForBatch(tenantId: string, importBatchId: string): Promise<ImportValidationError[]> {
    return [...this.errors.values()].filter(e => e.tenantId === tenantId && e.importBatchId === importBatchId && e.isBlocking);
  }

  async deleteValidationErrorsForBatch(tenantId: string, importBatchId: string): Promise<void> {
    for (const [key, e] of this.errors.entries()) {
      if (e.tenantId === tenantId && e.importBatchId === importBatchId) this.errors.delete(key);
    }
  }

  async insertAliasMapping(row: NewAliasMappingInput): Promise<ImportAliasMapping> {
    this.aliasCounter++;
    const id = nid("alias", this.aliasCounter);
    const alias: ImportAliasMapping = {
      id, tenantId: row.tenantId, importBatchId: row.importBatchId,
      entityType: row.entityType, sourceLabel: row.sourceLabel,
      normalizedName: row.normalizedName, targetMasterId: row.targetMasterId,
      mappingVersion: row.mappingVersion, confidenceScore: row.confidenceScore,
      status: row.status as any, approvedBy: null, approvedAt: null,
      notes: row.notes, createdBy: row.createdBy, createdAt: NOW(),
      updatedBy: null, updatedAt: null,
    };
    this.aliases.set(`${row.tenantId}:${id}`, alias);
    return alias;
  }

  async findAliasMappingsForBatch(tenantId: string, importBatchId: string): Promise<ImportAliasMapping[]> {
    return [...this.aliases.values()].filter(a => a.tenantId === tenantId && a.importBatchId === importBatchId);
  }

  async findAliasMappingBySourceLabel(tenantId: string, importBatchId: string, entityType: string, sourceLabel: string): Promise<ImportAliasMapping | null> {
    for (const a of this.aliases.values()) {
      if (a.tenantId === tenantId && a.importBatchId === importBatchId && a.entityType === entityType && a.sourceLabel === sourceLabel) return a;
    }
    return null;
  }

  async deleteAliasMappingsForBatch(tenantId: string, importBatchId: string): Promise<void> {
    for (const [key, a] of this.aliases.entries()) {
      if (a.tenantId === tenantId && a.importBatchId === importBatchId) this.aliases.delete(key);
    }
  }

  async insertHumanReviewItem(row: NewHumanReviewItemInput): Promise<ImportHumanReviewItem> {
    this.reviewCounter++;
    const id = nid("review", this.reviewCounter);
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

  async findHumanReviewItemsForBatch(tenantId: string, importBatchId: string): Promise<ImportHumanReviewItem[]> {
    return [...this.reviews.values()].filter(r => r.tenantId === tenantId && r.importBatchId === importBatchId);
  }

  async deleteHumanReviewItemsForBatch(tenantId: string, importBatchId: string): Promise<void> {
    for (const [key, r] of this.reviews.entries()) {
      if (r.tenantId === tenantId && r.importBatchId === importBatchId) this.reviews.delete(key);
    }
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

  // WP-08-01F DEFECT 1A: lifecycle transition support

  async updateBatchValidationStatus(tenantId: string, batchId: string, validationStatus: string, updatedBy: string): Promise<ImportBatch | null> {
    const key = `${tenantId}:${batchId}`;
    const batch = this.batches.get(key);
    if (!batch) return null;
    const updated = { ...batch, validationStatus, updatedBy, updatedAt: NOW() };
    this.batches.set(key, updated);
    return updated;
  }

  async updateBatchErrorCounts(tenantId: string, batchId: string, blockingErrorCount: number, warningCount: number, updatedBy: string): Promise<ImportBatch | null> {
    const key = `${tenantId}:${batchId}`;
    const batch = this.batches.get(key);
    if (!batch) return null;
    const updated = { ...batch, blockingErrorCount, warningCount, updatedBy, updatedAt: NOW() };
    this.batches.set(key, updated);
    return updated;
  }
}
