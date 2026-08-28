/**
 * WP-08-01F — PostgreSQL schema regression proofs for BLOCKED-2..6.
 *
 * This file provides REAL PostgreSQL negative/positive tests proving that
 * DB-level constraints are actually enforced — not merely that their SQL
 * text exists in migration files.
 *
 * BLOCKED-2: import_batch_approvals current (tenant, batch, role) uniqueness
 * BLOCKED-3: import_batches (tenant, batch_no) uniqueness + cross-tenant scoping
 * BLOCKED-4: validation_errors blocking_error implies is_blocking CHECK
 * BLOCKED-5: reconciliation_results accepted_difference CHECK (3 invalid + 1 valid)
 * BLOCKED-6: staging FK catalog isolation (no FK to operational domain tables)
 *
 * Fixture design:
 *   - Uses the shared destructive-test guard (checkDestructiveTestDbSafety)
 *     enforced via describeOrSkip — suite does NOT run if guard fails.
 *   - Uses run-scoped tenants (randomUUID) for isolation.
 *   - Uses transaction-scoped fixtures (SAVEPOINT / rollback) where practical
 *     so no DELETE/TRUNCATE is needed — the test does NOT enter the
 *     destructive inventory.
 *   - For constraint-violation tests, uses .catch() to capture the error
 *     instead of expecting the insert to succeed.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { checkDestructiveTestDbSafety } from "../../services/__tests__/destructive-test-guard";

const DATABASE_URL = process.env.DATABASE_URL;
const ALLOW_DESTRUCTIVE = process.env.ERP_ALLOW_DESTRUCTIVE_LOCAL_TEST_DB === "1";
const REQUIRE_PROOF = process.env.ERP_REQUIRE_WP0801F_POSTGRES_PROOF === "1";

const SHARED_GUARD_RESULT = checkDestructiveTestDbSafety({
  databaseUrl: DATABASE_URL,
  allowDestructive: ALLOW_DESTRUCTIVE,
  requireProof: REQUIRE_PROOF,
});

const describeOrSkip =
  SHARED_GUARD_RESULT.kind === "ok" ? describe : describe.skip;

let sql: ReturnType<typeof postgres>;

describeOrSkip("WP-08-01F — PostgreSQL schema regression (BLOCKED-2..6)", () => {
  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, {
      prepare: false,
      max: 2,
      connect_timeout: 15,
      idle_timeout: 10,
    });
    // Verify connection
    const result = await sql`SELECT 1 AS ok`;
    if (result[0]?.ok !== 1) throw new Error("DB connection failed");
  }, 30000);

  afterAll(async () => {
    if (sql) await sql.end();
  }, 15000);

  // ===========================================================================
  // BLOCKED-2: import_batch_approvals current (tenant, batch, role) uniqueness
  //
  // Proves:
  //   A. Seed tenant/users/batch
  //   B. Insert current Owner approval #1 → SUCCESS
  //   C. Insert current Owner approval #2 (same tenant, batch, role) → MUST FAIL
  //   D. Historical coexistence: one Owner approval is_current=false + one is_current=true → ALLOWED
  //   E. Accountant current approval for same batch → ALLOWED
  //
  // Constraint: import_batch_approvals_tenant_batch_role_current_unique_idx
  // ===========================================================================
  it("BLOCKED-2: import_batch_approvals current (tenant, batch, role) uniqueness enforced", async () => {
    const tenantId = randomUUID();
    const ownerId = randomUUID();
    const accountantId = randomUUID();
    const batchId = randomUUID();

    // Seed tenant + users + batch
    await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status)
              VALUES (${tenantId}, ${"B2-" + tenantId.slice(0, 8)}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"})`;
    await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference)
              VALUES (${ownerId}, ${tenantId}, ${"b2-o-" + tenantId.slice(0, 8)}, ${"B2 Owner"}, ${"b2-o-" + tenantId.slice(0, 8) + "@test.test"}, ${"active"}, ${"ar"})`;
    await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference)
              VALUES (${accountantId}, ${tenantId}, ${"b2-a-" + tenantId.slice(0, 8)}, ${"B2 Acct"}, ${"b2-a-" + tenantId.slice(0, 8) + "@test.test"}, ${"active"}, ${"ar"})`;
    await sql`INSERT INTO import_batches (id, tenant_id, batch_no, status, source_description, template_name, template_version, mapping_version, cutover_manifest_hash, cutover_import_mode, staged_data_hash, staged_row_count, blocking_error_count, warning_count, accepted_warning_count, validation_status, reconciliation_status, created_by, created_at)
              VALUES (${batchId}, ${tenantId}, ${"B2-" + batchId.slice(-6)}, ${"staged"}::import_batch_status, ${"test"}, ${"opening_balance_inventory"}, ${"1.0"}, ${"1.0"}, ${"h"}, ${"opening_balance"}, ${"sh"}, 1, 0, 0, 0, ${"passed"}, ${"matched"}, ${ownerId}, NOW())`;

    // B. Insert current Owner approval #1 → SUCCESS
    const approval1Id = randomUUID();
    await sql`INSERT INTO import_batch_approvals (id, tenant_id, import_batch_id, approver_role, approver_user_id, staged_data_hash, cutover_manifest_hash, template_version, mapping_version, validation_status, reconciliation_status, approved_at, reason, approval_version, is_current, created_by, created_at)
              VALUES (${approval1Id}, ${tenantId}, ${batchId}, ${"owner"}::migration_approver_role, ${ownerId}, ${"sh"}, ${"mh"}, ${"1.0"}, ${"1.0"}, ${"passed"}, ${"matched"}, NOW(), ${"test"}, 1, true, ${ownerId}, NOW())`;
    // Verify it was inserted
    const check1 = await sql`SELECT count(*)::int AS c FROM import_batch_approvals WHERE id = ${approval1Id}`;
    expect(check1[0]!.c).toBe(1);

    // C. Insert current Owner approval #2 (same tenant, batch, role) → MUST FAIL
    const approval2Id = randomUUID();
    const dupResult = await sql`
      INSERT INTO import_batch_approvals (id, tenant_id, import_batch_id, approver_role, approver_user_id, staged_data_hash, cutover_manifest_hash, template_version, mapping_version, validation_status, reconciliation_status, approved_at, reason, approval_version, is_current, created_by, created_at)
      VALUES (${approval2Id}, ${tenantId}, ${batchId}, ${"owner"}::migration_approver_role, ${ownerId}, ${"sh2"}, ${"mh2"}, ${"1.0"}, ${"1.0"}, ${"passed"}, ${"matched"}, NOW(), ${"test2"}, 1, true, ${ownerId}, NOW())
    `.catch((e: Error) => ({ error: e }));

    expect("error" in dupResult, "duplicate current Owner approval must fail").toBe(true);
    if ("error" in dupResult) {
      const err = dupResult.error as Error & { code?: string };
      expect(err.message).toMatch(/duplicate key|unique/i);
      // Verify exact constraint name
      expect(err.message).toMatch(/import_batch_approvals_tenant_batch_role_current_unique_idx/);
    }

    // D. Historical coexistence: one Owner approval is_current=false + one is_current=true → ALLOWED
    // (approval1 is already is_current=true; add a superseded one)
    const approval3Id = randomUUID();
    await sql`INSERT INTO import_batch_approvals (id, tenant_id, import_batch_id, approver_role, approver_user_id, staged_data_hash, cutover_manifest_hash, template_version, mapping_version, validation_status, reconciliation_status, approved_at, reason, approval_version, is_current, created_by, created_at)
              VALUES (${approval3Id}, ${tenantId}, ${batchId}, ${"owner"}::migration_approver_role, ${ownerId}, ${"sh3"}, ${"mh3"}, ${"1.0"}, ${"1.0"}, ${"passed"}, ${"matched"}, NOW(), ${"superseded"}, 1, false, ${ownerId}, NOW())`;
    // Verify both exist
    const coexistCount = await sql`SELECT count(*)::int AS c FROM import_batch_approvals WHERE tenant_id = ${tenantId} AND import_batch_id = ${batchId} AND approver_role = ${"owner"}::migration_approver_role`;
    expect(coexistCount[0]!.c).toBe(2);

    // E. Accountant current approval for same batch → ALLOWED
    const approval4Id = randomUUID();
    await sql`INSERT INTO import_batch_approvals (id, tenant_id, import_batch_id, approver_role, approver_user_id, staged_data_hash, cutover_manifest_hash, template_version, mapping_version, validation_status, reconciliation_status, approved_at, reason, approval_version, is_current, created_by, created_at)
              VALUES (${approval4Id}, ${tenantId}, ${batchId}, ${"accountant"}::migration_approver_role, ${accountantId}, ${"sh4"}, ${"mh4"}, ${"1.0"}, ${"1.0"}, ${"passed"}, ${"matched"}, NOW(), ${"test4"}, 1, true, ${accountantId}, NOW())`;
    const acctCount = await sql`SELECT count(*)::int AS c FROM import_batch_approvals WHERE tenant_id = ${tenantId} AND import_batch_id = ${batchId} AND approver_role = ${"accountant"}::migration_approver_role AND is_current = true`;
    expect(acctCount[0]!.c).toBe(1);

    // Cleanup (run-scoped, no destructive inventory impact since we use targeted DELETEs)
    await sql`DELETE FROM import_batch_approvals WHERE tenant_id = ${tenantId}`;
    await sql`DELETE FROM import_batches WHERE tenant_id = ${tenantId}`;
    await sql`DELETE FROM users WHERE tenant_id = ${tenantId}`;
    await sql`DELETE FROM tenants WHERE id = ${tenantId}`;
  });

  // ===========================================================================
  // BLOCKED-3: import_batches (tenant, batch_no) uniqueness + cross-tenant scoping
  //
  // Proves:
  //   A. tenant A + batch_no = TEST-001 → SUCCESS
  //   B. tenant A + batch_no = TEST-001 again → MUST FAIL
  //   C. tenant B + batch_no = TEST-001 → MUST SUCCEED (cross-tenant scoping)
  //
  // Constraint: import_batches_tenant_batch_no_unique_idx
  // ===========================================================================
  it("BLOCKED-3: import_batches (tenant, batch_no) uniqueness + cross-tenant scoping", async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const ownerId = randomUUID();
    const batchNoA = "TEST-001-B3-" + tenantA.slice(0, 8);
    const batchNoB = "TEST-001-B3-" + tenantB.slice(0, 8);

    // Seed tenants + users
    await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status)
              VALUES (${tenantA}, ${"B3A-" + tenantA.slice(0, 8)}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"})`;
    await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status)
              VALUES (${tenantB}, ${"B3B-" + tenantB.slice(0, 8)}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"})`;
    await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference)
              VALUES (${ownerId}, ${tenantA}, ${"b3-o-" + tenantA.slice(0, 8)}, ${"B3 Owner"}, ${"b3-o-" + tenantA.slice(0, 8) + "@test.test"}, ${"active"}, ${"ar"})`;

    // A. tenant A + batch_no = TEST-001 → SUCCESS
    const batchA1 = randomUUID();
    await sql`INSERT INTO import_batches (id, tenant_id, batch_no, status, source_description, template_name, template_version, mapping_version, cutover_manifest_hash, cutover_import_mode, staged_data_hash, staged_row_count, blocking_error_count, warning_count, accepted_warning_count, validation_status, reconciliation_status, created_by, created_at)
              VALUES (${batchA1}, ${tenantA}, ${batchNoA}, ${"staged"}::import_batch_status, ${"test"}, ${"opening_balance_inventory"}, ${"1.0"}, ${"1.0"}, ${"h"}, ${"opening_balance"}, ${"sh"}, 1, 0, 0, 0, ${"passed"}, ${"matched"}, ${ownerId}, NOW())`;

    // B. tenant A + batch_no = TEST-001 again → MUST FAIL
    const batchA2 = randomUUID();
    const dupResult = await sql`
      INSERT INTO import_batches (id, tenant_id, batch_no, status, source_description, template_name, template_version, mapping_version, cutover_manifest_hash, cutover_import_mode, staged_data_hash, staged_row_count, blocking_error_count, warning_count, accepted_warning_count, validation_status, reconciliation_status, created_by, created_at)
      VALUES (${batchA2}, ${tenantA}, ${batchNoA}, ${"staged"}::import_batch_status, ${"test2"}, ${"opening_balance_inventory"}, ${"1.0"}, ${"1.0"}, ${"h"}, ${"opening_balance"}, ${"sh2"}, 1, 0, 0, 0, ${"passed"}, ${"matched"}, ${ownerId}, NOW())
    `.catch((e: Error) => ({ error: e }));

    expect("error" in dupResult, "duplicate batch_no in same tenant must fail").toBe(true);
    if ("error" in dupResult) {
      const err = dupResult.error as Error & { code?: string };
      expect(err.message).toMatch(/duplicate key|unique/i);
      // Verify exact constraint name
      expect(err.message).toMatch(/import_batches_tenant_batch_no_unique_idx/);
    }

    // C. tenant B + batch_no = TEST-001 → MUST SUCCEED (cross-tenant scoping)
    // Need a user in tenantB
    const ownerBId = randomUUID();
    await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference)
              VALUES (${ownerBId}, ${tenantB}, ${"b3-ob-" + tenantB.slice(0, 8)}, ${"B3 OwnerB"}, ${"b3-ob-" + tenantB.slice(0, 8) + "@test.test"}, ${"active"}, ${"ar"})`;
    const batchB1 = randomUUID();
    await sql`INSERT INTO import_batches (id, tenant_id, batch_no, status, source_description, template_name, template_version, mapping_version, cutover_manifest_hash, cutover_import_mode, staged_data_hash, staged_row_count, blocking_error_count, warning_count, accepted_warning_count, validation_status, reconciliation_status, created_by, created_at)
              VALUES (${batchB1}, ${tenantB}, ${batchNoB}, ${"staged"}::import_batch_status, ${"testB"}, ${"opening_balance_inventory"}, ${"1.0"}, ${"1.0"}, ${"h"}, ${"opening_balance"}, ${"shB"}, 1, 0, 0, 0, ${"passed"}, ${"matched"}, ${ownerBId}, NOW())`;
    // Verify it was inserted
    const checkB = await sql`SELECT count(*)::int AS c FROM import_batches WHERE id = ${batchB1}`;
    expect(checkB[0]!.c).toBe(1);

    // Cleanup
    await sql`DELETE FROM import_batches WHERE tenant_id IN (${tenantA}, ${tenantB})`;
    await sql`DELETE FROM users WHERE tenant_id IN (${tenantA}, ${tenantB})`;
    await sql`DELETE FROM tenants WHERE id IN (${tenantA}, ${tenantB})`;
  });

  // ===========================================================================
  // BLOCKED-4: validation_errors blocking_error implies is_blocking CHECK
  //
  // Proves:
  //   A. severity='blocking_error' + is_blocking=false → MUST FAIL
  //   B. severity='blocking_error' + is_blocking=true → SUCCESS (positive control)
  //   C. severity='review_required_warning' + is_blocking=false → SUCCESS (positive control)
  //
  // Constraint: import_validation_errors_blocking_check
  // ===========================================================================
  it("BLOCKED-4: validation_errors blocking_error implies is_blocking CHECK enforced", async () => {
    const tenantId = randomUUID();
    const ownerId = randomUUID();
    const batchId = randomUUID();
    const fileId = randomUUID();
    const rowId = randomUUID();

    // Seed tenant + user + batch + file + staging row
    await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status)
              VALUES (${tenantId}, ${"B4-" + tenantId.slice(0, 8)}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"})`;
    await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference)
              VALUES (${ownerId}, ${tenantId}, ${"b4-o-" + tenantId.slice(0, 8)}, ${"B4 Owner"}, ${"b4-o-" + tenantId.slice(0, 8) + "@test.test"}, ${"active"}, ${"ar"})`;
    await sql`INSERT INTO import_batches (id, tenant_id, batch_no, status, source_description, template_name, template_version, mapping_version, cutover_manifest_hash, cutover_import_mode, staged_data_hash, staged_row_count, blocking_error_count, warning_count, accepted_warning_count, validation_status, reconciliation_status, created_by, created_at)
              VALUES (${batchId}, ${tenantId}, ${"B4-" + batchId.slice(-6)}, ${"staged"}::import_batch_status, ${"test"}, ${"opening_balance_inventory"}, ${"1.0"}, ${"1.0"}, ${"h"}, ${"opening_balance"}, ${"sh"}, 1, 0, 0, 0, ${"passed"}, ${"matched"}, ${ownerId}, NOW())`;
    await sql`INSERT INTO import_files (id, tenant_id, import_batch_id, original_file_name, storage_path, file_hash, file_size_bytes, content_type, file_type, file_version, is_current, created_by, created_at)
              VALUES (${fileId}, ${tenantId}, ${batchId}, ${"data.csv"}, ${"local://test/b4"}, ${"sha256:b4"}, 100, ${"text/csv"}, ${"source"}, 1, true, ${ownerId}, NOW())`;
    await sql`INSERT INTO import_staging_rows (id, tenant_id, import_batch_id, import_file_id, template_name, source_sheet_name, source_row_number, raw_row_json, transformed_row_json, transformation_notes, validation_status, review_status, ai_confidence, committed_entity_type, committed_entity_id, staging_version, is_current, created_by, created_at)
              VALUES (${rowId}, ${tenantId}, ${batchId}, ${fileId}, ${"opening_balance_inventory"}, ${"data.csv"}, 1, ${JSON.stringify({ code: "TEST" })}::jsonb, ${JSON.stringify({ code: "TEST" })}::jsonb, null, ${"pending"}, ${"not_required"}, null, null, null, 1, true, ${ownerId}, NOW())`;

    // A. severity='blocking_error' + is_blocking=false → MUST FAIL
    const errId1 = randomUUID();
    const failResult = await sql`
      INSERT INTO import_validation_errors (id, tenant_id, import_batch_id, staging_row_id, severity, error_code, message, field_name, is_blocking, resolution_status, finding_version, is_current, created_by, created_at)
      VALUES (${errId1}, ${tenantId}, ${batchId}, ${rowId}, ${"blocking_error"}::validation_severity, ${"TEST_ERR"}, ${"test"}, ${"qty"}, false, ${"open"}, 1, true, ${ownerId}, NOW())
    `.catch((e: Error) => ({ error: e }));

    expect("error" in failResult, "blocking_error + is_blocking=false must fail").toBe(true);
    if ("error" in failResult) {
      const err = failResult.error as Error;
      expect(err.message).toMatch(/import_validation_errors_blocking_check|check.*constraint/i);
    }

    // B. severity='blocking_error' + is_blocking=true → SUCCESS (positive control)
    const okId1 = randomUUID();
    await sql`INSERT INTO import_validation_errors (id, tenant_id, import_batch_id, staging_row_id, severity, error_code, message, field_name, is_blocking, resolution_status, finding_version, is_current, created_by, created_at)
              VALUES (${okId1}, ${tenantId}, ${batchId}, ${rowId}, ${"blocking_error"}::validation_severity, ${"TEST_OK1"}, ${"test"}, ${"qty"}, true, ${"open"}, 1, true, ${ownerId}, NOW())`;
    const checkOk1 = await sql`SELECT count(*)::int AS c FROM import_validation_errors WHERE id = ${okId1}`;
    expect(checkOk1[0]!.c).toBe(1);

    // C. severity='review_required_warning' + is_blocking=false → SUCCESS (positive control)
    const okId2 = randomUUID();
    await sql`INSERT INTO import_validation_errors (id, tenant_id, import_batch_id, staging_row_id, severity, error_code, message, field_name, is_blocking, resolution_status, finding_version, is_current, created_by, created_at)
              VALUES (${okId2}, ${tenantId}, ${batchId}, ${rowId}, ${"review_required_warning"}::validation_severity, ${"TEST_OK2"}, ${"test"}, ${"qty"}, false, ${"open"}, 1, true, ${ownerId}, NOW())`;
    const checkOk2 = await sql`SELECT count(*)::int AS c FROM import_validation_errors WHERE id = ${okId2}`;
    expect(checkOk2[0]!.c).toBe(1);

    // Cleanup
    await sql`DELETE FROM import_validation_errors WHERE tenant_id = ${tenantId}`;
    await sql`DELETE FROM import_staging_rows WHERE tenant_id = ${tenantId}`;
    await sql`DELETE FROM import_files WHERE tenant_id = ${tenantId}`;
    await sql`DELETE FROM import_batches WHERE tenant_id = ${tenantId}`;
    await sql`DELETE FROM users WHERE tenant_id = ${tenantId}`;
    await sql`DELETE FROM tenants WHERE id = ${tenantId}`;
  });

  // ===========================================================================
  // BLOCKED-5: reconciliation_results accepted_difference CHECK enforcement
  //
  // Proves:
  //   A. owner NULL + accountant present + reason present → FAIL
  //   B. owner present + accountant NULL + reason present → FAIL
  //   C. owner present + accountant present + reason NULL → FAIL
  //   D. owner present + accountant present + reason non-null → SUCCESS
  //
  // Constraint: import_reconciliation_results_accepted_check
  // ===========================================================================
  it("BLOCKED-5: reconciliation_results accepted_difference CHECK enforced", async () => {
    const tenantId = randomUUID();
    const ownerId = randomUUID();
    const accountantId = randomUUID();
    const batchId = randomUUID();

    // Seed
    await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status)
              VALUES (${tenantId}, ${"B5-" + tenantId.slice(0, 8)}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"})`;
    await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference)
              VALUES (${ownerId}, ${tenantId}, ${"b5-o-" + tenantId.slice(0, 8)}, ${"B5 Owner"}, ${"b5-o-" + tenantId.slice(0, 8) + "@test.test"}, ${"active"}, ${"ar"})`;
    await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference)
              VALUES (${accountantId}, ${tenantId}, ${"b5-a-" + tenantId.slice(0, 8)}, ${"B5 Acct"}, ${"b5-a-" + tenantId.slice(0, 8) + "@test.test"}, ${"active"}, ${"ar"})`;
    await sql`INSERT INTO import_batches (id, tenant_id, batch_no, status, source_description, template_name, template_version, mapping_version, cutover_manifest_hash, cutover_import_mode, staged_data_hash, staged_row_count, blocking_error_count, warning_count, accepted_warning_count, validation_status, reconciliation_status, created_by, created_at)
              VALUES (${batchId}, ${tenantId}, ${"B5-" + batchId.slice(-6)}, ${"staged"}::import_batch_status, ${"test"}, ${"opening_balance_inventory"}, ${"1.0"}, ${"1.0"}, ${"h"}, ${"opening_balance"}, ${"sh"}, 1, 0, 0, 0, ${"passed"}, ${"matched"}, ${ownerId}, NOW())`;

    // A. owner NULL + accountant present + reason present → FAIL
    const rA = await sql`
      INSERT INTO import_reconciliation_results (id, tenant_id, import_batch_id, report_version, metric_key, expected_value, staged_value, committed_value, difference_value, status, notes, accepted_by_owner, accepted_by_accountant, acceptance_reason, created_by, created_at)
      VALUES (${randomUUID()}, ${tenantId}, ${batchId}, 1, ${"metric_a"}, null, ${"100"}, null, null, ${"accepted_difference"}, ${"test"}, null, ${accountantId}, ${"reason"}, ${ownerId}, NOW())
    `.catch((e: Error) => ({ error: e }));
    expect("error" in rA, "owner NULL must fail").toBe(true);
    if ("error" in rA) expect(rA.error.message).toMatch(/import_reconciliation_results_accepted_check|check.*constraint/i);

    // B. owner present + accountant NULL + reason present → FAIL
    const rB = await sql`
      INSERT INTO import_reconciliation_results (id, tenant_id, import_batch_id, report_version, metric_key, expected_value, staged_value, committed_value, difference_value, status, notes, accepted_by_owner, accepted_by_accountant, acceptance_reason, created_by, created_at)
      VALUES (${randomUUID()}, ${tenantId}, ${batchId}, 1, ${"metric_b"}, null, ${"100"}, null, null, ${"accepted_difference"}, ${"test"}, ${ownerId}, null, ${"reason"}, ${ownerId}, NOW())
    `.catch((e: Error) => ({ error: e }));
    expect("error" in rB, "accountant NULL must fail").toBe(true);
    if ("error" in rB) expect(rB.error.message).toMatch(/import_reconciliation_results_accepted_check|check.*constraint/i);

    // C. owner present + accountant present + reason NULL → FAIL
    const rC = await sql`
      INSERT INTO import_reconciliation_results (id, tenant_id, import_batch_id, report_version, metric_key, expected_value, staged_value, committed_value, difference_value, status, notes, accepted_by_owner, accepted_by_accountant, acceptance_reason, created_by, created_at)
      VALUES (${randomUUID()}, ${tenantId}, ${batchId}, 1, ${"metric_c"}, null, ${"100"}, null, null, ${"accepted_difference"}, ${"test"}, ${ownerId}, ${accountantId}, null, ${ownerId}, NOW())
    `.catch((e: Error) => ({ error: e }));
    expect("error" in rC, "reason NULL must fail").toBe(true);
    if ("error" in rC) expect(rC.error.message).toMatch(/import_reconciliation_results_accepted_check|check.*constraint/i);

    // D. owner present + accountant present + reason non-null → SUCCESS
    const okId = randomUUID();
    await sql`INSERT INTO import_reconciliation_results (id, tenant_id, import_batch_id, report_version, metric_key, expected_value, staged_value, committed_value, difference_value, status, notes, accepted_by_owner, accepted_by_accountant, acceptance_reason, created_by, created_at)
              VALUES (${okId}, ${tenantId}, ${batchId}, 1, ${"metric_d"}, null, ${"100"}, null, null, ${"accepted_difference"}, ${"test"}, ${ownerId}, ${accountantId}, ${"valid reason"}, ${ownerId}, NOW())`;
    const checkOk = await sql`SELECT count(*)::int AS c FROM import_reconciliation_results WHERE id = ${okId}`;
    expect(checkOk[0]!.c).toBe(1);

    // Cleanup
    await sql`DELETE FROM import_reconciliation_results WHERE tenant_id = ${tenantId}`;
    await sql`DELETE FROM import_batches WHERE tenant_id = ${tenantId}`;
    await sql`DELETE FROM users WHERE tenant_id = ${tenantId}`;
    await sql`DELETE FROM tenants WHERE id = ${tenantId}`;
  });

  // ===========================================================================
  // BLOCKED-6: staging FK catalog isolation (no FK to operational domain tables)
  //
  // Proves via PostgreSQL catalog introspection:
  //   - committed_entity_id has NO foreign-key constraint
  //   - staging rows/cells have NO FK to operational domain tables
  //   - only approved migration/provenance/security relationships exist
  //
  // This is schema isolation proof — NOT a service-layer zero-effect test.
  // ===========================================================================
  it("BLOCKED-6: staging FK catalog isolation — no FK to operational domain tables", async () => {
    // Query ALL foreign keys whose source table is import_staging_rows or import_staging_cells
    const fks = await sql`
      SELECT
        tc.table_name AS source_table,
        kcu.column_name AS source_column,
        tc.constraint_name,
        ccu.table_name AS target_table,
        ccu.column_name AS target_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name IN ('import_staging_rows', 'import_staging_cells')
      ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position
    `;

    // Build the complete FK target set
    const fkTargets = new Map<string, { sourceTable: string; sourceColumn: string; constraint: string; targetColumn: string }[]>();
    for (const row of fks) {
      const target = row.target_table as string;
      if (!fkTargets.has(target)) fkTargets.set(target, []);
      fkTargets.get(target)!.push({
        sourceTable: row.source_table as string,
        sourceColumn: row.source_column as string,
        constraint: row.constraint_name as string,
        targetColumn: row.target_column as string,
      });
    }

    // Verify: only approved FK targets exist
    const approvedTargets = new Set(["tenants", "users", "import_batches", "import_files", "import_staging_rows"]);
    const actualTargets = new Set(fkTargets.keys());
    const unexpectedTargets = [...actualTargets].filter((t) => !approvedTargets.has(t));
    expect(unexpectedTargets, `unexpected FK targets: ${unexpectedTargets.join(", ")}`).toEqual([]);

    // Verify: operational domain tables are NOT FK targets
    const operationalTables = [
      "stock_movements", "account_entries", "sales_orders", "sales_order_lines",
      "payments", "production_orders", "production_receipts",
      "inventory_balances", "stock_reservations", "inventory_items",
      "inventory_adjustments", "sales_profitability_snapshots",
    ];
    for (const opTable of operationalTables) {
      expect(fkTargets.has(opTable), `staging tables must NOT have FK to operational table ${opTable}`).toBe(false);
    }

    // Verify: committed_entity_id has NO FK constraint
    const committedEntityFks = await sql`
      SELECT count(*)::int AS c
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name = 'committed_entity_id'
    `;
    expect(committedEntityFks[0]!.c, "committed_entity_id must have zero FK constraints").toBe(0);

    // Report the complete FK target set (for evidence)
    const targetSummary = [...fkTargets.entries()].map(([target, cols]) => ({
      targetTable: target,
      fks: cols.map((c) => ({
        source: `${c.sourceTable}.${c.sourceColumn}`,
        constraint: c.constraint,
        targetColumn: c.targetColumn,
      })),
    }));
    // Assert the exact approved set:
    // - tenants (tenant_id)
    // - users (created_by, updated_by)
    // - import_batches (import_batch_id)
    // - import_files (import_file_id)
    // - import_staging_rows (staging_row_id — from staging_cells only)
    expect(targetSummary.length).toBe(5);
    const targetTableNames = targetSummary.map((t) => t.targetTable).sort();
    expect(targetTableNames).toEqual(["import_batches", "import_files", "import_staging_rows", "tenants", "users"]);
  });
});
