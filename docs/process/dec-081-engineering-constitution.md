# DEC-081 Engineering Constitution

## Status And Lifecycle

**Current status:** `Pilot`

Allowed statuses:

| Status | Meaning |
| --- | --- |
| `Pilot` | Non-binding guidance on a process branch. Agents use it only when the owner explicitly requests DEC-081, blind audit, or process-hardening work. |
| `Active` | Binding engineering process on `main`. Every coding agent must read this constitution and its verification matrix before editing any coding work package. |
| `Superseded` | Replaced by a later recorded decision that identifies the replacement and preserves historical evidence. |

DEC-081 may move from `Pilot` to `Active` only after the active WP-03-04 flow is settled, this process branch is recreated or rebased from the then-current `main`, the owner explicitly authorizes activation, the status is changed to `Active` in the constitution, verification matrix, decision log, contract index, and coding-agent instructions, and the activation commit is recorded. Merely merging a file that still says `Pilot` does not activate it.

Before activation, measurable checks in this constitution must either have repository automation or a documented manual verification command/checklist. Missing enforcement is an activation blocker, not permission to claim compliance.

## Purpose

This constitution prevents AI-assisted development from drifting into "working but architecturally unsafe" code. It turns the project style into explicit engineering rules that can be verified, challenged, and reused by any coding agent.

The aim is not slower work. The aim is controlled acceleration: agents can move quickly only inside known ownership boundaries, with evidence that important behavior is not duplicated, bypassed, silently repaired, or hidden behind passing tests.

## Core Rules

| Rule | Requirement |
| --- | --- |
| EC-01 | Every domain rule has one canonical owner. Do not duplicate posting, reservation, approval, audit, cost, permission, or decimal logic in routes, components, scripts, or local helpers. |
| EC-02 | UI is not business authority. Components may orchestrate display and form state only; authoritative effects belong in server services/repositories. |
| EC-03 | Persistence bypass is prohibited. High-risk writes go through contracted service/repository boundaries and controlled transactions. |
| EC-04 | Broad escape hatches are prohibited. Do not expose generic handles, generic status mutation, generic balance mutation, or raw update methods that let downstream code bypass invariants. |
| EC-05 | High-risk commands are atomic and idempotent. Permission, tenant, state, locks, effects, approval state, idempotency, and required audit commit or roll back together. |
| EC-06 | Decimal arithmetic is exact and centralized. JavaScript floating point is never business authority for quantities, money, rates, allocations, or profitability. |
| EC-07 | Required audit is persistent, append-only, and transaction-coupled. In-memory audit may be used only in tests or explicitly non-production demos. |
| EC-08 | Errors are typed and deterministic. Do not hide business conflicts behind generic errors, silent `null`, or swallowed exceptions. |
| EC-09 | No silent repair. Mismatches, corruption, negative stock, failed reservations, and reconciliation differences must be visible and audited through contracted workflows. |
| EC-10 | Architecture changes are declared. A work package may not smuggle in a new architecture, framework, dependency, status model, permission model, or cross-domain owner. |
| EC-11 | Behavior changes are tested at the right level. Shared services need service tests; high-risk writes need rollback/idempotency/concurrency/audit tests; UI-only changes need role/field/accessibility checks. |
| EC-12 | Evidence is specific and falsifiable. "Tests pass" is not enough; cite file paths, symbols, commands, outputs, DB observations, or failure-injection results. |
| EC-13 | Checkpoint pushes are recovery artifacts only. A pushed branch is not accepted, validated, merge-ready, or authorized for `main`. |
| EC-14 | Exceptions require an ADR. Exceptions must name owner authority, architecture reviewer authority, expiry/review date, risk, compensating tests, and the exact files/symbols allowed. |
| EC-15 | Phase architecture reconciliation is mandatory. After each phase, or after 4-6 work packages, review whether ownership boundaries, duplicated logic, service APIs, and evidence quality still match the constitution. |
| EC-16 | Code shape stays reviewable. Functions, modules, parameter lists, nesting, and complexity must remain inside the budgets below or use an approved ADR. |
| EC-17 | Dependency direction is explicit. UI depends on server actions/API boundaries, which depend on domain services, which depend on repositories/adapters; lower layers must not import higher layers. |

## Code Shape And Dependency Budgets

A universal 15-line method limit is not used because it can fragment transactional orchestration into misleading helpers. The project fingerprint is instead defined by reviewable targets and hard escalation thresholds:

| Measure | Normal target | Review threshold | Merge blocker without ADR |
| --- | --- | --- | --- |
| Function effective source lines | 25 or fewer | More than 25 | More than 60 |
| Cyclomatic complexity | 10 or fewer | More than 10 | More than 15 |
| Block nesting depth | 3 or fewer | More than 3 | More than 4 |
| Function parameters | 5 or fewer | More than 5; prefer a typed command object | More than 7 |
| Production module effective source lines | 400 or fewer | More than 400 | More than 700 |

For these budgets, an effective source line is a nonblank, non-comment source line. Generated files, declarative schema definitions, migrations, and versioned fixtures may exceed module-line budgets when their structure is inherently declarative and the evidence package identifies them explicitly.

Additional code-shape rules:

- A function above a review threshold requires an explanation in the evidence package showing why extraction would not improve ownership or readability.
- Do not extract helpers merely to satisfy a line count. Each helper must have one meaningful responsibility and a name that states its domain purpose.
- More than one implementation of the same domain formula, permission rule, state transition, posting rule, or normalization rule is a merge blocker unless an ADR identifies the canonical owner and migration plan.
- New shared helpers require a repository search proving that an equivalent helper or canonical owner does not already exist.
- Import direction is `UI -> server action/API -> domain service -> repository/adapter -> database/provider`. Cross-domain effects must use the owning service's narrow public boundary rather than importing its repository.
- Circular production dependencies and imports from lower layers into UI/routes are merge blockers.

Before DEC-081 becomes `Active`, repository checks must enforce the measurable complexity, function-size, nesting, parameter, module-size, circular-dependency, and prohibited-import rules where tooling supports them. Until then, the blind reviewer must record manual results and may not describe them as automated enforcement.

## Work Package Risk Classes

| Class | Examples | Minimum verification |
| --- | --- | --- |
| Low | Text, docs, read-only UI, labels, non-sensitive styling | Scope diff, focused tests or manual inspection, no high-risk owner touched. |
| Medium | Validation, read/write CRUD, non-financial workflow, API shape, role-safe UI | Impact report, integration tests, permission/tenant checks, architecture ownership review. |
| High | Stock, reservations, sales, approvals, payments, audit, migrations, backup/restore, permissions, posting, reconciliation | Full verification matrix, rollback/failure injection, idempotency, concurrency, live DB where applicable, independent blind review before merge. |

If a work package touches any High class behavior, the whole package is treated as High unless the changed files and symbols prove the risky path is untouched.

## Blind Independent Review Protocol

Blind review is required for High class work packages and recommended for Medium packages that touch shared boundaries.

Stage 1: preliminary blind review

- Give the reviewer the original requirements, controlling contracts, decision log, branch name, target commit, and raw repo/diff access.
- Do not provide the implementer's completion report, claims, explanations, or self-selected summary.
- The reviewer must be a separate agent session or reviewer context from the implementer for High-risk work.
- The reviewer must write and freeze preliminary findings before seeing the implementer report.
- Store Stage 1 evidence at `docs/reviews/<wp-id>/<target-sha>/stage-1-blind-review.md` on a dedicated review branch, or in an owner-controlled immutable transcript when repository storage is impractical. Record the artifact path/URL, content hash when available, reviewer identity/session, target SHA, and timestamp.
- Do not modify the target implementation commit to store its own review. The review artifact must remain tied to the immutable target SHA.

Stage 2: report comparison

- Reveal the implementer report only after Stage 1 is saved.
- Classify each implementer claim as verified, unsupported, contradicted, or not checked.
- Add any new questions created by the implementer's explanation.
- Store Stage 2 comparison beside Stage 1 as `stage-2-report-comparison.md`, preserving the Stage 1 artifact unchanged.

Review result classification:

| Result | Meaning | Merge status |
| --- | --- | --- |
| PASS | Implementation and evidence satisfy applicable contracts. | Eligible for merge authorization. |
| IMPLEMENTATION FAILURE | Code violates behavior, architecture, security, data, or scope rules. | Not merge-ready. |
| EVIDENCE FAILURE | Code may be correct but proof is missing, hand-wavy, mocked incorrectly, or not reproducible. | Not merge-ready. |
| CONTRACT AMBIGUITY | Required behavior cannot be decided from current contracts/decisions. | Not merge-ready; owner decision required. |
| VERIFICATION ENVIRONMENT FAILURE | Required check cannot run or the environment cannot prove the claim. | Not merge-ready unless a controlling gate explicitly permits deferral. |

Only PASS can proceed to merge authorization. Every other result requires a fix, new evidence, or an owner/architecture decision.

## Evidence Package Standard

Every High class package must produce a sanitized evidence package containing:

- commit SHA and branch;
- environment name and whether dependencies are mocked, in-memory, local DB, or live DB;
- exact commands with exit codes and pass/fail/skipped counts;
- tested fixtures and relevant IDs;
- raw DB observations where live persistence is claimed;
- failure-injection result for atomicity claims;
- concurrency/idempotency result where the package is stateful;
- diff or symbol references proving canonical ownership was preserved;
- reviewer name/model/session and timestamp when applicable;
- explicit statement that no secrets or real client data appear in evidence.

A passing test proves only the behavior, environment, fixtures, and assertions it actually exercised. It does not prove adjacent behavior by implication.

## Persistent Audit Verification

When a package claims required audit correctness, it must prove all applicable points:

1. Production runtime wiring uses the persistent audit adapter, not only an in-memory test store.
2. A real `audit_logs` row is written for the domain action.
3. The audit row survives a fresh DB connection/process reload.
4. The audit write shares the same DB transaction as the domain change.
5. Injected audit failure prevents partial domain commit.
6. Audit rows are append-only; normal app paths cannot update/delete them.
7. Metadata includes actor, tenant, action, entity, timestamp, and context.
8. Idempotent retry does not duplicate business effects or required audit incorrectly.
9. No production path bypasses audit for the same command.

## Notifications And Alerts

Internal operational alerts stored in the database may be part of the same transaction when the contract requires it.

External notifications such as email, webhooks, Telegram, SMS, or Slack cannot be rolled back by the database. They require a transactional outbox or equivalent delivery design, but only when the work package or contract explicitly requires external notification. Do not expand a package with external outbox behavior by assumption.

## Exceptions

Exceptions are allowed only through a dedicated ADR or decision entry.

Required exception authority:

- explicit product/domain owner approval for business behavior;
- an owner-designated architecture reviewer, independent from the implementer, for engineering boundary changes;
- an owner-designated security/compliance reviewer, independent from the implementer, for credentials, permissions, audit, backup, privacy, or data exposure;
- Accountant only when the exception is genuinely accounting-domain behavior, not as a general engineering waiver.

An AI reviewer may analyze or recommend an exception but cannot grant owner authority. The implementer cannot approve or review their own exception. Every exception requires explicit owner authorization and must include reviewer identity, independence statement, expiry or review date, exact affected files/symbols, compensating controls, and tests/evidence required before merge.
