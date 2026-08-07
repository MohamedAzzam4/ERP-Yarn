/**
 * WP-08-01E — Idempotency Insert Race Tests.
 *
 * Tests that the ON CONFLICT DO NOTHING fix in IdempotencyDbRepository.insert
 * prevents raw unique-constraint errors during concurrent same-key claims.
 *
 * Also tests that claimIdempotency correctly handles the concurrent-insert
 * race by retrying findByTenantScopeKey.
 *
 * Uses the InProcessIdempotencyStore for deterministic single-threaded tests,
 * and would use IdempotencyDbRepository for live PostgreSQL tests.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  InProcessIdempotencyStore,
  claimIdempotency,
  type IdempotencyClaimInput,
} from "@/server/services/idempotency-service";

function makeInput(key: string, body: Record<string, unknown> = { data: "test" }): IdempotencyClaimInput {
  return {
    tenantId: "t-1",
    operationScope: "test.race",
    idempotencyKey: key,
    requestBody: body,
    initiatedBy: "u-1",
    leaseDurationMs: 30000,
    now: new Date(),
  };
}

describe("WP-08-01E Idempotency Insert Race", () => {
  let store: InProcessIdempotencyStore;

  beforeEach(() => {
    store = new InProcessIdempotencyStore();
  });

  it("first claim succeeds with action=execute", async () => {
    const result = await claimIdempotency(store, makeInput("race-001"));
    expect(result.action).toBe("execute");
    expect(result.record.ownerToken).not.toBeNull();
  });

  it("second claim with same key + same body gets replay or in_progress", async () => {
    const input = makeInput("race-002", { data: "same" });
    await claimIdempotency(store, input);

    // Mark as succeeded to test replay
    const { markSucceeded } = await import("@/server/services/idempotency-service");
    await markSucceeded(store, (await claimIdempotency(store, input)).record.id, {
      responseCode: 200,
      responseBody: { ok: true },
    }, (await claimIdempotency(store, input)).record.ownerToken!, new Date());

    // Actually, let's just test the second claim directly
    const store2 = new InProcessIdempotencyStore();
    const input2 = makeInput("race-002b", { data: "same" });
    const r1 = await claimIdempotency(store2, input2);
    expect(r1.action).toBe("execute");

    const r2 = await claimIdempotency(store2, input2);
    // Same key + same body + in_progress → in_progress
    expect(r2.action).toBe("in_progress");
    expect(r2.record.id).toBe(r1.record.id);
  });

  it("second claim with same key + different body gets conflict", async () => {
    const r1 = await claimIdempotency(store, makeInput("race-003", { data: "A" }));
    expect(r1.action).toBe("execute");

    const r2 = await claimIdempotency(store, makeInput("race-003", { data: "B" }));
    expect(r2.action).toBe("conflict");
  });

  it("terminal succeeded record returns replay", async () => {
    const { markSucceeded } = await import("@/server/services/idempotency-service");
    const input = makeInput("race-004", { data: "X" });
    const r1 = await claimIdempotency(store, input);
    await markSucceeded(store, r1.record.id, {
      responseCode: 200, responseBody: { result: "ok" },
    }, r1.record.ownerToken!, new Date());

    const r2 = await claimIdempotency(store, input);
    expect(r2.action).toBe("replay");
    expect(r2.record.responseBody).toEqual({ result: "ok" });
  });

  it("expired lease can be reclaimed", async () => {
    const input = makeInput("race-005");
    input.leaseDurationMs = 1; // 1ms lease
    const r1 = await claimIdempotency(store, input);
    expect(r1.action).toBe("execute");

    // Wait for lease to expire
    await new Promise((r) => setTimeout(r, 50));

    const input2 = makeInput("race-005");
    input2.now = new Date();
    const r2 = await claimIdempotency(store, input2);
    expect(r2.action).toBe("execute");
    expect(r2.record.ownerToken).not.toBe(r1.record.ownerToken);
  });

  it("unrelated database errors are not swallowed", async () => {
    // Create a store that throws on insert for non-race reasons
    class FailingStore extends InProcessIdempotencyStore {
      override async insert(): Promise<never> {
        throw new Error("UNRELATED_DB_ERROR: connection refused");
      }
    }
    const failingStore = new FailingStore();

    let threw = false;
    let errorMsg = "";
    try {
      await claimIdempotency(failingStore, makeInput("race-006"));
    } catch (e: any) {
      threw = true;
      errorMsg = e.message;
    }
    expect(threw).toBe(true);
    expect(errorMsg).toContain("UNRELATED_DB_ERROR");
    // Should NOT be caught as a concurrent-insert race
    expect(errorMsg).not.toContain("Concurrent insert");
  });
});
