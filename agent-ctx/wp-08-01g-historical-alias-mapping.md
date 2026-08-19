# Task: WP-08-01G — Historical Alias/ Master-Mapping Workflow (A1-A11)

## Branch
`phase/08-01f-historical-migration-screens`

## Scope
Implemented the historical alias/master-mapping approval workflow per
Contract 08 §8.4.1-§8.4.8, addressing the resolved business blocker from
DEC-081/083/084.

The previous codebase had:
- `import_alias_mappings` table with status enum, but NO update/approve method
- NO service method to approve alias mappings
- NO server action
- NO UI
- `submitForApproval` did NOT check alias approval status
- `deleteAliasMappingsForBatch` did HARD DELETE on validation rerun (would
  wipe approvals)

## Changes by task ID

### A1 — Schema changes (`src/server/db/schema/migration.ts`)
Added to `importAliasMappings`:
- `isCurrent: boolean("is_current").notNull().default(true)`
- `supersededAt: timestamp("superseded_at", { withTimezone: true, mode: "date" })`
- `supersededBy: uuid("superseded_by")`
- `supersededReason: text("superseded_reason")`
- `groupId: uuid("group_id")`
- `occurrenceCount: integer("occurrence_count").notNull().default(1)`
- `exceptionSourceRowIds: jsonb("exception_source_row_ids")`

Indexes:
- `import_alias_mappings_tenant_batch_current_idx` on (tenantId, importBatchId, isCurrent)
- `import_alias_mappings_tenant_group_current_idx` on (tenantId, groupId, isCurrent)

Partial unique index:
- `import_alias_mappings_tenant_batch_entity_source_current_unique_idx` on
  (tenantId, importBatchId, entityType, sourceLabel) WHERE `is_current = true`

### A11 — Drizzle migration SQL
Generated `drizzle/output/0019_bizarre_adam_warlock.sql` via `npx drizzle-kit
generate`. The SQL adds the new columns + the three new indexes (no
destructive ALTER TABLE — only ADD COLUMN + CREATE INDEX).

### A3 — Repository interface + impls
Added to `HistoricalValidationRepository` interface:
- `updateAliasMappingStatus(tenantId, aliasMappingId, update)`
- `findAliasMappingById(tenantId, aliasMappingId)`
- `findCurrentAliasMappingsForBatch(tenantId, importBatchId)`
- `supersedeAliasMapping(tenantId, aliasMappingId, supersededBy, reason)`

Implemented in:
- `historical-validation-db-repository.ts` (Drizzle)
- `__tests__/in-memory-historical-validation-repository.ts` (test-only)

Updated `findAliasMappingBySourceLabel` to filter `is_current=true`.

Updated `deleteAliasMappingsForBatch` to only hard-delete non-current rows
(current rows are protected — the service is the authority on which rows to
supersede).

Extended `NewAliasMappingInput` with optional `groupId`, `occurrenceCount`,
`exceptionSourceRowIds`.

### A2 — Validation service fix (`historical-validation-service.ts`)
Replaced the `deleteAliasMappingsForBatch` call in `runValidation` with a
targeted supersede loop: only non-approved current mappings are superseded
before re-extraction. Approved mappings are preserved across re-validation.

Added `detectEntityType(data)` helper that checks:
- `data.entity_type` / `data.type` / `data.entityType` / `data.record_type`
- Master-id fields (`supplier_id` → "supplier", `customer_id` → "customer", etc.)
- `data.party_type`
- Fallback: "customer" (preserves backward compatibility with legacy fixtures)

Added a `groupTracker` Map keyed by `${entityType}|${normalizedName}`. The
first occurrence generates a random UUID `groupId`; subsequent occurrences
reuse it. `occurrenceCount` is incremented per occurrence and stored on
each alias row.

### A4 — `approveAliasMapping` service method
Added to `HistoricalValidationService`:
- Permission: `migration.review` (Owner/Accountant)
- DEC-080 non-applicability: same user can select + approve (no
  separation-of-duties requirement)
- Idempotency: `claimIdempotency` → `markSucceeded`/`markBusinessFailed`/
  `markRetryableFailed`
- Server-derived tenant/actor: browser cannot submit `tenantId`/`userId`/
  `approverRole` — derived from the authenticated ERP context
- Target master validation: `MasterDataRepository.find{Supplier|Customer|
  Location|ExternalFactory}ById(tenantId, targetMasterId)` — fails with
  `InvalidAliasTargetError` if not found or entity type mismatch
- Audit log: `historical_alias.approve` / `historical_alias.reject` /
  `historical_alias.remap` / `historical_alias.approve_noop`
- All writes atomic via `transactionRunner` + tx-scoped deps (mirrors
  the reconciliation service pattern)
- Failure classification:
  - Business (alias not found, not current, invalid target, missing
    master-data repo) → business_failed (durable)
  - Technical (DB/infra error) → retryable_failed (non-durable, retry
    re-executes)

New error classes:
- `AliasMappingNotFoundError`
- `AliasAlreadyApprovedError`
- `InvalidAliasTargetError`
- `AliasApprovalStateError`
- `AliasMappingNotCurrentError`
- `MasterDataRepositoryNotConfiguredError`

New `HistoricalValidationServiceDeps` fields:
- `masterDataRepository?`
- `createMasterDataRepository?`
- `invalidateCurrentApprovals?`
- `supersedeReviewItemsForBatch?`
- `resetBatchValidationAndReconciliationStatuses?`
- `findLatestReportVersion?`

### A5 — Material remap/invalidation
In `approveAliasMapping`:
- If the alias is already approved with a DIFFERENT target → supersede the
  old current row (`is_current=false`), insert a new current row with the
  new target (preserves `groupId`, `occurrenceCount`,
  `exceptionSourceRowIds`).
- Downstream invalidation via optional tx-scoped callbacks:
  - `resetBatchValidationAndReconciliationStatuses` (forces re-validation +
    re-reconciliation)
  - `invalidateCurrentApprovals` (marks current approvals `is_current=false`)
  - `supersedeReviewItemsForBatch` (marks current review items
    `is_current=false`)
- If the batch was in `pending_dual_approval` or `approved_for_commit`,
  transitions it to `review_required` (forces a fresh submission after
  re-validation + re-reconciliation).
- Audit `historical_alias.remap` records old/new row ids + target +
  downstream invalidation counts.

### A7 — Submission prerequisite enforcement
Added to `submitForApproval` in `historical-reconciliation-service.ts`:
- After the existing prerequisite checks (validation/reconciliation
  completion, blocking findings, review items, hashes, warnings, backup
  evidence), the alias-mapping prerequisite:
  - Query current alias mappings for the batch via
    `commitRepo.findCurrentAliasMappingsForBatch` (new method on
    `HistoricalCommitRepository` — see below).
  - For each current alias mapping: require `status='approved'` AND
    `targetMasterId IS NOT NULL`.
  - Failure modes:
    - `UNRESOLVED_ALIAS_MAPPING` (any current alias with
      `status != 'approved'` OR `targetMasterId IS NULL`)
    - `INVALID_ALIAS_TARGET` (defined but best-effort at submit time — the
      authoritative master existence check is at approve time in
      `approveAliasMapping`)

Both error classes extend `SubmissionValidationError` → automatically
classified as business precondition failures → `business_failed` (durable)
by the existing failure-classification logic.

Extended `HistoricalCommitRepository` with `findCurrentAliasMappingsForBatch`
(cross-service read-only lookup — same pattern as
`findBlockingValidationErrors`, `findLatestReconciliationResults`,
`findBackupEvidenceForBatch`). Implemented in both the DB repo and the
in-memory test repo.

### A9 — Server action
Added `approveAliasMappingAction` to
`src/app/(management)/management/admin/migration/actions.ts`:
- Permission: `migration.review`
- Server-derived tenant/actor via `authenticateAndRequirePermissionFromDb`
- Parses `aliasMappingId`, `targetMasterId`, `status`, `notes`,
  `mappingVersion`, `idempotencyKey` from FormData
- Rejects `status='rejected'` with non-null `targetMasterId`
- Calls `validationService.approveAliasMapping`
- Error normalization: catches known `HistoricalValidationError` codes
  (ALIAS_MAPPING_NOT_FOUND, ALIAS_NOT_CURRENT, INVALID_ALIAS_TARGET,
  ALIAS_ALREADY_APPROVED, CONFIGURATION_ERROR, IDEMPOTENCY_CONFLICT,
  OPERATION_IN_PROGRESS, VALIDATION_FAILED) and converts to controlled
  redirects with Arabic error code in the URL. Technical errors propagate
  as HTTP 500.
- `revalidatePath` after success

Wired the master-data repository + tx-scoped factory + downstream
invalidation callbacks into `getMigrationServices()`'s `validationService`.
The callbacks delegate to `HistoricalCommitDbRepository` and
`HistoricalReconciliationDbRepository` constructed with the same tx handle,
mirroring the replacement service pattern.

### A10 — Unit tests
Created `src/server/services/__tests__/historical-alias-mapping-service.test.ts`
with 20 tests covering:
- ALIAS-1: Owner approval success
- ALIAS-2: Accountant approval success
- ALIAS-3: DEC-080 non-applicability (same person selects + approves)
- ALIAS-4: Worker rejection (PermissionDeniedError)
- ALIAS-5: Tenant isolation (AliasMappingNotFoundError)
- ALIAS-6: Entity type mismatch (InvalidAliasTargetError, master-not-found,
  master-data-repo-not-configured)
- ALIAS-7: Grouped occurrence semantics (groupId + occurrenceCount
  preserved across approval; two aliases in same group approved
  independently)
- ALIAS-8: Rejection (status='rejected' + null target; rejects
  status='rejected' with non-null target)
- ALIAS-9: No-op approval (alias already approved with same target → no
  mutation; prior approvedBy/approvedAt preserved)
- ALIAS-10: Material remap (re-approval to a different target →
  supersede old + insert new + downstream invalidation callbacks fired)
- ALIAS-11: Idempotency replay / conflict / business_failed replay /
  retryable_failed retry
- ALIAS-12 (bonus): Superseded alias cannot be re-approved
  (AliasMappingNotCurrentError)

## Patterns followed
- tx-scoped deps + EXPLICIT factories (no `this.deps` mutation inside the
  transaction)
- batch row lock (SELECT … FOR UPDATE) pattern from submitForApproval
- idempotency: claimIdempotency → markSucceeded / markBusinessFailed /
  markRetryableFailed with owner-token fencing
- failure classification: business errors → business_failed (durable);
  technical errors → retryable_failed (non-durable, retry re-executes)
- append-only audit log (DEC-024): no updateAuditLog / deleteAuditLog
- append-only alias-mapping rows: supersede (is_current=false) instead of
  update for material remap; old rows preserved as audit history
- master validation done INSIDE the transaction (post-claim) so that
  business failures produce durable idempotency records for replay
- master-data repo as MasterDataRepository abstraction (not
  MasterDataDbRepository directly) so unit tests can swap in
  InMemoryMasterDataRepository
- partial unique index on (tenant, batch, entityType, sourceLabel) WHERE
  is_current=true — invariant preserved at the DB level
- cross-service read-only lookups on the commit repository
  (findBlockingValidationErrors, findLatestReconciliationResults,
  findCurrentAliasMappingsForBatch) — same pattern as before

## Validation
- `npx tsc --noEmit` → clean (no TS errors)
- `npx eslint .` → exit 0 (no lint errors)
- `npx vitest run` → 3653 tests pass, 236 skipped (Postgres-specific)
  - The 20 new tests in `historical-alias-mapping-service.test.ts` all pass
  - All 15 existing `historical-validation-service.test.ts` tests still pass
  - All 15 existing `historical-reconciliation-service.test.ts` tests still pass
  - All 7 `wp-08-01f-r3-validation-fix-audit.test.ts` tests still pass
  - All 18 `migration-schema.test.ts` tests still pass (6 Postgres-only skipped)

## Files modified
- `src/server/db/schema/migration.ts` — schema additions (A1)
- `drizzle/output/0019_bizarre_adam_warlock.sql` — generated migration SQL (A11)
- `drizzle/output/meta/0019_snapshot.json` — generated snapshot
- `drizzle/output/meta/_journal.json` — updated journal
- `src/server/services/historical-validation-repository.ts` — interface additions (A3)
- `src/server/services/historical-validation-db-repository.ts` — DB impl (A3)
- `src/server/services/__tests__/in-memory-historical-validation-repository.ts` — in-memory impl (A3)
- `src/server/services/historical-validation-service.ts` — service additions (A2, A4, A5)
- `src/server/services/historical-commit-repository.ts` — interface addition (A7)
- `src/server/services/historical-commit-db-repository.ts` — DB impl (A7)
- `src/server/services/__tests__/in-memory-historical-commit-repository.ts` — in-memory impl (A7)
- `src/server/services/historical-reconciliation-service.ts` — submitForApproval prerequisite (A7)
- `src/app/(management)/management/admin/migration/actions.ts` — server action + service wiring (A9)
- `src/server/services/__tests__/historical-alias-mapping-service.test.ts` — new test file (A10)

## Known follow-ups (out of scope)
- No UI page for the alias approval screen — the server action exists but
  no client component renders the approve/reject buttons yet. A follow-up
  work package will add the alias-approval UI panel on the batch detail
  page (`/management/admin/migration/[batchId]`).
- The `INVALID_ALIAS_TARGET` submit-time check is currently best-effort
  (presence-only). A future work package could add a master-existence
  re-validation at submit time using a `MasterDataRepository` injected
  into the reconciliation service deps.
