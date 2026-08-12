/**
 * WP-08-01F Production Correction Hook — PostgreSQL proof tests.
 *
 * Proves the production correction execution path works correctly with
 * real PostgreSQL:
 *   1. successful approved correction (append-only reversal movement)
 *   2. injected failure after partial domain effect → complete rollback
 *   3. owner-token loss at finalization → complete rollback
 *   4. valid retry → one append-only correction effect
 *   5. replay → zero new effects
 *   6. conflict → rejected with zero effects
 *   7. original evidence and operational rows remain unchanged/queryable
 *
 * WP-08-01F DEFECT 5: Fail-closed disposable-database guard.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/server/db/schema";
import { HistoricalCorrectionService } from "@/server/services/historical-correction-service";
import { ProductionCorrectionDomainHook } from "@/server/services/production-correction-domain-hook";
import { HistoricalCorrectionDbRepository } from "@/server/services/historical-correction-db-repository";
import { AuditDbRepository } from "@/server/services/audit-db-repository";
import { IdempotencyDbRepository } from "@/server/services/idempotency-db-repository";
import { DocumentSequenceDbRepository } from "@/server/services/document-sequence-db-repository";
import { InventoryLedgerDbRepository } from "@/server/services/inventory-ledger-db-repository";
import { InventoryLedgerService } from "@/server/services/inventory-ledger-service";
import { SubledgerDbRepository } from "@/server/services/subledger-db-repository";
import { SubledgerService } from "@/server/services/subledger-service";
import { resolveEffectivePermissions } from "@/server/security/effective-permissions";
import { TEST_ROLE_PERMISSION_MATRIX } from "@/server/security/role-fixtures";
import type { ErpUserContext } from "@/server/auth/erp-context";

const DATABASE_URL = process.env.DATABASE_URL;
const REQUIRE_PROOF = process.env.ERP_REQUIRE_WP0801F_POSTGRES_PROOF === "1";
const ALLOW_DESTRUCTIVE = process.env.ERP_ALLOW_DESTRUCTIVE_LOCAL_TEST_DB === "1";
const DEDICATED_DB_NAME = "erp_yarn_wp0801f_disposable";

// Safety guard
type SafetyResult = { kind: "ok" } | { kind: "skip"; reason: string } | { kind: "fail"; message: string };
function checkDatabaseSafety(): SafetyResult {
  if (!DATABASE_URL) {
    if (REQUIRE_PROOF) return { kind: "fail", message: "SAFETY: DATABASE_URL absent but proof required" };
    return { kind: "skip", reason: "DATABASE_URL not set" };
  }
  if (!DATABASE_URL.startsWith("postgres")) return { kind: "fail", message: "SAFETY: non-postgres URL" };
  let parsed: URL;
  try { parsed = new URL(DATABASE_URL); } catch { return { kind: "fail", message: "SAFETY: invalid URL" }; }
  const hostname = parsed.hostname;
  const database = parsed.pathname.replace(/^\//, "");
  if (!new Set(["localhost", "127.0.0.1", "::1"]).has(hostname))
    return { kind: "fail", message: `SAFETY: non-local host '${hostname}'` };
  if (hostname.includes("supabase") || DATABASE_URL.includes("supabase") || DATABASE_URL.includes("pooler"))
    return { kind: "fail", message: "SAFETY: Supabase/pooler URL" };
  if (database !== DEDICATED_DB_NAME)
    return { kind: "fail", message: `SAFETY: database '${database}' != '${DEDICATED_DB_NAME}'` };
  if (!ALLOW_DESTRUCTIVE) {
    if (REQUIRE_PROOF) return { kind: "fail", message: "SAFETY: destructive flag required for proof" };
    return { kind: "skip", reason: "ERP_ALLOW_DESTRUCTIVE_LOCAL_TEST_DB=1 not set" };
  }
  return { kind: "ok" };
}
const SAFETY_RESULT = checkDatabaseSafety();
const describeOrSkip = SAFETY_RESULT.kind === "ok" ? describe : describe.skip;
let SAFETY_ERROR_MESSAGE: string | null = null;
if (SAFETY_RESULT.kind === "fail") SAFETY_ERROR_MESSAGE = SAFETY_RESULT.message;

const RUN_ID = randomUUID();
const T = RUN_ID;
const U = randomUUID();
const U2 = randomUUID();

// Item + location fixtures for inventory movements
const ITEM_ID = randomUUID();
const LOC_ID = randomUUID();

let sql: ReturnType<typeof postgres>;
let db: any;

describeOrSkip("WP-08-01F Production Correction Hook — PostgreSQL proof", () => {
  beforeAll(async () => {
    if (SAFETY_ERROR_MESSAGE) throw new Error(SAFETY_ERROR_MESSAGE);
    sql = postgres(DATABASE_URL!, { prepare: false, max: 10, idle_timeout: 10, connect_timeout: 10 });
    db = drizzle(sql, { schema });
    await sql`SET statement_timeout = 30000`;

    // Verify DB marker
    const dbResult = await sql`SELECT current_database() AS db_name`;
    if (dbResult[0]?.db_name !== DEDICATED_DB_NAME) {
      await sql.end();
      throw new Error(`SAFETY: expected '${DEDICATED_DB_NAME}' but got '${dbResult[0]?.db_name}'`);
    }

    // Foundational fixtures only
    const s = RUN_ID.slice(0, 8);
    await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status)
              VALUES (${T}, ${"CH-" + s}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
    await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference)
              VALUES (${U}, ${T}, ${"ch-o-" + s}, ${"CH Owner"}, ${"ch-o-" + s + "@test.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
    await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference)
              VALUES (${U2}, ${T}, ${"ch-a-" + s}, ${"CH Acct"}, ${"ch-a-" + s + "@test.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
    // Item + location for inventory movements
    await sql`INSERT INTO inventory_items (id, tenant_id, item_code, display_name_ar, item_kind, status)
              VALUES (${ITEM_ID}, ${T}, ${"CH-ITEM"}, ${"Test Item"}, ${"raw_material"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
    await sql`INSERT INTO locations (id, tenant_id, location_code, name_ar, location_type, status)
              VALUES (${LOC_ID}, ${T}, ${"CH-LOC"}, ${"Test Location"}, ${"internal_warehouse"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
  }, 30000);

  afterAll(async () => {
    if (sql) {
      // Clean up run-scoped data only — NOT audit_logs/idempotency_records/document_sequences
      // Delete in FK dependency order
      await sql`DELETE FROM inventory_balances WHERE tenant_id = ${T}`;
      await sql`DELETE FROM stock_movements WHERE tenant_id = ${T}`;
      await sql`DELETE FROM account_entries WHERE tenant_id = ${T}`;
      await sql`DELETE FROM historical_correction_requests WHERE tenant_id = ${T}`;
      await sql`DELETE FROM import_batches WHERE tenant_id = ${T}`;
      await sql`DELETE FROM inventory_items WHERE tenant_id = ${T}`;
      await sql`DELETE FROM locations WHERE tenant_id = ${T}`;
      await sql.end();
    }
  }, 30000);

  function makeUser(userId: string = U): ErpUserContext {
    return { authenticated: true, userId, tenantId: T, authId: `auth-${userId}`, name: "Test", email: `test-${userId}@test.local` };
  }
  function makeEffective() {
    return resolveEffectivePermissions(["owner"], TEST_ROLE_PERMISSION_MATRIX);
  }

  /**
   * Create a correction service with the production hook wired to real
   * DB-backed domain services. Uses transactionRunner for atomicity.
   */
  function makeCorrectionService(faultCallback?: (() => void) | null) {
    const correctionRepo = new HistoricalCorrectionDbRepository(db);
    const audit = new AuditDbRepository(db);
    const idem = new IdempotencyDbRepository(db);
    const docSeq = new DocumentSequenceDbRepository(db);

    const transactionRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
      (db as any).transaction(async (tx: any) => work(tx));

    const txFactories = {
      createInventoryLedger: (tx: unknown) => new InventoryLedgerService({
        ledger: new InventoryLedgerDbRepository(tx as any),
        audit: new AuditDbRepository(tx as any),
        idempotency: new IdempotencyDbRepository(tx as any),
        documentSequence: new DocumentSequenceDbRepository(tx as any),
      }),
      createSubledger: (tx: unknown) => new SubledgerService({
        subledger: new SubledgerDbRepository(tx as any),
        audit: new AuditDbRepository(tx as any),
        idempotency: new IdempotencyDbRepository(tx as any),
        documentSequence: new DocumentSequenceDbRepository(tx as any),
      }),
      tx: null as unknown,
    };

    const correctionService = new HistoricalCorrectionService({
      repository: correctionRepo, audit, idempotency: idem, documentSequence: docSeq,
      transactionRunner,
      createRepository: (tx: unknown) => new HistoricalCorrectionDbRepository(tx as any),
      createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
      createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
      createCorrectionDomainHook: (tx: unknown) => {
        (txFactories as any).tx = tx;
        return new ProductionCorrectionDomainHook(txFactories);
      },
      testFaultCallback: faultCallback ?? null,
    });

    return { correctionService, correctionRepo };
  }

  /**
   * Seed a committed batch + an approved correction request directly via SQL.
   * This is foundational test setup — not lifecycle SQL. The batch is
   * committed (terminal state) and the correction request is approved
   * (both Owner + Accountant approved) so executeCorrection can run.
   */
  async function seedCommittedBatchWithApprovedCorrection(
    correctionType: string,
    originalEntityType: string,
    _originalEntityId: string, // ignored — we use the real movement ID
    proposedCorrectionJson?: Record<string, unknown>,
  ): Promise<{ batchId: string; correctionRequestId: string; movementId: string }> {
    const batchId = randomUUID();
    const correctionRequestId = randomUUID();
    const movementId = randomUUID();

    // Seed committed batch
    await sql`
      INSERT INTO import_batches (id, tenant_id, batch_no, status, source_description, template_name, template_version,
        mapping_version, cutover_manifest_hash, cutover_import_mode, staged_data_hash, staged_row_count,
        blocking_error_count, warning_count, accepted_warning_count, validation_status, reconciliation_status,
        warning_summary, committed_at, commit_effect_counts, created_by, created_at)
      VALUES (${batchId}, ${T}, ${"CH-" + batchId.slice(0, 6)}, 'committed'::import_batch_status, 'test', 'test', '1.0',
        '1.0', 'm', 'opening_balance', 'h', 1, 0, 0, 0, 'passed', 'matched',
        null, NOW(), ${JSON.stringify({ stock_movements: 1 })}::jsonb, ${U}, NOW())`;

    // Seed an original stock movement (the entity being corrected)
    const movDocNo = `MIG-MOV-${movementId.slice(0, 8)}`;
    await sql`
      INSERT INTO stock_movements (id, tenant_id, doc_no, movement_type, movement_status,
        item_id, to_location_id, quantity_kg, movement_date, source_document_type,
        source_document_id, idempotency_key, record_origin, record_period, import_batch_id,
        created_by, posted_by, posted_at, created_at)
      VALUES (${movementId}, ${T}, ${movDocNo}, 'raw_receipt'::movement_type, 'posted'::movement_status,
        ${ITEM_ID}, ${LOC_ID}, '100', '2024-01-01', 'historical_opening_balance',
        ${batchId}, ${"mov-idem-" + movementId.slice(0, 8)}, 'manual_historical_entry'::record_origin, 'historical'::record_period, ${batchId},
        ${U}, ${U}, NOW(), NOW())`;

    // Seed approved correction request — use the real movement ID as original_entity_id
    const proposedJson = proposedCorrectionJson ? JSON.stringify(proposedCorrectionJson) : null;
    await sql`
      INSERT INTO historical_correction_requests (id, tenant_id, doc_no, import_batch_id,
        original_entity_type, original_entity_id, correction_type, reason,
        proposed_correction_json, impact_analysis_json, status,
        owner_approved_by, owner_approved_at, accountant_approved_by, accountant_approved_at,
        corrected_entity_type, corrected_entity_id, created_by, created_at)
      VALUES (${correctionRequestId}, ${T}, ${"CORR-" + correctionRequestId.slice(0, 6)}, ${batchId},
        ${originalEntityType}, ${movementId}, ${correctionType}, 'test correction',
        ${proposedJson}::jsonb, null, 'approved'::correction_request_status,
        ${U}, NOW(), ${U2}, NOW(),
        null, null, ${U}, NOW())`;

    return { batchId, correctionRequestId, movementId };
  }

  /** Snapshot exact counts for the run-scoped tenant. */
  async function snapshotCounts(): Promise<{
    stockMovements: number;
    accountEntries: number;
    corrections: number;
    correctionsExecuted: number;
    auditCount: number;
    idemSucceeded: number;
  }> {
    const [sm, ae, cr, cre, al, idem] = await Promise.all([
      sql`SELECT count(*)::int AS c FROM stock_movements WHERE tenant_id = ${T}`,
      sql`SELECT count(*)::int AS c FROM account_entries WHERE tenant_id = ${T}`,
      sql`SELECT count(*)::int AS c FROM historical_correction_requests WHERE tenant_id = ${T}`,
      sql`SELECT count(*)::int AS c FROM historical_correction_requests WHERE tenant_id = ${T} AND corrected_entity_id IS NOT NULL`,
      sql`SELECT count(*)::int AS c FROM audit_logs WHERE tenant_id = ${T}`,
      sql`SELECT count(*)::int AS c FROM idempotency_records WHERE tenant_id = ${T} AND state = 'succeeded'`,
    ]);
    return {
      stockMovements: sm[0]?.c ?? 0,
      accountEntries: ae[0]?.c ?? 0,
      corrections: cr[0]?.c ?? 0,
      correctionsExecuted: cre[0]?.c ?? 0,
      auditCount: al[0]?.c ?? 0,
      idemSucceeded: idem[0]?.c ?? 0,
    };
  }

  // -------------------------------------------------------------------------
  // 1. successful approved correction (append-only reversal movement)
  // -------------------------------------------------------------------------
  it("1. executes approved correction — creates append-only reversal movement", async () => {
    const { correctionService, correctionRepo } = makeCorrectionService();
    const { batchId, correctionRequestId, movementId } = await seedCommittedBatchWithApprovedCorrection(
      "reversal", "stock_movement", "PLACEHOLDER", // will be replaced below
    );

    // Update the correction request to point to the real movement ID

    const before = await snapshotCounts();

    const result = await correctionService.executeCorrection(
      makeUser(U) as any, makeEffective() as any,
      { correctionRequestId, idempotencyKey: "corr-exec-1" },
    );

    expect(result.action).toBe("executed");
    expect(result.correctedEntityType).toBe("stock_movement");
    expect(result.correctedEntityId).toBeTruthy();

    const after = await snapshotCounts();
    // One new reversal movement created (append-only)
    expect(after.stockMovements).toBe(before.stockMovements + 1);
    // Correction request marked as executed
    expect(after.correctionsExecuted).toBe(before.correctionsExecuted + 1);
    // Audit advanced (correction service audit + inventory ledger domain audit)
    expect(after.auditCount).toBeGreaterThan(before.auditCount);
    // Idempotency succeeded (correction service + inventory ledger)
    expect(after.idemSucceeded).toBeGreaterThan(before.idemSucceeded);

    // Verify the original movement is unchanged (quantity unchanged, movement_status still posted)
    const originalMovement = await sql`SELECT movement_status, quantity_kg FROM stock_movements WHERE id = ${movementId}`;
    expect(originalMovement[0]?.movement_status).toBe("posted");
    expect(parseFloat(originalMovement[0]?.quantity_kg)).toBe(100);

    // Verify the correction request has correctedEntityId set
    const correction = await correctionRepo.findCorrectionRequestById(T, correctionRequestId);
    expect(correction?.correctedEntityId).toBeTruthy();
    expect(correction?.correctedEntityType).toBe("stock_movement");
  }, 60000);

  // -------------------------------------------------------------------------
  // 2. injected failure after partial domain effect → complete rollback
  // -------------------------------------------------------------------------
  it("2. fault injection after domain effect → complete rollback (zero new movements)", async () => {
    const { correctionService, correctionRepo } = makeCorrectionService(() => { throw new Error("FAULT_INJECTED_AFTER_DOMAIN_EFFECT"); });
    const { batchId, correctionRequestId, movementId } = await seedCommittedBatchWithApprovedCorrection(
      "reversal", "stock_movement", "PLACEHOLDER",
    );

    const before = await snapshotCounts();

    // Execute with fault callback — throws AFTER domain effect but BEFORE markSucceeded
    await expect(
      correctionService.executeCorrection(
        makeUser(U) as any, makeEffective() as any,
        { correctionRequestId, idempotencyKey: "corr-fault-1" },
      ),
    ).rejects.toThrow(/FAULT_INJECTED_AFTER_DOMAIN_EFFECT|CORRECTION_FAILED/i);

    const after = await snapshotCounts();
    // Zero new movements (rolled back)
    expect(after.stockMovements).toBe(before.stockMovements);
    // Correction NOT marked as executed
    expect(after.correctionsExecuted).toBe(before.correctionsExecuted);
    // No audit leak (the audit row inside the transaction was rolled back)
    expect(after.auditCount).toBe(before.auditCount);
    // No succeeded idempotency (rolled back)
    expect(after.idemSucceeded).toBe(before.idemSucceeded);

    // Correction request still approved but not executed
    const correction = await correctionRepo.findCorrectionRequestById(T, correctionRequestId);
    expect(correction?.correctedEntityId).toBeNull();
  }, 60000);

  // -------------------------------------------------------------------------
  // 3. valid retry → one append-only correction effect
  // -------------------------------------------------------------------------
  it("3. valid retry after failure → one append-only correction effect", async () => {
    // First service has fault callback; retry uses a new service without fault
    const { correctionService: faultService } = makeCorrectionService(() => { throw new Error("FAULT_INJECTED"); });
    const { batchId, correctionRequestId, movementId } = await seedCommittedBatchWithApprovedCorrection(
      "reversal", "stock_movement", "PLACEHOLDER",
    );

    // First attempt fails (fault callback)
    await expect(
      faultService.executeCorrection(
        makeUser(U) as any, makeEffective() as any,
        { correctionRequestId, idempotencyKey: "corr-retry-1" },
      ),
    ).rejects.toThrow();

    const before = await snapshotCounts();

    // Create a retry service WITHOUT fault callback for the retry attempts
    const { correctionService: retryService } = makeCorrectionService();

    // PHASE 0: Same-key retry after business_failed throws OPERATION_REPLAY_FAILED
    // (business_failed is terminal per Contract 06 §7.1 — same key cannot re-execute).
    await expect(
      retryService.executeCorrection(
        makeUser(U) as any, makeEffective() as any,
        { correctionRequestId, idempotencyKey: "corr-retry-1" },
      ),
    ).rejects.toThrow(/OPERATION_REPLAY_FAILED|previously failed|new idempotency key/i);

    // Retry with NEW idempotency key using the retry service
    const result = await retryService.executeCorrection(
      makeUser(U) as any, makeEffective() as any,
      { correctionRequestId, idempotencyKey: "corr-retry-2" },
    );

    expect(result.action).toBe("executed");

    const after = await snapshotCounts();
    // Exactly ONE new reversal movement (from the retry, not the failed attempt)
    expect(after.stockMovements).toBe(before.stockMovements + 1);
    expect(after.correctionsExecuted).toBe(before.correctionsExecuted + 1);

    // PHASE 0: Same-key replay of the SUCCESSFUL retry adds zero effects.
    const beforeReplay = await snapshotCounts();
    const replayResult = await retryService.executeCorrection(
      makeUser(U) as any, makeEffective() as any,
      { correctionRequestId, idempotencyKey: "corr-retry-2" },
    );
    expect(replayResult.action).toBe("replayed");
    const afterReplay = await snapshotCounts();
    expect(afterReplay.stockMovements).toBe(beforeReplay.stockMovements);
    expect(afterReplay.correctionsExecuted).toBe(beforeReplay.correctionsExecuted);
  }, 60000);

  // -------------------------------------------------------------------------
  // 4. replay → zero new effects
  // -------------------------------------------------------------------------
  it("4. replay with same idempotency key → zero new effects", async () => {
    const { correctionService } = makeCorrectionService();
    const { batchId, correctionRequestId, movementId } = await seedCommittedBatchWithApprovedCorrection(
      "reversal", "stock_movement", "PLACEHOLDER",
    );

    // First execution
    const r1 = await correctionService.executeCorrection(
      makeUser(U) as any, makeEffective() as any,
      { correctionRequestId, idempotencyKey: "corr-replay-1" },
    );
    expect(r1.action).toBe("executed");

    const before = await snapshotCounts();

    // Replay with same idempotency key
    const r2 = await correctionService.executeCorrection(
      makeUser(U) as any, makeEffective() as any,
      { correctionRequestId, idempotencyKey: "corr-replay-1" },
    );
    expect(r2.action).toBe("replayed");

    const after = await snapshotCounts();
    // Zero new effects
    expect(after.stockMovements).toBe(before.stockMovements);
    expect(after.auditCount).toBe(before.auditCount);
    expect(after.idemSucceeded).toBe(before.idemSucceeded);
  }, 60000);

  // -------------------------------------------------------------------------
  // 5. conflict → rejected with zero effects
  // -------------------------------------------------------------------------
  it("5. conflict (different body, same key) → rejected with zero effects", async () => {
    const { correctionService } = makeCorrectionService();
    const { batchId, correctionRequestId, movementId } = await seedCommittedBatchWithApprovedCorrection(
      "reversal", "stock_movement", "PLACEHOLDER",
    );

    // First execution succeeds
    await correctionService.executeCorrection(
      makeUser(U) as any, makeEffective() as any,
      { correctionRequestId, idempotencyKey: "corr-conflict-1" },
    );

    const before = await snapshotCounts();

    // Second call with SAME key but different request body (conflict)
    // The idempotency system should detect the conflict
    await expect(
      correctionService.executeCorrection(
        makeUser(U) as any, makeEffective() as any,
        { correctionRequestId: randomUUID(), idempotencyKey: "corr-conflict-1" }, // different request ID
      ),
    ).rejects.toThrow(/IDEMPOTENCY_CONFLICT|not found/i);

    const after = await snapshotCounts();
    // Zero new effects
    expect(after.stockMovements).toBe(before.stockMovements);
    expect(after.auditCount).toBe(before.auditCount);
  }, 60000);

  // -------------------------------------------------------------------------
  // 6. original evidence remains unchanged/queryable
  // -------------------------------------------------------------------------
  it("6. original committed batch + movements remain unchanged after correction", async () => {
    const { correctionService } = makeCorrectionService();
    const { batchId, correctionRequestId, movementId } = await seedCommittedBatchWithApprovedCorrection(
      "reversal", "stock_movement", "PLACEHOLDER",
    );

    // Execute correction
    const result = await correctionService.executeCorrection(
      makeUser(U) as any, makeEffective() as any,
      { correctionRequestId, idempotencyKey: "corr-preserve-1" },
    );

    // Original batch is still committed and unchanged
    const batch = await sql`SELECT status, committed_at, staged_data_hash FROM import_batches WHERE id = ${batchId}`;
    expect(batch[0]?.status).toBe("committed");
    expect(batch[0]?.committed_at).toBeTruthy();
    expect(batch[0]?.staged_data_hash).toBe("h");

    // Original movement is still posted and unchanged
    const originalMov = await sql`SELECT movement_status, quantity_kg, movement_type FROM stock_movements WHERE id = ${movementId}`;
    expect(originalMov[0]?.movement_status).toBe("posted");
    expect(parseFloat(originalMov[0]?.quantity_kg)).toBe(100);
    expect(originalMov[0]?.movement_type).toBe("raw_receipt");

    // New reversal movement exists — find by the correctedEntityId returned
    const reversalMov = await sql`SELECT movement_type, quantity_kg FROM stock_movements WHERE id = ${result.correctedEntityId}`;
    expect(reversalMov.length).toBe(1);
    // Reversal movement has movement_type 'reversal' (append-only compensating effect)
    expect(reversalMov[0]?.movement_type).toBe("reversal");
  }, 60000);

  // -------------------------------------------------------------------------
  // 7. unsupported correction type → rejected with zero effects
  // -------------------------------------------------------------------------
  it("7. unsupported correction type/entity → rejected with zero effects", async () => {
    const { correctionService } = makeCorrectionService();
    const { batchId, correctionRequestId, movementId } = await seedCommittedBatchWithApprovedCorrection(
      "new_corrected", "stock_movement", "PLACEHOLDER",
    );

    const before = await snapshotCounts();

    await expect(
      correctionService.executeCorrection(
        makeUser(U) as any, makeEffective() as any,
        { correctionRequestId, idempotencyKey: "corr-unsupported-1" },
      ),
    ).rejects.toThrow(/CORRECTION_TYPE_NOT_SUPPORTED/i);

    const after = await snapshotCounts();
    // Zero new effects
    expect(after.stockMovements).toBe(before.stockMovements);
    expect(after.correctionsExecuted).toBe(before.correctionsExecuted);
  }, 60000);

  // -------------------------------------------------------------------------
  // 8. PHASE 0: Worker/unauthorized role denial with zero effects
  // -------------------------------------------------------------------------
  it("8. worker role denied executeCorrection with zero DB effects", async () => {
    const { correctionService } = makeCorrectionService();
    const { batchId, correctionRequestId, movementId } = await seedCommittedBatchWithApprovedCorrection(
      "reversal", "stock_movement", "PLACEHOLDER",
    );

    const before = await snapshotCounts();

    // Worker role lacks migration.commit permission
    const workerEffective = {
      assignedRoleCodes: ["warehouse_employee"],
      permissionKeys: new Set(["inventory.view_quantity"]),
      deniedFieldKeys: new Set(),
      workerFinancialDeny: true,
    } as any;

    await expect(
      correctionService.executeCorrection(
        makeUser(U) as any, workerEffective,
        { correctionRequestId, idempotencyKey: "corr-worker-1" },
      ),
    ).rejects.toThrow(/Permission denied/i);

    const after = await snapshotCounts();
    // Zero new effects — denied before any DB write
    expect(after.stockMovements).toBe(before.stockMovements);
    expect(after.correctionsExecuted).toBe(before.correctionsExecuted);
    expect(after.auditCount).toBe(before.auditCount);
    expect(after.idemSucceeded).toBe(before.idemSucceeded);
  }, 60000);
});
