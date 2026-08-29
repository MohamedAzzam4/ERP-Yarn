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
import { and, eq, isNull, sql as drizzleSql } from "drizzle-orm";
import {
  importBatches,
  importBatchApprovals,
  importBackupEvidence,
  importCutoverLocks,
  importStagingRows,
  importValidationErrors,
  importReconciliationResults,
  importCutoverManifests,
  importAliasMappings,
} from "@/server/db/schema";
import {
  suppliers,
  customers,
  locations,
  externalFactories,
  fiberTypes,
  productTypes,
  qualityParameters,
  inventoryItems,
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
  ImportAliasMapping,
} from "@/server/db/schema/migration";

type Db = NonNullable<typeof DbType>;
/**
 * WP-08-01F R1 — accepts root Db or Drizzle transaction for tx-scoped use
 * inside the replacement service saga.
 */
type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export class HistoricalCommitDbRepository implements HistoricalCommitRepository {
  constructor(private readonly db: DbOrTx) {}

  // ---- Batch access ----

  async findImportBatchById(tenantId: string, id: string): Promise<ImportBatch | null> {
    const [batch] = await this.db.select().from(importBatches)
      .where(and(eq(importBatches.tenantId, tenantId), eq(importBatches.id, id)));
    return batch ?? null;
  }

  async updateBatchStatus(tenantId: string, batchId: string, status: string): Promise<ImportBatch | null> {
    // WP-08-01F R3/R5 QA FIX: Use raw SQL without RETURNING for Supabase pooler.
    await this.db.execute(drizzleSql`
      UPDATE import_batches
      SET status = ${status}::import_batch_status, updated_at = NOW()
      WHERE tenant_id = ${tenantId} AND id = ${batchId}
    `);
    const verifyResult = await this.db.execute(drizzleSql`
      SELECT 1 FROM import_batches
      WHERE tenant_id = ${tenantId} AND id = ${batchId} AND status = ${status}::import_batch_status
    `);
    return (verifyResult as unknown as unknown[]).length > 0
      ? ({ id: batchId, status } as unknown as ImportBatch)
      : null;
  }

  /**
   * WP-08-01F Milestone B (COM-CONC-1) — Conditional status restore.
   *
   * Single-statement atomic UPDATE: only restores `approved_for_commit`
   * when the current status is `committing`. This prevents the commit
   * catch block from undoing a concurrent winner's `committed` status.
   *
   * See the interface docstring for the full rationale.
   */
  async restoreApprovedForCommitIfCommitting(
    tenantId: string,
    batchId: string,
  ): Promise<void> {
    await this.db.execute(drizzleSql`
      UPDATE import_batches
      SET status = 'approved_for_commit'::import_batch_status, updated_at = NOW()
      WHERE tenant_id = ${tenantId}
        AND id = ${batchId}
        AND status = 'committing'::import_batch_status
    `);
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

  /**
   * Returns ONLY current (is_current=true) staging rows for the batch.
   * Superseded rows (is_current=false) are excluded — they are immutable
   * provenance evidence and must never receive new operational commit links.
   */
  async findCurrentStagingRowsForBatch(tenantId: string, importBatchId: string): Promise<ImportStagingRow[]> {
    return this.db.select().from(importStagingRows)
      .where(and(
        eq(importStagingRows.tenantId, tenantId),
        eq(importStagingRows.importBatchId, importBatchId),
        eq(importStagingRows.isCurrent, true),
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

  // ---- Alias mappings (read-only cross-service lookup) ----

  /**
   * WP-08-01F (A7): Find only CURRENT alias mappings (is_current=true)
   * for a batch. Used by submitForApproval's prerequisite check to
   * verify that every required alias has status='approved' and
   * targetMasterId IS NOT NULL before the batch can transition to
   * pending_dual_approval.
   */
  async findCurrentAliasMappingsForBatch(tenantId: string, importBatchId: string): Promise<ImportAliasMapping[]> {
    return this.db.select().from(importAliasMappings)
      .where(and(
        eq(importAliasMappings.tenantId, tenantId),
        eq(importAliasMappings.importBatchId, importBatchId),
        eq(importAliasMappings.isCurrent, true),
      ));
  }

  /**
   * WP-08-01F DEC-081 — Find only CURRENT DEFAULT alias mappings
   * (is_current=true AND mapping_kind='default') for a batch. Used by
   * submitForApproval and commitBatch to match the staging-derived
   * required-alias-groups set — EXCEPTION rows no longer satisfy the
   * required-groups check.
   */
  async findCurrentDefaultAliasMappingsForBatch(tenantId: string, importBatchId: string): Promise<ImportAliasMapping[]> {
    return this.db.select().from(importAliasMappings)
      .where(and(
        eq(importAliasMappings.tenantId, tenantId),
        eq(importAliasMappings.importBatchId, importBatchId),
        eq(importAliasMappings.isCurrent, true),
        eq(importAliasMappings.mappingKind, "default" as any),
      ));
  }

  /**
   * WP-08-01F DEC-081 — Find only CURRENT EXCEPTION alias mappings for
   * a given (entityType, sourceLabel) key within a batch. Used by
   * submitForApproval and commitBatch to verify each exception row is
   * independently approved with a non-null target master.
   */
  async findCurrentExceptionAliasMappingsForGroup(
    tenantId: string,
    importBatchId: string,
    entityType: string,
    sourceLabel: string,
  ): Promise<ImportAliasMapping[]> {
    return this.db.select().from(importAliasMappings)
      .where(and(
        eq(importAliasMappings.tenantId, tenantId),
        eq(importAliasMappings.importBatchId, importBatchId),
        eq(importAliasMappings.entityType, entityType),
        eq(importAliasMappings.sourceLabel, sourceLabel),
        eq(importAliasMappings.isCurrent, true),
        eq(importAliasMappings.mappingKind, "exception" as any),
      ));
  }

  /**
   * WP-08-01F Milestone B (COM-CONC-2B) — Detect approved alias mappings
   * that have been superseded (is_current=false AND status='approved')
   * for the batch. Called by commitBatch's revalidation under the batch
   * row lock to catch a concurrent alias supersession that happened
   * between dual approval and commit.
   *
   * Note: `findCurrentAliasMappingsForBatch` filters `is_current=true`,
   * so a superseded approved mapping is silently dropped — this method
   * is the inverse lookup that catches exactly those rows.
   */
  async findSupersededApprovedAliasMappingsForBatch(
    tenantId: string,
    importBatchId: string,
  ): Promise<ImportAliasMapping[]> {
    return this.db.select().from(importAliasMappings)
      .where(and(
        eq(importAliasMappings.tenantId, tenantId),
        eq(importAliasMappings.importBatchId, importBatchId),
        eq(importAliasMappings.isCurrent, false),
        eq(importAliasMappings.status, "approved" as any),
      ));
  }

  /**
   * WP-08-01F DEFECT 5/6/7/8 — Validate that the target master referenced
   * by an alias mapping still exists, belongs to the caller's tenant,
   * and matches the alias's entityType. Direct query against the master
   * tables (no MasterDataRepository injection needed). Used by
   * submitForApproval and commitBatch to re-validate under the batch
   * row lock.
   *
   * Returns true if the master is found and tenant-scoped; false
   * otherwise (including for unsupported entity types — fail-closed).
   */
  async findMasterForAlias(
    tenantId: string,
    entityType: string,
    targetMasterId: string,
  ): Promise<boolean> {
    if (!targetMasterId) return false;
    switch (entityType) {
      case "supplier": {
        const rows = await this.db.select({ id: suppliers.id })
          .from(suppliers)
          .where(and(eq(suppliers.tenantId, tenantId), eq(suppliers.id, targetMasterId)))
          .limit(1);
        return rows.length > 0;
      }
      case "customer": {
        const rows = await this.db.select({ id: customers.id })
          .from(customers)
          .where(and(eq(customers.tenantId, tenantId), eq(customers.id, targetMasterId)))
          .limit(1);
        return rows.length > 0;
      }
      case "location": {
        const rows = await this.db.select({ id: locations.id })
          .from(locations)
          .where(and(eq(locations.tenantId, tenantId), eq(locations.id, targetMasterId)))
          .limit(1);
        return rows.length > 0;
      }
      case "factory": {
        const rows = await this.db.select({ id: externalFactories.id })
          .from(externalFactories)
          .where(and(eq(externalFactories.tenantId, tenantId), eq(externalFactories.id, targetMasterId)))
          .limit(1);
        return rows.length > 0;
      }
      case "fiber_type":
      case "fiber": {
        const rows = await this.db.select({ id: fiberTypes.id })
          .from(fiberTypes)
          .where(and(eq(fiberTypes.tenantId, tenantId), eq(fiberTypes.id, targetMasterId)))
          .limit(1);
        return rows.length > 0;
      }
      case "product_type":
      case "product": {
        const rows = await this.db.select({ id: productTypes.id })
          .from(productTypes)
          .where(and(eq(productTypes.tenantId, tenantId), eq(productTypes.id, targetMasterId)))
          .limit(1);
        return rows.length > 0;
      }
      case "quality_parameter": {
        const rows = await this.db.select({ id: qualityParameters.id })
          .from(qualityParameters)
          .where(and(eq(qualityParameters.tenantId, tenantId), eq(qualityParameters.id, targetMasterId)))
          .limit(1);
        return rows.length > 0;
      }
      case "item":
      case "batch":
      case "lot": {
        // inventory_items is the canonical stock identity (Contract 03
        // §9.1). For 'batch'/'lot' entity types, the caller resolves
        // through the same inventory_items table.
        const rows = await this.db.select({ id: inventoryItems.id })
          .from(inventoryItems)
          .where(and(eq(inventoryItems.tenantId, tenantId), eq(inventoryItems.id, targetMasterId)))
          .limit(1);
        return rows.length > 0;
      }
      default:
        // Unsupported entity type — fail-closed. NEVER guess.
        return false;
    }
  }
}
