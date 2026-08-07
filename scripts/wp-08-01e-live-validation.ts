/**
 * WP-08-01E — Sectioned Live PostgreSQL Validation.
 *
 * Usage: npx tsx scripts/wp-08-01e-live-validation.ts <section>
 *
 * Sections:
 *   quality-create  — createQualityTest: success, replay, conflict, audit-fail, owner-loss, retry-same-key, replay-after-retry, concurrency
 *   quality-value   — recordQualityTestValue: same set
 *   complaint-create — createComplaint: same set
 *   complaint-update — updateComplaint: same set
 *   quality-review  — reviewQualityTest: same set
 *   cleanup         — delete all deterministic QA data
 *
 * Each section finishes within ~90 seconds.
 * Exit 0 = all checks passed, 1 = at least one failed.
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/server/db/schema";
import { QualityTestDbRepository } from "@/server/services/quality-test-db-repository";
import { ComplaintDbRepository } from "@/server/services/complaint-db-repository";
import { AuditDbRepository } from "@/server/services/audit-db-repository";
import { IdempotencyDbRepository } from "@/server/services/idempotency-db-repository";
import { DocumentSequenceDbRepository } from "@/server/services/document-sequence-db-repository";
import { QualityTestService } from "@/server/services/quality-test-service";
import { ComplaintService } from "@/server/services/complaint-service";
import { IdempotencyOwnershipLostError, claimIdempotency, markSucceeded } from "@/server/services/idempotency-service";

const DATABASE_URL = process.env.DATABASE_URL!;
const T = "00000000-0000-0000-0000-000000081e40";
const U = "00000000-0000-0000-0000-000000081e41";
const ITEM = "00000000-0000-4000-8000-cccc000e0040";

let passCount = 0, failCount = 0;
const failures: string[] = [];
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { console.log(`  ✅ #${++passCount} ${label}`); }
  else { console.log(`  ❌ #${++passCount} ${label}${detail ? ` — ${detail}` : ""}`); failCount++; failures.push(label); }
}

// Fault injection wrappers
class FailingAuditRepo extends AuditDbRepository {
  async insertAuditLog(_row: any): Promise<void> { throw new Error("SIMULATED_AUDIT_FAILURE"); }
}
class FailingMarkSucceededIdemRepo extends IdempotencyDbRepository {
  async updateState(id: string, update: any): Promise<number> {
    // Only fail for "succeeded" state (markSucceeded), not for "business_failed"
    // or "retryable_failed" (markBusinessFailed/markRetryableFailed).
    if (update.state === "succeeded") {
      return 0; // Simulate ownership loss at markSucceeded
    }
    // For other states, delegate to the real implementation
    return super.updateState(id, update);
  }
}

async function setup(sql: any) {
  await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status) VALUES (${T}, ${"E4"}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${U}, ${T}, ${"e4"}, ${"E4"}, ${"e4@test.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO inventory_items (id, tenant_id, item_code, display_name_ar, item_kind, status) VALUES (${ITEM}, ${T}, ${"ITEM-E4"}, ${"Test"}, ${"raw_material"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
  await sql`SET statement_timeout = 15000`;
}

async function cleanup(sql: any) {
  await sql`DELETE FROM quality_test_values WHERE tenant_id = ${T}`;
  await sql`DELETE FROM quality_holds WHERE tenant_id = ${T}`;
  await sql`DELETE FROM quality_tests WHERE tenant_id = ${T}`;
  await sql`DELETE FROM complaints WHERE tenant_id = ${T}`;
  await sql`DELETE FROM document_sequences WHERE tenant_id = ${T}`;
  await sql`DELETE FROM idempotency_records WHERE tenant_id = ${T}`;
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
async function getDocSeq(sql: any, docType: string): Promise<number | null> {
  const r = await sql.unsafe(`SELECT last_number FROM document_sequences WHERE tenant_id = $1 AND document_type = $2`, [T, docType]);
  return r.length > 0 ? r[0].last_number : null;
}

function makeQtService(db: any, opts?: { failAudit?: boolean; failMarkSucceeded?: boolean }) {
  const tr = async <W>(work: (tx: unknown) => Promise<W>): Promise<W> => (db as any).transaction(async (tx: any) => work(tx));
  return new QualityTestService({
    qualityTestRepository: new QualityTestDbRepository(db), audit: new AuditDbRepository(db),
    idempotency: new IdempotencyDbRepository(db), documentSequence: new DocumentSequenceDbRepository(db),
    transactionRunner: tr,
    txFactories: {
      createQualityTestRepository: (tx: unknown) => new QualityTestDbRepository(tx as any),
      createIdempotency: (tx: unknown) => opts?.failMarkSucceeded ? new FailingMarkSucceededIdemRepo(tx as any) : new IdempotencyDbRepository(tx as any),
      createAudit: (tx: unknown) => opts?.failAudit ? new FailingAuditRepo(tx as any) : new AuditDbRepository(tx as any),
      createDocumentSequence: (tx: unknown) => new DocumentSequenceDbRepository(tx as any),
    },
  });
}
function makeCompService(db: any, opts?: { failAudit?: boolean; failMarkSucceeded?: boolean }) {
  const tr = async <W>(work: (tx: unknown) => Promise<W>): Promise<W> => (db as any).transaction(async (tx: any) => work(tx));
  return new ComplaintService({
    complaintRepository: new ComplaintDbRepository(db), audit: new AuditDbRepository(db),
    idempotency: new IdempotencyDbRepository(db), documentSequence: new DocumentSequenceDbRepository(db),
    transactionRunner: tr,
    txFactories: {
      createComplaintRepository: (tx: unknown) => new ComplaintDbRepository(tx as any),
      createIdempotency: (tx: unknown) => opts?.failMarkSucceeded ? new FailingMarkSucceededIdemRepo(tx as any) : new IdempotencyDbRepository(tx as any),
      createAudit: (tx: unknown) => opts?.failAudit ? new FailingAuditRepo(tx as any) : new AuditDbRepository(tx as any),
      createDocumentSequence: (tx: unknown) => new DocumentSequenceDbRepository(tx as any),
    },
  });
}

const user = { authenticated: true, tenantId: T, userId: U, name: "E4", email: "e4@test.test", authId: "e4", roles: [] } as any;
const qtEff = { assignedRoleCodes: ["quality_employee"], permissionKeys: new Set(["quality_tests.create"]), deniedFieldKeys: new Set(), workerFinancialDeny: false } as any;
const revEff = { assignedRoleCodes: ["owner"], permissionKeys: new Set(["quality_tests.create", "quality_risk_sales.approve"]), deniedFieldKeys: new Set(), workerFinancialDeny: false } as any;
const compEff = { assignedRoleCodes: ["quality_employee"], permissionKeys: new Set(["complaints.investigate"]), deniedFieldKeys: new Set(), workerFinancialDeny: false } as any;

// =====================================================================
// Section: quality-create
// =====================================================================
async function qualityCreate(sql: any, db: any) {
  console.log("\n=== SECTION: quality-create ===");
  await cleanup(sql);
  const KEY = "qc-k"; // same key for failure → retry → replay

  // A. Success
  {
    const aB = await countAudit(sql, "quality_test.create");
    const r = await makeQtService(db).createQualityTest(user, qtEff, { testDate: "2026-08-06", linkedEntityType: "inventory_item", linkedEntityId: ITEM, idempotencyKey: KEY });
    check("success: created", r.action === "created");
    check("success: 1 test", await countRows(sql, "quality_tests") === 1);
    check("success: audit +1", await countAudit(sql, "quality_test.create") === aB + 1);
    check("success: idem succeeded", await getIdemState(sql, "quality_test.create", KEY) === "succeeded");
    check("success: doc_seq=1", await getDocSeq(sql, "quality_test") === 1);
  }
  // B. Replay
  {
    const aB = await countAudit(sql, "quality_test.create");
    const dsB = await getDocSeq(sql, "quality_test");
    const r = await makeQtService(db).createQualityTest(user, qtEff, { testDate: "2026-08-06", linkedEntityType: "inventory_item", linkedEntityId: ITEM, idempotencyKey: KEY });
    check("replay: replayed", r.action === "replayed");
    check("replay: audit +0", await countAudit(sql, "quality_test.create") === aB);
    check("replay: doc_seq unchanged", await getDocSeq(sql, "quality_test") === dsB);
  }
  // C. Conflict
  {
    const aB = await countAudit(sql, "quality_test.create");
    const dsB = await getDocSeq(sql, "quality_test");
    let threw = false;
    try { await makeQtService(db).createQualityTest(user, qtEff, { testDate: "2026-08-06", linkedEntityType: "inventory_item", linkedEntityId: "00000000-0000-4000-8000-cccc00999001", idempotencyKey: KEY }); } catch (e: any) { if (e.code === "IDEMPOTENCY_CONFLICT") threw = true; }
    check("conflict: thrown", threw);
    check("conflict: audit +0", await countAudit(sql, "quality_test.create") === aB);
    check("conflict: doc_seq unchanged", await getDocSeq(sql, "quality_test") === dsB);
  }
  // D. Audit-fail rollback with SAME key K
  await cleanup(sql);
  {
    const tB = await countRows(sql, "quality_tests");
    const aB = await countAudit(sql, "quality_test.create");
    const dsB = await getDocSeq(sql, "quality_test");
    let threw = false;
    try { await makeQtService(db, { failAudit: true }).createQualityTest(user, qtEff, { testDate: "2026-08-06", linkedEntityType: "inventory_item", linkedEntityId: ITEM, idempotencyKey: KEY }); } catch (e: any) { threw = !!e.message; }
    check("audit-fail: threw", threw);
    check("audit-fail: 0 tests", await countRows(sql, "quality_tests") === tB);
    check("audit-fail: audit +0", await countAudit(sql, "quality_test.create") === aB);
    check("audit-fail: doc_seq unchanged", await getDocSeq(sql, "quality_test") === dsB);
    check("audit-fail: idem not succeeded", await getIdemState(sql, "quality_test.create", KEY) !== "succeeded");
  }
  // E. Retry with SAME key K
  {
    const aB = await countAudit(sql, "quality_test.create");
    const r = await makeQtService(db).createQualityTest(user, qtEff, { testDate: "2026-08-06", linkedEntityType: "inventory_item", linkedEntityId: ITEM, idempotencyKey: KEY });
    check("retry-same-key: created", r.action === "created");
    check("retry-same-key: 1 test", await countRows(sql, "quality_tests") === 1);
    check("retry-same-key: audit +1", await countAudit(sql, "quality_test.create") === aB + 1);
    check("retry-same-key: idem succeeded", await getIdemState(sql, "quality_test.create", KEY) === "succeeded");
  }
  // F. Replay after retry
  {
    const aB = await countAudit(sql, "quality_test.create");
    const r = await makeQtService(db).createQualityTest(user, qtEff, { testDate: "2026-08-06", linkedEntityType: "inventory_item", linkedEntityId: ITEM, idempotencyKey: KEY });
    check("replay-after-retry: replayed", r.action === "replayed");
    check("replay-after-retry: audit +0", await countAudit(sql, "quality_test.create") === aB);
  }
  // G. Owner-loss rollback with SAME key K2
  await cleanup(sql);
  {
    const tB = await countRows(sql, "quality_tests");
    const aB = await countAudit(sql, "quality_test.create");
    const KEY2 = "qc-ol";
    let threwOwnership = false;
    try { await makeQtService(db, { failMarkSucceeded: true }).createQualityTest(user, qtEff, { testDate: "2026-08-06", linkedEntityType: "inventory_item", linkedEntityId: ITEM, idempotencyKey: KEY2 }); } catch (e: any) { threwOwnership = e instanceof IdempotencyOwnershipLostError || e.name === "IdempotencyOwnershipLostError"; }
    check("owner-loss: IdempotencyOwnershipLostError", threwOwnership);
    check("owner-loss: 0 tests", await countRows(sql, "quality_tests") === tB);
    check("owner-loss: audit +0", await countAudit(sql, "quality_test.create") === aB);
    check("owner-loss: idem not succeeded", await getIdemState(sql, "quality_test.create", KEY2) !== "succeeded");
    // Owner-loss marks business_failed (durable) — same key returns replay (terminal failure).
    // This is the documented contract: ownership loss is terminal for the same key.
    // The replay returns IDEMPOTENCY_REPLAY_OF_FAILURE because the responseBody
    // doesn't contain a valid result.
    let threwReplayOfFailure = false;
    try {
      await makeQtService(db).createQualityTest(user, qtEff, { testDate: "2026-08-06", linkedEntityType: "inventory_item", linkedEntityId: ITEM, idempotencyKey: KEY2 });
    } catch (e: any) {
      if (e.code === "IDEMPOTENCY_REPLAY_OF_FAILURE") threwReplayOfFailure = true;
    }
    check("owner-loss same-key: IDEMPOTENCY_REPLAY_OF_FAILURE (terminal)", threwReplayOfFailure);
    // Recovery: use a new key
    const KEY3 = "qc-ol-recovery";
    const r = await makeQtService(db).createQualityTest(user, qtEff, { testDate: "2026-08-06", linkedEntityType: "inventory_item", linkedEntityId: ITEM, idempotencyKey: KEY3 });
    check("owner-loss recovery: created", r.action === "created");
    check("owner-loss recovery: idem succeeded", await getIdemState(sql, "quality_test.create", KEY3) === "succeeded");
  }
  // H. Concurrency
  await cleanup(sql);
  {
    const aB = await countAudit(sql, "quality_test.create");
    const dsB = await getDocSeq(sql, "quality_test");
    const CK = "qc-cc";
    const svc = makeQtService(db);
    const input = { testDate: "2026-08-06", linkedEntityType: "inventory_item" as any, linkedEntityId: ITEM, idempotencyKey: CK };
    const results = await Promise.allSettled([svc.createQualityTest(user, qtEff, input), svc.createQualityTest(user, qtEff, input)]);
    const outcomes = results.map((r, i) => r.status === "fulfilled" ? `c${i}:fulfilled(${r.value.action})` : `c${i}:rejected(${(r as any).reason?.code ?? (r as any).reason?.name ?? "unknown"})`);
    console.log(`    Concurrency: ${outcomes.join(", ")}`);
    check("concurrency: 1 test", await countRows(sql, "quality_tests") === 1);
    check("concurrency: audit +1", await countAudit(sql, "quality_test.create") === aB + 1);
    const idem = await sql.unsafe(`SELECT state FROM idempotency_records WHERE tenant_id = $1 AND operation_scope = $2 AND idempotency_key = $3`, [T, "quality_test.create", CK]);
    check("concurrency: 1 idem", idem.length === 1);
    check("concurrency: succeeded", idem[0].state === "succeeded");
    check("concurrency: doc_seq +1", await getDocSeq(sql, "quality_test") === (dsB ?? 0) + 1);
    const rej = results.filter(r => r.status === "rejected");
    if (rej.length > 0) {
      const err = (rej[0] as any).reason;
      check("concurrency: rejected is OPERATION_IN_PROGRESS", err?.code === "OPERATION_IN_PROGRESS", `got: ${err?.code ?? err?.name}`);
    } else {
      check("concurrency: both fulfilled", results.every(r => r.status === "fulfilled"));
    }
  }
}

// =====================================================================
// Section: quality-value
// =====================================================================
async function qualityValue(sql: any, db: any) {
  console.log("\n=== SECTION: quality-value ===");
  await cleanup(sql);
  let testId: string;
  { const t = await makeQtService(db).createQualityTest(user, qtEff, { testDate: "2026-08-06", linkedEntityType: "inventory_item", linkedEntityId: ITEM, idempotencyKey: "qv-seed" }); testId = t.qualityTestId; }
  const KEY_S = "qv-success"; // key for success/replay/conflict
  const KEY = "qv-k"; // key for audit-fail → retry → replay

  // Success (uses KEY_S)
  { const aB = await countAudit(sql, "quality_test.value.record"); const r = await makeQtService(db).recordQualityTestValue(user, qtEff, { qualityTestId: testId, parameterName: "C", parameterCode: "CNT", valueStatus: "pass", idempotencyKey: KEY_S }); check("success: valueId", !!r.valueId); check("success: 1 value", await countRows(sql, "quality_test_values") === 1); check("success: audit +1", await countAudit(sql, "quality_test.value.record") === aB + 1); check("success: idem succeeded", await getIdemState(sql, "quality_test.value.record", KEY_S) === "succeeded"); }
  // Replay (uses KEY_S)
  { const aB = await countAudit(sql, "quality_test.value.record"); const r = await makeQtService(db).recordQualityTestValue(user, qtEff, { qualityTestId: testId, parameterName: "C", parameterCode: "CNT", valueStatus: "pass", idempotencyKey: KEY_S }); check("replay: valueId", !!r.valueId); check("replay: 1 value", await countRows(sql, "quality_test_values") === 1); check("replay: audit +0", await countAudit(sql, "quality_test.value.record") === aB); }
  // Conflict (uses KEY_S with different body)
  { const vB = await countRows(sql, "quality_test_values"); const aB = await countAudit(sql, "quality_test.value.record"); let threw = false; try { await makeQtService(db).recordQualityTestValue(user, qtEff, { qualityTestId: testId, parameterName: "W", parameterCode: "WGT", valueStatus: "pass", idempotencyKey: KEY_S }); } catch (e: any) { if (e.code === "IDEMPOTENCY_CONFLICT") threw = true; } check("conflict: thrown", threw); check("conflict: 0 new values", await countRows(sql, "quality_test_values") === vB); check("conflict: audit +0", await countAudit(sql, "quality_test.value.record") === aB); }
  // Audit-fail with KEY + same payload as retry
  { const vB = await countRows(sql, "quality_test_values"); const aB = await countAudit(sql, "quality_test.value.record"); let threw = false; try { await makeQtService(db, { failAudit: true }).recordQualityTestValue(user, qtEff, { qualityTestId: testId, parameterName: "C2", parameterCode: "CNT2", valueStatus: "pass", idempotencyKey: KEY }); } catch (e: any) { threw = !!e.message; } check("audit-fail: threw", threw); check("audit-fail: 0 new values", await countRows(sql, "quality_test_values") === vB); check("audit-fail: audit +0", await countAudit(sql, "quality_test.value.record") === aB); check("audit-fail: idem not succeeded", await getIdemState(sql, "quality_test.value.record", KEY) !== "succeeded"); }
  // Retry same key + same payload
  { const r = await makeQtService(db).recordQualityTestValue(user, qtEff, { qualityTestId: testId, parameterName: "C2", parameterCode: "CNT2", valueStatus: "pass", idempotencyKey: KEY }); check("retry: valueId", !!r.valueId); check("retry: idem succeeded", await getIdemState(sql, "quality_test.value.record", KEY) === "succeeded"); }
  // Replay after retry
  { const aB = await countAudit(sql, "quality_test.value.record"); const r = await makeQtService(db).recordQualityTestValue(user, qtEff, { qualityTestId: testId, parameterName: "C2", parameterCode: "CNT2", valueStatus: "pass", idempotencyKey: KEY }); check("replay-after-retry: valueId", !!r.valueId); check("replay-after-retry: audit +0", await countAudit(sql, "quality_test.value.record") === aB); }
  // Concurrency
  { const aB = await countAudit(sql, "quality_test.value.record"); const CK = "qv-cc"; const svc = makeQtService(db); const input = { qualityTestId: testId, parameterName: "C3", parameterCode: "CNT3", valueStatus: "pass" as const, idempotencyKey: CK }; const results = await Promise.allSettled([svc.recordQualityTestValue(user, qtEff, input), svc.recordQualityTestValue(user, qtEff, input)]); const outcomes = results.map((r, i) => r.status === "fulfilled" ? `c${i}:fulfilled` : `c${i}:rejected(${(r as any).reason?.code ?? "unknown"})`); console.log(`    Concurrency: ${outcomes.join(", ")}`); const cnt3 = await sql.unsafe(`SELECT COUNT(*)::int as c FROM quality_test_values WHERE tenant_id = $1 AND parameter_code = $2`, [T, "CNT3"]); check("concurrency: 1 CNT3 value", cnt3[0].c === 1); check("concurrency: audit +1", await countAudit(sql, "quality_test.value.record") === aB + 1); const idem = await sql.unsafe(`SELECT state FROM idempotency_records WHERE tenant_id = $1 AND operation_scope = $2 AND idempotency_key = $3`, [T, "quality_test.value.record", CK]); check("concurrency: 1 idem", idem.length === 1); check("concurrency: succeeded", idem[0].state === "succeeded"); const rej = results.filter(r => r.status === "rejected"); if (rej.length > 0) { const err = (rej[0] as any).reason; check("concurrency: rejected is OPERATION_IN_PROGRESS", err?.code === "OPERATION_IN_PROGRESS", `got: ${err?.code ?? err?.name}`); } else { check("concurrency: both fulfilled", results.every(r => r.status === "fulfilled")); } }
}

// =====================================================================
// Section: complaint-create
// =====================================================================
async function complaintCreate(sql: any, db: any) {
  console.log("\n=== SECTION: complaint-create ===");
  await cleanup(sql);
  const KEY = "cc-k";

  // Success
  { const aB = await countAudit(sql, "complaint.create"); const r = await makeCompService(db).createComplaint(user, compEff, { complaintDate: "2026-08-06", subject: "T", customerId: ITEM, idempotencyKey: KEY }); check("success: created", r.action === "created"); check("success: 1 complaint", await countRows(sql, "complaints") === 1); check("success: audit +1", await countAudit(sql, "complaint.create") === aB + 1); check("success: idem succeeded", await getIdemState(sql, "complaint.create", KEY) === "succeeded"); check("success: doc_seq=1", await getDocSeq(sql, "complaint") === 1); }
  // Replay
  { const aB = await countAudit(sql, "complaint.create"); const dsB = await getDocSeq(sql, "complaint"); const r = await makeCompService(db).createComplaint(user, compEff, { complaintDate: "2026-08-06", subject: "T", customerId: ITEM, idempotencyKey: KEY_S }); check("replay: replayed", r.action === "replayed"); check("replay: audit +0", await countAudit(sql, "complaint.create") === aB); check("replay: doc_seq unchanged", await getDocSeq(sql, "complaint") === dsB); }
  // Conflict
  { const cB = await countRows(sql, "complaints"); const aB = await countAudit(sql, "complaint.create"); const dsB = await getDocSeq(sql, "complaint"); let threw = false; try { await makeCompService(db).createComplaint(user, compEff, { complaintDate: "2026-08-06", subject: "Different", customerId: ITEM, idempotencyKey: KEY_S }); } catch (e: any) { if (e.code === "IDEMPOTENCY_CONFLICT") threw = true; } check("conflict: thrown", threw); check("conflict: 0 new", await countRows(sql, "complaints") === cB); check("conflict: audit +0", await countAudit(sql, "complaint.create") === aB); check("conflict: doc_seq unchanged", await getDocSeq(sql, "complaint") === dsB); }
  // Audit-fail + retry same key
  await cleanup(sql);
  { const cB = await countRows(sql, "complaints"); const aB = await countAudit(sql, "complaint.create"); const dsB = await getDocSeq(sql, "complaint"); let threw = false; try { await makeCompService(db, { failAudit: true }).createComplaint(user, compEff, { complaintDate: "2026-08-06", subject: "T", customerId: ITEM, idempotencyKey: KEY }); } catch (e: any) { threw = !!e.message; } check("audit-fail: threw", threw); check("audit-fail: 0 complaints", await countRows(sql, "complaints") === cB); check("audit-fail: audit +0", await countAudit(sql, "complaint.create") === aB); check("audit-fail: doc_seq unchanged", await getDocSeq(sql, "complaint") === dsB); check("audit-fail: idem not succeeded", await getIdemState(sql, "complaint.create", KEY) !== "succeeded"); }
  // Retry same key
  { const r = await makeCompService(db).createComplaint(user, compEff, { complaintDate: "2026-08-06", subject: "T", customerId: ITEM, idempotencyKey: KEY }); check("retry: created", r.action === "created"); check("retry: 1 complaint", await countRows(sql, "complaints") === 1); check("retry: idem succeeded", await getIdemState(sql, "complaint.create", KEY) === "succeeded"); }
  // Replay after retry
  { const aB = await countAudit(sql, "complaint.create"); const r = await makeCompService(db).createComplaint(user, compEff, { complaintDate: "2026-08-06", subject: "T", customerId: ITEM, idempotencyKey: KEY }); check("replay-after-retry: replayed", r.action === "replayed"); check("replay-after-retry: audit +0", await countAudit(sql, "complaint.create") === aB); }
  // Concurrency
  await cleanup(sql);
  { const aB = await countAudit(sql, "complaint.create"); const CK = "cc-cc"; const svc = makeCompService(db); const input = { complaintDate: "2026-08-06", subject: "Concurrent", customerId: ITEM, idempotencyKey: CK }; const results = await Promise.allSettled([svc.createComplaint(user, compEff, input), svc.createComplaint(user, compEff, input)]); const outcomes = results.map((r, i) => r.status === "fulfilled" ? `c${i}:fulfilled(${r.value.action})` : `c${i}:rejected(${(r as any).reason?.code ?? "unknown"})`); console.log(`    Concurrency: ${outcomes.join(", ")}`); check("concurrency: 1 complaint", await countRows(sql, "complaints") === 1); check("concurrency: audit +1", await countAudit(sql, "complaint.create") === aB + 1); const idem = await sql.unsafe(`SELECT state FROM idempotency_records WHERE tenant_id = $1 AND operation_scope = $2 AND idempotency_key = $3`, [T, "complaint.create", CK]); check("concurrency: 1 idem", idem.length === 1); check("concurrency: succeeded", idem[0].state === "succeeded"); const rej = results.filter(r => r.status === "rejected"); if (rej.length > 0) { const err = (rej[0] as any).reason; check("concurrency: rejected is OPERATION_IN_PROGRESS", err?.code === "OPERATION_IN_PROGRESS", `got: ${err?.code ?? err?.name}`); } else { check("concurrency: both fulfilled", results.every(r => r.status === "fulfilled")); } }
}

// =====================================================================
// Section: complaint-update
// =====================================================================
async function complaintUpdate(sql: any, db: any) {
  console.log("\n=== SECTION: complaint-update ===");
  await cleanup(sql);
  let complaintId: string;
  { const c = await makeCompService(db).createComplaint(user, compEff, { complaintDate: "2026-08-06", subject: "T", customerId: ITEM, idempotencyKey: "cu-seed" }); complaintId = c.complaintId; }
  const KEY_S = "cu-success";
  const KEY = "cu-k"; // for audit-fail → retry → replay

  // Success (uses KEY_S)
  { const aB = await countAudit(sql, "complaint.update"); const r = await makeCompService(db).updateComplaint(user, compEff, { complaintId, status: "investigating", idempotencyKey: KEY_S }); check("success: updated", r.action === "updated"); check("success: audit +1", await countAudit(sql, "complaint.update") === aB + 1); check("success: idem succeeded", await getIdemState(sql, "complaint.update", KEY_S) === "succeeded"); }
  // Replay (uses KEY_S)
  { const aB = await countAudit(sql, "complaint.update"); const r = await makeCompService(db).updateComplaint(user, compEff, { complaintId, status: "investigating", idempotencyKey: KEY_S }); check("replay: replayed", r.action === "replayed"); check("replay: audit +0", await countAudit(sql, "complaint.update") === aB); }
  // Conflict (uses KEY_S with different body)
  { const aB = await countAudit(sql, "complaint.update"); let threw = false; try { await makeCompService(db).updateComplaint(user, compEff, { complaintId, status: "resolved", idempotencyKey: KEY_S }); } catch (e: any) { if (e.code === "IDEMPOTENCY_CONFLICT") threw = true; } check("conflict: thrown", threw); check("conflict: audit +0", await countAudit(sql, "complaint.update") === aB); }
  // Audit-fail with KEY + same payload as retry
  { const aB = await countAudit(sql, "complaint.update"); let threw = false; try { await makeCompService(db, { failAudit: true }).updateComplaint(user, compEff, { complaintId, status: "resolved", idempotencyKey: KEY }); } catch (e: any) { threw = !!e.message; } check("audit-fail: threw", threw); check("audit-fail: audit +0", await countAudit(sql, "complaint.update") === aB); check("audit-fail: idem not succeeded", await getIdemState(sql, "complaint.update", KEY) !== "succeeded"); const comp = await sql.unsafe(`SELECT status FROM complaints WHERE tenant_id = $1 AND id = $2`, [T, complaintId]); check("audit-fail: status unchanged", comp[0].status === "investigating"); }
  // Retry same key + same payload
  { const r = await makeCompService(db).updateComplaint(user, compEff, { complaintId, status: "resolved", idempotencyKey: KEY }); check("retry: updated", r.action === "updated"); check("retry: idem succeeded", await getIdemState(sql, "complaint.update", KEY) === "succeeded"); }
  // Replay after retry
  { const aB = await countAudit(sql, "complaint.update"); const r = await makeCompService(db).updateComplaint(user, compEff, { complaintId, status: "resolved", idempotencyKey: KEY }); check("replay-after-retry: replayed", r.action === "replayed"); check("replay-after-retry: audit +0", await countAudit(sql, "complaint.update") === aB); }
}

// =====================================================================
// Section: quality-review
// =====================================================================
async function qualityReview(sql: any, db: any) {
  console.log("\n=== SECTION: quality-review ===");
  await cleanup(sql);
  let testId: string;
  { const t = await makeQtService(db).createQualityTest(user, qtEff, { testDate: "2026-08-06", linkedEntityType: "inventory_item", linkedEntityId: ITEM, idempotencyKey: "qr-seed" }); testId = t.qualityTestId; }
  const KEY_S = "qr-success";
  const KEY = "qr-k"; // for audit-fail → retry → replay

  // Success
  { const aB = await countAudit(sql, "quality_test.review"); const r = await makeQtService(db).reviewQualityTest(user, revEff, { qualityTestId: testId, testStatus: "accepted", riskClassification: "none", idempotencyKey: KEY_S }); check("success: reviewed", r.action === "reviewed"); check("success: audit +1", await countAudit(sql, "quality_test.review") === aB + 1); check("success: idem succeeded", await getIdemState(sql, "quality_test.review", KEY_S) === "succeeded"); }
  // Replay
  { const aB = await countAudit(sql, "quality_test.review"); const r = await makeQtService(db).reviewQualityTest(user, revEff, { qualityTestId: testId, testStatus: "accepted", riskClassification: "none", idempotencyKey: KEY_S }); check("replay: replayed", r.action === "replayed"); check("replay: audit +0", await countAudit(sql, "quality_test.review") === aB); }
  // Conflict
  { const aB = await countAudit(sql, "quality_test.review"); let threw = false; try { await makeQtService(db).reviewQualityTest(user, revEff, { qualityTestId: testId, testStatus: "blocked", riskClassification: "blocked", idempotencyKey: KEY_S }); } catch (e: any) { if (e.code === "IDEMPOTENCY_CONFLICT") threw = true; } check("conflict: thrown", threw); check("conflict: audit +0", await countAudit(sql, "quality_test.review") === aB); }
  // Audit-fail + retry same key
  { const aB = await countAudit(sql, "quality_test.review"); let threw = false; try { await makeQtService(db, { failAudit: true }).reviewQualityTest(user, revEff, { qualityTestId: testId, testStatus: "blocked", riskClassification: "blocked", idempotencyKey: KEY }); } catch (e: any) { threw = !!e.message; } check("audit-fail: threw", threw); check("audit-fail: audit +0", await countAudit(sql, "quality_test.review") === aB); check("audit-fail: idem not succeeded", await getIdemState(sql, "quality_test.review", KEY) !== "succeeded"); const qt = await sql.unsafe(`SELECT test_status FROM quality_tests WHERE tenant_id = $1 AND id = $2`, [T, testId]); check("audit-fail: status unchanged", qt[0].test_status === "accepted"); }
  // Retry same key
  { const r = await makeQtService(db).reviewQualityTest(user, revEff, { qualityTestId: testId, testStatus: "blocked", riskClassification: "blocked", idempotencyKey: KEY }); check("retry: reviewed", r.action === "reviewed"); check("retry: idem succeeded", await getIdemState(sql, "quality_test.review", KEY) === "succeeded"); }
  // Replay after retry
  { const aB = await countAudit(sql, "quality_test.review"); const r = await makeQtService(db).reviewQualityTest(user, revEff, { qualityTestId: testId, testStatus: "blocked", riskClassification: "blocked", idempotencyKey: KEY }); check("replay-after-retry: replayed", r.action === "replayed"); check("replay-after-retry: audit +0", await countAudit(sql, "quality_test.review") === aB); }
}

// =====================================================================
// Section: cleanup
// =====================================================================
async function cleanupSection(sql: any) {
  console.log("\n=== SECTION: cleanup ===");
  await cleanup(sql);
  check("cleanup: 0 quality_tests", await countRows(sql, "quality_tests") === 0);
  check("cleanup: 0 quality_test_values", await countRows(sql, "quality_test_values") === 0);
  check("cleanup: 0 quality_holds", await countRows(sql, "quality_holds") === 0);
  check("cleanup: 0 complaints", await countRows(sql, "complaints") === 0);
  check("cleanup: 0 document_sequences", await countRows(sql, "document_sequences") === 0);
  check("cleanup: 0 idempotency_records", await countRows(sql, "idempotency_records") === 0);
  console.log(`  ℹ️ Audit logs preserved (append-only). Users/tenants preserved (audit FK).`);
}

// =====================================================================
// Main
// =====================================================================
async function main() {
  const section = process.argv[2];
  if (!section) {
    console.error("Usage: npx tsx scripts/wp-08-01e-live-validation.ts <section>");
    console.error("Sections: quality-create, quality-value, complaint-create, complaint-update, quality-review, cleanup");
    process.exit(1);
  }

  const sql = postgres(DATABASE_URL, { prepare: false, max: 10, idle_timeout: 10, connect_timeout: 10 });
  const db = drizzle(sql, { schema });
  await setup(sql);

  const start = Date.now();
  switch (section) {
    case "quality-create": await qualityCreate(sql, db); break;
    case "quality-value": await qualityValue(sql, db); break;
    case "complaint-create": await complaintCreate(sql, db); break;
    case "complaint-update": await complaintUpdate(sql, db); break;
    case "quality-review": await qualityReview(sql, db); break;
    case "cleanup": await cleanupSection(sql); break;
    default: console.error(`Unknown section: ${section}`); process.exit(1);
  }

  const elapsed = Date.now() - start;
  console.log(`\n=== ${section} SUMMARY ===`);
  console.log(`  PASS: ${passCount}, FAIL: ${failCount}, Duration: ${elapsed}ms`);
  if (failures.length > 0) { for (const f of failures) console.log(`  - ${f}`); }

  await sql.end();
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
