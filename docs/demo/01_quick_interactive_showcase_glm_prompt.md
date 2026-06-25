# GLM Prompt — Quick Interactive ERP Showcase

## 1. Instruction status

This file is a self-contained implementation prompt for a new GLM chat.

Build a **quick interactive showcase**, not the operational ERP MVP. Its purpose is to let the owner and client navigate all major screens, exercise a small synthetic workflow, and evaluate the Arabic-first UI/UX before the real backend work is complete.

The showcase is disposable and non-authoritative. It must never be presented as production-ready, pilot-ready, financially correct, secure authentication, a backup system, or an implementation of the binding posting contracts.

## 2. Repository and isolation

Repository:

`https://github.com/MohamedAzzam4/ERP-Yarn.git`

Perform the following:

1. Clone or pull the repository's `main` branch.
2. Create and work only on branch `demo/interactive-showcase`.
3. Put all showcase application code under `/demo-app`.
4. Do not modify the real application scaffold, migrations, contract rules, or execution work packages.
5. Documentation corrections needed specifically for this showcase may be made only under `/docs/demo`.
6. Do not merge or push directly to `main`.
7. If push credentials are unavailable and the owner does not explicitly authorize DEC-060 temporary chat credentials, create a credentialless Git bundle and provide exact import instructions; do not persist credentials in chat-derived files, repository files, remotes, logs, or evidence.

This one-run showcase exception does not change the one-work-package-at-a-time rule for the real ERP implementation.

## 3. Required reading before implementation

Read and report that you read:

- `/docs/00_project_context.md`
- `/docs/contracts/02_design_system_and_ux_contract.md`
- `/docs/contracts/10_frontend_screen_contracts.md`
- `/docs/contracts/11_permission_matrix.md`
- this file

Use the project context and screen contracts to name and organize the screens. Use the permission matrix to hide financial information from worker roles. Do not simulate detailed business rules that require the inventory, approval, production, costing, or subledger contracts.

If an important presentation decision is absent, label it `Unresolved / requires owner decision`; do not invent a binding ERP rule.

## 4. Showcase technology

Create a standalone client-side application with:

- React, TypeScript, and Vite;
- Tailwind CSS;
- shadcn/ui components and Radix primitives where useful;
- React Router;
- React Hook Form and Zod for showcase forms;
- TanStack Table for dense management tables;
- Recharts for dashboard charts;
- Lucide icons;
- Vitest and React Testing Library;
- bundled Tajawal and Alexandria fonts, preferably through `@fontsource` packages;
- one lockfile with compatible current stable package versions.

Use Context7 before selecting or configuring current library versions. Keep dependencies modest. Do not add Next.js, a server, API routes, Supabase, Firebase SDKs, Docker, database migrations, or real authentication to this showcase.

## 5. Hosting decision

Primary target: **Vercel static deployment**.

- Project root directory: `demo-app`
- Build command: `npm run build`
- Output directory: `dist`
- Environment variables: none
- The SPA must support refreshing a nested route; add the required Vercel rewrite configuration.

The showcase is dynamic in the browser through React state and `localStorage`. It does not provide shared multi-user data across devices.

Firebase Hosting is an optional static-hosting fallback only. Do not add Firestore, Firebase Authentication, Cloud Functions, or Firebase App Hosting. Do not create or deploy a Firebase/Vercel project unless the owner separately authorizes external deployment and the sandbox has an approved authenticated connection.

## 6. Data and safety boundaries

Use synthetic Egyptian yarn-trading data only. Include a persistent banner on every screen:

`نسخة عرض تفاعلية — بيانات تجريبية غير حقيقية`

Requirements:

- Store showcase state in one typed client-side store and `localStorage`.
- Provide `إعادة ضبط بيانات العرض` to restore deterministic seed data.
- Simulate short loading states and clear success/error feedback.
- Never call a real backend or external business API.
- Never use real client, supplier, factory, financial, or historical data.
- Never request application, database, Supabase, Vercel production, or real-data secrets. A GitHub push credential is allowed only under DEC-060 when the owner explicitly authorizes a short-lived scoped token for publication.
- Never imply that localStorage is a database, audit log, or backup.
- Mark simulated backup, migration, approval, accounting, and profitability information visibly as demo-only.
- Do not implement exports that could be mistaken for backups.
- All buttons must either perform a clear local demo action or display `متاح في النسخة التشغيلية لاحقًا`; no silent dead controls.

## 7. Design and UX requirements

Follow `/docs/contracts/02_design_system_and_ux_contract.md` rather than inventing a new visual identity.

Mandatory presentation rules:

- light-only Calm Enterprise visual language;
- navy/deep blue primary, teal or emerald accent, amber warning, red danger, slate neutrals, pale gray background, and white cards;
- Tajawal for body text, forms, tables, and worker UI;
- Alexandria for headings, navigation, dashboard titles, and actions;
- `<html lang="ar" dir="rtl">` at the application root;
- Arabic sentences remain RTL; do not use `dir="auto"` for critical text;
- isolate document codes, batch/lot codes, emails, phone numbers, URLs, dates, quantities, money, numeric cells, and technical identifiers with `<bdi dir="ltr">` or one shared equivalent component;
- Western numerals and `DD/MM/YYYY` display dates;
- desktop-first management console with practical tablet support;
- worker task mode from 360 px upward and minimum 44×44 px touch targets;
- visible focus, keyboard access, useful labels, sufficient contrast, reduced-motion support, and practical 200% zoom behavior;
- simple restrained motion only; no decorative animation overload;
- Lucide icons instead of emoji icons.

Role UX:

- Workers see task-first navigation, large actions, few fields, and no prices, balances, costs, or profitability.
- Accountants see review queues, filters, balances, payments, approvals, direct-cost review, and migration warnings without unnecessary clutter.
- Owners see clear dashboards, approvals, stock, factory balances, approximate profitability, alerts, and traceability.

## 8. Demo roles and navigation

Provide a clearly labeled demo role switcher. It is a presentation aid, not authentication.

Roles:

- Owner
- Accountant
- Warehouse worker
- Production worker
- Quality worker

Changing role must change the shell, landing screen, navigation, actions, and financial visibility. Direct route entry must also respect demo role visibility. Include a `عرض جميع الشاشات` index for the owner so every completed screen can be reviewed quickly.

## 9. Required screens

Every group below must have a navigable, polished screen. Related views may share reusable list, detail drawer, form, status timeline, and chart templates to keep delivery fast.

### 9.1 Access and shared shells

- Demo login / role selection
- Password recovery presentation screen
- Worker Task Mode home
- Management Console shell
- All-screens showcase index

### 9.2 Dashboards

- Owner dashboard
- Accountant dashboard

Owner cards should cover stock, external-factory stock, pending approvals, factory/customer balances, open complaints, approximate profitability, and alerts. Accountant cards should cover review queues, unpriced receipts, unsettled payments, direct-cost review, balances, and migration warnings.

### 9.3 Warehouse worker

- Raw-material receipt
- Stock transfer
- Return receipt
- Recent warehouse activity

### 9.4 Production worker

- Material issue to production
- Single-yarn production receipt
- Twisted-yarn production receipt
- WIP return / residual material
- Recent production activity

### 9.5 Quality worker

- Quality test entry
- Hold/release presentation
- Recent quality activity

### 9.6 Management workflows

- Approval Center / accountant review queue
- Inventory balances
- Inventory movements
- Reservations
- Production orders and WIP overview
- Production order detail
- Sales list
- Sales draft/detail
- Payments
- Customer, supplier, and factory account statements
- Direct-cost review
- Quality review
- Complaints
- Returns and replacement flow

### 9.7 Migration, traceability, reports, and administration

- Historical migration staging overview
- Migration validation/reconciliation
- Migration approval presentation
- End-to-end batch/lot traceability
- Reports hub with filters, charts, and tables
- Backup/restore status presentation
- Settings
- User and role management

Historical imported records must be visibly read-only. AI-transformed migration output must appear only in a staging/review presentation and must never be shown as directly inserted into operational data.

## 10. Minimum interactive behavior

Create one coherent synthetic story that updates multiple screens:

1. Receive a raw-material batch from a supplier.
2. Transfer part of it to an external factory location.
3. Issue material to production.
4. Record a single-yarn or twisted-yarn output lot.
5. Create a draft sale with a reservation.
6. Submit and approve the sale through a local demo transition.
7. Record a customer payment.
8. Open a quality complaint and record a return or replacement.
9. Show the resulting traceability chain, dashboard counters, and activity timeline.

These are UI state transitions only. They must not claim accounting correctness, immutable ledger posting, or transactional integrity.

Also demonstrate:

- required-field and invalid-value validation;
- one approval failure state with an Arabic reason;
- empty, loading, error, and populated states;
- filters and search on management lists;
- status chips and detail timelines;
- a confirmation step for consequential demo actions;
- role-based financial redaction;
- reset to seed data.

## 11. Fast implementation structure

Prefer reusable, fixture-driven patterns:

- one management shell and one worker shell;
- one central route registry;
- one typed fixture/state model;
- shared KPI card, data table, filter bar, form section, status badge, timeline, empty state, confirmation dialog, and LTR-isolation components;
- shared seeded entities for batches, lots, factories, suppliers, customers, sales, payments, complaints, approvals, and traceability events;
- screen-specific composition rather than duplicated infrastructure.

Prioritize presentation completeness and coherent interaction over backend-like abstractions.

## 12. Execution sequence for this single run

This showcase may be implemented in one bounded run, but use these checkpoints:

1. Scaffold and verify build.
2. Establish tokens, fonts, RTL shell, routes, fixtures, and demo store.
3. Complete and visually check the three reference screens:
   - worker raw-material receipt;
   - accountant review queue;
   - owner dashboard.
4. Build the remaining screens using approved shared patterns.
5. Wire the coherent demo story and role redaction.
6. Test all routes, build production assets, and perform final responsive smoke checks.

Test continuously during implementation, run the full showcase suite after completion, and do not report success with undocumented failing checks.

## 13. Minimum tests and quality gates

The completion gate requires:

- dependency install from the committed lockfile;
- formatting check;
- lint;
- TypeScript typecheck;
- unit/component tests;
- production build;
- route smoke test for every required screen;
- role-navigation and worker financial-redaction tests;
- RTL root and LTR-isolation tests;
- demo-story state-transition test;
- localStorage restore/reset test;
- manual smoke checks at 360 px worker width, tablet width, and desktop management width;
- secret scan showing that no credential or real client data was introduced.

Keep test scope proportional to a disposable showcase. Do not create fake tests that assert only that components exist.

## 14. Deliverables

Deliver:

- a runnable `/demo-app`;
- `/demo-app/README.md` with install, run, test, build, Vercel setup, demo roles, demo story, limitations, and reset instructions;
- committed lockfile;
- Vercel SPA rewrite configuration;
- no environment-variable requirement;
- one clean commit on `demo/interactive-showcase` after all gates pass.

## 15. Completion report

Report:

1. branch and commit hash;
2. files created or materially changed;
3. exact commands run and their results;
4. screen/route inventory;
5. implemented demo interactions;
6. role visibility and redaction evidence;
7. responsive checks performed;
8. remaining presentation limitations;
9. whether a push succeeded or a credentialless bundle was produced;
10. exact Vercel deployment steps for the owner.

Do not describe this showcase as the completed ERP MVP. Call it **Quick Interactive ERP Showcase** in all technical and client-facing labels.
