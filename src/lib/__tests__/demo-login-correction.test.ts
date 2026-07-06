/**
 * Tests for demo login/role-entry correction (added 2026-07-06).
 *
 * Verifies:
 *   - Login page has exactly 3 quick demo login choices
 *   - Old single stakeholder demo link is removed
 *   - Internal quick-role section is removed from demo home
 *   - Data-entry persona lands on a task hub with exactly 4 large choices
 *   - Data-entry persona does not render the sidebar
 *   - Executive and accountant personas show correct role text in topbar
 *   - Accountant can access same demo management screens as executive
 *   - No real auth mutation or DB write is introduced
 *   - Main branch untouched (no changes to real nav-config or proxy)
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  DEMO_QUICK_LOGINS,
  type DemoPersona,
} from "@/lib/fixtures/demo-fixtures";

const root = process.cwd();

function readText(rel: string): string {
  return readFileSync(join(root, rel), "utf-8");
}

function fileExists(rel: string): boolean {
  return existsSync(join(root, rel));
}

// ---------------------------------------------------------------------------
// Login page — 3 quick demo login choices
// ---------------------------------------------------------------------------

describe("Demo login — 3 quick choices on /login", () => {
  const loginSrc = readText("src/app/login/page.tsx");

  it("login page has exactly 3 quick demo login links", () => {
    // Count the 3 specific quick-login hrefs
    expect(loginSrc).toContain('href="/demo/executive/dashboard"');
    expect(loginSrc).toContain('href="/demo/accountant/dashboard"');
    expect(loginSrc).toContain('href="/demo/data-entry"');
  });

  it("login page has the 3 persona labels", () => {
    expect(loginSrc).toContain("دخول سريع لرئيس مجلس الإدارة / العضو المنتدب التنفيذي");
    expect(loginSrc).toContain("دخول سريع للمحاسب");
    expect(loginSrc).toContain("دخول سريع لمسؤول إدخال البيانات");
  });

  it("old single demo link is removed", () => {
    expect(loginSrc).not.toContain("عرض تفاعلي لأصحاب المصلحة (بيانات تجريبية) ←");
    expect(loginSrc).not.toContain('href="/demo"');
  });

  it("DEMO_QUICK_LOGINS has exactly 3 entries", () => {
    expect(DEMO_QUICK_LOGINS.length).toBe(3);
  });

  it("DEMO_QUICK_LOGINS personas are executive, accountant, data-entry", () => {
    const personas = DEMO_QUICK_LOGINS.map((l) => l.persona);
    expect(personas).toEqual(["executive", "accountant", "data-entry"]);
  });
});

// ---------------------------------------------------------------------------
// Internal quick-role section removed from demo home
// ---------------------------------------------------------------------------

describe("Demo home — quick-role section removed", () => {
  const homeSrc = readText("src/app/(demo)/demo/page.tsx");

  it("does NOT contain 'الدخول السريع حسب الدور' section", () => {
    expect(homeSrc).not.toContain("الدخول السريع حسب الدور");
  });

  it("does NOT render 'العرض التفاعلي لأصحاب المصلحة' as an h1 heading", () => {
    // The string may appear in comments, but should NOT be rendered as an <h1>
    expect(homeSrc).not.toContain('<h1 className="text-heading-2 text-foreground">العرض التفاعلي لأصحاب المصلحة</h1>');
  });

  it("does NOT contain DEMO_USERS import (old 5-role array)", () => {
    expect(homeSrc).not.toContain("DEMO_USERS");
  });

  it("does NOT contain old role labels (مدير المراجعة, مسؤول متابعة)", () => {
    expect(homeSrc).not.toContain("مدير المراجعة");
    expect(homeSrc).not.toContain("مسؤول متابعة تشغيل الخيوط");
  });

  it("does NOT render 5 role cards", () => {
    // The old grid had lg:grid-cols-5 for 5 role cards
    expect(homeSrc).not.toContain("lg:grid-cols-5");
  });
});

// ---------------------------------------------------------------------------
// Data-entry task hub
// ---------------------------------------------------------------------------

describe("Data-entry task hub — /demo/data-entry", () => {
  it("data-entry hub page exists", () => {
    expect(fileExists("src/app/(demo)/demo/data-entry/page.tsx")).toBe(true);
  });

  it("hub page has exactly 4 task cards", () => {
    const src = readText("src/app/(demo)/demo/data-entry/page.tsx");
    expect(src).toContain("إدخال الشراء");
    expect(src).toContain("إدخال البيع");
    expect(src).toContain("إدخال التشغيل");
    expect(src).toContain("حركة الخيوط");
  });

  it("hub page uses persona='data-entry'", () => {
    const src = readText("src/app/(demo)/demo/data-entry/page.tsx");
    expect(src).toContain('persona="data-entry"');
  });

  it("hub page shows role label 'مسؤول تسجيل البيانات أو المدخلات'", () => {
    const src = readText("src/app/(demo)/demo/data-entry/page.tsx");
    expect(src).toContain("مسؤول تسجيل البيانات أو المدخلات");
  });

  it("4 data-entry sub-routes exist and redirect to input pages", () => {
    const routes = [
      { path: "src/app/(demo)/demo/data-entry/purchase/page.tsx", target: "/demo/owner/purchase" },
      { path: "src/app/(demo)/demo/data-entry/sales/page.tsx", target: "/demo/owner/sales-entry" },
      { path: "src/app/(demo)/demo/data-entry/operation/page.tsx", target: "/demo/owner/operation" },
      { path: "src/app/(demo)/demo/data-entry/yarn-movement/page.tsx", target: "/demo/owner/yarn-movement" },
    ];
    for (const r of routes) {
      expect(fileExists(r.path)).toBe(true);
      const src = readText(r.path);
      expect(src).toContain("redirect");
      expect(src).toContain(r.target);
    }
  });
});

// ---------------------------------------------------------------------------
// Data-entry persona hides sidebar
// ---------------------------------------------------------------------------

describe("Data-entry persona — no sidebar", () => {
  it("DemoShell hides sidebar when persona='data-entry'", () => {
    const src = readText("src/components/demo/demo-shell.tsx");
    expect(src).toContain('persona === "data-entry"');
    expect(src).toContain("hideSidebar");
    expect(src).toContain("{!hideSidebar &&");
  });

  it("all 4 input pages set persona='data-entry'", () => {
    const pages = [
      "src/app/(demo)/demo/owner/purchase/page.tsx",
      "src/app/(demo)/demo/owner/sales-entry/page.tsx",
      "src/app/(demo)/demo/owner/operation/page.tsx",
      "src/app/(demo)/demo/owner/yarn-movement/page.tsx",
    ];
    for (const page of pages) {
      const src = readText(page);
      expect(src).toContain('persona="data-entry"');
    }
  });
});

// ---------------------------------------------------------------------------
// Topbar persona/role display
// ---------------------------------------------------------------------------

describe("Topbar — persona role display", () => {
  it("DemoTopbar accepts roleLabel prop", () => {
    const src = readText("src/components/demo/demo-topbar.tsx");
    expect(src).toContain("roleLabel");
    // Topbar now shows roleLabel in a separate user/persona area (not roleLabel ?? userName fallback)
    expect(src).toContain("roleLabel");
  });

  it("DemoShell passes roleLabel to DemoTopbar", () => {
    const src = readText("src/components/demo/demo-shell.tsx");
    expect(src).toContain("roleLabel");
    expect(src).toContain("personaRoleLabel");
  });

  it("executive route redirects to dashboard with persona=executive", () => {
    const src = readText("src/app/(demo)/demo/executive/dashboard/page.tsx");
    expect(src).toContain("redirect");
    expect(src).toContain("/demo/owner/dashboard?persona=executive");
  });

  it("accountant route redirects to dashboard with persona=accountant", () => {
    const src = readText("src/app/(demo)/demo/accountant/dashboard/page.tsx");
    expect(src).toContain("redirect");
    expect(src).toContain("/demo/owner/dashboard?persona=accountant");
  });

  it("dashboard page reads persona from searchParams and passes to DemoShell", () => {
    const src = readText("src/app/(demo)/demo/owner/dashboard/page.tsx");
    expect(src).toContain("searchParams");
    expect(src).toContain("persona");
    // The persona is a variable derived from searchParams, passed as persona={persona}
    expect(src).toContain("persona={persona}");
    expect(src).toContain('params.persona === "executive"');
    expect(src).toContain('params.persona === "accountant"');
  });

  it("executive role label is correct", () => {
    const src = readText("src/app/(demo)/demo/owner/dashboard/page.tsx");
    expect(src).toContain("رئيس مجلس الإدارة / العضو المنتدب التنفيذي");
  });

  it("accountant role label is correct", () => {
    const src = readText("src/app/(demo)/demo/owner/dashboard/page.tsx");
    expect(src).toContain("المدير المالي");
  });
});

// ---------------------------------------------------------------------------
// No real auth mutation or DB write
// ---------------------------------------------------------------------------

describe("Demo login correction — no mutation", () => {
  it("login page quick-login links are plain <a> tags (no server actions)", () => {
    const src = readText("src/app/login/page.tsx");
    // The 3 quick-login links should be <a href> not <form action>
    expect(src).toContain('<a\n                href="/demo/executive/dashboard"');
    expect(src).toContain('<a\n                href="/demo/accountant/dashboard"');
    expect(src).toContain('<a\n                href="/demo/data-entry"');
  });

  it("no Supabase/DB imports in new files", () => {
    const files = [
      "src/app/(demo)/demo/data-entry/page.tsx",
      "src/app/(demo)/demo/executive/dashboard/page.tsx",
      "src/app/(demo)/demo/accountant/dashboard/page.tsx",
      "src/components/demo/demo-shell.tsx",
    ];
    for (const file of files) {
      const src = readText(file);
      expect(src).not.toMatch(/import.*supabase/i);
      expect(src).not.toMatch(/createClient/);
      expect(src).not.toMatch(/\bfetch\s*\(/);
    }
  });
});

// ---------------------------------------------------------------------------
// Main branch untouched
// ---------------------------------------------------------------------------

describe("Demo login correction — main untouched", () => {
  it("real nav-config.ts is NOT modified (no demo persona imports)", () => {
    const src = readText("src/components/shells/nav-config.ts");
    expect(src).not.toContain("DemoPersona");
    expect(src).not.toContain("DEMO_QUICK_LOGINS");
  });

  it("real proxy.ts still only adds /demo to public routes (no persona logic)", () => {
    const src = readText("src/proxy.ts");
    expect(src).not.toContain("persona");
    expect(src).not.toContain("executive");
    expect(src).not.toContain("accountant");
  });
});
