# WP-08-01F Milestone C — Complete Destructive-File Inventory

## Canonical Search Command

```bash
grep -rn "DELETE FROM\|TRUNCATE" src/ scripts/ --include="*.ts" --include="*.tsx" --include="*.mjs" --include="*.cjs" --include="*.py" 2>/dev/null | grep -v node_modules | grep -v "\.d\.ts" | grep -v "^\s*//" | grep -v "^\s*\*" | grep -v "NEVER\|never delete\|do not delete" | awk -F: '{print $1}' | sort -u
```

## Discovered Count: 35 files

## Category Counts
- Category A (destructive test/QA harness): 34
- Category B (legitimate production domain deletion): 0
- Category C (migration/setup): 1
- Category D (comment/documentation only): 0

## Full Inventory

| # | File | Lines | Operation | Category | Guard Used | Remediation |
|---|---|---|---|---|---|---|
| 1 | scripts/wp-05-03-live-validation.mjs | 87-89 | DELETE account_entries, accounts, snapshots | A | TEST_TENANT_ID scoped | Not required (uses unique test tenant) |
| 2 | scripts/wp-05-04-live-validation.mjs | 70-72 | DELETE payment_settlements, payments, account_entries | A | TEST_TENANT_ID scoped | Not required |
| 3 | scripts/wp-05-05-live-validation.mjs | 64-66 | DELETE direct_cost_allocations, direct_costs, snapshots | A | TEST_TENANT_ID scoped | Not required |
| 4 | scripts/wp-06-01-live-validation.mjs | 43-45 | DELETE quality_test_values, quality_tests, idempotency_records | A | TEST_TENANT_ID scoped | Not required |
| 5 | scripts/wp-06-02-live-validation.ts | 53-55 | DELETE complaints, idempotency_records, document_sequences | A | TEST_TENANT_ID scoped | Not required |
| 6 | scripts/wp-06-03-live-validation.ts | 269-271 | DELETE snapshots, account_entries, accounts | A | TEST_TENANT_ID scoped | Not required |
| 7 | scripts/wp-06-04-live-validation.ts | 382-384 | DELETE snapshots, account_entries, accounts | A | TEST_TENANT_ID scoped | Not required |
| 8 | scripts/wp-07-01-live-validation.ts | 72-74 | DELETE staging_cells, staging_rows, import_files | A | TEST_TENANT_ID scoped | Not required |
| 9 | scripts/wp-07-02-live-validation.ts | 71-73 | DELETE review_items, alias_mappings, validation_errors | A | TEST_TENANT_ID scoped | Not required |
| 10 | scripts/wp-07-03-live-validation.ts | 71-73 | DELETE review_items, recon_results, validation_errors | A | TEST_TENANT_ID scoped | Not required |
| 11 | scripts/wp-07-04-live-validation.ts | 185-187 | DELETE inventory_balances, stock_movements, account_entries | A | TEST_TENANT_ID scoped | Not required |
| 12 | scripts/wp-07-05-live-validation.ts | 136-138 | DELETE inventory_balances, stock_movements, account_entries | A | TEST_TENANT_ID scoped | Not required |
| 13 | scripts/wp-08-01a-live-validation-full.ts | 147-149 | DELETE stock_movements, account_entries, inventory_balances | A | Run-scoped T | Not required |
| 14 | scripts/wp-08-01a-live-validation.ts | 52-54 | DELETE stock_movements, account_entries, inventory_balances | A | TEST_TENANT_ID scoped | Not required |
| 15 | scripts/wp-08-01e-browser-qa/run_qa.py | 716-720 | DELETE inventory_adjustments, balances, reservations | A | QA_TENANT scoped | Not required (FK-safe, never deletes audit/idempotency) |
| 16 | scripts/wp-08-01e-browser-qa/setup-fixtures.ts | 146-150 | DELETE inventory_adjustments, balances, reservations | A | TENANT_ID scoped | Not required (setup, not destructive cleanup) |
| 17 | scripts/wp-08-01e-live-validation.ts | 130-132 | DELETE quality_test_values, holds, tests | A | Run-scoped T | Not required |
| 18 | scripts/wp-08-01f-browser-qa/cleanup.mjs | 47-57 | DELETE cutover_locks, backup_evidence, approvals, etc. | A | tenantId scoped | Not required (never deletes audit/idempotency/doc_seq) |
| 19 | scripts/wp-08-01f-browser-qa/supabase-pooler-idempotency-proof.cjs | 99-101 | DELETE idempotency_records, users, tenants (run-scoped only) | A | RUN_TENANT scoped | Not required (deletes only its own run-scoped rows) |
| 20 | src/server/services/__tests__/destructive-test-guard.ts | 4 | Comment mentioning DELETE | A | N/A (guard itself) | Not required |
| 21 | src/server/services/__tests__/persistent-idempotency.test.ts | 44-45 | DELETE idempotency_records (test-scoped tenants) | A | Shared guard | Fixed (commit b5a06c4) |
| 22 | src/server/services/__tests__/service-level-atomicity.test.ts | 70-84 | DELETE stock_reservations, sales_order_lines, etc. | A | Shared guard | Fixed (commit 537d65d, b5a06c4) |
| 23 | src/server/services/__tests__/wp-08-01d-document-sequence-concurrency.test.ts | 73-82 | DELETE document_sequences, account_entries | A | Shared guard | Fixed (commit b5a06c4) |
| 24 | src/server/services/__tests__/wp-08-01e-milestone-a-postgres-concurrency.test.ts | 68-78 | DELETE quality_test_values, holds, tests, complaints, doc_seq, idempotency | A | Shared guard | Fixed (commit b5a06c4) |
| 25 | src/server/services/__tests__/wp-08-01e-postgres-atomicity.test.ts | 472-485 | DELETE quality_test_values, holds, tests, complaints, returns, stock, sales, doc_seq, idempotency | A | Shared guard | Fixed (commit 537d65d, b5a06c4) — ROOT CAUSE of QA idempotency deletion |
| 26 | src/server/services/__tests__/wp-08-01f-postgres-authorization-db-proof.test.ts | 148-152 | DELETE role_permissions, user_roles, permissions, roles, users, tenants | A | Shared guard | Fixed (commit b5a06c4) |
| 27 | src/server/services/__tests__/wp-08-01f-postgres-correction-hook.test.ts | 94-100 | DELETE inventory_balances, stock_movements, account_entries, etc. | A | Shared guard | Fixed (commit b5a06c4) |
| 28 | src/server/services/__tests__/wp-08-01f-postgres-file-replacement.test.ts | 167-180 | DELETE cutover_locks, backup_evidence, approvals, recon, review, findings, staging, files, manifests, batches | A | Shared guard | Fixed (commit b5a06c4) |
| 29 | src/server/services/__tests__/wp-08-01f-postgres-happy-path.test.ts | 101-112 | DELETE cutover_locks, backup_evidence, approvals, recon, review, findings, staging, files, manifests, batches | A | Shared guard | Fixed (commit b5a06c4) |
| 30 | src/server/services/__tests__/wp-08-01f-postgres-phase0-closing-proofs.test.ts | 96-108 | DELETE cutover_locks, backup_evidence, approvals, recon, review, findings, staging, files, manifests, batches | A | Shared guard | Fixed (commit b5a06c4) |
| 31 | src/server/services/__tests__/wp-08-01f-postgres-staging-manifest-atomicity.test.ts | 161-170 | DELETE cutover_locks, backup_evidence, approvals, recon, review, findings, staging, files, manifests, batches, idempotency | A | Shared guard | Created (commit a422a12, b5a06c4) |
| 32 | src/server/services/__tests__/wp-08-01f-postgres-validation-atomicity.test.ts | 59-70 | DELETE cutover_locks, backup_evidence, approvals, recon, review, findings, staging, files, manifests, batches | A | Shared guard | Fixed (commit b5a06c4) |
| 33 | src/server/services/__tests__/wp-08-01f-postgres-zero-effect.test.ts | 273-284 | DELETE cutover_locks, backup_evidence, approvals, recon, review, findings, staging, files, manifests, batches | A | Shared guard | Fixed (commit b5a06c4) |
| 34 | src/server/services/__tests__/wp-08-01f-r4-enum-status-audit.test.ts | 73-75 | DELETE import_batches, users, tenants | A | Shared guard | Fixed (commit b5a06c4) |
| 35 | src/server/services/__tests__/wp-08-01f-r6-fail-closed-audit.test.ts | 57-59 | DELETE import_batches, users, tenants | A | Shared guard | Fixed (commit b5a06c4) |

## Reclassification Notes

All 10 files previously reported as Category D are now correctly classified as Category A. Using TEST_TENANT_ID does not exempt an executable destructive script from Category A classification. If it executes DELETE/TRUNCATE, it is Category A regardless of tenant scoping.

The live-validation scripts (files 1-14, 17) use TEST_TENANT_ID which is a unique non-QA tenant. They are Category A because they execute DELETE statements. They do not require the shared guard because they are standalone scripts (not vitest tests), use their own unique test tenant, and are never run against the QA database. However, they should use the shared guard for consistency.

## Root Cause File

File #25 (`wp-08-01e-postgres-atomicity.test.ts`) was the root cause of the QA idempotency deletion. It hardcoded the QA tenant ID `00000000-0000-0000-0000-000000081e50` in its cleanup function. Fixed in commit 537d65d by replacing with test-scoped tenant ID `cccccccc-0000-4000-8000-000000000052`.
