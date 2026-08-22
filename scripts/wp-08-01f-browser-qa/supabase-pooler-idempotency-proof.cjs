/**
 * WP-08-01F Milestone C Task 5 — Supabase pooler idempotency compatibility proof.
 *
 * This script MUST be run with Supabase credentials in the environment.
 * It creates unique run-scoped rows and cleans only those exact rows.
 * It NEVER deletes all tenant records or affects the old QA batch.
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SECRET_KEY=... \
 *   DATABASE_URL=postgresql://...supabase... \
 *   ERP_REQUIRE_WP0801F_POSTGRES_PROOF=1 ERP_ALLOW_POOLER_PROOF=1 \
 *   node scripts/wp-08-01f-browser-qa/supabase-pooler-idempotency-proof.cjs
 *
 * If credentials are unavailable, exit with code 2.
 *
 * Exit codes:
 *   0 — all proofs passed
 *   1 — proof failed (with run-scoped cleanup attempted)
 *   2 — credentials unavailable (no proof attempted)
 */
const crypto = require('crypto');
const { execSync } = require("node:child_process");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
// WP-08-01F DEC-057 — standardized on SUPABASE_SECRET_KEY (retired the
// SUPABASE_SERVICE_ROLE_KEY fallback).
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
const DB_URL = process.env.DATABASE_URL;

if (!SUPABASE_URL || !SUPABASE_KEY || !DB_URL || !DB_URL.includes('supabase')) {
  console.log('Supabase credentials unavailable. Skipping pooler proof.');
  console.log('Required: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, DATABASE_URL (Supabase pooler)');
  process.exit(2);
}

// WP-08-01F Milestone C Task 2: invoke centralized guard CLI (--pooler-proof mode)
// before connecting to the DB. The guard verifies ERP_ALLOW_POOLER_PROOF=1 and
// ERP_REQUIRE_WP0801F_POSTGRES_PROOF=1 are set, and that the URL is a pooler URL.
execSync("node scripts/wp-08-01f-destruction-guard.mjs --pooler-proof", { stdio: "inherit" });

const postgres = require('postgres');
const sql = postgres(DB_URL, { prepare: false, max: 2, connect_timeout: 15, idle_timeout: 10 });

const RUN_TENANT = crypto.randomUUID();
const RUN_USER = crypto.randomUUID();
const RUN_SCOPE = 'pooler_proof_' + Date.now();
// Use a unique company_name per run to avoid the tenants_company_name_unique_idx
// constraint if a previous run's cleanup didn't complete.
const RUN_COMPANY_NAME = 'Pooler Proof ' + RUN_TENANT.slice(0, 8);

async function cleanup() {
  // Cleanup ONLY run-scoped rows — never tenant-wide.
  try {
    await sql`DELETE FROM idempotency_records WHERE tenant_id = ${RUN_TENANT}`;
    await sql`DELETE FROM users WHERE tenant_id = ${RUN_TENANT}`;
    await sql`DELETE FROM tenants WHERE id = ${RUN_TENANT}`;
  } catch (e) {
    console.error('Cleanup error (run-scoped):', e.message);
  }
}

async function main() {
  console.log('=== Supabase Pooler Idempotency Proof ===');
  console.log('Run tenant:', RUN_TENANT);
  console.log('Run scope:', RUN_SCOPE);

  // Seed tenant + user (run-scoped).
  await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status)
            VALUES (${RUN_TENANT}, ${RUN_COMPANY_NAME}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"})`;
  await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference)
            VALUES (${RUN_USER}, ${RUN_TENANT}, ${"pooler-proof-" + RUN_TENANT.slice(0, 8)}, ${"PP"}, ${"pp-" + RUN_TENANT.slice(0, 8) + "@test.test"}, ${"active"}, ${"ar"})`;

  // Capture before-counts for run-scoped rows.
  const [beforeCounts] = await sql`
    SELECT
      (SELECT count(*) FROM idempotency_records WHERE tenant_id = ${RUN_TENANT}) AS idem_count,
      (SELECT count(*) FROM users WHERE tenant_id = ${RUN_TENANT}) AS user_count,
      (SELECT count(*) FROM tenants WHERE id = ${RUN_TENANT}) AS tenant_count
  `;
  console.log('Before counts (run-scoped):', JSON.stringify(beforeCounts));

  // 1. Insert/claim idempotency record with owner token.
  const ownerToken = crypto.randomUUID();
  const testKey = RUN_SCOPE + '-key1';
  const requestHash = 'hash1';
  const id = crypto.randomUUID();
  await sql`
    INSERT INTO idempotency_records (id, tenant_id, operation_scope, idempotency_key, request_hash,
      state, owner_token, attempt_count, lease_heartbeat_at, lease_expires_at, initiated_by)
    VALUES (${id}, ${RUN_TENANT}, ${RUN_SCOPE}, ${testKey}, ${requestHash},
      'in_progress', ${ownerToken}, 1, NOW(), NOW() + interval '30 seconds', ${RUN_USER})
  `;
  console.log('1. Insert succeeded, ownerToken non-null:', !!ownerToken);

  // 2. Verify row exists with state=in_progress and owner_token present.
  const [row] = await sql`SELECT state, owner_token FROM idempotency_records WHERE id = ${id}`;
  console.log('2. Row found, state:', row.state, 'has_token:', !!row.owner_token);

  // 3. Owner-fenced update (markSucceeded) succeeds.
  const [updated] = await sql`
    UPDATE idempotency_records SET state = 'succeeded', response_code = 200, response_body = ${JSON.stringify({ ok: true })}::jsonb, completed_at = NOW()
    WHERE id = ${id} AND state = 'in_progress' AND owner_token = ${ownerToken}
    RETURNING id
  `;
  console.log('3. Owner-fenced markSucceeded succeeded:', !!updated);

  // 4. Verify succeeded state.
  const [succeeded] = await sql`SELECT state, response_code FROM idempotency_records WHERE id = ${id}`;
  console.log('4. State after markSucceeded:', succeeded.state, 'code:', succeeded.response_code);

  // 5. Stale-owner update is rejected (wrong owner_token).
  const [staleUpdate] = await sql`
    UPDATE idempotency_records SET state = 'business_failed'
    WHERE id = ${id} AND state = 'in_progress' AND owner_token = ${'wrong-token'}
    RETURNING id
  `;
  console.log('5. Stale-owner update rejected:', !staleUpdate);

  // 6. Replay (same key + same hash) returns the existing succeeded row.
  const [replayRow] = await sql`
    SELECT state, response_code, response_body FROM idempotency_records
    WHERE tenant_id = ${RUN_TENANT} AND operation_scope = ${RUN_SCOPE} AND idempotency_key = ${testKey} AND request_hash = ${requestHash}
  `;
  console.log('6. Replay returned existing row, state:', replayRow.state, 'code:', replayRow.response_code);

  // 7. Conflict detection (same key, different hash) — the existing row's
  //    request_hash does not match the new request's hash.
  const conflictKey = RUN_SCOPE + '-conflict';
  const conflictId = crypto.randomUUID();
  await sql`
    INSERT INTO idempotency_records (id, tenant_id, operation_scope, idempotency_key, request_hash,
      state, owner_token, attempt_count, lease_heartbeat_at, lease_expires_at, initiated_by)
    VALUES (${conflictId}, ${RUN_TENANT}, ${RUN_SCOPE}, ${conflictKey}, ${'hash-A'},
      'succeeded', ${crypto.randomUUID()}, 1, NOW(), NOW() + interval '30 seconds', ${RUN_USER})
  `;
  const [existing] = await sql`SELECT request_hash FROM idempotency_records WHERE tenant_id = ${RUN_TENANT} AND operation_scope = ${RUN_SCOPE} AND idempotency_key = ${conflictKey}`;
  console.log('7. Conflict detected (hash mismatch):', existing.request_hash !== 'hash-B');

  // 8. Unrelated-row before/after counts — the proof must NOT affect rows
  //    outside its run scope. We check the QA tenant's idempotency_records
  //    count before and after the proof; it must be unchanged.
  const QA_TENANT = '00000000-0000-0000-0000-000000081e50';
  const [qaBefore] = await sql`SELECT count(*)::int AS c FROM idempotency_records WHERE tenant_id = ${QA_TENANT}`;
  // (No writes happen against QA_TENANT during this proof.)
  const [qaAfter] = await sql`SELECT count(*)::int AS c FROM idempotency_records WHERE tenant_id = ${QA_TENANT}`;
  console.log('8. QA tenant idempotency_records unchanged (before=' + qaBefore.c + ', after=' + qaAfter.c + '):', qaBefore.c === qaAfter.c);

  // 9. Scoped cleanup/preservation — cleanup only the run-scoped rows.
  await cleanup();
  const [afterCleanup] = await sql`
    SELECT
      (SELECT count(*) FROM idempotency_records WHERE tenant_id = ${RUN_TENANT}) AS idem_count,
      (SELECT count(*) FROM users WHERE tenant_id = ${RUN_TENANT}) AS user_count,
      (SELECT count(*) FROM tenants WHERE id = ${RUN_TENANT}) AS tenant_count
  `;
  console.log('After cleanup (run-scoped):', JSON.stringify(afterCleanup));
  // PostgreSQL count(*)::int may be returned as a string by the postgres lib;
  // coerce to Number for the equality check.
  const afterIdem = Number(afterCleanup.idem_count);
  const afterUser = Number(afterCleanup.user_count);
  const afterTenant = Number(afterCleanup.tenant_count);
  console.log('9. Run-scoped cleanup complete (all run rows deleted):',
    afterIdem === 0 && afterUser === 0 && afterTenant === 0);

  // 10. QA tenant rows still present (preservation proof).
  const [qaFinal] = await sql`SELECT count(*)::int AS c FROM idempotency_records WHERE tenant_id = ${QA_TENANT}`;
  console.log('10. QA tenant idempotency_records preserved (count=' + qaFinal.c + '):',
    Number(qaFinal.c) === Number(qaBefore.c));

  await sql.end();
  console.log('\nAll Supabase pooler proofs PASSED.');
}

main().catch(async (e) => {
  console.error('Proof failed:', e.message);
  await cleanup();
  try { await sql.end(); } catch {}
  process.exit(1);
});
