/**
 * WP-00-03D package gate tests — financial schema structure.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Table } from "drizzle-orm";
import {
  salesOrders, salesOrderLines, salesProfitabilitySnapshots,
  returnRequests, returnLines,
  accounts, accountEntries, payments, paymentSettlements,
  directCosts, directCostAllocations, rawPurchasePriceConfirmations,
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

// Sales
describe("WP-00-03D sales_orders", () => {
  it("has required columns", () => {
    expect(columnNames(salesOrders)).toEqual(expect.arrayContaining([
      "id", "tenantId", "docNo", "customerId", "saleStatus", "saleDate",
      "totalGrossRevenue", "orderDiscountTotal", "documentTotalPosted",
      "isReplacementOrder", "isLocked",
    ]));
  });
  it("has unique (tenant, doc_no)", () => {
    expect(hasUniqueIndexInAnyMigration("sales_orders_tenant_doc_no")).toBe(true);
  });
});

describe("WP-00-03D sales_order_lines — decimal scales", () => {
  it("has NUMERIC(18,2) gross/posted and NUMERIC(24,8) precise fields", () => {
    const cols = columnNames(salesOrderLines);
    expect(cols).toEqual(expect.arrayContaining([
      "lineGrossRevenue", "lineAllocatedDiscountPrecise", "lineAllocatedDiscountPosted",
      "lineNetRevenuePrecise", "lineNetRevenuePosted", "roundingAdjustment",
    ]));
    // Check migration for decimal scales
    const sql = readMigrationSQL("0003_");
    expect(sql).toMatch(/"line_gross_revenue" numeric\(18, 2\)/);
    expect(sql).toMatch(/"line_allocated_discount_precise" numeric\(24, 8\)/);
    expect(sql).toMatch(/"line_allocated_discount_posted" numeric\(18, 2\)/);
    expect(sql).toMatch(/"line_net_revenue_precise" numeric\(24, 8\)/);
    expect(sql).toMatch(/"line_net_revenue_posted" numeric\(18, 2\)/);
    expect(sql).toMatch(/"rounding_adjustment" numeric\(18, 2\)/);
  });
  it("has unique (tenant, order, line_no)", () => {
    expect(hasUniqueIndexInAnyMigration("sales_order_lines_tenant_order_line")).toBe(true);
  });
});

describe("WP-00-03D sales_profitability_snapshots — versioned/immutable", () => {
  it("has unique (tenant, order, version)", () => {
    expect(hasUniqueIndexInAnyMigration("profitability_snapshots_tenant_order_version")).toBe(true);
  });
  it("has version >= 1 check", () => {
    const sql = readMigrationSQL("0003_");
    expect(sql).toMatch(/profitability_snapshots_version_check/);
  });
});

// Returns
describe("WP-00-03D returns — DEC-068 fields", () => {
  it("return_lines has original_sale_line_net_unit_value at DECIMAL(18,6)", () => {
    const sql = readMigrationSQL("0003_");
    expect(sql).toMatch(/"original_sale_line_net_unit_value" numeric\(18, 6\)/);
  });
  it("return_lines has return_credit_value at DECIMAL(18,2)", () => {
    const sql = readMigrationSQL("0003_");
    expect(sql).toMatch(/"return_credit_value" numeric\(18, 2\)/);
  });
  it("return_lines has residual_adjustment and cumulative fields", () => {
    expect(columnNames(returnLines)).toEqual(expect.arrayContaining([
      "residualAdjustment", "cumulativePriorReturnQty", "cumulativePriorReturnCredit",
    ]));
  });
});

// Subledger
describe("WP-00-03D accounts", () => {
  it("has unique (tenant, owner_type, owner_id, currency)", () => {
    expect(hasUniqueIndexInAnyMigration("accounts_tenant_owner_type_owner_currency")).toBe(true);
  });
});

describe("WP-00-03D account_entries — immutable", () => {
  it("has no updated_at/deleted_at (append-only)", () => {
    const cols = columnNames(accountEntries);
    expect(cols).not.toContain("updatedAt");
    expect(cols).not.toContain("deletedAt");
  });
  it("has non-zero amount check", () => {
    const sql = readMigrationSQL("0003_");
    expect(sql).toMatch(/account_entries_amount_nonzero_check/);
  });
});

describe("WP-00-03D payments — DEC-066 payment methods", () => {
  it("has payment_method enum with exactly 5 MVP methods", () => {
    const sql = readMigrationSQL("0003_");
    expect(sql).toMatch(/CREATE TYPE "public"."payment_method" AS ENUM\('cash', 'bank_transfer', 'check', 'wallet_instapay', 'other'\)/);
  });
  it("has unique (tenant, payment_no) and (tenant, idempotency_key)", () => {
    expect(hasUniqueIndexInAnyMigration("payments_tenant_payment_no")).toBe(true);
    expect(hasUniqueIndexInAnyMigration("payments_tenant_idempotency")).toBe(true);
  });
});

describe("WP-00-03D raw_purchase_price_confirmations — DEC-067", () => {
  it("has quantity_basis defaulting to net_accepted_kg", () => {
    const sql = readMigrationSQL("0003_");
    expect(sql).toMatch(/"quantity_basis".*'net_accepted_kg'/);
  });
  it("has unique (tenant, doc_no) and (tenant, idempotency_key)", () => {
    expect(hasUniqueIndexInAnyMigration("raw_price_confirmations_tenant_doc_no")).toBe(true);
    expect(hasUniqueIndexInAnyMigration("raw_price_confirmations_tenant_idempotency")).toBe(true);
  });
});

// Manual FKs
describe("WP-00-03D migration SQL — manual FK constraints", () => {
  const sql = readMigrationSQL("0003_");
  it("has stock_reservations.sales_order_id -> sales_orders.id", () => {
    expect(sql).toMatch(/stock_reservations_sales_order_id_sales_orders_id_fk/);
  });
  it("has stock_reservations.sales_line_id -> sales_order_lines.id", () => {
    expect(sql).toMatch(/stock_reservations_sales_line_id_sales_order_lines_id_fk/);
  });
  it("has production_receipts.account_entry_id -> account_entries.id", () => {
    expect(sql).toMatch(/production_receipts_account_entry_id_account_entries_id_fk/);
  });
});

// Duplicate safety
describe("WP-00-03D migration SQL — no duplicate names", () => {
  const sql = readMigrationSQL("0003_");
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

// Live-DB tests BLOCKED
describe("WP-00-03D live-DB tests (BLOCKED — 6 tests)", () => {
  it.skip("BLOCKED-1: migration 0003 applies cleanly on top of 0000+0001+0002", () => {});
  it.skip("BLOCKED-2: sales_order_lines unique (tenant, order, line_no) enforced", () => {});
  it.skip("BLOCKED-3: profitability_snapshots unique (tenant, order, version) enforced", () => {});
  it.skip("BLOCKED-4: account_entries non-zero amount CHECK enforced", () => {});
  it.skip("BLOCKED-5: payments unique idempotency_key enforced", () => {});
  it.skip("BLOCKED-6: manual FKs (stock_reservations→sales, production_receipts→account_entries) enforced", () => {});
});
