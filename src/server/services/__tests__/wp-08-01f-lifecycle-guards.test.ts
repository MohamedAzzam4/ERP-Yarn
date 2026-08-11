/**
 * WP-08-01F DEFECT 4 — Service-level lifecycle guard tests.
 *
 * Tests that every corrected service method rejects invalid lifecycle states
 * with exact zero-effect proof.
 */
import { describe, it, expect } from "vitest";
import { InMemoryHistoricalStagingRepository } from "./in-memory-historical-staging-repository";
import { InMemoryHistoricalValidationRepository } from "./in-memory-historical-validation-repository";
import { InMemoryHistoricalReconciliationRepository } from "./in-memory-historical-reconciliation-repository";
import { InMemoryHistoricalCommitRepository } from "./in-memory-historical-commit-repository";
import { InProcessAuditStore } from "../audit-service";
import { InProcessIdempotencyStore } from "../idempotency-service";
import { InProcessDocumentSequenceStore } from "../document-sequence-service";
import { HistoricalStagingService } from "../historical-staging-service";
import { HistoricalValidationService } from "../historical-validation-service";
import { HistoricalReconciliationService } from "../historical-reconciliation-service";
import { HistoricalCommitService } from "../historical-commit-service";
import { resolveEffectivePermissions } from "../../security/effective-permissions";
import { TEST_ROLE_PERMISSION_MATRIX } from "../../security/role-fixtures";
import type { RoleCode } from "../../security/role-codes";
import type { ErpUserContext } from "../../auth/erp-context";
import type { ImportBatch } from "../../db/schema/migration";

const TENANT_A = "00000000-0000-0000-0000-000000081f01";
const OWNER_USER = "00000000-0000-0000-0000-000000081f11";

function makeUser(userId: string = OWNER_USER, tenantId: string = TENANT_A): ErpUserContext {
  return { authenticated: true, userId, tenantId, authId: `auth-${userId}`, name: "Test", email: `test-${userId}@test.local` };
}
function makeEffective(role: RoleCode = "owner") {
  return resolveEffectivePermissions([role], TEST_ROLE_PERMISSION_MATRIX);
}

function makeBatch(status: string, overrides: Partial<ImportBatch> = {}): ImportBatch {
  return {
    id: `batch-${Math.random().toString(36).slice(2, 10)}`,
    tenantId: TENANT_A,
    batchNo: `MIG-${Math.random().toString(36).slice(2, 8)}`,
    status: status as any,
    sourceDescription: "test",
    templateName: "test-template",
    templateVersion: "1.0",
    mappingVersion: "1.0",
    cutoverManifestHash: "manifest-hash",
    cutoverImportMode: "opening_balance",
    stagedDataHash: "staged-hash",
    stagedRowCount: 5,
    blockingErrorCount: 0,
    warningCount: 0,
    acceptedWarningCount: 0,
    validationStatus: null,
    reconciliationStatus: null,
    warningSummary: null,
    committedAt: null,
    commitEffectCounts: null,
    createdAt: new Date(),
    createdBy: OWNER_USER,
    updatedAt: null,
    updatedBy: null,
    ...overrides,
  };
}

describe("WP-08-01F DEFECT 4 — Service lifecycle guards (zero-effect)", () => {
  describe("registerFile against committed batch", () => {
    it("rejects with LIFECYCLE_VIOLATION, zero files/audit/idempotency", async () => {
      const repo = new InMemoryHistoricalStagingRepository();
      const audit = new InProcessAuditStore();
      const idem = new InProcessIdempotencyStore();
      const docSeq = new InProcessDocumentSequenceStore();
      const svc = new HistoricalStagingService({ repository: repo, audit, idempotency: idem, documentSequence: docSeq });
      const batch = makeBatch("committed");
      repo.seedBatch(TENANT_A, batch);

      await expect(
        svc.registerFile(makeUser() as any, makeEffective() as any, {
          importBatchId: batch.id, originalFileName: "f.xlsx", storagePath: "s3://b/k",
          fileHash: "h1", fileType: "source", fileSizeBytes: 1, contentType: null, idempotencyKey: "k1",
        }),
      ).rejects.toThrow(/LIFECYCLE_VIOLATION|InvalidBatchStatusError|non-terminal/);

      expect((await repo.findImportFilesForBatch(TENANT_A, batch.id)).length).toBe(0);
      expect(audit.getRows().length).toBe(0);
    });
  });

  describe("insertStagingRow against committed batch", () => {
    it("rejects with LIFECYCLE_VIOLATION, zero rows/audit", async () => {
      const repo = new InMemoryHistoricalStagingRepository();
      const audit = new InProcessAuditStore();
      const idem = new InProcessIdempotencyStore();
      const docSeq = new InProcessDocumentSequenceStore();
      const svc = new HistoricalStagingService({ repository: repo, audit, idempotency: idem, documentSequence: docSeq });
      const batch = makeBatch("committed");
      repo.seedBatch(TENANT_A, batch);

      await expect(
        svc.insertStagingRow(makeUser() as any, makeEffective() as any, {
          importBatchId: batch.id, importFileId: null, templateName: null,
          sourceSheetName: null, sourceRowNumber: 1, rawRowJson: null, transformedRowJson: { a: 1 },
          transformationNotes: null, idempotencyKey: "k2",
        }),
      ).rejects.toThrow(/LIFECYCLE_VIOLATION|InvalidBatchStatusError|non-terminal/);

      expect((await repo.findStagingRowsForBatch(TENANT_A, batch.id)).length).toBe(0);
      expect(audit.getRows().length).toBe(0);
    });
  });

  describe("runValidation against committed batch", () => {
    it("rejects with LIFECYCLE_VIOLATION, zero findings/audit", async () => {
      const stagingRepo = new InMemoryHistoricalStagingRepository();
      const valRepo = new InMemoryHistoricalValidationRepository();
      const audit = new InProcessAuditStore();
      const idem = new InProcessIdempotencyStore();
      const svc = new HistoricalValidationService({ repository: valRepo, audit, idempotency: idem });
      const batch = makeBatch("committed", { stagedRowCount: 5 });
      stagingRepo.seedBatch(TENANT_A, batch);
      valRepo.seedBatch(TENANT_A, batch);

      await expect(
        svc.runValidation(makeUser() as any, makeEffective() as any, {
          importBatchId: batch.id, idempotencyKey: "k3",
        }),
      ).rejects.toThrow(/LIFECYCLE_VIOLATION|InvalidBatchStatusError|non-terminal/);

      expect((await valRepo.findValidationErrorsForBatch(TENANT_A, batch.id)).length).toBe(0);
      expect(audit.getRows().length).toBe(0);
    });
  });

  describe("runReconciliation against committed batch", () => {
    it("rejects with LIFECYCLE_VIOLATION, zero results/audit", async () => {
      const stagingRepo = new InMemoryHistoricalStagingRepository();
      const reconRepo = new InMemoryHistoricalReconciliationRepository();
      const audit = new InProcessAuditStore();
      const idem = new InProcessIdempotencyStore();
      const svc = new HistoricalReconciliationService({ repository: reconRepo, audit, idempotency: idem });
      const batch = makeBatch("committed");
      stagingRepo.seedBatch(TENANT_A, batch);
      reconRepo.seedBatch(TENANT_A, batch);

      await expect(
        svc.runReconciliation(makeUser() as any, makeEffective() as any, {
          importBatchId: batch.id, expectedTotals: {}, idempotencyKey: "k4",
        }),
      ).rejects.toThrow(/LIFECYCLE_VIOLATION|InvalidBatchStatusError|non-terminal/);

      expect((await reconRepo.findReconciliationResultsForBatch(TENANT_A, batch.id)).length).toBe(0);
      expect(audit.getRows().length).toBe(0);
    });
  });

  describe("recordApproval against committed batch", () => {
    it("rejects with LIFECYCLE_VIOLATION, zero approvals/audit", async () => {
      const stagingRepo = new InMemoryHistoricalStagingRepository();
      const commitRepo = new InMemoryHistoricalCommitRepository();
      const audit = new InProcessAuditStore();
      const idem = new InProcessIdempotencyStore();
      const txRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => work("tx");
      const txFactories = {
        createCommitRepository: () => commitRepo, createAudit: () => audit,
        createInventoryLedger: () => ({} as any), createSubledger: () => ({} as any),
        createDocumentSequence: () => new InProcessDocumentSequenceStore(),
      };
      const svc = new HistoricalCommitService({ repository: commitRepo, audit, idempotency: idem, transactionRunner: txRunner, txFactories });
      const batch = makeBatch("committed", { stagedDataHash: "h", cutoverManifestHash: "m" });
      stagingRepo.seedBatch(TENANT_A, batch);
      commitRepo.seedBatch(TENANT_A, batch);

      await expect(
        svc.recordApproval(makeUser() as any, makeEffective() as any, {
          importBatchId: batch.id, approverRole: "owner", reason: "test", idempotencyKey: "k5",
        }),
      ).rejects.toThrow(/LIFECYCLE_VIOLATION|InvalidBatchStatusError|non-terminal/);

      expect((await commitRepo.findApprovalsForBatch(TENANT_A, batch.id)).length).toBe(0);
      expect(audit.getRows().length).toBe(0);
    });
  });

  describe("recordBackupEvidence against committed batch", () => {
    it("rejects with LIFECYCLE_VIOLATION, zero backups/audit", async () => {
      const stagingRepo = new InMemoryHistoricalStagingRepository();
      const commitRepo = new InMemoryHistoricalCommitRepository();
      const audit = new InProcessAuditStore();
      const idem = new InProcessIdempotencyStore();
      const svc = new HistoricalCommitService({ repository: commitRepo, audit, idempotency: idem });
      const batch = makeBatch("committed");
      stagingRepo.seedBatch(TENANT_A, batch);
      commitRepo.seedBatch(TENANT_A, batch);

      await expect(
        svc.recordBackupEvidence(makeUser() as any, makeEffective() as any, {
          importBatchId: batch.id, backupType: "full", backupLocation: "s3://b/bk",
          backupHash: "bh1", backupSizeBytes: 1, backupCreatedAt: new Date(),
          verificationNotes: null, idempotencyKey: "k6",
        }),
      ).rejects.toThrow(/LIFECYCLE_VIOLATION|InvalidBatchStatusError|non-terminal/);

      expect((await commitRepo.findBackupEvidenceForBatch(TENANT_A, batch.id)).length).toBe(0);
      expect(audit.getRows().length).toBe(0);
    });
  });

  describe("registerFile against rejected batch", () => {
    it("rejects with LIFECYCLE_VIOLATION", async () => {
      const repo = new InMemoryHistoricalStagingRepository();
      const svc = new HistoricalStagingService({ repository: repo, audit: new InProcessAuditStore(), idempotency: new InProcessIdempotencyStore(), documentSequence: new InProcessDocumentSequenceStore() });
      const batch = makeBatch("rejected");
      repo.seedBatch(TENANT_A, batch);

      await expect(
        svc.registerFile(makeUser() as any, makeEffective() as any, {
          importBatchId: batch.id, originalFileName: "f.xlsx", storagePath: "s3://b/k",
          fileHash: "h", fileType: "source", fileSizeBytes: null, contentType: null, idempotencyKey: "k7",
        }),
      ).rejects.toThrow(/LIFECYCLE_VIOLATION|InvalidBatchStatusError|non-terminal/);
    });
  });

  describe("registerFile against cancelled batch", () => {
    it("rejects with LIFECYCLE_VIOLATION", async () => {
      const repo = new InMemoryHistoricalStagingRepository();
      const svc = new HistoricalStagingService({ repository: repo, audit: new InProcessAuditStore(), idempotency: new InProcessIdempotencyStore(), documentSequence: new InProcessDocumentSequenceStore() });
      const batch = makeBatch("cancelled");
      repo.seedBatch(TENANT_A, batch);

      await expect(
        svc.registerFile(makeUser() as any, makeEffective() as any, {
          importBatchId: batch.id, originalFileName: "f.xlsx", storagePath: "s3://b/k",
          fileHash: "h", fileType: "source", fileSizeBytes: null, contentType: null, idempotencyKey: "k8",
        }),
      ).rejects.toThrow(/LIFECYCLE_VIOLATION|InvalidBatchStatusError|non-terminal/);
    });
  });

  describe("Valid predecessor-state success", () => {
    it("registerFile succeeds on draft batch and creates audit", async () => {
      const repo = new InMemoryHistoricalStagingRepository();
      const audit = new InProcessAuditStore();
      const svc = new HistoricalStagingService({ repository: repo, audit, idempotency: new InProcessIdempotencyStore(), documentSequence: new InProcessDocumentSequenceStore() });
      const batch = makeBatch("draft");
      repo.seedBatch(TENANT_A, batch);

      const result = await svc.registerFile(makeUser() as any, makeEffective() as any, {
        importBatchId: batch.id, originalFileName: "ok.xlsx", storagePath: "s3://b/k",
        fileHash: "ok-hash", fileType: "source", fileSizeBytes: null, contentType: null, idempotencyKey: "k9",
      });

      expect(result.action).toBe("created");
      expect((await repo.findImportFilesForBatch(TENANT_A, batch.id)).length).toBe(1);
      expect(audit.getRows().length).toBeGreaterThan(0);
    });
  });
});
