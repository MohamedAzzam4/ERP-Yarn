/**
 * WP-08-01E — Error Classification Audit.
 *
 * Contract: docs/contracts/06_approval_transaction_contract.md §7.1, §7.2
 *
 * Three failure classes:
 *   - infrastructure/audit/transient failures → retryable_failed
 *     (NOT durable — same-key retry re-executes the operation)
 *   - durable business/domain failures → business_failed
 *     (durable — same-key replay returns same failure)
 *   - ownership loss (IdempotencyOwnershipLostError) → stale caller MUST NOT
 *     mutate the idempotency record's state. The new owner's record is
 *     untouched by the stale caller's defensive markRetryableFailed/markBusinessFailed.
 *
 * These tests prove the classification with concrete assertions.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { QualityTestService } from "@/server/services/quality-test-service";
import { InMemoryQualityTestRepository } from "@/server/services/__tests__/in-memory-quality-test-repository";
import { InProcessAuditStore } from "@/server/services/audit-service";
import { InProcessIdempotencyStore } from "@/server/services/idempotency-service";
import { InProcessDocumentSequenceStore } from "@/server/services/document-sequence-service";
import {
  claimIdempotency,
  markSucceeded,
  markBusinessFailed,
  markRetryableFailed,
  IdempotencyOwnershipLostError,
  type IdempotencyTransactionHandle,
} from "@/server/services/idempotency-service";
import type { ErpUserContext } from "@/server/auth/erp-context";
import type { EffectivePermissions } from "@/server/security/effective-permissions";

const TEST_TENANT = "00000000-0000-0000-0000-000000081e91";
const TEST_USER_ID = "00000000-0000-0000-0000-000000081e92";
const TEST_ITEM_ID = "00000000-0000-4000-8000-cccc000e0091";

function makeUser(): ErpUserContext {
  return { authenticated: true, tenantId: TEST_TENANT, userId: TEST_USER_ID, name: "T", email: "t@e.test", authId: "t" } as any;
}
function makeEff(): EffectivePermissions {
  return { assignedRoleCodes: ["quality_employee"], permissionKeys: new Set(["quality_tests.create"]), deniedFieldKeys: new Set(), workerFinancialDeny: false } as any;
}

describe("WP-08-01E Error Classification Audit", () => {
  describe("1. Durable business failure (business_failed) is terminal", () => {
    let idem: InProcessIdempotencyStore;

    beforeEach(() => { idem = new InProcessIdempotencyStore(); });

    it("1a. markBusinessFailed with same owner → state becomes business_failed", async () => {
      const claim = await claimIdempotency(idem, {
        tenantId: TEST_TENANT, operationScope: "test.durable", idempotencyKey: "key-1a",
        requestBody: { x: 1 }, initiatedBy: TEST_USER_ID, leaseDurationMs: 30000,
      });
      const affected = await markBusinessFailed(idem, claim.record.id, {
        responseCode: 409, responseBody: { error: "STOCK_INSUFFICIENT" },
        lastErrorClass: "StockInsufficientError",
      }, claim.record.ownerToken!, new Date());
      expect(affected).toBe(1);
      const rec = idem.getRecord(claim.record.id)!;
      expect(rec.state).toBe("business_failed");
      expect(rec.lastErrorClass).toBe("StockInsufficientError");
    });

    it("1b. same-key replay after business_failed returns replay (terminal)", async () => {
      const claim = await claimIdempotency(idem, {
        tenantId: TEST_TENANT, operationScope: "test.durable", idempotencyKey: "key-1b",
        requestBody: { x: 1 }, initiatedBy: TEST_USER_ID, leaseDurationMs: 30000,
      });
      await markBusinessFailed(idem, claim.record.id, {
        responseCode: 409, responseBody: { error: "DUPLICATE_SOURCE" },
        lastErrorClass: "DuplicateSourceError",
      }, claim.record.ownerToken!, new Date());
      // Same key + same payload → must return replay (terminal state preserved)
      const replay = await claimIdempotency(idem, {
        tenantId: TEST_TENANT, operationScope: "test.durable", idempotencyKey: "key-1b",
        requestBody: { x: 1 }, initiatedBy: TEST_USER_ID, leaseDurationMs: 30000,
      });
      expect(replay.action).toBe("replay");
      expect(replay.record.state).toBe("business_failed");
      expect(replay.record.attemptCount).toBe(1); // not reclaimed, no increment
    });

    it("1c. business_failed record is NOT reclaimed by expired-lease reclaim", async () => {
      // business_failed is terminal — claimExpiredLease predicate only matches
      // retryable_failed OR (in_progress + lease_expired), never business_failed.
      const claim = await claimIdempotency(idem, {
        tenantId: TEST_TENANT, operationScope: "test.durable", idempotencyKey: "key-1c",
        requestBody: { x: 1 }, initiatedBy: TEST_USER_ID, leaseDurationMs: 1,
      });
      await markBusinessFailed(idem, claim.record.id, {
        responseCode: 409, responseBody: { error: "STOCK_INSUFFICIENT" },
        lastErrorClass: "StockInsufficientError",
      }, claim.record.ownerToken!, new Date());
      await new Promise(r => setTimeout(r, 50));
      // Attempt expired-lease reclaim
      const reclaimed = await idem.claimExpiredLease(
        claim.record.id, new Date(Date.now() + 30000), new Date(), new Date(),
      );
      expect(reclaimed).toBe(false);
      const rec = idem.getRecord(claim.record.id)!;
      expect(rec.state).toBe("business_failed"); // unchanged
      expect(rec.attemptCount).toBe(1);
    });
  });

  describe("2. Infrastructure/audit/transient failure (retryable_failed) is same-key retryable", () => {
    let idem: InProcessIdempotencyStore;

    beforeEach(() => { idem = new InProcessIdempotencyStore(); });

    it("2a. markRetryableFailed with same owner → state becomes retryable_failed", async () => {
      const claim = await claimIdempotency(idem, {
        tenantId: TEST_TENANT, operationScope: "test.retryable", idempotencyKey: "key-2a",
        requestBody: { x: 1 }, initiatedBy: TEST_USER_ID, leaseDurationMs: 30000,
      });
      const affected = await markRetryableFailed(idem, claim.record.id, {
        lastErrorClass: "AuditInsertError",
      }, claim.record.ownerToken!, new Date());
      expect(affected).toBe(1);
      const rec = idem.getRecord(claim.record.id)!;
      expect(rec.state).toBe("retryable_failed");
      expect(rec.lastErrorClass).toBe("AuditInsertError");
    });

    it("2b. same-key retry after retryable_failed re-executes (attemptCount increments)", async () => {
      const claim = await claimIdempotency(idem, {
        tenantId: TEST_TENANT, operationScope: "test.retryable", idempotencyKey: "key-2b",
        requestBody: { x: 1 }, initiatedBy: TEST_USER_ID, leaseDurationMs: 30000,
      });
      await markRetryableFailed(idem, claim.record.id, {
        lastErrorClass: "AuditInsertError",
      }, claim.record.ownerToken!, new Date());
      // Same key + same payload → must return execute (re-claim)
      const retry = await claimIdempotency(idem, {
        tenantId: TEST_TENANT, operationScope: "test.retryable", idempotencyKey: "key-2b",
        requestBody: { x: 1 }, initiatedBy: TEST_USER_ID, leaseDurationMs: 30000,
      });
      expect(retry.action).toBe("execute");
      expect(retry.record.attemptCount).toBe(2); // incremented on reclaim
      expect(retry.record.ownerToken).not.toBe(claim.record.ownerToken); // new owner token
    });

    it("2c. retryable_failed record IS reclaimed by expired-lease reclaim", async () => {
      const claim = await claimIdempotency(idem, {
        tenantId: TEST_TENANT, operationScope: "test.retryable", idempotencyKey: "key-2c",
        requestBody: { x: 1 }, initiatedBy: TEST_USER_ID, leaseDurationMs: 1,
      });
      await markRetryableFailed(idem, claim.record.id, {
        lastErrorClass: "AuditInsertError",
      }, claim.record.ownerToken!, new Date());
      await new Promise(r => setTimeout(r, 50));
      const reclaimed = await idem.claimExpiredLease(
        claim.record.id, new Date(Date.now() + 30000), new Date(), new Date(),
      );
      expect(reclaimed).toBe(true);
      const rec = idem.getRecord(claim.record.id)!;
      expect(rec.state).toBe("in_progress");
      expect(rec.attemptCount).toBe(2);
    });
  });

  describe("3. Ownership loss — stale caller cannot mutate idempotency state", () => {
    let idem: InProcessIdempotencyStore;

    beforeEach(() => { idem = new InProcessIdempotencyStore(); });

    it("3a. after claimExpiredLease replaces ownerToken, stale markSucceeded affects 0 rows", async () => {
      const claim = await claimIdempotency(idem, {
        tenantId: TEST_TENANT, operationScope: "test.owner", idempotencyKey: "key-3a",
        requestBody: { x: 1 }, initiatedBy: TEST_USER_ID, leaseDurationMs: 1,
      });
      const originalOwner = claim.record.ownerToken!;
      expect(originalOwner).toBeTruthy(); // non-null
      // Wait for lease to expire
      await new Promise(r => setTimeout(r, 50));
      // New caller reclaims — replaces ownerToken
      const reclaimed = await idem.claimExpiredLease(
        claim.record.id, new Date(Date.now() + 30000), new Date(), new Date(),
      );
      expect(reclaimed).toBe(true);
      const replacementOwner = idem.getRecord(claim.record.id)!.ownerToken!;
      expect(replacementOwner).toBeTruthy();
      expect(replacementOwner).not.toBe(originalOwner); // changed
      // Stale caller's markSucceeded → 0 rows + throws
      let threw = false;
      try {
        await markSucceeded(idem, claim.record.id, { responseCode: 200, responseBody: {} }, originalOwner);
      } catch (e: any) {
        threw = e instanceof IdempotencyOwnershipLostError || e.name === "IdempotencyOwnershipLostError";
      }
      expect(threw).toBe(true);
      // Record state NOT mutated by stale caller
      const rec = idem.getRecord(claim.record.id)!;
      expect(rec.state).toBe("in_progress");
      expect(rec.ownerToken).toBe(replacementOwner); // still owned by replacement
    });

    it("3b. after ownership loss, stale markBusinessFailed affects 0 rows (no poisoning)", async () => {
      const claim = await claimIdempotency(idem, {
        tenantId: TEST_TENANT, operationScope: "test.owner", idempotencyKey: "key-3b",
        requestBody: { x: 1 }, initiatedBy: TEST_USER_ID, leaseDurationMs: 1,
      });
      const originalOwner = claim.record.ownerToken!;
      await new Promise(r => setTimeout(r, 50));
      await idem.claimExpiredLease(
        claim.record.id, new Date(Date.now() + 30000), new Date(), new Date(),
      );
      // Stale caller tries markBusinessFailed → must affect 0 rows
      const affected = await markBusinessFailed(idem, claim.record.id, {
        responseCode: 409, responseBody: { message: "stale" },
        lastErrorClass: "IdempotencyOwnershipLostError",
      }, originalOwner, new Date());
      expect(affected).toBe(0);
      // Record state NOT mutated to business_failed
      const rec = idem.getRecord(claim.record.id)!;
      expect(rec.state).toBe("in_progress"); // NOT business_failed
    });

    it("3c. after ownership loss, stale markRetryableFailed affects 0 rows", async () => {
      const claim = await claimIdempotency(idem, {
        tenantId: TEST_TENANT, operationScope: "test.owner", idempotencyKey: "key-3c",
        requestBody: { x: 1 }, initiatedBy: TEST_USER_ID, leaseDurationMs: 1,
      });
      const originalOwner = claim.record.ownerToken!;
      await new Promise(r => setTimeout(r, 50));
      await idem.claimExpiredLease(
        claim.record.id, new Date(Date.now() + 30000), new Date(), new Date(),
      );
      const affected = await markRetryableFailed(idem, claim.record.id, {
        lastErrorClass: "IdempotencyOwnershipLostError",
      }, originalOwner, new Date());
      expect(affected).toBe(0);
      const rec = idem.getRecord(claim.record.id)!;
      expect(rec.state).toBe("in_progress");
    });
  });

  describe("4. Production service: createQualityTest error classification", () => {
    let repo: InMemoryQualityTestRepository;
    let audit: InProcessAuditStore;
    let idem: InProcessIdempotencyStore;
    let docSeq: InProcessDocumentSequenceStore;
    let service: QualityTestService;

    beforeEach(() => {
      repo = new InMemoryQualityTestRepository();
      audit = new InProcessAuditStore();
      idem = new InProcessIdempotencyStore();
      docSeq = new InProcessDocumentSequenceStore();
      service = new QualityTestService({
        qualityTestRepository: repo, audit, idempotency: idem, documentSequence: docSeq,
        transactionRunner: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => work('simulated-tx'),
        txFactories: {
          createQualityTestRepository: () => repo,
          createIdempotency: () => idem,
          createAudit: () => audit,
          createDocumentSequence: () => docSeq,
        },
      });
    });

    it("4a. audit failure → retryable_failed (same-key retry succeeds)", async () => {
      const failingAudit = new InProcessAuditStore();
      failingAudit.setShouldFail(true);
      const txService = new QualityTestService({
        qualityTestRepository: repo,
        audit: failingAudit,
        idempotency: idem,
        documentSequence: docSeq,
        transactionRunner: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
          const snapshots = [repo.snapshot()];
          try { return await work('simulated-tx'); }
          catch (e) { repo.restore(snapshots[0]!); throw e; }
        },
        txFactories: {
          createQualityTestRepository: () => repo,
          createIdempotency: () => idem,
          createAudit: () => failingAudit,
          createDocumentSequence: () => docSeq,
        },
      });
      const KEY = "err-4a";
      // First attempt: audit fails → tx rolls back, markRetryableFailed called
      let threw = false;
      try {
        await txService.createQualityTest(makeUser() as any, makeEff() as any, {
          testDate: "2026-08-06", linkedEntityType: "inventory_item" as any,
          linkedEntityId: TEST_ITEM_ID, idempotencyKey: KEY,
        });
      } catch { threw = true; }
      expect(threw).toBe(true);
      // State must be retryable_failed (NOT succeeded, NOT business_failed)
      const stateAfter = idem.getAllRecords().filter(r => r.operationScope === "quality_test.create")[0]!.state;
      expect(stateAfter).toBe("retryable_failed");

      // Second attempt: same key + same payload → re-executes successfully
      const r2 = await service.createQualityTest(makeUser() as any, makeEff() as any, {
        testDate: "2026-08-06", linkedEntityType: "inventory_item" as any,
        linkedEntityId: TEST_ITEM_ID, idempotencyKey: KEY,
      });
      expect(r2.action).toBe("created");
      const stateFinal = idem.getAllRecords().filter(r => r.operationScope === "quality_test.create")[0]!.state;
      expect(stateFinal).toBe("succeeded");
      // Exactly 1 quality test (retry created exactly one effect)
      const tests = await repo.listQualityTestsForLinkedEntity(TEST_TENANT, "inventory_item", TEST_ITEM_ID);
      expect(tests.length).toBe(1);
    });

    it("4b. ownership loss → stale caller's markRetryableFailed affects 0 rows (state NOT mutated to business_failed)", async () => {
      // Wrapper that simulates a real PostgreSQL owner-token takeover by an
      // independent root DB connection: when updateState(state="succeeded")
      // is called, the wrapper first REPLACES the owner_token of the record
      // (guarded by state=in_progress + original owner) BEFORE delegating
      // the original updateState call. The delegated call then sees the
      // replaced ownerToken and returns 0 affected rows → triggers
      // IdempotencyOwnershipLostError → transaction rolls back.
      class TakeoverAtSucceedStore implements IdempotencyTransactionHandle {
        readonly takeoverCalls: Array<{ id: string; expected: string }> = [];
        constructor(private readonly inner: InProcessIdempotencyStore) {}
        async findByTenantScopeKey(t: string, s: string, k: string) { return this.inner.findByTenantScopeKey(t, s, k); }
        async insert(r: any) { return this.inner.insert(r); }
        async claimExpiredLease(id: string, ne: Date, nh: Date, n: Date) { return this.inner.claimExpiredLease(id, ne, nh, n); }
        async heartbeat(id: string, n: Date) { return this.inner.heartbeat(id, n); }
        async updateState(id: string, update: any): Promise<number> {
          if (update.state === "succeeded") {
            // Simulate root DB connection replacing owner_token atomically
            // guarded by id + state=in_progress + expected owner token.
            const rec = this.inner.getRecord(id);
            if (rec && rec.ownerToken === update.expectedOwnerToken) {
              const replacement = `takeover-${crypto.randomUUID()}`;
              // Mutate the inner store directly — bypassing claimExpiredLease
              // because we're simulating a different code path (root takeover).
              (this.inner as any).records.set(id, {
                ...rec,
                ownerToken: replacement,
                attemptCount: rec.attemptCount + 1,
              });
              this.takeoverCalls.push({ id, expected: update.expectedOwnerToken });
            }
          }
          // Delegate — will return 0 because ownerToken no longer matches
          return this.inner.updateState(id, update);
        }
      }

      const losingIdem = new InProcessIdempotencyStore();
      const takeoverStore = new TakeoverAtSucceedStore(losingIdem);
      // Audit wrapper that supports snapshot/restore for tx rollback simulation
      const snapshotAudit = (() => {
        const inner = new InProcessAuditStore();
        let snap: any[] = [];
        return {
          inner,
          snapshot() { snap = [...inner.getRows()]; },
          restore() { (inner as any).rows = [...snap]; },
        };
      })();
      const txService = new QualityTestService({
        qualityTestRepository: repo,
        audit: snapshotAudit.inner,
        idempotency: takeoverStore,
        documentSequence: docSeq,
        transactionRunner: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
          const repoSnap = repo.snapshot();
          snapshotAudit.snapshot();
          try { return await work('simulated-tx'); }
          catch (e) {
            repo.restore(repoSnap);
            snapshotAudit.restore();
            throw e;
          }
        },
        txFactories: {
          createQualityTestRepository: () => repo,
          createIdempotency: () => takeoverStore,
          createAudit: () => snapshotAudit.inner,
          createDocumentSequence: () => docSeq,
        },
      });
      const KEY = "err-4b";
      let threwOwnership = false;
      let caughtError: any = null;
      try {
        await txService.createQualityTest(makeUser() as any, makeEff() as any, {
          testDate: "2026-08-06", linkedEntityType: "inventory_item" as any,
          linkedEntityId: TEST_ITEM_ID, idempotencyKey: KEY,
        });
      } catch (e: any) {
        caughtError = e;
        threwOwnership = e instanceof IdempotencyOwnershipLostError || e.name === "IdempotencyOwnershipLostError" || e.code === "IDEMPOTENCY_OWNERSHIP_LOST";
      }
      expect(threwOwnership).toBe(true);
      expect(takeoverStore.takeoverCalls.length).toBe(1); // exactly one takeover occurred
      // Find the idempotency record
      const rec = losingIdem.getAllRecords().filter(r => r.operationScope === "quality_test.create")[0]!;
      expect(rec).toBeDefined();
      // Critical: state NOT mutated to business_failed by stale caller
      expect(rec.state).not.toBe("business_failed");
      expect(rec.state).toBe("in_progress"); // not succeeded
      // Owner token was replaced (non-null, different from original)
      const originalOwner = takeoverStore.takeoverCalls[0]!.expected;
      expect(rec.ownerToken).toBeTruthy();
      expect(rec.ownerToken).not.toBe(originalOwner);
      // Exactly 0 quality tests (transaction rolled back)
      const tests = await repo.listQualityTestsForLinkedEntity(TEST_TENANT, "inventory_item", TEST_ITEM_ID);
      expect(tests.length).toBe(0);
      // Exactly 0 audits (transaction rolled back)
      expect(snapshotAudit.inner.count()).toBe(0);
    });
  });
});
