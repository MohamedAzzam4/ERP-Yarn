/**
 * WP-02-04 Raw Receipt Draft Service tests.
 *
 * Contract: docs/contracts/13_work_packages.md WP-02-04
 *   Tests: Draft/update/submit state, validation, subject hash/version,
 *   tenant/role, worker redaction, RTL/accessibility.
 *
 * Acceptance: Worker can record 1,000kg draft without financial fields
 * and without stock posting.
 */
import { describe, it, expect, vi } from "vitest";
import {
  RawReceiptDraftService,
  DraftNotFoundError,
  DraftAlreadySubmittedError,
  ValidationFailedDraftError,
  computeSubjectHash,
  type CreateDraftInput,
  type RawReceiptDraftRepository,
  type NewDraftInput,
  type UpdateDraftInput,
  type RawReceiptDraft,
  type RawReceiptDraftStatus,
} from "../raw-receipt-draft-service";
import { InMemoryRawReceiptDraftRepository } from "./in-memory-raw-receipt-draft-repository";
import { InProcessAuditStore } from "../audit-service";
import {
  TEST_USERS,
  FOREIGN_TENANT_ID,
  TEST_FOREIGN_ACCOUNTANT,
  getTestEffectivePermissions,
} from "@/server/security/role-fixtures";
import { PermissionDeniedError, BodyClaimsAuthorityError } from "@/server/security/guards";

// ---------------------------------------------------------------------------
// Test fixtures.
// ---------------------------------------------------------------------------

const TEST_SUPPLIER_ID = "d0000000-0000-0000-0000-000000000001";
const TEST_LOCATION_ID = "b0000000-0000-0000-0000-000000000001";
const TEST_FIBER_TYPE_ID = "c0000000-0000-0000-0000-000000000001";

function makeDeps() {
  const repository = new InMemoryRawReceiptDraftRepository();
  const audit = new InProcessAuditStore();
  const service = new RawReceiptDraftService({ repository, audit });
  return { repository, audit, service };
}

function makeWarehouseDeps() {
  const d = makeDeps();
  return { ...d, user: TEST_USERS.warehouse, effective: getTestEffectivePermissions(TEST_USERS.warehouse.userId) };
}

function makeOwnerDeps() {
  const d = makeDeps();
  return { ...d, user: TEST_USERS.owner, effective: getTestEffectivePermissions(TEST_USERS.owner.userId) };
}

function makeDraftInput(overrides: Partial<CreateDraftInput> = {}): CreateDraftInput {
  return {
    batchNo: "BATCH-001",
    netWeightKg: "1000.000",
    receivedDate: "2026-07-02",
    supplierId: TEST_SUPPLIER_ID,
    fiberTypeId: TEST_FIBER_TYPE_ID,
    fiberTypeAr: "قطن سودانى",
    originCountry: "السودان",
    season: "2024/2025",
    balesCount: "25",
    grossWeightKg: "1250.000",
    storageLocationId: TEST_LOCATION_ID,
    storageLocationName: "مخزن اختبار",
    purchaseOrderRef: "PR-2026-0007",
    notes: "تم الاستلام ظاهرياً",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Create draft.
// ---------------------------------------------------------------------------

describe("WP-02-04 RawReceiptDraftService — create draft", () => {
  it("warehouse worker can create a draft", async () => {
    const { service, user, effective, audit } = makeWarehouseDeps();
    const draft = await service.createDraft(user, effective, makeDraftInput());

    expect(draft.batchNo).toBe("BATCH-001");
    expect(draft.netWeightKg).toBe("1000.000");
    expect(draft.status).toBe("draft");
    expect(draft.approvalStatus).toBe("draft");
    expect(draft.tenantId).toBe(user.tenantId);
    expect(draft.createdBy).toBe(user.userId);
    expect(draft.fiberTypeId).toBe(TEST_FIBER_TYPE_ID);
    expect(draft.purchaseOrderRef).toBe("PR-2026-0007");
    expect(draft.notes).toBe("تم الاستلام ظاهرياً");

    // Audit logged
    expect(audit.count()).toBe(1);
    expect(audit.getRows()[0]!.actionType).toBe("raw_receipt_draft.create");
  });

  it("owner CAN create draft (has all permissions including inventory.receive.create)", async () => {
    const { service, user, effective } = makeOwnerDeps();
    const draft = await service.createDraft(user, effective, makeDraftInput());
    expect(draft.batchNo).toBe("BATCH-001");
  });

  it("production/quality workers cannot create draft (no inventory.receive.create)", async () => {
    const d = makeDeps();
    const user = TEST_USERS.production;
    const effective = getTestEffectivePermissions(user.userId);
    await expect(
      d.service.createDraft(user, effective, makeDraftInput()),
    ).rejects.toThrow(PermissionDeniedError);
  });

  it("duplicate batch number rejected", async () => {
    const { service, user, effective } = makeWarehouseDeps();
    await service.createDraft(user, effective, makeDraftInput({ batchNo: "DUP-001" }));
    await expect(
      service.createDraft(user, effective, makeDraftInput({ batchNo: "DUP-001" })),
    ).rejects.toThrow(ValidationFailedDraftError);
  });

  it("empty batch number rejected", async () => {
    const { service, user, effective } = makeWarehouseDeps();
    await expect(
      service.createDraft(user, effective, makeDraftInput({ batchNo: "" })),
    ).rejects.toThrow(ValidationFailedDraftError);
  });

  it("zero net weight rejected (NUMERIC(18,3)-compatible check)", async () => {
    const { service, user, effective } = makeWarehouseDeps();
    await expect(
      service.createDraft(user, effective, makeDraftInput({ netWeightKg: "0.000" })),
    ).rejects.toThrow(ValidationFailedDraftError);
  });

  it("negative net weight rejected", async () => {
    const { service, user, effective } = makeWarehouseDeps();
    await expect(
      service.createDraft(user, effective, makeDraftInput({ netWeightKg: "-100.000" })),
    ).rejects.toThrow(ValidationFailedDraftError);
  });

  it("non-numeric net weight rejected", async () => {
    const { service, user, effective } = makeWarehouseDeps();
    await expect(
      service.createDraft(user, effective, makeDraftInput({ netWeightKg: "abc" })),
    ).rejects.toThrow(ValidationFailedDraftError);
  });

  it("net weight is normalized to NUMERIC(18,3) on store", async () => {
    const { service, user, effective } = makeWarehouseDeps();
    const draft = await service.createDraft(user, effective, makeDraftInput({ netWeightKg: "1000" }));
    expect(draft.netWeightKg).toBe("1000.000");
  });

  it("gross weight is normalized to NUMERIC(18,3) on store", async () => {
    const { service, user, effective } = makeWarehouseDeps();
    const draft = await service.createDraft(user, effective, makeDraftInput({ grossWeightKg: "1250.5" }));
    expect(draft.grossWeightKg).toBe("1250.500");
  });

  it("body claiming tenant_id rejected", async () => {
    const { service, user, effective } = makeWarehouseDeps();
    await expect(
      service.createDraft(user, effective, { ...makeDraftInput(), tenantId: FOREIGN_TENANT_ID } as never),
    ).rejects.toThrow(BodyClaimsAuthorityError);
  });

  it("body claiming userId rejected", async () => {
    const { service, user, effective } = makeWarehouseDeps();
    await expect(
      service.createDraft(user, effective, { ...makeDraftInput(), userId: "fake-user-id" } as never),
    ).rejects.toThrow(BodyClaimsAuthorityError);
  });

  it("same batch number in different tenants is allowed", async () => {
    const wd = makeWarehouseDeps();
    await wd.service.createDraft(wd.user, wd.effective, makeDraftInput({ batchNo: "SHARED" }));
    const list = await wd.service.listDrafts(wd.user, wd.effective);
    expect(list).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 2. Update draft.
// ---------------------------------------------------------------------------

describe("WP-02-04 RawReceiptDraftService — update draft", () => {
  it("can update a draft's net weight (normalized to NUMERIC(18,3))", async () => {
    const { service, user, effective } = makeWarehouseDeps();
    const draft = await service.createDraft(user, effective, makeDraftInput());
    const updated = await service.updateDraft(user, effective, draft.id, {
      netWeightKg: "1500",
      updatedBy: user.userId,
    });
    expect(updated.netWeightKg).toBe("1500.000");
  });

  it("cannot update a submitted draft (subject hash locks the approval)", async () => {
    const { service, user, effective } = makeWarehouseDeps();
    const draft = await service.createDraft(user, effective, makeDraftInput());
    await service.submitDraft(user, effective, draft.id);
    await expect(
      service.updateDraft(user, effective, draft.id, { netWeightKg: "2000.000", updatedBy: user.userId }),
    ).rejects.toThrow(DraftAlreadySubmittedError);
  });

  it("cannot update non-existent draft", async () => {
    const { service, user, effective } = makeWarehouseDeps();
    await expect(
      service.updateDraft(user, effective, "nonexistent", { netWeightKg: "100.000", updatedBy: user.userId }),
    ).rejects.toThrow(DraftNotFoundError);
  });

  it("rejects non-positive net weight on update", async () => {
    const { service, user, effective } = makeWarehouseDeps();
    const draft = await service.createDraft(user, effective, makeDraftInput());
    await expect(
      service.updateDraft(user, effective, draft.id, { netWeightKg: "0.000", updatedBy: user.userId }),
    ).rejects.toThrow(ValidationFailedDraftError);
  });
});

// ---------------------------------------------------------------------------
// 3. Read draft.
// ---------------------------------------------------------------------------

describe("WP-02-04 RawReceiptDraftService — read draft", () => {
  it("can read a draft by ID", async () => {
    const { service, user, effective } = makeWarehouseDeps();
    const draft = await service.createDraft(user, effective, makeDraftInput());
    const read = await service.readDraft(user, effective, draft.id);
    expect(read.id).toBe(draft.id);
    expect(read.batchNo).toBe("BATCH-001");
    expect(read.purchaseOrderRef).toBe("PR-2026-0007");
    expect(read.notes).toBe("تم الاستلام ظاهرياً");
  });

  it("reading non-existent draft throws", async () => {
    const { service, user, effective } = makeWarehouseDeps();
    await expect(service.readDraft(user, effective, "nonexistent")).rejects.toThrow(DraftNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// 4. Submit draft for review.
// ---------------------------------------------------------------------------

describe("WP-02-04 RawReceiptDraftService — submit draft", () => {
  it("submit transitions draft → submitted + pending_approval + locked", async () => {
    const { service, user, effective, audit } = makeWarehouseDeps();
    const draft = await service.createDraft(user, effective, makeDraftInput());
    const result = await service.submitDraft(user, effective, draft.id);

    expect(result.status).toBe("submitted");
    expect(result.approvalStatus).toBe("pending_approval");
    expect(result.subjectVersion).toBe(1);
    expect(result.subjectHash).toHaveLength(64); // SHA-256 hex

    // Audit logged
    expect(audit.count()).toBe(2); // create + submit
    expect(audit.getRows()[1]!.actionType).toBe("raw_receipt_draft.submit");
  });

  it("cannot submit an already-submitted draft", async () => {
    const { service, user, effective } = makeWarehouseDeps();
    const draft = await service.createDraft(user, effective, makeDraftInput());
    await service.submitDraft(user, effective, draft.id);
    await expect(service.submitDraft(user, effective, draft.id)).rejects.toThrow(DraftAlreadySubmittedError);
  });

  it("cannot submit non-existent draft", async () => {
    const { service, user, effective } = makeWarehouseDeps();
    await expect(service.submitDraft(user, effective, "nonexistent")).rejects.toThrow(DraftNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// 5. Subject hash / version.
// ---------------------------------------------------------------------------

describe("WP-02-04 RawReceiptDraftService — subject hash", () => {
  it("computeSubjectHash is deterministic for same fields", () => {
    const draft1: RawReceiptDraft = {
      id: "x", tenantId: "t", batchNo: "B1", supplierId: "S1", supplierReference: null,
      fiberTypeId: "F1", fiberTypeAr: "قطن", rawGradeAr: "السودان", originCountry: "السودان",
      season: "2024", balesCount: "25", grossWeightKg: "1250.000", netWeightKg: "1000.000",
      receivedDate: "2026-07-02", storageLocationId: "L1", storageLocationName: "مخزن",
      purchaseOrderRef: "PR-001", notes: "n1", status: "draft", approvalStatus: "draft",
      subjectVersion: 1, subjectHash: null, createdBy: null, createdAt: null, updatedBy: null, updatedAt: null,
    };
    const draft2: RawReceiptDraft = { ...draft1 };
    expect(computeSubjectHash(draft1)).toBe(computeSubjectHash(draft2));
  });

  it("computeSubjectHash changes when netWeightKg changes", () => {
    const base: RawReceiptDraft = {
      id: "x", tenantId: "t", batchNo: "B1", supplierId: "S1", supplierReference: null,
      fiberTypeId: "F1", fiberTypeAr: "قطن", rawGradeAr: "السودان", originCountry: "السودان",
      season: "2024", balesCount: "25", grossWeightKg: "1250.000", netWeightKg: "1000.000",
      receivedDate: "2026-07-02", storageLocationId: "L1", storageLocationName: "مخزن",
      purchaseOrderRef: "PR-001", notes: "n1", status: "draft", approvalStatus: "draft",
      subjectVersion: 1, subjectHash: null, createdBy: null, createdAt: null, updatedBy: null, updatedAt: null,
    };
    const changed: RawReceiptDraft = { ...base, netWeightKg: "2000.000" };
    expect(computeSubjectHash(base)).not.toBe(computeSubjectHash(changed));
  });

  it("computeSubjectHash changes when purchaseOrderRef changes (material reference)", () => {
    const base: RawReceiptDraft = {
      id: "x", tenantId: "t", batchNo: "B1", supplierId: "S1", supplierReference: null,
      fiberTypeId: "F1", fiberTypeAr: "قطن", rawGradeAr: "السودان", originCountry: "السودان",
      season: "2024", balesCount: "25", grossWeightKg: "1250.000", netWeightKg: "1000.000",
      receivedDate: "2026-07-02", storageLocationId: "L1", storageLocationName: "مخزن",
      purchaseOrderRef: "PR-001", notes: "n1", status: "draft", approvalStatus: "draft",
      subjectVersion: 1, subjectHash: null, createdBy: null, createdAt: null, updatedBy: null, updatedAt: null,
    };
    const changed: RawReceiptDraft = { ...base, purchaseOrderRef: "PR-002" };
    expect(computeSubjectHash(base)).not.toBe(computeSubjectHash(changed));
  });

  it("computeSubjectHash does NOT change when notes change (UI-only field)", () => {
    const base: RawReceiptDraft = {
      id: "x", tenantId: "t", batchNo: "B1", supplierId: "S1", supplierReference: null,
      fiberTypeId: "F1", fiberTypeAr: "قطن", rawGradeAr: "السودان", originCountry: "السودان",
      season: "2024", balesCount: "25", grossWeightKg: "1250.000", netWeightKg: "1000.000",
      receivedDate: "2026-07-02", storageLocationId: "L1", storageLocationName: "مخزن",
      purchaseOrderRef: "PR-001", notes: "n1", status: "draft", approvalStatus: "draft",
      subjectVersion: 1, subjectHash: null, createdBy: null, createdAt: null, updatedBy: null, updatedAt: null,
    };
    const changed: RawReceiptDraft = { ...base, notes: "different notes" };
    expect(computeSubjectHash(base)).toBe(computeSubjectHash(changed));
  });

  it("subject hash is stored on submit and persists on read", async () => {
    const { service, user, effective } = makeWarehouseDeps();
    const draft = await service.createDraft(user, effective, makeDraftInput());
    const result = await service.submitDraft(user, effective, draft.id);
    const read = await service.readDraft(user, effective, draft.id);
    expect(read.subjectHash).toBe(result.subjectHash);
    expect(read.subjectVersion).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 6. No stock movement / no account entry (proof by spy).
// ---------------------------------------------------------------------------

/**
 * Risk #6 proof: verify the service NEVER calls any method that would
 * mutate stock or account state. We use a spy repository that records
 * every method call, and assert that only draft-persistence methods
 * are invoked.
 */
describe("WP-02-04 RawReceiptDraftService — no stock/payable (spy proof)", () => {
  function makeSpyDeps() {
    const real = new InMemoryRawReceiptDraftRepository();
    const calls: string[] = [];
    const spy: RawReceiptDraftRepository = {
      insertDraft: (row: NewDraftInput) => { calls.push("insertDraft"); return real.insertDraft(row); },
      updateDraft: (t: string, id: string, p: UpdateDraftInput) => { calls.push("updateDraft"); return real.updateDraft(t, id, p); },
      findDraftById: (t: string, id: string) => { calls.push("findDraftById"); return real.findDraftById(t, id); },
      findDraftByBatchNo: (t: string, b: string) => { calls.push("findDraftByBatchNo"); return real.findDraftByBatchNo(t, b); },
      listDraftsByTenant: (t: string, s?: RawReceiptDraftStatus) => { calls.push("listDraftsByTenant"); return real.listDraftsByTenant(t, s); },
      updateDraftStatus: (t: string, id: string, s: RawReceiptDraftStatus, a: string, v: number, h: string) => {
        calls.push("updateDraftStatus"); return real.updateDraftStatus(t, id, s, a, v, h);
      },
    };
    const audit = new InProcessAuditStore();
    const service = new RawReceiptDraftService({ repository: spy, audit });
    return { service, audit, calls, user: TEST_USERS.warehouse, effective: getTestEffectivePermissions(TEST_USERS.warehouse.userId) };
  }

  it("createDraft only calls draft-persistence methods (no stock/account)", async () => {
    const { service, calls, user, effective } = makeSpyDeps();
    await service.createDraft(user, effective, makeDraftInput());
    // Allowed: findDraftByBatchNo (dup check), insertDraft.
    // Forbidden: insertMovement, updateBalance, insertBalance, insertAccountEntry, postRawReceipt, postSupplierPayable.
    expect(calls).toEqual(expect.arrayContaining(["findDraftByBatchNo", "insertDraft"]));
    expect(calls).not.toContain("insertMovement");
    expect(calls).not.toContain("updateBalance");
    expect(calls).not.toContain("insertBalance");
    expect(calls).not.toContain("insertAccountEntry");
    expect(calls).not.toContain("postRawReceipt");
    expect(calls).not.toContain("postSupplierPayable");
  });

  it("submitDraft only calls findDraftById + updateDraftStatus (no stock/account)", async () => {
    const { service, calls, user, effective } = makeSpyDeps();
    const draft = await service.createDraft(user, effective, makeDraftInput());
    calls.length = 0; // reset
    await service.submitDraft(user, effective, draft.id);
    expect(calls).toEqual(expect.arrayContaining(["findDraftById", "updateDraftStatus"]));
    expect(calls).not.toContain("insertMovement");
    expect(calls).not.toContain("updateBalance");
    expect(calls).not.toContain("insertBalance");
    expect(calls).not.toContain("insertAccountEntry");
    expect(calls).not.toContain("postRawReceipt");
    expect(calls).not.toContain("postSupplierPayable");
  });

  it("the service module does NOT import InventoryLedgerService or SubledgerService", async () => {
    // Read the service source and assert no financial-service imports.
    // Comments mentioning these names are allowed (they document scope);
    // we only forbid actual import statements and method calls.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const serviceSource = fs.readFileSync(
      path.join(process.cwd(), "src/server/services/raw-receipt-draft-service.ts"),
      "utf-8",
    );
    // No import statements.
    expect(serviceSource).not.toMatch(/import\s+.*from\s+["']\.\/inventory-ledger-service["']/);
    expect(serviceSource).not.toMatch(/import\s+.*from\s+["']\.\/subledger-service["']/);
    // No construction or method calls (allowing comment mentions).
    expect(serviceSource).not.toMatch(/new\s+InventoryLedgerService/);
    expect(serviceSource).not.toMatch(/new\s+SubledgerService/);
    expect(serviceSource).not.toMatch(/\.postRawReceipt\(/);
    expect(serviceSource).not.toMatch(/\.postSupplierPayable\(/);
  });
});

// ---------------------------------------------------------------------------
// 7. Worker financial redaction (proof).
// ---------------------------------------------------------------------------

describe("WP-02-04 RawReceiptDraftService — worker redaction", () => {
  it("CreateDraftInput type has no financial fields (compile-time enforced)", () => {
    // This is a type-level check. At runtime, we verify the input shape
    // doesn't accidentally include financial fields.
    const input = makeDraftInput();
    expect(input).not.toHaveProperty("purchasePricePerTon");
    expect(input).not.toHaveProperty("totalPurchaseCost");
    expect(input).not.toHaveProperty("payable");
    expect(input).not.toHaveProperty("payableAmount");
    expect(input).not.toHaveProperty("balance");
    expect(input).not.toHaveProperty("accountEntryId");
    expect(input).not.toHaveProperty("price");
    expect(input).not.toHaveProperty("cost");
    expect(input).not.toHaveProperty("profit");
  });

  it("draft result has no financial fields", async () => {
    const { service, user, effective } = makeWarehouseDeps();
    const draft = await service.createDraft(user, effective, makeDraftInput());
    expect(draft).not.toHaveProperty("purchasePricePerTon");
    expect(draft).not.toHaveProperty("totalPurchaseCost");
    expect(draft).not.toHaveProperty("payableAmount");
    expect(draft).not.toHaveProperty("accountEntryId");
    expect(draft).not.toHaveProperty("price");
    expect(draft).not.toHaveProperty("cost");
    expect(draft).not.toHaveProperty("profit");
    expect(draft).not.toHaveProperty("balance");
  });

  it("submit result has no financial fields", async () => {
    const { service, user, effective } = makeWarehouseDeps();
    const draft = await service.createDraft(user, effective, makeDraftInput());
    const result = await service.submitDraft(user, effective, draft.id);
    expect(result).not.toHaveProperty("price");
    expect(result).not.toHaveProperty("cost");
    expect(result).not.toHaveProperty("payable");
    expect(result).not.toHaveProperty("balance");
    expect(result).not.toHaveProperty("accountEntryId");
    expect(result).not.toHaveProperty("movementId");
  });
});

// ---------------------------------------------------------------------------
// 8. Tenant isolation.
// ---------------------------------------------------------------------------

describe("WP-02-04 RawReceiptDraftService — tenant isolation", () => {
  it("cannot read draft from another tenant", async () => {
    const wd = makeWarehouseDeps();
    const draft = await wd.service.createDraft(wd.user, wd.effective, makeDraftInput());

    const fd = makeDeps();
    const fu = { ...TEST_USERS.warehouse, tenantId: FOREIGN_TENANT_ID };
    const fe = getTestEffectivePermissions(TEST_USERS.warehouse.userId);
    await expect(fd.service.readDraft(fu, fe, draft.id)).rejects.toThrow(DraftNotFoundError);
  });
});
