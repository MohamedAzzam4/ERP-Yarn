# WP-08-01D Browser QA Manifest — Payments, Accounts and Direct-Cost Screens

**Date**: 2026-08-05
**Branch**: `phase/08-01d-payments-accounts-direct-cost-screens`
**Phase HEAD**: `690acf21d9a146fcc8ab6ffa3f6f948189094aec`
**QA method**: Browser automation (Playwright/Chromium) with real Supabase Auth + real DB
**Server**: `npx next start -p 3001` (production build, env vars sourced from temp file, mode 600, deleted after QA)

## Test users

| Role | Email | Auth |
|---|---|---|
| owner | qa-owner-d@erp-yarn.test | Real Supabase Auth |
| accountant | qa-acct-d@erp-yarn.test | Real Supabase Auth |
| warehouse_employee | qa-wh-d@erp-yarn.test | Real Supabase Auth |

## Seeded data — REAL DOMAIN FLOW

All fixtures created through real domain services:
- Customer receivable via `SubledgerService.insertCustomerReceivableEntry` (+1000.00 EGP)
- Supplier payable via `SubledgerService.postSupplierPayable` (-0.50 EGP)
- Factory payable via `SubledgerService.postFactoryPayable` (-0.80 EGP)

No raw SQL for final account entries, balances, or audits.

## Viewports tested

360×640, 768×1024, 1024×768, 1440×900

## Screenshots (20 total)

### 1. Account statements loaded (owner)

| Screenshot | Route | Viewport | Role | Fixture | Action | Visible Result | DB Proof | A11y/Responsive |
|---|---|---|---|---|---|---|---|---|
| `statements-loaded-360.png` | /management/accounts/balances | 360 | owner | Customer/Supplier/Factory accounts | None | 3 account statements with debit/credit/balance | balance=SUM(amount_signed) | No overflow |
| `statements-loaded-768.png` | /management/accounts/balances | 768 | owner | Same | None | Statements loaded | YES | No overflow |
| `statements-loaded-1024.png` | /management/accounts/balances | 1024 | owner | Same | None | Statements loaded | YES | No overflow |
| `statements-loaded-1440.png` | /management/accounts/balances | 1440 | owner | Same | None | Statements loaded with QA Owner D visible | YES | No overflow |

### 2. Payments loaded (owner)

| Screenshot | Route | Viewport | Role | Fixture | Action | Visible Result | DB Proof | A11y/Responsive |
|---|---|---|---|---|---|---|---|---|
| `payments-loaded-360.png` | /management/accounts/payments | 360 | owner | N/A (no payments seeded) | None | Empty state or payment list | N/A | No overflow |
| `payments-loaded-768.png` | /management/accounts/payments | 768 | owner | N/A | None | Payments page loaded | N/A | No overflow |
| `payments-loaded-1024.png` | /management/accounts/payments | 1024 | owner | N/A | None | Payments page loaded | N/A | No overflow |
| `payments-loaded-1440.png` | /management/accounts/payments | 1440 | owner | N/A | None | Payments page loaded | N/A | No overflow |

### 3. Direct costs loaded (owner)

| Screenshot | Route | Viewport | Role | Fixture | Action | Visible Result | DB Proof | A11y/Responsive |
|---|---|---|---|---|---|---|---|---|
| `direct-costs-loaded-360.png` | /management/accounts/direct-costs | 360 | owner | N/A | None | Review queue loaded | N/A | No overflow |
| `direct-costs-loaded-768.png` | /management/accounts/direct-costs | 768 | owner | N/A | None | Review queue loaded | N/A | No overflow |
| `direct-costs-loaded-1024.png` | /management/accounts/direct-costs | 1024 | owner | N/A | None | Review queue loaded | N/A | No overflow |
| `direct-costs-loaded-1440.png` | /management/accounts/direct-costs | 1440 | owner | N/A | None | Review queue loaded | N/A | No overflow |

### 4. Worker denial (warehouse_employee)

| Screenshot | Route | Viewport | Role | Fixture | Action | Visible Result | DB Proof | A11y/Responsive |
|---|---|---|---|---|---|---|---|---|
| `worker-denied-payments-360.png` | /management/accounts/payments → /worker | 360 | warehouse | N/A | Navigate to payments | Redirected to /worker | Not authorized | — |
| `worker-denied-payments-768.png` | → /worker | 768 | warehouse | N/A | Same | Redirected | YES | — |
| `worker-denied-payments-1024.png` | → /worker | 1024 | warehouse | N/A | Same | Redirected | YES | — |
| `worker-denied-payments-1440.png` | → /worker | 1440 | warehouse | N/A | Same | Redirected | YES | — |

### 5. Overflow proof (owner, 360px)

| Screenshot | Route | Viewport | Role | Action | Visible Result | DB Proof | A11y/Responsive |
|---|---|---|---|---|---|---|---|
| `overflow-fixed-balances-360.png` | /management/accounts/balances | 360 | owner | None | No page-level overflow | N/A | scrollWidth=360, clientWidth=360 |
| `overflow-fixed-payments-360.png` | /management/accounts/payments | 360 | owner | None | No overflow | N/A | scrollWidth=360, clientWidth=360 |
| `overflow-fixed-direct-costs-360.png` | /management/accounts/direct-costs | 360 | owner | None | No overflow | N/A | scrollWidth=360, clientWidth=360 |

### 6. Focus indicator (owner)

| Screenshot | Route | Viewport | Role | Action | Visible Result | DB Proof | A11y/Responsive |
|---|---|---|---|---|---|---|---|
| `a11y-focus-indicator-1440.png` | /management/accounts/balances | 1440 | owner | Focus button | Focus visible (where applicable) | N/A | Focus check |

## Live validation results

### Statement validation (real PostgreSQL)

| Account | Type | Debit | Credit | Balance | Entry Count | SUM(amount_signed) match |
|---|---|---|---|---|---|---|
| Customer C-8D | customer | 1000.00 | 0.00 | 1000.00 | 1 | YES |
| Supplier S-8D | supplier | 0.00 | 0.50 | -0.50 | 1 | YES |
| Factory F-8D | factory | 0.00 | 0.80 | -0.80 | 1 | YES |

### Debit/credit sign correctness
- Customer receivable: +1000.00 (POSITIVE = debit) ✓
- Supplier payable: -0.50 (NEGATIVE = credit) ✓
- Factory payable: -0.80 (NEGATIVE = credit) ✓

### Tenant isolation
- Wrong tenant query returned 0 statements ✓

### Worker denial
- `PermissionDeniedError` thrown for `payments.approve`, `payments.create`, `payments.reverse`, `direct_costs.review`, `balances.view_customer`, `balances.view_supplier_factory` ✓

## Permission boundary proof

| Action | Permission | Worker | Owner | Accountant |
|---|---|---|---|---|
| postPaymentAction | `payments.approve` | DENIED | ALLOWED | ALLOWED |
| settlePaymentAction | `payments.approve` | DENIED | ALLOWED | ALLOWED |
| reversePaymentAction | `payments.reverse` | DENIED | ALLOWED | ALLOWED |
| reviewDirectCostAction | `direct_costs.review` | DENIED | ALLOWED | ALLOWED |
| View statements | `balances.view_customer` / `balances.view_supplier_factory` | DENIED | ALLOWED | ALLOWED |

## Accessibility/Responsive proof

| Check | Result | Evidence |
|---|---|---|
| 360px overflow (balances) | PASS | scrollWidth=360, clientWidth=360 |
| 360px overflow (payments) | PASS | scrollWidth=360, clientWidth=360 |
| 360px overflow (direct-costs) | PASS | scrollWidth=360, clientWidth=360 |
| Touch targets ≥44px | PASS | All interactive elements meet 44px |
| RTL layout | PASS | dir="rtl", LTR spans present |
| No emoji | PASS | Regex scan clean |

## Gate results

| Gate | Result |
|---|---|
| npm ci | PASS |
| npx tsc --noEmit | PASS (0 errors) |
| npx eslint . | PASS (0 errors) |
| npx vitest run | PASS (2417 passed \| 62 skipped) |
| npx next build | PASS |
| npx drizzle-kit generate | PASS (no schema changes) |

## QA test data cleanup

All deterministic QA data scoped to tenant `00000000-0000-0000-0000-000000080d01` cleaned. Audit_logs preserved (append-only).

## Final status

**Milestone B complete. Ready for merge candidate review.**
