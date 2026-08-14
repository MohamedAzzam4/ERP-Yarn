# Task 3 — Root Cause of Missing Idempotency Records

## Finding

**Root cause: C — Rows were deleted by test cleanup code.**

The file `src/server/services/__tests__/wp-08-01e-postgres-atomicity.test.ts` contains this line in its `afterAll` hook (line 476):

```typescript
await sql`DELETE FROM idempotency_records WHERE tenant_id = ${"00000000-0000-0000-0000-000000081e50"}`;
```

This deletes ALL idempotency records for the QA tenant (`00000000-0000-0000-0000-000000081e50`).

## How it happened

1. The B1a/B1b/B1c browser QA operations created idempotency records in the Supabase QA database (via the production server's `IdempotencyDbRepository`).
2. Later, when the full vitest suite was run with `DATABASE_URL` pointing to the Supabase pooler, the `wp-08-01e-postgres-atomicity.test.ts` test executed.
3. This test's safety guard was too weak — it only checked `DATABASE_URL?.startsWith("postgres")` without verifying the database was local/disposable. Since the Supabase URL starts with `postgresql://`, the test ran.
4. The test's `afterAll` hook deleted ALL idempotency records for the QA tenant, destroying the B1a/B1b/B1c evidence.
5. The Milestone A fix (adding `isLocalDisposable` check) prevents this from happening again, but cannot recover the deleted rows.

## Evidence

- Direct PostgreSQL query confirms: 0 idempotency records exist for QA tenant
- Total table has only 4 rows (from old Aug 7 test runs for a different tenant)
- The deleting code is at `src/server/services/__tests__/wp-08-01e-postgres-atomicity.test.ts:476`
- The QA tenant ID `00000000-0000-0000-0000-000000081e50` is hardcoded in the test
- RLS is disabled on `idempotency_records` (rowsecurity=false)
- No triggers exist on the table
- FK constraints are satisfied (QA owner user exists)
- Direct INSERT test succeeds and the row is found
- Drizzle `.returning()` works correctly on the Supabase pooler

## Conclusion

The idempotency records WERE created by the production server during B1a/B1b/B1c operations. They were subsequently deleted by test cleanup code that ran against the production Supabase database due to an insufficient safety guard. The Milestone A fix prevents recurrence.

The active run's idempotency evidence is NON-RECOVERABLE. The records cannot be recreated without fabricating historical data, which is forbidden.
