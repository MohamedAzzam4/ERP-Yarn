/**
 * WP-08-01F DEFECT 4 — Service-level lifecycle guard tests.
 *
 * Tests that every corrected service method rejects invalid lifecycle states
 * with exact zero-effect proof. Uses in-memory repos for fast unit tests;
 * real PostgreSQL proofs live in wp-08-01f-postgres-zero-effect.test.ts.
 *
 * Contract 08 §9 — authoritative state transitions.
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
const ACCOUNTANT_USER = "00000000-0000-0000-0000-000000081f12";

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
    validationStatus: "passed",
    reconciliationStatus: "matched",
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

function makeCommitServiceDeps() {
  const commitRepo = new InMemoryHistoricalCommitRepository();
  const audit = new InProcessAuditStore();
  const idem = new InProcessIdempotencyStore();
  const txRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => work("tx");
  const txFactories = {
    createCommitRepository: () => commitRepo, createAudit: () => audit,
    createInventoryLedger: () => ({} as any), createSubledger: () => ({} as any),
    createDocumentSequence: () => new InProcessDocumentSequenceStore(),
  };
  return { commitRepo, audit, idem, txRunner, txFactories };
}

describe("WP-08-01F DEFECT 4 — Service lifecycle guards (zero-effect)", () => {
  // -------------------------------------------------------------------------
  // registerFile — only preparation states (draft/source_uploaded/normalized/staged)
  // -------------------------------------------------------------------------
  describe("registerFile against committed batch", () => {
    it("rejects with InvalidBatchStatusError, zero files/audit/idempotency", async () => {
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
      ).rejects.toThrow(/LIFECYCLE_VIOLATION|InvalidBatchStatusError|non-terminal|Allowed statuses|status.*must be/);

      expect((await repo.findImportFilesForBatch(TENANT_A, batch.id)).length).toBe(0);
      expect(audit.getRows().length).toBe(0);
      expect(idem.getAllRecords().length).toBe(0);
    });
  });

  describe("registerFile against rejected batch", () => {
    it("rejects with InvalidBatchStatusError", async () => {
      const repo = new InMemoryHistoricalStagingRepository();
      const svc = new HistoricalStagingService({ repository: repo, audit: new InProcessAuditStore(), idempotency: new InProcessIdempotencyStore(), documentSequence: new InProcessDocumentSequenceStore() });
      const batch = makeBatch("rejected");
      repo.seedBatch(TENANT_A, batch);

      await expect(
        svc.registerFile(makeUser() as any, makeEffective() as any, {
          importBatchId: batch.id, originalFileName: "f.xlsx", storagePath: "s3://b/k",
          fileHash: "h", fileType: "source", fileSizeBytes: null, contentType: null, idempotencyKey: "k7",
        }),
      ).rejects.toThrow(/LIFECYCLE_VIOLATION|InvalidBatchStatusError|Allowed statuses|status.*must be/);
    });
  });

  describe("registerFile against cancelled batch", () => {
    it("rejects with InvalidBatchStatusError", async () => {
      const repo = new InMemoryHistoricalStagingRepository();
      const svc = new HistoricalStagingService({ repository: repo, audit: new InProcessAuditStore(), idempotency: new InProcessIdempotencyStore(), documentSequence: new InProcessDocumentSequenceStore() });
      const batch = makeBatch("cancelled");
      repo.seedBatch(TENANT_A, batch);

      await expect(
        svc.registerFile(makeUser() as any, makeEffective() as any, {
          importBatchId: batch.id, originalFileName: "f.xlsx", storagePath: "s3://b/k",
          fileHash: "h", fileType: "source", fileSizeBytes: null, contentType: null, idempotencyKey: "k8",
        }),
      ).rejects.toThrow(/LIFECYCLE_VIOLATION|InvalidBatchStatusError|Allowed statuses|status.*must be/);
    });
  });

  // -------------------------------------------------------------------------
  // insertStagingRow — only preparation states
  // -------------------------------------------------------------------------
  describe("insertStagingRow against committed batch", () => {
    it("rejects with InvalidBatchStatusError, zero rows/audit", async () => {
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
      ).rejects.toThrow(/LIFECYCLE_VIOLATION|InvalidBatchStatusError|Allowed statuses|status.*must be/);

      expect((await repo.findStagingRowsForBatch(TENANT_A, batch.id)).length).toBe(0);
      expect(audit.getRows().length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // runValidation — only staged or validation_complete
  // -------------------------------------------------------------------------
  describe("runValidation against committed batch", () => {
    it("rejects with InvalidBatchStatusError, zero findings/audit", async () => {
      const stagingRepo = new InMemoryHistoricalStagingRepository();
      const valRepo = new InMemoryHistoricalValidationRepository();
      const audit = new InProcessAuditStore();
      const idem = new InProcessIdempotencyStore();
      const svc = new HistoricalValidationService({ repository: valRepo, audit, idempotency: idem, transactionRunner: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => work({}), createRepository: () => valRepo, createAudit: () => audit, createIdempotency: () => idem });
      const batch = makeBatch("committed", { stagedRowCount: 5 });
      stagingRepo.seedBatch(TENANT_A, batch);
      valRepo.seedBatch(TENANT_A, batch);

      await expect(
        svc.runValidation(makeUser() as any, makeEffective() as any, {
          importBatchId: batch.id, idempotencyKey: "k3",
        }),
      ).rejects.toThrow(/LIFECYCLE_VIOLATION|InvalidBatchStatusError|Allowed statuses|status.*must be/);

      expect((await valRepo.findValidationErrorsForBatch(TENANT_A, batch.id)).length).toBe(0);
      expect(audit.getRows().length).toBe(0);
    });
  });

  describe("runValidation against committing batch", () => {
    it("rejects with InvalidBatchStatusError", async () => {
      const stagingRepo = new InMemoryHistoricalStagingRepository();
      const valRepo = new InMemoryHistoricalValidationRepository();
      const audit = new InProcessAuditStore();
      const idem = new InProcessIdempotencyStore();
      const svc = new HistoricalValidationService({ repository: valRepo, audit, idempotency: idem, transactionRunner: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => work({}), createRepository: () => valRepo, createAudit: () => audit, createIdempotency: () => idem });
      const batch = makeBatch("committing", { stagedRowCount: 5 });
      stagingRepo.seedBatch(TENANT_A, batch);
      valRepo.seedBatch(TENANT_A, batch);

      await expect(
        svc.runValidation(makeUser() as any, makeEffective() as any, {
          importBatchId: batch.id, idempotencyKey: "k3b",
        }),
      ).rejects.toThrow(/LIFECYCLE_VIOLATION|InvalidBatchStatusError|Allowed statuses|status.*must be/);
      expect(audit.getRows().length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // runReconciliation — only validation_complete, reconciliation_in_progress, review_required
  // -------------------------------------------------------------------------
  describe("runReconciliation against committed batch", () => {
    it("rejects with InvalidBatchStatusError, zero results/audit", async () => {
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
      ).rejects.toThrow(/LIFECYCLE_VIOLATION|InvalidBatchStatusError|Allowed statuses|status.*must be/);

      expect((await reconRepo.findReconciliationResultsForBatch(TENANT_A, batch.id)).length).toBe(0);
      expect(audit.getRows().length).toBe(0);
    });
  });

  describe("runReconciliation against pending_dual_approval batch (TASK 1.2)", () => {
    it("rejects — cannot mutate reconciliation evidence after approvals bound", async () => {
      const stagingRepo = new InMemoryHistoricalStagingRepository();
      const reconRepo = new InMemoryHistoricalReconciliationRepository();
      const audit = new InProcessAuditStore();
      const idem = new InProcessIdempotencyStore();
      const svc = new HistoricalReconciliationService({ repository: reconRepo, audit, idempotency: idem });
      const batch = makeBatch("pending_dual_approval");
      stagingRepo.seedBatch(TENANT_A, batch);
      reconRepo.seedBatch(TENANT_A, batch);

      await expect(
        svc.runReconciliation(makeUser() as any, makeEffective() as any, {
          importBatchId: batch.id, expectedTotals: {}, idempotencyKey: "k4b",
        }),
      ).rejects.toThrow(/LIFECYCLE_VIOLATION|InvalidBatchStatusError|Allowed statuses|status.*must be/);

      expect((await reconRepo.findReconciliationResultsForBatch(TENANT_A, batch.id)).length).toBe(0);
      expect(audit.getRows().length).toBe(0);
    });
  });

  describe("runReconciliation against approved_for_commit batch (TASK 1.2)", () => {
    it("rejects — cannot mutate reconciliation evidence after approval", async () => {
      const stagingRepo = new InMemoryHistoricalStagingRepository();
      const reconRepo = new InMemoryHistoricalReconciliationRepository();
      const audit = new InProcessAuditStore();
      const idem = new InProcessIdempotencyStore();
      const svc = new HistoricalReconciliationService({ repository: reconRepo, audit, idempotency: idem });
      const batch = makeBatch("approved_for_commit");
      stagingRepo.seedBatch(TENANT_A, batch);
      reconRepo.seedBatch(TENANT_A, batch);

      await expect(
        svc.runReconciliation(makeUser() as any, makeEffective() as any, {
          importBatchId: batch.id, expectedTotals: {}, idempotencyKey: "k4c",
        }),
      ).rejects.toThrow(/LIFECYCLE_VIOLATION|InvalidBatchStatusError|Allowed statuses|status.*must be/);
    });
  });

  // -------------------------------------------------------------------------
  // recordReviewDecision — only review_required with existing review items
  // -------------------------------------------------------------------------
  describe("recordReviewDecision against staged batch (TASK 1.3 — not allowed merely because staged)", () => {
    it("rejects — must be in review_required state", async () => {
      const stagingRepo = new InMemoryHistoricalStagingRepository();
      const reconRepo = new InMemoryHistoricalReconciliationRepository();
      const audit = new InProcessAuditStore();
      const idem = new InProcessIdempotencyStore();
      const svc = new HistoricalReconciliationService({ repository: reconRepo, audit, idempotency: idem });
      const batch = makeBatch("staged");
      stagingRepo.seedBatch(TENANT_A, batch);
      reconRepo.seedBatch(TENANT_A, batch);
      // Seed a review item — even with an item, the batch state must be review_required
      const reviewItem = reconRepo.seedReviewItem(TENANT_A, {
        importBatchId: batch.id, reviewReason: "test", status: "pending",
      });

      await expect(
        svc.recordReviewDecision(makeUser() as any, makeEffective() as any, {
          reviewItemId: reviewItem.id, decision: "accepted", decisionNotes: "ok", idempotencyKey: "kr1",
        }),
      ).rejects.toThrow(/LIFECYCLE_VIOLATION|InvalidBatchStatusError|Allowed statuses|status.*must be/);
      expect(audit.getRows().length).toBe(0);
    });
  });

  describe("recordReviewDecision against pending_dual_approval batch (TASK 1.3)", () => {
    it("rejects — review items already resolved", async () => {
      const reconRepo = new InMemoryHistoricalReconciliationRepository();
      const audit = new InProcessAuditStore();
      const idem = new InProcessIdempotencyStore();
      const svc = new HistoricalReconciliationService({ repository: reconRepo, audit, idempotency: idem });
      const batch = makeBatch("pending_dual_approval");
      reconRepo.seedBatch(TENANT_A, batch);
      const reviewItem = reconRepo.seedReviewItem(TENANT_A, {
        importBatchId: batch.id, reviewReason: "test", status: "pending",
      });

      await expect(
        svc.recordReviewDecision(makeUser() as any, makeEffective() as any, {
          reviewItemId: reviewItem.id, decision: "accepted", decisionNotes: "ok", idempotencyKey: "kr2",
        }),
      ).rejects.toThrow(/LIFECYCLE_VIOLATION|InvalidBatchStatusError|Allowed statuses|status.*must be/);
    });
  });

  // -------------------------------------------------------------------------
  // recordApproval — only pending_dual_approval or approved_for_commit
  // -------------------------------------------------------------------------
  describe("recordApproval against committed batch", () => {
    it("rejects with InvalidBatchStatusError, zero approvals/audit", async () => {
      const stagingRepo = new InMemoryHistoricalStagingRepository();
      const { commitRepo, audit, idem, txRunner, txFactories } = makeCommitServiceDeps();
      const svc = new HistoricalCommitService({ repository: commitRepo, audit, idempotency: idem, transactionRunner: txRunner, txFactories });
      const batch = makeBatch("committed", { stagedDataHash: "h", cutoverManifestHash: "m" });
      stagingRepo.seedBatch(TENANT_A, batch);
      commitRepo.seedBatch(TENANT_A, batch);

      await expect(
        svc.recordApproval(makeUser() as any, makeEffective() as any, {
          importBatchId: batch.id, approverRole: "owner", reason: "test", idempotencyKey: "k5",
        }),
      ).rejects.toThrow(/LIFECYCLE_VIOLATION|InvalidBatchStatusError|Allowed statuses|status.*must be/);

      expect((await commitRepo.findApprovalsForBatch(TENANT_A, batch.id)).length).toBe(0);
      expect(audit.getRows().length).toBe(0);
    });
  });

  describe("recordApproval against validation_complete batch (TASK 1.1)", () => {
    it("rejects — must reach pending_dual_approval state", async () => {
      const stagingRepo = new InMemoryHistoricalStagingRepository();
      const { commitRepo, audit, idem, txRunner, txFactories } = makeCommitServiceDeps();
      const svc = new HistoricalCommitService({ repository: commitRepo, audit, idempotency: idem, transactionRunner: txRunner, txFactories });
      const batch = makeBatch("validation_complete", { stagedDataHash: "h", cutoverManifestHash: "m" });
      stagingRepo.seedBatch(TENANT_A, batch);
      commitRepo.seedBatch(TENANT_A, batch);

      await expect(
        svc.recordApproval(makeUser() as any, makeEffective() as any, {
          importBatchId: batch.id, approverRole: "owner", reason: "test", idempotencyKey: "k5b",
        }),
      ).rejects.toThrow(/LIFECYCLE_VIOLATION|InvalidBatchStatusError|Allowed statuses|status.*must be/);
      expect((await commitRepo.findApprovalsForBatch(TENANT_A, batch.id)).length).toBe(0);
    });
  });

  describe("recordApproval against reconciliation_in_progress batch (TASK 1.1)", () => {
    it("rejects — must reach pending_dual_approval state", async () => {
      const stagingRepo = new InMemoryHistoricalStagingRepository();
      const { commitRepo, audit, idem, txRunner, txFactories } = makeCommitServiceDeps();
      const svc = new HistoricalCommitService({ repository: commitRepo, audit, idempotency: idem, transactionRunner: txRunner, txFactories });
      const batch = makeBatch("reconciliation_in_progress", { stagedDataHash: "h", cutoverManifestHash: "m" });
      stagingRepo.seedBatch(TENANT_A, batch);
      commitRepo.seedBatch(TENANT_A, batch);

      await expect(
        svc.recordApproval(makeUser() as any, makeEffective() as any, {
          importBatchId: batch.id, approverRole: "owner", reason: "test", idempotencyKey: "k5c",
        }),
      ).rejects.toThrow(/LIFECYCLE_VIOLATION|InvalidBatchStatusError|Allowed statuses|status.*must be/);
    });
  });

  describe("recordApproval against review_required batch (TASK 1.1)", () => {
    it("rejects — review items still unresolved", async () => {
      const stagingRepo = new InMemoryHistoricalStagingRepository();
      const { commitRepo, audit, idem, txRunner, txFactories } = makeCommitServiceDeps();
      const svc = new HistoricalCommitService({ repository: commitRepo, audit, idempotency: idem, transactionRunner: txRunner, txFactories });
      const batch = makeBatch("review_required", { stagedDataHash: "h", cutoverManifestHash: "m" });
      stagingRepo.seedBatch(TENANT_A, batch);
      commitRepo.seedBatch(TENANT_A, batch);

      await expect(
        svc.recordApproval(makeUser() as any, makeEffective() as any, {
          importBatchId: batch.id, approverRole: "owner", reason: "test", idempotencyKey: "k5d",
        }),
      ).rejects.toThrow(/LIFECYCLE_VIOLATION|InvalidBatchStatusError|Allowed statuses|status.*must be/);
    });
  });

  describe("recordApproval rejects when validationStatus is null (TASK 1.1)", () => {
    it("does not store approvals with validationStatus=unknown", async () => {
      const stagingRepo = new InMemoryHistoricalStagingRepository();
      const { commitRepo, audit, idem, txRunner, txFactories } = makeCommitServiceDeps();
      const svc = new HistoricalCommitService({ repository: commitRepo, audit, idempotency: idem, transactionRunner: txRunner, txFactories });
      const batch = makeBatch("pending_dual_approval", {
        stagedDataHash: "h", cutoverManifestHash: "m",
        validationStatus: null, reconciliationStatus: null,
      });
      stagingRepo.seedBatch(TENANT_A, batch);
      commitRepo.seedBatch(TENANT_A, batch);

      await expect(
        svc.recordApproval(makeUser() as any, makeEffective() as any, {
          importBatchId: batch.id, approverRole: "owner", reason: "test", idempotencyKey: "k5e",
        }),
      ).rejects.toThrow(/validationStatus|LIFECYCLE_VIOLATION|Allowed statuses/);
      expect((await commitRepo.findApprovalsForBatch(TENANT_A, batch.id)).length).toBe(0);
    });
  });

  describe("recordApproval rejects when validationStatus='unknown' (TASK 1.1)", () => {
    it("does not store approvals with validationStatus=unknown", async () => {
      const stagingRepo = new InMemoryHistoricalStagingRepository();
      const { commitRepo, audit, idem, txRunner, txFactories } = makeCommitServiceDeps();
      const svc = new HistoricalCommitService({ repository: commitRepo, audit, idempotency: idem, transactionRunner: txRunner, txFactories });
      const batch = makeBatch("pending_dual_approval", {
        stagedDataHash: "h", cutoverManifestHash: "m",
        validationStatus: "unknown", reconciliationStatus: "unknown",
      });
      stagingRepo.seedBatch(TENANT_A, batch);
      commitRepo.seedBatch(TENANT_A, batch);

      await expect(
        svc.recordApproval(makeUser() as any, makeEffective() as any, {
          importBatchId: batch.id, approverRole: "owner", reason: "test", idempotencyKey: "k5f",
        }),
      ).rejects.toThrow(/validationStatus|LIFECYCLE_VIOLATION|Allowed statuses/);
    });
  });

  // -------------------------------------------------------------------------
  // recordBackupEvidence — only review_required, pending_dual_approval, approved_for_commit
  // -------------------------------------------------------------------------
  describe("recordBackupEvidence against committed batch", () => {
    it("rejects with InvalidBatchStatusError, zero backups/audit", async () => {
      const stagingRepo = new InMemoryHistoricalStagingRepository();
      const { commitRepo, audit, idem } = makeCommitServiceDeps();
      const svc = new HistoricalCommitService({ repository: commitRepo, audit, idempotency: idem, transactionRunner: async <T>(w: (tx: unknown) => Promise<T>) => w("tx"), txFactories: {} as any });
      const batch = makeBatch("committed");
      stagingRepo.seedBatch(TENANT_A, batch);
      commitRepo.seedBatch(TENANT_A, batch);

      await expect(
        svc.recordBackupEvidence(makeUser() as any, makeEffective() as any, {
          importBatchId: batch.id, backupType: "full", backupLocation: "s3://b/bk",
          backupHash: "bh1", backupSizeBytes: 1, backupCreatedAt: new Date(),
          verificationNotes: null, idempotencyKey: "k6",
        }),
      ).rejects.toThrow(/LIFECYCLE_VIOLATION|InvalidBatchStatusError|Allowed statuses|status.*must be/);

      expect((await commitRepo.findBackupEvidenceForBatch(TENANT_A, batch.id)).length).toBe(0);
      expect(audit.getRows().length).toBe(0);
    });
  });

  describe("recordBackupEvidence against validation_complete batch (TASK 1.5)", () => {
    it("rejects — recon report not final yet", async () => {
      const stagingRepo = new InMemoryHistoricalStagingRepository();
      const { commitRepo, audit, idem } = makeCommitServiceDeps();
      const svc = new HistoricalCommitService({ repository: commitRepo, audit, idempotency: idem, transactionRunner: async <T>(w: (tx: unknown) => Promise<T>) => w("tx"), txFactories: {} as any });
      const batch = makeBatch("validation_complete");
      stagingRepo.seedBatch(TENANT_A, batch);
      commitRepo.seedBatch(TENANT_A, batch);

      await expect(
        svc.recordBackupEvidence(makeUser() as any, makeEffective() as any, {
          importBatchId: batch.id, backupType: "full", backupLocation: "s3://b/bk",
          backupHash: "bh1", backupSizeBytes: 1, backupCreatedAt: new Date(),
          verificationNotes: null, idempotencyKey: "k6b",
        }),
      ).rejects.toThrow(/LIFECYCLE_VIOLATION|InvalidBatchStatusError|Allowed statuses|status.*must be/);
    });
  });

  // -------------------------------------------------------------------------
  // commitBatch — only approved_for_commit
  // -------------------------------------------------------------------------
  describe("commitBatch against committed batch (idempotent replay allowed)", () => {
    it("allows replay when batch already committed", async () => {
      const stagingRepo = new InMemoryHistoricalStagingRepository();
      const { commitRepo, audit, idem, txRunner, txFactories } = makeCommitServiceDeps();
      const svc = new HistoricalCommitService({ repository: commitRepo, audit, idempotency: idem, transactionRunner: txRunner, txFactories });
      const batch = makeBatch("committed", {
        committedAt: new Date("2024-01-01"),
        commitEffectCounts: { inventory_movements: 1 },
        stagedDataHash: "h", cutoverManifestHash: "m",
      });
      stagingRepo.seedBatch(TENANT_A, batch);
      commitRepo.seedBatch(TENANT_A, batch);
      // Seed prior approvals so the replay path doesn't fail approval check
      commitRepo.seedApproval(TENANT_A, { importBatchId: batch.id, approverRole: "owner", approverUserId: OWNER_USER, stagedDataHash: "h", cutoverManifestHash: "m" });
      commitRepo.seedApproval(TENANT_A, { importBatchId: batch.id, approverRole: "accountant", approverUserId: ACCOUNTANT_USER, stagedDataHash: "h", cutoverManifestHash: "m" });
      commitRepo.seedBackupEvidence(TENANT_A, { importBatchId: batch.id, backupType: "full", backupLocation: "s3://b/bk", backupHash: "bh", backupSizeBytes: 1, verifiedBy: OWNER_USER });

      const result = await svc.commitBatch(makeUser() as any, makeEffective("owner") as any, {
        importBatchId: batch.id, idempotencyKey: "kcommit-replay",
      });
      expect(result.action).toBe("replayed");
    });
  });

  describe("commitBatch against pending_dual_approval batch (no approvals)", () => {
    it("rejects — IncompleteDualApprovalError takes precedence over status", async () => {
      const stagingRepo = new InMemoryHistoricalStagingRepository();
      const { commitRepo, audit, idem, txRunner, txFactories } = makeCommitServiceDeps();
      const svc = new HistoricalCommitService({ repository: commitRepo, audit, idempotency: idem, transactionRunner: txRunner, txFactories });
      const batch = makeBatch("pending_dual_approval");
      stagingRepo.seedBatch(TENANT_A, batch);
      commitRepo.seedBatch(TENANT_A, batch);

      // With no approvals recorded, commit gives the more specific
      // IncompleteDualApprovalError before the status guard fires.
      await expect(
        svc.commitBatch(makeUser() as any, makeEffective("owner") as any, {
          importBatchId: batch.id, idempotencyKey: "kcommit-bad",
        }),
      ).rejects.toThrow(/IncompleteDualApproval|requires both|LIFECYCLE_VIOLATION|InvalidBatchStatusError|Allowed statuses|status.*must be/);
    });
  });

  // -------------------------------------------------------------------------
  // Valid predecessor-state success
  // -------------------------------------------------------------------------
  describe("Valid predecessor-state success", () => {
    it("registerFile succeeds on draft batch and creates audit", async () => {
      const repo = new InMemoryHistoricalStagingRepository();
      const audit = new InProcessAuditStore();
      const idem = new InProcessIdempotencyStore();
      const docSeq = new InProcessDocumentSequenceStore();
      const svc = new HistoricalStagingService({ repository: repo, audit, idempotency: idem, documentSequence: docSeq });
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

    it("recordApproval succeeds on pending_dual_approval batch with bound statuses", async () => {
      const stagingRepo = new InMemoryHistoricalStagingRepository();
      const { commitRepo, audit, idem, txRunner, txFactories } = makeCommitServiceDeps();
      const svc = new HistoricalCommitService({ repository: commitRepo, audit, idempotency: idem, transactionRunner: txRunner, txFactories });
      const batch = makeBatch("pending_dual_approval", {
        stagedDataHash: "h", cutoverManifestHash: "m",
        validationStatus: "passed", reconciliationStatus: "matched",
      });
      stagingRepo.seedBatch(TENANT_A, batch);
      commitRepo.seedBatch(TENANT_A, batch);

      const result = await svc.recordApproval(
        makeUser(OWNER_USER) as any, makeEffective("owner") as any,
        { importBatchId: batch.id, approverRole: "owner", reason: "test", idempotencyKey: "k-approve-owner" },
      );
      expect(result.action).toBe("recorded");
      expect(result.approverRole).toBe("owner");
      const approvals = await commitRepo.findApprovalsForBatch(TENANT_A, batch.id);
      expect(approvals.length).toBe(1);
      expect(approvals[0]!.validationStatus).toBe("passed");
      expect(approvals[0]!.reconciliationStatus).toBe("matched");
    });

    it("recordBackupEvidence succeeds on approved_for_commit batch", async () => {
      const stagingRepo = new InMemoryHistoricalStagingRepository();
      const { commitRepo, audit, idem } = makeCommitServiceDeps();
      const svc = new HistoricalCommitService({ repository: commitRepo, audit, idempotency: idem, transactionRunner: async <T>(w: (tx: unknown) => Promise<T>) => w("tx"), txFactories: {} as any });
      const batch = makeBatch("approved_for_commit");
      stagingRepo.seedBatch(TENANT_A, batch);
      commitRepo.seedBatch(TENANT_A, batch);

      const result = await svc.recordBackupEvidence(makeUser() as any, makeEffective() as any, {
        importBatchId: batch.id, backupType: "full", backupLocation: "s3://b/bk",
        backupHash: "bh-ok", backupSizeBytes: 1, backupCreatedAt: new Date(),
        verificationNotes: null, idempotencyKey: "k-backup-ok",
      });
      expect(result.action).toBe("recorded");
      expect((await commitRepo.findBackupEvidenceForBatch(TENANT_A, batch.id)).length).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Idempotent replay after state change
  // -------------------------------------------------------------------------
  describe("Idempotency replay after service changes batch state", () => {
    it("recordApproval replay returns existing approval without creating duplicate", async () => {
      const stagingRepo = new InMemoryHistoricalStagingRepository();
      const { commitRepo, audit, idem, txRunner, txFactories } = makeCommitServiceDeps();
      const svc = new HistoricalCommitService({ repository: commitRepo, audit, idempotency: idem, transactionRunner: txRunner, txFactories });
      const batch = makeBatch("pending_dual_approval", {
        stagedDataHash: "h", cutoverManifestHash: "m",
        validationStatus: "passed", reconciliationStatus: "matched",
      });
      stagingRepo.seedBatch(TENANT_A, batch);
      commitRepo.seedBatch(TENANT_A, batch);

      const r1 = await svc.recordApproval(
        makeUser(OWNER_USER) as any, makeEffective("owner") as any,
        { importBatchId: batch.id, approverRole: "owner", reason: "first", idempotencyKey: "k-replay" },
      );
      expect(r1.action).toBe("recorded");

      // Second call with SAME idempotency key — should replay, not duplicate.
      const r2 = await svc.recordApproval(
        makeUser(OWNER_USER) as any, makeEffective("owner") as any,
        { importBatchId: batch.id, approverRole: "owner", reason: "second", idempotencyKey: "k-replay" },
      );
      expect(r2.action).toBe("replayed");

      const approvals = await commitRepo.findApprovalsForBatch(TENANT_A, batch.id);
      expect(approvals.length).toBe(1);
    });
  });
});
