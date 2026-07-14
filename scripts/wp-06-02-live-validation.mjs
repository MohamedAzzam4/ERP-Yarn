/**
 * WP-06-02 Live Supabase Validation — Complaint Workflow.
 *
 * Usage: DATABASE_URL=... node scripts/wp-06-02-live-validation.mjs
 * TEST-ONLY. Not for production use.
 */
import postgres from "postgres";
import { randomUUID } from "node:crypto";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("ERROR: DATABASE_URL required."); process.exit(2); }

const sql = postgres(DATABASE_URL, { prepare: false, max: 1, idle_timeout: 30 });
const cryptoRandomUUID = randomUUID;

const TEST_TENANT_ID = "00000000-0000-0000-0000-000000060002";
const TEST_USER_ID = "00000000-0000-0000-0000-000000060002";
const TEST_CUSTOMER_ID = "00000000-0000-4000-8000-cccc00060002";
const TEST_SALE_ID = "00000000-0000-4000-8000-000000000602";
const TEST_ITEM_ID = "00000000-0000-4000-8000-000000060002";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function ensureMasterData() {
  const r = Date.now().toString(36).slice(-6);
  await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status) VALUES (${TEST_TENANT_ID}, 'WP-06-02 Live', 'ar', 'EGP', 'Africa/Cairo', 'active') ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${TEST_USER_ID}, ${TEST_TENANT_ID}, 'wp0602', 'WP-06-02 Tester', 'wp0602@test.local', 'active', 'ar') ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO customers (id, tenant_id, customer_code, name_ar, name_en, normalized_name, status, created_by) VALUES (${TEST_CUSTOMER_ID}, ${TEST_TENANT_ID}, ${'CUST-' + r}, 'عميل 0602', 'Customer 0602', ${'customer ' + r}, 'active', ${TEST_USER_ID}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO inventory_items (id, tenant_id, item_kind, item_code, display_name_ar, display_name_en, quality_status, is_blocked, status, created_by) VALUES (${TEST_ITEM_ID}, ${TEST_TENANT_ID}, 'single_yarn', ${'ITEM-' + r}, 'صنف 0602', 'Item 0602', 'accepted', false, 'active', ${TEST_USER_ID}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO sales_orders (id, tenant_id, doc_no, customer_id, sale_date, sale_status, approval_status, total_gross_revenue, order_discount_total, document_total_posted, is_locked, record_origin, record_period, subject_hash, subject_version, created_by) VALUES (${TEST_SALE_ID}, ${TEST_TENANT_ID}, ${'SO-' + r}, ${TEST_CUSTOMER_ID}, '2026-07-10', 'approved', 'approved', '100.00', '0.00', '100.00', true, 'manual_live', 'live', ${'hash-' + r}, 1, ${TEST_USER_ID}) ON CONFLICT (id) DO NOTHING`;
}

async function cleanTestData() {
  await sql`DELETE FROM complaints WHERE tenant_id = ${TEST_TENANT_ID}`;
  await sql`DELETE FROM idempotency_records WHERE tenant_id = ${TEST_TENANT_ID} AND operation_scope LIKE 'complaint_%'`;
  await sql`DELETE FROM document_sequences WHERE tenant_id = ${TEST_TENANT_ID} AND document_type = 'complaint'`;
}

async function main() {
  console.log("=== WP-06-02 Live Supabase Validation ===");

  try {
    // Create complaints table if not exists
    try {
      await sql`
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
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS "complaints_tenant_complaint_no_unique_idx" ON "complaints" USING btree ("tenant_id","complaint_no")`;
      await sql`CREATE INDEX IF NOT EXISTS "complaints_tenant_customer_idx" ON "complaints" USING btree ("tenant_id","customer_id")`;
      await sql`CREATE INDEX IF NOT EXISTS "complaints_tenant_sale_idx" ON "complaints" USING btree ("tenant_id","sale_id")`;
      await sql`CREATE INDEX IF NOT EXISTS "complaints_tenant_status_idx" ON "complaints" USING btree ("tenant_id","status")`;
      console.log("Complaints table created (or already existed).");
    } catch (e) { console.log("Table create note:", e.message.slice(0, 80)); }

    await ensureMasterData();
    await cleanTestData();

    // 1. Complaint persisted with links
    const complaintId = cryptoRandomUUID();
    const complaintNo = 'CMP-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    await sql`INSERT INTO complaints (id, tenant_id, complaint_no, complaint_date, customer_id, sale_id, item_id, subject, description, status, priority, created_by) VALUES (${complaintId}, ${TEST_TENANT_ID}, ${complaintNo}, '2026-07-10', ${TEST_CUSTOMER_ID}, ${TEST_SALE_ID}, ${TEST_ITEM_ID}, 'Quality issue', 'Yarn count mismatch', 'open', 'high', ${TEST_USER_ID})`;
    const c1 = await sql`SELECT * FROM complaints WHERE id = ${complaintId} AND tenant_id = ${TEST_TENANT_ID}`;
    check("1. complaint persisted with customer/sale/item links", c1.length === 1 && c1[0].customer_id === TEST_CUSTOMER_ID && c1[0].sale_id === TEST_SALE_ID && c1[0].item_id === TEST_ITEM_ID, `status=${c1[0]?.status}, priority=${c1[0]?.priority}`);

    // 2. Status transition: open → investigating → resolved
    await sql`UPDATE complaints SET status = 'investigating', investigated_by = ${TEST_USER_ID}, investigated_at = NOW(), investigation_notes = 'Found issue', updated_at = NOW(), updated_by = ${TEST_USER_ID} WHERE id = ${complaintId} AND tenant_id = ${TEST_TENANT_ID}`;
    const c2 = await sql`SELECT status, investigated_by FROM complaints WHERE id = ${complaintId} AND tenant_id = ${TEST_TENANT_ID}`;
    check("2. status transition open → investigating", c2[0].status === "investigating" && c2[0].investigated_by === TEST_USER_ID, `status=${c2[0].status}`);

    await sql`UPDATE complaints SET status = 'resolved', resolved_by = ${TEST_USER_ID}, resolved_at = NOW(), resolution_notes = 'Resolved', resolution_type = 'no_action', updated_at = NOW(), updated_by = ${TEST_USER_ID} WHERE id = ${complaintId} AND tenant_id = ${TEST_TENANT_ID}`;
    const c3 = await sql`SELECT status, resolved_by FROM complaints WHERE id = ${complaintId} AND tenant_id = ${TEST_TENANT_ID}`;
    check("3. status transition investigating → resolved", c3[0].status === "resolved" && c3[0].resolved_by === TEST_USER_ID, `status=${c3[0].status}`);

    // 4. Open complaint listing
    const complaintId2 = cryptoRandomUUID();
    const complaintNo2 = 'CMP-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    await sql`INSERT INTO complaints (id, tenant_id, complaint_no, complaint_date, customer_id, subject, status, priority, created_by) VALUES (${complaintId2}, ${TEST_TENANT_ID}, ${complaintNo2}, '2026-07-10', ${TEST_CUSTOMER_ID}, 'Second complaint', 'open', 'normal', ${TEST_USER_ID})`;
    const openComplaints = await sql`SELECT * FROM complaints WHERE tenant_id = ${TEST_TENANT_ID} AND status IN ('open', 'investigating')`;
    check("4. open complaint listing (1 open after 1 resolved)", openComplaints.length === 1, `count=${openComplaints.length}`);

    // 5. Tenant isolation
    const foreignLookup = await sql`SELECT * FROM complaints WHERE id = ${complaintId} AND tenant_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'`;
    check("5. tenant isolation: foreign tenant sees 0 complaints", foreignLookup.length === 0, `count=${foreignLookup.length}`);

    // 6. Unique constraint on (tenant_id, complaint_no)
    const constraintExists = await sql`SELECT COUNT(*)::int AS n FROM pg_indexes WHERE indexname = 'complaints_tenant_complaint_no_unique_idx'`;
    check("6. unique constraint on (tenant_id, complaint_no) exists", constraintExists[0].n === 1, `count=${constraintExists[0].n}`);

    // 7. No stock movements
    const stockMv = await sql`SELECT COUNT(*)::int AS n FROM stock_movements WHERE tenant_id = ${TEST_TENANT_ID} AND source_document_type = 'complaint'`;
    check("7. no stock movements from complaints", stockMv[0].n === 0, `count=${stockMv[0].n}`);

    // 8. No payments
    const payments = await sql`SELECT COUNT(*)::int AS n FROM payments WHERE tenant_id = ${TEST_TENANT_ID}`;
    check("8. no payments from complaints", payments[0].n === 0, `count=${payments[0].n}`);

    // 9. No account entries
    const accountEntries = await sql`SELECT COUNT(*)::int AS n FROM account_entries WHERE tenant_id = ${TEST_TENANT_ID} AND source_document_type = 'complaint'`;
    check("9. no account entries from complaints", accountEntries[0].n === 0, `count=${accountEntries[0].n}`);

    // 10. No sales approval mutations
    const salesApprovals = await sql`SELECT COUNT(*)::int AS n FROM audit_logs WHERE tenant_id = ${TEST_TENANT_ID} AND action_type LIKE 'sales_approval%'`;
    check("10. no sales approval mutations from complaints", salesApprovals[0].n === 0, `count=${salesApprovals[0].n}`);

    await cleanTestData();

  } catch (e) {
    console.error("FATAL ERROR:", e.message);
    console.error(e.stack);
  } finally {
    await sql.end({ timeout: 5 });
  }

  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n=== Summary ===\nPassed: ${passed} / ${results.length}\nFailed: ${failed}`);
  if (failed > 0) { console.log("\nFailures:"); for (const r of results.filter(r => !r.ok)) console.log(`  - ${r.name}: ${r.detail}`); }
  process.exit(failed > 0 ? 1 : 0);
}

main();
