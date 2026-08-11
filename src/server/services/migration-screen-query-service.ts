/**
 * Migration Screen Query Service — WP-08-01F.
 *
 * Contract 10 §9: Historical Migration Screens.
 * Contract 11 §8: Workers NEVER see migration data.
 *
 * Provides role-safe DTOs for the migration management UI.
 * Owner and Accountant see full migration data.
 * Workers are denied (no migration nav, no route access).
 * Quality role has no migration access unless explicitly assigned.
 *
 * Storage paths, file hashes, and secrets are redacted in DTOs —
 * the UI shows file metadata (name, size, type) but never the
 * storage path or raw file URL.
 */
import "server-only";
import { eq, and, desc, sql as drizzleSql } from "drizzle-orm";
import {
  importBatches,
  importFiles,
  importTemplateVersions,
  importStagingRows,
  importValidationErrors,
  importAliasMappings,
  importHumanReviewItems,
  importReconciliationResults,
  importBatchApprovals,
  importBackupEvidence,
  importCutoverLocks,
  importCutoverManifests,
  historicalCorrectionRequests,
} from "@/server/db/schema/migration";
import type { db as DbType } from "@/server/db/client";

type Db = NonNullable<typeof DbType>;

// ---------------------------------------------------------------------------
// DTOs (role-safe — no storage paths, no secrets, no raw file URLs)
// ---------------------------------------------------------------------------

/** Batch list item — summary for the batch list page. */
export interface MigrationBatchListDto {
  id: string;
  batchNo: string;
  status: string;
  sourceDescription: string | null;
  templateName: string | null;
  templateVersion: string | null;
  mappingVersion: string | null;
  stagedRowCount: number;
  blockingErrorCount: number;
  warningCount: number;
  acceptedWarningCount: number;
  validationStatus: string | null;
  reconciliationStatus: string | null;
  committedAt: string | null;
  createdAt: string;
  createdBy: string | null;
}

/** File metadata DTO — storage path redacted. */
export interface MigrationFileDto {
  id: string;
  originalFileName: string;
  fileSizeBytes: number | null;
  contentType: string | null;
  fileType: string;
  fileHashRedacted: string; // first 8 chars + "…" — never full hash in list view
  supersededById: string | null;
  createdAt: string;
}

/** Staging row preview DTO — no operational effects, provenance only. */
export interface MigrationStagingRowDto {
  id: string;
  sourceSheetName: string | null;
  sourceRowNumber: number | null;
  transformedRowJson: unknown;
  validationStatus: string | null;
  reviewStatus: string | null;
  aiConfidence: string | null;
  transformationNotes: string | null;
  committedEntityType: string | null;
  committedEntityId: string | null;
}

/** Validation finding DTO — severity preserved, never downgraded. */
export interface MigrationValidationFindingDto {
  id: string;
  stagingRowId: string | null;
  severity: string; // blocking_error | review_required_warning | informational
  errorCode: string;
  message: string;
  fieldName: string | null;
  isBlocking: boolean;
  resolutionStatus: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNotes: string | null;
}

/** Alias mapping DTO. */
export interface MigrationAliasMappingDto {
  id: string;
  entityType: string;
  sourceLabel: string;
  normalizedName: string;
  targetMasterId: string | null;
  mappingVersion: string | null;
  confidenceScore: string | null;
  status: string;
  approvedBy: string | null;
  approvedAt: string | null;
}

/** Human review item DTO. */
export interface MigrationReviewItemDto {
  id: string;
  stagingRowId: string | null;
  reviewReason: string;
  assignedTo: string | null;
  status: string;
  decision: string | null;
  decisionNotes: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
}

/** Reconciliation result DTO — expected/actual/difference visible. */
export interface MigrationReconciliationResultDto {
  id: string;
  reportVersion: number;
  metricKey: string;
  expectedValue: string | null;
  stagedValue: string | null;
  committedValue: string | null;
  differenceValue: string | null;
  status: string;
  acceptedByOwner: string | null; // user ID or null
  acceptedByAccountant: string | null; // user ID or null
  acceptedAt: string | null;
  acceptanceReason: string | null;
}

/** Approval DTO — shows role, identity, hash binding. */
export interface MigrationApprovalDto {
  id: string;
  approverRole: string; // owner | accountant
  approverUserId: string;
  stagedDataHash: string;
  cutoverManifestHash: string | null;
  templateVersion: string | null;
  mappingVersion: string | null;
  validationStatus: string | null;
  reconciliationStatus: string | null;
  warningSummary: string | null;
  approvedAt: string;
  reason: string | null;
}

/** Backup evidence DTO — no credentials, location redacted. */
export interface MigrationBackupEvidenceDto {
  id: string;
  backupType: string;
  backupLocationRedacted: string; // type prefix only, e.g. "s3://…"
  backupHash: string;
  backupSizeBytes: number | null;
  backupCreatedAt: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  verificationNotes: string | null;
}

/** Cutover lock DTO. */
export interface MigrationCutoverLockDto {
  id: string;
  lockScope: string;
  acquiredBy: string;
  acquiredAt: string;
  expiresAt: string | null;
  releasedAt: string | null;
  releasedBy: string | null;
  releaseReason: string | null;
}

/** Cutover manifest DTO. */
export interface MigrationCutoverManifestDto {
  id: string;
  domain: string;
  importMode: string;
  cutoffDate: string | null;
  sourceCoverage: string | null;
  openingBalanceBasis: string | null;
  liveSystemStartBoundary: string | null;
  reconciliationOwner: string | null;
  manifestHash: string;
  isApproved: boolean;
}

/** Correction request DTO. */
export interface MigrationCorrectionRequestDto {
  id: string;
  docNo: string;
  importBatchId: string;
  originalEntityType: string;
  originalEntityId: string;
  correctionType: string;
  reason: string;
  status: string;
  ownerApprovedBy: string | null;
  ownerApprovedAt: string | null;
  accountantApprovedBy: string | null;
  accountantApprovedAt: string | null;
  correctedEntityType: string | null;
  correctedEntityId: string | null;
  createdAt: string;
}

/** Batch detail DTO — comprehensive view of a single batch. */
export interface MigrationBatchDetailDto {
  batch: MigrationBatchListDto & {
    cutoverManifestHash: string | null;
    cutoverImportMode: string;
    stagedDataHash: string | null;
    warningSummary: string | null;
    commitEffectCounts: unknown;
  };
  files: MigrationFileDto[];
  stagingRows: MigrationStagingRowDto[];
  validationFindings: MigrationValidationFindingDto[];
  aliasMappings: MigrationAliasMappingDto[];
  reviewItems: MigrationReviewItemDto[];
  reconciliationResults: MigrationReconciliationResultDto[];
  approvals: MigrationApprovalDto[];
  backupEvidence: MigrationBackupEvidenceDto[];
  activeLocks: MigrationCutoverLockDto[];
  cutoverManifests: MigrationCutoverManifestDto[];
  corrections: MigrationCorrectionRequestDto[];
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class MigrationScreenQueryService {
  constructor(private readonly db: Db) {}

  /**
   * List all migration batches for a tenant.
   * Returns summary DTOs for the batch list page.
   */
  async listBatches(tenantId: string): Promise<MigrationBatchListDto[]> {
    const results = await this.db
      .select()
      .from(importBatches)
      .where(eq(importBatches.tenantId, tenantId))
      .orderBy(desc(importBatches.createdAt))
      .limit(100);

    return results.map((r) => this.mapBatchListDto(r));
  }

  /**
   * Get comprehensive batch detail by ID.
   * Includes all related data: files, staging rows, validation findings,
   * aliases, review items, reconciliation results, approvals, backup evidence,
   * active locks, and cutover manifests.
   */
  async getBatchDetail(
    tenantId: string,
    batchId: string,
  ): Promise<MigrationBatchDetailDto | null> {
    const batch = await this.db
      .select()
      .from(importBatches)
      .where(and(eq(importBatches.id, batchId), eq(importBatches.tenantId, tenantId)))
      .limit(1);

    if (batch.length === 0) return null;

    const [files, stagingRows, validationFindings, aliasMappings, reviewItems, reconciliationResults, approvals, backupEvidence, activeLocks, cutoverManifests] = await Promise.all([
      this.db.select().from(importFiles).where(and(eq(importFiles.importBatchId, batchId), eq(importFiles.tenantId, tenantId))).orderBy(desc(importFiles.createdAt)),
      this.db.select().from(importStagingRows).where(and(eq(importStagingRows.importBatchId, batchId), eq(importStagingRows.tenantId, tenantId))).limit(200),
      this.db.select().from(importValidationErrors).where(and(eq(importValidationErrors.importBatchId, batchId), eq(importValidationErrors.tenantId, tenantId))).orderBy(desc(importValidationErrors.severity)),
      this.db.select().from(importAliasMappings).where(and(eq(importAliasMappings.importBatchId, batchId), eq(importAliasMappings.tenantId, tenantId))),
      this.db.select().from(importHumanReviewItems).where(and(eq(importHumanReviewItems.importBatchId, batchId), eq(importHumanReviewItems.tenantId, tenantId))),
      this.db.select().from(importReconciliationResults).where(and(eq(importReconciliationResults.importBatchId, batchId), eq(importReconciliationResults.tenantId, tenantId))).orderBy(desc(importReconciliationResults.reportVersion)),
      this.db.select().from(importBatchApprovals).where(and(eq(importBatchApprovals.importBatchId, batchId), eq(importBatchApprovals.tenantId, tenantId))),
      this.db.select().from(importBackupEvidence).where(and(eq(importBackupEvidence.importBatchId, batchId), eq(importBackupEvidence.tenantId, tenantId))),
      this.db.select().from(importCutoverLocks).where(and(eq(importCutoverLocks.importBatchId, batchId), eq(importCutoverLocks.tenantId, tenantId), desc(importCutoverLocks.acquiredAt))),
      this.db.select().from(importCutoverManifests).where(and(eq(importCutoverManifests.importBatchId, batchId), eq(importCutoverManifests.tenantId, tenantId))),
    ]);

    // Fetch correction requests for this batch
    const corrections = await this.db
      .select()
      .from(historicalCorrectionRequests)
      .where(and(eq(historicalCorrectionRequests.importBatchId, batchId), eq(historicalCorrectionRequests.tenantId, tenantId)))
      .orderBy(desc(historicalCorrectionRequests.createdAt));

    return {
      batch: {
        ...this.mapBatchListDto(batch[0]!),
        cutoverManifestHash: batch[0]!.cutoverManifestHash,
        cutoverImportMode: batch[0]!.cutoverImportMode,
        stagedDataHash: batch[0]!.stagedDataHash,
        warningSummary: batch[0]!.warningSummary,
        commitEffectCounts: batch[0]!.commitEffectCounts,
      },
      files: files.map((f) => this.mapFileDto(f)),
      stagingRows: stagingRows.map((r) => this.mapStagingRowDto(r)),
      validationFindings: validationFindings.map((v) => this.mapValidationFindingDto(v)),
      aliasMappings: aliasMappings.map((a) => this.mapAliasMappingDto(a)),
      reviewItems: reviewItems.map((r) => this.mapReviewItemDto(r)),
      reconciliationResults: reconciliationResults.map((r) => this.mapReconciliationResultDto(r)),
      approvals: approvals.map((a) => this.mapApprovalDto(a)),
      backupEvidence: backupEvidence.map((b) => this.mapBackupEvidenceDto(b)),
      activeLocks: activeLocks.map((l) => this.mapCutoverLockDto(l)),
      cutoverManifests: cutoverManifests.map((m) => this.mapCutoverManifestDto(m)),
      corrections: corrections.map((c) => this.mapCorrectionRequestDto(c)),
    };
  }

  /**
   * List correction requests for a tenant.
   */
  async listCorrectionRequests(
    tenantId: string,
  ): Promise<MigrationCorrectionRequestDto[]> {
    const results = await this.db
      .select()
      .from(historicalCorrectionRequests)
      .where(eq(historicalCorrectionRequests.tenantId, tenantId))
      .orderBy(desc(historicalCorrectionRequests.createdAt))
      .limit(100);

    return results.map((r) => ({
      id: r.id,
      docNo: r.docNo,
      importBatchId: r.importBatchId,
      originalEntityType: r.originalEntityType,
      originalEntityId: r.originalEntityId,
      correctionType: r.correctionType,
      reason: r.reason,
      status: r.status,
      ownerApprovedBy: r.ownerApprovedBy,
      ownerApprovedAt: r.ownerApprovedAt?.toISOString() ?? null,
      accountantApprovedBy: r.accountantApprovedBy,
      accountantApprovedAt: r.accountantApprovedAt?.toISOString() ?? null,
      correctedEntityType: r.correctedEntityType,
      correctedEntityId: r.correctedEntityId,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  // -------------------------------------------------------------------------
  // Private mappers — redact secrets, format dates
  // -------------------------------------------------------------------------

  private mapBatchListDto(r: typeof importBatches.$inferSelect): MigrationBatchListDto {
    return {
      id: r.id,
      batchNo: r.batchNo,
      status: r.status,
      sourceDescription: r.sourceDescription,
      templateName: r.templateName,
      templateVersion: r.templateVersion,
      mappingVersion: r.mappingVersion,
      stagedRowCount: r.stagedRowCount,
      blockingErrorCount: r.blockingErrorCount,
      warningCount: r.warningCount,
      acceptedWarningCount: r.acceptedWarningCount,
      validationStatus: r.validationStatus,
      reconciliationStatus: r.reconciliationStatus,
      committedAt: r.committedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      createdBy: r.createdBy,
    };
  }

  private mapFileDto(f: typeof importFiles.$inferSelect): MigrationFileDto {
    return {
      id: f.id,
      originalFileName: f.originalFileName,
      fileSizeBytes: f.fileSizeBytes,
      contentType: f.contentType,
      fileType: f.fileType,
      fileHashRedacted: f.fileHash.substring(0, 8) + "…",
      supersededById: f.supersededById,
      createdAt: f.createdAt.toISOString(),
    };
  }

  private mapStagingRowDto(r: typeof importStagingRows.$inferSelect): MigrationStagingRowDto {
    return {
      id: r.id,
      sourceSheetName: r.sourceSheetName,
      sourceRowNumber: r.sourceRowNumber,
      transformedRowJson: r.transformedRowJson,
      validationStatus: r.validationStatus,
      reviewStatus: r.reviewStatus,
      aiConfidence: r.aiConfidence,
      transformationNotes: r.transformationNotes,
      committedEntityType: r.committedEntityType,
      committedEntityId: r.committedEntityId,
    };
  }

  private mapValidationFindingDto(v: typeof importValidationErrors.$inferSelect): MigrationValidationFindingDto {
    return {
      id: v.id,
      stagingRowId: v.stagingRowId,
      severity: v.severity,
      errorCode: v.errorCode,
      message: v.message,
      fieldName: v.fieldName,
      isBlocking: v.isBlocking,
      resolutionStatus: v.resolutionStatus,
      resolvedBy: v.resolvedBy,
      resolvedAt: v.resolvedAt?.toISOString() ?? null,
      resolutionNotes: v.resolutionNotes,
    };
  }

  private mapAliasMappingDto(a: typeof importAliasMappings.$inferSelect): MigrationAliasMappingDto {
    return {
      id: a.id,
      entityType: a.entityType,
      sourceLabel: a.sourceLabel,
      normalizedName: a.normalizedName,
      targetMasterId: a.targetMasterId,
      mappingVersion: a.mappingVersion,
      confidenceScore: a.confidenceScore,
      status: a.status,
      approvedBy: a.approvedBy,
      approvedAt: a.approvedAt?.toISOString() ?? null,
    };
  }

  private mapReviewItemDto(r: typeof importHumanReviewItems.$inferSelect): MigrationReviewItemDto {
    return {
      id: r.id,
      stagingRowId: r.stagingRowId,
      reviewReason: r.reviewReason,
      assignedTo: r.assignedTo,
      status: r.status,
      decision: r.decision,
      decisionNotes: r.decisionNotes,
      decidedBy: r.decidedBy,
      decidedAt: r.decidedAt?.toISOString() ?? null,
    };
  }

  private mapReconciliationResultDto(r: typeof importReconciliationResults.$inferSelect): MigrationReconciliationResultDto {
    return {
      id: r.id,
      reportVersion: r.reportVersion,
      metricKey: r.metricKey,
      expectedValue: r.expectedValue,
      stagedValue: r.stagedValue,
      committedValue: r.committedValue,
      differenceValue: r.differenceValue,
      status: r.status,
      acceptedByOwner: r.acceptedByOwner,
      acceptedByAccountant: r.acceptedByAccountant,
      acceptedAt: r.acceptedAt?.toISOString() ?? null,
      acceptanceReason: r.acceptanceReason,
    };
  }

  private mapApprovalDto(a: typeof importBatchApprovals.$inferSelect): MigrationApprovalDto {
    return {
      id: a.id,
      approverRole: a.approverRole,
      approverUserId: a.approverUserId,
      stagedDataHash: a.stagedDataHash,
      cutoverManifestHash: a.cutoverManifestHash,
      templateVersion: a.templateVersion,
      mappingVersion: a.mappingVersion,
      validationStatus: a.validationStatus,
      reconciliationStatus: a.reconciliationStatus,
      warningSummary: a.warningSummary,
      approvedAt: a.approvedAt.toISOString(),
      reason: a.reason,
    };
  }

  private mapBackupEvidenceDto(b: typeof importBackupEvidence.$inferSelect): MigrationBackupEvidenceDto {
    // Redact storage location — show only the protocol/scheme prefix
    const locationRedacted = b.backupLocation.split("://")[0] + "://…";
    return {
      id: b.id,
      backupType: b.backupType,
      backupLocationRedacted: locationRedacted,
      backupHash: b.backupHash,
      backupSizeBytes: b.backupSizeBytes,
      backupCreatedAt: b.backupCreatedAt?.toISOString() ?? null,
      verifiedBy: b.verifiedBy,
      verifiedAt: b.verifiedAt?.toISOString() ?? null,
      verificationNotes: b.verificationNotes,
    };
  }

  private mapCutoverLockDto(l: typeof importCutoverLocks.$inferSelect): MigrationCutoverLockDto {
    return {
      id: l.id,
      lockScope: l.lockScope,
      acquiredBy: l.acquiredBy,
      acquiredAt: l.acquiredAt.toISOString(),
      expiresAt: l.expiresAt?.toISOString() ?? null,
      releasedAt: l.releasedAt?.toISOString() ?? null,
      releasedBy: l.releasedBy,
      releaseReason: l.releaseReason,
    };
  }

  private mapCutoverManifestDto(m: typeof importCutoverManifests.$inferSelect): MigrationCutoverManifestDto {
    return {
      id: m.id,
      domain: m.domain,
      importMode: m.importMode,
      cutoffDate: m.cutoffDate,
      sourceCoverage: m.sourceCoverage,
      openingBalanceBasis: m.openingBalanceBasis,
      liveSystemStartBoundary: m.liveSystemStartBoundary,
      reconciliationOwner: m.reconciliationOwner,
      manifestHash: m.manifestHash,
      isApproved: m.isApproved,
    };
  }

  private mapCorrectionRequestDto(c: typeof historicalCorrectionRequests.$inferSelect): MigrationCorrectionRequestDto {
    return {
      id: c.id,
      docNo: c.docNo,
      importBatchId: c.importBatchId,
      originalEntityType: c.originalEntityType,
      originalEntityId: c.originalEntityId,
      correctionType: c.correctionType,
      reason: c.reason,
      status: c.status,
      ownerApprovedBy: c.ownerApprovedBy,
      ownerApprovedAt: c.ownerApprovedAt?.toISOString() ?? null,
      accountantApprovedBy: c.accountantApprovedBy,
      accountantApprovedAt: c.accountantApprovedAt?.toISOString() ?? null,
      correctedEntityType: c.correctedEntityType,
      correctedEntityId: c.correctedEntityId,
      createdAt: c.createdAt.toISOString(),
    };
  }
}
