/**
 * In-memory HistoricalCommitRepository — WP-07-04 tests.
 * TEST-ONLY. Non-persistent in-memory store for unit tests.
 */
import { randomUUID } from "node:crypto";
import type {
  HistoricalCommitRepository,
  NewApprovalInput,
  NewBackupEvidenceInput,
  NewCutoverLockInput,
  ReleaseLockInput,
  UpdateStagingRowCommitLinkInput,
} from "../historical-commit-repository";
import type {
  ImportBatch,
  ImportBatchApproval,
  ImportBackupEvidence,
  ImportCutoverLock,
  ImportStagingRow,
  ImportValidationError,
  ImportReconciliationResult,
  ImportCutoverManifest,
} from "@/server/db/schema/migration";

const NOW = () => new Date();
function nid(prefix: string, counter: number): string {
  return `${prefix}-${String(counter).padStart(6, "0")}-${randomUUID().slice(0, 8)}`;
}

export class InMemoryHistoricalCommitRepository implements HistoricalCommitRepository {
  private batches = new Map<string, ImportBatch>();
  private approvals = new Map<string, ImportBatchApproval>();
  private backupEvidence = new Map<string, ImportBackupEvidence>();
  private cutoverLocks = new Map<string, ImportCutoverLock>();
  private stagingRows = new Map<string, ImportStagingRow[]>();
  private validationErrors = new Map<string, ImportValidationError[]>();
  private reconResults = new Map<string, ImportReconciliationResult[]>();
  private cutoverManifests = new Map<string, ImportCutoverManifest[]>();
  private approvalCounter = 0;
  private backupCounter = 0;
  private lockCounter = 0;

  // ---- Seed helpers for tests ----
  seedBatch(tenantId: string, batch: ImportBatch): void {
    this.batches.set(`${tenantId}:${batch.id}`, batch);
  }
  seedStagingRows(tenantId: string, batchId: string, rows: ImportStagingRow[]): void {
    this.stagingRows.set(`${tenantId}:${batchId}`, rows);
  }
  seedValidationErrors(tenantId: string, batchId: string, errors: ImportValidationError[]): void {
    this.validationErrors.set(`${tenantId}:${batchId}`, errors);
  }
  seedReconciliationResults(tenantId: string, batchId: string, results: ImportReconciliationResult[]): void {
    this.reconResults.set(`${tenantId}:${batchId}`, results);
  }
  seedCutoverManifests(tenantId: string, batchId: string, manifests: ImportCutoverManifest[]): void {
    this.cutoverManifests.set(`${tenantId}:${batchId}`, manifests);
  }
  /** Seed an approval record directly (bypasses service for test setup). */
  seedApproval(
    tenantId: string,
    approval: {
      importBatchId: string;
      approverRole: "owner" | "accountant";
      approverUserId: string;
      stagedDataHash: string;
      cutoverManifestHash: string;
      templateVersion?: string | null;
      mappingVersion?: string | null;
      validationStatus?: string | null;
      reconciliationStatus?: string | null;
      warningSummary?: string | null;
      reason?: string | null;
      createdBy?: string;
    },
  ): ImportBatchApproval {
    this.approvalCounter++;
    const id = nid("appr-seed", this.approvalCounter);
    const record: ImportBatchApproval = {
      id,
      tenantId,
      importBatchId: approval.importBatchId,
      approverRole: approval.approverRole as any,
      approverUserId: approval.approverUserId,
      stagedDataHash: approval.stagedDataHash,
      cutoverManifestHash: approval.cutoverManifestHash,
      templateVersion: approval.templateVersion ?? null,
      mappingVersion: approval.mappingVersion ?? null,
      validationStatus: approval.validationStatus ?? "passed",
      reconciliationStatus: approval.reconciliationStatus ?? "matched",
      warningSummary: approval.warningSummary ?? null,
      approvedAt: NOW(),
      reason: approval.reason ?? null,
      createdBy: approval.createdBy ?? approval.approverUserId,
      createdAt: NOW(),
      updatedBy: null,
      updatedAt: null,
    };
    this.approvals.set(`${tenantId}:${id}`, record);
    return record;
  }
  /** Seed backup evidence directly (bypasses service for test setup). */
  seedBackupEvidence(
    tenantId: string,
    evidence: {
      importBatchId: string;
      backupType: string;
      backupLocation: string;
      backupHash: string;
      backupSizeBytes: number | null;
      verifiedBy?: string;
      verificationNotes?: string | null;
      createdBy?: string;
    },
  ): ImportBackupEvidence {
    this.backupCounter++;
    const id = nid("bkp-seed", this.backupCounter);
    const record: ImportBackupEvidence = {
      id,
      tenantId,
      importBatchId: evidence.importBatchId,
      backupType: evidence.backupType,
      backupLocation: evidence.backupLocation,
      backupHash: evidence.backupHash,
      backupSizeBytes: evidence.backupSizeBytes,
      backupCreatedAt: NOW(),
      verifiedBy: evidence.verifiedBy ?? "test-user",
      verifiedAt: NOW(),
      verificationNotes: evidence.verificationNotes ?? null,
      createdBy: evidence.createdBy ?? "test-user",
      createdAt: NOW(),
      updatedBy: null,
      updatedAt: null,
    };
    this.backupEvidence.set(`${tenantId}:${id}`, record);
    return record;
  }

  // ---- Batch access ----

  async findImportBatchById(tenantId: string, id: string): Promise<ImportBatch | null> {
    return this.batches.get(`${tenantId}:${id}`) ?? null;
  }

  async updateBatchStatus(tenantId: string, batchId: string, status: string): Promise<ImportBatch | null> {
    const key = `${tenantId}:${batchId}`;
    const batch = this.batches.get(key);
    if (!batch) return null;
    const updated = { ...batch, status: status as any, updatedAt: NOW() };
    this.batches.set(key, updated);
    return updated;
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
    const key = `${tenantId}:${batchId}`;
    const batch = this.batches.get(key);
    if (!batch) return null;
    const updated: ImportBatch = {
      ...batch,
      status: "committed" as any,
      committedAt: patch.committedAt,
      commitEffectCounts: patch.commitEffectCounts,
      updatedBy: patch.updatedBy,
      updatedAt: NOW(),
    };
    this.batches.set(key, updated);
    return updated;
  }

  async updateBatchStagedDataHash(
    tenantId: string,
    batchId: string,
    stagedDataHash: string,
    updatedBy: string,
  ): Promise<ImportBatch | null> {
    const key = `${tenantId}:${batchId}`;
    const batch = this.batches.get(key);
    if (!batch) return null;
    const updated = { ...batch, stagedDataHash, updatedBy, updatedAt: NOW() };
    this.batches.set(key, updated);
    return updated;
  }

  // ---- Approval records ----

  async insertApproval(row: NewApprovalInput): Promise<ImportBatchApproval> {
    this.approvalCounter++;
    const id = nid("appr", this.approvalCounter);
    const approval: ImportBatchApproval = {
      id,
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
      approvedAt: NOW(),
      reason: row.reason,
      createdBy: row.createdBy,
      createdAt: NOW(),
      updatedBy: null,
      updatedAt: null,
    };
    this.approvals.set(`${row.tenantId}:${id}`, approval);
    return approval;
  }

  async findApprovalsForBatch(tenantId: string, importBatchId: string): Promise<ImportBatchApproval[]> {
    return [...this.approvals.values()].filter(
      a => a.tenantId === tenantId && a.importBatchId === importBatchId,
    );
  }

  async findApprovalByRole(
    tenantId: string,
    importBatchId: string,
    approverRole: "owner" | "accountant",
  ): Promise<ImportBatchApproval | null> {
    return [...this.approvals.values()].find(
      a => a.tenantId === tenantId && a.importBatchId === importBatchId && a.approverRole === approverRole,
    ) ?? null;
  }

  // ---- Backup evidence ----

  async insertBackupEvidence(row: NewBackupEvidenceInput): Promise<ImportBackupEvidence> {
    this.backupCounter++;
    const id = nid("bkp", this.backupCounter);
    const evidence: ImportBackupEvidence = {
      id,
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
      createdAt: NOW(),
      updatedBy: null,
      updatedAt: null,
    };
    this.backupEvidence.set(`${row.tenantId}:${id}`, evidence);
    return evidence;
  }

  async findBackupEvidenceForBatch(tenantId: string, importBatchId: string): Promise<ImportBackupEvidence[]> {
    return [...this.backupEvidence.values()].filter(
      e => e.tenantId === tenantId && e.importBatchId === importBatchId,
    );
  }

  // ---- Cutover locks ----

  async insertCutoverLock(row: NewCutoverLockInput): Promise<ImportCutoverLock> {
    this.lockCounter++;
    const id = nid("lock", this.lockCounter);
    const lock: ImportCutoverLock = {
      id,
      tenantId: row.tenantId,
      importBatchId: row.importBatchId,
      lockScope: row.lockScope,
      acquiredBy: row.acquiredBy,
      acquiredAt: NOW(),
      expiresAt: row.expiresAt,
      releasedAt: null,
      releasedBy: null,
      releaseReason: null,
      commitIdempotencyKey: row.commitIdempotencyKey,
      createdBy: row.createdBy,
      createdAt: NOW(),
      updatedBy: null,
      updatedAt: null,
    };
    this.cutoverLocks.set(`${row.tenantId}:${id}`, lock);
    return lock;
  }

  async findActiveCutoverLocksForBatch(tenantId: string, importBatchId: string): Promise<ImportCutoverLock[]> {
    return [...this.cutoverLocks.values()].filter(
      l => l.tenantId === tenantId && l.importBatchId === importBatchId && l.releasedAt === null,
    );
  }

  async findActiveCutoverLockByScope(
    tenantId: string,
    importBatchId: string,
    lockScope: string,
  ): Promise<ImportCutoverLock | null> {
    return [...this.cutoverLocks.values()].find(
      l => l.tenantId === tenantId && l.importBatchId === importBatchId &&
        l.lockScope === lockScope && l.releasedAt === null,
    ) ?? null;
  }

  async releaseCutoverLock(
    tenantId: string,
    lockId: string,
    patch: ReleaseLockInput,
  ): Promise<ImportCutoverLock | null> {
    const key = `${tenantId}:${lockId}`;
    const lock = this.cutoverLocks.get(key);
    if (!lock) return null;
    const updated: ImportCutoverLock = {
      ...lock,
      releasedAt: patch.releasedAt,
      releasedBy: patch.releasedBy,
      releaseReason: patch.releaseReason,
      updatedAt: NOW(),
    };
    this.cutoverLocks.set(key, updated);
    return updated;
  }

  async releaseAllLocksForBatch(
    tenantId: string,
    importBatchId: string,
    patch: ReleaseLockInput,
  ): Promise<number> {
    let count = 0;
    for (const [key, lock] of this.cutoverLocks.entries()) {
      if (lock.tenantId === tenantId && lock.importBatchId === importBatchId && lock.releasedAt === null) {
        const updated: ImportCutoverLock = {
          ...lock,
          releasedAt: patch.releasedAt,
          releasedBy: patch.releasedBy,
          releaseReason: patch.releaseReason,
          updatedAt: NOW(),
        };
        this.cutoverLocks.set(key, updated);
        count++;
      }
    }
    return count;
  }

  // ---- Staging rows ----

  async findStagingRowsForBatch(tenantId: string, importBatchId: string): Promise<ImportStagingRow[]> {
    return this.stagingRows.get(`${tenantId}:${importBatchId}`) ?? [];
  }

  async updateStagingRowCommitLink(
    tenantId: string,
    stagingRowId: string,
    patch: UpdateStagingRowCommitLinkInput,
  ): Promise<ImportStagingRow | null> {
    for (const [key, rows] of this.stagingRows.entries()) {
      if (!key.startsWith(`${tenantId}:`)) continue;
      const idx = rows.findIndex(r => r.id === stagingRowId);
      if (idx >= 0) {
        const existing = rows[idx]!;
        const updated: ImportStagingRow = {
          ...existing,
          committedEntityType: patch.committedEntityType,
          committedEntityId: patch.committedEntityId,
          updatedBy: patch.updatedBy,
          updatedAt: NOW(),
        };
        rows[idx] = updated;
        return updated;
      }
    }
    return null;
  }

  // ---- Validation errors ----

  async findBlockingValidationErrors(tenantId: string, importBatchId: string): Promise<ImportValidationError[]> {
    const errors = this.validationErrors.get(`${tenantId}:${importBatchId}`) ?? [];
    return errors.filter(e => e.isBlocking);
  }

  // ---- Reconciliation results ----

  async findLatestReconciliationResults(tenantId: string, importBatchId: string): Promise<ImportReconciliationResult[]> {
    const results = this.reconResults.get(`${tenantId}:${importBatchId}`) ?? [];
    if (results.length === 0) return [];
    const maxVersion = Math.max(...results.map(r => r.reportVersion));
    return results.filter(r => r.reportVersion === maxVersion);
  }

  // ---- Cutover manifests ----

  async findCutoverManifestsForBatch(tenantId: string, importBatchId: string): Promise<ImportCutoverManifest[]> {
    return this.cutoverManifests.get(`${tenantId}:${importBatchId}`) ?? [];
  }
}
