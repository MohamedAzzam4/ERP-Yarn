/**
 * Production/WIP-specific PostgreSQL enums.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §6
 * Contract: docs/contracts/05_production_wip_contract.md §8
 */
import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Production type. Contract 03 §6 + Contract 05 §7.
 * raw material → single_yarn, single_yarn → twisted_yarn.
 */
export const productionType = pgEnum("production_type", [
  "single_yarn",
  "twisted_yarn",
]);

/**
 * Production status. Contract 03 §6 + Contract 05 §8.
 *
 * States: draft, material_issued, partially_received, completed,
 * correction_requested, cancelled, reversed.
 */
export const productionStatus = pgEnum("production_status", [
  "draft",
  "material_issued",
  "partially_received",
  "completed",
  "correction_requested",
  "cancelled",
  "reversed",
]);

/**
 * Historical cost basis source. Contract 03 §6 + Contract 05 §21.
 * Used for imported historical production cost preservation.
 */
export const historicalCostBasisSource = pgEnum("historical_cost_basis_source", [
  "imported_excel",
  "input_based",
  "output_based",
  "manual",
  "unknown",
]);

/**
 * WIP return status. Contract 05 §20.
 * A WIP return request goes through draft → pending_approval → approved/rejected.
 */
export const wipReturnStatus = pgEnum("wip_return_status", [
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "cancelled",
]);
