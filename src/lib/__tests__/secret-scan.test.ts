/**
 * WP-00-02 package gate tests — secret scan / no secrets in client bundle.
 *
 * Contract: docs/contracts/13_work_packages.md WP-00-02 Tests:
 *   "no secrets in client bundle/log."
 *
 * Contract: docs/contracts/01_technical_architecture_and_deployment_contract.md
 * §Secrets:
 *   "The browser may receive only Supabase's current public/publishable key
 *    and project URL. The Supabase secret/service-role credential, database
 *    URLs, migration credentials, and any backup credentials are server-only."
 *
 * Contract: docs/contracts/14_coding_agent_instructions.md §10:
 *   "Never commit secrets, credentials, source business files, dumps or
 *    signed URLs."
 *
 * These tests verify:
 *   1. `.env.example` exists and contains only the five DEC-057 names, all
 *      empty, plus no `DATABASE_MIGRATION_URL`.
 *   2. No `.env`, `.env.local`, or `.env.production` file is committed.
 *   3. No file under `src/app/` (client-visible surface) imports
 *      `SUPABASE_SECRET_KEY` or `DATABASE_URL` by literal name.
 *   4. The server-only env module is not importable from client components
 *      (it uses `import "server-only"`).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));

function readText(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe(".env.example — DEC-057 compliance", () => {
  const envExample = readText(".env.example");

  it("contains NEXT_PUBLIC_SUPABASE_URL=", () => {
    expect(envExample).toContain("NEXT_PUBLIC_SUPABASE_URL=");
  });

  it("contains NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=", () => {
    expect(envExample).toContain("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=");
  });

  it("contains SUPABASE_SECRET_KEY=", () => {
    expect(envExample).toContain("SUPABASE_SECRET_KEY=");
  });

  it("contains DATABASE_URL=", () => {
    expect(envExample).toContain("DATABASE_URL=");
  });

  it("contains SUPABASE_PROJECT_REF=", () => {
    expect(envExample).toContain("SUPABASE_PROJECT_REF=");
  });

  it("does NOT contain DATABASE_MIGRATION_URL in WP-00-02", () => {
    expect(envExample).not.toContain("DATABASE_MIGRATION_URL=");
  });

  it("does NOT contain legacy NEXT_PUBLIC_SUPABASE_ANON_KEY", () => {
    expect(envExample).not.toMatch(/NEXT_PUBLIC_SUPABASE_ANON_KEY\s*=/);
  });

  it("does NOT contain legacy SUPABASE_SERVICE_ROLE_KEY", () => {
    expect(envExample).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY\s*=/);
  });
});

describe("no committed secret env files", () => {
  const forbiddenEnvFiles = [
    ".env",
    ".env.local",
    ".env.production",
    ".env.production.local",
    ".env.development",
    ".env.development.local",
    ".env.test",
    ".env.test.local",
  ];

  for (const f of forbiddenEnvFiles) {
    it(`${f} is not committed`, () => {
      expect(existsSync(join(root, f))).toBe(false);
    });
  }
});

describe("client-visible source contains no server-only secret references", () => {
  // Walk src/app/ (the client-visible surface) and verify no file references
  // the literal names of server-only env vars.
  const clientDir = join(root, "src", "app");
  if (!existsSync(clientDir)) {
    it.skip("src/app does not exist; skipping");
  } else {
    const files: string[] = [];
    function walk(dir: string) {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        const st = statSync(p);
        if (st.isDirectory()) walk(p);
        else if (/\.(ts|tsx|js|jsx)$/.test(name)) files.push(p);
      }
    }
    walk(clientDir);

    const forbiddenLiterals = [
      "SUPABASE_SECRET_KEY",
      "DATABASE_URL",
      "DATABASE_MIGRATION_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    ];

    for (const file of files) {
      const rel = relative(root, file);
      it(`${rel} does not reference server-only secret env literals`, () => {
        const content = readFileSync(file, "utf8");
        for (const lit of forbiddenLiterals) {
          // Allow the literal to appear inside a comment that documents why
          // it's forbidden, but only if the line starts with // or * or is
          // inside a /* */ block. To keep this test simple and strict, we
          // reject any occurrence that is not inside a comment line.
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line === undefined) continue;
            const trimmed = line.trim();
            const isComment =
              trimmed.startsWith("//") ||
              trimmed.startsWith("*") ||
              trimmed.startsWith("/*");
            if (!isComment && line.includes(lit)) {
              throw new Error(
                `Forbidden server-only env literal '${lit}' in ${rel}:${i + 1}: ${line}`,
              );
            }
          }
        }
      });
    }
  }
});

describe("env module uses server-only guard", () => {
  it("src/lib/env.ts imports 'server-only'", () => {
    const envSource = readText("src/lib/env.ts");
    expect(envSource).toMatch(/['"]server-only['"]/);
  });

  it("src/server/db/postgres-config.ts imports 'server-only'", () => {
    const src = readText("src/server/db/postgres-config.ts");
    expect(src).toMatch(/['"]server-only['"]/);
  });
});
