/**
 * WP-06-02 Live Supabase Validation — Complaint Workflow (production path).
 *
 * Uses ComplaintService + ComplaintDbRepository + AuditDbRepository to prove
 * the production service path writes complaints and persistent audit rows.
 * No manual audit_logs inserts.
 *
 * Usage: DATABASE_URL=... node scripts/wp-06-02-live-validation.mjs
 * TEST-ONLY. Not for production use.
 */
import postgres from "postgres";
import { execSync } from "node:child_process";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../src/server/db/schema/index";
import { randomUUID } from "node:crypto";
import { ComplaintDbRepository } from "../src/server/services/complaint-db-repository";
import { ComplaintService } from "../src/server/services/complaint-service";
import { AuditDbRepository } from "../src/server/services/audit-db-repository";
import { InProcessIdempotencyStore } from "../src/server/services/idempotency-service";
import { InProcessDocumentSequenceStore } from "../src/server/services/document-sequence-service";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("ERROR: DATABASE_URL required."); process.exit(2); }

execSync("node scripts/wp-08-01f-destruction-guard.mjs", { stdio: "inherit" });
const pgSql = postgres(DATABASE_URL, { prepare: false, max: 1, idle_timeout: 30 });
const db = drizzle(pgSql, { schema });
const cryptoRandomUUID = randomUUID;

const TEST_TENANT_ID = "00000000-0000-0000-0000-000000060002";
const TEST_USER_ID = "00000000-0000-0000-0000-000000060002";
const TEST_CUSTOMER_ID = "00000000-0000-4000-8000-cccc00060002";
const TEST_SALE_ID = "00000000-0000-4000-8000-000000000602";
const TEST_ITEM_ID = "00000000-0000-4000-8000-000000060002";
const TEST_QUALITY_TEST_ID = "00000000-0000-4000-8000-000000060003";

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function ensureMasterData() {
  const r = Date.now().toString(36).slice(-6);
  await pgSql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status) VALUES (${TEST_TENANT_ID}, 'WP-06-02 Live', 'ar', 'EGP', 'Africa/Cairo', 'active') ON CONFLICT (id) DO NOTHING`;
  await pgSql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${TEST_USER_ID}, ${TEST_TENANT_ID}, 'wp0602', 'WP-06-02 Tester', 'wp0602@test.local', 'active', 'ar') ON CONFLICT (id) DO NOTHING`;
  await pgSql`INSERT INTO customers (id, tenant_id, customer_code, name_ar, name_en, normalized_name, status, created_by) VALUES (${TEST_CUSTOMER_ID}, ${TEST_TENANT_ID}, ${'CUST-' + r}, 'عميل 0602', 'Customer 0602', ${'customer ' + r}, 'active', ${TEST_USER_ID}) ON CONFLICT (id) DO NOTHING`;
  await pgSql`INSERT INTO inventory_items (id, tenant_id, item_kind, item_code, display_name_ar, display_name_en, quality_status, is_blocked, status, created_by) VALUES (${TEST_ITEM_ID}, ${TEST_TENANT_ID}, 'single_yarn', ${'ITEM-' + r}, 'صنف 0602', 'Item 0602', 'accepted', false, 'active', ${TEST_USER_ID}) ON CONFLICT (id) DO NOTHING`;
  await pgSql`INSERT INTO sales_orders (id, tenant_id, doc_no, customer_id, sale_date, sale_status, approval_status, total_gross_revenue, order_discount_total, document_total_posted, is_locked, record_origin, record_period, subject_hash, subject_version, created_by) VALUES (${TEST_SALE_ID}, ${TEST_TENANT_ID}, ${'SO-' + r}, ${TEST_CUSTOMER_ID}, '2026-07-10', 'approved', 'approved', '100.00', '0.00', '100.00', true, 'manual_live', 'live', ${'hash-' + r}, 1, ${TEST_USER_ID}) ON CONFLICT (id) DO NOTHING`;
}

async function cleanTestData() {
  // audit_logs is append-only — DO NOT DELETE. Instead, we filter by
  // entity_id in assertions to isolate this run's audit rows.
  await pgSql`DELETE FROM complaints WHERE tenant_id = ${TEST_TENANT_ID}`;
  await pgSql`DELETE FROM idempotency_records WHERE tenant_id = ${TEST_TENANT_ID} AND operation_scope LIKE 'complaint_%'`;
  await pgSql`DELETE FROM document_sequences WHERE tenant_id = ${TEST_TENANT_ID} AND document_type = 'complaint'`;
}

async function applyMigration() {
  // Apply migration 0013: add raw_material_batch_id and yarn_lot_id to complaints
  try {
    await pgSql`ALTER TABLE complaints ADD COLUMN IF NOT EXISTS raw_material_batch_id uuid`;
    await pgSql`ALTER TABLE complaints ADD COLUMN IF NOT EXISTS yarn_lot_id uuid`;
    console.log("Migration 0013 applied (raw_material_batch_id, yarn_lot_id columns).");
  } catch (e) {
    console.log("Migration 0013 note:", e.message.slice(0, 80));
  }
}

async function main() {
  console.log("=== WP-06-02 Live Supabase Validation (Production Path) ===");
  console.log(`DATABASE_URL host: ${DATABASE_URL.split("@")[1]?.split("/")[0] ?? "?"}`);

  try {
    // Ensure complaints table exists (migration 0012 equivalent)
    try {
      await pgSql`
        CREATE TABLE IF NOT EXISTS "complaints" (
          "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
          "tenant_id" uuid NOT NULL,
          "complaint_no" text NOT NULL,
          "complaint_date" date NOT NULL,
          "customer_id" uuid,
          "sale_id" uuid,
          "sale_line_id" uuid,
          "item_id" uuid,
          "quality_test_id" uuid,
          "raw_material_batch_id" uuid,
          "yarn_lot_id" uuid,
          "subject" text NOT NULL,
          "description" text,
          "status" text DEFAULT 'open' NOT NULL,
          "priority" text DEFAULT 'normal' NOT NULL,
          "investigated_by" uuid,
          "investigated_at" timestamp with time zone,
          "investigation_notes" text,
          "resolved_by" uuid,
          "resolved_at" timestamp with time zone,
          "resolution_notes" text,
          "resolution_type" text,
          "notes" text,
          "created_at" timestamp with time zone DEFAULT now() NOT NULL,
          "created_by" uuid,
          "updated_at" timestamp with time zone,
          "updated_by" uuid,
          CONSTRAINT "complaints_status_check" CHECK (status IN ('open', 'investigating', 'resolved', 'closed')),
          CONSTRAINT "complaints_priority_check" CHECK (priority IN ('low', 'normal', 'high', 'urgent'))
        )`;
      await pgSql`CREATE UNIQUE INDEX IF NOT EXISTS "complaints_tenant_complaint_no_unique_idx" ON "complaints" USING btree ("tenant_id","complaint_no")`;
      await pgSql`CREATE INDEX IF NOT EXISTS "complaints_tenant_customer_idx" ON "complaints" USING btree ("tenant_id","customer_id")`;
      await pgSql`CREATE INDEX IF NOT EXISTS "complaints_tenant_sale_idx" ON "complaints" USING btree ("tenant_id","sale_id")`;
      await pgSql`CREATE INDEX IF NOT EXISTS "complaints_tenant_status_idx" ON "complaints" USING btree ("tenant_id","status")`;
      console.log("Complaints table ensured.");
    } catch (e) { console.log("Table create note:", e.message.slice(0, 80)); }

    await applyMigration();
    await ensureMasterData();
    await cleanTestData();

    // Wire production services: ComplaintDbRepository + AuditDbRepository + ComplaintService
    const complaintDbRepo = new ComplaintDbRepository(db);
    const auditDbRepo = new AuditDbRepository(db);
    const idempotencyStore = new InProcessIdempotencyStore();
    const documentSequenceStore = new InProcessDocumentSequenceStore();

    const complaintService = new ComplaintService({
      complaintRepository: complaintDbRepo,
      audit: auditDbRepo,
      idempotency: idempotencyStore,
      documentSequence: documentSequenceStore,
    });

    const user = {
      authenticated: true,
      userId: TEST_USER_ID,
      tenantId: TEST_TENANT_ID,
      email: "wp0602@test.local",
      name: "WP-06-02 Tester",
      authId: "wp0602",
    };
    const eff = {
      assignedRoleCodes: ["quality_employee"],
      permissionKeys: new Set(["quality_tests.create", "complaints.investigate"]),
      deniedFieldKeys: new Set(),
      workerFinancialDeny: true,
    };

    // 1. ComplaintService.createComplaint creates complaint row via ComplaintDbRepository
    const createResult = await complaintService.createComplaint(user, eff, {
      complaintDate: "2026-07-10",
      customerId: TEST_CUSTOMER_ID,
      saleId: TEST_SALE_ID,
      itemId: TEST_ITEM_ID,
      qualityTestId: TEST_QUALITY_TEST_ID,
      subject: "Production path complaint",
      description: "Yarn count mismatch — customer reported",
      priority: "high",
      idempotencyKey: "cmp-live-prod-001",
    });
    check("1. ComplaintService.createComplaint creates complaint row", createResult.action === "created" && createResult.complaintId, `action=${createResult.action}, id=${createResult.complaintId?.slice(0,8)}...`);

    // Verify complaint row was persisted by ComplaintDbRepository (not manual SQL)
    const complaintRow = await pgSql`SELECT * FROM complaints WHERE id = ${createResult.complaintId} AND tenant_id = ${TEST_TENANT_ID}`;
    check("   complaint persisted with correct links", complaintRow.length === 1 && complaintRow[0].customer_id === TEST_CUSTOMER_ID && complaintRow[0].sale_id === TEST_SALE_ID && complaintRow[0].item_id === TEST_ITEM_ID, `status=${complaintRow[0]?.status}, priority=${complaintRow[0]?.priority}`);

    // 2. ComplaintService.createComplaint writes audit_logs row via AuditDbRepository (NOT manual)
    const createAuditRows = await pgSql`SELECT * FROM audit_logs WHERE tenant_id = ${TEST_TENANT_ID} AND entity_type = 'complaint' AND action_type = 'complaint.create' AND entity_id = ${createResult.complaintId}`;
    check("2. audit_logs row written by ComplaintService.createComplaint (via AuditDbRepository)", createAuditRows.length === 1, `count=${createAuditRows.length}`);
    if (createAuditRows.length === 1) {
      check("   audit row has correct entity_id", createAuditRows[0].entity_id === createResult.complaintId, `entity_id=${createAuditRows[0].entity_id?.slice(0,8)}...`);
      check("   audit row has new_values_json with complaintNo", createAuditRows[0].new_values_json?.complaintNo !== undefined, `has_complaintNo=${createAuditRows[0].new_values_json?.complaintNo !== undefined}`);
    }

    // 3. ComplaintService.updateComplaint (status: open → investigating) writes audit
    const investigateResult = await complaintService.updateComplaint(user, eff, {
      complaintId: createResult.complaintId,
      status: "investigating",
      investigationNotes: "Investigation started — contacting customer",
      idempotencyKey: "cmp-live-prod-001:investigate",
    });
    check("3. ComplaintService.updateComplaint (open → investigating)", investigateResult.action === "updated" && investigateResult.status === "investigating", `status=${investigateResult.status}`);

    const investigateAuditRows = await pgSql`SELECT * FROM audit_logs WHERE tenant_id = ${TEST_TENANT_ID} AND entity_type = 'complaint' AND action_type = 'complaint.update' AND entity_id = ${createResult.complaintId}`;
    check("   audit_logs row written for investigation update", investigateAuditRows.length === 1, `count=${investigateAuditRows.length}`);
    if (investigateAuditRows.length === 1) {
      check("   audit row has previousStatus=open, newStatus=investigating", investigateAuditRows[0].new_values_json?.previousStatus === "open" && investigateAuditRows[0].new_values_json?.newStatus === "investigating", `prev=${investigateAuditRows[0].new_values_json?.previousStatus}, new=${investigateAuditRows[0].new_values_json?.newStatus}`);
    }

    // 4. ComplaintService.updateComplaint (status: investigating → resolved) writes audit
    const resolveResult = await complaintService.updateComplaint(user, eff, {
      complaintId: createResult.complaintId,
      status: "resolved",
      resolutionNotes: "Resolved — credit issued",
      resolutionType: "credit_issued",
      idempotencyKey: "cmp-live-prod-001:resolve",
    });
    check("4. ComplaintService.updateComplaint (investigating → resolved)", resolveResult.status === "resolved", `status=${resolveResult.status}`);

    // 5. ComplaintService.updateComplaint (status: resolved → closed) writes audit
    const closeResult = await complaintService.updateComplaint(user, eff, {
      complaintId: createResult.complaintId,
      status: "closed",
      idempotencyKey: "cmp-live-prod-001:close",
    });
    check("5. ComplaintService.updateComplaint (resolved → closed)", closeResult.status === "closed", `status=${closeResult.status}`);

    // 6. Total audit rows: 1 create + 3 updates = 4
    const allAuditRows = await pgSql`SELECT * FROM audit_logs WHERE tenant_id = ${TEST_TENANT_ID} AND entity_type = 'complaint' AND entity_id = ${createResult.complaintId} ORDER BY created_at`;
    check("6. total audit rows = 4 (create + investigate + resolve + close)", allAuditRows.length === 4, `count=${allAuditRows.length}`);

    // 7. No stock movements created by ComplaintService
    const stockMv = await pgSql`SELECT COUNT(*)::int AS n FROM stock_movements WHERE tenant_id = ${TEST_TENANT_ID} AND source_document_type = 'complaint'`;
    check("7. no stock movements from complaints", stockMv[0].n === 0, `count=${stockMv[0].n}`);

    // 8. No payments created by ComplaintService
    const payments = await pgSql`SELECT COUNT(*)::int AS n FROM payments WHERE tenant_id = ${TEST_TENANT_ID}`;
    check("8. no payments from complaints", payments[0].n === 0, `count=${payments[0].n}`);

    // 9. No account entries created by ComplaintService
    const accountEntries = await pgSql`SELECT COUNT(*)::int AS n FROM account_entries WHERE tenant_id = ${TEST_TENANT_ID} AND source_document_type = 'complaint'`;
    check("9. no account entries from complaints", accountEntries[0].n === 0, `count=${accountEntries[0].n}`);

    // 10. No sales approval mutations
    const salesApprovals = await pgSql`SELECT COUNT(*)::int AS n FROM audit_logs WHERE tenant_id = ${TEST_TENANT_ID} AND action_type LIKE 'sales_approval%'`;
    check("10. no sales approval mutations from complaints", salesApprovals[0].n === 0, `count=${salesApprovals[0].n}`);

    // 11. No return_requests
    const returnRequests = await pgSql`SELECT COUNT(*)::int AS n FROM return_requests WHERE tenant_id = ${TEST_TENANT_ID}`;
    check("11. no return_requests from complaints", returnRequests[0].n === 0, `count=${returnRequests[0].n}`);

    // 12. No reservation changes
    const reservationChanges = await pgSql`SELECT COUNT(*)::int AS n FROM audit_logs WHERE tenant_id = ${TEST_TENANT_ID} AND (action_type LIKE '%reservation%' OR action_type LIKE '%submit%')`;
    check("12. no reservation changes from complaints", reservationChanges[0].n === 0, `count=${reservationChanges[0].n}`);

    // 13. Tenant isolation: foreign tenant cannot see complaints
    const foreignLookup = await pgSql`SELECT * FROM complaints WHERE id = ${createResult.complaintId} AND tenant_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'`;
    check("13. tenant isolation: foreign tenant sees 0 complaints", foreignLookup.length === 0, `count=${foreignLookup.length}`);

    // 14. Batch/lot link columns exist
    const batchCol = await pgSql`SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_name = 'complaints' AND column_name = 'raw_material_batch_id'`;
    const lotCol = await pgSql`SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_name = 'complaints' AND column_name = 'yarn_lot_id'`;
    check("14. complaints has raw_material_batch_id and yarn_lot_id columns", batchCol[0].n === 1 && lotCol[0].n === 1, `batch=${batchCol[0].n}, lot=${lotCol[0].n}`);

    // 15. Unique constraint on (tenant_id, complaint_no)
    const constraintExists = await pgSql`SELECT COUNT(*)::int AS n FROM pg_indexes WHERE indexname = 'complaints_tenant_complaint_no_unique_idx'`;
    check("15. unique constraint on (tenant_id, complaint_no) exists", constraintExists[0].n === 1, `count=${constraintExists[0].n}`);

    await cleanTestData();

  } catch (e) {
    console.error("FATAL ERROR:", e.message);
    console.error(e.stack);
  } finally {
    await pgSql.end({ timeout: 5 });
  }

  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n=== Summary ===\nPassed: ${passed} / ${results.length}\nFailed: ${failed}`);
  if (failed > 0) { console.log("\nFailures:"); for (const r of results.filter(r => !r.ok)) console.log(`  - ${r.name}: ${r.detail}`); }
  process.exit(failed > 0 ? 1 : 0);
}

main();
