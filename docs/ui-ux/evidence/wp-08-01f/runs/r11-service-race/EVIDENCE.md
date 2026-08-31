# WP-07-04 r11 — Service-Level Cutover Race + Transaction-Lifetime Audit

**Checkpoint classification:** `incomplete_needs_fix`

**Date:** 2026-08-31 (Europe/Berlin)
**Branch:** `review/wp-08-01f-independent-fixes-r11`
**START_HEAD:** `a84cf97aa31dc59549b23ccffd1dfb8566f54c03` (r10)
**Environment:**
- PostgreSQL 17.10 (Debian) on `127.0.0.1:5433`
- DB: `erp_yarn_wp0801f_disposable` (disposable; `__disposable_test_db_marker` row present)
- Node v24.19.0

## PHASE 0 — Remote Verification

| Item | Value |
|------|-------|
| Remote branch (r10) | `review/wp-08-01f-independent-fixes-r10` |
| Remote SHA (r10) | `a84cf97aa31dc59549b23ccffd1dfb8566f54c03` (verified via git fetch) |
| Local HEAD (after fetch) | `a84cf97aa31dc59549b23ccffd1dfb8566f54c03` |
| New branch (r11) | `review/wp-08-01f-independent-fixes-r11` |
| `git status --short` (before implementation) | clean |

## BLOCKER 1 — Complete Live-Post Transaction Audit Table

### Inventory domain

| Command | top-level service | domain method(s) | explicit transactionRunner? | tx-scoped repos? | same DB tx spans cutover lock + all writes? | production wiring proven? | status |
|---------|-------------------|-------------------|-----------------------------|-------------------|---------------------------------------------|---------------------------|--------|
| raw receipt approval | RawReceiptApprovalService | postRawReceipt (via InventoryLedgerService) | YES | YES (createInventoryLedger, createSubledger, createApprovalRepository) | YES | YES (actions.ts) | OK (already correct) |
| sale approval / sale issue | SalesApprovalService | postSaleIssue (via InventoryLedgerService) | YES | YES | YES | YES | OK |
| sales submission | SalesSubmissionService | findBalanceForUpdate, updateReservedQty | YES | YES | YES | YES | OK |
| sales failure resolution | SalesFailureResolutionService | various | YES | YES | YES | YES | OK |
| production receipt | ProductionReceiptApprovalService | postReceiveFromProduction, postProductionWaste (via InventoryLedgerService) | YES | YES | YES | YES | OK |
| production issue | ProductionIssueService | postIssueToProduction (via InventoryLedgerService) | YES | YES | YES | YES | OK |
| customer return | ReturnRequestService | postReturnReceipt, postReturnCreditEntry (via InventoryLedgerService + SubledgerService) | YES | YES | YES | YES | OK |
| historical correction | HistoricalCorrectionService + ProductionCorrectionDomainHook | postReversalEntry, postOpeningBalanceMovement/Entry (via tx-scoped factories) | YES | YES | YES | YES | OK |

### Subledger domain

| Command | top-level service | domain method(s) | explicit transactionRunner? | tx-scoped repos? | same DB tx spans cutover lock + all writes? | production wiring proven? | status |
|---------|-------------------|-------------------|-----------------------------|-------------------|---------------------------------------------|---------------------------|--------|
| supplier payable | RawReceiptApprovalService | postSupplierPayable (via SubledgerService) | YES | YES | YES | YES | OK |
| factory payable | ProductionReceiptApprovalService | postFactoryPayable (via SubledgerService) | YES | YES | YES | YES | OK |
| **payment post** | **PaymentService** | **postPaymentEntry** (via SubledgerService), updatePaymentStatus, audit, markSucceeded | **NO (r10 defect)** | **NO** | **NO — lock released before payment status update** | **NO — actions.ts called `void makeTransactionRunner()`** | **FIXED in r11** |
| **payment reversal** | **PaymentReversalService** | **postReversalEntry** (via SubledgerService), updatePaymentStatus, audit, markSucceeded | **NO (r10 defect)** | **NO** | **NO** | **NO** | **FIXED in r11** |
| **settlement** | **SettlementService** | **updateEntrySettlementStatusPublic** (via SubledgerService), insertSettlement, audit, markSucceeded | **NO (r10 defect)** | **NO** | **NO** | **NO** | **FIXED in r11** |
| **direct cost review** | **DirectCostService** | **postDirectCostEntry** (via SubledgerService), updateDirectCostReview, insertAllocation, audit, markSucceeded | **NO (r10 defect)** | **NO** | **NO** | **NO** | **FIXED in r11** |
| historical correction | HistoricalCorrectionService + ProductionCorrectionDomainHook | postReversalEntry (via tx-scoped SubledgerService) | YES | YES | YES | YES | OK |

### PaymentService transaction conclusion

**r10 defect (confirmed):** `PaymentServiceDeps` had NO `transactionRunner` and NO `txFactories`. The production wiring in `actions.ts` called `void makeTransactionRunner()` and `void makeTxFactories(...)` — the transaction runner was built but DISCARDED. `PaymentService.postPayment()` called `SubledgerService.postPaymentEntry()` (which acquires the cutover advisory lock in its own auto-commit transaction), then `paymentRepository.updatePaymentStatus()`, then `appendAuditLog()`, then `markSucceeded()` — each on separate root-level (non-tx) handles. The cutover lock was released as soon as `postPaymentEntry`'s auto-commit transaction completed, BEFORE the payment status was updated.

**r11 fix:** Added `transactionRunner?: PaymentTransactionRunner` and `txFactories?: PaymentTransactionScopedFactories` to `PaymentServiceDeps`. Refactored `postPayment` to wrap steps 6-9 (allocate doc no, create account entry, update payment status, audit, markSucceeded) in a single `transactionRunner(async (tx) => { ... })` with tx-scoped handles. Added a catch block that calls `markRetryableFailed` on technical failure (BLOCKER 4). Updated the production wiring in `actions.ts` to pass the transactionRunner + txFactories.

The same fix was applied to `PaymentReversalService`, `SettlementService`, and `DirectCostService`.

## BLOCKER 3 — Affected-Domain Authoritative Source

**Authoritative source:** The staging row content determines which domain(s) a batch affects. This matches the posting dispatch logic in `HistoricalCommitService.executePosting`:
- A row with `data.quantity != null` affects the **inventory** domain (dispatches to `postOpeningBalanceMovement`).
- A row with `entityType includes customer/supplier/factory` + `data.balance != null` affects the **subledger** domain (dispatches to `postOpeningBalanceEntry`).

**r10 defect:** The commit unconditionally called `txInvLedger.requireCutoverLock(user.tenantId)` AND `txSubledger.requireCutoverLock(user.tenantId)` — locking BOTH domains even when the batch only affects one.

**r11 fix:** The commit now scans the staging rows INSIDE the transaction (before `executePosting`) to determine `affectsInventory` and `affectsSubledger`, and only acquires the advisory lock for the affected domain(s). An inventory-only batch does NOT unnecessarily block subledger live activity, and vice versa.

## BLOCKER 4 — Lock-Wait Technical Failure + Idempotency

**r10 defect:** When a cutover-wait statement_timeout occurred in a lower-level domain service (e.g. `SubledgerService.postPaymentEntry`), the idempotency record was left `in_progress` because the top-level command had no catch block to call `markRetryableFailed`.

**r11 fix:** Added a catch block to `PaymentService.postPayment`, `PaymentReversalService.reversePayment`, `SettlementService.settlePayment`, and `DirectCostService.reviewDirectCost` that:
1. Catches technical failures (including cutover lock wait timeouts).
2. Calls `markRetryableFailed(this.deps.idempotency, claim.record.id, ...)` to terminalize the idempotency record.
3. Re-throws the error.

This enables immediate same-key retry (the `retryable_failed` state is reclaimable without waiting for lease expiry, per the DB predicate `state = 'retryable_failed' OR ...`).

The existing services that already had this pattern (`RawReceiptApprovalService`, `HistoricalCommitService` via r8) are unchanged.

## BLOCKER 2 — Real Application-Level Service Race Tests

### New test file: `src/server/services/__tests__/wp-07-04-service-race.test.ts`

5 real PostgreSQL service-level race tests using actual `HistoricalCommitService.commitBatch()` and real live commands:

#### SVC-RACE-1 — actual historical commit first, real live inventory post blocked
- Real `HistoricalCommitService.commitBatch()` with a barrier-wrapped `InventoryLedgerService` that pauses after `requireCutoverLock` is acquired (on the real transaction) but before `executePosting` continues.
- While the commit is paused, issue a REAL `InventoryLedgerService.postRawReceipt` on a separate connection with `statement_timeout = 2000`.
- **Proved:** live post blocked (statement timeout), zero partial effects (zero stock_movements, zero inventory_balances), commit completed correctly after barrier release, live post retry succeeded immediately, durable final state correct (2 movements total — 1 commit + 1 live), idempotency succeeded.
- **Result:** PASS (5.4s)

#### SVC-RACE-2 — actual live inventory post first, real historical commit blocked
- Real `InventoryLedgerService.postRawReceipt` inside a held-open `db.transaction()` with a barrier-wrapped `requireCutoverLock`.
- While the live post is paused, issue a REAL `HistoricalCommitService.commitBatch()` for the same tenant/inventory domain.
- **Proved:** commit blocked (did not complete within 3s), zero commit movements, live post completed correctly after barrier release, commit completed after live post, durable final state correct (2 movements), boundary semantics respected.
- **Result:** PASS (3.7s)

#### SVC-RACE-3 — actual payment post vs actual party-opening historical commit
- Real `HistoricalCommitService.commitBatch()` with a barrier-wrapped `SubledgerService` (barrierDomain="subledger") that pauses after the subledger cutover lock is acquired.
- While the commit is paused, issue a REAL `PaymentService.postPayment()` on a separate connection.
- **Proved:** payment post blocked (statement timeout on advisory lock), zero partial payment effects (payment still draft, zero payment account_entries), commit completed after barrier release, payment retry succeeded, durable final state correct.
- **Result:** PASS (4.1s)

#### SVC-RACE-4 — two actual historical commits for same tenant/domain
- Two real `HistoricalCommitService.commitBatch()` calls for two different batches in the same tenant/inventory domain.
- Commit A has a barrier-wrapped `InventoryLedgerService` that pauses after the cutover lock is acquired.
- While commit A is paused, start commit B.
- **Proved:** commit B blocked (did not complete within 3s), zero commit B movements, commit A completed after barrier release, commit B completed after commit A released the lock, durable final state correct (2 movements — 1 per batch).
- **Result:** PASS (5.0s)

#### SVC-RACE-5 — actual technical failure/recovery inside real commit transaction
- Real `HistoricalCommitService.commitBatch()` with a barrier-wrapped `InventoryLedgerService` that pauses after the cutover lock, then throws `INJECTED_FAILURE_AFTER_CUTOVER_LOCK`.
- **Proved:** commit transaction rolled back (zero movements), advisory lock auto-released (live post succeeded immediately after), batch NOT committed, idempotency terminalized as retryable_failed, real live post not permanently blocked, retry succeeded.
- **Result:** PASS (1.9s)

### Concurrency synchronization mechanism (test barrier)

The test barrier wraps the real tx-scoped `InventoryLedgerService` / `SubledgerService` factory:
1. The wrapper delegates to the real `requireCutoverLock` (acquires the real advisory lock on the real transaction connection).
2. After the lock is actually acquired, it signals `lockAcquired` (sets a flag).
3. It awaits `releaseBarrier` (a promise that the test resolves when ready).
4. After release, the production service continues with its real writes.

The barrier fires ONLY ONCE (using a `barrierFired` flag) to avoid blocking on re-entrant calls from `postOpeningBalanceMovement` / `postOpeningBalanceEntry`.

This proves real transaction lifetime without arbitrary sleep-only tests. No test-only flags are added to production business policy — the barrier is in the test's factory wrapper, not in the production service.

## R10 Primitive Tests — Relabeled

The r10 `CUTVER-RACE-A..F` tests in `wp-07-04-cutover-race.test.ts` are RETAINED but honestly relabeled as **PRIMITIVE advisory-lock tests**. Their header comment now explicitly states:
- They prove the PostgreSQL advisory-lock primitive (transaction-scoped, re-entrant, atomic, tenant/domain-scoped, auto-released).
- They do NOT use the real `HistoricalCommitService` or real live posting commands.
- Only the SVC-RACE tests can close Contract 08 §12.4.

## Test / Regression Gate

### Focused service-race tests (5 tests)
**Command:** `npx vitest run src/server/services/__tests__/wp-07-04-service-race.test.ts --reporter=verbose`
**Exit code:** 0
**Result:** 5 passed (5) — 0 failed, 0 skipped
**Duration:** 21.68s

### Focused primitive race tests (6 tests)
**Command:** `npx vitest run src/server/services/__tests__/wp-07-04-cutover-race.test.ts --reporter=verbose`
**Exit code:** 0
**Result:** 6 passed (6) — 0 failed, 0 skipped
**Duration:** 16.50s

### Full WP-08-01F gate + both race test files (47 files, 1111 tests)
**Command:** `npx vitest run $(find src -name "wp-08-01f-*test*.ts" ...) wp-07-04-cutover-race.test.ts wp-07-04-service-race.test.ts --no-file-parallelism --reporter=dot`
**Exit code:** 0
**Result:** 1111 passed (1111) — 0 failed, 0 skipped
**Duration:** 223.14s

### Broader regression (23 files, 535 tests)
**Command:** `npx vitest run service-level-atomicity + payment + payment-reversal + settlement + direct-cost + inventory-ledger + subledger + raw-receipt + sales-approval + production-receipt + return-request + historical-commit + WP-08-01E --no-file-parallelism --reporter=dot`
**Exit code:** 0
**Result:** 533 passed, 2 skipped (535) — 0 failed
**Duration:** 22.15s

### TypeScript typecheck
**Command:** `npx tsc --noEmit`
**Exit code:** 0

### ESLint
**Command:** `npx eslint .`
**Exit code:** 0

### Whitespace/conflict check
**Command:** `git diff --check`
**Exit code:** 0

## R8/R10 Regression Contract — Preserved

All accepted r8 proofs remain green: MAN-REPLAY-1, MAN-TECH-1, MAN-TECH-ROLLBACK-1a/1b, MAN-IDEMP-2..5.
All r10 primitive race tests remain green: CUTVER-RACE-A..F.

## Aggregate Hash — Owner Decision

`UNRESOLVED_CUTOVER_MANIFEST_SET_HASH` — **Unresolved / requires owner decision**

## Browser/UI Package Status

Using authoritative names only (SNAP-E2E-1 retired):
- WP-08-01F Tests/Acceptance, Contract 10 §9, §12, Contract 12 package/browser/smoke — all **ENVIRONMENT BLOCKED** on three Supabase credentials (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`).

## Remaining Blockers

1. `UNRESOLVED_CUTOVER_MANIFEST_SET_HASH` — owner decision required.
2. Browser/UI gate — ENVIRONMENT BLOCKED on Supabase credentials.

## Checkpoint Classification

`incomplete_needs_fix`

Contract 08 §12.4 is now PROVEN by real application-level service race tests (SVC-RACE-1 through SVC-RACE-5) using real `HistoricalCommitService.commitBatch()` against real live commands. The transaction-lifetime audit identified and fixed defects in `PaymentService`, `PaymentReversalService`, `SettlementService`, and `DirectCostService` (missing `transactionRunner` + `txFactories`). The affected-domain locking was corrected to only lock domains the batch actually affects. Lock-wait technical failures are now terminalized as `retryable_failed` for immediate same-key retry.
