/**
 * Drizzle-backed HistoricalCommitRepository — WP-07-04.
 *
 * Production path: uses persistent AuditDbRepository and a real database
 * transaction via transactionRunner + txFactories.
 *
 * Contract: docs/contracts/08_historical_migration_contract.md §8.9-8.11
 * Contract: docs/contracts/06_approval_transaction_contract.md §15
 */
import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import {
  importBatches,
  importBatchApprovals,
  importBackupEvidence,
  importCutoverLocks,
  importStagingRows,
  importValidationErrors,
  importReconciliationResults,
  importCutoverManifests,
} from "@/server/db/schema";
import type { db as DbType } from "@/server/db/client";
import type {
  HistoricalCommitRepository,
  NewApprovalInput,
  NewBackupEvidenceInput,
  NewCutoverLockInput,
  ReleaseLockInput,
  UpdateStagingRowCommitLinkInput,
} from "./historical-commit-repository";
import type {
  ImportBatch,
  ImportBatchApproval,
  ImportBackupEvidence,
  ImportCutoverLock,
  ImportStagingRow,
  ImportValidationError,
  ImportReconciliationResult,
  ImportCutoverManifest,
} from "@/server/db/schema/migration";

type Db = NonNullable<typeof DbType>;

export class HistoricalCommitDbRepository implements HistoricalCommitRepository {
  constructor(private readonly db: Db) {}

  // ---- Batch access ----

  async findImportBatchById(tenantId: string, id: string): Promise<ImportBatch | null> {
    const [batch] = await this.db.select().from(importBatches)
      .where(and(eq(importBatches.tenantId, tenantId), eq(importBatches.id, id)));
    return batch ?? null;
  }

  async updateBatchStatus(tenantId: string, batchId: string, status: string): Promise<ImportBatch | null> {
    const [updated] = await this.db.update(importBatches)
      .set({ status: status as any, updatedAt: new Date() })
      .where(and(eq(importBatches.tenantId, tenantId), eq(importBatches.id, batchId)))
      .returning();
    return updated ?? null;
  }

  async updateBatchCommitMetadata(
    tenantId: string,
    batchId: string,
    patch: {
      committedAt: Date;
      commitEffectCounts: Record<string, number>;
      updatedBy: string;
    },
  ): Promise<ImportBatch | null> {
    const [updated] = await this.db.update(importBatches)
      .set({
        status: "committed" as any,
        committedAt: patch.committedAt,
        commitEffectCounts: patch.commitEffectCounts,
        updatedBy: patch.updatedBy,
        updatedAt: new Date(),
      })
      .where(and(eq(importBatches.tenantId, tenantId), eq(importBatches.id, batchId)))
      .returning();
    return updated ?? null;
  }

  async updateBatchStagedDataHash(
    tenantId: string,
    batchId: string,
    stagedDataHash: string,
    updatedBy: string,
  ): Promise<ImportBatch | null> {
    const [updated] = await this.db.update(importBatches)
      .set({ stagedDataHash, updatedBy, updatedAt: new Date() })
      .where(and(eq(importBatches.tenantId, tenantId), eq(importBatches.id, batchId)))
      .returning();
    return updated ?? null;
  }

  // ---- Approval records ----

  async insertApproval(row: NewApprovalInput): Promise<ImportBatchApproval> {
    const [approval] = await this.db.insert(importBatchApprovals).values({
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
      createdBy: row.createdBy,
    }).returning();
    return approval!;
  }

  async findApprovalsForBatch(tenantId: string, importBatchId: string): Promise<ImportBatchApproval[]> {
    return this.db.select().from(importBatchApprovals)
      .where(and(
        eq(importBatchApprovals.tenantId, tenantId),
        eq(importBatchApprovals.importBatchId, importBatchId),
      ));
  }

  async findApprovalByRole(
    tenantId: string,
    importBatchId: string,
    approverRole: "owner" | "accountant",
  ): Promise<ImportBatchApproval | null> {
    const [approval] = await this.db.select().from(importBatchApprovals)
      .where(and(
        eq(importBatchApprovals.tenantId, tenantId),
        eq(importBatchApprovals.importBatchId, importBatchId),
        eq(importBatchApprovals.approverRole, approverRole as any),
      ));
    return approval ?? null;
  }

  /**
   * WP-08-01F DEFECT 2: Invalidate (mark is_current=false) all CURRENT
   * approval records for a batch. Prior approval rows are preserved.
   */
  async invalidateCurrentApprovalsForBatch(
    tenantId: string,
    importBatchId: string,
    invalidatedBy: string,
    invalidationReason: string,
  ): Promise<number> {
    const result = await this.db.update(importBatchApprovals)
      .set({
        isCurrent: false,
        invalidatedAt: new Date(),
        invalidatedBy,
        invalidationReason,
        updatedAt: new Date(),
      })
      .where(and(
        eq(importBatchApprovals.tenantId, tenantId),
        eq(importBatchApprovals.importBatchId, importBatchId),
        eq(importBatchApprovals.isCurrent, true),
      ));
    return (result as any)?.length ?? (result as any)?.rowCount ?? 0;
  }

  /**
   * Find only CURRENT approvals (is_current=true) for a batch.
   */
  async findCurrentApprovalsForBatch(tenantId: string, importBatchId: string): Promise<ImportBatchApproval[]> {
    return this.db.select().from(importBatchApprovals)
      .where(and(
        eq(importBatchApprovals.tenantId, tenantId),
        eq(importBatchApprovals.importBatchId, importBatchId),
        eq(importBatchApprovals.isCurrent, true),
      ));
  }

  // ---- Backup evidence ----

  async insertBackupEvidence(row: NewBackupEvidenceInput): Promise<ImportBackupEvidence> {
    const [evidence] = await this.db.insert(importBackupEvidence).values({
      tenantId: row.tenantId,
      importBatchId: row.importBatchId,
      backupType: row.backupType,
      backupLocation: row.backupLocation,
      backupHash: row.backupHash,
      backupSizeBytes: row.backupSizeBytes,
      backupCreatedAt: row.backupCreatedAt,
      verifiedBy: row.verifiedBy,
      verifiedAt: row.verifiedAt,
      verificationNotes: row.verificationNotes,
      createdBy: row.createdBy,
    }).returning();
    return evidence!;
  }

  async findBackupEvidenceForBatch(tenantId: string, importBatchId: string): Promise<ImportBackupEvidence[]> {
    return this.db.select().from(importBackupEvidence)
      .where(and(
        eq(importBackupEvidence.tenantId, tenantId),
        eq(importBackupEvidence.importBatchId, importBatchId),
      ));
  }

  // ---- Cutover locks ----

  async insertCutoverLock(row: NewCutoverLockInput): Promise<ImportCutoverLock> {
    const [lock] = await this.db.insert(importCutoverLocks).values({
      tenantId: row.tenantId,
      importBatchId: row.importBatchId,
      lockScope: row.lockScope,
      acquiredBy: row.acquiredBy,
      expiresAt: row.expiresAt,
      commitIdempotencyKey: row.commitIdempotencyKey,
      createdBy: row.createdBy,
    }).returning();
    return lock!;
  }

  async findActiveCutoverLocksForBatch(tenantId: string, importBatchId: string): Promise<ImportCutoverLock[]> {
    return this.db.select().from(importCutoverLocks)
      .where(and(
        eq(importCutoverLocks.tenantId, tenantId),
        eq(importCutoverLocks.importBatchId, importBatchId),
        isNull(importCutoverLocks.releasedAt),
      ));
  }

  async findActiveCutoverLockByScope(
    tenantId: string,
    importBatchId: string,
    lockScope: string,
  ): Promise<ImportCutoverLock | null> {
    const [lock] = await this.db.select().from(importCutoverLocks)
      .where(and(
        eq(importCutoverLocks.tenantId, tenantId),
        eq(importCutoverLocks.importBatchId, importBatchId),
        eq(importCutoverLocks.lockScope, lockScope),
        isNull(importCutoverLocks.releasedAt),
      ));
    return lock ?? null;
  }

  async releaseCutoverLock(
    tenantId: string,
    lockId: string,
    patch: ReleaseLockInput,
  ): Promise<ImportCutoverLock | null> {
    const [updated] = await this.db.update(importCutoverLocks)
      .set({
        releasedAt: patch.releasedAt,
        releasedBy: patch.releasedBy,
        releaseReason: patch.releaseReason,
        updatedAt: new Date(),
      })
      .where(and(
        eq(importCutoverLocks.tenantId, tenantId),
        eq(importCutoverLocks.id, lockId),
      ))
      .returning();
    return updated ?? null;
  }

  async releaseAllLocksForBatch(
    tenantId: string,
    importBatchId: string,
    patch: ReleaseLockInput,
  ): Promise<number> {
    const result = await this.db.update(importCutoverLocks)
      .set({
        releasedAt: patch.releasedAt,
        releasedBy: patch.releasedBy,
        releaseReason: patch.releaseReason,
        updatedAt: new Date(),
      })
      .where(and(
        eq(importCutoverLocks.tenantId, tenantId),
        eq(importCutoverLocks.importBatchId, importBatchId),
        isNull(importCutoverLocks.releasedAt),
      ))
      .returning();
    return result.length;
  }

  // ---- Staging rows ----

  async findStagingRowsForBatch(tenantId: string, importBatchId: string): Promise<ImportStagingRow[]> {
    return this.db.select().from(importStagingRows)
      .where(and(
        eq(importStagingRows.tenantId, tenantId),
        eq(importStagingRows.importBatchId, importBatchId),
      ));
  }

  async updateStagingRowCommitLink(
    tenantId: string,
    stagingRowId: string,
    patch: UpdateStagingRowCommitLinkInput,
  ): Promise<ImportStagingRow | null> {
    const [updated] = await this.db.update(importStagingRows)
      .set({
        committedEntityType: patch.committedEntityType,
        committedEntityId: patch.committedEntityId,
        updatedBy: patch.updatedBy,
        updatedAt: new Date(),
      })
      .where(and(
        eq(importStagingRows.tenantId, tenantId),
        eq(importStagingRows.id, stagingRowId),
      ))
      .returning();
    return updated ?? null;
  }

  // ---- Validation errors (blocking check) ----

  async findBlockingValidationErrors(tenantId: string, importBatchId: string): Promise<ImportValidationError[]> {
    return this.db.select().from(importValidationErrors)
      .where(and(
        eq(importValidationErrors.tenantId, tenantId),
        eq(importValidationErrors.importBatchId, importBatchId),
        eq(importValidationErrors.isBlocking, true),
      ));
  }

  // ---- Reconciliation results (blocking check) ----

  async findLatestReconciliationResults(tenantId: string, importBatchId: string): Promise<ImportReconciliationResult[]> {
    // Get all results, then filter to the latest report version
    const allResults = await this.db.select().from(importReconciliationResults)
      .where(and(
        eq(importReconciliationResults.tenantId, tenantId),
        eq(importReconciliationResults.importBatchId, importBatchId),
      ));
    if (allResults.length === 0) return [];
    const maxVersion = Math.max(...allResults.map(r => r.reportVersion));
    return allResults.filter(r => r.reportVersion === maxVersion);
  }

  // ---- Cutover manifests ----

  async findCutoverManifestsForBatch(tenantId: string, importBatchId: string): Promise<ImportCutoverManifest[]> {
    return this.db.select().from(importCutoverManifests)
      .where(and(
        eq(importCutoverManifests.tenantId, tenantId),
        eq(importCutoverManifests.importBatchId, importBatchId),
      ));
  }
}
