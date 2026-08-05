/**
 * Quality/Complaint/Return Screen Query Service — WP-08-01E.
 *
 * Contract 10 §§7.3/8.7:
 *   §7.3: Worker quality screen — record quality tests, complaint
 *          investigation facts, returned-stock observations.
 *   §8.7: Management return/replacement management — review
 *          quality/complaints, approve return receipt, classification,
 *          financial treatment, replacement links.
 *
 * This service provides role-safe DTOs for both worker and management
 * screens. Worker DTOs redact all financial fields per Contract 11 §8.
 *
 * Contract 11 §8: Workers can NEVER see prices, discounts, credit/refund/
 * replacement value, balances, costs, profitability, or approval audit.
 */
import "server-only";
import { eq, and, desc, sql as drizzleSql } from "drizzle-orm";
import {
  qualityTests,
  complaints,
} from "@/server/db/schema/quality";
import {
  returnRequests,
  returnLines,
} from "@/server/db/schema/returns";
import { salesOrders, customers } from "@/server/db/schema";
import type { db as DbType } from "@/server/db/client";

type Db = NonNullable<typeof DbType>;

// ---------------------------------------------------------------------------
// Worker DTOs (redacted — no financial fields)
// ---------------------------------------------------------------------------

/**
 * Worker Quality Test DTO — redacted per Contract 11 §8.
 * Workers see: test code, date, status, risk classification, notes.
 * Workers do NOT see: prices, costs, profitability, approval audit.
 */
export interface WorkerQualityTestDto {
  id: string;
  testNo: string;
  testDate: string;
  linkedEntityType: string;
  linkedEntityId: string;
  saleId: string | null;
  customerId: string | null;
  testStatus: string;
  riskClassification: string;
  testedBy: string | null;
  testedAt: string | null;
  notes: string | null;
}

/**
 * Worker Complaint DTO — redacted per Contract 11 §8.
 * Workers see: complaint code, date, subject, status, priority, investigation.
 * Workers do NOT see: financial resolution values, credit/replacement amounts.
 */
export interface WorkerComplaintDto {
  id: string;
  complaintNo: string;
  complaintDate: string;
  customerId: string | null;
  saleId: string | null;
  subject: string;
  description: string | null;
  status: string;
  priority: string;
  investigatedBy: string | null;
  investigatedAt: string | null;
  investigationNotes: string | null;
  notes: string | null;
}

// ---------------------------------------------------------------------------
// Management DTOs (full fields, but still role-safe per Contract 11)
// ---------------------------------------------------------------------------

/**
 * Management Quality Test DTO — includes review fields.
 * Management sees: all worker fields + reviewedBy/reviewedAt/reviewNotes.
 */
export interface ManagementQualityTestDto extends WorkerQualityTestDto {
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
}

/**
 * Management Complaint DTO — includes resolution fields.
 * Management sees: all worker fields + resolution fields (but resolution
 * TYPE only, not financial amounts — amounts are in account entries).
 */
export interface ManagementComplaintDto extends WorkerComplaintDto {
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNotes: string | null;
  resolutionType: string | null;
}

/**
 * Management Return Request DTO — includes financial treatment.
 * Management sees: return status, treatment, replacement flag, sale link.
 * Financial values (credit/refund) are in account_entries, not denormalized.
 */
export interface ManagementReturnRequestDto {
  id: string;
  returnNo: string;
  salesOrderId: string;
  saleDocNo: string;
  customerId: string;
  customerName: string;
  customerCode: string;
  returnDate: string;
  status: string;
  returnReason: string;
  financialTreatment: string | null;
  isReplacement: boolean;
  totalReturnQuantity: string;
  returnLineCount: number;
}

/**
 * Management Return Line DTO — per-line return details.
 */
export interface ManagementReturnLineDto {
  id: string;
  returnRequestId: string;
  salesOrderLineId: string;
  returnedQuantity: string;
  returnReason: string;
  stockClassification: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class QualityReturnScreenQueryService {
  constructor(private readonly db: Db) {}

  // -------------------------------------------------------------------------
  // Worker queries (redacted DTOs)
  // -------------------------------------------------------------------------

  /**
   * List quality tests for a worker (Quality role).
   * Returns redacted DTOs — no financial fields.
   */
  async listQualityTestsForWorker(
    tenantId: string,
  ): Promise<WorkerQualityTestDto[]> {
    const results = await this.db
      .select()
      .from(qualityTests)
      .where(eq(qualityTests.tenantId, tenantId))
      .orderBy(desc(qualityTests.createdAt))
      .limit(50);

    return results.map((r) => this.mapWorkerQualityTest(r));
  }

  /**
   * List complaints for a worker (Quality role).
   * Returns redacted DTOs — no financial resolution values.
   */
  async listComplaintsForWorker(
    tenantId: string,
  ): Promise<WorkerComplaintDto[]> {
    const results = await this.db
      .select()
      .from(complaints)
      .where(eq(complaints.tenantId, tenantId))
      .orderBy(desc(complaints.createdAt))
      .limit(50);

    return results.map((r) => this.mapWorkerComplaint(r));
  }

  // -------------------------------------------------------------------------
  // Management queries (full DTOs)
  // -------------------------------------------------------------------------

  /**
   * List quality tests for management (Owner/Accountant).
   * Includes review fields.
   */
  async listQualityTestsForManagement(
    tenantId: string,
  ): Promise<ManagementQualityTestDto[]> {
    const results = await this.db
      .select()
      .from(qualityTests)
      .where(eq(qualityTests.tenantId, tenantId))
      .orderBy(desc(qualityTests.createdAt))
      .limit(100);

    return results.map((r) => this.mapManagementQualityTest(r));
  }

  /**
   * List complaints for management (Owner/Accountant).
   * Includes resolution fields.
   */
  async listComplaintsForManagement(
    tenantId: string,
  ): Promise<ManagementComplaintDto[]> {
    const results = await this.db
      .select()
      .from(complaints)
      .where(eq(complaints.tenantId, tenantId))
      .orderBy(desc(complaints.createdAt))
      .limit(100);

    return results.map((r) => this.mapManagementComplaint(r));
  }

  /**
   * List return requests for management (Owner/Accountant).
   * Includes financial treatment and replacement flag.
   */
  async listReturnRequestsForManagement(
    tenantId: string,
  ): Promise<ManagementReturnRequestDto[]> {
    const results = await this.db
      .select({
        returnReq: returnRequests,
        sale: salesOrders,
        customer: customers,
      })
      .from(returnRequests)
      .innerJoin(salesOrders, eq(returnRequests.salesOrderId, salesOrders.id))
      .innerJoin(customers, eq(salesOrders.customerId, customers.id))
      .where(eq(returnRequests.tenantId, tenantId))
      .orderBy(desc(returnRequests.createdAt))
      .limit(100);

    // For each return, fetch line count + total quantity
    const returnIds = results.map((r) => r.returnReq.id);
    let lineCounts: Map<string, { count: number; totalQty: string }> =
      new Map();
    if (returnIds.length > 0) {
      const lineStats = await this.db
        .select({
          returnRequestId: returnLines.returnRequestId,
          count: drizzleSql<number>`count(*)::int`,
          totalQty: drizzleSql<string>`coalesce(sum(${returnLines.quantityKg}::numeric), 0)::text`,
        })
        .from(returnLines)
        .where(
          and(
            eq(returnLines.tenantId, tenantId),
            // Use inArray via OR conditions
          ),
        )
        .groupBy(returnLines.returnRequestId);

      // Filter to only the return IDs we care about
      lineCounts = new Map(
        lineStats
          .filter((ls) => returnIds.includes(ls.returnRequestId))
          .map((ls) => [
            ls.returnRequestId,
            { count: ls.count, totalQty: ls.totalQty },
          ]),
      );
    }

    return results.map((r) => ({
      id: r.returnReq.id,
      returnNo: r.returnReq.docNo,
      salesOrderId: r.returnReq.salesOrderId,
      saleDocNo: r.sale.docNo,
      customerId: r.customer.id,
      customerName: r.customer.nameAr,
      customerCode: r.customer.customerCode,
      returnDate: r.returnReq.returnDate,
      status: r.returnReq.status,
      returnReason: r.returnReq.returnReason,
      financialTreatment: r.returnReq.financialTreatment,
      isReplacement: r.returnReq.financialTreatment === "replacement",
      totalReturnQuantity:
        lineCounts.get(r.returnReq.id)?.totalQty ?? "0",
      returnLineCount: lineCounts.get(r.returnReq.id)?.count ?? 0,
    }));
  }

  /**
   * List return lines for a specific return request.
   */
  async listReturnLines(
    tenantId: string,
    returnRequestId: string,
  ): Promise<ManagementReturnLineDto[]> {
    const results = await this.db
      .select()
      .from(returnLines)
      .where(
        and(
          eq(returnLines.tenantId, tenantId),
          eq(returnLines.returnRequestId, returnRequestId),
        ),
      )
      .orderBy(desc(returnLines.createdAt));

    return results.map((r) => ({
      id: r.id,
      returnRequestId: r.returnRequestId,
      salesOrderLineId: r.originalSaleLineId,
      returnedQuantity: r.quantityKg,
      returnReason: "", // returnLines has no per-line returnReason; it's on the return request
      stockClassification: r.returnedStockStatus,
    }));
  }

  // -------------------------------------------------------------------------
  // Mappers (redact financial fields for worker DTOs)
  // -------------------------------------------------------------------------

  private mapWorkerQualityTest(
    r: typeof qualityTests.$inferSelect,
  ): WorkerQualityTestDto {
    return {
      id: r.id,
      testNo: r.testNo,
      testDate: r.testDate,
      linkedEntityType: r.linkedEntityType,
      linkedEntityId: r.linkedEntityId,
      saleId: r.saleId,
      customerId: r.customerId,
      testStatus: r.testStatus,
      riskClassification: r.riskClassification,
      testedBy: r.testedBy,
      testedAt: r.testedAt?.toISOString() ?? null,
      notes: r.notes,
      // REDACTED: no prices, costs, profitability (not in this table anyway)
    };
  }

  private mapWorkerComplaint(
    r: typeof complaints.$inferSelect,
  ): WorkerComplaintDto {
    return {
      id: r.id,
      complaintNo: r.complaintNo,
      complaintDate: r.complaintDate,
      customerId: r.customerId,
      saleId: r.saleId,
      subject: r.subject,
      description: r.description,
      status: r.status,
      priority: r.priority,
      investigatedBy: r.investigatedBy,
      investigatedAt: r.investigatedAt?.toISOString() ?? null,
      investigationNotes: r.investigationNotes,
      notes: r.notes,
      // REDACTED: resolutionType visible but no financial amounts
    };
  }

  private mapManagementQualityTest(
    r: typeof qualityTests.$inferSelect,
  ): ManagementQualityTestDto {
    return {
      ...this.mapWorkerQualityTest(r),
      reviewedBy: r.reviewedBy,
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      reviewNotes: r.reviewNotes,
    };
  }

  private mapManagementComplaint(
    r: typeof complaints.$inferSelect,
  ): ManagementComplaintDto {
    return {
      ...this.mapWorkerComplaint(r),
      resolvedBy: r.resolvedBy,
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      resolutionNotes: r.resolutionNotes,
      resolutionType: r.resolutionType,
    };
  }
}
