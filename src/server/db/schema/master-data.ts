/**
 * Master data tables: suppliers, customers, locations, external_factories,
 * fiber_types, product_types, quality_parameters.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §8
 *   Required: suppliers, customers, locations, external_factories,
 *   fiber_types, product_types, and quality_parameters.
 *
 *   Each has tenant, stable code, Arabic name, optional English name,
 *   normalized name where safe, active/inactive state, notes and audit
 *   metadata.
 *
 * Constraints:
 *   - tenant-scoped code uniqueness;
 *   - approved normalized-name uniqueness where safe;
 *   - each external factory has exactly one linked location;
 *   - unique (tenant_id, linked_location_id);
 *   - factory type is single_yarn, twisting, or both;
 *   - factory location type corresponds to factory type;
 *   - inactive records remain visible on old documents and unavailable
 *     for new transactions.
 *
 * Referenced master data cannot be hard-deleted. Duplicate resolution
 * uses audited alias/merge mapping without silently rewriting historical
 * identity.
 */
import {
  text,
  uuid,
  numeric,
  pgTable,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { tenantIdColumn, makeTenantOwnedRow } from "./_helpers";
import { users } from "./users";
import { factoryType, locationType, masterDataStatus } from "./inventory-enums";

const usersId = users.id!;

// ---------------------------------------------------------------------------
// suppliers
// ---------------------------------------------------------------------------

export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    supplierCode: text("supplier_code").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en"),
    normalizedName: text("normalized_name").notNull(),
    contactInfoJson: text("contact_info_json"),
    status: masterDataStatus("status").notNull().default("active"),
    notes: text("notes"),
    ...makeTenantOwnedRow(usersId),
  },
  (t) => [
    uniqueIndex("suppliers_tenant_code_unique_idx").on(
      t.tenantId,
      t.supplierCode,
    ),
    uniqueIndex("suppliers_tenant_normalized_name_unique_idx").on(
      t.tenantId,
      t.normalizedName,
    ),
    index("suppliers_tenant_status_idx").on(t.tenantId, t.status),
  ],
);

export type Supplier = typeof suppliers.$inferSelect;
export type NewSupplier = typeof suppliers.$inferInsert;

// ---------------------------------------------------------------------------
// customers
// ---------------------------------------------------------------------------

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    customerCode: text("customer_code").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en"),
    normalizedName: text("normalized_name").notNull(),
    contactInfoJson: text("contact_info_json"),
    creditLimit: numeric("credit_limit", { precision: 18, scale: 2 }),
    creditTerms: text("credit_terms"),
    status: masterDataStatus("status").notNull().default("active"),
    notes: text("notes"),
    ...makeTenantOwnedRow(usersId),
  },
  (t) => [
    uniqueIndex("customers_tenant_code_unique_idx").on(
      t.tenantId,
      t.customerCode,
    ),
    uniqueIndex("customers_tenant_normalized_name_unique_idx").on(
      t.tenantId,
      t.normalizedName,
    ),
    index("customers_tenant_status_idx").on(t.tenantId, t.status),
    check("customers_credit_limit_check", sql`credit_limit IS NULL OR credit_limit >= 0`),
  ],
);

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;

// ---------------------------------------------------------------------------
// locations
// ---------------------------------------------------------------------------

/**
 * `locations` table.
 *
 * Contract 03 §8: location_type covers internal warehouses, port
 * warehouses, external factory locations, in_transit (future), returned
 * stock, temporary, and WIP virtual.
 *
 * `related_factory_id` is nullable and used ONLY when the location is
 * an external factory location. It references `external_factories.id`.
 * The FK is defined here because `external_factories` is defined below
 * in the same file (forward reference within the same module).
 */
export const locations = pgTable(
  "locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    locationCode: text("location_code").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en"),
    locationType: locationType("location_type").notNull(),
    address: text("address"),
    /**
     * Related factory. Nullable — only set when location_type is
     * external_single_factory or external_twisting_factory.
     *
     * Plain uuid (no Drizzle references()) because external_factories
     * is defined AFTER locations in this file, creating a forward
     * reference. The FK is added as a manual ALTER TABLE in the
     * migration SQL (same pattern as users.created_by self-ref in
     * WP-00-03A).
     */
    relatedFactoryId: uuid("related_factory_id"),
    status: masterDataStatus("status").notNull().default("active"),
    ...makeTenantOwnedRow(usersId),
  },
  (t) => [
    uniqueIndex("locations_tenant_code_unique_idx").on(
      t.tenantId,
      t.locationCode,
    ),
    uniqueIndex("locations_tenant_name_ar_unique_idx").on(t.tenantId, t.nameAr),
    index("locations_tenant_type_idx").on(t.tenantId, t.locationType),
    index("locations_tenant_status_idx").on(t.tenantId, t.status),
  ],
);

export type Location = typeof locations.$inferSelect;
export type NewLocation = typeof locations.$inferInsert;

// ---------------------------------------------------------------------------
// external_factories
// ---------------------------------------------------------------------------

/**
 * `external_factories` table.
 *
 * Contract 03 §8:
 *   - each external factory has exactly one linked location;
 *   - unique (tenant_id, linked_location_id);
 *   - factory type is single_yarn, twisting, or both;
 *   - factory location type corresponds to factory type.
 *
 * Contract 04 §4.5 / DEC-007: External factories are both service
 * providers and inventory locations. Factory-held stock is company stock.
 *
 * `linked_location_id` is a NOT NULL FK to locations.id. The location's
 * type should correspond to the factory type (enforced by application
 * layer; a DB check would require a subquery).
 *
 * `default_rate_per_input_ton` and `default_cost_basis` are restricted
 * setup-time settings per Decision Log §"Restricted Internal or
 * Setup-Time Settings". They are nullable and used as defaults for new
 * production orders; confirmed rate is snapshotted per order.
 */
export const externalFactories = pgTable(
  "external_factories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    factoryCode: text("factory_code").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en"),
    factoryType: factoryType("factory_type").notNull(),
    linkedLocationId: uuid("linked_location_id")
      .notNull()
      .references(() => locations.id),
    contactInfoJson: text("contact_info_json"),
    defaultRatePerInputTon: numeric("default_rate_per_input_ton", {
      precision: 18,
      scale: 2,
    }),
    defaultCostBasis: text("default_cost_basis").default("input_quantity"),
    status: masterDataStatus("status").notNull().default("active"),
    notes: text("notes"),
    ...makeTenantOwnedRow(usersId),
  },
  (t) => [
    uniqueIndex("external_factories_tenant_code_unique_idx").on(
      t.tenantId,
      t.factoryCode,
    ),
    uniqueIndex("external_factories_tenant_linked_location_unique_idx").on(
      t.tenantId,
      t.linkedLocationId,
    ),
    index("external_factories_tenant_type_idx").on(t.tenantId, t.factoryType),
    index("external_factories_tenant_status_idx").on(t.tenantId, t.status),
    check(
      "external_factories_default_cost_basis_check",
      sql`default_cost_basis IN ('input_quantity', 'output_quantity')`,
    ),
    check(
      "external_factories_default_rate_check",
      sql`default_rate_per_input_ton IS NULL OR default_rate_per_input_ton >= 0`,
    ),
  ],
);

export type ExternalFactory = typeof externalFactories.$inferSelect;
export type NewExternalFactory = typeof externalFactories.$inferInsert;

// ---------------------------------------------------------------------------
// fiber_types
// ---------------------------------------------------------------------------

export const fiberTypes = pgTable(
  "fiber_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    code: text("code").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en"),
    status: masterDataStatus("status").notNull().default("active"),
    ...makeTenantOwnedRow(usersId),
  },
  (t) => [
    uniqueIndex("fiber_types_tenant_code_unique_idx").on(t.tenantId, t.code),
    index("fiber_types_tenant_status_idx").on(t.tenantId, t.status),
  ],
);

export type FiberType = typeof fiberTypes.$inferSelect;
export type NewFiberType = typeof fiberTypes.$inferInsert;

// ---------------------------------------------------------------------------
// product_types
// ---------------------------------------------------------------------------

export const productTypes = pgTable(
  "product_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    code: text("code").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en"),
    status: masterDataStatus("status").notNull().default("active"),
    ...makeTenantOwnedRow(usersId),
  },
  (t) => [
    uniqueIndex("product_types_tenant_code_unique_idx").on(t.tenantId, t.code),
    index("product_types_tenant_status_idx").on(t.tenantId, t.status),
  ],
);

export type ProductType = typeof productTypes.$inferSelect;
export type NewProductType = typeof productTypes.$inferInsert;

// ---------------------------------------------------------------------------
// quality_parameters
// ---------------------------------------------------------------------------

/**
 * `quality_parameters` table.
 *
 * Contract 03 §8: quality parameters are master data. Referenced quality
 * parameters cannot be hard-deleted (DEC-034).
 *
 * These define the measurable quality criteria (e.g., strength, fineness,
 * moisture) that quality tests record values for. Each parameter has a
 * code, Arabic/English names, and a unit of measurement.
 */
export const qualityParameters = pgTable(
  "quality_parameters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    code: text("code").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en"),
    unit: text("unit"),
    status: masterDataStatus("status").notNull().default("active"),
    ...makeTenantOwnedRow(usersId),
  },
  (t) => [
    uniqueIndex("quality_parameters_tenant_code_unique_idx").on(
      t.tenantId,
      t.code,
    ),
    index("quality_parameters_tenant_status_idx").on(t.tenantId, t.status),
  ],
);

export type QualityParameter = typeof qualityParameters.$inferSelect;
export type NewQualityParameter = typeof qualityParameters.$inferInsert;
