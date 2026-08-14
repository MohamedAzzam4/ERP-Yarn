/**
 * WP-08-01E TASK 5 — Real PostgreSQL service-level owner-loss proof.
 *
 * Uses real DB-backed repositories + transaction runner against local
 * PostgreSQL to prove owner-loss rollback for:
 *   - approveReturnRequest
 *   - rejectReturnRequest
 *   - createReplacementOrder
 *
 * Plus: valid same-key retry, replay with zero new effects, conflict
 * with zero mutation.
 *
 * Requires DATABASE_URL pointing to a live PostgreSQL with all migrations
 * applied. Supabase Auth is NOT required — these are service-level tests.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/server/db/schema";
import { ReturnRequestService } from "@/server/services/return-request-service";
import { ReplacementWorkflowService } from "@/server/services/replacement-workflow-service";
import { InventoryLedgerService } from "@/server/services/inventory-ledger-service";
import { SubledgerService } from "@/server/services/subledger-service";
import { ProfitabilitySnapshotService } from "@/server/services/profitability-snapshot-service";
import { ReturnRequestDbRepository } from "@/server/services/return-request-db-repository";
import { SalesDbRepository } from "@/server/services/sales-db-repository";
import { InventoryLedgerDbRepository } from "@/server/services/inventory-ledger-db-repository";
import { SubledgerDbRepository } from "@/server/services/subledger-db-repository";
import { ProfitabilitySnapshotDbRepository } from "@/server/services/profitability-snapshot-db-repository";
import { AuditDbRepository } from "@/server/services/audit-db-repository";
import { IdempotencyDbRepository } from "@/server/services/idempotency-db-repository";
import { DocumentSequenceDbRepository } from "@/server/services/document-sequence-db-repository";
import { DbTenantOwnershipValidator } from "@/server/services/db-tenant-ownership-validator";
import {
  IdempotencyOwnershipLostError,
  type IdempotencyTransactionHandle,
} from "@/server/services/idempotency-service";

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

const T = "cccccccc-0000-4000-8000-000000000052";
const U = "cccccccc-0000-4000-8000-000000000053";
const U2 = "cccccccc-0000-4000-8000-000000000054";
const CUST = "cccccccc-0000-4000-8000-000000000060";
const ITEM = "cccccccc-0000-4000-8000-000000000061";
const LOC = "cccccccc-0000-4000-8000-000000000062";

let sql: ReturnType<typeof postgres>;
let db: any;

describeOrSkip("WP-08-01E TASK 5 — Real PostgreSQL owner-loss proof", () => {
  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { prepare: false, max: 10, idle_timeout: 10, connect_timeout: 10 });
    db = drizzle(sql, { schema });
    await sql`SET statement_timeout = 30000`;
    // Seed foundational fixtures
    await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status) VALUES (${T}, ${"E5-PG"}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
    await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${U}, ${T}, ${"e5pg-atomicity-u1"}, ${"E5 PG"}, ${"e5-pg-atomicity@test.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
    await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${U2}, ${T}, ${"e5pg-atomicity-u2"}, ${"E5 PG2"}, ${"e5-pg2-atomicity@test.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
    await sql`INSERT INTO inventory_items (id, tenant_id, item_code, display_name_ar, item_kind, status) VALUES (${ITEM}, ${T}, ${"ITEM-E5"}, ${"Test"}, ${"raw_material"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
    await sql`INSERT INTO customers (id, tenant_id, customer_code, name_ar, normalized_name, status) VALUES (${CUST}, ${T}, ${"CUST-E5"}, ${"Test Customer"}, ${"test customer e5"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
    await sql`INSERT INTO locations (id, tenant_id, location_code, name_ar, location_type, status) VALUES (${LOC}, ${T}, ${"LOC-E5"}, ${"Test Location"}, ${"internal_warehouse"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
  }, 30000);

  afterAll(async () => {
    if (sql) {
      await cleanupTenant(sql);
      await sql.end();
    }
  }, 30000);

  beforeEach(async () => {
    await cleanupTenant(sql);
  }, 15000);

  function makeUser() {
    return { authenticated: true, tenantId: T, userId: U, name: "E5", email: "e5-pg@test.test", authId: "e5-pg", roles: [] } as any;
  }
  function makeUser2() {
    return { authenticated: true, tenantId: T, userId: U2, name: "E5B", email: "e5-pg2@test.test", authId: "e5-pg2", roles: [] } as any;
  }
  function makeEff() {
    return { assignedRoleCodes: ["owner"], permissionKeys: new Set(["returns.create", "returns.approve", "inventory.receive.approve", "inventory.view_quantity"]), deniedFieldKeys: new Set(), workerFinancialDeny: false } as any;
  }

  // Real PostgreSQL takeover wrapper — intercepts updateState(state="succeeded")
  // and replaces owner_token via an independent root connection.
  class TakeoverIdemRepo extends IdempotencyDbRepository {
    public takeoverAffected = 0;
    public replacementToken: string | null = null;
    public staleMarkSucceededAffected: number | null = null;

    override async updateState(id: string, update: any): Promise<number> {
      if (update.state === "succeeded" && update.expectedOwnerToken) {
        // Independent root connection for takeover
        const rootSql = postgres(DATABASE_URL!, { prepare: false, max: 1, idle_timeout: 5, connect_timeout: 5 });
        try {
          const newToken = crypto.randomUUID();
          const result = await rootSql.unsafe(
            `UPDATE idempotency_records
               SET owner_token = $3, attempt_count = attempt_count + 1,
                   lease_heartbeat_at = NOW(), lease_expires_at = NOW() + INTERVAL '30 seconds'
             WHERE id = $1 AND state = 'in_progress' AND owner_token = $2 AND owner_token IS NOT NULL`,
            [id, update.expectedOwnerToken, newToken],
          );
          this.takeoverAffected = result.count;
          if (result.count === 1) this.replacementToken = newToken;
        } finally {
          await rootSql.end();
        }
        // Delegate stale markSucceeded — will affect 0 rows
        const affected = await super.updateState(id, update);
        this.staleMarkSucceededAffected = affected;
        return affected;
      }
      return super.updateState(id, update);
    }
  }

  function makeTakeoverReturnService(takeoverRepo: TakeoverIdemRepo) {
    const tr = async <W>(work: (tx: unknown) => Promise<W>): Promise<W> => (db as any).transaction(async (tx: any) => work(tx));
    return new ReturnRequestService({
      returnRequestRepository: new ReturnRequestDbRepository(db),
      audit: new AuditDbRepository(db),
      idempotency: takeoverRepo, // root uses takeover wrapper
      documentSequence: new DocumentSequenceDbRepository(db),
      inventoryLedger: new InventoryLedgerService({
        ledger: new InventoryLedgerDbRepository(db), audit: new AuditDbRepository(db),
        idempotency: new IdempotencyDbRepository(db), documentSequence: new DocumentSequenceDbRepository(db),
      }),
      subledger: new SubledgerService({
        subledger: new SubledgerDbRepository(db), audit: new AuditDbRepository(db),
        idempotency: new IdempotencyDbRepository(db), documentSequence: new DocumentSequenceDbRepository(db),
      }),
      salesRepository: new SalesDbRepository(db),
      snapshotService: new ProfitabilitySnapshotService({
        snapshotRepository: new ProfitabilitySnapshotDbRepository(db),
        salesRepository: new SalesDbRepository(db), audit: new AuditDbRepository(db),
      }),
      tenantOwnershipValidator: new DbTenantOwnershipValidator(db),
      transactionRunner: tr,
      txFactories: {
        createInventoryLedger: (tx: unknown) => new InventoryLedgerService({
          ledger: new InventoryLedgerDbRepository(tx as any), audit: new AuditDbRepository(tx as any),
          idempotency: new IdempotencyDbRepository(tx as any), documentSequence: new DocumentSequenceDbRepository(tx as any),
        }),
        createSubledger: (tx: unknown) => new SubledgerService({
          subledger: new SubledgerDbRepository(tx as any), audit: new AuditDbRepository(tx as any),
          idempotency: new IdempotencyDbRepository(tx as any), documentSequence: new DocumentSequenceDbRepository(tx as any),
        }),
        createSnapshotService: (tx: unknown) => new ProfitabilitySnapshotService({
          snapshotRepository: new ProfitabilitySnapshotDbRepository(tx as any),
          salesRepository: new SalesDbRepository(tx as any), audit: new AuditDbRepository(tx as any),
        }),
        createSalesRepository: (tx: unknown) => new SalesDbRepository(tx as any),
        createReturnRequestRepository: (tx: unknown) => new ReturnRequestDbRepository(tx as any),
        createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
        createIdempotency: (tx: unknown) => takeoverRepo, // tx-scoped uses takeover wrapper
      },
    });
  }

  function makeNormalReturnService() {
    const tr = async <W>(work: (tx: unknown) => Promise<W>): Promise<W> => (db as any).transaction(async (tx: any) => work(tx));
    return new ReturnRequestService({
      returnRequestRepository: new ReturnRequestDbRepository(db),
      audit: new AuditDbRepository(db),
      idempotency: new IdempotencyDbRepository(db),
      documentSequence: new DocumentSequenceDbRepository(db),
      inventoryLedger: new InventoryLedgerService({
        ledger: new InventoryLedgerDbRepository(db), audit: new AuditDbRepository(db),
        idempotency: new IdempotencyDbRepository(db), documentSequence: new DocumentSequenceDbRepository(db),
      }),
      subledger: new SubledgerService({
        subledger: new SubledgerDbRepository(db), audit: new AuditDbRepository(db),
        idempotency: new IdempotencyDbRepository(db), documentSequence: new DocumentSequenceDbRepository(db),
      }),
      salesRepository: new SalesDbRepository(db),
      snapshotService: new ProfitabilitySnapshotService({
        snapshotRepository: new ProfitabilitySnapshotDbRepository(db),
        salesRepository: new SalesDbRepository(db), audit: new AuditDbRepository(db),
      }),
      tenantOwnershipValidator: new DbTenantOwnershipValidator(db),
      transactionRunner: tr,
      txFactories: {
        createInventoryLedger: (tx: unknown) => new InventoryLedgerService({
          ledger: new InventoryLedgerDbRepository(tx as any), audit: new AuditDbRepository(tx as any),
          idempotency: new IdempotencyDbRepository(tx as any), documentSequence: new DocumentSequenceDbRepository(tx as any),
        }),
        createSubledger: (tx: unknown) => new SubledgerService({
          subledger: new SubledgerDbRepository(tx as any), audit: new AuditDbRepository(tx as any),
          idempotency: new IdempotencyDbRepository(tx as any), documentSequence: new DocumentSequenceDbRepository(tx as any),
        }),
        createSnapshotService: (tx: unknown) => new ProfitabilitySnapshotService({
          snapshotRepository: new ProfitabilitySnapshotDbRepository(tx as any),
          salesRepository: new SalesDbRepository(tx as any), audit: new AuditDbRepository(tx as any),
        }),
        createSalesRepository: (tx: unknown) => new SalesDbRepository(tx as any),
        createReturnRequestRepository: (tx: unknown) => new ReturnRequestDbRepository(tx as any),
        createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
        createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
      },
    });
  }

  function makeNormalReplaceService() {
    const tr = async <W>(work: (tx: unknown) => Promise<W>): Promise<W> => (db as any).transaction(async (tx: any) => work(tx));
    return new ReplacementWorkflowService({
      returnRequestRepository: new ReturnRequestDbRepository(db),
      salesRepository: new SalesDbRepository(db),
      audit: new AuditDbRepository(db),
      idempotency: new IdempotencyDbRepository(db),
      documentSequence: new DocumentSequenceDbRepository(db),
      transactionRunner: tr,
      txFactories: {
        createSalesRepository: (tx: unknown) => new SalesDbRepository(tx as any),
        createReturnRequestRepository: (tx: unknown) => new ReturnRequestDbRepository(tx as any),
        createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
        createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
      },
    });
  }

  // Helper: seed an approved return via real domain services
  async function seedApprovedReturn(keyPrefix: string, financialTreatment: any = "replacement") {
    const svc = makeNormalReturnService();
    // We need a sale order + sale line for the return to reference.
    // Use direct SQL for foundational sale (not the command being tested).
    const saleId = crypto.randomUUID();
    const saleLineId = crypto.randomUUID();
    await sql`INSERT INTO sales_orders (id, tenant_id, doc_no, customer_id, sale_date, sale_status, approval_status, reservation_status, created_by) VALUES (${saleId}, ${T}, ${"SO-" + keyPrefix}, ${CUST}, ${"2026-08-07"}, ${"approved"}, ${"approved"}, ${"consumed"}, ${U})`;
    await sql`INSERT INTO sales_order_lines (id, tenant_id, sales_order_id, line_no, item_id, location_id, quantity_kg, price_per_ton, line_net_revenue_posted, created_by) VALUES (${saleLineId}, ${T}, ${saleId}, ${1}, ${ITEM}, ${LOC}, ${"100.000"}, ${"1000.00"}, ${"100000.00"}, ${U})`;

    // Seed a profitability snapshot so approveReturnRequest can create a return-impact version
    const snapshotId = crypto.randomUUID();
    await sql`INSERT INTO sales_profitability_snapshots (id, tenant_id, sales_order_id, version, is_active, revenue_snapshot, raw_cost_snapshot, profit_amount, profit_margin_percent, calculated_at, calculated_by, created_by) VALUES (${snapshotId}, ${T}, ${saleId}, ${1}, ${"active"}, ${"100000.00"}, ${"50000.00"}, ${"50000.00"}, ${"50.000000"}, ${"2026-08-07"}, ${U}, ${U})`;

    const created = await svc.createReturnRequest(makeUser(), makeEff(), {
      salesOrderId: saleId, customerId: CUST, returnDate: "2026-08-07",
      returnReason: "test", idempotencyKey: `${keyPrefix}-create`,
      financialTreatment, isReplacement: financialTreatment === "replacement",
      lines: [{ originalSaleOrderId: saleId, originalSaleLineId: saleLineId, itemId: ITEM, quantityKg: "50.000", returnLocationId: LOC, returnedStockStatus: "needs_quality_review" }],
    });
    await svc.submitReturnRequest(makeUser(), makeEff(), { returnRequestId: created.returnRequestId, idempotencyKey: `${keyPrefix}-submit` });
    await svc.approveReturnRequest(makeUser2(), makeEff(), { returnRequestId: created.returnRequestId, idempotencyKey: `${keyPrefix}-approve`, decisionNotes: "approve" });
    return { created, saleId, saleLineId };
  }

  async function countAudit(actionType: string): Promise<number> {
    const r = await sql.unsafe(`SELECT COUNT(*)::int as c FROM audit_logs WHERE tenant_id = $1 AND action_type = $2`, [T, actionType]);
    return (r[0] as any).c;
  }
  async function getIdemState(scope: string, key: string): Promise<string | null> {
    const r = await sql.unsafe(`SELECT state, owner_token FROM idempotency_records WHERE tenant_id = $1 AND operation_scope = $2 AND idempotency_key = $3`, [T, scope, key]);
    return r.length > 0 ? (r[0] as any).state : null;
  }
  async function getIdemOwner(scope: string, key: string): Promise<string | null> {
    const r = await sql.unsafe(`SELECT owner_token FROM idempotency_records WHERE tenant_id = $1 AND operation_scope = $2 AND idempotency_key = $3`, [T, scope, key]);
    return r.length > 0 ? (r[0] as any).owner_token : null;
  }
  async function countReturnRequests(): Promise<number> {
    const r = await sql.unsafe(`SELECT COUNT(*)::int as c FROM return_requests WHERE tenant_id = $1`, [T]);
    return (r[0] as any).c;
  }
  async function countSalesOrders(): Promise<number> {
    const r = await sql.unsafe(`SELECT COUNT(*)::int as c FROM sales_orders WHERE tenant_id = $1 AND is_replacement_order = true`, [T]);
    return (r[0] as any).c;
  }

  // =====================================================================
  // approveReturnRequest owner-loss rollback
  // =====================================================================
  it("PG-1. approveReturnRequest: ownership loss → rollback + token B remains", async () => {
    const takeoverRepo = new TakeoverIdemRepo(db);
    const svc = makeNormalReturnService();
    const takeoverSvc = makeTakeoverReturnService(takeoverRepo);

    // Create + submit a return (using normal service)
    const saleId = crypto.randomUUID();
    const saleLineId = crypto.randomUUID();
    await sql`INSERT INTO sales_orders (id, tenant_id, doc_no, customer_id, sale_date, sale_status, approval_status, reservation_status, created_by) VALUES (${saleId}, ${T}, ${"SO-PG1"}, ${CUST}, ${"2026-08-07"}, ${"approved"}, ${"approved"}, ${"consumed"}, ${U})`;
    await sql`INSERT INTO sales_order_lines (id, tenant_id, sales_order_id, line_no, item_id, location_id, quantity_kg, price_per_ton, line_net_revenue_posted, created_by) VALUES (${saleLineId}, ${T}, ${saleId}, ${1}, ${ITEM}, ${LOC}, ${"100.000"}, ${"1000.00"}, ${"100000.00"}, ${U})`;
    const created = await svc.createReturnRequest(makeUser(), makeEff(), {
      salesOrderId: saleId, customerId: CUST, returnDate: "2026-08-07",
      returnReason: "test", idempotencyKey: "pg1-create",
      lines: [{ originalSaleOrderId: saleId, originalSaleLineId: saleLineId, itemId: ITEM, quantityKg: "50.000", returnLocationId: LOC, returnedStockStatus: "needs_quality_review" }],
    });
    await svc.submitReturnRequest(makeUser(), makeEff(), { returnRequestId: created.returnRequestId, idempotencyKey: "pg1-submit" });

    const auditBefore = await countAudit("return_request.approve");
    const rrBefore = await sql.unsafe(`SELECT status, approval_status FROM return_requests WHERE id = $1`, [created.returnRequestId]);

    // Approve with takeover service — should throw IdempotencyOwnershipLostError
    let threw = false;
    try {
      await takeoverSvc.approveReturnRequest(makeUser2(), makeEff(), { returnRequestId: created.returnRequestId, idempotencyKey: "pg1-approve", decisionNotes: "approve" });
    } catch (e: any) {
      threw = e instanceof IdempotencyOwnershipLostError || e.code === "IDEMPOTENCY_OWNERSHIP_LOST" || e?.cause?.code === "IDEMPOTENCY_OWNERSHIP_LOST";
    }
    expect(threw).toBe(true);

    // Takeover evidence
    expect(takeoverRepo.takeoverAffected).toBe(1);
    expect(takeoverRepo.replacementToken).not.toBeNull();
    expect(takeoverRepo.staleMarkSucceededAffected).toBe(0);

    // Rollback: return status unchanged
    const rrAfter = await sql.unsafe(`SELECT status, approval_status FROM return_requests WHERE id = $1`, [created.returnRequestId]);
    expect(((rrAfter[0] as any) ?? {}).status).toBe(((rrBefore[0] as any) ?? {}).status);
    expect(((rrAfter[0] as any) ?? {}).approval_status).toBe(((rrBefore[0] as any) ?? {}).approval_status);

    // 0 new audits
    expect(await countAudit("return_request.approve")).toBe(auditBefore);

    // Idempotency state in_progress, owner = token B
    expect(await getIdemState("return_request.approve", "pg1-approve")).toBe("in_progress");
    expect(await getIdemOwner("return_request.approve", "pg1-approve")).toBe(takeoverRepo.replacementToken);
  }, 30000);

  // =====================================================================
  // rejectReturnRequest owner-loss rollback
  // =====================================================================
  it("PG-2. rejectReturnRequest: ownership loss → rollback + token B remains", async () => {
    const takeoverRepo = new TakeoverIdemRepo(db);
    const svc = makeNormalReturnService();
    const takeoverSvc = makeTakeoverReturnService(takeoverRepo);

    const saleId = crypto.randomUUID();
    const saleLineId = crypto.randomUUID();
    await sql`INSERT INTO sales_orders (id, tenant_id, doc_no, customer_id, sale_date, sale_status, approval_status, reservation_status, created_by) VALUES (${saleId}, ${T}, ${"SO-PG2"}, ${CUST}, ${"2026-08-07"}, ${"approved"}, ${"approved"}, ${"consumed"}, ${U})`;
    await sql`INSERT INTO sales_order_lines (id, tenant_id, sales_order_id, line_no, item_id, location_id, quantity_kg, price_per_ton, line_net_revenue_posted, created_by) VALUES (${saleLineId}, ${T}, ${saleId}, ${1}, ${ITEM}, ${LOC}, ${"100.000"}, ${"1000.00"}, ${"100000.00"}, ${U})`;
    const created = await svc.createReturnRequest(makeUser(), makeEff(), {
      salesOrderId: saleId, customerId: CUST, returnDate: "2026-08-07",
      returnReason: "test", idempotencyKey: "pg2-create",
      lines: [{ originalSaleOrderId: saleId, originalSaleLineId: saleLineId, itemId: ITEM, quantityKg: "50.000", returnLocationId: LOC, returnedStockStatus: "needs_quality_review" }],
    });
    await svc.submitReturnRequest(makeUser(), makeEff(), { returnRequestId: created.returnRequestId, idempotencyKey: "pg2-submit" });

    const auditBefore = await countAudit("return_request.reject");

    let threw = false;
    try {
      await takeoverSvc.rejectReturnRequest(makeUser(), makeEff(), { returnRequestId: created.returnRequestId, rejectionReason: "reject", idempotencyKey: "pg2-reject" });
    } catch (e: any) {
      threw = e instanceof IdempotencyOwnershipLostError || e.code === "IDEMPOTENCY_OWNERSHIP_LOST" || e?.cause?.code === "IDEMPOTENCY_OWNERSHIP_LOST";
    }
    expect(threw).toBe(true);

    expect(takeoverRepo.takeoverAffected).toBe(1);
    expect(takeoverRepo.staleMarkSucceededAffected).toBe(0);
    expect(await countAudit("return_request.reject")).toBe(auditBefore);
    expect(await getIdemState("return_request.reject", "pg2-reject")).toBe("in_progress");
    expect(await getIdemOwner("return_request.reject", "pg2-reject")).toBe(takeoverRepo.replacementToken);

    // Return status still pending_approval (unchanged)
    const rrAfter = await sql.unsafe(`SELECT status FROM return_requests WHERE id = $1`, [created.returnRequestId]);
    expect(((rrAfter[0] as any) ?? {}).status).toBe("pending_approval");
  }, 30000);

  // =====================================================================
  // createReplacementOrder owner-loss rollback
  // =====================================================================
  it("PG-3. createReplacementOrder: ownership loss → rollback + token B remains", async () => {
    const takeoverRepo = new TakeoverIdemRepo(db);
    const { created } = await seedApprovedReturn("pg3", "replacement");

    const auditBefore = await countAudit("replacement_workflow.create");
    const salesBefore = await countSalesOrders();

    // Build takeover replacement service
    const tr = async <W>(work: (tx: unknown) => Promise<W>): Promise<W> => (db as any).transaction(async (tx: any) => work(tx));
    const takeoverReplaceSvc = new ReplacementWorkflowService({
      returnRequestRepository: new ReturnRequestDbRepository(db),
      salesRepository: new SalesDbRepository(db),
      audit: new AuditDbRepository(db),
      idempotency: takeoverRepo,
      documentSequence: new DocumentSequenceDbRepository(db),
      transactionRunner: tr,
      txFactories: {
        createSalesRepository: (tx: unknown) => new SalesDbRepository(tx as any),
        createReturnRequestRepository: (tx: unknown) => new ReturnRequestDbRepository(tx as any),
        createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
        createIdempotency: (tx: unknown) => takeoverRepo,
      },
    });

    let threw = false;
    try {
      await takeoverReplaceSvc.createReplacementOrder(makeUser(), makeEff(), { returnRequestId: created.returnRequestId, idempotencyKey: "pg3-replace" });
    } catch (e: any) {
      threw = e instanceof IdempotencyOwnershipLostError || e.code === "IDEMPOTENCY_OWNERSHIP_LOST" || e?.cause?.code === "IDEMPOTENCY_OWNERSHIP_LOST";
    }
    expect(threw).toBe(true);

    expect(takeoverRepo.takeoverAffected).toBe(1);
    expect(takeoverRepo.staleMarkSucceededAffected).toBe(0);
    expect(await countAudit("replacement_workflow.create")).toBe(auditBefore);
    expect(await countSalesOrders()).toBe(salesBefore); // 0 new replacement orders
    expect(await getIdemState("replacement_workflow.create", "pg3-replace")).toBe("in_progress");
    expect(await getIdemOwner("replacement_workflow.create", "pg3-replace")).toBe(takeoverRepo.replacementToken);
  }, 30000);

  // =====================================================================
  // Valid same-key retry after owner-loss recovery
  // =====================================================================
  it("PG-4. createReplacementOrder: retry after reclaim creates exactly 1, replay 0, conflict 0", async () => {
    const takeoverRepo = new TakeoverIdemRepo(db);
    const { created } = await seedApprovedReturn("pg4", "replacement");

    const tr = async <W>(work: (tx: unknown) => Promise<W>): Promise<W> => (db as any).transaction(async (tx: any) => work(tx));
    const takeoverReplaceSvc = new ReplacementWorkflowService({
      returnRequestRepository: new ReturnRequestDbRepository(db),
      salesRepository: new SalesDbRepository(db),
      audit: new AuditDbRepository(db),
      idempotency: takeoverRepo,
      documentSequence: new DocumentSequenceDbRepository(db),
      transactionRunner: tr,
      txFactories: {
        createSalesRepository: (tx: unknown) => new SalesDbRepository(tx as any),
        createReturnRequestRepository: (tx: unknown) => new ReturnRequestDbRepository(tx as any),
        createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
        createIdempotency: (tx: unknown) => takeoverRepo,
      },
    });

    // Owner-loss
    await expect(takeoverReplaceSvc.createReplacementOrder(makeUser(), makeEff(), { returnRequestId: created.returnRequestId, idempotencyKey: "pg4-replace" })).rejects.toThrow();

    // Expire lease for reclaim
    await sql`UPDATE idempotency_records SET lease_expires_at = NOW() - INTERVAL '1 second' WHERE tenant_id = ${T} AND operation_scope = 'replacement_workflow.create' AND idempotency_key = 'pg4-replace'`;

    // Retry with normal service
    const normalSvc = makeNormalReplaceService();
    const auditBeforeRetry = await countAudit("replacement_workflow.create");
    const salesBeforeRetry = await countSalesOrders();

    const result = await normalSvc.createReplacementOrder(makeUser(), makeEff(), { returnRequestId: created.returnRequestId, idempotencyKey: "pg4-replace" });
    expect(result.action).toBe("created");
    expect(await countSalesOrders()).toBe(salesBeforeRetry + 1); // exactly 1 new
    expect(await countAudit("replacement_workflow.create")).toBe(auditBeforeRetry + 1); // exactly 1 new audit

    // Replay — 0 new
    const auditBeforeReplay = await countAudit("replacement_workflow.create");
    const salesBeforeReplay = await countSalesOrders();
    const replayResult = await normalSvc.createReplacementOrder(makeUser(), makeEff(), { returnRequestId: created.returnRequestId, idempotencyKey: "pg4-replace" });
    expect(replayResult.action).toBe("replayed");
    expect(await countSalesOrders()).toBe(salesBeforeReplay); // 0 new
    expect(await countAudit("replacement_workflow.create")).toBe(auditBeforeReplay); // 0 new

    // Conflict — same key, different body
    const auditBeforeConflict = await countAudit("replacement_workflow.create");
    let conflictThrew = false;
    try {
      await normalSvc.createReplacementOrder(makeUser(), makeEff(), { returnRequestId: created.returnRequestId, idempotencyKey: "pg4-replace", saleDate: "2020-01-01" });
    } catch (e: any) { conflictThrew = e.code === "IDEMPOTENCY_CONFLICT"; }
    expect(conflictThrew).toBe(true);
    expect(await countAudit("replacement_workflow.create")).toBe(auditBeforeConflict); // 0 new
  }, 30000);
});

async function cleanupTenant(sql: any) {
  await sql`DELETE FROM quality_test_values WHERE tenant_id = ${T}`;
  await sql`DELETE FROM quality_holds WHERE tenant_id = ${T}`;
  await sql`DELETE FROM quality_tests WHERE tenant_id = ${T}`;
  await sql`DELETE FROM complaints WHERE tenant_id = ${T}`;
  await sql`DELETE FROM return_lines WHERE tenant_id = ${T}`;
  await sql`DELETE FROM return_requests WHERE tenant_id = ${T}`;
  await sql`DELETE FROM inventory_balances WHERE tenant_id = ${T}`;
  await sql`DELETE FROM stock_movements WHERE tenant_id = ${T}`;
  await sql`DELETE FROM account_entries WHERE tenant_id = ${T}`;
  await sql`DELETE FROM sales_profitability_snapshots WHERE tenant_id = ${T}`;
  await sql`DELETE FROM sales_order_lines WHERE tenant_id = ${T}`;
  await sql`DELETE FROM sales_orders WHERE tenant_id = ${T}`;
  await sql`DELETE FROM document_sequences WHERE tenant_id = ${T}`;
  await sql`DELETE FROM idempotency_records WHERE tenant_id = ${T}`;
}
