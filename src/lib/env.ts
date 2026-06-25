/**
 * Server-only environment validation for ERP-Yarn.
 *
 * This module is the single source of truth for parsing and validating
 * runtime environment variables. It MUST be imported only from server code
 * (Route Handlers, server components, server services). It MUST NOT be
 * imported from client components.
 *
 * Contract references:
 *  - docs/02_decision_log_and_scope.md DEC-057 (standardized env names;
 *    legacy NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
 *    forbidden without an approved compatibility decision).
 *  - docs/contracts/01_technical_architecture_and_deployment_contract.md
 *    §Environment Variables (binding categories; server-only secrets;
 *    `.env.example` lists these names with empty values only).
 *  - docs/contracts/01_technical_architecture_and_deployment_contract.md
 *    §Database Access Contract (postgres.js with Supabase transaction
 *    pooler requires `prepare: false`).
 *  - docs/contracts/13_work_packages.md WP-00-02 (unsafe/missing env
 *    rejection; legacy key-name rejection; no secrets in client bundle/log;
 *    `prepare: false` static/config assertion).
 *
 * WP-00-02 scope: parse + validate only. No actual Supabase client is
 * created and no network call is made. Hosted Supabase is NOT connected
 * in WP-00-02.
 */

import "server-only";
import { z } from "zod";

/**
 * The five DEC-057 standardized environment variable names.
 *
 * NOTE: `DATABASE_MIGRATION_URL` is intentionally NOT included here in
 * WP-00-02. Contract 01 §Environment Variables defines a "server-only
 * migration/administration" category that contains `DATABASE_MIGRATION_URL`,
 * but WP-00-02's implementation-note wording says ".env.example uses only
 * the DEC-057 variable names". This ambiguity is recorded as
 * "Unresolved / requires owner decision" in the WP-00-02 completion report
 * and deferred to the first package that performs migrations.
 */
export const DEC_057_VAR_NAMES = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "DATABASE_URL",
  "SUPABASE_PROJECT_REF",
] as const;

/**
 * Legacy Supabase key names forbidden by DEC-057 unless a future reviewed
 * compatibility decision explicitly authorizes them. Their presence is a
 * configuration error and must be rejected.
 */
export const LEGACY_FORBIDDEN_VAR_NAMES = [
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

// ---------------------------------------------------------------------------
// Zod schema for the five DEC-057 variables.
// ---------------------------------------------------------------------------

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .trim()
    .min(1, "NEXT_PUBLIC_SUPABASE_URL is required")
    .url("NEXT_PUBLIC_SUPABASE_URL must be a valid URL"),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .min(1, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required"),
  SUPABASE_SECRET_KEY: z
    .string()
    .min(1, "SUPABASE_SECRET_KEY is required"),
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine(
      (v) => !v.includes("prepare=true"),
      "DATABASE_URL must not set prepare=true; postgres.js must use prepare:false for Supabase transaction pooler",
    ),
  SUPABASE_PROJECT_REF: z
    .string()
    .min(1, "SUPABASE_PROJECT_REF is required")
    .regex(
      /^[a-zA-Z0-9]{20}$/,
      "SUPABASE_PROJECT_REF should be a 20-char alphanumeric project reference",
    ),
});

export type Env = z.infer<typeof envSchema>;

export interface EnvParseResult {
  ok: boolean;
  env?: Env;
  errors: string[];
  legacyWarnings: string[];
}

/**
 * Parse and validate the five DEC-057 environment variables from a given
 * record (defaults to `process.env`). Does NOT mutate `process.env`.
 *
 * Also scans for forbidden legacy key names and reports them as errors.
 *
 * Safe to call from server code and from tests. Performs no I/O.
 */
export function parseEnv(
  source: Record<string, string | undefined> = process.env,
): EnvParseResult {
  const errors: string[] = [];
  const legacyWarnings: string[] = [];

  // 1. Reject legacy forbidden key names (DEC-057).
  for (const name of LEGACY_FORBIDDEN_VAR_NAMES) {
    const value = source[name];
    if (value !== undefined && value !== "") {
      errors.push(
        `Legacy forbidden env var '${name}' is present. DEC-057 forbids ${LEGACY_FORBIDDEN_VAR_NAMES.join(
          " and ",
        )} without an explicitly approved compatibility decision.`,
      );
    }
  }

  // 2. Validate the five DEC-057 names.
  const parsed = envSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: source.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      source.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: source.SUPABASE_SECRET_KEY,
    DATABASE_URL: source.DATABASE_URL,
    SUPABASE_PROJECT_REF: source.SUPABASE_PROJECT_REF,
  });

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(`${issue.path.join(".")}: ${issue.message}`);
    }
    return { ok: false, errors, legacyWarnings };
  }

  // 3. Defense-in-depth: ensure no NEXT_PUBLIC_ prefix on server-only vars.
  const serverOnlyNames = ["SUPABASE_SECRET_KEY", "DATABASE_URL"] as const;
  for (const name of serverOnlyNames) {
    if (name.startsWith("NEXT_PUBLIC_")) {
      // Internal contract assertion; should never fire because the list is
      // hard-coded above. Present for defense-in-depth.
      errors.push(`Server-only var '${name}' must not be NEXT_PUBLIC_-prefixed`);
    }
  }

  // 4. Defense-in-depth: ensure publishable key is not the secret key.
  if (
    parsed.data.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ===
    parsed.data.SUPABASE_SECRET_KEY
  ) {
    errors.push(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY must not be equal; publishable key is browser-safe, secret key bypasses RLS and is server-only",
    );
  }

  // 5. If any errors accumulated (legacy keys, publishable==secret, etc.),
  // fail even when the five DEC-057 vars themselves are valid.
  if (errors.length > 0) {
    return { ok: false, errors, legacyWarnings };
  }

  return { ok: true, env: parsed.data, errors, legacyWarnings };
}

/**
 * Load and validate environment, throwing on failure. Used by server code
 * at startup. Returns the validated Env object.
 *
 * WP-00-02 note: this function is defined but not invoked from any startup
 * path yet — no database connection or Supabase client is created in
 * WP-00-02. It will be called from the server runtime in later packages.
 */
export function requireEnv(): Env {
  const result = parseEnv();
  if (!result.ok || !result.env) {
    throw new Error(
      `Environment validation failed:\n${result.errors.join("\n")}`,
    );
  }
  return result.env;
}
