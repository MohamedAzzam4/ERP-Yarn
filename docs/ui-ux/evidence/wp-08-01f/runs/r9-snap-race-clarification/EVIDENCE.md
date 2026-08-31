# WP-08-01F r9 — SNAP-RACE-1 / SNAP-RACE-2 Authoritative-Definition Review

**Checkpoint classification:** `incomplete_needs_fix`

**Date:** 2026-08-31 (Europe/Berlin)
**Branch:** `review/wp-08-01f-independent-fixes-r9`
**START_HEAD:** `6a3dac425d47371c0bb049ff76efca1314571bb3` (r8, reviewer-accepted)
**FINAL_HEAD:** (set after commit — see report below)
**Environment:**
- PostgreSQL 17.10 (Debian) on `127.0.0.1:5433`
- DB: `erp_yarn_wp0801f_disposable` (disposable test DB; `__disposable_test_db_marker` row present)
- Socket dir: `/tmp/pgsocket`
- Node v24.19.0
- `DATABASE_URL=postgres://erp_yarn_user@127.0.0.1:5433/erp_yarn_wp0801f_disposable`
- `ERP_ALLOW_DESTRUCTIVE_LOCAL_TEST_DB=1`
- `ERP_REQUIRE_WP0801F_POSTGRES_PROOF=1`

## PHASE 0 — Remote Verification

| Item | Value |
|------|-------|
| Remote branch (r8) | `review/wp-08-01f-independent-fixes-r8` |
| Remote SHA (r8) | `6a3dac425d47371c0bb049ff76efca1314571bb3` (verified via GitHub API) |
| Local HEAD (after fetch) | `6a3dac425d47371c0bb049ff76efca1314571bb3` |
| Local HEAD match | YES (exact match) |
| New branch (r9) | `review/wp-08-01f-independent-fixes-r9` (created from r8 SHA) |
| `git status --short` (before implementation) | clean |

## PHASE 1 — Repository Authority Read

Files read in full before any coding:

- `docs/contracts/00_contract_index.md`
- `docs/contracts/08_historical_migration_contract.md` (cutover manifest §211/§219, commit idempotency §460/§486/§488/§645/§647, dual approval §456)
- `docs/contracts/09_api_contracts.md` (§386 high-risk test catalog)
- `docs/contracts/12_testing_and_regression_plan.md` (§5 #7 "injected failure after each dependent write"; §11.2 "Idempotency and Transaction Races"; §11.4 "Migration Cutover and Capacity")
- `docs/contracts/13_work_packages.md` (WP-08-01F lines 771–779; WP-08-02 traceability)
- `docs/contracts/14_coding_agent_instructions.md` (§1–§13, especially §6, §11, §12, §13)
- `docs/02_decision_log_and_scope.md` (DEC-069, DEC-070, DEC-071, DEC-080)
- `docs/execution/01_glm_execution_plan.md` (WP-07-04 race requirements)
- `agent-ctx/wp-08-01f-closure-glm-coder.md`
- `agent-ctx/wp-08-01f-alias-tests-fix-glm-coder.md`
- `agent-ctx/wp-08-01f-submission-atomicity-fix-glm-coder.md`
- Existing historical-migration PostgreSQL race/concurrency tests (see §"Existing Race Tests" below)

## PHASE 2 — SNAP-RACE-1 / SNAP-RACE-2 Authoritative-Definition Review

### Search performed

Exhaustive search of the entire repository (excluding `node_modules`, `.vite/` cache) for the literal identifiers `SNAP-RACE-1`, `SNAP-RACE-2`, `SNAP-RACE`, and the looser forms `snap.?race`, `snapshot.*race`, `race.*snapshot`, `cutover.*race`, `race.*cutover` across:
- All `.md` files in `docs/`
- All `.ts`/`.tsx`/`.js`/`.mjs`/`.cjs` files in `src/` and `scripts/`
- All `.py`/`.sh`/`.ps1` files in `scripts/`
- All commit messages in the r1..r8 chain (`838f765..6a3dac4`)

### Search result

The identifiers `SNAP-RACE-1` and `SNAP-RACE-2` appear in EXACTLY ONE location in the entire repository:

```
docs/ui-ux/evidence/wp-08-01f/runs/r8-reviewer-correction/EVIDENCE.md:229
docs/ui-ux/evidence/wp-08-01f/runs/r8-reviewer-correction/EVIDENCE.md:242
```

These two lines are part of my OWN r8 evidence narrative, where I introduced the identifiers as informal labels to mean "the E2E/race gates that the prior session summary said were OPEN". The r8 commit message (`6a3dac4`) repeats the same informal labels.

The identifiers do NOT appear in:
- Any contract (`docs/contracts/*.md`)
- The decision log (`docs/02_decision_log_and_scope.md`)
- The execution plan (`docs/execution/01_glm_execution_plan.md`)
- The testing plan (`docs/contracts/12_testing_and_regression_plan.md`)
- The work package definition (`docs/contracts/13_work_packages.md` WP-08-01F)
- Any agent-ctx file
- Any prior commit message in the r1..r8 chain except my own r8 message
- Any existing test file name or test case name

The testing plan §11.2 ("Idempotency and Transaction Races") and §11.4 ("Migration Cutover and Capacity") DO define authoritative race-related requirements, but none of them use the identifier `SNAP-RACE-1` or `SNAP-RACE-2`. The authoritative identifiers in the existing test suite are:
- `COM-CONC-1` / `COM-CONC-2A` / `COM-CONC-2B` — concurrent commit atomicity
- `COM-REAL-RACE-1` / `COM-REAL-RACE-2` — commit vs replacement real production race
- `PG-ALIAS-CONC-1` / `PG-ALIAS-CONC-2` — concurrent alias exception

### Per-test required reporting

For each identifier, the reviewer's PHASE 2 instruction required the following report:

#### SNAP-RACE-1

| Field | Result |
|--------|--------|
| controlling file/path | **NONE FOUND** |
| exact requirement | **NONE FOUND** |
| affected service/command | **NONE FOUND** |
| required invariant | **NONE FOUND** |
| expected winner/loser behavior | **NONE FOUND** |
| existing implementation | **NONE FOUND** |
| existing tests | **NONE FOUND** |
| exact missing evidence | **NONE FOUND** |
| Verdict | **Unresolved / requires reviewer clarification** |

#### SNAP-RACE-2

| Field | Result |
|--------|--------|
| controlling file/path | **NONE FOUND** |
| exact requirement | **NONE FOUND** |
| affected service/command | **NONE FOUND** |
| required invariant | **NONE FOUND** |
| expected winner/loser behavior | **NONE FOUND** |
| existing implementation | **NONE FOUND** |
| existing tests | **NONE FOUND** |
| exact missing evidence | **NONE FOUND** |
| Verdict | **Unresolved / requires reviewer clarification** |

### Action taken (per reviewer's PHASE 2 instruction)

> "If either identifier has no authoritative definition in the repo, report:
> `Unresolved / requires reviewer clarification`
> and DO NOT invent a test contract."

NO race tests were invented under the identifiers `SNAP-RACE-1` or `SNAP-RACE-2`. NO test contract was fabricated. The honest action is to STOP and request reviewer clarification on what these identifiers are intended to refer to.

### Candidate authoritative sources the reviewer MAY have intended

For the reviewer's convenience, the authoritative race-related requirements that DO exist in the repository are listed below. If the reviewer confirms that `SNAP-RACE-1` / `SNAP-RACE-2` should map to one or more of these, r10 can implement the corresponding PostgreSQL concurrency proof.

1. **Testing plan §11.2 #1** — "Crash/connection loss after database commit but before response: retry discovers the unique committed effect and returns it without duplication."
2. **Testing plan §11.2 #2** — "Expired/orphaned `in_progress` lease can be atomically reclaimed; a live lease remains protected."
3. **Testing plan §11.4 #3** — "Migration commit versus concurrent live posting respects the cutover lock/boundary."
4. **Historical migration contract §645** — "Concurrent live posting in an affected cutover scope is blocked/serialized and cannot cross the approved boundary."
5. **Historical migration contract §647** — "Commit uses domain services, locks/idempotency/audit, and all-or-nothing behavior for supported size."

The existing test suite already covers:
- `COM-CONC-1` — concurrent commits on the same batch: exactly one wins, the other fails (lock conflict)
- `COM-CONC-2A` — concurrent commit vs target master deletion
- `COM-REAL-RACE-1` — commit wins before replacement (real production race, no test-only barriers)
- `COM-REAL-RACE-2` — replacement wins before commit (real production race)
- `PG-ALIAS-CONC-1/2` — concurrent alias exception disjoint/overlap

The reviewer should clarify whether `SNAP-RACE-1` / `SNAP-RACE-2` are intended to be:
(a) new identifiers for one of the §11.2/§11.4 race requirements above that are NOT yet covered by the existing `COM-CONC`/`COM-REAL-RACE`/`PG-ALIAS-CONC` tests; OR
(b) new identifiers for race requirements unique to `finalizeCutoverManifest` (the only manifest operation, which is the focus of the r7/r8 work and is the only place `cutover_manifest_hash` is mutated); OR
(c) aliases for the existing `COM-REAL-RACE-1` / `COM-REAL-RACE-2` tests, in which case no new tests are needed (just a name mapping in the evidence); OR
(d) something else entirely.

## R8 REGRESSION CONTRACT — PRESERVED

Per the reviewer's instruction:

> "The accepted r8 proofs MUST remain green:
>  MAN-REPLAY-1; MAN-TECH-1; MAN-TECH-ROLLBACK-1a; MAN-TECH-ROLLBACK-1b;
>  MAN-IDEMP-2; MAN-IDEMP-3; MAN-IDEMP-4; MAN-IDEMP-5.
>  Do not delete or weaken these to accommodate race work."

All 8 r8 tests remain in the test file unchanged in behavior. No r8 test was deleted, weakened, skipped, or rewritten to accommodate this checkpoint.

### Optional r8 hardening (reviewer-authorized, low-priority)

The reviewer explicitly authorized:

> "Optional minor hardening only if touching the r8 file already:
>  Replace the current approximate future-lease assertion:
>  `lease_expires_at > Date.now() - 1000`
>  with a more exact/stable proof if appropriate.
>  This is NOT itself a blocker and does not justify unrelated r8 rewriting."

The r8 file was touched to apply this hardening. Two assertions were strengthened:

**Before (approximate — accepted a lease already expired by up to 1 second):**
```typescript
expect(new Date(leaseExpiresAtAfterFailure).getTime()).toBeGreaterThan(Date.now() - 1000);
expect(new Date(leaseBeforeRetry[0]!.lease_expires_at).getTime()).toBeGreaterThan(Date.now() - 1000);
```

**After (exact — proves the lease is at least 1 second in the future relative to test start, with ~29s of clock-skew tolerance against the 30s lease duration):**
```typescript
const testStartMs = Date.now();   // captured at test entry, before any service call
// ... service call ...
expect(new Date(leaseExpiresAtAfterFailure).getTime()).toBeGreaterThan(testStartMs + 1000);
expect(new Date(leaseBeforeRetry[0]!.lease_expires_at).getTime()).toBeGreaterThan(testStartMs + 1000);
```

Why this is strictly stronger:
- The prior `> Date.now() - 1000` was evaluated at assertion time, AFTER the failure had been processed. It accepted any lease timestamp newer than "1 second ago at assertion time" — including a lease that had already expired by up to 1 second.
- The new `> testStartMs + 1000` is evaluated against a timestamp captured BEFORE the service call. With the production `leaseDurationMs = 30000`, the lease is set to `now + 30s` where `now` is captured inside `claimIdempotency` (very close to `testStartMs`). Asserting `> testStartMs + 1000` proves the lease is at least 1 second in the future relative to test start, leaving ~29 seconds of tolerance for Node ↔ PostgreSQL clock skew. This is a strictly tighter proof that the lease is unambiguously future-dated and never backdated.

The hardening applies to:
- `MAN-TECH-1` (1 assertion)
- `MAN-TECH-ROLLBACK-1a` and `MAN-TECH-ROLLBACK-1b` (shared `runRollbackTest` helper — 1 assertion, exercised by both tests)

No other r8 assertions were touched. The r8 tests still pass 8/8 (verified after hardening — see evidence below).

## R8 EVIDENCE CORRECTION

The r8 evidence narrative (`docs/ui-ux/evidence/wp-08-01f/runs/r8-reviewer-correction/EVIDENCE.md` lines 227–244) previously recorded:

> "E2E (`SNAP-E2E-1`) and race (`SNAP-RACE-1`, `SNAP-RACE-2`) gates remain OPEN."
> "2. E2E/race gates OPEN (SNAP-E2E-1, SNAP-RACE-1, SNAP-RACE-2)."

This was inaccurate: `SNAP-RACE-1` and `SNAP-RACE-2` are not authoritative repository identifiers, so they cannot be meaningfully marked OPEN or CLOSED. The accurate status is:

> `SNAP-RACE-1`: Unresolved / requires reviewer clarification (no authoritative definition in repository)
> `SNAP-RACE-2`: Unresolved / requires reviewer clarification (no authoritative definition in repository)

Per the reviewer's "REPORTING ACCURACY RULE":

> "distinguish attempted/uncommitted activity from published work;
>  do not claim a status is closed merely from comments or prose."

The r8 narrative's "OPEN" label was itself inaccurate prose, not a published test contract. r9 corrects this. The r8 narrative is NOT modified — it remains a historical record of what r8 claimed. r9 records the correction here.

## AGGREGATE HASH — OWNER DECISION

`UNRESOLVED_CUTOVER_MANIFEST_SET_HASH` remains an OWNER DECISION.

Status recorded exactly as:

> Unresolved / requires owner decision

No algorithm invented. No approval-fingerprint semantics changed. No implementation change authorized for this issue.

## E2E

`SNAP-E2E-1` is still separate from the SNAP-RACE work.

The `SNAP-E2E-1` identifier has the same provenance issue as `SNAP-RACE-1/2`: it does not appear in any contract, work package, testing plan, agent-ctx, or prior commit message except my own r8 narrative. It is reported here for completeness:

> `SNAP-E2E-1`: Unresolved / requires reviewer clarification (no authoritative definition in repository)

The browser/E2E gate additionally remains ENVIRONMENT BLOCKED because the three Supabase credentials are not available in this sandbox:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`

Per the reviewer's instruction:

> "If Supabase/browser credentials remain unavailable, report: `ENVIRONMENT BLOCKED` with the exact missing environment variables. Do not substitute PostgreSQL service tests, mocks, or local-only Playwright runs and call the E2E gate closed."

No substitution was made.

## TEST / REGRESSION GATE

### Focused r8 tests after hardening (8 tests)
**Command:**
```
DATABASE_URL='postgres://erp_yarn_user@127.0.0.1:5433/erp_yarn_wp0801f_disposable' \
ERP_ALLOW_DESTRUCTIVE_LOCAL_TEST_DB=1 \
ERP_REQUIRE_WP0801F_POSTGRES_PROOF=1 \
npx vitest run src/server/services/__tests__/wp-08-01f-postgres-manifest-r8.test.ts --reporter=verbose
```
**Exit code:** 0
**Result:** 8 passed (8) — 0 failed, 0 skipped
**Duration:** 5.33s (transform 402ms, tests 4.23s)
**Timestamp:** 2026-08-31 01:41:15 UTC
**PostgreSQL version:** 17.10 (Debian)
**DB identity:** `erp_yarn_wp0801f_disposable` (disposable; `__disposable_test_db_marker` row present)
**Destructive/disposable DB safety evidence:** `checkDestructiveTestDbSafety` returned `kind: "ok"` (DATABASE_URL set, `ERP_ALLOW_DESTRUCTIVE_LOCAL_TEST_DB=1`, `ERP_REQUIRE_WP0801F_POSTGRES_PROOF=1`)
**Fixture identity:** `RUN_ID = randomUUID()` per process; `T = RUN_ID` (per-run tenant); `U = randomUUID()` (per-run user); per-test `idemKey = "<prefix>-" + randomUUID()`.

Test names + durations (after hardening):
1. MAN-REPLAY-1 — 1001ms
2. MAN-TECH-1 — 447ms
3. MAN-TECH-ROLLBACK-1a — 521ms
4. MAN-TECH-ROLLBACK-1b — 443ms
5. MAN-IDEMP-2 — 343ms
6. MAN-IDEMP-3 — 407ms
7. MAN-IDEMP-4 — 395ms
8. MAN-IDEMP-5 — 466ms

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
**Timestamp:** 2026-08-31 01:43 UTC (estimated)

### TypeScript typecheck
**Command:** `npx tsc --noEmit`
**Exit code:** 0

### ESLint
**Command:** `npx eslint .`
**Exit code:** 0

### Whitespace/conflict check
**Command:** `git diff --check`
**Exit code:** 0

## Remaining Blockers

1. **SNAP-RACE-1** — `Unresolved / requires reviewer clarification`. No authoritative definition in repository. No test contract invented.
2. **SNAP-RACE-2** — `Unresolved / requires reviewer clarification`. No authoritative definition in repository. No test contract invented.
3. **SNAP-E2E-1** — `Unresolved / requires reviewer clarification` (same provenance issue as SNAP-RACE-1/2) AND `ENVIRONMENT BLOCKED` (Supabase credentials unavailable).
4. **UNRESOLVED_CUTOVER_MANIFEST_SET_HASH** — owner decision required.

## Checkpoint Classification

`incomplete_needs_fix`

The reviewer's PHASE 2 instruction was explicit and unambiguous: if `SNAP-RACE-1` or `SNAP-RACE-2` has no authoritative definition in the repo, report `Unresolved / requires reviewer clarification` and DO NOT invent a test contract. That is exactly what r9 does. No race tests were invented. The optional r8 future-lease hardening was applied because the reviewer explicitly authorized it. All r8 accepted proofs remain green (8/8). Full WP-08-01F gate remains green (1100/1100). tsc/eslint/diff-check all exit 0.

The `incomplete_needs_fix` label reflects that:
- SNAP-RACE-1/2 await reviewer clarification on what they are intended to refer to
- SNAP-E2E-1 awaits both reviewer clarification and Supabase credentials
- UNRESOLVED_CUTOVER_MANIFEST_SET_HASH awaits owner decision
