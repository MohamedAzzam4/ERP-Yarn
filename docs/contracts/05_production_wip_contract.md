# Production and WIP Contract

## 1. Purpose

Define outsourced single-yarn and twisting production so factory-held stock, issued WIP, output, waste, unprocessed returns, lineage, factory rate snapshots, and factory payables remain correct through full and partial production.

## 2. Scope

Production orders, factory locations, inputs/outputs, issue to production, WIP, partial receipts, waste, return from WIP, rate confirmation, live input-based factory cost, payable creation, corrections and worker/accountant responsibilities.

## 3. Non-Goals

- No internal factory capacity planning or scheduling engine.
- No automated blending UI in MVP.
- No output-based live factory cost.
- No worker-entered payable, allocation, profitability or accounting entry.
- No silent WIP adjustment.
- No effective-dated rate engine in MVP.

## 4. Source Documents and Sections Used

- Final Implementation Plan v4 §§4.5, 4.7–4.8, 8.5, 10.6, 13, 14.5, 15.8, 17, 19, 22.5, 23.5 and Phase 4/tests.
- Decision Log: DEC-007, DEC-011–DEC-014, DEC-017, DEC-023; Production Receipt and Factory Payable; Negative Stock; Imported Historical Cost Preservation.
- Database Schema Contract §§6, 9–12, 19.
- Inventory Posting Contract §§8–17.
- Technical Architecture Contract: server-side transaction/locking boundaries.
- Design System Contract: Worker Task Mode and financial-field restrictions.

## 5. Key Entities and Structures

- `external_factories` and linked `locations`;
- `production_orders`;
- `production_inputs`, `production_outputs`;
- `production_wip_balances`;
- `production_receipts` and receipt-input allocations;
- `production_waste_entries`;
- `production_wip_returns`;
- raw batches and yarn lots;
- stock movements/balances;
- factory accounts/entries;
- direct-cost review;
- approvals, audit and idempotency.

Each production receipt must allocate its consumed/waste input quantities to input rows so partial payables and lineage cannot be duplicated.

## 6. External Factories as Locations

Every factory has one linked inventory location. Company-owned material at that location remains ordinary on-hand until issued to production.

```text
at factory, not issued → factory on-hand
issued to production → WIP
received output → output on-hand
recorded waste → removed from WIP as waste
returned unprocessed → removed from WIP and restored to on-hand
```

Factory service-provider identity and inventory-location identity remain linked but distinct.

## 7. Production Types and Lineage

```text
raw material → outsourced single-yarn production → single-yarn lot
single-yarn lot → outsourced twisting → twisted-yarn lot
```

Schema is many-to-many capable:

- multiple input rows per order;
- multiple output rows/lots per order;
- one source batch/lot split across orders/factories;
- one order producing multiple lots.

MVP UI may select one input and one output initially. Services/repositories must still use child rows and may not hardcode a single header input foreign key.

## 8. Production States

```text
draft
material_issued
partially_received
completed
correction_requested
cancelled
reversed
```

Transitions:

```text
draft → material_issued
material_issued → partially_received | completed
partially_received → partially_received | completed
draft → cancelled
material_issued/partially_received/completed → correction_requested
approved correction/reversal → corrected linked state | reversed
```

Cancellation after issued WIP requires an approved return/correction; it cannot discard WIP.

## 9. Worker Draft Responsibilities

Production worker may enter:

- production type;
- factory;
- input item/lot;
- planned/issued quantity;
- expected output/waste if known;
- output quantity/lot facts;
- production/receipt dates;
- operational notes;
- return-from-WIP request facts.

Worker must not enter or receive:

- factory rate;
- factory payable;
- cost basis choice;
- direct-cost allocation;
- actual payer;
- profitability;
- account entries or settlement.

Incomplete financial-adjacent data routes to Accountant Review without corrupting safe operational facts.

## 10. Accountant/Owner Responsibilities

Accountant/Owner confirms:

- factory rate per input ton;
- input-based cost basis snapshot;
- payable trigger snapshot;
- financial review status/direct-cost treatment;
- receipt approval and factory payable;
- correction/reversal financial impact.

The default factory rate is only a suggestion. Confirmation is explicit and snapshotted. Default changes affect future unapproved transactions only.

## 11. Material-at-Factory Precondition

Before issue, input stock must exist as available on-hand at the factory's linked location. If material is elsewhere, an approved one-step transfer must occur first.

Production creation does not itself move stock. Issue to production is a separate posting transaction.

## 12. Issue to Production

Preconditions:

- order is `draft`;
- factory/location and input rows are valid and same tenant;
- available on-hand at factory covers issue quantity;
- input is not blocked/reserved inconsistently;
- Production worker has created/submitted the operational issue draft;
- Owner/Accountant has `production.issue.approve` under the Permission Matrix;
- idempotency key is unused/matching.

Transaction:

1. lock order/input/balance/WIP rows in deterministic order;
2. recheck availability;
3. insert `issue_to_production` movement;
4. decrease factory on-hand;
5. increase WIP;
6. update issued quantity/order state;
7. write audit;
8. commit atomically.

Issue creates no factory payable.

## 13. WIP Rules

WIP is input material no longer available as normal stock and not yet classified as output, waste, or return.

Invariant per input allocation:

```text
issued_qty
= consumed_to_output_qty
 + waste_qty
 + returned_from_wip_qty
 + remaining_wip_qty
```

All quantities use `DECIMAL(18,3)`. Rounding cannot create/erase inventory; discrepancies are reviewed.

WIP cannot be negative through ordinary operations. Only an explicit approved correction may represent a negative WIP inconsistency, and it must alert/reconcile.

## 14. Production Output Receipt

Worker records a receipt draft. Accountant/Owner approval posts operational and financial effects.

Required receipt data:

- production order;
- output lot/item/location;
- output quantity;
- input allocation consumed toward output;
- waste allocation, if any;
- receipt date;
- operational notes;
- confirmed rate/cost snapshots;
- idempotency key.

Approval transaction:

1. lock production order, receipt, input/WIP, output balance, factory account and relevant sequence/idempotency rows;
2. validate sufficient WIP and no duplicate receipt;
3. create output item/lot if contracted;
4. post `receive_from_production` movement and output on-hand;
5. reduce WIP by input consumed toward output;
6. post waste and reduce WIP separately;
7. create factory payable for the receipt cost basis;
8. update receipt/order totals/state;
9. write approval and audit;
10. commit all or nothing.

## 15. Waste

Waste is explicit, linked to order/receipt/input, visible in reporting and removed from WIP. It is not hidden yield loss.

For current client, waste does not reduce factory payable. It increases effective output cost per kg because less output carries the input/factory cost.

If output plus waste plus remaining/returned WIP does not reconcile to issued input, receipt approval fails or requires a separately approved correction.

## 16. Partial Production and Receipt

Partial receipts are allowed. Each receipt has its own input allocation, waste, output, rate snapshot, payable and idempotency key.

Example:

```text
issued input = 5,000 kg
receipt output = 2,500 kg
input consumed toward output = 3,000 kg
waste = 500 kg
remaining WIP = 1,500 kg
state = partially_received
```

For each receipt:

```text
factory_cost_basis_input_qty
= consumed_toward_output_qty + waste_qty
```

This preserves the input-based rule: waste does not reduce payable.

The system must prevent the same input quantity or waste from being allocated/payable twice across partial receipts.

## 17. Factory Rate and Cost Snapshot

Required snapshot:

```text
payable_trigger_used = production_receipt_approval
factory_cost_basis_used = input_quantity
factory_rate_per_ton_used DECIMAL(18,2)
factory_cost_basis_input_qty_kg DECIMAL(18,3)
calculated_factory_cost DECIMAL(18,2)
calculation_version
confirmed_by
confirmed_at
```

Live calculation:

```text
factory_payable
= factory_cost_basis_input_qty_kg / 1000
 × factory_rate_per_ton_used
```

Use decimal arithmetic only. The multiplication/division is calculated at high precision; calculated unit costs use `DECIMAL(18,6)` where persisted, and precise monetary allocations use `DECIMAL(24,8)`. Do not round input allocations, ratios, unit costs, or intermediate receipt calculations early.

The factory payable becomes official at approved receipt posting and is then quantized to `DECIMAL(18,2)` using `ROUND_HALF_UP`. If a receipt persists multiple monetary allocation lines, each posted line is rounded to two decimals and the receipt payable is the sum of stored posted lines; any residual follows the deterministic largest-basis-line, then lowest-stable-line-number rule and is stored as the selected line's `rounding_adjustment`. Changing factory defaults never recalculates approved receipts.

## 18. Factory Payable

Payable is created only on approved production output receipt—not on material transfer or issue.

Subledger entry:

```text
account owner = factory
amount_signed = negative payable amount
source = production_receipt
```

One unique payable source entry per approved receipt. Payment is separate from cost creation. Reversal/correction creates opposite linked entries; original is immutable.

## 19. Remaining Unprocessed Stock

- Material at factory but not issued remains factory on-hand.
- Issued but unresolved material remains WIP.
- Unprocessed material returning to stock uses `return_from_wip`.
- Remaining WIP cannot be silently closed when order completes.

Completion requires WIP reconciliation to zero for the completed scope, or an explicitly approved correction/exception recorded and alerted.

## 20. Return From WIP

Production worker may request return; Warehouse may confirm internal destination receipt when physically applicable. Owner/Accountant approves.

Preconditions:

- order is `material_issued` or `partially_received` (or correction state);
- WIP covers requested quantity unless explicit correction path;
- return location/item is valid;
- reason is present;
- not already posted.

Approval:

- lock order/WIP/return location balance;
- reduce WIP;
- create `return_from_wip` movement;
- increase on-hand at selected location;
- update input/order totals/state;
- route any financial impact to Accountant Review;
- audit/commit atomically.

Workers never enter payable, allocation, profitability or accounting effects for this correction.

## 21. Historical Production

Imported historical costs are preserved, not forced to live formula. Store imported cost, current-formula comparison, formula/source/basis/difference/warning/review/approval.

Historical cost preservation does not authorize live override. Imported production is approved through import batch and locked after commit.

## 22. Production Lineage

The traceability chain must resolve:

```text
input raw batch/single lot
→ issue movement
→ production input allocation
→ receipt/waste/WIP return
→ output single/twisted lot
→ output location
→ later transfer/sale/return/complaint
```

No summary field may replace child allocation lineage.

## 23. Permission Rules

- Owner: full production view, approve/reverse/correct, rate/cost/payable.
- Accountant: operational/financial production view and approvals according to matrix.
- Production: create/update own operational drafts, view WIP/locations; no financial fields.
- Warehouse: stock movements/physical receipt confirmation only where contracted.
- Quality: quality-related lot/test view/input; no production financial authority.

Backend response filtering is mandatory.

## 24. API Implications

Separate high-risk service commands for issue, receipt approval, WIP-return request/approval and correction. Route Handlers only authenticate, authorize, validate shape, call services and return deterministic results. Production service calls InventoryLedgerService and SubledgerService within one transaction context.

## 25. Testing Requirements

- 5,000 input / 4,250 output / 750 waste → payable uses 5,000 input; WIP zero.
- Partial example above leaves 1,500 WIP and charges 3,500 input basis.
- Midpoint payable values use `ROUND_HALF_UP` only at official receipt posting; high-precision intermediates remain unchanged.
- Multi-allocation receipt posted lines sum exactly to the posted factory payable and apply the deterministic residual/tie rule.
- Second receipt cannot reuse first allocation.
- Issue decreases factory on-hand/increases WIP exactly.
- Output receipt/waste effects reconcile.
- Return from WIP reduces WIP/increases selected on-hand.
- Insufficient WIP fails without partial output/payable.
- Rate/default change does not alter approved receipt.
- Duplicate idempotency key does not duplicate lot, stock or payable.
- Many inputs/outputs preserve lineage even if MVP UI uses one.
- Workers cannot receive rate/cost/payable/profit fields.
- Imported historical cost remains unchanged with comparison warning.
- Reversal creates linked inverse inventory/subledger effects.

## 26. Common Failure Cases

Factory stock treated as WIP before issue; WIP/output double-count; waste omitted; payable based on output; waste reducing payable; total order input charged again on every partial receipt; single input on header only; worker financial input; output stock posted without WIP reduction; WIP return as generic adjustment; rate changes recalculating history; correction editing original.

## 27. Acceptance Criteria

- Factory on-hand, WIP, output, waste and returns reconcile.
- Partial receipts cannot duplicate input/cost.
- Live payable uses approved receipt input basis and confirmed rate.
- Waste does not reduce payable.
- Many-to-many lineage remains possible.
- Worker/accountant duties are separated.
- Historical costs are preserved.
- Transactions are atomic, locked, idempotent and audited.

## 28. Notes for AI Coding Agents

Do not model production as a stock-location rename. Do not create payable at issue. Do not calculate live factory cost from output. Do not expose financial fields to workers. Do not close non-zero WIP silently. Do not use floating point or round intermediate allocations. If an allocation cannot reconcile under the contracted precision and residual rule, stop: **Unresolved / requires owner decision**.
