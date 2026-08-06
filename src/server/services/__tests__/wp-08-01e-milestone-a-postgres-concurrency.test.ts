/**
 * WP-08-01E Milestone A — PostgreSQL Concurrency Test.
 *
 * Requires DATABASE_URL to be set to a live PostgreSQL connection.
 * Skipped when DATABASE_URL is not available.
 *
 * Tests genuine concurrent execution using Promise.all with DB-backed
 * repositories against a live PostgreSQL database.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/server/db/schema";
import { QualityTestDbRepository } from "@/server/services/quality-test-db-repository";
import { AuditDbRepository } from "@/server/services/audit-db-repository";
import { IdempotencyDbRepository } from "@/server/services/idempotency-db-repository";
import { DocumentSequenceDbRepository } from "@/server/services/document-sequence-db-repository";
import { QualityTestService } from "@/server/services/quality-test-service";

const DATABASE_URL = process.env.DATABASE_URL;
const describeOrSkip = DATABASE_URL?.startsWith("postgres") ? describe : describe.skip;

const TEST_TENANT = "00000000-0000-0000-0000-000000081e10";
const TEST_USER_ID = "00000000-0000-0000-0000-000000081e11";
const TEST_ITEM_ID = "00000000-0000-4000-8000-cccc000e0010";

describeOrSkip("WP-08-01E Milestone A — PostgreSQL concurrency proof", () => {
  let sql: ReturnType<typeof postgres>;
  let db: any;

  beforeAll(async () => {
    const url = new URL(DATABASE_URL!);
    if (url.port === "6543") url.port = "5432";
    sql = postgres(url.toString(), { prepare: false, max: 10, idle_timeout: 10 });
    db = drizzle(sql, { schema });
    // Seed tenant + user
    await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status) VALUES (${TEST_TENANT}, ${"E"}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
    await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${TEST_USER_ID}, ${TEST_TENANT}, ${"test-e"}, ${"E"}, ${"e@test.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM quality_test_values WHERE tenant_id = ${TEST_TENANT}`;
      await sql`DELETE FROM quality_holds WHERE tenant_id = ${TEST_TENANT}`;
      await sql`DELETE FROM quality_tests WHERE tenant_id = ${TEST_TENANT}`;
      await sql`DELETE FROM document_sequences WHERE tenant_id = ${TEST_TENANT} AND document_type = 'quality_test'`;
      await sql`DELETE FROM idempotency_records WHERE tenant_id = ${TEST_TENANT} AND operation_scope LIKE 'quality_test.%'`;
      await sql`DELETE FROM audit_logs WHERE tenant_id = ${TEST_TENANT} AND entity_type = 'quality_test'`;
      await sql.end();
    }
  });

  it("genuine concurrent calls with same key produce exactly 1 effective result", async () => {
    // Clean slate
    await sql`DELETE FROM quality_test_values WHERE tenant_id = ${TEST_TENANT}`;
    await sql`DELETE FROM quality_tests WHERE tenant_id = ${TEST_TENANT}`;
    await sql`DELETE FROM idempotency_records WHERE tenant_id = ${TEST_TENANT} AND operation_scope = 'quality_test.create'`;
    await sql`DELETE FROM audit_logs WHERE tenant_id = ${TEST_TENANT} AND entity_type = 'quality_test'`;

    const user = { authenticated: true, tenantId: TEST_TENANT, userId: TEST_USER_ID, name: "E", email: "e@t.test", authId: "t" } as any;
    const eff = { assignedRoleCodes: ["quality_employee"], permissionKeys: new Set(["quality_tests.create"]), deniedFieldKeys: new Set(), workerFinancialDeny: false } as any;

    const input = {
      testDate: "2026-08-06",
      linkedEntityType: "inventory_item" as any,
      linkedEntityId: TEST_ITEM_ID,
      idempotencyKey: "concurrent-test-001",
    };

    // Create the service with transaction runner
    const transactionRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
      return (db as any).transaction(async (tx: any) => work(tx));
    };
    const service = new QualityTestService({
      qualityTestRepository: new QualityTestDbRepository(db),
      audit: new AuditDbRepository(db),
      idempotency: new IdempotencyDbRepository(db),
      documentSequence: new DocumentSequenceDbRepository(db),
      transactionRunner,
      txFactories: {
        createQualityTestRepository: (tx) => new QualityTestDbRepository(tx as any),
        createIdempotency: (tx) => new IdempotencyDbRepository(tx as any),
        createAudit: (tx) => new AuditDbRepository(tx as any),
        createDocumentSequence: (tx) => new DocumentSequenceDbRepository(tx as any),
      },
    });

    // Launch 5 genuinely concurrent calls with the same key
    const results = await Promise.allSettled([
      service.createQualityTest(user, eff, input),
      service.createQualityTest(user, eff, input),
      service.createQualityTest(user, eff, input),
      service.createQualityTest(user, eff, input),
      service.createQualityTest(user, eff, input),
    ]);

    // At least 1 must succeed
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    // Exactly 1 quality_test in DB
    const tests = await sql`SELECT id FROM quality_tests WHERE tenant_id = ${TEST_TENANT} AND test_no LIKE 'QT-%'`;
    expect(tests.length).toBe(1);

    // Exactly 1 succeeded idempotency record
    const idemRecords = await sql`SELECT state FROM idempotency_records WHERE tenant_id = ${TEST_TENANT} AND operation_scope = 'quality_test.create' AND idempotency_key = 'concurrent-test-001'`;
    expect(idemRecords.length).toBe(1);
    expect(idemRecords[0]!.state).toBe("succeeded");

    // Exactly 1 audit log
    const auditCount = await sql`SELECT COUNT(*)::int as c FROM audit_logs WHERE tenant_id = ${TEST_TENANT} AND entity_type = 'quality_test' AND action_type = 'quality_test.create'`;
    expect(auditCount[0]!.c).toBe(1);
  });

  it("same key with different body is rejected", async () => {
    await sql`DELETE FROM idempotency_records WHERE tenant_id = ${TEST_TENANT} AND idempotency_key = 'conflict-test-001'`;

    const user = { authenticated: true, tenantId: TEST_TENANT, userId: TEST_USER_ID, name: "E", email: "e@t.test", authId: "t" } as any;
    const eff = { assignedRoleCodes: ["quality_employee"], permissionKeys: new Set(["quality_tests.create"]), deniedFieldKeys: new Set(), workerFinancialDeny: false } as any;

    const transactionRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
      return (db as any).transaction(async (tx: any) => work(tx));
    };
    const service = new QualityTestService({
      qualityTestRepository: new QualityTestDbRepository(db),
      audit: new AuditDbRepository(db),
      idempotency: new IdempotencyDbRepository(db),
      documentSequence: new DocumentSequenceDbRepository(db),
      transactionRunner,
      txFactories: {
        createQualityTestRepository: (tx) => new QualityTestDbRepository(tx as any),
        createIdempotency: (tx) => new IdempotencyDbRepository(tx as any),
        createAudit: (tx) => new AuditDbRepository(tx as any),
        createDocumentSequence: (tx) => new DocumentSequenceDbRepository(tx as any),
      },
    });

    // First call with item A
    await service.createQualityTest(user, eff, {
      testDate: "2026-08-06",
      linkedEntityType: "inventory_item",
      linkedEntityId: TEST_ITEM_ID,
      idempotencyKey: "conflict-test-001",
    });

    // Second call with different body (different item)
    let threw = false;
    try {
      await service.createQualityTest(user, eff, {
        testDate: "2026-08-06",
        linkedEntityType: "inventory_item",
        linkedEntityId: "00000000-0000-4000-8000-cccc00999999", // different
        idempotencyKey: "conflict-test-001", // same key
      });
    } catch (e: any) {
      if (e.code === "IDEMPOTENCY_CONFLICT") threw = true;
    }
    expect(threw).toBe(true);
  });
});
