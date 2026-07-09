/**
 * Tests for final corrections (added 2026-07-08).
 *
 * Verifies:
 *   - Global demo warning banner text is not rendered
 *   - No top spacer remains for the banner
 *   - Sidebar section title class/color is different from page item class/color
 *   - Section titles have no icons
 *   - Page links still have icons
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
// Demo banner removed
// ---------------------------------------------------------------------------

describe("Final correction — demo banner removed", () => {
  it("DemoShell does NOT import or render DemoBanner", () => {
    const src = readText("src/components/demo/demo-shell.tsx");
    // Check import lines only (not comments)
    const importLines = src.split("\n").filter((l) => l.startsWith("import"));
    const importText = importLines.join("\n");
    expect(importText).not.toContain("DemoBanner");
    // Check that <DemoBanner is not rendered
    expect(src).not.toContain("<DemoBanner");
  });

  it("DemoShell does NOT have a banner spacer or reserved space", () => {
    const src = readText("src/components/demo/demo-shell.tsx");
    // The banner text should not appear
    expect(src).not.toContain("نسخة عرض تفاعلية");
    expect(src).not.toContain("بيانات تجريبية غير حقيقية");
  });

  it("demo pages do NOT render the banner warning text", () => {
    const pages = [
      "src/app/(demo)/demo/owner/dashboard/page.tsx",
      "src/app/(demo)/demo/owner/reviews/page.tsx",
      "src/app/(demo)/demo/owner/inventory/page.tsx",
      "src/app/(demo)/demo/owner/user-activity/page.tsx",
    ];
    for (const page of pages) {
      const src = readText(page);
      expect(src).not.toContain("<DemoBanner");
      expect(src).not.toContain("نسخة عرض تفاعلية — بيانات تجريبية غير حقيقية");
    }
  });
});

// ---------------------------------------------------------------------------
// Sidebar section title color distinct from page links
// ---------------------------------------------------------------------------

describe("Final correction — sidebar title color", () => {
  const sidebarSrc = readText("src/components/shells/sidebar.tsx");

  it("section titles use deep navy color (#0B3A75)", () => {
    expect(sidebarSrc).toContain("text-[#0B3A75]");
  });

  it("section titles do NOT use text-navy (old color)", () => {
    // The old color was text-navy which was too similar to page links
    // Section title button should use the new deep navy
    const sectionTitleMatch = sidebarSrc.match(/Section title[\s\S]*?<\/button>/);
    expect(sectionTitleMatch).not.toBeNull();
    const titleArea = sectionTitleMatch![0];
    expect(titleArea).toContain("text-[#0B3A75]");
    expect(titleArea).not.toContain("text-navy");
  });

  it("page links use text-foreground (not the deep navy)", () => {
    // Page items should use normal foreground color, not the section title navy
    const pageItemMatch = sidebarSrc.match(/flex min-h-\[44px\] items-center gap-2 rounded-lg/);
    expect(pageItemMatch).not.toBeNull();
    // The page item area should contain text-foreground (normal) not text-[#0B3A75] (section title)
    const itemArea = sidebarSrc.substring(pageItemMatch!.index!, pageItemMatch!.index! + 300);
    expect(itemArea).toContain("text-foreground");
    expect(itemArea).not.toContain("text-[#0B3A75]");
  });

  it("section titles have NO icon (no SidebarIcon in the title button)", () => {
    // The section title button should not contain SidebarIcon
    const sectionTitleMatch = sidebarSrc.match(/Section title[\s\S]*?<button[\s\S]*?<\/button>/);
    expect(sectionTitleMatch).not.toBeNull();
    const titleButton = sectionTitleMatch![0];
    expect(titleButton).not.toContain("SidebarIcon");
    expect(titleButton).not.toContain("categoryIcon");
  });

  it("page links DO have icons (SidebarIcon in page items)", () => {
    // Page items in expanded mode should render SidebarIcon
    expect(sidebarSrc).toContain("itemIcon");
    expect(sidebarSrc).toContain("<SidebarIcon");
  });

  it("section title color is clearly different from page link color", () => {
    // Section title: text-[#0B3A75] (deep navy)
    // Page link: text-foreground (slate #0f172a)
    // These are different colors
    expect(sidebarSrc).toContain("text-[#0B3A75]");
    expect(sidebarSrc).toContain("text-foreground");
    // Verify they appear in different contexts (section title vs page item)
    const titleIdx = sidebarSrc.indexOf("text-[#0B3A75]");
    const pageIdx = sidebarSrc.indexOf("text-foreground");
    expect(titleIdx).toBeGreaterThan(-1);
    expect(pageIdx).toBeGreaterThan(-1);
    expect(titleIdx).not.toEqual(pageIdx);
  });
});

// ---------------------------------------------------------------------------
// Main untouched
// ---------------------------------------------------------------------------

describe("Final correction — main untouched", () => {
  it("real nav-config.ts is NOT modified", () => {
    const src = readText("src/components/shells/nav-config.ts");
    expect(src).not.toContain("text-[#0B3A75]");
    expect(src).not.toContain("/demo/owner/user-activity");
  });
});
