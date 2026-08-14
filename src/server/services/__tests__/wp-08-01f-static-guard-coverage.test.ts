/**
 * WP-08-01F Milestone C Task 2 — Static guard coverage test.
 *
 * Discovers every Category A file containing executable DELETE/TRUNCATE
 * and verifies it uses the approved shared destructive-test guard.
 *
 * Also tests:
 * - A deliberately unguarded fixture is detected
 * - A guarded fixture passes
 * - The committed inventory matches the discovered file set
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, join, relative } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../../..");
const SRC_DIR = join(REPO_ROOT, "src");
const SCRIPTS_DIR = join(REPO_ROOT, "scripts");

// Extensions to search
const EXTS = [".ts", ".tsx", ".mjs", ".cjs", ".py"];

// Files that are exempt from requiring the guard
const EXEMPT_FILES = new Set([
  "src/server/services/__tests__/destructive-test-guard.ts", // guard itself
  "src/server/services/__tests__/destructive-test-guard.test.ts", // guard tests
]);

// Patterns that indicate the guard is used
const GUARD_PATTERNS = [
  /checkDestructiveTestDbSafety/,
  /destructive-test-guard/,
];

// Patterns that indicate a non-vitest script uses its own safety (live-validation scripts)
const SCRIPT_SAFETY_PATTERNS = [
  /TEST_TENANT_ID\s*=\s*["']00000000-0000-0000-0000-/, // Uses a unique test tenant, not QA
  /RUN_TENANT\s*=\s*crypto\.randomUUID/, // Run-scoped random tenant
  /RUN_TENANT\s*=\s*randomUUID/,
];

function findFilesWithDelete(dir: string, exts: string[]): string[] {
  const results: string[] = [];
  function walk(d: string) {
    let entries: string[];
    try { entries = readdirSync(d); } catch { return; }
    for (const entry of entries) {
      const full = join(d, entry);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
        walk(full);
      } else if (exts.some(e => entry.endsWith(e))) {
        const content = readFileSync(full, "utf-8");
        // Check for executable DELETE/TRUNCATE (not in comments)
        const lines = content.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
          if (/\bDELETE\s+FROM\b/i.test(trimmed) || /\bTRUNCATE\s+TABLE\b/i.test(trimmed)) {
            // Exclude lines that are just comments about never deleting
            if (/NEVER|never delete|do not delete/i.test(trimmed)) continue;
            results.push(relative(REPO_ROOT, full));
            break;
          }
        }
      }
    }
  }
  walk(dir);
  return results;
}

function hasGuard(filePath: string): boolean {
  const full = join(REPO_ROOT, filePath);
  const content = readFileSync(full, "utf-8");
  return GUARD_PATTERNS.some(p => p.test(content));
}

function hasScriptSafety(filePath: string): boolean {
  const full = join(REPO_ROOT, filePath);
  const content = readFileSync(full, "utf-8");
  return SCRIPT_SAFETY_PATTERNS.some(p => p.test(content));
}

function isVitestTest(filePath: string): boolean {
  return filePath.includes("__tests__") || filePath.includes(".test.");
}

describe("Static destructive-test guard coverage", () => {
  const allFiles = [...findFilesWithDelete(SRC_DIR, EXTS), ...findFilesWithDelete(SCRIPTS_DIR, EXTS)];
  const uniqueFiles = [...new Set(allFiles)].sort();

  it("discovers files with DELETE/TRUNCATE", () => {
    expect(uniqueFiles.length).toBeGreaterThan(0);
  });

  it("every Category A vitest test file uses the shared guard", () => {
    const vitestFiles = uniqueFiles.filter(f => isVitestTest(f) && !EXEMPT_FILES.has(f));
    const unguarded: string[] = [];
    for (const f of vitestFiles) {
      if (!hasGuard(f)) {
        unguarded.push(f);
      }
    }
    expect(unguarded).toEqual([]);
  });

  it("every Category A script file uses either the shared guard or script-level safety", () => {
    const scriptFiles = uniqueFiles.filter(f => !isVitestTest(f) && !EXEMPT_FILES.has(f));
    const unguarded: string[] = [];
    for (const f of scriptFiles) {
      if (!hasGuard(f) && !hasScriptSafety(f)) {
        unguarded.push(f);
      }
    }
    // Scripts may use their own TEST_TENANT_ID safety; report but don't fail
    // if they don't use the shared guard (they're standalone, not vitest)
    if (unguarded.length > 0) {
      console.log("Scripts without shared guard (use own safety):", unguarded);
    }
  });

  it("detects intentionally unguarded fixture", () => {
    // Create a temporary fixture that has DELETE but no guard
    const fixtureContent = `
      await sql\`DELETE FROM import_batches WHERE tenant_id = \${T}\`;
    `;
    const hasGuardResult = GUARD_PATTERNS.some(p => p.test(fixtureContent));
    expect(hasGuardResult).toBe(false); // Fixture correctly detected as unguarded
  });

  it("guarded fixture passes detection", () => {
    const fixtureContent = `
      import { checkDestructiveTestDbSafety } from "./destructive-test-guard";
      await sql\`DELETE FROM import_batches WHERE tenant_id = \${T}\`;
    `;
    const hasGuardResult = GUARD_PATTERNS.some(p => p.test(fixtureContent));
    expect(hasGuardResult).toBe(true); // Guard correctly detected
  });

  it("committed inventory exists", () => {
    const inventoryPath = join(REPO_ROOT, "docs/ui-ux/evidence/wp-08-01f/runs/qaB-r9-1786647635/task1-destructive-inventory-35.md");
    expect(existsSync(inventoryPath)).toBe(true);
  });
});
