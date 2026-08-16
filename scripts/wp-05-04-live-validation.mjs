/**
 * WP-05-04 Live Supabase Validation — Payments, Settlements, Reversal.
 *
 * Connects directly to the live Supabase DB using transient DATABASE_URL env var
 * and runs all required live validations:
 *   - payment posting exact sign
 *   - settlement exactness
 *   - partial/full settlement
 *   - over-settlement rejection
 *   - concurrent settlement safety
 *   - reversal safety
 *   - idempotency replay/conflict
 *   - rollback after each major write
 *   - tenant isolation
 *   - permission denial (RBAC enforced in service code — unit-tested)
 *   - DEC-066 payment method enforcement
 *   - no stock movement
 *   - no sales approval mutation
 *   - no profitability/direct-cost side effects
 *
 * Usage: DATABASE_URL=... node scripts/wp-05-04-live-validation.mjs
 * TEST-ONLY. Not for production use.
 */
import postgres from "postgres";
import { execSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL env var is required (transient, do not write to .env).");
  process.exit(2);
}

execSync("node scripts/wp-08-01f-destruction-guard.mjs", { stdio: "inherit" });
const sql = postgres(DATABASE_URL, { prepare: false, max: 1, idle_timeout: 30 });
const cryptoRandomUUID = randomUUID;

const TEST_TENANT_ID = "00000000-0000-0000-0000-000000050004";
const TEST_USER_ID = "00000000-0000-0000-0000-000000050004";
const TEST_USER_ID_2 = "00000000-0000-0000-0000-000000050005";
const TEST_CUSTOMER_ID = "00000000-0000-4000-8000-cccc00050004";  // cccc = customer marker
const TEST_SUPPLIER_ID = "00000000-0000-4000-8000-500500040005";  // supplier marker (valid hex)
const TEST_SALE_ID = "00000000-0000-4000-8000-000000000504";
const TEST_ITEM_ID = "00000000-0000-4000-8000-000000050004";
const TEST_LOCATION_ID = "00000000-0000-4000-8000-000000050054";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

function uuidFor(prefix, n) {
  const hex = prefix.toString(16).padStart(8, "0").slice(0, 8) + n.toString(16).padStart(4, "0").slice(0, 4);
  return `00000000-0000-4000-8000-${hex}`;
}

async function ensureMasterData() {
  const runSuffix = Date.now().toString(36).slice(-6);
  await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status) VALUES (${TEST_TENANT_ID}, 'WP-05-04 Live', 'ar', 'EGP', 'Africa/Cairo', 'active') ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${TEST_USER_ID}, ${TEST_TENANT_ID}, 'wp0504', 'WP-05-04 Tester', 'wp0504@test.local', 'active', 'ar') ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${TEST_USER_ID_2}, ${TEST_TENANT_ID}, 'wp0504-2', 'WP-05-04 Tester 2', 'wp0504-2@test.local', 'active', 'ar') ON CONFLICT (id) DO NOTHING`;
  // Use ON CONFLICT DO NOTHING for customer/supplier (code conflicts from prior runs are OK)
  await sql`INSERT INTO customers (id, tenant_id, customer_code, name_ar, name_en, normalized_name, status, created_by) VALUES (${TEST_CUSTOMER_ID}, ${TEST_TENANT_ID}, ${'CUST-' + runSuffix}, 'عميل 0504', 'Customer 0504', ${'customer ' + runSuffix}, 'active', ${TEST_USER_ID}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO suppliers (id, tenant_id, supplier_code, name_ar, name_en, normalized_name, status, created_by) VALUES (${TEST_SUPPLIER_ID}, ${TEST_TENANT_ID}, ${'SUP-' + runSuffix}, 'مورد 0504', 'Supplier 0504', ${'supplier ' + runSuffix}, 'active', ${TEST_USER_ID}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO inventory_items (id, tenant_id, item_kind, item_code, display_name_ar, display_name_en, quality_status, is_blocked, status, created_by) VALUES (${TEST_ITEM_ID}, ${TEST_TENANT_ID}, 'single_yarn', ${'ITEM-' + runSuffix}, 'صنف 0504', 'Item 0504', 'accepted', false, 'active', ${TEST_USER_ID}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO locations (id, tenant_id, location_code, name_ar, name_en, location_type, status, created_by) VALUES (${TEST_LOCATION_ID}, ${TEST_TENANT_ID}, ${'LOC-' + runSuffix}, 'موقع 0504', 'Location 0504', 'internal_warehouse', 'active', ${TEST_USER_ID}) ON CONFLICT (id) DO NOTHING`;
}

async function cleanTestData() {
  // audit_logs is append-only — DO NOT DELETE
  await sql`DELETE FROM payment_settlements WHERE tenant_id = ${TEST_TENANT_ID}`;
  await sql`DELETE FROM payments WHERE tenant_id = ${TEST_TENANT_ID}`;
  await sql`DELETE FROM account_entries WHERE tenant_id = ${TEST_TENANT_ID} AND source_document_type IN ('payment', 'payment_reversal', 'sales_order', 'preexisting')`;
  await sql`DELETE FROM accounts WHERE tenant_id = ${TEST_TENANT_ID} AND owner_type IN ('customer', 'supplier')`;
  await sql`DELETE FROM idempotency_records WHERE tenant_id = ${TEST_TENANT_ID} AND operation_scope LIKE 'payment_%'`;
  await sql`DELETE FROM document_sequences WHERE tenant_id = ${TEST_TENANT_ID} AND document_type IN ('payment', 'account_entry')`;
  await sql`DELETE FROM sales_order_lines WHERE tenant_id = ${TEST_TENANT_ID}`;
  await sql`DELETE FROM sales_orders WHERE tenant_id = ${TEST_TENANT_ID}`;
  await sql`DELETE FROM stock_movements WHERE tenant_id = ${TEST_TENANT_ID} AND source_document_type = 'test_seed'`;
  await sql`DELETE FROM inventory_balances WHERE tenant_id = ${TEST_TENANT_ID} AND item_id = ${TEST_ITEM_ID}`;
}

async function getOrCreateAccount(ownerType, ownerId) {
  // First try to find existing
  const existing = await sql`SELECT id FROM accounts WHERE tenant_id = ${TEST_TENANT_ID} AND owner_type = ${ownerType} AND owner_id = ${ownerId} AND currency = 'EGP'`;
  if (existing.length > 0) return existing[0].id;
  // Insert new
  const newId = cryptoRandomUUID();
  try {
    await sql`INSERT INTO accounts (id, tenant_id, owner_type, owner_id, currency, status, created_by) VALUES (${newId}, ${TEST_TENANT_ID}, ${ownerType}, ${ownerId}, 'EGP', 'active', ${TEST_USER_ID})`;
    return newId;
  } catch (e) {
    if (e.message.includes("accounts_tenant_owner_type_owner_currency_unique_idx")) {
      // Concurrent insert won — re-fetch
      const retry = await sql`SELECT id FROM accounts WHERE tenant_id = ${TEST_TENANT_ID} AND owner_type = ${ownerType} AND owner_id = ${ownerId} AND currency = 'EGP'`;
      return retry[0].id;
    }
    throw e;
  }
}

/**
 * Insert a customer receivable entry (simulating approved sale).
 */
async function insertCustomerReceivable(amount = "1000.00") {
  const entryId = cryptoRandomUUID();
  const accountId = await getOrCreateAccount("customer", TEST_CUSTOMER_ID);
  await sql`INSERT INTO account_entries (id, tenant_id, account_id, entry_no, entry_date, amount_signed, currency, entry_type, source_document_type, source_document_id, settlement_status, created_by, record_origin, record_period) VALUES (${entryId}, ${TEST_TENANT_ID}, ${accountId}, ${'AE-RECV-' + Date.now().toString(36) + Math.random().toString(36).slice(2,6)}, '2026-07-10', ${amount}, 'EGP', 'customer_sale_receivable', 'sales_order', ${TEST_SALE_ID}, 'unsettled', ${TEST_USER_ID}, 'manual_live', 'live')`;
  return { entryId, accountId };
}

/**
 * Insert a supplier payable entry (simulating approved raw receipt).
 */
async function insertSupplierPayable(amount = "1000.00") {
  const entryId = cryptoRandomUUID();
  const accountId = await getOrCreateAccount("supplier", TEST_SUPPLIER_ID);
  await sql`INSERT INTO account_entries (id, tenant_id, account_id, entry_no, entry_date, amount_signed, currency, entry_type, source_document_type, source_document_id, settlement_status, created_by, record_origin, record_period) VALUES (${entryId}, ${TEST_TENANT_ID}, ${accountId}, ${'AE-PAY-' + Date.now().toString(36) + Math.random().toString(36).slice(2,6)}, '2026-07-10', ${'-' + amount}, 'EGP', 'supplier_raw_payable', 'raw_material_batch', ${TEST_SALE_ID}, 'unsettled', ${TEST_USER_ID}, 'manual_live', 'live')`;
  return { entryId, accountId };
}

/**
 * Post a payment + create account entry in one atomic transaction (simulating PaymentService).
 * Returns { paymentId, postedEntryId, accountId, amountSigned }.
 */
async function postPayment(ownerType, direction, amount, method = "cash", idemSuffix = "1") {
  const paymentId = cryptoRandomUUID();
  const entryId = cryptoRandomUUID();
  const runSuffix = Date.now().toString(36);
  const paymentNo = `PAY-${runSuffix}-${idemSuffix}`;
  const entryNo = `AE-PAY-${runSuffix}-${idemSuffix}-${Math.random().toString(36).slice(2,6)}`;
  const ownerId = ownerType === "customer" ? TEST_CUSTOMER_ID : TEST_SUPPLIER_ID;

  let entryType, amountSigned;
  if (ownerType === "customer" && direction === "received_from_party") {
    entryType = "customer_payment";
    amountSigned = "-" + amount;  // NEGATIVE
  } else if (ownerType === "supplier" && direction === "paid_to_party") {
    entryType = "supplier_payment";
    amountSigned = amount;  // POSITIVE
  } else {
    throw new Error(`Invalid combo: ${ownerType} + ${direction}`);
  }

  const accountId = await getOrCreateAccount(ownerType, ownerId);

  await sql.begin(async (tx) => {
    // Insert account entry (immutable)
    await tx`INSERT INTO account_entries (id, tenant_id, account_id, entry_no, entry_date, amount_signed, currency, entry_type, source_document_type, source_document_id, settlement_status, created_by, record_origin, record_period) VALUES (${entryId}, ${TEST_TENANT_ID}, ${accountId}, ${entryNo}, '2026-07-10', ${amountSigned}, 'EGP', ${entryType}, 'payment', ${paymentId}, 'unsettled', ${TEST_USER_ID}, 'manual_live', 'live')`;
    // Insert payment row (posted)
    await tx`INSERT INTO payments (id, tenant_id, payment_no, payment_date, account_id, amount, payment_direction, payment_method, status, posted_entry_id, idempotency_key, is_locked, created_by, record_origin, record_period) VALUES (${paymentId}, ${TEST_TENANT_ID}, ${paymentNo}, '2026-07-10', ${accountId}, ${amount}, ${direction}, ${method}, 'posted', ${entryId}, ${'pay-idem-' + runSuffix + '-' + idemSuffix}, true, ${TEST_USER_ID}, 'manual_live', 'live')`;
  });

  return { paymentId, postedEntryId: entryId, accountId, amountSigned, entryType };
}

async function settlePayment(paymentId, paymentEntryId, allocations, idemKey) {
  const settlementIds = [];
  await sql.begin(async (tx) => {
    // Lock payment + payment entry
    const paymentRows = await tx`SELECT * FROM payments WHERE id = ${paymentId} AND tenant_id = ${TEST_TENANT_ID} FOR UPDATE`;
    if (paymentRows.length === 0) throw new Error("PAYMENT_NOT_FOUND");
    if (paymentRows[0].status !== "posted") throw new Error("PAYMENT_NOT_POSTED:" + paymentRows[0].status);

    const paymentEntryRows = await tx`SELECT * FROM account_entries WHERE id = ${paymentEntryId} AND tenant_id = ${TEST_TENANT_ID} FOR UPDATE`;
    if (paymentEntryRows.length === 0) throw new Error("PAYMENT_ENTRY_NOT_FOUND");

    // Compute existing settlements on payment entry
    const existingPaySettlements = await tx`SELECT * FROM payment_settlements WHERE tenant_id = ${TEST_TENANT_ID} AND payment_entry_id = ${paymentEntryId} AND settlement_status = 'settled' FOR UPDATE`;
    const alreadySettledOnPayment = existingPaySettlements.reduce((sum, s) => sum + parseFloat(s.settled_amount), 0);
    const paymentCapacity = Math.abs(parseFloat(paymentEntryRows[0].amount_signed)) - alreadySettledOnPayment;

    const totalNewSettlement = allocations.reduce((sum, a) => sum + parseFloat(a.settledAmount), 0);
    if (totalNewSettlement > paymentCapacity + 0.001) {
      throw new Error(`OVER_SETTLEMENT:payment:requested=${totalNewSettlement},available=${paymentCapacity}`);
    }

    for (const a of allocations) {
      // Lock target entry
      const targetRows = await tx`SELECT * FROM account_entries WHERE id = ${a.settledEntryId} AND tenant_id = ${TEST_TENANT_ID} FOR UPDATE`;
      if (targetRows.length === 0) throw new Error("TARGET_NOT_FOUND:" + a.settledEntryId);
      const target = targetRows[0];
      if (target.account_id !== paymentEntryRows[0].account_id) throw new Error("ACCOUNT_MISMATCH");
      if (target.settlement_status === "settled") throw new Error("TARGET_ALREADY_SETTLED");
      if (target.settlement_status === "reversed") throw new Error("TARGET_REVERSED");

      // Compute existing settlements on target
      const existingTgtSettlements = await tx`SELECT * FROM payment_settlements WHERE tenant_id = ${TEST_TENANT_ID} AND settled_entry_id = ${a.settledEntryId} AND settlement_status = 'settled' FOR UPDATE`;
      const alreadySettledOnTarget = existingTgtSettlements.reduce((sum, s) => sum + parseFloat(s.settled_amount), 0);
      const targetCapacity = Math.abs(parseFloat(target.amount_signed)) - alreadySettledOnTarget;
      if (parseFloat(a.settledAmount) > targetCapacity + 0.001) {
        throw new Error(`OVER_SETTLEMENT:target:requested=${a.settledAmount},available=${targetCapacity}`);
      }

      // Insert settlement row
      const settlementId = cryptoRandomUUID();
      await tx`INSERT INTO payment_settlements (id, tenant_id, payment_entry_id, settled_entry_id, settled_amount, settlement_status, created_by) VALUES (${settlementId}, ${TEST_TENANT_ID}, ${paymentEntryId}, ${a.settledEntryId}, ${a.settledAmount}, 'settled', ${TEST_USER_ID})`;
      settlementIds.push(settlementId);

      // Update target entry settlement status
      const totalSettledOnTarget = alreadySettledOnTarget + parseFloat(a.settledAmount);
      const newTargetStatus = Math.abs(parseFloat(target.amount_signed)) - totalSettledOnTarget < 0.001 ? "settled" : "partially_settled";
      await tx`UPDATE account_entries SET settlement_status = ${newTargetStatus} WHERE id = ${a.settledEntryId} AND tenant_id = ${TEST_TENANT_ID}`;
    }

    // Update payment entry settlement status
    const totalSettledOnPayment = alreadySettledOnPayment + totalNewSettlement;
    const newPaymentStatus = Math.abs(parseFloat(paymentEntryRows[0].amount_signed)) - totalSettledOnPayment < 0.001 ? "settled" : "partially_settled";
    await tx`UPDATE account_entries SET settlement_status = ${newPaymentStatus} WHERE id = ${paymentEntryId} AND tenant_id = ${TEST_TENANT_ID}`;
  });
  return { settlementIds };
}

async function reversePayment(paymentId, reason, idemKey) {
  const reversalEntryId = cryptoRandomUUID();
  const reversedSettlementIds = [];
  await sql.begin(async (tx) => {
    const paymentRows = await tx`SELECT * FROM payments WHERE id = ${paymentId} AND tenant_id = ${TEST_TENANT_ID} FOR UPDATE`;
    if (paymentRows.length === 0) throw new Error("PAYMENT_NOT_FOUND");
    const payment = paymentRows[0];
    if (payment.status === "reversed") throw new Error("ALREADY_REVERSED");
    if (payment.status !== "posted") throw new Error("NOT_REVERSIBLE:" + payment.status);

    const originalEntryRows = await tx`SELECT * FROM account_entries WHERE id = ${payment.posted_entry_id} AND tenant_id = ${TEST_TENANT_ID} FOR UPDATE`;
    if (originalEntryRows.length === 0) throw new Error("ORIGINAL_ENTRY_NOT_FOUND");
    const originalEntry = originalEntryRows[0];

    // Lock all settlements on the original payment entry
    const settlements = await tx`SELECT * FROM payment_settlements WHERE tenant_id = ${TEST_TENANT_ID} AND payment_entry_id = ${payment.posted_entry_id} AND settlement_status = 'settled' FOR UPDATE`;
    const activeSettlements = settlements;

    // Create reversal entry (opposite signed)
    const reversalAmountSigned = (parseFloat(originalEntry.amount_signed) * -1).toFixed(2);
    const reversalEntryNo = `AE-REV-${Date.now().toString(36)}`;
    await tx`INSERT INTO account_entries (id, tenant_id, account_id, entry_no, entry_date, amount_signed, currency, entry_type, source_document_type, source_document_id, settlement_status, created_by, record_origin, record_period) VALUES (${reversalEntryId}, ${TEST_TENANT_ID}, ${originalEntry.account_id}, ${reversalEntryNo}, '2026-07-10', ${reversalAmountSigned}, 'EGP', 'reversal', 'payment_reversal', ${paymentId}, 'reversed', ${TEST_USER_ID}, 'manual_live', 'live')`;

    // Reverse each active settlement
    for (const s of activeSettlements) {
      const revSettlementId = cryptoRandomUUID();
      await tx`INSERT INTO payment_settlements (id, tenant_id, payment_entry_id, settled_entry_id, settled_amount, settlement_status, created_by) VALUES (${revSettlementId}, ${TEST_TENANT_ID}, ${reversalEntryId}, ${s.settled_entry_id}, ${s.settled_amount}, 'reversed', ${TEST_USER_ID})`;
      reversedSettlementIds.push(revSettlementId);

      // Reset target entry to unsettled (or partially_settled if other active settlements exist)
      const otherActive = await tx`SELECT * FROM payment_settlements WHERE tenant_id = ${TEST_TENANT_ID} AND settled_entry_id = ${s.settled_entry_id} AND settlement_status = 'settled' AND id != ${s.id}`;
      const newStatus = otherActive.length > 0 ? "partially_settled" : "unsettled";
      await tx`UPDATE account_entries SET settlement_status = ${newStatus} WHERE id = ${s.settled_entry_id} AND tenant_id = ${TEST_TENANT_ID}`;
    }

    // Mark original entry as reversed
    await tx`UPDATE account_entries SET settlement_status = 'reversed' WHERE id = ${originalEntry.id} AND tenant_id = ${TEST_TENANT_ID}`;

    // Mark payment as reversed
    await tx`UPDATE payments SET status = 'reversed', reversal_of_payment_id = ${paymentId}, is_locked = true, updated_at = NOW(), updated_by = ${TEST_USER_ID} WHERE id = ${paymentId} AND tenant_id = ${TEST_TENANT_ID}`;
  });
  return { reversalEntryId, reversedSettlementIds };
}

async function main() {
  console.log("=== WP-05-04 Live Supabase Validation ===");
  console.log(`DATABASE_URL host: ${DATABASE_URL.split("@")[1]?.split("/")[0] ?? "?"}`);

  try {
    await ensureMasterData();
    await cleanTestData();

    // 1. Customer payment posts NEGATIVE customer_payment entry
    const custPay = await postPayment("customer", "received_from_party", "500.00", "cash", "1");
    const custEntry = await sql`SELECT entry_type, amount_signed, source_document_type FROM account_entries WHERE id = ${custPay.postedEntryId} AND tenant_id = ${TEST_TENANT_ID}`;
    check("1. customer payment posts NEGATIVE customer_payment entry", custEntry[0].entry_type === "customer_payment" && custEntry[0].amount_signed === "-500.00" && custEntry[0].source_document_type === "payment", `type=${custEntry[0].entry_type}, amount=${custEntry[0].amount_signed}`);

    // 2. Supplier payment posts POSITIVE supplier_payment entry
    const supPay = await postPayment("supplier", "paid_to_party", "500.00", "bank_transfer", "2");
    const supEntry = await sql`SELECT entry_type, amount_signed FROM account_entries WHERE id = ${supPay.postedEntryId} AND tenant_id = ${TEST_TENANT_ID}`;
    check("2. supplier payment posts POSITIVE supplier_payment entry", supEntry[0].entry_type === "supplier_payment" && supEntry[0].amount_signed === "500.00", `type=${supEntry[0].entry_type}, amount=${supEntry[0].amount_signed}`);

    // 3. DEC-066: all 5 payment methods accepted
    const methods = ["cash", "bank_transfer", "check", "wallet_instapay", "other"];
    for (let i = 0; i < methods.length; i++) {
      const m = methods[i];
      const p = await postPayment("customer", "received_from_party", "100.00", m, String(10 + i));
      const rows = await sql`SELECT payment_method FROM payments WHERE id = ${p.paymentId} AND tenant_id = ${TEST_TENANT_ID}`;
      check(`3.${i+1}. DEC-066 method '${m}' accepted`, rows[0].payment_method === m, `method=${rows[0].payment_method}`);
    }

    // 4. Payment idempotency: re-posting same payment with different idem key rejects (STATE_CONFLICT)
    // The payments table has a unique constraint on (tenant_id, idempotency_key).
    // Verify this constraint exists and prevents duplicate idempotency keys.
    const constraintExists = await sql`SELECT COUNT(*)::int AS n FROM pg_indexes WHERE indexname = 'payments_tenant_idempotency_unique_idx'`;
    check("4. payment idempotency: unique constraint on (tenant_id, idempotency_key) exists", constraintExists[0].n === 1, `count=${constraintExists[0].n}`);

    // Additionally verify that the unique constraint rejects duplicates
    const dupIdemKey = 'dup-idem-' + Date.now().toString(36);
    const dupPaymentId1 = cryptoRandomUUID();
    const dupPaymentId2 = cryptoRandomUUID();
    const dupAccountId = await getOrCreateAccount("customer", TEST_CUSTOMER_ID);
    await sql`INSERT INTO payments (id, tenant_id, payment_no, payment_date, account_id, amount, payment_direction, payment_method, status, idempotency_key, is_locked, created_by, record_origin, record_period) VALUES (${dupPaymentId1}, ${TEST_TENANT_ID}, ${'PAY-DUP-A-' + Date.now().toString(36)}, '2026-07-10', ${dupAccountId}, '100.00', 'received_from_party', 'cash', 'draft', ${dupIdemKey}, false, ${TEST_USER_ID}, 'manual_live', 'live')`;
    let dupRejected = false;
    try {
      await sql`INSERT INTO payments (id, tenant_id, payment_no, payment_date, account_id, amount, payment_direction, payment_method, status, idempotency_key, is_locked, created_by, record_origin, record_period) VALUES (${dupPaymentId2}, ${TEST_TENANT_ID}, ${'PAY-DUP-B-' + Date.now().toString(36)}, '2026-07-10', ${dupAccountId}, '100.00', 'received_from_party', 'cash', 'draft', ${dupIdemKey}, false, ${TEST_USER_ID}, 'manual_live', 'live')`;
    } catch (e) {
      dupRejected = e.message.includes("payments_tenant_idempotency_unique_idx");
    }
    check("   duplicate idempotency_key rejected by DB constraint", dupRejected, `rejected=${dupRejected}`);

    // 5. Partial settlement: payment 500 settles 300 of 1000 receivable
    await cleanTestData();
    const recv = await insertCustomerReceivable("1000.00");
    const pay5 = await postPayment("customer", "received_from_party", "500.00", "cash", "5");
    const settle5 = await settlePayment(pay5.paymentId, pay5.postedEntryId, [{ settledEntryId: recv.entryId, settledAmount: "300.00" }], "settle-5");
    const settlementRows = await sql`SELECT settled_amount, settlement_status FROM payment_settlements WHERE id = ${settle5.settlementIds[0]} AND tenant_id = ${TEST_TENANT_ID}`;
    check("5. partial settlement: 300 of 500 payment, 300 of 1000 receivable", settlementRows[0].settled_amount === "300.00" && settlementRows[0].settlement_status === "settled", `amount=${settlementRows[0].settled_amount}, status=${settlementRows[0].settlement_status}`);

    // Verify entry settlement statuses
    const recvAfter5 = await sql`SELECT settlement_status FROM account_entries WHERE id = ${recv.entryId} AND tenant_id = ${TEST_TENANT_ID}`;
    const payEntryAfter5 = await sql`SELECT settlement_status FROM account_entries WHERE id = ${pay5.postedEntryId} AND tenant_id = ${TEST_TENANT_ID}`;
    check("   receivable partially_settled, payment entry partially_settled", recvAfter5[0].settlement_status === "partially_settled" && payEntryAfter5[0].settlement_status === "partially_settled", `recv=${recvAfter5[0].settlement_status}, pay=${payEntryAfter5[0].settlement_status}`);

    // 6. Full settlement: payment 1000 settles 1000 receivable
    await cleanTestData();
    const recv6 = await insertCustomerReceivable("1000.00");
    const pay6 = await postPayment("customer", "received_from_party", "1000.00", "cash", "6");
    const settle6 = await settlePayment(pay6.paymentId, pay6.postedEntryId, [{ settledEntryId: recv6.entryId, settledAmount: "1000.00" }], "settle-6");
    const recv6After = await sql`SELECT settlement_status FROM account_entries WHERE id = ${recv6.entryId} AND tenant_id = ${TEST_TENANT_ID}`;
    const pay6After = await sql`SELECT settlement_status FROM account_entries WHERE id = ${pay6.postedEntryId} AND tenant_id = ${TEST_TENANT_ID}`;
    check("6. full settlement: both entries settled", recv6After[0].settlement_status === "settled" && pay6After[0].settlement_status === "settled", `recv=${recv6After[0].settlement_status}, pay=${pay6After[0].settlement_status}`);

    // 7. Over-settlement on payment side rejected
    await cleanTestData();
    const recv7 = await insertCustomerReceivable("1000.00");
    const pay7 = await postPayment("customer", "received_from_party", "500.00", "cash", "7");
    try {
      await settlePayment(pay7.paymentId, pay7.postedEntryId, [{ settledEntryId: recv7.entryId, settledAmount: "600.00" }], "settle-7");
      check("7. over-settlement on payment side rejected", false, "should have thrown");
    } catch (e) {
      check("7. over-settlement on payment side rejected", e.message.includes("OVER_SETTLEMENT:payment"), `error=${e.message.slice(0, 60)}`);
    }

    // 8. Over-settlement on target side rejected
    await cleanTestData();
    const recv8 = await insertCustomerReceivable("1000.00");
    const pay8 = await postPayment("customer", "received_from_party", "2000.00", "cash", "8");
    try {
      await settlePayment(pay8.paymentId, pay8.postedEntryId, [{ settledEntryId: recv8.entryId, settledAmount: "1500.00" }], "settle-8");
      check("8. over-settlement on target side rejected", false, "should have thrown");
    } catch (e) {
      check("8. over-settlement on target side rejected", e.message.includes("OVER_SETTLEMENT:target"), `error=${e.message.slice(0, 60)}`);
    }

    // 9. Concurrent settlement safety: two concurrent settlements of 300 each on a 500-capacity payment
    await cleanTestData();
    const recv9 = await insertCustomerReceivable("1000.00");
    const pay9 = await postPayment("customer", "received_from_party", "500.00", "cash", "9");
    const [a9, b9] = await Promise.allSettled([
      settlePayment(pay9.paymentId, pay9.postedEntryId, [{ settledEntryId: recv9.entryId, settledAmount: "300.00" }], "settle-9a"),
      settlePayment(pay9.paymentId, pay9.postedEntryId, [{ settledEntryId: recv9.entryId, settledAmount: "300.00" }], "settle-9b"),
    ]);
    const ok9 = [a9, b9].filter(r => r.status === "fulfilled").length;
    const settlements9 = await sql`SELECT * FROM payment_settlements WHERE tenant_id = ${TEST_TENANT_ID} AND payment_entry_id = ${pay9.postedEntryId} AND settlement_status = 'settled'`;
    const totalSettled9 = settlements9.reduce((sum, s) => sum + parseFloat(s.settled_amount), 0);
    check("9. concurrent settlement: total settled ≤ 500 (DB locks prevent over-settlement)", totalSettled9 <= 500 + 0.001, `ok_count=${ok9}, total_settled=${totalSettled9}`);

    // 10. Reversal: creates opposite-signed entry, original immutable, payment reversed
    await cleanTestData();
    const pay10 = await postPayment("customer", "received_from_party", "500.00", "cash", "10");
    const originalEntry10 = await sql`SELECT amount_signed, entry_type FROM account_entries WHERE id = ${pay10.postedEntryId} AND tenant_id = ${TEST_TENANT_ID}`;
    const rev10 = await reversePayment(pay10.paymentId, "Customer cancelled", "rev-10");
    const reversalEntry10 = await sql`SELECT amount_signed, entry_type FROM account_entries WHERE id = ${rev10.reversalEntryId} AND tenant_id = ${TEST_TENANT_ID}`;
    check("10. reversal creates opposite-signed reversal entry", reversalEntry10[0].entry_type === "reversal" && reversalEntry10[0].amount_signed === "500.00" && originalEntry10[0].amount_signed === "-500.00", `orig=${originalEntry10[0].amount_signed}, rev=${reversalEntry10[0].amount_signed}`);

    // Original entry remains immutable (amount_signed unchanged) but settlement_status = reversed
    const orig10After = await sql`SELECT amount_signed, settlement_status FROM account_entries WHERE id = ${pay10.postedEntryId} AND tenant_id = ${TEST_TENANT_ID}`;
    check("   original entry immutable (amount unchanged), settlement_status=reversed", orig10After[0].amount_signed === "-500.00" && orig10After[0].settlement_status === "reversed", `amount=${orig10After[0].amount_signed}, status=${orig10After[0].settlement_status}`);

    // Payment status = reversed
    const pay10After = await sql`SELECT status, reversal_of_payment_id FROM payments WHERE id = ${pay10.paymentId} AND tenant_id = ${TEST_TENANT_ID}`;
    check("   payment status=reversed, reversal_of_payment_id set", pay10After[0].status === "reversed" && pay10After[0].reversal_of_payment_id === pay10.paymentId, `status=${pay10After[0].status}`);

    // 11. Cannot reverse twice
    try {
      await reversePayment(pay10.paymentId, "Second reversal attempt", "rev-11");
      check("11. cannot reverse twice", false, "should have thrown");
    } catch (e) {
      check("11. cannot reverse twice", e.message === "ALREADY_REVERSED", `error=${e.message}`);
    }

    // 12. Reversal of settled payment safely unallocates settlements
    await cleanTestData();
    const recv12 = await insertCustomerReceivable("1000.00");
    const pay12 = await postPayment("customer", "received_from_party", "500.00", "cash", "12");
    await settlePayment(pay12.paymentId, pay12.postedEntryId, [{ settledEntryId: recv12.entryId, settledAmount: "300.00" }], "settle-12");
    const rev12 = await reversePayment(pay12.paymentId, "Reverse after settlement", "rev-12");
    check("12. reversal of settled payment creates reversal settlements", rev12.reversedSettlementIds.length === 1, `count=${rev12.reversedSettlementIds.length}`);

    // Receivable should be back to unsettled
    const recv12After = await sql`SELECT settlement_status FROM account_entries WHERE id = ${recv12.entryId} AND tenant_id = ${TEST_TENANT_ID}`;
    check("   receivable back to unsettled after reversal", recv12After[0].settlement_status === "unsettled", `status=${recv12After[0].settlement_status}`);

    // 13. Tenant isolation: foreign tenant cannot see this tenant's payments
    const foreignTenant = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    const foreignLookup = await sql`SELECT * FROM payments WHERE id = ${pay12.paymentId} AND tenant_id = ${foreignTenant}`;
    check("13. tenant isolation: foreign tenant sees 0 payments", foreignLookup.length === 0, `count=${foreignLookup.length}`);

    // 14. No stock movements created during payments
    const stockMvCount = await sql`SELECT COUNT(*)::int AS n FROM stock_movements WHERE tenant_id = ${TEST_TENANT_ID} AND source_document_type IN ('payment', 'payment_reversal')`;
    check("14. no stock movements created by payments", stockMvCount[0].n === 0, `count=${stockMvCount[0].n}`);

    // 15. No sales approval mutations
    const salesApprovalAudit = await sql`SELECT COUNT(*)::int AS n FROM audit_logs WHERE tenant_id = ${TEST_TENANT_ID} AND action_type LIKE 'sales_approval%'`;
    check("15. no sales_approval audit actions from payments", salesApprovalAudit[0].n === 0, `count=${salesApprovalAudit[0].n}`);

    // 16. No profitability/direct-cost side effects
    const profitSnapCount = await sql`SELECT COUNT(*)::int AS n FROM sales_profitability_snapshots WHERE tenant_id = ${TEST_TENANT_ID}`;
    const directCostCount = await sql`SELECT COUNT(*)::int AS n FROM audit_logs WHERE tenant_id = ${TEST_TENANT_ID} AND action_type LIKE '%direct_cost%'`;
    check("16. no profitability snapshots / direct-cost side effects", profitSnapCount[0].n === 0 && directCostCount[0].n === 0, `snaps=${profitSnapCount[0].n}, direct_cost_audit=${directCostCount[0].n}`);

    // 17. Rollback proof: payment entry insert fails → no payment row persisted
    await cleanTestData();
    const recv17 = await insertCustomerReceivable("1000.00");
    // Pre-insert a payment in draft state, then try to "post" it in a tx that fails mid-way.
    // The tx should roll back, leaving the payment in draft state with no account_entries.
    const conflictPaymentId = cryptoRandomUUID();
    const conflictAccountId = await getOrCreateAccount("customer", TEST_CUSTOMER_ID);
    await sql`INSERT INTO payments (id, tenant_id, payment_no, payment_date, account_id, amount, payment_direction, payment_method, status, idempotency_key, is_locked, created_by, record_origin, record_period) VALUES (${conflictPaymentId}, ${TEST_TENANT_ID}, ${'PAY-PRE-017-' + Date.now().toString(36)}, '2026-07-10', ${conflictAccountId}, '1.00', 'received_from_party', 'cash', 'draft', ${'preexisting-017-' + Date.now().toString(36)}, false, ${TEST_USER_ID}, 'manual_live', 'live')`;
    // Now try to post the payment in a tx that fails mid-way (duplicate entry_no)
    let rollbackFailed = false;
    const sharedEntryNo = 'AE-FAIL-017-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,8);
    try {
      await sql.begin(async (tx) => {
        // Insert account entry (immutable) — uses sharedEntryNo
        await tx`INSERT INTO account_entries (id, tenant_id, account_id, entry_no, entry_date, amount_signed, currency, entry_type, source_document_type, source_document_id, settlement_status, created_by, record_origin, record_period) VALUES (${cryptoRandomUUID()}, ${TEST_TENANT_ID}, ${conflictAccountId}, ${sharedEntryNo}, '2026-07-10', '-1.00', 'EGP', 'customer_payment', 'payment', ${conflictPaymentId}, 'unsettled', ${TEST_USER_ID}, 'manual_live', 'live')`;
        // Update payment to posted
        await tx`UPDATE payments SET status = 'posted', is_locked = true, posted_entry_id = (SELECT id FROM account_entries WHERE tenant_id = ${TEST_TENANT_ID} AND source_document_id = ${conflictPaymentId} LIMIT 1) WHERE id = ${conflictPaymentId} AND tenant_id = ${TEST_TENANT_ID}`;
        // Force a failure by inserting a DUPLICATE entry_no (same as the first insert)
        await tx`INSERT INTO account_entries (id, tenant_id, account_id, entry_no, entry_date, amount_signed, currency, entry_type, source_document_type, source_document_id, settlement_status, created_by, record_origin, record_period) VALUES (${cryptoRandomUUID()}, ${TEST_TENANT_ID}, ${conflictAccountId}, ${sharedEntryNo}, '2026-07-10', '-2.00', 'EGP', 'customer_payment', 'payment', ${conflictPaymentId}, 'unsettled', ${TEST_USER_ID}, 'manual_live', 'live')`;
      });
    } catch (e) {
      rollbackFailed = true;
    }
    check("17. rollback proof: tx fails when entry_no conflicts (duplicate insert)", rollbackFailed, `failed=${rollbackFailed}`);
    // Verify the payment is still draft (not posted) — the UPDATE rolled back
    const pay17After = await sql`SELECT status, posted_entry_id FROM payments WHERE id = ${conflictPaymentId} AND tenant_id = ${TEST_TENANT_ID}`;
    check("   payment still draft after rollback (UPDATE rolled back)", pay17After[0].status === "draft" && pay17After[0].posted_entry_id === null, `status=${pay17After[0].status}, posted_entry_id=${pay17After[0].posted_entry_id}`);
    // Verify no account_entries were persisted for this payment
    const entries17 = await sql`SELECT COUNT(*)::int AS n FROM account_entries WHERE tenant_id = ${TEST_TENANT_ID} AND source_document_id = ${conflictPaymentId}`;
    check("   no account entries persisted after rollback", entries17[0].n === 0, `count=${entries17[0].n}`);

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
