# GLM Execution Plan

## 1. Binding Execution Rules

GLM must:

- implement one work package at a time;
- list exact contract files read before implementation;
- not jump ahead to later packages/phases;
- not change business rules unless a controlling contract explicitly permits a choice;
- not mark a package/phase complete unless required tests, smoke tests and mapped regressions pass; documented failures leave it incomplete;
- produce the completion report required by Coding Agent Instructions after every package;
- not scale frontend before owner approval of Worker raw receipt, Accountant review queue and Owner dashboard;
- keep unresolved setup/deployment markers rather than guessing;
- stop on contract conflict and report clauses;
- preserve user changes and execute only the authorized package scope.
- implement each numbered phase on its own `phase/NN-name` branch and push only that branch;
- never push implementation directly to `main` or merge a phase PR without passing required checks and explicit owner authorization for that merge;
- use disposable local Supabase or a separately authorized hosted development/test project for integration testing, never online-demo/pilot/production data.
- follow the cumulative DEC-058 test cadence: focused tests during implementation, full tests after each WP, and integrated phase tests before merge; never defer all testing to the end.
- use a normal secret channel when available; when unavailable, use DEC-060 owner-authorized temporary chat credentials for the exact development/test operation or DEC-059 verified Git bundle handoff. Do not start the next WP until the authorized remote push is verified or trusted import/retest/push verification completes.

Authority is Decision Log owner decisions → approved contracts → v4 where not superseded → remaining authorized context. This execution plan can narrow scope/order only.

Except read-only WP-00-01, every package requires a reviewed executable instance with exact path/module allowlist, smoke command/result, triggered regressions, rollback, fixture/evidence destination and any separate external-state authorization. Undefined dependencies block execution.

The package registry in `docs/contracts/13_work_packages.md` is incorporated into this plan. Each execution record below uses its complete package definition and does not loosen it.

## 2. Entry and Exit Gates

Before a package: dependencies complete; contracts/clauses listed; repository state inspected; correct phase branch checked; scope/non-goals stated; fixtures/tests/rollback available; owner decision/reference-screen gate satisfied where relevant; local or authorized hosted-development Supabase access available when integration testing requires it.

After a package: deliverables reviewed against contracts; package tests and phase smoke/regression evidence recorded; failures/risks/intentional omissions listed; rollback viable; only then may the package commit be pushed to the phase branch and the next dependency-ready package start. A phase PR can merge to `main` only after all phase checks and relevant Vercel Preview/Supabase development smoke tests pass and the owner authorizes the merge.

## 3. Phase 0 — Foundation and Risk Controls

- **Goal:** Reproducible, deployable, migration-controlled foundation without broad ERP features.
- **Read:** Context, Decision Log, contracts 01–03 and 12–14, execution index/plan.
- **Order:** WP-00-01 → WP-00-02 → WP-00-03A → WP-00-03B, WP-00-03C, WP-00-03D and WP-00-03E only when their named decisions/dependencies pass; WP-00-04 → WP-00-05 → WP-00-06.
- **Dependencies:** DEC-053 and WP-00-01 for setup; each schema slice has the exact package/PCD gates listed below. Auth and production-go-live decisions may remain unresolved only for packages that do not consume them.
- **Allowed scope:** Repository/runtime, environment, base schema/migrations/seeds, tokens, Arabic RTL primitives, demo deployment/health.
- **Non-goals:** Sales/inventory/production posting, historical commit, broad screens, production readiness.
- **Likely modules/files:** package/config files, app root/layout, shared UI/theme, environment schema, database schema/migrations/seeds, health/deployment config.
- **DB migrations:** Base tenant/security/status/metadata slices only; reviewed and testable.
- **API changes:** Health/config-safe diagnostics only; no business command.
- **Frontend:** Root, tokens/primitives/layout; no module expansion.
- **Permission/design impact:** Initial role/permission seed; semantic tokens/RTL/accessibility foundation.
- **Acceptance:** Clean setup/migrations/build/deploy; no secret/client or runtime-migration violation.
- **Phase tests:** Install/build/type/lint/test; clean DB; constraints/seeds; environment/secret checks.
- **Smoke:** Online app, DB health, migration history, Arabic protected shell.
- **Regression/browser:** Existing tests; RTL root, 360px shell, keyboard/zoom basics.
- **Rollback:** Revert deployment/config; recreate development DB from migrations; no business data.
- **Risks:** Existing repo changes, dependency incompatibility, free-tier limits, schema churn.
- **Definition of Done:** WP-00-01, WP-00-02, WP-00-03A, WP-00-04, WP-00-05 and WP-00-06 are complete with evidence, plus each dependency-ready slice among WP-00-03B, WP-00-03C, WP-00-03D and WP-00-03E; blocked slices remain explicitly blocked and do not make Phase 0 wholly complete.

### Phase 0 Package Execution Records

- **WP-00-01 Project/Bootstrap Verification** — **Goal/inputs:** read-only inspection of existing repo. **Read:** context, v4, Decision Log, both indexes, 01,12–14 and this plan. **Outputs/notes:** conversation report, exact baseline/allowlists and Docker/Compose/daemon/Supabase-CLI feasibility; no files, Git repair, scaffold/install, image pull, container start or cloud action. **Tests/acceptance:** existing commands plus non-mutating `docker version`, `docker info`, `docker compose version` and installed Supabase CLI version check, or exact absence/policy failure; verdict must be `confirmed_available_for_WP-00-02`, `unavailable`, or `unconfirmed_due_to_sandbox_policy`. **Dependencies:** none. **Report:** evidence, local-versus-hosted Supabase recommendation and recommended WP-00-02.
- **WP-00-02 Technical Stack Setup** — **Goal/inputs:** contracted stack/environment from WP-00-01 and DEC-053/056/057. **Read:** 01,03,09,11–14. **Outputs/notes:** pinned lock/config/env boundaries, project-local Supabase CLI if needed, documented Docker `unavailable` result, and hosted-development fallback marker without connection. `.env.example` contains only the standardized empty variable names. **Tests/acceptance:** clean build/type/env/secret checks, legacy key-name rejection, `prepare: false` static/config assertion, and no secret in client/log. **Dependencies:** WP-00-01. **Do not/failures:** no auth guess, cloud creation, hosted connectivity/health check, remote migration/schema/data mutation, or legacy key fallback. **Report:** exact versions/config and deferred hosted-integration package.
- **WP-00-03A Platform/Security Schema** — tenant/auth/RBAC/settings/sequence/approval-hash/audit/idempotency-lease/alerts only; read 01,03,06,11–14; depends on WP-00-02 and implements resolved DEC-061/062/063 behavior.
- **WP-00-03B Inventory Identity/Ledger Schema** — batch/lot one-to-one item identity and inventory structures; read 03–04,06,11–14; depends on WP-00-03A and implements DEC-064/065.
- **WP-00-03C Production/WIP Schema** — many-to-many production/WIP/events; read 03–06,12–14; depends on WP-00-03B.
- **WP-00-03D Sales/Return/Financial Schema** — exact sales/subledger/payment/return vocabulary; read 03,06–07,09,11–14; depends on WP-00-03A, WP-00-03B and implements DEC-066/067/068.
- **WP-00-03E Historical Migration Schema** — staging/provenance/status/cutover structures; read 03,08,11–14; depends on WP-00-03A and implements DEC-069/070/071/072.
- **WP-00-04 Theme/Design Foundation** — **Goal/inputs:** semantic light-theme system. **Read:** 02,10,12–14. **Outputs/notes:** tokens/fonts/primitives, provisional values. **Tests/acceptance:** no literal colors, fonts/contrast basics. **Dependencies:** WP-00-02. **Do not/failures:** no dark mode/broad screen. **Report:** token inventory.
- **WP-00-05 Arabic RTL/Layout Foundation** — **Goal/inputs:** root direction, LTR isolation and accessible layouts. **Read:** 02,10,12–14. **Outputs/notes:** RTL/state/layout primitives. **Tests/acceptance:** mixed direction, keyboard/focus/reduced motion/zoom/360px. **Dependencies:** WP-00-04. **Do not/failures:** no `dir=auto` sentences/invented labels. **Report:** visual QA.
- **WP-00-06 Demo Deployment/Health** — create/link hosted development Supabase and Vercel only with separate explicit external authorization; phase-branch Preview uses synthetic development credentials; read 01,03,12–14; depends on WP-00-02, WP-00-03A and WP-00-05; test Preview DB/Auth/Storage/secret/environment separation, then owner-authorized merge and online-demo smoke; no real data/production claim.

## 4. Phase 1 — Auth, RBAC, Audit, Shells and Reference Gate

- **Goal:** Private identity, backend authorization, audit/idempotency/numbering and approved visual baselines.
- **Read:** Contracts 01–03, 06, 09–14.
- **Order:** WP-01-01 → WP-01-02 → WP-01-03 and WP-01-04 → WP-01-05, WP-01-06 and WP-01-07 → WP-01-08.
- **Dependencies:** WP-00-06 for WP-01-01 (PCD-AUTH-001 resolved by DEC-073; PCD-AUTH-002 resolved by DEC-074); WP-00-03A and the exact package chain below for the remaining Phase 1 work.
- **Allowed scope:** Auth, ERP mapping, guards/DTOs, audit/sequence/idempotency, shells and three references.
- **Non-goals:** Real domain posting or broad frontend.
- **Likely modules/files:** auth/session, middleware/server guards, permissions/DTOs, audit/idempotency/sequence services, shared shells/reference pages, tests.
- **DB migrations:** User/role/permission/audit/idempotency/sequence/approval base as required.
- **API changes:** Auth/session and safe reference read fixtures only; no fake approval success.
- **Frontend:** Login/recovery per decision, Worker/Management shells, three references.
- **Permission/design:** Critical; all role fields and final visual token gate.
- **Acceptance:** Backend-enforced permissions and owner-approved references.
- **Tests:** Role/tenant/field, audit/sequence/idempotency concurrency; reference visual/a11y/RTL.
- **Smoke:** Login each role, differing shells, create/read safe approval draft/fixture.
- **Regression/browser:** Direct URL/API, nested/error redaction; 360px/tablet/phone practical view.
- **Rollback:** Disable routes/session integration; retain non-destructive audit/schema where depended upon.
- **Risks:** UI-only permission, unresolved auth, inferred visual approval.
- **Definition of Done:** WP-01-08 records owner approval; otherwise frontend expansion blocked.

### Phase 1 Package Execution Records

- **WP-01-01 Private Auth** — Inputs DEC-073 (email/password) and DEC-074 (Owner bootstrap); read 01,10§4,11–14; output server session/login/recovery/bootstrap boundary; test login/logout/recovery/inactive/tenant/enumeration; depends on WP-00-06; PCD-AUTH-001 resolved by DEC-073; PCD-AUTH-002 resolved by DEC-074; do not public signup/role select; report decision and results.
- **WP-01-02 RBAC/Redaction Guard** — Inputs auth+seeds; read 03,09–14; output guards/DTO patterns; test every role/direct URL/nested/export/cross-tenant; depends on WP-00-03A and WP-01-01; no fetch-then-hide/wildcards; report matrix coverage.
- **WP-01-03 Audit/Idempotency/Numbering** — Inputs schema/RBAC; read 03,06,09,11–14; output services; test concurrency/replay/conflict/audit rollback/immutability; depends on WP-01-02; no generic posting helper; report failure injection.
- **WP-01-04 Worker/Management Shells** — Inputs RTL/RBAC; read 02,10,11–14; output task/shared shells; test role nav/direct URLs/RTL/360/tablet/zoom; depends on WP-00-05 and WP-01-02; no global search/broad pages; report screenshots/redaction.
- **WP-01-05 Worker Receipt Reference** — Inputs shell/design, PCD-UX-001 and PCD-UX-004; read 02,10§7.1,11–14; output fixture/draft-safe reference; test finance redaction/RTL/a11y/responsive/states; depends on WP-01-04, PCD-UX-001 and PCD-UX-004; no approval/posting; report version.
- **WP-01-06 Accountant Queue Reference** — Inputs management shell, PCD-UX-001 and PCD-UX-004; read 02,06,09–14; output categories/table/drawer/actions visual; test permissions/RTL/a11y/responsive/states; depends on WP-01-04, PCD-UX-001 and PCD-UX-004; no fake status CRUD; report version.
- **WP-01-07 Owner Dashboard Reference** — Inputs shell, PCD-UX-001 and PCD-UX-004; read 02,10§6.1,11–14; output cards/alerts/accessible summary; test totals/permissions/partial failure/RTL; depends on WP-01-04, PCD-UX-001 and PCD-UX-004; no client financial aggregation; report version.
- **WP-01-08 Visual Approval Gate** — Inputs three references; read 02/10/12–14; output owner decision/tokens/density/breakpoints/limitations; review QA evidence; depends on WP-01-05, WP-01-06, WP-01-07 and PCD-UX-002; no inferred approval; report gate result.

## 5. Phase 2 — Masters, Raw Materials, Supplier Payables, Minimal Backup

- **Goal:** Safe first operational vertical and proven minimum recovery.
- **Read:** Contracts 03,04,06,07,09–14.
- **Order:** WP-02-01 → WP-02-02 and WP-02-03 → WP-02-04 → WP-02-05 → WP-02-06 and WP-02-07.
- **Dependencies:** WP-01-03 for service foundations, WP-01-08 for real screen wiring, WP-00-03B and WP-00-03D for the persisted slices used, and the exact package/PCD gates below.
- **Allowed scope:** Masters, factory/location, raw draft/approval/movement/payable/review, backup/restore smoke, thin trace.
- **Non-goals:** General inventory/reservation/production.
- **Likely modules:** master/raw/inventory/subledger services, raw screens, backup scripts/evidence, trace detail.
- **Migrations/API/UI:** Master/raw/account structures; dedicated draft/approval reads/commands; worker reference wiring and management review.
- **Permissions/design:** Worker finance-free; Owner/Accountant approve; approved reference patterns only.
- **Acceptance/tests:** Exact 1,000kg and payable/review fixture; rollback/idempotency/redaction; restore evidence.
- **Smoke:** Supplier/factory/location/raw receipt approval/balance/statement.
- **Rollback:** Reverse effects or restore if pilot; migration rollback only before data.
- **Risks:** Sign error, zero payable, unproven backup.
- **Definition of Done:** Quantity/account exact and recovery demonstrated.

### Phase 2 Package Execution Records

- **WP-02-01 Masters/Factory-Location** — read 03,04,11–14; output tenant-safe masters/admin; tests uniqueness/link/inactivation/roles; depends on WP-01-03, WP-00-03B and WP-01-08 for admin screens; no destructive merge; report constraints.
- **WP-02-02 InventoryLedgerService Receipt Primitive** — read 03,04,06,09,11–14; output minimal receipt movement/balance transaction; test atomicity/concurrency/idempotency/orphan/audit rollback; depends on WP-01-03 and WP-02-01; no other movements/UI.
- **WP-02-03 SubledgerService Payable Primitive** — read 03,06,07,09,11–14; output accounts/immutable supplier entry boundary; test sign/source/replay/no-zero/audit rollback; depends on WP-01-03 and WP-02-01; amount formula follows DEC-067.
- **WP-02-04 Raw Draft/Screen Wiring** — read 03,04,10–14; output subject-versioned draft/submit; test validation/redaction/RTL; depends on WP-01-08 and WP-02-01; no posting.
- **WP-02-05 Raw Approval/Late Price** — read 03,04,06,07,09,11–14; output atomic stock/payable-or-review and append-only confirmation; test known/missing/late/duplicate/concurrency/failure; depends on WP-02-02, WP-02-03, WP-02-04 and PCD-APR-001; priced paths follow DEC-067.
- **WP-02-06 Backup/Restore Smoke** — read 01,03,08,09,11–14; output backup/separate restore evidence; depends on WP-02-05; no export/production restore.
- **WP-02-07 Thin Traceability** — read 03,04,10–14; output read-only raw timeline; depends on WP-02-05 and WP-01-08; test links/tenant/redaction.

## 6. Phase 3 — Inventory Ledger, Reservations and Transfers

- **Goal:** Authoritative stock events/balances and concurrency-safe availability.
- **Read:** Contracts 03,04,06,09–14.
- **Order:** WP-03-01 → WP-03-02 and WP-03-03 → WP-03-04.
- **Dependencies:** WP-02-02 and WP-02-05, followed by the exact package/PCD chain below.
- **Scope/modules:** InventoryLedgerService, balances/reconciliation, transfer/reversal, reservation, alerts/failure resolution, inventory UI.
- **Non-goals:** Production/sales approval; two-step transit; auto expiry/negative toggle.
- **Migrations/API/UI:** Movement/reservation/alert constraints; dedicated transfer/reversal/submission; role-safe balances/tasks.
- **Acceptance/tests:** Ledger reconciliation, exact transfer, concurrent no-oversell, failure reason mapping.
- **Smoke:** Transfer to factory, reserve/cancel, alert/reconcile sample.
- **Rollback:** Inverse movements; backup/write-disable on corruption.
- **Risks:** Races, direct balance writes, universal release.
- **Definition of Done:** Ledger/dimensions reconcile under concurrency.

### Phase 3 Package Execution Records

- **WP-03-01 Ledger Expansion/Reconciliation** — read 03,04,06,09,11–14; expand WP-02-02 to remaining movements/reconciliation; depends on WP-02-02 and WP-02-05; test atomicity/concurrency/idempotency; no direct/generic write.
- **WP-03-02 Transfer/Reversal** — read 04,06,09–14; output one-step transfer/inverse and role-safe screens; test availability/classification/rollback/dependency; depends on WP-03-01, WP-01-08 and PCD-APR-001; classification transfer rules follow DEC-064; no in-transit target balance; report exact effects.
- **WP-03-03 Reservations/Submission** — read 03,04§9,06,09,11–14; output reservation service/safe submit; test fixture/concurrency/release/replay; depends on WP-03-01; DEC-065 blocks quality-risk reservation/submission until review/disposition makes stock accepted/sellable; no on-hand reduction/expiry; report totals.
- **WP-03-04 Alerts/Failure Resolution** — read 03,04,06,09,12–14; output critical alert/reason resolver; test technical unchanged, corruption reconcile, retain/release mapping; depends on WP-03-03; no global `approval_failed`; report reason matrix.

## 7. Phase 4 — Production/WIP and Factory Payables

- **Goal:** Preserve factory on-hand/WIP/output/waste/cost/lineage without duplication.
- **Read:** Contracts 03–07,09–14.
- **Order:** WP-04-01 → WP-04-02 → WP-04-03; WP-04-04 after WP-04-01.
- **Dependencies:** WP-03-02 and WP-00-03C, followed by the exact package chain below.
- **Scope/modules:** Production service/screens, WIP/allocation/lot, payable integration, WIP return.
- **Non-goals:** Capacity planning, output-based live cost, worker finance.
- **Migrations/API/UI:** Production child/event rows; issue/receipt/WIP-return commands; worker and management views.
- **Acceptance/tests:** Full/partial fixtures, no duplicate allocation, exact input payable, WIP return atomic.
- **Smoke:** Transfer→issue→single receipt/waste/payable→twist→WIP return.
- **Rollback:** Domain reversal/correction; preserve originals.
- **Risks:** Double count, output costing, early rounding.
- **Definition of Done:** All production quantities/cost/source links reconcile.

### Phase 4 Package Execution Records

- **WP-04-01 Orders/Issue WIP** — read 03–06,09–14; output many-to-many draft/issue; test availability/WIP/concurrency/redaction; depends on WP-03-02, WP-00-03C, WP-01-08 and PCD-APR-001; no payable/header-only lineage; report quantity chain.
- **WP-04-02 Receipt Draft/Allocation Validation** — read 03–06,09–14; output draft/preview/subject hash only; test full/partial/structural reuse/redaction and zero stock/WIP/account effects; depends on WP-04-01 and WP-01-08.
- **WP-04-03 Atomic Receipt/Output/Waste/Payable** — read 05–07,09,12–14; output lot, stock, waste, WIP, snapshot, payable, state and audit in one transaction; test every effect/failure/concurrency/idempotency; depends on WP-04-02 and PCD-APR-001; no split posting.
- **WP-04-04 WIP Return** — read 04–06,09–14; output request/approval/movement; test no-effect request, state/WIP/role/rollback; depends on WP-04-01, WP-01-08 and PCD-APR-001; no generic adjustment; report before/after.

## 8. Phase 5 — Sales, Approvals, Payments and Direct Costs

- **Goal:** Exact multi-line revenue, atomic sales effects and immutable operational balances.
- **Read:** Contracts 03,04,06,07,09–14.
- **Order:** WP-05-01 → WP-05-02 → WP-05-03 → WP-05-04 → WP-05-05.
- **Dependencies:** WP-03-03, WP-02-03 and WP-00-03D, followed by the exact package/PCD chain below.
- **Scope/modules:** Sales/calculation/approval/failure, Subledger payments/settlements, direct cost/profit snapshots, screens.
- **Non-goals:** Full accounting/general ledger/statutory profit.
- **Migrations/API/UI:** Sales lines/precise fields/snapshots/payments/direct costs; dedicated commands; gated screens.
- **Acceptance/tests:** Exact rounding/allocation, one approval posting, failure classification, signed balances and cost separation.
- **Smoke:** Submit/approve sale, partial payment, statement, failure/review scenario.
- **Rollback:** Reversal/correction; pending reservation explicit release only by contract.
- **Risks:** Floating point, duplicate approval, wrong signs, reservation release bug.
- **Definition of Done:** Stock/accounts/snapshots exact and immutable.

### Phase 5 Package Execution Records

- **WP-05-01 Sales Draft/Discount/Submit** — read 03,04,07,09–14; output multi-line exact calculator/screen/reservation submit; test tie/largest residual/zero/role/reservation; depends on WP-03-03, WP-01-08 and WP-00-03D; quality-risk stock follows DEC-065; no client totals/single-line backend; report exact fields.
- **WP-05-02 Profitability Snapshot V1 Foundation** — read 03,06,07,12–14; output transaction-aware immutable snapshot service; test exact net/missing flags/version/rollback; depends on WP-05-01 and WP-02-03.
- **WP-05-03 Sales Approval/Failure** — read 04,06–07,09–14; output atomic issue/receivable/snapshot/audit and separate failure resolution with review UI; test subject mutation/all failures/concurrency/idempotency/orphan; depends on WP-05-02, WP-03-04, WP-01-08 and PCD-APR-001.
- **WP-05-04 Payments/Settlement/Reversal** — read 06,07,09–14; output immutable posting/settlement/reversal and statement screens; test concurrent settlement/reversal; depends on WP-02-03, WP-04-03, WP-05-03, WP-01-08 and PCD-APR-001; payment methods follow DEC-066.
- **WP-05-05 Direct Cost/Later Snapshot Versions** — read 06,07,09–14; output reviewed financial posting/allocation, queue UI and version updates through WP-05-02; depends on WP-05-04, WP-05-02, WP-01-08 and PCD-APR-001.

## 9. Phase 6 — Quality, Complaints, Returns

- **Goal:** Quality/return behavior with controlled availability and linked financial effects.
- **Read:** Contracts 03,04,06,07,09–14.
- **Order:** WP-06-01 → WP-06-02 → WP-06-03 → WP-06-04.
- **Dependencies:** WP-05-03 for quality/complaints and WP-05-04 for replacement settlement behavior, followed by the exact package/PCD chain below.
- **Scope/modules:** Quality/complaint/return/replacement services/screens.
- **Non-goals:** Quality financial authority, automatic refund, unlinked replacement.
- **Migrations/API/UI:** Quality/complaint/return links; return/normal sales/payment commands; worker facts and management decisions.
- **Acceptance/tests:** Block/risk, return caps/classification, equal/higher/lower replacement.
- **Smoke:** Test→complaint→return→replacement→statement/stock.
- **Rollback:** Linked inverses/corrections; preserve complaint/audit.
- **Risks:** Returned stock saleable, credit leak/value cap error.
- **Definition of Done:** Stock/account/lineage exact and worker finance-free.

### Phase 6 Package Execution Records

- **WP-06-01 Quality/Risk** — read 03,04,06,10–14; output tests/status/review; test states/risk/role; depends on WP-05-03 and WP-01-08; PCD-APR-001 additionally gates management disposition approval; no quality approval of finance/stock; report guard evidence.
- **WP-06-02 Complaints** — read 03,10–14; output investigation/links; test references/roles/audit/no effect; depends on WP-06-01 and WP-01-08; no auto return; report trace.
- **WP-06-03 Return Approval** — read 04,06,07,09–14; output facts/approval/stock/credit; test cap/classification/treatment/atomicity; depends on WP-06-01, WP-06-02, WP-01-08 and PCD-APR-001; return residual follows DEC-068; no worker treatment/double stock; report exact effects.
- **WP-06-04 Replacement** — read 03,06,07,09–14; output linked two-event flow/difference/refund action; test equal/higher/lower/caps/reservation/no auto refund; depends on WP-06-03, WP-05-03, WP-05-04 and WP-01-08; no manual difference; report cases.

## 10. Phase 7 — Historical Migration

- **Goal:** Transform untrusted sources into approved locked history without bypass.
- **Read:** Contracts 01,03–09,11–14.
- **Order:** WP-07-01 → WP-07-02 → WP-07-03 → WP-07-04 → WP-07-05.
- **Dependencies:** WP-00-03E, WP-02-05, WP-02-06, WP-03-04, WP-04-04, WP-05-05, WP-06-04 and the exact migration PCD gates below.
- **Scope/modules:** Private files/templates/staging/validation/alias/reconciliation/review/approvals/commit/correction UI/services.
- **Non-goals:** Permanent workbook schema, AI approval, direct/partial import.
- **Migrations/API/UI:** Migration structures and commands per 08; dense permission-safe management screens.
- **Acceptance/tests:** Zero staging effect, full provenance, dual current approvals, atomic idempotent locked commit, correction.
- **Smoke:** Upload→stage→validate→reconcile→dual approve→commit→locked detail.
- **Rollback:** Cancel before commit; after commit use correction or environment recovery per authorization.
- **Risks:** Hidden formulas, manual effort, stale approval, unbounded request.
- **Definition of Done:** History cannot silently corrupt operations.

### Phase 7 Package Execution Records

- **WP-07-01 Templates/Files/Staging** — read 01,03–14; output private/versioned/provenance/cutover staging and management screens; test privacy/metadata/duplicates/no-double-count/isolation; depends on WP-00-03E, WP-02-05, WP-02-06, WP-03-04, WP-04-04, WP-05-05, WP-06-04 and WP-01-08; historical approvals/cutover/reconciliation follow DEC-069/071/072.
- **WP-07-02 Validation/Aliases** — read 03,08,11–14; output rules/findings/review; test required/date/unit/currency/duplicate/relations/confidence; depends on WP-07-01 and WP-01-08; no fuzzy auto merge/severity downgrade; report coverage.
- **WP-07-03 Reconciliation/Review** — read 04,05,07,08,10–14; output versioned totals/cutover/differences; test openings+transactions, WIP, document collision, mismatch/negative/version invalidation; depends on WP-07-02 and WP-01-08.
- **WP-07-04 Dual Approval/Commit** — read 06,08,09,11–14; output current approvals/cutover lock/atomic domain commit; test distinct-identity policy, live-post race, measured batch ceiling, backup, stale approval, concurrency/idempotency/failure; depends on WP-07-03, WP-02-06 and PCD-APR-001; distinct identity follows DEC-069.
- **WP-07-05 Historical Correction** — read 04–09,11–14; output linked correction/reconciliation; depends on WP-07-04 and PCD-APR-001; renewed dual approval follows DEC-070; any correction UI additionally depends on WP-01-08; no reopen/patch.

## 11. Phase 8 — Gated Frontend Expansion, Reports and Traceability

- **Goal:** Complete authorized UI and decision/reporting surfaces using stable domain data.
- **Read:** Contracts 02–12, especially 10–14.
- **Order:** WP-08-01A, WP-08-01B, WP-08-01C, WP-08-01D, WP-08-01E, WP-08-01F, WP-08-01G and WP-08-01H only after their explicit dependencies → WP-08-02 → WP-08-03.
- **Dependencies:** WP-01-08 plus the exact package-specific dependencies listed for WP-08-01A through WP-08-01H below.
- **Scope/modules:** Remaining screens, TraceabilityService, ReportService, exports/profit views.
- **Non-goals:** Unapproved UI pattern, external/legal export, browser-only aggregation/security.
- **Migrations/API/UI:** Minimal reporting indexes/snapshots if contracted; permission-safe query/export APIs; all remaining screens.
- **Acceptance/tests:** Every screen contract, trace fixture, exact reports, export/worker denial.
- **Smoke:** Role navigation, trace chain, reports/accountant export/worker block.
- **Rollback:** Disable wrong report/screen route without mutating transactions.
- **Risks:** Financial leak, inaccurate aggregate, frontend big bang.
- **Definition of Done:** Screens/reports are role-safe, exact and visually approved.

### Phase 8 Package Execution Records

- **WP-08-01A Warehouse/Inventory UI** — depends on WP-01-08, WP-02-05 and WP-03-04; read 02,04,09–14; test role/field/RTL/a11y/responsive/reconciliation.
- **WP-08-01B Production/WIP UI** — depends on WP-01-08 and WP-04-04; read 02,05,09–14; test worker redaction/WIP/allocation/RTL/a11y.
- **WP-08-01C Sales/Approval UI** — depends on WP-01-08 and WP-05-03; DEC-065 controls quality-risk stock; read 02,04,06,07,09–14; test exact totals/stale hash/failure messages.
- **WP-08-01D Payments/Direct-Cost UI** — depends on WP-01-08 and WP-05-05; DEC-066 controls payment methods; read 02,06,07,09–14; test signs/allocations/redaction.
- **WP-08-01E Quality/Return UI** — depends on WP-01-08 and WP-06-04; DEC-068 controls return residuals; read 02,04,06,07,09–14; test caps/replacement/redaction.
- **WP-08-01F Migration UI** — depends on WP-01-08 and WP-07-05; DEC-069/070/071/072 control approval/correction/cutover/reconciliation; read 02,08–14; test provenance/warnings/approvals/locks.
- **WP-08-01G Dashboard/Queue Wiring** — depends on WP-01-08, WP-05-05, WP-06-04, WP-07-05 and WP-02-06; read 02,07–14; test ledger equality/partial failure/no visual drift.
- **WP-08-01H Settings/User UI** — depends on WP-01-08, WP-01-02, PCD-AUTH-002 and resolved DEC-061/062/063; read 01–03,10–14; test Owner-only mutation/audit.
- **WP-08-02 Full Traceability** — depends on WP-06-04, WP-07-05, WP-08-01A, WP-08-01B, WP-08-01C and WP-08-01E; read 03–08,10–14; test full chain/tenant/role/performance.
- **WP-08-03 Reports/Exports/Profit** — depends on WP-08-02, WP-05-05, WP-06-04 and WP-07-05; read 07,10–14; test totals/filters/permissions/rounding/missing flags.

## 12. Phase 9 — Hardening, Backup UI, Pilot Readiness

- **Goal:** Prove recovery/security/quality and execute controlled UAT/pilot gate.
- **Read:** All contracts and execution documents.
- **Order:** WP-09-01 → WP-09-02 → WP-09-03.
- **Dependencies:** WP-09-01 depends on WP-02-06 and WP-01-08; WP-09-02 depends on WP-09-01 and WP-08-03; WP-09-03 depends on WP-09-02 and its named PCD gates below.
- **Scope/modules:** Operations evidence UI, defect fixes in bounded packages, test/evidence ledgers, UAT/pilot/training/rollback.
- **Non-goals:** Automatic production launch or unresolved setup choice.
- **Migrations/API/UI:** Only defect/evidence-required reviewed changes; backup status jobs; no production restore API.
- **Acceptance/tests:** Full regression/security/accessibility/restore/migration/concurrency; parallel reconciliation.
- **Smoke:** Full lifecycle, backup/restore, trace/report, write-disable/rollback.
- **Rollback:** Last known good deployment; restore to test/authorized environment; disable writes on data issue.
- **Risks:** Pilot treated as production, failures waived, unresolved recovery objectives.
- **Definition of Done:** Ready for approved limited pilot; production remains separately gated.

### Phase 9 Package Execution Records

- **WP-09-01 Backup/Restore Status UI** — read 01,09–14; output safe evidence/jobs; test role/secret/separate target/idempotency/states; depends on WP-02-06 and WP-01-08; no production restore/resolved-marker invention.
- **WP-09-02 Full Regression/Hardening** — read all; output test ledger/bounded fixes/limitations; test complete matrix; depends on WP-09-01 and WP-08-03; no expectation weakening; report commands/results/defects.
- **WP-09-03 UAT/Pilot/Go-Live Gate** — read context/decisions/01,08,10–14; output UAT/parallel reconciliation/training/rollback/readiness decision; test role lifecycles/recovery; depends on WP-09-02, PCD-AUTH-002, PCD-SEC-003, PCD-PILOT-001, PCD-PILOT-002 and PCD-FILE-001; production go-live additionally requires PCD-OPS-001; no production/Excel replacement claim; report owner decision/blockers.

## 13. Unresolved Decisions That Must Remain Visible

```text
Private sign-in and password/account-recovery method
Production Vercel/Supabase tier and budget
Production backup retention, RPO, and RTO
Production monitoring/alert provider
Final visual token values until reference-screen owner approval
```

Supabase region is resolved: Europe general; if specific, Central EU/Frankfurt; record assigned region and Egyptian latency before long-lived pilot creation.

## 14. Recommended First GLM Action

Start only **WP-00-01 — Project and Bootstrap Verification**. It is read-only/diagnostic except for any separately approved minimal evidence files. Its report determines the exact safe changes for WP-00-02. Do not start inventory posting, sales approval, historical commit, or broad frontend.
