# Contract Documentation Index

## Purpose

The contract pack converts Final Implementation Plan v4 and the owner resolutions consolidated in `docs/02_decision_log_and_scope.md` into implementation-grade, reviewable rules. These contracts are the boundary between business decisions and coding work. They must be approved before the corresponding work package begins.

The foundation contract pack is now complete through frontend screens, testing/regression, work packages, and coding-agent instructions. The accepted Run 2.1 owner decisions for EGP, decimal precision, posting rounding, multi-line discounts, replacement returns, approval-failure classification, and reason-based reservation handling are integrated into the decision log and completed backend contracts; they are binding inputs to implementation.

## Mandatory Reading Rule

Canonical authority is: explicit owner decisions in the Decision Log → approved domain contracts → Final Implementation Plan v4 where not superseded → remaining authorized source context. Execution documents narrow scope/order only. The v4 supersession register is in the Decision Log.

Every coding agent must read:

1. `docs/00_project_context.md`;
2. `docs/01_final_implementation_plan_v4.md`;
3. `docs/02_decision_log_and_scope.md`;
4. `docs/contracts/01_technical_architecture_and_deployment_contract.md`;
5. the contract for the work being implemented;
6. every upstream contract named by that contract;
7. the relevant execution work package.
8. `docs/contracts/12_testing_and_regression_plan.md`, `docs/contracts/13_work_packages.md`, `docs/contracts/14_coding_agent_instructions.md`, and `docs/execution/00_execution_index.md` plus `01_glm_execution_plan.md` before any coding package.

Contracts may clarify implementation detail but may not alter business rules, expand MVP scope, or resolve an owner decision silently. Any undefined material rule must be marked **“Unresolved / requires owner decision.”**

## Contract Files

### `01_technical_architecture_and_deployment_contract.md`

**Purpose:** Freeze the compatible framework/runtime baseline, Vercel and Supabase responsibilities, Drizzle/PostgreSQL access, environment separation, secrets, migrations, online demo/pilot deployment, backup/restore, and GLM sandbox rules.

**Why it exists:** Online MVP implementation needs one provider-specific path without confusing free-tier trial hosting with production readiness or allowing browser code to bypass transactional ERP services.

**Coding agents must read it for:** Repository scaffolding, package selection, Next.js runtime choices, Supabase integration, database connections, environment variables, migrations, cloud deployment, backup/restore, and any dependency upgrade.

### `02_design_system_and_ux_contract.md`

**Purpose:** Freeze Arabic-first RTL behavior, the Modern Industrial visual direction, role-based UX modes, design tokens, typography, responsive behavior, forms, tables, dashboards, motion, accessibility, visual QA, and the three-screen approval gate.

**Why it exists:** Client confidence and worker adoption depend on a coherent, simple, attractive interface. GLM must not generate unrelated screens, leak financial complexity into worker flows, or assume a component library automatically solves RTL and accessibility.

**Coding agents must read it for:** Any UI component, layout, navigation, form, table, dashboard, chart, responsive behavior, typography, theme, RTL/LTR treatment, accessibility work, or frontend visual test.

### `03_database_schema_contract.md`

**Purpose:** Freeze entities, columns, types, required/nullability rules, keys, tenant constraints, indexes, enums/statuses, lifecycle metadata, immutability, soft-delete boundaries, and cross-table references.

**Why it exists:** The v4 schema is detailed but explicitly a draft and contains a few status/field gaps. A coding agent must not convert prose into migrations by guessing.

**Coding agents must read it for:** Database migrations, ORM models, repository queries, seed data, constraints, status transitions, tenant filtering, and any code that persists or reads domain data.

**Status:** Completed.

### `04_inventory_posting_contract.md`

**Purpose:** Define every stock movement, balance delta, reservation interaction, blocked/returned handling, locking order, idempotency behavior, negative-stock exception, reversal, and ledger-to-balance reconciliation rule.

**Why it exists:** Inventory correctness depends on signs, locations, state, and concurrency being identical across all modules.

**Coding agents must read it for:** Receipts, transfers, sales issues, returns, adjustments, reversals, balance services, availability queries, reconciliation, and tests touching stock.

**Status:** Completed.

### `05_production_wip_contract.md`

**Purpose:** Define outsourced single-yarn and twisting workflows, factory-location prerequisites, issue-to-WIP, partial receipts, consumption allocation, waste, remaining WIP, output lots, unprocessed returns, rate snapshots, and factory payable trigger.

**Why it exists:** Production can otherwise double-count factory stock, WIP, output, or cost, especially with partial and many-to-many production.

**Coding agents must read it for:** Production schema usage, services, posting, lot lineage, partial completion, waste, costing, corrections, factory balances, and production tests.

**Status:** Completed.

### `06_approval_transaction_contract.md`

**Purpose:** Define permission, preconditions, locks, validation, writes, audit, idempotency, deterministic errors, retry behavior, reversal, and rollback for each high-risk approval.

**Why it exists:** An approval is a transaction that coordinates multiple ledgers and documents, not a CRUD status update.

**Coding agents must read it for:** Sales approval, return approval, production receipt, inventory adjustment, payment reversal, stock reversal, migration commit, quality-risk approval, and post-approval correction.

**Status:** Completed.

### `07_subledger_and_costs_contract.md`

**Purpose:** Freeze customer/supplier/factory account ownership, sign conventions, entry types, payment direction, partial and advance payment behavior, settlement, reversals, supplier/factory payable timing, direct-cost responsibility, actual payer, and profitability inclusion.

**Why it exists:** Balance signs and the separation of cost, payment, settlement, and responsibility are financially sensitive and easy to implement inconsistently.

**Coding agents must read it for:** Accounts, account entries, payments, settlement, direct costs, transport review, party statements, balance reports, profitability inputs, and financial corrections.

**Status:** Completed.

### `08_historical_migration_contract.md`

**Purpose:** Define normalized templates, optional transformation adapters, staging metadata, source/formula preservation, alias review, validation severity, reconciliation, approval, commit, locking, historical cost preservation, and correction workflow.

**Why it exists:** Historical input is untrusted and must never bypass review or domain posting rules. AI transformation is preparation, not authority.

**Coding agents must read it for:** Import templates, upload/staging, transformation tooling, validation, reconciliation, master-data extraction, commit services, record locking, and historical correction.

**Status:** Completed.

### `09_api_contracts.md`

**Purpose:** Specify request/response shapes, authentication-derived tenant context, permissions, forbidden fields, state preconditions, validation, idempotency, deterministic error codes, transaction effects, and audit events for high-risk operations.

**Why it exists:** Route names alone do not prevent partial writes, permission leakage, retries, or business-rule divergence.

**Coding agents must read it for:** Controllers/routes, application services, request validation, error handling, authorization, idempotency storage, and API integration tests.

**Status:** Completed.

### `10_frontend_screen_contracts.md`

**Purpose:** Define each role’s screens, Arabic/RTL labels, visible and editable fields, workflow states, validations, warnings, review queues, and prohibited financial exposure.

**Why it exists:** Worker UX simplification and field-level financial confidentiality must be enforceable, not a styling preference.

**Coding agents must read it for:** Pages, forms, navigation, dashboards, approval center, migration UI, traceability UI, reports, loading/error states, and role browser tests.

**Status:** Completed.

### `11_permission_matrix.md`

**Purpose:** Freeze module-, action-, row-, field-, report-, export-, API-, setting-, migration-, backup-, and audit permissions for Owner, Accountant, Warehouse Employee, Production Employee, and Quality Employee.

**Why it exists:** UI hiding is insufficient; backend permissions and response filtering require one authoritative matrix.

**Coding agents must read it for:** Permission seeds, guards, field serializers, navigation, exports, reports, settings, test users, and security tests.

**Status:** Completed.

### `12_testing_and_regression_plan.md`

**Purpose:** Define executable fixtures, expected values, unit/integration/browser/smoke tests, concurrency and idempotency cases, restore tests, phase gates, and the change-to-regression matrix.

**Why it exists:** A phase cannot be accepted on a checklist claim. Critical stock and balance rules need reproducible inputs and exact outputs.

**Coding agents must read it for:** Test implementation, fixture setup, CI gates, smoke scripts, role tests, migration tests, restore evidence, defect triage, and regression selection.

**Status:** Completed.

### `13_work_packages.md`

**Purpose:** Split phases into bounded, dependency-ordered units with inputs, allowed files/modules, required contracts, deliverables, tests, smoke checks, rollback, known risks, and acceptance evidence.

**Why it exists:** GLM must implement one controlled package at a time and must not jump to downstream features before prerequisites pass.

**Coding agents must read it for:** Selecting the next task, understanding scope boundaries, knowing completion evidence, and avoiding cross-package scope expansion.

**Status:** Completed.

### `14_coding_agent_instructions.md`

**Purpose:** Provide a compact execution policy for all coding agents: source hierarchy, non-invention rule, contract reading, one-package discipline, permission and tenant safety, test evidence, failure documentation, and escalation rules.

**Why it exists:** Agent behavior must remain consistent across sessions and models even when context is partial.

**Coding agents must read it for:** Every implementation, review, bug fix, migration, refactor, and test task in this repository.

**Status:** Completed.

## Authoring Dependency Order

The authoring order is:

1. Technical architecture and deployment contract — completed.
2. Design system and UX contract — completed.
3. Database schema contract — completed.
4. Inventory posting contract — completed.
5. Production/WIP contract — completed.
6. Subledger and costs contract — completed.
7. Approval transaction contract — completed.
8. Historical migration contract — completed.
9. Permission matrix — completed.
10. API contracts — completed.
11. Frontend screen contracts — completed.
12. Testing and regression plan — completed.
13. Work packages — completed.
14. Coding agent instructions — completed.

This order may be adjusted only to resolve dependencies, not to begin coding before the controlling contracts exist.
