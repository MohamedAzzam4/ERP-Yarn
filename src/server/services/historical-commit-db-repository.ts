/**
 * Drizzle-backed HistoricalCommitRepository — WP-07-04.
 */
import "server-only";
import { and, eq } from "drizzle-orm";
import {
  importBatchApprovals,
  importCutoverManifests,
  importBatches,
  importStagingRows,
  importValidationErrors,
  importHumanReviewItems,
  importReconciliationResults,
} from "@/server/db/schema";
import type { db as DbType } from "@/server/db/client";
import type {
  HistoricalCommitRepository,
  NewApprovalInput,
  NewCutoverLockInput,
} from "./historical-commit-repository";
import type {
  ImportBatchApproval,
  ImportCutoverManifest,
  ImportBatch,
  ImportStagingRow,
  ImportValidationError,
  ImportHumanReviewItem,
  ImportReconciliationResult,
} from "@/server/db/schema/migration";

type Db = NonNullable<typeof DbType>;

export class HistoricalCommitDbRepository implements HistoricalCommitRepository {
  constructor(private readonly db: Db) {}

  async insertApproval(row: NewApprovalInput): Promise<ImportBatchApproval> {
    const [result] = await this.db.insert(importBatchApprovals).values({
      tenantId: row.tenantId,
      importBatchId: row.importBatchId,
      approverRole: row.approverRole as any,
      approverUserId: row.approverUserId,
      stagedDataHash: row.stagedDataHash,
      cutoverManifestHash: row.cutoverManifestHash,
      templateVersion: row.templateVersion,
      mappingVersion: row.mappingVersion,
      validationStatus: row.validationStatus,
      reconciliationStatus: row.reconciliationStatus,
      warningSummary: row.warningSummary,
      reason: row.reason,
      createdBy: row.approverUserId,
    }).returning();
    return result!;
  }

  async findApprovalsForBatch(tenantId: string, importBatchId: string): Promise<ImportBatchApproval[]> {
    return this.db.select().from(importBatchApprovals)
      .where(and(eq(importBatchApprovals.tenantId, tenantId), eq(importBatchApprovals.importBatchId, importBatchId)));
  }

  async findApprovalByRole(tenantId: string, importBatchId: string, role: string): Promise<ImportBatchApproval | null> {
    const [result] = await this.db.select().from(importBatchApprovals)
      .where(and(
        eq(importBatchApprovals.tenantId, tenantId),
        eq(importBatchApprovals.importBatchId, importBatchId),
        eq(importBatchApprovals.approverRole, role as any),
      )).limit(1);
    return result ?? null;
  }

  async insertCutoverLock(row: NewCutoverLockInput): Promise<ImportCutoverManifest> {
    const [result] = await this.db.insert(importCutoverManifests).values({
      tenantId: row.tenantId,
      importBatchId: row.importBatchId,
      domain: row.domain,
      importMode: "opening_balance" as any,
      manifestHash: row.lockHolder,
      isApproved: false,
      createdBy: row.lockHolder,
    }).returning();
    return result!;
  }

  async findCutoverLocksForBatch(tenantId: string, importBatchId: string): Promise<ImportCutoverManifest[]> {
    return this.db.select().from(importCutoverManifests)
      .where(and(eq(importCutoverManifests.tenantId, tenantId), eq(importCutoverManifests.importBatchId, importBatchId)));
  }

  async deleteCutoverLocksForBatch(tenantId: string, importBatchId: string): Promise<void> {
    await this.db.delete(importCutoverManifests)
      .where(and(eq(importCutoverManifests.tenantId, tenantId), eq(importCutoverManifests.importBatchId, importBatchId)));
  }

  async findImportBatchById(tenantId: string, id: string): Promise<ImportBatch | null> {
    const [result] = await this.db.select().from(importBatches)
      .where(and(eq(importBatches.tenantId, tenantId), eq(importBatches.id, id))).limit(1);
    return result ?? null;
  }

  async updateBatchStatus(tenantId: string, batchId: string, status: string): Promise<ImportBatch | null> {
    const [result] = await this.db.update(importBatches)
      .set({ status: status as any, updatedAt: new Date() })
      .where(and(eq(importBatches.tenantId, tenantId), eq(importBatches.id, batchId))).returning();
    return result ?? null;
  }

  async updateBatchCommitInfo(tenantId: string, batchId: string, patch: {
    status: string; committedAt: Date; commitEffectCounts: Record<string, number> | null;
  }): Promise<ImportBatch | null> {
    const [result] = await this.db.update(importBatches)
      .set({ status: patch.status as any, committedAt: patch.committedAt, commitEffectCounts: patch.commitEffectCounts, updatedAt: new Date() })
      .where(and(eq(importBatches.tenantId, tenantId), eq(importBatches.id, batchId))).returning();
    return result ?? null;
  }

  async findStagingRowsForBatch(tenantId: string, importBatchId: string): Promise<ImportStagingRow[]> {
    return this.db.select().from(importStagingRows)
      .where(and(eq(importStagingRows.tenantId, tenantId), eq(importStagingRows.importBatchId, importBatchId)));
  }

  async updateStagingRowCommitted(tenantId: string, stagingRowId: string, entityType: string, entityId: string): Promise<void> {
    await this.db.update(importStagingRows)
      .set({ committedEntityType: entityType, committedEntityId: entityId, validationStatus: "committed" as any, updatedAt: new Date() })
      .where(and(eq(importStagingRows.tenantId, tenantId), eq(importStagingRows.id, stagingRowId)));
  }

  async findBlockingErrorsForBatch(tenantId: string, importBatchId: string): Promise<ImportValidationError[]> {
    return this.db.select().from(importValidationErrors)
      .where(and(
        eq(importValidationErrors.tenantId, tenantId),
        eq(importValidationErrors.importBatchId, importBatchId),
        eq(importValidationErrors.isBlocking, true),
      ));
  }

  async findUnresolvedReviewItemsForBatch(tenantId: string, importBatchId: string): Promise<ImportHumanReviewItem[]> {
    return this.db.select().from(importHumanReviewItems)
      .where(and(
        eq(importHumanReviewItems.tenantId, tenantId),
        eq(importHumanReviewItems.importBatchId, importBatchId),
        eq(importHumanReviewItems.status, "pending" as any),
      ));
  }

  async findBlockingReconciliationResultsForBatch(tenantId: string, importBatchId: string): Promise<ImportReconciliationResult[]> {
    return this.db.select().from(importReconciliationResults)
      .where(and(
        eq(importReconciliationResults.tenantId, tenantId),
        eq(importReconciliationResults.importBatchId, importBatchId),
        eq(importReconciliationResults.status, "blocking" as any),
      ));
  }

  async findCutoverManifestsForBatch(tenantId: string, importBatchId: string): Promise<ImportCutoverManifest[]> {
    return this.db.select().from(importCutoverManifests)
      .where(and(eq(importCutoverManifests.tenantId, tenantId), eq(importCutoverManifests.importBatchId, importBatchId)));
  }
}

export function createHistoricalCommitDbRepository(db: Db): HistoricalCommitDbRepository {
  return new HistoricalCommitDbRepository(db);
}
