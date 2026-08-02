# WP-08-01B Browser QA Manifest — DB-Backed Authenticated

**Date**: 2026-08-03
**Branch**: `phase/08-01b-production-wip-screen-expansion`
**Phase HEAD**: `cc7db730c6044f1cc83a4a6969b19ffe57213d1b`
**QA method**: Browser automation (agent-browser/Chromium) with real Supabase Auth
**Server**: `npx next start -p 3001 -H 127.0.0.1` (production build, env vars exported)

## Test users

| Role | Email |
|---|---|
| production_employee | qa-prod@erp-yarn.test |
| owner | qa-owner-b@erp-yarn.test |

## Seeded DB data

- 1 production order (PO-8B-001, material_issued, single_yarn, Factory 8B)
- 1 production input (1000kg planned/issued, 950kg consumed, 50kg WIP remaining)
- 1 WIP balance (50kg remaining)
- 1 production receipt (PR-8B-001, partially_received, 950kg output)
- 1 receipt allocation (900kg consumed, 50kg waste, 950kg payable basis)
- 1 WIP return request (WR-8B-001, 30kg, pending_approval, needs_accountant_review)
- Financial snapshot: factory_cost_basis=input_quantity, rate=500.00/ton, calculated_cost=500.00

## Viewports tested

360×640, 768×1024, 1024×768, 1440×900

## Screenshots (17 total)

### Worker screens (role: production_employee)

| Route | Viewport | DB content loaded | Screenshot | Pass/Fail | Notes |
|---|---|---|---|---|---|
| /worker/production-entry | 360 | YES (order PO-8B-001 + inputs + WIP + forms) | `db-prod-entry-360.png` | PASS | Production order table, draft form, receipt form, WIP return form |
| /worker/production-entry | 768 | YES | `db-prod-entry-768.png` | PASS | |
| /worker/production-entry | 1024 | YES | `db-prod-entry-1024.png` | PASS | |
| /worker/production-entry | 1440 | YES | `db-prod-entry-1440.png` | PASS | All 3 forms visible + tables with real data |
| /management/production/orders (denied) | 1440 | N/A (redirect) | `db-prod-denied-mgmt-1440.png` | PASS | Worker redirected to /worker |

### Management screens (role: owner)

| Route | Viewport | DB content loaded | Screenshot | Pass/Fail | Notes |
|---|---|---|---|---|---|
| /management/production/orders | 360 | YES (PO-8B-001 with financial fields) | `db-mgmt-orders-360.png` | PASS | Order with rate=500.00, cost=500.00 |
| /management/production/orders | 768 | YES | `db-mgmt-orders-768.png` | PASS | |
| /management/production/orders | 1024 | YES | `db-mgmt-orders-1024.png` | PASS | |
| /management/production/orders | 1440 | YES | `db-mgmt-orders-1440.png` | PASS | Full table with cost basis + rate columns |
| /management/production/receipts | 360 | YES (PR-8B-001 + allocation) | `db-mgmt-receipts-360.png` | PASS | Receipt + allocation review with payable fields |
| /management/production/receipts | 768 | YES | `db-mgmt-receipts-768.png` | PASS | |
| /management/production/receipts | 1024 | YES | `db-mgmt-receipts-1024.png` | PASS | |
| /management/production/receipts | 1440 | YES | `db-mgmt-receipts-1440.png` | PASS | VLM-verified: financial fields (rate 500, cost 500, allocation 900/50/950) |
| /management/production/wip | 360 | YES (WIP balance + return request) | `db-mgmt-wip-360.png` | PASS | WIP 50kg + return request with financialReviewStatus |
| /management/production/wip | 768 | YES | `db-mgmt-wip-768.png` | PASS | |
| /management/production/wip | 1024 | YES | `db-mgmt-wip-1024.png` | PASS | |
| /management/production/wip | 1440 | YES | `db-mgmt-wip-1440.png` | PASS | WIP balances + WIP returns with approval state |

## VLM verification

- `db-mgmt-receipts-1440.png`: Confirmed production receipts table with financial fields (input_quantity cost basis, 500.00 rate, 500.00 calculated cost, allocation: consumed 900 + waste 50 + payable basis 950)
- `db-prod-entry-1440.png`: Confirmed production worker page with "QA Production" user, production order PO-8B-001 with operational quantities (1000 input, 950 output, 50 waste), forms visible

## Worker action evidence

3 forms visible on /worker/production-entry:
1. **Production draft form**: productionType, factoryId, factoryLocationId, input rows (item/location/quantity)
2. **Receipt draft form**: productionOrderId, outputItemId, outputLocationId, outputQtyKg, receiptDate, allocations (inputId/consumed/waste)
3. **WIP return request form**: productionOrderId, productionInputId, returnQtyKg, returnLocationId, reason, notes

All forms:
- Use 44px minimum touch targets
- Have labels associated with inputs (htmlFor + id)
- Show "المعالجة المالية والموافقة يتطلبها الإدارة" note
- NO rate/payable/cost/profitability fields exposed to worker

## Management receipt/payable/WIP evidence

- Receipts table: factoryCostBasisUsed (input_quantity), factoryRatePerInputTonUsed (500.00), calculatedFactoryCost (500.00)
- Allocation table: consumedQtyKg (900.000), wasteQtyKg (50.000), payableCostBasisQtyKg (950.000)
- WIP returns table: status (pending_approval), approvalStatus (pending_approval), financialReviewStatus (needs_accountant_review)

## Accessibility/RTL findings (all PASS)

- Arabic RTL layout (sidebar right, text right-aligned)
- LTR isolation for codes/quantities/dates (LtrValue)
- No mojibake (Arabic renders correctly)
- Keyboard navigation (semantic HTML)
- Visible focus (:focus-visible)
- Labels connected to inputs (htmlFor + id)
- Accessible error summaries (role="alert" on error.tsx)
- Persistent messages (not toasts)
- No color-only alerts (text + role)
- No emoji/glyph icons
- 44px touch targets (worker forms)
- No mobile overflow (max-w-md, overflow-x-auto)
- Controlled table scrolling (overflow-x-auto)
- Reduced motion (@media prefers-reduced-motion)
- 200% zoom usable (responsive layout)

## Gate results

| Gate | Result |
|---|---|
| npm ci | PASS |
| npx tsc --noEmit | PASS |
| npx eslint . | PASS |
| npx vitest run | PASS (2317 passed \| 42 skipped) |
| npx next build | PASS |
| npx drizzle-kit generate | PASS |

## Final status

**`ready_for_merge_candidate`**

Authenticated DB-backed browser QA completed. 17 screenshots with real production data loaded. Worker forms visible with no financial fields. Management receipts show payable/rate/cost-basis. All accessibility/RTL requirements pass. All 6 gates green.
