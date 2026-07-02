/**
 * Master Data Service — tenant-safe CRUD + inactivation for suppliers,
 * customers, locations, external factories, fiber types, product types,
 * and quality parameters.
 *
 * Contract: docs/contracts/13_work_packages.md WP-02-01
 *   Goal: Implement tenant-safe suppliers/customers/locations/factories and
 *   required masters. One factory-linked location; referenced records
 *   inactive, not deleted.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §8, §18
 *   - tenant-scoped code uniqueness
 *   - each external factory has exactly one linked location
 *   - referenced master data cannot be hard-deleted (DEC-034, UQ-024)
 *   - inactive records remain visible on old documents and unavailable
 *     for new transactions
 *
 * Contract: docs/contracts/11_permission_matrix.md §7, §11
 *   - Owner/Accountant: V/C/U on master data
 *   - Workers: view_names only (task-scoped, no financial fields)
 *   - Backend enforcement: authenticate → tenant match → permission →
 *     row scope → field selection → state check → audit
 *
 * DEC-007: External factories are service providers AND inventory locations.
 *   Factory identity is separate from location row; linked by
 *   linked_location_id / related_factory_id.
 *
 * DEC-034: Referenced master data is never hard-deleted. Use inactive status.
 *
 * WP-02-01 scope: service layer only. No UI, no API routes (admin screens
 * are added separately). The service is pure and testable — it accepts a
 * repository handle and an audit handle so tests can use in-memory stores.
 */
import "server-only";

import type { ErpUserContext } from "@/server/auth/erp-context";
import {
  requirePermission,
  requireTenantMatch,
  rejectBodyClaimsAuthority,
  PermissionDeniedError,
} from "@/server/security/guards";
import type { EffectivePermissions } from "@/server/security/effective-permissions";
import { appendAuditLog, type AuditTransactionHandle } from "./audit-service";

// ---------------------------------------------------------------------------
// Domain types — re-exported from schema for service consumers.
// ---------------------------------------------------------------------------

export type {
  Supplier,
  Customer,
  Location,
  ExternalFactory,
  FiberType,
  ProductType,
  QualityParameter,
} from "@/server/db/schema/master-data";

import type {
  Supplier,
  Customer,
  Location,
  ExternalFactory,
  FiberType,
  ProductType,
  QualityParameter,
} from "@/server/db/schema/master-data";

// ---------------------------------------------------------------------------
// Master data status (DEC-034: inactive, never hard-deleted).
// ---------------------------------------------------------------------------

export const MASTER_DATA_STATUS = ["active", "inactive"] as const;
export type MasterDataStatus = (typeof MASTER_DATA_STATUS)[number];

// ---------------------------------------------------------------------------
// Service error types.
// ---------------------------------------------------------------------------

/** Thrown when a master record is not found within the caller's tenant. */
export class MasterDataNotFoundError extends Error {
  readonly code = "MASTER_DATA_NOT_FOUND";
  constructor(
    readonly entityType: string,
    readonly entityId: string,
    readonly tenantId: string,
  ) {
    super(`Master data ${entityType} '${entityId}' not found in tenant '${tenantId}'.`);
    this.name = "MasterDataNotFoundError";
  }
}

/** Thrown when a tenant-scoped unique constraint would be violated. */
export class MasterDataDuplicateCodeError extends Error {
  readonly code = "MASTER_DATA_DUPLICATE_CODE";
  constructor(
    readonly entityType: string,
    readonly duplicateCode: string,
    readonly tenantId: string,
  ) {
    super(`${entityType} code '${duplicateCode}' already exists in this tenant.`);
    this.name = "MasterDataDuplicateCodeError";
  }
}

/** Thrown when attempting to hard-delete or reactivate improperly. */
export class MasterDataInactivationError extends Error {
  readonly code = "MASTER_DATA_INACTIVATION_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "MasterDataInactivationError";
  }
}

/** Thrown when factory↔location link validation fails (DEC-007). */
export class FactoryLocationLinkError extends Error {
  readonly code = "FACTORY_LOCATION_LINK_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "FactoryLocationLinkError";
  }
}

// ---------------------------------------------------------------------------
// Input types (tenant_id, timestamps, audit are set by the service, never
// trusted from the request body per Contract 11 §17 / guards.ts).
// ---------------------------------------------------------------------------

export interface NewSupplierInput {
  tenantId: string;
  supplierCode: string;
  nameAr: string;
  nameEn?: string | null;
  normalizedName: string;
  contactInfoJson?: string | null;
  notes?: string | null;
  createdBy: string;
}

export interface NewCustomerInput {
  tenantId: string;
  customerCode: string;
  nameAr: string;
  nameEn?: string | null;
  normalizedName: string;
  contactInfoJson?: string | null;
  creditLimit?: string | null;
  creditTerms?: string | null;
  notes?: string | null;
  createdBy: string;
}

export interface NewLocationInput {
  tenantId: string;
  locationCode: string;
  nameAr: string;
  nameEn?: string | null;
  locationType: string;
  address?: string | null;
  relatedFactoryId?: string | null;
  createdBy: string;
}

export interface NewExternalFactoryInput {
  tenantId: string;
  factoryCode: string;
  nameAr: string;
  nameEn?: string | null;
  factoryType: string;
  linkedLocationId: string;
  contactInfoJson?: string | null;
  defaultRatePerInputTon?: string | null;
  defaultCostBasis?: string | null;
  notes?: string | null;
  createdBy: string;
}

export interface NewFiberTypeInput {
  tenantId: string;
  code: string;
  nameAr: string;
  nameEn?: string | null;
  createdBy: string;
}

export interface NewProductTypeInput {
  tenantId: string;
  code: string;
  nameAr: string;
  nameEn?: string | null;
  createdBy: string;
}

export interface NewQualityParameterInput {
  tenantId: string;
  code: string;
  nameAr: string;
  nameEn?: string | null;
  unit?: string | null;
  createdBy: string;
}

// ---------------------------------------------------------------------------
// Repository interface — implemented by Drizzle in production and by an
// in-memory store in tests. The service is pure w.r.t. this interface.
// ---------------------------------------------------------------------------

export interface MasterDataRepository {
  insertSupplier(row: NewSupplierInput): Promise<Supplier>;
  findSupplierByCode(tenantId: string, code: string): Promise<Supplier | null>;
  findSupplierById(tenantId: string, id: string): Promise<Supplier | null>;
  listActiveSuppliers(tenantId: string): Promise<Supplier[]>;
  updateSupplierStatus(tenantId: string, id: string, status: MasterDataStatus): Promise<Supplier | null>;

  insertCustomer(row: NewCustomerInput): Promise<Customer>;
  findCustomerByCode(tenantId: string, code: string): Promise<Customer | null>;
  findCustomerById(tenantId: string, id: string): Promise<Customer | null>;
  listActiveCustomers(tenantId: string): Promise<Customer[]>;
  updateCustomerStatus(tenantId: string, id: string, status: MasterDataStatus): Promise<Customer | null>;

  insertLocation(row: NewLocationInput): Promise<Location>;
  findLocationByCode(tenantId: string, code: string): Promise<Location | null>;
  findLocationById(tenantId: string, id: string): Promise<Location | null>;
  listActiveLocations(tenantId: string): Promise<Location[]>;
  updateLocationStatus(tenantId: string, id: string, status: MasterDataStatus): Promise<Location | null>;

  insertExternalFactory(row: NewExternalFactoryInput): Promise<ExternalFactory>;
  findExternalFactoryByCode(tenantId: string, code: string): Promise<ExternalFactory | null>;
  findExternalFactoryById(tenantId: string, id: string): Promise<ExternalFactory | null>;
  findExternalFactoryByLinkedLocation(tenantId: string, locationId: string): Promise<ExternalFactory | null>;
  listActiveExternalFactories(tenantId: string): Promise<ExternalFactory[]>;
  updateExternalFactoryStatus(tenantId: string, id: string, status: MasterDataStatus): Promise<ExternalFactory | null>;

  insertFiberType(row: NewFiberTypeInput): Promise<FiberType>;
  findFiberTypeByCode(tenantId: string, code: string): Promise<FiberType | null>;
  listActiveFiberTypes(tenantId: string): Promise<FiberType[]>;
  updateFiberTypeStatus(tenantId: string, id: string, status: MasterDataStatus): Promise<FiberType | null>;

  insertProductType(row: NewProductTypeInput): Promise<ProductType>;
  findProductTypeByCode(tenantId: string, code: string): Promise<ProductType | null>;
  listActiveProductTypes(tenantId: string): Promise<ProductType[]>;
  updateProductTypeStatus(tenantId: string, id: string, status: MasterDataStatus): Promise<ProductType | null>;

  insertQualityParameter(row: NewQualityParameterInput): Promise<QualityParameter>;
  findQualityParameterByCode(tenantId: string, code: string): Promise<QualityParameter | null>;
  listActiveQualityParameters(tenantId: string): Promise<QualityParameter[]>;
  updateQualityParameterStatus(tenantId: string, id: string, status: MasterDataStatus): Promise<QualityParameter | null>;
}

// ---------------------------------------------------------------------------
// Factory type ↔ location type correspondence (DEC-007, Contract 03 §8).
// ---------------------------------------------------------------------------

export function validateFactoryLocationTypeMatch(
  factoryType: string,
  locationType: string,
): void {
  const map: Record<string, string[]> = {
    single_yarn: ["external_single_factory"],
    twisting: ["external_twisting_factory"],
    both: ["external_single_factory", "external_twisting_factory"],
  };
  const allowed = map[factoryType];
  if (!allowed) {
    throw new FactoryLocationLinkError(
      `Unknown factory type '${factoryType}'. Allowed: single_yarn, twisting, both.`,
    );
  }
  if (!allowed.includes(locationType)) {
    throw new FactoryLocationLinkError(
      `Factory type '${factoryType}' requires location type ${allowed.join(" or ")}, but got '${locationType}'.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Master Data Service.
// ---------------------------------------------------------------------------

export interface MasterDataServiceDeps {
  repository: MasterDataRepository;
  audit: AuditTransactionHandle;
}

export class MasterDataService {
  constructor(private readonly deps: MasterDataServiceDeps) {}

  // --- Suppliers ---

  async createSupplier(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: Omit<NewSupplierInput, "tenantId" | "createdBy">,
  ): Promise<Supplier> {
    requirePermission(effective, "master_data.create");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);
    const row: NewSupplierInput = { ...input, tenantId: user.tenantId, createdBy: user.userId };
    const existing = await this.deps.repository.findSupplierByCode(user.tenantId, row.supplierCode);
    if (existing) throw new MasterDataDuplicateCodeError("supplier", row.supplierCode, user.tenantId);
    const created = await this.deps.repository.insertSupplier(row);
    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: "supplier", entityId: created.id, actionType: "supplier.create",
      newValuesJson: { supplierCode: created.supplierCode, nameAr: created.nameAr, status: created.status },
    });
    return created;
  }

  async listActiveSuppliers(user: ErpUserContext, effective: EffectivePermissions): Promise<Supplier[]> {
    requireAnyMasterDataViewPermission(effective);
    return this.deps.repository.listActiveSuppliers(user.tenantId);
  }

  async inactivateSupplier(user: ErpUserContext, effective: EffectivePermissions, supplierId: string): Promise<Supplier> {
    requirePermission(effective, "master_data.inactivate");
    const existing = await this.deps.repository.findSupplierById(user.tenantId, supplierId);
    if (!existing) throw new MasterDataNotFoundError("supplier", supplierId, user.tenantId);
    requireTenantMatch(user, existing.tenantId);
    if (existing.status === "inactive") throw new MasterDataInactivationError(`Supplier '${existing.supplierCode}' is already inactive.`);
    const updated = await this.deps.repository.updateSupplierStatus(user.tenantId, supplierId, "inactive");
    if (!updated) throw new MasterDataNotFoundError("supplier", supplierId, user.tenantId);
    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: "supplier", entityId: updated.id, actionType: "supplier.inactivate",
      oldValuesJson: { status: existing.status }, newValuesJson: { status: updated.status },
    });
    return updated;
  }

  // --- Customers ---

  async createCustomer(user: ErpUserContext, effective: EffectivePermissions, input: Omit<NewCustomerInput, "tenantId" | "createdBy">): Promise<Customer> {
    requirePermission(effective, "master_data.create");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);
    const row: NewCustomerInput = { ...input, tenantId: user.tenantId, createdBy: user.userId };
    const existing = await this.deps.repository.findCustomerByCode(user.tenantId, row.customerCode);
    if (existing) throw new MasterDataDuplicateCodeError("customer", row.customerCode, user.tenantId);
    const created = await this.deps.repository.insertCustomer(row);
    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: "customer", entityId: created.id, actionType: "customer.create",
      newValuesJson: { customerCode: created.customerCode, nameAr: created.nameAr, status: created.status },
    });
    return created;
  }

  async listActiveCustomers(user: ErpUserContext, effective: EffectivePermissions): Promise<Customer[]> {
    requireAnyMasterDataViewPermission(effective);
    return this.deps.repository.listActiveCustomers(user.tenantId);
  }

  async inactivateCustomer(user: ErpUserContext, effective: EffectivePermissions, customerId: string): Promise<Customer> {
    requirePermission(effective, "master_data.inactivate");
    const existing = await this.deps.repository.findCustomerById(user.tenantId, customerId);
    if (!existing) throw new MasterDataNotFoundError("customer", customerId, user.tenantId);
    requireTenantMatch(user, existing.tenantId);
    if (existing.status === "inactive") throw new MasterDataInactivationError(`Customer '${existing.customerCode}' is already inactive.`);
    const updated = await this.deps.repository.updateCustomerStatus(user.tenantId, customerId, "inactive");
    if (!updated) throw new MasterDataNotFoundError("customer", customerId, user.tenantId);
    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: "customer", entityId: updated.id, actionType: "customer.inactivate",
      oldValuesJson: { status: existing.status }, newValuesJson: { status: updated.status },
    });
    return updated;
  }

  // --- Locations ---

  async createLocation(user: ErpUserContext, effective: EffectivePermissions, input: Omit<NewLocationInput, "tenantId" | "createdBy">): Promise<Location> {
    requirePermission(effective, "master_data.create");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);
    const row: NewLocationInput = { ...input, tenantId: user.tenantId, createdBy: user.userId };
    const existing = await this.deps.repository.findLocationByCode(user.tenantId, row.locationCode);
    if (existing) throw new MasterDataDuplicateCodeError("location", row.locationCode, user.tenantId);
    const created = await this.deps.repository.insertLocation(row);
    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: "location", entityId: created.id, actionType: "location.create",
      newValuesJson: { locationCode: created.locationCode, nameAr: created.nameAr, locationType: created.locationType, status: created.status },
    });
    return created;
  }

  async listActiveLocations(user: ErpUserContext, effective: EffectivePermissions): Promise<Location[]> {
    requireAnyMasterDataViewPermission(effective);
    return this.deps.repository.listActiveLocations(user.tenantId);
  }

  async inactivateLocation(user: ErpUserContext, effective: EffectivePermissions, locationId: string): Promise<Location> {
    requirePermission(effective, "master_data.inactivate");
    const existing = await this.deps.repository.findLocationById(user.tenantId, locationId);
    if (!existing) throw new MasterDataNotFoundError("location", locationId, user.tenantId);
    requireTenantMatch(user, existing.tenantId);
    if (existing.status === "inactive") throw new MasterDataInactivationError(`Location '${existing.locationCode}' is already inactive.`);
    const linkedFactory = await this.deps.repository.findExternalFactoryByLinkedLocation(user.tenantId, locationId);
    if (linkedFactory && linkedFactory.status === "active") {
      throw new MasterDataInactivationError(`Location '${existing.locationCode}' is linked to active factory '${linkedFactory.factoryCode}'. Inactivate the factory first.`);
    }
    const updated = await this.deps.repository.updateLocationStatus(user.tenantId, locationId, "inactive");
    if (!updated) throw new MasterDataNotFoundError("location", locationId, user.tenantId);
    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: "location", entityId: updated.id, actionType: "location.inactivate",
      oldValuesJson: { status: existing.status }, newValuesJson: { status: updated.status },
    });
    return updated;
  }

  // --- External factories (DEC-007) ---

  async createExternalFactory(user: ErpUserContext, effective: EffectivePermissions, input: Omit<NewExternalFactoryInput, "tenantId" | "createdBy">): Promise<ExternalFactory> {
    requirePermission(effective, "master_data.create");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);
    const row: NewExternalFactoryInput = { ...input, tenantId: user.tenantId, createdBy: user.userId };
    const existingByCode = await this.deps.repository.findExternalFactoryByCode(user.tenantId, row.factoryCode);
    if (existingByCode) throw new MasterDataDuplicateCodeError("external_factory", row.factoryCode, user.tenantId);
    const linkedLocation = await this.deps.repository.findLocationById(user.tenantId, row.linkedLocationId);
    if (!linkedLocation) throw new FactoryLocationLinkError(`Linked location '${row.linkedLocationId}' not found in tenant.`);
    requireTenantMatch(user, linkedLocation.tenantId);
    validateFactoryLocationTypeMatch(row.factoryType, linkedLocation.locationType);
    const existingFactory = await this.deps.repository.findExternalFactoryByLinkedLocation(user.tenantId, row.linkedLocationId);
    if (existingFactory) {
      throw new FactoryLocationLinkError(`Location '${linkedLocation.locationCode}' is already linked to factory '${existingFactory.factoryCode}'. Each location can have at most one factory.`);
    }
    const created = await this.deps.repository.insertExternalFactory(row);
    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: "external_factory", entityId: created.id, actionType: "external_factory.create",
      newValuesJson: { factoryCode: created.factoryCode, nameAr: created.nameAr, factoryType: created.factoryType, linkedLocationId: created.linkedLocationId, status: created.status },
    });
    return created;
  }

  async listActiveExternalFactories(user: ErpUserContext, effective: EffectivePermissions): Promise<ExternalFactory[]> {
    requireAnyMasterDataViewPermission(effective);
    return this.deps.repository.listActiveExternalFactories(user.tenantId);
  }

  async inactivateExternalFactory(user: ErpUserContext, effective: EffectivePermissions, factoryId: string): Promise<ExternalFactory> {
    requirePermission(effective, "master_data.inactivate");
    const existing = await this.deps.repository.findExternalFactoryById(user.tenantId, factoryId);
    if (!existing) throw new MasterDataNotFoundError("external_factory", factoryId, user.tenantId);
    requireTenantMatch(user, existing.tenantId);
    if (existing.status === "inactive") throw new MasterDataInactivationError(`Factory '${existing.factoryCode}' is already inactive.`);
    const updated = await this.deps.repository.updateExternalFactoryStatus(user.tenantId, factoryId, "inactive");
    if (!updated) throw new MasterDataNotFoundError("external_factory", factoryId, user.tenantId);
    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: "external_factory", entityId: updated.id, actionType: "external_factory.inactivate",
      oldValuesJson: { status: existing.status }, newValuesJson: { status: updated.status },
    });
    return updated;
  }

  // --- Fiber types ---

  async createFiberType(user: ErpUserContext, effective: EffectivePermissions, input: Omit<NewFiberTypeInput, "tenantId" | "createdBy">): Promise<FiberType> {
    requirePermission(effective, "master_data.create");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);
    const row: NewFiberTypeInput = { ...input, tenantId: user.tenantId, createdBy: user.userId };
    const existing = await this.deps.repository.findFiberTypeByCode(user.tenantId, row.code);
    if (existing) throw new MasterDataDuplicateCodeError("fiber_type", row.code, user.tenantId);
    const created = await this.deps.repository.insertFiberType(row);
    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: "fiber_type", entityId: created.id, actionType: "fiber_type.create",
      newValuesJson: { code: created.code, nameAr: created.nameAr, status: created.status },
    });
    return created;
  }

  async listActiveFiberTypes(user: ErpUserContext, effective: EffectivePermissions): Promise<FiberType[]> {
    requireAnyMasterDataViewPermission(effective);
    return this.deps.repository.listActiveFiberTypes(user.tenantId);
  }

  // --- Product types ---

  async createProductType(user: ErpUserContext, effective: EffectivePermissions, input: Omit<NewProductTypeInput, "tenantId" | "createdBy">): Promise<ProductType> {
    requirePermission(effective, "master_data.create");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);
    const row: NewProductTypeInput = { ...input, tenantId: user.tenantId, createdBy: user.userId };
    const existing = await this.deps.repository.findProductTypeByCode(user.tenantId, row.code);
    if (existing) throw new MasterDataDuplicateCodeError("product_type", row.code, user.tenantId);
    const created = await this.deps.repository.insertProductType(row);
    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: "product_type", entityId: created.id, actionType: "product_type.create",
      newValuesJson: { code: created.code, nameAr: created.nameAr, status: created.status },
    });
    return created;
  }

  async listActiveProductTypes(user: ErpUserContext, effective: EffectivePermissions): Promise<ProductType[]> {
    requireAnyMasterDataViewPermission(effective);
    return this.deps.repository.listActiveProductTypes(user.tenantId);
  }

  // --- Quality parameters ---

  async createQualityParameter(user: ErpUserContext, effective: EffectivePermissions, input: Omit<NewQualityParameterInput, "tenantId" | "createdBy">): Promise<QualityParameter> {
    requirePermission(effective, "master_data.create");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);
    const row: NewQualityParameterInput = { ...input, tenantId: user.tenantId, createdBy: user.userId };
    const existing = await this.deps.repository.findQualityParameterByCode(user.tenantId, row.code);
    if (existing) throw new MasterDataDuplicateCodeError("quality_parameter", row.code, user.tenantId);
    const created = await this.deps.repository.insertQualityParameter(row);
    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: "quality_parameter", entityId: created.id, actionType: "quality_parameter.create",
      newValuesJson: { code: created.code, nameAr: created.nameAr, unit: created.unit, status: created.status },
    });
    return created;
  }

  async listActiveQualityParameters(user: ErpUserContext, effective: EffectivePermissions): Promise<QualityParameter[]> {
    requireAnyMasterDataViewPermission(effective);
    return this.deps.repository.listActiveQualityParameters(user.tenantId);
  }
}

function requireAnyMasterDataViewPermission(effective: EffectivePermissions): void {
  const hasView = effective.permissionKeys.has("master_data.view");
  const hasViewNames = effective.permissionKeys.has("master_data.view_names");
  if (!hasView && !hasViewNames) {
    throw new PermissionDeniedError("master_data.view | master_data.view_names");
  }
}
