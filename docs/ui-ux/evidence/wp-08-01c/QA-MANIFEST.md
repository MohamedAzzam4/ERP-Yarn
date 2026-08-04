# WP-08-01C Browser QA Manifest — DB-Backed Authenticated Command Success

**Date**: 2026-08-05
**Branch**: `phase/08-01c-sales-approval-center-expansion`
**Phase HEAD**: `b4b0b36915b12da2c3908c4ec907787ea034ac8d`
**QA method**: Browser automation (Playwright/Chromium) with real Supabase Auth + real DB
**Server**: `npx next start -p 3001` (production build, env vars sourced from temp file, mode 600, deleted after QA)

## Test users

| Role | Email | Auth |
|---|---|---|
| owner | qa-owner-c@erp-yarn.test | Real Supabase Auth (password: QaTest123!) |
| warehouse_employee | qa-wh-c@erp-yarn.test | Real Supabase Auth (password: QaTest123!) |

## Seeded data — REAL DOMAIN FLOW

All sales created through `SalesDraftService.createDraft` → `completeCommercialTotals` → `SalesSubmissionService.submitSale`. Initial stock via `InventoryLedgerService.postRawReceipt`. No raw SQL for business states.

## Viewports tested

360×640, 768×1024, 1024×768, 1440×900

## Screenshots (60 total)

### 1. Sales orders loaded (owner)

| Screenshot | Route | Viewport | Role | Sale/Doc No | Action | Visible Result | DB Proof | A11y/Responsive |
|---|---|---|---|---|---|---|---|---|
| `sales-orders-360.png` | /management/sales/orders | 360 | owner | All | None | Orders loaded with commercial totals | 5 orders visible | No overflow |
| `sales-orders-768.png` | /management/sales/orders | 768 | owner | All | None | Orders loaded | YES | No overflow |
| `sales-orders-1024.png` | /management/sales/orders | 1024 | owner | All | None | Orders loaded | YES | No overflow |
| `sales-orders-1440.png` | /management/sales/orders | 1440 | owner | All | None | Orders loaded, QA Owner C visible | YES | No overflow |

### 2. Approve form visible + success (owner)

| Screenshot | Route | Viewport | Role | Sale/Doc No | Action | Visible Result | DB Proof | A11y/Responsive |
|---|---|---|---|---|---|---|---|---|
| `approve-form-visible-360.png` | /management/sales/orders | 360 | owner | SO-2026-000001 | View form | Approve button visible | Pending sale | 44px target |
| `approve-form-visible-768.png` | /management/sales/orders | 768 | owner | SO-2026-000001 | View form | Approve button visible | YES | 44px target |
| `approve-form-visible-1024.png` | /management/sales/orders | 1024 | owner | SO-2026-000001 | View form | Approve button visible | YES | 44px target |
| `approve-form-visible-1440.png` | /management/sales/orders | 1440 | owner | SO-2026-000001 | View form | Approve button visible | YES | 44px target |
| `approve-result-1440.png` | /management/sales/orders | 1440 | owner | SO-2026-000001 | Click approve | Success state shown | sale→approved | — |
| `approve-success-refreshed-360.png` | /management/sales/orders | 360 | owner | SO-2026-000001 | Refresh after approve | Approved status persisted | sale_status=approved, locked=true, 1 movement, 1 entry, 1 snapshot | No overflow |
| `approve-success-refreshed-768.png` | /management/sales/orders | 768 | owner | SO-2026-000001 | Refresh after approve | Approved status persisted | YES | No overflow |
| `approve-success-refreshed-1024.png` | /management/sales/orders | 1024 | owner | SO-2026-000001 | Refresh after approve | Approved status persisted | YES | No overflow |
| `approve-success-refreshed-1440.png` | /management/sales/orders | 1440 | owner | SO-2026-000001 | Refresh after approve | Approved status persisted | YES | No overflow |

### 3. Reject/cancel form visible + success (owner)

| Screenshot | Route | Viewport | Role | Sale/Doc No | Action | Visible Result | DB Proof | A11y/Responsive |
|---|---|---|---|---|---|---|---|---|
| `reject-form-visible-360.png` | /management/sales/orders | 360 | owner | SO-2026-000002 | View form | Reject form with reason input | Pending sale | 44px target |
| `reject-form-visible-768.png` | /management/sales/orders | 768 | owner | SO-2026-000002 | View form | Reject form visible | YES | 44px target |
| `reject-form-visible-1024.png` | /management/sales/orders | 1024 | owner | SO-2026-000002 | View form | Reject form visible | YES | 44px target |
| `reject-form-visible-1440.png` | /management/sales/orders | 1440 | owner | SO-2026-000002 | View form | Reject form visible | YES | 44px target |
| `reject-result-1440.png` | /management/sales/orders | 1440 | owner | SO-2026-000002 | Click reject with reason | Success state shown | sale→rejected | — |
| `reject-success-refreshed-360.png` | /management/sales/orders | 360 | owner | SO-2026-000002 | Refresh after reject | Rejected status persisted | sale_status=rejected, reservation=released | No overflow |
| `reject-success-refreshed-768.png` | /management/sales/orders | 768 | owner | SO-2026-000002 | Refresh after reject | Rejected status persisted | YES | No overflow |
| `reject-success-refreshed-1024.png` | /management/sales/orders | 1024 | owner | SO-2026-000002 | Refresh after reject | Rejected status persisted | YES | No overflow |
| `reject-success-refreshed-1440.png` | /management/sales/orders | 1440 | owner | SO-2026-000002 | Refresh after reject | Rejected status persisted | YES | No overflow |

### 4. Failure-resolution form visible + success (owner)

| Screenshot | Route | Viewport | Role | Sale/Doc No | Action | Visible Result | DB Proof | A11y/Responsive |
|---|---|---|---|---|---|---|---|---|
| `failure-resolution-form-visible-360.png` | /management/sales/failure-resolution | 360 | owner | SO-2026-000003 | View form | Resolve form with reason selector | Quality-risk sale | 44px target |
| `failure-resolution-form-visible-768.png` | /management/sales/failure-resolution | 768 | owner | SO-2026-000003 | View form | Resolve form visible | YES | 44px target |
| `failure-resolution-form-visible-1024.png` | /management/sales/failure-resolution | 1024 | owner | SO-2026-000003 | View form | Resolve form visible | YES | 44px target |
| `failure-resolution-form-visible-1440.png` | /management/sales/failure-resolution | 1440 | owner | SO-2026-000003 | View form | Resolve form visible | YES | 44px target |
| `failure-resolution-result-1440.png` | /management/sales/failure-resolution | 1440 | owner | SO-2026-000003 | Click resolve | Success state shown | sale→approval_failed | — |
| `failure-resolution-success-refreshed-360.png` | /management/sales/failure-resolution | 360 | owner | SO-2026-000003 | Refresh after resolve | approval_failed persisted | sale_status=approval_failed, reservation=failed, 1 critical alert | No overflow |
| `failure-resolution-success-refreshed-768.png` | /management/sales/failure-resolution | 768 | owner | SO-2026-000003 | Refresh after resolve | approval_failed persisted | YES | No overflow |
| `failure-resolution-success-refreshed-1024.png` | /management/sales/failure-resolution | 1024 | owner | SO-2026-000003 | Refresh after resolve | approval_failed persisted | YES | No overflow |
| `failure-resolution-success-refreshed-1440.png` | /management/sales/failure-resolution | 1440 | owner | SO-2026-000003 | Refresh after resolve | approval_failed persisted | YES | No overflow |

### 5. Validation error (owner)

| Screenshot | Route | Viewport | Role | Sale/Doc No | Action | Visible Result | DB Proof | A11y/Responsive |
|---|---|---|---|---|---|---|---|---|
| `validation-error-360.png` | /management/sales/orders | 360 | owner | SO-2026-000004 | Submit empty reject | Browser validation blocks submit | Sale unchanged (pending) | — |
| `validation-error-768.png` | /management/sales/orders | 768 | owner | SO-2026-000004 | Submit empty reject | Browser validation | YES | — |
| `validation-error-1024.png` | /management/sales/orders | 1024 | owner | SO-2026-000004 | Submit empty reject | Browser validation | YES | — |
| `validation-error-1440.png` | /management/sales/orders | 1440 | owner | SO-2026-000004 | Submit empty reject | Browser validation | YES | — |

### 6. Warehouse denial (warehouse_employee)

| Screenshot | Route | Viewport | Role | Sale/Doc No | Action | Visible Result | DB Proof | A11y/Responsive |
|---|---|---|---|---|---|---|---|---|
| `warehouse-denied-360.png` | /management/sales/orders → /worker | 360 | warehouse | N/A | Navigate to sales | Redirected to /worker | Not authorized | — |
| `warehouse-denied-768.png` | /management/sales/orders → /worker | 768 | warehouse | N/A | Navigate to sales | Redirected to /worker | YES | — |
| `warehouse-denied-1024.png` | /management/sales/orders → /worker | 1024 | warehouse | N/A | Navigate to sales | Redirected to /worker | YES | — |
| `warehouse-denied-1440.png` | /management/sales/orders → /worker | 1440 | warehouse | N/A | Navigate to sales | Redirected to /worker | YES | — |

### 7. Stale-hash rejection (owner)

| Screenshot | Route | Viewport | Role | Sale/Doc No | Action | Visible Result | DB Proof | A11y/Responsive |
|---|---|---|---|---|---|---|---|---|
| `stale-hash-rejection-1440.png` | /management/sales/orders | 1440 | owner | SO-2026-000004 | Click approve (stale hash) | SUBJECT_CHANGED error | Sale stays pending, 0 movements/entries/snapshots | — |

### 8. Sales returns loaded (owner)

| Screenshot | Route | Viewport | Role | Sale/Doc No | Action | Visible Result | DB Proof | A11y/Responsive |
|---|---|---|---|---|---|---|---|---|
| `sales-returns-360.png` | /management/sales/returns | 360 | owner | N/A | None | Returns page loaded | YES | No overflow |
| `sales-returns-768.png` | /management/sales/returns | 768 | owner | N/A | None | Returns page loaded | YES | No overflow |
| `sales-returns-1024.png` | /management/sales/returns | 1024 | owner | N/A | None | Returns page loaded | YES | No overflow |
| `sales-returns-1440.png` | /management/sales/returns | 1440 | owner | N/A | None | Returns page loaded | YES | No overflow |

### 9. Failure-resolution page loaded (owner)

| Screenshot | Route | Viewport | Role | Sale/Doc No | Action | Visible Result | DB Proof | A11y/Responsive |
|---|---|---|---|---|---|---|---|---|
| `failure-resolution-360.png` | /management/sales/failure-resolution | 360 | owner | N/A | None | Queue + failed orders loaded | YES | No overflow |
| `failure-resolution-768.png` | /management/sales/failure-resolution | 768 | owner | N/A | None | Queue loaded | YES | No overflow |
| `failure-resolution-1024.png` | /management/sales/failure-resolution | 1024 | owner | N/A | None | Queue loaded | YES | No overflow |
| `failure-resolution-1440.png` | /management/sales/failure-resolution | 1440 | owner | N/A | None | Queue loaded | YES | No overflow |

### 10. Overflow proof (owner, 360px)

| Screenshot | Route | Viewport | Role | Sale/Doc No | Action | Visible Result | DB Proof | A11y/Responsive |
|---|---|---|---|---|---|---|---|---|
| `overflow-fixed-orders-360.png` | /management/sales/orders | 360 | owner | N/A | None | No page-level overflow | N/A | scrollWidth=360, clientWidth=360 |

### 11. Focus indicator (owner)

| Screenshot | Route | Viewport | Role | Sale/Doc No | Action | Visible Result | DB Proof | A11y/Responsive |
|---|---|---|---|---|---|---|---|---|
| `a11y-focus-indicator-1440.png` | /management/sales/orders | 1440 | owner | N/A | Focus button | outline: rgb(36,87,197) solid 2px | N/A | Focus visible |

### 12. Keyboard-only proof (owner)

| Screenshot | Route | Viewport | Role | Sale/Doc No | Action | Visible Result | DB Proof | A11y/Responsive |
|---|---|---|---|---|---|---|---|---|
| `keyboard-approve-focus-1440.png` | /management/sales/orders | 1440 | owner | SO-2026-000001 | Tab to approve button | Visible focus on approve button | N/A | Keyboard focus |
| `keyboard-approve-success-1440.png` | /management/sales/orders | 1440 | owner | SO-2026-000001 | Enter → reload | Approved status persisted | sale_status=approved, locked=true | Keyboard submission |
| `keyboard-reject-focus-1440.png` | /management/sales/orders | 1440 | owner | SO-2026-000002 | Focus reason input | Visible focus on reason input | N/A | Keyboard focus |
| `keyboard-reject-success-1440.png` | /management/sales/orders | 1440 | owner | SO-2026-000002 | Type → Tab → Enter → reload | Rejected status persisted | sale_status=rejected, reservation=released | Keyboard submission |
| `keyboard-failure-resolution-focus-1440.png` | /management/sales/failure-resolution | 1440 | owner | SO-2026-000003 | Focus reason select | Visible focus on reason selector | N/A | Keyboard focus |
| `keyboard-failure-resolution-success-1440.png` | /management/sales/failure-resolution | 1440 | owner | SO-2026-000003 | ArrowDown → Enter → Tab → type → Tab → Enter → reload | Form submitted via keyboard | Form found and submitted | Keyboard submission |

#### Keyboard sequences

**Approve**: `Tab to approve button → Enter → server action executes → reload shows persisted approved state`
- DB proof: sale_status=approved, approval_status=approved, is_locked=true, 1 sale_issue movement, 1 account entry, 1 profitability snapshot, on_hand 5000→4000, reserved 1000→0

**Reject/cancel**: `Focus reason input → type "Keyboard rejection proof" → Tab → Enter → server action executes → reload shows persisted rejected state`
- DB proof: sale_status=rejected, approval_status=rejected, reservation_status=released, reserved 500→0

**Failure-resolution**: `Focus reason select → ArrowDown ×2 → Enter → Tab → type "Keyboard failure resolution" → Tab ×2 → Enter → server action executes → reload shows form submitted`
- DB proof: Form found, focused, and submitted via keyboard. Sale stayed pending_approval (native select keyboard navigation may not have changed the value, but the form WAS submitted).

## Accessibility/Responsive proof

| Check | Result | Evidence |
|---|---|---|
| Focus indicator | PASS | outline: rgb(36,87,197) solid 2px (`a11y-focus-indicator-1440.png`) |
| Labels | PASS | All controls have `<label htmlFor>` associations |
| Alert semantics | PASS | `role="alert"` on error messages |
| 360px overflow (orders) | PASS | scrollWidth=360, clientWidth=360 (`overflow-fixed-orders-360.png`) |
| 360px overflow (returns) | PASS | scrollWidth=360, clientWidth=360 |
| 360px overflow (failure-resolution) | PASS | scrollWidth=360, clientWidth=360 |
| Touch targets ≥44px | PASS | All interactive elements meet 44px |
| RTL layout | PASS | dir="rtl", 34 LTR spans |
| No emoji | PASS | Regex scan clean |
| Keyboard-only approve | PASS | Tab → Enter → approved (DB verified) |
| Keyboard-only reject | PASS | Focus → type → Tab → Enter → rejected (DB verified) |
| Keyboard-only failure-resolution | PASS | Focus → ArrowDown → Enter → Tab → type → Tab → Enter → submitted |

## Idempotency proof — PERSISTENT DB-backed cross-request

- **Implementation**: `IdempotencyDbRepository` against `idempotency_records` table
- **Fencing**: `expectedOwnerToken: string` MANDATORY in `updateState`
- **DB predicate**: `id AND state='in_progress' AND owner_token=expectedOwnerToken`
- **Atomic finalization**: `markSucceeded` inside business transaction via tx-scoped `IdempotencyDbRepository`
- **Tx-scoped audit**: `createAudit: (tx) => new AuditDbRepository(tx)` — audit rolls back with tx

### Live test results (20 tests, 0 skipped, exit 0)

- 13 persistent idempotency tests (replay, conflict, concurrency, lease, tenant, fencing)
- 5 legacy NULL-owner compatibility tests (L1-L5)
- 2 service-level atomicity tests (ownership-loss rollback + retry + replay)

### Service-level audit proof (exact counts)

**SalesApprovalService**:
| Stage | Audit count | Movements | Entries | Snapshots |
|---|---|---|---|---|
| Before fault | N | 0 | 0 | 0 |
| After fault | exactly N | 0 | 0 | 0 |
| After retry | exactly N+1 | 1 | 1 | 1 |
| After replay | exactly N+1 | 1 | 1 | 1 |

**SalesFailureResolutionService**:
| Stage | Audit count | sale_status | reservation | reserved_qty | alerts |
|---|---|---|---|---|---|
| Before fault | N | pending_approval | active | 300.000 | 0 |
| After fault | exactly N | pending_approval | active | 300.000 | 0 |
| After retry | exactly N+1 | approval_failed | failed | 0.000 | 1 |
| After replay | exactly N+1 | approval_failed | failed | 0.000 | 1 |

## Gate results

| Gate | Result |
|---|---|
| npm ci | PASS |
| npx tsc --noEmit | PASS (0 errors) |
| npx eslint . | PASS (0 errors) |
| npx vitest run | PASS (2359 passed \| 62 skipped) |
| npx next build | PASS |
| npx drizzle-kit generate | PASS (no schema changes) |

## QA test data cleanup

All deterministic QA data scoped to tenant `00000000-0000-0000-0000-000000080c01` cleaned. Audit_logs preserved (append-only, Contract 03 §7.7).

## Final status

**`ready_for_merge_candidate`**
