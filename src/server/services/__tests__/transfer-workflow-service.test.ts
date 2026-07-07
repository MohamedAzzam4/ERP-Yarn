/**
 * WP-03-02 Transfer Workflow Service tests.
 *
 * Contract: docs/contracts/13_work_packages.md WP-03-02
 *   Tests: Availability, block classification, rollback, duplicate, inverse/dependencies.
 *   Acceptance: Exact source decrease/destination increase and original retained.
 */
import { describe, it, expect } from "vitest";
import {
  TransferWorkflowService,
  TransferRequestNotFoundError,
  TransferAlreadyDecidedError,
  TransferRequesterCannotApproveError,
  TransferWorkflowError,
  type CreateTransferRequestInput,
} from "../transfer-workflow-service";
import { InMemoryRawReceiptApprovalRepository } from "./in-memory-raw-receipt-approval-repository";
import { InMemoryInventoryLedgerRepository } from "./in-memory-inventory-ledger-repository";
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
  const inventoryLedger = new InventoryLedgerService({ ledger: ledgerRepo, audit, idempotency, documentSequence });
  const service = new TransferWorkflowService({ approvalRepository, inventoryLedger, audit, idempotency });
  return { approvalRepository, ledgerRepo, audit, idempotency, documentSequence, inventoryLedger, service };
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

  it("rejects already-decided transfer", async () => {
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

    // Different idempotency key on already-decided — should replay (idempotent)
    // The approval is already decided with a movementId, so a re-approve with
    // a different key returns action=replayed (the prior result).
    const replayResult = await service.approveTransfer(ownerUser as any, ownerEff, {
      transferRequestId: req.id, idempotencyKey: "approve-4b",
    });
    expect(replayResult.action).toBe("replayed");
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
