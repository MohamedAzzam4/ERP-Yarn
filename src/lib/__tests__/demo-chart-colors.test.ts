/**
 * Tests for chart color uniqueness (added 2026-07-06).
 *
 * Verifies that no two visible categories in the same chart share the same
 * color. This was a stakeholder-reported issue where inventory categories
 * "خيوط" (var(--color-success)) and "لدى مصانع التشغيل" (var(--color-accent))
 * both rendered as #2a9d8f (teal) because those two semantic tokens have the
 * same hex value.
 *
 * The fix: use chart-N tokens (which are guaranteed unique) instead of
 * semantic tokens (which have collisions: primary===info, accent===success).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEMO_DASHBOARD_INVENTORY_COMPOSITION,
  DEMO_CHART_COLORS,
} from "@/lib/fixtures/demo-fixtures";

const root = process.cwd();

function readText(rel: string): string {
  return readFileSync(join(root, rel), "utf-8");
}

// ---------------------------------------------------------------------------
// Chart color palette uniqueness
// ---------------------------------------------------------------------------

describe("Demo chart colors — palette uniqueness", () => {
  it("DEMO_CHART_COLORS has 7 distinct CSS variable values", () => {
    const values = Object.values(DEMO_CHART_COLORS);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it("DEMO_CHART_COLORS does not use semantic tokens (which have collisions)", () => {
    const values = Object.values(DEMO_CHART_COLORS);
    for (const v of values) {
      expect(v).toMatch(/var\(--color-chart-\d+\)/);
      expect(v).not.toContain("var(--color-primary)");
      expect(v).not.toContain("var(--color-accent)");
      expect(v).not.toContain("var(--color-success)");
      expect(v).not.toContain("var(--color-info)");
      expect(v).not.toContain("var(--color-warning)");
      expect(v).not.toContain("var(--color-danger)");
    }
  });
});

// ---------------------------------------------------------------------------
// Inventory composition — no duplicate colors
// ---------------------------------------------------------------------------

describe("Demo chart colors — inventory composition", () => {
  it("no two categories share the same color", () => {
    const colors = DEMO_DASHBOARD_INVENTORY_COMPOSITION.map((c) => c.color);
    const unique = new Set(colors);
    expect(unique.size).toBe(colors.length);
  });

  it("uses chart-N tokens (not semantic tokens)", () => {
    for (const item of DEMO_DASHBOARD_INVENTORY_COMPOSITION) {
      expect(item.color).toMatch(/var\(--color-chart-\d+\)/);
    }
  });
});

// ---------------------------------------------------------------------------
// BAR_COLORS in demo-charts.tsx — no duplicate colors
// ---------------------------------------------------------------------------

describe("Demo chart colors — BAR_COLORS uniqueness", () => {
  it("BAR_COLORS array has all distinct values", () => {
    const src = readText("src/components/demo/demo-charts.tsx");
    // Extract the BAR_COLORS array
    const match = src.match(/const BAR_COLORS\s*=\s*\[([\s\S]*?)\]/);
    expect(match).not.toBeNull();
    const arrayContent = match![1]!;
    // Extract all bg-* class names
    const classes = arrayContent.match(/bg-chart-\d+/g);
    expect(classes).not.toBeNull();
    expect(classes!.length).toBeGreaterThanOrEqual(5);
    const unique = new Set(classes);
    expect(unique.size).toBe(classes!.length);
  });

  it("BAR_COLORS does not use semantic tokens that collide", () => {
    const src = readText("src/components/demo/demo-charts.tsx");
    const match = src.match(/const BAR_COLORS\s*=\s*\[([\s\S]*?)\]/);
    expect(match).not.toBeNull();
    const arrayContent = match![1]!;
    // Should NOT contain bg-primary, bg-info (both #2457c5)
    // Should NOT contain bg-accent, bg-success (both #2a9d8f)
    expect(arrayContent).not.toContain("bg-primary");
    expect(arrayContent).not.toContain("bg-info");
    expect(arrayContent).not.toContain("bg-accent");
    expect(arrayContent).not.toContain("bg-success");
  });
});

// ---------------------------------------------------------------------------
// globals.css — chart-N tokens are all distinct hex values
// ---------------------------------------------------------------------------

describe("Demo chart colors — CSS token uniqueness", () => {
  it("chart-1 through chart-7 all have distinct hex values", () => {
    const css = readText("src/app/globals.css");
    const tokens: Record<string, string> = {};
    for (let i = 1; i <= 7; i++) {
      const re = new RegExp(`--color-chart-${i}:\\s*(#[0-9a-fA-F]{6})`);
      const m = css.match(re);
      expect(m).not.toBeNull();
      tokens[`chart-${i}`] = m![1]!.toLowerCase();
    }
    const values = Object.values(tokens);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it("chart-6 (violet) and chart-7 (cyan) tokens exist", () => {
    const css = readText("src/app/globals.css");
    expect(css).toMatch(/--color-chart-6:\s*#7c3aed/);
    expect(css).toMatch(/--color-chart-7:\s*#0891b2/);
  });
});
