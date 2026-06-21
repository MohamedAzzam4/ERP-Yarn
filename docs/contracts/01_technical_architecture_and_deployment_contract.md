# Technical Architecture and Online Deployment Contract

## Contract Status

This is a binding implementation contract for the Specialized Yarn Trading & Outsourced Manufacturing ERP. It freezes the online MVP technology baseline and the boundaries between browser, application server, database, authentication, storage, deployment, migration, backup, and GLM execution.

This document authorizes documentation and later implementation against the specified stack. It does not authorize production go-live, create cloud resources, deploy the application, or replace the business contracts.

Research date: **2026-06-20**.

## Authority and Required Reading

This contract must be read with:

1. `docs/00_project_context.md`;
2. `docs/01_final_implementation_plan_v4.md`;
3. `docs/02_decision_log_and_scope.md`;
4. the database, permission, API, testing, and work-package contracts when they exist.

Business rules in higher-authority documents remain binding. This contract selects implementation technology; it must not alter inventory, WIP, approval, subledger, migration, audit, or permission behavior.

## Context7 Compatibility Research Result

Context7 resolved current official documentation for Next.js, Supabase, and Drizzle ORM.

Key verified compatibility facts:

- Next.js 16.2.9 requires Node.js 20.9.0 or later and TypeScript 5.1 or later.
- Next.js 16 supports React 19 and uses the Node.js runtime by default; the Edge runtime is not required for this ERP.
- Supabase's supported Next.js SSR integration uses `@supabase/ssr` and server-side cookie handling.
- Supabase secret/service credentials bypass Row Level Security and must remain server-only.
- Drizzle supports Supabase PostgreSQL through `postgres.js`.
- Supabase transaction-pool mode requires prepared statements to be disabled with `prepare: false` for the `postgres.js` client.
- Drizzle supports generated SQL migrations and explicit PostgreSQL transactions while retaining access to SQL features needed for row locking.

Official documentation references used for the decision:

- [Next.js 16 requirements](https://github.com/vercel/next.js/blob/v16.2.9/docs/01-app/02-guides/upgrading/version-16.mdx)
- [Supabase Next.js guidance](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/getting-started/tutorials/with-nextjs.mdx)
- [Supabase Next.js SSR authentication guidance](https://github.com/supabase/supabase/blob/master/examples/prompts/nextjs-supabase-auth.md)
- [Drizzle connection guidance for Supabase](https://github.com/drizzle-team/drizzle-orm-docs/blob/main/src/content/docs/connect-supabase.mdx)

## Binding Stack

| Layer | Binding MVP choice | Version/baseline policy |
| --- | --- | --- |
| Application framework | Next.js App Router modular monolith | Next.js `16.2.9` baseline |
| UI library | React and React DOM | React `19.x`, exact compatible versions locked with Next.js |
| Language | TypeScript | TypeScript `5.x`; must satisfy Next.js minimum `>= 5.1` |
| Server runtime | Node.js | Node.js `24.x LTS`; never below Next.js minimum `20.9.0` |
| Package manager | npm | Commit `package-lock.json`; reproducible installs use `npm ci` |
| Online application hosting | Vercel | Free/low-cost tier permitted for owner demo and controlled pilot subject to current terms and limits |
| Managed platform | Supabase | PostgreSQL, Auth, and Storage |
| Database | Supabase-hosted PostgreSQL | PostgreSQL relational features, constraints, transactions, locks, and migrations are mandatory |
| ORM/query layer | Drizzle ORM | Exact stable version pinned in the lockfile during Phase 0 |
| Migration tooling | Drizzle Kit plus reviewed SQL migrations | Exact stable version pinned with Drizzle ORM |
| PostgreSQL driver | `postgres.js` | Supabase transaction-pool connection with `prepare: false` |
| Supabase browser/server SDK | `@supabase/supabase-js` | Exact stable version pinned during Phase 0 |
| Supabase SSR adapter | `@supabase/ssr` | Exact stable version pinned during Phase 0 |
| File/object storage | Supabase Storage | Private buckets by default |
| UI component source | shadcn/ui with Radix primitives | shadcn `3.5.0` baseline; copied components are repository-owned |
| Styling/theme | Tailwind CSS | Stable `4.x`, CSS-first semantic theme tokens |
| Forms/validation | React Hook Form, Zod, `@hookform/resolvers` | RHF `7.66.x`, Zod stable `4.x`, compatible resolver pinned at Phase 0 |
| Data tables | TanStack Table | Latest stable release only; beta/RC prohibited |
| Charts | Recharts | Stable `3.3.x` through shared wrappers |
| Icons | Lucide | Exact stable version pinned during Phase 0 |

The exact versions not fixed numerically above must be resolved from current official documentation at Phase 0, recorded in the initial lockfile, and reported in the Phase 0 evidence. GLM must not use floating dependency ranges as the reproducibility mechanism.

## Version Change Policy

1. The initial implementation starts from the versions in this contract.
2. The lockfile, not an agent's memory, is the exact installed-version record.
3. A dependency may not be upgraded merely because a newer release exists.
4. Patch/minor upgrades require release-note review, build, automated tests, smoke tests, and applicable regression tests.
5. Major upgrades require a contract review and a dedicated work package.
6. Next.js, React, and React DOM must be upgraded as a compatible set.
7. Drizzle ORM and Drizzle Kit must be checked as a compatible set.
8. Supabase SSR and JavaScript client changes must be checked against the active Next.js SSR guidance.
9. UI dependency changes must be checked against `docs/contracts/02_design_system_and_ux_contract.md` and the reference-screen regression set.
10. Production must never receive an unreviewed dependency upgrade through an automatic deployment.

## Architecture Style

The application is one modular monolith:

```text
Browser / Arabic-first UI
  → Next.js App Router
  → Route Handlers / server-side application services
  → permission and tenant guards
  → domain services
  → Drizzle repositories and PostgreSQL transactions
  → Supabase PostgreSQL

Supabase Auth → identity/session
Supabase Storage → private files
Vercel → application runtime and deployment
```

Module boundaries remain those defined by Final Implementation Plan v4. Modules may call one another through application/domain service contracts; they must not bypass posting services with direct cross-module table mutation.

Microservices, a separate SPA/API split, Supabase Edge Functions as the primary backend, and client-side direct operational posting are outside the MVP architecture.

## Next.js Application Contract

### App Router

Use the Next.js App Router. Server Components are the default for data display and page composition. Client Components are used only where browser interactivity, form state, or client APIs require them.

### Route Handlers and Server Runtime

High-risk operations use Route Handlers or server-side application services running in the **Node.js runtime**.

This includes:

- inventory posting and reversal;
- reservation creation/release/consumption;
- production issue, receipt, waste, and WIP correction;
- sales and return approval;
- account entries, payments, settlements, and reversals;
- historical import validation and commit;
- backup/restore orchestration and evidence recording.

Do not place these operations in the Edge runtime. They require dependable PostgreSQL driver behavior, multi-statement transactions, explicit row locks, and server-only credentials.

### Server Actions

Server Actions may submit ordinary UI commands, but they must call the same application services and permission guards as Route Handlers. They must not contain an alternative implementation of business posting logic.

### Request Duration

Normal user transactions must remain short and atomic. Long-running migration transformation, large validation, exports, or backup operations must not rely on an unbounded Vercel request. The relevant future contract/work package must define batching, resumability, or an authorized administrative process.

## Supabase Responsibility Boundaries

### Supabase Auth

Supabase Auth provides identity and session management. Application roles, permissions, tenant membership, approval authority, and field visibility remain ERP database/application concerns.

Required rules:

- use `@supabase/ssr` for Next.js server/browser session integration;
- use secure cookie handling consistent with current Supabase guidance;
- validate the authenticated user on the server for protected operations;
- derive tenant and user context from the authenticated server session and ERP user mapping;
- never trust `tenant_id`, role, permission, or approval authority from request-body fields;
- do not use client-visible user metadata as the sole permission source;
- do not provide open public signup for the MVP;
- only Owner-controlled user provisioning and permission workflows may activate ERP users.

The initial sign-in mechanism is not yet owner-approved:

> Unresolved / requires owner decision

The Auth work package must resolve email/password versus another supported private sign-in method before implementing login and recovery UX.

### Supabase Project Region

The current-client project uses Supabase's **Europe general region**, selected as the nearest documented general area to the primary users in Egypt. If project creation offers specific regions instead of the general Europe choice, prefer **Central EU (Frankfurt)** as the baseline specific region and verify measured latency from the client's Egyptian connection before creating the long-lived pilot project.

Supabase guidance is to choose the primary region closest to users. A project is bound to its selected primary region; changing it later requires creating a new project and migrating data. Therefore the selected dashboard option, resulting provider region, creation date, and latency check must be recorded in deployment evidence. This resolves the MVP Supabase region/data-residency choice; it does not by itself approve a production hosting tier or legal-compliance claim.

### Supabase PostgreSQL

Supabase PostgreSQL is the authoritative operational database. It must provide:

- relational constraints and foreign keys;
- tenant scoping;
- immutable posting records;
- explicit database transactions;
- `SELECT ... FOR UPDATE` or equivalent row locking;
- idempotency uniqueness;
- migration history;
- reconciliation queries;
- logical backup and restore capability.

Supabase auto-generated REST access is not the posting path for high-risk ERP operations.

### Row Level Security

RLS is required as defense in depth for tables exposed through Supabase browser APIs. It does not replace backend permission guards, tenant filters, domain validation, transaction boundaries, or field filtering.

Until the permission and schema contracts define safe browser access, operational tables are server-access only. Enabling a public/browser policy requires explicit contract coverage and a permission test.

### Supabase Storage

Storage buckets are private by default. Expected file classes include:

- historical source files;
- normalized import files;
- validation/reconciliation artifacts;
- attachments;
- generated internal reports if retained.

Database metadata must identify tenant, owner/uploader, file category, source entity, hash where required, timestamps, and retention state. File access uses authenticated server checks or short-lived signed URLs. Public buckets are prohibited for business documents unless a later contract explicitly approves a public asset class.

Supabase Storage is operational object storage, not an independent backup.

### Secrets

The browser may receive only Supabase's current public/publishable key and project URL. The Supabase secret/service-role credential, database URLs, migration credentials, and any backup credentials are server-only.

Secret/service credentials bypass RLS. They must never be:

- prefixed with `NEXT_PUBLIC_`;
- embedded in JavaScript sent to the browser;
- committed to source control;
- written to logs or test snapshots;
- included in screenshots or agent output.

## Database Access Contract

### Drizzle and `postgres.js`

Server-side application services use Drizzle ORM with `postgres.js`.

Runtime database access uses the Supabase transaction-pool connection string and configures:

```text
prepare = false
```

This is required for compatibility with Supabase transaction-pool mode.

### Transaction Rule

Every high-risk command must execute through one server-side database transaction covering all required state checks, locks, stock/account changes, approval state, idempotency, and audit.

Drizzle is the typed query layer. Explicit SQL is allowed where PostgreSQL behavior is required, including row locks, reconciliation, constraints, and carefully reviewed bulk/migration operations. SQL must remain inside the repository/transaction boundary and must preserve tenant filtering.

### Connection Rule

- Web/runtime traffic uses a pooled runtime connection.
- Migrations and administrative backup/restore use a separate server-only connection suitable for DDL/administration.
- Browser code never receives a database connection string.
- A Vercel function must not create uncontrolled connection fan-out.
- Runtime database initialization must be shared per function instance where the chosen driver permits.
- Connection failures return deterministic operational errors; they must not trigger partial posting retries outside idempotency rules.

## Migration Contract

Drizzle TypeScript schema definitions and reviewed SQL migration files work together. The database schema contract—not ORM inference alone—is the authority for names, types, constraints, indexes, statuses, and relationships.

Required workflow:

```text
approved schema contract change
→ update Drizzle schema
→ generate SQL migration
→ human/agent review against contract
→ apply to disposable/test database
→ run migration and regression tests
→ backup target environment when required
→ controlled migration execution
→ deploy compatible application
→ smoke and reconciliation checks
```

Rules:

- migrations are committed to the repository;
- migration history is immutable after application to a shared environment;
- do not use automatic schema push as the production migration process;
- do not run migrations from ordinary application requests or startup traffic;
- Vercel preview deployments must not migrate pilot or production databases;
- destructive migrations require an explicit data-preservation and rollback plan;
- approved/posted business data must not be destroyed to simplify a schema change;
- migration credentials remain separate from browser/runtime public configuration.

## Environment Model

### 1. GLM Sandbox / Local Development

Purpose:

- code generation and review;
- unit/integration tests;
- disposable local or test database work;
- migration generation;
- no official business data.

The GLM sandbox is not the online host. It produces repository changes that are later deployed through an authorized workflow.

### 2. Online Demo

Binding target:

- Vercel deployment;
- Supabase project for PostgreSQL/Auth/Storage;
- fake, synthetic, or explicitly approved copied/sanitized data;
- free tier permitted subject to current provider terms and technical limits;
- not an official source of truth.

This environment lets the owner use the MVP online from a browser. Local-only operation is not required.

### 3. Limited Pilot

Limited real data may be used only after:

- permission and field-visibility tests pass;
- manual database backup succeeds;
- restore into a separate test environment is demonstrated and recorded;
- file/import backup or documented equivalent exists;
- known provider/free-tier limitations are disclosed;
- rollback and write-disable procedures are ready;
- selected users, suppliers, factories, locations, and flows are bounded;
- Excel parallel run and reconciliation are active.

The pilot should use an environment isolated from development and disposable previews. If free-plan project limits prevent safe isolation or recovery, upgrade before entering real pilot data.

### 4. Production

Production go-live is not authorized by this contract. It additionally requires:

- provider plan and terms suitable for commercial production;
- approved hosting/database budget and tier;
- firm backup retention, RPO, and RTO;
- reliable automated/managed backups plus restore evidence;
- monitoring and alerting;
- storage retention;
- full regression and security checks;
- migration sign-off and balance reconciliation;
- user training and owner-approved go-live/rollback.

The exact production tier/budget, retention, RPO, and RTO remain:

> Unresolved / requires owner decision

## Vercel Deployment Contract

Vercel hosts the Next.js application for the online demo and intended limited pilot.

Required rules:

- deployments originate from the controlled repository;
- production-branch deployment and preview deployment are distinct;
- preview deployments never receive production database credentials;
- environment variables are configured separately by environment;
- server-only variables are not exposed through `NEXT_PUBLIC_`;
- high-risk route handlers explicitly use the Node.js runtime;
- health checks must not expose secrets or sensitive business data;
- deployment logs must not include payloads containing prices, balances, personal data, tokens, or secret values;
- a deployment rollback must not roll back or delete business data;
- app rollback and database correction are separate controlled operations.

Current Vercel free-tier eligibility, commercial-use terms, function limits, and quotas must be checked at deployment time. This contract does not assume that a free personal plan is legally or operationally suitable for a client-facing commercial pilot. If it is not, use an appropriate Vercel paid tier or another compatible Node.js host without changing the application architecture.

## Environment Variables

The final names may be refined during Phase 0, but the categories are binding:

```text
public:
  NEXT_PUBLIC_SUPABASE_URL
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

server-only runtime:
  DATABASE_URL
  SUPABASE_SECRET_KEY

server-only migration/administration:
  DATABASE_MIGRATION_URL
  backup/storage administration credentials if required
```

Provide an `.env.example` containing names and descriptions only. Never commit live values. Environment validation must fail fast with a safe message when required server configuration is absent.

## Backup and Restore Contract

### Demo

Demo data may be recreated, but configuration and migration scripts must remain reproducible. No export may be described as a backup.

### Before Real Pilot Data

Required evidence:

1. Create a logical PostgreSQL backup using a supported administrative connection/tool.
2. Capture migration version and backup timestamp.
3. Back up or independently retain required Storage source/import files and metadata.
4. Restore the database to a separate test project/database.
5. Verify row counts and selected critical documents.
6. Reconcile sample stock and account balances.
7. Verify required files or document the exact file-recovery limitation.
8. Record operator, result, duration, errors, and evidence.

Provider-managed backups may supplement this process when the selected plan supports them. Free-tier managed-backup assumptions must not replace a demonstrated logical backup and restore test.

### Production

Daily backup and a 30-day retention target remain recommendations until the owner approves final production recovery objectives. Production must not begin with undefined recovery commitments.

## CI/CD and Quality Gates

The initial pipeline must at minimum support:

- reproducible dependency installation from the lockfile;
- type checking;
- lint/static checks selected in Phase 0;
- automated tests required by completed contracts;
- production build verification;
- migration validation against a disposable/test database where relevant;
- phase-specific smoke checks after deployment.

No work package may treat “Vercel deployment succeeded” as proof that business behavior is correct.

Deployment order for a compatible change must be documented per work package. Schema and application changes should be backward-compatible where practical so application rollback does not require destructive data rollback.

## Observability Baseline

Demo/pilot must provide:

- application and deployment logs;
- deterministic error identifiers for failed high-risk commands;
- health status for application-to-database connectivity without exposing data;
- backup/restore evidence;
- audit logs in the ERP database;
- alerts/reports for inventory reconciliation, negative stock, migration warnings, and failed approvals as defined by later contracts.

Logs are operational diagnostics, not the audit ledger. Sensitive fields and credentials must be redacted.

Production monitoring provider and alert-delivery channels are deferred to the production-readiness decision.

## GLM 5.2 Sandbox Execution Rules

GLM must:

- read this contract before Phase 0 or any stack/deployment work;
- use Context7 before adding or upgrading framework/provider packages;
- implement one approved work package at a time;
- preserve the modular monolith and service boundaries;
- place high-risk writes server-side in the Node.js runtime;
- use Drizzle/PostgreSQL transactions and required locks rather than browser-side Supabase mutations;
- keep all credentials out of code, logs, patches, and messages;
- generate and review migrations but never target real pilot/production data without authorization;
- record exact installed versions and compatibility evidence;
- run the required tests and document failures rather than marking incomplete work complete;
- avoid creating cloud projects, deploying, or changing paid plans unless the user explicitly authorizes those external actions.

## Explicit Non-Goals

This contract does not introduce:

- microservices;
- Kubernetes or container orchestration;
- offline/local-first operation;
- Supabase Edge Functions as the primary backend;
- direct browser posting to operational tables;
- a generic SaaS tenant-control plane;
- automated production deployment without gates;
- automatic production migrations from request traffic;
- guaranteed free-tier production;
- full disaster-recovery automation in MVP;
- provider-specific business logic that prevents later migration to another PostgreSQL/Node host.

## Acceptance Criteria for This Contract

The technical architecture is implementation-ready when later work preserves all of the following:

- the owner can use an online demo hosted on Vercel with Supabase services;
- high-risk ERP writes execute server-side in atomic PostgreSQL transactions;
- browser access cannot bypass tenant, role, field, approval, and posting rules;
- dependency versions are reproducible and compatibility-reviewed;
- migrations are generated, reviewed, tested, and applied through a controlled path;
- preview/demo/pilot/production credentials and data are separated appropriately;
- manual backup and restore are demonstrated before real pilot data;
- free-tier usage is labelled demo/pilot rather than production;
- production remains gated on provider suitability, approved recovery objectives, regression, reconciliation, and owner sign-off.

## Remaining Decisions

The following do not block the database or inventory contract, but they must be resolved before their affected work package:

1. Initial private sign-in method and password/recovery policy.
2. Production Vercel/Supabase tier and budget.
3. Production backup retention, RPO, and RTO.
4. Production monitoring and alert-delivery provider.

For each unresolved item:

> Unresolved / requires owner decision
