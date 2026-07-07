/**
 * Tests for real EGYCOT brand assets + sidebar icons + glassmorphism (added 2026-07-07).
 *
 * Verifies:
 *   - Provided logo SVG asset is used instead of generated logo
 *   - Login page uses login-background.png
 *   - Background is not used on internal app pages
 *   - Login card has glassmorphism styling
 *   - Sidebar section titles have distinct styling from page links
 *   - Icons render in expanded sidebar
 *   - Collapsed sidebar renders icons (not cut-off text)
 *   - Accessible labels exist for collapsed icons
 *   - Main branch untouched
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
// Real logo asset
// ---------------------------------------------------------------------------

describe("EGYCOT brand assets — real logo", () => {
  it("provided SVG logo file exists at public/brand/egycot-logo.svg", () => {
    expect(fileExists("public/brand/egycot-logo.svg")).toBe(true);
  });

  it("EgycotLogo component uses the real SVG asset (not generated SVG)", () => {
    const src = readText("src/components/demo/egycot-logo.tsx");
    expect(src).toContain("/brand/egycot-logo.svg");
    expect(src).toContain("<img");
    // Should NOT contain old generated SVG elements (ellipse, path, etc.)
    expect(src).not.toContain("<ellipse");
    expect(src).not.toContain("<path");
    expect(src).not.toContain("egycot-cotton-boll");
    expect(src).not.toContain("egycot-fiber-line");
  });

  it("logo has correct alt text", () => {
    const src = readText("src/components/demo/egycot-logo.tsx");
    expect(src).toContain("شعار إيجيكوت للتجارة الدولية");
  });
});

// ---------------------------------------------------------------------------
// Login background
// ---------------------------------------------------------------------------

describe("EGYCOT brand assets — login background", () => {
  it("provided Background.png file exists at public/brand/login-background.png", () => {
    expect(fileExists("public/brand/login-background.png")).toBe(true);
  });

  it("login page uses login-background.png", () => {
    const src = readText("src/app/login/page.tsx");
    expect(src).toContain("/brand/login-background.png");
    expect(src).toContain("backgroundSize: \"cover\"");
    expect(src).toContain("backgroundPosition: \"center\"");
  });

  it("background is NOT used on internal demo pages", () => {
    const internalPages = [
      "src/app/(demo)/demo/owner/dashboard/page.tsx",
      "src/app/(demo)/demo/owner/inventory/page.tsx",
      "src/app/(demo)/demo/owner/purchase/page.tsx",
      "src/app/(demo)/demo/owner/reviews/page.tsx",
      "src/app/(demo)/demo/owner/user-activity/page.tsx",
    ];
    for (const page of internalPages) {
      const src = readText(page);
      expect(src).not.toContain("login-background.png");
      expect(src).not.toContain("backgroundImage");
    }
  });
});

// ---------------------------------------------------------------------------
// Glassmorphism
// ---------------------------------------------------------------------------

describe("EGYCOT brand assets — glassmorphism login card", () => {
  it("login card has glassmorphism styling (bg-white/65 + backdrop-blur-xl)", () => {
    const src = readText("src/app/login/page.tsx");
    expect(src).toContain("bg-white/65");
    expect(src).toContain("backdrop-blur-xl");
  });

  it("login card has subtle border + shadow", () => {
    const src = readText("src/app/login/page.tsx");
    expect(src).toContain("border");
    expect(src).toContain("shadow");
  });

  it("login page has light overlay for readability", () => {
    const src = readText("src/app/login/page.tsx");
    expect(src).toContain("bg-white/40");
  });
});

// ---------------------------------------------------------------------------
// Sidebar visual hierarchy
// ---------------------------------------------------------------------------

describe("EGYCOT brand assets — sidebar hierarchy", () => {
  const sidebarSrc = readText("src/components/shells/sidebar.tsx");

  it("section titles use font-bold + text-navy (distinct from page links)", () => {
    expect(sidebarSrc).toContain("font-bold");
    expect(sidebarSrc).toContain("text-navy");
  });

  it("section titles are text-sm (larger than old text-xs)", () => {
    // Old was text-xs font-semibold uppercase — new is text-sm font-bold
    expect(sidebarSrc).toContain("text-sm font-bold text-navy");
  });

  it("page items use text-sm (normal size, not bold by default)", () => {
    // Page items should have text-sm but NOT font-bold (only active gets font-bold)
    expect(sidebarSrc).toContain("text-sm transition-colors");
  });

  it("section title has icon support", () => {
    expect(sidebarSrc).toContain("SidebarIcon");
    expect(sidebarSrc).toContain("categoryIcon");
  });
});

// ---------------------------------------------------------------------------
// Sidebar icons
// ---------------------------------------------------------------------------

describe("EGYCOT brand assets — sidebar icons", () => {
  it("sidebar-icons.tsx component file exists", () => {
    expect(fileExists("src/components/demo/sidebar-icons.tsx")).toBe(true);
  });

  it("sidebar imports SidebarIcon", () => {
    const src = readText("src/components/shells/sidebar.tsx");
    expect(src).toContain("import { SidebarIcon }");
  });

  it("demo nav config has icon names on items + categories", () => {
    const src = readText("src/components/demo/demo-nav-config.ts");
    expect(src).toContain("icon:");
    // Check specific icon names
    expect(src).toContain('"dashboard"');
    expect(src).toContain('"check"');
    expect(src).toContain('"boxes"');
    expect(src).toContain('"cart"');
    expect(src).toContain('"factory"');
    expect(src).toContain('"transfer"');
  });

  it("collapsed sidebar renders icons (not dots)", () => {
    const src = readText("src/components/shells/sidebar.tsx");
    // Collapsed mode should use SidebarIcon when itemIcon is available
    expect(src).toContain("itemIcon");
    expect(src).toContain("<SidebarIcon name={itemIcon}");
  });

  it("collapsed sidebar items have aria-label + title for accessibility", () => {
    const src = readText("src/components/shells/sidebar.tsx");
    expect(src).toContain("aria-label={item.labelAr}");
    expect(src).toContain("title={item.labelAr}");
  });

  it("expanded sidebar items show icon + text", () => {
    const src = readText("src/components/shells/sidebar.tsx");
    // Expanded mode should also render icons beside text
    expect(src).toContain("<SidebarIcon");
  });

  it("icons have required icon set (dashboard, check, chart, boxes, etc.)", () => {
    const src = readText("src/components/demo/sidebar-icons.tsx");
    const requiredIcons = [
      "DashboardIcon",
      "CheckIcon",
      "ChartIcon",
      "BoxesIcon",
      "TrendingIcon",
      "DatabaseIcon",
      "UsersIcon",
      "DocumentIcon",
      "BellIcon",
      "HistoryIcon",
      "EditIcon",
      "CartIcon",
      "ReceiptIcon",
      "FactoryIcon",
      "TransferIcon",
    ];
    for (const icon of requiredIcons) {
      expect(src).toContain(`export function ${icon}`);
    }
  });
});

// ---------------------------------------------------------------------------
// No API/database mutation
// ---------------------------------------------------------------------------

describe("EGYCOT brand assets — no mutation", () => {
  it("sidebar-icons.tsx has no API/DB calls", () => {
    const src = readText("src/components/demo/sidebar-icons.tsx");
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toMatch(/supabase/i);
  });
});

// ---------------------------------------------------------------------------
// Main branch untouched
// ---------------------------------------------------------------------------

describe("EGYCOT brand assets — main untouched", () => {
  it("real nav-config.ts is NOT modified (no demo-specific icons or routes)", () => {
    const src = readText("src/components/shells/nav-config.ts");
    // Production nav-config already has icon: property — check for demo-specific additions
    // Demo uses lowercase icon names like "history", "transfer" — production uses "ArrowLeftRight" etc.
    expect(src).not.toContain("/demo/owner/user-activity");
    expect(src).not.toContain('"history"');
    expect(src).not.toContain('"transfer"');
  });
});
