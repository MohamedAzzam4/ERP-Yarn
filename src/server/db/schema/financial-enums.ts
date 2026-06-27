/**
 * Sales, returns, subledger, and cost enums.
 * Contract 03 §6 + Contract 07.
 */
import { pgEnum } from "drizzle-orm/pg-core";

export const saleStatus = pgEnum("sale_status", [
  "draft", "pending_approval", "needs_review", "approval_failed",
  "approved", "rejected", "cancelled", "reversed",
  "partially_returned", "fully_returned",
]);

export const returnStatus = pgEnum("return_status", [
  "draft", "pending_approval", "approved", "rejected", "cancelled", "reversed",
]);

export const returnFinancialTreatment = pgEnum("return_financial_treatment", [
  "no_financial_impact", "customer_credit", "refund_due", "replacement",
]);

export const paymentStatus = pgEnum("payment_status", [
  "draft", "posted", "reversed", "cancelled",
]);

export const paymentDirection = pgEnum("payment_direction", [
  "received_from_party", "paid_to_party",
]);

// DEC-066: MVP payment methods — fixed list, no invention
export const paymentMethod = pgEnum("payment_method", [
  "cash", "bank_transfer", "check", "wallet_instapay", "other",
]);

export const settlementStatus = pgEnum("settlement_status", [
  "unsettled", "partially_settled", "settled", "reversed",
]);

export const accountOwnerType = pgEnum("account_owner_type", [
  "customer", "supplier", "factory",
]);

export const accountEntryType = pgEnum("account_entry_type", [
  "customer_sale_receivable", "customer_return_credit",
  "supplier_raw_payable", "factory_production_payable",
  "customer_payment", "supplier_payment", "factory_payment",
  "customer_direct_cost_receivable", "factory_direct_cost_recovery",
  "historical_opening_balance", "reversal",
]);

export const directCostType = pgEnum("direct_cost_type", [
  "transport", "loading", "unloading", "customs", "other",
]);

export const costResponsibilityType = pgEnum("cost_responsibility_type", [
  "company", "customer", "factory", "shared", "other",
  "unknown", "included_elsewhere", "needs_accountant_review",
]);

export const actualPayerType = pgEnum("actual_payer_type", [
  "company", "customer", "factory", "other", "unknown", "not_recorded",
]);

export const reviewStatus = pgEnum("review_status", [
  "not_required", "needs_accountant_review", "reviewed", "approved", "rejected",
]);

export const snapshotActiveState = pgEnum("snapshot_active_state", [
  "active", "superseded",
]);
