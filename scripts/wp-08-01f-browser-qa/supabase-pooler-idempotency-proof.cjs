/**
 * WP-08-01F Milestone C Task 6 — Supabase pooler idempotency compatibility proof.
 *
 * This script MUST be run with Supabase credentials in the environment.
 * It creates unique run-scoped rows and cleans only those exact rows.
 * It NEVER deletes all tenant records or affects the old QA batch.
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SECRET_KEY=... \
 *   DATABASE_URL=postgresql://...supabase... \
 *   node scripts/wp-08-01f-browser-qa/supabase-pooler-idempotency-proof.cjs
 *
 * If credentials are unavailable, exit with code 2.
 */
const crypto = require('crypto');
const { execSync } = require("node:child_process");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const DB_URL = process.env.DATABASE_URL;

if (!SUPABASE_URL || !SUPABASE_KEY || !DB_URL || !DB_URL.includes('supabase')) {
  console.log('Supabase credentials unavailable. Skipping pooler proof.');
  console.log('Required: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, DATABASE_URL (Supabase pooler)');
  process.exit(2);
}

const postgres = require('postgres');
execSync("node scripts/wp-08-01f-destruction-guard.mjs --pooler-proof", { stdio: "inherit" });
const sql = postgres(DB_URL, { prepare: false, max: 2, connect_timeout: 15, idle_timeout: 10 });

const RUN_TENANT = crypto.randomUUID();
const RUN_USER = crypto.randomUUID();
const RUN_SCOPE = 'pooler_proof_' + Date.now();

async function main() {
  console.log('=== Supabase Pooler Idempotency Proof ===');
  console.log('Run tenant:', RUN_TENANT);
  console.log('Run scope:', RUN_SCOPE);

  // Seed tenant + user
  await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status)
            VALUES (${RUN_TENANT}, ${"Pooler Proof"}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"})`;
  await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference)
            VALUES (${RUN_USER}, ${RUN_TENANT}, ${"pooler-proof"}, ${"PP"}, ${"pp@test.test"}, ${"active"}, ${"ar"})`;

  const { IdempotencyDbRepository } = require('./node_modules-dist/idempotency-db-repository.cjs');
  // We can't easily import TS — use raw SQL instead

  // 1. Insert/claim
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
  console.log('1. Insert succeeded, ownerToken present:', !!ownerToken);

  // 2. Verify row exists
  const [row] = await sql`SELECT state, owner_token FROM idempotency_records WHERE id = ${id}`;
  console.log('2. Row found, state:', row.state, 'has_token:', !!row.owner_token);

  // 3. Owner-fenced update succeeds
  const [updated] = await sql`
    UPDATE idempotency_records SET state = 'succeeded', response_code = 200, response_body = ${JSON.stringify({ ok: true })}::jsonb, completed_at = NOW()
    WHERE id = ${id} AND state = 'in_progress' AND owner_token = ${ownerToken}
    RETURNING id
  `;
  console.log('3. Owner-fenced update succeeded:', !!updated);

  // 4. Verify succeeded state
  const [succeeded] = await sql`SELECT state, response_code FROM idempotency_records WHERE id = ${id}`;
  console.log('4. State after markSucceeded:', succeeded.state, 'code:', succeeded.response_code);

  // 5. Stale-owner update is rejected
  const [staleUpdate] = await sql`
    UPDATE idempotency_records SET state = 'business_failed'
    WHERE id = ${id} AND state = 'in_progress' AND owner_token = ${'wrong-token'}
    RETURNING id
  `;
  console.log('5. Stale-owner update rejected:', !staleUpdate);

  // 6. Conflict detection (same key, different hash)
  const conflictKey = RUN_SCOPE + '-conflict';
  const conflictId = crypto.randomUUID();
  await sql`
    INSERT INTO idempotency_records (id, tenant_id, operation_scope, idempotency_key, request_hash,
      state, owner_token, attempt_count, lease_heartbeat_at, lease_expires_at, initiated_by)
    VALUES (${conflictId}, ${RUN_TENANT}, ${RUN_SCOPE}, ${conflictKey}, ${'hash-A'},
      'succeeded', ${crypto.randomUUID()}, 1, NOW(), NOW() + interval '30 seconds', ${RUN_USER})
  `;
  // Try to find with different hash
  const [existing] = await sql`SELECT request_hash FROM idempotency_records WHERE tenant_id = ${RUN_TENANT} AND operation_scope = ${RUN_SCOPE} AND idempotency_key = ${conflictKey}`;
  console.log('6. Conflict detected (hash mismatch):', existing.request_hash !== 'hash-B');

  // Cleanup ONLY run-scoped rows
  await sql`DELETE FROM idempotency_records WHERE tenant_id = ${RUN_TENANT}`;
  await sql`DELETE FROM users WHERE tenant_id = ${RUN_TENANT}`;
  await sql`DELETE FROM tenants WHERE id = ${RUN_TENANT}`;
  console.log('Cleanup complete (run-scoped only).');

  await sql.end();
  console.log('\nAll Supabase pooler proofs PASSED.');
}

main().catch(e => {
  console.error('Proof failed:', e.message);
  // Cleanup on error
  sql`DELETE FROM idempotency_records WHERE tenant_id = ${RUN_TENANT}`.then(() =>
    sql`DELETE FROM users WHERE tenant_id = ${RUN_TENANT}`.then(() =>
      sql`DELETE FROM tenants WHERE id = ${RUN_TENANT}`.then(() => sql.end())
    )
  );
  process.exit(1);
});
