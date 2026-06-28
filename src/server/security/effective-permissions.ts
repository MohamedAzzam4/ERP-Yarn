/**
 * Effective permission resolution (DEC-061 + DEC-063).
 *
 * Contract: docs/02_decision_log_and_scope.md DEC-061
 *   "MVP users normally have one active operational role, while the schema
 *    may remain capable of multiple role assignments for future or
 *    exceptional Owner-managed cases. MVP seeds, UI and tests must not
 *    rely on multi-role users. If multiple roles exist, effective
 *    permissions are the union of allowed actions except where a stricter
 *    denial/field ceiling applies; Worker-family financial denial always
 *    wins. Multi-role assignment is Owner-only and audited."
 *
 * Contract: docs/02_decision_log_and_scope.md DEC-063
 *   "Worker financial-deny is absolute and non-overridable in MVP. If any
 *    assigned role is a Worker-family role, [financial permissions] remain
 *    denied across UI, API, nested data, exports, logs and errors, even
 *    if another role or custom grant would otherwise allow them."
 *
 * Contract: docs/contracts/11_permission_matrix.md §6
 *   "If multiple roles exist, effective permissions are the union of
 *    allowed actions except where a stricter denial or field ceiling
 *    applies. Worker-family financial denial under DEC-063 always wins."
 *
 * This module is the single source of truth for:
 *   1. Resolving the effective permission set for a user given their
 *      assigned roles and the role-permission seed matrix.
 *   2. Applying the DEC-063 Worker financial-deny ceiling AFTER the
 *      union, so that financial permissions are stripped even if a
 *      non-Worker role would grant them.
 *   3. Resolving the effective field-visibility set (which financial
 *      fields are denied) using the same ceiling.
 *
 * WP-01-02 scope: pure functions. No I/O, no DB. The role-permission
 * matrix is passed in (from seed or from a DB query) so this module
 * remains testable in isolation.
 */
import "server-only";

import type { RoleCode } from "./role-codes";
import {
  computeWorkerFinancialDenyDecision,
  WORKER_DENIED_PERMISSION_KEYS,
  WORKER_DENIED_FIELD_KEYS,
} from "./worker-financial-deny";
import type { WorkerFinancialDenyDecision } from "./worker-financial-deny";

// ---------------------------------------------------------------------------
// 1. Input shape: role → permission-key set.
// ---------------------------------------------------------------------------

/**
 * Map from role code to the set of permission keys granted to that role.
 *
 * This is the same shape as `ROLE_PERMISSION_MATRIX` in the seed file.
 * It is passed in (not imported) so that:
 *   - Tests can construct synthetic matrices.
 *   - Future runtime code can fetch the matrix from the DB (role_permissions
 *     table) and pass it in.
 *   - This module has no dependency on the seed file.
 */
export type RolePermissionMatrix = Record<RoleCode, ReadonlySet<string>>;

// ---------------------------------------------------------------------------
// 2. Effective permission resolution result.
// ---------------------------------------------------------------------------

/**
 * The result of resolving effective permissions for a user.
 *
 * - `permissionKeys` is the effective set after DEC-061 union and DEC-063
 *   ceiling application.
 * - `workerFinancialDeny` is the DEC-063 decision (whether the ceiling
 *   applied, and if so, which keys/fields were stripped).
 * - `assignedRoleCodes` is echoed back for auditability.
 */
export interface EffectivePermissions {
  /** The role codes the user has been assigned (echoed for audit). */
  assignedRoleCodes: ReadonlyArray<RoleCode>;
  /**
   * The effective permission-key set after DEC-061 union and DEC-063
   * Worker financial-deny ceiling.
   *
   * If the user has any Worker-family role, financial permission keys
   * (WORKER_DENIED_PERMISSION_KEYS) are ABSENT from this set even if a
   * non-Worker role would have granted them.
   */
  permissionKeys: ReadonlySet<string>;
  /**
   * The DEC-063 Worker financial-deny decision. `enforced: true` means
   * the user has at least one Worker-family role and the ceiling was
   * applied.
   */
  workerFinancialDeny: WorkerFinancialDenyDecision;
}

// ---------------------------------------------------------------------------
// 3. Core resolver.
// ---------------------------------------------------------------------------

/**
 * Resolve the effective permission set for a user.
 *
 * Algorithm:
 *   1. DEC-061 UNION: Start with an empty set. For each assigned role,
 *      union in the permission keys granted to that role by the matrix.
 *   2. DEC-063 CEILING: If any assigned role is a Worker-family role,
 *      remove every key in WORKER_DENIED_PERMISSION_KEYS from the
 *      effective set — even if a non-Worker role granted it.
 *   3. Return the result with the Worker financial-deny decision attached
 *      for downstream field-redaction.
 *
 * Pure function. No I/O.
 *
 * @param assignedRoleCodes - The user's assigned role codes (typically 1
 *   in MVP; may be more for Owner-managed exceptional cases).
 * @param matrix - The role-permission matrix (from seed or DB).
 */
export function resolveEffectivePermissions(
  assignedRoleCodes: ReadonlyArray<RoleCode>,
  matrix: RolePermissionMatrix,
): EffectivePermissions {
  // Step 1: DEC-061 union.
  const unioned = new Set<string>();
  for (const roleCode of assignedRoleCodes) {
    const rolePerms = matrix[roleCode];
    if (!rolePerms) {
      // Unknown role — treat as no permissions. This is fail-safe: an
      // unknown role cannot grant anything. (It also cannot be a Worker
      // role, so the DEC-063 ceiling won't trigger from it.)
      continue;
    }
    for (const key of rolePerms) {
      unioned.add(key);
    }
  }

  // Step 2: DEC-063 Worker financial-deny ceiling.
  const denyDecision = computeWorkerFinancialDenyDecision(assignedRoleCodes);
  if (denyDecision.enforced) {
    for (const deniedKey of denyDecision.deniedPermissionKeys) {
      unioned.delete(deniedKey);
    }
  }

  return {
    assignedRoleCodes,
    permissionKeys: unioned,
    workerFinancialDeny: denyDecision,
  };
}

// ---------------------------------------------------------------------------
// 4. Permission-check helpers.
// ---------------------------------------------------------------------------

/**
 * Check whether a user's effective permissions include a specific key.
 *
 * This is the primary permission-check function used by guard helpers.
 * It does NOT re-resolve permissions — it operates on a pre-resolved
 * EffectivePermissions object (callers should cache the resolution per
 * request).
 */
export function hasPermission(
  effective: EffectivePermissions,
  permissionKey: string,
): boolean {
  return effective.permissionKeys.has(permissionKey);
}

/**
 * Check whether a user's effective permissions include ANY of the given
 * keys. Useful for "any-of" permission checks.
 */
export function hasAnyPermission(
  effective: EffectivePermissions,
  permissionKeys: ReadonlyArray<string>,
): boolean {
  return permissionKeys.some((k) => effective.permissionKeys.has(k));
}

/**
 * Check whether a user's effective permissions include ALL of the given
 * keys. Useful for "all-of" permission checks (rare — most checks are
 * single-key).
 */
export function hasAllPermissions(
  effective: EffectivePermissions,
  permissionKeys: ReadonlyArray<string>,
): boolean {
  return permissionKeys.every((k) => effective.permissionKeys.has(k));
}

// ---------------------------------------------------------------------------
// 5. Field-visibility resolution.
// ---------------------------------------------------------------------------

/**
 * The set of field keys that should be redacted from a user's responses.
 *
 * For users with the Worker financial-deny ceiling (DEC-063), this is the
 * full WORKER_DENIED_FIELD_KEYS set. For Owner/Accountant without a Worker
 * role, this is the empty set (no redaction).
 *
 * This does NOT cover role-specific field scoping (e.g. Accountant cannot
 * see audit financial old/new values per Contract 11 §8 — that is a
 * narrower restriction handled by role-specific redactors, not the
 * Worker ceiling).
 */
export function deniedFieldKeys(
  effective: EffectivePermissions,
): ReadonlySet<string> {
  if (effective.workerFinancialDeny.enforced) {
    return effective.workerFinancialDeny.deniedFieldKeys;
  }
  return new Set<string>();
}

/**
 * Check whether a specific field key should be redacted from a user's
 * response, considering the Worker financial-deny ceiling.
 *
 * This only answers the Worker-ceiling question. Role-specific field
 * restrictions (e.g. Accountant audit-value restriction) must be checked
 * separately by the redaction layer.
 */
export function isFieldDenied(
  effective: EffectivePermissions,
  fieldKey: string,
): boolean {
  return deniedFieldKeys(effective).has(fieldKey);
}

// ---------------------------------------------------------------------------
// 6. Re-exports for convenience (single import point for guards).
// ---------------------------------------------------------------------------

export {
  WORKER_DENIED_PERMISSION_KEYS,
  WORKER_DENIED_FIELD_KEYS,
} from "./worker-financial-deny";
