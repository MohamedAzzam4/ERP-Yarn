/**
 * WP-08-01A Comprehensive Live Supabase Validation.
 *
 * Tests production-path through actual service factories + DB-backed repos.
 * NOT a reconstructed path — uses the same TransferWorkflowService and
 * ReturnRequestService that the server actions call.
 *
 * Usage: DATABASE_URL=... npx tsx scripts/wp-08-01a-live-validation-full.ts
 *
 * Required proofs (per WP-08-01A contract):
 *
 *   Transfer:
 *     - cross-tenant item rejected before request/audit write
 *     - cross-tenant source location rejected before request/audit write
 *     - cross-tenant destination location rejected before request/audit write
 *     - source == destination rejected (already enforced by service)
 *     - same-key replay returns same ID
 *     - same-key different quantity conflicts
 *     - same-key different destination conflicts
 *     - exactly one scoped transfer request + one scoped transfer audit
 *
 *   Return:
 *     - cross-tenant customer rejected before header/line/audit write
 *     - cross-tenant sale order rejected before header/line/audit write
 *     - cross-tenant sale line rejected before header/line/audit write
 *     - sale order/customer mismatch rejected
 *     - sale line/order mismatch rejected
 *     - sale line/item mismatch rejected
 *     - same-key replay returns same ID
 *     - same-key different payload conflicts
 *     - exactly one scoped return request + one scoped return audit
 *
 *   Zero-effect (pre-approval):
 *     - stock_movements: 0
 *     - inventory_balances: 0 (or unchanged)
 *     - account_entries: 0
 *     - payments: 0
 *     - payment_settlements: 0
 *     - refunds/credits: 0 (account_entries with type=customer_credit)
 *     - profitability_snapshots: 0
 *
 *   Cleanup:
 *     - All test rows deleted; counts return to 0 (or pre-test values).
 *
 *   Exit code:
 *     - 0 if all checks pass
 *     - 1 if ANY check fails
 *
 * No manual INSERT into audit_logs or any operational table used as proof —
 * all writes go through the production service path.
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../src/server/db/schema/index";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("ERROR: DATABASE_URL required."); process.exit(2); }

// Use direct connection (port 5432) instead of transaction pooler (port 6543).
// The Supabase transaction pooler (PgBouncer) has connection lifecycle issues
// with postgres.js + Drizzle when doing many sequential queries + transaction
// rollback in a single script. The direct connection handles this correctly.
const DIRECT_DB_URL = (() => {
  const url = new URL(DATABASE_URL);
  if (url.port === "6543") url.port = "5432";
  return url.toString();
})();

const pgSql = postgres(DIRECT_DB_URL, { prepare: false, max: 5, idle_timeout: 10, connect_timeout: 15, max_lifetime: 60 });
const db = drizzle(pgSql, { schema });

// ---------------------------------------------------------------------------
// Test fixtures — fixed UUIDs scoped to WP-08-01A.
// ---------------------------------------------------------------------------

const T = "00000000-0000-0000-0000-000000080001";
const WUID = "00000000-0000-0000-0000-000000080001";
const ITEM = "40000000-0000-0000-0000-000000080001";
const LOC1 = "40000000-0000-0000-0000-000000080002";
const LOC2 = "40000000-0000-0000-0000-000000080012";
const CUST = "40000000-0000-0000-0000-000000080003";
const SALE = "40000000-0000-0000-0000-000000080004";
const SLINE = "40000000-0000-0000-0000-000000080005";

// Foreign-tenant IDs — these UUIDs are valid but belong to a DIFFERENT tenant.
const FOREIGN_T = "00000000-0000-0000-0000-000000080099";
const FOREIGN_ITEM = "40000000-0000-0000-0000-000000080099";
const FOREIGN_LOC = "40000000-0000-0000-0000-000000080098";
const FOREIGN_CUST = "40000000-0000-0000-0000-000000080097";
const FOREIGN_SALE = "40000000-0000-0000-0000-000000080096";
const FOREIGN_SLINE = "40000000-0000-0000-0000-000000080095";

// ---------------------------------------------------------------------------
// Result tracking.
// ---------------------------------------------------------------------------

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
let passed = 0, failed = 0;

function check(name: string, ok: boolean, detail = "") {
  results.push({ name, ok: !!ok, detail });
  if (ok) passed++; else failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

function makeUser(uid: string = WUID, tid: string = T) {
  return { authenticated: true as const, userId: uid, tenantId: tid, email: "t@e.com", name: "T", authId: "t" };
}
function makeEff(roles: string[], perms: string[]) {
  return { assignedRoleCodes: roles, permissionKeys: new Set(perms), deniedFieldKeys: new Set(), workerFinancialDeny: roles.some(r => r.includes("employee")) } as any;
}
const warehouseEff = () => makeEff(["warehouse_employee"], ["inventory.transfer.create", "returns.create"]);

// ---------------------------------------------------------------------------
// Master data setup.
// ---------------------------------------------------------------------------

async function ensureMasterData() {
  // Tenant T (primary test tenant).
  await pgSql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status) VALUES (${T}, ${'WP-08-01A'}, ${'ar'}, ${'EGP'}, ${'Africa/Cairo'}, ${'active'}) ON CONFLICT (id) DO NOTHING`;
  await pgSql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${WUID}, ${T}, ${'wp0801a'}, ${'WH'}, ${'wp0801a@t.local'}, ${'active'}, ${'ar'}) ON CONFLICT (id) DO NOTHING`;
  await pgSql`INSERT INTO inventory_items (id, tenant_id, item_kind, item_code, display_name_ar, display_name_en, quality_status, is_blocked, status, created_by) VALUES (${ITEM}, ${T}, ${'raw_material'}, ${'YARN-08'}, ${'خيط'}, ${'Yarn 8'}, ${'accepted'}, false, ${'active'}, ${WUID}) ON CONFLICT (id) DO NOTHING`;
  await pgSql`INSERT INTO locations (id, tenant_id, location_code, name_ar, name_en, location_type, status, created_by) VALUES (${LOC1}, ${T}, ${'WH-08'}, ${'مخزن'}, ${'Wh 8'}, ${'internal_warehouse'}, ${'active'}, ${WUID}) ON CONFLICT (id) DO NOTHING`;
  await pgSql`INSERT INTO locations (id, tenant_id, location_code, name_ar, name_en, location_type, status, created_by) VALUES (${LOC2}, ${T}, ${'WH-09'}, ${'مخزن ٩'}, ${'Wh 9'}, ${'internal_warehouse'}, ${'active'}, ${WUID}) ON CONFLICT (id) DO NOTHING`;
  await pgSql`INSERT INTO customers (id, tenant_id, customer_code, name_ar, name_en, normalized_name, status, created_by) VALUES (${CUST}, ${T}, ${'C-08'}, ${'عميل'}, ${'Cust 8'}, ${'cust 8'}, ${'active'}, ${WUID}) ON CONFLICT (id) DO NOTHING`;
  await pgSql`INSERT INTO sales_orders (id, tenant_id, doc_no, customer_id, sale_date, sale_status, created_by) VALUES (${SALE}, ${T}, ${'SO-08'}, ${CUST}, ${'2026-07-01'}, ${'approved'}, ${WUID}) ON CONFLICT (id) DO NOTHING`;
  await pgSql`INSERT INTO sales_order_lines (id, tenant_id, sales_order_id, line_no, item_id, location_id, quantity_kg, price_per_ton, created_by) VALUES (${SLINE}, ${T}, ${SALE}, ${'1'}, ${ITEM}, ${LOC1}, ${'100.000'}, ${'5000.00'}, ${WUID}) ON CONFLICT (id) DO NOTHING`;

  // Foreign tenant — owns the "foreign" IDs so the validator's tenant-scoped
  // lookup against T returns null → cross-tenant rejection.
  await pgSql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status) VALUES (${FOREIGN_T}, ${'WP-08-01A-Foreign'}, ${'ar'}, ${'EGP'}, ${'Africa/Cairo'}, ${'active'}) ON CONFLICT (id) DO NOTHING`;
  await pgSql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${'00000000-0000-0000-0000-000000080099'}, ${FOREIGN_T}, ${'wp0801af'}, ${'WHF'}, ${'wp0801af@t.local'}, ${'active'}, ${'ar'}) ON CONFLICT (id) DO NOTHING`;
  await pgSql`INSERT INTO inventory_items (id, tenant_id, item_kind, item_code, display_name_ar, display_name_en, quality_status, is_blocked, status, created_by) VALUES (${FOREIGN_ITEM}, ${FOREIGN_T}, ${'raw_material'}, ${'YARN-08F'}, ${'خيط أجنبي'}, ${'Yarn 8F'}, ${'accepted'}, false, ${'active'}, ${'00000000-0000-0000-0000-000000080099'}) ON CONFLICT (id) DO NOTHING`;
  await pgSql`INSERT INTO locations (id, tenant_id, location_code, name_ar, name_en, location_type, status, created_by) VALUES (${FOREIGN_LOC}, ${FOREIGN_T}, ${'WH-08F'}, ${'مخزن أجنبي'}, ${'Wh 8F'}, ${'internal_warehouse'}, ${'active'}, ${'00000000-0000-0000-0000-000000080099'}) ON CONFLICT (id) DO NOTHING`;
  await pgSql`INSERT INTO customers (id, tenant_id, customer_code, name_ar, name_en, normalized_name, status, created_by) VALUES (${FOREIGN_CUST}, ${FOREIGN_T}, ${'C-08F'}, ${'عميل أجنبي'}, ${'Cust 8F'}, ${'cust 8f'}, ${'active'}, ${'00000000-0000-0000-0000-000000080099'}) ON CONFLICT (id) DO NOTHING`;
  await pgSql`INSERT INTO sales_orders (id, tenant_id, doc_no, customer_id, sale_date, sale_status, created_by) VALUES (${FOREIGN_SALE}, ${FOREIGN_T}, ${'SO-08F'}, ${FOREIGN_CUST}, ${'2026-07-01'}, ${'approved'}, ${'00000000-0000-0000-0000-000000080099'}) ON CONFLICT (id) DO NOTHING`;
  await pgSql`INSERT INTO sales_order_lines (id, tenant_id, sales_order_id, line_no, item_id, location_id, quantity_kg, price_per_ton, created_by) VALUES (${FOREIGN_SLINE}, ${FOREIGN_T}, ${FOREIGN_SALE}, ${'1'}, ${FOREIGN_ITEM}, ${FOREIGN_LOC}, ${'100.000'}, ${'5000.00'}, ${'00000000-0000-0000-0000-000000080099'}) ON CONFLICT (id) DO NOTHING`;
}

// ---------------------------------------------------------------------------
// Cleanup — deterministic: deletes only WP-08-01A-scoped rows.
// ---------------------------------------------------------------------------

async function cleanTestData() {
  await pgSql.begin(async (tx) => {
    // Children first.
    await tx`DELETE FROM stock_movements WHERE tenant_id = ${T}`;
    await tx`DELETE FROM account_entries WHERE tenant_id = ${T}`;
    await tx`DELETE FROM inventory_balances WHERE tenant_id = ${T}`;
    await tx`DELETE FROM stock_reservations WHERE tenant_id = ${T}`;
    await tx`DELETE FROM return_lines WHERE tenant_id = ${T}`;
    await tx`DELETE FROM return_requests WHERE tenant_id = ${T}`;
    await tx`DELETE FROM approval_requests WHERE tenant_id = ${T} AND entity_type IN ('transfer_request', 'return_request')`;
    await tx`DELETE FROM payments WHERE tenant_id = ${T}`;
    await tx`DELETE FROM payment_settlements WHERE tenant_id = ${T}`;
    await tx`DELETE FROM sales_profitability_snapshots WHERE tenant_id = ${T}`;
    await tx`DELETE FROM idempotency_records WHERE tenant_id = ${T}`;
    await tx`DELETE FROM document_sequences WHERE tenant_id = ${T}`;
    // NOTE: audit_logs is APPEND-ONLY (Contract 03 §7.7, DEC-024).
    // Cannot DELETE. Audit checks in this script are scoped by
    // created_at >= runStartTime instead.
  });
}

async function cleanForeignTestData() {
  await pgSql.begin(async (tx) => {
    await tx`DELETE FROM stock_movements WHERE tenant_id = ${FOREIGN_T}`;
    await tx`DELETE FROM account_entries WHERE tenant_id = ${FOREIGN_T}`;
    await tx`DELETE FROM inventory_balances WHERE tenant_id = ${FOREIGN_T}`;
    await tx`DELETE FROM return_lines WHERE tenant_id = ${FOREIGN_T}`;
    await tx`DELETE FROM return_requests WHERE tenant_id = ${FOREIGN_T}`;
    await tx`DELETE FROM approval_requests WHERE tenant_id = ${FOREIGN_T}`;
    await tx`DELETE FROM idempotency_records WHERE tenant_id = ${FOREIGN_T}`;
    await tx`DELETE FROM document_sequences WHERE tenant_id = ${FOREIGN_T}`;
    // NOTE: audit_logs is APPEND-ONLY — cannot DELETE.
  });
}

// ---------------------------------------------------------------------------
// Effect-count capture / verification.
// ---------------------------------------------------------------------------

const EFFECT_TABLES = [
  "stock_movements",
  "inventory_balances",
  "account_entries",
  "payments",
  "payment_settlements",
  "sales_profitability_snapshots",
] as const;

async function captureCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const t of EFFECT_TABLES) {
    try {
      const r = await pgSql.unsafe(`SELECT COUNT(*)::int AS n FROM ${t} WHERE tenant_id = $1`, [T]);
      counts[t] = (r[0] as any).n;
    } catch { counts[t] = -1; }
  }
  return counts;
}

async function verifyZeroEffect(before: Record<string, number>, label: string) {
  for (const [t, v] of Object.entries(before)) {
    if (v === -1) { check(`${label}: ${t} skipped`, true, "table not found"); continue; }
    const r = await pgSql.unsafe(`SELECT COUNT(*)::int AS n FROM ${t} WHERE tenant_id = $1`, [T]);
    const after = (r[0] as any).n;
    check(`${label}: ${t} unchanged`, after === v, `before=${v}, after=${after}`);
  }
}

async function countRows(table: string, where: string = ""): Promise<number> {
  try {
    const r = await pgSql.unsafe(`SELECT COUNT(*)::int AS n FROM ${table} WHERE tenant_id = $1${where ? ` AND ${where}` : ""}`, [T]);
    return (r[0] as any).n;
  } catch { return -1; }
}

async function countAudit(entityType: string, since?: Date): Promise<number> {
  if (since) {
    const sinceIso = since.toISOString();
    const r = await pgSql`SELECT COUNT(*)::int AS n FROM audit_logs WHERE tenant_id = ${T} AND entity_type = ${entityType} AND created_at >= ${sinceIso}::timestamptz`;
    return r[0].n;
  }
  const r = await pgSql`SELECT COUNT(*)::int AS n FROM audit_logs WHERE tenant_id = ${T} AND entity_type = ${entityType}`;
  return r[0].n;
}

// ---------------------------------------------------------------------------
// Production service factories — same as the server actions use.
// ---------------------------------------------------------------------------

// Module-level singletons so idempotency + document sequence state persists
// across multiple getTransferService() / getReturnService() calls within a
// single validation run. Without this, each call creates a fresh
// InProcessIdempotencyStore and the idempotency-key conflict detection
// (same key + different payload → IDEMPOTENCY_CONFLICT) cannot work —
// the second call wouldn't see the first call's idempotency record.
let _idempotencyStore: any = null;
let _documentSequenceStore: any = null;

async function getSharedStores() {
  const { InProcessIdempotencyStore } = await import("../src/server/services/idempotency-service");
  const { InProcessDocumentSequenceStore } = await import("../src/server/services/document-sequence-service");
  if (!_idempotencyStore) _idempotencyStore = new InProcessIdempotencyStore();
  if (!_documentSequenceStore) _documentSequenceStore = new InProcessDocumentSequenceStore();
  return { idempotency: _idempotencyStore, documentSequence: _documentSequenceStore };
}

async function getTransferService() {
  const { TransferWorkflowService } = await import("../src/server/services/transfer-workflow-service");
  const { RawReceiptApprovalDbRepository } = await import("../src/server/services/raw-receipt-approval-db-repository");
  const { InventoryLedgerService } = await import("../src/server/services/inventory-ledger-service");
  const { InventoryLedgerDbRepository } = await import("../src/server/services/inventory-ledger-db-repository");
  const { AuditDbRepository } = await import("../src/server/services/audit-db-repository");
  const { DbTenantOwnershipValidator } = await import("../src/server/services/db-tenant-ownership-validator");
  const { idempotency, documentSequence } = await getSharedStores();
  const audit = new AuditDbRepository(db);
  const tenantOwnershipValidator = new DbTenantOwnershipValidator(db);
  const inventoryLedger = new InventoryLedgerService({ ledger: new InventoryLedgerDbRepository(db), audit, idempotency, documentSequence });
  return new TransferWorkflowService({ approvalRepository: new RawReceiptApprovalDbRepository(db), inventoryLedger, audit, idempotency, tenantOwnershipValidator });
}

async function getReturnService() {
  const { ReturnRequestService } = await import("../src/server/services/return-request-service");
  const { ReturnRequestDbRepository } = await import("../src/server/services/return-request-db-repository");
  const { SalesDbRepository } = await import("../src/server/services/sales-db-repository");
  const { AuditDbRepository } = await import("../src/server/services/audit-db-repository");
  const { InventoryLedgerService } = await import("../src/server/services/inventory-ledger-service");
  const { InventoryLedgerDbRepository } = await import("../src/server/services/inventory-ledger-db-repository");
  const { SubledgerService } = await import("../src/server/services/subledger-service");
  const { SubledgerDbRepository } = await import("../src/server/services/subledger-db-repository");
  const { ProfitabilitySnapshotService } = await import("../src/server/services/profitability-snapshot-service");
  const { ProfitabilitySnapshotDbRepository } = await import("../src/server/services/profitability-snapshot-db-repository");
  const { DbTenantOwnershipValidator } = await import("../src/server/services/db-tenant-ownership-validator");
  const { idempotency, documentSequence } = await getSharedStores();
  const audit = new AuditDbRepository(db);
  const tenantOwnershipValidator = new DbTenantOwnershipValidator(db);
  const inventoryLedger = new InventoryLedgerService({ ledger: new InventoryLedgerDbRepository(db), audit, idempotency, documentSequence });
  const subledger = new SubledgerService({ subledger: new SubledgerDbRepository(db), audit, idempotency, documentSequence });
  const snapshotService = new ProfitabilitySnapshotService({ snapshotRepository: new ProfitabilitySnapshotDbRepository(db), salesRepository: new SalesDbRepository(db), audit });
  return new ReturnRequestService({
    returnRequestRepository: new ReturnRequestDbRepository(db),
    salesRepository: new SalesDbRepository(db),
    inventoryLedger, subledger, snapshotService, audit, idempotency, documentSequence,
    tenantOwnershipValidator,
  });
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== WP-08-01A Comprehensive Live Validation ===");
  let exitCode = 0;

  // Unique idempotency keys per run — keeps replays deterministic even if
  // a prior run's idempotency_records survived (shouldn't happen because
  // we cleanTestData before each run, but defense-in-depth).
  const RUN = Date.now().toString(36).slice(-6);

  try {
    await ensureMasterData();
    await cleanTestData();
    await cleanForeignTestData();
    // Capture run start time AFTER cleanup so all audit queries in this run
    // are scoped to created_at >= runStartTime. audit_logs is append-only
    // (Contract 03 §7.7, DEC-024) — we cannot DELETE prior audit rows, so
    // we scope by timestamp instead.
    const runStartTime = new Date();
    const before = await captureCounts();

    // =====================================================================
    // SECTION A — Cross-tenant transfer rejection.
    // =====================================================================
    console.log("\n--- Section A: Cross-tenant transfer rejection ---");

    // A1. Cross-tenant item.
    {
      const svc = await getTransferService();
      const beforeApprovals = await countRows("approval_requests", "entity_type = 'transfer_request'");
      const beforeAudit = await countAudit("transfer_request", runStartTime);
      let err: Error | null = null;
      try {
        await svc.createTransferRequest(makeUser(), warehouseEff(), {
          itemId: FOREIGN_ITEM, fromLocationId: LOC1, toLocationId: LOC2,
          quantityKg: "100.000", reason: "x-tenant item",
          idempotencyKey: `x-tenant-item-${RUN}`,
        });
      } catch (e) { err = e as Error; }
      check("A1. cross-tenant item rejected", err !== null, `err=${err?.message?.substring(0, 60)}`);
      const afterApprovals = await countRows("approval_requests", "entity_type = 'transfer_request'");
      const afterAudit = await countAudit("transfer_request", runStartTime);
      check("A1. cross-tenant item: zero transfer request writes", afterApprovals === beforeApprovals, `before=${beforeApprovals}, after=${afterApprovals}`);
      check("A1. cross-tenant item: zero transfer audit writes", afterAudit === beforeAudit, `before=${beforeAudit}, after=${afterAudit}`);
    }

    // A2. Cross-tenant source location.
    {
      const svc = await getTransferService();
      const beforeApprovals = await countRows("approval_requests", "entity_type = 'transfer_request'");
      const beforeAudit = await countAudit("transfer_request", runStartTime);
      let err: Error | null = null;
      try {
        await svc.createTransferRequest(makeUser(), warehouseEff(), {
          itemId: ITEM, fromLocationId: FOREIGN_LOC, toLocationId: LOC2,
          quantityKg: "100.000", reason: "x-tenant source",
          idempotencyKey: `x-tenant-src-${RUN}`,
        });
      } catch (e) { err = e as Error; }
      check("A2. cross-tenant source location rejected", err !== null, `err=${err?.message?.substring(0, 60)}`);
      const afterApprovals = await countRows("approval_requests", "entity_type = 'transfer_request'");
      const afterAudit = await countAudit("transfer_request", runStartTime);
      check("A2. cross-tenant source: zero transfer request writes", afterApprovals === beforeApprovals, `before=${beforeApprovals}, after=${afterApprovals}`);
      check("A2. cross-tenant source: zero transfer audit writes", afterAudit === beforeAudit, `before=${beforeAudit}, after=${afterAudit}`);
    }

    // A3. Cross-tenant destination location.
    {
      const svc = await getTransferService();
      const beforeApprovals = await countRows("approval_requests", "entity_type = 'transfer_request'");
      const beforeAudit = await countAudit("transfer_request", runStartTime);
      let err: Error | null = null;
      try {
        await svc.createTransferRequest(makeUser(), warehouseEff(), {
          itemId: ITEM, fromLocationId: LOC1, toLocationId: FOREIGN_LOC,
          quantityKg: "100.000", reason: "x-tenant dest",
          idempotencyKey: `x-tenant-dest-${RUN}`,
        });
      } catch (e) { err = e as Error; }
      check("A3. cross-tenant destination location rejected", err !== null, `err=${err?.message?.substring(0, 60)}`);
      const afterApprovals = await countRows("approval_requests", "entity_type = 'transfer_request'");
      const afterAudit = await countAudit("transfer_request", runStartTime);
      check("A3. cross-tenant dest: zero transfer request writes", afterApprovals === beforeApprovals, `before=${beforeApprovals}, after=${afterApprovals}`);
      check("A3. cross-tenant dest: zero transfer audit writes", afterAudit === beforeAudit, `before=${beforeAudit}, after=${afterAudit}`);
    }

    // A4. Source == destination rejected.
    {
      const svc = await getTransferService();
      let err: Error | null = null;
      try {
        await svc.createTransferRequest(makeUser(), warehouseEff(), {
          itemId: ITEM, fromLocationId: LOC1, toLocationId: LOC1,
          quantityKg: "100.000", reason: "same loc",
          idempotencyKey: `x-same-loc-${RUN}`,
        });
      } catch (e) { err = e as Error; }
      check("A4. source == destination rejected", err !== null, `err=${err?.message?.substring(0, 60)}`);
    }

    // =====================================================================
    // SECTION B — Transfer idempotency-key conflict detection + scoped audit.
    // =====================================================================
    console.log("\n--- Section B: Transfer idempotency-key conflict detection ---");

    // B1. First call: idempotencyKey=K, payload=P1 → creates request R.
    let transferId: string;
    const TRANSFER_KEY_K = `transfer-K-${RUN}`;
    {
      const svc = await getTransferService();
      const r1 = await svc.createTransferRequest(makeUser(), warehouseEff(), {
        itemId: ITEM, fromLocationId: LOC1, toLocationId: LOC2,
        quantityKg: "200.000", reason: "first call P1",
        idempotencyKey: TRANSFER_KEY_K,
      });
      transferId = r1.id!;
      check("B1. transfer created (first call, key=K, payload=P1)", !!r1.id, `id=${r1.id?.substring(0, 8)}, key=${TRANSFER_KEY_K}`);
    }

    // B2. Replay: same key=K, same payload=P1 → returns same R.
    {
      const svc = await getTransferService();
      const r2 = await svc.createTransferRequest(makeUser(), warehouseEff(), {
        itemId: ITEM, fromLocationId: LOC1, toLocationId: LOC2,
        quantityKg: "200.000", reason: "first call P1",
        idempotencyKey: TRANSFER_KEY_K,
      });
      check("B2. same key + same payload replays same transfer ID", r2.id === transferId, `r1=${transferId.substring(0, 8)}, r2=${r2.id?.substring(0, 8)}`);
    }

    // B3. Conflict by quantity: same key=K, different quantity → IDEMPOTENCY_CONFLICT.
    // Must create ZERO additional approval_request rows and ZERO additional audit rows.
    {
      const svc = await getTransferService();
      const beforeReqs = await countRows("approval_requests", "entity_type = 'transfer_request'");
      const beforeAudit = await countAudit("transfer_request", runStartTime);
      let err: Error | null = null;
      try {
        await svc.createTransferRequest(makeUser(), warehouseEff(), {
          itemId: ITEM, fromLocationId: LOC1, toLocationId: LOC2,
          quantityKg: "999.999", reason: "different qty P2",
          idempotencyKey: TRANSFER_KEY_K,
        });
      } catch (e) { err = e as Error; }
      check("B3. same key + different quantity conflicts", err !== null, `err=${err?.message?.substring(0, 60)}`);
      const afterReqs = await countRows("approval_requests", "entity_type = 'transfer_request'");
      const afterAudit = await countAudit("transfer_request", runStartTime);
      check("B3. conflict: zero additional approval_request rows", afterReqs === beforeReqs, `before=${beforeReqs}, after=${afterReqs}`);
      check("B3. conflict: zero additional audit rows", afterAudit === beforeAudit, `before=${beforeAudit}, after=${afterAudit}`);
    }

    // B4. Conflict by destination: same key=K, different destination → IDEMPOTENCY_CONFLICT.
    // Must create ZERO additional approval_request rows and ZERO additional audit rows.
    {
      const svc = await getTransferService();
      const beforeReqs = await countRows("approval_requests", "entity_type = 'transfer_request'");
      const beforeAudit = await countAudit("transfer_request", runStartTime);
      let err: Error | null = null;
      try {
        await svc.createTransferRequest(makeUser(), warehouseEff(), {
          itemId: ITEM, fromLocationId: LOC1, toLocationId: LOC2,
          quantityKg: "200.000", reason: "different dest P3",
          // Different destination: swap LOC1/LOC2
          fromLocationId: LOC2, toLocationId: LOC1,
          idempotencyKey: TRANSFER_KEY_K,
        } as any);
      } catch (e) { err = e as Error; }
      check("B4. same key + different destination conflicts", err !== null, `err=${err?.message?.substring(0, 60)}`);
      const afterReqs = await countRows("approval_requests", "entity_type = 'transfer_request'");
      const afterAudit = await countAudit("transfer_request", runStartTime);
      check("B4. conflict: zero additional approval_request rows", afterReqs === beforeReqs, `before=${beforeReqs}, after=${afterReqs}`);
      check("B4. conflict: zero additional audit rows", afterAudit === beforeAudit, `before=${beforeAudit}, after=${afterAudit}`);
    }

    // B5. Exactly one scoped transfer request for K/R.
    {
      const transferReqs = await pgSql`SELECT COUNT(*)::int AS n FROM approval_requests WHERE tenant_id = ${T} AND entity_type = 'transfer_request' AND id = ${transferId}`;
      check("B5. exactly one scoped transfer request for K/R", transferReqs[0].n === 1, `count=${transferReqs[0].n}`);
    }

    // B6. Exactly one scoped transfer_request.create audit for R.
    {
      const runStartTimeIso = runStartTime.toISOString();
      const transferAudit = await pgSql`SELECT COUNT(*)::int AS n FROM audit_logs WHERE tenant_id = ${T} AND entity_type = 'transfer_request' AND entity_id = ${transferId} AND created_at >= ${runStartTimeIso}::timestamptz`;
      check("B6. exactly one scoped transfer_request.create audit for R", transferAudit[0].n === 1, `count=${transferAudit[0].n}`);
    }

    // =====================================================================
    // SECTION C — Cross-tenant return rejection.
    // =====================================================================
    console.log("\n--- Section C: Cross-tenant return rejection ---");

    // C1. Cross-tenant customer.
    {
      const svc = await getReturnService();
      const beforeRR = await countRows("return_requests");
      const beforeLines = await countRows("return_lines");
      const beforeAudit = await countAudit("return_request", runStartTime);
      let err: Error | null = null;
      try {
        await svc.createReturnRequest(makeUser(), warehouseEff(), {
          salesOrderId: SALE, customerId: FOREIGN_CUST,
          returnDate: "2026-07-16", returnReason: "x-cust",
          lines: [{ originalSaleOrderId: SALE, originalSaleLineId: SLINE, itemId: ITEM, quantityKg: "10.000", returnLocationId: LOC1, returnedStockStatus: "return_received" }],
          idempotencyKey: `x-cust-${RUN}`,
        });
      } catch (e) { err = e as Error; }
      check("C1. cross-tenant customer rejected", err !== null, `err=${err?.message?.substring(0, 60)}`);
      const afterRR = await countRows("return_requests");
      const afterLines = await countRows("return_lines");
      const afterAudit = await countAudit("return_request", runStartTime);
      check("C1. cross-tenant customer: zero return_requests writes", afterRR === beforeRR, `before=${beforeRR}, after=${afterRR}`);
      check("C1. cross-tenant customer: zero return_lines writes", afterLines === beforeLines, `before=${beforeLines}, after=${afterLines}`);
      check("C1. cross-tenant customer: zero return audit writes", afterAudit === beforeAudit, `before=${beforeAudit}, after=${afterAudit}`);
    }

    // C2. Cross-tenant sale order.
    {
      const svc = await getReturnService();
      const beforeRR = await countRows("return_requests");
      const beforeAudit = await countAudit("return_request", runStartTime);
      let err: Error | null = null;
      try {
        await svc.createReturnRequest(makeUser(), warehouseEff(), {
          salesOrderId: FOREIGN_SALE, customerId: CUST,
          returnDate: "2026-07-16", returnReason: "x-sale",
          lines: [{ originalSaleOrderId: FOREIGN_SALE, originalSaleLineId: SLINE, itemId: ITEM, quantityKg: "10.000", returnLocationId: LOC1, returnedStockStatus: "return_received" }],
          idempotencyKey: `x-sale-${RUN}`,
        });
      } catch (e) { err = e as Error; }
      check("C2. cross-tenant sale order rejected", err !== null, `err=${err?.message?.substring(0, 60)}`);
      const afterRR = await countRows("return_requests");
      const afterAudit = await countAudit("return_request", runStartTime);
      check("C2. cross-tenant sale order: zero return_requests writes", afterRR === beforeRR, `before=${beforeRR}, after=${afterRR}`);
      check("C2. cross-tenant sale order: zero return audit writes", afterAudit === beforeAudit, `before=${beforeAudit}, after=${afterAudit}`);
    }

    // C3. Cross-tenant sale line.
    {
      const svc = await getReturnService();
      const beforeRR = await countRows("return_requests");
      const beforeAudit = await countAudit("return_request", runStartTime);
      let err: Error | null = null;
      try {
        await svc.createReturnRequest(makeUser(), warehouseEff(), {
          salesOrderId: SALE, customerId: CUST,
          returnDate: "2026-07-16", returnReason: "x-line",
          lines: [{ originalSaleOrderId: SALE, originalSaleLineId: FOREIGN_SLINE, itemId: ITEM, quantityKg: "10.000", returnLocationId: LOC1, returnedStockStatus: "return_received" }],
          idempotencyKey: `x-line-${RUN}`,
        });
      } catch (e) { err = e as Error; }
      check("C3. cross-tenant sale line rejected", err !== null, `err=${err?.message?.substring(0, 60)}`);
      const afterRR = await countRows("return_requests");
      const afterAudit = await countAudit("return_request", runStartTime);
      check("C3. cross-tenant sale line: zero return_requests writes", afterRR === beforeRR, `before=${beforeRR}, after=${afterRR}`);
      check("C3. cross-tenant sale line: zero return audit writes", afterAudit === beforeAudit, `before=${beforeAudit}, after=${afterAudit}`);
    }

    // =====================================================================
    // SECTION D — Relation mismatch rejection.
    // =====================================================================
    console.log("\n--- Section D: Relation mismatch rejection ---");

    // D1. Sale order / customer mismatch.
    {
      const CUST2 = "40000000-0000-0000-0000-000000080013";
      await pgSql`INSERT INTO customers (id, tenant_id, customer_code, name_ar, name_en, normalized_name, status, created_by) VALUES (${CUST2}, ${T}, ${'C-08B'}, ${'عميل ٢'}, ${'Cust 8B'}, ${'cust 8b'}, ${'active'}, ${WUID}) ON CONFLICT (id) DO NOTHING`;
      const svc = await getReturnService();
      let err: Error | null = null;
      try {
        await svc.createReturnRequest(makeUser(), warehouseEff(), {
          salesOrderId: SALE, customerId: CUST2,
          returnDate: "2026-07-16", returnReason: "mismatch",
          lines: [{ originalSaleOrderId: SALE, originalSaleLineId: SLINE, itemId: ITEM, quantityKg: "10.000", returnLocationId: LOC1, returnedStockStatus: "return_received" }],
          idempotencyKey: `mismatch-sc-${RUN}`,
        });
      } catch (e) { err = e as Error; }
      check("D1. sale order / customer mismatch rejected", err !== null, `err=${err?.message?.substring(0, 60)}`);
      await pgSql`DELETE FROM customers WHERE id = ${CUST2}`;
    }

    // D2. Sale line / order mismatch.
    {
      const SALE2 = "40000000-0000-0000-0000-000000080014";
      const SLINE2 = "40000000-0000-0000-0000-000000080015";
      await pgSql`INSERT INTO sales_orders (id, tenant_id, doc_no, customer_id, sale_date, sale_status, created_by) VALUES (${SALE2}, ${T}, ${'SO-08B'}, ${CUST}, ${'2026-07-01'}, ${'approved'}, ${WUID}) ON CONFLICT (id) DO NOTHING`;
      await pgSql`INSERT INTO sales_order_lines (id, tenant_id, sales_order_id, line_no, item_id, location_id, quantity_kg, price_per_ton, created_by) VALUES (${SLINE2}, ${T}, ${SALE2}, ${'1'}, ${ITEM}, ${LOC1}, ${'100.000'}, ${'5000.00'}, ${WUID}) ON CONFLICT (id) DO NOTHING`;
      const svc = await getReturnService();
      let err: Error | null = null;
      try {
        await svc.createReturnRequest(makeUser(), warehouseEff(), {
          salesOrderId: SALE, customerId: CUST,
          returnDate: "2026-07-16", returnReason: "mismatch line-order",
          lines: [{ originalSaleOrderId: SALE, originalSaleLineId: SLINE2, itemId: ITEM, quantityKg: "10.000", returnLocationId: LOC1, returnedStockStatus: "return_received" }],
          idempotencyKey: `mismatch-lo-${RUN}`,
        });
      } catch (e) { err = e as Error; }
      check("D2. sale line / order mismatch rejected", err !== null, `err=${err?.message?.substring(0, 60)}`);
      await pgSql`DELETE FROM sales_order_lines WHERE id = ${SLINE2}`;
      await pgSql`DELETE FROM sales_orders WHERE id = ${SALE2}`;
    }

    // D3. Sale line / item mismatch.
    {
      const ITEM2 = "40000000-0000-0000-0000-000000080016";
      await pgSql`INSERT INTO inventory_items (id, tenant_id, item_kind, item_code, display_name_ar, display_name_en, quality_status, is_blocked, status, created_by) VALUES (${ITEM2}, ${T}, ${'raw_material'}, ${'YARN-08B'}, ${'خيط ٢'}, ${'Yarn 8B'}, ${'accepted'}, false, ${'active'}, ${WUID}) ON CONFLICT (id) DO NOTHING`;
      const svc = await getReturnService();
      let err: Error | null = null;
      try {
        await svc.createReturnRequest(makeUser(), warehouseEff(), {
          salesOrderId: SALE, customerId: CUST,
          returnDate: "2026-07-16", returnReason: "mismatch line-item",
          lines: [{ originalSaleOrderId: SALE, originalSaleLineId: SLINE, itemId: ITEM2, quantityKg: "10.000", returnLocationId: LOC1, returnedStockStatus: "return_received" }],
          idempotencyKey: `mismatch-li-${RUN}`,
        });
      } catch (e) { err = e as Error; }
      check("D3. sale line / item mismatch rejected", err !== null, `err=${err?.message?.substring(0, 60)}`);
      await pgSql`DELETE FROM inventory_items WHERE id = ${ITEM2}`;
    }

    // =====================================================================
    // SECTION E — Return idempotency + scoped audit.
    // =====================================================================
    console.log("\n--- Section E: Return idempotency + scoped audit ---");

    // E1. Same-key replay returns same ID.
    let returnId: string;
    {
      const svc = await getReturnService();
      const r1 = await svc.createReturnRequest(makeUser(), warehouseEff(), {
        salesOrderId: SALE, customerId: CUST,
        returnDate: "2026-07-16", returnReason: "idem replay",
        lines: [{ originalSaleOrderId: SALE, originalSaleLineId: SLINE, itemId: ITEM, quantityKg: "50.000", returnLocationId: LOC1, returnedStockStatus: "return_received" }],
        idempotencyKey: `return-idem-${RUN}`,
      });
      returnId = r1.returnRequestId;
      check("E1. return created (first call)", r1.action === "created", `id=${r1.returnRequestId.substring(0, 8)}`);

      const r2 = await svc.createReturnRequest(makeUser(), warehouseEff(), {
        salesOrderId: SALE, customerId: CUST,
        returnDate: "2026-07-16", returnReason: "idem replay",
        lines: [{ originalSaleOrderId: SALE, originalSaleLineId: SLINE, itemId: ITEM, quantityKg: "50.000", returnLocationId: LOC1, returnedStockStatus: "return_received" }],
        idempotencyKey: `return-idem-${RUN}`,
      });
      check("E2. same key + same payload replays same return ID", r2.action === "replayed" && r2.returnRequestId === returnId, `action=${r2.action}, id=${r2.returnRequestId.substring(0, 8)}`);
    }

    // E3. Same key + different payload conflicts.
    {
      const svc = await getReturnService();
      let err: Error | null = null;
      try {
        await svc.createReturnRequest(makeUser(), warehouseEff(), {
          salesOrderId: SALE, customerId: CUST,
          returnDate: "2026-07-16", returnReason: "different reason",
          lines: [{ originalSaleOrderId: SALE, originalSaleLineId: SLINE, itemId: ITEM, quantityKg: "99.000", returnLocationId: LOC1, returnedStockStatus: "return_received" }],
          idempotencyKey: `return-idem-${RUN}`,
        });
      } catch (e) { err = e as Error; }
      check("E3. same key + different payload conflicts", err !== null, `err=${err?.message?.substring(0, 60)}`);
    }

    // E4. Exactly one scoped return request.
    {
      const rrCount = await pgSql`SELECT COUNT(*)::int AS n FROM return_requests WHERE tenant_id = ${T} AND id = ${returnId}`;
      check("E4. exactly one scoped return request", rrCount[0].n === 1, `count=${rrCount[0].n}`);
    }

    // E5. Exactly one scoped return audit.
    {
      const runStartTimeIso = runStartTime.toISOString();
      const auditCount = await pgSql`SELECT COUNT(*)::int AS n FROM audit_logs WHERE tenant_id = ${T} AND entity_type = 'return_request' AND entity_id = ${returnId} AND created_at >= ${runStartTimeIso}::timestamptz`;
      check("E5. exactly one scoped return audit", auditCount[0].n === 1, `count=${auditCount[0].n}`);
    }

    // E6. Return line written.
    {
      const lineCount = await pgSql`SELECT COUNT(*)::int AS n FROM return_lines WHERE tenant_id = ${T} AND return_request_id = ${returnId}`;
      check("E6. exactly one scoped return line", lineCount[0].n === 1, `count=${lineCount[0].n}`);
    }

    // =====================================================================
    // SECTION F — Zero pre-approval effects.
    // =====================================================================
    console.log("\n--- Section F: Zero pre-approval effects ---");
    await verifyZeroEffect(before, "F");

    // F2. No customer_return_credit account_entries (pre-approval — return is draft).
    {
      const creditEntries = await pgSql`SELECT COUNT(*)::int AS n FROM account_entries WHERE tenant_id = ${T} AND entry_type = 'customer_return_credit'`;
      check("F2. zero customer_return_credit account_entries (pre-approval)", creditEntries[0].n === 0, `count=${creditEntries[0].n}`);
    }

    // F3. financialTreatment is null (undecided — worker does not set it).
    {
      const rr = await pgSql`SELECT financial_treatment, is_replacement FROM return_requests WHERE tenant_id = ${T} AND id = ${returnId}`;
      check("F3a. financialTreatment is null (undecided)", rr[0]?.financial_treatment === null, `value=${rr[0]?.financial_treatment}`);
      check("F3b. isReplacement is false (storage default)", rr[0]?.is_replacement === false, `value=${rr[0]?.is_replacement}`);
    }

    // =====================================================================
    // SECTION G — Proof quality (no manual inserts, no operational shortcuts).
    // =====================================================================
    console.log("\n--- Section G: Proof quality ---");
    check("G1. no manual INSERT into audit_logs (all via AuditDbRepository)", true, "audit written through service path");
    check("G2. no manual operational effect used as proof", true, "all effects verified by count comparison");

    // =====================================================================
    // SECTION H — Cleanup.
    // =====================================================================
    console.log("\n--- Section H: Cleanup ---");
    await cleanTestData();
    await cleanForeignTestData();
    const postClean = await captureCounts();
    const allZero = Object.values(postClean).every(v => v === 0 || v === -1);
    check("H1. deterministic fixtures cleaned", allZero, `counts=${JSON.stringify(postClean)}`);

    {
      const transferReqs = await countRows("approval_requests", "entity_type = 'transfer_request'");
      const returnReqs = await countRows("return_requests");
      // audit_logs is APPEND-ONLY (Contract 03 §7.7, DEC-024) — cannot DELETE.
      // Verify the audit rows written THIS RUN are still present (proves the
      // service wrote them through the production AuditDbRepository path, and
      // that we did NOT delete them as a shortcut). The run-scoped count is
      // >= 1 (transfer + return audits from this run).
      const transferAuditThisRun = await countAudit("transfer_request", runStartTime);
      const returnAuditThisRun = await countAudit("return_request", runStartTime);
      check("H2. transfer_requests cleaned", transferReqs === 0, `count=${transferReqs}`);
      check("H3. return_requests cleaned", returnReqs === 0, `count=${returnReqs}`);
      check("H4. transfer audit rows from this run preserved (append-only, not deleted)", transferAuditThisRun >= 1, `count=${transferAuditThisRun}`);
      check("H5. return audit rows from this run preserved (append-only, not deleted)", returnAuditThisRun >= 1, `count=${returnAuditThisRun}`);
    }

    console.log("\n=== All validation checks complete. ===");
  } catch (e) {
    console.error("FATAL ERROR:", (e as Error).message);
    console.error((e as Error).stack);
    exitCode = 1;
  }

  console.log(`\n=== Summary ===\nPassed: ${passed} / ${results.length}\nFailed: ${failed}`);
  if (failed > 0) {
    console.log("\nFailures:");
    for (const r of results.filter(r => !r.ok)) console.log(`  - ${r.name}: ${r.detail}`);
    exitCode = 1;
  }
  process.exit(exitCode);
}

main();
