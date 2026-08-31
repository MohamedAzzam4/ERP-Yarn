# WP-08-01F r8 — Reviewer Correction Pass Evidence

**Checkpoint classification:** `incomplete_needs_fix`
(All three reviewer blockers are now satisfied with strengthened proofs.
The label reflects that the broader scope items — aggregate cutover-manifest-set
hash, E2E, race gates — remain open per the reviewer's separate instructions.)

**Date:** 2026-08-31
**Branch:** `review/wp-08-01f-independent-fixes-r8`
**START_HEAD:** `b42b4fa91928f86db14cfbe4dc75466b2d54d4c7` (r7)
**Environment:**
- PostgreSQL 17.10 (Debian) on `127.0.0.1:5433`
- DB: `erp_yarn_wp0801f_disposable` (disposable test DB; `__disposable_test_db_marker` row present)
- Socket dir: `/tmp/pgsocket`
- Node v24.19.0
- `DATABASE_URL=postgres://erp_yarn_user@127.0.0.1:5433/erp_yarn_wp0801f_disposable`
- `ERP_ALLOW_DESTRUCTIVE_LOCAL_TEST_DB=1`
- `ERP_REQUIRE_WP0801F_POSTGRES_PROOF=1`

## Governing Contracts Read

- `docs/contracts/14_coding_agent_instructions.md` (sections 1–13)
- `docs/contracts/13_work_packages.md` WP-08-01F (lines 771–779)
- `docs/contracts/12_testing_and_regression_plan.md` (sections 1–7; §5 #7 explicitly requires
  "injected failure after each dependent write")
- `docs/contracts/08_historical_migration_contract.md` (cutover manifest §211/§219, commit
  idempotency §460/§486/§488, atomicity §647)
- `docs/contracts/09_api_contracts.md` (§386 high-risk test catalog)
- `docs/contracts/00_contract_index.md`
- `agent-ctx/wp-08-01f-closure-glm-coder.md`

## Files Changed (r7 → r8)

| Status | Path |
|--------|------|
| DELETED | `src/server/services/__tests__/wp-08-01f-postgres-manifest-r7.test.ts` (superseded by r8; contained forbidden lease_expires_at manipulation in MAN-TECH-1) |
| ADDED  | `src/server/services/__tests__/wp-08-01f-postgres-manifest-r8.test.ts` |
| MODIFIED | `docs/ui-ux/evidence/wp-08-01f/runs/qaB-r9-1786647635/task1-destructive-inventory-35.md` (destructive inventory row 50 updated: r7 → r8 with line-range correction 129-134) |

No production code changes were required. The r7 production fixes in
`src/server/services/historical-staging-service.ts` (BLOCKER 1 state-based
replay handling, BLOCKER 2 markRetryableFailed on non-business failures,
BLOCKER 3 owner-token fencing in markBusinessFailed/markRetryableFailed)
already implement the correct behavior — only the test evidence was insufficient
per the reviewer. r8 strengthens the test evidence without altering production
logic.

## Reviewer Blockers Resolved

### BLOCKER 1 — MAN-TECH-ROLLBACK-1 (NEW test, real mid-tx rollback proof)

**Test file:** `src/server/services/__tests__/wp-08-01f-postgres-manifest-r8.test.ts`
**Tests:** MAN-TECH-ROLLBACK-1a (no prior manifest) + MAN-TECH-ROLLBACK-1b (prior current manifest seeded → supersession rollback)

**Injection point:** `createIdempotency(tx)` factory returns a wrapper whose
`updateState` method throws `new Error("INJECTED_MID_TX_FAILURE")`. The
`updateState` call is invoked by `markSucceeded` — which is the LAST write
inside the transaction, AFTER:
1. batch row lock + re-read (SELECT … FOR UPDATE)
2. manifest hash derivation
3. `findCurrentCutoverManifestForDomain`
4. `supersedeCurrentCutoverManifestForDomain` (only if prior current manifest exists)
5. `insertCutoverManifest` (new row insert)
6. `updateBatchCutoverManifestHash` (batch.cutover_manifest_hash mutation)
7. `appendAuditLog` (audit row insert)

When `txIdem.updateState` throws, the entire Postgres transaction rolls back.
The outer catch then calls `markRetryableFailed` on `this.deps.idempotency`
(non-tx-scoped) which terminalizes the failure outside the rolled-back tx.

**Rollback evidence (per reviewer spec):**
- ✓ No new manifest survives (count unchanged from BEFORE; 0 for 1a, 1 for 1b)
- ✓ Batch `cutover_manifest_hash` unchanged (still null for 1a, still null for 1b)
- ✓ For 1b: seeded prior current manifest's `is_current=true`, `superseded_at=null`,
  `superseded_by=null`, `manifest_version=1` all UNCHANGED — supersession rolled back
- ✓ No success audit residue survives (audit_logs.idempotency_key = idemKey → 0 rows)
- ✓ Idempotency record state = `retryable_failed`
- ✓ `last_error_class = 'Error'` (name of injected Error)
- ✓ `attempt_count = 1`
- ✓ `response_code = 500`
- ✓ Owner-token fencing preserved: `owner_token` non-null

### BLOCKER 2 — Genuinely immediate retry WITHOUT lease manipulation

**Test file:** same r8 file, tests MAN-TECH-1 + MAN-TECH-ROLLBACK-1a/1b

The r7 MAN-TECH-1 manually ran:
```sql
UPDATE idempotency_records SET lease_expires_at = NOW() - INTERVAL '1 second' ...
```
before the retry. That manipulation is forbidden proof.

**r8 proof shape:**
1. After the technical failure, capture `lease_expires_at` from the
   `retryable_failed` row.
2. Remove ONLY the injected fault (`injectFailure = false`).
3. Do NOT modify `lease_expires_at`.
4. Do NOT advance the clock.
5. Explicitly assert `lease_expires_at` is UNCHANGED immediately before retry.
6. Explicitly assert `lease_expires_at` is in the FUTURE (we never backdated it).
7. Immediately call `finalizeCutoverManifest` with same key + same request.
8. Operation reclaims and succeeds (action="finalized").
9. `attempt_count` increments by EXACTLY 1 (1 → 2).
10. Exactly one new manifest created (count=1 for clean; 2 total for seeded, with new = current).
11. Batch hash now bound to the new manifest hash.

**Why this works:** The DB-layer `claimExpiredLease` predicate in
`idempotency-db-repository.ts` is:
```sql
(state = 'retryable_failed' OR (state = 'in_progress' AND lease_expires_at < now))
```
A `retryable_failed` record is reclaimed UNCONDITIONALLY — no lease expiry
check. This proves the production design allows genuinely immediate retry.

### BLOCKER 3 — MAN-REPLAY-1 exact durable replay

**Test file:** same r8 file, test MAN-REPLAY-1.

**r8 proof shape:**
1. First call on `pending_dual_approval` batch → INVALID_BATCH_STATUS →
   idempotency state `business_failed` with stored `response_body`
   `{ code: "INVALID_BATCH_STATUS", message: <exact batch-specific message> }`.
2. SELECT the stored row and capture EXACTLY:
   - `state = "business_failed"`
   - `attempt_count = 1`
   - `response_code = 409`
   - `response_body.code = "INVALID_BATCH_STATUS"`
   - `response_body.message = <exact message containing the unique batch id + "pending_dual_approval">`
   - Save the exact stored code/message.
3. Capture BEFORE state (manifest count, batch hash, approval count).
4. Change underlying business world: `UPDATE import_batches SET status = 'staged'`.
5. Retry with same idempotency key + same original request.
6. The call must FAIL (not succeed).
7. Assert the thrown HistoricalStagingError has EXACTLY:
   - `error.code === storedCode` (NOT a regex match)
   - `error.message === storedMessage` (NOT a regex match)
8. Negative assertion: `error.code !== "BUSINESS_FAILED"` (not the generic fallback)
9. Negative assertion: `error.message !== "Previous business failure (durable)."` (not the generic fallback)
10. Prove NO business re-execution happened:
    - manifest count unchanged (still 0)
    - batch hash unchanged (still null)
    - approval count unchanged (still 0)
11. Prove idempotency state UNCHANGED:
    - state still `business_failed`
    - attempt_count still 1 (NOT incremented)
    - response_code still 409
    - response_body.code/message still EXACTLY the stored first response

## Strengthened MAN-IDEMP-2..5 (carried over from r7)

Each conflict case asserts BEFORE/AFTER equality on:
- manifest count
- `batch.cutover_manifest_hash`
- approval count
- idempotency record count
- original terminal state (`succeeded`)

## Test Results

### Focused r8 test file (8 tests)
**Command:**
```
DATABASE_URL='postgres://erp_yarn_user@127.0.0.1:5433/erp_yarn_wp0801f_disposable' \
ERP_ALLOW_DESTRUCTIVE_LOCAL_TEST_DB=1 \
ERP_REQUIRE_WP0801F_POSTGRES_PROOF=1 \
npx vitest run src/server/services/__tests__/wp-08-01f-postgres-manifest-r8.test.ts --reporter=verbose
```
**Exit code:** 0
**Result:** 8 passed (8) — 0 failed, 0 skipped
**Duration:** 5.50s (transform 415ms, tests 4.39s)
**Date:** 2026-08-31 00:20:35 UTC
**Fixture identity:** RUN_ID = randomUUID per process; per-test unique tenants via `T = RUN_ID`; per-test unique users via `U = randomUUID()`.

Test names + durations:
1. MAN-REPLAY-1 — 921ms
2. MAN-TECH-1 — 476ms
3. MAN-TECH-ROLLBACK-1a — 560ms
4. MAN-TECH-ROLLBACK-1b — 500ms
5. MAN-IDEMP-2 — 395ms
6. MAN-IDEMP-3 — 445ms
7. MAN-IDEMP-4 — 553ms
8. MAN-IDEMP-5 — 329ms

### Focused manifest regression (r6 + r8, 15 tests)
**Command:**
```
npx vitest run src/server/services/__tests__/wp-08-01f-postgres-manifest-r6.test.ts \
  src/server/services/__tests__/wp-08-01f-postgres-manifest-r8.test.ts --reporter=dot
```
**Exit code:** 0
**Result:** 15 passed (15) — 0 failed, 0 skipped
**Duration:** 10.35s

### Full WP-08-01F gate (45 test files, 1100 tests)
**Command:**
```
npx vitest run $(find src -name "wp-08-01f-*test*.ts" -not -path "*/node_modules/*" | sort | tr '\n' ' ') --reporter=dot
```
**Exit code:** 0
**Result:** 1100 passed (1100) — 0 failed, 0 skipped
**Duration:** 209.43s
**Date:** 2026-08-31 00:15:47 UTC

### TypeScript typecheck
**Command:** `npx tsc --noEmit`
**Exit code:** 0
**Date:** 2026-08-31 00:21 UTC

### ESLint
**Command:** `npx eslint .`
**Exit code:** 0
**Date:** 2026-08-31 00:21 UTC

### Whitespace/conflict check
**Command:** `git diff --check`
**Exit code:** 0
**Date:** 2026-08-31 00:21 UTC

## DO NOT IMPLEMENT — Aggregate cutover-manifest-set hash

`UNRESOLVED_CUTOVER_MANIFEST_SET_HASH` remains an OWNER DECISION.
No aggregate hash algorithm was invented. Approval fingerprint semantics
were not silently changed. Status recorded as:

> Unresolved / requires owner decision

## E2E / Race Gates

E2E (`SNAP-E2E-1`) and race (`SNAP-RACE-1`, `SNAP-RACE-2`) gates remain
OPEN. They were not addressed by this checkpoint.

The browser/E2E gate additionally remains ENVIRONMENT BLOCKED because
the three Supabase credentials (`NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`) are not
available in this sandbox.

## Remaining Risks

1. `UNRESOLVED_CUTOVER_MANIFEST_SET_HASH` — owner decision required
   before any aggregate-hash or approval-fingerprint semantics can be
   introduced.
2. E2E/race gates OPEN (SNAP-E2E-1, SNAP-RACE-1, SNAP-RACE-2).
3. Browser/E2E gate ENVIRONMENT BLOCKED on Supabase credentials.

## Checkpoint Classification

`incomplete_needs_fix`

All three reviewer-requested blockers (BLOCKER 1 mid-tx rollback,
BLOCKER 2 immediate retry without lease manipulation, BLOCKER 3 exact
durable replay) are now satisfied with strengthened PostgreSQL service-level
proofs. The `incomplete_needs_fix` label reflects that the broader scope
items (aggregate hash, E2E, races, browser gate) remain open per the
reviewer's separate instructions and are not addressed by this checkpoint.
