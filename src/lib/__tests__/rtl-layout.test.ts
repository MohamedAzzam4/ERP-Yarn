/**
 * WP-00-05 package gate tests — Arabic RTL and Layout Foundation.
 *
 * Contract: docs/contracts/02_design_system_and_ux_contract.md
 *   §Arabic-First Root Direction, §Local LTR Isolation
 * Contract: docs/contracts/13_work_packages.md WP-00-05
 * DEC-040: <html lang="ar" dir="rtl">; no dir="auto" for critical sentences.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function readText(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

// ---------------------------------------------------------------------------
// Root RTL verification
// ---------------------------------------------------------------------------

describe("WP-00-05 root <html lang='ar' dir='rtl'>", () => {
  it("layout.tsx has <html lang=\"ar\" dir=\"rtl\">", () => {
    const layout = readText("src/app/layout.tsx");
    expect(layout).toMatch(/lang="ar"/);
    expect(layout).toMatch(/dir="rtl"/);
  });

  it("layout.tsx does NOT use dir=\"auto\" on html or body", () => {
    const layout = readText("src/app/layout.tsx");
    expect(layout).not.toMatch(/dir="auto"/);
  });
});

// ---------------------------------------------------------------------------
// LTR isolation component
// ---------------------------------------------------------------------------

describe("WP-00-05 LtrValue component", () => {
  it("ltr-value.tsx exists and exports LtrValue", () => {
    const src = readText("src/components/ui/ltr-value.tsx");
    expect(src).toMatch(/export const LtrValue/);
  });

  it("uses dir=\"ltr\" on the rendered element", () => {
    const src = readText("src/components/ui/ltr-value.tsx");
    expect(src).toMatch(/dir="ltr"/);
  });

  it("defaults to bdi element", () => {
    const src = readText("src/components/ui/ltr-value.tsx");
    expect(src).toMatch(/as:\s*Component\s*=\s*"bdi"/);
  });

  it("does NOT use dir=\"auto\"", () => {
    const src = readText("src/components/ui/ltr-value.tsx");
    expect(src).not.toMatch(/dir="auto"/);
  });
});

// ---------------------------------------------------------------------------
// No dir="auto" in source files
// ---------------------------------------------------------------------------

describe("WP-00-05 no dir=\"auto\" misuse", () => {
  const dirsToCheck = [
    join(root, "src", "app"),
    join(root, "src", "components"),
  ];

  for (const dir of dirsToCheck) {
    function walkDir(d: string): string[] {
      const files: string[] = [];
      try {
        for (const name of readdirSync(d)) {
          const p = join(d, name);
          const st = statSync(p);
          if (st.isDirectory()) walkDir(p).forEach((f) => files.push(f));
          else if (/\.(ts|tsx)$/.test(name)) files.push(p);
        }
      } catch { /* dir doesn't exist */ }
      return files;
    }

    for (const file of walkDir(dir)) {
      const rel = relative(root, file);
      it(`${rel} has no dir="auto"`, () => {
        const content = readFileSync(file, "utf8");
        // Allow dir="auto" only in comments
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          const trimmed = line.trim();
          const isComment = trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
          if (!isComment && line.includes('dir="auto"')) {
            throw new Error(`dir="auto" found in ${rel}:${i + 1}: ${line.trim()}`);
          }
        }
      });
    }
  }
});

// ---------------------------------------------------------------------------
// No literal colors in new components
// ---------------------------------------------------------------------------

describe("WP-00-05 no literal colors in new components", () => {
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
    } catch { /* dir doesn't exist */ }
    return files;
  }

  const componentFiles = walkDir(componentsDir);
  const literalColorPattern =
    /\b(bg|text|border|ring|fill|stroke)-(blue|red|green|slate|gray|amber|yellow|emerald|teal|indigo|violet|purple|pink|rose|orange|lime|cyan|sky|fuchsia)-\d+/;

  for (const file of componentFiles) {
    const rel = relative(root, file);
    it(`${rel} has no literal Tailwind color utilities`, () => {
      const content = readFileSync(file, "utf8");
      const matches = content.match(literalColorPattern);
      if (matches) {
        throw new Error(
          `Literal color utility '${matches[0]}' found in ${rel}. Use semantic utilities instead.`,
        );
      }
    });
  }
});

// ---------------------------------------------------------------------------
// RTL-safe CSS utilities
// ---------------------------------------------------------------------------

describe("WP-00-05 globals.css RTL utilities", () => {
  it("has .bidi-ltr utility class", () => {
    const css = readText("src/app/globals.css");
    expect(css).toMatch(/\.bidi-ltr/);
    expect(css).toMatch(/direction:\s*ltr/);
    expect(css).toMatch(/unicode-bidi:\s*isolate/);
  });
});

// ---------------------------------------------------------------------------
// Alert component accessibility
// ---------------------------------------------------------------------------

describe("WP-00-05 Alert component accessibility", () => {
  it("has role=\"alert\"", () => {
    const src = readText("src/components/ui/alert.tsx");
    expect(src).toMatch(/role="alert"/);
  });

  it("has focus-visible ring", () => {
    const src = readText("src/components/ui/alert.tsx");
    expect(src).toMatch(/focus-visible:ring/);
  });

  it("uses semantic color utilities (not literal colors)", () => {
    const src = readText("src/components/ui/alert.tsx");
    expect(src).toMatch(/border-info|border-success|border-warning|border-danger/);
    // No literal colors
    expect(src).not.toMatch(/\b(bg|text|border)-(blue|red|green|slate|gray)-\d+/);
  });
});

// ---------------------------------------------------------------------------
// Container component
// ---------------------------------------------------------------------------

describe("WP-00-05 Container component", () => {
  it("uses px-4 (logical padding) not pl/pr", () => {
    const src = readText("src/components/ui/container.tsx");
    expect(src).toMatch(/px-4/);
    // Check that there are no physical left/right padding utilities
    // like pl-4 or pr-4 in actual className strings (not comments)
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const trimmed = line.trim();
      const isComment = trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
      if (!isComment) {
        const physicalPadding = line.match(/(?:^|["'\s])p[lr]-\d/g);
        if (physicalPadding) {
          throw new Error(`Physical padding '${physicalPadding[0]}' found in container.tsx:${i + 1}`);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// No accidental business screens
// ---------------------------------------------------------------------------

describe("WP-00-05 no accidental business screens", () => {
  it("app directory has only page.tsx, layout.tsx, globals.css", () => {
    const appDir = join(root, "src", "app");
    const entries = readdirSync(appDir).filter(
      (e) => !e.startsWith(".") && e !== "api" && e !== "auth" && e !== "login",
    );
    expect(entries.sort()).toEqual(["globals.css", "layout.tsx", "page.tsx"]);
  });
});

// ---------------------------------------------------------------------------
// Font variables still present (WP-00-04 preserved)
// ---------------------------------------------------------------------------

describe("WP-00-05 preserves WP-00-04 font foundation", () => {
  it("layout.tsx still imports and applies font variables", () => {
    const layout = readText("src/app/layout.tsx");
    expect(layout).toMatch(/tajawal\.variable/);
    expect(layout).toMatch(/alexandria\.variable/);
  });
});
