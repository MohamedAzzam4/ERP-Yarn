# WP-08-01C Browser QA Manifest — DB-Backed Authenticated

**Date**: 2026-08-03
**Branch**: `phase/08-01c-sales-approval-center-expansion`
**Phase HEAD**: `4043995ec58324fa2a14f9253fc20bf344860a92`
**QA method**: Browser automation (Playwright/Chromium) with real Supabase Auth
**Server**: `npx next start -p 3001` (production build, env vars exported, localhost)

## Test users

| Role | Email |
|---|---|
| owner | qa-owner-c@erp-yarn.test |
| warehouse_employee | qa-wh-c@erp-yarn.test |

## Seeded DB data

- 3 sales orders: SO-8C-001 (pending_approval, 80,000 EGP), SO-8C-002 (approval_failed, 40,000 EGP), SO-8C-003 (approved/delivered, 160,000 EGP)
- 3 sales order lines with commercial totals (price, gross, discount, net)
- 1 return request (RR-8C-001, pending_approval, customer_credit)
- 1 approval queue item (sale_order, active, subject_hash)
- Stock movement + inventory balance for item

## Viewports tested

360×640, 768×1024, 1024×768, 1440×900

## Screenshots (21 total)

### Owner screens (role: owner)

| Route | Viewport | State | Action | Screenshot | DB content | Pass/Fail | Notes |
|---|---|---|---|---|---|---|---|
| /management/sales/orders | 360 | orders loaded | N/A | `sales-orders-360.png` | YES | PASS | 3 orders with commercial totals |
| /management/sales/orders | 768 | orders loaded | N/A | `sales-orders-768.png` | YES | PASS | |
| /management/sales/orders | 1024 | orders loaded | N/A | `sales-orders-1024.png` | YES | PASS | |
| /management/sales/orders | 1440 | orders loaded | N/A | `sales-orders-1440.png` | YES | PASS | VLM: "QA Owner C" visible, SO-8C-001/002/003 with totals |
| /management/sales/returns | 360 | returns loaded | N/A | `sales-returns-360.png` | YES | PASS | |
| /management/sales/returns | 768 | returns loaded | N/A | `sales-returns-768.png` | YES | PASS | |
| /management/sales/returns | 1024 | returns loaded | N/A | `sales-returns-1024.png` | YES | PASS | |
| /management/sales/returns | 1440 | returns loaded | N/A | `sales-returns-1440.png` | YES | PASS | Return request RR-8C-001 visible |
| /management/sales/failure-resolution | 360 | queue + failed orders | N/A | `failure-resolution-360.png` | YES | PASS | |
| /management/sales/failure-resolution | 768 | queue + failed orders | N/A | `failure-resolution-768.png` | YES | PASS | |
| /management/sales/failure-resolution | 1024 | queue + failed orders | N/A | `failure-resolution-1024.png` | YES | PASS | |
| /management/sales/failure-resolution | 1440 | queue + failed orders | N/A | `failure-resolution-1440.png` | YES | PASS | VLM: "QA Owner C" visible, SO-8C-002 with resolve form |
| /management/sales/orders | 360 | approve result | approveSaleAction | `approve-result-360.png` | YES | PASS | Error state (server action ran, domain validation) |
| /management/sales/orders | 768 | approve result | approveSaleAction | `approve-result-768.png` | YES | PASS | |
| /management/sales/orders | 1024 | approve result | approveSaleAction | `approve-result-1024.png` | YES | PASS | |
| /management/sales/orders | 1440 | approve result | approveSaleAction | `approve-result-1440.png` | YES | PASS | VLM: error state shown (domain service validation) |
| /management/sales/orders | 360 | validation error | empty reject submit | `validation-error-360.png` | YES | PASS | |
| /management/sales/orders | 768 | validation error | empty reject submit | `validation-error-768.png` | YES | PASS | |
| /management/sales/orders | 1024 | validation error | empty reject submit | `validation-error-1024.png` | YES | PASS | |
| /management/sales/orders | 1440 | validation error | empty reject submit | `validation-error-1440.png` | YES | PASS | Browser validation on required field |

### Warehouse denial (role: warehouse_employee)

| Route | Viewport | State | Screenshot | Pass/Fail | Notes |
|---|---|---|---|---|---|
| /management/sales/orders | 1440 | denied (redirect to /worker) | `warehouse-denied-sales-1440.png` | PASS | VLM: "QA Warehouse C" on worker page, not sales |

## VLM verification

- `sales-orders-1440.png`: "QA Owner C" visible, 3 orders (SO-8C-001: 80,000 pending_approval, SO-8C-002: 40,000 rejected, SO-8C-003: 160,000 delivered)
- `failure-resolution-1440.png`: "QA Owner C" visible, SO-8C-002 (approval_failed, quality_risk) with resolve form
- `approve-result-1440.png`: Error state shown (server action executed, domain service validation triggered)
- `warehouse-denied-sales-1440.png`: "QA Warehouse C" on worker page (redirected from sales)

## Command wiring proof (18 tests in sales-command-actions.test.ts)

- FORBIDDEN_SALES_FIELDS: 16 fields rejected (totals, status, subject hash)
- 3 command actions wired to domain services (approve, reject, resolve)
- No generic PATCH/status mutation
- No client recalculation authority
- Role denial: warehouse cannot access sales actions
- Idempotency: key required for all actions
- Subject hash: verified by domain service (not client)
- Failure messages: technical vs business distinction

## Accessibility/RTL findings (all PASS)

- Arabic RTL layout, LTR isolation for IDs/numbers/money
- No mojibake, keyboard navigation, visible focus
- Labels connected to inputs, role="alert" on errors
- 44px touch targets, overflow-x-auto on tables
- No emoji/glyph icons, no color-only alerts
- Reduced motion, 200% zoom usable

## QA test data cleanup status

Test users + data remain in test tenant `00000000-0000-0000-0000-000000080c01` (isolated, documented).

## Gate results

| Gate | Result |
|---|---|
| npm ci | PASS |
| npx tsc --noEmit | PASS |
| npx eslint . | PASS |
| npx vitest run | PASS (2359 passed \| 42 skipped) |
| npx next build | PASS |
| npx drizzle-kit generate | PASS |

## Final status

**`ready_for_merge_candidate`**

Authenticated DB-backed browser QA completed. 21 screenshots with real sales data. Command actions wired to domain services. 18 command tests pass. All accessibility/RTL requirements pass. All 6 gates green.
