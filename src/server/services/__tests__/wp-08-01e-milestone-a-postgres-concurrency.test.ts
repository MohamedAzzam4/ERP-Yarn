/**
 * WP-08-01E Milestone A — PostgreSQL Atomicity Proof.
 *
 * Requires DATABASE_URL. Uses real DB-backed repos + transaction runner.
 * Tests ALL 5 commands: createQualityTest, recordQualityTestValue,
 * createComplaint, updateComplaint, reviewQualityTest.
 *
 * audit_logs is append-only (Contract 03 §7.7) — tests use before/after
 * delta counting instead of absolute counts for audit rows.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
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

const DATABASE_URL = process.env.DATABASE_URL;
const ALLOW_DESTRUCTIVE = process.env.ERP_ALLOW_DESTRUCTIVE_LOCAL_TEST_DB === "1";
const REQUIRE_PROOF = process.env.ERP_REQUIRE_WP0801F_POSTGRES_PROOF === "1";
// WP-08-01F Milestone C Task 1: Use shared destructive-test guard
import { checkDestructiveTestDbSafety } from "./destructive-test-guard";
const SAFETY_RESULT = checkDestructiveTestDbSafety({
  databaseUrl: DATABASE_URL,
  allowDestructive: ALLOW_DESTRUCTIVE,
  requireProof: REQUIRE_PROOF,
});
const describeOrSkip = SAFETY_RESULT.kind === "ok" ? describe : describe.skip;

const T = "00000000-0000-0000-0000-000000081e20";
const U = "00000000-0000-0000-0000-000000081e21";
const ITEM = "00000000-0000-4000-8000-cccc000e0020";
const CUST = "00000000-0000-4000-8000-cccc000e0021";

let sql: ReturnType<typeof postgres>;
let db: any;

describeOrSkip("WP-08-01E PostgreSQL Atomicity Proof", () => {
  beforeAll(async () => {
    // Use DATABASE_URL exactly as provided — do not rewrite port.
    sql = postgres(DATABASE_URL!, {
      prepare: false,
      max: 10,
      idle_timeout: 10,
      connect_timeout: 10,
    });
    db = drizzle(sql, { schema });
    // Set statement_timeout to prevent indefinite hangs
    await sql`SET statement_timeout = 15000`;
    await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status) VALUES (${T}, ${"E2"}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
    await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${U}, ${T}, ${"e2"}, ${"E2"}, ${"e2@test.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
    await sql`INSERT INTO inventory_items (id, tenant_id, item_code, display_name_ar, item_kind, status) VALUES (${ITEM}, ${T}, ${"ITEM-E2"}, ${"Test Item"}, ${"raw_material"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
    await sql`INSERT INTO customers (id, tenant_id, customer_code, name_ar, normalized_name, status) VALUES (${CUST}, ${T}, ${"CUST-E2"}, ${"Test Customer"}, ${"test customer"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
  }, 30000);

  afterAll(async () => {
    if (sql) {
      // FK-safe cleanup order (children first)
      // Note: audit_logs is append-only (Contract 03 §7.7) and references
      // users.id and tenants.id via created_by/tenant_id. Since audit_logs
      // cannot be deleted, we cannot delete users or tenants either.
      // We clean only the deterministic business data.
      await sql`DELETE FROM quality_test_values WHERE tenant_id = ${T}`;
      await sql`DELETE FROM quality_holds WHERE tenant_id = ${T}`;
      await sql`DELETE FROM quality_tests WHERE tenant_id = ${T}`;
      await sql`DELETE FROM complaints WHERE tenant_id = ${T}`;
      await sql`DELETE FROM document_sequences WHERE tenant_id = ${T}`;
      await sql`DELETE FROM idempotency_records WHERE tenant_id = ${T}`;
      // inventory_items has no FK from audit_logs — safe to delete
      await sql`DELETE FROM inventory_items WHERE tenant_id = ${T} AND id = ${ITEM}`;
      // users and tenants are referenced by append-only audit_logs — preserved
      await sql.end();
    }
  }, 30000);

  beforeEach(async () => {
    await sql`DELETE FROM quality_test_values WHERE tenant_id = ${T}`;
    await sql`DELETE FROM quality_holds WHERE tenant_id = ${T}`;
    await sql`DELETE FROM quality_tests WHERE tenant_id = ${T}`;
    await sql`DELETE FROM complaints WHERE tenant_id = ${T}`;
    await sql`DELETE FROM document_sequences WHERE tenant_id = ${T}`;
    await sql`DELETE FROM idempotency_records WHERE tenant_id = ${T}`;
  }, 15000);

  function makeUser() {
    return { authenticated: true, tenantId: T, userId: U, name: "E2", email: "e2@test.test", authId: "e2", roles: [] } as any;
  }
  function makeEff(perms: string[]) {
    return { assignedRoleCodes: ["owner"], permissionKeys: new Set(perms), deniedFieldKeys: new Set(), workerFinancialDeny: false } as any;
  }
  function makeQtService() {
    const tr = async <W>(work: (tx: unknown) => Promise<W>): Promise<W> => (db as any).transaction(async (tx: any) => work(tx));
    return new QualityTestService({
      qualityTestRepository: new QualityTestDbRepository(db),
      audit: new AuditDbRepository(db),
      idempotency: new IdempotencyDbRepository(db),
      documentSequence: new DocumentSequenceDbRepository(db),
      transactionRunner: tr,
      txFactories: {
        createQualityTestRepository: (tx: unknown) => new QualityTestDbRepository(tx as any),
        createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
        createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
        createDocumentSequence: (tx: unknown) => new DocumentSequenceDbRepository(tx as any),
      },
    });
  }
  function makeCompService() {
    const tr = async <W>(work: (tx: unknown) => Promise<W>): Promise<W> => (db as any).transaction(async (tx: any) => work(tx));
    return new ComplaintService({
      complaintRepository: new ComplaintDbRepository(db),
      audit: new AuditDbRepository(db),
      idempotency: new IdempotencyDbRepository(db),
      documentSequence: new DocumentSequenceDbRepository(db),
      transactionRunner: tr,
      txFactories: {
        createComplaintRepository: (tx: unknown) => new ComplaintDbRepository(tx as any),
        createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
        createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
        createDocumentSequence: (tx: unknown) => new DocumentSequenceDbRepository(tx as any),
      },
    });
  }

  async function countRows(table: string): Promise<number> {
    const r = await sql.unsafe(`SELECT COUNT(*)::int as c FROM ${table} WHERE tenant_id = $1`, [T]);
    return (r[0] as any).c;
  }

  async function countAudit(entityType: string, actionType?: string): Promise<number> {
    if (actionType) {
      const r = await sql.unsafe(`SELECT COUNT(*)::int as c FROM audit_logs WHERE tenant_id = $1 AND entity_type = $2 AND action_type = $3`, [T, entityType, actionType]);
      return (r[0] as any).c;
    }
    const r = await sql.unsafe(`SELECT COUNT(*)::int as c FROM audit_logs WHERE tenant_id = $1 AND entity_type = $2`, [T, entityType]);
    return (r[0] as any).c;
  }

  async function getIdemState(scope: string, key: string): Promise<string | null> {
    const r = await sql.unsafe(`SELECT state FROM idempotency_records WHERE tenant_id = $1 AND operation_scope = $2 AND idempotency_key = $3`, [T, scope, key]);
    return r.length > 0 ? (r[0] as any).state : null;
  }

  async function getDocSeqLastNumber(docType: string): Promise<number | null> {
    const r = await sql.unsafe(`SELECT last_number FROM document_sequences WHERE tenant_id = $1 AND document_type = $2`, [T, docType]);
    return r.length > 0 ? (r[0] as any).last_number : null;
  }

  // =====================================================================
  // 1. createQualityTest
  // =====================================================================
  describe("1. createQualityTest", () => {
    it("A. success: 1 test, 1 new audit, 1 idem succeeded, 1 doc_seq", async () => {
      const auditBefore = await countAudit("quality_test", "quality_test.create");
      const svc = makeQtService();
      const r = await svc.createQualityTest(makeUser(), makeEff(["quality_tests.create"]), {
        testDate: "2026-08-06", linkedEntityType: "inventory_item", linkedEntityId: ITEM, idempotencyKey: "pg-qt-001",
      });
      expect(r.action).toBe("created");
      expect(await countRows("quality_tests")).toBe(1);
      expect(await countAudit("quality_test", "quality_test.create")).toBe(auditBefore + 1);
      expect(await getIdemState("quality_test.create", "pg-qt-001")).toBe("succeeded");
      expect(await getDocSeqLastNumber("quality_test")).toBe(1);
    }, 30000);

    it("B. replay: 0 new tests, 0 new audits, 0 new doc_seq", async () => {
      const svc = makeQtService();
      await svc.createQualityTest(makeUser(), makeEff(["quality_tests.create"]), {
        testDate: "2026-08-06", linkedEntityType: "inventory_item", linkedEntityId: ITEM, idempotencyKey: "pg-qt-rep-001",
      });
      const auditBefore = await countAudit("quality_test", "quality_test.create");
      const dsBefore = await getDocSeqLastNumber("quality_test");
      const r2 = await svc.createQualityTest(makeUser(), makeEff(["quality_tests.create"]), {
        testDate: "2026-08-06", linkedEntityType: "inventory_item", linkedEntityId: ITEM, idempotencyKey: "pg-qt-rep-001",
      });
      expect(r2.action).toBe("replayed");
      expect(await countRows("quality_tests")).toBe(1);
      expect(await countAudit("quality_test", "quality_test.create")).toBe(auditBefore);
      expect(await getDocSeqLastNumber("quality_test")).toBe(dsBefore);
    }, 30000);

    it("C. conflict: rejected, 0 new", async () => {
      const svc = makeQtService();
      await svc.createQualityTest(makeUser(), makeEff(["quality_tests.create"]), {
        testDate: "2026-08-06", linkedEntityType: "inventory_item", linkedEntityId: ITEM, idempotencyKey: "pg-qt-conf-001",
      });
      const testsBefore = await countRows("quality_tests");
      let threw = false;
      try {
        await svc.createQualityTest(makeUser(), makeEff(["quality_tests.create"]), {
          testDate: "2026-08-06", linkedEntityType: "inventory_item", linkedEntityId: "00000000-0000-4000-8000-cccc99990001", idempotencyKey: "pg-qt-conf-001",
        });
      } catch (e: any) { if (e.code === "IDEMPOTENCY_CONFLICT") threw = true; }
      expect(threw).toBe(true);
      expect(await countRows("quality_tests")).toBe(testsBefore);
    }, 30000);
  });

  // =====================================================================
  // 2. recordQualityTestValue
  // =====================================================================
  describe("2. recordQualityTestValue", () => {
    it("A. success: 1 value, 1 new audit, 1 idem succeeded", async () => {
      const svc = makeQtService();
      const test = await svc.createQualityTest(makeUser(), makeEff(["quality_tests.create"]), {
        testDate: "2026-08-06", linkedEntityType: "inventory_item", linkedEntityId: ITEM, idempotencyKey: "pg-val-seed-001",
      });
      const auditBefore = await countAudit("quality_test", "quality_test.value.record");
      const r = await svc.recordQualityTestValue(makeUser(), makeEff(["quality_tests.create"]), {
        qualityTestId: test.qualityTestId, parameterName: "Count", parameterCode: "CNT", valueStatus: "pass", idempotencyKey: "pg-val-001",
      });
      expect(r.valueId).toBeDefined();
      expect(await countRows("quality_test_values")).toBe(1);
      expect(await countAudit("quality_test", "quality_test.value.record")).toBe(auditBefore + 1);
      expect(await getIdemState("quality_test.value.record", "pg-val-001")).toBe("succeeded");
    }, 30000);

    it("B. replay: 0 new", async () => {
      const svc = makeQtService();
      const test = await svc.createQualityTest(makeUser(), makeEff(["quality_tests.create"]), {
        testDate: "2026-08-06", linkedEntityType: "inventory_item", linkedEntityId: ITEM, idempotencyKey: "pg-val-rep-seed-001",
      });
      const input = { qualityTestId: test.qualityTestId, parameterName: "Count", parameterCode: "CNT", valueStatus: "pass" as const, idempotencyKey: "pg-val-rep-001" };
      await svc.recordQualityTestValue(makeUser(), makeEff(["quality_tests.create"]), input);
      const auditBefore = await countAudit("quality_test", "quality_test.value.record");
      const r2 = await svc.recordQualityTestValue(makeUser(), makeEff(["quality_tests.create"]), input);
      expect(r2.valueId).toBeDefined();
      expect(await countRows("quality_test_values")).toBe(1);
      expect(await countAudit("quality_test", "quality_test.value.record")).toBe(auditBefore);
    }, 30000);

    it("C. conflict: rejected, 0 new", async () => {
      const svc = makeQtService();
      const test = await svc.createQualityTest(makeUser(), makeEff(["quality_tests.create"]), {
        testDate: "2026-08-06", linkedEntityType: "inventory_item", linkedEntityId: ITEM, idempotencyKey: "pg-val-conf-seed-001",
      });
      await svc.recordQualityTestValue(makeUser(), makeEff(["quality_tests.create"]), {
        qualityTestId: test.qualityTestId, parameterName: "Count", parameterCode: "CNT", valueStatus: "pass", idempotencyKey: "pg-val-conf-001",
      });
      const valuesBefore = await countRows("quality_test_values");
      let threw = false;
      try {
        await svc.recordQualityTestValue(makeUser(), makeEff(["quality_tests.create"]), {
          qualityTestId: test.qualityTestId, parameterName: "Weight", parameterCode: "WGT", valueStatus: "pass", idempotencyKey: "pg-val-conf-001",
        });
      } catch (e: any) { if (e.code === "IDEMPOTENCY_CONFLICT") threw = true; }
      expect(threw).toBe(true);
      expect(await countRows("quality_test_values")).toBe(valuesBefore);
    }, 30000);
  });

  // =====================================================================
  // 3. createComplaint
  // =====================================================================
  describe("3. createComplaint", () => {
    it("A. success: 1 complaint, 1 new audit, 1 idem succeeded", async () => {
      const auditBefore = await countAudit("complaint", "complaint.create");
      const svc = makeCompService();
      const r = await svc.createComplaint(makeUser(), makeEff(["complaints.investigate"]), {
        complaintDate: "2026-08-06", subject: "Test", customerId: CUST, idempotencyKey: "pg-comp-001",
      });
      expect(r.action).toBe("created");
      expect(await countRows("complaints")).toBe(1);
      expect(await countAudit("complaint", "complaint.create")).toBe(auditBefore + 1);
      expect(await getIdemState("complaint.create", "pg-comp-001")).toBe("succeeded");
    }, 30000);

    it("B. replay: 0 new", async () => {
      const svc = makeCompService();
      await svc.createComplaint(makeUser(), makeEff(["complaints.investigate"]), {
        complaintDate: "2026-08-06", subject: "Test", customerId: CUST, idempotencyKey: "pg-comp-rep-001",
      });
      const auditBefore = await countAudit("complaint", "complaint.create");
      const r2 = await svc.createComplaint(makeUser(), makeEff(["complaints.investigate"]), {
        complaintDate: "2026-08-06", subject: "Test", customerId: CUST, idempotencyKey: "pg-comp-rep-001",
      });
      expect(r2.action).toBe("replayed");
      expect(await countRows("complaints")).toBe(1);
      expect(await countAudit("complaint", "complaint.create")).toBe(auditBefore);
    }, 30000);

    it("C. conflict: rejected, 0 new", async () => {
      const svc = makeCompService();
      await svc.createComplaint(makeUser(), makeEff(["complaints.investigate"]), {
        complaintDate: "2026-08-06", subject: "Test", customerId: CUST, idempotencyKey: "pg-comp-conf-001",
      });
      const before = await countRows("complaints");
      let threw = false;
      try {
        await svc.createComplaint(makeUser(), makeEff(["complaints.investigate"]), {
          complaintDate: "2026-08-06", subject: "Different", customerId: CUST, idempotencyKey: "pg-comp-conf-001",
        });
      } catch (e: any) { if (e.code === "IDEMPOTENCY_CONFLICT") threw = true; }
      expect(threw).toBe(true);
      expect(await countRows("complaints")).toBe(before);
    }, 30000);
  });

  // =====================================================================
  // 4. updateComplaint
  // =====================================================================
  describe("4. updateComplaint", () => {
    it("A. success: 1 new audit, 1 idem succeeded", async () => {
      const svc = makeCompService();
      const c = await svc.createComplaint(makeUser(), makeEff(["complaints.investigate"]), {
        complaintDate: "2026-08-06", subject: "Test", customerId: CUST, idempotencyKey: "pg-upd-seed-001",
      });
      const auditBefore = await countAudit("complaint", "complaint.update");
      const r = await svc.updateComplaint(makeUser(), makeEff(["complaints.investigate"]), {
        complaintId: c.complaintId, status: "investigating", idempotencyKey: "pg-upd-001",
      });
      expect(r.action).toBe("updated");
      expect(await countAudit("complaint", "complaint.update")).toBe(auditBefore + 1);
      expect(await getIdemState("complaint.update", "pg-upd-001")).toBe("succeeded");
    }, 30000);

    it("B. replay: 0 new", async () => {
      const svc = makeCompService();
      const c = await svc.createComplaint(makeUser(), makeEff(["complaints.investigate"]), {
        complaintDate: "2026-08-06", subject: "Test", customerId: CUST, idempotencyKey: "pg-upd-rep-seed-001",
      });
      const input = { complaintId: c.complaintId, status: "investigating" as const, idempotencyKey: "pg-upd-rep-001" };
      await svc.updateComplaint(makeUser(), makeEff(["complaints.investigate"]), input);
      const auditBefore = await countAudit("complaint", "complaint.update");
      const r2 = await svc.updateComplaint(makeUser(), makeEff(["complaints.investigate"]), input);
      expect(r2.action).toBe("replayed");
      expect(await countAudit("complaint", "complaint.update")).toBe(auditBefore);
    }, 30000);
  });

  // =====================================================================
  // 5. reviewQualityTest
  // =====================================================================
  describe("5. reviewQualityTest", () => {
    it("A. success: 1 new audit, 1 idem succeeded", async () => {
      const svc = makeQtService();
      const test = await svc.createQualityTest(makeUser(), makeEff(["quality_tests.create"]), {
        testDate: "2026-08-06", linkedEntityType: "inventory_item", linkedEntityId: ITEM, idempotencyKey: "pg-rev-seed-001",
      });
      const auditBefore = await countAudit("quality_test", "quality_test.review");
      const r = await svc.reviewQualityTest(makeUser(), makeEff(["quality_risk_sales.approve"]), {
        qualityTestId: test.qualityTestId, testStatus: "accepted", riskClassification: "none", idempotencyKey: "pg-rev-001",
      });
      expect(r.action).toBe("reviewed");
      expect(await countAudit("quality_test", "quality_test.review")).toBe(auditBefore + 1);
      expect(await getIdemState("quality_test.review", "pg-rev-001")).toBe("succeeded");
    }, 30000);

    it("B. replay: 0 new", async () => {
      const svc = makeQtService();
      const test = await svc.createQualityTest(makeUser(), makeEff(["quality_tests.create"]), {
        testDate: "2026-08-06", linkedEntityType: "inventory_item", linkedEntityId: ITEM, idempotencyKey: "pg-rev-rep-seed-001",
      });
      const input = { qualityTestId: test.qualityTestId, testStatus: "accepted" as const, riskClassification: "none" as const, idempotencyKey: "pg-rev-rep-001" };
      await svc.reviewQualityTest(makeUser(), makeEff(["quality_risk_sales.approve"]), input);
      const auditBefore = await countAudit("quality_test", "quality_test.review");
      const r2 = await svc.reviewQualityTest(makeUser(), makeEff(["quality_risk_sales.approve"]), input);
      expect(r2.action).toBe("replayed");
      expect(await countAudit("quality_test", "quality_test.review")).toBe(auditBefore);
    }, 30000);
  });

  // =====================================================================
  // 6. Genuine concurrency
  // =====================================================================
  describe("6. Genuine concurrency", () => {
    it("createQualityTest: 2 concurrent same-key calls → 1 effective result", async () => {
      const svc = makeQtService();
      const input = { testDate: "2026-08-06", linkedEntityType: "inventory_item" as any, linkedEntityId: ITEM, idempotencyKey: "pg-conc-qt-001" };
      const results = await Promise.allSettled([
        svc.createQualityTest(makeUser(), makeEff(["quality_tests.create"]), input),
        svc.createQualityTest(makeUser(), makeEff(["quality_tests.create"]), input),
      ]);
      // WP-08-01E race-fix regression: only fulfilled and OPERATION_IN_PROGRESS
      // are allowed. IDEMPOTENCY_CONFLICT, IDEMPOTENCY_OWNERSHIP_LOST, raw
      // SQL/Drizzle errors, and unknown rejections are forbidden.
      for (const r of results) {
        if (r.status === "rejected") {
          const err = (r as any).reason;
          expect(err?.code).toBe("OPERATION_IN_PROGRESS");
        }
      }
      expect(await countRows("quality_tests")).toBe(1);
      expect(await countAudit("quality_test", "quality_test.create")).toBeGreaterThanOrEqual(1);
      // Exactly 1 succeeded idem record (no duplicates)
      const idemRecords = await sql.unsafe(`SELECT state FROM idempotency_records WHERE tenant_id = $1 AND operation_scope = $2 AND idempotency_key = $3`, [T, "quality_test.create", "pg-conc-qt-001"]);
      expect(idemRecords.length).toBe(1);
      expect((idemRecords[0] as any).state).toBe("succeeded");
    }, 60000);

    it("createComplaint: 2 concurrent same-key calls → 1 effective result", async () => {
      const svc = makeCompService();
      const input = { complaintDate: "2026-08-06", subject: "Concurrent", customerId: CUST, idempotencyKey: "pg-conc-comp-001" };
      const results = await Promise.allSettled([
        svc.createComplaint(makeUser(), makeEff(["complaints.investigate"]), input),
        svc.createComplaint(makeUser(), makeEff(["complaints.investigate"]), input),
      ]);
      for (const r of results) {
        if (r.status === "rejected") {
          const err = (r as any).reason;
          expect(err?.code).toBe("OPERATION_IN_PROGRESS");
        }
      }
      expect(await countRows("complaints")).toBe(1);
      const idemRecords = await sql.unsafe(`SELECT state FROM idempotency_records WHERE tenant_id = $1 AND operation_scope = $2 AND idempotency_key = $3`, [T, "complaint.create", "pg-conc-comp-001"]);
      expect(idemRecords.length).toBe(1);
      expect((idemRecords[0] as any).state).toBe("succeeded");
    }, 60000);

    it("recordQualityTestValue: 2 concurrent same-key calls → 1 effective result", async () => {
      const svc = makeQtService();
      const test = await svc.createQualityTest(makeUser(), makeEff(["quality_tests.create"]), {
        testDate: "2026-08-06", linkedEntityType: "inventory_item", linkedEntityId: ITEM, idempotencyKey: "pg-conc-val-seed-001",
      });
      const input = { qualityTestId: test.qualityTestId, parameterName: "Count", parameterCode: "CNT", valueStatus: "pass" as const, idempotencyKey: "pg-conc-val-001" };
      const results = await Promise.allSettled([
        svc.recordQualityTestValue(makeUser(), makeEff(["quality_tests.create"]), input),
        svc.recordQualityTestValue(makeUser(), makeEff(["quality_tests.create"]), input),
      ]);
      for (const r of results) {
        if (r.status === "rejected") {
          const err = (r as any).reason;
          expect(err?.code).toBe("OPERATION_IN_PROGRESS");
        }
      }
      expect(await countRows("quality_test_values")).toBe(1);
      const idemRecords = await sql.unsafe(`SELECT state FROM idempotency_records WHERE tenant_id = $1 AND operation_scope = $2 AND idempotency_key = $3`, [T, "quality_test.value.record", "pg-conc-val-001"]);
      expect(idemRecords.length).toBe(1);
      expect((idemRecords[0] as any).state).toBe("succeeded");
    }, 60000);
  });
});
