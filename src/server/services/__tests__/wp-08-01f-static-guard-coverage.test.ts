/**
 * WP-08-01F Milestone C Task 2 — Static destructive-test guard coverage test
 * (v2 — multi-language, with ordering enforcement).
 *
 * Discovers every Category A file (regardless of extension) that contains
 * an executable `DELETE FROM` or `TRUNCATE TABLE` statement, and verifies
 * that the approved centralized guard runs BEFORE any destructive statement.
 *
 * Coverage matrix:
 *   - .ts / .tsx  → must import + INVOKE `assertDestructiveTestDbSafety`
 *                   (or `checkDestructiveTestDbSafety`) at a line number
 *                   strictly less than the first DELETE/TRUNCATE line.
 *   - .js / .mjs / .cjs → must invoke the centralized guard CLI
 *                   (`node scripts/wp-08-01f-destruction-guard.mjs`) at a
 *                   line number strictly less than the first DELETE line,
 *                   OR import + invoke `assertDestructiveTestDbSafety`.
 *   - .py         → must invoke the centralized guard CLI via subprocess
 *                   at a line strictly less than the first DELETE line.
 *   - .sh / .ps1  → must invoke the centralized guard CLI directly at a
 *                   line strictly less than the first DELETE line.
 *
 * Rejection rules:
 *   1. Standalone `isLocal`, `localhost`, `TEST_TENANT_ID`, or custom
 *      safety check is NOT accepted as a substitute for the guard.
 *   2. Importing the guard without invoking it is NOT accepted.
 *   3. Invoking the guard AFTER the first DELETE/TRUNCATE is NOT accepted.
 *   4. The validator fails with the exact file path and line number when
 *      guard ordering is wrong.
 *
 * Fixtures (in __guard-coverage-fixtures__/):
 *   1. unguarded-vitest.test.ts        — must be REJECTED
 *   2. unguarded-live-validation.mjs   — must be REJECTED
 *   3. unguarded-python.py             — must be REJECTED
 *   4. unguarded-shell.sh              — must be REJECTED
 *   5. guard-imported-not-called.test.ts — must be REJECTED
 *   6. guard-called-after-delete.test.ts — must be REJECTED
 *   7. correctly-guarded-vitest.test.ts        — must be ACCEPTED
 *   8. correctly-guarded-live-validation.mjs   — must be ACCEPTED
 *   9. correctly-guarded-python.py             — must be ACCEPTED
 *  10. correctly-guarded-shell.sh              — must be ACCEPTED
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, join, relative } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../../..");
const SRC_DIR = join(REPO_ROOT, "src");
const SCRIPTS_DIR = join(REPO_ROOT, "scripts");
const FIXTURES_DIR = join(REPO_ROOT, "src/server/services/__tests__/__guard-coverage-fixtures__");

// Extensions searched by the canonical inventory command.
const EXTS = [".ts", ".tsx", ".js", ".mjs", ".cjs", ".py", ".sh", ".ps1"];

// Files that are EXEMPT from requiring the guard:
// - the guard module itself
// - the guard's own unit tests
// - the static-guard-coverage test (this file's companions)
// - the inventory validation test (does not connect to DB)
// - the centralized guard CLI (it IS the guard)
// - the fixtures used by this test (they are test DATA, not real scripts)
const EXEMPT_FILES = new Set([
  "src/server/services/__tests__/destructive-test-guard.ts",
  "src/server/services/__tests__/destructive-test-guard.test.ts",
  "src/server/services/__tests__/wp-08-01f-static-guard-coverage.test.ts",
  "src/server/services/__tests__/wp-08-01f-task1-inventory-validation.test.ts",
  "scripts/wp-08-01f-destruction-guard.mjs",
]);

// Directories whose contents are test fixtures and must NOT be checked
// as if they were real production scripts. The fixtures live here so the
// validator can load them by name and prove detection works.
const EXEMPT_DIRS = [
  "src/server/services/__tests__/__guard-coverage-fixtures__",
];

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

interface DiscoveredFile {
  path: string;        // repo-relative path
  ext: string;         // extension including dot
  lines: string[];     // file content split by \n
  firstDeleteLine: number; // 1-indexed line of first executable DELETE/TRUNCATE
}

function findExecutableDeleteLine(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    const trimmed = (lines[i] ?? "").trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
    if (trimmed.startsWith("#") && !trimmed.startsWith("#!")) continue; // shell/python comment
    if (/\bDELETE\s+FROM\b/i.test(trimmed) || /\bTRUNCATE\s+TABLE\b/i.test(trimmed)) {
      if (/NEVER|never delete|do not delete/i.test(trimmed)) continue;
      // Skip lines inside template literals (test fixtures). A line is considered
      // a fixture string if it starts with whitespace followed by a backtick or
      // is wrapped in backticks on the same line.
      // Heuristic: if the line contains a backtick AND does not contain a
      // sql-tagged template or `await sql\``, treat it as a fixture string.
      if (trimmed.startsWith("`") || trimmed.startsWith("await sql`") || trimmed.startsWith("sql`")) {
        // This is a real SQL template literal — count as executable.
        return i + 1;
      }
      // If the line is inside a multi-line template literal (no leading
      // backtick but contains DELETE FROM), we still count it as executable
      // — the canonical grep would also pick it up. The fixture files use
      // leading backticks so they're handled above.
      return i + 1;
    }
  }
  return -1;
}

function discoverFilesWithDelete(dir: string): DiscoveredFile[] {
  const results: DiscoveredFile[] = [];
  function walk(d: string) {
    let entries: string[];
    try { entries = readdirSync(d); } catch { return; }
    for (const entry of entries) {
      const full = join(d, entry);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
        // Skip exempt fixture directories — their contents are test DATA
        // for THIS test, not real scripts that need the guard.
        const relDir = relative(REPO_ROOT, full);
        if (EXEMPT_DIRS.some((ed) => relDir === ed || relDir.startsWith(ed + "/"))) continue;
        walk(full);
      } else if (EXTS.some(e => entry.endsWith(e))) {
        const content = readFileSync(full, "utf-8");
        const lines = content.split("\n");
        const firstDeleteLine = findExecutableDeleteLine(lines);
        if (firstDeleteLine > 0) {
          const rel = relative(REPO_ROOT, full);
          const ext = entry.substring(entry.lastIndexOf("."));
          results.push({ path: rel, ext, lines, firstDeleteLine });
        }
      }
    }
  }
  walk(dir);
  return results;
}

// ---------------------------------------------------------------------------
// Guard detection
// ---------------------------------------------------------------------------

interface GuardCheckResult {
  ok: boolean;
  reason: string;
  guardLine: number;   // 1-indexed line of guard invocation, or -1
  deleteLine: number;  // 1-indexed line of first DELETE, or -1
}

// Patterns that indicate the TypeScript shared guard is INVOKED (not just imported).
const TS_GUARD_INVOKE_PATTERN = /\b(assertDestructiveTestDbSafety|checkDestructiveTestDbSafety)\s*\(/;
const TS_GUARD_IMPORT_PATTERN = /\bimport\s+\{[^}]*\b(assertDestructiveTestDbSafety|checkDestructiveTestDbSafety)\b[^}]*\}\s+from\s+["'][^"']*destructive-test-guard["']/;

// Patterns that indicate the centralized guard CLI is invoked.
// Accept any of: node scripts/wp-08-01f-destruction-guard.mjs,
// "wp-08-01f-destruction-guard.mjs", or "wp-08-01f-destruction-guard".
const CLI_GUARD_PATTERN = /(node\s+scripts\/wp-08-01f-destruction-guard\.mjs|wp-08-01f-destruction-guard\.mjs|wp-08-01f-destruction-guard)/;

// Rejected patterns — these do NOT qualify as a guard.
const REJECTED_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "isLocal", re: /\bisLocal\b/ },
  { name: "localhost-only check", re: /\bhostname\s*===?\s*['"]localhost['"]/ },
  { name: "TEST_TENANT_ID constant", re: /\bTEST_TENANT_ID\s*=/ },
];

function findFirstLineMatching(lines: string[], re: RegExp): number {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (re.test(line)) return i + 1;
  }
  return -1;
}

function checkTsFile(file: DiscoveredFile): GuardCheckResult {
  const content = file.lines.join("\n");
  const invokeLine = findFirstLineMatching(file.lines, TS_GUARD_INVOKE_PATTERN);
  const cliLine = findFirstLineMatching(file.lines, CLI_GUARD_PATTERN);
  const guardLine = invokeLine > 0 ? invokeLine : cliLine;

  if (guardLine < 0) {
    // Check if it's imported but not invoked.
    if (TS_GUARD_IMPORT_PATTERN.test(content)) {
      return {
        ok: false,
        reason: `guard imported but never invoked (call assertDestructiveTestDbSafety or checkDestructiveTestDbSafety before line ${file.firstDeleteLine})`,
        guardLine: -1,
        deleteLine: file.firstDeleteLine,
      };
    }
    // Check if it relies on a rejected pattern.
    for (const { name, re } of REJECTED_PATTERNS) {
      if (re.test(content)) {
        return {
          ok: false,
          reason: `relies on rejected '${name}' pattern instead of centralized guard`,
          guardLine: -1,
          deleteLine: file.firstDeleteLine,
        };
      }
    }
    return {
      ok: false,
      reason: `no centralized guard invocation found before DELETE/TRUNCATE on line ${file.firstDeleteLine}`,
      guardLine: -1,
      deleteLine: file.firstDeleteLine,
    };
  }

  // Guard invocation exists — verify it runs BEFORE the first DELETE.
  if (guardLine >= file.firstDeleteLine) {
    return {
      ok: false,
      reason: `guard invoked on line ${guardLine} but first DELETE/TRUNCATE is on line ${file.firstDeleteLine} (guard must run BEFORE any destructive statement)`,
      guardLine,
      deleteLine: file.firstDeleteLine,
    };
  }

  return { ok: true, reason: "ok", guardLine, deleteLine: file.firstDeleteLine };
}

function checkPythonFile(file: DiscoveredFile): GuardCheckResult {
  const cliLine = findFirstLineMatching(file.lines, CLI_GUARD_PATTERN);
  if (cliLine < 0) {
    return {
      ok: false,
      reason: `no centralized guard CLI invocation (subprocess.run(['node', 'scripts/wp-08-01f-destruction-guard.mjs'], ...)) found before DELETE/TRUNCATE on line ${file.firstDeleteLine}`,
      guardLine: -1,
      deleteLine: file.firstDeleteLine,
    };
  }
  if (cliLine >= file.firstDeleteLine) {
    return {
      ok: false,
      reason: `guard CLI invoked on line ${cliLine} but first DELETE/TRUNCATE is on line ${file.firstDeleteLine} (guard must run BEFORE any destructive statement)`,
      guardLine: cliLine,
      deleteLine: file.firstDeleteLine,
    };
  }
  return { ok: true, reason: "ok", guardLine: cliLine, deleteLine: file.firstDeleteLine };
}

function checkShellFile(file: DiscoveredFile): GuardCheckResult {
  const cliLine = findFirstLineMatching(file.lines, CLI_GUARD_PATTERN);
  if (cliLine < 0) {
    return {
      ok: false,
      reason: `no centralized guard CLI invocation (node scripts/wp-08-01f-destruction-guard.mjs) found before DELETE/TRUNCATE on line ${file.firstDeleteLine}`,
      guardLine: -1,
      deleteLine: file.firstDeleteLine,
    };
  }
  if (cliLine >= file.firstDeleteLine) {
    return {
      ok: false,
      reason: `guard CLI invoked on line ${cliLine} but first DELETE/TRUNCATE is on line ${file.firstDeleteLine} (guard must run BEFORE any destructive statement)`,
      guardLine: cliLine,
      deleteLine: file.firstDeleteLine,
    };
  }
  return { ok: true, reason: "ok", guardLine: cliLine, deleteLine: file.firstDeleteLine };
}

function checkFile(file: DiscoveredFile): GuardCheckResult {
  switch (file.ext) {
    case ".ts":
    case ".tsx":
    case ".js":
    case ".mjs":
    case ".cjs":
      return checkTsFile(file);
    case ".py":
      return checkPythonFile(file);
    case ".sh":
    case ".ps1":
      return checkShellFile(file);
    default:
      return { ok: false, reason: `unsupported extension ${file.ext}`, guardLine: -1, deleteLine: file.firstDeleteLine };
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WP-08-01F Task 2 — Static guard coverage (multi-language, ordered)", () => {
  const allFiles = [
    ...discoverFilesWithDelete(SRC_DIR),
    ...discoverFilesWithDelete(SCRIPTS_DIR),
  ];
  // Deduplicate by path (a file under both trees would otherwise be doubled).
  const seen = new Set<string>();
  const uniqueFiles = allFiles.filter((f) => {
    if (seen.has(f.path)) return false;
    seen.add(f.path);
    return true;
  }).sort((a, b) => a.path.localeCompare(b.path));

  // Category A files = all discovered files EXCEPT the explicitly-exempt set
  // AND except files where the DELETE is only in comments/fixtures (Category D).
  // For the static guard coverage test, we treat EVERY discovered file as
  // requiring a guard unless it's in EXEMPT_FILES. The inventory test
  // separately classifies Category D; here we just enforce the guard rule
  // universally — Category D files (guard module + this test) are in EXEMPT.
  const filesToCheck = uniqueFiles.filter((f) => !EXEMPT_FILES.has(f.path));

  it("discovers a non-empty file set with DELETE/TRUNCATE", () => {
    expect(uniqueFiles.length).toBeGreaterThan(0);
  });

  it("every discovered Category A file invokes the centralized guard BEFORE the first DELETE", () => {
    const failures: string[] = [];
    for (const f of filesToCheck) {
      const result = checkFile(f);
      if (!result.ok) {
        failures.push(`  ${f.path} (line ${result.deleteLine}): ${result.reason}`);
      }
    }
    if (failures.length > 0) {
      throw new Error(
        `\nStatic guard coverage violations (${failures.length}):\n` +
        failures.join("\n") +
        "\n\nEvery Category A file MUST invoke the centralized guard " +
        "(assertDestructiveTestDbSafety / checkDestructiveTestDbSafety in TS, " +
        "or `node scripts/wp-08-01f-destruction-guard.mjs` in non-TS scripts) " +
        "BEFORE any DELETE/TRUNCATE statement.",
      );
    }
  });

  it("does NOT accept a standalone TEST_TENANT_ID constant as a substitute for the guard", () => {
    // Find any discovered file that uses TEST_TENANT_ID = ... but does NOT
    // invoke the centralized guard. Such files must be flagged.
    const standalone = filesToCheck.filter((f) => {
      const content = f.lines.join("\n");
      const hasConstant = /\bTEST_TENANT_ID\s*=/.test(content);
      const hasGuard = TS_GUARD_INVOKE_PATTERN.test(content) || CLI_GUARD_PATTERN.test(content);
      return hasConstant && !hasGuard;
    });
    // For each standalone-TEST_TENANT_ID file, checkFile must have failed.
    const notFlagged = standalone.filter((f) => checkFile(f).ok);
    expect(notFlagged).toEqual([]);
  });

  it("does NOT accept importing the guard without invoking it", () => {
    // Find any discovered file that imports the guard symbol but doesn't invoke it.
    const imported = filesToCheck.filter((f) => {
      const content = f.lines.join("\n");
      return TS_GUARD_IMPORT_PATTERN.test(content) && !TS_GUARD_INVOKE_PATTERN.test(content);
    });
    const notFlagged = imported.filter((f) => checkFile(f).ok);
    expect(notFlagged).toEqual([]);
  });

  // ---------------------------------------------------------------------
  // Fixture-based proofs: prove the validator detects each violation.
  // ---------------------------------------------------------------------

  function loadFixture(name: string): DiscoveredFile {
    const full = join(FIXTURES_DIR, name);
    const content = readFileSync(full, "utf-8");
    const lines = content.split("\n");
    const firstDeleteLine = findExecutableDeleteLine(lines);
    if (firstDeleteLine < 0) {
      throw new Error(`Fixture ${name} has no DELETE/TRUNCATE — fix the fixture.`);
    }
    const ext = name.substring(name.lastIndexOf("."));
    return { path: `__guard-coverage-fixtures__/${name}`, ext, lines, firstDeleteLine };
  }

  it("fixture: unguarded vitest file is REJECTED", () => {
    const f = loadFixture("unguarded-vitest.test.ts");
    const r = checkFile(f);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no centralized guard invocation found/);
  });

  it("fixture: unguarded live-validation script is REJECTED", () => {
    const f = loadFixture("unguarded-live-validation.mjs");
    const r = checkFile(f);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/TEST_TENANT_ID|no centralized guard/);
  });

  it("fixture: unguarded Python script is REJECTED", () => {
    const f = loadFixture("unguarded-python.py");
    const r = checkFile(f);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no centralized guard CLI invocation/);
  });

  it("fixture: unguarded shell script is REJECTED", () => {
    const f = loadFixture("unguarded-shell.sh");
    const r = checkFile(f);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no centralized guard CLI invocation/);
  });

  it("fixture: guard imported but not called is REJECTED", () => {
    const f = loadFixture("guard-imported-not-called.test.ts");
    const r = checkFile(f);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/imported but never invoked/);
  });

  it("fixture: guard called AFTER DELETE is REJECTED", () => {
    const f = loadFixture("guard-called-after-delete.test.ts");
    const r = checkFile(f);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/guard must run BEFORE any destructive statement/);
  });

  it("fixture: correctly guarded vitest file is ACCEPTED", () => {
    const f = loadFixture("correctly-guarded-vitest.test.ts");
    const r = checkFile(f);
    expect(r.ok).toBe(true);
  });

  it("fixture: correctly guarded live-validation script is ACCEPTED", () => {
    const f = loadFixture("correctly-guarded-live-validation.mjs");
    const r = checkFile(f);
    expect(r.ok).toBe(true);
  });

  it("fixture: correctly guarded Python script is ACCEPTED", () => {
    const f = loadFixture("correctly-guarded-python.py");
    const r = checkFile(f);
    expect(r.ok).toBe(true);
  });

  it("fixture: correctly guarded shell script is ACCEPTED", () => {
    const f = loadFixture("correctly-guarded-shell.sh");
    const r = checkFile(f);
    expect(r.ok).toBe(true);
  });

  // ---------------------------------------------------------------------
  // Inventory file existence
  // ---------------------------------------------------------------------

  it("committed inventory exists", () => {
    const inventoryPath = join(
      REPO_ROOT,
      "docs/ui-ux/evidence/wp-08-01f/runs/qaB-r9-1786647635/task1-destructive-inventory-35.md",
    );
    expect(existsSync(inventoryPath)).toBe(true);
  });

  it("centralized guard CLI exists at the canonical path", () => {
    const cliPath = join(REPO_ROOT, "scripts", "wp-08-01f-destruction-guard.mjs");
    expect(existsSync(cliPath)).toBe(true);
  });
});
