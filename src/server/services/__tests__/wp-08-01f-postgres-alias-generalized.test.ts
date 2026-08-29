/**
 * WP-08-01F — BLOCKER A/B/C: Alias resolution generalization + real domain proof.
 *
 * BLOCKER A: Generalized alias resolution for item/location (not just party).
 * BLOCKER B: Commit-time exception group membership revalidation.
 * BLOCKER C: REAL domain-service integration proof (not in-memory mock).
 *
 * Tests:
 *   BA-1: item alias DEFAULT drives itemId in inventory movement
 *   BA-2: item alias conflict (staged item_id ≠ approved target) → fail closed
 *   BA-3: item alias EXCEPTION (some rows → Item B, others → Item A)
 *   BB-1: wrong-group exception (row from different sourceLabel) → fail closed
 *   BB-2: wrong-entity-type exception → fail closed
 *   BC-1: REAL SubledgerService integration (party alias → account_entries)
 *   BC-2: REAL InventoryLedgerService integration (item alias → stock_movements)
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
  await sql`INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status) VALUES (${scope.tenantId}, ${"BLK-" + scope.runSuffix}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${scope.ownerId}, ${scope.tenantId}, ${"blk-o-" + scope.runSuffix}, ${"Owner"}, ${"blk-o-" + scope.runSuffix + "@test.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference) VALUES (${scope.accountantId}, ${scope.tenantId}, ${"blk-a-" + scope.runSuffix}, ${"Acct"}, ${"blk-a-" + scope.runSuffix + "@test.test"}, ${"active"}, ${"ar"}) ON CONFLICT (id) DO NOTHING`;
}

async function seedCustomer(scope: TestScope, name: string): Promise<string> {
  const id = randomUUID();
  await sql`INSERT INTO customers (id, tenant_id, customer_code, name_ar, name_en, normalized_name, status, created_by, created_at) VALUES (${id}, ${scope.tenantId}, ${"C-" + id.slice(0, 8)}, ${name}, ${name}, ${name.toLowerCase()}, ${"active"}::master_data_status, ${scope.ownerId}, NOW())`;
  return id;
}

async function seedSupplier(scope: TestScope, name: string): Promise<string> {
  const id = randomUUID();
  await sql`INSERT INTO suppliers (id, tenant_id, supplier_code, name_ar, name_en, normalized_name, status, created_by, created_at) VALUES (${id}, ${scope.tenantId}, ${"S-" + id.slice(0, 8)}, ${name}, ${name}, ${name.toLowerCase()}, ${"active"}::master_data_status, ${scope.ownerId}, NOW())`;
  return id;
}

async function seedInventoryItem(scope: TestScope, name: string): Promise<string> {
  const id = randomUUID();
  await sql`INSERT INTO inventory_items (id, tenant_id, item_kind, item_code, display_name_ar, display_name_en, quality_status, is_blocked, status, created_by, created_at) VALUES (${id}, ${scope.tenantId}, ${"single_yarn"}::item_kind, ${"I-" + id.slice(0, 8)}, ${name}, ${name}, ${"accepted"}::quality_status, false, ${"active"}::master_data_status, ${scope.ownerId}, NOW())`;
  return id;
}

async function seedLocation(scope: TestScope, name: string): Promise<string> {
  const id = randomUUID();
  // Check if locations table exists
  const hasLocations = await sql`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'locations')`;
  if (hasLocations[0]?.exists) {
    await sql`INSERT INTO locations (id, tenant_id, location_code, name_ar, name_en, location_type, status, created_by, created_at) VALUES (${id}, ${scope.tenantId}, ${"L-" + id.slice(0, 8)}, ${name}, ${name}, ${"internal_warehouse"}::location_type, ${"active"}::master_data_status, ${scope.ownerId}, NOW())`;
  }
  return id;
}

async function seedBatch(scope: TestScope, batchId: string, status: string) {
  await sql`INSERT INTO import_batches (id, tenant_id, batch_no, status, source_description, template_name, template_version, mapping_version, cutover_manifest_hash, cutover_import_mode, staged_data_hash, staged_row_count, blocking_error_count, warning_count, accepted_warning_count, validation_status, reconciliation_status, warning_summary, committed_at, commit_effect_counts, created_by, created_at) VALUES (${batchId}, ${scope.tenantId}, ${"BLK-" + batchId.slice(-6)}, ${status}::import_batch_status, ${"test"}, ${"opening_balance_inventory"}, ${"1.0"}, ${"1.0"}, ${"sha256:manifest"}, ${"opening_balance"}, ${"sha256:test"}, 0, 0, 0, 0, ${"passed"}, ${"matched"}, null, null, null, ${scope.ownerId}, NOW())`;
}

async function seedFile(scope: TestScope, batchId: string): Promise<string> {
  const id = randomUUID();
  await sql`INSERT INTO import_files (id, tenant_id, import_batch_id, original_file_name, storage_path, file_hash, file_size_bytes, content_type, file_type, file_version, is_current, created_by, created_at) VALUES (${id}, ${scope.tenantId}, ${batchId}, ${"data.csv"}, ${"local://test"}, ${"sha256:test"}, 100, ${"text/csv"}, ${"source"}, 1, true, ${scope.ownerId}, NOW())`;
  return id;
}

async function seedStagingRow(scope: TestScope, batchId: string, fileId: string, rowNum: number, data: Record<string, unknown>): Promise<string> {
  const id = randomUUID();
  await sql`INSERT INTO import_staging_rows (id, tenant_id, import_batch_id, import_file_id, template_name, source_sheet_name, source_row_number, raw_row_json, transformed_row_json, transformation_notes, validation_status, review_status, ai_confidence, committed_entity_type, committed_entity_id, staging_version, is_current, created_by, created_at) VALUES (${id}, ${scope.tenantId}, ${batchId}, ${fileId}, ${"opening_balance_inventory"}, ${"data.csv"}, ${rowNum}, ${JSON.stringify(data)}::jsonb, ${JSON.stringify(data)}::jsonb, null, ${"pending"}, ${"not_required"}, null, null, null, 1, true, ${scope.ownerId}, NOW())`;
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
  // Order matters due to FKs: inventory_balances.last_movement_id → stock_movements
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
  await sql`DELETE FROM suppliers WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM inventory_items WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM document_sequences WHERE tenant_id = ${scope.tenantId}`;
  await sql`DELETE FROM idempotency_records WHERE tenant_id = ${scope.tenantId}`;
  // audit_logs is append-only, users/tenants kept (FK from audit_logs)
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

describeOrSkip("WP-08-01F BLOCKER A/B/C — Alias resolution generalization + real domain proof", () => {
  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { prepare: false, max: 2, idle_timeout: 10, connect_timeout: 15 });
    db = drizzle(sql, { schema });
  }, 30000);

  afterAll(async () => { if (sql) await sql.end(); }, 15000);

  // BLOCKER A-1: item alias DEFAULT drives itemId
  it("BA-1. item alias DEFAULT drives itemId in inventory movement", async () => {
    const scope = newScope();
    await seedTenantAndUsers(scope);
    const batchId = randomUUID();
    const itemA = await seedInventoryItem(scope, "Cotton 30/1 Original");
    const locationId = randomUUID();
    // Seed a location in the DB
    await sql`INSERT INTO locations (id, tenant_id, location_code, name_ar, name_en, location_type, status, created_by, created_at) VALUES (${locationId}, ${scope.tenantId}, ${"LOC-1"}, ${"Warehouse A"}, ${"Warehouse A"}, ${"internal_warehouse"}::location_type, ${"active"}::master_data_status, ${scope.ownerId}, NOW()) ON CONFLICT DO NOTHING`;

    await seedBatch(scope, batchId, "approved_for_commit");
    const fileId = await seedFile(scope, batchId);
    // Row with name="Cotton 30/1", entity_type="item", quantity, location_id — NO item_id
    const rowId = await seedStagingRow(scope, batchId, fileId, 1, {
      name: "Cotton 30/1", entity_type: "item", quantity: "100.000", location_id: locationId,
    });

    // DEFAULT mapping: Cotton 30/1 → itemA
    await seedAliasMapping(scope, batchId, "item", "Cotton 30/1", itemA, "default");
    await seedApproval(scope, batchId, "owner", scope.ownerId);
    await seedApproval(scope, batchId, "accountant", scope.accountantId);
    await seedBackupEvidence(scope, batchId);
    await seedReconciliationEvidence(scope, batchId);
    await updateBatchForCommit(scope, batchId, 1);

    const { commitService } = makeRealCommitService();
    const result = await commitService.commitBatch(makeOwnerUser(scope) as any, makeOwnerEffective() as any, { importBatchId: batchId, idempotencyKey: "BA-1-" + randomUUID() });
    expect(result.action).toBe("committed");

    // Assert from stock_movements (REAL operational table)
    const movements = await sql`SELECT item_id, to_location_id, source_document_id FROM stock_movements WHERE tenant_id = ${scope.tenantId}`;
    expect(movements.length).toBe(1);
    expect(movements[0]!.item_id).toBe(itemA);
    expect(movements[0]!.to_location_id).toBe(locationId);
    expect(movements[0]!.source_document_id).toBe(rowId);

    await cleanupScope(scope);
  }, 60000);

  // BLOCKER A-2: item alias conflict (staged item_id ≠ approved target)
  it("BA-2. staged item_id conflicts with approved alias → fail closed, zero stock movements", async () => {
    const scope = newScope();
    await seedTenantAndUsers(scope);
    const batchId = randomUUID();
    const itemA = await seedInventoryItem(scope, "Cotton A");
    const itemC = await seedInventoryItem(scope, "Cotton C");
    const locationId = randomUUID();
    await sql`INSERT INTO locations (id, tenant_id, location_code, name_ar, name_en, location_type, status, created_by, created_at) VALUES (${locationId}, ${scope.tenantId}, ${"LOC-2"}, ${"Wh B"}, ${"Wh B"}, ${"internal_warehouse"}::location_type, ${"active"}::master_data_status, ${scope.ownerId}, NOW()) ON CONFLICT DO NOTHING`;

    await seedBatch(scope, batchId, "approved_for_commit");
    const fileId = await seedFile(scope, batchId);
    // Row with name + CONFLICTING item_id
    await seedStagingRow(scope, batchId, fileId, 1, {
      name: "Cotton A", entity_type: "item", quantity: "50.000", location_id: locationId, item_id: itemC,
    });
    // DEFAULT → itemA (different from staged itemC)
    await seedAliasMapping(scope, batchId, "item", "Cotton A", itemA, "default");
    await seedApproval(scope, batchId, "owner", scope.ownerId);
    await seedApproval(scope, batchId, "accountant", scope.accountantId);
    await seedBackupEvidence(scope, batchId);
    await seedReconciliationEvidence(scope, batchId);
    await updateBatchForCommit(scope, batchId, 1);

    const { commitService } = makeRealCommitService();
    const outcome = await commitService.commitBatch(makeOwnerUser(scope) as any, makeOwnerEffective() as any, { importBatchId: batchId, idempotencyKey: "BA-2-" + randomUUID() }).then(v => ({ ok: true as const, v }), e => ({ ok: false as const, e }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(String(outcome.e?.message ?? outcome.e)).toMatch(/ALIAS_CONFLICTS_WITH_STAGED_ID|conflicts with the approved alias target/i);

    const movements = await sql`SELECT count(*)::int AS c FROM stock_movements WHERE tenant_id = ${scope.tenantId}`;
    expect(movements[0]!.c).toBe(0);
    await cleanupScope(scope);
  }, 60000);

  // BLOCKER A-3: item alias EXCEPTION (some rows → Item B)
  it("BA-3. item alias EXCEPTION — ordinary rows → Item A, exception row → Item B", async () => {
    const scope = newScope();
    await seedTenantAndUsers(scope);
    const batchId = randomUUID();
    const itemA = await seedInventoryItem(scope, "Yarn A");
    const itemB = await seedInventoryItem(scope, "Yarn B");
    const locationId = randomUUID();
    await sql`INSERT INTO locations (id, tenant_id, location_code, name_ar, name_en, location_type, status, created_by, created_at) VALUES (${locationId}, ${scope.tenantId}, ${"LOC-3"}, ${"Wh C"}, ${"Wh C"}, ${"internal_warehouse"}::location_type, ${"active"}::master_data_status, ${scope.ownerId}, NOW()) ON CONFLICT DO NOTHING`;

    await seedBatch(scope, batchId, "approved_for_commit");
    const fileId = await seedFile(scope, batchId);
    const row1 = await seedStagingRow(scope, batchId, fileId, 1, { name: "Yarn Type X", entity_type: "item", quantity: "100.000", location_id: locationId });
    const row2 = await seedStagingRow(scope, batchId, fileId, 2, { name: "Yarn Type X", entity_type: "item", quantity: "200.000", location_id: locationId });
    const row3 = await seedStagingRow(scope, batchId, fileId, 3, { name: "Yarn Type X", entity_type: "item", quantity: "300.000", location_id: locationId });

    // DEFAULT → itemA, EXCEPTION row2 → itemB
    await seedAliasMapping(scope, batchId, "item", "Yarn Type X", itemA, "default");
    await seedAliasMapping(scope, batchId, "item", "Yarn Type X", itemB, "exception", [row2]);
    await seedApproval(scope, batchId, "owner", scope.ownerId);
    await seedApproval(scope, batchId, "accountant", scope.accountantId);
    await seedBackupEvidence(scope, batchId);
    await seedReconciliationEvidence(scope, batchId);
    await updateBatchForCommit(scope, batchId, 3);

    const { commitService } = makeRealCommitService();
    const result = await commitService.commitBatch(makeOwnerUser(scope) as any, makeOwnerEffective() as any, { importBatchId: batchId, idempotencyKey: "BA-3-" + randomUUID() });
    expect(result.action).toBe("committed");

    const movements = await sql`SELECT item_id, source_document_id FROM stock_movements WHERE tenant_id = ${scope.tenantId} ORDER BY source_document_id`;
    expect(movements.length).toBe(3);
    // row1 → itemA
    expect(movements.find((m: any) => m.source_document_id === row1)!.item_id).toBe(itemA);
    // row2 → itemB (exception)
    expect(movements.find((m: any) => m.source_document_id === row2)!.item_id).toBe(itemB);
    // row3 → itemA
    expect(movements.find((m: any) => m.source_document_id === row3)!.item_id).toBe(itemA);

    await cleanupScope(scope);
  }, 60000);

  // BLOCKER B-1: wrong-group exception (row from different sourceLabel)
  it("BB-1. exception references row with different sourceLabel → fail closed", async () => {
    const scope = newScope();
    await seedTenantAndUsers(scope);
    const batchId = randomUUID();
    const custA = await seedCustomer(scope, "Ahmed Textiles");
    const custB = await seedCustomer(scope, "Other Company");

    await seedBatch(scope, batchId, "approved_for_commit");
    const fileId = await seedFile(scope, batchId);
    // Row A: name="Ahmed Textiles"
    const rowA = await seedStagingRow(scope, batchId, fileId, 1, { name: "Ahmed Textiles", entity_type: "customer", balance: "100.00" });
    // Row B: name="Other Company" — DIFFERENT source label
    const rowB = await seedStagingRow(scope, batchId, fileId, 2, { name: "Other Company", entity_type: "customer", balance: "200.00" });

    // DEFAULT for Ahmed Textiles → custA
    await seedAliasMapping(scope, batchId, "customer", "Ahmed Textiles", custA, "default");
    // DEFAULT for Other Company → custB
    await seedAliasMapping(scope, batchId, "customer", "Other Company", custB, "default");
    // EXCEPTION for Ahmed Textiles → custB, but claims rowB (which is "Other Company")
    await seedAliasMapping(scope, batchId, "customer", "Ahmed Textiles", custB, "exception", [rowB]);

    await seedApproval(scope, batchId, "owner", scope.ownerId);
    await seedApproval(scope, batchId, "accountant", scope.accountantId);
    await seedBackupEvidence(scope, batchId);
    await seedReconciliationEvidence(scope, batchId);
    await updateBatchForCommit(scope, batchId, 2);

    const { commitService } = makeRealCommitService();
    const outcome = await commitService.commitBatch(makeOwnerUser(scope) as any, makeOwnerEffective() as any, { importBatchId: batchId, idempotencyKey: "BB-1-" + randomUUID() }).then(v => ({ ok: true as const, v }), e => ({ ok: false as const, e }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(String(outcome.e?.message ?? outcome.e)).toMatch(/ALIAS_EXCEPTION_GROUP_MISMATCH|Source label mismatch/i);

    const entries = await sql`SELECT count(*)::int AS c FROM account_entries WHERE tenant_id = ${scope.tenantId}`;
    expect(entries[0]!.c).toBe(0);
    await cleanupScope(scope);
  }, 60000);

  // BLOCKER B-2: wrong-entity-type exception
  it("BB-2. exception references row with different entityType → fail closed", async () => {
    const scope = newScope();
    await seedTenantAndUsers(scope);
    const batchId = randomUUID();
    const custA = await seedCustomer(scope, "Ahmed Textiles");
    const custB = await seedCustomer(scope, "Ahmed Textiles Branch");
    const supplierA = await seedSupplier(scope, "Ahmed Textiles Supplier");

    await seedBatch(scope, batchId, "approved_for_commit");
    const fileId = await seedFile(scope, batchId);
    // Row A: name="Ahmed Textiles", entity_type="customer"
    const rowA = await seedStagingRow(scope, batchId, fileId, 1, { name: "Ahmed Textiles", entity_type: "customer", balance: "100.00" });
    // Row B: name="Ahmed Textiles" but entity_type="supplier" — DIFFERENT entity type
    const rowB = await seedStagingRow(scope, batchId, fileId, 2, { name: "Ahmed Textiles", entity_type: "supplier", balance: "200.00" });

    // DEFAULT for customer/Ahmed Textiles → custA
    await seedAliasMapping(scope, batchId, "customer", "Ahmed Textiles", custA, "default");
    // DEFAULT for supplier/Ahmed Textiles → supplierA (needed so required-alias-groups check passes)
    await seedAliasMapping(scope, batchId, "supplier", "Ahmed Textiles", supplierA, "default");
    // EXCEPTION for customer/Ahmed Textiles → custB, but claims rowB (which is entity_type="supplier")
    await seedAliasMapping(scope, batchId, "customer", "Ahmed Textiles", custB, "exception", [rowB]);

    await seedApproval(scope, batchId, "owner", scope.ownerId);
    await seedApproval(scope, batchId, "accountant", scope.accountantId);
    await seedBackupEvidence(scope, batchId);
    await seedReconciliationEvidence(scope, batchId);
    await updateBatchForCommit(scope, batchId, 2);

    const { commitService } = makeRealCommitService();
    const outcome = await commitService.commitBatch(makeOwnerUser(scope) as any, makeOwnerEffective() as any, { importBatchId: batchId, idempotencyKey: "BB-2-" + randomUUID() }).then(v => ({ ok: true as const, v }), e => ({ ok: false as const, e }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(String(outcome.e?.message ?? outcome.e)).toMatch(/ALIAS_EXCEPTION_GROUP_MISMATCH|Entity type mismatch/i);

    const entries = await sql`SELECT count(*)::int AS c FROM account_entries WHERE tenant_id = ${scope.tenantId}`;
    expect(entries[0]!.c).toBe(0);
    await cleanupScope(scope);
  }, 60000);

  // BLOCKER C-1: REAL SubledgerService integration
  it("BC-1. REAL SubledgerService — party alias drives account_entries", async () => {
    const scope = newScope();
    await seedTenantAndUsers(scope);
    const batchId = randomUUID();
    const custA = await seedCustomer(scope, "Acme Original");
    const custB = await seedCustomer(scope, "Acme Branch B");

    await seedBatch(scope, batchId, "approved_for_commit");
    const fileId = await seedFile(scope, batchId);
    const row1 = await seedStagingRow(scope, batchId, fileId, 1, { name: "Acme Corp", entity_type: "customer", balance: "100.00" });
    const row2 = await seedStagingRow(scope, batchId, fileId, 2, { name: "Acme Corp", entity_type: "customer", balance: "200.00" });
    const row3 = await seedStagingRow(scope, batchId, fileId, 3, { name: "Acme Corp", entity_type: "customer", balance: "300.00" });

    await seedAliasMapping(scope, batchId, "customer", "Acme Corp", custA, "default");
    await seedAliasMapping(scope, batchId, "customer", "Acme Corp", custB, "exception", [row2]);
    await seedApproval(scope, batchId, "owner", scope.ownerId);
    await seedApproval(scope, batchId, "accountant", scope.accountantId);
    await seedBackupEvidence(scope, batchId);
    await seedReconciliationEvidence(scope, batchId);
    await updateBatchForCommit(scope, batchId, 3);

    const { commitService } = makeRealCommitService();
    const result = await commitService.commitBatch(makeOwnerUser(scope) as any, makeOwnerEffective() as any, { importBatchId: batchId, idempotencyKey: "BC-1-" + randomUUID() });
    expect(result.action).toBe("committed");

    // Assert from REAL account_entries (joined with accounts for owner_id)
    const entries = await sql`
      SELECT ae.source_document_id, a.owner_id
      FROM account_entries ae
      JOIN accounts a ON ae.account_id = a.id
      WHERE ae.tenant_id = ${scope.tenantId}
      ORDER BY ae.source_document_id
    `;
    expect(entries.length).toBe(3);
    // row1 → custA
    expect(entries.find((e: any) => e.source_document_id === row1)!.owner_id).toBe(custA);
    // row2 → custB (exception)
    expect(entries.find((e: any) => e.source_document_id === row2)!.owner_id).toBe(custB);
    // row3 → custA
    expect(entries.find((e: any) => e.source_document_id === row3)!.owner_id).toBe(custA);

    await cleanupScope(scope);
  }, 60000);

  // BLOCKER C-2: REAL InventoryLedgerService integration
  it("BC-2. REAL InventoryLedgerService — item alias drives stock_movements", async () => {
    const scope = newScope();
    await seedTenantAndUsers(scope);
    const batchId = randomUUID();
    const itemA = await seedInventoryItem(scope, "Gamma Item A");
    const itemB = await seedInventoryItem(scope, "Gamma Item B");
    const locationId = randomUUID();
    await sql`INSERT INTO locations (id, tenant_id, location_code, name_ar, name_en, location_type, status, created_by, created_at) VALUES (${locationId}, ${scope.tenantId}, ${"LOC-BC2"}, ${"Wh D"}, ${"Wh D"}, ${"internal_warehouse"}::location_type, ${"active"}::master_data_status, ${scope.ownerId}, NOW()) ON CONFLICT DO NOTHING`;

    await seedBatch(scope, batchId, "approved_for_commit");
    const fileId = await seedFile(scope, batchId);
    const row1 = await seedStagingRow(scope, batchId, fileId, 1, { name: "Gamma Yarn", entity_type: "item", quantity: "100.000", location_id: locationId });
    const row2 = await seedStagingRow(scope, batchId, fileId, 2, { name: "Gamma Yarn", entity_type: "item", quantity: "200.000", location_id: locationId });
    const row3 = await seedStagingRow(scope, batchId, fileId, 3, { name: "Gamma Yarn", entity_type: "item", quantity: "300.000", location_id: locationId });

    await seedAliasMapping(scope, batchId, "item", "Gamma Yarn", itemA, "default");
    await seedAliasMapping(scope, batchId, "item", "Gamma Yarn", itemB, "exception", [row2]);
    await seedApproval(scope, batchId, "owner", scope.ownerId);
    await seedApproval(scope, batchId, "accountant", scope.accountantId);
    await seedBackupEvidence(scope, batchId);
    await seedReconciliationEvidence(scope, batchId);
    await updateBatchForCommit(scope, batchId, 3);

    const { commitService } = makeRealCommitService();
    const result = await commitService.commitBatch(makeOwnerUser(scope) as any, makeOwnerEffective() as any, { importBatchId: batchId, idempotencyKey: "BC-2-" + randomUUID() });
    expect(result.action).toBe("committed");

    const movements = await sql`SELECT item_id, source_document_id FROM stock_movements WHERE tenant_id = ${scope.tenantId} ORDER BY source_document_id`;
    expect(movements.length).toBe(3);
    expect(movements.find((m: any) => m.source_document_id === row1)!.item_id).toBe(itemA);
    expect(movements.find((m: any) => m.source_document_id === row2)!.item_id).toBe(itemB);
    expect(movements.find((m: any) => m.source_document_id === row3)!.item_id).toBe(itemA);

    await cleanupScope(scope);
  }, 60000);
});
