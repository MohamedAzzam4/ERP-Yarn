/**
 * WP-01-02 tests — backend permission guards.
 *
 * Contract: docs/contracts/11_permission_matrix.md §11, §17.
 * Contract: docs/contracts/09_api_contracts.md §5.
 * Contract: docs/contracts/01_technical_architecture_and_deployment_contract.md
 *   §Supabase Auth.
 */
import { describe, it, expect } from "vitest";
import {
  requireAuthenticatedErpContext,
  requireTenantMatch,
  requirePermission,
  requireAnyPermission,
  requireRole,
  requireRowScope,
  rejectForbiddenWorkerFields,
  rejectBodyClaimsAuthority,
  resolveAndRequirePermission,
  requireErpAuthForServiceRolePath,
  requireNotDeniedByWorkerCeiling,
  AUTHORITY_CLAIMING_BODY_FIELDS,
  NoSessionError,
  UnmappedUserError,
  InactiveUserError,
  TenantMismatchError,
  PermissionDeniedError,
  RowScopeDeniedError,
  ForbiddenFieldInRequestError,
  BodyClaimsAuthorityError,
  MixedWorkerRoleScopeGuardError,
} from "../guards";
import { resolveEffectivePermissions } from "../effective-permissions";
import { TEST_ROLE_PERMISSION_MATRIX } from "../role-fixtures";
import {
  TEST_USERS,
  TEST_FOREIGN_ACCOUNTANT,
  TEST_INACTIVE_OWNER_DENIAL,
  TEST_UNMAPPED_USER_DENIAL,
  TEST_NO_SESSION_DENIAL,
  TEST_USER_IDS,
  TEST_TENANT_ID,
  FOREIGN_TENANT_ID,
  TEST_MULTI_ROLE_USER,
  TEST_WAREHOUSE_SCOPE_ASSIGNMENTS,
  TEST_EMPTY_SCOPE_ASSIGNMENTS,
  TEST_LOCATION_A,
  TEST_LOCATION_B,
} from "../role-fixtures";

const MATRIX = TEST_ROLE_PERMISSION_MATRIX;

describe("requireAuthenticatedErpContext", () => {
  it("returns the context when authenticated", () => {
    const result = requireAuthenticatedErpContext(TEST_USERS.owner);
    expect(result).toBe(TEST_USERS.owner);
  });

  it("throws NoSessionError for no_session", () => {
    expect(() => requireAuthenticatedErpContext(TEST_NO_SESSION_DENIAL)).toThrow(NoSessionError);
  });

  it("throws UnmappedUserError for unmapped", () => {
    expect(() => requireAuthenticatedErpContext(TEST_UNMAPPED_USER_DENIAL)).toThrow(UnmappedUserError);
  });

  it("throws InactiveUserError for inactive", () => {
    expect(() => requireAuthenticatedErpContext(TEST_INACTIVE_OWNER_DENIAL)).toThrow(InactiveUserError);
  });
});

describe("requireTenantMatch", () => {
  it("passes when user tenant matches entity tenant", () => {
    expect(() =>
      requireTenantMatch(TEST_USERS.owner, TEST_TENANT_ID),
    ).not.toThrow();
  });

  it("throws TenantMismatchError when tenants differ (cross-tenant access denied)", () => {
    expect(() =>
      requireTenantMatch(TEST_USERS.owner, FOREIGN_TENANT_ID),
    ).toThrow(TenantMismatchError);
  });

  it("foreign Accountant cannot access primary tenant entity", () => {
    expect(() =>
      requireTenantMatch(TEST_FOREIGN_ACCOUNTANT, TEST_TENANT_ID),
    ).toThrow(TenantMismatchError);
  });

  it("foreign Accountant can access foreign tenant entity", () => {
    expect(() =>
      requireTenantMatch(TEST_FOREIGN_ACCOUNTANT, FOREIGN_TENANT_ID),
    ).not.toThrow();
  });
});

describe("requirePermission", () => {
  it("passes when user has the required permission", () => {
    const ownerEff = resolveEffectivePermissions(["owner"], MATRIX);
    expect(() => requirePermission(ownerEff, "users.manage")).not.toThrow();
  });

  it("throws PermissionDeniedError when user lacks the permission", () => {
    const whEff = resolveEffectivePermissions(["warehouse_employee"], MATRIX);
    expect(() => requirePermission(whEff, "sales.view_price")).toThrow(PermissionDeniedError);
  });

  it("Warehouse worker denied inventory.receive.approve (cannot approve)", () => {
    const whEff = resolveEffectivePermissions(["warehouse_employee"], MATRIX);
    expect(() => requirePermission(whEff, "inventory.receive.approve")).toThrow(PermissionDeniedError);
  });

  it("Accountant denied users.manage (DEC-032 — only Owner manages users)", () => {
    const acctEff = resolveEffectivePermissions(["accountant"], MATRIX);
    expect(() => requirePermission(acctEff, "users.manage")).toThrow(PermissionDeniedError);
  });

  it("Accountant denied permissions.manage (DEC-032 — cannot grant permissions)", () => {
    const acctEff = resolveEffectivePermissions(["accountant"], MATRIX);
    expect(() => requirePermission(acctEff, "permissions.manage")).toThrow(PermissionDeniedError);
  });

  it("multi-role Owner+Warehouse denied financial permission (DEC-063 wins)", () => {
    const multiEff = resolveEffectivePermissions(["owner", "warehouse_employee"], MATRIX);
    expect(() => requirePermission(multiEff, "sales.view_price")).toThrow(PermissionDeniedError);
    expect(() => requirePermission(multiEff, "profitability.view")).toThrow(PermissionDeniedError);
  });
});

describe("requireAnyPermission", () => {
  it("passes if any of the keys is present", () => {
    const whEff = resolveEffectivePermissions(["warehouse_employee"], MATRIX);
    expect(() =>
      requireAnyPermission(whEff, ["sales.view_price", "inventory.view_quantity"]),
    ).not.toThrow();
  });

  it("throws if none of the keys is present", () => {
    const whEff = resolveEffectivePermissions(["warehouse_employee"], MATRIX);
    expect(() =>
      requireAnyPermission(whEff, ["sales.view_price", "profitability.view"]),
    ).toThrow(PermissionDeniedError);
  });
});

describe("requireRole", () => {
  it("passes when user has one of the allowed roles", () => {
    expect(() => requireRole(["owner"], ["owner"])).not.toThrow();
    expect(() => requireRole(["warehouse_employee"], ["warehouse_employee", "production_employee"])).not.toThrow();
  });

  it("throws when user has none of the allowed roles", () => {
    expect(() => requireRole(["accountant"], ["owner"])).toThrow(PermissionDeniedError);
  });
});

describe("requireRowScope (DEC-062)", () => {
  it("Owner bypasses row-scope (tenant-wide visibility)", () => {
    expect(() =>
      requireRowScope(
        ["owner"],
        TEST_EMPTY_SCOPE_ASSIGNMENTS,
        TEST_USERS.owner,
        "location",
        TEST_LOCATION_A,
      ),
    ).not.toThrow();
  });

  it("Accountant bypasses row-scope (tenant-wide visibility)", () => {
    expect(() =>
      requireRowScope(
        ["accountant"],
        TEST_EMPTY_SCOPE_ASSIGNMENTS,
        TEST_USERS.accountant,
        "location",
        TEST_LOCATION_A,
      ),
    ).not.toThrow();
  });

  it("Warehouse worker permitted for assigned location", () => {
    expect(() =>
      requireRowScope(
        ["warehouse_employee"],
        TEST_WAREHOUSE_SCOPE_ASSIGNMENTS,
        TEST_USERS.warehouse,
        "location",
        TEST_LOCATION_A,
      ),
    ).not.toThrow();
  });

  it("Warehouse worker DENIED for unassigned location (DEC-062 default-deny)", () => {
    expect(() =>
      requireRowScope(
        ["warehouse_employee"],
        TEST_WAREHOUSE_SCOPE_ASSIGNMENTS,
        TEST_USERS.warehouse,
        "location",
        TEST_LOCATION_B,
      ),
    ).toThrow(RowScopeDeniedError);
  });

  it("Warehouse worker DENIED when no scope assignments exist (default-deny)", () => {
    expect(() =>
      requireRowScope(
        ["warehouse_employee"],
        TEST_EMPTY_SCOPE_ASSIGNMENTS,
        TEST_USERS.warehouse,
        "location",
        TEST_LOCATION_A,
      ),
    ).toThrow(RowScopeDeniedError);
  });

  it("Warehouse worker permitted for assigned external_factory", () => {
    expect(() =>
      requireRowScope(
        ["warehouse_employee"],
        TEST_WAREHOUSE_SCOPE_ASSIGNMENTS,
        TEST_USERS.warehouse,
        "external_factory",
        "00000000-0000-0000-0002-000000000001",
      ),
    ).not.toThrow();
  });

  it("mixed Worker + non-Worker role set throws MixedWorkerRoleScopeGuardError (Unresolved / requires owner decision)", () => {
    expect(() =>
      requireRowScope(
        ["owner", "warehouse_employee"],
        TEST_WAREHOUSE_SCOPE_ASSIGNMENTS,
        TEST_MULTI_ROLE_USER,
        "location",
        TEST_LOCATION_A,
      ),
    ).toThrow(MixedWorkerRoleScopeGuardError);
  });
});

describe("rejectForbiddenWorkerFields (DEC-063 — reject, don't silently accept)", () => {
  it("does NOT reject for non-Worker users (Owner/Accountant can submit financial fields)", () => {
    const ownerBody = { purchase_price_per_ton: "150.00", net_revenue: "75000.00" };
    expect(() =>
      rejectForbiddenWorkerFields(["owner"], ownerBody),
    ).not.toThrow();
  });

  it("rejects financial field for Warehouse worker", () => {
    const body = { received_qty_kg: "1000.000", purchase_price_per_ton: "150.00" };
    expect(() =>
      rejectForbiddenWorkerFields(["warehouse_employee"], body),
    ).toThrow(ForbiddenFieldInRequestError);
  });

  it("rejects financial field for Production worker", () => {
    const body = { qty_kg: "500.000", factory_rate_per_ton_used: "50.00" };
    expect(() =>
      rejectForbiddenWorkerFields(["production_employee"], body),
    ).toThrow(ForbiddenFieldInRequestError);
  });

  it("rejects financial field for Quality worker", () => {
    const body = { quality_status: "accepted", return_credit_value: "5000.00" };
    expect(() =>
      rejectForbiddenWorkerFields(["quality_employee"], body),
    ).toThrow(ForbiddenFieldInRequestError);
  });

  it("rejects for multi-role Owner+Warehouse (DEC-063 ceiling)", () => {
    const body = { purchase_price_per_ton: "150.00" };
    expect(() =>
      rejectForbiddenWorkerFields(["owner", "warehouse_employee"], body),
    ).toThrow(ForbiddenFieldInRequestError);
  });

  it("does NOT reject operational fields for Worker", () => {
    const body = { received_qty_kg: "1000.000", quality_status: "accepted", location_id: "loc-1" };
    expect(() =>
      rejectForbiddenWorkerFields(["warehouse_employee"], body),
    ).not.toThrow();
  });
});

describe("rejectBodyClaimsAuthority (Contract 09 §5)", () => {
  it("rejects tenant_id in body", () => {
    const body = { tenant_id: "attacker-tenant" };
    expect(() => rejectBodyClaimsAuthority(body)).toThrow(BodyClaimsAuthorityError);
  });

  it("rejects tenantId (camelCase) in body", () => {
    const body = { tenantId: "attacker-tenant" };
    expect(() => rejectBodyClaimsAuthority(body)).toThrow(BodyClaimsAuthorityError);
  });

  it("rejects role in body", () => {
    const body = { role: "owner" };
    expect(() => rejectBodyClaimsAuthority(body)).toThrow(BodyClaimsAuthorityError);
  });

  it("rejects permission in body", () => {
    const body = { permission: "users.manage" };
    expect(() => rejectBodyClaimsAuthority(body)).toThrow(BodyClaimsAuthorityError);
  });

  it("rejects approver / actor / user_id / auth_id in body", () => {
    for (const field of ["approver", "actor", "user_id", "auth_id"]) {
      const body = { [field]: "attacker-value" };
      expect(() => rejectBodyClaimsAuthority(body)).toThrow(BodyClaimsAuthorityError);
    }
  });

  it("does NOT reject non-authority fields", () => {
    const body = { received_qty_kg: "1000.000", quality_status: "accepted" };
    expect(() => rejectBodyClaimsAuthority(body)).not.toThrow();
  });

  it("AUTHORITY_CLAIMING_BODY_FIELDS contains all expected authority field names", () => {
    expect(AUTHORITY_CLAIMING_BODY_FIELDS.has("tenant_id")).toBe(true);
    expect(AUTHORITY_CLAIMING_BODY_FIELDS.has("tenantId")).toBe(true);
    expect(AUTHORITY_CLAIMING_BODY_FIELDS.has("role")).toBe(true);
    expect(AUTHORITY_CLAIMING_BODY_FIELDS.has("permission")).toBe(true);
    expect(AUTHORITY_CLAIMING_BODY_FIELDS.has("approver")).toBe(true);
    expect(AUTHORITY_CLAIMING_BODY_FIELDS.has("actor")).toBe(true);
    expect(AUTHORITY_CLAIMING_BODY_FIELDS.has("user_id")).toBe(true);
    expect(AUTHORITY_CLAIMING_BODY_FIELDS.has("auth_id")).toBe(true);
  });
});

describe("resolveAndRequirePermission", () => {
  it("resolves and returns effective permissions when permission is present", () => {
    const eff = resolveAndRequirePermission(["owner"], MATRIX, "users.manage");
    expect(eff.permissionKeys.has("users.manage")).toBe(true);
  });

  it("throws PermissionDeniedError when permission is absent", () => {
    expect(() =>
      resolveAndRequirePermission(["warehouse_employee"], MATRIX, "sales.view_price"),
    ).toThrow(PermissionDeniedError);
  });
});

describe("requireErpAuthForServiceRolePath (Contract 11 §11 — service-role still requires ERP auth)", () => {
  it("returns context when authenticated (service-role path)", () => {
    const result = requireErpAuthForServiceRolePath(TEST_USERS.owner);
    expect(result).toBe(TEST_USERS.owner);
  });

  it("throws NoSessionError for no_session (service-role path does NOT bypass ERP auth)", () => {
    expect(() =>
      requireErpAuthForServiceRolePath(TEST_NO_SESSION_DENIAL),
    ).toThrow(NoSessionError);
  });

  it("throws UnmappedUserError for unmapped (service-role path does NOT bypass ERP auth)", () => {
    expect(() =>
      requireErpAuthForServiceRolePath(TEST_UNMAPPED_USER_DENIAL),
    ).toThrow(UnmappedUserError);
  });
});

describe("requireNotDeniedByWorkerCeiling (DEC-063 — service-role path)", () => {
  it("passes for non-Worker role requesting financial permission", () => {
    expect(() =>
      requireNotDeniedByWorkerCeiling(["owner"], "sales.view_price"),
    ).not.toThrow();
  });

  it("throws for Worker role requesting financial permission (ceiling applies to service-role path too)", () => {
    expect(() =>
      requireNotDeniedByWorkerCeiling(["warehouse_employee"], "sales.view_price"),
    ).toThrow(PermissionDeniedError);
  });

  it("throws for multi-role Owner+Warehouse requesting financial permission", () => {
    expect(() =>
      requireNotDeniedByWorkerCeiling(["owner", "warehouse_employee"], "sales.view_price"),
    ).toThrow(PermissionDeniedError);
  });

  it("passes for Worker role requesting operational permission", () => {
    expect(() =>
      requireNotDeniedByWorkerCeiling(["warehouse_employee"], "inventory.view_quantity"),
    ).not.toThrow();
  });
});

describe("Guard error codes (for HTTP response mapping)", () => {
  it("each GuardError has a stable code", () => {
    expect(new NoSessionError("x").code).toBe("no_session");
    expect(new UnmappedUserError("x").code).toBe("unmapped");
    expect(new InactiveUserError("x").code).toBe("inactive");
    expect(new TenantMismatchError("t1", "t2").code).toBe("tenant_mismatch");
    expect(new PermissionDeniedError("users.manage").code).toBe("permission_denied");
    expect(new RowScopeDeniedError("location", "loc-1").code).toBe("row_scope_denied");
    expect(new ForbiddenFieldInRequestError("purchase_price_per_ton").code).toBe("forbidden_field_in_request");
    expect(new BodyClaimsAuthorityError("tenant_id").code).toBe("body_claims_authority");
    expect(new MixedWorkerRoleScopeGuardError(["owner", "warehouse_employee"]).code).toBe("mixed_worker_role_scope_unresolved");
  });

  it("GuardError.exposesEntity is always false (guards deny BEFORE entity disclosure)", () => {
    expect(new NoSessionError("x").exposesEntity).toBe(false);
    expect(new TenantMismatchError("t1", "t2").exposesEntity).toBe(false);
    expect(new PermissionDeniedError("users.manage").exposesEntity).toBe(false);
  });
});
