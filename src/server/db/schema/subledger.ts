/**
 * Operational subledger: accounts, account_entries, payments,
 * payment_settlements, direct_costs, direct_cost_allocations,
 * raw_purchase_price_confirmations.
 *
 * Contract 03 §12 + Contract 07.
 */
import {
  text, uuid, numeric, date, timestamp, boolean, integer,
  pgTable, uniqueIndex, index, check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { tenantIdColumn, makeTenantOwnedRow } from "./_helpers";
import { users } from "./users";
import { customers } from "./master-data";
import { suppliers } from "./master-data";
import { externalFactories } from "./master-data";
import { rawMaterialBatches } from "./inventory-items";
import { productionReceipts } from "./production-receipts";
import { stockMovements } from "./inventory-ledger";
import { approvalRequests } from "./approval-requests";
import {
  accountOwnerType, accountEntryType, settlementStatus,
  paymentStatus, paymentDirection, paymentMethod,
  directCostType, costResponsibilityType, actualPayerType, reviewStatus,
} from "./financial-enums";
import { recordOrigin, recordPeriod, approvalStatus } from "./enums";

const usersId = users.id!;

// ---------------------------------------------------------------------------
// accounts
// ---------------------------------------------------------------------------

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantIdColumn(),
  ownerType: accountOwnerType("owner_type").notNull(),
  ownerId: uuid("owner_id").notNull(),
  currency: text("currency").notNull().default("EGP"),
  status: text("status").notNull().default("active"),
  ...makeTenantOwnedRow(usersId),
}, (t) => [
  uniqueIndex("accounts_tenant_owner_type_owner_currency_unique_idx")
    .on(t.tenantId, t.ownerType, t.ownerId, t.currency),
  index("accounts_tenant_owner_idx").on(t.tenantId, t.ownerType, t.ownerId),
]);

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;

// ---------------------------------------------------------------------------
// account_entries
// ---------------------------------------------------------------------------

export const accountEntries = pgTable("account_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantIdColumn(),
  accountId: uuid("account_id").notNull().references(() => accounts.id),
  entryNo: text("entry_no").notNull(),
  entryDate: date("entry_date").notNull(),
  amountSigned: numeric("amount_signed", { precision: 18, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("EGP"),
  entryType: accountEntryType("entry_type").notNull(),
  sourceDocumentType: text("source_document_type").notNull(),
  sourceDocumentId: uuid("source_document_id").notNull(),
  settlementStatus: settlementStatus("settlement_status").notNull().default("unsettled"),
  reversalOfEntryId: uuid("reversal_of_entry_id"),
  notes: text("notes"),
  recordOrigin: recordOrigin("record_origin").notNull().default("manual_live"),
  recordPeriod: recordPeriod("record_period").notNull().default("live"),
  importBatchId: uuid("import_batch_id"),
  // Append-only: only created_at, no updated_at/deleted_at
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  createdBy: uuid("created_by").references(() => users.id),
}, (t) => [
  uniqueIndex("account_entries_tenant_entry_no_unique_idx").on(t.tenantId, t.entryNo),
  index("account_entries_tenant_account_date_idx").on(t.tenantId, t.accountId, t.entryDate),
  index("account_entries_tenant_source_idx").on(t.tenantId, t.sourceDocumentType, t.sourceDocumentId),
  index("account_entries_tenant_settlement_idx").on(t.tenantId, t.settlementStatus),
  index("account_entries_tenant_reversal_idx").on(t.tenantId, t.reversalOfEntryId),
  index("account_entries_tenant_import_idx").on(t.tenantId, t.importBatchId),
  // Non-zero signed amount
  check("account_entries_amount_nonzero_check", sql`amount_signed <> 0`),
]);

export type AccountEntry = typeof accountEntries.$inferSelect;
export type NewAccountEntry = typeof accountEntries.$inferInsert;

// ---------------------------------------------------------------------------
// payments
// ---------------------------------------------------------------------------

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantIdColumn(),
  paymentNo: text("payment_no").notNull(),
  paymentDate: date("payment_date").notNull(),
  accountId: uuid("account_id").notNull().references(() => accounts.id),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  paymentDirection: paymentDirection("payment_direction").notNull(),
  paymentMethod: paymentMethod("payment_method").notNull(),
  status: paymentStatus("status").notNull().default("draft"),
  notes: text("notes"),
  attachmentFileId: uuid("attachment_file_id"),
  postedEntryId: uuid("posted_entry_id").references(() => accountEntries.id),
  reversalOfPaymentId: uuid("reversal_of_payment_id"),
  idempotencyKey: text("idempotency_key").notNull(),
  approvalRequestId: uuid("approval_request_id").references(() => approvalRequests.id),
  recordOrigin: recordOrigin("record_origin").notNull().default("manual_live"),
  recordPeriod: recordPeriod("record_period").notNull().default("live"),
  isLocked: boolean("is_locked").notNull().default(false),
  importBatchId: uuid("import_batch_id"),
  ...makeTenantOwnedRow(usersId),
}, (t) => [
  uniqueIndex("payments_tenant_payment_no_unique_idx").on(t.tenantId, t.paymentNo),
  uniqueIndex("payments_tenant_idempotency_unique_idx").on(t.tenantId, t.idempotencyKey),
  index("payments_tenant_account_idx").on(t.tenantId, t.accountId),
  index("payments_tenant_date_idx").on(t.tenantId, t.paymentDate),
  index("payments_tenant_status_idx").on(t.tenantId, t.status),
  index("payments_tenant_method_idx").on(t.tenantId, t.paymentMethod),
  check("payments_amount_check", sql`amount > 0`),
]);

export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;

// ---------------------------------------------------------------------------
// payment_settlements
// ---------------------------------------------------------------------------

export const paymentSettlements = pgTable("payment_settlements", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantIdColumn(),
  paymentEntryId: uuid("payment_entry_id").notNull().references(() => accountEntries.id),
  settledEntryId: uuid("settled_entry_id").notNull().references(() => accountEntries.id),
  settledAmount: numeric("settled_amount", { precision: 18, scale: 2 }).notNull(),
  settlementStatus: settlementStatus("settlement_status").notNull().default("settled"),
  ...makeTenantOwnedRow(usersId),
}, (t) => [
  index("payment_settlements_tenant_payment_entry_idx").on(t.tenantId, t.paymentEntryId),
  index("payment_settlements_tenant_settled_entry_idx").on(t.tenantId, t.settledEntryId),
  index("payment_settlements_tenant_status_idx").on(t.tenantId, t.settlementStatus),
  check("payment_settlements_amount_check", sql`settled_amount > 0`),
]);

export type PaymentSettlement = typeof paymentSettlements.$inferSelect;
export type NewPaymentSettlement = typeof paymentSettlements.$inferInsert;

// ---------------------------------------------------------------------------
// direct_costs
// ---------------------------------------------------------------------------

export const directCosts = pgTable("direct_costs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantIdColumn(),
  costNo: text("cost_no").notNull(),
  costType: directCostType("cost_type").notNull(),
  linkedEntityType: text("linked_entity_type").notNull(),
  linkedEntityId: uuid("linked_entity_id").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }),
  currency: text("currency").notNull().default("EGP"),
  costResponsibilityType: costResponsibilityType("cost_responsibility_type").notNull(),
  actualPayerType: actualPayerType("actual_payer_type").notNull(),
  includedInProfitability: boolean("included_in_profitability").notNull().default(false),
  reviewStatus: reviewStatus("review_status").notNull().default("needs_accountant_review"),
  notes: text("notes"),
  reviewedBy: uuid("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "date" }),
  ...makeTenantOwnedRow(usersId),
}, (t) => [
  uniqueIndex("direct_costs_tenant_cost_no_unique_idx").on(t.tenantId, t.costNo),
  index("direct_costs_tenant_linked_idx").on(t.tenantId, t.linkedEntityType, t.linkedEntityId),
  index("direct_costs_tenant_review_idx").on(t.tenantId, t.reviewStatus),
  check("direct_costs_amount_check", sql`amount IS NULL OR amount >= 0`),
]);

export type DirectCost = typeof directCosts.$inferSelect;
export type NewDirectCost = typeof directCosts.$inferInsert;

// ---------------------------------------------------------------------------
// direct_cost_allocations
// ---------------------------------------------------------------------------

export const directCostAllocations = pgTable("direct_cost_allocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantIdColumn(),
  directCostId: uuid("direct_cost_id").notNull().references(() => directCosts.id),
  responsiblePartyType: text("responsible_party_type").notNull(),
  responsiblePartyId: uuid("responsible_party_id"),
  shareAmount: numeric("share_amount", { precision: 18, scale: 2 }).notNull(),
  sharePercent: numeric("share_percent", { precision: 18, scale: 12 }),
  subledgerEntryId: uuid("subledger_entry_id").references(() => accountEntries.id),
  ...makeTenantOwnedRow(usersId),
}, (t) => [
  index("direct_cost_allocations_tenant_cost_idx").on(t.tenantId, t.directCostId),
  index("direct_cost_allocations_tenant_party_idx").on(t.tenantId, t.responsiblePartyType, t.responsiblePartyId),
  check("direct_cost_allocations_share_check", sql`share_amount >= 0`),
  check("direct_cost_allocations_percent_check",
    sql`share_percent IS NULL OR (share_percent >= 0 AND share_percent <= 100)`),
]);

export type DirectCostAllocation = typeof directCostAllocations.$inferSelect;
export type NewDirectCostAllocation = typeof directCostAllocations.$inferInsert;

// ---------------------------------------------------------------------------
// raw_purchase_price_confirmations
// ---------------------------------------------------------------------------

/**
 * Contract 03 §9.3.1 + Contract 07 §11.
 * DEC-067: Raw purchase payable uses net accepted weight as tonnage basis.
 * Append-only controlled completion for an approved physical receipt whose
 * price was unknown.
 */
export const rawPurchasePriceConfirmations = pgTable("raw_purchase_price_confirmations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantIdColumn(),
  docNo: text("doc_no").notNull(),
  rawMaterialBatchId: uuid("raw_material_batch_id").notNull().references(() => rawMaterialBatches.id),
  confirmedPricePerTon: numeric("confirmed_price_per_ton", { precision: 18, scale: 2 }).notNull(),
  // DEC-067: basis is net accepted kg
  quantityBasis: text("quantity_basis").notNull().default("net_accepted_kg"),
  quantityBasisKg: numeric("quantity_basis_kg", { precision: 18, scale: 3 }).notNull(),
  preciseCalculatedAmount: numeric("precise_calculated_amount", { precision: 24, scale: 8 }),
  postedPayableAmount: numeric("posted_payable_amount", { precision: 18, scale: 2 }),
  currency: text("currency").notNull().default("EGP"),
  // Subject version/hash for approval binding
  subjectVersion: integer("subject_version").notNull().default(1),
  subjectHash: text("subject_hash").notNull(),
  approvalRequestId: uuid("approval_request_id").references(() => approvalRequests.id),
  accountEntryId: uuid("account_entry_id").references(() => accountEntries.id),
  idempotencyKey: text("idempotency_key").notNull(),
  confirmedBy: uuid("confirmed_by").references(() => users.id),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  reason: text("reason"),
  reversalOfId: uuid("reversal_of_id"),
  isLocked: boolean("is_locked").notNull().default(false),
  // Append-only: only created_at
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  createdBy: uuid("created_by").references(() => users.id),
}, (t) => [
  uniqueIndex("raw_price_confirmations_tenant_doc_no_unique_idx").on(t.tenantId, t.docNo),
  uniqueIndex("raw_price_confirmations_tenant_idempotency_unique_idx").on(t.tenantId, t.idempotencyKey),
  index("raw_price_confirmations_tenant_batch_idx").on(t.tenantId, t.rawMaterialBatchId),
  index("raw_price_confirmations_tenant_reversal_idx").on(t.tenantId, t.reversalOfId),
  check("raw_price_confirmations_price_check", sql`confirmed_price_per_ton >= 0`),
  check("raw_price_confirmations_qty_check", sql`quantity_basis_kg > 0`),
  check("raw_price_confirmations_payable_check",
    sql`posted_payable_amount IS NULL OR posted_payable_amount >= 0`),
  check("raw_price_confirmations_subject_version_check", sql`subject_version >= 1`),
]);
