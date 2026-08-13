#!/usr/bin/env python3
"""
Replace TEST_ROLE_PERMISSION_MATRIX with DB-backed permission loader
in all production runtime files under src/app.
"""
import re
import os
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent

# Find all production files that import TEST_ROLE_PERMISSION_MATRIX
files_to_fix = []
for root, dirs, files in os.walk(REPO / "src"):
    # Skip test directories
    if "__tests__" in root or "node_modules" in root:
        continue
    for f in files:
        if f.endswith(".ts") or f.endswith(".tsx"):
            filepath = Path(root) / f
            content = filepath.read_text()
            if "TEST_ROLE_PERMISSION_MATRIX" in content and not f.endswith(".test.ts") and not f.endswith(".test.tsx"):
                # Skip role-fixtures.ts (definition file)
                if "role-fixtures" in str(filepath):
                    continue
                files_to_fix.append(filepath)

print(f"Found {len(files_to_fix)} production files to fix:")
for f in files_to_fix:
    print(f"  {f.relative_to(REPO)}")
print()

for filepath in files_to_fix:
    content = filepath.read_text()
    original = content

    # Pattern 1: Server Actions that use resolveAndRequirePermission with TEST_ROLE_PERMISSION_MATRIX
    # Replace:
    #   const authResult = await getErpAuthContextWithRoles();
    #   ... (optional auth checks) ...
    #   const effective = resolveAndRequirePermission(authResult.roles, TEST_ROLE_PERMISSION_MATRIX, "perm.key");
    # With:
    #   const { authResult, effective } = await authenticateAndRequirePermissionFromDb("perm.key");

    # Pattern 2: Server Components that use resolveEffectivePermissions with TEST_ROLE_PERMISSION_MATRIX
    # Replace:
    #   const effective = resolveEffectivePermissions(authResult.roles, TEST_ROLE_PERMISSION_MATRIX);
    # With:
    #   const matrix = await loadRolePermissionMatrixForTenant(authResult.tenantId);
    #   const effective = resolveEffectivePermissions(authResult.roles, matrix);

    # Replace TEST_ROLE_PERMISSION_MATRIX with a call to loadRolePermissionMatrixForTenant
    # This is the simplest, safest replacement that doesn't change control flow.

    # For lines like:
    #   resolveAndRequirePermission(authResult.roles, TEST_ROLE_PERMISSION_MATRIX, "key")
    # Replace with:
    #   resolveAndRequirePermission(authResult.roles, await loadRolePermissionMatrixForTenant(authResult.tenantId), "key")

    # For lines like:
    #   resolveEffectivePermissions(authResult.roles, TEST_ROLE_PERMISSION_MATRIX)
    # Replace with:
    #   resolveEffectivePermissions(authResult.roles, await loadRolePermissionMatrixForTenant(authResult.tenantId))

    # For multi-line calls:
    #   resolveAndRequirePermission(
    #     authResult.roles,
    #     TEST_ROLE_PERMISSION_MATRIX,
    #     "key",
    #   )
    # Replace TEST_ROLE_PERMISSION_MATRIX line with:
    #     await loadRolePermissionMatrixForTenant(authResult.tenantId),

    # Simple approach: replace TEST_ROLE_PERMISSION_MATRIX with (await loadRolePermissionMatrixForTenant(authResult.tenantId))
    # But this requires the function to be async and authResult to be in scope.
    # Most of these are already in async functions with authResult in scope.

    # Replace standalone TEST_ROLE_PERMISSION_MATRIX references
    content = content.replace(
        "TEST_ROLE_PERMISSION_MATRIX",
        "(await loadRolePermissionMatrixForTenant(authResult.tenantId))"
    )

    # Fix import: replace TEST_ROLE_PERMISSION_MATRIX import with loadRolePermissionMatrixForTenant import
    # Old: import { TEST_ROLE_PERMISSION_MATRIX } from "@/server/security/role-fixtures";
    # New: import { loadRolePermissionMatrixForTenant } from "@/server/security/permission-loader";
    content = re.sub(
        r'import\s*\{\s*TEST_ROLE_PERMISSION_MATRIX\s*\}\s*from\s*"@/server/security/role-fixtures";',
        'import { loadRolePermissionMatrixForTenant } from "@/server/security/permission-loader";',
        content
    )

    # If the file had a combined import like:
    # import { TEST_ROLE_PERMISSION_MATRIX, resolveEffectivePermissions } from "..."
    # We need to handle that too
    # Actually, TEST_ROLE_PERMISSION_MATRIX is imported from role-fixtures, and resolveEffectivePermissions from effective-permissions
    # They're separate imports, so the simple replacement above should work.

    # If the import was on multiple lines or had other imports from role-fixtures, handle it
    if "loadRolePermissionMatrixForTenant" in content and "from \"@/server/security/role-fixtures\"" in content:
        # Check if TEST_ROLE_PERMISSION_MATRIX was the only import from role-fixtures
        # If so, the regex above should have replaced it. If not, we need to remove just that import.
        # Check if there's still a reference to role-fixtures that isn't the import we just fixed
        lines = content.split("\n")
        new_lines = []
        for line in lines:
            if "from \"@/server/security/role-fixtures\"" in line and "loadRolePermissionMatrixForTenant" not in line:
                # This line still imports from role-fixtures but doesn't have our new import
                # Remove TEST_ROLE_PERMISSION_MATRIX from the import
                line = re.sub(r'TEST_ROLE_PERMISSION_MATRIX,\s*', '', line)
                line = re.sub(r',\s*TEST_ROLE_PERMISSION_MATRIX', '', line)
                line = re.sub(r'\{\s*TEST_ROLE_PERMISSION_MATRIX\s*\}', '{}', line)
                # If the import is now empty, remove the whole line
                if re.search(r'import\s*\{\s*\}\s*from', line):
                    continue
            new_lines.append(line)
        content = "\n".join(new_lines)

    if content != original:
        filepath.write_text(content)
        print(f"  FIXED: {filepath.relative_to(REPO)}")
    else:
        print(f"  SKIP (no changes): {filepath.relative_to(REPO)}")

print("\nDone.")
