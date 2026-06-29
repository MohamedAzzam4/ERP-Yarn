/**
 * ERP auth context — maps Supabase Auth identity to ERP user/tenant/roles.
 *
 * Contract: docs/contracts/01_technical_architecture_and_deployment_contract.md
 *   §Supabase Auth:
 *     "derive tenant and user context from the authenticated server session
 *      and ERP user mapping"
 *     "never trust tenant_id, role, permission, or approval authority from
 *      request-body fields"
 *     "unmapped or inactive Supabase users must be denied ERP access"
 *
 * DEC-073: Supabase Auth identity is authentication only; ERP tenant
 * membership, role, permission, user status, and field visibility remain
 * controlled by ERP database/application logic.
 *
 * DEC-061: MVP users normally have one active operational role. The schema
 * supports multiple role assignments; if multiple exist, effective
 * permissions are the union with Worker financial-deny ceiling.
 */
import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { RoleCode } from "@/server/security/role-codes";

export interface ErpUserContext {
  authenticated: true;
  userId: string;
  tenantId: string;
  email: string;
  name: string;
  authId: string;
}

export interface ErpAuthDenial {
  authenticated: false;
  reason: "no_session" | "unmapped" | "inactive";
}

export type ErpAuthResult = ErpUserContext | ErpAuthDenial;

/**
 * Extended auth context that includes the user's resolved role codes.
 *
 * Used by shell routing (WP-01-04) and future permission checks.
 * The roles are fetched from the `user_roles` + `roles` tables — NEVER
 * inferred from email, request body, or client state.
 */
export interface ErpAuthContextWithRoles extends ErpUserContext {
  /** The user's assigned role codes (from user_roles + roles tables). */
  roles: ReadonlyArray<RoleCode>;
}

/**
 * Resolve the ERP auth context from the current Supabase server session.
 *
 * This function:
 *   1. Gets the Supabase session from cookies (server-side).
 *   2. If no session → { authenticated: false, reason: "no_session" }
 *   3. Queries the ERP `users` table by `auth_id` (Supabase Auth user ID).
 *   4. If no ERP user found → { authenticated: false, reason: "unmapped" }
 *   5. If ERP user status is "inactive" → { authenticated: false, reason: "inactive" }
 *   6. If active → returns ErpUserContext with userId, tenantId, email, name, authId
 *
 * Tenant/role/permission context is NEVER taken from request body, query
 * string, or client state — only from the server-side ERP database mapping.
 *
 * NOTE: This function does NOT fetch roles. Use `getErpAuthContextWithRoles`
 * for shell routing and permission checks.
 */
export async function getErpAuthContext(): Promise<ErpAuthResult> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user?.id) {
    return { authenticated: false, reason: "no_session" };
  }

  const authId = session.user.id;

  const { data: erpUser, error } = await supabase
    .from("users")
    .select("id, tenant_id, email, name, auth_id, status")
    .eq("auth_id", authId)
    .single();

  if (error || !erpUser) {
    return { authenticated: false, reason: "unmapped" };
  }

  if (erpUser.status !== "active") {
    return { authenticated: false, reason: "inactive" };
  }

  return {
    authenticated: true,
    userId: erpUser.id,
    tenantId: erpUser.tenant_id,
    email: erpUser.email,
    name: erpUser.name,
    authId: erpUser.auth_id,
  };
}

/**
 * Resolve the ERP auth context WITH roles from the database.
 *
 * This extends `getErpAuthContext` by also querying the `user_roles` +
 * `roles` tables to fetch the user's assigned role codes.
 *
 * The roles are used by:
 *   - Shell routing (WP-01-04): worker shell vs management shell
 *   - Permission checks (WP-01-02): effective permission resolution
 *   - Field redaction (WP-01-02): Worker financial-deny ceiling
 *
 * If the user has NO role assignments, `roles` is an empty array. The
 * caller must decide how to handle this (typically: deny access to
 * role-specific shells, show a "no assigned role" message).
 *
 * @returns ErpAuthContextWithRoles if authenticated, or ErpAuthDenial if not.
 */
export async function getErpAuthContextWithRoles(): Promise<
  ErpAuthContextWithRoles | ErpAuthDenial
> {
  const authResult = await getErpAuthContext();
  if (!authResult.authenticated) {
    return authResult;
  }

  const supabase = await createSupabaseServerClient();

  // Query user_roles joined with roles to get role codes.
  // The Supabase client supports nested select to join tables.
  const { data: roleData, error: roleError } = await supabase
    .from("user_roles")
    .select(`
      role_id,
      roles!inner(role_code)
    `)
    .eq("user_id", authResult.userId)
    .eq("tenant_id", authResult.tenantId);

  if (roleError) {
    // If the role query fails, treat as no roles (fail-safe).
    // The caller will deny role-specific access.
    return { ...authResult, roles: [] };
  }

  // Extract role codes from the nested response.
  const roles: RoleCode[] = [];
  if (roleData) {
    for (const row of roleData) {
      const roleRow = row.roles as unknown as { role_code: RoleCode };
      if (roleRow && roleRow.role_code) {
        roles.push(roleRow.role_code);
      }
    }
  }

  return { ...authResult, roles };
}

/**
 * Require an authenticated ERP context. Throws if not authenticated.
 * Use in Server Components / Route Handlers that need a valid ERP user.
 */
export async function requireErpAuth(): Promise<ErpUserContext> {
  const result = await getErpAuthContext();
  if (!result.authenticated) {
    throw new Error(`ERP auth denied: ${result.reason}`);
  }
  return result;
}

/**
 * Require an authenticated ERP context WITH roles. Throws if not authenticated.
 * Use in Server Components that need role-based routing (e.g. shell selection).
 */
export async function requireErpAuthWithRoles(): Promise<ErpAuthContextWithRoles> {
  const result = await getErpAuthContextWithRoles();
  if (!result.authenticated) {
    throw new Error(`ERP auth denied: ${result.reason}`);
  }
  return result;
}
