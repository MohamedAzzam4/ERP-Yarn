/**
 * Tests for the shared destructive-test database safety guard.
 *
 * Proves rejection for:
 * - Supabase transaction pooler
 * - Supabase session pooler
 * - Remote PostgreSQL
 * - Localhost with non-disposable DB name
 * - Missing opt-in flag
 * - Missing disposable marker
 * - SQLite
 * - Malformed URL
 *
 * Proves allowed behavior only for the marked local disposable DB.
 */
import { describe, it, expect } from "vitest";
import {
  checkDestructiveTestDbSafety,
  DestructiveTestSafetyError,
  DISPOSABLE_DB_NAME,
} from "./destructive-test-guard";

describe("Destructive-test database safety guard", () => {
  const baseConfig = {
    allowDestructive: true,
    requireProof: false,
  };

  it("rejects Supabase transaction pooler URL", () => {
    const result = checkDestructiveTestDbSafety({
      ...baseConfig,
      databaseUrl: "postgresql://postgres.ref:pass@aws-0-eu-central-1.pooler.supabase.com:6543/postgres",
    });
    expect(result.kind).toBe("fail");
    // Either the hostname check or the Supabase check catches it
    if (result.kind === "fail") {
      const msg = result.message.toLowerCase();
      expect(msg.includes("non-local") || msg.includes("supabase")).toBe(true);
    }
  });

  it("rejects Supabase session pooler URL", () => {
    const result = checkDestructiveTestDbSafety({
      ...baseConfig,
      databaseUrl: "postgresql://postgres.ref:pass@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
    });
    expect(result.kind).toBe("fail");
    if (result.kind === "fail") {
      const msg = result.message.toLowerCase();
      expect(msg.includes("non-local") || msg.includes("supabase")).toBe(true);
    }
  });

  it("rejects remote PostgreSQL host", () => {
    const result = checkDestructiveTestDbSafety({
      ...baseConfig,
      databaseUrl: "postgresql://user:pass@db.example.com:5432/mydb",
    });
    expect(result.kind).toBe("fail");
    expect(result.kind === "fail" && result.message).toContain("non-local");
  });

  it("rejects localhost with non-disposable DB name", () => {
    const result = checkDestructiveTestDbSafety({
      ...baseConfig,
      databaseUrl: "postgresql://user:pass@localhost:5432/erp_yarn",
    });
    expect(result.kind).toBe("fail");
    expect(result.kind === "fail" && result.message).toContain("not '" + DISPOSABLE_DB_NAME + "'");
  });

  it("rejects missing opt-in flag", () => {
    const result = checkDestructiveTestDbSafety({
      databaseUrl: `postgresql://user:pass@localhost:5433/${DISPOSABLE_DB_NAME}`,
      allowDestructive: false,
      requireProof: false,
    });
    expect(result.kind).toBe("skip");
  });

  it("rejects missing opt-in flag when proof required", () => {
    const result = checkDestructiveTestDbSafety({
      databaseUrl: `postgresql://user:pass@localhost:5433/${DISPOSABLE_DB_NAME}`,
      allowDestructive: false,
      requireProof: true,
    });
    expect(result.kind).toBe("fail");
    expect(result.kind === "fail" && result.message).toContain("ERP_ALLOW_DESTRUCTIVE_LOCAL_TEST_DB");
  });

  it("rejects SQLite URL", () => {
    const result = checkDestructiveTestDbSafety({
      ...baseConfig,
      databaseUrl: "file:/home/user/db/custom.db",
    });
    expect(result.kind).toBe("skip");
  });

  it("rejects SQLite URL when proof required", () => {
    const result = checkDestructiveTestDbSafety({
      databaseUrl: "file:/home/user/db/custom.db",
      allowDestructive: true,
      requireProof: true,
    });
    expect(result.kind).toBe("fail");
    expect(result.kind === "fail" && result.message).toContain("SQLite");
  });

  it("rejects malformed URL", () => {
    const result = checkDestructiveTestDbSafety({
      ...baseConfig,
      databaseUrl: "not-a-url",
    });
    expect(result.kind).toBe("fail");
  });

  it("rejects empty DATABASE_URL when proof required", () => {
    const result = checkDestructiveTestDbSafety({
      databaseUrl: undefined,
      allowDestructive: true,
      requireProof: true,
    });
    expect(result.kind).toBe("fail");
  });

  it("allows correct local disposable DB URL", () => {
    const result = checkDestructiveTestDbSafety({
      ...baseConfig,
      databaseUrl: `postgresql://user:pass@localhost:5433/${DISPOSABLE_DB_NAME}`,
    });
    expect(result.kind).toBe("ok");
  });

  it("allows 127.0.0.1 host", () => {
    const result = checkDestructiveTestDbSafety({
      ...baseConfig,
      databaseUrl: `postgresql://user:pass@127.0.0.1:5433/${DISPOSABLE_DB_NAME}`,
    });
    expect(result.kind).toBe("ok");
  });

  it("allows ::1 host", () => {
    const result = checkDestructiveTestDbSafety({
      ...baseConfig,
      databaseUrl: `postgresql://user:pass@[::1]:5433/${DISPOSABLE_DB_NAME}`,
    });
    expect(result.kind).toBe("ok");
  });

  it("rejects URL containing 'supabase' even if host is localhost", () => {
    const result = checkDestructiveTestDbSafety({
      ...baseConfig,
      databaseUrl: `postgresql://supabase:pass@localhost:5433/${DISPOSABLE_DB_NAME}`,
    });
    expect(result.kind).toBe("fail");
    expect(result.kind === "fail" && result.message).toContain("Supabase");
  });

  it("rejects URL containing 'pooler' even if host is localhost", () => {
    const result = checkDestructiveTestDbSafety({
      ...baseConfig,
      databaseUrl: `postgresql://pooler:pass@localhost:5433/${DISPOSABLE_DB_NAME}`,
    });
    expect(result.kind).toBe("fail");
    expect(result.kind === "fail" && result.message).toContain("Supabase");
  });
});
