# WP-02-06 Manual Backup and Restore Smoke

**Work Package**: WP-02-06 — Manual Backup and Restore Smoke  
**Status**: `ready_for_merge` — true separate-target restore proven  
**Date**: 2026-07-06  
**Operator**: automated smoke script (scripts/wp-02-06-separate-restore.ts)

## ✅ True Separate-Target Restore — PASSED

This checkpoint proves a **true separate-database restore** — the backup was restored into a completely separate Supabase project (`tbmfzyghjnlbbdltdqcj` in eu-west-1), NOT a schema within the same database.

### Source and Restore Target

| | Source | Restore Target |
|---|---|---|
| Project ref | `roewagammrhatmocvhwb` | `tbmfzyghjnlbbdltdqcj` |
| Region | eu-central-2 | eu-west-1 |
| Connection | pooler (IPv4) | pooler (IPv4) |
| Schema | public (60 tables, live dev data) | public (reset + fresh migrations applied) |

**Separate database confirmed**: different server addresses, different Supabase projects, different regions.

### Backup Method

**Logical export via `postgres.js` SELECT + sanitized SQL INSERT generation.**

`pg_dump` was not available in the environment. The smoke script uses the `postgres.js` npm package to query the source database and generate equivalent logical backup SQL (INSERT statements with sanitized values). This is a logical SQL export, not an Excel/PDF report export (DEC-026: "exports are not backups" — this is a SQL data export, which IS a form of logical backup).

**Production recommendation**: Use `pg_dump` or Supabase's managed backup tool for production backups.

### Restore Method

1. **Reset restore target**: `DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;` (only on the disposable restore-test project, never on source/dev)
2. **Apply migrations 0000-0005**: all 6 Drizzle migrations applied sequentially to create the full ERP schema with FKs, CHECKs, unique indexes, enums, and triggers
3. **Load backup data**: `SET session_replication_role = replica;` (disables FK checks during bulk load), execute INSERT statements, `SET session_replication_role = DEFAULT;`
4. **Verify**: row counts, relationship integrity, constraints, sample reconciliation

### Migrations Applied (all 6)

| Migration | File | Content |
|---|---|---|
| 0000 | `0000_strong_zeigeist.sql` | Platform/security schema (tenants, users, roles, permissions, audit_logs, approval_requests, etc.) |
| 0001 | `0001_slow_marvel_apes.sql` | Inventory schema (inventory_items, raw_material_batches, stock_movements, inventory_balances, etc.) |
| 0002 | `0002_nasty_stature.sql` | Master data schema (suppliers, customers, locations, external_factories, fiber_types, etc.) |
| 0003 | `0003_first_rocket_raccoon.sql` | Financial/subledger schema (accounts, account_entries, payments, etc.) |
| 0004 | `0004_far_white_tiger.sql` | Production/sales/returns schema |
| 0005 | `0005_dazzling_boomer.sql` | WP-02-04 additive: storage_location_id, purchase_order_ref, notes on raw_material_batches |

### Verification Evidence

See `wp-02-06-restore-evidence.json` for the full sanitized evidence file.

#### Row Counts (source = restored, all 12 tables match ✅)

| Table | Source | Restored | Match |
|---|---|---|---|
| tenants | 1 | 1 | ✅ |
| users | 2 | 2 | ✅ |
| suppliers | 1 | 1 | ✅ |
| locations | 1 | 1 | ✅ |
| fiber_types | 1 | 1 | ✅ |
| inventory_items | 1 | 1 | ✅ |
| raw_material_batches | 1 | 1 | ✅ |
| stock_movements | 1 | 1 | ✅ |
| inventory_balances | 1 | 1 | ✅ |
| accounts | 1 | 1 | ✅ |
| account_entries | 1 | 1 | ✅ |
| approval_requests | 1 | 1 | ✅ |

#### Relationship Integrity (all 4 pass ✅)

| Check | Result | Detail |
|---|---|---|
| movement → item + location + source | ✅ | 1 movement resolves all FKs |
| balance reconciles to movement | ✅ | on_hand=1000.000 = movement_qty=1000.000 |
| account_entry → source batch | ✅ | 1 entry resolves source |
| approval → draft + subject hash | ✅ | 1 approval resolves draft + has hash |

#### Constraint Evidence (all 4 pass ✅)

| Check | Result | Detail |
|---|---|---|
| FK constraints exist | ✅ | 299 FK constraints in public schema |
| CHECK constraints exist | ✅ | 628 CHECK constraints |
| Unique indexes exist | ✅ | 59 unique indexes |
| audit_logs append-only trigger | ✅ | 2 triggers on audit_logs |
| WP-02-04 migration 0005 columns | ✅ | 3/3 columns (storage_location_id, purchase_order_ref, notes) |

#### Sample Reconciliation (both pass ✅)

| Check | Result | Detail |
|---|---|---|
| DEC-067 payable formula | ✅ | amount_signed=-80.00 (1000/1000×80=80, negative) |
| inventory balance | ✅ | on_hand=1000.000 |

### Critical ERP Data Recovery Coverage

| Data Type | Covered | Evidence |
|---|---|---|
| tenants | ✅ | 1 tenant backed up + restored |
| users/roles | ✅ | 2 users (requester + owner) backed up + restored |
| master data | ✅ | supplier, location, fiber_type backed up + restored |
| raw receipt draft/approval | ✅ | raw_material_batches + approval_requests backed up + restored |
| stock movement | ✅ | 1 stock_movement backed up + restored |
| inventory balance | ✅ | 1 inventory_balance backed up + restored |
| supplier payable/account entry | ✅ | 1 account_entry (supplier_raw_payable, -80.00) backed up + restored |
| approval request | ✅ | 1 approval_request (decided, subject hash) backed up + restored |
| audit/idempotency/document-number | ⚠️ | audit_logs is append-only (fixture skipped); document_sequences + idempotency_records are in-process stores (no rows) |

### Storage/File Limitation

**Supabase Storage files are NOT included in this backup** — only database rows. Storage backup is a separate concern (Contract 01: "Back up or independently retain required Storage source/import files and metadata"). Source-file/storage recovery is NOT proven by this smoke.

### Remaining Limitations

1. **pg_dump not available**: Backup was captured via `postgres.js` SELECT + SQL INSERT, not `pg_dump`. Production should use `pg_dump` or Supabase's managed backup tool.
2. **audit_logs append-only**: Fixture does not create audit rows (trigger prevents cleanup). In a real backup, audit_logs would be included.
3. **In-process stores not persisted**: `document_sequences` and `idempotency_records` use in-process stores. No rows in fixture. When DB-backed versions are implemented, they should be included.
4. **No production DR claim**: This proves the logical backup can be restored to a SEPARATE database with constraints/FKs/triggers intact. It does NOT prove production disaster recovery or Storage file recovery.
5. **Provider-managed backups**: Supabase PITR may supplement this when the plan supports it. Free-tier managed-backup assumptions must not replace a demonstrated logical backup and restore test.

## Manual Backup Procedure

### Prerequisites
- Access to the source Supabase project (DATABASE_URL)
- Node.js + project dependencies installed (`npm ci`)
- `postgres.js` npm package (already a project dependency)
- A SEPARATE restore target (separate Supabase project or local PostgreSQL)

### Steps

1. **Set DATABASE_URL as a transient env var** (do NOT persist to `.env`):
   ```bash
   export SOURCE_DATABASE_URL='postgresql://<user>:<password>@<host>:<port>/<db>'
   ```

2. **Run the backup/restore smoke script** (requires both source + restore URLs):
   ```bash
   export RESTORE_DATABASE_URL='postgresql://<restore-user>:<restore-password>@<restore-host>:<port>/<db>'
   npx tsx --tsconfig scripts.tsconfig.json scripts/wp-02-06-separate-restore.ts
   ```

3. **The script will**:
   - Confirm source + restore are separate databases
   - Reset restore target public schema (DROP + CREATE)
   - Apply migrations 0000-0005 to restore target
   - Create a synthetic fixture in source DB
   - Back up fixture as SQL INSERTs → `docs/operations/wp-02-06-backup-fixture.sql`
   - Restore into the SEPARATE restore target
   - Verify counts + relationships + constraints + sample reconciliation
   - Write evidence → `docs/operations/wp-02-06-restore-evidence.json`
   - Clean up fixture from both databases

4. **Review the evidence file** at `docs/operations/wp-02-06-restore-evidence.json`

5. **For a production backup** (NOT this smoke):
   - Use `pg_dump` with the Supabase connection string
   - Capture migration version: `npx drizzle-kit generate` (should report "No schema changes")
   - Store the backup file in a secure, redundant location
   - Record operator, timestamp, duration, and evidence

## Separate-Target Restore Procedure

### Prerequisites
- A backup file (SQL INSERT statements or `pg_dump` output)
- Access to a SEPARATE restore target (separate Supabase project or local PostgreSQL)
- NEVER restore into the live source `public` schema

### Steps

1. **Reset the restore target** (ONLY on the disposable restore target):
   ```sql
   DROP SCHEMA IF EXISTS public CASCADE;
   CREATE SCHEMA public;
   GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
   ```

2. **Apply migrations 0000-0005** to create the full ERP schema:
   ```bash
   # Execute each migration file sequentially
   for f in drizzle/output/0000_*.sql drizzle/output/0001_*.sql ... drizzle/output/0005_*.sql; do
     psql "$RESTORE_DATABASE_URL" -f "$f"
   done
   ```

3. **Load the backup data** (disable FK checks for bulk load):
   ```sql
   SET session_replication_role = replica;
   -- Execute INSERT statements from backup file
   SET session_replication_role = DEFAULT;
   ```

4. **Verify** row counts, relationship integrity, constraints, and sample reconciliation (see verification steps in the smoke script).

5. **Record evidence**: operator, timestamp, duration, row counts, relationship check results, sample reconciliation, errors.

6. **Clean up the restore target** after evidence is recorded.

## Files

- `docs/operations/wp-02-06-backup-fixture.sql` — sanitized logical backup of the synthetic fixture
- `docs/operations/wp-02-06-restore-evidence.json` — sanitized evidence (counts, checks, reconciliation)
- `docs/operations/wp-02-06-manual-backup-restore.md` — this document
