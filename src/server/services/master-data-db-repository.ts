/**
 * Drizzle-backed MasterDataRepository — the production DB repository.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §8, §16
 *   Every query/mutation validates tenant_id. Tenant-safe foreign keys
 *   prevent cross-tenant relationships.
 *
 * This module implements the MasterDataRepository interface using Drizzle
 * ORM against the existing master-data tables (suppliers, customers,
 * locations, external_factories, fiber_types, product_types,
 * quality_parameters).
 *
 * Production code (server components, API routes) uses this repository.
 * Unit tests use InMemoryMasterDataRepository instead (no DB needed).
 *
 * WP-02-01 scope: repository implementation only. The service layer
 * (MasterDataService) is DB-agnostic — it accepts any MasterDataRepository.
 */
import "server-only";
import { eq, and } from "drizzle-orm";
import {
  suppliers,
  customers,
  locations,
  externalFactories,
  fiberTypes,
  productTypes,
  qualityParameters,
  inventoryItems,
} from "@/server/db/schema";
import type { db as DbType } from "@/server/db/client";
import type {
  MasterDataRepository,
  NewSupplierInput,
  NewCustomerInput,
  NewLocationInput,
  NewExternalFactoryInput,
  NewFiberTypeInput,
  NewProductTypeInput,
  NewQualityParameterInput,
  MasterDataStatus,
} from "./master-data-service";
import type {
  Supplier,
  Customer,
  Location,
  ExternalFactory,
  FiberType,
  ProductType,
  QualityParameter,
} from "@/server/db/schema/master-data";

type Db = NonNullable<typeof DbType>;

/**
 * Drizzle-backed MasterDataRepository.
 *
 * Constructed with a Drizzle `db` instance. All methods are tenant-scoped:
 * they filter by `tenantId` on every query and never return cross-tenant rows.
 */
export class MasterDataDbRepository implements MasterDataRepository {
  constructor(private readonly db: Db) {}

  // --- Suppliers ---

  async insertSupplier(row: NewSupplierInput): Promise<Supplier> {
    const [result] = await this.db
      .insert(suppliers)
      .values({
        tenantId: row.tenantId,
        supplierCode: row.supplierCode,
        nameAr: row.nameAr,
        nameEn: row.nameEn ?? null,
        normalizedName: row.normalizedName,
        contactInfoJson: row.contactInfoJson ?? null,
        notes: row.notes ?? null,
        createdBy: row.createdBy,
      })
      .returning();
    return result!;
  }

  async findSupplierByCode(tenantId: string, code: string): Promise<Supplier | null> {
    const [result] = await this.db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.tenantId, tenantId), eq(suppliers.supplierCode, code)))
      .limit(1);
    return result ?? null;
  }

  async findSupplierById(tenantId: string, id: string): Promise<Supplier | null> {
    const [result] = await this.db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.tenantId, tenantId), eq(suppliers.id, id)))
      .limit(1);
    return result ?? null;
  }

  async listActiveSuppliers(tenantId: string): Promise<Supplier[]> {
    return this.db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.tenantId, tenantId), eq(suppliers.status, "active")));
  }

  async updateSupplierStatus(tenantId: string, id: string, status: MasterDataStatus): Promise<Supplier | null> {
    const [result] = await this.db
      .update(suppliers)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(suppliers.tenantId, tenantId), eq(suppliers.id, id)))
      .returning();
    return result ?? null;
  }

  // --- Customers ---

  async insertCustomer(row: NewCustomerInput): Promise<Customer> {
    const [result] = await this.db
      .insert(customers)
      .values({
        tenantId: row.tenantId,
        customerCode: row.customerCode,
        nameAr: row.nameAr,
        nameEn: row.nameEn ?? null,
        normalizedName: row.normalizedName,
        contactInfoJson: row.contactInfoJson ?? null,
        creditLimit: row.creditLimit ?? null,
        creditTerms: row.creditTerms ?? null,
        notes: row.notes ?? null,
        createdBy: row.createdBy,
      })
      .returning();
    return result!;
  }

  async findCustomerByCode(tenantId: string, code: string): Promise<Customer | null> {
    const [result] = await this.db
      .select()
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), eq(customers.customerCode, code)))
      .limit(1);
    return result ?? null;
  }

  async findCustomerById(tenantId: string, id: string): Promise<Customer | null> {
    const [result] = await this.db
      .select()
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), eq(customers.id, id)))
      .limit(1);
    return result ?? null;
  }

  async listActiveCustomers(tenantId: string): Promise<Customer[]> {
    return this.db
      .select()
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), eq(customers.status, "active")));
  }

  async updateCustomerStatus(tenantId: string, id: string, status: MasterDataStatus): Promise<Customer | null> {
    const [result] = await this.db
      .update(customers)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(customers.tenantId, tenantId), eq(customers.id, id)))
      .returning();
    return result ?? null;
  }

  // --- Locations ---

  async insertLocation(row: NewLocationInput): Promise<Location> {
    const [result] = await this.db
      .insert(locations)
      .values({
        tenantId: row.tenantId,
        locationCode: row.locationCode,
        nameAr: row.nameAr,
        nameEn: row.nameEn ?? null,
        locationType: row.locationType as Location["locationType"],
        address: row.address ?? null,
        relatedFactoryId: row.relatedFactoryId ?? null,
        createdBy: row.createdBy,
      })
      .returning();
    return result!;
  }

  async findLocationByCode(tenantId: string, code: string): Promise<Location | null> {
    const [result] = await this.db
      .select()
      .from(locations)
      .where(and(eq(locations.tenantId, tenantId), eq(locations.locationCode, code)))
      .limit(1);
    return result ?? null;
  }

  async findLocationById(tenantId: string, id: string): Promise<Location | null> {
    const [result] = await this.db
      .select()
      .from(locations)
      .where(and(eq(locations.tenantId, tenantId), eq(locations.id, id)))
      .limit(1);
    return result ?? null;
  }

  async listActiveLocations(tenantId: string): Promise<Location[]> {
    return this.db
      .select()
      .from(locations)
      .where(and(eq(locations.tenantId, tenantId), eq(locations.status, "active")));
  }

  async updateLocationStatus(tenantId: string, id: string, status: MasterDataStatus): Promise<Location | null> {
    const [result] = await this.db
      .update(locations)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(locations.tenantId, tenantId), eq(locations.id, id)))
      .returning();
    return result ?? null;
  }

  // --- External factories ---

  async insertExternalFactory(row: NewExternalFactoryInput): Promise<ExternalFactory> {
    const [result] = await this.db
      .insert(externalFactories)
      .values({
        tenantId: row.tenantId,
        factoryCode: row.factoryCode,
        nameAr: row.nameAr,
        nameEn: row.nameEn ?? null,
        factoryType: row.factoryType as ExternalFactory["factoryType"],
        linkedLocationId: row.linkedLocationId,
        contactInfoJson: row.contactInfoJson ?? null,
        defaultRatePerInputTon: row.defaultRatePerInputTon ?? null,
        defaultCostBasis: row.defaultCostBasis ?? "input_quantity",
        notes: row.notes ?? null,
        createdBy: row.createdBy,
      })
      .returning();
    return result!;
  }

  async findExternalFactoryByCode(tenantId: string, code: string): Promise<ExternalFactory | null> {
    const [result] = await this.db
      .select()
      .from(externalFactories)
      .where(and(eq(externalFactories.tenantId, tenantId), eq(externalFactories.factoryCode, code)))
      .limit(1);
    return result ?? null;
  }

  async findExternalFactoryById(tenantId: string, id: string): Promise<ExternalFactory | null> {
    const [result] = await this.db
      .select()
      .from(externalFactories)
      .where(and(eq(externalFactories.tenantId, tenantId), eq(externalFactories.id, id)))
      .limit(1);
    return result ?? null;
  }

  async findExternalFactoryByLinkedLocation(tenantId: string, locationId: string): Promise<ExternalFactory | null> {
    const [result] = await this.db
      .select()
      .from(externalFactories)
      .where(and(eq(externalFactories.tenantId, tenantId), eq(externalFactories.linkedLocationId, locationId)))
      .limit(1);
    return result ?? null;
  }

  async listActiveExternalFactories(tenantId: string): Promise<ExternalFactory[]> {
    return this.db
      .select()
      .from(externalFactories)
      .where(and(eq(externalFactories.tenantId, tenantId), eq(externalFactories.status, "active")));
  }

  async updateExternalFactoryStatus(tenantId: string, id: string, status: MasterDataStatus): Promise<ExternalFactory | null> {
    const [result] = await this.db
      .update(externalFactories)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(externalFactories.tenantId, tenantId), eq(externalFactories.id, id)))
      .returning();
    return result ?? null;
  }

  // --- Fiber types ---

  async insertFiberType(row: NewFiberTypeInput): Promise<FiberType> {
    const [result] = await this.db
      .insert(fiberTypes)
      .values({
        tenantId: row.tenantId,
        code: row.code,
        nameAr: row.nameAr,
        nameEn: row.nameEn ?? null,
        createdBy: row.createdBy,
      })
      .returning();
    return result!;
  }

  async findFiberTypeByCode(tenantId: string, code: string): Promise<FiberType | null> {
    const [result] = await this.db
      .select()
      .from(fiberTypes)
      .where(and(eq(fiberTypes.tenantId, tenantId), eq(fiberTypes.code, code)))
      .limit(1);
    return result ?? null;
  }

  // WP-08-01F DEFECT 5 — findById for fiber-type master.
  async findFiberTypeById(tenantId: string, id: string): Promise<FiberType | null> {
    const [result] = await this.db
      .select()
      .from(fiberTypes)
      .where(and(eq(fiberTypes.tenantId, tenantId), eq(fiberTypes.id, id)))
      .limit(1);
    return result ?? null;
  }

  async listActiveFiberTypes(tenantId: string): Promise<FiberType[]> {
    return this.db
      .select()
      .from(fiberTypes)
      .where(and(eq(fiberTypes.tenantId, tenantId), eq(fiberTypes.status, "active")));
  }

  async updateFiberTypeStatus(tenantId: string, id: string, status: MasterDataStatus): Promise<FiberType | null> {
    const [result] = await this.db
      .update(fiberTypes)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(fiberTypes.tenantId, tenantId), eq(fiberTypes.id, id)))
      .returning();
    return result ?? null;
  }

  // --- Product types ---

  async insertProductType(row: NewProductTypeInput): Promise<ProductType> {
    const [result] = await this.db
      .insert(productTypes)
      .values({
        tenantId: row.tenantId,
        code: row.code,
        nameAr: row.nameAr,
        nameEn: row.nameEn ?? null,
        createdBy: row.createdBy,
      })
      .returning();
    return result!;
  }

  async findProductTypeByCode(tenantId: string, code: string): Promise<ProductType | null> {
    const [result] = await this.db
      .select()
      .from(productTypes)
      .where(and(eq(productTypes.tenantId, tenantId), eq(productTypes.code, code)))
      .limit(1);
    return result ?? null;
  }

  // WP-08-01F DEFECT 5 — findById for product-type master.
  async findProductTypeById(tenantId: string, id: string): Promise<ProductType | null> {
    const [result] = await this.db
      .select()
      .from(productTypes)
      .where(and(eq(productTypes.tenantId, tenantId), eq(productTypes.id, id)))
      .limit(1);
    return result ?? null;
  }

  async listActiveProductTypes(tenantId: string): Promise<ProductType[]> {
    return this.db
      .select()
      .from(productTypes)
      .where(and(eq(productTypes.tenantId, tenantId), eq(productTypes.status, "active")));
  }

  async updateProductTypeStatus(tenantId: string, id: string, status: MasterDataStatus): Promise<ProductType | null> {
    const [result] = await this.db
      .update(productTypes)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(productTypes.tenantId, tenantId), eq(productTypes.id, id)))
      .returning();
    return result ?? null;
  }

  // --- Quality parameters ---

  async insertQualityParameter(row: NewQualityParameterInput): Promise<QualityParameter> {
    const [result] = await this.db
      .insert(qualityParameters)
      .values({
        tenantId: row.tenantId,
        code: row.code,
        nameAr: row.nameAr,
        nameEn: row.nameEn ?? null,
        unit: row.unit ?? null,
        createdBy: row.createdBy,
      })
      .returning();
    return result!;
  }

  async findQualityParameterByCode(tenantId: string, code: string): Promise<QualityParameter | null> {
    const [result] = await this.db
      .select()
      .from(qualityParameters)
      .where(and(eq(qualityParameters.tenantId, tenantId), eq(qualityParameters.code, code)))
      .limit(1);
    return result ?? null;
  }

  // WP-08-01F DEFECT 5 — findById for quality-parameter master.
  async findQualityParameterById(tenantId: string, id: string): Promise<QualityParameter | null> {
    const [result] = await this.db
      .select()
      .from(qualityParameters)
      .where(and(eq(qualityParameters.tenantId, tenantId), eq(qualityParameters.id, id)))
      .limit(1);
    return result ?? null;
  }

  async listActiveQualityParameters(tenantId: string): Promise<QualityParameter[]> {
    return this.db
      .select()
      .from(qualityParameters)
      .where(and(eq(qualityParameters.tenantId, tenantId), eq(qualityParameters.status, "active")));
  }

  async updateQualityParameterStatus(tenantId: string, id: string, status: MasterDataStatus): Promise<QualityParameter | null> {
    const [result] = await this.db
      .update(qualityParameters)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(qualityParameters.tenantId, tenantId), eq(qualityParameters.id, id)))
      .returning();
    return result ?? null;
  }

  // --- Inventory items (DEFECT 5) ---
  //
  // The inventory_items table is the canonical stock-tracking identity
  // (Contract 03 §9.1). For 'batch' and 'lot' entity types, the alias
  // approval path uses the same inventory_items table — the item_kind
  // column distinguishes raw_material_batch vs. yarn_lot. For 'item'
  // entity types, the inventory_items row IS the master.

  // WP-08-01F DEFECT 5 — findById for inventory-item master.
  async findInventoryItemById(tenantId: string, id: string): Promise<{ id: string; tenantId: string; itemKind: string; itemCode: string; status: string } | null> {
    const [result] = await this.db
      .select({
        id: inventoryItems.id,
        tenantId: inventoryItems.tenantId,
        itemKind: inventoryItems.itemKind,
        itemCode: inventoryItems.itemCode,
        status: inventoryItems.status,
      })
      .from(inventoryItems)
      .where(and(eq(inventoryItems.tenantId, tenantId), eq(inventoryItems.id, id)))
      .limit(1);
    return result ?? null;
  }
}

/**
 * Factory: create a MasterDataDbRepository from the runtime `db` instance.
 *
 * Throws if `db` is null (no DATABASE_URL configured). Runtime code
 * (server components, API routes) should call this to get the production
 * repository. Tests use InMemoryMasterDataRepository instead.
 *
 * @example
 * ```ts
 * import { db } from "@/server/db/client";
 * import { MasterDataDbRepository } from "./master-data-db-repository";
 *
 * const repository = createMasterDataDbRepository(db);
 * const service = new MasterDataService({ repository, audit });
 * ```
 */
export function createMasterDataDbRepository(db: Db): MasterDataDbRepository {
  return new MasterDataDbRepository(db);
}
