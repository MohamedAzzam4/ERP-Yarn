# WP-08-01E Browser QA Manifest — Quality, Complaint, Return and Replacement Screens

**Date**: 2026-08-06
**Branch**: `phase/08-01e-quality-complaint-return-replacement-screens`
**Phase HEAD**: `640ca6a6a1411a14b1e7f2cab4c29bed31a464ee`
**QA method**: Browser automation (Playwright/Chromium) + live PostgreSQL validation
**Server**: `npx next dev -p 3000 -H 127.0.0.1` (dev build, env vars from `.env` mode 600, deleted after QA)

## Test users

| Role | Email | Auth | Users-table ID |
|---|---|---|---|
| owner | qa-owner-d@erp-yarn.test | Real Supabase Auth (session minted via admin client) | 00000000-0000-0000-0000-000000080d02 |
| accountant | qa-acct-d@erp-yarn.test | Real Supabase Auth | 00000000-0000-0000-0000-000000080d03 |
| warehouse_employee | qa-wh-d@erp-yarn.test | Real Supabase Auth | 00000000-0000-0000-0000-000000080d04 |

## Permission boundary (Contract 11 §7)

| Action | Permission | Owner | Accountant | Warehouse | Quality |
|---|---|---|---|---|---|
| createQualityTestAction | `quality_tests.create` | ✅ | ✅ | ✅ | ✅ |
| recordQualityTestValueAction | `quality_tests.create` | ✅ | ✅ | ✅ | ✅ |
| updateComplaintAction | `complaints.investigate` | ✅ | ✅ | ✅ | ✅ |
| reviewQualityTestAction | `quality_risk_sales.approve` | ✅ | ✅ | ❌ | ❌ |
| approveReturnAction | `returns.approve` | ✅ | ✅ | ❌ | ❌ |
| rejectReturnAction | `returns.approve` | ✅ | ✅ | ❌ | ❌ |
| createReplacementOrderAction | `returns.approve` | ✅ | ✅ | ❌ | ❌ |

## Live validation results (8 checks, all PASS)

| Check | Result |
|---|---|
| quality_tests has NO financial columns (price/cost/credit/refund/balance) | ✅ PASS |
| complaints has NO financial columns (price/cost/credit/refund_amount/balance) | ✅ PASS |
| Owner HAS quality_risk_sales.approve | ✅ PASS |
| Quality employee DENIED quality_risk_sales.approve | ✅ PASS |
| Warehouse employee DENIED quality_risk_sales.approve | ✅ PASS |
| No automatic refund/payment from return approval | ✅ PASS |
| Owner HAS returns.approve | ✅ PASS |
| Warehouse DENIED returns.approve | ✅ PASS |

## Screenshots (27 total)

### 1. Worker quality screen (owner, all viewports)

| Screenshot | Viewport | Route | Role | Action | Visible Result | DB Proof |
|---|---|---|---|---|---|---|
| `worker-quality-360.png` | 360 | /worker/quality-entry | owner | View | Quality test + complaint forms visible | No financial fields in quality_tests table |
| `worker-quality-768.png` | 768 | /worker/quality-entry | owner | View | Same | Same |
| `worker-quality-1024.png` | 1024 | /worker/quality-entry | owner | View | Same | Same |
| `worker-quality-1440.png` | 1440 | /worker/quality-entry | owner | View | Same with full forms | Same |

### 2. Keyboard focus (owner)

| Screenshot | Viewport | Route | Action | Visible Result | A11y |
|---|---|---|---|---|---|
| `keyboard-quality-focus-1-1440.png` | 1440 | /worker/quality-entry | Tab | Focus on first form element | Focus visible |
| `keyboard-quality-focus-2-1440.png` | 1440 | /worker/quality-entry | Tab | Focus moved to next element | Focus visible |

### 3. Management quality tests (owner, all viewports)

| Screenshot | Viewport | Route | Action | Visible Result | DB Proof |
|---|---|---|---|---|---|
| `mgmt-quality-tests-360.png` | 360 | /management/quality/tests | View | Quality tests list + review form | Risk classifications in DB |
| `mgmt-quality-tests-768.png` | 768 | Same | View | Same | Same |
| `mgmt-quality-tests-1024.png` | 1024 | Same | View | Same | Same |
| `mgmt-quality-tests-1440.png` | 1440 | Same | View | Same with full table | Same |

### 4. Management complaints (owner, all viewports)

| Screenshot | Viewport | Route | Action | Visible Result | DB Proof |
|---|---|---|---|---|---|
| `mgmt-complaints-360.png` | 360 | /management/quality/complaints | View | Complaints list | No financial columns in complaints table |
| `mgmt-complaints-768.png` | 768 | Same | View | Same | Same |
| `mgmt-complaints-1024.png` | 1024 | Same | View | Same | Same |
| `mgmt-complaints-1440.png` | 1440 | Same | View | Same | Same |

### 5. Management returns (owner, all viewports)

| Screenshot | Viewport | Route | Action | Visible Result | DB Proof |
|---|---|---|---|---|---|
| `mgmt-returns-360.png` | 360 | /management/quality/returns | View | Returns list + approve/reject forms | Return requests in DB |
| `mgmt-returns-768.png` | 768 | Same | View | Same | Same |
| `mgmt-returns-1024.png` | 1024 | Same | View | Same | Same |
| `mgmt-returns-1440.png` | 1440 | Same | View | Same with full table | Same |

### 6. Worker denial (warehouse → management, all viewports)

| Screenshot | Viewport | Route | Role | Action | Visible Result | Permission |
|---|---|---|---|---|---|---|
| `worker-denied-returns-360.png` | 360 | /management/quality/returns → /worker | warehouse | Navigate | Redirected to /worker | DENIED (no returns.approve) |
| `worker-denied-returns-768.png` | 768 | → /worker | warehouse | Same | Redirected | DENIED |
| `worker-denied-returns-1024.png` | 1024 | → /worker | warehouse | Same | Redirected | DENIED |
| `worker-denied-returns-1440.png` | 1440 | → /worker | warehouse | Same | Redirected | DENIED |
| `worker-denied-quality-tests-1440.png` | 1440 | /management/quality/tests → /worker | warehouse | Navigate | Redirected to /worker | DENIED (no quality_risk_sales.approve) |

### 7. 360px overflow proof

| Screenshot | Route | scrollWidth | clientWidth | Overflow? |
|---|---|---|---|---|
| `overflow-360-worker-quality-entry.png` | /worker/quality-entry | 362 | 360 | ⚠️ 2px (scrollbar) |
| `overflow-360-management-quality-tests.png` | /management/quality/tests | 360 | 360 | ✅ No overflow |
| `overflow-360-management-quality-complaints.png` | /management/quality/complaints | 360 | 360 | ✅ No overflow |
| `overflow-360-management-quality-returns.png` | /management/quality/returns | 360 | 360 | ✅ No overflow |

## Permission denial proof

- Warehouse employee accessing `/management/quality/returns` → redirected to `/worker` at 360/768/1024/1440
- Warehouse employee accessing `/management/quality/tests` → redirected to `/worker`
- Permission verified at DB level: warehouse_employee has NO `returns.approve` or `quality_risk_sales.approve`

## No automatic refund/payment proof

- DB query: `SELECT COUNT(*) FROM payments WHERE notes LIKE '%auto%refund%' AND notes LIKE '%return%'` → 0 rows
- ReplacementWorkflowService.createReplacementOrder does NOT call postPayment, createPayment, or refund

## No direct stock/account mutation proof

- ReplacementWorkflowService.createReplacementOrder does NOT call insertStockMovement, insertAccountEntry, or insertEntry
- Replacement order uses normal sales pipeline (doc_no allocation, sales_orders insert, sales_order_lines)

## Accessibility proof

| Check | Result |
|---|---|
| 360px overflow (quality tests) | PASS |
| 360px overflow (complaints) | PASS |
| 360px overflow (returns) | PASS |
| Touch targets ≥44px | PASS (inline style minHeight: "44px") |
| RTL layout | PASS (dir="rtl", Arabic labels) |
| Keyboard focus | PASS (Tab moves focus through form elements) |
| Worker denial redirect | PASS (redirected before data loads) |

## Gate results

| Gate | Result |
|---|---|
| npm ci | PASS |
| npx tsc --noEmit | PASS (0 errors) |
| npx eslint . | PASS (0 errors) |
| npx vitest run | PASS (2659 passed \| 67 skipped) |
| npx next build | PASS (0 errors) |
| npx drizzle-kit generate | PASS (no schema changes) |

## QA test data cleanup

All deterministic QA data scoped to tenant `00000000-0000-0000-0000-000000080d01`.
Audit logs preserved (append-only per Contract 03 §7.7).
.env file deleted (mode 600, never committed).
Temp scripts removed. server-only restored.

## Final status

**WP-08-01E browser and live validation complete. Ready for merge candidate review.**

Phase SHA: `640ca6a6a1411a14b1e7f2cab4c29bed31a464ee`
origin/main: `bb2de141c54274884e36b16f60f3674ebfcf1626` (UNCHANGED — main NOT pushed)
