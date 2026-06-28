/**
 * Backend permission guard utilities.
 *
 * Contract: docs/contracts/11_permission_matrix.md §11 "Backend Enforcement
 *   and Filtering"
 *   "Every endpoint/service/query:
 *     1. authenticates Supabase user server-side;
 *     2. maps active ERP user/tenant;
 *     3. checks stable permission key/action;
 *     4. enforces tenant/row scope;
 *     5. selects only allowed fields or maps role-safe DTO;
 *     6. executes state/business checks;
 *     7. audits sensitive actions.
 *   Never fetch all financial fields and rely on UI hiding. Worker
 *   responses omit restricted properties, including nested snapshots,
 *   errors, exports and chart aggregates. RLS is defense in depth;
 *   service-role access still applies ERP authorization."
 *
 * Contract: docs/contracts/11_permission_matrix.md §17 "API Implications"
 *   "Every high-risk API declares one permission. Handler checks before
 *   entity disclosure; service rechecks critical authority/state. Body
 *   cannot claim role/tenant/approver. Forbidden worker financial fields
 *   are rejected, not silently accepted."
 *
 * Contract: docs/contracts/01_technical_architecture_and_deployment_contract.md
 *   §Supabase Auth: "never trust tenant_id, role, permission, or approval
 *   authority from request-body fields"
 *
 * Contract: docs/contracts/09_api_contracts.md §5 "Common API Requirements"
 *   "Do not accept authoritative tenant_id, actor, role, approval status,
 *   calculated balance, stock delta, cost, payable sign, or profitability
 *   total from the request body."
 *
 * This module provides the guard helpers that implement steps 1-4 of the
 * Backend Enforcement pipeline. Step 5 (field selection / DTO mapping) is
 * handled by `redaction.ts`. Steps 6-7 (state/business checks, audit) are
 * domain-package concerns.
 *
 * WP-01-02 scope: pure guard functions and error types. No I/O, no DB.
 * The authenticated ERP context is passed in (resolved by `erp-context.ts`
 * from the Supabase session).
 */
import "server-only";

import type { ErpUserContext } from "@/server/auth/erp-context";
import type { RoleCode } from "./role-codes";
import { isWorkerRole } from "./role-codes";
import type {
  EffectivePermissions,
  RolePermissionMatrix,
} from "./effective-permissions";
import { resolveEffectivePermissions, hasPermission } from "./effective-permissions";
import {
  isRowAccessPermitted,
  MixedWorkerRoleScopeError,
  type WorkerScopeAssignment,
  type WorkerScopeType,
} from "./worker-scope";
import {
  isPermissionDeniedByWorkerCeiling,
} from "./worker-financial-deny";

// ---------------------------------------------------------------------------
// 1. Guard error types.
// ---------------------------------------------------------------------------

/**
 * Base class for all guard denials. Carries a stable `code` for HTTP
 * response mapping and an `exposesEntity` flag that tells the caller
 * whether the entity being accessed was already disclosed (it should
 * always be false — guards must deny BEFORE entity disclosure).
 */
export abstract class GuardError extends Error {
  abstract readonly code: GuardErrorCode;
  readonly exposesEntity: boolean = false;
  readonly tenantId?: string;
  readonly userId?: string;

  constructor(message: string, opts?: { tenantId?: string; userId?: string }) {
    super(message);
    this.name = this.constructor.name;
    if (opts?.tenantId) this.tenantId = opts.tenantId;
    if (opts?.userId) this.userId = opts.userId;
  }
}

export type GuardErrorCode =
  | "no_session"
  | "unmapped"
  | "inactive"
  | "tenant_mismatch"
  | "permission_denied"
  | "row_scope_denied"
  | "forbidden_field_in_request"
  | "body_claims_authority"
  | "mixed_worker_role_scope_unresolved";

export class NoSessionError extends GuardError {
  readonly code = "no_session";
}

export class UnmappedUserError extends GuardError {
  readonly code = "unmapped";
}

export class InactiveUserError extends GuardError {
  readonly code = "inactive";
}

export class TenantMismatchError extends GuardError {
  readonly code = "tenant_mismatch";
  readonly requestedTenantId: string;
  readonly userTenantId: string;

  constructor(
    userTenantId: string,
    requestedTenantId: string,
    opts?: { userId?: string },
  ) {
    super(
      `Tenant mismatch: user tenant '${userTenantId}' cannot access entity in tenant '${requestedTenantId}'.`,
      { ...opts, tenantId: userTenantId },
    );
    this.userTenantId = userTenantId;
    this.requestedTenantId = requestedTenantId;
  }
}

export class PermissionDeniedError extends GuardError {
  readonly code = "permission_denied";
  readonly permissionKey: string;

  constructor(
    permissionKey: string,
    opts?: { tenantId?: string; userId?: string },
  ) {
    super(
      `Permission denied: requires '${permissionKey}'.`,
      opts,
    );
    this.permissionKey = permissionKey;
  }
}

export class RowScopeDeniedError extends GuardError {
  readonly code = "row_scope_denied";
  readonly scopeType: WorkerScopeType;
  readonly targetIdentifier: string;

  constructor(
    scopeType: WorkerScopeType,
    targetIdentifier: string,
    opts?: { tenantId?: string; userId?: string },
  ) {
    super(
      `Row-scope denied: user has no active scope assignment for ${scopeType}='${targetIdentifier}' (DEC-062 default-deny).`,
      opts,
    );
    this.scopeType = scopeType;
    this.targetIdentifier = targetIdentifier;
  }
}

/**
 * Thrown when a request body contains a forbidden Worker financial field
 * (DEC-063). The field is REJECTED, not silently accepted — per Contract
 * 11 §17: "Forbidden worker financial fields are rejected, not silently
 * accepted."
 */
export class ForbiddenFieldInRequestError extends GuardError {
  readonly code = "forbidden_field_in_request";
  readonly fieldKey: string;

  constructor(
    fieldKey: string,
    opts?: { tenantId?: string; userId?: string },
  ) {
    super(
      `Forbidden field in request: '${fieldKey}' is a Worker-restricted financial field (DEC-063) and cannot be submitted by a Worker-family user.`,
      opts,
    );
    this.fieldKey = fieldKey;
  }
}

/**
 * Thrown when a request body claims an authority field (tenant_id, role,
 * permission, approver, actor) that must come from server context only.
 *
 * Contract 09 §5: "Do not accept authoritative tenant_id, actor, role,
 * approval status, calculated balance, stock delta, cost, payable sign,
 * or profitability total from the request body."
 */
export class BodyClaimsAuthorityError extends GuardError {
  readonly code = "body_claims_authority";
  readonly claimedField: string;

  constructor(
    claimedField: string,
    opts?: { tenantId?: string; userId?: string },
  ) {
    super(
      `Request body claims authority field '${claimedField}'. Authority fields (tenant_id, role, permission, approver, actor) must come from server-authenticated ERP context, not request body (Contract 09 §5).`,
      opts,
    );
    this.claimedField = claimedField;
  }
}

/**
 * Wrapper for the MixedWorkerRoleScopeError from worker-scope.ts, exposed
 * as a GuardError so route handlers can catch it uniformly.
 */
export class MixedWorkerRoleScopeGuardError extends GuardError {
  readonly code = "mixed_worker_role_scope_unresolved";
  readonly roleCodes: ReadonlyArray<RoleCode>;

  constructor(
    roleCodes: ReadonlyArray<RoleCode>,
    opts?: { tenantId?: string; userId?: string },
  ) {
    super(
      `Unresolved / requires owner decision: mixed Worker + non-Worker role set [${roleCodes.join(", ")}] has no contracted row-scope behavior (see src/server/security/worker-scope.ts MixedWorkerRoleScopeError).`,
      opts,
    );
    this.roleCodes = roleCodes;
  }
}

// ---------------------------------------------------------------------------
// 2. Guard: require authenticated ERP context.
// ---------------------------------------------------------------------------

/**
 * Require an authenticated ERP user context.
 *
 * Accepts an `ErpUserContext | ErpAuthDenial` (the result of
 * `getErpAuthContext()`) and returns the context if authenticated, or
 * throws the appropriate GuardError if not.
 *
 * Implements Backend Enforcement step 1-2 (authenticate + map ERP user).
 */
export function requireAuthenticatedErpContext(
  authResult:
    | ErpUserContext
    | { authenticated: false; reason: "no_session" | "unmapped" | "inactive" },
): ErpUserContext {
  if (authResult.authenticated) {
    return authResult;
  }
  switch (authResult.reason) {
    case "no_session":
      throw new NoSessionError("No authenticated session.");
    case "unmapped":
      throw new UnmappedUserError("Supabase Auth user is not mapped to an ERP user.");
    case "inactive":
      throw new InactiveUserError("ERP user is inactive.");
  }
}

// ---------------------------------------------------------------------------
// 3. Guard: require tenant match.
// ---------------------------------------------------------------------------

/**
 * Require that the authenticated user's tenant matches the entity's
 * tenant. Implements Backend Enforcement step 4 (tenant scope).
 *
 * The entity's tenant_id must come from the database row, NOT from the
 * request body. If you have an entity from a trusted source (DB query
 * result), pass its `tenantId` here. If the entity doesn't exist or
 * belongs to a different tenant, this guard denies.
 *
 * Note: a "not found" entity should be reported as a 404 by the caller,
 * NOT as a tenant mismatch — this guard is for when you have a real
 * entity with a tenant_id that differs from the user's.
 */
export function requireTenantMatch(
  user: ErpUserContext,
  entityTenantId: string,
): void {
  if (user.tenantId !== entityTenantId) {
    throw new TenantMismatchError(user.tenantId, entityTenantId, {
      userId: user.userId,
    });
  }
}

// ---------------------------------------------------------------------------
// 4. Guard: require permission.
// ---------------------------------------------------------------------------

/**
 * Require that the user's effective permissions include the given key.
 * Implements Backend Enforcement step 3 (permission check).
 *
 * This guard MUST be called BEFORE entity disclosure — i.e. before the
 * entity is fetched or, if it must be fetched for the tenant check, the
 * response is mapped through a role-safe DTO before being returned.
 *
 * @param effective - The user's resolved effective permissions.
 * @param permissionKey - The stable permission key required for this action.
 */
export function requirePermission(
  effective: EffectivePermissions,
  permissionKey: string,
): void {
  if (!hasPermission(effective, permissionKey)) {
    throw new PermissionDeniedError(permissionKey, {
      // EffectivePermissions doesn't carry tenant/user IDs (it's pure);
      // the caller should attach them via the error's opts if needed.
    });
  }
}

/**
 * Require that the user's effective permissions include ANY of the given
 * keys. Useful for "any-of" permission checks.
 */
export function requireAnyPermission(
  effective: EffectivePermissions,
  permissionKeys: ReadonlyArray<string>,
): void {
  if (!permissionKeys.some((k) => hasPermission(effective, k))) {
    throw new PermissionDeniedError(
      permissionKeys.join(" | "),
    );
  }
}

// ---------------------------------------------------------------------------
// 5. Guard: require role (rare — prefer permission checks).
// ---------------------------------------------------------------------------

/**
 * Require that the user has at least one of the specified roles.
 *
 * NOTE: Permission checks (requirePermission) are preferred over role
 * checks because they are more granular and survive role-permission
 * reassignment. Use requireRole only when the contract explicitly
 * requires a specific role (e.g. DEC-032: only Owner manages users —
 * this is a role check, not a permission check, because the permission
 * matrix grants `users.manage` only to Owner anyway, but the contract
 * language is role-based).
 *
 * Per Contract 11 §17: "Every high-risk API declares one permission."
 * Role checks are the exception, not the rule.
 */
export function requireRole(
  assignedRoleCodes: ReadonlyArray<RoleCode>,
  allowedRoles: ReadonlyArray<RoleCode>,
): void {
  const hasAllowed = assignedRoleCodes.some((rc) =>
    (allowedRoles as ReadonlyArray<string>).includes(rc),
  );
  if (!hasAllowed) {
    throw new PermissionDeniedError(
      `role:${allowedRoles.join("|")}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 6. Guard: worker row-scope eligibility (DEC-062).
// ---------------------------------------------------------------------------

/**
 * Require that a Worker user has row access to the given (scopeType,
 * targetIdentifier).
 *
 * Implements Backend Enforcement step 4 (row scope) for Worker roles.
 *
 * Per DEC-062: Worker operational row access is default-deny. Scope is
 * user-specific, not tenant-wide. Allowed scope dimensions are assigned
 * locations, external factories and assigned task types.
 *
 * For non-Worker roles (Owner, Accountant), this guard is a no-op (they
 * have tenant-wide visibility per Contract 11 §7).
 *
 * For mixed Worker + non-Worker role sets, this guard THROWS
 * MixedWorkerRoleScopeGuardError because that case is
 * "Unresolved / requires owner decision" (see worker-scope.ts).
 *
 * NOTE: A scope grant NEVER grants action permission by itself
 * (Contract 03 §7.2). The caller must ALSO call requirePermission for
 * the specific action. This guard only answers the row-scope question.
 */
export function requireRowScope(
  assignedRoleCodes: ReadonlyArray<RoleCode>,
  assignments: ReadonlyArray<WorkerScopeAssignment>,
  user: ErpUserContext,
  scopeType: WorkerScopeType,
  targetIdentifier: string,
  now: Date = new Date(),
): void {
  try {
    const permitted = isRowAccessPermitted(
      assignedRoleCodes,
      assignments,
      user.userId,
      scopeType,
      targetIdentifier,
      now,
    );
    if (!permitted) {
      throw new RowScopeDeniedError(scopeType, targetIdentifier, {
        tenantId: user.tenantId,
        userId: user.userId,
      });
    }
  } catch (e) {
    if (e instanceof MixedWorkerRoleScopeError) {
      throw new MixedWorkerRoleScopeGuardError(e.roleCodes, {
        tenantId: user.tenantId,
        userId: user.userId,
      });
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// 7. Guard: reject forbidden Worker financial fields in request body.
// ---------------------------------------------------------------------------

/**
 * Require that a request body does not contain any forbidden Worker
 * financial fields (DEC-063).
 *
 * Per Contract 11 §17: "Forbidden worker financial fields are rejected,
 * not silently accepted."
 *
 * This guard is called by route handlers / services when a Worker-family
 * user submits a request. It scans the body for any key in
 * WORKER_DENIED_FIELD_KEYS and throws ForbiddenFieldInRequestError if
 * found.
 *
 * IMPORTANT: This is NOT a substitute for field redaction in responses.
 * It only prevents Workers from WRITING financial fields. Response-side
 * redaction is handled by `redaction.ts`.
 *
 * @param assignedRoleCodes - The user's assigned roles.
 * @param body - The parsed request body (any object).
 * @param knownFinancialFieldKeys - The set of financial field keys to
 *   reject. Defaults to WORKER_DENIED_FIELD_KEYS. Callers can pass a
 *   narrower set if the endpoint only accepts a subset of financial
 *   fields.
 */
export function rejectForbiddenWorkerFields(
  assignedRoleCodes: ReadonlyArray<RoleCode>,
  body: Record<string, unknown>,
  knownFinancialFieldKeys: ReadonlySet<string> = WORKER_DENIED_FIELD_KEYS_DEFAULT,
): void {
  // Only applies to Worker-family users.
  if (!assignedRoleCodes.some((rc) => isWorkerRole(rc))) {
    return;
  }

  for (const fieldKey of Object.keys(body)) {
    if (knownFinancialFieldKeys.has(fieldKey)) {
      throw new ForbiddenFieldInRequestError(fieldKey);
    }
  }
}

// Default import to avoid circular dependency at module-eval time.
import { WORKER_DENIED_FIELD_KEYS } from "./worker-financial-deny";
const WORKER_DENIED_FIELD_KEYS_DEFAULT: ReadonlySet<string> = WORKER_DENIED_FIELD_KEYS;

// ---------------------------------------------------------------------------
// 8. Guard: reject authority-claiming fields in request body.
// ---------------------------------------------------------------------------

/**
 * The set of request-body field names that claim authority and must
 * NEVER be accepted from the client.
 *
 * Source: Contract 09 §5 + Contract 01 §Supabase Auth.
 *
 * These fields must come from the server-authenticated ERP context, not
 * the request body. If any of them appear in a request body, the request
 * is rejected.
 */
export const AUTHORITY_CLAIMING_BODY_FIELDS: ReadonlySet<string> = new Set([
  "tenant_id",
  "tenantId",
  "role",
  "role_code",
  "roleCode",
  "permission",
  "permission_key",
  "permissionKey",
  "approver",
  "approver_id",
  "approverId",
  "actor",
  "actor_id",
  "actorId",
  "user_id",
  "userId",
  "auth_id",
  "authId",
]);

/**
 * Require that a request body does not contain any authority-claiming
 * fields.
 *
 * Per Contract 09 §5: "Do not accept authoritative tenant_id, actor,
 * role, approval status, calculated balance, stock delta, cost, payable
 * sign, or profitability total from the request body."
 *
 * This guard scans the body (shallow — top-level keys only) for any
 * field in AUTHORITY_CLAIMING_BODY_FIELDS and throws
 * BodyClaimsAuthorityError if found.
 *
 * NOTE: This is a shallow check. Deep nested authority-claiming fields
 * (e.g. inside a nested object) should be caught by request-schema
 * validation (Zod) in the route handler. This guard is a backstop for
 * routes that don't yet have schema validation.
 */
export function rejectBodyClaimsAuthority(
  body: Record<string, unknown>,
): void {
  for (const fieldKey of Object.keys(body)) {
    if (AUTHORITY_CLAIMING_BODY_FIELDS.has(fieldKey)) {
      throw new BodyClaimsAuthorityError(fieldKey);
    }
  }
}

// ---------------------------------------------------------------------------
// 9. Convenience: resolve-and-check pipeline.
// ---------------------------------------------------------------------------

/**
 * Resolve the user's effective permissions and check that they include
 * the required permission key.
 *
 * This is a convenience that combines `resolveEffectivePermissions` +
 * `requirePermission`. Use it in route handlers / services that need
 * both steps. The resolved EffectivePermissions object is returned so
 * the caller can pass it to redaction helpers.
 *
 * @param assignedRoleCodes - The user's assigned role codes.
 * @param matrix - The role-permission matrix.
 * @param permissionKey - The required permission key.
 * @returns The resolved EffectivePermissions (for downstream redaction).
 * @throws PermissionDeniedError if the user lacks the permission.
 */
export function resolveAndRequirePermission(
  assignedRoleCodes: ReadonlyArray<RoleCode>,
  matrix: RolePermissionMatrix,
  permissionKey: string,
): EffectivePermissions {
  const effective = resolveEffectivePermissions(assignedRoleCodes, matrix);
  requirePermission(effective, permissionKey);
  return effective;
}

// ---------------------------------------------------------------------------
// 10. Service-role path guard.
// ---------------------------------------------------------------------------

/**
 * Require that even a service-role (admin client) caller has a valid ERP
 * authorization context.
 *
 * Per Contract 11 §11: "RLS is defense in depth; service-role access
 * still applies ERP authorization."
 *
 * This means: even if a service uses the Supabase admin client
 * (SUPABASE_SECRET_KEY) to bypass RLS, it MUST still resolve the ERP
 * user context and call the same permission guards. The service-role
 * credential does NOT grant blanket ERP authority.
 *
 * This guard is identical to requireAuthenticatedErpContext — it exists
 * as a separate function so callers can document intent ("this is a
 * service-role path that still requires ERP auth") in their code.
 */
export function requireErpAuthForServiceRolePath(
  authResult:
    | ErpUserContext
    | { authenticated: false; reason: "no_session" | "unmapped" | "inactive" },
): ErpUserContext {
  return requireAuthenticatedErpContext(authResult);
}

/**
 * Verify that a permission key is not denied by the Worker financial-deny
 * ceiling for the given role set.
 *
 * This is a defensive check for service-role paths that bypass the normal
 * effective-permission resolution. If the user has a Worker-family role,
 * financial permission keys are denied regardless of how the request
 * reached the service.
 */
export function requireNotDeniedByWorkerCeiling(
  assignedRoleCodes: ReadonlyArray<RoleCode>,
  permissionKey: string,
): void {
  if (isPermissionDeniedByWorkerCeiling(assignedRoleCodes, permissionKey)) {
    throw new PermissionDeniedError(permissionKey, {
      // DEC-063 ceiling — Worker cannot hold this permission even via
      // service-role path.
    });
  }
}
