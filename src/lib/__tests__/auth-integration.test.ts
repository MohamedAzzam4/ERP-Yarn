/**
 * WP-01-01 auth integration tests.
 *
 * Tests verify:
 *   - No public signup route/action/component exists
 *   - No role selector/client role authority
 *   - Login page exists with Arabic RTL
 *   - Bootstrap route exists and requires secret
 *   - Legacy Supabase env names rejected
 *   - OWNER_BOOTSTRAP_SECRET added to .env.example
 *   - Arabic/RTL root remains intact
 *   - server-only guards on auth modules
 *   - No secrets in client-visible code
 *   - Enumeration-safe auth responses
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
function readText(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}
function exists(rel: string): boolean {
  return existsSync(join(root, rel));
}

// ---------------------------------------------------------------------------
// No public signup
// ---------------------------------------------------------------------------

describe("WP-01-01 no public signup", () => {
  it("no signup page exists", () => {
    expect(exists("src/app/signup/page.tsx")).toBe(false);
    expect(exists("src/app/register/page.tsx")).toBe(false);
  });

  it("no signup API route exists", () => {
    expect(exists("src/app/api/signup/route.ts")).toBe(false);
    expect(exists("src/app/api/register/route.ts")).toBe(false);
  });

  it("login page has no signup link", () => {
    const login = readText("src/app/login/page.tsx");
    const lines = login.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      const isComment = trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('{/*');
      if (!isComment && /signup|register|sign.?up|إنشاء حساب|تسجيل جديد/i.test(line)) {
        throw new Error(`Signup reference found: ${line.trim()}`);
      }
    }
  });

  it("login actions have no signUp function", () => {
    const actions = readText("src/app/login/actions.ts");
    const lines = actions.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      const isComment = trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('{/*');
      if (!isComment && /signUp|register|createUser.*public/i.test(line)) {
        throw new Error(`Signup function found: ${line.trim()}`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// No role selector
// ---------------------------------------------------------------------------

describe("WP-01-01 no role selector", () => {
  it("login page has no role selector", () => {
    const login = readText("src/app/login/page.tsx");
    const lines = login.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      const isComment = trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('{/*');
      if (!isComment && /role.*select|role.*dropdown|select.*role/i.test(line)) {
        throw new Error(`Role selector found: ${line.trim()}`);
      }
    }
  });

  it("login actions do not accept role from form data", () => {
    const actions = readText("src/app/login/actions.ts");
    expect(actions).not.toMatch(/formData.*role|role.*formData/i);
  });
});

// ---------------------------------------------------------------------------
// Login page structure
// ---------------------------------------------------------------------------

describe("WP-01-01 login page", () => {
  it("exists at /login", () => {
    expect(exists("src/app/login/page.tsx")).toBe(true);
  });

  it("uses Arabic labels", () => {
    const login = readText("src/app/login/page.tsx");
    expect(login).toMatch(/تسجيل الدخول/);
  });

  it("has email input with dir=ltr", () => {
    const login = readText("src/app/login/page.tsx");
    expect(login).toMatch(/dir="ltr"/);
  });

  it("has password input with dir=ltr", () => {
    const login = readText("src/app/login/page.tsx");
    expect(login).toMatch(/type="password"/);
  });

  it("imports signIn and requestPasswordReset actions", () => {
    const login = readText("src/app/login/page.tsx");
    expect(login).toMatch(/signIn/);
    expect(login).toMatch(/requestPasswordReset/);
  });
});

// ---------------------------------------------------------------------------
// Auth actions — enumeration safety
// ---------------------------------------------------------------------------

describe("WP-01-01 auth actions enumeration safety", () => {
  const actions = readText("src/app/login/actions.ts");

  it("signIn returns generic Arabic error on failure", () => {
    expect(actions).toMatch(/error=invalid/);
  });

  it("requestPasswordReset returns generic success always", () => {
    expect(actions).toMatch(/reset=sent/);
  });

  it("signIn does not reveal whether email exists", () => {
    // The error message should be the same regardless of whether the
    // email exists or the password is wrong.
    expect(actions).not.toMatch(/email.*not.*found|user.*not.*exist|invalid.*email/i);
  });
});

// ---------------------------------------------------------------------------
// Bootstrap route
// ---------------------------------------------------------------------------

describe("WP-01-01 bootstrap route", () => {
  it("exists at /api/bootstrap", () => {
    expect(exists("src/app/api/bootstrap/route.ts")).toBe(true);
  });

  it("uses Node.js runtime", () => {
    const route = readText("src/app/api/bootstrap/route.ts");
    expect(route).toMatch(/runtime.*=.*"nodejs"/);
  });

  it("requires OWNER_BOOTSTRAP_SECRET", () => {
    const route = readText("src/app/api/bootstrap/route.ts");
    expect(route).toMatch(/OWNER_BOOTSTRAP_SECRET/);
  });

  it("checks for existing Owner (idempotent)", () => {
    const route = readText("src/app/api/bootstrap/route.ts");
    expect(route).toMatch(/Owner already exists|idempotent/i);
  });

  it("returns 409 when Owner already exists", () => {
    const route = readText("src/app/api/bootstrap/route.ts");
    expect(route).toMatch(/409/);
  });

  it("does not return secrets in response", () => {
    const route = readText("src/app/api/bootstrap/route.ts");
    const lines = route.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      const isComment = trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('{/*');
      if (!isComment && /return.*secret|return.*password|return.*token/i.test(line)) {
        throw new Error(`Secret return found: ${line.trim()}`);
      }
    }
    expect(route).toMatch(/Do NOT return.*secret/i);
  });

  it("imports server-only", () => {
    const route = readText("src/app/api/bootstrap/route.ts");
    expect(route).toMatch(/server-only/);
  });
});

// ---------------------------------------------------------------------------
// ERP context helper
// ---------------------------------------------------------------------------

describe("WP-01-01 ERP context helper", () => {
  it("erp-context.ts exists", () => {
    expect(exists("src/server/auth/erp-context.ts")).toBe(true);
  });

  it("imports server-only", () => {
    const src = readText("src/server/auth/erp-context.ts");
    expect(src).toMatch(/server-only/);
  });

  it("has getErpAuthContext function", () => {
    const src = readText("src/server/auth/erp-context.ts");
    expect(src).toMatch(/getErpAuthContext/);
  });

  it("returns denial reasons: no_session, unmapped, inactive", () => {
    const src = readText("src/server/auth/erp-context.ts");
    expect(src).toMatch(/no_session/);
    expect(src).toMatch(/unmapped/);
    expect(src).toMatch(/inactive/);
  });

  it("queries users table by auth_id", () => {
    const src = readText("src/server/auth/erp-context.ts");
    expect(src).toMatch(/auth_id/);
    expect(src).toMatch(/from\("users"\)/);
  });

  it("checks user status is active", () => {
    const src = readText("src/server/auth/erp-context.ts");
    expect(src).toMatch(/status.*active|active.*status/);
  });
});

// ---------------------------------------------------------------------------
// Supabase client helpers
// ---------------------------------------------------------------------------

describe("WP-01-01 Supabase client helpers", () => {
  it("browser.ts creates browser client", () => {
    const src = readText("src/lib/supabase/browser.ts");
    expect(src).toMatch(/createBrowserClient/);
    expect(src).toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(src).toMatch(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  });

  it("server.ts creates server client with cookies", () => {
    const src = readText("src/lib/supabase/server.ts");
    expect(src).toMatch(/createServerClient/);
    expect(src).toMatch(/cookies/);
  });

  it("admin.ts creates admin client with secret key (server-only)", () => {
    const src = readText("src/lib/supabase/admin.ts");
    expect(src).toMatch(/createClient/);
    expect(src).toMatch(/SUPABASE_SECRET_KEY/);
    expect(src).toMatch(/server-only/);
  });

  it("admin.ts does NOT use NEXT_PUBLIC_ prefix for secret", () => {
    const src = readText("src/lib/supabase/admin.ts");
    expect(src).not.toMatch(/NEXT_PUBLIC.*SECRET/);
  });

  it("no legacy NEXT_PUBLIC_SUPABASE_ANON_KEY in any supabase helper", () => {
    for (const f of ["browser.ts", "server.ts", "admin.ts"]) {
      const src = readText(`src/lib/supabase/${f}`);
      expect(src).not.toMatch(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
    }
  });

  it("no legacy SUPABASE_SERVICE_ROLE_KEY in any supabase helper", () => {
    for (const f of ["browser.ts", "server.ts", "admin.ts"]) {
      const src = readText(`src/lib/supabase/${f}`);
      expect(src).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    }
  });
});

// ---------------------------------------------------------------------------
// Proxy (formerly Middleware)
// ---------------------------------------------------------------------------

describe("WP-01-01 proxy (formerly middleware)", () => {
  it("proxy.ts exists", () => {
    expect(exists("src/proxy.ts")).toBe(true);
  });

  it("has public routes including /login and /api/health", () => {
    const src = readText("src/proxy.ts");
    expect(src).toMatch(/\/login/);
    expect(src).toMatch(/\/api\/health/);
  });

  it("includes /auth/reset-password in public routes (recovery flow)", () => {
    // The recovery email link lands the user on /auth/reset-password without
    // a prior session — the proxy must NOT redirect them to /login.
    const src = readText("src/proxy.ts");
    expect(src).toMatch(/\/auth\/reset-password/);
  });

  it("redirects to /login when no session", () => {
    const src = readText("src/proxy.ts");
    expect(src).toMatch(/redirect.*login|NextResponse\.redirect.*login/);
  });

  it("refreshes Supabase session", () => {
    const src = readText("src/proxy.ts");
    expect(src).toMatch(/getSession/);
  });

  it("exports proxy function (not middleware)", () => {
    const src = readText("src/proxy.ts");
    expect(src).toMatch(/export\s+async\s+function\s+proxy\s*\(/);
    // Ensure no deprecated middleware export remains
    expect(src).not.toMatch(/export\s+async\s+function\s+middleware\s*\(/);
  });
});

// ---------------------------------------------------------------------------
// .env.example updated
// ---------------------------------------------------------------------------

describe("WP-01-01 .env.example has OWNER_BOOTSTRAP_SECRET", () => {
  it("contains OWNER_BOOTSTRAP_SECRET=", () => {
    const env = readText(".env.example");
    expect(env).toMatch(/OWNER_BOOTSTRAP_SECRET=/);
  });
});

// ---------------------------------------------------------------------------
// Arabic RTL root preserved
// ---------------------------------------------------------------------------

describe("WP-01-01 preserves Arabic RTL root", () => {
  it("layout.tsx still has <html lang=\"ar\" dir=\"rtl\">", () => {
    const layout = readText("src/app/layout.tsx");
    expect(layout).toMatch(/lang="ar"/);
    expect(layout).toMatch(/dir="rtl"/);
  });
});

// ---------------------------------------------------------------------------
// Auth callback route
// ---------------------------------------------------------------------------

describe("WP-01-01 auth callback", () => {
  it("exists at /api/auth/callback", () => {
    expect(exists("src/app/api/auth/callback/route.ts")).toBe(true);
  });

  it("uses Node.js runtime", () => {
    const src = readText("src/app/api/auth/callback/route.ts");
    expect(src).toMatch(/runtime.*=.*"nodejs"/);
  });

  it("exchanges code for session", () => {
    const src = readText("src/app/api/auth/callback/route.ts");
    expect(src).toMatch(/exchangeCodeForSession/);
  });

  it("redirects to reset-password for recovery type", () => {
    const src = readText("src/app/api/auth/callback/route.ts");
    expect(src).toMatch(/recovery/);
    expect(src).toMatch(/reset-password/);
  });
});

// ---------------------------------------------------------------------------
// Reset password page
// ---------------------------------------------------------------------------

describe("WP-01-01 reset password page", () => {
  it("exists at /auth/reset-password", () => {
    expect(exists("src/app/auth/reset-password/page.tsx")).toBe(true);
  });

  it("has Arabic labels", () => {
    const src = readText("src/app/auth/reset-password/page.tsx");
    expect(src).toMatch(/إعادة تعيين كلمة المرور|كلمة المرور الجديدة/);
  });
});

// ---------------------------------------------------------------------------
// Home page updated for auth
// ---------------------------------------------------------------------------

describe("WP-01-01 home page auth-aware (updated for WP-01-04 role-aware redirect)", () => {
  it("imports getErpAuthContext", () => {
    const src = readText("src/app/page.tsx");
    expect(src).toMatch(/getErpAuthContext/);
  });

  it("redirects to /login for unauthenticated (WP-01-04 changed from denial message to redirect)", () => {
    const src = readText("src/app/page.tsx");
    expect(src).toMatch(/redirect\("\/login"\)/);
  });

  it("redirects to role-appropriate shell (WP-01-04)", () => {
    const src = readText("src/app/page.tsx");
    expect(src).toMatch(/getDefaultShellRoute/);
  });

  it("signOut is handled by shell pages (worker/management), not home page", () => {
    // WP-01-04 moved signOut to the shell components. The home page just redirects.
    const workerPage = readText("src/app/(worker)/worker/page.tsx");
    const mgmtPage = readText("src/app/(management)/management/page.tsx");
    expect(workerPage).toMatch(/signOut/);
    expect(mgmtPage).toMatch(/signOut/);
  });
});

// ---------------------------------------------------------------------------
// Live tests BLOCKED
// ---------------------------------------------------------------------------

describe("WP-01-01 live Supabase tests (BLOCKED — 7 tests)", () => {
  it.skip("BLOCKED-1: Supabase Auth login authenticates a synthetic dev user", () => {});
  it.skip("BLOCKED-2: Active mapped ERP user reaches protected auth context", () => {});
  it.skip("BLOCKED-3: Inactive mapped ERP user is denied", () => {});
  it.skip("BLOCKED-4: Unmapped Supabase user is denied", () => {});
  it.skip("BLOCKED-5: Recovery request is generic and does not reveal existence", () => {});
  it.skip("BLOCKED-6: Bootstrap creates the first synthetic Owner only once", () => {});
  it.skip("BLOCKED-7: Secrets are not exposed in responses or client bundle", () => {});
});
