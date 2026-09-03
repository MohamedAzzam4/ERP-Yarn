# WP-08-01F r27 Payment Closure — Evidence File

## Branch & SHA Tracking

- **Branch**: `review/wp-08-01f-independent-fixes-r27`
- **START_HEAD**: `41b1d6db2299d58d69fcde4e4b776d7388a7136e` (r26 final)
- **FINAL_HEAD**: `efba66b174803dcf2618c5b81faa3dc11422d3cf`
- **Remote SHA**: `efba66b174803dcf2618c5b81faa3dc11422d3cf` (verified)

## PostgreSQL Identity

- **PostgreSQL version**: `17.10 (Debian 17.10-0+deb13u1) on x86_64-pc-linux-gnu`
- **DB identity**: `current_database() = erp_yarn_wp0801f_disposable`, `current_user = erp_yarn_user`, `127.0.0.1:5433`
- **Disposable marker**: `__disposable_test_db_marker` table contains `id='disposable'`
- **Migration state**: 67 tables in `public` schema
- **Test execution mode**: `--no-file-parallelism`

## Small Evidence Cleanup — Inventory Prose Correction

The introductory prose in `task1-destructive-inventory-35.md` said "35 executable destructive test/QA harness files (Category A)" — stale. Corrected to `54` to match the authoritative Category A total after adding the r27 test file. No category table/count logic changed.

## Old-Test Relabeling (r26 file)

r26 tests that used raw SQL barriers or sequential ordering were truthfully relabeled:

| Old Name | New Name | Reason |
|----------|----------|--------|
| SETTLE-RACE-1-DET | SETTLE-PAYMENT-ROW-LOCK-WAIT | Raw SQL row-lock, not two-settlement race |
| SETTLE-RACE-2A-DET | SETTLE-RACE-2A-ROW-LOCK | Raw SQL row-lock, not settlement-first race |
| SETTLE-RACE-2B-DET | SETTLE-RACE-2B-SEQUENTIAL | Sequential, not reversal-first race |
| SETTLE-RACE-3-DET | SETTLE-RACE-3-CONCURRENT-CAPABLE | Promise.all, no deterministic target-lock barrier |
| LIVE-LIVE-SHARED-SVC | LIVE-LIVE-SHARED-SVC-CONCURRENT | Both succeed, but doesn't prove simultaneous SHARED possession |

These are kept as regression tests but do NOT count toward Contract 12 closure.

## r27 Blocker A — SETTLE-RACE-1-SVC (two real SettlementService commands)

### Barrier sequence
1. A (real SettlementService) starts → acquires real `lockPayment` via `BarrierPaymentDbRepository`
2. A signals `aLockAcquired = true` AFTER real DB lock acquisition
3. A holds at `aReleasePromise` barrier (tx remains open)
4. B (real SettlementService on independent connection) starts
5. B attempts `lockPayment` — BLOCKED (verified via 3s timeout race)
6. B has NOT passed `lockPayment` (`bLockAttempted = false`)
7. Release A → A commits settlement (100.00)
8. B wakes → rereads authoritative state (capacity = 0) → business_fails

### Assertions
- Exactly one active settlement = "100.00" (decimal string)
- B has no settlement row
- B has no success audit
- B idempotency = `business_failed`
- No deadlock
**PASS**

## r27 Blocker B — SETTLE-RACE-2A-SVC (settlement-first vs reversal)

### Barrier sequence
1. A (real SettlementService) starts → acquires real `lockPayment`
2. A signals `aLockAcquired = true` → holds at barrier
3. B (real PaymentReversalService on independent connection) starts
4. B attempts `lockPayment` — BLOCKED (verified via 3s timeout)
5. B has NOT passed `lockPayment`
6. Release A → A commits settlement (100.00)
7. B wakes → sees authoritative state (payment posted, settlement active)
8. B succeeds → reverses payment + unallocates A's settlement

### Assertions
- Final payment state: `reversed`
- A's settlement reversed (0 active settlements)
- Target capacity restored (`settlement_status = unsettled`)
- No deadlock
**PASS**

## r27 Blocker C — SETTLE-RACE-2B-SVC (reversal-first vs settlement)

### Barrier sequence
1. A (real PaymentReversalService) starts → acquires real `lockPayment`
2. A signals `aLockAcquired = true` → holds at barrier
3. B (real SettlementService on independent connection) starts
4. B attempts `lockPayment` — BLOCKED (verified via 3s timeout)
5. B has NOT passed `lockPayment`
6. Release A → A commits reversal
7. B wakes → sees payment reversed → business_fails

### Assertions
- No settlement row inserted by B
- No `payment.settle` success audit
- B idempotency = `business_failed`
- Final payment state: `reversed`
- No deadlock
**PASS**

## r27 Blocker D — SETTLE-RACE-3-TARGET-SVC (target-lock contention)

### Barrier sequence
1. P1 fully settled against target T (100.00)
2. A (real PaymentReversalService for P1) starts → acquires real `lockSettledEntry(T)` via `BarrierPaymentDbRepository`
3. A signals `aTargetLockAcquired = true` → holds at barrier
4. B (real SettlementService for P2 against same T) starts
5. B signals `bTargetLockAttempted = true` → attempts `lockSettledEntry(T)` — BLOCKED
6. Release A → A commits reversal (frees T's capacity)
7. B wakes → rereads authoritative state (capacity = 100.00) → settles 100.00

### Assertions (all BigInt cents — no float)
- Final active settlement rows for T = P2 only (1 row)
- Exact settled amount = "100.00" (decimal string)
- Target `settlement_status = settled`
- No over-settlement (totalCents = 10000n = maxCents)
- No deadlock
**PASS**

## r27 Blocker E — LIVE-LIVE-SHARED-SUBLEDGER-SVC-DET (simultaneous SHARED)

### Design note
Two `PaymentService.postPayment` calls for the same tenant+year serialize on the `document_sequences` row lock (by design — document numbers must be sequential). To isolate the SHARED cutover lock proof, this test uses two real `SubledgerService.postPaymentEntry` calls directly (which don't allocate document numbers — the caller passes `docNo`).

### Barrier sequence
1. A (real `SubledgerService.postPaymentEntry`) starts inside real `db.transaction()`
2. A's tx-scoped `requireCutoverLock` acquires real SHARED advisory lock
3. A signals `aSharedAcquired = true` → holds at `aReleasePromise` barrier
4. B (real `SubledgerService.postPaymentEntry` on independent connection) starts
5. B's tx-scoped `requireCutoverLock` acquires SHARED — does NOT block (SHARED coexists)
6. B signals `bSharedAcquired = true` BEFORE A is released

### Assertions
- `bSharedAcquired = true` (B acquired SHARED while A held it)
- B did not time out
- Both entries succeed
- Exactly 2 account entries
**PASS**

### Inventory service-level SHARED reuse check
Inspected `wp-07-04-service-race.test.ts` — existing SVC-RACE tests prove migration (EXCLUSIVE) vs live (SHARED) mutual exclusion, NOT live/live SHARED coexistence. No committed test already proves two ordinary Inventory live services both pass SHARED coordination simultaneously. The LIVE-LIVE-SHARED-SUBLEDGER-SVC-DET test above is the new service-level SHARED proof.

## Retained r26 Results (unchanged)
- reversal_of_entry_id persisted (REV-LINK-1/ROLLBACK/IDEMP)
- Genuine-state Settlement durable replay
- Genuine-state Reversal durable replay
- DRAFT rollback/retry
- Payment rollback/PAY-RETRY
- Nested Subledger audit rollback
- REV-TRANSITION rollback
- Inventory 56-path reconciliation
- Full-suite fixes

## Full Suite Result

```
npx vitest run --no-file-parallelism
Test Files:  154 passed | 1 skipped (155)
Tests:        4139 passed | 0 failed | 44 skipped (4183)
Duration:    122.50s
```

**0 failures.**

## tsc / eslint / diff-check

```
npx tsc --noEmit        → exit 0
npx eslint <changed>    → exit 0
git diff --check        → exit 0
```

## DirectCost Status

**DEFERRED** — not started in r27. If r27 review confirms the deterministic service-vs-service races pass, the NEXT checkpoint may start DirectCost.

## Aggregate Hash

`UNRESOLVED_CUTOVER_MANIFEST_SET_HASH`: **Unresolved / requires owner decision** — not implemented.

## Browser/UI Gate

**ENVIRONMENT BLOCKED** — Supabase/browser credentials remain unavailable.

## Remaining Blockers

1. **DirectCost tranche**: lock/recheck inside tx; tx-scoped ProfitabilitySnapshotService; injected rollback proof.
2. **Aggregate hash**: `UNRESOLVED_CUTOVER_MANIFEST_SET_HASH` — owner decision pending.
3. **Browser/UI**: Supabase credentials unavailable.

## Classification

`incomplete_needs_fix` — the backend full suite is green (0 failures) with deterministic service-vs-service concurrency proofs using real SettlementService / PaymentReversalService on both sides, positive lock-acquisition signals, and simultaneous SHARED coexistence proof. DirectCost is the next tranche.
