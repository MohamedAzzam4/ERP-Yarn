/**
 * FIXTURE — intentionally UNGUARDED vitest test file.
 *
 * Used by wp-08-01f-static-guard-coverage.test.ts to prove the validator
 * rejects a file that contains a DELETE statement but does NOT invoke the
 * shared guard.
 *
 * This file is excluded from vitest's test runner via vitest.config.ts.
 */
import { describe, it, expect } from "vitest";

const T = "cccccccc-0000-4000-8000-000000000052";
let sql: any;

describe("fixture: unguarded vitest file (must be rejected)", () => {
  it("dummy", async () => {
    await sql`DELETE FROM import_batches WHERE tenant_id = ${T}`;
    expect(true).toBe(true);
  });
});
