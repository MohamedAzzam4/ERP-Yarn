# Testing and Regression Plan

## 1. Purpose and Binding Rules

Define executable evidence required to accept each work package, phase, and pilot gate. This plan does not permit implementation to reinterpret domain contracts.

Mandatory rules:

- No phase is complete unless required tests pass or failures are documented; documented failures leave the package/phase incomplete unless its approved gate explicitly says otherwise.
- No high-risk business operation is accepted without service-layer transaction tests.
- No frontend screen is accepted without role/permission, field-redaction, Arabic RTL, accessibility, and required responsive checks.
- Every defect fix adds/runs the regression tests mapped to its affected domain.
- Tests use decimal-safe values and compare exact expected quantities/money; they do not bless floating-point approximations.
- Test evidence records command, environment, fixture/seed version, result, failure, date, and relevant screenshots/log references without secrets.

### Three-Layer Test Cadence

1. **Continuous implementation tests:** after each coherent implementation step, run the smallest relevant fast tests—such as the changed unit/component test, typecheck for the touched boundary, targeted service/database test, or focused lint. Fix failures before building further behavior on top of the change. Continuous tests are development feedback and do not by themselves complete the package.
2. **Work-package completion gate:** after implementation is complete, run the package's full required tests, package smoke test, every triggered regression row, and all required permission/concurrency/rollback/accessibility/manual checks. The package remains `incomplete` when any required check fails, is skipped, cannot run, or lacks evidence; GLM must not begin the next package.
3. **Integrated phase gate:** after all required phase packages are individually complete, synchronize the phase branch with current `main` and rerun the phase build, typecheck, lint, integrated workflows, phase smoke catalog, cumulative triggered regressions, and relevant hosted Supabase/Vercel Preview/browser/security checks. Only a passing documented phase gate may be presented for owner-authorized merge.

The layers are cumulative. Phase testing never substitutes for package testing, and package testing never excuses missing focused feedback during implementation.

## 2. Test Levels

1. **Unit:** pure decimal calculation, state/validation, mapping, DTO/redaction, formatting and permission policy.
2. **Database/constraint:** tenant keys, uniqueness, status/check/precision, immutability, indexes, migrations.
3. **Service/transaction integration:** locks, posting, idempotency, audit, rollback, domain-service coordination.
4. **API integration:** auth, permission, tenant isolation, request/response schema, errors, field filtering.
5. **Browser/component integration:** forms, tables, drawers/dialogs, role navigation, RTL, accessibility, states.
6. **End-to-end smoke:** smallest realistic lifecycle per phase.
7. **Restore/migration/operational:** backup evidence, separate-target restore, import staging/reconciliation/commit.
8. **Manual/UAT:** role workflow, client terminology, reference-screen visual approval, pilot reconciliation.

## 3. Required Fixtures

Fixtures are versioned and tenant-scoped. Include a second tenant for isolation tests and five active users (Owner, Accountant, Warehouse, Production, Quality) plus inactive/unauthorized users. The exact three reference-screen fixture versions and their prohibited-data counterparts are blocked by PCD-UX-004; agents may not silently designate an ad hoc fixture as canonical or use real client data for visual approval.

### 3.1 Inventory and Reservation

```text
Raw batch RB-001; Warehouse A; on-hand 1,000.000 kg.
Pending sale: 300.000 kg.
Expected pending: on-hand 1,000.000; reserved 300.000; available 700.000.
Expected approved: on-hand 700.000; reserved 0; one sale issue; receivable posted.
```

Add Warehouse B, one external factory/location, blocked/returned items, an active reservation, a corrupted reservation mismatch, and concurrency requests that compete for the same availability.

### 3.2 Production/WIP

```text
Input 5,000.000 kg raw.
Output 4,250.000 kg single yarn.
Waste 750.000 kg.
Factory rate EGP 30,000.00 per input ton.
Expected payable EGP 150,000.00; output 4,250.000; waste 750.000; WIP 0.
```

Add partial receipt: consumed 3,000.000 + waste 500.000, output 2,500.000, remaining WIP 1,500.000; second receipt cannot reuse allocated input.

### 3.3 Subledger

```text
Sale 100,000.00; customer payment 40,000.00; customer balance +60,000.00.
Supplier purchase 80,000.00; payment 30,000.00; supplier balance -50,000.00.
Factory payable 150,000.00; payment 50,000.00; factory balance -100,000.00.
```

Include advance, partial settlement, over-settlement attempt, reversed payment, missing-price receipt, and customer credit.

### 3.4 Discount and Rounding

- Three equal gross lines and `order_discount_total = 0.01`: individually rounded allocations produce a residual; it goes to the lowest stable line number because gross lines tie.
- Unequal gross lines with residual: adjustment goes to the largest gross line.
- Midpoint values exercise `ROUND_HALF_UP` at posting.
- Zero total gross permits only zero discount.
- Verify precise allocations `DECIMAL(24,8)`, ratios at least 12 decimals, posted money `DECIMAL(18,2)`, and exact line/document sums.

### 3.5 Replacement Return

Original approved sale line has quantity, allocated discount, approved posted net revenue, and `DECIMAL(18,6)` net unit value. Include prior partial return and three replacement cases:

- replacement equals remaining return credit;
- replacement is higher;
- replacement is lower and leaves customer credit.

Verify refund is a separate payment action and cumulative credit cannot exceed remaining original line value.

### 3.6 Historical Cost and Migration

```text
Historical input 5,000.000 kg; output 4,250.000 kg.
Imported factory cost 127,500.00.
Current formula comparison 150,000.00.
Expected difference 22,500.00, warning/review, imported value unchanged.
```

Provide normalized and messy source files containing formulas, duplicate rows/document numbers, aliases, invalid/future/logically inconsistent dates, missing master data, EGP/currency mismatch, negative-stock result, balance mismatch, unmatched lineage, and AI low-confidence values.

### 3.7 UX/Permission Data

Include long Arabic labels, mixed Arabic/English identifiers, long document/batch/lot codes, large quantities/money, empty queues, partial backend failures, denied actions, and enough rows to test pagination/horizontal scrolling.

## 4. Phase-Specific Test Gates

### Phase 0 — Foundation

- clean install/build/type/lint/test commands;
- environment schema rejects missing/unsafe variables without exposing secrets;
- database connection and empty-database migrations succeed;
- tenant, role, permission, document-sequence and demo seeds are deterministic;
- deployment opens online in Europe-region configuration evidence;
- Arabic root/layout and health endpoint smoke;
- no application-request migration path.

### Phase 1 — Auth/RBAC/Audit/UX Foundations

- each role login/session mapping after auth choice is resolved;
- inactive/unmapped/cross-tenant user denied;
- backend permission and field redaction for every role;
- Owner-only role management; Accountant cannot self-grant;
- audit append-only and success transaction coupling;
- document sequence uniqueness under concurrency;
- approval/idempotency skeleton conflict/replay;
- shared shell versus Worker Task Mode navigation;
- three reference screens pass visual/role/RTL/accessibility checks and obtain owner approval before expansion.

### Phase 2 — Masters/Raw Receipts/Backup

- tenant uniqueness/inactivation and factory-location one-to-one;
- raw receipt 1,000 kg posting and supplier payable sign;
- missing price posts stock but no zero/estimated payable and enters review;
- worker request/response has no price/cost/balance;
- receipt approval rollback on movement/account/audit failure;
- manual backup plus separate-target restore smoke/evidence;
- raw-batch thin traceability.

### Phase 3 — Inventory/Reservations/Transfers

- movement/balance atomicity and reconciliation;
- one-step transfer source/destination rollback together;
- reservation creation/consumption/rejection/cancellation;
- simultaneous reservations cannot oversell;
- ordinary negative posting blocked and controlled historical/correction alert visible;
- technical approval failure leaves sale/reservation unchanged;
- stock/quality/commercial business failures retain reservation for review;
- corrupted reservation resolution fails/reconciles/alerts once;
- reversal inserts inverse and preserves original.

### Phase 4 — Production/WIP

- factory on-hand becomes WIP only on issue;
- full/partial receipt allocations, output, waste and WIP reconcile;
- input allocation cannot be charged twice;
- factory payable uses input basis and posts only at receipt approval;
- midpoint/residual posting rounding is exact;
- rate changes do not recalculate approved receipt;
- `return_from_wip` request has no effect before approval and then atomically reduces WIP/increases stock;
- many-to-many lineage remains possible; worker financial redaction.

### Phase 5 — Sales/Approvals/Payments/Direct Costs

- multi-line submission reserves only and requires commercial management fields;
- discount allocation/residual/document-total fixtures pass exactly;
- approval atomically posts stock, receivable, snapshot and audit;
- duplicate/concurrent approvals produce one effect;
- technical versus business failure classification and Arabic retry message;
- reason-based reservation resolution;
- payments, advance/partial settlement, reversal and signs;
- missing-cost flags/versioned profitability;
- direct-cost responsibility/payer separation and allocation reconciliation.

### Phase 6 — Quality/Complaints/Returns

- quality state and risky-sale approval guards;
- worker cannot authorize financial/disposition effects;
- return quantity/value cap after prior returns;
- return stock classification availability;
- return credit and replacement equal/higher/lower cases;
- replacement uses normal sale reservation/approval and linked events;
- automatic refund prohibited; correction/reversal preserves originals.

### Phase 7 — Historical Migration

- staging/validation/reconciliation have zero operational effects;
- provenance/formulas/mapping versions preserved;
- AI cannot commit directly; low confidence enters review;
- blockers, warnings, aliases, dates, duplicates, currency, lineage and balance mismatches behave per contract;
- reports expose negative stock, unmatched and duplicate records;
- two current approvals bound to one batch hash/version;
- atomic idempotent commit, locked history, invalid `approved_after_import_review` rejected;
- historical cost preserved; correction uses linked domain effects.

### Phase 8 — Reports/Profitability/Traceability

- raw → production → sale → complaint/return/correction chain;
- report totals match fixture ledgers and filters;
- profitability uses posted net after discount, version/missing flags visible;
- worker financial report/export denied at API and browser;
- exported rows/columns match authorized on-screen scope; export is labeled internal report.

### Phase 9 — Hardening/Pilot

- full regression matrix;
- tenant/security/permission sweep;
- concurrency/idempotency/failure injection;
- migration and restore tests;
- browser tests for all roles and reference screens;
- performance against representative bounded pilot data;
- backup/restore evidence and write-disable/rollback drill;
- parallel Excel reconciliation and UAT evidence;
- known limitations and unresolved production decisions remain visible.

## 5. High-Risk Service Test Standard

Every approval/post/reverse/correct/commit service tests:

1. success effects and exact values;
2. permission/tenant/state/precondition denial;
3. rows locked/rechecked under concurrency;
4. same idempotency key/same request replay;
5. same key/different request conflict;
6. processing collision;
7. injected failure after each dependent write;
8. audit failure rollback;
9. no partial movement/balance/WIP/account/snapshot/status;
10. immutable original and linked reversal/correction;
11. role-safe response fields;
12. technical versus business failure behavior where applicable.

## 6. Domain Test Catalog

### Inventory and Reservations

Receipt, transfer, sale issue, return, adjustment, block/unblock, reversal, WIP interaction, materialized reconciliation, negative alert, concurrent reservation, double release, corruption resolution, and silent-balance-write rejection.

### Production/WIP and `return_from_wip`

Issue availability, WIP invariant, full/partial/multiple inputs/outputs, waste, output lot, duplicate allocation, payable timing/sign/rounding, rate snapshot, WIP return, correction and lineage.

### Approvals and Failure Classification

Dedicated command only; reason, state, permission, lock order, idempotency, audit, stale request, technical rollback/no state change, business no-posting plus separate sales resolution, human reject distinct from `approval_failed`.

### Subledger, Payments and Direct Cost

Signed entries, derived balances, missing price, advance/partial/over-settlement, reversal/unallocation, factory payable, customer receivable/credit, direct-cost responsibility versus payer, review before posting, versioned profitability.

### Replacement Returns

Original-line linkage/net unit value, prior quantity/value caps, separate return and replacement events, ordinary replacement reservation/approval, equal/higher/lower financial outcomes, separate explicit refund, worker redaction.

### Discount/Rounding

Decimal-only arithmetic, precision/scale, no early rounding, `ROUND_HALF_UP` posting, proportional allocation, largest-line residual, lowest-line-number tie, stored adjustment, posted discount and net sums, receivable/document total equality.

### Historical Migration

Template versions, private files/checksums, staging isolation, source traceability, formula/AI metadata, severity, logical dates, aliases, reconciliation, warning acceptance, dual approval invalidation, backup gate, atomic commit/rollback/idempotency, lock/correction and imported cost.

## 7. Permission and Redaction Tests

For every endpoint/query/export/dashboard/chart/error/nested relationship:

- authenticate each role and inactive/foreign-tenant users;
- assert allowed actions and denied direct URL/API calls;
- assert forbidden properties are absent, not merely null/hidden;
- assert request schemas reject forbidden worker financial fields;
- test Owner/Accountant differences despite shared shell;
- test worker price/cost/rate/payable/receivable/balance/settlement/profit/audit/migration/backup redaction;
- test export and chart aggregate permissions;
- test service-role/RLS paths still apply ERP authorization.

## 8. Browser, Visual, Accessibility, RTL and Responsive QA

### 8.1 Reference Screens

For Worker raw-material receipt, Accountant review queue, and Owner dashboard, use the PCD-UX-004 fixture versions and capture evidence at required breakpoints and states. Validate exact expected totals/states, prohibited-field absence, approved token values, typography/density, permission-safe data, cards/forms/tables/drawers/alerts, and owner approval metadata.

### 8.2 Accessibility

- WCAG 2.2 AA target;
- keyboard-only completion and logical RTL focus order;
- visible focus and no unmanaged focus traps;
- worker targets at least 44×44px;
- contrast checks;
- `prefers-reduced-motion` static behavior;
- accessible names/labels/roles/states and linked errors;
- error summary and focus to invalid field where suitable;
- 200% zoom without loss of operation/critical data;
- no toast-only or color-only critical feedback;
- accessible tables/pagination/menus/dialogs/drawers/date controls/approvals;
- accessible chart summary/table.

### 8.3 RTL and Bidirectional

Assert `<html lang="ar" dir="rtl">` and test dialogs, drawers, sidebars, tables, pagination, dropdowns/comboboxes, date fields, forms/errors, toasts/alerts, charts/tooltips, directional icons, breadcrumbs, keyboard navigation, mixed Arabic/English content, and local LTR isolation for all contracted value types. Full Arabic sentences must not flip direction when beginning with English/code text.

### 8.4 Responsive

- Worker Task Mode fully operable at 360, 390, tablet, and desktop widths.
- Management desktop-first and tablet-supported.
- Management phone checks practical summaries/approvals and explicit larger-screen messaging.
- Dense financial/migration tables use controlled horizontal scrolling or summary/detail; no critical silent omission.

### 8.5 Required UI States

Initial, empty, skeleton/loading, success, field/general validation, permission denied, not found, conflict/idempotency, business review failure, technical retryable failure, offline/network, partial dashboard/report failure, and read-only locked state.

## 9. Smoke Test Catalog

- **Foundation:** online app, DB health, migration history, Arabic protected shell.
- **RBAC:** login each role, routes/fields differ, one approval draft/audit.
- **Raw:** create/approve 1,000kg receipt; balance/payable or review correct.
- **Inventory:** transfer to factory; reserve/cancel; ledger reconciles.
- **Production:** issue, partial/full receive, waste, payable, WIP return.
- **Sales:** submit/approve, partial payment, customer statement, failure-resolution sample.
- **Returns:** quality test, complaint, return and one linked replacement.
- **Migration:** upload/stage/validate/reconcile/dual approve/commit/lock sample.
- **Reports:** traceability and fixture reports; Accountant export; Worker denied.
- **Hardening:** full lifecycle, backup, separate restore, write-disable/rollback rehearsal.

## 10. Regression Matrix

| Changed area | Mandatory regression | Risk |
| --- | --- | --- |
| Auth/session/RBAC | login/recovery marker, tenant, all role/action/field/export tests | Critical |
| Schema/migration | clean DB, representative upgrade, constraints, immutability, tenant keys | Critical |
| Design tokens/shared UI | three references, RTL, accessibility, responsive, role views | High |
| Document number/idempotency/audit | concurrency, replay/conflict, append-only, rollback | Critical |
| Raw receipt | stock, missing/known price payable, worker redaction, traceability | Critical |
| Inventory ledger/balance | all movements, reconciliation, negative, reversal, concurrency | Critical |
| Reservations/sales submission | availability, concurrent reserve, consume/release/fail mapping | Critical |
| Production/WIP | issue, partial receipt, waste, WIP return, lineage, payable | Critical |
| Factory cost/rounding | input formula, snapshots, midpoint/residual, historical preservation | Critical |
| Sales/discount/approval | allocation, totals, issue, receivable, failure class, idempotency | Critical |
| Payments/subledger | signs, partial/advance/settlement/reversal, balance | Critical |
| Direct costs | responsibility/payer, review, allocation, profitability | High |
| Quality/complaints/returns | block/risk, cap, stock/account, replacement/refund | Critical |
| Historical migration | provenance, staging, validation, reconciliation, approvals, atomic lock | Critical |
| Profitability | net discount, missing flags, versions, return impact | High |
| Traceability/reports/export | chain, totals/filters, role fields, internal-only label | High |
| Backup/restore/deployment | backup, separate restore, evidence, no secrets, rollback | Critical |

## 11. Known High-Risk Cases

Two simultaneous approvals; same idempotency key with changed body; failure after stock before account/audit; stale reservation; corrupted reserved total; partial-production duplicate allocation; payable rounded early; discount residual tie; prior returns near value cap; worker nested/error/export leak; cross-tenant source reference; AI commit attempt; approvals against stale batch hash; restore evidence missing; 200% zoom with sticky table/drawer; Arabic sentence beginning with code; date-only timezone boundary.

### 11.1 Security, Role and Approval Mutation

- Multi-role users under the owner-approved conflict policy; no role combination may bypass the worker financial-deny ceiling.
- Role assignment/revocation during an active session invalidates or re-evaluates authorization before the next protected action.
- Worker assigned-location/factory/task row scope for reads/writes, including direct URL and cross-scope IDs.
- Approval requester-versus-approver separation where contracted.
- Any approval-relevant parent/line/child mutation changes subject version/hash, invalidates the request and blocks stale approval.

### 11.2 Idempotency and Transaction Races

- Crash/connection loss after database commit but before response: retry discovers the unique committed effect and returns it without duplication.
- Expired/orphaned `in_progress` lease can be atomically reclaimed; a live lease remains protected.
- Transfer versus reservation, block versus reservation, and sale approval versus transfer on the same item/location.
- Production receipt versus WIP return and two simultaneous partial receipts sharing an input allocation.
- Two concurrent returns against the same sale line quantity/value cap.
- Payment settlement versus reversal and two simultaneous settlements against the same remaining amount.
- Late raw-price confirmation duplicate/concurrency/failure rollback.

### 11.3 Classification, Quality and Return Rounding

- Partial blocked/returned/risky-stock ordinary transfer is blocked by DEC-064 until approved disposition/correction makes the quantity explicitly transferable; test ordinary accepted/sellable transfer and rejection of risky classifications.
- Quality-risk reservation/submission is blocked by DEC-065 until review/disposition makes stock accepted/sellable; test accepted/sellable reservation and rejection of needs-review/blocked/discounted-return stock.
- Final partial-return credit follows DEC-068; verify cumulative posted credits equal but never exceed original posted line net value.

### 11.4 Migration Cutover and Capacity

- Opening balances plus transaction history cannot double count inventory or party balances.
- Historical/live internal document numbers cannot collide; source document number remains preserved.
- Migration commit versus concurrent live posting respects the cutover lock/boundary.
- WIP opening/incomplete production does not duplicate issue, receipt, waste or payable.
- Measured maximum supported import batch size, timeout margin, rollback and retry behavior.
- Owner/Accountant historical migration approval identity behavior matches DEC-069: two distinct user identities are required.

### 11.5 Recovery and Manual Accessibility Evidence

- Backup artifacts/evidence are access-controlled, contain no credentials and include independently recoverable files/source artifacts.
- Restore exercises database plus independent file recovery where required.
- Approved final tokens receive manual contrast review; reference screens receive screen-reader checks in addition to automated accessibility tooling.

## 12. Failure Documentation

When a required test cannot pass/run, record:

```text
work package and contract clause
test/command
environment and fixture
expected result
actual result/error
evidence reference
risk and affected data/roles
temporary containment
required owner/technical decision
status = incomplete or blocked
```

Never delete, skip, weaken, or relabel a failing critical test to declare completion.

## 13. Acceptance Criteria

- Fixtures and exact expectations are reproducible.
- Every package/phase maps to unit/database/service/API/browser/smoke/regression evidence as applicable.
- Critical domains include concurrency, idempotency and injected rollback tests.
- Permission/redaction tests cover backend responses and frontend behavior.
- Reference screens and every expanded screen pass role/RTL/accessibility/responsive gates.
- Historical/backup/restore evidence is retained.
- Failures remain visible and prevent false completion.

## 14. Notes for AI Coding Agents

Read this plan plus the changed domain/UI/API/permission contracts before coding. Add tests in the same work package as behavior. Do not replace service-layer tests with browser clicks. Do not use snapshot tests as the sole proof of numeric, permission, RTL, or accessibility behavior. Never update expected values merely to match unexplained output. Completion reports must list exact commands and results.
