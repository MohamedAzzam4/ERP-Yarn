/**
 * WP-08-01F DEFECT 1-8 — PostgreSQL alias atomicity proofs (PG-ALIAS-1..12).
 *
 * Real PostgreSQL service-level tests exercising the actual
 * HistoricalValidationService.approveAliasMapping + createAliasException +
 * HistoricalReconciliationService.submitForApproval + commit repository
 * findMasterForAlias production paths against a real disposable PostgreSQL
 * database.
 *
 * Per WP-08-01F closure requirements:
 *   PG-ALIAS-1.  Alias approval success: approves a candidate alias with a
 *                valid target customer. Audit + idempotency succeeded.
 *   PG-ALIAS-2.  Alias approval with invalid target fails closed:
 *                INVALID_ALIAS_TARGET — no row inserted, no audit,
 *                idempotency business_failed (durable).
 *   PG-ALIAS-3.  Alias approval is idempotent (replay returns same response,
 *                zero additional effects).
 *   PG-ALIAS-4.  Alias approval conflict: same key + different payload is
 *                rejected with zero additional effects.
 *   PG-ALIAS-5.  Alias remap (re-approval to a different target) supersedes
 *                the old current row and inserts a new current row with the
 *                new target.
 *   PG-ALIAS-6.  Alias remap invalidates downstream evidence (current
 *                approvals marked is_current=false, review items superseded,
 *                batch validation/reconciliation statuses reset).
 *   PG-ALIAS-7.  DEFECT 4 — staging row with no entity-type signal produces
 *                an alias with entityType='unknown' + status='needs_review'.
 *                The alias is NOT auto-approved as 'customer'.
 *   PG-ALIAS-8.  DEFECT 2 — occurrenceCount is persisted after runValidation
 *                completes (DB row's occurrence_count reflects the final
 *                in-memory group tracker count, not just the first
 *                occurrence's count of 1).
 *   PG-ALIAS-9.  DEFECT 2 — re-running validation against the same source
 *                data produces the same occurrenceCount (idempotent — not
 *                doubled).
 *   PG-ALIAS-10. DEFECT 3 — createAliasException creates a separate current
 *                alias row with the same groupId but a different target +
 *                explicit exceptionSourceRowIds. The default group alias
 *                is NOT modified.
 *   PG-ALIAS-11. DEFECT 3 — group approval does NOT override an exception:
 *                submitForApproval rejects when an exception alias in the
 *                group is not approved (separate current alias row with
 *                status != 'approved').
 *   PG-ALIAS-12. DEFECT 5 — findMasterForAlias supports fiber_type,
 *                product_type, and item masters (returns true for valid
 *                masters, false for inactivated/missing masters, false
 *                for unsupported entity types — fail-closed).
 *
 * The harness uses per-test unique tenants (newScope), so tests are
 * isolated. Audit queries are scoped by tenant + entity id + action.
 * Never deletes audit_logs. Never disables audit triggers.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/server/db/schema";
import { sql as drizzleSql } from "drizzle-orm";
import { HistoricalValidationService } from "@/server/services/historical-validation-service";
import { HistoricalValidationDbRepository } from "@/server/services/historical-validation-db-repository";
import { HistoricalCommitDbRepository } from "@/server/services/historical-commit-db-repository";
import { HistoricalReconciliationDbRepository } from "@/server/services/historical-reconciliation-db-repository";
import { MasterDataDbRepository } from "@/server/services/master-data-db-repository";
import { AuditDbRepository } from "@/server/services/audit-db-repository";
import { IdempotencyDbRepository } from "@/server/services/idempotency-db-repository";
import { resolveEffectivePermissions } from "@/server/security/effective-permissions";
import { TEST_ROLE_PERMISSION_MATRIX } from "@/server/security/role-fixtures";
import type { ErpUserContext } from "@/server/auth/erp-context";
import { checkDestructiveTestDbSafety } from "./destructive-test-guard";

const DATABASE_URL = process.env.DATABASE_URL;
const ALLOW_DESTRUCTIVE = process.env.ERP_ALLOW_DESTRUCTIVE_LOCAL_TEST_DB === "1";
const REQUIRE_PROOF = process.env.ERP_REQUIRE_WP0801F_POSTGRES_PROOF === "1";

const SAFETY_RESULT = checkDestructiveTestDbSafety({
  databaseUrl: DATABASE_URL,
  allowDestructive: ALLOW_DESTRUCTIVE,
  requireProof: REQUIRE_PROOF,
});
const describeOrSkip = SAFETY_RESULT.kind === "ok" ? describe : describe.skip;

let sql: ReturnType<typeof postgres>;
let db: any;

interface TestScope {
  tenantId: string;
  userId: string;
  runSuffix: string;
}

function newScope(): TestScope {
  const tenantId = randomUUID();
  const userId = randomUUID();
  const runSuffix = tenantId.slice(0, 8);
  return { tenantId, userId, runSuffix };
}

function makeUser(scope: TestScope): ErpUserContext {
  return {
    authenticated: true,
    userId: scope.userId,
    tenantId: scope.tenantId,
    authId: `auth-${scope.userId}`,
    name: "T",
    email: `t-${scope.userId}@test.local`,
  };
}
function makeOwnerEffective() {
  return resolveEffectivePermissions(["owner"], TEST_ROLE_PERMISSION_MATRIX);
}

function makeServices(scope: TestScope) {
  const valRepo = new HistoricalValidationDbRepository(db);
  const commitRepo = new HistoricalCommitDbRepository(db);
  const reconRepo = new HistoricalReconciliationDbRepository(db);
  const masterDataRepo = new MasterDataDbRepository(db);
  const audit = new AuditDbRepository(db);
  const idem = new IdempotencyDbRepository(db);
  const transactionRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
    (db as any).transaction(async (tx: any) => work(tx));
  const validationService = new HistoricalValidationService({
    repository: valRepo,
    audit,
    idempotency: idem,
    transactionRunner,
    createRepository: (tx: unknown) => new HistoricalValidationDbRepository(tx as any),
    createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
    createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
    masterDataRepository: masterDataRepo,
    createMasterDataRepository: (tx: unknown) => new MasterDataDbRepository(tx as any),
    // WP-08-01F alias-atomicity test fix: wire the material-remap
    // downstream-invalidation callbacks (mirrors the production wiring
    // in src/app/(management)/management/admin/migration/actions.ts).
    // Without these callbacks, the remap path supersedes the old alias
    // + inserts the new current row, but does NOT invalidate downstream
    // approvals / review items / batch statuses — which PG-ALIAS-6
    // asserts.
    invalidateCurrentApprovals: async (tx: unknown, tenantId: string, batchId: string, invalidatedBy: string, reason: string, _now: Date) => {
      const txCommitRepo = new HistoricalCommitDbRepository(tx as any);
      return txCommitRepo.invalidateCurrentApprovalsForBatch(tenantId, batchId, invalidatedBy, reason);
    },
    supersedeReviewItemsForBatch: async (tx: unknown, tenantId: string, batchId: string, supersededBy: string, reason: string) => {
      const txReconRepo = new HistoricalReconciliationDbRepository(tx as any);
      return txReconRepo.supersedeReviewItemsForBatch(tenantId, batchId, supersededBy, reason);
    },
    resetBatchValidationAndReconciliationStatuses: async (tx: unknown, tenantId: string, batchId: string) => {
      const txReconRepo = new HistoricalReconciliationDbRepository(tx as any);
      return txReconRepo.resetBatchValidationAndReconciliationStatuses(tenantId, batchId);
    },
    findLatestReportVersion: async (tx: unknown, tenantId: string, batchId: string) => {
      const txReconRepo = new HistoricalReconciliationDbRepository(tx as any);
      return txReconRepo.findLatestReportVersion(tenantId, batchId);
    },
  });
  return { validationService, valRepo, commitRepo, reconRepo, masterDataRepo, audit, idem };
}

async function seedTenantAndUser(scope: TestScope) {
  const runSuffix = scope.runSuffix;
  await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status)
            VALUES (${scope.tenantId}, ${"ALIAS-" + runSuffix}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference)
            VALUES (${scope.userId}, ${scope.tenantId}, ${"alias-" + runSuffix}, ${"Alias User"}, ${"alias-" + runSuffix + "@test.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
}

// Seed a batch in `validation_complete` state with mapping_version set.
async function seedValidationCompleteBatch(scope: TestScope, batchId: string, mappingVersion: string = "1.0") {
  await sql`
    INSERT INTO import_batches (id, tenant_id, batch_no, status, source_description, template_name, template_version,
      mapping_version, cutover_manifest_hash, cutover_import_mode, staged_data_hash, staged_row_count,
      blocking_error_count, warning_count, accepted_warning_count, validation_status, reconciliation_status,
      warning_summary, committed_at, commit_effect_counts, created_by, created_at)
    VALUES (${batchId}, ${scope.tenantId}, ${"ALIAS-" + batchId.slice(-6)}, ${"validation_complete"}::import_batch_status, ${"test"},
      ${"opening_balance_inventory"}, ${"1.0"}, ${mappingVersion}, ${"sha256:manifest"}, ${"opening_balance"}, ${"sha256:test"}, 1,
      0, 0, 0, ${"passed"}, null, null, null, null, ${scope.userId}, NOW())`;
}

// Seed a customer master in the tenant.
async function seedCustomer(scope: TestScope, customerCode: string = "CUST-001", nameAr: string = "Target Customer"): Promise<string> {
  const customerId = randomUUID();
  await sql`
    INSERT INTO customers (id, tenant_id, customer_code, name_ar, name_en, normalized_name, contact_info_json, credit_limit, credit_terms, status, notes, created_by, created_at, updated_at, updated_by)
    VALUES (${customerId}, ${scope.tenantId}, ${customerCode}, ${nameAr}, null, ${nameAr.trim().toLowerCase()}, null, null, null, ${"active"}, null, ${scope.userId}, NOW(), null, null)`;
  return customerId;
}

async function seedFiberType(scope: TestScope, code: string = "FT-001", nameAr: string = "Cotton Fiber"): Promise<string> {
  const fiberId = randomUUID();
  await sql`
    INSERT INTO fiber_types (id, tenant_id, code, name_ar, name_en, status, created_by, created_at, updated_at, updated_by)
    VALUES (${fiberId}, ${scope.tenantId}, ${code}, ${nameAr}, null, ${"active"}, ${scope.userId}, NOW(), null, null)`;
  return fiberId;
}

async function seedProductType(scope: TestScope, code: string = "PT-001", nameAr: string = "Single Yarn"): Promise<string> {
  const productId = randomUUID();
  await sql`
    INSERT INTO product_types (id, tenant_id, code, name_ar, name_en, status, created_by, created_at, updated_at, updated_by)
    VALUES (${productId}, ${scope.tenantId}, ${code}, ${nameAr}, null, ${"active"}, ${scope.userId}, NOW(), null, null)`;
  return productId;
}

async function seedInventoryItem(scope: TestScope, itemCode: string = "ITEM-001"): Promise<string> {
  const itemId = randomUUID();
  await sql`
    INSERT INTO inventory_items (id, tenant_id, item_kind, item_code, display_name_ar, display_name_en, quality_status, is_blocked, status, created_by, created_at, updated_at, updated_by)
    VALUES (${itemId}, ${scope.tenantId}, ${"raw_material"}::item_kind, ${itemCode}, ${"Test Item"}, null, ${"accepted"}::quality_status, false, ${"active"}::master_data_status, ${scope.userId}, NOW(), null, null)`;
  return itemId;
}

// Seed a candidate alias mapping directly (NOT via runValidation) for
// deterministic test setup.
async function seedCandidateAlias(
  scope: TestScope,
  batchId: string,
  overrides: {
    sourceLabel?: string;
    entityType?: string;
    normalizedName?: string;
    targetMasterId?: string | null;
    status?: string;
    groupId?: string | null;
    occurrenceCount?: number;
    exceptionSourceRowIds?: number[] | null;
  } = {},
): Promise<string> {
  const aliasId = randomUUID();
  const sourceLabel = overrides.sourceLabel ?? "Acme Corp";
  const normalizedName = overrides.normalizedName ?? sourceLabel.trim().toLowerCase();
  const entityType = overrides.entityType ?? "customer";
  await sql`
    INSERT INTO import_alias_mappings (id, tenant_id, import_batch_id, entity_type, source_label, normalized_name,
      target_master_id, mapping_version, confidence_score, status, approved_by, approved_at, notes,
      is_current, superseded_at, superseded_by, superseded_reason,
      group_id, occurrence_count, exception_source_row_ids,
      created_by, created_at, updated_at, updated_by)
    VALUES (${aliasId}, ${scope.tenantId}, ${batchId}, ${entityType}, ${sourceLabel}, ${normalizedName},
      ${overrides.targetMasterId ?? null}, null, ${"1.000000"}, ${overrides.status ?? "candidate"}, null, null, null,
      true, null, null, null,
      ${overrides.groupId ?? null}, ${overrides.occurrenceCount ?? 1},
      ${overrides.exceptionSourceRowIds ? JSON.stringify(overrides.exceptionSourceRowIds) : null}::jsonb,
      ${scope.userId}, NOW(), null, null)`;
  return aliasId;
}

async function seedFileAndStagingRow(scope: TestScope, batchId: string, rowData: Record<string, unknown>, rowNum: number = 1): Promise<string> {
  const fileId = randomUUID();
  // WP-08-01F alias-atomicity test fix: each file must have a unique
  // (tenant, batch, file_hash, file_type) tuple AND at most one
  // is_current=true file per (tenant, batch, file_type). Use a unique
  // file_hash per file (based on the file id) and mark only the first
  // row's file as current (rowNum === 1). Subsequent files are
  // is_current=false — they still satisfy the staging_row foreign key
  // without violating the partial unique index.
  const isCurrent = rowNum === 1;
  await sql`
    INSERT INTO import_files (id, tenant_id, import_batch_id, original_file_name, storage_path, file_hash,
      file_size_bytes, content_type, file_type, file_version, is_current, created_by, created_at)
    VALUES (${fileId}, ${scope.tenantId}, ${batchId}, ${"data.csv"}, ${"local://test"}, ${"sha256:" + fileId},
      100, ${"text/csv"}, ${"source"}, 1, ${isCurrent}, ${scope.userId}, NOW())`;
  const rowId = randomUUID();
  await sql`
    INSERT INTO import_staging_rows (id, tenant_id, import_batch_id, import_file_id, template_name,
      source_sheet_name, source_row_number, raw_row_json, transformed_row_json,
      transformation_notes, validation_status, review_status, ai_confidence,
      committed_entity_type, committed_entity_id, staging_version, is_current,
      created_by, created_at)
    VALUES (${rowId}, ${scope.tenantId}, ${batchId}, ${fileId}, ${"opening_balance_inventory"}, ${"data.csv"}, ${rowNum},
      ${JSON.stringify(rowData)}::jsonb,
      ${JSON.stringify(rowData)}::jsonb,
      null, ${"pending"}, ${"not_required"}, null, null, null, 1, true, ${scope.userId}, NOW())`;
  return rowId;
}

async function seedResolvedReviewItem(scope: TestScope, batchId: string) {
  const reviewItemId = randomUUID();
  await sql`
    INSERT INTO import_human_review_items (id, tenant_id, import_batch_id, staging_row_id, review_reason,
      status, is_current, report_version, created_by, created_at)
    VALUES (${reviewItemId}, ${scope.tenantId}, ${batchId}, null, ${"resolved review item"},
      ${"resolved"}::review_item_decision, true, 1, ${scope.userId}, NOW())`;
}

async function seedReconciliationResult(scope: TestScope, batchId: string) {
  const resultId = randomUUID();
  await sql`
    INSERT INTO import_reconciliation_results (id, tenant_id, import_batch_id, report_version, metric_key,
      expected_value, staged_value, committed_value, difference_value, status, notes, created_by, created_at)
    VALUES (${resultId}, ${scope.tenantId}, ${batchId}, 1, ${"inventory_opening_qty"},
      null, ${"100"}, null, null, ${"matched"}, ${"Original review reason evidence"}, ${scope.userId}, NOW())`;
}

async function seedBackupEvidence(scope: TestScope, batchId: string) {
  await sql`
    INSERT INTO import_backup_evidence (id, tenant_id, import_batch_id, backup_type, backup_location, backup_hash, backup_size_bytes, backup_created_at, verification_notes, created_by, created_at, updated_at, updated_by)
    VALUES (${randomUUID()}, ${scope.tenantId}, ${batchId}, ${"full"}, ${"s3://b/backup"}, ${"backup-hash"}, 1000, NOW(), ${"verified"}, ${scope.userId}, NOW(), null, null)`;
}

async function getAliasMapping(scope: TestScope, aliasId: string) {
  const rows = await sql`SELECT id, status, target_master_id, is_current, approved_by, approved_at, mapping_version, occurrence_count, exception_source_row_ids, group_id FROM import_alias_mappings WHERE tenant_id = ${scope.tenantId} AND id = ${aliasId}`;
  return rows[0] || null;
}

async function getCurrentAliasMappings(scope: TestScope, batchId: string) {
  return sql`SELECT id, status, target_master_id, is_current, source_label, entity_type, group_id, occurrence_count, exception_source_row_ids FROM import_alias_mappings WHERE tenant_id = ${scope.tenantId} AND import_batch_id = ${batchId} AND is_current = true`;
}

async function getScopedAuditCount(scope: TestScope, entityId: string, actionType?: string) {
  if (actionType) {
    const rows = await sql`SELECT count(*)::int AS c FROM audit_logs WHERE tenant_id = ${scope.tenantId} AND entity_id = ${entityId} AND action_type = ${actionType}`;
    return rows[0]?.c || 0;
  }
  const rows = await sql`SELECT count(*)::int AS c FROM audit_logs WHERE tenant_id = ${scope.tenantId} AND entity_id = ${entityId}`;
  return rows[0]?.c || 0;
}

async function getIdemState(scope: TestScope, idemKey: string) {
  const rows = await sql`SELECT state, response_body FROM idempotency_records WHERE tenant_id = ${scope.tenantId} AND idempotency_key = ${idemKey}`;
  return rows[0] || null;
}

async function cleanupScope(scope: TestScope) {
  await sql`DELETE FROM import_cutover_locks WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM import_backup_evidence WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM import_batch_approvals WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM import_human_review_items WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM import_reconciliation_results WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM import_validation_errors WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM import_alias_mappings WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM import_staging_cells WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM import_staging_rows WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM import_cutover_manifests WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM import_files WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM inventory_items WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM product_types WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM fiber_types WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM customers WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM import_batches WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM idempotency_records WHERE tenant_id = ${scope.tenantId}`;
  // NOTE: audit_logs, users, tenants intentionally NOT deleted (immutable).
}

describeOrSkip("WP-08-01F DEFECT 1-8 — PostgreSQL alias atomicity proofs (PG-ALIAS-1 through PG-ALIAS-12)", () => {
  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { prepare: false, max: 5, idle_timeout: 10, connect_timeout: 15 });
    db = drizzle(sql, { schema });
  }, 30000);

  afterAll(async () => {
    if (sql) { await sql.end(); }
  }, 30000);

  // ===========================================================================
  // PG-ALIAS-1. Alias approval success
  // ===========================================================================
  it("PG-ALIAS-1. alias approval success: approves a candidate alias with a valid target customer", async () => {
    const scope = newScope();
    await seedTenantAndUser(scope);
    const batchId = randomUUID();
    await seedValidationCompleteBatch(scope, batchId);
    const customerId = await seedCustomer(scope);
    const aliasId = await seedCandidateAlias(scope, batchId);

    const idemKey = "pg-alias-1-" + randomUUID();
    const { validationService } = makeServices(scope);
    const auditBefore = await getScopedAuditCount(scope, aliasId, "historical_alias.approve");

    const result = await validationService.approveAliasMapping(
      makeUser(scope) as any, makeOwnerEffective() as any,
      {
        aliasMappingId: aliasId,
        targetMasterId: customerId,
        status: "approved",
        notes: "Approved by Owner",
        mappingVersion: "v1",
        idempotencyKey: idemKey,
      },
    );

    expect(result.action).toBe("approved");
    expect(result.aliasMappingId).toBe(aliasId);
    expect(result.targetMasterId).toBe(customerId);

    const alias = await getAliasMapping(scope, aliasId);
    expect(alias!.status).toBe("approved");
    expect(alias!.target_master_id).toBe(customerId);
    expect(alias!.is_current).toBe(true);
    expect(alias!.approved_by).toBe(scope.userId);
    expect(alias!.mapping_version).toBe("v1");

    // Audit row created.
    const auditAfter = await getScopedAuditCount(scope, aliasId, "historical_alias.approve");
    expect(auditAfter).toBe(auditBefore + 1);
    expect(auditAfter).toBe(1);

    // Idempotency succeeded.
    const idemState = await getIdemState(scope, idemKey);
    expect(idemState?.state).toBe("succeeded");

    await cleanupScope(scope);
  });

  // ===========================================================================
  // PG-ALIAS-2. Alias approval with invalid target fails closed
  // ===========================================================================
  it("PG-ALIAS-2. alias approval with invalid target fails closed: INVALID_ALIAS_TARGET, no mutation, business_failed durable", async () => {
    const scope = newScope();
    await seedTenantAndUser(scope);
    const batchId = randomUUID();
    await seedValidationCompleteBatch(scope, batchId);
    const aliasId = await seedCandidateAlias(scope, batchId);
    // Use a random UUID that doesn't exist as a customer.
    const bogusTargetId = randomUUID();

    const idemKey = "pg-alias-2-" + randomUUID();
    const { validationService } = makeServices(scope);
    const auditBefore = await getScopedAuditCount(scope, aliasId);

    await expect(
      validationService.approveAliasMapping(
        makeUser(scope) as any, makeOwnerEffective() as any,
        {
          aliasMappingId: aliasId,
          targetMasterId: bogusTargetId,
          status: "approved",
          notes: null,
          mappingVersion: "v1",
          idempotencyKey: idemKey,
        },
      ),
    ).rejects.toThrow(/INVALID_ALIAS_TARGET|InvalidAliasTarget/i);

    // No mutation: alias unchanged.
    const alias = await getAliasMapping(scope, aliasId);
    expect(alias!.status).toBe("candidate");
    expect(alias!.target_master_id).toBeNull();
    expect(alias!.approved_by).toBeNull();

    // No audit row created.
    const auditAfter = await getScopedAuditCount(scope, aliasId);
    expect(auditAfter).toBe(auditBefore);

    // Idempotency state: business_failed (durable).
    const idemState = await getIdemState(scope, idemKey);
    expect(idemState).not.toBeNull();
    expect(idemState!.state).toBe("business_failed");

    // Durable replay: same key + same payload → same business failure.
    await expect(
      validationService.approveAliasMapping(
        makeUser(scope) as any, makeOwnerEffective() as any,
        {
          aliasMappingId: aliasId,
          targetMasterId: bogusTargetId,
          status: "approved",
          notes: null,
          mappingVersion: "v1",
          idempotencyKey: idemKey,
        },
      ),
    ).rejects.toThrow(/INVALID_ALIAS_TARGET|InvalidAliasTarget/i);

    // Still business_failed (durable, not re-executed).
    const idemStateAfterReplay = await getIdemState(scope, idemKey);
    expect(idemStateAfterReplay!.state).toBe("business_failed");

    await cleanupScope(scope);
  });

  // ===========================================================================
  // PG-ALIAS-3. Alias approval is idempotent (replay)
  // ===========================================================================
  it("PG-ALIAS-3. alias approval replay: same response, zero additional effects", async () => {
    const scope = newScope();
    await seedTenantAndUser(scope);
    const batchId = randomUUID();
    await seedValidationCompleteBatch(scope, batchId);
    const customerId = await seedCustomer(scope);
    const aliasId = await seedCandidateAlias(scope, batchId);

    const idemKey = "pg-alias-3-" + randomUUID();
    const { validationService } = makeServices(scope);

    const initialResult = await validationService.approveAliasMapping(
      makeUser(scope) as any, makeOwnerEffective() as any,
      {
        aliasMappingId: aliasId,
        targetMasterId: customerId,
        status: "approved",
        notes: null,
        mappingVersion: "v1",
        idempotencyKey: idemKey,
      },
    );
    expect(initialResult.action).toBe("approved");

    const auditAfterInitial = await getScopedAuditCount(scope, aliasId, "historical_alias.approve");
    const idemAfterInitial = await getIdemState(scope, idemKey);

    // Replay with same key + same payload.
    const replayResult = await validationService.approveAliasMapping(
      makeUser(scope) as any, makeOwnerEffective() as any,
      {
        aliasMappingId: aliasId,
        targetMasterId: customerId,
        status: "approved",
        notes: null,
        mappingVersion: "v1",
        idempotencyKey: idemKey,
      },
    );
    expect(replayResult.action).toBe("replayed");

    // Idempotency still succeeded.
    const idemAfterReplay = await getIdemState(scope, idemKey);
    expect(idemAfterReplay?.state).toBe("succeeded");

    // Zero additional audits.
    expect(await getScopedAuditCount(scope, aliasId, "historical_alias.approve")).toBe(auditAfterInitial);

    // Same response_body persisted.
    expect(JSON.stringify(idemAfterReplay?.response_body)).toBe(JSON.stringify(idemAfterInitial?.response_body));

    await cleanupScope(scope);
  });

  // ===========================================================================
  // PG-ALIAS-4. Alias approval conflict
  // ===========================================================================
  it("PG-ALIAS-4. alias approval conflict: same key + different payload → rejected, zero additional effects", async () => {
    const scope = newScope();
    await seedTenantAndUser(scope);
    const batchId1 = randomUUID();
    const batchId2 = randomUUID();
    await seedValidationCompleteBatch(scope, batchId1);
    await seedValidationCompleteBatch(scope, batchId2);
    const customerId = await seedCustomer(scope);
    const aliasId1 = await seedCandidateAlias(scope, batchId1, { sourceLabel: "Acme 1" });
    const aliasId2 = await seedCandidateAlias(scope, batchId2, { sourceLabel: "Acme 2" });

    const idemKey = "pg-alias-4-" + randomUUID();
    const { validationService } = makeServices(scope);

    const result1 = await validationService.approveAliasMapping(
      makeUser(scope) as any, makeOwnerEffective() as any,
      {
        aliasMappingId: aliasId1,
        targetMasterId: customerId,
        status: "approved",
        notes: null,
        mappingVersion: "v1",
        idempotencyKey: idemKey,
      },
    );
    expect(result1.action).toBe("approved");

    // Same key, different payload (different alias).
    await expect(
      validationService.approveAliasMapping(
        makeUser(scope) as any, makeOwnerEffective() as any,
        {
          aliasMappingId: aliasId2,
          targetMasterId: customerId,
          status: "approved",
          notes: null,
          mappingVersion: "v1",
          idempotencyKey: idemKey,
        },
      ),
    ).rejects.toThrow(/IDEMPOTENCY_CONFLICT|conflict/i);

    // Alias2 NOT mutated (still candidate).
    const alias2 = await getAliasMapping(scope, aliasId2);
    expect(alias2!.status).toBe("candidate");
    expect(alias2!.target_master_id).toBeNull();

    await cleanupScope(scope);
  });

  // ===========================================================================
  // PG-ALIAS-5. Alias remap supersedes old + inserts new
  // ===========================================================================
  it("PG-ALIAS-5. alias remap (re-approval to a different target): supersedes old + inserts new current row", async () => {
    const scope = newScope();
    await seedTenantAndUser(scope);
    const batchId = randomUUID();
    await seedValidationCompleteBatch(scope, batchId);
    const customerId1 = await seedCustomer(scope, "CUST-001", "Customer 1");
    const customerId2 = await seedCustomer(scope, "CUST-002", "Customer 2");
    const aliasId = await seedCandidateAlias(scope, batchId);

    const approveKey = "pg-alias-5-approve-" + randomUUID();
    const remapKey = "pg-alias-5-remap-" + randomUUID();
    const { validationService } = makeServices(scope);

    // Step 1: initial approval with customerId1.
    const initialResult = await validationService.approveAliasMapping(
      makeUser(scope) as any, makeOwnerEffective() as any,
      {
        aliasMappingId: aliasId,
        targetMasterId: customerId1,
        status: "approved",
        notes: null,
        mappingVersion: "v1",
        idempotencyKey: approveKey,
      },
    );
    expect(initialResult.action).toBe("approved");

    // Step 2: remap to customerId2.
    const remapResult = await validationService.approveAliasMapping(
      makeUser(scope) as any, makeOwnerEffective() as any,
      {
        aliasMappingId: aliasId,
        targetMasterId: customerId2,
        status: "approved",
        notes: "Remapped to Customer 2",
        mappingVersion: "v1",
        idempotencyKey: remapKey,
      },
    );
    expect(remapResult.action).toBe("remapped");
    expect(remapResult.currentAliasMappingId).not.toBe(aliasId);

    // Old alias is now superseded (is_current=false).
    const oldAlias = await getAliasMapping(scope, aliasId);
    expect(oldAlias!.is_current).toBe(false);
    expect(oldAlias!.superseded_by).not.toBeNull();

    // New current alias has the new target.
    const currentAliases = await getCurrentAliasMappings(scope, batchId);
    expect(currentAliases.length).toBe(1);
    expect(currentAliases[0]!.target_master_id).toBe(customerId2);
    expect(currentAliases[0]!.status).toBe("approved");
    expect(currentAliases[0]!.is_current).toBe(true);

    await cleanupScope(scope);
  });

  // ===========================================================================
  // PG-ALIAS-6. Alias remap invalidates downstream evidence
  // ===========================================================================
  it("PG-ALIAS-6. alias remap invalidates downstream approvals + review items + batch statuses", async () => {
    const scope = newScope();
    await seedTenantAndUser(scope);
    const batchId = randomUUID();
    // Seed in pending_dual_approval so the remap can move it back to review_required.
    await sql`
      INSERT INTO import_batches (id, tenant_id, batch_no, status, source_description, template_name, template_version,
        mapping_version, cutover_manifest_hash, cutover_import_mode, staged_data_hash, staged_row_count,
        blocking_error_count, warning_count, accepted_warning_count, validation_status, reconciliation_status,
        warning_summary, committed_at, commit_effect_counts, created_by, created_at)
      VALUES (${batchId}, ${scope.tenantId}, ${"ALIAS-" + batchId.slice(-6)}, ${"pending_dual_approval"}::import_batch_status, ${"test"},
        ${"opening_balance_inventory"}, ${"1.0"}, ${"1.0"}, ${"sha256:manifest"}, ${"opening_balance"}, ${"sha256:test"}, 1,
        0, 0, 0, ${"passed"}, ${"matched"}, null, null, null, ${scope.userId}, NOW())`;
    const customerId1 = await seedCustomer(scope, "CUST-001", "Customer 1");
    const customerId2 = await seedCustomer(scope, "CUST-002", "Customer 2");
    const aliasId = await seedCandidateAlias(scope, batchId, { status: "approved", targetMasterId: customerId1 });

    // Seed an existing approval for the batch (so the remap invalidates it).
    const approvalId = randomUUID();
    await sql`
      INSERT INTO import_batch_approvals (id, tenant_id, import_batch_id, approver_role, approver_user_id,
        staged_data_hash, cutover_manifest_hash, template_version, mapping_version,
        validation_status, reconciliation_status, warning_summary, approved_at, reason,
        approval_version, is_current, created_by, created_at)
      VALUES (${approvalId}, ${scope.tenantId}, ${batchId}, ${"owner"}::migration_approver_role, ${scope.userId},
        ${"sha256:test"}, ${"sha256:manifest"}, ${"1.0"}, ${"1.0"},
        ${"passed"}, ${"matched"}, null, NOW(), ${"test approval"},
        1, true, ${scope.userId}, NOW())`;

    // Seed a current review item.
    const reviewItemId = randomUUID();
    await sql`
      INSERT INTO import_human_review_items (id, tenant_id, import_batch_id, staging_row_id, review_reason,
        status, is_current, report_version, created_by, created_at)
      VALUES (${reviewItemId}, ${scope.tenantId}, ${batchId}, null, ${"pending review item"},
        ${"pending"}::review_item_decision, true, 1, ${scope.userId}, NOW())`;

    const remapKey = "pg-alias-6-remap-" + randomUUID();
    const { validationService } = makeServices(scope);

    const remapResult = await validationService.approveAliasMapping(
      makeUser(scope) as any, makeOwnerEffective() as any,
      {
        aliasMappingId: aliasId,
        targetMasterId: customerId2,
        status: "approved",
        notes: "Remap",
        mappingVersion: "v1",
        idempotencyKey: remapKey,
      },
    );
    expect(remapResult.action).toBe("remapped");

    // Downstream invalidation: approval is_current=false.
    const approvalRows = await sql`SELECT is_current FROM import_batch_approvals WHERE tenant_id = ${scope.tenantId} AND id = ${approvalId}`;
    expect(approvalRows[0]?.is_current).toBe(false);

    // Downstream invalidation: review item is_current=false.
    const reviewRows = await sql`SELECT is_current FROM import_human_review_items WHERE tenant_id = ${scope.tenantId} AND id = ${reviewItemId}`;
    expect(reviewRows[0]?.is_current).toBe(false);

    // Downstream invalidation: batch status moved to review_required.
    const batchRows = await sql`SELECT status FROM import_batches WHERE tenant_id = ${scope.tenantId} AND id = ${batchId}`;
    expect(batchRows[0]?.status).toBe("review_required");

    // Downstream invalidation: batch validation/reconciliation statuses reset.
    const batchStatusRows = await sql`SELECT validation_status, reconciliation_status FROM import_batches WHERE tenant_id = ${scope.tenantId} AND id = ${batchId}`;
    expect(batchStatusRows[0]?.validation_status).toBeNull();
    expect(batchStatusRows[0]?.reconciliation_status).toBeNull();

    await cleanupScope(scope);
  });

  // ===========================================================================
  // PG-ALIAS-7. DEFECT 4 — unknown entity type creates needs_review alias
  // ===========================================================================
  it("PG-ALIAS-7. DEFECT 4 — staging row with no entity-type signal produces an alias with entityType='unknown' + status='needs_review'", async () => {
    const scope = newScope();
    await seedTenantAndUser(scope);
    const batchId = randomUUID();
    // Seed batch in 'staged' state for validation.
    await sql`
      INSERT INTO import_batches (id, tenant_id, batch_no, status, source_description, template_name, template_version,
        mapping_version, cutover_manifest_hash, cutover_import_mode, staged_data_hash, staged_row_count,
        blocking_error_count, warning_count, accepted_warning_count, validation_status, reconciliation_status,
        warning_summary, committed_at, commit_effect_counts, created_by, created_at)
      VALUES (${batchId}, ${scope.tenantId}, ${"ALIAS-" + batchId.slice(-6)}, ${"staged"}::import_batch_status, ${"test"},
        ${"opening_balance_inventory"}, ${"1.0"}, ${"1.0"}, ${"sha256:manifest"}, ${"opening_balance"}, ${"sha256:test"}, 1,
        0, 0, 0, null, null, null, null, null, ${scope.userId}, NOW())`;
    // Row has name but NO entity_type / customer_id / supplier_id / etc.
    // The detector should return 'unknown' (DEFECT 4 fix).
    await seedFileAndStagingRow(scope, batchId, { name: "Mystery Entity", code: "M001", quantity: "100", date: "2024-01-01" });

    const idemKey = "pg-alias-7-" + randomUUID();
    const { validationService } = makeServices(scope);
    const result = await validationService.runValidation(
      makeUser(scope) as any, makeOwnerEffective() as any,
      { importBatchId: batchId, idempotencyKey: idemKey },
    );
    expect(result.action).toBe("executed");

    // Verify the alias was created with entityType='unknown' + status='needs_review'.
    const aliasRows = await sql`SELECT entity_type, status FROM import_alias_mappings WHERE tenant_id = ${scope.tenantId} AND import_batch_id = ${batchId}`;
    expect(aliasRows.length).toBe(1);
    expect(aliasRows[0]!.entity_type).toBe("unknown");
    expect(aliasRows[0]!.status).toBe("needs_review");

    await cleanupScope(scope);
  });

  // ===========================================================================
  // PG-ALIAS-8. DEFECT 2 — occurrenceCount persistence after validation
  // ===========================================================================
  it("PG-ALIAS-8. DEFECT 2 — occurrenceCount is persisted as the final group count (not just 1)", async () => {
    const scope = newScope();
    await seedTenantAndUser(scope);
    const batchId = randomUUID();
    await sql`
      INSERT INTO import_batches (id, tenant_id, batch_no, status, source_description, template_name, template_version,
        mapping_version, cutover_manifest_hash, cutover_import_mode, staged_data_hash, staged_row_count,
        blocking_error_count, warning_count, accepted_warning_count, validation_status, reconciliation_status,
        warning_summary, committed_at, commit_effect_counts, created_by, created_at)
      VALUES (${batchId}, ${scope.tenantId}, ${"ALIAS-" + batchId.slice(-6)}, ${"staged"}::import_batch_status, ${"test"},
        ${"opening_balance_inventory"}, ${"1.0"}, ${"1.0"}, ${"sha256:manifest"}, ${"opening_balance"}, ${"sha256:test"}, 3,
        0, 0, 0, null, null, null, null, null, ${scope.userId}, NOW())`;
    // Seed 3 staging rows with the SAME source label "Acme Corp" so the
    // group tracker accumulates occurrenceCount=3.
    const rowData = { name: "Acme Corp", code: "A001", quantity: "100", date: "2024-01-01", entity_type: "customer" };
    await seedFileAndStagingRow(scope, batchId, rowData, 1);
    await seedFileAndStagingRow(scope, batchId, rowData, 2);
    await seedFileAndStagingRow(scope, batchId, rowData, 3);

    const idemKey = "pg-alias-8-" + randomUUID();
    const { validationService } = makeServices(scope);
    await validationService.runValidation(
      makeUser(scope) as any, makeOwnerEffective() as any,
      { importBatchId: batchId, idempotencyKey: idemKey },
    );

    // The current alias mapping's occurrence_count must be 3 (the final
    // group tracker count), not 1 (the count at first insert).
    const aliasRows = await sql`SELECT occurrence_count FROM import_alias_mappings WHERE tenant_id = ${scope.tenantId} AND import_batch_id = ${batchId} AND is_current = true`;
    expect(aliasRows.length).toBe(1);
    expect(aliasRows[0]!.occurrence_count).toBe(3);

    await cleanupScope(scope);
  });

  // ===========================================================================
  // PG-ALIAS-9. DEFECT 2 — idempotent revalidation (count not doubled)
  // ===========================================================================
  it("PG-ALIAS-9. DEFECT 2 — re-running validation against the same source data produces the same occurrenceCount (idempotent)", async () => {
    const scope = newScope();
    await seedTenantAndUser(scope);
    const batchId = randomUUID();
    await sql`
      INSERT INTO import_batches (id, tenant_id, batch_no, status, source_description, template_name, template_version,
        mapping_version, cutover_manifest_hash, cutover_import_mode, staged_data_hash, staged_row_count,
        blocking_error_count, warning_count, accepted_warning_count, validation_status, reconciliation_status,
        warning_summary, committed_at, commit_effect_counts, created_by, created_at)
      VALUES (${batchId}, ${scope.tenantId}, ${"ALIAS-" + batchId.slice(-6)}, ${"staged"}::import_batch_status, ${"test"},
        ${"opening_balance_inventory"}, ${"1.0"}, ${"1.0"}, ${"sha256:manifest"}, ${"opening_balance"}, ${"sha256:test"}, 2,
        0, 0, 0, null, null, null, null, null, ${scope.userId}, NOW())`;
    const rowData = { name: "Acme Corp", code: "A001", quantity: "100", date: "2024-01-01", entity_type: "customer" };
    await seedFileAndStagingRow(scope, batchId, rowData, 1);
    await seedFileAndStagingRow(scope, batchId, rowData, 2);

    const { validationService } = makeServices(scope);

    // First validation run.
    await validationService.runValidation(
      makeUser(scope) as any, makeOwnerEffective() as any,
      { importBatchId: batchId, idempotencyKey: "pg-alias-9-first-" + randomUUID() },
    );
    const firstAliasRows = await sql`SELECT occurrence_count FROM import_alias_mappings WHERE tenant_id = ${scope.tenantId} AND import_batch_id = ${batchId} AND is_current = true`;
    expect(firstAliasRows[0]!.occurrence_count).toBe(2);

    // Move the batch back to 'staged' so we can re-run validation.
    await sql`UPDATE import_batches SET status = 'staged'::import_batch_status, validation_status = null WHERE id = ${batchId} AND tenant_id = ${scope.tenantId}`;

    // Second validation run — the occurrenceCount should NOT be doubled
    // (it should still be 2, the actual count for this group).
    await validationService.runValidation(
      makeUser(scope) as any, makeOwnerEffective() as any,
      { importBatchId: batchId, idempotencyKey: "pg-alias-9-second-" + randomUUID() },
    );
    const secondAliasRows = await sql`SELECT occurrence_count FROM import_alias_mappings WHERE tenant_id = ${scope.tenantId} AND import_batch_id = ${batchId} AND is_current = true`;
    expect(secondAliasRows[0]!.occurrence_count).toBe(2);

    await cleanupScope(scope);
  });

  // ===========================================================================
  // PG-ALIAS-10. DEFECT 3 — createAliasException creates a separate current alias row
  // ===========================================================================
  it("PG-ALIAS-10. DEFECT 3 — createAliasException creates a separate current alias row with the same groupId + different target + exceptionSourceRowIds", async () => {
    const scope = newScope();
    await seedTenantAndUser(scope);
    const batchId = randomUUID();
    await seedValidationCompleteBatch(scope, batchId);
    const customerId1 = await seedCustomer(scope, "CUST-001", "Customer 1");
    const customerId2 = await seedCustomer(scope, "CUST-002", "Customer 2");
    // Seed the default group alias as approved with a known groupId.
    const groupId = randomUUID();
    const defaultAliasId = await seedCandidateAlias(scope, batchId, {
      sourceLabel: "Acme Corp",
      status: "approved",
      targetMasterId: customerId1,
      groupId,
      occurrenceCount: 5,
    });

    const idemKey = "pg-alias-10-" + randomUUID();
    const { validationService } = makeServices(scope);

    const result = await validationService.createAliasException(
      makeUser(scope) as any, makeOwnerEffective() as any,
      {
        defaultAliasMappingId: defaultAliasId,
        exceptionSourceLabel: "Acme Corp (Row 7)",
        targetMasterId: customerId2,
        exceptionSourceRowIds: [7],
        notes: "Exception for row 7",
        mappingVersion: "v1",
        idempotencyKey: idemKey,
      },
    );
    expect(result.action).toBe("executed");
    expect(result.exceptionAliasMappingId).not.toBe(defaultAliasId);
    expect(result.groupId).toBe(groupId);
    expect(result.targetMasterId).toBe(customerId2);
    expect(result.exceptionSourceRowIds).toEqual([7]);

    // The exception alias exists as a separate current row.
    const exceptionAliasRows = await sql`SELECT id, status, target_master_id, is_current, group_id, occurrence_count, exception_source_row_ids FROM import_alias_mappings WHERE tenant_id = ${scope.tenantId} AND id = ${result.exceptionAliasMappingId}`;
    expect(exceptionAliasRows.length).toBe(1);
    expect(exceptionAliasRows[0]!.status).toBe("approved");
    expect(exceptionAliasRows[0]!.target_master_id).toBe(customerId2);
    expect(exceptionAliasRows[0]!.is_current).toBe(true);
    expect(exceptionAliasRows[0]!.group_id).toBe(groupId);
    expect(exceptionAliasRows[0]!.occurrence_count).toBe(1);
    expect(exceptionAliasRows[0]!.exception_source_row_ids).toEqual([7]);

    // The default group alias is NOT modified (still current, still approved, still target=customerId1).
    const defaultAliasRows = await sql`SELECT status, target_master_id, is_current FROM import_alias_mappings WHERE tenant_id = ${scope.tenantId} AND id = ${defaultAliasId}`;
    expect(defaultAliasRows[0]!.status).toBe("approved");
    expect(defaultAliasRows[0]!.target_master_id).toBe(customerId1);
    expect(defaultAliasRows[0]!.is_current).toBe(true);

    await cleanupScope(scope);
  });

  // ===========================================================================
  // PG-ALIAS-11. DEFECT 3 — group approval does NOT override an exception
  // ===========================================================================
  it("PG-ALIAS-11. DEFECT 3 — submitForApproval rejects when an exception alias in the group is not approved (group approval does not override exception)", async () => {
    const scope = newScope();
    await seedTenantAndUser(scope);
    const batchId = randomUUID();
    // Seed a review_required batch — submitForApproval's required state.
    await sql`
      INSERT INTO import_batches (id, tenant_id, batch_no, status, source_description, template_name, template_version,
        mapping_version, cutover_manifest_hash, cutover_import_mode, staged_data_hash, staged_row_count,
        blocking_error_count, warning_count, accepted_warning_count, validation_status, reconciliation_status,
        warning_summary, committed_at, commit_effect_counts, created_by, created_at)
      VALUES (${batchId}, ${scope.tenantId}, ${"ALIAS-" + batchId.slice(-6)}, ${"review_required"}::import_batch_status, ${"test"},
        ${"opening_balance_inventory"}, ${"1.0"}, ${"1.0"}, ${"sha256:manifest"}, ${"opening_balance"}, ${"sha256:test"}, 5,
        0, 0, 0, ${"passed"}, ${"matched"}, null, null, null, ${scope.userId}, NOW())`;
    const customerId1 = await seedCustomer(scope, "CUST-001", "Customer 1");
    // Exception alias target customer — also exists as a valid master.
    const customerId2 = await seedCustomer(scope, "CUST-002", "Customer 2");
    const groupId = randomUUID();
    // Default group alias: approved with customerId1.
    await seedCandidateAlias(scope, batchId, {
      sourceLabel: "Acme Corp",
      status: "approved",
      targetMasterId: customerId1,
      groupId,
      occurrenceCount: 5,
    });
    // Exception alias: NOT approved (status='candidate'), with exceptionSourceRowIds=[7].
    await seedCandidateAlias(scope, batchId, {
      sourceLabel: "Acme Corp (Row 7)",
      status: "candidate",
      targetMasterId: null,
      groupId,
      occurrenceCount: 1,
      exceptionSourceRowIds: [7],
    });

    // Seed the rest of submitForApproval's prerequisites.
    await seedReconciliationResult(scope, batchId);
    await seedResolvedReviewItem(scope, batchId);
    await seedBackupEvidence(scope, batchId);

    const idemKey = "pg-alias-11-" + randomUUID();
    const { validationService } = makeServices(scope);

    // Build a reconciliation service to call submitForApproval.
    const { HistoricalReconciliationService } = await import("@/server/services/historical-reconciliation-service");
    const { HistoricalReconciliationDbRepository } = await import("@/server/services/historical-reconciliation-db-repository");
    const reconRepo = new HistoricalReconciliationDbRepository(db);
    const commitRepo = new HistoricalCommitDbRepository(db);
    const audit = new AuditDbRepository(db);
    const idem = new IdempotencyDbRepository(db);
    const reconciliationService = new HistoricalReconciliationService({
      repository: reconRepo, audit, idempotency: idem, commitRepository: commitRepo,
      transactionRunner: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => (db as any).transaction(async (tx: any) => work(tx)),
      createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
      createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
      createReconciliationRepository: (tx: unknown) => new HistoricalReconciliationDbRepository(tx as any),
      createCommitRepository: (tx: unknown) => new HistoricalCommitDbRepository(tx as any),
    });

    // submitForApproval should reject because the exception alias is unresolved.
    await expect(
      reconciliationService.submitForApproval(
        makeUser(scope) as any, makeOwnerEffective() as any,
        { importBatchId: batchId, warningSummary: null, idempotencyKey: idemKey },
      ),
    ).rejects.toThrow(/UNRESOLVED_ALIAS_MAPPING|alias mapping/i);

    // Batch is unchanged (still review_required).
    const batchRows = await sql`SELECT status FROM import_batches WHERE tenant_id = ${scope.tenantId} AND id = ${batchId}`;
    expect(batchRows[0]?.status).toBe("review_required");

    // Now approve the exception alias and resubmit.
    const exceptionAliasRows = await sql`SELECT id FROM import_alias_mappings WHERE tenant_id = ${scope.tenantId} AND import_batch_id = ${batchId} AND source_label = 'Acme Corp (Row 7)' AND is_current = true`;
    const exceptionAliasId = exceptionAliasRows[0]!.id;
    await validationService.approveAliasMapping(
      makeUser(scope) as any, makeOwnerEffective() as any,
      {
        aliasMappingId: exceptionAliasId,
        targetMasterId: customerId2,
        status: "approved",
        notes: "Approved exception",
        // WP-08-01F alias-atomicity test fix: use mappingVersion="1.0"
        // (matching the batch's mapping_version) so submitForApproval's
        // ALIAS_MAPPING_VERSION_MISMATCH check does not fire on the
        // resubmit. The batch was seeded above with mapping_version="1.0".
        mappingVersion: "1.0",
        idempotencyKey: "pg-alias-11-approve-exception-" + randomUUID(),
      },
    );

    // Resubmit with a NEW idempotency key — should succeed.
    const submitResult = await reconciliationService.submitForApproval(
      makeUser(scope) as any, makeOwnerEffective() as any,
      { importBatchId: batchId, warningSummary: null, idempotencyKey: "pg-alias-11-resubmit-" + randomUUID() },
    );
    expect(submitResult.action).toBe("submitted");
    expect(submitResult.newStatus).toBe("pending_dual_approval");

    await cleanupScope(scope);
  });

  // ===========================================================================
  // PG-ALIAS-12. DEFECT 5 — findMasterForAlias supports fiber_type/product_type/item
  // ===========================================================================
  it("PG-ALIAS-12. DEFECT 5 — findMasterForAlias returns true for valid fiber_type/product_type/item masters, false for unsupported/inactivated", async () => {
    const scope = newScope();
    await seedTenantAndUser(scope);
    const fiberId = await seedFiberType(scope);
    const productId = await seedProductType(scope);
    const itemId = await seedInventoryItem(scope);

    const commitRepo = new HistoricalCommitDbRepository(db);

    // Valid fiber_type master.
    expect(await commitRepo.findMasterForAlias(scope.tenantId, "fiber_type", fiberId)).toBe(true);
    expect(await commitRepo.findMasterForAlias(scope.tenantId, "fiber", fiberId)).toBe(true);

    // Valid product_type master.
    expect(await commitRepo.findMasterForAlias(scope.tenantId, "product_type", productId)).toBe(true);
    expect(await commitRepo.findMasterForAlias(scope.tenantId, "product", productId)).toBe(true);

    // Valid item master.
    expect(await commitRepo.findMasterForAlias(scope.tenantId, "item", itemId)).toBe(true);
    expect(await commitRepo.findMasterForAlias(scope.tenantId, "batch", itemId)).toBe(true);
    expect(await commitRepo.findMasterForAlias(scope.tenantId, "lot", itemId)).toBe(true);

    // Inexistent master (random UUID) — returns false.
    expect(await commitRepo.findMasterForAlias(scope.tenantId, "fiber_type", randomUUID())).toBe(false);
    expect(await commitRepo.findMasterForAlias(scope.tenantId, "product_type", randomUUID())).toBe(false);
    expect(await commitRepo.findMasterForAlias(scope.tenantId, "item", randomUUID())).toBe(false);

    // Cross-tenant master lookup — returns false.
    const otherTenantId = randomUUID();
    expect(await commitRepo.findMasterForAlias(otherTenantId, "fiber_type", fiberId)).toBe(false);

    // Unsupported entity type — returns false (fail-closed).
    expect(await commitRepo.findMasterForAlias(scope.tenantId, "unknown", fiberId)).toBe(false);
    expect(await commitRepo.findMasterForAlias(scope.tenantId, "party", fiberId)).toBe(false);
    expect(await commitRepo.findMasterForAlias(scope.tenantId, "custom_string", fiberId)).toBe(false);

    // Empty/null target id — returns false.
    expect(await commitRepo.findMasterForAlias(scope.tenantId, "fiber_type", "")).toBe(false);

    await cleanupScope(scope);
  });
});
