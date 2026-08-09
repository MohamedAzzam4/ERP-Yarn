# WP-08-01E — Authenticated Browser Command-Success QA Runner

**Status**: `prepared_not_yet_executed`

This runner is committed as a credential-neutral, reproducible artefact.
It has NOT yet completed a successful run. The eight WP-08-01E command
workflows remain UNPROVEN via browser forms until the runner writes
`docs/ui-ux/evidence/wp-08-01e/browser-qa/SUCCESS_MARKER.txt`.

## What this is

A credential-neutral Playwright (Python) runner that, when the required
Supabase env vars are provided, performs the full authenticated browser
command-success QA pass for WP-08-01E:

1. Validates all required env vars are set; refuses to run (exit 2) if any
   are missing.
2. Starts Next.js dev server (default port 3210) with env vars exported.
3. Waits for `/api/health` to return 200.
4. Seeds actionable fixtures directly via `DATABASE_URL` (idempotent
   `ON CONFLICT DO NOTHING` inserts):
   - A dedicated QA tenant (`00000000-0000-0000-0000-000000081e50`).
   - Two `auth.users` rows (Owner + Quality Worker) with known bcrypt-hashed
     passwords so the browser `/login` form can authenticate them.
   - Matching `public.users`, `roles`, `permissions`, `role_permissions`,
     `user_roles` rows.
   - Master data: `fiber_types`, `product_types`, `customers`, `yarn_lots`,
     `inventory_items`, `locations`.
   - Business records: `sales_orders` + `sales_order_lines`, a `quality_tests`
     row in `in_review` state (so the review form is visible), an open
     `complaints` row, a `pending_approval` `return_requests` row with one
     `return_lines` row.
5. Opens a headless Chromium browser via Playwright.
6. Logs in as Owner via the `/login` form (real email + password).
7. **Asserts every protected route does NOT resolve to `/login`** (fail-closed
   if any redirect happens).
8. For each of the 8 server actions:
   - Captures DB before-state counts (12 tables).
   - Visits the route, locates the form by `data-action` selector.
   - Fills required inputs (heuristic: visible text/number inputs).
   - Submits the form.
   - Captures DB after-state counts.
   - Verifies the expected effect (new `audit_logs` row).
   - Captures a screenshot.
9. Logs in as Quality Worker; verifies `/worker/quality-entry` access and
   denial of `/management/quality/tests` (must redirect away from management).
10. Captures authenticated responsive screenshots at 360, 768, 1024, 1440
    for each of the 4 quality/complaint/return routes.
11. Runs accessibility checks:
    - Keyboard navigation (Tab moves focus).
    - Form labels (every input has `<label for>` or `aria-label`).
    - RTL/LTR direction (`html[dir]`).
    - Touch target size (>=24px for primary actions at 360 viewport).
12. Cleans up all seeded QA data in FK-safe order (children first),
    including `auth.users` rows.
13. Writes:
    - `summary.json` — machine-readable evidence.
    - `summary.txt` — human-readable summary table.
    - `screenshots/*.png` — one per command + per viewport.
    - `SUCCESS_MARKER.txt` — only present if all assertions passed.

## Required environment variables

| Variable | Why |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Browser-side Supabase client init. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser-side auth; required by Next.js proxy. |
| `SUPABASE_SECRET_KEY` | Server-side admin API (create auth users). |
| `DATABASE_URL` | Direct DB access for fixture seeding & verification. |
| `SUPABASE_PROJECT_REF` | Project identifier. |
| `ERP_YARN_REPO` | Absolute path to ERP-Yarn checkout. |

Optional:

| Variable | Default | Effect |
|---|---|---|
| `BROWSER_QA_HEADLESS` | `1` | `0` shows the browser window. |
| `BROWSER_QA_PORT` | `3210` | Port for the Next.js dev server. |
| `BROWSER_QA_KEEP_SERVER` | unset | `1` keeps the dev server running after QA (for debugging). |

## How to run (when credentials are available)

```bash
cd /home/z/my-project/ERP-Yarn
export NEXT_PUBLIC_SUPABASE_URL='https://<project>.supabase.co'
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='<publishable_key>'
export SUPABASE_SECRET_KEY='<secret_key>'
export DATABASE_URL='postgresql://postgres.<project>:<password>@aws-1-<region>.pooler.supabase.com:5432/postgres'
export SUPABASE_PROJECT_REF='<project>'
export ERP_YARN_REPO='/home/z/my-project/ERP-Yarn'

pip install psycopg2-binary playwright bcrypt
playwright install chromium

python3 scripts/wp-08-01e-browser-qa/run_qa.py
```

Exit codes:
- 0 — all assertions passed (also writes `SUCCESS_MARKER.txt`).
- 1 — one or more assertions failed.
- 2 — missing required environment variables (no work performed).
- 3 — Python dependency missing.

## Credential hygiene

- The runner never prints credential values.
- The runner never writes credentials to disk.
- All env vars are read at startup; the child Next.js process inherits
  them via `subprocess.run(env=...)`.
- After the runner exits, no credential material remains on disk.
- The runner NEVER invokes `git` (does not modify Git state).
- The runner NEVER invokes `vercel`/`docker`/`ssh` (does not deploy).

## Deterministic UUIDs

All seeded rows use deterministic UUIDs (`00000000-0000-0000-0000-000000081eXX`)
so re-runs are idempotent. Cleanup deletes by `tenant_id = '00000000-0000-0000-0000-000000081e50'`.

## Honest status

The runner is **prepared but not yet executed successfully**. Do NOT claim
browser-success for any of the eight WP-08-01E command workflows without a
written `SUCCESS_MARKER.txt` file. The previous QA manifest's claim of
"21/22 browser QA checks pass" was based on partial work that did not
exercise form submissions; this runner supersedes that claim and is the
single source of truth for browser-success evidence going forward.
