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
      // WP-08-01F (A1) — version supersession fields. New mappings start as
      // the current version. Re-approval (material remap) supersedes the old
      // current row before inserting this one.
      isCurrent: true, supersededAt: null, supersededBy: null, supersededReason: null,
      // Group identity / occurrence metadata.
      groupId: row.groupId ?? null,
      occurrenceCount: row.occurrenceCount ?? 1,
      exceptionSourceRowIds: row.exceptionSourceRowIds ?? null,
      mappingKind: (row.mappingKind ?? "default") as any,
    } as ImportAliasMapping;
    this.aliases.set(`${row.tenantId}:${id}`, alias);
    return alias;
  }

  async findAliasMappingsForBatch(tenantId: string, importBatchId: string): Promise<ImportAliasMapping[]> {
    return [...this.aliases.values()].filter(a => a.tenantId === tenantId && a.importBatchId === importBatchId);
  }

  async findAliasMappingBySourceLabel(tenantId: string, importBatchId: string, entityType: string, sourceLabel: string): Promise<ImportAliasMapping | null> {
    // WP-08-01F (A1): Only consider the CURRENT mapping. Superseded rows
    // are preserved as audit history but are not active.
    for (const a of this.aliases.values()) {
      if (
        a.tenantId === tenantId && a.importBatchId === importBatchId &&
        a.entityType === entityType && a.sourceLabel === sourceLabel &&
        a.isCurrent
      ) return a;
    }
    return null;
  }

  async deleteAliasMappingsForBatch(tenantId: string, importBatchId: string): Promise<void> {
    // WP-08-01F (A2): NEVER hard-delete current alias mappings. Only the
    // non-current (already superseded) rows are deleted. Current rows are
    // protected — the service is the authority on which rows to supersede.
    for (const [key, a] of this.aliases.entries()) {
      if (a.tenantId === tenantId && a.importBatchId === importBatchId && !a.isCurrent) {
        this.aliases.delete(key);
      }
    }
  }

  // WP-08-01F (A3) — Approve (or reject) a single alias mapping in place.
  async updateAliasMappingStatus(
    tenantId: string,
    aliasMappingId: string,
    update: {
      status: string;
      targetMasterId: string | null;
      approvedBy: string;
      approvedAt: Date;
      mappingVersion: string | null;
      notes: string | null;
    },
  ): Promise<ImportAliasMapping | null> {
    const key = `${tenantId}:${aliasMappingId}`;
    const a = this.aliases.get(key);
    if (!a) return null;
    const updated: ImportAliasMapping = {
      ...a,
      status: update.status as any,
      targetMasterId: update.targetMasterId,
      approvedBy: update.approvedBy,
      approvedAt: update.approvedAt,
      mappingVersion: update.mappingVersion,
      notes: update.notes,
      updatedBy: update.approvedBy,
      updatedAt: NOW(),
    } as ImportAliasMapping;
    this.aliases.set(key, updated);
    return updated;
  }

  // WP-08-01F (A3) — Find a single alias mapping by primary key.
  async findAliasMappingById(tenantId: string, aliasMappingId: string): Promise<ImportAliasMapping | null> {
    return this.aliases.get(`${tenantId}:${aliasMappingId}`) ?? null;
  }

  async findAliasMappingByIdForUpdate(tenantId: string, aliasMappingId: string): Promise<ImportAliasMapping | null> {
    return this.findAliasMappingById(tenantId, aliasMappingId);
  }

  // WP-08-01F (A3) — Find only CURRENT alias mappings for a batch.
  async findCurrentAliasMappingsForBatch(tenantId: string, importBatchId: string): Promise<ImportAliasMapping[]> {
    return [...this.aliases.values()].filter(
      a => a.tenantId === tenantId && a.importBatchId === importBatchId && a.isCurrent,
    );
  }

  async findCurrentDefaultAliasMappingsForBatch(tenantId: string, importBatchId: string): Promise<ImportAliasMapping[]> {
    return [...this.aliases.values()].filter(
      a => a.tenantId === tenantId && a.importBatchId === importBatchId &&
        a.isCurrent && (a as any).mappingKind === "default",
    );
  }

  async findCurrentExceptionAliasMappingsForGroup(tenantId: string, importBatchId: string, entityType: string, sourceLabel: string): Promise<ImportAliasMapping[]> {
    return [...this.aliases.values()].filter(
      a => a.tenantId === tenantId && a.importBatchId === importBatchId &&
        a.entityType === entityType && a.sourceLabel === sourceLabel &&
        a.isCurrent && (a as any).mappingKind === "exception",
    );
  }

  // WP-08-01F (A3/A5) — Supersede a single alias mapping by id.
  async supersedeAliasMapping(
    tenantId: string,
    aliasMappingId: string,
    supersededBy: string,
    supersededReason: string,
  ): Promise<ImportAliasMapping | null> {
    const key = `${tenantId}:${aliasMappingId}`;
    const a = this.aliases.get(key);
    if (!a || !a.isCurrent) return null;
    const updated: ImportAliasMapping = {
      ...a,
      isCurrent: false,
      supersededAt: NOW(),
      supersededBy,
      supersededReason,
      updatedBy: supersededBy,
      updatedAt: NOW(),
    } as ImportAliasMapping;
    this.aliases.set(key, updated);
    return updated;
  }

  // WP-08-01F DEFECT 2 — Update occurrenceCount on the CURRENT alias
  // mapping for a (tenant, batch, entityType, sourceLabel) key.
  async updateAliasMappingOccurrenceCount(
    tenantId: string,
    importBatchId: string,
    entityType: string,
    sourceLabel: string,
    occurrenceCount: number,
  ): Promise<ImportAliasMapping | null> {
    for (const [key, a] of this.aliases.entries()) {
      if (
        a.tenantId === tenantId && a.importBatchId === importBatchId &&
        a.entityType === entityType && a.sourceLabel === sourceLabel &&
        a.isCurrent
      ) {
        const updated: ImportAliasMapping = {
          ...a,
          occurrenceCount,
          updatedAt: NOW(),
        } as ImportAliasMapping;
        this.aliases.set(key, updated);
        return updated;
      }
    }
    return null;
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

  async findStagingRowsByIds(tenantId: string, stagingRowIds: string[]): Promise<ImportStagingRow[]> {
    if (stagingRowIds.length === 0) return [];
    const idSet = new Set(stagingRowIds);
    const out: ImportStagingRow[] = [];
    for (const rows of this.stagingRows.values()) {
      for (const r of rows) {
        if ((r as any).tenantId === tenantId && idSet.has(r.id) && (r as any).isCurrent !== false) {
          out.push(r);
        }
      }
    }
    return out;
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
