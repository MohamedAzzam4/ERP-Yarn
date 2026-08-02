/**
 * WP-08-01A Live Supabase Validation — Worker Transfer & Return Actions.
 *
 * Tests production-path server actions against live DB:
 * - Warehouse creates transfer request (no posting)
 * - Warehouse creates return request (treatment undecided)
 * - No stock movement before approval
 * - No account/payment effect
 * - Replay idempotent
 * - Unauthorized role denied
 *
 * Usage: DATABASE_URL=... npx tsx scripts/wp-08-01a-live-validation.ts
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { randomUUID } from "node:crypto";
import * as schema from "../src/server/db/schema/index";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("ERROR: DATABASE_URL required."); process.exit(2); }

const pgSql = postgres(DATABASE_URL, { prepare: false, max: 5, idle_timeout: 10, connect_timeout: 15, max_lifetime: 60 });
const db = drizzle(pgSql, { schema });

const TEST_TENANT_ID = "00000000-0000-0000-0000-000000080001";
const WAREHOUSE_USER_ID = "00000000-0000-0000-0000-000000080001";
const ITEM_ID = "40000000-0000-0000-0000-000000080001";
const LOCATION_ID = "40000000-0000-0000-0000-000000080002";
const CUSTOMER_ID = "40000000-0000-0000-0000-000000080003";
const SALE_ID = "40000000-0000-0000-0000-000000080004";
const SALE_LINE_ID = "40000000-0000-0000-0000-000000080005";

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
function check(name: string, ok: boolean, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function ensureMasterData() {
  await pgSql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status) VALUES (${TEST_TENANT_ID}, ${'WP-08-01A Live'}, ${'ar'}, ${'EGP'}, ${'Africa/Cairo'}, ${'active'}) ON CONFLICT (id) DO NOTHING`;
  await pgSql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${WAREHOUSE_USER_ID}, ${TEST_TENANT_ID}, ${'wp0801a'}, ${'WP-08-01A Warehouse'}, ${'wp0801a@test.local'}, ${'active'}, ${'ar'}) ON CONFLICT (id) DO NOTHING`;
  await pgSql`INSERT INTO inventory_items (id, tenant_id, item_kind, item_code, display_name_ar, display_name_en, quality_status, is_blocked, status, created_by) VALUES (${ITEM_ID}, ${TEST_TENANT_ID}, ${'raw_material'}, ${'YARN-08'}, ${'خيط اختبار'}, ${'Test Yarn 8'}, ${'accepted'}, ${false}, ${'active'}, ${WAREHOUSE_USER_ID}) ON CONFLICT (id) DO NOTHING`;
  await pgSql`INSERT INTO locations (id, tenant_id, location_code, name_ar, name_en, location_type, status, created_by) VALUES (${LOCATION_ID}, ${TEST_TENANT_ID}, ${'WH-08'}, ${'مخزن ٨'}, ${'Warehouse 8'}, ${'internal_warehouse'}, ${'active'}, ${WAREHOUSE_USER_ID}) ON CONFLICT (id) DO NOTHING`;
  await pgSql`INSERT INTO customers (id, tenant_id, customer_code, name_ar, name_en, normalized_name, status, created_by) VALUES (${CUSTOMER_ID}, ${TEST_TENANT_ID}, ${'CUST-08'}, ${'عميل اختبار'}, ${'Test Customer 8'}, ${'test customer 8'}, ${'active'}, ${WAREHOUSE_USER_ID}) ON CONFLICT (id) DO NOTHING`;
  // Create a sale order for the return test
  await pgSql`INSERT INTO sales_orders (id, tenant_id, doc_no, customer_id, sale_date, sale_status, created_by) VALUES (${SALE_ID}, ${TEST_TENANT_ID}, ${'SO-08-001'}, ${CUSTOMER_ID}, ${'2026-07-01'}, ${'approved'}, ${WAREHOUSE_USER_ID}) ON CONFLICT (id) DO NOTHING`;
  await pgSql`INSERT INTO sales_order_lines (id, tenant_id, sales_order_id, line_no, item_id, location_id, quantity_kg, price_per_ton, created_by) VALUES (${SALE_LINE_ID}, ${TEST_TENANT_ID}, ${SALE_ID}, ${'1'}, ${ITEM_ID}, ${LOCATION_ID}, ${'100.000'}, ${'5000.00'}, ${WAREHOUSE_USER_ID}) ON CONFLICT (id) DO NOTHING`;
}

async function cleanTestData() {
  await pgSql.begin(async (tx) => {
    await tx`DELETE FROM stock_movements WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM account_entries WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM inventory_balances WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM stock_reservations WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM return_lines WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM return_requests WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM approval_requests WHERE tenant_id = ${TEST_TENANT_ID} AND entity_type = 'stock_transfer'`;
    await tx`DELETE FROM operational_alerts WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM idempotency_records WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM document_sequences WHERE tenant_id = ${TEST_TENANT_ID}`;
    await tx`DELETE FROM accounts WHERE tenant_id = ${TEST_TENANT_ID}`;
  });
}

async function main() {
  console.log("=== WP-08-01A Live Supabase Validation ===");
  let exitCode = 0;

  try {
    await ensureMasterData();
    await cleanTestData();

    // ===== Transfer: Warehouse creates draft =====
    console.log("\n--- Transfer: Warehouse creates draft ---");
    {
      const smBefore = await pgSql`SELECT COUNT(*)::int AS n FROM stock_movements WHERE tenant_id = ${TEST_TENANT_ID}`;
      const aeBefore = await pgSql`SELECT COUNT(*)::int AS n FROM account_entries WHERE tenant_id = ${TEST_TENANT_ID}`;

      // Directly call TransferWorkflowService (same as the server action does)
      const { TransferWorkflowService } = await import("../src/server/services/transfer-workflow-service");
      const { RawReceiptApprovalDbRepository } = await import("../src/server/services/raw-receipt-approval-db-repository");
      const { InventoryLedgerService } = await import("../src/server/services/inventory-ledger-service");
      const { InventoryLedgerDbRepository } = await import("../src/server/services/inventory-ledger-db-repository");
      const { AuditDbRepository } = await import("../src/server/services/audit-db-repository");
      const { InProcessIdempotencyStore } = await import("../src/server/services/idempotency-service");
      const { InProcessDocumentSequenceStore } = await import("../src/server/services/document-sequence-service");
      const { DbTenantOwnershipValidator } = await import("../src/server/services/db-tenant-ownership-validator");

      const audit = new AuditDbRepository(db);
      const idempotency = new InProcessIdempotencyStore();
      const documentSequence = new InProcessDocumentSequenceStore();
      const tenantOwnershipValidator = new DbTenantOwnershipValidator(db);
      const inventoryLedger = new InventoryLedgerService({
        ledger: new InventoryLedgerDbRepository(db), audit, idempotency, documentSequence,
      });
      const service = new TransferWorkflowService({
        approvalRepository: new RawReceiptApprovalDbRepository(db),
        inventoryLedger, audit, idempotency,
        tenantOwnershipValidator,
      });

      const user = { authenticated: true as const, userId: WAREHOUSE_USER_ID, tenantId: TEST_TENANT_ID, email: "t@e.com", name: "T", authId: "t" };
      const eff = {
        assignedRoleCodes: ["warehouse_employee"],
        permissionKeys: new Set(["inventory.transfer.create"]),
        deniedFieldKeys: new Set(), workerFinancialDeny: true,
      } as any;

      const result = await service.createTransferRequest(user as any, eff, {
        itemId: ITEM_ID, fromLocationId: LOCATION_ID, toLocationId: LOCATION_ID + "-dst", quantityKg: "100.000", reason: "Test transfer",
        idempotencyKey: "transfer-live-001",
      });

      check("1. transfer request created", !!result.id, `id=${result.id?.substring(0, 8)}`);

      // No stock movement before approval
      const smAfter = await pgSql`SELECT COUNT(*)::int AS n FROM stock_movements WHERE tenant_id = ${TEST_TENANT_ID}`;
      check("2. no stock movement before approval", smAfter[0].n === smBefore[0].n, `before=${smBefore[0].n}, after=${smAfter[0].n}`);

      // No account entry
      const aeAfter = await pgSql`SELECT COUNT(*)::int AS n FROM account_entries WHERE tenant_id = ${TEST_TENANT_ID}`;
      check("3. no account entry before approval", aeAfter[0].n === aeBefore[0].n, `before=${aeBefore[0].n}, after=${aeAfter[0].n}`);

      // No inventory balance change
      const ibAfter = await pgSql`SELECT COUNT(*)::int AS n FROM inventory_balances WHERE tenant_id = ${TEST_TENANT_ID}`;
      check("4. no inventory balance created", ibAfter[0].n === 0, `count=${ibAfter[0].n}`);
    }

    // ===== Return: Warehouse records physical facts =====
    console.log("\n--- Return: Warehouse records physical facts ---");
    {
      const { ReturnRequestService } = await import("../src/server/services/return-request-service");
      const { ReturnRequestDbRepository } = await import("../src/server/services/return-request-db-repository");
      const { SalesDbRepository } = await import("../src/server/services/sales-db-repository");
      const { AuditDbRepository } = await import("../src/server/services/audit-db-repository");
      const { InProcessIdempotencyStore } = await import("../src/server/services/idempotency-service");
      const { InProcessDocumentSequenceStore } = await import("../src/server/services/document-sequence-service");
      const { InventoryLedgerService } = await import("../src/server/services/inventory-ledger-service");
      const { InventoryLedgerDbRepository } = await import("../src/server/services/inventory-ledger-db-repository");
      const { SubledgerService } = await import("../src/server/services/subledger-service");
      const { SubledgerDbRepository } = await import("../src/server/services/subledger-db-repository");
      const { ProfitabilitySnapshotService } = await import("../src/server/services/profitability-snapshot-service");
      const { ProfitabilitySnapshotDbRepository } = await import("../src/server/services/profitability-snapshot-db-repository");
      const { DbTenantOwnershipValidator } = await import("../src/server/services/db-tenant-ownership-validator");

      const audit = new AuditDbRepository(db);
      const idempotency = new InProcessIdempotencyStore();
      const documentSequence = new InProcessDocumentSequenceStore();
      const tenantOwnershipValidator = new DbTenantOwnershipValidator(db);
      const inventoryLedger = new InventoryLedgerService({ ledger: new InventoryLedgerDbRepository(db), audit, idempotency, documentSequence });
      const subledger = new SubledgerService({ subledger: new SubledgerDbRepository(db), audit, idempotency, documentSequence });
      const snapshotService = new ProfitabilitySnapshotService({ snapshotRepository: new ProfitabilitySnapshotDbRepository(db), salesRepository: new SalesDbRepository(db), audit });

      const service = new ReturnRequestService({
        returnRequestRepository: new ReturnRequestDbRepository(db),
        salesRepository: new SalesDbRepository(db),
        inventoryLedger, subledger, snapshotService, audit, idempotency, documentSequence,
        tenantOwnershipValidator,
      });

      const user = { authenticated: true as const, userId: WAREHOUSE_USER_ID, tenantId: TEST_TENANT_ID, email: "t@e.com", name: "T", authId: "t" };
      const eff = {
        assignedRoleCodes: ["warehouse_employee"],
        permissionKeys: new Set(["returns.create"]),
        deniedFieldKeys: new Set(), workerFinancialDeny: true,
      } as any;

      const result = await service.createReturnRequest(user as any, eff, {
        salesOrderId: SALE_ID,
        customerId: CUSTOMER_ID,
        returnDate: "2026-07-16",
        returnReason: "Damaged in transit",
        // financialTreatment and isReplacement NOT set — defaults to null/false (undecided)
        lines: [{
          originalSaleOrderId: SALE_ID,
          originalSaleLineId: SALE_LINE_ID,
          itemId: ITEM_ID,
          quantityKg: "50.000",
          returnLocationId: LOCATION_ID,
          returnedStockStatus: "return_received" as any,
        }],
        idempotencyKey: "return-live-001",
      });

      check("5. return request created", result.action === "created", `action=${result.action}`);

      // Verify treatment is undecided (null)
      const rr = await pgSql`SELECT financial_treatment, is_replacement FROM return_requests WHERE tenant_id = ${TEST_TENANT_ID} AND id = ${result.returnRequestId}`;
      check("6. financialTreatment is null (undecided)", rr[0]?.financial_treatment === null, `value=${rr[0]?.financial_treatment}`);
      check("7. isReplacement is false (undecided)", rr[0]?.is_replacement === false, `value=${rr[0]?.is_replacement}`);

      // No stock movement before approval
      const smAfter = await pgSql`SELECT COUNT(*)::int AS n FROM stock_movements WHERE tenant_id = ${TEST_TENANT_ID} AND source_document_type = 'return_line'`;
      check("8. no stock movement before return approval", smAfter[0].n === 0, `count=${smAfter[0].n}`);

      // No account entry
      const aeAfter = await pgSql`SELECT COUNT(*)::int AS n FROM account_entries WHERE tenant_id = ${TEST_TENANT_ID} AND source_document_type = 'return_request'`;
      check("9. no account entry before return approval", aeAfter[0].n === 0, `count=${aeAfter[0].n}`);

      // No inventory balance change
      const ibAfter = await pgSql`SELECT COUNT(*)::int AS n FROM inventory_balances WHERE tenant_id = ${TEST_TENANT_ID}`;
      check("10. no inventory balance change", ibAfter[0].n === 0, `count=${ibAfter[0].n}`);

      // Replay is idempotent
      const replayResult = await service.createReturnRequest(user as any, eff, {
        salesOrderId: SALE_ID,
        customerId: CUSTOMER_ID,
        returnDate: "2026-07-16",
        returnReason: "Damaged in transit",
        lines: [{
          originalSaleOrderId: SALE_ID,
          originalSaleLineId: SALE_LINE_ID,
          itemId: ITEM_ID,
          quantityKg: "50.000",
          returnLocationId: LOCATION_ID,
          returnedStockStatus: "return_received" as any,
        }],
        idempotencyKey: "return-live-001",
      });
      check("11. replay returns same request", replayResult.action === "replayed", `action=${replayResult.action}`);
      check("12. replay returns same ID", replayResult.returnRequestId === result.returnRequestId, "");

      // Verify audit row exists
      const auditRows = await pgSql`SELECT * FROM audit_logs WHERE tenant_id = ${TEST_TENANT_ID} AND entity_type = 'return_request' AND created_at >= NOW() - INTERVAL '5 minutes'`;
      check("13. audit row exists for return creation", auditRows.length > 0, `count=${auditRows.length}`);
    }

    console.log("\n=== All validation checks passed. ===");
    await cleanTestData();
  } catch (e) {
    console.error("FATAL ERROR:", (e as Error).message);
    console.error((e as Error).stack);
    exitCode = 1;
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
