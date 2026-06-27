/**
 * WP-00-03E package gate tests — historical migration schema.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Table } from "drizzle-orm";
import {
  importBatches, importFiles, importTemplateVersions,
  importStagingRows, importStagingCells,
  importValidationErrors, importReconciliationResults,
  importHumanReviewItems, importAliasMappings,
  importBatchApprovals, importCutoverManifests,
  historicalCorrectionRequests,
} from "../schema";

function columnNames(table: Table): string[] {
  return Object.keys(table as unknown as Record<string, unknown>);
}

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "drizzle", "output");

function readMigrationSQL(prefix: string): string {
  const files = readdirSync(migrationsDir).filter((f) => f.startsWith(prefix) && f.endsWith(".sql"));
  if (files.length === 0) throw new Error(`No migration starting with ${prefix}`);
  return readFileSync(join(migrationsDir, files[0]!), "utf8");
}

function readAllMigrationSQL(): string {
  const files = readdirSync(migrationsDir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  return files.map((f) => readFileSync(join(migrationsDir, f), "utf8")).join("\n");
}

function hasUniqueIndexInAnyMigration(substr: string): boolean {
  return new RegExp(`CREATE UNIQUE INDEX "[^"]*${substr}[^"]*" ON`).test(readAllMigrationSQL());
}

// ---------------------------------------------------------------------------
// Enum values
// ---------------------------------------------------------------------------

describe("WP-00-03E migration SQL — enum values", () => {
  const sql = readMigrationSQL("0004_");

  it("import_batch_status has all 14 contracted states", () => {
    expect(sql).toMatch(/CREATE TYPE "public"."import_batch_status" AS ENUM\('draft', 'source_uploaded', 'normalized', 'staged', 'validation_in_progress', 'validation_complete', 'reconciliation_in_progress', 'review_required', 'pending_dual_approval', 'approved_for_commit', 'committing', 'committed', 'rejected', 'cancelled'\)/);
  });

  it("validation_severity has 3 levels", () => {
    expect(sql).toMatch(/CREATE TYPE "public"."validation_severity" AS ENUM\('blocking_error', 'review_required_warning', 'informational'\)/);
  });

  it("cutover_import_mode defaults to opening_balance (DEC-071)", () => {
    expect(sql).toMatch(/CREATE TYPE "public"."cutover_import_mode" AS ENUM\('opening_balance', 'transaction_history', 'hybrid'\)/);
  });

  it("does NOT contain approved_after_import_review anywhere", () => {
    expect(readAllMigrationSQL()).not.toMatch(/approved_after_import_review/);
  });
});

// ---------------------------------------------------------------------------
// Table structure
// ---------------------------------------------------------------------------

describe("WP-00-03E table structure", () => {
  it("import_batches has cutover_manifest_hash and staged_data_hash", () => {
    expect(columnNames(importBatches)).toEqual(expect.arrayContaining([
      "id", "tenantId", "batchNo", "status", "cutoverManifestHash",
      "cutoverImportMode", "stagedDataHash", "stagedRowCount",
      "blockingErrorCount", "warningCount", "committedAt",
    ]));
  });

  it("import_batches has unique (tenant, batch_no)", () => {
    expect(hasUniqueIndexInAnyMigration("import_batches_tenant_batch_no")).toBe(true);
  });

  it("import_files has file_hash and superseded_by_id", () => {
    expect(columnNames(importFiles)).toEqual(expect.arrayContaining([
      "id", "tenantId", "importBatchId", "originalFileName",
      "storagePath", "fileHash", "fileType", "supersededById",
    ]));
  });

  it("import_staging_rows has committed_entity_type/id (post-commit link)", () => {
    expect(columnNames(importStagingRows)).toEqual(expect.arrayContaining([
      "id", "tenantId", "importBatchId", "rawRowJson", "transformedRowJson",
      "validationStatus", "aiConfidence", "committedEntityType", "committedEntityId",
    ]));
  });

  it("import_staging_cells has formula_text and calculated_value", () => {
    expect(columnNames(importStagingCells)).toEqual(expect.arrayContaining([
      "id", "tenantId", "stagingRowId", "sourceColumn",
      "originalCellValue", "formulaText", "calculatedValue",
      "transformedValue", "mappedField", "confidenceLevel",
    ]));
  });

  it("import_validation_errors has severity and is_blocking", () => {
    expect(columnNames(importValidationErrors)).toEqual(expect.arrayContaining([
      "id", "tenantId", "importBatchId", "severity", "errorCode",
      "message", "isBlocking", "resolutionStatus",
    ]));
  });

  it("import_reconciliation_results has DEC-072 accepted_difference fields", () => {
    expect(columnNames(importReconciliationResults)).toEqual(expect.arrayContaining([
      "id", "tenantId", "importBatchId", "metricKey", "expectedValue",
      "stagedValue", "differenceValue", "status",
      "acceptedByOwner", "acceptedByAccountant", "acceptanceReason",
    ]));
  });

  it("import_batch_approvals has DEC-069 unique (batch, role)", () => {
    expect(columnNames(importBatchApprovals)).toEqual(expect.arrayContaining([
      "id", "tenantId", "importBatchId", "approverRole",
      "approverUserId", "stagedDataHash", "cutoverManifestHash",
    ]));
    expect(hasUniqueIndexInAnyMigration("import_batch_approvals_tenant_batch_role")).toBe(true);
  });

  it("import_cutover_manifests has DEC-071 import_mode defaulting to opening_balance", () => {
    expect(columnNames(importCutoverManifests)).toEqual(expect.arrayContaining([
      "id", "tenantId", "importBatchId", "domain", "importMode",
      "cutoffDate", "manifestHash", "isApproved",
    ]));
  });

  it("historical_correction_requests has DEC-070 dual approval fields", () => {
    expect(columnNames(historicalCorrectionRequests)).toEqual(expect.arrayContaining([
      "id", "tenantId", "docNo", "importBatchId",
      "originalEntityType", "originalEntityId", "correctionType",
      "status", "ownerApprovedBy", "ownerApprovedAt",
      "accountantApprovedBy", "accountantApprovedAt",
      "correctedEntityType", "correctedEntityId",
    ]));
  });
});

// ---------------------------------------------------------------------------
// CHECK constraints
// ---------------------------------------------------------------------------

describe("WP-00-03E migration SQL — CHECK constraints", () => {
  const sql = readMigrationSQL("0004_");

  it("validation_errors: blocking_error implies is_blocking = true", () => {
    expect(sql).toMatch(/import_validation_errors_blocking_check/);
  });

  it("reconciliation_results: accepted_difference requires both approvers + reason (DEC-072)", () => {
    expect(sql).toMatch(/import_reconciliation_results_accepted_check/);
  });
});

// ---------------------------------------------------------------------------
// Duplicate safety
// ---------------------------------------------------------------------------

describe("WP-00-03E migration SQL — no duplicate names", () => {
  const sql = readMigrationSQL("0004_");

  it("no duplicate ADD CONSTRAINT names", () => {
    const matches = sql.match(/ADD CONSTRAINT "([a-z_]+)"/g) ?? [];
    const names = matches.map((m) => m.match(/"([a-z_]+)"/)?.[1]).filter((n): n is string => n !== undefined);
    const counts = new Map<string, number>();
    for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
    expect([...counts.entries()].filter(([, c]) => c > 1)).toEqual([]);
  });

  it("no duplicate CREATE INDEX names", () => {
    const matches = sql.match(/CREATE (?:UNIQUE )?INDEX "([a-z_]+)"/g) ?? [];
    const names = matches.map((m) => m.match(/"([a-z_]+)"/)?.[1]).filter((n): n is string => n !== undefined);
    const counts = new Map<string, number>();
    for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
    expect([...counts.entries()].filter(([, c]) => c > 1)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Live-DB tests BLOCKED
// ---------------------------------------------------------------------------

describe("WP-00-03E live-DB tests (BLOCKED — 6 tests)", () => {
  it.skip("BLOCKED-1: migration 0004 applies cleanly on top of 0000-0003", () => {});
  it.skip("BLOCKED-2: import_batch_approvals unique (batch, role) enforced", () => {});
  it.skip("BLOCKED-3: import_batches unique (tenant, batch_no) enforced", () => {});
  it.skip("BLOCKED-4: validation_errors blocking_error implies is_blocking CHECK enforced", () => {});
  it.skip("BLOCKED-5: reconciliation_results accepted_difference CHECK enforced", () => {});
  it.skip("BLOCKED-6: staging rows have no operational FK to domain tables (isolation)", () => {});
});
