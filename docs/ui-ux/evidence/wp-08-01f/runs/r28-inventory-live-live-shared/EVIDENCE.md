# WP-07-04 r28 — Inventory Live-Live SHARED Cutover Proof

## Branch & SHA Tracking

- **Branch**: `review/wp-08-01f-independent-fixes-r28`
- **START_HEAD**: `339342e7ad9b0f367381396a888dd08873472124` (r27 final)
- **IMPLEMENTATION_HEAD**: `c8d3fad35a13b6bf5de3d25ad34dd91d4b6c02dc`
- **EVIDENCE_PARENT**: same as IMPLEMENTATION_HEAD (no separate evidence-only child)
- **Published remote SHA**: `c8d3fad35a13b6bf5de3d25ad34dd91d4b6c02dc` (verified)

## PostgreSQL Identity

- **PostgreSQL version**: `17.10 (Debian 17.10-0+deb13u1) on x86_64-pc-linux-gnu`
- **DB identity**: `current_database() = erp_yarn_wp0801f_disposable`, `current_user = erp_yarn_user`, `127.0.0.1:5433`
- **Disposable marker**: `__disposable_test_db_marker` table contains `id='disposable'`
- **Migration state**: 67 tables in `public` schema
- **Test execution mode**: `--no-file-parallelism`

## LIVE-LIVE-SHARED-INVENTORY-SVC-DET

### Objective
Prove two ACTUAL InventoryLedgerService live commands both pass the production SHARED cutover path simultaneously. This is the last remaining WP-07-04/cutover proof — r27 explicitly found no existing committed test supplies this proof.

### Fixture
Same tenant/domain. Two non-conflicting inventory postings:
- A: item A, location A, source A, quantity "100.000"
- B: item B, location B, source B, quantity "200.000"

Different items/locations/sources isolate cutover coordination — no business-row contention.

### Barrier design
The `InventoryLedgerService` does NOT use txFactories. It uses `this.deps.ledger` directly. `requireCutoverLock` calls `this.deps.ledger.lockCutoverScope(tenantId, "inventory", "shared")`. The wrapper uses `Object.create(realService)` to override `requireCutoverLock` — delegates to the real method, signals AFTER acquisition, optionally holds at a release barrier.

### Exact barrier sequence

1. **A starts**: real `InventoryLedgerService.postRawReceipt` on independent connection A
2. **A acquires real lock**: A's `requireCutoverLock` delegates to real `lockCutoverScope(tenantId, "inventory", "shared")` — acquires real SHARED advisory lock on `pg_advisory_xact_lock_shared(CUTOVER_LOCK_NAMESPACE, computeCutoverLockKey(T, "inventory"))`
3. **A signals**: `A_INVENTORY_SHARED_ACQUIRED = true`
4. **A holds**: A's transaction pauses at `aReleasePromise` barrier (transaction remains open, SHARED lock held)
5. **B starts**: real `InventoryLedgerService.postRawReceipt` on independent connection B
6. **B acquires real lock**: B's `requireCutoverLock` delegates to real `lockCutoverScope(tenantId, "inventory", "shared")` — acquires SHARED advisory lock (does NOT block on A's SHARED)
7. **B signals**: `B_INVENTORY_SHARED_ACQUIRED = true` — **WHILE A has NOT been released**

### CRITICAL ASSERTION
`B_INVENTORY_SHARED_ACQUIRED === true` while A still holds SHARED. This proves SHARED/SHARED coexistence at the service level — not accidental EXCLUSIVE serialization.

### Release
Release A → A's transaction completes (movement + balance + audit + idempotency succeeded). B completes independently.

### Final assertions (all exact decimal-kg strings — no float)
- A acquired real Inventory SHARED: `aSharedAcquired === true`
- B acquired real Inventory SHARED before A release: `bSharedAcquired === true`
- Both actual live commands succeed: A `action = "posted"`, B `action = "posted"`
- A's onHandQtyKg = "100.000" (exact)
- B's onHandQtyKg = "200.000" (exact)
- Exactly one movement for A: `stock_movements.quantity_kg = "100.000"`
- Exactly one movement for B: `stock_movements.quantity_kg = "200.000"`
- A's balance = "100.000"
- B's balance = "200.000"
- No duplicate movements: exactly 2 total
- A idempotency = `succeeded`
- B idempotency = `succeeded`
- No deadlock
- **PASS**

## Destructive Inventory Result

The new test file `wp-07-04-r28-inventory-shared.test.ts` contains `DELETE FROM` cleanup. Updated inventory in the same checkpoint:
- Canonical search: 57 paths
- Category A: 55
- Category D: 2
- A + B + C + D = 55 + 0 + 0 + 2 = 57 = discovered count ✓
- Inventory validator: 13/13 PASS

## Full Suite Result

```
npx vitest run --no-file-parallelism
Test Files:  155 passed | 1 skipped (156)
Tests:        4140 passed | 0 failed | 44 skipped (4184)
Duration:    122.50s
```

**0 failures.**

## tsc / eslint / diff-check

```
npx tsc --noEmit        → exit 0
npx eslint <changed>    → exit 0
git diff --check        → exit 0
```

## Payment/Reversal/Settlement Status

**CLOSED** — r27 closed the financial concurrency tranche. r28 does NOT modify SettlementService, PaymentReversalService, PaymentService, reversal linkage, or their race tests.

## WP-07-04 Cutover Status

**CLOSED** — the last remaining cutover proof (LIVE-LIVE-SHARED-INVENTORY-SVC-DET) is now implemented and passing. Combined with:
- r25 raw SHARED primitive tests (PostgreSQL SHARED semantics)
- r27 LIVE-LIVE-SHARED-SUBLEDGER-SVC-DET (Subledger service-level SHARED)
- r28 LIVE-LIVE-SHARED-INVENTORY-SVC-DET (Inventory service-level SHARED)
- Existing CUTVER-RACE tests (EXCLUSIVE migration vs SHARED live mutual exclusion)
- Existing SVC-RACE tests (service-level migration vs live mutual exclusion)

The WP-07-04 cutover coordination evidence is now contract-complete.

## DirectCost Status

**DEFERRED** — not started in r28. r28 closes the remaining WP-07-04 cutover evidence. The NEXT checkpoint (r29) may start DirectCost.

## Aggregate Hash

`UNRESOLVED_CUTOVER_MANIFEST_SET_HASH`: **Unresolved / requires owner decision** — not implemented.

## Browser/UI Gate

**ENVIRONMENT BLOCKED** — Supabase/browser credentials remain unavailable.

## Remaining Blockers

1. **DirectCost tranche**: lock/recheck inside tx; tx-scoped ProfitabilitySnapshotService; injected rollback proof.
2. **Aggregate hash**: `UNRESOLVED_CUTOVER_MANIFEST_SET_HASH` — owner decision pending.
3. **Browser/UI**: Supabase credentials unavailable.

## Classification

`incomplete_needs_fix` — the backend full suite is green (0 failures) and WP-07-04 cutover coordination is now contract-complete with both Subledger and Inventory service-level SHARED proofs. Payment/Reversal/Settlement is CLOSED. DirectCost is the next tranche.
