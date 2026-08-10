/**
 * WP-08-01F — Migration server actions.
 *
 * Wires every supported mutation to its existing WP-07 production service.
 *
 * TASK 3: Role-bound dual approval — server verifies the authenticated user
 * is actually assigned to the requested Owner or Accountant role.
 * TASK 6: FormData validation — explicit parsers/allowlists, no `as any`.
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
import type { RoleCode } from "@/server/security/role-codes";
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
// Typed allowlists (TASK 6 — no `as any` casts)
// ---------------------------------------------------------------------------

const APPROVER_ROLES = ["owner", "accountant"] as const;
type ApproverRole = (typeof APPROVER_ROLES)[number];

function parseApproverRole(value: string): ApproverRole {
  if (!APPROVER_ROLES.includes(value as ApproverRole)) {
    throw new Error(`VALIDATION_FAILED: approverRole must be one of: ${APPROVER_ROLES.join(", ")}. Got: '${value}'.`);
  }
  return value as ApproverRole;
}

const CORRECTION_TYPES = ["reversal", "adjustment", "new_corrected"] as const;
type CorrectionType = (typeof CORRECTION_TYPES)[number];

function parseCorrectionType(value: string): CorrectionType {
  if (!CORRECTION_TYPES.includes(value as CorrectionType)) {
    throw new Error(`VALIDATION_FAILED: correctionType must be one of: ${CORRECTION_TYPES.join(", ")}. Got: '${value}'.`);
  }
  return value as CorrectionType;
}

const REVIEW_DECISIONS = ["accepted", "rejected", "resolved"] as const;
type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

function parseReviewDecision(value: string): ReviewDecision {
  if (!REVIEW_DECISIONS.includes(value as ReviewDecision)) {
    throw new Error(`VALIDATION_FAILED: decision must be one of: ${REVIEW_DECISIONS.join(", ")}. Got: '${value}'.`);
  }
  return value as ReviewDecision;
}

const FILE_TYPES = ["source", "normalized", "mapping", "report"] as const;
type FileType = (typeof FILE_TYPES)[number];

function parseFileType(value: string): FileType {
  if (!FILE_TYPES.includes(value as FileType)) {
    throw new Error(`VALIDATION_FAILED: fileType must be one of: ${FILE_TYPES.join(", ")}. Got: '${value}'.`);
  }
  return value as FileType;
}

const CUTOVER_IMPORT_MODES = ["opening_balance", "transaction_history", "hybrid"] as const;
type CutoverImportMode = (typeof CUTOVER_IMPORT_MODES)[number];

function parseCutoverImportMode(value: string): CutoverImportMode {
  if (!CUTOVER_IMPORT_MODES.includes(value as CutoverImportMode)) {
    throw new Error(`VALIDATION_FAILED: cutoverImportMode must be one of: ${CUTOVER_IMPORT_MODES.join(", ")}. Got: '${value}'.`);
  }
  return value as CutoverImportMode;
}

function parseRequiredString(formData: FormData, field: string): string {
  const value = String(formData.get(field) ?? "").trim();
  if (!value) {
    throw new Error(`VALIDATION_FAILED: ${field} is required.`);
  }
  return value;
}

function parseOptionalString(formData: FormData, field: string): string | null {
  const value = formData.get(field);
  if (!value) return null;
  return String(value).trim() || null;
}

function parseOptionalInt(formData: FormData, field: string): number | null {
  const value = formData.get(field);
  if (!value) return null;
  const parsed = parseInt(String(value), 10);
  if (isNaN(parsed)) return null;
  return parsed;
}

function parseOptionalJson(formData: FormData, field: string): Record<string, unknown> | null {
  const value = formData.get(field);
  if (!value) return null;
  try {
    const parsed = JSON.parse(String(value));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`VALIDATION_FAILED: ${field} must be a valid JSON object.`);
  }
}

// ---------------------------------------------------------------------------
// TASK 3: Role-bound dual approval verification
// ---------------------------------------------------------------------------

/**
 * Verify that the authenticated user is actually assigned to the requested
 * approver role. An Owner cannot occupy the Accountant slot, and vice versa.
 * DEC-069: distinct-role and distinct-identity requirements.
 */
function verifyApproverRole(
  authResult: { roles: ReadonlyArray<RoleCode>; userId: string },
  requestedRole: ApproverRole,
): void {
  // Check that the user actually has the requested role assigned
  if (!authResult.roles.includes(requestedRole as RoleCode)) {
    throw new Error(
      `PERMISSION_DENIED: User is not assigned to role '${requestedRole}'. ` +
      `User roles: [${authResult.roles.join(", ")}]. ` +
      `An Owner cannot occupy the Accountant approval slot and vice versa (DEC-069).`,
    );
  }

  // Handle multi-role users: if user has both owner and accountant roles,
  // they must explicitly select which role they are acting as. This is
  // permitted by the contract as long as the same physical user does not
  // provide both approvals for the same batch (enforced by the service).
  // If the user has only one of the two roles, they can only use that slot.
  // If the user has neither role, they are denied (caught above).
  // Multi-role ambiguity is acceptable here because the service enforces
  // distinct-identity at the batch level.
}

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

  // TASK 2: executeCorrectionAction is NOT exposed in the UI because no
  // production CorrectionDomainHook exists. The contract (§8.11) says
  // correction execution "invokes the affected domain correction/reversal/
  // adjustment" but does not define the mapping from correctionType +
  // originalEntityType to specific domain service methods, the transaction
  // boundary for the hook, or how to handle multi-entity corrections.
  // Creating a fake/no-op hook would be a safety violation.
  const correctionService = new HistoricalCorrectionService({
    repository: correctionRepo,
    audit,
    idempotency,
    documentSequence,
    // correctionDomainHook intentionally NOT provided.
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

  const sourceDescription = parseOptionalString(formData, "sourceDescription");
  const templateName = parseOptionalString(formData, "templateName");
  const templateVersion = parseOptionalString(formData, "templateVersion");
  const cutoverImportMode = parseCutoverImportMode(
    String(formData.get("cutoverImportMode") ?? "opening_balance"),
  );
  const idempotencyKey = parseRequiredString(formData, "idempotencyKey");

  const { stagingService } = getMigrationServices();

  await stagingService.createBatch(authResult as any, effective as any, {
    sourceDescription,
    templateName,
    templateVersion,
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

  const batchId = parseRequiredString(formData, "batchId");
  const originalFileName = parseRequiredString(formData, "originalFileName");
  const storagePath = parseRequiredString(formData, "storagePath");
  const fileHash = parseRequiredString(formData, "fileHash");
  const fileType = parseFileType(String(formData.get("fileType") ?? "source"));
  const fileSizeBytes = parseOptionalInt(formData, "fileSizeBytes");
  const contentType = parseOptionalString(formData, "contentType");
  const idempotencyKey = parseRequiredString(formData, "idempotencyKey");

  // Reject public URLs in storagePath (security boundary)
  if (storagePath.startsWith("http://") || storagePath.startsWith("https://")) {
    throw new Error("VALIDATION_FAILED: public URLs are not allowed for storagePath.");
  }

  const { stagingService } = getMigrationServices();

  await stagingService.registerFile(authResult as any, effective as any, {
    importBatchId: batchId,
    originalFileName,
    storagePath,
    fileHash,
    fileType,
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

  const batchId = parseRequiredString(formData, "batchId");
  const importFileId = parseRequiredString(formData, "importFileId");
  const templateName = parseOptionalString(formData, "templateName");
  const sourceSheetName = parseOptionalString(formData, "sourceSheetName");
  const sourceRowNumber = parseOptionalInt(formData, "sourceRowNumber");
  const rawRowJson = parseOptionalJson(formData, "rawRowJson");
  const transformedRowJson = parseOptionalJson(formData, "transformedRowJson");
  const idempotencyKey = parseRequiredString(formData, "idempotencyKey");

  const { stagingService } = getMigrationServices();

  await stagingService.insertStagingRow(authResult as any, effective as any, {
    importBatchId: batchId,
    importFileId,
    templateName,
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

  const batchId = parseRequiredString(formData, "batchId");
  const idempotencyKey = parseRequiredString(formData, "idempotencyKey");

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

  const batchId = parseRequiredString(formData, "batchId");
  const idempotencyKey = parseRequiredString(formData, "idempotencyKey");
  const expectedTotalsRaw = parseOptionalJson(formData, "expectedTotals") ?? {};
  const expectedTotals: Record<string, string> = {};
  for (const [k, v] of Object.entries(expectedTotalsRaw)) {
    expectedTotals[k] = String(v);
  }

  const { reconciliationService } = getMigrationServices();

  await reconciliationService.runReconciliation(authResult as any, effective as any, {
    importBatchId: batchId,
    expectedTotals,
    idempotencyKey,
  });

  revalidatePath(`/management/admin/migration/${batchId}`);
}

// ---------------------------------------------------------------------------
// 6. Record review decision (accept/reject warning)
// ---------------------------------------------------------------------------

export async function recordReviewDecisionAction(formData: FormData): Promise<void> {
  const { authResult, effective } = await authenticateAndRequirePermission("migration.review");

  const reviewItemId = parseRequiredString(formData, "reviewItemId");
  const batchId = parseRequiredString(formData, "batchId");
  const decision = parseReviewDecision(String(formData.get("decision") ?? ""));
  const decisionNotes = String(formData.get("decisionNotes") ?? "");
  const idempotencyKey = parseRequiredString(formData, "idempotencyKey");

  const { reconciliationService } = getMigrationServices();

  await reconciliationService.recordReviewDecision(authResult as any, effective as any, {
    reviewItemId,
    decision,
    decisionNotes,
    idempotencyKey,
  });

  revalidatePath(`/management/admin/migration/${batchId}`);
}

// ---------------------------------------------------------------------------
// 7. Record approval (Owner or Accountant) — TASK 3: role-bound
// ---------------------------------------------------------------------------

export async function recordApprovalAction(formData: FormData): Promise<void> {
  const { authResult, effective } = await authenticateAndRequirePermission("migration.approve");

  const batchId = parseRequiredString(formData, "batchId");
  const approverRole = parseApproverRole(String(formData.get("approverRole") ?? ""));
  const reason = parseOptionalString(formData, "reason");
  const idempotencyKey = parseRequiredString(formData, "idempotencyKey");

  // TASK 3: Verify the authenticated user is actually assigned to the
  // requested role. An Owner cannot occupy the Accountant slot and vice versa.
  verifyApproverRole(authResult, approverRole);

  const { commitService } = getMigrationServices();

  await commitService.recordApproval(authResult as any, effective as any, {
    importBatchId: batchId,
    approverRole,
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

  const batchId = parseRequiredString(formData, "batchId");
  const backupType = parseRequiredString(formData, "backupType");
  const backupLocation = parseRequiredString(formData, "backupLocation");
  const backupHash = parseRequiredString(formData, "backupHash");
  const backupSizeBytes = parseOptionalInt(formData, "backupSizeBytes");
  const verificationNotes = parseOptionalString(formData, "verificationNotes");
  const idempotencyKey = parseRequiredString(formData, "idempotencyKey");

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

  const batchId = parseRequiredString(formData, "batchId");
  const idempotencyKey = parseRequiredString(formData, "idempotencyKey");

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

  const batchId = parseRequiredString(formData, "batchId");
  const originalEntityType = parseRequiredString(formData, "originalEntityType");
  const originalEntityId = parseRequiredString(formData, "originalEntityId");
  const correctionType = parseCorrectionType(String(formData.get("correctionType") ?? "adjustment"));
  const reason = parseRequiredString(formData, "reason");
  const idempotencyKey = parseRequiredString(formData, "idempotencyKey");
  const proposedCorrectionJson = parseOptionalJson(formData, "proposedCorrectionJson");
  const impactAnalysisJson = parseOptionalJson(formData, "impactAnalysisJson");

  const { correctionService } = getMigrationServices();

  await correctionService.createCorrectionRequest(authResult as any, effective as any, {
    importBatchId: batchId,
    originalEntityType,
    originalEntityId,
    correctionType,
    reason,
    proposedCorrectionJson,
    impactAnalysisJson,
    idempotencyKey,
  });

  revalidatePath(`/management/admin/migration/${batchId}`);
}

// ---------------------------------------------------------------------------
// 11. Approve correction — TASK 3: role-bound
// ---------------------------------------------------------------------------

export async function approveCorrectionAction(formData: FormData): Promise<void> {
  const { authResult, effective } = await authenticateAndRequirePermission("migration.approve");

  const correctionRequestId = parseRequiredString(formData, "correctionRequestId");
  const approverRole = parseApproverRole(String(formData.get("approverRole") ?? ""));
  const batchId = parseOptionalString(formData, "batchId");
  const idempotencyKey = parseRequiredString(formData, "idempotencyKey");

  // TASK 3: Verify the authenticated user is actually assigned to the
  // requested role for correction approval (DEC-070).
  verifyApproverRole(authResult, approverRole);

  const { correctionService } = getMigrationServices();

  await correctionService.approveCorrection(authResult as any, effective as any, {
    correctionRequestId,
    approverRole,
    idempotencyKey,
  });

  if (batchId) {
    revalidatePath(`/management/admin/migration/${batchId}`);
  }
}

// ---------------------------------------------------------------------------
// 12. Execute correction — NOT EXPOSED IN UI (TASK 2)
//
// executeCorrectionAction is NOT exposed in the UI because no production
// CorrectionDomainHook exists. The contract (§8.11) says correction
// execution "invokes the affected domain correction/reversal/adjustment"
// but does not define:
// 1. The mapping from correctionType + originalEntityType to domain service
// 2. The transaction boundary for the hook (called outside transactionRunner)
// 3. How to handle multi-entity corrections
//
// Creating a fake/no-op hook would be a safety violation.
// Status: blocked_on_missing_production_correction_hook
// ---------------------------------------------------------------------------
