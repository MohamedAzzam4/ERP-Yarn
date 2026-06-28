/**
 * WP-01-02 tests — role fixtures coverage.
 *
 * Verifies the test fixtures cover all 5 MVP roles + inactive/unmapped/
 * cross-tenant cases per Contract 12 §7.
 */
import { describe, it, expect } from "vitest";
import {
  TEST_USERS,
  TEST_USER_IDS,
  TEST_TENANT_ID,
  FOREIGN_TENANT_ID,
  TEST_FOREIGN_ACCOUNTANT,
  TEST_INACTIVE_OWNER_DENIAL,
  TEST_UNMAPPED_USER_DENIAL,
  TEST_NO_SESSION_DENIAL,
  TEST_ROLE_ASSIGNMENTS,
  TEST_MULTI_ROLE_USER,
  TEST_WAREHOUSE_SCOPE_ASSIGNMENTS,
  TEST_EMPTY_SCOPE_ASSIGNMENTS,
  ALL_MVP_ROLE_USERS,
  getTestRoleAssignments,
  getTestEffectivePermissions,
  TEST_ROLE_PERMISSION_MATRIX,
} from "../role-fixtures";

describe("TEST_USERS — 5 MVP roles", () => {
  it("contains all 5 MVP role users", () => {
    expect(TEST_USERS.owner).toBeDefined();
    expect(TEST_USERS.accountant).toBeDefined();
    expect(TEST_USERS.warehouse).toBeDefined();
    expect(TEST_USERS.production).toBeDefined();
    expect(TEST_USERS.quality).toBeDefined();
  });

  it("each user has a distinct UUID", () => {
    const ids = [
      TEST_USERS.owner.userId,
      TEST_USERS.accountant.userId,
      TEST_USERS.warehouse.userId,
      TEST_USERS.production.userId,
      TEST_USERS.quality.userId,
    ];
    expect(new Set(ids).size).toBe(5);
  });

  it("each user is authenticated and in the primary tenant", () => {
    for (const user of Object.values(TEST_USERS)) {
      expect(user.authenticated).toBe(true);
      expect(user.tenantId).toBe(TEST_TENANT_ID);
    }
  });
});

describe("TEST_FOREIGN_ACCOUNTANT — cross-tenant fixture", () => {
  it("is in the foreign tenant", () => {
    expect(TEST_FOREIGN_ACCOUNTANT.tenantId).toBe(FOREIGN_TENANT_ID);
    expect(TEST_FOREIGN_ACCOUNTANT.tenantId).not.toBe(TEST_TENANT_ID);
  });

  it("has a distinct UUID from primary Accountant", () => {
    expect(TEST_FOREIGN_ACCOUNTANT.userId).not.toBe(TEST_USERS.accountant.userId);
  });
});

describe("TEST_INACTIVE_OWNER_DENIAL / TEST_UNMAPPED_USER_DENIAL / TEST_NO_SESSION_DENIAL", () => {
  it("inactive denial has reason='inactive'", () => {
    expect(TEST_INACTIVE_OWNER_DENIAL.authenticated).toBe(false);
    expect(TEST_INACTIVE_OWNER_DENIAL.reason).toBe("inactive");
  });

  it("unmapped denial has reason='unmapped'", () => {
    expect(TEST_UNMAPPED_USER_DENIAL.authenticated).toBe(false);
    expect(TEST_UNMAPPED_USER_DENIAL.reason).toBe("unmapped");
  });

  it("no-session denial has reason='no_session'", () => {
    expect(TEST_NO_SESSION_DENIAL.authenticated).toBe(false);
    expect(TEST_NO_SESSION_DENIAL.reason).toBe("no_session");
  });
});

describe("TEST_ROLE_ASSIGNMENTS", () => {
  it("Owner has role 'owner'", () => {
    expect(getTestRoleAssignments(TEST_USER_IDS.owner)).toEqual(["owner"]);
  });

  it("Accountant has role 'accountant'", () => {
    expect(getTestRoleAssignments(TEST_USER_IDS.accountant)).toEqual(["accountant"]);
  });

  it("Warehouse has role 'warehouse_employee'", () => {
    expect(getTestRoleAssignments(TEST_USER_IDS.warehouse)).toEqual(["warehouse_employee"]);
  });

  it("Production has role 'production_employee'", () => {
    expect(getTestRoleAssignments(TEST_USER_IDS.production)).toEqual(["production_employee"]);
  });

  it("Quality has role 'quality_employee'", () => {
    expect(getTestRoleAssignments(TEST_USER_IDS.quality)).toEqual(["quality_employee"]);
  });

  it("multi-role user has both 'owner' and 'warehouse_employee'", () => {
    expect(getTestRoleAssignments(TEST_USER_IDS.multiRoleOwnerWarehouse)).toEqual([
      "owner",
      "warehouse_employee",
    ]);
  });

  it("throws for unknown user ID", () => {
    expect(() => getTestRoleAssignments("unknown-user-id")).toThrow(/No test role assignments/);
  });
});

describe("getTestEffectivePermissions — cached resolution", () => {
  it("returns the same object on repeated calls (cached)", () => {
    const a = getTestEffectivePermissions(TEST_USER_IDS.owner);
    const b = getTestEffectivePermissions(TEST_USER_IDS.owner);
    expect(a).toBe(b); // referential equality (cached)
  });

  it("Owner has users.manage", () => {
    const eff = getTestEffectivePermissions(TEST_USER_IDS.owner);
    expect(eff.permissionKeys.has("users.manage")).toBe(true);
  });

  it("Warehouse worker does NOT have sales.view_price (DEC-063)", () => {
    const eff = getTestEffectivePermissions(TEST_USER_IDS.warehouse);
    expect(eff.permissionKeys.has("sales.view_price")).toBe(false);
  });
});

describe("ALL_MVP_ROLE_USERS — parameterized test list", () => {
  it("has exactly 5 entries (one per MVP role)", () => {
    expect(ALL_MVP_ROLE_USERS.length).toBe(5);
  });

  it("labels match the role codes", () => {
    const labels = ALL_MVP_ROLE_USERS.map((u) => u.label);
    expect(labels.sort()).toEqual([
      "accountant",
      "owner",
      "production",
      "quality",
      "warehouse",
    ]);
  });
});

describe("TEST_WAREHOUSE_SCOPE_ASSIGNMENTS", () => {
  it("has 3 active assignments (location, external_factory, task_type)", () => {
    expect(TEST_WAREHOUSE_SCOPE_ASSIGNMENTS.length).toBe(3);
    const types = TEST_WAREHOUSE_SCOPE_ASSIGNMENTS.map((a) => a.scopeType).sort();
    expect(types).toEqual(["external_factory", "location", "task_type"]);
  });

  it("all assignments are active and for the warehouse user", () => {
    for (const a of TEST_WAREHOUSE_SCOPE_ASSIGNMENTS) {
      expect(a.isActive).toBe(true);
      expect(a.userId).toBe(TEST_USER_IDS.warehouse);
      expect(a.tenantId).toBe(TEST_TENANT_ID);
    }
  });
});

describe("TEST_EMPTY_SCOPE_ASSIGNMENTS", () => {
  it("is an empty array (for default-deny tests)", () => {
    expect(TEST_EMPTY_SCOPE_ASSIGNMENTS.length).toBe(0);
  });
});

describe("TEST_MULTI_ROLE_USER", () => {
  it("is in the primary tenant", () => {
    expect(TEST_MULTI_ROLE_USER.tenantId).toBe(TEST_TENANT_ID);
  });

  it("has the multi-role UUID", () => {
    expect(TEST_MULTI_ROLE_USER.userId).toBe(TEST_USER_IDS.multiRoleOwnerWarehouse);
  });
});

describe("TEST_ROLE_PERMISSION_MATRIX", () => {
  it("has entries for all 5 MVP roles", () => {
    expect(TEST_ROLE_PERMISSION_MATRIX.owner).toBeDefined();
    expect(TEST_ROLE_PERMISSION_MATRIX.accountant).toBeDefined();
    expect(TEST_ROLE_PERMISSION_MATRIX.warehouse_employee).toBeDefined();
    expect(TEST_ROLE_PERMISSION_MATRIX.production_employee).toBeDefined();
    expect(TEST_ROLE_PERMISSION_MATRIX.quality_employee).toBeDefined();
  });

  it("Owner has all permissions", () => {
    const ownerPerms = TEST_ROLE_PERMISSION_MATRIX.owner;
    expect(ownerPerms.has("users.manage")).toBe(true);
    expect(ownerPerms.has("permissions.manage")).toBe(true);
    expect(ownerPerms.has("sales.view_price")).toBe(true);
  });

  it("Warehouse does NOT have any Worker-denied permission (defense-in-depth)", () => {
    const whPerms = TEST_ROLE_PERMISSION_MATRIX.warehouse_employee;
    // The seed matrix should NOT grant any financial permission to Worker
    // roles, even though the runtime Worker ceiling would strip them.
    // This is the "belt and suspenders" defense-in-depth per DEC-063.
    // We don't import WORKER_DENIED_PERMISSION_KEYS here to avoid coupling
    // the fixture test to the policy module — instead we spot-check key
    // financial permissions.
    expect(whPerms.has("sales.view_price")).toBe(false);
    expect(whPerms.has("profitability.view")).toBe(false);
    expect(whPerms.has("payments.create")).toBe(false);
    expect(whPerms.has("audit.view")).toBe(false);
    expect(whPerms.has("users.manage")).toBe(false);
  });
});
