/**
 * In-memory TenantOwnershipValidator mock — WP-08-01A.
 *
 * Permissive by default: accepts ALL ownership + relation checks.
 * Tests can selectively tighten by calling `rejectItem`, `rejectLocation`,
 * etc. to simulate cross-tenant IDs, mismatches, or missing rows.
 *
 * TEST-ONLY helper. NOT for production use.
 */
import type { TenantOwnershipValidator } from "../db-tenant-ownership-validator";
import { TenantOwnershipValidationError } from "../db-tenant-ownership-validator";

export class InMemoryTenantOwnershipValidator implements TenantOwnershipValidator {
  private reject: Partial<{
    item: Set<string>;
    location: Set<string>;
    customer: Set<string>;
    sale: Set<string>;
    saleLine: Set<string>;
    saleLineItem: Set<string>;
    saleLineOrder: Set<string>;
    saleCustomer: Set<string>;
  }> = {};

  rejectItem(itemId: string): this {
    if (!this.reject.item) this.reject.item = new Set();
    this.reject.item.add(itemId);
    return this;
  }
  rejectLocation(locationId: string): this {
    if (!this.reject.location) this.reject.location = new Set();
    this.reject.location.add(locationId);
    return this;
  }
  rejectCustomer(customerId: string): this {
    if (!this.reject.customer) this.reject.customer = new Set();
    this.reject.customer.add(customerId);
    return this;
  }
  rejectSale(saleOrderId: string): this {
    if (!this.reject.sale) this.reject.sale = new Set();
    this.reject.sale.add(saleOrderId);
    return this;
  }
  rejectSaleLine(saleLineId: string): this {
    if (!this.reject.saleLine) this.reject.saleLine = new Set();
    this.reject.saleLine.add(saleLineId);
    return this;
  }
  rejectSaleLineItem(saleLineId: string): this {
    if (!this.reject.saleLineItem) this.reject.saleLineItem = new Set();
    this.reject.saleLineItem.add(saleLineId);
    return this;
  }
  rejectSaleLineOrder(saleLineId: string): this {
    if (!this.reject.saleLineOrder) this.reject.saleLineOrder = new Set();
    this.reject.saleLineOrder.add(saleLineId);
    return this;
  }
  rejectSaleCustomer(saleOrderId: string): this {
    if (!this.reject.saleCustomer) this.reject.saleCustomer = new Set();
    this.reject.saleCustomer.add(saleOrderId);
    return this;
  }

  async validateItemBelongsToTenant(_tenantId: string, itemId: string): Promise<void> {
    if (this.reject.item?.has(itemId)) {
      throw new TenantOwnershipValidationError(
        "ITEM_NOT_OWNED_BY_TENANT",
        `Item '${itemId}' does not belong to tenant (mock rejection).`,
      );
    }
  }

  async validateLocationBelongsToTenant(_tenantId: string, locationId: string): Promise<void> {
    if (this.reject.location?.has(locationId)) {
      throw new TenantOwnershipValidationError(
        "LOCATION_NOT_OWNED_BY_TENANT",
        `Location '${locationId}' does not belong to tenant (mock rejection).`,
      );
    }
  }

  validateSourceAndDestinationDiffer(fromLocationId: string, toLocationId: string): void {
    if (!fromLocationId || !toLocationId) {
      throw new TenantOwnershipValidationError(
        "VALIDATION_FAILED",
        "Source and destination location IDs are required.",
      );
    }
    if (fromLocationId === toLocationId) {
      throw new TenantOwnershipValidationError(
        "SOURCE_EQUALS_DESTINATION",
        `Source location '${fromLocationId}' must differ from destination '${toLocationId}'.`,
      );
    }
  }

  async validateCustomerBelongsToTenant(_tenantId: string, customerId: string): Promise<void> {
    if (this.reject.customer?.has(customerId)) {
      throw new TenantOwnershipValidationError(
        "CUSTOMER_NOT_OWNED_BY_TENANT",
        `Customer '${customerId}' does not belong to tenant (mock rejection).`,
      );
    }
  }

  async validateSaleBelongsToTenantAndCustomer(
    _tenantId: string,
    saleOrderId: string,
    _customerId: string,
  ): Promise<void> {
    if (this.reject.sale?.has(saleOrderId)) {
      throw new TenantOwnershipValidationError(
        "SALE_NOT_OWNED_BY_TENANT",
        `Sale order '${saleOrderId}' does not belong to tenant (mock rejection).`,
      );
    }
    if (this.reject.saleCustomer?.has(saleOrderId)) {
      throw new TenantOwnershipValidationError(
        "SALE_CUSTOMER_MISMATCH",
        `Sale order '${saleOrderId}' does not belong to customer (mock rejection).`,
      );
    }
  }

  async validateLineBelongsToSale(
    _tenantId: string,
    saleLineId: string,
    _saleOrderId: string,
  ): Promise<void> {
    if (this.reject.saleLine?.has(saleLineId)) {
      throw new TenantOwnershipValidationError(
        "SALE_LINE_NOT_OWNED_BY_TENANT",
        `Sale line '${saleLineId}' does not belong to tenant (mock rejection).`,
      );
    }
    if (this.reject.saleLineOrder?.has(saleLineId)) {
      throw new TenantOwnershipValidationError(
        "SALE_LINE_ORDER_MISMATCH",
        `Sale line '${saleLineId}' does not belong to sale order (mock rejection).`,
      );
    }
  }

  async validateLineReferencesItem(
    _tenantId: string,
    saleLineId: string,
    _itemId: string,
  ): Promise<void> {
    if (this.reject.saleLineItem?.has(saleLineId)) {
      throw new TenantOwnershipValidationError(
        "SALE_LINE_ITEM_MISMATCH",
        `Sale line '${saleLineId}' does not reference item (mock rejection).`,
      );
    }
  }
}
