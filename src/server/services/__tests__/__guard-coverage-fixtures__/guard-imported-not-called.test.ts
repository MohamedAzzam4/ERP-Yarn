/**
 * FIXTURE — guard IMPORTED but NOT CALLED.
 *
 * Used by wp-08-01f-static-guard-coverage.test.ts to prove the validator
 * rejects a file that imports the guard symbol but never invokes
 * `assertDestructiveTestDbSafety` (or `checkDestructiveTestDbSafety`)
 * before the DELETE statement.
 *
 * This file is excluded from vitest's test runner via vitest.config.ts.
 */
import { describe, it, expect } from "vitest";
import { assertDestructiveTestDbSafety } from "../destructive-test-guard";

const T = "cccccccc-0000-4000-8000-000000000052";
let sql: any;

describe("fixture: guard imported but not called (must be rejected)", () => {
  it("dummy", async () => {
    // The import above is unused — the guard is never called.
    await sql`DELETE FROM import_batches WHERE tenant_id = ${T}`;
    expect(true).toBe(true);
  });
});
