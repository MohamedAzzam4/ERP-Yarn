/**
 * FIXTURE — guard called AFTER DELETE.
 *
 * Used by wp-08-01f-static-guard-coverage.test.ts to prove the validator
 * rejects a file where the DELETE statement appears BEFORE the guard
 * invocation (i.e. the guard runs too late).
 *
 * This file is excluded from vitest's test runner via vitest.config.ts.
 */
import { describe, it, expect } from "vitest";
import { assertDestructiveTestDbSafety } from "../destructive-test-guard";

const DATABASE_URL = process.env.DATABASE_URL;
const ALLOW_DESTRUCTIVE = process.env.ERP_ALLOW_DESTRUCTIVE_LOCAL_TEST_DB === "1";
const REQUIRE_PROOF = process.env.ERP_REQUIRE_WP0801F_POSTGRES_PROOF === "1";
const T = "cccccccc-0000-4000-8000-000000000052";

let sql: any;

describe("fixture: guard called after DELETE (must be rejected)", () => {
  it("DELETE runs first (BAD)", async () => {
    // BAD: DELETE happens BEFORE the guard runs.
    await sql`DELETE FROM import_batches WHERE tenant_id = ${T}`;
    expect(true).toBe(true);
  });

  it("then guard runs (too late)", async () => {
    await assertDestructiveTestDbSafety({
      databaseUrl: DATABASE_URL,
      allowDestructive: ALLOW_DESTRUCTIVE,
      requireProof: REQUIRE_PROOF,
      sql,
    });
  });
});
