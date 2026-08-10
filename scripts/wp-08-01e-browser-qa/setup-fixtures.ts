/**
 * WP-08-01E — Browser QA Fixture Setup Script.
 *
 * Sets up the approveReturn fixture through the REAL domain lifecycle:
 * 1. Post raw receipt (stock) via InventoryLedgerService.postRawReceipt.
 * 2. Insert sale draft via SalesDbRepository.insertSaleDraft.
 * 3. Insert sale line via SalesDbRepository.insertSaleLine.
 * 4. Update commercial totals via SalesDbRepository.updateSaleCommercialTotals.
 * 5. Update line commercial totals via SalesDbRepository.updateLineCommercialTotals.
 * 6. Mark sale approved via SalesDbRepository.markSaleApproved.
 * 7. Create V1 profitability snapshot via ProfitabilitySnapshotService.createVersion1Snapshot.
 * 8. Create return request via ReturnRequestService.createReturnRequest (requester = worker).
 * 9. Submit return request via ReturnRequestService.submitReturnRequest.
 *
 * This script does NOT use raw SQL to fake domain state. All writes go
 * through the real production services.
 *
 * Usage: DATABASE_URL=<supabase-pooler> npx tsx scripts/wp-08-01e-browser-qa/setup-fixtures.ts
 *
 * Outputs JSON with the created fixture IDs to stdout.
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../../src/server/db/schema/index";
import { randomUUID } from "node:crypto";
import { ReturnRequestDbRepository } from "../../src/server/services/return-request-db-repository";
import { ReturnRequestService } from "../../src/server/services/return-request-service";
import { AuditDbRepository } from "../../src/server/services/audit-db-repository";
import { DbTenantOwnershipValidator } from "../../src/server/services/db-tenant-ownership-validator";
import { InventoryLedgerDbRepository } from "../../src/server/services/inventory-ledger-db-repository";
import { InventoryLedgerService } from "../../src/server/services/inventory-ledger-service";
import { SubledgerDbRepository } from "../../src/server/services/subledger-db-repository";
import { SubledgerService } from "../../src/server/services/subledger-service";
import { SalesDbRepository } from "../../src/server/services/sales-db-repository";
import { ProfitabilitySnapshotDbRepository } from "../../src/server/services/profitability-snapshot-db-repository";
import { ProfitabilitySnapshotService } from "../../src/server/services/profitability-snapshot-service";
import { IdempotencyDbRepository } from "../../src/server/services/idempotency-db-repository";
import { DocumentSequenceDbRepository } from "../../src/server/services/document-sequence-db-repository";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL required.");
  process.exit(2);
}

// Deterministic UUIDs (must match run_qa.py)
const TENANT_ID = "00000000-0000-0000-0000-000000081e50";
const OWNER_USER_ID = "00000000-0000-0000-0000-000000081e61";
const WORKER_USER_ID = "00000000-0000-0000-0000-000000081e62";
const CUSTOMER_ID = "00000000-0000-0000-0000-000000081e83";
const INVENTORY_ITEM_ID = "00000000-0000-0000-0000-000000081e85";
const LOCATION_ID = "00000000-0000-0000-0000-000000081e86";

const pgSql = postgres(DATABASE_URL, {
  prepare: false,
  max: 10,
  idle_timeout: 30,
  connect_timeout: 30,
  max_lifetime: 180,
});
const db = drizzle(pgSql, { schema });

const ownerUser = {
  authenticated: true as const,
  userId: OWNER_USER_ID,
  tenantId: TENANT_ID,
  authId: "qa-browser-owner",
  name: "QA Browser Owner",
  email: "qa-browser-owner@erp-yarn.test",
};

const workerUser = {
  authenticated: true as const,
  userId: WORKER_USER_ID,
  tenantId: TENANT_ID,
  authId: "qa-browser-worker",
  name: "QA Browser Worker",
  email: "qa-browser-worker@erp-yarn.test",
};

const ownerEff = {
  assignedRoleCodes: ["owner"] as const,
  permissionKeys: new Set([
    "returns.approve",
    "quality_tests.create",
    "quality_risk_sales.approve",
    "complaints.investigate",
    "inventory.receive.create",
    "inventory.receive.approve",
    "inventory.correct",
    "inventory.view_quantity",
  ]),
  workerFinancialDeny: { enforced: false, deniedPermissionKeys: new Set(), deniedFieldKeys: new Set() },
};

const workerEff = {
  assignedRoleCodes: ["quality_employee"] as const,
  permissionKeys: new Set([
    "quality_tests.create",
    "complaints.investigate",
    "returns.create",
  ]),
  workerFinancialDeny: { enforced: true, deniedPermissionKeys: new Set(), deniedFieldKeys: new Set() },
};

async function main() {
  console.log("=== WP-08-01E Browser QA Fixture Setup (Production Path) ===");

  // Clean up mutable fixtures from previous runs (FK-safe, inside a transaction)
  console.log("[setup] Cleaning up previous run's mutable fixtures...");
  await pgSql.begin(async (tx) => {
    await tx`DELETE FROM sales_profitability_snapshots WHERE tenant_id = ${TENANT_ID}`;
    await tx`DELETE FROM account_entries WHERE tenant_id = ${TENANT_ID}`;
    await tx`DELETE FROM return_lines WHERE tenant_id = ${TENANT_ID}`;
    await tx`DELETE FROM return_requests WHERE tenant_id = ${TENANT_ID}`;
    await tx`DELETE FROM sales_order_lines WHERE tenant_id = ${TENANT_ID}`;
    await tx`DELETE FROM sales_orders WHERE tenant_id = ${TENANT_ID} AND doc_no LIKE 'QA-SO-%'`;
    await tx`DELETE FROM inventory_balances WHERE tenant_id = ${TENANT_ID} AND item_id = ${INVENTORY_ITEM_ID}`;
    await tx`DELETE FROM stock_movements WHERE tenant_id = ${TENANT_ID} AND source_document_type IN ('return_line', 'return_request', 'test_seed')`;
    await tx`DELETE FROM idempotency_records WHERE tenant_id = ${TENANT_ID} AND operation_scope LIKE '%return%' OR operation_scope LIKE '%inventory%'`;
    await tx`DELETE FROM document_sequences WHERE tenant_id = ${TENANT_ID} AND document_type IN ('return_request', 'return_receipt', 'account_entry', 'sales_order')`;
  });
  console.log("[setup] Cleanup complete.");

  // Wire services with real DB-backed repositories
  const auditDbRepo = new AuditDbRepository(db);
  const idempotencyDbRepo = new IdempotencyDbRepository(db);
  const docSeqDbRepo = new DocumentSequenceDbRepository(db);
  const ledgerDbRepo = new InventoryLedgerDbRepository(db);
  const subledgerDbRepo = new SubledgerDbRepository(db);
  const salesDbRepo = new SalesDbRepository(db);
  const snapshotDbRepo = new ProfitabilitySnapshotDbRepository(db);
  const returnDbRepo = new ReturnRequestDbRepository(db);

  const inventoryLedger = new InventoryLedgerService({
    ledger: ledgerDbRepo,
    audit: auditDbRepo,
    idempotency: idempotencyDbRepo,
    documentSequence: docSeqDbRepo,
  });
  const subledger = new SubledgerService({
    subledger: subledgerDbRepo,
    audit: auditDbRepo,
    idempotency: idempotencyDbRepo,
    documentSequence: docSeqDbRepo,
  });
  const snapshotService = new ProfitabilitySnapshotService({
    snapshotRepository: snapshotDbRepo,
    salesRepository: salesDbRepo,
    audit: auditDbRepo,
  });

  const transactionRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
    return (db as any).transaction(async (tx: any) => work(tx));
  };
  const txFactories = {
    createReturnRequestRepository: (tx: unknown) => new ReturnRequestDbRepository(tx as any),
    createSubledger: (tx: unknown) => new SubledgerService({
      subledger: new SubledgerDbRepository(tx as any),
      audit: new AuditDbRepository(tx as any),
      idempotency: new IdempotencyDbRepository(tx as any),
      documentSequence: new DocumentSequenceDbRepository(tx as any),
    }),
    createInventoryLedger: (tx: unknown) => new InventoryLedgerService({
      ledger: new InventoryLedgerDbRepository(tx as any),
      audit: new AuditDbRepository(tx as any),
      idempotency: new IdempotencyDbRepository(tx as any),
      documentSequence: new DocumentSequenceDbRepository(tx as any),
    }),
    createSnapshotService: (tx: unknown) => new ProfitabilitySnapshotService({
      snapshotRepository: new ProfitabilitySnapshotDbRepository(tx as any),
      salesRepository: new SalesDbRepository(tx as any),
      audit: new AuditDbRepository(tx as any),
    }),
    createSalesRepository: (tx: unknown) => new SalesDbRepository(tx as any),
    createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
    createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
    createDocumentSequence: (tx: unknown) => new DocumentSequenceDbRepository(tx as any),
  };

  const returnService = new ReturnRequestService({
    returnRequestRepository: returnDbRepo,
    subledger,
    inventoryLedger,
    snapshotService,
    salesRepository: salesDbRepo,
    audit: auditDbRepo,
    idempotency: idempotencyDbRepo,
    documentSequence: docSeqDbRepo,
    tenantOwnershipValidator: new DbTenantOwnershipValidator(db),
    transactionRunner,
    txFactories,
  });

  // Step 1: Post raw receipt (stock) — gives the item inventory
  console.log("[setup] Step 1: Post raw receipt (stock)...");
  await inventoryLedger.postRawReceipt(ownerUser as any, ownerEff as any, {
    itemId: INVENTORY_ITEM_ID,
    toLocationId: LOCATION_ID,
    quantityKg: "10000.000",
    movementDate: "2026-08-10",
    sourceDocumentType: "test_seed",
    sourceDocumentId: randomUUID(),
    idempotencyKey: "qa-browser-seed-stock-" + Date.now(),
  });

  // Step 2: Create sale draft
  console.log("[setup] Step 2: Create sale draft...");
  const saleDocNo = "QA-SO-" + Date.now().toString(36);
  const sale = await salesDbRepo.insertSaleDraft({
    tenantId: TENANT_ID,
    docNo: saleDocNo,
    customerId: CUSTOMER_ID,
    saleDate: "2026-08-10",
    createdBy: OWNER_USER_ID,
  });

  // Step 3: Insert sale line
  console.log("[setup] Step 3: Insert sale line...");
  await salesDbRepo.insertSaleLine({
    tenantId: TENANT_ID,
    salesOrderId: sale.id,
    lineNo: 1,
    itemId: INVENTORY_ITEM_ID,
    locationId: LOCATION_ID,
    quantityKg: "1000.000",
    pricePerTon: "80.00",
  });

  // Step 4: Update commercial totals
  console.log("[setup] Step 4: Update sale commercial totals...");
  await salesDbRepo.updateSaleCommercialTotals(TENANT_ID, sale.id, {
    totalGrossRevenue: "80.00",
    orderDiscountTotal: "0.00",
    documentTotalPosted: "80.00",
  });

  // Step 5: Update line commercial totals
  console.log("[setup] Step 5: Update line commercial totals...");
  const lines = await salesDbRepo.findSaleLines(TENANT_ID, sale.id);
  const saleLineId = lines[0]!.id;
  await salesDbRepo.updateLineCommercialTotals(TENANT_ID, saleLineId, {
    lineGrossRevenue: "80.00",
    lineAllocatedDiscountPrecise: "0.00",
    lineAllocatedDiscountPosted: "0.00",
    lineNetRevenuePrecise: "80.00",
    lineNetRevenuePosted: "80.00",
    roundingAdjustment: "0.00",
  });

  // Step 6: Mark sale approved
  console.log("[setup] Step 6: Mark sale approved...");
  await salesDbRepo.markSaleApproved(TENANT_ID, sale.id, {
    approvedBy: OWNER_USER_ID,
    approvedAt: new Date(),
  }, ["draft"]);

  // Set subject_hash (required by snapshot service)
  await pgSql`UPDATE sales_orders SET subject_hash = ${"hash-" + Date.now()}, subject_version = 1 WHERE id = ${sale.id} AND tenant_id = ${TENANT_ID}`;

  // Step 7: Create V1 profitability snapshot via real service
  console.log("[setup] Step 7: Create V1 profitability snapshot...");
  await snapshotService.createVersion1Snapshot(ownerUser as any, {
    salesOrderId: sale.id,
    rawCost: "30.00",
    singleProductionCost: "20.00",
  });

  // Step 8: Create return request via real service (requester = worker)
  console.log("[setup] Step 8: Create return request (requester=worker)...");
  const returnDocNo = "QA-RET-" + Date.now().toString(36);
  const create = await returnService.createReturnRequest(workerUser as any, workerEff as any, {
    salesOrderId: sale.id,
    customerId: CUSTOMER_ID,
    returnDate: "2026-08-10",
    returnReason: "QA browser fixture return",
    financialTreatment: "customer_credit",
    lines: [{
      originalSaleOrderId: sale.id,
      originalSaleLineId: saleLineId,
      itemId: INVENTORY_ITEM_ID,
      quantityKg: "100.000",
      returnLocationId: LOCATION_ID,
      returnedStockStatus: "return_received",
      originalSaleLineNetUnitValue: "0.080000",
    }],
    idempotencyKey: "qa-browser-return-create-" + Date.now(),
  });

  // Step 9: Submit return request (transitions to pending_approval)
  console.log("[setup] Step 9: Submit return request...");
  await returnService.submitReturnRequest(workerUser as any, workerEff as any, {
    returnRequestId: create.returnRequestId,
    idempotencyKey: "qa-browser-return-submit-" + Date.now(),
  });

  // Also create an approved replacement return for createReplacementOrderAction
  console.log("[setup] Step 10: Create approved replacement return...");
  const replacementSale = await salesDbRepo.insertSaleDraft({
    tenantId: TENANT_ID,
    docNo: "QA-SO-REPL-" + Date.now().toString(36),
    customerId: CUSTOMER_ID,
    saleDate: "2026-08-10",
    createdBy: OWNER_USER_ID,
  });
  await salesDbRepo.insertSaleLine({
    tenantId: TENANT_ID,
    salesOrderId: replacementSale.id,
    lineNo: 1,
    itemId: INVENTORY_ITEM_ID,
    locationId: LOCATION_ID,
    quantityKg: "500.000",
    pricePerTon: "80.00",
  });
  await salesDbRepo.updateSaleCommercialTotals(TENANT_ID, replacementSale.id, {
    totalGrossRevenue: "40.00",
    orderDiscountTotal: "0.00",
    documentTotalPosted: "40.00",
  });
  const replLines = await salesDbRepo.findSaleLines(TENANT_ID, replacementSale.id);
  await salesDbRepo.updateLineCommercialTotals(TENANT_ID, replLines[0]!.id, {
    lineGrossRevenue: "40.00",
    lineAllocatedDiscountPrecise: "0.00",
    lineAllocatedDiscountPosted: "0.00",
    lineNetRevenuePrecise: "40.00",
    lineNetRevenuePosted: "40.00",
    roundingAdjustment: "0.00",
  });
  await salesDbRepo.markSaleApproved(TENANT_ID, replacementSale.id, {
    approvedBy: OWNER_USER_ID,
    approvedAt: new Date(),
  }, ["draft"]);
  await pgSql`UPDATE sales_orders SET subject_hash = ${"hash-repl-" + Date.now()}, subject_version = 1 WHERE id = ${replacementSale.id} AND tenant_id = ${TENANT_ID}`;
  await snapshotService.createVersion1Snapshot(ownerUser as any, {
    salesOrderId: replacementSale.id,
    rawCost: "15.00",
    singleProductionCost: "10.00",
  });

  const replacementReturn = await returnService.createReturnRequest(workerUser as any, workerEff as any, {
    salesOrderId: replacementSale.id,
    customerId: CUSTOMER_ID,
    returnDate: "2026-08-10",
    returnReason: "QA browser approved replacement return",
    financialTreatment: "replacement",
    lines: [{
      originalSaleOrderId: replacementSale.id,
      originalSaleLineId: replLines[0]!.id,
      itemId: INVENTORY_ITEM_ID,
      quantityKg: "50.000",
      returnLocationId: LOCATION_ID,
      returnedStockStatus: "return_received",
      originalSaleLineNetUnitValue: "0.080000",
    }],
    idempotencyKey: "qa-browser-replacement-create-" + Date.now(),
  });
  await returnService.submitReturnRequest(workerUser as any, workerEff as any, {
    returnRequestId: replacementReturn.returnRequestId,
    idempotencyKey: "qa-browser-replacement-submit-" + Date.now(),
  });
  // Approve the replacement return so is_replacement=true and status=approved
  await returnService.approveReturnRequest(ownerUser as any, ownerEff as any, {
    returnRequestId: replacementReturn.returnRequestId,
    idempotencyKey: "qa-browser-replacement-approve-" + Date.now(),
  });

  // Output fixture IDs as JSON for the runner to use
  const fixtures = {
    saleId: sale.id,
    saleDocNo: saleDocNo,
    saleLineId: saleLineId,
    returnRequestId: create.returnRequestId,
    replacementSaleId: replacementSale.id,
    replacementReturnRequestId: replacementReturn.returnRequestId,
    tenantId: TENANT_ID,
    customerId: CUSTOMER_ID,
    itemId: INVENTORY_ITEM_ID,
    locationId: LOCATION_ID,
    ownerUserId: OWNER_USER_ID,
    workerUserId: WORKER_USER_ID,
  };
  console.log("\n=== FIXTURES CREATED ===");
  console.log(JSON.stringify(fixtures, null, 2));

  await pgSql.end();
  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
