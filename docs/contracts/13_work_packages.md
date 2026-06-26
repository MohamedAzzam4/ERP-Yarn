# Implementation Work Packages

## 1. Purpose and Execution Policy

This catalog splits the MVP into dependency-ordered units. GLM implements exactly one package at a time and may not pull downstream behavior into an earlier package.

Within that package, GLM runs focused tests continuously as coherent changes are made. It then runs the complete package gate before completion. After all packages in the phase pass individually, GLM runs the integrated phase gate before requesting merge. No layer replaces another.

Every package starts only after its dependencies pass and ends with a completion report containing:

```text
contract files read
files changed
business rules applied
tests run and exact results
known failures
what was intentionally not changed
remaining risks
recommended next dependency-ready work package
```

Common prohibitions for every package:

- no business-rule change or undocumented status/permission/API;
- no direct stock write outside InventoryLedgerService;
- no account entry outside SubledgerService;
- no approval as status-only CRUD;
- no historical source/AI output directly into operational tables;
- no frontend-only permission enforcement or fetch-then-hide redaction;
- no hardcoded design colors; use centralized semantic tokens;
- no broad frontend expansion before reference-screen approval;
- no JavaScript floating-point authority for business calculations;
- no inconsistent coding style, unrelated refactors, meaningless helper splitting, or large unstructured functions/components that violate `14_coding_agent_instructions.md`;
- no direct edit of approved/posted/committed history.

### Mandatory Executable Package Instance

The catalog defines business/dependency scope. Except for read-only WP-00-01, a package is not executable until the WP-00-01 repository report is used to create/review its package instance with:

- exact allowed file paths and module boundaries;
- exact migration/API/UI artifacts allowed;
- exact package smoke command/manual path and expected result;
- exact regression-matrix rows/commands triggered;
- exact rollback/recovery procedure appropriate to whether business data exists;
- fixture/version and evidence destination;
- active phase branch name, permitted remote, pull-request target and merge authority;
- publication method: authenticated phase-branch push, DEC-060 owner-authorized temporary chat credential push, or DEC-059 verified credentialless bundle handoff;
- explicit external-state authorization, if any.

After implementation, changed paths must be wholly inside the allowlist. Missing/vague dependencies such as “base slice,” “affected domain,” “as applicable,” or “relevant module” make the package blocked, not discretionary. Every non-reference package that creates or changes UI has an additional mandatory dependency on **WP-01-08**, even if a package record accidentally omits it.

WP-00-01 itself is read-only across the workspace: it may inspect files/commands and report in the conversation, but creates/repairs no repository, package baseline, evidence file, cloud project or deployment without separate explicit authorization.

Every implementation package runs on the current `phase/NN-name` branch. GLM may push only that branch, never `main`. Package completion does not authorize merge: the phase PR remains unmergeable until every phase gate and required preview/integration check passes and the owner explicitly authorizes that phase merge.

When the sandbox lacks a secure credential channel, GLM may use DEC-060 temporary chat credentials only when the owner explicitly authorizes the exact development/test operation and the credential is short-lived and scope-limited. If DEC-060 is not authorized, GLM follows DEC-059 and exports a verified bundle instead. The next package remains blocked until either the authorized remote push is verified or the bundle is imported into a trusted workspace, rebased/cherry-picked onto current `main` as required, retested, pushed to the phase branch, and remotely verified.

## 2. Phase 0 — Foundation and Risk Controls

### WP-00-01 — Project and Bootstrap Verification

- **Goal:** Establish the repository/runtime baseline without building ERP features.
- **Inputs:** Existing repository, Technical Architecture and Decision Log.
- **Required reading:** `00_project_context`, `01_final_implementation_plan_v4`, `02_decision_log_and_scope`, contract index, contracts 01, 12–14, execution index and execution plan.
- **Expected outputs:** Conversation report of verified workspace, Git/package/runtime/environment inventory, baseline commands, exact candidate module/file allowlists and risks; explicit Docker/container-runtime and Supabase-local feasibility verdict; no file output unless separately authorized.
- **Implementation notes:** Preserve user files; verify Node 24/Next/React/TypeScript baseline and whether project is empty/partial. Check Docker client/server/daemon access, Compose availability, OS/architecture and material sandbox restrictions using non-mutating diagnostics. Do not install Docker/Supabase CLI, pull images, start containers, or change daemon settings in WP-00-01.
- **Tests:** Existing install/build/type/lint/test commands or documented absence/failure; run/read `docker version`, `docker info`, `docker compose version`, and an already-installed Supabase CLI version command where available. Record exact command, exit code and safe output summary.
- **Acceptance:** Current state and safe next setup changes are evidenced. Docker verdict is exactly `confirmed_available_for_WP-00-02`, `unavailable`, or `unconfirmed_due_to_sandbox_policy`; if not confirmed, name the hosted-development fallback and the authorization it requires.
- **Dependencies:** None.
- **What not to change:** Everything: this package is read-only and may not repair `.git`, scaffold/install packages, create evidence files, mutate provider data or deploy.
- **Common failures:** Assuming empty repo; upgrading packages without compatibility review.
- **Completion report:** Standard report plus repository-state evidence, Docker/Compose/daemon verdict, Supabase CLI availability and the local-versus-hosted development-test recommendation.

### WP-00-02 — Technical Stack and Environment Setup

- **Goal:** Configure the contracted Next.js/Vercel/Supabase/Drizzle development baseline.
- **Inputs:** WP-00-01 report; DEC-053 region decision; DEC-056 hosted-development availability; DEC-057 key/environment model.
- **Required reading:** Contracts 01, 03, 09, 11, 12, 14.
- **Expected outputs:** Reproducible package lock, environment schema/examples, server/client secret boundary, Supabase CLI local/test configuration, synthetic seed boundary, and deployment skeleton.
- **Implementation notes:** Pin compatible stable versions; Node runtime for high-risk handlers; prepared statements disabled on pooled postgres.js transaction-pooler path. Pin Supabase CLI as a project development dependency if needed; do not install it globally. Docker is currently unavailable, so preserve the hosted-development fallback marker without connecting to it in this package. `.env.example` uses only the DEC-057 variable names with empty values.
- **Tests:** Clean install/build/typecheck; retain the documented `unavailable` Docker/local-Supabase result; unsafe/missing env rejection; legacy key-name rejection; no secrets in client bundle/log. Do not perform hosted connectivity, health checks, remote migrations, schema application, Auth/Storage integration, or remote data mutation in WP-00-02.
- **Acceptance:** App can start without domain features and configuration is reproducible.
- **Dependencies:** WP-00-01.
- **What not to change:** Auth method remains unresolved; no production tier decision; no cloud project/deployment/paid change; no hosted Supabase connection/health route; no database schema or migration; no legacy Supabase key fallback without a separate approved compatibility decision.
- **Common failures:** `NEXT_PUBLIC_` secret, runtime migration, Edge high-risk writes.
- **Completion report:** Include exact dependency versions and unresolved markers.

### WP-00-03A — Platform, Tenant and Security Schema

- **Goal:** Implement only tenant/user/role/permission/settings/terminology/sequence/approval/audit/idempotency/alert foundations.
- **Inputs:** Technical setup, canonical hierarchy, and resolved owner decisions DEC-061, DEC-062 and DEC-063.
- **Required reading:** Contracts 01, 03 §§5–8, 06–07, 11–14.
- **Expected outputs:** Reviewed platform Drizzle schema/SQL migration and seeds.
- **Implementation notes:** Approval subject hash/version and idempotency lease recovery are mandatory.
- **Tests/Acceptance:** Clean DB, tenant keys, role/permission constraints, sequence concurrency, audit immutability, orphan recovery.
- **Dependencies:** WP-00-02.
- **What not to change/Common failures:** No domain tables; no policy beyond DEC-061/062/063; no tenant-wide worker shortcut.
- **Completion report:** Migration/evidence, applied DEC-061/062/063 behavior and still-open decisions.

### WP-00-03B — Inventory Identity and Ledger Schema

- **Goal:** Implement inventory-item/batch/lot identity, locations/factories, movement/balance/reservation/adjustment structures.
- **Inputs:** Approved Schema/Inventory contracts and resolved decisions DEC-064 and DEC-065.
- **Required reading:** Contracts 03 §§8–9, 04, 06, 11–14.
- **Expected outputs:** Inventory migration with one-to-one batch/lot item identity and constraints/indexes.
- **Tests/Acceptance:** Tenant identity, uniqueness, decimal scales, protected dimensions, movement/idempotency/reversal constraints.
- **Dependencies:** WP-00-03A.
- **What not to change/Common failures:** No service/UI, generic movement or negative flag.
- **Completion report:** Inventory migration evidence.

### WP-00-03C — Production and WIP Schema

- **Goal:** Implement many-to-many production input/output, WIP, receipt allocation, waste and WIP-return structures.
- **Inputs:** Inventory identity schema and Production contract.
- **Required reading:** Contracts 03 §10, 04–06, 12–14.
- **Expected outputs:** Production migration/constraints/indexes.
- **Tests/Acceptance:** Multiple inputs/outputs, allocation uniqueness, WIP scale/tenant links, clean migration.
- **Dependencies:** WP-00-03B.
- **What not to change/Common failures:** No single header-only input or payable at issue.
- **Completion report:** Production schema evidence.

### WP-00-03D — Sales, Returns, Subledger and Cost Schema

- **Goal:** Implement exact sales/return/profitability/account/payment/settlement/direct-cost persistence vocabulary.
- **Inputs:** Resolved decisions DEC-066, DEC-067, DEC-068 and approved financial contracts.
- **Required reading:** Contracts 03 §§11–12, 06–07, 09, 11–14.
- **Expected outputs:** Financial/domain migration, enums/checks/subject versions/source uniqueness.
- **Tests/Acceptance:** Exact decimal fields, line totals, entry/direction/settlement values, return caps, immutability.
- **Dependencies:** WP-00-03A and WP-00-03B.
- **What not to change/Common failures:** No payment-method guesses or editable balances.
- **Completion report:** Financial schema evidence/blockers.

### WP-00-03E — Historical Migration Schema

- **Goal:** Implement versioned file/staging/validation/reconciliation/approval/cutover/commit metadata without operational commit behavior.
- **Inputs:** Resolved decisions DEC-069, DEC-070, DEC-071, DEC-072 plus the Migration contract.
- **Required reading:** Contracts 03 §14, 08, 11–14.
- **Expected outputs:** Migration structures/statuses/checksums/provenance/cutover-lock schema.
- **Tests/Acceptance:** Tenant/file/source/version/status constraints and invalid obsolete status rejection.
- **Dependencies:** WP-00-03A.
- **What not to change/Common failures:** No current-workbook schema or direct operational FK shortcut.
- **Completion report:** Migration schema evidence/blockers.

### WP-00-04 — Theme and Design-System Foundation

- **Goal:** Establish semantic tokens, typography, component conventions and light-only theme.
- **Inputs:** Design contract and technical frontend baseline.
- **Required reading:** Contracts 02, 10, 12, 14.
- **Expected outputs:** Token/theme/font foundation and shared primitive policy; provisional visual values clearly marked.
- **Implementation notes:** Tailwind semantic utilities, Tajawal/Alexandria, shadcn/Radix accessibility.
- **Tests:** Token usage/static checks, font loading, light-only behavior, contrast preliminary check.
- **Acceptance:** No component literal colors and provisional tokens can be approved through references.
- **Dependencies:** WP-00-02.
- **What not to change:** No dark mode, theme editor, broad screens.
- **Common failures:** Hardcoded palette, library default style treated as design system.
- **Completion report:** Token inventory and deferred final values.

### WP-00-05 — Arabic RTL and Layout Foundation

- **Goal:** Implement root Arabic direction, local LTR isolation, shared layouts, feedback/accessibility primitives.
- **Inputs:** Theme foundation and screen contract.
- **Required reading:** Contracts 02, 10, 12, 14.
- **Expected outputs:** `<html lang="ar" dir="rtl">`, isolated value component, RTL-safe shell primitives, accessible state patterns.
- **Implementation notes:** No `dir="auto"` for sentences; logical properties and RTL icon review.
- **Tests:** Mixed-direction components, keyboard/focus, reduced motion, 200% zoom, 360px worker shell.
- **Acceptance:** Core dialogs/drawers/forms/tables can render RTL safely.
- **Dependencies:** WP-00-04.
- **What not to change:** No module-specific screens or invented Arabic terms.
- **Common failures:** Whole sentence flips LTR; visual-only error/toast.
- **Completion report:** QA evidence and unresolved terminology.

### WP-00-06 — Demo Deployment and Health Foundation

- **Goal:** Deploy the non-business foundation online for development/demo verification.
- **Inputs:** Technical/database/RTL foundations.
- **Required reading:** Contracts 01, 03, 12, 14.
- **Expected outputs:** Vercel phase-branch Preview, separately authorized Supabase development/test integration, Europe-region evidence, server health check, migration status visibility, and post-merge online-demo evidence only after owner-authorized merge.
- **Implementation notes:** Record assigned region and Egyptian latency; Preview points only to development/test Supabase; demo/free tier is not production. Project creation, linking, secret configuration, remote migration, deployment and merge each require recorded external authorization.
- **Tests:** Preview open, synthetic DB/Auth/Storage health, secret boundary, preview/environment separation, migration status, logs, and post-merge online-demo smoke when merge is authorized.
- **Acceptance:** Foundation is deployable and labeled development/demo.
- **Dependencies:** WP-00-02, WP-00-03A, WP-00-05.
- **What not to change:** No real/pilot data; no production claim.
- **Common failures:** Public health secrets, preview using pilot DB.
- **Completion report:** Deployment URL/evidence without credentials.

## 3. Phase 1 — Auth, RBAC, Audit, Shells, Reference Gate

### WP-01-01 — Private Auth Integration

- **Goal:** Implement private session/login/recovery only after owner resolves the method.
- **Inputs:** Resolved PCD-AUTH-001 and PCD-AUTH-002.
- **Required reading:** Contracts 01, 10 §4, 11, 12, 14.
- **Expected outputs:** Login/session/server validation, inactive/unmapped behavior, approved recovery flow.
- **Implementation notes:** Supabase identity is not ERP authorization; no public signup.
- **Tests:** Login/logout/recovery, inactive/cross-tenant denial, protected redirects, enumeration safety.
- **Acceptance:** Server maps authenticated identity to active ERP user/tenant.
- **Dependencies:** WP-00-06, PCD-AUTH-001 and PCD-AUTH-002.
- **What not to change:** No role selector/client role authority.
- **Common failures:** Client metadata trusted, recovery grants ERP role.
- **Completion report:** Decision reference and auth tests.

### WP-01-02 — Backend RBAC and Field-Redaction Guard

- **Goal:** Centralize permission, tenant, row and field enforcement.
- **Inputs:** Seeded roles/permissions and authenticated context.
- **Required reading:** Contracts 03, 09, 10, 11, 12, 14.
- **Expected outputs:** Permission guard, safe DTO/query patterns, role test fixtures.
- **Implementation notes:** Deny before entity disclosure; RLS defense in depth.
- **Tests:** Every role, direct URL/API, nested/error/export redaction, cross-tenant and service-role paths.
- **Acceptance:** Forbidden fields are absent and actions fail backend-side.
- **Dependencies:** WP-00-03A, WP-01-01.
- **What not to change:** No wildcard worker permissions or UI-only security.
- **Common failures:** Fetch full ORM row then hide.
- **Completion report:** Permission matrix coverage.

### WP-01-03 — Audit, Idempotency and Document Numbering Foundation

- **Goal:** Build reusable transaction-safe audit, idempotency and locked sequence capabilities.
- **Inputs:** Base schema/RBAC.
- **Required reading:** Contracts 03, 06, 09, 11, 12, 14.
- **Expected outputs:** Append-only audit service, idempotency persistence, sequence allocator.
- **Implementation notes:** Success audit shares transaction; failed attempt does not imply posting.
- **Tests:** Sequence concurrency, replay/conflict, audit rollback/immutability/permission.
- **Acceptance:** Duplicate commands/numbers prevented and audit cannot be edited.
- **Dependencies:** WP-01-02.
- **What not to change:** No generic approval/posting transaction that omits domain locks.
- **Common failures:** Audit after commit, idempotency only in memory.
- **Completion report:** Concurrency/failure-injection evidence.

### WP-01-04 — Worker and Management Shells

- **Goal:** Implement permission-filtered Worker Task and shared Owner/Accountant shells.
- **Inputs:** RTL/design/RBAC foundations.
- **Required reading:** Contracts 02, 10 §§5–6, 11, 12, 14.
- **Expected outputs:** Task home, management sidebar/breadcrumb/state primitives.
- **Implementation notes:** Same management visual language, permission-dependent destinations.
- **Tests:** Role navigation/direct URLs, 360px, tablet, keyboard/zoom/RTL.
- **Acceptance:** Workers receive task-first finance-free shell; management shell is shared.
- **Dependencies:** WP-00-05, WP-01-02.
- **What not to change:** No broad module pages or global search.
- **Common failures:** Mini management worker UI, client-only nav hiding.
- **Completion report:** Role screenshots and API redaction tests.

### WP-01-05 — Worker Raw-Receipt Reference Screen

- **Goal:** Establish worker form baseline with fixture/draft-safe behavior.
- **Inputs:** Shells, design primitives, approved/provisional terminology.
- **Required reading:** Contracts 02 reference section, 10 §7.1, 11, 12, 14.
- **Expected outputs:** Raw-receipt reference screen with required operational fields/states; no posting authority.
- **Implementation notes:** 360px+, 44×44px, visible labels/errors, finance-free DTO.
- **Tests:** Visual/RTL/LTR/accessibility/responsive/states and worker field/payload redaction.
- **Acceptance:** Ready for owner reference review; not reused broadly yet.
- **Dependencies:** WP-01-04, PCD-UX-001 and PCD-UX-004.
- **What not to change:** No price/cost/balance/profit; no live receipt approval.
- **Common failures:** Hidden financial field, management form density.
- **Completion report:** Reference version/evidence.

### WP-01-06 — Accountant Review-Queue Reference Screen

- **Goal:** Establish management filter/table/detail/approval-drawer baseline.
- **Inputs:** Management shell and safe fixture queue DTO.
- **Required reading:** Contracts 02, 06, 09, 10 §8.1, 11, 12, 14.
- **Expected outputs:** Categories/counts, missing-price/cost/payment/migration examples, distinct actions.
- **Implementation notes:** Fixture/read-only actions until domain commands exist; no fake successful approval.
- **Tests:** Role data/actions, RTL table/drawer, keyboard/tablet/phone practical view, all states.
- **Acceptance:** Ready for owner visual review and permission-safe.
- **Dependencies:** WP-01-04, PCD-UX-001 and PCD-UX-004.
- **What not to change:** No status-only CRUD or fabricated business effects.
- **Common failures:** Toast-only result, indistinguishable approve/reject.
- **Completion report:** Reference version/evidence.

### WP-01-07 — Owner Dashboard Reference Screen

- **Goal:** Establish dashboard cards/alerts/chart baseline.
- **Inputs:** Management shell and fixture dashboard DTO.
- **Required reading:** Contracts 02, 10 §6.1, 11, 12, 14.
- **Expected outputs:** Required high-level cards/alerts/approximate-profit labeling and drill-down placeholders.
- **Implementation notes:** Chart only if useful and with accessible summary.
- **Tests:** Fixture totals, permission, RTL/LTR, responsive, keyboard, reduced motion, partial failures.
- **Acceptance:** Ready for owner visual review.
- **Dependencies:** WP-01-04, PCD-UX-001 and PCD-UX-004.
- **What not to change:** No client aggregation of restricted rows or statutory profit claim.
- **Common failures:** Decorative charts, unlabeled incomplete metrics.
- **Completion report:** Reference version/evidence.

### WP-01-08 — Reference-Screen Approval Gate

- **Goal:** Record owner approval or concrete revisions for all three references.
- **Inputs:** Evidence from WP-01-05, WP-01-06 and WP-01-07.
- **Required reading:** Contracts 02 §Reference Gate, 10 §3, 12, 14.
- **Expected outputs:** Approved screen versions/tokens/density/breakpoints/RTL/limitations/date or failed gate.
- **Implementation notes:** This is a gate, not a coding shortcut.
- **Tests:** Visual QA matrix and accessibility/responsive evidence review.
- **Acceptance:** All three approved; otherwise broad frontend remains blocked.
- **Dependencies:** WP-01-05, WP-01-06, WP-01-07 and PCD-UX-002.
- **What not to change:** No silent token finalization or partial-gate claim.
- **Common failures:** Approval inferred from no feedback.
- **Completion report:** Owner decision evidence and permitted next scope.

## 4. Phase 2 — Masters, Raw Materials, Supplier Payable, Minimal Backup

### WP-02-01 — Master Data and Factory-Location Link

- **Goal:** Implement tenant-safe suppliers/customers/locations/factories and required masters.
- **Inputs:** Schema/RBAC/audit/sequence.
- **Required reading:** Contracts 03, 04, 11, 12, 14.
- **Expected outputs:** Master repositories/services/admin screens and inactivation/alias behavior.
- **Implementation notes:** One factory-linked location; referenced records inactive, not deleted.
- **Tests:** Tenant uniqueness, link constraints, inactivation, role/field permissions.
- **Acceptance:** Valid masters selectable and history-safe.
- **Dependencies:** WP-01-03, WP-00-03B and WP-01-08 for the admin screens.
- **What not to change:** No destructive merges or generic Admin.
- **Common failures:** Factory/provider identity conflated with location row.
- **Completion report:** Seed/constraint/UI tests.

### WP-02-02 — InventoryLedgerService Receipt Primitive

- **Goal:** Implement the minimal reusable ledger/balance transaction primitive required for the first raw receipt posting.
- **Inputs:** Inventory schema, locks/idempotency/audit foundations.
- **Required reading:** Contracts 03, 04 §§6–8/13–17, 06 §§6–7/17.1, 09 §§5–7/20.1, 11–14.
- **Expected outputs:** InventoryLedgerService transaction interface, raw-receipt movement/balance handler, deterministic lock order and reconciliation hook; no UI.
- **Implementation notes:** This is the explicit prerequisite formerly called a “base slice.”
- **Tests:** Receipt movement/balance atomicity, duplicate source/idempotency, concurrency, audit failure rollback, reconciliation mismatch.
- **Acceptance:** A service test can post/replay/roll back a raw-receipt inventory effect without any direct table mutation.
- **Dependencies:** WP-01-03, WP-02-01.
- **What not to change:** No transfer/reservation/production/sale handlers yet.
- **Common failures:** Generic balance mutator or movement committed without balance.
- **Completion report:** Exact service interface and tests.

### WP-02-03 — SubledgerService Account and Payable Primitive

- **Goal:** Implement minimal accounts/immutable entry posting required by raw supplier payable.
- **Inputs:** Account schema, audit/idempotency/sequence, and DEC-067 raw payable basis/authority.
- **Required reading:** Contracts 03 §12, 06 §17.1, 07 §§7–12, 09 §§5–7/20.1–20.2, 11–14.
- **Expected outputs:** SubledgerService entry interface, supplier-payable handler, source uniqueness and derived balance query; no payment UI.
- **Implementation notes:** Use DEC-067 for priced payable paths; missing price still posts stock without payable and routes to Accountant Review.
- **Tests:** Entry sign/source uniqueness, replay/concurrency, no zero payable, audit failure rollback, derived balance.
- **Acceptance:** One effective supplier entry can participate in an outer transaction or no entry is created.
- **Dependencies:** WP-01-03, WP-02-01.
- **What not to change:** No payment/settlement/factory/customer handlers yet.
- **Common failures:** Editable stored balance or payable posted outside caller transaction.
- **Completion report:** Service boundary and DEC-067 formula evidence.

### WP-02-04 — Raw Receipt Draft and Worker Screen Wiring

- **Goal:** Wire the approved worker reference to real draft persistence/query safely.
- **Inputs:** Approved reference, master data.
- **Required reading:** Contracts 03, 04, 10 §7.1, 11–14.
- **Expected outputs:** Raw batch/receipt draft service, screen, submit-for-review state.
- **Implementation notes:** Operational facts only; missing price allowed.
- **Tests:** Draft/update/submit state, validation, subject hash/version, tenant/role, worker redaction, RTL/accessibility.
- **Acceptance:** Worker can record 1,000kg draft without financial fields or stock posting.
- **Dependencies:** WP-01-08, WP-02-01.
- **What not to change:** No movement/payable before approved transaction.
- **Common failures:** Draft mutates balance; price defaults zero.
- **Completion report:** API/browser evidence.

### WP-02-05 — Raw Receipt Approval and Late-Price Path

- **Goal:** Atomically post raw stock and optional confirmed-price payable, with append-only late completion.
- **Inputs:** Submitted receipt, WP-02-02 and WP-02-03 services, and DEC-067 for any price-dependent path.
- **Required reading:** Contracts 03 §9.3.1, 04, 06 §17.1, 07 §11, 09 §§20.1–20.2, 11–14.
- **Expected outputs:** Dedicated approval/late-confirmation commands, movement/balance, payable or review, audit/idempotency.
- **Implementation notes:** InventoryLedgerService and SubledgerService share one outer transaction.
- **Tests:** Known/missing/late price, exact signs, duplicate confirmation, concurrency/idempotency/orphan recovery, failure injection/audit rollback.
- **Acceptance:** Fixture stock/payable/review exact with no partial effect or direct receipt edit.
- **Dependencies:** WP-02-02, WP-02-03, WP-02-04 and PCD-APR-001.
- **What not to change:** No worker approval, zero payable or in-place price update.
- **Common failures:** Movement commits before payable/audit; duplicate late payable.
- **Completion report:** Exact transaction/API tests.

### WP-02-06 — Manual Backup and Restore Smoke

- **Goal:** Prove minimum recovery before pilot/real data.
- **Inputs:** Representative database/files and backup design.
- **Required reading:** Contracts 01, 03, 08, 09 §21, 11, 12, 14.
- **Expected outputs:** Manual backup, separate-target restore, row/sample/file evidence.
- **Implementation notes:** Exports are not backups; no production restore endpoint.
- **Tests:** Restore counts, critical receipt/balance/account/source-file availability.
- **Acceptance:** Evidence recorded; limitations explicit.
- **Dependencies:** WP-02-05.
- **What not to change:** No production readiness claim or exposed credentials.
- **Common failures:** Backup exists but restore untested.
- **Completion report:** Sanitized evidence and recovery limitations.

### WP-02-07 — Raw Batch Thin Traceability

- **Goal:** Show receipt/source/movement/balance link without full traceability UI.
- **Inputs:** Approved receipt/movement.
- **Required reading:** Contracts 03, 04, 10 §10.1, 11, 12, 14.
- **Expected outputs:** Permission-safe raw batch detail timeline.
- **Implementation notes:** Read-only links; avoid unbounded global search.
- **Tests:** Link completeness, role redaction, tenant isolation.
- **Acceptance:** Receipt fixture trace resolves to source/movement/location.
- **Dependencies:** WP-02-05 and WP-01-08.
- **What not to change:** No full cross-domain traceability yet.
- **Common failures:** Financial fields leak to Warehouse.
- **Completion report:** Chain evidence.

## 5. Phase 3 — Inventory Ledger, Transfers, Reservations

### WP-03-01 — Inventory Ledger Expansion and Materialized Reconciliation

- **Goal:** Expand the proven receipt primitive to the remaining contracted inventory movements and full materialized reconciliation.
- **Inputs:** WP-02-02 service and approved raw receipt behavior.
- **Required reading:** Contracts 03, 04, 06, 09, 11, 12, 14.
- **Expected outputs:** Transfer/adjustment/block/return/reversal hooks, shared balance locking/order and full reconciliation.
- **Implementation notes:** Positive absolute quantities; explicit movement matrix.
- **Tests:** Every base movement, balance atomicity, concurrency, idempotency, reconciliation mismatch.
- **Acceptance:** No direct balance write and fixture ledger reconciles.
- **Dependencies:** WP-02-02, WP-02-05.
- **What not to change:** No generic movement/negative toggle.
- **Common failures:** Movement without balance or silent repair.
- **Completion report:** Service ownership proof/tests.

### WP-03-02 — One-Step Transfer and Movement Reversal

- **Goal:** Atomically transfer stock and preserve history through inverse reversal.
- **Inputs:** Ledger/balances/factory locations.
- **Required reading:** Contracts 04, 06, 09, 10, 11, 12, 14.
- **Expected outputs:** Transfer draft/approval/reversal services and role-safe screens.
- **Implementation notes:** Source/destination commit together; no in-transit workflow.
- **Tests:** Availability, block classification, rollback, duplicate, inverse/dependencies.
- **Acceptance:** Exact source decrease/destination increase and original retained.
- **Dependencies:** WP-03-01, WP-01-08 and PCD-APR-001.
- **What not to change:** No two-step transfer or target balance UI.
- **Common failures:** Destination posts after source commit.
- **Completion report:** Exact quantity/effect evidence.

### WP-03-03 — Reservation and Sales Submission Foundation

- **Goal:** Protect available stock for submitted pending sales.
- **Inputs:** Ledger, sales base schema, RBAC.
- **Required reading:** Contracts 03, 04 §9, 06, 09 §8, 11, 12, 14.
- **Expected outputs:** Reservation service, materialized reserved updates, safe submit command.
- **Implementation notes:** Draft does not reserve; Owner/Accountant completes commercial data.
- **Tests:** Fixture, concurrent oversell, cancellation/rejection/manual release, idempotency.
- **Acceptance:** On-hand unchanged at submission and reservation reconciles.
- **Dependencies:** WP-03-01. Quality-risk reservation/submission remains blocked by DEC-065 until review/disposition makes stock accepted/sellable.
- **What not to change:** No automatic expiry or approval issue.
- **Common failures:** Reservation reduces on-hand.
- **Completion report:** Concurrency and reconciliation results.

### WP-03-04 — Negative Alerts and Reservation Failure Resolution

- **Goal:** Implement controlled negative/reconciliation alerts and reason-based failed-sale resolution.
- **Inputs:** Ledger/reservations/approval foundation.
- **Required reading:** Contracts 03, 04 §§12,17, 06 §§7–8, 09, 12, 14.
- **Expected outputs:** Critical alerts, resolution transaction, `needs_review`/`approval_failed` sales behavior.
- **Implementation notes:** Technical failures change no business state; corruption fails/reconciles/alerts; stock/quality/commercial retain reservation.
- **Tests:** Every reason mapping, duplicate resolution, human release, no sale posting.
- **Acceptance:** No general auto-release and all changes audited.
- **Dependencies:** WP-03-03.
- **What not to change:** Do not add `approval_failed` globally.
- **Common failures:** Technical timeout marks failed or releases stock.
- **Completion report:** Reason matrix evidence.

## 6. Phase 4 — Production/WIP and Factory Payables

### WP-04-01 — Production Orders and Issue to WIP

- **Goal:** Create many-to-many-ready orders and atomically issue factory on-hand to WIP.
- **Inputs:** Factory stock, production schema, ledger.
- **Required reading:** Contracts 03–06, 09 §§13, 10 §§7.2/8.3, 11, 12, 14.
- **Expected outputs:** Draft/service/screen and approved issue transaction.
- **Implementation notes:** Issue creates no payable; worker facts only.
- **Tests:** Availability, factory location, WIP invariant, concurrency/idempotency/redaction.
- **Acceptance:** On-hand decreases and WIP increases exactly once.
- **Dependencies:** WP-03-02, WP-00-03C, WP-01-08 and PCD-APR-001.
- **What not to change:** No single header-only lineage or rate field for worker.
- **Common failures:** Factory on-hand counted as WIP before issue.
- **Completion report:** Quantity/lineage evidence.

### WP-04-02 — Production Receipt Draft and Allocation Validation

- **Goal:** Capture receipt/output/waste/input-allocation facts and validate a postable draft without changing WIP, stock or accounts.
- **Inputs:** Issued WIP.
- **Required reading:** Contracts 03–06, 09 §14, 10, 12, 14.
- **Expected outputs:** Receipt draft service/screen, allocation lineage preview, confirmed rate/basis review state and server validation result; no posted lot/movement/payable.
- **Implementation notes:** Consumption/waste reuse is detected under lock at approval later; this package stores facts and subject hash only.
- **Tests:** Full/partial draft fixtures, structural duplicate allocation, subject-hash invalidation, worker financial redaction, zero operational effects.
- **Acceptance:** Draft preview reconciles and database assertions prove WIP/on-hand/account entries unchanged.
- **Dependencies:** WP-04-01 and WP-01-08.
- **What not to change:** No hidden yield loss or output-only costing.
- **Common failures:** Same input charged/consumed twice.
- **Completion report:** Allocation and trace chain.

### WP-04-03 — Atomic Production Receipt, Output, Waste and Factory Payable

- **Goal:** Approve one receipt by atomically posting output lot/stock, waste, WIP consumption, input-based factory payable, order state and audit.
- **Inputs:** Current-hash receipt draft/allocation and confirmed rate.
- **Required reading:** Contracts 05 §§17–18, 06, 07, 09, 12, 14.
- **Expected outputs:** Dedicated approval command, output lot/movements, WIP/waste updates, rate/cost snapshot, SubledgerService payable, order/receipt state and audit.
- **Implementation notes:** One outer transaction coordinates ProductionPostingService, InventoryLedgerService and SubledgerService; decimal high precision then `ROUND_HALF_UP` at posting.
- **Tests:** Full/partial output/WIP/waste/payable, duplicate allocation, insufficient WIP, signs, midpoint/residual, concurrency/idempotency/orphan recovery, failure after every write, rate-history immutability.
- **Acceptance:** Each receipt creates all exact effects together or none; one source payable and immutable original.
- **Dependencies:** WP-04-02 and PCD-APR-001.
- **What not to change:** No payable at transfer/issue or live recalculation.
- **Common failures:** Output-based cost or early rounding.
- **Completion report:** Exact calculations and entry evidence.

### WP-04-04 — Return From WIP Correction

- **Goal:** Request and approve return of unprocessed WIP to stock.
- **Inputs:** Open WIP and correction authority.
- **Required reading:** Contracts 04–06, 09 §§15–16, 10, 11, 12, 14.
- **Expected outputs:** Worker request, management approval, movement/WIP update/review/audit.
- **Implementation notes:** Request has no quantity/account effect; approval atomic.
- **Tests:** State/WIP/role, insufficient WIP, idempotency, rollback, worker redaction.
- **Acceptance:** WIP decreases/destination on-hand increases exactly.
- **Dependencies:** WP-04-01, WP-01-08 and PCD-APR-001.
- **What not to change:** No generic adjustment or worker financial effect.
- **Common failures:** Request mutates stock.
- **Completion report:** Pre/post effect evidence.

## 7. Phase 5 — Sales, Approvals, Payments, Direct Costs

### WP-05-01 — Multi-Line Sales Draft, Discount and Submission

- **Goal:** Create multi-line-capable sale with exact server-calculated commercial totals and reservation submission.
- **Inputs:** Reservation foundation, masters, EGP arithmetic.
- **Required reading:** Contracts 03, 04, 07, 09 §§8, 10 §8.4, 11, 12, 14.
- **Expected outputs:** Draft/commercial completion/screen, allocation calculator, submit integration.
- **Implementation notes:** Decimal only; posted lines/residual/document total contract.
- **Tests:** zero/discount, tie/largest residual, precision, role fields, submission reservations.
- **Acceptance:** Exact totals and no worker price/submit authority.
- **Dependencies:** WP-03-03, WP-01-08 and WP-00-03D. Quality-risk stock follows DEC-065.
- **What not to change:** No client-authoritative totals or single-line-only backend.
- **Common failures:** Floating-point and early rounding.
- **Completion report:** Exact fixture output.

### WP-05-02 — Profitability Snapshot V1 Foundation

- **Goal:** Implement the immutable/versioned snapshot service required inside sales approval before approving any sale.
- **Inputs:** Cost lineage/read models, posted net-revenue contract and snapshot schema.
- **Required reading:** Contracts 03 §11.2/§19, 06 §8, 07 §§19–20, 12–14.
- **Expected outputs:** Transaction-aware ProfitabilitySnapshotService that creates version 1 with exact posted net revenue, cost components, profile/version and missing flags; no standalone approval/UI.
- **Implementation notes:** Service participates in caller transaction and never treats missing costs as zero-complete.
- **Tests:** Exact net/discount input, missing flags, one active version, duplicate source/idempotency, rollback with caller, worker redaction.
- **Acceptance:** A pending sale approval can create snapshot v1 atomically through this service.
- **Dependencies:** WP-05-01, WP-02-03. Production/direct/transport costs may be absent and must produce contracted missing-cost flags rather than a vague dependency.
- **What not to change:** No user-defined formula or later review/recalculation UI.
- **Common failures:** Snapshot after commit or discount double subtraction.
- **Completion report:** Service transaction/version tests.

### WP-05-03 — Atomic Sales Approval and Failure Handling

- **Goal:** Post issue/receivable/profitability/audit atomically and classify failures.
- **Inputs:** Pending sale/reservation, InventoryLedgerService, SubledgerService and WP-05-02 snapshot service.
- **Required reading:** Contracts 04, 06 §§7–8, 07, 09 §§9/20.4, 11–14.
- **Expected outputs:** Dedicated approval/failure-resolution/reject/cancel/correction services and review UI.
- **Implementation notes:** All three domain services share one outer transaction; technical no state change; separate business resolution.
- **Tests:** Success, subject-hash mutation, every failure reason, concurrency/idempotency/orphan recovery, injected write/audit failures, human reject.
- **Acceptance:** One exact posting including snapshot v1 or none; reason-based reservation result.
- **Dependencies:** WP-05-02, WP-03-04, WP-01-08 and PCD-APR-001.
- **What not to change:** No status-only approval or universal release.
- **Common failures:** Issue commits before receivable/snapshot.
- **Completion report:** Transaction/failure matrix.

### WP-05-04 — Payments, Settlements and Reversal

- **Goal:** Implement immutable party entries and payment matching.
- **Inputs:** Accounts and approved receivables/payables.
- **Required reading:** Contracts 06 §13, 07, 09 §18, 10 §8.5, 11, 12, 14.
- **Expected outputs:** Payment/settlement/reversal services and statement screens.
- **Implementation notes:** Balance derived by signed sum; payment separate from cost.
- **Tests:** Customer/supplier/factory fixtures, advance/partial/over-settlement/reversal/idempotency.
- **Acceptance:** Exact signs/balances and original entries immutable.
- **Dependencies:** WP-02-03, WP-04-03, WP-05-03, WP-01-08 and PCD-APR-001. User-facing methods follow DEC-066.
- **What not to change:** No editable balance or direct entry UI.
- **Common failures:** Sign inferred from UI label.
- **Completion report:** Statement/entry evidence.

### WP-05-05 — Direct Cost Review and Later Profitability Versions

- **Goal:** Separate worker suggestion, responsibility, payer, allocation, account effect and inclusion.
- **Inputs:** Subledger and linked operations.
- **Required reading:** Contracts 07 §§18–20, 10 §8.6, 11, 12, 14.
- **Expected outputs:** Draft/review/allocation services, queue UI and post-approval snapshot version updates using the existing WP-05-02 service.
- **Implementation notes:** Unknown data does not block safe stock; no entry before required review.
- **Tests:** Company/customer/factory/shared/unknown, allocation sum, role redaction, snapshot version.
- **Acceptance:** No conflation and missing data remains visible.
- **Dependencies:** WP-05-04, WP-05-02, WP-01-08 and PCD-APR-001.
- **What not to change:** No user-defined profitability formula.
- **Common failures:** Cost equals payment; worker controls payer.
- **Completion report:** Scenario matrix.

## 8. Phase 6 — Quality, Complaints, Returns

### WP-06-01 — Quality Tests and Risk State

- **Goal:** Record quality facts and enforce sale availability/risk approvals.
- **Inputs:** Items/lots/sales permission foundations.
- **Required reading:** Contracts 03, 04 §11, 06, 10 §§7.3/8.7, 11, 12, 14.
- **Expected outputs:** Quality draft/screens, status/disposition review integration.
- **Implementation notes:** Quality records facts; management authorizes risk.
- **Tests:** accepted/review/blocked, risk reason/permission, worker financial redaction.
- **Acceptance:** Blocked/review stock cannot ordinary-sell.
- **Dependencies:** WP-05-03, WP-01-08 and PCD-APR-001 for management disposition approval.
- **What not to change:** No Quality financial/stock approval.
- **Common failures:** Test status silently unblocks stock.
- **Completion report:** Status/permission evidence.

### WP-06-02 — Complaint Workflow

- **Goal:** Link complaint investigation to customer/sale/item/quality history.
- **Inputs:** Sales and quality data.
- **Required reading:** Contracts 03, 10 §8.7, 11, 12, 14.
- **Expected outputs:** Complaint draft/investigation/status/detail and trace links.
- **Implementation notes:** Complaint alone posts no stock/account effect.
- **Tests:** References, role scope, status/audit, no financial leak.
- **Acceptance:** Open/closed investigation traceable.
- **Dependencies:** WP-06-01 and WP-01-08.
- **What not to change:** No automatic return/credit.
- **Common failures:** Complaint status mutates sale.
- **Completion report:** Link/state evidence.

### WP-06-03 — Customer Return Approval and Classification

- **Goal:** Atomically receive approved return, classify stock and post selected credit treatment.
- **Inputs:** Approved sale/line/prior returns.
- **Required reading:** Contracts 04, 06 §9, 07 §10.1, 09 §11, 10 §8.7, 11, 12, 14.
- **Expected outputs:** Worker/Quality facts, management approval, stock/account/snapshot effects.
- **Implementation notes:** Quantity/value cap and returned/blocked dimensions.
- **Tests:** Prior returns, cap, classification availability, treatment, rollback/idempotency/redaction.
- **Acceptance:** Stock/customer impact exact and risky return unavailable.
- **Dependencies:** WP-06-01, WP-06-02, WP-01-08 and PCD-APR-001. Partial return residual follows DEC-068.
- **What not to change:** No worker financial treatment or returned quantity double-count.
- **Common failures:** Return instantly sellable.
- **Completion report:** Stock/account fixture evidence.

### WP-06-04 — Replacement Return Workflow

- **Goal:** Implement linked return credit plus normal replacement sale/issue.
- **Inputs:** Approved return and sales/payment flows.
- **Required reading:** Contracts 03, 06 §9, 07 §10.1, 09 §11, 10 §8.7, 11, 12, 14.
- **Expected outputs:** Required links, replacement order behavior, difference display, separate refund action.
- **Implementation notes:** Original approved net unit value; prior value cap; two events.
- **Tests:** Equal/higher/lower, link/cap, ordinary reservation/approval, no automatic refund, role redaction.
- **Acceptance:** Subledger difference arises naturally and traceability is complete.
- **Dependencies:** WP-06-03, WP-05-03, WP-05-04 and WP-01-08.
- **What not to change:** No manual stock difference or zero-value invented sale.
- **Common failures:** Replacement bypasses reservation.
- **Completion report:** Three valuation cases.

## 9. Phase 7 — Historical Migration

### WP-07-01 — Normalized Templates, Files and Staging

- **Goal:** Build versioned templates/private files and non-operational staging.
- **Inputs:** Stable core entities and historical contract.
- **Required reading:** Contracts 01, 03–09, 10 §9, 11–14.
- **Expected outputs:** Template/file/batch/staging services and management screens.
- **Implementation notes:** Checksums/provenance; optional adapter isolated; no operational effect.
- **Tests:** Tenant/file privacy, metadata, duplicate source, staging isolation, AI direct-commit denial.
- **Acceptance:** Source-to-cell trace exists and operations unchanged.
- **Dependencies:** WP-00-03E, WP-02-05, WP-02-06, WP-03-04, WP-04-04, WP-05-05, WP-06-04 and WP-01-08. Historical approval/cutover/reconciliation follow DEC-069/071/072.
- **What not to change:** Current workbook not permanent schema.
- **Common failures:** Copy staging rows into domain tables.
- **Completion report:** Provenance/isolation evidence.

### WP-07-02 — Validation, Master Extraction and Alias Review

- **Goal:** Implement deterministic severity/date/unit/currency/duplicate/relation validation and approved mappings.
- **Inputs:** Staged snapshot/templates.
- **Required reading:** Contract 08 §8.2–8.6, 03, 11, 12, 14.
- **Expected outputs:** Versioned validation jobs/findings, candidate masters/aliases, review queue.
- **Implementation notes:** AI suggests only; blockers cannot be downgraded ad hoc.
- **Tests:** Every required validation class, low confidence, ambiguous alias, future/logical date.
- **Acceptance:** Blockers/warnings trace to source and prevent unauthorized progression.
- **Dependencies:** WP-07-01 and WP-01-08.
- **What not to change:** No guessed identities/facts.
- **Common failures:** Fuzzy match auto-merge.
- **Completion report:** Rule coverage/counts.

### WP-07-03 — Reconciliation and Human Review

- **Goal:** Produce complete domain totals/differences and bind warning decisions.
- **Inputs:** Validated staging and owner/accountant comparison totals.
- **Required reading:** Contracts 04 §17, 05 §§13/22, 07 §§9/19–20, 08 §§8.7–8.9, 10, 11–14.
- **Expected outputs:** Versioned reconciliation reports, drill-through, review decisions, submit state.
- **Implementation notes:** Green summaries cannot hide unmatched/accepted warnings.
- **Tests:** All listed metrics, seeded mismatch/negative/duplicate/unmatched, version invalidation.
- **Acceptance:** Exact differences visible and no blocker remains before approval.
- **Dependencies:** WP-07-02 and WP-01-08.
- **What not to change:** No client-calculated pass flag.
- **Common failures:** Approvals survive changed staging.
- **Completion report:** Report/review evidence.

### WP-07-04 — Dual Approval, Atomic Commit and Locking

- **Goal:** Commit one approved historical batch through domain services exactly once.
- **Inputs:** Current validation/reconciliation hash, two approvals, backup evidence.
- **Required reading:** Contracts 06 §15, 08 §§8.9–8.11, 09 §20, 11, 12, 14.
- **Expected outputs:** Separate approval commands, commit service, historical metadata/locks/audit/effect summary.
- **Implementation notes:** All-or-nothing supported batch; technical rollback retry; stop if resumable design required.
- **Tests:** One approval denial, stale approval, blocker, concurrency/idempotency, every injected failure, invalid status, locks.
- **Acceptance:** One complete locked history set or none.
- **Dependencies:** WP-07-03, WP-02-06 and PCD-APR-001. Distinct historical approval identity follows DEC-069.
- **What not to change:** No partial commit or `approved_after_import_review`.
- **Common failures:** Transformed rows accepted in commit request.
- **Completion report:** Atomicity/effect/provenance evidence.

### WP-07-05 — Historical Correction Workflow

- **Goal:** Correct committed history through linked domain reversal/correction/adjustment.
- **Inputs:** Locked historical record and dependency analysis.
- **Required reading:** Contracts 04–08, 09 §19, 11–14.
- **Expected outputs:** Correction request/approval/domain effect/reconciliation/audit.
- **Implementation notes:** Original remains locked and visible.
- **Tests:** Direct edit denied, permission/reason/dependency, linked inverse/new record, report update.
- **Acceptance:** Correction is traceable and non-destructive.
- **Dependencies:** WP-07-04 and PCD-APR-001. Renewed dual approval follows DEC-070. Any correction UI additionally depends on WP-01-08.
- **What not to change:** No DB/manual patch.
- **Common failures:** Reopen committed batch.
- **Completion report:** Original/correction chain.

## 10. Phase 8 — Frontend Expansion, Traceability and Reports

### WP-08-01A — Warehouse and Inventory Screen Expansion

- **Goal:** Apply approved patterns to remaining Warehouse tasks and management inventory screens.
- **Inputs/Dependencies:** WP-01-08, WP-02-05, WP-03-04.
- **Required reading:** Contracts 02, 04, 09, 10 §§7.1/8.2, 11–14.
- **Expected outputs:** Transfer/return/quantity tasks and inventory balance/movement/reservation/alert screens.
- **Implementation notes:** Server-filtered DTOs; no direct balances.
- **Tests/Acceptance:** Role fields, RTL/a11y/responsive/states, fixture reconciliation; Screen Contract met.
- **What not to change/Common failures:** No worker finance or dense management task reuse.
- **Completion report:** Standard report plus exact screens and evidence.

### WP-08-01B — Production and WIP Screen Expansion

- **Goal:** Complete Production worker tasks and management WIP/receipt/payable views.
- **Inputs/Dependencies:** WP-01-08, WP-04-04.
- **Required reading:** Contracts 02, 05, 09 §§13–16, 10 §§7.2/8.3, 11–14.
- **Expected outputs:** Production drafts/status, receipt allocation review, WIP return and management details.
- **Tests/Acceptance:** Worker redaction, allocation/WIP fixtures, RTL/a11y/responsive/states.
- **What not to change/Common failures:** No worker rate/payable or client WIP calculation authority.
- **Completion report:** Standard screen evidence.

### WP-08-01C — Sales and Approval-Center Expansion

- **Goal:** Complete sales management and wire the approved review-queue pattern to real commands.
- **Inputs/Dependencies:** WP-01-08 and WP-05-03. Quality-risk flows follow DEC-065.
- **Required reading:** Contracts 02, 04, 06, 07, 09 §§8–10/20.4, 10 §§8.1/8.4, 11–14.
- **Expected outputs:** Sales draft/detail/approval/failure-resolution and queue categories.
- **Tests/Acceptance:** Exact totals, role actions, stale hash/failure messages, RTL/a11y/responsive.
- **What not to change/Common failures:** No client totals/status CRUD/universal release.
- **Completion report:** Standard command/screen evidence.

### WP-08-01D — Payments, Accounts and Direct-Cost Screens

- **Goal:** Complete statements/payment/settlement/direct-cost review screens.
- **Inputs/Dependencies:** WP-01-08 and WP-05-05. Payment methods follow DEC-066.
- **Required reading:** Contracts 02, 06 §17.3–17.4, 07, 09 §§18/20.5–20.6, 10 §§8.5–8.6, 11–14.
- **Expected outputs:** Account statements, payment/settlement/reversal, direct-cost queue/detail.
- **Tests/Acceptance:** Signs/balances/allocation, redaction, RTL/a11y/responsive/states.
- **What not to change/Common failures:** No editable balance or worker financial controls.
- **Completion report:** Standard financial screen evidence.

### WP-08-01E — Quality, Complaint, Return and Replacement Screens

- **Goal:** Complete role-safe quality/complaint/return/replacement UX.
- **Inputs/Dependencies:** WP-01-08 and WP-06-04. Return residuals follow DEC-068.
- **Required reading:** Contracts 02, 04, 06, 07, 09 §11, 10 §§7.3/8.7, 11–14.
- **Expected outputs:** Worker quality/investigation tasks and management return/replacement details.
- **Tests/Acceptance:** Block/risk/caps/equal-higher-lower fixtures, redaction, RTL/a11y/responsive.
- **What not to change/Common failures:** No worker treatment or automatic refund.
- **Completion report:** Standard role/screen evidence.

### WP-08-01F — Historical Migration Screens

- **Goal:** Complete migration batch/file/staging/validation/reconciliation/approval/lock/correction UI.
- **Inputs/Dependencies:** WP-01-08 and WP-07-05. Historical approval/correction/cutover/reconciliation follow DEC-069/070/071/072.
- **Required reading:** Contracts 02, 08–14.
- **Expected outputs:** Historical Migration Screen Contract §9 implementation.
- **Tests/Acceptance:** Provenance/warnings/dual approval/lock/redaction, desktop/tablet/phone summary, a11y/RTL.
- **What not to change/Common failures:** No direct/partial import or hidden warning.
- **Completion report:** Standard migration screen evidence.

### WP-08-01G — Dashboard and Review-Queue Data Wiring

- **Goal:** Replace reference fixtures with permission-safe real Owner/Accountant data while preserving approved visuals.
- **Inputs/Dependencies:** WP-01-08, WP-05-05, WP-06-04, WP-07-05, WP-02-06.
- **Required reading:** Contracts 02, 07–12, 14.
- **Expected outputs:** Server dashboard/review DTOs and wired reference screens.
- **Tests/Acceptance:** Fixture/ledger equality, partial failure, role differences, no visual drift, a11y/RTL/responsive.
- **What not to change/Common failures:** No browser aggregation or unauthorized widget.
- **Completion report:** Standard data/visual evidence.

### WP-08-01H — Settings and User-Management Screens

- **Goal:** Implement Owner-only user/permission and allowed settings/terminology screens.
- **Inputs/Dependencies:** WP-01-08, WP-01-02, PCD-AUTH-002, and resolved decisions DEC-061, DEC-062 and DEC-063.
- **Required reading:** Contracts 01–03, 10 §11.2, 11–14.
- **Expected outputs:** Approved provisioning/assignment/settings/terminology UX.
- **Tests/Acceptance:** Owner-only mutation, Accountant request/read limits, worker denial, audit, RTL/a11y/responsive.
- **What not to change/Common failures:** No generic Admin, wildcard grants, secret/deferred setting.
- **Completion report:** Standard security screen evidence.

### WP-08-02 — Full Traceability

- **Goal:** Deliver permission-safe end-to-end lineage/timeline.
- **Inputs:** Completed core domain links.
- **Required reading:** Contracts 03–08, 10 §10.1, 11, 12, 14.
- **Expected outputs:** TraceabilityService/query and full screen.
- **Implementation notes:** Bounded queries and explicit broken-link indicators.
- **Tests:** Raw→single→twisted→sale→complaint/return/correction; role redaction/performance.
- **Acceptance:** Fixture chain complete and no financial worker leak.
- **Dependencies:** WP-06-04, WP-07-05, WP-08-01A, WP-08-01B, WP-08-01C, WP-08-01E.
- **What not to change:** No mutation from timeline.
- **Common failures:** Global unfiltered search/N+1.
- **Completion report:** Chain/query evidence.

### WP-08-03 — Reports, Exports and Profitability Views

- **Goal:** Implement exact internal reports and approximate/versioned profitability presentation.
- **Inputs:** Ledgers, snapshots and traceability.
- **Required reading:** Contracts 07, 10 §10.2, 11, 12, 14.
- **Expected outputs:** ReportService, filters, screens, authorized internal exports.
- **Implementation notes:** Server aggregation, missing flags/profile; exports inherit permissions.
- **Tests:** Fixture totals/filters, role fields/export, rounding, missing costs, accessibility.
- **Acceptance:** Reports match ledgers and are labeled internal/approximate where required.
- **Dependencies:** WP-08-02, WP-05-05, WP-06-04, WP-07-05.
- **What not to change:** Exports are not backups/legal documents.
- **Common failures:** Hidden export columns leak.
- **Completion report:** Report-to-fixture evidence.

## 11. Phase 9 — Hardening, Operations, Pilot

### WP-09-01 — Backup/Restore Status and Operations UI

- **Goal:** Expose safe evidence/status and manual job controls without production restore.
- **Inputs:** Backup/restore procedures and permissions.
- **Required reading:** Contracts 01, 09 §21, 10 §11.1, 11, 12, 14.
- **Expected outputs:** Status/evidence screen and allowed job triggers.
- **Implementation notes:** Long work uses job/admin boundary; secrets omitted.
- **Tests:** Role/field, failed/missing evidence, separate target, idempotency, responsive/accessibility.
- **Acceptance:** Status is honest and no production restore action exists.
- **Dependencies:** WP-02-06, WP-01-08.
- **What not to change:** Production tier/retention/RPO/RTO/monitor remain unresolved.
- **Common failures:** Export called backup.
- **Completion report:** Operations evidence.

### WP-09-02 — Full Regression, Security and UX Hardening

- **Goal:** Execute the complete test plan and resolve critical defects.
- **Inputs:** All completed packages.
- **Required reading:** All contracts, especially 10–14 and execution plan.
- **Expected outputs:** Test/evidence ledger, defect fixes in bounded packages, known-limitations report.
- **Implementation notes:** Defect fixes trigger mapped regressions; no expectation weakening.
- **Tests:** Full matrix, concurrency/failure injection, all roles, RTL/accessibility/responsive, migration/restore.
- **Acceptance:** Required tests pass; remaining failures prevent readiness and are explicit.
- **Dependencies:** WP-09-01, WP-08-03.
- **What not to change:** No rushed scope cut that weakens safeguards.
- **Common failures:** Browser smoke substitutes for service tests.
- **Completion report:** Complete commands/results/defects.

### WP-09-03 — UAT, Limited Pilot and Go-Live Gate

- **Goal:** Validate controlled pilot/parallel Excel operation and decide readiness—not automatically go live.
- **Inputs:** Passed regression, backup/restore, training and bounded pilot data.
- **Required reading:** Context/Decision Log, contracts 01, 08, 10–14, rollout sections.
- **Expected outputs:** UAT/pilot script, reconciliation, training evidence, rollback/write-disable drill, readiness checklist.
- **Implementation notes:** Free tier remains demo/limited pilot; production decisions unresolved.
- **Tests:** End-to-end role workflows, parallel totals, restore/rollback, known limitations.
- **Acceptance:** Owner approves limited pilot outcome; production only after tier/recovery/monitoring/go-live decisions.
- **Dependencies:** WP-09-02, PCD-AUTH-002, PCD-SEC-003, PCD-PILOT-001, PCD-PILOT-002 and PCD-FILE-001. Production go-live additionally requires PCD-OPS-001.
- **What not to change:** No immediate Excel replacement or production-ready claim.
- **Common failures:** Pilot treated as production.
- **Completion report:** Readiness decision and unresolved blockers.

## 12. Sequence Summary

```text
WP-00-01 → WP-00-02 → WP-00-03A → WP-00-03B, WP-00-03C, WP-00-03D and WP-00-03E as their decisions/dependencies permit
→ WP-00-04 → WP-00-05 → WP-00-06
→ WP-01-01 → WP-01-02 → WP-01-03 and WP-01-04 → WP-01-05, WP-01-06 and WP-01-07 → WP-01-08
→ Phase 2 raw/master/backup
→ Phase 3 ledger/reservations/failure resolution
→ Phase 4 production/WIP/payable
→ Phase 5 sales/approvals/subledger/direct cost
→ Phase 6 quality/complaints/returns/replacement
→ Phase 7 migration staging/validation/reconciliation/commit/correction
→ Phase 8 gated frontend expansion/traceability/reports
→ Phase 9 operations/regression/UAT/pilot gate
```

The first coding work package is **WP-00-01 Project and Bootstrap Verification**. It must not be replaced by “build ERP,” inventory posting, sales approval, historical commit, or broad frontend work.
