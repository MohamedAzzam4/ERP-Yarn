/**
 * Drizzle schema barrel for ERP-Yarn.
 *
 * WP-00-03A scope: platform/security foundation only. Domain schemas
 * (inventory, production, sales/returns, payments, migration) land in
 * WP-00-03B–E and will be added to this barrel by those packages.
 *
 * Contract: docs/contracts/03_database_schema_contract.md
 * Contract: docs/contracts/13_work_packages.md WP-00-03A
 */

// Platform tables
export { tenants } from "./tenants";
export type { Tenant, NewTenant } from "./tenants";

export { users } from "./users";
export type { User, NewUser } from "./users";

export { roles, permissions, userRoles, rolePermissions } from "./roles";
export type {
  Role,
  NewRole,
  Permission,
  NewPermission,
  UserRole,
  NewUserRole,
  RolePermission,
  NewRolePermission,
} from "./roles";

export { workerScopeAssignments } from "./worker-scope";
export type {
  WorkerScopeAssignment,
  NewWorkerScopeAssignment,
} from "./worker-scope";

export { tenantSettings } from "./tenant-settings";
export type { TenantSetting, NewTenantSetting } from "./tenant-settings";

export { terminologyLabels } from "./terminology";
export type {
  TerminologyLabel,
  NewTerminationLabel,
} from "./terminology";

export { documentSequences } from "./document-sequences";
export type {
  DocumentSequence,
  NewDocumentSequence,
} from "./document-sequences";

export { approvalRequests } from "./approval-requests";
export type {
  ApprovalRequest,
  NewApprovalRequest,
} from "./approval-requests";

export { auditLogs } from "./audit-logs";
export type { AuditLog, NewAuditLog } from "./audit-logs";

export { idempotencyRecords } from "./idempotency";
export type {
  IdempotencyRecord,
  NewIdempotencyRecord,
} from "./idempotency";

export { operationalAlerts } from "./operational-alerts";
export type {
  OperationalAlert,
  NewOperationalAlert,
} from "./operational-alerts";

// Enums (re-exported for service/test use)
export {
  roleCode,
  approvalStatus,
  recordOrigin,
  recordPeriod,
  approvalRiskLevel,
  approvalRequestState,
  idempotencyState,
  alertSeverity,
  alertState,
  tenantSettingLevel,
  workerScopeType,
  userStatus,
  tenantStatus,
  roleSystemFlag,
} from "./enums";
