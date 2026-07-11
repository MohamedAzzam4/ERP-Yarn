# DEC-081 Verification Matrix

## Status

**Current status:** `Pilot`

This matrix follows the lifecycle in `docs/process/dec-081-engineering-constitution.md`. It is non-binding while `Pilot` and mandatory for every coding work package when `Active`. A merge does not activate a file whose status remains `Pilot`.

## Matrix

| Rule | Applicability trigger | Required evidence | Merge blocker | Allowed exception authority |
| --- | --- | --- | --- | --- |
| EC-01 Canonical owner | New or changed domain rule, helper, service, route, component, or script | Search output proving existing owner was reused or intentionally extended; file/symbol reference to canonical owner | Duplicate business logic in another layer or local helper | Owner + architecture reviewer ADR |
| EC-02 UI not authority | Any UI/form/page/action change | Component imports and server boundary proof; no authoritative calculations/effects in components | Component calculates stock, money, permission, audit, approval, reservation, or posting authority | Architecture reviewer ADR |
| EC-03 No persistence bypass | Any write to DB-backed domain state | Repository/service path and transaction boundary references | Raw route/component/script mutation of high-risk tables | Owner + architecture reviewer ADR |
| EC-04 No broad escape hatches | New service method or repository exposure | Narrow method names and tests showing downstream cannot bypass invariants | Generic handle/update/status/balance mutation exposed outside owner | Architecture reviewer ADR |
| EC-05 Atomic/idempotent high-risk command | Stock, reservation, sale, approval, payment, audit, migration, backup, permission, posting, reconciliation | Failure injection, rollback proof, idempotency replay/conflict proof, transaction boundary | Partial commit possible or idempotency undefined | Owner + architecture reviewer ADR |
| EC-06 Exact decimal arithmetic | Quantity, money, rate, cost, discount, allocation, profitability | Decimal helper reference and exact fixture tests | JS number becomes business authority | Architecture reviewer ADR plus numeric proof |
| EC-07 Persistent audit | Required audit event or audit-sensitive package | Persistent adapter wiring, real `audit_logs` row, rollback on audit failure, append-only proof | In-memory-only production audit or audit outside transaction | Owner + architecture + security reviewer ADR |
| EC-08 Typed deterministic errors | New command/API/service failure path | Error type/code tests for validation, permission, state, idempotency, tenant, conflict | Generic/swallowed error changes business interpretation | Architecture reviewer ADR |
| EC-09 No silent repair | Reconciliation, corruption, negative, mismatch, failed reservation, migration warning | Visible alert/review/failure state and audit proof | Auto-fix without contracted workflow/audit | Owner + architecture reviewer ADR |
| EC-10 Declared architecture change | New dependency, framework, status model, permission model, service owner, table role | Decision/ADR or explicit work-package revision | Hidden architecture change in feature commit | Owner + architecture reviewer ADR |
| EC-11 Tests match behavior risk | Any behavior change | Test names and commands mapped to changed behavior/risk class | Changed behavior has no relevant tests or only unrelated cumulative test count | Architecture reviewer may accept documented deferral only for Low risk |
| EC-12 Falsifiable evidence | Completion report, validation report, or merge-readiness claim | File paths, symbols, command outputs, DB observations, and exact scope of proof | "Works", "tested", or "all pass" without inspectable evidence | None for High risk |
| EC-13 Checkpoint clarity | Phase branch push, incomplete checkpoint, defect fix checkpoint | Report labels status: `incomplete_needs_fix`, `ready_for_validation`, `ready_for_merge_candidate`, or `ready_for_merge` | Treating pushed branch as accepted/merge-authorized | None |
| EC-14 Exceptions | Any deviation from contracts/constitution | ADR with owner, architecture/security where applicable, expiry, files, compensating controls | Informal exception in chat/report only | Listed exception authorities |
| EC-15 Phase reconciliation | Phase end or 4-6 WPs since last reconciliation | Architecture reconciliation report: owners, duplicates, service APIs, evidence gaps, exceptions | Continuing many high-risk packages without reconciliation | Owner + architecture reviewer |
| EC-16 Code-shape budgets | Any production code change | Complexity, function/module size, nesting, and parameter output; explanation for review-threshold exceptions | Hard threshold exceeded without ADR, or unreviewed threshold exceedance | Owner + independent architecture reviewer ADR |
| EC-17 Dependency direction | New import, service boundary, repository exposure, or cross-domain effect | Dependency/cycle check and import-path evidence; cross-domain call uses canonical owner | Reverse-layer import, cycle, route/UI persistence access, or cross-domain repository bypass | Owner + independent architecture reviewer ADR |

## Blind Review Checklist

For High risk work, the reviewer must answer these before reading the implementer report:

1. What contracts and decisions control this package?
2. What files and symbols changed?
3. Which canonical owners were touched?
4. Does any changed code duplicate business logic?
5. Does any changed code bypass service/repository boundaries?
6. Are high-risk effects atomic, idempotent, locked, tenant-safe, and audited?
7. Does the evidence prove persistent DB behavior or only in-memory behavior?
8. Are there tests for rollback, concurrency, idempotency, permission, tenant isolation, and audit where applicable?
9. Are there secrets, real client data, or unsafe evidence artifacts?
10. Do changed functions/modules and imports satisfy EC-16/EC-17 budgets and direction?
11. Where is the frozen Stage 1 artifact tied to the exact target SHA?
12. What is the preliminary classification: PASS, IMPLEMENTATION FAILURE, EVIDENCE FAILURE, CONTRACT AMBIGUITY, or VERIFICATION ENVIRONMENT FAILURE?

After the implementer report is revealed, the reviewer must add:

- verified claims;
- unsupported claims;
- contradicted claims;
- claims not checked;
- new findings introduced by the report.
