/**
 * WP-00-03A package gate tests — document sequence allocation concurrency.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §7.5
 *   document_sequences allocation protocol:
 *     BEGIN TRANSACTION
 *     SELECT document_sequences row FOR UPDATE
 *     increment last_number
 *     generate doc_no
 *     commit with business transaction
 *
 * Contract: docs/contracts/13_work_packages.md WP-00-03A Tests:
 *   "sequence concurrency"
 *
 * Docker is unavailable in the GLM sandbox. No live database is connected
 * in WP-00-03A. This test simulates the `SELECT FOR UPDATE + increment +
 * commit` protocol in-process using a single-threaded event loop and
 * verifies that:
 *
 *   1. Sequential allocation produces 1, 2, 3, ... without gaps or
 *      duplicates.
 *   2. Concurrent allocation requests (interleaved via async yields) all
 *      receive unique numbers when the lock is honored.
 *   3. A failed transaction (simulated throw after allocation but before
 *      commit) does NOT consume a number — the next allocation gets the
 *      same number the failed one would have gotten.
 *
 * The real DB-level test (actual `SELECT FOR UPDATE` on the
 * document_sequences table under concurrent transactions) is BLOCKED and
 * documented in schema.test.ts.
 */

import { describe, it, expect } from "vitest";

/**
 * In-process simulation of the document_sequences allocation protocol.
 *
 * Mirrors the contract's BEGIN → SELECT FOR UPDATE → increment → commit
 * pattern using a JS mutex (promise chain) so that interleaved async
 * callers cannot race on `lastNumber`.
 */
class InProcessSequenceAllocator {
  private lastNumber: number;
  private prefix: string;
  private year: number;
  private lock: Promise<unknown> = Promise.resolve();

  constructor(prefix: string, year: number, startingLastNumber = 0) {
    this.prefix = prefix;
    this.year = year;
    this.lastNumber = startingLastNumber;
  }

  /**
   * Allocate the next document number under the contract's lock protocol.
   *
   * If `simulateFailureAfterAlloc` is true, the function throws AFTER
   * incrementing but BEFORE committing — and rolls back the increment so
   * the next caller gets the same number.
   */
  async allocateNext(simulateFailureAfterAlloc = false): Promise<string> {
    // Acquire lock (single-writer queue).
    let release!: () => void;
    const acquired = new Promise<unknown>((resolve) => {
      release = () => resolve(undefined);
    });
    const previousLock = this.lock;
    this.lock = acquired;
    await previousLock;

    try {
      // SELECT FOR UPDATE → increment
      const nextNumber = this.lastNumber + 1;
      // Yield to event loop to simulate concurrent interleaving.
      await Promise.resolve();

      if (simulateFailureAfterAlloc) {
        // ROLLBACK: do not persist the increment.
        throw new Error("Simulated transaction failure after allocation");
      }

      // COMMIT: persist the increment.
      this.lastNumber = nextNumber;
      const padded = nextNumber.toString().padStart(6, "0");
      return `${this.prefix}-${this.year}-${padded}`;
    } finally {
      release();
    }
  }

  /** Read-only peek at the current last_number (no lock). */
  peekLastNumber(): number {
    return this.lastNumber;
  }
}

describe("WP-00-03A document sequence allocation (in-process simulation)", () => {
  it("sequential allocation produces 1, 2, 3, 4, 5 without gaps", async () => {
    const allocator = new InProcessSequenceAllocator("RC", 2026);
    const results: string[] = [];
    for (let i = 0; i < 5; i++) {
      results.push(await allocator.allocateNext());
    }
    expect(results).toEqual([
      "RC-2026-000001",
      "RC-2026-000002",
      "RC-2026-000003",
      "RC-2026-000004",
      "RC-2026-000005",
    ]);
    expect(allocator.peekLastNumber()).toBe(5);
  });

  it("concurrent allocation produces unique numbers with no duplicates", async () => {
    const allocator = new InProcessSequenceAllocator("TR", 2026);
    // Fire 50 concurrent allocation requests.
    const promises = Array.from({ length: 50 }, () => allocator.allocateNext());
    const results = await Promise.all(promises);
    const unique = new Set(results);
    expect(unique.size).toBe(50);
    expect(allocator.peekLastNumber()).toBe(50);
  });

  it("a failed transaction does NOT consume a number (rollback works)", async () => {
    const allocator = new InProcessSequenceAllocator("SA", 2026);
    // First allocation succeeds → 1.
    const r1 = await allocator.allocateNext();
    expect(r1).toBe("SA-2026-000001");
    // Second allocation fails after alloc → rolls back, no number consumed.
    await expect(allocator.allocateNext(true)).rejects.toThrow(
      "Simulated transaction failure",
    );
    // Third allocation should get 2, not 3.
    const r3 = await allocator.allocateNext();
    expect(r3).toBe("SA-2026-000002");
    expect(allocator.peekLastNumber()).toBe(2);
  });

  it("concurrent allocation under partial failures: every committed number is unique", async () => {
    const allocator = new InProcessSequenceAllocator("PR", 2026);
    // 20 succeed, 10 fail (interleaved), then 20 more succeed.
    const batch1 = Array.from({ length: 20 }, () => allocator.allocateNext());
    const batch2 = Array.from({ length: 10 }, () =>
      allocator.allocateNext(true).catch(() => "FAILED"),
    );
    const batch3 = Array.from({ length: 20 }, () => allocator.allocateNext());

    const [r1, r2, r3] = await Promise.all([
      Promise.all(batch1),
      Promise.all(batch2),
      Promise.all(batch3),
    ]);

    // All batch1 results are unique numbers.
    const successful = [...r1, ...r3];
    const unique = new Set(successful);
    expect(unique.size).toBe(successful.length);

    // All batch2 results are "FAILED" strings.
    expect(r2.every((r) => r === "FAILED")).toBe(true);

    // The allocator's last_number is exactly 40 (20 + 20 committed, 10 rolled back).
    expect(allocator.peekLastNumber()).toBe(40);
  });
});
