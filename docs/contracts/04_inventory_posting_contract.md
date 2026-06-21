# Inventory Posting Contract

## 1. Purpose

Define the only authorized model for stock posting, reservations, materialized balances, WIP interaction, quality blocks, returns, negative-stock alerts, reversals, concurrency, idempotency, and reconciliation.

## 2. Scope

Every operation that changes or protects company-owned stock at internal warehouses, ports, external factories, returned-stock locations, temporary locations, or production WIP.

## 3. Non-Goals

- No valuation ledger or full cost accounting.
- No two-step in-transit workflow in MVP.
- No bale-level inventory.
- No direct stock edits from UI, Route Handlers, production, sales, migration, or reports.
- No global negative-stock toggle.
- No automatic reservation expiry.

## 4. Source Documents and Sections Used

- Final Implementation Plan v4 §§4.5–4.6, 10.5, 11–14, 22, 24–27.
- Decision Log: DEC-007–DEC-012, DEC-022, DEC-028, DEC-030–DEC-031; Transfers/Reservations; Negative Stock; returned-stock decisions.
- Database Schema Contract §§6, 9–10, 16–19.
- Technical Architecture Contract: server-side transactions, PostgreSQL locks and idempotency.
- Design System Contract: worker simplification and status/accessibility rules.

## 5. Key Entities and Structures

`inventory_items`, `locations`, linked external factories, `stock_movements`, `inventory_balances`, `stock_reservations`, `inventory_adjustments`, production inputs/WIP/receipts/waste/WIP returns, return lines/classifications, approvals, audit and idempotency.

## 6. Canonical Ledger and Balance Definitions

`stock_movements` is the immutable source of truth for posted on-hand changes by item/location. Reservation records are the source for reserved quantity; production events/WIP balances for WIP; approved block/return/disposition records for blocked/returned dimensions.

`inventory_balances` is a transactionally maintained materialized view, never an independently editable truth.

```text
on_hand_qty_kg:
  physical company-owned stock at a location, excluding issued WIP

reserved_qty_kg:
  on-hand stock protected for submitted pending sales

blocked_qty_kg:
  on-hand stock unavailable for ordinary sale

returned_qty_kg:
  on-hand stock originating from an approved customer return

wip_qty_kg:
  input issued to production and not output, waste, or returned from WIP

available_qty_kg:
  on_hand_qty_kg - reserved_qty_kg - blocked_qty_kg
```

Returned and blocked may overlap. Returned quantity is not added to on-hand and not independently subtracted from available.

## 7. Required Movement Types

```text
raw_receipt
transfer
issue_to_production
receive_from_production
production_waste
return_from_wip
sale_issue
return_receipt
inventory_adjustment
stock_block
stock_unblock
reversal
correction
```

No generic “other” movement may avoid a defined posting contract.

## 8. Core Posting Rules

In these contracts, a posting is an official durable business effect: a stock movement or official quantity change, reservation consumption/release, production output receipt, account entry, payable/receivable, payment settlement, or profitability snapshot. Audit logs, validation-failure logs, alerts, and failure-status updates are official audited records but are not sale, stock, or account postings.

| Operation | On-hand | Reserved/classification | WIP |
| --- | --- | --- | --- |
| Raw receipt | destination `+qty` | none | none |
| One-step transfer | source `-qty`, destination `+qty` atomically | preserve classification | none |
| Issue to production | factory `-qty` | issued stock must be available | `+qty` |
| Receive output | output location `+output_qty` | output quality may block separately | `-consumed_input_qty` |
| Production waste | no sellable increase | none | `-waste_qty` |
| Return from WIP | return location `+qty` | approved classification | `-qty` |
| Submit sale | no on-hand change | reserved `+qty` | none |
| Approve sale | source `-qty` | reserved `-qty`, consume reservation | none |
| Reject/cancel sale | none | reserved `-qty`, release reservation | none |
| Customer return | return location `+qty` | returned `+qty`; block by status | none |
| Block/unblock | no physical change | blocked `+qty`/`-qty` | none |
| Adjustment | location `+qty` or `-qty` | explicit status | none |
| Reversal | approved exact inverse | inverse contracted effects | coordinated inverse where applicable |

Every posting inserts/links events, updates materialized rows, and writes audit in one transaction.

### 8.1 Raw Receipt

Physical stock may post when purchase price is missing. No supplier payable is created until Accountant/Owner confirms price. Warehouse supplies operational facts only.

### 8.2 Transfer

MVP transfer is one-step; source decrease and destination increase commit together. `in_transit` remains future schema capacity only. Transfer cannot change item identity or silently unblock risky/returned stock.

Ordinary MVP transfer supports unblocked available stock. Transfer of a quantity that is partially/wholly blocked or returned is blocked until PCD-INV-001 defines the classification-allocation and destination-preservation behavior; an agent may not subtract a generic quantity and guess which dimension moved.

### 8.3 Inventory Adjustment

Adjustment uses a positive absolute quantity plus direction/type, reason, request and approval. Negative adjustment validates available/ protected dimensions. It is not a generic escape hatch for production, return, sale, or migration corrections.

## 9. Reservation Contract

### 9.1 Creation

Draft sale does not reserve. Submission locks sale/balances, validates available stock and state, inserts reservations per line, increases reserved quantity, sets pending approval, creates approval request and audit.

Reservation/submission for `needs_review`, blocked, or `sellable_with_discount` returned stock is blocked until PCD-SALE-001 defines whether quality/disposition approval precedes reservation or a protected review reservation is used. Ordinary accepted/`sellable_as_is` stock follows this section.

### 9.2 Approval

Approval locks sale, reservation and balances; confirms active reservation and on-hand; consumes reservation and posts sale issue atomically.

### 9.3 Release

Successful sale approval consumes a reservation; it is not a release. Release occurs only through human rejection/cancellation or an authorized manual/failure-resolution transaction with an explicit reason and audit. No automatic expiration job; nullable `expires_at` has no MVP effect. A failed sale approval does not create a general right to release reservations.

### 9.4 Approval-Failure Resolution

The failed approval transaction creates no sale approval posting. If business state or reservation state must change, a separate audited resolution transaction applies this mapping:

- technical/system failure: leave sale and reservation unchanged;
- missing/corrupted reservation: mark the reservation failed, reconcile `reserved_qty_kg`, create a critical alert, and audit;
- stock shortfall: retain reservation for review; do not release automatically;
- quality block: retain reservation for review; do not release automatically;
- missing price/commercial data: normally block before submission; if discovered later, retain reservation for review;
- human rejection/cancellation: explicitly release the active reservation once and audit.

Reservation release is never silent. The resolution transaction locks the sale, reservation, and affected balances; prevents double reconciliation/release; and creates no sale issue, receivable, or profitability snapshot.

### 9.5 Invariants

- `reserved_qty_kg` never negative.
- Active reservation totals reconcile to materialized reserved quantity.
- Reserved stock cannot be consumed elsewhere.
- A block/adjustment affecting reserved stock fails or follows explicit correction; it cannot silently strand reservations.

## 10. Production and WIP Interaction

Material at a factory remains on-hand until issued. Issue decreases factory on-hand and increases WIP equally. Receipt decreases WIP by explicitly linked consumed input and increases output on-hand; waste is separate; remainder stays WIP.

`return_from_wip` requires a production correction request/approval, decreases WIP, increases on-hand at approved location, updates production and audits. It is never a vague adjustment.

WIP cannot be negative through ordinary posting. Only an explicit approved correction may create a visible negative WIP alert; workers cannot override.

## 11. Returned and Blocked Stock

Statuses:

```text
return_received
needs_quality_review
sellable_as_is
sellable_with_discount
blocked
reprocess_required
```

- `sellable_as_is`: ordinary availability.
- `sellable_with_discount`: requires Owner/Accountant quality-risk approval.
- Other review/blocked/reprocess states: unavailable.

Classification changes are approved/audited. Worker quality input does not authorize discount or risky sale.

## 12. Negative Stock Behavior

Negative inventory is a visible controlled integrity alert, not normal behavior.

- No `allowed_negative_flag` or UI toggle.
- Worker operations that would go negative cannot post; eligible workflows may remain draft/review.
- Insufficient-stock sale approval creates no sale posting. A separate audited sales failure-resolution action may set `approval_failed` or `needs_review` while retaining the reservation for review; negative sales are not a normal MVP path.
- Owner/Accountant may approve a negative adjustment only for correction or accepted historical inconsistency.
- Historical negative warnings require both Owner and Accountant approval.
- Dashboard, approval and reconciliation expose negatives.
- No silent auto-fix.
- Reserved quantity never negative.
- Negative financial account balances are valid signs, not inventory errors.

## 13. InventoryLedgerService Ownership

Only `InventoryLedgerService` (or exact implementation equivalent) may insert posted movement rows or mutate materialized balances. Sales, production, returns, migration and adjustments call its transaction-aware contract; they never write inventory tables directly.

## 14. Concurrency and Locking Strategy

Every posting:

1. validates tenant, permission and state;
2. locks source business document;
3. safely creates missing balance rows when authorized;
4. locks affected balance rows in deterministic item/location order;
5. locks reservations/WIP where relevant;
6. rechecks on-hand, available, reserved, blocked and WIP;
7. inserts immutable movements/events;
8. updates materialized balances/version;
9. writes decision/audit;
10. commits all or nothing.

Deadlock/serialization retry reuses the same idempotency key and cannot duplicate movement/audit.

## 15. Idempotency

Every high-risk inventory command requires `Idempotency-Key`.

- Same tenant/scope/key and request hash returns prior result.
- Same key/different request returns conflict.
- Unique source/movement constraints prevent duplicate posting.
- Failed transaction leaves no posted movement/balance change.
- A technical/system failure leaves business status and reservation state unchanged.
- Retry after uncertain response resolves through durable idempotency state.

## 16. Reversal Rules

Posted movements are never edited/deleted. Reversal checks dependencies/feasibility, locks original and balances, inserts opposite linked movement, reverses materialized effects, retains original history, and writes reason/approval/audit.

If a simple inverse would corrupt production, sale, return, reservation, WIP, or subledger state, use domain-specific correction rather than isolated stock reversal.

## 17. Reconciliation Rules

Compare:

- movement totals by item/location versus on-hand;
- active reservations versus reserved;
- block/disposition records versus blocked;
- approved returns versus returned reporting quantity;
- production issue/receipt/waste/WIP return versus WIP;
- movement sources/reversal chains;
- imported opening/movements versus approved migration totals.

Mismatch is critical and investigated non-destructively. Reconciliation never silently changes balances.

## 18. State Transitions

```text
reservation: active → approved_consumed | released | failed

movement: draft/pending_approval → posted | cancelled
posted movement → linked reversal; original retained

returned stock:
  return_received → needs_quality_review | sellable_as_is |
                    sellable_with_discount | blocked | reprocess_required
  needs_quality_review → sellable_as_is | sellable_with_discount |
                         blocked | reprocess_required
```

Other transitions require contract change.

## 19. Permission Rules

- Owner/Accountant: quantity visibility; approvals/reversals/corrections per matrix.
- Warehouse: own receipt/transfer/return-receipt drafts; operational quantities; no value/cost/balances.
- Production: production-location quantities and contracted production drafts; no financial fields.
- Quality: quality-related quantity/status; no financial or independent stock-posting authority.
- Workers cannot approve negative adjustment, sale issue, WIP return, or reversal.

## 20. API Implications

High-risk endpoints are server-side Route Handlers limited to auth, permission, structural validation, service call and deterministic response. Posting logic is in application/domain services. Worker responses omit prices, costs, profitability, balances, entries and settlements. Tenant ID is not body authority.

## 21. Testing Requirements

- Receipt 1000 kg → on-hand 1000, reserved 0, available 1000.
- Pending sale 300 → on-hand 1000, reserved 300, available 700.
- Approval → on-hand 700, reserved 0, one sale movement.
- Reject/cancel releases once.
- Technical approval failure leaves pending state, active reservation, and all quantities unchanged.
- Stock/quality/commercial precondition failures retain reservation for review and create no sale posting.
- Corrupted reservation resolution marks it failed, reconciles reserved quantity once, alerts critically, and audits.
- Simultaneous reservations cannot oversell.
- Transfer decreases/increases atomically and rolls back together.
- Issue/receipt/waste/WIP return reconcile.
- Blocked return unavailable; sellable return available; discounted requires approval.
- Ordinary negative posting blocked; approved exception alerts.
- Reserved/WIP invariants enforced.
- Duplicate idempotency key cannot duplicate; changed payload conflicts.
- Reversal preserves original and posts inverse.
- Reconciliation detects seeded mismatch.
- Worker cannot mutate balances or receive financial fields.

## 22. Common Failure Cases

Direct balance update; movement without balance; factory/WIP double-count; reservation reducing on-hand too early; automatic release for every approval failure; double release; corrupted reservation silently deleted; returned quantity counted as extra stock; hidden negative; generic adjustment replacing WIP return; in-place reversal; inconsistent lock order; duplicate retry; worker value exposure; silent reconciliation fix.

## 23. Acceptance Criteria

- Every movement has explicit effects.
- Posting is centralized/atomic.
- Ledger/dimensions/balances reconcile.
- Reservations prevent double selling.
- Factory stock and WIP are not double-counted.
- Negatives are controlled/visible.
- Reversals preserve history.
- Concurrency/idempotency prevent duplicates/overselling.
- Worker permissions remain operational only.

## 24. Notes for AI Coding Agents

Do not create stock CRUD endpoints, direct balance writes, automatic reservation expiry, an allow-negative setting, or WIP inference from factory location. Do not treat returned quantity as extra on-hand. If a new movement lacks this matrix, stop: **Unresolved / requires owner decision**.
