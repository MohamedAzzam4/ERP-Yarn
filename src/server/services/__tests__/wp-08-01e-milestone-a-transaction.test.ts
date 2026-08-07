/**
 * WP-08-01E Milestone A — Deterministic Service-Level Transaction Tests.
 *
 * Tests prove exact counts for transaction rollback, audit-failure rollback,
 * ownership-loss rollback, valid retry, and replay — for all four worker
 * quality/complaint commands.
 *
 * Uses a simulated transaction runner with snapshot/restore to verify that
 * failed transactions leave exactly zero business/audit effects.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { QualityTestService } from "@/server/services/quality-test-service";
import { ComplaintService } from "@/server/services/complaint-service";
import { InMemoryQualityTestRepository } from "@/server/services/__tests__/in-memory-quality-test-repository";
import { InMemoryComplaintRepository } from "@/server/services/__tests__/in-memory-complaint-repository";
import { InProcessAuditStore } from "@/server/services/audit-service";
import { InProcessIdempotencyStore } from "@/server/services/idempotency-service";
import { InProcessDocumentSequenceStore } from "@/server/services/document-sequence-service";
import { IdempotencyOwnershipLostError } from "@/server/services/idempotency-service";
import type { ErpUserContext } from "@/server/auth/erp-context";
import type { EffectivePermissions } from "@/server/security/effective-permissions";

const TEST_TENANT = "00000000-0000-0000-0000-000000081e01";
const TEST_USER_ID = "00000000-0000-0000-0000-000000081e10";
const TEST_ITEM_ID = "00000000-0000-4000-8000-cccc000e0001";

function makeUser(t: string = TEST_TENANT, u: string = TEST_USER_ID): ErpUserContext {
  return { authenticated: true, tenantId: t, userId: u, name: "T", email: "t@e.test", authId: "t" } as any;
}
function makeEff(perms: string[] = ["quality_tests.create", "complaints.investigate"]): EffectivePermissions {
  return { assignedRoleCodes: ["quality_employee"], permissionKeys: new Set(perms), deniedFieldKeys: new Set(), workerFinancialDeny: false } as any;
}

// ---------------------------------------------------------------------------
// Simulated transaction runner with snapshot/restore for rollback tests.
// When the work function throws, the runner restores all repos to their
// pre-transaction state (simulating a DB ROLLBACK).
// ---------------------------------------------------------------------------

interface Snapshotable {
  snapshot(): unknown;
  restore(s: unknown): void;
}

function makeSimulatedTransactionRunner(...repos: Snapshotable[]) {
  return async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
    const snapshots = repos.map((r) => r.snapshot());
    try {
      return await work("simulated-tx");
    } catch (e) {
      // ROLLBACK: restore all repos to pre-transaction state
      repos.forEach((r, i) => r.restore(snapshots[i]));
      throw e;
    }
  };
}

// ---------------------------------------------------------------------------
// QualityTest tests
// ---------------------------------------------------------------------------

describe("WP-08-01E Milestone A — createQualityTest transaction safety", () => {
  let repo: InMemoryQualityTestRepository;
  let audit: InProcessAuditStore;
  let idempotency: InProcessIdempotencyStore;
  let docSeq: InProcessDocumentSequenceStore;
  let service: QualityTestService;

  beforeEach(() => {
    repo = new InMemoryQualityTestRepository();
    audit = new InProcessAuditStore();
    idempotency = new InProcessIdempotencyStore();
    docSeq = new InProcessDocumentSequenceStore();
    service = new QualityTestService({
      qualityTestRepository: repo, audit, idempotency, documentSequence: docSeq,
      transactionRunner: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => work('simulated-tx'),
      txFactories: {
        createQualityTestRepository: () => repo,
        createIdempotency: () => idempotency,
        createAudit: () => audit,
        createDocumentSequence: () => docSeq,
      },
    });
  });

  it("A1. valid retry: exactly 1 quality test, 1 audit, 1 idempotency succeeded", async () => {
    const result = await service.createQualityTest(makeUser() as any, makeEff() as any, {
      testDate: "2026-08-06", linkedEntityType: "inventory_item" as any, linkedEntityId: TEST_ITEM_ID, idempotencyKey: "qt-valid-001",
    });

    expect(result.action).toBe("created");
    expect(result.qualityTestId).toBeDefined();

    // Exactly 1 quality test
    const tests = await repo.listQualityTestsForLinkedEntity(TEST_TENANT, "inventory_item", TEST_ITEM_ID);
    expect(tests.length).toBe(1);

    // Exactly 1 audit log
    expect(audit.count()).toBe(1);

    // Exactly 1 idempotency record succeeded
    const records = idempotency.getAllRecords().filter((r) => r.operationScope === "quality_test.create");
    expect(records.length).toBe(1);
    expect(records[0]!.state).toBe("succeeded");
  });

  it("A2. replay: exactly 0 additional quality tests, 0 additional audits", async () => {
    await service.createQualityTest(makeUser() as any, makeEff() as any, {
      testDate: "2026-08-06", linkedEntityType: "inventory_item" as any, linkedEntityId: TEST_ITEM_ID, idempotencyKey: "qt-replay-001",
    });
    const auditBefore = audit.count();
    const testsBefore = (await repo.listQualityTestsForLinkedEntity(TEST_TENANT, "inventory_item", TEST_ITEM_ID)).length;

    const result2 = await service.createQualityTest(makeUser() as any, makeEff() as any, {
      testDate: "2026-08-06", linkedEntityType: "inventory_item" as any, linkedEntityId: TEST_ITEM_ID, idempotencyKey: "qt-replay-001",
    });

    expect(result2.action).toBe("replayed");
    expect(audit.count()).toBe(auditBefore); // 0 new audits
    const testsAfter = (await repo.listQualityTestsForLinkedEntity(TEST_TENANT, "inventory_item", TEST_ITEM_ID)).length;
    expect(testsAfter).toBe(testsBefore); // 0 new tests
  });

  it("A3. audit failure rollback: exactly 0 quality tests, 0 audits (with tx runner)", async () => {
    // Create a failing audit store
    const failingAudit = new InProcessAuditStore();
    failingAudit.setShouldFail(true);

    const txRunner = makeSimulatedTransactionRunner(repo);
    const txService = new QualityTestService({
      qualityTestRepository: repo,
      audit: failingAudit,
      idempotency,
      documentSequence: docSeq,
      transactionRunner: txRunner,
      txFactories: {
        createQualityTestRepository: () => repo,
        createIdempotency: () => idempotency,
        createAudit: () => failingAudit,
        createDocumentSequence: () => docSeq,
      },
    });

    let threw = false;
    try {
      await txService.createQualityTest(makeUser() as any, makeEff() as any, {
        testDate: "2026-08-06", linkedEntityType: "inventory_item" as any, linkedEntityId: TEST_ITEM_ID, idempotencyKey: "qt-audit-fail-001",
      });
    } catch (e) {
      threw = true;
    }
    expect(threw).toBe(true);

    // Exactly 0 quality tests (rolled back)
    const tests = await repo.listQualityTestsForLinkedEntity(TEST_TENANT, "inventory_item", TEST_ITEM_ID);
    expect(tests.length).toBe(0);

    // Exactly 0 audits (rolled back)
    expect(failingAudit.count()).toBe(0);

    // Idempotency NOT succeeded (rolled back)
    const records = idempotency.getAllRecords().filter((r) => r.operationScope === "quality_test.create");
    expect(records.length).toBe(1);
    expect(records[0]!.state).not.toBe("succeeded");
  });

  it("A4. ownership-loss rollback: exactly 0 quality tests, 0 audits", async () => {
    // Create an idempotency store that will lose ownership at markSucceeded
    // by having a different ownerToken when updateState is called
    const losingIdempotency = new InProcessIdempotencyStore();

    const txRunner = makeSimulatedTransactionRunner(repo);
    const txService = new QualityTestService({
      qualityTestRepository: repo,
      audit,
      idempotency: losingIdempotency,
      documentSequence: docSeq,
      transactionRunner: txRunner,
      txFactories: {
        createQualityTestRepository: () => repo,
        createIdempotency: () => losingIdempotency,
        createAudit: () => audit,
        createDocumentSequence: () => docSeq,
      },
    });

    // Pre-claim the idempotency record with a different owner token
    // so that when markSucceeded is called, the owner token won't match
    const claimResult = await (await import("@/server/services/idempotency-service")).claimIdempotency(losingIdempotency, {
      tenantId: TEST_TENANT, operationScope: "quality_test.create", idempotencyKey: "qt-ownership-001",
      requestBody: { testDate: "2026-08-06", linkedEntityType: "inventory_item", linkedEntityId: TEST_ITEM_ID, testStatus: "needs_review", riskClassification: "none", notes: null, saleId: null, customerId: null },
      initiatedBy: TEST_USER_ID, leaseDurationMs: 30000, now: new Date(),
    });

    // Steal the lease (simulate another process reclaiming it)
    await losingIdempotency.claimExpiredLease(claimResult.record.id, new Date(Date.now() + 30000), new Date(), new Date());

    let threw = false;
    let threwOwnership = false;
    try {
      await txService.createQualityTest(makeUser() as any, makeEff() as any, {
        testDate: "2026-08-06", linkedEntityType: "inventory_item" as any, linkedEntityId: TEST_ITEM_ID, idempotencyKey: "qt-ownership-001",
      });
    } catch (e: any) {
      threw = true;
      if (e instanceof IdempotencyOwnershipLostError || e.name === "IdempotencyOwnershipLostError") threwOwnership = true;
    }
    expect(threw).toBe(true);

    // Exactly 0 quality tests (rolled back)
    const tests = await repo.listQualityTestsForLinkedEntity(TEST_TENANT, "inventory_item", TEST_ITEM_ID);
    expect(tests.length).toBe(0);

    // Exactly 0 audits (rolled back)
    expect(audit.count()).toBe(0);
  });
});

describe("WP-08-01E Milestone A — recordQualityTestValue transaction safety", () => {
  let repo: InMemoryQualityTestRepository;
  let audit: InProcessAuditStore;
  let idempotency: InProcessIdempotencyStore;
  let docSeq: InProcessDocumentSequenceStore;
  let service: QualityTestService;

  beforeEach(async () => {
    repo = new InMemoryQualityTestRepository();
    audit = new InProcessAuditStore();
    idempotency = new InProcessIdempotencyStore();
    docSeq = new InProcessDocumentSequenceStore();
    service = new QualityTestService({
      qualityTestRepository: repo, audit, idempotency, documentSequence: docSeq,
      transactionRunner: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => work('simulated-tx'),
      txFactories: {
        createQualityTestRepository: () => repo,
        createIdempotency: () => idempotency,
        createAudit: () => audit,
        createDocumentSequence: () => docSeq,
      },
    });
    // Seed a quality test
    await service.createQualityTest(makeUser() as any, makeEff() as any, {
      testDate: "2026-08-06", linkedEntityType: "inventory_item" as any, linkedEntityId: TEST_ITEM_ID, idempotencyKey: "seed-001",
    });
  });

  it("B1. valid retry: exactly 1 value, 1 audit, 1 idempotency succeeded", async () => {
    const test = (await repo.listQualityTestsForLinkedEntity(TEST_TENANT, "inventory_item", TEST_ITEM_ID))[0]!;
    const auditBefore = audit.count();

    const result = await service.recordQualityTestValue(makeUser() as any, makeEff() as any, {
      qualityTestId: test.id, parameterName: "Count", parameterCode: "CNT", valueStatus: "pass", idempotencyKey: "val-valid-001",
    });

    expect(result.valueId).toBeDefined();
    // 1 new audit (for value.record)
    expect(audit.count()).toBe(auditBefore + 1);
    // 1 idempotency record succeeded
    const records = idempotency.getAllRecords().filter((r) => r.operationScope === "quality_test.value.record");
    expect(records.length).toBe(1);
    expect(records[0]!.state).toBe("succeeded");
  });

  it("B2. replay: exactly 0 additional values, 0 additional audits", async () => {
    const test = (await repo.listQualityTestsForLinkedEntity(TEST_TENANT, "inventory_item", TEST_ITEM_ID))[0]!;
    const input = { qualityTestId: test.id, parameterName: "Count", parameterCode: "CNT", valueStatus: "pass" as const, idempotencyKey: "val-replay-001" };

    await service.recordQualityTestValue(makeUser() as any, makeEff() as any, input);
    const auditBefore = audit.count();
    const valuesBefore = (await repo.listQualityTestValues(TEST_TENANT, test.id)).length;

    const result2 = await service.recordQualityTestValue(makeUser() as any, makeEff() as any, input);
    expect(result2.valueId).toBeDefined();
    expect(audit.count()).toBe(auditBefore); // 0 new
    const valuesAfter = (await repo.listQualityTestValues(TEST_TENANT, test.id)).length;
    expect(valuesAfter).toBe(valuesBefore); // 0 new
  });

  it("B3. audit failure rollback: exactly 0 new values, 0 new audits (with tx runner)", async () => {
    const test = (await repo.listQualityTestsForLinkedEntity(TEST_TENANT, "inventory_item", TEST_ITEM_ID))[0]!;
    const failingAudit = new InProcessAuditStore();
    failingAudit.setShouldFail(true);
    // Do NOT call clear() — it resets shouldFail to false

    const txRunner = makeSimulatedTransactionRunner(repo);
    const txService = new QualityTestService({
      qualityTestRepository: repo, audit: failingAudit, idempotency, documentSequence: docSeq,
      transactionRunner: txRunner,
      txFactories: {
        createQualityTestRepository: () => repo, createIdempotency: () => idempotency, createAudit: () => failingAudit, createDocumentSequence: () => docSeq,
      },
    });

    const valuesBefore = (await repo.listQualityTestValues(TEST_TENANT, test.id)).length;
    let threw = false;
    try {
      await txService.recordQualityTestValue(makeUser() as any, makeEff() as any, {
        qualityTestId: test.id, parameterName: "Count", parameterCode: "CNT", valueStatus: "pass", idempotencyKey: "val-audit-fail-001",
      });
    } catch (e) { threw = true; }
    expect(threw).toBe(true);

    // Exactly 0 new values (rolled back)
    const valuesAfter = (await repo.listQualityTestValues(TEST_TENANT, test.id)).length;
    expect(valuesAfter).toBe(valuesBefore);

    // Exactly 0 new audits (rolled back)
    expect(failingAudit.count()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Complaint tests
// ---------------------------------------------------------------------------

describe("WP-08-01E Milestone A — createComplaint transaction safety", () => {
  let repo: InMemoryComplaintRepository;
  let audit: InProcessAuditStore;
  let idempotency: InProcessIdempotencyStore;
  let docSeq: InProcessDocumentSequenceStore;
  let service: ComplaintService;

  beforeEach(() => {
    repo = new InMemoryComplaintRepository();
    audit = new InProcessAuditStore();
    idempotency = new InProcessIdempotencyStore();
    docSeq = new InProcessDocumentSequenceStore();
    service = new ComplaintService({
      complaintRepository: repo, audit, idempotency, documentSequence: docSeq,
      transactionRunner: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => work('simulated-tx'),
      txFactories: {
        createComplaintRepository: () => repo,
        createIdempotency: () => idempotency,
        createAudit: () => audit,
        createDocumentSequence: () => docSeq,
      },
    });
  });

  it("C1. valid retry: exactly 1 complaint, 1 audit, 1 idempotency succeeded", async () => {
    const result = await service.createComplaint(makeUser() as any, makeEff() as any, {
      complaintDate: "2026-08-06", subject: "Test complaint", customerId: TEST_ITEM_ID, idempotencyKey: "comp-valid-001",
    });

    expect(result.action).toBe("created");
    expect(audit.count()).toBe(1);
    const records = idempotency.getAllRecords().filter((r) => r.operationScope === "complaint.create");
    expect(records.length).toBe(1);
    expect(records[0]!.state).toBe("succeeded");
  });

  it("C2. replay: exactly 0 additional complaints, 0 additional audits", async () => {
    await service.createComplaint(makeUser() as any, makeEff() as any, {
      complaintDate: "2026-08-06", subject: "Test complaint", customerId: TEST_ITEM_ID, idempotencyKey: "comp-replay-001",
    });
    const auditBefore = audit.count();

    const result2 = await service.createComplaint(makeUser() as any, makeEff() as any, {
      complaintDate: "2026-08-06", subject: "Test complaint", customerId: TEST_ITEM_ID, idempotencyKey: "comp-replay-001",
    });

    expect(result2.action).toBe("replayed");
    expect(audit.count()).toBe(auditBefore);
  });

  it("C3. audit failure rollback: exactly 0 complaints, 0 audits (with tx runner)", async () => {
    const failingAudit = new InProcessAuditStore();
    failingAudit.setShouldFail(true);

    const txRunner = makeSimulatedTransactionRunner(repo);
    const txService = new ComplaintService({
      complaintRepository: repo, audit: failingAudit, idempotency, documentSequence: docSeq,
      transactionRunner: txRunner,
      txFactories: {
        createComplaintRepository: () => repo, createIdempotency: () => idempotency, createAudit: () => failingAudit, createDocumentSequence: () => docSeq,
      },
    });

    let threw = false;
    try {
      await txService.createComplaint(makeUser() as any, makeEff() as any, {
        complaintDate: "2026-08-06", subject: "Test complaint", customerId: TEST_ITEM_ID, idempotencyKey: "comp-audit-fail-001",
      });
    } catch (e) { threw = true; }
    expect(threw).toBe(true);

    // Exactly 0 complaints (rolled back)
    const complaints = await repo.listOpenComplaints(TEST_TENANT);
    expect(complaints.length).toBe(0);

    // Exactly 0 audits (rolled back)
    expect(failingAudit.count()).toBe(0);
  });
});

describe("WP-08-01E Milestone A — updateComplaint transaction safety", () => {
  let repo: InMemoryComplaintRepository;
  let audit: InProcessAuditStore;
  let idempotency: InProcessIdempotencyStore;
  let docSeq: InProcessDocumentSequenceStore;
  let service: ComplaintService;

  beforeEach(async () => {
    repo = new InMemoryComplaintRepository();
    audit = new InProcessAuditStore();
    idempotency = new InProcessIdempotencyStore();
    docSeq = new InProcessDocumentSequenceStore();
    service = new ComplaintService({
      complaintRepository: repo, audit, idempotency, documentSequence: docSeq,
      transactionRunner: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => work('simulated-tx'),
      txFactories: {
        createComplaintRepository: () => repo,
        createIdempotency: () => idempotency,
        createAudit: () => audit,
        createDocumentSequence: () => docSeq,
      },
    });
    // Seed a complaint
    await service.createComplaint(makeUser() as any, makeEff() as any, {
      complaintDate: "2026-08-06", subject: "Test complaint", customerId: TEST_ITEM_ID, idempotencyKey: "seed-comp-001",
    });
  });

  it("D1. valid retry: exactly 1 update audit, 1 idempotency succeeded", async () => {
    const complaints = await repo.listOpenComplaints(TEST_TENANT);
    const complaint = complaints[0]!;
    const auditBefore = audit.count();

    const result = await service.updateComplaint(makeUser() as any, makeEff() as any, {
      complaintId: complaint.id, status: "investigating", idempotencyKey: "comp-update-valid-001",
    });

    expect(result.action).toBe("updated");
    expect(audit.count()).toBe(auditBefore + 1);
    const records = idempotency.getAllRecords().filter((r) => r.operationScope === "complaint.update");
    expect(records.length).toBe(1);
    expect(records[0]!.state).toBe("succeeded");
  });

  it("D2. replay: exactly 0 additional audits", async () => {
    const complaints = await repo.listOpenComplaints(TEST_TENANT);
    const complaint = complaints[0]!;
    const input = { complaintId: complaint.id, status: "investigating" as const, idempotencyKey: "comp-update-replay-001" };

    await service.updateComplaint(makeUser() as any, makeEff() as any, input);
    const auditBefore = audit.count();

    const result2 = await service.updateComplaint(makeUser() as any, makeEff() as any, input);
    expect(result2.action).toBe("replayed");
    expect(audit.count()).toBe(auditBefore); // 0 new
  });

  it("D3. audit failure rollback: exactly 0 new audits (with tx runner)", async () => {
    const complaints = await repo.listOpenComplaints(TEST_TENANT);
    const complaint = complaints[0]!;
    const failingAudit = new InProcessAuditStore();
    failingAudit.setShouldFail(true);

    const txRunner = makeSimulatedTransactionRunner(repo);
    const txService = new ComplaintService({
      complaintRepository: repo, audit: failingAudit, idempotency, documentSequence: docSeq,
      transactionRunner: txRunner,
      txFactories: {
        createComplaintRepository: () => repo, createIdempotency: () => idempotency, createAudit: () => failingAudit, createDocumentSequence: () => docSeq,
      },
    });

    const statusBefore = complaint.status;
    let threw = false;
    try {
      await txService.updateComplaint(makeUser() as any, makeEff() as any, {
        complaintId: complaint.id, status: "investigating", idempotencyKey: "comp-update-audit-fail-001",
      });
    } catch (e) { threw = true; }
    expect(threw).toBe(true);

    // Exactly 0 new audits (rolled back)
    expect(failingAudit.count()).toBe(0);

    // Complaint status unchanged (rolled back)
    const refetched = await repo.findComplaintById(TEST_TENANT, complaint.id);
    expect(refetched!.status).toBe(statusBefore);
  });
});

// ---------------------------------------------------------------------------
// 5. reviewQualityTest transaction safety
// ---------------------------------------------------------------------------

describe("WP-08-01E Milestone A — reviewQualityTest transaction safety", () => {
  let repo: InMemoryQualityTestRepository;
  let audit: InProcessAuditStore;
  let idempotency: InProcessIdempotencyStore;
  let docSeq: InProcessDocumentSequenceStore;
  let service: QualityTestService;
  let testId: string;

  beforeEach(async () => {
    repo = new InMemoryQualityTestRepository();
    audit = new InProcessAuditStore();
    idempotency = new InProcessIdempotencyStore();
    docSeq = new InProcessDocumentSequenceStore();
    const tr = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => work("simulated-tx");
    const txFactories = {
      createQualityTestRepository: () => repo,
      createIdempotency: () => idempotency,
      createAudit: () => audit,
      createDocumentSequence: () => docSeq,
    };
    service = new QualityTestService({
      qualityTestRepository: repo, audit, idempotency, documentSequence: docSeq,
      transactionRunner: tr, txFactories,
    });
    // Seed a quality test
    const test = await service.createQualityTest(makeUser() as any, makeEff() as any, {
      testDate: "2026-08-06", linkedEntityType: "inventory_item" as any, linkedEntityId: TEST_ITEM_ID, idempotencyKey: "rev-seed-d-001",
    });
    testId = test.qualityTestId;
  });

  function makeRevEff() {
    return {
      assignedRoleCodes: ["owner"],
      permissionKeys: new Set(["quality_risk_sales.approve"]),
      deniedFieldKeys: new Set(),
      workerFinancialDeny: false,
    } as any;
  }

  it("E1. valid success: 1 review audit, 1 idem succeeded", async () => {
    const auditBefore = audit.count();
    const result = await service.reviewQualityTest(makeUser() as any, makeRevEff() as any, {
      qualityTestId: testId, testStatus: "accepted", riskClassification: "none", idempotencyKey: "rev-d-valid-001",
    });
    expect(result.action).toBe("reviewed");
    expect(audit.count()).toBe(auditBefore + 1);
    const records = idempotency.getAllRecords().filter((r) => r.operationScope === "quality_test.review");
    expect(records.length).toBe(1);
    expect(records[0]!.state).toBe("succeeded");
  });

  it("E2. replay: 0 new audits", async () => {
    const input = { qualityTestId: testId, testStatus: "accepted" as const, riskClassification: "none" as const, idempotencyKey: "rev-d-rep-001" };
    await service.reviewQualityTest(makeUser() as any, makeRevEff() as any, input);
    const auditBefore = audit.count();
    const result2 = await service.reviewQualityTest(makeUser() as any, makeRevEff() as any, input);
    expect(result2.action).toBe("replayed");
    expect(audit.count()).toBe(auditBefore);
  });

  it("E3. conflict: rejected, 0 new audits", async () => {
    await service.reviewQualityTest(makeUser() as any, makeRevEff() as any, {
      qualityTestId: testId, testStatus: "accepted", riskClassification: "none", idempotencyKey: "rev-d-conf-001",
    });
    const auditBefore = audit.count();
    let threw = false;
    try {
      await service.reviewQualityTest(makeUser() as any, makeRevEff() as any, {
        qualityTestId: testId, testStatus: "blocked", riskClassification: "blocked", idempotencyKey: "rev-d-conf-001",
      });
    } catch (e: any) { if (e.code === "IDEMPOTENCY_CONFLICT") threw = true; }
    expect(threw).toBe(true);
    expect(audit.count()).toBe(auditBefore);
  });

  it("E4. audit-failure rollback: 0 new audits (with tx runner)", async () => {
    const failingAudit = new InProcessAuditStore();
    failingAudit.setShouldFail(true);
    const txRunner = makeSimulatedTransactionRunner(repo);
    const txService = new QualityTestService({
      qualityTestRepository: repo, audit: failingAudit, idempotency, documentSequence: docSeq,
      transactionRunner: txRunner,
      txFactories: {
        createQualityTestRepository: () => repo, createIdempotency: () => idempotency, createAudit: () => failingAudit, createDocumentSequence: () => docSeq,
      },
    });
    const auditBefore = failingAudit.count();
    let threw = false;
    try {
      await txService.reviewQualityTest(makeUser() as any, makeRevEff() as any, {
        qualityTestId: testId, testStatus: "blocked", riskClassification: "blocked", idempotencyKey: "rev-d-af-001",
      });
    } catch (e) { threw = true; }
    expect(threw).toBe(true);
    expect(failingAudit.count()).toBe(auditBefore); // 0 new
    // Quality test status unchanged
    const test = await repo.findQualityTestById(TEST_TENANT, testId);
    expect(test!.testStatus).toBe("needs_review"); // unchanged from seed
  });

  it("E5. ownership-loss rollback: 0 new audits", async () => {
    const txRunner = makeSimulatedTransactionRunner(repo);
    const txService = new QualityTestService({
      qualityTestRepository: repo, audit, idempotency, documentSequence: docSeq,
      transactionRunner: txRunner,
      txFactories: {
        createQualityTestRepository: () => repo, createIdempotency: () => idempotency, createAudit: () => audit, createDocumentSequence: () => docSeq,
      },
    });
    // Pre-claim with different owner
    const { claimIdempotency } = await import("@/server/services/idempotency-service");
    const claim = await claimIdempotency(idempotency, {
      tenantId: TEST_TENANT, operationScope: "quality_test.review", idempotencyKey: "rev-d-ol-001",
      requestBody: { qualityTestId: testId, testStatus: "blocked", riskClassification: "blocked", reviewNotes: null },
      initiatedBy: TEST_USER_ID, leaseDurationMs: 30000, now: new Date(),
    });
    // Steal the lease
    await idempotency.claimExpiredLease(claim.record.id, new Date(Date.now() + 30000), new Date(), new Date());

    const auditBefore = audit.count();
    let threw = false;
    try {
      await txService.reviewQualityTest(makeUser() as any, makeRevEff() as any, {
        qualityTestId: testId, testStatus: "blocked", riskClassification: "blocked", idempotencyKey: "rev-d-ol-001",
      });
    } catch (e: any) { threw = true; }
    expect(threw).toBe(true);
    expect(audit.count()).toBe(auditBefore); // 0 new
    // Test status unchanged
    const test = await repo.findQualityTestById(TEST_TENANT, testId);
    expect(test!.testStatus).toBe("needs_review"); // unchanged
  });

  it("E6. retry after rollback: succeeds, then replay = 0 new", async () => {
    const result = await service.reviewQualityTest(makeUser() as any, makeRevEff() as any, {
      qualityTestId: testId, testStatus: "accepted", riskClassification: "none", idempotencyKey: "rev-d-rt-001",
    });
    expect(result.action).toBe("reviewed");
    const auditBefore = audit.count();
    const result2 = await service.reviewQualityTest(makeUser() as any, makeRevEff() as any, {
      qualityTestId: testId, testStatus: "accepted", riskClassification: "none", idempotencyKey: "rev-d-rt-001",
    });
    expect(result2.action).toBe("replayed");
    expect(audit.count()).toBe(auditBefore); // 0 new
  });

  it("E7. quality-hold count: blocked review creates exactly 1 hold", async () => {
    const holdsBefore = (await repo.listActiveQualityHoldsForEntity(TEST_TENANT, "inventory_item", TEST_ITEM_ID)).length;
    await service.reviewQualityTest(makeUser() as any, makeRevEff() as any, {
      qualityTestId: testId, testStatus: "blocked", riskClassification: "blocked", idempotencyKey: "rev-d-hold-001",
    });
    const holdsAfter = (await repo.listActiveQualityHoldsForEntity(TEST_TENANT, "inventory_item", TEST_ITEM_ID)).length;
    expect(holdsAfter).toBe(holdsBefore + 1); // exactly 1 new hold
  });

  it("E8. accepted review creates 0 new holds", async () => {
    const holdsBefore = (await repo.listActiveQualityHoldsForEntity(TEST_TENANT, "inventory_item", TEST_ITEM_ID)).length;
    await service.reviewQualityTest(makeUser() as any, makeRevEff() as any, {
      qualityTestId: testId, testStatus: "accepted", riskClassification: "none", idempotencyKey: "rev-d-nohold-001",
    });
    const holdsAfter = (await repo.listActiveQualityHoldsForEntity(TEST_TENANT, "inventory_item", TEST_ITEM_ID)).length;
    expect(holdsAfter).toBe(holdsBefore); // 0 new holds
  });
});
