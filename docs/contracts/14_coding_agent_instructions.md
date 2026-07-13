# Coding Agent Instructions

## 1. Authority

These instructions apply to every AI coding agent, including GLM, working in this repository. They do not authorize coding by themselves. The current package in `13_work_packages.md` and `execution/01_glm_execution_plan.md` defines allowed scope.

Canonical authority order:

1. explicit owner decisions in `docs/02_decision_log_and_scope.md`;
2. approved contracts in `docs/contracts/` for their domain;
3. Final Implementation Plan v4 where not superseded;
4. remaining authorized source context in the order stated by `docs/00_project_context.md`.

Execution documents/work packages may narrow scope and order but never change business behavior.

If sources conflict, stop the affected path and report exact clauses. Do not choose by preference. If material behavior is undefined, write:

> Unresolved / requires owner decision

## 2. Mandatory Start Protocol

Before editing:

1. identify the one active work package and its dependencies;
2. inspect repository/user changes and preserve unrelated work;
3. read the project context, decision log, Final Implementation Plan v4, contract index, execution index/plan, technical architecture, coding instructions, work package, testing plan, and every domain/UI/API/permission contract named by the package;
4. list the exact required files read and controlling section/line references; missing mandatory reading blocks edits;
5. state in-scope outputs, non-goals, expected tests, and unresolved blockers;
6. confirm preceding package/gate evidence exists;
7. for frontend expansion, confirm all three reference screens have recorded owner approval.

The active package instance must contain an explicit file/module allowlist. After implementation, every changed path must be inside it; otherwise the package is incomplete until the package is formally revised. A package name alone does not authorize cloud project creation, deployment, paid-plan changes, external messages, or real-data operations—those require explicit user/owner authorization.

Do not start code while a blocking contract/decision/dependency is absent.

## 3. One-Package Discipline

- Implement one work package at a time.
- Do not jump to later phases or “helpfully” add adjacent features.
- Do not implement future productization, dark mode, general rule engines, microservices, two-step transfer, automatic reservation expiry, legal exports, or other deferred scope.
- Cross-package work requires the package to be revised/reviewed first.
- A difficult or failing package remains active/incomplete; it does not authorize skipping ahead.
- Do not start the next package when any dependency is described vaguely, lacks a completed package ID/evidence record, or remains unresolved.
- Phrases such as “base slice,” “affected domain,” “as applicable,” and “daily-approval authority” are blockers until replaced by explicit package/contract references.

### Phase Branch and Main Protection

- Work on exactly one `phase/NN-name` branch created from the latest tested `main`.
- Keep one work package per bounded commit or clearly identified commit series; do not mix packages in one commit.
- Push only the authorized phase branch. Never push implementation directly to `main`.
- Under DEC-075, request authorization to push the active phase branch after each meaningful local checkpoint, including incomplete-but-valuable or defect-fix checkpoints, to protect against GLM sandbox resets.
- Clearly label any pushed phase-branch checkpoint as `ready_for_validation`, `incomplete_needs_fix`, `blocked`, or `ready_for_merge`. A pushed phase branch is not acceptance, completion, validation, merge approval, or `main` authorization.
- Do not open the phase PR until its required packages and owner gates are complete.
- Before requesting merge, synchronize with current `main` and rerun all phase-required checks and preview smoke/regression tests.
- Any failed, skipped, unavailable, flaky without resolution, or undocumented required check blocks merge.
- Merge only after explicit owner authorization for that exact phase PR. Passing tests alone is necessary but not merge authority.
- Verify the post-merge online-demo deployment before deleting the phase branch or recommending the next phase.

## 4. Business and Data Integrity Rules

- Do not change, generalize, simplify, or invent business rules/statuses.
- Do not edit/delete approved, posted, imported, audited, settled, or snapshotted records directly. Use contracted correction/reversal/adjustment.
- InventoryLedgerService is the only owner of posted stock movements/materialized balance updates.
- SubledgerService is the only owner of account entry/reversal/settlement posting.
- ProductionPostingService coordinates WIP through InventoryLedgerService and SubledgerService in one transaction.
- ApprovalService coordinates permission, state, locks, effects, decision and audit; approval is never status-only CRUD.
- MigrationService stages/validates/reconciles and commits through domain services; no source/AI-to-operational import.
- Do not silently recalculate imported historical cost with live formulas.
- Preserve tenant, source, formula, audit, snapshot, idempotency and correction provenance.
- No generic stock/account/status update endpoint or browser database mutation.
- Approval requests bind to the subject version/hash and relevant line/child versions. A material subject change invalidates the pending approval and requires revalidation/resubmission.

## 5. Decimal and Posting Rules

- Use decimal arithmetic for all quantities, money, rates, discounts, allocations, unit costs, ratios and profitability.
- Never use JavaScript binary floating point as business authority.
- Transport decimal-safe strings/equivalent representations across API/UI.
- Respect contracted scales: posted money/rates `18,2`; kg `18,3`; unit cost `18,6`; precise allocation `24,8`; ratios at least 12 decimals.
- Keep intermediates high precision; use `ROUND_HALF_UP` only at official posted monetary boundaries.
- Multi-line total is the sum of stored posted net lines.
- Discount residual goes to largest gross line, then lowest stable line number on tie, and is stored as `rounding_adjustment`. **Per DEC-082**: if one line cannot absorb the residual without violating per-line bounds (`0 <= discount <= gross`, `0 <= net <= gross`), the residual continues to the next deterministic line in the same priority order. Multiple lines may have non-zero `rounding_adjustment` only when required to preserve invariants.
- Never recompute authoritative financial results in a component.

## 6. Approval and Failure Rules

- Every high-risk command is server-authenticated, tenant/permission checked, state validated, idempotent, locked/rechecked, atomic and audited.
- Technical/system failure rolls back, changes no business/reservation state, records safe technical evidence, and remains retryable.
- Business-precondition failure creates no approval posting. Sales may use a separate reason-based failure-resolution transaction.
- Do not release every reservation on failure: corruption fails/reconciles/alerts; stock/quality/commercial issues retain for review; human reject/cancel releases explicitly.
- `approval_failed` is primarily a sales lifecycle status; do not add it globally.
- Never catch and continue after a required stock/account/audit write fails.
- Idempotency persistence must define lease/heartbeat or deterministic recovery for orphaned `in_progress` work. An indefinite conflict is not an acceptable recovery design.

## 7. Permissions and Worker Safety

- Backend permission/tenant/field checks are mandatory; frontend hiding is never security.
- Select/map role-safe DTOs; do not fetch full financial rows and hide them.
- Test direct URLs, APIs, nested data, errors, charts and exports.
- Only Owner manages users/permissions; Accountant cannot self-grant.
- Workers receive operational facts only. Do not expose price, cost, rate, payable, receivable, balance, settlement, payer, allocation, profitability, financial audit, migration finance, or backup secrets.
- Worker request schemas reject forbidden fields instead of silently accepting them.
- DEC-063 makes the worker financial-deny ceiling absolute in MVP; no implementation may broaden worker financial access through custom grants, multi-role assignment, exports, nested responses, logs, errors or UI-only hiding.

## 8. Frontend and Design Rules

- Read Design System and Frontend Screen contracts before any UI change.
- Use semantic Tailwind utilities mapped to centralized design tokens; no literal colors in components.
- MVP is light-only Calm Enterprise; use the approved Arabic typography from the Design System contract.
- Root is `<html lang="ar" dir="rtl">`.
- Do not use `dir="auto"` for full Arabic sentences or critical messages.
- Isolate codes, dates, quantities, money, numeric cells, emails, phones, URLs and identifiers locally LTR.
- Respect Worker Task Mode versus shared Owner/Accountant Management Console.
- Worker screens are task-first, 360px+, 44×44px targets and finance-free—not small management screens.
- Critical state cannot be color-only or toast-only.
- Meet WCAG 2.2 AA target, keyboard/focus/labels/contrast/reduced-motion/200% zoom requirements.
- Do not scale frontend beyond primitives/reference screens until Worker raw receipt, Accountant review queue and Owner dashboard are owner-approved.
- Use the owner-provided client workbook `متابعة انتاج وبيع خيوط الغزل (3).xlsx` where available and the approved/provisional Arabic terminology fixture in `docs/design/01_reference_screen_terms_and_fixtures.md`; do not invent Arabic business terminology outside that fixture or owner-provided client Excel/screenshots. Do not invent final token values beyond the approved/reference-screen calibration path.

## 9. Auth, Deployment, Backup and Migration Limits

- Private email/password sign-in and dev/demo Owner bootstrap are resolved by DEC-073 and DEC-074; do not introduce public signup, role self-selection or unapproved recovery behavior.
- Supabase project uses Europe general region; if specific, prefer Central EU/Frankfurt; record assigned region and Egyptian latency.
- Free/low-cost deployment is development/demo/controlled-pilot only, never production-ready by default.
- Use the Supabase CLI disposable local stack for database/Auth/Storage integration tests when the sandbox supports it. Otherwise use only a separately authorized hosted development/test project with synthetic data.
- Current GLM sandbox Docker verdict is `unavailable`. Do not install Docker or claim local Supabase evidence there. The hosted development/test project exists, but WP-00-02 may define configuration boundaries only and must not connect, migrate, run health checks, apply schema, or mutate remote data.
- Use `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `DATABASE_URL`, and `SUPABASE_PROJECT_REF`. The publishable key is client-safe; the secret key and database connection are server-only. Do not introduce legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` or `SUPABASE_SERVICE_ROLE_KEY` without an explicitly approved compatibility requirement.
- With the Supabase transaction pooler and `postgres.js`, set `prepare: false`. Do not expose or reuse migration/admin credentials as browser/runtime public configuration.
- Vercel phase-branch previews use Preview-scoped variables pointing to development/test Supabase. Never expose online-demo, pilot, or production credentials to Preview.
- Creating/linking/resetting a hosted project, applying a remote migration, configuring provider secrets, deploying, or merging remains an explicit external-state action.
- GitHub, Supabase, Vercel, database, service-role and signing credentials should use approved secret/credential managers when the sandbox/platform provides an owner-controlled channel.
- DEC-060 creates a narrow owner-authorized temporary chat credential exception for development/test automation when no secret-manager channel is available. The owner must explicitly authorize the exact operation in the active chat.
- Under DEC-060, short-lived scope-limited credentials may be used transiently for the named operation only: GitHub phase-branch push/PR, Supabase development/test connectivity or package-authorized integration work, or Vercel preview/demo setup/deploy.
- DEC-060 credentials must never be placed in tracked or untracked files, `.env`, `.env.local`, Git remote URLs, package scripts, logs, screenshots, test evidence, completion reports, or browser/client code. Do not echo them back.
- Supabase publishable keys and project URLs may be used in browser-safe configuration. Supabase secret keys, service-role/legacy service credentials, database URLs, database passwords, migration/admin credentials, and backup credentials remain server-only and development/test-only under this exception.
- Vercel tokens may be used only for the explicitly authorized preview/demo operation unless the owner separately names a production action. Preview environments must not receive online-demo, pilot, production, or real-client-data credentials.
- If any credential is disclosed outside DEC-060, or is accidentally persisted/echoed/logged, treat it as compromised: stop using it, report where it may have appeared, and ask the owner to revoke/rotate it.
- If the sandbox has no owner-controlled secret channel and the owner does not authorize DEC-060, use DEC-059 credentialless handoff: export a verified Git bundle after the package gate, provide its SHA-256 as a downloadable artifact, and leave status `incomplete/publication_pending`.
- Keep production tier/budget, retention/RPO/RTO and monitoring provider unresolved.
- Exports are internal reports, not backups or legal documents.
- No real pilot/migration data before backup and separate-target restore evidence.
- No ordinary API production restore or automatic runtime schema migration.
- No external provider project creation, deployment, paid-tier mutation, or real-data operation is authorized by a work-package selection alone.

## 10. File and Repository Safety

- Preserve user/unrelated changes; do not reset, overwrite or delete them.
- Use reviewed migrations only in packages that authorize schema changes.
- Do not rewrite applied shared migrations; create forward migration/correction.
- Never commit secrets, credentials, source business files, dumps or signed URLs.
- Keep generated artifacts, caches and evidence in approved locations.
- Use non-destructive diagnostics first and explain any operation requiring external authority.

### Code Style, Maintainability, and Component Structure

- Follow the existing project architecture, naming conventions, import style, file organization, component patterns, and test style. If no convention exists yet, establish the simplest consistent pattern allowed by the architecture/contracts and use it consistently within the package.
- Keep functions small, focused, and easy to read. Prefer roughly 10–40 lines when practical. Avoid functions above roughly 60–80 lines unless there is a clear reason, and state that reason when material.
- Do not split code into tiny meaningless helpers merely to reduce line count. Extract helpers only when they improve naming, reuse, testing, or separation of concerns.
- Prefer one main exported UI component per component file. Reusable, stateful, or large components must have their own files. Tiny private subcomponents may stay in the same file when used only there.
- Keep React components presentational/orchestration-focused. Do not place authoritative inventory, accounting, approval, costing, permission, migration, backup, or profitability rules inside components.
- Use existing shared primitives, hooks, helpers, and services before adding new ones. Do not add a new dependency or a second UI library when the approved stack already solves the problem.
- Avoid `any`, broad casts, duplicated DTOs, and local shadow types for contracted data. Use or extend the approved types at the boundary authorized by the work package.
- Comments should explain non-obvious why, risk, or contract linkage. Avoid comments that merely repeat code. Vague TODOs are prohibited; unresolved behavior must use **Unresolved / requires owner decision** with the controlling context.
- Do not refactor, rename, move, reformat, or restyle unrelated files to satisfy personal preference or make a patch look cleaner.
- Preserve existing tests and add or update behavior tests for changed behavior. Do not update snapshots or expected values merely to match unexplained output.

## 11. Required Tests

- Follow DEC-058's cumulative cadence: focused tests continuously during implementation, the complete package gate after every WP, and the integrated phase gate before merge. Do not postpone all testing until the package or phase ends.
- Implement tests in the same package as behavior.
- Run package tests, phase smoke and regression matrix entries from `12_testing_and_regression_plan.md`.
- High-risk operations require service transaction, permission, tenant, concurrency, idempotency, rollback and audit tests.
- Frontend requires role/field, Arabic RTL/LTR, accessibility, responsive and state tests.
- Numeric behavior requires exact fixtures; do not accept approximate floating-point output.
- Historical migration requires staging-isolation, provenance, validation/reconciliation, dual approval, atomic commit, locking and correction tests.
- Backup capability requires actual separate-target restore evidence where gated.
- Never weaken expected results or skip a failing critical test to mark completion.

If a test cannot run, record command, environment, expected/actual, error, risk and follow-up. The package remains incomplete unless its approved gate says otherwise.

Completion evidence for each command includes the exact command, exit code, passed/failed/skipped test counts, fixture/version, environment, and evidence path. A command not run is not a pass.

## 12. Completion Report

After every package output a short report:

```text
Work Package ID and title
Status: complete | incomplete | blocked
Contract files read
Files changed
Business rules applied
Tests run
Test results
Known failures
What was intentionally not changed
Remaining risks/unresolved decisions
Rollback/recovery notes
Recommended next dependency-ready work package
```

Status rules:

- `complete`: every deliverable and required gate passes with evidence.
- `incomplete`: work/tests remain or failures exist.
- `blocked`: an external owner decision/authority/dependency prevents safe progress.
- A documented failure is honest evidence, not a passing result.

## 13. Prohibited Shortcuts

Do not:

- start with “build ERP,” sales approval, historical commit, or broad frontend;
- mutate stock/account tables from routes/components/scripts;
- trust client tenant/actor/role/calculated effects;
- approve by generic `PATCH status`;
- treat free tier, export, or backup configuration as proven recovery/production readiness;
- turn the current workbook into permanent schema;
- hide migration warnings or classify accepted warnings as clean data;
- use CSS/client filtering for authorization;
- add a generic Admin role or worker wildcard;
- edit approved history or delete audit;
- silently change package scope to make tests pass.
