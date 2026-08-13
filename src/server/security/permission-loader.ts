/**
 * Production permission loader — queries the role→permission mapping from
 * the database at runtime, scoped by tenant.
 *
 * This replaces the static `TEST_ROLE_PERMISSION_MATRIX` constant in
 * production code paths. The static matrix is still available for unit
 * tests (where no DB is present), but production authorization MUST use
 * this loader so that:
 *   - DB-level permission changes take effect immediately (no rebuild).
 *   - Permissions are tenant-scoped (each tenant can customize role→permission).
 *   - The authorization source is the persisted database, not a compiled constant.
 *
 * Contract: docs/contracts/11_permission_matrix.md
 *   §11: "Backend Enforcement (primary)" — permissions are checked server-side
 *   using persisted role/permission assignments.
 *
 * The returned matrix has the same shape as `RolePermissionMatrix` so it
 * can be used as a drop-in replacement for `TEST_ROLE_PERMISSION_MATRIX`
 * in `resolveEffectivePermissions` and `resolveAndRequirePermission`.
 */
import "server-only";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getErpAuthContextWithRoles, type ErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { resolveAndRequirePermission } from "./guards";
import type { EffectivePermissions, RolePermissionMatrix } from "./effective-permissions";
import type { RoleCode } from "./role-codes";

/**
 * All recognized role codes. Used to initialize the matrix with empty sets
 * so that roles with no assigned permissions still appear in the matrix
 * (resolveEffectivePermissions treats unknown roles as no-permissions).
 */
const ALL_ROLE_CODES: ReadonlyArray<RoleCode> = [
  "owner",
  "accountant",
  "warehouse_employee",
  "production_employee",
  "quality_employee",
];

/**
 * Load the role→permission matrix for a specific tenant from the database.
 *
 * Queries the `role_permissions` table joined with `roles` and `permissions`
 * for the given tenant ID. Returns a `RolePermissionMatrix` mapping each
 * role code to the set of permission keys assigned to that role in the
 * tenant's database.
 *
 * If the query fails, returns an empty matrix (all roles have no permissions).
 * This is fail-safe: a DB error denies all access rather than granting it.
 *
 * @param tenantId - The tenant ID to load permissions for.
 * @returns The role→permission matrix for the tenant.
 */
export async function loadRolePermissionMatrixForTenant(
  tenantId: string,
): Promise<RolePermissionMatrix> {
  const supabase = await createSupabaseServerClient();

  // Initialize matrix with empty sets for all role codes.
  // Use mutable Set<string> during construction, then return as RolePermissionMatrix
  // (Set<string> is assignable to ReadonlySet<string>).
  const matrix: Record<RoleCode, Set<string>> = {
    owner: new Set<string>(),
    accountant: new Set<string>(),
    warehouse_employee: new Set<string>(),
    production_employee: new Set<string>(),
    quality_employee: new Set<string>(),
  };

  // Query role_permissions joined with roles and permissions.
  // This is a tenant-scoped query — only permissions assigned to roles
  // in THIS tenant are returned.
  const { data, error } = await supabase
    .from("role_permissions")
    .select(`
      role_id,
      roles!inner(role_code),
      permissions!inner(permission_key)
    `)
    .eq("tenant_id", tenantId);

  if (error || !data) {
    // Fail-safe: return empty matrix (all roles denied).
    // The caller will deny access because no permissions are resolved.
    return matrix;
  }

  // Build the matrix from the query results.
  for (const row of data) {
    const roleRow = row.roles as unknown as { role_code: string };
    const permRow = row.permissions as unknown as { permission_key: string };
    const roleCode = roleRow?.role_code as RoleCode;
    const permKey = permRow?.permission_key;

    if (roleCode && permKey && ALL_ROLE_CODES.includes(roleCode)) {
      matrix[roleCode].add(permKey);
    }
  }

  return matrix as RolePermissionMatrix;
}

/**
 * Convenience: authenticate the current user and require a specific permission,
 * using the tenant's DB-backed permission matrix.
 *
 * This is the production replacement for:
 *   const authResult = await getErpAuthContextWithRoles();
 *   const effective = resolveAndRequirePermission(authResult.roles, TEST_ROLE_PERMISSION_MATRIX, permissionKey);
 *
 * It performs the same two steps but loads the permission matrix from the
 * database (scoped by tenant) instead of using a static constant.
 *
 * @param permissionKey - The required permission key (e.g. "migration.prepare").
 * @returns The authenticated user context + resolved effective permissions.
 * @throws PermissionDeniedError if the user lacks the permission.
 * @throws Redirect if the user is not authenticated or has no roles.
 */
export async function authenticateAndRequirePermissionFromDb(
  permissionKey: string,
): Promise<{
  authResult: ErpAuthContextWithRoles;
  effective: EffectivePermissions;
}> {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const matrix = await loadRolePermissionMatrixForTenant(authResult.tenantId);
  const effective = resolveAndRequirePermission(authResult.roles, matrix, permissionKey);

  return { authResult, effective };
}
