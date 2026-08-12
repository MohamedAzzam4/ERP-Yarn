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

// ===========================================================================
// WP-08-01F TASK C — Complete MVP template coverage
//
// Contract 08 §5.1 + DEC-071: MVP = opening balances only.
// Supported domains (per reconciliation service entity types):
//   1. Opening inventory (raw_yarn, single_yarn, twisted_yarn)
//   2. Opening customer balances
//   3. Opening supplier balances
//   4. Opening factory (payable) balances
//   5. Opening WIP (production work-in-progress)
//
// Currency restriction: Contract 08 §8.6 states "EGP only" for MVP.
// Source: docs/contracts/08_historical_migration_contract.md §8.6 line 313.
// ===========================================================================

/**
 * Opening customer balance template.
 * Entity type: customer_balance
 * Reconciliation metric: customer_opening_balance
 */
export const OPENING_CUSTOMER_BALANCE_TEMPLATE: MigrationTemplateDefinition = {
  templateType: "opening_customer_balance",
  templateVersion: "1.0",
  importMode: "opening_balance",
  description:
    "قالب أرصدة العملاء الافتتاحية — يمثل كل صف رصيد افتتاحي لعميل. " +
    "يجب الإشارة إلى العميل بمعرف UUID صالح.",
  columns: [
    {
      name: "entity_type",
      required: true,
      description: "نوع الكيان — يجب أن يكون 'customer_balance'.",
      acceptedValues: ["customer_balance"],
      example: "customer_balance",
    },
    {
      name: "name",
      required: true,
      description: "اسم العميل.",
      example: "شركة النسيج المتحدة",
    },
    {
      name: "code",
      required: true,
      description: "كود العميل الفريد.",
      example: "CUST-001",
    },
    {
      name: "customer_id",
      required: true,
      description: "معرف UUID للعميل في النظام.",
      example: "00000000-0000-4000-8000-cust00000001",
    },
    {
      name: "balance",
      required: true,
      description: "الرصيد الافتتاحي. يمكن أن يكون سالباً (مدين) أو موجباً (دائن).",
      example: "5000.00",
    },
    {
      name: "currency",
      required: true,
      description: "العملة. EGP فقط للمرحلة الأولى (Contract 08 §8.6).",
      acceptedValues: ["EGP"],
      example: "EGP",
    },
    {
      name: "date",
      required: true,
      description: "تاريخ الرصيد الافتتاحي (YYYY-MM-DD).",
      example: "2024-01-01",
    },
    {
      name: "notes",
      required: false,
      description: "ملاحظات اختيارية.",
      example: "رصيد افتتاحي من نظام سابق",
    },
  ],
  rules: {
    dateFormat: "YYYY-MM-DD (ISO 8601)",
    acceptedUnits: [],
    acceptedCurrency: "EGP (Contract 08 §8.6)",
    quantityMustBePositive: false,
  },
};

/**
 * Opening supplier balance template.
 * Entity type: supplier_balance
 * Reconciliation metric: supplier_opening_balance
 */
export const OPENING_SUPPLIER_BALANCE_TEMPLATE: MigrationTemplateDefinition = {
  templateType: "opening_supplier_balance",
  templateVersion: "1.0",
  importMode: "opening_balance",
  description:
    "قالب أرصدة الموردين الافتتاحية — يمثل كل صف رصيد افتتاحي لمورد. " +
    "يجب الإشارة إلى المورد بمعرف UUID صالح.",
  columns: [
    {
      name: "entity_type",
      required: true,
      description: "نوع الكيان — يجب أن يكون 'supplier_balance'.",
      acceptedValues: ["supplier_balance"],
      example: "supplier_balance",
    },
    {
      name: "name",
      required: true,
      description: "اسم المورد.",
      example: "مصنع الغزل المصرى",
    },
    {
      name: "code",
      required: true,
      description: "كود المورد الفريد.",
      example: "SUPP-001",
    },
    {
      name: "supplier_id",
      required: true,
      description: "معرف UUID للمورد في النظام.",
      example: "00000000-0000-4000-8000-supp00000001",
    },
    {
      name: "balance",
      required: true,
      description: "الرصيد الافتتاحي. موجب = مستحق للمورد، سالب = دائن.",
      example: "15000.00",
    },
    {
      name: "currency",
      required: true,
      description: "العملة. EGP فقط للمرحلة الأولى (Contract 08 §8.6).",
      acceptedValues: ["EGP"],
      example: "EGP",
    },
    {
      name: "date",
      required: true,
      description: "تاريخ الرصيد الافتتاحي (YYYY-MM-DD).",
      example: "2024-01-01",
    },
    {
      name: "notes",
      required: false,
      description: "ملاحظات اختيارية.",
      example: "—",
    },
  ],
  rules: {
    dateFormat: "YYYY-MM-DD (ISO 8601)",
    acceptedUnits: [],
    acceptedCurrency: "EGP (Contract 08 §8.6)",
    quantityMustBePositive: false,
  },
};

/**
 * Opening factory (payable) balance template.
 * Entity type: factory_balance
 * Reconciliation metric: factory_payable_balance
 */
export const OPENING_FACTORY_BALANCE_TEMPLATE: MigrationTemplateDefinition = {
  templateType: "opening_factory_balance",
  templateVersion: "1.0",
  importMode: "opening_balance",
  description:
    "قالب أرصدة المصانع الخارجية الافتتاحية — يمثل كل صف رصيد مستحق لمصنع خارجي. " +
    "يجب الإشارة إلى المصنع بمعرف UUID صالح.",
  columns: [
    {
      name: "entity_type",
      required: true,
      description: "نوع الكيان — يجب أن يكون 'factory_balance'.",
      acceptedValues: ["factory_balance"],
      example: "factory_balance",
    },
    {
      name: "name",
      required: true,
      description: "اسم المصنع.",
      example: "مصنع النسيج الحديث",
    },
    {
      name: "code",
      required: true,
      description: "كود المصنع الفريد.",
      example: "FAC-001",
    },
    {
      name: "factory_id",
      required: true,
      description: "معرف UUID للمصنع الخارجي في النظام.",
      example: "00000000-0000-4000-8000-fact00000001",
    },
    {
      name: "location_id",
      required: false,
      description: "معرف UUID لموقع المصنع (إن وجد).",
      example: "00000000-0000-4000-8000-loc000000001",
    },
    {
      name: "balance",
      required: true,
      description: "الرصيد الافتتاحي المستحق للمصنع.",
      example: "8000.00",
    },
    {
      name: "currency",
      required: true,
      description: "العملة. EGP فقط للمرحلة الأولى (Contract 08 §8.6).",
      acceptedValues: ["EGP"],
      example: "EGP",
    },
    {
      name: "date",
      required: true,
      description: "تاريخ الرصيد الافتتاحي (YYYY-MM-DD).",
      example: "2024-01-01",
    },
    {
      name: "factory_qty",
      required: false,
      description: "كمية المخزون الموجودة tại المصنع (كجم) إن وجدت.",
      example: "500.000",
    },
    {
      name: "notes",
      required: false,
      description: "ملاحظات اختيارية.",
      example: "—",
    },
  ],
  rules: {
    dateFormat: "YYYY-MM-DD (ISO 8601)",
    acceptedUnits: ["kg"],
    acceptedCurrency: "EGP (Contract 08 §8.6)",
    quantityMustBePositive: false,
  },
};

/**
 * Opening WIP (work-in-progress) template.
 * Entity type: wip_opening
 * Reconciliation metric: wip_opening_qty
 *
 * Contract 08 §8.7.4: Production/WIP reconciliation.
 * DEC-071: WIP opening representation must reconcile without duplicated
 * issue/receipt/payable.
 */
export const OPENING_WIP_TEMPLATE: MigrationTemplateDefinition = {
  templateType: "opening_wip",
  templateVersion: "1.0",
  importMode: "opening_balance",
  description:
    "قالب المخزون تحت التشغيل الافتتاحي — يمثل كل صف كمية تحت التشغيل " +
    "لمادة خام أو منتج في مرحلة إنتاج. يجب الإشارة إلى الصنف والموقع.",
  columns: [
    {
      name: "entity_type",
      required: true,
      description: "نوع الكيان — يجب أن يكون 'wip_opening'.",
      acceptedValues: ["wip_opening"],
      example: "wip_opening",
    },
    {
      name: "name",
      required: true,
      description: "اسم المنتج/الصنف تحت التشغيل.",
      example: "خيط مبروم 20/2",
    },
    {
      name: "code",
      required: true,
      description: "كود الصنف الفريد.",
      example: "WIP-001",
    },
    {
      name: "item_id",
      required: true,
      description: "معرف UUID للصنف في النظام.",
      example: "00000000-0000-4000-8000-item00000001",
    },
    {
      name: "location_id",
      required: true,
      description: "معرف UUID للموقع (المصنع/المخزن).",
      example: "00000000-0000-4000-8000-loc000000001",
    },
    {
      name: "wip_qty",
      required: true,
      description: "الكمية تحت التشغيل (كجم).",
      example: "250.000",
    },
    {
      name: "unit",
      required: true,
      description: "وحدة القياس.",
      acceptedValues: ["kg", "ton"],
      example: "kg",
    },
    {
      name: "date",
      required: true,
      description: "تاريخ الرصيد الافتتاحي (YYYY-MM-DD).",
      example: "2024-01-01",
    },
    {
      name: "issue_qty",
      required: false,
      description: "كمية المواد المنصرفة للإنتاج (للمطابقة).",
      example: "300.000",
    },
    {
      name: "receipt_qty",
      required: false,
      description: "كمية المنتجات المستلمة من الإنتاج (للمطابقة).",
      example: "200.000",
    },
    {
      name: "notes",
      required: false,
      description: "ملاحظات اختيارية.",
      example: "تحت التشغيل من مرحلة البرم",
    },
  ],
  rules: {
    dateFormat: "YYYY-MM-DD (ISO 8601)",
    acceptedUnits: ["kg", "ton"],
    acceptedCurrency: "EGP (Contract 08 §8.6)",
    quantityMustBePositive: true,
  },
};

/**
 * Get all available template definitions.
 */
export function getAvailableTemplates(): MigrationTemplateDefinition[] {
  return [
    OPENING_BALANCE_INVENTORY_TEMPLATE,
    OPENING_CUSTOMER_BALANCE_TEMPLATE,
    OPENING_SUPPLIER_BALANCE_TEMPLATE,
    OPENING_FACTORY_BALANCE_TEMPLATE,
    OPENING_WIP_TEMPLATE,
  ];
}

/**
 * Find a template by type and version.
 */
export function findTemplate(templateType: string, templateVersion: string): MigrationTemplateDefinition | null {
  return getAvailableTemplates().find(
    (t) => t.templateType === templateType && t.templateVersion === templateVersion,
  ) ?? null;
}
