# Quick Interactive ERP Showcase

> **نسخة عرض تفاعلية — بيانات تجريبية غير حقيقية**
>
> This is a **disposable, non-authoritative** interactive showcase for the
> Specialized Yarn Trading & Outsourced Manufacturing ERP (`نظام إدارة تجارة
وتشغيل الغزل لدى الغير`). It is **not** the operational ERP MVP. It must
> never be presented as production-ready, pilot-ready, financially correct,
> secure authentication, a backup system, or an implementation of the binding
> posting contracts.

The showcase lets the owner and client navigate every major screen, exercise
a small synthetic workflow, and evaluate the Arabic-first UI/UX before the
real backend is complete. State lives only in the browser through React state
and `localStorage`. There is **no** server, database, real authentication,
Supabase, Firebase SDK, Docker, or migration runtime.

## Tech Stack

- React 18 + TypeScript + Vite 6
- Tailwind CSS 3 (semantic tokens, no literal component colors)
- shadcn/ui-style components built on Radix UI primitives
- React Router 7
- React Hook Form 7 + Zod 3
- TanStack Table 8
- Recharts 2
- Lucide icons
- Vitest 2 + React Testing Library
- `@fontsource/tajawal` and `@fontsource/alexandria` (bundled fonts, no
  third-party runtime font request)

A single `package-lock.json` lockfile pins all versions. No environment
variables are required.

## Install

```bash
cd demo-app
npm install
```

## Run (dev server)

```bash
npm run dev
```

The app serves at the URL printed by Vite (default `http://localhost:5173`).

## Test

```bash
npm test            # run the full suite once
npm run test:watch  # watch mode
```

Tests cover:

- route smoke test for every required screen (39 routes);
- role-navigation and worker financial-redaction (Owner vs Accountant vs
  Warehouse vs Production);
- RTL root + `BidiValue` LTR-isolation;
- demo-story state transitions for the first three story steps;
- localStorage hydration, persistence, reset, corrupt fallback, and version
  fallback.

## Build

```bash
npm run build
```

Outputs static assets to `dist/`. Preview with:

```bash
npm run preview
```

## Quality gates

The completion gate for this showcase requires all of the following to
pass — and they do:

| Gate                 | Command                  | Result                                    |
| -------------------- | ------------------------ | ----------------------------------------- |
| Format check         | `npx prettier --check .` | pass                                      |
| Lint                 | `npm run lint`           | pass (4 react-refresh warnings, 0 errors) |
| TypeScript typecheck | `npm run typecheck`      | pass                                      |
| Unit/component tests | `npm test`               | pass (62/62)                              |
| Production build     | `npm run build`          | pass                                      |
| Secret scan          | see below                | pass                                      |

### Secret scan

A repository-wide scan for accidental credentials, real client/supplier
data, or secrets was performed. The showcase uses only synthetic Egyptian
yarn-trading data (invented supplier names like "شركة الدلتا لتجارة الأقطان",
fake phone numbers, deterministic fixture amounts). No real client, supplier,
factory, financial, or historical data is used. No credentials, API keys,
service-account JSON, or `.env` files are present.

## Vercel deployment

Primary target: **Vercel static deployment**.

1. Push the `demo/interactive-showcase` branch to GitHub.
2. In Vercel, **Import Project** from the `MohamedAzzam4/ERP-Yarn` repo.
3. Configure the project:
   - **Root Directory:** `demo-app`
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
   - **Install Command:** `npm install` (default)
   - **Environment Variables:** none
4. Deploy. The included `vercel.json` SPA rewrite ensures nested routes
   like `/management/approvals` refresh cleanly without 404.

Firebase Hosting is an optional static-hosting fallback only — do **not**
add Firestore, Firebase Auth, Cloud Functions, or App Hosting.

## Demo roles

The role switcher is a presentation aid, **not** authentication. Five roles
are available:

| Role              | Label (Arabic) | Mode             | What they see                                                                                 |
| ----------------- | -------------- | ---------------- | --------------------------------------------------------------------------------------------- |
| Owner             | المالك         | Management       | Full dashboards, approvals, balances, approximate profitability, traceability, users          |
| Accountant        | محاسب          | Management       | Review queues, balances, payments, direct-cost review, migration warnings                     |
| Warehouse worker  | عامل مخزن      | Worker Task Mode | Raw-material receipt, stock transfer, return receipt, recent activity — **no financial data** |
| Production worker | عامل إنتاج     | Worker Task Mode | Material issue, single-yarn / twisted-yarn receipts, WIP return — **no rates or payables**    |
| Quality worker    | عامل جودة      | Worker Task Mode | Quality test entry, hold/release, recent activity — **no financial treatment**                |

Changing the role changes the shell, landing screen, navigation, actions,
and financial visibility. Direct URL entry respects role visibility (the
`RouteGuard` component redirects a worker who tries to visit a management
route back to their worker home, and vice-versa).

## Demo story

The coherent synthetic workflow:

1. Receive a raw-material batch from a supplier (Worker → استلام خام).
2. Transfer part of it to an external factory location (Worker → نقل مخزون).
3. Issue material to production (Worker → صرف للإنتاج).
4. Record a single-yarn or twisted-yarn output lot (Worker → استلام إنتاج).
5. Create a draft sale with a reservation (Accountant → مسودة بيع).
6. Submit and approve the sale (Accountant → اعتماد).
7. Record a customer payment (Accountant → المدفوعات).
8. Open a quality complaint and record a return or replacement
   (Accountant → الشكاوى → المرتجعات).
9. Show the resulting traceability chain, dashboard counters, and activity
   timeline (Owner → لوحة المالك / تتبّع).

These are **UI state transitions only**. They do not claim accounting
correctness, immutable ledger posting, or transactional integrity.

## Limitations

This showcase:

- does **not** implement the binding posting contracts (inventory, approval,
  production, costing, subledger, migration);
- does **not** enforce permissions server-side — worker financial redaction
  is presentation-only;
- does **not** provide shared multi-user data across devices;
- does **not** provide real authentication or password recovery — the
  auth decision is `Unresolved / requires owner decision`;
- does **not** implement exports that could be mistaken for backups;
- marks simulated backup, migration, approval, accounting, and profitability
  information visibly as demo-only;
- has every button either perform a clear local demo action or display
  `متاح في النسخة التشغيلية لاحقًا` (or equivalent) — no silent dead
  controls.

Unresolved owner decisions surfaced in the UI:

- `auth.signin_method` — private sign-in method
- `auth.recovery_policy` — password / account recovery policy
- `worker.row_scope` — PCD-SEC-001: worker row-scope model
- Migration dual-approval identity — PCD-MIG-001: whether the two
  commit approvals must come from distinct user identities

## Reset

Use the **إعادة ضبط بيانات العرض** button (in the sidebar of either shell)
to restore deterministic seed data. The reset wipes `localStorage` and
rebuilds the seed state.

## Project structure

```
demo-app/
├── public/favicon.svg
├── src/
│   ├── main.tsx                       # entrypoint
│   ├── App.tsx                        # router + providers
│   ├── index.css                      # tailwind + design tokens
│   ├── types/index.ts                 # typed showcase domain model
│   ├── data/seed.ts                   # deterministic synthetic seed
│   ├── store/DemoStoreContext.tsx     # reducer + localStorage provider
│   ├── lib/
│   │   ├── utils.ts                   # cn, formatNumber, formatDate, formatEgp
│   │   └── permissions.ts             # role helpers (presentation only)
│   ├── components/
│   │   ├── ui/                        # shadcn-style primitives
│   │   └── shared/                    # BidiValue, KpiCard, DataTable, etc.
│   ├── routes/index.ts                # central route registry
│   ├── shells/                        # AuthShell, WorkerShell, ManagementShell, RouteGuard
│   ├── screen-utils/                  # WorkerFormScreen, ManagementListScreen templates
│   ├── screens/
│   │   ├── auth/                      # DemoLogin, PasswordRecovery
│   │   ├── shared/                    # WorkerHome, AllScreensIndex
│   │   ├── dashboards/                # OwnerDashboard, AccountantDashboard
│   │   ├── warehouse/                 # 4 worker screens
│   │   ├── production/                # 5 worker screens
│   │   ├── quality/                   # 3 worker screens
│   │   ├── management/                # 14 management screens
│   │   ├── migration/                 # 3 staging/validation/approval screens
│   │   ├── traceability/              # 1 traceability screen
│   │   ├── reports/                   # 1 reports hub
│   │   └── admin/                     # 3 admin screens
│   └── test/                          # vitest + RTL setup + 5 test files
├── index.html                         # <html lang="ar" dir="rtl">
├── tailwind.config.js
├── postcss.config.js
├── vite.config.ts
├── vitest.config.ts
├── eslint.config.js
├── .prettierrc.json
├── vercel.json                        # SPA rewrite
└── package.json
```
