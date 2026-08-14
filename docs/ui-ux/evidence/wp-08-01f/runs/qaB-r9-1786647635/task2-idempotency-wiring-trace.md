# Task 2 — Production Idempotency Wiring Trace

## 1. finalizeStaging

- **Server Action**: `finalizeStagingAction` in `actions.ts`
- **Domain service**: `HistoricalStagingService.finalizeStaging`
- **Idempotency scope**: `historical_staging.finalize`
- **Repository**: `HistoricalStagingDbRepository(db)` — non-tx-scoped
- **tenantId source**: `user.tenantId` from `getErpAuthContextWithRoles()`
- **Idempotency-key source**: `formData.get("idempotencyKey")` (hidden input, server-generated UUID)
- **Request-hash construction**: `claimIdempotency` hashes `{ importBatchId }` via `requestBody`
- **Claim location**: `this.deps.idempotency` (non-tx `IdempotencyDbRepository(db)`)
- **Owner-token handling**: `claim.record.ownerToken!` passed to `markSucceeded`
- **Transaction runner**: **NONE** — `finalizeStaging` does NOT use `transactionRunner`
- **Tx-scoped idempotency factory**: **NONE** — uses `this.deps.idempotency` directly
- **markSucceeded location**: Line 710, AFTER business writes (updateBatchStagedDataHash, updateBatchStatus, appendAuditLog)
- **markBusinessFailed/markRetryableFailed**: NOT called — no error handling wrapper
- **Result reference**: `entityType: "import_batch"`, `entityId: input.importBatchId`
- **Replay path**: `claimIdempotency` checks for existing succeeded record; if found, returns `replay`

**CRITICAL DEFECT**: `finalizeStaging` does NOT use `transactionRunner`. Business writes and `markSucceeded` are NOT atomic. If `markSucceeded` fails (e.g., `.returning()` returns null on Supabase pooler), the business writes persist but the idempotency record stays in `in_progress` state. This means:
- The batch transitions to `staged` but no succeeded idempotency record exists
- Replay will not find a succeeded record and will attempt re-execution
- The `markSucceeded` call uses `this.deps.idempotency` (non-tx), not a tx-scoped factory

## 2. finalizeCutoverManifest

- **Server Action**: `finalizeCutoverManifestAction` in `actions.ts`
- **Domain service**: `HistoricalStagingService.finalizeCutoverManifest`
- **Idempotency scope**: `historical_cutover_manifest.finalize`
- **Repository**: `HistoricalStagingDbRepository(db)` — non-tx-scoped
- **tenantId source**: `user.tenantId`
- **Idempotency-key source**: `formData.get("idempotencyKey")`
- **Claim location**: `this.deps.idempotency` (non-tx)
- **Transaction runner**: **NONE**
- **Tx-scoped idempotency factory**: **NONE**
- **markSucceeded location**: After `insertCutoverManifest`, `updateBatchCutoverManifestHash`, `appendAuditLog`
- **Result reference**: `entityType: "import_cutover_manifest"`, `entityId: manifest.id`

**CRITICAL DEFECT**: Same as finalizeStaging — no transaction, non-atomic.

## 3. runValidation

- **Server Action**: `runValidationAction` in `actions.ts`
- **Domain service**: `HistoricalValidationService.runValidation`
- **Idempotency scope**: `historical_validation.run`
- **Repository**: `HistoricalValidationDbRepository(db)` for claim; tx-scoped `createRepository(tx)` for writes
- **tenantId source**: `user.tenantId`
- **Claim location**: `this.deps.idempotency` (non-tx) — claim is OUTSIDE transaction
- **Transaction runner**: **YES** — `this.deps.transactionRunner`
- **Tx-scoped idempotency factory**: **YES** — `createIdempotency(tx)` creates tx-scoped `IdempotencyDbRepository`
- **markSucceeded location**: Line 623, INSIDE the transaction via `idemHandle` (tx-scoped)
- **markBusinessFailed/markRetryableFailed**: NOT called explicitly; transaction rollback handles failure
- **Result reference**: `entityType: "import_batch"`, `entityId: input.importBatchId`

**CORRECT**: Validation uses `transactionRunner` with tx-scoped `createIdempotency`. The `markSucceeded` is inside the transaction, so it's atomic with business writes. However, the initial `claimIdempotency` is outside the transaction (on `this.deps.idempotency`), which is correct — the claim must persist even if the transaction rolls back.

## 4. runReconciliation

- **Server Action**: `runReconciliationAction` in `actions.ts`
- **Domain service**: `HistoricalReconciliationService.runReconciliation`
- **Idempotency scope**: `historical_reconciliation.run`
- **Repository**: `HistoricalReconciliationDbRepository(db)` for claim; tx-scoped `createReconciliationRepository(tx)` for writes
- **tenantId source**: `user.tenantId`
- **Claim location**: `this.deps.idempotency` (non-tx)
- **Transaction runner**: **YES** (optional — `this.deps.transactionRunner`)
- **Tx-scoped idempotency factory**: **YES** — `createIdempotency(tx)`
- **markSucceeded location**: Inside `executeAtomically` function, within `transactionRunner` (line 1128)
- **Result reference**: `entityType: "import_batch"`, `entityId: input.importBatchId`

**CORRECT with caveat**: Reconciliation uses `transactionRunner` when available. The `markSucceeded` is inside the transaction. However, `transactionRunner` is optional (line 1136: `if (this.deps.transactionRunner)`), so if it's not configured, the code falls back to non-atomic execution. In the production wiring (actions.ts line 107-111), `transactionRunner` IS provided, so this is correct in production.

## Summary

| Command | Uses transactionRunner | Tx-scoped idempotency | Atomic markSucceeded | Defect |
|---|---|---|---|---|
| finalizeStaging | NO | NO | NO | **YES** — non-atomic |
| finalizeCutoverManifest | NO | NO | NO | **YES** — non-atomic |
| runValidation | YES | YES | YES | None |
| runReconciliation | YES (optional) | YES | YES (when tx runner present) | None in production |

## Root Cause of Missing Idempotency Records

The `IdempotencyDbRepository` uses Drizzle ORM's `.returning()` method for `insert` and `updateState`. On the Supabase transaction pooler with `prepare: false`, `.returning()` does not reliably return rows. This causes:

1. `insert` returns null → throws `IdempotencyConcurrentInsertError` (false positive)
2. `updateState` returns 0 → throws `IdempotencyOwnershipLostError` (false positive)

For `finalizeStaging` and `finalizeCutoverManifest`, which don't use `transactionRunner`, the `markSucceeded` call fails silently (the error is caught by the Server Action's generic error handler), leaving the idempotency record in `in_progress` state. The business writes persist because they're not in a transaction.

For `runValidation` and `runReconciliation`, which use `transactionRunner`, the `markSucceeded` failure causes the entire transaction to roll back. But the `claimIdempotency` (which is outside the transaction) already created an `in_progress` record. When the transaction rolls back, the `in_progress` record remains, and the business writes are rolled back too. On retry, `claimIdempotency` finds the `in_progress` record and either returns `in_progress` (if lease hasn't expired) or reclaims it.

However, the actual behavior observed is that ZERO idempotency records exist for the QA tenant. This suggests the `insert` itself failed (`.returning()` returned null → `IdempotencyConcurrentInsertError`), and the `claimIdempotency` retry logic didn't successfully recover.

**The fix**: Replace `.returning()` with a SELECT-after-INSERT/UPDATE pattern in `IdempotencyDbRepository`, similar to how `updateBatchStatus` was already fixed in the validation service.
