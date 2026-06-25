# Frontend Screen Contracts

## 1. Purpose and Authority

Define the MVP screens, role-safe information architecture, fields, actions, states, responsive behavior, RTL behavior, and acceptance rules. This contract is subordinate to the business/domain contracts and must be read with:

- `01_technical_architecture_and_deployment_contract.md`;
- `02_design_system_and_ux_contract.md`;
- `09_api_contracts.md`;
- `11_permission_matrix.md`;
- the domain contract governing the screen's data and commands.

Frontend visibility is not authorization. Backend permissions and role-filtered DTOs remain mandatory.

## 2. Global Screen Rules

These rules apply to every screen below unless a stricter screen rule is stated:

- Root document: `<html lang="ar" dir="rtl">`.
- Arabic sentences and critical messages remain RTL; do not use `dir="auto"` for them.
- Isolate codes, batch/lot/document identifiers, emails, phone numbers, URLs, dates, quantities, money, numeric cells, and technical identifiers with the shared LTR-isolation component/equivalent `<bdi dir="ltr">`.
- Light-only Calm Enterprise design; Tajawal or another approved modern Arabic sans for body/data and Alexandria or the approved heading/action font for headings/navigation/actions.
- Western numerals; display date `DD/MM/YYYY`; internal date handling remains ISO-compatible and date-only values cannot timezone-shift.
- Semantic design tokens/Tailwind utilities only; no literal component colors.
- Every screen defines initial/empty, loading, success, validation, permission-denied, not-found, state/idempotency conflict, server, and network states as applicable.
- Critical state is persistent and communicated with text/icon—not color or toast alone.
- WCAG 2.2 AA target: keyboard operation, visible focus, labels/errors, contrast, reduced motion, 200% zoom, semantic landmarks/headings, and accessible dialogs/drawers/tables.
- Worker controls have at least 44×44px targets and work from 360px upward.
- Management Console is desktop-first/tablet-supported; phone supports practical summaries/approvals, with an explicit larger-screen message for unsupported dense work.
- Owner and Accountant share shell, navigation logic, table/filter/detail/drawer/card patterns. Permissions, data, actions, and default widgets differ.
- Worker Task Mode is task-first, not a reduced management console, and never receives price, cost, rate, payable, receivable, balance, settlement, allocation, payer, profitability, or financial audit data.
- Worker choice controls use predefined options for routine fields, but must provide a safe "other / not listed" path when the required option is missing; that path captures temporary operational text/notes and routes the record for review instead of creating official master data.
- Client forms do not submit calculated stock/account/cost/profitability effects or authoritative tenant/role/actor data.
- Every management screen contract/package must declare phone support as exactly `full`, `summary_only`, `approval_only`, or `unsupported_requires_larger_screen`; “where practical” is not implementation discretion and is blocked by PCD-UX-003 until declared.
- Worker row visibility/write scope follows PCD-SEC-001. Until resolved, a frontend must not imply tenant-wide worker access.
- The worker financial-deny ceiling remains absolute until PCD-SEC-002 is resolved; role customization cannot fetch forbidden data.
- Worker transport DTOs may carry only the simple contracted amount/responsibility/notes and must be separate from payer/allocation/subledger/profitability DTOs.

## 3. Mandatory Reference-Screen Gate

Before broad frontend expansion, implementation must create and obtain owner approval for:

1. Worker raw-material receipt.
2. Accountant review queue.
3. Owner dashboard.

They are the visual acceptance baseline for spacing, typography, density, semantic token values, cards/forms/tables/drawers/alerts/buttons, Arabic hierarchy, RTL/LTR isolation, responsive behavior, motion, accessibility, and permission-safe information density.

Approval evidence records screen version, palette values, typography/density, accepted breakpoints, Arabic/RTL behavior, known visual limitations, decision date, and screenshots/equivalent evidence. Until approved, agents may build primitives and these screens only—not replicate their provisional patterns across modules.

Each reference uses the canonical versioned synthetic fixture and prohibited-data fixture resolved under PCD-UX-004 and represented in the Testing Plan. Fixture-only action controls remain visibly disabled/read-only and labeled as non-operational until the real command package exists; a visual reference must not imply a successful workflow that backend contracts cannot perform.

PCD-UX-001 must provide the approved/provisional Arabic terminology fixture. PCD-UX-002 must identify the canonical repository/evidence record and valid owner sign-off mechanism. PCD-UX-004 must provide the canonical synthetic and prohibited-data fixture versions. Without all three, the gate cannot pass even when screenshots look acceptable.

## 4. Authentication Screens

### 4.1 Login

- **Purpose:** Establish a private authenticated session and route an active ERP user to the authorized UX mode.
- **Target roles:** All active roles; unauthenticated users only before success.
- **UX mode:** Neutral authentication shell; redirects to Worker Task Mode or Management Console after backend role resolution.
- **Visible fields:** Approved private identifier, credential/control required by the eventual auth decision, Arabic labels, submit, support/recovery entry when approved.
- **Hidden fields:** Tenant ID, role selector, permission preview, service keys, internal auth metadata.
- **Allowed actions:** Sign in, reach approved recovery/support path, sign out stale session.
- **Forbidden actions:** Public signup, fake role selection, client-assigned tenant/role, revealing whether a forbidden account exists.
- **API dependencies:** Supabase server-authenticated session integration and ERP user/tenant mapping from Technical Architecture; no direct operational data.
- **Validation:** Structural client validation; generic server authentication failure; rate/abuse protections follow provider setup.
- **RTL/LTR:** Arabic shell RTL; email/phone/code isolated LTR.
- **Redaction/simplification:** No business/financial preview; concise Arabic instructions.
- **Accessibility/responsive:** Labeled credential controls, visible focus, accessible error summary, 360px through desktop.
- **States:** Initial, submitting, invalid credential, inactive/unmapped ERP user, provider unavailable, success redirect.
- **Acceptance:** No role/tenant claim in client body; protected route cannot render before server validation.
- **Common failures:** Open signup, role dropdown, account enumeration, redirect based only on client metadata.
- **AI coding note:** **Unresolved / requires owner decision:** private sign-in method and password/account-recovery policy. Do not invent controls or copy until resolved.

### 4.2 Password / Account Recovery

- **Purpose:** Recover access through the owner-approved private method without weakening provisioning.
- **Target roles:** Unauthenticated existing users; Owner-controlled activation remains authoritative.
- **UX mode:** Authentication shell.
- **Visible fields/actions:** Only those required by the chosen method; generic request confirmation and return-to-login.
- **Hidden/forbidden:** Role/tenant/security settings, public account creation, account-existence disclosure, direct privileged activation.
- **API dependencies:** Supabase recovery flow plus ERP active-user check as approved.
- **Validation:** Generic response; single-use/expiry/provider rules; recovery does not grant ERP role.
- **RTL/LTR/redaction:** Arabic RTL; identifier/token isolated LTR; no business data.
- **Accessibility/responsive/states:** Same login requirements; include expired/invalid token and provider failure.
- **Acceptance:** Recovery cannot create or activate an ERP user or change permissions.
- **Common failures:** Treating email recovery as ERP authorization; exposing account existence.
- **AI coding note:** Screen remains a marker/wireframe only until the unresolved auth decision is approved.

## 5. Shared Home and Shell Screens

### 5.1 Worker Task Mode Home

- **Purpose:** Give workers direct entry to authorized tasks and recent operational status.
- **Target roles:** Warehouse, Production, Quality.
- **UX mode:** Worker Task Mode.
- **Visible fields:** Role-authorized task cards, draft/review counts, recent relevant operations, plain Arabic status.
- **Hidden fields:** Module tree, all financial widgets/terms, audit, migration, settings, balances, profitability.
- **Allowed actions:** Open permitted task, resume own draft, view task-scoped status.
- **Forbidden actions:** Approval/reversal/financial action, global reports, discover hidden URLs.
- **API dependencies:** Role-filtered task summary/read DTO; permission matrix.
- **Validation:** Backend rejects unauthorized task even if URL is entered.
- **RTL/LTR:** Arabic tasks RTL; codes/dates/quantities isolated LTR.
- **Redaction/simplification:** Large task cards such as استلام خام، نقل مخزون، استلام مرتجع، تسجيل إنتاج، تسجيل جودة; no abstract accounting/module labels.
- **Accessibility/responsive:** 44×44px minimum, keyboard/task-card semantics, one-column at 360px.
- **States:** No tasks, loading, permission changed, recent-operation failure, network retry.
- **Acceptance:** Each worker sees only role-authorized operations and no restricted response fields.
- **Common failures:** Mini dashboard, dense sidebar, financial counts, client-only task hiding.
- **AI coding note:** Do not add convenience widgets not backed by permission-safe DTOs.

### 5.2 Management Console Shell

- **Purpose:** Provide one coherent management information architecture for Owner and Accountant.
- **Target roles:** Owner, Accountant.
- **UX mode:** Management Console.
- **Visible fields:** Permission-filtered grouped RTL sidebar, always-visible sidebar collapse toggle, independently collapsible sidebar categories, breadcrumb/context, quick search, notifications, manual refresh, alerts/approval counts, account menu, current tenant label, last-refreshed/stale-data indicator.
- **Hidden fields:** Destinations/actions lacking backend permission; secrets and provider internals.
- **Allowed actions:** Navigate authorized management areas; collapse/expand sidebar; collapse/expand sidebar categories; open permission-filtered alerts, approvals, notifications, and quick-search results only where contracted; manually refresh authorized reads.
- **Forbidden actions:** Client permission escalation; generic table/module access; assuming Owner and Accountant are equivalent.
- **API dependencies:** Session/user/permission summary, safe queue counts, contracted permission-filtered quick search/notification/read-refresh endpoints.
- **Validation:** Server protects every destination; stale permission refresh results in safe denial.
- **RTL/LTR:** RTL sidebar/breadcrumb/drawers; identifiers isolated LTR; directional icons reviewed for RTL meaning.
- **Redaction/simplification:** Accountant does not receive Owner-only user/security controls; shared visual language remains.
- **Accessibility/responsive:** Keyboard sidebar, skip navigation, landmarks, tablet support; phone only practical summaries/approvals.
- **States:** Shell loading, no permitted destination, permission revoked, offline, service error, stale data, refresh in progress, no search results, notification read/unread.
- **Acceptance:** Direct URL and navigation produce the same backend-enforced result.
- **Common failures:** Separate visual systems, full permission payload trusted client-side, hidden links still callable.
- **AI coding note:** Do not build quick search, notification drill-down, or refresh behavior as client-only authorization shortcuts. If a current work package lacks the contracted permission-filtered backend, show a disabled/static visual placeholder or mark **Unresolved / requires owner decision**.

## 6. Dashboards

### 6.1 Owner Dashboard — Reference Screen

- **Purpose:** Present high-level decisions, exceptions, and drill-downs without replacing source reports.
- **Target roles:** Owner.
- **UX mode:** Management Console.
- **Visible fields:** Total stock, stock/raw material at external factories, current-month sales, total operations needing review, total important warnings, negative-stock/stock-risk alerts, open complaints, approximate profitability label/profile/missing flags, customer/factory balance summaries, backup and migration status, recent important operations, chart summaries for stock by location/factory, external-factory stock distribution, monthly sales trend, review/warning trend, and complaints by status where useful.
- **Hidden fields:** Secrets, raw audit payloads, unapproved calculated/client values.
- **Allowed actions:** Open permission-safe detail/report/approval/traceability screens; click KPI cards/numbers as navigation shortcuts to the relevant detail screen with the relevant filter selected where supported; acknowledge only where contracted.
- **Forbidden actions:** Edit posted data from cards, approve via undocumented quick toggle, treat approximate profit as statutory, turn the dashboard into the main review work queue, use internal factory-floor KPIs such as machine utilization/shift efficiency/worker productivity/production-line efficiency, or use unlabeled "production efficiency" metrics.
- **API dependencies:** Permission-filtered dashboard/read services; Approval/Reports/Backup/Migration DTOs; no browser aggregation of restricted raw rows.
- **Validation:** Date/filter bounds; missing/incomplete metrics explicitly labeled.
- **RTL/LTR:** Arabic hierarchy RTL; KPI numbers/currency/dates/codes LTR-isolated.
- **Redaction/simplification:** Owner financial visibility allowed; dashboard is an insight cockpit with high-level KPI cards, simple charts, and a latest-activity timeline. Detailed review rows belong in the Approval/Review Center, not on the dashboard.
- **Accessibility/responsive:** Keyboard cards/drill-downs, chart accessible summary, desktop/tablet; phone summaries only.
- **States:** No data/demo, partial metric failure, stale timestamp, manual refresh in progress, missing-cost warning, loading/error/success.
- **Acceptance:** Reference-screen evidence passes gate; fixture totals match backend; no color-only alert.
- **Common failures:** Decorative chart overload, unlabeled approximate profit, dashboard-calculated balances, toast-only alert, generic internal-manufacturing KPIs, crowded embedded review tables.
- **AI coding note:** Do not scale dashboard patterns until owner approval records final tokens/density.

### 6.2 Accountant Dashboard

- **Purpose:** Prioritize financial/operational completion and review work.
- **Target roles:** Accountant; Owner may access equivalent data if permitted.
- **UX mode:** Management Console.
- **Visible fields:** Pending approvals, missing-price receipts, unpaid supplier/factory payables, receivables, unsettled payments, production/direct-cost review, migration warnings, backup status.
- **Hidden fields:** User/permission management actions; provider secrets; worker-only irrelevant task clutter.
- **Allowed actions:** Open review queue/details, settle/post/review through contracted commands, filter by status/date/party.
- **Forbidden actions:** Grant permissions, directly edit entries/balances, bypass approval.
- **API dependencies:** Subledger/approval/direct-cost/migration/backup read DTOs and high-risk commands from API contract.
- **Validation:** Server-authoritative states and decimal values; stale row conflicts return actionable persistent messages.
- **RTL/LTR/redaction:** Arabic shell; numeric financial cells isolated LTR; only authorized financial fields.
- **Accessibility/responsive:** Accessible cards/table, tablet support, phone summary/approval where practical.
- **States/acceptance:** Queue empty/loading/partial/error/conflict/success; totals match fixtures and permissions.
- **Common failures:** Client-calculated balance, mixed review actions, dense unreadable phone table.
- **AI coding note:** Use the approved review-queue baseline after its reference gate.

## 7. Worker Operational Screens

### 7.1 Warehouse Screens

- **Purpose:** Record raw receipts, one-step transfer drafts, and physical customer-return receipts.
- **Target roles:** Warehouse; management may view/manage by permission.
- **UX mode:** Worker Task Mode for Warehouse; management details use Management Console patterns.
- **Visible fields:** Item/batch/message, supplier/customer name where task-required, quantity kg, bale count, source/destination/return location, date, returned classification facts, notes, simple transport amount/responsibility if known.
- **Hidden fields:** Prices, total cost, supplier/customer/factory balances, receivables/payables, settlement, profitability, actual payer/allocation.
- **Allowed actions:** Create/update own draft, save, submit, confirm assigned physical facts.
- **Forbidden actions:** Approve/post/reverse, target balance edits, negative override, financial treatment.
- **API dependencies:** Lower-risk draft/query services; adjustment/request flows; high-risk receipt/transfer/return approvals remain management commands.
- **Validation:** Required operational facts; decimal string quantity; valid tenant item/location; server stock/state checks.
- **RTL/LTR/redaction:** Arabic labels; batch/document/date/quantity isolated LTR; forbidden fields omitted from DTO and payload.
- **Worker simplification:** One task per screen, one-column narrow layout, clear draft/submission status, safe "other / not listed" note path for missing item/location/supplier/customer/factory options without creating official master data.
- **Accessibility/responsive:** 360px+, 44×44px controls, accessible comboboxes/date/error summary.
- **States:** Draft, submitted/read-only, correction requested, validation failure, conflict, network retry, success.
- **Acceptance:** Worker raw-receipt reference fields/actions match Design Contract; no financial data in network response.
- **Common failures:** Management grid reused, hidden price field submitted, direct posting, transfer represented as target balance.
- **AI coding note:** The raw-receipt visual is a mandatory reference baseline.

### 7.2 Production Employee Screens

- **Purpose:** Record production order/issue/receipt/waste/WIP-return operational facts.
- **Target roles:** Production; Warehouse may see assigned physical/location facts; management approves.
- **UX mode:** Worker Task Mode.
- **Visible fields:** Production type, factory, input lot/item, planned/issued/input/output/waste/returned quantities, output lot facts, dates, WIP status, operational notes.
- **Hidden fields:** Factory rate/payable, cost basis, direct-cost allocation, payer, account entry, profitability.
- **Allowed actions:** Create/update/submit own drafts; request return from WIP.
- **Forbidden actions:** Issue/receipt financial posting, approve WIP return, change snapshots/rates, close unexplained WIP.
- **API dependencies:** Draft services; `/production/orders/:orderId/return-from-wip-requests`; management high-risk issue/receipt/return approval endpoints.
- **Validation:** Positive decimal quantities, valid order/factory/lot/location; server validates stock/WIP/lineage.
- **RTL/LTR/redaction:** Codes/dates/quantities LTR-isolated; financial fields absent.
- **Worker simplification:** Guided sequence and reconciliation summary in quantities only; safe "other / not listed" note path for missing factory/input-lot/output-lot/detail options without creating official master data.
- **Accessibility/responsive/states:** 360px+, clear step/status, accessible quantity errors; partial-receipt and correction states explicit.
- **Acceptance:** Cannot post output/payable or receive financial fields; WIP facts reconcile visibly.
- **Common failures:** Factory stock confused with WIP, payable shown, output-only form hides consumed/waste.
- **AI coding note:** Never infer WIP from location or calculate payable in UI.

### 7.3 Quality Employee Screens

- **Purpose:** Record quality tests/status and complaint/return investigation facts.
- **Target roles:** Quality; management may review.
- **UX mode:** Worker Task Mode.
- **Visible fields:** Item/batch/lot/sale reference, test type/values/date, quality status, investigation notes, returned-stock observations.
- **Hidden fields:** Prices, discounts, credit/refund/replacement value, balances, costs, profitability, approval audit.
- **Allowed actions:** Create/update/submit own quality tests/investigation; comment on risk.
- **Forbidden actions:** Financial treatment, risky-sale approval, stock posting/reversal, returned-stock resale authorization.
- **API dependencies:** Quality/complaint draft/query services; approval handled by Owner/Accountant workflows.
- **Validation:** Parameter/value/date/reference validity; server owns status and disposition rules.
- **RTL/LTR/redaction:** Test codes/values/dates isolated LTR; Arabic explanations RTL.
- **Worker simplification:** Test-first forms; no accounting vocabulary; safe "other / not listed" note path for missing test type/reference/detail options without creating official master data.
- **Accessibility/responsive/states:** 360px+, accessible parameter groups and status text; empty/history/review states.
- **Acceptance:** Quality can record facts but cannot mutate financial/stock effects.
- **Common failures:** Quality status directly unblocks sale; financial return controls exposed.
- **AI coding note:** Do not invent labels for provisional quality terminology.

## 8. Management Workflow Screens

### 8.1 Approval Center — Accountant Review Queue Reference

- **Purpose:** One permission-filtered queue for high-risk decisions and incomplete financial-adjacent work.
- **Target roles:** Owner, Accountant.
- **UX mode:** Management Console.
- **Visible fields:** Tabs/counts for sales, daily operations, returns, adjustments, outsourced-production receipts, payment reversals, quality-risk sales, negative stock, corrections, migration; missing-price/cost/direct-cost/settlement warnings; permitted detail fields; review/audit log showing who entered the data, entry time, department, operation type, current status, and last review action where permitted.
- **Hidden fields:** Actions/financial fields beyond current permission; full audit payload unless audit permission.
- **Allowed actions:** Open detail drawer; approve/reject/request correction/cancel/retry only through dedicated commands with reason/idempotency.
- **Forbidden actions:** Generic `PATCH status`, batch approve without contract, approval from stale client calculations.
- **API dependencies:** High-Risk API commands and dedicated role-filtered queue queries.
- **Validation:** Required reason; stale state and idempotency conflict; technical versus business failure messages remain distinct.
- **RTL/LTR/redaction:** Arabic tabs/drawers; identifiers/numbers LTR-isolated; data/action filtering server-side.
- **Worker simplification:** Not exposed to workers.
- **Accessibility/responsive:** Keyboard table/drawer/tabs; persistent result; tablet; phone limited to practical approvals.
- **States:** Empty by category, loading, partial queue failure, stale decision, technical retry, business review, success.
- **Acceptance:** Demonstrates all required reference categories/patterns and passes owner visual approval.
- **Common failures:** Toast-only approval, indistinguishable actions, stale approval, UI-only permission.
- **AI coding note:** This reference screen fixes management table/filter/drawer density before expansion.

### 8.2 Inventory Screens

- **Purpose:** Management view of balances, locations/factories, movements, reservations, blocks/returns, alerts, adjustments, reversals, and reconciliation.
- **Target roles:** Owner, Accountant; workers receive only task-scoped quantity views.
- **UX mode:** Management Console; worker quantity lookup remains Worker Task Mode.
- **Visible fields:** Item/location quantities, on-hand/reserved/blocked/returned/available, movement source/date/type, reservation state, alerts, reconciliation differences; value only if separately authorized.
- **Hidden fields:** Unauthorized stock value/financial linkage; mutable target-balance control.
- **Allowed actions:** Filter/drill, request/approve adjustment/reversal by permission, reconcile/report.
- **Forbidden actions:** Direct balance edit, arbitrary negative toggle, movement deletion, generic “other” posting.
- **API dependencies:** Inventory read services; adjustment/reversal commands; domain correction links.
- **Validation:** Server-side filters/pagination; decimal-safe values; state/stock rechecked on command.
- **RTL/LTR/redaction:** Document/item codes and quantity cells LTR-isolated.
- **Accessibility/responsive/states:** Semantic table and summary-to-detail; horizontal scroll for dense table; mismatch/negative persistent alerts.
- **Acceptance:** Display dimensions reconcile to ledger fixture and restricted roles cannot obtain value.
- **Common failures:** Returned quantity added twice, balances edited, blocked/reserved semantics hidden.
- **AI coding note:** InventoryLedgerService remains the only posting owner.

### 8.3 Production/WIP Management Screens

- **Purpose:** Review/approve production issue, partial receipt, waste, WIP, rate snapshot, payable, lineage, and corrections.
- **Target roles:** Owner, Accountant; workers use §7.2.
- **UX mode:** Management Console.
- **Visible fields:** Operational allocations, WIP reconciliation, output/waste, confirmed rate and cost basis, posted payable, review/correction state.
- **Hidden fields:** Actions beyond permission; no editable approved snapshot.
- **Allowed actions:** Approve issue/receipt/WIP return, confirm rate, request correction/reverse through contracts.
- **Forbidden actions:** Payable at issue, output-based live cost, edit approved receipt, silent WIP close.
- **API dependencies:** Production issue/receipt/WIP-return commands and role-filtered reads.
- **Validation:** Server WIP/stock/allocation checks, decimal precision and posting rounding.
- **RTL/LTR/redaction:** Lot/order identifiers and numbers isolated LTR.
- **Accessibility/responsive/states:** Allocation table plus accessible summary; desktop/tablet, phone approval summary only.
- **Acceptance:** Fixtures show correct WIP, waste, output, input-based payable, and worker redaction.
- **Common failures:** Duplicate allocation/payable, rate default rewriting history.
- **AI coding note:** Do not flatten many-to-many schema to match the initial UI.

### 8.4 Sales Screens

- **Purpose:** Draft multi-line-capable sales, complete commercial data, submit/reserve, approve, reject/cancel, and inspect immutable results.
- **Target roles:** Owner/Accountant; Warehouse may create an enabled operational draft without price/submit.
- **UX mode:** Management Console; any Warehouse draft is a focused Worker Task screen.
- **Visible fields:** Customer, lines, item/location/quantity, authorized price/discount/net posted totals, reservation/quality/approval status, profitability summary only when permitted.
- **Hidden fields:** Commercial/financial data from Warehouse; internal calculations submitted as authority.
- **Allowed actions:** Draft, complete price, submit, approve, reject/cancel, correction/reversal by permission.
- **Forbidden actions:** Worker submit with price, client stock delta, status-only approval, direct edit after approval.
- **API dependencies:** Sales submit/approve/reject/cancel and correction commands; safe read DTOs.
- **Validation:** Decimal strings; proportional discount and deterministic residual displayed from server; stock/quality/reason checks server-side.
- **RTL/LTR/redaction:** Document codes, quantities, prices, money isolated LTR.
- **Accessibility/responsive/states:** Accessible line table/form, errors per line and summary; desktop/tablet; phone summary/approval only.
- **Acceptance:** Posted lines sum to total, role redaction passes, failures preserve/resolve reservations per reason.
- **Common failures:** JavaScript floating-point totals, premature rounding, price leak, stale approval.
- **AI coding note:** Display server-calculated results; never recreate posting authority in the client.

### 8.5 Payments and Accounts Screens

- **Purpose:** Manage party statements, payment drafts/posting, settlement, advance/partial payments, and reversal.
- **Target roles:** Owner, Accountant.
- **UX mode:** Management Console.
- **Visible fields:** Party/account/currency EGP, immutable signed entries, derived balance, payment direction/method/date/amount, settlement status, source/reversal links.
- **Hidden fields:** All workers; credentials; editable balance.
- **Allowed actions:** Post/settle/reverse according to permission and dedicated commands.
- **Forbidden actions:** Direct entry edit/delete, target-balance entry, over-settlement, financial action from worker UI.
- **API dependencies:** Payment/subledger services and reversal command.
- **Validation:** Decimal-safe EGP amount, sign/direction, same-account/currency settlement, state/idempotency.
- **RTL/LTR/redaction:** Account/document/date/money cells isolated LTR.
- **Accessibility/responsive/states:** Accessible statement table and entry detail; phone summary only.
- **Acceptance:** Fixture balances/signs match exactly and original entries remain visible after reversal.
- **Common failures:** Sign inferred from Arabic label, balance stored/edited, payment conflated with cost.
- **AI coding note:** Only SubledgerService posts entries.

### 8.6 Direct Cost Review

- **Purpose:** Separate responsibility, actual payer, party effect, profitability inclusion, allocation, and settlement.
- **Target roles:** Owner, Accountant; workers may supply simple amount/responsibility/notes only in their task.
- **UX mode:** Management Console.
- **Visible fields:** Linked operation, amount/currency, worker suggestion, confirmed responsibility/payer, allocations, review status, subledger/profitability effect.
- **Hidden fields:** Detailed treatment from workers.
- **Allowed actions:** Review, approve/reject, allocate, request correction, post contracted effect.
- **Forbidden actions:** Entry before required review, responsibility=payer assumption, forced cost blocking safe stock.
- **API dependencies:** Direct-cost review/query and Subledger/Profitability domain services.
- **Validation:** Shared allocation totals, required amount/reason, decimal precision, permitted party.
- **RTL/LTR/redaction:** Money/percent/identifiers isolated LTR.
- **Accessibility/responsive/states:** Accessible allocation rows and review drawer; desktop/tablet.
- **Acceptance:** Unknown/included-elsewhere behavior creates no unintended posting; worker response remains restricted.
- **Common failures:** Hidden financial control in worker payload, allocation mismatch.
- **AI coding note:** Do not invent profitability inclusion defaults.

### 8.7 Quality, Complaint, and Return Management

- **Purpose:** Review quality/complaints; approve return receipt, classification, financial treatment, replacement, and corrections.
- **Target roles:** Owner, Accountant; Quality contributes facts; Warehouse confirms physical receipt.
- **UX mode:** Management Console with linked worker tasks.
- **Visible fields:** Tests/investigation, sale/line, return quantity, remaining returnable quantity/value, classification, treatment, original approved net unit value, replacement links/difference, quality-risk status.
- **Hidden fields:** Financial values/treatment from workers and Quality.
- **Allowed actions:** Approve/reject return/treatment, disposition, linked replacement flow, correction/reversal.
- **Forbidden actions:** Return above cap, unlinked replacement difference, automatic refund, worker financial decision.
- **API dependencies:** Return approval, normal linked sales replacement approval, payment refund command, correction services.
- **Validation:** Source sale/line, prior returns, quantity/value cap, classification, treatment, links, stock/financial atomicity.
- **RTL/LTR/redaction:** Codes/dates/quantities/money isolated LTR.
- **Accessibility/responsive/states:** Timeline/detail and approval drawer; explicit blocked/review states; phone approval where practical.
- **Acceptance:** Equal/higher/lower replacement fixtures produce contracted account result; refund stays separate.
- **Common failures:** Returned stock instantly sellable, replacement manual stock adjustment, financial leak.
- **AI coding note:** Workers record facts only; do not merge the two replacement events.

## 9. Historical Migration Screens

- **Purpose:** Prepare, stage, validate, reconcile, review, dual-approve, commit, inspect locked history, and request correction.
- **Target roles:** Owner, Accountant; Quality only assigned quality mapping if explicitly permitted.
- **UX mode:** Management Console.
- **Visible fields:** Batch/file/template/mapping versions, source provenance, staging preview, formulas, validation severity, aliases, reconciliation totals/differences, warning acceptance, separate approvals, commit/lock state, correction links.
- **Hidden fields:** Workers; storage/database secrets; another tenant; unsupported direct operational target controls.
- **Allowed actions:** Create/upload/stage/validate/reconcile/review, approve by role, commit when eligible, reject/cancel before commit, request post-commit correction.
- **Forbidden actions:** AI/direct operational import, severity downgrade, one-person implicit dual approval, edit committed rows, partial commit button.
- **API dependencies:** Historical Migration Contract §11 and API commit command; private signed file access.
- **Validation:** Exact file/hash/version binding, blockers/warnings, alias/date/currency/duplicate/traceability checks; server pass status only.
- **RTL/LTR/redaction:** Source identifiers/formulas/codes/numbers isolated LTR; Arabic explanations RTL.
- **Worker simplification:** No worker navigation; assigned Quality mapping is narrowly filtered.
- **Accessibility/responsive:** Dense tables desktop/tablet; phone summary/approval only; accessible severity text and drill-through.
- **States:** Upload/processing/staged/validation/reconciliation/review/one approval/approved/committing/committed/rejected/cancelled/technical retry.
- **Acceptance:** Staging has no operational effects; required metadata visible; locked records cannot be edited; warnings persist.
- **Common failures:** Green summary hides mismatch, transformed rows sent in commit body, approval survives changed file.
- **AI coding note:** The current workbook is not the permanent schema.

## 10. Traceability and Reports

### 10.1 Traceability Screen

- **Purpose:** Resolve raw batch → movements → production/WIP → yarn lots → quality → sale → complaint/return/correction.
- **Target roles:** Owner/Accountant full permitted view; workers task-scoped operational lineage only.
- **UX mode:** Management Console; restricted worker detail where useful.
- **Visible fields:** Search by batch/single lot/twisted lot/sale/customer; event timeline, source/destination, quantities, links, statuses; payment summary only for authorized management.
- **Hidden fields:** Financial events/values from workers; unrelated tenant/party data.
- **Allowed actions:** Search/filter/open source records and corrections; no posting from timeline.
- **Forbidden actions:** Edit history, infer missing links silently, unrestricted global search.
- **API dependencies:** TraceabilityService permission-filtered graph/timeline query.
- **Validation:** Tenant/permission/filter constraints and cycle/broken-link indicators.
- **RTL/LTR/redaction:** Event text RTL; codes/dates/quantities/money isolated LTR.
- **Accessibility/responsive/states:** Timeline has semantic list/table alternative; desktop/tablet, phone summary; missing/broken chain explicit.
- **Acceptance:** Fixture chain reaches raw-to-return and preserves corrections; worker financial redaction passes.
- **Common failures:** N+1 unbounded query, financial summary leak, visually inferred direction only.
- **AI coding note:** Thin traceability may appear early; full screen waits for dependent domains.

### 10.2 Reports

- **Purpose:** Provide internal, permission-safe operational and approximate financial reports.
- **Target roles:** Owner/Accountant; workers only explicitly contracted operational views, no export.
- **UX mode:** Management Console.
- **Visible fields:** Purchases, sales, inventory, balances, WIP, waste, complaints/returns, approximate profitability/profile/missing flags, filters and generation timestamp.
- **Hidden fields:** Unauthorized rows/columns/aggregates and all worker financial exports.
- **Allowed actions:** Server-side filter/sort/page; authorized internal Excel/PDF export.
- **Forbidden actions:** Treat export as backup/legal invoice, browser-side security filtering, silently complete missing profitability.
- **API dependencies:** ReportService and authorized export jobs; role-filtered DTOs.
- **Validation:** Date/location/factory filters, report version, decimal totals, missing-data flags.
- **RTL/LTR/redaction:** Arabic headings; dates/numbers/currency/codes LTR-isolated.
- **Accessibility/responsive/states:** Accessible tables/chart summaries; controlled horizontal scroll; long-job status; empty/partial/error.
- **Acceptance:** Totals match fixtures/source ledgers; worker export blocked; export matches on-screen authorized scope.
- **Common failures:** Client aggregation, hidden columns in downloaded file, export called backup.
- **AI coding note:** Reports never mutate source records.

## 11. Operations and Administration

### 11.1 Backup / Restore Status

- **Purpose:** Show backup and restore-test evidence/limitations and trigger allowed administrative jobs.
- **Target roles:** Owner; Accountant only when granted.
- **UX mode:** Management Console.
- **Visible fields:** Environment, last backup/test state/time/operator/evidence/checksum reference, limitations, retention/RPO/RTO unresolved markers where relevant.
- **Hidden fields:** Credentials, storage secrets, raw database URLs, production restore controls.
- **Allowed actions:** View status; run manual backup if permitted; authorize/run non-production restore test by permission.
- **Forbidden actions:** Production restore from ordinary UI, claim export is backup, hide failed test.
- **API dependencies:** Backup/restore status actions in API Contract §21.
- **Validation:** Separate restore target, idempotency/job state, evidence required.
- **RTL/LTR/redaction:** Timestamps/checksums/IDs LTR-isolated.
- **Accessibility/responsive/states:** Persistent success/failure evidence; desktop/tablet/phone summary.
- **Acceptance:** No secrets; failed/missing restore evidence visible; free-tier not labeled production-ready.
- **Common failures:** “Backup configured” shown as “restore proven,” destructive production action exposed.
- **AI coding note:** Keep production tier, retention/RPO/RTO, and monitoring unresolved markers.

### 11.2 Settings and User Management

- **Purpose:** Manage allowed users/permissions and safe/restricted settings without a product rule engine.
- **Target roles:** Owner manages; Accountant has limited view/request only; workers none.
- **UX mode:** Management Console.
- **Visible fields:** Active users, seeded roles, exact effective permissions by screen/action/role, user status, last activity where permitted, terminology, safe settings, restricted setup values/read-only metadata, and permission/audit logs as permitted.
- **Hidden fields:** Secrets, deferred productization controls, unrestricted formula/status/workflow editors.
- **Allowed actions:** Owner-controlled provisioning/activation/role assignment only when the current work package explicitly includes it; otherwise show permissions as read-only/deferred setup. Approved terminology/settings changes require reason/audit.
- **Forbidden actions:** Accountant self-grant, public signup, hard delete referenced users/data, alter approved snapshot history.
- **API dependencies:** Auth/user/permission/settings services; exact login/recovery controls remain unresolved.
- **Validation:** Stable permission keys, tenant scope, effective settings, reason and audit; future-only effect.
- **RTL/LTR/redaction:** Emails/phones/codes/technical keys isolated LTR.
- **Accessibility/responsive/states:** Accessible permission tables/forms; desktop/tablet; phone read summary only.
- **Acceptance:** Users and exact effective permissions are visible to authorized Owner/Admin view; only Owner changes roles where explicitly contracted; read-only/deferred permission editing is clearly labeled; approved history unaffected; deferred settings absent.
- **Common failures:** Generic Admin role, wildcard worker permission, secrets displayed, settings mutate history.
- **AI coding note:** Do not resolve sign-in/recovery or deferred productization by preference.

## 12. Cross-Screen Acceptance

No frontend screen is accepted until:

- backend role/action/field permission tests pass;
- Arabic RTL and mixed-direction values pass explicit QA;
- loading/empty/error/success/conflict/denied states are persistent and accessible;
- keyboard/focus/labels/contrast/reduced-motion/200% zoom checks pass;
- required responsive states pass;
- critical state is not color- or toast-only;
- no worker request/response contains forbidden financial data;
- worker "other / not listed" entries route to review and do not create official master data automatically;
- dashboard KPI cards navigate only to authorized detail screens/filters and do not perform operations;
- Management Console sidebar has whole-sidebar collapse plus independent category collapse;
- quick search, notifications, and manual refresh are permission-filtered and do not expose unauthorized details;
- generic internal-manufacturing KPIs are absent from dashboards and reports unless explicitly owner-approved in a later contract;
- high-risk commands use dedicated API/service contracts and idempotency;
- reference-screen approval exists before broad expansion.

## 13. Notes for AI Coding Agents

List the screen and domain contracts read before implementation. Build only screens authorized by the current work package. Do not invent read/write APIs, Arabic labels, auth behavior, business states, calculations, colors, or permissions. Do not reuse management density in Worker Task Mode. Do not calculate business money with JavaScript floating point. Do not submit server-derived effects from forms. Do not hide forbidden data after fetching it. If a required field/action/state lacks a binding rule, write **Unresolved / requires owner decision** and stop that path.

For UI files, follow the code-style and maintainability rules in `14_coding_agent_instructions.md`: usually one main exported UI component per component file; large, reusable, or stateful components get their own files; tiny private subcomponents may remain local when only used there; preserve existing component/test style; do not refactor unrelated UI files or split components into meaningless fragments merely to reduce line count.
