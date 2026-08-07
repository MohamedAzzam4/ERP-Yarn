/**
 * WP-08-01A regression tests — tenant ownership + atomicity.
 *
 * Covers the specific cases the WP-08-01A correction requires:
 *
 *   Transfer (3 cases):
 *     1. cross-tenant item rejected with zero writes
 *     2. cross-tenant source location rejected with zero writes
 *     3. cross-tenant destination location rejected with zero writes
 *
 *   Return (3 cases):
 *     4. cross-tenant customer rejected with zero writes
 *     5. cross-tenant sale order rejected with zero writes
 *     6. cross-tenant sale line rejected with zero writes
 *
 *   Relation mismatches (3 cases):
 *     7. sale order / customer mismatch rejected
 *     8. sale line / order mismatch rejected
 *     9. sale line / item mismatch rejected
 *
 *   Atomicity + retry (4 cases):
 *    10. line insertion failure rolls back header
 *    11. audit failure rolls back header + lines
 *    12. retry after rollback succeeds (same idempotency key)
 *    13. duplicate replay returns same request
 *    14. conflicting replay rejects
 */
import { describe, it, expect } from "vitest";
import {
  TransferWorkflowService,
  type TransferTransactionRunner,
  type CreateTransferRequestInput,
} from "../transfer-workflow-service";
import {
  ReturnRequestService,
  type CreateReturnRequestInput,
} from "../return-request-service";
import { InMemoryRawReceiptApprovalRepository } from "./in-memory-raw-receipt-approval-repository";
import { InMemoryInventoryLedgerRepository } from "./in-memory-inventory-ledger-repository";
import { InMemoryReturnRequestRepository } from "./in-memory-return-request-repository";
import { InMemorySalesRepository } from "./in-memory-sales-repository";
import { InMemorySubledgerRepository } from "./in-memory-subledger-repository";
import { InMemoryProfitabilitySnapshotRepository } from "./in-memory-profitability-snapshot-repository";
import { InMemoryTenantOwnershipValidator } from "./in-memory-tenant-ownership-validator";
import { InProcessAuditStore } from "../audit-service";
import { InProcessIdempotencyStore } from "../idempotency-service";
import { InProcessDocumentSequenceStore } from "../document-sequence-service";
import { InventoryLedgerService } from "../inventory-ledger-service";
import { SubledgerService } from "../subledger-service";
import { ProfitabilitySnapshotService } from "../profitability-snapshot-service";
import { TEST_USERS } from "@/server/security/role-fixtures";

// ---------------------------------------------------------------------------
// Constants.
// ---------------------------------------------------------------------------

const TEST_TENANT_ID = "00000000-0000-0000-0000-000000080a01";
const TEST_ITEM_ID = "aaa80a00-0000-4000-8000-000000000001";
const TEST_LOC_A = "bbb80a00-0000-4000-8000-000000000001";
const TEST_LOC_B = "bbb80a00-0000-4000-8000-000000000002";
const TEST_CUSTOMER_ID = "ccc80a00-0000-4000-8000-000000000001";
const TEST_SALE_ID = "ddd80a00-0000-4000-8000-000000000001";
const TEST_SALE_LINE_ID = "eee80a00-0000-4000-8000-000000000001";

// Cross-tenant IDs (valid UUIDs but NOT owned by TEST_TENANT_ID).
const FOREIGN_ITEM_ID = "aaa80a00-0000-4000-8000-000000000099";
const FOREIGN_LOC_ID = "bbb80a00-0000-4000-8000-000000000099";
const FOREIGN_CUSTOMER_ID = "ccc80a00-0000-4000-8000-000000000099";
const FOREIGN_SALE_ID = "ddd80a00-0000-4000-8000-000000000099";
const FOREIGN_SALE_LINE_ID = "eee80a00-0000-4000-8000-000000000099";

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function makeUser(userId: string = TEST_USERS.owner.userId, tenantId: string = TEST_TENANT_ID) {
  return { authenticated: true as const, userId, tenantId, email: "t@e.com", name: "T", authId: "t" };
}

function makeWhEff() {
  return {
    assignedRoleCodes: ["warehouse_employee"],
    permissionKeys: new Set(["inventory.transfer.create", "returns.create", "inventory.receive.approve", "inventory.receive.create"]),
    deniedFieldKeys: new Set(),
    workerFinancialDeny: true,
  } as any;
}

function makeTransferDeps(opts: { validator?: InMemoryTenantOwnershipValidator } = {}) {
  const approvalRepository = new InMemoryRawReceiptApprovalRepository();
  const ledgerRepo = new InMemoryInventoryLedgerRepository();
  const audit = new InProcessAuditStore();
  const idempotency = new InProcessIdempotencyStore();
  const documentSequence = new InProcessDocumentSequenceStore();
  const tenantOwnershipValidator = opts.validator ?? new InMemoryTenantOwnershipValidator();
  const inventoryLedger = new InventoryLedgerService({ ledger: ledgerRepo, audit, idempotency, documentSequence });
  const service = new TransferWorkflowService({
    approvalRepository, inventoryLedger, audit, idempotency,
    tenantOwnershipValidator,
  });
  return { approvalRepository, ledgerRepo, audit, idempotency, documentSequence, inventoryLedger, service, tenantOwnershipValidator };
}

function makeReturnDeps(opts: { validator?: InMemoryTenantOwnershipValidator } = {}) {
  const returnRepo = new InMemoryReturnRequestRepository();
  const salesRepository = new InMemorySalesRepository();
  const ledgerRepo = new InMemoryInventoryLedgerRepository();
  const subledgerRepo = new InMemorySubledgerRepository();
  const snapshotRepo = new InMemoryProfitabilitySnapshotRepository();
  const audit = new InProcessAuditStore();
  const idempotency = new InProcessIdempotencyStore();
  const documentSequence = new InProcessDocumentSequenceStore();
  const tenantOwnershipValidator = opts.validator ?? new InMemoryTenantOwnershipValidator();
  const inventoryLedger = new InventoryLedgerService({ ledger: ledgerRepo, audit, idempotency, documentSequence });
  const subledger = new SubledgerService({ subledger: subledgerRepo, audit, idempotency, documentSequence });
  const snapshotService = new ProfitabilitySnapshotService({ snapshotRepository: snapshotRepo, salesRepository, audit });
  // WP-08-01E BLOCKER 2: simulated transaction runner with snapshot/restore
  // for in-memory repos. Required by fail-closed requireTransactionConfig().
  const transactionRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
    const snaps: any[] = [
      returnRepo.snapshot(), salesRepository.snapshot(),
      ledgerRepo.snapshot(), subledgerRepo.snapshot(), snapshotRepo.snapshot(),
    ];
    const auditRows = [...(audit as any).getRows()];
    try {
      return await work({ /* mock tx */ });
    } catch (e) {
      returnRepo.restore(snaps[0]); salesRepository.restore(snaps[1]);
      ledgerRepo.restore(snaps[2]); subledgerRepo.restore(snaps[3]); snapshotRepo.restore(snaps[4]);
      (audit as any).clear(); for (const r of auditRows) (audit as any).insertAuditLog(r);
      throw e;
    }
  };
  const txFactories = {
    createInventoryLedger: () => inventoryLedger,
    createSubledger: () => subledger,
    createSnapshotService: () => snapshotService,
    createSalesRepository: () => salesRepository,
    createReturnRequestRepository: () => returnRepo,
    createAudit: () => audit,
    createIdempotency: () => idempotency,
  };
  const returnService = new ReturnRequestService({
    returnRequestRepository: returnRepo,
    audit, idempotency, documentSequence,
    inventoryLedger, subledger, salesRepository, snapshotService,
    tenantOwnershipValidator,
    transactionRunner, txFactories,
  });
  return { returnRepo, salesRepository, ledgerRepo, subledgerRepo, snapshotRepo, audit, idempotency, documentSequence, inventoryLedger, subledger, snapshotService, returnService, tenantOwnershipValidator };
}

const TRANSFER_INPUT: CreateTransferRequestInput = {
  itemId: TEST_ITEM_ID,
  fromLocationId: TEST_LOC_A,
  toLocationId: TEST_LOC_B,
  quantityKg: "100.000",
  reason: "test",
  idempotencyKey: "wp-08-01a-transfer-001",
};

const RETURN_INPUT: CreateReturnRequestInput = {
  salesOrderId: TEST_SALE_ID,
  customerId: TEST_CUSTOMER_ID,
  returnDate: "2026-07-16",
  returnReason: "damaged",
  lines: [{
    originalSaleOrderId: TEST_SALE_ID,
    originalSaleLineId: TEST_SALE_LINE_ID,
    itemId: TEST_ITEM_ID,
    quantityKg: "50.000",
    returnLocationId: TEST_LOC_A,
    returnedStockStatus: "return_received",
  }],
  idempotencyKey: "wp-08-01a-rr-001",
};

// ---------------------------------------------------------------------------
// 1-3. Transfer cross-tenant rejection.
// ---------------------------------------------------------------------------

describe("WP-08-01A transfer cross-tenant rejection (zero writes)", () => {
  it("1. cross-tenant item rejected with zero writes", async () => {
    const deps = makeTransferDeps({
      validator: new InMemoryTenantOwnershipValidator().rejectItem(FOREIGN_ITEM_ID),
    });
    const beforeApprovals = (deps.approvalRepository as any).approvals.size;
    const beforeAudits = deps.audit.count();

    await expect(
      deps.service.createTransferRequest(makeUser(), makeWhEff(), { ...TRANSFER_INPUT, itemId: FOREIGN_ITEM_ID }),
    ).rejects.toThrow();

    const afterApprovals = (deps.approvalRepository as any).approvals.size;
    expect(afterApprovals).toBe(beforeApprovals);
    expect(deps.audit.count()).toBe(beforeAudits);
  });

  it("2. cross-tenant source location rejected with zero writes", async () => {
    const deps = makeTransferDeps({
      validator: new InMemoryTenantOwnershipValidator().rejectLocation(FOREIGN_LOC_ID),
    });
    const beforeApprovals = (deps.approvalRepository as any).approvals.size;
    const beforeAudits = deps.audit.count();

    await expect(
      deps.service.createTransferRequest(makeUser(), makeWhEff(), { ...TRANSFER_INPUT, fromLocationId: FOREIGN_LOC_ID }),
    ).rejects.toThrow();

    const afterApprovals = (deps.approvalRepository as any).approvals.size;
    expect(afterApprovals).toBe(beforeApprovals);
    expect(deps.audit.count()).toBe(beforeAudits);
  });

  it("3. cross-tenant destination location rejected with zero writes", async () => {
    const deps = makeTransferDeps({
      validator: new InMemoryTenantOwnershipValidator().rejectLocation(FOREIGN_LOC_ID),
    });
    const beforeApprovals = (deps.approvalRepository as any).approvals.size;
    const beforeAudits = deps.audit.count();

    await expect(
      deps.service.createTransferRequest(makeUser(), makeWhEff(), { ...TRANSFER_INPUT, toLocationId: FOREIGN_LOC_ID }),
    ).rejects.toThrow();

    const afterApprovals = (deps.approvalRepository as any).approvals.size;
    expect(afterApprovals).toBe(beforeApprovals);
    expect(deps.audit.count()).toBe(beforeAudits);
  });
});

// ---------------------------------------------------------------------------
// 4-6. Return cross-tenant rejection.
// ---------------------------------------------------------------------------

describe("WP-08-01A return cross-tenant rejection (zero writes)", () => {
  it("4. cross-tenant customer rejected with zero writes", async () => {
    const deps = makeReturnDeps({
      validator: new InMemoryTenantOwnershipValidator().rejectCustomer(FOREIGN_CUSTOMER_ID),
    });
    const beforeRR = (deps.returnRepo as any).returnRequests.size;
    const beforeLines = (deps.returnRepo as any).returnLines.size;
    const beforeAudits = deps.audit.count();
    const beforeIdem = (deps.idempotency as any).records.size;

    await expect(
      deps.returnService.createReturnRequest(makeUser(), makeWhEff(), {
        ...RETURN_INPUT,
        customerId: FOREIGN_CUSTOMER_ID,
        idempotencyKey: "wp-08-01a-x-cust",
      }),
    ).rejects.toThrow();

    expect((deps.returnRepo as any).returnRequests.size).toBe(beforeRR);
    expect((deps.returnRepo as any).returnLines.size).toBe(beforeLines);
    expect(deps.audit.count()).toBe(beforeAudits);
    expect((deps.idempotency as any).records.size).toBe(beforeIdem);
  });

  it("5. cross-tenant sale order rejected with zero writes", async () => {
    const deps = makeReturnDeps({
      validator: new InMemoryTenantOwnershipValidator().rejectSale(FOREIGN_SALE_ID),
    });
    const beforeRR = (deps.returnRepo as any).returnRequests.size;
    const beforeAudits = deps.audit.count();
    const beforeIdem = (deps.idempotency as any).records.size;

    await expect(
      deps.returnService.createReturnRequest(makeUser(), makeWhEff(), {
        ...RETURN_INPUT,
        salesOrderId: FOREIGN_SALE_ID,
        idempotencyKey: "wp-08-01a-x-sale",
      }),
    ).rejects.toThrow();

    expect((deps.returnRepo as any).returnRequests.size).toBe(beforeRR);
    expect(deps.audit.count()).toBe(beforeAudits);
    expect((deps.idempotency as any).records.size).toBe(beforeIdem);
  });

  it("6. cross-tenant sale line rejected with zero writes", async () => {
    const deps = makeReturnDeps({
      validator: new InMemoryTenantOwnershipValidator().rejectSaleLine(FOREIGN_SALE_LINE_ID),
    });
    const beforeRR = (deps.returnRepo as any).returnRequests.size;
    const beforeAudits = deps.audit.count();
    const beforeIdem = (deps.idempotency as any).records.size;

    await expect(
      deps.returnService.createReturnRequest(makeUser(), makeWhEff(), {
        ...RETURN_INPUT,
        lines: [{
          originalSaleOrderId: TEST_SALE_ID,
          originalSaleLineId: FOREIGN_SALE_LINE_ID,
          itemId: TEST_ITEM_ID,
          quantityKg: "50.000",
          returnLocationId: TEST_LOC_A,
          returnedStockStatus: "return_received",
        }],
        idempotencyKey: "wp-08-01a-x-line",
      }),
    ).rejects.toThrow();

    expect((deps.returnRepo as any).returnRequests.size).toBe(beforeRR);
    expect(deps.audit.count()).toBe(beforeAudits);
    expect((deps.idempotency as any).records.size).toBe(beforeIdem);
  });
});

// ---------------------------------------------------------------------------
// 7-9. Relation mismatches.
// ---------------------------------------------------------------------------

describe("WP-08-01A relation mismatch rejection", () => {
  it("7. sale order / customer mismatch rejected", async () => {
    const deps = makeReturnDeps({
      validator: new InMemoryTenantOwnershipValidator().rejectSaleCustomer(TEST_SALE_ID),
    });
    await expect(
      deps.returnService.createReturnRequest(makeUser(), makeWhEff(), {
        ...RETURN_INPUT,
        idempotencyKey: "wp-08-01a-mismatch-1",
      }),
    ).rejects.toThrow(/SALE_CUSTOMER_MISMATCH|does not belong to customer/);
  });

  it("8. sale line / order mismatch rejected", async () => {
    const deps = makeReturnDeps({
      validator: new InMemoryTenantOwnershipValidator().rejectSaleLineOrder(TEST_SALE_LINE_ID),
    });
    await expect(
      deps.returnService.createReturnRequest(makeUser(), makeWhEff(), {
        ...RETURN_INPUT,
        idempotencyKey: "wp-08-01a-mismatch-2",
      }),
    ).rejects.toThrow(/SALE_LINE_ORDER_MISMATCH|does not belong to sale order/);
  });

  it("9. sale line / item mismatch rejected", async () => {
    const deps = makeReturnDeps({
      validator: new InMemoryTenantOwnershipValidator().rejectSaleLineItem(TEST_SALE_LINE_ID),
    });
    await expect(
      deps.returnService.createReturnRequest(makeUser(), makeWhEff(), {
        ...RETURN_INPUT,
        idempotencyKey: "wp-08-01a-mismatch-3",
      }),
    ).rejects.toThrow(/SALE_LINE_ITEM_MISMATCH|does not reference item/);
  });
});

// ---------------------------------------------------------------------------
// 10-12. Atomicity + retry.
// ---------------------------------------------------------------------------

describe("WP-08-01A atomic return creation (rollback + retry)", () => {
  /**
   * Build deps with a mock transactionRunner that snapshots the in-memory
   * returnRepo + audit before work and restores them on throw — simulating
   * DB transaction rollback. This is the in-memory equivalent of
   * db.transaction().
   */
  function makeDepsWithTxRunner() {
    const returnRepo = new InMemoryReturnRequestRepository();
    const salesRepository = new InMemorySalesRepository();
    const ledgerRepo = new InMemoryInventoryLedgerRepository();
    const subledgerRepo = new InMemorySubledgerRepository();
    const snapshotRepo = new InMemoryProfitabilitySnapshotRepository();
    const audit = new InProcessAuditStore();
    const idempotency = new InProcessIdempotencyStore();
    const documentSequence = new InProcessDocumentSequenceStore();
    const tenantOwnershipValidator = new InMemoryTenantOwnershipValidator();
    const inventoryLedger = new InventoryLedgerService({ ledger: ledgerRepo, audit, idempotency, documentSequence });
    const subledger = new SubledgerService({ subledger: subledgerRepo, audit, idempotency, documentSequence });
    const snapshotService = new ProfitabilitySnapshotService({ snapshotRepository: snapshotRepo, salesRepository, audit });

    let txChain: Promise<unknown> = Promise.resolve();
    const transactionRunner: TransferTransactionRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
      const run = txChain.then(async () => {
        const rrSnap = returnRepo.snapshot();
        const auditRows = (audit as any).getRows() as any[];
        try {
          return await work({ /* mock tx */ });
        } catch (e) {
          returnRepo.restore(rrSnap);
          (audit as any).clear();
          for (const r of auditRows) (audit as any).insertAuditLog(r);
          throw e;
        }
      });
      txChain = run.then(() => undefined, () => undefined);
      return run as Promise<T>;
    };

    const txFactories = {
      createInventoryLedger: () => inventoryLedger,
      createSubledger: () => subledger,
      createSnapshotService: () => snapshotService,
      createSalesRepository: () => salesRepository,
      createReturnRequestRepository: () => returnRepo,
      createAudit: () => audit,
      createIdempotency: () => idempotency,
    };

    const returnService = new ReturnRequestService({
      returnRequestRepository: returnRepo,
      audit, idempotency, documentSequence,
      inventoryLedger, subledger, salesRepository, snapshotService,
      tenantOwnershipValidator,
      transactionRunner, txFactories,
    });
    return { returnRepo, salesRepository, ledgerRepo, subledgerRepo, snapshotRepo, audit, idempotency, documentSequence, inventoryLedger, subledger, snapshotService, returnService, tenantOwnershipValidator, transactionRunner };
  }

  it("10. line insertion failure rolls back header", async () => {
    const deps = makeDepsWithTxRunner();
    const beforeRR = (deps.returnRepo as any).returnRequests.size;
    const beforeLines = (deps.returnRepo as any).returnLines.size;
    const beforeAudits = deps.audit.count();

    const origInsertReturnLine = deps.returnRepo.insertReturnLine.bind(deps.returnRepo);
    let calls = 0;
    (deps.returnRepo as any).insertReturnLine = async (row: any) => {
      calls++;
      if (calls === 1) throw new Error("INJECTED: line insert failure");
      return origInsertReturnLine(row);
    };

    await expect(
      deps.returnService.createReturnRequest(makeUser(), makeWhEff(), {
        ...RETURN_INPUT,
        idempotencyKey: "wp-08-01a-rollback-1",
      }),
    ).rejects.toThrow(/INJECTED: line insert failure/);

    expect((deps.returnRepo as any).returnRequests.size).toBe(beforeRR);
    expect((deps.returnRepo as any).returnLines.size).toBe(beforeLines);
    expect(deps.audit.count()).toBe(beforeAudits);
  });

  it("11. audit failure rolls back header + lines", async () => {
    const deps = makeDepsWithTxRunner();
    const beforeRR = (deps.returnRepo as any).returnRequests.size;
    const beforeLines = (deps.returnRepo as any).returnLines.size;
    const beforeAudits = deps.audit.count();

    deps.audit.setShouldFail(true);
    await expect(
      deps.returnService.createReturnRequest(makeUser(), makeWhEff(), {
        ...RETURN_INPUT,
        idempotencyKey: "wp-08-01a-rollback-2",
      }),
    ).rejects.toThrow();
    deps.audit.setShouldFail(false);

    expect((deps.returnRepo as any).returnRequests.size).toBe(beforeRR);
    expect((deps.returnRepo as any).returnLines.size).toBe(beforeLines);
    expect(deps.audit.count()).toBe(beforeAudits);
  });

  it("12. retry after rollback succeeds (same idempotency key)", async () => {
    const deps = makeDepsWithTxRunner();

    const origInsertReturnLine = deps.returnRepo.insertReturnLine.bind(deps.returnRepo);
    let failOnce = true;
    (deps.returnRepo as any).insertReturnLine = async (row: any) => {
      if (failOnce) { failOnce = false; throw new Error("INJECTED: transient line insert failure"); }
      return origInsertReturnLine(row);
    };

    await expect(
      deps.returnService.createReturnRequest(makeUser(), makeWhEff(), {
        ...RETURN_INPUT,
        idempotencyKey: "wp-08-01a-retry-001",
      }),
    ).rejects.toThrow(/INJECTED: transient line insert failure/);

    expect((deps.returnRepo as any).returnRequests.size).toBe(0);
    expect((deps.returnRepo as any).returnLines.size).toBe(0);
    expect(deps.audit.count()).toBe(0);

    const result = await deps.returnService.createReturnRequest(makeUser(), makeWhEff(), {
      ...RETURN_INPUT,
      idempotencyKey: "wp-08-01a-retry-001",
    });
    expect(result.action).toBe("created");
    expect(result.status).toBe("draft");

    expect((deps.returnRepo as any).returnRequests.size).toBe(1);
    expect((deps.returnRepo as any).returnLines.size).toBe(1);
    expect(deps.audit.count()).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 13-14. Replay + conflict.
// ---------------------------------------------------------------------------

describe("WP-08-01A return idempotency replay + conflict", () => {
  it("13. duplicate replay returns same request", async () => {
    const deps = makeReturnDeps();
    const r1 = await deps.returnService.createReturnRequest(makeUser(), makeWhEff(), RETURN_INPUT);
    expect(r1.action).toBe("created");
    const firstId = r1.returnRequestId;

    const r2 = await deps.returnService.createReturnRequest(makeUser(), makeWhEff(), RETURN_INPUT);
    expect(r2.action).toBe("replayed");
    expect(r2.returnRequestId).toBe(firstId);

    expect((deps.returnRepo as any).returnRequests.size).toBe(1);
    expect((deps.returnRepo as any).returnLines.size).toBe(1);
  });

  it("14. conflicting replay rejects (same key, different payload)", async () => {
    const deps = makeReturnDeps();
    const r1 = await deps.returnService.createReturnRequest(makeUser(), makeWhEff(), RETURN_INPUT);
    expect(r1.action).toBe("created");

    await expect(
      deps.returnService.createReturnRequest(makeUser(), makeWhEff(), {
        ...RETURN_INPUT,
        returnReason: "different reason",
      }),
    ).rejects.toThrow(/IDEMPOTENCY_CONFLICT|was used with a different request body/);
  });
});

// ---------------------------------------------------------------------------
// 15-20. Transfer idempotency-key conflict detection (WP-08-01A correction).
// ---------------------------------------------------------------------------

describe("WP-08-01A transfer idempotency-key conflict detection", () => {
  it("15. first transfer create succeeds", async () => {
    const deps = makeTransferDeps();
    const r = await deps.service.createTransferRequest(makeUser(), makeWhEff(), {
      ...TRANSFER_INPUT,
      idempotencyKey: "wp0801a-tx-first",
    });
    expect(r.id).toBeTruthy();
    expect(r.state).toBe("active");
  });

  it("16. same key + same payload replays same request ID", async () => {
    const deps = makeTransferDeps();
    const r1 = await deps.service.createTransferRequest(makeUser(), makeWhEff(), {
      ...TRANSFER_INPUT,
      idempotencyKey: "wp0801a-tx-replay",
    });
    const r2 = await deps.service.createTransferRequest(makeUser(), makeWhEff(), {
      ...TRANSFER_INPUT,
      idempotencyKey: "wp0801a-tx-replay",
    });
    expect(r2.id).toBe(r1.id);
  });

  it("17. same key + different quantity conflicts (zero additional writes)", async () => {
    const deps = makeTransferDeps();
    const r1 = await deps.service.createTransferRequest(makeUser(), makeWhEff(), {
      ...TRANSFER_INPUT,
      idempotencyKey: "wp0801a-tx-qty-conflict",
    });
    const beforeApprovals = (deps.approvalRepository as any).approvals.size;
    const beforeAudits = deps.audit.count();

    await expect(
      deps.service.createTransferRequest(makeUser(), makeWhEff(), {
        ...TRANSFER_INPUT,
        quantityKg: "999.999",
        idempotencyKey: "wp0801a-tx-qty-conflict",
      }),
    ).rejects.toThrow(/IDEMPOTENCY_CONFLICT|was used with a different request body/);

    // Zero additional approval_requests + zero additional audit rows.
    expect((deps.approvalRepository as any).approvals.size).toBe(beforeApprovals);
    expect(deps.audit.count()).toBe(beforeAudits);
  });

  it("18. same key + different destination conflicts (zero additional writes)", async () => {
    const deps = makeTransferDeps();
    const r1 = await deps.service.createTransferRequest(makeUser(), makeWhEff(), {
      ...TRANSFER_INPUT,
      idempotencyKey: "wp0801a-tx-dest-conflict",
    });
    const beforeApprovals = (deps.approvalRepository as any).approvals.size;
    const beforeAudits = deps.audit.count();

    await expect(
      deps.service.createTransferRequest(makeUser(), makeWhEff(), {
        ...TRANSFER_INPUT,
        fromLocationId: TEST_LOC_B,
        toLocationId: TEST_LOC_A, // swapped direction
        idempotencyKey: "wp0801a-tx-dest-conflict",
      }),
    ).rejects.toThrow(/IDEMPOTENCY_CONFLICT|was used with a different request body/);

    expect((deps.approvalRepository as any).approvals.size).toBe(beforeApprovals);
    expect(deps.audit.count()).toBe(beforeAudits);
  });

  it("19. conflict count remains one request and one audit", async () => {
    const deps = makeTransferDeps();
    const r1 = await deps.service.createTransferRequest(makeUser(), makeWhEff(), {
      ...TRANSFER_INPUT,
      idempotencyKey: "wp0801a-tx-count",
    });

    // Attempt two conflicts (different qty, different dest) — both rejected.
    await expect(
      deps.service.createTransferRequest(makeUser(), makeWhEff(), {
        ...TRANSFER_INPUT, quantityKg: "999.999",
        idempotencyKey: "wp0801a-tx-count",
      }),
    ).rejects.toThrow();
    await expect(
      deps.service.createTransferRequest(makeUser(), makeWhEff(), {
        ...TRANSFER_INPUT, fromLocationId: TEST_LOC_B, toLocationId: TEST_LOC_A,
        idempotencyKey: "wp0801a-tx-count",
      }),
    ).rejects.toThrow();

    // Exactly one approval_request for this tenant (the original).
    const allApprovals = [...((deps.approvalRepository as any).approvals as Map<string, any>).values()];
    const tenantApprovals = allApprovals.filter((a: any) => a.tenantId === TEST_TENANT_ID);
    expect(tenantApprovals.length).toBe(1);
    expect(tenantApprovals[0]!.id).toBe(r1.id);

    // Exactly one audit row for transfer_request.create (the original).
    const transferAudits = deps.audit.getRows().filter((r: any) => r.entityType === "transfer_request" && r.actionType === "transfer_request.create");
    expect(transferAudits.length).toBe(1);
    expect(transferAudits[0]!.entityId).toBe(r1.id);
  });

  it("20. different idempotency key with same subject still dedups via subjectHash", async () => {
    const deps = makeTransferDeps();
    const r1 = await deps.service.createTransferRequest(makeUser(), makeWhEff(), {
      ...TRANSFER_INPUT,
      idempotencyKey: "wp0801a-tx-dedup-1",
    });
    // Different idempotency key but SAME params (same subjectHash).
    // The subjectHash dedup (secondary guard) returns the existing row.
    const r2 = await deps.service.createTransferRequest(makeUser(), makeWhEff(), {
      ...TRANSFER_INPUT,
      idempotencyKey: "wp0801a-tx-dedup-2",
    });
    expect(r2.id).toBe(r1.id);
  });
});
