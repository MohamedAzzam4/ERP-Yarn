/**
 * In-memory MasterDataRepository for unit tests.
 * TEST-ONLY helper. NOT for production use.
 */
import type {
  Supplier, Customer, Location, ExternalFactory, FiberType, ProductType, QualityParameter,
} from "@/server/db/schema/master-data";
import type {
  MasterDataRepository, NewSupplierInput, NewCustomerInput, NewLocationInput,
  NewExternalFactoryInput, NewFiberTypeInput, NewProductTypeInput, NewQualityParameterInput,
  MasterDataStatus,
} from "../master-data-service";

const NOW = () => new Date("2026-07-01T00:00:00Z");
const nid = (p: string, n: number) => `${p}-${n.toString().padStart(6, "0")}`;

export class InMemoryMasterDataRepository implements MasterDataRepository {
  private suppliers = new Map<string, Supplier>();
  private customers = new Map<string, Customer>();
  private locations = new Map<string, Location>();
  private factories = new Map<string, ExternalFactory>();
  private fiberTypes = new Map<string, FiberType>();
  private productTypes = new Map<string, ProductType>();
  private qualityParameters = new Map<string, QualityParameter>();

  async insertSupplier(row: NewSupplierInput): Promise<Supplier> {
    const id = nid("sup", this.suppliers.size + 1);
    const s: Supplier = { id, tenantId: row.tenantId, supplierCode: row.supplierCode, nameAr: row.nameAr, nameEn: row.nameEn ?? null, normalizedName: row.normalizedName, contactInfoJson: row.contactInfoJson ?? null, status: "active", notes: row.notes ?? null, createdAt: NOW(), createdBy: row.createdBy, updatedAt: null, updatedBy: null };
    this.suppliers.set(`${row.tenantId}:${id}`, s); return s;
  }
  async findSupplierByCode(t: string, c: string): Promise<Supplier | null> { for (const s of this.suppliers.values()) if (s.tenantId === t && s.supplierCode === c) return s; return null; }
  async findSupplierById(t: string, id: string): Promise<Supplier | null> { return this.suppliers.get(`${t}:${id}`) ?? null; }
  async listActiveSuppliers(t: string): Promise<Supplier[]> { return [...this.suppliers.values()].filter(s => s.tenantId === t && s.status === "active"); }
  async updateSupplierStatus(t: string, id: string, st: MasterDataStatus): Promise<Supplier | null> { const k = `${t}:${id}`; const s = this.suppliers.get(k); if (!s) return null; const u = { ...s, status: st, updatedAt: NOW(), updatedBy: s.createdBy }; this.suppliers.set(k, u); return u; }

  async insertCustomer(row: NewCustomerInput): Promise<Customer> {
    const id = nid("cus", this.customers.size + 1);
    const c: Customer = { id, tenantId: row.tenantId, customerCode: row.customerCode, nameAr: row.nameAr, nameEn: row.nameEn ?? null, normalizedName: row.normalizedName, contactInfoJson: row.contactInfoJson ?? null, creditLimit: row.creditLimit ?? null, creditTerms: row.creditTerms ?? null, status: "active", notes: row.notes ?? null, createdAt: NOW(), createdBy: row.createdBy, updatedAt: null, updatedBy: null };
    this.customers.set(`${row.tenantId}:${id}`, c); return c;
  }
  async findCustomerByCode(t: string, c: string): Promise<Customer | null> { for (const c2 of this.customers.values()) if (c2.tenantId === t && c2.customerCode === c) return c2; return null; }
  async findCustomerById(t: string, id: string): Promise<Customer | null> { return this.customers.get(`${t}:${id}`) ?? null; }
  async listActiveCustomers(t: string): Promise<Customer[]> { return [...this.customers.values()].filter(c => c.tenantId === t && c.status === "active"); }
  async updateCustomerStatus(t: string, id: string, st: MasterDataStatus): Promise<Customer | null> { const k = `${t}:${id}`; const c = this.customers.get(k); if (!c) return null; const u = { ...c, status: st, updatedAt: NOW(), updatedBy: c.createdBy }; this.customers.set(k, u); return u; }

  async insertLocation(row: NewLocationInput): Promise<Location> {
    const id = nid("loc", this.locations.size + 1);
    const l: Location = { id, tenantId: row.tenantId, locationCode: row.locationCode, nameAr: row.nameAr, nameEn: row.nameEn ?? null, locationType: row.locationType as Location["locationType"], address: row.address ?? null, relatedFactoryId: row.relatedFactoryId ?? null, status: "active", createdAt: NOW(), createdBy: row.createdBy, updatedAt: null, updatedBy: null };
    this.locations.set(`${row.tenantId}:${id}`, l); return l;
  }
  async findLocationByCode(t: string, c: string): Promise<Location | null> { for (const l of this.locations.values()) if (l.tenantId === t && l.locationCode === c) return l; return null; }
  async findLocationById(t: string, id: string): Promise<Location | null> { return this.locations.get(`${t}:${id}`) ?? null; }
  async listActiveLocations(t: string): Promise<Location[]> { return [...this.locations.values()].filter(l => l.tenantId === t && l.status === "active"); }
  async updateLocationStatus(t: string, id: string, st: MasterDataStatus): Promise<Location | null> { const k = `${t}:${id}`; const l = this.locations.get(k); if (!l) return null; const u = { ...l, status: st, updatedAt: NOW(), updatedBy: l.createdBy }; this.locations.set(k, u); return u; }

  async insertExternalFactory(row: NewExternalFactoryInput): Promise<ExternalFactory> {
    const id = nid("fac", this.factories.size + 1);
    const f: ExternalFactory = { id, tenantId: row.tenantId, factoryCode: row.factoryCode, nameAr: row.nameAr, nameEn: row.nameEn ?? null, factoryType: row.factoryType as ExternalFactory["factoryType"], linkedLocationId: row.linkedLocationId, contactInfoJson: row.contactInfoJson ?? null, defaultRatePerInputTon: row.defaultRatePerInputTon ?? null, defaultCostBasis: row.defaultCostBasis ?? "input_quantity", status: "active", notes: row.notes ?? null, createdAt: NOW(), createdBy: row.createdBy, updatedAt: null, updatedBy: null };
    this.factories.set(`${row.tenantId}:${id}`, f); return f;
  }
  async findExternalFactoryByCode(t: string, c: string): Promise<ExternalFactory | null> { for (const f of this.factories.values()) if (f.tenantId === t && f.factoryCode === c) return f; return null; }
  async findExternalFactoryById(t: string, id: string): Promise<ExternalFactory | null> { return this.factories.get(`${t}:${id}`) ?? null; }
  async findExternalFactoryByLinkedLocation(t: string, lid: string): Promise<ExternalFactory | null> { for (const f of this.factories.values()) if (f.tenantId === t && f.linkedLocationId === lid) return f; return null; }
  async listActiveExternalFactories(t: string): Promise<ExternalFactory[]> { return [...this.factories.values()].filter(f => f.tenantId === t && f.status === "active"); }
  async updateExternalFactoryStatus(t: string, id: string, st: MasterDataStatus): Promise<ExternalFactory | null> { const k = `${t}:${id}`; const f = this.factories.get(k); if (!f) return null; const u = { ...f, status: st, updatedAt: NOW(), updatedBy: f.createdBy }; this.factories.set(k, u); return u; }

  async insertFiberType(row: NewFiberTypeInput): Promise<FiberType> {
    const id = nid("fib", this.fiberTypes.size + 1);
    const f: FiberType = { id, tenantId: row.tenantId, code: row.code, nameAr: row.nameAr, nameEn: row.nameEn ?? null, status: "active", createdAt: NOW(), createdBy: row.createdBy, updatedAt: null, updatedBy: null };
    this.fiberTypes.set(`${row.tenantId}:${id}`, f); return f;
  }
  async findFiberTypeByCode(t: string, c: string): Promise<FiberType | null> { for (const f of this.fiberTypes.values()) if (f.tenantId === t && f.code === c) return f; return null; }
  async findFiberTypeById(t: string, id: string): Promise<FiberType | null> { return this.fiberTypes.get(`${t}:${id}`) ?? null; }
  async listActiveFiberTypes(t: string): Promise<FiberType[]> { return [...this.fiberTypes.values()].filter(f => f.tenantId === t && f.status === "active"); }
  async updateFiberTypeStatus(t: string, id: string, st: MasterDataStatus): Promise<FiberType | null> { const k = `${t}:${id}`; const f = this.fiberTypes.get(k); if (!f) return null; const u = { ...f, status: st, updatedAt: NOW(), updatedBy: f.createdBy }; this.fiberTypes.set(k, u); return u; }

  async insertProductType(row: NewProductTypeInput): Promise<ProductType> {
    const id = nid("prt", this.productTypes.size + 1);
    const p: ProductType = { id, tenantId: row.tenantId, code: row.code, nameAr: row.nameAr, nameEn: row.nameEn ?? null, status: "active", createdAt: NOW(), createdBy: row.createdBy, updatedAt: null, updatedBy: null };
    this.productTypes.set(`${row.tenantId}:${id}`, p); return p;
  }
  async findProductTypeByCode(t: string, c: string): Promise<ProductType | null> { for (const p of this.productTypes.values()) if (p.tenantId === t && p.code === c) return p; return null; }
  async findProductTypeById(t: string, id: string): Promise<ProductType | null> { return this.productTypes.get(`${t}:${id}`) ?? null; }
  async listActiveProductTypes(t: string): Promise<ProductType[]> { return [...this.productTypes.values()].filter(p => p.tenantId === t && p.status === "active"); }
  async updateProductTypeStatus(t: string, id: string, st: MasterDataStatus): Promise<ProductType | null> { const k = `${t}:${id}`; const p = this.productTypes.get(k); if (!p) return null; const u = { ...p, status: st, updatedAt: NOW(), updatedBy: p.createdBy }; this.productTypes.set(k, u); return u; }

  async insertQualityParameter(row: NewQualityParameterInput): Promise<QualityParameter> {
    const id = nid("qp", this.qualityParameters.size + 1);
    const q: QualityParameter = { id, tenantId: row.tenantId, code: row.code, nameAr: row.nameAr, nameEn: row.nameEn ?? null, unit: row.unit ?? null, status: "active", createdAt: NOW(), createdBy: row.createdBy, updatedAt: null, updatedBy: null };
    this.qualityParameters.set(`${row.tenantId}:${id}`, q); return q;
  }
  async findQualityParameterByCode(t: string, c: string): Promise<QualityParameter | null> { for (const q of this.qualityParameters.values()) if (q.tenantId === t && q.code === c) return q; return null; }
  async findQualityParameterById(t: string, id: string): Promise<QualityParameter | null> { return this.qualityParameters.get(`${t}:${id}`) ?? null; }
  async listActiveQualityParameters(t: string): Promise<QualityParameter[]> { return [...this.qualityParameters.values()].filter(q => q.tenantId === t && q.status === "active"); }
  async updateQualityParameterStatus(t: string, id: string, st: MasterDataStatus): Promise<QualityParameter | null> { const k = `${t}:${id}`; const q = this.qualityParameters.get(k); if (!q) return null; const u = { ...q, status: st, updatedAt: NOW(), updatedBy: q.createdBy }; this.qualityParameters.set(k, u); return u; }

  // WP-08-01F DEFECT 5 — inventory-items findById for the alias-approval
  // path. The inventory_items table is the canonical stock identity. For
  // 'batch' and 'lot' entity types, the caller resolves through the same
  // inventory_items identity (item_kind distinguishes them).
  private inventoryItems = new Map<string, { id: string; tenantId: string; itemKind: string; itemCode: string; status: string }>();
  async findInventoryItemById(t: string, id: string): Promise<{ id: string; tenantId: string; itemKind: string; itemCode: string; status: string } | null> {
    const item = this.inventoryItems.get(`${t}:${id}`);
    return item ?? null;
  }
  // Helper to seed inventory items for tests.
  seedInventoryItem(t: string, item: { id: string; tenantId: string; itemKind: string; itemCode: string; status: string }): void {
    this.inventoryItems.set(`${t}:${item.id}`, item);
  }
}
