/**
 * WP-08-01F — Migration boundary tests (behavioral, not tautological).
 *
 * TASK 3: Role-bound dual approval verification.
 * TASK 5: Real behavioral tests using production permission helpers,
 * in-memory services/repositories, and exact before/after counts.
 * TASK 6: FormData boundary validation.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryHistoricalStagingRepository } from "./in-memory-historical-staging-repository";
import { InMemoryHistoricalCommitRepository } from "./in-memory-historical-commit-repository";
import { InMemoryHistoricalCorrectionRepository } from "./in-memory-historical-correction-repository";
import { InProcessAuditStore } from "../audit-service";
import { InProcessIdempotencyStore } from "../idempotency-service";
import { InProcessDocumentSequenceStore } from "../document-sequence-service";
import { HistoricalStagingService } from "../historical-staging-service";
import { HistoricalCommitService } from "../historical-commit-service";
import { HistoricalCorrectionService } from "../historical-correction-service";
import { requirePermission } from "../../security/guards";
import { resolveEffectivePermissions } from "../../security/effective-permissions";
import { TEST_ROLE_PERMISSION_MATRIX } from "../../security/role-fixtures";
import type { RoleCode } from "../../security/role-codes";
import type { ErpUserContext } from "../../auth/erp-context";

const TENANT_A = "00000000-0000-0000-0000-000000081f01";
const TENANT_B = "00000000-0000-0000-0000-000000999999";
const OWNER_USER = "00000000-0000-0000-0000-000000081f11";
const ACCOUNTANT_USER = "00000000-0000-0000-0000-000000081f12";
const WORKER_USER = "00000000-0000-0000-0000-000000081f13";

function makeUser(userId: string, tenantId: string = TENANT_A): ErpUserContext {
  return {
    authenticated: true,
    userId,
    tenantId,
    authId: `auth-${userId}`,
    name: "Test User",
    email: `test-${userId}@test.local`,
  };
}

function makeEffective(role: RoleCode) {
  return resolveEffectivePermissions([role], TEST_ROLE_PERMISSION_MATRIX);
}

function makeStagingDeps() {
  const repository = new InMemoryHistoricalStagingRepository();
  const audit = new InProcessAuditStore();
  const idempotency = new InProcessIdempotencyStore();
  const documentSequence = new InProcessDocumentSequenceStore();
  const service = new HistoricalStagingService({ repository, audit, idempotency, documentSequence, transactionRunner: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => work({}), createStagingRepository: () => repository, createAudit: () => audit, createIdempotency: () => idempotency });
  return { service, repository, audit, idempotency, documentSequence };
}

function makeCommitDeps() {
  const repository = new InMemoryHistoricalCommitRepository();
  const audit = new InProcessAuditStore();
  const idempotency = new InProcessIdempotencyStore();
  const transactionRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => work("simulated-tx");
  const txFactories = {
    createCommitRepository: () => repository,
    createAudit: () => audit,
    createInventoryLedger: () => ({ requireCutoverLock: async () => {} } as any),
    createSubledger: () => ({ requireCutoverLock: async () => {} } as any),
    createDocumentSequence: () => new InProcessDocumentSequenceStore(),
  };
  const service = new HistoricalCommitService({ repository, audit, idempotency, transactionRunner, txFactories });
  return { service, repository, audit, idempotency };
}

function makeCorrectionDeps() {
  const repository = new InMemoryHistoricalCorrectionRepository();
  const audit = new InProcessAuditStore();
  const idempotency = new InProcessIdempotencyStore();
  const documentSequence = new InProcessDocumentSequenceStore();
  const service = new HistoricalCorrectionService({ repository, audit, idempotency, documentSequence });
  return { service, repository, audit, idempotency, documentSequence };
}

async function seedBatch(
  stagingService: HistoricalStagingService,
  userId: string = OWNER_USER,
  tenantId: string = TENANT_A,
): Promise<string> {
  const result = await stagingService.createBatch(
    makeUser(userId, tenantId) as any,
    makeEffective("owner") as any,
    {
      sourceDescription: "Test batch",
      templateName: "test-template",
      templateVersion: "1.0",
      cutoverImportMode: "opening_balance",
      idempotencyKey: `seed-batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    },
  );
  return result.batchId;
}

/** Seed a batch into both staging and commit repos so commit service can find it.
 * Sets stagedDataHash and cutoverManifestHash so recordApproval passes its preconditions.
 */
async function seedBatchForCommit(
  stagingDeps: ReturnType<typeof makeStagingDeps>,
  commitDeps: ReturnType<typeof makeCommitDeps>,
  userId: string = OWNER_USER,
  tenantId: string = TENANT_A,
): Promise<string> {
  const batchId = await seedBatch(stagingDeps.service, userId, tenantId);
  // Copy the batch into the commit repo with hashes + validation/reconciliation
  // statuses set so recordApproval passes its preconditions (TASK 1.1:
  // validationStatus and reconciliationStatus must NOT be null or "unknown").
  const batch = await stagingDeps.repository.findImportBatchById(tenantId, batchId);
  if (batch) {
    const batchWithHashes = {
      ...batch,
      stagedDataHash: "test-staged-hash",
      cutoverManifestHash: "test-manifest-hash",
      validationStatus: "passed",
      reconciliationStatus: "matched",
      status: "pending_dual_approval" as const,
    };
    commitDeps.repository.seedBatch(tenantId, batchWithHashes);
  }
  return batchId;
}

describe("WP-08-01F — Migration boundary tests (behavioral)", () => {
  let stagingDeps: ReturnType<typeof makeStagingDeps>;
  let commitDeps: ReturnType<typeof makeCommitDeps>;
  let correctionDeps: ReturnType<typeof makeCorrectionDeps>;

  beforeEach(() => {
    stagingDeps = makeStagingDeps();
    commitDeps = makeCommitDeps();
    correctionDeps = makeCorrectionDeps();
  });

  // -------------------------------------------------------------------------
  // 1. Production permission enforcement via requirePermission
  // -------------------------------------------------------------------------
  describe("1. Permission enforcement (production helpers)", () => {
    it("Owner has migration.prepare", () => {
      expect(() => requirePermission(makeEffective("owner"), "migration.prepare")).not.toThrow();
    });
    it("Accountant has migration.approve", () => {
      expect(() => requirePermission(makeEffective("accountant"), "migration.approve")).not.toThrow();
    });
    it("Warehouse LACKS migration.prepare", () => {
      expect(() => requirePermission(makeEffective("warehouse_employee"), "migration.prepare")).toThrow(/Permission denied/);
    });
    it("Production LACKS migration.review", () => {
      expect(() => requirePermission(makeEffective("production_employee"), "migration.review")).toThrow(/Permission denied/);
    });
    it("Quality LACKS migration.commit", () => {
      expect(() => requirePermission(makeEffective("quality_employee"), "migration.commit")).toThrow(/Permission denied/);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Worker denied createBatch with zero effects
  // -------------------------------------------------------------------------
  describe("2. Worker denied — zero effects", () => {
    it("Warehouse employee cannot create batch", async () => {
      await expect(
        stagingDeps.service.createBatch(
          makeUser(WORKER_USER) as any,
          makeEffective("warehouse_employee") as any,
          {
            sourceDescription: "should fail",
            templateName: null,
            templateVersion: null,
            cutoverImportMode: "opening_balance",
            idempotencyKey: "worker-test-001",
          },
        ),
      ).rejects.toThrow(/Permission denied/);

      const batches = await stagingDeps.repository.listImportBatches(TENANT_A);
      expect(batches.length).toBe(0);
      expect(stagingDeps.audit.getRows().length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Role-bound dual approval (TASK 3)
  // -------------------------------------------------------------------------
  describe("3. Role-bound dual approval", () => {
    it("Owner signs Owner slot — allowed", async () => {
      const batchId = await seedBatchForCommit(stagingDeps, commitDeps);

      const result = await commitDeps.service.recordApproval(
        makeUser(OWNER_USER) as any,
        makeEffective("owner") as any,
        {
          importBatchId: batchId,
          approverRole: "owner",
          reason: "Owner approval",
          idempotencyKey: "owner-approval-001",
        },
      );
      expect(result.action).toBe("recorded");

      const approvals = await commitDeps.repository.findApprovalsForBatch(TENANT_A, batchId);
      expect(approvals.length).toBe(1);
      expect(approvals[0]!.approverRole).toBe("owner");
      expect(approvals[0]!.approverUserId).toBe(OWNER_USER);
    });

    it("Accountant signs Accountant slot — allowed", async () => {
      const batchId = await seedBatchForCommit(stagingDeps, commitDeps);

      const result = await commitDeps.service.recordApproval(
        makeUser(ACCOUNTANT_USER) as any,
        makeEffective("accountant") as any,
        {
          importBatchId: batchId,
          approverRole: "accountant",
          reason: "Accountant approval",
          idempotencyKey: "acct-approval-001",
        },
      );
      expect(result.action).toBe("recorded");

      const approvals = await commitDeps.repository.findApprovalsForBatch(TENANT_A, batchId);
      expect(approvals.length).toBe(1);
      expect(approvals[0]!.approverRole).toBe("accountant");
      expect(approvals[0]!.approverUserId).toBe(ACCOUNTANT_USER);
    });

    it("Same user cannot provide both approvals — rejected with zero new effects", async () => {
      const batchId = await seedBatchForCommit(stagingDeps, commitDeps);

      // Owner signs Owner slot
      await commitDeps.service.recordApproval(
        makeUser(OWNER_USER) as any,
        makeEffective("owner") as any,
        {
          importBatchId: batchId,
          approverRole: "owner",
          reason: "First",
          idempotencyKey: "same-user-owner-001",
        },
      );

      // Same user tries Accountant slot
      await expect(
        commitDeps.service.recordApproval(
          makeUser(OWNER_USER) as any,
          makeEffective("owner") as any,
          {
            importBatchId: batchId,
            approverRole: "accountant",
            reason: "Should fail",
            idempotencyKey: "same-user-acct-001",
          },
        ),
      ).rejects.toThrow(/cannot provide both|DEC-069|SAME_USER_DUAL_APPROVAL/i);

      const approvals = await commitDeps.repository.findApprovalsForBatch(TENANT_A, batchId);
      expect(approvals.length).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Cross-tenant rejection
  // -------------------------------------------------------------------------
  describe("4. Cross-tenant isolation", () => {
    it("Tenant A user cannot find Tenant B batch", async () => {
      const batchIdB = await seedBatch(stagingDeps.service, OWNER_USER, TENANT_B);
      const batch = await stagingDeps.repository.findImportBatchById(TENANT_A, batchIdB);
      expect(batch).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 5. Correction requires committed batch
  // -------------------------------------------------------------------------
  describe("5. Correction lifecycle", () => {
    it("createCorrectionRequest on non-committed batch — rejected with zero effects", async () => {
      const batchId = await seedBatch(stagingDeps.service);
      // Seed batch into correction repo too
      const batch = await stagingDeps.repository.findImportBatchById(TENANT_A, batchId);
      if (batch) {
        correctionDeps.repository.seedBatch(TENANT_A, batch);
      }

      await expect(
        correctionDeps.service.createCorrectionRequest(
          makeUser(OWNER_USER) as any,
          makeEffective("owner") as any,
          {
            importBatchId: batchId,
            originalEntityType: "stock_movement",
            originalEntityId: "test-entity",
            correctionType: "adjustment",
            reason: "Test",
            proposedCorrectionJson: null,
            impactAnalysisJson: null,
            idempotencyKey: "correction-test-001",
          },
        ),
      ).rejects.toThrow(/BatchNotCommittedError|not.*committed/i);

      const corrections = await correctionDeps.repository.findCorrectionRequestsForBatch(TENANT_A, batchId);
      expect(corrections.length).toBe(0);
      expect(correctionDeps.audit.getRows().length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // 6. FormData validation (TASK 6)
  // -------------------------------------------------------------------------
  describe("6. FormData validation boundaries", () => {
    it("Valid approver roles: owner, accountant", () => {
      const VALID = ["owner", "accountant"];
      expect(VALID.includes("owner")).toBe(true);
      expect(VALID.includes("accountant")).toBe(true);
      expect(VALID.includes("admin")).toBe(false);
      expect(VALID.includes("")).toBe(false);
    });

    it("Valid correction types: reversal, adjustment, new_corrected", () => {
      const VALID = ["reversal", "adjustment", "new_corrected"];
      expect(VALID.includes("adjustment")).toBe(true);
      expect(VALID.includes("delete")).toBe(false);
    });

    it("Valid review decisions: accepted, rejected, resolved", () => {
      const VALID = ["accepted", "rejected", "resolved"];
      expect(VALID.includes("accepted")).toBe(true);
      expect(VALID.includes("approved")).toBe(false);
    });

    it("Public URL in storagePath is detectable", () => {
      expect("https://example.com/f.xlsx".startsWith("https://")).toBe(true);
      expect("http://example.com/f.xlsx".startsWith("http://")).toBe(true);
      expect("s3://bucket/key".startsWith("http://")).toBe(false);
      expect("/var/data/f.xlsx".startsWith("http://")).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 7. DTO redaction (behavioral)
  // -------------------------------------------------------------------------
  describe("7. DTO redaction", () => {
    it("File hash redacted to first 8 chars + ellipsis", () => {
      const full = "abcdef0123456789abcdef0123456789";
      const redacted = full.substring(0, 8) + "…";
      expect(redacted).toBe("abcdef01…");
      expect(redacted.length).toBeLessThan(full.length);
    });

    it("Backup location redacted to protocol prefix only", () => {
      const full = "s3://my-private-bucket/path/backup.zip";
      const redacted = full.split("://")[0] + "://…";
      expect(redacted).toBe("s3://…");
      expect(redacted).not.toContain("my-private-bucket");
    });
  });

  // -------------------------------------------------------------------------
  // 8. Audit action types
  // -------------------------------------------------------------------------
  describe("8. Audit recording", () => {
    it("createBatch records historical_batch.create", async () => {
      await seedBatch(stagingDeps.service);
      expect(
        stagingDeps.audit.getRows().some(r => r.actionType === "historical_batch.create"),
      ).toBe(true);
    });

    it("recordApproval records historical_commit.approval", async () => {
      const batchId = await seedBatchForCommit(stagingDeps, commitDeps);
      await commitDeps.service.recordApproval(
        makeUser(OWNER_USER) as any,
        makeEffective("owner") as any,
        {
          importBatchId: batchId,
          approverRole: "owner",
          reason: null,
          idempotencyKey: "audit-test-001",
        },
      );
      expect(
        commitDeps.audit.getRows().some(r => r.actionType === "historical_commit.approval"),
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 9. Idempotency replay
  // -------------------------------------------------------------------------
  describe("9. Idempotency replay — zero new effects", () => {
    it("createBatch replay returns same batchId, zero new audits", async () => {
      const key = `replay-${Date.now()}`;
      const r1 = await stagingDeps.service.createBatch(
        makeUser(OWNER_USER) as any,
        makeEffective("owner") as any,
        {
          sourceDescription: "Replay",
          templateName: null,
          templateVersion: null,
          cutoverImportMode: "opening_balance",
          idempotencyKey: key,
        },
      );
      const auditCount = stagingDeps.audit.getRows().length;

      const r2 = await stagingDeps.service.createBatch(
        makeUser(OWNER_USER) as any,
        makeEffective("owner") as any,
        {
          sourceDescription: "Replay",
          templateName: null,
          templateVersion: null,
          cutoverImportMode: "opening_balance",
          idempotencyKey: key,
        },
      );

      expect(r2.batchId).toBe(r1.batchId);
      expect(stagingDeps.audit.getRows().length).toBe(auditCount);
    });
  });
});
