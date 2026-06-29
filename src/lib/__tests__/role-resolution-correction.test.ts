/**
 * WP-01-04 correction pass tests — role resolution from DB, no email inference.
 *
 * Contract: docs/contracts/01_technical_architecture_and_deployment_contract.md
 *   §Supabase Auth: "never trust tenant_id, role, permission, or approval
 *   authority from request-body fields"
 *
 * DEC-073: Supabase Auth identity is authentication only; ERP role/tenant/
 *   permission context comes from the ERP database.
 *
 * These tests verify:
 *   1. NO email-based role inference exists in any WP-01-04 file.
 *   2. All 3 page files use getErpAuthContextWithRoles (DB-based).
 *   3. Unmapped/inactive users are denied (redirected to /login).
 *   4. Users with no role assignments are denied.
 *   5. Worker shell access requires a worker role.
 *   6. Management shell access requires owner/accountant role.
 *   7. No "Unresolved / requires owner decision" comments remain for
 *      role inference (the decision is covered by existing contracts).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
function readText(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

// ---------------------------------------------------------------------------
// 1. NO email-based role inference exists anywhere in WP-01-04 files.
// ---------------------------------------------------------------------------

describe("WP-01-04 correction: no email-based role inference", () => {
  const wp0104Files = [
    "src/app/page.tsx",
    "src/app/(worker)/worker/page.tsx",
    "src/app/(management)/management/page.tsx",
    "src/components/shells/nav-config.ts",
    "src/components/shells/worker-shell.tsx",
    "src/components/shells/management-shell.tsx",
    "src/components/shells/sidebar.tsx",
    "src/components/shells/topbar.tsx",
  ];

  for (const file of wp0104Files) {
    it(`${file} does NOT contain inferRoleFromContext`, () => {
      const src = readText(file);
      expect(src).not.toMatch(/inferRoleFromContext/);
    });

    it(`${file} does NOT contain email.includes role checks`, () => {
      const src = readText(file);
      // Look for patterns like: email.includes("owner"), email.includes("warehouse")
      expect(src).not.toMatch(/email\.includes\s*\(/);
      expect(src).not.toMatch(/email\.match\s*\(/);
      expect(src).not.toMatch(/email\.indexOf\s*\(/);
    });

    it(`${file} does NOT contain "Unresolved / requires owner decision" for role inference`, () => {
      const src = readText(file);
      // The "Unresolved" comment was about role inference being temporary.
      // It should be removed now that we use DB-based resolution.
      expect(src).not.toMatch(/Unresolved.*requires owner decision/i);
      expect(src).not.toMatch(/temporary.*role.*inference/i);
      expect(src).not.toMatch(/placeholder.*role/i);
    });

    it(`${file} does NOT contain hardcoded role-email mappings`, () => {
      const src = readText(file);
      // Look for patterns that map email substrings to roles
      expect(src).not.toMatch(/warehouse.*return.*warehouse_employee/i);
      expect(src).not.toMatch(/production.*return.*production_employee/i);
      expect(src).not.toMatch(/quality.*return.*quality_employee/i);
      expect(src).not.toMatch(/owner.*return.*owner/i);
      expect(src).not.toMatch(/accountant.*return.*accountant/i);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. All 3 page files use getErpAuthContextWithRoles (DB-based resolution).
// ---------------------------------------------------------------------------

describe("WP-01-04 correction: DB-based role resolution", () => {
  it("src/app/page.tsx imports getErpAuthContextWithRoles", () => {
    const src = readText("src/app/page.tsx");
    expect(src).toMatch(/import.*getErpAuthContextWithRoles/);
  });

  it("src/app/page.tsx calls getErpAuthContextWithRoles", () => {
    const src = readText("src/app/page.tsx");
    expect(src).toMatch(/await getErpAuthContextWithRoles\(\)/);
  });

  it("src/app/page.tsx uses authResult.roles for shell routing", () => {
    const src = readText("src/app/page.tsx");
    expect(src).toMatch(/authResult\.roles/);
  });

  it("worker/page.tsx imports getErpAuthContextWithRoles", () => {
    const src = readText("src/app/(worker)/worker/page.tsx");
    expect(src).toMatch(/import.*getErpAuthContextWithRoles/);
  });

  it("worker/page.tsx calls getErpAuthContextWithRoles", () => {
    const src = readText("src/app/(worker)/worker/page.tsx");
    expect(src).toMatch(/await getErpAuthContextWithRoles\(\)/);
  });

  it("worker/page.tsx uses authResult.roles for worker role check", () => {
    const src = readText("src/app/(worker)/worker/page.tsx");
    expect(src).toMatch(/authResult\.roles/);
    expect(src).toMatch(/isWorkerShellRole/);
  });

  it("management/page.tsx imports getErpAuthContextWithRoles", () => {
    const src = readText("src/app/(management)/management/page.tsx");
    expect(src).toMatch(/import.*getErpAuthContextWithRoles/);
  });

  it("management/page.tsx calls getErpAuthContextWithRoles", () => {
    const src = readText("src/app/(management)/management/page.tsx");
    expect(src).toMatch(/await getErpAuthContextWithRoles\(\)/);
  });

  it("management/page.tsx uses authResult.roles for management role check", () => {
    const src = readText("src/app/(management)/management/page.tsx");
    expect(src).toMatch(/authResult\.roles/);
    expect(src).toMatch(/isManagementShellRole/);
  });
});

// ---------------------------------------------------------------------------
// 3. Denial behavior: unmapped/inactive/no-role users are denied.
// ---------------------------------------------------------------------------

describe("WP-01-04 correction: denial behavior", () => {
  it("page.tsx redirects to /login if not authenticated", () => {
    const src = readText("src/app/page.tsx");
    expect(src).toMatch(/redirect\("\/login"\)/);
  });

  it("page.tsx redirects to /login?error=no_role if user has no roles", () => {
    const src = readText("src/app/page.tsx");
    expect(src).toMatch(/redirect\("\/login\?error=no_role"\)/);
  });

  it("worker/page.tsx redirects to /login if not authenticated", () => {
    const src = readText("src/app/(worker)/worker/page.tsx");
    expect(src).toMatch(/redirect\("\/login"\)/);
  });

  it("worker/page.tsx redirects to /login?error=no_role if no roles", () => {
    const src = readText("src/app/(worker)/worker/page.tsx");
    expect(src).toMatch(/redirect\("\/login\?error=no_role"\)/);
  });

  it("worker/page.tsx redirects to /management if user has no worker role", () => {
    const src = readText("src/app/(worker)/worker/page.tsx");
    expect(src).toMatch(/redirect\("\/management"\)/);
  });

  it("management/page.tsx redirects to /login if not authenticated", () => {
    const src = readText("src/app/(management)/management/page.tsx");
    expect(src).toMatch(/redirect\("\/login"\)/);
  });

  it("management/page.tsx redirects to /login?error=no_role if no roles", () => {
    const src = readText("src/app/(management)/management/page.tsx");
    expect(src).toMatch(/redirect\("\/login\?error=no_role"\)/);
  });

  it("management/page.tsx redirects to /worker if user has no management role", () => {
    const src = readText("src/app/(management)/management/page.tsx");
    expect(src).toMatch(/redirect\("\/worker"\)/);
  });
});

// ---------------------------------------------------------------------------
// 4. erp-context.ts provides getErpAuthContextWithRoles.
// ---------------------------------------------------------------------------

describe("WP-01-04 correction: erp-context.ts provides role resolution", () => {
  const ctx = readText("src/server/auth/erp-context.ts");

  it("exports ErpAuthContextWithRoles interface", () => {
    expect(ctx).toMatch(/export interface ErpAuthContextWithRoles/);
  });

  it("exports getErpAuthContextWithRoles function", () => {
    expect(ctx).toMatch(/export async function getErpAuthContextWithRoles/);
  });

  it("exports requireErpAuthWithRoles function", () => {
    expect(ctx).toMatch(/export async function requireErpAuthWithRoles/);
  });

  it("queries user_roles table (not email)", () => {
    expect(ctx).toMatch(/from\("user_roles"\)/);
  });

  it("queries roles table via nested select (not email)", () => {
    expect(ctx).toMatch(/roles!inner\(role_code\)/);
  });

  it("does NOT infer roles from email", () => {
    expect(ctx).not.toMatch(/email\.includes/);
    expect(ctx).not.toMatch(/email\.match/);
  });

  it("returns roles array in the context", () => {
    expect(ctx).toMatch(/roles/);
  });

  it("fail-safe: returns empty roles array on query error", () => {
    expect(ctx).toMatch(/roles: \[\]/);
  });
});

// ---------------------------------------------------------------------------
// 5. Global codebase scan: no email-based role inference anywhere.
// ---------------------------------------------------------------------------

describe("WP-01-04 correction: global scan for email-based role inference", () => {
  // Scan all .ts and .tsx files in src/ EXCEPT test files, for email-based
  // role inference. Test files are excluded because they contain the search
  // patterns as assertions.
  const { execSync } = require("node:child_process");
  const srcDir = join(root, "src");

  it("no non-test file in src/ contains inferRoleFromContext", () => {
    let result = "";
    try {
      // grep -r but exclude test files
      result = execSync(
        `grep -rl "inferRoleFromContext" ${srcDir} --include="*.ts" --include="*.tsx" | grep -v "__tests__" | grep -v "\\.test\\." 2>/dev/null || true`,
        { encoding: "utf8" },
      );
    } catch {
      // no matches — good
    }
    expect(result.trim()).toBe("");
  });

  it("no non-test file in src/ contains email.includes with role names", () => {
    let result = "";
    try {
      result = execSync(
        `grep -rn 'email\\.includes' ${srcDir} --include="*.ts" --include="*.tsx" | grep -v "__tests__" | grep -v "\\.test\\." 2>/dev/null || true`,
        { encoding: "utf8" },
      );
    } catch {
      // no matches — good
    }
    expect(result.trim()).toBe("");
  });

  it("no WP-01-04 shell/page file contains 'Unresolved / requires owner decision' for role inference", () => {
    // Only scan the WP-01-04 files (not worker-scope.ts which has a
    // legitimate different "Unresolved" for mixed Worker row-scope).
    const wp0104Files = [
      "src/app/page.tsx",
      "src/app/(worker)/worker/page.tsx",
      "src/app/(management)/management/page.tsx",
      "src/components/shells/nav-config.ts",
      "src/components/shells/worker-shell.tsx",
      "src/components/shells/management-shell.tsx",
    ];
    for (const file of wp0104Files) {
      const src = readText(file);
      expect(src).not.toMatch(/Unresolved.*requires owner decision/i);
    }
  });

  it("no non-test file in src/ contains 'temporary' + 'role' + 'inference'", () => {
    let result = "";
    try {
      result = execSync(
        `grep -rn -i "temporary.*role.*inference\\|role.*inference.*temporary" ${srcDir} --include="*.ts" --include="*.tsx" | grep -v "__tests__" | grep -v "\\.test\\." 2>/dev/null || true`,
        { encoding: "utf8" },
      );
    } catch {
      // no matches — good
    }
    expect(result.trim()).toBe("");
  });
});
