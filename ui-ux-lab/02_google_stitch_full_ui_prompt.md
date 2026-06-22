# Google Stitch Prompt — Complete Static ERP UI

Use this only after one visual direction has been approved. Replace the selected-direction block before pasting it into [Google Stitch](https://stitch.withgoogle.com), and attach the three approved reference screenshots if available.

---

Create one new web-design project named **ERP Yarn — Complete Static UI**.

## Atomic all-screens requirement

Generate **every screen listed below in this same uninterrupted run and the same project**. Do not ask questions, pause after a subset, suggest a later continuation, or claim completion while an ID is missing.

Stitch may generate screens sequentially. For each ID, create a separate new screen/artboard using a new-screen generation operation.

If this prompt is being executed through Stitch MCP/SDK, create one project and call the new-screen generation operation once per manifest ID. Never call the existing-screen edit operation. If direct Stitch chat cannot complete 46 generations in one run, report the platform limit and missing IDs honestly; do not silently combine screens or pretend the set is complete.

### Absolute preservation constraint

Once you generate a screen, it becomes immutable. While generating later screens:

- do not edit it;
- do not regenerate it;
- do not restyle it;
- do not rename it;
- do not change its text, components, layout, palette, or data;
- do not apply any project-wide operation that alters existing screens.

If a correction is unavoidable, preserve the original and generate a new screen with an `-R2` suffix. Never overwrite an original. End with a complete manifest of originals and replacements.

## Selected direction — replace before use

`[PASTE THE APPROVED DIRECTION, EXACT PALETTE TOKENS, TYPOGRAPHY, SPACING, RADII, BORDERS, SHADOWS, DENSITY, NAVIGATION ANATOMY, AND REFERENCE-SCREEN NOTES HERE]`

Use the attached approved reference screens as immutable style references. Copy their visual language; do not edit them.

## Product and scope

Design a high-fidelity Arabic-first UI for a specialized yarn-trading and outsourced-manufacturing ERP. The system presents raw-material batches, external factories as inventory locations, single-yarn and twisted-yarn production, WIP, sales approvals, balances, quality, complaints, returns, historical migration, traceability, reports, and administration.

This is visual design only:

- static synthetic data;
- no server, database, API, authentication implementation, business logic, or calculations;
- no real operational actions;
- no real customer or company data;
- navigation relationships may be illustrated, but controls are visual only;
- do not invent business modules, rules, metrics, fields, or permissions.

## Global anatomy and UX rules

- Arabic-first RTL.
- Western numerals.
- Display dates as `DD/MM/YYYY`.
- Isolate codes, lot/batch IDs, emails, phones, URLs, dates, quantities, money, numeric table cells, and technical identifiers as LTR content inside RTL layouts.
- Use fictional Arabic names and realistic-looking synthetic codes.
- Show `نموذج واجهة فقط — بيانات تجريبية غير حقيقية` in every shell.
- Use one consistent professional SVG icon family; no emoji icons.
- Preserve the approved tokens and components across all screens.
- Worker screens: task-first, minimal fields, plain Arabic, 44 px minimum targets, 390 px primary viewport, no financial information.
- Management screens: desktop-first 1440 px primary viewport, tablet-aware, coherent RTL sidebar and header.
- Owner: clear decisions, alerts, stock, balances, traceability, and approximate profitability.
- Accountant: dense but readable queues, filters, balances, payments, cost review, and warnings.
- Design visible empty, loading, warning, error, denied, read-only, and success examples where relevant, but keep them static.
- Historical imported records are visibly locked/read-only.
- Approximate profitability is labeled `ربحية تقريبية`.
- Backup presentation must not imply that an export is a backup or that restore has been proven.

## Screen generation order and IDs

### Access and shells

1. `AUTH-01-LOGIN` — private Arabic login shell; no public signup or role selector.
2. `AUTH-02-RECOVERY` — neutral recovery marker with generic confirmation.
3. `SHELL-01-WORKER-HOME` — large role-specific task cards and recent task status; no module tree.
4. `SHELL-02-MANAGEMENT-CONSOLE` — owner/accountant RTL navigation shell and authorized destinations.
5. `SHELL-03-ALL-SCREENS-INDEX` — design-review index linking every screen ID.

### Dashboards

6. `DASH-01-OWNER` — stock, external-factory stock, approvals, balances, complaints, quality risk, approximate profitability, migration/backup status, recent events.
7. `DASH-02-ACCOUNTANT` — approvals, missing prices, payables/receivables, unsettled payments, production/direct-cost review, migration warnings, backup status.

### Warehouse worker

8. `WH-01-RAW-RECEIPT` — focused raw-material receipt form.
9. `WH-02-STOCK-TRANSFER` — source, destination/external factory, batch, quantity, date, notes.
10. `WH-03-CUSTOMER-RETURN-RECEIPT` — physical return facts and classification observations without financial treatment.
11. `WH-04-RECENT-ACTIVITY` — the worker's drafts, submitted tasks, corrections, and statuses.

### Production worker

12. `PROD-01-TASK-HOME` — production task cards and quantity-only status.
13. `PROD-02-MATERIAL-ISSUE` — order, factory, input lot, issued quantity, date, notes.
14. `PROD-03-SINGLE-YARN-RECEIPT` — output lot, input/output/waste/returned quantities and date.
15. `PROD-04-TWISTED-YARN-RECEIPT` — multiple input lots, twisted output lot, quantities, waste, returned material.
16. `PROD-05-WIP-RETURN` — residual input/WIP return request and quantity reconciliation.
17. `PROD-06-RECENT-ACTIVITY` — drafts, partial receipts, submitted work, requested corrections.

### Quality worker

18. `QUAL-01-TEST-ENTRY` — reference, test type, parameter values, date, status, notes.
19. `QUAL-02-HOLD-RELEASE-FACTS` — quality facts and risk comments; no financial or sales-approval action.
20. `QUAL-03-COMPLAINT-INVESTIGATION` — complaint/return observations and linked lot/sale references.

### Management approvals and inventory

21. `APPR-01-REVIEW-QUEUE` — category tabs, counts, filters, table, persistent detail drawer, static approve/reject/correction controls.
22. `INV-01-BALANCES` — on-hand, reserved, blocked, returned, available by item/location/factory.
23. `INV-02-MOVEMENTS-AND-RESERVATIONS` — movement history and reservation states with filters.
24. `INV-03-DETAIL-AND-RECONCILIATION` — item/location detail, alerts, mismatch and correction links; no direct balance editing.

### Production and WIP management

25. `WIP-01-OVERVIEW` — production orders, issue/receipt progress, WIP, waste, exceptions.
26. `WIP-02-ORDER-DETAIL` — input allocations, lineage, partial outputs, waste, returned quantities, timeline.
27. `WIP-03-MANAGEMENT-REVIEW` — rate/cost/payable presentation for management, warnings, static review controls.

### Sales

28. `SALES-01-LIST` — filters, status, customer, totals, reservation/quality/approval state.
29. `SALES-02-DRAFT` — customer and multi-line sale form, price/discount presentation for authorized management.
30. `SALES-03-DETAIL-AND-APPROVAL` — immutable approved results, reservation, quality, approval timeline, approximate profitability summary when permitted.

### Payments, accounts, and direct costs

31. `PAY-01-PAYMENTS` — payment list and static payment-entry drawer.
32. `PAY-02-PARTY-STATEMENT` — customer/supplier/factory signed entries, derived balance presentation, source/reversal links.
33. `COST-01-DIRECT-COST-REVIEW` — operation, amount, responsibility, actual payer, allocation, settlement and review status.

### Quality, complaints, and returns management

34. `QRM-01-QUALITY-AND-COMPLAINTS` — review list, investigation summary, quality risks, linked records.
35. `QRM-02-RETURN-TREATMENT` — quantity/value cap presentation, classification, treatment, original value, static review controls.
36. `QRM-03-REPLACEMENT-FLOW` — original return, replacement sale, value difference, linked events and timeline.

### Historical migration

37. `MIG-01-BATCHES` — upload/batch list, template/version/provenance, status and warnings.
38. `MIG-02-STAGING-AND-MAPPING` — source preview, mappings, aliases and formulas; explicitly staging-only.
39. `MIG-03-VALIDATION-RECONCILIATION` — blockers, warnings, totals, differences and drill-down.
40. `MIG-04-APPROVAL-AND-LOCK` — separate approvals, commit eligibility/status, locked historical records and correction links.

### Traceability and reports

41. `TRACE-01-END-TO-END` — search plus raw batch → movements → WIP → output lot → quality → sale → complaint/return/correction timeline.
42. `REPORT-01-HUB` — report categories, filters, recent reports and permission-aware presentation.
43. `REPORT-02-RESULT` — accessible chart summary and detailed table with generated-at time and missing-data flags.

### Operations and administration

44. `OPS-01-BACKUP-RESTORE-STATUS` — environment, backup evidence, restore-test status, limitations, timestamps/checksum references; no destructive production action.
45. `ADMIN-01-USERS-AND-ROLES` — users, seeded roles, status, provisioning and role presentation for Owner.
46. `ADMIN-02-SETTINGS` — terminology and safe settings; no secrets or unrestricted rule/formula builder.

## Consistency controls

Before generating screen 1, establish an internal immutable reference for:

- color tokens;
- type scale;
- spacing scale;
- radii, borders, shadows;
- sidebar/header dimensions;
- worker and management form anatomy;
- table density;
- card, drawer, dialog, tab, filter, alert, status, timeline, chart, empty, and loading patterns.

Use that reference for new screens without modifying old screens. Do not drift into different palettes, icon styles, radii, or navigation systems.

## Final verification and output

After screen 46:

1. Produce a manifest listing all 46 IDs in order.
2. Mark each as `generated`, `replacement generated`, or `missing`.
3. List every replacement ID while preserving its original.
4. Report visual consistency issues without editing existing screens.
5. Report any platform limit honestly.
6. Do not claim completion unless all 46 original IDs exist.

Do not perform a final global cleanup, restyle, synchronization, or update operation. Such an operation could change original screens and is forbidden.

---
