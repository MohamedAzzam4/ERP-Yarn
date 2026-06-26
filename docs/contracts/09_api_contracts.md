# High-Risk API Contracts

## 1. Purpose

Define the server API boundary for high-risk ERP commands so later Route Handlers cannot invent request fields, permissions, state transitions, posting logic, errors, idempotency, audit, or partial-write behavior.

## 2. Scope

Raw receipt approval/late-price confirmation, transfer approval, sales submission/approval/failure resolution/rejection/cancellation, returns, adjustments, production issue/receipt/WIP return, payment posting/settlement/reversal, direct-cost posting, movement reversal, post-approval correction, historical import commit, and backup/restore status actions.

## 3. Non-Goals

- No route source code.
- No ordinary read/list CRUD contract.
- No frontend form specification.
- No generic status-patch or generic approval endpoint.
- No business logic in UI components or Route Handlers.
- No production restore endpoint.

## 4. Source Documents and Sections Used

- Final Implementation Plan v4 §§7.2, 14, 20–22 and relevant phase tests.
- Decision Log: atomic approvals, idempotency, worker filtering, historical locking, backup and correction decisions.
- Technical Architecture Contract: Next.js Node Route Handlers, Supabase Auth, Drizzle/PostgreSQL, secrets and environments.
- Database, Inventory, Production/WIP, Approval, and Subledger/Costs contracts.
- Design System Contract: role-safe responses and error/feedback accessibility.

## 5. Common API Requirements

Base path:

```text
/api/v1
```

Every high-risk command requires:

- authenticated Supabase server session;
- ERP user/tenant mapping from server context;
- backend permission check;
- `Idempotency-Key` header;
- content-type/request schema validation;
- entity state precondition;
- server-computed approval subject version/hash match for approval decisions;
- application service invocation;
- one atomic database transaction for business effects;
- audit requirement;
- deterministic response/error;
- role/field-filtered response.

Do not accept authoritative `tenant_id`, actor, role, approval status, calculated balance, stock delta, cost, payable sign, or profitability total from the request body.

An orphaned/expired idempotency `in_progress` lease is recovered under the Database Schema Contract: atomically reclaim, inspect unique source/effect constraints, return an already-committed result if found, otherwise retry safely. Do not leave the same request in an indefinite `OPERATION_IN_PROGRESS` state.

## 6. Route Handler Boundary

Route Handlers may:

1. authenticate;
2. derive tenant/user;
3. check coarse permission;
4. parse/validate request shape;
5. call one application command service;
6. map service result/error to HTTP response.

They must not implement inventory calculations, lock ordering, WIP allocation, sign convention, payable creation, settlement, profitability, import commit, approval transitions, or audit composition. UI components contain no business posting logic.

## 7. Standard Response and Error Behavior

Success includes:

```text
request_id
idempotency_key
entity_id
doc_no where allowed
status
effect references allowed by role
completed_at
```

Never return secrets, SQL details, stack traces, forbidden financial fields, or another tenant's identifiers.

Standard errors:

| Code | Typical HTTP | Meaning |
| --- | ---: | --- |
| `AUTH_REQUIRED` | 401 | No valid server-authenticated user |
| `FORBIDDEN` | 403 | Permission/field/action denied |
| `NOT_FOUND` | 404 | Entity absent in authenticated tenant |
| `VALIDATION_FAILED` | 422 | Request shape/value invalid |
| `STATE_CONFLICT` | 409 | Entity not in required state |
| `SUBJECT_CHANGED` | 409 | Pending approval subject version/hash no longer matches |
| `IDEMPOTENCY_CONFLICT` | 409 | Same key, different request |
| `OPERATION_IN_PROGRESS` | 409 | Same idempotent operation still processing |
| `STOCK_INSUFFICIENT` | 409 | Available/on-hand insufficient |
| `RESERVATION_INVALID` | 409 | Reservation missing/inactive/mismatched |
| `QUALITY_BLOCKED` | 409 | Risk approval absent/invalid |
| `WIP_INSUFFICIENT` | 409 | WIP cannot cover allocation |
| `RETURN_QTY_EXCEEDED` | 409 | Return exceeds remaining sold quantity |
| `SETTLEMENT_CONFLICT` | 409 | Settlement/reversal invalid |
| `BLOCKING_MIGRATION_ERRORS` | 409 | Import cannot commit |
| `DEPENDENCY_CONFLICT` | 409 | Reversal/correction has unresolved dependencies |
| `INTERNAL_TRANSACTION_FAILED` | 500 | Atomic transaction rolled back |
| `SERVICE_UNAVAILABLE` | 503 | Database/provider unavailable |
| `OWNER_DECISION_REQUIRED` | 409 | A named unresolved owner decision blocks this operation |

System errors include an opaque request/error ID. Authorization failures do not disclose whether a forbidden entity exists.

Technical/system approval failures return a retryable error, roll back every business effect, and leave business/reservation state unchanged. The Arabic UI message is:

```text
لم يتم تسجيل العملية بسبب خطأ في النظام. برجاء المحاولة مرة أخرى.
```

Business-precondition errors return their stable domain code and may trigger a separate audited sales failure-resolution command. An audit/failure record or status update is an official record but is not a sale, stock, reservation, account, or profitability posting.

## 8. Submit Sale for Approval

```text
POST /api/v1/sales/:saleId/submit-for-approval
permission: sales.submit
```

Request: optional Arabic reason/notes; no stock deltas or totals from client; idempotency header required.

`sales.submit` is an Owner/Accountant management action in MVP because a warehouse-created operational draft contains no authorized price. Warehouse may create/update an enabled operational sales draft, but cannot invoke this posting/reservation submission until authorized management completes commercial fields.

Preconditions: sale is `draft` or an authorized revised `approval_failed`/`needs_review` sale whose prior reservation state has been resolved according to its failure reason; lines valid; customer/item/location active; Accountant/Owner-completed quantities/prices/totals valid; available stock covers every line; no unresolved forbidden quality state. DEC-065 allows reservation/submission only for accepted/sellable stock; `needs_review`, blocked, discounted-return or other quality-risk stock must go through review/disposition first. Resubmission must not assume every prior failure released reservations.

Transaction: lock sale/lines/balances; create reservations; update reserved balances; create approval request; set pending; audit.

Response: pending sale and reservation summary filtered by role. Errors include stock/quality/state/idempotency. Failure creates no reservation/partial state.

## 9. Approve Sale

```text
POST /api/v1/sales/:saleId/approve
permission: sales.approve
```

Request: decision reason required for quality-risk/discount exception, optional decision notes; no calculated effects.

Preconditions/transaction: Approval Contract §8. Locks sale/lines/reservations/balances/customer account/snapshot scope; consumes reservations; posts issues/receivable/snapshot; approves/audits.

Success returns approved sale and allowed effect references. A business-precondition failure creates no sale approval posting. A separate audited failure-resolution transaction applies the contracted reason mapping: corrupted reservation fails/reconciles/alerts; stock shortfall, quality block, or late commercial issue retains reservation for review; human reject/cancel releases explicitly. It may set the sale to `approval_failed` or `needs_review` as contracted. A technical/system failure leaves the pending sale, request, and reservation unchanged and retryable. No partial posting.

## 10. Reject or Cancel Pending Sale

```text
POST /api/v1/sales/:saleId/reject
permission: sales.approve

POST /api/v1/sales/:saleId/cancel
permission: sales.cancel
```

Request: required reason. Preconditions: pending for reject; draft/pending and actor-authorized for cancel; approved sale is not cancellable here.

Transaction: lock sale/approval/reservations/balances; release each active reservation once; set rejected/cancelled; decide approval/audit. Success returns state/release summary. Approved sale returns `STATE_CONFLICT` and must use correction/reversal.

## 11. Approve Return

```text
POST /api/v1/returns/:returnId/approve
permission: returns.approve
```

Request: approved return financial treatment, returned-stock classification, decision reason/notes. Client cannot submit balance deltas, account-entry signs, return-credit values, replacement receivable, or other calculated effects.

Preconditions/locks/writes: Approval Contract §9. Posts return stock/classification/customer entry when required, updates sale return state, approves/audits atomically. Return lines must reference the original sale and original sale line. For `replacement`, the server calculates return credit from the original approved line net unit value after allocated discount and enforces prior-return quantity/value caps. Partial return credit posting follows DEC-068: the final effective return adjusts the residual so cumulative posted credits equal and never exceed the original posted sale-line net value.

The linked replacement order is a normal sales order: it stores `return_request_id` and original-sale links, reserves on submission, and uses `/sales/:saleId/approve` for issue, approved net receivable, and profitability. Before replacement approval, the server requires the return/replacement linkage and applicable approved return state. Equal/higher/lower value outcomes are derived from the linked negative return credit and positive replacement receivable. Refund uses a separate payment command and is never an automatic side effect.

Errors: quantity exceeded, invalid treatment/classification, state/dependency/idempotency. No partial stock/credit.

## 12. Approve Inventory Adjustment

```text
POST /api/v1/inventory/adjustments/:adjustmentId/approve
permission: inventory.adjustment.approve
```

Request: decision reason; explicit confirmation of controlled negative exception when the pre-approved adjustment type permits it. No arbitrary target balance.

Preconditions/transaction: Approval Contract §10. Posts movement/balance and negative alert if applicable. Ordinary insufficient/protected stock fails. No direct balance mutation.

## 13. Issue Material to Production

```text
POST /api/v1/production/orders/:orderId/issue
permission: production.issue.approve
```

Request:

```text
input allocations: production_input_id + quantity_kg
issue_date
operational_notes optional
```

The Production worker prepares and submits an issue draft through the lower-risk draft workflow. The high-risk `/issue` command is executed by Owner/Accountant under the Permission Matrix. No rate/cost/payable fields are accepted from worker clients.

Preconditions/transaction: order draft, factory stock available, allocations valid. Locks order/inputs/balances/WIP; posts issue, decreases factory on-hand, increases WIP, updates state/audits atomically.

## 14. Receive Production Output

```text
POST /api/v1/production/orders/:orderId/receipts/:receiptId/approve
permission: production.approve
```

Worker may save receipt draft through a lower-risk screen contract; this high-risk endpoint approves/posts it.

Request: decision notes and confirmation token/reference for already server-stored receipt/rate snapshot. Do not trust client-calculated payable.

Preconditions/transaction: Approval Contract §11. Locks WIP/output/factory account; posts output/waste, reduces WIP, creates payable, updates order and audits. Failure leaves all unchanged.

## 15. Request Return From WIP

```text
POST /api/v1/production/orders/:orderId/return-from-wip-requests
permission: production.return_from_wip.request
```

Request:

```text
production_input_id
quantity_kg
return_location_id
reason
operational_notes optional
```

Preconditions: appropriate order state, positive quantity, tenant-valid location/input. Creates pending correction request only—no WIP/on-hand/account effect. Worker response contains no financial data.

## 16. Approve Return From WIP

```text
POST /api/v1/production/return-from-wip-requests/:requestId/approve
permission: production.return_from_wip.approve
```

Request: decision reason/notes. Preconditions/transaction: Approval Contract §12. Reduces WIP, posts movement, increases on-hand, updates order/review/audit atomically. Failure leaves quantities unchanged.

## 17. Reverse Stock Movement

```text
POST /api/v1/inventory/movements/:movementId/reverse
permission: inventory.reverse
```

Request: required reason. Preconditions: posted/not reversed, dependencies checked. Transaction locks movement/domain/balances, creates inverse and audit. If domain correction required, return `DEPENDENCY_CONFLICT` with safe correction type/reference, not partial inverse.

## 18. Reverse Payment

```text
POST /api/v1/payments/:paymentId/reverse
permission: payments.reverse
```

Request: required reason. Transaction per Approval Contract §13: opposite entry, settlement reversal/unallocation, payment state/link and audit. Original remains. Already reversed/settlement conflict fails safely.

## 19. Request Post-Approval Correction

```text
POST /api/v1/:module/:entityId/correction-requests
permission: <module>.request_correction
```

Allowed `module` values are an explicit server allowlist, not arbitrary table names.

Request: correction type, reason, proposed corrected operational values allowed by module; no direct ledger deltas. Creates request only and returns pending reference.

Approve correction:

```text
POST /api/v1/correction-requests/:requestId/approve
permission: <module>.correct
```

Runs domain-specific Approval Contract §14. Generic table update is prohibited.

## 20. Commit Approved Historical Import

```text
POST /api/v1/migration/import-batches/:batchId/commit
permission: migration.commit
```

Request: confirmation that warnings/reconciliation approvals are already recorded; no transformed rows in body.

Preconditions: reconciled, no blockers, warnings accepted, aliases resolved, both Owner and Accountant approval, backup/waiver rule, not committed.

Transaction: Approval Contract §15. Commits from server staging through domain services, classifies/locks history, preserves metadata, posts reconciled effects and audit. AI output cannot call a direct-operational import route.

## 20.1 Approve Raw Receipt

```text
POST /api/v1/inventory/raw-receipts/:receiptId/approve
permission: inventory.receive.approve
```

Request: decision reason/notes and idempotency only; no stock delta, payable, price calculation or account sign. Preconditions/locks/effects follow Approval Contract §17.1 and DEC-067 for any price-dependent payable. Success returns approved receipt, movement and permitted payable/review references. Errors include `SUBJECT_CHANGED`, invalid master/location/weight and duplicate source. Atomic stock/payable/audit or none.

## 20.2 Confirm Late Raw Price

```text
POST /api/v1/inventory/raw-receipts/:receiptId/price-confirmations
permission: inventory.receive.approve
```

Request: server-stored confirmation reference or permitted price-per-ton input under DEC-067, reason and idempotency; never a calculated payable/sign. Requires approved receipt with no effective confirmation. Locks source/confirmation/supplier account; calculates payable from net accepted kg; posts one append-only confirmation/payable/audit. Concurrent duplicate returns deterministic replay/conflict. Correction uses the generic approved correction path, not overwrite.

## 20.3 Approve Transfer

```text
POST /api/v1/inventory/transfers/:transferId/approve
permission: inventory.transfer.approve
```

Request: decision reason/notes and idempotency; no target balances. Requires submitted current-hash transfer and accepted/sellable unblocked available stock under DEC-064. Locks source/destination/classification rows and posts both sides/audit atomically. Any blocked, needs-review, returned, discounted-return or risky classification request returns `OWNER_DECISION_REQUIRED` or the contracted disposition-required error until approved disposition/correction makes the stock transferable.

## 20.4 Resolve Failed Sales Approval

```text
POST /api/v1/sales/:saleId/resolve-approval-failure
permission: sales.approve
```

Request: stored failed-attempt reference, optional authorized resolution notes and idempotency. The client cannot choose or rewrite the classified failure reason. The server reloads the audited failure, verifies no sale posting exists and applies Approval Contract §8 separate resolution. Technical failures are not eligible. Success returns role-safe status/reservation/alert references; it never returns a sale posting effect.

## 20.5 Post Payment and Settle

```text
POST /api/v1/payments/:paymentId/post
permission: payments.approve

POST /api/v1/payments/:paymentId/settlements
permission: payments.approve
```

Payment-post request contains reason/notes and idempotency, not signed entry/balance. User-facing method validation uses DEC-066 keys only: `cash`, `bank_transfer`, `check`, `wallet_instapay`, and `other`. Settlement request contains target entry IDs and positive allocation amounts; server derives compatibility/sign/remaining capacity. Locks and effects follow Approval Contract §17.3. Errors include subject/state/idempotency/settlement conflicts. Posting/settlement/audit is atomic; concurrent allocations cannot over-settle.

## 20.6 Post Reviewed Direct Cost

```text
POST /api/v1/direct-costs/:directCostId/post
permission: direct_costs.review
```

Request: decision reason/notes and idempotency; no account signs, balance deltas or profitability total. Requires completed server-stored review and current subject hash. Locks and effects follow Approval Contract §17.4. Unknown/included-elsewhere returns a reviewed no-posting result; approved party effects and new profitability snapshot commit atomically with audit.

## 21. Backup and Restore Status Actions

```text
GET /api/v1/operations/backups/status
permission: backup.view
```

Returns latest backup/restore-test evidence and limitations, never credentials/storage secrets.

```text
POST /api/v1/operations/backups
permission: backup.run
```

Owner or authorized Accountant triggers a manual backup job/reference; idempotency required. Response reports accepted/completed/failed status and evidence ID. Long-running work must not exceed request limits; use contracted administrative process/job boundary.

```text
POST /api/v1/operations/restore-tests
permission: backup.restore_test
```

Owner authorizes; Accountant may execute only when explicitly permitted. Target must be separate non-production environment. Records test/evidence. This is not a production restore endpoint.

Production restore requires an external owner-approved recovery procedure and is not exposed as ordinary API.

## 22. Permission and Field Filtering

Permission is checked before entity disclosure. Worker responses omit price, cost, rate, payable, receivable, balance, settlement, profitability, payer/allocation and audit fields. Owner/Accountant share management shell but APIs return only their allowed actions/data.

## 23. Testing Requirements

For each endpoint test authentication, permission, tenant isolation, validation, state conflict, happy path, idempotent replay, changed-payload conflict, concurrent requests, injected transaction/audit failure, deterministic errors and role-filtered response.

Critical end-to-end cases:

- raw receipt approval and append-only late-price confirmation, including duplicate/concurrent confirmation;
- one-step transfer approval and blocked/returned classification decision gate;
- sale submit/reserve/approve/reject/cancel;
- technical sales approval failure leaves status/reservation unchanged and no partial effects;
- business sales approval failure uses reason-specific `approval_failed`/`needs_review` resolution with no posting or silent release;
- return quantity/stock/customer impact;
- replacement return original-line valuation and cap; linked normal replacement approval; equal/higher/lower differences; no automatic refund;
- adjustment negative alert;
- issue/WIP/partial receipt/payable;
- payment posting, concurrent settlement versus reversal, and over-settlement;
- reviewed direct-cost posting/no-posting and profitability version update;
- WIP-return request has no effect until approval;
- movement/payment reversal preserves originals;
- correction request does not mutate original;
- migration dual approval/no direct AI commit;
- backup status contains no secrets;
- worker payload/response cannot smuggle/receive financial fields.
- approval subject mutation invalidates stale approval;
- crash after commit/before response and expired idempotency lease recover without duplicate effect;

## 24. Common Failure Cases

Business logic in UI/Route Handler; generic status PATCH; body tenant/role trusted; missing idempotency; response leaks fields; HTTP success before commit; retry duplicates; technical failure changes business state; every business failure auto-releases reservation; approval failure returns rejected; replacement amount accepted from client; direct AI import; production payable accepted from client; restore API targets production; raw stack traces/SQL exposed.

## 25. Acceptance Criteria

- Every listed high-risk operation has method/path, permission, request, preconditions, transaction, response, errors, idempotency and audit.
- Route Handlers remain thin.
- Domain services own postings.
- Tenant/field permissions are server-enforced.
- Failures are deterministic and leave no partial effects.
- Retries are safe.
- Backup/restore actions respect environment safety.

## 26. Notes for AI Coding Agents

Do not implement these routes until their upstream contracts exist. Do not add calculated effects to requests or business logic to UI/handlers. Do not create generic CRUD approval/correction/import routes. If an endpoint's effects are not fully specified, stop: **Unresolved / requires owner decision**.
