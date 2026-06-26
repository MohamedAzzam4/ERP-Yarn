# Permission Matrix Contract

## 1. Purpose

Define authoritative module-, action-, field-, report-, export-, migration-, backup-, settings-, audit-, and API permissions for all MVP roles. Prevent frontend-only hiding from becoming the security model.

## 2. Scope

Owner, Accountant, Warehouse Employee, Production Employee and Quality Employee across dashboards, users, master data, inventory, sales, production, payments, direct costs, quality, complaints, returns, migration, backup, reports, exports, settings and audit.

## 3. Non-Goals

- No undefined Admin role.
- No public signup or external portals.
- No arbitrary role engine beyond Owner-controlled seeded roles/permissions.
- No cross-tenant sharing.
- No permission enforcement solely through menus, CSS or disabled controls.

## 4. Source Documents and Sections Used

- Final Implementation Plan v4 §6, §8, §9/§9.1, §21.4, §23 and role tests.
- Decision Log: DEC-027, DEC-032–DEC-033, DEC-043; Worker UX; Hosting/Backup/Permissions/Exports.
- Design System Contract: Worker Task Mode, Management Console and data exposure.
- Technical Architecture Contract: Supabase Auth identity versus ERP authorization/RLS.
- Database, Inventory, Production, Approval, Subledger and API contracts.

## 5. Roles

### Owner

Highest business authority. Manages users/permissions, sees all operational/financial data, approves/reverses/corrects, migration, backup and audit through controlled workflows.

### Accountant

Financial/operational authority for approvals, balances, payments, costs, settlements, migration and backup as permitted. May view users where needed but cannot create privileged users, assign roles, grant permissions or change security settings.

### Warehouse Employee

Operational receipt, transfer, return receipt and quantity lookup. Enters own drafts before approval. No financial data or approval/reversal authority.

### Production Employee

Operational production draft, issue/receipt facts, WIP and WIP-return requests for allowed factories/locations. No rate, payable, cost, profitability or accounts.

### Quality Employee

Quality tests/status, complaint investigation and return quality review. No financial treatment, discount, risky-sale approval, stock reversal or accounts.

## 6. Action Legend

```text
V view
C create draft/request
U update own/authorized draft before approval
S submit for review/approval
A approve/reject
X cancel permitted draft/pending record
R reverse/correct through controlled workflow
E export internal report
P view price
K view cost/rate
F view profitability
L view audit
M manage/configure
- prohibited
```

Every action is constrained by tenant, state and field scope. Update/approve/cancel/reverse never authorizes direct edits to posted/locked history.

DEC-061 resolves role-conflict behavior for MVP. MVP users normally have one active operational role; the schema may allow multiple role assignments for future or exceptional Owner-managed cases. If multiple roles exist, effective permissions are the union of allowed actions except where a stricter denial or field ceiling applies. Worker-family financial denial under DEC-063 always wins, even if the same user is assigned another role or custom grant. Owner management of assignments cannot silently override the absolute worker prohibitions in this contract. DEC-069 separately requires historical migration dual approvals to come from two distinct user identities.

## 7. Role/Action Matrix

| Area / Action | Owner | Accountant | Warehouse | Production | Quality |
| --- | --- | --- | --- | --- | --- |
| Dashboard | V/F | V/F | operational V | operational V | quality V |
| Users | M | limited V/request | - | - | - |
| Roles/permissions/security | M | - | - | - | - |
| Company/settings | M controlled | restricted/read-only V | - | - | - |
| Terminology | M/approve | V/request | labels V | labels V | labels V |
| Suppliers | V/C/U | V/C/U | names V | names V | names V |
| Customers | V/C/U | V/C/U | task names V | - | investigation names V |
| Locations/factories | V/C/U | V/C/U | V | V | V |
| Fiber/product/quality masters | V/C/U | V/C/U | V | V | V |
| Raw batch/receipt draft | V/C/U/S | V/C/U/S | C/U/S own operational | limited V | quality V |
| Raw receipt approval | A/R | A/R | - | - | - |
| Raw price/cost | P/K | P/K | - | - | - |
| Missing-price review | V/A/R | V/A/R | - | - | - |
| Stock quantity/balances | V | V | operational V | production-location V | quality-scoped V |
| Stock value | V | V | - | - | - |
| Transfer draft | V/C/U/S | V/C/U/S | C/U/S own | C/U/S production-related | - |
| Transfer approval/reversal | A/R | A/R | - | - | - |
| Adjustment request | V/C/S | V/C/S | C/S request | C/S request | - |
| Adjustment approval/reversal | A/R | A/R | - | - | - |
| Sales request | V/C/U/S | V/C/U/S | C/U own operational draft if enabled, no price/submit | - | quality V/comment |
| Sales price/discount | P | P | - | - | - |
| Sales approval/reversal | A/R | A/R | - | - | investigation/comment only |
| Customer balances | V | V | - | - | - |
| Production order draft | V/C/U/S | V/C/U/S | stock movement V | C/U/S own | quality V |
| Production issue/receipt draft | V/C/U/S | V/C/U/S | physical/location V as needed | C/U/S own | quality V |
| Production issue approval/posting | A/R | A/R | - | - | - |
| Production receipt approval | A/R | A/R | - | - | - |
| WIP-return request | V/C/S | V/C/S | physical receipt confirmation if assigned | C/S own | - |
| WIP-return approval | A/R | A/R | - | - | - |
| Factory rate/cost/payable | K/V/A/R | K/V/A/R | - | - | - |
| Payments/settlements | V/C/A/R | V/C/A/R | - | - | - |
| Supplier/factory balances | V | V | - | - | - |
| Transport simple input | V | V/C/U | C optional | C optional | - |
| Transport financial allocation/payer | V/A/R | V/A/R | - | - | - |
| Direct-cost review | V/A/R | V/A/R | - | - | - |
| Quality tests | V/A/R | V | status V | status V | V/C/U/S own |
| Quality-risk sale approval | A | A | - | - | investigation/comment |
| Complaints | V/A/R | V/A/R | limited V | limited V | V/C/U/S investigation |
| Return request | V/C/U/S | V/C/U/S | C/S physical receipt | - | V/C/U/S quality review |
| Return/replacement approval and financial treatment | A/R | A/R | - | - | - |
| Profitability | F | F | - | - | - |
| Audit | L | L financial/operational | - | - | - |
| Migration preparation/review | M | M | - | - | assigned quality mapping only |
| Historical commit approval | required dual A | required dual A | - | - | - |
| Backup status/manual run | M | run/status when granted | - | - | - |
| Restore test | authorize/M | execute only when granted | - | - | - |
| Production restore | Owner authorization only | - | - | - | - |
| Internal Excel/PDF export | E | E | - | - | - |

## 8. Field-Level Permission Matrix

| Field group | Owner | Accountant | Warehouse | Production | Quality |
| --- | --- | --- | --- | --- | --- |
| Identifiers/status/dates | V | V | task-scoped V | task-scoped V | task-scoped V |
| Quantities/locations | V | V | operational V | production V | quality V |
| Party/factory names | V | V | task names | factory/task names | investigation names |
| Purchase price/total cost | V | V | redacted | redacted | redacted |
| Sale price/discount/net revenue | V | V | redacted | redacted | redacted |
| Return credit/replacement receivable/difference | V | V | redacted | redacted | redacted |
| Factory rate/payable | V | V | redacted | redacted | redacted |
| Worker-entered direct-cost amount | V | V | own operational value | own operational value | redacted |
| Actual payer/allocation/subledger | V | V | redacted | redacted | redacted |
| Party balances | V | V | redacted | redacted | redacted |
| Account entries/settlements | V | V | redacted | redacted | redacted |
| Profit/margin/profile/missing flags | V | V | redacted | redacted | redacted |
| Audit financial old/new values | V | authorized V | redacted | redacted | redacted |
| Migration financial warnings | V | V | redacted | redacted | assigned quality-only |
| Backup evidence | V | authorized V | redacted | redacted | redacted |
| Secrets/credentials | no application role | no application role | no | no | no |

Restricted examples:

```text
purchase_price_per_ton
total_purchase_cost
price_per_ton
gross_revenue
discount_amount
net_revenue
line_allocated_discount_precise
line_allocated_discount_posted
line_net_revenue_precise
line_net_revenue_posted
order_discount_total
rounding_adjustment
document_total_posted
return_credit_value
replacement_receivable
factory_rate_per_ton_used
calculated_factory_cost
factory_payable
actual_payer_type
direct_cost_allocations
customer_balance
supplier_balance
factory_balance
account_entries
payment_settlements
profit_amount
profit_margin_percent
profitability_profile_version
missing_cost_flags
```

## 9. Worker Operational-Facts Rule

Workers enter item/batch/lot, location/factory, quantity/date/status, output/waste, return/replacement operational facts and links, quality result, notes, simple transport amount/responsibility if known, and safe unknown/review choices.

Workers cannot enter or approve payable, receivable, return credit, replacement value/difference, refund treatment, settlement, actual payer, allocation, profit, cost formula/version, financial adjustment or party balance. Owner/Accountant decides and approves return/replacement financial treatment.

## 10. Management Console Rule

Owner and Accountant share the UX shell, but backend permissions determine widgets, fields and actions.

- Owner alone manages users/permissions/security.
- Both handle approvals according to matrix.
- Historical commit requires both approvals.
- Production restore requires Owner authorization.
- Accountant cannot escalate privileges through settings/API.

## 11. Backend Enforcement and Filtering

Every endpoint/service/query:

1. authenticates Supabase user server-side;
2. maps active ERP user/tenant;
3. checks stable permission key/action;
4. enforces tenant/row scope;
5. selects only allowed fields or maps role-safe DTO;
6. executes state/business checks;
7. audits sensitive actions.

Never fetch all financial fields and rely on UI hiding. Worker responses omit restricted properties, including nested snapshots, errors, exports and chart aggregates. RLS is defense in depth; service-role access still applies ERP authorization.

## 12. Required Permission Keys

At minimum:

```text
users.view_limited
users.manage
permissions.manage
settings.view_restricted
settings.manage
inventory.view_quantity
inventory.receive.create
inventory.receive.approve
inventory.transfer.create
inventory.transfer.approve
inventory.adjustment.request
inventory.adjustment.approve
inventory.reverse
inventory.request_correction
inventory.correct
sales.create
sales.submit
sales.approve
sales.cancel
sales.reverse
sales.view_price
sales.request_correction
sales.correct
production.create
production.issue_draft.create
production.issue_draft.submit
production.issue.approve
production.receive_draft
production.approve
production.return_from_wip.request
production.return_from_wip.approve
production.view_cost
production.request_correction
production.correct
payments.create
payments.approve
payments.reverse
balances.view_customer
balances.view_supplier_factory
direct_costs.review
quality_tests.create
quality_risk_sales.approve
complaints.investigate
returns.create
returns.approve
returns.request_correction
returns.correct
profitability.view
audit.view
migration.prepare
migration.review
migration.approve
migration.commit
backup.view
backup.run
backup.restore_test
exports.internal
```

Exact seeds must match API routes. No worker wildcard permission.

## 13. State and Ownership Restrictions

- Workers update only own/authorized drafts before submission.
- Pending/approved/locked records are not draft-editable.
- Approval does not permit post-approval field mutation.
- Approved records require correction/reversal, not cancellation/edit.
- View does not imply export, cost, price or audit.
- Create does not imply approve/reverse.

### 13.1 Worker Row Scope

DEC-062 resolves worker row scope for MVP:

- Worker operational row access is default-deny.
- Scope is user-specific, not tenant-wide and not role-wide.
- Allowed scope dimensions are assigned locations, assigned external factories and assigned task types.
- External-factory assignment includes the factory's linked inventory location where relevant; it does not grant financial access to factory balances or rates.
- Scope controls row visibility and eligibility for operational actions, but the action still requires the role permission.
- Read and write are not broadened separately in MVP: a worker can only read operational rows needed for assigned tasks and can only write actions explicitly permitted for the role within that assigned scope.
- Owner maintains worker scope assignments in MVP; Accountant may view or request changes only.
- Temporary delegation UI is deferred. Scope rows may include optional effective-from/effective-to metadata for setup-time control, but no ad hoc self-delegation or worker-to-worker delegation is allowed.
- Workers must not receive unrestricted tenant-wide write access as a shortcut.

## 14. Export and Report Rules

Exports are internal reports restricted to Owner/Accountant. Apply the same row/field permissions and audit actor/filters/time/type where required. Workers cannot bypass through hidden URLs. Exports are not backups or legal documents.

## 15. Migration and Backup Rules

- Owner/Accountant prepare/review migration by permission.
- Commit requires dual approval.
- DEC-069 requires the two approvals to be performed by distinct user identities; one multi-role user cannot satisfy both approval records.
- Quality receives only assigned quality mapping.
- Accountant may run/view backups when granted.
- Restore test requires explicit grant and non-production target.
- Production restore requires Owner authorization outside ordinary API.
- Paths/secrets are never returned.

## 16. Audit Rules

Owner has full audit visibility; Accountant authorized operational/financial audit; workers none. Audit output remains field-filtered and never logs credentials.

## 17. API Implications

Every high-risk API declares one permission. Handler checks before entity disclosure; service rechecks critical authority/state. Body cannot claim role/tenant/approver. Forbidden worker financial fields are rejected, not silently accepted.

## 18. Testing Requirements

- Owner manages users; others cannot.
- Accountant sees balances/cost review but cannot grant permissions.
- Worker responses omit every restricted field.
- Worker return/replacement requests contain facts only and cannot inject credit, receivable, difference, or refund values.
- URL/export/error/nested/chart paths cannot leak data.
- Own-draft update stops after submission.
- Create does not approve; approval does not rewrite.
- Migration commit requires both approvals.
- Backup/restore-test grants and production-restore restriction work.
- Audit unavailable to workers; Accountant scope correct.
- Cross-tenant IDs fail safely.
- RLS and service filtering both pass.
- Browser tests verify UX while API tests verify security.

## 19. Common Failure Cases

Frontend-only hiding; selecting then hiding fields; client-token-only role; Accountant self-grant; worker wildcard; create implies approve; approval implies update; export/nested/error/chart leak; cross-tenant reference; service-role bypass without authorization.

## 20. Acceptance Criteria

- All roles have explicit action/field rules.
- Owner-only user/permission management is enforced.
- Workers enter/receive operational facts only.
- Shared management UX does not merge permissions.
- Every high-risk endpoint maps to a stable permission.
- Financial fields are omitted server-side.
- Migration, backup, audit and export controls are explicit.
- Tenant isolation is tested independently of UI.

## 21. Notes for AI Coding Agents

Do not invent Admin, equate hidden with forbidden, return full ORM rows to workers, add wildcard permissions, or check roles only in components. If an action/field lacks a matrix rule, stop: **Unresolved / requires owner decision**.
