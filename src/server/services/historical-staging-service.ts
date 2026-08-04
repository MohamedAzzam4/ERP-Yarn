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
