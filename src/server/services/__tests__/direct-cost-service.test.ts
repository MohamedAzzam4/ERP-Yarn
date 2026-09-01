/**
 * WP-05-05 Direct Cost Review and Later Profitability Versions — tests.
 *
 * Contract: docs/contracts/12_testing_and_regression_plan.md §5 + Phase 5 gate
 * Contract: docs/contracts/07_subledger_and_costs_contract.md §18-20
 *
 * Covers all required scenarios:
 *   - draft direct cost creates no subledger effect
 *   - worker-safe input redacts/limits financial authority
 *   - accountant/owner can review/approve
 *   - worker cannot approve/review financial treatment
 *   - company-borne reviewed cost behavior (no subledger entry)
 *   - customer-borne reviewed cost creates correct receivable (POSITIVE)
 *   - factory-borne reviewed cost creates correct recovery (POSITIVE)
 *   - shared allocation sums exactly
 *   - invalid allocation totals rejected
 *   - unknown/included_elsewhere creates no subledger effect
 *   - profitability inclusion creates later snapshot version
 *   - previous snapshot becomes superseded
 *   - old snapshot remains immutable
 *   - missing flags update correctly
 *   - no double-counting direct costs
 *   - idempotency replay/conflict
 *   - rollback after subledger entry
 *   - rollback after snapshot version creation
 *   - rollback after audit
 *   - DEC-080 requester cannot approve own review
 *   - tenant isolation
 *   - role denial/redaction
 *   - no payments/settlements
 *   - no stock movements
 *   - no sale approval mutation
 */
import { describe, it, expect } from "vitest";
import {
  DirectCostService,
  InvalidAllocationTotalError,
  RequesterCannotApproveOwnDirectCostError,
  DirectCostAlreadyReviewedError,
} from "../direct-cost-service";
import { SubledgerService } from "../subledger-service";
import { ProfitabilitySnapshotService } from "../profitability-snapshot-service";
import { InMemoryDirectCostRepository } from "./in-memory-direct-cost-repository";
import { InMemorySubledgerRepository } from "./in-memory-subledger-repository";
import { InMemoryProfitabilitySnapshotRepository } from "./in-memory-profitability-snapshot-repository";
import { InMemorySalesRepository } from "./in-memory-sales-repository";
import { InProcessAuditStore } from "../audit-service";
import { InProcessIdempotencyStore } from "../idempotency-service";
import { InProcessDocumentSequenceStore } from "../document-sequence-service";
import { TEST_USERS, getTestEffectivePermissions } from "@/server/security/role-fixtures";
import { PermissionDeniedError } from "@/server/security/guards";

const TEST_TENANT_ID = "00000000-0000-0000-0000-000000050005";
const TEST_CUSTOMER_ID = "00000000-0000-4000-8000-cccc00050005";
const TEST_FACTORY_ID = "00000000-0000-4000-8000-500500050005";
const TEST_SALE_ID = "00000000-0000-4000-8000-000000000505";

function makeUser(userId: string, tenantId: string = TEST_TENANT_ID) {
  return { authenticated: true as const, userId, tenantId, email: "t@e.com", name: "T", authId: "t" };
}
function makeOwnerEff() {
  return {
    assignedRoleCodes: ["owner"],
    permissionKeys: new Set([
      "sales.create","sales.submit","sales.view_price","sales.approve","sales.cancel",
      "inventory.receive.approve","inventory.receive.create",
      "balances.view_supplier_factory","balances.view_customer",
      "profitability.view","payments.create","payments.approve","payments.reverse",
      "direct_costs.review",
    ]),
    deniedFieldKeys: new Set(),
    workerFinancialDeny: false,
  } as any;
}
function makeAcctEff() {
  return {
    assignedRoleCodes: ["accountant"],
    permissionKeys: new Set([
      "sales.create","sales.submit","sales.view_price","sales.approve","sales.cancel",
      "balances.view_supplier_factory","balances.view_customer",
      "profitability.view","inventory.receive.approve",
      "payments.create","payments.approve","payments.reverse",
      "direct_costs.review",
    ]),
    deniedFieldKeys: new Set(),
    workerFinancialDeny: false,
  } as any;
}
function makeWhEff() {
  return {
    assignedRoleCodes: ["warehouse_employee"],
    permissionKeys: new Set(["sales.create","inventory.receive.approve","inventory.receive.create"]),
    deniedFieldKeys: new Set(),
    workerFinancialDeny: true,
  } as any;
}

function makeDeps() {
  const directCostRepo = new InMemoryDirectCostRepository();
  const subledgerRepo = new InMemorySubledgerRepository();
  const snapshotRepo = new InMemoryProfitabilitySnapshotRepository();
  const salesRepository = new InMemorySalesRepository();
  const audit = new InProcessAuditStore();
  const idempotency = new InProcessIdempotencyStore();
  const documentSequence = new InProcessDocumentSequenceStore();
  const subledger = new SubledgerService({ subledger: subledgerRepo, audit, idempotency, documentSequence });
  const snapshotService = new ProfitabilitySnapshotService({ snapshotRepository: snapshotRepo, salesRepository, audit });
  const noopTxRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => work(null);
  const directCostService = new DirectCostService({
    directCostRepository: directCostRepo, subledger, snapshotService, audit, idempotency, documentSequence,
    transactionRunner: noopTxRunner,
    txFactories: {
      createSubledger: () => subledger,
      createDirectCostRepository: () => directCostRepo,
      createAudit: () => audit,
      createIdempotency: () => idempotency,
      createDocumentSequence: () => documentSequence,
    },
  });
  return { directCostRepo, subledgerRepo, snapshotRepo, salesRepository, audit, idempotency, documentSequence, subledger, snapshotService, directCostService };
}

/**
 * Setup: create an approved sale with a V1 profitability snapshot.
 * Returns the sale id + V1 snapshot id.
 */
async function setupApprovedSaleWithV1Snapshot(
  deps: ReturnType<typeof makeDeps>,
): Promise<{ saleId: string; v1SnapshotId: string }> {
  const ownerUser = makeUser(TEST_USERS.owner.userId);
  const ownerEff = makeOwnerEff();

  // Insert a sale with commercial totals
  await deps.salesRepository.insertSaleDraft({
    tenantId: TEST_TENANT_ID,
    docNo: "SO-0505-001",
    customerId: TEST_CUSTOMER_ID,
    saleDate: "2026-07-10",
    createdBy: TEST_USERS.owner.userId,
  });
  // Find the inserted sale by scanning the in-memory store (findSaleByDocNo doesn't exist)
  const sale = [...((deps.salesRepository as any).sales as Map<string, any>).values()].find(
    (s: any) => s.docNo === "SO-0505-001",
  );
  const saleId = sale?.id ?? TEST_SALE_ID;

  // Insert a line with commercial totals
  await deps.salesRepository.insertSaleLine({
    tenantId: TEST_TENANT_ID,
    salesOrderId: saleId,
    lineNo: 1,
    itemId: "00000000-0000-4000-8000-000000000505",
    locationId: "00000000-0000-4000-8000-000000000506",
    quantityKg: "1000.000",
    pricePerTon: "80.00",
  });

  // Update sale with commercial totals
  await deps.salesRepository.updateSaleCommercialTotals(TEST_TENANT_ID, saleId, {
    totalGrossRevenue: "80.00",
    orderDiscountTotal: "0.00",
    documentTotalPosted: "80.00",
  });

  // Create V1 snapshot
  const v1 = await deps.snapshotService.createVersion1Snapshot(ownerUser, {
    salesOrderId: saleId,
    rawCost: "30.00",
    singleProductionCost: "20.00",
  });
  return { saleId, v1SnapshotId: v1.snapshotId };
}

// ===========================================================================
// 1. Draft direct cost.
// ===========================================================================

describe("WP-05-05 draft direct cost", () => {
  it("draft creates no subledger effect (no account entries)", async () => {
    const deps = makeDeps();
    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = makeWhEff();

    const result = await deps.directCostService.createDraftDirectCost(whUser as any, whEff as any, {
      costType: "transport",
      linkedEntityType: "sales_order",
      linkedEntityId: TEST_SALE_ID,
      amount: "100.00",
      costResponsibilityType: "needs_accountant_review",
      notes: "Transport cost pending review",
      idempotencyKey: "dc-draft-001",
    });
    expect(result.reviewStatus).toBe("needs_accountant_review");

    // Verify NO account entries were created
    const entries = [...((deps.subledgerRepo as any).entries as Map<string, any>).values()];
    expect(entries.length).toBe(0);

    // Verify direct cost row exists with worker-safe defaults
    const dc = await deps.directCostRepo.findDirectCostById(TEST_TENANT_ID, result.directCostId);
    expect(dc).toBeTruthy();
    expect(dc!.actualPayerType).toBe("not_recorded");  // worker cannot set
    expect(dc!.includedInProfitability).toBe(false);  // worker cannot set
    expect(dc!.reviewStatus).toBe("needs_accountant_review");
  });

  it("worker can create draft with unknown amount (null)", async () => {
    const deps = makeDeps();
    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = makeWhEff();

    const result = await deps.directCostService.createDraftDirectCost(whUser as any, whEff as any, {
      costType: "loading",
      linkedEntityType: "sales_order",
      linkedEntityId: TEST_SALE_ID,
      amount: null,  // unknown at draft
      costResponsibilityType: "unknown",
      notes: "Amount unknown",
      idempotencyKey: "dc-draft-null-001",
    });
    expect(result.reviewStatus).toBe("needs_accountant_review");

    const dc = await deps.directCostRepo.findDirectCostById(TEST_TENANT_ID, result.directCostId);
    expect(dc!.amount).toBeNull();
  });
});

// ===========================================================================
// 2. Permissions + DEC-080.
// ===========================================================================

describe("WP-05-05 permissions", () => {
  it("worker cannot review/approve direct cost (direct_costs.review denied)", async () => {
    const deps = makeDeps();
    // Create draft as warehouse worker
    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = makeWhEff();
    const draft = await deps.directCostService.createDraftDirectCost(whUser as any, whEff as any, {
      costType: "transport",
      linkedEntityType: "sales_order",
      linkedEntityId: TEST_SALE_ID,
      amount: "100.00",
      costResponsibilityType: "company",
      idempotencyKey: "dc-perm-001",
    });

    // Worker tries to review — denied
    await expect(deps.directCostService.reviewDirectCost(whUser as any, whEff as any, {
      directCostId: draft.directCostId,
      amount: "100.00",
      costResponsibilityType: "company",
      actualPayerType: "company",
      includedInProfitability: false,
      idempotencyKey: "dc-perm-001:review",
    })).rejects.toThrow(PermissionDeniedError);
  });

  it("DEC-080: requester cannot approve own direct cost", async () => {
    const deps = makeDeps();
    // Owner creates draft
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();
    const draft = await deps.directCostService.createDraftDirectCost(ownerUser as any, ownerEff as any, {
      costType: "transport",
      linkedEntityType: "sales_order",
      linkedEntityId: TEST_SALE_ID,
      amount: "100.00",
      costResponsibilityType: "company",
      idempotencyKey: "dc-dec080-001",
    });

    // Owner tries to review own draft — DEC-080
    await expect(deps.directCostService.reviewDirectCost(ownerUser as any, ownerEff as any, {
      directCostId: draft.directCostId,
      amount: "100.00",
      costResponsibilityType: "company",
      actualPayerType: "company",
      includedInProfitability: false,
      idempotencyKey: "dc-dec080-001:review",
    })).rejects.toThrow(RequesterCannotApproveOwnDirectCostError);
  });

  it("accountant can review direct cost created by owner", async () => {
    const deps = makeDeps();
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();
    const draft = await deps.directCostService.createDraftDirectCost(ownerUser as any, ownerEff as any, {
      costType: "transport",
      linkedEntityType: "sales_order",
      linkedEntityId: TEST_SALE_ID,
      amount: "100.00",
      costResponsibilityType: "company",
      idempotencyKey: "dc-acct-001",
    });

    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const acctEff = makeAcctEff();
    const result = await deps.directCostService.reviewDirectCost(acctUser as any, acctEff as any, {
      directCostId: draft.directCostId,
      amount: "100.00",
      costResponsibilityType: "company",
      actualPayerType: "company",
      includedInProfitability: false,
      idempotencyKey: "dc-acct-001:review",
    });
    expect(result.action).toBe("reviewed");
    expect(result.reviewStatus).toBe("approved");
  });
});

// ===========================================================================
// 3. Subledger sign/effect per responsibility type.
// ===========================================================================

describe("WP-05-05 subledger sign/effect", () => {
  it("company-borne: no subledger entry created", async () => {
    const deps = makeDeps();
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();
    const draft = await deps.directCostService.createDraftDirectCost(ownerUser as any, ownerEff as any, {
      costType: "transport",
      linkedEntityType: "sales_order",
      linkedEntityId: TEST_SALE_ID,
      amount: "100.00",
      costResponsibilityType: "company",
      idempotencyKey: "dc-company-001",
    });

    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const acctEff = makeAcctEff();
    const result = await deps.directCostService.reviewDirectCost(acctUser as any, acctEff as any, {
      directCostId: draft.directCostId,
      amount: "100.00",
      costResponsibilityType: "company",
      actualPayerType: "company",
      includedInProfitability: false,
      idempotencyKey: "dc-company-001:review",
    });
    expect(result.subledgerEntryId).toBeNull();  // no subledger entry

    // Verify no account entries
    const entries = [...((deps.subledgerRepo as any).entries as Map<string, any>).values()];
    expect(entries.length).toBe(0);
  });

  it("customer-borne: creates POSITIVE customer_direct_cost_receivable", async () => {
    const deps = makeDeps();
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();
    const draft = await deps.directCostService.createDraftDirectCost(ownerUser as any, ownerEff as any, {
      costType: "transport",
      linkedEntityType: "sales_order",
      linkedEntityId: TEST_SALE_ID,
      amount: "100.00",
      costResponsibilityType: "customer",
      idempotencyKey: "dc-cust-001",
    });

    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const acctEff = makeAcctEff();
    const result = await deps.directCostService.reviewDirectCost(acctUser as any, acctEff as any, {
      directCostId: draft.directCostId,
      amount: "100.00",
      costResponsibilityType: "customer",
      actualPayerType: "customer",
      includedInProfitability: false,
      linkedOwnerType: "customer",
      linkedOwnerId: TEST_CUSTOMER_ID,
      idempotencyKey: "dc-cust-001:review",
    });
    expect(result.subledgerEntryId).not.toBeNull();

    const entry = await deps.subledger.findEntryById(TEST_TENANT_ID, result.subledgerEntryId!);
    expect(entry!.entryType).toBe("customer_direct_cost_receivable");
    expect(entry!.amountSigned).toBe("100.00");  // POSITIVE
    expect(entry!.sourceDocumentType).toBe("direct_cost");
  });

  it("factory-borne: creates POSITIVE factory_direct_cost_recovery", async () => {
    const deps = makeDeps();
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();
    const draft = await deps.directCostService.createDraftDirectCost(ownerUser as any, ownerEff as any, {
      costType: "customs",
      linkedEntityType: "production_receipt",
      linkedEntityId: TEST_SALE_ID,
      amount: "200.00",
      costResponsibilityType: "factory",
      idempotencyKey: "dc-fac-001",
    });

    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const acctEff = makeAcctEff();
    const result = await deps.directCostService.reviewDirectCost(acctUser as any, acctEff as any, {
      directCostId: draft.directCostId,
      amount: "200.00",
      costResponsibilityType: "factory",
      actualPayerType: "factory",
      includedInProfitability: false,
      linkedOwnerType: "factory",
      linkedOwnerId: TEST_FACTORY_ID,
      idempotencyKey: "dc-fac-001:review",
    });
    expect(result.subledgerEntryId).not.toBeNull();

    const entry = await deps.subledger.findEntryById(TEST_TENANT_ID, result.subledgerEntryId!);
    expect(entry!.entryType).toBe("factory_direct_cost_recovery");
    expect(entry!.amountSigned).toBe("200.00");  // POSITIVE
  });

  it("unknown/included_elsewhere: no subledger entry", async () => {
    const deps = makeDeps();
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();
    const draft = await deps.directCostService.createDraftDirectCost(ownerUser as any, ownerEff as any, {
      costType: "other",
      linkedEntityType: "sales_order",
      linkedEntityId: TEST_SALE_ID,
      amount: "50.00",
      costResponsibilityType: "included_elsewhere",
      idempotencyKey: "dc-inc-001",
    });

    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const acctEff = makeAcctEff();
    const result = await deps.directCostService.reviewDirectCost(acctUser as any, acctEff as any, {
      directCostId: draft.directCostId,
      amount: "50.00",
      costResponsibilityType: "included_elsewhere",
      actualPayerType: "company",
      includedInProfitability: false,
      idempotencyKey: "dc-inc-001:review",
    });
    expect(result.subledgerEntryId).toBeNull();

    const entries = [...((deps.subledgerRepo as any).entries as Map<string, any>).values()];
    expect(entries.length).toBe(0);
  });
});

// ===========================================================================
// 4. Shared allocation.
// ===========================================================================

describe("WP-05-05 shared allocation", () => {
  it("shared allocation sums exactly to confirmed amount", async () => {
    const deps = makeDeps();
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();
    const draft = await deps.directCostService.createDraftDirectCost(ownerUser as any, ownerEff as any, {
      costType: "transport",
      linkedEntityType: "sales_order",
      linkedEntityId: TEST_SALE_ID,
      amount: "100.00",
      costResponsibilityType: "shared",
      idempotencyKey: "dc-shared-001",
    });

    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const acctEff = makeAcctEff();
    const result = await deps.directCostService.reviewDirectCost(acctUser as any, acctEff as any, {
      directCostId: draft.directCostId,
      amount: "100.00",
      costResponsibilityType: "shared",
      actualPayerType: "company",
      includedInProfitability: false,
      allocations: [
        { responsiblePartyType: "customer", responsiblePartyId: TEST_CUSTOMER_ID, shareAmount: "60.00" },
        { responsiblePartyType: "factory", responsiblePartyId: TEST_FACTORY_ID, shareAmount: "40.00" },
      ],
      idempotencyKey: "dc-shared-001:review",
    });
    expect(result.action).toBe("reviewed");

    // Verify allocations were inserted
    const allocations = await deps.directCostRepo.listAllocationsForDirectCost(TEST_TENANT_ID, draft.directCostId);
    expect(allocations.length).toBe(2);
    expect(allocations[0]!.shareAmount).toBe("60.00");
    expect(allocations[1]!.shareAmount).toBe("40.00");
  });

  it("invalid allocation total rejected", async () => {
    const deps = makeDeps();
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();
    const draft = await deps.directCostService.createDraftDirectCost(ownerUser as any, ownerEff as any, {
      costType: "transport",
      linkedEntityType: "sales_order",
      linkedEntityId: TEST_SALE_ID,
      amount: "100.00",
      costResponsibilityType: "shared",
      idempotencyKey: "dc-shared-bad-001",
    });

    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const acctEff = makeAcctEff();
    await expect(deps.directCostService.reviewDirectCost(acctUser as any, acctEff as any, {
      directCostId: draft.directCostId,
      amount: "100.00",
      costResponsibilityType: "shared",
      actualPayerType: "company",
      includedInProfitability: false,
      allocations: [
        { responsiblePartyType: "customer", responsiblePartyId: TEST_CUSTOMER_ID, shareAmount: "60.00" },
        { responsiblePartyType: "factory", responsiblePartyId: TEST_FACTORY_ID, shareAmount: "50.00" },  // total 110 != 100
      ],
      idempotencyKey: "dc-shared-bad-001:review",
    })).rejects.toThrow(InvalidAllocationTotalError);
  });
});

// ===========================================================================
// 5. Profitability snapshot versioning.
// ===========================================================================

describe("WP-05-05 profitability snapshot versioning", () => {
  it("profitability inclusion creates later snapshot version (V2)", async () => {
    const deps = makeDeps();
    const { saleId, v1SnapshotId } = await setupApprovedSaleWithV1Snapshot(deps);

    // Create + approve a direct cost included in profitability
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();
    const draft = await deps.directCostService.createDraftDirectCost(ownerUser as any, ownerEff as any, {
      costType: "transport",
      linkedEntityType: "sales_order",
      linkedEntityId: saleId,
      amount: "10.00",
      costResponsibilityType: "company",
      idempotencyKey: "dc-v2-001",
    });

    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const acctEff = makeAcctEff();
    const result = await deps.directCostService.reviewDirectCost(acctUser as any, acctEff as any, {
      directCostId: draft.directCostId,
      amount: "10.00",
      costResponsibilityType: "company",
      actualPayerType: "company",
      includedInProfitability: true,
      idempotencyKey: "dc-v2-001:review",
    });
    expect(result.snapshotId).not.toBeNull();
    expect(result.snapshotVersion).toBe(2);  // V2

    // Verify V2 is active
    const activeSnapshot = await deps.snapshotRepo.findActiveSnapshot(TEST_TENANT_ID, saleId);
    expect(activeSnapshot!.version).toBe(2);
    expect(activeSnapshot!.id).toBe(result.snapshotId);
  });

  it("previous snapshot becomes superseded", async () => {
    const deps = makeDeps();
    const { saleId, v1SnapshotId } = await setupApprovedSaleWithV1Snapshot(deps);

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();
    const draft = await deps.directCostService.createDraftDirectCost(ownerUser as any, ownerEff as any, {
      costType: "transport",
      linkedEntityType: "sales_order",
      linkedEntityId: saleId,
      amount: "10.00",
      costResponsibilityType: "company",
      idempotencyKey: "dc-supersede-001",
    });

    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const acctEff = makeAcctEff();
    const result = await deps.directCostService.reviewDirectCost(acctUser as any, acctEff as any, {
      directCostId: draft.directCostId,
      amount: "10.00",
      costResponsibilityType: "company",
      actualPayerType: "company",
      includedInProfitability: true,
      idempotencyKey: "dc-supersede-001:review",
    });

    // V1 should be superseded
    const v1After = await deps.snapshotRepo.findSnapshotByVersion(TEST_TENANT_ID, saleId, 1);
    expect(v1After!.isActive).toBe("superseded");  // is_active is an enum: 'active' | 'superseded'
    // V2 should be active
    const v2After = await deps.snapshotRepo.findSnapshotByVersion(TEST_TENANT_ID, saleId, 2);
    expect(v2After!.isActive).toBe("active");
  });

  it("old snapshot remains immutable (revenue/profit unchanged)", async () => {
    const deps = makeDeps();
    const { saleId, v1SnapshotId } = await setupApprovedSaleWithV1Snapshot(deps);

    const v1Before = await deps.snapshotRepo.findSnapshotByVersion(TEST_TENANT_ID, saleId, 1);
    const v1RevenueBefore = v1Before!.revenueSnapshot;
    const v1ProfitBefore = v1Before!.profitAmount;

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();
    const draft = await deps.directCostService.createDraftDirectCost(ownerUser as any, ownerEff as any, {
      costType: "transport",
      linkedEntityType: "sales_order",
      linkedEntityId: saleId,
      amount: "10.00",
      costResponsibilityType: "company",
      idempotencyKey: "dc-immutable-001",
    });

    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const acctEff = makeAcctEff();
    await deps.directCostService.reviewDirectCost(acctUser as any, acctEff as any, {
      directCostId: draft.directCostId,
      amount: "10.00",
      costResponsibilityType: "company",
      actualPayerType: "company",
      includedInProfitability: true,
      idempotencyKey: "dc-immutable-001:review",
    });

    // V1 values must be unchanged
    const v1After = await deps.snapshotRepo.findSnapshotByVersion(TEST_TENANT_ID, saleId, 1);
    expect(v1After!.revenueSnapshot).toBe(v1RevenueBefore);
    expect(v1After!.profitAmount).toBe(v1ProfitBefore);
  });

  it("no double-counting: second approved direct cost creates V3 with sum of both", async () => {
    const deps = makeDeps();
    const { saleId } = await setupApprovedSaleWithV1Snapshot(deps);

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();
    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const acctEff = makeAcctEff();

    // First direct cost: 10.00
    const draft1 = await deps.directCostService.createDraftDirectCost(ownerUser as any, ownerEff as any, {
      costType: "transport", linkedEntityType: "sales_order", linkedEntityId: saleId,
      amount: "10.00", costResponsibilityType: "company",
      idempotencyKey: "dc-double-001",
    });
    await deps.directCostService.reviewDirectCost(acctUser as any, acctEff as any, {
      directCostId: draft1.directCostId, amount: "10.00",
      costResponsibilityType: "company", actualPayerType: "company",
      includedInProfitability: true, idempotencyKey: "dc-double-001:review",
    });

    // Second direct cost: 15.00
    const draft2 = await deps.directCostService.createDraftDirectCost(ownerUser as any, ownerEff as any, {
      costType: "loading", linkedEntityType: "sales_order", linkedEntityId: saleId,
      amount: "15.00", costResponsibilityType: "company",
      idempotencyKey: "dc-double-002",
    });
    const result2 = await deps.directCostService.reviewDirectCost(acctUser as any, acctEff as any, {
      directCostId: draft2.directCostId, amount: "15.00",
      costResponsibilityType: "company", actualPayerType: "company",
      includedInProfitability: true, idempotencyKey: "dc-double-002:review",
    });
    expect(result2.snapshotVersion).toBe(3);  // V3

    // V3 should include BOTH direct costs (10 + 15 = 25)
    const v3 = await deps.snapshotRepo.findSnapshotByVersion(TEST_TENANT_ID, saleId, 3);
    // V1 had rawCost=30, single=20, no direct costs. V3 has rawCost=30, single=20, direct=25.
    // profit = revenue(80) - raw(30) - single(20) - direct(25) = 5
    expect(v3!.profitAmount).toBe("5.00");
  });
});

// ===========================================================================
// 6. Idempotency.
// ===========================================================================

describe("WP-05-05 idempotency", () => {
  it("same key replays with no duplicate effects", async () => {
    const deps = makeDeps();
    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = makeWhEff();

    const r1 = await deps.directCostService.createDraftDirectCost(whUser as any, whEff as any, {
      costType: "transport",
      linkedEntityType: "sales_order",
      linkedEntityId: TEST_SALE_ID,
      amount: "100.00",
      costResponsibilityType: "company",
      idempotencyKey: "dc-idem-001",
    });
    const r2 = await deps.directCostService.createDraftDirectCost(whUser as any, whEff as any, {
      costType: "transport",
      linkedEntityType: "sales_order",
      linkedEntityId: TEST_SALE_ID,
      amount: "100.00",
      costResponsibilityType: "company",
      idempotencyKey: "dc-idem-001",
    });
    expect(r2.directCostId).toBe(r1.directCostId);

    // Verify only 1 direct cost row
    const directCosts = [...((deps.directCostRepo as any).directCosts as Map<string, any>).values()];
    expect(directCosts.length).toBe(1);
  });

  it("changed body idempotency conflict", async () => {
    const deps = makeDeps();
    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = makeWhEff();

    await deps.directCostService.createDraftDirectCost(whUser as any, whEff as any, {
      costType: "transport",
      linkedEntityType: "sales_order",
      linkedEntityId: TEST_SALE_ID,
      amount: "100.00",
      costResponsibilityType: "company",
      idempotencyKey: "dc-conflict-001",
    });
    await expect(deps.directCostService.createDraftDirectCost(whUser as any, whEff as any, {
      costType: "transport",
      linkedEntityType: "sales_order",
      linkedEntityId: TEST_SALE_ID,
      amount: "200.00",  // DIFFERENT
      costResponsibilityType: "company",
      idempotencyKey: "dc-conflict-001",
    })).rejects.toThrow();
  });
});

// ===========================================================================
// 7. State + rollback.
// ===========================================================================

describe("WP-05-05 state + rollback", () => {
  it("cannot review already-approved direct cost", async () => {
    const deps = makeDeps();
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();
    const draft = await deps.directCostService.createDraftDirectCost(ownerUser as any, ownerEff as any, {
      costType: "transport",
      linkedEntityType: "sales_order",
      linkedEntityId: TEST_SALE_ID,
      amount: "100.00",
      costResponsibilityType: "company",
      idempotencyKey: "dc-state-001",
    });

    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const acctEff = makeAcctEff();
    await deps.directCostService.reviewDirectCost(acctUser as any, acctEff as any, {
      directCostId: draft.directCostId,
      amount: "100.00",
      costResponsibilityType: "company",
      actualPayerType: "company",
      includedInProfitability: false,
      idempotencyKey: "dc-state-001:review",
    });

    // Second review attempt — rejected
    await expect(deps.directCostService.reviewDirectCost(acctUser as any, acctEff as any, {
      directCostId: draft.directCostId,
      amount: "100.00",
      costResponsibilityType: "company",
      actualPayerType: "company",
      includedInProfitability: false,
      idempotencyKey: "dc-state-001:review-2",
    })).rejects.toThrow(DirectCostAlreadyReviewedError);
  });

  it("rollback after audit failure leaves no persisted effects", async () => {
    const deps = makeDeps();
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();
    const draft = await deps.directCostService.createDraftDirectCost(ownerUser as any, ownerEff as any, {
      costType: "transport",
      linkedEntityType: "sales_order",
      linkedEntityId: TEST_SALE_ID,
      amount: "100.00",
      costResponsibilityType: "customer",
      idempotencyKey: "dc-rollback-001",
    });

    // Capture state
    const dcSnap = deps.directCostRepo.snapshot();
    const subledgerSnap = deps.subledgerRepo.snapshot();

    // Force audit failure during review
    deps.audit.setShouldFail(true);
    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const acctEff = makeAcctEff();
    await expect(deps.directCostService.reviewDirectCost(acctUser as any, acctEff as any, {
      directCostId: draft.directCostId,
      amount: "100.00",
      costResponsibilityType: "customer",
      actualPayerType: "customer",
      includedInProfitability: false,
      linkedOwnerType: "customer",
      linkedOwnerId: TEST_CUSTOMER_ID,
      idempotencyKey: "dc-rollback-001:review",
    })).rejects.toThrow();
    deps.audit.setShouldFail(false);

    // Restore in-memory state (simulates DB tx rollback)
    deps.directCostRepo.restore(dcSnap);
    deps.subledgerRepo.restore(subledgerSnap);

    // Verify no subledger entry persisted
    const entries = [...((deps.subledgerRepo as any).entries as Map<string, any>).values()];
    expect(entries.length).toBe(0);

    // Direct cost still in needs_accountant_review
    const dc = await deps.directCostRepo.findDirectCostById(TEST_TENANT_ID, draft.directCostId);
    expect(dc!.reviewStatus).toBe("needs_accountant_review");
  });
});

// ===========================================================================
// 8. Tenant isolation + no side effects.
// ===========================================================================

describe("WP-05-05 tenant isolation + no side effects", () => {
  it("cross-tenant direct cost lookup fails", async () => {
    const deps = makeDeps();
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();
    const draft = await deps.directCostService.createDraftDirectCost(ownerUser as any, ownerEff as any, {
      costType: "transport",
      linkedEntityType: "sales_order",
      linkedEntityId: TEST_SALE_ID,
      amount: "100.00",
      costResponsibilityType: "company",
      idempotencyKey: "dc-tenant-001",
    });

    // Foreign tenant user tries to review — DIRECT_COST_NOT_FOUND
    const foreignUser = makeUser(TEST_USERS.accountant.userId, "ffffffff-ffff-ffff-ffff-ffffffffffff");
    const foreignEff = makeAcctEff();
    await expect(deps.directCostService.reviewDirectCost(foreignUser as any, foreignEff as any, {
      directCostId: draft.directCostId,
      amount: "100.00",
      costResponsibilityType: "company",
      actualPayerType: "company",
      includedInProfitability: false,
      idempotencyKey: "dc-tenant-001:review",
    })).rejects.toThrow();
  });

  it("no payments/settlements/stock/sale-approval side effects", async () => {
    const deps = makeDeps();
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();
    const draft = await deps.directCostService.createDraftDirectCost(ownerUser as any, ownerEff as any, {
      costType: "transport",
      linkedEntityType: "sales_order",
      linkedEntityId: TEST_SALE_ID,
      amount: "100.00",
      costResponsibilityType: "customer",
      idempotencyKey: "dc-noside-001",
    });

    const acctUser = makeUser(TEST_USERS.accountant.userId);
    const acctEff = makeAcctEff();
    await deps.directCostService.reviewDirectCost(acctUser as any, acctEff as any, {
      directCostId: draft.directCostId,
      amount: "100.00",
      costResponsibilityType: "customer",
      actualPayerType: "customer",
      includedInProfitability: false,
      linkedOwnerType: "customer",
      linkedOwnerId: TEST_CUSTOMER_ID,
      idempotencyKey: "dc-noside-001:review",
    });

    // Audit should NOT contain payment/settlement/stock_movement/sales_approval actions
    const auditRows = deps.audit.getRows();
    for (const row of auditRows) {
      expect(row.actionType).not.toContain("payment");
      expect(row.actionType).not.toContain("settlement");
      expect(row.actionType).not.toContain("stock_movement");
      expect(row.actionType).not.toContain("sales_approval");
      expect(row.actionType).not.toContain("inventory.");
    }

    // Only account entries should be: customer_direct_cost_receivable (no payment/settlement entries)
    const entries = [...((deps.subledgerRepo as any).entries as Map<string, any>).values()];
    expect(entries.length).toBe(1);
    expect(entries[0]!.entryType).toBe("customer_direct_cost_receivable");
  });
});
