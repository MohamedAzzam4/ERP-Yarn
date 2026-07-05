# WP-02-06 Manual Backup and Restore Smoke

**Work Package**: WP-02-06 — Manual Backup and Restore Smoke  
**Status**: `ready_for_validation`  
**Date**: 2026-07-05  
**Operator**: automated smoke script (scripts/wp-02-06-backup-restore-smoke.ts)

## Purpose

Prove a minimum manual backup and restore smoke path before pilot/real data. This package is about evidence and recovery procedure, NOT building a production backup product.

**Per Contract 01 §Before Real Pilot Data**: "Create a logical PostgreSQL backup using a supported administrative connection/tool. Capture migration version and backup timestamp. Restore the database to a separate test project/database. Verify row counts and selected critical documents. Reconcile sample stock and account balances."

## Backup Method

**Method**: Logical export via `SELECT` + sanitized SQL INSERT generation using `postgres.js`.

**Why not `pg_dump`**: `pg_dump` was not available in the smoke environment (no `postgresql-client` package installed, no sudo access). The smoke script uses the `postgres.js` npm package (already a project dependency) to query the database and generate equivalent logical backup SQL.

**Production recommendation**: Use `pg_dump` or Supabase's managed backup tool for production backups. The `postgres.js` approach is a smoke-environment substitute.

**What is backed up**:
- `tenants` (by id)
- `users` (by tenant_id)
- `suppliers`, `locations`, `fiber_types` (master data)
- `inventory_items`, `raw_material_batches` (inventory identity + draft)
- `stock_movements`, `inventory_balances` (posted stock)
- `accounts`, `account_entries` (subledger)
- `approval_requests` (approval workflow)
- `audit_logs` (append-only audit trail)
- `document_sequences`, `idempotency_records` (infrastructure)

**What is NOT backed up**:
- Supabase Storage files (separate concern — Contract 01: "Back up or independently retain required Storage source/import files and metadata")
- Database schema DDL (only data rows are exported; schema is recreated via Drizzle migrations)
- Enums, constraints, indexes, triggers (recreated via Drizzle migrations)

## Restore Target

**Target**: Separate schema `restore_smoke_target` within the same Supabase dev project.

**Important**: This is NOT the live `public` schema. The restore schema is dropped and recreated fresh for each smoke run. This is a **local smoke restore**, not a managed disaster-recovery setup.

**Table creation**: `CREATE TABLE restore_smoke_target.<table> (LIKE public.<table> INCLUDING DEFAULTS)` — copies the full column structure but WITHOUT constraints/FKs/indexes, so data can be loaded without FK ordering issues.

**Production recommendation**: A production restore test should use a separate Supabase project or a local PostgreSQL instance, not a schema within the same project.

## Verification Evidence

See `wp-02-06-restore-evidence.json` for the full sanitized evidence file. Summary:

### Row Counts (source = restored)

| Table | Source Count | Restored Count | Match |
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

### Relationship Integrity Checks

| Check | Result | Detail |
|---|---|---|
| movement → item + location + source | ✅ PASS | 1 movement resolves item/location/source |
| balance reconciles to movement | ✅ PASS | on_hand=1000.000, movement_qty=1000.000 |
| account_entry → source batch | ✅ PASS | 1 account entry resolves source batch |
| approval → draft + subject hash | ✅ PASS | 1 approval resolves draft + has subject hash |

### Sample Reconciliation

| Check | Result | Detail |
|---|---|---|
| DEC-067 payable formula | ✅ PASS | amount_signed=-80.00 (1000/1000×80=80, negative) |
| inventory balance = 1000.000 | ✅ PASS | on_hand=1000.000 |

## Critical ERP Data Recovery Coverage

The smoke fixture covers all critical ERP data types:

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
| audit/idempotency/document-number | ⚠️ | audit_logs is append-only (can't clean up fixture); document_sequences + idempotency_records are in-process stores (no rows in fixture) |

## Limitations and Recovery Caveats

1. **Local smoke restore, not managed DR**: This is a local smoke restore into a separate schema within the same Supabase dev project, NOT a managed disaster-recovery setup. A production restore test should use a separate Supabase project or local PostgreSQL instance.

2. **pg_dump not available**: `pg_dump` was not available in the environment. Backup was captured via `SELECT` + sanitized SQL INSERT generation using `postgres.js`. A production backup should use `pg_dump` or Supabase's managed backup tool.

3. **Separate schema, not separate database**: The restore target is a separate schema (`restore_smoke_target`), not a separate database/project. This proves the backup data can be loaded and relationships resolve, but does NOT prove cross-database restore works.

4. **Simplified restore schema**: The restore schema tables have the full column structure but NO FKs, enums, CHECK constraints, or triggers. A production restore must use the full schema (via Drizzle migrations) to verify constraint compliance.

5. **Storage files not included**: Supabase Storage files are NOT included in this backup — only database rows. Storage backup is a separate concern (Contract 01: "Back up or independently retain required Storage source/import files and metadata").

6. **audit_logs is append-only**: The fixture does not create audit_logs rows because the append-only trigger prevents cleanup. In a real backup, audit_logs would be included.

7. **In-process stores not persisted**: `document_sequences` and `idempotency_records` use in-process stores (InProcessDocumentSequenceStore, InProcessIdempotencyStore) in the current implementation. No rows exist in the fixture. When DB-backed versions are implemented, they should be included in the backup.

8. **No production readiness claim**: This does NOT prove production readiness. It proves the logical backup data can be loaded and relationships resolve.

9. **Provider-managed backups**: Supabase PITR (point-in-time recovery) may supplement this process when the selected plan supports it. Free-tier managed-backup assumptions must not replace a demonstrated logical backup and restore test.

## Manual Backup Procedure

### Prerequisites
- Access to the Supabase dev project (DATABASE_URL)
- Node.js + project dependencies installed (`npm ci`)
- `postgres.js` npm package (already a project dependency)

### Steps

1. **Set DATABASE_URL as a transient env var** (do NOT persist to `.env`):
   ```bash
   export DATABASE_URL='postgresql://<user>:<password>@<host>:<port>/<db>'
   ```

2. **Run the backup/restore smoke script**:
   ```bash
   npx tsx --tsconfig scripts.tsconfig.json scripts/wp-02-06-backup-restore-smoke.ts
   ```

3. **The script will**:
   - Create a synthetic recovery fixture (tenant, users, masters, draft, approval, stock, balance, payable)
   - Capture a logical backup as sanitized SQL INSERT statements → `docs/operations/wp-02-06-backup-fixture.sql`
   - Restore into a separate schema (`restore_smoke_target`)
   - Verify row counts + relationship integrity + sample reconciliation
   - Write evidence → `docs/operations/wp-02-06-restore-evidence.json`
   - Clean up the fixture + restore schema

4. **Review the evidence file** at `docs/operations/wp-02-06-restore-evidence.json`

5. **For a production backup** (NOT this smoke):
   - Use `pg_dump` with the Supabase connection string
   - Capture migration version: `npx drizzle-kit generate` (should report "No schema changes")
   - Store the backup file in a secure, redundant location
   - Record operator, timestamp, duration, and evidence

## Separate-Target Restore Procedure

### Prerequisites
- A backup file (SQL INSERT statements or `pg_dump` output)
- Access to a SEPARATE restore target (separate Supabase project, local PostgreSQL, or separate schema)
- NEVER restore into the live `public` schema

### Steps

1. **Create a fresh restore target** (separate schema for smoke, separate database for production):
   ```sql
   DROP SCHEMA IF EXISTS restore_smoke_target CASCADE;
   CREATE SCHEMA restore_smoke_target;
   ```

2. **Create tables mirroring the source schema**:
   ```sql
   CREATE TABLE restore_smoke_target.tenants (LIKE public.tenants INCLUDING DEFAULTS);
   CREATE TABLE restore_smoke_target.users (LIKE public.users INCLUDING DEFAULTS);
   -- ... for each table
   ```

3. **Load the backup SQL** (modify INSERT statements to target the restore schema):
   ```bash
   # For each INSERT statement, prefix the table name with the restore schema:
   sed 's/INSERT INTO tenants/INSERT INTO restore_smoke_target.tenants/g' backup.sql | psql "$DATABASE_URL"
   ```

4. **Verify row counts** match the source:
   ```sql
   SELECT COUNT(*) FROM restore_smoke_target.users WHERE tenant_id = '<tenant>';
   SELECT COUNT(*) FROM restore_smoke_target.stock_movements WHERE tenant_id = '<tenant>';
   -- ... for each table
   ```

5. **Verify relationship integrity**:
   ```sql
   -- movement references item + location + source
   SELECT COUNT(*) FROM restore_smoke_target.stock_movements sm
   JOIN restore_smoke_target.inventory_items i ON sm.item_id = i.id
   JOIN restore_smoke_target.locations l ON sm.to_location_id = l.id;
   
   -- balance reconciles to movement
   SELECT ib.on_hand_qty_kg, sm.quantity_kg
   FROM restore_smoke_target.inventory_balances ib
   JOIN restore_smoke_target.stock_movements sm ON ib.last_movement_id = sm.id;
   
   -- account entry references source
   SELECT COUNT(*) FROM restore_smoke_target.account_entries ae
   JOIN restore_smoke_target.raw_material_batches rmb ON ae.source_document_id = rmb.id;
   
   -- approval references draft + subject hash
   SELECT COUNT(*) FROM restore_smoke_target.approval_requests ar
   JOIN restore_smoke_target.raw_material_batches rmb ON ar.entity_id = rmb.id
   WHERE ar.subject_hash IS NOT NULL;
   ```

6. **Reconcile sample balances** (DEC-067 payable formula):
   ```sql
   -- payable = net_weight_kg / 1000 × price_per_ton, negative signed
   SELECT ae.amount_signed, rmb.net_weight_kg
   FROM restore_smoke_target.account_entries ae
   JOIN restore_smoke_target.raw_material_batches rmb ON ae.source_document_id = rmb.id
   WHERE ae.entry_type = 'supplier_raw_payable';
   ```

7. **Record evidence**: operator, timestamp, duration, row counts, relationship check results, sample reconciliation, errors.

8. **Clean up the restore target**:
   ```sql
   DROP SCHEMA IF EXISTS restore_smoke_target CASCADE;
   ```

## Files

- `docs/operations/wp-02-06-backup-fixture.sql` — sanitized logical backup of the synthetic fixture
- `docs/operations/wp-02-06-restore-evidence.json` — sanitized evidence (counts, checks, reconciliation)
- `docs/operations/wp-02-06-manual-backup-restore.md` — this document
- `scripts/wp-02-06-backup-restore-smoke.ts` — the smoke script (not committed; dev tooling)
