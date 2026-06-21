# Project Context

## Document Status

This document is part of the documentation foundation for the **Specialized Yarn Trading & Outsourced Manufacturing ERP** (`نظام إدارة تجارة وتشغيل الغزل لدى الغير`). It establishes the business and delivery context that later contract documents, execution plans, and coding agents must preserve.

This is not an application specification by itself. Detailed rules remain governed by the source hierarchy below and by the future contract files indexed under `docs/contracts/`.

## Source-of-Truth Hierarchy

When sources differ, implementation must apply this canonical order:

1. Explicit owner decisions consolidated in `docs/02_decision_log_and_scope.md`, including accepted answers and later owner decision patches.
2. Approved contracts in `docs/contracts/`, within each contract's declared domain.
3. Final Implementation Plan v4, preserved in `docs/01_final_implementation_plan_v4.md`, only where it is not superseded by a higher-authority decision or contract.
4. `07_Historical_Migration_Clarification.txt` for remaining historical-migration context.
5. `Attack Review Integration Notes.txt` for remaining integrated risk context.
6. `Architecture-Blueprint-v2.txt`, for fallback context only.
7. This project-context summary for orientation, never to override a higher-authority rule.

Execution plans and work packages may narrow implementation scope/order but may not change business behavior. Older implementation plans, raw attack reviews, and unlisted materials must not override this hierarchy. `docs/02_decision_log_and_scope.md` contains the authoritative supersession register for known v4 conflicts. The repository copy of v4 remains byte-for-byte source evidence and must not be edited merely to annotate superseded clauses.

If a required business rule is not defined by an authorized source or a later approved contract, the required wording is:

> Unresolved / requires owner decision

Coding agents must not invent, infer, generalize, or silently choose business rules.

## ERP Purpose

The ERP is intended to give one yarn trading and outsourced manufacturing business a reliable operational system for inventory, production transformation, sales, balances, quality, historical migration, and traceability.

Its central question is:

> Where did this material come from, where did it go, what was produced from it, who bought it, and did it cause quality, return, complaint, or financial problems?

The MVP is a single-client implementation with a future-ready architecture. It is not a fully configurable SaaS ERP product and must not become one through undocumented scope expansion.

## Business Domain and Current Client Workflow

The client trades raw fibers and yarn and outsources physical production. The client does not currently own the production factories used by the workflow.

The practical operating chain is:

1. Buy raw fibers such as cotton, polyester, acrylic, viscose, and blends.
2. Receive raw material into an internal warehouse, port warehouse, or other company-controlled location.
3. Track each raw material batch (`رسالة خام`) by identity, quantity, supplier, location, and quality context.
4. Transfer raw material to an external factory when needed.
5. Issue material already present at the factory location into outsourced single-yarn production.
6. Receive one or more single-yarn lots, record output and waste, and retain uncompleted input as WIP.
7. Transfer or issue single yarn to an external twisting factory.
8. Receive one or more twisted-yarn lots, recording output, waste, and remaining WIP.
9. Sell raw material, single yarn, or twisted yarn from an internal location or directly from an external factory location.
10. Track customer receipts, supplier payments, factory payments, partial payments, advances, and outstanding operational balances.
11. Record quality tests, complaints, returns, blocked stock, and approved quality-risk sales.

The MVP uses one-step transfers: source stock decreases and destination stock increases in the same approved posting. The `in_transit` location type remains schema-ready for a future two-step dispatch/receipt workflow, but that workflow is not implemented in MVP.

## External Factories as Inventory Locations

External factories have two simultaneous meanings:

- They are service providers that perform single-yarn production or twisting.
- They are inventory locations where company-owned raw material or yarn may remain for weeks or months.

Every external factory must therefore have a linked inventory location. Factory-held stock is company stock and must be included in location balances, traceability, reconciliation, and reporting. Material at a factory is not automatically WIP: it remains on hand at the factory location until it is issued into a production order.

## Raw Material Batch and Yarn Lot Tracking

Raw material is tracked by batch, not only by aggregate product. Produced material is tracked by yarn lot, distinguishing single yarn from twisted yarn.

The MVP UI may present a simple one-input/one-output workflow, but the underlying design must not prevent:

- one raw batch being split across factories or production orders;
- one raw batch producing multiple single-yarn lots;
- one single-yarn lot producing multiple twisted-yarn lots;
- multiple inputs and multiple outputs on a production order.

Thin traceability must appear early; full end-to-end traceability is completed later.

## Inventory, Reservation, and WIP

Posted stock movements are immutable and are the stock source of truth. Materialized inventory balances are updated transactionally and must reconcile to the ledger.

Pending sales submitted for approval reserve stock but do not reduce on-hand stock. Approval consumes the reservation and reduces on-hand stock atomically. Draft sales do not reserve stock.

Production must not double-count material:

- stock physically at a factory remains on hand;
- issuing it to production decreases factory on-hand and increases WIP;
- receiving output decreases WIP by consumed input and increases output stock;
- waste decreases WIP separately;
- remaining unprocessed issued material stays in WIP.

Unprocessed material returned from WIP uses the explicit `return_from_wip` movement type. Posting decreases WIP and increases on-hand at the selected return location. It is a controlled production correction requiring Owner/Accountant approval.

## Sales and Approvals

All sales require approval before execution. A pending sale protects inventory through reservation. Approval must atomically consume the reservation, post the stock issue, create the customer receivable, create the profitability snapshot, update approval state, and write the audit event.

Returns, inventory adjustments, production receipts, payment reversals, negative-stock exceptions, quality-risk sales, and post-approval corrections also require controlled approval workflows as defined by the final plan and future contracts.

An approval is never a simple status update.

## Operational Balances

The MVP includes an immutable operational subledger, not a full accounting ledger. It supports:

- customer receivables, payments, credits, partial payments, and advances;
- supplier payables and payments;
- factory payables and payments;
- settlement links and reversal entries.

Costs, actual payments, settlements, and balance impacts are separate events. A cost can exist without having been paid.

## Quality, Complaints, and Returns

Quality tests apply to raw batches and yarn lots. MVP quality statuses are `accepted`, `needs_review`, and `blocked`. Accepted stock may be sold normally; `needs_review` requires Owner/Accountant approval; `blocked` cannot be sold unless Owner/Accountant explicitly approves a special quality-risk sale. Workers record operational quality facts but do not decide discounts or financial treatment.

Complaints connect the customer, sale, item, affected quantity, investigation, and any return. Approved returns add stock at a return location, preserve its condition/status, and apply a customer financial adjustment only under the approved return treatment. MVP financial treatments are `no_financial_impact`, `customer_credit`, `refund_due`, and `replacement`. Returned stock is not automatically waste.

Returned-stock classifications are `return_received`, `needs_quality_review`, `sellable_as_is`, `sellable_with_discount`, `blocked`, and `reprocess_required`. Only `sellable_as_is` is available for normal sale. `sellable_with_discount` requires Owner/Accountant approval; the other review, blocked, or reprocess states are unavailable for sale.

## Historical Migration Risk

Historical sources may be messy, formula-heavy, inconsistent, incomplete, and ambiguous. The currently examined workbook is a migration-risk example, not the permanent import schema and not unquestioned historical truth.

The preferred migration flow is:

```text
historical source files
→ optional AI-assisted or workbook-specific transformation
→ normalized historical import templates
→ staging
→ validation
→ reconciliation
→ human review
→ owner/accountant approval
→ historical commit
→ locked records
→ correction only through reversal/adjustment
```

AI may prepare draft transformations but may not approve historical truth, invent missing values or relationships, or write directly to operational tables. Every historical import must pass staging, validation, reconciliation, and human approval.

The initial migration target is 2025 and 2026 data where available. Commit requires both Owner and Accountant approval after they provide or approve the reconciliation totals.

Committed historical records are locked against direct editing. They use `approval_status = approved`, `record_period = historical`, the applicable imported `record_origin`, `is_locked = true`, and a required `import_batch_id`. Imported production costs are preserved as historical values even when they differ from the live input-based formula; discrepancies are retained for comparison, warning, and accountant review.

## Approximate Profitability

MVP profitability is approximate but deterministic, versioned, permission-restricted, and visibly labelled as approximate. Gross revenue, discount amount, and net revenue are stored separately; profitability uses net revenue. It may include raw material cost, single-yarn production cost, twisting cost, approved direct costs, and return impact.

Profitability snapshots are immutable. Sale approval creates version 1; a return, correction, or reviewed cost completion creates a new version. Reports use the latest active snapshot while superseded versions remain available for audit.

Missing costs must be shown as flags rather than silently treated as trustworthy complete profitability. The MVP is not full cost accounting and must not expose editable profitability formulas.

## Arabic-First and RTL Context

The operational interface is Arabic-first and must support right-to-left layout. Client terminology and approved aliases matter for data entry, migration, reports, and training. Backend rules use stable terminology keys; UI labels come from an approved/provisional terminology layer and are never hardcoded into business logic.

Initial labels are `raw_batch = رسالة خام`, `single_yarn_lot = لوط فرد`, `twisted_yarn_lot = لوط زوى`, `single_yarn_factory = مصنع الفرد`, `twisting_factory = مصنع الزوى`, and `inventory_movements = حركة مخازن`. Any unconfirmed label remains provisional and changeable through its terminology key; coding agents must not invent Arabic labels.

Warehouse, production, and quality users need role-specific Arabic screens with the minimum operational fields. Financial concepts, rates, prices, payables, receivables, settlement, and profitability must remain hidden from those worker roles. Terminology must be approved and cached safely; ambiguous historical Arabic names must be reviewed rather than automatically merged.

## Why This Is Not a Generic ERP

This ERP combines domain-specific requirements that generic stock-and-sales CRUD does not safely cover:

- batches and lineage across raw material, single yarn, and twisted yarn;
- outsourced transformation with external factories holding company stock;
- explicit WIP and waste treatment;
- input-based factory cost for live production;
- sales reservation before approval;
- operational subledgers separated from full accounting;
- quality-risk sale and return controls;
- staged historical migration with source/formula preservation;
- Arabic-first worker workflows and financial field separation.

Generic ERP assumptions must not be imported when they conflict with these rules.

## Why the MVP Must Be Practical but Not Naive

The MVP should be quick enough to validate with the client and simple enough for workers to use. It may defer productization, full accounting, complex costing, full in-transit handling, automation, and advanced portals.

It may not take shortcuts in areas where a shortcut can corrupt stock, WIP, balances, approvals, historical data, permissions, audit, or recovery. Required safeguards include immutable ledgers, transaction boundaries, row locking, idempotency, reconciliation, role and field permissions, audit in the same transaction, backup/restore testing, controlled correction, a limited pilot, an Excel parallel run, and explicit go-live approval.

Free-tier deployment is for development, demo, workflow validation, and a limited pilot only. It is not production-ready. Excel or PDF exports are reports, not backups.

## Non-Invention Rule for Later Agents

Later documentation and coding agents must:

- read the applicable contract files before implementation;
- preserve the source hierarchy in this document;
- implement only approved MVP scope;
- use explicit unresolved markers instead of assumptions;
- avoid adding configurable business logic, accounting behavior, or migration shortcuts not authorized by the sources;
- stop and request an owner decision when a missing rule would change stock, WIP, money, approvals, permissions, migration truth, audit, backup, or go-live safety.
