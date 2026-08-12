/**
 * WP-08-01F MILESTONE B — Migration template definitions and CSV generation.
 *
 * Contract 08 §5.1: Normalized Historical Import Templates.
 * Contract 08 §7.1: Required Import Provenance.
 *
 * MVP scope: opening_balance import mode only (DEC-071).
 * Supported format: CSV (XLSX requires a reviewed maintained library).
 *
 * Each template includes:
 *   - template type, template version
 *   - required columns, optional columns
 *   - accepted values, date/unit/currency rules
 *   - an example row
 */
import "server-only";

export interface MigrationTemplateColumn {
  name: string;
  required: boolean;
  description: string;
  acceptedValues?: string[];
  example: string;
}

export interface MigrationTemplateDefinition {
  templateType: string;
  templateVersion: string;
  importMode: string;
  description: string;
  columns: MigrationTemplateColumn[];
  rules: {
    dateFormat: string;
    acceptedUnits: string[];
    acceptedCurrency: string;
    quantityMustBePositive: boolean;
  };
}

/**
 * The opening balance inventory template (DEC-071: MVP opening_balance only).
 * Contract 08 §7.1 Required Import Provenance + §8.6 Required Validation Rules.
 */
export const OPENING_BALANCE_INVENTORY_TEMPLATE: MigrationTemplateDefinition = {
  templateType: "opening_balance_inventory",
  templateVersion: "1.0",
  importMode: "opening_balance",
  description:
    "Normalized opening balance inventory template for historical migration. " +
    "Each row represents a single item/location opening balance entry.",
  columns: [
    {
      name: "entity_type",
      required: true,
      description: "Type of entity being imported (e.g. raw_yarn, single_yarn, twisted_yarn).",
      acceptedValues: ["raw_yarn", "single_yarn", "twisted_yarn", "customer_balance", "supplier_balance"],
      example: "raw_yarn",
    },
    {
      name: "name",
      required: true,
      description: "Display name of the entity.",
      example: "Cotton Yarn 30/1",
    },
    {
      name: "code",
      required: true,
      description: "Unique code for the entity within this batch.",
      example: "RY-001",
    },
    {
      name: "quantity",
      required: true,
      description: "Quantity in kilograms. Must be a valid positive number.",
      example: "100.500",
    },
    {
      name: "unit",
      required: true,
      description: "Unit of measurement.",
      acceptedValues: ["kg", "ton"],
      example: "kg",
    },
    {
      name: "date",
      required: true,
      description: "Effective date of the opening balance (ISO 8601: YYYY-MM-DD). Must not be in the future.",
      example: "2024-01-01",
    },
    {
      name: "item_id",
      required: true,
      description: "UUID of the referenced inventory item master.",
      example: "00000000-0000-4000-8000-item00000001",
    },
    {
      name: "customer_id",
      required: false,
      description: "UUID of the referenced customer (required for customer_balance entity_type).",
      example: "00000000-0000-4000-8000-cust00000001",
    },
    {
      name: "supplier_id",
      required: false,
      description: "UUID of the referenced supplier (required for supplier_balance entity_type).",
      example: "00000000-0000-4000-8000-supp00000001",
    },
    {
      name: "location_id",
      required: false,
      description: "UUID of the location for inventory items.",
      example: "00000000-0000-4000-8000-loc000000001",
    },
    {
      name: "balance",
      required: false,
      description: "Opening balance amount for party balance entities.",
      example: "5000.00",
    },
    {
      name: "currency",
      required: false,
      description: "Currency code. Only EGP is accepted for MVP.",
      acceptedValues: ["EGP"],
      example: "EGP",
    },
  ],
  rules: {
    dateFormat: "YYYY-MM-DD (ISO 8601)",
    acceptedUnits: ["kg", "ton"],
    acceptedCurrency: "EGP",
    quantityMustBePositive: true,
  },
};

/**
 * Generate a CSV template string from a template definition.
 * Includes header row with column names and one example row.
 * Formula-injection-safe: prepends a single quote to any cell starting
 * with =, +, -, @, or tab to prevent spreadsheet formula injection.
 */
export function generateTemplateCsv(template: MigrationTemplateDefinition): string {
  const headers = template.columns.map((c) => c.name);
  const exampleRow = template.columns.map((c) => sanitizeCsvCell(c.example));
  const rows = [headers.join(","), exampleRow.join(",")];
  return rows.join("\n") + "\n";
}

/**
 * Sanitize a CSV cell value to prevent formula injection.
 * Prepends a single quote to any value starting with =, +, -, @, or tab.
 */
function sanitizeCsvCell(value: string): string {
  const dangerous = /^[=+\-@\t\r]/;
  if (dangerous.test(value)) {
    return `'${value}`;
  }
  // Escape quotes and commas
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Get all available template definitions.
 */
export function getAvailableTemplates(): MigrationTemplateDefinition[] {
  return [OPENING_BALANCE_INVENTORY_TEMPLATE];
}

/**
 * Find a template by type and version.
 */
export function findTemplate(templateType: string, templateVersion: string): MigrationTemplateDefinition | null {
  return getAvailableTemplates().find(
    (t) => t.templateType === templateType && t.templateVersion === templateVersion,
  ) ?? null;
}
