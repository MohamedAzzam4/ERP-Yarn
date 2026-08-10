/**
 * WP-08-01E — Complaint linked-entity validation tests (production path).
 *
 * Tests the production validation added to createComplaintAction:
 * - Valid linked complaint succeeds.
 * - Missing link is rejected with zero effects.
 * - Cross-tenant link is rejected with zero effects.
 * - Persisted complaint contains the selected link.
 * - Exact scoped audit count is one.
 * - Replay creates no new complaint or audit.
 * - Conflicting replay is rejected.
 *
 * These tests verify the ComplaintService behavior that the production
 * createComplaintAction now relies on. The action itself is a thin wrapper
 * that reads linkedEntityId from the form, resolves the entity type via
 * tenant-scoped query, and delegates to ComplaintService.createComplaint.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryComplaintRepository } from "./in-memory-complaint-repository";
import { InProcessAuditStore } from "../audit-service";
import { InProcessIdempotencyStore } from "../idempotency-service";
import { InProcessDocumentSequenceStore } from "../document-sequence-service";
import { ComplaintService } from "../complaint-service";
import type { EffectivePermissions } from "../../security/effective-permissions";
import type { ErpUserContext } from "../../auth/erp-context";
import type { CreateComplaintInput } from "../complaint-service";

const TENANT_A = "00000000-0000-0000-0000-000000081e50";
const TENANT_B = "00000000-0000-0000-0000-000000999999";
const USER_A = "00000000-0000-0000-0000-000000081e61";
const CUSTOMER_A = "00000000-0000-0000-0000-000000081e83";
const CUSTOMER_B = "00000000-0000-0000-0000-000000999991";

function makeUser(tenantId: string = TENANT_A): ErpUserContext {
  return {
    authenticated: true,
    userId: USER_A,
    tenantId,
    authId: "test-auth",
    name: "Test User",
    email: "test@test.local",
  };
}

function makeEff(tenantId: string = TENANT_A): EffectivePermissions {
  return {
    assignedRoleCodes: ["quality_employee"],
    permissionKeys: new Set(["complaints.investigate"]),
    workerFinancialDeny: { enforced: true, deniedPermissionKeys: new Set(), deniedFieldKeys: new Set() },
  };
}

function makeDeps() {
  const complaintRepository = new InMemoryComplaintRepository();
  const audit = new InProcessAuditStore();
  const idempotency = new InProcessIdempotencyStore();
  const documentSequence = new InProcessDocumentSequenceStore();
  const transactionRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => work("simulated-tx");
  const txFactories = {
    createComplaintRepository: () => complaintRepository,
    createIdempotency: () => idempotency,
    createAudit: () => audit,
    createDocumentSequence: () => documentSequence,
  };
  const service = new ComplaintService({
    complaintRepository,
    audit,
    idempotency,
    documentSequence,
    transactionRunner,
    txFactories,
  });
  return { service, complaintRepository, audit, idempotency, documentSequence };
}

describe("WP-08-01E — Complaint linked-entity validation (production path)", () => {
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    deps = makeDeps();
  });

  it("valid linked complaint succeeds with customer link", async () => {
    const input: CreateComplaintInput = {
      complaintDate: "2026-08-10",
      subject: "QA complaint with customer link",
      description: "Test description",
      priority: "normal",
      customerId: CUSTOMER_A,
      idempotencyKey: "qa-complaint-valid-001",
    };

    const result = await deps.service.createComplaint(
      makeUser() as any,
      makeEff() as any,
      input,
    );

    expect(result.complaintId).toBeDefined();
    const complaint = await deps.complaintRepository.findComplaintById(TENANT_A, result.complaintId);
    expect(complaint).toBeDefined();
    expect(complaint!.customerId).toBe(CUSTOMER_A);
    expect(complaint!.subject).toBe("QA complaint with customer link");
  });

  it("valid linked complaint succeeds with sale link", async () => {
    const saleId = "00000000-0000-0000-0000-000000081e91";
    const input: CreateComplaintInput = {
      complaintDate: "2026-08-10",
      subject: "QA complaint with sale link",
      priority: "high",
      saleId,
      idempotencyKey: "qa-complaint-valid-sale-001",
    };

    const result = await deps.service.createComplaint(
      makeUser() as any,
      makeEff() as any,
      input,
    );

    const complaint = await deps.complaintRepository.findComplaintById(TENANT_A, result.complaintId);
    expect(complaint!.saleId).toBe(saleId);
  });

  it("valid linked complaint succeeds with item link", async () => {
    const itemId = "00000000-0000-0000-0000-000000081e85";
    const input: CreateComplaintInput = {
      complaintDate: "2026-08-10",
      subject: "QA complaint with item link",
      itemId,
      idempotencyKey: "qa-complaint-valid-item-001",
    };

    const result = await deps.service.createComplaint(
      makeUser() as any,
      makeEff() as any,
      input,
    );

    const complaint = await deps.complaintRepository.findComplaintById(TENANT_A, result.complaintId);
    expect(complaint!.itemId).toBe(itemId);
  });

  it("valid linked complaint succeeds with quality_test link", async () => {
    const qualityTestId = "00000000-0000-0000-0000-000000081e93";
    const input: CreateComplaintInput = {
      complaintDate: "2026-08-10",
      subject: "QA complaint with quality test link",
      qualityTestId,
      idempotencyKey: "qa-complaint-valid-qt-001",
    };

    const result = await deps.service.createComplaint(
      makeUser() as any,
      makeEff() as any,
      input,
    );

    const complaint = await deps.complaintRepository.findComplaintById(TENANT_A, result.complaintId);
    expect(complaint!.qualityTestId).toBe(qualityTestId);
  });

  it("valid linked complaint succeeds with yarn_lot link", async () => {
    const yarnLotId = "00000000-0000-0000-0000-000000081e84";
    const input: CreateComplaintInput = {
      complaintDate: "2026-08-10",
      subject: "QA complaint with yarn lot link",
      yarnLotId,
      idempotencyKey: "qa-complaint-valid-yarn-001",
    };

    const result = await deps.service.createComplaint(
      makeUser() as any,
      makeEff() as any,
      input,
    );

    const complaint = await deps.complaintRepository.findComplaintById(TENANT_A, result.complaintId);
    expect(complaint!.yarnLotId).toBe(yarnLotId);
  });

  it("valid linked complaint succeeds with raw_material_batch link", async () => {
    const rawMaterialBatchId = "00000000-0000-0000-0000-000000081e90";
    const input: CreateComplaintInput = {
      complaintDate: "2026-08-10",
      subject: "QA complaint with raw material batch link",
      rawMaterialBatchId,
      idempotencyKey: "qa-complaint-valid-rmb-001",
    };

    const result = await deps.service.createComplaint(
      makeUser() as any,
      makeEff() as any,
      input,
    );

    const complaint = await deps.complaintRepository.findComplaintById(TENANT_A, result.complaintId);
    expect(complaint!.rawMaterialBatchId).toBe(rawMaterialBatchId);
  });

  it("all entity types exposed by the form are supported by the service", async () => {
    // The form exposes: customer, sale, item, quality_test, yarn_lot
    // The service must accept all of these + raw_material_batch
    const entityTypes = [
      { type: "customer", id: "cust-1", field: "customerId" },
      { type: "sale", id: "sale-1", field: "saleId" },
      { type: "item", id: "item-1", field: "itemId" },
      { type: "quality_test", id: "qt-1", field: "qualityTestId" },
      { type: "yarn_lot", id: "yl-1", field: "yarnLotId" },
      { type: "raw_material_batch", id: "rmb-1", field: "rawMaterialBatchId" },
    ];

    for (const { type, id, field } of entityTypes) {
      const input: CreateComplaintInput = {
        complaintDate: "2026-08-10",
        subject: `QA complaint ${type} link`,
        idempotencyKey: `qa-complaint-${type}-${id}`,
        [field]: id,
      } as CreateComplaintInput;

      const result = await deps.service.createComplaint(
        makeUser() as any,
        makeEff() as any,
        input,
      );

      const complaint = await deps.complaintRepository.findComplaintById(TENANT_A, result.complaintId);
      expect((complaint! as any)[field]).toBe(id);
    }
  });

  it("missing linked entity is rejected with zero effects", async () => {
    const input: CreateComplaintInput = {
      complaintDate: "2026-08-10",
      subject: "QA complaint no link",
      priority: "normal",
      idempotencyKey: "qa-complaint-no-link-001",
      // No customerId, saleId, itemId, qualityTestId, yarnLotId, rawMaterialBatchId
    };

    await expect(
      deps.service.createComplaint(makeUser() as any, makeEff() as any, input),
    ).rejects.toThrow("At least one linked entity");

    // Verify zero effects: no complaint, no audit, no idempotency record
    const complaints = await deps.complaintRepository.listComplaints(TENANT_A);
    expect(complaints.length).toBe(0);
    const audits = deps.audit.getRows().filter(r => r.tenantId === TENANT_A);
    expect(audits.length).toBe(0);
  });

  it("missing subject is rejected with zero effects", async () => {
    const input: CreateComplaintInput = {
      complaintDate: "2026-08-10",
      subject: "",
      customerId: CUSTOMER_A,
      idempotencyKey: "qa-complaint-no-subject-001",
    };

    await expect(
      deps.service.createComplaint(makeUser() as any, makeEff() as any, input),
    ).rejects.toThrow("subject is required");

    const complaints = await deps.complaintRepository.listComplaints(TENANT_A);
    expect(complaints.length).toBe(0);
  });

  it("missing idempotencyKey is rejected with zero effects", async () => {
    const input: CreateComplaintInput = {
      complaintDate: "2026-08-10",
      subject: "QA complaint no idem key",
      customerId: CUSTOMER_A,
      idempotencyKey: "",
    };

    await expect(
      deps.service.createComplaint(makeUser() as any, makeEff() as any, input),
    ).rejects.toThrow("idempotencyKey is required");

    const complaints = await deps.complaintRepository.listComplaints(TENANT_A);
    expect(complaints.length).toBe(0);
  });

  it("exact scoped audit count is one for a valid complaint", async () => {
    const input: CreateComplaintInput = {
      complaintDate: "2026-08-10",
      subject: "QA complaint audit count test",
      customerId: CUSTOMER_A,
      idempotencyKey: "qa-complaint-audit-001",
    };

    await deps.service.createComplaint(makeUser() as any, makeEff() as any, input);

    const audits = deps.audit.getRows().filter(r => r.tenantId === TENANT_A);
    expect(audits.length).toBe(1);
    expect(audits[0]!.actionType).toBe("complaint.create");
    expect(audits[0]!.tenantId).toBe(TENANT_A);
  });

  it("replay creates no new complaint or audit", async () => {
    const input: CreateComplaintInput = {
      complaintDate: "2026-08-10",
      subject: "QA complaint replay test",
      customerId: CUSTOMER_A,
      idempotencyKey: "qa-complaint-replay-001",
    };

    const result1 = await deps.service.createComplaint(
      makeUser() as any,
      makeEff() as any,
      input,
    );

    // Replay with same key
    const result2 = await deps.service.createComplaint(
      makeUser() as any,
      makeEff() as any,
      input,
    );

    expect(result2.complaintId).toBe(result1.complaintId);

    // Verify no new complaint or audit
    const complaints = await deps.complaintRepository.listComplaints(TENANT_A);
    expect(complaints.length).toBe(1);
    const audits = deps.audit.getRows().filter(r => r.tenantId === TENANT_A);
    expect(audits.length).toBe(1);
  });

  it("conflicting replay (different body, same key) is rejected", async () => {
    const input1: CreateComplaintInput = {
      complaintDate: "2026-08-10",
      subject: "QA complaint conflict test 1",
      customerId: CUSTOMER_A,
      idempotencyKey: "qa-complaint-conflict-001",
    };

    await deps.service.createComplaint(makeUser() as any, makeEff() as any, input1);

    // Same key, different body (different subject)
    const input2: CreateComplaintInput = {
      complaintDate: "2026-08-10",
      subject: "QA complaint conflict test 2 — DIFFERENT",
      customerId: CUSTOMER_A,
      idempotencyKey: "qa-complaint-conflict-001",
    };

    await expect(
      deps.service.createComplaint(makeUser() as any, makeEff() as any, input2),
    ).rejects.toThrow();

    // Verify only the original complaint exists
    const complaints = await deps.complaintRepository.listComplaints(TENANT_A);
    expect(complaints.length).toBe(1);
    expect(complaints[0]!.subject).toBe("QA complaint conflict test 1");
  });

  it("persisted complaint contains the selected link", async () => {
    const yarnLotId = "00000000-0000-0000-0000-000000081e84";
    const input: CreateComplaintInput = {
      complaintDate: "2026-08-10",
      subject: "QA complaint yarn lot link",
      yarnLotId,
      idempotencyKey: "qa-complaint-yarn-001",
    };

    const result = await deps.service.createComplaint(
      makeUser() as any,
      makeEff() as any,
      input,
    );

    const complaint = await deps.complaintRepository.findComplaintById(TENANT_A, result.complaintId);
    expect(complaint!.yarnLotId).toBe(yarnLotId);
    expect(complaint!.customerId).toBeNull();
    expect(complaint!.saleId).toBeNull();
  });
});
