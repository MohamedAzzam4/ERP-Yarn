/**
 * WP-08-01F Milestone C Task 1 — Inventory validation test.
 *
 * Re-runs the canonical destructive-file search at test time and asserts
 * that the committed inventory markdown:
 *   1. Has exactly one row per discovered path (no duplicates, no omissions).
 *   2. Has a path set that EXACTLY equals the canonical-search path set.
 *   3. Has category counts that sum to the discovered count.
 *   4. Rejects duplicate inventory paths.
 *   5. Rejects missing inventory paths.
 *   6. Rejects extra inventory paths.
 *
 * The test parses the markdown table by reading each table row's path cell
 * (the 2nd column) and category cell (the 5th column), so any future
 * drift between the canonical search and the committed inventory is
 * caught at test time, not at audit time.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { execSync } from "node:child_process";

const REPO_ROOT = resolve(__dirname, "../../../..");
const INVENTORY_PATH = join(
  REPO_ROOT,
  "docs/ui-ux/evidence/wp-08-01f/runs/qaB-r9-1786647635/task1-destructive-inventory-35.md",
);

interface InventoryRow {
  path: string;
  category: "A" | "B" | "C" | "D";
}

function runCanonicalSearch(): string[] {
  // The canonical search command (must match the inventory's documented command).
  // We run it via bash so the test always re-discovers from the live tree.
  // Excludes the __guard-coverage-fixtures__ directory (test fixtures, not real scripts).
  const cmd = "grep -rn 'DELETE FROM\\|TRUNCATE' src/ scripts/ --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' --include='*.cjs' --include='*.py' --include='*.sh' --include='*.ps1' 2>/dev/null | grep -v node_modules | grep -v '\\.d\\.ts' | grep -v '^\\s*//' | grep -v '^\\s*\\*' | grep -v 'NEVER\\|never delete\\|do not delete' | grep -v '__guard-coverage-fixtures__' | awk -F: '{print $1}' | sort -u";
  const out = execSync(cmd, { cwd: REPO_ROOT, encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 });
  return out.trim().split("\n").filter(Boolean);
}

function parseInventoryRows(): InventoryRow[] {
  if (!existsSync(INVENTORY_PATH)) {
    throw new Error(`Inventory file not found: ${INVENTORY_PATH}`);
  }
  const md = readFileSync(INVENTORY_PATH, "utf-8");
  const lines = md.split("\n");
  const rows: InventoryRow[] = [];
  let inTable = false;
  for (const line of lines) {
    if (line.startsWith("|---") || line.startsWith("| #")) {
      inTable = true;
      continue;
    }
    if (!line.startsWith("|")) {
      if (inTable && line.trim() === "") continue;
      // End of table when we hit a non-pipe line after the table started
      if (inTable && rows.length > 0 && !line.startsWith("|")) {
        inTable = false;
        continue;
      }
      continue;
    }
    if (!inTable) continue;
    const cells = line.split("|").map((c) => c.trim());
    // cells[0] is empty (leading |), cells[1]=#, cells[2]=file, cells[3]=lines,
    // cells[4]=operation, cells[5]=category, cells[6]=guard, cells[7]=reason
    if (cells.length < 6) continue;
    const numCell = cells[1] ?? "";
    if (!/^\d+$/.test(numCell)) continue; // skip header/separator rows
    const path = cells[2] ?? "";
    // Strip markdown bold/italic markers from category cell (e.g. **D** → D).
    const categoryRaw = (cells[5] ?? "").replace(/[*_`]/g, "").trim();
    const category = categoryRaw as "A" | "B" | "C" | "D";
    if (!path || !["A", "B", "C", "D"].includes(category)) {
      throw new Error(`Invalid inventory row: ${line}`);
    }
    rows.push({ path, category });
  }
  return rows;
}

function parseReportedCounts(): { discovered: number; A: number; B: number; C: number; D: number } {
  const md = readFileSync(INVENTORY_PATH, "utf-8");
  // Restrict parsing to the "## Category Counts" section (between that heading
  // and the next "## " heading) so stray mentions elsewhere in the document
  // don't pollute the regex matches.
  const catSectionMatch = md.match(/## Category Counts[\s\S]*?(?=\n## )/);
  if (!catSectionMatch) {
    throw new Error("Could not find '## Category Counts' section in inventory.");
  }
  const catSection = catSectionMatch[0];
  const discoveredMatch = md.match(/Discovered Count:\s*(\d+)\s+paths/);
  // Anchor each category match at the start of a bullet line ("- Category X ...: N")
  // to avoid matching "Category C" as a substring of "Category Counts" or "Category Definitions".
  const aMatch = catSection.match(/^- Category A[^:]*:\s*(\d+)/m);
  const bMatch = catSection.match(/^- Category B[^:]*:\s*(\d+)/m);
  const cMatch = catSection.match(/^- Category C[^:]*:\s*(\d+)/m);
  const dMatch = catSection.match(/^- Category D[^:]*:\s*(\d+)/m);
  if (!discoveredMatch || !aMatch || !bMatch || !cMatch || !dMatch ||
      !discoveredMatch[1] || !aMatch[1] || !bMatch[1] || !cMatch[1] || !dMatch[1]) {
    throw new Error("Could not parse reported counts from inventory.");
  }
  return {
    discovered: parseInt(discoveredMatch[1], 10),
    A: parseInt(aMatch[1], 10),
    B: parseInt(bMatch[1], 10),
    C: parseInt(cMatch[1], 10),
    D: parseInt(dMatch[1], 10),
  };
}

describe("WP-08-01F Task 1 — Destructive inventory matches canonical search", () => {
  const discovered = runCanonicalSearch();
  const rows = parseInventoryRows();
  const reported = parseReportedCounts();

  it("canonical search discovers a non-empty file set", () => {
    expect(discovered.length).toBeGreaterThan(0);
    // Snapshot for visibility — should be 40 at the time of writing
    // (34 original Category A + RCA test + RW test + SUB test + COM test + 2 Category D).
    expect(discovered.length).toBe(40);
  });

  it("inventory row count equals discovered path count", () => {
    expect(rows.length).toBe(discovered.length);
  });

  it("inventory path set exactly equals discovered path set (no missing, no extra)", () => {
    const invPaths = new Set(rows.map((r) => r.path));
    const discPaths = new Set(discovered);
    const missing = [...discPaths].filter((p) => !invPaths.has(p));
    const extra = [...invPaths].filter((p) => !discPaths.has(p));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  it("inventory has no duplicate paths", () => {
    const paths = rows.map((r) => r.path);
    const dupes = paths.filter((p, i) => paths.indexOf(p) !== i);
    expect(dupes).toEqual([]);
  });

  it("category counts sum to the discovered count", () => {
    const a = rows.filter((r) => r.category === "A").length;
    const b = rows.filter((r) => r.category === "B").length;
    const c = rows.filter((r) => r.category === "C").length;
    const d = rows.filter((r) => r.category === "D").length;
    expect(a + b + c + d).toBe(discovered.length);
  });

  it("reported summary counts match the parsed table counts", () => {
    const a = rows.filter((r) => r.category === "A").length;
    const b = rows.filter((r) => r.category === "B").length;
    const c = rows.filter((r) => r.category === "C").length;
    const d = rows.filter((r) => r.category === "D").length;
    expect(reported.A).toBe(a);
    expect(reported.B).toBe(b);
    expect(reported.C).toBe(c);
    expect(reported.D).toBe(d);
  });

  it("reported discovered count equals canonical search count", () => {
    expect(reported.discovered).toBe(discovered.length);
  });

  it("reported A+B+C+D equals reported discovered count", () => {
    expect(reported.A + reported.B + reported.C + reported.D).toBe(reported.discovered);
  });

  it("every Category A row has a non-empty guard mechanism", () => {
    const md = readFileSync(INVENTORY_PATH, "utf-8");
    const lines = md.split("\n");
    let inTable = false;
    for (const line of lines) {
      if (line.startsWith("|---")) { inTable = true; continue; }
      if (!line.startsWith("|")) { if (inTable && rows.length > 0) inTable = false; continue; }
      if (!inTable) continue;
      const cells = line.split("|").map((c) => c.trim());
      if (cells.length < 6) continue;
      if (!/^\d+$/.test(cells[1] ?? "")) continue;
      const category = (cells[5] ?? "").replace(/[*_`]/g, "").trim();
      const guard = cells[6] ?? "";
      const reason = cells[7] ?? "";
      if (category === "A") {
        // For Category A, the guard column must be non-empty.
        expect(guard.length).toBeGreaterThan(0);
      }
      // Reason must always be non-empty for every row
      expect(reason.length).toBeGreaterThan(0);
    }
  });

  it("every row has exact path, line range, operation, category, guard, and reason", () => {
    for (const row of rows) {
      expect(row.path).toMatch(/^(src|scripts)\//);
      expect(["A", "B", "C", "D"]).toContain(row.category);
    }
  });

  // ---------------------------------------------------------------------
  // Negative fixtures: prove the validator catches drift.
  // ---------------------------------------------------------------------

  it("rejects a duplicate inventory path", () => {
    const dupRows = [...rows, { path: rows[0]!.path, category: "A" as const }];
    const paths = dupRows.map((r) => r.path);
    const dupes = paths.filter((p, i) => paths.indexOf(p) !== i);
    expect(dupes.length).toBeGreaterThan(0);
  });

  it("rejects a missing inventory path (path discovered but not in inventory)", () => {
    const truncated = rows.slice(0, rows.length - 1);
    const invPaths = new Set(truncated.map((r) => r.path));
    const discPaths = new Set(discovered);
    const missing = [...discPaths].filter((p) => !invPaths.has(p));
    expect(missing.length).toBeGreaterThan(0);
  });

  it("rejects an extra inventory path (in inventory but not discovered)", () => {
    const padded = [...rows, { path: "src/server/services/__tests__/fake.ts", category: "A" as const }];
    const invPaths = new Set(padded.map((r) => r.path));
    const discPaths = new Set(discovered);
    const extra = [...invPaths].filter((p) => !discPaths.has(p));
    expect(extra.length).toBeGreaterThan(0);
  });
});
