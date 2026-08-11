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
  parseApproverRole,
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
  const reconciliationService = new HistoricalReconciliationService({ repository: reconciliationRepo, audit, idempotency });
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
  const commitService = new HistoricalCommitService({ repository: commitRepo, audit, idempotency, transactionRunner, txFactories });
  const correctionService = new HistoricalCorrectionService({ repository: correctionRepo, audit, idempotency, documentSequence });
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

export async function recordApprovalAction(formData: FormData): Promise<void> {
  const { authResult, effective } = await authenticateAndRequirePermission("migration.approve");
  const batchId = parseRequiredString(formData, "batchId");
  const approverRole = parseApproverRole(String(formData.get("approverRole") ?? ""));
  const reason = parseOptionalString(formData, "reason");
  const idempotencyKey = parseRequiredString(formData, "idempotencyKey");
  verifyApproverRole(authResult.roles, approverRole);
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

export async function approveCorrectionAction(formData: FormData): Promise<void> {
  const { authResult, effective } = await authenticateAndRequirePermission("migration.approve");
  const correctionRequestId = parseRequiredString(formData, "correctionRequestId");
  const approverRole = parseApproverRole(String(formData.get("approverRole") ?? ""));
  const batchId = parseOptionalString(formData, "batchId");
  const idempotencyKey = parseRequiredString(formData, "idempotencyKey");
  verifyApproverRole(authResult.roles, approverRole);
  const { correctionService } = getMigrationServices();
  await correctionService.approveCorrection(authResult as any, effective as any, { correctionRequestId, approverRole, idempotencyKey });
  if (batchId) { revalidatePath(`/management/admin/migration/${batchId}`); }
}

// executeCorrectionAction is NOT exposed — blocked_on_missing_production_correction_hook
