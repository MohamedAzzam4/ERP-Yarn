/**
 * WP-08-01C Service-Level Atomicity Proof.
 *
 * Tests A+B: Inject ownership loss at tx-scoped markSucceeded and prove full rollback.
 * Requires DATABASE_URL to be set to a live Postgres connection.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/server/db/schema";
import { createClient } from "@supabase/supabase-js";

const DATABASE_URL = process.env.DATABASE_URL;
const SUPABASE_AVAILABLE = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SECRET_KEY;
const describeOrSkip = (DATABASE_URL?.startsWith("postgres") && SUPABASE_AVAILABLE) ? describe : describe.skip;

const T = "00000000-0000-0000-0000-000000082001";
const OWNER_UID = "00000000-0000-0000-0000-000000082002";
const WH_UID = "00000000-0000-0000-0000-000000082003";
const ITEM = "40000000-0000-0000-0000-000000082001";
const LOC1 = "40000000-0000-0000-0000-000000082002";
const CUST = "40000000-0000-0000-0000-000000082003";
const OWNER_EMAIL = "qa-owner-svc@erp-yarn.test";
const WH_EMAIL = "qa-wh-svc@erp-yarn.test";

const ownerPerms = new Set([
  "sales.create", "sales.submit", "sales.approve", "sales.view_price",
  "balances.view_supplier_factory", "balances.view_customer", "profitability.view",
  "inventory.receive.approve", "inventory.view_quantity",
]);

describeOrSkip("WP-08-01C Service-Level Atomicity — Ownership Loss Rollback", () => {
  let sql: ReturnType<typeof postgres>;
  let db: any;
  let supabase: any;

  beforeAll(async () => {
    const url = new URL(DATABASE_URL!);
    if (url.port === "6543") url.port = "5432";
    sql = postgres(url.toString(), { prepare: false, max: 5, idle_timeout: 10 });
    db = drizzle(sql, { schema });
    supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const ownerAuth = await supabase.auth.admin.createUser({ email: OWNER_EMAIL, password: "QaTest123!", email_confirm: true, user_metadata: { name: "QA Owner Svc" } }).catch(() => null);
    const whAuth = await supabase.auth.admin.createUser({ email: WH_EMAIL, password: "QaTest123!", email_confirm: true, user_metadata: { name: "QA WH Svc" } }).catch(() => null);
    const ownerAuthId = ownerAuth?.data?.user?.id ?? (await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })).data.users.find((u: any) => u.email === OWNER_EMAIL)?.id;
    const whAuthId = whAuth?.data?.user?.id ?? (await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })).data.users.find((u: any) => u.email === WH_EMAIL)?.id;

    await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status) VALUES (${T}, ${"WP-08-01C Svc"}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
    await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${OWNER_UID}, ${T}, ${ownerAuthId}, ${"QA Owner Svc"}, ${OWNER_EMAIL}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO UPDATE SET auth_id = EXCLUDED.auth_id`;
    await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${WH_UID}, ${T}, ${whAuthId}, ${"QA WH Svc"}, ${WH_EMAIL}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO UPDATE SET auth_id = EXCLUDED.auth_id`;
    await sql`INSERT INTO inventory_items (id, tenant_id, item_kind, item_code, display_name_ar, display_name_en, quality_status, is_blocked, status, created_by) VALUES (${ITEM}, ${T}, ${"single_yarn"}, ${"YARN-8C-S"}, ${"خيط"}, ${"Yarn 8C Svc"}, ${"accepted"}, false, ${"active"}, ${OWNER_UID}) ON CONFLICT (id) DO NOTHING`;
    await sql`INSERT INTO locations (id, tenant_id, location_code, name_ar, name_en, location_type, status, created_by) VALUES (${LOC1}, ${T}, ${"WH-8C-S"}, ${"مخزن"}, ${"Wh 8C Svc"}, ${"internal_warehouse"}, ${"active"}, ${OWNER_UID}) ON CONFLICT (id) DO NOTHING`;
    await sql`INSERT INTO customers (id, tenant_id, customer_code, name_ar, name_en, normalized_name, status, created_by) VALUES (${CUST}, ${T}, ${"C-8C-S"}, ${"عميل"}, ${"Cust 8C Svc"}, ${"cust 8c s"}, ${"active"}, ${OWNER_UID}) ON CONFLICT (id) DO NOTHING`;
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM stock_reservations WHERE tenant_id = ${T}`;
      await sql`DELETE FROM sales_order_lines WHERE tenant_id = ${T}`;
      await sql`DELETE FROM inventory_balances WHERE tenant_id = ${T}`;
      await sql`DELETE FROM stock_movements WHERE tenant_id = ${T}`;
      await sql`DELETE FROM account_entries WHERE tenant_id = ${T}`;
      await sql`DELETE FROM sales_profitability_snapshots WHERE tenant_id = ${T}`;
      await sql`DELETE FROM sales_orders WHERE tenant_id = ${T}`;
      await sql`DELETE FROM operational_alerts WHERE tenant_id = ${T}`;
      await sql`DELETE FROM idempotency_records WHERE tenant_id = ${T}`;
      await sql`DELETE FROM document_sequences WHERE tenant_id = ${T}`;
      await sql.end();
    }
  });

  beforeEach(async () => {
    await sql`DELETE FROM stock_reservations WHERE tenant_id = ${T}`;
    await sql`DELETE FROM sales_order_lines WHERE tenant_id = ${T}`;
    await sql`DELETE FROM inventory_balances WHERE tenant_id = ${T}`;
    await sql`DELETE FROM stock_movements WHERE tenant_id = ${T}`;
    await sql`DELETE FROM account_entries WHERE tenant_id = ${T}`;
    await sql`DELETE FROM sales_profitability_snapshots WHERE tenant_id = ${T}`;
    await sql`DELETE FROM sales_orders WHERE tenant_id = ${T}`;
    await sql`DELETE FROM operational_alerts WHERE tenant_id = ${T}`;
    await sql`DELETE FROM idempotency_records WHERE tenant_id = ${T}`;
    await sql`DELETE FROM document_sequences WHERE tenant_id = ${T}`;
  });

  async function countEffects(saleId: string) {
    const movements = await sql`SELECT COUNT(*)::int as cnt FROM stock_movements sm JOIN sales_order_lines sol ON sol.id = sm.source_document_id WHERE sm.tenant_id = ${T} AND sol.sales_order_id = ${saleId} AND sm.source_document_type = 'sales_order_line'`;
    const entries = await sql`SELECT COUNT(*)::int as cnt FROM account_entries WHERE tenant_id = ${T} AND source_document_type = 'sales_order' AND source_document_id = ${saleId}`;
    const snapshots = await sql`SELECT COUNT(*)::int as cnt FROM sales_profitability_snapshots WHERE tenant_id = ${T} AND sales_order_id = ${saleId}`;
    const reservations = await sql`SELECT COUNT(*)::int as cnt FROM stock_reservations WHERE tenant_id = ${T} AND sales_order_id = ${saleId} AND status = 'approved_consumed'`;
    const saleRow = await sql`SELECT sale_status, approval_status, is_locked, approved_by FROM sales_orders WHERE id = ${saleId}`;
    const balance = await sql`SELECT on_hand_qty_kg, reserved_qty_kg FROM inventory_balances WHERE tenant_id = ${T} AND item_id = ${ITEM}`;
    return {
      movements: movements[0]?.cnt ?? 0, entries: entries[0]?.cnt ?? 0,
      snapshots: snapshots[0]?.cnt ?? 0, consumedReservations: reservations[0]?.cnt ?? 0,
      saleStatus: saleRow[0]?.sale_status ?? "none", isLocked: saleRow[0]?.is_locked ?? false,
      approvedBy: saleRow[0]?.approved_by ?? null, onHand: balance[0]?.on_hand_qty_kg ?? "0",
      reservedQty: balance[0]?.reserved_qty_kg ?? "0",
    };
  }

  async function countAudit(actionType: string) {
    const rows = await sql`SELECT COUNT(*)::int as cnt FROM audit_logs WHERE tenant_id = ${T} AND action_type = ${actionType}`;
    return rows[0]?.cnt ?? 0;
  }

  async function createPendingSale(): Promise<string> {
    const { InventoryLedgerService } = await import("../../../server/services/inventory-ledger-service");
    const { InventoryLedgerDbRepository } = await import("../../../server/services/inventory-ledger-db-repository");
    const { AuditDbRepository } = await import("../../../server/services/audit-db-repository");
    const { IdempotencyDbRepository } = await import("../../../server/services/idempotency-db-repository");
    const { InProcessDocumentSequenceStore } = await import("../../../server/services/document-sequence-service");
    const { SalesDraftService } = await import("../../../server/services/sales-draft-service");
    const { SalesSubmissionService } = await import("../../../server/services/sales-submission-service");
    const { SalesDbRepository } = await import("../../../server/services/sales-db-repository");
    const { StockReservationDbRepository } = await import("../../../server/services/stock-reservation-db-repository");

    const audit = new AuditDbRepository(db);
    const idem = new IdempotencyDbRepository(db);
    const docSeq = new InProcessDocumentSequenceStore();
    const invLedger = new InventoryLedgerService({ ledger: new InventoryLedgerDbRepository(db), audit, idempotency: idem, documentSequence: docSeq });
    const salesRepo = new SalesDbRepository(db);
    const resRepo = new StockReservationDbRepository(db);
    const txRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => (db as any).transaction(async (tx: any) => work(tx));
    const txFact = {
      createInventoryLedger: (tx: unknown) => new InventoryLedgerService({ ledger: new InventoryLedgerDbRepository(tx as any), audit, idempotency: idem, documentSequence: docSeq }),
      createReservationRepository: (tx: unknown) => new StockReservationDbRepository(tx as any),
      createSalesRepository: (tx: unknown) => new SalesDbRepository(tx as any),
    };
    const subService = new SalesSubmissionService({ salesRepository: salesRepo, reservationRepository: resRepo, inventoryLedger: invLedger, audit, idempotency: idem, documentSequence: docSeq, transactionRunner: txRunner, txFactories: txFact });
    const draftService = new SalesDraftService({ salesRepository: salesRepo, audit, documentSequence: docSeq, submissionService: subService });

    const ownerUser = { authenticated: true as const, userId: OWNER_UID, tenantId: T, email: OWNER_EMAIL, name: "Owner", authId: "owner" };
    const whUser = { authenticated: true as const, userId: WH_UID, tenantId: T, email: WH_EMAIL, name: "WH", authId: "wh" };
    const ownerEff = { assignedRoleCodes: ["owner"] as const, permissionKeys: ownerPerms, deniedFieldKeys: new Set<string>(), workerFinancialDeny: false } as any;
    const whEff = { assignedRoleCodes: ["warehouse_employee"] as const, permissionKeys: new Set(["sales.create"]), deniedFieldKeys: new Set<string>(), workerFinancialDeny: true } as any;

    await invLedger.postRawReceipt(ownerUser as any, ownerEff as any, {
      itemId: ITEM, toLocationId: LOC1, quantityKg: "5000.000",
      movementDate: "2026-08-01", sourceDocumentType: "seed", sourceDocumentId: "50000000-0000-0000-0000-000000082001",
      idempotencyKey: `seed-stock-${Date.now()}`,
    });

    const draft = await draftService.createDraft(whUser as any, whEff as any, {
      customerId: CUST, saleDate: "2026-08-01",
      lines: [{ itemId: ITEM, locationId: LOC1, quantityKg: "100.000" }],
    });
    const lines = await salesRepo.findSaleLines(T, draft.saleId);
    await draftService.completeCommercialTotals(ownerUser as any, ownerEff as any, {
      saleId: draft.saleId, orderDiscountTotal: "0.00",
      linePrices: lines.map(l => ({ lineId: l.id, pricePerTon: "80.00" })),
    });
    await draftService.submitSale(ownerUser as any, ownerEff as any, {
      saleId: draft.saleId, idempotencyKey: `seed-submit-${draft.saleId}-${Date.now()}`,
    });
    return draft.saleId;
  }

  async function buildApprovalService(faulty: boolean) {
    const { SalesApprovalService } = await import("../../../server/services/sales-approval-service");
    const { InventoryLedgerService } = await import("../../../server/services/inventory-ledger-service");
    const { InventoryLedgerDbRepository } = await import("../../../server/services/inventory-ledger-db-repository");
    const { IdempotencyDbRepository } = await import("../../../server/services/idempotency-db-repository");
    const { AuditDbRepository } = await import("../../../server/services/audit-db-repository");
    const { InProcessDocumentSequenceStore } = await import("../../../server/services/document-sequence-service");
    const { SalesDbRepository } = await import("../../../server/services/sales-db-repository");
    const { StockReservationDbRepository } = await import("../../../server/services/stock-reservation-db-repository");
    const { SubledgerService } = await import("../../../server/services/subledger-service");
    const { SubledgerDbRepository } = await import("../../../server/services/subledger-db-repository");
    const { ProfitabilitySnapshotService } = await import("../../../server/services/profitability-snapshot-service");
    const { ProfitabilitySnapshotDbRepository } = await import("../../../server/services/profitability-snapshot-db-repository");
    const { IdempotencyOwnershipLostError } = await import("../../../server/services/idempotency-service");

    const audit = new AuditDbRepository(db);
    const idem = new IdempotencyDbRepository(db);
    const docSeq = new InProcessDocumentSequenceStore();
    const invLedger = new InventoryLedgerService({ ledger: new InventoryLedgerDbRepository(db), audit, idempotency: idem, documentSequence: docSeq });
    const subledger = new SubledgerService({ subledger: new SubledgerDbRepository(db), audit, idempotency: idem, documentSequence: docSeq });
    const snapSvc = new ProfitabilitySnapshotService({ snapshotRepository: new ProfitabilitySnapshotDbRepository(db), salesRepository: new SalesDbRepository(db), audit });
    const salesRepo = new SalesDbRepository(db);
    const resRepo = new StockReservationDbRepository(db);
    const txRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => (db as any).transaction(async (tx: any) => work(tx));

    const createFaultyIdem = (tx: any) => {
      const real = new IdempotencyDbRepository(tx);
      return {
        findByTenantScopeKey: real.findByTenantScopeKey.bind(real),
        insert: real.insert.bind(real),
        claimExpiredLease: real.claimExpiredLease.bind(real),
        heartbeat: real.heartbeat.bind(real),
        updateState: async (id: string, update: any) => {
          if (faulty && update.state === "succeeded") {
            throw new IdempotencyOwnershipLostError(id, update.expectedOwnerToken);
          }
          return real.updateState(id, update);
        },
      };
    };

    const txFactories = {
      createInventoryLedger: (tx: unknown) => new InventoryLedgerService({ ledger: new InventoryLedgerDbRepository(tx as any), audit, idempotency: idem, documentSequence: docSeq }),
      createSubledger: (tx: unknown) => new SubledgerService({ subledger: new SubledgerDbRepository(tx as any), audit, idempotency: idem, documentSequence: docSeq }),
      createSalesRepository: (tx: unknown) => new SalesDbRepository(tx as any),
      createReservationRepository: (tx: unknown) => new StockReservationDbRepository(tx as any),
      createSnapshotService: (tx: unknown) => new ProfitabilitySnapshotService({ snapshotRepository: new ProfitabilitySnapshotDbRepository(tx as any), salesRepository: new SalesDbRepository(tx as any), audit }),
      createIdempotency: faulty ? createFaultyIdem : ((tx: unknown) => new IdempotencyDbRepository(tx as any)),
      createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
    };

    return new SalesApprovalService({ salesRepository: salesRepo, reservationRepository: resRepo, inventoryLedger: invLedger, subledger, snapshotService: snapSvc, audit, idempotency: idem, documentSequence: docSeq, transactionRunner: txRunner, txFactories });
  }

  it("A: SalesApprovalService — ownership loss at markSucceeded → full rollback + retry succeeds", async () => {
    const saleId = await createPendingSale();
    const ownerUser = { authenticated: true as const, userId: OWNER_UID, tenantId: T, email: OWNER_EMAIL, name: "Owner", authId: "owner" };
    const ownerEff = { assignedRoleCodes: ["owner"] as const, permissionKeys: ownerPerms, deniedFieldKeys: new Set<string>(), workerFinancialDeny: false } as any;

    const before = await countEffects(saleId);
    expect(before.saleStatus).toBe("pending_approval");
    const auditBeforeApprove = await countAudit("sales_approval.approve");

    // Faulty service throws at markSucceeded
    const faultyService = await buildApprovalService(true);
    let threw = false;
    try {
      await faultyService.approveSale(ownerUser as any, ownerEff as any, { saleId, idempotencyKey: "faulty-approve-1" });
    } catch { threw = true; }
    expect(threw).toBe(true);

    // Verify rollback
    const after = await countEffects(saleId);
    expect(after.saleStatus).toBe("pending_approval");
    expect(after.isLocked).toBe(false);
    expect(after.approvedBy).toBeNull();
    expect(after.movements).toBe(0);
    expect(after.entries).toBe(0);
    expect(after.snapshots).toBe(0);
    expect(after.consumedReservations).toBe(0);
    expect(after.onHand).toBe("5000.000");
    expect(after.reservedQty).toBe("100.000");
    // Audit: tx-scoped audit rolls back with the transaction — exactly zero new audit rows.
    const auditAfterFault = await countAudit("sales_approval.approve");
    expect(auditAfterFault).toBe(auditBeforeApprove);

    // Verify idempotency not succeeded
    const idemRow = await sql`SELECT state FROM idempotency_records WHERE tenant_id = ${T} AND idempotency_key = 'faulty-approve-1'`;
    expect(idemRow[0]?.state).not.toBe("succeeded");

    // Clean up faulty idempotency record for retry
    await sql`DELETE FROM idempotency_records WHERE tenant_id = ${T} AND idempotency_key = 'faulty-approve-1'`;

    // Valid retry
    const validService = await buildApprovalService(false);
    const result = await validService.approveSale(ownerUser as any, ownerEff as any, { saleId, idempotencyKey: "valid-approve-1" });
    expect(result.action).toBe("posted");
    expect(result.saleStatus).toBe("approved");

    const afterSuccess = await countEffects(saleId);
    expect(afterSuccess.saleStatus).toBe("approved");
    expect(afterSuccess.isLocked).toBe(true);
    expect(afterSuccess.movements).toBe(1);
    expect(afterSuccess.entries).toBe(1);
    expect(afterSuccess.snapshots).toBe(1);
    expect(afterSuccess.consumedReservations).toBe(1);
    expect(afterSuccess.onHand).toBe("4900.000");
    expect(afterSuccess.reservedQty).toBe("0.000");
    // Audit: exactly one new business audit row from the valid retry.
    const auditAfterRetry = await countAudit("sales_approval.approve");
    expect(auditAfterRetry).toBe(auditBeforeApprove + 1);

    // Replay → zero new effects
    const validService2 = await buildApprovalService(false);
    const replayResult = await validService2.approveSale(ownerUser as any, ownerEff as any, { saleId, idempotencyKey: "valid-approve-1" });
    expect(replayResult.action).toBe("replayed");

    const afterReplay = await countEffects(saleId);
    expect(afterReplay.movements).toBe(1);
    expect(afterReplay.entries).toBe(1);
    expect(afterReplay.snapshots).toBe(1);
    // Audit: zero additional audit rows after replay
    const auditAfterReplay = await countAudit("sales_approval.approve");
    expect(auditAfterReplay).toBe(auditBeforeApprove + 1);
  });

  it("B: SalesFailureResolutionService — ownership loss → rollback + retry succeeds", async () => {
    const saleId = await createPendingSale();
    const ownerUser = { authenticated: true as const, userId: OWNER_UID, tenantId: T, email: OWNER_EMAIL, name: "Owner", authId: "owner" };
    const ownerEff = { assignedRoleCodes: ["owner"] as const, permissionKeys: ownerPerms, deniedFieldKeys: new Set<string>(), workerFinancialDeny: false } as any;

    await sql`UPDATE sales_orders SET quality_warning_status = ${"quality_risk"} WHERE id = ${saleId}`;

    const { SalesFailureResolutionService } = await import("../../../server/services/sales-failure-resolution-service");
    const { InventoryLedgerService } = await import("../../../server/services/inventory-ledger-service");
    const { InventoryLedgerDbRepository } = await import("../../../server/services/inventory-ledger-db-repository");
    const { IdempotencyDbRepository } = await import("../../../server/services/idempotency-db-repository");
    const { AuditDbRepository } = await import("../../../server/services/audit-db-repository");
    const { InProcessDocumentSequenceStore } = await import("../../../server/services/document-sequence-service");
    const { SalesDbRepository } = await import("../../../server/services/sales-db-repository");
    const { StockReservationDbRepository } = await import("../../../server/services/stock-reservation-db-repository");
    const { OperationalAlertDbRepository } = await import("../../../server/services/operational-alert-db-repository");
    const { IdempotencyOwnershipLostError } = await import("../../../server/services/idempotency-service");

    const audit = new AuditDbRepository(db);
    const idem = new IdempotencyDbRepository(db);
    const docSeq = new InProcessDocumentSequenceStore();
    const invLedger = new InventoryLedgerService({ ledger: new InventoryLedgerDbRepository(db), audit, idempotency: idem, documentSequence: docSeq });
    const salesRepo = new SalesDbRepository(db);
    const resRepo = new StockReservationDbRepository(db);
    const alertRepo = new OperationalAlertDbRepository(db);
    const txRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => (db as any).transaction(async (tx: any) => work(tx));

    const createFaultyIdem = (tx: any) => {
      const real = new IdempotencyDbRepository(tx);
      return {
        findByTenantScopeKey: real.findByTenantScopeKey.bind(real),
        insert: real.insert.bind(real),
        claimExpiredLease: real.claimExpiredLease.bind(real),
        heartbeat: real.heartbeat.bind(real),
        updateState: async (id: string, update: any) => {
          if (update.state === "succeeded") throw new IdempotencyOwnershipLostError(id, update.expectedOwnerToken);
          return real.updateState(id, update);
        },
      };
    };

    const faultyTxFactories = {
      createInventoryLedger: (tx: unknown) => new InventoryLedgerService({ ledger: new InventoryLedgerDbRepository(tx as any), audit, idempotency: idem, documentSequence: docSeq }),
      createReservationRepository: (tx: unknown) => new StockReservationDbRepository(tx as any),
      createSalesRepository: (tx: unknown) => new SalesDbRepository(tx as any),
      createAlertRepository: (tx: unknown) => new OperationalAlertDbRepository(tx as any),
      createIdempotency: createFaultyIdem,
      createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
    };

    const faultyService = new SalesFailureResolutionService({
      salesRepository: salesRepo, reservationRepository: resRepo, alertRepository: alertRepo,
      inventoryLedger: invLedger, audit, idempotency: idem, transactionRunner: txRunner, txFactories: faultyTxFactories,
    });

    const auditBeforeResolve = await countAudit("sales_failure_resolution.resolve");

    let threw = false;
    try {
      await faultyService.resolveSaleFailure(ownerUser as any, ownerEff as any, {
        saleId, reason: "missing_or_corrupted_reservation",
        resolutionReason: "Test", idempotencyKey: "faulty-resolve-1",
      });
    } catch { threw = true; }
    expect(threw).toBe(true);

    // Verify rollback
    const afterFault = await countEffects(saleId);
    expect(afterFault.saleStatus).toBe("pending_approval");
    const afterRes = await sql`SELECT status FROM stock_reservations WHERE tenant_id = ${T} AND sales_order_id = ${saleId}`;
    expect(afterRes[0]?.status).toBe("active");
    const afterAlerts = await sql`SELECT COUNT(*)::int as cnt FROM operational_alerts WHERE tenant_id = ${T}`;
    expect(afterAlerts[0]?.cnt).toBe(0);
    expect(afterFault.reservedQty).toBe("100.000"); // unchanged after rollback
    // Audit: tx-scoped audit rolls back — exactly zero new audit rows.
    const auditAfterFault = await countAudit("sales_failure_resolution.resolve");
    expect(auditAfterFault).toBe(auditBeforeResolve);

    // Clean up faulty idempotency record
    await sql`DELETE FROM idempotency_records WHERE tenant_id = ${T} AND idempotency_key = 'faulty-resolve-1'`;

    // Valid retry
    const validTxFactories = {
      createInventoryLedger: (tx: unknown) => new InventoryLedgerService({ ledger: new InventoryLedgerDbRepository(tx as any), audit, idempotency: idem, documentSequence: docSeq }),
      createReservationRepository: (tx: unknown) => new StockReservationDbRepository(tx as any),
      createSalesRepository: (tx: unknown) => new SalesDbRepository(tx as any),
      createAlertRepository: (tx: unknown) => new OperationalAlertDbRepository(tx as any),
      createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
      createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
    };

    const validService = new SalesFailureResolutionService({
      salesRepository: salesRepo, reservationRepository: resRepo, alertRepository: alertRepo,
      inventoryLedger: invLedger, audit, idempotency: idem, transactionRunner: txRunner, txFactories: validTxFactories,
    });

    const result = await validService.resolveSaleFailure(ownerUser as any, ownerEff as any, {
      saleId, reason: "missing_or_corrupted_reservation",
      resolutionReason: "Valid", idempotencyKey: "valid-resolve-1",
    });
    expect(result.action).toBe("resolved");
    expect(result.saleStatus).toBe("approval_failed");
    expect(result.reservationMarkedFailed).toBe(true);
    expect(result.criticalAlertIds).toHaveLength(1);
    // Verify reservation failed and reserved_qty reconciled
    const afterRetryRes = await sql`SELECT status FROM stock_reservations WHERE tenant_id = ${T} AND sales_order_id = ${saleId}`;
    expect(afterRetryRes[0]?.status).toBe("failed");
    const afterRetryEffects = await countEffects(saleId);
    expect(afterRetryEffects.reservedQty).toBe("0.000"); // reconciled after valid retry
    // Audit: exactly one new business audit row from the valid retry.
    const auditAfterRetry = await countAudit("sales_failure_resolution.resolve");
    expect(auditAfterRetry).toBe(auditBeforeResolve + 1);

    // Replay → zero new effects
    const replayResult = await validService.resolveSaleFailure(ownerUser as any, ownerEff as any, {
      saleId, reason: "missing_or_corrupted_reservation",
      resolutionReason: "Valid", idempotencyKey: "valid-resolve-1",
    });
    expect(replayResult.action).toBe("replayed");

    const afterReplayAlerts = await sql`SELECT COUNT(*)::int as cnt FROM operational_alerts WHERE tenant_id = ${T}`;
    expect(afterReplayAlerts[0]?.cnt).toBe(1);
    const afterReplayRes = await sql`SELECT status FROM stock_reservations WHERE tenant_id = ${T} AND sales_order_id = ${saleId}`;
    expect(afterReplayRes[0]?.status).toBe("failed"); // unchanged after replay
    // Audit: zero additional audit rows after replay
    const auditAfterReplay = await countAudit("sales_failure_resolution.resolve");
    expect(auditAfterReplay).toBe(auditBeforeResolve + 1);
  });
});
