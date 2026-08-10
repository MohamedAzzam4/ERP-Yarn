/**
 * WP-08-01F — Migration server actions.
 *
 * Wires every supported mutation to its existing WP-07 production service.
 * All actions:
 * 1. Authenticate server-side via getErpAuthContextWithRoles
 * 2. Resolve active ERP tenant/user
 * 3. Enforce exact permission before mutation
 * 4. Validate tenant ownership
 * 5. Use DB-backed repositories
 * 6. Use DB-backed idempotency + owner-token fencing
 * 7. Use tx-scoped audit
 * 8. Revalidate authorized routes
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

// ---------------------------------------------------------------------------
// Service composition — production wiring
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

  const stagingService = new HistoricalStagingService({
    repository: stagingRepo,
    audit,
    idempotency,
    documentSequence,
  });

  const validationService = new HistoricalValidationService({
    repository: validationRepo,
    audit,
    idempotency,
  });

  const reconciliationService = new HistoricalReconciliationService({
    repository: reconciliationRepo,
    audit,
    idempotency,
  });

  // Production transaction runner for commit
  const transactionRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
    return (db as any).transaction(async (tx: any) => work(tx));
  };

  const txFactories = {
    createCommitRepository: (tx: unknown) => new HistoricalCommitDbRepository(tx as any),
    createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
    createInventoryLedger: (tx: unknown) => new InventoryLedgerService({
      ledger: new InventoryLedgerDbRepository(tx as any),
      audit: new AuditDbRepository(tx as any),
      idempotency: new IdempotencyDbRepository(tx as any),
      documentSequence: new DocumentSequenceDbRepository(tx as any),
    }),
    createSubledger: (tx: unknown) => new SubledgerService({
      subledger: new SubledgerDbRepository(tx as any),
      audit: new AuditDbRepository(tx as any),
      idempotency: new IdempotencyDbRepository(tx as any),
      documentSequence: new DocumentSequenceDbRepository(tx as any),
    }),
    createDocumentSequence: (tx: unknown) => new DocumentSequenceDbRepository(tx as any),
  };

  const commitService = new HistoricalCommitService({
    repository: commitRepo,
    audit,
    idempotency,
    transactionRunner,
    txFactories,
  });

  const correctionService = new HistoricalCorrectionService({
    repository: correctionRepo,
    audit,
    idempotency,
    documentSequence,
    // correctionDomainHook is optional — for production it should be wired
    // to the actual domain services. For now, it's not configured (correction
    // execution will throw if called without the hook).
  });

  return {
    stagingService,
    validationService,
    reconciliationService,
    commitService,
    correctionService,
  };
}

// ---------------------------------------------------------------------------
// Helper: authenticate + require permission
// ---------------------------------------------------------------------------

async function authenticateAndRequirePermission(permissionKey: string) {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const effective = resolveAndRequirePermission(
    authResult.roles,
    TEST_ROLE_PERMISSION_MATRIX,
    permissionKey,
  );

  return { authResult, effective };
}

// ---------------------------------------------------------------------------
// 1. Create migration batch
// ---------------------------------------------------------------------------

export async function createMigrationBatchAction(formData: FormData): Promise<void> {
  const { authResult, effective } = await authenticateAndRequirePermission("migration.prepare");

  const sourceDescription = String(formData.get("sourceDescription") ?? "").trim();
  const templateName = String(formData.get("templateName") ?? "").trim();
  const templateVersion = String(formData.get("templateVersion") ?? "").trim();
  const cutoverImportMode = String(formData.get("cutoverImportMode") ?? "opening_balance").trim();
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();

  if (!idempotencyKey) {
    throw new Error("VALIDATION_FAILED: idempotencyKey is required.");
  }

  const { stagingService } = getMigrationServices();

  await stagingService.createBatch(authResult as any, effective as any, {
    sourceDescription: sourceDescription || null,
    templateName: templateName || null,
    templateVersion: templateVersion || null,
    cutoverImportMode,
    idempotencyKey,
  });

  revalidatePath("/management/admin/migration");
}

// ---------------------------------------------------------------------------
// 2. Register private file metadata
// ---------------------------------------------------------------------------

export async function registerFileAction(formData: FormData): Promise<void> {
  const { authResult, effective } = await authenticateAndRequirePermission("migration.prepare");

  const batchId = String(formData.get("batchId") ?? "").trim();
  const originalFileName = String(formData.get("originalFileName") ?? "").trim();
  const storagePath = String(formData.get("storagePath") ?? "").trim();
  const fileHash = String(formData.get("fileHash") ?? "").trim();
  const fileType = String(formData.get("fileType") ?? "source").trim();
  const fileSizeBytes = formData.get("fileSizeBytes")
    ? parseInt(String(formData.get("fileSizeBytes")), 10)
    : null;
  const contentType = formData.get("contentType")
    ? String(formData.get("contentType"))
    : null;
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();

  if (!batchId || !originalFileName || !storagePath || !fileHash || !idempotencyKey) {
    throw new Error("VALIDATION_FAILED: batchId, originalFileName, storagePath, fileHash, and idempotencyKey are required.");
  }

  // Reject public URLs in storagePath
  if (storagePath.startsWith("http://") || storagePath.startsWith("https://")) {
    throw new Error("VALIDATION_FAILED: public URLs are not allowed for storagePath.");
  }

  const { stagingService } = getMigrationServices();

  await stagingService.registerFile(authResult as any, effective as any, {
    importBatchId: batchId,
    originalFileName,
    storagePath,
    fileHash,
    fileType: fileType as any,
    fileSizeBytes,
    contentType,
    idempotencyKey,
  });

  revalidatePath(`/management/admin/migration/${batchId}`);
}

// ---------------------------------------------------------------------------
// 3. Insert staging row
// ---------------------------------------------------------------------------

export async function insertStagingRowAction(formData: FormData): Promise<void> {
  const { authResult, effective } = await authenticateAndRequirePermission("migration.prepare");

  const batchId = String(formData.get("batchId") ?? "").trim();
  const importFileId = String(formData.get("importFileId") ?? "").trim();
  const templateName = formData.get("templateName")
    ? String(formData.get("templateName"))
    : null;
  const sourceSheetName = formData.get("sourceSheetName")
    ? String(formData.get("sourceSheetName"))
    : null;
  const sourceRowNumber = formData.get("sourceRowNumber")
    ? parseInt(String(formData.get("sourceRowNumber")), 10)
    : null;
  const rawRowJson = formData.get("rawRowJson")
    ? JSON.parse(String(formData.get("rawRowJson")))
    : null;
  const transformedRowJson = formData.get("transformedRowJson")
    ? JSON.parse(String(formData.get("transformedRowJson")))
    : null;
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();

  if (!batchId || !importFileId || !idempotencyKey) {
    throw new Error("VALIDATION_FAILED: batchId, importFileId, and idempotencyKey are required.");
  }

  const { stagingService } = getMigrationServices();

  await stagingService.insertStagingRow(authResult as any, effective as any, {
    importBatchId: batchId,
    importFileId,
    templateName: templateName || null,
    sourceSheetName,
    sourceRowNumber,
    rawRowJson,
    transformedRowJson,
    transformationNotes: null,
    idempotencyKey,
  });

  revalidatePath(`/management/admin/migration/${batchId}`);
}

// ---------------------------------------------------------------------------
// 4. Run validation
// ---------------------------------------------------------------------------

export async function runValidationAction(formData: FormData): Promise<void> {
  const { authResult, effective } = await authenticateAndRequirePermission("migration.review");

  const batchId = String(formData.get("batchId") ?? "").trim();
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();

  if (!batchId || !idempotencyKey) {
    throw new Error("VALIDATION_FAILED: batchId and idempotencyKey are required.");
  }

  const { validationService } = getMigrationServices();

  await validationService.runValidation(authResult as any, effective as any, {
    importBatchId: batchId,
    idempotencyKey,
  });

  revalidatePath(`/management/admin/migration/${batchId}`);
}

// ---------------------------------------------------------------------------
// 5. Run reconciliation
// ---------------------------------------------------------------------------

export async function runReconciliationAction(formData: FormData): Promise<void> {
  const { authResult, effective } = await authenticateAndRequirePermission("migration.review");

  const batchId = String(formData.get("batchId") ?? "").trim();
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();

  if (!batchId || !idempotencyKey) {
    throw new Error("VALIDATION_FAILED: batchId and idempotencyKey are required.");
  }

  const { reconciliationService } = getMigrationServices();

  // Expected totals are typically provided by the owner/accountant.
  // For the UI, we pass an empty object — the service will use staged data.
  const expectedTotalsRaw = formData.get("expectedTotals")
    ? JSON.parse(String(formData.get("expectedTotals")))
    : {};

  await reconciliationService.runReconciliation(authResult as any, effective as any, {
    importBatchId: batchId,
    expectedTotals: expectedTotalsRaw,
    idempotencyKey,
  });

  revalidatePath(`/management/admin/migration/${batchId}`);
}

// ---------------------------------------------------------------------------
// 6. Record review decision (accept/reject warning)
// ---------------------------------------------------------------------------

export async function recordReviewDecisionAction(formData: FormData): Promise<void> {
  const { authResult, effective } = await authenticateAndRequirePermission("migration.review");

  const reviewItemId = String(formData.get("reviewItemId") ?? "").trim();
  const batchId = String(formData.get("batchId") ?? "").trim();
  const decision = String(formData.get("decision") ?? "").trim();
  const decisionNotes = formData.get("decisionNotes")
    ? String(formData.get("decisionNotes"))
    : "";
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();

  if (!reviewItemId || !batchId || !decision || !idempotencyKey) {
    throw new Error("VALIDATION_FAILED: reviewItemId, batchId, decision, and idempotencyKey are required.");
  }

  const { reconciliationService } = getMigrationServices();

  await reconciliationService.recordReviewDecision(authResult as any, effective as any, {
    reviewItemId,
    decision: decision as any,
    decisionNotes,
    idempotencyKey,
  });

  revalidatePath(`/management/admin/migration/${batchId}`);
}

// ---------------------------------------------------------------------------
// 7. Record approval (Owner or Accountant)
// ---------------------------------------------------------------------------

export async function recordApprovalAction(formData: FormData): Promise<void> {
  const { authResult, effective } = await authenticateAndRequirePermission("migration.approve");

  const batchId = String(formData.get("batchId") ?? "").trim();
  const approverRole = String(formData.get("approverRole") ?? "").trim();
  const reason = formData.get("reason") ? String(formData.get("reason")) : null;
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();

  if (!batchId || !approverRole || !idempotencyKey) {
    throw new Error("VALIDATION_FAILED: batchId, approverRole, and idempotencyKey are required.");
  }

  const { commitService } = getMigrationServices();

  await commitService.recordApproval(authResult as any, effective as any, {
    importBatchId: batchId,
    approverRole: approverRole as any,
    reason,
    idempotencyKey,
  });

  revalidatePath(`/management/admin/migration/${batchId}`);
}

// ---------------------------------------------------------------------------
// 8. Record backup evidence
// ---------------------------------------------------------------------------

export async function recordBackupEvidenceAction(formData: FormData): Promise<void> {
  const { authResult, effective } = await authenticateAndRequirePermission("migration.commit");

  const batchId = String(formData.get("batchId") ?? "").trim();
  const backupType = String(formData.get("backupType") ?? "").trim();
  const backupLocation = String(formData.get("backupLocation") ?? "").trim();
  const backupHash = String(formData.get("backupHash") ?? "").trim();
  const backupSizeBytes = formData.get("backupSizeBytes")
    ? parseInt(String(formData.get("backupSizeBytes")), 10)
    : null;
  const verificationNotes = formData.get("verificationNotes")
    ? String(formData.get("verificationNotes"))
    : null;
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();

  if (!batchId || !backupType || !backupLocation || !backupHash || !idempotencyKey) {
    throw new Error("VALIDATION_FAILED: batchId, backupType, backupLocation, backupHash, and idempotencyKey are required.");
  }

  const { commitService } = getMigrationServices();

  await commitService.recordBackupEvidence(authResult as any, effective as any, {
    importBatchId: batchId,
    backupType,
    backupLocation,
    backupHash,
    backupSizeBytes,
    backupCreatedAt: new Date(),
    verificationNotes,
    idempotencyKey,
  });

  revalidatePath(`/management/admin/migration/${batchId}`);
}

// ---------------------------------------------------------------------------
// 9. Atomic commit
// ---------------------------------------------------------------------------

export async function commitBatchAction(formData: FormData): Promise<void> {
  const { authResult, effective } = await authenticateAndRequirePermission("migration.commit");

  const batchId = String(formData.get("batchId") ?? "").trim();
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();

  if (!batchId || !idempotencyKey) {
    throw new Error("VALIDATION_FAILED: batchId and idempotencyKey are required.");
  }

  const { commitService } = getMigrationServices();

  await commitService.commitBatch(authResult as any, effective as any, {
    importBatchId: batchId,
    idempotencyKey,
  });

  revalidatePath(`/management/admin/migration/${batchId}`);
  revalidatePath("/management/admin/migration");
}

// ---------------------------------------------------------------------------
// 10. Create correction request
// ---------------------------------------------------------------------------

export async function createCorrectionRequestAction(formData: FormData): Promise<void> {
  const { authResult, effective } = await authenticateAndRequirePermission("migration.prepare");

  const batchId = String(formData.get("batchId") ?? "").trim();
  const originalEntityType = String(formData.get("originalEntityType") ?? "").trim();
  const originalEntityId = String(formData.get("originalEntityId") ?? "").trim();
  const correctionType = String(formData.get("correctionType") ?? "adjustment").trim() as "reversal" | "adjustment" | "new_corrected";
  const reason = String(formData.get("reason") ?? "").trim();
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();

  if (!batchId || !originalEntityType || !originalEntityId || !reason || !idempotencyKey) {
    throw new Error("VALIDATION_FAILED: batchId, originalEntityType, originalEntityId, reason, and idempotencyKey are required.");
  }

  const { correctionService } = getMigrationServices();

  await correctionService.createCorrectionRequest(authResult as any, effective as any, {
    importBatchId: batchId,
    originalEntityType,
    originalEntityId,
    correctionType,
    reason,
    proposedCorrectionJson: null,
    impactAnalysisJson: null,
    idempotencyKey,
  });

  revalidatePath(`/management/admin/migration/${batchId}`);
}

// ---------------------------------------------------------------------------
// 11. Approve correction
// ---------------------------------------------------------------------------

export async function approveCorrectionAction(formData: FormData): Promise<void> {
  const { authResult, effective } = await authenticateAndRequirePermission("migration.approve");

  const correctionRequestId = String(formData.get("correctionRequestId") ?? "").trim();
  const approverRole = String(formData.get("approverRole") ?? "").trim();
  const batchId = String(formData.get("batchId") ?? "").trim();
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();

  if (!correctionRequestId || !approverRole || !idempotencyKey) {
    throw new Error("VALIDATION_FAILED: correctionRequestId, approverRole, and idempotencyKey are required.");
  }

  const { correctionService } = getMigrationServices();

  await correctionService.approveCorrection(authResult as any, effective as any, {
    correctionRequestId,
    approverRole: approverRole as any,
    idempotencyKey,
  });

  if (batchId) {
    revalidatePath(`/management/admin/migration/${batchId}`);
  }
}

// ---------------------------------------------------------------------------
// 12. Execute correction
// ---------------------------------------------------------------------------

export async function executeCorrectionAction(formData: FormData): Promise<void> {
  const { authResult, effective } = await authenticateAndRequirePermission("migration.commit");

  const correctionRequestId = String(formData.get("correctionRequestId") ?? "").trim();
  const batchId = String(formData.get("batchId") ?? "").trim();
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();

  if (!correctionRequestId || !idempotencyKey) {
    throw new Error("VALIDATION_FAILED: correctionRequestId and idempotencyKey are required.");
  }

  const { correctionService } = getMigrationServices();

  await correctionService.executeCorrection(authResult as any, effective as any, {
    correctionRequestId,
    idempotencyKey,
  });

  if (batchId) {
    revalidatePath(`/management/admin/migration/${batchId}`);
  }
}
