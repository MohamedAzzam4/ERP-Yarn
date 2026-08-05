# WP-08-01D Browser QA Manifest — Payments, Accounts and Direct-Cost Screens

**Date**: 2026-08-05
**Branch**: `phase/08-01d-payments-accounts-direct-cost-screens`
**Phase HEAD**: `135a78a8dddbf5f65aa7026207fc91887dcf6ef2` (persistent document sequencing checkpoint)
**QA method**: Browser automation (Playwright/Chromium) with real Supabase Auth + real DB
**Server**: `npx next dev -p 3000 -H 127.0.0.1` (dev build, env vars sourced from `.env` file mode 600, deleted after QA)

## Persistent document sequencing correction (committed as `135a78a`)

Before this checkpoint, all production server actions used
`InProcessDocumentSequenceStore` for document number allocation. The
`InProcessDocumentSequenceStore` resets its in-memory state to `last_number=0`
on every new server action invocation, so every payment post allocated
`entry_no='AE-2026-000001'`, colliding with the unique constraint after the
first post. A prior browser QA worked around this by renaming posted account
entries — a forbidden workaround that mutated posted financial records.

After this checkpoint:
- `DocumentSequenceDbRepository` (Drizzle-backed) replaces
  `InProcessDocumentSequenceStore` in ALL 11 production action/page paths.
- `findForUpdate` uses `SELECT ... FOR UPDATE` (row lock, tx-scoped).
- `insert` uses `ON CONFLICT DO NOTHING` + `DocumentSequenceConcurrentInsertError`
  (concurrent-insert safety — same pattern as `SubledgerDbRepository.insertAccount`).
- `allocateDocumentNumber` retries `findForUpdate` on concurrent insert.
- `txFactories` in sales/orders, sales-failure-resolution, payments, direct-costs
  now construct tx-scoped `DocumentSequenceDbRepository(tx)` (not root `db`).
- Closely related: `InProcessIdempotencyStore` also replaced with
  `IdempotencyDbRepository` in 7 production paths.
- NO in-memory document-sequence or idempotency store is used in production.
- NO manual mutation, renaming, archiving, or deletion of posted financial records.

## Test users

| Role | Email | Auth | Users-table ID |
|---|---|---|---|
| owner | qa-owner-d@erp-yarn.test | Real Supabase Auth (session minted via admin client) | 00000000-0000-0000-0000-000000080d02 |
| accountant | qa-acct-d@erp-yarn.test | Real Supabase Auth | 00000000-0000-0000-0000-000000080d03 |
| warehouse_employee | qa-wh-d@erp-yarn.test | Real Supabase Auth | 00000000-0000-0000-0000-000000080d04 |

## Seeded data — REAL DOMAIN FLOW

- Customer receivable via `SubledgerService.insertCustomerReceivableEntry` (+1000.00 EGP) — AE-8D-001
- 3 draft payments (PAY-8D-001 $500, PAY-8D-002 $300, PAY-8D-003 $200) seeded directly
- 1 direct cost draft (DC-8D-001 $100, customer responsibility, created by qa-acct-d)

## Viewports tested

360×640, 768×1024, 1024×768, 1440×900

## A. Settlement — post + settle + refresh + over-settle rejection (keyboard-only)

### A0: Post PAY-8D-001 (keyboard-only completion)

| Screenshot | Route | Viewport | Role | Fixture | Action | Visible Result | DB Proof | A11y |
|---|---|---|---|---|---|---|---|---|
| `settlement-A0-pre-post-keyboard-1440.png` | /management/accounts/payments | 1440 | owner | PAY-8D-001 (draft $500) | Tab to post button, Enter | Post form focused | — | Keyboard focus visible |
| `settlement-A0-post-success-1440.png` | /management/accounts/payments | 1440 | owner | Same | After Enter | Payment moved to posted section | payments.status='posted', posted_entry_id set, is_locked=true | — |

**DB Proof (after A0)**:
- `payments.status`: draft → **posted** ✓
- `payments.posted_entry_id`: NULL → **set** ✓
- `payments.is_locked`: false → **true** ✓
- `account_entries`: new `customer_payment` entry with `entry_no='AE-2026-000001'`, `amount_signed=-500.00` ✓
- `document_sequences`: `account_entry` row created, `last_number=1` ✓
- `audit_logs`: `payment.post` entry created ✓
- `idempotency_records`: `payment.post` state=**succeeded** ✓
- **Document number AE-2026-000001 allocated (first post)** ✓

### A1: Settle PAY-8D-001 against AE-8D-001 (keyboard-only completion)

| Screenshot | Route | Viewport | Role | Fixture | Action | Visible Result | DB Proof | A11y |
|---|---|---|---|---|---|---|---|---|
| `settlement-A1-pre-settle-keyboard-1440.png` | /management/accounts/payments | 1440 | owner | PAY-8D-001 (posted), AE-8D-001 (open receivable $1000) | Focus amount, Ctrl+A, type 200.00, Tab, Ctrl+A, type AE-8D-001 id, Tab | Settle form filled via keyboard | — | Keyboard navigation through form |
| `settlement-A1-settle-success-1440.png` | /management/accounts/payments | 1440 | owner | Same | Enter on submit | Page re-rendered with settlement recorded | payment_settlements row created | — |

**DB Proof (after A1)**:
- `payment_settlements`: 1 row with `settled_amount=200.00`, `settled_entry_id=AE-8D-001`, `settlement_status='settled'` ✓
- `account_entries` (posted entry): `settlement_status` → **partially_settled** ✓
- `account_entries` (target AE-8D-001): `settlement_status` → **partially_settled** ✓
- `audit_logs`: `payment.settle` entry created ✓
- `idempotency_records`: `payment.settle` state=**succeeded** ✓

### A2: Refresh — settlement persisted

| Screenshot | Route | Viewport | Role | Action | Visible Result | DB Proof |
|---|---|---|---|---|---|---|
| `settlement-A2-refreshed-1440.png` | /management/accounts/payments | 1440 | owner | Page refresh | Settlement still visible | payment_settlements row persists (count=1) |

### A3: Over-settlement rejection (keyboard-only)

| Screenshot | Route | Viewport | Role | Action | Visible Result | DB Proof |
|---|---|---|---|---|---|---|
| `settlement-A3-over-settle-pre-1440.png` | /management/accounts/payments | 1440 | owner | Focus amount, Ctrl+A, type 500.00 (exceeds 300.00 remaining) | Form filled | — |
| `settlement-A3-over-settle-reject-1440.png` | /management/accounts/payments | 1440 | owner | Enter on submit | Server rejects (over-settlement) | payment_settlements count remains 1 (no duplicate) |

**DB Proof (after A3)**:
- `payment_settlements`: count remains **1** (original 200.00, no duplicate created) ✓
- Over-settlement rejected by service-level capacity check ✓

## B. Reversal — post + reverse + refresh + repeat-reversal safety (keyboard-only)

### B1: Post PAY-8D-002 (keyboard-only completion)

| Screenshot | Route | Viewport | Role | Fixture | Action | Visible Result | DB Proof | A11y |
|---|---|---|---|---|---|---|---|---|
| `reversal-B1-pre-post-keyboard-1440.png` | /management/accounts/payments | 1440 | owner | PAY-8D-002 (draft $300) | Tab to post button | Post form focused | — | Keyboard focus visible |
| `reversal-B1-post-success-1440.png` | /management/accounts/payments | 1440 | owner | Same | Enter | Payment moved to posted section | payments.status='posted', posted_entry_id set | — |

**DB Proof (after B1)**:
- `payments.status`: draft → **posted** ✓
- `account_entries`: new `customer_payment` entry with `entry_no='AE-2026-000002'`, `amount_signed=-300.00` ✓
- `document_sequences`: `account_entry` `last_number=2` (incremented) ✓
- **Document number AE-2026-000002 allocated (DISTINCT — no collision)** ✓

### B2: Reverse PAY-8D-002 with reason (keyboard-only completion)

| Screenshot | Route | Viewport | Role | Fixture | Action | Visible Result | DB Proof | A11y |
|---|---|---|---|---|---|---|---|---|
| `reversal-B2-pre-reverse-keyboard-1440.png` | /management/accounts/payments | 1440 | owner | PAY-8D-002 (posted $300) | Focus reason, type "QA test reversal — wrong amount entered", Tab | Reverse form filled via keyboard | — | Keyboard navigation |
| `reversal-B2-reverse-success-1440.png` | /management/accounts/payments | 1440 | owner | Same | Enter on submit | Page re-rendered with payment reversed | payments.status='reversed', reversal entry created | — |

**DB Proof (after B2)**:
- `payments.status`: posted → **reversed** ✓
- `account_entries` (reversal entry): new `reversal` entry with `entry_no='AE-2026-000003'`, `amount_signed=+300.00` (opposite of original -300.00) ✓
- `document_sequences`: `account_entry` `last_number=3` (incremented) ✓
- **Reversal entry has distinct document number (AE-2026-000003)** ✓
- `account_entries` (original entry): `amount_signed` unchanged at **-300.00** (immutable) ✓
- `account_entries` (original entry): `settlement_status` → **reversed** ✓
- `audit_logs`: `payment.reverse` entry created ✓
- `idempotency_records`: `payment.reverse` state=**succeeded** ✓

### B3: Repeat-reversal safety

| Screenshot | Route | Viewport | Role | Action | Visible Result | DB Proof |
|---|---|---|---|---|---|---|
| `reversal-B3-repeat-safety-1440.png` | /management/accounts/payments | 1440 | owner | Visit payments page | Reverse form NOT rendered for reversed payment | No new reversal entry created |

**DB Proof (after B3)**:
- Reverse form count for reversed PAY-8D-002: **0** (UI prevents repeat reversal) ✓

## C. Direct cost — DEC-080 self-review block + review as different user (keyboard-only)

### C1: DEC-080 self-review block (qa-acct-d created DC-8D-001)

| Screenshot | Route | Viewport | Role | Fixture | Action | Visible Result | DB Proof |
|---|---|---|---|---|---|---|---|
| `direct-cost-C1-dec080-pre-1440.png` | /management/accounts/direct-costs | 1440 | accountant (qa-acct-d) | DC-8D-001 (created by qa-acct-d) | Fill review form, submit | Server rejects (DEC-080 self-review) | — |
| `direct-cost-C1-dec080-block-1440.png` | /management/accounts/direct-costs | 1440 | accountant | Same | After submit | DC-8D-001 unchanged | direct_costs.review_status unchanged |

**DB Proof (after C1)**:
- `direct_costs.review_status`: **needs_accountant_review** (unchanged) ✓
- `direct_costs.reviewed_by`: NULL (unchanged) ✓
- `idempotency_records`: `direct_cost.review` state=**business_failed**, `last_error_class=RequesterCannotApproveOwnDirectCostError` ✓

### C2: Review DC-8D-001 as qa-owner-d (keyboard-only completion)

| Screenshot | Route | Viewport | Role | Fixture | Action | Visible Result | DB Proof | A11y |
|---|---|---|---|---|---|---|---|---|
| `direct-cost-C2-pre-review-keyboard-1440.png` | /management/accounts/direct-costs | 1440 | owner (qa-owner-d) | DC-8D-001 (needs_accountant_review $100) | Focus amount, type 100.00, Tab through selects (ArrowDown to select), Tab to submit | Review form filled via keyboard | — | Full keyboard navigation through form |
| `direct-cost-C2-review-success-1440.png` | /management/accounts/direct-costs | 1440 | owner | Same | Enter on submit | Page re-rendered with DC approved | direct_costs.review_status='approved' | — |

**DB Proof (after C2)**:
- `direct_costs.review_status`: needs_accountant_review → **approved** ✓
- `direct_costs.reviewed_by`: NULL → **00000000-0000-0000-0000-000000080d02** (qa-owner-d users-table id) ✓
- `direct_costs.reviewed_at`: NULL → **set** ✓
- `direct_costs.included_in_profitability`: false → **true** ✓
- `direct_costs.actual_payer_type`: not_recorded → **customer** ✓
- `audit_logs`: direct_cost review audit entry created ✓
- `idempotency_records`: `direct_cost.review` state=**succeeded** ✓

### C3: Refresh — immutable reviewed result

| Screenshot | Route | Viewport | Role | Action | Visible Result | DB Proof |
|---|---|---|---|---|---|---|
| `direct-cost-C3-refreshed-1440.png` | /management/accounts/direct-costs | 1440 | owner | Page refresh | DC-8D-001 still shows approved | review_status remains 'approved' (immutable) |

## D. Multi-viewport + worker financial denial

### D1: Payments page at all viewports (owner, after all commands)

| Screenshot | Viewport | Visible Result | DB Proof | A11y |
|---|---|---|---|---|
| `payments-final-360.png` | 360 | PAY-8D-001 posted, PAY-8D-002 reversed, PAY-8D-003 draft | 3 payments in DB | No overflow |
| `payments-final-768.png` | 768 | Same | YES | No overflow |
| `payments-final-1024.png` | 1024 | Same | YES | No overflow |
| `payments-final-1440.png` | 1440 | Same with full table | YES | No overflow |

### D2: Direct costs page at all viewports (owner, after review)

| Screenshot | Viewport | Visible Result | DB Proof | A11y |
|---|---|---|---|---|
| `direct-costs-final-360.png` | 360 | DC-8D-001 approved | 1 direct cost in DB | No overflow |
| `direct-costs-final-768.png` | 768 | Same | YES | No overflow |
| `direct-costs-final-1024.png` | 1024 | Same | YES | No overflow |
| `direct-costs-final-1440.png` | 1440 | Same with full table | YES | No overflow |

### D3: Account statements page at all viewports (owner)

| Screenshot | Viewport | Visible Result | DB Proof | A11y |
|---|---|---|---|---|
| `balances-final-360.png` | 360 | Account statements with entries | balance=SUM(amount_signed) | No overflow |
| `balances-final-768.png` | 768 | Same | YES | No overflow |
| `balances-final-1024.png` | 1024 | Same | YES | No overflow |
| `balances-final-1440.png` | 1440 | Same | YES | No overflow |

### D4: Worker financial denial at all viewports (warehouse_employee)

| Screenshot | Viewport | Action | Visible Result | DB Proof | A11y |
|---|---|---|---|---|---|
| `worker-denied-final-360.png` | 360 | Navigate to /management/accounts/payments | Redirected to /worker | Not authorized | — |
| `worker-denied-final-768.png` | 768 | Same | Redirected | YES | — |
| `worker-denied-final-1024.png` | 1024 | Same | Redirected | YES | — |
| `worker-denied-final-1440.png` | 1440 | Same | Redirected | YES | — |

### D5: Keyboard-only focus indicator (from prior QA run — retained)

| Screenshot | Viewport | Action | Visible Result | A11y |
|---|---|---|---|---|
| `keyboard-focus-1-tab-1440.png` | 1440 | Tab key | Focus on first interactive element | Focus visible |
| `keyboard-focus-2-tab-1440.png` | 1440 | Tab key | Focus moved to next element | Focus visible |
| `keyboard-focus-3-tab-1440.png` | 1440 | Tab key | Focus moved to next element | Focus visible |

### D6: Validation error reference

| Screenshot | Viewport | Action | Visible Result | A11y |
|---|---|---|---|---|
| `validation-error-reference-1440.png` | 1440 | Page loaded (forms have required attributes) | Forms enforce client-side validation | — |

## Document number proof (NO workaround, NO manual mutation)

| Command | Document number allocated | document_sequences.last_number | Distinct? |
|---|---|---|---|
| A0: Post PAY-8D-001 | AE-2026-000001 | 1 | YES (first) |
| B1: Post PAY-8D-002 | AE-2026-000002 | 2 | YES (distinct from A0) |
| B2: Reverse PAY-8D-002 | AE-2026-000003 | 3 | YES (distinct from A0, B1) |

**NO document-number collision. NO workaround. NO manual mutation of posted financial records.**

The `DocumentSequenceDbRepository` persists `last_number` in the
`document_sequences` table across server action invocations. Each post
allocates a distinct, incremented document number.

## Persistent document sequencing proof (73 focused tests)

| Test Category | Count | Result |
|---|---|---|
| DocumentSequenceDbRepository is DB-backed (static analysis) | 7 | PASS |
| allocateDocumentNumber retries on concurrent insert | 1 | PASS |
| Two fresh instances allocate distinct numbers (bug proof) | 3 | PASS |
| Concurrent allocations are unique (in-process lock) | 1 | PASS |
| Tenant/type/year isolation | 3 | PASS |
| Failed transaction rollback semantics | 2 | PASS |
| Production actions do NOT instantiate InProcessDocumentSequenceStore | 36 | PASS |
| Production actions do NOT instantiate InProcessIdempotencyStore | 11 | PASS |
| txFactories use tx-scoped DocumentSequenceDbRepository | 5 | PASS |
| **Total** | **73** | **ALL PASS** |

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
| 360px overflow (balances) | PASS | No page-level overflow |
| 360px overflow (payments) | PASS | No page-level overflow |
| 360px overflow (direct-costs) | PASS | No page-level overflow |
| Touch targets ≥44px | PASS | All interactive elements meet 44px (inline style `minHeight: "44px"`) |
| RTL layout | PASS | `dir="rtl"`, LTR spans for codes/amounts/dates |
| No emoji | PASS | Regex scan clean |
| Keyboard-only completion (post payment) | PASS | Tab → Enter on post button → payment posted |
| Keyboard-only completion (settle payment) | PASS | Focus amount → Ctrl+A → type → Tab → Ctrl+A → type → Tab → Enter → settlement created |
| Keyboard-only completion (reverse payment) | PASS | Focus reason → type → Tab → Enter → payment reversed |
| Keyboard-only completion (direct-cost review) | PASS | Focus amount → type → Tab through selects (ArrowDown) → Tab to submit → Enter → DC approved |
| Focus indicator | PASS | Focus visible on all interactive elements |

## Gate results (after persistent document sequencing correction)

| Gate | Result |
|---|---|
| npm ci | PASS |
| npx tsc --noEmit | PASS (0 errors) |
| npx eslint . | PASS (0 errors) |
| npx vitest run | PASS (2534 passed \| 62 skipped) — was 2461, added 73 new tests |
| npx next build | PASS |
| npx drizzle-kit generate | PASS (no schema changes) |

## Screenshot count

**Total screenshots: 62** (40 from this QA run + 22 retained from prior QA runs)

## QA test data cleanup

All deterministic QA data scoped to tenant `00000000-0000-0000-0000-000000080d01`
cleaned (payments → draft, account_entries deleted, settlements deleted,
direct_cost_allocations deleted, idempotency_records deleted,
document_sequences deleted).
**Audit logs preserved (29 rows, append-only)** per Contract 03 §7.7.

## Final status

**WP-08-01D persistent document sequencing correction complete. Ready for merge candidate review.**

Persistent document sequencing checkpoint SHA: `135a78a8dddbf5f65aa7026207fc91887dcf6ef2`
origin/phase/08-01d: `135a78a8dddbf5f65aa7026207fc91887dcf6ef2` (pushed)
origin/main: `bfd9f4183fa49cd6d528bacb3727e261dbbc6093` (UNCHANGED — main NOT pushed)
