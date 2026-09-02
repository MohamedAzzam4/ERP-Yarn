/**
 * r24 BLOCKER C: Owner Authority Lookup adapters.
 *
 * Contract 07: account `owner_id` corresponds to a customer/supplier/factory
 * master record. Inactive owner records retain history but cannot be selected
 * for new transactions.
 *
 * PaymentService.createDraftPayment delegates owner existence + active status
 * to an `OwnerAuthorityLookup`. We provide TWO concrete adapters:
 *
 * 1. `MasterDataOwnerAuthorityLookup` — production: backed by the canonical
 *    `MasterDataRepository` (Drizzle in production). It looks up
 *    customer/supplier/external-factory by tenantId + id and returns
 *    `{ status }` or `null`. The lookup is tenant-scoped — a foreign-tenant
 *    ownerId returns null (caller throws `OwnerNotFoundError` to avoid
 *    cross-tenant disclosure per Contract 09 §5).
 *
 * 2. `InMemoryOwnerAuthorityLookup` — tests: backed by an in-memory map of
 *    owner records. Used by unit tests for DRAFT-OWNER-1/2/3/4.
 *
 * Both adapters implement the same `OwnerAuthorityLookup` interface defined
 * in `payment-service.ts`. PaymentService depends ONLY on the interface —
 * it has no knowledge of MasterDataRepository.
 */
import type { OwnerAuthorityLookup, AccountOwnerType } from "./payment-service";

export interface OwnerMasterRecord {
  tenantId: string;
  ownerType: AccountOwnerType;
  ownerId: string;
  status: "active" | "inactive";
}

/**
 * Production adapter — delegates to MasterDataRepository's
 * `findCustomerById` / `findSupplierById` / `findExternalFactoryById`
 * tenant-scoped lookups. No new master-data authority is invented —
 * PaymentService reuses the canonical MasterDataRepository.
 */
export class MasterDataOwnerAuthorityLookup implements OwnerAuthorityLookup {
  constructor(private readonly repo: {
    findCustomerById(tenantId: string, id: string): Promise<{ status: string } | null>;
    findSupplierById(tenantId: string, id: string): Promise<{ status: string } | null>;
    findExternalFactoryById(tenantId: string, id: string): Promise<{ status: string } | null>;
  }) {}

  async findOwner(
    tenantId: string,
    ownerType: AccountOwnerType,
    ownerId: string,
  ): Promise<{ status: "active" | "inactive" } | null> {
    if (ownerType === "customer") {
      const r = await this.repo.findCustomerById(tenantId, ownerId);
      if (!r) return null;
      return r.status === "active" ? { status: "active" } : { status: "inactive" };
    }
    if (ownerType === "supplier") {
      const r = await this.repo.findSupplierById(tenantId, ownerId);
      if (!r) return null;
      return r.status === "active" ? { status: "active" } : { status: "inactive" };
    }
    if (ownerType === "factory") {
      const r = await this.repo.findExternalFactoryById(tenantId, ownerId);
      if (!r) return null;
      return r.status === "active" ? { status: "active" } : { status: "inactive" };
    }
    // Unknown ownerType — treat as not found (caller throws OwnerNotFoundError).
    return null;
  }
}

/**
 * Test-only in-memory adapter. Backed by a Map of owner records. Used by
 * unit tests for DRAFT-OWNER-1/2/3/4. NOT for production use.
 */
export class InMemoryOwnerAuthorityLookup implements OwnerAuthorityLookup {
  private owners = new Map<string, OwnerMasterRecord>();

  seed(record: OwnerMasterRecord): void {
    this.owners.set(`${record.tenantId}:${record.ownerType}:${record.ownerId}`, record);
  }

  async findOwner(
    tenantId: string,
    ownerType: AccountOwnerType,
    ownerId: string,
  ): Promise<{ status: "active" | "inactive" } | null> {
    const r = this.owners.get(`${tenantId}:${ownerType}:${ownerId}`);
    if (!r) return null;
    return { status: r.status };
  }
}
