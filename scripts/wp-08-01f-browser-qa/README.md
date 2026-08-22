# WP-08-01F Browser QA Harness

Resumable browser QA for the migration batch lifecycle. Each stage is short
and persists progress so it can resume after sandbox resets.

## Structure

```
scripts/wp-08-01f-browser-qa/
  README.md            — this file
  run-stage.py         — main stage runner (Playwright)
  preflight.mjs        — credential presence check (no values printed)
  status.mjs           — report persisted run state
  db-proof.mjs         — DB batch status + counts helper
  storage-proof.mjs    — Supabase Storage list/count/delete helper
  cleanup.mjs          — FK-safe cleanup scoped by QA tenant
  fixtures/
    invalid.csv        — CSV with 7 validation errors
    valid.csv          — clean 3-row CSV
    corrected.csv      — corrected 3-row CSV for replacement
  run-state/           — persisted non-secret run state (gitignored)
```

## Credentials

All credentials via environment variables only. Never printed, never persisted.

Required:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `DATABASE_URL`

> **DEC-057 — `SUPABASE_SERVICE_ROLE_KEY` is RETIRED.** Earlier versions of
> this harness accepted either `SUPABASE_SECRET_KEY` OR
> `SUPABASE_SERVICE_ROLE_KEY` as a fallback. The fallback has been removed
> across the harness — every script reads ONLY `SUPABASE_SECRET_KEY`. The
> preflight (`scripts/wp-08-01f-browser-qa/preflight.mjs`) enforces the
> standardized four-variable set.

## Usage

### Preflight (check credentials)
```bash
cd ERP-Yarn
python3 scripts/wp-08-01f-browser-qa/run-stage.py preflight
```

### Clean QA tenant
```bash
python3 scripts/wp-08-01f-browser-qa/run-stage.py cleanup
```

### Run Cycle A (invalid → replacement)
```bash
RUN=qaA-$(date +%s)
python3 scripts/wp-08-01f-browser-qa/run-stage.py A1 $RUN
python3 scripts/wp-08-01f-browser-qa/run-stage.py A2 $RUN
python3 scripts/wp-08-01f-browser-qa/run-stage.py A3 $RUN
python3 scripts/wp-08-01f-browser-qa/run-stage.py A4 $RUN
```

### Run Cycle B (happy path)
```bash
RUN=qaB-$(date +%s)
python3 scripts/wp-08-01f-browser-qa/run-stage.py B1 $RUN
python3 scripts/wp-08-01f-browser-qa/run-stage.py B2 $RUN
python3 scripts/wp-08-01f-browser-qa/run-stage.py B3 $RUN
```

### Worker denial
```bash
python3 scripts/wp-08-01f-browser-qa/run-stage.py worker $RUN
```

### Responsive screenshots
```bash
python3 scripts/wp-08-01f-browser-qa/run-stage.py responsive $RUN
```

### Check status
```bash
python3 scripts/wp-08-01f-browser-qa/run-stage.py status $RUN
```

### Resume after sandbox reset
Each stage checks persisted state and skips completed stages.
Just re-run the same stage command with the same run ID.

## Test Identities

- Owner: `qa-browser-owner@erp-yarn.test`
- Accountant: `qa-browser-accountant@erp-yarn.test`
- Worker: `qa-browser-worker@erp-yarn.test`
- QA Tenant: `00000000-0000-0000-0000-000000081e50`

## Evidence

Screenshots stored in: `docs/ui-ux/evidence/wp-08-01f/runs/<run-id>/`
