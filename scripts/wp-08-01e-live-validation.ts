/**
 * WP-08-01E — Sectioned Live PostgreSQL Validation (corrected).
 *
 * Usage: npx tsx scripts/wp-08-01e-live-validation.ts <section>
 *
 * Sections:
 *   diagnostics      — startup checks (DATABASE_URL, schema sanity)
 *   quality-create   — createQualityTest: success/replay/conflict,
 *                      audit-fail/retry/replay, real owner-token
 *                      takeover/rollback/reclaim/replay, concurrency
 *   quality-value    — recordQualityTestValue: same set
 *   complaint-create — createComplaint: same set
 *   complaint-update — updateComplaint: same set
 *   quality-review   — reviewQualityTest: same set
 *   cleanup          — delete all deterministic QA data
 *
 * Each section:
 *   - runs from this committed script
 *   - finishes within timeout
 *   - prints PASS/FAIL summary
 *   - exits 0 on all-pass, 1 on any failure
 *   - closes its DB connection in finally
 *   - never prints credential or token values (only non-null/equality-change)
 *
 * BLOCKER 1 FIX: every key is explicitly declared:
 *   - KEY_SRC  : success/replay/conflict key (per command)
 *   - KEY_RT   : audit-failure / same-key retry / replay key (per command)
 *   - KEY_OL   : owner-loss / reclaim key (per command)
 *   - KEY_CC   : concurrency key (per command)
 *
 * BLOCKER 2 FIX: real PostgreSQL owner-token takeover via an independent
 * root DB connection that atomically replaces owner_token (guarded by
 * record id + state=in_progress + original owner token) immediately
 * before the stale markSucceeded executes inside the transaction.
 *
 * BLOCKER 3 FIX: real owner-takeover/rollback/reclaim/replay sections for
 * ALL FIVE commands with exact value assertions.
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { execSync } from "node:child_process";
import * as schema from "@/server/db/schema";
import { QualityTestDbRepository } from "@/server/services/quality-test-db-repository";
import { ComplaintDbRepository } from "@/server/services/complaint-db-repository";
import { AuditDbRepository } from "@/server/services/audit-db-repository";
import { IdempotencyDbRepository } from "@/server/services/idempotency-db-repository";
import { DocumentSequenceDbRepository } from "@/server/services/document-sequence-db-repository";
import { QualityTestService } from "@/server/services/quality-test-service";
import { ComplaintService } from "@/server/services/complaint-service";
import {
  IdempotencyOwnershipLostError,
  claimIdempotency,
  markSucceeded,
} from "@/server/services/idempotency-service";

// ---------------------------------------------------------------------------
// Startup checks — enforced before anything else runs.
// ---------------------------------------------------------------------------
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("FATAL: DATABASE_URL is not set.");
  process.exit(1);
}
if (!DATABASE_URL.startsWith("postgres")) {
  console.error("FATAL: DATABASE_URL must be a postgres:// connection string.");
  console.error("       Got:", DATABASE_URL.replace(/:[^:@/]+@/, ":***@"));
  process.exit(1);
}

// WP-08-01F Milestone C Task 2: invoke centralized guard CLI before any DB connection.
execSync("node scripts/wp-08-01f-destruction-guard.mjs", { stdio: "inherit" });

const SECTION = process.argv[2];
const RECOGNIZED_SECTIONS = new Set([
  "diagnostics", "quality-create", "quality-value",
  "complaint-create", "complaint-update", "quality-review", "cleanup",
]);
if (!SECTION) {
  console.error("Usage: npx tsx scripts/wp-08-01e-live-validation.ts <section>");
  console.error("Sections:", [...RECOGNIZED_SECTIONS].join(", "));
  process.exit(1);
}
if (!RECOGNIZED_SECTIONS.has(SECTION)) {
  console.error(`FATAL: Unknown section '${SECTION}'.`);
  console.error("       Recognized:", [...RECOGNIZED_SECTIONS].join(", "));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Deterministic tenant/user/item/customer UUIDs.
// ---------------------------------------------------------------------------
const T = "00000000-0000-0000-0000-000000081e40";
const U = "00000000-0000-0000-0000-000000081e41";
const ITEM = "00000000-0000-4000-8000-cccc000e0040";
const CUST = "00000000-0000-4000-8000-cccc000e0041";

// ---------------------------------------------------------------------------
// Pass/fail accounting.
// ---------------------------------------------------------------------------
let passCount = 0, failCount = 0;
const failures: string[] = [];
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { console.log(`  PASS #${++passCount} ${label}`); }
  else {
    console.log(`  FAIL #${++passCount} ${label}${detail ? ` — ${detail}` : ""}`);
    failCount++; failures.push(label);
  }
}

// ---------------------------------------------------------------------------
// Fault-injection wrappers.
// ---------------------------------------------------------------------------
class FailingAuditRepo extends AuditDbRepository {
  async insertAuditLog(_row: any): Promise<void> {
    throw new Error("SIMULATED_AUDIT_FAILURE");
  }
}

// ---------------------------------------------------------------------------
// Setup / cleanup helpers.
// ---------------------------------------------------------------------------
async function setup(sql: any) {
  await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status) VALUES (${T}, ${"E4"}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${U}, ${T}, ${"e4"}, ${"E4"}, ${"e4@test.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO inventory_items (id, tenant_id, item_code, display_name_ar, item_kind, status) VALUES (${ITEM}, ${T}, ${"ITEM-E4"}, ${"Test"}, ${"raw_material"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO customers (id, tenant_id, customer_code, name_ar, normalized_name, status) VALUES (${CUST}, ${T}, ${"CUST-E4"}, ${"Test Customer"}, ${"test customer e4"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
  await sql`SET statement_timeout = 30000`;
}

async function cleanup(sql: any) {
  // Deletes only deterministic QA business/audit/sequence/idempotency data.
  // Preserves setup rows (tenant, user, inventory_item, customer) so they
  // remain available for the next section without re-running setup().
  await sql`DELETE FROM quality_test_values WHERE tenant_id = ${T}`;
  await sql`DELETE FROM quality_holds WHERE tenant_id = ${T}`;
  await sql`DELETE FROM quality_tests WHERE tenant_id = ${T}`;
  await sql`DELETE FROM complaints WHERE tenant_id = ${T}`;
  await sql`DELETE FROM document_sequences WHERE tenant_id = ${T}`;
  await sql`DELETE FROM idempotency_records WHERE tenant_id = ${T}`;
}

async function cleanupAll(sql: any) {
  // Full cleanup including setup rows. Used by the cleanup section only.
  await cleanup(sql);
  await sql`DELETE FROM customers WHERE tenant_id = ${T} AND id = ${CUST}`;
  await sql`DELETE FROM inventory_items WHERE tenant_id = ${T} AND id = ${ITEM}`;
}

async function countRows(sql: any, table: string): Promise<number> {
  const r = await sql.unsafe(`SELECT COUNT(*)::int as c FROM ${table} WHERE tenant_id = $1`, [T]);
  return r[0].c;
}
async function countAudit(sql: any, actionType: string): Promise<number> {
  const r = await sql.unsafe(`SELECT COUNT(*)::int as c FROM audit_logs WHERE tenant_id = $1 AND action_type = $2`, [T, actionType]);
  return r[0].c;
}
async function getIdemState(sql: any, scope: string, key: string): Promise<string | null> {
  const r = await sql.unsafe(`SELECT state FROM idempotency_records WHERE tenant_id = $1 AND operation_scope = $2 AND idempotency_key = $3`, [T, scope, key]);
  return r.length > 0 ? r[0].state : null;
}
async function getIdemOwnerTokenNonNullable(sql: any, scope: string, key: string): Promise<boolean> {
  const r = await sql.unsafe(`SELECT owner_token FROM idempotency_records WHERE tenant_id = $1 AND operation_scope = $2 AND idempotency_key = $3`, [T, scope, key]);
  if (r.length === 0) return false;
  return r[0].owner_token !== null;
}
// INTERNAL-ONLY: returns the actual owner_token value for equality comparison.
// The value is NEVER printed, logged, or included in any report or error
// message. Only used for internal A/B/C/D equality assertions.
async function getIdemOwnerTokenValue(sql: any, scope: string, key: string): Promise<string | null> {
  const r = await sql.unsafe(`SELECT owner_token FROM idempotency_records WHERE tenant_id = $1 AND operation_scope = $2 AND idempotency_key = $3`, [T, scope, key]);
  if (r.length === 0) return null;
  return r[0].owner_token;
}
async function getIdemAttemptCount(sql: any, scope: string, key: string): Promise<number | null> {
  const r = await sql.unsafe(`SELECT attempt_count FROM idempotency_records WHERE tenant_id = $1 AND operation_scope = $2 AND idempotency_key = $3`, [T, scope, key]);
  return r.length > 0 ? r[0].attempt_count : null;
}
async function getDocSeq(sql: any, docType: string): Promise<number | null> {
  const r = await sql.unsafe(`SELECT last_number FROM document_sequences WHERE tenant_id = $1 AND document_type = $2`, [T, docType]);
  return r.length > 0 ? r[0].last_number : null;
}

// ---------------------------------------------------------------------------
// Service factories.
// ---------------------------------------------------------------------------
function makeQtService(db: any, opts?: { failAudit?: boolean }) {
  const tr = async <W>(work: (tx: unknown) => Promise<W>): Promise<W> => (db as any).transaction(async (tx: any) => work(tx));
  return new QualityTestService({
    qualityTestRepository: new QualityTestDbRepository(db), audit: new AuditDbRepository(db),
    idempotency: new IdempotencyDbRepository(db), documentSequence: new DocumentSequenceDbRepository(db),
    transactionRunner: tr,
    txFactories: {
      createQualityTestRepository: (tx: unknown) => new QualityTestDbRepository(tx as any),
      createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
      createAudit: (tx: unknown) => opts?.failAudit ? new FailingAuditRepo(tx as any) : new AuditDbRepository(tx as any),
      createDocumentSequence: (tx: unknown) => new DocumentSequenceDbRepository(tx as any),
    },
  });
}
function makeCompService(db: any, opts?: { failAudit?: boolean }) {
  const tr = async <W>(work: (tx: unknown) => Promise<W>): Promise<W> => (db as any).transaction(async (tx: any) => work(tx));
  return new ComplaintService({
    complaintRepository: new ComplaintDbRepository(db), audit: new AuditDbRepository(db),
    idempotency: new IdempotencyDbRepository(db), documentSequence: new DocumentSequenceDbRepository(db),
    transactionRunner: tr,
    txFactories: {
      createComplaintRepository: (tx: unknown) => new ComplaintDbRepository(tx as any),
      createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
      createAudit: (tx: unknown) => opts?.failAudit ? new FailingAuditRepo(tx as any) : new AuditDbRepository(tx as any),
      createDocumentSequence: (tx: unknown) => new DocumentSequenceDbRepository(tx as any),
    },
  });
}

const user = { authenticated: true, tenantId: T, userId: U, name: "E4", email: "e4@test.test", authId: "e4", roles: [] } as any;
const qtEff = { assignedRoleCodes: ["quality_employee"], permissionKeys: new Set(["quality_tests.create"]), deniedFieldKeys: new Set(), workerFinancialDeny: false } as any;
const revEff = { assignedRoleCodes: ["owner"], permissionKeys: new Set(["quality_tests.create", "quality_risk_sales.approve"]), deniedFieldKeys: new Set(), workerFinancialDeny: false } as any;
const compEff = { assignedRoleCodes: ["quality_employee"], permissionKeys: new Set(["complaints.investigate"]), deniedFieldKeys: new Set(), workerFinancialDeny: false } as any;

// ---------------------------------------------------------------------------
// Real PostgreSQL owner-token takeover helper.
//
// Uses an INDEPENDENT root DB connection (separate from the transaction's
// connection) to atomically replace owner_token, guarded by:
//   - record id
//   - state = 'in_progress'
//   - original owner token (non-null)
// Returns structured takeover evidence: the affected row count (MUST be
// exactly 1 for a real takeover) and the replacement owner token installed
// (token C — captured internally, NEVER printed or included in reports).
// ---------------------------------------------------------------------------
interface TakeoverEvidence {
  affectedRows: number;
  replacementToken: string;
}
async function rootTakeoverOwnerToken(
  rootSql: any,
  recordId: string,
  expectedOwnerToken: string,
): Promise<TakeoverEvidence> {
  const newOwnerToken = crypto.randomUUID();
  const result = await rootSql.unsafe(
    `UPDATE idempotency_records
       SET owner_token = $3,
           attempt_count = attempt_count + 1,
           lease_heartbeat_at = NOW(),
           lease_expires_at = NOW() + INTERVAL '30 seconds'
     WHERE id = $1
       AND state = 'in_progress'
       AND owner_token = $2
       AND owner_token IS NOT NULL`,
    [recordId, expectedOwnerToken, newOwnerToken],
  );
  return { affectedRows: result.count, replacementToken: newOwnerToken };
}

// ---------------------------------------------------------------------------
// Expire the replacement owner's lease via deterministic test setup.
// Sets lease_expires_at to a past timestamp so claimExpiredLease can reclaim.
// ---------------------------------------------------------------------------
async function rootExpireLease(rootSql: any, recordId: string): Promise<void> {
  await rootSql.unsafe(
    `UPDATE idempotency_records
       SET lease_expires_at = NOW() - INTERVAL '1 second'
     WHERE id = $1`,
    [recordId],
  );
}

// ===========================================================================
// SECTION: diagnostics
// ===========================================================================
async function diagnostics(sql: any, db: any) {
  console.log("\n=== SECTION: diagnostics ===");
  // Verify required tables exist
  const requiredTables = [
    "idempotency_records", "audit_logs", "document_sequences",
    "quality_tests", "quality_test_values", "quality_holds",
    "complaints", "tenants", "users", "inventory_items", "customers",
  ];
  for (const t of requiredTables) {
    const r = await sql.unsafe(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1) as e`,
      [t],
    );
    check(`schema: ${t} exists`, r[0].e === true);
  }
  // Verify idempotency_records state check constraint
  const stateCheck = await sql.unsafe(`
    SELECT pg_get_constraintdef(oid) as def
      FROM pg_constraint
     WHERE conrelid = 'idempotency_records'::regclass
       AND conname = 'idempotency_records_state_check'`);
  check("schema: state_check exists", stateCheck.length === 1);
  check("schema: state_check mentions business_failed",
    stateCheck.length === 1 && /business_failed/.test(stateCheck[0].def));
  check("schema: state_check mentions retryable_failed",
    stateCheck.length === 1 && /retryable_failed/.test(stateCheck[0].def));
  // Setup seed rows
  await setup(sql);
  check("setup: tenant seeded",
    (await sql.unsafe(`SELECT id FROM tenants WHERE id = $1`, [T])).length === 1);
  check("setup: user seeded",
    (await sql.unsafe(`SELECT id FROM users WHERE id = $1`, [U])).length === 1);
  check("setup: inventory_item seeded",
    (await sql.unsafe(`SELECT id FROM inventory_items WHERE id = $1`, [ITEM])).length === 1);
  check("setup: customer seeded",
    (await sql.unsafe(`SELECT id FROM customers WHERE id = $1`, [CUST])).length === 1);
}

// ===========================================================================
// Generic owner-loss prover for a single command.
//
// Returns the per-command set of pass/fail counts. The caller is responsible
// for capturing before/after counts and passing them in.
// ===========================================================================
interface OwnerLossContext {
  scope: string;
  key: string;
  label: string;
  // Pre-claim a fresh idempotency record so we can capture the original
  // owner token, then trigger the takeover just before markSucceeded.
  claimInput: any;
  // The production command to execute (must use the same key).
  // It will receive an idempotency-repo whose updateState(state="succeeded")
  // first triggers the root takeover, then delegates.
  runCommand: (svc: any) => Promise<any>;
  // Optional counters (function returns expected 0 business delta).
  countBusinessDelta: () => Promise<{ table: string; before: number; after: number }>;
  // Optional audit action-type for delta check.
  auditActionType: string;
  // Optional doc-seq type for delta check (null if N/A).
  docSeqType: string | null;
  // Whether the command writes a hold (recordQualityTestValue does NOT).
  producesHold: boolean;
}

async function proveOwnerLoss(sql: any, db: any, ctx: OwnerLossContext) {
  console.log(`\n  --- owner-loss: ${ctx.label} ---`);

  // ===================================================================
  // Token capture plan (values NEVER printed — only equality/non-null):
  //   A = initial claim owner (step 1)
  //   B = owner after expired-lease reclaim by the production command
  //       (captured via wrapper intercepting claimExpiredLease)
  //   C = replacement owner installed by independent root takeover
  //       (captured via wrapper, returned by rootTakeoverOwnerToken)
  //   D = owner after final same-key reclaim/retry
  //       (captured via DB query after retry succeeds)
  // ===================================================================
  let tokenA: string | null = null;
  let tokenB: string | null = null;
  let tokenC: string | null = null;
  let tokenD: string | null = null;

  // Structured takeover evidence collected by the wrapper.
  interface TakeoverEvidenceCollected {
    takeoverAffectedRows: number | null;      // expected exactly 1
    staleMarkSucceededAffectedRows: number | null;  // expected exactly 0
    staleMarkRetryableFailedAffectedRows: number | null;  // expected exactly 0
    reclaimOwnerToken: string | null;  // token B (from claimExpiredLease)
    replacementOwnerToken: string | null;  // token C (from rootTakeoverOwnerToken)
  }
  const evidence: TakeoverEvidenceCollected = {
    takeoverAffectedRows: null,
    staleMarkSucceededAffectedRows: null,
    staleMarkRetryableFailedAffectedRows: null,
    reclaimOwnerToken: null,
    replacementOwnerToken: null,
  };

  // Step 1: pre-claim via rootSql so we capture token A (the original
  // non-null owner). The production command will reuse the same key+payload
  // and reclaim the expired lease, installing token B.
  const repo = new IdempotencyDbRepository(db);
  const claim = await claimIdempotency(repo, {
    tenantId: T, operationScope: ctx.scope, idempotencyKey: ctx.key,
    requestBody: ctx.claimInput, initiatedBy: U, leaseDurationMs: 30000, now: new Date(),
  });
  check(`${ctx.label}: original claim execute`, claim.action === "execute");
  tokenA = claim.record.ownerToken!;
  check(`${ctx.label}: token A (initial claim) non-null`, tokenA !== null && tokenA !== undefined);
  const attemptCountAfterA = await getIdemAttemptCount(sql, ctx.scope, ctx.key);
  check(`${ctx.label}: attempt_count == 1 after initial claim`,
    attemptCountAfterA === 1, `got ${attemptCountAfterA}`);

  // Step 2: immediately expire the lease so the production command will
  // reclaim it on its next claimIdempotency call (installing token B).
  await rootExpireLease(sql, claim.record.id);

  // Step 3: Build a takeover-evidence-collector wrapper that intercepts:
  //   - claimExpiredLease: capture token B (the reclaim owner)
  //   - updateState(state="succeeded"): perform root takeover (installs C),
  //     capture takeover affected rows (expected 1) and replacement token C,
  //     then delegate and capture stale markSucceeded affected rows (expected 0)
  //   - updateState(state="retryable_failed"): delegate and capture stale
  //     defensive markRetryableFailed affected rows (expected 0)
  //
  // The wrapper extends IdempotencyDbRepository so it can be used both as
  // the outer idempotency dep AND as the tx-scoped factory.
  class TakeoverEvidenceCollector extends IdempotencyDbRepository {
    constructor(txOrDb: any) { super(txOrDb); }

    async claimExpiredLease(id: string, newLeaseExpiresAt: Date, newHeartbeatAt: Date, now: Date): Promise<boolean> {
      const result = await super.claimExpiredLease(id, newLeaseExpiresAt, newHeartbeatAt, now);
      if (result) {
        // Capture token B immediately after a successful reclaim.
        // Query via the SAME connection to avoid race conditions.
        const row = await this.findByTenantScopeKey(T, ctx.scope, ctx.key);
        if (row && row.ownerToken) {
          evidence.reclaimOwnerToken = row.ownerToken;
        }
      }
      return result;
    }

    async updateState(id: string, update: any): Promise<number> {
      if (update.state === "succeeded" && update.expectedOwnerToken) {
        // Perform the takeover from an INDEPENDENT root connection BEFORE
        // delegating the stale markSucceeded. The root connection commits
        // independently of the current transaction.
        const rootSql = postgres(DATABASE_URL!, {
          prepare: false, max: 1, idle_timeout: 5, connect_timeout: 5,
        });
        try {
          const takeoverEv = await rootTakeoverOwnerToken(
            rootSql, id, update.expectedOwnerToken,
          );
          evidence.takeoverAffectedRows = takeoverEv.affectedRows;
          evidence.replacementOwnerToken = takeoverEv.replacementToken;
        } finally {
          await rootSql.end();
        }
        // Now delegate the stale markSucceeded — must affect 0 rows because
        // owner_token has been replaced by C.
        const affected = await super.updateState(id, update);
        evidence.staleMarkSucceededAffectedRows = affected;
        return affected;
      }
      if (update.state === "retryable_failed" && update.expectedOwnerToken) {
        // Defensive stale markRetryableFailed in the production catch block.
        // Must affect 0 rows because owner_token is now C (not B).
        const affected = await super.updateState(id, update);
        evidence.staleMarkRetryableFailedAffectedRows = affected;
        return affected;
      }
      return super.updateState(id, update);
    }
  }

  // Step 4: capture before-counts.
  const bizBefore = await ctx.countBusinessDelta();
  const auditBefore = await countAudit(sql, ctx.auditActionType);
  const docSeqBefore = ctx.docSeqType ? await getDocSeq(sql, ctx.docSeqType) : null;

  // Step 5: run the production command with the takeover wrapper wired
  // into BOTH the outer idempotency dep AND the tx-scoped factory.
  let svc: any;
  const tr = async <W>(work: (tx: unknown) => Promise<W>): Promise<W> => (db as any).transaction(async (tx: any) => work(tx));
  if (ctx.scope.startsWith("quality_test")) {
    svc = new QualityTestService({
      qualityTestRepository: new QualityTestDbRepository(db), audit: new AuditDbRepository(db),
      idempotency: new TakeoverEvidenceCollector(db), documentSequence: new DocumentSequenceDbRepository(db),
      transactionRunner: tr,
      txFactories: {
        createQualityTestRepository: (tx: unknown) => new QualityTestDbRepository(tx as any),
        createIdempotency: (tx: unknown) => new TakeoverEvidenceCollector(tx as any),
        createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
        createDocumentSequence: (tx: unknown) => new DocumentSequenceDbRepository(tx as any),
      },
    });
  } else {
    svc = new ComplaintService({
      complaintRepository: new ComplaintDbRepository(db), audit: new AuditDbRepository(db),
      idempotency: new TakeoverEvidenceCollector(db), documentSequence: new DocumentSequenceDbRepository(db),
      transactionRunner: tr,
      txFactories: {
        createComplaintRepository: (tx: unknown) => new ComplaintDbRepository(tx as any),
        createIdempotency: (tx: unknown) => new TakeoverEvidenceCollector(tx as any),
        createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
        createDocumentSequence: (tx: unknown) => new DocumentSequenceDbRepository(tx as any),
      },
    });
  }

  let threwOwnership = false;
  let caughtErr: any = null;
  try {
    await ctx.runCommand(svc);
  } catch (e: any) {
    caughtErr = e;
    threwOwnership = e instanceof IdempotencyOwnershipLostError
      || e.name === "IdempotencyOwnershipLostError"
      || e.code === "IDEMPOTENCY_OWNERSHIP_LOST"
      || e?.cause?.code === "IDEMPOTENCY_OWNERSHIP_LOST"
      || e?.cause?.name === "IdempotencyOwnershipLostError";
  }
  check(`${ctx.label}: IdempotencyOwnershipLostError thrown`, threwOwnership,
    caughtErr ? `got: code=${caughtErr?.code}, name=${caughtErr?.name}` : "(no error thrown)");

  // --- Token B assertions (reclaim owner by production command) ---
  tokenB = evidence.reclaimOwnerToken;
  check(`${ctx.label}: token B (reclaim owner) non-null`, tokenB !== null && tokenB !== undefined);
  check(`${ctx.label}: token A != token B`, tokenA !== null && tokenB !== null && tokenA !== tokenB);

  // --- Token C assertions (replacement owner by root takeover) ---
  tokenC = evidence.replacementOwnerToken;
  check(`${ctx.label}: token C (takeover owner) non-null`, tokenC !== null && tokenC !== undefined);
  check(`${ctx.label}: token B != token C`, tokenB !== null && tokenC !== null && tokenB !== tokenC);

  // --- Takeover affected rows: exactly 1 ---
  check(`${ctx.label}: takeover affected exactly 1 row`,
    evidence.takeoverAffectedRows === 1, `got ${evidence.takeoverAffectedRows}`);

  // --- Stale markSucceeded affected rows: exactly 0 ---
  check(`${ctx.label}: stale markSucceeded affected exactly 0 rows`,
    evidence.staleMarkSucceededAffectedRows === 0, `got ${evidence.staleMarkSucceededAffectedRows}`);

  // --- Defensive stale markRetryableFailed affected rows: exactly 0 ---
  check(`${ctx.label}: defensive stale markRetryableFailed affected exactly 0 rows`,
    evidence.staleMarkRetryableFailedAffectedRows === 0, `got ${evidence.staleMarkRetryableFailedAffectedRows}`);

  // --- C remains the stored owner after stale transaction rollback ---
  // Query the DB directly — the owner_token must equal tokenC (the takeover
  // survived rollback because it was committed on an independent connection).
  const storedOwnerAfterRollback = await getIdemOwnerTokenValue(sql, ctx.scope, ctx.key);
  check(`${ctx.label}: stored owner == token C after rollback`,
    storedOwnerAfterRollback !== null && storedOwnerAfterRollback === tokenC);

  // --- State after stale rollback: exactly 'in_progress' ---
  const stateAfter = await getIdemState(sql, ctx.scope, ctx.key);
  check(`${ctx.label}: state exactly 'in_progress' after rollback`,
    stateAfter === "in_progress", `got '${stateAfter}'`);

  // --- Attempt count after rollback: exactly 3 ---
  // (1 initial + 1 reclaim + 1 takeover; defensive markRetryableFailed
  // affected 0 rows so no further increment)
  const attemptCountAfterRollback = await getIdemAttemptCount(sql, ctx.scope, ctx.key);
  check(`${ctx.label}: attempt_count == 3 after rollback`,
    attemptCountAfterRollback === 3, `got ${attemptCountAfterRollback}`);

  // --- Zero committed business mutation ---
  const bizAfter = await ctx.countBusinessDelta();
  check(`${ctx.label}: 0 committed business mutation`,
    bizAfter.after - bizBefore.before === 0,
    `delta=${bizAfter.after - bizBefore.before} table=${bizAfter.table}`);

  // --- Zero audit delta ---
  const auditAfter = await countAudit(sql, ctx.auditActionType);
  check(`${ctx.label}: 0 audit delta`, auditAfter - auditBefore === 0,
    `delta=${auditAfter - auditBefore}`);

  // --- Zero doc-seq increment (where applicable) ---
  if (ctx.docSeqType !== null) {
    const docSeqAfter = await getDocSeq(sql, ctx.docSeqType!);
    check(`${ctx.label}: 0 doc-seq increment`,
      docSeqAfter === docSeqBefore,
      `before=${docSeqBefore} after=${docSeqAfter}`);
  }

  // Step 11: expire the replacement owner's lease (token C's lease) through
  // deterministic test setup so the retry can reclaim.
  const idemRow = await sql.unsafe(
    `SELECT id FROM idempotency_records WHERE tenant_id = $1 AND operation_scope = $2 AND idempotency_key = $3`,
    [T, ctx.scope, ctx.key],
  );
  const recordId = idemRow[0].id;
  await rootExpireLease(sql, recordId);

  // Step 12: retry using the same key and payload through production code.
  // The production service reclaims the expired lease (installing token D)
  // and completes the business effect.
  const retrySvc = ctx.scope.startsWith("quality_test")
    ? makeQtService(db) : makeCompService(db);
  const bizBeforeRetry = await ctx.countBusinessDelta();
  const auditBeforeRetry = await countAudit(sql, ctx.auditActionType);
  let retryResult: any;
  let retryThrew = false;
  let retryErr: any = null;
  try {
    retryResult = await ctx.runCommand(retrySvc);
  } catch (e: any) {
    retryThrew = true;
    retryErr = e;
  }
  check(`${ctx.label}: retry succeeds (no throw)`, !retryThrew,
    retryThrew ? `threw: code=${retryErr?.code}, name=${retryErr?.name}` : "");

  // --- Token D assertions (reclaim owner by retry) ---
  tokenD = await getIdemOwnerTokenValue(sql, ctx.scope, ctx.key);
  check(`${ctx.label}: token D (retry reclaim owner) non-null`, tokenD !== null && tokenD !== undefined);
  check(`${ctx.label}: token C != token D`, tokenC !== null && tokenD !== null && tokenC !== tokenD);

  // --- Attempt count after retry: exactly 4 ---
  // (3 from before + 1 reclaim by retry)
  const attemptCountAfterRetry = await getIdemAttemptCount(sql, ctx.scope, ctx.key);
  check(`${ctx.label}: attempt_count == 4 after retry`,
    attemptCountAfterRetry === 4, `got ${attemptCountAfterRetry}`);

  // --- Retry creates exactly 1 business effect ---
  const bizAfterRetry = await ctx.countBusinessDelta();
  check(`${ctx.label}: retry creates exactly 1 effect`,
    bizAfterRetry.after - bizBeforeRetry.before === 1,
    `delta=${bizAfterRetry.after - bizBeforeRetry.before}`);

  // --- State after retry: exactly 'succeeded' ---
  const stateAfterRetry = await getIdemState(sql, ctx.scope, ctx.key);
  check(`${ctx.label}: state exactly 'succeeded' after retry`,
    stateAfterRetry === "succeeded", `got '${stateAfterRetry}'`);

  // Step 15: replay with same key. MUST NOT throw — if it does, the error
  // is captured and reported (never swallowed). Replay must produce zero
  // new effects.
  const auditBeforeReplay = await countAudit(sql, ctx.auditActionType);
  const bizBeforeReplay = await ctx.countBusinessDelta();
  const attemptCountBeforeReplay = await getIdemAttemptCount(sql, ctx.scope, ctx.key);
  let replayThrew = false;
  let replayErr: any = null;
  let replayResult: any = null;
  try {
    replayResult = await ctx.runCommand(retrySvc);
  } catch (e: any) {
    replayThrew = true;
    replayErr = e;
  }
  // Replay must NOT throw. If it does, fail with the error details (no
  // token values, just code/name).
  check(`${ctx.label}: replay does not throw`, !replayThrew,
    replayThrew ? `threw: code=${replayErr?.code}, name=${replayErr?.name}` : "");

  const auditAfterReplay = await countAudit(sql, ctx.auditActionType);
  const bizAfterReplay = await ctx.countBusinessDelta();
  const attemptCountAfterReplay = await getIdemAttemptCount(sql, ctx.scope, ctx.key);
  check(`${ctx.label}: replay creates 0 new audits`,
    auditAfterReplay - auditBeforeReplay === 0,
    `delta=${auditAfterReplay - auditBeforeReplay}`);
  check(`${ctx.label}: replay creates 0 new business effects`,
    bizAfterReplay.after - bizBeforeReplay.before === 0,
    `delta=${bizAfterReplay.after - bizBeforeReplay.before}`);
  // Replay must NOT increment attempt_count (no reclaim on terminal state).
  check(`${ctx.label}: replay does not increment attempt_count`,
    attemptCountAfterReplay === attemptCountBeforeReplay,
    `before=${attemptCountBeforeReplay} after=${attemptCountAfterReplay}`);

  // --- Final state: exactly 'succeeded' ---
  const finalState = await getIdemState(sql, ctx.scope, ctx.key);
  check(`${ctx.label}: final state exactly 'succeeded'`, finalState === "succeeded",
    `got '${finalState}'`);

  // --- Final token D unchanged after replay ---
  const tokenDFinal = await getIdemOwnerTokenValue(sql, ctx.scope, ctx.key);
  check(`${ctx.label}: token D unchanged after replay`, tokenD === tokenDFinal);

  // --- All four tokens non-null summary ---
  check(`${ctx.label}: all four tokens (A,B,C,D) non-null`,
    tokenA !== null && tokenB !== null && tokenC !== null && tokenD !== null);
  // --- All four tokens distinct summary ---
  check(`${ctx.label}: tokens A,B,C,D all distinct`,
    tokenA !== tokenB && tokenB !== tokenC && tokenC !== tokenD && tokenA !== tokenC && tokenB !== tokenD && tokenA !== tokenD);
}

// ===========================================================================
// SECTION: quality-create
// ===========================================================================
async function qualityCreate(sql: any, db: any) {
  console.log("\n=== SECTION: quality-create ===");
  await cleanup(sql);
  const KEY_SRC = "qc-src"; // success/replay/conflict
  const KEY_RT = "qc-rt";   // audit-fail/retry/replay
  const KEY_OL = "qc-ol";   // owner-loss/reclaim/replay
  const KEY_CC = "qc-cc";   // concurrency

  // --- A. Success ---
  {
    const aB = await countAudit(sql, "quality_test.create");
    const r = await makeQtService(db).createQualityTest(user, qtEff, {
      testDate: "2026-08-06", linkedEntityType: "inventory_item", linkedEntityId: ITEM, idempotencyKey: KEY_SRC,
    });
    check("A.success: created", r.action === "created");
    check("A.success: 1 test", await countRows(sql, "quality_tests") === 1);
    check("A.success: audit +1", await countAudit(sql, "quality_test.create") === aB + 1);
    check("A.success: idem succeeded", await getIdemState(sql, "quality_test.create", KEY_SRC) === "succeeded");
    check("A.success: owner token non-null", await getIdemOwnerTokenNonNullable(sql, "quality_test.create", KEY_SRC));
    check("A.success: doc_seq=1", await getDocSeq(sql, "quality_test") === 1);
  }
  // --- B. Replay ---
  {
    const aB = await countAudit(sql, "quality_test.create");
    const dsB = await getDocSeq(sql, "quality_test");
    const r = await makeQtService(db).createQualityTest(user, qtEff, {
      testDate: "2026-08-06", linkedEntityType: "inventory_item", linkedEntityId: ITEM, idempotencyKey: KEY_SRC,
    });
    check("B.replay: replayed", r.action === "replayed");
    check("B.replay: audit +0", await countAudit(sql, "quality_test.create") === aB);
    check("B.replay: doc_seq unchanged", await getDocSeq(sql, "quality_test") === dsB);
    check("B.replay: still 1 test", await countRows(sql, "quality_tests") === 1);
  }
  // --- C. Conflict (KEY_SRC with different body) ---
  {
    const tB = await countRows(sql, "quality_tests");
    const aB = await countAudit(sql, "quality_test.create");
    const dsB = await getDocSeq(sql, "quality_test");
    let threw = false;
    try {
      await makeQtService(db).createQualityTest(user, qtEff, {
        testDate: "2026-08-06", linkedEntityType: "inventory_item",
        linkedEntityId: "00000000-0000-4000-8000-cccc00999001",
        idempotencyKey: KEY_SRC,
      });
    } catch (e: any) { if (e.code === "IDEMPOTENCY_CONFLICT") threw = true; }
    check("C.conflict: thrown", threw);
    check("C.conflict: 0 new tests", await countRows(sql, "quality_tests") === tB);
    check("C.conflict: audit +0", await countAudit(sql, "quality_test.create") === aB);
    check("C.conflict: doc_seq unchanged", await getDocSeq(sql, "quality_test") === dsB);
  }
  // --- D. Audit-fail with KEY_RT (same key for retry + replay) ---
  await cleanup(sql);
  {
    const tB = await countRows(sql, "quality_tests");
    const aB = await countAudit(sql, "quality_test.create");
    const dsB = await getDocSeq(sql, "quality_test");
    let threw = false;
    try {
      await makeQtService(db, { failAudit: true }).createQualityTest(user, qtEff, {
        testDate: "2026-08-06", linkedEntityType: "inventory_item", linkedEntityId: ITEM, idempotencyKey: KEY_RT,
      });
    } catch (e: any) { threw = !!e.message; }
    check("D.audit-fail: threw", threw);
    check("D.audit-fail: 0 tests", await countRows(sql, "quality_tests") === tB);
    check("D.audit-fail: audit +0", await countAudit(sql, "quality_test.create") === aB);
    check("D.audit-fail: doc_seq unchanged", await getDocSeq(sql, "quality_test") === dsB);
    check("D.audit-fail: idem not succeeded", await getIdemState(sql, "quality_test.create", KEY_RT) !== "succeeded");
    const stateAfter = await getIdemState(sql, "quality_test.create", KEY_RT);
    check("D.audit-fail: state is retryable_failed (NOT business_failed)",
      stateAfter === "retryable_failed", `state=${stateAfter}`);
  }
  // --- E. Retry with KEY_RT (same key, same payload) ---
  {
    const aB = await countAudit(sql, "quality_test.create");
    const r = await makeQtService(db).createQualityTest(user, qtEff, {
      testDate: "2026-08-06", linkedEntityType: "inventory_item", linkedEntityId: ITEM, idempotencyKey: KEY_RT,
    });
    check("E.retry: created", r.action === "created");
    check("E.retry: 1 test", await countRows(sql, "quality_tests") === 1);
    check("E.retry: audit +1", await countAudit(sql, "quality_test.create") === aB + 1);
    check("E.retry: idem succeeded", await getIdemState(sql, "quality_test.create", KEY_RT) === "succeeded");
  }
  // --- F. Replay after retry (KEY_RT) ---
  {
    const aB = await countAudit(sql, "quality_test.create");
    const r = await makeQtService(db).createQualityTest(user, qtEff, {
      testDate: "2026-08-06", linkedEntityType: "inventory_item", linkedEntityId: ITEM, idempotencyKey: KEY_RT,
    });
    check("F.replay-after-retry: replayed", r.action === "replayed");
    check("F.replay-after-retry: audit +0", await countAudit(sql, "quality_test.create") === aB);
  }
  // --- G. Owner-loss / takeover / rollback / reclaim / replay (KEY_OL) ---
  await cleanup(sql);
  await proveOwnerLoss(sql, db, {
    scope: "quality_test.create",
    key: KEY_OL,
    label: "G.createQualityTest.owner-loss",
    claimInput: {
      testDate: "2026-08-06", linkedEntityType: "inventory_item", linkedEntityId: ITEM,
      testStatus: "needs_review", riskClassification: "none",
      notes: null, saleId: null, customerId: null,
    },
    runCommand: (svc) => svc.createQualityTest(user, qtEff, {
      testDate: "2026-08-06", linkedEntityType: "inventory_item", linkedEntityId: ITEM, idempotencyKey: KEY_OL,
    }),
    countBusinessDelta: async () => ({
      table: "quality_tests",
      before: await countRows(sql, "quality_tests"),
      after: await countRows(sql, "quality_tests"),
    }),
    auditActionType: "quality_test.create",
    docSeqType: "quality_test",
    producesHold: false,
  });
  // --- H. Concurrency (KEY_CC) ---
  await cleanup(sql);
  {
    const aB = await countAudit(sql, "quality_test.create");
    const dsB = await getDocSeq(sql, "quality_test");
    const svc = makeQtService(db);
    const input = {
      testDate: "2026-08-06", linkedEntityType: "inventory_item" as any,
      linkedEntityId: ITEM, idempotencyKey: KEY_CC,
    };
    const results = await Promise.allSettled([
      svc.createQualityTest(user, qtEff, input),
      svc.createQualityTest(user, qtEff, input),
    ]);
    const outcomes = results.map((r, i) =>
      r.status === "fulfilled" ? `c${i}:fulfilled(${r.value.action})`
        : `c${i}:rejected(${(r as any).reason?.code ?? (r as any).reason?.name ?? "unknown"})`);
    console.log(`    Concurrency: ${outcomes.join(", ")}`);
    // Race-fix regression: only fulfilled and OPERATION_IN_PROGRESS allowed.
    const rejectedCodes = results
      .filter((r) => r.status === "rejected")
      .map((r) => (r as any).reason?.code ?? (r as any).reason?.name ?? "unknown");
    check("H.concurrency: 1 test created", await countRows(sql, "quality_tests") === 1);
    check("H.concurrency: audit +1", await countAudit(sql, "quality_test.create") === aB + 1);
    check("H.concurrency: doc_seq +1", await getDocSeq(sql, "quality_test") === (dsB ?? 0) + 1);
    const idem = await sql.unsafe(
      `SELECT state FROM idempotency_records WHERE tenant_id = $1 AND operation_scope = $2 AND idempotency_key = $3`,
      [T, "quality_test.create", KEY_CC]);
    check("H.concurrency: 1 idem record", idem.length === 1);
    check("H.concurrency: idem succeeded", idem[0].state === "succeeded");
    // createQualityTest with default testStatus=needs_review legitimately
    // creates 1 quality hold. We expect exactly 1 hold (no leak beyond the
    // single legitimate one).
    check("H.concurrency: exactly 1 hold (legitimate, no leak)",
      await countRows(sql, "quality_holds") === 1,
      `got ${await countRows(sql, "quality_holds")}`);
    check("H.concurrency: rejected codes only OPERATION_IN_PROGRESS",
      rejectedCodes.every((c: string) => c === "OPERATION_IN_PROGRESS"),
      `got: ${JSON.stringify(rejectedCodes)}`);
    check("H.concurrency: no raw SQL/Drizzle error",
      !rejectedCodes.some((c: string) => /error|Error|drizzle|postgres|23505|23503/.test(c)));
    check("H.concurrency: no IDEMPOTENCY_CONFLICT",
      !rejectedCodes.includes("IDEMPOTENCY_CONFLICT"));
    check("H.concurrency: no IDEMPOTENCY_OWNERSHIP_LOST",
      !rejectedCodes.includes("IDEMPOTENCY_OWNERSHIP_LOST"));
  }
}

// ===========================================================================
// SECTION: quality-value
// ===========================================================================
async function qualityValue(sql: any, db: any) {
  console.log("\n=== SECTION: quality-value ===");
  await cleanup(sql);
  let testId: string;
  {
    const t = await makeQtService(db).createQualityTest(user, qtEff, {
      testDate: "2026-08-06", linkedEntityType: "inventory_item", linkedEntityId: ITEM, idempotencyKey: "qv-seed",
    });
    testId = t.qualityTestId;
  }
  const KEY_SRC = "qv-src";
  const KEY_RT = "qv-rt";
  const KEY_OL = "qv-ol";
  const KEY_CC = "qv-cc";

  // A. Success
  {
    const aB = await countAudit(sql, "quality_test.value.record");
    const r = await makeQtService(db).recordQualityTestValue(user, qtEff, {
      qualityTestId: testId, parameterName: "C", parameterCode: "CNT", valueStatus: "pass", idempotencyKey: KEY_SRC,
    });
    check("A.success: valueId", !!r.valueId);
    check("A.success: 1 value", await countRows(sql, "quality_test_values") === 1);
    check("A.success: audit +1", await countAudit(sql, "quality_test.value.record") === aB + 1);
    check("A.success: idem succeeded", await getIdemState(sql, "quality_test.value.record", KEY_SRC) === "succeeded");
    check("A.success: owner token non-null", await getIdemOwnerTokenNonNullable(sql, "quality_test.value.record", KEY_SRC));
  }
  // B. Replay
  {
    const aB = await countAudit(sql, "quality_test.value.record");
    const r = await makeQtService(db).recordQualityTestValue(user, qtEff, {
      qualityTestId: testId, parameterName: "C", parameterCode: "CNT", valueStatus: "pass", idempotencyKey: KEY_SRC,
    });
    check("B.replay: valueId", !!r.valueId);
    check("B.replay: 1 value", await countRows(sql, "quality_test_values") === 1);
    check("B.replay: audit +0", await countAudit(sql, "quality_test.value.record") === aB);
  }
  // C. Conflict
  {
    const vB = await countRows(sql, "quality_test_values");
    const aB = await countAudit(sql, "quality_test.value.record");
    let threw = false;
    try {
      await makeQtService(db).recordQualityTestValue(user, qtEff, {
        qualityTestId: testId, parameterName: "W", parameterCode: "WGT", valueStatus: "pass", idempotencyKey: KEY_SRC,
      });
    } catch (e: any) { if (e.code === "IDEMPOTENCY_CONFLICT") threw = true; }
    check("C.conflict: thrown", threw);
    check("C.conflict: 0 new values", await countRows(sql, "quality_test_values") === vB);
    check("C.conflict: audit +0", await countAudit(sql, "quality_test.value.record") === aB);
  }
  // D. Audit-fail with KEY_RT
  {
    const vB = await countRows(sql, "quality_test_values");
    const aB = await countAudit(sql, "quality_test.value.record");
    let threw = false;
    try {
      await makeQtService(db, { failAudit: true }).recordQualityTestValue(user, qtEff, {
        qualityTestId: testId, parameterName: "C2", parameterCode: "CNT2", valueStatus: "pass", idempotencyKey: KEY_RT,
      });
    } catch (e: any) { threw = !!e.message; }
    check("D.audit-fail: threw", threw);
    check("D.audit-fail: 0 new values", await countRows(sql, "quality_test_values") === vB);
    check("D.audit-fail: audit +0", await countAudit(sql, "quality_test.value.record") === aB);
    check("D.audit-fail: idem not succeeded", await getIdemState(sql, "quality_test.value.record", KEY_RT) !== "succeeded");
    const stateAfter = await getIdemState(sql, "quality_test.value.record", KEY_RT);
    check("D.audit-fail: state is retryable_failed", stateAfter === "retryable_failed", `state=${stateAfter}`);
  }
  // E. Retry with KEY_RT
  {
    const r = await makeQtService(db).recordQualityTestValue(user, qtEff, {
      qualityTestId: testId, parameterName: "C2", parameterCode: "CNT2", valueStatus: "pass", idempotencyKey: KEY_RT,
    });
    check("E.retry: valueId", !!r.valueId);
    check("E.retry: idem succeeded", await getIdemState(sql, "quality_test.value.record", KEY_RT) === "succeeded");
  }
  // F. Replay after retry
  {
    const aB = await countAudit(sql, "quality_test.value.record");
    const r = await makeQtService(db).recordQualityTestValue(user, qtEff, {
      qualityTestId: testId, parameterName: "C2", parameterCode: "CNT2", valueStatus: "pass", idempotencyKey: KEY_RT,
    });
    check("F.replay-after-retry: valueId", !!r.valueId);
    check("F.replay-after-retry: audit +0", await countAudit(sql, "quality_test.value.record") === aB);
  }
  // G. Owner-loss / takeover / rollback / reclaim / replay (KEY_OL)
  await proveOwnerLoss(sql, db, {
    scope: "quality_test.value.record",
    key: KEY_OL,
    label: "G.recordQualityTestValue.owner-loss",
    claimInput: {
      qualityTestId: testId, parameterName: "OL", parameterCode: "OLOL",
      measuredValue: null, valueStatus: "pass", notes: null,
    },
    runCommand: (svc) => svc.recordQualityTestValue(user, qtEff, {
      qualityTestId: testId, parameterName: "OL", parameterCode: "OLOL", valueStatus: "pass", idempotencyKey: KEY_OL,
    }),
    countBusinessDelta: async () => ({
      table: "quality_test_values",
      before: await countRows(sql, "quality_test_values"),
      after: await countRows(sql, "quality_test_values"),
    }),
    auditActionType: "quality_test.value.record",
    docSeqType: null,
    producesHold: false,
  });
  // H. Concurrency (KEY_CC)
  {
    const aB = await countAudit(sql, "quality_test.value.record");
    const svc = makeQtService(db);
    const input = {
      qualityTestId: testId, parameterName: "C3", parameterCode: "CNT3",
      valueStatus: "pass" as const, idempotencyKey: KEY_CC,
    };
    const results = await Promise.allSettled([
      svc.recordQualityTestValue(user, qtEff, input),
      svc.recordQualityTestValue(user, qtEff, input),
    ]);
    const outcomes = results.map((r, i) =>
      r.status === "fulfilled" ? `c${i}:fulfilled` : `c${i}:rejected(${(r as any).reason?.code ?? "unknown"})`);
    console.log(`    Concurrency: ${outcomes.join(", ")}`);
    const rejectedCodes = results
      .filter((r) => r.status === "rejected")
      .map((r) => (r as any).reason?.code ?? (r as any).reason?.name ?? "unknown");
    const cnt3 = await sql.unsafe(
      `SELECT COUNT(*)::int as c FROM quality_test_values WHERE tenant_id = $1 AND parameter_code = $2`,
      [T, "CNT3"]);
    check("H.concurrency: 1 CNT3 value", cnt3[0].c === 1);
    check("H.concurrency: audit +1", await countAudit(sql, "quality_test.value.record") === aB + 1);
    const idem = await sql.unsafe(
      `SELECT state FROM idempotency_records WHERE tenant_id = $1 AND operation_scope = $2 AND idempotency_key = $3`,
      [T, "quality_test.value.record", KEY_CC]);
    check("H.concurrency: 1 idem", idem.length === 1);
    check("H.concurrency: succeeded", idem[0].state === "succeeded");
    check("H.concurrency: rejected codes only OPERATION_IN_PROGRESS",
      rejectedCodes.every((c: string) => c === "OPERATION_IN_PROGRESS"),
      `got: ${JSON.stringify(rejectedCodes)}`);
    check("H.concurrency: no IDEMPOTENCY_CONFLICT", !rejectedCodes.includes("IDEMPOTENCY_CONFLICT"));
    check("H.concurrency: no IDEMPOTENCY_OWNERSHIP_LOST", !rejectedCodes.includes("IDEMPOTENCY_OWNERSHIP_LOST"));
  }
}

// ===========================================================================
// SECTION: complaint-create
// ===========================================================================
async function complaintCreate(sql: any, db: any) {
  console.log("\n=== SECTION: complaint-create ===");
  await cleanup(sql);
  const KEY_SRC = "cc-src";
  const KEY_RT = "cc-rt";
  const KEY_OL = "cc-ol";
  const KEY_CC = "cc-cc";

  // A. Success
  {
    const aB = await countAudit(sql, "complaint.create");
    const r = await makeCompService(db).createComplaint(user, compEff, {
      complaintDate: "2026-08-06", subject: "T", customerId: CUST, idempotencyKey: KEY_SRC,
    });
    check("A.success: created", r.action === "created");
    check("A.success: 1 complaint", await countRows(sql, "complaints") === 1);
    check("A.success: audit +1", await countAudit(sql, "complaint.create") === aB + 1);
    check("A.success: idem succeeded", await getIdemState(sql, "complaint.create", KEY_SRC) === "succeeded");
    check("A.success: owner token non-null", await getIdemOwnerTokenNonNullable(sql, "complaint.create", KEY_SRC));
    check("A.success: doc_seq=1", await getDocSeq(sql, "complaint") === 1);
  }
  // B. Replay
  {
    const aB = await countAudit(sql, "complaint.create");
    const dsB = await getDocSeq(sql, "complaint");
    const r = await makeCompService(db).createComplaint(user, compEff, {
      complaintDate: "2026-08-06", subject: "T", customerId: CUST, idempotencyKey: KEY_SRC,
    });
    check("B.replay: replayed", r.action === "replayed");
    check("B.replay: audit +0", await countAudit(sql, "complaint.create") === aB);
    check("B.replay: doc_seq unchanged", await getDocSeq(sql, "complaint") === dsB);
    check("B.replay: still 1 complaint", await countRows(sql, "complaints") === 1);
  }
  // C. Conflict
  {
    const cB = await countRows(sql, "complaints");
    const aB = await countAudit(sql, "complaint.create");
    const dsB = await getDocSeq(sql, "complaint");
    let threw = false;
    try {
      await makeCompService(db).createComplaint(user, compEff, {
        complaintDate: "2026-08-06", subject: "Different", customerId: CUST, idempotencyKey: KEY_SRC,
      });
    } catch (e: any) { if (e.code === "IDEMPOTENCY_CONFLICT") threw = true; }
    check("C.conflict: thrown", threw);
    check("C.conflict: 0 new", await countRows(sql, "complaints") === cB);
    check("C.conflict: audit +0", await countAudit(sql, "complaint.create") === aB);
    check("C.conflict: doc_seq unchanged", await getDocSeq(sql, "complaint") === dsB);
  }
  // D. Audit-fail with KEY_RT
  await cleanup(sql);
  {
    const cB = await countRows(sql, "complaints");
    const aB = await countAudit(sql, "complaint.create");
    const dsB = await getDocSeq(sql, "complaint");
    let threw = false;
    try {
      await makeCompService(db, { failAudit: true }).createComplaint(user, compEff, {
        complaintDate: "2026-08-06", subject: "T", customerId: CUST, idempotencyKey: KEY_RT,
      });
    } catch (e: any) { threw = !!e.message; }
    check("D.audit-fail: threw", threw);
    check("D.audit-fail: 0 complaints", await countRows(sql, "complaints") === cB);
    check("D.audit-fail: audit +0", await countAudit(sql, "complaint.create") === aB);
    check("D.audit-fail: doc_seq unchanged", await getDocSeq(sql, "complaint") === dsB);
    check("D.audit-fail: idem not succeeded", await getIdemState(sql, "complaint.create", KEY_RT) !== "succeeded");
    const stateAfter = await getIdemState(sql, "complaint.create", KEY_RT);
    check("D.audit-fail: state is retryable_failed", stateAfter === "retryable_failed", `state=${stateAfter}`);
  }
  // E. Retry with KEY_RT
  {
    const r = await makeCompService(db).createComplaint(user, compEff, {
      complaintDate: "2026-08-06", subject: "T", customerId: CUST, idempotencyKey: KEY_RT,
    });
    check("E.retry: created", r.action === "created");
    check("E.retry: 1 complaint", await countRows(sql, "complaints") === 1);
    check("E.retry: idem succeeded", await getIdemState(sql, "complaint.create", KEY_RT) === "succeeded");
  }
  // F. Replay after retry
  {
    const aB = await countAudit(sql, "complaint.create");
    const r = await makeCompService(db).createComplaint(user, compEff, {
      complaintDate: "2026-08-06", subject: "T", customerId: CUST, idempotencyKey: KEY_RT,
    });
    check("F.replay-after-retry: replayed", r.action === "replayed");
    check("F.replay-after-retry: audit +0", await countAudit(sql, "complaint.create") === aB);
  }
  // G. Owner-loss / takeover / rollback / reclaim / replay (KEY_OL)
  await cleanup(sql);
  await proveOwnerLoss(sql, db, {
    scope: "complaint.create",
    key: KEY_OL,
    label: "G.createComplaint.owner-loss",
    claimInput: {
      complaintDate: "2026-08-06", subject: "T", customerId: CUST,
      saleId: null, saleLineId: null, itemId: null, qualityTestId: null,
      description: null, priority: "normal", notes: null,
    },
    runCommand: (svc) => svc.createComplaint(user, compEff, {
      complaintDate: "2026-08-06", subject: "T", customerId: CUST, idempotencyKey: KEY_OL,
    }),
    countBusinessDelta: async () => ({
      table: "complaints",
      before: await countRows(sql, "complaints"),
      after: await countRows(sql, "complaints"),
    }),
    auditActionType: "complaint.create",
    docSeqType: "complaint",
    producesHold: false,
  });
  // H. Concurrency
  await cleanup(sql);
  {
    const aB = await countAudit(sql, "complaint.create");
    const dsB = await getDocSeq(sql, "complaint");
    const svc = makeCompService(db);
    const input = {
      complaintDate: "2026-08-06", subject: "Concurrent", customerId: CUST, idempotencyKey: KEY_CC,
    };
    const results = await Promise.allSettled([
      svc.createComplaint(user, compEff, input),
      svc.createComplaint(user, compEff, input),
    ]);
    const outcomes = results.map((r, i) =>
      r.status === "fulfilled" ? `c${i}:fulfilled(${r.value.action})`
        : `c${i}:rejected(${(r as any).reason?.code ?? (r as any).reason?.name ?? "unknown"})`);
    console.log(`    Concurrency: ${outcomes.join(", ")}`);
    const rejectedCodes = results
      .filter((r) => r.status === "rejected")
      .map((r) => (r as any).reason?.code ?? (r as any).reason?.name ?? "unknown");
    check("H.concurrency: 1 complaint", await countRows(sql, "complaints") === 1);
    check("H.concurrency: audit +1", await countAudit(sql, "complaint.create") === aB + 1);
    check("H.concurrency: doc_seq +1", await getDocSeq(sql, "complaint") === (dsB ?? 0) + 1);
    const idem = await sql.unsafe(
      `SELECT state FROM idempotency_records WHERE tenant_id = $1 AND operation_scope = $2 AND idempotency_key = $3`,
      [T, "complaint.create", KEY_CC]);
    check("H.concurrency: 1 idem", idem.length === 1);
    check("H.concurrency: succeeded", idem[0].state === "succeeded");
    check("H.concurrency: rejected codes only OPERATION_IN_PROGRESS",
      rejectedCodes.every((c: string) => c === "OPERATION_IN_PROGRESS"),
      `got: ${JSON.stringify(rejectedCodes)}`);
    check("H.concurrency: no IDEMPOTENCY_CONFLICT", !rejectedCodes.includes("IDEMPOTENCY_CONFLICT"));
    check("H.concurrency: no IDEMPOTENCY_OWNERSHIP_LOST", !rejectedCodes.includes("IDEMPOTENCY_OWNERSHIP_LOST"));
  }
}

// ===========================================================================
// SECTION: complaint-update
// ===========================================================================
async function complaintUpdate(sql: any, db: any) {
  console.log("\n=== SECTION: complaint-update ===");
  await cleanup(sql);
  let complaintId: string;
  {
    const c = await makeCompService(db).createComplaint(user, compEff, {
      complaintDate: "2026-08-06", subject: "T", customerId: CUST, idempotencyKey: "cu-seed",
    });
    complaintId = c.complaintId;
  }
  const KEY_SRC = "cu-src";
  const KEY_RT = "cu-rt";
  const KEY_OL = "cu-ol";
  const KEY_CC = "cu-cc";

  // A. Success
  {
    const aB = await countAudit(sql, "complaint.update");
    const r = await makeCompService(db).updateComplaint(user, compEff, {
      complaintId, status: "investigating", idempotencyKey: KEY_SRC,
    });
    check("A.success: updated", r.action === "updated");
    check("A.success: audit +1", await countAudit(sql, "complaint.update") === aB + 1);
    check("A.success: idem succeeded", await getIdemState(sql, "complaint.update", KEY_SRC) === "succeeded");
    check("A.success: owner token non-null", await getIdemOwnerTokenNonNullable(sql, "complaint.update", KEY_SRC));
  }
  // B. Replay
  {
    const aB = await countAudit(sql, "complaint.update");
    const r = await makeCompService(db).updateComplaint(user, compEff, {
      complaintId, status: "investigating", idempotencyKey: KEY_SRC,
    });
    check("B.replay: replayed", r.action === "replayed");
    check("B.replay: audit +0", await countAudit(sql, "complaint.update") === aB);
  }
  // C. Conflict
  {
    const aB = await countAudit(sql, "complaint.update");
    let threw = false;
    try {
      await makeCompService(db).updateComplaint(user, compEff, {
        complaintId, status: "resolved", idempotencyKey: KEY_SRC,
      });
    } catch (e: any) { if (e.code === "IDEMPOTENCY_CONFLICT") threw = true; }
    check("C.conflict: thrown", threw);
    check("C.conflict: audit +0", await countAudit(sql, "complaint.update") === aB);
  }
  // D. Audit-fail with KEY_RT
  {
    const aB = await countAudit(sql, "complaint.update");
    let threw = false;
    try {
      await makeCompService(db, { failAudit: true }).updateComplaint(user, compEff, {
        complaintId, status: "resolved", idempotencyKey: KEY_RT,
      });
    } catch (e: any) { threw = !!e.message; }
    check("D.audit-fail: threw", threw);
    check("D.audit-fail: audit +0", await countAudit(sql, "complaint.update") === aB);
    check("D.audit-fail: idem not succeeded", await getIdemState(sql, "complaint.update", KEY_RT) !== "succeeded");
    const stateAfter = await getIdemState(sql, "complaint.update", KEY_RT);
    check("D.audit-fail: state is retryable_failed", stateAfter === "retryable_failed", `state=${stateAfter}`);
    const comp = await sql.unsafe(`SELECT status FROM complaints WHERE tenant_id = $1 AND id = $2`, [T, complaintId]);
    check("D.audit-fail: status unchanged", comp[0].status === "investigating");
  }
  // E. Retry with KEY_RT
  {
    const r = await makeCompService(db).updateComplaint(user, compEff, {
      complaintId, status: "resolved", idempotencyKey: KEY_RT,
    });
    check("E.retry: updated", r.action === "updated");
    check("E.retry: idem succeeded", await getIdemState(sql, "complaint.update", KEY_RT) === "succeeded");
  }
  // F. Replay after retry
  {
    const aB = await countAudit(sql, "complaint.update");
    const r = await makeCompService(db).updateComplaint(user, compEff, {
      complaintId, status: "resolved", idempotencyKey: KEY_RT,
    });
    check("F.replay-after-retry: replayed", r.action === "replayed");
    check("F.replay-after-retry: audit +0", await countAudit(sql, "complaint.update") === aB);
  }
  // G. Owner-loss / takeover / rollback / reclaim / replay (KEY_OL)
  // For update: we need a fresh complaint to update (since the previous
  // updates already mutated status).
  await cleanup(sql);
  const olComplaint = await makeCompService(db).createComplaint(user, compEff, {
    complaintDate: "2026-08-06", subject: "OL", customerId: CUST, idempotencyKey: "cu-ol-seed",
  });
  await proveOwnerLoss(sql, db, {
    scope: "complaint.update",
    key: KEY_OL,
    label: "G.updateComplaint.owner-loss",
    claimInput: {
      complaintId: olComplaint.complaintId, status: "investigating",
      investigationNotes: null, resolutionNotes: null, resolutionType: null, notes: null,
    },
    runCommand: (svc) => svc.updateComplaint(user, compEff, {
      complaintId: olComplaint.complaintId, status: "investigating", idempotencyKey: KEY_OL,
    }),
    countBusinessDelta: async () => {
      // For update, business mutation = status change. Count by checking
      // how many complaints have status='investigating' (vs 'open').
      const r = await sql.unsafe(
        `SELECT COUNT(*)::int as c FROM complaints WHERE tenant_id = $1 AND status = 'investigating'`,
        [T]);
      return { table: "complaints_status_investigating", before: r[0].c, after: r[0].c };
    },
    auditActionType: "complaint.update",
    docSeqType: null,
    producesHold: false,
  });
  // H. Concurrency
  {
    const aB = await countAudit(sql, "complaint.update");
    const svc = makeCompService(db);
    const input = { complaintId: olComplaint.complaintId, status: "investigating" as const, idempotencyKey: KEY_CC };
    const results = await Promise.allSettled([
      svc.updateComplaint(user, compEff, input),
      svc.updateComplaint(user, compEff, input),
    ]);
    const outcomes = results.map((r, i) =>
      r.status === "fulfilled" ? `c${i}:fulfilled(${r.value.action})`
        : `c${i}:rejected(${(r as any).reason?.code ?? (r as any).reason?.name ?? "unknown"})`);
    console.log(`    Concurrency: ${outcomes.join(", ")}`);
    const rejectedCodes = results
      .filter((r) => r.status === "rejected")
      .map((r) => (r as any).reason?.code ?? (r as any).reason?.name ?? "unknown");
    check("H.concurrency: audit +1", await countAudit(sql, "complaint.update") === aB + 1);
    const idem = await sql.unsafe(
      `SELECT state FROM idempotency_records WHERE tenant_id = $1 AND operation_scope = $2 AND idempotency_key = $3`,
      [T, "complaint.update", KEY_CC]);
    check("H.concurrency: 1 idem", idem.length === 1);
    check("H.concurrency: succeeded", idem[0].state === "succeeded");
    check("H.concurrency: rejected codes only OPERATION_IN_PROGRESS",
      rejectedCodes.every((c: string) => c === "OPERATION_IN_PROGRESS"),
      `got: ${JSON.stringify(rejectedCodes)}`);
    check("H.concurrency: no IDEMPOTENCY_CONFLICT", !rejectedCodes.includes("IDEMPOTENCY_CONFLICT"));
    check("H.concurrency: no IDEMPOTENCY_OWNERSHIP_LOST", !rejectedCodes.includes("IDEMPOTENCY_OWNERSHIP_LOST"));
  }
}

// ===========================================================================
// SECTION: quality-review
// ===========================================================================
async function qualityReview(sql: any, db: any) {
  console.log("\n=== SECTION: quality-review ===");
  await cleanup(sql);
  let testId: string;
  {
    const t = await makeQtService(db).createQualityTest(user, qtEff, {
      testDate: "2026-08-06", linkedEntityType: "inventory_item", linkedEntityId: ITEM, idempotencyKey: "qr-seed",
    });
    testId = t.qualityTestId;
  }
  const KEY_SRC = "qr-src";
  const KEY_RT = "qr-rt";
  const KEY_OL = "qr-ol";
  const KEY_CC = "qr-cc";

  // A. Success
  {
    const aB = await countAudit(sql, "quality_test.review");
    const r = await makeQtService(db).reviewQualityTest(user, revEff, {
      qualityTestId: testId, testStatus: "accepted", riskClassification: "none", idempotencyKey: KEY_SRC,
    });
    check("A.success: reviewed", r.action === "reviewed");
    check("A.success: audit +1", await countAudit(sql, "quality_test.review") === aB + 1);
    check("A.success: idem succeeded", await getIdemState(sql, "quality_test.review", KEY_SRC) === "succeeded");
    check("A.success: owner token non-null", await getIdemOwnerTokenNonNullable(sql, "quality_test.review", KEY_SRC));
  }
  // B. Replay
  {
    const aB = await countAudit(sql, "quality_test.review");
    const r = await makeQtService(db).reviewQualityTest(user, revEff, {
      qualityTestId: testId, testStatus: "accepted", riskClassification: "none", idempotencyKey: KEY_SRC,
    });
    check("B.replay: replayed", r.action === "replayed");
    check("B.replay: audit +0", await countAudit(sql, "quality_test.review") === aB);
  }
  // C. Conflict
  {
    const aB = await countAudit(sql, "quality_test.review");
    let threw = false;
    try {
      await makeQtService(db).reviewQualityTest(user, revEff, {
        qualityTestId: testId, testStatus: "blocked", riskClassification: "blocked", idempotencyKey: KEY_SRC,
      });
    } catch (e: any) { if (e.code === "IDEMPOTENCY_CONFLICT") threw = true; }
    check("C.conflict: thrown", threw);
    check("C.conflict: audit +0", await countAudit(sql, "quality_test.review") === aB);
  }
  // D. Audit-fail with KEY_RT
  {
    const aB = await countAudit(sql, "quality_test.review");
    let threw = false;
    try {
      await makeQtService(db, { failAudit: true }).reviewQualityTest(user, revEff, {
        qualityTestId: testId, testStatus: "blocked", riskClassification: "blocked", idempotencyKey: KEY_RT,
      });
    } catch (e: any) { threw = !!e.message; }
    check("D.audit-fail: threw", threw);
    check("D.audit-fail: audit +0", await countAudit(sql, "quality_test.review") === aB);
    check("D.audit-fail: idem not succeeded", await getIdemState(sql, "quality_test.review", KEY_RT) !== "succeeded");
    const stateAfter = await getIdemState(sql, "quality_test.review", KEY_RT);
    check("D.audit-fail: state is retryable_failed", stateAfter === "retryable_failed", `state=${stateAfter}`);
    const qt = await sql.unsafe(`SELECT test_status FROM quality_tests WHERE tenant_id = $1 AND id = $2`, [T, testId]);
    check("D.audit-fail: status unchanged", qt[0].test_status === "accepted");
  }
  // E. Retry with KEY_RT
  {
    const r = await makeQtService(db).reviewQualityTest(user, revEff, {
      qualityTestId: testId, testStatus: "blocked", riskClassification: "blocked", idempotencyKey: KEY_RT,
    });
    check("E.retry: reviewed", r.action === "reviewed");
    check("E.retry: idem succeeded", await getIdemState(sql, "quality_test.review", KEY_RT) === "succeeded");
  }
  // F. Replay after retry
  {
    const aB = await countAudit(sql, "quality_test.review");
    const r = await makeQtService(db).reviewQualityTest(user, revEff, {
      qualityTestId: testId, testStatus: "blocked", riskClassification: "blocked", idempotencyKey: KEY_RT,
    });
    check("F.replay-after-retry: replayed", r.action === "replayed");
    check("F.replay-after-retry: audit +0", await countAudit(sql, "quality_test.review") === aB);
  }
  // G. Owner-loss / takeover / rollback / reclaim / replay (KEY_OL)
  // Need a fresh test (previous updates mutated status).
  await cleanup(sql);
  const olTest = await makeQtService(db).createQualityTest(user, qtEff, {
    testDate: "2026-08-06", linkedEntityType: "inventory_item", linkedEntityId: ITEM, idempotencyKey: "qr-ol-seed",
  });
  await proveOwnerLoss(sql, db, {
    scope: "quality_test.review",
    key: KEY_OL,
    label: "G.reviewQualityTest.owner-loss",
    claimInput: {
      qualityTestId: olTest.qualityTestId, testStatus: "blocked", riskClassification: "blocked", reviewNotes: null,
    },
    runCommand: (svc) => svc.reviewQualityTest(user, revEff, {
      qualityTestId: olTest.qualityTestId, testStatus: "blocked", riskClassification: "blocked", idempotencyKey: KEY_OL,
    }),
    countBusinessDelta: async () => {
      // Count holds created (review with blocked creates a hold).
      const r = await sql.unsafe(
        `SELECT COUNT(*)::int as c FROM quality_holds WHERE tenant_id = $1`,
        [T]);
      return { table: "quality_holds", before: r[0].c, after: r[0].c };
    },
    auditActionType: "quality_test.review",
    docSeqType: null,
    producesHold: true,
  });
  // H. Concurrency
  {
    const aB = await countAudit(sql, "quality_test.review");
    const svc = makeQtService(db);
    const input = {
      qualityTestId: olTest.qualityTestId, testStatus: "blocked" as const,
      riskClassification: "blocked" as const, idempotencyKey: KEY_CC,
    };
    const results = await Promise.allSettled([
      svc.reviewQualityTest(user, revEff, input),
      svc.reviewQualityTest(user, revEff, input),
    ]);
    const outcomes = results.map((r, i) =>
      r.status === "fulfilled" ? `c${i}:fulfilled(${r.value.action})`
        : `c${i}:rejected(${(r as any).reason?.code ?? (r as any).reason?.name ?? "unknown"})`);
    console.log(`    Concurrency: ${outcomes.join(", ")}`);
    const rejectedCodes = results
      .filter((r) => r.status === "rejected")
      .map((r) => (r as any).reason?.code ?? (r as any).reason?.name ?? "unknown");
    check("H.concurrency: audit +1", await countAudit(sql, "quality_test.review") === aB + 1);
    const idem = await sql.unsafe(
      `SELECT state FROM idempotency_records WHERE tenant_id = $1 AND operation_scope = $2 AND idempotency_key = $3`,
      [T, "quality_test.review", KEY_CC]);
    check("H.concurrency: 1 idem", idem.length === 1);
    check("H.concurrency: succeeded", idem[0].state === "succeeded");
    check("H.concurrency: rejected codes only OPERATION_IN_PROGRESS",
      rejectedCodes.every((c: string) => c === "OPERATION_IN_PROGRESS"),
      `got: ${JSON.stringify(rejectedCodes)}`);
    check("H.concurrency: no IDEMPOTENCY_CONFLICT", !rejectedCodes.includes("IDEMPOTENCY_CONFLICT"));
    check("H.concurrency: no IDEMPOTENCY_OWNERSHIP_LOST", !rejectedCodes.includes("IDEMPOTENCY_OWNERSHIP_LOST"));
  }
}

// ===========================================================================
// SECTION: cleanup
// ===========================================================================
async function cleanupSection(sql: any) {
  console.log("\n=== SECTION: cleanup ===");
  await cleanupAll(sql);
  check("cleanup: 0 quality_tests", await countRows(sql, "quality_tests") === 0);
  check("cleanup: 0 quality_test_values", await countRows(sql, "quality_test_values") === 0);
  check("cleanup: 0 quality_holds", await countRows(sql, "quality_holds") === 0);
  check("cleanup: 0 complaints", await countRows(sql, "complaints") === 0);
  check("cleanup: 0 document_sequences", await countRows(sql, "document_sequences") === 0);
  check("cleanup: 0 idempotency_records", await countRows(sql, "idempotency_records") === 0);
  console.log(`  INFO: Audit logs preserved (append-only). Users/tenants preserved (audit FK).`);
}

// ===========================================================================
// Main entrypoint — runs the requested section and exits 0/1.
// ===========================================================================
async function main() {
  const sql = postgres(DATABASE_URL!, {
    prepare: false, max: 10, idle_timeout: 10, connect_timeout: 10,
  });
  const db = drizzle(sql, { schema });
  const start = Date.now();
  try {
    // Setup is required for all sections except cleanup (which deletes first).
    if (SECTION !== "cleanup" && SECTION !== "diagnostics") {
      await setup(sql);
    }
    switch (SECTION) {
      case "diagnostics":      await diagnostics(sql, db); break;
      case "quality-create":   await qualityCreate(sql, db); break;
      case "quality-value":    await qualityValue(sql, db); break;
      case "complaint-create": await complaintCreate(sql, db); break;
      case "complaint-update": await complaintUpdate(sql, db); break;
      case "quality-review":   await qualityReview(sql, db); break;
      case "cleanup":          await cleanupSection(sql); break;
      default:
        console.error(`FATAL: Unknown section '${SECTION}'.`);
        process.exit(1);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
  const elapsed = Date.now() - start;
  console.log(`\n=== ${SECTION} SUMMARY ===`);
  console.log(`  PASS: ${passCount}, FAIL: ${failCount}, Duration: ${elapsed}ms`);
  if (failures.length > 0) {
    console.log("  Failures:");
    for (const f of failures) console.log(`    - ${f}`);
  }
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL:", e?.message ?? e);
  process.exit(1);
});
