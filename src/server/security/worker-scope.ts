/**
 * Worker row-scope policy (DEC-062).
 *
 * Contract: docs/02_decision_log_and_scope.md DEC-062
 *   "Worker row access is assigned scope, not tenant-wide access. Workers
 *    default to no operational row access unless assigned user-specific
 *    scope grants for locations, external factories and/or task types.
 *    Owner maintains scope assignments in MVP; Accountant may view or
 *    request only. No Worker role may receive unrestricted tenant-wide
 *    write scope as a shortcut."
 *
 * Contract: docs/contracts/03_database_schema_contract.md §7.2
 *   Workers default to no operational row access unless the user has
 *   active user-specific scope assignments for locations, external
 *   factories and/or task types.
 *
 * Contract: docs/contracts/11_permission_matrix.md §13.1
 *   - Worker operational row access is default-deny.
 *   - Scope is user-specific, not tenant-wide and not role-wide.
 *   - Allowed scope dimensions are assigned locations, assigned external
 *     factories and assigned task types.
 *   - Scope controls row visibility and eligibility for operational
 *     actions, but the action still requires the role permission.
 *   - Workers must not receive unrestricted tenant-wide write access as
 *     a shortcut.
 *
 * This module is pure (no I/O, no DB). Domain packages (WP-00-03B+) will
 * feed concrete entity UUIDs into these checks once locations/factories
 * exist.
 */

import type { RoleCode } from "./role-codes";
import { isWorkerRole } from "./role-codes";

// ---------------------------------------------------------------------------
// Scope type and assignment shape (mirrors worker_scope_assignments table).
// ---------------------------------------------------------------------------

export const WORKER_SCOPE_TYPES = [
  "location",
  "external_factory",
  "task_type",
] as const;

export type WorkerScopeType = (typeof WORKER_SCOPE_TYPES)[number];

/**
 * Active scope assignment for a worker. Mirrors the
 * `worker_scope_assignments` row shape but is a plain object for in-memory
 * policy evaluation.
 */
export interface WorkerScopeAssignment {
  tenantId: string;
  userId: string;
  scopeType: WorkerScopeType;
  targetIdentifier: string;
  isActive: boolean;
  effectiveFrom?: Date;
  effectiveTo?: Date;
}

// ---------------------------------------------------------------------------
// Policy entry points.
// ---------------------------------------------------------------------------

/**
 * Returns true if the role code is a Worker-family role that is subject
 * to the DEC-062 default-deny scope rule.
 *
 * Non-Worker roles (Owner, Accountant) are NOT subject to row-scope
 * default-deny — they have tenant-wide visibility per their role
 * permissions.
 */
export function isSubjectToWorkerScope(code: RoleCode): boolean {
  return isWorkerRole(code);
}

/**
 * Filter active scope assignments for a given user at a given instant.
 *
 * "Active" means:
 *   - `isActive === true`
 *   - `effectiveFrom` is null or in the past
 *   - `effectiveTo` is null or in the future
 */
export function activeScopeAt(
  assignments: ReadonlyArray<WorkerScopeAssignment>,
  userId: string,
  now: Date = new Date(),
): WorkerScopeAssignment[] {
  return assignments.filter((a) => {
    if (a.userId !== userId) return false;
    if (!a.isActive) return false;
    if (a.effectiveFrom && a.effectiveFrom.getTime() > now.getTime()) {
      return false;
    }
    if (a.effectiveTo && a.effectiveTo.getTime() < now.getTime()) {
      return false;
    }
    return true;
  });
}

/**
 * Returns true if the user has any active scope assignment matching the
 * given scope type and target identifier at the given instant.
 */
export function hasScopeAt(
  assignments: ReadonlyArray<WorkerScopeAssignment>,
  userId: string,
  scopeType: WorkerScopeType,
  targetIdentifier: string,
  now: Date = new Date(),
): boolean {
  const active = activeScopeAt(assignments, userId, now);
  return active.some(
    (a) => a.scopeType === scopeType && a.targetIdentifier === targetIdentifier,
  );
}

/**
 * Error thrown when `isRowAccessPermitted` or `allowedTargetsFor` is called
 * with a mixed role set that includes BOTH a Worker-family role AND a
 * non-Worker role (e.g. Owner + warehouse_employee).
 *
 * The contracts do not explicitly resolve whether a multi-role user with
 * both Worker and non-Worker roles is subject to Worker scope default-deny
 * for operational row access. Per the non-invention rule, this case is:
 *
 *   Unresolved / requires owner decision
 *
 * Callers MUST catch this error and surface it as an owner-decision blocker
 * rather than guessing a policy. The two readings the owner could choose:
 *
 *   (A) Conservative: any Worker-family role triggers scope default-deny
 *       even when another role is present (stricter; matches DEC-063's
 *       precedent for financial-deny).
 *   (B) Permissive: Owner/Accountant grant tenant-wide visibility and
 *       bypass Worker scope (matches DEC-061 union-of-permissions for
 *       non-ceiling actions).
 *
 * Until the owner resolves this, mixed-role row-scope behavior is NOT
 * implemented. Pure-Worker and pure-non-Worker cases are handled normally.
 */
export class MixedWorkerRoleScopeError extends Error {
  readonly roleCodes: ReadonlyArray<RoleCode>;

  constructor(roleCodes: ReadonlyArray<RoleCode>) {
    super(
      `Unresolved / requires owner decision: mixed Worker + non-Worker role set [${roleCodes.join(", ")}] has no contracted row-scope behavior. See src/server/security/worker-scope.ts MixedWorkerRoleScopeError docs.`,
    );
    this.name = "MixedWorkerRoleScopeError";
    this.roleCodes = roleCodes;
  }
}

/**
 * Classify the role set into one of three categories:
 *   - "non-worker": no Worker-family roles (Owner/Accountant only)
 *   - "worker-only": only Worker-family roles
 *   - "mixed": both Worker and non-Worker roles — UNRESOLVED
 */
function classifyRoleSet(
  assignedRoleCodes: ReadonlyArray<RoleCode>,
): "non-worker" | "worker-only" | "mixed" {
  const hasWorker = assignedRoleCodes.some((rc) => isWorkerRole(rc));
  const hasNonWorker = assignedRoleCodes.some((rc) => !isWorkerRole(rc));
  if (hasWorker && hasNonWorker) return "mixed";
  if (hasWorker) return "worker-only";
  return "non-worker";
}

/**
 * DEC-062 default-deny check: returns true if a Worker user is permitted
 * to access an operational row at a given (scopeType, targetIdentifier).
 *
 * Returns true when:
 *   - the role set is "non-worker" (Owner/Accountant bypass scope — they
 *     have tenant-wide visibility per Contract 11 §7), OR
 *   - the role set is "worker-only" AND the user has an active scope
 *     assignment matching (scopeType, targetIdentifier).
 *
 * Returns false (default-deny) when:
 *   - the role set is "worker-only" AND no matching active scope
 *     assignment exists.
 *
 * THROWS `MixedWorkerRoleScopeError` when:
 *   - the role set is "mixed" (both Worker and non-Worker roles).
 *     This case is Unresolved / requires owner decision.
 *
 * NOTE: A scope grant NEVER grants action permission by itself
 * (Contract 03 §7.2). The caller must ALSO check the role/permission
 * for the specific action. This function only answers the row-scope
 * question.
 */
export function isRowAccessPermitted(
  assignedRoleCodes: ReadonlyArray<RoleCode>,
  assignments: ReadonlyArray<WorkerScopeAssignment>,
  userId: string,
  scopeType: WorkerScopeType,
  targetIdentifier: string,
  now: Date = new Date(),
): boolean {
  const classification = classifyRoleSet(assignedRoleCodes);

  if (classification === "mixed") {
    throw new MixedWorkerRoleScopeError(assignedRoleCodes);
  }

  if (classification === "non-worker") {
    // Owner/Accountant have tenant-wide visibility per Contract 11 §7.
    return true;
  }

  // classification === "worker-only"
  // DEC-062 default-deny: Worker needs an active matching scope assignment.
  return hasScopeAt(assignments, userId, scopeType, targetIdentifier, now);
}

/**
 * Returns the set of allowed target identifiers for a given (user,
 * scopeType) under DEC-062.
 *
 * For "non-worker" role sets, returns `undefined` to signal "unrestricted
 * tenant-wide visibility" (the caller is responsible for not interpreting
 * this as a wildcard for write — Contract 11 §13.1 says Workers must not
 * receive unrestricted tenant-wide WRITE scope; read is role-permitted).
 *
 * For "worker-only" role sets, returns the set of active target
 * identifiers. Returns `null` when the user has no active scope
 * assignments of the requested type — this is the strict default-deny
 * signal.
 *
 * THROWS `MixedWorkerRoleScopeError` when the role set is "mixed" (both
 * Worker and non-Worker roles). This case is
 * Unresolved / requires owner decision.
 */
export function allowedTargetsFor(
  assignedRoleCodes: ReadonlyArray<RoleCode>,
  assignments: ReadonlyArray<WorkerScopeAssignment>,
  userId: string,
  scopeType: WorkerScopeType,
  now: Date = new Date(),
): Set<string> | undefined | null {
  const classification = classifyRoleSet(assignedRoleCodes);

  if (classification === "mixed") {
    throw new MixedWorkerRoleScopeError(assignedRoleCodes);
  }

  if (classification === "non-worker") {
    return undefined; // unrestricted visibility
  }

  // classification === "worker-only"
  const active = activeScopeAt(assignments, userId, now).filter(
    (a) => a.scopeType === scopeType,
  );
  if (active.length === 0) return null; // strict default-deny
  return new Set(active.map((a) => a.targetIdentifier));
}
