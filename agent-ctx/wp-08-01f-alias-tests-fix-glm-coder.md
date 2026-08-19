# WP-08-01F — Fix 6 Failing PostgreSQL Alias Atomicity Tests

**Task ID:** wp-08-01f-alias-tests-fix
**Agent:** glm-coder
**Base commit:** 6ac7f3f
**Branch:** phase/08-01f-historical-migration-screens

## Context

Follow-up to `wp-08-01f-closure-glm-coder` (which added the alias-atomicity
test file + the production code it exercises). Six tests in
`src/server/services/__tests__/wp-08-01f-postgres-alias-atomicity.test.ts`
were failing against the real PostgreSQL disposable DB. Previous work
records in this directory were consulted.

## Failing Tests + Root Causes + Fixes

### PG-ALIAS-2 — alias approval with invalid target fails closed
- **Symptom:** test expected `.rejects.toThrow(/INVALID_ALIAS_TARGET|InvalidAliasTarget/i)`
  but the production error message was `"Target master '...' for alias '' not
  found or does not match entity type 'customer' in the caller's tenant."`
  — neither substring matched.
- **Root cause:** `InvalidAliasTargetError` stored the code in the `.code`
  field but did not surface it in the message text. The test regex matches
  the message only. Same issue would silently break the UI panel's fallback
  regex matching (`alias-mapping-panel.tsx` line 164:
  `else if (/INVALID_ALIAS_TARGET/.test(message)) errorCode = ...`).
- **Fix (production):** Prefix the message with `INVALID_ALIAS_TARGET: ` in
  `historical-validation-service.ts::InvalidAliasTargetError`. Aligns with
  the convention already used by `return-request-service.ts`
  (`"CONFIGURATION_ERROR: transactionRunner and txFactories ..."`).
  Existing tests that substring-match the message (e.g.
  `historical-alias-mapping-service.test.ts` `toBeInstanceOf` /
  `.code === "INVALID_ALIAS_TARGET"`) still pass.

### PG-ALIAS-6 — alias remap invalidates downstream approvals + review items + batch statuses
- **Symptom:** after the remap, `import_batch_approvals.is_current` was
  still `true` (expected `false`).
- **Root cause:** the test's `makeServices` factory did NOT wire the four
  material-remap downstream-invalidation callbacks on the
  `HistoricalValidationService` deps (`invalidateCurrentApprovals`,
  `supersedeReviewItemsForBatch`,
  `resetBatchValidationAndReconciliationStatuses`, `findLatestReportVersion`).
  These callbacks are optional in the service interface, so the remap path
  silently skipped invalidation. The production wiring in
  `src/app/(management)/management/admin/migration/actions.ts::getMigrationServices`
  wires them — the test factory was missing them.
- **Fix (test):** Wire the four callbacks in `makeServices`, mirroring the
  production wiring. Each callback constructs a tx-scoped repository
  (`HistoricalCommitDbRepository` / `HistoricalReconciliationDbRepository`)
  around the `tx` handle and delegates to the existing repository methods
  (`invalidateCurrentApprovalsForBatch`, `supersedeReviewItemsForBatch`,
  `resetBatchValidationAndReconciliationStatuses`, `findLatestReportVersion`).
  Added `HistoricalReconciliationDbRepository` to the test's imports.

### PG-ALIAS-8 + PG-ALIAS-9 — DEFECT 2 occurrenceCount persistence + idempotent revalidation
- **Symptom:** `PostgresError: duplicate key value violates unique
  constraint "import_files_tenant_batch_hash_type_unique_idx"` during
  `seedFileAndStagingRow`.
- **Root cause:** `seedFileAndStagingRow` hardcoded `file_hash='sha256:test'`
  AND `is_current=true` AND `file_type='source'` for every call. When the
  test called it 3× (PG-ALIAS-8) / 2× (PG-ALIAS-9) for the same (tenant,
  batch), it violated BOTH the
  `import_files_tenant_batch_hash_type_unique_idx` (same hash+type) AND
  the `import_files_tenant_batch_type_current_unique_idx` partial unique
  (same type with `is_current=true`).
- **Fix (test):** Make `file_hash` unique per file (`'sha256:' + fileId`)
  AND set `is_current` to `true` only for `rowNum === 1` (subsequent calls
  use `is_current=false`). The staging-row `is_current` is still `true`
  on every call, so `findStagingRowsForBatch` (which filters
  staging_rows.is_current=true, not files.is_current) still returns all
  seeded rows. PG-ALIAS-7 (which calls `seedFileAndStagingRow` once with
  rowNum=1) is unaffected.

### PG-ALIAS-11 — submitForApproval rejects when exception alias not approved
- **Symptom:** the resubmit `submitForApproval` (after approving the
  exception alias) threw `AliasMappingVersionMismatchError: ... has
  mappingVersion='v1' but the batch's current mappingVersion='1.0'`.
- **Root cause:** the test seeded the batch with `mapping_version='1.0'`
  but approved the exception alias with `mappingVersion: 'v1'`. The
  reconciliation service's DEFECT 7 mappingVersion binding check correctly
  fired on the resubmit.
- **Fix (test):** Pass `mappingVersion: '1.0'` (matching the batch's
  `mapping_version`) when approving the exception alias. The first
  `submitForApproval` (which the test expected to throw
  `UNRESOLVED_ALIAS_MAPPING|alias mapping`) still correctly throws
  `UnresolvedAliasMappingError` because the exception alias is
  unresolved at that point — the regex matches.

### PG-ALIAS-12 — findMasterForAlias supports fiber_type/product_type/item
- **Symptom:** `PostgresError: invalid input value for enum item_kind:
  "raw_material_batch"`.
- **Root cause:** `seedInventoryItem` used `"raw_material_batch"` as the
  `item_kind` enum value. The `item_kind` pgEnum only allows `raw_material`,
  `single_yarn`, `twisted_yarn` — `raw_material_batch` is a TABLE name, not
  an enum value.
- **Fix (test):** Use `"raw_material"` instead. The
  `findMasterForAlias("item"|"batch"|"lot", itemId)` switch already queries
  `inventory_items` correctly — only the seed was wrong.

## Verification

```
$ DATABASE_URL='postgresql://erp_yarn_user:stub@127.0.0.1:5433/erp_yarn_wp0801f_disposable' \
  ERP_REQUIRE_WP0801F_POSTGRES_PROOF=1 ERP_ALLOW_DESTRUCTIVE_LOCAL_TEST_DB=1 \
  npx vitest run src/server/services/__tests__/wp-08-01f-postgres-alias-atomicity.test.ts

 ✓ src/server/services/__tests__/wp-08-01f-postgres-alias-atomicity.test.ts (12 tests) 9806ms
     ✓ PG-ALIAS-1 ... ✓ PG-ALIAS-12
 Test Files  1 passed (1)
      Tests  12 passed (12)
```

```
$ npx tsc --noEmit
(no output, exit 0)
```

`npx vitest run src/server/services/__tests__/historical-alias-mapping-service.test.ts`
also still passes (20/20) — confirms the `InvalidAliasTargetError` message
change is non-breaking for tests that use `toBeInstanceOf` /
`.code === "INVALID_ALIAS_TARGET"` rather than substring-matching the
message.

## Files Changed

- `src/server/services/historical-validation-service.ts` — prefixed the
  `InvalidAliasTargetError` message with `INVALID_ALIAS_TARGET: ` (1 line).
- `src/server/services/__tests__/wp-08-01f-postgres-alias-atomicity.test.ts`:
  - added `HistoricalReconciliationDbRepository` import.
  - `makeServices`: wired the four material-remap downstream-invalidation
    callbacks.
  - `seedFileAndStagingRow`: unique `file_hash` per file +
    `is_current` only on `rowNum === 1`.
  - `seedInventoryItem`: use `"raw_material"` enum value.
  - PG-ALIAS-11: changed exception-alias approval `mappingVersion` from
    `"v1"` to `"1.0"` (matches the batch's `mapping_version`).

## Not Done (per task rules)

- Did NOT push to remote.
- Did NOT modify any other tests beyond the 6 explicitly requested.
- Did NOT touch the 2 pre-existing failures in
  `wp-08-01f-postgres-submission-atomicity.test.ts` (SUB-9B + SUB-11 —
  unrelated to the alias-atomicity suite; SUB-11 fails on a
  `users_auth_id_unique_idx` constraint violation in its own setup, SUB-9B
  expects a rejection that no longer fires). These were failing before this
  task and are out of scope.
