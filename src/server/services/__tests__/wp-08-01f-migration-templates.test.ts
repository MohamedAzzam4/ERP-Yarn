/**
 * WP-08-01F MILESTONE B — Tests for migration templates and CSV parser.
 */
import { describe, it, expect } from "vitest";
import {
  OPENING_BALANCE_INVENTORY_TEMPLATE,
  OPENING_CUSTOMER_BALANCE_TEMPLATE,
  OPENING_SUPPLIER_BALANCE_TEMPLATE,
  OPENING_FACTORY_BALANCE_TEMPLATE,
  OPENING_WIP_TEMPLATE,
  generateTemplateCsv,
  findTemplate,
  getAvailableTemplates,
} from "../migration-templates";
import { parseCsv } from "../migration-csv-parser";

describe("WP-08-01F MILESTONE B — Migration templates", () => {
  describe("Template definitions", () => {
    it("opening balance inventory template has correct type and version", () => {
      expect(OPENING_BALANCE_INVENTORY_TEMPLATE.templateType).toBe("opening_balance_inventory");
      expect(OPENING_BALANCE_INVENTORY_TEMPLATE.templateVersion).toBe("1.0");
      expect(OPENING_BALANCE_INVENTORY_TEMPLATE.importMode).toBe("opening_balance");
    });

    it("template has required columns", () => {
      const requiredColumns = OPENING_BALANCE_INVENTORY_TEMPLATE.columns.filter((c) => c.required);
      expect(requiredColumns.length).toBeGreaterThan(0);
      const names = requiredColumns.map((c) => c.name);
      expect(names).toContain("entity_type");
      expect(names).toContain("name");
      expect(names).toContain("code");
      expect(names).toContain("quantity");
      expect(names).toContain("unit");
      expect(names).toContain("date");
      expect(names).toContain("item_id");
    });

    it("template has rules for date, unit, currency", () => {
      expect(OPENING_BALANCE_INVENTORY_TEMPLATE.rules.dateFormat).toContain("YYYY-MM-DD");
      expect(OPENING_BALANCE_INVENTORY_TEMPLATE.rules.acceptedUnits).toContain("kg");
      expect(OPENING_BALANCE_INVENTORY_TEMPLATE.rules.acceptedCurrency).toBe("EGP");
    });

    it("template has example row values", () => {
      for (const col of OPENING_BALANCE_INVENTORY_TEMPLATE.columns) {
        expect(col.example).toBeTruthy();
      }
    });

    it("findTemplate returns the correct template", () => {
      const t = findTemplate("opening_balance_inventory", "1.0");
      expect(t).not.toBeNull();
      expect(t?.templateType).toBe("opening_balance_inventory");
    });

    it("findTemplate returns null for unknown template", () => {
      expect(findTemplate("unknown", "1.0")).toBeNull();
    });

    // --- Customer balance template ---
    it("customer balance template has correct type and required columns", () => {
      expect(OPENING_CUSTOMER_BALANCE_TEMPLATE.templateType).toBe("opening_customer_balance");
      const required = OPENING_CUSTOMER_BALANCE_TEMPLATE.columns.filter((c) => c.required).map((c) => c.name);
      expect(required).toContain("customer_id");
      expect(required).toContain("balance");
      expect(required).toContain("currency");
      expect(required).toContain("date");
    });

    it("customer balance template has Arabic description", () => {
      expect(OPENING_CUSTOMER_BALANCE_TEMPLATE.description).toContain("العملاء");
    });

    // --- Supplier balance template ---
    it("supplier balance template has correct type and required columns", () => {
      expect(OPENING_SUPPLIER_BALANCE_TEMPLATE.templateType).toBe("opening_supplier_balance");
      const required = OPENING_SUPPLIER_BALANCE_TEMPLATE.columns.filter((c) => c.required).map((c) => c.name);
      expect(required).toContain("supplier_id");
      expect(required).toContain("balance");
    });

    // --- Factory balance template ---
    it("factory balance template has correct type and required columns", () => {
      expect(OPENING_FACTORY_BALANCE_TEMPLATE.templateType).toBe("opening_factory_balance");
      const required = OPENING_FACTORY_BALANCE_TEMPLATE.columns.filter((c) => c.required).map((c) => c.name);
      expect(required).toContain("factory_id");
      expect(required).toContain("balance");
    });

    it("factory balance template has optional factory_qty", () => {
      const optional = OPENING_FACTORY_BALANCE_TEMPLATE.columns.filter((c) => !c.required).map((c) => c.name);
      expect(optional).toContain("factory_qty");
    });

    // --- WIP template ---
    it("WIP template has correct type and required columns", () => {
      expect(OPENING_WIP_TEMPLATE.templateType).toBe("opening_wip");
      const required = OPENING_WIP_TEMPLATE.columns.filter((c) => c.required).map((c) => c.name);
      expect(required).toContain("item_id");
      expect(required).toContain("location_id");
      expect(required).toContain("wip_qty");
      expect(required).toContain("unit");
    });

    it("WIP template has optional issue_qty and receipt_qty", () => {
      const optional = OPENING_WIP_TEMPLATE.columns.filter((c) => !c.required).map((c) => c.name);
      expect(optional).toContain("issue_qty");
      expect(optional).toContain("receipt_qty");
    });

    // --- All templates ---
    it("getAvailableTemplates returns 5 templates", () => {
      expect(getAvailableTemplates().length).toBe(5);
    });

    it("all templates have EGP-only currency restriction (Contract 08 §8.6)", () => {
      for (const t of getAvailableTemplates()) {
        expect(t.rules.acceptedCurrency).toContain("EGP");
      }
    });

    it("all templates have at least one example row value per column", () => {
      for (const t of getAvailableTemplates()) {
        for (const col of t.columns) {
          expect(col.example, `${t.templateType}.${col.name} example`).toBeTruthy();
        }
      }
    });

    it("all templates can be found by findTemplate", () => {
      for (const t of getAvailableTemplates()) {
        const found = findTemplate(t.templateType, t.templateVersion);
        expect(found?.templateType).toBe(t.templateType);
      }
    });

    it("all templates generate valid CSV", () => {
      for (const t of getAvailableTemplates()) {
        const csv = generateTemplateCsv(t);
        expect(csv).toContain(t.columns[0]!.name);
        // Parse back to verify
        const result = parseCsv(csv, t);
        expect(result.errors).toHaveLength(0);
        expect(result.totalRows).toBe(1); // Example row
      }
    });

    it("customer balance template parses valid Arabic CSV", () => {
      const csv = [
        "entity_type,name,code,customer_id,balance,currency,date",
        "customer_balance,شركة النسيج المتحدة,CUST-001,00000000-0000-4000-8000-cust00000001,5000.00,EGP,2024-01-01",
      ].join("\n");
      const result = parseCsv(csv, OPENING_CUSTOMER_BALANCE_TEMPLATE);
      expect(result.errors).toHaveLength(0);
      expect(result.rows[0]?.columns["name"]).toBe("شركة النسيج المتحدة");
    });

    it("supplier balance template rejects missing required column", () => {
      const csv = "entity_type,name,code\nsupplier_balance,Test,SUPP-001\n";
      const result = parseCsv(csv, OPENING_SUPPLIER_BALANCE_TEMPLATE);
      expect(result.errors.some((e) => e.includes("Missing required columns"))).toBe(true);
    });

    it("factory balance template rejects extra columns", () => {
      const csv = [
        "entity_type,name,code,factory_id,balance,currency,date,extra_col",
        "factory_balance,Test,FAC-001,00000000-0000-4000-8000-fact00000001,8000.00,EGP,2024-01-01,extra",
      ].join("\n");
      const result = parseCsv(csv, OPENING_FACTORY_BALANCE_TEMPLATE);
      expect(result.errors.some((e) => e.includes("Unknown columns"))).toBe(true);
    });

    it("WIP template parses valid CSV with optional fields", () => {
      const csv = [
        "entity_type,name,code,item_id,location_id,wip_qty,unit,date,issue_qty,receipt_qty",
        "wip_opening,خيط مبروم 20/2,WIP-001,00000000-0000-4000-8000-item00000001,00000000-0000-4000-8000-loc000000001,250.000,kg,2024-01-01,300.000,200.000",
      ].join("\n");
      const result = parseCsv(csv, OPENING_WIP_TEMPLATE);
      expect(result.errors).toHaveLength(0);
      expect(result.rows[0]?.columns["wip_qty"]).toBe("250.000");
    });

    it("getAvailableTemplates returns at least one template", () => {
      expect(getAvailableTemplates().length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("CSV generation", () => {
    it("generates CSV with header and example row", () => {
      const csv = generateTemplateCsv(OPENING_BALANCE_INVENTORY_TEMPLATE);
      const lines = csv.trim().split("\n");
      expect(lines.length).toBe(2); // header + example

      const headers = lines[0]!.split(",");
      expect(headers).toContain("entity_type");
      expect(headers).toContain("name");
      expect(headers).toContain("code");
      expect(headers).toContain("quantity");
    });

    it("CSV generation is formula-injection-safe", () => {
      // The example values should not start with =, +, -, @
      const csv = generateTemplateCsv(OPENING_BALANCE_INVENTORY_TEMPLATE);
      const lines = csv.trim().split("\n");
      for (const line of lines) {
        const cells = line.split(",");
        for (const cell of cells) {
          // If a cell starts with a dangerous character, it should be prefixed with '
          if (/^[=+@]/.test(cell)) {
            expect(cell.startsWith("'")).toBe(true);
          }
        }
      }
    });
  });
});

describe("WP-08-01F MILESTONE B — CSV parser", () => {
  const template = OPENING_BALANCE_INVENTORY_TEMPLATE;

  it("parses a valid CSV with correct headers", () => {
    const csv = [
      "entity_type,name,code,quantity,unit,date,item_id",
      "raw_yarn,Test Yarn,RY-001,100,kg,2024-01-01,00000000-0000-4000-8000-item00000001",
    ].join("\n");

    const result = parseCsv(csv, template);
    expect(result.errors).toHaveLength(0);
    expect(result.totalRows).toBe(1);
    expect(result.rows[0]?.columns["entity_type"]).toBe("raw_yarn");
    expect(result.rows[0]?.columns["name"]).toBe("Test Yarn");
    expect(result.rows[0]?.rowNumber).toBe(1);
  });

  it("rejects missing required columns", () => {
    const csv = [
      "entity_type,name,code",
      "raw_yarn,Test,RY-001",
    ].join("\n");

    const result = parseCsv(csv, template);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("Missing required columns");
  });

  it("rejects formula injection in cells", () => {
    const csv = [
      "entity_type,name,code,quantity,unit,date,item_id",
      "=CMD(),Test,RY-001,100,kg,2024-01-01,00000000-0000-4000-8000-item00000001",
    ].join("\n");

    const result = parseCsv(csv, template);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.includes("dangerous character"))).toBe(true);
  });

  it("rejects @ formula injection", () => {
    const csv = [
      "entity_type,name,code,quantity,unit,date,item_id",
      "@SUM(A1),Test,RY-001,100,kg,2024-01-01,00000000-0000-4000-8000-item00000001",
    ].join("\n");

    const result = parseCsv(csv, template);
    expect(result.errors.some((e) => e.includes("dangerous character"))).toBe(true);
  });

  it("handles quoted fields with commas", () => {
    const csv = [
      'entity_type,name,code,quantity,unit,date,item_id',
      'raw_yarn,"Yarn, Cotton",RY-001,100,kg,2024-01-01,00000000-0000-4000-8000-item00000001',
    ].join("\n");

    const result = parseCsv(csv, template);
    expect(result.errors).toHaveLength(0);
    expect(result.rows[0]?.columns["name"]).toBe("Yarn, Cotton");
  });

  it("handles escaped quotes in fields", () => {
    const csv = [
      'entity_type,name,code,quantity,unit,date,item_id',
      'raw_yarn,"Yarn ""Premium""",RY-001,100,kg,2024-01-01,00000000-0000-4000-8000-item00000001',
    ].join("\n");

    const result = parseCsv(csv, template);
    expect(result.errors).toHaveLength(0);
    expect(result.rows[0]?.columns["name"]).toBe('Yarn "Premium"');
  });

  it("enforces file size limit", () => {
    const largeContent = "entity_type,name,code,quantity,unit,date,item_id\n" + "x".repeat(11 * 1024 * 1024);
    const result = parseCsv(largeContent, template, { maxFileSizeBytes: 10 * 1024 * 1024 });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("exceeds maximum");
  });

  it("enforces row count limit", () => {
    const header = "entity_type,name,code,quantity,unit,date,item_id\n";
    const rows = Array(15).fill("raw_yarn,Test,RY-001,100,kg,2024-01-01,00000000-0000-4000-8000-item00000001").join("\n");
    const result = parseCsv(header + rows, template, { maxRows: 10 });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("exceeds maximum");
  });

  it("rejects empty file", () => {
    const result = parseCsv("", template);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("empty");
  });

  it("preserves row lineage (row number)", () => {
    const csv = [
      "entity_type,name,code,quantity,unit,date,item_id",
      "raw_yarn,Row1,RY-001,100,kg,2024-01-01,00000000-0000-4000-8000-item00000001",
      "raw_yarn,Row2,RY-002,200,kg,2024-01-01,00000000-0000-4000-8000-item00000001",
      "raw_yarn,Row3,RY-003,300,kg,2024-01-01,00000000-0000-4000-8000-item00000001",
    ].join("\n");

    const result = parseCsv(csv, template);
    expect(result.totalRows).toBe(3);
    expect(result.rows[0]?.rowNumber).toBe(1);
    expect(result.rows[1]?.rowNumber).toBe(2);
    expect(result.rows[2]?.rowNumber).toBe(3);
  });

  it("handles CRLF line endings", () => {
    const csv = "entity_type,name,code,quantity,unit,date,item_id\r\nraw_yarn,Test,RY-001,100,kg,2024-01-01,00000000-0000-4000-8000-item00000001\r\n";
    const result = parseCsv(csv, template);
    expect(result.errors).toHaveLength(0);
    expect(result.totalRows).toBe(1);
  });

  it("detects unknown columns", () => {
    const csv = [
      "entity_type,name,code,quantity,unit,date,item_id,unknown_col",
      "raw_yarn,Test,RY-001,100,kg,2024-01-01,00000000-0000-4000-8000-item00000001,extra",
    ].join("\n");

    const result = parseCsv(csv, template);
    expect(result.errors.some((e) => e.includes("Unknown columns"))).toBe(true);
  });
});
