/**
 * WP-00-02 package gate tests — environment validation.
 *
 * Contract: docs/contracts/13_work_packages.md WP-00-02 Tests:
 *   "Clean install/build/typecheck; retain the documented `unavailable`
 *    Docker/local-Supabase result; unsafe/missing env rejection; legacy
 *    key-name rejection; no secrets in client bundle/log. Do not perform
 *    hosted connectivity, health checks, remote migrations, schema
 *    application, Auth/Storage integration, or remote data mutation in
 *    WP-00-02."
 *
 * These tests cover:
 *   1. Missing required env vars → ok=false with descriptive errors.
 *   2. Present-but-invalid values (bad URL, bad project ref) → ok=false.
 *   3. Legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` present → error.
 *   4. Legacy `SUPABASE_SERVICE_ROLE_KEY` present → error.
 *   5. All five DEC-057 vars valid → ok=true, env returned.
 *   6. `DATABASE_URL` containing `prepare=true` → rejected.
 *   7. Publishable key === secret key → rejected.
 *   8. No mutation of `process.env`.
 */

import { describe, it, expect } from "vitest";
import {
  parseEnv,
  DEC_057_VAR_NAMES,
  LEGACY_FORBIDDEN_VAR_NAMES,
} from "../env";

const VALID = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghij.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.publishable.test.key",
  SUPABASE_SECRET_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret.test.key.different.from.publishable",
  DATABASE_URL: "postgresql://postgres:password@db.abcdefghij.supabase.co:6543/postgres",
  SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
} as const;

describe("DEC_057_VAR_NAMES", () => {
  it("contains exactly the five DEC-057 names in the contracted order", () => {
    expect([...DEC_057_VAR_NAMES]).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SECRET_KEY",
      "DATABASE_URL",
      "SUPABASE_PROJECT_REF",
    ]);
  });

  it("does NOT contain DATABASE_MIGRATION_URL in WP-00-02", () => {
    expect(DEC_057_VAR_NAMES).not.toContain("DATABASE_MIGRATION_URL");
  });
});

describe("LEGACY_FORBIDDEN_VAR_NAMES", () => {
  it("contains the two DEC-057 forbidden legacy names", () => {
    expect([...LEGACY_FORBIDDEN_VAR_NAMES]).toEqual([
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
    ]);
  });
});

describe("parseEnv — missing env", () => {
  it("rejects when all five DEC-057 vars are missing", () => {
    const result = parseEnv({});
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.includes("NEXT_PUBLIC_SUPABASE_URL"))).toBe(true);
    expect(result.errors.some((e) => e.includes("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"))).toBe(true);
    expect(result.errors.some((e) => e.includes("SUPABASE_SECRET_KEY"))).toBe(true);
    expect(result.errors.some((e) => e.includes("DATABASE_URL"))).toBe(true);
    expect(result.errors.some((e) => e.includes("SUPABASE_PROJECT_REF"))).toBe(true);
  });

  it("rejects when only some vars are present", () => {
    const result = parseEnv({
      NEXT_PUBLIC_SUPABASE_URL: VALID.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_PROJECT_REF: VALID.SUPABASE_PROJECT_REF,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"))).toBe(true);
    expect(result.errors.some((e) => e.includes("SUPABASE_SECRET_KEY"))).toBe(true);
    expect(result.errors.some((e) => e.includes("DATABASE_URL"))).toBe(true);
  });
});

describe("parseEnv — invalid values", () => {
  it("rejects bad NEXT_PUBLIC_SUPABASE_URL", () => {
    const result = parseEnv({ ...VALID, NEXT_PUBLIC_SUPABASE_URL: "not-a-url" });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("NEXT_PUBLIC_SUPABASE_URL"))).toBe(true);
  });

  it("rejects bad SUPABASE_PROJECT_REF (wrong length)", () => {
    const result = parseEnv({ ...VALID, SUPABASE_PROJECT_REF: "too-short" });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("SUPABASE_PROJECT_REF"))).toBe(true);
  });

  it("rejects SUPABASE_PROJECT_REF with non-alphanumeric chars", () => {
    const result = parseEnv({ ...VALID, SUPABASE_PROJECT_REF: "abcdefghij!klmnopqrst" });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("SUPABASE_PROJECT_REF"))).toBe(true);
  });
});

describe("parseEnv — legacy key rejection (DEC-057)", () => {
  it("rejects NEXT_PUBLIC_SUPABASE_ANON_KEY even if otherwise valid", () => {
    const result = parseEnv({
      ...VALID,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "legacy-anon-key",
    });
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((e) =>
        e.includes("NEXT_PUBLIC_SUPABASE_ANON_KEY") && e.includes("DEC-057"),
      ),
    ).toBe(true);
  });

  it("rejects SUPABASE_SERVICE_ROLE_KEY even if otherwise valid", () => {
    const result = parseEnv({
      ...VALID,
      SUPABASE_SERVICE_ROLE_KEY: "legacy-service-role-key",
    });
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((e) =>
        e.includes("SUPABASE_SERVICE_ROLE_KEY") && e.includes("DEC-057"),
      ),
    ).toBe(true);
  });

  it("rejects both legacy names simultaneously", () => {
    const result = parseEnv({
      ...VALID,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("NEXT_PUBLIC_SUPABASE_ANON_KEY"))).toBe(true);
    expect(result.errors.some((e) => e.includes("SUPABASE_SERVICE_ROLE_KEY"))).toBe(true);
  });
});

describe("parseEnv — prepare:false boundary", () => {
  it("rejects DATABASE_URL containing prepare=true", () => {
    const result = parseEnv({
      ...VALID,
      DATABASE_URL:
        "postgresql://postgres:password@db.abcdefghij.supabase.co:6543/postgres?prepare=true",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("prepare"))).toBe(true);
  });

  it("accepts DATABASE_URL without prepare=true", () => {
    const result = parseEnv({
      ...VALID,
      DATABASE_URL:
        "postgresql://postgres:password@db.abcdefghij.supabase.co:6543/postgres?prepare=false",
    });
    expect(result.ok).toBe(true);
  });
});

describe("parseEnv — publishable vs secret key defense-in-depth", () => {
  it("rejects when publishable key === secret key", () => {
    const sameKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.same-key-for-both-roles";
    const result = parseEnv({
      ...VALID,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: sameKey,
      SUPABASE_SECRET_KEY: sameKey,
    });
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((e) =>
        e.includes("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") &&
        e.includes("SUPABASE_SECRET_KEY"),
      ),
    ).toBe(true);
  });
});

describe("parseEnv — happy path", () => {
  it("returns ok=true and the parsed env when all five DEC-057 vars are valid", () => {
    const result = parseEnv({ ...VALID });
    expect(result.ok).toBe(true);
    expect(result.env).toBeDefined();
    expect(result.env?.NEXT_PUBLIC_SUPABASE_URL).toBe(VALID.NEXT_PUBLIC_SUPABASE_URL);
    expect(result.env?.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).toBe(VALID.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
    expect(result.env?.SUPABASE_SECRET_KEY).toBe(VALID.SUPABASE_SECRET_KEY);
    expect(result.env?.DATABASE_URL).toBe(VALID.DATABASE_URL);
    expect(result.env?.SUPABASE_PROJECT_REF).toBe(VALID.SUPABASE_PROJECT_REF);
    expect(result.errors).toEqual([]);
  });
});

describe("parseEnv — no mutation of process.env", () => {
  it("does not write back to the source record", () => {
    const source: Record<string, string | undefined> = { ...VALID };
    parseEnv(source);
    // Source should be unchanged.
    expect(source).toEqual({ ...VALID });
  });
});
