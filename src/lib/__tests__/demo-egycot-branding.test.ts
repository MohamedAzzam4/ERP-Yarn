/**
 * Tests for EGYCOT brand identity tuning (added 2026-07-06).
 *
 * Verifies:
 *   - Company Arabic and English names render in branding areas
 *   - EgycotLogo component exists and is importable
 *   - No dark theme is introduced
 *   - prefers-reduced-motion is respected for animation
 *   - No excessive hardcoded random colors (uses CSS tokens)
 *   - Topbar shows logo + company name + user/role separately
 *   - Login page has EGYCOT branding + branded background
 *   - Sidebar header uses EGYCOT branding
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function readText(rel: string): string {
  return readFileSync(join(root, rel), "utf-8");
}

function fileExists(rel: string): boolean {
  return existsSync(join(root, rel));
}

// ---------------------------------------------------------------------------
// EgycotLogo component
// ---------------------------------------------------------------------------

describe("EGYCOT branding — logo component", () => {
  it("EgycotLogo component file exists", () => {
    expect(fileExists("src/components/demo/egycot-logo.tsx")).toBe(true);
  });

  it("exports EGYCOT_NAME_AR and EGYCOT_NAME_EN constants", () => {
    const src = readText("src/components/demo/egycot-logo.tsx");
    expect(src).toContain("EGYCOT_NAME_AR");
    expect(src).toContain("EGYCOT_NAME_EN");
    expect(src).toContain("إيجيكوت للتجارة الدولية");
    expect(src).toContain("EGYCOT For International Trading");
  });

  it("uses inline SVG (not external image)", () => {
    const src = readText("src/components/demo/egycot-logo.tsx");
    expect(src).toContain("<svg");
    expect(src).toContain("viewBox");
  });

  it("uses CSS variables for colors (not hardcoded hex)", () => {
    const src = readText("src/components/demo/egycot-logo.tsx");
    expect(src).toContain("var(--color-cotton-green)");
    expect(src).toContain("var(--color-cotton-soft)");
    expect(src).toContain("var(--color-primary)");
    // Navy is used via Tailwind text-navy class (which maps to --color-navy)
    expect(src).toMatch(/text-navy/);
  });

  it("supports compact mode and text variants", () => {
    const src = readText("src/components/demo/egycot-logo.tsx");
    expect(src).toContain("compact");
    expect(src).toContain("textVariant");
    expect(src).toContain('"ar"');
    expect(src).toContain('"en"');
    expect(src).toContain('"short"');
    expect(src).toContain('"both"');
  });
});

// ---------------------------------------------------------------------------
// Design tokens — EGYCOT palette
// ---------------------------------------------------------------------------

describe("EGYCOT branding — design tokens", () => {
  const css = readText("src/app/globals.css");

  it("has --color-navy token with EGYCOT navy (#0b1f4d)", () => {
    expect(css).toContain("--color-navy: #0b1f4d");
  });

  it("has --color-cotton-green token (#137a3f)", () => {
    expect(css).toContain("--color-cotton-green: #137a3f");
  });

  it("has --color-cotton-soft token (#dcefd8)", () => {
    expect(css).toContain("--color-cotton-soft: #dcefd8");
  });

  it("has --color-surface-tinted token (#f8fbff)", () => {
    expect(css).toContain("--color-surface-tinted: #f8fbff");
  });

  it("updated --color-primary to EGYCOT blue (#2f5ecb)", () => {
    expect(css).toContain("--color-primary: #2f5ecb");
  });

  it("updated --color-foreground to #0f172a", () => {
    expect(css).toContain("--color-foreground: #0f172a");
  });

  it("updated --color-border to #d8e2ee", () => {
    expect(css).toContain("--color-border: #d8e2ee");
  });

  it("updated --color-success to #16834a", () => {
    expect(css).toContain("--color-success: #16834a");
  });

  it("updated --color-warning to #d97706", () => {
    expect(css).toContain("--color-warning: #d97706");
  });

  it("updated --color-danger to #dc2626", () => {
    expect(css).toContain("--color-danger: #dc2626");
  });

  it("updated --color-info to #2563eb", () => {
    expect(css).toContain("--color-info: #2563eb");
  });

  it("chart palette has no duplicate hex values", () => {
    const chartColors = css.match(/--color-chart-\d+: #([0-9a-f]{6})/gi) ?? [];
    const hexValues = chartColors.map((c) => c.replace(/.*: #/, "").toLowerCase());
    const unique = new Set(hexValues);
    expect(unique.size).toBe(hexValues.length);
  });
});

// ---------------------------------------------------------------------------
// No dark theme introduced
// ---------------------------------------------------------------------------

describe("EGYCOT branding — no dark theme", () => {
  it("globals.css does not add dark mode classes or theme variables", () => {
    const css = readText("src/app/globals.css");
    // Should NOT contain dark mode tokens or dark: classes
    expect(css).not.toMatch(/--color-dark-/i);
    expect(css).not.toMatch(/\.dark\s*\{/);
  });

  it("no ThemeProvider or dark mode toggle is introduced", () => {
    const files = [
      "src/components/demo/egycot-logo.tsx",
      "src/components/demo/demo-topbar.tsx",
      "src/components/demo/demo-shell.tsx",
    ];
    for (const file of files) {
      if (fileExists(file)) {
        const src = readText(file);
        expect(src).not.toMatch(/ThemeProvider/i);
        expect(src).not.toMatch(/dark:/i);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// prefers-reduced-motion respected
// ---------------------------------------------------------------------------

describe("EGYCOT branding — reduced motion", () => {
  it("globals.css has prefers-reduced-motion override for EGYCOT animations", () => {
    const css = readText("src/app/globals.css");
    expect(css).toContain("prefers-reduced-motion: reduce");
    // EGYCOT-specific animation override (may span multiple lines)
    expect(css).toMatch(/egycot[\s\S]*?animation:\s*none/i);
  });

  it("logo animations are hover-only (not constant)", () => {
    const css = readText("src/app/globals.css");
    // The animation should be on :hover, not always-on
    expect(css).toContain(".egycot-logo-mark:hover .egycot-fiber-line");
    expect(css).toContain(".egycot-logo-mark:hover .egycot-cotton-boll");
    // Should NOT have a constant (non-hover) animation on the logo
    expect(css).not.toMatch(/^\.egycot-logo-mark\s+\{[^}]*animation/im);
  });
});

// ---------------------------------------------------------------------------
// Topbar branding
// ---------------------------------------------------------------------------

describe("EGYCOT branding — topbar", () => {
  const topbarSrc = readText("src/components/demo/demo-topbar.tsx");

  it("imports and renders EgycotLogo", () => {
    expect(topbarSrc).toContain("import { EgycotLogo }");
    expect(topbarSrc).toContain("<EgycotLogo");
  });

  it("shows company name (Arabic) via EgycotLogo component", () => {
    // The EgycotLogo component with textVariant="both" shows Arabic name
    expect(topbarSrc).toContain('textVariant="both"');
  });

  it("user/persona area is separate from company branding", () => {
    // The topbar should have two distinct areas: brand + user
    expect(topbarSrc).toContain("Brand area");
    expect(topbarSrc).toContain("User/persona area");
  });

  it("user name and roleLabel are still rendered (not replaced by company name)", () => {
    expect(topbarSrc).toContain("{userName}");
    expect(topbarSrc).toContain("{roleLabel}");
  });
});

// ---------------------------------------------------------------------------
// Login page branding
// ---------------------------------------------------------------------------

describe("EGYCOT branding — login page", () => {
  const loginSrc = readText("src/app/login/page.tsx");

  it("imports EgycotLogo and company name constants", () => {
    expect(loginSrc).toContain("import { EgycotLogo");
    expect(loginSrc).toContain("EGYCOT_NAME_AR");
    expect(loginSrc).toContain("EGYCOT_NAME_EN");
  });

  it("renders EGYCOT logo above the login card", () => {
    expect(loginSrc).toContain("<EgycotLogo");
    expect(loginSrc).toContain('size={56}');
  });

  it("renders Arabic company name", () => {
    expect(loginSrc).toContain("{EGYCOT_NAME_AR}");
  });

  it("renders English company name", () => {
    expect(loginSrc).toContain("{EGYCOT_NAME_EN}");
  });

  it("uses egycot-login-bg class for branded background", () => {
    expect(loginSrc).toContain("egycot-login-bg");
  });
});

// ---------------------------------------------------------------------------
// Sidebar branding
// ---------------------------------------------------------------------------

describe("EGYCOT branding — sidebar", () => {
  const sidebarSrc = readText("src/components/shells/sidebar.tsx");

  it("imports EgycotLogo", () => {
    expect(sidebarSrc).toContain("import { EgycotLogo }");
  });

  it("uses EgycotLogo in expanded header (not old 'E' mark)", () => {
    expect(sidebarSrc).toContain("<EgycotLogo");
    // The old code had: bg-gradient-to-br from-primary to-primary/70 ... E
    // This should be replaced with EgycotLogo
    expect(sidebarSrc).not.toContain('aria-hidden="true"\n                >\n                  E');
  });

  it("shows short Arabic brand name 'إيجيكوت' in sidebar header", () => {
    expect(sidebarSrc).toContain("إيجيكوت");
  });
});

// ---------------------------------------------------------------------------
// Login background CSS
// ---------------------------------------------------------------------------

describe("EGYCOT branding — login background CSS", () => {
  const css = readText("src/app/globals.css");

  it("has .egycot-login-bg class with light gradient background", () => {
    expect(css).toContain(".egycot-login-bg");
    expect(css).toContain("linear-gradient");
    // Light colors only — not dark
    expect(css).toContain("#f8fbff");
  });

  it("login background uses low-opacity decorative elements", () => {
    expect(css).toContain("opacity");
    // The SVG watermark should be very subtle
    expect(css).toMatch(/opacity['"]?\s*[:=]?\s*['"]?0\.0[1-9]/);
  });

  it("login background is not dark (no dark hex values)", () => {
    const loginBgMatch = css.match(/\.egycot-login-bg\s*\{[^}]+\}/);
    expect(loginBgMatch).not.toBeNull();
    const loginBg = loginBgMatch![0];
    // Should not contain very dark colors
    expect(loginBg).not.toMatch(/#[0-3][0-9a-f]{5}/i);
  });
});

// ---------------------------------------------------------------------------
// No excessive hardcoded random colors
// ---------------------------------------------------------------------------

describe("EGYCOT branding — no random hardcoded colors", () => {
  it("EgycotLogo uses CSS variables, not hardcoded hex", () => {
    const src = readText("src/components/demo/egycot-logo.tsx");
    // Should use var(--color-*) not #hex
    expect(src).toContain("var(--color-");
    // Should NOT have hardcoded hex colors (except in comments)
    const codeLines = src.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"));
    const hexInCode = codeLines.join("\n").match(/#[0-9a-fA-F]{6}/g);
    // Allow zero hardcoded hex in the component code (colors come from CSS vars)
    expect(hexInCode).toBeNull();
  });
});
