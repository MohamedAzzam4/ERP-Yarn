/**
 * Return Request Repository — WP-06-03.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §11.3
 *   return_requests + return_lines tables.
 *
 * Contract: docs/contracts/07_subledger_and_costs_contract.md §10.1
 *   Customer return credit = negative customer entry.
 *
 * Contract: docs/contracts/13_work_packages.md WP-06-03
 *   "Atomically receive approved return, classify stock and post selected
 *    credit treatment."
 */
import "server-only";

import type { ReturnRequest, ReturnLine } from "@/server/db/schema/returns";

// ---------------------------------------------------------------------------
// Input types.
// ---------------------------------------------------------------------------

export interface NewReturnRequestInput {
  tenantId: string;
  docNo: string;
  salesOrderId: string;
  customerId: string;
  returnDate: string;
  returnReason: string;
  financialTreatment?: string | null;
  customerAdjustmentAmount?: string | null;
  isReplacement: boolean;
  createdBy: string;
}

export interface NewReturnLineInput {
  tenantId: string;
  returnRequestId: string;
  originalSaleOrderId: string;
  originalSaleLineId: string;
  itemId: string;
  quantityKg: string;
  returnLocationId: string;
  returnedStockStatus: string;
  qualityStatusAfterReturn?: string | null;
  originalSaleLineNetUnitValue?: string | null;
  returnCreditValue?: string | null;
  residualAdjustment?: string;
  cumulativePriorReturnQty?: string;
  cumulativePriorReturnCredit?: string;
  returnMovementId?: string | null;
  createdBy: string;
}

export interface UpdateReturnRequestStatusInput {
  status: string;
  approvalStatus: string;
  financialTreatment?: string | null;
  customerAdjustmentAmount?: string | null;
  approvedBy?: string | null;
  approvedAt?: Date | null;
  isLocked?: boolean;
  updatedBy: string;
}

// ---------------------------------------------------------------------------
// Repository interface.
// ---------------------------------------------------------------------------

export interface ReturnRequestRepository {
  insertReturnRequest(row: NewReturnRequestInput): Promise<ReturnRequest>;
  findReturnRequestById(tenantId: string, returnRequestId: string): Promise<ReturnRequest | null>;
  findReturnRequestByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<ReturnRequest | null>;
  updateReturnRequestStatus(
    tenantId: string,
    returnRequestId: string,
    patch: UpdateReturnRequestStatusInput,
    expectedCurrentStatuses: string[],
  ): Promise<ReturnRequest | null>;
  listReturnRequestsForSale(tenantId: string, salesOrderId: string): Promise<ReturnRequest[]>;
  listReturnRequestsForCustomer(tenantId: string, customerId: string): Promise<ReturnRequest[]>;

  insertReturnLine(row: NewReturnLineInput): Promise<ReturnLine>;
  findReturnLines(tenantId: string, returnRequestId: string): Promise<ReturnLine[]>;
  updateReturnLineMovement(tenantId: string, returnLineId: string, returnMovementId: string): Promise<ReturnLine | null>;

  /**
   * List approved return lines for a specific original sale line.
   * Used to compute cumulative prior returns for DEC-068 cap enforcement.
   */
  listApprovedReturnLinesForSaleLine(tenantId: string, originalSaleLineId: string): Promise<ReturnLine[]>;

  lockReturnRequest(tenantId: string, returnRequestId: string): Promise<void>;

  recordIdempotencyKey?(tenantId: string, idempotencyKey: string, returnRequestId: string): void;
}

export type { ReturnRequest, ReturnLine } from "@/server/db/schema/returns";
