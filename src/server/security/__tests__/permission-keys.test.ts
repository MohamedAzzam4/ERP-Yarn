/**
 * WP-01-02 tests — permission key constants and taxonomy.
 *
 * Contract: docs/contracts/11_permission_matrix.md §6, §12.
 */
import { describe, it, expect } from "vitest";
import {
  PERMISSION_KEYS,
  PERMISSION_KEY_SET,
  PERMISSION_ACTION_CODES,
  PERMISSION_MODULES,
  isPermissionKey,
  assertPermissionKey,
  parsePermissionKey,
  actionCodeForKey,
  PERMISSION_MANAGEMENT_KEYS,
  FINANCIAL_PERMISSION_KEYS,
  APPROVAL_AUTHORITY_KEYS,
} from "../permission-keys";
import { WORKER_DENIED_PERMISSION_KEYS } from "../worker-financial-deny";

describe("PERMISSION_KEYS", () => {
  it("contains at least the 50 keys from Contract 11 §12", () => {
    expect(PERMISSION_KEYS.length).toBeGreaterThanOrEqual(50);
  });

  it("includes the WP-02-01 master_data permission keys", () => {
    expect(PERMISSION_KEYS).toContain("master_data.view");
    expect(PERMISSION_KEYS).toContain("master_data.view_names");
    expect(PERMISSION_KEYS).toContain("master_data.create");
    expect(PERMISSION_KEYS).toContain("master_data.update");
    expect(PERMISSION_KEYS).toContain("master_data.inactivate");
  });

  it("includes master_data in PERMISSION_MODULES", () => {
    expect(PERMISSION_MODULES).toContain("master_data");
  });

  it("actionCodeForKey maps master_data keys correctly", () => {
    expect(actionCodeForKey("master_data.view")).toBe("V");
    expect(actionCodeForKey("master_data.view_names")).toBe("V");
    expect(actionCodeForKey("master_data.create")).toBe("C");
    expect(actionCodeForKey("master_data.update")).toBe("U");
    expect(actionCodeForKey("master_data.inactivate")).toBe("U");
  });

  it("includes the exact keys from Contract 11 §12", () => {
    const expectedKeys = [
      "users.view_limited",
      "users.manage",
      "permissions.manage",
      "settings.view_restricted",
      "settings.manage",
      "inventory.view_quantity",
      "inventory.receive.create",
      "inventory.receive.approve",
      "inventory.transfer.create",
      "inventory.transfer.approve",
      "inventory.adjustment.request",
      "inventory.adjustment.approve",
      "inventory.reverse",
      "inventory.request_correction",
      "inventory.correct",
      "sales.create",
      "sales.submit",
      "sales.approve",
      "sales.cancel",
      "sales.reverse",
      "sales.view_price",
      "sales.request_correction",
      "sales.correct",
      "production.create",
      "production.issue_draft.create",
      "production.issue_draft.submit",
      "production.issue.approve",
      "production.receive_draft",
      "production.approve",
      "production.return_from_wip.request",
      "production.return_from_wip.approve",
      "production.view_cost",
      "production.request_correction",
      "production.correct",
      "payments.create",
      "payments.approve",
      "payments.reverse",
      "balances.view_customer",
      "balances.view_supplier_factory",
      "direct_costs.review",
      "quality_tests.create",
      "quality_risk_sales.approve",
      "complaints.investigate",
      "returns.create",
      "returns.approve",
      "returns.request_correction",
      "returns.correct",
      "profitability.view",
      "audit.view",
      "migration.prepare",
      "migration.review",
      "migration.approve",
      "migration.commit",
      "backup.view",
      "backup.run",
      "backup.restore_test",
      "exports.internal",
    ];
    for (const key of expectedKeys) {
      expect(PERMISSION_KEY_SET.has(key), `expected '${key}' in PERMISSION_KEY_SET`).toBe(true);
    }
  });

  it("contains no duplicate keys", () => {
    const seen = new Set<string>();
    for (const key of PERMISSION_KEYS) {
      expect(seen.has(key), `duplicate permission key: ${key}`).toBe(false);
      seen.add(key);
    }
  });
});

describe("isPermissionKey / assertPermissionKey", () => {
  it("returns true for valid keys", () => {
    expect(isPermissionKey("users.manage")).toBe(true);
    expect(isPermissionKey("exports.internal")).toBe(true);
  });

  it("returns false for unknown keys", () => {
    expect(isPermissionKey("users.delete")).toBe(false);
    expect(isPermissionKey("admin.all")).toBe(false);
    expect(isPermissionKey("")).toBe(false);
  });

  it("assertPermissionKey throws for unknown keys", () => {
    expect(() => assertPermissionKey("admin.superuser")).toThrow(/Unknown permission key/);
  });

  it("assertPermissionKey does not throw for valid keys", () => {
    expect(() => assertPermissionKey("users.manage")).not.toThrow();
  });
});

describe("parsePermissionKey", () => {
  it("parses simple '<module>.<action>' keys", () => {
    expect(parsePermissionKey("users.manage")).toEqual({
      module: "users",
      action: "manage",
    });
  });

  it("parses multi-segment keys (module is first segment, action is rest)", () => {
    expect(parsePermissionKey("production.issue_draft.create")).toEqual({
      module: "production",
      action: "issue_draft.create",
    });
    expect(parsePermissionKey("production.return_from_wip.request")).toEqual({
      module: "production",
      action: "return_from_wip.request",
    });
  });

  it("throws for keys without a dot", () => {
    expect(() => parsePermissionKey("invalid")).toThrow(/Invalid permission key/);
  });

  it("throws for keys with unknown module", () => {
    expect(() => parsePermissionKey("unknownmodule.action")).toThrow(/unknown module/);
  });
});

describe("actionCodeForKey", () => {
  it("returns V for view-family actions", () => {
    expect(actionCodeForKey("inventory.view_quantity")).toBe("V");
    expect(actionCodeForKey("users.view_limited")).toBe("V");
    expect(actionCodeForKey("settings.view_restricted")).toBe("V");
    expect(actionCodeForKey("complaints.investigate")).toBe("V");
  });

  it("returns P for view_price", () => {
    expect(actionCodeForKey("sales.view_price")).toBe("P");
  });

  it("returns K for view_cost", () => {
    expect(actionCodeForKey("production.view_cost")).toBe("K");
  });

  it("returns C for create and request_correction", () => {
    expect(actionCodeForKey("inventory.receive.create")).toBe("C");
    expect(actionCodeForKey("inventory.request_correction")).toBe("C");
  });

  it("returns S for submit", () => {
    expect(actionCodeForKey("sales.submit")).toBe("S");
    expect(actionCodeForKey("production.issue_draft.submit")).toBe("S");
  });

  it("returns A for approve and review", () => {
    expect(actionCodeForKey("inventory.receive.approve")).toBe("A");
    expect(actionCodeForKey("direct_costs.review")).toBe("A");
    expect(actionCodeForKey("migration.commit")).toBe("A");
  });

  it("returns X for cancel", () => {
    expect(actionCodeForKey("sales.cancel")).toBe("X");
  });

  it("returns R for reverse and correct", () => {
    expect(actionCodeForKey("inventory.reverse")).toBe("R");
    expect(actionCodeForKey("inventory.correct")).toBe("R");
    expect(actionCodeForKey("sales.correct")).toBe("R");
  });

  it("returns M for manage, run, restore_test, migration.prepare, migration.review", () => {
    expect(actionCodeForKey("users.manage")).toBe("M");
    expect(actionCodeForKey("settings.manage")).toBe("M");
    expect(actionCodeForKey("backup.run")).toBe("M");
    expect(actionCodeForKey("backup.restore_test")).toBe("M");
    expect(actionCodeForKey("migration.prepare")).toBe("M");
    expect(actionCodeForKey("migration.review")).toBe("M");
  });

  it("returns E for exports.internal", () => {
    expect(actionCodeForKey("exports.internal")).toBe("E");
  });

  it("returns F for profitability.view", () => {
    expect(actionCodeForKey("profitability.view")).toBe("F");
  });

  it("returns L for audit.view", () => {
    expect(actionCodeForKey("audit.view")).toBe("L");
  });
});

describe("PERMISSION_MANAGEMENT_KEYS", () => {
  it("contains users.manage and permissions.manage", () => {
    expect(PERMISSION_MANAGEMENT_KEYS.has("users.manage")).toBe(true);
    expect(PERMISSION_MANAGEMENT_KEYS.has("permissions.manage")).toBe(true);
    expect(PERMISSION_MANAGEMENT_KEYS.has("users.view_limited")).toBe(true);
  });

  it("is a subset of PERMISSION_KEY_SET", () => {
    for (const key of PERMISSION_MANAGEMENT_KEYS) {
      expect(PERMISSION_KEY_SET.has(key)).toBe(true);
    }
  });
});

describe("FINANCIAL_PERMISSION_KEYS", () => {
  it("contains sales.view_price, balances.view_customer, profitability.view, etc.", () => {
    expect(FINANCIAL_PERMISSION_KEYS.has("sales.view_price")).toBe(true);
    expect(FINANCIAL_PERMISSION_KEYS.has("production.view_cost")).toBe(true);
    expect(FINANCIAL_PERMISSION_KEYS.has("balances.view_customer")).toBe(true);
    expect(FINANCIAL_PERMISSION_KEYS.has("balances.view_supplier_factory")).toBe(true);
    expect(FINANCIAL_PERMISSION_KEYS.has("direct_costs.review")).toBe(true);
    expect(FINANCIAL_PERMISSION_KEYS.has("payments.create")).toBe(true);
    expect(FINANCIAL_PERMISSION_KEYS.has("profitability.view")).toBe(true);
    expect(FINANCIAL_PERMISSION_KEYS.has("audit.view")).toBe(true);
    expect(FINANCIAL_PERMISSION_KEYS.has("exports.internal")).toBe(true);
  });

  it("is a subset of WORKER_DENIED_PERMISSION_KEYS (every financial key is Worker-denied)", () => {
    for (const key of FINANCIAL_PERMISSION_KEYS) {
      expect(
        WORKER_DENIED_PERMISSION_KEYS.has(key),
        `expected '${key}' to be in WORKER_DENIED_PERMISSION_KEYS (DEC-063)`,
      ).toBe(true);
    }
  });
});

describe("APPROVAL_AUTHORITY_KEYS", () => {
  it("contains inventory.receive.approve, sales.approve, production.approve, etc.", () => {
    expect(APPROVAL_AUTHORITY_KEYS.has("inventory.receive.approve")).toBe(true);
    expect(APPROVAL_AUTHORITY_KEYS.has("inventory.transfer.approve")).toBe(true);
    expect(APPROVAL_AUTHORITY_KEYS.has("sales.approve")).toBe(true);
    expect(APPROVAL_AUTHORITY_KEYS.has("production.approve")).toBe(true);
    expect(APPROVAL_AUTHORITY_KEYS.has("payments.approve")).toBe(true);
    expect(APPROVAL_AUTHORITY_KEYS.has("returns.approve")).toBe(true);
    expect(APPROVAL_AUTHORITY_KEYS.has("migration.approve")).toBe(true);
    expect(APPROVAL_AUTHORITY_KEYS.has("migration.commit")).toBe(true);
  });

  it("does NOT contain create/submit actions (create does not imply approve)", () => {
    expect(APPROVAL_AUTHORITY_KEYS.has("sales.create")).toBe(false);
    expect(APPROVAL_AUTHORITY_KEYS.has("sales.submit")).toBe(false);
    expect(APPROVAL_AUTHORITY_KEYS.has("inventory.receive.create")).toBe(false);
  });

  it("is NOT a subset of WORKER_DENIED_PERMISSION_KEYS (operational approvals are not financial)", () => {
    // DEC-063 covers FINANCIAL denial. Operational approvals like
    // inventory.receive.approve are NOT in WORKER_DENIED_PERMISSION_KEYS
    // because they are not financial permissions — they are operational
    // approval authority. Workers don't have them in the seed matrix
    // (verified in role-fixtures.test.ts), but the DEC-063 ceiling does
    // not need to strip them because the seed never grants them.
    //
    // However, FINANCIAL approvals (payments.approve, migration.approve,
    // migration.commit) ARE in WORKER_DENIED_PERMISSION_KEYS.
    expect(WORKER_DENIED_PERMISSION_KEYS.has("payments.approve")).toBe(true);
    expect(WORKER_DENIED_PERMISSION_KEYS.has("migration.approve")).toBe(true);
    expect(WORKER_DENIED_PERMISSION_KEYS.has("migration.commit")).toBe(true);
    // Operational approvals are NOT in the financial-deny set:
    expect(WORKER_DENIED_PERMISSION_KEYS.has("inventory.receive.approve")).toBe(false);
    expect(WORKER_DENIED_PERMISSION_KEYS.has("sales.approve")).toBe(false);
  });
});

describe("PERMISSION_ACTION_CODES", () => {
  it("contains all 13 action codes from Contract 11 §6", () => {
    expect(PERMISSION_ACTION_CODES).toEqual([
      "V", "C", "U", "S", "A", "X", "R", "E", "P", "K", "F", "L", "M",
    ]);
  });
});

describe("PERMISSION_MODULES", () => {
  it("contains all expected module names", () => {
    expect(PERMISSION_MODULES).toContain("users");
    expect(PERMISSION_MODULES).toContain("permissions");
    expect(PERMISSION_MODULES).toContain("settings");
    expect(PERMISSION_MODULES).toContain("inventory");
    expect(PERMISSION_MODULES).toContain("sales");
    expect(PERMISSION_MODULES).toContain("production");
    expect(PERMISSION_MODULES).toContain("payments");
    expect(PERMISSION_MODULES).toContain("balances");
    expect(PERMISSION_MODULES).toContain("direct_costs");
    expect(PERMISSION_MODULES).toContain("quality_tests");
    expect(PERMISSION_MODULES).toContain("quality_risk_sales");
    expect(PERMISSION_MODULES).toContain("complaints");
    expect(PERMISSION_MODULES).toContain("returns");
    expect(PERMISSION_MODULES).toContain("profitability");
    expect(PERMISSION_MODULES).toContain("audit");
    expect(PERMISSION_MODULES).toContain("migration");
    expect(PERMISSION_MODULES).toContain("backup");
    expect(PERMISSION_MODULES).toContain("exports");
  });

  it("does NOT contain an 'admin' module (no Admin super-role)", () => {
    expect(PERMISSION_MODULES as ReadonlyArray<string>).not.toContain("admin");
  });
});
