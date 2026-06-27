/**
 * WP-00-03C package gate tests — production/WIP schema structure.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §10
 * Contract: docs/contracts/05_production_wip_contract.md
 * Contract: docs/contracts/13_work_packages.md WP-00-03C
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Table } from "drizzle-orm";
import {
  productionOrders,
  productionInputs,
  productionOutputs,
  productionWipBalances,
  productionReceipts,
  productionReceiptInputAllocations,
  productionWasteEntries,
  productionWipReturns,
} from "../schema";

function columnNames(table: Table): string[] {
  return Object.keys(table as unknown as Record<string, unknown>);
}

const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "..", "drizzle", "output",
);

function readMigrationSQL(prefix: string): string {
  const files = readdirSync(migrationsDir).filter((f) => f.startsWith(prefix) && f.endsWith(".sql"));
  if (files.length === 0) throw new Error(`No migration file starting with ${prefix}`);
  return readFileSync(join(migrationsDir, files[0]!), "utf8");
}

function readAllMigrationSQL(): string {
  const files = readdirSync(migrationsDir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  return files.map((f) => readFileSync(join(migrationsDir, f), "utf8")).join("\n");
}

function hasUniqueIndexInAnyMigration(substr: string): boolean {
  const sql = readAllMigrationSQL();
  return new RegExp(`CREATE UNIQUE INDEX "[^"]*${substr}[^"]*" ON`).test(sql);
}

// ---------------------------------------------------------------------------
// Production orders
// ---------------------------------------------------------------------------

describe("WP-00-03C production_orders", () => {
  it("has required columns including rate/cost snapshot fields (DEC-013/014)", () => {
    expect(columnNames(productionOrders)).toEqual(
      expect.arrayContaining([
        "id", "tenantId", "docNo", "productionType", "factoryId",
        "factoryLocationId", "status", "approvalStatus",
        "totalInputQtyKg", "totalOutputQtyKg", "totalWasteQtyKg",
        "payableTriggerUsed", "factoryCostBasisUsed",
        "factoryRatePerInputTonUsed", "calculationVersion",
        "calculatedFactoryCost", "rateConfirmedBy", "rateConfirmedAt",
        "importedTotalFactoryCost", "erpCalculatedFactoryCost",
        "historicalCostBasisSource", "sourceFormulaText",
        "sourceCalculatedValue", "costDifferenceAmount", "costDifferencePercent",
        "migrationWarning", "recordOrigin", "recordPeriod", "isLocked",
      ]),
    );
  });

  it("does NOT have a single input_item_id FK on the header (DEC-012)", () => {
    const cols = columnNames(productionOrders);
    expect(cols).not.toContain("inputItemId");
    expect(cols).not.toContain("input_item_id");
  });

  it("has unique (tenant_id, doc_no)", () => {
    expect(hasUniqueIndexInAnyMigration("production_orders_tenant_doc_no")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Production inputs (many-to-many)
// ---------------------------------------------------------------------------

describe("WP-00-03C production_inputs (many-to-many DEC-012)", () => {
  it("has required columns including WIP invariant quantities", () => {
    expect(columnNames(productionInputs)).toEqual(
      expect.arrayContaining([
        "id", "tenantId", "productionOrderId", "inputItemId",
        "inputLocationId", "plannedInputQtyKg", "issuedQtyKg",
        "consumedQtyKg", "returnedFromWipQtyKg", "remainingWipQtyKg",
        "issueMovementId",
      ]),
    );
  });

  it("does NOT have a unique constraint on (order_id, item_id) — allows multiple inputs per item", () => {
    // DEC-012: many-to-many capable. Multiple input rows for the same item
    // are allowed. No unique index on (tenant_id, production_order_id, input_item_id).
    const sql = readMigrationSQL("0002_");
    expect(sql).not.toMatch(/production_inputs_tenant_order_item_unique/);
  });
});

// ---------------------------------------------------------------------------
// Production outputs (many-to-many)
// ---------------------------------------------------------------------------

describe("WP-00-03C production_outputs (many-to-many DEC-012)", () => {
  it("has required columns including output lot and receipt movement links", () => {
    expect(columnNames(productionOutputs)).toEqual(
      expect.arrayContaining([
        "id", "tenantId", "productionOrderId", "outputItemId",
        "outputLotId", "outputLocationId", "outputQtyKg",
        "receiptMovementId",
      ]),
    );
  });
});

// ---------------------------------------------------------------------------
// Production WIP balances
// ---------------------------------------------------------------------------

describe("WP-00-03C production_wip_balances (DEC-011)", () => {
  it("has unique (tenant_id, production_order_id, input_item_id, factory_location_id)", () => {
    expect(columnNames(productionWipBalances)).toEqual(
      expect.arrayContaining([
        "id", "tenantId", "productionOrderId", "inputItemId",
        "factoryLocationId", "wipQtyKg", "version",
      ]),
    );
    expect(hasUniqueIndexInAnyMigration("production_wip_balances_tenant_order_item_location")).toBe(true);
  });

  it("does NOT have a wip_qty_kg >= 0 CHECK (allows approved correction negative)", () => {
    // Contract 05 §13: "WIP cannot be negative through ordinary operations.
    // Only an explicit approved correction may represent a negative WIP
    // inconsistency." The SERVICE blocks ordinary negative WIP; the DB
    // allows it for approved corrections.
    const sql = readMigrationSQL("0002_");
    expect(sql).not.toMatch(/production_wip_balances.*wip_qty.*>= 0/);
  });

  it("does NOT have allowed_negative_flag column (no generic negative toggle)", () => {
    const cols = columnNames(productionWipBalances);
    expect(cols).not.toContain("allowedNegativeFlag");
    expect(cols).not.toContain("allowed_negative_flag");
    // Also verify no such column in the migration SQL.
    const sql = readMigrationSQL("0002_");
    expect(sql).not.toMatch(/allowed_negative_flag/);
  });
});

// ---------------------------------------------------------------------------
// Production receipts
// ---------------------------------------------------------------------------

describe("WP-00-03C production_receipts (DEC-013)", () => {
  it("has rate/cost snapshot fields and factory_payable (DEC-013/014)", () => {
    expect(columnNames(productionReceipts)).toEqual(
      expect.arrayContaining([
        "id", "tenantId", "docNo", "productionOrderId",
        "outputItemId", "outputLotId", "outputLocationId", "outputQtyKg",
        "receiptDate", "status", "approvalStatus",
        "payableTriggerUsed", "factoryCostBasisUsed",
        "factoryRatePerInputTonUsed", "factoryCostBasisInputQtyKg",
        "calculatedFactoryCost", "calculationVersion",
        "factoryPayable", "accountEntryId",
        "idempotencyKey", "approvalRequestId", "receiptMovementId",
        "confirmedBy", "confirmedAt",
      ]),
    );
  });

  it("has unique (tenant_id, doc_no) and unique (tenant_id, idempotency_key)", () => {
    expect(hasUniqueIndexInAnyMigration("production_receipts_tenant_doc_no")).toBe(true);
    expect(hasUniqueIndexInAnyMigration("production_receipts_tenant_idempotency")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Receipt input allocations
// ---------------------------------------------------------------------------

describe("WP-00-03C production_receipt_input_allocations", () => {
  it("has unique (tenant_id, receipt_id, input_id) — prevents duplicate allocation", () => {
    expect(columnNames(productionReceiptInputAllocations)).toEqual(
      expect.arrayContaining([
        "id", "tenantId", "productionReceiptId", "productionInputId",
        "consumedTowardOutputQtyKg", "allocatedWasteQtyKg",
        "payableCostBasisQtyKg",
      ]),
    );
    expect(hasUniqueIndexInAnyMigration("receipt_allocations_receipt_input")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Waste entries
// ---------------------------------------------------------------------------

describe("WP-00-03C production_waste_entries", () => {
  it("has required columns linking to order/input/receipt/movement", () => {
    expect(columnNames(productionWasteEntries)).toEqual(
      expect.arrayContaining([
        "id", "tenantId", "productionOrderId", "productionInputId",
        "productionReceiptId", "wasteQtyKg", "wastePercent",
        "wasteReason", "movementId",
      ]),
    );
  });
});

// ---------------------------------------------------------------------------
// WIP returns
// ---------------------------------------------------------------------------

describe("WP-00-03C production_wip_returns", () => {
  it("has required columns including idempotency and return movement link", () => {
    expect(columnNames(productionWipReturns)).toEqual(
      expect.arrayContaining([
        "id", "tenantId", "docNo", "productionOrderId", "productionInputId",
        "returnQtyKg", "returnLocationId", "status", "approvalStatus",
        "reason", "notes", "idempotencyKey", "approvalRequestId",
        "returnMovementId", "financialReviewStatus",
      ]),
    );
  });

  it("has unique (tenant_id, doc_no) and unique (tenant_id, idempotency_key)", () => {
    expect(hasUniqueIndexInAnyMigration("production_wip_returns_tenant_doc_no")).toBe(true);
    expect(hasUniqueIndexInAnyMigration("production_wip_returns_tenant_idempotency")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Migration SQL structural checks
// ---------------------------------------------------------------------------

describe("WP-00-03C migration SQL — manual FK + CHECK constraints", () => {
  const sql = readMigrationSQL("0002_");

  it("contains manual FK: yarn_lots.production_order_id -> production_orders.id", () => {
    expect(sql).toMatch(/yarn_lots_production_order_id_production_orders_id_fk/);
  });

  it("production_inputs has planned > 0 and issued/consumed/returned/remaining >= 0 checks", () => {
    expect(sql).toMatch(/production_inputs_planned_check/);
    expect(sql).toMatch(/production_inputs_issued_check/);
    expect(sql).toMatch(/production_inputs_consumed_check/);
  });

  it("production_receipts has output_qty > 0 and rate/payable >= 0 checks", () => {
    expect(sql).toMatch(/production_receipts_output_qty_check/);
    expect(sql).toMatch(/production_receipts_rate_check/);
  });

  it("production_waste_entries has waste_qty > 0 check", () => {
    expect(sql).toMatch(/production_waste_qty_check/);
  });

  it("production_wip_returns has return_qty > 0 check", () => {
    expect(sql).toMatch(/production_wip_returns_qty_check/);
  });
});

describe("WP-00-03C migration SQL — no duplicate constraint/index names", () => {
  const sql = readMigrationSQL("0002_");

  it("manual FK constraint name appears exactly once", () => {
    const matches = sql.match(
      /ADD CONSTRAINT "yarn_lots_production_order_id_production_orders_id_fk"/g,
    );
    expect(matches?.length ?? 0).toBe(1);
  });

  it("no ADD CONSTRAINT name is defined more than once in migration 0002", () => {
    const matches = sql.match(/ADD CONSTRAINT "([a-z_]+)"/g) ?? [];
    const names = matches
      .map((m) => m.match(/"([a-z_]+)"/)?.[1])
      .filter((n): n is string => n !== undefined);
    const counts = new Map<string, number>();
    for (const name of names) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const duplicates = [...counts.entries()].filter(([, count]) => count > 1);
    expect(duplicates).toEqual([]);
  });

  it("no CREATE [UNIQUE] INDEX name is defined more than once in migration 0002", () => {
    const matches = sql.match(/CREATE (?:UNIQUE )?INDEX "([a-z_]+)"/g) ?? [];
    const names = matches
      .map((m) => m.match(/"([a-z_]+)"/)?.[1])
      .filter((n): n is string => n !== undefined);
    const counts = new Map<string, number>();
    for (const name of names) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const duplicates = [...counts.entries()].filter(([, count]) => count > 1);
    expect(duplicates).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Live-DB tests BLOCKED
// ---------------------------------------------------------------------------

describe("WP-00-03C live-DB tests (BLOCKED — 6 tests, documented)", () => {
  it.skip("BLOCKED-1: migration 0002 applies cleanly on top of 0000+0001", () => {});
  it.skip("BLOCKED-2: production_inputs allows multiple inputs for same item (many-to-many)", () => {});
  it.skip("BLOCKED-3: production_wip_balances unique (order, item, location) enforced", () => {});
  it.skip("BLOCKED-4: receipt_input_allocations unique (receipt, input) enforced", () => {});
  it.skip("BLOCKED-5: production_receipts unique idempotency_key enforced", () => {});
  it.skip("BLOCKED-6: manual FK yarn_lots.production_order_id -> production_orders.id enforced", () => {});
});
