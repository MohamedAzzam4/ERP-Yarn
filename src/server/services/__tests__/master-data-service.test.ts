/**
 * WP-02-01 Master Data Service tests.
 * Coverage: tenant isolation, uniqueness, inactivation, role/permission,
 * factory-location link, referenced-record protection, audit.
 */
import { describe, it, expect } from "vitest";
import {
  MasterDataService,
  MasterDataNotFoundError,
  MasterDataDuplicateCodeError,
  MasterDataInactivationError,
  FactoryLocationLinkError,
  validateFactoryLocationTypeMatch,
} from "../master-data-service";
import { InMemoryMasterDataRepository } from "./in-memory-master-data-repository";
import { InProcessAuditStore } from "../audit-service";
import {
  TEST_USERS,
  TEST_FOREIGN_ACCOUNTANT,
  TEST_TENANT_ID,
  FOREIGN_TENANT_ID,
  getTestEffectivePermissions,
} from "@/server/security/role-fixtures";
import { PermissionDeniedError, BodyClaimsAuthorityError } from "@/server/security/guards";

function makeDeps() {
  const repository = new InMemoryMasterDataRepository();
  const audit = new InProcessAuditStore();
  const service = new MasterDataService({ repository, audit });
  return { repository, audit, service };
}
function makeOwnerDeps() { const d = makeDeps(); return { ...d, user: TEST_USERS.owner, effective: getTestEffectivePermissions(TEST_USERS.owner.userId) }; }
function makeAccountantDeps() { const d = makeDeps(); return { ...d, user: TEST_USERS.accountant, effective: getTestEffectivePermissions(TEST_USERS.accountant.userId) }; }
function makeWarehouseDeps() { const d = makeDeps(); return { ...d, user: TEST_USERS.warehouse, effective: getTestEffectivePermissions(TEST_USERS.warehouse.userId) }; }

describe("WP-02-01 MasterDataService — suppliers", () => {
  it("Owner can create a supplier", async () => {
    const { service, user, effective, audit } = makeOwnerDeps();
    const s = await service.createSupplier(user, effective, { supplierCode: "SUP-001", nameAr: "عثمان", normalizedName: "عثمان", nameEn: "Osman" });
    expect(s.supplierCode).toBe("SUP-001");
    expect(s.status).toBe("active");
    expect(s.tenantId).toBe(TEST_TENANT_ID);
    expect(audit.count()).toBe(1);
    expect(audit.getRows()[0]!.actionType).toBe("supplier.create");
  });

  it("Accountant can create a supplier", async () => {
    const { service, user, effective } = makeAccountantDeps();
    const s = await service.createSupplier(user, effective, { supplierCode: "SUP-002", nameAr: "كارجيل", normalizedName: "كارجيل" });
    expect(s.supplierCode).toBe("SUP-002");
  });

  it("Worker cannot create a supplier", async () => {
    const { service, user, effective } = makeWarehouseDeps();
    await expect(service.createSupplier(user, effective, { supplierCode: "SUP-W", nameAr: "مورد", normalizedName: "مورد" })).rejects.toThrow(PermissionDeniedError);
  });

  it("Duplicate supplier code in same tenant rejected", async () => {
    const { service, user, effective } = makeOwnerDeps();
    await service.createSupplier(user, effective, { supplierCode: "SUP-DUP", nameAr: "مورد 1", normalizedName: "مورد 1" });
    await expect(service.createSupplier(user, effective, { supplierCode: "SUP-DUP", nameAr: "مورد 2", normalizedName: "مورد 2" })).rejects.toThrow(MasterDataDuplicateCodeError);
  });

  it("Same supplier code in different tenants allowed", async () => {
    const od = makeOwnerDeps();
    const fd = makeDeps();
    const fu = TEST_FOREIGN_ACCOUNTANT;
    const fe = getTestEffectivePermissions(fu.userId);
    await od.service.createSupplier(od.user, od.effective, { supplierCode: "SUP-SHARED", nameAr: "مورد 1", normalizedName: "مورد 1" });
    const fs = await fd.service.createSupplier(fu, fe, { supplierCode: "SUP-SHARED", nameAr: "مورد 2", normalizedName: "مورد 2" });
    expect(fs.tenantId).toBe(FOREIGN_TENANT_ID);
  });

  it("listActiveSuppliers only returns caller's tenant", async () => {
    const od = makeOwnerDeps();
    const fd = makeDeps();
    const fu = TEST_FOREIGN_ACCOUNTANT;
    const fe = getTestEffectivePermissions(fu.userId);
    await od.service.createSupplier(od.user, od.effective, { supplierCode: "SUP-A", nameAr: "مورد أ", normalizedName: "مورد أ" });
    await fd.service.createSupplier(fu, fe, { supplierCode: "SUP-B", nameAr: "مورد ب", normalizedName: "مورد ب" });
    const ol = await od.service.listActiveSuppliers(od.user, od.effective);
    const fl = await fd.service.listActiveSuppliers(fu, fe);
    expect(ol).toHaveLength(1);
    expect(fl).toHaveLength(1);
  });

  it("Inactivation sets status inactive and audits", async () => {
    const { service, user, effective, audit } = makeOwnerDeps();
    const s = await service.createSupplier(user, effective, { supplierCode: "SUP-INACT", nameAr: "مورد", normalizedName: "مورد" });
    const inact = await service.inactivateSupplier(user, effective, s.id);
    expect(inact.status).toBe("inactive");
    expect(audit.count()).toBe(2);
    expect(audit.getRows()[1]!.actionType).toBe("supplier.inactivate");
    const active = await service.listActiveSuppliers(user, effective);
    expect(active).toHaveLength(0);
  });

  it("Inactivating already-inactive supplier rejected", async () => {
    const { service, user, effective } = makeOwnerDeps();
    const s = await service.createSupplier(user, effective, { supplierCode: "SUP-I2", nameAr: "مورد", normalizedName: "مورد" });
    await service.inactivateSupplier(user, effective, s.id);
    await expect(service.inactivateSupplier(user, effective, s.id)).rejects.toThrow(MasterDataInactivationError);
  });

  it("Inactivating non-existent supplier throws NotFound", async () => {
    const { service, user, effective } = makeOwnerDeps();
    await expect(service.inactivateSupplier(user, effective, "nonexistent")).rejects.toThrow(MasterDataNotFoundError);
  });

  it("Worker can list suppliers (view_names)", async () => {
    const repo = new InMemoryMasterDataRepository();
    const os = new MasterDataService({ repository: repo, audit: new InProcessAuditStore() });
    const ws = new MasterDataService({ repository: repo, audit: new InProcessAuditStore() });
    await os.createSupplier(TEST_USERS.owner, getTestEffectivePermissions(TEST_USERS.owner.userId), { supplierCode: "SUP-WV", nameAr: "مورد عامل", normalizedName: "مورد عامل" });
    const list = await ws.listActiveSuppliers(TEST_USERS.warehouse, getTestEffectivePermissions(TEST_USERS.warehouse.userId));
    expect(list).toHaveLength(1);
  });

  it("Body claiming tenant_id rejected", async () => {
    const { service, user, effective } = makeOwnerDeps();
    await expect(service.createSupplier(user, effective, { supplierCode: "SUP-B", nameAr: "مورد", normalizedName: "مورد", tenantId: FOREIGN_TENANT_ID } as never)).rejects.toThrow(BodyClaimsAuthorityError);
  });
});

describe("WP-02-01 MasterDataService — customers", () => {
  it("Owner can create customer with credit limit", async () => {
    const { service, user, effective, audit } = makeOwnerDeps();
    const c = await service.createCustomer(user, effective, { customerCode: "CUS-001", nameAr: "عميل", normalizedName: "عميل", creditLimit: "50000.00", creditTerms: "30 days" });
    expect(c.creditLimit).toBe("50000.00");
    expect(audit.getRows()[0]!.actionType).toBe("customer.create");
  });

  it("Duplicate customer code rejected", async () => {
    const { service, user, effective } = makeOwnerDeps();
    await service.createCustomer(user, effective, { customerCode: "CUS-DUP", nameAr: "عميل 1", normalizedName: "عميل 1" });
    await expect(service.createCustomer(user, effective, { customerCode: "CUS-DUP", nameAr: "عميل 2", normalizedName: "عميل 2" })).rejects.toThrow(MasterDataDuplicateCodeError);
  });

  it("Worker cannot inactivate customer", async () => {
    const od = makeOwnerDeps();
    const wd = makeWarehouseDeps();
    const c = await od.service.createCustomer(od.user, od.effective, { customerCode: "CUS-W", nameAr: "عميل", normalizedName: "عميل" });
    await expect(wd.service.inactivateCustomer(wd.user, wd.effective, c.id)).rejects.toThrow(PermissionDeniedError);
  });
});

describe("WP-02-01 MasterDataService — locations", () => {
  it("Owner can create a warehouse location", async () => {
    const { service, user, effective, audit } = makeOwnerDeps();
    const l = await service.createLocation(user, effective, { locationCode: "WH-ALX-31", nameAr: "31اسكندرية", locationType: "internal_warehouse", address: "الإسكندرية" });
    expect(l.locationCode).toBe("WH-ALX-31");
    expect(audit.getRows()[0]!.actionType).toBe("location.create");
  });

  it("Duplicate location code rejected", async () => {
    const { service, user, effective } = makeOwnerDeps();
    await service.createLocation(user, effective, { locationCode: "WH-DUP", nameAr: "موقع 1", locationType: "internal_warehouse" });
    await expect(service.createLocation(user, effective, { locationCode: "WH-DUP", nameAr: "موقع 2", locationType: "internal_warehouse" })).rejects.toThrow(MasterDataDuplicateCodeError);
  });

  it("Same location code in different tenants allowed", async () => {
    const od = makeOwnerDeps();
    const fd = makeDeps();
    const fu = TEST_FOREIGN_ACCOUNTANT;
    const fe = getTestEffectivePermissions(fu.userId);
    await od.service.createLocation(od.user, od.effective, { locationCode: "WH-SHARED", nameAr: "موقع", locationType: "internal_warehouse" });
    const fl = await fd.service.createLocation(fu, fe, { locationCode: "WH-SHARED", nameAr: "موقع أجنبي", locationType: "internal_warehouse" });
    expect(fl.tenantId).toBe(FOREIGN_TENANT_ID);
  });
});

describe("WP-02-01 MasterDataService — external factories + factory-location link", () => {
  it("Owner can create factory linked to external_single_factory location", async () => {
    const { service, user, effective, audit } = makeOwnerDeps();
    const l = await service.createLocation(user, effective, { locationCode: "FAC-LOC-01", nameAr: "موقع مصنع", locationType: "external_single_factory" });
    const f = await service.createExternalFactory(user, effective, { factoryCode: "FAC-001", nameAr: "مصر ايران", factoryType: "single_yarn", linkedLocationId: l.id });
    expect(f.linkedLocationId).toBe(l.id);
    expect(audit.count()).toBe(2);
  });

  it("Factory type must correspond to location type", async () => {
    const { service, user, effective } = makeOwnerDeps();
    const l = await service.createLocation(user, effective, { locationCode: "FAC-LOC-T", nameAr: "موقع برم", locationType: "external_twisting_factory" });
    await expect(service.createExternalFactory(user, effective, { factoryCode: "FAC-MM", nameAr: "مصنع", factoryType: "single_yarn", linkedLocationId: l.id })).rejects.toThrow(FactoryLocationLinkError);
  });

  it("validateFactoryLocationTypeMatch: single_yarn requires external_single_factory", () => {
    expect(() => validateFactoryLocationTypeMatch("single_yarn", "external_single_factory")).not.toThrow();
    expect(() => validateFactoryLocationTypeMatch("single_yarn", "external_twisting_factory")).toThrow(FactoryLocationLinkError);
  });

  it("validateFactoryLocationTypeMatch: twisting requires external_twisting_factory", () => {
    expect(() => validateFactoryLocationTypeMatch("twisting", "external_twisting_factory")).not.toThrow();
    expect(() => validateFactoryLocationTypeMatch("twisting", "external_single_factory")).toThrow(FactoryLocationLinkError);
  });

  it("validateFactoryLocationTypeMatch: both accepts either external type", () => {
    expect(() => validateFactoryLocationTypeMatch("both", "external_single_factory")).not.toThrow();
    expect(() => validateFactoryLocationTypeMatch("both", "external_twisting_factory")).not.toThrow();
    expect(() => validateFactoryLocationTypeMatch("both", "internal_warehouse")).toThrow(FactoryLocationLinkError);
  });

  it("One factory per location (1:1 enforced)", async () => {
    const { service, user, effective } = makeOwnerDeps();
    const l = await service.createLocation(user, effective, { locationCode: "FAC-LOC-1TO1", nameAr: "موقع", locationType: "external_single_factory" });
    await service.createExternalFactory(user, effective, { factoryCode: "FAC-FIRST", nameAr: "مصنع أول", factoryType: "single_yarn", linkedLocationId: l.id });
    await expect(service.createExternalFactory(user, effective, { factoryCode: "FAC-SECOND", nameAr: "مصنع ثاني", factoryType: "single_yarn", linkedLocationId: l.id })).rejects.toThrow(FactoryLocationLinkError);
  });

  it("Cannot inactivate location linked to active factory", async () => {
    const { service, user, effective } = makeOwnerDeps();
    const l = await service.createLocation(user, effective, { locationCode: "FAC-LOC-PROT", nameAr: "موقع محمي", locationType: "external_single_factory" });
    await service.createExternalFactory(user, effective, { factoryCode: "FAC-PROT", nameAr: "مصنع محمي", factoryType: "single_yarn", linkedLocationId: l.id });
    await expect(service.inactivateLocation(user, effective, l.id)).rejects.toThrow(MasterDataInactivationError);
    const f = (await service.listActiveExternalFactories(user, effective))[0]!;
    await service.inactivateExternalFactory(user, effective, f.id);
    const inact = await service.inactivateLocation(user, effective, l.id);
    expect(inact.status).toBe("inactive");
  });

  it("Factory with non-existent linked location rejected", async () => {
    const { service, user, effective } = makeOwnerDeps();
    await expect(service.createExternalFactory(user, effective, { factoryCode: "FAC-NOLOC", nameAr: "مصنع", factoryType: "single_yarn", linkedLocationId: "nonexistent" })).rejects.toThrow(FactoryLocationLinkError);
  });

  it("Duplicate factory code rejected", async () => {
    const { service, user, effective } = makeOwnerDeps();
    const l1 = await service.createLocation(user, effective, { locationCode: "FLD1", nameAr: "موقع 1", locationType: "external_single_factory" });
    await service.createExternalFactory(user, effective, { factoryCode: "FAC-DUP", nameAr: "مصنع 1", factoryType: "single_yarn", linkedLocationId: l1.id });
    const l2 = await service.createLocation(user, effective, { locationCode: "FLD2", nameAr: "موقع 2", locationType: "external_single_factory" });
    await expect(service.createExternalFactory(user, effective, { factoryCode: "FAC-DUP", nameAr: "مصنع 2", factoryType: "single_yarn", linkedLocationId: l2.id })).rejects.toThrow(MasterDataDuplicateCodeError);
  });
});

describe("WP-02-01 MasterDataService — simple masters", () => {
  it("Owner can create fiber type", async () => {
    const { service, user, effective, audit } = makeOwnerDeps();
    const f = await service.createFiberType(user, effective, { code: "COTTON-SUDAN", nameAr: "قطن سودانى" });
    expect(f.code).toBe("COTTON-SUDAN");
    expect(audit.getRows()[0]!.actionType).toBe("fiber_type.create");
  });

  it("Duplicate fiber type code rejected", async () => {
    const { service, user, effective } = makeOwnerDeps();
    await service.createFiberType(user, effective, { code: "COTTON", nameAr: "قطن" });
    await expect(service.createFiberType(user, effective, { code: "COTTON", nameAr: "قطن 2" })).rejects.toThrow(MasterDataDuplicateCodeError);
  });

  it("Owner can create product type", async () => {
    const { service, user, effective } = makeOwnerDeps();
    const p = await service.createProductType(user, effective, { code: "YARN-30S", nameAr: "خيط 30 ث" });
    expect(p.code).toBe("YARN-30S");
  });

  it("Owner can create quality parameter", async () => {
    const { service, user, effective } = makeOwnerDeps();
    const q = await service.createQualityParameter(user, effective, { code: "STRENGTH", nameAr: "القوة", unit: "g/tex" });
    expect(q.unit).toBe("g/tex");
  });

  it("Worker can list simple masters (view_names)", async () => {
    const repo = new InMemoryMasterDataRepository();
    const os = new MasterDataService({ repository: repo, audit: new InProcessAuditStore() });
    const ws = new MasterDataService({ repository: repo, audit: new InProcessAuditStore() });
    await os.createFiberType(TEST_USERS.owner, getTestEffectivePermissions(TEST_USERS.owner.userId), { code: "COTTON", nameAr: "قطن" });
    const list = await ws.listActiveFiberTypes(TEST_USERS.warehouse, getTestEffectivePermissions(TEST_USERS.warehouse.userId));
    expect(list).toHaveLength(1);
  });
});

describe("WP-02-01 MasterDataService — cross-tenant isolation", () => {
  it("Foreign tenant cannot see owner tenant's suppliers", async () => {
    const od = makeOwnerDeps();
    const fd = makeDeps();
    const fu = TEST_FOREIGN_ACCOUNTANT;
    const fe = getTestEffectivePermissions(fu.userId);
    await od.service.createSupplier(od.user, od.effective, { supplierCode: "SUP-ISO", nameAr: "مورد عزل", normalizedName: "مورد عزل" });
    const fl = await fd.service.listActiveSuppliers(fu, fe);
    expect(fl).toHaveLength(0);
    const ol = await od.service.listActiveSuppliers(od.user, od.effective);
    expect(ol).toHaveLength(1);
  });

  it("Foreign tenant cannot inactivate owner's supplier (not found)", async () => {
    const od = makeOwnerDeps();
    const fd = makeDeps();
    const fu = TEST_FOREIGN_ACCOUNTANT;
    const fe = getTestEffectivePermissions(fu.userId);
    const s = await od.service.createSupplier(od.user, od.effective, { supplierCode: "SUP-CROSS", nameAr: "مورد", normalizedName: "مورد" });
    await expect(fd.service.inactivateSupplier(fu, fe, s.id)).rejects.toThrow(MasterDataNotFoundError);
  });
});

describe("WP-02-01 MasterDataService — audit", () => {
  it("Every create writes audit log", async () => {
    const { service, user, effective, audit } = makeOwnerDeps();
    await service.createSupplier(user, effective, { supplierCode: "S1", nameAr: "مورد", normalizedName: "مورد" });
    await service.createCustomer(user, effective, { customerCode: "C1", nameAr: "عميل", normalizedName: "عميل" });
    await service.createLocation(user, effective, { locationCode: "L1", nameAr: "موقع", locationType: "internal_warehouse" });
    await service.createFiberType(user, effective, { code: "F1", nameAr: "نوع" });
    await service.createProductType(user, effective, { code: "P1", nameAr: "منتج" });
    await service.createQualityParameter(user, effective, { code: "Q1", nameAr: "معيار" });
    expect(audit.count()).toBe(6);
    const types = audit.getRows().map(r => r.actionType);
    expect(types).toContain("supplier.create");
    expect(types).toContain("customer.create");
    expect(types).toContain("location.create");
    expect(types).toContain("fiber_type.create");
    expect(types).toContain("product_type.create");
    expect(types).toContain("quality_parameter.create");
  });

  it("Inactivation writes old/new status", async () => {
    const { service, user, effective, audit } = makeOwnerDeps();
    const s = await service.createSupplier(user, effective, { supplierCode: "S-AUD", nameAr: "مورد", normalizedName: "مورد" });
    await service.inactivateSupplier(user, effective, s.id);
    const log = audit.getRows()[1]!;
    expect(log.oldValuesJson).toEqual({ status: "active" });
    expect(log.newValuesJson).toEqual({ status: "inactive" });
  });

  it("Audit logs carry correct tenantId and userId", async () => {
    const { service, user, effective, audit } = makeOwnerDeps();
    await service.createSupplier(user, effective, { supplierCode: "S-CTX", nameAr: "مورد", normalizedName: "مورد" });
    const log = audit.getRows()[0]!;
    expect(log.tenantId).toBe(user.tenantId);
    expect(log.userId).toBe(user.userId);
  });
});
