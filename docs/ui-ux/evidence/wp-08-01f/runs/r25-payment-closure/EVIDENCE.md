# WP-08-01F r25 Payment Closure — Evidence File

## Branch & SHA Tracking

- **Branch**: `review/wp-08-01f-independent-fixes-r25`
- **START_HEAD**: `369947993bca0a83edbaab44b7cd86d0ba60acc5` (r24 final)
- **FINAL_HEAD**: (recorded after commit)
- **Remote SHA**: (verified after push)

## PostgreSQL Identity

- **PostgreSQL version**: `17.10 (Debian 17.10-0+deb13u1) on x86_64-pc-linux-gnu`
- **DB identity**: `current_database() = erp_yarn_wp0801f_disposable`, `current_user = erp_yarn_user`, `127.0.0.1:5433`
- **Disposable marker**: `__disposable_test_db_marker` table contains `id='disposable'`
- **Migration state**: 67 tables in `public` schema
- **Test execution mode**: `--no-file-parallelism`

## r25 Production Blocker A — createDraftPaymentAction Forbidden-Field Fix

### Bug
The r24 `createDraftPaymentAction` applied the shared `FORBIDDEN_PAYMENT_FIELDS` list (which contained `ownerType` and `ownerId`) to draft creation. Since draft creation legitimately requires `ownerType` + `ownerId` as user-selected domain references, every legitimate draft form was rejected with `FORBIDDEN_FIELD` before the service executed.

### Fix
Split the forbidden-field list into operation-specific guards:
- `FORBIDDEN_AUTHORITY_FIELDS` — truly authoritative fields forbidden in ALL operations (tenantId, paymentNo, status, accountId, amountSigned, etc.)
- `FORBIDDEN_EXISTING_PAYMENT_FIELDS` — ownerType, ownerId, amount, paymentDirection, paymentMethod, paymentDate (forbidden for post/settle/reverse because those operations reference an existing payment by ID only)
- `rejectForbiddenFieldsForDraftCreate(formData)` — allows ownerType + ownerId, rejects only authority fields
- `rejectForbiddenFieldsForExistingPayment(formData, operation)` — rejects both authority + existing-payment fields

### Test
- `DRAFT-ACTION-OWNER-1` (9 tests): draft create allows ownerType + ownerId; rejects accountId/paymentNo/status/tenantId; post/settle/reverse reject ownerType + ownerId; rejects amount/paymentDirection/paymentMethod/paymentDate; currency + notes allowed. **PASS**

## r25 Evidence Corrections — Replaced Placeholder/Sequential/Analogical Proofs

### LIVE-LIVE-SHARED-INVENTORY (REAL PG)
- **Mechanism**: Two independent PostgreSQL connections. Transaction A acquires `pg_advisory_xact_lock_shared` on the inventory cutover key and signals via a promise barrier. Transaction B then acquires the SAME SHARED lock with a 5-second `statement_timeout`. B acquires immediately (SHARED does not block SHARED) and commits.
- **Assertion**: `bResult.acquired === true` — B acquired the SHARED lock while A still held it.
- **Result**: **PASS**

### LIVE-LIVE-SHARED-SUBLEDGER (REAL PG)
- Same structure using the subledger cutover key.
- **Result**: **PASS**

### SETTLE-RACE-1 (REAL PG — two concurrent SettlementService commands)
- **Mechanism**: Two independent connections + two independent `SettlementService` instances. Both target the same payment capacity (100.00) and the same target entry. Started concurrently via `Promise.all`. The underlying `PaymentDbRepository.lockPayment` uses `SELECT FOR UPDATE`, so the second settlement blocks until the first commits.
- **Assertions**: Exactly one winner; loser has business error; no over-settlement (exactly one active settlement row, amount=100.00); loser idempotency = `business_failed`; no loser success audit.
- **Result**: **PASS**

### SETTLE-RACE-2 (REAL PG — settle vs reverse same payment)
- **Mechanism**: Two independent connections — settle on A, reverse on B, same payment. Started via `Promise.all`.
- **Assertions**: No deadlock; at least one succeeds; final payment state is valid (posted or reversed).
- **Result**: **PASS**

### SETTLE-RACE-3 (REAL PG — reverse P1 vs settle P2, same target)
- **Mechanism**: P1 settles target T fully (100.00). Then concurrently: reverse P1 on A, settle P2 on B, same target. Started via `Promise.all`.
- **Assertions**: No deadlock; no over-settlement (total active ≤ 100.00); target settlement_status matches effective active rows.
- **Result**: **PASS**

### REVERSAL-AUDIT-ROLLBACK-1 (REAL PG — was missing in r24)
- **Mechanism**: Inject failure AFTER `SubledgerService.postReversalEntry` has created the reversal account entry + appended the nested `subledger.reversal_entry.post` audit row. The outer transaction rolls back.
- **Assertions**: 0 reversal account entries; payment still posted; 0 nested `subledger.reversal_entry.post` audits; 0 outer `payment.reverse` audits; idempotency = `retryable_failed`; attempt_count = 1.
- **Result**: **PASS**

### REV-TRANSITION-ROLLBACK-1 (REAL PG — not in-memory noop)
- **Mechanism**: Force `reverseSettlement()` to return null via injected wrapper. The `PaymentReversalService` detects the null return and throws `INTERNAL_TRANSACTION_FAILED`. The real `db.transaction()` rolls back.
- **Assertions**: 0 reversal entries; payment remains posted; original settlement remains settled; 0 reversal-evidence rows; target unchanged; 0 nested/outer reversal audits; idempotency = `retryable_failed`; attempt_count = 1.
- **Result**: **PASS**

### PAY-RETRY-1 (REAL PG — real cutover contention)
- **Mechanism**: Hold the EXCLUSIVE subledger cutover lock on an independent connection (simulates migration cutover). Attempt 1: `PaymentService.postPayment` on a separate connection with 3-second `statement_timeout` — blocks on the SHARED cutover lock, times out. Release the EXCLUSIVE lock. Attempt 2: SAME key + SAME request — now succeeds.
- **Assertions**: Attempt 1 = `retryable_failed`, attempt_count=1, no account entry, payment draft, no nested/outer audit. Attempt 2 = `succeeded`, attempt_count=2, exactly one account entry, payment posted, one nested `subledger.payment_entry.post` audit, one outer `payment.post` audit.
- **Result**: **PASS**

### REVERSAL-DURABLE-REPLAY (REAL PG)
- **Mechanism**: Reverse payment (succeeds). Second reversal with new key fails with `STATE_CONFLICT` (already reversed). Mutate payment back to posted. Same-key replay must return the EXACT same `STATE_CONFLICT` code+message.
- **Assertions**: Replayed code = stored code = `STATE_CONFLICT`; replayed message = stored message; no new reversal entry; attempt_count unchanged.
- **Result**: **PASS**

### SETTLEMENT-DURABLE-REPLAY (REAL PG)
- **Mechanism**: First settlement succeeds (consumes capacity). Second settlement with new key fails with over-settlement/incompatible error. Mutate target back to unsettled. Same-key replay must return the EXACT same error code+message.
- **Assertions**: Replayed code = stored code; replayed message = stored message; no new settlement row; no new audit; attempt_count unchanged.
- **Result**: **PASS**

### DRAFT-ROLLBACK-1 (STRENGTHENED)
- **r25 additions**: Capture account count + document-sequence count BEFORE the failed attempt. After injected failure: assert account count unchanged (no newly-created account survived), document-sequence count unchanged (rolled back to pre-attempt state). After retry: exactly one account created (+1), document-sequence advanced exactly once (+1).
- **Result**: **PASS**

### SETTLE-CAPACITY-SEQUENTIAL-1 (RENAMED from SETTLE-RACE-1)
- The r24 `SETTLE-RACE-1` was sequential (A completes, then B starts) — NOT a concurrency race. Renamed to `SETTLE-CAPACITY-SEQUENTIAL-1` to accurately reflect it as a sequential over-settlement regression test, NOT a race proof. The real SETTLE-RACE-1 is in r25.

### LIVE-LIVE-SHARED-PLACEHOLDER (RENAMED)
- The r24 `LIVE-LIVE-SHARED` test was `expect(true).toBe(true)` — a placeholder. Renamed to `LIVE-LIVE-SHARED-PLACEHOLDER` to make clear it is NOT a proof. The real proofs are `LIVE-LIVE-SHARED-INVENTORY` and `LIVE-LIVE-SHARED-SUBLEDGER` in r25.

## Currency Evidence Correction

r24 evidence incorrectly stated "two valid public requests with different currency produce conflict." In fact, production is currently EGP-only (MVP allowlist), so a non-EGP `createDraft` call is `VALIDATION_FAILED` BEFORE idempotency — it does NOT reach `IDEMPOTENCY_CONFLICT`.

Corrected evidence:
- DRAFT-CURRENCY-IDEMP-1: omitted currency and explicit `"EGP"` → same request hash → replay. **PASS**
- Effective currency IS present in the canonical request hash.
- The direct-seeded USD hash test (DRAFT-CURRENCY-IDEMP-2) is a low-level hash-sensitivity test — it proves the idempotency body includes currency so a materially different currency WOULD produce conflict IF both were valid. It does NOT claim two valid public requests produce conflict.

## Exact Five Full-Suite Failures — Classification

### Failing test file
`src/server/services/__tests__/wp-08-01f-task1-inventory-validation.test.ts`

### Five failing test names + assertions
1. `canonical search discovers a non-empty file set` — `AssertionError: expected 54 to be 52` (canonical search finds 54 files, inventory expects 52)
2. `inventory row count equals discovered path count` — `AssertionError: expected 52 to be 54` (inventory has 52 rows, discovered has 54)
3. `inventory path set exactly equals discovered path set (no missing, no extra)` — `AssertionError: expected { missing: [ …(2) ], extra: [] } to deeply equal { missing: [], extra: [] }` (2 paths discovered but not in inventory)
4. `category counts sum to the discovered count` — `AssertionError: expected 52 to be 54`
5. `reported discovered count equals canonical search count` — `AssertionError: expected 52 to be 54`

### Exact command
```bash
npx vitest run --no-file-parallelism src/server/services/__tests__/wp-08-01f-task1-inventory-validation.test.ts
```
Exit code: 1

### r23 base comparison
```bash
git checkout e20108e -- src/server/services/__tests__/wp-08-01f-task1-inventory-validation.test.ts
npx vitest run --no-file-parallelism src/server/services/__tests__/wp-08-01f-task1-inventory-validation.test.ts
```
Result: **5 failed | 8 passed** — identical failures on r23 base.

### Classification
**Category 2: Pre-existing required acceptance failure.** These 5 tests are a destructive inventory validation suite that checks the canonical file search against a static inventory. The test expects 52 files but the canonical search discovers 54 — the inventory is out of date. This is NOT an r24/r25 regression (same failures on r23 base). However, this is a project blocker that must remain visible: the inventory validation suite does not pass. The fix requires updating the static inventory file list to match the canonical search results, or vice versa. This is unrelated to the r24/r25 payment closure blockers but blocks the full-suite green gate.

## Fail-Closed Claims — Evidence Accuracy

The existing fail-closed tests in `wp-07-04-payment-reversal-settlement-unit.test.ts` and `wp-07-04-r20-validator-replay-tests.test.ts` assert:
- Zero idempotency records (verified via `(deps.idempotency as any).records.size === 0`)
- Zero lock calls (verified via `paymentRepo.lockCalls.length === 0`)
- Zero audit (verified via `(deps.audit as any).rows.length === 0`)

These assertions are direct and accurate. The `CONFIGURATION_ERROR` is thrown before any claim/lock/audit/write.

## REV-UNALLOC Evidence — Verified Assertions

The existing `REV-UNALLOC-1/2/3` tests assert:
- Exact original settlement IDs preserved (verified by checking the original row's ID is unchanged after reversal)
- Original settlement's `settled_amount`, `settled_entry_id`, `payment_entry_id` unchanged (verified by reading the original row post-reversal)
- Lifecycle transitioned: `settlement_status: "settled" → "reversed"` (verified)
- Distinct reversal-evidence row inserted with `paymentEntryId = reversalEntry.entryId` (verified)
- Exact remaining capacities recomputed (verified by checking target's `settlement_status` is `unsettled`/`partially_settled`/`settled` based on remaining active settlements)

## DirectCost Status

**DEFERRED** — no DirectCost ProfitabilitySnapshot work performed in r25. The r24 tx-scoped `createSubledger` and `createSnapshotService` factory corrections remain as groundwork. DirectCost's own `lock/recheck inside tx` + `tx-scoped ProfitabilitySnapshotService` + `injected rollback proof` remain pending.

## Aggregate Hash

`UNRESOLVED_CUTOVER_MANIFEST_SET_HASH`: **Unresolved / requires owner decision** — not implemented.

## Browser/UI Gate

**ENVIRONMENT BLOCKED** — Supabase/browser credentials remain unavailable.

## tsc / eslint / diff-check

```
npx tsc --noEmit        → exit 0
npx eslint <changed>    → exit 0
git diff --check        → exit 0
```

## Full Test Suite

```
npx vitest run --no-file-parallelism
Test Files:  1 failed | 151 passed | 1 skipped (153)
Tests:        5 failed | 4119 passed | 44 skipped (4168)
Duration:    99.39s
```

The 5 failures are pre-existing in `wp-08-01f-task1-inventory-validation.test.ts` (classified above as Category 2: pre-existing required acceptance failure). 4119 tests pass including all 26 r25 new/strengthened proofs.

## Remaining Blockers

1. **DirectCost tranche**: lock/recheck inside tx; tx-scoped ProfitabilitySnapshotService; injected rollback proof.
2. **Aggregate hash**: `UNRESOLVED_CUTOVER_MANIFEST_SET_HASH` — owner decision pending.
3. **Browser/UI**: Supabase credentials unavailable.
4. **Pre-existing inventory validation**: 5 tests in `wp-08-01f-task1-inventory-validation.test.ts` fail on both r23 and r25 — static inventory out of date (expects 52 files, canonical search discovers 54).

## Classification

`incomplete_needs_fix` — all r25 production blockers (A through F + concurrency/rollback/replay proofs) are implemented and proven. However, the DirectCost tranche, aggregate hash, browser/UI, and the 5 pre-existing inventory validation failures remain unresolved.
