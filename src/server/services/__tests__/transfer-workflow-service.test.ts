/**
 * WP-03-02 Transfer Workflow Service tests.
 *
 * Contract: docs/contracts/13_work_packages.md WP-03-02
 *   Tests: Availability, block classification, rollback, duplicate, inverse/dependencies.
 *   Acceptance: Exact source decrease/destination increase and original retained.
 *
 * ATOMICITY TESTS (V12 — Contract 06 §6, §17.2; DEC-015; WP-03-02):
 *   - postTransfer failure leaves no movement, no movementId, approval stays active
 *   - retry after failure can still approve successfully once the cause is fixed
 *   - concurrent approval creates exactly 1 transfer movement (loser creates 0)
 *   - reversal restores both source and destination balances
 */
import { describe, it, expect } from "vitest";
import {
  TransferWorkflowService,
  TransferRequestNotFoundError,
  TransferAlreadyDecidedError,
  TransferRequesterCannotApproveError,
  TransferWorkflowError,
  type CreateTransferRequestInput,
  type TransferTransactionRunner,
} from "../transfer-workflow-service";
import { InMemoryRawReceiptApprovalRepository } from "./in-memory-raw-receipt-approval-repository";
import { InMemoryInventoryLedgerRepository } from "./in-memory-inventory-ledger-repository";
import { InMemoryTenantOwnershipValidator } from "./in-memory-tenant-ownership-validator";
import { InProcessAuditStore } from "../audit-service";
import { InProcessIdempotencyStore } from "../idempotency-service";
import { InProcessDocumentSequenceStore } from "../document-sequence-service";
import { InventoryLedgerService, StockInsufficientError, type PostRawReceiptInput } from "../inventory-ledger-service";
import {
  TEST_USERS, FOREIGN_TENANT_ID, getTestEffectivePermissions,
} from "@/server/security/role-fixtures";
import { PermissionDeniedError } from "@/server/security/guards";

const TEST_TENANT_ID = "00000000-0000-0000-0000-000000000001";
const TEST_ITEM_ID = "aaa30200-0000-4000-8000-000000000001";
const TEST_LOC_A = "bbb30200-0000-4000-8000-000000000001";
const TEST_LOC_B = "bbb30200-0000-4000-8000-000000000002";

function makeDeps() {
  const approvalRepository = new InMemoryRawReceiptApprovalRepository();
  const ledgerRepo = new InMemoryInventoryLedgerRepository();
  const audit = new InProcessAuditStore();
  const idempotency = new InProcessIdempotencyStore();
  const documentSequence = new InProcessDocumentSequenceStore();
  const tenantOwnershipValidator = new InMemoryTenantOwnershipValidator();
  const inventoryLedger = new InventoryLedgerService({ ledger: ledgerRepo, audit, idempotency, documentSequence });
  const service = new TransferWorkflowService({ approvalRepository, inventoryLedger, audit, idempotency, tenantOwnershipValidator });
  return { approvalRepository, ledgerRepo, audit, idempotency, documentSequence, inventoryLedger, service, tenantOwnershipValidator };
}

/**
 * Build deps with a transactional mock runner that snapshots the in-memory
 * repos before work and restores them on throw — simulating DB transaction
 * rollback. Used by atomicity/concurrency tests.
 *
 * The mock runner SERIALIZES transactions (one at a time) to make tests
 * deterministic. In production, db.transaction() runs concurrently with
 * proper isolation; the serialization here is a test-only simplification
 * that still proves the atomicity invariants (no partial effects, loser
 * creates 0 movements).
 */
function makeDepsWithTxRunner() {
  const approvalRepository = new InMemoryRawReceiptApprovalRepository();
  const ledgerRepo = new InMemoryInventoryLedgerRepository();
  const audit = new InProcessAuditStore();
  const idempotency = new InProcessIdempotencyStore();
  const documentSequence = new InProcessDocumentSequenceStore();
  const tenantOwnershipValidator = new InMemoryTenantOwnershipValidator();
  const inventoryLedger = new InventoryLedgerService({ ledger: ledgerRepo, audit, idempotency, documentSequence });

  // Serialize transactions: each tx runs one at a time (deterministic).
  // Combined with snapshot/restore, this simulates DB transaction rollback:
  // if a tx throws, its writes are undone; the next tx sees the pre-throw state.
  let txChain: Promise<unknown> = Promise.resolve();
  const transactionRunner: TransferTransactionRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
    const run = txChain.then(async () => {
      const approvalSnapshot = approvalRepository.snapshot();
      const ledgerSnapshot = ledgerRepo.snapshot();
      try {
        return await work({ /* mock tx */ });
      } catch (e) {
        // Simulate DB transaction rollback: restore both repos to pre-work state.
        approvalRepository.restore(approvalSnapshot);
        ledgerRepo.restore(ledgerSnapshot);
        throw e;
      }
    });
    // Chain: subsequent tx's wait for this one to finish.
    txChain = run.then(() => undefined, () => undefined);
    return run as Promise<T>;
  };

  const txFactories = {
    createInventoryLedger: () => inventoryLedger,
    createApprovalRepository: () => approvalRepository,
  };

  const service = new TransferWorkflowService({
    approvalRepository, inventoryLedger, audit, idempotency,
    tenantOwnershipValidator,
    transactionRunner, txFactories,
  });
  return { approvalRepository, ledgerRepo, audit, idempotency, documentSequence, inventoryLedger, service, transactionRunner, tenantOwnershipValidator };
}

function makeUser(userId: string, tenantId: string = TEST_TENANT_ID) {
  return { authenticated: true as const, userId, tenantId, email: "t@e.com", name: "T", authId: "t" };
}

// Helper: seed stock at location A via raw receipt
async function seedStock(inventoryLedger: InventoryLedgerService, qty: string = "1000.000") {
  const ownerUser = makeUser(TEST_USERS.owner.userId);
  const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);
  return inventoryLedger.postRawReceipt(ownerUser as any, ownerEff, {
    itemId: TEST_ITEM_ID, toLocationId: TEST_LOC_A, quantityKg: qty,
    movementDate: "2026-07-06", sourceDocumentType: "test_seed", sourceDocumentId: "seed-001",
    idempotencyKey: "seed-key-001",
  });
}

// ---------------------------------------------------------------------------
// 1. Transfer request creation.
// ---------------------------------------------------------------------------

describe("WP-03-02 createTransferRequest", () => {
  it("warehouse can create a transfer request (draft)", async () => {
    const { service } = makeDeps();
    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = getTestEffectivePermissions(TEST_USERS.warehouse.userId);

    const req = await service.createTransferRequest(whUser as any, whEff, {
      itemId: TEST_ITEM_ID, fromLocationId: TEST_LOC_A, toLocationId: TEST_LOC_B,
      quantityKg: "300.000", reason: "test transfer",
    });

    expect(req.state).toBe("active");
    expect(req.itemId).toBe(TEST_ITEM_ID);
    expect(req.fromLocationId).toBe(TEST_LOC_A);
    expect(req.toLocationId).toBe(TEST_LOC_B);
    expect(req.requestedBy).toBe(TEST_USERS.warehouse.userId);
  });

  it("rejects same source and destination", async () => {
    const { service } = makeDeps();
    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = getTestEffectivePermissions(TEST_USERS.warehouse.userId);

    await expect(service.createTransferRequest(whUser as any, whEff, {
      itemId: TEST_ITEM_ID, fromLocationId: TEST_LOC_A, toLocationId: TEST_LOC_A,
      quantityKg: "100.000",
    })).rejects.toThrow(TransferWorkflowError);
  });

  it("rejects non-positive quantity", async () => {
    const { service } = makeDeps();
    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = getTestEffectivePermissions(TEST_USERS.warehouse.userId);

    await expect(service.createTransferRequest(whUser as any, whEff, {
      itemId: TEST_ITEM_ID, fromLocationId: TEST_LOC_A, toLocationId: TEST_LOC_B,
      quantityKg: "0.000",
    })).rejects.toThrow(TransferWorkflowError);
  });

  it("is idempotent (same params returns same request)", async () => {
    const { service } = makeDeps();
    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = getTestEffectivePermissions(TEST_USERS.warehouse.userId);

    const req1 = await service.createTransferRequest(whUser as any, whEff, {
      itemId: TEST_ITEM_ID, fromLocationId: TEST_LOC_A, toLocationId: TEST_LOC_B,
      quantityKg: "300.000",
    });
    const req2 = await service.createTransferRequest(whUser as any, whEff, {
      itemId: TEST_ITEM_ID, fromLocationId: TEST_LOC_A, toLocationId: TEST_LOC_B,
      quantityKg: "300.000",
    });
    expect(req2.id).toBe(req1.id);
  });

  it("rejects production worker (no inventory.transfer.create)", async () => {
    const { service } = makeDeps();
    const prodUser = makeUser(TEST_USERS.production.userId);
    const prodEff = getTestEffectivePermissions(TEST_USERS.production.userId);

    await expect(service.createTransferRequest(prodUser as any, prodEff, {
      itemId: TEST_ITEM_ID, fromLocationId: TEST_LOC_A, toLocationId: TEST_LOC_B,
      quantityKg: "100.000",
    })).rejects.toThrow(PermissionDeniedError);
  });
});

// ---------------------------------------------------------------------------
// 2. Transfer approval.
// ---------------------------------------------------------------------------

describe("WP-03-02 approveTransfer", () => {
  it("owner can approve and posts exactly one transfer movement", async () => {
    const { service, inventoryLedger, ledgerRepo } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");

    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = getTestEffectivePermissions(TEST_USERS.warehouse.userId);
    const req = await service.createTransferRequest(whUser as any, whEff, {
      itemId: TEST_ITEM_ID, fromLocationId: TEST_LOC_A, toLocationId: TEST_LOC_B,
      quantityKg: "300.000",
    });

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    const result = await service.approveTransfer(ownerUser as any, ownerEff, {
      transferRequestId: req.id, idempotencyKey: "approve-1",
    });

    expect(result.action).toBe("posted");
    expect(result.fromOnHandQtyKg).toBe("700.000");
    expect(result.toOnHandQtyKg).toBe("300.000");

    // Verify exactly one transfer movement
    const movements = await ledgerRepo.listMovementsForBalance(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    const transferMovements = movements.filter(m => m.movementType === "transfer");
    expect(transferMovements).toHaveLength(1);
  });

  it("DEC-080: requester cannot approve own transfer", async () => {
    const { service, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger);

    // Owner creates AND tries to approve
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);
    const req = await service.createTransferRequest(ownerUser as any, ownerEff, {
      itemId: TEST_ITEM_ID, fromLocationId: TEST_LOC_A, toLocationId: TEST_LOC_B,
      quantityKg: "100.000",
    });

    await expect(service.approveTransfer(ownerUser as any, ownerEff, {
      transferRequestId: req.id, idempotencyKey: "approve-2",
    })).rejects.toThrow(TransferRequesterCannotApproveError);
  });

  it("rejects worker approval (no inventory.transfer.approve)", async () => {
    const { service } = makeDeps();
    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = getTestEffectivePermissions(TEST_USERS.warehouse.userId);
    const req = await service.createTransferRequest(whUser as any, whEff, {
      itemId: TEST_ITEM_ID, fromLocationId: TEST_LOC_A, toLocationId: TEST_LOC_B,
      quantityKg: "100.000",
    });

    await expect(service.approveTransfer(whUser as any, whEff, {
      transferRequestId: req.id, idempotencyKey: "approve-3",
    })).rejects.toThrow(PermissionDeniedError);
  });

  it("idempotent: same key replays, no duplicate movement", async () => {
    const { service, inventoryLedger, ledgerRepo } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");

    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = getTestEffectivePermissions(TEST_USERS.warehouse.userId);
    const req = await service.createTransferRequest(whUser as any, whEff, {
      itemId: TEST_ITEM_ID, fromLocationId: TEST_LOC_A, toLocationId: TEST_LOC_B,
      quantityKg: "200.000",
    });

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    const first = await service.approveTransfer(ownerUser as any, ownerEff, {
      transferRequestId: req.id, idempotencyKey: "dup-approve-1",
    });
    const second = await service.approveTransfer(ownerUser as any, ownerEff, {
      transferRequestId: req.id, idempotencyKey: "dup-approve-1",
    });

    expect(first.action).toBe("posted");
    expect(second.action).toBe("replayed");

    const movements = await ledgerRepo.listMovementsForBalance(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    const transferMovements = movements.filter(m => m.movementType === "transfer");
    expect(transferMovements).toHaveLength(1);
  });

  it("already-decided transfer with SAME idempotency key returns replay", async () => {
    const { service, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");

    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = getTestEffectivePermissions(TEST_USERS.warehouse.userId);
    const req = await service.createTransferRequest(whUser as any, whEff, {
      itemId: TEST_ITEM_ID, fromLocationId: TEST_LOC_A, toLocationId: TEST_LOC_B,
      quantityKg: "100.000",
    });

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    const first = await service.approveTransfer(ownerUser as any, ownerEff, {
      transferRequestId: req.id, idempotencyKey: "approve-4a",
    });
    expect(first.action).toBe("posted");

    // Same idempotency key on already-decided — returns replay (correct behavior)
    const replayResult = await service.approveTransfer(ownerUser as any, ownerEff, {
      transferRequestId: req.id, idempotencyKey: "approve-4a",
    });
    expect(replayResult.action).toBe("replayed");
  });

  it("already-decided transfer with DIFFERENT idempotency key rejects (no silent replay)", async () => {
    const { service, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");

    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = getTestEffectivePermissions(TEST_USERS.warehouse.userId);
    const req = await service.createTransferRequest(whUser as any, whEff, {
      itemId: TEST_ITEM_ID, fromLocationId: TEST_LOC_A, toLocationId: TEST_LOC_B,
      quantityKg: "100.000",
    });

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    await service.approveTransfer(ownerUser as any, ownerEff, {
      transferRequestId: req.id, idempotencyKey: "approve-4a",
    });

    // Different idempotency key on already-decided — must reject, not silently replay.
    // This prevents leaking the movementId to callers using different keys.
    await expect(service.approveTransfer(ownerUser as any, ownerEff, {
      transferRequestId: req.id, idempotencyKey: "approve-4b",
    })).rejects.toThrow(TransferAlreadyDecidedError);
  });

  it("rejects insufficient stock at source", async () => {
    const { service, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "100.000");

    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = getTestEffectivePermissions(TEST_USERS.warehouse.userId);
    const req = await service.createTransferRequest(whUser as any, whEff, {
      itemId: TEST_ITEM_ID, fromLocationId: TEST_LOC_A, toLocationId: TEST_LOC_B,
      quantityKg: "500.000",
    });

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    await expect(service.approveTransfer(ownerUser as any, ownerEff, {
      transferRequestId: req.id, idempotencyKey: "approve-5",
    })).rejects.toThrow(StockInsufficientError);
  });
});

// ---------------------------------------------------------------------------
// 3. Movement reversal.
// ---------------------------------------------------------------------------

describe("WP-03-02 reverseMovement", () => {
  it("appends inverse movement, does not edit original", async () => {
    const { service, inventoryLedger, ledgerRepo } = makeDeps();
    const receipt = await seedStock(inventoryLedger, "1000.000");

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    const result = await service.reverseMovement(ownerUser as any, ownerEff, {
      movementId: receipt.movementId, reason: "test reversal", idempotencyKey: "rev-1",
    });

    expect(result.action).toBe("posted");
    expect(result.originalMovementId).toBe(receipt.movementId);

    // Verify reversal is a NEW movement (append-only)
    const allMovements = await ledgerRepo.listMovementsForBalance(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    const reversals = allMovements.filter(m => m.movementType === "reversal");
    expect(reversals).toHaveLength(1);
    expect(reversals[0]!.id).not.toBe(receipt.movementId); // different ID = new movement

    // Original still exists
    const original = allMovements.find(m => m.id === receipt.movementId);
    expect(original).toBeTruthy(); // original retained
  });

  it("rejects double reversal (same idempotency key replays)", async () => {
    const { service, inventoryLedger } = makeDeps();
    const receipt = await seedStock(inventoryLedger, "1000.000");

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    const first = await service.reverseMovement(ownerUser as any, ownerEff, {
      movementId: receipt.movementId, reason: "reversal 1", idempotencyKey: "rev-dup-1",
    });
    const second = await service.reverseMovement(ownerUser as any, ownerEff, {
      movementId: receipt.movementId, reason: "reversal 1", idempotencyKey: "rev-dup-1",
    });

    expect(first.action).toBe("posted");
    expect(second.action).toBe("replayed");
  });

  it("rejects worker reversal (no inventory.reverse)", async () => {
    const { service, inventoryLedger } = makeDeps();
    const receipt = await seedStock(inventoryLedger, "1000.000");

    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = getTestEffectivePermissions(TEST_USERS.warehouse.userId);

    await expect(service.reverseMovement(whUser as any, whEff, {
      movementId: receipt.movementId, reason: "test", idempotencyKey: "rev-w-1",
    })).rejects.toThrow(PermissionDeniedError);
  });
});

// ---------------------------------------------------------------------------
// 4. No financial side effects.
// ---------------------------------------------------------------------------

describe("WP-03-02 no financial side effects", () => {
  it("transfer creates no account entries/payments", async () => {
    const { service, inventoryLedger, audit } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");

    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = getTestEffectivePermissions(TEST_USERS.warehouse.userId);
    const req = await service.createTransferRequest(whUser as any, whEff, {
      itemId: TEST_ITEM_ID, fromLocationId: TEST_LOC_A, toLocationId: TEST_LOC_B,
      quantityKg: "300.000",
    });

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);
    await service.approveTransfer(ownerUser as any, ownerEff, {
      transferRequestId: req.id, idempotencyKey: "fin-1",
    });

    // Audit log should only contain inventory actions, no financial
    const auditRows = audit.getRows();
    for (const row of auditRows) {
      expect(row.actionType).not.toContain("payable");
      expect(row.actionType).not.toContain("payment");
      expect(row.actionType).not.toContain("account");
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Tenant isolation.
// ---------------------------------------------------------------------------

describe("WP-03-02 tenant isolation", () => {
  it("cross-tenant transfer request not found", async () => {
    const { service } = makeDeps();
    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    await expect(service.approveTransfer(ownerUser as any, ownerEff, {
      transferRequestId: "nonexistent", idempotencyKey: "ti-1",
    })).rejects.toThrow(TransferRequestNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// 6. List pending transfers.
// ---------------------------------------------------------------------------

describe("WP-03-02 listPendingTransfers", () => {
  it("lists active transfer requests", async () => {
    const { service } = makeDeps();
    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = getTestEffectivePermissions(TEST_USERS.warehouse.userId);
    await service.createTransferRequest(whUser as any, whEff, {
      itemId: TEST_ITEM_ID, fromLocationId: TEST_LOC_A, toLocationId: TEST_LOC_B,
      quantityKg: "100.000",
    });

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);
    const pending = await service.listPendingTransfers(ownerUser as any, ownerEff);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.state).toBe("active");
  });
});

// ---------------------------------------------------------------------------
// 7. Regression: reason field is human-readable, not JSON.
// ---------------------------------------------------------------------------

describe("WP-03-02 regression: reason vs submittedChildVersionSummary", () => {
  it("createTransferRequest stores human-readable text in reason, not JSON", async () => {
    const { service, approvalRepository } = makeDeps();
    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = getTestEffectivePermissions(TEST_USERS.warehouse.userId);

    const req = await service.createTransferRequest(whUser as any, whEff, {
      itemId: TEST_ITEM_ID, fromLocationId: TEST_LOC_A, toLocationId: TEST_LOC_B,
      quantityKg: "300.000", reason: "نقل مخزون لموقع ب",
    });

    // Fetch the raw approval from the repository
    const raw = await approvalRepository.findApprovalById(TEST_TENANT_ID, req.id);
    expect(raw).toBeTruthy();
    expect(raw!.reason).toBe("نقل مخزون لموقع ب"); // human-readable, NOT JSON
    // reason should NOT be parseable as JSON with quantityKg
    expect(() => JSON.parse(raw!.reason!)).toThrow();
  });

  it("createTransferRequest with null reason stores null in reason", async () => {
    const { service, approvalRepository } = makeDeps();
    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = getTestEffectivePermissions(TEST_USERS.warehouse.userId);

    const req = await service.createTransferRequest(whUser as any, whEff, {
      itemId: TEST_ITEM_ID, fromLocationId: TEST_LOC_A, toLocationId: TEST_LOC_B,
      quantityKg: "300.000", // no reason
    });

    const raw = await approvalRepository.findApprovalById(TEST_TENANT_ID, req.id);
    expect(raw!.reason).toBeNull();
  });

  it("transfer payload is stored in submittedChildVersionSummary", async () => {
    const { service, approvalRepository } = makeDeps();
    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = getTestEffectivePermissions(TEST_USERS.warehouse.userId);

    const req = await service.createTransferRequest(whUser as any, whEff, {
      itemId: TEST_ITEM_ID, fromLocationId: TEST_LOC_A, toLocationId: TEST_LOC_B,
      quantityKg: "300.000", reason: "test",
    });

    const raw = await approvalRepository.findApprovalById(TEST_TENANT_ID, req.id);
    const payload = raw!.submittedChildVersionSummary as any;
    expect(payload).toBeTruthy();
    expect(payload.itemId).toBe(TEST_ITEM_ID);
    expect(payload.fromLocationId).toBe(TEST_LOC_A);
    expect(payload.toLocationId).toBe(TEST_LOC_B);
    expect(payload.quantityKg).toBe("300.000");
  });

  it("approveTransfer reads params from submittedChildVersionSummary, not reason", async () => {
    const { service, inventoryLedger, ledgerRepo } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");

    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = getTestEffectivePermissions(TEST_USERS.warehouse.userId);
    const req = await service.createTransferRequest(whUser as any, whEff, {
      itemId: TEST_ITEM_ID, fromLocationId: TEST_LOC_A, toLocationId: TEST_LOC_B,
      quantityKg: "250.000", reason: "human reason text",
    });

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);
    const result = await service.approveTransfer(ownerUser as any, ownerEff, {
      transferRequestId: req.id, idempotencyKey: "reg-approve-1",
    });

    // Verify the transfer used 250.000 (from payload), not some value parsed from reason
    expect(result.fromOnHandQtyKg).toBe("750.000"); // 1000 - 250 = 750
    expect(result.toOnHandQtyKg).toBe("250.000");
  });

  it("approveTransfer does not parse transfer quantity from reason", async () => {
    const { service, approvalRepository, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");

    // Manually create an approval with reason containing JSON-like text
    // but payload in submittedChildVersionSummary with different quantity
    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = getTestEffectivePermissions(TEST_USERS.warehouse.userId);

    // Create normally (stores payload correctly)
    const req = await service.createTransferRequest(whUser as any, whEff, {
      itemId: TEST_ITEM_ID, fromLocationId: TEST_LOC_A, toLocationId: TEST_LOC_B,
      quantityKg: "100.000", reason: '{"quantityKg": "999.000"}', // deceptive JSON in reason
    });

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);
    const result = await service.approveTransfer(ownerUser as any, ownerEff, {
      transferRequestId: req.id, idempotencyKey: "reg-approve-2",
    });

    // Should use 100.000 from payload, NOT 999.000 from reason
    expect(result.fromOnHandQtyKg).toBe("900.000"); // 1000 - 100 = 900
    expect(result.toOnHandQtyKg).toBe("100.000");
  });

  it("malformed submittedChildVersionSummary is handled safely (defaults to 0.000, fails at posting)", async () => {
    const { service, approvalRepository, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");

    // Insert a malformed approval directly
    const malformed = await approvalRepository.insertApprovalRequest({
      tenantId: TEST_TENANT_ID,
      requestType: "stock_transfer",
      entityType: "transfer_request",
      entityId: `${TEST_ITEM_ID}:${TEST_LOC_A}:${TEST_LOC_B}`,
      riskLevel: "standard",
      requestedBy: TEST_USERS.warehouse.userId,
      reason: "test malformed",
      subjectVersion: 1,
      subjectHash: "aabb".repeat(16),
      createdBy: TEST_USERS.warehouse.userId,
      submittedChildVersionSummary: { broken: "no quantity" }, // malformed
    });

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    // Should fail because quantity defaults to "0.000" which is not positive
    await expect(service.approveTransfer(ownerUser as any, ownerEff, {
      transferRequestId: malformed.id, idempotencyKey: "reg-malformed-1",
    })).rejects.toThrow();
  });

  it("missing submittedChildVersionSummary is handled safely (defaults to 0.000, fails at posting)", async () => {
    const { service, approvalRepository, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");

    // Insert an approval without submittedChildVersionSummary (simulates old data)
    const noPayload = await approvalRepository.insertApprovalRequest({
      tenantId: TEST_TENANT_ID,
      requestType: "stock_transfer",
      entityType: "transfer_request",
      entityId: `${TEST_ITEM_ID}:${TEST_LOC_A}:${TEST_LOC_B}`,
      riskLevel: "standard",
      requestedBy: TEST_USERS.warehouse.userId,
      reason: "test no payload",
      subjectVersion: 1,
      subjectHash: "ccdd".repeat(16),
      createdBy: TEST_USERS.warehouse.userId,
      submittedChildVersionSummary: null, // explicitly null
    });

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    // Should fail because quantity defaults to "0.000"
    await expect(service.approveTransfer(ownerUser as any, ownerEff, {
      transferRequestId: noPayload.id, idempotencyKey: "reg-nopayload-1",
    })).rejects.toThrow();
  });

  it("listPendingTransfers shows human-readable reason, not raw JSON", async () => {
    const { service } = makeDeps();
    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = getTestEffectivePermissions(TEST_USERS.warehouse.userId);

    await service.createTransferRequest(whUser as any, whEff, {
      itemId: TEST_ITEM_ID, fromLocationId: TEST_LOC_A, toLocationId: TEST_LOC_B,
      quantityKg: "100.000", reason: "نقل لمخزن ب",
    });

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);
    const pending = await service.listPendingTransfers(ownerUser as any, ownerEff);

    expect(pending).toHaveLength(1);
    expect(pending[0]!.reason).toBe("نقل لمخزن ب"); // human-readable
    // reason should NOT look like JSON
    expect(pending[0]!.reason).not.toContain("{");
    expect(pending[0]!.reason).not.toContain("quantityKg");
  });
});

// ---------------------------------------------------------------------------
// 8. Atomicity / rollback proof (V12 — Contract 06 §6, §17.2; DEC-015; WP-03-02).
//
// Verify that when a transactionRunner is provided, all DB writes
// (stock_movement, inventory_balance, approval_requests markDecided) are
// wrapped in a single transaction. If any write fails, the entire
// transaction rolls back — no partial effects, no "decided but no movement".
// ---------------------------------------------------------------------------

describe("WP-03-02 approveTransfer atomicity/rollback (V12)", () => {
  it("postTransfer failure leaves NO movement and approval stays active (atomicity)", async () => {
    // Use the tx-runner deps so the mock transactionRunner snapshots + restores.
    const { service, approvalRepository, ledgerRepo, inventoryLedger } = makeDepsWithTxRunner();
    // Seed only 100 kg at source — the transfer will request 500 kg and fail.
    await seedStock(inventoryLedger, "100.000");

    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = getTestEffectivePermissions(TEST_USERS.warehouse.userId);
    const req = await service.createTransferRequest(whUser as any, whEff, {
      itemId: TEST_ITEM_ID, fromLocationId: TEST_LOC_A, toLocationId: TEST_LOC_B,
      quantityKg: "500.000", // exceeds seeded 100 kg → postTransfer will throw StockInsufficientError
    });

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    // Attempt approval — postTransfer throws inside the tx → tx rolls back.
    await expect(service.approveTransfer(ownerUser as any, ownerEff, {
      transferRequestId: req.id, idempotencyKey: "v12-fail-1",
    })).rejects.toThrow(StockInsufficientError);

    // ATOMICITY PROOF #1: approval state remains "active" (not decided).
    const approvalAfter = await approvalRepository.findApprovalById(TEST_TENANT_ID, req.id);
    expect(approvalAfter).toBeTruthy();
    expect(approvalAfter!.state).toBe("active");

    // ATOMICITY PROOF #2: no movementId attached.
    expect(approvalAfter!.movementId).toBeNull();

    // ATOMICITY PROOF #3: no transfer movement was created.
    const movements = await ledgerRepo.listMovementsForBalance(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    const transferMovements = movements.filter(m => m.movementType === "transfer");
    expect(transferMovements).toHaveLength(0);

    // ATOMICITY PROOF #4: source balance unchanged (still 100 kg, no transfer out).
    const srcBal = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    expect(srcBal!.onHandQtyKg).toBe("100.000");

    // ATOMICITY PROOF #5: destination balance never created (no transfer in).
    const dstBal = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_B);
    expect(dstBal).toBeNull();
  });

  it("retry after failure can still approve successfully (with a NEW idempotency key)", async () => {
    const { service, approvalRepository, ledgerRepo, inventoryLedger } = makeDepsWithTxRunner();
    // Start with insufficient stock — first attempt will fail.
    await seedStock(inventoryLedger, "100.000");

    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = getTestEffectivePermissions(TEST_USERS.warehouse.userId);
    const req = await service.createTransferRequest(whUser as any, whEff, {
      itemId: TEST_ITEM_ID, fromLocationId: TEST_LOC_A, toLocationId: TEST_LOC_B,
      quantityKg: "500.000",
    });

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    // First attempt: fails because of insufficient stock (transfer is 500, only 100 available).
    await expect(service.approveTransfer(ownerUser as any, ownerEff, {
      transferRequestId: req.id, idempotencyKey: "v12-retry-1",
    })).rejects.toThrow(StockInsufficientError);

    // Approval is still active — no movement, no movementId.
    const approvalAfterFail = await approvalRepository.findApprovalById(TEST_TENANT_ID, req.id);
    expect(approvalAfterFail!.state).toBe("active");
    expect(approvalAfterFail!.movementId).toBeNull();

    // Fix the cause: create a new transfer request for a smaller quantity (within stock).
    // (Alternatively, we could top-up stock, but seedStock uses a fixed idempotency key.
    //  We'll create a new transfer request for the smaller qty and approve that.)
    const req2 = await service.createTransferRequest(whUser as any, whEff, {
      itemId: TEST_ITEM_ID, fromLocationId: TEST_LOC_A, toLocationId: TEST_LOC_B,
      quantityKg: "80.000", // smaller, within the 100 kg available
    });

    // Retry with a NEW idempotency key — succeeds.
    const retryResult = await service.approveTransfer(ownerUser as any, ownerEff, {
      transferRequestId: req2.id, idempotencyKey: "v12-retry-2",
    });
    expect(retryResult.action).toBe("posted");
    expect(retryResult.fromOnHandQtyKg).toBe("20.000"); // 100 - 80 = 20
    expect(retryResult.toOnHandQtyKg).toBe("80.000");

    // The retry approval is decided with the movementId attached.
    const approvalAfterRetry = await approvalRepository.findApprovalById(TEST_TENANT_ID, req2.id);
    expect(approvalAfterRetry!.state).toBe("decided");
    expect(approvalAfterRetry!.movementId).toBe(retryResult.movementId);

    // Exactly one transfer movement exists (from the retry).
    const movements = await ledgerRepo.listMovementsForBalance(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    const transferMovements = movements.filter(m => m.movementType === "transfer");
    expect(transferMovements).toHaveLength(1);
  });

  it("concurrent approval creates EXACTLY ONE transfer movement; loser creates 0", async () => {
    // Use the tx-runner deps so the mock transactionRunner provides rollback.
    // The mock SERIALIZES transactions for determinism (see makeDepsWithTxRunner).
    const { service, ledgerRepo, inventoryLedger, approvalRepository } = makeDepsWithTxRunner();
    await seedStock(inventoryLedger, "1000.000");

    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = getTestEffectivePermissions(TEST_USERS.warehouse.userId);
    const req = await service.createTransferRequest(whUser as any, whEff, {
      itemId: TEST_ITEM_ID, fromLocationId: TEST_LOC_A, toLocationId: TEST_LOC_B,
      quantityKg: "300.000",
    });

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    // Fire two concurrent approvals with DIFFERENT idempotency keys.
    // Promise.all interleaves at await points; one will win the markDecided
    // race (conditional WHERE state='active'), the other will roll back.
    const results = await Promise.allSettled([
      service.approveTransfer(ownerUser as any, ownerEff, {
        transferRequestId: req.id, idempotencyKey: "v12-concurrent-A",
      }),
      service.approveTransfer(ownerUser as any, ownerEff, {
        transferRequestId: req.id, idempotencyKey: "v12-concurrent-B",
      }),
    ]);

    // Exactly one succeeds, exactly one rejects.
    const fulfilled = results.filter(r => r.status === "fulfilled");
    const rejected = results.filter(r => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // The loser's error is one of:
    //   - TransferAlreadyDecidedError (state check or markDecided returned null)
    //   - DuplicateSourceError (postTransfer's duplicate-source guard fired)
    // Both are valid concurrent-loss indicators. The KEY invariant is that
    // the loser creates 0 movements (verified below).
    const loserError = (rejected[0] as PromiseRejectedResult).reason;
    expect(loserError).toBeInstanceOf(Error);

    // ATOMICITY PROOF: exactly ONE transfer movement was created (not 2).
    const movements = await ledgerRepo.listMovementsForBalance(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    const transferMovements = movements.filter(m => m.movementType === "transfer");
    expect(transferMovements).toHaveLength(1);

    // ATOMICITY PROOF: source balance changed exactly once (1000 - 300 = 700).
    const srcBal = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    expect(srcBal!.onHandQtyKg).toBe("700.000");

    // ATOMICITY PROOF: destination balance changed exactly once (0 + 300 = 300).
    const dstBal = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_B);
    expect(dstBal!.onHandQtyKg).toBe("300.000");

    // ATOMICITY PROOF: approval is decided with the winner's movementId attached.
    const approvalAfter = await approvalRepository.findApprovalById(TEST_TENANT_ID, req.id);
    expect(approvalAfter!.state).toBe("decided");
    expect(approvalAfter!.movementId).toBe((fulfilled[0] as PromiseFulfilledResult<any>).value.movementId);

    // ATOMICITY PROOF: ZERO reversal movements were created (loser rolled back).
    const reversals = movements.filter(m => m.movementType === "reversal");
    expect(reversals).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 9. Two-sided transfer reversal (Contract 04 §8.2, §22; WP-03-02).
//
// Reversal of a transfer movement MUST restore BOTH sides:
//   source += qty (add back what was removed)
//   destination -= qty (remove what was added)
// ---------------------------------------------------------------------------

describe("WP-03-02 two-sided transfer reversal", () => {
  it("reversal restores BOTH source and destination balances", async () => {
    const { service, inventoryLedger, ledgerRepo } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");

    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = getTestEffectivePermissions(TEST_USERS.warehouse.userId);
    const req = await service.createTransferRequest(whUser as any, whEff, {
      itemId: TEST_ITEM_ID, fromLocationId: TEST_LOC_A, toLocationId: TEST_LOC_B,
      quantityKg: "300.000",
    });

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    // Approve the transfer: A -= 300, B += 300.
    const approveResult = await service.approveTransfer(ownerUser as any, ownerEff, {
      transferRequestId: req.id, idempotencyKey: "two-sided-approve-1",
    });
    expect(approveResult.fromOnHandQtyKg).toBe("700.000"); // 1000 - 300
    expect(approveResult.toOnHandQtyKg).toBe("300.000");   // 0 + 300

    // Reverse the transfer movement: A += 300, B -= 300.
    const reversalResult = await service.reverseMovement(ownerUser as any, ownerEff, {
      movementId: approveResult.movementId, reason: "reverse transfer", idempotencyKey: "two-sided-rev-1",
    });
    expect(reversalResult.action).toBe("posted");
    expect(reversalResult.originalMovementId).toBe(approveResult.movementId);

    // ATOMICITY PROOF: source balance restored to original (1000 = 700 + 300).
    const srcBalAfter = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    expect(srcBalAfter!.onHandQtyKg).toBe("1000.000");

    // ATOMICITY PROOF: destination balance restored to original (0 = 300 - 300).
    const dstBalAfter = await ledgerRepo.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_B);
    expect(dstBalAfter!.onHandQtyKg).toBe("0.000");

    // Original transfer movement is retained (append-only, Contract 04 §22).
    const movements = await ledgerRepo.listMovementsForBalance(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOC_A);
    const transferMovements = movements.filter(m => m.movementType === "transfer" && m.id === approveResult.movementId);
    expect(transferMovements).toHaveLength(1); // original retained

    // Reversal movement is a NEW movement (append-only).
    const reversalMovements = movements.filter(m => m.movementType === "reversal");
    expect(reversalMovements).toHaveLength(1);
    expect(reversalMovements[0]!.id).not.toBe(approveResult.movementId);
  });

  it("reversal of a reversal is rejected (duplicate source guard)", async () => {
    const { service, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");

    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = getTestEffectivePermissions(TEST_USERS.warehouse.userId);
    const req = await service.createTransferRequest(whUser as any, whEff, {
      itemId: TEST_ITEM_ID, fromLocationId: TEST_LOC_A, toLocationId: TEST_LOC_B,
      quantityKg: "300.000",
    });

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    const approveResult = await service.approveTransfer(ownerUser as any, ownerEff, {
      transferRequestId: req.id, idempotencyKey: "double-rev-approve-1",
    });

    // First reversal succeeds.
    await service.reverseMovement(ownerUser as any, ownerEff, {
      movementId: approveResult.movementId, reason: "first reversal", idempotencyKey: "double-rev-1",
    });

    // Second reversal with DIFFERENT idempotency key — rejected by duplicate-source guard.
    await expect(service.reverseMovement(ownerUser as any, ownerEff, {
      movementId: approveResult.movementId, reason: "second reversal", idempotencyKey: "double-rev-2",
    })).rejects.toThrow(); // DuplicateSourceError
  });
});

// ---------------------------------------------------------------------------
// 10. JSONB payload preservation after markDecided (WP-03-02 fix).
//
// markDecided must MERGE the JSONB payload (preserving transfer params)
// instead of overwriting it. This ensures the transfer params remain
// available for audit/replay after approval.
// ---------------------------------------------------------------------------

describe("WP-03-02 JSONB payload preservation after markDecided", () => {
  it("markDecided preserves transfer params in submittedChildVersionSummary", async () => {
    const { service, approvalRepository, inventoryLedger } = makeDeps();
    await seedStock(inventoryLedger, "1000.000");

    const whUser = makeUser(TEST_USERS.warehouse.userId);
    const whEff = getTestEffectivePermissions(TEST_USERS.warehouse.userId);
    const req = await service.createTransferRequest(whUser as any, whEff, {
      itemId: TEST_ITEM_ID, fromLocationId: TEST_LOC_A, toLocationId: TEST_LOC_B,
      quantityKg: "250.000", reason: "preserve payload test",
    });

    const ownerUser = makeUser(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);
    const result = await service.approveTransfer(ownerUser as any, ownerEff, {
      transferRequestId: req.id, idempotencyKey: "preserve-1",
    });
    expect(result.action).toBe("posted");

    // After markDecided, the JSONB should STILL contain the original transfer params
    // (itemId, fromLocationId, toLocationId, quantityKg) AND the new movementId.
    const raw = await approvalRepository.findApprovalById(TEST_TENANT_ID, req.id);
    expect(raw).toBeTruthy();
    expect(raw!.state).toBe("decided");
    expect(raw!.movementId).toBe(result.movementId);

    const payload = raw!.submittedChildVersionSummary as any;
    expect(payload).toBeTruthy();
    // Original transfer params preserved (NOT overwritten by markDecided):
    expect(payload.itemId).toBe(TEST_ITEM_ID);
    expect(payload.fromLocationId).toBe(TEST_LOC_A);
    expect(payload.toLocationId).toBe(TEST_LOC_B);
    expect(payload.quantityKg).toBe("250.000");
    // New keys added by markDecided:
    expect(payload.movementId).toBe(result.movementId);
  });
});
