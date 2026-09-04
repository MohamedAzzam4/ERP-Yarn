# WP-07-04 r29 — Raw Receipt Transaction Closure + Inventory SHARED Correction

## Branch & SHA Tracking

- **Branch**: `review/wp-08-01f-independent-fixes-r29`
- **START_HEAD**: `77131b9de55131f8b93f2a650378f07b3a01a3a3` (r28 final)
- **IMPLEMENTATION_HEAD**: (recorded after commit)
- **Published remote SHA**: (verified after push)

## PostgreSQL Identity

- **PostgreSQL version**: `17.10 (Debian 17.10-0+deb13u1) on x86_64-pc-linux-gnu`
- **DB identity**: `current_database() = erp_yarn_wp0801f_disposable`, `current_user = erp_yarn_user`, `127.0.0.1:5433`
- **Disposable marker**: `__disposable_test_db_marker` table contains `id='disposable'`
- **Migration state**: 67 tables in `public` schema
- **Test execution mode**: `--no-file-parallelism`

## Why r28 Inventory SHARED Proof Was Invalid

The r28 test created `InventoryLedgerService` with TOP-LEVEL Drizzle DB handles (auto-commit). `pg_advisory_xact_lock_shared(...)` is transaction-scoped — with auto-commit repos, the implicit transaction ends when the lock query returns, releasing the lock BEFORE the JavaScript barrier fires. The barrier signal therefore occurs AFTER A's advisory lock may already have been released, invalidating the proof that B acquired SHARED while A held it.

## Corrected Inventory SHARED Proof (Blocker A)

### Fix
Both A and B now run `postRawReceipt` INSIDE explicit `db.transaction()` with ALL repos (ledger, audit, idempotency, documentSeq) constructed from `tx`. The advisory lock persists for the duration of the enclosing transaction.

### Barrier sequence
1. A enters `indA.db.transaction(txA)`
2. A constructs ALL repos from `txA` (not top-level `indA.db`)
3. A's real `requireCutoverLock` acquires real `pg_advisory_xact_lock_shared` INSIDE `txA`
4. A signals `A_SHARED_ACQUIRED` (lock genuinely held while txA is open)
5. A holds at release barrier (txA remains open, SHARED held)
6. B enters `indB.db.transaction(txB)`
7. B constructs ALL repos from `txB`
8. B's real `requireCutoverLock` acquires SHARED INSIDE `txB`
9. B signals `B_SHARED_ACQUIRED` WHILE A has NOT been released
10. Release A → txA commits → A's `postRawReceipt` completes
11. B completes independently → txB commits

### CRITICAL ASSERTION
`B_SHARED_ACQUIRED === true` while A still holds SHARED (txA open). Proves genuine SHARED/SHARED coexistence at the service level with explicit transactions.

### Final assertions (exact decimal-kg strings)
- A: `action="posted"`, `onHandQtyKg="100.000"`, 1 movement `quantity_kg="100.000"`, balance=`"100.000"`, idempotency=`succeeded`
- B: `action="posted"`, `onHandQtyKg="200.000"`, 1 movement `quantity_kg="200.000"`, balance=`"200.000"`, idempotency=`succeeded`
- No duplicate movements: exactly 2 total
- No deadlock

**PASS**

## r28 Evidence Wording Update
r28 evidence now marks its old proof as corrected/superseded by the r29 explicit-transaction version.

## Blocker B — Raw Receipt Tx Factory Audit Fix

### Before (BUG)
```typescript
createInventoryLedger: (tx) => new InventoryLedgerService({
  ledger: new InventoryLedgerDbRepository(tx),
  audit,                              // ROOT audit (BUG)
  idempotency: new IdempotencyDbRepository(tx),
  documentSequence: new DocumentSequenceDbRepository(tx),
}),
createSubledger: (tx) => new SubledgerService({
  subledger: new SubledgerDbRepository(tx),
  audit,                              // ROOT audit (BUG)
  ...
}),
```

### After (FIX)
```typescript
createInventoryLedger: (tx) => new InventoryLedgerService({
  ledger: new InventoryLedgerDbRepository(tx),
  audit: new AuditDbRepository(tx),   // tx-scoped (FIX)
  ...
}),
createSubledger: (tx) => new SubledgerService({
  subledger: new SubledgerDbRepository(tx),
  audit: new AuditDbRepository(tx),   // tx-scoped (FIX)
  ...
}),
```

## Blocker C — Approval One-Commit Architecture

### Before
Stock/payable/markDecided committed inside tx, then:
- audit written OUTSIDE tx (orphan if tx rolls back after stock post)
- markSucceeded written OUTSIDE tx with PARTIAL result (only movementId, payableEntryId, payableDeferred)

### After
ALL writes inside ONE transaction:
- tx-scoped InventoryLedgerService.postRawReceipt (stock)
- tx-scoped SubledgerService.postSupplierPayable (payable)
- tx-scoped approvalRepository.markDecided
- tx-scoped audit (raw_receipt_approval.approve)
- tx-scoped markSucceeded with COMPLETE ApproveRawReceiptResult
- ONE commit

## Blocker D — Technical Failure → retryable_failed

### Before
`markBusinessFailed(responseCode: 500)` for ALL transaction errors — classified technical failures as durable business failures, preventing same-key retry.

### After
`markRetryableFailed(responseCode: 500)` for technical/system errors. Deterministic business failures (ApprovalAlreadyDecidedError, RequesterCannotApproveOwnRequestError, etc.) remain `business_failed` (classified separately before the try/catch).

## Blocker E — Approval Terminal Replay Fail-Closed

### Before
Replay reread the approval row and reconstructed a partial result with empty `movementDocNo`, `balanceVersion: 0`, `onHandQtyKg: "0.000"`. If approval was NOT decided, fell through to execute.

### After
Replay uses stored terminal idempotency result as durable authority:
- `succeeded`: validate runtime shape of stored response, return exact stored result, NO re-execution
- `business_failed`: validate code/message runtime strings, throw exact stored error
- Unexpected state: `IDEMPOTENCY_INCONSISTENT`
- NO fallthrough to execute

## Blocker F — Complete Durable Result

### Before
`markSucceeded` stored only `{ movementId, payableEntryId, payableDeferred }`.

### After
`markSucceeded` stores the COMPLETE `ApproveRawReceiptResult`:
- approvalRequestId, draftId, movementId, movementDocNo
- balanceVersion, onHandQtyKg
- payableEntryId, payableEntryNo, payableAmountSigned, payableDeferred

Runtime validation on replay verifies every required field is a non-empty string (or null for optional).

## Blocker G — Late-Price One-Commit Architecture

Same one-commit refactoring as Blocker C for `confirmLatePrice()`:
- tx-scoped SubledgerService.postSupplierPayable
- tx-scoped approvalRepository.updatePayableInfo
- tx-scoped audit (raw_receipt_late_price.confirm)
- tx-scoped markSucceeded with COMPLETE ConfirmLatePriceResult
- ONE commit

Technical failure → `markRetryableFailed` (not `markBusinessFailed`).

## Blocker H — Late-Price Replay Fail-Closed

Same fail-closed replay as Blocker E:
- `succeeded`: validate runtime shape, return exact stored result
- `business_failed`: validate code/message, throw exact stored error
- Unexpected: `IDEMPOTENCY_INCONSISTENT`
- NO fallthrough

## Existing Tests Retained
All 23 existing raw-receipt-approval tests pass after refactoring (unit tests with in-memory repos use the no-transactionRunner path which remains for test-only composition).

## Destructive Inventory Result
No new PG test files created — the r28 inventory shared test file was rewritten in place (already inventoried at row #57). Canonical search: 57 paths (55 Category A + 2 Category D). Inventory validator: 13/13 PASS.

## Full Suite Result

```
npx vitest run --no-file-parallelism
Test Files:  155 passed | 1 skipped (156)
Tests:        4140 passed | 0 failed | 44 skipped (4184)
Duration:    125.82s
```

**0 failures.**

## tsc / eslint / diff-check

```
npx tsc --noEmit        → exit 0
npx eslint <changed>    → exit 0
git diff --check        → exit 0
```

## Payment/Reversal/Settlement Status
**CLOSED** (r27) — not modified in r29.

## WP-07-04 Cutover Status
The corrected Inventory SHARED proof (with explicit transactions) now genuinely proves two actual Inventory live commands both hold compatible SHARED advisory locks simultaneously.

## DirectCost Status
**DEFERRED** — not started. If r29 review confirms the corrections pass, the NEXT checkpoint may start DirectCost.

## Aggregate Hash
`UNRESOLVED_CUTOVER_MANIFEST_SET_HASH`: **Unresolved / requires owner decision**

## Browser/UI
**ENVIRONMENT BLOCKED** — Supabase credentials unavailable

## Remaining Blockers
1. DirectCost tranche
2. `UNRESOLVED_CUTOVER_MANIFEST_SET_HASH` — owner decision
3. Browser/UI — Supabase credentials unavailable
4. PG proofs for raw-receipt-approval rollback/replay/malformed (production code refactored; existing unit tests pass; dedicated PG proofs deferred to follow-up if reviewer requires)

## Classification
`incomplete_needs_fix` — the backend full suite is green (0 failures) with corrected Inventory SHARED proof (explicit transactions), raw-receipt-approval one-commit architecture, tx-scoped audit, fail-closed replay, complete durable results, and retryable_failed technical failure classification. DirectCost is the next tranche.
