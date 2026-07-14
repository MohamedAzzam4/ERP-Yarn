/**
 * WP-06-04 Live Supabase Validation — Replacement Return Workflow (production path).
 *
 * Production-path validation:
 *   - ReplacementWorkflowService
 *   - ReturnRequestService + ReturnRequestDbRepository
 *   - SalesDraftService + SalesDbRepository
 *   - SalesSubmissionService + SalesDbRepository + InventoryLedgerService/DbRepository
 *   - SalesApprovalService + SalesDbRepository + SubledgerService/DbRepository +
 *     ProfitabilitySnapshotService/DbRepository
 *   - AuditDbRepository
 *
 * The replacement order is a NORMAL sales order with is_replacement_order = true
 * + original_return_request_id set. It follows the ordinary sales pipeline:
 *   draft → completeCommercialTotals → submitSale (reserves stock) →
 *   approveSale (issues stock + posts receivable + creates profitability snapshot).
 *
 * The financial difference (equal/higher/lower) arises naturally from the linked
 * negative return credit + positive replacement receivable.
 *
 * Raw SQL is used ONLY for:
 *   - fixture setup (master data: tenants, users, customers, items, locations)
 *   - final assertions (reading account_entries, stock_movements, snapshots)
 *   - FK-safe cleanup (wrapped in pgSql.begin)
 *
 * No manual audit/stock/account/snapshot inserts as behavior proof.
 *
 * Usage: DATABASE_URL=... npx tsx scripts/wp-06-04-live-validation.ts
 * TEST-ONLY. Not for production use.
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../src/server/db/schema/index";
import { randomUUID } from "node:crypto";
import { ReturnRequestDbRepository } from "../src/server/services/return-request-db-repository";
import { ReturnRequestService } from "../src/server/services/return-request-service";
import { ReplacementWorkflowService } from "../src/server/services/replacement-workflow-service";
import { AuditDbRepository } from "../src/server/services/audit-db-repository";
import { InventoryLedgerDbRepository } from "../src/server/services/inventory-ledger-db-repository";
import { InventoryLedgerService } from "../src/server/services/inventory-ledger-service";
import { SubledgerDbRepository } from "../src/server/services/subledger-db-repository";
import { SubledgerService } from "../src/server/services/subledger-service";
import { SalesDbRepository } from "../src/server/services/sales-db-repository";
import { SalesDraftService } from "../src/server/services/sales-draft-service";
import { SalesSubmissionService } from "../src/server/services/sales-submission-service";
import { SalesApprovalService } from "../src/server/services/sales-approval-service";
import { StockReservationDbRepository } from "../src/server/services/stock-reservation-db-repository";
import { ProfitabilitySnapshotDbRepository } from "../src/server/services/profitability-snapshot-db-repository";
import { ProfitabilitySnapshotService } from "../src/server/services/profitability-snapshot-service";
import { InProcessIdempotencyStore } from "../src/server/services/idempotency-service";
import { InProcessDocumentSequenceStore } from "../src/server/services/document-sequence-service";
import type { ErpUserContext } from "../src/server/auth/erp-context";
import type { EffectivePermissions } from "../src/server/security/effective-permissions";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("ERROR: DATABASE_URL required."); process.exit(2); }

const pgSql = postgres(DATABASE_URL, {
  prepare: false,
  max: 10,
  idle_timeout: 30,
  connect_timeout: 30,
  max_lifetime: 180,
});
const db = drizzle(pgSql, { schema });
const cryptoRandomUUID = randomUUID;

const TEST_TENANT_ID = "00000000-0000-0000-0000-000000060004";
const TEST_USER_ID = "00000000-0000-0000-0000-000000060004";
const TEST_USER_ID_2 = "00000000-0000-0000-0000-000000060005";
const TEST_CUSTOMER_ID = "00000000-0000-4000-8000-cccc00060004";
const TEST_ITEM_ID = "00000000-0000-4000-8000-000000060004";
const TEST_LOCATION_ID = "00000000-0000-4000-8000-000000060005";

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
function check(name: string, ok: boolean, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const ownerUser: ErpUserContext = {
  authenticated: true, userId: TEST_USER_ID, tenantId: TEST_TENANT_ID,
  email: "wp0604@test.local", name: "WP-06-04 Owner", authId: "wp0604",
};
const acctUser: ErpUserContext = {
  authenticated: true, userId: TEST_USER_ID_2, tenantId: TEST_TENANT_ID,
  email: "wp0604-2@test.local", name: "WP-06-04 Accountant", authId: "wp0604-2",
};
const ownerEff: EffectivePermissions = {
  assignedRoleCodes: ["owner"],
  permissionKeys: new Set([
    "returns.create", "returns.approve", "sales.approve", "sales.submit",
    "sales.create", "sales.view_price", "quality_tests.create",
    "complaints.investigate", "inventory.receive.approve",
    "inventory.receive.create", "balances.view_customer",
    "balances.view_supplier_factory", "profitability.view",
  ]),
  deniedFieldKeys: new Set(), workerFinancialDeny: false,
} as any;
const acctEff: EffectivePermissions = {
  assignedRoleCodes: ["accountant"],
  permissionKeys: new Set([
    "returns.create", "returns.approve", "sales.approve", "sales.submit",
    "sales.create", "sales.view_price", "quality_tests.create",
    "complaints.investigate", "inventory.receive.approve",
    "inventory.receive.create", "balances.view_customer",
    "balances.view_supplier_factory", "profitability.view",
  ]),
  deniedFieldKeys: new Set(), workerFinancialDeny: false,
} as any;
const whEff: EffectivePermissions = {
  assignedRoleCodes: ["warehouse_employee"],
  permissionKeys: new Set(["inventory.receive.approve", "inventory.receive.create"]),
  deniedFieldKeys: new Set(), workerFinancialDeny: true,
} as any;
const qualityEff: EffectivePermissions = {
  assignedRoleCodes: ["quality_employee"],
  permissionKeys: new Set(["quality_tests.create", "complaints.investigate"]),
  deniedFieldKeys: new Set(), workerFinancialDeny: true,
} as any;

function wireServices() {
  const returnDbRepo = new ReturnRequestDbRepository(db);
  const auditDbRepo = new AuditDbRepository(db);
  const ledgerDbRepo = new InventoryLedgerDbRepository(db);
  const subledgerDbRepo = new SubledgerDbRepository(db);
  const salesDbRepo = new SalesDbRepository(db);
  const reservationDbRepo = new StockReservationDbRepository(db);
  const snapshotDbRepo = new ProfitabilitySnapshotDbRepository(db);
  const idempotency = new InProcessIdempotencyStore();
  const documentSequence = new InProcessDocumentSequenceStore();
  const inventoryLedger = new InventoryLedgerService({ ledger: ledgerDbRepo, audit: auditDbRepo, idempotency, documentSequence });
  const subledger = new SubledgerService({ subledger: subledgerDbRepo, audit: auditDbRepo, idempotency, documentSequence });
  const snapshotService = new ProfitabilitySnapshotService({ snapshotRepository: snapshotDbRepo, salesRepository: salesDbRepo, audit: auditDbRepo });
  const returnService = new ReturnRequestService({
    returnRequestRepository: returnDbRepo,
    audit: auditDbRepo, idempotency, documentSequence,
    inventoryLedger, subledger, salesRepository: salesDbRepo, snapshotService,
  });
  const salesSubmissionService = new SalesSubmissionService({
    salesRepository: salesDbRepo,
    reservationRepository: reservationDbRepo,
    inventoryLedger, audit: auditDbRepo, idempotency, documentSequence,
  });
  const salesDraftService = new SalesDraftService({
    salesRepository: salesDbRepo, audit: auditDbRepo, documentSequence,
    submissionService: salesSubmissionService,
  });
  const salesApprovalService = new SalesApprovalService({
    salesRepository: salesDbRepo,
    reservationRepository: reservationDbRepo,
    inventoryLedger, subledger, snapshotService,
    audit: auditDbRepo, idempotency, documentSequence,
  });
  const replacementService = new ReplacementWorkflowService({
    returnRequestRepository: returnDbRepo,
    salesRepository: salesDbRepo,
    audit: auditDbRepo, idempotency, documentSequence,
  });
  return {
    returnDbRepo, auditDbRepo, ledgerDbRepo, subledgerDbRepo, salesDbRepo, reservationDbRepo, snapshotDbRepo,
    idempotency, documentSequence, inventoryLedger, subledger, snapshotService,
    returnService, salesDraftService, salesSubmissionService, salesApprovalService, replacementService,
  };
}

type Services = ReturnType<typeof wireServices>;

async function ensureMasterData() {
  const r = Date.now().toString(36).slice(-6);
  await pgSql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status) VALUES (${TEST_TENANT_ID}, 'WP-06-04 Live', 'ar', 'EGP', 'Africa/Cairo', 'active') ON CONFLICT (id) DO NOTHING`;
  await pgSql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${TEST_USER_ID}, ${TEST_TENANT_ID}, 'wp0604', 'WP-06-04 Owner', 'wp0604@test.local', 'active', 'ar') ON CONFLICT (id) DO NOTHING`;
  await pgSql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${TEST_USER_ID_2}, ${TEST_TENANT_ID}, 'wp0604-2', 'WP-06-04 Accountant', 'wp0604-2@test.local', 'active', 'ar') ON CONFLICT (id) DO NOTHING`;
  await pgSql`INSERT INTO customers (id, tenant_id, customer_code, name_ar, name_en, normalized_name, status, created_by) VALUES (${TEST_CUSTOMER_ID}, ${TEST_TENANT_ID}, ${'CUST-' + r}, 'عميل 0604', 'Customer 0604', ${'customer ' + r}, 'active', ${TEST_USER_ID}) ON CONFLICT (id) DO NOTHING`;
  await pgSql`INSERT INTO inventory_items (id, tenant_id, item_kind, item_code, display_name_ar, display_name_en, quality_status, is_blocked, status, created_by) VALUES (${TEST_ITEM_ID}, ${TEST_TENANT_ID}, 'single_yarn', ${'ITEM-' + r}, 'صنف 0604', 'Item 0604', 'accepted', false, 'active', ${TEST_USER_ID}) ON CONFLICT (id) DO NOTHING`;
  await pgSql`INSERT INTO locations (id, tenant_id, location_code, name_ar, name_en, location_type, status, created_by) VALUES (${TEST_LOCATION_ID}, ${TEST_TENANT_ID}, ${'LOC-' + r}, 'موقع 0604', 'Location 0604', 'internal_warehouse', 'active', ${TEST_USER_ID}) ON CONFLICT (id) DO NOTHING`;
}

// FK-safe cleanup inside a single transaction.
async function cleanTestData() {
  await pgSql.begin(async (tx) => {
    await tx`DELETE FROM sales_profitability_snapshots WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM account_entries WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM accounts WHERE tenant_id = ${TEST_TENANT_ID} AND owner_type = 'customer'`;
    await tx`DELETE FROM return_lines WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM return_requests WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM stock_reservations WHERE tenant_id = ${TEST_TENANT_ID} AND item_id = ${TEST_ITEM_ID}`;
    await tx`DELETE FROM sales_order_lines WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM sales_orders WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM inventory_balances WHERE tenant_id = ${TEST_TENANT_ID} AND item_id = ${TEST_ITEM_ID}`;
    await tx`DELETE FROM stock_movements WHERE tenant_id = ${TEST_TENANT_ID} AND source_document_type IN ('return_request', 'test_seed', 'sales_order_line')`;
    await tx`DELETE FROM idempotency_records WHERE tenant_id = ${TEST_TENANT_ID} AND (operation_scope LIKE 'return_request_%' OR operation_scope LIKE 'replacement_workflow_%' OR operation_scope LIKE 'sales_%')`;
    await tx`DELETE FROM document_sequences WHERE tenant_id = ${TEST_TENANT_ID} AND document_type IN ('return_request', 'return_receipt', 'account_entry', 'sales_order', 'raw_receipt')`;
  });
}

async function setupSaleWithStock(services: Services) {
  await services.inventoryLedger.postRawReceipt(ownerUser as any, ownerEff as any, {
    itemId: TEST_ITEM_ID, toLocationId: TEST_LOCATION_ID, quantityKg: "10000.000",
    movementDate: "2026-07-06", sourceDocumentType: "test_seed", sourceDocumentId: cryptoRandomUUID(),
    idempotencyKey: "seed-" + Date.now(),
  });
  const sale = await services.salesDbRepo.insertSaleDraft({
    tenantId: TEST_TENANT_ID, docNo: "SO-" + Date.now().toString(36),
    customerId: TEST_CUSTOMER_ID, saleDate: "2026-07-10", createdBy: TEST_USER_ID,
  });
  await services.salesDbRepo.insertSaleLine({
    tenantId: TEST_TENANT_ID, salesOrderId: sale.id, lineNo: 1,
    itemId: TEST_ITEM_ID, locationId: TEST_LOCATION_ID,
    quantityKg: "1000.000", pricePerTon: "80.00",
  });
  await services.salesDbRepo.updateSaleCommercialTotals(TEST_TENANT_ID, sale.id, {
    totalGrossRevenue: "80.00", orderDiscountTotal: "0.00", documentTotalPosted: "80.00",
  });
  const lines = await services.salesDbRepo.findSaleLines(TEST_TENANT_ID, sale.id);
  await services.salesDbRepo.updateLineCommercialTotals(TEST_TENANT_ID, lines[0]!.id, {
    lineGrossRevenue: "80.00", lineAllocatedDiscountPrecise: "0.00",
    lineAllocatedDiscountPosted: "0.00", lineNetRevenuePrecise: "80.00",
    lineNetRevenuePosted: "80.00", roundingAdjustment: "0.00",
  });
  await services.salesDbRepo.markSaleApproved(TEST_TENANT_ID, sale.id, {
    approvedBy: TEST_USER_ID, approvedAt: new Date(),
  }, ["draft"]);
  await pgSql`UPDATE sales_orders SET subject_hash = ${"hash-" + Date.now()}, subject_version = 1 WHERE id = ${sale.id} AND tenant_id = ${TEST_TENANT_ID}`;
  await services.snapshotService.createVersion1Snapshot(ownerUser as any, {
    salesOrderId: sale.id, rawCost: "30.00", singleProductionCost: "20.00",
  });
  return { saleId: sale.id, saleLineId: lines[0]!.id };
}

async function createApprovedReplacementReturn(
  services: Services,
  saleId: string,
  saleLineId: string,
  qty: string = "100.000",
  keySuffix: string = "001",
): Promise<string> {
  const create = await services.returnService.createReturnRequest(ownerUser as any, ownerEff as any, {
    salesOrderId: saleId, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
    returnReason: "Replacement test " + keySuffix, financialTreatment: "replacement",
    lines: [{
      originalSaleOrderId: saleId, originalSaleLineId: saleLineId,
      itemId: TEST_ITEM_ID, quantityKg: qty, returnLocationId: TEST_LOCATION_ID,
      returnedStockStatus: "return_received",
      originalSaleLineNetUnitValue: "0.080000",
    }],
    idempotencyKey: "rr-" + keySuffix,
  });
  await services.returnService.submitReturnRequest(ownerUser as any, ownerEff as any, {
    returnRequestId: create.returnRequestId, idempotencyKey: "rr-" + keySuffix + ":submit",
  });
  await services.returnService.approveReturnRequest(acctUser as any, acctEff as any, {
    returnRequestId: create.returnRequestId, idempotencyKey: "rr-" + keySuffix + ":approve",
  });
  return create.returnRequestId;
}

async function completeSubmitApproveReplacementSale(
  services: Services,
  replacementSaleId: string,
  pricePerTon: string,
  keySuffix: string,
): Promise<void> {
  const replLines = await services.salesDbRepo.findSaleLines(TEST_TENANT_ID, replacementSaleId);
  await services.salesDraftService.completeCommercialTotals(ownerUser as any, ownerEff as any, {
    saleId: replacementSaleId,
    linePrices: replLines.map(l => ({ lineId: l.id, pricePerTon })),
    orderDiscountTotal: "0.00",
  });
  await services.salesSubmissionService.submitSale(ownerUser as any, ownerEff as any, {
    saleId: replacementSaleId, idempotencyKey: `repl-${keySuffix}:submit`,
  });
  await services.salesApprovalService.approveSale(acctUser as any, acctEff as any, {
    saleId: replacementSaleId, idempotencyKey: `repl-${keySuffix}:approve`,
  });
}

async function main() {
  console.log("=== WP-06-04 Live Supabase Validation (Production Path) ===");
  let exitCode = 0;

  try {
    await ensureMasterData();
    await cleanTestData();

    // ===== SECTION 1: Basic replacement order creation =====
    {
      const services = wireServices();
      const { saleId, saleLineId } = await setupSaleWithStock(services);
      const rrId = await createApprovedReplacementReturn(services, saleId, saleLineId);

      // 1. Approved return can create linked replacement order
      const replResult = await services.replacementService.createReplacementOrder(
        ownerUser as any, ownerEff as any,
        { returnRequestId: rrId, idempotencyKey: "repl-001" },
      );
      check("1. approved return creates linked replacement order", replResult.action === "created", `action=${replResult.action}`);
      check("   replacement sale status is draft", replResult.saleStatus === "draft", `status=${replResult.saleStatus}`);
      check("   return request linked", replResult.returnRequestId === rrId, `rrId=${replResult.returnRequestId}`);
      check("   original sale linked", replResult.originalSaleId === saleId, `saleId=${replResult.originalSaleId}`);

      // 2. Verify replacement sale has link fields set
      const sale = await services.salesDbRepo.findSaleById(TEST_TENANT_ID, replResult.replacementSaleId);
      check("2. replacement sale has is_replacement_order=true", sale?.isReplacementOrder === true, `isReplacement=${sale?.isReplacementOrder}`);
      check("   replacement sale has original_return_request_id set", sale?.originalReturnRequestId === rrId, `rrId=${sale?.originalReturnRequestId}`);

      // 3. Verify replacement sale lines mirror return lines
      const replLines = await services.salesDbRepo.findSaleLines(TEST_TENANT_ID, replResult.replacementSaleId);
      check("3. replacement sale has 1 line mirroring return", replLines.length === 1, `count=${replLines.length}`);
      check("   line has same itemId", replLines[0]?.itemId === TEST_ITEM_ID, `itemId=${replLines[0]?.itemId}`);
      check("   line has same quantity", replLines[0]?.quantityKg === "100.000", `qty=${replLines[0]?.quantityKg}`);
      check("   line has pricePerTon=null (set later by Owner)", replLines[0]?.pricePerTon === null, `price=${replLines[0]?.pricePerTon}`);

      // 4. Audit row for replacement creation
      const auditRows = await pgSql`SELECT * FROM audit_logs WHERE tenant_id = ${TEST_TENANT_ID} AND entity_type = 'replacement_workflow' AND entity_id = ${replResult.replacementSaleId}`;
      check("4. audit row for replacement creation", auditRows.length === 1, `count=${auditRows.length}`);
      check("   audit has returnRequestId", auditRows[0]?.new_values_json?.returnRequestId === rrId, `rrId=${auditRows[0]?.new_values_json?.returnRequestId}`);
      check("   audit has originalSaleId", auditRows[0]?.new_values_json?.originalSaleId === saleId, `saleId=${auditRows[0]?.new_values_json?.originalSaleId}`);
      check("   audit has isReplacementOrder=true", auditRows[0]?.new_values_json?.isReplacementOrder === true, `isReplacement=${auditRows[0]?.new_values_json?.isReplacementOrder}`);
    }

    // ===== SECTION 2: Unapproved return rejected =====
    await cleanTestData();
    {
      const services = wireServices();
      const { saleId, saleLineId } = await setupSaleWithStock(services);

      // Create + submit but DON'T approve
      const create = await services.returnService.createReturnRequest(ownerUser as any, ownerEff as any, {
        salesOrderId: saleId, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
        returnReason: "Unapproved", financialTreatment: "replacement",
        lines: [{
          originalSaleOrderId: saleId, originalSaleLineId: saleLineId,
          itemId: TEST_ITEM_ID, quantityKg: "100.000", returnLocationId: TEST_LOCATION_ID,
          returnedStockStatus: "return_received",
          originalSaleLineNetUnitValue: "0.080000",
        }],
        idempotencyKey: "rr-unapproved-001",
      });
      await services.returnService.submitReturnRequest(ownerUser as any, ownerEff as any, {
        returnRequestId: create.returnRequestId, idempotencyKey: "rr-unapproved-001:submit",
      });

      // Attempt to create replacement — should fail
      try {
        await services.replacementService.createReplacementOrder(ownerUser as any, ownerEff as any, {
          returnRequestId: create.returnRequestId, idempotencyKey: "repl-unapproved-001",
        });
        check("5. unapproved return rejected for replacement", false, "should have thrown");
      } catch (e) {
        check("5. unapproved return rejected for replacement", true, `error=${(e as Error).message.slice(0, 50)}`);
      }

      // Verify NO replacement order was created
      const existing = await services.salesDbRepo.findReplacementOrderByReturnRequestId(TEST_TENANT_ID, create.returnRequestId);
      check("   no replacement order exists for unapproved return", existing === null, `exists=${existing !== null}`);
    }

    // ===== SECTION 3: Idempotency =====
    await cleanTestData();
    {
      const services = wireServices();
      const { saleId, saleLineId } = await setupSaleWithStock(services);
      const rrId = await createApprovedReplacementReturn(services, saleId, saleLineId);

      // 6. Idempotency replay does not create duplicate
      const result1 = await services.replacementService.createReplacementOrder(ownerUser as any, ownerEff as any, {
        returnRequestId: rrId, idempotencyKey: "repl-idem-001",
      });
      const result2 = await services.replacementService.createReplacementOrder(ownerUser as any, ownerEff as any, {
        returnRequestId: rrId, idempotencyKey: "repl-idem-001",
      });
      check("6. idempotency replay returns same sale", result2.action === "replayed" && result2.replacementSaleId === result1.replacementSaleId, `action=${result2.action}`);

      // 7. Different idempotency key cannot duplicate
      try {
        await services.replacementService.createReplacementOrder(ownerUser as any, ownerEff as any, {
          returnRequestId: rrId, idempotencyKey: "repl-idem-002",
        });
        check("7. different idempotency key rejected", false, "should have thrown");
      } catch (e) {
        check("7. different idempotency key rejected", true, `error=${(e as Error).message.slice(0, 50)}`);
      }

      // Verify only ONE replacement order exists
      const replacementSales = await pgSql`SELECT COUNT(*)::int AS n FROM sales_orders WHERE tenant_id = ${TEST_TENANT_ID} AND is_replacement_order = true`;
      check("   only 1 replacement order exists", replacementSales[0].n === 1, `count=${replacementSales[0].n}`);
    }

    // ===== SECTION 4: Replacement follows normal sales pipeline =====
    await cleanTestData();
    {
      const services = wireServices();
      const { saleId, saleLineId } = await setupSaleWithStock(services);
      const rrId = await createApprovedReplacementReturn(services, saleId, saleLineId);

      const replResult = await services.replacementService.createReplacementOrder(ownerUser as any, ownerEff as any, {
        returnRequestId: rrId, idempotencyKey: "repl-pipeline-001",
      });

      // 8. Complete commercial totals + submit (creates reservation)
      await services.salesDraftService.completeCommercialTotals(ownerUser as any, ownerEff as any, {
        saleId: replResult.replacementSaleId,
        linePrices: (await services.salesDbRepo.findSaleLines(TEST_TENANT_ID, replResult.replacementSaleId)).map(l => ({ lineId: l.id, pricePerTon: "80.00" })),
        orderDiscountTotal: "0.00",
      });
      const submitResult = await services.salesSubmissionService.submitSale(ownerUser as any, ownerEff as any, {
        saleId: replResult.replacementSaleId, idempotencyKey: "repl-pipeline-001:submit",
      });
      check("8. replacement submission creates reservation", submitResult.saleStatus === "pending_approval", `status=${submitResult.saleStatus}`);

      const reservations = await pgSql`SELECT COUNT(*)::int AS n FROM stock_reservations WHERE tenant_id = ${TEST_TENANT_ID} AND sales_order_id = ${replResult.replacementSaleId}`;
      check("   reservation created for replacement", reservations[0].n === 1, `count=${reservations[0].n}`);

      // 9. Approve (issues stock + posts receivable + creates snapshot)
      const approveResult = await services.salesApprovalService.approveSale(acctUser as any, acctEff as any, {
        saleId: replResult.replacementSaleId, idempotencyKey: "repl-pipeline-001:approve",
      });
      check("9. replacement approval succeeds", approveResult.action === "posted" || approveResult.action === "approved", `action=${approveResult.action}`);

      const sale = await services.salesDbRepo.findSaleById(TEST_TENANT_ID, replResult.replacementSaleId);
      check("   sale status is approved", sale?.saleStatus === "approved", `status=${sale?.saleStatus}`);
      check("   sale is locked", sale?.isLocked === true, `locked=${sale?.isLocked}`);

      // 10. Stock issue movement created (sale_issue)
      const issueMovements = await pgSql`SELECT COUNT(*)::int AS n FROM stock_movements WHERE tenant_id = ${TEST_TENANT_ID} AND movement_type = 'sale_issue' AND source_document_type = 'sales_order_line'`;
      check("10. sale_issue movement created", issueMovements[0].n === 1, `count=${issueMovements[0].n}`);

      // 11. No manual stock difference movement (no inventory_adjustment)
      const adjustMovements = await pgSql`SELECT COUNT(*)::int AS n FROM stock_movements WHERE tenant_id = ${TEST_TENANT_ID} AND movement_type = 'inventory_adjustment'`;
      check("11. no manual stock difference movement", adjustMovements[0].n === 0, `count=${adjustMovements[0].n}`);

      // 12. No automatic refund/payment
      const paymentEntries = await pgSql`SELECT COUNT(*)::int AS n FROM account_entries WHERE tenant_id = ${TEST_TENANT_ID} AND entry_type IN ('customer_payment', 'supplier_payment', 'factory_payment')`;
      check("12. no automatic refund/payment", paymentEntries[0].n === 0, `count=${paymentEntries[0].n}`);

      // 13. Profitability snapshot created for replacement sale
      const replSnapshots = await pgSql`SELECT COUNT(*)::int AS n FROM sales_profitability_snapshots WHERE tenant_id = ${TEST_TENANT_ID} AND sales_order_id = ${replResult.replacementSaleId}`;
      check("13. profitability snapshot created for replacement", replSnapshots[0].n === 1, `count=${replSnapshots[0].n}`);

      // 14. Original sale NOT mutated
      const originalSale = await services.salesDbRepo.findSaleById(TEST_TENANT_ID, saleId);
      check("14. original sale not mutated (isReplacementOrder=false)", originalSale?.isReplacementOrder === false, `isReplacement=${originalSale?.isReplacementOrder}`);
      check("   original sale originalReturnRequestId is null", originalSale?.originalReturnRequestId === null, `rrId=${originalSale?.originalReturnRequestId}`);
    }

    // ===== SECTION 5: Equal/higher/lower replacement value =====
    await cleanTestData();
    {
      const services = wireServices();
      const { saleId, saleLineId } = await setupSaleWithStock(services);

      // 15. Equal replacement value → zero net new receivable
      const rrId1 = await createApprovedReplacementReturn(services, saleId, saleLineId, "100.000", "equal-001");
      const repl1 = await services.replacementService.createReplacementOrder(ownerUser as any, ownerEff as any, {
        returnRequestId: rrId1, idempotencyKey: "repl-equal-001",
      });
      await completeSubmitApproveReplacementSale(services, repl1.replacementSaleId, "80.00", "equal-001");

      const returnCredit1 = await pgSql`SELECT amount_signed FROM account_entries WHERE tenant_id = ${TEST_TENANT_ID} AND source_document_type = 'return_request' AND source_document_id = ${rrId1}`;
      const replReceivable1 = await pgSql`SELECT amount_signed FROM account_entries WHERE tenant_id = ${TEST_TENANT_ID} AND source_document_type = 'sales_order' AND source_document_id = ${repl1.replacementSaleId}`;
      const creditAmt1 = parseFloat(returnCredit1[0]?.amount_signed ?? "0");
      const replAmt1 = parseFloat(replReceivable1[0]?.amount_signed ?? "0");
      check("15. equal value: return credit = -8.00", creditAmt1 === -8.00, `credit=${creditAmt1}`);
      check("   equal value: replacement receivable = +8.00", replAmt1 === 8.00, `receivable=${replAmt1}`);
      check("   equal value: net = 0 (zero net new receivable)", creditAmt1 + replAmt1 === 0, `net=${creditAmt1 + replAmt1}`);
    }

    await cleanTestData();
    {
      const services = wireServices();
      const { saleId, saleLineId } = await setupSaleWithStock(services);

      // 16. Higher replacement value → customer owes difference
      const rrId2 = await createApprovedReplacementReturn(services, saleId, saleLineId, "100.000", "higher-001");
      const repl2 = await services.replacementService.createReplacementOrder(ownerUser as any, ownerEff as any, {
        returnRequestId: rrId2, idempotencyKey: "repl-higher-001",
      });
      await completeSubmitApproveReplacementSale(services, repl2.replacementSaleId, "100.00", "higher-001");

      const returnCredit2 = await pgSql`SELECT amount_signed FROM account_entries WHERE tenant_id = ${TEST_TENANT_ID} AND source_document_type = 'return_request' AND source_document_id = ${rrId2}`;
      const replReceivable2 = await pgSql`SELECT amount_signed FROM account_entries WHERE tenant_id = ${TEST_TENANT_ID} AND source_document_type = 'sales_order' AND source_document_id = ${repl2.replacementSaleId}`;
      const creditAmt2 = parseFloat(returnCredit2[0]?.amount_signed ?? "0");
      const replAmt2 = parseFloat(replReceivable2[0]?.amount_signed ?? "0");
      check("16. higher value: return credit = -8.00", creditAmt2 === -8.00, `credit=${creditAmt2}`);
      check("   higher value: replacement receivable = +10.00", replAmt2 === 10.00, `receivable=${replAmt2}`);
      check("   higher value: net = +2.00 (customer owes 2.00)", creditAmt2 + replAmt2 === 2.00, `net=${creditAmt2 + replAmt2}`);
    }

    await cleanTestData();
    {
      const services = wireServices();
      const { saleId, saleLineId } = await setupSaleWithStock(services);

      // 17. Lower replacement value → customer credit remains
      const rrId3 = await createApprovedReplacementReturn(services, saleId, saleLineId, "100.000", "lower-001");
      const repl3 = await services.replacementService.createReplacementOrder(ownerUser as any, ownerEff as any, {
        returnRequestId: rrId3, idempotencyKey: "repl-lower-001",
      });
      await completeSubmitApproveReplacementSale(services, repl3.replacementSaleId, "60.00", "lower-001");

      const returnCredit3 = await pgSql`SELECT amount_signed FROM account_entries WHERE tenant_id = ${TEST_TENANT_ID} AND source_document_type = 'return_request' AND source_document_id = ${rrId3}`;
      const replReceivable3 = await pgSql`SELECT amount_signed FROM account_entries WHERE tenant_id = ${TEST_TENANT_ID} AND source_document_type = 'sales_order' AND source_document_id = ${repl3.replacementSaleId}`;
      const creditAmt3 = parseFloat(returnCredit3[0]?.amount_signed ?? "0");
      const replAmt3 = parseFloat(replReceivable3[0]?.amount_signed ?? "0");
      check("17. lower value: return credit = -8.00", creditAmt3 === -8.00, `credit=${creditAmt3}`);
      check("   lower value: replacement receivable = +6.00", replAmt3 === 6.00, `receivable=${replAmt3}`);
      check("   lower value: net = -2.00 (customer has 2.00 credit)", creditAmt3 + replAmt3 === -2.00, `net=${creditAmt3 + replAmt3}`);
    }

    // ===== SECTION 6: Rollback on failure =====
    await cleanTestData();
    {
      const services = wireServices();
      const { saleId, saleLineId } = await setupSaleWithStock(services);

      // Create an unapproved return (will fail at state check)
      const create = await services.returnService.createReturnRequest(ownerUser as any, ownerEff as any, {
        salesOrderId: saleId, customerId: TEST_CUSTOMER_ID, returnDate: "2026-07-10",
        returnReason: "Rollback test", financialTreatment: "replacement",
        lines: [{
          originalSaleOrderId: saleId, originalSaleLineId: saleLineId,
          itemId: TEST_ITEM_ID, quantityKg: "100.000", returnLocationId: TEST_LOCATION_ID,
          returnedStockStatus: "return_received",
          originalSaleLineNetUnitValue: "0.080000",
        }],
        idempotencyKey: "rr-rollback-001",
      });

      // Attempt to create replacement — should fail (return not approved)
      try {
        await services.replacementService.createReplacementOrder(ownerUser as any, ownerEff as any, {
          returnRequestId: create.returnRequestId, idempotencyKey: "repl-rollback-001",
        });
        check("18. rollback: unapproved return fails", false, "should have thrown");
      } catch (e) {
        check("18. rollback: unapproved return fails", true, `error=${(e as Error).message.slice(0, 50)}`);
      }

      // Verify NO replacement order was created (no partial linkage)
      const existing = await services.salesDbRepo.findReplacementOrderByReturnRequestId(TEST_TENANT_ID, create.returnRequestId);
      check("   no replacement order exists after failed creation", existing === null, `exists=${existing !== null}`);
    }

    // ===== CLEANUP =====
    await cleanTestData();
    console.log("\n=== Cleanup completed successfully ===");

  } catch (e) {
    console.error("FATAL ERROR:", (e as Error).message);
    console.error((e as Error).stack);
    exitCode = 1;
  } finally {
    try { await cleanTestData(); } catch (e) { /* ignore cleanup errors in finally */ }
    await pgSql.end({ timeout: 5 });
  }

  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n=== Summary ===\nPassed: ${passed} / ${results.length}\nFailed: ${failed}`);
  if (failed > 0) {
    console.log("\nFailures:");
    for (const r of results.filter(r => !r.ok)) console.log(`  - ${r.name}: ${r.detail}`);
    exitCode = 1;
  }
  process.exit(exitCode);
}

main();
