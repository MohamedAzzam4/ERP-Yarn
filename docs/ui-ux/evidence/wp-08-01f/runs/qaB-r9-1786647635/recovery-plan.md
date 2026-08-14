# WP-08-01F Recovery Plan — Fresh Authoritative Run

## Context

The active run `qaB-r9-1786647635` (batch `32fd0ab8`) is marked `NON_AUTHORITATIVE_IDEMPOTENCY_GAP` because its B1a/B1b/B1c idempotency records were deleted by test cleanup code (`wp-08-01e-postgres-atomicity.test.ts` afterAll hook, which hardcoded the QA tenant ID).

## Root Cause (fixed)

- `wp-08-01e-postgres-atomicity.test.ts` line 476 deleted all `idempotency_records` for the QA tenant
- The test's safety guard was too weak (`DATABASE_URL?.startsWith("postgres")` without checking for localhost/disposable DB)
- Milestone C fixed this by:
  1. Creating a shared `destructive-test-guard.ts` with 7 safety checks
  2. Replacing the hardcoded QA tenant ID with a test-scoped tenant ID
  3. Using the shared guard in all destructive PostgreSQL tests

## Recovery Plan

A completely NEW batch/run must repeat B1a→B1c after Milestone C passes.

### Steps

1. **Create a new Cycle B run ID** (e.g., `qaB-r10-<timestamp>`)
2. **Create a new batch** through the real authenticated management UI
3. **Upload a valid source** through the production private-storage action
4. **Poll DB** until `source_uploaded` (B1a)
5. **Finalize staging** through the real action (B1b-staging)
6. **Finalize cutover manifest** through the real action (B1b-manifest)
7. **Run validation** through the real action (B1b-validation)
8. **Run reconciliation** through the real action (B1c)
9. **Verify** that durable `succeeded` idempotency records exist for ALL operations
10. **Verify** that replay creates zero new effects
11. **Verify** that conflict is rejected
12. **Update RUN-STATE.json** with the new authoritative run

### What NOT to do

- Do NOT reuse batch `32fd0ab8` — it has already transitioned past the required states
- Do NOT fabricate historical idempotency records
- Do NOT skip any B1a/B1b/B1c step

### Prerequisites

- Milestone C must be committed and pushed
- The shared destructive-test guard must be in place
- The `wp-08-01e-postgres-atomicity.test.ts` must no longer reference the QA tenant ID
- All six gates must pass with exit 0

### Old Run Disposition

- Batch `32fd0ab8` remains at `review_required` / `matched` / `passed`
- 3 pending review items, 0 resolved
- Marked `NON_AUTHORITATIVE_IDEMPOTENCY_GAP` in RUN-STATE.json
- `nextStage` = `IDEMPOTENCY_REPLAY_PLAN`
- Do NOT proceed to B1d on this batch
