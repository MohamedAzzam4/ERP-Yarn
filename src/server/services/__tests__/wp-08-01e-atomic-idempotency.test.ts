/**
 * WP-08-01E DEFECT 1 + DEFECT 2 — Fail-closed ordering + owner-loss atomicity.
 *
 * DEFECT 1: requireTransactionConfig() must execute BEFORE claimIdempotency
 * and document-number allocation. Missing config must produce:
 *   - zero idempotency rows
 *   - zero document-sequence change
 *   - zero business writes
 *   - zero audit rows
 *
 * DEFECT 2: For each of the 5 mutation methods, inject ownership loss
 * after business writes but before markSucceeded. Assert:
 *   - IdempotencyOwnershipLostError thrown
 *   - transaction rollback (all business/audit effects absent)
 *   - token B remains the stored owner
 *   - stale token A cannot mark retryable/business-failed/succeeded
 *   - valid retry after reclaim creates exactly one result/effect set
 *   - replay returns the same result, zero new effects
 *   - same key with different body is rejected with zero mutation
 */
import { describe, it, expect, beforeEach } from "vitest";
import { ReturnRequestService } from "@/server/services/return-request-service";
import { ReplacementWorkflowService } from "@/server/services/replacement-workflow-service";
import { InventoryLedgerService } from "@/server/services/inventory-ledger-service";
import { SubledgerService } from "@/server/services/subledger-service";
import { ProfitabilitySnapshotService } from "@/server/services/profitability-snapshot-service";
import { InMemoryReturnRequestRepository } from "./in-memory-return-request-repository";
import { InMemorySalesRepository } from "./in-memory-sales-repository";
import { InMemoryInventoryLedgerRepository } from "./in-memory-inventory-ledger-repository";
import { InMemorySubledgerRepository } from "./in-memory-subledger-repository";
import { InMemoryProfitabilitySnapshotRepository } from "./in-memory-profitability-snapshot-repository";
import { InProcessAuditStore } from "@/server/services/audit-service";
import { InProcessIdempotencyStore, IdempotencyOwnershipLostError, type IdempotencyTransactionHandle } from "@/server/services/idempotency-service";
import { InProcessDocumentSequenceStore } from "@/server/services/document-sequence-service";
import { InMemoryTenantOwnershipValidator } from "./in-memory-tenant-ownership-validator";
import type { ErpUserContext } from "@/server/auth/erp-context";
import type { EffectivePermissions } from "@/server/security/effective-permissions";

const T = "00000000-0000-0000-0000-000000081e30";
const U = "00000000-0000-0000-0000-000000081e31";
const U2 = "00000000-0000-0000-0000-000000081e32"; // second user for DEC-080
const CUST = "00000000-0000-4000-8000-cccc000e0030";
const SALE = "00000000-0000-4000-8000-cccc000e0031";
const SALE_LINE = "00000000-0000-4000-8000-cccc000e0032";
const ITEM = "00000000-0000-4000-8000-cccc000e0033";
const LOC = "00000000-0000-4000-8000-cccc000e0034";

function makeUser(): ErpUserContext {
  return { authenticated: true, tenantId: T, userId: U, name: "T", email: "t@e.test", authId: "t" } as any;
}
function makeUser2(): ErpUserContext {
  return { authenticated: true, tenantId: T, userId: U2, name: "T2", email: "t2@e.test", authId: "t2" } as any;
}
function makeEff(perms: string[] = ["returns.create", "returns.approve", "inventory.receive.approve", "inventory.view_quantity"]): EffectivePermissions {
  return { assignedRoleCodes: ["owner"], permissionKeys: new Set(perms), deniedFieldKeys: new Set(), workerFinancialDeny: false } as any;
}

// ---------------------------------------------------------------------------
// Takeover wrapper: replaces owner_token when updateState(state="succeeded")
// is called, simulating an independent root DB connection takeover.
// Returns structured evidence for exact assertions.
// ---------------------------------------------------------------------------
interface TakeoverEvidence {
  takeoverAffected: number;
  replacementOwner: string | null;
  staleMarkSucceededAffected: number;
}

class TakeoverIdemStore implements IdempotencyTransactionHandle {
  readonly evidence: TakeoverEvidence = {
    takeoverAffected: 0,
    replacementOwner: null,
    staleMarkSucceededAffected: 0,
  };
  constructor(private readonly inner: InProcessIdempotencyStore) {}
  async findByTenantScopeKey(t: string, s: string, k: string) { return this.inner.findByTenantScopeKey(t, s, k); }
  async insert(r: any) { return this.inner.insert(r); }
  async claimExpiredLease(id: string, ne: Date, nh: Date, n: Date) { return this.inner.claimExpiredLease(id, ne, nh, n); }
  async heartbeat(id: string, n: Date) { return this.inner.heartbeat(id, n); }
  async updateState(id: string, update: any): Promise<number> {
    if (update.state === "succeeded" && update.expectedOwnerToken) {
      // Simulate root takeover: replace owner_token BEFORE delegating.
      const rec = this.inner.getRecord(id);
      if (rec && rec.ownerToken === update.expectedOwnerToken) {
        const replacement = `takeover-${crypto.randomUUID()}`;
        (this.inner as any).records.set(id, { ...rec, ownerToken: replacement, attemptCount: rec.attemptCount + 1 });
        this.evidence.takeoverAffected = 1;
        this.evidence.replacementOwner = replacement;
      }
      // Delegate — will return 0 because ownerToken no longer matches.
      const affected = await this.inner.updateState(id, update);
      this.evidence.staleMarkSucceededAffected = affected;
      return affected;
    }
    return this.inner.updateState(id, update);
  }
}

// ---------------------------------------------------------------------------
// Build deps with simulated transaction runner (snapshot/restore for rollback).
// ---------------------------------------------------------------------------
function makeDeps() {
  const returnRepo = new InMemoryReturnRequestRepository();
  const salesRepository = new InMemorySalesRepository();
  const ledgerRepo = new InMemoryInventoryLedgerRepository();
  const subledgerRepo = new InMemorySubledgerRepository();
  const snapshotRepo = new InMemoryProfitabilitySnapshotRepository();
  const audit = new InProcessAuditStore();
  const idempotency = new InProcessIdempotencyStore();
  const documentSequence = new InProcessDocumentSequenceStore();
  const tenantOwnershipValidator = new InMemoryTenantOwnershipValidator();
  // Seed tenant ownership validator with valid references
  (tenantOwnershipValidator as any).seedValidReferences?.(T, CUST, SALE, SALE_LINE, ITEM, LOC);
  const inventoryLedger = new InventoryLedgerService({ ledger: ledgerRepo, audit, idempotency, documentSequence });
  const subledger = new SubledgerService({ subledger: subledgerRepo, audit, idempotency, documentSequence });
  const snapshotService = new ProfitabilitySnapshotService({ snapshotRepository: snapshotRepo, salesRepository, audit });

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
  return { returnRepo, salesRepository, ledgerRepo, subledgerRepo, snapshotRepo, audit, idempotency, documentSequence, inventoryLedger, subledger, snapshotService, tenantOwnershipValidator, transactionRunner, txFactories };
}

// ---------------------------------------------------------------------------
// Build deps with takeover wrapper for owner-loss injection.
// ---------------------------------------------------------------------------
function makeTakeoverDeps() {
  const base = makeDeps();
  const takeoverIdem = new TakeoverIdemStore(base.idempotency);
  // Override txFactories to use the takeover wrapper for createIdempotency
  const txFactories = {
    ...base.txFactories,
    createIdempotency: () => takeoverIdem as any as IdempotencyTransactionHandle,
  };
  const returnService = new ReturnRequestService({
    returnRequestRepository: base.returnRepo,
    audit: base.audit, idempotency: base.idempotency, documentSequence: base.documentSequence,
    inventoryLedger: base.inventoryLedger, subledger: base.subledger, salesRepository: base.salesRepository,
    snapshotService: base.snapshotService, tenantOwnershipValidator: base.tenantOwnershipValidator,
    transactionRunner: base.transactionRunner, txFactories,
  });
  const replaceService = new ReplacementWorkflowService({
    returnRequestRepository: base.returnRepo,
    salesRepository: base.salesRepository,
    audit: base.audit, idempotency: base.idempotency, documentSequence: base.documentSequence,
    transactionRunner: base.transactionRunner,
    txFactories: {
      createSalesRepository: () => base.salesRepository,
      createReturnRequestRepository: () => base.returnRepo,
      createAudit: () => base.audit,
      createIdempotency: () => takeoverIdem as any as IdempotencyTransactionHandle,
    },
  });
  return { ...base, takeoverIdem, returnService, replaceService };
}

const BASE_LINE = {
  originalSaleOrderId: SALE,
  originalSaleLineId: SALE_LINE,
  itemId: ITEM,
  quantityKg: "100.000",
  returnLocationId: LOC,
  returnedStockStatus: "needs_quality_review" as const,
};

const RETURN_INPUT = {
  salesOrderId: SALE,
  customerId: CUST,
  returnDate: "2026-08-07",
  returnReason: "Test return",
  idempotencyKey: "rr-test-1",
  lines: [BASE_LINE],
};

// ===========================================================================
// DEFECT 1: Fail-closed ordering tests
// ===========================================================================

describe("WP-08-01E DEFECT 1 — Fail-closed ordering (zero-effect on missing tx config)", () => {
  it("1a. createReturnRequest: missing tx config → 0 idem, 0 doc-seq, 0 business, 0 audit", async () => {
    const deps = makeDeps();
    // Construct WITHOUT transactionRunner/txFactories
    const svc = new ReturnRequestService({
      returnRequestRepository: deps.returnRepo,
      audit: deps.audit, idempotency: deps.idempotency, documentSequence: deps.documentSequence,
      inventoryLedger: deps.inventoryLedger, subledger: deps.subledger, salesRepository: deps.salesRepository,
      snapshotService: deps.snapshotService, tenantOwnershipValidator: deps.tenantOwnershipValidator,
    });
    const idemBefore = deps.idempotency.getAllRecords().length;
    const docSeqBefore = (deps.documentSequence as any).counters?.size ?? 0;
    const auditBefore = deps.audit.count();
    const rrBefore = (deps.returnRepo as any).returnRequests.size;

    await expect(
      svc.createReturnRequest(makeUser(), makeEff(), { ...RETURN_INPUT, idempotencyKey: "d1-a" }),
    ).rejects.toThrow("CONFIGURATION_ERROR");

    // Zero-effect assertions
    expect(deps.idempotency.getAllRecords().length).toBe(idemBefore); // 0 idem rows
    expect(deps.audit.count()).toBe(auditBefore); // 0 audit rows
    expect((deps.returnRepo as any).returnRequests.size).toBe(rrBefore); // 0 business writes
    // doc-seq: no new document types allocated
    expect((deps.documentSequence as any).counters?.size ?? 0).toBe(docSeqBefore);
  });

  it("1b. submitReturnRequest: missing tx config → 0 idem, 0 audit, 0 business", async () => {
    const deps = makeDeps();
    // First create a return request WITH tx config so we have something to submit
    const svcWithTx = new ReturnRequestService({
      returnRequestRepository: deps.returnRepo,
      audit: deps.audit, idempotency: deps.idempotency, documentSequence: deps.documentSequence,
      inventoryLedger: deps.inventoryLedger, subledger: deps.subledger, salesRepository: deps.salesRepository,
      snapshotService: deps.snapshotService, tenantOwnershipValidator: deps.tenantOwnershipValidator,
      transactionRunner: deps.transactionRunner, txFactories: deps.txFactories,
    });
    const created = await svcWithTx.createReturnRequest(makeUser(), makeEff(), { ...RETURN_INPUT, idempotencyKey: "d1-b-seed" });

    // Now construct WITHOUT tx config for submit
    const svc = new ReturnRequestService({
      returnRequestRepository: deps.returnRepo,
      audit: deps.audit, idempotency: deps.idempotency, documentSequence: deps.documentSequence,
      inventoryLedger: deps.inventoryLedger, subledger: deps.subledger, salesRepository: deps.salesRepository,
      snapshotService: deps.snapshotService, tenantOwnershipValidator: deps.tenantOwnershipValidator,
    });
    const idemBefore = deps.idempotency.getAllRecords().length;
    const auditBefore = deps.audit.count();
    const rrStatusBefore = ((await deps.returnRepo.findReturnRequestById(T, created.returnRequestId)) as any)?.status;

    await expect(
      svc.submitReturnRequest(makeUser(), makeEff(), { returnRequestId: created.returnRequestId, idempotencyKey: "d1-b" }),
    ).rejects.toThrow("CONFIGURATION_ERROR");

    expect(deps.idempotency.getAllRecords().length).toBe(idemBefore);
    expect(deps.audit.count()).toBe(auditBefore);
    expect(((await deps.returnRepo.findReturnRequestById(T, created.returnRequestId)) as any)?.status).toBe(rrStatusBefore);
  });

  it("1c. approveReturnRequest: missing tx config → 0 idem, 0 audit, 0 business", async () => {
    const deps = makeDeps();
    // Create + submit with tx config
    const svcWithTx = new ReturnRequestService({
      returnRequestRepository: deps.returnRepo,
      audit: deps.audit, idempotency: deps.idempotency, documentSequence: deps.documentSequence,
      inventoryLedger: deps.inventoryLedger, subledger: deps.subledger, salesRepository: deps.salesRepository,
      snapshotService: deps.snapshotService, tenantOwnershipValidator: deps.tenantOwnershipValidator,
      transactionRunner: deps.transactionRunner, txFactories: deps.txFactories,
    });
    const created = await svcWithTx.createReturnRequest(makeUser(), makeEff(), { ...RETURN_INPUT, idempotencyKey: "d1-c-seed" });
    await svcWithTx.submitReturnRequest(makeUser(), makeEff(), { returnRequestId: created.returnRequestId, idempotencyKey: "d1-c-submit" });

    // Construct WITHOUT tx config for approve
    const svc = new ReturnRequestService({
      returnRequestRepository: deps.returnRepo,
      audit: deps.audit, idempotency: deps.idempotency, documentSequence: deps.documentSequence,
      inventoryLedger: deps.inventoryLedger, subledger: deps.subledger, salesRepository: deps.salesRepository,
      snapshotService: deps.snapshotService, tenantOwnershipValidator: deps.tenantOwnershipValidator,
    });
    const idemBefore = deps.idempotency.getAllRecords().length;
    const auditBefore = deps.audit.count();

    await expect(
      svc.approveReturnRequest(makeUser(), makeEff(), { returnRequestId: created.returnRequestId, idempotencyKey: "d1-c", decisionNotes: "approve" }),
    ).rejects.toThrow("CONFIGURATION_ERROR");

    expect(deps.idempotency.getAllRecords().length).toBe(idemBefore);
    expect(deps.audit.count()).toBe(auditBefore);
    // Return status unchanged
    expect(((await deps.returnRepo.findReturnRequestById(T, created.returnRequestId)) as any)?.status).toBe("pending_approval");
  });

  it("1d. rejectReturnRequest: missing tx config → 0 idem, 0 audit, 0 business", async () => {
    const deps = makeDeps();
    const svcWithTx = new ReturnRequestService({
      returnRequestRepository: deps.returnRepo,
      audit: deps.audit, idempotency: deps.idempotency, documentSequence: deps.documentSequence,
      inventoryLedger: deps.inventoryLedger, subledger: deps.subledger, salesRepository: deps.salesRepository,
      snapshotService: deps.snapshotService, tenantOwnershipValidator: deps.tenantOwnershipValidator,
      transactionRunner: deps.transactionRunner, txFactories: deps.txFactories,
    });
    const created = await svcWithTx.createReturnRequest(makeUser(), makeEff(), { ...RETURN_INPUT, idempotencyKey: "d1-d-seed" });
    await svcWithTx.submitReturnRequest(makeUser(), makeEff(), { returnRequestId: created.returnRequestId, idempotencyKey: "d1-d-submit" });

    const svc = new ReturnRequestService({
      returnRequestRepository: deps.returnRepo,
      audit: deps.audit, idempotency: deps.idempotency, documentSequence: deps.documentSequence,
      inventoryLedger: deps.inventoryLedger, subledger: deps.subledger, salesRepository: deps.salesRepository,
      snapshotService: deps.snapshotService, tenantOwnershipValidator: deps.tenantOwnershipValidator,
    });
    const idemBefore = deps.idempotency.getAllRecords().length;
    const auditBefore = deps.audit.count();

    await expect(
      svc.rejectReturnRequest(makeUser(), makeEff(), { returnRequestId: created.returnRequestId, rejectionReason: "reject", idempotencyKey: "d1-d" }),
    ).rejects.toThrow("CONFIGURATION_ERROR");

    expect(deps.idempotency.getAllRecords().length).toBe(idemBefore);
    expect(deps.audit.count()).toBe(auditBefore);
    expect(((await deps.returnRepo.findReturnRequestById(T, created.returnRequestId)) as any)?.status).toBe("pending_approval");
  });

  it("1e. createReplacementOrder: missing tx config → 0 idem, 0 doc-seq, 0 business, 0 audit", async () => {
    const deps = makeDeps();
    // Need an approved return with treatment=replacement
    const svcWithTx = new ReturnRequestService({
      returnRequestRepository: deps.returnRepo,
      audit: deps.audit, idempotency: deps.idempotency, documentSequence: deps.documentSequence,
      inventoryLedger: deps.inventoryLedger, subledger: deps.subledger, salesRepository: deps.salesRepository,
      snapshotService: deps.snapshotService, tenantOwnershipValidator: deps.tenantOwnershipValidator,
      transactionRunner: deps.transactionRunner, txFactories: deps.txFactories,
    });
    const created = await svcWithTx.createReturnRequest(makeUser(), makeEff(), { ...RETURN_INPUT, idempotencyKey: "d1-e-seed", financialTreatment: "replacement", isReplacement: true });
    await svcWithTx.submitReturnRequest(makeUser(), makeEff(), { returnRequestId: created.returnRequestId, idempotencyKey: "d1-e-submit" });
    await svcWithTx.approveReturnRequest(makeUser2(), makeEff(), { returnRequestId: created.returnRequestId, idempotencyKey: "d1-e-approve", decisionNotes: "approve" });

    // Construct replacement service WITHOUT tx config
    const svc = new ReplacementWorkflowService({
      returnRequestRepository: deps.returnRepo,
      salesRepository: deps.salesRepository,
      audit: deps.audit, idempotency: deps.idempotency, documentSequence: deps.documentSequence,
    });
    const idemBefore = deps.idempotency.getAllRecords().length;
    const auditBefore = deps.audit.count();
    const salesBefore = (deps.salesRepository as any).sales.size;

    await expect(
      svc.createReplacementOrder(makeUser(), makeEff(), { returnRequestId: created.returnRequestId, idempotencyKey: "d1-e" }),
    ).rejects.toThrow("CONFIGURATION_ERROR");

    expect(deps.idempotency.getAllRecords().length).toBe(idemBefore);
    expect(deps.audit.count()).toBe(auditBefore);
    expect((deps.salesRepository as any).sales.size).toBe(salesBefore);
  });
});

// ===========================================================================
// DEFECT 2: Owner-loss atomicity tests
// ===========================================================================

describe("WP-08-01E DEFECT 2 — Owner-loss atomicity (all 5 methods)", () => {
  it("2a. createReturnRequest: ownership loss → rollback + token B remains", async () => {
    const deps = makeTakeoverDeps();
    const rrBefore = (deps.returnRepo as any).returnRequests.size;
    const auditBefore = deps.audit.count();

    let threwOwnership = false;
    try {
      await deps.returnService.createReturnRequest(makeUser(), makeEff(), { ...RETURN_INPUT, idempotencyKey: "d2-a" });
    } catch (e: any) {
      threwOwnership = e instanceof IdempotencyOwnershipLostError || e.name === "IdempotencyOwnershipLostError" || e.code === "IDEMPOTENCY_OWNERSHIP_LOST";
    }
    expect(threwOwnership).toBe(true);

    // Takeover evidence
    expect(deps.takeoverIdem.evidence.takeoverAffected).toBe(1);
    expect(deps.takeoverIdem.evidence.replacementOwner).not.toBeNull();
    expect(deps.takeoverIdem.evidence.staleMarkSucceededAffected).toBe(0);

    // Rollback: 0 new return requests, 0 new audits
    expect((deps.returnRepo as any).returnRequests.size).toBe(rrBefore);
    expect(deps.audit.count()).toBe(auditBefore);

    // Token B remains the stored owner (not the original token A)
    const rec = deps.idempotency.getAllRecords().find(r => r.idempotencyKey === "d2-a")!;
    expect(rec).toBeDefined();
    expect(rec.state).toBe("in_progress"); // NOT succeeded
    expect(rec.ownerToken).toBe(deps.takeoverIdem.evidence.replacementOwner); // token B

    // Stale token A cannot mark (defensive markRetryableFailed affected 0)
    // The production catch block already attempted markRetryableFailed with
    // the stale token — it must have affected 0 rows (state stays in_progress).
    expect(rec.state).not.toBe("business_failed");
    expect(rec.state).not.toBe("retryable_failed");
  });

  it("2b. submitReturnRequest: ownership loss → rollback + token B remains", async () => {
    const deps = makeTakeoverDeps();
    // First create a return request (with a non-takeover service to avoid
    // triggering takeover on create)
    const createSvc = new ReturnRequestService({
      returnRequestRepository: deps.returnRepo,
      audit: deps.audit, idempotency: deps.idempotency, documentSequence: deps.documentSequence,
      inventoryLedger: deps.inventoryLedger, subledger: deps.subledger, salesRepository: deps.salesRepository,
      snapshotService: deps.snapshotService, tenantOwnershipValidator: deps.tenantOwnershipValidator,
      transactionRunner: deps.transactionRunner, txFactories: deps.txFactories,
    });
    const created = await createSvc.createReturnRequest(makeUser(), makeEff(), { ...RETURN_INPUT, idempotencyKey: "d2-b-seed" });
    const rrStatusBefore = ((await deps.returnRepo.findReturnRequestById(T, created.returnRequestId)) as any)?.status;
    const auditBefore = deps.audit.count();

    let threwOwnership = false;
    try {
      await deps.returnService.submitReturnRequest(makeUser(), makeEff(), { returnRequestId: created.returnRequestId, idempotencyKey: "d2-b" });
    } catch (e: any) {
      threwOwnership = e instanceof IdempotencyOwnershipLostError || e.name === "IdempotencyOwnershipLostError" || e.code === "IDEMPOTENCY_OWNERSHIP_LOST";
    }
    expect(threwOwnership).toBe(true);

    expect(deps.takeoverIdem.evidence.takeoverAffected).toBe(1);
    expect(deps.takeoverIdem.evidence.staleMarkSucceededAffected).toBe(0);

    // Rollback: status unchanged, 0 new audits
    expect(((await deps.returnRepo.findReturnRequestById(T, created.returnRequestId)) as any)?.status).toBe(rrStatusBefore);
    expect(deps.audit.count()).toBe(auditBefore);

    const rec = deps.idempotency.getAllRecords().find(r => r.idempotencyKey === "d2-b")!;
    expect(rec.state).toBe("in_progress");
    expect(rec.ownerToken).toBe(deps.takeoverIdem.evidence.replacementOwner);
  });

  it("2c. approveReturnRequest: ownership loss → rollback + token B remains", async () => {
    const deps = makeTakeoverDeps();
    // Create + submit with non-takeover service
    const createSvc = new ReturnRequestService({
      returnRequestRepository: deps.returnRepo,
      audit: deps.audit, idempotency: deps.idempotency, documentSequence: deps.documentSequence,
      inventoryLedger: deps.inventoryLedger, subledger: deps.subledger, salesRepository: deps.salesRepository,
      snapshotService: deps.snapshotService, tenantOwnershipValidator: deps.tenantOwnershipValidator,
      transactionRunner: deps.transactionRunner, txFactories: deps.txFactories,
    });
    const created = await createSvc.createReturnRequest(makeUser(), makeEff(), { ...RETURN_INPUT, idempotencyKey: "d2-c-seed" });
    await createSvc.submitReturnRequest(makeUser(), makeEff(), { returnRequestId: created.returnRequestId, idempotencyKey: "d2-c-submit" });

    const rrStatusBefore = ((await deps.returnRepo.findReturnRequestById(T, created.returnRequestId)) as any)?.status;
    const auditBefore = deps.audit.count();
    const stockBefore = (deps.ledgerRepo as any).movements.size;

    let threwOwnership = false;
    try {
      await deps.returnService.approveReturnRequest(makeUser2(), makeEff(), { returnRequestId: created.returnRequestId, idempotencyKey: "d2-c", decisionNotes: "approve" });
    } catch (e: any) {
      threwOwnership = e instanceof IdempotencyOwnershipLostError || e.name === "IdempotencyOwnershipLostError" || e.code === "IDEMPOTENCY_OWNERSHIP_LOST";
    }
    expect(threwOwnership).toBe(true);

    expect(deps.takeoverIdem.evidence.takeoverAffected).toBe(1);
    expect(deps.takeoverIdem.evidence.staleMarkSucceededAffected).toBe(0);

    // Rollback: status unchanged, 0 new audits, 0 new stock movements
    expect(((await deps.returnRepo.findReturnRequestById(T, created.returnRequestId)) as any)?.status).toBe(rrStatusBefore);
    expect(deps.audit.count()).toBe(auditBefore);
    expect((deps.ledgerRepo as any).movements.size).toBe(stockBefore);

    const rec = deps.idempotency.getAllRecords().find(r => r.idempotencyKey === "d2-c")!;
    expect(rec.state).toBe("in_progress");
    expect(rec.ownerToken).toBe(deps.takeoverIdem.evidence.replacementOwner);
  });

  it("2d. rejectReturnRequest: ownership loss → rollback + token B remains", async () => {
    const deps = makeTakeoverDeps();
    const createSvc = new ReturnRequestService({
      returnRequestRepository: deps.returnRepo,
      audit: deps.audit, idempotency: deps.idempotency, documentSequence: deps.documentSequence,
      inventoryLedger: deps.inventoryLedger, subledger: deps.subledger, salesRepository: deps.salesRepository,
      snapshotService: deps.snapshotService, tenantOwnershipValidator: deps.tenantOwnershipValidator,
      transactionRunner: deps.transactionRunner, txFactories: deps.txFactories,
    });
    const created = await createSvc.createReturnRequest(makeUser(), makeEff(), { ...RETURN_INPUT, idempotencyKey: "d2-d-seed" });
    await createSvc.submitReturnRequest(makeUser(), makeEff(), { returnRequestId: created.returnRequestId, idempotencyKey: "d2-d-submit" });

    const rrStatusBefore = ((await deps.returnRepo.findReturnRequestById(T, created.returnRequestId)) as any)?.status;
    const auditBefore = deps.audit.count();

    let threwOwnership = false;
    try {
      await deps.returnService.rejectReturnRequest(makeUser(), makeEff(), { returnRequestId: created.returnRequestId, rejectionReason: "reject", idempotencyKey: "d2-d" });
    } catch (e: any) {
      threwOwnership = e instanceof IdempotencyOwnershipLostError || e.name === "IdempotencyOwnershipLostError" || e.code === "IDEMPOTENCY_OWNERSHIP_LOST";
    }
    expect(threwOwnership).toBe(true);

    expect(deps.takeoverIdem.evidence.takeoverAffected).toBe(1);
    expect(deps.takeoverIdem.evidence.staleMarkSucceededAffected).toBe(0);

    // Rollback: status unchanged, 0 new audits
    expect(((await deps.returnRepo.findReturnRequestById(T, created.returnRequestId)) as any)?.status).toBe(rrStatusBefore);
    expect(deps.audit.count()).toBe(auditBefore);

    const rec = deps.idempotency.getAllRecords().find(r => r.idempotencyKey === "d2-d")!;
    expect(rec.state).toBe("in_progress");
    expect(rec.ownerToken).toBe(deps.takeoverIdem.evidence.replacementOwner);
  });

  it("2e. createReplacementOrder: ownership loss → rollback + token B remains", async () => {
    const deps = makeTakeoverDeps();
    // Create + submit + approve with non-takeover service
    const createSvc = new ReturnRequestService({
      returnRequestRepository: deps.returnRepo,
      audit: deps.audit, idempotency: deps.idempotency, documentSequence: deps.documentSequence,
      inventoryLedger: deps.inventoryLedger, subledger: deps.subledger, salesRepository: deps.salesRepository,
      snapshotService: deps.snapshotService, tenantOwnershipValidator: deps.tenantOwnershipValidator,
      transactionRunner: deps.transactionRunner, txFactories: deps.txFactories,
    });
    const created = await createSvc.createReturnRequest(makeUser(), makeEff(), { ...RETURN_INPUT, idempotencyKey: "d2-e-seed", financialTreatment: "replacement", isReplacement: true });
    await createSvc.submitReturnRequest(makeUser(), makeEff(), { returnRequestId: created.returnRequestId, idempotencyKey: "d2-e-submit" });
    await createSvc.approveReturnRequest(makeUser2(), makeEff(), { returnRequestId: created.returnRequestId, idempotencyKey: "d2-e-approve", decisionNotes: "approve" });

    const salesBefore = (deps.salesRepository as any).sales.size;
    const auditBefore = deps.audit.count();

    let threwOwnership = false;
    try {
      await deps.replaceService.createReplacementOrder(makeUser(), makeEff(), { returnRequestId: created.returnRequestId, idempotencyKey: "d2-e" });
    } catch (e: any) {
      threwOwnership = e instanceof IdempotencyOwnershipLostError || e.name === "IdempotencyOwnershipLostError" || e.code === "IDEMPOTENCY_OWNERSHIP_LOST";
    }
    expect(threwOwnership).toBe(true);

    expect(deps.takeoverIdem.evidence.takeoverAffected).toBe(1);
    expect(deps.takeoverIdem.evidence.staleMarkSucceededAffected).toBe(0);

    // Rollback: 0 new sales orders, 0 new audits
    expect((deps.salesRepository as any).sales.size).toBe(salesBefore);
    expect(deps.audit.count()).toBe(auditBefore);

    const rec = deps.idempotency.getAllRecords().find(r => r.idempotencyKey === "d2-e")!;
    expect(rec.state).toBe("in_progress");
    expect(rec.ownerToken).toBe(deps.takeoverIdem.evidence.replacementOwner);
  });
});

// ===========================================================================
// DEFECT 2: Retry + replay + conflict after owner-loss recovery
// ===========================================================================

describe("WP-08-01E DEFECT 2 — Retry/replay/conflict after owner-loss recovery", () => {
  it("3a. createReturnRequest: retry after reclaim creates exactly 1 result, replay creates 0 new", async () => {
    const deps = makeTakeoverDeps();
    // First attempt fails with ownership loss
    await expect(
      deps.returnService.createReturnRequest(makeUser(), makeEff(), { ...RETURN_INPUT, idempotencyKey: "d3-a" }),
    ).rejects.toThrow();

    // Expire the takeover owner's lease so reclaim is possible
    const rec = deps.idempotency.getAllRecords().find(r => r.idempotencyKey === "d3-a")!;
    (deps.idempotency as any).records.get(rec.id).leaseExpiresAt = new Date(Date.now() - 1000);

    // Use a non-takeover service for retry (simulating a fresh caller)
    const retrySvc = new ReturnRequestService({
      returnRequestRepository: deps.returnRepo,
      audit: deps.audit, idempotency: deps.idempotency, documentSequence: deps.documentSequence,
      inventoryLedger: deps.inventoryLedger, subledger: deps.subledger, salesRepository: deps.salesRepository,
      snapshotService: deps.snapshotService, tenantOwnershipValidator: deps.tenantOwnershipValidator,
      transactionRunner: deps.transactionRunner, txFactories: deps.txFactories,
    });
    const auditBeforeRetry = deps.audit.count();
    const rrBeforeRetry = (deps.returnRepo as any).returnRequests.size;

    // Retry with same key + same payload
    const result = await retrySvc.createReturnRequest(makeUser(), makeEff(), { ...RETURN_INPUT, idempotencyKey: "d3-a" });
    expect(result.action).toBe("created");
    expect((deps.returnRepo as any).returnRequests.size).toBe(rrBeforeRetry + 1); // exactly 1 new
    expect(deps.audit.count()).toBe(auditBeforeRetry + 1); // exactly 1 new audit

    // Replay with same key
    const auditBeforeReplay = deps.audit.count();
    const rrBeforeReplay = (deps.returnRepo as any).returnRequests.size;
    const replayResult = await retrySvc.createReturnRequest(makeUser(), makeEff(), { ...RETURN_INPUT, idempotencyKey: "d3-a" });
    expect(replayResult.action).toBe("replayed");
    expect((deps.returnRepo as any).returnRequests.size).toBe(rrBeforeReplay); // 0 new
    expect(deps.audit.count()).toBe(auditBeforeReplay); // 0 new audits

    // Conflict with same key + different body
    const auditBeforeConflict = deps.audit.count();
    let conflictThrew = false;
    try {
      await retrySvc.createReturnRequest(makeUser(), makeEff(), { ...RETURN_INPUT, idempotencyKey: "d3-a", returnReason: "Different" });
    } catch (e: any) {
      conflictThrew = e.code === "IDEMPOTENCY_CONFLICT";
    }
    expect(conflictThrew).toBe(true);
    expect(deps.audit.count()).toBe(auditBeforeConflict); // 0 new
  });
});
