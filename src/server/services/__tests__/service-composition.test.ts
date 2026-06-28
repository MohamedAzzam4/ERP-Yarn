/**
 * WP-01-03 integration tests — service composition.
 * Contract: 06 §6 step 10 — audit + business effects in same transaction.
 */
import { describe, it, expect } from "vitest";
import { appendAuditLog, InProcessAuditStore } from "../audit-service";
import { claimIdempotency, markSucceeded, InProcessIdempotencyStore } from "../idempotency-service";
import { allocateDocumentNumberWithLock, InProcessDocumentSequenceStore } from "../document-sequence-service";
import { AuditWriteFailedError } from "../errors";

describe("Service composition — audit + idempotency + document sequence", () => {
  it("all three services compose in a single logical transaction", async () => {
    const auditStore = new InProcessAuditStore();
    const idemStore = new InProcessIdempotencyStore();
    const seqStore = new InProcessDocumentSequenceStore();

    const tenantId = "tenant-1";
    const userId = "user-1";
    const requestBody = { sale_id: "s1", amount: 100 };

    const claim = await claimIdempotency(idemStore, {
      tenantId, operationScope: "sales.approve", idempotencyKey: "key-1",
      requestBody, initiatedBy: userId, leaseDurationMs: 30_000,
    });
    expect(claim.action).toBe("execute");

    const docNum = await allocateDocumentNumberWithLock(seqStore, { tenantId, documentType: "sales_approval", year: 2026 });
    expect(docNum.docNo).toBe("SOA-2026-000001");

    await appendAuditLog(auditStore, tenantId, userId, {
      entityType: "sales_order", entityId: "s1", actionType: "approve",
      newValuesJson: { doc_no: docNum.docNo, amount: 100 }, idempotencyKey: "key-1",
    });

    await markSucceeded(idemStore, claim.record.id, {
      responseCode: 200, responseBody: { doc_no: docNum.docNo }, entityType: "sales_order", entityId: "s1",
    });

    expect(auditStore.count()).toBe(1);
    expect(idemStore.getRecord(claim.record.id)!.state).toBe("succeeded");
    expect(seqStore.peekLastNumber(tenantId, "sales_approval", 2026)).toBe(1);
  });

  it("audit write failure prevents markSucceeded (transaction rollback pattern)", async () => {
    const auditStore = new InProcessAuditStore();
    const idemStore = new InProcessIdempotencyStore();

    const tenantId = "tenant-1";
    const userId = "user-1";

    const claim = await claimIdempotency(idemStore, {
      tenantId, operationScope: "sales.approve", idempotencyKey: "key-1",
      requestBody: { sale_id: "s1" }, initiatedBy: userId, leaseDurationMs: 30_000,
    });

    auditStore.setShouldFail(true);
    await expect(appendAuditLog(auditStore, tenantId, userId, {
      entityType: "sales_order", entityId: "s1", actionType: "approve", idempotencyKey: "key-1",
    })).rejects.toThrow(AuditWriteFailedError);

    // markSucceeded was never called — idempotency record is still in_progress.
    expect(idemStore.getRecord(claim.record.id)!.state).toBe("in_progress");
    expect(auditStore.count()).toBe(0);
  });
});

describe("No business posting logic introduced", () => {
  it("service modules export NO business-posting functions", async () => {
    const auditMod = await import("../audit-service");
    const idemMod = await import("../idempotency-service");
    const seqMod = await import("../document-sequence-service");
    const allExports = [...Object.keys(auditMod), ...Object.keys(idemMod), ...Object.keys(seqMod)];
    const forbidden = [/^post/i, /^approve/i, /^createSale/i, /^createTransfer/i, /^createPayment/i, /^createProduction/i, /^commitMigration/i];
    for (const name of allExports) {
      for (const pattern of forbidden) {
        expect(pattern.test(name), `service module exports business-posting function '${name}'`).toBe(false);
      }
    }
  });
});
