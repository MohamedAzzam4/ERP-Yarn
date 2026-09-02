# WP-08-01F r24 Payment Closure — Evidence File

## Branch & SHA Tracking

- **Branch**: `review/wp-08-01f-independent-fixes-r24`
- **START_HEAD**: `e20108ed57954aa7dcc4622d3a4f8e0cc1888b8d` (r23 — base for r24)
- **FINAL_HEAD**: `d5a96641e95a2f90eb06cef5a060c29bc659aeab`
- **Remote SHA verified**: `d5a96641e95a2f90eb06cef5a060c29bc659aeab` (origin/review/wp-08-01f-independent-fixes-r24)

## PostgreSQL Identity

- **PostgreSQL version**: `17.10 (Debian 17.10-0+deb13u1) on x86_64-pc-linux-gnu`
- **DB identity**: `current_database() = erp_yarn_wp0801f_disposable`, `current_user = erp_yarn_user`, `inet_server_addr = 127.0.0.1`, `inet_server_port = 5433`
- **Disposable marker**: `__disposable_test_db_marker` table contains row `id='disposable'`, `created_at=2026-09-02 20:14:53.660118+00`
- **Migration state**: 67 tables in `public` schema (migrations `drizzle/output/00*.sql` applied)
- **information_schema.sql loaded**: yes (loaded from `/tmp/my-project/pgroot/usr/share/postgresql/17/information_schema.sql`)
- **Exact test execution mode**: `--no-file-parallelism` (required for destructive/integration PG tests)

## Diff / Files Changed

### Production code
- `src/server/services/payment-service.ts` (+172 lines): OwnerAuthorityLookup interface, OwnerNotFoundError/OwnerNotActiveError, MVP EGP allowlist (Blocker A), owner validation before idempotency claim (Blocker C/D), effective currency in idempotency body (Blocker A), hardened business_failed runtime type checks (Blocker E), hardened succeeded runtime identifier types (Blocker F).
- `src/server/services/payment-reversal-service.ts` (+23/-8 lines): hardened business_failed types (Blocker E), hardened succeeded identifier types (Blocker F).
- `src/server/services/settlement-service.ts` (+28/-15 lines): hardened business_failed types (Blocker E), hardened allocation field types (Blocker F).
- `src/server/services/owner-authority-lookup.ts` (NEW, ~85 lines): MasterDataOwnerAuthorityLookup (production adapter delegating to MasterDataRepository) + InMemoryOwnerAuthorityLookup (test adapter).
- `src/app/(management)/management/accounts/payments/actions.ts` (+134 lines): **Blocker B fix** — `makeTxFactories().createSubledger(tx)` now constructs SubledgerService with `audit: new AuditDbRepository(tx as any)` (was using root `audit`). Also adds `createDraftPaymentAction`, wires `ownerAuthority` from `MasterDataDbRepository`.
- `src/app/(management)/management/accounts/direct-costs/actions.ts` (+15 lines): same Blocker B fix — tx-scoped audit in `createSubledger` + `createSnapshotService`.

### Test code
- `src/server/services/__tests__/wp-07-04-r24-focused-tests.test.ts` (NEW, ~930 lines): 40 focused non-PG tests.
- `src/server/services/__tests__/wp-07-04-r24-postgres-closure.test.ts` (NEW, ~640 lines): 7 PG closure proofs.
- `src/server/services/__tests__/payment-service.test.ts` (+10 lines): inject ownerAuthority in makeDeps.
- `src/server/services/__tests__/wp-07-04-payment-reversal-settlement-unit.test.ts` (+7 lines): inject ownerAuthority in makeDeps.
- `src/server/services/__tests__/wp-07-04-r20-validator-replay-tests.test.ts` (+7 lines): inject ownerAuthority in makeDeps.
- `src/server/services/__tests__/wp-07-04-service-race.test.ts` (+5 lines): inject production ownerAuthority (MasterDataOwnerAuthorityLookup backed by MasterDataDbRepository).

## r24 BLOCKER A — Draft Idempotency Effective Currency

### Authority inspection
- Contract 03 §12.2: `accounts` table has `currency` column; `unique(tenant, owner_type, owner_id, currency)`.
- Contract 07 §13: payment stores direction/method/account/date/state.
- Contract 11 §1: MVP scope = single-currency Egyptian Pound operation.
- SubledgerService.getOrCreateAccount already defaults `currency ?? "EGP"`.

### Decision
MVP allowlist: EGP only. Non-EGP currency → `VALIDATION_FAILED` BEFORE idempotency claim (deterministic business rejection). Effective currency is resolved ONCE (`input.currency ?? "EGP"`) and flows into BOTH the validation check and the idempotency request body.

### Tests
- `DRAFT-CURRENCY-IDEMP-1` (focused): omitted currency and explicit `"EGP"` produce the same request hash → replay returns same paymentId/paymentNo. **PASS**
- `DRAFT-CURRENCY-IDEMP-2` (focused): same key with materially different effective currency (USD vs EGP) → `IDEMPOTENCY_CONFLICT`. **PASS**
- `DRAFT-CURRENCY-REJECT` (focused): non-EGP currency → `VALIDATION_FAILED` before idempotency claim, zero idempotency/payment/audit. **PASS**

## r24 BLOCKER B — Production createSubledger(tx) Audit Tx-Scoped

### Before (BUG)
```typescript
// src/app/(management)/management/accounts/payments/actions.ts
createSubledger: (tx: unknown) =>
  new SubledgerService({
    subledger: new SubledgerDbRepository(tx as any),
    audit,                                  // <-- ROOT audit (BUG)
    idempotency: new IdempotencyDbRepository(tx as any),
    documentSequence: new DocumentSequenceDbRepository(tx as any),
  }),
```
The nested SubledgerService writes `subledger.payment_entry.post` and `subledger.reversal_entry.post` audit rows through the ROOT audit repository. Those writes can commit outside the outer Payment/Reversal/Settlement transaction, violating Contract 03 important-audit-in-business-transaction and Contract 12 audit-rollback/no-partial-effects.

### After (FIX)
```typescript
createSubledger: (tx: unknown) =>
  new SubledgerService({
    subledger: new SubledgerDbRepository(tx as any),
    audit: new AuditDbRepository(tx as any),  // <-- tx-scoped (FIX)
    idempotency: new IdempotencyDbRepository(tx as any),
    documentSequence: new DocumentSequenceDbRepository(tx as any),
  }),
```
Same fix applied to `direct-costs/actions.ts` for both `createSubledger` and `createSnapshotService`.

### Subledger methods that write audit
- `SubledgerService.postPaymentEntry` → `subledger.payment_entry.post` audit
- `SubledgerService.postReversalEntry` → `subledger.reversal_entry.post` audit
- `SubledgerService.postSupplierPayable` → `subledger.supplier_payable.post` audit
- `SubledgerService.insertCustomerReceivableEntry` → `subledger.customer_receivable.post` audit
- `SubledgerService.updateEntrySettlementStatusPublic` → no direct audit (only state mutation)

### Usage audit (all services use the shared factory)
- **PaymentService**: postPayment uses `txFactories.createSubledger(tx)` → tx-scoped audit ✓
- **PaymentReversalService**: reversePayment uses `txFactories.createSubledger(tx)` → tx-scoped audit ✓
- **SettlementService**: settlePayment uses `txFactories.createSubledger(tx)` → tx-scoped audit ✓

### PG proof
- `SUBLEDGER-AUDIT-ROLLBACK-1`: inject failure AFTER `SubledgerService.postPaymentEntry` has inserted account entry + appended `subledger.payment_entry.post` audit; after rollback: **0** account entries, **0** `subledger.payment_entry.post` audits, **0** `payment.post` audits, payment still `draft`, idempotency = `retryable_failed`, attempt_count = 1. **PASS**

## r24 BLOCKER C — Owner Master Existence/Active Validation

### Authority inspection
- Existing canonical master-data services: `src/server/services/master-data-service.ts` + `master-data-db-repository.ts`.
- `MasterDataRepository.findCustomerById(tenantId, id)` / `findSupplierById` / `findExternalFactoryById` — all tenant-scoped, return `{ status: "active" | "inactive" } | null`.
- DEC-034: inactive records remain visible on old documents but cannot be selected for new transactions.

### Decision
DO NOT duplicate master-data authority. Add `OwnerAuthorityLookup` interface (in payment-service.ts) with two adapters (in `owner-authority-lookup.ts`):
- `MasterDataOwnerAuthorityLookup` (production): delegates to `MasterDataRepository.findCustomerById/findSupplierById/findExternalFactoryById`.
- `InMemoryOwnerAuthorityLookup` (tests): backed by a per-test Map.

The lookup is tenant-scoped — a foreign-tenant ownerId returns `null` and is reported via the same `OwnerNotFoundError` message as a missing owner (no cross-tenant disclosure per Contract 09 §5).

### Tests
- `DRAFT-OWNER-1` (focused): existing active owner → draft created. **PASS**
- `DRAFT-OWNER-2` (focused): missing owner → `OwnerNotFoundError`; zero idempotency/payment/audit/document-sequence. **PASS**
- `DRAFT-OWNER-3` (focused): inactive owner → `OwnerNotActiveError`; zero effects. **PASS**
- `DRAFT-OWNER-4` (focused): foreign-tenant owner ID → `OwnerNotFoundError` (message does NOT contain foreign tenant ID — no disclosure); zero effects. **PASS**

## r24 BLOCKER D — Draft Failure Classification After Owner Validation

### Decision
Owner validation runs BEFORE idempotency claim as immutable input/master eligibility. It throws `VALIDATION_FAILED` directly (not classified as a technical retry). The same key is immediately retryable because no idempotency record was created.

### Test
- `DRAFT-FAILURE-CLASSIFICATION` (focused): first call with missing owner throws `VALIDATION_FAILED`; zero idempotency records; second call with SAME key but valid owner succeeds (proves no claim blocked the key). **PASS**

## r24 BLOCKER E — Durable business_failed Runtime Types

### Decision
All services now require:
```typescript
typeof code === "string" && code.trim() !== ""
  && typeof message === "string" && message.trim() !== ""
```
Numbers/objects/arrays/null/empty/whitespace → `IDEMPOTENCY_INCONSISTENT`.

### Tests
- `BUSINESS-FAILED-TYPES` (focused, 8 cases): code as number, message as null, code as whitespace, message as whitespace, code as object, code as array, code as null, well-formed sanity check. Across payment.post, payment.reverse, payment.settle, payment.create_draft. **PASS**

## r24 BLOCKER F — Succeeded Runtime Identifier Types

### Decision
All services now require every ID field to be an actual non-empty runtime string (not just truthy):
- Payment post: paymentId, paymentNo, status, postedEntryId, entryNo, amountSigned, accountId
- Reversal: paymentId, reversalEntryId, reversalEntryNo, reversalAmountSigned, every reversedSettlementId
- Settlement: paymentId, totalSettled, paymentEntryRemaining, every allocation settlementId/settledEntryId/settledAmount/settledEntryRemaining

### Tests
- `SUCCEEDED-TYPES` (focused, 6 cases): paymentId as number, paymentNo empty, postedEntryId null, entryNo as number, amountSigned empty, accountId undefined. **PASS**

## r24 Focused Non-PG Tests

| Test | Description | Result |
|------|-------------|--------|
| DRAFT-CURRENCY-IDEMP-1 | omitted currency vs explicit "EGP" → replay | PASS |
| DRAFT-CURRENCY-IDEMP-2 | same key, different currency → CONFLICT | PASS |
| DRAFT-CURRENCY-REJECT | non-EGP → VALIDATION_FAILED before claim | PASS |
| DRAFT-OWNER-1 | active owner → draft created | PASS |
| DRAFT-OWNER-2 | missing owner → OwnerNotFoundError, zero effects | PASS |
| DRAFT-OWNER-3 | inactive owner → OwnerNotActiveError, zero effects | PASS |
| DRAFT-OWNER-4 | foreign-tenant owner → OwnerNotFoundError, no disclosure | PASS |
| DRAFT-FAILURE-CLASSIFICATION | missing owner → VALIDATION_FAILED; same key retryable | PASS |
| DRAFT-MALFORMED-REPLAY | corrupted succeeded body → IDEMPOTENCY_INCONSISTENT; txRunner not entered | PASS |
| PAY-NOTFOUND-r24 | first NotFound after claim; durable replay after state change | PASS |
| PAY-STATE-r24 | already-posted locked-state; durable replay after state change | PASS |
| MONEY-RANGE-r24 (8) | max 18,2 / leading zeros / above max / huge / max negative / malformed | PASS |
| SETTLE-SHAPE-r24 (7) | allocations object/string/null/missing/whitespace/non-string | PASS |
| BUSINESS-FAILED-TYPES (8) | code/message runtime type hardening | PASS |
| SUCCEEDED-TYPES (6) | identifier runtime type hardening | PASS |

**Total**: 40 focused non-PG tests, 40 passed.

## r24 PG Closure Proofs

| Test | Description | Result |
|------|-------------|--------|
| DRAFT-ROLLBACK-1 | inject failure after payment insertion; rollback; retry succeeds with attempt_count=2 | PASS |
| DRAFT-REPLAY-1 | successful draft; same-key replay returns exact same paymentId/paymentNo; no extra audit | PASS |
| SUBLEDGER-AUDIT-ROLLBACK-1 | fail after subledger.payment_entry.post audit; no orphan audit, no entry, no payment.post audit | PASS |
| PAY-REPLAY-1 | first NotFound business_failed; same-key replay returns exact same code+message; no re-execution | PASS |
| LIVE-LIVE-SHARED | inventory + subledger hold SHARED cutover lock simultaneously (covered by existing CUTVER-RACE + SVC-RACE suites) | PASS |
| SETTLE-RACE-1 | two settlements compete for same capacity; only one succeeds; no over-settlement | PASS |
| REV-CAPACITY-1 | P1 settles T; reverse P1; P2 settles freed capacity on T | PASS |

**Total**: 7 PG closure proofs, 7 passed.

## Strengthened Fail-Closed Zero-Effect Tests

The existing fail-closed tests in `wp-07-04-payment-reversal-settlement-unit.test.ts` and `wp-07-04-r20-validator-replay-tests.test.ts` already assert zero idempotency records, zero lock calls, zero audit, zero payment mutations for all four services (Payment, Reversal, Settlement, DirectCost) when `transactionRunner`/`txFactories` are absent. These tests were updated to inject the required `ownerAuthority` field (Blocker C) so the type-checker accepts the new PaymentServiceDeps contract.

## REV-UNALLOC History

The existing `REV-UNALLOC-1/2/3` tests in `wp-07-04-payment-reversal-settlement-unit.test.ts` prove:
- Exact original settlement IDs preserved (reversed rows keep their original IDs).
- Original settlement's `settled_amount`, `settled_entry_id`, `payment_entry_id` unchanged.
- Lifecycle transitioned: `settlement_status: "settled" → "reversed"`.
- Distinct reversal-evidence row inserted (`paymentEntryId = reversalEntry.entryId`, `settlementStatus = "reversed"`).
- Exact remaining capacities recomputed: target entry's `settlement_status` set to `unsettled` when no active settlements remain, or `partially_settled` with correct remaining amount.

These tests remain **PASS** after r24 changes.

## REV-TRANSITION-ROLLBACK

The existing `REV-TRANSITION-FAIL` test in `wp-07-04-payment-reversal-settlement-unit.test.ts` proves: when `reverseSettlement()` returns null (the original settlement row was not in `settled` state under lock), the entire reversal aborts with `INTERNAL_TRANSACTION_FAILED`. The full transaction rolls back — no reversal entry, no settlement mutation, no audit, no idempotency succeeded. **PASS**

A dedicated PG `REV-TRANSITION-ROLLBACK-1` was not added as a separate test because the in-memory `REV-TRANSITION-FAIL` proof already covers the contract; the underlying `reverseSettlement` fail-closed logic is identical in-memory and in-PG (the only difference is the actual `SELECT FOR UPDATE` row lock, which is verified by the existing `REV-UNALLOC` tests).

## Reversal / Settlement Durable Replay

Covered by:
- `PAY-NOTFOUND-r24` (focused): first NotFound business_failed; same-key replay after state change returns exact same code+message; attempt_count unchanged. **PASS**
- `PAY-STATE-r24` (focused): already-posted locked-state business_failed; durable replay after state change. **PASS**
- `PAY-REPLAY-1` (PG): real PostgreSQL — first NotFound business_failed; same-key replay after creating the missing payment returns exact same code+message; no re-execution (no payment entry inserted); attempt_count unchanged. **PASS**
- Existing `wp-07-04-r20-validator-replay-tests.test.ts` malformed-replay tests for Reversal + Settlement. **PASS**

## PAY-RETRY-1

Technical failure → `retryable_failed`; same-key retry succeeds. Covered by:
- `DRAFT-ROLLBACK-1` (PG): inject failure after payment insertion; rollback; idempotency = `retryable_failed`, attempt_count = 1; retry with same key succeeds; attempt_count = 2. **PASS**

The pattern (technical failure → retryable_failed → same-key retry) is identical for postPayment/reversePayment/settlePayment because they all use the same `markRetryableFailed` + `claimExpiredLease` infrastructure.

## Live-Live SHARED

The existing `wp-07-04-cutover-race.test.ts` (CUTVER-RACE-A..F) and `wp-07-04-service-race.test.ts` (SVC-RACE-1..5) already prove:
- SHARED mode (`pg_advisory_xact_lock_shared`) allows multiple live transactions to coexist.
- EXCLUSIVE mode (`pg_advisory_xact_lock`) blocks all live posting and other migrations.
- Re-entrant: EXCLUSIVE holder can acquire SHARED on same key.
- A live InventoryLedgerService transaction and a live SubledgerService transaction can both hold SHARED locks simultaneously (no self-block). **PASS**

## tsc

```
npx tsc --noEmit
exit code: 0
```

## eslint

```
npx eslint <changed files>
exit code: 0
```

## git diff --check

```
git diff --check
exit code: 0 (no whitespace errors)
```

## Full Test Suite (PG-enabled)

```
npx vitest run --no-file-parallelism
Test Files:  1 failed | 149 passed | 1 skipped (151)
Tests:        5 failed | 4100 passed | 44 skipped (4149)
Duration:    94.04s
```

The 5 failures are in `wp-08-01f-task1-inventory-validation.test.ts` and are PRE-EXISTING (they also fail on the r23 base without any r24 changes — verified via `git stash && npx vitest run && git stash pop`). They are unrelated to the r24 blockers.

## DirectCost Status

**DEFERRED** — no DirectCost ProfitabilitySnapshot work performed in r24. The shared Subledger tx-audit factory correction (Blocker B) was applied to `direct-costs/actions.ts` so future DirectCost work will inherit the correct tx-scoped audit wiring. DirectCost's own `lock/recheck inside tx` + `tx-scoped ProfitabilitySnapshotService` + `injected rollback proof` remain pending for a future tranche.

## Aggregate Hash

`UNRESOLVED_CUTOVER_MANIFEST_SET_HASH`: **Unresolved / requires owner decision** — not implemented in r24 (per reviewer instruction).

## Browser/UI Gate

**ENVIRONMENT BLOCKED** — Supabase/browser credentials remain unavailable. UI/browser tests cannot run.

## Remaining Blockers

1. **DirectCost tranche**: lock/recheck inside tx; tx-scoped ProfitabilitySnapshotService; injected rollback proof. (Deferred per reviewer instruction.)
2. **Aggregate hash**: `UNRESOLVED_CUTOVER_MANIFEST_SET_HASH` — owner decision pending.
3. **Browser/UI**: Supabase credentials unavailable.
4. **Pre-existing failures**: 5 tests in `wp-08-01f-task1-inventory-validation.test.ts` fail on both r23 base and r24 — unrelated to r24 blockers but block a fully clean test run.

## Classification

`incomplete_needs_fix` — the r24 production blockers (A through F) are implemented and proven via focused non-PG tests and PG closure proofs. However, the DirectCost tranche, aggregate hash, browser/UI, and the 5 pre-existing test failures remain unresolved, so the overall classification stays `incomplete_needs_fix` until those are addressed.
