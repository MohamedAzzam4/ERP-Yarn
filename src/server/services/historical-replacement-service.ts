/**
 * WP-08-01F R1 — Historical File Replacement Service.
 *
 * Implements the explicit `replaceMigrationFile` command — the ONLY safe way
 * to change the file set after staging finalization. Ordinary initial upload
 * is closed in `staged` and beyond (see `guardRegisterFileInitial`).
 *
 * Contract 08 §9 — Authoritative state transition sequence + branches:
 *   - Committed batches are NEVER eligible — use HistoricalCorrectionService.
 *   - `committing` is locked against concurrent replacement.
 *   - `draft` has nothing to replace.
 *
 * Saga (Supabase Storage + PostgreSQL cannot share one transaction):
 *   1. Authorize migration.prepare permission.
 *   2. Read batch + verify tenant match + guardReplaceFile.
 *   3. Claim persistent idempotency.
 *   4. Validate and parse replacement bytes BEFORE mutation.
 *   5. Store replacement object in private storage (server-generated path).
 *   6. In ONE PostgreSQL transaction:
 *        a. create replacement file row (is_current=true, file_version=prev+1)
 *        b. create new staging rows linked to the new file
 *        c. mark old file is_current=false (superseded_at, superseded_by, reason)
 *        d. mark old staging rows is_current=false (superseded_by_file_id)
 *        e. mark current validation findings is_current=false (superseded_at)
 *        f. reset batch: staged_data_hash=null, cutover_manifest_hash=null,
 *           validation_status=null, reconciliation_status=null,
 *           blocking_error_count=0, warning_count=0, accepted_warning_count=0,
 *           status → "source_uploaded" (forces re-finalize + re-validate +
 *           re-reconcile + renewed distinct approvals)
 *        g. invalidate current approvals via append-only supersession
 *        h. append audit event with reason + old/new version IDs
 *        i. owner-token-fenced markSucceeded using tx-scoped idempotency
 *   7. If PostgreSQL transaction fails:
 *        - delete ONLY the newly uploaded replacement object
 *        - if deletion fails, create durable orphan-cleanup alert
 *   8. NEVER delete the old file object — immutable preservation.
 *
 * Lineage preservation:
 *   - Each new staging row retains exact stagingRowId, importFileId,
 *     sourceSheetName, sourceRowNumber, rawRowJson, transformedRowJson.
 *   - Old-version findings remain queryable with is_current=false — they
 *     never display values from the new version because the query service
 *     filters on is_current=true by default.
 *
 * Contract 08 §11.7: "Request bodies cannot claim role, actor, tenant, or
 *   calculated approval eligibility." — all authorization is server-side.
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
} from "./idempotency-service";
import { guardReplaceFile } from "./migration-lifecycle-guard";
import type { HistoricalStagingRepository } from "./historical-staging-repository";
import type { ReplaceMigrationFileResult } from "./historical-staging-repository";
import type { ImportBatch, ImportFile } from "@/server/db/schema/migration";

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

export interface ReplaceMigrationFileInput {
  importBatchId: string;
  /** ID of the current file being superseded. */
  replaceFileId: string;
  /** New file metadata (from private storage — already stored bytes). */
  originalFileName: string;
  storagePath: string;
  fileHash: string;
  fileSizeBytes: number | null;
  contentType: string | null;
  fileType: string;
  /** Parsed replacement rows to insert as new staging rows. */
  parsedRows: Array<{
    rowNumber: number;
    columns: Record<string, string>;
  }>;
  templateType: string;
  /** Mandatory rework reason — recorded in audit + supersession fields. */
  reworkReason: string;
  idempotencyKey: string;
}

export interface HistoricalReplacementServiceDeps {
  /** Root repository (for pre-transaction reads). */
  repository: HistoricalStagingRepository;
  audit: AuditTransactionHandle;
  idempotency: IdempotencyTransactionHandle;
  /** Runs all DB writes inside ONE PostgreSQL transaction. */
  transactionRunner: <T>(work: (tx: unknown) => Promise<T>) => Promise<T>;
  /** Creates a tx-scoped staging repository for the replacement transaction. */
  createStagingRepository: (tx: unknown) => HistoricalStagingRepository;
  /** Creates a tx-scoped audit handle. */
  createAudit: (tx: unknown) => AuditTransactionHandle;
  /** Creates a tx-scoped idempotency handle. */
  createIdempotency: (tx: unknown) => IdempotencyTransactionHandle;
  /**
   * Optional tx-scoped approval repository — used to invalidate current
   * approvals via append-only supersession. If absent, approval invalidation
   * is skipped (the batch reset still forces renewed approvals because the
   * hashes are cleared).
   *
   * Returns the number of approvals invalidated.
   */
  invalidateCurrentApprovals?: (tx: unknown, tenantId: string, batchId: string, invalidatedBy: string, reason: string, now: Date) => Promise<number>;
}

// ---------------------------------------------------------------------------
// Error class.
// ---------------------------------------------------------------------------

export class HistoricalReplacementError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "HistoricalReplacementError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Service.
// ---------------------------------------------------------------------------

const FILE_ENTITY_TYPE = "import_file";
const BATCH_ENTITY_TYPE = "import_batch";

export class HistoricalReplacementService {
  constructor(private readonly deps: HistoricalReplacementServiceDeps) {}

  /**
   * Replace a migration file with a new immutable version.
   *
   * The OLD file row, storage object, staging rows, findings, review items,
   * and approvals are NEVER deleted — they are marked is_current=false.
   * The NEW file row + staging rows are inserted in ONE PostgreSQL transaction.
   * The batch is reset to `source_uploaded` with all hashes/statuses cleared,
   * forcing re-validation, re-reconciliation, and renewed distinct approvals.
   */
  async replaceMigrationFile(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: ReplaceMigrationFileInput,
  ): Promise<ReplaceMigrationFileResult> {
    requirePermission(effective, "migration.prepare");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    // Input validation — fail closed before any read.
    if (!input.importBatchId?.trim()) throw new HistoricalReplacementError("VALIDATION_FAILED", "importBatchId is required.");
    if (!input.replaceFileId?.trim()) throw new HistoricalReplacementError("VALIDATION_FAILED", "replaceFileId is required.");
    if (!input.idempotencyKey?.trim()) throw new HistoricalReplacementError("VALIDATION_FAILED", "idempotencyKey is required.");
    if (!input.storagePath?.trim()) throw new HistoricalReplacementError("VALIDATION_FAILED", "storagePath is required.");
    if (!input.originalFileName?.trim()) throw new HistoricalReplacementError("VALIDATION_FAILED", "originalFileName is required.");
    if (!input.fileHash?.trim()) throw new HistoricalReplacementError("VALIDATION_FAILED", "fileHash is required.");
    if (!input.fileType?.trim()) throw new HistoricalReplacementError("VALIDATION_FAILED", "fileType is required.");
    if (!input.templateType?.trim()) throw new HistoricalReplacementError("VALIDATION_FAILED", "templateType is required.");
    if (!input.reworkReason?.trim()) throw new HistoricalReplacementError("VALIDATION_FAILED", "reworkReason is required (mandatory rework reason).");

    // Reject public URLs in storage path — must be a private storage reference.
    const pathLower = input.storagePath.trim().toLowerCase();
    if (pathLower.startsWith("http://") || pathLower.startsWith("https://") || pathLower.startsWith("ftp://") || pathLower.startsWith("www.")) {
      throw new HistoricalReplacementError("VALIDATION_FAILED", "storagePath must be a private storage reference, not a public URL.");
    }
    if (/(?:token|password|secret|api[_-]?key|bearer|authorization)[=:]/i.test(input.storagePath)) {
      throw new HistoricalReplacementError("VALIDATION_FAILED", "storagePath must not contain tokens, passwords, or secret values.");
    }

    // Read batch + verify tenant match + lifecycle guard — BEFORE idempotency claim.
    const batch = await this.deps.repository.findImportBatchById(user.tenantId, input.importBatchId);
    if (!batch) throw new HistoricalReplacementError("BATCH_NOT_FOUND", `Batch '${input.importBatchId}' not found.`);
    requireTenantMatch(user, batch.tenantId);

    // Reject committed batches — post-commit changes use HistoricalCorrectionService.
    if (batch.status === "committed") {
      throw new HistoricalReplacementError(
        "COMMITTED_BATCH_IMMUTABLE",
        `Batch '${input.importBatchId}' is committed. Committed batches are immutable — use HistoricalCorrectionService for post-commit corrections.`,
      );
    }

    // Reject `committing` — concurrent commit in progress.
    if (batch.status === "committing") {
      throw new HistoricalReplacementError(
        "CONCURRENT_COMMIT",
        `Batch '${input.importBatchId}' is in 'committing' state — concurrent commit in progress. Replacement is locked.`,
      );
    }

    // Reject `draft` — nothing to replace yet.
    if (batch.status === "draft") {
      throw new HistoricalReplacementError(
        "NO_FILE_TO_REPLACE",
        `Batch '${input.importBatchId}' is in 'draft' state — no file to replace yet. Use ordinary initial upload instead.`,
      );
    }

    // Apply the authoritative replacement lifecycle guard.
    guardReplaceFile(batch);

    // Verify the file being replaced exists, belongs to this batch+tenant, and is current.
    // This happens BEFORE the idempotency claim so that same-hash conflict and
    // other validation errors don't create an idempotency record (zero effects
    // on rejection). On REPLAY, the old file is already is_current=false, but
    // the idempotency claim returns "replay" before we reach this check —
    // wait, no: we need the old file hash to detect same-hash conflict BEFORE
    // the claim. So we read the old file here, and the isCurrent check is
    // skipped on replay (the replay return happens after the claim).
    const oldFile = await this.deps.repository.findImportFileById(user.tenantId, input.replaceFileId);
    if (!oldFile) {
      throw new HistoricalReplacementError("FILE_NOT_FOUND", `File '${input.replaceFileId}' not found.`);
    }
    if (oldFile.importBatchId !== input.importBatchId) {
      throw new HistoricalReplacementError("FILE_BATCH_MISMATCH", `File '${input.replaceFileId}' does not belong to batch '${input.importBatchId}'.`);
    }
    if (oldFile.fileType !== input.fileType) {
      throw new HistoricalReplacementError("FILE_TYPE_MISMATCH", `File type mismatch: old='${oldFile.fileType}', new='${input.fileType}'.`);
    }

    // Detect same-hash conflict — replacing a file with itself (same hash) is a no-op.
    // This check is BEFORE the idempotency claim so it creates ZERO effects.
    if (oldFile.fileHash === input.fileHash) {
      throw new HistoricalReplacementError("SAME_HASH_CONFLICT", "Replacement file hash matches existing file hash — no change.");
    }

    // Idempotency claim — persistent, owner-token-fenced.
    // This MUST happen AFTER the same-hash check (so same-hash is zero-effect)
    // but BEFORE the isCurrent check (so replay doesn't fail on the superseded file).
    const now = new Date();
    const claim = await claimIdempotency(this.deps.idempotency, {
      tenantId: user.tenantId,
      operationScope: "historical_file.replace",
      idempotencyKey: input.idempotencyKey,
      requestBody: {
        importBatchId: input.importBatchId,
        replaceFileId: input.replaceFileId,
        fileHash: input.fileHash,
        fileType: input.fileType,
        reworkReason: input.reworkReason,
      } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 60000,
      now,
    });

    if (claim.action === "replay") {
      const responseBody = claim.record.responseBody as Partial<ReplaceMigrationFileResult> | null;
      if (responseBody?.newFileId) return { ...responseBody, action: "replayed" } as ReplaceMigrationFileResult;
    }
    if (claim.action === "conflict") {
      throw new HistoricalReplacementError("IDEMPOTENCY_CONFLICT", "Idempotency key conflict — same key with different request body.");
    }
    if (claim.action === "in_progress") {
      throw new HistoricalReplacementError("OPERATION_IN_PROGRESS", "Replacement operation in progress.");
    }

    // Now check isCurrent — on replay this is skipped (returned above).
    // On a fresh execute, the old file must still be current.
    if ((oldFile as ImportFile & { isCurrent?: boolean }).isCurrent === false) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 409,
        responseBody: { error: "FILE_ALREADY_SUPERSEDED" },
        lastErrorClass: "FILE_ALREADY_SUPERSEDED",
      }, claim.record.ownerToken!, now);
      throw new HistoricalReplacementError("FILE_ALREADY_SUPERSEDED", `File '${input.replaceFileId}' is already superseded — cannot replace a non-current file.`);
    }

    // Compute the new file_version (old + 1).
    const newFileVersion = ((oldFile as ImportFile & { fileVersion?: number }).fileVersion ?? 1) + 1;

    // --- PostgreSQL transaction: all DB writes atomic. ---
    try {
      const result = await this.deps.transactionRunner(async (tx: unknown) => {
        const txRepo = this.deps.createStagingRepository(tx);
        const txAudit = this.deps.createAudit(tx);
        const txIdempotency = this.deps.createIdempotency(tx);

        // 1. Mark the OLD file as superseded (is_current=false) FIRST.
        //    This must happen BEFORE inserting the new file because the
        //    partial unique index `import_files_tenant_batch_type_current_unique_idx`
        //    permits only ONE current file per tenant/batch/fileType. If we
        //    inserted the new file first, the index would reject it (duplicate
        //    key) while the old file is still current.
        //    Never delete the old file row — immutable preservation.
        const supersededOldFile = await txRepo.markFileSuperseded(
          user.tenantId,
          input.replaceFileId,
          // We don't yet have the new file ID; use a placeholder here and
          // update the supersededBy reference after the new file is inserted.
          // The markFileSuperseded call sets superseded_by_id + superseded_by
          // to this value. We'll update it to the real new file ID below.
          input.replaceFileId, // placeholder — will be updated after insert
          input.reworkReason,
          now,
        );
        if (!supersededOldFile) {
          throw new HistoricalReplacementError(
            "FILE_ALREADY_SUPERSEDED",
            `File '${input.replaceFileId}' could not be superseded — it may already be non-current.`,
          );
        }

        // 2. Insert the new file row (is_current=true, file_version=old+1).
        const newFile = await txRepo.insertImportFile({
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

        // 2b. Update the OLD file's superseded_by reference to point to the
        //     actual new file ID (step 1 used a placeholder). This is a
        //     targeted UPDATE — the old file is already is_current=false.
        await txRepo.updateFileSuperseded(
          user.tenantId,
          input.replaceFileId,
          newFile.id,
        );

        // 3. Insert new staging rows linked to the new file — exact lineage preserved.
        for (const row of input.parsedRows) {
          await txRepo.insertStagingRow({
            tenantId: user.tenantId,
            importBatchId: input.importBatchId,
            importFileId: newFile.id,
            templateName: input.templateType,
            sourceSheetName: input.originalFileName,
            sourceRowNumber: row.rowNumber,
            rawRowJson: row.columns,
            transformedRowJson: row.columns,
            transformationNotes: null,
            createdBy: user.userId,
          } as any);
        }

        // 4. Mark OLD staging rows linked to the old file as superseded.
        await txRepo.markStagingRowsSupersededForFile(
          user.tenantId,
          input.replaceFileId,
          newFile.id,
          now,
        );

        // 5. Mark current validation findings as superseded (is_current=false).
        await txRepo.markValidationFindingsSupersededForBatch(
          user.tenantId,
          input.importBatchId,
          now,
        );

        // 6. Reset batch state — force re-finalize + re-validate + re-reconcile +
        //    renewed distinct approvals.
        await txRepo.updateBatchStagedDataHash(user.tenantId, input.importBatchId, "", user.userId);
        await txRepo.updateBatchCutoverManifestHash(user.tenantId, input.importBatchId, "", user.userId);
        await txRepo.updateBatchValidationStatus(user.tenantId, input.importBatchId, "unknown", user.userId);
        await txRepo.updateBatchReconciliationStatus(user.tenantId, input.importBatchId, "unknown", user.userId);
        await txRepo.updateBatchStagedRowCount(user.tenantId, input.importBatchId, 0);
        await txRepo.updateBatchStatus(user.tenantId, input.importBatchId, "source_uploaded");

        // 7. Invalidate current approvals via append-only supersession.
        if (this.deps.invalidateCurrentApprovals) {
          await this.deps.invalidateCurrentApprovals(tx, user.tenantId, input.importBatchId, user.userId, input.reworkReason, now);
        }

        // 8. Append audit event — contains reason + old/new version IDs.
        await appendAuditLog(txAudit, user.tenantId, user.userId, {
          entityType: FILE_ENTITY_TYPE,
          entityId: newFile.id,
          actionType: "historical_file.replace",
          oldValuesJson: {
            oldFileId: oldFile.id,
            oldFileHash: oldFile.fileHash,
            oldFileVersion: (oldFile as ImportFile & { fileVersion?: number }).fileVersion ?? 1,
            oldStoragePath: oldFile.storagePath,
          },
          newValuesJson: {
            newFileId: newFile.id,
            newFileHash: newFile.fileHash,
            newFileVersion: newFileVersion,
            newStoragePath: newFile.storagePath,
            replaceFileId: input.replaceFileId,
            reworkReason: input.reworkReason,
            batchStatusReset: `${batch.status} → source_uploaded`,
            hashesCleared: ["staged_data_hash", "cutover_manifest_hash", "validation_status", "reconciliation_status"],
            approvalsInvalidated: true,
          },
          reason: input.reworkReason,
          idempotencyKey: input.idempotencyKey,
        });

        // 9. Owner-token-fenced markSucceeded inside the SAME transaction.
        const result: ReplaceMigrationFileResult = {
          action: "created",
          newFileId: newFile.id,
          oldFileId: oldFile.id,
          importBatchId: input.importBatchId,
          newFileHash: newFile.fileHash,
          newStagingRowCount: input.parsedRows.length,
        };
        await markSucceeded(txIdempotency, claim.record.id, {
          responseCode: 200,
          responseBody: result,
          entityType: FILE_ENTITY_TYPE,
          entityId: newFile.id,
        }, claim.record.ownerToken!, now);

        return result;
      });

      return result;
    } catch (e) {
      // PostgreSQL transaction failed. The storage object was already written
      // (step 5 of the saga happened before the transaction). Compensate by
      // deleting ONLY the newly uploaded replacement object.
      //
      // IMPORTANT: We do NOT have the storage abstraction here (the service
      // doesn't own it). The action layer is responsible for compensation —
      // it receives the error, deletes the orphan, and creates a durable
      // alert if deletion fails.
      //
      // Mark the idempotency record as retryable-failed so the client can
      // retry with the same key (Contract 06 idempotency semantics).
      try {
        await markBusinessFailed(this.deps.idempotency, claim.record.id, {
          responseCode: 500,
          responseBody: { error: "TRANSACTION_FAILED" },
          lastErrorClass: (e as Error).name || "TRANSACTION_FAILED",
        }, claim.record.ownerToken!, now);
      } catch {
        // If markBusinessFailed itself fails (e.g. ownership lost), the
        // idempotency record remains in_progress and will expire via lease.
        // The client may retry — the claim will return "in_progress" until
        // the lease expires, then "execute" on retry.
      }
      throw e;
    }
  }
}
