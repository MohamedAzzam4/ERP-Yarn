/**
 * WP-08-01E — Browser QA Fixture Setup Script (v2 — full production lifecycle).
 *
 * Sets up the approveReturn fixture through the REAL production lifecycle:
 * 1. Post raw receipt (stock) via InventoryLedgerService.postRawReceipt.
 * 2. Create sale draft via SalesDraftService.createDraft.
 * 3. Complete commercial totals via SalesDraftService.completeCommercialTotals.
 * 4. Submit sale via SalesDraftService.submitSale (delegates to SalesSubmissionService).
 * 5. Approve sale via SalesApprovalService.approveSale (with requester/approver
 *    separation, subject-hash validation, reservation checks, tx-scoped audit,
 *    DB-backed idempotency, profitability snapshot creation).
 * 6. Verify active profitability snapshot exists through the real service path.
 * 7. Create return request via ReturnRequestService.createReturnRequest (requester=worker).
 * 8. Submit return request via ReturnRequestService.submitReturnRequest.
 *
 * This script does NOT call markSaleApproved directly. It does NOT use raw SQL
 * to patch sale status, reservation status, profitability snapshots, stock
 * movements, account entries, or subject hashes. All writes go through the
 * real production services.
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
import { StockReservationDbRepository } from "../../src/server/services/stock-reservation-db-repository";
import { ProfitabilitySnapshotDbRepository } from "../../src/server/services/profitability-snapshot-db-repository";
import { ProfitabilitySnapshotService } from "../../src/server/services/profitability-snapshot-service";
import { SalesSubmissionService } from "../../src/server/services/sales-submission-service";
import { SalesDraftService } from "../../src/server/services/sales-draft-service";
import { SalesApprovalService } from "../../src/server/services/sales-approval-service";
import { IdempotencyDbRepository } from "../../src/server/services/idempotency-db-repository";
import { DocumentSequenceDbRepository } from "../../src/server/services/document-sequence-db-repository";
import { inventoryItems } from "../../src/server/db/schema";
import { eq, and } from "drizzle-orm";

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
    "sales.create",
    "sales.view_price",
    "sales.submit",
    "sales.approve",
    "balances.view_customer",
    "balances.view_supplier_factory",
    "master_data.view",
    "master_data.view_names",
  ]),
  workerFinancialDeny: { enforced: false, deniedPermissionKeys: new Set(), deniedFieldKeys: new Set() },
};

const workerEff = {
  assignedRoleCodes: ["quality_employee"] as const,
  permissionKeys: new Set([
    "quality_tests.create",
    "complaints.investigate",
    "returns.create",
    "sales.create",
    "sales.submit",
  ]),
  workerFinancialDeny: { enforced: true, deniedPermissionKeys: new Set(), deniedFieldKeys: new Set() },
};

async function main() {
  console.log("=== WP-08-01E Browser QA Fixture Setup (Production Path v2) ===");

  // Clean up mutable fixtures from previous runs (FK-safe, inside a transaction)
  console.log("[setup] Cleaning up previous run's mutable fixtures...");
  await pgSql.begin(async (tx) => {
    await tx`DELETE FROM sales_profitability_snapshots WHERE tenant_id = ${TENANT_ID}`;
    await tx`DELETE FROM account_entries WHERE tenant_id = ${TENANT_ID}`;
    await tx`DELETE FROM stock_reservations WHERE tenant_id = ${TENANT_ID}`;
    await tx`DELETE FROM return_lines WHERE tenant_id = ${TENANT_ID}`;
    await tx`DELETE FROM return_requests WHERE tenant_id = ${TENANT_ID}`;
    await tx`DELETE FROM sales_order_lines WHERE tenant_id = ${TENANT_ID}`;
    await tx`DELETE FROM sales_orders WHERE tenant_id = ${TENANT_ID} AND (doc_no LIKE 'QA-SO-%' OR doc_no LIKE 'SO-2026-%')`;
    await tx`DELETE FROM inventory_balances WHERE tenant_id = ${TENANT_ID} AND item_id = ${INVENTORY_ITEM_ID}`;
    await tx`DELETE FROM stock_movements WHERE tenant_id = ${TENANT_ID} AND source_document_type IN ('return_line', 'return_request', 'test_seed', 'sales_order_line')`;
    await tx`DELETE FROM idempotency_records WHERE tenant_id = ${TENANT_ID}`;
    await tx`DELETE FROM document_sequences WHERE tenant_id = ${TENANT_ID} AND document_type IN ('return_request', 'return_receipt', 'account_entry', 'sales_order', 'stock_movement', 'stock_reservation')`;
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
  const reservationDbRepo = new StockReservationDbRepository(db);

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

  // txFactories for SalesSubmissionService
  const submissionTxFactories = {
    createSalesRepository: (tx: unknown) => new SalesDbRepository(tx as any),
    createReservationRepository: (tx: unknown) => new StockReservationDbRepository(tx as any),
    createInventoryLedger: (tx: unknown) => new InventoryLedgerService({
      ledger: new InventoryLedgerDbRepository(tx as any),
      audit: new AuditDbRepository(tx as any),
      idempotency: new IdempotencyDbRepository(tx as any),
      documentSequence: new DocumentSequenceDbRepository(tx as any),
    }),
    createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
    createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
    createDocumentSequence: (tx: unknown) => new DocumentSequenceDbRepository(tx as any),
  };

  // findItem function for DEC-065 eligibility check
  const findItem = async (tenantId: string, itemId: string) => {
    const rows = await db.select().from(inventoryItems).where(
      and(eq(inventoryItems.tenantId, tenantId), eq(inventoryItems.id, itemId))
    ).limit(1);
    return rows[0] ?? null;
  };

  const submissionService = new SalesSubmissionService({
    salesRepository: salesDbRepo,
    reservationRepository: reservationDbRepo,
    inventoryLedger,
    audit: auditDbRepo,
    idempotency: idempotencyDbRepo,
    documentSequence: docSeqDbRepo,
    transactionRunner,
    txFactories: submissionTxFactories,
    findItem,
  });

  const draftService = new SalesDraftService({
    salesRepository: salesDbRepo,
    audit: auditDbRepo,
    documentSequence: docSeqDbRepo,
    submissionService,
  });

  // txFactories for SalesApprovalService
  const approvalTxFactories = {
    createSalesRepository: (tx: unknown) => new SalesDbRepository(tx as any),
    createReservationRepository: (tx: unknown) => new StockReservationDbRepository(tx as any),
    createInventoryLedger: (tx: unknown) => new InventoryLedgerService({
      ledger: new InventoryLedgerDbRepository(tx as any),
      audit: new AuditDbRepository(tx as any),
      idempotency: new IdempotencyDbRepository(tx as any),
      documentSequence: new DocumentSequenceDbRepository(tx as any),
    }),
    createSubledger: (tx: unknown) => new SubledgerService({
      subledger: new SubledgerDbRepository(tx as any),
      audit: new AuditDbRepository(tx as any),
      idempotency: new IdempotencyDbRepository(tx as any),
      documentSequence: new DocumentSequenceDbRepository(tx as any),
    }),
    createSnapshotService: (tx: unknown) => new ProfitabilitySnapshotService({
      snapshotRepository: new ProfitabilitySnapshotDbRepository(tx as any),
      salesRepository: new SalesDbRepository(tx as any),
      audit: new AuditDbRepository(tx as any),
    }),
    createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
    createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
  };

  const approvalService = new SalesApprovalService({
    salesRepository: salesDbRepo,
    reservationRepository: reservationDbRepo,
    inventoryLedger,
    subledger,
    snapshotService,
    audit: auditDbRepo,
    idempotency: idempotencyDbRepo,
    documentSequence: docSeqDbRepo,
    transactionRunner,
    txFactories: approvalTxFactories,
  });

  // txFactories for ReturnRequestService
  const returnTxFactories = {
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
    txFactories: returnTxFactories,
  });

  // ===== Step 1: Post raw receipt (stock) =====
  console.log("[setup] Step 1: Post raw receipt (stock) via InventoryLedgerService...");
  await inventoryLedger.postRawReceipt(ownerUser as any, ownerEff as any, {
    itemId: INVENTORY_ITEM_ID,
    toLocationId: LOCATION_ID,
    quantityKg: "10000.000",
    movementDate: "2026-08-10",
    sourceDocumentType: "test_seed",
    sourceDocumentId: randomUUID(),
    idempotencyKey: "qa-browser-seed-stock-" + Date.now(),
  });

  // ===== Step 2: Create sale draft via SalesDraftService =====
  console.log("[setup] Step 2: Create sale draft via SalesDraftService.createDraft...");
  const saleDocNo = "QA-SO-" + Date.now().toString(36);
  const draftResult = await draftService.createDraft(workerUser as any, workerEff as any, {
    customerId: CUSTOMER_ID,
    saleDate: "2026-08-10",
    lines: [{
      itemId: INVENTORY_ITEM_ID,
      locationId: LOCATION_ID,
      quantityKg: "1000.000",
    }],
  });
  const saleId = draftResult.saleId;

  // ===== Step 3: Complete commercial totals via SalesDraftService =====
  console.log("[setup] Step 3: Complete commercial totals via SalesDraftService...");
  const saleLines = await salesDbRepo.findSaleLines(TENANT_ID, saleId);
  const saleLineId = saleLines[0]!.id;
  await draftService.completeCommercialTotals(ownerUser as any, ownerEff as any, {
    saleId,
    linePrices: [{
      lineId: saleLineId,
      pricePerTon: "80.00",
    }],
  });

  // ===== Step 4: Submit sale via SalesDraftService.submitSale =====
  console.log("[setup] Step 4: Submit sale via SalesDraftService.submitSale (→ SalesSubmissionService)...");
  await draftService.submitSale(workerUser as any, workerEff as any, {
    saleId,
    idempotencyKey: "qa-browser-sale-submit-" + Date.now(),
  });

  // ===== Step 5: Approve sale via SalesApprovalService.approveSale =====
  // DEC-080: requester (worker) cannot approve — approver must be owner
  console.log("[setup] Step 5: Approve sale via SalesApprovalService.approveSale (approver=owner)...");
  await approvalService.approveSale(ownerUser as any, ownerEff as any, {
    saleId,
    idempotencyKey: "qa-browser-sale-approve-" + Date.now(),
  });

  // ===== Step 6: Verify active profitability snapshot exists =====
  console.log("[setup] Step 6: Verify active profitability snapshot exists...");
  const activeSnapshot = await snapshotDbRepo.findActiveSnapshot(TENANT_ID, saleId);
  if (!activeSnapshot) {
    console.error("FATAL: No active profitability snapshot found after sale approval.");
    process.exit(1);
  }
  console.log(`[setup] Active snapshot verified: version=${activeSnapshot.version}, id=${activeSnapshot.id}`);

  // ===== Step 7: Create return request via ReturnRequestService (requester=worker) =====
  console.log("[setup] Step 7: Create return request via ReturnRequestService (requester=worker)...");
  const create = await returnService.createReturnRequest(workerUser as any, workerEff as any, {
    salesOrderId: saleId,
    customerId: CUSTOMER_ID,
    returnDate: "2026-08-10",
    returnReason: "QA browser fixture return",
    financialTreatment: "customer_credit",
    lines: [{
      originalSaleOrderId: saleId,
      originalSaleLineId: saleLineId,
      itemId: INVENTORY_ITEM_ID,
      quantityKg: "100.000",
      returnLocationId: LOCATION_ID,
      returnedStockStatus: "return_received",
      originalSaleLineNetUnitValue: "0.080000",
    }],
    idempotencyKey: "qa-browser-return-create-" + Date.now(),
  });

  // ===== Step 8: Submit return request (→ pending_approval) =====
  console.log("[setup] Step 8: Submit return request...");
  await returnService.submitReturnRequest(workerUser as any, workerEff as any, {
    returnRequestId: create.returnRequestId,
    idempotencyKey: "qa-browser-return-submit-" + Date.now(),
  });

  // ===== Step 9: Create approved replacement return for createReplacementOrderAction =====
  console.log("[setup] Step 9: Create approved replacement return (full lifecycle)...");
  const replDraft = await draftService.createDraft(workerUser as any, workerEff as any, {
    customerId: CUSTOMER_ID,
    saleDate: "2026-08-10",
    lines: [{
      itemId: INVENTORY_ITEM_ID,
      locationId: LOCATION_ID,
      quantityKg: "500.000",
    }],
  });
  const replLines = await salesDbRepo.findSaleLines(TENANT_ID, replDraft.saleId);
  await draftService.completeCommercialTotals(ownerUser as any, ownerEff as any, {
    saleId: replDraft.saleId,
    linePrices: [{ lineId: replLines[0]!.id, pricePerTon: "80.00" }],
  });
  await draftService.submitSale(workerUser as any, workerEff as any, {
    saleId: replDraft.saleId,
    idempotencyKey: "qa-browser-repl-sale-submit-" + Date.now(),
  });
  await approvalService.approveSale(ownerUser as any, ownerEff as any, {
    saleId: replDraft.saleId,
    idempotencyKey: "qa-browser-repl-sale-approve-" + Date.now(),
  });

  const replacementReturn = await returnService.createReturnRequest(workerUser as any, workerEff as any, {
    salesOrderId: replDraft.saleId,
    customerId: CUSTOMER_ID,
    returnDate: "2026-08-10",
    returnReason: "QA browser approved replacement return",
    financialTreatment: "replacement",
    lines: [{
      originalSaleOrderId: replDraft.saleId,
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
    saleId,
    saleDocNo,
    saleLineId,
    returnRequestId: create.returnRequestId,
    replacementSaleId: replDraft.saleId,
    replacementReturnRequestId: replacementReturn.returnRequestId,
    activeSnapshotId: activeSnapshot.id,
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
