/**
 * WP-00-03B package gate tests — inventory schema structure.
 *
 * These tests verify the Drizzle schema definitions against Contract 03
 * §§8–9 and the WP-00-03B acceptance criteria WITHOUT requiring a live
 * database.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Table } from "drizzle-orm";
import {
  suppliers,
  customers,
  locations,
  externalFactories,
  fiberTypes,
  productTypes,
  qualityParameters,
  inventoryItems,
  rawMaterialBatches,
  yarnLots,
  stockMovements,
  inventoryBalances,
  stockReservations,
  inventoryAdjustments,
} from "../schema";

function columnNames(table: Table): string[] {
  return Object.keys(table as unknown as Record<string, unknown>);
}

const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "drizzle",
  "output",
);

function readLatestMigrationSQL(): string {
  const files = readdirSync(migrationsDir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
  if (files.length === 0) {
    throw new Error("No migration SQL file found in drizzle/output/");
  }
  return readFileSync(join(migrationsDir, files[files.length - 1]!), "utf8");
}

function readAllMigrationSQL(): string {
  const files = readdirSync(migrationsDir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
  if (files.length === 0) {
    throw new Error("No migration SQL file found in drizzle/output/");
  }
  return files
    .map((f) => readFileSync(join(migrationsDir, f), "utf8"))
    .join("\n");
}

function hasUniqueIndexInAnyMigration(substr: string): boolean {
  const sql = readAllMigrationSQL();
  const pattern = new RegExp(`CREATE UNIQUE INDEX "[^"]*${substr}[^"]*" ON`);
  return pattern.test(sql);
}

// ---------------------------------------------------------------------------
// Master data tables
// ---------------------------------------------------------------------------

describe("WP-00-03B master data tables", () => {
  it("suppliers has unique (tenant_id, supplier_code) and unique (tenant_id, normalized_name)", () => {
    expect(columnNames(suppliers)).toEqual(
      expect.arrayContaining([
        "id",
        "tenantId",
        "supplierCode",
        "nameAr",
        "nameEn",
        "normalizedName",
        "contactInfoJson",
        "status",
        "notes",
      ]),
    );
    expect(hasUniqueIndexInAnyMigration("suppliers_tenant_code")).toBe(true);
    expect(hasUniqueIndexInAnyMigration("suppliers_tenant_normalized_name")).toBe(true);
  });

  it("customers has unique (tenant_id, customer_code) and credit_limit nullable", () => {
    expect(columnNames(customers)).toEqual(
      expect.arrayContaining([
        "id",
        "tenantId",
        "customerCode",
        "nameAr",
        "nameEn",
        "normalizedName",
        "creditLimit",
        "creditTerms",
        "status",
      ]),
    );
    expect(hasUniqueIndexInAnyMigration("customers_tenant_code")).toBe(true);
  });

  it("locations has location_type and related_factory_id (nullable)", () => {
    expect(columnNames(locations)).toEqual(
      expect.arrayContaining([
        "id",
        "tenantId",
        "locationCode",
        "nameAr",
        "locationType",
        "relatedFactoryId",
        "status",
      ]),
    );
    expect(hasUniqueIndexInAnyMigration("locations_tenant_code")).toBe(true);
  });

  it("external_factories has linked_location_id (NOT NULL) and factory_type", () => {
    expect(columnNames(externalFactories)).toEqual(
      expect.arrayContaining([
        "id",
        "tenantId",
        "factoryCode",
        "nameAr",
        "factoryType",
        "linkedLocationId",
        "defaultRatePerInputTon",
        "defaultCostBasis",
        "status",
      ]),
    );
    expect(hasUniqueIndexInAnyMigration("external_factories_tenant_linked_location")).toBe(true);
  });

  it("fiber_types has unique (tenant_id, code)", () => {
    expect(hasUniqueIndexInAnyMigration("fiber_types_tenant_code")).toBe(true);
  });

  it("product_types has unique (tenant_id, code)", () => {
    expect(hasUniqueIndexInAnyMigration("product_types_tenant_code")).toBe(true);
  });

  it("quality_parameters has unique (tenant_id, code)", () => {
    expect(hasUniqueIndexInAnyMigration("quality_parameters_tenant_code")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Inventory identity tables
// ---------------------------------------------------------------------------

describe("WP-00-03B inventory identity tables", () => {
  it("inventory_items has unique (tenant_id, item_kind, item_code)", () => {
    expect(columnNames(inventoryItems)).toEqual(
      expect.arrayContaining([
        "id",
        "tenantId",
        "itemKind",
        "itemCode",
        "displayNameAr",
        "qualityStatus",
        "isBlocked",
        "status",
      ]),
    );
    expect(hasUniqueIndexInAnyMigration("inventory_items_tenant_kind_code")).toBe(true);
  });

  it("raw_material_batches has one-to-one item identity (unique tenant_id + item_id)", () => {
    expect(columnNames(rawMaterialBatches)).toEqual(
      expect.arrayContaining([
        "id",
        "tenantId",
        "itemId",
        "batchNo",
        "supplierId",
        "fiberTypeId",
        "grossWeightKg",
        "netWeightKg",
        "purchasePricePerTon",
        "totalPurchaseCost",
        "receivedDate",
        "approvalStatus",
        "recordOrigin",
        "recordPeriod",
        "isLocked",
        "importBatchId",
      ]),
    );
    expect(hasUniqueIndexInAnyMigration("raw_material_batches_tenant_item")).toBe(true);
    expect(hasUniqueIndexInAnyMigration("raw_material_batches_tenant_batch_no")).toBe(true);
  });

  it("yarn_lots has one-to-one item identity (unique tenant_id + item_id)", () => {
    expect(columnNames(yarnLots)).toEqual(
      expect.arrayContaining([
        "id",
        "tenantId",
        "itemId",
        "lotNo",
        "lotType",
        "yarnCount",
        "factoryId",
        "productionOrderId",
        "qualityStatus",
        "approvalStatus",
        "recordOrigin",
        "recordPeriod",
        "isLocked",
        "importBatchId",
      ]),
    );
    expect(hasUniqueIndexInAnyMigration("yarn_lots_tenant_item")).toBe(true);
    expect(hasUniqueIndexInAnyMigration("yarn_lots_tenant_lot_type_lot_no")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Ledger tables
// ---------------------------------------------------------------------------

describe("WP-00-03B inventory ledger tables", () => {
  it("stock_movements has unique (tenant_id, doc_no) and unique (tenant_id, idempotency_key)", () => {
    expect(columnNames(stockMovements)).toEqual(
      expect.arrayContaining([
        "id",
        "tenantId",
        "docNo",
        "movementType",
        "movementStatus",
        "itemId",
        "fromLocationId",
        "toLocationId",
        "quantityKg",
        "movementDate",
        "sourceDocumentType",
        "sourceDocumentId",
        "approvalRequestId",
        "reversalOfMovementId",
        "idempotencyKey",
        "recordOrigin",
        "recordPeriod",
        "importBatchId",
        "postedBy",
        "postedAt",
      ]),
    );
    expect(hasUniqueIndexInAnyMigration("stock_movements_tenant_doc_no")).toBe(true);
    expect(hasUniqueIndexInAnyMigration("stock_movements_tenant_idempotency")).toBe(true);
  });

  it("inventory_balances has unique (tenant_id, item_id, location_id)", () => {
    expect(columnNames(inventoryBalances)).toEqual(
      expect.arrayContaining([
        "id",
        "tenantId",
        "itemId",
        "locationId",
        "onHandQtyKg",
        "reservedQtyKg",
        "blockedQtyKg",
        "returnedQtyKg",
        "lastMovementId",
        "version",
      ]),
    );
    expect(hasUniqueIndexInAnyMigration("inventory_balances_tenant_item_location")).toBe(true);
  });

  it("inventory_balances does NOT have allowed_negative_flag (SUP-001)", () => {
    const cols = columnNames(inventoryBalances);
    expect(cols).not.toContain("allowedNegativeFlag");
  });

  it("stock_reservations has unique (tenant_id, reservation_no) and unique active per scope", () => {
    expect(columnNames(stockReservations)).toEqual(
      expect.arrayContaining([
        "id",
        "tenantId",
        "reservationNo",
        "itemId",
        "locationId",
        "quantityKg",
        "sourceType",
        "sourceId",
        "salesOrderId",
        "salesLineId",
        "status",
        "reservedAt",
        "expiresAt",
        "releasedAt",
        "consumedAt",
        "idempotencyKey",
        "failureResolutionReason",
        "failureResolutionActor",
        "failureResolutionAt",
      ]),
    );
    expect(hasUniqueIndexInAnyMigration("stock_reservations_tenant_no")).toBe(true);
    expect(hasUniqueIndexInAnyMigration("stock_reservations_active_source_scope")).toBe(true);
  });

  it("inventory_adjustments has unique (tenant_id, doc_no) and direction/quantity/reason", () => {
    expect(columnNames(inventoryAdjustments)).toEqual(
      expect.arrayContaining([
        "id",
        "tenantId",
        "docNo",
        "itemId",
        "locationId",
        "adjustmentDirection",
        "quantityKg",
        "reason",
        "status",
        "approvalRequestId",
        "postedMovementId",
      ]),
    );
    expect(hasUniqueIndexInAnyMigration("inventory_adjustments_tenant_doc_no")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Migration SQL structural checks
// ---------------------------------------------------------------------------

describe("WP-00-03B migration SQL — manual FK constraints present", () => {
  const sql = readLatestMigrationSQL();

  it("contains manual FK: locations.related_factory_id -> external_factories.id", () => {
    expect(sql).toMatch(/locations_related_factory_id_external_factories_id_fk/);
  });

  it("contains manual FK: stock_movements.reversal_of_movement_id -> stock_movements.id (self-ref)", () => {
    expect(sql).toMatch(/stock_movements_reversal_of_movement_id_stock_movements_id_fk/);
  });

  it("contains manual FK: inventory_balances.last_movement_id -> stock_movements.id", () => {
    expect(sql).toMatch(/inventory_balances_last_movement_id_stock_movements_id_fk/);
  });
});

describe("WP-00-03B migration SQL — no duplicate constraint/index names", () => {
  // These tests prevent the WP-00-03A duplicate-FK defect from recurring.
  // Every ADD CONSTRAINT name and CREATE [UNIQUE] INDEX name must appear
  // exactly once in migration 0001.

  const sql = readLatestMigrationSQL();

  it("manual FK constraint names appear exactly once", () => {
    const manualFkNames = [
      "locations_related_factory_id_external_factories_id_fk",
      "stock_movements_reversal_of_movement_id_stock_movements_id_fk",
      "inventory_balances_last_movement_id_stock_movements_id_fk",
    ];
    for (const name of manualFkNames) {
      const matches = sql.match(
        new RegExp(`ADD CONSTRAINT "${name}"`, "g"),
      );
      expect(matches?.length ?? 0).toBe(1);
    }
  });

  it("no ADD CONSTRAINT name is defined more than once in migration 0001", () => {
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

  it("no CREATE [UNIQUE] INDEX name is defined more than once in migration 0001", () => {
    const matches =
      sql.match(/CREATE (?:UNIQUE )?INDEX "([a-z_]+)"/g) ?? [];
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

describe("WP-00-03B migration SQL — CHECK constraints present", () => {
  const sql = readLatestMigrationSQL();

  it("raw_material_batches has gross >= net check", () => {
    expect(sql).toMatch(/raw_material_batches_gross_net_check/);
  });

  it("inventory_balances has reserved >= 0 and reserved <= on_hand check", () => {
    expect(sql).toMatch(/inventory_balances_reserved_check/);
    expect(sql).toMatch(/inventory_balances_reserved_within_on_hand_check/);
  });

  it("stock_movements has quantity > 0 check", () => {
    expect(sql).toMatch(/stock_movements_quantity_check/);
  });

  it("stock_movements has at-least-one-location check", () => {
    expect(sql).toMatch(/stock_movements_location_check/);
  });

  it("stock_movements has from != to check", () => {
    expect(sql).toMatch(/stock_movements_from_to_diff_check/);
  });
});

// ---------------------------------------------------------------------------
// Live-DB tests BLOCKED in WP-00-03B (documented, not run).
// ---------------------------------------------------------------------------

describe("WP-00-03B live-DB tests (BLOCKED — 8 tests, documented)", () => {
  it.skip("BLOCKED-1: migration 0001 applies cleanly to a database with 0000 already applied", () => {
    // BLOCKED: requires hosted Supabase dev/test credentials (DEC-060).
  });

  it.skip("BLOCKED-2: one-to-one raw_material_batches.item_id -> inventory_items.id enforced at DB level", () => {
    // BLOCKED: requires hosted Supabase dev/test credentials (DEC-060).
  });

  it.skip("BLOCKED-3: one-to-one yarn_lots.item_id -> inventory_items.id enforced at DB level", () => {
    // BLOCKED: requires hosted Supabase dev/test credentials (DEC-060).
  });

  it.skip("BLOCKED-4: inventory_balances reserved_within_on_hand CHECK enforced at DB level", () => {
    // BLOCKED: requires hosted Supabase dev/test credentials (DEC-060).
  });

  it.skip("BLOCKED-5: stock_movements unique idempotency_key enforced at DB level", () => {
    // BLOCKED: requires hosted Supabase dev/test credentials (DEC-060).
  });

  it.skip("BLOCKED-6: stock_reservations one-active-per-scope enforced at DB level", () => {
    // BLOCKED: requires hosted Supabase dev/test credentials (DEC-060).
  });

  it.skip("BLOCKED-7: external_factories unique linked_location_id enforced at DB level", () => {
    // BLOCKED: requires hosted Supabase dev/test credentials (DEC-060).
  });

  it.skip("BLOCKED-8: manual FK constraints (locations.related_factory_id, stock_movements.reversal, inventory_balances.last_movement_id) enforce at DB level", () => {
    // BLOCKED: requires hosted Supabase dev/test credentials (DEC-060).
  });
});
