#!/usr/bin/env node
/**
 * WP-08-01F Milestone C Task 2 — Centralized destruction guard CLI.
 *
 * Single source of truth for non-TypeScript scripts (Python, shell, PowerShell,
 * standalone Node) that need to verify the local disposable-test database
 * safety policy BEFORE connecting or issuing any destructive statement.
 *
 * The TypeScript guard (`src/server/services/__tests__/destructive-test-guard.ts`)
 * is the canonical implementation; this CLI mirrors the same safety checks so
 * scripts that cannot import TypeScript directly can still enforce the policy.
 *
 * Modes:
 *   default         — Strict local-disposable-DB policy. Requires:
 *                     1. DATABASE_URL starts with postgresql:// or postgres://
 *                     2. Host is exactly localhost, 127.0.0.1, or ::1
 *                     3. Database name is exactly 'erp_yarn_wp0801f_disposable'
 *                     4. URL contains no 'supabase' or 'pooler' substring
 *                     5. ERP_ALLOW_DESTRUCTIVE_LOCAL_TEST_DB=1
 *                     6. ERP_REQUIRE_WP0801F_POSTGRES_PROOF=1
 *
 *   --live-validation  — Live-QA policy. Allows direct Supabase project URLs
 *                     (NOT pooler URLs — poolers are transaction-mode and
 *                     cannot be used for destructive operations). Requires:
 *                     1. DATABASE_URL starts with postgresql:// or postgres://
 *                     2. URL contains no 'pooler' substring
 *                     3. URL host is NOT localhost (use default mode for that)
 *                     4. ERP_ALLOW_LIVE_VALIDATION_DESTRUCTIVE=1
 *                     5. ERP_REQUIRE_WP0801F_POSTGRES_PROOF=1
 *
 *   --pooler-proof     — Pooler-compatibility-proof policy. The ONLY mode
 *                     that allows pooler URLs. Used exclusively by the
 *                     supabase-pooler-idempotency-proof.cjs script which
 *                     creates unique run-scoped rows and deletes only those
 *                     exact rows (FK-scoped, never tenant-wide). Requires:
 *                     1. DATABASE_URL starts with postgresql:// or postgres://
 *                     2. URL contains 'pooler' substring
 *                     3. ERP_ALLOW_POOLER_PROOF=1
 *                     4. ERP_REQUIRE_WP0801F_POSTGRES_PROOF=1
 *
 * Exit codes:
 *   0 — environment is safe for the requested mode
 *   1 — environment is NOT safe (with credential-free reason on stderr)
 *   2 — usage error
 *
 * Invocation:
 *   node scripts/wp-08-01f-destruction-guard.mjs
 *   node scripts/wp-08-01f-destruction-guard.mjs --live-validation
 *   node scripts/wp-08-01f-destruction-guard.mjs --pooler-proof
 *
 * NEVER prints DATABASE_URL, credentials, or connection strings.
 */
"use strict";

const DISPOSABLE_DB_NAME = "erp_yarn_wp0801f_disposable";

function fail(message) {
  process.stderr.write("SAFETY: " + message + "\n");
  process.stderr.write(
    "Set DATABASE_URL to a local PostgreSQL disposable database " +
    "(host=localhost/127.0.0.1/::1, name=" + DISPOSABLE_DB_NAME + "), " +
    "ERP_ALLOW_DESTRUCTIVE_LOCAL_TEST_DB=1, and " +
    "ERP_REQUIRE_WP0801F_POSTGRES_PROOF=1.\n" +
    "For live-validation mode, add --live-validation and set " +
    "ERP_ALLOW_LIVE_VALIDATION_DESTRUCTIVE=1.\n" +
    "For pooler-proof mode, add --pooler-proof and set " +
    "ERP_ALLOW_POOLER_PROOF=1.\n",
  );
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  const liveValidationMode = args.includes("--live-validation");
  const poolerProofMode = args.includes("--pooler-proof");

  if (liveValidationMode && poolerProofMode) {
    process.stderr.write("SAFETY: --live-validation and --pooler-proof are mutually exclusive.\n");
    process.exit(2);
  }

  const databaseUrl = process.env.DATABASE_URL;
  const allowDestructive = process.env.ERP_ALLOW_DESTRUCTIVE_LOCAL_TEST_DB === "1";
  const allowLiveValidation = process.env.ERP_ALLOW_LIVE_VALIDATION_DESTRUCTIVE === "1";
  const allowPoolerProof = process.env.ERP_ALLOW_POOLER_PROOF === "1";
  const requireProof = process.env.ERP_REQUIRE_WP0801F_POSTGRES_PROOF === "1";

  // 1. DATABASE_URL present
  if (!databaseUrl) {
    if (requireProof) {
      fail("DATABASE_URL is not set but ERP_REQUIRE_WP0801F_POSTGRES_PROOF=1.");
    }
    fail("DATABASE_URL is not set.");
  }

  // 2. PostgreSQL scheme
  if (!databaseUrl.startsWith("postgresql://") && !databaseUrl.startsWith("postgres://")) {
    if (databaseUrl.startsWith("file:")) {
      fail("DATABASE_URL is SQLite (file:), not PostgreSQL.");
    }
    fail("DATABASE_URL must start with postgresql:// or postgres://.");
  }

  // 3. Parse URL (without echoing it back)
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    fail("DATABASE_URL is not a valid URL.");
  }

  const isPoolerUrl =
    parsed.hostname.includes("pooler") ||
    databaseUrl.includes("pooler");

  // -------------------------------------------------------------------
  // Pooler-proof mode: the ONLY mode that allows pooler URLs.
  // -------------------------------------------------------------------
  if (poolerProofMode) {
    if (!isPoolerUrl) {
      fail(
        "--pooler-proof mode requires a pooler URL, but the provided " +
        "DATABASE_URL does not contain 'pooler'. Use --live-validation " +
        "for direct project URLs or default mode for local disposable DB.",
      );
    }
    if (!allowPoolerProof) {
      fail("ERP_ALLOW_POOLER_PROOF=1 is not set. Pooler-proof mode requires explicit opt-in.");
    }
    if (!requireProof) {
      fail("ERP_REQUIRE_WP0801F_POSTGRES_PROOF=1 is not set.");
    }
    process.stdout.write(
      "SAFETY: Environment is safe for pooler-proof destructive operations " +
      "(pooler host=" + parsed.hostname + ").\n" +
      "WARNING: Pooler-proof mode allows pooler URLs ONLY for run-scoped " +
      "compatibility proofs. The script MUST use crypto.randomUUID()-scoped " +
      "tenant/user IDs and delete only its own run-scoped rows.\n",
    );
    process.exit(0);
  }

  // -------------------------------------------------------------------
  // Common check for non-pooler modes: NO POOLER URLS.
  // -------------------------------------------------------------------
  if (isPoolerUrl) {
    fail(
      "DATABASE_URL appears to point to a Supabase pooler. " +
      "Poolers are transaction-mode and cannot be used for destructive operations. " +
      "Use the direct project URL (--live-validation) or the local disposable DB " +
      "(default mode). For the pooler compatibility proof only, use --pooler-proof.",
    );
  }

  // -------------------------------------------------------------------
  // Live-validation mode: allow direct Supabase project URLs.
  // -------------------------------------------------------------------
  if (liveValidationMode) {
    if (!allowLiveValidation) {
      fail(
        "ERP_ALLOW_LIVE_VALIDATION_DESTRUCTIVE=1 is not set. " +
        "Live-validation mode requires explicit opt-in.",
      );
    }
    if (!requireProof) {
      fail("ERP_REQUIRE_WP0801F_POSTGRES_PROOF=1 is not set.");
    }

    const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
    if (ALLOWED_HOSTS.has(parsed.hostname)) {
      fail(
        "Live-validation mode requires a remote project URL, but hostname is '" +
        parsed.hostname + "'. Use the default mode (without --live-validation) " +
        "for local disposable-test DB operations.",
      );
    }

    process.stdout.write(
      "SAFETY: Environment is safe for live-validation destructive operations " +
      "(remote host=" + parsed.hostname + ").\n",
    );
    process.exit(0);
  }

  // -------------------------------------------------------------------
  // Default mode: strict local-disposable-DB policy.
  // -------------------------------------------------------------------

  // Host must be localhost / 127.0.0.1 / ::1
  const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    fail(
      "hostname '" + parsed.hostname + "' is not in [localhost, 127.0.0.1, ::1]. " +
      "Refusing to run destructive tests against non-local database.",
    );
  }

  // No Supabase project ref / pooler hostname
  if (
    parsed.hostname.includes("supabase") ||
    databaseUrl.includes("supabase")
  ) {
    fail("DATABASE_URL appears to point to Supabase. Refusing to run destructive tests against Supabase in default mode.");
  }

  // Database name must match disposable naming policy
  const database = parsed.pathname.replace(/^\//, "");
  if (database !== DISPOSABLE_DB_NAME) {
    fail(
      "database '" + database + "' is not '" + DISPOSABLE_DB_NAME + "'. " +
      "Refusing to run destructive tests against non-disposable database.",
    );
  }

  // Opt-in flag
  if (!allowDestructive) {
    if (requireProof) {
      fail("ERP_ALLOW_DESTRUCTIVE_LOCAL_TEST_DB=1 is not set but ERP_REQUIRE_WP0801F_POSTGRES_PROOF=1.");
    }
    fail("ERP_ALLOW_DESTRUCTIVE_LOCAL_TEST_DB=1 is not set.");
  }

  // Proof-required flag
  if (!requireProof) {
    fail("ERP_REQUIRE_WP0801F_POSTGRES_PROOF=1 is not set.");
  }

  process.stdout.write(
    "SAFETY: Environment is safe for destructive local test DB operations " +
    "(host=" + parsed.hostname + ", db=" + DISPOSABLE_DB_NAME + ").\n",
  );
  process.exit(0);
}

main();
