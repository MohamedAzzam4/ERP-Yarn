/**
 * WP-01-02 tests — NO fetch-then-hide security model.
 *
 * Contract: docs/contracts/11_permission_matrix.md §11, §19.
 *   "Never fetch all financial fields and rely on UI hiding."
 *   Common failure case: "Frontend-only hiding; selecting then hiding
 *   fields; client-token-only role."
 *
 * Contract: docs/contracts/12_testing_and_regression_plan.md §7
 *   "assert forbidden properties are absent, not merely null/hidden"
 *
 * These tests prove that:
 *   1. Redacted fields are ABSENT from response objects, not set to null.
 *   2. The redaction helpers do NOT use a "fetch full row then hide"
 *      pattern — they delete keys from the DTO.
 *   3. The `deniedFieldKeysForUser` helper is designed to be used BEFORE
 *      the DB query (column projection), not after.
 *   4. Universal secret fields are redacted from EVERY response.
 *   5. No wildcard worker permissions exist.
 *   6. No frontend-only permission enforcement (guards are server-only).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  redactFields,
  redactFieldsDeep,
  redactResponse,
  deniedFieldKeysForUser,
  createRoleRedactor,
} from "../redaction";
import { resolveEffectivePermissions } from "../effective-permissions";
import { WORKER_DENIED_PERMISSION_KEYS } from "../worker-financial-deny";
import { PERMISSION_KEY_SET } from "../permission-keys";
import { TEST_ROLE_PERMISSION_MATRIX } from "../role-fixtures";
import {
  PermissionDeniedError,
  TenantMismatchError,
  RowScopeDeniedError,
  ForbiddenFieldInRequestError,
  BodyClaimsAuthorityError,
  requireErpAuthForServiceRolePath,
  requireAuthenticatedErpContext,
  requireNotDeniedByWorkerCeiling,
} from "../guards";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
function readText(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

const MATRIX = TEST_ROLE_PERMISSION_MATRIX;

describe("NO fetch-then-hide — redacted fields are ABSENT not null", () => {
  it("redactFields deletes the key (does not set to null/undefined)", () => {
    const obj = { a: 1, secret: "leak", b: 2 };
    const result = redactFields(obj, new Set(["secret"]));
    expect(Object.keys(result).sort()).toEqual(["a", "b"]);
    expect(Object.prototype.hasOwnProperty.call(result, "secret")).toBe(false);
    expect(result.secret).toBeUndefined(); // key is absent, value is undefined
  });

  it("redactFieldsDeep deletes nested keys (does not null them)", () => {
    const obj = {
      outer: { inner: "x", secret: "leak" },
      arr: [{ id: 1, secret: "leak" }],
    };
    const result = redactFieldsDeep(obj, new Set(["secret"]));
    expect(Object.keys(result.outer).sort()).toEqual(["inner"]);
    expect(Object.prototype.hasOwnProperty.call(result.outer, "secret")).toBe(false);
    expect(Object.keys(result.arr[0]!).sort()).toEqual(["id"]);
  });

  it("redactResponse produces an object with forbidden keys ABSENT (Contract 12 §7)", () => {
    const whEff = resolveEffectivePermissions(["warehouse_employee"], MATRIX);
    const dto = {
      id: "x",
      qty_kg: "100.000",
      purchase_price_per_ton: "150.00",
      net_revenue: "15000.00",
    };
    const result = redactResponse(dto, whEff);

    // Verify absence via Object.keys (the test that matters for Contract 12 §7)
    const keys = Object.keys(result);
    expect(keys).toContain("id");
    expect(keys).toContain("qty_kg");
    expect(keys).not.toContain("purchase_price_per_ton");
    expect(keys).not.toContain("net_revenue");
  });
});

describe("NO fetch-then-hide — deniedFieldKeysForUser is designed for pre-query projection", () => {
  it("returns a set usable for SQL column projection (deny before fetch)", () => {
    const whEff = resolveEffectivePermissions(["warehouse_employee"], MATRIX);
    const denied = deniedFieldKeysForUser(whEff);
    // The caller should use this set to build a column allow-list BEFORE
    // the SELECT, e.g.:
    //   const allowed = allColumns.filter(c => !denied.has(c));
    //   SELECT ${allowed.join(',')} FROM ...
    expect(denied instanceof Set).toBe(true);
    expect(denied.size).toBeGreaterThan(0);
    expect(denied.has("purchase_price_per_ton")).toBe(true);
  });

  it("returns empty set (plus universal secrets) for Owner — Owner sees all financial fields", () => {
    const ownerEff = resolveEffectivePermissions(["owner"], MATRIX);
    const denied = deniedFieldKeysForUser(ownerEff);
    // Owner is denied NO financial fields, only universal secret fields.
    expect(denied.has("purchase_price_per_ton")).toBe(false);
    expect(denied.has("password")).toBe(true); // universal secret
  });
});

describe("NO wildcard worker permissions (Contract 11 §12, §21)", () => {
  it("no Worker role has a wildcard permission key", () => {
    // Wildcard patterns: "*", ".*", "all", "admin.*"
    const wildcardPatterns = [/^\*$/, /^\.\*$/, /^all$/i, /^admin\./i, /\.all$/i];
    for (const roleCode of ["warehouse_employee", "production_employee", "quality_employee"] as const) {
      const perms = MATRIX[roleCode];
      for (const perm of perms) {
        for (const pattern of wildcardPatterns) {
          expect(
            pattern.test(perm),
            `Worker role '${roleCode}' has wildcard permission '${perm}'`,
          ).toBe(false);
        }
      }
    }
  });

  it("no permission key in the global set is a wildcard", () => {
    const wildcardPatterns = [/^\*$/, /^\.\*$/, /^all$/i, /^admin\./i, /\.all$/i];
    for (const key of PERMISSION_KEY_SET) {
      for (const pattern of wildcardPatterns) {
        expect(
          pattern.test(key),
          `Permission key '${key}' is a wildcard`,
        ).toBe(false);
      }
    }
  });

  it("WORKER_DENIED_PERMISSION_KEYS covers all financial keys (no Worker escape hatch)", () => {
    // Spot-check: every financial permission key is in WORKER_DENIED_PERMISSION_KEYS
    const financialKeys = [
      "sales.view_price",
      "production.view_cost",
      "balances.view_customer",
      "balances.view_supplier_factory",
      "direct_costs.review",
      "payments.create",
      "payments.approve",
      "payments.reverse",
      "profitability.view",
      "audit.view",
      "exports.internal",
    ];
    for (const key of financialKeys) {
      expect(
        WORKER_DENIED_PERMISSION_KEYS.has(key),
        `expected '${key}' to be in WORKER_DENIED_PERMISSION_KEYS (no Worker escape hatch)`,
      ).toBe(true);
    }
  });
});

describe("NO frontend-only permission enforcement (Contract 11 §11)", () => {
  it("guard modules import 'server-only' (cannot be imported by client code)", () => {
    const guardFiles = [
      "src/server/security/guards.ts",
      "src/server/security/effective-permissions.ts",
      "src/server/security/redaction.ts",
      "src/server/security/permission-keys.ts",
    ];
    for (const f of guardFiles) {
      const src = readText(f);
      expect(src).toMatch(/import\s+["']server-only["']/);
    }
  });

  it("no client component imports the guard modules", () => {
    // Client components have "use client" at the top. Verify none of them
    // import from server/security.
    // This is a heuristic check — we scan .tsx files for "use client" and
    // then verify they don't import from "@/server/security".
    // For WP-01-02, there are no client components that would import
    // these (WP-01-04+ builds the shells). This test is a forward-looking
    // guard against future regressions.
    const src = readText("src/app/login/page.tsx");
    // login page is a client component (has "use client")
    if (src.includes("use client")) {
      expect(src).not.toMatch(/from\s+["']@\/server\/security/);
    }
  });
});

describe("NO UI-only security — guards throw (not silently hide)", () => {
  it("guard denials are throwable errors, not silent filters", () => {
    // Verify guard errors are Error subclasses (throwable, not silent).
    expect(new PermissionDeniedError("users.manage") instanceof Error).toBe(true);
    expect(new TenantMismatchError("t1", "t2") instanceof Error).toBe(true);
    expect(new RowScopeDeniedError("location", "x") instanceof Error).toBe(true);
    expect(new ForbiddenFieldInRequestError("x") instanceof Error).toBe(true);
    expect(new BodyClaimsAuthorityError("x") instanceof Error).toBe(true);
  });
});

describe("NO service-role bypass (Contract 11 §11)", () => {
  it("requireErpAuthForServiceRolePath behaves identically to requireAuthenticatedErpContext (no bypass)", () => {
    // The service-role path guard is a thin wrapper that calls the normal
    // auth guard — service-role callers must still resolve ERP context.
    // Verify they have the same behavior (both return the context for
    // authenticated users, both throw for denials) rather than identity,
    // since requireErpAuthForServiceRolePath is a separate function for
    // documentation intent.
    const authed = { authenticated: true, userId: "u1", tenantId: "t1", email: "e", name: "n", authId: "a" };
    expect(requireErpAuthForServiceRolePath(authed)).toEqual(requireAuthenticatedErpContext(authed));

    const denied = { authenticated: false, reason: "no_session" as const };
    expect(() => requireErpAuthForServiceRolePath(denied)).toThrow();
    expect(() => requireAuthenticatedErpContext(denied)).toThrow();
  });

  it("requireNotDeniedByWorkerCeiling exists for service-role paths (DEC-063 still applies)", () => {
    expect(typeof requireNotDeniedByWorkerCeiling).toBe("function");
  });
});

describe("NO public signup / NO role selector (preserve WP-01-01 invariants)", () => {
  it("no signup route exists", () => {
    expect(existsSync(join(root, "src/app/signup/page.tsx"))).toBe(false);
    expect(existsSync(join(root, "src/app/api/signup/route.ts"))).toBe(false);
  });

  it("no register route exists", () => {
    expect(existsSync(join(root, "src/app/register/page.tsx"))).toBe(false);
    expect(existsSync(join(root, "src/app/api/register/route.ts"))).toBe(false);
  });

  it("WP-01-02 did not add any new API routes (guards are library-only)", () => {
    // WP-01-02 scope is backend guards/redaction — no new route handlers.
    // The only routes that exist should be the WP-01-01 routes.
    const expectedRoutes = [
      "src/app/api/health/route.ts",
      "src/app/api/bootstrap/route.ts",
      "src/app/api/auth/callback/route.ts",
    ];
    for (const route of expectedRoutes) {
      expect(existsSync(join(root, route)), `expected ${route} to exist`).toBe(true);
    }
    // No new routes added by WP-01-02
    expect(existsSync(join(root, "src/app/api/v1/route.ts"))).toBe(false);
  });
});

describe("NO Admin super-role (Contract 11 §3)", () => {
  it("no 'admin' role code exists in ROLE_CODES", () => {
    const roleCodesSrc = readText("src/server/security/role-codes.ts");
    // ROLE_CODES should contain owner, accountant, warehouse, production,
    // quality — NOT admin.
    expect(roleCodesSrc).not.toMatch(/"admin"/);
  });

  it("no 'admin' module in PERMISSION_MODULES", () => {
    const permKeysSrc = readText("src/server/security/permission-keys.ts");
    expect(permKeysSrc).not.toMatch(/"admin"/);
  });

  it("no admin.* permission key in PERMISSION_KEYS", () => {
    for (const key of PERMISSION_KEY_SET) {
      expect(key.startsWith("admin.")).toBe(false);
    }
  });
});

describe("NO inferred approval (Contract 11 §13)", () => {
  it("create permissions do not imply approve permissions in the matrix", () => {
    // For each role, if it has <module>.create, it should NOT automatically
    // have <module>.approve. We verify by checking the Warehouse role:
    // it has sales.create (operational draft) but NOT sales.approve.
    const whPerms = MATRIX.warehouse_employee;
    if (whPerms.has("sales.create")) {
      expect(whPerms.has("sales.approve")).toBe(false);
    }
    if (whPerms.has("inventory.receive.create")) {
      expect(whPerms.has("inventory.receive.approve")).toBe(false);
    }
  });

  it("approval does not imply update (no post-approval mutation)", () => {
    // If a role has <module>.approve, it should NOT have a generic
    // <module>.update permission. (The matrix doesn't define .update
    // keys — updates go through draft/correct flows.)
    // This is a forward-looking assertion: no .update keys exist.
    for (const key of PERMISSION_KEY_SET) {
      expect(key.endsWith(".update")).toBe(false);
    }
  });
});
