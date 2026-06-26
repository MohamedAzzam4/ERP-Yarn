/**
 * WP-00-03A package gate tests — Worker row-scope default-deny (DEC-062).
 *
 * Contract: docs/02_decision_log_and_scope.md DEC-062
 *   "Worker row access is assigned scope, not tenant-wide access. Workers
 *    default to no operational row access unless assigned user-specific
 *    scope grants for locations, external factories and/or task types.
 *    Owner maintains scope assignments in MVP; Accountant may view or
 *    request only. No Worker role may receive unrestricted tenant-wide
 *    write scope as a shortcut."
 *
 * Contract: docs/contracts/11_permission_matrix.md §13.1
 *
 * These tests verify the pure policy module in
 * `src/server/security/worker-scope.ts`. No DB, no I/O.
 */

import { describe, it, expect } from "vitest";
import {
  isSubjectToWorkerScope,
  activeScopeAt,
  hasScopeAt,
  isRowAccessPermitted,
  allowedTargetsFor,
  WORKER_SCOPE_TYPES,
  MixedWorkerRoleScopeError,
} from "../worker-scope";
import type { WorkerScopeAssignment } from "../worker-scope";
import type { RoleCode } from "../role-codes";
import { isPermissionDeniedByWorkerCeiling } from "../worker-financial-deny";

const TENANT = "00000000-0000-0000-0000-000000000001";
const WAREHOUSE_USER = "00000000-0000-0000-0000-000000000a01";
const OWNER_USER = "00000000-0000-0000-0000-000000000a02";

const LOCATION_A = "loc-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const LOCATION_B = "loc-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2";
const FACTORY_X = "fac-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxx1";

const now = new Date("2026-06-25T12:00:00Z");
const past = new Date("2026-01-01T00:00:00Z");
const future = new Date("2027-01-01T00:00:00Z");

const assignments: WorkerScopeAssignment[] = [
  {
    tenantId: TENANT,
    userId: WAREHOUSE_USER,
    scopeType: "location",
    targetIdentifier: LOCATION_A,
    isActive: true,
    effectiveFrom: undefined,
    effectiveTo: undefined,
  },
  {
    tenantId: TENANT,
    userId: WAREHOUSE_USER,
    scopeType: "external_factory",
    targetIdentifier: FACTORY_X,
    isActive: true,
    effectiveFrom: past,
    effectiveTo: future,
  },
  // Inactive assignment — should be ignored.
  {
    tenantId: TENANT,
    userId: WAREHOUSE_USER,
    scopeType: "location",
    targetIdentifier: LOCATION_B,
    isActive: false,
    effectiveFrom: undefined,
    effectiveTo: undefined,
  },
  // Future-dated assignment — not yet active.
  {
    tenantId: TENANT,
    userId: WAREHOUSE_USER,
    scopeType: "task_type",
    targetIdentifier: "future-task",
    isActive: true,
    effectiveFrom: future,
    effectiveTo: undefined,
  },
  // Expired assignment — no longer active.
  {
    tenantId: TENANT,
    userId: WAREHOUSE_USER,
    scopeType: "task_type",
    targetIdentifier: "expired-task",
    isActive: true,
    effectiveFrom: past,
    effectiveTo: past,
  },
];

describe("WORKER_SCOPE_TYPES", () => {
  it("contains exactly the three scope dimensions per Contract 11 §13.1", () => {
    expect([...WORKER_SCOPE_TYPES]).toEqual([
      "location",
      "external_factory",
      "task_type",
    ]);
  });
});

describe("isSubjectToWorkerScope", () => {
  it("returns true for warehouse_employee", () => {
    expect(isSubjectToWorkerScope("warehouse_employee")).toBe(true);
  });
  it("returns true for production_employee", () => {
    expect(isSubjectToWorkerScope("production_employee")).toBe(true);
  });
  it("returns true for quality_employee", () => {
    expect(isSubjectToWorkerScope("quality_employee")).toBe(true);
  });
  it("returns false for owner (tenant-wide visibility)", () => {
    expect(isSubjectToWorkerScope("owner")).toBe(false);
  });
  it("returns false for accountant (tenant-wide visibility)", () => {
    expect(isSubjectToWorkerScope("accountant")).toBe(false);
  });
});

describe("activeScopeAt", () => {
  it("returns only active, currently-effective assignments for the user", () => {
    const active = activeScopeAt(assignments, WAREHOUSE_USER, now);
    expect(active.length).toBe(2); // LOCATION_A + FACTORY_X
    expect(active.some((a) => a.targetIdentifier === LOCATION_A)).toBe(true);
    expect(active.some((a) => a.targetIdentifier === FACTORY_X)).toBe(true);
  });

  it("excludes inactive assignments", () => {
    const active = activeScopeAt(assignments, WAREHOUSE_USER, now);
    expect(active.some((a) => a.targetIdentifier === LOCATION_B)).toBe(false);
  });

  it("excludes future-dated assignments", () => {
    const active = activeScopeAt(assignments, WAREHOUSE_USER, now);
    expect(active.some((a) => a.targetIdentifier === "future-task")).toBe(false);
  });

  it("excludes expired assignments", () => {
    const active = activeScopeAt(assignments, WAREHOUSE_USER, now);
    expect(active.some((a) => a.targetIdentifier === "expired-task")).toBe(false);
  });

  it("returns empty array when the user has no assignments", () => {
    const NO_ASSIGNMENTS_USER = "00000000-0000-0000-0000-000000000a99";
    expect(activeScopeAt(assignments, NO_ASSIGNMENTS_USER, now)).toEqual([]);
  });
});

describe("hasScopeAt", () => {
  it("returns true for an active matching scope", () => {
    expect(
      hasScopeAt(assignments, WAREHOUSE_USER, "location", LOCATION_A, now),
    ).toBe(true);
  });

  it("returns false for an inactive matching scope", () => {
    expect(
      hasScopeAt(assignments, WAREHOUSE_USER, "location", LOCATION_B, now),
    ).toBe(false);
  });

  it("returns false for a scope the user does not have", () => {
    expect(
      hasScopeAt(
        assignments,
        WAREHOUSE_USER,
        "external_factory",
        "factory-not-assigned",
        now,
      ),
    ).toBe(false);
  });
});

describe("isRowAccessPermitted (DEC-062 default-deny)", () => {
  it("returns true for Owner regardless of scope (tenant-wide visibility)", () => {
    // Owner has no assignments at all.
    const emptyAssignments: WorkerScopeAssignment[] = [];
    expect(
      isRowAccessPermitted(
        ["owner"],
        emptyAssignments,
        OWNER_USER,
        "location",
        LOCATION_A,
        now,
      ),
    ).toBe(true);
  });

  it("returns true for Accountant regardless of scope (tenant-wide visibility)", () => {
    const emptyAssignments: WorkerScopeAssignment[] = [];
    expect(
      isRowAccessPermitted(
        ["accountant"],
        emptyAssignments,
        OWNER_USER,
        "location",
        LOCATION_A,
        now,
      ),
    ).toBe(true);
  });

  it("returns true for a Worker with a matching active scope assignment", () => {
    expect(
      isRowAccessPermitted(
        ["warehouse_employee"],
        assignments,
        WAREHOUSE_USER,
        "location",
        LOCATION_A,
        now,
      ),
    ).toBe(true);
  });

  it("returns false (default-deny) for a Worker with no matching scope assignment", () => {
    expect(
      isRowAccessPermitted(
        ["warehouse_employee"],
        assignments,
        WAREHOUSE_USER,
        "location",
        LOCATION_B, // assignment exists but is inactive
        now,
      ),
    ).toBe(false);
  });

  it("returns false (default-deny) for a Worker with no assignments at all", () => {
    const emptyAssignments: WorkerScopeAssignment[] = [];
    expect(
      isRowAccessPermitted(
        ["warehouse_employee"],
        emptyAssignments,
        WAREHOUSE_USER,
        "location",
        LOCATION_A,
        now,
      ),
    ).toBe(false);
  });

  it("returns false (default-deny) for a Worker accessing an unassigned factory", () => {
    expect(
      isRowAccessPermitted(
        ["warehouse_employee"],
        assignments,
        WAREHOUSE_USER,
        "external_factory",
        "factory-not-assigned",
        now,
      ),
    ).toBe(false);
  });

  it("returns true for a Worker with a matching active factory assignment", () => {
    expect(
      isRowAccessPermitted(
        ["warehouse_employee"],
        assignments,
        WAREHOUSE_USER,
        "external_factory",
        FACTORY_X,
        now,
      ),
    ).toBe(true);
  });

  it("THROWS MixedWorkerRoleScopeError for Owner+warehouse_employee (Unresolved / requires owner decision)", () => {
    // The contracts do not explicitly resolve whether a multi-role user
    // with BOTH Worker and non-Worker roles is subject to Worker scope
    // default-deny for operational row access. Per the non-invention
    // rule, this case is Unresolved / requires owner decision.
    //
    // The function throws rather than guessing. Callers must catch and
    // surface as an owner-decision blocker.
    expect(() =>
      isRowAccessPermitted(
        ["owner", "warehouse_employee"],
        assignments,
        WAREHOUSE_USER,
        "location",
        LOCATION_B,
        now,
      ),
    ).toThrow(MixedWorkerRoleScopeError);
  });

  it("THROWS MixedWorkerRoleScopeError for Accountant+production_employee", () => {
    expect(() =>
      isRowAccessPermitted(
        ["accountant", "production_employee"],
        assignments,
        WAREHOUSE_USER,
        "location",
        LOCATION_A,
        now,
      ),
    ).toThrow(MixedWorkerRoleScopeError);
  });

  it("THROWS MixedWorkerRoleScopeError for all five roles assigned", () => {
    expect(() =>
      isRowAccessPermitted(
        ["owner", "accountant", "warehouse_employee", "production_employee", "quality_employee"],
        assignments,
        WAREHOUSE_USER,
        "location",
        LOCATION_A,
        now,
      ),
    ).toThrow(MixedWorkerRoleScopeError);
  });
});

describe("allowedTargetsFor", () => {
  it("returns undefined for Owner (unrestricted tenant-wide visibility)", () => {
    expect(
      allowedTargetsFor(["owner"], assignments, OWNER_USER, "location", now),
    ).toBeUndefined();
  });

  it("returns undefined for Accountant", () => {
    expect(
      allowedTargetsFor(["accountant"], assignments, OWNER_USER, "location", now),
    ).toBeUndefined();
  });

  it("returns the active target set for a Worker with assignments", () => {
    const targets = allowedTargetsFor(
      ["warehouse_employee"],
      assignments,
      WAREHOUSE_USER,
      "location",
      now,
    );
    expect(targets).toBeInstanceOf(Set);
    expect(targets?.has(LOCATION_A)).toBe(true);
    expect(targets?.has(LOCATION_B)).toBe(false); // inactive
  });

  it("returns null (strict default-deny) for a Worker with NO active assignments of the requested type", () => {
    const targets = allowedTargetsFor(
      ["warehouse_employee"],
      assignments,
      WAREHOUSE_USER,
      "task_type",
      now,
    );
    expect(targets).toBeNull();
  });

  it("returns an empty set for a Worker with no assignments at all? — no, returns null", () => {
    // Per the function contract: a Worker with no active scope assignments
    // of the requested type gets `null` (default-deny), NOT an empty set.
    const emptyAssignments: WorkerScopeAssignment[] = [];
    const targets = allowedTargetsFor(
      ["warehouse_employee"],
      emptyAssignments,
      WAREHOUSE_USER,
      "location",
      now,
    );
    expect(targets).toBeNull();
  });
});

describe("DEC-062 invariant: no Worker role receives tenant-wide write scope", () => {
  // This is a contract-level invariant. The isRowAccessPermitted function
  // enforces it: a Worker NEVER gets `true` for an unassigned target,
  // regardless of how many assignments exist for OTHER targets.
  it("a Worker with 100 location assignments is still denied access to the 101st", () => {
    const manyAssignments: WorkerScopeAssignment[] = Array.from(
      { length: 100 },
      (_, i) => ({
        tenantId: TENANT,
        userId: WAREHOUSE_USER,
        scopeType: "location" as const,
        targetIdentifier: `loc-${i.toString().padStart(3, "0")}`,
        isActive: true,
      }),
    );
    expect(
      isRowAccessPermitted(
        ["warehouse_employee"],
        manyAssignments,
        WAREHOUSE_USER,
        "location",
        "loc-999-not-assigned",
        now,
      ),
    ).toBe(false);
  });
});

describe("DEC-061 + DEC-062 + DEC-063 cross-policy sanity", () => {
  // A user with Owner + warehouse_employee roles:
  //   - DEC-061 union: has Owner's permissions for action checks.
  //   - DEC-062 scope: MIXED role set — row-scope behavior is
  //     Unresolved / requires owner decision. isRowAccessPermitted
  //     throws MixedWorkerRoleScopeError. The test above verifies the
  //     throw.
  //   - DEC-063 financial-deny: Worker-family financial denial WINS even
  //     though Owner would otherwise permit financial access. This IS
  //     resolved and is verified in worker-financial-deny.test.ts.
  it("Owner+warehouse_employee financial-deny IS resolved (DEC-063 absolute ceiling)", () => {
    // This is a sanity check that the financial-deny side of the
    // mixed-role combination is handled (resolved by DEC-063), even
    // though the row-scope side is unresolved.
    expect(
      isPermissionDeniedByWorkerCeiling(
        ["owner", "warehouse_employee"],
        "sales.view_price",
      ),
    ).toBe(true);
  });
});
