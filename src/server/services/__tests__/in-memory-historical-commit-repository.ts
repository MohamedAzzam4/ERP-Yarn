/**
 * In-memory HistoricalCommitRepository — WP-07-04 tests.
 */
import { randomUUID } from "node:crypto";
import type {
  HistoricalCommitRepository,
  NewApprovalInput,
  NewCutoverLockInput,
} from "../historical-commit-repository";
import type {
  ImportBatchApproval,
  ImportCutoverManifest,
  ImportBatch,
  ImportStagingRow,
  ImportValidationError,
  ImportHumanReviewItem,
  ImportReconciliationResult,
} from "@/server/db/schema/migration";

const NOW = () => new Date();
function nid(prefix: string, counter: number): string {
  return `${prefix}-${String(counter).padStart(6, "0")}-${randomUUID().slice(0, 8)}`;
}

export class InMemoryHistoricalCommitRepository implements HistoricalCommitRepository {
  private approvals = new Map<string, ImportBatchApproval>();
  private locks = new Map<string, ImportCutoverManifest>();
  private batches = new Map<string, ImportBatch>();
  private stagingRows = new Map<string, ImportStagingRow[]>();
  private blockingErrors: ImportValidationError[] = [];
  private reviewItems: ImportHumanReviewItem[] = [];
  private reconResults: ImportReconciliationResult[] = [];
  private cutoverManifests: ImportCutoverManifest[] = [];
  private approvalCounter = 0;
  private lockCounter = 0;

  seedBatch(tenantId: string, batch: ImportBatch): void { this.batches.set(`${tenantId}:${batch.id}`, batch); }
  seedStagingRows(tenantId: string, batchId: string, rows: ImportStagingRow[]): void { this.stagingRows.set(`${tenantId}:${batchId}`, rows); }
  seedBlockingErrors(errors: ImportValidationError[]): void { this.blockingErrors = errors; }
  seedReviewItems(items: ImportHumanReviewItem[]): void { this.reviewItems = items; }
  seedReconResults(results: ImportReconciliationResult[]): void { this.reconResults = results; }
  seedCutoverManifests(manifests: ImportCutoverManifest[]): void { this.cutoverManifests = manifests; }

  async insertApproval(row: NewApprovalInput): Promise<ImportBatchApproval> {
    this.approvalCounter++;
    const id = nid("appr", this.approvalCounter);
    const approval: ImportBatchApproval = {
      id, tenantId: row.tenantId, importBatchId: row.importBatchId,
      approverRole: row.approverRole as any, approverUserId: row.approverUserId,
      stagedDataHash: row.stagedDataHash, cutoverManifestHash: row.cutoverManifestHash,
      templateVersion: row.templateVersion, mappingVersion: row.mappingVersion,
      validationStatus: row.validationStatus, reconciliationStatus: row.reconciliationStatus,
      warningSummary: row.warningSummary, approvedAt: NOW(), reason: row.reason,
      createdBy: row.approverUserId, createdAt: NOW(), updatedBy: null, updatedAt: null,
    };
    this.approvals.set(`${row.tenantId}:${id}`, approval);
    return approval;
  }

  async findApprovalsForBatch(tenantId: string, importBatchId: string): Promise<ImportBatchApproval[]> {
    return [...this.approvals.values()].filter(a => a.tenantId === tenantId && a.importBatchId === importBatchId);
  }

  async findApprovalByRole(tenantId: string, importBatchId: string, role: string): Promise<ImportBatchApproval | null> {
    return [...this.approvals.values()].find(a => a.tenantId === tenantId && a.importBatchId === importBatchId && a.approverRole === role) ?? null;
  }

  async insertCutoverLock(row: NewCutoverLockInput): Promise<ImportCutoverManifest> {
    this.lockCounter++;
    const id = nid("lock", this.lockCounter);
    const lock: ImportCutoverManifest = {
      id, tenantId: row.tenantId, importBatchId: row.importBatchId,
      domain: row.domain, importMode: "opening_balance" as any,
      cutoffDate: null, sourceCoverage: null, openingBalanceBasis: null,
      liveSystemStartBoundary: null, reconciliationOwner: null,
      manifestHash: row.lockHolder, isApproved: false,
      createdBy: row.lockHolder, createdAt: NOW(), updatedBy: null, updatedAt: null,
    };
    this.locks.set(`${row.tenantId}:${id}`, lock);
    return lock;
  }

  async findCutoverLocksForBatch(tenantId: string, importBatchId: string): Promise<ImportCutoverManifest[]> {
    return [...this.locks.values()].filter(l => l.tenantId === tenantId && l.importBatchId === importBatchId);
  }

  async deleteCutoverLocksForBatch(tenantId: string, importBatchId: string): Promise<void> {
    for (const [key, l] of this.locks.entries()) {
      if (l.tenantId === tenantId && l.importBatchId === importBatchId) this.locks.delete(key);
    }
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

  async updateBatchCommitInfo(tenantId: string, batchId: string, patch: {
    status: string; committedAt: Date; commitEffectCounts: Record<string, number> | null;
  }): Promise<ImportBatch | null> {
    const key = `${tenantId}:${batchId}`;
    const batch = this.batches.get(key);
    if (!batch) return null;
    const updated = { ...batch, status: patch.status as any, committedAt: patch.committedAt, commitEffectCounts: patch.commitEffectCounts, updatedAt: NOW() };
    this.batches.set(key, updated);
    return updated;
  }

  async findStagingRowsForBatch(tenantId: string, importBatchId: string): Promise<ImportStagingRow[]> {
    return this.stagingRows.get(`${tenantId}:${importBatchId}`) ?? [];
  }

  async updateStagingRowCommitted(tenantId: string, stagingRowId: string, entityType: string, entityId: string): Promise<void> {
    for (const [key, rows] of this.stagingRows.entries()) {
      if (!key.startsWith(`${tenantId}:`)) continue;
      for (let i = 0; i < rows.length; i++) {
        if (rows[i]!.id === stagingRowId) {
          rows[i] = { ...rows[i]!, committedEntityType: entityType, committedEntityId: entityId, validationStatus: "committed" as any, updatedAt: NOW() };
          this.stagingRows.set(key, rows);
          return;
        }
      }
    }
  }

  async findBlockingErrorsForBatch(tenantId: string, importBatchId: string): Promise<ImportValidationError[]> {
    return this.blockingErrors.filter(e => e.tenantId === tenantId && e.importBatchId === importBatchId);
  }

  async findUnresolvedReviewItemsForBatch(tenantId: string, importBatchId: string): Promise<ImportHumanReviewItem[]> {
    return this.reviewItems.filter(r => r.tenantId === tenantId && r.importBatchId === importBatchId && r.status === "pending");
  }

  async findBlockingReconciliationResultsForBatch(tenantId: string, importBatchId: string): Promise<ImportReconciliationResult[]> {
    return this.reconResults.filter(r => r.tenantId === tenantId && r.importBatchId === importBatchId && r.status === "blocking");
  }

  async findCutoverManifestsForBatch(tenantId: string, importBatchId: string): Promise<ImportCutoverManifest[]> {
    return this.cutoverManifests.filter(m => m.tenantId === tenantId && m.importBatchId === importBatchId);
  }
}
