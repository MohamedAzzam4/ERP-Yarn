/**
 * Complaint Repository — WP-06-02.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §13
 *   complaints reference item/batch/lot/customer/sale and store dates,
 *   statuses, investigation and actors.
 *
 * Contract: docs/contracts/13_work_packages.md WP-06-02
 *   "Complaint alone posts no stock/account effect."
 *   "No automatic return/credit."
 *
 * This is the persistence boundary for complaints.
 */
import "server-only";

import type { Complaint } from "@/server/db/schema/quality";

// ---------------------------------------------------------------------------
// Input types.
// ---------------------------------------------------------------------------

export type ComplaintStatus = "open" | "investigating" | "resolved" | "closed";
export type ComplaintPriority = "low" | "normal" | "high" | "urgent";

export interface NewComplaintInput {
  tenantId: string;
  complaintNo: string;
  complaintDate: string;
  customerId?: string | null;
  saleId?: string | null;
  saleLineId?: string | null;
  itemId?: string | null;
  qualityTestId?: string | null;
  rawMaterialBatchId?: string | null;
  yarnLotId?: string | null;
  subject: string;
  description?: string | null;
  status: ComplaintStatus;
  priority: ComplaintPriority;
  notes?: string | null;
  createdBy: string;
}

export interface UpdateComplaintInput {
  status?: ComplaintStatus;
  priority?: ComplaintPriority;
  investigatedBy?: string | null;
  investigatedAt?: Date | null;
  investigationNotes?: string | null;
  resolvedBy?: string | null;
  resolvedAt?: Date | null;
  resolutionNotes?: string | null;
  resolutionType?: string | null;
  notes?: string | null;
  updatedBy: string;
}

// ---------------------------------------------------------------------------
// Repository interface.
// ---------------------------------------------------------------------------

export interface ComplaintRepository {
  /** Insert a new complaint row. */
  insertComplaint(row: NewComplaintInput): Promise<Complaint>;

  /** Find a complaint by id. */
  findComplaintById(tenantId: string, complaintId: string): Promise<Complaint | null>;

  /** Find a complaint by idempotency key. */
  findComplaintByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<Complaint | null>;

  /** Update a complaint (investigation/status/resolution). */
  updateComplaint(
    tenantId: string,
    complaintId: string,
    patch: UpdateComplaintInput,
  ): Promise<Complaint | null>;

  /** List open complaints (status = open or investigating). */
  listOpenComplaints(tenantId: string): Promise<Complaint[]>;

  /** List complaints for a customer. */
  listComplaintsForCustomer(tenantId: string, customerId: string): Promise<Complaint[]>;

  /** List complaints for a sale. */
  listComplaintsForSale(tenantId: string, saleId: string): Promise<Complaint[]>;

  /** List complaints for an item. */
  listComplaintsForItem(tenantId: string, itemId: string): Promise<Complaint[]>;

  /** List complaints linked to a quality test. */
  listComplaintsForQualityTest(tenantId: string, qualityTestId: string): Promise<Complaint[]>;

  /** List all complaints for a tenant (with optional status filter). */
  listComplaints(tenantId: string, status?: ComplaintStatus | null): Promise<Complaint[]>;

  /**
   * Test helper: associate idempotency key with a complaint ID.
   * Optional — in-memory repos implement this; DB repos use the idempotency_records table.
   */
  recordIdempotencyKey?(tenantId: string, idempotencyKey: string, complaintId: string): void;
}

// ---------------------------------------------------------------------------
// Re-export domain types.
// ---------------------------------------------------------------------------

export type { Complaint } from "@/server/db/schema/quality";
