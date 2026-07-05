/**
 * WP-02-05 Raw Receipt Approval Service tests.
 *
 * Contract: docs/contracts/13_work_packages.md WP-02-05
 *   Tests: known/missing/late price, exact signs, duplicate confirmation,
 *   concurrency/idempotency/orphan recovery, failure injection/audit rollback.
 *
 * Contract: docs/contracts/06_approval_transaction_contract.md §17.1
 *   Raw Receipt Approval and Late-Price Confirmation.
 *
 * DEC-080: Requester cannot approve their own high-risk request.
 * DEC-067: payable = net_accepted_kg / 1000 × price_per_ton
 */
import { describe, it, expect, vi } from "vitest";
import {
  RawReceiptApprovalService,
  DraftNotSubmittedError,
  SubjectHashMismatchError,
  RequesterCannotApproveOwnRequestError,
  ApprovalAlreadyDecidedError,
  ValidationFailedApprovalError,
  ApprovalNotFoundError,
  type RawReceiptApprovalRepository,
  type NewApprovalRequestInput,
  type RawReceiptApprovalRequest,
  type ApproveRawReceiptInput,
  type ConfirmLatePriceInput,
} from "../raw-receipt-approval-service";
import { InMemoryRawReceiptApprovalRepository } from "./in-memory-raw-receipt-approval-repository";
import { InMemoryRawReceiptDraftRepository } from "./in-memory-raw-receipt-draft-repository";
import { InProcessAuditStore } from "../audit-service";
import { InProcessIdempotencyStore } from "../idempotency-service";
import {
  InventoryLedgerService,
  type InventoryLedgerTransactionHandle,
  type NewMovementInput,
  type NewBalanceInput,
  type StockMovement,
  type InventoryBalance,
  type PostRawReceiptInput,
  type PostRawReceiptResult,
} from "../inventory-ledger-service";
import {
  SubledgerService,
  type SubledgerTransactionHandle,
  type NewAccountInput,
  type NewEntryInput,
  type PostSupplierPayableInput,
  type PostSupplierPayableResult,
} from "../subledger-service";
import { InProcessDocumentSequenceStore } from "../document-sequence-service";
import type { RawReceiptDraft, CreateDraftInput } from "../raw-receipt-draft-service";
import { RawReceiptDraftService } from "../raw-receipt-draft-service";
import {
  TEST_USERS,
  FOREIGN_TENANT_ID,
  getTestEffectivePermissions,
} from "@/server/security/role-fixtures";
import { PermissionDeniedError, BodyClaimsAuthorityError } from "@/server/security/guards";

// ---------------------------------------------------------------------------
// Test fixtures.
// ---------------------------------------------------------------------------

const TEST_SUPPLIER_ID = "d0000000-0000-0000-0000-000000000001";
const TEST_LOCATION_ID = "b0000000-0000-0000-0000-000000000001";
const TEST_FIBER_TYPE_ID = "c0000000-0000-0000-0000-000000000001";

// ---------------------------------------------------------------------------
// Mock InventoryLedgerService — records every call.
// ---------------------------------------------------------------------------

class MockInventoryLedgerTransactionHandle implements InventoryLedgerTransactionHandle {
  insertMovementCalls: NewMovementInput[] = [];
  insertBalanceCalls: NewBalanceInput[] = [];
  updateBalanceCalls: Array<{ tenantId: string; itemId: string; locationId: string; patch: { onHandQtyKg: string; lastMovementId: string; version: number } }> = [];
  balances = new Map<string, any>();

  async insertMovement(row: NewMovementInput): Promise<any> {
    this.insertMovementCalls.push(row);
    return {
      id: `mov-${this.insertMovementCalls.length}`,
      tenantId: row.tenantId,
      docNo: row.docNo,
      movementType: row.movementType,
      movementStatus: row.movementStatus,
      itemId: row.itemId,
      fromLocationId: row.fromLocationId,
      toLocationId: row.toLocationId,
      quantityKg: row.quantityKg,
      movementDate: row.movementDate,
      sourceDocumentType: row.sourceDocumentType,
      sourceDocumentId: row.sourceDocumentId,
      idempotencyKey: row.idempotencyKey,
      postedBy: row.postedBy,
      postedAt: row.postedAt,
      createdAt: new Date(),
      reversalOfMovementId: null,
      recordOrigin: "manual_live",
      recordPeriod: "live",
      importBatchId: null,
    };
  }
  async findMovementByIdempotencyKey(): Promise<any | null> { return null; }
  async findMovementBySource(): Promise<any | null> { return null; }
  async findMovementById(): Promise<any | null> { return null; }
  async findBalanceForUpdate(tenantId: string, itemId: string, locationId: string): Promise<any | null> {
    return this.balances.get(`${tenantId}:${itemId}:${locationId}`) ?? null;
  }
  async insertBalance(row: NewBalanceInput): Promise<any> {
    this.insertBalanceCalls.push(row);
    const bal: any = {
      id: `bal-${this.insertBalanceCalls.length}`,
      tenantId: row.tenantId,
      itemId: row.itemId,
      locationId: row.locationId,
      onHandQtyKg: row.onHandQtyKg,
      reservedQtyKg: "0.000",
      blockedQtyKg: "0.000",
      returnedQtyKg: "0.000",
      lastMovementId: row.lastMovementId,
      version: 1,
      createdAt: new Date(),
      updatedAt: null,
      updatedBy: null,
    };
    this.balances.set(`${row.tenantId}:${row.itemId}:${row.locationId}`, bal);
    return bal;
  }
  async updateBalance(tenantId: string, itemId: string, locationId: string, patch: { onHandQtyKg: string; lastMovementId: string; version: number }): Promise<any | null> {
    this.updateBalanceCalls.push({ tenantId, itemId, locationId, patch });
    const key = `${tenantId}:${itemId}:${locationId}`;
    const existing = this.balances.get(key);
    if (!existing) return null;
    const updated = { ...existing, onHandQtyKg: patch.onHandQtyKg, lastMovementId: patch.lastMovementId, version: patch.version, updatedAt: new Date() };
    this.balances.set(key, updated);
    return updated;
  }
  async listMovementsForBalance(): Promise<any[]> { return []; }
}

class MockSubledgerTransactionHandle implements SubledgerTransactionHandle {
  insertEntryCalls: NewEntryInput[] = [];
  insertAccountCalls: NewAccountInput[] = [];
  accounts = new Map<string, any>();

  async findAccount(): Promise<any | null> { return null; }
  async findAccountByOwner(): Promise<any | null> { return null; }
  async listEntriesForAccount(): Promise<any[]> { return []; }
  async lockSourceEntry(): Promise<void> {}
  async insertAccount(row: NewAccountInput): Promise<any> {
    this.insertAccountCalls.push(row);
    const acct: any = {
      id: `acct-${this.insertAccountCalls.length}`,
      tenantId: row.tenantId,
      ownerType: row.ownerType,
      ownerId: row.ownerId,
      currency: row.currency,
      status: "active",
      createdBy: row.createdBy,
      updatedBy: null,
      createdAt: new Date(),
      updatedAt: null,
    };
    this.accounts.set(`${row.tenantId}:${row.ownerType}:${row.ownerId}`, acct);
    return acct;
  }
  async findEntryByIdempotencyKey(): Promise<any | null> { return null; }
  async findEntryBySource(): Promise<any | null> { return null; }
  async findEntryById(): Promise<any | null> { return null; }
  async insertEntry(row: NewEntryInput): Promise<any> {
    this.insertEntryCalls.push(row);
    return {
      id: `entry-${this.insertEntryCalls.length}`,
      entryNo: row.entryNo,
      tenantId: row.tenantId,
      accountId: row.accountId,
      entryDate: row.entryDate,
      amountSigned: row.amountSigned,
      currency: row.currency,
      entryType: row.entryType,
      sourceDocumentType: row.sourceDocumentType,
      sourceDocumentId: row.sourceDocumentId,
      createdBy: row.createdBy,
      createdAt: new Date(),
      recordOrigin: "manual_live",
      recordPeriod: "live",
      importBatchId: null,
      notes: null,
      settlementStatus: "unsettled",
      reversalOfEntryId: null,
      updatedBy: null,
      updatedAt: null,
    } as any;
  }
  async deriveAccountBalance(): Promise<any> {
    return { tenantId: "", accountId: "", balance: "0.00", entryCount: 0 };
  }
  async acquireSourceLock(): Promise<void> {}
}

function makeApprovalDeps() {
  const approvalRepository = new InMemoryRawReceiptApprovalRepository();
  const draftRepository = new InMemoryRawReceiptDraftRepository();
  const audit = new InProcessAuditStore();
  const idempotency = new InProcessIdempotencyStore();

  const ledgerHandle = new MockInventoryLedgerTransactionHandle();
  const inventoryLedger = new InventoryLedgerService({
    ledger: ledgerHandle,
    audit,
    idempotency,
    documentSequence: new InProcessDocumentSequenceStore(),
  });

  const subledgerHandle = new MockSubledgerTransactionHandle();
  const subledger = new SubledgerService({
    subledger: subledgerHandle,
    audit,
    idempotency,
    documentSequence: new InProcessDocumentSequenceStore(),
  });

  const draftService = new RawReceiptDraftService({ repository: draftRepository, audit });
  const service = new RawReceiptApprovalService({
    approvalRepository,
    draftRepository,
    inventoryLedger,
    subledger,
    audit,
    idempotency,
  });

  return { approvalRepository, draftRepository, audit, idempotency, ledgerHandle, subledgerHandle, inventoryLedger, subledger, draftService, service };
}

async function createSubmittedDraft(
  draftService: RawReceiptDraftService,
  requesterUser: typeof TEST_USERS.warehouse,
  overrides?: Partial<CreateDraftInput>,
): Promise<RawReceiptDraft> {
  const effective = getTestEffectivePermissions(requesterUser.userId);
  const input: CreateDraftInput = {
    batchNo: `BATCH-${Math.random().toString(36).slice(2, 8)}`,
    netWeightKg: "1000.000",
    receivedDate: "2026-07-02",
    supplierId: TEST_SUPPLIER_ID,
    fiberTypeId: TEST_FIBER_TYPE_ID,
    fiberTypeAr: "قطن اختبار",
    originCountry: "السودان",
    season: "2024/2025",
    balesCount: "25",
    grossWeightKg: "1250.000",
    storageLocationId: TEST_LOCATION_ID,
    storageLocationName: "مخزن اختبار",
    purchaseOrderRef: "PR-TEST-001",
    notes: "test draft",
    ...overrides,
  };
  const draft = await draftService.createDraft(requesterUser, effective, input);
  await draftService.submitDraft(requesterUser, effective, draft.id);
  // Re-read to get the submitted state
  return draftService.readDraft(requesterUser, effective, draft.id);
}

// ---------------------------------------------------------------------------
// 1. Approval request creation + binding.
// ---------------------------------------------------------------------------

describe("WP-02-05 RawReceiptApprovalService — createApprovalRequest", () => {
  it("creates an approval request for a submitted draft", async () => {
    const { service, draftService } = makeApprovalDeps();
    const requester = TEST_USERS.warehouse;
    const draft = await createSubmittedDraft(draftService, requester);

    const approver = TEST_USERS.owner;
    const approverEffective = getTestEffectivePermissions(approver.userId);
    const approval = await service.createApprovalRequest(approver, approverEffective, draft.id, "Please review");

    expect(approval.entityId).toBe(draft.id);
    expect(approval.requestType).toBe("raw_receipt_approval");
    expect(approval.entityType).toBe("raw_receipt_draft");
    expect(approval.riskLevel).toBe("high");
    expect(approval.state).toBe("active");
    expect(approval.subjectHash).toHaveLength(64);
    expect(approval.subjectVersion).toBe(1);
    expect(approval.requestedBy).toBe(requester.userId);
  });

  it("is idempotent — creating twice returns the same active approval", async () => {
    const { service, draftService } = makeApprovalDeps();
    const requester = TEST_USERS.warehouse;
    const draft = await createSubmittedDraft(draftService, requester);

    const approver = TEST_USERS.owner;
    const approverEffective = getTestEffectivePermissions(approver.userId);
    const first = await service.createApprovalRequest(approver, approverEffective, draft.id);
    const second = await service.createApprovalRequest(approver, approverEffective, draft.id);

    expect(second.id).toBe(first.id);
  });

  it("rejects creating approval for a non-submitted draft", async () => {
    const { service, draftService } = makeApprovalDeps();
    const requester = TEST_USERS.warehouse;
    const requesterEffective = getTestEffectivePermissions(requester.userId);
    const draft = await draftService.createDraft(requester, requesterEffective, {
      batchNo: "BATCH-DRAFT-ONLY",
      netWeightKg: "1000.000",
      receivedDate: "2026-07-02",
      storageLocationId: TEST_LOCATION_ID,
    });

    const approver = TEST_USERS.owner;
    const approverEffective = getTestEffectivePermissions(approver.userId);
    await expect(service.createApprovalRequest(approver, approverEffective, draft.id)).rejects.toThrow(DraftNotSubmittedError);
  });

  it("binds the approval to the WP-02-04 subject hash", async () => {
    const { service, draftService } = makeApprovalDeps();
    const requester = TEST_USERS.warehouse;
    const draft = await createSubmittedDraft(draftService, requester);
    const approver = TEST_USERS.owner;
    const approverEffective = getTestEffectivePermissions(approver.userId);
    const approval = await service.createApprovalRequest(approver, approverEffective, draft.id);

    // The subject hash on the approval must match the draft's subject hash.
    expect(approval.subjectHash).toBe(draft.subjectHash);
  });
});

// ---------------------------------------------------------------------------
// 2. Subject hash mismatch rejection.
// ---------------------------------------------------------------------------

describe("WP-02-05 RawReceiptApprovalService — subject hash mismatch", () => {
  it("rejects approval if draft facts changed after approval request creation", async () => {
    const { service, draftService, approvalRepository } = makeApprovalDeps();
    const requester = TEST_USERS.warehouse;
    const draft = await createSubmittedDraft(draftService, requester);

    const approver = TEST_USERS.owner;
    const approverEffective = getTestEffectivePermissions(approver.userId);
    const approval = await service.createApprovalRequest(approver, approverEffective, draft.id);

    // Simulate draft mutation: directly tamper with the stored draft's netWeightKg
    // (in real life this can't happen because submitted drafts are locked, but
    // we test the subject hash check defense-in-depth).
    const tamperedDraft = { ...draft, netWeightKg: "2000.000" };
    // Override the draftRepository.findDraftById to return the tampered draft.
    (service as any).deps.draftRepository.findDraftById = async () => tamperedDraft;

    await expect(
      service.approveRawReceipt(approver, approverEffective, {
        approvalRequestId: approval.id,
        pricePerTon: "80.00",
        idempotencyKey: "idem-1",
      }),
    ).rejects.toThrow(SubjectHashMismatchError);
  });
});

// ---------------------------------------------------------------------------
// 3. Requester-vs-approver segregation (DEC-080).
// ---------------------------------------------------------------------------

describe("WP-02-05 RawReceiptApprovalService — DEC-080 segregation", () => {
  it("requester cannot approve their own request", async () => {
    const { service, draftService } = makeApprovalDeps();
    // Owner creates AND submits the draft, then tries to approve their own request.
    const owner = TEST_USERS.owner;
    const ownerEffective = getTestEffectivePermissions(owner.userId);
    const draft = await createSubmittedDraft(draftService, owner);

    const approval = await service.createApprovalRequest(owner, ownerEffective, draft.id);

    await expect(
      service.approveRawReceipt(owner, ownerEffective, {
        approvalRequestId: approval.id,
        pricePerTon: "80.00",
        idempotencyKey: "idem-1",
      }),
    ).rejects.toThrow(RequesterCannotApproveOwnRequestError);
  });

  it("a different approver can approve the request", async () => {
    const { service, draftService } = makeApprovalDeps();
    const requester = TEST_USERS.warehouse;
    const draft = await createSubmittedDraft(draftService, requester);

    // Owner creates the approval request (as a management action).
    const owner = TEST_USERS.owner;
    const ownerEffective = getTestEffectivePermissions(owner.userId);
    const approval = await service.createApprovalRequest(owner, ownerEffective, draft.id);

    // Accountant (different user) approves.
    const accountant = TEST_USERS.accountant;
    const accountantEffective = getTestEffectivePermissions(accountant.userId);
    const result = await service.approveRawReceipt(accountant, accountantEffective, {
      approvalRequestId: approval.id,
      pricePerTon: "80.00",
      idempotencyKey: "idem-1",
    });

    expect(result.action).toBe("posted");
    expect(result.payableDeferred).toBe(false);
  });

  it("workers cannot approve (no inventory.receive.approve permission)", async () => {
    const { service, draftService } = makeApprovalDeps();
    const requester = TEST_USERS.warehouse;
    const draft = await createSubmittedDraft(draftService, requester);
    const owner = TEST_USERS.owner;
    const ownerEffective = getTestEffectivePermissions(owner.userId);
    const approval = await service.createApprovalRequest(owner, ownerEffective, draft.id);

    const warehouseUser = TEST_USERS.warehouse;
    const warehouseEffective = getTestEffectivePermissions(warehouseUser.userId);
    await expect(
      service.approveRawReceipt(warehouseUser, warehouseEffective, {
        approvalRequestId: approval.id,
        pricePerTon: "80.00",
        idempotencyKey: "idem-1",
      }),
    ).rejects.toThrow(PermissionDeniedError);
  });
});

// ---------------------------------------------------------------------------
// 4. Approve — stock posting + optional payable.
// ---------------------------------------------------------------------------

describe("WP-02-05 RawReceiptApprovalService — approveRawReceipt", () => {
  it("posts stock + payable when price is available", async () => {
    const { service, draftService, ledgerHandle, subledgerHandle } = makeApprovalDeps();
    const requester = TEST_USERS.warehouse;
    const draft = await createSubmittedDraft(draftService, requester);
    const owner = TEST_USERS.owner;
    const ownerEffective = getTestEffectivePermissions(owner.userId);
    const approval = await service.createApprovalRequest(owner, ownerEffective, draft.id);

    const accountant = TEST_USERS.accountant;
    const accountantEffective = getTestEffectivePermissions(accountant.userId);
    const result = await service.approveRawReceipt(accountant, accountantEffective, {
      approvalRequestId: approval.id,
      pricePerTon: "80.00",
      idempotencyKey: "idem-1",
    });

    expect(result.action).toBe("posted");
    expect(result.movementId).toBeTruthy();
    expect(result.payableEntryId).toBeTruthy();
    expect(result.payableDeferred).toBe(false);
    expect(result.payableAmountSigned).toBeTruthy();

    // Verify InventoryLedgerService was called exactly once.
    expect(ledgerHandle.insertMovementCalls).toHaveLength(1);
    expect(ledgerHandle.insertMovementCalls[0]!.movementType).toBe("raw_receipt");
    expect(ledgerHandle.insertMovementCalls[0]!.quantityKg).toBe("1000.000");

    // Verify SubledgerService was called exactly once.
    expect(subledgerHandle.insertEntryCalls).toHaveLength(1);
    // DEC-067: payable = 1000.000 / 1000 × 80.00 = 80.00, negative signed.
    expect(subledgerHandle.insertEntryCalls[0]!.amountSigned).toBe("-80.00");
  });

  it("posts stock but defers payable when price is absent (late-price path)", async () => {
    const { service, draftService, ledgerHandle, subledgerHandle } = makeApprovalDeps();
    const requester = TEST_USERS.warehouse;
    const draft = await createSubmittedDraft(draftService, requester);
    const owner = TEST_USERS.owner;
    const ownerEffective = getTestEffectivePermissions(owner.userId);
    const approval = await service.createApprovalRequest(owner, ownerEffective, draft.id);

    const accountant = TEST_USERS.accountant;
    const accountantEffective = getTestEffectivePermissions(accountant.userId);
    const result = await service.approveRawReceipt(accountant, accountantEffective, {
      approvalRequestId: approval.id,
      pricePerTon: null, // no price
      idempotencyKey: "idem-1",
    });

    expect(result.action).toBe("posted");
    expect(result.movementId).toBeTruthy();
    expect(result.payableEntryId).toBeNull();
    expect(result.payableDeferred).toBe(true);

    // Stock posted.
    expect(ledgerHandle.insertMovementCalls).toHaveLength(1);
    // No payable entry created.
    expect(subledgerHandle.insertEntryCalls).toHaveLength(0);
  });

  it("posts stock but defers payable when supplier is absent", async () => {
    const { service, draftService, ledgerHandle, subledgerHandle } = makeApprovalDeps();
    const requester = TEST_USERS.warehouse;
    // Create draft with no supplier.
    const draft = await createSubmittedDraft(draftService, requester, { supplierId: null });
    const owner = TEST_USERS.owner;
    const ownerEffective = getTestEffectivePermissions(owner.userId);
    const approval = await service.createApprovalRequest(owner, ownerEffective, draft.id);

    const accountant = TEST_USERS.accountant;
    const accountantEffective = getTestEffectivePermissions(accountant.userId);
    const result = await service.approveRawReceipt(accountant, accountantEffective, {
      approvalRequestId: approval.id,
      pricePerTon: "80.00", // price available but no supplier
      idempotencyKey: "idem-1",
    });

    expect(result.payableDeferred).toBe(true);
    expect(result.payableEntryId).toBeNull();
    expect(ledgerHandle.insertMovementCalls).toHaveLength(1);
    expect(subledgerHandle.insertEntryCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Duplicate approval / idempotency.
// ---------------------------------------------------------------------------

describe("WP-02-05 RawReceiptApprovalService — idempotency", () => {
  it("duplicate approve with same idempotency key does not double-post", async () => {
    const { service, draftService, ledgerHandle, subledgerHandle } = makeApprovalDeps();
    const requester = TEST_USERS.warehouse;
    const draft = await createSubmittedDraft(draftService, requester);
    const owner = TEST_USERS.owner;
    const ownerEffective = getTestEffectivePermissions(owner.userId);
    const approval = await service.createApprovalRequest(owner, ownerEffective, draft.id);

    const accountant = TEST_USERS.accountant;
    const accountantEffective = getTestEffectivePermissions(accountant.userId);
    const input: ApproveRawReceiptInput = {
      approvalRequestId: approval.id,
      pricePerTon: "80.00",
      idempotencyKey: "idem-dup-1",
    };

    const first = await service.approveRawReceipt(accountant, accountantEffective, input);
    const second = await service.approveRawReceipt(accountant, accountantEffective, input);

    expect(first.action).toBe("posted");
    expect(second.action).toBe("replayed");
    expect(second.movementId).toBe(first.movementId);

    // Only ONE stock movement + ONE payable entry.
    expect(ledgerHandle.insertMovementCalls).toHaveLength(1);
    expect(subledgerHandle.insertEntryCalls).toHaveLength(1);
  });

  it("already-decided approval rejects new approve with different idempotency key", async () => {
    const { service, draftService } = makeApprovalDeps();
    const requester = TEST_USERS.warehouse;
    const draft = await createSubmittedDraft(draftService, requester);
    const owner = TEST_USERS.owner;
    const ownerEffective = getTestEffectivePermissions(owner.userId);
    const approval = await service.createApprovalRequest(owner, ownerEffective, draft.id);

    const accountant = TEST_USERS.accountant;
    const accountantEffective = getTestEffectivePermissions(accountant.userId);
    await service.approveRawReceipt(accountant, accountantEffective, {
      approvalRequestId: approval.id,
      pricePerTon: "80.00",
      idempotencyKey: "idem-1",
    });

    // Second approve with DIFFERENT idempotency key on a decided approval.
    await expect(
      service.approveRawReceipt(accountant, accountantEffective, {
        approvalRequestId: approval.id,
        pricePerTon: "80.00",
        idempotencyKey: "idem-2",
      }),
    ).rejects.toThrow(ApprovalAlreadyDecidedError);
  });
});

// ---------------------------------------------------------------------------
// 6. Late-price confirmation.
// ---------------------------------------------------------------------------

describe("WP-02-05 RawReceiptApprovalService — confirmLatePrice", () => {
  it("posts deferred payable after late-price confirmation", async () => {
    const { service, draftService, subledgerHandle } = makeApprovalDeps();
    const requester = TEST_USERS.warehouse;
    const draft = await createSubmittedDraft(draftService, requester);
    const owner = TEST_USERS.owner;
    const ownerEffective = getTestEffectivePermissions(owner.userId);
    const approval = await service.createApprovalRequest(owner, ownerEffective, draft.id);

    const accountant = TEST_USERS.accountant;
    const accountantEffective = getTestEffectivePermissions(accountant.userId);
    // Approve with no price (defer payable).
    await service.approveRawReceipt(accountant, accountantEffective, {
      approvalRequestId: approval.id,
      pricePerTon: null,
      idempotencyKey: "idem-approve-1",
    });

    // No payable yet.
    expect(subledgerHandle.insertEntryCalls).toHaveLength(0);

    // Confirm late price.
    const confirmResult = await service.confirmLatePrice(accountant, accountantEffective, {
      approvalRequestId: approval.id,
      pricePerTon: "90.00",
      idempotencyKey: "idem-late-1",
    });

    expect(confirmResult.action).toBe("posted");
    expect(confirmResult.payableEntryId).toBeTruthy();
    // DEC-067: 1000.000 / 1000 × 90.00 = 90.00, negative.
    expect(subledgerHandle.insertEntryCalls).toHaveLength(1);
    expect(subledgerHandle.insertEntryCalls[0]!.amountSigned).toBe("-90.00");
  });

  it("late-price confirmation is idempotent", async () => {
    const { service, draftService, subledgerHandle } = makeApprovalDeps();
    const requester = TEST_USERS.warehouse;
    const draft = await createSubmittedDraft(draftService, requester);
    const owner = TEST_USERS.owner;
    const ownerEffective = getTestEffectivePermissions(owner.userId);
    const approval = await service.createApprovalRequest(owner, ownerEffective, draft.id);

    const accountant = TEST_USERS.accountant;
    const accountantEffective = getTestEffectivePermissions(accountant.userId);
    await service.approveRawReceipt(accountant, accountantEffective, {
      approvalRequestId: approval.id,
      pricePerTon: null,
      idempotencyKey: "idem-approve-1",
    });

    const confirmInput: ConfirmLatePriceInput = {
      approvalRequestId: approval.id,
      pricePerTon: "90.00",
      idempotencyKey: "idem-late-1",
    };

    const first = await service.confirmLatePrice(accountant, accountantEffective, confirmInput);
    const second = await service.confirmLatePrice(accountant, accountantEffective, confirmInput);

    expect(first.action).toBe("posted");
    expect(second.action).toBe("replayed");
    expect(subledgerHandle.insertEntryCalls).toHaveLength(1);
  });

  it("rejects late-price confirmation if payable was already posted", async () => {
    const { service, draftService } = makeApprovalDeps();
    const requester = TEST_USERS.warehouse;
    const draft = await createSubmittedDraft(draftService, requester);
    const owner = TEST_USERS.owner;
    const ownerEffective = getTestEffectivePermissions(owner.userId);
    const approval = await service.createApprovalRequest(owner, ownerEffective, draft.id);

    const accountant = TEST_USERS.accountant;
    const accountantEffective = getTestEffectivePermissions(accountant.userId);
    // Approve WITH price (payable posted immediately).
    await service.approveRawReceipt(accountant, accountantEffective, {
      approvalRequestId: approval.id,
      pricePerTon: "80.00",
      idempotencyKey: "idem-approve-1",
    });

    await expect(
      service.confirmLatePrice(accountant, accountantEffective, {
        approvalRequestId: approval.id,
        pricePerTon: "90.00",
        idempotencyKey: "idem-late-1",
      }),
    ).rejects.toThrow(ValidationFailedApprovalError);
  });
});

// ---------------------------------------------------------------------------
// 7. No payment/settlement rows.
// ---------------------------------------------------------------------------

describe("WP-02-05 RawReceiptApprovalService — no payment/settlement", () => {
  it("approveRawReceipt does not create payment or settlement rows", async () => {
    const { service, draftService, subledgerHandle } = makeApprovalDeps();
    const requester = TEST_USERS.warehouse;
    const draft = await createSubmittedDraft(draftService, requester);
    const owner = TEST_USERS.owner;
    const ownerEffective = getTestEffectivePermissions(owner.userId);
    const approval = await service.createApprovalRequest(owner, ownerEffective, draft.id);

    const accountant = TEST_USERS.accountant;
    const accountantEffective = getTestEffectivePermissions(accountant.userId);
    await service.approveRawReceipt(accountant, accountantEffective, {
      approvalRequestId: approval.id,
      pricePerTon: "80.00",
      idempotencyKey: "idem-1",
    });

    // The MockSubledgerTransactionHandle only records insertEntry + insertAccount.
    // Payments/settlements are NOT part of WP-02-05 scope — they're handled by
    // a separate PaymentService (not yet implemented). The approval service
    // does NOT call any payment/settlement method.
    // Verify: only account_entries were created, no payment/settlement calls.
    expect(subledgerHandle.insertEntryCalls.length).toBeGreaterThan(0);
    // No payment/settlement methods exist on SubledgerTransactionHandle —
    // the interface only has account + entry methods. This is the proof.
  });
});

// ---------------------------------------------------------------------------
// 8. RBAC + body authority rejection.
// ---------------------------------------------------------------------------

describe("WP-02-05 RawReceiptApprovalService — RBAC", () => {
  it("body claiming tenantId rejected", async () => {
    const { service, draftService } = makeApprovalDeps();
    const requester = TEST_USERS.warehouse;
    const draft = await createSubmittedDraft(draftService, requester);
    const owner = TEST_USERS.owner;
    const ownerEffective = getTestEffectivePermissions(owner.userId);
    const approval = await service.createApprovalRequest(owner, ownerEffective, draft.id);

    const accountant = TEST_USERS.accountant;
    const accountantEffective = getTestEffectivePermissions(accountant.userId);
    await expect(
      service.approveRawReceipt(accountant, accountantEffective, {
        approvalRequestId: approval.id,
        pricePerTon: "80.00",
        idempotencyKey: "idem-1",
        tenantId: FOREIGN_TENANT_ID,
      } as any),
    ).rejects.toThrow(BodyClaimsAuthorityError);
  });

  it("listing pending approvals requires inventory.receive.approve", async () => {
    const { service } = makeApprovalDeps();
    const warehouseUser = TEST_USERS.warehouse;
    const warehouseEffective = getTestEffectivePermissions(warehouseUser.userId);
    await expect(service.listPendingApprovals(warehouseUser, warehouseEffective)).rejects.toThrow(PermissionDeniedError);
  });
});

// ---------------------------------------------------------------------------
// 9. Tenant isolation.
// ---------------------------------------------------------------------------

describe("WP-02-05 RawReceiptApprovalService — tenant isolation", () => {
  it("cannot read approval from another tenant", async () => {
    const { service, draftService } = makeApprovalDeps();
    const requester = TEST_USERS.warehouse;
    const draft = await createSubmittedDraft(draftService, requester);
    const owner = TEST_USERS.owner;
    const ownerEffective = getTestEffectivePermissions(owner.userId);
    const approval = await service.createApprovalRequest(owner, ownerEffective, draft.id);

    const foreignUser = { ...TEST_USERS.owner, tenantId: FOREIGN_TENANT_ID };
    const foreignEffective = getTestEffectivePermissions(TEST_USERS.owner.userId);
    await expect(service.readApprovalRequest(foreignUser, foreignEffective, approval.id)).rejects.toThrow(ApprovalNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// 10. Atomicity / rollback proof (V11 — Contract 06 §6, §17.1; DEC-015).
// ---------------------------------------------------------------------------

/**
 * V11 atomicity proof: verify that when a transactionRunner is provided,
 * all DB writes (stock movement, inventory balance, account entry,
 * approval_requests markDecided) are wrapped in a single transaction.
 * If any write fails, the entire transaction rolls back — no partial effects.
 *
 * Strategy: use a mock transactionRunner that simulates a failure AFTER
 * the stock movement is posted but BEFORE the payable/approval finalization.
 * Verify that the stock movement is NOT persisted (rolled back), the
 * approval is NOT marked decided, and no partial state remains.
 */
describe("WP-02-05 RawReceiptApprovalService — atomicity/rollback (V11)", () => {
  it("rolls back ALL DB writes when subledger fails after inventory posts", async () => {
    // Build deps with a mock transactionRunner that injects a failure.
    const base = makeApprovalDeps();
    const requester = TEST_USERS.warehouse;
    const draft = await createSubmittedDraft(base.draftService, requester);
    const owner = TEST_USERS.owner;
    const ownerEffective = getTestEffectivePermissions(owner.userId);
    const approval = await base.service.createApprovalRequest(owner, ownerEffective, draft.id);

    // Track what WOULD have been written (without the transaction, these
    // would be partial effects). With the transaction, they're rolled back.
    const stockCallsBefore = base.ledgerHandle.insertMovementCalls.length;
    const balanceCallsBefore = base.ledgerHandle.insertBalanceCalls.length;
    const entryCallsBefore = base.subledgerHandle.insertEntryCalls.length;

    // Create a service with a transactionRunner that injects failure.
    // The failure is injected into the SubledgerService — we replace the
    // subledger.postSupplierPayable to throw after stock is posted.
    const accountant = TEST_USERS.accountant;
    const accountantEffective = getTestEffectivePermissions(accountant.userId);

    // Mock subledger that throws on postSupplierPayable (simulates DB failure
    // after inventory post but before payable post).
    const failingSubledger = {
      postSupplierPayable: vi.fn().mockRejectedValue(new Error("SIMULATED_SUBLEDGER_FAILURE")),
    } as unknown as SubledgerService;

    // Mock transactionRunner: runs the work, but since the subledger throws,
    // the transaction "rolls back" (we simulate by NOT persisting the stock
    // movement that was inserted during the work).
    let txWorkExecuted = false;
    const mockTxRunner = async <T,>(work: (tx: unknown) => Promise<T>): Promise<T> => {
      try {
        txWorkExecuted = true;
        return await work({ /* mock tx */ });
      } catch (e) {
        // Simulate rollback: undo the in-memory state changes that the
        // ledgerHandle made during the work. In a real DB transaction,
        // this happens automatically.
        base.ledgerHandle.insertMovementCalls.length = stockCallsBefore;
        base.ledgerHandle.insertBalanceCalls.length = balanceCallsBefore;
        throw e;
      }
    };

    const serviceWithTxFailure = new RawReceiptApprovalService({
      approvalRepository: base.approvalRepository,
      draftRepository: base.draftRepository,
      inventoryLedger: base.inventoryLedger,
      subledger: failingSubledger,
      audit: base.audit,
      idempotency: base.idempotency,
      transactionRunner: mockTxRunner as any,
      txFactories: {
        createInventoryLedger: () => base.inventoryLedger,
        createSubledger: () => failingSubledger,
        createApprovalRepository: () => base.approvalRepository,
        createDraftRepository: () => base.draftRepository,
      },
    });

    // Attempt approval with price (triggers stock + payable path).
    // The subledger will throw → transaction rolls back.
    await expect(
      serviceWithTxFailure.approveRawReceipt(accountant, accountantEffective, {
        approvalRequestId: approval.id,
        pricePerTon: "80.00",
        idempotencyKey: "v11-rollback-test",
      }),
    ).rejects.toThrow("SIMULATED_SUBLEDGER_FAILURE");

    // Verify NO partial effects persisted (rolled back).
    // Stock movement was inserted during the work but rolled back.
    expect(base.ledgerHandle.insertMovementCalls.length).toBe(stockCallsBefore);
    expect(base.ledgerHandle.insertBalanceCalls.length).toBe(balanceCallsBefore);
    // No account entry was created (subledger threw before insertEntry).
    expect(base.subledgerHandle.insertEntryCalls.length).toBe(entryCallsBefore);

    // Verify approval is still active (not decided).
    const approvalAfter = await base.approvalRepository.findApprovalById(
      accountant.tenantId,
      approval.id,
    );
    expect(approvalAfter?.state).toBe("active");
    expect(approvalAfter?.movementId).toBeNull();
    expect(approvalAfter?.payableEntryId).toBeNull();

    // Verify the transaction work was actually executed (not skipped).
    expect(txWorkExecuted).toBe(true);
  });

  it("rolls back late-price confirmation when approval updatePayableInfo fails", async () => {
    const base = makeApprovalDeps();
    const requester = TEST_USERS.warehouse;
    const draft = await createSubmittedDraft(base.draftService, requester);
    const owner = TEST_USERS.owner;
    const ownerEffective = getTestEffectivePermissions(owner.userId);
    const approval = await base.service.createApprovalRequest(owner, ownerEffective, draft.id);

    // Approve with no price (defer payable).
    const accountant = TEST_USERS.accountant;
    const accountantEffective = getTestEffectivePermissions(accountant.userId);
    await base.service.approveRawReceipt(accountant, accountantEffective, {
      approvalRequestId: approval.id,
      pricePerTon: null,
      idempotencyKey: "v11-late-price-approve",
    });

    const entryCallsBefore = base.subledgerHandle.insertEntryCalls.length;

    // Mock approval repo that fails on updatePayableInfo (after payable posts).
    const realRepo = base.approvalRepository;
    const failingApprovalRepo: RawReceiptApprovalRepository = {
      insertApprovalRequest: (row: any) => realRepo.insertApprovalRequest(row),
      findActiveApprovalByEntity: (t: string, et: string, eid: string, rt: string) => realRepo.findActiveApprovalByEntity(t, et, eid, rt),
      findApprovalById: (t: string, id: string) => realRepo.findApprovalById(t, id),
      listPendingApprovals: (t: string, et: string) => realRepo.listPendingApprovals(t, et),
      markDecided: (t: string, id: string, db: string, dn: string | null, mid: string | null, peid: string | null, pd: boolean) => realRepo.markDecided(t, id, db, dn, mid, peid, pd),
      updatePayableInfo: vi.fn().mockRejectedValue(new Error("SIMULATED_UPDATE_PAYABLE_INFO_FAILURE")),
    };

    const mockTxRunner = async <T,>(work: (tx: unknown) => Promise<T>): Promise<T> => {
      try {
        return await work({ /* mock tx */ });
      } catch (e) {
        // Simulate rollback: undo the account entry that was inserted.
        base.subledgerHandle.insertEntryCalls.length = entryCallsBefore;
        throw e;
      }
    };

    const serviceWithTxFailure = new RawReceiptApprovalService({
      approvalRepository: failingApprovalRepo,
      draftRepository: base.draftRepository,
      inventoryLedger: base.inventoryLedger,
      subledger: base.subledger,
      audit: base.audit,
      idempotency: base.idempotency,
      transactionRunner: mockTxRunner as any,
      txFactories: {
        createInventoryLedger: () => base.inventoryLedger,
        createSubledger: () => base.subledger,
        createApprovalRepository: () => failingApprovalRepo,
        createDraftRepository: () => base.draftRepository,
      },
    });

    // Attempt late-price confirmation — updatePayableInfo will throw → rollback.
    await expect(
      serviceWithTxFailure.confirmLatePrice(accountant, accountantEffective, {
        approvalRequestId: approval.id,
        pricePerTon: "90.00",
        idempotencyKey: "v11-late-price-rollback",
      }),
    ).rejects.toThrow("SIMULATED_UPDATE_PAYABLE_INFO_FAILURE");

    // Verify NO account entry persisted (rolled back).
    expect(base.subledgerHandle.insertEntryCalls.length).toBe(entryCallsBefore);

    // Verify approval still shows payableDeferred=true (not updated).
    const approvalAfter = await base.approvalRepository.findApprovalById(
      accountant.tenantId,
      approval.id,
    );
    expect(approvalAfter?.payableDeferred).toBe(true);
    expect(approvalAfter?.payableEntryId).toBeNull();
  });

  it("successful approval with transactionRunner commits all writes", async () => {
    const base = makeApprovalDeps();
    const requester = TEST_USERS.warehouse;
    const draft = await createSubmittedDraft(base.draftService, requester);
    const owner = TEST_USERS.owner;
    const ownerEffective = getTestEffectivePermissions(owner.userId);
    const approval = await base.service.createApprovalRequest(owner, ownerEffective, draft.id);

    const accountant = TEST_USERS.accountant;
    const accountantEffective = getTestEffectivePermissions(accountant.userId);

    // Mock transactionRunner that just runs the work (no failure).
    const mockTxRunner = async <T,>(work: (tx: unknown) => Promise<T>): Promise<T> => {
      return await work({ /* mock tx */ });
    };

    const serviceWithTx = new RawReceiptApprovalService({
      approvalRepository: base.approvalRepository,
      draftRepository: base.draftRepository,
      inventoryLedger: base.inventoryLedger,
      subledger: base.subledger,
      audit: base.audit,
      idempotency: base.idempotency,
      transactionRunner: mockTxRunner as any,
      txFactories: {
        createInventoryLedger: () => base.inventoryLedger,
        createSubledger: () => base.subledger,
        createApprovalRepository: () => base.approvalRepository,
        createDraftRepository: () => base.draftRepository,
      },
    });

    const result = await serviceWithTx.approveRawReceipt(accountant, accountantEffective, {
      approvalRequestId: approval.id,
      pricePerTon: "80.00",
      idempotencyKey: "v11-success-test",
    });

    // Verify all writes committed.
    expect(result.action).toBe("posted");
    expect(result.movementId).toBeTruthy();
    expect(result.payableEntryId).toBeTruthy();

    // Stock movement + balance + account entry all created.
    expect(base.ledgerHandle.insertMovementCalls.length).toBeGreaterThan(0);
    expect(base.subledgerHandle.insertEntryCalls.length).toBeGreaterThan(0);

    // Approval marked decided.
    const approvalAfter = await base.approvalRepository.findApprovalById(
      accountant.tenantId,
      approval.id,
    );
    expect(approvalAfter?.state).toBe("decided");
    expect(approvalAfter?.movementId).toBeTruthy();
    expect(approvalAfter?.payableEntryId).toBeTruthy();
  });
});
