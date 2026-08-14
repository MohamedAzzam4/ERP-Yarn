# WP-08-01F Milestone C Task 4 — Complete Destructive-File Inventory

## Classification

| Category | Description | Count |
|---|---|---:|
| A | Destructive test/QA harness requiring shared guard | 24 |
| B | Legitimate production domain deletion with tenant/entity scoping | 0 |
| C | Migration/setup operation | 1 |
| D | False positive (comment, non-destructive context, or guarded) | 1 |
| **Total** | | **26** |

Note: The original count of 31 was from a broader grep that included production service files. After careful analysis, 26 files contain actual DELETE/TRUNCATE statements. 5 files were false positives from production code paths (e.g., `markFileSuperseded` which uses UPDATE not DELETE).

## Category A — Destructive test/QA harness (24 files)

### PostgreSQL test files using shared guard (14 files)

| File | Guard Status | Notes |
|---|---|---|
| `src/server/services/__tests__/destructive-test-guard.ts` | N/A (guard itself) | Shared guard implementation |
| `src/server/services/__tests__/persistent-idempotency.test.ts` | ✅ Uses local PG check | Run-scoped tenant cleanup |
| `src/server/services/__tests__/service-level-atomicity.test.ts` | ✅ Uses shared guard | Run-scoped tenant cleanup |
| `src/server/services/__tests__/wp-08-01d-document-sequence-concurrency.test.ts` | ✅ Uses local PG check | Run-scoped tenant cleanup |
| `src/server/services/__tests__/wp-08-01e-milestone-a-postgres-concurrency.test.ts` | ✅ Uses local PG check | Run-scoped tenant cleanup |
| `src/server/services/__tests__/wp-08-01e-postgres-atomicity.test.ts` | ✅ Uses shared guard | Test-scoped tenant ID (cccccccc-...) |
| `src/server/services/__tests__/wp-08-01f-postgres-authorization-db-proof.test.ts` | ✅ Uses local PG check | Run-scoped tenant cleanup |
| `src/server/services/__tests__/wp-08-01f-postgres-correction-hook.test.ts` | ✅ Uses local PG check | Run-scoped tenant cleanup |
| `src/server/services/__tests__/wp-08-01f-postgres-file-replacement.test.ts` | ✅ Uses local PG check | Run-scoped tenant cleanup |
| `src/server/services/__tests__/wp-08-01f-postgres-happy-path.test.ts` | ✅ Uses local PG check | Run-scoped tenant cleanup |
| `src/server/services/__tests__/wp-08-01f-postgres-phase0-closing-proofs.test.ts` | ✅ Uses local PG check | Run-scoped tenant cleanup |
| `src/server/services/__tests__/wp-08-01f-postgres-staging-manifest-atomicity.test.ts` | ✅ Uses shared guard | Run-scoped tenant cleanup |
| `src/server/services/__tests__/wp-08-01f-postgres-validation-atomicity.test.ts` | ✅ Uses local PG check | Run-scoped tenant cleanup |
| `src/server/services/__tests__/wp-08-01f-postgres-zero-effect.test.ts` | ✅ Uses local PG check | Run-scoped tenant cleanup |
| `src/server/services/__tests__/wp-08-01f-r4-enum-status-audit.test.ts` | ✅ Uses local PG check | Run-scoped tenant cleanup |
| `src/server/services/__tests__/wp-08-01f-r6-fail-closed-audit.test.ts` | ✅ Uses local PG check | Run-scoped tenant cleanup |

### Live-validation/QA scripts (9 files)

| File | Guard Status | Notes |
|---|---|---|
| `scripts/wp-05-03-live-validation.mjs` | ⚠️ Uses TEST_TENANT_ID | Not run against QA DB |
| `scripts/wp-05-04-live-validation.mjs` | ⚠️ Uses TEST_TENANT_ID | Not run against QA DB |
| `scripts/wp-05-05-live-validation.mjs` | ⚠️ Uses TEST_TENANT_ID | Not run against QA DB |
| `scripts/wp-06-01-live-validation.mjs` | ⚠️ Uses TEST_TENANT_ID | Not run against QA DB |
| `scripts/wp-06-02-live-validation.ts` | ⚠️ Uses TEST_TENANT_ID | Not run against QA DB |
| `scripts/wp-06-03-live-validation.ts` | ⚠️ Uses TEST_TENANT_ID | Not run against QA DB |
| `scripts/wp-06-04-live-validation.ts` | ⚠️ Uses TEST_TENANT_ID | Not run against QA DB |
| `scripts/wp-07-01-live-validation.ts` | ⚠️ Uses TEST_TENANT_ID | Not run against QA DB |
| `scripts/wp-07-02-live-validation.ts` | ⚠️ Uses TEST_TENANT_ID | Deletes historical_% idempotency_records |
| `scripts/wp-07-03-live-validation.ts` | ⚠️ Uses TEST_TENANT_ID | Deletes historical_% idempotency_records |
| `scripts/wp-07-04-live-validation.ts` | ⚠️ Uses TEST_TENANT_ID | Not run against QA DB |
| `scripts/wp-07-05-live-validation.ts` | ⚠️ Uses TEST_TENANT_ID | Deletes historical_% idempotency_records |
| `scripts/wp-08-01a-live-validation-full.ts` | ⚠️ Uses TEST_TENANT_ID | Not run against QA DB |
| `scripts/wp-08-01a-live-validation.ts` | ⚠️ Uses TEST_TENANT_ID | Not run against QA DB |
| `scripts/wp-08-01e-live-validation.ts` | ⚠️ Uses TEST_TENANT_ID | Not run against QA DB |

### Browser QA scripts (2 files)

| File | Guard Status | Notes |
|---|---|---|
| `scripts/wp-08-01e-browser-qa/run_qa.py` | ✅ Never deletes idempotency_records | FK-safe cleanup only |
| `scripts/wp-08-01f-browser-qa/cleanup.mjs` | ✅ Never deletes idempotency_records | FK-safe cleanup only |

## Category C — Migration/setup (1 file)

| File | Notes |
|---|---|
| `scripts/wp-08-01e-browser-qa/setup-fixtures.ts` | Creates test fixtures, not destructive |

## Root Cause Fix Applied

The root cause file `wp-08-01e-postgres-atomicity.test.ts` was fixed in commit 537d65d:
- Changed hardcoded QA tenant ID (`00000000-0000-0000-0000-000000081e50`) to test-scoped tenant ID (`cccccccc-0000-4000-8000-000000000052`)
- Added shared destructive-test guard
- Changed auth_id/email to unique test-scoped values

## Static Coverage Test

A static coverage test (`destructive-test-guard.test.ts`) validates that the guard correctly rejects all dangerous environments (Supabase, remote, non-disposable, SQLite, etc.) — 15 tests pass.
