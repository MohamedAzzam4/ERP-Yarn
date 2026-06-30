/**
 * WP-01-05/06/07 login redirect + error feedback tests.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
function readText(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("WP-01-05/06/07 login redirect handling", () => {
  const loginPage = readText("src/app/login/page.tsx");

  it("login page reads searchParams.redirect (not hardcoded)", () => {
    expect(loginPage).toMatch(/searchParams.*redirect/);
    expect(loginPage).toMatch(/sanitizeRedirect/);
    expect(loginPage).not.toMatch(/value="\/login\?redirect=\/"/);
  });

  it("login page has sanitizeRedirect function", () => {
    expect(loginPage).toMatch(/function sanitizeRedirect/);
  });

  it("sanitizeRedirect rejects empty/undefined (defaults to /)", () => {
    expect(loginPage).toMatch(/if \(!value\) return "\/"/);
  });

  it("sanitizeRedirect rejects non-/ prefix", () => {
    expect(loginPage).toMatch(/if \(!value\.startsWith\("\/"\)\) return "\/"/);
  });

  it("sanitizeRedirect rejects // (protocol-relative)", () => {
    expect(loginPage).toMatch(/value\.startsWith\("\/\/"\)/);
  });

  it("sanitizeRedirect rejects full URLs (contains ://)", () => {
    expect(loginPage).toMatch(/value\.slice\(1\)\.includes\(":\/\/"\)/);
  });

  it("hidden input uses safeRedirect (not hardcoded)", () => {
    expect(loginPage).toMatch(/name="redirect" value=\{safeRedirect\}/);
  });

  it("login page awaits searchParams (async)", () => {
    expect(loginPage).toMatch(/await searchParams/);
  });
});

describe("WP-01-05/06/07 login actions server-side sanitization", () => {
  const actions = readText("src/app/login/actions.ts");

  it("actions has sanitizeRedirectServer function", () => {
    expect(actions).toMatch(/function sanitizeRedirectServer/);
  });

  it("signIn uses sanitizeRedirectServer on formData redirect", () => {
    expect(actions).toMatch(/sanitizeRedirectServer\(formData\.get\("redirect"\)/);
  });

  it("signIn passes redirect in error redirect URLs", () => {
    expect(actions).toMatch(/error=incomplete.*redirect=/);
    expect(actions).toMatch(/error=invalid.*redirect=/);
    expect(actions).toMatch(/encodeURIComponent/);
  });
});

describe("WP-01-05/06/07 login error feedback", () => {
  const loginPage = readText("src/app/login/page.tsx");

  it("login page renders error messages from query params", () => {
    expect(loginPage).toMatch(/ERROR_MESSAGES/);
    expect(loginPage).toMatch(/params\.error/);
  });

  it("login page renders reset messages from query params", () => {
    expect(loginPage).toMatch(/RESET_MESSAGES/);
    expect(loginPage).toMatch(/params\.reset/);
  });

  it("invalid error has Arabic message", () => {
    expect(loginPage).toMatch(/خطأ في تسجيل الدخول/);
    expect(loginPage).toMatch(/البريد الإلكتروني أو كلمة المرور غير صحيحة/);
  });

  it("incomplete error has Arabic message", () => {
    expect(loginPage).toMatch(/بيانات ناقصة/);
    expect(loginPage).toMatch(/يرجى إدخال البريد الإلكتروني وكلمة المرور/);
  });

  it("no_role error has Arabic message (safe, no sensitive detail)", () => {
    expect(loginPage).toMatch(/لا يوجد دور مخصص/);
  });

  it("reset=sent has Arabic message (enumeration-safe)", () => {
    expect(loginPage).toMatch(/تم الإرسال/);
    expect(loginPage).toMatch(/إذا كان البريد الإلكتروني مسجلاً/);
  });

  it("reset=done has Arabic success message", () => {
    expect(loginPage).toMatch(/تم التحديث/);
    expect(loginPage).toMatch(/تم تحديث كلمة المرور بنجاح/);
  });

  it("error messages use Alert component", () => {
    expect(loginPage).toMatch(/Alert/);
    expect(loginPage).toMatch(/AlertDescription/);
  });

  it("error alerts have role=alert", () => {
    expect(loginPage).toMatch(/role="alert"/);
  });

  it("reset alerts have role=status", () => {
    expect(loginPage).toMatch(/role="status"/);
  });
});

// --- Login pending/loading state ---

describe("WP-01-05/06/07 login pending/loading state", () => {
  const loginPage = readText("src/app/login/page.tsx");

  it("login page imports SubmitButton component", () => {
    expect(loginPage).toMatch(/SubmitButton/);
  });

  it("SubmitButton component exists", () => {
    expect(readText("src/components/ui/submit-button.tsx")).toMatch(/useFormStatus/);
  });

  it("SubmitButton uses useFormStatus from react-dom", () => {
    const sb = readText("src/components/ui/submit-button.tsx");
    expect(sb).toMatch(/useFormStatus/);
    expect(sb).toMatch(/react-dom/);
  });

  it("SubmitButton has pending/loading text in Arabic", () => {
    const sb = readText("src/components/ui/submit-button.tsx");
    expect(sb).toMatch(/جاري تسجيل الدخول/);
  });

  it("SubmitButton disables button when pending", () => {
    const sb = readText("src/components/ui/submit-button.tsx");
    expect(sb).toMatch(/disabled.*pending|pending.*disabled/);
  });

  it("SubmitButton has spinner (animate-spin)", () => {
    const sb = readText("src/components/ui/submit-button.tsx");
    expect(sb).toMatch(/animate-spin/);
  });

  it("SubmitButton has aria-busy attribute", () => {
    const sb = readText("src/components/ui/submit-button.tsx");
    expect(sb).toMatch(/aria-busy/);
  });

  it("login form still uses server action (signIn)", () => {
    expect(loginPage).toMatch(/action=\{signIn\}/);
  });

  it("redirect sanitization still present", () => {
    expect(loginPage).toMatch(/sanitizeRedirect/);
  });

  it("error messages still present", () => {
    expect(loginPage).toMatch(/ERROR_MESSAGES/);
  });
});

describe("WP-01-05/06/07 login enumeration safety", () => {
  const loginPage = readText("src/app/login/page.tsx");
  const actions = readText("src/app/login/actions.ts");

  it("invalid error does NOT reveal whether email exists", () => {
    expect(loginPage).not.toMatch(/البريد غير موجود|البريد غير مسجل|الحساب غير موجود/);
  });

  it("signIn action redirects with generic error (not email-specific)", () => {
    expect(actions).toMatch(/error=invalid/);
    expect(actions).not.toMatch(/email.*not.*found|user.*not.*exist/i);
  });

  it("reset=sent message uses 'if registered' phrasing (enumeration-safe)", () => {
    expect(loginPage).toMatch(/إذا كان البريد الإلكتروني مسجلاً/);
  });
});

describe("WP-01-05/06/07 no hardcoded redirect cycle", () => {
  const loginPage = readText("src/app/login/page.tsx");

  it("login page does NOT contain hardcoded /login?redirect=/ value", () => {
    expect(loginPage).not.toMatch(/value="\/login\?redirect=\/"/);
  });

  it("login page default redirect is / (not /login?redirect=/)", () => {
    expect(loginPage).toMatch(/return "\/"/);
  });
});

describe("WP-01-05/06/07 login RTL/LTR preserved", () => {
  const loginPage = readText("src/app/login/page.tsx");

  it("email input has dir=ltr", () => {
    expect(loginPage).toMatch(/dir="ltr"/);
  });

  it("no dir=auto", () => {
    expect(loginPage).not.toMatch(/dir="auto"/);
  });
});

describe("WP-01-05/06/07 login touch targets", () => {
  const loginPage = readText("src/app/login/page.tsx");

  it("submit button has min-h-[44px]", () => {
    expect(loginPage).toMatch(/min-h-\[44px\]/);
  });
});
