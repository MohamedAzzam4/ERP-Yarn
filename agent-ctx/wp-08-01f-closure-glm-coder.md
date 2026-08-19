# WP-08-01F Closure Work — Alias Defects + PG Proof Suites + UI

**Task ID:** wp-08-01f-closure
**Agent:** glm-coder
**Branch:** phase/08-01f-historical-migration-screens
**Base commit:** 6ac7f3f

## Summary

Fixed 8 reviewer-confirmed defects in the historical migration alias
mapping workflow, added 3 real PostgreSQL proof suites (PG-ALIAS-1..12,
SUB-9A/B/C/D + SUB-10 + SUB-11, COM-CONC-1/2A/2B), and added a minimal
alias UI panel + UI tests. All changes pass `npx tsc --noEmit` and
`npx eslint .` and the full existing test suite (3694 passed, 265
skipped — skipped tests require PostgreSQL destructive DB).

## Defects Fixed

- **DEFECT 1 (UI)**: Added `AliasMappingPanel` client component
  (`src/app/(management)/management/admin/migration/[batchId]/_components/alias-mapping-panel.tsx`)
  + wired it into the batch detail page. Shows current alias groups
  with sourceLabel, entityType, status, occurrenceCount, target if
  approved, approval metadata. Renders the approval/remap form via the
  existing `approveAliasMappingAction` server action. Renders exceptions
  separately with their `exceptionSourceRowIds`. Shows the explicit
  "No valid master exists yet. Create it through Master Data, then
  return here." hint when no target is entered. Extended the
  `MigrationAliasMappingDto` to include `groupId`, `occurrenceCount`,
  `exceptionSourceRowIds`, `isCurrent` for proper grouping.
- **DEFECT 2 (occurrenceCount)**: Added `updateAliasMappingOccurrenceCount`
  repository method + runValidation now persists the final group count
  per group AFTER processing all staging rows. Idempotent: overwrites
  (not increments), so re-validation against the same source data
  produces the same final count.
- **DEFECT 3 (exceptions)**: Added `createAliasException` service method
  + `createAliasExceptionAction` server action. Creates a separate
  current alias row with the same groupId but a different targetMasterId
  and explicit `exceptionSourceRowIds`. Group approval does NOT override
  an exception — `submitForApproval` already checks all current alias
  rows (including exceptions) must be approved.
- **DEFECT 4 (unknown entity type)**: Changed `detectEntityType` to
  return "unknown" instead of "customer" when no entity-type signal
  can be safely established. The alias is created with
  `status='needs_review'` so a human must classify it before
  submission.
- **DEFECT 5 (complete master types)**: Extended
  `MasterDataRepository` with `findFiberTypeById`,
  `findProductTypeById`, `findQualityParameterById`,
  `findInventoryItemById`. Updated `validateTargetMaster` in the
  validation service to support these entity types. Added
  `findMasterForAlias` method to `HistoricalCommitRepository` (and DB +
  in-memory impls) — supports supplier, customer, location, factory,
  fiber_type, product_type, quality_parameter, item/batch/lot. Fail-
  closed (returns false) for unsupported entity types.
- **DEFECT 6 (submit revalidates target master)**: Extended
  `submitForApproval`'s alias check to re-validate each target master
  via `commitRepo.findMasterForAlias`. Runs inside the batch row lock
  so a master inactivated between pre-claim and the lock is caught.
- **DEFECT 7 (mappingVersion binding)**: Added `isCurrent` defensive
  check + `mappingVersion` mismatch check (when both batch + alias have
  non-null mappingVersion). Added new error classes
  `AliasMappingVersionMismatchError`, `AliasMappingNotCurrentError`.
- **DEFECT 8 (commit revalidates aliases)**: Added alias revalidation
  inside the commit transaction under the batch row lock (after pre-
  existing preconditions). Re-reads all current alias mappings and
  checks: all are approved with non-null target, all are current, all
  target masters still resolve via `findMasterForAlias`, all
  mappingVersion values match the batch's locked mappingVersion. Fail-
  closed on any state change since dual approval. Added new error
  classes `CommitAliasRevalidationError`,
  `CommitUnresolvedAliasError`, `CommitInvalidAliasTargetError`,
  `CommitAliasNotCurrentError`, `CommitAliasMappingVersionMismatchError`.

## New PostgreSQL Test Suites

- **PG-ALIAS-1..12** (`wp-08-01f-postgres-alias-atomicity.test.ts`):
  Alias approval success, invalid target fail-closed, replay, conflict,
  remap supersedence, remap downstream invalidation, DEFECT 4 unknown
  entity type, DEFECT 2 occurrenceCount persistence + idempotent
  revalidation, DEFECT 3 createAliasException + group-vs-exception
  approval semantics, DEFECT 5 findMasterForAlias supports
  fiber_type/product_type/item masters.
- **SUB-9A/B/C/D + SUB-10 + SUB-11** (extended
  `wp-08-01f-postgres-submission-atomicity.test.ts`): DEFECT 6 master
  deletion since approval, DEFECT 7 alias not current, DEFECT 7
  mappingVersion mismatch + match, atomic under batch row lock, DEFECT
  8 commit revalidation under lock fail-closed.
- **COM-CONC-1/2A/2B** (extended `wp-08-01f-postgres-commit-atomicity.test.ts`):
  Concurrent commits on same batch (one wins via cutover lock, uses
  `Promise.allSettled`), concurrent commit vs target master deletion,
  concurrent commit vs alias supersession.

All tests use the existing PostgreSQL harness pattern (per-test unique
tenants, `checkDestructiveTestDbSafety`, `describeOrSkip`, no
audit_logs deletion, no audit trigger disabling).

## UI Tests

- `wp-08-01f-alias-mapping-ui.test.ts` (39 tests): Server action wiring
  for `approveAliasMappingAction` + `createAliasExceptionAction`,
  permission checks (`migration.review`, no `approverRole` from form),
  form-field contracts, error-code Arabic labels,
  `?error=alias&code=...` redirects, `revalidatePath` on success.
  AliasMappingPanel component contracts: empty state, grouping by
  groupId, sourceLabel/entityType/status rendering, occurrenceCount,
  approvedBy/approvedAt, exceptionSourceRowIds, "No valid master exists
  yet" hint, approval form for unresolved, remap form for approved,
  exception creation form, server-action wiring, crypto.randomUUID
  dedup, useActionState/useFormStatus, 44px touch targets. Page wiring
  (imports, aliasMappings prop, mappingVersion prop, errorCode prop).
  Worker denial (page redirects to `/worker`).

## Test Results

- `npx tsc --noEmit`: PASSED (exit 0)
- `npx eslint .`: PASSED (exit 0)
- `npx vitest run --reporter=dot`: 3694 passed, 265 skipped (all
  skipped tests are PostgreSQL destructive-DB tests gated by
  `checkDestructiveTestDbSafety`). No new failures introduced.

## Files Changed

**Source files (modified):**
- `src/app/(management)/management/admin/migration/[batchId]/page.tsx`
- `src/app/(management)/management/admin/migration/actions.ts`
- `src/server/services/historical-commit-db-repository.ts`
- `src/server/services/historical-commit-repository.ts`
- `src/server/services/historical-commit-service.ts`
- `src/server/services/historical-reconciliation-service.ts`
- `src/server/services/historical-validation-db-repository.ts`
- `src/server/services/historical-validation-repository.ts`
- `src/server/services/historical-validation-service.ts`
- `src/server/services/master-data-db-repository.ts`
- `src/server/services/master-data-service.ts`
- `src/server/services/migration-screen-query-service.ts`

**Test files (modified):**
- `src/server/services/__tests__/in-memory-historical-commit-repository.ts`
- `src/server/services/__tests__/in-memory-historical-validation-repository.ts`
- `src/server/services/__tests__/in-memory-master-data-repository.ts`
- `src/server/services/__tests__/wp-08-01f-postgres-commit-atomicity.test.ts`
- `src/server/services/__tests__/wp-08-01f-postgres-submission-atomicity.test.ts`
- `src/server/services/__tests__/wp-08-01f-task1-inventory-validation.test.ts`

**New files:**
- `src/app/(management)/management/admin/migration/[batchId]/_components/alias-mapping-panel.tsx`
- `src/server/services/__tests__/wp-08-01f-alias-mapping-ui.test.ts`
- `src/server/services/__tests__/wp-08-01f-postgres-alias-atomicity.test.ts`

**Docs (modified):**
- `docs/ui-ux/evidence/wp-08-01f/runs/qaB-r9-1786647635/task1-destructive-inventory-35.md`
  (updated discovered count 40 → 41 to include the new alias-atomicity test file)

## Not Done (per task rules)

- Did NOT push to remote.
- Did NOT start WP-08-01G.
- Did NOT delete `audit_logs` or disable audit triggers anywhere.
- Did NOT redesign the migration page — added a panel section only,
  following the existing React server component + client component
  patterns.
