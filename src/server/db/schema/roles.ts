/**
 * `roles`, `permissions`, `user_roles`, `role_permissions` tables.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §7.2
 *   `roles` requires unique `(tenant_id, role_code)`.
 *   `permissions` stores stable key, module, action, optional field key,
 *   and description.
 *   Join tables use composite primary keys and tenant-consistency
 *   constraints.
 *   Only Owner manages users/permissions in MVP; every assignment change
 *   is audited.
 *
 * DEC-061: MVP users normally have one active operational role; schema
 * may support multiple role assignments; Worker-family financial denial
 * always wins. Multi-role assignment is Owner-only, audited, exceptional.
 *
 * DEC-063: Worker financial-deny is absolute and non-overridable in MVP
 * (enforced by `src/server/security/worker-financial-deny.ts`, not by
 * these tables alone).
 *
 * DB-level FKs:
 *   - user_roles.user_id -> users.id
 *   - user_roles.role_id -> roles.id
 *   - user_roles.assigned_by -> users.id
 *   - role_permissions.role_id -> roles.id
 *   - role_permissions.permission_id -> permissions.id
 */
import { text, uuid, boolean, timestamp, pgTable, uniqueIndex, index, primaryKey } from "drizzle-orm/pg-core";
import { tenantIdColumn, makeTenantOwnedRow, userRefColumn } from "./_helpers";
import { users } from "./users";
import { roleCode, roleSystemFlag } from "./enums";

// `users.id` PgColumn for FK references. Cast to satisfy Drizzle's
// `references()` callback signature under `noUncheckedIndexedAccess`.
const usersId = users.id!;

// ---------------------------------------------------------------------------
// roles
// ---------------------------------------------------------------------------

export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    roleCode: roleCode("role_code").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    isSystemRole: boolean("is_system_role").notNull().default(true),
    systemFlag: roleSystemFlag("system_flag").notNull().default("system"),
    ...makeTenantOwnedRow(usersId),
  },
  (t) => [
    uniqueIndex("roles_tenant_role_code_unique_idx").on(t.tenantId, t.roleCode),
    index("roles_tenant_idx").on(t.tenantId),
    // System roles cannot be deleted (no deleted_at on this table — system
    // roles are immutable in MVP). Custom roles may be inactivated by
    // revoking all user_roles assignments instead of hard-delete.
  ],
);

export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;

// ---------------------------------------------------------------------------
// permissions
// ---------------------------------------------------------------------------

/**
 * `permissions` is tenant-scoped for custom permissions but also holds the
 * MVP seed permission catalog (one row per permission key per tenant).
 *
 * Contract 03 §7.2: `permissions` stores stable key, module, action,
 * optional field key, and description.
 *
 * Contract 11 §12 enumerates the exact MVP permission keys.
 */
export const permissions = pgTable(
  "permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    permissionKey: text("permission_key").notNull(),
    module: text("module").notNull(),
    action: text("action").notNull(),
    fieldKey: text("field_key"),
    description: text("description").notNull(),
    ...makeTenantOwnedRow(usersId),
  },
  (t) => [
    uniqueIndex("permissions_tenant_key_unique_idx").on(
      t.tenantId,
      t.permissionKey,
    ),
    index("permissions_tenant_module_idx").on(t.tenantId, t.module),
    index("permissions_tenant_action_idx").on(t.tenantId, t.action),
  ],
);

export type Permission = typeof permissions.$inferSelect;
export type NewPermission = typeof permissions.$inferInsert;

// ---------------------------------------------------------------------------
// user_roles
// ---------------------------------------------------------------------------

/**
 * Join table: users ↔ roles. Composite PK + tenant-consistency check.
 *
 * DEC-061: MVP seeds/UI use one role per user, but the schema supports
 * multiple. Multi-role assignment is Owner-only and audited.
 *
 * DB-level FKs: user_id -> users.id, role_id -> roles.id, assigned_by -> users.id.
 */
export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id),
    tenantId: tenantIdColumn(),
    assignedAt: timestamp("assigned_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    assignedBy: userRefColumn("assigned_by", usersId),
    ...makeTenantOwnedRow(usersId),
  },
  (t) => [
    primaryKey({ name: "user_roles_pk", columns: [t.userId, t.roleId] }),
    index("user_roles_tenant_user_idx").on(t.tenantId, t.userId),
    index("user_roles_tenant_role_idx").on(t.tenantId, t.roleId),
  ],
);

export type UserRole = typeof userRoles.$inferSelect;
export type NewUserRole = typeof userRoles.$inferInsert;

// ---------------------------------------------------------------------------
// role_permissions
// ---------------------------------------------------------------------------

/**
 * Join table: roles ↔ permissions. Composite PK + tenant-consistency.
 *
 * Contract 11 §12: "No worker wildcard permission." Each role-permission
 * assignment is explicit and auditable.
 *
 * DB-level FKs: role_id -> roles.id, permission_id -> permissions.id.
 */
export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissions.id),
    tenantId: tenantIdColumn(),
    ...makeTenantOwnedRow(usersId),
  },
  (t) => [
    primaryKey({ name: "role_permissions_pk", columns: [t.roleId, t.permissionId] }),
    index("role_permissions_tenant_role_idx").on(t.tenantId, t.roleId),
    index("role_permissions_tenant_permission_idx").on(t.tenantId, t.permissionId),
  ],
);

export type RolePermission = typeof rolePermissions.$inferSelect;
export type NewRolePermission = typeof rolePermissions.$inferInsert;
