# Decision Log and Scope

## Status and Interpretation Rule

This document is the highest-authority repository consolidation of explicit owner decisions and scope boundaries. It integrates `Answers to your questions.txt`, the accepted Run 2.1 backend decisions, and later accepted owner decisions. Approved domain contracts are next in authority; Final Implementation Plan v4 applies only where neither this log nor an approved contract supersedes it. The full canonical hierarchy is in `docs/00_project_context.md`.

No coding agent may resolve an ambiguity by convention or preference. The required marker is:

> Unresolved / requires owner decision

Execution documents may narrow order/scope but cannot alter decisions in this log or approved contracts.

## Binding Decisions

| ID | Binding decision | Consequence |
| --- | --- | --- |
| DEC-001 | The MVP is a single-client ERP implementation with future-ready architecture. | Do not build a fully configurable ERP product, SaaS control plane, plugin system, or general rule engine in MVP. |
| DEC-002 | Deployment is cloud-first. | Local/offline deployment is outside MVP. |
| DEC-003 | Free-tier or low-cost hosting is for development, demo, validation, and limited pilot only. | It must not be represented as production-ready; production requires an upgrade and operational safeguards. |
| DEC-004 | Use a modular monolith. | Do not split MVP into microservices. |
| DEC-005 | Use PostgreSQL or a PostgreSQL-compatible managed relational database. | Transactions, constraints, locking, migrations, and restore procedures are required capabilities. |
| DEC-006 | Include a tenant foundation even with one active tenant. | Every tenant-owned table and query must preserve tenant isolation. |
| DEC-007 | External factories are service providers and inventory locations. | Each factory must have a linked location and factory-held company stock must remain visible. |
| DEC-008 | Traceability is a core architecture principle. | Raw batch, yarn lots, movements, production, sales, customer, quality, complaints, returns, and financial impact must be linkable. |
| DEC-009 | Posted stock movements are immutable; materialized balances are transactional derivatives. | Never repair posted inventory through silent row edits. Negative inventory is a visible controlled alert, not a normal mode or hidden auto-fix. |
| DEC-010 | Submitted sales reserve stock; drafts do not. | Reservation reduces available-to-sell but not on-hand. Sale approval atomically consumes reservation and posts the issue. |
| DEC-011 | Production uses an explicit WIP model. | Factory on-hand, WIP, output, waste, and unprocessed remainder must not be double-counted. |
| DEC-012 | The production schema must be many-to-many capable. | The simple MVP UI must not force one input foreign key on the production-order header as the only lineage. |
| DEC-013 | Live factory cost for the current client is input-based, and the payable is recognized on approved production output receipt. | For each full or partial approved receipt, use the confirmed consumed input quantity linked to that receipt; waste does not reduce factory payable. |
| DEC-014 | Rates and rule values used by approved transactions are snapshotted. | Later defaults or settings changes must not silently rewrite approved history. |
| DEC-015 | High-risk approvals are atomic business transactions. | Permission, state, validation, locks, posting, approval, and audit must commit or roll back together; idempotency is required. |
| DEC-016 | Customer, supplier, and factory balances use an immutable operational subledger. | This is not a full accounting ledger. Posted entries are reversed, not edited. |
| DEC-017 | Cost responsibility and actual payment are separate. | Worker data entry must not collapse responsibility, payer, payable/receivable, settlement, and profitability treatment into one field. |
| DEC-018 | Direct cost and transport are optional in MVP. | Unknown transport must not block a safe stock operation; unresolved financial handling goes to Accountant Review. |
| DEC-019 | MVP profitability is approximate, deterministic, and versioned. | Profitability uses net revenue. Snapshots are immutable; recalculation creates a new version and preserves prior versions. |
| DEC-020 | Historical migration uses normalized target templates and mandatory staging. | Initial target is 2025 and 2026 where available. Commit requires both Owner and Accountant approval. |
| DEC-021 | AI cannot approve historical truth or write migration output directly to operational tables. | AI uncertainty must be exposed for human review; missing facts or relationships must not be invented. |
| DEC-022 | Historical records are approved at import-batch level and locked after commit. | Do not route each imported record through daily approval and do not allow direct form or database edits afterward. |
| DEC-023 | Imported Historical Cost Preservation is mandatory. | Preserve imported historical factory costs as-is, calculate comparison values, flag differences, and prevent this from becoming a live override feature. |
| DEC-024 | Audit logs are append-only and transaction-coupled. | Application users cannot update/delete audit; failure to write required audit fails the business transaction. |
| DEC-025 | Manual backup and a documented restore test are required before pilot or real data entry. | Backup design alone is insufficient. Files/import evidence must be included or limitations documented. |
| DEC-026 | Exports are not backups. | Excel/PDF output cannot satisfy database or file recovery requirements. |
| DEC-027 | Worker UX is operational, Arabic-first, and financially restricted. | Warehouse, production, and quality roles must not see financial/accounting complexity. |
| DEC-028 | Posted and approved records are corrected, reversed, or adjusted—not silently edited or hard-deleted. | The original record and audit trail remain visible. |
| DEC-029 | Rollout is demo, limited pilot, parallel Excel run, reconciliation, training, then approved go-live. | The ERP is not an immediate full Excel replacement. |
| DEC-030 | MVP transfers are one-step. | Source decreases and destination increases in one posting; `in_transit` remains schema-ready but has no MVP workflow. |
| DEC-031 | Reservations have no automatic expiry in MVP. | They remain active until approval consumption, explicit audited rejection/cancellation/manual release, or a contracted corrupted-reservation failure resolution. |
| DEC-032 | Only Owner manages users and permissions in MVP. | Accountant may view or request changes but cannot create privileged users, change roles, grant permissions, or modify security settings. |
| DEC-033 | MVP exports are internal reports only. | They are not backups, legal documents, official invoices, or externally issued compliance artifacts. |
| DEC-034 | Referenced master data is never hard-deleted. | Use inactive status; preserve old-document display and prevent inactive values from new selection. |
| DEC-035 | Sales schema and API are multi-line capable from the beginning. | The initial UI may limit entry to one line if needed, but persistence and backend contracts must not block multiple lines. |
| DEC-036 | The online MVP stack is Next.js 16.2.9/React 19/TypeScript on Node.js 24 LTS, hosted on Vercel with Supabase PostgreSQL, Auth, and Storage. | Exact transitive/package versions are lockfile-pinned; free-tier use remains demo/controlled-pilot only. |
| DEC-037 | Server-side database access uses Drizzle ORM, Drizzle Kit migrations, and `postgres.js` through Supabase transaction pooling with prepared statements disabled. | High-risk ERP posting is never performed by direct browser mutation. |
| DEC-038 | High-risk Next.js handlers use the Node.js runtime and controlled PostgreSQL transactions. | Edge runtime and application-request-triggered migrations are not approved posting/deployment paths. |
| DEC-039 | The MVP uses a light-only Calm Enterprise design system built from shadcn/ui, Radix, Tailwind CSS v4, React Hook Form/Zod, stable TanStack Table, Recharts, and Lucide. | Dark mode and end-user theme editing are deferred; components use centralized semantic tokens. |
| DEC-040 | The application root is Arabic RTL and mixed-direction dynamic values are isolated locally as LTR. | Use `<html lang="ar" dir="rtl">`; do not use `dir="auto"` for critical Arabic sentences. |
| DEC-041 | Current-client display uses Western numerals, `DD/MM/YYYY`, and tenant timezone `Africa/Cairo`. | Database/API dates remain ISO-compatible; date-only values cannot shift through timezone conversion. |
| DEC-042 | Numeric storage precision and decimal arithmetic are fixed for the schema contract. | Quantities use `DECIMAL(18,3)`; posted money and factory rates use `DECIMAL(18,2)`; calculated unit cost uses `DECIMAL(18,6)`; persisted precise monetary allocations use `DECIMAL(24,8)`; ratios retain at least 12 decimal places. Floating-point arithmetic is prohibited for business calculations. |
| DEC-043 | UX has Worker Task Mode and a shared Owner/Accountant Management Console. | Worker flows are task-first and finance-free; management differences come from permissions, data, widgets, and actions. |
| DEC-044 | The MVP targets WCAG 2.2 AA. | Worker targets are at least 44×44px; keyboard focus, contrast, reduced motion, labels, and 200% zoom are acceptance requirements. |
| DEC-045 | Broad frontend implementation is gated by three owner-approved reference screens. | Approve Worker raw receipt, Accountant review queue, and Owner dashboard before replicating visual patterns across modules. |
| DEC-046 | The current-client currency is EGP, displayed in Arabic as `جنيه`. | Store ISO `currency_code = EGP` on financial records where relevant; multi-currency conversion remains outside MVP. |
| DEC-047 | Official posted monetary values use `ROUND_HALF_UP`, applied only when the value becomes an official posting. | Cost, discount, unit-cost, profitability, ratio, and allocation calculations retain high precision and are not rounded early. |
| DEC-048 | Multi-line financial documents use stored posted lines as the official total and a deterministic discount residual rule. | The official total is the sum of posted net lines; discount residual goes to the largest gross line, then the lowest stable line number on a tie, and is stored as `rounding_adjustment`. |
| DEC-049 | Order-level discounts are allocated proportionally by line gross revenue. | Persist precise and posted allocations; posted line discounts must sum to the order discount, and profitability uses net revenue after allocated discount. |
| DEC-050 | A replacement return is two linked events: approved return receipt and approved replacement issue/sale. | Return credit uses the original approved sale-line net unit value after discount; replacement receivable uses the replacement order's approved net value; refund is a separate explicit payment action. |
| DEC-051 | Approval failures are classified as technical/system or business-precondition failures. | Technical failures roll back without business-state or reservation change. Sales business failures use reason-specific review/failure resolution; `approval_failed` is not a universal workflow status. |
| DEC-052 | Reservation release after failed sales approval is explicit, audited, and reason-dependent. | There is no general auto-release rule: corruption reconciles and alerts; stock/quality/commercial issues retain reservation for review; rejection/cancellation releases explicitly. |
| DEC-053 | The current-client Supabase project region is Europe; use the Europe general region, or Central EU (Frankfurt) when a specific region is required. | Record the actual provider-assigned region and verify Egyptian-user latency before creating the long-lived pilot project. A later region change requires a new project/data migration and does not resolve production tier or compliance decisions. |
| DEC-054 | Every implementation phase uses its own Git branch and reaches `main` only through a test-gated pull request. | Work packages remain one-at-a-time commits on the active phase branch. GLM must not push directly to `main`; failed, skipped, or incomplete required checks block merge. Owner authorization is required for the merge. |
| DEC-055 | GLM validates Supabase behavior against a disposable local stack or a separately authorized development/test project before online-demo promotion. | Vercel previews use development/preview credentials and synthetic data only. They must never receive online-demo, pilot, or production database/service credentials. |
| DEC-056 | A dedicated hosted Supabase development/test project now exists because Docker is unavailable in the GLM sandbox. | It is isolated, resettable, synthetic-data-only, and accessed through secret-manager variables. It is not pilot/production and its existence does not expand WP-00-02 or authorize remote connectivity, migrations, schema work, or data mutation outside the proper later package. |
| DEC-057 | Supabase uses the new publishable/secret API key model and standardized environment names. | Use `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `DATABASE_URL`, and `SUPABASE_PROJECT_REF`. Project ref is non-secret metadata; keys, database URL, and database password are secret. Do not introduce legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` or `SUPABASE_SERVICE_ROLE_KEY` without an explicitly approved compatibility requirement. |
| DEC-058 | Testing follows three mandatory layers: focused tests continuously during implementation, the complete package gate after every work package, and integrated phase tests before merge. | A later test layer never replaces an earlier one. Any required failure stops the affected implementation/package/phase; no next package or `main` merge is authorized until its controlling gate passes. |
| DEC-059 | A GLM sandbox without an owner-controlled secret channel may use either credentialless artifact handoff or the owner-authorized temporary credential exception in DEC-060. | Credentialless Git bundle/patch handoff remains the safest fallback. It is no longer mandatory when the owner explicitly authorizes a short-lived, scoped credential in the active chat for a specific development/test operation. |
| DEC-060 | Owner-authorized temporary chat credentials are permitted only for development/test automation when no secret-manager channel is available. | Allowed credentials must be short-lived, scope-limited, and used only for the explicitly authorized operation: GitHub phase-branch push/PR, Supabase development/test connectivity or package-authorized integration work, or Vercel preview/demo setup/deploy. They must never be written to tracked/untracked files, remotes, `.env`, screenshots, test evidence, logs, or completion reports; never used for pilot/production or real client data; and should be revoked/rotated by the owner after use. |

## Integrated Design-System Decisions

- Light theme only in MVP; dark mode deferred.
- Calm Enterprise visual direction: professional, calm, trustworthy, structured, clear, and restrained.
- Tajawal is the body/table/form/worker font; Alexandria is the heading/sidebar/dashboard/button font; Noto Sans Arabic is fallback.
- Theme values are centralized semantic CSS variables mapped to Tailwind semantic utilities; components do not hardcode literal palette colors.
- Initial palette values remain provisional until the reference-screen approval gate.
- Worker Task Mode supports 360px and above.
- Management Console is desktop-first and tablet-supported; phone supports summaries/approvals where practical.
- Date display is `DD/MM/YYYY`; internal date/timestamp values remain ISO-compatible.
- Current-client default timezone is `Africa/Cairo`, controlled at tenant level.
- Western numerals are used throughout the Arabic UI.
- Document codes, batch/lot codes, emails, phones, URLs, dates, quantities, money, numeric cells, and technical identifiers use isolated local LTR direction.
- Arabic critical messages remain RTL; only embedded English/code/value segments are isolated.
- Accessibility target is WCAG 2.2 AA, including 44×44px worker targets, keyboard focus, contrast, reduced motion, labels, and 200% zoom.
- Worker raw receipt, Accountant review queue, and Owner dashboard must be approved before frontend patterns scale.

## Integrated Owner Clarifications

### Transfers and Reservations

- MVP transfer posting is one-step: decrease source and increase destination atomically.
- Keep `in_transit` as a future-capable location type, with no dispatch/receive workflow in MVP.
- Do not implement automatic reservation expiry or a release scheduler.
- Successful sale approval consumes the reservation. Rejection, cancellation, or an authorized manual/failure-resolution action may release it explicitly and with audit.
- `expires_at` may remain nullable for future use but has no automatic MVP behavior.
- A technical/system approval failure leaves the sale and reservation unchanged.
- A missing/corrupted reservation is marked failed through a separate audited resolution transaction; reserved quantity is reconciled, a critical alert is created, and no silent release is allowed.
- Stock shortfall, quality block, or late-discovered commercial data retains the reservation for review unless a later authorized decision explicitly releases it.

### Production Receipt and Factory Payable

Factory payable is created only when an output receipt is approved. Sending or issuing material to production does not itself create the payable. A partial receipt creates payable only for the approved consumed input quantity associated with that receipt.

Required production snapshot values include:

```text
payable_trigger_used = production_receipt_approval
factory_cost_basis_used = input_quantity
factory_rate_per_ton_used
calculation_version
confirmed_by
confirmed_at
```

Future trigger changes apply only to new transactions after controlled setup change; prior approved transactions are not recalculated.

Unprocessed material leaving WIP must use `movement_type = return_from_wip`. Approval decreases WIP, increases on-hand at the selected return location, updates the production order, and writes audit. Production or Warehouse workers may prepare the operational request as applicable, but Owner/Accountant approval is required and financial effects go to Accountant Review.

### Raw Receipts Without Price

Physical receipt is allowed without purchase price. Warehouse records the batch, supplier, location, quantity, and date; stock posts because the material exists. No supplier payable is created until Accountant/Owner confirms the price. The financial completion remains in Accountant Review.

### Sales Structure, Revenue, and Profitability

- Use `sales_orders` and `sales_order_lines`; schema and API are multi-line capable from the start.
- MVP UI may temporarily support one line per sale.
- Store line gross revenue, precise and posted discount allocation, precise and posted net revenue, order discount total, line rounding adjustment, and posted document total separately.
- Allocate an order-level discount proportionally by each line's gross revenue. If total gross revenue is zero, the order discount must also be zero.
- Posted line discounts use `ROUND_HALF_UP` to two decimal places. Any residual needed to match the order discount is assigned to the largest gross-revenue line; ties use the lowest stable line number.
- `sum(line_allocated_discount_posted) = order_discount_total` and `document_total_posted = sum(line_net_revenue_posted)`.
- `order_discount_total` must be between zero and total gross revenue, inclusive.
- Profitability uses net revenue and must not subtract the same discount a second time.
- Profitability snapshots are immutable and versioned.
- Sale approval creates version 1; a return, correction, or reviewed cost update creates the next version.
- Reports use the latest active version; older versions are retained as superseded audit history.

### Arabic Terminology

Business logic uses stable internal keys. UI labels come from a terminology layer with `approved_terms` and `provisional_terms`; provisional labels remain replaceable and must not be hardcoded.

Initial approved/probable mappings are:

```text
raw_batch = رسالة خام
single_yarn_lot = لوط فرد
twisted_yarn_lot = لوط زوى
single_yarn_factory = مصنع الفرد
twisting_factory = مصنع الزوى
inventory_movements = حركة مخازن
```

Backend work must not be blocked by provisional wording, but GLM must not invent Arabic labels.

### Quality and Returned Stock

MVP quality statuses are:

```text
accepted
needs_review
blocked
```

`accepted` permits normal sale. `needs_review` requires Owner/Accountant approval. `blocked` prohibits sale unless Owner/Accountant explicitly approves a special quality-risk sale with reason and audit. Quality workers record operational facts only.

MVP return financial treatments are:

```text
no_financial_impact
customer_credit
refund_due
replacement
```

Return stock classifications are:

```text
return_received
needs_quality_review
sellable_as_is
sellable_with_discount
blocked
reprocess_required
```

Only `sellable_as_is` is normally available for sale. `sellable_with_discount` requires Owner/Accountant approval. `needs_quality_review`, `blocked`, and `reprocess_required` are unavailable until an approved disposition changes the classification. Workers record receipt/quality facts; Accountant/Owner decides financial treatment and risky resale.

For `replacement`, the approved return receipt and approved replacement issue/sale are separate linked events. Return credit is the returned quantity multiplied by the original approved sale line's net unit value after allocated discount, capped by the remaining original line value after prior returns. The replacement sale uses normal reservation and approval and creates a receivable for its approved net value. Equal values leave no net new receivable; a higher replacement leaves the difference owed; a lower replacement leaves customer credit. Refund is a separate Owner/Accountant-approved payment against that credit. Required links include original sale, original sale line, return request, and replacement order/issue. Workers record facts only.

### Transport

Transport remains optional. Worker input is limited to amount if known, simple responsibility, and notes. Actual payer, receivable/payable impact, settlement, profitability inclusion, allocation, correction, and reversal remain Accountant/Owner responsibilities. Incomplete transport information does not block a safe operational record and is routed to Accountant Review.

### Historical Migration Scope and Approval

- Initial target period is 2025 and 2026 where data is available.
- Both Owner and Accountant must approve commit.
- They must provide or approve reconciliation totals before commit.
- Reconciliation includes raw, single-yarn, and twisted-yarn balances; stock by location and at factories; customer, supplier, and factory balances; sales, payments, and production totals; and known negative-stock or mismatch warnings.
- Committed records use `approval_status = approved`; do not add `approved_after_import_review`.
- Historical context is represented by `record_period = historical`, the applicable imported `record_origin`, `is_locked = true`, and required `import_batch_id`.

### Negative Stock

Do not implement or expose a general `allowed_negative_flag` or “allow negative stock” UI toggle.

Negative inventory may appear only as a visible, controlled data-integrity condition. It must appear in dashboard, approval, and reconciliation alerts; it must not be silently fixed or normalized. Worker operations that would produce potential negative stock remain draft/pending/needs-review. Sales approval fails on insufficient stock unless an explicit Owner/Accountant override is allowed by the approved transaction contract, with reason and audit. Historical negative-stock warnings require explicit dual migration approval. `reserved_qty_kg` must never be negative, and WIP may become negative only through an explicit approved correction.

Negative signed customer/supplier/factory balances are valid subledger states and are not inventory errors.

### Approval Failure

`posting` means an official durable inventory, production, reservation, subledger, payment, payable/receivable, or profitability effect. Audit logs, validation-failure logs, and failure-status updates are official audited records but are not sale/stock/account postings.

A technical/system failure rolls back the whole approval transaction. It creates no business posting, consumes or releases no reservation, and does not change the sale to `approval_failed`. The sale remains retryable in its prior business state. The Arabic user message is: `لم يتم تسجيل العملية بسبب خطأ في النظام. برجاء المحاولة مرة أخرى.`

A business-precondition failure creates no sale-approval posting. A separate audited resolution transaction may place a sale in `approval_failed` or `needs_review` and handle its reservation according to the documented reason mapping. Human rejection remains distinct and explicitly releases reservations. Other workflows retain their contracted pending/review/correction status unless their own contract explicitly defines a failure status; coding agents must not add `approval_failed` globally.

### Master Data Lifecycle

Referenced suppliers, customers, factories, locations, fiber/product types, and quality parameters cannot be hard-deleted. Set them inactive, keep them visible on old records, and prevent selection for new transactions. Duplicate cleanup uses audited alias/merge mapping without breaking historical references.

### Hosting, Backup, Permissions, and Exports

- Supabase project location for the current client is the Europe general region; if only specific regions are offered, prefer Central EU (Frankfurt) and verify latency from Egypt before creating the long-lived pilot project.
- Free-tier remains limited to development, demo, validation, and controlled pilot.
- Pilot requires manual database backup, restore-test evidence, file/import backup strategy, and documented limitations.
- Production requires paid/reliable hosting where needed, reliable backup, restore testing, defined retention, and a documented recovery process.
- Daily backups and a 30-day retention target are recommended if budget allows; because this remains conditional, final production retention and recovery objectives are still a go-live setup decision.
- Only Owner manages users and permissions in MVP. Accountant may view or request changes but cannot grant permissions, change roles, create privileged users, or modify security settings.
- Excel/PDF exports are internal reports only. External/legal documents are future scope requiring separate numbering, templates, legal wording, signing/stamping, archiving, and immutable issuance rules.

## Final Implementation Plan v4 Supersession Register

The repository copy of v4 remains unchanged as source evidence. Coding agents must apply these explicit supersessions instead of following the older v4 wording:

| ID | V4 wording/topic | Authoritative replacement |
| --- | --- | --- |
| SUP-001 | `allowed_negative_flag` on inventory balances | No general flag/toggle. Ordinary operations block negative stock; approved correction/historical inconsistency creates visible alerts under DEC-016 and Inventory Contract. |
| SUP-002 | Reservation status `expired` and possible expiry behavior | No automatic reservation expiry/job in MVP. Nullable `expires_at` is future-only; use active/consumed/released/failed under DEC-031. |
| SUP-003 | `approved_after_import_review` | Invalid/obsolete. Use `approval_status = approved`, `record_period = historical`, imported origin, required batch link, and lock. |
| SUP-004 | General adjustment/release after failed sale approval | Replaced by technical/business failure classification and reason-specific separate resolution under DEC-051/052. No general auto-release. |
| SUP-005 | Profit formula phrased as `sales_revenue - discounts - costs` | Authoritative revenue input is posted net revenue after allocated discounts; never subtract discount twice. |
| SUP-006 | Quality status examples containing `rejected` | MVP quality statuses are `accepted`, `needs_review`, and `blocked`; returned-stock disposition has its own lifecycle. |
| SUP-007 | Movement list omitting `return_from_wip` | `return_from_wip` is a contracted approved production-correction movement. |
| SUP-008 | V4 Open Questions 1–15 shown as active | Treat them as historical questions. UQ-001–UQ-024 resolution register and later decisions control; only entries explicitly marked partially/unresolved remain active. |
| SUP-009 | Stack/provider examples in v4 | Technical Architecture Contract controls exact stack, runtime, Vercel/Supabase/Drizzle boundaries and Europe-region decision. |

Omission from this table does not make a contradictory v4 example authoritative over a later approved contract.

## Pre-Coding Owner Decision Gates

These decisions are not guesses for coding agents. `WP-00-01` may inventory/report them; the named later package cannot start until its blockers are resolved and incorporated into the relevant contract.

| ID | Decision required | Blocking gate |
| --- | --- | --- |
| PCD-AUTH-001 | Private sign-in identifier/credential and password/account-recovery method. | WP-01-01 |
| PCD-AUTH-002 | Initial Owner bootstrap, lost-Owner recovery authority, and emergency/break-glass process. | WP-01-01; required before real data |
| PCD-AUTH-003 | Whether one user may hold multiple ERP roles and how conflicts are resolved. | RBAC schema/seed package |
| PCD-SEC-001 | Worker row scope: assigned locations/factories/tasks and who maintains assignments. | RBAC/domain schema packages |
| PCD-SEC-002 | Whether the worker financial-deny ceiling is non-overridable even by Owner-managed permissions. Recommended security position: non-overridable. | RBAC/permission seed package |
| PCD-SEC-003 | Session timeout, MFA expectations, privileged reauthentication, and break-glass logging before real data. | Pilot/security gate |
| PCD-APR-001 | Whether a requester may approve the same high-risk request, by transaction type, and any required segregation-of-duties exceptions. | Approval seed/transaction packages |
| PCD-PAY-001 | User-facing payment methods supported in MVP. | Payment schema/package |
| PCD-RAW-001 | Raw purchase amount basis when price is per ton: net versus gross accepted weight, plus exact late-price confirmation authority. | Raw receipt schema/approval package |
| PCD-INV-001 | Whether/how partially blocked or returned classifications may be transferred while preserving classification dimensions. | Transfer package |
| PCD-SALE-001 | Quality-risk sequence: approve disposition before reservation, reserve in a protected review state, or another explicit flow. | Sales submission/reservation package |
| PCD-RET-001 | Final partial-return monetary residual rule so cumulative posted credits reach but never exceed the original posted line net value. | Return package |
| PCD-MIG-001 | Whether Owner and Accountant migration approvals must be performed by two distinct user identities when a user can hold multiple roles. | Historical approval/commit package |
| PCD-MIG-002 | Approval level for post-commit historical correction, including when renewed dual approval is mandatory. | Historical correction package |
| PCD-MIG-003 | Per-domain cutover model/date: opening balances, transaction history, or both with a no-double-count boundary. | Historical templates/staging package |
| PCD-MIG-004 | Authoritative reconciliation totals and allowed tolerance/accepted-difference policy per domain. | Historical reconciliation package |
| PCD-UX-001 | Approved/provisional Arabic terminology fixture for the three reference screens. | Reference-screen packages |
| PCD-UX-002 | Canonical storage/sign-off mechanism for reference-screen approval evidence. | WP-01-08 |
| PCD-UX-003 | Exact management-phone actions supported per screen; unsupported actions must say larger screen required. | Frontend expansion package |
| PCD-UX-004 | Canonical versioned synthetic fixture and prohibited-data fixture for each of the three reference screens, including exact expected totals/states and forbidden worker fields. | Reference-screen packages |
| PCD-PILOT-001 | Bounded pilot users, data domains, transaction volume and duration. | Pilot gate |
| PCD-PILOT-002 | Parallel Excel duration and discrepancy acceptance/escalation. | Pilot/go-live gate |
| PCD-FILE-001 | Historical source/artifact retention and independent backup location/period. | Real migration/pilot gate |
| PCD-OPS-001 | Production tier/budget, retention, RPO, RTO, monitoring/alert channels, privacy/data-residency and incident responsibility. | Production go-live |

Technical profiling—such as the maximum safe all-or-nothing import batch size—is not an owner business decision, but it must produce measured evidence before the affected package may commit real data.

## MVP Scope

MVP includes:

1. Authentication, the five defined roles, role permissions, backend enforcement, and field-level filtering.
2. Arabic-first RTL interface and approved terminology support.
3. Tenant foundation, controlled settings, and internal document numbering with concurrency safety.
4. Supplier, customer, location, external factory, fiber/product, and quality master data.
5. Raw material batches, single-yarn lots, and twisted-yarn lots.
6. Multi-location inventory, including factory-held stock.
7. Immutable stock movements, materialized balances, reservations, adjustments, reversals, reconciliation, and negative-stock controls.
8. Outsourced single-yarn and twisting production, inputs/outputs, WIP, partial receipt, waste, output lots, lineage, rate confirmation, and factory payable.
9. Sales request, reservation, approval, stock issue, customer receivable, payments, partial payments, advances, settlements, and reversals.
10. Supplier and factory operational accounts and payments.
11. Optional transport/direct costs with controlled review and posting.
12. Quality tests, quality-risk controls, complaints, returns, return stock status, and approved customer adjustment.
13. Approval Center, append-only audit, correction/reversal workflows, and thin-to-full traceability.
14. Historical normalized templates, optional assisted transformation, staging, source/formula preservation, validation, reconciliation, review, approval, commit, locking, and controlled corrections.
15. Imported Historical Cost Preservation.
16. Reports for purchases, sales, inventory, WIP, waste, complaints/returns, balances, traceability, and approximate profitability with export permissions.
17. Manual backup, restore verification, backup evidence, and a later production-readiness backup policy/UI.
18. Phase-specific tests, smoke tests, regression, role browser tests, UAT, rollback notes, pilot, parallel run, and go-live gates.

## Non-Goals

The following are not MVP scope:

- full accounting ledger;
- full tax automation or advanced official invoicing compliance;
- payroll or HR;
- barcode/QR scanning;
- native mobile app;
- OCR;
- in-product AI assistant;
- customer, supplier, or factory portals;
- advanced production planning;
- bale-level tracking;
- multi-currency;
- complex overhead allocation or full accurate cost accounting;
- full dynamic business-rule engine;
- user-editable profitability, factory-cost, accounting, or financial formulas;
- multi-tenant SaaS admin panel;
- arbitrary client plugin system;
- automatic recalculation of approved or historical records;
- direct editing of approved historical records;
- unsafe audit-log deletion to fit free-tier limits;
- full two-step in-transit inventory; it is future scope, while MVP remains one-step.

These non-goals cannot be reintroduced as “small enhancements” inside an implementation work package.

## Configurability Reduction

### Safe MVP UI Settings

The following may be manageable through MVP UI where permissions and validation are defined:

- company profile;
- users, roles, and permissions;
- suppliers and customers;
- locations and external factories;
- fiber/product types;
- quality parameters;
- basic terminology labels;
- safe document-number prefixes;
- manual backup trigger;
- backup frequency display/configuration only if technically supported.

### Restricted Internal or Setup-Time Settings

The following may exist internally, at setup time, or as read-only values. Changes require a controlled technical/admin process and audit:

- current factory cost basis;
- default factory rate;
- default transport responsibility/payer handling;
- profitability profile;
- whether reviewed transport is included in profitability;
- approval thresholds;
- backup policy details.

No worker role may change these values. Transaction snapshots remain authoritative for already approved records.

### Deferred Productization Settings

The following are deferred:

- runtime factory-cost basis changes after live transactions exist;
- dynamic or user-defined profitability formulas;
- arbitrary rule engines;
- user-defined financial/accounting logic;
- effective-dated rules per factory/product/client;
- automatic recalculation of approved records;
- configurable accounting logic.

“Future-ready” means preserving structural seams and snapshots, not exposing these controls now.

## Worker UX Simplification Rules

Warehouse, production, and quality screens collect operational facts rather than accounting interpretations.

Worker screens should show:

- Arabic-first RTL labels;
- the minimum required operational fields;
- simple item, batch/lot, factory, and location selectors;
- quantity, date, status, notes, and direct validation;
- optional transport amount if known;
- safe choices such as `unknown`, `included elsewhere`, and `needs accountant review`.

Worker screens and worker API responses must not expose:

- purchase or sale prices unless a separately approved role rule explicitly allows them;
- factory rates or production cost;
- cost allocation or actual payer accounting treatment;
- customer receivables or supplier/factory payables;
- settlements or payment matching;
- profitability, profitability profiles, or formula versions;
- accounting adjustments or financial reconciliation;
- customer/supplier/factory balance reports;
- financial reports, exports, settings, or audit logs.

Accountant/Owner screens handle price/cost review, actual payer, subledger impact, settlement, profitability inclusion, migration approval, corrections, reversals, backup/restore, and audit review.

If incomplete financial-adjacent data does not endanger inventory correctness, save the operational record and route the unresolved financial part to Accountant Review. Do not create a payable or receivable until its required facts and approval are complete.

## Historical Migration Decisions

1. The currently known workbook is not the permanent historical source schema.
2. Normalized templates matching the target ERP are the preferred import target.
3. A workbook-specific adapter may be used as a one-time/client-specific transformation into normalized templates or staging rows.
4. AI assistance is optional and preparatory only.
5. AI must not invent missing prices, quantities, dates, identities, or relationships.
6. All imports enter staging before operational tables.
7. Source file, sheet, row, cell, formula, calculated value, transformation version, confidence, review, and approval metadata must be preserved where applicable.
8. Validation must cover required values, duplicates, master data, relationships, quantities/stock, formulas, and logical dates.
9. Ambiguous aliases and mappings require human approval.
10. Reconciliation must expose authoritative totals and unresolved differences before commit.
11. Both Owner and Accountant approval are required for commit; blocking errors prevent commit and accepted warnings remain recorded.
12. Commit must use domain posting rules, classify each record as historical/imported, link the import batch, and lock the result.
13. Historical records do not go through daily approval one by one.
14. Post-commit correction uses a reasoned, approved reversal/adjustment linked to the original and reflected in audit/reconciliation.
15. Direct editing or silent database patching of approved historical records is forbidden.

## Imported Historical Cost Preservation

For imported historical production records:

- preserve `imported_total_factory_cost`;
- do not force the current live input-based formula over the imported value;
- preserve source formula text and source calculated value when available;
- store an ERP-calculated comparison value;
- classify the historical cost basis as `imported_excel`, `input_based`, `output_based`, `manual`, or `unknown`;
- store difference amount and percentage;
- create a migration warning when values differ;
- route an uncertain basis to accountant review;
- record reviewer and approval metadata.

This is an import-only preservation rule. It must not become a general cost override for live production.

## Backup and Restore Decisions

- Phase 0 defines the backup design.
- Before pilot or real data entry, a manual database backup, file/import backup or documented equivalent, and a restore test must exist.
- Restore testing occurs in a separate test database/environment and verifies row counts, critical documents, sample stock balances, sample account balances, and source-file availability or its documented limitation.
- Backup and restore actions and evidence are logged.
- Database scope includes transactional, security, configuration, approval, audit, and migration data.
- File scope includes historical sources, mappings, validation/reconciliation artifacts, attachments, and stored generated files.
- Free-tier storage pressure is handled by limiting pilot volume or upgrading; audit logs must not be deleted unsafely.
- Excel and PDF exports are reports only and are not backups.
- Production restore, retention, monitoring, and storage policies must be defined before go-live.

## Approval and Audit Decisions

Every high-risk operation must enforce permission and tenant context on the backend, validate state, acquire required locks, re-check business conditions, apply all dependent stock/account writes, record approval and audit in the same transaction, and return a deterministic idempotent result.

At minimum this applies to sales submission/approval, returns, inventory adjustments, production receipts, payment reversals, stock reversals, negative-stock exceptions, historical commit, and post-approval corrections.

The audit log is append-only. The Owner has full audit visibility; the Accountant has operational and financial audit visibility; worker roles have no audit-log access in MVP. Normal application users cannot update or delete audit rows.

Approved or posted business records are not directly edited. Corrections preserve the original record and use reversal, adjustment, a corrected linked document, or another explicitly contracted correction method.

## Production, Pilot, and Go-Live Caveats

Free-tier deployment is not production hosting. Before real production use, the project must:

- upgrade the hosting/database plan;
- configure reliable database and file backups;
- verify restore;
- configure monitoring and storage retention;
- freeze and approve the migration batch;
- pass full regression, permission, concurrency, idempotency, migration, and restore tests;
- complete the limited pilot and parallel Excel run;
- reconcile critical stock and party balances;
- resolve or explicitly accept discrepancies;
- train users by role;
- approve rollback and go-live checklists.

If a material data issue appears during pilot, write access may be disabled while records are inspected. Posted records are corrected through controlled workflows; production restoration requires owner approval. A bad deployment may be rolled back, but business data must not be destructively rolled back without a verified backup and explicit authority.

## Owner Decision Resolution Register

| ID | Resolution | Status |
| --- | --- | --- |
| UQ-001 | One-step transfer in MVP; retain future `in_transit` schema capability. | Resolved by owner |
| UQ-002 | Factory payable on approved output receipt, including approved consumed input per partial receipt. | Resolved by owner |
| UQ-003 | Allow physical receipt without price; defer payable until Accountant/Owner confirms price. | Resolved by owner |
| UQ-004 | Multi-line schema/API from the start; UI may initially be single-line. | Resolved by owner |
| UQ-005 | Stable backend keys plus approved/provisional terminology layer; do not invent labels. | Resolved by owner |
| UQ-006 | MVP quality statuses are `accepted`, `needs_review`, and `blocked`, with the defined approval guards. | Resolved by owner |
| UQ-007 | Support `no_financial_impact`, `customer_credit`, `refund_due`, and `replacement`. | Resolved by owner |
| UQ-008 | Optional simple worker transport input; Accountant/Owner controls financial treatment. | Resolved by owner |
| UQ-009 | Initial migration target is 2025 and 2026 where available. | Resolved by owner |
| UQ-010 | Owner/Accountant provide or approve the listed reconciliation totals before commit. | Resolved by owner |
| UQ-011 | Migration commit requires both Owner and Accountant approval. | Resolved by owner |
| UQ-012 | Production requires paid/reliable hosting as needed; exact provider/tier/budget is a go-live procurement decision. | Partially resolved; production setup decision remains |
| UQ-013 | Reliable backup and restore are mandatory; daily/30-day retention is recommended if budget allows. Exact retention, RPO, and RTO remain production setup decisions. | Partially resolved; production setup decision remains |
| UQ-014 | Only Owner manages users and permissions in MVP. | Resolved by owner |
| UQ-015 | MVP exports are internal reports only. | Resolved by owner |
| UQ-016 | No general `allowed_negative_flag`; use visible controlled negative-stock alerts and approvals. | Resolved by owner |
| UQ-017 | Do not add `approved_after_import_review`; use approved status plus historical/import metadata and lock. | Resolved by owner |
| UQ-018 | Add `return_from_wip` as an approved production-correction movement. | Resolved by owner |
| UQ-019 | Profitability snapshots are immutable and versioned; latest active version drives reports. | Resolved by owner |
| UQ-020 | Store gross, discount, and net revenue; profitability uses net revenue. | Resolved by owner |
| UQ-021 | No automatic reservation expiry in MVP. | Resolved by owner |
| UQ-022 | Sales business-precondition failures create no posting and may enter reason-specific `approval_failed` or `needs_review` through a separate audited resolution; technical failures leave business/reservation state unchanged. | Resolved/refined by owner in DEC-051/052 |
| UQ-023 | Use the six-state returned-stock lifecycle and its sale-availability rules. | Resolved by owner |
| UQ-024 | No hard deletion of referenced master data; use inactive status and audited alias/merge mapping. | Resolved by owner |

The remaining production setup decisions under UQ-012 and UQ-013 do not authorize free-tier production. Before go-live, the owner must approve the hosting tier/budget, firm retention period, RPO, and RTO. Until then:

> Unresolved / requires owner decision
