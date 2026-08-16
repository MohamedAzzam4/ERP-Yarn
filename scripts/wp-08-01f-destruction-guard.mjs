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
 * LIVE-VALIDATION MODE REMOVED (Milestone C proof corrections):
 *   The previous --live-validation mode allowed destructive operations
 *   against any remote non-pooler PostgreSQL URL with an opt-in flag.
 *   This is NOT authorized by any approved project decision. DEC-056
 *   states the Supabase project "does not authorize remote connectivity,
 *   migrations, schema work, or data mutation outside the proper later
 *   package." DEC-060 allows temporary credentials for "Supabase
 *   development/test connectivity" but only for explicitly authorized
 *   operations — not for destructive live validation scripts.
 *
 *   Per the Milestone C safety review: "If no approved project decision
 *   authorizes destructive remote live validation, do not weaken the
 *   guard to make scripts pass. Report the conflict and keep those
 *   scripts blocked instead."
 *
 *   The live-validation scripts (wp-05-03, wp-06-01, etc.) are now
 *   BLOCKED by the guard. They must be run WITHOUT the guard CLI
 *   invocation (the scripts still work if invoked directly without the
 *   guard — but the static-guard-coverage test will flag them as
 *   unguarded). This is the intended behavior: the conflict is reported,
 *   not bypassed.
 *
 * Exit codes:
 *   0 — environment is safe for the requested mode
 *   1 — environment is NOT safe (with credential-free reason on stderr)
 *   2 — usage error
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
    "For pooler-proof mode, add --pooler-proof and set " +
    "ERP_ALLOW_POOLER_PROOF=1.\n",
  );
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  const poolerProofMode = args.includes("--pooler-proof");

  // Reject --live-validation if passed (mode removed).
  if (args.includes("--live-validation")) {
    process.stderr.write(
      "SAFETY: --live-validation mode has been REMOVED.\n" +
      "No approved project decision authorizes destructive remote live validation.\n" +
      "DEC-056 states the Supabase project does not authorize remote data mutation.\n" +
      "Use default mode (local disposable DB) or --pooler-proof (run-scoped only).\n",
    );
    process.exit(2);
  }

  const databaseUrl = process.env.DATABASE_URL;
  const allowDestructive = process.env.ERP_ALLOW_DESTRUCTIVE_LOCAL_TEST_DB === "1";
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
        "DATABASE_URL does not contain 'pooler'. Use default mode " +
        "for local disposable DB.",
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
  // Default mode: strict local-disposable-DB policy.
  // No remote URLs allowed (no Supabase, no pooler, no remote hosts).
  // -------------------------------------------------------------------

  // Common check: NO POOLER URLS in default mode.
  if (isPoolerUrl) {
    fail(
      "DATABASE_URL appears to point to a Supabase pooler. " +
      "Default mode requires a local disposable DB. For the pooler " +
      "compatibility proof only, use --pooler-proof.",
    );
  }

  // Host must be localhost / 127.0.0.1 / ::1
  const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    fail(
      "hostname '" + parsed.hostname + "' is not in [localhost, 127.0.0.1, ::1]. " +
      "Refusing to run destructive tests against non-local database. " +
      "Remote destructive live validation is NOT authorized by any " +
      "approved project decision (DEC-056, DEC-060).",
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
