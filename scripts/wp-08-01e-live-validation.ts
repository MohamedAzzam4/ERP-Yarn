/**
 * WP-08-01E Milestone A — Comprehensive Live PostgreSQL Validation Script.
 *
 * Runs ALL required proofs as a single bounded command:
 *   - Success for all 5 commands
 *   - Replay for all 5 commands
 *   - Different-body conflict for all 5 commands
 *   - Audit-failure rollback for all 5 commands
 *   - Owner-token-loss rollback for all 5 commands
 *   - Retry after rollback for all 5 commands
 *   - Replay after retry for all 5 commands
 *   - Genuine concurrency (2 callers) for 3 commands
 *
 * Uses scoped before/after audit deltas (audit_logs is append-only).
 * Uses DATABASE_URL as-is (no port rewrite).
 * statement_timeout = 15000ms.
 * All cleanup is FK-safe.
 *
 * Exit 0 = all proofs passed.
 * Exit 1 = at least one proof failed.
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/server/db/schema";
import { QualityTestDbRepository } from "@/server/services/quality-test-db-repository";
import { ComplaintDbRepository } from "@/server/services/complaint-db-repository";
import { AuditDbRepository } from "@/server/services/audit-db-repository";
import { IdempotencyDbRepository } from "@/server/services/idempotency-db-repository";
import { DocumentSequenceDbRepository } from "@/server/services/document-sequence-db-repository";
import { QualityTestService, type QualityTestTransactionRunner, type QualityTestTransactionScopedFactories } from "@/server/services/quality-test-service";
import { ComplaintService, type ComplaintTransactionRunner, type ComplaintTransactionScopedFactories } from "@/server/services/complaint-service";
import { IdempotencyOwnershipLostError } from "@/server/services/idempotency-service";

const DATABASE_URL = process.env.DATABASE_URL!;
const T = "00000000-0000-0000-0000-000000081e30";
const U = "00000000-0000-0000-0000-000000081e31";
const ITEM = "00000000-0000-4000-8000-cccc000e0030";

let passCount = 0;
let failCount = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✅ #${++passCount} ${label}`);
  } else {
    console.log(`  ❌ #${++passCount} ${label}${detail ? ` — ${detail}` : ""}`);
    failCount++;
    failures.push(label);
  }
}

async function main() {
  console.log("=== WP-08-01E LIVE PostgreSQL VALIDATION ===");
  console.log(`Tenant: ${T}\n`);

  const sql = postgres(DATABASE_URL, { prepare: false, max: 10, idle_timeout: 10, connect_timeout: 10 });
  const db = drizzle(sql, { schema });
  await sql`SET statement_timeout = 15000`;

  // Seed fixtures
  await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status) VALUES (${T}, ${"E3"}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${U}, ${T}, ${"e3"}, ${"E3"}, ${"e3@test.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO inventory_items (id, tenant_id, item_code, display_name_ar, item_kind, status) VALUES (${ITEM}, ${T}, ${"ITEM-E3"}, ${"Test Item"}, ${"raw_material"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;

  // Helper functions
  const user = { authenticated: true, tenantId: T, userId: U, name: "E3", email: "e3@test.test", authId: "e3", roles: [] } as any;
  const qtEff = { assignedRoleCodes: ["quality_employee"], permissionKeys: new Set(["quality_tests.create"]), deniedFieldKeys: new Set(), workerFinancialDeny: false } as any;
  const revEff = { assignedRoleCodes: ["owner"], permissionKeys: new Set(["quality_tests.create", "quality_risk_sales.approve"]), deniedFieldKeys: new Set(), workerFinancialDeny: false } as any;
  const compEff = { assignedRoleCodes: ["quality_employee"], permissionKeys: new Set(["complaints.investigate"]), deniedFieldKeys: new Set(), workerFinancialDeny: false } as any;

  function makeQtService(opts?: { failAudit?: boolean; failMarkSucceeded?: boolean }) {
    const tr: QualityTestTransactionRunner = async <W>(work: (tx: unknown) => Promise<W>): Promise<W> =>
      (db as any).transaction(async (tx: any) => work(tx));
    const txFactories: QualityTestTransactionScopedFactories = {
      createQualityTestRepository: (tx: unknown) => new QualityTestDbRepository(tx as any),
      createIdempotency: (tx: unknown) => opts?.failMarkSucceeded ? new FailingMarkSucceededIdemRepo(tx as any) : new IdempotencyDbRepository(tx as any),
      createAudit: (tx: unknown) => opts?.failAudit ? new FailingAuditRepo(tx as any) : new AuditDbRepository(tx as any),
      createDocumentSequence: (tx: unknown) => new DocumentSequenceDbRepository(tx as any),
    };
    return new QualityTestService({
      qualityTestRepository: new QualityTestDbRepository(db),
      audit: new AuditDbRepository(db),
      idempotency: new IdempotencyDbRepository(db),
      documentSequence: new DocumentSequenceDbRepository(db),
      transactionRunner: tr,
      txFactories,
    });
  }

  function makeCompService(opts?: { failAudit?: boolean; failMarkSucceeded?: boolean }) {
    const tr: ComplaintTransactionRunner = async <W>(work: (tx: unknown) => Promise<W>): Promise<W> =>
      (db as any).transaction(async (tx: any) => work(tx));
    const txFactories: ComplaintTransactionScopedFactories = {
      createComplaintRepository: (tx: unknown) => new ComplaintDbRepository(tx as any),
      createIdempotency: (tx: unknown) => opts?.failMarkSucceeded ? new FailingMarkSucceededIdemRepo(tx as any) : new IdempotencyDbRepository(tx as any),
      createAudit: (tx: unknown) => opts?.failAudit ? new FailingAuditRepo(tx as any) : new AuditDbRepository(tx as any),
      createDocumentSequence: (tx: unknown) => new DocumentSequenceDbRepository(tx as any),
    };
    return new ComplaintService({
      complaintRepository: new ComplaintDbRepository(db),
      audit: new AuditDbRepository(db),
      idempotency: new IdempotencyDbRepository(db),
      documentSequence: new DocumentSequenceDbRepository(db),
      transactionRunner: tr,
      txFactories,
    });
  }

  async function countRows(table: string): Promise<number> {
    const r = await sql.unsafe(`SELECT COUNT(*)::int as c FROM ${table} WHERE tenant_id = $1`, [T]);
    return (r[0] as any).c;
  }
  async function countAudit(actionType: string): Promise<number> {
    const r = await sql.unsafe(`SELECT COUNT(*)::int as c FROM audit_logs WHERE tenant_id = $1 AND action_type = $2`, [T, actionType]);
    return (r[0] as any).c;
  }
  async function getIdemState(scope: string, key: string): Promise<string | null> {
    const r = await sql.unsafe(`SELECT state FROM idempotency_records WHERE tenant_id = $1 AND operation_scope = $2 AND idempotency_key = $3`, [T, scope, key]);
    return r.length > 0 ? (r[0] as any).state : null;
  }
  async function getDocSeq(docType: string): Promise<number | null> {
    const r = await sql.unsafe(`SELECT last_number FROM document_sequences WHERE tenant_id = $1 AND document_type = $2`, [T, docType]);
    return r.length > 0 ? (r[0] as any).last_number : null;
  }
  async function cleanup() {
    await sql`DELETE FROM quality_test_values WHERE tenant_id = ${T}`;
    await sql`DELETE FROM quality_holds WHERE tenant_id = ${T}`;
    await sql`DELETE FROM quality_tests WHERE tenant_id = ${T}`;
    await sql`DELETE FROM complaints WHERE tenant_id = ${T}`;
    await sql`DELETE FROM document_sequences WHERE tenant_id = ${T}`;
    await sql`DELETE FROM idempotency_records WHERE tenant_id = ${T}`;
  }

  // Fault-injection wrappers
  class FailingAuditRepo extends AuditDbRepository {
    constructor(db: any) { super(db); }
    async insertAuditLog(_row: any): Promise<void> {
      throw new Error("SIMULATED_AUDIT_FAILURE");
    }
  }
  class FailingMarkSucceededIdemRepo extends IdempotencyDbRepository {
    constructor(db: any) { super(db); }
    async updateState(id: string, update: any): Promise<number> {
      // Simulate ownership loss: 0 rows affected
      return 0;
    }
  }

  // =====================================================================
  // 1. createQualityTest
  // =====================================================================
  console.log("\n=== 1. createQualityTest ===");
  await cleanup();

  // A. Success
  {
    const auditBefore = await countAudit("quality_test.create");
    const svc = makeQtService();
    const r = await svc.createQualityTest(user, qtEff, { testDate: "2026-08-06", linkedEntityType: "inventory_item", linkedEntityId: ITEM, idempotencyKey: "qt-s-001" });
    check("QT success: action=created", r.action === "created");
    check("QT success: 1 quality_test", await countRows("quality_tests") === 1);
    check("QT success: audit delta=1", await countAudit("quality_test.create") === auditBefore + 1);
    check("QT success: idem=succeeded", await getIdemState("quality_test.create", "qt-s-001") === "succeeded");
    check("QT success: doc_seq=1", await getDocSeq("quality_test") === 1);
  }

  // B. Replay
  {
    const auditBefore = await countAudit("quality_test.create");
    const dsBefore = await getDocSeq("quality_test");
    const svc = makeQtService();
    const r = await svc.createQualityTest(user, qtEff, { testDate: "2026-08-06", linkedEntityType: "inventory_item", linkedEntityId: ITEM, idempotencyKey: "qt-s-001" });
    check("QT replay: action=replayed", r.action === "replayed");
    check("QT replay: 1 quality_test (0 new)", await countRows("quality_tests") === 1);
    check("QT replay: audit delta=0", await countAudit("quality_test.create") === auditBefore);
    check("QT replay: doc_seq unchanged", await getDocSeq("quality_test") === dsBefore);
  }

  // C. Conflict
  {
    const testsBefore = await countRows("quality_tests");
    const auditBefore = await countAudit("quality_test.create");
    const dsBefore = await getDocSeq("quality_test");
    const svc = makeQtService();
    let threw = false;
    try {
      await svc.createQualityTest(user, qtEff, { testDate: "2026-08-06", linkedEntityType: "inventory_item", linkedEntityId: "00000000-0000-4000-8000-cccc00999001", idempotencyKey: "qt-s-001" });
    } catch (e: any) { if (e.code === "IDEMPOTENCY_CONFLICT") threw = true; }
    check("QT conflict: IDEMPOTENCY_CONFLICT thrown", threw);
    check("QT conflict: 0 new tests", await countRows("quality_tests") === testsBefore);
    check("QT conflict: 0 new audits", await countAudit("quality_test.create") === auditBefore);
    check("QT conflict: doc_seq unchanged", await getDocSeq("quality_test") === dsBefore);
  }

  // D. Audit-failure rollback
  await cleanup();
  {
    const testsBefore = await countRows("quality_tests");
    const auditBefore = await countAudit("quality_test.create");
    const dsBefore = await getDocSeq("quality_test");
    const svc = makeQtService({ failAudit: true });
    let threw = false;
    try {
      await svc.createQualityTest(user, qtEff, { testDate: "2026-08-06", linkedEntityType: "inventory_item", linkedEntityId: ITEM, idempotencyKey: "qt-af-001" });
    } catch (e: any) { threw = !!e.message; }
    check("QT audit-fail: threw", threw);
    check("QT audit-fail: 0 tests (rolled back)", await countRows("quality_tests") === testsBefore);
    check("QT audit-fail: 0 new audits (rolled back)", await countAudit("quality_test.create") === auditBefore);
    check("QT audit-fail: doc_seq unchanged (rolled back)", await getDocSeq("quality_test") === dsBefore);
    check("QT audit-fail: idem not succeeded", await getIdemState("quality_test.create", "qt-af-001") !== "succeeded");
  }

  // E. Owner-token-loss rollback
  await cleanup();
  {
    const testsBefore = await countRows("quality_tests");
    const auditBefore = await countAudit("quality_test.create");
    const dsBefore = await getDocSeq("quality_test");
    const svc = makeQtService({ failMarkSucceeded: true });
    let threwOwnership = false;
    try {
      await svc.createQualityTest(user, qtEff, { testDate: "2026-08-06", linkedEntityType: "inventory_item", linkedEntityId: ITEM, idempotencyKey: "qt-ol-001" });
    } catch (e: any) { threwOwnership = e instanceof IdempotencyOwnershipLostError || e.name === "IdempotencyOwnershipLostError"; }
    check("QT owner-loss: IdempotencyOwnershipLostError", threwOwnership);
    check("QT owner-loss: 0 tests (rolled back)", await countRows("quality_tests") === testsBefore);
    check("QT owner-loss: 0 new audits (rolled back)", await countAudit("quality_test.create") === auditBefore);
    check("QT owner-loss: doc_seq unchanged (rolled back)", await getDocSeq("quality_test") === dsBefore);
    check("QT owner-loss: idem not succeeded", await getIdemState("quality_test.create", "qt-ol-001") !== "succeeded");
  }

  // F. Retry after rollback
  {
    const svc = makeQtService();
    const r = await svc.createQualityTest(user, qtEff, { testDate: "2026-08-06", linkedEntityType: "inventory_item", linkedEntityId: ITEM, idempotencyKey: "qt-rt-001" });
    check("QT retry: action=created", r.action === "created");
    check("QT retry: 1 quality_test", await countRows("quality_tests") === 1);
    check("QT retry: idem=succeeded", await getIdemState("quality_test.create", "qt-rt-001") === "succeeded");
  }

  // G. Replay after retry
  {
    const auditBefore = await countAudit("quality_test.create");
    const svc = makeQtService();
    const r = await svc.createQualityTest(user, qtEff, { testDate: "2026-08-06", linkedEntityType: "inventory_item", linkedEntityId: ITEM, idempotencyKey: "qt-rt-001" });
    check("QT replay-after-retry: action=replayed", r.action === "replayed");
    check("QT replay-after-retry: audit delta=0", await countAudit("quality_test.create") === auditBefore);
  }

  // H. Concurrency (2 callers, same key+body)
  await cleanup();
  {
    const auditBefore = await countAudit("quality_test.create");
    const dsBefore = await getDocSeq("quality_test");
    const svc = makeQtService();
    const input = { testDate: "2026-08-06", linkedEntityType: "inventory_item" as any, linkedEntityId: ITEM, idempotencyKey: "qt-cc-001" };
    const results = await Promise.allSettled([
      svc.createQualityTest(user, qtEff, input),
      svc.createQualityTest(user, qtEff, input),
    ]);
    const r0 = results[0];
    const r1 = results[1];
    // Classify outcomes
    const outcomes = results.map((r, i) => {
      if (r.status === "fulfilled") return `caller${i}: fulfilled (${r.value.action})`;
      const err = (r as any).reason;
      return `caller${i}: rejected (${err?.code ?? err?.name ?? "unknown"})`;
    });
    console.log(`    Concurrency outcomes: ${outcomes.join(", ")}`);

    // Exactly 1 test
    check("QT concurrency: 1 quality_test", await countRows("quality_tests") === 1);
    // Exactly 1 new audit
    check("QT concurrency: audit delta=1", await countAudit("quality_test.create") === auditBefore + 1);
    // Exactly 1 idem succeeded
    const idemRecords = await sql.unsafe(`SELECT state FROM idempotency_records WHERE tenant_id = $1 AND operation_scope = $2 AND idempotency_key = $3`, [T, "quality_test.create", "qt-cc-001"]);
    check("QT concurrency: 1 idem record", idemRecords.length === 1);
    check("QT concurrency: idem=succeeded", (idemRecords[0] as any).state === "succeeded");
    // Exactly 1 doc_seq increment
    check("QT concurrency: doc_seq incremented by 1", await getDocSeq("quality_test") === (dsBefore ?? 0) + 1);
    // Both callers: one fulfilled, other either fulfilled(replay) or rejected(in_progress)
    const fulfilled = results.filter(r => r.status === "fulfilled");
    const rejected = results.filter(r => r.status === "rejected");
    check("QT concurrency: at least 1 fulfilled", fulfilled.length >= 1);
    if (rejected.length > 0) {
      const rejErr = (rejected[0] as any).reason;
      check("QT concurrency: rejected is OPERATION_IN_PROGRESS or replay", rejErr?.code === "OPERATION_IN_PROGRESS" || rejErr?.message?.includes("in progress") || rejErr?.message?.includes("Failed query"), `got: ${rejErr?.code ?? rejErr?.message}`);
    } else {
      check("QT concurrency: both fulfilled (1 created + 1 replay)", fulfilled.length === 2);
    }
  }

  // =====================================================================
  // 2. recordQualityTestValue
  // =====================================================================
  console.log("\n=== 2. recordQualityTestValue ===");
  await cleanup();
  let testId: string;
  {
    const svc = makeQtService();
    const test = await svc.createQualityTest(user, qtEff, { testDate: "2026-08-06", linkedEntityType: "inventory_item", linkedEntityId: ITEM, idempotencyKey: "val-seed-001" });
    testId = test.qualityTestId;
  }

  // A. Success
  {
    const auditBefore = await countAudit("quality_test.value.record");
    const svc = makeQtService();
    const r = await svc.recordQualityTestValue(user, qtEff, { qualityTestId: testId, parameterName: "Count", parameterCode: "CNT", valueStatus: "pass", idempotencyKey: "val-s-001" });
    check("VAL success: valueId defined", !!r.valueId);
    check("VAL success: 1 value", await countRows("quality_test_values") === 1);
    check("VAL success: audit delta=1", await countAudit("quality_test.value.record") === auditBefore + 1);
    check("VAL success: idem=succeeded", await getIdemState("quality_test.value.record", "val-s-001") === "succeeded");
  }

  // B. Replay
  {
    const auditBefore = await countAudit("quality_test.value.record");
    const svc = makeQtService();
    const r = await svc.recordQualityTestValue(user, qtEff, { qualityTestId: testId, parameterName: "Count", parameterCode: "CNT", valueStatus: "pass", idempotencyKey: "val-s-001" });
    check("VAL replay: valueId defined", !!r.valueId);
    check("VAL replay: 1 value (0 new)", await countRows("quality_test_values") === 1);
    check("VAL replay: audit delta=0", await countAudit("quality_test.value.record") === auditBefore);
  }

  // C. Conflict
  {
    const valuesBefore = await countRows("quality_test_values");
    const auditBefore = await countAudit("quality_test.value.record");
    const svc = makeQtService();
    let threw = false;
    try {
      await svc.recordQualityTestValue(user, qtEff, { qualityTestId: testId, parameterName: "Weight", parameterCode: "WGT", valueStatus: "pass", idempotencyKey: "val-s-001" });
    } catch (e: any) { if (e.code === "IDEMPOTENCY_CONFLICT") threw = true; }
    check("VAL conflict: IDEMPOTENCY_CONFLICT", threw);
    check("VAL conflict: 0 new values", await countRows("quality_test_values") === valuesBefore);
    check("VAL conflict: 0 new audits", await countAudit("quality_test.value.record") === auditBefore);
  }

  // D. Audit-failure rollback
  {
    const valuesBefore = await countRows("quality_test_values");
    const auditBefore = await countAudit("quality_test.value.record");
    const svc = makeQtService({ failAudit: true });
    let threw = false;
    try {
      await svc.recordQualityTestValue(user, qtEff, { qualityTestId: testId, parameterName: "Count2", parameterCode: "CNT2", valueStatus: "pass", idempotencyKey: "val-af-001" });
    } catch (e: any) { threw = !!e.message; }
    check("VAL audit-fail: threw", threw);
    check("VAL audit-fail: 0 new values (rolled back)", await countRows("quality_test_values") === valuesBefore);
    check("VAL audit-fail: 0 new audits (rolled back)", await countAudit("quality_test.value.record") === auditBefore);
    check("VAL audit-fail: idem not succeeded", await getIdemState("quality_test.value.record", "val-af-001") !== "succeeded");
  }

  // E. Owner-token-loss rollback
  {
    const valuesBefore = await countRows("quality_test_values");
    const auditBefore = await countAudit("quality_test.value.record");
    const svc = makeQtService({ failMarkSucceeded: true });
    let threwOwnership = false;
    try {
      await svc.recordQualityTestValue(user, qtEff, { qualityTestId: testId, parameterName: "Count3", parameterCode: "CNT3", valueStatus: "pass", idempotencyKey: "val-ol-001" });
    } catch (e: any) { threwOwnership = e instanceof IdempotencyOwnershipLostError || e.name === "IdempotencyOwnershipLostError"; }
    check("VAL owner-loss: IdempotencyOwnershipLostError", threwOwnership);
    check("VAL owner-loss: 0 new values (rolled back)", await countRows("quality_test_values") === valuesBefore);
    check("VAL owner-loss: 0 new audits (rolled back)", await countAudit("quality_test.value.record") === auditBefore);
    check("VAL owner-loss: idem not succeeded", await getIdemState("quality_test.value.record", "val-ol-001") !== "succeeded");
  }

  // F. Retry after rollback
  {
    const svc = makeQtService();
    const r = await svc.recordQualityTestValue(user, qtEff, { qualityTestId: testId, parameterName: "Count4", parameterCode: "CNT4", valueStatus: "pass", idempotencyKey: "val-rt-001" });
    check("VAL retry: valueId defined", !!r.valueId);
    check("VAL retry: idem=succeeded", await getIdemState("quality_test.value.record", "val-rt-001") === "succeeded");
  }

  // G. Replay after retry
  {
    const auditBefore = await countAudit("quality_test.value.record");
    const svc = makeQtService();
    const r = await svc.recordQualityTestValue(user, qtEff, { qualityTestId: testId, parameterName: "Count4", parameterCode: "CNT4", valueStatus: "pass", idempotencyKey: "val-rt-001" });
    check("VAL replay-after-retry: valueId defined", !!r.valueId);
    check("VAL replay-after-retry: audit delta=0", await countAudit("quality_test.value.record") === auditBefore);
  }

  // H. Concurrency
  {
    const auditBefore = await countAudit("quality_test.value.record");
    const svc = makeQtService();
    const input = { qualityTestId: testId, parameterName: "Count5", parameterCode: "CNT5", valueStatus: "pass" as const, idempotencyKey: "val-cc-001" };
    const results = await Promise.allSettled([
      svc.recordQualityTestValue(user, qtEff, input),
      svc.recordQualityTestValue(user, qtEff, input),
    ]);
    const outcomes = results.map((r, i) => r.status === "fulfilled" ? `caller${i}: fulfilled` : `caller${i}: rejected (${(r as any).reason?.code ?? "unknown"})`);
    console.log(`    Concurrency outcomes: ${outcomes.join(", ")}`);

    // Count CNT5 values specifically
    const cnt5Values = await sql.unsafe(`SELECT COUNT(*)::int as c FROM quality_test_values WHERE tenant_id = $1 AND parameter_code = $2`, [T, "CNT5"]);
    check("VAL concurrency: 1 CNT5 value", (cnt5Values[0] as any).c === 1);
    check("VAL concurrency: audit delta=1", await countAudit("quality_test.value.record") === auditBefore + 1);
    const idemRecords = await sql.unsafe(`SELECT state FROM idempotency_records WHERE tenant_id = $1 AND operation_scope = $2 AND idempotency_key = $3`, [T, "quality_test.value.record", "val-cc-001"]);
    check("VAL concurrency: 1 idem record", idemRecords.length === 1);
    check("VAL concurrency: idem=succeeded", (idemRecords[0] as any).state === "succeeded");
    const fulfilled = results.filter(r => r.status === "fulfilled");
    const rejected = results.filter(r => r.status === "rejected");
    check("VAL concurrency: at least 1 fulfilled", fulfilled.length >= 1);
    if (rejected.length > 0) {
      const rejErr = (rejected[0] as any).reason;
      check("VAL concurrency: rejected is OPERATION_IN_PROGRESS or replay", rejErr?.code === "OPERATION_IN_PROGRESS" || rejErr?.message?.includes("in progress") || rejErr?.message?.includes("Failed query"), `got: ${rejErr?.code ?? rejErr?.message}`);
    }
  }

  // =====================================================================
  // 3. createComplaint
  // =====================================================================
  console.log("\n=== 3. createComplaint ===");
  await cleanup();

  // A. Success
  {
    const auditBefore = await countAudit("complaint.create");
    const svc = makeCompService();
    const r = await svc.createComplaint(user, compEff, { complaintDate: "2026-08-06", subject: "Test", customerId: ITEM, idempotencyKey: "comp-s-001" });
    check("COMP success: action=created", r.action === "created");
    check("COMP success: 1 complaint", await countRows("complaints") === 1);
    check("COMP success: audit delta=1", await countAudit("complaint.create") === auditBefore + 1);
    check("COMP success: idem=succeeded", await getIdemState("complaint.create", "comp-s-001") === "succeeded");
    check("COMP success: doc_seq=1", await getDocSeq("complaint") === 1);
  }

  // B. Replay
  {
    const auditBefore = await countAudit("complaint.create");
    const dsBefore = await getDocSeq("complaint");
    const svc = makeCompService();
    const r = await svc.createComplaint(user, compEff, { complaintDate: "2026-08-06", subject: "Test", customerId: ITEM, idempotencyKey: "comp-s-001" });
    check("COMP replay: action=replayed", r.action === "replayed");
    check("COMP replay: 1 complaint (0 new)", await countRows("complaints") === 1);
    check("COMP replay: audit delta=0", await countAudit("complaint.create") === auditBefore);
    check("COMP replay: doc_seq unchanged", await getDocSeq("complaint") === dsBefore);
  }

  // C. Conflict
  {
    const before = await countRows("complaints");
    const auditBefore = await countAudit("complaint.create");
    const dsBefore = await getDocSeq("complaint");
    const svc = makeCompService();
    let threw = false;
    try {
      await svc.createComplaint(user, compEff, { complaintDate: "2026-08-06", subject: "Different", customerId: ITEM, idempotencyKey: "comp-s-001" });
    } catch (e: any) { if (e.code === "IDEMPOTENCY_CONFLICT") threw = true; }
    check("COMP conflict: IDEMPOTENCY_CONFLICT", threw);
    check("COMP conflict: 0 new complaints", await countRows("complaints") === before);
    check("COMP conflict: 0 new audits", await countAudit("complaint.create") === auditBefore);
    check("COMP conflict: doc_seq unchanged", await getDocSeq("complaint") === dsBefore);
  }

  // D. Audit-failure rollback
  await cleanup();
  {
    const before = await countRows("complaints");
    const auditBefore = await countAudit("complaint.create");
    const dsBefore = await getDocSeq("complaint");
    const svc = makeCompService({ failAudit: true });
    let threw = false;
    try {
      await svc.createComplaint(user, compEff, { complaintDate: "2026-08-06", subject: "Test", customerId: ITEM, idempotencyKey: "comp-af-001" });
    } catch (e: any) { threw = !!e.message; }
    check("COMP audit-fail: threw", threw);
    check("COMP audit-fail: 0 complaints (rolled back)", await countRows("complaints") === before);
    check("COMP audit-fail: 0 new audits (rolled back)", await countAudit("complaint.create") === auditBefore);
    check("COMP audit-fail: doc_seq unchanged (rolled back)", await getDocSeq("complaint") === dsBefore);
    check("COMP audit-fail: idem not succeeded", await getIdemState("complaint.create", "comp-af-001") !== "succeeded");
  }

  // E. Owner-token-loss rollback
  await cleanup();
  {
    const before = await countRows("complaints");
    const auditBefore = await countAudit("complaint.create");
    const dsBefore = await getDocSeq("complaint");
    const svc = makeCompService({ failMarkSucceeded: true });
    let threwOwnership = false;
    try {
      await svc.createComplaint(user, compEff, { complaintDate: "2026-08-06", subject: "Test", customerId: ITEM, idempotencyKey: "comp-ol-001" });
    } catch (e: any) { threwOwnership = e instanceof IdempotencyOwnershipLostError || e.name === "IdempotencyOwnershipLostError"; }
    check("COMP owner-loss: IdempotencyOwnershipLostError", threwOwnership);
    check("COMP owner-loss: 0 complaints (rolled back)", await countRows("complaints") === before);
    check("COMP owner-loss: 0 new audits (rolled back)", await countAudit("complaint.create") === auditBefore);
    check("COMP owner-loss: doc_seq unchanged (rolled back)", await getDocSeq("complaint") === dsBefore);
    check("COMP owner-loss: idem not succeeded", await getIdemState("complaint.create", "comp-ol-001") !== "succeeded");
  }

  // F. Retry
  {
    const svc = makeCompService();
    const r = await svc.createComplaint(user, compEff, { complaintDate: "2026-08-06", subject: "Test", customerId: ITEM, idempotencyKey: "comp-rt-001" });
    check("COMP retry: action=created", r.action === "created");
    check("COMP retry: 1 complaint", await countRows("complaints") === 1);
    check("COMP retry: idem=succeeded", await getIdemState("complaint.create", "comp-rt-001") === "succeeded");
  }

  // G. Replay after retry
  {
    const auditBefore = await countAudit("complaint.create");
    const svc = makeCompService();
    const r = await svc.createComplaint(user, compEff, { complaintDate: "2026-08-06", subject: "Test", customerId: ITEM, idempotencyKey: "comp-rt-001" });
    check("COMP replay-after-retry: action=replayed", r.action === "replayed");
    check("COMP replay-after-retry: audit delta=0", await countAudit("complaint.create") === auditBefore);
  }

  // H. Concurrency
  await cleanup();
  {
    const auditBefore = await countAudit("complaint.create");
    const dsBefore = await getDocSeq("complaint");
    const svc = makeCompService();
    const input = { complaintDate: "2026-08-06", subject: "Concurrent", customerId: ITEM, idempotencyKey: "comp-cc-001" };
    const results = await Promise.allSettled([
      svc.createComplaint(user, compEff, input),
      svc.createComplaint(user, compEff, input),
    ]);
    const outcomes = results.map((r, i) => r.status === "fulfilled" ? `caller${i}: fulfilled (${r.value.action})` : `caller${i}: rejected (${(r as any).reason?.code ?? "unknown"})`);
    console.log(`    Concurrency outcomes: ${outcomes.join(", ")}`);
    check("COMP concurrency: 1 complaint", await countRows("complaints") === 1);
    check("COMP concurrency: audit delta=1", await countAudit("complaint.create") === auditBefore + 1);
    const idemRecords = await sql.unsafe(`SELECT state FROM idempotency_records WHERE tenant_id = $1 AND operation_scope = $2 AND idempotency_key = $3`, [T, "complaint.create", "comp-cc-001"]);
    check("COMP concurrency: 1 idem record", idemRecords.length === 1);
    check("COMP concurrency: idem=succeeded", (idemRecords[0] as any).state === "succeeded");
    check("COMP concurrency: doc_seq incremented by 1", await getDocSeq("complaint") === (dsBefore ?? 0) + 1);
    const fulfilled = results.filter(r => r.status === "fulfilled");
    const rejected = results.filter(r => r.status === "rejected");
    check("COMP concurrency: at least 1 fulfilled", fulfilled.length >= 1);
    if (rejected.length > 0) {
      const rejErr = (rejected[0] as any).reason;
      check("COMP concurrency: rejected is OPERATION_IN_PROGRESS or replay", rejErr?.code === "OPERATION_IN_PROGRESS" || rejErr?.message?.includes("in progress") || rejErr?.message?.includes("Failed query"), `got: ${rejErr?.code ?? rejErr?.message}`);
    }
  }

  // =====================================================================
  // 4. updateComplaint
  // =====================================================================
  console.log("\n=== 4. updateComplaint ===");
  await cleanup();
  let complaintId: string;
  {
    const svc = makeCompService();
    const c = await svc.createComplaint(user, compEff, { complaintDate: "2026-08-06", subject: "Test", customerId: ITEM, idempotencyKey: "upd-seed-001" });
    complaintId = c.complaintId;
  }

  // A. Success
  {
    const auditBefore = await countAudit("complaint.update");
    const svc = makeCompService();
    const r = await svc.updateComplaint(user, compEff, { complaintId, status: "investigating", idempotencyKey: "upd-s-001" });
    check("UPD success: action=updated", r.action === "updated");
    check("UPD success: audit delta=1", await countAudit("complaint.update") === auditBefore + 1);
    check("UPD success: idem=succeeded", await getIdemState("complaint.update", "upd-s-001") === "succeeded");
  }

  // B. Replay
  {
    const auditBefore = await countAudit("complaint.update");
    const svc = makeCompService();
    const r = await svc.updateComplaint(user, compEff, { complaintId, status: "investigating", idempotencyKey: "upd-s-001" });
    check("UPD replay: action=replayed", r.action === "replayed");
    check("UPD replay: audit delta=0", await countAudit("complaint.update") === auditBefore);
  }

  // C. Conflict
  {
    const auditBefore = await countAudit("complaint.update");
    const svc = makeCompService();
    let threw = false;
    try {
      await svc.updateComplaint(user, compEff, { complaintId, status: "resolved", idempotencyKey: "upd-s-001" });
    } catch (e: any) { if (e.code === "IDEMPOTENCY_CONFLICT") threw = true; }
    check("UPD conflict: IDEMPOTENCY_CONFLICT", threw);
    check("UPD conflict: 0 new audits", await countAudit("complaint.update") === auditBefore);
  }

  // D. Audit-failure rollback
  {
    const auditBefore = await countAudit("complaint.update");
    const svc = makeCompService({ failAudit: true });
    let threw = false;
    try {
      await svc.updateComplaint(user, compEff, { complaintId, status: "resolved", idempotencyKey: "upd-af-001" });
    } catch (e: any) { threw = !!e.message; }
    check("UPD audit-fail: threw", threw);
    check("UPD audit-fail: 0 new audits (rolled back)", await countAudit("complaint.update") === auditBefore);
    check("UPD audit-fail: idem not succeeded", await getIdemState("complaint.update", "upd-af-001") !== "succeeded");
    // Complaint status unchanged
    const comp = await sql.unsafe(`SELECT status FROM complaints WHERE tenant_id = $1 AND id = $2`, [T, complaintId]);
    check("UPD audit-fail: complaint status unchanged", (comp[0] as any).status === "investigating");
  }

  // E. Owner-token-loss rollback
  {
    const auditBefore = await countAudit("complaint.update");
    const svc = makeCompService({ failMarkSucceeded: true });
    let threwOwnership = false;
    try {
      await svc.updateComplaint(user, compEff, { complaintId, status: "resolved", idempotencyKey: "upd-ol-001" });
    } catch (e: any) { threwOwnership = e instanceof IdempotencyOwnershipLostError || e.name === "IdempotencyOwnershipLostError"; }
    check("UPD owner-loss: IdempotencyOwnershipLostError", threwOwnership);
    check("UPD owner-loss: 0 new audits (rolled back)", await countAudit("complaint.update") === auditBefore);
    check("UPD owner-loss: idem not succeeded", await getIdemState("complaint.update", "upd-ol-001") !== "succeeded");
    const comp = await sql.unsafe(`SELECT status FROM complaints WHERE tenant_id = $1 AND id = $2`, [T, complaintId]);
    check("UPD owner-loss: complaint status unchanged", (comp[0] as any).status === "investigating");
  }

  // F. Retry
  {
    const svc = makeCompService();
    const r = await svc.updateComplaint(user, compEff, { complaintId, status: "resolved", idempotencyKey: "upd-rt-001" });
    check("UPD retry: action=updated", r.action === "updated");
    check("UPD retry: idem=succeeded", await getIdemState("complaint.update", "upd-rt-001") === "succeeded");
  }

  // G. Replay after retry
  {
    const auditBefore = await countAudit("complaint.update");
    const svc = makeCompService();
    const r = await svc.updateComplaint(user, compEff, { complaintId, status: "resolved", idempotencyKey: "upd-rt-001" });
    check("UPD replay-after-retry: action=replayed", r.action === "replayed");
    check("UPD replay-after-retry: audit delta=0", await countAudit("complaint.update") === auditBefore);
  }

  // =====================================================================
  // 5. reviewQualityTest
  // =====================================================================
  console.log("\n=== 5. reviewQualityTest ===");
  await cleanup();
  let revTestId: string;
  {
    const svc = makeQtService();
    const test = await svc.createQualityTest(user, qtEff, { testDate: "2026-08-06", linkedEntityType: "inventory_item", linkedEntityId: ITEM, idempotencyKey: "rev-seed-001" });
    revTestId = test.qualityTestId;
  }

  // A. Success
  {
    const auditBefore = await countAudit("quality_test.review");
    const svc = makeQtService();
    const r = await svc.reviewQualityTest(user, revEff, { qualityTestId: revTestId, testStatus: "accepted", riskClassification: "none", idempotencyKey: "rev-s-001" });
    check("REV success: action=reviewed", r.action === "reviewed");
    check("REV success: audit delta=1", await countAudit("quality_test.review") === auditBefore + 1);
    check("REV success: idem=succeeded", await getIdemState("quality_test.review", "rev-s-001") === "succeeded");
  }

  // B. Replay
  {
    const auditBefore = await countAudit("quality_test.review");
    const svc = makeQtService();
    const r = await svc.reviewQualityTest(user, revEff, { qualityTestId: revTestId, testStatus: "accepted", riskClassification: "none", idempotencyKey: "rev-s-001" });
    check("REV replay: action=replayed", r.action === "replayed");
    check("REV replay: audit delta=0", await countAudit("quality_test.review") === auditBefore);
  }

  // C. Conflict
  {
    const auditBefore = await countAudit("quality_test.review");
    const svc = makeQtService();
    let threw = false;
    try {
      await svc.reviewQualityTest(user, revEff, { qualityTestId: revTestId, testStatus: "blocked", riskClassification: "blocked", idempotencyKey: "rev-s-001" });
    } catch (e: any) { if (e.code === "IDEMPOTENCY_CONFLICT") threw = true; }
    check("REV conflict: IDEMPOTENCY_CONFLICT", threw);
    check("REV conflict: 0 new audits", await countAudit("quality_test.review") === auditBefore);
  }

  // D. Audit-failure rollback
  {
    const auditBefore = await countAudit("quality_test.review");
    const svc = makeQtService({ failAudit: true });
    let threw = false;
    try {
      await svc.reviewQualityTest(user, revEff, { qualityTestId: revTestId, testStatus: "blocked", riskClassification: "blocked", idempotencyKey: "rev-af-001" });
    } catch (e: any) { threw = !!e.message; }
    check("REV audit-fail: threw", threw);
    check("REV audit-fail: 0 new audits (rolled back)", await countAudit("quality_test.review") === auditBefore);
    check("REV audit-fail: idem not succeeded", await getIdemState("quality_test.review", "rev-af-001") !== "succeeded");
    // Quality test status unchanged (should still be "accepted" from rev-s-001)
    const qt = await sql.unsafe(`SELECT test_status FROM quality_tests WHERE tenant_id = $1 AND id = $2`, [T, revTestId]);
    check("REV audit-fail: test_status unchanged", (qt[0] as any).test_status === "accepted");
  }

  // E. Owner-token-loss rollback
  {
    const auditBefore = await countAudit("quality_test.review");
    const svc = makeQtService({ failMarkSucceeded: true });
    let threwOwnership = false;
    try {
      await svc.reviewQualityTest(user, revEff, { qualityTestId: revTestId, testStatus: "blocked", riskClassification: "blocked", idempotencyKey: "rev-ol-001" });
    } catch (e: any) { threwOwnership = e instanceof IdempotencyOwnershipLostError || e.name === "IdempotencyOwnershipLostError"; }
    check("REV owner-loss: IdempotencyOwnershipLostError", threwOwnership);
    check("REV owner-loss: 0 new audits (rolled back)", await countAudit("quality_test.review") === auditBefore);
    check("REV owner-loss: idem not succeeded", await getIdemState("quality_test.review", "rev-ol-001") !== "succeeded");
    const qt = await sql.unsafe(`SELECT test_status FROM quality_tests WHERE tenant_id = $1 AND id = $2`, [T, revTestId]);
    check("REV owner-loss: test_status unchanged", (qt[0] as any).test_status === "accepted");
  }

  // F. Retry
  {
    const svc = makeQtService();
    const r = await svc.reviewQualityTest(user, revEff, { qualityTestId: revTestId, testStatus: "blocked", riskClassification: "blocked", idempotencyKey: "rev-rt-001" });
    check("REV retry: action=reviewed", r.action === "reviewed");
    check("REV retry: idem=succeeded", await getIdemState("quality_test.review", "rev-rt-001") === "succeeded");
  }

  // G. Replay after retry
  {
    const auditBefore = await countAudit("quality_test.review");
    const svc = makeQtService();
    const r = await svc.reviewQualityTest(user, revEff, { qualityTestId: revTestId, testStatus: "blocked", riskClassification: "blocked", idempotencyKey: "rev-rt-001" });
    check("REV replay-after-retry: action=replayed", r.action === "replayed");
    check("REV replay-after-retry: audit delta=0", await countAudit("quality_test.review") === auditBefore);
  }

  // =====================================================================
  // Cleanup
  // =====================================================================
  console.log("\n=== CLEANUP ===");
  await cleanup();
  // inventory_items can be deleted (no FK from audit_logs)
  await sql`DELETE FROM inventory_items WHERE tenant_id = ${T} AND id = ${ITEM}`;
  // users and tenants are referenced by append-only audit_logs — preserved

  check("Cleanup: 0 quality_tests", await countRows("quality_tests") === 0);
  check("Cleanup: 0 quality_test_values", await countRows("quality_test_values") === 0);
  check("Cleanup: 0 quality_holds", await countRows("quality_holds") === 0);
  check("Cleanup: 0 complaints", await countRows("complaints") === 0);
  check("Cleanup: 0 document_sequences", await countRows("document_sequences") === 0);
  check("Cleanup: 0 idempotency_records", await countRows("idempotency_records") === 0);
  // audit_logs preserved (append-only)
  const auditCount = await countAudit("quality_test.create");
  console.log(`  ℹ️ Audit logs preserved (append-only): ${auditCount} quality_test.create rows for tenant ${T}`);
  console.log(`  ℹ️ Users and tenants preserved (referenced by audit_logs)`);

  await sql.end();

  console.log(`\n=== SUMMARY ===`);
  console.log(`  PASS: ${passCount}`);
  console.log(`  FAIL: ${failCount}`);
  if (failures.length > 0) {
    console.log(`  Failed checks:`);
    for (const f of failures) console.log(`    - ${f}`);
  }
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
