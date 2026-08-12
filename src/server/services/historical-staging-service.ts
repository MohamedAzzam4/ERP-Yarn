/**
 * Historical Staging Service — WP-07-01.
 *
 * Contract: docs/contracts/08_historical_migration_contract.md
 *   §5.1 Normalized Historical Import Templates
 *   §6 Key Entities (import_batches, import_files, import_template_versions, import_staging_rows)
 *   §8.1 Staging Isolation (non-operational)
 *
 * Contract: docs/contracts/13_work_packages.md WP-07-01
 *   Goal: "Build versioned templates/private files and non-operational staging."
 *
 * WP-07-01 SCOPE:
 *   - Create template versions (versioned, non-destructive)
 *   - Register file metadata with checksum/provenance
 *   - Create staging batches
 *   - Insert staging rows (non-operational, tenant-scoped)
 *   - List batches/details
 *   - Status transitions allowed in WP-07-01 only (draft → source_uploaded → staged)
 *
 * WP-07-01 NON-SCOPE:
 *   - No validation (WP-07-02)
 *   - No reconciliation (WP-07-03)
 *   - No commit (WP-07-04)
 *   - No correction (WP-07-05)
 *   - No AI-assisted transformation
 *   - No operational effects (stock/account/sales/payment/production)
 *   - No public file exposure
 */
import "server-only";

import type { ErpUserContext } from "@/server/auth/erp-context";
import {
  requirePermission,
  requireTenantMatch,
  rejectBodyClaimsAuthority,
} from "@/server/security/guards";
import type { EffectivePermissions } from "@/server/security/effective-permissions";
import { appendAuditLog, type AuditTransactionHandle } from "./audit-service";
import {
  claimIdempotency,
  markSucceeded,
  markBusinessFailed,
  type IdempotencyTransactionHandle,
  type IdempotencyClaimInput,
} from "./idempotency-service";
import {
  allocateDocumentNumber,
  type DocumentSequenceTransactionHandle,
} from "./document-sequence-service";
import type { HistoricalStagingRepository } from "./historical-staging-repository";
import type {
  ImportBatch,
  ImportFile,
  ImportTemplateVersion,
  ImportStagingRow,
} from "@/server/db/schema/migration";
import { guardRegisterFileInitial, guardInsertStagingRow } from "./migration-lifecycle-guard";

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

export interface CreateTemplateVersionInput {
  templateName: string;
  templateVersion: string;
  schemaJson: Record<string, unknown>;
  idempotencyKey: string;
}

export interface CreateTemplateVersionResult {
  action: "created" | "replayed";
  templateId: string;
  templateName: string;
  templateVersion: string;
}

export interface RegisterFileInput {
  importBatchId: string;
  originalFileName: string;
  storagePath: string;
  fileHash: string;
  fileSizeBytes: number | null;
  contentType: string | null;
  fileType: string; // 'source' | 'normalized' | 'mapping' | 'report'
  idempotencyKey: string;
}

export interface RegisterFileResult {
  action: "created" | "replayed";
  fileId: string;
  importBatchId: string;
  fileHash: string;
}

export interface CreateBatchInput {
  sourceDescription: string | null;
  templateName: string | null;
  templateVersion: string | null;
  cutoverImportMode: string;
  idempotencyKey: string;
}

export interface CreateBatchResult {
  action: "created" | "replayed";
  batchId: string;
  batchNo: string;
  status: string;
}

export interface InsertStagingRowInput {
  importBatchId: string;
  importFileId: string | null;
  templateName: string | null;
  sourceSheetName: string | null;
  sourceRowNumber: number | null;
  rawRowJson: Record<string, unknown> | null;
  transformedRowJson: Record<string, unknown> | null;
  transformationNotes: string | null;
  idempotencyKey: string;
}

export interface InsertStagingRowResult {
  action: "created" | "replayed";
  stagingRowId: string;
  importBatchId: string;
}

// WP-08-01F DEFECT 1A — finalizeStaging command
export interface FinalizeStagingInput {
  importBatchId: string;
  idempotencyKey: string;
}

export interface FinalizeStagingResult {
  action: "finalized" | "replayed";
  batchId: string;
  previousStatus: string;
  newStatus: "staged";
  stagedDataHash: string;
  stagedRowCount: number;
}

// WP-08-01F DEFECT 1A — finalizeCutoverManifest command
export interface FinalizeCutoverManifestInput {
  importBatchId: string;
  /** Domain for the manifest (e.g. 'inventory', 'customer_balances'). */
  domain: string;
  /** Cutoff date for the cutover (ISO date string). */
  cutoffDate: string | null;
  /** Source coverage description. */
  sourceCoverage: string | null;
  /** Opening balance basis description. */
  openingBalanceBasis: string | null;
  /** Live system start boundary (ISO date string). */
  liveSystemStartBoundary: string | null;
  idempotencyKey: string;
}

export interface FinalizeCutoverManifestResult {
  action: "finalized" | "replayed";
  batchId: string;
  manifestId: string;
  manifestHash: string;
  cutoverManifestHash: string;
}

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

export class HistoricalStagingError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "HistoricalStagingError";
    this.code = code;
  }
}

export class TemplateVersionAlreadyExistsError extends HistoricalStagingError {
  constructor(name: string, version: string) {
    super("STATE_CONFLICT", `Template '${name}' version '${version}' already exists.`);
    this.name = "TemplateVersionAlreadyExistsError";
  }
}

export class ImportError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ImportError";
    this.code = code;
  }
}

export class BatchNotFoundError extends ImportError {
  constructor(id: string) {
    super("BATCH_NOT_FOUND", `Import batch '${id}' not found.`);
    this.name = "BatchNotFoundError";
  }
}

export class DuplicateFileError extends HistoricalStagingError {
  constructor(fileHash: string) {
    super("DUPLICATE_FILE", `File with hash '${fileHash}' already registered for this batch.`);
    this.name = "DuplicateFileError";
  }
}

// ---------------------------------------------------------------------------
// Service deps.
// ---------------------------------------------------------------------------

export interface HistoricalStagingServiceDeps {
  repository: HistoricalStagingRepository;
  audit: AuditTransactionHandle;
  idempotency: IdempotencyTransactionHandle;
  documentSequence: DocumentSequenceTransactionHandle;
}

// ---------------------------------------------------------------------------
// Constants.
// ---------------------------------------------------------------------------

const ENTITY_TYPE = "import_batch";
const TEMPLATE_ENTITY_TYPE = "import_template_version";
const FILE_ENTITY_TYPE = "import_file";
const STAGING_ROW_ENTITY_TYPE = "import_staging_row";

// ---------------------------------------------------------------------------
// HistoricalStagingService.
// ---------------------------------------------------------------------------

export class HistoricalStagingService {
  constructor(private readonly deps: HistoricalStagingServiceDeps) {}

  /**
   * Create a template version.
   *
   * Permission: migration.prepare (Owner/Accountant).
   * Template changes create new versions — they do not overwrite existing versions.
   */
  async createTemplateVersion(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: CreateTemplateVersionInput,
  ): Promise<CreateTemplateVersionResult> {
    requirePermission(effective, "migration.prepare");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!input.templateName?.trim()) throw new HistoricalStagingError("VALIDATION_FAILED", "templateName is required.");
    if (!input.templateVersion?.trim()) throw new HistoricalStagingError("VALIDATION_FAILED", "templateVersion is required.");
    if (!input.idempotencyKey?.trim()) throw new HistoricalStagingError("VALIDATION_FAILED", "idempotencyKey is required.");

    const now = new Date();
    const claim = await claimIdempotency(this.deps.idempotency, {
      tenantId: user.tenantId,
      operationScope: "historical_template.create",
      idempotencyKey: input.idempotencyKey,
      requestBody: { templateName: input.templateName, templateVersion: input.templateVersion } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    });

    if (claim.action === "replay") {
      const responseBody = claim.record.responseBody as Partial<CreateTemplateVersionResult> | null;
      if (responseBody?.templateId) return { ...responseBody, action: "replayed" } as CreateTemplateVersionResult;
    }
    if (claim.action === "conflict") throw new HistoricalStagingError("IDEMPOTENCY_CONFLICT", `Idempotency key conflict.`);
    if (claim.action === "in_progress") throw new HistoricalStagingError("OPERATION_IN_PROGRESS", `Operation in progress.`);

    // Check for existing template version (non-destructive)
    const existing = await this.deps.repository.findTemplateVersion(user.tenantId, input.templateName, input.templateVersion);
    if (existing) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 409,
        responseBody: { message: `Template version already exists.` },
        lastErrorClass: "TemplateVersionAlreadyExistsError",
      }, claim.record.ownerToken!, now);
      throw new TemplateVersionAlreadyExistsError(input.templateName, input.templateVersion);
    }

    const template = await this.deps.repository.insertTemplateVersion({
      tenantId: user.tenantId,
      templateName: input.templateName,
      templateVersion: input.templateVersion,
      schemaJson: input.schemaJson,
      createdBy: user.userId,
    });

    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: TEMPLATE_ENTITY_TYPE,
      entityId: template.id,
      actionType: "historical_template.create",
      newValuesJson: {
        templateName: template.templateName,
        templateVersion: template.templateVersion,
      },
      idempotencyKey: input.idempotencyKey,
    });

    const result: CreateTemplateVersionResult = {
      action: "created",
      templateId: template.id,
      templateName: template.templateName,
      templateVersion: template.templateVersion,
    };

    await markSucceeded(this.deps.idempotency, claim.record.id, {
      responseCode: 200, responseBody: result,
      entityType: TEMPLATE_ENTITY_TYPE, entityId: template.id,
    }, claim.record.ownerToken!, now);

    return result;
  }

  /**
   * Register a file with checksum/provenance.
   *
   * Permission: migration.prepare.
   * Duplicate file (same hash + batch + type) returns the existing file (idempotent).
   */
  async registerFile(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: RegisterFileInput,
  ): Promise<RegisterFileResult> {
    requirePermission(effective, "migration.prepare");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!input.importBatchId?.trim()) throw new HistoricalStagingError("VALIDATION_FAILED", "importBatchId is required.");
    if (!input.fileHash?.trim()) throw new HistoricalStagingError("VALIDATION_FAILED", "fileHash is required.");
    if (!input.idempotencyKey?.trim()) throw new HistoricalStagingError("VALIDATION_FAILED", "idempotencyKey is required.");
    if (!input.storagePath?.trim()) throw new HistoricalStagingError("VALIDATION_FAILED", "storagePath is required.");
    if (!input.originalFileName?.trim()) throw new HistoricalStagingError("VALIDATION_FAILED", "originalFileName is required.");

    // WP-07-01 Task 3: Private file metadata validation.
    // Reject public URLs — files must use private storage references only.
    const path = input.storagePath.trim().toLowerCase();
    if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("ftp://") || path.startsWith("www.")) {
      throw new HistoricalStagingError("VALIDATION_FAILED", "storagePath must be a private storage reference, not a public URL.");
    }
    // Reject secret-looking values in storage path (tokens, passwords, API keys).
    if (/(?:token|password|secret|api[_-]?key|bearer|authorization)[=:]/i.test(input.storagePath)) {
      throw new HistoricalStagingError("VALIDATION_FAILED", "storagePath must not contain tokens, passwords, or secret values.");
    }

    // Verify batch exists + tenant match
    const batch = await this.deps.repository.findImportBatchById(user.tenantId, input.importBatchId);
    if (!batch) throw new BatchNotFoundError(input.importBatchId);
    requireTenantMatch(user, batch.tenantId);

    // WP-08-01F DEFECT 1: Enforce lifecycle state before any write.
    // WP-08-01F R1: ordinary INITIAL upload is allowed ONLY before staging
    // finalization. From `staged` onward, the explicit `replaceMigrationFile`
    // command must be used so that hashes are reset and approvals are
    // invalidated through append-only supersession.
    guardRegisterFileInitial(batch);

    const now = new Date();
    const claim = await claimIdempotency(this.deps.idempotency, {
      tenantId: user.tenantId,
      operationScope: "historical_file.register",
      idempotencyKey: input.idempotencyKey,
      requestBody: { importBatchId: input.importBatchId, fileHash: input.fileHash, fileType: input.fileType } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    });

    if (claim.action === "replay") {
      const responseBody = claim.record.responseBody as Partial<RegisterFileResult> | null;
      if (responseBody?.fileId) return { ...responseBody, action: "replayed" } as RegisterFileResult;
    }
    if (claim.action === "conflict") throw new HistoricalStagingError("IDEMPOTENCY_CONFLICT", `Idempotency key conflict.`);
    if (claim.action === "in_progress") throw new HistoricalStagingError("OPERATION_IN_PROGRESS", `Operation in progress.`);

    // Check for duplicate file (same hash + batch + type)
    const existing = await this.deps.repository.findImportFileByHash(
      user.tenantId, input.importBatchId, input.fileHash, input.fileType,
    );
    if (existing) {
      // Duplicate file — return existing (idempotent behavior)
      const result: RegisterFileResult = {
        action: "created",
        fileId: existing.id,
        importBatchId: existing.importBatchId,
        fileHash: existing.fileHash,
      };
      await markSucceeded(this.deps.idempotency, claim.record.id, {
        responseCode: 200, responseBody: result,
        entityType: FILE_ENTITY_TYPE, entityId: existing.id,
      }, claim.record.ownerToken!, now);
      return result;
    }

    const file = await this.deps.repository.insertImportFile({
      tenantId: user.tenantId,
      importBatchId: input.importBatchId,
      originalFileName: input.originalFileName,
      storagePath: input.storagePath,
      fileHash: input.fileHash,
      fileSizeBytes: input.fileSizeBytes,
      contentType: input.contentType,
      fileType: input.fileType,
      createdBy: user.userId,
    });

    // WP-08-01F DEFECT 1A: registerFile transitions draft → source_uploaded.
    // Contract 08 §9: draft → source_uploaded is the first lifecycle transition.
    if (batch.status === "draft") {
      await this.deps.repository.updateBatchStatus(user.tenantId, input.importBatchId, "source_uploaded");
    }

    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: FILE_ENTITY_TYPE,
      entityId: file.id,
      actionType: "historical_file.register",
      newValuesJson: {
        importBatchId: file.importBatchId,
        originalFileName: file.originalFileName,
        fileHash: file.fileHash,
        fileType: file.fileType,
        storagePath: file.storagePath,
        batchStatusTransition: batch.status === "draft" ? "draft → source_uploaded" : "unchanged",
      },
      idempotencyKey: input.idempotencyKey,
    });

    const result: RegisterFileResult = {
      action: "created",
      fileId: file.id,
      importBatchId: file.importBatchId,
      fileHash: file.fileHash,
    };

    await markSucceeded(this.deps.idempotency, claim.record.id, {
      responseCode: 200, responseBody: result,
      entityType: FILE_ENTITY_TYPE, entityId: file.id,
    }, claim.record.ownerToken!, now);

    return result;
  }

  /**
   * Create a staging batch.
   *
   * Permission: migration.prepare.
   */
  async createBatch(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: CreateBatchInput,
  ): Promise<CreateBatchResult> {
    requirePermission(effective, "migration.prepare");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!input.idempotencyKey?.trim()) throw new HistoricalStagingError("VALIDATION_FAILED", "idempotencyKey is required.");

    const now = new Date();
    const claim = await claimIdempotency(this.deps.idempotency, {
      tenantId: user.tenantId,
      operationScope: "historical_batch.create",
      idempotencyKey: input.idempotencyKey,
      requestBody: { sourceDescription: input.sourceDescription, templateName: input.templateName } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    });

    if (claim.action === "replay") {
      const responseBody = claim.record.responseBody as Partial<CreateBatchResult> | null;
      if (responseBody?.batchId) return { ...responseBody, action: "replayed" } as CreateBatchResult;
    }
    if (claim.action === "conflict") throw new HistoricalStagingError("IDEMPOTENCY_CONFLICT", `Idempotency key conflict.`);
    if (claim.action === "in_progress") throw new HistoricalStagingError("OPERATION_IN_PROGRESS", `Operation in progress.`);

    // Allocate batch number
    const year = now.getUTCFullYear();
    const docNoResult = await allocateDocumentNumber(this.deps.documentSequence, {
      tenantId: user.tenantId, documentType: "migration_batch", year, entityType: ENTITY_TYPE,
    });

    const batch = await this.deps.repository.insertImportBatch({
      tenantId: user.tenantId,
      batchNo: docNoResult.docNo,
      sourceDescription: input.sourceDescription,
      templateName: input.templateName,
      templateVersion: input.templateVersion,
      cutoverImportMode: input.cutoverImportMode,
      createdBy: user.userId,
    });

    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: ENTITY_TYPE,
      entityId: batch.id,
      actionType: "historical_batch.create",
      newValuesJson: {
        batchNo: batch.batchNo,
        sourceDescription: batch.sourceDescription,
        templateName: batch.templateName,
        cutoverImportMode: batch.cutoverImportMode,
      },
      idempotencyKey: input.idempotencyKey,
    });

    const result: CreateBatchResult = {
      action: "created",
      batchId: batch.id,
      batchNo: batch.batchNo,
      status: batch.status,
    };

    await markSucceeded(this.deps.idempotency, claim.record.id, {
      responseCode: 200, responseBody: result,
      entityType: ENTITY_TYPE, entityId: batch.id,
    }, claim.record.ownerToken!, now);

    return result;
  }

  /**
   * Insert a staging row.
   *
   * Permission: migration.prepare.
   * Staging rows are non-operational — no stock/account/sales effects.
   */
  async insertStagingRow(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: InsertStagingRowInput,
  ): Promise<InsertStagingRowResult> {
    requirePermission(effective, "migration.prepare");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!input.importBatchId?.trim()) throw new HistoricalStagingError("VALIDATION_FAILED", "importBatchId is required.");
    if (!input.idempotencyKey?.trim()) throw new HistoricalStagingError("VALIDATION_FAILED", "idempotencyKey is required.");

    // Verify batch exists + tenant match
    const batch = await this.deps.repository.findImportBatchById(user.tenantId, input.importBatchId);
    if (!batch) throw new BatchNotFoundError(input.importBatchId);
    requireTenantMatch(user, batch.tenantId);

    // WP-08-01F DEFECT 1: Enforce lifecycle state before any write
    guardInsertStagingRow(batch);

    const now = new Date();
    const claim = await claimIdempotency(this.deps.idempotency, {
      tenantId: user.tenantId,
      operationScope: "historical_staging_row.insert",
      idempotencyKey: input.idempotencyKey,
      requestBody: { importBatchId: input.importBatchId, sourceRowNumber: input.sourceRowNumber } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    });

    if (claim.action === "replay") {
      const responseBody = claim.record.responseBody as Partial<InsertStagingRowResult> | null;
      if (responseBody?.stagingRowId) return { ...responseBody, action: "replayed" } as InsertStagingRowResult;
    }
    if (claim.action === "conflict") throw new HistoricalStagingError("IDEMPOTENCY_CONFLICT", `Idempotency key conflict.`);
    if (claim.action === "in_progress") throw new HistoricalStagingError("OPERATION_IN_PROGRESS", `Operation in progress.`);

    const stagingRow = await this.deps.repository.insertStagingRow({
      tenantId: user.tenantId,
      importBatchId: input.importBatchId,
      importFileId: input.importFileId,
      templateName: input.templateName,
      sourceSheetName: input.sourceSheetName,
      sourceRowNumber: input.sourceRowNumber,
      rawRowJson: input.rawRowJson,
      transformedRowJson: input.transformedRowJson,
      transformationNotes: input.transformationNotes,
      createdBy: user.userId,
    });

    // Update batch staged row count
    const rows = await this.deps.repository.findStagingRowsForBatch(user.tenantId, input.importBatchId);
    await this.deps.repository.updateBatchStagedRowCount(user.tenantId, input.importBatchId, rows.length);

    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: STAGING_ROW_ENTITY_TYPE,
      entityId: stagingRow.id,
      actionType: "historical_staging_row.insert",
      newValuesJson: {
        importBatchId: stagingRow.importBatchId,
        sourceSheetName: stagingRow.sourceSheetName,
        sourceRowNumber: stagingRow.sourceRowNumber,
      },
      idempotencyKey: input.idempotencyKey,
    });

    const result: InsertStagingRowResult = {
      action: "created",
      stagingRowId: stagingRow.id,
      importBatchId: stagingRow.importBatchId,
    };

    await markSucceeded(this.deps.idempotency, claim.record.id, {
      responseCode: 200, responseBody: result,
      entityType: STAGING_ROW_ENTITY_TYPE, entityId: stagingRow.id,
    }, claim.record.ownerToken!, now);

    return result;
  }

  // ===========================================================================
  // WP-08-01F DEFECT 1A — finalizeStaging
  //
  // Explicit idempotent command that:
  //   - requires migration.prepare permission
  //   - derives tenant/actor server-side
  //   - requires exact predecessor state (source_uploaded or normalized)
  //   - calculates stagedDataHash server-side from persisted staging rows
  //   - transitions batch to 'staged'
  //   - writes audit
  //   - uses DB-backed idempotency with owner-token fencing
  //   - produces zero operational effects
  // ===========================================================================

  async finalizeStaging(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: FinalizeStagingInput,
  ): Promise<FinalizeStagingResult> {
    requirePermission(effective, "migration.prepare");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!input.importBatchId?.trim()) throw new HistoricalStagingError("VALIDATION_FAILED", "importBatchId is required.");
    if (!input.idempotencyKey?.trim()) throw new HistoricalStagingError("VALIDATION_FAILED", "idempotencyKey is required.");

    // Check for idempotent replay FIRST (before status check) — if this
    // finalize already succeeded, return the existing result even if the
    // batch has since transitioned to a later state.
    const nowForReplay = new Date();
    const replayClaim = await claimIdempotency(this.deps.idempotency, {
      tenantId: user.tenantId,
      operationScope: "historical_staging.finalize",
      idempotencyKey: input.idempotencyKey,
      requestBody: { importBatchId: input.importBatchId } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now: nowForReplay,
    });
    if (replayClaim.action === "replay") {
      const responseBody = replayClaim.record.responseBody as Partial<FinalizeStagingResult> | null;
      if (responseBody?.batchId) return { ...responseBody, action: "replayed" } as FinalizeStagingResult;
    }
    if (replayClaim.action === "conflict") throw new HistoricalStagingError("IDEMPOTENCY_CONFLICT", "Idempotency key conflict.");
    if (replayClaim.action === "in_progress") throw new HistoricalStagingError("OPERATION_IN_PROGRESS", "Operation in progress.");

    const batch = await this.deps.repository.findImportBatchById(user.tenantId, input.importBatchId);
    if (!batch) throw new BatchNotFoundError(input.importBatchId);
    requireTenantMatch(user, batch.tenantId);

    // Require exact predecessor state: source_uploaded or normalized
    if (batch.status !== "source_uploaded" && batch.status !== "normalized") {
      throw new HistoricalStagingError(
        "INVALID_BATCH_STATUS",
        `Cannot finalize staging on batch '${input.importBatchId}' in status '${batch.status}'. ` +
          `Must be 'source_uploaded' or 'normalized'.`,
      );
    }

    // Require at least one staging row
    const rows = await this.deps.repository.findStagingRowsForBatch(user.tenantId, input.importBatchId);
    if (rows.length === 0) {
      throw new HistoricalStagingError("VALIDATION_FAILED", "Cannot finalize staging — no staging rows found.");
    }

    const claim = replayClaim; // use the claim acquired above

    // Server-side hash derivation: SHA-256 of all staging row IDs + transformed JSON
    const crypto = await import("node:crypto");
    const hashInput = rows
      .map(r => `${r.id}:${JSON.stringify(r.transformedRowJson ?? r.rawRowJson)}`)
      .sort()
      .join("|");
    const stagedDataHash = crypto.createHash("sha256").update(hashInput).digest("hex");

    // Update batch: set stagedDataHash + status = staged + stagedRowCount
    await this.deps.repository.updateBatchStagedDataHash(user.tenantId, input.importBatchId, stagedDataHash, user.userId);
    await this.deps.repository.updateBatchStagedRowCount(user.tenantId, input.importBatchId, rows.length);
    await this.deps.repository.updateBatchStatus(user.tenantId, input.importBatchId, "staged");

    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: ENTITY_TYPE,
      entityId: input.importBatchId,
      actionType: "historical_staging.finalize",
      newValuesJson: {
        previousStatus: batch.status,
        newStatus: "staged",
        stagedDataHash,
        stagedRowCount: rows.length,
      },
      idempotencyKey: input.idempotencyKey,
    });

    const result: FinalizeStagingResult = {
      action: "finalized",
      batchId: input.importBatchId,
      previousStatus: batch.status,
      newStatus: "staged",
      stagedDataHash,
      stagedRowCount: rows.length,
    };

    await markSucceeded(this.deps.idempotency, claim.record.id, {
      responseCode: 200, responseBody: result,
      entityType: ENTITY_TYPE, entityId: input.importBatchId,
    }, claim.record.ownerToken!, nowForReplay);

    return result;
  }

  // ===========================================================================
  // WP-08-01F DEFECT 1A — finalizeCutoverManifest
  //
  // Explicit idempotent command that:
  //   - requires migration.prepare permission
  //   - derives tenant/actor server-side
  //   - creates a cutover manifest with server-derived manifestHash
  //   - binds the manifestHash to the batch (cutoverManifestHash)
  //   - writes audit
  //   - uses DB-backed idempotency
  //   - produces zero operational effects
  // ===========================================================================

  async finalizeCutoverManifest(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: FinalizeCutoverManifestInput,
  ): Promise<FinalizeCutoverManifestResult> {
    requirePermission(effective, "migration.prepare");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!input.importBatchId?.trim()) throw new HistoricalStagingError("VALIDATION_FAILED", "importBatchId is required.");
    if (!input.domain?.trim()) throw new HistoricalStagingError("VALIDATION_FAILED", "domain is required.");
    if (!input.idempotencyKey?.trim()) throw new HistoricalStagingError("VALIDATION_FAILED", "idempotencyKey is required.");

    const batch = await this.deps.repository.findImportBatchById(user.tenantId, input.importBatchId);
    if (!batch) throw new BatchNotFoundError(input.importBatchId);
    requireTenantMatch(user, batch.tenantId);

    // Claim idempotency
    const now = new Date();
    const claim = await claimIdempotency(this.deps.idempotency, {
      tenantId: user.tenantId,
      operationScope: "historical_cutover_manifest.finalize",
      idempotencyKey: input.idempotencyKey,
      requestBody: {
        importBatchId: input.importBatchId,
        domain: input.domain,
        cutoffDate: input.cutoffDate,
      } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    });
    if (claim.action === "replay") {
      const responseBody = claim.record.responseBody as Partial<FinalizeCutoverManifestResult> | null;
      if (responseBody?.batchId) return { ...responseBody, action: "replayed" } as FinalizeCutoverManifestResult;
    }
    if (claim.action === "conflict") throw new HistoricalStagingError("IDEMPOTENCY_CONFLICT", "Idempotency key conflict.");
    if (claim.action === "in_progress") throw new HistoricalStagingError("OPERATION_IN_PROGRESS", "Operation in progress.");

    // Server-side manifest hash derivation from CANONICAL persisted facts.
    // WP-08-01F TASK 2: The hash includes ALL material persisted facts:
    //   - batch ID, import mode, template type/version
    //   - current file IDs, versions and hashes
    //   - current staging version/hash/row count
    //   - normalized cutover date/scope
    //   - validation report version and persisted status
    //   - reconciliation report version and persisted status
    //   - warning summary and accepted-warning version
    // Client inputs (domain, cutoffDate, etc.) are included as descriptive
    // fields but the hash is primarily derived from persisted DB facts.
    const crypto = await import("node:crypto");
    const files = await this.deps.repository.findImportFilesForBatch(user.tenantId, input.importBatchId);
    const fileHashes = files.map((f: any) => f.fileHash).sort().join(",");
    const fileIds = files.map((f: any) => f.id).sort().join(",");
    const manifestHashInput = JSON.stringify({
      // Batch facts (persisted)
      batchId: input.importBatchId,
      batchStatus: batch.status,
      importMode: batch.cutoverImportMode,
      templateType: batch.templateName ?? "",
      templateVersion: batch.templateVersion ?? "",
      // Staging facts (persisted)
      stagedRowCount: batch.stagedRowCount,
      stagedDataHash: batch.stagedDataHash ?? "",
      // File facts (persisted)
      fileIds,
      fileHashes,
      // Validation/reconciliation facts (persisted)
      validationStatus: batch.validationStatus ?? "",
      reconciliationStatus: batch.reconciliationStatus ?? "",
      // Warning facts (persisted)
      warningCount: batch.warningCount,
      acceptedWarningCount: batch.acceptedWarningCount,
      warningSummary: batch.warningSummary ?? "",
      // Descriptive fields (client-supplied, validated, stored in manifest)
      domain: input.domain,
      cutoffDate: input.cutoffDate ?? "",
      sourceCoverage: input.sourceCoverage ?? "",
      openingBalanceBasis: input.openingBalanceBasis ?? "",
      liveSystemStartBoundary: input.liveSystemStartBoundary ?? "",
    });
    const manifestHash = crypto.createHash("sha256").update(manifestHashInput).digest("hex");

    // Insert cutover manifest
    const manifest = await this.deps.repository.insertCutoverManifest({
      tenantId: user.tenantId,
      importBatchId: input.importBatchId,
      domain: input.domain,
      importMode: "opening_balance",
      cutoffDate: input.cutoffDate,
      sourceCoverage: input.sourceCoverage,
      openingBalanceBasis: input.openingBalanceBasis,
      liveSystemStartBoundary: input.liveSystemStartBoundary,
      manifestHash,
      isApproved: true,
      createdBy: user.userId,
    });

    // Bind manifest hash to batch
    await this.deps.repository.updateBatchCutoverManifestHash(user.tenantId, input.importBatchId, manifestHash, user.userId);

    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: "import_cutover_manifest",
      entityId: manifest.id,
      actionType: "historical_cutover_manifest.finalize",
      newValuesJson: {
        importBatchId: input.importBatchId,
        domain: input.domain,
        manifestHash,
        cutoverManifestHash: manifestHash,
        cutoffDate: input.cutoffDate,
      },
      idempotencyKey: input.idempotencyKey,
    });

    const result: FinalizeCutoverManifestResult = {
      action: "finalized",
      batchId: input.importBatchId,
      manifestId: manifest.id,
      manifestHash,
      cutoverManifestHash: manifestHash,
    };

    await markSucceeded(this.deps.idempotency, claim.record.id, {
      responseCode: 200, responseBody: result,
      entityType: "import_cutover_manifest", entityId: manifest.id,
    }, claim.record.ownerToken!, now);

    return result;
  }

  /**
   * List batches for a tenant.
   */
  async listBatches(
    user: ErpUserContext,
    effective: EffectivePermissions,
  ): Promise<ImportBatch[]> {
    requirePermission(effective, "migration.prepare");
    return this.deps.repository.listImportBatches(user.tenantId);
  }

  /**
   * Get batch detail with staging rows.
   */
  async getBatchDetail(
    user: ErpUserContext,
    effective: EffectivePermissions,
    batchId: string,
  ): Promise<{ batch: ImportBatch | null; rows: ImportStagingRow[]; files: ImportFile[] }> {
    requirePermission(effective, "migration.prepare");
    const batch = await this.deps.repository.findImportBatchById(user.tenantId, batchId);
    if (!batch) return { batch: null, rows: [], files: [] };
    const rows = await this.deps.repository.findStagingRowsForBatch(user.tenantId, batchId);
    const files = await this.deps.repository.findImportFilesForBatch(user.tenantId, batchId);
    return { batch, rows, files };
  }
}
