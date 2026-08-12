/**
 * WP-08-01F — Migration server actions.
 *
 * Uses imported parsers from migration-form-parsers.ts (TASK 5).
 * Uses lifecycle predicates from migration-lifecycle-predicates.ts (TASK 2).
 * Role verification via verifyApproverRole (TASK 4).
 *
 * Contract 10 §9: Historical Migration Screens.
 * Contract 08: Historical Migration.
 * DEC-069/070/071/072.
 *
 * WP-08-01F DEFECT 1: submitMigrationForApprovalAction — explicit submission
 *   command that transitions review_required → pending_dual_approval.
 *
 * WP-08-01F DEFECT 3: Role-fixed approval actions. The browser NO LONGER
 *   submits `approverRole` — it is fixed server-side per action:
 *   - recordOwnerMigrationApprovalAction (role = "owner")
 *   - recordAccountantMigrationApprovalAction (role = "accountant")
 *   - approveCorrectionAsOwnerAction (role = "owner")
 *   - approveCorrectionAsAccountantAction (role = "accountant")
 *   Contract 08 §11.7: "Request bodies cannot claim role, actor, tenant, or
 *   calculated approval eligibility."
 */
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { resolveAndRequirePermission } from "@/server/security/guards";
import { TEST_ROLE_PERMISSION_MATRIX } from "@/server/security/role-fixtures";
import { db } from "@/server/db/client";
import { HistoricalStagingService } from "@/server/services/historical-staging-service";
import { HistoricalValidationService } from "@/server/services/historical-validation-service";
import { HistoricalReconciliationService } from "@/server/services/historical-reconciliation-service";
import { HistoricalCommitService } from "@/server/services/historical-commit-service";
import { HistoricalCorrectionService } from "@/server/services/historical-correction-service";
import { ProductionCorrectionDomainHook } from "@/server/services/production-correction-domain-hook";
import { HistoricalStagingDbRepository } from "@/server/services/historical-staging-db-repository";
import { HistoricalValidationDbRepository } from "@/server/services/historical-validation-db-repository";
import { HistoricalReconciliationDbRepository } from "@/server/services/historical-reconciliation-db-repository";
import { HistoricalCommitDbRepository } from "@/server/services/historical-commit-db-repository";
import { HistoricalCorrectionDbRepository } from "@/server/services/historical-correction-db-repository";
import { AuditDbRepository } from "@/server/services/audit-db-repository";
import { IdempotencyDbRepository } from "@/server/services/idempotency-db-repository";
import { DocumentSequenceDbRepository } from "@/server/services/document-sequence-db-repository";
import { InventoryLedgerDbRepository } from "@/server/services/inventory-ledger-db-repository";
import { InventoryLedgerService } from "@/server/services/inventory-ledger-service";
import { SubledgerDbRepository } from "@/server/services/subledger-db-repository";
import { SubledgerService } from "@/server/services/subledger-service";
import {
  parseCorrectionType,
  parseReviewDecision,
  parseFileType,
  parseCutoverImportMode,
  parseRequiredString,
  parseOptionalString,
  parseOptionalInt,
  parseOptionalJson,
  validateStoragePath,
  verifyApproverRole,
} from "@/server/services/migration-form-parsers";
import type { RoleCode } from "@/server/security/role-codes";

// ---------------------------------------------------------------------------
// Service composition
// ---------------------------------------------------------------------------

function getMigrationServices() {
  if (!db) throw new Error("Database not available.");
  const audit = new AuditDbRepository(db);
  const idempotency = new IdempotencyDbRepository(db);
  const documentSequence = new DocumentSequenceDbRepository(db);
  const stagingRepo = new HistoricalStagingDbRepository(db);
  const validationRepo = new HistoricalValidationDbRepository(db);
  const reconciliationRepo = new HistoricalReconciliationDbRepository(db);
  const commitRepo = new HistoricalCommitDbRepository(db);
  const correctionRepo = new HistoricalCorrectionDbRepository(db);
  const stagingService = new HistoricalStagingService({ repository: stagingRepo, audit, idempotency, documentSequence });
  const validationService = new HistoricalValidationService({ repository: validationRepo, audit, idempotency });
  // DEFECT 1: reconciliation service now needs commitRepository for
  // submitForApproval (backup evidence + blocking-validation lookups).
  // DEFECT 3/4: transactionRunner + txFactories for atomic submit/rework.
  const transactionRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
    (db as any).transaction(async (tx: any) => work(tx));
  const txFactories = {
    createCommitRepository: (tx: unknown) => new HistoricalCommitDbRepository(tx as any),
    createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
    createInventoryLedger: (tx: unknown) => new InventoryLedgerService({
      ledger: new InventoryLedgerDbRepository(tx as any), audit: new AuditDbRepository(tx as any),
      idempotency: new IdempotencyDbRepository(tx as any), documentSequence: new DocumentSequenceDbRepository(tx as any),
    }),
    createSubledger: (tx: unknown) => new SubledgerService({
      subledger: new SubledgerDbRepository(tx as any), audit: new AuditDbRepository(tx as any),
      idempotency: new IdempotencyDbRepository(tx as any), documentSequence: new DocumentSequenceDbRepository(tx as any),
    }),
    createDocumentSequence: (tx: unknown) => new DocumentSequenceDbRepository(tx as any),
  };
  const reconciliationService = new HistoricalReconciliationService({
    repository: reconciliationRepo, audit, idempotency, commitRepository: commitRepo,
    transactionRunner,
    createCommitRepository: txFactories.createCommitRepository,
    createAudit: txFactories.createAudit,
    createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
    createReconciliationRepository: (tx: unknown) => new HistoricalReconciliationDbRepository(tx as any),
  });
  const commitService = new HistoricalCommitService({ repository: commitRepo, audit, idempotency, transactionRunner, txFactories });

  // WP-08-01F Production Correction Hook: wire the real domain hook that
  // dispatches correctionType + originalEntityType to InventoryLedgerService
  // and SubledgerService. The hook receives tx-scoped factories so all
  // domain effects commit/rollback with the correction execution transaction.
  const correctionService = new HistoricalCorrectionService({
    repository: correctionRepo, audit, idempotency, documentSequence,
    transactionRunner: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
      (db as any).transaction(async (tx: any) => work(tx)),
    createRepository: (tx: unknown) => new HistoricalCorrectionDbRepository(tx as any),
    createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
    createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
    createCorrectionDomainHook: (tx: unknown) => {
      const hook = new ProductionCorrectionDomainHook({
        createInventoryLedger: txFactories.createInventoryLedger,
        createSubledger: txFactories.createSubledger,
        tx,
      });
      return hook;
    },
    // testFaultCallback is NEVER set in production wiring
  });
  return { stagingService, validationService, reconciliationService, commitService, correctionService };
}

async function authenticateAndRequirePermission(permissionKey: string) {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");
  const effective = resolveAndRequirePermission(authResult.roles, TEST_ROLE_PERMISSION_MATRIX, permissionKey);
  return { authResult, effective };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export async function createMigrationBatchAction(formData: FormData): Promise<void> {
  const { authResult, effective } = await authenticateAndRequirePermission("migration.prepare");
  const sourceDescription = parseOptionalString(formData, "sourceDescription");
  const templateName = parseOptionalString(formData, "templateName");
  const templateVersion = parseOptionalString(formData, "templateVersion");
  const cutoverImportMode = parseCutoverImportMode(String(formData.get("cutoverImportMode") ?? "opening_balance"));
  const idempotencyKey = parseRequiredString(formData, "idempotencyKey");
  const { stagingService } = getMigrationServices();
  await stagingService.createBatch(authResult as any, effective as any, { sourceDescription, templateName, templateVersion, cutoverImportMode, idempotencyKey });
  revalidatePath("/management/admin/migration");
}

export async function registerFileAction(formData: FormData): Promise<void> {
  const { authResult, effective } = await authenticateAndRequirePermission("migration.prepare");
  const batchId = parseRequiredString(formData, "batchId");
  const originalFileName = parseRequiredString(formData, "originalFileName");
  const storagePath = parseRequiredString(formData, "storagePath");
  const fileHash = parseRequiredString(formData, "fileHash");
  const fileType = parseFileType(String(formData.get("fileType") ?? "source"));
  const fileSizeBytes = parseOptionalInt(formData, "fileSizeBytes");
  const contentType = parseOptionalString(formData, "contentType");
  const idempotencyKey = parseRequiredString(formData, "idempotencyKey");
  validateStoragePath(storagePath);
  const { stagingService } = getMigrationServices();
  await stagingService.registerFile(authResult as any, effective as any, { importBatchId: batchId, originalFileName, storagePath, fileHash, fileType, fileSizeBytes, contentType, idempotencyKey });
  revalidatePath(`/management/admin/migration/${batchId}`);
}

// ===========================================================================
// WP-08-01F MILESTONE B — Template download
// ===========================================================================

/**
 * Download a migration template as CSV. Returns the CSV content with
 * Content-Type and Content-Disposition headers for download.
 *
 * Permission: migration.prepare (Owner/Accountant only).
 * Workers are denied before template content is returned.
 */
export async function downloadTemplateAction(formData: FormData): Promise<{ csv: string; filename: string; contentType: string }> {
  const { authResult, effective } = await authenticateAndRequirePermission("migration.prepare");
  const templateType = parseRequiredString(formData, "templateType");
  const templateVersion = parseRequiredString(formData, "templateVersion");

  const { findTemplate, generateTemplateCsv } = await import("@/server/services/migration-templates");
  const template = findTemplate(templateType, templateVersion);
  if (!template) {
    throw new Error(`Template '${templateType}' version '${templateVersion}' not found.`);
  }

  const csv = generateTemplateCsv(template);
  const filename = `${templateType}_v${templateVersion}.csv`;
  return { csv, filename, contentType: "text/csv; charset=utf-8" };
}

// ===========================================================================
// WP-08-01F MILESTONE B — Real private file upload with server-side parsing
// ===========================================================================

/**
 * Upload a real CSV file, store it privately, parse it server-side,
 * and stage the rows through HistoricalStagingService.
 *
 * Security:
 *   - Validates filename, extension, MIME type, size
 *   - Rejects macros/executable content
 *   - Never executes spreadsheet formulas
 *   - Stores actual file bytes in private storage (not just metadata)
 *   - Derives checksum, byte size, content type server-side
 *   - Tenant/batch-scoped storage keys
 *   - Handles storage-success/DB-failure with safe compensation (deletes orphaned file)
 *
 * Permission: migration.prepare (Owner/Accountant only).
 * Workers are denied before file content is accessed.
 */
export async function uploadAndParseCsvAction(formData: FormData): Promise<void> {
  const { authResult, effective } = await authenticateAndRequirePermission("migration.prepare");
  const batchId = parseRequiredString(formData, "batchId");
  const templateType = parseRequiredString(formData, "templateType");
  const templateVersion = parseRequiredString(formData, "templateVersion");
  const idempotencyKey = parseRequiredString(formData, "idempotencyKey");

  // Get the uploaded file
  const file = formData.get("file") as File | null;
  if (!file) {
    throw new Error("VALIDATION_FAILED: No file uploaded.");
  }

  // Validate filename and extension
  const filename = file.name;
  if (!filename.toLowerCase().endsWith(".csv")) {
    throw new Error("VALIDATION_FAILED: Only CSV files are supported.");
  }

  // Validate MIME type
  const acceptedMimeTypes = ["text/csv", "application/csv", "text/plain", "application/vnd.ms-excel"];
  if (file.type && !acceptedMimeTypes.includes(file.type)) {
    throw new Error(`VALIDATION_FAILED: Unsupported MIME type '${file.type}'. Only CSV files are accepted.`);
  }

  // Validate file size (10 MB max)
  const maxSize = 10 * 1024 * 1024;
  if (file.size > maxSize) {
    throw new Error(`VALIDATION_FAILED: File size ${file.size} bytes exceeds maximum ${maxSize} bytes.`);
  }

  // Read file content as Buffer (for private storage)
  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const fileContent = fileBuffer.toString("utf-8");
  const contentType = file.type || "text/csv";

  // Store file bytes in private storage (actual byte storage, not just metadata)
  const { getPrivateFileStorage } = await import("@/server/services/private-file-storage");
  const storage = getPrivateFileStorage();
  const storedFile = await storage.store(
    authResult.tenantId,
    batchId,
    idempotencyKey,
    filename,
    fileBuffer,
    contentType,
  );

  // Register the file metadata with server-derived checksum/size/MIME
  const { stagingService } = getMigrationServices();
  try {
    await stagingService.registerFile(authResult as any, effective as any, {
      importBatchId: batchId,
      originalFileName: filename,
      storagePath: storedFile.storagePath,
      fileHash: storedFile.fileHash,
      fileType: "source",
      fileSizeBytes: storedFile.fileSizeBytes,
      contentType: storedFile.contentType,
      idempotencyKey,
    });
  } catch (e) {
    // DB registration failed — compensate by deleting the orphaned stored file.
    // If compensation itself fails, create a DURABLE DB-backed orphan-cleanup
    // alert in the operational_alerts table.
    try {
      await storage.deleteIfOrphaned(storedFile.storagePath);
    } catch (compensationError) {
      // Durable record in operational_alerts table (not just console.error)
      const { createOrphanCleanupAlert } = await import("@/server/services/orphan-cleanup-service");
      try {
        if (db) {
          await createOrphanCleanupAlert(
            db,
            authResult.tenantId,
            batchId,
            storedFile.storagePath,
            idempotencyKey,
            (compensationError as Error).message,
          );
        }
      } catch {
        // If even the alert creation fails, fall back to console.error
        console.error(
          `ORPHAN_CLEANUP_ALERT_FAILED: tenant=${authResult.tenantId} batch=${batchId} ` +
          `storagePath=${storedFile.storagePath} uploadKey=${idempotencyKey} ` +
          `reason=${(compensationError as Error).message} ` +
          `originalError=${(e as Error).message} ` +
          `status=pending_cleanup timestamp=${new Date().toISOString()}`
        );
      }
    }
    throw e;
  }

  // Parse the CSV server-side
  const { findTemplate } = await import("@/server/services/migration-templates");
  const { parseCsv } = await import("@/server/services/migration-csv-parser");
  const template = findTemplate(templateType, templateVersion);
  if (!template) {
    // Clean up the stored file since parsing can't proceed
    await storage.deleteIfOrphaned(storedFile.storagePath);
    throw new Error(`Template '${templateType}' version '${templateVersion}' not found.`);
  }

  const parseResult = parseCsv(fileContent, template);
  if (parseResult.errors.length > 0) {
    // File is stored but parsing failed — the file metadata is registered
    // (the file exists in private storage for audit/replacement)
    throw new Error(`CSV_PARSE_FAILED: ${parseResult.errors.join("; ")}`);
  }

  // Find the registered file ID by querying the staging service
  // The registerFile call above inserted the file — we need its ID
  // Use the staging service's getBatchDetail to find the file
  const batchDetail = await stagingService.getBatchDetail(authResult as any, effective as any, batchId);
  const registeredFile = batchDetail.files.find((f: any) => f.fileHash === storedFile.fileHash);
  const importFileId = registeredFile?.id ?? null;

  // Stage each parsed row through HistoricalStagingService with lineage
  for (const row of parseResult.rows) {
    const rowKey = `upload-${idempotencyKey}-row-${row.rowNumber}`;
    await stagingService.insertStagingRow(
      authResult as any, effective as any,
      {
        importBatchId: batchId,
        importFileId, // Link to the registered file
        templateName: templateType,
        sourceSheetName: filename, // Use filename as "sheet" for CSV
        sourceRowNumber: row.rowNumber,
        rawRowJson: row.columns,
        transformedRowJson: row.columns,
        transformationNotes: null,
        idempotencyKey: rowKey,
      },
    );
  }

  revalidatePath(`/management/admin/migration/${batchId}`);
}

// ===========================================================================
// WP-08-01F MILESTONE B — finalizeStaging and finalizeCutoverManifest
// ===========================================================================

/**
 * Finalize staging — derives stagedDataHash server-side and transitions
 * batch to 'staged' state.
 */
export async function finalizeStagingAction(formData: FormData): Promise<void> {
  const { authResult, effective } = await authenticateAndRequirePermission("migration.prepare");
  const batchId = parseRequiredString(formData, "batchId");
  const idempotencyKey = parseRequiredString(formData, "idempotencyKey");
  const { stagingService } = getMigrationServices();
  await stagingService.finalizeStaging(authResult as any, effective as any, {
    importBatchId: batchId, idempotencyKey,
  });
  revalidatePath(`/management/admin/migration/${batchId}`);
}

/**
 * Finalize cutover manifest — creates manifest and binds hash to batch.
 */
export async function finalizeCutoverManifestAction(formData: FormData): Promise<void> {
  const { authResult, effective } = await authenticateAndRequirePermission("migration.prepare");
  const batchId = parseRequiredString(formData, "batchId");
  const domain = parseRequiredString(formData, "domain");
  const cutoffDate = parseOptionalString(formData, "cutoffDate");
  const sourceCoverage = parseOptionalString(formData, "sourceCoverage");
  const openingBalanceBasis = parseOptionalString(formData, "openingBalanceBasis");
  const liveSystemStartBoundary = parseOptionalString(formData, "liveSystemStartBoundary");
  const idempotencyKey = parseRequiredString(formData, "idempotencyKey");
  const { stagingService } = getMigrationServices();
  await stagingService.finalizeCutoverManifest(authResult as any, effective as any, {
    importBatchId: batchId, domain, cutoffDate, sourceCoverage,
    openingBalanceBasis, liveSystemStartBoundary, idempotencyKey,
  });
  revalidatePath(`/management/admin/migration/${batchId}`);
}

export async function insertStagingRowAction(formData: FormData): Promise<void> {
  const { authResult, effective } = await authenticateAndRequirePermission("migration.prepare");
  const batchId = parseRequiredString(formData, "batchId");
  const importFileId = parseRequiredString(formData, "importFileId");
  const templateName = parseOptionalString(formData, "templateName");
  const sourceSheetName = parseOptionalString(formData, "sourceSheetName");
  const sourceRowNumber = parseOptionalInt(formData, "sourceRowNumber");
  const rawRowJson = parseOptionalJson(formData, "rawRowJson");
  const transformedRowJson = parseOptionalJson(formData, "transformedRowJson");
  const idempotencyKey = parseRequiredString(formData, "idempotencyKey");
  const { stagingService } = getMigrationServices();
  await stagingService.insertStagingRow(authResult as any, effective as any, { importBatchId: batchId, importFileId, templateName, sourceSheetName, sourceRowNumber, rawRowJson, transformedRowJson, transformationNotes: null, idempotencyKey });
  revalidatePath(`/management/admin/migration/${batchId}`);
}

export async function runValidationAction(formData: FormData): Promise<void> {
  const { authResult, effective } = await authenticateAndRequirePermission("migration.review");
  const batchId = parseRequiredString(formData, "batchId");
  const idempotencyKey = parseRequiredString(formData, "idempotencyKey");
  const { validationService } = getMigrationServices();
  await validationService.runValidation(authResult as any, effective as any, { importBatchId: batchId, idempotencyKey });
  revalidatePath(`/management/admin/migration/${batchId}`);
}

export async function runReconciliationAction(formData: FormData): Promise<void> {
  const { authResult, effective } = await authenticateAndRequirePermission("migration.review");
  const batchId = parseRequiredString(formData, "batchId");
  const idempotencyKey = parseRequiredString(formData, "idempotencyKey");
  const expectedTotalsRaw = parseOptionalJson(formData, "expectedTotals") ?? {};
  const expectedTotals: Record<string, string> = {};
  for (const [k, v] of Object.entries(expectedTotalsRaw)) { expectedTotals[k] = String(v); }
  const { reconciliationService } = getMigrationServices();
  await reconciliationService.runReconciliation(authResult as any, effective as any, { importBatchId: batchId, expectedTotals, idempotencyKey });
  revalidatePath(`/management/admin/migration/${batchId}`);
}

export async function recordReviewDecisionAction(formData: FormData): Promise<void> {
  const { authResult, effective } = await authenticateAndRequirePermission("migration.review");
  const reviewItemId = parseRequiredString(formData, "reviewItemId");
  const batchId = parseRequiredString(formData, "batchId");
  const decision = parseReviewDecision(String(formData.get("decision") ?? ""));
  const decisionNotes = String(formData.get("decisionNotes") ?? "");
  const idempotencyKey = parseRequiredString(formData, "idempotencyKey");
  const { reconciliationService } = getMigrationServices();
  await reconciliationService.recordReviewDecision(authResult as any, effective as any, { reviewItemId, decision, decisionNotes, idempotencyKey });
  revalidatePath(`/management/admin/migration/${batchId}`);
}

// ===========================================================================
// WP-08-01F DEFECT 1 — submitMigrationBatchForApproval
// ===========================================================================

/**
 * Explicit submission command that transitions a reviewed batch from
 * review_required → pending_dual_approval. Without this, the first approval
 * can never be reached because recordApproval requires pending_dual_approval
 * or approved_for_commit.
 *
 * Permission: migration.review. The service verifies ALL submission
 * prerequisites (validation/reconciliation completion, no blocking findings,
 * all review items resolved, hashes present, warnings accepted, backup
 * evidence exists) before transitioning.
 */
export async function submitMigrationForApprovalAction(formData: FormData): Promise<void> {
  const { authResult, effective } = await authenticateAndRequirePermission("migration.review");
  const batchId = parseRequiredString(formData, "batchId");
  const warningSummary = parseOptionalString(formData, "warningSummary");
  const idempotencyKey = parseRequiredString(formData, "idempotencyKey");
  const { reconciliationService } = getMigrationServices();
  await reconciliationService.submitForApproval(authResult as any, effective as any, {
    importBatchId: batchId, warningSummary, idempotencyKey,
  });
  revalidatePath(`/management/admin/migration/${batchId}`);
}

// ===========================================================================
// WP-08-01F DEFECT 2 — reopenBatchForRework
//
// Contract 08 §9 permitted branches:
//   review_required → normalized | staged | validation_in_progress
//   pending_dual_approval → review_required (material change or rejected approval)
//   approved_for_commit → review_required (stale version/new blocker)
//
// Explicit idempotent rework command. Invalidates dependent evidence
// (validation/reconciliation statuses, approvals, pending review items)
// and transitions to the requested target state.
// ===========================================================================

/**
 * Reopen a batch for rework. The target state must be one of the contracted
 * permitted branches for the current batch status. Requires a reason.
 *
 * Permission: migration.review. The service verifies the source/target
 * combination is permitted by Contract 08 §9 and invalidates dependent
 * evidence atomically.
 */
export async function reopenBatchForReworkAction(formData: FormData): Promise<void> {
  const { authResult, effective } = await authenticateAndRequirePermission("migration.review");
  const batchId = parseRequiredString(formData, "batchId");
  const reason = parseRequiredString(formData, "reason");
  const targetState = parseRequiredString(formData, "targetState") as
    | "normalized" | "staged" | "validation_in_progress" | "review_required";
  const idempotencyKey = parseRequiredString(formData, "idempotencyKey");
  const { reconciliationService } = getMigrationServices();
  await reconciliationService.reopenBatchForRework(authResult as any, effective as any, {
    importBatchId: batchId, reason, targetState, idempotencyKey,
  });
  revalidatePath(`/management/admin/migration/${batchId}`);
}

// ===========================================================================
// WP-08-01F DEFECT 3 — Role-fixed approval actions
//
// Contract 08 §11.7: "Request bodies cannot claim role, actor, tenant, or
// calculated approval eligibility."
//
// The browser NO LONGER submits `approverRole`. Each action fixes its
// approver role server-side and verifies the authenticated user actually
// has that role via verifyApproverRole.
// ===========================================================================

/**
 * Record the Owner approval slot. The role is FIXED to "owner" server-side —
 * the browser cannot submit `approverRole`. The authenticated user must
 * actually have the "owner" role.
 *
 * DEC-069: A multi-role identity may submit this AND the Accountant action,
 * but the service prevents the same userId from satisfying both slots.
 */
export async function recordOwnerMigrationApprovalAction(formData: FormData): Promise<void> {
  const { authResult, effective } = await authenticateAndRequirePermission("migration.approve");
  const batchId = parseRequiredString(formData, "batchId");
  const reason = parseOptionalString(formData, "reason");
  const idempotencyKey = parseRequiredString(formData, "idempotencyKey");
  // Role is FIXED server-side — browser cannot claim it.
  const approverRole = "owner" as const;
  // Verify the authenticated user actually has the owner role.
  verifyApproverRole(authResult.roles as ReadonlyArray<RoleCode>, approverRole);
  const { commitService } = getMigrationServices();
  await commitService.recordApproval(authResult as any, effective as any, { importBatchId: batchId, approverRole, reason, idempotencyKey });
  revalidatePath(`/management/admin/migration/${batchId}`);
}

/**
 * Record the Accountant approval slot. The role is FIXED to "accountant"
 * server-side — the browser cannot submit `approverRole`. The authenticated
 * user must actually have the "accountant" role.
 *
 * DEC-069: A multi-role identity may submit this AND the Owner action, but
 * the service prevents the same userId from satisfying both slots.
 */
export async function recordAccountantMigrationApprovalAction(formData: FormData): Promise<void> {
  const { authResult, effective } = await authenticateAndRequirePermission("migration.approve");
  const batchId = parseRequiredString(formData, "batchId");
  const reason = parseOptionalString(formData, "reason");
  const idempotencyKey = parseRequiredString(formData, "idempotencyKey");
  // Role is FIXED server-side — browser cannot claim it.
  const approverRole = "accountant" as const;
  // Verify the authenticated user actually has the accountant role.
  verifyApproverRole(authResult.roles as ReadonlyArray<RoleCode>, approverRole);
  const { commitService } = getMigrationServices();
  await commitService.recordApproval(authResult as any, effective as any, { importBatchId: batchId, approverRole, reason, idempotencyKey });
  revalidatePath(`/management/admin/migration/${batchId}`);
}

export async function recordBackupEvidenceAction(formData: FormData): Promise<void> {
  const { authResult, effective } = await authenticateAndRequirePermission("migration.commit");
  const batchId = parseRequiredString(formData, "batchId");
  const backupType = parseRequiredString(formData, "backupType");
  const backupLocation = parseRequiredString(formData, "backupLocation");
  const backupHash = parseRequiredString(formData, "backupHash");
  const backupSizeBytes = parseOptionalInt(formData, "backupSizeBytes");
  const verificationNotes = parseOptionalString(formData, "verificationNotes");
  const idempotencyKey = parseRequiredString(formData, "idempotencyKey");
  const { commitService } = getMigrationServices();
  await commitService.recordBackupEvidence(authResult as any, effective as any, { importBatchId: batchId, backupType, backupLocation, backupHash, backupSizeBytes, backupCreatedAt: new Date(), verificationNotes, idempotencyKey });
  revalidatePath(`/management/admin/migration/${batchId}`);
}

export async function commitBatchAction(formData: FormData): Promise<void> {
  const { authResult, effective } = await authenticateAndRequirePermission("migration.commit");
  const batchId = parseRequiredString(formData, "batchId");
  const idempotencyKey = parseRequiredString(formData, "idempotencyKey");
  const { commitService } = getMigrationServices();
  await commitService.commitBatch(authResult as any, effective as any, { importBatchId: batchId, idempotencyKey });
  revalidatePath(`/management/admin/migration/${batchId}`);
  revalidatePath("/management/admin/migration");
}

export async function createCorrectionRequestAction(formData: FormData): Promise<void> {
  const { authResult, effective } = await authenticateAndRequirePermission("migration.prepare");
  const batchId = parseRequiredString(formData, "batchId");
  const originalEntityType = parseRequiredString(formData, "originalEntityType");
  const originalEntityId = parseRequiredString(formData, "originalEntityId");
  const correctionType = parseCorrectionType(String(formData.get("correctionType") ?? "adjustment"));
  const reason = parseRequiredString(formData, "reason");
  const idempotencyKey = parseRequiredString(formData, "idempotencyKey");
  const proposedCorrectionJson = parseOptionalJson(formData, "proposedCorrectionJson");
  const impactAnalysisJson = parseOptionalJson(formData, "impactAnalysisJson");
  const { correctionService } = getMigrationServices();
  await correctionService.createCorrectionRequest(authResult as any, effective as any, { importBatchId: batchId, originalEntityType, originalEntityId, correctionType, reason, proposedCorrectionJson, impactAnalysisJson, idempotencyKey });
  revalidatePath(`/management/admin/migration/${batchId}`);
}

// ===========================================================================
// WP-08-01F DEFECT 3 — Role-fixed correction approval actions
//
// The browser NO LONGER submits `approverRole`. Each action fixes its
// approver role server-side and verifies the authenticated user actually
// has that role.
// ===========================================================================

/**
 * Approve a correction request as Owner. Role is FIXED server-side.
 */
export async function approveCorrectionAsOwnerAction(formData: FormData): Promise<void> {
  const { authResult, effective } = await authenticateAndRequirePermission("migration.approve");
  const correctionRequestId = parseRequiredString(formData, "correctionRequestId");
  const batchId = parseOptionalString(formData, "batchId");
  const idempotencyKey = parseRequiredString(formData, "idempotencyKey");
  // Role is FIXED server-side — browser cannot claim it.
  const approverRole = "owner" as const;
  verifyApproverRole(authResult.roles as ReadonlyArray<RoleCode>, approverRole);
  const { correctionService } = getMigrationServices();
  await correctionService.approveCorrection(authResult as any, effective as any, { correctionRequestId, approverRole, idempotencyKey });
  if (batchId) { revalidatePath(`/management/admin/migration/${batchId}`); }
}

/**
 * Approve a correction request as Accountant. Role is FIXED server-side.
 */
export async function approveCorrectionAsAccountantAction(formData: FormData): Promise<void> {
  const { authResult, effective } = await authenticateAndRequirePermission("migration.approve");
  const correctionRequestId = parseRequiredString(formData, "correctionRequestId");
  const batchId = parseOptionalString(formData, "batchId");
  const idempotencyKey = parseRequiredString(formData, "idempotencyKey");
  // Role is FIXED server-side — browser cannot claim it.
  const approverRole = "accountant" as const;
  verifyApproverRole(authResult.roles as ReadonlyArray<RoleCode>, approverRole);
  const { correctionService } = getMigrationServices();
  await correctionService.approveCorrection(authResult as any, effective as any, { correctionRequestId, approverRole, idempotencyKey });
  if (batchId) { revalidatePath(`/management/admin/migration/${batchId}`); }
}

// ===========================================================================
// WP-08-01F Production Correction Hook — executeCorrectionAction
//
// Executes an approved correction request through the production
// ProductionCorrectionDomainHook, which dispatches on correctionType +
// originalEntityType to call InventoryLedgerService.postReversal /
// postAdjustment or SubledgerService.postReversalEntry.
//
// Permission: migration.commit (Owner/Accountant)
// The entire execution is atomic (transactionRunner): correction effect +
// correction status + audit + idempotency markSucceeded commit or roll
// back together.
// ===========================================================================

/**
 * Execute an approved correction request. The correction must have been
 * approved by both Owner and Accountant (renewed dual approval per DEC-070).
 *
 * Produces append-only compensating effects through domain services —
 * original committed records are never modified.
 */
export async function executeCorrectionAction(formData: FormData): Promise<void> {
  const { authResult, effective } = await authenticateAndRequirePermission("migration.commit");
  const correctionRequestId = parseRequiredString(formData, "correctionRequestId");
  const batchId = parseOptionalString(formData, "batchId");
  const idempotencyKey = parseRequiredString(formData, "idempotencyKey");
  const { correctionService } = getMigrationServices();
  await correctionService.executeCorrection(authResult as any, effective as any, {
    correctionRequestId, idempotencyKey,
  });
  if (batchId) { revalidatePath(`/management/admin/migration/${batchId}`); }
}
