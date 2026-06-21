# Subledger and Costs Contract

## 1. Purpose

Define the immutable operational subledger for customer, supplier and factory balances; payments/settlements/reversals; direct costs/transport; and deterministic versioned profitability without becoming a full accounting system.

## 2. Scope

Accounts, signed entries, party balances, sale receivables, raw-receipt supplier payables, production-receipt factory payables, payments, partial/advance payments, settlement links, reversals, direct-cost responsibility/payer, review queues and profitability snapshots.

## 3. Non-Goals

- No general ledger, journal chart, trial balance, statutory accounting or tax engine.
- No multi-currency conversion.
- No overhead allocation/full cost accounting.
- No worker financial interpretation.
- No editable approved entries or snapshots.
- No user-defined profitability formula.

## 4. Source Documents and Sections Used

- Final Implementation Plan v4 §§4.7–4.12, 10.8–10.9, 15–17, 19, 22, 24–25.
- Decision Log: DEC-013–DEC-019, DEC-023; Raw Receipts Without Price; Sales Revenue/Profitability; Transport; negative-account distinction.
- Database Schema Contract §§10–12 and 19.
- Production/WIP Contract §§14–18 and 21.
- Approval Transaction Contract.
- Permission and Design contracts for financial-field restrictions.

## 5. Key Entities and Structures

- `accounts`;
- immutable `account_entries`;
- `payments` and `payment_settlements`;
- raw receipts/purchase-price review;
- production receipts/factory payable snapshots;
- `direct_costs` and allocations;
- sales orders/lines and returns;
- immutable/versioned profitability snapshots;
- approval, audit and idempotency.

## 6. Operational Subledger Scope

The subledger answers operational questions:

- how much a customer owes/has credited;
- how much the company owes a supplier/factory;
- which payments are partial, advance, unsettled or reversed;
- which source document created each balance;
- which direct cost creates a reviewed receivable/payable;
- how imported historical balances reconcile.

It does not claim statutory accounting completeness.

## 7. Account Model

One tenant-scoped account per owner/currency:

```text
owner_type = customer | supplier | factory
owner_id = corresponding master record
currency = ISO currency code; current client uses EGP
```

Unique `(tenant_id, owner_type, owner_id, currency)`. Inactive owner records retain accounts/history but cannot be selected for new transactions.

The current-client Arabic display label for EGP is `جنيه`. Financial records store the ISO code where relevant. No currency conversion is included in MVP.

## 7.1 Decimal Precision and Posting Rounding

Use decimal arithmetic only; JavaScript floating point is prohibited for money, quantities, rates, discounts, allocations, unit costs, ratios, and profitability.

```text
official posted money: DECIMAL(18,2)
kg quantity: DECIMAL(18,3)
factory rate per ton: DECIMAL(18,2)
calculated unit cost per kg: DECIMAL(18,6)
persisted precise monetary allocation: DECIMAL(24,8)
ratio/proportion calculation: at least 12 decimal places
```

Intermediate calculations remain high precision. Use `ROUND_HALF_UP` only when an amount becomes an official posted document amount, account entry, payment, payable, receivable, or profitability snapshot. Do not round cost allocation, discount allocation, unit-cost, profitability, or ratio calculations early.

## 8. Signed Amount Convention

From company perspective:

```text
positive amount_signed = party owes company more
negative amount_signed = company owes party more or party has credit
```

| Event | Account | Sign |
| --- | --- | ---: |
| Customer sale receivable | customer | positive |
| Customer payment | customer | negative |
| Customer advance | customer | negative |
| Return credit/refund due | customer | negative |
| Supplier purchase payable | supplier | negative |
| Supplier payment by company | supplier | positive |
| Factory production payable | factory | negative |
| Factory payment by company | factory | positive |
| Customer-borne confirmed transport | customer | positive |
| Factory-borne amount recoverable/deduction | factory | positive after Accountant Review |

Negative financial account balance is valid and may represent company liability or party credit. It is not negative inventory.

## 9. Account Entry Rules

Every posted entry includes account, number/date, non-zero signed amount `DECIMAL(18,2)`, currency, entry type, source document, settlement state, optional reversal link, record origin/period/import metadata and actor/time.

Rules:

- immutable after posting;
- source document and entry number tenant-unique;
- correction uses opposite linked entry;
- balance is `SUM(amount_signed)`;
- each posting is created in the same transaction as its approved source effect;
- duplicate source/idempotency cannot create a second effective entry;
- worker users cannot read entry payloads.

Interpretation:

```text
balance > 0: party owes company
balance < 0: company owes party / party has credit
balance = 0: net settled
```

## 10. Customer Receivable

Approved sale creates one customer receivable per approved sale using the official posted document total:

```text
line_discount_share = line_gross_revenue / total_gross_revenue
line_allocated_discount_precise = order_discount_total × line_discount_share
line_net_revenue_precise = line_gross_revenue - line_allocated_discount_precise
customer receivable = +document_total_posted
```

For multi-line sales, calculate quantity × price at high precision and quantize each official line gross to two decimals using `ROUND_HALF_UP`. Calculate discount allocations at high precision from those gross lines, round each posted line discount to two decimals using `ROUND_HALF_UP`, then assign any discount residual to the largest gross-revenue line; ties use the lowest stable line number. Store the selected line's signed `rounding_adjustment`; the final stored posted discount includes that adjustment.

Required invariants:

```text
0 <= order_discount_total <= total_gross_revenue
total_gross_revenue = 0 implies order_discount_total = 0
sum(line_allocated_discount_posted) = order_discount_total
document_total_posted = sum(line_net_revenue_posted)
```

The official document total is never independently rounded or recalculated away from its stored posted lines. Do not subtract discount twice. Sale rejection/cancellation before approval creates no entry. Approved-sale correction/reversal creates opposite linked entries.

## 10.1 Customer Returns and Replacement

An approved customer return credit is a negative customer entry. For each returned line:

```text
return_credit_value
= returned_quantity × original_sale_line_approved_net_unit_value_after_allocated_discount
```

The original approved net unit value is snapshotted at `DECIMAL(18,6)`. Calculate credit at high precision and quantize the official credit to two decimals with `ROUND_HALF_UP` only when posted. Prior effective returns are included so cumulative return quantity and credit cannot exceed the remaining original approved sale-line quantity/value.

The final partial-return monetary residual policy is **Unresolved / requires owner/accountant decision** under PCD-RET-001. Until resolved, partial return credit posting is blocked; coding agents must not allow cumulative rounding to under-credit the final full return or exceed the original posted line net value.

Replacement is two linked events:

1. approved return receipt and return credit;
2. approved replacement order/issue using normal sales reservation and approval, creating a positive customer receivable equal to `replacement_order_approved_net_value`.

The linked entries determine the result: equal values net to no new receivable; a higher replacement leaves the difference owed; a lower replacement leaves customer credit. Refund is a separate payment action against customer credit and requires explicit Owner/Accountant treatment. Required links are original sale, original sale line, return request, and replacement order/issue. Workers cannot decide or receive these financial values.

## 11. Supplier Payable on Raw Receipt

When approved physical receipt has confirmed purchase amount:

- stock receipt posts;
- supplier account entry posts negative payable;
- source links to approved raw receipt/purchase fact;
- audit/approval commit atomically.

When price is missing:

- stock receipt is allowed;
- no estimated/zero supplier payable is created;
- receipt is flagged `needs_accountant_review`;
- Accountant/Owner later confirms price through a controlled transaction;
- that transaction snapshots price/amount, creates the payable once, and audits.

Late completion is append-only through `raw_purchase_price_confirmations`; it does not edit the approved receipt. The accepted quantity basis and authority are blocked by PCD-RAW-001. Concurrent/duplicate confirmation must create one effective payable and correction uses linked reversal/new confirmation.

No worker may enter/see supplier payable or price.

## 12. Factory Payable on Production Receipt

Payable is recognized only on approved output receipt.

For each receipt:

```text
cost_basis_input_qty_kg
= consumed_toward_output_qty + waste_qty

factory_payable
= cost_basis_input_qty_kg / 1000 × confirmed_rate_per_input_ton
```

Waste does not reduce payable. Each receipt creates one unique negative factory entry. Issue/transfer creates no payable. Partial receipts charge only their non-duplicated allocated input basis.

## 13. Payments

Payment stores positive absolute amount, direction, method, account, date, state, notes and optional attachment. Posting creates one signed account entry based on party/direction.

Direction uses the constrained company-perspective vocabulary in the Schema Contract. User-facing payment method keys remain blocked by PCD-PAY-001 and must not be guessed or seeded by a coding agent.

- Customer receipt: negative customer entry.
- Supplier/factory payment by company: positive supplier/factory entry.
- Payment and cost/payable remain separate records.
- No deletion of posted payment.

## 14. Partial Payments

One payment entry may settle one or more receivable/payable entries. Partial settlement leaves source entry partially settled. Settlement total cannot exceed available payment or unsettled source amount.

Balance is derived from all account entries regardless of settlement; settlement provides matching/aging detail.

## 15. Advance Payments

Advance is allowed without sale/payable source:

- customer advance creates negative customer balance;
- supplier/factory advance follows signed convention based on money direction;
- later settlement allocates advance to approved entries;
- advance is not silently transformed into a sale/payment edit.

## 16. Settlement Links

Settlement record links payment entry to target entry with positive amount and actor/time. Validate same tenant/account/currency and compatible signs/directions.

Settlement changes matching state, not the immutable signed amounts. Reversal creates reversal/unallocation records preserving original links/history.

## 17. Payment and Entry Reversal

Owner/Accountant only, reason required, idempotent and atomic.

- lock payment/entry/settlements/account;
- create opposite signed entry;
- reverse/unallocate settlement links through new records/status;
- mark payment reversed/link;
- audit;
- never delete/edit original.

## 18. Direct Costs and Transport

Transport/direct cost remains optional and must not block safe stock operations when unknown.

Internal dimensions remain separate:

```text
cost responsibility
actual payer
receivable/payable effect
profitability inclusion
settlement
```

### Worker Input

Only amount if known, simple responsibility (`company`, `customer`, `factory`, `shared`, `unknown`, `included_elsewhere`, `needs_accountant_review`) and notes. No actual payer, allocation, receivable/payable, settlement or profitability controls.

### Accountant/Owner Review

Confirms amount, actual payer, responsibility/allocations, subledger effect, profitability inclusion, settlement and correction/reversal.

### Posting Scenarios

- Company-borne: expense-like operational cost; no party receivable unless unpaid tracked vendor obligation is explicitly contracted; include in profitability only when reviewed/enabled.
- Customer-borne: confirmed amount may create positive customer receivable.
- Factory-borne: may create positive factory recovery/deduction after review.
- Shared: allocations must total confirmed amount or 100%; review required.
- Unknown/included elsewhere: no financial posting; review/not-required state as applicable.

No direct-cost subledger entry before required review, except a specifically approved simple company-borne configuration.

## 19. Profitability Model

MVP profitability is approximate and deterministic, not full costing.

```text
profit
= net_revenue
 - raw_material_cost
 - single_yarn_production_cost
 - twisting_cost
 - reviewed_included_direct_costs
 - return_impact
```

Because `net_revenue` already subtracts discount, discount is not subtracted again.

For multi-line sales, `net_revenue` means the sum of stored `line_net_revenue_posted` after proportional discount allocation and deterministic residual handling. Return impact uses the original approved line net unit value and subsequent approved return/replacement entries.

Missing required cost sets missing-cost flags and incomplete status; it is never silently treated as zero-complete profitability.

Waste increases effective output cost per kg because input/factory cost is carried by less output.

## 20. Immutable/Versioned Profitability Snapshots

- Version 1 at sale approval.
- New version after approved return, correction or reviewed cost completion.
- Old active version becomes superseded; row remains immutable.
- At most one active version.
- Reports use latest active version and show profile/version/date/components/missing flags/approximate label.
- Historical approved snapshots never silently recalculate.

Required values include gross revenue; precise/posted allocated discount; precise/posted net revenue; order discount total; rounding adjustment; document total posted; raw/single/twisting/direct/transport/return/replacement components; profit/margin; currency; profile/version; missing flags; reason and timestamp.

## 21. Historical Cost Preservation

Imported historical factory cost remains authoritative historical value even when current formula differs. Store imported cost, ERP comparison, basis, formula/calculated source, differences, warning and review/approval. This is not a live override.

## 22. State Transitions

```text
payment: draft → posted → reversed
payment: draft → cancelled

direct cost review:
  needs_accountant_review → reviewed → approved | rejected

profitability snapshot:
  active → superseded (new immutable active version inserted)

settlement:
  unsettled → partial → settled
  partial/settled → reversal/unallocation history on payment reversal
```

## 23. Permission Rules

- Owner: all balances/cost/profitability, approvals/reversals.
- Accountant: financial/operational balances, payments, settlements, cost review, profitability according to matrix.
- Warehouse/Production/Quality: no party balances, account entries, settlement, payer, allocations, rates, costs or profitability.
- Worker APIs omit restricted fields; CSS hiding is insufficient.
- Exports restricted to Owner/Accountant and internal-report use.

## 24. API Implications

SubledgerService owns entry creation/reversal/settlement. Source domain services call it within the same transaction. Route Handlers do not calculate signs or insert entries. Responses use role-filtered DTOs and deterministic signed-balance interpretation.

## 25. Testing Requirements

- Sale 100,000/payment 40,000 → customer balance +60,000.
- Customer advance 20,000 → balance -20,000 before sale.
- Supplier purchase 80,000/payment 30,000 → -50,000.
- Factory payable 150,000/payment 50,000 → -100,000.
- Missing-price receipt creates stock and no payable; price confirmation creates one payable.
- Partial/advance settlements and over-settlement rejection.
- Payment reversal creates opposite entry and settlement reversal.
- Partial production receipt charges allocated input including waste once.
- Customer/factory transport scenarios use correct signs after review.
- Workers cannot receive any restricted financial fields.
- Profitability uses net revenue without double discount.
- Multi-line discount allocations, largest-line residual and lowest-line-number tie break reconcile exactly.
- Official document total equals stored posted line nets; receivable equals that total.
- Midpoint official postings use `ROUND_HALF_UP`; intermediate values retain required precision.
- Replacement return credit uses the original approved net unit value and prior-return cap.
- Equal/higher/lower replacement values produce zero new receivable/difference owed/customer credit; refund is separate.
- New return/cost creates snapshot version, preserving old.
- Missing cost flags incomplete profitability.
- Negative party balance treated valid, not inventory alert.
- Imported historical cost preserved with comparison.
- Idempotent retry cannot duplicate entry/payment/snapshot.

## 26. Common Failure Cases

Wrong sign; balance stored/edited independently; floating-point money; early rounding; non-deterministic residual; document total calculated separately from stored lines; cost equals payment; payable at production issue; missing price posted as zero; over-settlement; original entry edited; worker financial exposure; responsibility conflated with payer; unreviewed direct-cost entry; discount double-subtracted; unlinked replacement issue; automatic replacement refund; profitability snapshot overwritten; missing cost silently zero; negative financial balance treated as stock error.

## 27. Acceptance Criteria

- Signed balances reconcile to immutable entries.
- Supplier/factory/customer triggers and signs are explicit.
- Payments/settlements/reversals preserve history.
- Missing price waits for review without blocking stock.
- Direct-cost responsibility/payer remain separate.
- Worker UX/API remains finance-free.
- Profitability is net-revenue-based, approximate, flagged and versioned.
- Historical costs remain preserved.

## 28. Notes for AI Coding Agents

Do not build a general ledger. Do not store editable balances as truth. Do not infer signs from UI labels. Do not create payable at issue or for missing price. Do not overwrite profitability snapshots. If a new financial scenario lacks sign/source/review rules, stop: **Unresolved / requires owner decision**.
