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
import { eq, and, desc, sql as drizzleSql, asc, inArray } from "drizzle-orm";
import {
  importBatches,
  importFiles,
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
  // WP-08-01F UX milestone — richer file-version metadata
  /** User ID of the uploader (never the email/name to avoid PII leakage in lists). */
  uploaderUserId: string | null;
  /** True when this file is the current version (no other file supersedes it). */
  isCurrent: boolean;
  /** Template type recorded for this batch (single-tenant batch→template binding). */
  templateType: string | null;
  /** Template version recorded for this batch. */
  templateVersion: string | null;
  // WP-08-01F R2 — immutable version chain metadata
  /** Monotonically increasing file version number (1, 2, 3, ...). */
  fileVersion: number;
  /** Reason recorded when this file was superseded (null if current). */
  supersededReason: string | null;
  /** Timestamp when this file was superseded (null if current). */
  supersededAt: string | null;
}

/** Staging row preview DTO — no operational effects, provenance only. */
export interface MigrationStagingRowDto {
  id: string;
  /** Linked file ID (for lineage display). */
  importFileId: string | null;
  sourceSheetName: string | null;
  sourceRowNumber: number | null;
  transformedRowJson: unknown;
  validationStatus: string | null;
  reviewStatus: string | null;
  aiConfidence: string | null;
  transformationNotes: string | null;
  committedEntityType: string | null;
  committedEntityId: string | null;
  /** Template name recorded for this staging row. */
  templateName: string | null;
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
  // WP-08-01F UX milestone — cell-level lineage (linked to staging row + file).
  /** File ID of the staging row linked to this finding (null if no staging row). */
  fileId: string | null;
  /** Original file name of the linked staging row (null if no staging row). */
  fileName: string | null;
  /** Sheet name of the linked staging row (for CSV uploads, equals file name). */
  sourceSheetName: string | null;
  /** Source row number of the linked staging row. */
  sourceRowNumber: number | null;
  /** Source column name (same as fieldName for MVP — single source of truth). */
  columnName: string | null;
  /** Submitted cell value (looked up from the staging row's transformedRowJson[fieldName]). */
  submittedValue: string | null;
  /** Normalized value if the staging row stored a different normalized form. */
  normalizedValue: string | null;
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

/** Staging pagination metadata returned by getBatchDetail. */
export interface MigrationStagingPaginationDto {
  page: number; // 1-indexed current page
  pageSize: number;
  totalRows: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

/** Validation summary counts returned by getBatchDetail. */
export interface MigrationValidationSummaryDto {
  blockingErrorCount: number;
  warningCount: number;
  informationalCount: number;
  /** True if any blocking finding exists — progression is blocked. */
  progressionBlocked: boolean;
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
  stagingPagination: MigrationStagingPaginationDto;
  validationFindings: MigrationValidationFindingDto[];
  validationSummary: MigrationValidationSummaryDto;
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
   *
   * WP-08-01F UX milestone — real server-side pagination for staging preview.
   * The staging preview no longer returns "first 200 rows"; it returns
   * exactly the requested page plus pagination metadata.
   */
  async getBatchDetail(
    tenantId: string,
    batchId: string,
    options?: { page?: number; pageSize?: number },
  ): Promise<MigrationBatchDetailDto | null> {
    const page = Math.max(1, options?.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, options?.pageSize ?? 20));

    const batch = await this.db
      .select()
      .from(importBatches)
      .where(and(eq(importBatches.id, batchId), eq(importBatches.tenantId, tenantId)))
      .limit(1);

    if (batch.length === 0) return null;

    const batchRow = batch[0]!;

    // Run independent queries in parallel. Staging rows now use COUNT + paginated SELECT.
    // WP-08-01F R1 — filter on is_current=true so superseded versions don't
    // leak into the current view. Old versions remain queryable for audit
    // via direct table access, but the UI shows only current evidence.
    const [files, allValidationFindings, aliasMappings, reviewItems, reconciliationResults, approvals, backupEvidence, activeLocks, cutoverManifests, stagingTotalResult] = await Promise.all([
      this.db.select().from(importFiles).where(and(eq(importFiles.importBatchId, batchId), eq(importFiles.tenantId, tenantId))).orderBy(desc(importFiles.createdAt)),
      this.db.select().from(importValidationErrors).where(and(eq(importValidationErrors.importBatchId, batchId), eq(importValidationErrors.tenantId, tenantId), eq(importValidationErrors.isCurrent, true))).orderBy(desc(importValidationErrors.severity)),
      this.db.select().from(importAliasMappings).where(and(eq(importAliasMappings.importBatchId, batchId), eq(importAliasMappings.tenantId, tenantId))),
      this.db.select().from(importHumanReviewItems).where(and(eq(importHumanReviewItems.importBatchId, batchId), eq(importHumanReviewItems.tenantId, tenantId))),
      this.db.select().from(importReconciliationResults).where(and(eq(importReconciliationResults.importBatchId, batchId), eq(importReconciliationResults.tenantId, tenantId))).orderBy(desc(importReconciliationResults.reportVersion)),
      this.db.select().from(importBatchApprovals).where(and(eq(importBatchApprovals.importBatchId, batchId), eq(importBatchApprovals.tenantId, tenantId), eq(importBatchApprovals.isCurrent, true))),
      this.db.select().from(importBackupEvidence).where(and(eq(importBackupEvidence.importBatchId, batchId), eq(importBackupEvidence.tenantId, tenantId))),
      this.db.select().from(importCutoverLocks).where(and(eq(importCutoverLocks.importBatchId, batchId), eq(importCutoverLocks.tenantId, tenantId))).orderBy(desc(importCutoverLocks.acquiredAt)),
      this.db.select().from(importCutoverManifests).where(and(eq(importCutoverManifests.importBatchId, batchId), eq(importCutoverManifests.tenantId, tenantId), eq(importCutoverManifests.isCurrent, true))),
      // Total staging row count — server-side pagination metadata.
      // WP-08-01F R1 — count only current staging rows.
      this.db
        .select({ count: drizzleSql<number>`count(*)::int` })
        .from(importStagingRows)
        .where(and(eq(importStagingRows.importBatchId, batchId), eq(importStagingRows.tenantId, tenantId), eq(importStagingRows.isCurrent, true))),
    ]);

    const totalRows: number = Number(stagingTotalResult[0]?.count ?? 0);
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    // Clamp page to the last valid page when totalRows shrank after the user navigated.
    const currentPage = Math.min(page, totalPages);
    const offset = (currentPage - 1) * pageSize;

    // Fetch only the requested page of current staging rows.
    const stagingRowsPage = await this.db
      .select()
      .from(importStagingRows)
      .where(and(eq(importStagingRows.importBatchId, batchId), eq(importStagingRows.tenantId, tenantId), eq(importStagingRows.isCurrent, true)))
      .orderBy(asc(importStagingRows.sourceRowNumber), asc(importStagingRows.id))
      .limit(pageSize)
      .offset(offset);

    // Fetch correction requests for this batch
    const corrections = await this.db
      .select()
      .from(historicalCorrectionRequests)
      .where(and(eq(historicalCorrectionRequests.importBatchId, batchId), eq(historicalCorrectionRequests.tenantId, tenantId)))
      .orderBy(desc(historicalCorrectionRequests.createdAt));

    // Build lookup maps for cell-level lineage enrichment of validation findings.
    const fileById = new Map(files.map((f) => [f.id, f]));
    const stagingRowById = new Map(stagingRowsPage.map((r) => [r.id, r]));
    // Findings may reference staging rows NOT on the current page — fetch them in one shot.
    const findingStagingRowIds = allValidationFindings
      .map((v) => v.stagingRowId)
      .filter((id): id is string => id !== null);
    const unresolvedStagingRowIds = findingStagingRowIds.filter((id) => !stagingRowById.has(id));
    let extraStagingRows: typeof importStagingRows.$inferSelect[] = [];
    if (unresolvedStagingRowIds.length > 0) {
      extraStagingRows = await this.db
        .select()
        .from(importStagingRows)
        .where(and(
          eq(importStagingRows.tenantId, tenantId),
          inArray(importStagingRows.id, unresolvedStagingRowIds),
        ));
      for (const r of extraStagingRows) stagingRowById.set(r.id, r);
    }

    // WP-08-01F R2 — use the DB is_current column directly (authoritative).
    // The old computation via supersededById is kept as a fallback for
    // backward compatibility with rows that might have null is_current
    // (shouldn't happen after migration 0017, but defensive).
    const supersededIds = new Set(files.map((f) => f.supersededById).filter((id): id is string => id !== null));

    // Validation summary counts (computed from the full findings list, not the page).
    const validationSummary: MigrationValidationSummaryDto = {
      blockingErrorCount: allValidationFindings.filter((v) => v.severity === "blocking_error").length,
      warningCount: allValidationFindings.filter((v) => v.severity === "review_required_warning").length,
      informationalCount: allValidationFindings.filter((v) => v.severity === "informational").length,
      progressionBlocked: allValidationFindings.some((v) => v.isBlocking),
    };

    const stagingPagination: MigrationStagingPaginationDto = {
      page: currentPage,
      pageSize,
      totalRows,
      totalPages,
      hasNextPage: currentPage < totalPages,
      hasPrevPage: currentPage > 1,
    };

    return {
      batch: {
        ...this.mapBatchListDto(batchRow),
        cutoverManifestHash: batchRow.cutoverManifestHash,
        cutoverImportMode: batchRow.cutoverImportMode,
        stagedDataHash: batchRow.stagedDataHash,
        warningSummary: batchRow.warningSummary,
        commitEffectCounts: batchRow.commitEffectCounts,
      },
      files: files.map((f) => this.mapFileDto(f, batchRow, !f.isCurrent && supersededIds.has(f.id))),
      stagingRows: stagingRowsPage.map((r) => this.mapStagingRowDto(r)),
      stagingPagination,
      validationFindings: allValidationFindings.map((v) => this.mapValidationFindingDto(v, stagingRowById, fileById)),
      validationSummary,
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
   * List validation findings for a batch — used by the CSV report route.
   * Returns the full findings list with cell-level lineage enrichment,
   * so the report can include file/sheet/row/column/submitted/normalized
   * values regardless of pagination.
   */
  async listValidationFindings(
    tenantId: string,
    batchId: string,
  ): Promise<MigrationValidationFindingDto[]> {
    const findings = await this.db
      .select()
      .from(importValidationErrors)
      .where(and(eq(importValidationErrors.importBatchId, batchId), eq(importValidationErrors.tenantId, tenantId), eq(importValidationErrors.isCurrent, true)))
      .orderBy(desc(importValidationErrors.severity));

    const files = await this.db
      .select()
      .from(importFiles)
      .where(and(eq(importFiles.importBatchId, batchId), eq(importFiles.tenantId, tenantId)));

    const stagingRowIds = findings
      .map((v) => v.stagingRowId)
      .filter((id): id is string => id !== null);
    let stagingRows: typeof importStagingRows.$inferSelect[] = [];
    if (stagingRowIds.length > 0) {
      stagingRows = await this.db
        .select()
        .from(importStagingRows)
        .where(and(
          eq(importStagingRows.tenantId, tenantId),
          inArray(importStagingRows.id, stagingRowIds),
        ));
    }

    const fileById = new Map(files.map((f) => [f.id, f]));
    const stagingRowById = new Map(stagingRows.map((r) => [r.id, r]));
    return findings.map((v) => this.mapValidationFindingDto(v, stagingRowById, fileById));
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

  private mapFileDto(
    f: typeof importFiles.$inferSelect,
    batch: typeof importBatches.$inferSelect,
    isSuperseded: boolean,
  ): MigrationFileDto {
    return {
      id: f.id,
      originalFileName: f.originalFileName,
      fileSizeBytes: f.fileSizeBytes,
      contentType: f.contentType,
      fileType: f.fileType,
      fileHashRedacted: f.fileHash.substring(0, 8) + "…",
      supersededById: f.supersededById,
      createdAt: f.createdAt.toISOString(),
      // WP-08-01F UX milestone — richer file-version metadata.
      // The uploader is the user who created the file record (tenant-owned row).
      uploaderUserId: f.createdBy,
      // A file is "current" when no other file supersedes it.
      isCurrent: !isSuperseded,
      // Template binding is at the batch level (single template per batch).
      templateType: batch.templateName,
      templateVersion: batch.templateVersion,
      // WP-08-01F R2 — immutable version chain metadata.
      fileVersion: f.fileVersion,
      supersededReason: f.supersededReason,
      supersededAt: f.supersededAt?.toISOString() ?? null,
    };
  }

  private mapStagingRowDto(r: typeof importStagingRows.$inferSelect): MigrationStagingRowDto {
    return {
      id: r.id,
      importFileId: r.importFileId,
      sourceSheetName: r.sourceSheetName,
      sourceRowNumber: r.sourceRowNumber,
      transformedRowJson: r.transformedRowJson,
      validationStatus: r.validationStatus,
      reviewStatus: r.reviewStatus,
      aiConfidence: r.aiConfidence,
      transformationNotes: r.transformationNotes,
      committedEntityType: r.committedEntityType,
      committedEntityId: r.committedEntityId,
      templateName: r.templateName,
    };
  }

  /**
   * Map a validation finding DB row to DTO, enriching it with cell-level lineage.
   * The stagingRowById and fileById maps are built by the caller to avoid N+1 queries.
   */
  private mapValidationFindingDto(
    v: typeof importValidationErrors.$inferSelect,
    stagingRowById: Map<string, typeof importStagingRows.$inferSelect>,
    fileById: Map<string, typeof importFiles.$inferSelect>,
  ): MigrationValidationFindingDto {
    const stagingRow = v.stagingRowId ? stagingRowById.get(v.stagingRowId) ?? null : null;
    const file = stagingRow?.importFileId ? fileById.get(stagingRow.importFileId) ?? null : null;
    // Pull the submitted value from the staging row's transformed JSON by field name.
    let submittedValue: string | null = null;
    let normalizedValue: string | null = null;
    if (stagingRow && v.fieldName) {
      const transformed = stagingRow.transformedRowJson;
      if (transformed && typeof transformed === "object" && !Array.isArray(transformed)) {
        const obj = transformed as Record<string, unknown>;
        const raw = obj[v.fieldName];
        if (raw !== undefined && raw !== null) {
          submittedValue = String(raw);
        }
        // rawRowJson holds the original (un-normalized) value — read it from the staging row.
        // For MVP, raw and transformed are stored identically, so normalizedValue stays null
        // unless the JSON object explicitly stores a separate "normalized" form.
        const rawJson = stagingRow.rawRowJson;
        if (rawJson && typeof rawJson === "object" && !Array.isArray(rawJson)) {
          const rawObj = rawJson as Record<string, unknown>;
          const rawCell = rawObj[v.fieldName];
          if (rawCell !== undefined && rawCell !== null && String(rawCell) !== submittedValue) {
            normalizedValue = submittedValue;
            submittedValue = String(rawCell);
          }
        }
      }
    }
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
      fileId: file?.id ?? null,
      fileName: file?.originalFileName ?? null,
      sourceSheetName: stagingRow?.sourceSheetName ?? null,
      sourceRowNumber: stagingRow?.sourceRowNumber ?? null,
      columnName: v.fieldName,
      submittedValue,
      normalizedValue,
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
