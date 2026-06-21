# Final Revised Implementation Plan v4

## Specialized Yarn Trading & Outsourced Manufacturing ERP

### نظام إدارة تجارة وتشغيل الغزل لدى الغير

---

## 1. Executive Summary

This v4 plan converts the previous ERP implementation plan into an execution-safe implementation document.

The ERP is for a specific yarn trading and outsourced manufacturing client, not a generic ERP. The system must support:

* raw material batch tracking
* single yarn production at external factories
* twisted yarn production at external factories
* external factories as inventory locations
* multi-location stock
* sales approval and reservation
* customer, supplier, and factory balances
* optional direct costs such as transport
* quality, complaints, and returns
* historical migration from messy historical sources
* deterministic approximate profitability
* audit, approval, backup, rollback, and correction workflows

The MVP is a **single-client ERP implementation with future-ready architecture**. It is not a fully configurable SaaS ERP product from day one.

The plan intentionally reduces dangerous runtime configurability. Current-client rules are fixed during setup or stored as restricted internal settings. Transaction snapshots are mandatory so approved records are not silently changed by later setting changes.

The largest v4 corrections are:

1. Real schema draft instead of table names only.
2. Immutable inventory ledger with materialized balances.
3. Reserved stock model for pending sales.
4. Production/WIP posting model that avoids double-counting.
5. Atomic transaction contracts for approvals, reversals, payments, production, returns, and historical import.
6. Reliable operational subledger for customer/supplier/factory balances.
7. Internal separation between cost responsibility and actual payment.
8. Deterministic approximate profitability snapshots.
9. Historical migration as a staged, validated, reconciled, human-approved process.
10. Earlier backup/restore safeguard before pilot or real data entry.
11. Role and field-level permission matrix.
12. Phase-specific tests, rollback notes, and pilot/go-live safety.

---

## 2. Final Scope

### 2.1 MVP Scope

The MVP must implement:

1. Authentication and role-based access.
2. Arabic-first RTL interface.
3. Tenant foundation, even if only one tenant is active.
4. Users, roles, and permissions.
5. Master data:

   * suppliers
   * customers
   * locations
   * external factories
   * fiber/product types
   * quality parameters
6. Raw material batches / رسائل خام.
7. Yarn lots:

   * single yarn lots
   * twisted yarn lots
8. Multi-location inventory.
9. External factories as both service providers and inventory locations.
10. Immutable stock movement ledger.
11. Materialized inventory balances.
12. Sales request, reservation, and approval.
13. Customer account entries and payments.
14. Supplier account entries and payments.
15. Factory account entries and payments.
16. Outsourced single yarn production.
17. Outsourced twisting production.
18. Production WIP tracking.
19. Input-based factory cost for the current client.
20. Factory rate confirmation and transaction snapshot.
21. Optional transport/direct cost handling.
22. Quality tests.
23. Complaints.
24. Returns and return approval.
25. Approval Center.
26. Audit log.
27. Internal document numbering.
28. Thin traceability from early phases and full traceability later.
29. Historical migration strategy with staging, validation, reconciliation, and approval.
30. Imported Historical Cost Preservation.
31. Reports and deterministic approximate profitability.
32. Manual backup and restore test before pilot.
33. Demo, limited pilot, parallel run, and go-live checklist.

### 2.2 Technical Direction

Recommended MVP stack:

```text
Frontend: Next.js / React
Backend: Next.js API routes or equivalent modular backend layer
Database: PostgreSQL or PostgreSQL-compatible managed database
Auth: Supabase Auth or equivalent
Storage: Cloud object storage
Deployment: Free-tier or low-cost cloud for demo/pilot only
Architecture style: Modular monolith
```

Alternative stacks are allowed only if they preserve:

* relational database
* transactions
* migrations
* environment variables
* auth
* role permissions
* storage
* backup strategy
* production upgrade path

---

## 3. Non-Goals

Do not implement in MVP:

* full accounting ledger
* full tax compliance automation
* advanced official invoicing compliance
* payroll
* HR
* barcode/QR scanning
* mobile app
* OCR
* AI assistant inside the ERP
* customer portal
* supplier/factory portal
* advanced production planning
* bale-level tracking
* multi-currency
* complex overhead allocation
* full accurate cost accounting
* full dynamic business rule engine
* user-editable profitability formulas
* user-editable factory cost formula engine
* multi-tenant SaaS admin panel
* arbitrary client plugin system
* automatic historical recalculation
* direct editing of approved historical records
* unsafe deletion of audit logs to survive free-tier limits

---

## 4. Binding Decisions

### 4.1 Cloud-First

The ERP is cloud-first. Local/offline deployment is not part of MVP.

### 4.2 Free-Tier Is Validation Only

Free-tier hosting may be used for development, demo, workflow validation, and limited pilot.

Free-tier must not be treated as final production hosting.

Before real production usage:

* upgrade database plan
* enable reliable backups
* verify restore
* configure monitoring
* define storage retention
* freeze migration batch
* run full regression
* run parallel Excel reconciliation
* approve go-live

### 4.3 Modular Monolith

Use a modular monolith. Do not split into microservices in MVP.

### 4.4 PostgreSQL

Use PostgreSQL or PostgreSQL-compatible managed database.

### 4.5 External Factories Are Inventory Locations

Each external factory must have an associated inventory location because company-owned stock can physically remain there.

### 4.6 Traceability First

The ERP must answer:

```text
Where did this material come from?
Where did it go?
What was produced from it?
Who bought it?
Did it cause quality, return, complaint, or financial problems?
```

### 4.7 Current Client Factory Cost Rule

For new live production transactions:

```text
factory_cost = input_quantity_kg / 1000 × confirmed_factory_rate_per_input_ton
```

Waste must not reduce factory payable for the current client.

### 4.8 Transaction Snapshots

Every approved transaction affected by business settings must store the rule values used at approval/posting time.

### 4.9 Historical Data Is Approved Through Import Batch

Historical imported records do not go through normal daily approval one by one.

They become approved only after:

```text
staging → validation → reconciliation → human review → owner/accountant approval → commit
```

### 4.10 Historical Records Are Locked

Historical imported records must not be directly edited after commit.

Corrections happen only through:

* correction request
* reversal
* adjustment
* linked correction record
* audit log

### 4.11 Costs and Payments Are Separate

The system must separate:

```text
cost creation
payment
settlement
balance impact
```

A cost can exist without payment.

### 4.12 Worker UX Must Stay Simple

Warehouse, production, and quality employees must not see or manage financial/accounting complexity.

---

## 5. Configurability Scope Reduction

### 5.1 Final MVP Position

The MVP is:

```text
single-client implementation + future-ready architecture
```

It is not:

```text
fully configurable ERP product from day one
```

### 5.2 Level 1 — Safe MVP UI Settings

These can exist in MVP UI:

* company profile
* users
* roles
* permissions
* suppliers
* customers
* locations
* external factories
* fiber/product types
* quality parameters
* basic terminology labels
* document numbering prefixes if safe
* manual backup trigger
* backup frequency display/config if technically supported

### 5.3 Level 2 — Restricted Business Settings

These may exist internally, setup-time, or read-only:

* current factory cost basis
* default factory rate
* default transport responsibility
* profitability profile
* transport inclusion in profitability
* approval thresholds
* backup policy details

Changes require controlled technical/admin process and audit.

### 5.4 Level 3 — Deferred Productization

Defer these:

* runtime factory cost basis change after live transactions
* dynamic profitability formulas
* arbitrary rule engine
* user-defined financial logic
* effective-dated rules per factory/product/client
* automatic recalculation of approved records
* configurable accounting logic

### 5.5 Required Snapshot Fields

Production orders must snapshot:

```text
factory_cost_basis_used
factory_rate_per_ton_used
input_quantity_cost_basis_kg
output_quantity_kg
calculated_factory_cost
calculation_version
confirmed_by
confirmed_at
```

Sales profitability snapshots must store:

```text
profitability_profile_version
raw_cost_snapshot
single_production_cost_snapshot
twisting_cost_snapshot
transport_cost_snapshot
discount_snapshot
return_impact_snapshot
missing_cost_flags
calculated_at
```

Direct costs must snapshot:

```text
cost_responsibility_type
actual_payer_type
included_in_profitability
review_status
```

---

## 6. Worker Data-Entry UX Simplification

### 6.1 Principle

Worker screens collect operational facts, not accounting interpretations.

### 6.2 Hidden From Workers

Warehouse, production, and quality roles must not see:

* profitability
* cost allocation
* receivables
* payables
* actual payer
* settlements
* payment matching
* financial reconciliation
* profitability profiles
* formula versions
* accounting adjustments
* supplier/factory/customer balance reports

### 6.3 Worker Screens Should Show

* Arabic-first labels
* required operational fields only
* simple item/location selectors
* quantity/date/status
* clear validation
* “unknown”
* “included elsewhere”
* “needs accountant review”
* optional transport amount if known
* operational notes
* no cost/profit reports

### 6.4 Accountant/Owner Screens Handle

* price/cost review
* actual payer
* payable/receivable impact
* settlement
* profitability inclusion
* corrections
* reversal approval
* migration approval
* backup/restore
* audit review

### 6.5 Safe Save Rule

If a worker enters incomplete financial-adjacent data, save the operational record when inventory correctness is not endangered, then route financial completion to Accountant Review.

Example:

```text
Warehouse employee records transfer.
Transport amount is unknown.
Transfer can be saved.
direct_cost_review_status = needs_accountant_review.
No payable/receivable is posted until accountant completes it.
```

---

## 7. Architecture Overview

### 7.1 Layers

```text
UI Layer
  ↓
API / Controller Layer
  ↓
Permission Guard
  ↓
Application Services
  ↓
Domain Services
  ↓
Repository / Transaction Layer
  ↓
PostgreSQL
```

### 7.2 Rule

No high-risk business logic is allowed only in the frontend.

High-risk actions must go through backend services with:

* permission check
* validation
* state preconditions
* database transaction
* row locks where needed
* idempotency key
* audit log
* clear failure result

### 7.3 Core Services

Required services:

```text
AuthService
PermissionService
DocumentNumberService
ApprovalService
AuditService
InventoryLedgerService
InventoryBalanceService
ReservationService
ProductionPostingService
SalesApprovalService
ReturnApprovalService
PaymentService
SubledgerService
DirectCostService
ProfitabilitySnapshotService
MigrationService
BackupService
TraceabilityService
ReportService
```

### 7.4 Tenant Rule

Every tenant-owned table must include:

```text
tenant_id NOT NULL
```

Every query must filter by tenant_id unless the table is global reference data.

MVP may have one tenant, but schema must not block future multi-client support.

---

## 8. Module Boundaries

### 8.1 Auth, Users, Roles, Permissions

Owns:

* users
* roles
* permissions
* role assignments
* API permission checks
* field visibility

Must not own:

* financial logic
* stock posting
* production posting

### 8.2 Tenant and Settings

Owns:

* tenant profile
* setup-time business settings
* restricted settings
* terminology map
* document numbering configuration

Dangerous settings are read-only or internal in MVP.

### 8.3 Master Data

Owns:

* suppliers
* customers
* locations
* external factories
* fiber types
* product types
* quality parameters

### 8.4 Inventory

Owns:

* inventory items
* raw batch stock
* yarn lot stock
* stock movements
* balances
* reservations
* adjustments
* reversals

### 8.5 Production

Owns:

* production orders
* production inputs
* production outputs
* WIP
* waste
* output lot creation
* factory cost snapshot trigger

Production must call Inventory and Subledger through service contracts, not direct table edits.

### 8.6 Sales

Owns:

* sales requests/orders
* sales lines
* reservation submission
* sales approval transaction
* customer posting trigger
* profitability snapshot trigger

### 8.7 Payments and Subledger

Owns:

* customer/supplier/factory accounts
* immutable account entries
* payments
* settlements
* reversals
* balance views

### 8.8 Direct Costs

Owns:

* transport/direct cost records
* cost responsibility
* actual payer
* accountant review queue
* posting to subledger when completed

### 8.9 Quality

Owns:

* raw material tests
* yarn tests
* quality statuses
* quality-risk flags

### 8.10 Complaints and Returns

Owns:

* complaints
* investigation
* return requests
* return approval
* return stock posting
* customer financial impact

### 8.11 Historical Migration

Owns:

* import batches
* files
* template versions
* staging rows
* validation errors/warnings
* reconciliation summaries
* import approval
* historical locking metadata

Migration must not bypass domain services during commit.

### 8.12 Backup and Restore

Owns:

* backup runs
* restore test logs
* backup status
* file/import backup evidence
* limitations documentation

---

## 9. Role and Permission Matrix

Legend:

```text
V = view
C = create
U = update before approval
A = approve
X = cancel
R = reverse/correct
E = export
P = view price
K = view cost
F = view profitability
L = view audit log
M = manage settings/users/migration/backup
- = not allowed
```

| Area / Action                  |     Owner |              Accountant |                      Warehouse |              Production |                        Quality |
| ------------------------------ | --------: | ----------------------: | -----------------------------: | ----------------------: | -----------------------------: |
| Dashboard                      |       V/F |                     V/F |               operational only |        operational only |                   quality only |
| Users/roles                    |         M |               V limited |                              - |                       - |                              - |
| Permissions                    |         M |                       - |                              - |                       - |                              - |
| Suppliers                      |     V/C/U |                   V/C/U |                   V names only |            V names only |                   V names only |
| Customers                      |     V/C/U |                   V/C/U |                   V names only |                       - |                   V names only |
| Locations                      |     V/C/U |                   V/C/U |                              V |                       V |                              V |
| External factories             |     V/C/U |                   V/C/U |                              V |                       V |                              V |
| Raw material batch             | V/C/U/A/R |               V/C/U/A/R |      V/C/U own before approval |               V limited |                  V for quality |
| Raw purchase price             |       P/K |                     P/K |                              - |                       - |                              - |
| Raw receipt approval           |         A |                       A |                              - |                       - |                              - |
| Stock transfer                 | V/C/U/A/R |               V/C/U/A/R |        C/U own before approval | C if production-related |                              - |
| Inventory adjustment           |   V/C/A/R |                 V/C/A/R |                 C request only |          C request only |                              - |
| Stock balances qty             |         V |                       V |                              V |  V production locations |              V quality-related |
| Stock value                    |         V |                       V |                              - |                       - |                              - |
| Sales request                  | V/C/U/A/R |               V/C/U/A/R | C request if allowed, no price |                       - |          V quality status only |
| Sales price                    |         P |                       P |                              - |                       - |                              - |
| Sales approval                 |         A |                       A |                              - |                       - |      quality-risk comment only |
| Customer balances              |         V |                       V |                              - |                       - |                              - |
| Production order               | V/C/U/A/R |               V/C/U/A/R |         V stock movements only | C/U own before approval |                      V quality |
| Factory rate/cost              |         K |                       K |                              - |                       - |                              - |
| Factory payable                |     V/A/R |                   V/A/R |                              - |                       - |                              - |
| Payments                       |   V/C/A/R |                 V/C/A/R |                              - |                       - |                              - |
| Supplier/factory balances      |         V |                       V |                              - |                       - |                              - |
| Transport amount if known      |         V |                   V/C/U |              C optional simple |       C optional simple |                              - |
| Transport financial allocation |     V/A/R |                   V/A/R |                              - |                       - |                              - |
| Quality tests                  |     V/A/R |                       V |                  V read status |           V read status |                      V/C/U own |
| Quality-risk sale approval     |         A |                       A |                              - |                       - |                C investigation |
| Complaints                     |     V/A/R |                   V/A/R |                      V limited |               V limited |            V/C/U investigation |
| Returns                        |   V/C/A/R |                 V/C/A/R |       C receive returned stock |                       - |             V/C quality review |
| Profitability                  |         F |                       F |                              - |                       - |                              - |
| Audit logs                     |         L | L financial/operational |                              - |                       - |                              - |
| Historical migration           |         M |                       M |                              - |                       - | V quality mapping if requested |
| Backup                         |         M |            M run/status |                              - |                       - |                              - |
| Export Excel/PDF               |         E |                       E |                              - |                       - |                              - |
| Settings                       |         M |  V/read-only restricted |                              - |                       - |                              - |

### 9.1 Field-Level Rules

Workers must not receive restricted fields from the API response.

Do not only hide fields in UI.

Restricted fields include:

```text
purchase_price_per_ton
total_purchase_cost
factory_rate_per_ton
factory_cost
transport_financial_allocation
customer_balance
supplier_balance
factory_balance
profit_amount
profit_margin
profitability_profile_version
account_entries
settlement_entries
```

---

## 10. Database Schema Draft

This is a schema draft, not final SQL. It is detailed enough to stop an AI coding agent from inventing unsafe structures.

### 10.1 Global Rules

Every tenant-owned table must include:

```text
id UUID PRIMARY KEY
tenant_id UUID NOT NULL REFERENCES tenants(id)
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
created_by UUID REFERENCES users(id)
updated_at TIMESTAMPTZ
updated_by UUID REFERENCES users(id)
deleted_at TIMESTAMPTZ NULL
deleted_by UUID NULL
```

Approved business documents must also include:

```text
doc_no TEXT NOT NULL
status TEXT NOT NULL
approval_status TEXT NOT NULL
record_origin TEXT NOT NULL
record_period TEXT NOT NULL
is_locked BOOLEAN NOT NULL DEFAULT false
import_batch_id UUID NULL
reversal_of_id UUID NULL
correction_of_id UUID NULL
```

Document numbers are immutable after creation.

Soft deletion is allowed only for drafts. Approved records must be cancelled, reversed, or corrected.

### 10.2 Core Enums

Implement as PostgreSQL enums or check constraints.

```text
role_code:
owner, accountant, warehouse_employee, production_employee, quality_employee

approval_status:
draft, pending_daily_approval, pending_approval, approved, rejected, cancelled, reversed

record_origin:
manual_live, excel_import, ai_assisted_import, manual_historical_entry, system_generated

record_period:
live, historical

item_kind:
raw_material, single_yarn, twisted_yarn

location_type:
internal_warehouse, port_warehouse, external_single_factory, external_twisting_factory,
in_transit, returned_stock, temporary, wip_virtual

movement_type:
raw_receipt, transfer, issue_to_production, receive_from_production,
production_waste, sale_issue, return_receipt, inventory_adjustment,
stock_block, stock_unblock, reversal, correction

movement_status:
draft, pending_approval, posted, cancelled, reversed

reservation_status:
active, approved_consumed, released, expired, failed

production_type:
single_yarn, twisted_yarn

production_status:
draft, material_issued, partially_received, completed, cancelled, correction_requested, reversed

quality_status:
accepted, needs_review, rejected, blocked

sale_status:
draft, pending_approval, approved, rejected, cancelled, reversed, partially_returned, fully_returned

return_status:
draft, pending_approval, approved, rejected, cancelled, reversed

payment_status:
draft, posted, reversed, cancelled

account_owner_type:
customer, supplier, factory

direct_cost_type:
transport, loading, unloading, customs, other

cost_responsibility_type:
company, customer, factory, shared, other, unknown, included_elsewhere, needs_accountant_review

actual_payer_type:
company, customer, factory, other, unknown, not_recorded

review_status:
not_required, needs_accountant_review, reviewed, approved, rejected

historical_cost_basis_source:
imported_excel, input_based, output_based, manual, unknown
```

### 10.3 Platform Tables

#### tenants

```text
id
company_name
default_language
currency
timezone
status
```

Constraints:

```text
UNIQUE(company_name)
```

#### users

```text
id
tenant_id
name
email
phone
status
language_preference
last_login_at
```

Constraints:

```text
UNIQUE(tenant_id, email)
```

Indexes:

```text
tenant_id, status
```

#### roles

```text
id
tenant_id
role_code
name_ar
name_en
is_system_role
```

Constraints:

```text
UNIQUE(tenant_id, role_code)
```

#### permissions

```text
id
permission_key
module
action
field_key nullable
description
```

#### user_roles

```text
user_id
role_id
tenant_id
```

Constraints:

```text
PRIMARY KEY(user_id, role_id)
```

#### role_permissions

```text
role_id
permission_id
tenant_id
```

Constraints:

```text
PRIMARY KEY(role_id, permission_id)
```

#### tenant_settings

```text
id
tenant_id
setting_key
setting_value_json
setting_level
is_runtime_editable
is_sensitive
effective_from
changed_by
changed_reason
```

Constraints:

```text
UNIQUE(tenant_id, setting_key, effective_from)
CHECK(setting_level IN ('safe_ui','restricted_setup','deferred_productization'))
```

#### terminology_labels

```text
id
tenant_id
label_key
module
default_ar_label
source_ar_alias
en_label
is_user_editable_mvp
notes
```

Constraints:

```text
UNIQUE(tenant_id, label_key)
```

Frontend caching rule:

```text
Fetch once at login/app startup.
Cache in app context.
Refresh only after terminology version changes.
```

#### document_sequences

```text
id
tenant_id
document_type
year
prefix
last_number
updated_at
```

Constraints:

```text
UNIQUE(tenant_id, document_type, year)
```

Generation rule:

```text
SELECT sequence row FOR UPDATE
increment last_number
generate doc_no
commit with business transaction
```

#### approval_requests

```text
id
tenant_id
request_type
entity_type
entity_id
risk_level
requested_by
requested_at
reason
status
approved_by
approved_at
rejected_by
rejected_at
decision_notes
idempotency_key
```

Constraints:

```text
UNIQUE(tenant_id, request_type, entity_type, entity_id, status)
UNIQUE(tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL
```

#### audit_logs

```text
id
tenant_id
user_id
entity_type
entity_id
action_type
old_values_json
new_values_json
reason
approval_request_id
idempotency_key
ip_address
device_info
created_at
```

Rules:

* append-only
* no update/delete by app users
* written inside same transaction as business change
* restricted visibility

### 10.4 Master Data Tables

#### suppliers

```text
id
tenant_id
supplier_code
name_ar
name_en
normalized_name
contact_info_json
status
notes
```

Constraints:

```text
UNIQUE(tenant_id, supplier_code)
UNIQUE(tenant_id, normalized_name)
```

#### customers

```text
id
tenant_id
customer_code
name_ar
name_en
normalized_name
contact_info_json
credit_limit nullable
credit_terms nullable
status
notes
```

Constraints:

```text
UNIQUE(tenant_id, customer_code)
UNIQUE(tenant_id, normalized_name)
```

#### locations

```text
id
tenant_id
location_code
name_ar
name_en
location_type
address
related_factory_id nullable
status
```

Constraints:

```text
UNIQUE(tenant_id, location_code)
UNIQUE(tenant_id, name_ar)
```

#### external_factories

```text
id
tenant_id
factory_code
name_ar
name_en
factory_type
linked_location_id NOT NULL REFERENCES locations(id)
contact_info_json
default_rate_per_input_ton nullable
default_cost_basis restricted default 'input_quantity'
status
notes
```

Constraints:

```text
UNIQUE(tenant_id, factory_code)
UNIQUE(tenant_id, linked_location_id)
CHECK(factory_type IN ('single_yarn','twisting','both'))
```

#### fiber_types / product_types

```text
id
tenant_id
code
name_ar
name_en
status
```

Constraints:

```text
UNIQUE(tenant_id, code)
```

### 10.5 Inventory Core Tables

#### inventory_items

Canonical stock item table.

```text
id
tenant_id
item_kind
item_code
display_name_ar
quality_status
is_blocked
status
```

Constraints:

```text
UNIQUE(tenant_id, item_kind, item_code)
```

Indexes:

```text
tenant_id, item_kind
tenant_id, quality_status
tenant_id, is_blocked
```

#### raw_material_batches

```text
id
tenant_id
item_id NOT NULL UNIQUE REFERENCES inventory_items(id)
batch_no
supplier_id REFERENCES suppliers(id)
supplier_reference nullable
fiber_type_id REFERENCES fiber_types(id)
origin_country nullable
season nullable
bales_count numeric nullable
gross_weight_kg numeric
net_weight_kg numeric
purchase_price_per_ton nullable
total_purchase_cost nullable
received_date
status
approval_status
record_origin
record_period
is_locked
import_batch_id nullable
```

Constraints:

```text
UNIQUE(tenant_id, batch_no)
CHECK(net_weight_kg >= 0)
CHECK(gross_weight_kg IS NULL OR gross_weight_kg >= net_weight_kg)
```

#### yarn_lots

```text
id
tenant_id
item_id NOT NULL UNIQUE REFERENCES inventory_items(id)
lot_no
lot_type
yarn_count
twist_factor nullable
twists_per_meter nullable
factory_id REFERENCES external_factories(id)
production_order_id nullable REFERENCES production_orders(id)
production_date nullable
input_quantity_kg nullable
output_quantity_kg nullable
waste_quantity_kg nullable
waste_percent nullable
quality_status
status
approval_status
record_origin
record_period
is_locked
import_batch_id nullable
```

Constraints:

```text
UNIQUE(tenant_id, lot_type, lot_no)
CHECK(lot_type IN ('single_yarn','twisted_yarn'))
CHECK(output_quantity_kg IS NULL OR output_quantity_kg >= 0)
CHECK(waste_quantity_kg IS NULL OR waste_quantity_kg >= 0)
```

#### inventory_balances

Materialized stock balance per item/location.

```text
id
tenant_id
item_id REFERENCES inventory_items(id)
location_id REFERENCES locations(id)
on_hand_qty_kg numeric NOT NULL DEFAULT 0
reserved_qty_kg numeric NOT NULL DEFAULT 0
blocked_qty_kg numeric NOT NULL DEFAULT 0
returned_qty_kg numeric NOT NULL DEFAULT 0
last_movement_id nullable REFERENCES stock_movements(id)
version integer NOT NULL DEFAULT 1
updated_at
```

Constraints:

```text
UNIQUE(tenant_id, item_id, location_id)
CHECK(on_hand_qty_kg >= 0 unless allowed_negative_flag = true)
CHECK(reserved_qty_kg >= 0)
CHECK(blocked_qty_kg >= 0)
CHECK(returned_qty_kg >= 0)
CHECK(reserved_qty_kg <= on_hand_qty_kg)
CHECK(blocked_qty_kg <= on_hand_qty_kg)
```

Indexes:

```text
tenant_id, item_id
tenant_id, location_id
tenant_id, item_id, location_id
```

Available quantity is computed:

```text
available_qty_kg = on_hand_qty_kg - reserved_qty_kg - blocked_qty_kg
```

#### stock_movements

Immutable source of truth for posted stock movements.

```text
id
tenant_id
doc_no
movement_type
movement_status
item_id REFERENCES inventory_items(id)
from_location_id nullable REFERENCES locations(id)
to_location_id nullable REFERENCES locations(id)
quantity_kg
movement_date
source_document_type
source_document_id
approval_request_id nullable
reversal_of_movement_id nullable REFERENCES stock_movements(id)
idempotency_key
record_origin
record_period
import_batch_id nullable
notes
created_by
posted_by
posted_at
```

Constraints:

```text
UNIQUE(tenant_id, doc_no)
UNIQUE(tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL
CHECK(quantity_kg > 0)
CHECK(from_location_id IS NOT NULL OR to_location_id IS NOT NULL)
CHECK(from_location_id IS DISTINCT FROM to_location_id)
```

Immutability rule:

* posted movement rows are not updated except technical metadata
* corrections use reversal/correction movement

#### stock_reservations

```text
id
tenant_id
reservation_no
item_id REFERENCES inventory_items(id)
location_id REFERENCES locations(id)
quantity_kg
source_type
source_id
sales_order_id nullable
sales_line_id nullable
status
reserved_at
expires_at nullable
released_at nullable
consumed_at nullable
idempotency_key
```

Constraints:

```text
UNIQUE(tenant_id, reservation_no)
UNIQUE(tenant_id, source_type, source_id, item_id, location_id) WHERE status='active'
CHECK(quantity_kg > 0)
```

#### inventory_adjustments

```text
id
tenant_id
doc_no
item_id
location_id
adjustment_type
quantity_kg
reason
status
approval_request_id
posted_movement_id
```

### 10.6 Production Tables

#### production_orders

```text
id
tenant_id
doc_no
production_type
factory_id REFERENCES external_factories(id)
factory_location_id REFERENCES locations(id)
status
approval_status
send_date
receive_date nullable
expected_waste_percent nullable
confirmed_factory_rate_per_ton
factory_cost_basis_used default 'input_quantity'
calculation_version
total_input_qty_kg
total_output_qty_kg
total_waste_qty_kg
calculated_factory_cost
rate_confirmed_by
rate_confirmed_at
record_origin
record_period
import_batch_id nullable
is_locked
```

Constraints:

```text
UNIQUE(tenant_id, doc_no)
CHECK(production_type IN ('single_yarn','twisted_yarn'))
CHECK(total_input_qty_kg IS NULL OR total_input_qty_kg >= 0)
CHECK(total_output_qty_kg IS NULL OR total_output_qty_kg >= 0)
```

#### production_inputs

Many-to-many capable.

```text
id
tenant_id
production_order_id REFERENCES production_orders(id)
input_item_id REFERENCES inventory_items(id)
input_location_id REFERENCES locations(id)
planned_input_qty_kg
issued_qty_kg DEFAULT 0
consumed_qty_kg DEFAULT 0
remaining_wip_qty_kg DEFAULT 0
issue_movement_id nullable REFERENCES stock_movements(id)
```

Constraints:

```text
CHECK(planned_input_qty_kg > 0)
CHECK(issued_qty_kg >= 0)
CHECK(consumed_qty_kg >= 0)
```

#### production_outputs

```text
id
tenant_id
production_order_id REFERENCES production_orders(id)
output_item_id REFERENCES inventory_items(id)
output_lot_id REFERENCES yarn_lots(id)
output_location_id REFERENCES locations(id)
output_qty_kg
receipt_movement_id nullable REFERENCES stock_movements(id)
```

Constraints:

```text
CHECK(output_qty_kg > 0)
```

#### production_wip_balances

```text
id
tenant_id
production_order_id
input_item_id
factory_location_id
wip_qty_kg
updated_at
```

Constraints:

```text
UNIQUE(tenant_id, production_order_id, input_item_id, factory_location_id)
CHECK(wip_qty_kg >= 0)
```

#### production_waste_entries

```text
id
tenant_id
production_order_id
input_item_id
waste_qty_kg
waste_percent
waste_reason nullable
movement_id nullable REFERENCES stock_movements(id)
```

### 10.7 Sales Tables

#### sales_orders

```text
id
tenant_id
doc_no
customer_id REFERENCES customers(id)
sale_status
approval_status
sale_date
total_amount
discount_amount DEFAULT 0
quality_warning_status
reservation_status
payment_status
delivery_status
approved_by
approved_at
record_origin
record_period
import_batch_id nullable
is_locked
```

Constraints:

```text
UNIQUE(tenant_id, doc_no)
CHECK(total_amount >= 0)
```

#### sales_order_lines

```text
id
tenant_id
sales_order_id REFERENCES sales_orders(id)
item_id REFERENCES inventory_items(id)
location_id REFERENCES locations(id)
quantity_kg
price_per_ton
discount_amount DEFAULT 0
line_total
reservation_id nullable REFERENCES stock_reservations(id)
sale_issue_movement_id nullable REFERENCES stock_movements(id)
quality_warning_snapshot_json
```

Constraints:

```text
CHECK(quantity_kg > 0)
CHECK(price_per_ton >= 0)
CHECK(line_total >= 0)
```

#### sales_profitability_snapshots

```text
id
tenant_id
sales_order_id REFERENCES sales_orders(id)
profile_version
raw_cost_snapshot
single_production_cost_snapshot
twisting_cost_snapshot
transport_cost_snapshot
discount_snapshot
return_impact_snapshot
revenue_snapshot
profit_amount
profit_margin_percent
missing_cost_flags_json
calculation_notes
calculated_at
```

Constraints:

```text
UNIQUE(tenant_id, sales_order_id)
```

### 10.8 Payments and Subledger Tables

#### accounts

```text
id
tenant_id
owner_type
owner_id
currency
status
```

Constraints:

```text
UNIQUE(tenant_id, owner_type, owner_id, currency)
```

#### account_entries

Immutable operational subledger.

```text
id
tenant_id
account_id REFERENCES accounts(id)
entry_no
entry_date
amount_signed
currency
entry_type
source_document_type
source_document_id
settlement_status
reversal_of_entry_id nullable REFERENCES account_entries(id)
notes
record_origin
record_period
import_batch_id nullable
created_by
created_at
```

Constraints:

```text
UNIQUE(tenant_id, entry_no)
CHECK(amount_signed <> 0)
```

Sign convention:

```text
Positive amount = party owes company more.
Negative amount = company owes party more or party paid in advance.
```

Examples:

```text
customer sale receivable: +100000
customer payment: -40000
customer advance: -20000
supplier purchase payable: -80000
supplier payment by company: +30000
factory production payable: -150000
factory payment by company: +50000
```

#### payments

```text
id
tenant_id
payment_no
payment_date
account_id REFERENCES accounts(id)
amount
payment_direction
payment_method
status
notes
attachment_file_id nullable
posted_entry_id nullable REFERENCES account_entries(id)
reversal_of_payment_id nullable REFERENCES payments(id)
```

Constraints:

```text
UNIQUE(tenant_id, payment_no)
CHECK(amount > 0)
```

#### payment_settlements

```text
id
tenant_id
payment_entry_id REFERENCES account_entries(id)
settled_entry_id REFERENCES account_entries(id)
settled_amount
created_at
```

Constraints:

```text
CHECK(settled_amount > 0)
```

### 10.9 Direct Cost Tables

#### direct_costs

```text
id
tenant_id
cost_no
cost_type
linked_entity_type
linked_entity_id
amount nullable
currency
cost_responsibility_type
actual_payer_type
included_in_profitability
review_status
notes
created_by
reviewed_by nullable
reviewed_at nullable
```

Constraints:

```text
UNIQUE(tenant_id, cost_no)
CHECK(amount IS NULL OR amount >= 0)
```

#### direct_cost_allocations

```text
id
tenant_id
direct_cost_id REFERENCES direct_costs(id)
responsible_party_type
responsible_party_id nullable
share_amount
share_percent nullable
subledger_entry_id nullable REFERENCES account_entries(id)
```

### 10.10 Quality, Complaints, Returns

#### quality_tests

```text
id
tenant_id
test_no
test_type
item_id REFERENCES inventory_items(id)
related_batch_id nullable
related_lot_id nullable
test_date
overall_status
entered_by
reviewed_by nullable
notes
```

#### quality_test_values

```text
id
tenant_id
quality_test_id REFERENCES quality_tests(id)
parameter_code
parameter_label_ar
value_numeric nullable
value_text nullable
unit nullable
result_status
```

#### complaints

```text
id
tenant_id
complaint_no
customer_id REFERENCES customers(id)
sales_order_id nullable REFERENCES sales_orders(id)
item_id nullable REFERENCES inventory_items(id)
affected_qty_kg nullable
complaint_date
status
reason
investigation_result
responsible_user_id nullable
```

#### return_requests

```text
id
tenant_id
return_no
sales_order_id REFERENCES sales_orders(id)
customer_id REFERENCES customers(id)
return_date
status
approval_status
return_reason
financial_resolution_type
customer_adjustment_amount nullable
approved_by nullable
approved_at nullable
```

#### return_lines

```text
id
tenant_id
return_request_id REFERENCES return_requests(id)
item_id REFERENCES inventory_items(id)
quantity_kg
return_location_id REFERENCES locations(id)
resale_status
quality_status_after_return
return_movement_id nullable REFERENCES stock_movements(id)
```

### 10.11 Historical Migration Tables

#### import_batches

```text
id
tenant_id
batch_no
status
source_description
created_by
created_at
validated_at
reconciled_at
approved_by
approved_at
committed_at
notes
```

#### import_files

```text
id
tenant_id
import_batch_id
original_file_name
storage_path
file_hash
uploaded_by
uploaded_at
```

#### import_template_versions

```text
id
tenant_id
template_name
template_version
schema_json
is_active
created_at
```

#### import_staging_rows

```text
id
tenant_id
import_batch_id
import_file_id
template_name
source_sheet_name
source_row_number
raw_row_json
transformed_row_json
validation_status
review_status
ai_confidence nullable
transformation_notes
```

#### import_staging_cells

```text
id
tenant_id
staging_row_id
source_column
original_cell_value
formula_text nullable
calculated_value nullable
mapped_field
warning_code nullable
```

#### import_validation_errors

```text
id
tenant_id
import_batch_id
staging_row_id nullable
severity
error_code
message
field_name nullable
is_blocking
```

#### import_reconciliation_results

```text
id
tenant_id
import_batch_id
metric_key
expected_value nullable
actual_value
difference_value nullable
status
notes
```

#### import_human_review_items

```text
id
tenant_id
import_batch_id
staging_row_id
review_reason
assigned_to
status
decision
decision_notes
decided_by
decided_at
```

---

## 11. Inventory Ledger and Posting Model

### 11.1 Canonical Model

```text
stock_movements = immutable source of truth
inventory_balances = materialized balance updated transactionally
```

### 11.2 Balance Definitions

```text
on_hand_qty_kg:
  physically available stock at a location, excluding WIP consumed into production

reserved_qty_kg:
  quantity protected for pending sales approval

blocked_qty_kg:
  quantity not available for sale due to quality, complaint, return, or manual block

available_qty_kg:
  on_hand_qty_kg - reserved_qty_kg - blocked_qty_kg

wip_qty_kg:
  quantity issued into a production order and not yet converted to output, waste, or returned

returned_qty_kg:
  quantity received as return and tagged separately for reporting/quality
```

### 11.3 Posting Rules

#### Raw Receipt

```text
to_location += quantity
movement_type = raw_receipt
supplier payable created on approval if price known
```

#### Transfer

MVP one-step:

```text
from_location -= quantity
to_location += quantity
movement_type = transfer
```

Future two-step:

```text
source → in_transit → destination
```

#### Issue to Production

```text
factory/location on_hand -= issued_qty
production_wip += issued_qty
movement_type = issue_to_production
```

#### Receive From Production

```text
production_wip -= consumed_input_qty
output_location on_hand += output_qty
waste posted separately
movement_type = receive_from_production
```

#### Production Waste

```text
production_wip -= waste_qty
movement_type = production_waste
```

#### Sale Approval

```text
reserved_qty -= sale_qty
on_hand_qty -= sale_qty
movement_type = sale_issue
```

#### Return Approval

```text
return_location on_hand += returned_qty
returned_qty += returned_qty
blocked_qty may increase depending on resale_status
movement_type = return_receipt
```

#### Inventory Adjustment

```text
positive adjustment: on_hand += qty
negative adjustment: on_hand -= qty
movement_type = inventory_adjustment
approval required
```

#### Reversal

```text
create opposite stock movement
link reversal_of_movement_id
never edit original movement
```

### 11.4 Negative Stock Behavior

Default:

```text
negative stock is blocked
```

Exception:

* Owner/Accountant can approve a controlled negative adjustment only if marked as historical inconsistency or correction.
* Negative balances must appear in alerts and reconciliation.
* Workers cannot override negative stock.

### 11.5 Concurrency Strategy

For every movement that changes stock:

```text
BEGIN TRANSACTION
SELECT inventory_balances row FOR UPDATE
validate available quantity
insert stock_movement
update inventory_balances
insert audit_log
COMMIT
```

If balance row does not exist:

```text
create row inside transaction with zero quantities
then lock it
```

### 11.6 Idempotency

Every high-risk write endpoint must accept:

```text
Idempotency-Key
```

Duplicate key behavior:

* same payload returns previous success response
* different payload with same key returns conflict
* prevents double approval on retry/double-click

### 11.7 Reconciliation

A reconciliation job/report must compare:

```text
SUM(stock_movements) per item/location
vs
inventory_balances
```

Any mismatch is critical.

---

## 12. Stock Reservation Model

### 12.1 Reservation Timing

Sales drafts do not reserve stock.

When a sales order is submitted for approval:

```text
reservation is created
reserved_qty_kg increases
available_qty_kg decreases
on_hand_qty_kg does not decrease
```

### 12.2 Available-to-Sell

```text
available_to_sell = on_hand_qty_kg - reserved_qty_kg - blocked_qty_kg
```

### 12.3 Reservation Creation Contract

Preconditions:

* sale status = draft
* item exists
* location exists
* item is not blocked unless approval allows quality-risk sale
* available_to_sell >= requested quantity

Transaction:

```text
lock inventory_balances
insert stock_reservations
update inventory_balances.reserved_qty
set sale_status = pending_approval
create approval_request
insert audit_log
```

### 12.4 Approval Recheck

At approval:

```text
lock reservation
lock inventory_balances
verify reservation still active
verify on_hand >= reserved quantity
consume reservation
post sale_issue movement
decrease on_hand and reserved
create customer account entry
create profitability snapshot
approve sale
audit
```

### 12.5 Failure Behavior

If stock is unavailable at approval:

* approval fails safely
* sale remains pending or marked approval_failed
* reservation can be adjusted, released, or re-requested
* audit event is written
* Owner/Accountant sees issue

### 12.6 Cancellation/Release

When a pending sale is cancelled or rejected:

```text
reservation status = released
reserved_qty decreases
sale status = cancelled/rejected
audit log created
```

### 12.7 Override

MVP should avoid negative-stock sales.

If override is required later:

* Owner only
* explicit reason
* audit
* negative stock alert
* no worker override

---

## 13. Production/WIP Posting Model

### 13.1 Production Model

Production is outsourced transformation:

```text
raw material → single yarn
single yarn → twisted yarn
```

External factories are both:

* service providers
* inventory locations

### 13.2 Schema Readiness

The UI may start simple:

```text
one input item → one output lot
```

But schema must support:

* one raw batch split into multiple single yarn lots
* one single yarn lot split into multiple twisted lots
* multiple inputs per production order
* multiple outputs per production order

Do not implement `input_lot_id` directly on production_orders as the only relationship.

### 13.3 Production States

```text
draft
material_issued
partially_received
completed
correction_requested
cancelled
reversed
```

### 13.4 Workflow

#### Step 1 — Material Exists at Factory

If material is not at the factory location:

```text
create transfer movement to factory location first
```

MVP transfer may be one-step.

#### Step 2 — Create Production Order

Worker enters:

* production type
* factory
* input item
* input quantity
* expected output if known
* expected waste if known
* production date
* notes

Worker does not see:

* factory rate
* factory payable
* profitability

Accountant/Owner confirms:

* rate
* cost basis snapshot
* whether direct cost needs review

#### Step 3 — Issue to Production

Transaction:

```text
lock inventory balance at factory location
validate available quantity
create issue_to_production movement
decrease factory on_hand
increase production_wip_balances
update production_inputs.issued_qty
audit
```

#### Step 4 — Receive Output

Transaction:

```text
lock production_wip_balances
lock/create output inventory balance
create output yarn lot if needed
create receive_from_production movement
increase output on_hand
decrease WIP by consumed quantity
create waste movement if waste entered
update production_outputs
update production_order totals/status
create factory payable entry based on input quantity cost basis
audit
```

### 13.5 Partial Production

Partial receipt is allowed.

Example:

```text
Input issued: 5000 kg
First receipt output: 2500 kg
Linked consumed input: 3000 kg
Waste: 500 kg
Remaining WIP: 1500 kg
Production status: partially_received
```

### 13.6 Waste Treatment

For current client:

* factory payable is based on input quantity
* waste does not reduce factory payable
* waste reduces effective profitability because output quantity is lower
* waste must be visible in reports

### 13.7 Remaining Unprocessed Stock

If material remains at factory but not issued to production:

```text
it stays on_hand at factory location
```

If material is issued but not yet output/waste:

```text
it stays in WIP
```

If WIP is returned unprocessed:

```text
create return_from_wip/correction movement
decrease WIP
increase factory on_hand
approval required
```

### 13.8 Factory Rate Selection

MVP rule:

* factory default rate is suggested
* Accountant/Owner confirms rate on production order
* confirmed rate is snapshotted
* changing default rate affects future orders only
* no automatic recalculation of existing orders

Future:

* effective-dated factory rates

### 13.9 Factory Payable

Factory payable is created from approved production posting.

For current client:

```text
factory_payable = confirmed_input_quantity_kg / 1000 × confirmed_factory_rate_per_input_ton
```

Subledger posting:

```text
account owner = factory
amount_signed = negative payable amount
source_document = production_order/production_receipt
```

---

## 14. Approval Transaction Contracts

### 14.1 Common Requirements

Every high-risk approval must:

1. Check permission.
2. Check entity state.
3. Validate input.
4. Start database transaction.
5. Lock affected rows.
6. Re-check business conditions.
7. Write all stock/account changes.
8. Write audit log.
9. Mark approval decision.
10. Commit.
11. Return deterministic response.

No approval is a simple CRUD status update.

### 14.2 Sales Approval

Preconditions:

```text
sales_order.status = pending_approval
reservation.status = active
user role = owner/accountant
```

Writes:

```text
stock_reservation → approved_consumed
inventory_balances.reserved_qty -= qty
inventory_balances.on_hand_qty -= qty
stock_movements sale_issue
account_entries customer receivable
sales_profitability_snapshots
sales_order.status = approved
approval_request.status = approved
audit_logs
```

Locks:

```text
sales_order
sales_order_lines
stock_reservations
inventory_balances
customer account
document sequence if needed
```

Failure:

* if reservation missing or stock invalid, rollback
* no partial approval unless explicitly implemented later

### 14.3 Return Approval

Preconditions:

```text
return.status = pending_approval
related sale approved
returned qty <= sold qty - previously returned qty
```

Writes:

```text
stock_movement return_receipt
inventory_balances.on_hand += qty
inventory_balances.returned_qty += qty
blocked_qty += qty if quality review required
customer account adjustment if refund/credit
return.status = approved
audit_logs
```

### 14.4 Inventory Adjustment Approval

Preconditions:

```text
adjustment.status = pending_approval
reason provided
```

Writes:

```text
stock_movement inventory_adjustment
inventory_balances changed
adjustment.status = approved
audit_logs
```

Negative adjustment requires available quantity unless Owner override.

### 14.5 Production Receipt Approval

Preconditions:

```text
production_order in material_issued or partially_received
WIP sufficient
factory rate confirmed
output quantity > 0
```

Writes:

```text
output yarn lot if new
stock_movement receive_from_production
stock_movement production_waste if waste > 0
production_wip_balances decrease
inventory_balances output increase
factory account payable
production_order totals/status
audit_logs
```

### 14.6 Payment Reversal

Preconditions:

```text
payment.status = posted
not already reversed
user role owner/accountant
reason required
```

Writes:

```text
new account_entry opposite sign
payment.status = reversed
reverse settlement links or create reversal settlement records
audit_logs
```

No deletion of original payment.

### 14.7 Post-Approval Correction

Preconditions:

```text
original document approved/posted
correction request created
owner/accountant approval required
reason required
```

Writes:

```text
correction_request approved
reversal or adjustment depending document type
new corrected document if needed
link correction_of_id
audit_logs
```

### 14.8 Historical Import Commit

Preconditions:

```text
import_batch.status = reconciled
no blocking validation errors
warnings explicitly accepted
owner/accountant approval
backup exists or backup waiver documented for demo only
```

Writes:

```text
operational records with record_period = historical
record_origin = excel_import / ai_assisted_import / manual_historical_entry
approval_status = approved_after_import_review
is_locked = true
import metadata on each record
stock movements
account entries
audit_logs
import_batch.status = committed
```

### 14.9 Stock Movement Reversal

Preconditions:

```text
movement.status = posted
not already reversed
dependent documents checked
reason required
```

Writes:

```text
opposite stock movement
balance updates
movement.status remains posted
new movement links reversal_of_movement_id
audit log
```

---

## 15. Subledger and Balance Rules

### 15.1 Scope

This is not full accounting.

It is an operational subledger for:

* customer balances
* supplier balances
* factory balances

### 15.2 Account Entry Rule

Account entries are immutable.

Never edit posted entries.

Corrections require reversal entries.

### 15.3 Sign Convention

From company perspective:

```text
positive = party owes company more
negative = company owes party more / party has credit
```

Examples:

| Event                                                        |    Party |                                 amount_signed |
| ------------------------------------------------------------ | -------: | --------------------------------------------: |
| Sale to customer                                             | Customer |                                             + |
| Customer payment                                             | Customer |                                             - |
| Customer advance                                             | Customer |                                             - |
| Return credit                                                | Customer |                                             - |
| Supplier purchase payable                                    | Supplier |                                             - |
| Supplier payment                                             | Supplier |                                             + |
| Factory production payable                                   |  Factory |                                             - |
| Factory payment                                              |  Factory |                                             + |
| Customer-borne transport receivable                          | Customer |                                             + |
| Company pays factory-borne transport to recover from factory |  Factory | + or deduction according to accountant review |

### 15.4 Balance View

```sql
SELECT account_id, SUM(amount_signed) AS balance
FROM account_entries
WHERE tenant_id = :tenant_id
GROUP BY account_id;
```

Interpretation:

```text
balance > 0: party owes company
balance < 0: company owes party
balance = 0: settled
```

### 15.5 Partial Payments

Payment creates one account entry.

Settlement table links payment entry to one or more receivable/payable entries.

### 15.6 Advance Payments

Advance payment is allowed without related sale.

It creates account credit.

Later sale settlement can allocate the advance.

### 15.7 Supplier Payable on Raw Receipt

Raw material receipt approval must create supplier payable if purchase amount is known.

Transaction:

```text
approve raw receipt
post stock movement
create supplier account entry
audit
```

If price is missing:

```text
stock can be approved if quantity safe
supplier payable review_status = needs_accountant_review
accountant completes price later through controlled correction
```

### 15.8 Factory Payable

Production receipt approval creates factory payable using snapshotted input-based cost.

### 15.9 Reconciliation Reports

Required reports:

* customer balance by account
* supplier payable aging
* factory payable aging
* unsettled payments
* advance payments
* entries without settlement
* account entries by source document
* historical imported balances vs reconciliation totals

---

## 16. Direct Costs and Transport Rules

### 16.1 Principle

Transport is optional in MVP.

Transport must not block operational stock movement if unknown.

### 16.2 Internal Separation

Direct cost must separate:

```text
who should bear the cost
who actually paid
whether it creates receivable/payable
whether it affects profitability
```

### 16.3 Worker-Facing Fields

Workers may see only:

```text
transport amount if known
responsibility simple choice:
  company
  customer
  factory
  shared
  unknown
  included elsewhere
  needs accountant review
notes
```

Workers must not see:

* actual payer accounting impact
* receivable/payable posting
* settlement
* profitability inclusion

### 16.4 Accountant Fields

Accountant/Owner manages:

```text
actual_payer_type
responsible_party
allocation shares
subledger impact
profitability inclusion
settlement
correction/reversal
```

### 16.5 MVP Posting Scenarios

#### Company-borne

```text
cost responsibility = company
actual payer = company or unknown
no receivable/payable unless unpaid supplier/vendor tracked
included in profitability if enabled
```

#### Customer-borne

```text
cost responsibility = customer
creates customer receivable if amount confirmed
included in profitability according to profile
```

#### Factory-borne

```text
cost responsibility = factory
may create factory receivable/deduction after accountant review
```

#### Shared

```text
requires allocations totaling 100% or total amount
accountant review required
```

#### Unknown / Included Elsewhere

```text
no financial posting
review_status = needs_accountant_review or not_required
```

### 16.6 Safety Rule

No direct cost creates subledger entries until reviewed by Accountant/Owner unless it is a simple company-borne cost with confirmed amount and approved configuration.

---

## 17. Profitability Rules and Snapshot Strategy

### 17.1 Scope

MVP profitability is approximate, not full cost accounting.

But it must be deterministic.

### 17.2 Default Formula

```text
profit =
sales_revenue
- raw_material_cost
- single_yarn_production_cost
- twisting_cost
- transport_cost_if_entered_and_enabled
- discounts
- return_impact
```

### 17.3 Raw Cost Per Kg

For raw material:

```text
raw_cost_per_kg = total_purchase_cost / net_weight_kg
```

If missing:

```text
missing_raw_cost = true
profitability_snapshot.status = incomplete_cost
```

### 17.4 Production Cost Allocation

For produced yarn:

```text
input_raw_cost_total = consumed_input_qty × source_effective_cost_per_kg
factory_cost = input_qty / 1000 × confirmed_rate
output_effective_cost_per_kg =
  (input_raw_cost_total + factory_cost + included_direct_costs)
  / output_qty
```

Waste effect:

* waste is not separately charged to factory payable
* waste increases output effective cost per kg because output quantity is lower

### 17.5 Twisting Cost

Twisting uses same structure:

```text
single_yarn_input_cost + twisting_factory_cost + included_direct_costs
```

### 17.6 Discounts

Discounts reduce revenue in snapshot.

### 17.7 Returns

Return impact can be:

```text
refund
credit
replacement
returned stock value adjustment
```

MVP may use simple return impact:

```text
return_impact = customer_credit_or_refund_amount
```

Returned inventory costing can remain approximate unless production readiness requires more precision.

### 17.8 Transport Inclusion

Transport included only if:

```text
amount confirmed
included_in_profitability = true
review_status = reviewed/approved
```

### 17.9 Snapshot Timing

Create or update snapshot at:

* sale approval
* return approval if return affects sale
* accountant-triggered recalculation for incomplete cost before final reporting

Approved historical snapshots must not be silently recalculated.

### 17.10 Display

Reports must show:

```text
profile/version used
calculation date
included components
missing cost flags
approximate label
```

---

## 18. Historical Migration Strategy

### 18.1 Final Principle

The current Excel workbook is a messy candidate source and migration risk example.

It is not the permanent official import schema.

### 18.2 Preferred Flow

```text
messy historical sources
→ optional AI-assisted transformation
→ normalized historical import templates
→ upload to ERP
→ staging
→ validation
→ reconciliation
→ human review
→ owner/accountant approval
→ approved historical import commit
→ records locked
→ corrections only through reversal/adjustment
```

### 18.3 Track 1 — Normalized Historical Import Templates

Define clean target templates matching ERP schema.

Minimum templates:

* suppliers
* customers
* locations
* external factories
* raw material batches
* single yarn lots
* twisted yarn lots
* opening balances
* inventory movements
* raw material purchases/receipts
* single yarn production records
* twisting production records
* sales
* customer payments
* supplier payments
* factory payments
* quality records
* complaints
* returns
* direct costs if available

These templates are the target import structure, not proof that historical source files are clean.

### 18.4 Track 2 — Optional AI-Assisted Transformation

AI may assist with:

* table region detection
* column mapping
* candidate row extraction
* supplier/customer/factory/location detection
* duplicate and alias suggestions
* formula detection
* calculated value extraction
* date normalization
* Arabic terminology normalization
* suspicious row detection
* draft normalized templates

AI must not:

* invent missing prices
* invent missing quantities
* invent dates
* invent relationships
* approve historical truth
* commit data directly to operational tables

### 18.5 Mandatory Staging

All historical data enters staging first.

No direct import into operational ERP tables.

### 18.6 Required Source Metadata

Store:

```text
original_file_name
source_sheet_name
source_row_number
source_column
original_cell_value
formula_text if available
calculated_value if available
transformed_value
template_name
mapping_version
ai_transformation_version if used
confidence if available
review_status
approved_by
approved_at
```

### 18.7 Validation

Validation must include:

Basic:

* required fields
* valid dates
* valid numbers
* valid quantities
* valid units
* valid document numbers
* valid statuses

Duplicates:

* raw batch numbers
* single lot numbers
* twisted lot numbers
* sales document numbers
* payment document numbers
* production document numbers
* movement numbers

Master data:

* unknown supplier
* unknown customer
* unknown factory
* unknown location
* unresolved alias
* conflicting names

Relationships:

* sale linked to unknown item
* production linked to unknown raw batch/yarn lot
* payment linked to unknown account
* complaint linked to unknown sale/item/customer
* return linked to unknown sale/item when required
* broken raw-to-single lineage
* broken single-to-twisted lineage

Stock:

* negative stock warnings
* impossible movement
* output greater than reasonable input unless accepted
* suspicious waste
* stock by location mismatch
* external factory stock mismatch

Logical dates:

* sale date before item receipt
* production date before material availability
* twisting before single yarn availability
* return before sale
* payment date inconsistent with related document

Historical inconsistencies may be accepted only with explicit warning approval.

### 18.8 Reconciliation

Before commit, show:

* total raw material quantity
* total single yarn quantity
* total twisted yarn quantity
* stock by item
* stock by location
* stock at external factories
* production under processing
* total sales
* total payments
* customer balances
* supplier balances
* factory balances
* negative stock warnings
* broken relationship count
* missing cost count
* missing price count
* unresolved alias count
* critical validation errors
* accepted warnings

### 18.9 Master Data Extraction

If historical files embed master data inside transaction sheets:

1. Extract candidate names.
2. Normalize spelling.
3. Suggest aliases.
4. Show confidence.
5. Owner/Accountant approves canonical records.
6. Map historical rows to approved master data.
7. Store alias dictionary.

Never assume ambiguous names are the same entity automatically.

### 18.10 Workbook-Specific Adapter

The current workbook may be supported by a one-time/client-specific adapter if useful.

But that adapter outputs normalized templates/staging rows.

It must not become the ERP’s permanent import schema.

---

## 19. Imported Historical Cost Preservation

### 19.1 Rule

New live transactions use the current client’s input-based factory cost rule.

Historical imported production records may contain costs that were:

* calculated differently
* entered manually
* formula-driven
* based on output quantity
* based on old assumptions
* unclear

Therefore, historical imported production costs must be preserved as imported.

### 19.2 Required Behavior

For historical imported production records:

* preserve original imported total factory cost
* do not force recalculation with live formula
* store source formula if available
* store calculated value if available
* store ERP-calculated comparison value
* store historical cost basis source
* warn if imported cost differs from live formula
* mark uncertain basis for accountant review

### 19.3 Required Fields

```text
imported_total_factory_cost
erp_calculated_factory_cost
historical_cost_basis_source
source_formula_text
source_calculated_value
cost_difference_amount
cost_difference_percent
migration_warning
review_status
approved_by
approved_at
```

Allowed basis values:

```text
imported_excel
input_based
output_based
manual
unknown
```

### 19.4 Not a General Override

This is not a user override feature.

Normal live production cost cannot be freely overridden by users.

---

## 20. Backup and Restore Strategy

### 20.1 MVP Rule

Backup design in Phase 0 is not enough.

Before pilot or real data entry:

* manual database backup must exist
* file/import backup or documented equivalent must exist
* restore test must be executed or documented
* backup limitations must be clear

### 20.2 Backup Scope

Database backup includes:

* users/roles/permissions
* settings
* master data
* raw batches
* yarn lots
* inventory balances
* stock movements
* reservations
* production orders
* sales
* payments
* account entries
* quality
* complaints
* returns
* approvals
* audit logs
* migration records

File backup includes:

* uploaded historical files
* import source files
* mapping files
* validation reports
* reconciliation reports
* attachments
* generated PDFs if stored

### 20.3 Restore Test

Minimum restore test:

1. Create backup.
2. Restore to separate test database/environment.
3. Verify row counts.
4. Verify critical documents.
5. Verify stock balance sample.
6. Verify account balance sample.
7. Verify uploaded import file availability or documented limitation.
8. Log restore result.

### 20.4 Free-Tier Limitation

Do not delete audit logs unsafely to fit free-tier limits.

If storage risk appears:

* limit pilot data volume
* upgrade hosting
* design future immutable archive
* document limitation

### 20.5 Exports Are Not Backups

Excel/PDF exports are reporting features only.

---

## 21. Audit Log Design

### 21.1 Audit Must Cover

* login/security-sensitive changes
* user changes
* permission changes
* setting changes
* document numbering changes
* raw batch creation/correction
* stock movements
* reservations
* sales approval/rejection/cancellation
* production issue/receipt/correction
* returns
* inventory adjustments
* payment posting/reversal
* subledger entries
* historical import approval/commit
* backup/restore actions
* quality-risk sale approvals

### 21.2 Append-Only Rule

Audit logs are append-only.

No application user can update or delete them.

### 21.3 Transaction Rule

Audit log must be written inside the same transaction as the business change.

If audit insert fails, the business transaction fails.

### 21.4 Visibility

Owner:

* full audit visibility

Accountant:

* operational and financial audit visibility

Workers:

* no audit log access in MVP

### 21.5 Audit Fields

```text
tenant_id
user_id
entity_type
entity_id
action_type
old_values_json
new_values_json
reason
approval_request_id
idempotency_key
ip_address
device_info
created_at
```

---

## 22. API Contracts for High-Risk Operations

### 22.1 General API Requirements

Every high-risk endpoint requires:

```text
Authorization
Role/permission check
Idempotency-Key
tenant_id from auth context, not request body
state precondition check
transaction boundary
audit event
deterministic error code
```

### 22.2 Sales Submit for Approval

```text
POST /sales/:id/submit-for-approval
```

Permission:

```text
sales.create or sales.submit
```

Request:

```json
{
  "reason": "customer requested stock",
  "idempotency_key": "uuid"
}
```

Transaction:

* lock sale
* lock inventory balances for lines
* validate available-to-sell
* create reservations
* create approval request
* update sale status
* audit

### 22.3 Sales Approval

```text
POST /sales/:id/approve
```

Permission:

```text
sales.approve
```

Transaction:

* lock sale
* lock reservation
* lock balances
* consume reservation
* post sale_issue movements
* create customer account entry
* create profitability snapshot
* approve request
* audit

### 22.4 Return Approval

```text
POST /returns/:id/approve
```

Permission:

```text
returns.approve
```

Transaction:

* lock return
* verify sale
* validate returnable qty
* post return receipt
* update returned/blocked balance
* create customer financial entry if needed
* audit

### 22.5 Production Receipt

```text
POST /production/orders/:id/receive
```

Permission:

```text
production.receive or production.approve
```

Worker may enter receipt draft. Accountant/Owner approval posts financial impact.

Transaction:

* lock production order
* lock WIP
* create/lock output item balance
* post output movement
* post waste movement
* create factory payable
* update production totals
* audit

### 22.6 Inventory Adjustment Approval

```text
POST /inventory/adjustments/:id/approve
```

Permission:

```text
inventory.adjustment.approve
```

Transaction:

* lock adjustment
* lock balance
* validate negative stock rules
* post adjustment movement
* audit

### 22.7 Stock Movement Reversal

```text
POST /inventory/movements/:id/reverse
```

Permission:

```text
inventory.reverse
```

Request:

```json
{
  "reason": "wrong location selected",
  "idempotency_key": "uuid"
}
```

Transaction:

* lock original movement
* validate not already reversed
* lock affected balances
* create opposite movement
* update balances
* audit

### 22.8 Payment Reversal

```text
POST /payments/:id/reverse
```

Permission:

```text
payments.reverse
```

Transaction:

* lock payment
* create opposite account entry
* mark payment reversed
* reverse settlement links
* audit

### 22.9 Historical Import Commit

```text
POST /migration/:batch_id/commit-approved-historical
```

Permission:

```text
migration.commit
```

Transaction:

* lock import batch
* verify no blocking errors
* verify reconciliation approved
* insert operational records
* insert stock movements/account entries
* classify records as historical/imported/locked
* audit
* mark batch committed

### 22.10 Post-Approval Change Request

```text
POST /:module/:id/request-correction
```

Permission:

```text
module.request_correction
```

Creates request only. Does not mutate posted business records.

---

## 23. Frontend Screen Plan with Role-Based UX

### 23.1 Login

* Arabic-first
* role-aware redirect
* no fake role preview
* real backend permissions

### 23.2 Owner Dashboard

Shows:

* total stock
* stock at external factories
* open approvals
* negative stock alerts
* customer/supplier/factory balances
* approximate profitability
* open complaints
* quality-risk stock
* backup status
* migration status

### 23.3 Accountant Dashboard

Shows:

* pending approvals
* unpaid supplier/factory payables
* customer receivables
* payments needing settlement
* direct costs needing review
* migration warnings
* backup status

### 23.4 Warehouse Screens

Show:

* receive raw material
* transfer stock
* receive returned stock
* quantities and locations
* no prices/costs/profit
* optional transport simple fields only

### 23.5 Production Screens

Show:

* create production draft
* input/output quantities
* waste
* factory
* dates
* WIP status
* no rate/cost/payable/profit

### 23.6 Quality Screens

Show:

* quality tests
* complaint investigation
* quality status
* no financial data

### 23.7 Approval Center

Owner/Accountant only.

Tabs:

* sales approvals
* daily operations
* returns
* inventory adjustments
* production receipts
* payment reversals
* quality-risk sales
* negative stock alerts
* post-approval corrections
* migration approval

### 23.8 Historical Migration UI

Owner/Accountant only.

Screens:

* upload source file
* AI-assisted transformation import if used
* normalized template upload
* staging preview
* mapping
* validation errors
* warnings
* reconciliation
* human review queue
* approve commit
* locked records status

### 23.9 Traceability

Thin traceability begins early.

Full screen supports search by:

* raw batch
* single yarn lot
* twisted yarn lot
* sale document
* customer

Timeline shows:

* purchase
* receipt
* location movements
* production
* quality
* sale
* payment summary for Owner/Accountant only
* complaint
* return
* correction/reversal

---

## 24. Updated Phase Plan

### Phase 0 — Foundation and Risk Controls

Deliver:

* repository setup
* environment variables
* database migration setup
* modular folder structure
* free-tier deployment
* initial schema migration
* initial permission matrix
* initial inventory ledger model
* backup design
* migration strategy design
* seed demo data

Tests:

* app deploys
* DB connects
* migrations run cleanly
* tenant seed works
* document sequence test
* permission seed test

Smoke test:

* open app
* login seed owner
* verify DB health endpoint
* verify migration table exists

Manual browser tests:

* Arabic RTL layout loads
* login page loads
* owner route protected

Rollback:

* revert deployment
* drop/recreate dev DB from migration
* no business data yet

Known risks:

* free-tier limits
* schema churn

Acceptance:

* foundation is deployable and migration-controlled

---

### Phase 1 — Auth, RBAC, Audit, Approvals, Settings Scope

Deliver:

* auth
* roles
* backend permission guard
* field-level permission filtering
* audit foundation
* approval skeleton
* document numbering service with locking
* settings scope reduction
* terminology caching

Tests:

* warehouse cannot access financial endpoint
* production cannot access profitability
* document number concurrency test
* audit insert test

Smoke:

* login as each role
* verify visible screens differ
* create approval request draft

Rollback:

* disable restricted routes
* restore previous migration if no data
* keep audit migration if used by later modules

Known risks:

* UI-only permissions accidentally trusted

Acceptance:

* permissions enforced at backend

---

### Phase 2 — Master Data, Raw Materials, Supplier Payables, Minimal Backup

Deliver:

* suppliers
* customers
* locations
* factories linked to locations
* raw material batch
* raw receipt approval
* supplier payable on approved receipt
* raw stock movement
* manual database backup
* restore smoke test
* raw batch thin traceability

Tests:

* receipt 1000 kg creates stock
* supplier payable created if price known
* missing price routes to accountant review
* warehouse cannot see price
* restore test documented

Smoke:

* create supplier
* create factory/location
* create raw batch
* approve receipt
* verify balance
* verify supplier statement

Rollback:

* if pilot data exists, restore backup
* before pilot, rollback migrations

Known risks:

* supplier payable sign errors

Acceptance:

* raw material quantity and supplier balance match expected values

---

### Phase 3 — Inventory Ledger, Reservations, Transfers

Deliver:

* immutable stock movements
* inventory balances
* transfer posting
* stock reservations
* available-to-sell
* movement timeline
* concurrency locking
* negative stock alerts

Tests:

* transfer decreases source/increases destination
* pending sale reserves stock but does not reduce on-hand
* double reservation fails safely
* negative stock blocked
* movement reversal creates opposite movement

Smoke:

* transfer raw stock to factory
* create pending sale reservation
* cancel sale and release reservation

Rollback:

* reverse posted movements
* restore backup if balance corruption found

Known risks:

* race conditions
* balance mismatch

Acceptance:

* ledger and balances reconcile

---

### Phase 4 — Production/WIP and Factory Payables

Deliver:

* production orders
* production inputs/outputs
* issue to production
* WIP
* partial receipt
* waste
* output lot creation
* factory payable
* rate confirmation and snapshot
* production lineage

Tests:

* 5000 kg input, 4250 kg output, 750 kg waste
* factory cost uses input quantity
* output stock appears
* WIP decreases correctly
* factory payable sign correct
* partial receipt leaves WIP

Smoke:

* transfer raw to factory
* issue to production
* receive single yarn
* verify WIP and factory payable
* receive twisted yarn

Rollback:

* reverse production movements
* reverse factory payable
* mark production correction requested

Known risks:

* double-counting factory-held stock
* cost based on output by mistake

Acceptance:

* no stock lost or duplicated through production chain

---

### Phase 5 — Sales, Approval Transactions, Payments, Subledgers

Deliver:

* sales order
* sales reservation
* atomic sales approval
* customer account entries
* payments
* partial payments
* advance payments
* supplier/factory payment settlement
* profitability snapshot foundation
* reversal/change endpoints

Tests:

* pending sale reserves only
* approved sale reduces on-hand
* customer receivable created
* payment reduces customer balance
* advance payment works
* payment reversal works
* profitability snapshot created

Smoke:

* create sale
* approve sale
* add partial payment
* view customer statement

Rollback:

* reverse sale movement
* reverse account entries
* release reservation if not approved

Known risks:

* duplicate approval
* wrong sign convention

Acceptance:

* stock and customer balance correct after sale/payment

---

### Phase 6 — Quality, Complaints, Returns

Deliver:

* raw quality tests
* yarn quality tests
* quality-risk stock status
* complaint workflow
* return request
* return approval
* return stock posting
* customer adjustment
* role-specific quality UX

Tests:

* rejected stock triggers sale warning
* quality-risk sale requires approval
* return cannot exceed sold quantity
* approved return increases returned stock
* blocked return stock not available to sell
* customer credit posted if configured

Smoke:

* create quality test
* create complaint
* approve return
* verify stock and customer account

Rollback:

* reverse return movement
* reverse customer adjustment
* keep complaint audit trail

Known risks:

* returned stock accidentally sellable

Acceptance:

* returned/blocked stock behavior is correct

---

### Phase 7 — Historical Migration

Deliver:

* normalized import templates
* optional AI-assisted transformation pipeline
* staging tables
* formula preservation
* master data extraction
* alias dictionary
* validation engine
* logical date validation
* reconciliation
* human review queue
* imported historical cost preservation
* import approval
* locked records
* historical correction workflow

Tests:

* AI output cannot commit directly
* unresolved aliases block commit
* formula text preserved
* cost mismatch becomes warning/review item
* blocking errors prevent commit
* approved batch creates locked historical records
* historical correction uses reversal/adjustment

Smoke:

* upload sample messy source
* transform/map to template
* validate
* reconcile
* approve commit
* verify records locked

Rollback:

* before commit: cancel import batch
* after commit: restore backup or use historical correction workflow depending environment

Known risks:

* historical data requires manual work
* hidden formula assumptions

Acceptance:

* historical import cannot corrupt operational tables silently

---

### Phase 8 — Reports, Profitability, Full Traceability

Deliver:

* full traceability UI
* purchases report
* sales report
* inventory report
* customer/supplier/factory balances
* production under processing
* waste report
* complaints/returns report
* approximate profitability report
* profile/version display
* export permissions

Tests:

* warehouse export blocked
* profitability shows missing cost flags
* traceability chain raw → production → sale → return
* reports filtered by date/location/factory

Smoke:

* open owner reports
* verify report numbers match test fixtures
* export as accountant
* blocked export as worker

Rollback:

* disable report route if wrong
* keep underlying transactions unchanged

Known risks:

* reports accidentally expose financial fields

Acceptance:

* reports are accurate enough and permission-safe

---

### Phase 9 — Hardening, Backup UI, Regression, Production Readiness

Deliver:

* backup UI/policy
* final restore test
* full regression
* browser tests by role
* UAT
* demo script
* pilot script
* production upgrade checklist
* go-live readiness criteria
* known limitations document

Tests:

* full regression matrix
* backup restore
* permission sweep
* concurrency tests
* migration tests
* approval retry/idempotency tests

Smoke:

* complete end-to-end lifecycle
* backup/restore
* traceability
* reports

Rollback:

* restore last known good backup
* deployment rollback
* disable write access if data issue detected

Known risks:

* client treats pilot as production too early

Acceptance:

* ready for limited pilot, not immediate full Excel replacement

---

## 25. Tests, Smoke Tests, and Regression Matrix

### 25.1 Required Executable Test Fixtures

#### Inventory Fixture

```text
Raw batch RB-001
Warehouse A
Quantity: 1000 kg
```

Expected:

```text
on_hand = 1000
reserved = 0
available = 1000
```

#### Reservation Fixture

Create pending sale for 300 kg.

Expected:

```text
on_hand = 1000
reserved = 300
available = 700
official stock not reduced
```

Approve sale.

Expected:

```text
on_hand = 700
reserved = 0
available = 700
sale_issue movement exists
customer receivable exists
```

#### Production Fixture

```text
Input: 5000 kg raw
Output: 4250 kg single yarn
Waste: 750 kg
Rate: 30000 per input ton
```

Expected:

```text
factory payable = 5000 / 1000 × 30000 = 150000
output stock = 4250
waste = 750
WIP = 0 after completion
```

#### Historical Cost Preservation Fixture

Historical source says:

```text
Input: 5000 kg
Output: 4250 kg
Imported factory cost: 127500
Live formula would calculate: 150000
```

Expected:

```text
imported_total_factory_cost = 127500
erp_calculated_factory_cost = 150000
cost_difference = 22500
warning created
review required
no forced recalculation
```

#### Subledger Fixture

Sale 100000, customer pays 40000.

Expected:

```text
sale entry = +100000
payment entry = -40000
customer balance = +60000
```

Supplier purchase 80000, payment 30000.

Expected:

```text
purchase payable = -80000
supplier payment = +30000
supplier balance = -50000
```

### 25.2 Regression Matrix

| Area Changed       | Tests to Rerun                                    | Risk     |
| ------------------ | ------------------------------------------------- | -------- |
| Auth/RBAC          | login, restricted API, field visibility           | High     |
| Settings           | snapshots, audit, restricted edit                 | High     |
| Document numbers   | concurrency, uniqueness                           | High     |
| Raw materials      | receipt, supplier payable, traceability           | High     |
| Inventory          | movement, balance, reversal, negative stock       | Critical |
| Reservations       | pending sale, release, approval recheck           | Critical |
| Production         | WIP, partial receipt, waste, payable              | Critical |
| Factory cost       | input formula, snapshots, historical preservation | Critical |
| Sales              | reservation, approval, customer entry             | Critical |
| Payments           | partial, advance, reversal, settlement            | High     |
| Direct costs       | responsibility vs payer, review queue             | High     |
| Quality            | status, blocked/risky stock                       | Medium   |
| Complaints/returns | return posting, customer impact                   | High     |
| Migration          | staging, validation, reconciliation, locking      | Critical |
| Profitability      | snapshot, missing flags, profile display          | High     |
| Reports            | filters, permissions, export                      | High     |
| Backup             | backup run, restore test                          | High     |
| Audit              | append-only, same transaction                     | High     |

---

## 26. Risk Register

### RISK-001 — Wrong Inventory

Severity: Critical

Mitigation:

* immutable ledger
* balance locking
* reconciliation
* no silent edits
* reversal workflow

### RISK-002 — Duplicate Approval

Severity: Critical

Mitigation:

* idempotency key
* row locks
* state preconditions
* unique constraints
* audit

### RISK-003 — Factory Cost Miscalculation

Severity: Critical

Mitigation:

* confirmed rate snapshot
* input-based formula tests
* historical cost preservation

### RISK-004 — Broken Historical Migration

Severity: Critical

Mitigation:

* normalized templates
* staging
* validation
* reconciliation
* human approval
* no direct AI import

### RISK-005 — Financial Balance Errors

Severity: Critical

Mitigation:

* immutable account entries
* signed convention
* settlement links
* reversal entries
* reconciliation reports

### RISK-006 — Permission Leak

Severity: High

Mitigation:

* backend field filtering
* permission tests
* role browser tests

### RISK-007 — Free-Tier Data Risk

Severity: High

Mitigation:

* backup before pilot
* restore test
* limit pilot
* upgrade before production

### RISK-008 — Worker UX Complexity

Severity: High

Mitigation:

* role-based screens
* hide finance concepts
* accountant review queue

### RISK-009 — Audit Storage Growth

Severity: Medium

Mitigation:

* append-only logs
* monitor size
* upgrade before heavy production
* future immutable archive

### RISK-010 — Client Replaces Excel Too Early

Severity: High

Mitigation:

* demo
* limited pilot
* parallel run
* reconciliation
* go-live readiness checklist

---

## 27. Rollback and Recovery Notes

### 27.1 Before Real Data

Rollback by:

* reverting deployment
* dropping dev database
* rerunning migrations
* reseeding demo data

### 27.2 During Pilot

Rollback by:

* disabling write access
* restoring latest backup to test
* comparing impacted records
* applying reversals/corrections if staying live
* restoring production only with owner approval

### 27.3 For Posted Business Records

Do not edit directly.

Use:

* reversal
* correction request
* adjustment
* linked corrected document

### 27.4 For Historical Import

Before commit:

```text
cancel import batch
```

After commit:

```text
restore backup in test to inspect issue
then use historical correction workflow or restore environment if pilot only
```

### 27.5 For Bad Deployment

Use:

* application rollback
* database migration rollback only if safe
* no destructive rollback of business data without backup

---

## 28. Open Questions Before Production

These do not block demo but must be answered before production go-live.

1. Is one-step transfer acceptable for MVP, or does the client require in-transit dispatch/receive?
2. At exactly which moment should factory payable be recognized: material issue, output receipt, or accountant approval?
3. Are supplier raw material purchases always priced at receipt, or can price be unknown?
4. Are sales always single-line, or must MVP support multi-line sales immediately?
5. What are the exact Arabic labels approved for each worker screen?
6. Which quality statuses block sales automatically?
7. What return financial treatments are needed in MVP: refund, credit, replacement, discount only?
8. Is transport often paid by company first and recharged, or mostly recorded informationally?
9. What historical years/months must be migrated before pilot?
10. What reconciliation totals will the owner/accountant treat as authoritative?
11. Who signs off historical migration?
12. What production hosting budget is acceptable after pilot?
13. What backup retention period is required for production?
14. Should accountant be allowed to manage users, or only Owner?
15. Are PDF/Excel exports legally used externally or only internal reports?

---

## 29. Pilot, Parallel Run, and Go-Live Plan

### 29.1 Demo Phase

Use fake or copied data.

Goals:

* validate UI terms
* validate workflows
* validate role separation
* validate basic stock/profitability logic

Do not use as official source of truth.

### 29.2 Limited Pilot

Use limited real data.

Scope:

* selected suppliers
* selected factories
* selected stock locations
* selected product flows
* controlled user group

Requirements before pilot:

* manual backup works
* restore test documented
* permissions tested
* rollback plan ready
* known limitations explained

### 29.3 Parallel Run With Excel

ERP and Excel run together.

Compare:

* raw material balances
* factory-held stock
* production output
* sales
* customer balances
* supplier/factory balances
* returns
* key profitability samples

### 29.4 Training

Train by role:

Warehouse:

* receive
* transfer
* stock lookup
* return receiving

Production:

* production entry
* WIP
* output/waste

Quality:

* tests
* complaint investigation
* quality status

Accountant:

* approvals
* payments
* balances
* direct cost review
* migration review

Owner:

* dashboard
* approvals
* reports
* audit
* backup status

### 29.5 Go-Live Readiness Criteria

Go-live only if:

* production hosting upgraded
* backup configured
* restore tested
* critical balances reconciled
* migration signed off
* permissions passed
* full regression passed
* users trained
* rollback plan approved
* Excel parallel run discrepancies resolved or accepted

---

## 30. Final MVP Acceptance Criteria

The MVP is acceptable only when all conditions below are true.

### 30.1 Data Integrity

* stock movements are immutable
* balances reconcile with ledger
* reservations prevent double selling
* production does not double-count stock
* WIP works for partial production
* reversals/corrections exist

### 30.2 Financial Safety

* supplier payable created on raw receipt approval when price known
* factory payable created from input-based production cost
* customer receivable created on sale approval
* payments and reversals work
* account balances are derived from immutable entries
* direct costs separate responsibility from actual payment

### 30.3 Migration Safety

* normalized templates exist
* AI output cannot import directly
* staging exists
* validation exists
* reconciliation exists
* human approval required
* historical records locked
* imported historical costs preserved as-is
* corrections use controlled workflow

### 30.4 Role Safety

* workers cannot view prices/costs/profitability
* exports blocked for workers
* financial reports restricted
* backend enforces permissions
* field-level filtering works

### 30.5 Approval Safety

* approvals are transactional
* duplicate approval prevented
* idempotency implemented
* audit written in same transaction
* failure leaves no partial posting

### 30.6 Operational Safety

* manual backup works before pilot
* restore test executed/documented
* audit logs append-only
* free-tier limits documented
* production upgrade path defined

### 30.7 UX Safety

* Arabic-first UI works
* worker screens are simple
* accountant review queues exist
* unknown/incomplete transport data does not block safe operations

### 30.8 Rollout Safety

* demo completed
* limited pilot completed
* Excel parallel run completed
* reconciliation accepted
* training completed
* go-live checklist approved

Final rule:

```text
The MVP can be practical and fast,
but it must not be naive where stock, approvals, balances, migration, audit, backup, or permissions are involved.
```
