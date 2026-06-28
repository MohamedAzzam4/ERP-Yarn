/**
 * WP-01-02 tests — effective permission resolution (DEC-061 + DEC-063).
 *
 * Contract: docs/02_decision_log_and_scope.md DEC-061, DEC-063.
 * Contract: docs/contracts/11_permission_matrix.md §6.
 */
import { describe, it, expect } from "vitest";
import {
  resolveEffectivePermissions,
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  deniedFieldKeys,
  isFieldDenied,
  type RolePermissionMatrix,
} from "../effective-permissions";
import type { RoleCode } from "../role-codes";
import { WORKER_DENIED_PERMISSION_KEYS, WORKER_DENIED_FIELD_KEYS } from "../worker-financial-deny";
import { TEST_ROLE_PERMISSION_MATRIX, TEST_USER_IDS } from "../role-fixtures";

const MATRIX: RolePermissionMatrix = TEST_ROLE_PERMISSION_MATRIX;

describe("resolveEffectivePermissions — single-role Owner", () => {
  const effective = resolveEffectivePermissions(["owner"], MATRIX);

  it("grants Owner all permissions in the matrix", () => {
    const ownerPerms = MATRIX.owner;
    for (const key of ownerPerms) {
      expect(effective.permissionKeys.has(key), `Owner should have '${key}'`).toBe(true);
    }
  });

  it("does NOT enforce the Worker financial-deny ceiling", () => {
    expect(effective.workerFinancialDeny.enforced).toBe(false);
  });

  it("includes financial permissions (Owner sees financial data)", () => {
    expect(effective.permissionKeys.has("sales.view_price")).toBe(true);
    expect(effective.permissionKeys.has("balances.view_customer")).toBe(true);
    expect(effective.permissionKeys.has("profitability.view")).toBe(true);
    expect(effective.permissionKeys.has("audit.view")).toBe(true);
  });

  it("includes user/permission management (DEC-032)", () => {
    expect(effective.permissionKeys.has("users.manage")).toBe(true);
    expect(effective.permissionKeys.has("permissions.manage")).toBe(true);
  });
});

describe("resolveEffectivePermissions — single-role Accountant", () => {
  const effective = resolveEffectivePermissions(["accountant"], MATRIX);

  it("grants Accountant the permissions in the matrix", () => {
    expect(effective.permissionKeys.has("sales.approve")).toBe(true);
    expect(effective.permissionKeys.has("payments.create")).toBe(true);
    expect(effective.permissionKeys.has("balances.view_customer")).toBe(true);
    expect(effective.permissionKeys.has("audit.view")).toBe(true);
  });

  it("does NOT enforce the Worker financial-deny ceiling", () => {
    expect(effective.workerFinancialDeny.enforced).toBe(false);
  });

  it("does NOT grant user/permission management (DEC-032)", () => {
    expect(effective.permissionKeys.has("users.manage")).toBe(false);
    expect(effective.permissionKeys.has("permissions.manage")).toBe(false);
  });

  it("Accountant cannot escalate privileges through settings (DEC-032)", () => {
    expect(effective.permissionKeys.has("settings.manage")).toBe(false);
  });
});

describe("resolveEffectivePermissions — single-role Warehouse worker", () => {
  const effective = resolveEffectivePermissions(["warehouse_employee"], MATRIX);

  it("enforces the Worker financial-deny ceiling (DEC-063)", () => {
    expect(effective.workerFinancialDeny.enforced).toBe(true);
  });

  it("grants operational permissions (inventory.receive.create, etc.)", () => {
    expect(effective.permissionKeys.has("inventory.view_quantity")).toBe(true);
    expect(effective.permissionKeys.has("inventory.receive.create")).toBe(true);
    expect(effective.permissionKeys.has("inventory.transfer.create")).toBe(true);
    expect(effective.permissionKeys.has("returns.create")).toBe(true);
  });

  it("denies ALL financial permissions (DEC-063)", () => {
    for (const key of WORKER_DENIED_PERMISSION_KEYS) {
      expect(
        effective.permissionKeys.has(key),
        `Warehouse must NOT have '${key}' (DEC-063)`,
      ).toBe(false);
    }
  });

  it("denies sales.view_price", () => {
    expect(effective.permissionKeys.has("sales.view_price")).toBe(false);
  });

  it("denies balances.view_customer and balances.view_supplier_factory", () => {
    expect(effective.permissionKeys.has("balances.view_customer")).toBe(false);
    expect(effective.permissionKeys.has("balances.view_supplier_factory")).toBe(false);
  });

  it("denies profitability.view", () => {
    expect(effective.permissionKeys.has("profitability.view")).toBe(false);
  });

  it("denies audit.view (workers have no audit visibility)", () => {
    expect(effective.permissionKeys.has("audit.view")).toBe(false);
  });

  it("denies exports.internal (workers cannot export)", () => {
    expect(effective.permissionKeys.has("exports.internal")).toBe(false);
  });

  it("denies ALL approval authority (Contract 11 §13: create does not imply approve)", () => {
    expect(effective.permissionKeys.has("inventory.receive.approve")).toBe(false);
    expect(effective.permissionKeys.has("inventory.transfer.approve")).toBe(false);
    expect(effective.permissionKeys.has("sales.approve")).toBe(false);
    expect(effective.permissionKeys.has("production.approve")).toBe(false);
    expect(effective.permissionKeys.has("payments.approve")).toBe(false);
  });
});

describe("resolveEffectivePermissions — single-role Production worker", () => {
  const effective = resolveEffectivePermissions(["production_employee"], MATRIX);

  it("enforces the Worker financial-deny ceiling (DEC-063)", () => {
    expect(effective.workerFinancialDeny.enforced).toBe(true);
  });

  it("grants production operational permissions", () => {
    expect(effective.permissionKeys.has("production.create")).toBe(true);
    expect(effective.permissionKeys.has("production.issue_draft.create")).toBe(true);
    expect(effective.permissionKeys.has("production.issue_draft.submit")).toBe(true);
    expect(effective.permissionKeys.has("production.receive_draft")).toBe(true);
    expect(effective.permissionKeys.has("production.return_from_wip.request")).toBe(true);
  });

  it("denies production.view_cost (financial)", () => {
    expect(effective.permissionKeys.has("production.view_cost")).toBe(false);
  });

  it("denies production.approve (cannot approve own work)", () => {
    expect(effective.permissionKeys.has("production.approve")).toBe(false);
  });
});

describe("resolveEffectivePermissions — single-role Quality worker", () => {
  const effective = resolveEffectivePermissions(["quality_employee"], MATRIX);

  it("enforces the Worker financial-deny ceiling (DEC-063)", () => {
    expect(effective.workerFinancialDeny.enforced).toBe(true);
  });

  it("grants quality operational permissions", () => {
    expect(effective.permissionKeys.has("quality_tests.create")).toBe(true);
    expect(effective.permissionKeys.has("complaints.investigate")).toBe(true);
    expect(effective.permissionKeys.has("returns.create")).toBe(true);
  });

  it("denies returns.approve (cannot approve financial treatment)", () => {
    expect(effective.permissionKeys.has("returns.approve")).toBe(false);
  });
});

describe("DEC-061 + DEC-063 — multi-role conflict (Owner + Warehouse)", () => {
  // This is the critical DEC-063 test: Worker financial-deny WINS even
  // when another role would grant the financial permission.
  const effective = resolveEffectivePermissions(
    ["owner", "warehouse_employee"],
    MATRIX,
  );

  it("enforces the Worker financial-deny ceiling", () => {
    expect(effective.workerFinancialDeny.enforced).toBe(true);
  });

  it("unions operational permissions from BOTH roles (DEC-061)", () => {
    // From Owner:
    expect(effective.permissionKeys.has("inventory.correct")).toBe(true);
    // From Warehouse:
    expect(effective.permissionKeys.has("inventory.receive.create")).toBe(true);
  });

  it("STRIPS financial permissions that Owner would grant (DEC-063 wins)", () => {
    // Owner grants sales.view_price, but Warehouse ceiling strips it.
    expect(effective.permissionKeys.has("sales.view_price")).toBe(false);
    expect(effective.permissionKeys.has("balances.view_customer")).toBe(false);
    expect(effective.permissionKeys.has("balances.view_supplier_factory")).toBe(false);
    expect(effective.permissionKeys.has("profitability.view")).toBe(false);
    expect(effective.permissionKeys.has("audit.view")).toBe(false);
    expect(effective.permissionKeys.has("payments.create")).toBe(false);
    expect(effective.permissionKeys.has("payments.approve")).toBe(false);
    expect(effective.permissionKeys.has("exports.internal")).toBe(false);
  });

  it("STRIPS user/permission management (DEC-063 — could grant financial roles)", () => {
    expect(effective.permissionKeys.has("users.manage")).toBe(false);
    expect(effective.permissionKeys.has("permissions.manage")).toBe(false);
  });

  it("STRIPS settings.manage (could change financial config)", () => {
    expect(effective.permissionKeys.has("settings.manage")).toBe(false);
  });

  it("verifies every key in WORKER_DENIED_PERMISSION_KEYS is absent", () => {
    for (const key of WORKER_DENIED_PERMISSION_KEYS) {
      expect(
        effective.permissionKeys.has(key),
        `multi-role Owner+Warehouse must NOT have '${key}' (DEC-063 ceiling wins)`,
      ).toBe(false);
    }
  });
});

describe("hasPermission / hasAnyPermission / hasAllPermissions", () => {
  const ownerEff = resolveEffectivePermissions(["owner"], MATRIX);
  const warehouseEff = resolveEffectivePermissions(["warehouse_employee"], MATRIX);

  it("hasPermission returns true for Owner's permissions", () => {
    expect(hasPermission(ownerEff, "users.manage")).toBe(true);
  });

  it("hasPermission returns false for Warehouse's denied permissions", () => {
    expect(hasPermission(warehouseEff, "sales.view_price")).toBe(false);
  });

  it("hasAnyPermission returns true if any key is present", () => {
    expect(
      hasAnyPermission(warehouseEff, ["sales.view_price", "inventory.view_quantity"]),
    ).toBe(true);
  });

  it("hasAnyPermission returns false if no key is present", () => {
    expect(
      hasAnyPermission(warehouseEff, ["sales.view_price", "profitability.view"]),
    ).toBe(false);
  });

  it("hasAllPermissions returns true only if all keys are present", () => {
    expect(
      hasAllPermissions(ownerEff, ["users.manage", "permissions.manage"]),
    ).toBe(true);
    expect(
      hasAllPermissions(warehouseEff, ["inventory.view_quantity", "sales.view_price"]),
    ).toBe(false);
  });
});

describe("deniedFieldKeys / isFieldDenied", () => {
  it("returns empty set for Owner (no Worker ceiling)", () => {
    const ownerEff = resolveEffectivePermissions(["owner"], MATRIX);
    expect(deniedFieldKeys(ownerEff).size).toBe(0);
  });

  it("returns empty set for Accountant (no Worker ceiling)", () => {
    const acctEff = resolveEffectivePermissions(["accountant"], MATRIX);
    expect(deniedFieldKeys(acctEff).size).toBe(0);
  });

  it("returns WORKER_DENIED_FIELD_KEYS for Warehouse worker", () => {
    const whEff = resolveEffectivePermissions(["warehouse_employee"], MATRIX);
    const denied = deniedFieldKeys(whEff);
    expect(denied.size).toBe(WORKER_DENIED_FIELD_KEYS.size);
    for (const key of WORKER_DENIED_FIELD_KEYS) {
      expect(denied.has(key)).toBe(true);
    }
  });

  it("returns WORKER_DENIED_FIELD_KEYS for multi-role Owner+Warehouse (DEC-063 wins)", () => {
    const multiEff = resolveEffectivePermissions(
      ["owner", "warehouse_employee"],
      MATRIX,
    );
    const denied = deniedFieldKeys(multiEff);
    expect(denied.size).toBe(WORKER_DENIED_FIELD_KEYS.size);
    for (const key of WORKER_DENIED_FIELD_KEYS) {
      expect(denied.has(key)).toBe(true);
    }
  });

  it("isFieldDenied returns true for Worker financial fields", () => {
    const whEff = resolveEffectivePermissions(["warehouse_employee"], MATRIX);
    expect(isFieldDenied(whEff, "purchase_price_per_ton")).toBe(true);
    expect(isFieldDenied(whEff, "net_revenue")).toBe(true);
    expect(isFieldDenied(whEff, "profit_amount")).toBe(true);
  });

  it("isFieldDenied returns false for Owner financial fields", () => {
    const ownerEff = resolveEffectivePermissions(["owner"], MATRIX);
    expect(isFieldDenied(ownerEff, "purchase_price_per_ton")).toBe(false);
    expect(isFieldDenied(ownerEff, "net_revenue")).toBe(false);
  });
});

describe("resolveEffectivePermissions — unknown role", () => {
  it("treats unknown role as no permissions (fail-safe)", () => {
    // Cast to bypass type check — simulate a future role that doesn't exist in matrix
    const unknownRole = "future_role" as unknown as RoleCode;
    const effective = resolveEffectivePermissions([unknownRole], MATRIX);
    expect(effective.permissionKeys.size).toBe(0);
  });

  it("does not enforce Worker ceiling for unknown role", () => {
    const unknownRole = "future_role" as unknown as RoleCode;
    const effective = resolveEffectivePermissions([unknownRole], MATRIX);
    expect(effective.workerFinancialDeny.enforced).toBe(false);
  });
});

describe("Integration: all 5 MVP roles via TEST_ROLE_PERMISSION_MATRIX", () => {
  // Verify the full pipeline against the actual seed matrix.
  const roles: RoleCode[] = [
    "owner",
    "accountant",
    "warehouse_employee",
    "production_employee",
    "quality_employee",
  ];

  for (const role of roles) {
    it(`role '${role}' resolves without error`, () => {
      const effective = resolveEffectivePermissions([role], MATRIX);
      expect(effective.assignedRoleCodes).toEqual([role]);
    });
  }

  it("all 3 worker roles enforce the DEC-063 ceiling", () => {
    for (const workerRole of ["warehouse_employee", "production_employee", "quality_employee"] as RoleCode[]) {
      const effective = resolveEffectivePermissions([workerRole], MATRIX);
      expect(
        effective.workerFinancialDeny.enforced,
        `${workerRole} should enforce Worker ceiling`,
      ).toBe(true);
    }
  });

  it("Owner and Accountant do NOT enforce the Worker ceiling", () => {
    for (const nonWorkerRole of ["owner", "accountant"] as RoleCode[]) {
      const effective = resolveEffectivePermissions([nonWorkerRole], MATRIX);
      expect(
        effective.workerFinancialDeny.enforced,
        `${nonWorkerRole} should NOT enforce Worker ceiling`,
      ).toBe(false);
    }
  });
});
