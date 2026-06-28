/**
 * WP-01-02 tests — redaction helpers / DTO patterns.
 *
 * Contract: docs/contracts/11_permission_matrix.md §8, §11.
 * Contract: docs/contracts/12_testing_and_regression_plan.md §7
 *   "assert forbidden properties are absent, not merely null/hidden".
 */
import { describe, it, expect } from "vitest";
import {
  redactFields,
  redactFieldsDeep,
  createRoleRedactor,
  createUniversalSecretRedactor,
  createErrorRedactor,
  redactExportRows,
  redactChart,
  redactResponse,
  deniedFieldKeysForUser,
  isSubjectToWorkerCeiling,
  UNIVERSAL_DENIED_FIELD_KEYS,
  ACCOUNTANT_DENIED_FIELD_KEYS,
} from "../redaction";
import { resolveEffectivePermissions } from "../effective-permissions";
import { WORKER_DENIED_FIELD_KEYS } from "../worker-financial-deny";
import { TEST_ROLE_PERMISSION_MATRIX } from "../role-fixtures";
import {
  SAMPLE_RAW_RECEIPT_DTO,
  SAMPLE_SALES_ORDER_DTO,
  SAMPLE_CHART_DTO,
  SAMPLE_ERROR_OBJECT,
} from "../role-fixtures";

const MATRIX = TEST_ROLE_PERMISSION_MATRIX;

describe("redactFields (shallow)", () => {
  it("removes forbidden keys (absent, not null)", () => {
    const obj = { a: 1, b: 2, c: 3 };
    const forbidden = new Set(["b"]);
    const result = redactFields(obj, forbidden);
    expect(result).toEqual({ a: 1, c: 3 });
    expect("b" in result).toBe(false); // ABSENT, not null
  });

  it("does not mutate the input object", () => {
    const obj = { a: 1, b: 2 };
    const forbidden = new Set(["b"]);
    redactFields(obj, forbidden);
    expect(obj).toEqual({ a: 1, b: 2 }); // unchanged
  });

  it("handles empty forbidden set (no-op)", () => {
    const obj = { a: 1, b: 2 };
    const result = redactFields(obj, new Set());
    expect(result).toEqual({ a: 1, b: 2 });
  });
});

describe("redactFieldsDeep (nested + arrays)", () => {
  it("redacts forbidden keys at the top level", () => {
    const obj = { a: 1, purchase_price_per_ton: "150.00", b: 2 };
    const forbidden = new Set(["purchase_price_per_ton"]);
    const result = redactFieldsDeep(obj, forbidden);
    expect(result).toEqual({ a: 1, b: 2 });
    expect("purchase_price_per_ton" in result).toBe(false);
  });

  it("redacts forbidden keys in nested objects", () => {
    const obj = {
      supplier: {
        name: "Test Supplier",
        supplier_balance: "75000.00",
      },
    };
    const forbidden = new Set(["supplier_balance"]);
    const result = redactFieldsDeep(obj, forbidden);
    expect(result).toEqual({
      supplier: {
        name: "Test Supplier",
      },
    });
    expect("supplier_balance" in result.supplier).toBe(false);
  });

  it("redacts forbidden keys in array elements", () => {
    const obj = {
      lines: [
        { line_id: 1, qty_kg: "500.000", price_per_ton: "150.00" },
        { line_id: 2, qty_kg: "500.000", price_per_ton: "150.00" },
      ],
    };
    const forbidden = new Set(["price_per_ton"]);
    const result = redactFieldsDeep(obj, forbidden);
    expect(result.lines).toEqual([
      { line_id: 1, qty_kg: "500.000" },
      { line_id: 2, qty_kg: "500.000" },
    ]);
  });

  it("does not mutate the input", () => {
    const obj = { a: { b: 1, c: 2 } };
    const forbidden = new Set(["c"]);
    redactFieldsDeep(obj, forbidden);
    expect(obj.a).toEqual({ b: 1, c: 2 }); // unchanged
  });

  it("handles null and undefined", () => {
    expect(redactFieldsDeep(null, new Set(["x"]))).toBe(null);
    expect(redactFieldsDeep(undefined, new Set(["x"]))).toBe(undefined);
  });

  it("handles primitives (returns as-is)", () => {
    expect(redactFieldsDeep("string", new Set(["x"]))).toBe("string");
    expect(redactFieldsDeep(42, new Set(["x"]))).toBe(42);
    expect(redactFieldsDeep(true, new Set(["x"]))).toBe(true);
  });
});

describe("createRoleRedactor", () => {
  it("returns identity function for Owner (no Worker ceiling)", () => {
    const ownerEff = resolveEffectivePermissions(["owner"], MATRIX);
    const redactor = createRoleRedactor(ownerEff);
    const dto = { ...SAMPLE_RAW_RECEIPT_DTO };
    const result = redactor(dto);
    // Owner sees everything — no redaction
    expect(result.purchase_price_per_ton).toBe("150.00");
    expect(result.total_purchase_cost).toBe("150000.00");
    expect(result.supplier_balance).toBe("75000.00");
  });

  it("returns identity function for Accountant (no Worker ceiling)", () => {
    const acctEff = resolveEffectivePermissions(["accountant"], MATRIX);
    const redactor = createRoleRedactor(acctEff);
    const dto = { ...SAMPLE_RAW_RECEIPT_DTO };
    const result = redactor(dto);
    expect(result.purchase_price_per_ton).toBe("150.00");
  });

  it("redacts financial fields for Warehouse worker (DEC-063)", () => {
    const whEff = resolveEffectivePermissions(["warehouse_employee"], MATRIX);
    const redactor = createRoleRedactor(whEff);
    const dto = { ...SAMPLE_RAW_RECEIPT_DTO };
    const result = redactor(dto);

    // Operational fields present
    expect(result.id).toBe(SAMPLE_RAW_RECEIPT_DTO.id);
    expect(result.batch_number).toBe(SAMPLE_RAW_RECEIPT_DTO.batch_number);
    expect(result.received_qty_kg).toBe(SAMPLE_RAW_RECEIPT_DTO.received_qty_kg);
    expect(result.quality_status).toBe(SAMPLE_RAW_RECEIPT_DTO.quality_status);

    // Financial fields ABSENT (not null)
    expect("purchase_price_per_ton" in result).toBe(false);
    expect("total_purchase_cost" in result).toBe(false);
    expect("supplier_balance" in result).toBe(false);

    // Nested object financial field also redacted
    expect(result.supplier?.name).toBe("Test Supplier");
    expect("supplier_balance" in (result.supplier ?? {})).toBe(false);

    // Array element financial fields also redacted
    expect(result.lines?.[0]?.qty_kg).toBe("500.000");
    expect("price_per_ton" in (result.lines?.[0] ?? {})).toBe(false);
    expect("net_revenue" in (result.lines?.[0] ?? {})).toBe(false);
  });

  it("redacts financial fields for Production worker", () => {
    const prodEff = resolveEffectivePermissions(["production_employee"], MATRIX);
    const redactor = createRoleRedactor(prodEff);
    const dto = { ...SAMPLE_RAW_RECEIPT_DTO };
    const result = redactor(dto);
    expect("purchase_price_per_ton" in result).toBe(false);
    expect("total_purchase_cost" in result).toBe(false);
  });

  it("redacts financial fields for Quality worker", () => {
    const qualEff = resolveEffectivePermissions(["quality_employee"], MATRIX);
    const redactor = createRoleRedactor(qualEff);
    const dto = { ...SAMPLE_RAW_RECEIPT_DTO };
    const result = redactor(dto);
    expect("purchase_price_per_ton" in result).toBe(false);
  });

  it("redacts for multi-role Owner+Warehouse (DEC-063 wins)", () => {
    const multiEff = resolveEffectivePermissions(["owner", "warehouse_employee"], MATRIX);
    const redactor = createRoleRedactor(multiEff);
    const dto = { ...SAMPLE_RAW_RECEIPT_DTO };
    const result = redactor(dto);
    expect("purchase_price_per_ton" in result).toBe(false);
    expect("total_purchase_cost" in result).toBe(false);
    expect("supplier_balance" in result).toBe(false);
  });
});

describe("createUniversalSecretRedactor (defense-in-depth for secrets)", () => {
  it("removes password, secret_key, token fields from any response", () => {
    const redactor = createUniversalSecretRedactor();
    const dto = {
      user_id: "u1",
      name: "Test",
      password: "should-not-be-here",
      secret_key: "should-not-be-here",
      database_url: "should-not-be-here",
    };
    const result = redactor(dto);
    expect(result.user_id).toBe("u1");
    expect(result.name).toBe("Test");
    expect("password" in result).toBe(false);
    expect("secret_key" in result).toBe(false);
    expect("database_url" in result).toBe(false);
  });

  it("applies to all roles (no application role sees secrets per Contract 11 §8)", () => {
    const ownerEff = resolveEffectivePermissions(["owner"], MATRIX);
    const whEff = resolveEffectivePermissions(["warehouse_employee"], MATRIX);
    const dto = { password: "x", secret_key: "y", normal_field: "z" };

    // Universal redactor is role-agnostic
    const universal = createUniversalSecretRedactor();
    expect("password" in universal(dto)).toBe(false);
    expect("secret_key" in universal(dto)).toBe(false);
  });
});

describe("redactResponse (combined: Worker ceiling + universal secrets)", () => {
  it("redacts Worker financial fields AND universal secret fields for Warehouse worker", () => {
    const whEff = resolveEffectivePermissions(["warehouse_employee"], MATRIX);
    const dto = {
      received_qty_kg: "1000.000",
      purchase_price_per_ton: "150.00",
      password: "leaked",
      quality_status: "accepted",
    };
    const result = redactResponse(dto, whEff);
    expect(result.received_qty_kg).toBe("1000.000");
    expect(result.quality_status).toBe("accepted");
    expect("purchase_price_per_ton" in result).toBe(false);
    expect("password" in result).toBe(false);
  });

  it("redacts only universal secret fields for Owner (no Worker ceiling)", () => {
    const ownerEff = resolveEffectivePermissions(["owner"], MATRIX);
    const dto = {
      purchase_price_per_ton: "150.00",
      password: "leaked",
    };
    const result = redactResponse(dto, ownerEff);
    expect(result.purchase_price_per_ton).toBe("150.00"); // Owner sees financial
    expect("password" in result).toBe(false); // but NOT secrets
  });
});

describe("createErrorRedactor", () => {
  it("redacts financial fields from error context", () => {
    const whEff = resolveEffectivePermissions(["warehouse_employee"], MATRIX);
    const redactor = createErrorRedactor(whEff);
    const error = { ...SAMPLE_ERROR_OBJECT };
    const result = redactor(error);

    expect(result.message).toBe("Failed to post sales order");
    expect(result.code).toBe("POSTING_FAILED");
    const ctx = result.context as Record<string, unknown> | undefined;
    const det = result.details as Record<string, unknown> | undefined;
    expect("net_revenue" in (ctx ?? {})).toBe(false);
    expect("profit_amount" in (ctx ?? {})).toBe(false);
    expect("customer_balance" in (det ?? {})).toBe(false);
  });
});

describe("redactExportRows", () => {
  it("redacts financial fields from each row in an export", () => {
    const rows = [
      { id: 1, qty_kg: "100.000", price_per_ton: "150.00", net_revenue: "15000.00" },
      { id: 2, qty_kg: "200.000", price_per_ton: "160.00", net_revenue: "32000.00" },
    ];
    const forbidden = new Set(["price_per_ton", "net_revenue"]);
    const result = redactExportRows(rows, forbidden);

    expect(result).toEqual([
      { id: 1, qty_kg: "100.000" },
      { id: 2, qty_kg: "200.000" },
    ]);
  });

  it("Workers cannot bypass through exports (Contract 11 §14)", () => {
    const whEff = resolveEffectivePermissions(["warehouse_employee"], MATRIX);
    const denied = deniedFieldKeysForUser(whEff);
    const rows = [
      { id: 1, qty_kg: "100.000", purchase_price_per_ton: "150.00" },
    ];
    const result = redactExportRows(rows, denied);
    expect(result[0]?.id).toBe(1);
    expect(result[0]?.qty_kg).toBe("100.000");
    expect("purchase_price_per_ton" in (result[0] ?? {})).toBe(false);
  });
});

describe("redactChart", () => {
  it("redacts financial fields from chart datasets", () => {
    const whEff = resolveEffectivePermissions(["warehouse_employee"], MATRIX);
    const denied = deniedFieldKeysForUser(whEff);
    const chart = { ...SAMPLE_CHART_DTO, datasets: [...SAMPLE_CHART_DTO.datasets] };
    const result = redactChart(chart as unknown as Record<string, unknown>, denied) as {
      datasets: Array<{ metric: string; data: number[] }>;
    };

    // Quantity dataset is kept (operational)
    const qtyDataset = result.datasets.find((d) => d.metric === "qty_kg");
    expect(qtyDataset).toBeDefined();

    // Financial datasets are REMOVED entirely
    const netRevDataset = result.datasets.find((d) => d.metric === "net_revenue");
    expect(netRevDataset).toBeUndefined();
    const profitDataset = result.datasets.find((d) => d.metric === "profit_amount");
    expect(profitDataset).toBeUndefined();
  });

  it("Owner sees all chart datasets (no redaction)", () => {
    const ownerEff = resolveEffectivePermissions(["owner"], MATRIX);
    const denied = deniedFieldKeysForUser(ownerEff);
    const chart = { ...SAMPLE_CHART_DTO, datasets: [...SAMPLE_CHART_DTO.datasets] };
    const result = redactChart(chart as unknown as Record<string, unknown>, denied) as {
      datasets: Array<{ metric: string }>;
    };
    expect(result.datasets.length).toBe(3);
  });
});

describe("deniedFieldKeysForUser", () => {
  it("returns universal secret fields for Owner (no Worker ceiling)", () => {
    const ownerEff = resolveEffectivePermissions(["owner"], MATRIX);
    const denied = deniedFieldKeysForUser(ownerEff);
    expect(denied.has("password")).toBe(true);
    expect(denied.has("secret_key")).toBe(true);
    expect(denied.has("purchase_price_per_ton")).toBe(false); // Owner sees financial
  });

  it("returns Worker financial fields + universal secrets for Warehouse worker", () => {
    const whEff = resolveEffectivePermissions(["warehouse_employee"], MATRIX);
    const denied = deniedFieldKeysForUser(whEff);
    expect(denied.has("password")).toBe(true);
    expect(denied.has("purchase_price_per_ton")).toBe(true);
    expect(denied.has("net_revenue")).toBe(true);
    expect(denied.has("profit_amount")).toBe(true);
  });
});

describe("isSubjectToWorkerCeiling", () => {
  it("returns false for Owner", () => {
    expect(isSubjectToWorkerCeiling(["owner"])).toBe(false);
  });

  it("returns false for Accountant", () => {
    expect(isSubjectToWorkerCeiling(["accountant"])).toBe(false);
  });

  it("returns true for Warehouse worker", () => {
    expect(isSubjectToWorkerCeiling(["warehouse_employee"])).toBe(true);
  });

  it("returns true for Production worker", () => {
    expect(isSubjectToWorkerCeiling(["production_employee"])).toBe(true);
  });

  it("returns true for Quality worker", () => {
    expect(isSubjectToWorkerCeiling(["quality_employee"])).toBe(true);
  });

  it("returns true for multi-role Owner+Warehouse (DEC-063)", () => {
    expect(isSubjectToWorkerCeiling(["owner", "warehouse_employee"])).toBe(true);
  });
});

describe("UNIVERSAL_DENIED_FIELD_KEYS", () => {
  it("contains password, secret_key, service_role_key, database_url, etc.", () => {
    expect(UNIVERSAL_DENIED_FIELD_KEYS.has("password")).toBe(true);
    expect(UNIVERSAL_DENIED_FIELD_KEYS.has("password_hash")).toBe(true);
    expect(UNIVERSAL_DENIED_FIELD_KEYS.has("secret_key")).toBe(true);
    expect(UNIVERSAL_DENIED_FIELD_KEYS.has("service_role_key")).toBe(true);
    expect(UNIVERSAL_DENIED_FIELD_KEYS.has("database_url")).toBe(true);
    expect(UNIVERSAL_DENIED_FIELD_KEYS.has("connection_string")).toBe(true);
    expect(UNIVERSAL_DENIED_FIELD_KEYS.has("api_key")).toBe(true);
    expect(UNIVERSAL_DENIED_FIELD_KEYS.has("private_key")).toBe(true);
    expect(UNIVERSAL_DENIED_FIELD_KEYS.has("session_token")).toBe(true);
    expect(UNIVERSAL_DENIED_FIELD_KEYS.has("refresh_token")).toBe(true);
  });

  it("does NOT contain operational fields", () => {
    expect(UNIVERSAL_DENIED_FIELD_KEYS.has("qty_kg")).toBe(false);
    expect(UNIVERSAL_DENIED_FIELD_KEYS.has("quality_status")).toBe(false);
    expect(UNIVERSAL_DENIED_FIELD_KEYS.has("location_id")).toBe(false);
  });
});

describe("ACCOUNTANT_DENIED_FIELD_KEYS (MVP — empty per Contract 11 §8)", () => {
  it("is empty for MVP (Accountant sees financial fields; audit-value scoping deferred)", () => {
    expect(ACCOUNTANT_DENIED_FIELD_KEYS.size).toBe(0);
  });
});

describe("Contract 12 §7 — forbidden properties are ABSENT, not null/hidden", () => {
  // This is the critical "no fetch-then-hide" assertion. Redacted fields
  // must be ABSENT from the response, not set to null or undefined.
  it("redacted fields are ABSENT (not null, not undefined, not 0)", () => {
    const whEff = resolveEffectivePermissions(["warehouse_employee"], MATRIX);
    const redactor = createRoleRedactor(whEff);
    const dto = {
      id: "x",
      purchase_price_per_ton: "150.00",
      net_revenue: "75000.00",
    };
    const result = redactor(dto);

    // The keys must not exist on the object at all
    expect(Object.keys(result).sort()).toEqual(["id"]);
    expect(Object.prototype.hasOwnProperty.call(result, "purchase_price_per_ton")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result, "net_revenue")).toBe(false);
  });

  it("deeply redacted nested fields are ABSENT", () => {
    const whEff = resolveEffectivePermissions(["warehouse_employee"], MATRIX);
    const redactor = createRoleRedactor(whEff);
    const dto = {
      supplier: {
        name: "Test",
        supplier_balance: "75000.00",
      },
      lines: [
        { qty_kg: "100", price_per_ton: "150" },
      ],
    };
    const result = redactor(dto);

    expect(Object.keys(result.supplier ?? {}).sort()).toEqual(["name"]);
    expect(Object.prototype.hasOwnProperty.call(result.supplier, "supplier_balance")).toBe(false);
    expect(Object.keys(result.lines[0] ?? {}).sort()).toEqual(["qty_kg"]);
  });
});
