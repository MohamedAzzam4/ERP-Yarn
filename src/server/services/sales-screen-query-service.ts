/**
 * Sales Screen Query Service — WP-08-01C.
 *
 * Contract: docs/contracts/10_frontend_screen_contracts.md §§8.1/8.4
 *   §8.1: Approval Center — permission-filtered queue for high-risk decisions
 *   §8.4: Sales Screens — draft/detail/approval/failure-resolution
 *
 * Contract: docs/contracts/13_work_packages.md WP-08-01C
 *   Goal: Complete sales management and wire the approved review-queue pattern to real commands.
 *
 * Role-safe DTOs:
 *   - Management DTOs: full commercial totals, price, profitability (Owner/Accountant)
 *   - Worker is NOT exposed to sales screens (Contract 11: sales is management-only)
 *
 * Redaction (Contract 10 §8.4):
 *   - Document codes, quantities, prices, money LTR-isolated
 *   - Display server-calculated results; never recreate posting authority in the client
 */
import "server-only";

import { eq, and, desc, inArray } from "drizzle-orm";
import {
  salesOrders,
  salesOrderLines,
  salesProfitabilitySnapshots,
  type SalesOrder,
  type SalesOrderLine,
} from "@/server/db/schema/sales";
import { customers, inventoryItems, locations } from "@/server/db/schema";
import { returnRequests } from "@/server/db/schema/returns";
import { approvalRequests } from "@/server/db/schema/approval-requests";
import type { db as DbType } from "@/server/db/client";

type Db = NonNullable<typeof DbType>;

// ---------------------------------------------------------------------------
// Management DTOs (full — includes commercial/financial fields)
// ---------------------------------------------------------------------------

export interface ManagementSalesOrderDto {
  id: string;
  docNo: string;
  customerId: string;
  customerName: string;
  customerCode: string;
  saleStatus: string;
  approvalStatus: string;
  saleDate: string | null;
  totalGrossRevenue: string;
  orderDiscountTotal: string;
  documentTotalPosted: string;
  qualityWarningStatus: string | null;
  reservationStatus: string | null;
  paymentStatus: string | null;
  deliveryStatus: string | null;
  isReplacementOrder: boolean;
  isLocked: boolean;
  subjectHash: string | null;
  subjectVersion: number | null;
}

export interface ManagementSalesLineDto {
  id: string;
  salesOrderId: string;
  lineNo: number;
  itemId: string;
  itemCode: string;
  itemName: string;
  locationId: string;
  locationCode: string;
  quantityKg: string;
  pricePerTon: string | null;
  lineGrossRevenue: string | null;
  lineAllocatedDiscountPosted: string | null;
  lineNetRevenuePosted: string | null;
  roundingAdjustment: string;
  reservationId: string | null;
  saleIssueMovementId: string | null;
}

export interface ManagementApprovalQueueDto {
  id: string;
  entityType: string;
  requestType: string;
  entityId: string;
  state: string;
  requestedBy: string;
  requestedAt: Date;
  reason: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionNotes: string | null;
  subjectHash: string;
  subjectVersion: number;
}

export interface ManagementReturnRequestDto {
  id: string;
  docNo: string;
  salesOrderId: string;
  customerId: string;
  customerName: string;
  customerCode: string;
  returnDate: string;
  status: string;
  approvalStatus: string;
  returnReason: string;
  financialTreatment: string | null;
  isReplacement: boolean;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class SalesScreenQueryService {
  constructor(private readonly db: Db) {}

  /**
   * List sales orders for management (Owner/Accountant).
   * Contract 10 §8.4: full commercial totals visible to management.
   */
  async listManagementSalesOrders(tenantId: string): Promise<ManagementSalesOrderDto[]> {
    const results = await this.db
      .select({
        order: salesOrders,
        customer: customers,
      })
      .from(salesOrders)
      .innerJoin(customers, eq(salesOrders.customerId, customers.id))
      .where(eq(salesOrders.tenantId, tenantId))
      .orderBy(desc(salesOrders.createdAt));

    return results.map((r) => ({
      id: r.order.id,
      docNo: r.order.docNo,
      customerId: r.order.customerId,
      customerName: r.customer.nameEn || r.customer.nameAr,
      customerCode: r.customer.customerCode,
      saleStatus: r.order.saleStatus,
      approvalStatus: r.order.approvalStatus,
      saleDate: r.order.saleDate,
      totalGrossRevenue: r.order.totalGrossRevenue,
      orderDiscountTotal: r.order.orderDiscountTotal,
      documentTotalPosted: r.order.documentTotalPosted,
      qualityWarningStatus: r.order.qualityWarningStatus,
      reservationStatus: r.order.reservationStatus,
      paymentStatus: r.order.paymentStatus,
      deliveryStatus: r.order.deliveryStatus,
      isReplacementOrder: r.order.isReplacementOrder,
      isLocked: r.order.isLocked,
      subjectHash: r.order.subjectHash,
      subjectVersion: r.order.subjectVersion,
    }));
  }

  /**
   * List sales order lines for management (full — includes price/revenue).
   */
  async listManagementSalesLines(tenantId: string, salesOrderId: string): Promise<ManagementSalesLineDto[]> {
    const results = await this.db
      .select({
        line: salesOrderLines,
        item: inventoryItems,
        location: locations,
      })
      .from(salesOrderLines)
      .innerJoin(inventoryItems, eq(salesOrderLines.itemId, inventoryItems.id))
      .innerJoin(locations, eq(salesOrderLines.locationId, locations.id))
      .where(and(
        eq(salesOrderLines.tenantId, tenantId),
        eq(salesOrderLines.salesOrderId, salesOrderId),
      ))
      .orderBy(salesOrderLines.lineNo);

    return results.map((r) => ({
      id: r.line.id,
      salesOrderId: r.line.salesOrderId,
      lineNo: r.line.lineNo,
      itemId: r.line.itemId,
      itemCode: r.item.itemCode,
      itemName: r.item.displayNameEn || r.item.displayNameAr,
      locationId: r.line.locationId,
      locationCode: r.location.locationCode,
      quantityKg: r.line.quantityKg,
      pricePerTon: r.line.pricePerTon,
      lineGrossRevenue: r.line.lineGrossRevenue,
      lineAllocatedDiscountPosted: r.line.lineAllocatedDiscountPosted,
      lineNetRevenuePosted: r.line.lineNetRevenuePosted,
      roundingAdjustment: r.line.roundingAdjustment,
      reservationId: r.line.reservationId,
      saleIssueMovementId: r.line.saleIssueMovementId,
    }));
  }

  /**
   * List approval queue items for management (Owner/Accountant).
   * Contract 10 §8.1: permission-filtered queue for high-risk decisions.
   */
  async listManagementApprovalQueue(tenantId: string, entityTypes?: string[]): Promise<ManagementApprovalQueueDto[]> {
    const conditions = [eq(approvalRequests.tenantId, tenantId)];
    if (entityTypes && entityTypes.length > 0) {
      conditions.push(inArray(approvalRequests.entityType, entityTypes));
    }
    const results = await this.db
      .select()
      .from(approvalRequests)
      .where(and(...conditions))
      .orderBy(desc(approvalRequests.requestedAt));

    return results.map((r) => ({
      id: r.id,
      entityType: r.entityType,
      requestType: r.requestType,
      entityId: r.entityId,
      state: r.state,
      requestedBy: r.requestedBy,
      requestedAt: r.requestedAt,
      reason: r.reason,
      decidedBy: r.decidedBy,
      decidedAt: r.decidedAt,
      decisionNotes: r.decisionNotes,
      subjectHash: r.subjectHash,
      subjectVersion: r.subjectVersion,
    }));
  }

  /**
   * List return requests for management (Owner/Accountant).
   * Contract 10 §8.4: sales returns management screen.
   */
  async listManagementReturnRequests(tenantId: string): Promise<ManagementReturnRequestDto[]> {
    const results = await this.db
      .select({
        rr: returnRequests,
        customer: customers,
      })
      .from(returnRequests)
      .innerJoin(customers, eq(returnRequests.customerId, customers.id))
      .where(eq(returnRequests.tenantId, tenantId))
      .orderBy(desc(returnRequests.createdAt));

    return results.map((r) => ({
      id: r.rr.id,
      docNo: r.rr.docNo,
      salesOrderId: r.rr.salesOrderId,
      customerId: r.rr.customerId,
      customerName: r.customer.nameEn || r.customer.nameAr,
      customerCode: r.customer.customerCode,
      returnDate: r.rr.returnDate,
      status: r.rr.status,
      approvalStatus: r.rr.approvalStatus,
      returnReason: r.rr.returnReason,
      financialTreatment: r.rr.financialTreatment,
      isReplacement: r.rr.isReplacement,
    }));
  }
}
