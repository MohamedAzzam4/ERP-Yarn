/**
 * ERP auth context — maps Supabase Auth identity to ERP user/tenant.
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
 */
import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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

  // Query ERP users table by auth_id using the Supabase client.
  // RLS on the users table (when configured) will filter by tenant.
  // For now, use the admin/server client with the publishable key.
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
