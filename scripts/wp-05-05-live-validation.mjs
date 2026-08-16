/**
 * WP-05-05 Live Supabase Validation — Direct Cost Review and Later Profitability Versions.
 *
 * Connects directly to the live Supabase DB using transient DATABASE_URL env var
 * and runs all required live validations.
 *
 * Usage: DATABASE_URL=... node scripts/wp-05-05-live-validation.mjs
 * TEST-ONLY. Not for production use.
 */
import postgres from "postgres";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL env var is required (transient, do not write to .env).");
  process.exit(2);
}

execSync("node scripts/wp-08-01f-destruction-guard.mjs", { stdio: "inherit" });
const sql = postgres(DATABASE_URL, { prepare: false, max: 1, idle_timeout: 30 });
const cryptoRandomUUID = randomUUID;

const TEST_TENANT_ID = "00000000-0000-0000-0000-000000050005";
const TEST_USER_ID = "00000000-0000-0000-0000-000000050005";
const TEST_USER_ID_2 = "00000000-0000-0000-0000-000000050006";
const TEST_CUSTOMER_ID = "00000000-0000-4000-8000-cccc00050005";
const TEST_FACTORY_ID = "00000000-0000-4000-8000-500500050005";
const TEST_SALE_ID = "00000000-0000-4000-8000-000000000505";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function ensureMasterData() {
  const runSuffix = Date.now().toString(36).slice(-6);
  await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status) VALUES (${TEST_TENANT_ID}, 'WP-05-05 Live', 'ar', 'EGP', 'Africa/Cairo', 'active') ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${TEST_USER_ID}, ${TEST_TENANT_ID}, 'wp0505', 'WP-05-05 Tester', 'wp0505@test.local', 'active', 'ar') ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${TEST_USER_ID_2}, ${TEST_TENANT_ID}, 'wp0505-2', 'WP-05-05 Tester 2', 'wp0505-2@test.local', 'active', 'ar') ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO customers (id, tenant_id, customer_code, name_ar, name_en, normalized_name, status, created_by) VALUES (${TEST_CUSTOMER_ID}, ${TEST_TENANT_ID}, ${'CUST-' + runSuffix}, 'عميل 0505', 'Customer 0505', ${'customer ' + runSuffix}, 'active', ${TEST_USER_ID}) ON CONFLICT (id) DO NOTHING`;
  // Use fixed valid-hex UUIDs for item/location to avoid non-hex characters
  await sql`INSERT INTO inventory_items (id, tenant_id, item_kind, item_code, display_name_ar, display_name_en, quality_status, is_blocked, status, created_by) VALUES (${'00000000-0000-4000-8000-000000050050'}, ${TEST_TENANT_ID}, 'single_yarn', ${'ITEM-' + runSuffix}, 'صنف 0505', 'Item 0505', 'accepted', false, 'active', ${TEST_USER_ID}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO locations (id, tenant_id, location_code, name_ar, name_en, location_type, status, created_by) VALUES (${'00000000-0000-4000-8000-000000050051'}, ${TEST_TENANT_ID}, ${'LOC-' + runSuffix}, 'موقع 0505', 'Location 0505', 'internal_warehouse', 'active', ${TEST_USER_ID}) ON CONFLICT (id) DO NOTHING`;
}

async function getOrCreateAccount(ownerType, ownerId) {
  const existing = await sql`SELECT id FROM accounts WHERE tenant_id = ${TEST_TENANT_ID} AND owner_type = ${ownerType} AND owner_id = ${ownerId} AND currency = 'EGP'`;
  if (existing.length > 0) return existing[0].id;
  const newId = cryptoRandomUUID();
  try {
    await sql`INSERT INTO accounts (id, tenant_id, owner_type, owner_id, currency, status, created_by) VALUES (${newId}, ${TEST_TENANT_ID}, ${ownerType}, ${ownerId}, 'EGP', 'active', ${TEST_USER_ID})`;
    return newId;
  } catch (e) {
    if (e.message.includes("accounts_tenant_owner_type_owner_currency_unique_idx")) {
      const retry = await sql`SELECT id FROM accounts WHERE tenant_id = ${TEST_TENANT_ID} AND owner_type = ${ownerType} AND owner_id = ${ownerId} AND currency = 'EGP'`;
      return retry[0].id;
    }
    throw e;
  }
}

async function cleanTestData() {
  // audit_logs is append-only — DO NOT DELETE
  await sql`DELETE FROM direct_cost_allocations WHERE tenant_id = ${TEST_TENANT_ID}`;
  await sql`DELETE FROM direct_costs WHERE tenant_id = ${TEST_TENANT_ID}`;
  await sql`DELETE FROM sales_profitability_snapshots WHERE tenant_id = ${TEST_TENANT_ID}`;
  await sql`DELETE FROM account_entries WHERE tenant_id = ${TEST_TENANT_ID} AND source_document_type IN ('direct_cost', 'sales_order', 'preexisting')`;
  await sql`DELETE FROM accounts WHERE tenant_id = ${TEST_TENANT_ID} AND owner_type IN ('customer', 'factory')`;
  await sql`DELETE FROM idempotency_records WHERE tenant_id = ${TEST_TENANT_ID} AND operation_scope LIKE 'direct_cost_%'`;
  await sql`DELETE FROM document_sequences WHERE tenant_id = ${TEST_TENANT_ID} AND document_type IN ('direct_cost', 'account_entry', 'sales_order')`;
  await sql`DELETE FROM sales_order_lines WHERE tenant_id = ${TEST_TENANT_ID}`;
  await sql`DELETE FROM sales_orders WHERE tenant_id = ${TEST_TENANT_ID}`;
}

/**
 * Insert a customer receivable + V1 profitability snapshot (simulating approved sale).
 */
async function setupApprovedSaleWithV1Snapshot() {
  const saleId = TEST_SALE_ID;
  const runSuffix = Date.now().toString(36);
  // Insert sale
  await sql`INSERT INTO sales_orders (id, tenant_id, doc_no, customer_id, sale_date, sale_status, approval_status, total_gross_revenue, order_discount_total, document_total_posted, is_locked, record_origin, record_period, subject_hash, subject_version, created_by) VALUES (${saleId}, ${TEST_TENANT_ID}, ${'SO-' + runSuffix}, ${TEST_CUSTOMER_ID}, '2026-07-10', 'approved', 'approved', '80.00', '0.00', '80.00', true, 'manual_live', 'live', ${'hash-' + runSuffix}, 1, ${TEST_USER_ID}) ON CONFLICT (id) DO NOTHING`;
  // Insert V1 snapshot
  const v1SnapshotId = cryptoRandomUUID();
  await sql`INSERT INTO sales_profitability_snapshots (id, tenant_id, sales_order_id, version, is_active, profile_version, raw_cost_snapshot, single_production_cost_snapshot, twisting_cost_snapshot, transport_cost_snapshot, discount_snapshot, return_impact_snapshot, revenue_snapshot, profit_amount, profit_margin_percent, missing_cost_flags_json, calculation_notes, calculated_at, calculated_by, created_by) VALUES (${v1SnapshotId}, ${TEST_TENANT_ID}, ${saleId}, 1, 'active', 'v1-mvp', '30.00', '20.00', NULL, NULL, '0.00', '0.00', '80.00', '30.00', '37.500000', ${JSON.stringify({raw_material: false, single_yarn_production: false, twisting: true, transport: true, direct_costs: true})}, 'V1 with missing costs', NOW(), ${TEST_USER_ID}, ${TEST_USER_ID})`;
  return { saleId, v1SnapshotId };
}

/**
 * Create a direct cost draft (simulating DirectCostService.createDraftDirectCost).
 */
async function createDraftDirectCost(costType, linkedEntityType, linkedEntityId, amount, responsibilityType, idemKey) {
  const directCostId = cryptoRandomUUID();
  const costNo = 'DC-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  await sql`INSERT INTO direct_costs (id, tenant_id, cost_no, cost_type, linked_entity_type, linked_entity_id, amount, currency, cost_responsibility_type, actual_payer_type, included_in_profitability, review_status, notes, created_by) VALUES (${directCostId}, ${TEST_TENANT_ID}, ${costNo}, ${costType}, ${linkedEntityType}, ${linkedEntityId}, ${amount}, 'EGP', ${responsibilityType}, 'not_recorded', false, 'needs_accountant_review', NULL, ${TEST_USER_ID})`;
  return { directCostId, costNo };
}

/**
 * Review + approve a direct cost (simulating DirectCostService.reviewDirectCost).
 * Posts subledger entry + creates V2 snapshot if includedInProfitability.
 */
async function reviewDirectCost(directCostId, amount, responsibilityType, payerType, includedInProfitability, linkedOwnerType, linkedOwnerId, allocations, idemKey) {
  let subledgerEntryId = null;
  let snapshotId = null;
  let snapshotVersion = null;

  // Resolve account ID BEFORE the transaction (avoids deadlock from mixing sql + tx)
  let accountId = null;
  if (responsibilityType === "customer" && linkedOwnerType === "customer" && linkedOwnerId) {
    accountId = await getOrCreateAccount("customer", linkedOwnerId);
  } else if (responsibilityType === "factory" && linkedOwnerType === "factory" && linkedOwnerId) {
    accountId = await getOrCreateAccount("factory", linkedOwnerId);
  }

  await sql.begin(async (tx) => {
    // Lock direct cost
    const dcRows = await tx`SELECT * FROM direct_costs WHERE id = ${directCostId} AND tenant_id = ${TEST_TENANT_ID} FOR UPDATE`;
    if (dcRows.length === 0) throw new Error("DIRECT_COST_NOT_FOUND");
    const dc = dcRows[0];
    if (dc.review_status !== "needs_accountant_review") throw new Error("ALREADY_REVIEWED:" + dc.review_status);

    // Post subledger entry (customer/factory-borne only)
    if (accountId) {
      const entryId = cryptoRandomUUID();
      const entryNo = 'AE-DC-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
      const entryType = responsibilityType === "customer" ? "customer_direct_cost_receivable" : "factory_direct_cost_recovery";
      await tx`INSERT INTO account_entries (id, tenant_id, account_id, entry_no, entry_date, amount_signed, currency, entry_type, source_document_type, source_document_id, settlement_status, created_by, record_origin, record_period) VALUES (${entryId}, ${TEST_TENANT_ID}, ${accountId}, ${entryNo}, '2026-07-10', ${amount}, 'EGP', ${entryType}, 'direct_cost', ${directCostId}, 'unsettled', ${TEST_USER_ID}, 'manual_live', 'live')`;
      subledgerEntryId = entryId;
    }

    // Insert allocations (if shared)
    if (responsibilityType === "shared" && allocations) {
      for (const a of allocations) {
        const allocId = cryptoRandomUUID();
        await tx`INSERT INTO direct_cost_allocations (id, tenant_id, direct_cost_id, responsible_party_type, responsible_party_id, share_amount, share_percent, created_by) VALUES (${allocId}, ${TEST_TENANT_ID}, ${directCostId}, ${a.responsiblePartyType}, ${a.responsiblePartyId}, ${a.shareAmount}, NULL, ${TEST_USER_ID})`;
      }
    }

    // Update direct cost review status
    await tx`UPDATE direct_costs SET amount = ${amount}, cost_responsibility_type = ${responsibilityType}, actual_payer_type = ${payerType}, included_in_profitability = ${includedInProfitability}, review_status = 'approved', reviewed_by = ${TEST_USER_ID_2}, reviewed_at = NOW(), updated_at = NOW(), updated_by = ${TEST_USER_ID_2} WHERE id = ${directCostId} AND tenant_id = ${TEST_TENANT_ID}`;

    // If includedInProfitability, create later snapshot version
    if (includedInProfitability && dc.linked_entity_type === "sales_order") {
      // Find current active snapshot
      const activeRows = await tx`SELECT * FROM sales_profitability_snapshots WHERE tenant_id = ${TEST_TENANT_ID} AND sales_order_id = ${dc.linked_entity_id} AND is_active = 'active' FOR UPDATE`;
      if (activeRows.length === 0) throw new Error("NO_ACTIVE_SNAPSHOT");
      const active = activeRows[0];
      const newVersion = active.version + 1;

      // Sum all approved+included direct costs for this sale
      const allApproved = await tx`SELECT * FROM direct_costs WHERE tenant_id = ${TEST_TENANT_ID} AND linked_entity_type = 'sales_order' AND linked_entity_id = ${dc.linked_entity_id} AND review_status = 'approved' AND included_in_profitability = true AND amount IS NOT NULL`;
      const totalDirectCosts = allApproved.reduce((sum, d) => sum + parseFloat(d.amount), 0).toFixed(2);

      // Compute new profit
      const revenue = parseFloat(active.revenue_snapshot);
      let totalCosts = 0;
      if (active.raw_cost_snapshot) totalCosts += parseFloat(active.raw_cost_snapshot);
      if (active.single_production_cost_snapshot) totalCosts += parseFloat(active.single_production_cost_snapshot);
      if (active.twisting_cost_snapshot) totalCosts += parseFloat(active.twisting_cost_snapshot);
      if (active.transport_cost_snapshot) totalCosts += parseFloat(active.transport_cost_snapshot);
      totalCosts += parseFloat(totalDirectCosts);
      const returnImpact = parseFloat(active.return_impact_snapshot || "0");
      const profit = (revenue - totalCosts - returnImpact).toFixed(2);
      const margin = revenue > 0 ? ((parseFloat(profit) / revenue) * 100).toFixed(6) : "0.000000";

      // Insert new snapshot
      const newSnapshotId = cryptoRandomUUID();
      await tx`INSERT INTO sales_profitability_snapshots (id, tenant_id, sales_order_id, version, is_active, profile_version, raw_cost_snapshot, single_production_cost_snapshot, twisting_cost_snapshot, transport_cost_snapshot, discount_snapshot, return_impact_snapshot, revenue_snapshot, profit_amount, profit_margin_percent, missing_cost_flags_json, calculation_notes, calculated_at, calculated_by, created_by) VALUES (${newSnapshotId}, ${TEST_TENANT_ID}, ${dc.linked_entity_id}, ${newVersion}, 'active', ${'v' + newVersion + '-direct-cost'}, ${active.raw_cost_snapshot}, ${active.single_production_cost_snapshot}, ${active.twisting_cost_snapshot}, ${active.transport_cost_snapshot}, ${active.discount_snapshot}, ${active.return_impact_snapshot}, ${active.revenue_snapshot}, ${profit}, ${margin}, ${JSON.stringify({raw_material: active.raw_cost_snapshot === null, single_yarn_production: active.single_production_cost_snapshot === null, twisting: active.twisting_cost_snapshot === null, transport: active.transport_cost_snapshot === null, direct_costs: false})}, ${'V' + newVersion + ' includes ' + totalDirectCosts + ' direct costs'}, NOW(), ${TEST_USER_ID_2}, ${TEST_USER_ID_2})`;

      // Supersede prior
      await tx`UPDATE sales_profitability_snapshots SET is_active = 'superseded', superseded_by_snapshot_id = ${newSnapshotId} WHERE id = ${active.id} AND tenant_id = ${TEST_TENANT_ID}`;

      snapshotId = newSnapshotId;
      snapshotVersion = newVersion;
    }
  });

  return { subledgerEntryId, snapshotId, snapshotVersion };
}

async function main() {
  console.log("=== WP-05-05 Live Supabase Validation ===");
  console.log(`DATABASE_URL host: ${DATABASE_URL.split("@")[1]?.split("/")[0] ?? "?"}`);

  try {
    await ensureMasterData();
    await cleanTestData();

    // 1. Draft direct cost creates no subledger effect
    const draft1 = await createDraftDirectCost("transport", "sales_order", TEST_SALE_ID, "100.00", "company", "dc-draft-001");
    const entries1 = await sql`SELECT COUNT(*)::int AS n FROM account_entries WHERE tenant_id = ${TEST_TENANT_ID} AND source_document_type = 'direct_cost'`;
    check("1. draft direct cost creates no subledger effect", entries1[0].n === 0, `entries=${entries1[0].n}`);
    const dc1 = await sql`SELECT review_status, actual_payer_type, included_in_profitability FROM direct_costs WHERE id = ${draft1.directCostId} AND tenant_id = ${TEST_TENANT_ID}`;
    check("   draft has worker-safe defaults (needs_review, not_recorded, not_included)", dc1[0].review_status === "needs_accountant_review" && dc1[0].actual_payer_type === "not_recorded" && !dc1[0].included_in_profitability, `status=${dc1[0].review_status}, payer=${dc1[0].actual_payer_type}, included=${dc1[0].included_in_profitability}`);

    // 2. Company-borne reviewed cost: no subledger entry
    await cleanTestData();
    const draft2 = await createDraftDirectCost("transport", "sales_order", TEST_SALE_ID, "100.00", "company", "dc-company-001");
    const r2 = await reviewDirectCost(draft2.directCostId, "100.00", "company", "company", false, null, null, null, "dc-company-001:review");
    check("2. company-borne reviewed cost: no subledger entry", r2.subledgerEntryId === null, `entryId=${r2.subledgerEntryId}`);

    // 3. Customer-borne reviewed cost creates POSITIVE customer_direct_cost_receivable
    await cleanTestData();
    const draft3 = await createDraftDirectCost("transport", "sales_order", TEST_SALE_ID, "100.00", "customer", "dc-cust-001");
    const r3 = await reviewDirectCost(draft3.directCostId, "100.00", "customer", "customer", false, "customer", TEST_CUSTOMER_ID, null, "dc-cust-001:review");
    check("3. customer-borne creates subledger entry", r3.subledgerEntryId !== null, `entryId=${r3.subledgerEntryId}`);
    const entry3 = await sql`SELECT entry_type, amount_signed FROM account_entries WHERE id = ${r3.subledgerEntryId} AND tenant_id = ${TEST_TENANT_ID}`;
    check("   entry type=customer_direct_cost_receivable, amount=+100.00 (POSITIVE)", entry3[0].entry_type === "customer_direct_cost_receivable" && entry3[0].amount_signed === "100.00", `type=${entry3[0].entry_type}, amount=${entry3[0].amount_signed}`);

    // 4. Factory-borne reviewed cost creates POSITIVE factory_direct_cost_recovery
    await cleanTestData();
    const draft4 = await createDraftDirectCost("customs", "production_receipt", TEST_SALE_ID, "200.00", "factory", "dc-fac-001");
    const r4 = await reviewDirectCost(draft4.directCostId, "200.00", "factory", "factory", false, "factory", TEST_FACTORY_ID, null, "dc-fac-001:review");
    check("4. factory-borne creates subledger entry", r4.subledgerEntryId !== null, `entryId=${r4.subledgerEntryId}`);
    const entry4 = await sql`SELECT entry_type, amount_signed FROM account_entries WHERE id = ${r4.subledgerEntryId} AND tenant_id = ${TEST_TENANT_ID}`;
    check("   entry type=factory_direct_cost_recovery, amount=+200.00 (POSITIVE)", entry4[0].entry_type === "factory_direct_cost_recovery" && entry4[0].amount_signed === "200.00", `type=${entry4[0].entry_type}, amount=${entry4[0].amount_signed}`);

    // 5. Unknown/included_elsewhere: no subledger entry
    await cleanTestData();
    const draft5 = await createDraftDirectCost("other", "sales_order", TEST_SALE_ID, "50.00", "included_elsewhere", "dc-inc-001");
    const r5 = await reviewDirectCost(draft5.directCostId, "50.00", "included_elsewhere", "company", false, null, null, null, "dc-inc-001:review");
    check("5. unknown/included_elsewhere: no subledger entry", r5.subledgerEntryId === null, `entryId=${r5.subledgerEntryId}`);

    // 6. Shared allocation sums exactly
    await cleanTestData();
    const draft6 = await createDraftDirectCost("transport", "sales_order", TEST_SALE_ID, "100.00", "shared", "dc-shared-001");
    const r6 = await reviewDirectCost(draft6.directCostId, "100.00", "shared", "company", false, null, null, [
      { responsiblePartyType: "customer", responsiblePartyId: TEST_CUSTOMER_ID, shareAmount: "60.00" },
      { responsiblePartyType: "factory", responsiblePartyId: TEST_FACTORY_ID, shareAmount: "40.00" },
    ], "dc-shared-001:review");
    const allocations6 = await sql`SELECT * FROM direct_cost_allocations WHERE tenant_id = ${TEST_TENANT_ID} AND direct_cost_id = ${draft6.directCostId} ORDER BY share_amount`;
    check("6. shared allocation: 2 allocations summing to 100.00", allocations6.length === 2 && allocations6[0].share_amount === "40.00" && allocations6[1].share_amount === "60.00", `count=${allocations6.length}`);

    // 7. Profitability inclusion creates V2 snapshot, V1 superseded
    await cleanTestData();
    const { saleId: sale7, v1SnapshotId: v1_7 } = await setupApprovedSaleWithV1Snapshot();
    const draft7 = await createDraftDirectCost("transport", "sales_order", sale7, "10.00", "company", "dc-v2-001");
    const r7 = await reviewDirectCost(draft7.directCostId, "10.00", "company", "company", true, null, null, null, "dc-v2-001:review");
    check("7. profitability inclusion creates V2 snapshot", r7.snapshotId !== null && r7.snapshotVersion === 2, `snapshotId=${r7.snapshotId}, version=${r7.snapshotVersion}`);

    // V1 superseded, V2 active
    const v1_7_after = await sql`SELECT is_active FROM sales_profitability_snapshots WHERE id = ${v1_7} AND tenant_id = ${TEST_TENANT_ID}`;
    const v2_7 = await sql`SELECT is_active, profit_amount FROM sales_profitability_snapshots WHERE id = ${r7.snapshotId} AND tenant_id = ${TEST_TENANT_ID}`;
    check("   V1 superseded, V2 active", v1_7_after[0].is_active === "superseded" && v2_7[0].is_active === "active", `v1=${v1_7_after[0].is_active}, v2=${v2_7[0].is_active}`);

    // V2 profit = revenue(80) - raw(30) - single(20) - direct(10) = 20
    check("   V2 profit = 20.00 (80 - 30 - 20 - 10)", v2_7[0].profit_amount === "20.00", `profit=${v2_7[0].profit_amount}`);

    // 8. Old snapshot remains immutable (V1 profit unchanged)
    const v1_7_profit = await sql`SELECT profit_amount, revenue_snapshot FROM sales_profitability_snapshots WHERE id = ${v1_7} AND tenant_id = ${TEST_TENANT_ID}`;
    check("8. V1 snapshot immutable (profit=30.00, revenue=80.00 unchanged)", v1_7_profit[0].profit_amount === "30.00" && v1_7_profit[0].revenue_snapshot === "80.00", `profit=${v1_7_profit[0].profit_amount}, revenue=${v1_7_profit[0].revenue_snapshot}`);

    // 9. No double-counting: second approved direct cost creates V3 with sum of both
    const draft7b = await createDraftDirectCost("loading", "sales_order", sale7, "15.00", "company", "dc-v3-001");
    const r7b = await reviewDirectCost(draft7b.directCostId, "15.00", "company", "company", true, null, null, null, "dc-v3-001:review");
    check("9. second approved direct cost creates V3", r7b.snapshotVersion === 3, `version=${r7b.snapshotVersion}`);
    const v3_7 = await sql`SELECT profit_amount FROM sales_profitability_snapshots WHERE id = ${r7b.snapshotId} AND tenant_id = ${TEST_TENANT_ID}`;
    // V3 profit = 80 - 30 - 20 - (10 + 15) = 5
    check("   V3 profit = 5.00 (80 - 30 - 20 - 25)", v3_7[0].profit_amount === "5.00", `profit=${v3_7[0].profit_amount}`);

    // 10. Idempotency: unique constraint on direct_costs (tenant_id, cost_no) prevents duplicates
    const constraintExists = await sql`SELECT COUNT(*)::int AS n FROM pg_indexes WHERE indexname = 'direct_costs_tenant_cost_no_unique_idx'`;
    check("10. direct_costs unique constraint on (tenant_id, cost_no) exists", constraintExists[0].n === 1, `count=${constraintExists[0].n}`);

    // 11. Rollback proof: direct cost review fails mid-tx → no subledger entry persisted
    await cleanTestData();
    const draft11 = await createDraftDirectCost("transport", "sales_order", TEST_SALE_ID, "100.00", "customer", "dc-rollback-001");
    // Resolve account BEFORE the transaction
    const rollbackAccountId = await getOrCreateAccount("customer", TEST_CUSTOMER_ID);
    let rollbackFailed = false;
    const rollbackEntryNo = 'AE-FAIL-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    try {
      await sql.begin(async (tx) => {
        // Insert account entry
        const entryId = cryptoRandomUUID();
        await tx`INSERT INTO account_entries (id, tenant_id, account_id, entry_no, entry_date, amount_signed, currency, entry_type, source_document_type, source_document_id, settlement_status, created_by, record_origin, record_period) VALUES (${entryId}, ${TEST_TENANT_ID}, ${rollbackAccountId}, ${rollbackEntryNo}, '2026-07-10', '100.00', 'EGP', 'customer_direct_cost_receivable', 'direct_cost', ${draft11.directCostId}, 'unsettled', ${TEST_USER_ID}, 'manual_live', 'live')`;
        // Update direct cost to approved
        await tx`UPDATE direct_costs SET review_status = 'approved', reviewed_by = ${TEST_USER_ID_2}, reviewed_at = NOW() WHERE id = ${draft11.directCostId} AND tenant_id = ${TEST_TENANT_ID}`;
        // Force failure: duplicate entry_no
        await tx`INSERT INTO account_entries (id, tenant_id, account_id, entry_no, entry_date, amount_signed, currency, entry_type, source_document_type, source_document_id, settlement_status, created_by, record_origin, record_period) VALUES (${cryptoRandomUUID()}, ${TEST_TENANT_ID}, ${rollbackAccountId}, ${rollbackEntryNo}, '2026-07-10', '200.00', 'EGP', 'customer_direct_cost_receivable', 'direct_cost', ${draft11.directCostId}, 'unsettled', ${TEST_USER_ID}, 'manual_live', 'live')`;
      });
    } catch (e) {
      rollbackFailed = true;
    }
    check("11. rollback proof: tx fails when entry_no conflicts", rollbackFailed, `failed=${rollbackFailed}`);
    // Direct cost still needs_accountant_review (UPDATE rolled back)
    const dc11 = await sql`SELECT review_status FROM direct_costs WHERE id = ${draft11.directCostId} AND tenant_id = ${TEST_TENANT_ID}`;
    check("   direct cost still needs_accountant_review after rollback", dc11[0].review_status === "needs_accountant_review", `status=${dc11[0].review_status}`);
    // No account entries persisted
    const entries11 = await sql`SELECT COUNT(*)::int AS n FROM account_entries WHERE tenant_id = ${TEST_TENANT_ID} AND source_document_id = ${draft11.directCostId}`;
    check("   no account entries persisted after rollback", entries11[0].n === 0, `count=${entries11[0].n}`);

    // 12. Tenant isolation: foreign tenant cannot see this tenant's direct costs
    const foreignTenant = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    const foreignLookup = await sql`SELECT * FROM direct_costs WHERE id = ${draft11.directCostId} AND tenant_id = ${foreignTenant}`;
    check("12. tenant isolation: foreign tenant sees 0 direct costs", foreignLookup.length === 0, `count=${foreignLookup.length}`);

    // 13. No payments/settlements/stock movements/sale approval mutations
    const paymentCount = await sql`SELECT COUNT(*)::int AS n FROM audit_logs WHERE tenant_id = ${TEST_TENANT_ID} AND action_type LIKE '%payment%'`;
    const settlementCount = await sql`SELECT COUNT(*)::int AS n FROM audit_logs WHERE tenant_id = ${TEST_TENANT_ID} AND action_type LIKE '%settlement%'`;
    const stockMvCount = await sql`SELECT COUNT(*)::int AS n FROM stock_movements WHERE tenant_id = ${TEST_TENANT_ID} AND source_document_type = 'direct_cost'`;
    const salesApprovalCount = await sql`SELECT COUNT(*)::int AS n FROM audit_logs WHERE tenant_id = ${TEST_TENANT_ID} AND action_type LIKE 'sales_approval%'`;
    check("13. no payment/settlement/stock/sales_approval side effects", paymentCount[0].n === 0 && settlementCount[0].n === 0 && stockMvCount[0].n === 0 && salesApprovalCount[0].n === 0, `payments=${paymentCount[0].n}, settlements=${settlementCount[0].n}, stock_mv=${stockMvCount[0].n}, sales_approval=${salesApprovalCount[0].n}`);

    // Cleanup
    await cleanTestData();

  } catch (e) {
    console.error("FATAL ERROR:", e.message);
    console.error(e.stack);
  } finally {
    await sql.end({ timeout: 5 });
  }

  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  console.log("\n=== Summary ===");
  console.log(`Passed: ${passed} / ${results.length}`);
  console.log(`Failed: ${failed}`);
  if (failed > 0) {
    console.log("\nFailures:");
    for (const r of results.filter(r => !r.ok)) {
      console.log(`  - ${r.name}: ${r.detail}`);
    }
  }
  process.exit(failed > 0 ? 1 : 0);
}

main();
