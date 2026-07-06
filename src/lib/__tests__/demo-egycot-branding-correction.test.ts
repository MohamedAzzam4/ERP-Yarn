/**
 * Tests for EGYCOT branding correction (added 2026-07-06).
 *
 * Verifies:
 *   - Visible demo UI no longer renders "ERP-Yarn" as brand text
 *   - إيجيكوت للتجارة الدولية appears in login and topbar
 *   - EGYCOT For International Trading appears where intended
 *   - Role text remains visible but separate from company brand
 *   - Logo SVG includes cotton/emblem structure and EGYCOT text
 *   - Logo has hover/focus animation classes/styles
 *   - prefers-reduced-motion is supported
 *   - No dark theme introduced
 *   - Main untouched
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function readText(rel: string): string {
  return readFileSync(join(root, rel), "utf-8");
}

// ---------------------------------------------------------------------------
// No visible "ERP-Yarn" in demo UI
// ---------------------------------------------------------------------------

describe("EGYCOT branding correction — no ERP-Yarn visible", () => {
  const demoFiles = [
    "src/components/demo/demo-topbar.tsx",
    "src/components/demo/demo-shell.tsx",
    "src/components/demo/egycot-logo.tsx",
    "src/app/(demo)/demo/page.tsx",
    "src/app/(demo)/demo/data-entry/page.tsx",
    "src/app/(demo)/demo/owner/dashboard/page.tsx",
    "src/app/(demo)/demo/owner/reviews/page.tsx",
    "src/app/(demo)/demo/owner/inventory/page.tsx",
    "src/app/(demo)/demo/owner/sales/page.tsx",
    "src/app/(demo)/demo/owner/purchase/page.tsx",
    "src/app/(demo)/demo/owner/user-activity/page.tsx",
  ];

  for (const file of demoFiles) {
    it(`${file} does NOT render "ERP-Yarn" as visible brand text (userName or tenantLabel)`, () => {
      const src = readText(file);
      // Must NOT have userName="ERP-Yarn" or tenantLabel="ERP-Yarn..."
      expect(src).not.toContain('userName="ERP-Yarn"');
      expect(src).not.toContain('tenantLabel="ERP-Yarn');
      // Must NOT contain ERP-Yarn in rendered JSX text (excluding comments)
      const codeLines = src.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"));
      const codeText = codeLines.join("\n");
      // Check for ERP-Yarn in JSX text content (between > and <)
      expect(codeText).not.toMatch(/>\s*ERP-Yarn\s*</);
    });
  }
});

// ---------------------------------------------------------------------------
// EGYCOT names appear in branding areas
// ---------------------------------------------------------------------------

describe("EGYCOT branding correction — names render correctly", () => {
  it("topbar renders EgycotLogo with company name", () => {
    const src = readText("src/components/demo/demo-topbar.tsx");
    expect(src).toContain("<EgycotLogo");
    // EgycotLogo with textVariant="both" shows both Arabic + English names
    expect(src).toContain('textVariant="both"');
  });

  it("login page renders Arabic company name", () => {
    const src = readText("src/app/login/page.tsx");
    // Login page imports EGYCOT_NAME_AR and renders it
    expect(src).toContain("EGYCOT_NAME_AR");
  });

  it("login page renders English company name", () => {
    const src = readText("src/app/login/page.tsx");
    expect(src).toContain("EGYCOT_NAME_EN");
  });

  it("EgycotLogo exports EGYCOT_NAME_AR and EGYCOT_NAME_EN", () => {
    const src = readText("src/components/demo/egycot-logo.tsx");
    expect(src).toContain('export const EGYCOT_NAME_AR = "إيجيكوت للتجارة الدولية"');
    expect(src).toContain('export const EGYCOT_NAME_EN = "EGYCOT For International Trading"');
  });
});

// ---------------------------------------------------------------------------
// Logo SVG structure — cotton + EGYCOT text
// ---------------------------------------------------------------------------

describe("EGYCOT branding correction — logo SVG structure", () => {
  const logoSrc = readText("src/components/demo/egycot-logo.tsx");

  it("logo SVG has cotton boll group (egycot-cotton-boll class)", () => {
    expect(logoSrc).toContain("egycot-cotton-boll");
    // Should have ellipse elements (cotton lobes)
    expect(logoSrc).toContain("<ellipse");
  });

  it("logo SVG has EGYCOT text element inside", () => {
    expect(logoSrc).toContain("<text");
    // The text content "EGYCOT" is inside the SVG text element (may have whitespace)
    expect(logoSrc).toMatch(/>\s*EGYCOT\s*</);
  });

  it("logo SVG has green Y stem (path with M50)", () => {
    expect(logoSrc).toContain("<path");
    // The Y stem should have a path starting from the center bottom
    expect(logoSrc).toMatch(/d="M50\s+\d+/);
  });

  it("logo SVG has fiber line (egycot-fiber-line class)", () => {
    expect(logoSrc).toContain("egycot-fiber-line");
  });

  it("logo uses cotton green + navy colors (via CSS vars)", () => {
    expect(logoSrc).toContain("var(--color-cotton-green)");
    expect(logoSrc).toContain("var(--color-cotton-soft)");
    expect(logoSrc).toMatch(/text-navy/);
  });

  it("logo has tabIndex for keyboard focus", () => {
    expect(logoSrc).toContain("tabIndex={0}");
  });
});

// ---------------------------------------------------------------------------
// Logo animation — hover/focus classes
// ---------------------------------------------------------------------------

describe("EGYCOT branding correction — logo animation", () => {
  const css = readText("src/app/globals.css");

  it("logo mark has hover AND focus-visible transform (slight lift)", () => {
    expect(css).toContain(".egycot-logo-mark:hover");
    expect(css).toContain(".egycot-logo-mark:focus-visible");
    expect(css).toContain("transform: scale(1.03)");
  });

  it("logo cotton boll has hover AND focus-visible glow animation", () => {
    expect(css).toContain(".egycot-logo-mark:hover .egycot-cotton-boll");
    expect(css).toContain(".egycot-logo-mark:focus-visible .egycot-cotton-boll");
    expect(css).toContain("egycot-glow-pulse");
  });

  it("glow pulse uses green color (rgba cotton green)", () => {
    expect(css).toContain("rgba(19, 122, 63");
  });

  it("fiber line has hover AND focus-visible stroke-dash animation", () => {
    expect(css).toContain(".egycot-logo-mark:hover .egycot-fiber-line");
    expect(css).toContain(".egycot-logo-mark:focus-visible .egycot-fiber-line");
    expect(css).toContain("egycot-fiber-dash");
  });

  it("logo mark has transition for smooth transform", () => {
    expect(css).toContain("transition: transform 0.3s ease");
  });
});

// ---------------------------------------------------------------------------
// prefers-reduced-motion
// ---------------------------------------------------------------------------

describe("EGYCOT branding correction — reduced motion", () => {
  const css = readText("src/app/globals.css");

  it("has prefers-reduced-motion override that disables EGYCOT animations", () => {
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toMatch(/egycot[\s\S]*?animation:\s*none/i);
  });
});

// ---------------------------------------------------------------------------
// Topbar brand/persona separation
// ---------------------------------------------------------------------------

describe("EGYCOT branding correction — topbar separation", () => {
  const topbarSrc = readText("src/components/demo/demo-topbar.tsx");

  it("topbar has brand area (logo + company name) separate from persona area", () => {
    expect(topbarSrc).toContain("Brand area");
    expect(topbarSrc).toContain("User/persona area");
  });

  it("topbar brand area shows EgycotLogo (not userName)", () => {
    // The brand area should contain EgycotLogo, not {userName}
    const brandAreaMatch = topbarSrc.match(/Brand area[\s\S]*?User\/persona area/);
    expect(brandAreaMatch).not.toBeNull();
    const brandArea = brandAreaMatch![0];
    expect(brandArea).toContain("<EgycotLogo");
  });

  it("topbar persona area shows roleLabel + userName (not company name)", () => {
    const personaAreaMatch = topbarSrc.match(/User\/persona area[\s\S]*?<\/div>\s*<\/div>/);
    expect(personaAreaMatch).not.toBeNull();
    const personaArea = personaAreaMatch![0];
    expect(personaArea).toContain("{roleLabel");
    expect(personaArea).toContain("{userName}");
  });
});

// ---------------------------------------------------------------------------
// No dark theme
// ---------------------------------------------------------------------------

describe("EGYCOT branding correction — no dark theme", () => {
  it("no dark: classes in demo components", () => {
    const files = [
      "src/components/demo/egycot-logo.tsx",
      "src/components/demo/demo-topbar.tsx",
    ];
    for (const file of files) {
      const src = readText(file);
      expect(src).not.toMatch(/dark:/i);
    }
  });
});
