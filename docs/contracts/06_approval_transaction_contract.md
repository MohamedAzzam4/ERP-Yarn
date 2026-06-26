# Approval Transaction Contracts

## 1. Purpose

Define atomic approval, reversal, correction and import-commit transactions so no high-risk operation becomes a CRUD status update or leaves partial stock, WIP, account, snapshot, approval, or audit effects.

## 2. Scope

Sales approval, return approval, inventory adjustment, production receipt, payment reversal, post-approval correction, historical import commit, stock movement reversal, and `return_from_wip` approval.

## 3. Non-Goals

- No UI approval layout.
- No approval-threshold rule engine.
- No bulk auto-approval.
- No direct mutation of approved originals.
- No full accounting posting engine.

## 4. Source Documents and Sections Used

- Final Implementation Plan v4 §§4.8–4.12, 7.2, 10.3, 14, 20–22, 24–27.
- Decision Log: DEC-015, DEC-022, DEC-024, DEC-028, DEC-032; Approval Failure; historical/negative/WIP-return decisions.
- Database Schema Contract §§7, 9–19.
- Inventory Posting Contract and Production/WIP Contract.
- Technical Architecture Contract: Node Route Handlers, Drizzle/PostgreSQL transactions, locks/idempotency.

## 5. Common Required Structures

- business document and state;
- `approval_requests`;
- durable idempotency record/key;
- affected ledger/balance/WIP/account rows;
- immutable audit log;
- reversal/correction links;
- authenticated actor/tenant/permission.

## 6. Universal Approval Contract

For this contract, a posting is an official durable business effect in inventory, production, reservations, subledger, payments, payables/receivables, or profitability. Examples include a stock movement, official quantity change, reservation consumption/release, output receipt, account entry, settlement, and profitability snapshot. Audit/failure logs, alerts, validation outcomes, and failure-status updates are official audited records but are not sale, stock, or account postings.

Every high-risk approval:

1. derives tenant/user from authenticated server context;
2. checks permission and field/action scope;
3. validates request and required reason;
4. checks current entity/approval state and verifies the server-computed subject version/hash matches the pending request;
5. claims/replays idempotency key, including deterministic recovery of an expired/orphaned in-progress lease;
6. starts database transaction;
7. locks entity, approval and affected rows in deterministic order;
8. rechecks all business preconditions under lock;
9. performs all stock/WIP/subledger/snapshot/document writes;
10. records approval decision and success audit in the same transaction;
11. commits once and returns deterministic result.

Requester-versus-approver behavior is blocked by PCD-APR-001. Until resolved, an agent must not implement self-approval as a convenience; affected approval packages remain blocked or use an explicitly approved safe-deny policy.

If any required write/audit fails, all business writes roll back.

The Route Handler contains no posting logic beyond auth, permission, structural validation, service invocation and response mapping.

## 7. Idempotency and Failure Recording

- Every contract requires `Idempotency-Key`.
- Same key/same request returns stored result.
- Same key/different request returns conflict.
- Processing collisions return deterministic in-progress/conflict behavior.
- An expired/orphaned in-progress lease is atomically reclaimed after checking unique source/effect constraints; it cannot produce an indefinite conflict.
- Unique source-entry/movement/snapshot constraints provide defense in depth.
- No failed operation creates partial posting.

Successful audit is in the business transaction. A failed attempt may be recorded after rollback in a separate non-posting audit/idempotency outcome transaction; that failure record must not imply approval or mutate business ledgers.

### 7.1 Technical/System Failure

Database timeout, non-safely retried deadlock, network/connection failure, server crash, or unexpected exception is a technical/system failure. Roll back the whole transaction. Create no stock movement, official quantity change, reservation consumption/release, account entry, payable/receivable, settlement, or profitability snapshot. Do not change business status to `approval_failed`; leave the prior sale/request/reservation state retryable. Record an opaque technical failure and show:

```text
لم يتم تسجيل العملية بسبب خطأ في النظام. برجاء المحاولة مرة أخرى.
```

### 7.2 Business-Precondition Failure

Insufficient stock, invalid reservation, blocked item, missing required data/price/cost review, quality restriction, or invalid quantity is a business-precondition failure. The approval posting transaction creates none of the durable business effects listed above. Record the reason in audit. For sales only, a separate failure-resolution transaction may set `approval_failed` or `needs_review` and update reservation state according to §8. Other workflows remain pending, enter their already-contracted review/correction state, or use an explicitly documented status. Do not add `approval_failed` globally or invent a new status.

## 8. Sales Approval Contract

### Preconditions

- sale state `pending_approval`;
- active reservation for every line;
- Owner/Accountant with `sales.approve`;
- customer/items/locations active and tenant-valid;
- quality-risk conditions have required reason/authority;
- on-hand/reservation still valid;
- gross/discount/net totals valid.
- pending approval subject version/hash still matches every approval-relevant sale and line field;
- quality-risk stock follows DEC-065: it cannot be reserved/submitted until review/disposition makes it accepted/sellable.

### Rows to Lock

Sale, lines, approval request, reservations, inventory balances in deterministic order, customer account, document/idempotency rows, active profitability snapshot scope.

### Writes and Side Effects

- consume reservations;
- reduce reserved and on-hand;
- create `sale_issue` movements;
- create customer receivable `+net_revenue`;
- create immutable profitability snapshot v1 with missing-cost flags;
- set sale/approval approved/locked;
- audit.

### Failure/Rollback

For a business-precondition failure, the sale approval posting transaction rolls back and creates no posting. A separate safe, audited failure-resolution transaction applies the reason mapping:

- missing/corrupted reservation: mark reservation `failed`, reconcile materialized reserved quantity, create a critical alert, and set the sale's contracted failure/review state;
- stock shortfall: retain reservation and set sale for review; do not release automatically;
- quality block: retain reservation and set sale for review; do not release automatically;
- missing price/commercial data: normally block before submission; if discovered later, retain reservation for review;
- human rejection/cancellation: use §17 and explicitly release once with audit.

That separate transaction creates no sale issue, receivable, or profitability snapshot. `approval_failed` is primarily a sales lifecycle status, distinct from human `rejected`; `needs_review` may be used where the reason requires review. Authorized management may revise, cancel, or resubmit only after the resolution state permits it. A technical/system failure follows §7.1 and leaves sale, request, and reservation business state unchanged.

### Separate Sales Failure-Resolution Transaction

This is a dedicated idempotent transaction after the failed approval posting has rolled back. It locks sale, approval request, reservations, affected balance rows, alert and idempotency rows; rechecks the classified failure and current subject/reservation versions; applies exactly one reason-specific status/reservation outcome from §8; writes alert/audit; and creates no sale movement, receivable or profitability snapshot. A stale or changed failure reason conflicts and requires re-evaluation.

## 9. Return Approval Contract

### Preconditions

- return `pending_approval`;
- source sale approved;
- quantity per line ≤ sold minus effective prior returns;
- treatment is one approved value;
- return location/status valid;
- Owner/Accountant permission.
- final partial-return monetary residual follows DEC-068 before partial return credit posting is enabled.

### Rows to Lock

Return/lines, source sale/lines, prior returns, return-location balances, customer account, approval/idempotency rows.

### Writes and Side Effects

- `return_receipt` movement;
- increase on-hand and returned quantity;
- block/unavailable state based on classification;
- create customer credit/refund-due entry only when treatment requires it;
- for `replacement`, create the return credit from returned quantity multiplied by the original approved sale line net unit value after allocated discount, capped by the remaining original line value after prior returns;
- preserve links to original sale, original sale line, return request, and replacement order/issue;
- update sale partial/full return state;
- approve/lock return and audit.

Failure leaves no stock or financial change.

### Linked Replacement Issue/Sale

Replacement fulfillment is a second approved event, not a manual stock difference. Its order is linked to the approved return and follows ordinary sales submission, reservation, quality, approval, issue, discount-allocation, receivable, profitability, concurrency, and idempotency rules. Its customer receivable equals the replacement order's approved posted net value.

The return credit entry and replacement receivable entry produce the difference naturally: equal values leave no net new receivable; a higher replacement leaves the difference owed; a lower replacement leaves customer credit. A refund is a separate Owner/Accountant-approved payment against that credit and is never created automatically by replacement treatment. Workers record return/replacement operational facts only; Owner/Accountant decides and approves financial treatment.

## 10. Inventory Adjustment Approval Contract

### Preconditions

- adjustment pending, reason/direction/item/location/quantity valid;
- Owner/Accountant `inventory.adjustment.approve`;
- negative adjustment respects protected/available dimensions unless approved correction/historical exception.

### Locks

Adjustment, approval, balance, affected reservations/classifications where relevant, idempotency.

### Writes

Create adjustment movement, update balance, mark approved/linked, create negative-stock alert if approved exception produces negative, audit.

No direct balance rewrite. Failure rolls back.

## 11. Production Receipt Approval Contract

### Preconditions

- order `material_issued`/`partially_received`;
- receipt draft/pending and not posted;
- sufficient WIP per input allocation;
- output/waste quantities valid;
- factory rate and input basis confirmed;
- Owner/Accountant `production.approve`.

### Locks

Order, receipt/input/output allocations, WIP rows, output item/lot/balances, factory account, sequence, approval/idempotency.

### Writes

- create output lot if new;
- output/waste movements;
- decrease WIP by consumed plus waste allocations;
- increase output on-hand;
- create factory payable from receipt input basis;
- update totals/state;
- approve/lock receipt;
- audit.

Failure creates no output, waste, WIP reduction or payable.

## 12. Return-From-WIP Approval Contract

### Preconditions

- approved production correction request with reason;
- order state supports correction;
- WIP sufficient unless explicit inconsistency correction;
- return item/location valid;
- Owner/Accountant permission.

### Locks

Order/input, WIP-return request, WIP row, destination balance, approval/idempotency and financial-review record.

### Writes

- decrease WIP;
- create `return_from_wip` movement;
- increase destination on-hand;
- update input/order/correction state;
- set Accountant Review when financial effect unresolved;
- approve/audit.

No worker-created payable/cost/profitability/account entry. Failure leaves WIP/on-hand unchanged.

## 13. Payment Reversal Contract

### Preconditions

- payment `posted`, not reversed;
- reason required;
- Owner/Accountant `payments.reverse`;
- settlement dependencies identified.

### Locks

Payment, posted account entry, settlement links/settled entries, account, approval/idempotency.

### Writes

- opposite signed immutable account entry;
- reversal settlement records/unallocation preserving history;
- payment state reversed/link;
- audit.

Original payment/entry is not deleted/edited. Over-reversal or already-reversed request fails safely.

## 14. Post-Approval Correction Contract

### Preconditions

- original approved/posted/locked;
- correction request with reason and proposed scope;
- Owner/Accountant permission appropriate to domain;
- dependency analysis complete.
- for a committed historical original, renewed dual approval under DEC-070 is satisfied before correction posting.

### Locks

Original, correction/approval, affected downstream documents/ledgers, idempotency and sequence if new corrected document.

### Writes

- approve correction request;
- domain-specific reversal/adjustment;
- new corrected document where required;
- `correction_of_id`/reversal links;
- new snapshots/entries rather than mutation;
- audit.

No generic correction may bypass inventory, WIP, subledger or historical rules.

## 15. Historical Import Commit Contract

### Preconditions

- batch reconciled;
- no blocking validation errors;
- all warnings explicitly accepted;
- aliases/master mappings resolved;
- both Owner and Accountant approvals recorded;
- backup exists, except documented demo-only waiver;
- batch not committed/cancelled;
- idempotency key valid.

### Locks

Import batch/approvals/idempotency, affected sequences/master records/balances/accounts in deterministic import order.

### Writes

- create operational records through domain posting services;
- classify `approved`, `historical`, imported origin, locked and batch-linked;
- preserve source/formula/historical cost metadata;
- insert stock movements/account entries/snapshots as reconciled;
- audit commit;
- mark batch committed.

AI/staging rows never bypass validation/domain services. Current MVP commit must be transactionally all-or-nothing for the supported batch size. If batch size cannot safely fit, stop and define a separately approved resumable logical-atomic design in the historical migration contract.

## 16. Stock Movement Reversal Contract

### Preconditions

- movement posted/not previously reversed;
- reason and Owner/Accountant permission;
- downstream dependencies checked;
- inverse is valid or domain correction selected.

### Locks

Original movement, source document, affected balances/reservations/WIP/domain records, approval/idempotency.

### Writes

Opposite linked movement, balance/domain inverse, reversal state/link and audit. Original remains posted history. Failure leaves all unchanged.

## 17. Human Rejection and Cancellation

Human rejection is not `approval_failed`.

For pending sale, rejection/cancellation locks sale/reservations, releases each active reservation once, sets rejected/cancelled, decides approval request, and audits atomically. Approved sales cannot be cancelled directly; use correction/reversal.

Other pending documents follow their domain cancellation rules and cannot discard posted dependencies.

## 17.1 Raw Receipt Approval and Late-Price Confirmation

Raw receipt approval requires submitted receipt, active tenant masters, positive accepted weight, valid location, Owner/Accountant permission, current subject hash and idempotency. Lock receipt/batch, approval, item/location balance, supplier account when price is confirmed, sequence and idempotency rows.

Approval creates the raw item/batch identity, `raw_receipt` movement, on-hand balance, and—only when the contracted price/basis is confirmed—the negative supplier payable, then locks/approves/audits atomically. If price is absent, stock posts and a review item is created with no zero/estimated payable.

Late price uses the append-only `raw_purchase_price_confirmations` transaction: apply DEC-067, lock source receipt/confirmation/supplier account, calculate from net accepted kg at high precision, post one payable, link confirmation and audit. Duplicate/concurrent confirmation creates one effective payable. Correction reverses the prior entry and creates a new confirmation; it never edits the approved receipt.

## 17.2 Transfer Approval

Transfer approval requires submitted source/destination/item/classification quantities, Owner/Accountant permission, current subject hash and idempotency. Lock transfer, approval, source/destination balance and classification rows in deterministic order. Recheck available/protected quantities, then create source decrease and destination increase in one InventoryLedgerService transaction and audit.

Ordinary transfer supports only accepted/sellable unblocked available stock under DEC-064. Partially blocked, returned, discounted-return or risky classification stock is blocked from ordinary transfer until approved disposition/correction makes the quantity explicitly transferable. No target-balance write, in-transit workflow, or partial side is permitted.

## 17.3 Payment Posting and Settlement

Payment posting requires an approved draft, party/account/currency, positive amount, contracted direction/method, Owner/Accountant permission, current subject hash and idempotency. Lock payment, account, sequence and idempotency; create exactly one immutable signed entry through SubledgerService; set posted state and audit atomically.

Settlement requires posted compatible opposite-sign entries in the same tenant/account/currency. Lock account, payment entry, target entries and existing settlements in deterministic order; reject over-settlement; insert settlement records/update derived settlement states and audit atomically. Concurrent settlements cannot exceed either available side. Payment reversal follows §13 and conflicts safely with concurrent settlement.

## 17.4 Direct-Cost Financial Posting

Direct-cost posting requires completed Accountant/Owner review of amount, responsibility, actual payer, allocations, subledger effect and profitability inclusion, plus current subject hash and idempotency. Lock direct cost/allocations, linked source, affected accounts/snapshot scope and approval/idempotency rows. Validate allocations equal the total/100%, post only contracted party entries through SubledgerService, create a new profitability snapshot version where included, mark reviewed/approved and audit atomically.

Unknown or included-elsewhere treatment creates no financial entry. Worker suggestions never authorize payer/allocation/posting.

## 18. Permission Rules

- Owner/Accountant approve financial/stock high-risk transactions per permission matrix.
- Only both Owner and Accountant together authorize historical commit.
- Workers may request/prepare operational drafts but cannot approve/reverse financial or stock effects.
- Quality may contribute investigation/status, never approve financial treatment alone.
- Only Owner manages user/permission changes.
- Backend checks permission; frontend visibility is not authority.

## 19. API Implications

Each operation has a dedicated command endpoint/service; no generic `PATCH status=approved`. Request body contains decision reason/operation fields/idempotency, never authoritative tenant/actor/role. Responses include deterministic entity state, document number and effect references allowed by role.

## 20. Testing Requirements

For every contract test success, precondition failure, duplicate retry, changed-payload key conflict, concurrency attempt, audit failure and injected mid-transaction failure.

Critical assertions:

- no partial stock/WIP/account/snapshot writes;
- duplicate approval/reversal prevented;
- correct lock/recheck under concurrency;
- technical/system failure rolls back and leaves business/reservation state unchanged and retryable;
- sale business-precondition failures create no posting and use the reason-specific reservation mapping;
- `approval_failed` is limited to the sales lifecycle unless another workflow explicitly contracts it;
- human rejection releases reservation once;
- return quantity cap works;
- replacement return credit uses original approved net unit value, respects prior-return value cap, and links to a normally approved replacement sale;
- equal/higher/lower replacement values yield zero/difference owed/customer credit respectively; refund remains separate;
- production receipt payable and WIP atomic;
- WIP return atomic;
- payment reversal preserves original/settlements;
- historical commit requires dual approval and locking;
- failed audit insert rolls back successful-path business writes;
- worker permission denied before state mutation.

## 21. Common Failure Cases

Status-only approval; permission checked only in UI; stale preconditions; no row locks; audit outside success transaction; duplicate retry; technical failure changing business state; automatic reservation release for every precondition failure; movement succeeds but account fails; payable without output; unlinked replacement stock difference; automatic replacement refund; historical partial commit; original payment/movement edited; rejection confused with system failure; generic correction bypassing domain services.

## 22. Acceptance Criteria

- Every requested high-risk operation has preconditions, permission, locks, writes, audit, idempotency and rollback.
- No operation can partially post.
- Success audit and business effects share a transaction.
- Failure state is distinct from rejection.
- Original posted records remain immutable.
- Domain services own ledger effects.
- Concurrent/retried requests remain deterministic.

## 23. Notes for AI Coding Agents

Never implement approval as CRUD status update. Never add a generic approval endpoint or transaction helper that omits domain locks/writes. Never catch and continue after a ledger/audit error. If a side effect is unclear, stop: **Unresolved / requires owner decision**.
