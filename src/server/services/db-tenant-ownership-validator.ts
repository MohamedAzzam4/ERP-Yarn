/**
 * DbTenantOwnershipValidator — WP-08-01A.
 *
 * Strict cross-tenant guard for transfer + return workflows.
 *
 * Contract: docs/contracts/01_technical_architecture_and_deployment_contract.md
 *   "Every tenant-scoped read or write MUST filter by tenant_id; a valid
 *    row in Tenant-B used by Tenant-A MUST be rejected even if the FK
 *    exists."
 *
 * Contract: docs/contracts/06_approval_transaction_contract.md §6
 *   Universal Approval Contract — server derives tenant/user from
 *   authenticated context; client-supplied IDs are validated before any
 *   write.
 *
 * Why this exists:
 *   The DB schema uses FK constraints for `customer_id`, `sales_order_id`,
 *   `sale_line_id`, `item_id`, `location_id`. A FK only proves the row
 *   exists in some tenant — it does NOT prove the row belongs to the
 *   actor's tenant, nor that the relation chain (customer↔order↔line↔item)
 *   is internally consistent. A valid Tenant-B customer used by Tenant-A
 *   would pass the FK (cross-tenant FK references are allowed when the
 *   referenced column is unique) but must be rejected.
 *
 * Design:
 *   - All lookups are tenant-scoped (WHERE tenant_id = $actor).
 *   - Each relation method returns `void` on success, throws
 *     `TenantOwnershipValidationError` on failure.
 *   - Caller MUST invoke this BEFORE the idempotency claim — a rejected
 *     request must NOT create an idempotency record, header, line, or audit.
 *   - The validator is REQUIRED in `TransferWorkflowServiceDeps` and
 *     `ReturnRequestServiceDeps`. Production factories MUST pass
 *     `DbTenantOwnershipValidator`; tests MUST pass a mock.
 *   - No fail-open: there is no optional `?` — omitting it is a compile
 *     error.
 */
import "server-only";

import { eq, and } from "drizzle-orm";
import {
  customers,
  locations,
} from "@/server/db/schema/master-data";
import { inventoryItems } from "@/server/db/schema/inventory-items";
import {
  salesOrders,
  salesOrderLines,
} from "@/server/db/schema/sales";
import type { db as DbType } from "@/server/db/client";

type Db = NonNullable<typeof DbType>;

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

export class TenantOwnershipValidationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "TenantOwnershipValidationError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Validator interface (so tests can pass mocks).
// ---------------------------------------------------------------------------

export interface TenantOwnershipValidator {
  /**
   * Validate that `itemId` belongs to `tenantId`. Throws if not found or
   * cross-tenant.
   */
  validateItemBelongsToTenant(tenantId: string, itemId: string): Promise<void>;

  /**
   * Validate that `locationId` belongs to `tenantId`.
   */
  validateLocationBelongsToTenant(tenantId: string, locationId: string): Promise<void>;

  /**
   * Validate that `sourceLocationId` and `toLocationId` are different
   * (and both belong to the tenant — caller is expected to have called
   * validateLocationBelongsToTenant for each, but this method also checks
   * the inequality constraint).
   */
  validateSourceAndDestinationDiffer(
    fromLocationId: string,
    toLocationId: string,
  ): void;

  /**
   * Validate that `customerId` belongs to `tenantId`.
   */
  validateCustomerBelongsToTenant(tenantId: string, customerId: string): Promise<void>;

  /**
   * Validate that `saleOrderId` belongs to `tenantId` AND belongs to
   * `customerId` (the sale's customer_id matches).
   */
  validateSaleBelongsToTenantAndCustomer(
    tenantId: string,
    saleOrderId: string,
    customerId: string,
  ): Promise<void>;

  /**
   * Validate that `saleLineId` belongs to `tenantId` AND belongs to
   * `saleOrderId` (the line's sales_order_id matches).
   */
  validateLineBelongsToSale(
    tenantId: string,
    saleLineId: string,
    saleOrderId: string,
  ): Promise<void>;

  /**
   * Validate that `saleLineId` references `itemId` (the line's item_id
   * matches).
   */
  validateLineReferencesItem(
    tenantId: string,
    saleLineId: string,
    itemId: string,
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Production implementation — Drizzle-backed, tenant-scoped.
// ---------------------------------------------------------------------------

export class DbTenantOwnershipValidator implements TenantOwnershipValidator {
  constructor(private readonly db: Db) {}

  async validateItemBelongsToTenant(tenantId: string, itemId: string): Promise<void> {
    const [row] = await this.db
      .select({ id: inventoryItems.id, tenantId: inventoryItems.tenantId })
      .from(inventoryItems)
      .where(and(eq(inventoryItems.id, itemId), eq(inventoryItems.tenantId, tenantId)))
      .limit(1);
    if (!row) {
      throw new TenantOwnershipValidationError(
        "ITEM_NOT_OWNED_BY_TENANT",
        `Item '${itemId}' does not belong to tenant '${tenantId}'.`,
      );
    }
  }

  async validateLocationBelongsToTenant(tenantId: string, locationId: string): Promise<void> {
    const [row] = await this.db
      .select({ id: locations.id, tenantId: locations.tenantId })
      .from(locations)
      .where(and(eq(locations.id, locationId), eq(locations.tenantId, tenantId)))
      .limit(1);
    if (!row) {
      throw new TenantOwnershipValidationError(
        "LOCATION_NOT_OWNED_BY_TENANT",
        `Location '${locationId}' does not belong to tenant '${tenantId}'.`,
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

  async validateCustomerBelongsToTenant(tenantId: string, customerId: string): Promise<void> {
    const [row] = await this.db
      .select({ id: customers.id, tenantId: customers.tenantId })
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)))
      .limit(1);
    if (!row) {
      throw new TenantOwnershipValidationError(
        "CUSTOMER_NOT_OWNED_BY_TENANT",
        `Customer '${customerId}' does not belong to tenant '${tenantId}'.`,
      );
    }
  }

  async validateSaleBelongsToTenantAndCustomer(
    tenantId: string,
    saleOrderId: string,
    customerId: string,
  ): Promise<void> {
    const [row] = await this.db
      .select({
        id: salesOrders.id,
        tenantId: salesOrders.tenantId,
        customerId: salesOrders.customerId,
      })
      .from(salesOrders)
      .where(and(eq(salesOrders.id, saleOrderId), eq(salesOrders.tenantId, tenantId)))
      .limit(1);
    if (!row) {
      throw new TenantOwnershipValidationError(
        "SALE_NOT_OWNED_BY_TENANT",
        `Sale order '${saleOrderId}' does not belong to tenant '${tenantId}'.`,
      );
    }
    if (row.customerId !== customerId) {
      throw new TenantOwnershipValidationError(
        "SALE_CUSTOMER_MISMATCH",
        `Sale order '${saleOrderId}' does not belong to customer '${customerId}' (actual customer '${row.customerId}').`,
      );
    }
  }

  async validateLineBelongsToSale(
    tenantId: string,
    saleLineId: string,
    saleOrderId: string,
  ): Promise<void> {
    const [row] = await this.db
      .select({
        id: salesOrderLines.id,
        tenantId: salesOrderLines.tenantId,
        salesOrderId: salesOrderLines.salesOrderId,
      })
      .from(salesOrderLines)
      .where(and(eq(salesOrderLines.id, saleLineId), eq(salesOrderLines.tenantId, tenantId)))
      .limit(1);
    if (!row) {
      throw new TenantOwnershipValidationError(
        "SALE_LINE_NOT_OWNED_BY_TENANT",
        `Sale line '${saleLineId}' does not belong to tenant '${tenantId}'.`,
      );
    }
    if (row.salesOrderId !== saleOrderId) {
      throw new TenantOwnershipValidationError(
        "SALE_LINE_ORDER_MISMATCH",
        `Sale line '${saleLineId}' does not belong to sale order '${saleOrderId}' (actual order '${row.salesOrderId}').`,
      );
    }
  }

  async validateLineReferencesItem(
    tenantId: string,
    saleLineId: string,
    itemId: string,
  ): Promise<void> {
    const [row] = await this.db
      .select({
        id: salesOrderLines.id,
        tenantId: salesOrderLines.tenantId,
        itemId: salesOrderLines.itemId,
      })
      .from(salesOrderLines)
      .where(and(eq(salesOrderLines.id, saleLineId), eq(salesOrderLines.tenantId, tenantId)))
      .limit(1);
    if (!row) {
      throw new TenantOwnershipValidationError(
        "SALE_LINE_NOT_OWNED_BY_TENANT",
        `Sale line '${saleLineId}' does not belong to tenant '${tenantId}'.`,
      );
    }
    if (row.itemId !== itemId) {
      throw new TenantOwnershipValidationError(
        "SALE_LINE_ITEM_MISMATCH",
        `Sale line '${saleLineId}' does not reference item '${itemId}' (actual item '${row.itemId}').`,
      );
    }
  }
}

export function createDbTenantOwnershipValidator(db: Db): DbTenantOwnershipValidator {
  return new DbTenantOwnershipValidator(db);
}
