# WP-08-01F Milestone C — Complete Destructive-File Inventory

## Canonical Search Command

```bash
grep -rn "DELETE FROM\|TRUNCATE" src/ scripts/ \
  --include="*.ts" --include="*.tsx" --include="*.js" \
  --include="*.mjs" --include="*.cjs" --include="*.py" \
  --include="*.sh" --include="*.ps1" \
  2>/dev/null \
  | grep -v node_modules \
  | grep -v "\.d\.ts" \
  | grep -v "^\s*//" \
  | grep -v "^\s*\*" \
  | grep -v "NEVER\|never delete\|do not delete" \
  | grep -v "__guard-coverage-fixtures__" \
  | awk -F: '{print $1}' | sort -u
```

The command searches every source/script extension that may contain
executable SQL strings: `.ts`, `.tsx`, `.js`, `.mjs`, `.cjs`, `.py`,
`.sh`, `.ps1`. No extension is excluded a priori; if the project later
gains a destructive `.sh` or `.ps1` script, the canonical search will
discover it without further edits to this document.

The `__guard-coverage-fixtures__` directory is excluded because it
contains test fixtures (intentionally unguarded / correctly guarded
sample files) used by the static-guard-coverage test. These fixtures
are test DATA, not real scripts that need the guard.

## Discovered Count: 52 paths

The canonical search now discovers 52 paths:
- 35 executable destructive test/QA harness files (Category A)
- 2 comment/fixture-only files (Category D)
- 1 new Category A file: wp-08-01f-postgres-reconciliation-atomicity.test.ts
- 1 new Category A file: wp-08-01f-postgres-rework-atomicity.test.ts
- 1 new Category A file: wp-08-01f-postgres-submission-atomicity.test.ts
- 1 new Category A file: wp-08-01f-postgres-commit-atomicity.test.ts
- 1 new Category A file: wp-08-01f-postgres-alias-atomicity.test.ts (WP-08-01F DEFECT 1-8 closure)
- 1 new Category A file: wp-08-01f-postgres-dec081-recovery.test.ts (WP-08-01F DEC-081 recovery)
- 1 new Category A file: wp-08-01f-permission-failure-proof.test.ts (PF-5 fixture cleanup in afterAll)
- 1 new Category A file: wp-08-01f-postgres-schema-regression.test.ts (BLOCKED-2..6 live-DB proofs)
- 1 new Category A file: wp-08-01f-postgres-alias-application.test.ts (DEFECT 1 alias resolution proof)
- 1 new Category A file: wp-08-01f-postgres-defect2-conflict.test.ts (DEFECT 2 replacement conflict proofs)
- 1 new Category A file: wp-08-01f-postgres-alias-generalized.test.ts (BLOCKER A/B/C generalized alias + real domain proof)
- 1 new Category A file: wp-08-01f-postgres-current-version.test.ts (CRITICAL current-version-only snapshot regression)
- 1 new Category A file: wp-08-01f-postgres-manifest-r6.test.ts (manifest version/supersession/idempotency/business-failure)
- 1 new Category A file: wp-08-01f-postgres-manifest-r8.test.ts (manifest real mid-tx rollback + immediate retry without lease manipulation + exact durable replay)
- 1 new Category A file: wp-07-04-cutover-race.test.ts (WP-07-04 Contract 08 §12.4 cutover vs live-post race proofs)
- 1 new Category A file: wp-07-04-service-race.test.ts (WP-07-04 Contract 08 §12.4 service-level race proofs)

## Category Counts

- Category A (executable destructive test/QA harness): 50
- Category B (legitimate production domain deletion): 0
- Category C (migration/setup): 0
- Category D (comment / fixture string only — no executable DELETE): 2

A + B + C + D = 50 + 0 + 0 + 2 = 52 = discovered count ✓

## Category Definitions

| Category | Meaning |
|---|---|
| A | File contains at least one executable `DELETE FROM` or `TRUNCATE TABLE` statement (raw SQL string evaluated at runtime, drizzle `.delete()`, or `sql\`DELETE ...\`` template). Comment-only mentions and string-fixture mentions do NOT qualify. |
| B | File contains production-domain deletion that is legitimately part of the business contract (e.g. cascade delete of a master record). None exist in this codebase. |
| C | File is a Drizzle migration or DB setup script whose `DROP TABLE` / `TRUNCATE` is part of schema provisioning. None exist in this codebase (migrations live in `drizzle/` and are not picked up by the canonical search because they don't contain `DELETE FROM`/`TRUNCATE` in the searched extensions). |
| D | File mentions `DELETE`/`TRUNCATE` only in comments, docstrings, or template-literal fixtures used for static-analysis tests. No executable destructive statement reaches the database driver. |

## Full Inventory

| # | File | Lines | Operation | Category | Guard Used | Reason |
|---|---|---|---|---|---|---|
| 1 | scripts/wp-05-03-live-validation.mjs | 87-89 | DELETE account_entries, accounts, snapshots | A | TEST_TENANT_ID scoped (unique non-QA tenant) | Standalone live-validation script; uses its own run-scoped tenant. |
| 2 | scripts/wp-05-04-live-validation.mjs | 70-72 | DELETE payment_settlements, payments, account_entries | A | TEST_TENANT_ID scoped | Standalone live-validation script. |
| 3 | scripts/wp-05-05-live-validation.mjs | 64-66 | DELETE direct_cost_allocations, direct_costs, snapshots | A | TEST_TENANT_ID scoped | Standalone live-validation script. |
| 4 | scripts/wp-06-01-live-validation.mjs | 43-45 | DELETE quality_test_values, quality_tests, idempotency_records | A | TEST_TENANT_ID scoped | Standalone live-validation script. |
| 5 | scripts/wp-06-02-live-validation.ts | 53-55 | DELETE complaints, idempotency_records, document_sequences | A | TEST_TENANT_ID scoped | Standalone live-validation script. |
| 6 | scripts/wp-06-03-live-validation.ts | 269-271 | DELETE snapshots, account_entries, accounts | A | TEST_TENANT_ID scoped | Standalone live-validation script. |
| 7 | scripts/wp-06-04-live-validation.ts | 382-384 | DELETE snapshots, account_entries, accounts | A | TEST_TENANT_ID scoped | Standalone live-validation script. |
| 8 | scripts/wp-07-01-live-validation.ts | 72-74 | DELETE staging_cells, staging_rows, import_files | A | TEST_TENANT_ID scoped | Standalone live-validation script. |
| 9 | scripts/wp-07-02-live-validation.ts | 71-73 | DELETE review_items, alias_mappings, validation_errors | A | TEST_TENANT_ID scoped | Standalone live-validation script. |
| 10 | scripts/wp-07-03-live-validation.ts | 71-73 | DELETE review_items, recon_results, validation_errors | A | TEST_TENANT_ID scoped | Standalone live-validation script. |
| 11 | scripts/wp-07-04-live-validation.ts | 185-187 | DELETE inventory_balances, stock_movements, account_entries | A | TEST_TENANT_ID scoped | Standalone live-validation script. |
| 12 | scripts/wp-07-05-live-validation.ts | 136-138 | DELETE inventory_balances, stock_movements, account_entries | A | TEST_TENANT_ID scoped | Standalone live-validation script. |
| 13 | scripts/wp-08-01a-live-validation-full.ts | 147-149 | DELETE stock_movements, account_entries, inventory_balances | A | Run-scoped T (randomUUID per run) | Standalone live-validation script. |
| 14 | scripts/wp-08-01a-live-validation.ts | 52-54 | DELETE stock_movements, account_entries, inventory_balances | A | TEST_TENANT_ID scoped | Standalone live-validation script. |
| 15 | scripts/wp-08-01e-browser-qa/run_qa.py | 716-720 | DELETE inventory_adjustments, balances, reservations | A | QA_TENANT scoped (FK-safe; never deletes audit/idempotency) | Browser-QA Python cleanup harness. |
| 16 | scripts/wp-08-01e-browser-qa/setup-fixtures.ts | 146-150 | DELETE inventory_adjustments, balances, reservations | A | TENANT_ID scoped | Browser-QA fixture setup. |
| 17 | scripts/wp-08-01e-live-validation.ts | 130-132 | DELETE quality_test_values, holds, tests | A | Run-scoped T | Standalone live-validation script. |
| 18 | scripts/wp-08-01f-browser-qa/cleanup.mjs | 47-57 | DELETE cutover_locks, backup_evidence, approvals, etc. | A | tenantId scoped (never deletes audit/idempotency/doc_seq) | Browser-QA cleanup harness. |
| 19 | scripts/wp-08-01f-browser-qa/supabase-pooler-idempotency-proof.cjs | 99-101 | DELETE idempotency_records, users, tenants (run-scoped only) | A | RUN_TENANT scoped (crypto.randomUUID per run) | Pooler proof script; deletes only its own run-scoped rows. |
| 20 | src/server/services/__tests__/destructive-test-guard.ts | 4 | Comment mentioning DELETE | **D** | N/A (guard module itself) | Line 4 is a JSDoc comment describing what the guard protects against. No executable SQL ever reaches a driver from this file. |
| 21 | src/server/services/__tests__/persistent-idempotency.test.ts | 44-45 | DELETE idempotency_records (test-scoped tenants) | A | Shared guard (`assertDestructiveTestDbSafety`) | Fixed in commit b5a06c4. |
| 22 | src/server/services/__tests__/service-level-atomicity.test.ts | 70-84 | DELETE stock_reservations, sales_order_lines, etc. | A | Shared guard | Fixed in commit 537d65d / b5a06c4. |
| 23 | src/server/services/__tests__/wp-08-01d-document-sequence-concurrency.test.ts | 73-82 | DELETE document_sequences, account_entries | A | Shared guard | Fixed in commit b5a06c4. |
| 24 | src/server/services/__tests__/wp-08-01e-milestone-a-postgres-concurrency.test.ts | 68-78 | DELETE quality_test_values, holds, tests, complaints, doc_seq, idempotency | A | Shared guard | Fixed in commit b5a06c4. |
| 25 | src/server/services/__tests__/wp-08-01e-postgres-atomicity.test.ts | 472-485 | DELETE quality_test_values, holds, tests, complaints, returns, stock, sales, doc_seq, idempotency | A | Shared guard | Fixed in commit 537d65d / b5a06c4 — ROOT CAUSE of QA idempotency deletion (previously hardcoded QA tenant). |
| 26 | src/server/services/__tests__/wp-08-01f-postgres-authorization-db-proof.test.ts | 148-152 | DELETE role_permissions, user_roles, permissions, roles, users, tenants | A | Shared guard | Fixed in commit b5a06c4. |
| 27 | src/server/services/__tests__/wp-08-01f-postgres-correction-hook.test.ts | 94-100 | DELETE inventory_balances, stock_movements, account_entries, etc. | A | Shared guard | Fixed in commit b5a06c4. |
| 28 | src/server/services/__tests__/wp-08-01f-postgres-file-replacement.test.ts | 167-180 | DELETE cutover_locks, backup_evidence, approvals, recon, review, findings, staging, files, manifests, batches | A | Shared guard | Fixed in commit b5a06c4. |
| 29 | src/server/services/__tests__/wp-08-01f-postgres-happy-path.test.ts | 101-112 | DELETE cutover_locks, backup_evidence, approvals, recon, review, findings, staging, files, manifests, batches | A | Shared guard | Fixed in commit b5a06c4. |
| 30 | src/server/services/__tests__/wp-08-01f-postgres-phase0-closing-proofs.test.ts | 96-108 | DELETE cutover_locks, backup_evidence, approvals, recon, review, findings, staging, files, manifests, batches | A | Shared guard | Fixed in commit b5a06c4. |
| 31 | src/server/services/__tests__/wp-08-01f-postgres-staging-manifest-atomicity.test.ts | 160-173 | DELETE cutover_locks, backup_evidence, approvals, recon, review, findings, staging, files, manifests, batches, idempotency (NOT audit_logs/users/tenants) | A | Shared guard | Created in commit a422a12 / b5a06c4; corrected in Milestone C proof corrections: removed all audit_logs deletion and trigger-disable; FS-5/FM-5 now use real owner-token fence. |
| 32 | src/server/services/__tests__/wp-08-01f-postgres-validation-atomicity.test.ts | 59-70 | DELETE cutover_locks, backup_evidence, approvals, recon, review, findings, staging, files, manifests, batches | A | Shared guard | Fixed in commit b5a06c4. |
| 33 | src/server/services/__tests__/wp-08-01f-postgres-zero-effect.test.ts | 273-284 | DELETE cutover_locks, backup_evidence, approvals, recon, review, findings, staging, files, manifests, batches | A | Shared guard | Fixed in commit b5a06c4. |
| 34 | src/server/services/__tests__/wp-08-01f-r4-enum-status-audit.test.ts | 73-75 | DELETE import_batches, users, tenants | A | Shared guard | Fixed in commit b5a06c4. |
| 35 | src/server/services/__tests__/wp-08-01f-r6-fail-closed-audit.test.ts | 57-59 | DELETE import_batches, users, tenants | A | Shared guard | Fixed in commit b5a06c4. |
| 36 | src/server/services/__tests__/wp-08-01f-static-guard-coverage.test.ts | 128, 137 | `DELETE FROM import_batches` inside template-literal fixtures | **D** | N/A (static-analysis test) | The `DELETE FROM` patterns appear only inside backtick string literals used as test fixtures for verifying guard-detection logic. No executable SQL ever reaches a driver from this file. |
| 37 | src/server/services/__tests__/wp-08-01f-postgres-reconciliation-atomicity.test.ts | 288-301 | DELETE cutover_locks, backup_evidence, approvals, recon, review, findings, staging, files, manifests, batches, idempotency (NOT audit_logs/users/tenants) | A | Shared guard | Created in Task 4 (commit 9aec204), corrected in Milestone C proof corrections: removed all audit_logs deletion and trigger-disable; uses per-test unique tenants; audit_logs left immutable. |
| 38 | src/server/services/__tests__/wp-08-01f-postgres-rework-atomicity.test.ts | 288-301 | DELETE cutover_locks, backup_evidence, approvals, recon, review, findings, staging, files, manifests, batches, idempotency (NOT audit_logs/users/tenants) | A | Shared guard | Created in Task 2 (commit 6b4003d) — RW-1 through RW-6 rework atomicity proofs. Uses per-test unique tenants; audit_logs left immutable. |
| 39 | src/server/services/__tests__/wp-08-01f-postgres-submission-atomicity.test.ts | 262-275 | DELETE cutover_locks, backup_evidence, approvals, recon, review, findings, staging, files, manifests, batches, idempotency (NOT audit_logs/users/tenants) | A | Shared guard | Created in Task 5 (commit 59efe37) — SUB-1 through SUB-8 submission atomicity proofs. Uses per-test unique tenants; audit_logs left immutable. |
| 40 | src/server/services/__tests__/wp-08-01f-postgres-commit-atomicity.test.ts | ~200-220 | DELETE cutover_locks, backup_evidence, approvals, recon, review, findings, staging, files, manifests, batches, idempotency (NOT audit_logs/users/tenants) | A | Shared guard | Created in Milestone B — COM-1 through COM-8 commit atomicity proofs. Uses per-test unique tenants; audit_logs left immutable. |
| 41 | src/server/services/__tests__/wp-08-01f-postgres-alias-atomicity.test.ts | ~165-180 | DELETE cutover_locks, backup_evidence, approvals, recon, review, findings, staging, files, manifests, batches, inventory_items, product_types, fiber_types, customers, idempotency (NOT audit_logs/users/tenants) | A | Shared guard | Created in WP-08-01F DEFECT 1-8 closure — PG-ALIAS-1 through PG-ALIAS-12 alias atomicity proofs. Uses per-test unique tenants; audit_logs left immutable. |
| 42 | src/server/services/__tests__/wp-08-01f-postgres-dec081-recovery.test.ts | 205-217 | DELETE cutover_locks, backup_evidence, approvals, recon, review, findings, staging, files, manifests, batches, idempotency (NOT audit_logs/users/tenants) | A | Shared guard | Created in WP-08-01F DEC-081 recovery (commit d98b3c3) — DEC081-1 through DEC081-3B replacement idempotency + failure-mark fencing proofs. Uses per-test unique tenants (RUN_ID = randomUUID); audit_logs left immutable. |
| 43 | src/server/services/__tests__/wp-08-01f-permission-failure-proof.test.ts | 248-251 | DELETE role_permissions, permissions, roles, tenants (PF_TEST_TENANT scoped; afterAll cleanup of test-owned fixture) | A | Shared guard + isSupabase guard (cleanup runs ONLY for local disposable DB, never on hosted QA) | PF-5 fixture integrity redesign (commit 642494e) — afterAll cleanup of the test-owned PF_TEST_TENANT. Deletes ONLY the test-owned tenant and its rows; NEVER deletes QA_TENANT (hosted browser-QA tenant). Guarded by `!isSupabase` so hosted QA is never mutated. |
| 44 | src/server/db/__tests__/wp-08-01f-postgres-schema-regression.test.ts | 129-132, 198-201, 268-273, 327-331 | DELETE import_batch_approvals, import_batches, users, tenants, import_validation_errors, import_staging_rows, import_files, import_reconciliation_results (run-scoped tenant cleanup) | A | Shared guard (checkDestructiveTestDbSafety) | Created for BLOCKED-2..6 live-DB schema regression proofs. Uses run-scoped tenants (randomUUID); cleanup deletes only test-owned tenant data; audit_logs left immutable. |
| 45 | src/server/services/__tests__/wp-08-01f-postgres-alias-application.test.ts | 201-217 | DELETE account_entries, cutover_locks, backup_evidence, approvals, recon, alias_mappings, staging_rows, files, batches, customers, document_sequences, idempotency (run-scoped tenant cleanup; audit_logs NOT deleted) | A | Shared guard (checkDestructiveTestDbSafety) | Created for DEFECT 1 alias resolution application proof. Uses run-scoped tenants; audit_logs/users/tenants NOT deleted (FK from immutable audit_logs). |
| 46 | src/server/services/__tests__/wp-08-01f-postgres-defect2-conflict.test.ts | 156-167 | DELETE cutover_locks, backup_evidence, approvals, recon, review, findings, staging, files, manifests, batches, idempotency (run-scoped tenant cleanup; NOT audit_logs/users/tenants) | A | Shared guard (checkDestructiveTestDbSafety) | Created for DEFECT 2 replacement conflict proofs. Uses run-scoped tenants; audit_logs left immutable. |
| 47 | src/server/services/__tests__/wp-08-01f-postgres-alias-generalized.test.ts | 129-148 | DELETE inventory_balances, stock_movements, account_entries, accounts, cutover_locks, backup_evidence, approvals, recon, alias_mappings, staging, files, batches, customers, suppliers, inventory_items, document_sequences, idempotency (run-scoped cleanup; audit_logs/users/tenants NOT deleted) | A | Shared guard (checkDestructiveTestDbSafety) | Created for BLOCKER A/B/C generalized alias resolution + real domain-service integration proof. Uses run-scoped tenants; audit_logs left immutable. |
| 48 | src/server/services/__tests__/wp-08-01f-postgres-current-version.test.ts | 131-151 | DELETE inventory_balances, stock_movements, account_entries, accounts, cutover_locks, backup_evidence, approvals, recon, alias_mappings, staging, files, batches, customers, inventory_items, document_sequences, idempotency (run-scoped cleanup; audit_logs/users/tenants NOT deleted) | A | Shared guard (checkDestructiveTestDbSafety) | Created for CRITICAL current-version-only snapshot regression proof (CV-1..CV-4). Uses run-scoped tenants; audit_logs left immutable. |
| 49 | src/server/services/__tests__/wp-08-01f-postgres-manifest-r6.test.ts | 85-91 | DELETE import_cutover_manifests, import_staging_rows, import_files, import_batches, idempotency_records, document_sequences (run-scoped tenant cleanup; audit_logs/users/tenants NOT deleted) | A | Shared guard (checkDestructiveTestDbSafety) | Created for manifest version/supersession/idempotency/business-failure proofs. Uses run-scoped tenants; audit_logs left immutable. |
| 50 | src/server/services/__tests__/wp-08-01f-postgres-manifest-r8.test.ts | 129-134 | DELETE import_cutover_manifests, import_staging_rows, import_files, import_batches, idempotency_records, document_sequences (run-scoped tenant cleanup; audit_logs/users/tenants NOT deleted) | A | Shared guard (checkDestructiveTestDbSafety) | Reviewer correction pass r8 — replaces r7 file. Strengthens MAN-REPLAY-1 (exact stored response_body equality), removes lease_expires_at manipulation from MAN-TECH-1 retry, adds MAN-TECH-ROLLBACK-1a/1b (real mid-tx rollback after manifest insert + batch hash mutation + supersession + audit append). audit_logs left immutable. |
| 51 | src/server/services/__tests__/wp-07-04-cutover-race.test.ts | 209-217 | DELETE inventory_balances, stock_movements, account_entries, accounts, idempotency_records, document_sequences, inventory_items, locations, suppliers (run-scoped tenant cleanup; audit_logs/users/tenants NOT deleted) | A | Shared guard (checkDestructiveTestDbSafety) | WP-07-04 Contract 08 §12.4 cutover vs live-post race proofs (CUTVER-RACE-A..F). Uses run-scoped tenants; audit_logs left immutable. |
| 52 | src/server/services/__tests__/wp-07-04-service-race.test.ts | 329-349 | DELETE payment_settlements, payments, inventory_balances, stock_movements, account_entries, accounts, import_cutover_locks, import_cutover_manifests, import_backup_evidence, import_batch_approvals, import_reconciliation_results, import_staging_rows, import_files, import_batches, idempotency_records, document_sequences, inventory_items, locations, suppliers (run-scoped tenant cleanup; audit_logs/users/tenants NOT deleted) | A | Shared guard (checkDestructiveTestDbSafety) | WP-07-04 Contract 08 §12.4 SERVICE-LEVEL race proofs (SVC-RACE-1..5). Uses real HistoricalCommitService.commitBatch against real live commands. Uses run-scoped tenants; audit_logs left immutable. |

## Root Cause of the Previous 35-vs-34 Contradiction

The previous checkpoint (commit 96eadd8) reported:

- Discovered count: 35
- Category A: 34
- Category B: 0
- Category C: 1
- Category D: 0

The contradiction had two layers:

1. **Internal mismatch between table and summary.** The table marked all 35 rows as Category A, but the summary claimed A=34, C=1, D=0 — meaning one row was supposed to be Category C, yet no row in the table was actually marked C, and no row clearly fit the "migration/setup" definition. The commit message claimed A=35, B=0, C=0, D=0 (totals 35), but that contradicted the file's summary (A=34, C=1, totals 35). Either way, the table column ("Category") showed 35 A's, while the summary counted only 34 A's.

2. **Misclassification of the guard module.** Row #20 (`destructive-test-guard.ts`) was marked Category A, but the only `DELETE`/`TRUNCATE` match in that file is line 4 — a JSDoc comment describing what the guard protects against. No executable SQL ever reaches a driver from the guard module. The correct classification is Category D.

The previous "Category C (migration/setup): 1" count was an attempt to reconcile the 35-vs-34 arithmetic by inventing a Category C row that did not actually exist in the table. The correct fix is to reclassify the guard module (row #20) as Category D and accept that the table now has 34 A's and 1 D, totalling 35.

After re-running the canonical search (which now also picks up the static-guard-coverage test file added in commit 96eadd8), the discovered count rises to 36 paths. The new 36th row is `wp-08-01f-static-guard-coverage.test.ts`, whose `DELETE FROM` patterns live only inside template-literal fixtures — also Category D.

Final corrected counts:

- A = 34 (executable destructive files)
- B = 0
- C = 0
- D = 2 (guard module + static-guard-coverage test)
- Total = 36 = canonical-search discovered count ✓

## Files Causing the 35-vs-34 Discrepancy

The single file responsible for the original 35-vs-34 discrepancy was:

**`src/server/services/__tests__/destructive-test-guard.ts`** (row #20)

It was incorrectly classified as Category A even though the only `DELETE`/`TRUNCATE` match in the file is the JSDoc comment on line 4 (` * Every test or script that performs DELETE, TRUNCATE, DROP, schema reset,`). The file is the guard module itself — it defines the safety check that other files invoke — and never executes a destructive statement. Reclassifying it as Category D resolves the 35-vs-34 mismatch.

A second file (`wp-08-01f-static-guard-coverage.test.ts`, row #36) was added in the same commit and is also Category D, raising the discovered count from 35 to 36.

## Reclassification Notes

All 10 files previously reported (in pre-Milestone-C drafts) as Category D are now correctly classified as Category A. Using `TEST_TENANT_ID` does not exempt an executable destructive script from Category A classification. If a file executes `DELETE FROM`/`TRUNCATE` against any database, it is Category A regardless of tenant scoping.

The Category A live-validation scripts (rows 1-14, 17) use `TEST_TENANT_ID` (a unique non-QA tenant) or `RUN_TENANT = crypto.randomUUID()`. They remain Category A because they execute real `DELETE` statements. They are not required to import the shared TypeScript guard because they are standalone scripts (not vitest tests) and use their own run-scoped tenant — but they SHOULD invoke the centralized guard CLI (see Task 2) before any destructive execution.

The Category A browser-QA harnesses (rows 15, 16, 18, 19) use `QA_TENANT` or `RUN_TENANT` scoping and never delete `audit_logs` or `idempotency_records` (except row 19, which deletes only its own run-scoped idempotency rows). They remain Category A and SHOULD invoke the centralized guard CLI.

## Root Cause File (QA Idempotency Deletion)

File #25 (`wp-08-01e-postgres-atomicity.test.ts`) was the root cause of the QA idempotency deletion. It hardcoded the QA tenant ID `00000000-0000-0000-0000-000000081e50` in its cleanup function. Fixed in commit 537d65d by replacing with test-scoped tenant ID `cccccccc-0000-4000-8000-000000000052` and adopting the shared destructive-test guard.
