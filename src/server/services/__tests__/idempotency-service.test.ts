/**
 * WP-01-03 tests — idempotency service.
 * Contract: 03 §7.8, 06 §7, 09 §5/§7.
 */
import { describe, it, expect } from "vitest";
import {
  claimIdempotency, markSucceeded, markBusinessFailed, markRetryableFailed,
  heartbeatIdempotency, InProcessIdempotencyStore, type IdempotencyClaimInput,
} from "../idempotency-service";
import { computeRequestHash } from "../request-hash";

const TENANT_ID = "tenant-1";
const USER_ID = "user-1";
const OPERATION_SCOPE = "sales.approve";
const LEASE_DURATION_MS = 30_000;

function makeInput(key: string, body: unknown, now?: Date): IdempotencyClaimInput {
  return { tenantId: TENANT_ID, operationScope: OPERATION_SCOPE, idempotencyKey: key, requestBody: body, initiatedBy: USER_ID, leaseDurationMs: LEASE_DURATION_MS, ...(now ? { now } : {}) };
}

describe("claimIdempotency — first request", () => {
  it("creates a new in_progress record and returns action=execute", async () => {
    const store = new InProcessIdempotencyStore();
    const result = await claimIdempotency(store, makeInput("key-1", { sale_id: "s1" }));
    expect(result.action).toBe("execute");
    expect(result.record.state).toBe("in_progress");
    expect(result.record.attemptCount).toBe(1);
    expect(result.record.requestHash).toBe(computeRequestHash({ sale_id: "s1" }));
  });

  it("stores the request hash (secret-stripped)", async () => {
    const store = new InProcessIdempotencyStore();
    const result = await claimIdempotency(store, makeInput("key-1", { sale_id: "s1", password: "secret" }));
    expect(result.record.requestHash).toBe(computeRequestHash({ sale_id: "s1" }));
    expect(result.record.requestHash).toHaveLength(64);
  });
});

describe("claimIdempotency — same key + same request → replay", () => {
  it("returns action=replay when prior result was succeeded", async () => {
    const store = new InProcessIdempotencyStore();
    const r1 = await claimIdempotency(store, makeInput("key-1", { sale_id: "s1" }));
    await markSucceeded(store, r1.record.id, { responseCode: 200, responseBody: { result: "approved" } });
    const r2 = await claimIdempotency(store, makeInput("key-1", { sale_id: "s1" }));
    expect(r2.action).toBe("replay");
    expect(r2.record.state).toBe("succeeded");
    expect(r2.record.responseCode).toBe(200);
  });

  it("returns action=replay when prior result was business_failed", async () => {
    const store = new InProcessIdempotencyStore();
    const r1 = await claimIdempotency(store, makeInput("key-1", { sale_id: "s1" }));
    await markBusinessFailed(store, r1.record.id, { responseCode: 409, responseBody: { error: "STOCK_INSUFFICIENT" }, lastErrorClass: "STOCK_INSUFFICIENT" });
    const r2 = await claimIdempotency(store, makeInput("key-1", { sale_id: "s1" }));
    expect(r2.action).toBe("replay");
    expect(r2.record.state).toBe("business_failed");
  });

  it("replay does NOT create a new record", async () => {
    const store = new InProcessIdempotencyStore();
    const r1 = await claimIdempotency(store, makeInput("key-1", { x: 1 }));
    await markSucceeded(store, r1.record.id, { responseCode: 200, responseBody: { ok: true } });
    const r2 = await claimIdempotency(store, makeInput("key-1", { x: 1 }));
    expect(r2.record.id).toBe(r1.record.id);
    expect(store.getAllRecords().length).toBe(1);
  });
});

describe("claimIdempotency — same key + different request → conflict", () => {
  it("returns action=conflict when request body differs", async () => {
    const store = new InProcessIdempotencyStore();
    const r1 = await claimIdempotency(store, makeInput("key-1", { sale_id: "s1" }));
    await markSucceeded(store, r1.record.id, { responseCode: 200, responseBody: { ok: true } });
    const r2 = await claimIdempotency(store, makeInput("key-1", { sale_id: "s2" }));
    expect(r2.action).toBe("conflict");
  });

  it("conflict is detected even for in_progress records", async () => {
    const store = new InProcessIdempotencyStore();
    await claimIdempotency(store, makeInput("key-1", { x: 1 }));
    const r2 = await claimIdempotency(store, makeInput("key-1", { x: 2 }));
    expect(r2.action).toBe("conflict");
  });

  it("conflict is NOT triggered by authority field differences (stripped)", async () => {
    const store = new InProcessIdempotencyStore();
    const r1 = await claimIdempotency(store, makeInput("key-1", { data: "x", tenant_id: "t1" }));
    await markSucceeded(store, r1.record.id, { responseCode: 200, responseBody: { ok: true } });
    const r2 = await claimIdempotency(store, makeInput("key-1", { data: "x", tenant_id: "t2" }));
    expect(r2.action).toBe("replay");
  });
});

describe("claimIdempotency — in-progress lease behavior", () => {
  it("returns action=in_progress when a live lease exists", async () => {
    const store = new InProcessIdempotencyStore();
    const now = new Date("2026-06-28T00:00:00Z");
    await claimIdempotency(store, makeInput("key-1", { x: 1 }, now));
    const nowPlus10s = new Date(now.getTime() + 10_000);
    const r2 = await claimIdempotency(store, makeInput("key-1", { x: 1 }, nowPlus10s));
    expect(r2.action).toBe("in_progress");
  });

  it("returns action=execute when the lease has expired (reclaim)", async () => {
    const store = new InProcessIdempotencyStore();
    const now = new Date("2026-06-28T00:00:00Z");
    const r1 = await claimIdempotency(store, makeInput("key-1", { x: 1 }, now));
    expect(r1.record.attemptCount).toBe(1);
    const nowPlus60s = new Date(now.getTime() + 60_000);
    const r2 = await claimIdempotency(store, makeInput("key-1", { x: 1 }, nowPlus60s));
    expect(r2.action).toBe("execute");
    expect(r2.record.attemptCount).toBe(2);
  });

  it("heartbeat refreshes the lease", async () => {
    const store = new InProcessIdempotencyStore();
    const now = new Date("2026-06-28T00:00:00Z");
    const r1 = await claimIdempotency(store, makeInput("key-1", { x: 1 }, now));
    const nowPlus20s = new Date(now.getTime() + 20_000);
    await heartbeatIdempotency(store, r1.record.id, nowPlus20s);
    const nowPlus25s = new Date(now.getTime() + 25_000);
    const r2 = await claimIdempotency(store, makeInput("key-1", { x: 1 }, nowPlus25s));
    expect(r2.action).toBe("in_progress");
  });
});

describe("claimIdempotency — retryable_failed re-executes", () => {
  it("returns action=execute when prior state was retryable_failed", async () => {
    const store = new InProcessIdempotencyStore();
    const now = new Date("2026-06-28T00:00:00Z");
    const r1 = await claimIdempotency(store, makeInput("key-1", { x: 1 }, now));
    await markRetryableFailed(store, r1.record.id, { lastErrorClass: "DB_TIMEOUT" });
    const r2 = await claimIdempotency(store, makeInput("key-1", { x: 1 }, now));
    expect(r2.action).toBe("execute");
    expect(r2.record.attemptCount).toBe(2);
  });
});

describe("claimIdempotency — business_failed does NOT re-execute", () => {
  it("returns action=replay when prior state was business_failed", async () => {
    const store = new InProcessIdempotencyStore();
    const r1 = await claimIdempotency(store, makeInput("key-1", { x: 1 }));
    await markBusinessFailed(store, r1.record.id, { responseCode: 409, responseBody: { error: "STOCK_INSUFFICIENT" }, lastErrorClass: "STOCK_INSUFFICIENT" });
    const r2 = await claimIdempotency(store, makeInput("key-1", { x: 1 }));
    expect(r2.action).toBe("replay");
  });
});

describe("claimIdempotency — no indefinite OPERATION_IN_PROGRESS deadlock", () => {
  it("expired lease is always reclaimable", async () => {
    const store = new InProcessIdempotencyStore();
    const now = new Date("2026-06-28T00:00:00Z");
    await claimIdempotency(store, makeInput("key-1", { x: 1 }, now));
    const oneHourLater = new Date(now.getTime() + 3_600_000);
    const r2 = await claimIdempotency(store, makeInput("key-1", { x: 1 }, oneHourLater));
    expect(r2.action).toBe("execute");
  });

  it("multiple retries after expiry all succeed", async () => {
    const store = new InProcessIdempotencyStore();
    const now = new Date("2026-06-28T00:00:00Z");
    const r1 = await claimIdempotency(store, makeInput("key-1", { x: 1 }, now));
    await markRetryableFailed(store, r1.record.id, { lastErrorClass: "TIMEOUT" });
    const r2 = await claimIdempotency(store, makeInput("key-1", { x: 1 }, now));
    await markRetryableFailed(store, r1.record.id, { lastErrorClass: "TIMEOUT" });
    const r3 = await claimIdempotency(store, makeInput("key-1", { x: 1 }, now));
    expect(r2.action).toBe("execute");
    expect(r3.action).toBe("execute");
    expect(r3.record.attemptCount).toBe(3);
  });
});

describe("claimIdempotency — tenant/scope isolation", () => {
  it("same key in different tenants creates separate records", async () => {
    const store = new InProcessIdempotencyStore();
    const r1 = await claimIdempotency(store, { ...makeInput("key-1", { x: 1 }), tenantId: "tenant-A" });
    const r2 = await claimIdempotency(store, { ...makeInput("key-1", { x: 1 }), tenantId: "tenant-B" });
    expect(r1.record.id).not.toBe(r2.record.id);
    expect(store.getAllRecords().length).toBe(2);
  });

  it("same key in different operation scopes creates separate records", async () => {
    const store = new InProcessIdempotencyStore();
    const r1 = await claimIdempotency(store, { ...makeInput("key-1", { x: 1 }), operationScope: "sales.approve" });
    const r2 = await claimIdempotency(store, { ...makeInput("key-1", { x: 1 }), operationScope: "inventory.transfer" });
    expect(r1.record.id).not.toBe(r2.record.id);
    expect(store.getAllRecords().length).toBe(2);
  });
});

describe("markSucceeded / markBusinessFailed / markRetryableFailed", () => {
  it("markSucceeded sets state, responseCode, responseBody, completedAt", async () => {
    const store = new InProcessIdempotencyStore();
    const r1 = await claimIdempotency(store, makeInput("key-1", { x: 1 }));
    const now = new Date("2026-06-28T00:01:00Z");
    await markSucceeded(store, r1.record.id, { responseCode: 200, responseBody: { ok: true }, entityType: "sales_order", entityId: "so-1" }, now);
    const record = store.getRecord(r1.record.id)!;
    expect(record.state).toBe("succeeded");
    expect(record.responseCode).toBe(200);
    expect(record.entityType).toBe("sales_order");
    expect(record.completedAt).toEqual(now);
  });

  it("markBusinessFailed sets state and lastErrorClass", async () => {
    const store = new InProcessIdempotencyStore();
    const r1 = await claimIdempotency(store, makeInput("key-1", { x: 1 }));
    await markBusinessFailed(store, r1.record.id, { responseCode: 409, responseBody: { error: "STOCK_INSUFFICIENT" }, lastErrorClass: "STOCK_INSUFFICIENT" });
    expect(store.getRecord(r1.record.id)!.state).toBe("business_failed");
    expect(store.getRecord(r1.record.id)!.lastErrorClass).toBe("STOCK_INSUFFICIENT");
  });

  it("markRetryableFailed sets state and lastErrorClass", async () => {
    const store = new InProcessIdempotencyStore();
    const r1 = await claimIdempotency(store, makeInput("key-1", { x: 1 }));
    await markRetryableFailed(store, r1.record.id, { lastErrorClass: "DB_TIMEOUT" });
    expect(store.getRecord(r1.record.id)!.state).toBe("retryable_failed");
    expect(store.getRecord(r1.record.id)!.lastErrorClass).toBe("DB_TIMEOUT");
  });
});
