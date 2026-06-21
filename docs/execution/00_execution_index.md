# GLM Execution Index

## Purpose

This index defines how the GLM execution plan is organized. It is an execution policy and is not authorization to start a package whose entry gate is not satisfied. The detailed plan is `docs/execution/01_glm_execution_plan.md`.

Detailed work packages are defined in `docs/contracts/13_work_packages.md`. Coding-agent policy is in `docs/contracts/14_coding_agent_instructions.md`; tests and regressions are in `docs/contracts/12_testing_and_regression_plan.md`.

## Core GLM Rules

Canonical authority is: Decision Log owner decisions → approved contracts → v4 where not superseded → remaining authorized context. Execution documents may narrow scope/order but never change business behavior.

1. GLM must implement **one work package at a time**.
2. GLM must not jump ahead to a later package or phase because it appears easier or more interesting.
3. GLM must not change, reinterpret, generalize, or add business rules.
4. GLM must not expand MVP scope or introduce deferred productization features.
5. GLM must read the relevant contract files and upstream dependencies before coding.
6. GLM must use the authorized source hierarchy when a contract references background material.
7. GLM must mark an undefined material rule as **“Unresolved / requires owner decision”** and stop the affected implementation path.
8. GLM must not mark a work package or phase complete without required automated tests, smoke tests, regression checks, and acceptance evidence—or a precise record of failures that means the package remains incomplete.
9. A documented failure is not a passing gate. It permits transparent handoff; it does not permit completion status.
10. GLM must preserve role, field, tenant, audit, backup, migration, and correction safeguards even when implementing a narrow feature.
11. GLM implements each numbered phase on a dedicated `phase/NN-name` branch, pushes only that branch, and never pushes implementation directly to `main`.
12. A phase reaches `main` only through a pull request after all required checks and preview/integration tests pass and the owner explicitly authorizes that exact merge.

## Package Entry Gate

Before starting a work package, GLM must confirm:

- the package is the next dependency-ready package;
- `docs/contracts/01_technical_architecture_and_deployment_contract.md` has been read for any scaffolding, dependency, database connection, migration, deployment, backup, or environment work;
- `docs/contracts/02_design_system_and_ux_contract.md` has been read for any frontend, component, form, table, dashboard, theme, RTL, responsive, motion, or accessibility work;
- `docs/contracts/03_database_schema_contract.md` has been read for any persisted entity, Drizzle schema, constraint, index, seed, or migration work;
- `docs/contracts/04_inventory_posting_contract.md` has been read for any stock, reservation, balance, transfer, return, adjustment, reversal, or reconciliation work;
- `docs/contracts/05_production_wip_contract.md` has been read for any production, WIP, partial receipt, waste, lineage, factory rate, payable, or WIP-return work;
- `docs/contracts/06_approval_transaction_contract.md` has been read for any approval, rejection, reversal, correction, or historical commit transaction;
- `docs/contracts/07_subledger_and_costs_contract.md` has been read for any account, balance, payment, settlement, direct cost, transport, or profitability work;
- `docs/contracts/08_historical_migration_contract.md` has been read for any historical source file, normalized template, transformation, staging, validation, reconciliation, alias/master mapping, dual approval, historical commit, locking, or historical correction work;
- `docs/contracts/09_api_contracts.md` and `docs/contracts/11_permission_matrix.md` have been read for any API, authorization, response-field, role, export, migration, backup, or audit work;
- `docs/contracts/10_frontend_screen_contracts.md` has been read for any page, shell, dashboard, form, queue, table, report, role UX, state, RTL, accessibility, or responsive work;
- `docs/contracts/12_testing_and_regression_plan.md`, `docs/contracts/13_work_packages.md`, `docs/contracts/14_coding_agent_instructions.md`, and `docs/execution/01_glm_execution_plan.md` have been read for every coding package;
- the Run 2.1 rules in `docs/02_decision_log_and_scope.md` have been read for EGP, decimal precision, `ROUND_HALF_UP`, deterministic document totals/discount residuals, replacement returns, failure classification, and reservation resolution;
- its required contract files exist and are approved;
- all package-blocking owner decisions are resolved;
- the preceding package’s acceptance gate passed;
- the working tree and existing user changes have been inspected;
- required test fixtures and rollback notes are available;
- the package scope, allowed modules/files, and non-goals are explicit.
- the executable package instance contains an exact changed-path allowlist, smoke test/expected result, triggered regressions, rollback/recovery, fixture version and evidence destination;
- every dependency is a completed package ID/evidence record or an explicitly resolved owner decision—not “base slice,” “affected domain,” “as applicable,” or another undefined phrase;
- any cloud project/deployment/paid-plan/real-data action has separate explicit authorization.
- the active phase branch, remote push scope, pull-request target, and merge authority are recorded;
- required local Supabase or authorized hosted-development test access exists for packages that need database/Auth/Storage integration.

If any required item is missing, GLM must not fill the gap with an assumption.

## Work Package Template

Every future work package should contain:

- package ID, title, and owning phase;
- objective and business outcome;
- dependency packages;
- mandatory contract reading;
- owner decisions required;
- exact in-scope behavior;
- explicit out-of-scope behavior;
- permitted modules/files or architectural boundary;
- data/schema prerequisites;
- transaction and permission implications;
- deliverables;
- executable tests and expected results;
- package smoke test;
- regression tests triggered by the change;
- manual role/browser checks where relevant;
- rollback/recovery procedure;
- active phase branch, permitted remote, pull-request target and merge authorization state;
- known risks;
- evidence required for acceptance;
- completion status and documented failures.

## One-Package State Flow

```text
ready
→ contracts read
→ implementation in progress
→ package tests
→ smoke test
→ required regression
→ review against contracts
→ acceptance evidence recorded
→ complete
```

Any failure returns the package to implementation or marks it blocked/incomplete. It does not authorize GLM to continue to the next package.

## No-Jump-Ahead Rule

GLM may inspect later contracts to understand dependencies, but it must not implement later work early. In particular:

- the technical architecture/deployment contract precedes repository scaffolding and schema implementation;
- the design-system/UX contract precedes frontend scaffolding and shared UI primitives;
- the three reference screens must pass owner visual approval before GLM scales visual patterns across the full frontend;
- schema foundations precede module persistence;
- inventory ledger and balances precede reservation-dependent sales;
- factory locations and inventory posting precede production/WIP;
- WIP and cost snapshots precede factory payable posting;
- reservation and subledger foundations precede atomic sales approval;
- core posting/correction rules precede historical migration commit;
- permission contracts precede financial dashboards, exports, and migration UI;
- backup and restore capability precedes real pilot or migration data;
- full regression and parallel reconciliation precede go-live.

Cross-package changes require the work package to be revised and reviewed; they must not be smuggled into an unrelated task.

## Contract Compliance Rule

Before coding, GLM must identify the exact contract clauses that control:

- persisted data and statuses;
- stock/WIP/account effects;
- permissions and forbidden fields;
- transaction boundaries, locks, and idempotency;
- audit events;
- correction/reversal behavior;
- decimal precision, posting-rounding boundary, posted-line total and residual rules for every financial calculation;
- technical-versus-business failure classification and the exact reason-based reservation outcome;
- test expectations;
- rollback and recovery.

If two contracts conflict, GLM must stop the affected work and report the conflict. It must not choose a preferred interpretation.

## Business-Rule Change Prohibition

GLM may make normal implementation choices only when they do not alter business behavior. It must not decide:

- when money becomes payable or receivable;
- how quantities move between on-hand, reserved, blocked, returned, and WIP;
- which roles may see or change financial data;
- which historical values are authoritative;
- which warnings may be accepted;
- how profitability components are interpreted;
- which approval or correction can bypass a safeguard;
- whether a pilot limitation is acceptable for production.

Those are owner/contract decisions.

## Test and Completion Gate

A package is complete only when:

- all required package tests pass;
- the phase-specific smoke test passes;
- every regression test triggered by the regression matrix passes;
- required concurrency, idempotency, permission, or restore tests pass;
- exact-value decimal, midpoint-rounding, discount-residual/tie, replacement-return, and approval-failure/reservation tests pass for packages touching those rules;
- manual browser checks pass where the package changes role UX;
- required RTL, responsive, accessibility, reduced-motion, and 200% zoom checks pass where the package changes UI;
- reference-screen approval evidence exists before broad frontend implementation;
- results are recorded with commands, fixtures, and evidence;
- implementation is checked against the controlling contracts;
- known limitations and failures are documented;
- rollback/recovery remains viable.
- the package commit is on the active phase branch, never directly on `main`.

Package completion permits the next dependency-ready package on the same active phase branch. It does not permit a merge. The phase pull request may merge only after all phase checks and relevant Vercel Preview/Supabase development tests pass and the owner explicitly authorizes that merge.

If a test cannot run, GLM must record the exact command, environment limitation, error, risk, and required follow-up. The package remains incomplete unless the approved package contract explicitly permits a different gate.

## Execution Documents

- `docs/contracts/13_work_packages.md`: dependency-ordered package catalog.
- `docs/contracts/14_coding_agent_instructions.md`: mandatory agent behavior and completion report.
- `docs/execution/01_glm_execution_plan.md`: Phase 0–9 execution order, gates, tests, rollback, risks and Definition of Done.

Implementation should maintain package-status, test/evidence, rollback/failure, and pilot/go-live ledgers as work progresses. No execution file authorizes work whose controlling contract, dependency, owner decision, or reference-screen approval is missing.
