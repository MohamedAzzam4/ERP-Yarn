# WP-07-04 Dependency Correction — Contract 08 §12.4 Cutover Mutual Exclusion

**Checkpoint classification:** `incomplete_needs_fix`

**Date:** 2026-08-31 (Europe/Berlin)
**Branch:** `review/wp-08-01f-independent-fixes-r10`
**START_HEAD:** `43b91e491b912c56eb15f7f72355350f001ed624` (r9, reviewer-accepted)
**FINAL_HEAD:** (set after commit)
**Environment:**
- PostgreSQL 17.10 (Debian) on `127.0.0.1:5433`
- DB: `erp_yarn_wp0801f_disposable` (disposable; `__disposable_test_db_marker` row present)
- Node v24.19.0
- `DATABASE_URL=postgres://erp_yarn_user@127.0.0.1:5433/erp_yarn_wp0801f_disposable`
- `ERP_ALLOW_DESTRUCTIVE_LOCAL_TEST_DB=1`
- `ERP_REQUIRE_WP0801F_POSTGRES_PROOF=1`

## PHASE 0 — Remote Verification

| Item | Value |
|------|-------|
| Remote branch (r9) | `review/wp-08-01f-independent-fixes-r9` |
| Remote SHA (r9) | `43b91e491b912c56eb15f7f72355350f001ed624` (verified via GitHub API) |
| Local HEAD (after fetch) | `43b91e491b912c56eb15f7f72355350f001ed624` |
| Local HEAD match | YES |
| New branch (r10) | `review/wp-08-01f-independent-fixes-r10` |
| `git status --short` (before implementation) | clean |

## PHASE 1 — Governing Contracts Read

- `docs/contracts/08_historical_migration_contract.md` §8.1.1 (cutover lock prevents concurrent live postings), §8.10 (commit preconditions — affected live-write scopes locked/paused), §12.4 (concurrent live posting in affected cutover scope blocked/serialized)
- `docs/contracts/12_testing_and_regression_plan.md` §10 (Historical Migration regression row), §11.4 (Migration Cutover and Capacity), §13 (Acceptance)
- `docs/contracts/13_work_packages.md` WP-07-04 (Dual Approval/Commit), WP-07-05, WP-08-01F
- `docs/contracts/14_coding_agent_instructions.md` §4 (Business and Data Integrity Rules), §6 (Approval and Failure Rules), §11 (Required Tests)
- `docs/contracts/09_api_contracts.md` (high-risk test catalog)
- `docs/02_decision_log_and_scope.md` DEC-069, DEC-070, DEC-071, DEC-080, DEC-081

## Controlling Invariant (Authoritative)

**Contract 08 §8.1.1:** "During final validation and commit, an audited tenant/domain cutover lock prevents concurrent live postings in affected scopes. If the system cannot safely pause or serialize live writes, commit is blocked."

**Contract 08 §8.10:** "cutover manifest is approved and affected live-write scopes are locked/paused."

**Contract 08 §12.4:** "Concurrent live posting in an affected cutover scope is blocked/serialized and cannot cross the approved boundary."

**Contract 12 §11.4:** "Migration commit versus concurrent live posting must respect the cutover lock/boundary."

## PHASE 2 — Current Implementation Audit

### Audit method

Inspected `HistoricalCommitService`, `HistoricalCommitRepository`, `HistoricalCommitDbRepository`, `import_cutover_locks` schema and migration SQL, all current cutover-lock tests, `InventoryLedgerService`, `InventoryLedgerDbRepository`, `SubledgerService`, `SubledgerDbRepository`, raw-receipt approval path, sales approval path, production issue/receipt paths, customer return path, payments/settlement paths.

### Audit findings

1. **How the migration commit acquires its cutover lock:** `HistoricalCommitService.commitBatch` loops over `CUTOVER_LOCK_SCOPES = ["batch", "inventory", "subledger"]` and for each scope calls `findActiveCutoverLockByScope` + `insertCutoverLock` on the **non-tx** repository (outside the operational transaction). A unique partial index `(tenant_id, import_batch_id, lock_scope) WHERE released_at IS NULL` prevents concurrent commits on the same batch.

2. **Lock key/granularity:** `(tenant_id, import_batch_id, lock_scope)` — **batch-scoped**. The `lockScope` column carries a domain label but `import_batch_id` is part of the unique key.

3. **Batch-scoped, tenant-scoped, domain-scoped, or row-scoped?** Batch-scoped. The unique partial index includes `import_batch_id`, so the same tenant+domain can be locked independently by different batches.

4. **Can two different migration batches acquire active locks for the same tenant/domain?** **YES** — because `import_batch_id` is part of the unique key. Batch B for the same tenant+inventory domain can acquire its own active lock even when batch A already holds one. **This is a gap.**

5. **Whether normal live operational posting participates in the SAME concurrency primitive:** **NO.** Zero live posting services reference `importCutoverLocks`, `findActiveCutoverLock`, `cutoverLock`, or any equivalent. Grep across `inventory-ledger-service.ts`, `subledger-service.ts`, `production-posting-service.ts`, `approval-service.ts`, `sales-order-service.ts`, `payment-service.ts`, `raw-receipt-approval-service.ts` returned **zero matches** outside the historical-commit module.

6. **Check-then-write vs. atomic participation:** Live paths do not even check — they simply write. The migration's lock acquisition is a check-then-insert on the non-tx repository, but since live paths never consult the table, there is no mutual exclusion whatsoever.

7. **TOCTOU race (live-check-then-write vs. migration-acquires-lock):** **YES — trivially exists.** A live posting path that DID check would still race the migration's lock acquisition.

8. **Opposite race (live-posting-begins → migration-cutover-begins → both cross boundary):** **YES — exists.** Migration acquires its lock outside its operational transaction. A live posting that has already begun its own transaction can commit while the migration's lock acquisition is in flight.

9. **Central enforcement point:** **NONE.** `InventoryLedgerService` and `SubledgerService` constructors take deps with only `ledger`, `audit`, `idempotency`, `documentSequence` handles. No `cutoverCoordination` handle. Every caller wires the services independently.

10. **Client-controlled bypass flag:** None found. But the absence of central enforcement means *the absence of a check* is the equivalent of a bypass.

### Audit verdict

**The reviewer's suspicion is CORRECT.** The existing `import_cutover_locks` table is a **batch-scoped advisory lock that prevents only concurrent historical commits on the same batch**. It does NOT satisfy Contract 08 §8.1.1, §8.10, or §12.4 because:
- It does not block live operational posting in the same tenant/domain.
- It does not block a second migration batch in the same tenant/domain.
- It has a TOCTOU window even if live paths were retrofitted with a check.

## PHASE 3 — Coordination Architecture

### Architecture chosen

**PostgreSQL transaction-scoped advisory lock** (`pg_advisory_xact_lock(int4, int4)`) keyed by `(namespace, hash(tenant_id, domain))`, acquired INSIDE the operational transaction.

### Why this architecture

| Property | How it's satisfied |
|----------|-------------------|
| Correct granularity (tenant/domain) | Lock key = `hash(tenantId, domain)` — independent tenants and unaffected domains remain independent. No global lock. |
| No check-then-write TOCTOU | `pg_advisory_xact_lock` is an atomic blocking call — the lock acquisition IS the synchronization point. There is no "check" step. |
| Central enforcement | Added `lockCutoverScope(tenantId, domain)` to `InventoryLedgerTransactionHandle` and `SubledgerTransactionHandle`. Every live posting method on `InventoryLedgerService` and `SubledgerService` calls `requireCutoverLock(tenantId)` at the start of its execute path (after idempotency claim, before any business write). A new UI/API path that constructs these services cannot bypass cutover safety because the lock is acquired inside the domain service, not by the caller. |
| Historical commit must still work (no self-block) | `pg_advisory_xact_lock` is **re-entrant within the same transaction**. The migration acquires the lock at the start of its transaction; the subsequent `postOpeningBalanceMovement` / `postOpeningBalanceEntry` calls re-acquire (no-op). No client-supplied `bypassCutover` flag. |
| Failure/recovery | Transaction-scoped — auto-released on COMMIT or ROLLBACK. Zero recovery code. A technical failure that rolls back the transaction automatically releases the lock. |
| Audit | The existing `import_cutover_locks` table is RETAINED as durable audit evidence (Contract 08 §8.10 audit requirement). The advisory lock provides mutual exclusion; the table row provides the audited proof. |

### Coordination key

- `CUTOVER_LOCK_NAMESPACE = 0x57a704e1` (stable 32-bit constant)
- `computeCutoverLockKey(tenantId, domain)` = FNV-1a 32-bit hash of `${tenantId}|${domain}`
- `CUTOVER_DOMAINS = ["inventory", "subledger"]` (the two MVP live-write domains)

### Why no TOCTOU gap

The design is equivalent to:
```
BEGIN;
SELECT pg_advisory_xact_lock(namespace, hash(tenant, domain)); -- blocks here
-- ... business writes ...
COMMIT; -- lock auto-released
```

There is no "check" step — the lock acquisition is the synchronization point. If the migration holds the lock, a live post's `pg_advisory_xact_lock` call blocks until the migration commits or rolls back. If the live post holds the lock, the migration's `pg_advisory_xact_lock` call blocks until the live post commits or rolls back. Neither can proceed across the boundary while the other holds the lock.

### Why it's tenant/domain-safe

- Two different tenants: different `tenantId` → different hash → different advisory lock key → independent.
- Same tenant, different domains (inventory vs. subledger): different `domain` → different hash → different advisory lock key → independent.
- Same tenant, same domain, different batches: SAME hash → SAME advisory lock key → **mutual exclusion** (batch B blocks until batch A commits/rolls back). This closes the gap in the batch-scoped table lock.

## PHASE 3 — Implementation

### New file: `src/server/services/cutover-coordination.ts`

Exports:
- `CUTOVER_LOCK_NAMESPACE = 0x57a704e1`
- `CUTOVER_DOMAINS = ["inventory", "subledger"]`
- `computeCutoverLockKey(tenantId, domain)` — FNV-1a 32-bit hash
- `assertCutoverDomain(domain)` — fail-closed on unsupported domains

### Modified: `src/server/services/inventory-ledger-service.ts`

- Added `lockCutoverScope(tenantId, domain)` to `InventoryLedgerTransactionHandle` interface.
- Added `requireCutoverLock(tenantId)` private→public helper method on `InventoryLedgerService`.
- Added `await this.requireCutoverLock(tenantId)` to 9 live posting methods: `postRawReceipt`, `postTransfer`, `postAdjustment`, `postBlockUnblock`, `postReturnReceipt` (via `postSingleLocationMovement`), `postIssueToProduction`, `postReversal`, `postProductionWaste`, `postReturnFromWip`, `postSaleIssue`, `postOpeningBalanceMovement` (defense-in-depth for the migration's own path).

### Modified: `src/server/services/subledger-service.ts`

- Added `lockCutoverScope(tenantId, domain)` to `SubledgerTransactionHandle` interface.
- Added `requireCutoverLock(tenantId)` public helper method on `SubledgerService`.
- Added `await this.requireCutoverLock(tenantId)` to 7 live posting methods: `postSupplierPayable`, `postFactoryPayable`, `postPaymentEntry`, `postReversalEntry`, `postDirectCostEntry`, `postReturnCreditEntry`, `postOpeningBalanceEntry` (defense-in-depth for the migration's own path).

### Modified: `src/server/services/inventory-ledger-db-repository.ts`

- Implemented `lockCutoverScope`: `SELECT pg_advisory_xact_lock(namespace, hash)`.

### Modified: `src/server/services/subledger-db-repository.ts`

- Implemented `lockCutoverScope`: `SELECT pg_advisory_xact_lock(namespace, hash)`.

### Modified: `src/server/services/historical-commit-service.ts`

- Added advisory lock acquisition INSIDE the migration's operational transaction, BEFORE `executePosting`:
  ```ts
  await txInvLedger.requireCutoverLock(user.tenantId);
  await txSubledger.requireCutoverLock(user.tenantId);
  ```
- The migration's subsequent `postOpeningBalanceMovement` / `postOpeningBalanceEntry` calls re-acquire the same locks (re-entrant — no-op).
- The existing `import_cutover_locks` table-based lock is RETAINED as durable audit evidence.

### Modified: in-memory test stores

Added no-op `lockCutoverScope` implementations to:
- `in-memory-inventory-ledger-repository.ts`
- `in-memory-subledger-repository.ts`
- `transactional-test-store.ts`
- `transactional-subledger-test-store.ts`
- `raw-receipt-approval-service.test.ts` (mock handles)
- `inventory-ledger-service.test.ts` (tracked ledger wrapper)
- `subledger-service.test.ts` (tracked subledger wrapper)

### Modified: test mocks that return `{} as any` for `createInventoryLedger`/`createSubledger`

Updated to `({ requireCutoverLock: async () => {} } as any)` in 10 test files:
- `wp-08-01f-postgres-commit-atomicity.test.ts`
- `wp-08-01f-postgres-submission-atomicity.test.ts`
- `wp-08-01f-postgres-alias-atomicity.test.ts`
- `wp-08-01f-postgres-zero-effect.test.ts`
- `wp-08-01f-postgres-alias-application.test.ts` (also added `requireCutoverLock` to the custom subledger mock)
- `wp-08-01f-postgres-phase0-closing-proofs.test.ts`
- `wp-08-01f-postgres-happy-path.test.ts`
- `wp-08-01f-migration-boundary.test.ts`
- `wp-08-01f-reachable-workflow.test.ts`
- `wp-08-01f-lifecycle-guards.test.ts`

### No schema migration needed

The advisory lock uses PostgreSQL's built-in `pg_advisory_xact_lock` function — no schema changes, no new tables, no new indexes. The existing `import_cutover_locks` table is unchanged.

## Affected Live Posting Entry Points

Every live posting path that writes inventory or subledger effects now participates in the cutover coordination:

### InventoryLedgerService (10 methods)
- `postRawReceipt` — raw material receipt
- `postTransfer` — stock transfer between locations
- `postAdjustment` — stock adjustment/correction
- `postBlockUnblock` — stock block/unblock
- `postReturnReceipt` (via `postSingleLocationMovement`) — return receipt
- `postIssueToProduction` — issue to production
- `postReversal` — movement reversal
- `postReceiveFromProduction` (via `postSingleLocationMovement`) — production receipt
- `postProductionWaste` — production waste
- `postReturnFromWip` — return from WIP
- `postSaleIssue` — sale issue
- `postOpeningBalanceMovement` — migration opening balance (defense-in-depth; re-entrant)

### SubledgerService (7 methods)
- `postSupplierPayable` — supplier payable
- `postFactoryPayable` — factory payable
- `postPaymentEntry` — payment entry
- `postReversalEntry` — reversal entry
- `postDirectCostEntry` — direct cost entry
- `postReturnCreditEntry` — return credit entry
- `postOpeningBalanceEntry` — migration opening balance (defense-in-depth; re-entrant)

### Proof each affected path is protected

Every method listed above calls `await this.requireCutoverLock(tenantId)` AFTER the idempotency claim is granted (so replay does not block) and BEFORE any business write (so the lock is held before any operational effect). The `requireCutoverLock` method delegates to `this.deps.ledger.lockCutoverScope(tenantId, "inventory")` (or `"subledger"`), which executes `SELECT pg_advisory_xact_lock(namespace, hash)` on the current transaction. This is central enforcement — no caller can bypass it because the lock is acquired inside the domain service, not by the caller.

## PHASE 4 — Real PostgreSQL Race Proofs

### New test file: `src/server/services/__tests__/wp-07-04-cutover-race.test.ts`

6 real PostgreSQL concurrency tests using actual overlap on independent connections:

#### CUTVER-RACE-A — migration owns inventory cutover first, live post blocked

1. Acquire the inventory cutover advisory lock on a held-open transaction (simulating migration holding it).
2. Issue a REAL `InventoryLedgerService.postRawReceipt` on a separate connection with `statement_timeout = 2000`.
3. The live post MUST block → time out.
4. Assert NO partial business effect (zero stock_movements, zero inventory_balances).
5. Release the held lock.
6. Retry with a fresh idempotency key — MUST succeed immediately.
7. Assert exactly one stock_movement, one inventory_balance, idempotency = succeeded.

**Result:** PASS

#### CUTVER-RACE-B — live posting starts first, migration serialized/blocked

1. Acquire the inventory cutover advisory lock (simulating a live post holding it).
2. On a separate connection, attempt the migration's `pg_advisory_xact_lock` with `statement_timeout = 2000`.
3. The migration's lock acquisition MUST block → time out.
4. Assert the migration did NOT commit (no business effects).
5. Release the held lock.
6. Retry the migration's lock acquisition — MUST succeed immediately.

**Result:** PASS

#### CUTVER-RACE-C — subledger/account scope mutual exclusion

Same as RACE-A but for the "subledger" domain using `SubledgerService.postSupplierPayable`.

**Result:** PASS

#### CUTVER-RACE-D — unrelated scope remains available

1. Acquire the inventory cutover advisory lock for tenant T.
2. Issue a live `postRawReceipt` for a DIFFERENT tenant T2 — MUST succeed immediately (cross-tenant isolation).
3. Issue a live `postSupplierPayable` for tenant T (different domain) — MUST succeed immediately (cross-domain isolation).

**Result:** PASS

#### CUTVER-RACE-E — two migration batches same tenant/domain

1. Batch A acquires the inventory cutover advisory lock.
2. Batch B (same tenant, same domain) tries to acquire the same lock with `statement_timeout = 2000`.
3. Batch B MUST block → time out (the advisory lock is tenant/domain-scoped, not batch-scoped).
4. Release batch A's lock.
5. Batch B retry — MUST succeed immediately.

**Result:** PASS

#### CUTVER-RACE-F — technical failure after cutover acquired, safe release/recovery

1. Acquire the inventory cutover advisory lock inside a transaction.
2. ROLLBACK the transaction (simulating a technical failure).
3. Verify the lock is no longer held (`pg_locks` query returns 0 rows).
4. Immediately attempt a live `postRawReceipt` with `statement_timeout = 3000` — MUST succeed (proving the lock was auto-released on rollback).
5. Assert exactly one stock_movement, one inventory_balance, idempotency = succeeded.

**Result:** PASS

### Concurrency mechanism

- Real PostgreSQL transactions on independent `postgres()` connections (NOT the shared pool).
- Deterministic barrier: a held-open transaction that acquires `pg_advisory_xact_lock` and holds it until the test releases it. This is NOT a mock — it is a real advisory lock on a real PostgreSQL connection.
- The live posting is issued on a SECOND independent connection while the first holds the lock. The live posting MUST block on the real advisory lock.
- A short `statement_timeout` (2000ms) on the live-posting connection converts the block into a deterministic error that the test asserts on, without arbitrary sleeps.
- After the held transaction commits/rolls back, the live posting is retried and MUST succeed immediately (proving the lock was released).

## Test / Regression Gate

### Focused cutover race tests (6 tests)
**Command:** `npx vitest run src/server/services/__tests__/wp-07-04-cutover-race.test.ts --reporter=verbose`
**Exit code:** 0
**Result:** 6 passed (6) — 0 failed, 0 skipped
**Duration:** 15.72s

### Full WP-08-01F gate + cutover race (46 files, 1106 tests)
**Command:** `npx vitest run $(find src -name "wp-08-01f-*test*.ts" ...) src/server/services/__tests__/wp-07-04-cutover-race.test.ts --reporter=dot`
**Exit code:** 0
**Result:** 1106 passed (1106) — 0 failed, 0 skipped
**Duration:** 234.71s

### Broader regression (24 files, 568 tests)
**Command:** `npx vitest run src/server/services/__tests__/service-level-atomicity.test.ts src/server/services/__tests__/inventory-ledger-service.test.ts src/server/services/__tests__/subledger-service.test.ts src/server/services/__tests__/raw-receipt-approval-service.test.ts src/server/services/__tests__/sales-approval-service.test.ts src/server/services/__tests__/sales-submission-service.test.ts src/server/services/__tests__/production-receipt-approval-service.test.ts src/server/services/__tests__/return-request-service.test.ts src/server/services/__tests__/sales-failure-resolution-service.test.ts src/server/services/__tests__/payment-service.test.ts src/server/services/__tests__/historical-commit-service.test.ts $(find src -name "wp-08-01e-*test*.ts" ...) --reporter=dot`
**Exit code:** 0
**Result:** 566 passed, 2 skipped (568) — 0 failed
**Duration:** 24.53s

### TypeScript typecheck
**Command:** `npx tsc --noEmit`
**Exit code:** 0

### ESLint
**Command:** `npx eslint .`
**Exit code:** 0

### Whitespace/conflict check
**Command:** `git diff --check`
**Exit code:** 0

## R8 Regression Contract — Preserved

All 8 accepted r8 proofs remain green:
- MAN-REPLAY-1 ✓
- MAN-TECH-1 ✓ (with r9 future-lease hardening)
- MAN-TECH-ROLLBACK-1a ✓
- MAN-TECH-ROLLBACK-1b ✓
- MAN-IDEMP-2 ✓
- MAN-IDEMP-3 ✓
- MAN-IDEMP-4 ✓
- MAN-IDEMP-5 ✓

## Aggregate Hash — Owner Decision

`UNRESOLVED_CUTOVER_MANIFEST_SET_HASH` remains:

> Unresolved / requires owner decision

No algorithm invented. No approval-fingerprint semantics changed. The cutover-lock correction does NOT invent an aggregate manifest hash.

## Browser/UI Package Status

Using authoritative names only (per reviewer instruction — `SNAP-E2E-1` is retired):

- WP-08-01F Tests/Acceptance: Provenance/warnings/dual approval/lock/redaction, desktop/tablet/phone summary, a11y/RTL — **ENVIRONMENT BLOCKED** (Supabase credentials unavailable: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`).
- Contract 10 §9 Historical Migration Screens: **ENVIRONMENT BLOCKED** (same).
- Contract 10 §12 Cross-Screen Acceptance: **ENVIRONMENT BLOCKED** (same).
- Contract 12 package/browser/smoke requirements: **ENVIRONMENT BLOCKED** (same).

No substitution made (no PostgreSQL service tests, mocks, or local-only Playwright runs were used to claim the browser gate closed).

## Remaining Blockers

1. **UNRESOLVED_CUTOVER_MANIFEST_SET_HASH** — owner decision required.
2. **Browser/UI gate** — ENVIRONMENT BLOCKED on three Supabase credentials.

## Checkpoint Classification

`incomplete_needs_fix`

Contract 08 §12.4 is now PROVEN by real PostgreSQL concurrency tests (CUTVER-RACE-A through CUTVER-RACE-F). The cutover mutual exclusion between historical migration commit and live operational posting is implemented at the DB level using `pg_advisory_xact_lock` with central enforcement in `InventoryLedgerService` and `SubledgerService`. The `incomplete_needs_fix` label reflects that the aggregate-hash and browser/UI gates remain open.
