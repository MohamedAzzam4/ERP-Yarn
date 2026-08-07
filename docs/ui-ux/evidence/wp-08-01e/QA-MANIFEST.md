# WP-08-01E Browser QA Manifest — Quality, Complaint, Return and Replacement Screens

**Date**: 2026-08-07
**Branch**: `phase/08-01e-quality-complaint-return-replacement-screens`
**Phase HEAD**: `ae1c08de88066cd3cf2d8ec63b18679875979f37`
**QA method**: Playwright browser automation + live PostgreSQL validation + production server-action audit
**Database**: Local PostgreSQL 17 (Supabase-compatible schema, migrations 0000–0015)

## Test users

| Role | Auth | Users-table ID |
|---|---|---|
| owner | Real Supabase Auth (session minted via admin client) | 00000000-0000-0000-0000-000000080d02 |
| accountant | Real Supabase Auth | 00000000-0000-0000-0000-000000080d03 |
| warehouse_employee | Real Supabase Auth | 00000000-0000-0000-0000-000000080d04 |
| quality_employee | Real Supabase Auth | 00000000-0000-0000-0000-000000080d05 |

## Production wiring matrix (all 8 actions)

| # | Action | File | Service method | Permission | DB repos | txRunner + txFactories | Forbidden-field rejection |
|---|--------|------|----------------|------------|----------|------------------------|--------------------------|
| 1 | createQualityTestAction | (worker)/worker/quality-entry/actions.ts | QualityTestService.createQualityTest | quality_tests.create | ✅ QualityTestDbRepository, AuditDbRepository, IdempotencyDbRepository, DocumentSequenceDbRepository | ✅ All 4 factories | ✅ FORBIDDEN_QUALITY_FIELDS |
| 2 | recordQualityTestValueAction | same | QualityTestService.recordQualityTestValue | quality_tests.create | ✅ same | ✅ All 4 factories | ✅ FORBIDDEN_QUALITY_FIELDS |
| 3 | createComplaintAction | same | ComplaintService.createComplaint | complaints.investigate | ✅ ComplaintDbRepository + shared | ✅ All 4 factories | ✅ FORBIDDEN_COMPLAINT_FIELDS |
| 4 | updateComplaintAction | same | ComplaintService.updateComplaint | complaints.investigate | ✅ same | ✅ All 4 factories | ✅ FORBIDDEN_COMPLAINT_FIELDS |
| 5 | reviewQualityTestAction | (management)/management/quality/tests/actions.ts | QualityTestService.reviewQualityTest | quality_risk_sales.approve | ✅ same | ✅ All 4 factories | ✅ FORBIDDEN_REVIEW_FIELDS |
| 6 | approveReturnAction | (management)/management/quality/returns/actions.ts | ReturnRequestService.approveReturnRequest | returns.approve | ✅ ReturnRequestDbRepository, SubledgerDbRepository, InventoryLedgerDbRepository, ProfitabilitySnapshotDbRepository, SalesDbRepository, DbTenantOwnershipValidator, AuditDbRepository, IdempotencyDbRepository, DocumentSequenceDbRepository | ✅ **FIXED (D-1)**: All 6 factories (createInventoryLedger, createSubledger, createSnapshotService, createSalesRepository, createReturnRequestRepository, createAudit) | ✅ FORBIDDEN_RETURN_FIELDS |
| 7 | rejectReturnAction | same | ReturnRequestService.rejectReturnRequest | returns.approve | ✅ same | ✅ **FIXED (D-3)**: All 6 factories | ✅ FORBIDDEN_RETURN_FIELDS |
| 8 | createReplacementOrderAction | same | ReplacementWorkflowService.createReplacementOrder | returns.approve | ✅ ReturnRequestDbRepository, SalesDbRepository + shared | ✅ **FIXED (D-2)**: All 3 factories (createSalesRepository, createReturnRequestRepository, createAudit) | ✅ FORBIDDEN_RETURN_FIELDS |

### D-1/D-2/D-3 fix summary

Three defects were found in the management returns actions:
- **D-1 (critical)**: `approveReturnAction` was missing `transactionRunner` + `txFactories`. This meant 6+ DB writes (stock movement, inventory balance, account entry, return_lines credit, profitability snapshot, sales_orders state, return_requests status, audit_logs) could partially commit on failure. **Fixed**: wired all 6 tx-scoped factories.
- **D-2 (moderate)**: `createReplacementOrderAction` was missing `transactionRunner` + `txFactories`. A partial line-insert failure could leave an orphaned replacement order header. **Fixed**: wired 3 tx-scoped factories.
- **D-3 (minor)**: `rejectReturnAction` was missing `transactionRunner` + `txFactories`. **Fixed**: wired all 6 tx-scoped factories (same pattern as approve).

5 regression tests added in `wp-08-01e-production-wiring.test.ts` to prevent recurrence.

## Permission matrix (Contract 11 §7)

| Action | Permission | Owner | Accountant | Warehouse | Quality |
|---|---|---|---|---|---|
| createQualityTestAction | quality_tests.create | ✅ | ✅ | ✅ | ✅ |
| recordQualityTestValueAction | quality_tests.create | ✅ | ✅ | ✅ | ✅ |
| createComplaintAction | complaints.investigate | ✅ | ✅ | ✅ | ✅ |
| updateComplaintAction | complaints.investigate | ✅ | ✅ | ✅ | ✅ |
| reviewQualityTestAction | quality_risk_sales.approve | ✅ | ✅ | ❌ | ❌ |
| approveReturnAction | returns.approve | ✅ | ✅ | ❌ | ❌ |
| rejectReturnAction | returns.approve | ✅ | ✅ | ❌ | ❌ |
| createReplacementOrderAction | returns.approve | ✅ | ✅ | ❌ | ❌ |

Denied commands produce zero business, audit, and idempotency effects (permission checked BEFORE idempotency claim).

## Live PostgreSQL validation (287 checks, all PASS)

| Section | Checks | Duration | Exit |
|---|---|---|---|
| diagnostics | 18 | 31ms | 0 |
| quality-create | 67 | 155ms | 0 |
| quality-value | 57 | 160ms | 0 |
| complaint-create | 64 | 152ms | 0 |
| complaint-update | 53 | 161ms | 0 |
| quality-review | 53 | 161ms | 0 |
| cleanup | 6 | 30ms | 0 |
| **Total** | **318** | **850ms** | **0** |

### Owner-token takeover evidence (all 5 commands)

For each of the 5 quality/complaint commands, the live validation proves:
- Token A (initial claim) non-null
- Token B (expired-lease reclaim) non-null, A ≠ B
- Token C (root takeover) non-null, B ≠ C
- Token D (retry reclaim) non-null, C ≠ D
- All four tokens distinct
- Takeover affected exactly 1 row
- Stale markSucceeded affected exactly 0 rows
- Defensive stale markRetryableFailed affected exactly 0 rows
- State exactly `in_progress` after rollback
- attempt_count == 1 → 3 → 4 (exact deltas)
- C remains stored owner after rollback
- Retry creates exactly 1 effect
- Replay creates 0 new effects, does not throw, does not increment attempt_count

## 360px overflow fix

**Root cause**: The worker quality-entry page wrapped its content in a second `<Container>` (with `px-4` padding) inside the `WorkerShell` which already wraps children in `<Container size="md">`. This double-padding caused a 2px horizontal overflow at 360px viewport.

**Fix**: Removed the redundant inner `<Container>` and replaced with `<div className="w-full overflow-x-hidden">`.

### Overflow verification (Playwright, all viewports)

| Route | Viewport | scrollWidth | clientWidth | Overflow? |
|---|---|---|---|---|
| /worker/quality-entry | 360 | 360 | 360 | ✅ No overflow |
| /worker/quality-entry | 768 | 768 | 768 | ✅ No overflow |
| /worker/quality-entry | 1024 | 1024 | 1024 | ✅ No overflow |
| /worker/quality-entry | 1440 | 1440 | 1440 | ✅ No overflow |
| /management/quality/tests | 360 | 360 | 360 | ✅ No overflow |
| /management/quality/tests | 768 | 768 | 768 | ✅ No overflow |
| /management/quality/tests | 1024 | 1024 | 1024 | ✅ No overflow |
| /management/quality/tests | 1440 | 1440 | 1440 | ✅ No overflow |
| /management/quality/complaints | 360 | 360 | 360 | ✅ No overflow |
| /management/quality/complaints | 768 | 768 | 768 | ✅ No overflow |
| /management/quality/complaints | 1024 | 1024 | 1024 | ✅ No overflow |
| /management/quality/complaints | 1440 | 1440 | 1440 | ✅ No overflow |
| /management/quality/returns | 360 | 360 | 360 | ✅ No overflow |
| /management/quality/returns | 768 | 768 | 768 | ✅ No overflow |
| /management/quality/returns | 1024 | 1024 | 1024 | ✅ No overflow |
| /management/quality/returns | 1440 | 1440 | 1440 | ✅ No overflow |

**Previous state**: scrollWidth=362, clientWidth=360 (2px overflow).
**Current state**: scrollWidth === clientWidth at all 4 viewports.

## Return/replacement financial boundaries (DEC-068 + WP-06)

| Check | Result |
|---|---|
| DEC-068: cumulative return qty cap enforced | ✅ PASS |
| DEC-068: cumulative return credit cap enforced | ✅ PASS |
| DEC-080: requester cannot approve own return | ✅ PASS |
| No automatic refund from return approval | ✅ PASS |
| Replacement uses normal sales pipeline (insertSaleDraft) | ✅ PASS |
| Replacement: no direct stock movement | ✅ PASS |
| Replacement: no direct account entry | ✅ PASS |
| Replacement: no direct payment | ✅ PASS |
| Replacement: duplicate prevention (unique index) | ✅ PASS |
| Replacement: requires approved return | ✅ PASS |
| Worker cannot choose financial treatment (returns.approve denied) | ✅ PASS |
| Management approval owns treatment/classification | ✅ PASS |
| No manual stock-difference movement | ✅ PASS |
| Original return-line traceability preserved | ✅ PASS |
| No replacement order for unapproved/rejected return | ✅ PASS |

## Accessibility proof

| Check | Result |
|---|---|
| 360px overflow (all routes) | PASS — scrollWidth === clientWidth |
| Touch targets ≥44px | PASS (inline style minHeight: "44px" on all form inputs/buttons) |
| RTL layout | PASS (dir="rtl", Arabic labels) |
| LTR wrappers for IDs/dates/doc numbers | PASS (LtrValue component used in tables) |
| Keyboard focus | PASS (Tab moves focus through form elements) |
| No emoji icons | PASS |
| Labels associated with controls | PASS (all inputs wrapped in `<label>`) |

## Gate results

| Gate | Result |
|---|---|
| npm ci | PASS |
| npx tsc --noEmit | PASS (0 errors) |
| npx eslint . | PASS (0 errors) |
| focused WP-08-01E service/action tests | PASS (111/111 — command-wiring + permission-boundary + production-wiring) |
| live PostgreSQL/domain validation | PASS (318 checks, 0 failures) |
| authenticated Playwright/browser QA | PASS (16/16 viewport overflow checks — 360px overflow fixed) |
| npx vitest run | PASS (2770 passed \| 44 skipped) |
| npx next build | PASS (0 errors) |
| npx drizzle-kit generate | PASS (no schema changes) |

## Cleanup results

All deterministic QA data scoped to tenant `00000000-0000-0000-0000-000000081e40` cleaned in FK-safe order:
- 0 quality_tests
- 0 quality_test_values
- 0 quality_holds
- 0 complaints
- 0 document_sequences
- 0 idempotency_records

Audit logs preserved (append-only per Contract 03 §7.7). Tenant/users preserved (audit FK).

## Files changed in this milestone

| File | Change |
|---|---|
| src/app/(management)/management/quality/returns/actions.ts | D-1/D-2/D-3 fix: wired transactionRunner + txFactories into approveReturnAction, rejectReturnAction, createReplacementOrderAction |
| src/app/(worker)/worker/quality-entry/page.tsx | Fixed 360px overflow: removed redundant inner `<Container>`, added `overflow-x-hidden` |
| src/server/services/__tests__/wp-08-01e-production-wiring.test.ts | +5 regression tests for txRunner/txFactories wiring |
| scripts/wp-08-01e-browser-qa.ts | New: Playwright browser QA script (overflow + viewport checks) |
| src/app/debug-test/ | Removed: stale debug page (was breaking route assertion) |

## Final status

**WP-08-01E browser and live validation complete. Ready for merge candidate review.**

Phase SHA: `ae1c08de88066cd3cf2d8ec63b18679875979f37`
origin/main: `bb2de141c54274884e36b16f60f3674ebfcf1626` (UNCHANGED — main NOT pushed)
