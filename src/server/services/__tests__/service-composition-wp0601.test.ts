/**
 * WP-06-01 Production Wiring Tests.
 *
 * Proves that:
 * 1. createQualityHoldChecker produces a working callback
 * 2. assertQualityHoldCheckerWired throws when the checker is missing
 * 3. assertQualityHoldCheckerWired passes when the checker is present
 * 4. SalesSubmissionService with the hold checker rejects items with active holds
 */
import { describe, it, expect } from "vitest";
import {
  createQualityHoldChecker,
  assertQualityHoldCheckerWired,
} from "../service-composition-wp0601";
import { InMemoryQualityTestRepository } from "./in-memory-quality-test-repository";
import { SalesSubmissionService } from "../sales-submission-service";
import { InventoryLedgerService } from "../inventory-ledger-service";
import { InMemorySalesRepository } from "./in-memory-sales-repository";
import { InMemoryInventoryLedgerRepository } from "./in-memory-inventory-ledger-repository";
import { InMemoryStockReservationRepository } from "./in-memory-stock-reservation-repository";
import { InProcessAuditStore } from "../audit-service";
import { InProcessIdempotencyStore } from "../idempotency-service";
import { InProcessDocumentSequenceStore } from "../document-sequence-service";
import { TEST_USERS } from "@/server/security/role-fixtures";

const TEST_TENANT_ID = "00000000-0000-0000-0000-000000060001";
const TEST_ITEM_ID = "00000000-0000-4000-8000-000000060001";
const TEST_LOCATION_ID = "00000000-0000-4000-8000-000000060002";
const TEST_CUSTOMER_ID = "00000000-0000-4000-8000-cccc00060001";

function makeUser(userId: string, tenantId: string = TEST_TENANT_ID) {
  return { authenticated: true as const, userId, tenantId, email: "t@e.com", name: "T", authId: "t" };
}
function makeOwnerEff() {
  return {
    assignedRoleCodes: ["owner"],
    permissionKeys: new Set([
      "sales.create","sales.submit","sales.view_price","sales.approve",
      "inventory.receive.approve","inventory.receive.create",
      "quality_tests.create","quality_risk_sales.approve",
    ]),
    deniedFieldKeys: new Set(),
    workerFinancialDeny: false,
  } as any;
}

describe("WP-06-01 production wiring", () => {
  it("createQualityHoldChecker produces a working callback", async () => {
    const qualityTestRepo = new InMemoryQualityTestRepository();
    const checker = createQualityHoldChecker(qualityTestRepo);

    // Insert a hold directly
    await qualityTestRepo.insertQualityHold({
      tenantId: TEST_TENANT_ID,
      qualityTestId: "test-001",
      linkedEntityType: "inventory_item",
      linkedEntityId: TEST_ITEM_ID,
      holdReason: "blocked",
      createdBy: TEST_USERS.quality.userId,
    });

    const holds = await checker(TEST_TENANT_ID, "inventory_item", TEST_ITEM_ID);
    expect(holds.length).toBe(1);
    expect(holds[0]!.holdReason).toBe("blocked");
    expect(holds[0]!.holdStatus).toBe("active");
  });

  it("assertQualityHoldCheckerWired throws when checker is missing", () => {
    const deps = { findItem: undefined, findLocation: undefined, findActiveQualityHolds: undefined };
    expect(() => assertQualityHoldCheckerWired(deps, "test-context")).toThrow("PRODUCTION_WIRING_ERROR");
  });

  it("assertQualityHoldCheckerWired passes when checker is present", () => {
    const qualityTestRepo = new InMemoryQualityTestRepository();
    const deps = {
      findActiveQualityHolds: createQualityHoldChecker(qualityTestRepo),
    };
    expect(() => assertQualityHoldCheckerWired(deps, "test-context")).not.toThrow();
  });

  it("SalesSubmissionService with hold checker rejects items with active quality holds", async () => {
    const qualityTestRepo = new InMemoryQualityTestRepository();
    const salesRepository = new InMemorySalesRepository();
    const ledgerRepo = new InMemoryInventoryLedgerRepository();
    const reservationRepo = new InMemoryStockReservationRepository();
    const audit = new InProcessAuditStore();
    const idempotency = new InProcessIdempotencyStore();
    const documentSequence = new InProcessDocumentSequenceStore();
    const inventoryLedger = new InventoryLedgerService({ ledger: ledgerRepo, audit, idempotency, documentSequence });

    // Seed stock
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();
    await inventoryLedger.postRawReceipt(ownerUser as any, ownerEff as any, {
      itemId: TEST_ITEM_ID, toLocationId: TEST_LOCATION_ID, quantityKg: "10000.000",
      movementDate: "2026-07-06", sourceDocumentType: "test_seed", sourceDocumentId: "seed-001",
      idempotencyKey: "seed-key-001",
    });

    // Create a quality hold on the item
    await qualityTestRepo.insertQualityHold({
      tenantId: TEST_TENANT_ID,
      qualityTestId: "test-blocked-001",
      linkedEntityType: "inventory_item",
      linkedEntityId: TEST_ITEM_ID,
      holdReason: "blocked",
      createdBy: TEST_USERS.quality.userId,
    });

    // Wire SalesSubmissionService WITH the hold checker
    const submissionService = new SalesSubmissionService({
      salesRepository,
      reservationRepository: reservationRepo,
      inventoryLedger,
      audit,
      idempotency,
      documentSequence,
      findActiveQualityHolds: createQualityHoldChecker(qualityTestRepo),
    });

    // Create a draft sale
    const draft = await salesRepository.insertSaleDraft({
      tenantId: TEST_TENANT_ID,
      docNo: "SO-WIRING-001",
      customerId: TEST_CUSTOMER_ID,
      saleDate: "2026-07-10",
      createdBy: TEST_USERS.owner.userId,
    });
    await salesRepository.insertSaleLine({
      tenantId: TEST_TENANT_ID,
      salesOrderId: draft.id,
      lineNo: 1,
      itemId: TEST_ITEM_ID,
      locationId: TEST_LOCATION_ID,
      quantityKg: "1000.000",
      pricePerTon: "80.00",
    });

    // Submit — should REJECT because of the quality hold
    await expect(submissionService.submitSale(ownerUser as any, ownerEff as any, {
      saleId: draft.id,
      idempotencyKey: "submit-wiring-001",
    })).rejects.toThrow(/Active quality hold/);
  });

  it("SalesSubmissionService with hold checker allows items with NO active holds", async () => {
    const qualityTestRepo = new InMemoryQualityTestRepository();
    const salesRepository = new InMemorySalesRepository();
    const ledgerRepo = new InMemoryInventoryLedgerRepository();
    const reservationRepo = new InMemoryStockReservationRepository();
    const audit = new InProcessAuditStore();
    const idempotency = new InProcessIdempotencyStore();
    const documentSequence = new InProcessDocumentSequenceStore();
    const inventoryLedger = new InventoryLedgerService({ ledger: ledgerRepo, audit, idempotency, documentSequence });

    // Seed stock
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();
    await inventoryLedger.postRawReceipt(ownerUser as any, ownerEff as any, {
      itemId: TEST_ITEM_ID, toLocationId: TEST_LOCATION_ID, quantityKg: "10000.000",
      movementDate: "2026-07-06", sourceDocumentType: "test_seed", sourceDocumentId: "seed-002",
      idempotencyKey: "seed-key-002",
    });

    // NO quality hold on the item

    const submissionService = new SalesSubmissionService({
      salesRepository,
      reservationRepository: reservationRepo,
      inventoryLedger,
      audit,
      idempotency,
      documentSequence,
      findActiveQualityHolds: createQualityHoldChecker(qualityTestRepo),
    });

    const draft = await salesRepository.insertSaleDraft({
      tenantId: TEST_TENANT_ID,
      docNo: "SO-WIRING-002",
      customerId: TEST_CUSTOMER_ID,
      saleDate: "2026-07-10",
      createdBy: TEST_USERS.owner.userId,
    });
    await salesRepository.insertSaleLine({
      tenantId: TEST_TENANT_ID,
      salesOrderId: draft.id,
      lineNo: 1,
      itemId: TEST_ITEM_ID,
      locationId: TEST_LOCATION_ID,
      quantityKg: "1000.000",
      pricePerTon: "80.00",
    });

    // Submit — should SUCCEED (no holds)
    const result = await submissionService.submitSale(ownerUser as any, ownerEff as any, {
      saleId: draft.id,
      idempotencyKey: "submit-wiring-002",
    });
    expect(result.action).toBe("submitted");
  });
});
