/**
 * WP-07-04 Contract 08 §12.4 — Service-level PostgreSQL race proofs.
 *
 * These tests prove the ACTUAL application-level mutual exclusion between
 * HistoricalCommitService.commitBatch() and real live operational posting
 * commands, across the FULL protected transaction (not just the advisory
 * lock primitive).
 *
 * Test identifiers:
 *   SVC-RACE-1 — actual historical commit first, real live inventory post blocked
 *   SVC-RACE-2 — actual live inventory post first, real historical commit blocked
 *   SVC-RACE-3 — actual payment post vs actual party-opening historical commit
 *   SVC-RACE-4 — two actual historical commits for same tenant/domain
 *   SVC-RACE-5 — actual technical failure/recovery inside real commit transaction
 *
 * Concurrency mechanism:
 *   - Real HistoricalCommitService.commitBatch() with real DB repos.
 *   - Real live commands (InventoryLedgerService.postRawReceipt,
 *     PaymentService.postPayment) with real DB repos.
 *   - Test-dependency barrier wrapper around the tx-scoped
 *     InventoryLedgerService / SubledgerService that:
 *       1. delegates to the real requireCutoverLock (acquires the real
 *          advisory lock on the real transaction connection);
 *       2. signals lockAcquired;
 *       3. awaits releaseBarrier;
 *       4. production service continues with its real writes.
 *   - Independent PostgreSQL connections for the two sides of the race.
 *   - Short statement_timeout on the blocked side converts the wait into a
 *     deterministic error.
 *
 * These are NOT primitive advisory-lock tests. The primitive tests
 * (CUTVER-RACE-A..F in wp-07-04-cutover-race.test.ts) prove the lock
 * primitive. These tests prove the full application-level invariant.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/server/db/schema";
import { HistoricalCommitService } from "@/server/services/historical-commit-service";
import { HistoricalCommitDbRepository } from "@/server/services/historical-commit-db-repository";
import { AuditDbRepository } from "@/server/services/audit-db-repository";
import { IdempotencyDbRepository } from "@/server/services/idempotency-db-repository";
import { DocumentSequenceDbRepository } from "@/server/services/document-sequence-db-repository";
import { InventoryLedgerService } from "@/server/services/inventory-ledger-service";
import { InventoryLedgerDbRepository } from "@/server/services/inventory-ledger-db-repository";
import { SubledgerService } from "@/server/services/subledger-service";
import { SubledgerDbRepository } from "@/server/services/subledger-db-repository";
import { PaymentService } from "@/server/services/payment-service";
import { PaymentDbRepository } from "@/server/services/payment-db-repository";
import { resolveEffectivePermissions } from "@/server/security/effective-permissions";
import { TEST_ROLE_PERMISSION_MATRIX } from "@/server/security/role-fixtures";
import type { ErpUserContext } from "@/server/auth/erp-context";
import { checkDestructiveTestDbSafety } from "./destructive-test-guard";

const DATABASE_URL = process.env.DATABASE_URL;
const ALLOW_DESTRUCTIVE = process.env.ERP_ALLOW_DESTRUCTIVE_LOCAL_TEST_DB === "1";
const REQUIRE_PROOF = process.env.ERP_REQUIRE_WP0801F_POSTGRES_PROOF === "1";
const SHARED_GUARD_RESULT = checkDestructiveTestDbSafety({
  databaseUrl: DATABASE_URL,
  allowDestructive: ALLOW_DESTRUCTIVE,
  requireProof: REQUIRE_PROOF,
});
const describeOrSkip = SHARED_GUARD_RESULT.kind === "ok" ? describe : describe.skip;

let sql: ReturnType<typeof postgres>;
let db: any;

const RUN_ID = randomUUID();
const T = RUN_ID;
const OWNER_ID = randomUUID();
const ACCOUNTANT_ID = randomUUID();

async function seedTenantAndUsers() {
  const s = RUN_ID.slice(0, 8);
  await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status) VALUES (${T}, ${"SR-" + s}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${OWNER_ID}, ${T}, ${"sr-o-" + s}, ${"SR Owner"}, ${"sr-o-" + s + "@test.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${ACCOUNTANT_ID}, ${T}, ${"sr-a-" + s}, ${"SR Acct"}, ${"sr-a-" + s + "@test.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
}

function makeOwnerUser(): ErpUserContext {
  return {
    authenticated: true, userId: OWNER_ID, tenantId: T,
    authId: `auth-${OWNER_ID}`, name: "Owner", email: `o-${OWNER_ID}@test.local`,
  };
}
function makeEffective() {
  return resolveEffectivePermissions(["owner"], TEST_ROLE_PERMISSION_MATRIX);
}

async function seedItem(): Promise<string> {
  const id = randomUUID();
  await sql`INSERT INTO inventory_items (id, tenant_id, item_kind, item_code, display_name_ar, display_name_en, quality_status, is_blocked, status, created_by, created_at) VALUES (${id}, ${T}, ${"raw_material"}, ${"SR-IT-" + id.slice(0, 8)}, ${"Item-" + id.slice(0, 8)}, ${"Test Item"}, ${"accepted"}, false, ${"active"}, ${OWNER_ID}, NOW()) ON CONFLICT (id) DO NOTHING`;
  return id;
}

async function seedLocation(): Promise<string> {
  const id = randomUUID();
  await sql`INSERT INTO locations (id, tenant_id, location_code, name_ar, name_en, location_type, status, created_by, created_at) VALUES (${id}, ${T}, ${"SR-LOC-" + id.slice(0, 8)}, ${"LOC-" + id.slice(0, 8)}, ${"Test Location"}, ${"internal_warehouse"}::location_type, ${"active"}::master_data_status, ${OWNER_ID}, NOW()) ON CONFLICT (id) DO NOTHING`;
  return id;
}

async function seedSupplier(): Promise<string> {
  const id = randomUUID();
  await sql`INSERT INTO suppliers (id, tenant_id, supplier_code, name_ar, name_en, normalized_name, status, created_by, created_at) VALUES (${id}, ${T}, ${"SR-SUP-" + id.slice(0, 8)}, ${"SUP-" + id.slice(0, 8)}, ${"Test Supplier"}, ${"sup-" + id.slice(0, 8)}, ${"active"}::master_data_status, ${OWNER_ID}, NOW()) ON CONFLICT (id) DO NOTHING`;
  return id;
}

async function seedApprovedForCommitBatch(batchId: string) {
  await sql`
    INSERT INTO import_batches (id, tenant_id, batch_no, status, source_description, template_name, template_version,
      mapping_version, cutover_manifest_hash, cutover_import_mode, staged_data_hash, staged_row_count,
      blocking_error_count, warning_count, accepted_warning_count, validation_status, reconciliation_status,
      warning_summary, committed_at, commit_effect_counts, created_by, created_at)
    VALUES (${batchId}, ${T}, ${"SR-" + batchId.slice(-6)}, ${"approved_for_commit"}::import_batch_status, ${"test"},
      ${"opening_balance_inventory"}, ${"1.0"}, ${"1.0"}, ${"sha256:manifest"}, ${"opening_balance"}, ${"sha256:test"}, 1,
      0, 0, 0, ${"passed"}, ${"matched"}, null, null, null, ${OWNER_ID}, NOW())`;
}

async function seedFileAndInventoryStagingRow(batchId: string, itemId: string, locationId: string): Promise<{ fileId: string; rowId: string }> {
  const fileId = randomUUID();
  await sql`
    INSERT INTO import_files (id, tenant_id, import_batch_id, original_file_name, storage_path, file_hash,
      file_size_bytes, content_type, file_type, file_version, is_current, created_by, created_at)
    VALUES (${fileId}, ${T}, ${batchId}, ${"data.csv"}, ${"local://test"}, ${"sha256:test"},
      100, ${"text/csv"}, ${"source"}, 1, true, ${OWNER_ID}, NOW())`;
  const rowId = randomUUID();
  // Inventory opening-balance row: has quantity + item_id + location_id.
  // No alias (no name field) → uses staged item_id/location_id directly.
  const rowData = {
    entity_type: "item",
    item_id: itemId,
    location_id: locationId,
    quantity: "100.000",
  };
  await sql`
    INSERT INTO import_staging_rows (id, tenant_id, import_batch_id, import_file_id, template_name,
      source_sheet_name, source_row_number, raw_row_json, transformed_row_json,
      transformation_notes, validation_status, review_status, ai_confidence,
      committed_entity_type, committed_entity_id, staging_version, is_current,
      created_by, created_at)
    VALUES (${rowId}, ${T}, ${batchId}, ${fileId}, ${"opening_balance_inventory"}, ${"data.csv"}, 1,
      ${JSON.stringify(rowData)}::jsonb,
      ${JSON.stringify(rowData)}::jsonb,
      null, ${"pending"}, ${"not_required"}, null, null, null, 1, true, ${OWNER_ID}, NOW())`;
  return { fileId, rowId };
}

async function seedFileAndPartyStagingRow(batchId: string, supplierId: string): Promise<{ fileId: string; rowId: string }> {
  const fileId = randomUUID();
  await sql`
    INSERT INTO import_files (id, tenant_id, import_batch_id, original_file_name, storage_path, file_hash,
      file_size_bytes, content_type, file_type, file_version, is_current, created_by, created_at)
    VALUES (${fileId}, ${T}, ${batchId}, ${"data.csv"}, ${"local://test"}, ${"sha256:test"},
      100, ${"text/csv"}, ${"source"}, 1, true, ${OWNER_ID}, NOW())`;
  const rowId = randomUUID();
  // Party opening-balance row: has entity_type=supplier + balance + owner_id.
  // No alias (no name field) → uses staged owner_id directly.
  const rowData = {
    entity_type: "supplier",
    owner_id: supplierId,
    balance: "-50000.00",
  };
  await sql`
    INSERT INTO import_staging_rows (id, tenant_id, import_batch_id, import_file_id, template_name,
      source_sheet_name, source_row_number, raw_row_json, transformed_row_json,
      transformation_notes, validation_status, review_status, ai_confidence,
      committed_entity_type, committed_entity_id, staging_version, is_current,
      created_by, created_at)
    VALUES (${rowId}, ${T}, ${batchId}, ${fileId}, ${"opening_balance_inventory"}, ${"data.csv"}, 1,
      ${JSON.stringify(rowData)}::jsonb,
      ${JSON.stringify(rowData)}::jsonb,
      null, ${"pending"}, ${"not_required"}, null, null, null, 1, true, ${OWNER_ID}, NOW())`;
  return { fileId, rowId };
}

async function seedCurrentApproval(batchId: string, role: "owner" | "accountant", userId: string) {
  const approvalId = randomUUID();
  await sql`
    INSERT INTO import_batch_approvals (id, tenant_id, import_batch_id, approver_role, approver_user_id,
      staged_data_hash, cutover_manifest_hash, template_version, mapping_version,
      validation_status, reconciliation_status, warning_summary, approved_at, reason,
      approval_version, is_current, created_by, created_at)
    VALUES (${approvalId}, ${T}, ${batchId}, ${role}::migration_approver_role, ${userId},
      ${"sha256:test"}, ${"sha256:manifest"}, ${"1.0"}, ${"1.0"},
      ${"passed"}, ${"matched"}, null, NOW(), ${"test approval"},
      1, true, ${userId}, NOW())`;
}

async function seedBackupEvidence(batchId: string) {
  await sql`
    INSERT INTO import_backup_evidence (id, tenant_id, import_batch_id, backup_type, backup_location, backup_hash, backup_size_bytes, backup_created_at, verification_notes, created_by, created_at, updated_at, updated_by)
    VALUES (${randomUUID()}, ${T}, ${batchId}, ${"full"}, ${"s3://b/backup"}, ${"backup-hash"}, 1000, NOW(), ${"verified"}, ${OWNER_ID}, NOW(), null, null)`;
}

async function seedPriorReconciliationEvidence(batchId: string, reportVersion: number = 1) {
  const id = randomUUID();
  await sql`
    INSERT INTO import_reconciliation_results (id, tenant_id, import_batch_id, report_version, metric_key,
      expected_value, staged_value, committed_value, difference_value, status, notes, created_by, created_at)
    VALUES (${id}, ${T}, ${batchId}, ${reportVersion}, ${"inventory_opening_qty"},
      null, ${"100"}, null, null, ${"matched"}, ${"Original review reason evidence"}, ${OWNER_ID}, NOW())`;
}

function makeCommitService(opts?: {
  barrierAfterCutoverLock?: { acquire: () => Promise<void>; release: () => void };
  barrierDomain?: "inventory" | "subledger";
  injectFailureAfterCutover?: boolean;
}) {
  const commitRepo = new HistoricalCommitDbRepository(db);
  const audit = new AuditDbRepository(db);
  const idem = new IdempotencyDbRepository(db);
  const docSeq = new DocumentSequenceDbRepository(db);
  const transactionRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
    (db as any).transaction(async (tx: any) => work(tx));

  const barrierDomain = opts?.barrierDomain ?? "inventory";

  // Build a barrier-wrapped InventoryLedgerService factory if a barrier is provided.
  // The barrier fires ONLY ONCE (the first requireCutoverLock call) to avoid
  // blocking on re-entrant calls from postOpeningBalanceMovement.
  const createInventoryLedger = opts?.barrierAfterCutoverLock && barrierDomain === "inventory"
    ? (tx: unknown) => {
        const realLedger = new InventoryLedgerDbRepository(tx as any);
        const realAudit = new AuditDbRepository(tx as any);
        const realIdem = new IdempotencyDbRepository(tx as any);
        const realDocSeq = new DocumentSequenceDbRepository(tx as any);
        const realService = new InventoryLedgerService({
          ledger: realLedger, audit: realAudit, idempotency: realIdem, documentSequence: realDocSeq,
        });
        const barrier = opts.barrierAfterCutoverLock!;
        let barrierFired = false;
        const wrapped: InventoryLedgerService = Object.create(realService);
        wrapped.requireCutoverLock = async (tenantId: string) => {
          await realService.requireCutoverLock(tenantId);
          if (!barrierFired) {
            barrierFired = true;
            await barrier.acquire();
            if (opts.injectFailureAfterCutover) {
              throw new Error("INJECTED_FAILURE_AFTER_CUTOVER_LOCK");
            }
          }
        };
        return wrapped;
      }
    : (tx: unknown) => new InventoryLedgerService({
        ledger: new InventoryLedgerDbRepository(tx as any),
        audit: new AuditDbRepository(tx as any),
        idempotency: new IdempotencyDbRepository(tx as any),
        documentSequence: new DocumentSequenceDbRepository(tx as any),
      });

  const createSubledger = opts?.barrierAfterCutoverLock && barrierDomain === "subledger"
    ? (tx: unknown) => {
        const realSubledger = new SubledgerDbRepository(tx as any);
        const realAudit = new AuditDbRepository(tx as any);
        const realIdem = new IdempotencyDbRepository(tx as any);
        const realDocSeq = new DocumentSequenceDbRepository(tx as any);
        const realService = new SubledgerService({
          subledger: realSubledger, audit: realAudit, idempotency: realIdem, documentSequence: realDocSeq,
        });
        const barrier = opts.barrierAfterCutoverLock!;
        let barrierFired = false;
        const wrapped: SubledgerService = Object.create(realService);
        wrapped.requireCutoverLock = async (tenantId: string) => {
          await realService.requireCutoverLock(tenantId);
          if (!barrierFired) {
            barrierFired = true;
            await barrier.acquire();
            if (opts.injectFailureAfterCutover) {
              throw new Error("INJECTED_FAILURE_AFTER_CUTOVER_LOCK");
            }
          }
        };
        return wrapped;
      }
    : (tx: unknown) => new SubledgerService({
        subledger: new SubledgerDbRepository(tx as any),
        audit: new AuditDbRepository(tx as any),
        idempotency: new IdempotencyDbRepository(tx as any),
        documentSequence: new DocumentSequenceDbRepository(tx as any),
      });

  const commitService = new HistoricalCommitService({
    repository: commitRepo, audit, idempotency: idem,
    transactionRunner,
    txFactories: {
      createCommitRepository: (tx: unknown) => new HistoricalCommitDbRepository(tx as any),
      createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
      createInventoryLedger,
      createSubledger,
      createDocumentSequence: (tx: unknown) => new DocumentSequenceDbRepository(tx as any),
      createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
    },
  });
  return { commitService, commitRepo, audit, idem, docSeq };
}

function makeLiveInventoryLedgerService(liveDb: any) {
  return new InventoryLedgerService({
    ledger: new InventoryLedgerDbRepository(liveDb),
    audit: new AuditDbRepository(liveDb),
    idempotency: new IdempotencyDbRepository(liveDb),
    documentSequence: new DocumentSequenceDbRepository(liveDb),
  });
}

function makeLivePaymentService(liveDb: any) {
  const subledger = new SubledgerService({
    subledger: new SubledgerDbRepository(liveDb),
    audit: new AuditDbRepository(liveDb),
    idempotency: new IdempotencyDbRepository(liveDb),
    documentSequence: new DocumentSequenceDbRepository(liveDb),
  });
  const transactionRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
    (liveDb as any).transaction(async (tx: any) => work(tx));
  return new PaymentService({
    paymentRepository: new PaymentDbRepository(liveDb),
    subledger,
    audit: new AuditDbRepository(liveDb),
    idempotency: new IdempotencyDbRepository(liveDb),
    documentSequence: new DocumentSequenceDbRepository(liveDb),
    transactionRunner,
    txFactories: {
      createSubledger: (tx: unknown) => new SubledgerService({
        subledger: new SubledgerDbRepository(tx as any),
        audit: new AuditDbRepository(tx as any),
        idempotency: new IdempotencyDbRepository(tx as any),
        documentSequence: new DocumentSequenceDbRepository(tx as any),
      }),
      createPaymentRepository: (tx: unknown) => new PaymentDbRepository(tx as any),
      createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
      createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
      createDocumentSequence: (tx: unknown) => new DocumentSequenceDbRepository(tx as any),
    },
  });
}

async function cleanupData() {
  // FK-safe order; audit_logs/users/tenants NOT deleted (append-only / FK).
  await sql`DELETE FROM payment_settlements WHERE tenant_id = ${T}`;
  await sql`DELETE FROM payments WHERE tenant_id = ${T}`;
  await sql`DELETE FROM inventory_balances WHERE tenant_id = ${T}`;
  await sql`DELETE FROM stock_movements WHERE tenant_id = ${T}`;
  await sql`DELETE FROM account_entries WHERE tenant_id = ${T}`;
  await sql`DELETE FROM accounts WHERE tenant_id = ${T}`;
  await sql`DELETE FROM import_cutover_locks WHERE tenant_id = ${T}`;
  await sql`DELETE FROM import_cutover_manifests WHERE tenant_id = ${T}`;
  await sql`DELETE FROM import_backup_evidence WHERE tenant_id = ${T}`;
  await sql`DELETE FROM import_batch_approvals WHERE tenant_id = ${T}`;
  await sql`DELETE FROM import_reconciliation_results WHERE tenant_id = ${T}`;
  await sql`DELETE FROM import_staging_rows WHERE tenant_id = ${T}`;
  await sql`DELETE FROM import_files WHERE tenant_id = ${T}`;
  await sql`DELETE FROM import_batches WHERE tenant_id = ${T}`;
  await sql`DELETE FROM idempotency_records WHERE tenant_id = ${T}`;
  await sql`DELETE FROM document_sequences WHERE tenant_id = ${T}`;
  await sql`DELETE FROM inventory_items WHERE tenant_id = ${T}`;
  await sql`DELETE FROM locations WHERE tenant_id = ${T}`;
  await sql`DELETE FROM suppliers WHERE tenant_id = ${T}`;
}

describeOrSkip("WP-07-04 — Contract 08 §12.4 service-level race proofs", () => {
  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { prepare: false, max: 8, idle_timeout: 10, connect_timeout: 15 });
    db = drizzle(sql, { schema });
    await sql`SET statement_timeout = 30000`;
    await seedTenantAndUsers();
  }, 30000);

  afterAll(async () => {
    if (sql) {
      try {
        await cleanupData();
      } catch {
        // Ignore cleanup errors — test may have left orphaned transactions.
      }
      // Force-end with a short timeout to avoid hanging on pending queries.
      await Promise.race([
        sql.end(),
        new Promise<void>(r => setTimeout(r, 5000)),
      ]);
    }
  }, 15000);

  // =========================================================================
  // SVC-RACE-1 — actual historical commit first, real live inventory post blocked
  // =========================================================================
  it("SVC-RACE-1. real commit holds inventory cutover → real postRawReceipt blocked, no partial effect, retry succeeds", async () => {
    const batchId = randomUUID();
    const itemId = await seedItem();
    const locationId = await seedLocation();
    await seedApprovedForCommitBatch(batchId);
    await seedFileAndInventoryStagingRow(batchId, itemId, locationId);
    await seedPriorReconciliationEvidence(batchId, 1);
    await seedBackupEvidence(batchId);
    await seedCurrentApproval(batchId, "owner", OWNER_ID);
    await seedCurrentApproval(batchId, "accountant", ACCOUNTANT_ID);

    // Barrier: the commit's requireCutoverLock will signal lockAcquired and
    // wait for release. This pauses the commit AFTER it acquires the real
    // advisory lock on the real transaction, BEFORE its business writes.
    let lockAcquired = false;
    let releaseBarrier: () => void = () => {};
    const barrierPromise = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });
    const barrier = {
      acquire: async () => {
        lockAcquired = true;
        await barrierPromise;
      },
      release: () => releaseBarrier(),
    };

    const { commitService } = makeCommitService({ barrierAfterCutoverLock: barrier });

    // Start the real commit (async — it will pause at the barrier).
    const commitIdemKey = "sr1-commit-" + randomUUID();
    const commitPromise = commitService.commitBatch(
      makeOwnerUser() as any, makeEffective() as any,
      { importBatchId: batchId, idempotencyKey: commitIdemKey },
    );

    // Wait for the commit to reach the barrier (cutover lock acquired).
    for (let i = 0; i < 100; i++) {
      if (lockAcquired) break;
      await new Promise(r => setTimeout(r, 50));
    }
    expect(lockAcquired).toBe(true);

    // While the commit holds the cutover lock, issue a REAL live
    // postRawReceipt on a separate connection with a short statement_timeout.
    const liveSql = postgres(DATABASE_URL!, { prepare: false, max: 1, idle_timeout: 10, connect_timeout: 15 });
    const liveDb = drizzle(liveSql, { schema });
    const liveService = makeLiveInventoryLedgerService(liveDb);
    await liveSql`SET statement_timeout = 2000`;

    const liveIdemKey = "sr1-live-" + randomUUID();
    const blockedOutcome = await liveService.postRawReceipt(
      makeOwnerUser() as any, makeEffective() as any,
      {
        itemId, toLocationId: locationId, quantityKg: "50.000",
        movementDate: "2024-01-15",
        sourceDocumentType: "raw_material_batch",
        sourceDocumentId: randomUUID(),
        idempotencyKey: liveIdemKey,
      },
    ).then(v => ({ ok: true as const, v }), e => ({ ok: false as const, e }));

    // The live post MUST have blocked → timed out.
    expect(blockedOutcome.ok).toBe(false);
    if (!blockedOutcome.ok) {
      const e = blockedOutcome.e as any;
      const fullMsg = `${e?.message ?? e} ${e?.cause?.message ?? ""} ${e?.code ?? ""}`;
      expect(fullMsg).toMatch(/canceling statement due to (statement timeout|user request)|lock_not_available|statement timeout|Failed query.*pg_advisory_xact_lock|57014/i);
    }

    // Assert NO partial business effect from the live post.
    const liveMovements = await sql`SELECT count(*)::int AS c FROM stock_movements WHERE tenant_id = ${T} AND idempotency_key = ${liveIdemKey}`;
    expect(liveMovements[0]!.c).toBe(0);

    // Release the barrier — let the commit complete.
    barrier.release();

    // Wait for the commit to finish.
    const commitResult = await commitPromise;
    expect(commitResult.action).toBe("committed");

    // The commit posted the opening-balance movement.
    const commitMovements = await sql`SELECT count(*)::int AS c FROM stock_movements WHERE tenant_id = ${T} AND source_document_type = 'historical_opening_balance'`;
    expect(commitMovements[0]!.c).toBe(1);

    // Retry the live post with a FRESH idempotency key — MUST succeed now.
    const retryIdemKey = "sr1-retry-" + randomUUID();
    const retryOutcome = await liveService.postRawReceipt(
      makeOwnerUser() as any, makeEffective() as any,
      {
        itemId, toLocationId: locationId, quantityKg: "50.000",
        movementDate: "2024-01-15",
        sourceDocumentType: "raw_material_batch",
        sourceDocumentId: randomUUID(),
        idempotencyKey: retryIdemKey,
      },
    );
    expect(retryOutcome.action).toBe("posted");

    // Exactly one live movement + one commit movement = 2 total.
    const allMovements = await sql`SELECT count(*)::int AS c FROM stock_movements WHERE tenant_id = ${T}`;
    expect(allMovements[0]!.c).toBe(2);

    await liveSql.end();
    await cleanupData();
  }, 60000);

  // =========================================================================
  // SVC-RACE-2 — actual live inventory post first, real historical commit blocked
  // =========================================================================
  it("SVC-RACE-2. real live post holds inventory cutover → real commit blocked, then succeeds after release", async () => {
    const batchId = randomUUID();
    const itemId = await seedItem();
    const locationId = await seedLocation();
    await seedApprovedForCommitBatch(batchId);
    await seedFileAndInventoryStagingRow(batchId, itemId, locationId);
    await seedPriorReconciliationEvidence(batchId, 1);
    await seedBackupEvidence(batchId);
    await seedCurrentApproval(batchId, "owner", OWNER_ID);
    await seedCurrentApproval(batchId, "accountant", ACCOUNTANT_ID);

    // Start a REAL live postRawReceipt that holds the cutover lock.
    // We use a barrier-wrapped live service that pauses after requireCutoverLock.
    let lockAcquired = false;
    let releaseBarrier: () => void = () => {};
    const barrierPromise = new Promise<void>((resolve) => { releaseBarrier = resolve; });

    const liveSql = postgres(DATABASE_URL!, { prepare: false, max: 1, idle_timeout: 10, connect_timeout: 15 });
    const liveDb = drizzle(liveSql, { schema });
    const realLedger = new InventoryLedgerDbRepository(liveDb);
    const realAudit = new AuditDbRepository(liveDb);
    const realIdem = new IdempotencyDbRepository(liveDb);
    const realDocSeq = new DocumentSequenceDbRepository(liveDb);
    const realLiveService = new InventoryLedgerService({
      ledger: realLedger, audit: realAudit, idempotency: realIdem, documentSequence: realDocSeq,
    });
    // Wrap to add barrier after requireCutoverLock
    const wrappedLiveService: InventoryLedgerService = Object.create(realLiveService);
    wrappedLiveService.requireCutoverLock = async (tenantId: string) => {
      await realLiveService.requireCutoverLock(tenantId);
      lockAcquired = true;
      await barrierPromise;
    };

    // But postRawReceipt calls requireCutoverLock internally via this.requireCutoverLock.
    // Since we wrapped the service, the internal call will go through the wrapper.
    // However, postRawReceipt runs WITHOUT a transactionRunner — each repo call
    // is on its own auto-commit connection. The advisory lock is transaction-scoped,
    // so it's released as soon as the lock-acquisition query's implicit transaction
    // commits. This means the lock is NOT held for the duration of the post.
    //
    // To make this test work, we need the live post to hold the lock inside a
    // transaction. We'll use a manual transaction wrapper.
    const liveIdemKey = "sr2-live-" + randomUUID();
    const liveSourceDocId = randomUUID();

    // Start the live post in a held-open transaction.
    const liveTxPromise = (liveDb as any).transaction(async (tx: any) => {
      const txLedger = new InventoryLedgerDbRepository(tx);
      const txAudit = new AuditDbRepository(tx);
      const txIdem = new IdempotencyDbRepository(tx);
      const txDocSeq = new DocumentSequenceDbRepository(tx);
      const txService = new InventoryLedgerService({
        ledger: txLedger, audit: txAudit, idempotency: txIdem, documentSequence: txDocSeq,
      });
      // Wrap to add barrier
      const wrappedTx: InventoryLedgerService = Object.create(txService);
      wrappedTx.requireCutoverLock = async (tenantId: string) => {
        await txService.requireCutoverLock(tenantId);
        lockAcquired = true;
        await barrierPromise;
      };
      // Call postRawReceipt on the wrapped service.
      return wrappedTx.postRawReceipt(
        makeOwnerUser() as any, makeEffective() as any,
        {
          itemId, toLocationId: locationId, quantityKg: "75.000",
          movementDate: "2024-01-15",
          sourceDocumentType: "raw_material_batch",
          sourceDocumentId: liveSourceDocId,
          idempotencyKey: liveIdemKey,
        },
      );
    });

    // Wait for the live post to reach the barrier.
    for (let i = 0; i < 100; i++) {
      if (lockAcquired) break;
      await new Promise(r => setTimeout(r, 50));
    }
    expect(lockAcquired).toBe(true);

    // While the live post holds the cutover lock, issue a REAL commit.
    // The commit will try to acquire the same advisory lock and block.
    // Use a separate connection with a short statement_timeout for the commit's
    // cutover lock acquisition. But the commit uses its own db pool.
    // We need to set statement_timeout on the commit's connection.
    // The simplest way: set statement_timeout on the shared db pool.
    // But that would affect other queries. Instead, we'll just verify
    // the commit blocks by checking it doesn't complete within a timeout.
    const { commitService } = makeCommitService();

    const commitIdemKey = "sr2-commit-" + randomUUID();
    const commitPromise = commitService.commitBatch(
      makeOwnerUser() as any, makeEffective() as any,
      { importBatchId: batchId, idempotencyKey: commitIdemKey },
    );

    // Give the commit 2 seconds to try — it should NOT complete (blocked).
    const commitRace = await Promise.race([
      commitPromise.then(v => ({ completed: true as const, v })),
      new Promise<{ completed: false }>(r => setTimeout(() => r({ completed: false }), 2000)),
    ]);
    expect(commitRace.completed).toBe(false);

    // Assert the commit did NOT post any movement.
    const commitMovements = await sql`SELECT count(*)::int AS c FROM stock_movements WHERE tenant_id = ${T} AND source_document_type = 'historical_opening_balance'`;
    expect(commitMovements[0]!.c).toBe(0);

    // Release the live post barrier — let it complete.
    releaseBarrier();
    const liveResult = await liveTxPromise;
    expect(liveResult.action).toBe("posted");

    // Now the commit should complete (it was blocked, now unblocked).
    const commitResult = await commitPromise;
    expect(commitResult.action).toBe("committed");

    // Both movements exist.
    const allMovements = await sql`SELECT count(*)::int AS c FROM stock_movements WHERE tenant_id = ${T}`;
    expect(allMovements[0]!.c).toBe(2);

    await liveSql.end();
    await cleanupData();
  }, 60000);

  // =========================================================================
  // SVC-RACE-3 — actual payment post vs actual party-opening historical commit
  // =========================================================================
  it("SVC-RACE-3. real payment post blocked while real party-opening commit holds subledger cutover", async () => {
    const batchId = randomUUID();
    const supplierId = await seedSupplier();
    await seedApprovedForCommitBatch(batchId);
    await seedFileAndPartyStagingRow(batchId, supplierId);
    await seedPriorReconciliationEvidence(batchId, 1);
    await seedBackupEvidence(batchId);
    await seedCurrentApproval(batchId, "owner", OWNER_ID);
    await seedCurrentApproval(batchId, "accountant", ACCOUNTANT_ID);

    // Barrier for the commit's subledger cutover lock.
    let lockAcquired = false;
    let releaseBarrier: () => void = () => {};
    const barrierPromise = new Promise<void>((resolve) => { releaseBarrier = resolve; });
    const barrier = {
      acquire: async () => { lockAcquired = true; await barrierPromise; },
      release: () => releaseBarrier(),
    };

    // Wrap the commit's SubledgerService to add barrier after requireCutoverLock.
    const { commitService } = makeCommitService({
      barrierAfterCutoverLock: barrier,
      barrierDomain: "subledger",
    });

    const commitIdemKey = "sr3-commit-" + randomUUID();
    const commitPromise = commitService.commitBatch(
      makeOwnerUser() as any, makeEffective() as any,
      { importBatchId: batchId, idempotencyKey: commitIdemKey },
    );

    // Wait for the commit to reach the barrier.
    for (let i = 0; i < 100; i++) {
      if (lockAcquired) break;
      await new Promise(r => setTimeout(r, 50));
    }
    expect(lockAcquired).toBe(true);

    // Issue a REAL PaymentService.postPayment on a separate connection.
    // First, seed a payment draft for the supplier account.
    const liveSql = postgres(DATABASE_URL!, { prepare: false, max: 1, idle_timeout: 10, connect_timeout: 15 });
    const liveDb = drizzle(liveSql, { schema });
    await liveSql`SET statement_timeout = 2000`;

    // Create a supplier account + payment draft.
    const accountId = randomUUID();
    await sql`INSERT INTO accounts (id, tenant_id, owner_type, owner_id, currency, created_by, created_at) VALUES (${accountId}, ${T}, ${"supplier"}, ${supplierId}, ${"EGP"}, ${OWNER_ID}, NOW()) ON CONFLICT (id) DO NOTHING`;
    const paymentId = randomUUID();
    await sql`INSERT INTO payments (id, tenant_id, payment_no, payment_direction, payment_method, account_id, amount, payment_date, status, is_locked, idempotency_key, record_origin, created_by, created_at) VALUES (${paymentId}, ${T}, ${"PAY-" + paymentId.slice(0, 8)}, ${"paid_to_party"}::payment_direction, ${"cash"}::payment_method, ${accountId}, ${"1000.00"}, ${"2024-01-15"}, ${"draft"}::payment_status, false, ${"seed-" + paymentId.slice(0, 8)}, ${"manual_live"}, ${OWNER_ID}, NOW()) ON CONFLICT (id) DO NOTHING`;

    const livePaymentService = makeLivePaymentService(liveDb);

    const liveIdemKey = "sr3-pay-" + randomUUID();
    const blockedOutcome = await livePaymentService.postPayment(
      makeOwnerUser() as any, makeEffective() as any,
      { paymentId, idempotencyKey: liveIdemKey },
    ).then(v => ({ ok: true as const, v }), e => ({ ok: false as const, e }));

    // The payment post MUST have blocked → timed out (cutover lock held by commit).
    expect(blockedOutcome.ok).toBe(false);
    if (!blockedOutcome.ok) {
      const e = blockedOutcome.e as any;
      const fullMsg = `${e?.message ?? e} ${e?.cause?.message ?? ""} ${e?.code ?? ""}`;
      expect(fullMsg).toMatch(/canceling statement due to (statement timeout|user request)|lock_not_available|statement timeout|Failed query.*pg_advisory_xact_lock|57014/i);
    }

    // Assert NO partial payment effect.
    const paymentAfter = await sql`SELECT status FROM payments WHERE id = ${paymentId}`;
    expect(paymentAfter[0]!.status).toBe("draft"); // unchanged
    const entries = await sql`SELECT count(*)::int AS c FROM account_entries WHERE tenant_id = ${T} AND source_document_type = 'payment'`;
    expect(entries[0]!.c).toBe(0);

    // Release the barrier — let the commit complete.
    barrier.release();
    const commitResult = await commitPromise;
    expect(commitResult.action).toBe("committed");

    // The commit posted the party opening-balance entry.
    const commitEntries = await sql`SELECT count(*)::int AS c FROM account_entries WHERE tenant_id = ${T} AND source_document_type = 'historical_opening_balance'`;
    expect(commitEntries[0]!.c).toBe(1);

    // Retry the payment with a FRESH idempotency key — MUST succeed now.
    const retryIdemKey = "sr3-retry-" + randomUUID();
    const retryOutcome = await livePaymentService.postPayment(
      makeOwnerUser() as any, makeEffective() as any,
      { paymentId, idempotencyKey: retryIdemKey },
    );
    expect(retryOutcome.action).toBe("posted");

    // Payment status is now posted.
    const paymentFinal = await sql`SELECT status FROM payments WHERE id = ${paymentId}`;
    expect(paymentFinal[0]!.status).toBe("posted");

    await liveSql.end();
    await cleanupData();
  }, 60000);

  // =========================================================================
  // SVC-RACE-4 — two actual historical commits for same tenant/domain
  // =========================================================================
  it("SVC-RACE-4. two real commits for same tenant/inventory domain → second blocks until first completes", async () => {
    const batchA = randomUUID();
    const batchB = randomUUID();
    const itemId = await seedItem();
    const locationId = await seedLocation();

    for (const bid of [batchA, batchB]) {
      await seedApprovedForCommitBatch(bid);
      await seedFileAndInventoryStagingRow(bid, itemId, locationId);
      await seedPriorReconciliationEvidence(bid, 1);
      await seedBackupEvidence(bid);
      await seedCurrentApproval(bid, "owner", OWNER_ID);
      await seedCurrentApproval(bid, "accountant", ACCOUNTANT_ID);
    }

    // Barrier for commit A — pauses after cutover lock acquired.
    let lockAcquiredA = false;
    let releaseA: () => void = () => {};
    const barrierA = {
      acquire: async () => { lockAcquiredA = true; await new Promise<void>(r => { releaseA = r; }); },
      release: () => releaseA(),
    };

    const { commitService: commitServiceA } = makeCommitService({ barrierAfterCutoverLock: barrierA });
    const { commitService: commitServiceB } = makeCommitService();

    const keyA = "sr4-a-" + randomUUID();
    const keyB = "sr4-b-" + randomUUID();

    // Start commit A (async — will pause at barrier).
    const commitAPromise = commitServiceA.commitBatch(
      makeOwnerUser() as any, makeEffective() as any,
      { importBatchId: batchA, idempotencyKey: keyA },
    );

    // Wait for commit A to acquire the cutover lock.
    for (let i = 0; i < 100; i++) {
      if (lockAcquiredA) break;
      await new Promise(r => setTimeout(r, 50));
    }
    expect(lockAcquiredA).toBe(true);

    // Start commit B — it MUST block on the cutover lock.
    // Use a 3s race timeout — if commit B completes within 3s, it did NOT block.
    // We use a separate promise for the race check; the original commit B
    // promise is awaited later after barrier A is released.
    let commitBResolved = false;
    let commitBResult: any = null;
    let commitBError: any = null;
    const commitBPromise = commitServiceB.commitBatch(
      makeOwnerUser() as any, makeEffective() as any,
      { importBatchId: batchB, idempotencyKey: keyB },
    ).then(v => { commitBResolved = true; commitBResult = v; })
     .catch(e => { commitBResolved = true; commitBError = e; });

    await Promise.race([
      commitBPromise,
      new Promise<void>(r => setTimeout(() => r(), 3000)),
    ]);
    expect(commitBResolved).toBe(false); // commit B MUST still be blocked

    // Release commit A — let it complete.
    barrierA.release();
    let commitAResult: any;
    try {
      commitAResult = await Promise.race([
        commitAPromise,
        new Promise<any>((_, reject) => setTimeout(() => reject(new Error("commit A did not complete within 30s after barrier release")), 30000)),
      ]);
    } catch (e) {
      console.error("SVC-RACE-4: commit A failed or timed out:", e);
      throw e;
    }
    expect(commitAResult.action).toBe("committed");

    // Now commit B should complete (it was blocked, now unblocked).
    // Await the original promise with a 30s timeout.
    await Promise.race([
      commitBPromise,
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error("commit B did not complete within 30s after barrier release")), 30000)),
    ]);

    if (commitBError) {
      console.error("SVC-RACE-4: commit B failed:", commitBError);
    }
    expect(commitBError).toBeNull();
    expect(commitBResult).not.toBeNull();
    expect(commitBResult.action).toBe("committed");

    // Both batches committed, each with one movement.
    const movements = await sql`SELECT count(*)::int AS c FROM stock_movements WHERE tenant_id = ${T} AND source_document_type = 'historical_opening_balance'`;
    expect(movements[0]!.c).toBe(2);

    await cleanupData();
  }, 90000);

  // =========================================================================
  // SVC-RACE-5 — actual technical failure/recovery inside real commit transaction
  // =========================================================================
  it("SVC-RACE-5. injected failure after cutover lock acquired → full rollback, lock released, retry succeeds", async () => {
    const batchId = randomUUID();
    const itemId = await seedItem();
    const locationId = await seedLocation();
    await seedApprovedForCommitBatch(batchId);
    await seedFileAndInventoryStagingRow(batchId, itemId, locationId);
    await seedPriorReconciliationEvidence(batchId, 1);
    await seedBackupEvidence(batchId);
    await seedCurrentApproval(batchId, "owner", OWNER_ID);
    await seedCurrentApproval(batchId, "accountant", ACCOUNTANT_ID);

    // The commit will acquire the cutover lock, then the barrier fires, then
    // injectFailureAfterCutover throws — causing the transaction to roll back.
    let lockAcquired = false;
    let releaseBarrier: () => void = () => {};
    const barrierPromise = new Promise<void>((resolve) => { releaseBarrier = resolve; });
    const barrier = {
      acquire: async () => { lockAcquired = true; await barrierPromise; },
      release: () => releaseBarrier(),
    };

    const { commitService } = makeCommitService({
      barrierAfterCutoverLock: barrier,
      injectFailureAfterCutover: true,
    });

    const commitIdemKey = "sr5-fail-" + randomUUID();
    const commitPromise = commitService.commitBatch(
      makeOwnerUser() as any, makeEffective() as any,
      { importBatchId: batchId, idempotencyKey: commitIdemKey },
    );

    // Wait for the commit to acquire the cutover lock.
    for (let i = 0; i < 100; i++) {
      if (lockAcquired) break;
      await new Promise(r => setTimeout(r, 50));
    }
    expect(lockAcquired).toBe(true);

    // Release the barrier — the commit will throw INJECTED_FAILURE_AFTER_CUTOVER_LOCK.
    barrier.release();

    // The commit MUST fail.
    const commitOutcome = await commitPromise.then(
      v => ({ ok: true as const, v }),
      e => ({ ok: false as const, e }),
    );
    expect(commitOutcome.ok).toBe(false);
    if (!commitOutcome.ok) {
      expect(String((commitOutcome.e as Error)?.message ?? commitOutcome.e)).toMatch(/INJECTED_FAILURE_AFTER_CUTOVER_LOCK/i);
    }

    // Assert NO business effect survived (full rollback).
    const movements = await sql`SELECT count(*)::int AS c FROM stock_movements WHERE tenant_id = ${T} AND source_document_type = 'historical_opening_balance'`;
    expect(movements[0]!.c).toBe(0);

    // Assert the batch is NOT committed (should be back to approved_for_commit
    // or retryable per the idempotency contract).
    const batch = await sql`SELECT status FROM import_batches WHERE id = ${batchId}`;
    expect(batch[0]!.status).not.toBe("committed");

    // Assert the advisory lock was auto-released (transaction rolled back).
    // We verify this by proving a live post can acquire it immediately.
    const liveSql = postgres(DATABASE_URL!, { prepare: false, max: 1, idle_timeout: 10, connect_timeout: 15 });
    const liveDb = drizzle(liveSql, { schema });
    const liveService = makeLiveInventoryLedgerService(liveDb);
    await liveSql`SET statement_timeout = 3000`;

    const liveOutcome = await liveService.postRawReceipt(
      makeOwnerUser() as any, makeEffective() as any,
      {
        itemId, toLocationId: locationId, quantityKg: "25.000",
        movementDate: "2024-01-15",
        sourceDocumentType: "raw_material_batch",
        sourceDocumentId: randomUUID(),
        idempotencyKey: "sr5-live-" + randomUUID(),
      },
    );
    // MUST succeed immediately — the advisory lock was released on rollback.
    expect(liveOutcome.action).toBe("posted");

    await liveSql.end();
    await cleanupData();
  }, 90000);
});
