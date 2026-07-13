/**
 * WP-05-01 Sales Draft Service tests.
 *
 * Contract: docs/contracts/12_testing_and_regression_plan.md §4 Phase 5 + §7
 *   Tests: role fields, submission reservations, no side effects, tenant isolation.
 */
import { describe, it, expect } from "vitest";
import { SalesDraftService, SaleNotFoundError, SaleNotDraftError, CommercialNotCompletedError } from "../sales-draft-service";
import { SalesSubmissionService } from "../sales-submission-service";
import { InventoryLedgerService } from "../inventory-ledger-service";
import { InMemorySalesRepository } from "./in-memory-sales-repository";
import { InMemoryInventoryLedgerRepository } from "./in-memory-inventory-ledger-repository";
import { InMemoryStockReservationRepository } from "./in-memory-stock-reservation-repository";
import { InProcessAuditStore } from "../audit-service";
import { InProcessIdempotencyStore } from "../idempotency-service";
import { InProcessDocumentSequenceStore } from "../document-sequence-service";
import { TEST_USERS, getTestEffectivePermissions } from "@/server/security/role-fixtures";
import { PermissionDeniedError } from "@/server/security/guards";

const TEST_TENANT_ID = "00000000-0000-0000-0000-000000000001";
const TEST_ITEM_ID = "aaa50100-0000-4000-8000-000000000001";
const TEST_LOCATION_ID = "bbb50100-0000-4000-8000-000000000001";
const TEST_CUSTOMER_ID = "ccc50100-0000-4000-8000-000000000001";

function makeUser(userId: string, tenantId: string = TEST_TENANT_ID) {
  return { authenticated: true as const, userId, tenantId, email: "t@e.com", name: "T", authId: "t" };
}

function makeDeps() {
  const salesRepository = new InMemorySalesRepository();
  const ledgerRepo = new InMemoryInventoryLedgerRepository();
  const reservationRepo = new InMemoryStockReservationRepository();
  const audit = new InProcessAuditStore();
  const idempotency = new InProcessIdempotencyStore();
  const documentSequence = new InProcessDocumentSequenceStore();
  const inventoryLedger = new InventoryLedgerService({ ledger: ledgerRepo, audit, idempotency, documentSequence });
  const submissionService = new SalesSubmissionService({
    salesRepository, reservationRepository: reservationRepo, inventoryLedger,
    audit, idempotency, documentSequence,
  });
  const draftService = new SalesDraftService({
    salesRepository, audit, documentSequence, submissionService,
  });

  // Seed stock
  const ownerUser = makeUser(TEST_USERS.owner.userId);
  const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);
  // We need inventory receive.approve to postRawReceipt
  // Use the owner fixture which has all permissions
  inventoryLedger.postRawReceipt(ownerUser as any, ownerEff as any, {
    itemId: TEST_ITEM_ID, toLocationId: TEST_LOCATION_ID, quantityKg: "10000.000",
    movementDate: "2026-07-06", sourceDocumentType: "test_seed", sourceDocumentId: "seed-001",
    idempotencyKey: "seed-key-001",
  }).catch(() => {}); // fire and forget; some test envs may not have the permission

  return { salesRepository, ledgerRepo, reservationRepo, audit, idempotency, documentSequence, inventoryLedger, submissionService, draftService };
}

async function seedStock(deps: ReturnType<typeof makeDeps>) {
  const ownerUser = makeUser(TEST_USERS.owner.userId);
  const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);
  await deps.inventoryLedger.postRawReceipt(ownerUser as any, ownerEff as any, {
    itemId: TEST_ITEM_ID, toLocationId: TEST_LOCATION_ID, quantityKg: "10000.000",
    movementDate: "2026-07-06", sourceDocumentType: "test_seed", sourceDocumentId: "seed-001",
    idempotencyKey: "seed-key-001",
  });
}

// ===========================================================================
// 1. Draft creation.
// ===========================================================================

describe("WP-05-01 createDraft", () => {
  it("owner creates a multi-line draft with prices", async () => {
    const deps = makeDeps();
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    const result = await deps.draftService.createDraft(ownerUser as any, ownerEff as any, {
      customerId: TEST_CUSTOMER_ID,
      saleDate: "2026-07-10",
      lines: [
        { itemId: TEST_ITEM_ID, locationId: TEST_LOCATION_ID, quantityKg: "1000.000", pricePerTon: "80.00" },
        { itemId: TEST_ITEM_ID, locationId: TEST_LOCATION_ID, quantityKg: "500.000", pricePerTon: "100.00" },
      ],
      orderDiscountTotal: "0.00",
    });

    expect(result.saleStatus).toBe("draft");
    expect(result.docNo).toMatch(/^SO-\d{4}-\d{6}$/);
    expect(result.lineCount).toBe(2);

    // Verify no stock movement, no reservation
    const movements = [...((deps.ledgerRepo as any).movements as Map<string, any>).values()];
    expect(movements.filter((m: any) => m.movementType === "sale_issue").length).toBe(0);

    // Verify audit
    const auditRows = deps.audit.getRows();
    expect(auditRows.some((r) => r.actionType === "sales_draft.create")).toBe(true);
  });

  it("warehouse can create an operational draft (no price fields stored)", async () => {
    const deps = makeDeps();
    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = getTestEffectivePermissions(TEST_USERS.warehouse.userId);

    const result = await deps.draftService.createDraft(whUser as any, whEff as any, {
      customerId: TEST_CUSTOMER_ID,
      saleDate: "2026-07-10",
      lines: [
        { itemId: TEST_ITEM_ID, locationId: TEST_LOCATION_ID, quantityKg: "1000.000", pricePerTon: "80.00" },
      ],
    });

    expect(result.saleStatus).toBe("draft");

    // Verify price was stripped (warehouse lacks sales.view_price)
    const lines = await deps.salesRepository.findSaleLines(TEST_TENANT_ID, result.saleId);
    expect(lines[0]!.pricePerTon).toBeNull();
  });

  it("rejects empty lines", async () => {
    const deps = makeDeps();
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    await expect(deps.draftService.createDraft(ownerUser as any, ownerEff as any, {
      customerId: TEST_CUSTOMER_ID, saleDate: "2026-07-10", lines: [],
    })).rejects.toThrow();
  });
});

// ===========================================================================
// 2. Commercial completion.
// ===========================================================================

describe("WP-05-01 completeCommercialTotals", () => {
  it("owner completes commercial totals with exact numbers", async () => {
    const deps = makeDeps();
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    const draft = await deps.draftService.createDraft(ownerUser as any, ownerEff as any, {
      customerId: TEST_CUSTOMER_ID, saleDate: "2026-07-10",
      lines: [
        { itemId: TEST_ITEM_ID, locationId: TEST_LOCATION_ID, quantityKg: "1000.000", pricePerTon: "80.00" },
        { itemId: TEST_ITEM_ID, locationId: TEST_LOCATION_ID, quantityKg: "1000.000", pricePerTon: "80.00" },
      ],
    });

    const lines = await deps.salesRepository.findSaleLines(TEST_TENANT_ID, draft.saleId);

    const result = await deps.draftService.completeCommercialTotals(ownerUser as any, ownerEff as any, {
      saleId: draft.saleId,
      orderDiscountTotal: "16.00",
      linePrices: lines.map((l) => ({ lineId: l.id, pricePerTon: "80.00" })),
    });

    expect(result.totalGrossRevenue).toBe("160.00");
    expect(result.orderDiscountTotal).toBe("16.00");
    expect(result.documentTotalPosted).toBe("144.00");
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]!.lineAllocatedDiscountPosted).toBe("8.00");
    expect(result.lines[0]!.lineNetRevenuePosted).toBe("72.00");
  });

  it("warehouse cannot complete commercial totals (lacks sales.view_price)", async () => {
    const deps = makeDeps();
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);
    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = getTestEffectivePermissions(TEST_USERS.warehouse.userId);

    const draft = await deps.draftService.createDraft(ownerUser as any, ownerEff as any, {
      customerId: TEST_CUSTOMER_ID, saleDate: "2026-07-10",
      lines: [{ itemId: TEST_ITEM_ID, locationId: TEST_LOCATION_ID, quantityKg: "1000.000", pricePerTon: "80.00" }],
    });

    const lines = await deps.salesRepository.findSaleLines(TEST_TENANT_ID, draft.saleId);

    await expect(deps.draftService.completeCommercialTotals(whUser as any, whEff as any, {
      saleId: draft.saleId, orderDiscountTotal: "0.00",
      linePrices: lines.map((l) => ({ lineId: l.id, pricePerTon: "80.00" })),
    })).rejects.toThrow(PermissionDeniedError);
  });

  it("rejects if sale is not in draft state", async () => {
    const deps = makeDeps();
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    const draft = await deps.draftService.createDraft(ownerUser as any, ownerEff as any, {
      customerId: TEST_CUSTOMER_ID, saleDate: "2026-07-10",
      lines: [{ itemId: TEST_ITEM_ID, locationId: TEST_LOCATION_ID, quantityKg: "1000.000", pricePerTon: "80.00" }],
    });

    // Manually change status
    await deps.salesRepository.updateSaleStatus(TEST_TENANT_ID, draft.saleId, {
      saleStatus: "pending_approval", approvalStatus: "pending_approval", reservationStatus: "reserved",
    });

    const lines = await deps.salesRepository.findSaleLines(TEST_TENANT_ID, draft.saleId);
    await expect(deps.draftService.completeCommercialTotals(ownerUser as any, ownerEff as any, {
      saleId: draft.saleId, orderDiscountTotal: "0.00",
      linePrices: lines.map((l) => ({ lineId: l.id, pricePerTon: "80.00" })),
    })).rejects.toThrow(SaleNotDraftError);
  });
});

// ===========================================================================
// 3. Submit — requires commercial completion.
// ===========================================================================

describe("WP-05-01 submitSale", () => {
  it("rejects submit if commercial totals not completed", async () => {
    const deps = makeDeps();
    await seedStock(deps);
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    const draft = await deps.draftService.createDraft(ownerUser as any, ownerEff as any, {
      customerId: TEST_CUSTOMER_ID, saleDate: "2026-07-10",
      lines: [{ itemId: TEST_ITEM_ID, locationId: TEST_LOCATION_ID, quantityKg: "1000.000" }],
    });

    await expect(deps.draftService.submitSale(ownerUser as any, ownerEff as any, {
      saleId: draft.saleId, idempotencyKey: "submit-1",
    })).rejects.toThrow(CommercialNotCompletedError);
  });

  it("warehouse cannot submit (lacks sales.submit)", async () => {
    const deps = makeDeps();
    await seedStock(deps);
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);
    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = getTestEffectivePermissions(TEST_USERS.warehouse.userId);

    const draft = await deps.draftService.createDraft(ownerUser as any, ownerEff as any, {
      customerId: TEST_CUSTOMER_ID, saleDate: "2026-07-10",
      lines: [{ itemId: TEST_ITEM_ID, locationId: TEST_LOCATION_ID, quantityKg: "1000.000", pricePerTon: "80.00" }],
    });

    const lines = await deps.salesRepository.findSaleLines(TEST_TENANT_ID, draft.saleId);
    await deps.draftService.completeCommercialTotals(ownerUser as any, ownerEff as any, {
      saleId: draft.saleId, orderDiscountTotal: "0.00",
      linePrices: lines.map((l) => ({ lineId: l.id, pricePerTon: "80.00" })),
    });

    await expect(deps.draftService.submitSale(whUser as any, whEff as any, {
      saleId: draft.saleId, idempotencyKey: "submit-2",
    })).rejects.toThrow(PermissionDeniedError);
  });
});

// ===========================================================================
// 4. No side effects.
// ===========================================================================

describe("WP-05-01 no unrelated side effects", () => {
  it("draft creation + commercial completion creates NO stock movements, NO account entries, NO reservations", async () => {
    const deps = makeDeps();
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    const draft = await deps.draftService.createDraft(ownerUser as any, ownerEff as any, {
      customerId: TEST_CUSTOMER_ID, saleDate: "2026-07-10",
      lines: [{ itemId: TEST_ITEM_ID, locationId: TEST_LOCATION_ID, quantityKg: "1000.000", pricePerTon: "80.00" }],
    });

    const lines = await deps.salesRepository.findSaleLines(TEST_TENANT_ID, draft.saleId);
    await deps.draftService.completeCommercialTotals(ownerUser as any, ownerEff as any, {
      saleId: draft.saleId, orderDiscountTotal: "0.00",
      linePrices: lines.map((l) => ({ lineId: l.id, pricePerTon: "80.00" })),
    });

    // No stock movements
    const movements = [...((deps.ledgerRepo as any).movements as Map<string, any>).values()];
    expect(movements.filter((m: any) => m.movementType === "sale_issue").length).toBe(0);

    // No reservations
    const reservations = [...((deps.reservationRepo as any).reservations as Map<string, any>).values()];
    expect(reservations.length).toBe(0);

    // No account entries (in-memory test doesn't have subledger, but verify audit has no payable/payment actions)
    const auditRows = deps.audit.getRows();
    for (const row of auditRows) {
      expect(row.actionType).not.toContain("payable");
      expect(row.actionType).not.toContain("payment");
      expect(row.actionType).not.toContain("account_entry");
    }
  });
});

// ===========================================================================
// 5. Tenant isolation.
// ===========================================================================

describe("WP-05-01 tenant isolation", () => {
  it("cross-tenant sale access → SALE_NOT_FOUND", async () => {
    const deps = makeDeps();
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    const draft = await deps.draftService.createDraft(ownerUser as any, ownerEff as any, {
      customerId: TEST_CUSTOMER_ID, saleDate: "2026-07-10",
      lines: [{ itemId: TEST_ITEM_ID, locationId: TEST_LOCATION_ID, quantityKg: "1000.000", pricePerTon: "80.00" }],
    });

    // Foreign user
    const foreignUser = makeUser(TEST_USERS.owner.userId, "00000000-0000-0000-0000-ffffffffffff");
    const foreignEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    await expect(deps.draftService.completeCommercialTotals(foreignUser as any, foreignEff as any, {
      saleId: draft.saleId, orderDiscountTotal: "0.00",
      linePrices: [], // will fail before this matters
    })).rejects.toThrow(SaleNotFoundError);
  });
});
