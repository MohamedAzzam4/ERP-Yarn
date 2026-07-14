/**
 * Quality tests, quality test values, and complaints.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §13
 *   "quality_tests, quality_test_values, and complaints reference
 *    item/batch/lot/customer/sale as applicable and store dates, statuses,
 *    values, investigation and actors. Index item/date/status and
 *    customer/sale/open complaint. Referenced quality parameters cannot
 *    be hard-deleted."
 *
 * Contract: docs/contracts/04_inventory_posting_contract.md §11
 *   Quality status: accepted, needs_review, blocked.
 *   Worker quality input does not authorize discount or risky sale.
 *
 * DEC-065: MVP sale reservation supports ONLY accepted/sellable stock.
 *   needs_review, blocked, discounted-return or other quality-risk stock
 *   must go through review/disposition before reservation.
 *
 * WP-06-01 SCOPE:
 *   - quality_tests: record test facts (item/batch/lot, date, status, tester, notes)
 *   - quality_test_values: measured values per quality parameter
 *   - Quality status transitions: accepted → needs_review → blocked (and back via review)
 *   - Complaints table (schema only — WP-06-02 implements the workflow)
 */
import {
  text, uuid, numeric, date, timestamp, boolean,
  pgTable, uniqueIndex, index, check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenantIdColumn, makeTenantOwnedRow } from "./_helpers";
import { users } from "./users";
import { inventoryItems } from "./inventory-items";
import { rawMaterialBatches } from "./inventory-items";
import { yarnLots } from "./inventory-items";
import { salesOrders } from "./sales";
import { customers } from "./master-data";
import { qualityStatus } from "./inventory-enums";
import { recordOrigin, recordPeriod } from "./enums";

const usersId = users.id!;

// ---------------------------------------------------------------------------
// quality_tests
// ---------------------------------------------------------------------------

/**
 * Quality test recording.
 *
 * Contract 03 §13: "quality_tests reference item/batch/lot/customer/sale as
 * applicable and store dates, statuses, values, investigation and actors."
 *
 * A quality test records FACTS about a quality measurement. It does NOT
 * authorize discount, risky sale, or stock movement (Contract 04 §11).
 *
 * The test's `testStatus` field records the outcome: accepted, needs_review,
 * blocked. This is a FACT, not an authorization. The item's `qualityStatus`
 * (on inventory_items/yarn_lots) is the authoritative status that gates
 * reservation per DEC-065.
 */
export const qualityTests = pgTable("quality_tests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantIdColumn(),
  testNo: text("test_no").notNull(),
  testDate: date("test_date").notNull(),
  // Linked entity (one of item/batch/lot)
  linkedEntityType: text("linked_entity_type").notNull(), // inventory_item | raw_material_batch | yarn_lot
  linkedEntityId: uuid("linked_entity_id").notNull(),
  // Optional sale/customer reference (for quality tests on sold stock)
  saleId: uuid("sale_id").references(() => salesOrders.id),
  customerId: uuid("customer_id").references(() => customers.id),
  // Test outcome (FACT, not authorization)
  testStatus: qualityStatus("test_status").notNull().default("needs_review"),
  // Risk/review classification (Contract 04 §11)
  // sellable_with_discount is a REVIEW FLAG only — does not authorize discount sale
  riskClassification: text("risk_classification").notNull().default("none"), // none | needs_review | sellable_with_discount | blocked | reprocess_required
  // Tester info
  testedBy: uuid("tested_by").references(() => users.id),
  testedAt: timestamp("tested_at", { withTimezone: true, mode: "date" }),
  // Review info (if test was reviewed by management/quality lead)
  reviewedBy: uuid("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "date" }),
  reviewNotes: text("review_notes"),
  // General notes
  notes: text("notes"),
  ...makeTenantOwnedRow(usersId),
}, (t) => [
  uniqueIndex("quality_tests_tenant_test_no_unique_idx").on(t.tenantId, t.testNo),
  index("quality_tests_tenant_linked_idx").on(t.tenantId, t.linkedEntityType, t.linkedEntityId),
  index("quality_tests_tenant_date_idx").on(t.tenantId, t.testDate),
  index("quality_tests_tenant_status_idx").on(t.tenantId, t.testStatus),
  index("quality_tests_tenant_sale_idx").on(t.tenantId, t.saleId),
  index("quality_tests_tenant_customer_idx").on(t.tenantId, t.customerId),
]);

export type QualityTest = typeof qualityTests.$inferSelect;
export type NewQualityTest = typeof qualityTests.$inferInsert;

// ---------------------------------------------------------------------------
// quality_test_values
// ---------------------------------------------------------------------------

/**
 * Measured values per quality parameter.
 *
 * Contract 03 §13: "quality_test_values store values."
 * Each row links a quality test to a quality parameter with the measured value.
 */
export const qualityTestValues = pgTable("quality_test_values", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantIdColumn(),
  qualityTestId: uuid("quality_test_id").notNull().references(() => qualityTests.id),
  // Quality parameter reference (master data from WP-02-01)
  parameterName: text("parameter_name").notNull(),
  parameterCode: text("parameter_code").notNull(),
  // Measured value (nullable — may be unknown)
  measuredValue: text("measured_value"),
  // Pass/fail status for this parameter
  valueStatus: text("value_status").notNull().default("pending"), // pending | pass | fail | review
  notes: text("notes"),
  ...makeTenantOwnedRow(usersId),
}, (t) => [
  index("quality_test_values_tenant_test_idx").on(t.tenantId, t.qualityTestId),
  index("quality_test_values_tenant_parameter_idx").on(t.tenantId, t.parameterCode),
  check("quality_test_values_status_check",
    sql`value_status IN ('pending', 'pass', 'fail', 'review')`),
]);

export type QualityTestValue = typeof qualityTestValues.$inferSelect;
export type NewQualityTestValue = typeof qualityTestValues.$inferInsert;

// ---------------------------------------------------------------------------
// quality_holds
// ---------------------------------------------------------------------------

/**
 * Quality holds — durable restrictive state created when a quality test
 * records `blocked` or `needs_review` status.
 *
 * Contract 04 §11: "Blocked/review stock cannot ordinary-sell."
 * DEC-065: Sale reservation/submission is allowed only for accepted/sellable
 * stock. needs_review, blocked, or other quality-risk stock must go through
 * review/disposition before reservation.
 *
 * A quality hold is a DURABLE record that the SalesSubmissionService checks
 * before reservation. It is separate from the item's master-data qualityStatus
 * to preserve the separation of facts (quality test) from authoritative
 * availability gating (hold + item qualityStatus).
 *
 * Lifecycle:
 *   - Created automatically when a quality test records blocked/needs_review
 *   - Cleared only by Owner/Accountant management disposition
 *     (quality_risk_sales.approve permission)
 *   - Quality workers CANNOT clear holds or authorize risky sale
 *
 * Permission model:
 *   - quality_tests.create: can create tests that create holds (restrictive)
 *   - quality_risk_sales.approve: Owner/Accountant only — can clear holds
 *   - A cleared hold remains in the table with status='cleared' for audit trail
 */
export const qualityHolds = pgTable("quality_holds", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantIdColumn(),
  // The quality test that triggered this hold
  qualityTestId: uuid("quality_test_id").notNull().references(() => qualityTests.id),
  // The linked entity (item/batch/lot) under hold
  linkedEntityType: text("linked_entity_type").notNull(),
  linkedEntityId: uuid("linked_entity_id").notNull(),
  // Hold reason (from the quality test's risk classification)
  holdReason: text("hold_reason").notNull(), // needs_review | blocked | reprocess_required
  // Hold status: active (restricting) or cleared (by management disposition)
  holdStatus: text("hold_status").notNull().default("active"), // active | cleared
  // Clearance info (if cleared by management)
  clearedBy: uuid("cleared_by").references(() => users.id),
  clearedAt: timestamp("cleared_at", { withTimezone: true, mode: "date" }),
  clearanceReason: text("clearance_reason"),
  notes: text("notes"),
  ...makeTenantOwnedRow(usersId),
}, (t) => [
  index("quality_holds_tenant_entity_idx").on(t.tenantId, t.linkedEntityType, t.linkedEntityId),
  index("quality_holds_tenant_test_idx").on(t.tenantId, t.qualityTestId),
  index("quality_holds_tenant_status_idx").on(t.tenantId, t.holdStatus),
  check("quality_holds_reason_check",
    sql`hold_reason IN ('needs_review', 'blocked', 'reprocess_required')`),
  check("quality_holds_status_check",
    sql`hold_status IN ('active', 'cleared')`),
]);

export type QualityHold = typeof qualityHolds.$inferSelect;
export type NewQualityHold = typeof qualityHolds.$inferInsert;
