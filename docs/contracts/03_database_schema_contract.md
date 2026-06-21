# Database Schema Contract

## 1. Purpose

Define implementation-safe relational schema rules so later Drizzle schema definitions and PostgreSQL migrations can be created without inventing entities, statuses, precision, tenancy, immutability, historical behavior, or financial visibility. This contract does not create migrations or application models.

## 2. Scope

This contract covers global PostgreSQL conventions; tenant ownership and timezone; platform/security, master, inventory, production, sales, return, subledger, cost, quality, migration, approval, audit, and backup metadata; required keys, relationships, constraints, indexes, snapshots, and lifecycle rules; live versus historical records; and deletion/correction behavior.

## 3. Non-Goals

- No executable SQL, Drizzle code, or migrations.
- No full accounting general ledger or multi-currency behavior.
- No dynamic rule engine.
- No report-query specification.
- No hard deletion of posted/referenced records.
- No UI component definition.

## 4. Source Documents and Sections Used

- Final Implementation Plan v4 §§7–10 and §§11–22.
- Decision Log: Binding Decisions, Integrated Owner Clarifications, Integrated Design-System Decisions, and Owner Decision Resolution Register.
- Technical Architecture Contract: Supabase PostgreSQL, Drizzle, connection, migration, backup, and security boundaries.
- Design System Contract: date/timezone, Western numerals, numeric precision, and permission-safe presentation.

Owner clarifications in the decision log override conflicting draft enum/field examples in v4.

## 5. Global PostgreSQL Conventions

### 5.1 Tenant-Owned Row Baseline

Every tenant-owned table requires:

```text
id UUID PRIMARY KEY
tenant_id UUID NOT NULL REFERENCES tenants(id)
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
created_by UUID NULL REFERENCES users(id)
updated_at TIMESTAMPTZ NULL
updated_by UUID NULL REFERENCES users(id)
```

Tables whose drafts can be discarded/inactivated may also include:

```text
deleted_at TIMESTAMPTZ NULL
deleted_by UUID NULL REFERENCES users(id)
```

`deleted_at` is not permission to delete posted, approved, imported, referenced, or audited records. Tenant-safe foreign keys must prevent cross-tenant relationships, using composite tenant-aware constraints where necessary.

Every query/mutation validates `tenant_id` from authenticated server context. Request-body tenant identifiers are never authoritative.

### 5.2 Approved Business Document Baseline

Approved/postable documents require, where applicable:

```text
doc_no TEXT NOT NULL
status governed by document-specific constraint
approval_status governed by approval_status constraint
record_origin record_origin NOT NULL
record_period record_period NOT NULL
is_locked BOOLEAN NOT NULL DEFAULT false
import_batch_id UUID NULL REFERENCES import_batches(id)
reversal_of_id UUID NULL
correction_of_id UUID NULL
approved_by UUID NULL REFERENCES users(id)
approved_at TIMESTAMPTZ NULL
```

Document numbers are immutable after assignment. Posted/approved records do not rewrite business facts; changes use approved reversal, adjustment, status transition, or linked corrected documents.

### 5.3 Data Types and Precision

- UUID for primary/business references.
- `DATE` for date-only business values.
- `TIMESTAMPTZ` for instants.
- `NUMERIC(18,3)` for kilogram quantities.
- `NUMERIC(18,2)` for official posted money and factory rates per ton.
- `NUMERIC(18,6)` for calculated unit costs where required.
- `NUMERIC(24,8)` for persisted precise monetary allocations.
- Ratios/proportions retain at least 12 decimal places during calculation and, when persisted, use a numeric scale of at least 12.
- `TEXT` plus constraints for document/business codes.
- `JSONB` only for contracted snapshots/metadata; it must not replace relational integrity.

Use decimal arithmetic only. Do not use floating-point types or JavaScript floating-point arithmetic for stock, money, rates, discounts, allocations, unit costs, or profitability. Intermediate calculations retain high precision. Official posted monetary values are quantized to two decimals using `ROUND_HALF_UP` only when they become a document amount, account entry, payment, payable, receivable, or profitability snapshot.

### 5.4 Date and Timezone Rules

- Date-only fields use `DATE` and API `YYYY-MM-DD` semantics.
- Instants use `TIMESTAMPTZ` and ISO-compatible API values.
- A `DATE` must not pass through timestamp conversion that shifts the day.
- `tenants.timezone` is required and stores an IANA identifier.
- Current-client default is `Africa/Cairo`.
- `DD/MM/YYYY` and Western numerals are display rules only.

## 6. Core Status and Classification Values

Implement as PostgreSQL enums or check constraints:

```text
role_code:
  owner, accountant, warehouse_employee, production_employee, quality_employee

approval_status:
  draft, pending_approval, approved,
  rejected, cancelled, reversed

record_origin:
  manual_live, excel_import, ai_assisted_import,
  manual_historical_entry, system_generated

record_period:
  live, historical

item_kind:
  raw_material, single_yarn, twisted_yarn

location_type:
  internal_warehouse, port_warehouse, external_single_factory,
  external_twisting_factory, in_transit, returned_stock,
  temporary, wip_virtual

movement_type:
  raw_receipt, transfer, issue_to_production, receive_from_production,
  production_waste, return_from_wip, sale_issue, return_receipt,
  inventory_adjustment, stock_block, stock_unblock, reversal, correction

movement_status:
  draft, pending_approval, posted, cancelled, reversed

reservation_status:
  active, approved_consumed, released, failed

production_type:
  single_yarn, twisted_yarn

production_status:
  draft, material_issued, partially_received, completed,
  correction_requested, cancelled, reversed

quality_status:
  accepted, needs_review, blocked

sale_status:
  draft, pending_approval, needs_review, approval_failed, approved, rejected,
  cancelled, reversed, partially_returned, fully_returned

return_status:
  draft, pending_approval, approved, rejected, cancelled, reversed

returned_stock_status:
  return_received, needs_quality_review, sellable_as_is,
  sellable_with_discount, blocked, reprocess_required

return_financial_treatment:
  no_financial_impact, customer_credit, refund_due, replacement

payment_status:
  draft, posted, reversed, cancelled

payment_direction:
  received_from_party, paid_to_party

settlement_status:
  unsettled, partially_settled, settled, reversed

account_entry_type:
  customer_sale_receivable, customer_return_credit,
  supplier_raw_payable, factory_production_payable,
  customer_payment, supplier_payment, factory_payment,
  customer_direct_cost_receivable, factory_direct_cost_recovery,
  historical_opening_balance, reversal

import_batch_status:
  draft, source_uploaded, normalized, staged,
  validation_in_progress, validation_complete,
  reconciliation_in_progress, review_required,
  pending_dual_approval, approved_for_commit,
  committing, committed, rejected, cancelled

account_owner_type:
  customer, supplier, factory

direct_cost_type:
  transport, loading, unloading, customs, other

cost_responsibility_type:
  company, customer, factory, shared, other,
  unknown, included_elsewhere, needs_accountant_review

actual_payer_type:
  company, customer, factory, other, unknown, not_recorded

review_status:
  not_required, needs_accountant_review, reviewed, approved, rejected

historical_cost_basis_source:
  imported_excel, input_based, output_based, manual, unknown
```

Do not add `approved_after_import_review`: imported history uses `approved` plus historical/import metadata. `expires_at` may remain nullable on reservations, but there is no MVP automatic expiry state/job.

## 7. Platform and Security Tables

### 7.1 `tenants`

Fields: company name, default language `ar`, ISO currency code, required timezone, status, and terminology version. Current-client seed uses `currency_code = EGP` and timezone `Africa/Cairo`; timezone remains tenant-configurable. The Arabic display label for EGP is `جنيه`. Financial records snapshot/store the ISO currency code where relevant.

### 7.2 `users`, `roles`, `permissions`, `user_roles`, `role_permissions`

`users` maps one Supabase Auth identity to an ERP tenant user and stores name, email, phone, status, language and last login. Require unique `(tenant_id, email)` and unique auth identity mapping. The join-table schema remains capable of multiple role assignments, but role-seed/guard behavior for a multi-role user is blocked by PCD-AUTH-003; coding agents must not choose a conflict-resolution policy.

`roles` requires unique `(tenant_id, role_code)`. `permissions` stores stable key, module, action, optional field key, and description. Join tables use composite primary keys and tenant-consistency constraints. Only Owner manages users/permissions in MVP; every assignment change is audited.

Worker row-scope assignment tables/policies are blocked by PCD-SEC-001. Until resolved, no worker may receive unrestricted tenant-wide write scope as a convenience. Worker financial deny behavior follows PCD-SEC-002 and Permission Matrix.

### 7.3 `tenant_settings`

Fields: setting key/value JSON, level, runtime-editable flag, sensitivity, effective-from, changer and reason. Unique `(tenant_id, setting_key, effective_from)`; level is `safe_ui`, `restricted_setup`, or `deferred_productization`.

### 7.4 `terminology_labels`

Stable key, module, Arabic/English labels, source aliases, approved/provisional classification, editability, notes and version. Unique `(tenant_id, label_key)`.

### 7.5 `document_sequences`

Document type, year, prefix and last number. Unique `(tenant_id, document_type, year)`. Lock the row during allocation; document tables also enforce tenant-scoped document-number uniqueness.

### 7.6 `approval_requests`

Request type, entity, risk, requester/time/reason, state, decision actor/time/notes, idempotency key, `subject_version`, `subject_hash`, submitted child/line version summary, invalidated actor/time/reason, and optional superseding request. Allow only one active pending request per entity/request scope and require unique non-null `(tenant_id, idempotency_key)`.

Approval submission computes the subject hash server-side from the exact approval-relevant persisted fields and child rows. Draft changes are prohibited while pending unless the workflow explicitly invalidates/cancels the request. Any material subject change invalidates the request and requires revalidation/resubmission; an approval may not decide a stale hash.

### 7.7 `audit_logs`

Append-only tenant/user/entity/action, old/new JSON, reason, approval request, idempotency key, IP/device and timestamp. Application roles cannot update/delete. Important audit rows are written in the business transaction.

### 7.8 Idempotency Persistence

A central `idempotency_records` table or equivalent per-command persistence requires tenant, operation scope, key, request hash, state (`in_progress`, `succeeded`, `business_failed`, `retryable_failed`), optional entity, response code/body, owner token, attempt count, lease/heartbeat timestamps, lease expiry, last error class, and timestamps. Unique `(tenant_id, operation_scope, idempotency_key)`. Same key/same request returns the prior durable result; same key/different request conflicts.

An expired `in_progress` lease does not remain an indefinite conflict. A retry atomically claims the expired lease, then checks unique source/effect constraints to determine whether the domain transaction already committed before re-executing. A live lease returns deterministic in-progress behavior. Technical failure uses `retryable_failed`; business-precondition outcomes may be replayed as `business_failed` without implying a posting.

### 7.9 `operational_alerts`

Tenant, severity, alert type, source entity, message key/details, state, detected/resolved actor/time, and audit linkage. Missing/corrupted reservation resolution creates a critical alert. Alerts are official records but are not inventory, reservation, sale, or account postings. Resolution is explicit and audited; alerts are not silently deleted.

## 8. Master Data Tables

Required: `suppliers`, `customers`, `locations`, `external_factories`, `fiber_types`, `product_types`, and `quality_parameters`.

Each has tenant, stable code, Arabic name, optional English name, normalized name where safe, active/inactive state, notes and audit metadata.

Constraints:

- tenant-scoped code uniqueness;
- approved normalized-name uniqueness where safe;
- each external factory has exactly one linked location;
- unique `(tenant_id, linked_location_id)`;
- factory type is `single_yarn`, `twisting`, or `both`;
- factory location type corresponds to factory type;
- inactive records remain visible on old documents and unavailable for new transactions.

Referenced master data cannot be hard-deleted. Duplicate resolution uses audited alias/merge mapping without silently rewriting historical identity.

## 9. Inventory Tables

### 9.1 `inventory_items`

Canonical item with kind, code, Arabic display name, quality status, block status and active state. Unique `(tenant_id, item_kind, item_code)`; index kind, quality, and block state.

### 9.2 `raw_material_batches`

Item, batch number, supplier, fiber type, origin, season, bales, gross/net kg, purchase price/rate, total cost, received date, state/approval/origin/period/lock/import metadata.

- `item_id` is required and tenant-unique across raw batches: each raw batch owns one distinct `inventory_items` identity used by movements and balances. Enforce a tenant-safe one-to-one relationship.
- Unique `(tenant_id, batch_no)`.
- Weights use `NUMERIC(18,3)`; price/cost use `NUMERIC(18,2)`.
- Gross cannot be below net when both exist.
- Price may be null; stock can post while payable waits for Accountant Review.

### 9.3 `yarn_lots`

Item, lot number/type, yarn specifications, production order, factory, dates, summarized input/output/waste, quality, state and origin/import metadata. `item_id` is required and tenant-unique across yarn lots: each single/twisted lot owns one distinct inventory-item identity. Enforce a tenant-safe one-to-one relationship. Also require unique `(tenant_id, lot_type, lot_no)`; quantities use `NUMERIC(18,3)`.

### 9.3.1 `raw_purchase_price_confirmations`

Append-only controlled completion for an approved physical receipt whose price was unknown. Store raw batch/receipt, confirmed price per ton, contracted quantity basis, precise calculated amount, posted payable amount, currency, subject version/hash, approval request, confirmer/approver/time/reason, idempotency, account entry and reversal/correction links. Allow only one effective confirmation per source receipt; correction uses a linked reversal and new confirmation.

The exact net-versus-gross accepted weight basis and late-price authority are blocked by PCD-RAW-001. No schema or raw-posting package may invent the formula. When resolved, calculation uses high-precision decimal arithmetic and `ROUND_HALF_UP` only at payable posting.

### 9.4 `stock_movements`

Immutable posted movement with document number, type/state, item, from/to location, quantity/date, source, approval, reversal, idempotency, origin/period/import, actors and posting timestamps.

- Quantity is positive `NUMERIC(18,3)`.
- At least one location exists; normal transfer source/destination differ.
- Unique `(tenant_id, doc_no)` and non-null idempotency key.
- Index item/date, locations/date, source, import batch and reversal.
- Posted business columns are immutable.

### 9.5 `inventory_balances`

Unique `(tenant_id, item_id, location_id)` with:

```text
on_hand_qty_kg NUMERIC(18,3)
reserved_qty_kg NUMERIC(18,3) default 0
blocked_qty_kg NUMERIC(18,3) default 0
returned_qty_kg NUMERIC(18,3) default 0
last_movement_id
version
```

Reserved, blocked and returned quantities cannot be negative. Reserved cannot exceed positive on-hand available for reservation. Do not define `allowed_negative_flag`. On-hand may be negative only through approved correction/historical inconsistency and must alert; ordinary services block it.

Returned and blocked dimensions can overlap. Available quantity is on-hand minus reserved minus blocked; returned is not extra physical stock.

### 9.6 `stock_reservations`

Reservation number, item/location, quantity, source/sale/line, state, timestamps, nullable future `expires_at`, idempotency key, and nullable failure-resolution reason/actor/time metadata. Quantity positive; one active reservation per source/item/location scope; no automatic expiry. A failed/corrupted reservation must remain traceable and reconcile through an audited resolution record and critical alert; it is never silently deleted or released.

### 9.7 `inventory_adjustments`

Document, item/location, direction/type, positive absolute quantity, reason, state, approval and posted movement. Approved adjustment links to one posting/reversal chain.

## 10. Production and WIP Tables

### 10.1 `production_orders`

Production type, factory/location, state/approval, dates, expected waste, totals, origin/import/lock and rate/cost/payable snapshots:

```text
payable_trigger_used = production_receipt_approval
factory_cost_basis_used = input_quantity
factory_rate_per_ton_used NUMERIC(18,2)
calculation_version
confirmed_by
confirmed_at
```

Historical-only nullable preservation fields include imported/ERP factory cost, basis, formula, source calculated value, amount/percent differences, warning, review and approval metadata.

### 10.2 `production_inputs` and `production_outputs`

Many-to-many-capable child rows. Inputs store planned, issued, consumed, returned-from-WIP and remaining WIP quantities, item/location and movement links. Outputs store output item/lot/location, quantity and receipt movement. Use child rows even when MVP UI selects one input/output.

### 10.3 `production_wip_balances`

Unique `(tenant_id, production_order_id, input_item_id, factory_location_id)` with `wip_qty_kg NUMERIC(18,3)`, version and timestamp. Ordinary posting cannot make WIP negative; only approved correction may create an alerted inconsistency.

### 10.4 `production_receipts`, `production_receipt_input_allocations`, `production_waste_entries`, `production_wip_returns`

Distinct event rows support partial receipts and payable audit. Receipts store output, rate snapshot, payable, approval/account entry and idempotency. Receipt-input allocations link each receipt to production inputs and store consumed-toward-output quantity, allocated waste quantity, and payable cost-basis quantity so input cannot be charged twice. Waste records quantity/percent/reason/movement. WIP returns store request/approval, return location, reason, movement, financial review and actors.

## 11. Sales, Returns, and Profitability Tables

### 11.1 `sales_orders` and `sales_order_lines`

Multi-line capable. Orders contain customer, state/approval, date, total gross revenue, `order_discount_total`, `document_total_posted`, reservation/payment/delivery and origin/import/lock. Lines contain stable `line_no`, item/location, quantity, price per ton, reservation/movement, quality-warning snapshot, and:

```text
line_gross_revenue NUMERIC(18,2)
line_allocated_discount_precise NUMERIC(24,8)
line_allocated_discount_posted NUMERIC(18,2)
line_net_revenue_precise NUMERIC(24,8)
line_net_revenue_posted NUMERIC(18,2)
rounding_adjustment NUMERIC(18,2)
```

Warehouse-created operational drafts may keep price and revenue fields null. Before submission for approval, Accountant/Owner must complete authorized commercial fields and totals; submitted/approved rows cannot retain missing required price/net revenue.

Calculations use decimal arithmetic and retain high precision:

```text
line_discount_share = line_gross_revenue / total_gross_revenue
line_allocated_discount_precise = order_discount_total × line_discount_share
line_net_revenue_precise = line_gross_revenue - line_allocated_discount_precise
```

Calculate quantity × price at high precision before quantizing the official `line_gross_revenue` to two decimals with `ROUND_HALF_UP`. Posted line discounts are then rounded to two decimals with `ROUND_HALF_UP`. The residual needed to make posted line discounts equal the order discount is assigned to the largest gross-revenue line; a tie uses the lowest stable `line_no`. `rounding_adjustment` stores that signed residual on the selected line and is zero on other lines. `line_allocated_discount_posted` includes the residual, and posted line net revenue is derived consistently from posted gross and posted discount.

Required constraints/invariants:

```text
order_discount_total >= 0
order_discount_total <= total_gross_revenue
total_gross_revenue = 0 implies order_discount_total = 0
sum(line_allocated_discount_posted) = order_discount_total
document_total_posted = sum(line_net_revenue_posted)
```

Cross-row totals are enforced and reconciled by the transactional service plus database-safe constraints/triggers only where explicitly designed; they must never rely on client arithmetic. Quantity uses `NUMERIC(18,3)`.

### 11.2 `sales_profitability_snapshots`

Immutable/versioned sale, version, active/superseded state/link, profile, cost/revenue/return snapshots, profit/margin, missing-cost flags, reason and calculation time.

- Unique `(tenant_id, sales_order_id, version)`.
- At most one active snapshot per sale.
- Recalculation inserts a version and supersedes the prior row.
- Historical snapshots are never silently recalculated.

### 11.3 Returns

`return_requests`/`return_lines` store sale/customer, date, state/approval, reason, financial treatment, adjustment, item/quantity/location, returned classification, quality and movement. Approved return quantity cannot exceed sold minus prior effective returns.

A replacement return is two linked operational documents: an approved return receipt and an approved replacement sales order/issue. Store `original_sale_id`, `original_sale_line_id`, `return_request_id`, and `replacement_order_id` or `replacement_issue_id` as applicable. Return lines snapshot the original approved line net unit value after allocated discount as `NUMERIC(18,6)` and the posted `return_credit_value` as `NUMERIC(18,2)`. Prior effective returns cap cumulative credit at the remaining original approved sale-line value. Replacement orders use ordinary sales reservations, discount allocation, approval, issue, receivable, and profitability structures.

## 12. Operational Subledger and Direct Costs

### 12.1 `accounts` and `account_entries`

One account per tenant/owner type/owner/currency. Current-client entries use ISO `EGP`. Immutable entries include signed amount, constrained `account_entry_type`, source, constrained `settlement_status`, reversal and origin/import metadata. Unique entry number; non-zero `NUMERIC(18,2)`; index account/date, source, unsettled, import and reversal.

### 12.2 `payments` and `payment_settlements`

Payments store number/date/account, positive amount, constrained `payment_direction`, method key, state, notes, attachment, posted entry, reversal and idempotency. Allowed user-facing payment-method keys are blocked by PCD-PAY-001; do not seed an arbitrary list. Settlements link payment entry to receivable/payable entry with positive settled amount and constrained state. Transaction locking/validation prevents over-settlement.

### 12.3 `direct_costs` and `direct_cost_allocations`

Direct costs store type, linked entity, nullable amount, currency, responsibility, payer, profitability inclusion, review and notes. Allocations store responsible party/share/subledger entry. Shared allocations reconcile to total/100%; no entry before required review.

## 13. Quality and Complaints

`quality_tests`, `quality_test_values`, and `complaints` reference item/batch/lot/customer/sale as applicable and store dates, statuses, values, investigation and actors. Index item/date/status and customer/sale/open complaint. Referenced quality parameters cannot be hard-deleted.

## 14. Historical Migration Tables and Metadata

Required: `import_batches` using `import_batch_status`, `import_files`, `import_template_versions`, `import_staging_rows`, `import_staging_cells`, `import_validation_errors` (with severity/blocking flag), `import_reconciliation_results`, `import_human_review_items`, and alias/master mappings.

Staging preserves source file/sheet/row/column, original/formula/calculated/transformed values, template/mapping/AI versions, confidence, review and approval.

Committed history requires:

```text
approval_status = approved
record_period = historical
record_origin = excel_import | ai_assisted_import | manual_historical_entry
is_locked = true
import_batch_id NOT NULL
```

AI output never writes directly to operations. Historical correction uses approved linked reversal/adjustment.

## 15. Backup and Restore Metadata

`backup_runs` stores type/environment/times/operator/state/location/checksum/evidence/error. `restore_tests` stores source backup, separate target, row counts, stock/account samples, file availability, operator/times/state/evidence. Never store credentials. Exports are not backups.

## 16. Foreign Keys and Tenant Safety

Every relationship preserves tenant identity: factory/location, batch/supplier/item, lot/production/factory, balances/movements/reservations, production children, sale/return lines, accounts/entries/payments, import records, approvals and audits.

Where UUID foreign keys cannot prove same tenant, use composite `(tenant_id, id)` references or equivalent database enforcement. Application validation alone is insufficient.

## 17. Index Requirements

Index tenant foreign keys; tenant/status/date queues; tenant/document numbers; item/location movements; active reservations; production factory/state/date; sale customer/state/date; account/date/unsettled; approval pending entity/type; audit entity/user time; import batch/source; quality/complaint state; backup/restore state. Exact order is finalized against query plans.

## 18. Soft Delete, Cancel, Reverse, and Correct

- Only dependency-free drafts may be soft-deleted.
- Referenced master data is inactivated.
- Pending sales rejected/cancelled by an authorized human decision release reservations explicitly and with audit. Approval failures follow the reason-based reservation-resolution contract and do not imply automatic release.
- Approved/posted documents use linked reversal/correction.
- Movements, account entries, audits, profitability snapshots and committed history are immutable.
- Cascades must not erase business/audit history.

## 19. Transaction Snapshots

Required snapshots cover production rate/basis/payable trigger/quantities/cost/version/confirmer; sale gross/discount/net and profitability components/profile/version/missing flags; direct-cost responsibility/payer/inclusion/review; quality-risk sale state/reason; return treatment/classification; and imported formula/value/cost comparison. Snapshots are history, not overwriteable caches.

## 20. Permission Rules

- Database credentials are server-only.
- Operational tables are browser-denied unless later safe RLS/select behavior is contracted.
- Worker queries omit restricted financial columns.
- Only Owner manages user/permission records.
- Only approved actors commit migration.
- No app role updates/deletes audit.

## 21. API and Service Implications

Route Handlers call services; they do not mutate tables. InventoryLedgerService owns movement/balance writes, ProductionPostingService coordinates WIP, SubledgerService owns account entries/settlements, ApprovalService coordinates decisions/audit, and MigrationService commits through domain services. Use Drizzle transactions and explicit PostgreSQL locks; no runtime schema push.

## 22. Testing Requirements

Verify tenant/cross-tenant rejection; tenant uniqueness; complete enum/check values; one-to-one batch/lot inventory identity; approval subject hash/version invalidation; idempotency lease/orphan recovery fields; all contracted decimal scales and rejection of floating-point business fields; `EGP` snapshots; `ROUND_HALF_UP` posting boundaries; deterministic discount residual/tie handling; line/document total invariants; payment direction/entry/settlement constraints; import states; date-only round-trip; Cairo default/tenant override; immutability; historical metadata/lock; rejection of `approved_after_import_review`; support for `return_from_wip` and sales `approval_failed`; reason-based reservation failure metadata; replacement links/value caps; profitability versions; master inactivation; critical indexes/FKs; and clean migration application to empty/representative test databases.

## 23. Common Failure Cases

Missing tenant constraints; floating-point stock/money/calculations; early rounding; non-deterministic discount residual; document total calculated independently from stored posted lines; unconstrained statuses; `allowed_negative_flag`; universal auto-release after approval failure; one input only on production header; one profitability row per sale; imported special status; in-place posted edits; destructive cascades; missing import metadata; timestamp/date shifts; worker financial fields; preview/runtime schema mutation.

## 24. Acceptance Criteria

- Every required domain has tenant-safe structures.
- Statuses and owner clarifications replace old draft contradictions.
- Precision/date/timezone rules are explicit.
- Immutable/historical records are protected.
- Inventory, WIP, approval, subledger, profitability, audit and migration contracts can reference stable structures.
- Indexes/uniqueness support queues and idempotency.
- No schema choice exposes worker financial data.

## 25. Notes for AI Coding Agents

Read upstream contracts before Drizzle/migration work. V4 is a draft, not executable SQL. Never simplify many-to-many production, snapshots, tenancy or immutability. Generate migrations only in an authorized package. If a relationship/type is unclear, write: **Unresolved / requires owner decision**.
