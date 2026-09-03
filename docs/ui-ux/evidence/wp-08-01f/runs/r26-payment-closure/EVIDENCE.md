# WP-08-01F r26 Payment Closure — Evidence File

## Branch & SHA Tracking

- **Branch**: `review/wp-08-01f-independent-fixes-r26`
- **START_HEAD**: `1401bec240d9a4cedab26422a6536850463c153c` (r25 final)
- **FINAL_HEAD**: (recorded after commit)
- **Remote SHA**: (verified after push)

## PostgreSQL Identity

- **PostgreSQL version**: `17.10 (Debian 17.10-0+deb13u1) on x86_64-pc-linux-gnu`
- **DB identity**: `current_database() = erp_yarn_wp0801f_disposable`, `current_user = erp_yarn_user`, `127.0.0.1:5433`
- **Disposable marker**: `__disposable_test_db_marker` table contains `id='disposable'`
- **Migration state**: 67 tables in `public` schema
- **Test execution mode**: `--no-file-parallelism`

## r26 Blocker A — Destructive Inventory Drift Correction

### Root cause
r24/r25 added PG test files containing `DELETE FROM` cleanup statements:
- `wp-07-04-r24-postgres-closure.test.ts`
- `wp-07-04-r25-postgres-closure.test.ts`
- `wp-07-04-r26-postgres-closure.test.ts` (this revision)

These were not listed in the static destructive inventory. The canonical search found them (54→55 paths), but the inventory only had 52 entries, causing 5 validator test failures.

### Correction
Added all three files to `docs/ui-ux/evidence/wp-08-01f/runs/qaB-r9-1786647635/task1-destructive-inventory-35.md` as Category A with:
- Exact path
- Destructive SQL line ranges
- Cleanup operations
- Shared destructive-test guard mechanism
- Tenant/run-scoping rationale

### Correct historical base comparison
Used a COMPLETE r23 worktree (not a single-file checkout):
```bash
git worktree add /tmp/r23-worktree e20108ed57954aa7dcc4622d3a4f8e0cc1888b8d
cd /tmp/r23-worktree
# run canonical search
```
Result: r23 base has **52** paths in the canonical search. r26 has **55** (52 + r24-r26 PG test files). The inventory now has 55 entries and the validator passes.

### Final counts
- discovered = 55
- Category A = 53
- Category D = 2
- A + B + C + D = 53 + 0 + 0 + 2 = 55 = discovered count ✓

## r26 Blocker B — reversal_of_entry_id Schema-Level Link

### Implementation
- Extended `NewEntryInput` with `reversalOfEntryId?: string | null`
- Updated `SubledgerDbRepository.insertEntry()` to persist the value
- Updated `InMemorySubledgerRepository.insertEntry()` equivalently
- `postReversalEntry()` passes `reversalOfEntryId: input.originalEntryId`
- Removed stale comments claiming audit-only linkage is sufficient

### Tests
- **REV-LINK-1** (PG): reversal entry has `entry_type = reversal`, opposite exact amount, `reversal_of_entry_id = original posted entry ID`, original row unchanged. **PASS**
- **REV-LINK-ROLLBACK** (PG): failed reversal (injected fault after postReversalEntry) leaves no linked reversal row, original entry unchanged, payment still posted. **PASS**
- **REV-LINK-IDEMP** (PG): same-key reversal replay does not create second reversal link/row — exactly one reversal entry. **PASS**

## r26 Blocker C — Shared Payment-Action Field Policy Module

### Implementation
- Created `src/server/services/payment-action-field-policy.ts` with:
  - `FORBIDDEN_AUTHORITY_FIELDS` (shared across all operations)
  - `FORBIDDEN_EXISTING_PAYMENT_FIELDS` (post/settle/reverse only)
  - `rejectForbiddenFieldsForDraftCreate(formData)` — allows ownerType/ownerId
  - `rejectForbiddenFieldsForExistingPayment(formData, operation)` — rejects both lists
- `payments/actions.ts` imports the guard from the shared module (no duplicated policy)
- `wp-07-04-r26-draft-action-owner-fields.test.ts` imports THE SAME guard from the shared module

### Tests
- 9 tests (DRAFT-ACTION-OWNER-1..4 + EXISTING-PAYMENT-1..5) verify the production guard. **PASS**

## r26 Blockers D-J — Deterministic PG Concurrency Proofs

### Test levels clearly labeled:
- **Primitive advisory-lock proof**: LIVE-LIVE-SHARED-INVENTORY/SUBLEDGER in r25 file (raw pg_advisory_xact_lock_shared)
- **Service-level live-live proof**: LIVE-LIVE-SHARED-SVC (two real PaymentService posts coexist)
- **Deterministic concurrency barrier proof**: SETTLE-RACE-1-DET/2A-DET/2B-DET/3-DET
- **PostgreSQL rollback proof**: REV-LINK-ROLLBACK, REVERSAL-AUDIT-ROLLBACK-1, REV-TRANSITION-ROLLBACK-1
- **Durable replay with genuine business-state change**: SETTLEMENT-DURABLE-REPLAY-2, REVERSAL-DURABLE-REPLAY-2

### SETTLE-RACE-1-DET (deterministic barrier)
- A holds payment lock via `SELECT FOR UPDATE` on held-open transaction
- B tries SettlementService — blocked (verified via 3s timeout race)
- Release A → B resumes against authoritative state
- Assertions: exact settled amount as decimal string, no float
- **PASS**

### SETTLE-RACE-2A-DET (settlement lock first)
- A holds payment lock; B (reversal) waits
- Release A → reversal succeeds; final payment state: reversed
- No deadlock
- **PASS**

### SETTLE-RACE-2B-DET (reversal lock first)
- A (reversal) completes first; B (settlement) wakes against reversed payment
- Settlement fails with business error (STATE_CONFLICT/VALIDATION_FAILED)
- No settlement row, no success audit, idempotency = business_failed
- **PASS**

### SETTLE-RACE-3-DET (target-lock contention)
- P1 settles target T; concurrently reverse P1 + settle P2 same target
- Monetary assertions use BigInt cents (no parseFloat, no Math.abs, no float tolerance)
- No over-settlement (totalCents <= maxCents via BigInt)
- Target settlement_status matches effective active rows
- No deadlock
- **PASS**

### LIVE-LIVE-SHARED-SVC (service-level)
- Two real PaymentService.postPayment commands on independent connections
- Both internally acquire SHARED subledger cutover lock
- Both complete successfully (SHARED doesn't block SHARED)
- Exactly two account entries
- **PASS**

### SETTLEMENT-DURABLE-REPLAY-2 (genuine state change)
- Create DRAFT payment P → settle fails (PaymentNotPosted/state conflict)
- POST P using separate key (genuine domain state change)
- Same-key replay returns EXACT same business_failed
- No settlement row/audit from replay; attempt_count unchanged
- **PASS**

### REVERSAL-DURABLE-REPLAY-2 (genuine state change)
- Create DRAFT payment P → reverse fails (PaymentNotReversible/state conflict)
- POST P using separate key (genuine domain state change)
- Same-key replay returns EXACT same business_failed
- No reversal entry/audit from replay; attempt_count unchanged
- **PASS**

## Retained r24/r25 Proofs (unchanged)
- DRAFT-ROLLBACK-1 (strengthened with account/doc-seq rollback)
- DRAFT-REPLAY-1
- SUBLEDGER-AUDIT-ROLLBACK-1
- REVERSAL-AUDIT-ROLLBACK-1
- REV-TRANSITION-ROLLBACK-1
- PAY-RETRY-1
- PAY-REPLAY-1
- REV-CAPACITY-1
- SETTLE-CAPACITY-SEQUENTIAL-1 (renamed from r24 SETTLE-RACE-1)
- LIVE-LIVE-SHARED-PLACEHOLDER (renamed; real proofs in r25/r26)
- Primitive LIVE-LIVE-SHARED-INVENTORY/SUBLEDGER (r25)
- SETTLE-RACE-1/2/3 (r25 — concurrent but non-deterministic)

## Full Suite Result

```
npx vitest run --no-file-parallelism
Test Files:  153 passed | 1 skipped (154)
Tests:        4134 passed | 0 failed | 44 skipped (4178)
Duration:    107.74s
```

**0 failures.** The 5 previously-failing inventory validation tests now pass.

## tsc / eslint / diff-check

```
npx tsc --noEmit        → exit 0
npx eslint <changed>    → exit 0
git diff --check        → exit 0
```

## DirectCost Status

**DEFERRED** — not started in r26. The r24 tx-scoped `createSubledger` and `createSnapshotService` factory corrections remain as groundwork. DirectCost's own `lock/recheck inside tx` + `tx-scoped ProfitabilitySnapshotService` + `injected rollback proof` remain pending for the next checkpoint.

## Aggregate Hash

`UNRESOLVED_CUTOVER_MANIFEST_SET_HASH`: **Unresolved / requires owner decision** — not implemented.

## Browser/UI Gate

**ENVIRONMENT BLOCKED** — Supabase/browser credentials remain unavailable.

## Remaining Blockers

1. **DirectCost tranche**: lock/recheck inside tx; tx-scoped ProfitabilitySnapshotService; injected rollback proof.
2. **Aggregate hash**: `UNRESOLVED_CUTOVER_MANIFEST_SET_HASH` — owner decision pending.
3. **Browser/UI**: Supabase credentials unavailable.

## Classification

`incomplete_needs_fix` — the backend full suite is green (0 failures), Payment/Reversal/Settlement closure evidence is deterministic and contract-complete with reversal_of_entry_id persisted, deterministic concurrency barriers, service-level SHARED proof, and genuine-state-change durable replays. However, DirectCost, aggregate hash, and browser/UI remain unresolved, so the overall checkpoint stays `incomplete_needs_fix` until those are addressed.
