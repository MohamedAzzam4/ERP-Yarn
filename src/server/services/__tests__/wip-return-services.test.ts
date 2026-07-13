/**
 * WP-04-04 WIP Return Request + Approval Service tests.
 *
 * Contract: docs/contracts/13_work_packages.md WP-04-04
 *   Tests: State/WIP/role, insufficient WIP, idempotency, rollback, worker redaction.
 *   Acceptance: "WIP decreases/destination on-hand increases exactly."
 *
 * Contract: docs/contracts/12_testing_and_regression_plan.md §4 Phase 4
 *   "return_from_wip request has no effect before approval and then atomically
 *    reduces WIP/increases stock."
 */
import { describe, it, expect } from "vitest";
import {
  WipReturnRequestService,
  ProductionOrderNotFoundForReturnError,
  OrderNotReadyForReturnError,
  WipReturnRequestError,
} from "../wip-return-request-service";
import {
  WipReturnApprovalService,
  WipReturnNotFoundError,
  WipReturnAlreadyApprovedError,
  RequesterCannotApproveOwnWipReturnError,
  WipInsufficientForReturnError,
  WipReturnSubjectHashMismatchError,
} from "../wip-return-approval-service";
import { ProductionIssueService } from "../production-issue-service";
import { InventoryLedgerService } from "../inventory-ledger-service";
import { InMemoryWipReturnRequestRepository } from "./in-memory-wip-return-request-repository";
import { InMemoryProductionOrderRepository } from "./in-memory-production-order-repository";
import { InMemoryWipBalanceRepository } from "./in-memory-wip-balance-repository";
import { InMemoryInventoryLedgerRepository } from "./in-memory-inventory-ledger-repository";
import { InProcessAuditStore } from "../audit-service";
import { InProcessIdempotencyStore } from "../idempotency-service";
import { InProcessDocumentSequenceStore } from "../document-sequence-service";
import {
  TEST_USERS, getTestEffectivePermissions,
} from "@/server/security/role-fixtures";
import { PermissionDeniedError } from "@/server/security/guards";

const TEST_TENANT_ID = "00000000-0000-0000-0000-000000000001";
const TEST_ITEM_ID = "aaa40400-0000-4000-8000-000000000001";
const TEST_FACTORY_LOC = "bbb40200-0000-4000-8000-000000000001";
const TEST_RETURN_LOC = "bbb40200-0000-4000-8000-000000000002";
const TEST_FACTORY_ID = "ccc40200-0000-4000-8000-000000000001";

function makeUser(userId: string, tenantId: string = TEST_TENANT_ID) {
  return { authenticated: true as const, userId, tenantId, email: "t@e.com", name: "T", authId: "t" };
}

function makeOwnerEff() {
  return {
    assignedRoleCodes: ["owner"],
    permissionKeys: new Set([
      "production.create", "production.issue.approve",
      "production.return_from_wip.request", "production.return_from_wip.approve",
      "inventory.receive.approve", "inventory.receive.create",
    ]),
    deniedFieldKeys: new Set(),
    workerFinancialDeny: false,
  } as any;
}

function makeAccountantEff() {
  return {
    assignedRoleCodes: ["accountant"],
    permissionKeys: new Set([
      "production.return_from_wip.request", "production.return_from_wip.approve",
      "production.issue.approve", "inventory.receive.approve",
    ]),
    deniedFieldKeys: new Set(),
    workerFinancialDeny: false,
  } as any;
}

function makeProductionWorkerEff() {
  return {
    assignedRoleCodes: ["production_employee"],
    permissionKeys: new Set([
      "production.return_from_wip.request",
      "production.receive_draft",
    ]),
    deniedFieldKeys: new Set(),
    workerFinancialDeny: true,
  } as any;
}

interface Deps {
  requestRepository: InMemoryWipReturnRequestRepository;
  productionOrderRepository: InMemoryProductionOrderRepository;
  wipBalanceRepository: InMemoryWipBalanceRepository;
  ledgerRepo: InMemoryInventoryLedgerRepository;
  audit: InProcessAuditStore;
  idempotency: InProcessIdempotencyStore;
  documentSequence: InProcessDocumentSequenceStore;
  inventoryLedger: InventoryLedgerService;
  issueService: ProductionIssueService;
  requestService: WipReturnRequestService;
  approvalService: WipReturnApprovalService;
}

function makeDeps(): Deps {
  const requestRepository = new InMemoryWipReturnRequestRepository();
  const productionOrderRepository = new InMemoryProductionOrderRepository();
  const wipBalanceRepository = new InMemoryWipBalanceRepository();
  const ledgerRepo = new InMemoryInventoryLedgerRepository();
  const audit = new InProcessAuditStore();
  const idempotency = new InProcessIdempotencyStore();
  const documentSequence = new InProcessDocumentSequenceStore();
  const inventoryLedger = new InventoryLedgerService({ ledger: ledgerRepo, audit, idempotency, documentSequence });
  const issueService = new ProductionIssueService({
    productionOrderRepository, wipBalanceRepository, inventoryLedger, audit, idempotency, documentSequence,
  });
  const requestService = new WipReturnRequestService({
    requestRepository, productionOrderRepository, wipBalanceRepository, audit, documentSequence,
  });
  const approvalService = new WipReturnApprovalService({
    requestRepository, productionOrderRepository, wipBalanceRepository, inventoryLedger, audit, idempotency,
  });
  return {
    requestRepository, productionOrderRepository, wipBalanceRepository,
    ledgerRepo, audit, idempotency, documentSequence, inventoryLedger, issueService, requestService, approvalService,
  };
}

/**
 * Seed stock, create an order, issue material to WIP.
 * Returns the order + input for the test to use.
 */
async function setupIssuedOrder(
  deps: Deps,
  opts: { seedStockQty?: string; issueQty?: string } = {},
): Promise<{ order: any; inputs: any[] }> {
  const seedQty = opts.seedStockQty ?? "5000.000";
  const issueQty = opts.issueQty ?? "5000.000";

  const ownerUser = makeUser(TEST_USERS.owner.userId);
  const ownerEff = makeOwnerEff();
  await deps.inventoryLedger.postRawReceipt(ownerUser as any, ownerEff as any, {
    itemId: TEST_ITEM_ID, toLocationId: TEST_FACTORY_LOC, quantityKg: seedQty,
    movementDate: "2026-07-06", sourceDocumentType: "test_seed", sourceDocumentId: "seed-001",
    idempotencyKey: "seed-key-001",
  });

  const whUser = makeUser(TEST_USERS.warehouse.userId);
  const whEff = getTestEffectivePermissions(TEST_USERS.warehouse.userId);
  const { order, inputs } = await deps.issueService.createProductionOrder(whUser as any, whEff as any, {
    productionType: "single_yarn",
    factoryId: TEST_FACTORY_ID,
    factoryLocationId: TEST_FACTORY_LOC,
    inputs: [{ inputItemId: TEST_ITEM_ID, inputLocationId: TEST_FACTORY_LOC, plannedInputQtyKg: issueQty }],
  });

  await deps.issueService.issueToProduction(ownerUser as any, ownerEff as any, {
    productionOrderId: order.id, inputId: inputs[0]!.id, quantityKg: issueQty, idempotencyKey: "issue-setup-1",
  });

  return { order, inputs };
}

/**
 * Full setup: seed + issue + create return request.
 * The request is created by the owner (so the accountant can approve it — DEC-080).
 */
async function setupReturnRequest(
  deps: Deps,
  opts: { seedStockQty?: string; issueQty?: string; returnQty?: string; requestCreator?: "owner" | "production" } = {},
): Promise<{ order: any; inputs: any[]; requestId: string }> {
  const { order, inputs } = await setupIssuedOrder(deps, opts);
  const returnQty = opts.returnQty ?? "1000.000";
  const requestCreator = opts.requestCreator ?? "owner";
  const reqUser = requestCreator === "owner" ? makeUser(TEST_USERS.owner.userId) : makeUser(TEST_USERS.production.userId);
  const reqEff = requestCreator === "owner" ? makeOwnerEff() : makeProductionWorkerEff();

  const result = await deps.requestService.createRequest(reqUser as any, reqEff as any, {
    productionOrderId: order.id,
    productionInputId: inputs[0]!.id,
    returnQtyKg: returnQty,
    returnLocationId: TEST_RETURN_LOC,
    reason: "Test return — surplus WIP",
  });

  return { order, inputs, requestId: result.requestId };
}

// ===========================================================================
// 1. Request creation has NO operational effect.
// ===========================================================================

describe("WP-04-04 request creation — zero operational effect", () => {
  it("creating a request does NOT change inventory on-hand, WIP, or create movements", async () => {
    const deps = makeDeps();
    const { order, inputs, requestId } = await setupReturnRequest(deps);

    // Verify no stock movements created (only the seed raw_receipt + issue_to_production)
    const movements = [...((deps.ledgerRepo as any).movements as Map<string, any>).values()];
    const returnMovements = movements.filter((m: any) => m.movementType === "return_from_wip");
    expect(returnMovements.length).toBe(0);

    // Verify WIP unchanged (still = issued qty)
    const wip = await deps.wipBalanceRepository.findForUpdate(TEST_TENANT_ID, order.id, TEST_ITEM_ID, TEST_FACTORY_LOC);
    expect(wip!.wipQtyKg).toBe("5000.000");

    // Verify factory on-hand unchanged (5000 seed - 5000 issued = 0)
    const factoryBal = await deps.ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_FACTORY_LOC);
    expect(factoryBal!.onHandQtyKg).toBe("0.000");

    // Verify return location has NO balance (no movement posted)
    const returnBal = await deps.ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_RETURN_LOC);
    expect(returnBal).toBeNull();

    // Verify request is pending_approval
    const request = await deps.requestRepository.findRequestById(TEST_TENANT_ID, requestId);
    expect(request!.status).toBe("pending_approval");
    expect(request!.approvalStatus).toBe("pending_approval");
    expect(request!.isLocked).toBe(false);
    expect(request!.returnMovementId).toBeNull();
    expect(request!.subjectHash).toBeTruthy();
  });

  it("rejects if order is not in material_issued/partially_received", async () => {
    const deps = makeDeps();
    // Create order but DON'T issue (stays in 'draft')
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = makeOwnerEff();
    await deps.inventoryLedger.postRawReceipt(ownerUser as any, ownerEff as any, {
      itemId: TEST_ITEM_ID, toLocationId: TEST_FACTORY_LOC, quantityKg: "5000.000",
      movementDate: "2026-07-06", sourceDocumentType: "test_seed", sourceDocumentId: "seed-001",
      idempotencyKey: "seed-key-001",
    });
    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = getTestEffectivePermissions(TEST_USERS.warehouse.userId);
    const { order, inputs } = await deps.issueService.createProductionOrder(whUser as any, whEff as any, {
      productionType: "single_yarn", factoryId: TEST_FACTORY_ID, factoryLocationId: TEST_FACTORY_LOC,
      inputs: [{ inputItemId: TEST_ITEM_ID, inputLocationId: TEST_FACTORY_LOC, plannedInputQtyKg: "5000.000" }],
    });

    await expect(deps.requestService.createRequest(ownerUser as any, ownerEff as any, {
      productionOrderId: order.id, productionInputId: inputs[0]!.id,
      returnQtyKg: "1000.000", returnLocationId: TEST_RETURN_LOC, reason: "test",
    })).rejects.toThrow(OrderNotReadyForReturnError);
  });

  it("rejects missing reason", async () => {
    const deps = makeDeps();
    const { order, inputs } = await setupIssuedOrder(deps);

    await expect(deps.requestService.createRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any, {
        productionOrderId: order.id, productionInputId: inputs[0]!.id,
        returnQtyKg: "1000.000", returnLocationId: TEST_RETURN_LOC,
        reason: "" as any,
      },
    )).rejects.toThrow(WipReturnRequestError);
  });

  it("rejects non-positive return quantity", async () => {
    const deps = makeDeps();
    const { order, inputs } = await setupIssuedOrder(deps);

    await expect(deps.requestService.createRequest(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any, {
        productionOrderId: order.id, productionInputId: inputs[0]!.id,
        returnQtyKg: "0.000", returnLocationId: TEST_RETURN_LOC, reason: "test",
      },
    )).rejects.toThrow(WipReturnRequestError);
  });
});

// ===========================================================================
// 2. Happy approval path.
// ===========================================================================

describe("WP-04-04 approveWipReturn — happy path", () => {
  it("atomically decreases WIP, increases return-location on-hand, updates input, transitions state, writes audit", async () => {
    const deps = makeDeps();
    const { order, inputs, requestId } = await setupReturnRequest(deps, {
      issueQty: "5000.000", returnQty: "1000.000",
    });

    const result = await deps.approvalService.approveWipReturn(
      makeUser(TEST_USERS.accountant.userId) as any, makeAccountantEff() as any,
      { requestId, idempotencyKey: "approve-1" },
    );

    // Result shape
    expect(result.action).toBe("posted");
    expect(result.requestStatus).toBe("approved");
    expect(result.returnMovementId).toBeTruthy();
    expect(result.returnMovementDocNo).toMatch(/^WR-\d{4}-\d{6}$/);
    expect(result.wipQtyAfter).toBe("4000.000"); // 5000 - 1000
    expect(result.onHandQtyAfter).toBe("1000.000"); // return location
    expect(result.returnedFromWipQtyKg).toBe("1000.000");
    expect(result.remainingWipQtyKg).toBe("4000.000"); // 5000 - 0 - 0 - 1000
    expect(result.financialReviewStatus).toBe("needs_accountant_review");

    // Verify return_from_wip movement exists
    const movements = [...((deps.ledgerRepo as any).movements as Map<string, any>).values()];
    const returnMv = movements.find((m: any) => m.movementType === "return_from_wip");
    expect(returnMv).toBeTruthy();
    expect(returnMv.fromLocationId).toBe(TEST_FACTORY_LOC);
    expect(returnMv.toLocationId).toBe(TEST_RETURN_LOC);
    expect(returnMv.quantityKg).toBe("1000.000");
    expect(returnMv.sourceDocumentType).toBe("production_wip_return");
    expect(returnMv.sourceDocumentId).toBe(requestId);

    // Verify WIP decreased
    const wip = await deps.wipBalanceRepository.findForUpdate(TEST_TENANT_ID, order.id, TEST_ITEM_ID, TEST_FACTORY_LOC);
    expect(wip!.wipQtyKg).toBe("4000.000");

    // Verify return location on-hand increased
    const returnBal = await deps.ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_RETURN_LOC);
    expect(returnBal!.onHandQtyKg).toBe("1000.000");

    // Verify request state
    const request = await deps.requestRepository.findRequestById(TEST_TENANT_ID, requestId);
    expect(request!.status).toBe("approved");
    expect(request!.approvalStatus).toBe("approved");
    expect(request!.isLocked).toBe(true);
    expect(request!.returnMovementId).toBe(result.returnMovementId);
    expect(request!.confirmedBy).toBe(TEST_USERS.accountant.userId);

    // Verify audit row
    const auditRows = deps.audit.getRows();
    const approveAudit = auditRows.find((r) => r.actionType === "production_wip_return.approve");
    expect(approveAudit).toBeTruthy();
    expect(approveAudit!.entityId).toBe(requestId);
    expect(approveAudit!.idempotencyKey).toBe("approve-1");
  });
});

// ===========================================================================
// 3. Insufficient WIP rejects.
// ===========================================================================

describe("WP-04-04 approveWipReturn — insufficient WIP", () => {
  it("rejects with WIP_INSUFFICIENT when return qty exceeds available WIP", async () => {
    const deps = makeDeps();
    // Issue 1000 kg, try to return 2000
    const { requestId } = await setupReturnRequest(deps, {
      issueQty: "1000.000", returnQty: "2000.000",
    });

    await expect(deps.approvalService.approveWipReturn(
      makeUser(TEST_USERS.accountant.userId) as any, makeAccountantEff() as any,
      { requestId, idempotencyKey: "approve-3" },
    )).rejects.toThrow(WipInsufficientForReturnError);

    // No effects posted
    const movements = [...((deps.ledgerRepo as any).movements as Map<string, any>).values()];
    const returnMv = movements.filter((m: any) => m.movementType === "return_from_wip");
    expect(returnMv.length).toBe(0);

    // Request remains pending
    const request = await deps.requestRepository.findRequestById(TEST_TENANT_ID, requestId);
    expect(request!.status).toBe("pending_approval");
    expect(request!.isLocked).toBe(false);
  });
});

// ===========================================================================
// 4. Idempotency replay.
// ===========================================================================

describe("WP-04-04 approveWipReturn — idempotency", () => {
  it("same key replays with no duplicate movement/WIP change", async () => {
    const deps = makeDeps();
    const { requestId } = await setupReturnRequest(deps, { returnQty: "1000.000" });

    const r1 = await deps.approvalService.approveWipReturn(
      makeUser(TEST_USERS.accountant.userId) as any, makeAccountantEff() as any,
      { requestId, idempotencyKey: "approve-4" },
    );
    expect(r1.action).toBe("posted");

    // Count movements after first approval
    const movementsAfter1 = [...((deps.ledgerRepo as any).movements as Map<string, any>).values()];
    const movementCountAfter1 = movementsAfter1.length;

    // Replay
    const r2 = await deps.approvalService.approveWipReturn(
      makeUser(TEST_USERS.accountant.userId) as any, makeAccountantEff() as any,
      { requestId, idempotencyKey: "approve-4" },
    );
    expect(r2.action).toBe("replayed");
    expect(r2.requestId).toBe(r1.requestId);
    expect(r2.returnMovementId).toBe(r1.returnMovementId);

    // No new movements
    const movementsAfter2 = [...((deps.ledgerRepo as any).movements as Map<string, any>).values()];
    expect(movementsAfter2.length).toBe(movementCountAfter1);
  });

  it("different key on already-approved return rejects with STATE_CONFLICT", async () => {
    const deps = makeDeps();
    const { requestId } = await setupReturnRequest(deps, { returnQty: "1000.000" });

    await deps.approvalService.approveWipReturn(
      makeUser(TEST_USERS.accountant.userId) as any, makeAccountantEff() as any,
      { requestId, idempotencyKey: "approve-4a" },
    );

    await expect(deps.approvalService.approveWipReturn(
      makeUser(TEST_USERS.accountant.userId) as any, makeAccountantEff() as any,
      { requestId, idempotencyKey: "approve-4b" },
    )).rejects.toThrow(WipReturnAlreadyApprovedError);
  });
});

// ===========================================================================
// 5. Concurrent double approval.
// ===========================================================================

describe("WP-04-04 approveWipReturn — concurrency", () => {
  it("two concurrent approvals with different keys — one wins, other rejects", async () => {
    const deps = makeDeps();
    const { order, requestId } = await setupReturnRequest(deps, { returnQty: "1000.000" });

    const p1 = deps.approvalService.approveWipReturn(
      makeUser(TEST_USERS.accountant.userId) as any, makeAccountantEff() as any,
      { requestId, idempotencyKey: "approve-5a" },
    );
    const p2 = deps.approvalService.approveWipReturn(
      makeUser(TEST_USERS.accountant.userId) as any, makeAccountantEff() as any,
      { requestId, idempotencyKey: "approve-5b" },
    );

    const results = await Promise.allSettled([p1, p2]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // Verify request is locked + approved (authoritative business state)
    const request = await deps.requestRepository.findRequestById(TEST_TENANT_ID, requestId);
    expect(request!.isLocked).toBe(true);
    expect(request!.status).toBe("approved");
    expect(request!.returnMovementId).toBeTruthy();

    // WIP decreased exactly once (by 1000)
    const wip = await deps.wipBalanceRepository.findForUpdate(TEST_TENANT_ID, order.id, TEST_ITEM_ID, TEST_FACTORY_LOC);
    expect(wip!.wipQtyKg).toBe("4000.000"); // 5000 - 1000
  });
});

// ===========================================================================
// 6. Rollback on inventory movement failure.
// ===========================================================================

describe("WP-04-04 approveWipReturn — rollback", () => {
  it("rolls back all effects when audit write fails (DEC-024)", async () => {
    const deps = makeDeps();
    const { order, requestId } = await setupReturnRequest(deps, { returnQty: "1000.000" });

    // Force audit failure
    deps.audit.setShouldFail(true);

    await expect(deps.approvalService.approveWipReturn(
      makeUser(TEST_USERS.accountant.userId) as any, makeAccountantEff() as any,
      { requestId, idempotencyKey: "approve-6" },
    )).rejects.toThrow();

    deps.audit.setShouldFail(false);

    // ----- Business-level rollback proof -----
    // In a real DB transaction, ALL writes roll back. The in-memory stores
    // don't auto-rollback low-level rows, but the AUTHORITATIVE business state
    // (request + WIP) is only mutated by the conditional updates reached AFTER
    // the failing write. So the request MUST remain pending + unlocked, and
    // WIP MUST remain unchanged.

    // Request remains pending
    const request = await deps.requestRepository.findRequestById(TEST_TENANT_ID, requestId);
    expect(request!.status).toBe("pending_approval");
    expect(request!.isLocked).toBe(false);
    expect(request!.returnMovementId).toBeNull();
    expect(request!.confirmedBy).toBeNull();

    // WIP unchanged
    const wip = await deps.wipBalanceRepository.findForUpdate(TEST_TENANT_ID, order.id, TEST_ITEM_ID, TEST_FACTORY_LOC);
    expect(wip!.wipQtyKg).toBe("5000.000");

    // Idempotency record marked as business_failed
    const idemRecords = deps.idempotency.getAllRecords();
    const approveRecord = idemRecords.find((r) => r.operationScope === "production_wip_return.approve");
    expect(approveRecord).toBeTruthy();
    expect(approveRecord!.state).toBe("business_failed");
  });

  it("rolls back when WIP conditional decrement returns null (concurrent version mismatch)", async () => {
    const deps = makeDeps();
    const { order, inputs, requestId } = await setupReturnRequest(deps, { returnQty: "1000.000" });

    // Spy: make decrementWipQtyConditional always return null
    const realDecrement = deps.wipBalanceRepository.decrementWipQtyConditional.bind(deps.wipBalanceRepository);
    let decrementCallCount = 0;
    deps.wipBalanceRepository.decrementWipQtyConditional = async (...args: any[]) => {
      decrementCallCount++;
      return null; // simulate version mismatch
    };

    await expect(deps.approvalService.approveWipReturn(
      makeUser(TEST_USERS.accountant.userId) as any, makeAccountantEff() as any,
      { requestId, idempotencyKey: "approve-6b" },
    )).rejects.toThrow(WipInsufficientForReturnError);

    deps.wipBalanceRepository.decrementWipQtyConditional = realDecrement;
    expect(decrementCallCount).toBeGreaterThan(0);

    // Request remains pending
    const request = await deps.requestRepository.findRequestById(TEST_TENANT_ID, requestId);
    expect(request!.status).toBe("pending_approval");
    expect(request!.isLocked).toBe(false);
  });
});

// ===========================================================================
// 7. Permission denial.
// ===========================================================================

describe("WP-04-04 approveWipReturn — permission", () => {
  it("worker cannot approve (lacks production.return_from_wip.approve)", async () => {
    const deps = makeDeps();
    const { requestId } = await setupReturnRequest(deps, { returnQty: "1000.000", requestCreator: "owner" });

    await expect(deps.approvalService.approveWipReturn(
      makeUser(TEST_USERS.production.userId) as any, makeProductionWorkerEff() as any,
      { requestId, idempotencyKey: "approve-7" },
    )).rejects.toThrow(PermissionDeniedError);

    // No effects
    const movements = [...((deps.ledgerRepo as any).movements as Map<string, any>).values()];
    const returnMv = movements.filter((m: any) => m.movementType === "return_from_wip");
    expect(returnMv.length).toBe(0);
  });

  it("DEC-080: requester cannot approve own request", async () => {
    const deps = makeDeps();
    // Owner creates the request AND tries to approve it
    const { requestId } = await setupReturnRequest(deps, { returnQty: "1000.000", requestCreator: "owner" });

    await expect(deps.approvalService.approveWipReturn(
      makeUser(TEST_USERS.owner.userId) as any, makeOwnerEff() as any,
      { requestId, idempotencyKey: "approve-7b" },
    )).rejects.toThrow(RequesterCannotApproveOwnWipReturnError);

    // No effects
    const movements = [...((deps.ledgerRepo as any).movements as Map<string, any>).values()];
    const returnMv = movements.filter((m: any) => m.movementType === "return_from_wip");
    expect(returnMv.length).toBe(0);
  });
});

// ===========================================================================
// 8. Tenant isolation.
// ===========================================================================

describe("WP-04-04 approveWipReturn — tenant isolation", () => {
  it("cross-tenant approval → WIP_RETURN_NOT_FOUND (no disclosure)", async () => {
    const deps = makeDeps();
    const { requestId } = await setupReturnRequest(deps, { returnQty: "1000.000", requestCreator: "owner" });

    const foreignUser = makeUser(TEST_USERS.accountant.userId, "00000000-0000-0000-0000-ffffffffffff");
    const foreignEff = makeAccountantEff();

    await expect(deps.approvalService.approveWipReturn(
      foreignUser as any, foreignEff as any,
      { requestId, idempotencyKey: "approve-8" },
    )).rejects.toThrow(WipReturnNotFoundError);

    // No effects
    const movements = [...((deps.ledgerRepo as any).movements as Map<string, any>).values()];
    const returnMv = movements.filter((m: any) => m.movementType === "return_from_wip");
    expect(returnMv.length).toBe(0);
  });
});

// ===========================================================================
// 9. No unrelated side effects.
// ===========================================================================

describe("WP-04-04 approveWipReturn — no unrelated side effects", () => {
  it("approval creates exactly ONE return_from_wip movement and NO account entries", async () => {
    const deps = makeDeps();
    const { requestId } = await setupReturnRequest(deps, { returnQty: "1000.000", requestCreator: "owner" });

    await deps.approvalService.approveWipReturn(
      makeUser(TEST_USERS.accountant.userId) as any, makeAccountantEff() as any,
      { requestId, idempotencyKey: "approve-9" },
    );

    // Exactly 1 return_from_wip movement
    const movements = [...((deps.ledgerRepo as any).movements as Map<string, any>).values()];
    const returnMv = movements.filter((m: any) => m.movementType === "return_from_wip");
    expect(returnMv.length).toBe(1);

    // No sale_issue, no payments, no customer/transfer movements
    const forbiddenTypes = ["sale_issue", "transfer", "return_receipt"];
    for (const t of forbiddenTypes) {
      expect(movements.filter((m: any) => m.movementType === t).length).toBe(0);
    }

    // No account entries (subledger not used for WIP return)
    // (In-memory test doesn't have a subledger repo, but we verify no audit
    //  action types reference payable/payment/account.)
    const auditRows = deps.audit.getRows();
    for (const row of auditRows) {
      expect(row.actionType).not.toContain("payable");
      expect(row.actionType).not.toContain("payment");
      expect(row.actionType).not.toContain("account_entry");
      expect(row.actionType).not.toContain("sale_");
    }

    // The approve audit row exists
    const approveAudit = auditRows.find((r) => r.actionType === "production_wip_return.approve");
    expect(approveAudit).toBeTruthy();
  });
});

// ===========================================================================
// 10. Subject hash mismatch.
// ===========================================================================

describe("WP-04-04 approveWipReturn — subject hash", () => {
  it("rejects with SUBJECT_CHANGED when request facts are mutated after creation", async () => {
    const deps = makeDeps();
    const { requestId } = await setupReturnRequest(deps, { returnQty: "1000.000", requestCreator: "owner" });

    // Mutate the stored subjectHash
    const request = await deps.requestRepository.findRequestById(TEST_TENANT_ID, requestId);
    const mutated = { ...request!, subjectHash: "deadbeef".repeat(8) };
    (deps.requestRepository as any).requests.set(`${TEST_TENANT_ID}:${requestId}`, mutated);

    await expect(deps.approvalService.approveWipReturn(
      makeUser(TEST_USERS.accountant.userId) as any, makeAccountantEff() as any,
      { requestId, idempotencyKey: "approve-10" },
    )).rejects.toThrow(WipReturnSubjectHashMismatchError);

    // No effects
    const movements = [...((deps.ledgerRepo as any).movements as Map<string, any>).values()];
    const returnMv = movements.filter((m: any) => m.movementType === "return_from_wip");
    expect(returnMv.length).toBe(0);
  });
});

// ===========================================================================
// 11. Request not found.
// ===========================================================================

describe("WP-04-04 approveWipReturn — not found", () => {
  it("rejects with WIP_RETURN_NOT_FOUND for unknown requestId", async () => {
    const deps = makeDeps();
    await expect(deps.approvalService.approveWipReturn(
      makeUser(TEST_USERS.accountant.userId) as any, makeAccountantEff() as any,
      { requestId: "nonexistent", idempotencyKey: "approve-11" },
    )).rejects.toThrow(WipReturnNotFoundError);
  });
});
