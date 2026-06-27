/**
 * WP-00-04 package gate tests — theme and design-system foundation.
 *
 * Contract: docs/contracts/02_design_system_and_ux_contract.md
 * Contract: docs/contracts/13_work_packages.md WP-00-04
 *
 * Tests verify:
 *   - Semantic token definitions exist in globals.css
 *   - No literal colors in components (bg-blue-*, text-gray-*, etc.)
 *   - Light-only behavior (no dark: classes)
 *   - Font/theme foundation present
 *   - No dark-mode/theme-editor implementation
 *   - No accidental business screens/routes
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

function readText(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

// ---------------------------------------------------------------------------
// Semantic token definitions
// ---------------------------------------------------------------------------

describe("WP-00-04 semantic tokens exist in globals.css", () => {
  const css = readText("src/app/globals.css");

  const requiredTokens = [
    "--color-background",
    "--color-surface",
    "--color-surface-elevated",
    "--color-foreground",
    "--color-muted",
    "--color-muted-foreground",
    "--color-primary",
    "--color-primary-foreground",
    "--color-accent",
    "--color-accent-foreground",
    "--color-border",
    "--color-input",
    "--color-ring",
    "--color-overlay",
    "--color-success",
    "--color-success-foreground",
    "--color-warning",
    "--color-warning-foreground",
    "--color-danger",
    "--color-danger-foreground",
    "--color-info",
    "--color-info-foreground",
    "--color-pending",
    "--color-approved",
    "--color-rejected",
    "--color-blocked",
    "--color-negative-stock",
    "--color-needs-review",
    "--color-sidebar",
    "--color-sidebar-foreground",
    "--color-sidebar-active",
    "--color-chart-1",
    "--color-chart-2",
    "--color-chart-3",
    "--color-chart-4",
    "--color-chart-5",
    "--font-sans",
    "--font-heading",
  ];

  for (const token of requiredTokens) {
    it(`defines ${token}`, () => {
      expect(css).toContain(token);
    });
  }
});

// ---------------------------------------------------------------------------
// No literal colors in components
// ---------------------------------------------------------------------------

describe("WP-00-04 no literal colors in components", () => {
  const componentsDir = join(root, "src", "components");

  function walkDir(dir: string): string[] {
    const files: string[] = [];
    try {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        const st = statSync(p);
        if (st.isDirectory()) walkDir(p).forEach((f) => files.push(f));
        else if (/\.(ts|tsx)$/.test(name)) files.push(p);
      }
    } catch {
      // dir doesn't exist yet
    }
    return files;
  }

  const componentFiles = walkDir(componentsDir);

  // Literal color patterns to reject:
  // bg-blue-*, bg-red-*, bg-green-*, bg-slate-*, bg-gray-*, text-blue-*, etc.
  // border-blue-*, etc.
  const literalColorPattern =
    /\b(bg|text|border|ring|fill|stroke)-(blue|red|green|slate|gray|amber|yellow|emerald|teal|indigo|violet|purple|pink|rose|orange|lime|cyan|sky|fuchsia)-\d+/;

  for (const file of componentFiles) {
    const rel = relative(root, file);
    it(`${rel} has no literal Tailwind color utilities`, () => {
      const content = readFileSync(file, "utf8");
      // Check className strings for literal colors
      const matches = content.match(literalColorPattern);
      if (matches) {
        throw new Error(
          `Literal color utility '${matches[0]}' found in ${rel}. Use semantic utilities (bg-primary, text-foreground, etc.) instead.`,
        );
      }
    });
  }

  it("at least one component file exists (button.tsx)", () => {
    expect(componentFiles.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Light-only behavior (no dark: classes)
// ---------------------------------------------------------------------------

describe("WP-00-04 light-only behavior", () => {
  it("globals.css has no dark: variant classes", () => {
    const css = readText("src/app/globals.css");
    expect(css).not.toMatch(/\.dark\s|dark:/);
  });

  it("layout.tsx has no dark mode provider or dark class", () => {
    const layout = readText("src/app/layout.tsx");
    expect(layout).not.toMatch(/dark|theme-provider|ThemeProvider/i);
  });

  it("no theme-editor or dark-mode toggle component exists", () => {
    const componentsDir = join(root, "src", "components");
    let foundDarkToggle = false;
    try {
      for (const name of readdirSync(componentsDir)) {
        if (/dark|theme-toggle|theme-switch/i.test(name)) {
          foundDarkToggle = true;
        }
      }
    } catch {
      // no components dir
    }
    expect(foundDarkToggle).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Font/theme foundation present
// ---------------------------------------------------------------------------

describe("WP-00-04 font foundation", () => {
  it("fonts.ts exports tajawal and alexandria", () => {
    const fonts = readText("src/lib/fonts.ts");
    expect(fonts).toMatch(/export const tajawal/);
    expect(fonts).toMatch(/export const alexandria/);
    expect(fonts).toMatch(/Tajawal/);
    expect(fonts).toMatch(/Alexandria/);
  });

  it("layout.tsx imports and applies font variables", () => {
    const layout = readText("src/app/layout.tsx");
    expect(layout).toMatch(/import.*tajawal.*alexandria.*from.*@\/lib\/fonts/);
    expect(layout).toMatch(/tajawal\.variable/);
    expect(layout).toMatch(/alexandria\.variable/);
  });

  it("globals.css maps --font-sans to Tajawal and --font-heading to Alexandria", () => {
    const css = readText("src/app/globals.css");
    expect(css).toMatch(/--font-sans:\s*var\(--font-tajawal\)/);
    expect(css).toMatch(/--font-heading:\s*var\(--font-alexandria\)/);
  });
});

describe("WP-00-04 type hierarchy classes", () => {
  const css = readText("src/app/globals.css");

  const requiredClasses = [
    ".text-page-title",
    ".text-section-title",
    ".text-card-title",
    ".text-body",
    ".text-table-compact",
    ".text-label",
    ".text-helper",
    ".text-validation",
    ".text-numeric-kpi",
    ".text-code-identifier",
    ".text-status-badge",
  ];

  for (const cls of requiredClasses) {
    it(`defines ${cls}`, () => {
      expect(css).toContain(cls);
    });
  }
});

// ---------------------------------------------------------------------------
// cn utility
// ---------------------------------------------------------------------------

describe("WP-00-04 cn utility", () => {
  it("cn.ts exists and exports cn function", () => {
    const cn = readText("src/lib/cn.ts");
    expect(cn).toMatch(/export function cn/);
    expect(cn).toMatch(/clsx/);
    expect(cn).toMatch(/twMerge/);
  });
});

// ---------------------------------------------------------------------------
// No accidental business screens/routes
// ---------------------------------------------------------------------------

describe("WP-00-04 no accidental business screens", () => {
  it("app directory has only page.tsx, layout.tsx, globals.css (no business routes)", () => {
    const appDir = join(root, "src", "app");
    const entries = readdirSync(appDir).filter(
      (e) => !e.startsWith(".") && e !== "api" && e !== "auth" && e !== "login",
    );
    // Should be: globals.css, layout.tsx, page.tsx
    expect(entries.sort()).toEqual(["globals.css", "layout.tsx", "page.tsx"]);
  });
});

// ---------------------------------------------------------------------------
// Accessibility baseline
// ---------------------------------------------------------------------------

describe("WP-00-04 accessibility baseline", () => {
  it("globals.css has focus-visible outline", () => {
    const css = readText("src/app/globals.css");
    expect(css).toMatch(/focus-visible/);
    expect(css).toMatch(/outline.*ring/);
  });

  it("globals.css has reduced-motion media query", () => {
    const css = readText("src/app/globals.css");
    expect(css).toMatch(/prefers-reduced-motion/);
  });

  it("globals.css has min-touch-target utility", () => {
    const css = readText("src/app/globals.css");
    expect(css).toMatch(/min-touch-target/);
    expect(css).toMatch(/min-width:\s*44px/);
    expect(css).toMatch(/min-height:\s*44px/);
  });

  it("Button component has focus-visible ring", () => {
    const btn = readText("src/components/ui/button.tsx");
    expect(btn).toMatch(/focus-visible:ring/);
  });

  it("Button md/lg sizes meet 44px minimum", () => {
    const btn = readText("src/components/ui/button.tsx");
    expect(btn).toMatch(/h-11/); // 44px = 2.75rem = h-11
  });
});
