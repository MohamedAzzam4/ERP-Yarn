/**
 * Deterministic MVP seed data for the platform/security foundation.
 *
 * Contract: docs/contracts/13_work_packages.md WP-00-03A
 *   Expected outputs: "Reviewed platform Drizzle schema/SQL migration and
 *   seeds."
 *   Tests/Acceptance: "Clean DB, tenant keys, role/permission constraints,
 *   sequence concurrency, audit immutability, orphan recovery."
 *
 * Contract: docs/contracts/11_permission_matrix.md §5 + §12
 *   - 5 system roles with the exact role_code values.
 *   - Required permission keys enumerated in §12.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §7.1
 *   Current-client seed uses `currency_code = EGP` and timezone
 *   `Africa/Cairo`.
 *
 * DEC-061: MVP users normally have one active operational role. Seeds
 * MUST NOT rely on multi-role users.
 *
 * DEC-062: Workers default to no operational row access. Seeds do NOT
 * pre-grant worker scope assignments — that is the explicit default-deny
 * behavior. Owner must add assignments at runtime.
 *
 * DEC-063: Worker financial-deny is enforced by the security policy
 * module, not by the role-permission seed alone. The seed for Worker
 * roles deliberately OMITS every financial permission key listed in
 * WORKER_DENIED_PERMISSION_KEYS — this is a defense-in-depth redundancy.
 *
 * WP-00-03A scope: seed data is DEFINED here as plain TypeScript objects.
 * It is NOT executed against a live database in this package (no Supabase
 * credentials). Later packages that run migrations will apply this seed
 * under explicit authorization.
 */

import type { RoleCode } from "../../security/role-codes";
import { WORKER_DENIED_PERMISSION_KEYS } from "../../security/worker-financial-deny";

// ---------------------------------------------------------------------------
// Tenant seed.
// ---------------------------------------------------------------------------

export const SEED_TENANT = {
  id: "00000000-0000-0000-0000-000000000001" as const,
  companyName: "ERP-Yarn Demo Tenant",
  defaultLanguage: "ar",
  currencyCode: "EGP",
  timezone: "Africa/Cairo",
  status: "active" as const,
  terminologyVersion: "v1",
};

// ---------------------------------------------------------------------------
// Role seeds (5 system roles per Contract 03 §6 / Contract 11 §5).
// ---------------------------------------------------------------------------

export interface RoleSeed {
  id: string;
  tenantId: string;
  roleCode: RoleCode;
  nameAr: string;
  nameEn: string;
  isSystemRole: true;
  systemFlag: "system";
}

export const SEED_ROLES: ReadonlyArray<RoleSeed> = [
  {
    id: "00000000-0000-0000-0000-000000000101",
    tenantId: SEED_TENANT.id,
    roleCode: "owner",
    nameAr: "المالك",
    nameEn: "Owner",
    isSystemRole: true,
    systemFlag: "system",
  },
  {
    id: "00000000-0000-0000-0000-000000000102",
    tenantId: SEED_TENANT.id,
    roleCode: "accountant",
    nameAr: "المحاسب",
    nameEn: "Accountant",
    isSystemRole: true,
    systemFlag: "system",
  },
  {
    id: "00000000-0000-0000-0000-000000000103",
    tenantId: SEED_TENANT.id,
    roleCode: "warehouse_employee",
    nameAr: "موظف المخزن",
    nameEn: "Warehouse Employee",
    isSystemRole: true,
    systemFlag: "system",
  },
  {
    id: "00000000-0000-0000-0000-000000000104",
    tenantId: SEED_TENANT.id,
    roleCode: "production_employee",
    nameAr: "موظف التشغيل",
    nameEn: "Production Employee",
    isSystemRole: true,
    systemFlag: "system",
  },
  {
    id: "00000000-0000-0000-0000-000000000105",
    tenantId: SEED_TENANT.id,
    roleCode: "quality_employee",
    nameAr: "موظف الجودة",
    nameEn: "Quality Employee",
    isSystemRole: true,
    systemFlag: "system",
  },
];

// ---------------------------------------------------------------------------
// Permission seeds (Contract 11 §12).
// ---------------------------------------------------------------------------

export interface PermissionSeed {
  id: string;
  tenantId: string;
  permissionKey: string;
  module: string;
  action: string;
  fieldKey?: string;
  description: string;
}

/**
 * Build the permission seed list from Contract 11 §12. IDs are
 * deterministic UUIDs derived from the permission key index so the seed
 * is reproducible across runs.
 */
function buildPermissionSeeds(): PermissionSeed[] {
  const keys: ReadonlyArray<{
    key: string;
    module: string;
    action: string;
    description: string;
  }> = [
    { key: "users.view_limited", module: "users", action: "view_limited", description: "View limited user information" },
    { key: "users.manage", module: "users", action: "manage", description: "Manage users" },
    { key: "permissions.manage", module: "permissions", action: "manage", description: "Manage permissions" },
    { key: "settings.view_restricted", module: "settings", action: "view_restricted", description: "View restricted settings" },
    { key: "settings.manage", module: "settings", action: "manage", description: "Manage settings" },
    { key: "master_data.view", module: "master_data", action: "view", description: "View master data (suppliers/customers/locations/factories)" },
    { key: "master_data.view_names", module: "master_data", action: "view_names", description: "View master data names only (worker task-scoped)" },
    { key: "master_data.create", module: "master_data", action: "create", description: "Create master data records" },
    { key: "master_data.update", module: "master_data", action: "update", description: "Update master data records" },
    { key: "master_data.inactivate", module: "master_data", action: "inactivate", description: "Inactivate master data records (no hard delete)" },
    { key: "inventory.view_quantity", module: "inventory", action: "view_quantity", description: "View inventory quantities" },
    { key: "inventory.receive.create", module: "inventory", action: "receive_create", description: "Create raw receipt draft" },
    { key: "inventory.receive.approve", module: "inventory", action: "receive_approve", description: "Approve raw receipt" },
    { key: "inventory.transfer.create", module: "inventory", action: "transfer_create", description: "Create transfer draft" },
    { key: "inventory.transfer.approve", module: "inventory", action: "transfer_approve", description: "Approve transfer" },
    { key: "inventory.adjustment.request", module: "inventory", action: "adjustment_request", description: "Request inventory adjustment" },
    { key: "inventory.adjustment.approve", module: "inventory", action: "adjustment_approve", description: "Approve inventory adjustment" },
    { key: "inventory.reverse", module: "inventory", action: "reverse", description: "Reverse stock movement" },
    { key: "inventory.request_correction", module: "inventory", action: "request_correction", description: "Request inventory correction" },
    { key: "inventory.correct", module: "inventory", action: "correct", description: "Correct inventory document" },
    { key: "sales.create", module: "sales", action: "create", description: "Create sales draft" },
    { key: "sales.submit", module: "sales", action: "submit", description: "Submit sale for approval" },
    { key: "sales.approve", module: "sales", action: "approve", description: "Approve sale" },
    { key: "sales.cancel", module: "sales", action: "cancel", description: "Cancel pending sale" },
    { key: "sales.reverse", module: "sales", action: "reverse", description: "Reverse approved sale" },
    { key: "sales.view_price", module: "sales", action: "view_price", description: "View sales price" },
    { key: "sales.request_correction", module: "sales", action: "request_correction", description: "Request sale correction" },
    { key: "sales.correct", module: "sales", action: "correct", description: "Correct sale document" },
    { key: "production.create", module: "production", action: "create", description: "Create production order draft" },
    { key: "production.issue_draft.create", module: "production", action: "issue_draft_create", description: "Create production issue draft" },
    { key: "production.issue_draft.submit", module: "production", action: "issue_draft_submit", description: "Submit production issue draft" },
    { key: "production.issue.approve", module: "production", action: "issue_approve", description: "Approve production issue" },
    { key: "production.receive_draft", module: "production", action: "receive_draft", description: "Create production receipt draft" },
    { key: "production.approve", module: "production", action: "approve", description: "Approve production receipt" },
    { key: "production.return_from_wip.request", module: "production", action: "return_from_wip_request", description: "Request WIP return" },
    { key: "production.return_from_wip.approve", module: "production", action: "return_from_wip_approve", description: "Approve WIP return" },
    { key: "production.view_cost", module: "production", action: "view_cost", description: "View production cost" },
    { key: "production.request_correction", module: "production", action: "request_correction", description: "Request production correction" },
    { key: "production.correct", module: "production", action: "correct", description: "Correct production document" },
    { key: "payments.create", module: "payments", action: "create", description: "Create payment draft" },
    { key: "payments.approve", module: "payments", action: "approve", description: "Approve and post payment" },
    { key: "payments.reverse", module: "payments", action: "reverse", description: "Reverse payment" },
    { key: "balances.view_customer", module: "balances", action: "view_customer", description: "View customer balances" },
    { key: "balances.view_supplier_factory", module: "balances", action: "view_supplier_factory", description: "View supplier/factory balances" },
    { key: "direct_costs.review", module: "direct_costs", action: "review", description: "Review and post direct cost" },
    { key: "quality_tests.create", module: "quality_tests", action: "create", description: "Create quality test" },
    { key: "quality_risk_sales.approve", module: "quality_risk_sales", action: "approve", description: "Approve quality-risk sale" },
    { key: "complaints.investigate", module: "complaints", action: "investigate", description: "Investigate complaint" },
    { key: "returns.create", module: "returns", action: "create", description: "Create return request" },
    { key: "returns.approve", module: "returns", action: "approve", description: "Approve return" },
    { key: "returns.request_correction", module: "returns", action: "request_correction", description: "Request return correction" },
    { key: "returns.correct", module: "returns", action: "correct", description: "Correct return document" },
    { key: "profitability.view", module: "profitability", action: "view", description: "View profitability" },
    { key: "audit.view", module: "audit", action: "view", description: "View audit logs" },
    { key: "migration.prepare", module: "migration", action: "prepare", description: "Prepare migration batch" },
    { key: "migration.review", module: "migration", action: "review", description: "Review migration batch" },
    { key: "migration.approve", module: "migration", action: "approve", description: "Approve migration batch" },
    { key: "migration.commit", module: "migration", action: "commit", description: "Commit historical import" },
    { key: "backup.view", module: "backup", action: "view", description: "View backup status" },
    { key: "backup.run", module: "backup", action: "run", description: "Run manual backup" },
    { key: "backup.restore_test", module: "backup", action: "restore_test", description: "Run restore test" },
    { key: "exports.internal", module: "exports", action: "internal", description: "Export internal reports" },
  ];

  return keys.map((k, i) => {
    // Deterministic UUID-style ID based on index. Uses fixed prefix
    // 00000000-0000-0000-0000-0000000002xx so permission IDs are stable
    // across runs (the role_permissions seed references them by ID).
    const suffix = (200 + i).toString().padStart(3, "0");
    return {
      id: `00000000-0000-0000-0000-000000000${suffix}`,
      tenantId: SEED_TENANT.id,
      permissionKey: k.key,
      module: k.module,
      action: k.action,
      description: k.description,
    };
  });
}

export const SEED_PERMISSIONS: ReadonlyArray<PermissionSeed> = buildPermissionSeeds();

// ---------------------------------------------------------------------------
// Role-permission assignment matrix.
// ---------------------------------------------------------------------------

/**
 * Map from role code to the set of permission keys that role is granted
 * in MVP.
 *
 * Source: docs/contracts/11_permission_matrix.md §7 Role/Action Matrix.
 *
 * Defense-in-depth per DEC-063: Worker roles (warehouse, production,
 * quality) deliberately EXCLUDE every key in
 * WORKER_DENIED_PERMISSION_KEYS, even though the runtime policy module
 * would also deny them. Belt and suspenders.
 */
const ROLE_PERMISSION_MATRIX: Record<RoleCode, ReadonlySet<string>> = {
  owner: new Set(SEED_PERMISSIONS.map((p) => p.permissionKey)),

  accountant: new Set([
    "users.view_limited",
    "settings.view_restricted",
    // Master data: Contract 11 §7 grants Accountant V/C/U on master data.
    "master_data.view",
    "master_data.create",
    "master_data.update",
    "master_data.inactivate",
    "inventory.view_quantity",
    "inventory.receive.create",
    "inventory.receive.approve",
    "inventory.transfer.create",
    "inventory.transfer.approve",
    "inventory.adjustment.request",
    "inventory.adjustment.approve",
    "inventory.reverse",
    "inventory.request_correction",
    "inventory.correct",
    "sales.create",
    "sales.submit",
    "sales.approve",
    "sales.cancel",
    "sales.reverse",
    "sales.view_price",
    "sales.request_correction",
    "sales.correct",
    "production.create",
    "production.issue_draft.create",
    "production.issue_draft.submit",
    "production.issue.approve",
    "production.receive_draft",
    "production.approve",
    "production.return_from_wip.request",
    "production.return_from_wip.approve",
    "production.view_cost",
    "production.request_correction",
    "production.correct",
    "payments.create",
    "payments.approve",
    "payments.reverse",
    "balances.view_customer",
    "balances.view_supplier_factory",
    "direct_costs.review",
    "quality_risk_sales.approve",
    "complaints.investigate",
    "returns.create",
    "returns.approve",
    "returns.request_correction",
    "returns.correct",
    "profitability.view",
    "audit.view",
    "migration.prepare",
    "migration.review",
    "migration.approve",
    "migration.commit",
    "backup.view",
    "backup.run",
    "backup.restore_test",
    "exports.internal",
  ]),

  warehouse_employee: new Set([
    // Operational only — no financial keys per DEC-063.
    // Workers may view master data names only (task-scoped, no financial fields).
    "master_data.view_names",
    "inventory.view_quantity",
    "inventory.receive.create",
    "inventory.transfer.create",
    "inventory.adjustment.request",
    "sales.create", // operational draft only; sales.submit is Accountant
    "production.create", // stock movement context only
    "returns.create",
    "quality_tests.create", // per matrix: warehouse may receive returned stock
  ]),

  production_employee: new Set([
    // Operational only — no financial keys per DEC-063.
    // Workers may view master data names only (task-scoped, no financial fields).
    "master_data.view_names",
    "inventory.view_quantity",
    "production.create",
    "production.issue_draft.create",
    "production.issue_draft.submit",
    "production.receive_draft",
    "production.return_from_wip.request",
  ]),

  quality_employee: new Set([
    // Operational only — no financial keys per DEC-063.
    // Workers may view master data names only (task-scoped, no financial fields).
    "master_data.view_names",
    "inventory.view_quantity",
    "quality_tests.create",
    "complaints.investigate",
    "returns.create",
  ]),
};

// ---------------------------------------------------------------------------
// Generated role_permissions seed.
// ---------------------------------------------------------------------------

export interface RolePermissionSeed {
  roleId: string;
  permissionId: string;
  tenantId: string;
}

function buildRolePermissionSeeds(): RolePermissionSeed[] {
  const result: RolePermissionSeed[] = [];
  const roleByCode: Record<RoleCode, string> = SEED_ROLES.reduce(
    (acc, r) => {
      acc[r.roleCode] = r.id;
      return acc;
    },
    {} as Record<RoleCode, string>,
  );
  const permissionByKey: Record<string, string> = SEED_PERMISSIONS.reduce(
    (acc, p) => {
      acc[p.permissionKey] = p.id;
      return acc;
    },
    {} as Record<string, string>,
  );

  for (const roleCode of Object.keys(ROLE_PERMISSION_MATRIX) as RoleCode[]) {
    const roleId = roleByCode[roleCode];
    const keys = ROLE_PERMISSION_MATRIX[roleCode];

    // Defense-in-depth: verify Worker roles do not receive any denied key.
    if (
      roleCode === "warehouse_employee" ||
      roleCode === "production_employee" ||
      roleCode === "quality_employee"
    ) {
      for (const key of keys) {
        if (WORKER_DENIED_PERMISSION_KEYS.has(key)) {
          throw new Error(
            `Seed invariant violation: Worker role '${roleCode}' must not be granted '${key}' (DEC-063).`,
          );
        }
      }
    }

    for (const key of keys) {
      const permissionId = permissionByKey[key];
      if (!permissionId) {
        throw new Error(
          `Seed invariant violation: permission key '${key}' (granted to '${roleCode}') is not in SEED_PERMISSIONS.`,
        );
      }
      result.push({
        roleId,
        permissionId,
        tenantId: SEED_TENANT.id,
      });
    }
  }
  return result;
}

export const SEED_ROLE_PERMISSIONS: ReadonlyArray<RolePermissionSeed> =
  buildRolePermissionSeeds();

// ---------------------------------------------------------------------------
// Synthetic test-fixture Owner user (NOT a production/dev seed).
// ---------------------------------------------------------------------------

/**
 * Synthetic test-fixture Owner user.
 *
 * IMPORTANT: This is NOT a production or dev seed. It is a SYNTHETIC TEST
 * FIXTURE only, used by unit tests that need a stable user ID and role
 * assignment. It MUST NOT be inserted into any real database.
 *
 * PCD-AUTH-002 (Initial Owner bootstrap, lost-Owner recovery authority,
 * and emergency/break-glass process) is UNRESOLVED. Real Owner bootstrap
 * is a WP-01-01 concern and requires:
 *   - PCD-AUTH-001 (sign-in method) resolution
 *   - PCD-AUTH-002 (bootstrap authority) resolution
 *   - A separate owner-bootstrap migration/seed that runs under explicit
 *     owner authorization
 *
 * The `authId` here is a placeholder string ("PLACEHOLDER_...") that would
 * fail Supabase Auth validation. It exists only so the test fixture has
 * a non-null value for the `users.auth_id` NOT NULL column.
 *
 * Do NOT run a seed script that inserts this row into a hosted Supabase
 * project. Do NOT use this row for login, session, or any runtime path.
 * It is test-fixture data only.
 */
export const TEST_FIXTURE_OWNER_USER = {
  id: "00000000-0000-0000-0000-000000000301" as const,
  tenantId: SEED_TENANT.id,
  authId: "PLACEHOLDER_TEST_FIXTURE_NOT_FOR_PRODUCTION_USE" as const,
  name: "Test Fixture Owner (synthetic)",
  email: "test-fixture-owner@erp-yarn.local",
  phone: null,
  status: "active" as const,
  languagePreference: "ar",
};

/**
 * @deprecated Use `TEST_FIXTURE_OWNER_USER` instead.
 *
 * Backward-compat alias kept only so existing test imports don't break
 * during the rename. Will be removed once all tests reference the new
 * name. The semantics are identical: this is a synthetic test fixture,
 * NOT a production seed.
 */
export const SEED_INITIAL_OWNER_USER = TEST_FIXTURE_OWNER_USER;

export const TEST_FIXTURE_OWNER_USER_ROLE = {
  userId: TEST_FIXTURE_OWNER_USER.id,
  roleId: SEED_ROLES[0]!.id, // owner role
  tenantId: SEED_TENANT.id,
};

/**
 * @deprecated Use `TEST_FIXTURE_OWNER_USER_ROLE` instead.
 */
export const SEED_INITIAL_USER_ROLE = TEST_FIXTURE_OWNER_USER_ROLE;
