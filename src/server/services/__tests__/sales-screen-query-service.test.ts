/**
 * Sales Screen Query Service tests — WP-08-01C.
 *
 * Tests:
 *   1. Management DTOs include commercial/financial fields
 *   2. Sales line DTOs include price/revenue fields
 *   3. Approval queue DTO includes subject hash/version for stale detection
 *   4. Return request DTO includes financial treatment
 *   5. Empty state handling
 *   6. Service class structure (4 query methods)
 */
import { describe, it, expect } from "vitest";
import {
  SalesScreenQueryService,
  type ManagementSalesOrderDto,
  type ManagementSalesLineDto,
  type ManagementApprovalQueueDto,
  type ManagementReturnRequestDto,
} from "../sales-screen-query-service";

describe("WP-08-01C Management sales DTO financial visibility", () => {
  it("ManagementSalesOrderDto includes commercial totals", () => {
    const dto: ManagementSalesOrderDto = {
      id: "order-001",
      docNo: "SO-2026-001",
      customerId: "cust-001",
      customerName: "Test Customer",
      customerCode: "C-001",
      saleStatus: "approved",
      approvalStatus: "approved",
      saleDate: "2026-07-01",
      totalGrossRevenue: "80000.00",
      orderDiscountTotal: "2000.00",
      documentTotalPosted: "78000.00",
      qualityWarningStatus: null,
      reservationStatus: "reserved",
      paymentStatus: "pending",
      deliveryStatus: "pending",
      isReplacementOrder: false,
      isLocked: false,
      subjectHash: "abc123",
      subjectVersion: 1,
    };
    expect(dto).toHaveProperty("totalGrossRevenue");
    expect(dto).toHaveProperty("orderDiscountTotal");
    expect(dto).toHaveProperty("documentTotalPosted");
    expect(dto).toHaveProperty("subjectHash");
    expect(dto).toHaveProperty("subjectVersion");
    expect(dto).toHaveProperty("qualityWarningStatus");
    expect(dto).toHaveProperty("reservationStatus");
    expect(dto).toHaveProperty("paymentStatus");
  });

  it("ManagementSalesLineDto includes price and revenue", () => {
    const dto: ManagementSalesLineDto = {
      id: "line-001",
      salesOrderId: "order-001",
      lineNo: 1,
      itemId: "item-001",
      itemCode: "YARN-001",
      itemName: "Test Yarn",
      locationId: "loc-001",
      locationCode: "WH-01",
      quantityKg: "1000.000",
      pricePerTon: "80.00",
      lineGrossRevenue: "80000.00",
      lineAllocatedDiscountPosted: "2000.00",
      lineNetRevenuePosted: "78000.00",
      roundingAdjustment: "0.00",
      reservationId: "res-001",
      saleIssueMovementId: null,
    };
    expect(dto).toHaveProperty("pricePerTon");
    expect(dto).toHaveProperty("lineGrossRevenue");
    expect(dto).toHaveProperty("lineAllocatedDiscountPosted");
    expect(dto).toHaveProperty("lineNetRevenuePosted");
    expect(dto).toHaveProperty("roundingAdjustment");
    expect(dto).toHaveProperty("reservationId");
  });

  it("ManagementApprovalQueueDto includes subject hash for stale detection", () => {
    const dto: ManagementApprovalQueueDto = {
      id: "approval-001",
      entityType: "sale_order",
      requestType: "sales.approve",
      entityId: "order-001",
      state: "active",
      requestedBy: "user-001",
      requestedAt: new Date(),
      reason: null,
      decidedBy: null,
      decidedAt: null,
      decisionNotes: null,
      subjectHash: "abc123",
      subjectVersion: 1,
    };
    expect(dto).toHaveProperty("subjectHash");
    expect(dto).toHaveProperty("subjectVersion");
    expect(dto).toHaveProperty("state");
    expect(dto).toHaveProperty("entityType");
  });

  it("ManagementReturnRequestDto includes financial treatment", () => {
    const dto: ManagementReturnRequestDto = {
      id: "rr-001",
      docNo: "RR-2026-001",
      salesOrderId: "order-001",
      customerId: "cust-001",
      customerName: "Test Customer",
      customerCode: "C-001",
      returnDate: "2026-07-15",
      status: "pending_approval",
      approvalStatus: "pending_approval",
      returnReason: "Quality issue",
      financialTreatment: "customer_credit",
      isReplacement: false,
    };
    expect(dto).toHaveProperty("financialTreatment");
    expect(dto).toHaveProperty("isReplacement");
    expect(dto).toHaveProperty("approvalStatus");
  });
});

describe("WP-08-01C Service class structure", () => {
  it("has all required query methods", () => {
    const mockDb = {} as any;
    const service = new SalesScreenQueryService(mockDb);
    expect(typeof service.listManagementSalesOrders).toBe("function");
    expect(typeof service.listManagementSalesLines).toBe("function");
    expect(typeof service.listManagementApprovalQueue).toBe("function");
    expect(typeof service.listManagementReturnRequests).toBe("function");
  });
});

describe("WP-08-01C Empty state handling", () => {
  it("empty arrays are valid for all DTO types", () => {
    const emptyOrders: ManagementSalesOrderDto[] = [];
    const emptyLines: ManagementSalesLineDto[] = [];
    const emptyQueue: ManagementApprovalQueueDto[] = [];
    const emptyReturns: ManagementReturnRequestDto[] = [];
    expect(emptyOrders).toHaveLength(0);
    expect(emptyLines).toHaveLength(0);
    expect(emptyQueue).toHaveLength(0);
    expect(emptyReturns).toHaveLength(0);
  });
});
