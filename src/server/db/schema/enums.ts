/**
 * Shared PostgreSQL enums for the platform/security foundation.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §6
 * "Core Status and Classification Values" — implement as PostgreSQL enums
 * or check constraints.
 *
 * WP-00-03A scope: only the enums consumed by platform/security tables
 * are defined here. Domain-specific enums (item_kind, movement_type,
 * production_status, sale_status, return_status, payment_status,
 * account_entry_type, import_batch_status, etc.) land in their consuming
 * packages (WP-00-03B–E).
 *
 * Enum values are the authoritative strings from Contract 03 §6. Do not
 * add, remove, or rename values without a contract update.
 */
import { pgEnum } from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Platform/security enums (consumed by WP-00-03A tables).
// ---------------------------------------------------------------------------

/**
 * MVP role codes. Contract 03 §6 + Permission Matrix §5.
 *
 * DEC-061: MVP users normally have one active operational role. Schema
 * supports multiple assignments but seeds/UI use one per user.
 */
export const roleCode = pgEnum("role_code", [
  "owner",
  "accountant",
  "warehouse_employee",
  "production_employee",
  "quality_employee",
]);

/**
 * Approval status values for approval_requests and approved business
 * documents. Contract 03 §6.
 *
 * NOTE: `approval_failed` and `needs_review` are sale-status values, not
 * generic approval_status values. Approval_requests use only the values
 * below.
 */
export const approvalStatus = pgEnum("approval_status", [
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "cancelled",
  "reversed",
]);

/**
 * Record origin. Contract 03 §6.
 */
export const recordOrigin = pgEnum("record_origin", [
  "manual_live",
  "excel_import",
  "ai_assisted_import",
  "manual_historical_entry",
  "system_generated",
]);

/**
 * Record period. Contract 03 §6.
 */
export const recordPeriod = pgEnum("record_period", ["live", "historical"]);

/**
 * Approval request risk level. Internal classification used by the
 * ApprovalService to route approvals to the correct authority.
 *
 * The contract does not enumerate exact risk_level strings; this is the
 * minimal safe set required for the platform foundation. Values may be
 * refined by Contract 06 packages if needed.
 */
export const approvalRiskLevel = pgEnum("approval_risk_level", [
  "standard",
  "high",
  "critical",
]);

/**
 * Approval request state. Contract 03 §7.6: "Allow only one active pending
 * request per entity/request scope." This enum tracks the request's own
 * lifecycle distinct from the entity's `approval_status`.
 */
export const approvalRequestState = pgEnum("approval_request_state", [
  "active",
  "decided",
  "invalidated",
  "superseded",
]);

/**
 * Idempotency record state. Contract 03 §7.8: `in_progress`, `succeeded`,
 * `business_failed`, `retryable_failed`.
 */
export const idempotencyState = pgEnum("idempotency_state", [
  "in_progress",
  "succeeded",
  "business_failed",
  "retryable_failed",
]);

/**
 * Operational alert severity. Contract 03 §7.9.
 */
export const alertSeverity = pgEnum("alert_severity", [
  "info",
  "warning",
  "critical",
]);

/**
 * Operational alert state. Contract 03 §7.9: "Resolution is explicit and
 * audited; alerts are not silently deleted."
 */
export const alertState = pgEnum("alert_state", [
  "open",
  "acknowledged",
  "resolved",
]);

/**
 * Tenant setting level. Contract 03 §7.3: `safe_ui`, `restricted_setup`,
 * `deferred_productization`.
 */
export const tenantSettingLevel = pgEnum("tenant_setting_level", [
  "safe_ui",
  "restricted_setup",
  "deferred_productization",
]);

/**
 * Worker scope dimension. Contract 03 §7.2 + DEC-062: scope types are
 * assigned locations, external factories, and/or task types.
 *
 * `task_type` is a placeholder string key (not an FK) per Contract 03 §7.2
 * "target identifier/key". Domain packages attach tenant-safe references
 * when their target entities exist.
 */
export const workerScopeType = pgEnum("worker_scope_type", [
  "location",
  "external_factory",
  "task_type",
]);

/**
 * User status.
 */
export const userStatus = pgEnum("user_status", ["active", "inactive"]);

/**
 * Tenant status.
 */
export const tenantStatus = pgEnum("tenant_status", ["active", "inactive"]);

/**
 * Role system flag. Contract 03 v4 §10.3 `roles.is_system_role`.
 * System roles cannot be deleted or have their role_code changed.
 */
export const roleSystemFlag = pgEnum("role_system_flag", [
  "system",
  "custom",
]);
