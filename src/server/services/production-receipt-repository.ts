/**
 * Production Receipt Repository — WP-04-02.
 *
 * Repository interface for production_receipts + production_receipt_input_allocations.
 * WP-04-02 scope: draft creation + allocation validation only. No posting.
 */
import "server-only";

import type { ProductionReceipt, ProductionReceiptInputAllocation } from "@/server/db/schema/production-receipts";

export interface NewReceiptDraftInput {
  tenantId: string;
  docNo: string;
  productionOrderId: string;
  outputItemId: string;
  outputLotId: string | null;
  outputLocationId: string;
  outputQtyKg: string;
  receiptDate: string;
  notes: string | null;
  createdBy: string;
  // Rate/basis snapshot (confirmed by Accountant/Owner, stored as draft facts)
  factoryRatePerInputTonUsed: string | null;
  factoryCostBasisUsed: string;
  // Subject hash for invalidation detection
  subjectHash: string;
  subjectVersion: number;
  idempotencyKey: string;
}

export interface NewAllocationInput {
  tenantId: string;
  productionReceiptId: string;
  productionInputId: string;
  consumedTowardOutputQtyKg: string;
  allocatedWasteQtyKg: string;
}

export interface ProductionReceiptRepository {
  insertReceipt(row: NewReceiptDraftInput): Promise<ProductionReceipt>;
  insertAllocation(row: NewAllocationInput): Promise<ProductionReceiptInputAllocation>;
  findReceiptById(tenantId: string, id: string): Promise<ProductionReceipt | null>;
  findAllocationsByReceipt(tenantId: string, receiptId: string): Promise<ProductionReceiptInputAllocation[]>;
  findReceiptsByOrder(tenantId: string, orderId: string): Promise<ProductionReceipt[]>;
  findAllocationsByInput(tenantId: string, productionInputId: string): Promise<ProductionReceiptInputAllocation[]>;
}
