/**
 * WP-08-01F — PF destructive-path runtime safety test.
 *
 * Proves the PF test's destructive path fails closed for unsafe environments.
 * This is NOT a static regex check — it actually invokes the centralized
 * guard with each unsafe config and verifies the result.
 *
 * Coverage:
 *   - local disposable DB → permitted (kind="ok")
 *   - hosted Supabase URL → refused (kind="fail")
 *   - wrong local DB name → refused (kind="fail")
 *   - destructive opt-in missing → refused (kind="skip" or "fail")
 *   - non-local host → refused (kind="fail")
 *   - non-postgres URL → refused (kind="fail")
 */
import { describe, it, expect } from "vitest";
import { checkDestructiveTestDbSafety } from "./destructive-test-guard";

describe("WP-08-01F — PF destructive-path runtime safety", () => {
  it("local disposable DB with opt-in → permitted", () => {
    const result = checkDestructiveTestDbSafety({
      databaseUrl: "postgres://erp_yarn_user@127.0.0.1:5433/erp_yarn_wp0801f_disposable",
      allowDestructive: true,
      requireProof: true,
    });
    expect(result.kind).toBe("ok");
  });

  it("hosted Supabase URL → refused", () => {
    const result = checkDestructiveTestDbSafety({
      databaseUrl: "postgresql://postgres.supabase.co:6543/postgres",
      allowDestructive: true,
      requireProof: true,
    });
    expect(result.kind).toBe("fail");
    if (result.kind === "fail") {
      expect(result.message).toMatch(/supabase/i);
    }
  });

  it("hosted Supabase pooler URL → refused", () => {
    const result = checkDestructiveTestDbSafety({
      databaseUrl: "postgresql://postgres.aws-0.pooler.supabase.com:6543/postgres",
      allowDestructive: true,
      requireProof: true,
    });
    expect(result.kind).toBe("fail");
  });

  it("wrong local DB name → refused", () => {
    const result = checkDestructiveTestDbSafety({
      databaseUrl: "postgres://erp_yarn_user@127.0.0.1:5433/erp_yarn_production",
      allowDestructive: true,
      requireProof: true,
    });
    expect(result.kind).toBe("fail");
    if (result.kind === "fail") {
      expect(result.message).toMatch(/not.*erp_yarn_wp0801f_disposable/i);
    }
  });

  it("destructive opt-in missing with requireProof → refused (fail)", () => {
    const result = checkDestructiveTestDbSafety({
      databaseUrl: "postgres://erp_yarn_user@127.0.0.1:5433/erp_yarn_wp0801f_disposable",
      allowDestructive: false,
      requireProof: true,
    });
    expect(result.kind).toBe("fail");
  });

  it("destructive opt-in missing without requireProof → skip", () => {
    const result = checkDestructiveTestDbSafety({
      databaseUrl: "postgres://erp_yarn_user@127.0.0.1:5433/erp_yarn_wp0801f_disposable",
      allowDestructive: false,
      requireProof: false,
    });
    expect(result.kind).toBe("skip");
  });

  it("non-local host → refused", () => {
    const result = checkDestructiveTestDbSafety({
      databaseUrl: "postgres://erp_yarn_user@10.0.0.5:5433/erp_yarn_wp0801f_disposable",
      allowDestructive: true,
      requireProof: true,
    });
    expect(result.kind).toBe("fail");
    if (result.kind === "fail") {
      expect(result.message).toMatch(/not.*localhost|non-local/i);
    }
  });

  it("non-postgres URL → refused", () => {
    const result = checkDestructiveTestDbSafety({
      databaseUrl: "file:/home/z/my-project/db/custom.db",
      allowDestructive: true,
      requireProof: true,
    });
    expect(result.kind).toBe("fail");
  });

  it("DATABASE_URL absent with requireProof → refused (fail)", () => {
    const result = checkDestructiveTestDbSafety({
      databaseUrl: undefined,
      allowDestructive: true,
      requireProof: true,
    });
    expect(result.kind).toBe("fail");
  });

  it("DATABASE_URL absent without requireProof → skip", () => {
    const result = checkDestructiveTestDbSafety({
      databaseUrl: undefined,
      allowDestructive: false,
      requireProof: false,
    });
    expect(result.kind).toBe("skip");
  });

  it("all allowed hosts are the only accepted local hosts", () => {
    // Verify the guard's host allowlist accepts localhost, 127.0.0.1, and [::1].
    // (Bare ::1 is invalid URL syntax and is not tested as a URL host.)
    const validLocalHosts = ["localhost", "127.0.0.1", "[::1]"];
    for (const host of validLocalHosts) {
      const result = checkDestructiveTestDbSafety({
        databaseUrl: `postgres://erp_yarn_user@${host}:5433/erp_yarn_wp0801f_disposable`,
        allowDestructive: true,
        requireProof: true,
      });
      expect(result.kind).toBe("ok");
    }
  });
});
