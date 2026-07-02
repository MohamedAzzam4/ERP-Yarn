/**
 * WP-00-03A package gate tests — deterministic seed invariants.
 *
 * Contract: docs/contracts/13_work_packages.md WP-00-03A
 *   Expected outputs: "Reviewed platform Drizzle schema/SQL migration and
 *   seeds."
 *
 * Contract: docs/contracts/11_permission_matrix.md §5 + §12
 *   - 5 system roles with the exact role_code values.
 *   - Required permission keys enumerated in §12.
 *
 * DEC-061: MVP users normally have one active operational role. Seeds
 * MUST NOT rely on multi-role users.
 *
 * DEC-063: Worker financial-deny is enforced by the security policy
 * module. The seed for Worker roles deliberately OMITS every financial
 * permission key listed in WORKER_DENIED_PERMISSION_KEYS — this is a
 * defense-in-depth redundancy verified below.
 *
 * These tests verify the seed DATA invariants. No DB, no I/O.
 */

import { describe, it, expect } from "vitest";
import {
  SEED_TENANT,
  SEED_ROLES,
  SEED_PERMISSIONS,
  SEED_ROLE_PERMISSIONS,
  TEST_FIXTURE_OWNER_USER,
  TEST_FIXTURE_OWNER_USER_ROLE,
} from "../seed/platform-security";
import { WORKER_DENIED_PERMISSION_KEYS } from "../../security/worker-financial-deny";
import type { RoleCode } from "../../security/role-codes";

describe("SEED_TENANT (Contract 03 §7.1)", () => {
  it("uses currency_code = EGP", () => {
    expect(SEED_TENANT.currencyCode).toBe("EGP");
  });

  it("uses timezone = Africa/Cairo", () => {
    expect(SEED_TENANT.timezone).toBe("Africa/Cairo");
  });

  it("uses default_language = ar", () => {
    expect(SEED_TENANT.defaultLanguage).toBe("ar");
  });

  it("has status = active", () => {
    expect(SEED_TENANT.status).toBe("active");
  });
});

describe("SEED_ROLES (Contract 03 §6 / Contract 11 §5)", () => {
  it("contains exactly 5 system roles", () => {
    expect(SEED_ROLES.length).toBe(5);
  });

  it("contains the 5 contracted role codes", () => {
    const codes = SEED_ROLES.map((r) => r.roleCode).sort();
    expect(codes).toEqual([
      "accountant",
      "owner",
      "production_employee",
      "quality_employee",
      "warehouse_employee",
    ]);
  });

  it("all roles are system roles (is_system_role = true)", () => {
    for (const r of SEED_ROLES) {
      expect(r.isSystemRole).toBe(true);
      expect(r.systemFlag).toBe("system");
    }
  });

  it("all roles have unique IDs and unique (tenant_id, role_code)", () => {
    const ids = new Set(SEED_ROLES.map((r) => r.id));
    expect(ids.size).toBe(SEED_ROLES.length);
    const tenantCodePairs = new Set(
      SEED_ROLES.map((r) => `${r.tenantId}|${r.roleCode}`),
    );
    expect(tenantCodePairs.size).toBe(SEED_ROLES.length);
  });

  it("all roles belong to the seed tenant", () => {
    for (const r of SEED_ROLES) {
      expect(r.tenantId).toBe(SEED_TENANT.id);
    }
  });

  it("every role has a non-empty Arabic and English name", () => {
    for (const r of SEED_ROLES) {
      expect(r.nameAr.length).toBeGreaterThan(0);
      expect(r.nameEn.length).toBeGreaterThan(0);
    }
  });
});

describe("SEED_PERMISSIONS (Contract 11 §12)", () => {
  it("contains all required permission keys from Contract 11 §12 plus WP-02-01 master_data keys", () => {
    // 57 base keys from Contract 11 §12 + 5 WP-02-01 master_data keys.
    expect(SEED_PERMISSIONS.length).toBe(62);
  });

  it("contains the WP-02-01 master_data permission keys", () => {
    const keys = new Set(SEED_PERMISSIONS.map((p) => p.permissionKey));
    expect(keys.has("master_data.view")).toBe(true);
    expect(keys.has("master_data.view_names")).toBe(true);
    expect(keys.has("master_data.create")).toBe(true);
    expect(keys.has("master_data.update")).toBe(true);
    expect(keys.has("master_data.inactivate")).toBe(true);
  });

  it("contains specific required keys (spot check)", () => {
    const keys = new Set(SEED_PERMISSIONS.map((p) => p.permissionKey));
    const required = [
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
    for (const k of required) {
      expect(keys.has(k)).toBe(true);
    }
  });

  it("has unique permission keys per tenant", () => {
    const keys = SEED_PERMISSIONS.map((p) => `${p.tenantId}|${p.permissionKey}`);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });

  it("all permissions belong to the seed tenant", () => {
    for (const p of SEED_PERMISSIONS) {
      expect(p.tenantId).toBe(SEED_TENANT.id);
    }
  });
});

describe("SEED_ROLE_PERMISSIONS (DEC-063 defense-in-depth)", () => {
  it("Owner role receives ALL permission keys", () => {
    const ownerRoleId = SEED_ROLES.find((r) => r.roleCode === "owner")!.id;
    const ownerGrantIds = SEED_ROLE_PERMISSIONS.filter(
      (rp) => rp.roleId === ownerRoleId,
    ).map((rp) => rp.permissionId);
    expect(ownerGrantIds.length).toBe(SEED_PERMISSIONS.length);
  });

  it("Owner receives all master_data permission keys (WP-02-01)", () => {
    const ownerRoleId = SEED_ROLES.find((r) => r.roleCode === "owner")!.id;
    const ownerPermissionIds = new Set(
      SEED_ROLE_PERMISSIONS.filter((rp) => rp.roleId === ownerRoleId).map(
        (rp) => rp.permissionId,
      ),
    );
    const permissionByKey = new Map(
      SEED_PERMISSIONS.map((p) => [p.permissionKey, p.id]),
    );
    for (const key of [
      "master_data.view",
      "master_data.view_names",
      "master_data.create",
      "master_data.update",
      "master_data.inactivate",
    ]) {
      const pid = permissionByKey.get(key);
      expect(pid, `permission key '${key}' should exist in SEED_PERMISSIONS`).toBeDefined();
      expect(
        ownerPermissionIds.has(pid!),
        `Owner should be granted '${key}'`,
      ).toBe(true);
    }
  });

  it("Accountant receives master_data V/C/U keys but not view_names (WP-02-01)", () => {
    const accountantRoleId = SEED_ROLES.find((r) => r.roleCode === "accountant")!.id;
    const accountantPermissionIds = new Set(
      SEED_ROLE_PERMISSIONS.filter((rp) => rp.roleId === accountantRoleId).map(
        (rp) => rp.permissionId,
      ),
    );
    const permissionByKey = new Map(
      SEED_PERMISSIONS.map((p) => [p.permissionKey, p.id]),
    );
    expect(accountantPermissionIds.has(permissionByKey.get("master_data.view")!)).toBe(true);
    expect(accountantPermissionIds.has(permissionByKey.get("master_data.create")!)).toBe(true);
    expect(accountantPermissionIds.has(permissionByKey.get("master_data.update")!)).toBe(true);
    expect(accountantPermissionIds.has(permissionByKey.get("master_data.inactivate")!)).toBe(true);
    expect(accountantPermissionIds.has(permissionByKey.get("master_data.view_names")!)).toBe(false);
  });

  it("Worker roles receive master_data.view_names only (WP-02-01, DEC-063)", () => {
    const permissionByKey = new Map(
      SEED_PERMISSIONS.map((p) => [p.permissionKey, p.id]),
    );
    const viewNamesId = permissionByKey.get("master_data.view_names")!;
    const createId = permissionByKey.get("master_data.create")!;
    const inactivateId = permissionByKey.get("master_data.inactivate")!;

    for (const roleCode of ["warehouse_employee", "production_employee", "quality_employee"] as const) {
      const roleId = SEED_ROLES.find((r) => r.roleCode === roleCode)!.id;
      const workerPermissionIds = new Set(
        SEED_ROLE_PERMISSIONS.filter((rp) => rp.roleId === roleId).map(
          (rp) => rp.permissionId,
        ),
      );
      expect(
        workerPermissionIds.has(viewNamesId),
        `${roleCode} should get master_data.view_names`,
      ).toBe(true);
      expect(
        workerPermissionIds.has(createId),
        `${roleCode} must NOT get master_data.create`,
      ).toBe(false);
      expect(
        workerPermissionIds.has(inactivateId),
        `${roleCode} must NOT get master_data.inactivate`,
      ).toBe(false);
    }
  });

  it("warehouse_employee does NOT receive any financial permission key (DEC-063)", () => {
    const warehouseRoleId = SEED_ROLES.find(
      (r) => r.roleCode === "warehouse_employee",
    )!.id;
    const warehousePermissionIds = new Set(
      SEED_ROLE_PERMISSIONS.filter((rp) => rp.roleId === warehouseRoleId).map(
        (rp) => rp.permissionId,
      ),
    );
    const permissionById = new Map(
      SEED_PERMISSIONS.map((p) => [p.id, p.permissionKey]),
    );
    for (const pid of warehousePermissionIds) {
      const key = permissionById.get(pid);
      expect(key, `permission id ${pid} should be in SEED_PERMISSIONS`).toBeDefined();
      if (key && WORKER_DENIED_PERMISSION_KEYS.has(key)) {
        throw new Error(
          `DEC-063 violation: warehouse_employee is granted '${key}' in SEED_ROLE_PERMISSIONS.`,
        );
      }
    }
  });

  it("production_employee does NOT receive any financial permission key (DEC-063)", () => {
    const prodRoleId = SEED_ROLES.find(
      (r) => r.roleCode === "production_employee",
    )!.id;
    const prodPermissionIds = new Set(
      SEED_ROLE_PERMISSIONS.filter((rp) => rp.roleId === prodRoleId).map(
        (rp) => rp.permissionId,
      ),
    );
    const permissionById = new Map(
      SEED_PERMISSIONS.map((p) => [p.id, p.permissionKey]),
    );
    for (const pid of prodPermissionIds) {
      const key = permissionById.get(pid);
      expect(key, `permission id ${pid} should be in SEED_PERMISSIONS`).toBeDefined();
      if (key && WORKER_DENIED_PERMISSION_KEYS.has(key)) {
        throw new Error(
          `DEC-063 violation: production_employee is granted '${key}' in SEED_ROLE_PERMISSIONS.`,
        );
      }
    }
  });

  it("quality_employee does NOT receive any financial permission key (DEC-063)", () => {
    const qualityRoleId = SEED_ROLES.find(
      (r) => r.roleCode === "quality_employee",
    )!.id;
    const qualityPermissionIds = new Set(
      SEED_ROLE_PERMISSIONS.filter((rp) => rp.roleId === qualityRoleId).map(
        (rp) => rp.permissionId,
      ),
    );
    const permissionById = new Map(
      SEED_PERMISSIONS.map((p) => [p.id, p.permissionKey]),
    );
    for (const pid of qualityPermissionIds) {
      const key = permissionById.get(pid);
      expect(key, `permission id ${pid} should be in SEED_PERMISSIONS`).toBeDefined();
      if (key && WORKER_DENIED_PERMISSION_KEYS.has(key)) {
        throw new Error(
          `DEC-063 violation: quality_employee is granted '${key}' in SEED_ROLE_PERMISSIONS.`,
        );
      }
    }
  });

  it("every role_permission references a real role and a real permission", () => {
    const roleIds = new Set(SEED_ROLES.map((r) => r.id));
    const permissionIds = new Set(SEED_PERMISSIONS.map((p) => p.id));
    for (const rp of SEED_ROLE_PERMISSIONS) {
      expect(roleIds.has(rp.roleId)).toBe(true);
      expect(permissionIds.has(rp.permissionId)).toBe(true);
    }
  });

  it("no duplicate (roleId, permissionId) pairs", () => {
    const pairs = SEED_ROLE_PERMISSIONS.map(
      (rp) => `${rp.roleId}|${rp.permissionId}`,
    );
    const unique = new Set(pairs);
    expect(unique.size).toBe(pairs.length);
  });
});

describe("TEST_FIXTURE_OWNER_USER (synthetic test fixture, NOT a production seed)", () => {
  it("has exactly one role assignment (DEC-061 single-role for MVP)", () => {
    // DEC-061: MVP users normally have one active operational role.
    // The test-fixture Owner has exactly one role: owner.
    expect(TEST_FIXTURE_OWNER_USER_ROLE.userId).toBe(TEST_FIXTURE_OWNER_USER.id);
    expect(TEST_FIXTURE_OWNER_USER_ROLE.roleId).toBe(
      SEED_ROLES.find((r) => r.roleCode === "owner")!.id,
    );
  });

  it("has a placeholder authId that is NOT a real Supabase Auth identity", () => {
    // PCD-AUTH-002 (Owner bootstrap) is UNRESOLVED. This is a synthetic
    // test fixture, NOT a production seed. The authId is a placeholder
    // that would fail Supabase Auth validation.
    expect(TEST_FIXTURE_OWNER_USER.authId).toBe(
      "PLACEHOLDER_TEST_FIXTURE_NOT_FOR_PRODUCTION_USE",
    );
  });

  it("has status = active", () => {
    expect(TEST_FIXTURE_OWNER_USER.status).toBe("active");
  });

  it("has a name that clearly labels it as synthetic test-fixture data", () => {
    expect(TEST_FIXTURE_OWNER_USER.name).toMatch(/test fixture|synthetic/i);
  });

  it("has an email on the .local domain (not a real email)", () => {
    expect(TEST_FIXTURE_OWNER_USER.email).toMatch(/@erp-yarn\.local$/);
  });
});
