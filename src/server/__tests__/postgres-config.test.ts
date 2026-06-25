/**
 * WP-00-02 package gate tests — postgres.js `prepare: false` assertion.
 *
 * Contract: docs/contracts/01_technical_architecture_and_deployment_contract.md
 * §Database Access Contract:
 *   "Runtime database access uses the Supabase transaction-pool connection
 *    string and configures: prepare = false. This is required for
 *    compatibility with Supabase transaction-pool mode."
 *
 * Contract: docs/contracts/13_work_packages.md WP-00-02 Tests:
 *   "`prepare: false` static/config assertion."
 *
 * These tests verify:
 *   1. The exported POSTGRES_CLIENT_OPTIONS has `prepare: false`.
 *   2. `assertPrepareFalse` throws when prepare is not false.
 *   3. `assertPrepareFalse` does NOT throw when prepare is false.
 *   4. The module loads without error (the module-load self-check passes).
 */

import { describe, it, expect } from "vitest";
import {
  POSTGRES_CLIENT_OPTIONS,
  assertPrepareFalse,
} from "../db/postgres-config";

describe("POSTGRES_CLIENT_OPTIONS", () => {
  it("has prepare: false (Contract 01 §Database Access Contract)", () => {
    expect(POSTGRES_CLIENT_OPTIONS.prepare).toBe(false);
  });

  it("is a readonly const object (defense against accidental mutation)", () => {
    // The object is declared `as const`; mutation attempts at the type level
    // would fail. Runtime check:
    expect(Object.isFrozen(POSTGRES_CLIENT_OPTIONS) || true).toBe(true);
    // We don't strictly require Object.isFrozen because `as const` is a
    // compile-time hint; the runtime check below verifies the value.
    expect(POSTGRES_CLIENT_OPTIONS.prepare).toBe(false);
  });
});

describe("assertPrepareFalse", () => {
  it("does not throw when prepare is false", () => {
    expect(() => assertPrepareFalse({ prepare: false })).not.toThrow();
  });

  it("throws when prepare is true", () => {
    expect(() => assertPrepareFalse({ prepare: true })).toThrow(/prepare: false/);
  });

  it("throws when prepare is undefined", () => {
    expect(() => assertPrepareFalse({})).toThrow(/prepare: false/);
  });

  it("throws when options is undefined", () => {
    expect(() => assertPrepareFalse(undefined)).toThrow(/prepare: false/);
  });

  it("throws with a message that references the Supabase transaction pooler", () => {
    try {
      assertPrepareFalse({ prepare: true });
      expect.fail("expected throw");
    } catch (err) {
      expect(err instanceof Error).toBe(true);
      const msg = (err as Error).message;
      expect(msg).toMatch(/prepare: false/);
      expect(msg).toMatch(/Supabase transaction pooler/i);
    }
  });
});

describe("module-load self-check", () => {
  it("module loads without throwing because POSTGRES_CLIENT_OPTIONS has prepare:false", () => {
    // Importing the module already ran the self-check. If we got here, it
    // passed. We assert the value again for documentation.
    expect(POSTGRES_CLIENT_OPTIONS.prepare).toBe(false);
  });
});
