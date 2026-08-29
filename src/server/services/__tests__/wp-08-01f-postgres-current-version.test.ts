/**
 * WP-08-01F — CRITICAL DEFECT: Current-version-only staging snapshot regression.
 *
 * Proves that HistoricalCommitService operates ONLY on current (is_current=true)
 * staging rows, ignoring superseded rows from prior file versions.
 *
 * CV-1: inventory replacement — old row (is_current=false) + new row
 *       (is_current=true) → only new row posts
 * CV-2: superseded alias group must not block commit
 * CV-3: superseded exception provenance row must not participate
 * CV-4: current row missing mapping → still blocks commit
 *
 * Uses REAL production domain services (InventoryLedgerService, SubledgerService).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/server/db/schema";
import { HistoricalCommitService } from "@/server/services/historical-commit-service";
import { HistoricalCommitDbRepository } from "@/server/services/historical-commit-db-repository";
import { HistoricalStagingDbRepository } from "@/server/services/historical-staging-db-repository";
import { AuditDbRepository } from "@/server/services/audit-db-repository";
import { IdempotencyDbRepository } from "@/server/services/idempotency-db-repository";
import { DocumentSequenceDbRepository } from "@/server/services/document-sequence-db-repository";
import { InventoryLedgerDbRepository } from "@/server/services/inventory-ledger-db-repository";
import { InventoryLedgerService } from "@/server/services/inventory-ledger-service";
import { SubledgerDbRepository } from "@/server/services/subledger-db-repository";
import { SubledgerService } from "@/server/services/subledger-service";
import { resolveEffectivePermissions } from "@/server/security/effective-permissions";
import { TEST_ROLE_PERMISSION_MATRIX } from "@/server/security/role-fixtures";
import type { ErpUserContext } from "@/server/auth/erp-context";
import { checkDestructiveTestDbSafety } from "./destructive-test-guard";

const DATABASE_URL = process.env.DATABASE_URL;
const ALLOW_DESTRUCTIVE = process.env.ERP_ALLOW_DESTRUCTIVE_LOCAL_TEST_DB === "1";
const REQUIRE_PROOF = process.env.ERP_REQUIRE_WP0801F_POSTGRES_PROOF === "1";
const SHARED_GUARD_RESULT = checkDestructiveTestDbSafety({ databaseUrl: DATABASE_URL, allowDestructive: ALLOW_DESTRUCTIVE, requireProof: REQUIRE_PROOF });
const describeOrSkip = SHARED_GUARD_RESULT.kind === "ok" ? describe : describe.skip;

let sql: ReturnType<typeof postgres>;
let db: any;

interface TestScope { tenantId: string; ownerId: string; accountantId: string; runSuffix: string; }
function newScope(): TestScope {
  return { tenantId: randomUUID(), ownerId: randomUUID(), accountantId: randomUUID(), runSuffix: randomUUID().slice(0, 8) };
}
function makeOwnerUser(scope: TestScope): ErpUserContext {
  return { authenticated: true, userId: scope.ownerId, tenantId: scope.tenantId, authId: `auth-${scope.ownerId}`, name: "Owner", email: `o-${scope.ownerId}@test.local` };
}
function makeOwnerEffective() { return resolveEffectivePermissions(["owner"], TEST_ROLE_PERMISSION_MATRIX); }

async function seedTenantAndUsers(scope: TestScope) {
  await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status) VALUES (${scope.tenantId}, ${"CV-" + scope.runSuffix}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${scope.ownerId}, ${scope.tenantId}, ${"cv-o-" + scope.runSuffix}, ${"Owner"}, ${"cv-o-" + scope.runSuffix + "@test.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${scope.accountantId}, ${scope.tenantId}, ${"cv-a-" + scope.runSuffix}, ${"Acct"}, ${"cv-a-" + scope.runSuffix + "@test.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
}

async function seedInventoryItem(scope: TestScope, name: string): Promise<string> {
  const id = randomUUID();
  await sql`INSERT INTO inventory_items (id, tenant_id, item_kind, item_code, display_name_ar, display_name_en, quality_status, is_blocked, status, created_by, created_at) VALUES (${id}, ${scope.tenantId}, ${"single_yarn"}::item_kind, ${"I-" + id.slice(0, 8)}, ${name}, ${name}, ${"accepted"}::quality_status, false, ${"active"}::master_data_status, ${scope.ownerId}, NOW())`;
  return id;
}

async function seedCustomer(scope: TestScope, name: string): Promise<string> {
  const id = randomUUID();
  await sql`INSERT INTO customers (id, tenant_id, customer_code, name_ar, name_en, normalized_name, status, created_by, created_at) VALUES (${id}, ${scope.tenantId}, ${"C-" + id.slice(0, 8)}, ${name}, ${name}, ${name.toLowerCase()}, ${"active"}::master_data_status, ${scope.ownerId}, NOW())`;
  return id;
}

async function seedLocation(scope: TestScope, code: string, name: string): Promise<string> {
  const id = randomUUID();
  await sql`INSERT INTO locations (id, tenant_id, location_code, name_ar, name_en, location_type, status, created_by, created_at) VALUES (${id}, ${scope.tenantId}, ${code}, ${name}, ${name}, ${"internal_warehouse"}::location_type, ${"active"}::master_data_status, ${scope.ownerId}, NOW())`;
  return id;
}

async function seedBatch(scope: TestScope, batchId: string, status: string) {
  await sql`INSERT INTO import_batches (id, tenant_id, batch_no, status, source_description, template_name, template_version, mapping_version, cutover_manifest_hash, cutover_import_mode, staged_data_hash, staged_row_count, blocking_error_count, warning_count, accepted_warning_count, validation_status, reconciliation_status, warning_summary, committed_at, commit_effect_counts, created_by, created_at) VALUES (${batchId}, ${scope.tenantId}, ${"CV-" + batchId.slice(-6)}, ${status}::import_batch_status, ${"test"}, ${"opening_balance_inventory"}, ${"1.0"}, ${"1.0"}, ${"sha256:manifest"}, ${"opening_balance"}, ${"sha256:test"}, 0, 0, 0, 0, ${"passed"}, ${"matched"}, null, null, null, ${scope.ownerId}, NOW())`;
}

async function seedFile(scope: TestScope, batchId: string, fileHash: string, isCurrent: boolean, version: number): Promise<string> {
  const id = randomUUID();
  await sql`INSERT INTO import_files (id, tenant_id, import_batch_id, original_file_name, storage_path, file_hash, file_size_bytes, content_type, file_type, file_version, is_current, created_by, created_at) VALUES (${id}, ${scope.tenantId}, ${batchId}, ${"v" + version + ".csv"}, ${"local://test/" + fileHash}, ${fileHash}, 100, ${"text/csv"}, ${"source"}, ${version}, ${isCurrent}, ${scope.ownerId}, NOW())`;
  return id;
}

async function seedStagingRow(scope: TestScope, batchId: string, fileId: string, rowNum: number, data: Record<string, unknown>, isCurrent: boolean): Promise<string> {
  const id = randomUUID();
  await sql`INSERT INTO import_staging_rows (id, tenant_id, import_batch_id, import_file_id, template_name, source_sheet_name, source_row_number, raw_row_json, transformed_row_json, transformation_notes, validation_status, review_status, ai_confidence, committed_entity_type, committed_entity_id, staging_version, is_current, created_by, created_at) VALUES (${id}, ${scope.tenantId}, ${batchId}, ${fileId}, ${"opening_balance_inventory"}, ${"data.csv"}, ${rowNum}, ${JSON.stringify(data)}::jsonb, ${JSON.stringify(data)}::jsonb, null, ${"pending"}, ${"not_required"}, null, null, null, 1, ${isCurrent}, ${scope.ownerId}, NOW())`;
  return id;
}

async function seedAliasMapping(scope: TestScope, batchId: string, entityType: string, sourceLabel: string, targetMasterId: string, mappingKind: "default" | "exception", exceptionSourceRowIds?: string[]): Promise<string> {
  const aliasId = randomUUID();
  const groupId = randomUUID();
  const excIds = exceptionSourceRowIds ? JSON.stringify(exceptionSourceRowIds) : null;
  await sql`INSERT INTO import_alias_mappings (id, tenant_id, import_batch_id, entity_type, source_label, normalized_name, target_master_id, mapping_version, confidence_score, status, approved_by, approved_at, notes, created_at, is_current, superseded_at, superseded_by, superseded_reason, group_id, occurrence_count, exception_source_row_ids, mapping_kind) VALUES (${aliasId}, ${scope.tenantId}, ${batchId}, ${entityType}, ${sourceLabel}, ${sourceLabel.toLowerCase()}, ${targetMasterId}, ${"1.0"}, null, ${"approved"}, ${scope.ownerId}, NOW(), ${"test"}, NOW(), true, null, null, null, ${groupId}, 1, ${excIds ? sql`(${excIds})::jsonb` : sql`null`}, ${mappingKind}::alias_mapping_kind)`;
  return aliasId;
}

async function seedApproval(scope: TestScope, batchId: string, role: "owner" | "accountant", userId: string) {
  await sql`INSERT INTO import_batch_approvals (id, tenant_id, import_batch_id, approver_role, approver_user_id, staged_data_hash, cutover_manifest_hash, template_version, mapping_version, validation_status, reconciliation_status, warning_summary, approved_at, reason, approval_version, is_current, created_by, created_at) VALUES (${randomUUID()}, ${scope.tenantId}, ${batchId}, ${role}::migration_approver_role, ${userId}, ${"sha256:test"}, ${"sha256:manifest"}, ${"1.0"}, ${"1.0"}, ${"passed"}, ${"matched"}, null, NOW(), ${"test"}, 1, true, ${userId}, NOW())`;
}

async function seedBackupEvidence(scope: TestScope, batchId: string) {
  await sql`INSERT INTO import_backup_evidence (id, tenant_id, import_batch_id, backup_type, backup_location, backup_hash, backup_size_bytes, backup_created_at, verification_notes, created_by, created_at) VALUES (${randomUUID()}, ${scope.tenantId}, ${batchId}, ${"full"}, ${"s3://b"}, ${"hash"}, 1000, NOW(), ${"ok"}, ${scope.ownerId}, NOW())`;
}

async function seedReconciliationEvidence(scope: TestScope, batchId: string) {
  await sql`INSERT INTO import_reconciliation_results (id, tenant_id, import_batch_id, report_version, metric_key, expected_value, staged_value, committed_value, difference_value, status, notes, created_by, created_at) VALUES (${randomUUID()}, ${scope.tenantId}, ${batchId}, 1, ${"test"}, null, ${"100"}, null, null, ${"matched"}, ${"test"}, ${scope.ownerId}, NOW())`;
}

async function updateBatchForCommit(scope: TestScope, batchId: string, stagedRowCount: number) {
  await sql`UPDATE import_batches SET status = ${"approved_for_commit"}::import_batch_status, staged_row_count = ${stagedRowCount}, staged_data_hash = ${"sha256:test"}, cutover_manifest_hash = ${"sha256:manifest"}, validation_status = ${"passed"}, reconciliation_status = ${"matched"} WHERE id = ${batchId} AND tenant_id = ${scope.tenantId}`;
}

async function cleanupScope(scope: TestScope) {
  await sql`DELETE FROM inventory_balances WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM stock_movements WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM account_entries WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM accounts WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM import_cutover_locks WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM import_backup_evidence WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM import_batch_approvals WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM import_reconciliation_results WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM import_alias_mappings WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM import_staging_rows WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM import_files WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM import_batches WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM customers WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM inventory_items WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM document_sequences WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM idempotency_records WHERE tenant_id = ${scope.tenantId}`;
}

function makeRealCommitService() {
  const commitRepo = new HistoricalCommitDbRepository(db);
  const stagingRepo = new HistoricalStagingDbRepository(db);
  const audit = new AuditDbRepository(db);
  const idem = new IdempotencyDbRepository(db);
  const docSeq = new DocumentSequenceDbRepository(db);
  const transactionRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
    (db as any).transaction(async (tx: any) => work(tx));
  const commitService = new HistoricalCommitService({
    repository: commitRepo, audit, idempotency: idem, transactionRunner,
    txFactories: {
      createCommitRepository: (tx: unknown) => new HistoricalCommitDbRepository(tx as any),
      createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
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
      createDocumentSequence: (tx: unknown) => new DocumentSequenceDbRepository(tx as any),
      createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
    },
  });
  return { commitService, stagingRepo };
}

describeOrSkip("WP-08-01F CV — Current-version-only staging snapshot regression", () => {
  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { prepare: false, max: 2, idle_timeout: 10, connect_timeout: 15 });
    db = drizzle(sql, { schema });
  }, 30000);

  afterAll(async () => { if (sql) await sql.end(); }, 15000);

  // CV-1: inventory replacement — old row superseded + new row current
  it("CV-1. commit posts ONLY current staging row (superseded row ignored)", async () => {
    const scope = newScope();
    await seedTenantAndUsers(scope);
    const batchId = randomUUID();
    const itemA = await seedInventoryItem(scope, "Item CV1");
    const locationId = await seedLocation(scope, "LOC-CV1", "Warehouse CV1");

    await seedBatch(scope, batchId, "approved_for_commit");

    // OLD file version 1 (is_current=false)
    const oldFileId = await seedFile(scope, batchId, "sha256:old-cv1", false, 1);
    // OLD staging row (is_current=false, quantity=100)
    const oldRowId = await seedStagingRow(scope, batchId, oldFileId, 1, {
      name: "Cotton CV1", entity_type: "item", quantity: "100.000", location_id: locationId,
    }, false);

    // NEW file version 2 (is_current=true)
    const newFileId = await seedFile(scope, batchId, "sha256:new-cv1", true, 2);
    // NEW staging row (is_current=true, quantity=150)
    const newRowId = await seedStagingRow(scope, batchId, newFileId, 1, {
      name: "Cotton CV1", entity_type: "item", quantity: "150.000", location_id: locationId,
    }, true);

    // DEFAULT alias mapping for the item
    await seedAliasMapping(scope, batchId, "item", "Cotton CV1", itemA, "default");
    await seedApproval(scope, batchId, "owner", scope.ownerId);
    await seedApproval(scope, batchId, "accountant", scope.accountantId);
    await seedBackupEvidence(scope, batchId);
    await seedReconciliationEvidence(scope, batchId);
    await updateBatchForCommit(scope, batchId, 1); // 1 current row

    const { commitService } = makeRealCommitService();
    const result = await commitService.commitBatch(makeOwnerUser(scope) as any, makeOwnerEffective() as any, { importBatchId: batchId, idempotencyKey: "CV-1-" + randomUUID() });
    expect(result.action).toBe("committed");

    // Assert from stock_movements
    const movements = await sql`SELECT item_id, to_location_id, source_document_id FROM stock_movements WHERE tenant_id = ${scope.tenantId}`;
    expect(movements.length).toBe(1); // exactly ONE movement
    expect(movements[0]!.item_id).toBe(itemA);
    expect(movements[0]!.to_location_id).toBe(locationId);
    expect(movements[0]!.source_document_id).toBe(newRowId); // NEW row, not OLD

    // Assert OLD staging row was NOT marked committed
    const oldRow = await sql`SELECT committed_entity_type, committed_entity_id FROM import_staging_rows WHERE id = ${oldRowId}`;
    expect(oldRow[0]!.committed_entity_type).toBeNull();
    expect(oldRow[0]!.committed_entity_id).toBeNull();

    // Assert NEW staging row WAS marked committed
    const newRow = await sql`SELECT committed_entity_type, committed_entity_id FROM import_staging_rows WHERE id = ${newRowId}`;
    expect(newRow[0]!.committed_entity_type).toBe("stock_movement");
    expect(newRow[0]!.committed_entity_id).toBeTruthy();

    await cleanupScope(scope);
  }, 60000);

  // CV-2: superseded alias group must not block commit
  it("CV-2. superseded alias group does not block commit (only current rows checked)", async () => {
    const scope = newScope();
    await seedTenantAndUsers(scope);
    const batchId = randomUUID();
    const custA = await seedCustomer(scope, "Current Customer");

    await seedBatch(scope, batchId, "approved_for_commit");

    // OLD file (superseded)
    const oldFileId = await seedFile(scope, batchId, "sha256:old-cv2", false, 1);
    // OLD staging row with an alias group that has NO current DEFAULT mapping
    const oldRowId = await seedStagingRow(scope, batchId, oldFileId, 1, {
      name: "Old Supplier Alias", entity_type: "supplier", balance: "100.00",
    }, false);

    // NEW file (current)
    const newFileId = await seedFile(scope, batchId, "sha256:new-cv2", true, 2);
    const newRowId = await seedStagingRow(scope, batchId, newFileId, 1, {
      name: "Current Customer", entity_type: "customer", balance: "200.00",
    }, true);

    // DEFAULT mapping ONLY for the NEW row's alias group
    await seedAliasMapping(scope, batchId, "customer", "Current Customer", custA, "default");
    // NO mapping for "Old Supplier Alias" — if superseded rows were checked, this would block
    await seedApproval(scope, batchId, "owner", scope.ownerId);
    await seedApproval(scope, batchId, "accountant", scope.accountantId);
    await seedBackupEvidence(scope, batchId);
    await seedReconciliationEvidence(scope, batchId);
    await updateBatchForCommit(scope, batchId, 1);

    const { commitService } = makeRealCommitService();
    const result = await commitService.commitBatch(makeOwnerUser(scope) as any, makeOwnerEffective() as any, { importBatchId: batchId, idempotencyKey: "CV-2-" + randomUUID() });
    expect(result.action).toBe("committed");

    // Only current row produces operational effects
    const entries = await sql`SELECT count(*)::int AS c FROM account_entries WHERE tenant_id = ${scope.tenantId}`;
    expect(entries[0]!.c).toBe(1);

    // OLD row was NOT committed
    const oldRow = await sql`SELECT committed_entity_type FROM import_staging_rows WHERE id = ${oldRowId}`;
    expect(oldRow[0]!.committed_entity_type).toBeNull();

    await cleanupScope(scope);
  }, 60000);

  // CV-3: superseded exception provenance row must not participate
  it("CV-3. superseded staging row UUID in exception does not affect current resolution", async () => {
    const scope = newScope();
    await seedTenantAndUsers(scope);
    const batchId = randomUUID();
    const itemA = await seedInventoryItem(scope, "Item A CV3");
    const itemB = await seedInventoryItem(scope, "Item B CV3");
    const locationId = await seedLocation(scope, "LOC-CV3", "Wh CV3");

    await seedBatch(scope, batchId, "approved_for_commit");

    // OLD file (superseded)
    const oldFileId = await seedFile(scope, batchId, "sha256:old-cv3", false, 1);
    const oldRowId = await seedStagingRow(scope, batchId, oldFileId, 1, {
      name: "Gamma Yarn", entity_type: "item", quantity: "50.000", location_id: locationId,
    }, false);

    // NEW file (current)
    const newFileId = await seedFile(scope, batchId, "sha256:new-cv3", true, 2);
    const newRowId = await seedStagingRow(scope, batchId, newFileId, 1, {
      name: "Gamma Yarn", entity_type: "item", quantity: "100.000", location_id: locationId,
    }, true);

    // DEFAULT → itemA
    await seedAliasMapping(scope, batchId, "item", "Gamma Yarn", itemA, "default");
    // EXCEPTION references OLD superseded row → must NOT affect current resolution
    await seedAliasMapping(scope, batchId, "item", "Gamma Yarn", itemB, "exception", [oldRowId]);

    await seedApproval(scope, batchId, "owner", scope.ownerId);
    await seedApproval(scope, batchId, "accountant", scope.accountantId);
    await seedBackupEvidence(scope, batchId);
    await seedReconciliationEvidence(scope, batchId);
    await updateBatchForCommit(scope, batchId, 1);

    const { commitService } = makeRealCommitService();
    const result = await commitService.commitBatch(makeOwnerUser(scope) as any, makeOwnerEffective() as any, { importBatchId: batchId, idempotencyKey: "CV-3-" + randomUUID() });
    expect(result.action).toBe("committed");

    // Current row posts to itemA (DEFAULT), NOT itemB (exception references superseded row)
    const movements = await sql`SELECT item_id, source_document_id FROM stock_movements WHERE tenant_id = ${scope.tenantId}`;
    expect(movements.length).toBe(1);
    expect(movements[0]!.item_id).toBe(itemA);
    expect(movements[0]!.source_document_id).toBe(newRowId);

    // OLD row was NOT committed and NOT treated as exception
    const oldRow = await sql`SELECT committed_entity_type FROM import_staging_rows WHERE id = ${oldRowId}`;
    expect(oldRow[0]!.committed_entity_type).toBeNull();

    await cleanupScope(scope);
  }, 60000);

  // CV-4: current row missing mapping → still blocks commit
  it("CV-4. current row with missing DEFAULT mapping still blocks commit", async () => {
    const scope = newScope();
    await seedTenantAndUsers(scope);
    const batchId = randomUUID();
    const locationId = await seedLocation(scope, "LOC-CV4", "Wh CV4");

    await seedBatch(scope, batchId, "approved_for_commit");

    // OLD file (superseded) with an alias group that HAS a mapping
    const oldFileId = await seedFile(scope, batchId, "sha256:old-cv4", false, 1);
    const oldRowId = await seedStagingRow(scope, batchId, oldFileId, 1, {
      name: "Old Mapped Item", entity_type: "item", quantity: "50.000", location_id: locationId,
    }, false);

    // NEW file (current) with an alias group that has NO mapping
    const newFileId = await seedFile(scope, batchId, "sha256:new-cv4", true, 2);
    const newRowId = await seedStagingRow(scope, batchId, newFileId, 1, {
      name: "New Unmapped Item", entity_type: "item", quantity: "100.000", location_id: locationId,
    }, true);

    // DEFAULT mapping ONLY for OLD alias group
    const oldItem = await seedInventoryItem(scope, "Old Mapped Item Master");
    await seedAliasMapping(scope, batchId, "item", "Old Mapped Item", oldItem, "default");
    // NO mapping for "New Unmapped Item" — must block commit

    await seedApproval(scope, batchId, "owner", scope.ownerId);
    await seedApproval(scope, batchId, "accountant", scope.accountantId);
    await seedBackupEvidence(scope, batchId);
    await seedReconciliationEvidence(scope, batchId);
    await updateBatchForCommit(scope, batchId, 1);

    const { commitService } = makeRealCommitService();
    const outcome = await commitService.commitBatch(makeOwnerUser(scope) as any, makeOwnerEffective() as any, { importBatchId: batchId, idempotencyKey: "CV-4-" + randomUUID() }).then(v => ({ ok: true as const, v }), e => ({ ok: false as const, e }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(String(outcome.e?.message ?? outcome.e)).toMatch(/unresolved|alias.*group|no longer approved/i);
    }

    // Zero operational effects
    const movements = await sql`SELECT count(*)::int AS c FROM stock_movements WHERE tenant_id = ${scope.tenantId}`;
    expect(movements[0]!.c).toBe(0);

    await cleanupScope(scope);
  }, 60000);
});
