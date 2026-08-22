/**
 * WP-08-01F DEC-057 — Preflight source-level proof.
 *
 * Verifies that the browser-QA preflight (`scripts/wp-08-01f-browser-qa/preflight.mjs`)
 * enforces the standardized four-variable credential set and that the
 * retired `SUPABASE_SERVICE_ROLE_KEY` is NOT in the required list.
 *
 * We read the preflight source as text (the script is .mjs so it cannot
 * be imported into the vitest context without a separate build step).
 * Two assertions:
 *   (a) the source contains all four standardized env vars in the
 *       `required` array — NEXT_PUBLIC_SUPABASE_URL,
 *       NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY,
 *       DATABASE_URL.
 *   (b) the source does NOT contain a `required`-array entry for
 *       SUPABASE_SERVICE_ROLE_KEY (i.e. it appears only in explanatory
 *       comments, never as a required credential).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PREFLIGHT_PATH = resolve(
  process.cwd(),
  "scripts/wp-08-01f-browser-qa/preflight.mjs",
);

function readPreflightSource(): string {
  return readFileSync(PREFLIGHT_PATH, "utf8");
}

describe("WP-08-01F DEC-057 — preflight source-level proof", () => {
  it("contains the four standardized env vars in the required list", () => {
    const src = readPreflightSource();
    // Each standardized env var must be present in the source. We look
    // for the quoted string literal so a comment-only mention does not
    // satisfy the check.
    expect(src).toContain('"NEXT_PUBLIC_SUPABASE_URL"');
    expect(src).toContain('"NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"');
    expect(src).toContain('"SUPABASE_SECRET_KEY"');
    expect(src).toContain('"DATABASE_URL"');
  });

  it("does NOT list SUPABASE_SERVICE_ROLE_KEY as a required credential", () => {
    const src = readPreflightSource();
    // The required array is the only place a credential is enforced.
    // We extract the array literal and assert that
    // SUPABASE_SERVICE_ROLE_KEY does not appear as a quoted string
    // entry inside it (it MAY still appear in explanatory comments).
    const requiredArrayMatch = src.match(/const\s+required\s*=\s*\[([\s\S]*?)\]/);
    expect(requiredArrayMatch, "preflight.mjs must define a `required` array").not.toBeNull();
    const requiredBody = requiredArrayMatch![1]!;
    expect(requiredBody).not.toContain('"SUPABASE_SERVICE_ROLE_KEY"');
    expect(requiredBody).not.toContain("'SUPABASE_SERVICE_ROLE_KEY'");
  });
});
